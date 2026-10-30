import type { Tx } from "../db/pool.js";
import { regionOf } from "../rules/jurisdictions.js";

/** States with no state or local sales tax (Alaska and Montana have local ones, so they aren't here). */
const NO_STATE_SALES_TAX = ["OR", "NH", "DE"];
import { latestSalesTaxRules, salesTaxRules, type SalesTaxRulePack } from "../rules/sales-tax/us-ca-2026.js";
import { appendAudit } from "./audit.js";
import { LedgerError, translateDbError } from "./errors.js";
import { issueDocument, type DocumentDetail, type DocumentLineInput, type DocumentTax, type DocumentUseTax, type IssueDocumentInput } from "./documents.js";
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
  /** The fraction of each taxable line that is taxed, when less than all of it ("0.6000"), else null. */
  taxShare: (string | null)[];
  /** Why a software line is untaxed or partly taxed: the buyer pays directly, or a multiple-points-of-use certificate. */
  exemptions: ("direct_pay" | "mpu" | null)[];
  /** Things for the person issuing the invoice to check; they don't stop it. */
  warnings: string[];
  /** Rule packs used, as "id@version", comma-separated when lines fall under different years. */
  rules: string | null;
}

/** Each line's access period, for software; and its amount, for the direct-payment warning. */
export interface TaxLineInfo {
  periodStart?: string;
  periodEnd?: string;
  amountMinor?: bigint;
}

const CAN_SET_RATE: Role[] = ["owner", "accountant", "system"];

/**
 * SB 122: past $5,000,000 of software a year from one seller, the buyer
 * reports the tax (with a use tax direct payment permit). TrailBook warns from
 * $4,000,000 so an accountant can check before the line is crossed.
 */
const DIRECT_PAY_THRESHOLD_MINOR = 500_000_000n;
const DIRECT_PAY_WARNING_MINOR = 400_000_000n;

export const NO_PERMIT_WARNING =
  "This invoice charges California sales tax, but no seller's permit is recorded for your business. Get one from the CDTFA before you collect tax, and record its number on the Sales tax page";

export const permitNotStartedWarning = (start: string) =>
  `This invoice charges California sales tax before your seller's permit takes effect on ${start}. Collect tax only from that date, or check the start date on the Sales tax page`;

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dollars = (minor: bigint) => `$${(Number(minor) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export const formatAddress = (a: Address) => `${a.line1}, ${a.city}, ${a.state} ${a.zip}`;

function addressOf(r: any): Address | null {
  if (!r?.address_line1 || !r.address_city || !r.address_state || !r.address_zip) return null;
  return { line1: r.address_line1, city: r.address_city, state: r.address_state, zip: r.address_zip };
}

/** Checks and tidies an address typed by a person. All four parts, or none. */
/** Canada's provinces and territories; none shares a code with a US state. */
export const CANADIAN_PROVINCES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);

export function cleanAddress(a: Partial<Record<keyof Address, unknown>> | null | undefined): Address | null {
  const v = (k: keyof Address) => (typeof a?.[k] === "string" ? (a[k] as string).trim() : "");
  const out = { line1: v("line1"), city: v("city"), state: v("state").toUpperCase(), zip: v("zip") };
  if (!out.line1 && !out.city && !out.zip) return null;
  if (!out.line1 || !out.city || !out.zip) throw new LedgerError("INVALID", "an address needs a street, a city and a ZIP or postal code");
  if (!out.state) out.state = "CA";
  if (!/^[A-Z]{2}$/.test(out.state)) throw new LedgerError("INVALID", "the state or province should be two letters, like CA or BC");
  if (CANADIAN_PROVINCES.has(out.state)) {
    // Canadian postal codes are kept as A1A 1A1.
    const pc = out.zip.toUpperCase().replace(/\s+/g, "");
    if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(pc)) throw new LedgerError("INVALID", "the postal code should look like V6B 1A1");
    out.zip = `${pc.slice(0, 3)} ${pc.slice(3)}`;
  } else if (!/^\d{5}(-\d{4})?$/.test(out.zip)) throw new LedgerError("INVALID", "the ZIP code should look like 94103 or 94103-1234");
  if (out.line1.length > 200 || out.city.length > 100) throw new LedgerError("INVALID", "that address is too long");
  return out;
}

export function rulesFor(region: string | null, date: string): SalesTaxRulePack {
  const pack = salesTaxRules(region, date);
  if (!pack) throw new LedgerError("INVALID", `TrailBook has no sales tax rules for ${region ?? "this place"} on ${date} yet`);
  return pack;
}

/** The kinds of sale to choose from today, falling back to the newest pack for the state. */
export function currentCategories(region: string | null, today = new Date().toISOString().slice(0, 10)) {
  const pack = salesTaxRules(region, today) ?? latestSalesTaxRules(region);
  if (!pack) return [];
  return Object.entries(pack.categories).map(([id, c]) => ({ id, label: c.label, help: c.help, taxable: c.taxable, digitalProduct: Boolean(c.digitalProduct) }));
}

/** One line a person can read: why this invoice has the tax it has. */
export function explainTax(t: Pick<TaxDecision, "rate" | "source" | "jurisdiction" | "address" | "note">): string {
  const pct = `${new D(t.rate).mul(100).toFixed(3).replace(/\.?0+$/, "")}%`;
  switch (t.source) {
    case "not_taxable": return "No sales tax: nothing on this invoice is taxable in California.";
    case "none": return t.note ? `No sales tax: ${t.note}.` : "No sales tax.";
    case "direct_pay": return `No sales tax on software: ${t.note ?? "the buyer pays California use tax directly"}.`;
    case "resale": return `No sales tax: ${t.note ?? "sale for resale"}.`;
    case "out_of_state": return `No sales tax: delivered outside California${t.address ? ` (${t.address})` : ""}.`;
    case "lookup": return `Sales tax ${pct} on taxable lines, the rate for ${t.jurisdiction}${t.address ? ` (${t.address})` : ""}.${t.note ? ` ${t.note}.` : ""}`;
    case "manual": return `Sales tax ${pct}, set by hand: ${t.note}.`;
    default: return "No sales tax.";
  }
}

/**
 * Each line's taxability under the pack in force for it: the pack for the
 * start of the customer's access, for software, else for the invoice date.
 * Software whose taxability changes within its access period, or soon after
 * an invoice that doesn't say when access starts, is refused with a request
 * to split the line or give the date, rather than guessed.
 */
function lineRules(region: string | null, date: string, categories: string[], info: TaxLineInfo[] = []) {
  const packs = new Set<string>();
  const lines = categories.map((c, i) => {
    const n = i + 1;
    const { periodStart, periodEnd } = info[i] ?? {};
    if (periodEnd && !periodStart) throw new LedgerError("INVALID", `line ${n}: enter when the customer's access starts`);
    if (periodStart && periodEnd && periodEnd < periodStart) throw new LedgerError("INVALID", `line ${n}: the access period ends before it starts`);
    const atIssue = rulesFor(region, date).categories[c];
    if (!atIssue) throw new LedgerError("INVALID", `line ${n}: choose what kind of sale this is`);
    const digital = Boolean(atIssue.digitalProduct);
    const pack = digital && periodStart ? rulesFor(region, periodStart) : rulesFor(region, date);
    const cat = pack.categories[c];
    if (!cat) throw new LedgerError("INVALID", `line ${n}: choose what kind of sale this is`);
    if (digital) {
      const end = periodEnd ? salesTaxRules(region, periodEnd) : null;
      if (end && end.categories[c] && end.categories[c].taxable !== cat.taxable) {
        throw new LedgerError("INVALID", `line ${n}: this access period runs across ${end.effectiveFrom}, when ${cat.label.toLowerCase()} becomes ${end.categories[c].taxable ? "taxable" : "not taxable"}. Split it into one line for access before that date and one from it`);
      }
      const soon = periodStart ? null : salesTaxRules(region, addDays(date, 62));
      if (soon && soon.categories[c] && soon.categories[c].taxable !== cat.taxable) {
        throw new LedgerError("INVALID", `line ${n}: enter when the customer's access starts. ${cat.label} is ${soon.categories[c].taxable ? "taxable" : "not taxable"} for access from ${soon.effectiveFrom}`);
      }
    }
    packs.add(`${pack.id}@${pack.version}`);
    return { taxable: cat.taxable, digital };
  });
  return { lines, rules: [...packs].join(", ") };
}

/**
 * Decides an invoice's sales tax. In order: an accountant's rate, if given;
 * nothing taxable; a resale certificate on file; delivery outside the state;
 * otherwise the looked-up rate for the customer's address, or the business's
 * own address when the customer has none. Software (a digital product) is
 * different in three ways: it is taxed only at the customer's own address,
 * never the business's; a buyer with a direct payment permit pays its tax
 * themselves; and a multiple-points-of-use certificate taxes only the
 * California share.
 */
export async function decideSalesTax(
  tx: Tx,
  input: {
    entityId: string; contactId: string; date: string; categories: string[];
    /** Per line, in the same order as categories. */
    lines?: TaxLineInfo[];
    lookup?: RateLookup;
    /** Set by an owner or accountant, with a reason, when the lookup can't be used. Percent, like "8.625". */
    manual?: { ratePercent: string; reason: string; actor: Actor };
  },
): Promise<TaxDecision> {
  const ent = (await tx.query(
    "SELECT region, seller_permit, sales_tax_start::text, address_line1, address_city, address_state, address_zip FROM entities WHERE id = $1",
    [input.entityId],
  )).rows[0];
  if (!ent) throw new LedgerError("INVALID", "entity not found");
  const pack = rulesFor(ent.region, input.date);
  const { lines, rules } = lineRules(ent.region, input.date, input.categories, input.lines);
  const taxable = lines.map((l) => l.taxable);
  const contact = (await tx.query(
    `SELECT name, resale_permit, direct_pay_permit, mpu_ca_percent::text AS mpu_ca_percent, mpu_certificate_date,
            address_line1, address_city, address_state, address_zip
       FROM contacts WHERE id = $1 AND entity_id = $2`,
    [input.contactId, input.entityId],
  )).rows[0];
  if (!contact) throw new LedgerError("INVALID", "choose a customer");

  // Software: the buyer pays the tax directly, or only the California share is taxed.
  const exemptions: TaxDecision["exemptions"] = lines.map(() => null);
  const taxShare: TaxDecision["taxShare"] = lines.map(() => null);
  const notes: string[] = [];
  lines.forEach((l, i) => {
    if (!l.digital || !l.taxable) return;
    if (contact.direct_pay_permit) {
      taxable[i] = false;
      exemptions[i] = "direct_pay";
    } else if (contact.mpu_ca_percent !== null) {
      taxShare[i] = new D(contact.mpu_ca_percent).div(100).toFixed(4);
      exemptions[i] = "mpu";
    }
  });
  const directPayNote = `the buyer pays California use tax directly (permit ${contact.direct_pay_permit})`;
  if (exemptions.includes("direct_pay")) notes.push(`Software not taxed: ${directPayNote}`);
  if (exemptions.includes("mpu")) {
    notes.push(`Software taxed on the ${new D(contact.mpu_ca_percent).toString()}% California share, per the customer's multiple-points-of-use certificate dated ${contact.mpu_certificate_date}`);
  }
  const warnings = await directPayWarnings(tx, input, pack, contact, lines.map((l) => l.digital));

  const delivery = addressOf(contact) ?? addressOf(ent);
  const decision = (source: TaxSource, rate = "0.00000", extra: Partial<TaxDecision> = {}): TaxDecision => ({
    rate, source, jurisdiction: null, address: delivery ? formatAddress(delivery) : null, note: notes.join(". ") || null,
    taxable, taxShare, exemptions, rules, ...extra,
    // Charging tax needs a seller's permit (Rev. & Tax. Code §6066); this doesn't stop the invoice.
    warnings: source !== "lookup" && source !== "manual" ? warnings
      : !ent.seller_permit ? [...warnings, NO_PERMIT_WARNING]
      : ent.sales_tax_start && input.date < ent.sales_tax_start ? [...warnings, permitNotStartedWarning(ent.sales_tax_start)]
      : warnings,
  });

  if (input.manual) {
    return decision("manual", manualRate(pack, input.manual, "sales tax"), { jurisdiction: "Set by hand", note: [input.manual.reason.trim().slice(0, 300), ...notes].join(". ") });
  }
  if (pack.kind === "state-sales-tax-manual") {
    const name = regionOf("US", ent.region)?.name ?? ent.region;
    return decision("none", "0.00000", {
      note: NO_STATE_SALES_TAX.includes(ent.region)
        ? `${name} has no state sales tax`
        : `TrailBook doesn't work out ${name} sales tax yet; if this sale is taxable there, an owner or accountant can set the rate by hand`,
    });
  }
  if (!taxable.some(Boolean)) {
    return exemptions.includes("direct_pay") ? decision("direct_pay", "0.00000", { note: directPayNote }) : decision("not_taxable");
  }
  if (contact.resale_permit) return decision("resale", "0.00000", { note: `Resale certificate, seller's permit ${contact.resale_permit}` });
  if (lines.some((l, i) => l.digital && taxable[i]) && !addressOf(contact)) {
    throw new LedgerError("INVALID", `add ${contact.name}'s billing address: software is taxed where the customer is, not where your business is`);
  }
  if (!delivery) {
    throw new LedgerError("INVALID", `add ${contact.name}'s address, or your business address, so TrailBook can work out the sales tax rate`);
  }
  if (delivery.state !== ent.region) return decision("out_of_state", "0.00000", { jurisdiction: `Delivered to ${delivery.state}` });
  const found = await lookupRate(pack, delivery, input.lookup);
  return decision("lookup", found.rate, { jurisdiction: found.jurisdiction });
}

/** An owner's or accountant's own rate, checked. Returns the fraction with five decimals. */
function manualRate(pack: SalesTaxRulePack, manual: { ratePercent: string; reason: string; actor: Actor }, what: string): string {
  if (!CAN_SET_RATE.includes(manual.actor.role)) throw new LedgerError("FORBIDDEN", `only an owner or accountant can set the ${what} rate by hand`);
  if (!manual.reason.trim()) throw new LedgerError("INVALID", "say why the rate is being set by hand");
  if (!/^\d{1,2}(\.\d{1,3})?$/.test(manual.ratePercent.trim())) throw new LedgerError("INVALID", "enter the rate as a percentage like 8.625");
  const rate = new D(manual.ratePercent.trim()).div(100);
  if (rate.gt(pack.maxCombinedRate)) throw new LedgerError("INVALID", `no ${pack.place.region === "CA" ? "California" : "US"} rate is that high (the top is under ${new D(pack.maxCombinedRate).mul(100)}%)`);
  return rate.toFixed(5);
}

/** The CDTFA's combined rate for an address, refused when it can't be right for the state. */
async function lookupRate(pack: SalesTaxRulePack, address: Address, lookup?: RateLookup): Promise<{ rate: string; jurisdiction: string }> {
  if (!lookup) throw new LedgerError("TAX_LOOKUP", "the sales tax rate lookup isn't available right now; an owner or accountant can set the rate by hand");
  let found: Awaited<ReturnType<RateLookup>>;
  try {
    found = await lookup(address);
  } catch (err) {
    throw new LedgerError("TAX_LOOKUP", `couldn't find the sales tax rate for ${formatAddress(address)} (${(err as Error).message}). Check the address, or have an owner or accountant set the rate by hand`);
  }
  const rate = new D(found.rate);
  if (rate.lt(pack.statewideRate) || rate.gt(pack.maxCombinedRate)) {
    throw new LedgerError("TAX_LOOKUP", `the rate lookup gave ${rate.mul(100)}% for ${formatAddress(address)}, which can't be right for California; have an owner or accountant set it by hand`);
  }
  return { rate: rate.toFixed(5), jurisdiction: found.jurisdiction.slice(0, 200) };
}

/** Warns when a customer's software billing this year nears the $5,000,000 direct-payment line and no permit is on file. */
async function directPayWarnings(
  tx: Tx, input: { entityId: string; contactId: string; date: string; lines?: TaxLineInfo[] },
  pack: SalesTaxRulePack, contact: { name: string; direct_pay_permit: string | null }, digital: boolean[],
): Promise<string[]> {
  if (contact.direct_pay_permit || !digital.some(Boolean)) return [];
  const softwareKinds = Object.entries(pack.categories).filter(([, c]) => c.digitalProduct).map(([k]) => k);
  const year = input.date.slice(0, 4);
  const billed = (await tx.query(
    `SELECT coalesce(sum(l.amount_minor), 0)::bigint AS s
       FROM document_lines l JOIN documents d ON d.id = l.document_id
      WHERE d.entity_id = $1 AND d.contact_id = $2 AND d.kind = 'invoice' AND d.status <> 'void'
        AND d.issue_date BETWEEN $3::date AND $4::date AND l.tax_category = ANY($5)`,
    [input.entityId, input.contactId, `${year}-01-01`, `${year}-12-31`, softwareKinds],
  )).rows[0].s as bigint;
  const total = billed + digital.reduce((s, d, i) => s + (d ? input.lines?.[i]?.amountMinor ?? 0n : 0n), 0n);
  if (total <= DIRECT_PAY_WARNING_MINOR) return [];
  const past = total > DIRECT_PAY_THRESHOLD_MINOR;
  return [`${contact.name} has been billed ${dollars(total)} for software in ${year}. ${past ? "Past" : "From"} ${dollars(DIRECT_PAY_THRESHOLD_MINOR)}, the buyer reports the tax instead of you (SB 122). Ask whether they hold a use tax direct payment permit, and if so have an owner or accountant record it on the customer`];
}

// ---------------------------------------------------------------- invoices

export interface InvoiceLineInput extends Omit<DocumentLineInput, "account" | "unitPrice" | "taxable" | "taxShare" | "taxExemption"> {
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
      ...(l.servicePeriodStart ? { servicePeriodStart: l.servicePeriodStart } : {}),
      ...(l.servicePeriodEnd ? { servicePeriodEnd: l.servicePeriodEnd } : {}),
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
  let taxed: Pick<DocumentLineInput, "taxable" | "taxShare" | "taxExemption">[];
  if (prior && !manual) {
    // A retry: the lines as they were taxed the first time, so the replay matches.
    tax = { rate: prior.rate, source: prior.tax_source, jurisdiction: prior.tax_jurisdiction, address: prior.tax_address, note: prior.tax_note };
    const { rows } = await tx.query(
      `SELECT l.taxable, l.amount_minor, l.taxable_minor, l.tax_exemption FROM document_lines l JOIN documents d ON d.id = l.document_id
        WHERE d.entity_id = $1 AND d.idempotency_key = $2 ORDER BY l.line_no`,
      [input.entityId, `invoice:${input.idempotencyKey}`],
    );
    taxed = rows.map((r) => ({
      taxable: r.taxable, taxExemption: r.tax_exemption ?? undefined,
      taxShare: r.tax_exemption === "mpu" && r.amount_minor > 0n ? new D(r.taxable_minor.toString()).div(r.amount_minor.toString()).toFixed(4) : undefined,
    }));
  } else {
    const d = await decideSalesTax(tx, {
      entityId: input.entityId, contactId: input.contactId, date: input.issueDate,
      categories: lines.map((l) => l.taxCategory ?? ""), lines: lines.map((l) => ({ periodStart: l.servicePeriodStart, periodEnd: l.servicePeriodEnd })),
      lookup: input.lookup, manual,
    });
    tax = { rate: d.rate, source: d.source, jurisdiction: d.jurisdiction, address: d.address, note: d.note };
    taxed = d.taxable.map((t, i) => ({ taxable: t, taxShare: d.taxShare[i] ?? undefined, taxExemption: d.exemptions[i] ?? undefined }));
  }
  const { lookup: _l, manual: _m, ...rest } = input;
  return issueDocument(tx, { ...rest, kind: "invoice", tax, lines: lines.map((l, i) => ({ ...l, ...taxed[i] })) });
}

// ------------------------------------------------------------ use tax on bills

export interface UseTaxDecision {
  /** Fraction with five decimals ("0.08625"). */
  rate: string;
  source: DocumentUseTax["source"];
  jurisdiction: string | null;
  address: string | null;
  note: string | null;
  /** Whether the business owes use tax on each line, in order. */
  taxable: boolean[];
  rules: string | null;
}

/**
 * Decides the California use tax a business owes on a bill whose vendor
 * didn't charge California tax: each line's kind decides whether it is
 * taxable (software by the start of access, as on invoices), and the rate is
 * the one for the business's own address, where it uses what it bought.
 * Only when the vendor didn't charge the tax: a bill that already carries
 * California tax is recorded without this.
 */
export async function decideUseTax(
  tx: Tx,
  input: {
    entityId: string; date: string; categories: string[]; lines?: TaxLineInfo[]; lookup?: RateLookup;
    manual?: { ratePercent: string; reason: string; actor: Actor };
  },
): Promise<UseTaxDecision> {
  const ent = (await tx.query("SELECT region, address_line1, address_city, address_state, address_zip FROM entities WHERE id = $1", [input.entityId])).rows[0];
  if (!ent) throw new LedgerError("INVALID", "entity not found");
  const pack = rulesFor(ent.region, input.date);
  const { lines, rules } = lineRules(ent.region, input.date, input.categories, input.lines);
  const taxable = lines.map((l) => l.taxable);
  const where = addressOf(ent);
  const decision = (source: UseTaxDecision["source"], rate = "0.00000", extra: Partial<UseTaxDecision> = {}): UseTaxDecision => ({
    rate, source, jurisdiction: null, address: where ? formatAddress(where) : null, note: null, taxable, rules, ...extra,
  });
  if (!taxable.some(Boolean)) return decision("not_taxable");
  if (pack.kind === "state-sales-tax-manual" && !input.manual) {
    throw new LedgerError("INVALID", `TrailBook doesn't work out ${regionOf("US", ent.region)?.name ?? ent.region} use tax yet; an owner or accountant can set the rate by hand`);
  }
  if (input.manual) {
    return decision("manual", manualRate(pack, input.manual, "use tax"), { jurisdiction: "Set by hand", note: input.manual.reason.trim().slice(0, 300) });
  }
  if (!where) throw new LedgerError("INVALID", "add your business address first: use tax is worked out where your business uses what it bought");
  if (where.state !== ent.region) {
    throw new LedgerError("INVALID", `your business address is in ${where.state}; TrailBook works out California use tax for things used at a California address. An owner or accountant can set the rate by hand`);
  }
  const found = await lookupRate(pack, where, input.lookup);
  return decision("lookup", found.rate, { jurisdiction: found.jurisdiction });
}

/** One line a person can read: why this bill has the use tax it has. */
export function explainUseTax(t: Pick<UseTaxDecision, "rate" | "source" | "jurisdiction" | "address" | "note">): string {
  const pct = `${new D(t.rate).mul(100).toFixed(3).replace(/\.?0+$/, "")}%`;
  switch (t.source) {
    case "not_taxable": return "No use tax: nothing on this bill is taxable in California.";
    case "lookup": return `Use tax ${pct} on taxable lines, the rate for ${t.jurisdiction}${t.address ? ` (${t.address})` : ""}. You owe it to the CDTFA, not the vendor.`;
    case "manual": return `Use tax ${pct}, set by hand: ${t.note}. You owe it to the CDTFA, not the vendor.`;
    default: return "No use tax.";
  }
}

export interface RecordBillInput extends Omit<IssueDocumentInput, "kind" | "tax" | "useTax"> {
  /** Add use tax because the vendor didn't charge California tax. Left out, the vendor's setting decides. */
  useTax?: boolean;
  lookup?: RateLookup;
  manual?: { ratePercent: string; reason: string };
}

/**
 * Records a bill, with California use tax when the vendor didn't charge
 * California tax. A retry with the same idempotency key replays the original
 * bill without looking the rate up again.
 */
export async function recordBill(tx: Tx, input: RecordBillInput): Promise<DocumentDetail> {
  const { lookup, manual: manualInput, useTax: wanted, ...rest } = input;
  const vendor = (await tx.query("SELECT accrue_use_tax FROM contacts WHERE id = $1 AND entity_id = $2", [input.contactId, input.entityId])).rows[0];
  if (!(wanted ?? vendor?.accrue_use_tax)) return issueDocument(tx, { ...rest, kind: "bill" });
  const manual = manualInput ? { ...manualInput, actor: input.actor } : undefined;
  const key = `bill:${input.idempotencyKey}`;
  const prior = (await tx.query(
    "SELECT use_tax_rate::text AS rate, use_tax_source, use_tax_jurisdiction, use_tax_address, use_tax_note FROM documents WHERE entity_id = $1 AND idempotency_key = $2",
    [input.entityId, key],
  )).rows[0];
  let useTax: DocumentUseTax;
  let taxable: boolean[];
  if (prior && prior.use_tax_source !== "none" && !manual) {
    // A retry: the lines as they were taxed the first time, so the replay matches.
    useTax = { rate: prior.rate, source: prior.use_tax_source, jurisdiction: prior.use_tax_jurisdiction, address: prior.use_tax_address, note: prior.use_tax_note };
    const { rows } = await tx.query(
      `SELECT l.use_taxable FROM document_lines l JOIN documents d ON d.id = l.document_id WHERE d.entity_id = $1 AND d.idempotency_key = $2 ORDER BY l.line_no`,
      [input.entityId, key],
    );
    taxable = rows.map((r) => r.use_taxable);
  } else {
    const d = await decideUseTax(tx, {
      entityId: input.entityId, date: input.issueDate, categories: input.lines.map((l) => l.taxCategory ?? ""),
      lines: input.lines.map((l) => ({ periodStart: l.servicePeriodStart, periodEnd: l.servicePeriodEnd })), lookup, manual,
    });
    useTax = { rate: d.rate, source: d.source, jurisdiction: d.jurisdiction, address: d.address, note: d.note };
    taxable = d.taxable;
  }
  return issueDocument(tx, { ...rest, kind: "bill", useTax, lines: input.lines.map((l, i) => ({ ...l, useTaxable: taxable[i] })) });
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
  /** Software sold to buyers who pay California use tax directly (SB 122). */
  directPayMinor: bigint;
  /** The out-of-California share of software under a multiple-points-of-use certificate. */
  outsideCaUseMinor: bigint;
  taxableMinor: bigint;
  taxMinor: bigint;
  byJurisdiction: { jurisdiction: string; ratePercent: string; taxableMinor: bigint; taxMinor: bigint; invoices: number }[];
  /** California use tax the business owes on bills dated in the period, where the vendor didn't charge tax. */
  useTax: {
    /** The return's "purchases subject to use tax" line. */
    purchasesMinor: bigint;
    taxMinor: bigint;
    byJurisdiction: { jurisdiction: string; ratePercent: string; purchasesMinor: bigint; taxMinor: bigint; bills: number }[];
  };
  /** Balance owed on the sales tax payable account at the end of the period: sales tax and use tax. */
  payableMinor: bigint;
}

/**
 * Figures for the CDTFA return (CDTFA-401), accrual basis: invoices, and
 * bills that accrued use tax, dated in the period and not voided by its end.
 * Prepares; filing and paying stay with the business or its accountant.
 */
export async function salesTaxReport(tx: Tx, entityId: string, from: string, to: string): Promise<SalesTaxReport> {
  if (from > to) throw new LedgerError("INVALID", "the start date is after the end date");
  const region = (await tx.query("SELECT region FROM entities WHERE id = $1", [entityId])).rows[0]?.region;
  const pack = salesTaxRules(region, from) ?? salesTaxRules(region, to);
  const { rows } = await tx.query(
    `SELECT d.id, d.tax_source, CASE WHEN d.tax_source = 'manual' AND d.tax_address IS NOT NULL THEN 'Set by hand for ' || d.tax_address ELSE coalesce(d.tax_jurisdiction, '') END AS jurisdiction, d.tax_rate, l.taxable, l.tax_category, l.amount_minor, l.tax_minor, l.taxable_minor, l.tax_exemption
       FROM documents d JOIN document_lines l ON l.document_id = d.id
      WHERE d.entity_id = $1 AND d.kind = 'invoice' AND d.issue_date BETWEEN $2 AND $3
        AND NOT (d.status = 'void' AND d.void_date <= $3)`,
    [entityId, from, to],
  );
  const r: SalesTaxReport = { from, to, totalSalesMinor: 0n, nontaxable: [], resaleMinor: 0n, interstateMinor: 0n, directPayMinor: 0n, outsideCaUseMinor: 0n, taxableMinor: 0n, taxMinor: 0n, byJurisdiction: [], useTax: { purchasesMinor: 0n, taxMinor: 0n, byJurisdiction: [] }, payableMinor: 0n };
  const nontaxable = new Map<string, bigint>();
  const juris = new Map<string, SalesTaxReport["byJurisdiction"][number] & { docs: Set<string> }>();
  for (const l of rows) {
    const amount = l.amount_minor as bigint;
    r.totalSalesMinor += amount;
    if (!l.taxable && l.tax_exemption === "direct_pay") r.directPayMinor += amount;
    else if (!l.taxable) {
      const cat = l.tax_category ?? "uncategorized";
      nontaxable.set(cat, (nontaxable.get(cat) ?? 0n) + amount);
    } else if (l.tax_source === "resale") r.resaleMinor += amount;
    else if (l.tax_source === "out_of_state") r.interstateMinor += amount;
    else {
      const taxed = (l.taxable_minor as bigint | null) ?? amount;
      r.outsideCaUseMinor += amount - taxed;
      r.taxableMinor += taxed;
      r.taxMinor += l.tax_minor as bigint;
      const pct = new D(l.tax_rate).mul(100).toFixed(3).replace(/\.?0+$/, "");
      const key = `${l.jurisdiction}|${pct}`;
      const j = juris.get(key) ?? { jurisdiction: l.jurisdiction || "Entered by user", ratePercent: pct, taxableMinor: 0n, taxMinor: 0n, invoices: 0, docs: new Set() };
      j.taxableMinor += taxed; j.taxMinor += l.tax_minor as bigint; j.docs.add(l.id);
      juris.set(key, j);
    }
  }
  r.nontaxable = [...nontaxable].map(([category, amountMinor]) => ({ category, label: pack?.categories[category]?.label ?? "Not categorised", amountMinor }));
  r.byJurisdiction = [...juris.values()].map(({ docs, ...j }) => ({ ...j, invoices: docs.size })).sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
  const bills = await tx.query(
    `SELECT d.id, CASE WHEN d.use_tax_source = 'manual' THEN 'Set by hand' || coalesce(' for ' || d.use_tax_address, '') ELSE coalesce(d.use_tax_jurisdiction, '') END AS jurisdiction,
            d.use_tax_rate, l.amount_minor, l.use_tax_minor
       FROM documents d JOIN document_lines l ON l.document_id = d.id
      WHERE d.entity_id = $1 AND d.kind = 'bill' AND l.use_taxable AND d.issue_date BETWEEN $2 AND $3
        AND NOT (d.status = 'void' AND d.void_date <= $3)`,
    [entityId, from, to],
  );
  const useJuris = new Map<string, SalesTaxReport["useTax"]["byJurisdiction"][number] & { docs: Set<string> }>();
  for (const l of bills.rows) {
    r.useTax.purchasesMinor += l.amount_minor as bigint;
    r.useTax.taxMinor += l.use_tax_minor as bigint;
    const pct = new D(l.use_tax_rate).mul(100).toFixed(3).replace(/\.?0+$/, "");
    const key = `${l.jurisdiction}|${pct}`;
    const j = useJuris.get(key) ?? { jurisdiction: l.jurisdiction, ratePercent: pct, purchasesMinor: 0n, taxMinor: 0n, bills: 0, docs: new Set() };
    j.purchasesMinor += l.amount_minor as bigint; j.taxMinor += l.use_tax_minor as bigint; j.docs.add(l.id);
    useJuris.set(key, j);
  }
  r.useTax.byJurisdiction = [...useJuris.values()].map(({ docs, ...j }) => ({ ...j, bills: docs.size })).sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
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
