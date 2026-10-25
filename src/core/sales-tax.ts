import type { Tx } from "../db/pool.js";
import { latestSalesTaxRules, salesTaxRules, type SalesTaxRulePack } from "../rules/sales-tax/us-ca-2026.js";
import { appendAudit } from "./audit.js";
import { LedgerError, translateDbError } from "./errors.js";
import { issueDocument, type DocumentDetail, type DocumentLineInput, type DocumentTax, type IssueDocumentInput } from "./documents.js";
import type { Actor, Role } from "./ledger.js";
import { D, parseMoney } from "./money.js";

// Automatic sales tax. Whether a line is taxable comes from its category in
// the state's rule pack; the rate comes from the delivery address (looked up
// with the CDTFA) unless the sale is exempt. The decision is frozen on the
// invoice, so later rate changes never touch past invoices.

export interface Address {
  line1: string;
  city: string;
  state: string;
  zip: string;
}

/** Combined state and district rate for an address, as a fraction ("0.08625"). */
export type RateLookup = (address: Address) => Promise<{ rate: string; jurisdiction: string; matchedAddress?: string }>;

export type TaxSource = DocumentTax["source"];

export interface TaxDecision {
  /** Fraction with five decimals ("0.08625"). */
  rate: string;
  source: TaxSource;
  jurisdiction: string | null;
  address: string | null;
  note: string | null;
  /** Whether each line, in order, is taxable under the rule pack. */
  taxable: boolean[];
  /** Rule pack used, as "id@version". */
  rules: string | null;
}

const CAN_SET_RATE: Role[] = ["owner", "accountant", "system"];

export const formatAddress = (a: Address) => `${a.line1}, ${a.city}, ${a.state} ${a.zip}`;

function addressOf(r: any): Address | null {
  if (!r?.address_line1 || !r.address_city || !r.address_state || !r.address_zip) return null;
  return { line1: r.address_line1, city: r.address_city, state: r.address_state, zip: r.address_zip };
}

/** Checks and tidies an address typed by a person. All four parts, or none. */
export function cleanAddress(a: Partial<Record<keyof Address, unknown>> | null | undefined): Address | null {
  const v = (k: keyof Address) => (typeof a?.[k] === "string" ? (a[k] as string).trim() : "");
  const out = { line1: v("line1"), city: v("city"), state: v("state").toUpperCase(), zip: v("zip") };
  if (!out.line1 && !out.city && !out.zip) return null;
  if (!out.line1 || !out.city || !out.zip) throw new LedgerError("INVALID", "an address needs a street, a city and a ZIP code");
  if (!out.state) out.state = "CA";
  if (!/^[A-Z]{2}$/.test(out.state)) throw new LedgerError("INVALID", "the state should be two letters, like CA");
  if (!/^\d{5}(-\d{4})?$/.test(out.zip)) throw new LedgerError("INVALID", "the ZIP code should look like 94103 or 94103-1234");
  if (out.line1.length > 200 || out.city.length > 100) throw new LedgerError("INVALID", "that address is too long");
  return out;
}

export function rulesFor(region: string | null, date: string): SalesTaxRulePack {
  const pack = salesTaxRules(region, date);
  if (!pack) throw new LedgerError("INVALID", `Alt-QBO has no sales tax rules for ${region ?? "this place"} on ${date} yet`);
  return pack;
}

/** The kinds of sale to choose from today, falling back to the newest pack for the state. */
export function currentCategories(region: string | null, today = new Date().toISOString().slice(0, 10)) {
  const pack = salesTaxRules(region, today) ?? latestSalesTaxRules(region);
  if (!pack) return [];
  return Object.entries(pack.categories).map(([id, c]) => ({ id, label: c.label, help: c.help, taxable: c.taxable }));
}

/** One line a person can read: why this invoice has the tax it has. */
export function explainTax(t: Pick<TaxDecision, "rate" | "source" | "jurisdiction" | "address" | "note">): string {
  const pct = `${new D(t.rate).mul(100).toFixed(3).replace(/\.?0+$/, "")}%`;
  switch (t.source) {
    case "not_taxable": return "No sales tax: nothing on this invoice is taxable in California.";
    case "resale": return `No sales tax: ${t.note ?? "sale for resale"}.`;
    case "out_of_state": return `No sales tax: delivered outside California${t.address ? ` (${t.address})` : ""}.`;
    case "lookup": return `Sales tax ${pct} on taxable lines, the rate for ${t.jurisdiction}${t.address ? ` (${t.address})` : ""}.`;
    case "manual": return `Sales tax ${pct}, set by hand: ${t.note}.`;
    default: return "No sales tax.";
  }
}

/**
 * Decides an invoice's sales tax. In order: an accountant's rate, if given;
 * nothing taxable; a resale certificate on file; delivery outside the state;
 * otherwise the looked-up rate for the customer's address, or the business's
 * own address when the customer has none.
 */
export async function decideSalesTax(
  tx: Tx,
  input: {
    entityId: string; contactId: string; date: string; categories: string[];
    lookup?: RateLookup;
    /** Set by an owner or accountant, with a reason, when the lookup can't be used. Percent, like "8.625". */
    manual?: { ratePercent: string; reason: string; actor: Actor };
  },
): Promise<TaxDecision> {
  const ent = (await tx.query("SELECT region, address_line1, address_city, address_state, address_zip FROM entities WHERE id = $1", [input.entityId])).rows[0];
  if (!ent) throw new LedgerError("INVALID", "entity not found");
  const pack = rulesFor(ent.region, input.date);
  const taxable = input.categories.map((c, i) => {
    const cat = pack.categories[c];
    if (!cat) throw new LedgerError("INVALID", `line ${i + 1}: choose what kind of sale this is`);
    return cat.taxable;
  });
  const rules = `${pack.id}@${pack.version}`;
  const contact = (await tx.query(
    "SELECT name, resale_permit, address_line1, address_city, address_state, address_zip FROM contacts WHERE id = $1 AND entity_id = $2",
    [input.contactId, input.entityId],
  )).rows[0];
  if (!contact) throw new LedgerError("INVALID", "choose a customer");
  const delivery = addressOf(contact) ?? addressOf(ent);
  const decision = (source: TaxSource, rate = "0.00000", extra: Partial<TaxDecision> = {}): TaxDecision =>
    ({ rate, source, jurisdiction: null, address: delivery ? formatAddress(delivery) : null, note: null, taxable, rules, ...extra });

  if (input.manual) {
    if (!CAN_SET_RATE.includes(input.manual.actor.role)) throw new LedgerError("FORBIDDEN", "only an owner or accountant can set the sales tax rate by hand");
    if (!input.manual.reason.trim()) throw new LedgerError("INVALID", "say why the rate is being set by hand");
    if (!/^\d{1,2}(\.\d{1,3})?$/.test(input.manual.ratePercent.trim())) throw new LedgerError("INVALID", "enter the rate as a percentage like 8.625");
    const rate = new D(input.manual.ratePercent.trim()).div(100);
    if (rate.gt(pack.maxCombinedRate)) throw new LedgerError("INVALID", `no California rate is that high (the top is under ${new D(pack.maxCombinedRate).mul(100)}%)`);
    return decision("manual", rate.toFixed(5), { jurisdiction: "Set by hand", note: input.manual.reason.trim().slice(0, 300) });
  }
  if (!taxable.some(Boolean)) return decision("not_taxable");
  if (contact.resale_permit) return decision("resale", "0.00000", { note: `Resale certificate, seller's permit ${contact.resale_permit}` });
  if (!delivery) {
    throw new LedgerError("INVALID", `add ${contact.name}'s address, or your business address, so Alt-QBO can work out the sales tax rate`);
  }
  if (delivery.state !== ent.region) return decision("out_of_state", "0.00000", { jurisdiction: `Delivered to ${delivery.state}` });
  if (!input.lookup) throw new LedgerError("TAX_LOOKUP", "the sales tax rate lookup isn't available right now; an owner or accountant can set the rate by hand");
  let found: Awaited<ReturnType<RateLookup>>;
  try {
    found = await input.lookup(delivery);
  } catch (err) {
    throw new LedgerError("TAX_LOOKUP", `couldn't find the sales tax rate for ${formatAddress(delivery)} (${(err as Error).message}). Check the address, or have an owner or accountant set the rate by hand`);
  }
  const rate = new D(found.rate);
  if (rate.lt(pack.statewideRate) || rate.gt(pack.maxCombinedRate)) {
    throw new LedgerError("TAX_LOOKUP", `the rate lookup gave ${rate.mul(100)}% for ${formatAddress(delivery)}, which can't be right for California; have an owner or accountant set it by hand`);
  }
  return decision("lookup", rate.toFixed(5), { jurisdiction: found.jurisdiction.slice(0, 200) });
}

// ---------------------------------------------------------------- invoices

export interface InvoiceLineInput extends Omit<DocumentLineInput, "account" | "unitPrice" | "taxable"> {
  /** Fills the account, price, description and kind of sale from a saved product or service. */
  itemId?: string;
  account?: string;
  unitPrice?: string;
}

export interface IssueInvoiceInput extends Omit<IssueDocumentInput, "kind" | "tax" | "lines"> {
  lines: InvoiceLineInput[];
  lookup?: RateLookup;
  manual?: { ratePercent: string; reason: string };
}

/** Fills each line from its product or service, where it has one. */
async function resolveLines(tx: Tx, entityId: string, lines: InvoiceLineInput[]): Promise<DocumentLineInput[]> {
  const ids = [...new Set(lines.map((l) => l.itemId).filter(Boolean))] as string[];
  const items = new Map<string, any>();
  if (ids.length) {
    const { rows } = await tx.query(
      "SELECT i.id, i.name, i.tax_category, i.unit_price_minor, a.code FROM items i JOIN accounts a ON a.id = i.account_id WHERE i.entity_id = $1 AND i.id = ANY($2)",
      [entityId, ids],
    );
    for (const r of rows) items.set(r.id, r);
  }
  return lines.map((l, i) => {
    const item = l.itemId ? items.get(l.itemId) : undefined;
    if (l.itemId && !item) throw new LedgerError("INVALID", `line ${i + 1}: that product or service isn't in these books`);
    const unitPrice = l.unitPrice ?? (item ? new D(item.unit_price_minor.toString()).div(100).toFixed(2) : undefined);
    const account = l.account || item?.code || "service_revenue";
    if (unitPrice === undefined) throw new LedgerError("INVALID", `line ${i + 1}: enter a price`);
    return {
      account, unitPrice, quantity: l.quantity, description: l.description || item?.name || "",
      taxCategory: l.taxCategory || item?.tax_category, itemId: l.itemId,
    };
  });
}

/**
 * Issues an invoice with its sales tax worked out: each line's kind of sale
 * says whether it is taxable, and the customer's address gives the rate. A
 * retry with the same idempotency key replays the original invoice without
 * looking the rate up again.
 */
export async function issueInvoice(tx: Tx, input: IssueInvoiceInput): Promise<DocumentDetail> {
  const lines = await resolveLines(tx, input.entityId, input.lines);
  const manual = input.manual ? { ...input.manual, actor: input.actor } : undefined;
  const prior = (await tx.query(
    "SELECT tax_rate::text AS rate, tax_source, tax_jurisdiction, tax_address, tax_note FROM documents WHERE entity_id = $1 AND idempotency_key = $2",
    [input.entityId, `invoice:${input.idempotencyKey}`],
  )).rows[0];
  let tax: DocumentTax;
  let taxable: boolean[];
  if (prior && !manual) {
    tax = { rate: prior.rate, source: prior.tax_source, jurisdiction: prior.tax_jurisdiction, address: prior.tax_address, note: prior.tax_note };
    const pack = rulesFor((await tx.query("SELECT region FROM entities WHERE id = $1", [input.entityId])).rows[0]?.region, input.issueDate);
    taxable = lines.map((l) => Boolean(l.taxCategory && pack.categories[l.taxCategory]?.taxable));
  } else {
    const d = await decideSalesTax(tx, {
      entityId: input.entityId, contactId: input.contactId, date: input.issueDate,
      categories: lines.map((l) => l.taxCategory ?? ""), lookup: input.lookup, manual,
    });
    tax = { rate: d.rate, source: d.source, jurisdiction: d.jurisdiction, address: d.address, note: d.note };
    taxable = d.taxable;
  }
  const { lookup: _l, manual: _m, ...rest } = input;
  return issueDocument(tx, { ...rest, kind: "invoice", tax, lines: lines.map((l, i) => ({ ...l, taxable: taxable[i] })) });
}

// ------------------------------------------------------ products and services

export interface Item {
  id: string;
  name: string;
  description: string;
  taxCategory: string;
  unitPriceMinor: bigint;
  accountCode: string;
  isActive: boolean;
}

const CAN_EDIT_ITEMS: Role[] = ["owner", "admin", "bookkeeper", "accountant", "system"];

export async function listItems(tx: Tx, entityId: string): Promise<Item[]> {
  const { rows } = await tx.query(
    `SELECT i.id, i.name, i.description, i.tax_category, i.unit_price_minor, a.code, i.is_active
       FROM items i JOIN accounts a ON a.id = i.account_id WHERE i.entity_id = $1 ORDER BY i.is_active DESC, lower(i.name)`,
    [entityId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, taxCategory: r.tax_category, unitPriceMinor: r.unit_price_minor, accountCode: r.code, isActive: r.is_active }));
}

interface ItemFields { name?: string; description?: string; taxCategory?: string; unitPrice?: string; account?: string; active?: boolean }

async function itemValues(tx: Tx, entityId: string, f: ItemFields, current?: { region: string }) {
  const region = current?.region ?? (await tx.query("SELECT region FROM entities WHERE id = $1", [entityId])).rows[0]?.region;
  const out: Record<string, unknown> = {};
  if (f.name !== undefined) {
    const name = f.name.trim();
    if (!name || name.length > 120) throw new LedgerError("INVALID", "an item needs a name of up to 120 characters");
    out.name = name;
  }
  if (f.description !== undefined) out.description = f.description.slice(0, 300);
  if (f.taxCategory !== undefined) {
    if (!currentCategories(region).some((c) => c.id === f.taxCategory)) throw new LedgerError("INVALID", "choose what kind of sale this is");
    out.tax_category = f.taxCategory;
  }
  if (f.unitPrice !== undefined) {
    let minor: bigint;
    try { minor = parseMoney(f.unitPrice || "0").minor; } catch { throw new LedgerError("INVALID", "the price must be an amount like 125.00"); }
    if (minor < 0n) throw new LedgerError("INVALID", "the price can't be negative");
    out.unit_price_minor = minor;
  }
  if (f.account !== undefined) {
    const a = (await tx.query("SELECT id FROM accounts WHERE entity_id = $1 AND (code = $2 OR system_key = $2) AND is_active", [entityId, f.account])).rows[0];
    if (!a) throw new LedgerError("UNKNOWN_ACCOUNT", `no active account ${f.account}`);
    out.account_id = a.id;
  }
  if (f.active !== undefined) out.is_active = f.active;
  return out;
}

export async function createItem(tx: Tx, input: ItemFields & { orgId: string; entityId: string; actor: Actor }): Promise<{ id: string }> {
  if (!CAN_EDIT_ITEMS.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", `role ${input.actor.role} cannot add products and services`);
  const v = await itemValues(tx, input.entityId, { account: "service_revenue", unitPrice: "0", description: "", ...input });
  if (!v.name || !v.tax_category) throw new LedgerError("INVALID", "an item needs a name and a kind");
  if ((await tx.query("SELECT 1 FROM items WHERE entity_id = $1 AND lower(name) = lower($2)", [input.entityId, v.name])).rows[0]) {
    throw new LedgerError("INVALID", `there is already an item named ${v.name}`);
  }
  try {
    const { rows } = await tx.query(
      `INSERT INTO items (org_id, entity_id, name, description, tax_category, unit_price_minor, account_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [input.orgId, input.entityId, v.name, v.description, v.tax_category, v.unit_price_minor, v.account_id],
    );
    await appendAudit(tx, {
      orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "item.created", objectType: "item", objectId: rows[0].id,
      after: { name: v.name, taxCategory: v.tax_category, unitPriceMinor: v.unit_price_minor, account: input.account ?? "service_revenue" },
      context: { role: input.actor.role },
    });
    return { id: rows[0].id };
  } catch (err) {
    translateDbError(err);
  }
}

export async function updateItem(tx: Tx, input: ItemFields & { orgId: string; entityId: string; itemId: string; actor: Actor }): Promise<void> {
  if (!CAN_EDIT_ITEMS.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", `role ${input.actor.role} cannot change products and services`);
  const before = (await tx.query("SELECT * FROM items WHERE id = $1 AND entity_id = $2 FOR UPDATE", [input.itemId, input.entityId])).rows[0];
  if (!before) throw new LedgerError("INVALID", "item not found");
  const v = await itemValues(tx, input.entityId, input);
  if (v.name && (await tx.query("SELECT 1 FROM items WHERE entity_id = $1 AND lower(name) = lower($2) AND id <> $3", [input.entityId, v.name, input.itemId])).rows[0]) {
    throw new LedgerError("INVALID", `there is already an item named ${v.name}`);
  }
  const changed = Object.entries(v).filter(([k, val]) => String(before[k]) !== String(val));
  if (!changed.length) return;
  try {
    await tx.query(`UPDATE items SET ${changed.map(([k], i) => `${k} = $${i + 2}`).join(", ")} WHERE id = $1`, [input.itemId, ...changed.map(([, val]) => val)]);
  } catch (err) {
    translateDbError(err);
  }
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "item.updated", objectType: "item", objectId: input.itemId,
    before: Object.fromEntries(changed.map(([k]) => [k, before[k]])), after: Object.fromEntries(changed), context: { role: input.actor.role },
  });
}

// ------------------------------------------------------------ return figures

export interface SalesTaxReport {
  from: string;
  to: string;
  /** All invoiced sales before tax: the return's total sales line. */
  totalSalesMinor: bigint;
  nontaxable: { category: string; label: string; amountMinor: bigint }[];
  resaleMinor: bigint;
  interstateMinor: bigint;
  taxableMinor: bigint;
  taxMinor: bigint;
  byJurisdiction: { jurisdiction: string; ratePercent: string; taxableMinor: bigint; taxMinor: bigint; invoices: number }[];
  /** Balance owed on the sales tax payable account at the end of the period. */
  payableMinor: bigint;
}

/**
 * Figures for the CDTFA return (CDTFA-401), accrual basis: invoices dated in
 * the period and not voided by its end. Prepares; filing and paying stay
 * with the business or its accountant.
 */
export async function salesTaxReport(tx: Tx, entityId: string, from: string, to: string): Promise<SalesTaxReport> {
  if (from > to) throw new LedgerError("INVALID", "the start date is after the end date");
  const region = (await tx.query("SELECT region FROM entities WHERE id = $1", [entityId])).rows[0]?.region;
  const pack = salesTaxRules(region, from) ?? salesTaxRules(region, to);
  const { rows } = await tx.query(
    `SELECT d.id, d.tax_source, CASE WHEN d.tax_source = 'manual' AND d.tax_address IS NOT NULL THEN 'Set by hand for ' || d.tax_address ELSE coalesce(d.tax_jurisdiction, '') END AS jurisdiction, d.tax_rate, l.taxable, l.tax_category, l.amount_minor, l.tax_minor
       FROM documents d JOIN document_lines l ON l.document_id = d.id
      WHERE d.entity_id = $1 AND d.kind = 'invoice' AND d.issue_date BETWEEN $2 AND $3
        AND NOT (d.status = 'void' AND d.void_date <= $3)`,
    [entityId, from, to],
  );
  const r: SalesTaxReport = { from, to, totalSalesMinor: 0n, nontaxable: [], resaleMinor: 0n, interstateMinor: 0n, taxableMinor: 0n, taxMinor: 0n, byJurisdiction: [], payableMinor: 0n };
  const nontaxable = new Map<string, bigint>();
  const juris = new Map<string, SalesTaxReport["byJurisdiction"][number] & { docs: Set<string> }>();
  for (const l of rows) {
    const amount = l.amount_minor as bigint;
    r.totalSalesMinor += amount;
    if (!l.taxable) {
      const cat = l.tax_category ?? "uncategorized";
      nontaxable.set(cat, (nontaxable.get(cat) ?? 0n) + amount);
    } else if (l.tax_source === "resale") r.resaleMinor += amount;
    else if (l.tax_source === "out_of_state") r.interstateMinor += amount;
    else {
      r.taxableMinor += amount;
      r.taxMinor += l.tax_minor as bigint;
      const pct = new D(l.tax_rate).mul(100).toFixed(3).replace(/\.?0+$/, "");
      const key = `${l.jurisdiction}|${pct}`;
      const j = juris.get(key) ?? { jurisdiction: l.jurisdiction || "Entered by user", ratePercent: pct, taxableMinor: 0n, taxMinor: 0n, invoices: 0, docs: new Set() };
      j.taxableMinor += amount; j.taxMinor += l.tax_minor as bigint; j.docs.add(l.id);
      juris.set(key, j);
    }
  }
  r.nontaxable = [...nontaxable].map(([category, amountMinor]) => ({ category, label: pack?.categories[category]?.label ?? "Not categorised", amountMinor }));
  r.byJurisdiction = [...juris.values()].map(({ docs, ...j }) => ({ ...j, invoices: docs.size })).sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
  r.payableMinor = (await tx.query(
    `SELECT coalesce(sum(l.credit_minor - l.debit_minor), 0)::bigint AS b
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE l.entity_id = $1 AND a.system_key = 'sales_tax_payable' AND e.entry_date <= $2`,
    [entityId, to],
  )).rows[0].b;
  return r;
}

/** Sets the business's own address, the fallback when a customer has none. Owners and admins only. */
export async function setBusinessAddress(tx: Tx, input: { orgId: string; entityId: string; address: Address | null; actor: Actor }): Promise<void> {
  if (!["owner", "admin", "system"].includes(input.actor.role)) throw new LedgerError("FORBIDDEN", "only an owner or admin can change the business address");
  const before = (await tx.query("SELECT address_line1, address_city, address_state, address_zip FROM entities WHERE id = $1 FOR UPDATE", [input.entityId])).rows[0];
  if (!before) throw new LedgerError("INVALID", "entity not found");
  const a = input.address;
  await tx.query(
    "UPDATE entities SET address_line1 = $2, address_city = $3, address_state = $4, address_zip = $5 WHERE id = $1",
    [input.entityId, a?.line1 ?? null, a?.city ?? null, a?.state ?? null, a?.zip ?? null],
  );
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "entity.updated", objectType: "entity", objectId: input.entityId,
    before: { address: addressOf(before) }, after: { address: a }, context: { role: input.actor.role },
  });
}
