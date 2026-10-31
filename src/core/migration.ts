import type { Tx } from "../db/pool.js";
import { appendAudit } from "./audit.js";
import { LedgerError } from "./errors.js";
import { ACCOUNT_KINDS, createAccount, suggestedTaxLine } from "./accounts.js";
import { parseCsv, parseStatementAmount, parseStatementDate } from "./bank.js";
import { createContact, issueDocument, type ContactAddress } from "./documents.js";
import { postJournal, type Actor, type LineInput, type Role } from "./ledger.js";

// Moving a business from QuickBooks Online or Xero. Four exports, in order:
//
//   1. Chart of accounts (QBO: Account List report; Xero: Chart of accounts export)
//   2. Customers and vendors (QBO: Customer and Vendor Contact List; Xero: Contacts export)
//   3. Open invoices and unpaid bills (QBO: Open Invoices and Unpaid Bills reports;
//      Xero: Aged Receivables and Aged Payables detail, or the invoice export)
//   4. Trial balance on the day before TrailBook's books start
//
// Open invoices and bills come in as real documents (so they can be paid and
// show in aging), dated the day the books start. Each one's line goes to a
// conversion clearing account, and the trial balance entry moves those
// clearing balances into receivables and payables instead of posting the old
// receivable and payable totals directly. If the documents add up to the old
// totals, both clearing accounts end at zero; any difference lands in opening
// balance equity and is reported.
//
// Every step can be previewed: the route runs it and rolls the transaction back.

const CAN_IMPORT: Role[] = ["owner", "admin", "accountant"];

export type Source = "qbo" | "xero";

function requireImporter(actor: Actor) {
  if (!CAN_IMPORT.includes(actor.role)) throw new LedgerError("FORBIDDEN", "only an owner, admin or accountant can import books from another program");
}

const norm = (s: string) => s.trim().toLowerCase().replace(/^\*/, "").replace(/[\s_.#-]+/g, " ").trim();

/** The first row that has all the wanted headers, and where each sits. */
function findHeader(rows: string[][], wanted: Record<string, string[]>, required: string[]): { at: number; col: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i]!.map(norm);
    const col: Record<string, number> = {};
    for (const [k, names] of Object.entries(wanted)) {
      const j = cells.findIndex((c) => names.includes(c));
      if (j >= 0) col[k] = j;
    }
    if (required.every((k) => col[k] !== undefined)) return { at: i, col };
  }
  return null;
}

const cell = (r: string[], j: number | undefined) => (j === undefined ? "" : (r[j] ?? "").trim());

/** QBO writes "1000 Checking" when account numbers are on, "Parent:Child" for sub-accounts; Xero writes "Checking (090)" in reports. */
function splitName(raw: string): { code: string | null; name: string; leaf: string } {
  let s = raw.trim();
  let code: string | null = null;
  const paren = /^(.*\S)\s*\(([A-Za-z0-9.-]{1,10})\)$/.exec(s);
  if (paren) { s = paren[1]!; code = paren[2]!; }
  const lead = /^(\d{3,7})\s+(.*)$/.exec(s);
  if (!code && lead) { code = lead[1]!; s = lead[2]!; }
  const leaf = s.includes(":") ? s.slice(s.lastIndexOf(":") + 1).trim() : s;
  return { code, name: s, leaf };
}

// ------------------------------------------------------------------ chart

/** How the old program's account types map to the kinds here. Receivables and payables map to the built-in control accounts. */
const TYPE_MAP: [RegExp, string][] = [
  [/^(bank|cash)$/, "bank"],
  [/^accounts receivable( \(a\/r\))?$|^a\/r$|^receivable$/, "system:accounts_receivable"],
  [/^accounts payable( \(a\/p\))?$|^a\/p$|^payable$/, "system:accounts_payable"],
  [/^credit ?card$/, "credit_card"],
  [/^prepayment$/, "prepaid"],
  [/^(other current assets?|current( asset)?|inventory)$/, "other_current_asset"],
  [/^(fixed assets?|fixed)$/, "fixed_asset"],
  [/^(other assets?|non ?current( asset)?|noncurrent)$/, "other_current_asset"],
  [/^(other current liabilit(y|ies)|current liability|currliab|liability)$/, "accrued"],
  [/^(long term liabilit(y|ies)|non ?current liability|termliab)$/, "long_term_debt"],
  [/^equity$/, "contributed_capital"],
  [/^(income|revenue|sales)$/, "operating_revenue"],
  [/^other ?income$/, "other_income"],
  [/^(cost of goods sold|direct ?costs)$/, "cost_of_revenue"],
  [/^(expenses?|overheads?|depreciat(io)?n)$/, "operating_expense"],
  [/^other ?expenses?$/, "other_expense"],
];

function kindFor(type: string, name: string): string | null {
  const t = norm(type).replace(/ /g, " ");
  const n = name.toLowerCase();
  if (/accumulated depreciation/.test(n)) return "contra_asset";
  if (/draw|distribution|dividend/.test(n) && /^equity$/.test(t)) return "distributions";
  if (/retained earnings/.test(n)) return "system:retained_earnings";
  if (/sales tax payable|gst\/hst payable|gst payable/.test(n)) return "system:sales_tax_payable";
  for (const [re, k] of TYPE_MAP) if (re.test(t)) return k;
  return null;
}

const RANGES: Record<string, [number, number]> = {
  asset: [1000, 1999], liability: [2000, 2999], equity: [3000, 3999], revenue: [4000, 4999], cost_of_revenue: [5000, 5999], expense: [6000, 7999], other_expense: [8000, 8999],
};

async function freeCode(tx: Tx, entityId: string, kindKey: string, preferred: string | null): Promise<string> {
  const used = new Set((await tx.query("SELECT code FROM accounts WHERE entity_id = $1", [entityId])).rows.map((r) => r.code as string));
  const kind = ACCOUNT_KINDS.find((k) => k.key === kindKey)!;
  const range = RANGES[kindKey === "cost_of_revenue" ? "cost_of_revenue" : kindKey === "other_expense" ? "other_expense" : kind.type]!;
  if (preferred && /^\d{4}$/.test(preferred) && !used.has(preferred) && Number(preferred) >= range[0] && Number(preferred) <= range[1]) return preferred;
  for (let c = range[0] + 10; c <= range[1]; c += 10) if (!used.has(String(c))) return String(c);
  for (let c = range[0]; c <= range[1]; c++) if (!used.has(String(c))) return String(c);
  throw new LedgerError("INVALID", `no free account code left for ${kind.label.toLowerCase()} accounts`);
}

async function mapAccount(tx: Tx, base: { orgId: string; entityId: string }, source: Source, key: string, name: string, type: string | null, accountId: string) {
  await tx.query(
    `INSERT INTO migration_account_map (org_id, entity_id, source, source_key, source_name, source_type, account_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
    [base.orgId, base.entityId, source, key, name, type, accountId],
  );
}

const keyOf = (code: string | null, name: string) => (code ? `#${code.toLowerCase()}` : name.trim().toLowerCase());

export interface ChartResult {
  source: Source;
  created: { code: string; name: string; kind: string }[];
  matched: { from: string; to: string }[];
  skipped: { name: string; reason: string }[];
}

/** Adds the old chart's accounts (or matches them to ones already here) and remembers the mapping. */
export async function importChart(tx: Tx, input: { orgId: string; entityId: string; csv: string; actor: Actor }): Promise<ChartResult> {
  requireImporter(input.actor);
  const rows = parseCsv(input.csv);
  const h = findHeader(rows, {
    code: ["code", "account code", "account number", "account no", "number", "acct num"],
    name: ["name", "account", "account name", "full name"],
    type: ["type", "account type"],
    detail: ["detail type"],
  }, ["name", "type"]);
  if (!h) throw new LedgerError("INVALID", "this doesn't look like a chart of accounts export: it needs Account (or Name) and Type columns");
  const source: Source = h.col.code !== undefined && norm(rows[h.at]![h.col.code]!) === "code" ? "xero" : "qbo";
  const ent = (await tx.query("SELECT coa_template, tax_return_type FROM entities WHERE id = $1", [input.entityId])).rows[0];
  const existing = (await tx.query("SELECT id, code, name, system_key FROM accounts WHERE entity_id = $1", [input.entityId])).rows;
  const byName = new Map(existing.map((a) => [a.name.toLowerCase(), a]));
  const bySystem = new Map(existing.filter((a) => a.system_key).map((a) => [a.system_key, a]));
  const out: ChartResult = { source, created: [], matched: [], skipped: [] };
  const base = { orgId: input.orgId, entityId: input.entityId };
  for (const r of rows.slice(h.at + 1)) {
    const rawName = cell(r, h.col.name);
    const type = cell(r, h.col.type);
    if (!rawName || !type || /^total\b/i.test(rawName)) continue;
    const split = splitName(rawName);
    const code = cell(r, h.col.code) || split.code;
    const label = split.name;
    const key = keyOf(code, label);
    const known = (await tx.query("SELECT 1 FROM migration_account_map WHERE entity_id = $1 AND source = $2 AND source_key = $3", [input.entityId, source, key])).rows[0];
    if (known) { out.skipped.push({ name: label, reason: "already imported" }); continue; }
    const kind = kindFor(type, label);
    if (!kind) { out.skipped.push({ name: label, reason: `unknown account type "${type}"; add it by hand under Chart of accounts` }); continue; }
    const target = kind.startsWith("system:") ? bySystem.get(kind.slice(7)) : byName.get(label.toLowerCase()) ?? byName.get(split.leaf.toLowerCase());
    if (target) {
      await mapAccount(tx, base, source, key, label, type, target.id);
      out.matched.push({ from: label, to: `${target.code} ${target.name}` });
      continue;
    }
    if (kind.startsWith("system:")) {
      out.skipped.push({ name: label, reason: "TrailBook keeps one of these; map it by hand if needed" });
      continue;
    }
    const newCode = await freeCode(tx, input.entityId, kind, code);
    const name = label.replace(/:/g, " - ").slice(0, 120);
    if (byName.has(name.toLowerCase())) { out.skipped.push({ name: label, reason: "an account with this name already exists" }); continue; }
    const acct = await createAccount(tx, {
      ...base, code: newCode, name, kind, taxLine: suggestedTaxLine(ent.coa_template, ent.tax_return_type, kind), actor: input.actor,
    });
    byName.set(name.toLowerCase(), { id: acct.id, code: newCode, name, system_key: null });
    await mapAccount(tx, base, source, key, label, type, acct.id);
    out.created.push({ code: newCode, name, kind: ACCOUNT_KINDS.find((k) => k.key === kind)!.label });
  }
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "migration.chart_imported", objectType: "entity", objectId: input.entityId,
    after: { source, created: out.created.length, matched: out.matched.length, skipped: out.skipped.length }, context: { role: input.actor.role },
  });
  return out;
}

// --------------------------------------------------------------- contacts

export interface ContactsResult {
  created: string[];
  skipped: { name: string; reason: string }[];
  /** Imported, but without an address or email that wasn't in a form TrailBook takes. */
  notes: { name: string; note: string }[];
}

const US_ZIP = /^\d{5}(-\d{4})?$/;
const CA_POSTAL = /^([A-Z]\d[A-Z]) ?(\d[A-Z]\d)$/;

function cleanImportAddress(line1: string, city: string, state: string, zip: string): ContactAddress | null {
  const st = state.trim().toUpperCase();
  const z = zip.trim().toUpperCase();
  if (!line1.trim() || !city.trim() || !/^[A-Z]{2}$/.test(st)) return null;
  if (US_ZIP.test(z)) return { line1: line1.trim().slice(0, 200), city: city.trim().slice(0, 100), state: st, zip: z };
  const ca = CA_POSTAL.exec(z);
  if (ca) return { line1: line1.trim().slice(0, 200), city: city.trim().slice(0, 100), state: st, zip: `${ca[1]} ${ca[2]}` };
  return null;
}

/** "123 Main St, Fresno, CA 93701" (QBO's one-cell address). */
function splitOneLine(s: string): ContactAddress | null {
  const m = /^(.+?),\s*([^,]+),\s*([A-Za-z]{2})\s+([0-9A-Za-z -]{5,10})(?:,\s*[^,]+)?$/.exec(s.replace(/\s*\n\s*/g, ", ").trim());
  return m ? cleanImportAddress(m[1]!, m[2]!, m[3]!, m[4]!) : null;
}

/** Adds customers and vendors from a contact list. A name already here is left alone. */
export async function importContacts(
  tx: Tx, input: { orgId: string; entityId: string; csv: string; kind?: "customer" | "vendor" | "both"; actor: Actor },
): Promise<ContactsResult> {
  requireImporter(input.actor);
  const rows = parseCsv(input.csv);
  const wanted = {
    customer: ["customer", "customer full name", "customer name"],
    vendor: ["vendor", "vendor full name", "vendor name", "supplier", "supplier name"],
    name: ["name", "contactname", "contact name", "display name", "company name", "company"],
    email: ["email", "emailaddress", "email address", "main email"],
    phone: ["phone", "phone numbers", "phonenumber", "phone number", "main phone"],
    line1: ["street address", "billing street", "billing address line 1", "poaddressline1", "address line 1", "street", "address 1"],
    city: ["city", "billing city", "pocity", "town city"],
    state: ["state", "billing state", "poregion", "region", "province", "state province"],
    zip: ["zip", "zip code", "postal code", "billing zip", "popostalcode", "postcode", "zip postal code"],
    oneLine: ["billing address", "address"],
  };
  const header = findHeader(rows, wanted, ["customer"]) ?? findHeader(rows, wanted, ["vendor"]) ?? findHeader(rows, wanted, ["name"]);
  if (!header) throw new LedgerError("INVALID", "this doesn't look like a contact list: it needs a Customer, Vendor or Name column");
  const kind = header.col.customer !== undefined ? "customer" : header.col.vendor !== undefined ? "vendor" : (input.kind ?? "both");
  const nameCol = header.col.customer ?? header.col.vendor ?? header.col.name;
  const have = new Set((await tx.query("SELECT lower(name) AS n FROM contacts WHERE entity_id = $1", [input.entityId])).rows.map((r) => r.n));
  const out: ContactsResult = { created: [], skipped: [], notes: [] };
  for (const r of rows.slice(header.at + 1)) {
    const name = cell(r, nameCol).slice(0, 200);
    if (!name || /^total\b/i.test(name)) continue;
    if (have.has(name.toLowerCase())) { out.skipped.push({ name, reason: "already here" }); continue; }
    const rawEmail = cell(r, header.col.email).split(/[;,\s]+/)[0] ?? "";
    const email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail) ? rawEmail.slice(0, 200) : null;
    const phone = cell(r, header.col.phone).split(/[;\n]/)[0]!.replace(/^[A-Za-z]+:\s*/, "").trim().slice(0, 40);
    const address = header.col.line1 !== undefined
      ? cleanImportAddress(cell(r, header.col.line1), cell(r, header.col.city), cell(r, header.col.state), cell(r, header.col.zip))
      : header.col.oneLine !== undefined ? splitOneLine(cell(r, header.col.oneLine)) : null;
    const hadAddress = [header.col.line1, header.col.oneLine].some((j) => j !== undefined && cell(r, j));
    if (hadAddress && !address) out.notes.push({ name, note: "address not in a form TrailBook reads (street, city, two-letter state, ZIP or postal code); add it with Edit" });
    if (rawEmail && !email) out.notes.push({ name, note: `email "${rawEmail}" skipped` });
    await createContact(tx, {
      orgId: input.orgId, entityId: input.entityId, kind, name, email, ...(phone.length >= 3 ? { phone } : {}), ...(address ? { address } : {}), actor: input.actor,
    });
    have.add(name.toLowerCase());
    out.created.push(name);
  }
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "migration.contacts_imported", objectType: "entity", objectId: input.entityId,
    after: { kind, created: out.created.length, skipped: out.skipped.length }, context: { role: input.actor.role },
  });
  return out;
}

// ------------------------------------------------------ open invoices and bills

const CLEARING = {
  invoice: { code: "2990", name: "Conversion clearing: open invoices", kind: "accrued" },
  bill: { code: "1990", name: "Conversion clearing: open bills", kind: "other_current_asset" },
} as const;
const OPENING_EQUITY = { code: "3950", name: "Opening balance equity", kind: "contributed_capital" } as const;

async function ensureAccount(tx: Tx, base: { orgId: string; entityId: string }, a: { code: string; name: string; kind: string }, actor: Actor): Promise<string> {
  const found = (await tx.query("SELECT code FROM accounts WHERE entity_id = $1 AND lower(name) = lower($2)", [base.entityId, a.name])).rows[0];
  if (found) return found.code;
  const code = await freeCode(tx, base.entityId, a.kind, a.code);
  await createAccount(tx, { ...base, code, name: a.name, kind: a.kind, taxLine: null, actor });
  return code;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Report dates: "03/15/2026", "2026-03-15", "15 Mar 2026" or "Mar 15, 2026". */
export function parseReportDate(s: string): string | null {
  const iso = parseStatementDate(s);
  if (iso) return iso;
  const t = s.trim().toLowerCase().replace(/,/g, "");
  let m = /^(\d{1,2}) ([a-z]{3})[a-z]* (\d{4})$/.exec(t);
  let d: string, mo: number, y: string;
  if (m) { d = m[1]!; mo = MONTHS.indexOf(m[2]!) + 1; y = m[3]!; }
  else {
    m = /^([a-z]{3})[a-z]* (\d{1,2}) (\d{4})$/.exec(t);
    if (!m) return null;
    mo = MONTHS.indexOf(m[1]!) + 1; d = m[2]!; y = m[3]!;
  }
  if (mo < 1) return null;
  return parseStatementDate(`${y}-${String(mo).padStart(2, "0")}-${d.padStart(2, "0")}`);
}

export interface OpenDocsResult {
  kind: "invoice" | "bill";
  created: { contact: string; number: string; openMinor: bigint }[];
  skipped: { row: string; reason: string }[];
  totalMinor: bigint;
  newContacts: string[];
}

/** Brings in what customers still owe (or what's owed to vendors) as documents dated the day the books start. */
export async function importOpenDocuments(
  tx: Tx, input: { orgId: string; entityId: string; csv: string; kind: "invoice" | "bill"; startDate: string; actor: Actor },
): Promise<OpenDocsResult> {
  requireImporter(input.actor);
  const rows = parseCsv(input.csv);
  const h = findHeader(rows, {
    number: ["num", "no", "number", "invoice number", "invoicenumber", "bill no", "bill number", "ref no", "reference", "invoice no"],
    contact: ["customer", "vendor", "supplier", "name", "contactname", "contact", "contact name"],
    date: ["date", "invoice date", "invoicedate", "bill date", "transaction date"],
    due: ["due date", "duedate"],
    open: ["open balance", "balance", "amountdue", "amount due", "due", "open amount", "balance due"],
    amount: ["amount", "total", "total amount"],
    type: ["transaction type", "type"],
  }, ["number"]);
  if (!h || (h.col.open === undefined && h.col.amount === undefined)) {
    throw new LedgerError("INVALID", `this doesn't look like an ${input.kind === "invoice" ? "open invoices" : "unpaid bills"} report: it needs Num (or Invoice Number) and Open balance (or Amount Due) columns`);
  }
  const base = { orgId: input.orgId, entityId: input.entityId };
  const clearing = await ensureAccount(tx, base, CLEARING[input.kind], input.actor);
  const contacts = new Map((await tx.query("SELECT id, lower(name) AS n FROM contacts WHERE entity_id = $1", [input.entityId])).rows.map((r) => [r.n, r.id as string]));
  const out: OpenDocsResult = { kind: input.kind, created: [], skipped: [], totalMinor: 0n, newContacts: [] };
  const seen = new Set<string>();
  let group = "";
  for (const r of rows.slice(h.at + 1)) {
    const filled = r.filter((c) => c.trim());
    // Reports grouped by customer or vendor put the name alone on a row before its transactions.
    if (filled.length === 1 && r[0]?.trim() && !/^total\b/i.test(r[0].trim())) { group = r[0].trim(); continue; }
    if (/^total\b/i.test((r[0] ?? "").trim()) || /^total\b/i.test(filled[0] ?? "")) continue;
    const number = cell(r, h.col.number);
    const contact = (cell(r, h.col.contact) || group).slice(0, 200);
    if (!number && !contact) continue;
    const type = cell(r, h.col.type).toLowerCase();
    const label = `${contact || "?"} ${number}`.trim();
    if (type && /payment|credit|deposit|journal/.test(type)) { out.skipped.push({ row: label, reason: `${type}: enter credits and prepayments by hand` }); continue; }
    if (!number) { out.skipped.push({ row: label, reason: "no number" }); continue; }
    if (!contact) { out.skipped.push({ row: label, reason: "no customer or vendor" }); continue; }
    const key = `${contact.toLowerCase()}|${number.toLowerCase()}`;
    if (seen.has(key)) continue; // Line-item exports repeat each document once per line.
    seen.add(key);
    const open = parseStatementAmount(cell(r, h.col.open ?? h.col.amount));
    if (open === null) { out.skipped.push({ row: label, reason: "amount not readable" }); continue; }
    if (open <= 0n) { out.skipped.push({ row: label, reason: open === 0n ? "nothing still owed" : "negative: enter it as a credit by hand" }); continue; }
    const origDate = parseReportDate(cell(r, h.col.date));
    const origDue = parseReportDate(cell(r, h.col.due));
    let contactId = contacts.get(contact.toLowerCase());
    if (!contactId) {
      contactId = (await createContact(tx, { ...base, kind: input.kind === "invoice" ? "customer" : "vendor", name: contact, email: null, actor: input.actor })).id;
      contacts.set(contact.toLowerCase(), contactId);
      out.newContacts.push(contact);
    }
    const what = `${input.kind === "invoice" ? "Invoice" : "Bill"} ${number}${origDate ? ` dated ${origDate}` : ""}`;
    await issueDocument(tx, {
      ...base, kind: input.kind, contactId, issueDate: input.startDate,
      dueDate: origDue && origDue > input.startDate ? origDue : input.startDate,
      memo: `Opening balance: ${what}${origDue ? `, due ${origDue}` : ""}`.slice(0, 300),
      ...(input.kind === "bill" ? { reference: number.slice(0, 60) } : {}),
      lines: [{ account: clearing, description: `Opening balance: ${what}`.slice(0, 300), quantity: "1", unitPrice: (Number(open) / 100).toFixed(2) }],
      idempotencyKey: `migration:${key}`, actor: input.actor,
    });
    out.created.push({ contact, number, openMinor: open });
    out.totalMinor += open;
  }
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "migration.open_documents_imported", objectType: "entity", objectId: input.entityId,
    after: { kind: input.kind, created: out.created.length, totalMinor: out.totalMinor.toString(), skipped: out.skipped.length }, context: { role: input.actor.role },
  });
  return out;
}

// --------------------------------------------------------- opening balances

export interface OpeningResult {
  entryId: string | null;
  lines: { account: string; debitMinor: bigint; creditMinor: bigint }[];
  /** Old receivable and payable totals, against the open documents brought in. */
  receivables: { trialBalanceMinor: bigint; documentsMinor: bigint };
  payables: { trialBalanceMinor: bigint; documentsMinor: bigint };
  /** What went to opening balance equity to balance it (positive = credit). */
  plugMinor: bigint;
  unmatched: string[];
  warnings: string[];
}

/**
 * Posts the old trial balance as one opening entry on the day the books start.
 * With `rollIncome`, income and expense totals go into retained earnings, for a
 * trial balance taken at the end of a year.
 */
export async function importOpeningBalances(
  tx: Tx, input: { orgId: string; entityId: string; csv: string; startDate: string; rollIncome?: boolean; actor: Actor },
): Promise<OpeningResult> {
  requireImporter(input.actor);
  const rows = parseCsv(input.csv);
  const h = findHeader(rows, {
    code: ["account code", "code"],
    name: ["account", "account name", "name", ""],
    debit: ["debit", "debits", "debit year to date", "debit ytd"],
    credit: ["credit", "credits", "credit year to date", "credit ytd"],
  }, ["debit", "credit"]);
  if (!h) throw new LedgerError("INVALID", "this doesn't look like a trial balance: it needs Debit and Credit columns");
  const nameCol = h.col.name ?? 0;
  const base = { orgId: input.orgId, entityId: input.entityId };
  const prior = (await tx.query("SELECT 1 FROM journal_entries WHERE entity_id = $1 AND idempotency_key = 'migration:opening'", [input.entityId])).rows[0];
  if (prior) throw new LedgerError("INVALID", "the opening balances are already in; reverse that entry in the Journal first to bring them in again");

  const accounts = (await tx.query("SELECT id, code, name, type, system_key FROM accounts WHERE entity_id = $1", [input.entityId])).rows;
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const byName = new Map(accounts.map((a) => [a.name.toLowerCase(), a]));
  const map = (await tx.query("SELECT source_key, account_id FROM migration_account_map WHERE entity_id = $1", [input.entityId])).rows;
  const byKey = new Map(map.map((m) => [m.source_key, byId.get(m.account_id)]));

  const totals = new Map<string, bigint>(); // account code -> debit minus credit
  const unmatched: string[] = [];
  let ar = 0n, ap = 0n, income = 0n;
  for (const r of rows.slice(h.at + 1)) {
    const raw = cell(r, nameCol);
    if (!raw || /^total\b/i.test(raw)) continue;
    const dr = parseStatementAmount(cell(r, h.col.debit)) ?? 0n;
    const cr = parseStatementAmount(cell(r, h.col.credit)) ?? 0n;
    if (!dr && !cr) continue;
    const split = splitName(raw);
    const code = cell(r, h.col.code) || split.code;
    const a = (code && byKey.get(`#${code.toLowerCase()}`)) || byKey.get(split.name.toLowerCase()) || byKey.get(raw.toLowerCase())
      || byName.get(split.name.toLowerCase()) || byName.get(split.leaf.toLowerCase());
    if (!a) { unmatched.push(raw); continue; }
    const net = dr - cr;
    if (a.system_key === "accounts_receivable") { ar += net; continue; }
    if (a.system_key === "accounts_payable") { ap -= net; continue; }
    if (input.rollIncome && (a.type === "revenue" || a.type === "expense")) { income += net; continue; }
    totals.set(a.code, (totals.get(a.code) ?? 0n) + net);
  }
  const warnings: string[] = [];
  if (unmatched.length) {
    return { entryId: null, lines: [], receivables: { trialBalanceMinor: ar, documentsMinor: 0n }, payables: { trialBalanceMinor: ap, documentsMinor: 0n }, plugMinor: 0n, unmatched,
      warnings: ["Some accounts in the trial balance aren't in TrailBook yet. Import the chart of accounts first, or add them under Chart of accounts with the same name."] };
  }
  if (income) {
    const re = accounts.find((a) => a.system_key === "retained_earnings");
    totals.set(re.code, (totals.get(re.code) ?? 0n) + income);
  }
  // Move the conversion clearing balances (the open documents) into place of the old receivable and payable totals.
  const balance = async (name: string) => {
    const a = byName.get(name.toLowerCase());
    if (!a) return { code: null as string | null, net: 0n };
    const r = (await tx.query("SELECT coalesce(sum(debit_minor - credit_minor), 0)::bigint AS net FROM journal_lines WHERE account_id = $1", [a.id])).rows[0];
    return { code: a.code as string, net: r.net as bigint };
  };
  const invClear = await balance(CLEARING.invoice.name); // a credit balance: negative net
  const billClear = await balance(CLEARING.bill.name); // a debit balance: positive net
  if (invClear.code && invClear.net) totals.set(invClear.code, (totals.get(invClear.code) ?? 0n) - invClear.net);
  if (billClear.code && billClear.net) totals.set(billClear.code, (totals.get(billClear.code) ?? 0n) - billClear.net);
  const docsAr = -invClear.net, docsAp = billClear.net;
  if (ar !== docsAr) warnings.push(`The old receivables total was ${fmt(ar)} but the open invoices brought in add up to ${fmt(docsAr)}; the difference went to opening balance equity.`);
  if (ap !== docsAp) warnings.push(`The old payables total was ${fmt(ap)} but the unpaid bills brought in add up to ${fmt(docsAp)}; the difference went to opening balance equity.`);

  const net = [...totals.values()].reduce((s, v) => s + v, 0n);
  if (net !== 0n) {
    const obe = await ensureAccount(tx, base, OPENING_EQUITY, input.actor);
    totals.set(obe, (totals.get(obe) ?? 0n) - net);
  }
  const lines: LineInput[] = [...totals.entries()].filter(([, v]) => v !== 0n).sort(([a], [b]) => a.localeCompare(b))
    .map(([account, v]) => (v > 0n ? { account, debit: v, description: "Opening balance" } : { account, credit: -v, description: "Opening balance" }));
  if (!lines.length) throw new LedgerError("INVALID", "the trial balance has no balances to bring in");
  const entry = await postJournal(tx, {
    ...base, date: input.startDate, memo: "Opening balances from the previous accounting program", sourceType: "opening_balance",
    idempotencyKey: "migration:opening", lines, actor: input.actor,
  });
  return {
    entryId: entry.id,
    lines: lines.map((l) => ({ account: l.account, debitMinor: (l.debit as bigint | undefined) ?? 0n, creditMinor: (l.credit as bigint | undefined) ?? 0n })),
    receivables: { trialBalanceMinor: ar, documentsMinor: docsAr }, payables: { trialBalanceMinor: ap, documentsMinor: docsAp },
    plugMinor: net, unmatched, warnings,
  };
}

const fmt = (m: bigint) => `${m < 0n ? "-" : ""}$${((m < 0n ? -m : m) / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${String((m < 0n ? -m : m) % 100n).padStart(2, "0")}`;

/** Where the move stands: what's been brought in so far. */
export async function migrationStatus(tx: Tx, entityId: string) {
  const r = (await tx.query(
    `SELECT (SELECT count(*) FROM migration_account_map WHERE entity_id = $1)::int AS mapped,
            (SELECT min(source) FROM migration_account_map WHERE entity_id = $1) AS source,
            (SELECT count(*) FROM contacts WHERE entity_id = $1)::int AS contacts,
            (SELECT count(*) FROM documents WHERE entity_id = $1 AND kind = 'invoice' AND idempotency_key LIKE 'invoice:migration:%')::int AS invoices,
            (SELECT count(*) FROM documents WHERE entity_id = $1 AND kind = 'bill' AND idempotency_key LIKE 'bill:migration:%')::int AS bills,
            (SELECT entry_date::text FROM journal_entries WHERE entity_id = $1 AND idempotency_key = 'migration:opening') AS opening_date,
            (SELECT min(start_date)::text FROM periods WHERE entity_id = $1) AS books_start`,
    [entityId],
  )).rows[0];
  const clearing = (await tx.query(
    `SELECT a.code, a.name, coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint AS net
       FROM accounts a LEFT JOIN journal_lines l ON l.account_id = a.id
      WHERE a.entity_id = $1 AND a.name IN ($2, $3) GROUP BY a.code, a.name`,
    [entityId, CLEARING.invoice.name, CLEARING.bill.name],
  )).rows.filter((x) => x.net !== 0n).map((x) => ({ code: x.code, name: x.name, netMinor: x.net }));
  return {
    source: r.source as Source | null, accountsMapped: r.mapped, contacts: r.contacts, openInvoices: r.invoices, openBills: r.bills,
    openingDate: r.opening_date as string | null, booksStart: r.books_start as string | null, clearing,
  };
}
