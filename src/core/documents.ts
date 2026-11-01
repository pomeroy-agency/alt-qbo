import { createHash, randomUUID } from "node:crypto";
import type { Tx } from "../db/pool.js";
import { appendAudit, canonicalJson } from "./audit.js";
import { LedgerError, translateDbError } from "./errors.js";
import { getEntry, postJournal, reverseEntry, type Actor, type LineInput, type Role } from "./ledger.js";
import { canadaLineTaxes, type CanadaDocTax, type CanadaInvoiceTax, type CanadaLineTax } from "./canada-sales-tax.js";
import { D, parseMoney } from "./money.js";

// Invoices (receivables) and bills (payables). Each document posts its own
// journal entry in the same transaction it is issued in; the database checks
// at commit that the totals match the lines and that the entry carries the
// total to accounts receivable or payable.

export type DocumentKind = "invoice" | "bill";
export type ContactKind = "customer" | "vendor" | "both";
export type DocumentStatus = "open" | "partial" | "overdue" | "paid" | "void";

const CAN_WRITE: Role[] = ["owner", "admin", "bookkeeper", "accountant", "system"];
const CONTROL = { invoice: "accounts_receivable", bill: "accounts_payable" } as const;

function requireWriter(actor: Actor, what: string) {
  if (!CAN_WRITE.includes(actor.role)) throw new LedgerError("FORBIDDEN", `role ${actor.role} cannot ${what}`);
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    translateDbError(err);
  }
}

// --------------------------------------------------------------- contacts

export interface ContactAddress {
  line1: string;
  city: string;
  state: string;
  zip: string;
}

export interface Contact {
  id: string;
  kind: ContactKind;
  name: string;
  email: string | null;
  phone: string | null;
  /** Where the customer takes delivery; decides the sales tax rate. */
  address: ContactAddress | null;
  /** California seller's permit from the customer's resale certificate. */
  resalePermit: string | null;
  /** The buyer's use tax direct payment permit: they report the tax on software themselves (SB 122). */
  directPayPermit: string | null;
  /** Multiple-points-of-use certificate: the share of the buyer's software use that is in California. */
  mpu: { caPercent: string; certificateDate: string } | null;
  /** A vendor that doesn't charge California sales tax: its bills add use tax by default. */
  accrueUseTax: boolean;
}

const CONTACT_COLS = "id, kind, name, email, phone, address_line1, address_city, address_state, address_zip, resale_permit, direct_pay_permit, mpu_ca_percent::text AS mpu_ca_percent, mpu_certificate_date, accrue_use_tax";

function contactOf(r: any): Contact {
  return {
    id: r.id, kind: r.kind, name: r.name, email: r.email, phone: r.phone ?? null,
    address: r.address_line1 ? { line1: r.address_line1, city: r.address_city, state: r.address_state, zip: r.address_zip } : null,
    resalePermit: r.resale_permit,
    directPayPermit: r.direct_pay_permit,
    mpu: r.mpu_ca_percent !== null ? { caPercent: new D(r.mpu_ca_percent).toString(), certificateDate: r.mpu_certificate_date } : null,
    accrueUseTax: r.accrue_use_tax,
  };
}

/** Who can set the tax settings that stop or reduce the tax a customer is charged. */
const CAN_SET_TAX_STATUS: Role[] = ["owner", "accountant", "system"];

interface ContactFields {
  name?: string;
  email?: string | null;
  phone?: string | null;
  /** Checked by cleanAddress in core/sales-tax.ts before it gets here. */
  address?: ContactAddress | null;
  resalePermit?: string | null;
  /** Owners and accountants only. */
  directPayPermit?: string | null;
  /** Owners and accountants only. caPercent is 0 to 100, up to two decimals. */
  mpu?: { caPercent: string; certificateDate: string } | null;
  accrueUseTax?: boolean;
}

function contactColumns(f: ContactFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.name !== undefined) {
    const name = f.name.trim();
    if (!name) throw new LedgerError("INVALID", "a contact needs a name");
    out.name = name;
  }
  if (f.email !== undefined) out.email = f.email?.trim().toLowerCase() || null;
  if (f.phone !== undefined) out.phone = f.phone?.trim().slice(0, 40) || null;
  if (f.address !== undefined) {
    out.address_line1 = f.address?.line1 ?? null;
    out.address_city = f.address?.city ?? null;
    out.address_state = f.address?.state ?? null;
    out.address_zip = f.address?.zip ?? null;
  }
  if (f.resalePermit !== undefined) out.resale_permit = f.resalePermit?.trim().slice(0, 40) || null;
  if (f.directPayPermit !== undefined) out.direct_pay_permit = f.directPayPermit?.trim().slice(0, 40) || null;
  if (f.mpu !== undefined) {
    if (f.mpu && (!/^\d{1,3}(\.\d{1,2})?$/.test(f.mpu.caPercent.trim()) || new D(f.mpu.caPercent.trim()).gt(100))) {
      throw new LedgerError("INVALID", "the California share should be a percentage from 0 to 100, like 60");
    }
    if (f.mpu && !/^\d{4}-\d{2}-\d{2}$/.test(f.mpu.certificateDate)) throw new LedgerError("INVALID", "enter the date on the certificate");
    out.mpu_ca_percent = f.mpu ? new D(f.mpu.caPercent.trim()).toFixed(2) : null;
    out.mpu_certificate_date = f.mpu?.certificateDate ?? null;
  }
  if (f.accrueUseTax !== undefined) out.accrue_use_tax = f.accrueUseTax;
  return out;
}

function requireTaxStatusRole(actor: Actor, f: ContactFields) {
  if ((f.directPayPermit !== undefined || f.mpu !== undefined) && !CAN_SET_TAX_STATUS.includes(actor.role)) {
    throw new LedgerError("FORBIDDEN", "only an owner or accountant can record a direct payment permit or a multiple-points-of-use certificate");
  }
}

export async function createContact(
  tx: Tx,
  input: ContactFields & { orgId: string; entityId: string; kind: ContactKind; name: string; actor: Actor },
): Promise<Contact> {
  requireWriter(input.actor, "add contacts");
  requireTaxStatusRole(input.actor, input);
  const cols = contactColumns({ email: null, ...input });
  const dup = await tx.query("SELECT 1 FROM contacts WHERE entity_id = $1 AND lower(name) = lower($2)", [input.entityId, cols.name]);
  if (dup.rows[0]) throw new LedgerError("INVALID", `there is already a contact named ${cols.name}`);
  const names = Object.keys(cols);
  const { rows } = await run(() => tx.query(
    `INSERT INTO contacts (org_id, entity_id, kind, ${names.join(", ")}) VALUES ($1, $2, $3, ${names.map((_, i) => `$${i + 4}`).join(", ")})
     RETURNING ${CONTACT_COLS}`,
    [input.orgId, input.entityId, input.kind, ...Object.values(cols)],
  ));
  const contact = contactOf(rows[0]);
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "contact.created",
    objectType: "contact", objectId: contact.id, after: contact,
  });
  return contact;
}

/** Changes a contact's details. Past invoices keep the address and tax they were issued with. */
export async function updateContact(
  tx: Tx,
  input: ContactFields & { orgId: string; entityId: string; contactId: string; actor: Actor },
): Promise<Contact> {
  requireWriter(input.actor, "change contacts");
  requireTaxStatusRole(input.actor, input);
  const before = (await tx.query(`SELECT ${CONTACT_COLS} FROM contacts WHERE id = $1 AND entity_id = $2 FOR UPDATE`, [input.contactId, input.entityId])).rows[0];
  if (!before) throw new LedgerError("INVALID", "contact not found");
  const cols = contactColumns(input);
  if (cols.name && (await tx.query("SELECT 1 FROM contacts WHERE entity_id = $1 AND lower(name) = lower($2) AND id <> $3", [input.entityId, cols.name, input.contactId])).rows[0]) {
    throw new LedgerError("INVALID", `there is already a contact named ${cols.name}`);
  }
  const changed = Object.entries(cols).filter(([k, v]) => (before[k] ?? null) !== v);
  if (!changed.length) return contactOf(before);
  const { rows } = await run(() => tx.query(
    `UPDATE contacts SET ${changed.map(([k], i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1 RETURNING ${CONTACT_COLS}`,
    [input.contactId, ...changed.map(([, v]) => v)],
  ));
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "contact.updated", objectType: "contact", objectId: input.contactId,
    before: Object.fromEntries(changed.map(([k]) => [k, before[k]])), after: Object.fromEntries(changed), context: { role: input.actor.role },
  });
  return contactOf(rows[0]);
}

export async function listContacts(tx: Tx, entityId: string): Promise<Contact[]> {
  const { rows } = await tx.query(`SELECT ${CONTACT_COLS} FROM contacts WHERE entity_id = $1 ORDER BY lower(name)`, [entityId]);
  return rows.map(contactOf);
}

// -------------------------------------------------------------- documents

export interface DocumentLineInput {
  /** Account code or system key: revenue for invoices, expense or asset for bills. */
  account: string;
  description?: string;
  /** Decimal string, up to four places ("1", "2.5"). */
  quantity: string;
  /** Major units ("125.00"). */
  unitPrice: string;
  taxable?: boolean;
  /** Kind of sale from the state's sales-tax rule pack ("professional_service", "goods"). */
  taxCategory?: string;
  /** The product or service this line was filled from. */
  itemId?: string;
  /** For software: the first and last day the customer has access, which decide its tax. */
  servicePeriodStart?: string;
  servicePeriodEnd?: string;
  /** Fraction of a taxable line that is taxed ("0.6"), when less than all of it. */
  taxShare?: string;
  /** Why a software line is untaxed or partly taxed. */
  taxExemption?: "direct_pay" | "mpu";
  /** Bills only: the business owes California use tax on this line, at the bill's use tax rate. */
  useTaxable?: boolean;
}

/** An invoice's sales tax, decided before it is issued and frozen on it. See core/sales-tax.ts. */
export interface DocumentTax {
  /** Fraction, up to five decimals ("0.08625"). */
  rate: string;
  source: "none" | "not_taxable" | "resale" | "out_of_state" | "lookup" | "manual" | "direct_pay" | "canada";
  jurisdiction?: string | null;
  address?: string | null;
  note?: string | null;
  /** Canadian invoices: each tax and the lines it applies to (source "canada"). See core/canada-sales-tax.ts. */
  canada?: CanadaInvoiceTax;
}

/** A bill's use tax: what the business owes the state on purchases the vendor didn't tax. See core/sales-tax.ts. */
export interface DocumentUseTax {
  /** Fraction, up to five decimals ("0.08625"). */
  rate: string;
  source: "not_taxable" | "lookup" | "manual";
  jurisdiction?: string | null;
  address?: string | null;
  note?: string | null;
}

export interface IssueDocumentInput {
  orgId: string;
  entityId: string;
  kind: DocumentKind;
  contactId: string;
  issueDate: string;
  dueDate?: string;
  memo?: string;
  /** Vendor's invoice number, for bills. */
  reference?: string;
  /** Invoices only. */
  tax?: DocumentTax;
  /** Bills only. */
  useTax?: DocumentUseTax;
  lines: DocumentLineInput[];
  idempotencyKey: string;
  actor: Actor;
}

interface PricedLine {
  accountId: string;
  accountCode: string;
  description: string;
  quantity: string;
  unitPriceMinor: bigint;
  amountMinor: bigint;
  taxable: boolean;
  taxMinor: bigint;
  taxCategory: string | null;
  itemId: string | null;
  servicePeriodStart: string | null;
  servicePeriodEnd: string | null;
  taxableMinor: bigint | null;
  taxExemption: string | null;
  useTaxable: boolean;
  useTaxMinor: bigint;
  /** Canadian invoices: the line's own combined rate, and its taxes. */
  lineRate: string | null;
  caTax: CanadaLineTax | null;
  caTaxMinor: Partial<Record<string, bigint>>;
}

/**
 * Line amount = quantity x unit price; tax = rate on the taxed part of each
 * taxable line (all of it, or its share). All rounded half-up to the cent.
 */
export function priceLine(quantity: string, unitPriceMinor: bigint, taxable: boolean, taxRate: string, taxShare?: string) {
  const round = (d: InstanceType<typeof D>) => BigInt(d.toDecimalPlaces(0, D.ROUND_HALF_UP).toFixed(0));
  const amountMinor = round(new D(quantity).mul(unitPriceMinor.toString()));
  const taxableMinor = taxable && taxShare !== undefined ? round(new D(amountMinor.toString()).mul(taxShare)) : null;
  const taxMinor = taxable ? round(new D((taxableMinor ?? amountMinor).toString()).mul(taxRate)) : 0n;
  return { amountMinor, taxableMinor, taxMinor };
}

function requestHash(input: IssueDocumentInput): string {
  return createHash("sha256").update(canonicalJson({
    kind: input.kind, contactId: input.contactId, issueDate: input.issueDate, dueDate: input.dueDate ?? null,
    memo: input.memo ?? "", reference: input.reference ?? null, tax: input.tax ?? null, lines: input.lines,
    // Only when present, so bills recorded before use tax keep their hashes.
    ...(input.useTax ? { useTax: input.useTax } : {}),
  })).digest("hex");
}

/**
 * Issues an invoice or records a bill, and posts it: an invoice debits
 * receivables and credits revenue and sales tax; a bill debits its expense
 * or asset lines and credits payables. A bill's use tax is added to the cost
 * of its lines and credited to sales tax payable, not to the vendor.
 */
export async function issueDocument(tx: Tx, input: IssueDocumentInput): Promise<DocumentDetail> {
  requireWriter(input.actor, `create ${input.kind}s`);
  if (!input.idempotencyKey) throw new LedgerError("INVALID", "idempotencyKey is required");
  const key = `${input.kind}:${input.idempotencyKey}`;
  const hash = requestHash(input);
  const prior = await tx.query("SELECT id, memo FROM documents WHERE entity_id = $1 AND idempotency_key = $2", [input.entityId, key]);
  if (prior.rows[0]) {
    const doc = await getDocument(tx, prior.rows[0].id);
    if (doc.requestHash !== hash) {
      throw new LedgerError("IDEMPOTENCY_CONFLICT", `idempotency key ${input.idempotencyKey} was already used for a different ${input.kind}`);
    }
    return { ...doc, replayed: true };
  }

  if (input.kind === "bill" && input.tax && input.tax.source !== "none") throw new LedgerError("INVALID", "bills don't charge sales tax");
  const tax: DocumentTax = input.kind === "invoice" && input.tax ? input.tax : { rate: "0", source: "none" };
  if (!/^(0(\.\d{1,5})?|1(\.0{1,5})?)$/.test(tax.rate)) throw new LedgerError("INVALID", "the tax rate must be a fraction between 0 and 1, up to five decimals");
  const canada = tax.source === "canada" ? tax.canada : undefined;
  if (tax.source === "canada" && (!canada || canada.lines.length !== input.lines.length)) throw new LedgerError("INVALID", "the Canadian taxes don't match the invoice lines");
  if (tax.source !== "canada" && tax.canada) throw new LedgerError("INVALID", "Canadian taxes need tax source canada");
  const taxRate = new D(tax.rate).toFixed(5);
  if (input.kind === "invoice" && input.useTax) throw new LedgerError("INVALID", "invoices don't accrue use tax");
  const useTax = input.kind === "bill" ? input.useTax : undefined;
  if (useTax && !/^(0(\.\d{1,5})?|1(\.0{1,5})?)$/.test(useTax.rate)) throw new LedgerError("INVALID", "the use tax rate must be a fraction between 0 and 1, up to five decimals");
  const useTaxRate = new D(useTax && useTax.source !== "not_taxable" ? useTax.rate : "0").toFixed(5);
  if (!input.lines.length) throw new LedgerError("INVALID", `a ${input.kind} needs at least one line`);
  if (input.lines.length > 200) throw new LedgerError("INVALID", `a ${input.kind} can have at most 200 lines`);
  const dueDate = input.dueDate || input.issueDate;
  if (dueDate < input.issueDate) throw new LedgerError("INVALID", "the due date is before the issue date");

  const ent = await tx.query("SELECT functional_currency FROM entities WHERE id = $1", [input.entityId]);
  if (!ent.rows[0]) throw new LedgerError("INVALID", `entity ${input.entityId} not found`);
  const currency: string = ent.rows[0].functional_currency.trim();
  const contact = await tx.query("SELECT id, name, kind FROM contacts WHERE id = $1 AND entity_id = $2", [input.contactId, input.entityId]);
  if (!contact.rows[0]) throw new LedgerError("INVALID", `choose a ${input.kind === "invoice" ? "customer" : "vendor"}`);

  const accts = await tx.query("SELECT id, code, system_key FROM accounts WHERE entity_id = $1", [input.entityId]);
  const byKey = new Map<string, { id: string; code: string }>();
  for (const r of accts.rows) {
    byKey.set(r.code, r);
    if (r.system_key) byKey.set(r.system_key, r);
  }

  const lines: PricedLine[] = input.lines.map((l, i) => {
    const a = byKey.get(l.account);
    if (!a) throw new LedgerError("UNKNOWN_ACCOUNT", `line ${i + 1}: no account ${l.account} in this entity`);
    if (!/^\d+(\.\d{1,4})?$/.test(l.quantity) || new D(l.quantity).lte(0)) {
      throw new LedgerError("INVALID", `line ${i + 1}: quantity must be more than zero, up to four decimals`);
    }
    let unitPriceMinor: bigint;
    try {
      unitPriceMinor = parseMoney(l.unitPrice, currency).minor;
    } catch {
      throw new LedgerError("INVALID", `line ${i + 1}: price must be an amount like 125.00`);
    }
    if (unitPriceMinor < 0n) throw new LedgerError("INVALID", `line ${i + 1}: price cannot be negative`);
    const ca = canada?.lines[i];
    const taxable = ca ? ca.codes.length > 0 : input.kind === "invoice" && Boolean(l.taxable);
    const invoice = input.kind === "invoice";
    // A bill keeps its lines' kinds and access dates only when they decided its use tax.
    const keepKind = invoice || Boolean(useTax);
    const useTaxable = Boolean(useTax) && useTax!.source !== "not_taxable" && Boolean(l.useTaxable);
    if (l.taxShare !== undefined && !(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/.test(l.taxShare))) throw new LedgerError("INVALID", `line ${i + 1}: the taxed share must be a fraction between 0 and 1`);
    if (l.servicePeriodEnd && (!l.servicePeriodStart || l.servicePeriodEnd < l.servicePeriodStart)) {
      throw new LedgerError("INVALID", `line ${i + 1}: the access period ends before it starts`);
    }
    const priced = priceLine(l.quantity, unitPriceMinor, taxable, taxRate, taxable && !ca ? l.taxShare : undefined);
    let lineRate: string | null = null;
    let caTax: CanadaLineTax | null = null;
    let caTaxMinor: Partial<Record<string, bigint>> = {};
    if (ca) {
      caTaxMinor = canadaLineTaxes(priced.amountMinor, ca.codes, canada!.taxes);
      lineRate = ca.codes.reduce((s, c) => s.add(canada!.taxes.find((t) => t.code === c)!.rate), new D(0)).toFixed(5);
      priced.taxMinor = Object.values(caTaxMinor).reduce<bigint>((s, v) => s + (v ?? 0n), 0n);
      priced.taxableMinor = null;
      caTax = { supply: ca.supply, taxes: Object.fromEntries(Object.entries(caTaxMinor).map(([k, v]) => [k, v!.toString()])) };
    }
    return {
      accountId: a.id, accountCode: a.code, description: (l.description ?? "").slice(0, 300),
      quantity: new D(l.quantity).toFixed(4), unitPriceMinor, taxable,
      taxCategory: keepKind ? l.taxCategory ?? null : null, itemId: l.itemId ?? null,
      servicePeriodStart: keepKind ? l.servicePeriodStart ?? null : null, servicePeriodEnd: keepKind ? l.servicePeriodEnd ?? null : null,
      taxExemption: invoice && !ca ? l.taxExemption ?? null : null,
      ...priced,
      useTaxable,
      useTaxMinor: priceLine(l.quantity, unitPriceMinor, useTaxable, useTaxRate).taxMinor,
      lineRate, caTax, caTaxMinor,
    };
  });
  // A Canadian invoice's own rate is its highest line rate; each line keeps its own.
  const docRate = canada ? lines.reduce((m, l) => (new D(l.lineRate!).gt(m) ? l.lineRate! : m), "0.00000") : taxRate;
  let caDoc: CanadaDocTax | null = null;
  if (canada) {
    const sum = (f: (l: PricedLine) => bigint) => lines.reduce((s, l) => s + f(l), 0n).toString();
    caDoc = {
      place: canada.place,
      supplies: {
        taxable: sum((l) => (l.caTax!.supply === "taxable" ? l.amountMinor : 0n)),
        zeroRated: sum((l) => (l.caTax!.supply === "zero_rated" ? l.amountMinor : 0n)),
        exempt: sum((l) => (l.caTax!.supply === "exempt" ? l.amountMinor : 0n)),
      },
      taxes: canada.taxes.map((t) => ({
        ...t,
        baseMinor: sum((l) => (l.caTaxMinor[t.code] !== undefined ? l.amountMinor : 0n)),
        amountMinor: sum((l) => l.caTaxMinor[t.code] ?? 0n),
      })),
    };
  }
  const subtotal = lines.reduce((s, l) => s + l.amountMinor, 0n);
  const taxTotal = lines.reduce((s, l) => s + l.taxMinor, 0n);
  const useTaxTotal = lines.reduce((s, l) => s + l.useTaxMinor, 0n);
  if (subtotal + taxTotal <= 0n) throw new LedgerError("INVALID", `the ${input.kind} total must be more than zero`);

  const counter = input.kind === "invoice" ? "next_invoice_number" : "next_bill_number";
  const num = await tx.query(`UPDATE entities SET ${counter} = ${counter} + 1 WHERE id = $1 RETURNING ${counter} - 1 AS n`, [input.entityId]);
  const number = `${input.kind === "invoice" ? "INV" : "BILL"}-${num.rows[0].n}`;

  const docId = randomUUID();
  await run(() => tx.query(
    `INSERT INTO documents (id, org_id, entity_id, kind, number, reference, contact_id, issue_date, due_date, memo,
        currency, tax_rate, tax_source, tax_jurisdiction, tax_address, tax_note, subtotal_minor, tax_minor, total_minor,
        idempotency_key, created_by, use_tax_rate, use_tax_minor, use_tax_source, use_tax_jurisdiction, use_tax_address, use_tax_note, ca_tax)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)`,
    [docId, input.orgId, input.entityId, input.kind, number, input.reference?.trim() || null, input.contactId,
     input.issueDate, dueDate, (input.memo ?? "").slice(0, 300), currency, docRate, tax.source,
     tax.jurisdiction?.slice(0, 200) || null, tax.address || null, tax.note?.slice(0, 300) || null,
     subtotal, taxTotal, subtotal + taxTotal, key, input.actor.id,
     useTaxRate, useTaxTotal, useTax?.source ?? "none", useTax?.jurisdiction?.slice(0, 200) || null, useTax?.address || null, useTax?.note?.slice(0, 300) || null,
     caDoc ? JSON.stringify(caDoc) : null],
  ));
  for (const [i, l] of lines.entries()) {
    await run(() => tx.query(
      `INSERT INTO document_lines (org_id, entity_id, document_id, line_no, description, account_id, quantity,
          unit_price_minor, amount_minor, taxable, tax_rate, tax_minor, tax_category, item_id,
          service_period_start, service_period_end, taxable_minor, tax_exemption, use_taxable, use_tax_rate, use_tax_minor, ca_tax)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
      [input.orgId, input.entityId, docId, i + 1, l.description, l.accountId, l.quantity, l.unitPriceMinor,
       l.amountMinor, l.taxable, l.lineRate ?? taxRate, l.taxMinor, l.taxCategory, l.itemId,
       l.servicePeriodStart, l.servicePeriodEnd, l.taxableMinor, l.taxExemption, l.useTaxable, useTaxRate, l.useTaxMinor,
       l.caTax ? JSON.stringify(l.caTax) : null],
    ));
  }

  // One journal line per account, so the entry reads like the document. Use
  // tax is part of what a purchase cost, so it goes with its line's account.
  const perAccount = new Map<string, bigint>();
  for (const l of lines) perAccount.set(l.accountCode, (perAccount.get(l.accountCode) ?? 0n) + l.amountMinor + l.useTaxMinor);
  const side = input.kind === "invoice" ? "credit" : "debit";
  const jl: LineInput[] = [...perAccount].filter(([, v]) => v > 0n).map(([account, v]) => ({ account, [side]: v, description: number }));
  if (caDoc) {
    // Each Canadian tax to its own account: GST/HST, QST and PST are owed to different governments.
    for (const t of caDoc.taxes) {
      const amount = BigInt(t.amountMinor);
      if (amount > 0n) jl.push({ account: byKey.has(t.account) ? t.account : "sales_tax_payable", credit: amount, description: `${number} ${t.label}` });
    }
  } else if (taxTotal > 0n) jl.push({ account: "sales_tax_payable", credit: taxTotal, description: `${number} sales tax` });
  if (useTaxTotal > 0n) jl.push({ account: "sales_tax_payable", credit: useTaxTotal, description: `${number} use tax` });
  if (input.kind === "invoice") jl.unshift({ account: CONTROL.invoice, debit: subtotal + taxTotal, description: number });
  else jl.push({ account: CONTROL.bill, credit: subtotal + taxTotal, description: number });

  const entry = await postJournal(tx, {
    orgId: input.orgId, entityId: input.entityId, date: input.issueDate,
    memo: `${number} · ${contact.rows[0].name}${input.memo ? ` · ${input.memo}` : ""}`.slice(0, 300),
    sourceType: input.kind, sourceId: docId, idempotencyKey: `document:${docId}`, actor: input.actor, lines: jl,
  });
  await run(() => tx.query("UPDATE documents SET entry_id = $2 WHERE id = $1", [docId, entry.id]));
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id,
    action: input.kind === "invoice" ? "invoice.issued" : "bill.recorded",
    objectType: input.kind, objectId: docId,
    after: {
      number, contactId: input.contactId, issueDate: input.issueDate, dueDate, subtotal, tax: taxTotal, total: subtotal + taxTotal, taxRate: docRate, entryId: entry.id,
      ...(caDoc ? { caTax: caDoc.taxes.map((t) => ({ code: t.code, amount: t.amountMinor })) } : {}),
      ...(useTax ? { useTax: useTaxTotal, useTaxRate } : {}),
    },
    context: {
      role: input.actor.role, requestHash: hash, taxSource: tax.source, ...(tax.note ? { taxNote: tax.note } : {}),
      ...(useTax ? { useTaxSource: useTax.source, ...(useTax.note ? { useTaxNote: useTax.note } : {}) } : {}),
    },
  });
  return getDocument(tx, docId, hash);
}

export interface DocumentSummary {
  id: string;
  kind: DocumentKind;
  number: string;
  reference: string | null;
  contactId: string;
  contactName: string;
  issueDate: string;
  dueDate: string;
  memo: string;
  currency: string;
  /** Fraction with five decimals ("0.08625"). */
  taxRate: string;
  taxSource: string;
  taxJurisdiction: string | null;
  taxAddress: string | null;
  taxNote: string | null;
  /** Bills: California use tax the business owes on this purchase, on top of what the vendor is paid. */
  useTaxRate: string;
  useTaxMinor: bigint;
  useTaxSource: string;
  useTaxJurisdiction: string | null;
  useTaxAddress: string | null;
  useTaxNote: string | null;
  /** Canadian invoices: each tax, its base and amount, and the sales by GST/HST treatment. */
  caTax: CanadaDocTax | null;
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  paidMinor: bigint;
  dueMinor: bigint;
  status: DocumentStatus;
  entryId: string;
  voidEntryId: string | null;
}

export interface DocumentDetail extends DocumentSummary {
  voidDate: string | null;
  voidReason: string | null;
  createdBy: string;
  lines: { lineNo: number; description: string; accountCode: string; accountName: string; quantity: string;
    unitPriceMinor: bigint; amountMinor: bigint; taxable: boolean; taxMinor: bigint; taxCategory: string | null; itemId: string | null;
    servicePeriodStart: string | null; servicePeriodEnd: string | null; taxableMinor: bigint | null; taxExemption: string | null;
    useTaxable: boolean; useTaxMinor: bigint; taxRate: string; caTax: CanadaLineTax | null }[];
  payments: { id: string; date: string; amountMinor: bigint; bankAccountCode: string; entryId: string; createdBy: string }[];
  requestHash?: string;
  replayed: boolean;
}

const SUMMARY_SQL = `
  SELECT d.id, d.kind, d.number, d.reference, d.contact_id, c.name AS contact_name, d.issue_date, d.due_date, d.memo,
         d.currency, d.tax_rate::text AS tax_rate, d.tax_source, d.tax_jurisdiction, d.tax_address, d.tax_note,
         d.use_tax_rate::text AS use_tax_rate, d.use_tax_minor, d.use_tax_source, d.use_tax_jurisdiction, d.use_tax_address, d.use_tax_note, d.ca_tax, d.subtotal_minor, d.tax_minor, d.total_minor, d.status, d.entry_id, d.void_entry_id,
         d.void_date, d.void_reason, d.created_by,
         coalesce((SELECT sum(p.amount_minor) FROM document_payments p
                    WHERE p.document_id = d.id AND p.payment_date <= $2::date), 0)::bigint AS paid
    FROM documents d JOIN contacts c ON c.id = d.contact_id`;

function statusOf(r: any, asOf: string): DocumentStatus {
  if (r.status === "void" && r.void_date <= asOf) return "void";
  const due = (r.total_minor as bigint) - (r.paid as bigint);
  if (due <= 0n) return "paid";
  if (r.due_date < asOf) return "overdue";
  return r.paid > 0n ? "partial" : "open";
}

function summary(r: any, asOf: string): DocumentSummary {
  return {
    id: r.id, kind: r.kind, number: r.number, reference: r.reference, contactId: r.contact_id, contactName: r.contact_name,
    issueDate: r.issue_date, dueDate: r.due_date, memo: r.memo, currency: r.currency.trim(),
    taxRate: r.tax_rate, taxSource: r.tax_source, taxJurisdiction: r.tax_jurisdiction, taxAddress: r.tax_address, taxNote: r.tax_note,
    useTaxRate: r.use_tax_rate, useTaxMinor: r.use_tax_minor, useTaxSource: r.use_tax_source,
    useTaxJurisdiction: r.use_tax_jurisdiction, useTaxAddress: r.use_tax_address, useTaxNote: r.use_tax_note, caTax: r.ca_tax ?? null,
    subtotalMinor: r.subtotal_minor, taxMinor: r.tax_minor, totalMinor: r.total_minor, paidMinor: r.paid,
    dueMinor: r.status === "void" && r.void_date <= asOf ? 0n : (r.total_minor as bigint) - (r.paid as bigint),
    status: statusOf(r, asOf), entryId: r.entry_id, voidEntryId: r.void_entry_id,
  };
}

// Today where the businesses are, not UTC: in a California evening UTC is
// already tomorrow, which made an invoice due today show as overdue.
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

export async function listDocuments(tx: Tx, entityId: string, kind: DocumentKind, asOf = today()): Promise<DocumentSummary[]> {
  const { rows } = await tx.query(
    `${SUMMARY_SQL} WHERE d.entity_id = $1 AND d.kind = $3 AND d.issue_date <= $2::date
      ORDER BY d.issue_date DESC, d.number DESC LIMIT 500`,
    [entityId, asOf, kind],
  );
  return rows.map((r) => summary(r, asOf));
}

export async function getDocument(tx: Tx, documentId: string, requestHashHint?: string): Promise<DocumentDetail> {
  const asOf = "9999-12-31";
  const { rows } = await tx.query(`${SUMMARY_SQL} WHERE d.id = $1`, [documentId, asOf]);
  const r = rows[0];
  if (!r) throw new LedgerError("INVALID", `document ${documentId} not found`);
  const lines = await tx.query(
    `SELECT l.line_no, l.description, a.code, a.name, l.quantity::text AS quantity, l.unit_price_minor, l.amount_minor,
            l.taxable, l.tax_minor, l.tax_category, l.item_id, l.service_period_start, l.service_period_end, l.taxable_minor, l.tax_exemption,
            l.use_taxable, l.use_tax_minor, l.tax_rate::text AS tax_rate, l.ca_tax
       FROM document_lines l JOIN accounts a ON a.id = l.account_id WHERE l.document_id = $1 ORDER BY l.line_no`,
    [documentId],
  );
  const pays = await tx.query(
    `SELECT p.id, p.payment_date, p.amount_minor, a.code, p.entry_id, p.created_by
       FROM document_payments p JOIN accounts a ON a.id = p.bank_account_id WHERE p.document_id = $1 ORDER BY p.payment_date, p.created_at`,
    [documentId],
  );
  let requestHash = requestHashHint;
  if (!requestHash) {
    const ev = await tx.query(
      "SELECT context->>'requestHash' AS h FROM audit_events WHERE object_type = $1 AND object_id = $2 ORDER BY seq LIMIT 1",
      [r.kind, documentId],
    );
    requestHash = ev.rows[0]?.h;
  }
  return {
    ...summary(r, today()),
    voidDate: r.void_date, voidReason: r.void_reason, createdBy: r.created_by,
    lines: lines.rows.map((l) => ({
      lineNo: l.line_no, description: l.description, accountCode: l.code, accountName: l.name,
      quantity: new D(l.quantity).toString(), unitPriceMinor: l.unit_price_minor, amountMinor: l.amount_minor,
      taxable: l.taxable, taxMinor: l.tax_minor, taxCategory: l.tax_category, itemId: l.item_id,
      servicePeriodStart: l.service_period_start, servicePeriodEnd: l.service_period_end, taxableMinor: l.taxable_minor, taxExemption: l.tax_exemption,
      useTaxable: l.use_taxable, useTaxMinor: l.use_tax_minor, taxRate: l.tax_rate, caTax: l.ca_tax ?? null,
    })),
    payments: pays.rows.map((p) => ({
      id: p.id, date: p.payment_date, amountMinor: p.amount_minor, bankAccountCode: p.code, entryId: p.entry_id, createdBy: p.created_by,
    })),
    requestHash,
    replayed: false,
  };
}

// --------------------------------------------------------------- payments

/**
 * Records money received against an invoice or paid against a bill, posting
 * bank against receivables or payables. The database refuses a payment
 * above the amount still due.
 */
export async function recordPayment(
  tx: Tx,
  input: {
    orgId: string; entityId: string; documentId: string; date: string; amount: string | bigint;
    /** Bank account code; defaults to the operating account. */
    bankAccount?: string; idempotencyKey: string; actor: Actor;
  },
): Promise<DocumentDetail> {
  requireWriter(input.actor, "record payments");
  if (!input.idempotencyKey) throw new LedgerError("INVALID", "idempotencyKey is required");
  const key = `payment:${input.idempotencyKey}`;
  const prior = await tx.query("SELECT document_id FROM document_payments WHERE entity_id = $1 AND idempotency_key = $2", [input.entityId, key]);
  if (prior.rows[0]) {
    if (prior.rows[0].document_id !== input.documentId) {
      throw new LedgerError("IDEMPOTENCY_CONFLICT", `idempotency key ${input.idempotencyKey} was already used for another payment`);
    }
    return { ...(await getDocument(tx, input.documentId)), replayed: true };
  }

  const d = await tx.query(
    "SELECT id, kind, number, status, currency, total_minor, issue_date FROM documents WHERE id = $1 AND entity_id = $2 FOR UPDATE",
    [input.documentId, input.entityId],
  );
  const doc = d.rows[0];
  if (!doc) throw new LedgerError("INVALID", "document not found");
  if (doc.status === "void") throw new LedgerError("INVALID", `${doc.number} is void`);
  if (input.date < doc.issue_date) throw new LedgerError("INVALID", `the payment date is before the ${doc.kind} date`);
  const currency = doc.currency.trim();
  let amount: bigint;
  try {
    amount = typeof input.amount === "bigint" ? input.amount : parseMoney(input.amount, currency).minor;
  } catch {
    throw new LedgerError("INVALID", "the payment must be an amount like 125.00");
  }
  if (amount <= 0n) throw new LedgerError("INVALID", "enter a payment amount");
  const paid = (await tx.query("SELECT coalesce(sum(amount_minor), 0)::bigint AS s FROM document_payments WHERE document_id = $1", [doc.id])).rows[0].s as bigint;
  const due = (doc.total_minor as bigint) - paid;
  if (amount > due) throw new LedgerError("OVERPAID", `the payment is more than the ${new D(due.toString()).div(100).toFixed(2)} still due on ${doc.number}`);

  const bankKey = input.bankAccount || "cash_operating";
  const bank = await tx.query(
    "SELECT id, code, subtype FROM accounts WHERE entity_id = $1 AND (code = $2 OR system_key = $2)",
    [input.entityId, bankKey],
  );
  if (!bank.rows[0] || bank.rows[0].subtype !== "bank") throw new LedgerError("INVALID", `${bankKey} is not a bank account`);

  const paymentId = randomUUID();
  const control = CONTROL[doc.kind as DocumentKind];
  const lines: LineInput[] = doc.kind === "invoice"
    ? [{ account: bank.rows[0].code, debit: amount, description: doc.number }, { account: control, credit: amount, description: doc.number }]
    : [{ account: control, debit: amount, description: doc.number }, { account: bank.rows[0].code, credit: amount, description: doc.number }];
  const entry = await postJournal(tx, {
    orgId: input.orgId, entityId: input.entityId, date: input.date,
    memo: `Payment ${doc.kind === "invoice" ? "received" : "made"} · ${doc.number}`,
    sourceType: "payment", sourceId: paymentId, idempotencyKey: `payment:${paymentId}`, actor: input.actor, lines,
  });
  await run(() => tx.query(
    `INSERT INTO document_payments (id, org_id, entity_id, document_id, payment_date, amount_minor, bank_account_id,
        entry_id, idempotency_key, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [paymentId, input.orgId, input.entityId, doc.id, input.date, amount, bank.rows[0].id, entry.id, key, input.actor.id],
  ));
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "payment.recorded",
    objectType: "payment", objectId: paymentId,
    after: { documentId: doc.id, number: doc.number, date: input.date, amount, bankAccount: bank.rows[0].code, entryId: entry.id },
    context: { role: input.actor.role },
  });
  return getDocument(tx, doc.id);
}

// ------------------------------------------------------------------- void

/** Voids an unpaid document by reversing its entry. The document and its lines stay on file. */
export async function voidDocument(
  tx: Tx,
  input: { orgId: string; entityId: string; documentId: string; date: string; reason: string; actor: Actor },
): Promise<DocumentDetail> {
  requireWriter(input.actor, "void documents");
  if (!input.reason.trim()) throw new LedgerError("INVALID", "a void needs a reason");
  const d = await tx.query(
    "SELECT id, kind, number, status, entry_id, issue_date FROM documents WHERE id = $1 AND entity_id = $2 FOR UPDATE",
    [input.documentId, input.entityId],
  );
  const doc = d.rows[0];
  if (!doc) throw new LedgerError("INVALID", "document not found");
  if (doc.status === "void") throw new LedgerError("INVALID", `${doc.number} is already void`);
  if (input.date < doc.issue_date) throw new LedgerError("INVALID", `the void date is before the ${doc.kind} date`);
  const pays = await tx.query("SELECT 1 FROM document_payments WHERE document_id = $1 LIMIT 1", [doc.id]);
  if (pays.rows[0]) throw new LedgerError("INVALID", `${doc.number} has payments recorded, so it cannot be voided`);
  const original = await getEntry(tx, doc.entry_id);
  const reversal = await reverseEntry(tx, {
    orgId: input.orgId, entryId: original.id, date: input.date, reason: `${doc.number} voided: ${input.reason.trim()}`, actor: input.actor,
  });
  await run(() => tx.query(
    "UPDATE documents SET status = 'void', void_entry_id = $2, void_date = $3, void_reason = $4 WHERE id = $1",
    [doc.id, reversal.id, input.date, input.reason.trim().slice(0, 300)],
  ));
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: `${doc.kind}.voided`,
    objectType: doc.kind, objectId: doc.id, before: { status: "issued" }, after: { status: "void", reversalEntryId: reversal.id },
    context: { role: input.actor.role, reason: input.reason.trim() },
  });
  return getDocument(tx, doc.id);
}

// ------------------------------------------------------------------ aging

export type AgingBucket = "current" | "d1_30" | "d31_60" | "d61_90" | "over_90";

export interface Aging {
  kind: DocumentKind;
  asOf: string;
  buckets: Record<AgingBucket, bigint>;
  totalMinor: bigint;
  rows: (DocumentSummary & { daysPastDue: number; bucket: AgingBucket })[];
}

/** Receivables or payables still open on a date, by days past due. */
export async function aging(tx: Tx, entityId: string, kind: DocumentKind, asOf = today()): Promise<Aging> {
  const docs = await listDocuments(tx, entityId, kind, asOf);
  const buckets: Record<AgingBucket, bigint> = { current: 0n, d1_30: 0n, d31_60: 0n, d61_90: 0n, over_90: 0n };
  const rows: Aging["rows"] = [];
  for (const d of docs) {
    if (d.dueMinor <= 0n) continue;
    const days = Math.round((Date.parse(asOf) - Date.parse(d.dueDate)) / 86_400_000);
    const bucket: AgingBucket = days <= 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "over_90";
    buckets[bucket] += d.dueMinor;
    rows.push({ ...d, daysPastDue: Math.max(0, days), bucket });
  }
  rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return { kind, asOf, buckets, totalMinor: Object.values(buckets).reduce((s, v) => s + v, 0n), rows };
}
