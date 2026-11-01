import type { Tx } from "../db/pool.js";
import { onOrNextBusinessDay, type Calendar } from "../payroll/business-days.js";
import {
  CA_REGIONS, canadaSalesTaxRules, hstRate, PROVINCE_NAMES,
  type CaRegion, type CanadaSalesTaxPack, type GstStatus,
} from "../rules/sales-tax/ca-2026.js";
import { appendAudit } from "./audit.js";
import { LedgerError } from "./errors.js";
import type { Actor, Role } from "./ledger.js";
import { D } from "./money.js";

// Canadian sales taxes on a Canadian business's invoices and bills, and the
// returns they add up to: GST/HST to the CRA (Revenu Québec for a Quebec
// business), QST to Revenu Québec, and PST to British Columbia, Manitoba or
// Saskatchewan. What a sale is decides whether each tax applies (the rule
// pack, src/rules/sales-tax/ca-2026.ts); where the customer is decides which
// province's taxes; and the business's own registrations decide whether it
// charges them. TrailBook prepares the returns; the business files and pays.

export type CaTaxCode = "GST" | "HST" | "QST" | "PST_BC" | "PST_MB" | "PST_SK";
type PstProvince = "BC" | "MB" | "SK";
const PST_PROVINCES: PstProvince[] = ["BC", "MB", "SK"];
export type Frequency = "monthly" | "quarterly" | "annual";

/** One tax on an invoice: frozen on it, with the account it is owed from. */
export interface CanadaTaxSpec {
  code: CaTaxCode;
  label: string;
  /** Fraction with five decimals ("0.05000"). */
  rate: string;
  authority: string;
  /** System key of the account the tax is credited to. */
  account: string;
}

/** What issueDocument needs to charge Canadian taxes: the taxes, and which apply to each line. */
export interface CanadaInvoiceTax {
  /** The province or territory of supply, or "XX" for a customer outside Canada. */
  place: string;
  taxes: CanadaTaxSpec[];
  lines: { supply: GstStatus; codes: CaTaxCode[] }[];
}

/** documents.ca_tax, as stored. Amounts are minor units as strings. */
export interface CanadaDocTax {
  place: string;
  supplies: { taxable: string; zeroRated: string; exempt: string };
  taxes: (CanadaTaxSpec & { baseMinor: string; amountMinor: string })[];
}

/** document_lines.ca_tax, as stored. */
export interface CanadaLineTax {
  supply: GstStatus;
  taxes: Partial<Record<CaTaxCode, string>>;
}

const round = (d: InstanceType<typeof D>) => BigInt(d.toDecimalPlaces(0, D.ROUND_HALF_UP).toFixed(0));

/** Each tax on a line, rounded to the cent tax by tax, as the CRA and Revenu Québec work them out. */
export function canadaLineTaxes(amountMinor: bigint, codes: CaTaxCode[], taxes: CanadaTaxSpec[]): Partial<Record<CaTaxCode, bigint>> {
  const out: Partial<Record<CaTaxCode, bigint>> = {};
  for (const code of codes) {
    const spec = taxes.find((t) => t.code === code);
    if (!spec) throw new LedgerError("INVALID", `no rate given for ${code}`);
    out[code] = round(new D(amountMinor.toString()).mul(spec.rate));
  }
  return out;
}

export const pct = (rate: string) => `${new D(rate).mul(100).toFixed(3).replace(/\.?0+$/, "")}%`;

// ------------------------------------------------------------- settings

export interface PstRegistration {
  account: string;
  frequency: Frequency;
}

export interface CanadaSalesTaxSettings {
  gstRegistered: boolean;
  /** The business number's RT program account, like 123456789RT0001. */
  gstAccount: string | null;
  gstFrequency: Frequency | null;
  /** Revenu Québec's QST file number, like 1234567890TQ0001. */
  qstAccount: string | null;
  qstFrequency: Frequency | null;
  pst: Partial<Record<PstProvince, PstRegistration>>;
}

const NO_SETTINGS: CanadaSalesTaxSettings = { gstRegistered: false, gstAccount: null, gstFrequency: null, qstAccount: null, qstFrequency: null, pst: {} };

export async function getCanadaSalesTaxSettings(tx: Tx, entityId: string): Promise<CanadaSalesTaxSettings> {
  const r = (await tx.query("SELECT * FROM ca_sales_tax_settings WHERE entity_id = $1", [entityId])).rows[0];
  if (!r) return { ...NO_SETTINGS, pst: {} };
  return {
    gstRegistered: r.gst_registered, gstAccount: r.gst_account, gstFrequency: r.gst_frequency,
    qstAccount: r.qst_account, qstFrequency: r.qst_frequency, pst: r.pst ?? {},
  };
}

const CAN_SET: Role[] = ["owner", "admin", "accountant", "system"];
const FREQUENCIES = new Set<Frequency>(["monthly", "quarterly", "annual"]);

function frequency(v: unknown, what: string): Frequency | null {
  if (v === null || v === undefined || v === "") return null;
  if (!FREQUENCIES.has(v as Frequency)) throw new LedgerError("INVALID", `choose how often you file ${what}: monthly, quarterly or annual`);
  return v as Frequency;
}

/** Records the business's GST/HST, QST and PST registrations and how often it files each. Owners, admins and accountants. */
export async function setCanadaSalesTaxSettings(
  tx: Tx,
  input: {
    orgId: string; entityId: string; actor: Actor;
    gstRegistered: boolean; gstAccount?: string | null; gstFrequency?: string | null;
    qstAccount?: string | null; qstFrequency?: string | null;
    pst?: Partial<Record<string, { account?: string | null; frequency?: string | null } | null>>;
  },
): Promise<CanadaSalesTaxSettings> {
  if (!CAN_SET.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", "only an owner, admin or accountant can change sales tax registrations");
  const ent = (await tx.query("SELECT country FROM entities WHERE id = $1", [input.entityId])).rows[0];
  if (!ent) throw new LedgerError("INVALID", "entity not found");
  if (ent.country !== "CA") throw new LedgerError("INVALID", "GST/HST, PST and QST registrations are for Canadian businesses");
  const tidy = (v: string | null | undefined) => v?.toUpperCase().replace(/[\s-]+/g, "") || null;

  const gstAccount = tidy(input.gstAccount);
  if (gstAccount && !/^\d{9}RT\d{4}$/.test(gstAccount)) throw new LedgerError("INVALID", "the GST/HST account should look like 123456789 RT 0001");
  if (input.gstRegistered && !gstAccount) throw new LedgerError("INVALID", "enter your GST/HST account number, like 123456789 RT 0001");
  const gstFrequency = frequency(input.gstFrequency, "GST/HST");
  if (input.gstRegistered && !gstFrequency) throw new LedgerError("INVALID", "choose how often you file GST/HST: the CRA tells you when you register");
  const qstAccount = tidy(input.qstAccount);
  if (qstAccount && !/^\d{10}TQ\d{4}$/.test(qstAccount)) throw new LedgerError("INVALID", "the QST number should look like 1234567890 TQ 0001");
  const qstFrequency = frequency(input.qstFrequency, "QST");
  if (qstAccount && !qstFrequency) throw new LedgerError("INVALID", "choose how often you file QST");
  if (qstAccount && !input.gstRegistered) throw new LedgerError("INVALID", "register for GST/HST before QST: a QST registrant also collects GST");
  const pst: CanadaSalesTaxSettings["pst"] = {};
  for (const [prov, reg] of Object.entries(input.pst ?? {})) {
    if (!PST_PROVINCES.includes(prov as PstProvince)) throw new LedgerError("INVALID", `${prov} has no provincial sales tax to register for`);
    const account = reg?.account?.trim().toUpperCase().slice(0, 30);
    if (!account) continue;
    const f = frequency(reg?.frequency, `${PROVINCE_NAMES[prov as PstProvince]} PST`);
    if (!f) throw new LedgerError("INVALID", `choose how often you file ${prov === "MB" ? "Manitoba RST" : `${prov} PST`}`);
    pst[prov as PstProvince] = { account, frequency: f };
  }
  const after: CanadaSalesTaxSettings = {
    gstRegistered: input.gstRegistered, gstAccount, gstFrequency: input.gstRegistered ? gstFrequency : null,
    qstAccount, qstFrequency: qstAccount ? qstFrequency : null, pst,
  };
  const before = await getCanadaSalesTaxSettings(tx, input.entityId);
  await tx.query(
    `INSERT INTO ca_sales_tax_settings (entity_id, org_id, gst_registered, gst_account, gst_frequency, qst_account, qst_frequency, pst, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (entity_id) DO UPDATE SET gst_registered = $3, gst_account = $4, gst_frequency = $5, qst_account = $6, qst_frequency = $7, pst = $8, updated_at = now()`,
    [input.entityId, input.orgId, after.gstRegistered, after.gstAccount, after.gstFrequency, after.qstAccount, after.qstFrequency, JSON.stringify(after.pst)],
  );
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "sales_tax.registrations_set",
    objectType: "entity", objectId: input.entityId, before, after, context: { role: input.actor.role },
  });
  return after;
}

// ------------------------------------------------------------- invoices

export interface CanadaTaxDecision {
  /** Fraction with five decimals: the highest combined rate on any line. */
  rate: string;
  /** "canada" when the business charges Canadian taxes (even at 0%), "none" when it isn't registered. */
  source: "canada" | "none";
  jurisdiction: string | null;
  address: string | null;
  note: string | null;
  taxable: boolean[];
  /** Each line's combined rate, five decimals. */
  lineRates: string[];
  canada: CanadaInvoiceTax | null;
  warnings: string[];
  rules: string;
}

const addressText = (r: any) => (r?.address_line1 && r.address_city && r.address_state && r.address_zip
  ? `${r.address_line1}, ${r.address_city}, ${r.address_state} ${r.address_zip}` : null);

/** The small-supplier test: taxable sales over the last four calendar quarters. */
async function smallSupplierWarning(tx: Tx, pack: CanadaSalesTaxPack, entityId: string, date: string, addMinor: bigint): Promise<string | null> {
  const y = Number(date.slice(0, 4));
  const q = Math.floor((Number(date.slice(5, 7)) - 1) / 3);
  const from = new Date(Date.UTC(y, q * 3 - 9, 1)).toISOString().slice(0, 10);
  const billed = (await tx.query(
    `SELECT coalesce(sum(subtotal_minor), 0)::bigint AS s FROM documents
      WHERE entity_id = $1 AND kind = 'invoice' AND status <> 'void' AND issue_date BETWEEN $2::date AND $3::date`,
    [entityId, from, date],
  )).rows[0].s as bigint;
  const total = billed + addMinor;
  const limit = BigInt(new D(pack.smallSupplierLimit).mul(100).toFixed(0));
  if (total <= limit) return null;
  return `You've invoiced $${(Number(total) / 100).toLocaleString("en-CA", { maximumFractionDigits: 0 })} since ${from}. Past $${Number(pack.smallSupplierLimit).toLocaleString("en-CA")} over four calendar quarters you must register for GST/HST and charge it. Once you're registered, record your GST/HST number on the Sales tax page`;
}

const AUTHORITY = { cra: "Canada Revenue Agency", rq: "Revenu Québec" };

/**
 * Decides the Canadian taxes on an invoice. A business that isn't registered
 * for GST/HST charges none (with a warning once it passes the small-supplier
 * limit). Otherwise the place of supply is the customer's province, or the
 * business's own when the customer has no address; a customer outside Canada
 * is an export, zero-rated. Each line then gets HST (in an HST province) or
 * GST, plus QST in Quebec and PST in BC, Manitoba or Saskatchewan when the
 * kind of sale is taxable there and the business is registered for it.
 */
export async function decideCanadaTax(
  tx: Tx,
  input: { entityId: string; contactId: string; date: string; categories: string[]; amounts?: bigint[] },
): Promise<CanadaTaxDecision> {
  const pack = canadaSalesTaxRules(input.date);
  const rules = `${pack.id}@${pack.version}`;
  const cats = input.categories.map((c, i) => {
    const cat = pack.categories[c];
    if (!cat) throw new LedgerError("INVALID", `line ${i + 1}: choose what kind of sale this is`);
    return cat;
  });
  const ent = (await tx.query("SELECT region, address_line1, address_city, address_state, address_zip FROM entities WHERE id = $1", [input.entityId])).rows[0];
  if (!ent) throw new LedgerError("INVALID", "entity not found");
  const contact = (await tx.query(
    "SELECT name, resale_permit, address_line1, address_city, address_state, address_zip FROM contacts WHERE id = $1 AND entity_id = $2",
    [input.contactId, input.entityId],
  )).rows[0];
  if (!contact) throw new LedgerError("INVALID", "choose a customer");
  const settings = await getCanadaSalesTaxSettings(tx, input.entityId);
  const amountsTotal = (input.amounts ?? []).reduce((s, a) => s + a, 0n);
  const contactAddress = addressText(contact);
  const address = contactAddress ?? addressText(ent);
  const zeroLines = { taxable: cats.map(() => false), lineRates: cats.map(() => "0.00000") };

  if (!settings.gstRegistered) {
    const w = await smallSupplierWarning(tx, pack, input.entityId, input.date, amountsTotal);
    return {
      rate: "0.00000", source: "none", jurisdiction: null, address, canada: null, rules, ...zeroLines,
      note: "your business isn't registered for GST/HST, so it charges no sales tax", warnings: w ? [w] : [],
    };
  }

  const outside = contactAddress !== null && !CA_REGIONS.has(contact.address_state);
  const place: string = outside ? "XX"
    : contactAddress ? contact.address_state
    : CA_REGIONS.has(ent.address_state) ? ent.address_state : ent.region;
  const hst = outside ? null : hstRate(pack, place, input.date);
  const rq = ent.region === "QC";
  const specs = new Map<CaTaxCode, CanadaTaxSpec>();
  const spec = (code: CaTaxCode): CaTaxCode => {
    if (specs.has(code)) return code;
    const s: CanadaTaxSpec =
      code === "HST" ? { code, label: `HST ${pct(hst!)}`, rate: new D(hst!).toFixed(5), authority: rq ? AUTHORITY.rq : AUTHORITY.cra, account: "sales_tax_payable" }
      : code === "GST" ? { code, label: `GST ${pct(pack.gstRate)}`, rate: new D(pack.gstRate).toFixed(5), authority: rq ? AUTHORITY.rq : AUTHORITY.cra, account: "sales_tax_payable" }
      : code === "QST" ? { code, label: `QST ${pct(pack.qstRate)}`, rate: new D(pack.qstRate).toFixed(5), authority: AUTHORITY.rq, account: "qst_payable" }
      : (() => {
          const p = pack.pst[code.slice(4) as PstProvince];
          return { code, label: `${p.name} ${pct(p.rate)}`, rate: new D(p.rate).toFixed(5), authority: p.authority, account: "pst_payable" };
        })();
    specs.set(code, s);
    return code;
  };

  const warnings = new Set<string>();
  const notes: string[] = [];
  const lines = cats.map((cat) => {
    if (cat.gst === "exempt") return { supply: "exempt" as const, codes: [] as CaTaxCode[] };
    if (outside || cat.gst === "zero_rated") return { supply: "zero_rated" as const, codes: [] as CaTaxCode[] };
    const codes: CaTaxCode[] = [spec(hst ? "HST" : "GST")];
    if (place === "QC") {
      if (settings.qstAccount) codes.push(spec("QST"));
      else warnings.add("This sale is in Quebec, where QST applies too. If your business is registered for QST, record its QST number on the Sales tax page so TrailBook charges it");
    }
    const prov = place as PstProvince;
    if (PST_PROVINCES.includes(prov) && cat.pst.includes(prov)) {
      const name = pack.pst[prov].name;
      if (contact.resale_permit) notes.push(`No ${name}: ${contact.name} is buying for resale (${contact.resale_permit})`);
      else if (settings.pst[prov]) codes.push(spec(`PST_${prov}` as CaTaxCode));
      else warnings.add(`${name} applies to ${cat.label.toLowerCase()} sold in ${PROVINCE_NAMES[prov]}. If your business is registered to collect it, record the registration on the Sales tax page so TrailBook charges it`);
    }
    return { supply: "taxable" as const, codes };
  });
  const taxes = [...specs.values()];
  const lineRates = lines.map((l) => l.codes.reduce((s, c) => s.add(specs.get(c)!.rate), new D(0)).toFixed(5));
  const rate = lineRates.reduce((m, r) => (new D(r).gt(m) ? r : m), "0.00000");
  const placeName = outside ? `outside Canada (${contact.address_state})` : PROVINCE_NAMES[place as CaRegion] ?? place;
  if (outside) notes.unshift(`Zero-rated export: ${contact.name} is outside Canada`);
  if (!outside && !contactAddress) notes.unshift(`${contact.name} has no address, so the sale is treated as made in ${placeName}, where your business is`);
  const summary = taxes.length ? `${taxes.map((t) => t.label).join(" and ")} for a sale in ${placeName}` : null;
  return {
    rate, source: "canada", jurisdiction: outside ? "Outside Canada" : PROVINCE_NAMES[place as CaRegion] ?? place, address,
    note: [summary, ...notes].filter(Boolean).join(". ") || null,
    taxable: lines.map((l) => l.codes.length > 0), lineRates, canada: { place, taxes, lines }, warnings: [...warnings], rules,
  };
}

/** One line a person can read: what Canadian taxes an invoice charges. */
export function explainCanadaTax(t: { source: string; note: string | null; canada?: CanadaInvoiceTax | null }): string {
  if (t.source === "none") return `No sales tax: ${t.note ?? "your business isn't registered for GST/HST"}.`;
  if (!t.canada?.taxes.length) return `No tax charged${t.note ? `: ${t.note}` : ""}.`;
  return `${t.note}.`;
}

// ---------------------------------------------------------------- bills

/** Input tax credits and refunds on a bill: the GST/HST and QST the vendor charged. */
export interface BillCanadaTax {
  /** Major units ("13.00"). */
  gstHst?: string;
  qst?: string;
}

/** The bill lines that claim back the GST/HST and QST a vendor charged. PST paid stays in the cost. */
export function canadaCreditLines(caTax: BillCanadaTax, subtotalMinor: bigint): { account: string; description: string; quantity: string; unitPrice: string }[] {
  const out: { account: string; description: string; quantity: string; unitPrice: string }[] = [];
  const add = (v: string | undefined, account: string, label: string, max: string) => {
    if (!v || new D(v).isZero()) return;
    if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new LedgerError("INVALID", `${label} should be an amount like 13.00`);
    if (new D(v).mul(100).gt(new D(subtotalMinor.toString()).mul(max))) {
      throw new LedgerError("INVALID", `${label} of ${v} is more than ${pct(max)} of the bill; check the amount`);
    }
    out.push({ account, description: label, quantity: "1", unitPrice: new D(v).toFixed(2) });
  };
  add(caTax.gstHst, "gst_itc", "GST/HST paid (input tax credit)", "0.15");
  add(caTax.qst, "qst_itr", "QST paid (input tax refund)", "0.09975");
  return out;
}

// --------------------------------------------------------------- returns

export type CaReturnTax = "gst" | "qst" | "pst_bc" | "pst_mb" | "pst_sk";

export interface CaReturnPeriod {
  key: string;
  label: string;
  from: string;
  to: string;
  dueDate: string;
}

export interface CaRegistration {
  tax: CaReturnTax;
  name: string;
  authority: string;
  account: string;
  frequency: Frequency;
  periods: CaReturnPeriod[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
const monthEnd = (y: number, m0: number) => iso(y, m0 + 1, 0);

/**
 * Due dates. GST/HST and QST: one month after a monthly or quarterly period
 * ends; an annual return three months after the year ends, or June 15 for a
 * sole proprietor or partnership of individuals (whose payment is still due
 * April 30). BC PST: the last day of the next month. Manitoba RST and
 * Saskatchewan PST: the 20th of the next month. A due date on a weekend or
 * holiday moves to the next business day.
 */
function dueDate(tax: CaReturnTax, frequency: Frequency, to: string, individual: boolean): string {
  const [y, m] = to.split("-").map(Number) as [number, number];
  const cal: Calendar = tax === "qst" ? "quebec" : "canada";
  let due: string;
  if (tax === "gst" || tax === "qst") {
    due = frequency === "annual" ? (individual ? `${y + 1}-06-15` : monthEnd(y + 1, 2)) : monthEnd(y, m);
  } else if (tax === "pst_bc") due = monthEnd(y, m);
  else due = iso(y, m, 20);
  return onOrNextBusinessDay(due, cal);
}

export function canadaReturnPeriods(tax: CaReturnTax, frequency: Frequency, year: number, individual = false): CaReturnPeriod[] {
  const out: CaReturnPeriod[] = [];
  const push = (key: string, label: string, from: string, to: string) => out.push({ key, label, from, to, dueDate: dueDate(tax, frequency, to, individual) });
  if (frequency === "monthly") for (let m = 0; m < 12; m++) push(`${year}-M${String(m + 1).padStart(2, "0")}`, `${MONTHS[m]} ${year}`, iso(year, m, 1), monthEnd(year, m));
  else if (frequency === "quarterly") for (let q = 0; q < 4; q++) push(`${year}-Q${q + 1}`, `${MONTHS[q * 3]} to ${MONTHS[q * 3 + 2]} ${year}`, iso(year, q * 3, 1), monthEnd(year, q * 3 + 2));
  else push(`${year}`, `${year}`, `${year}-01-01`, `${year}-12-31`);
  return out;
}

const TAX_NAMES: Record<CaReturnTax, string> = { gst: "GST/HST", qst: "QST", pst_bc: "BC PST", pst_mb: "Manitoba RST", pst_sk: "Saskatchewan PST" };

async function entityInfo(tx: Tx, entityId: string) {
  const ent = (await tx.query("SELECT legal_name, country, region, entity_type FROM entities WHERE id = $1", [entityId])).rows[0];
  if (!ent) throw new LedgerError("INVALID", "entity not found");
  if (ent.country !== "CA") throw new LedgerError("INVALID", "GST/HST, PST and QST returns are for Canadian businesses");
  return { ...ent, individual: ent.entity_type === "ca_sole_prop" || ent.entity_type === "ca_partnership" };
}

/** The business's registrations, each with its filing periods and due dates for a year. */
export async function canadaRegistrations(tx: Tx, entityId: string, year: number): Promise<{ settings: CanadaSalesTaxSettings; registrations: CaRegistration[] }> {
  const ent = await entityInfo(tx, entityId);
  const s = await getCanadaSalesTaxSettings(tx, entityId);
  const pack = canadaSalesTaxRules(`${year}-01-01`);
  const regs: CaRegistration[] = [];
  if (s.gstRegistered && s.gstAccount && s.gstFrequency) {
    regs.push({ tax: "gst", name: "GST/HST", authority: ent.region === "QC" ? AUTHORITY.rq : AUTHORITY.cra, account: s.gstAccount, frequency: s.gstFrequency, periods: canadaReturnPeriods("gst", s.gstFrequency, year, ent.individual) });
  }
  if (s.qstAccount && s.qstFrequency) {
    regs.push({ tax: "qst", name: "QST", authority: AUTHORITY.rq, account: s.qstAccount, frequency: s.qstFrequency, periods: canadaReturnPeriods("qst", s.qstFrequency, year, ent.individual) });
  }
  for (const p of PST_PROVINCES) {
    const r = s.pst[p];
    if (!r) continue;
    const tax = `pst_${p.toLowerCase()}` as CaReturnTax;
    regs.push({ tax, name: pack.pst[p].name, authority: pack.pst[p].authority, account: r.account, frequency: r.frequency, periods: canadaReturnPeriods(tax, r.frequency, year) });
  }
  return { settings: s, registrations: regs };
}

export interface CaReturnLine {
  line: string;
  label: string;
  valueMinor: bigint;
  note?: string;
}

export interface CanadaSalesTaxReturn {
  tax: CaReturnTax;
  title: string;
  authority: string;
  account: string;
  business: string;
  period: CaReturnPeriod;
  lines: CaReturnLine[];
  /** Positive: owed. Negative: a refund to claim. */
  netMinor: bigint;
  invoices: number;
  notes: string[];
}

const CODES: Record<CaReturnTax, CaTaxCode[]> = { gst: ["GST", "HST"], qst: ["QST"], pst_bc: ["PST_BC"], pst_mb: ["PST_MB"], pst_sk: ["PST_SK"] };

/**
 * A return's figures for one period, accrual basis: invoices dated in the
 * period and not voided by its end, and the credits claimed on bills posted
 * in it. Prepares the figures; filing and paying stay with the business.
 */
export async function canadaSalesTaxReturn(tx: Tx, entityId: string, tax: CaReturnTax, periodKey: string): Promise<CanadaSalesTaxReturn> {
  const ent = await entityInfo(tx, entityId);
  const year = Number(periodKey.slice(0, 4));
  if (!Number.isInteger(year) || year < 2000) throw new LedgerError("INVALID", "choose a filing period");
  const { registrations } = await canadaRegistrations(tx, entityId, year);
  const reg = registrations.find((r) => r.tax === tax);
  if (!reg) throw new LedgerError("INVALID", `record your ${TAX_NAMES[tax]} registration on the Sales tax page first`);
  const period = reg.periods.find((p) => p.key === periodKey);
  if (!period) throw new LedgerError("INVALID", `${periodKey} isn't one of your ${TAX_NAMES[tax]} filing periods`);

  const docs = (await tx.query(
    `SELECT ca_tax FROM documents
      WHERE entity_id = $1 AND kind = 'invoice' AND tax_source = 'canada' AND issue_date BETWEEN $2 AND $3
        AND NOT (status = 'void' AND void_date <= $3)`,
    [entityId, period.from, period.to],
  )).rows.map((r) => r.ca_tax as CanadaDocTax);
  const codes = CODES[tax];
  let collected = 0n;
  let base = 0n;
  let supplies = 0n;
  let zeroRated = 0n;
  let exempt = 0n;
  for (const d of docs) {
    supplies += BigInt(d.supplies.taxable) + BigInt(d.supplies.zeroRated);
    zeroRated += BigInt(d.supplies.zeroRated);
    exempt += BigInt(d.supplies.exempt);
    for (const t of d.taxes) {
      if (!codes.includes(t.code)) continue;
      collected += BigInt(t.amountMinor);
      base += BigInt(t.baseMinor);
    }
  }
  const credits = async (key: string) => (await tx.query(
    `SELECT coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint AS b
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE l.entity_id = $1 AND a.system_key = $2 AND e.entry_date BETWEEN $3 AND $4`,
    [entityId, key, period.from, period.to],
  )).rows[0].b as bigint;

  const head = { tax, authority: reg.authority, account: reg.account, business: ent.legal_name, period, invoices: docs.length };
  if (tax === "gst") {
    const itc = await credits("gst_itc");
    const net = collected - itc;
    return {
      ...head, title: `GST/HST return for ${period.label}`, netMinor: net,
      lines: [
        { line: "101", label: "Sales and other revenue", valueMinor: supplies, note: `taxable and zero-rated sales (${fmt(zeroRated)} zero-rated); ${fmt(exempt)} of exempt sales left out` },
        { line: "103", label: "GST/HST collected or collectible", valueMinor: collected },
        { line: "104", label: "Adjustments", valueMinor: 0n, note: "bad debts and other adjustments: add any by hand" },
        { line: "105", label: "Total GST/HST and adjustments", valueMinor: collected },
        { line: "106", label: "Input tax credits", valueMinor: itc, note: "GST/HST paid on bills posted in the period" },
        { line: "107", label: "Adjustments", valueMinor: 0n },
        { line: "108", label: "Total ITCs and adjustments", valueMinor: itc },
        { line: "109", label: "Net tax", valueMinor: net },
        { line: net >= 0n ? "113A" : "114", label: net >= 0n ? "Balance owing (before instalments)" : "Refund claimed", valueMinor: net >= 0n ? net : -net },
      ],
      notes: [
        "Uses the regular method. If you use the Quick Method, your accountant works out line 103 differently.",
        "Instalments you've paid (line 110) and rebates (line 111) aren't tracked in TrailBook; subtract them when you file.",
      ],
    };
  }
  if (tax === "qst") {
    const itr = await credits("qst_itr");
    const net = collected - itr;
    return {
      ...head, title: `QST return for ${period.label}`, netMinor: net,
      lines: [
        { line: "201", label: "Sales and other revenue", valueMinor: supplies },
        { line: "205", label: "QST collected or collectible", valueMinor: collected },
        { line: "206", label: "Input tax refunds", valueMinor: itr, note: "QST paid on bills posted in the period" },
        { line: "209", label: "Net tax", valueMinor: net },
      ],
      notes: ["Revenu Québec's combined return also has the GST/HST lines; see the GST/HST return for the same period."],
    };
  }
  return {
    ...head, title: `${TAX_NAMES[tax]} return for ${period.label}`, netMinor: collected,
    lines: [
      { line: "", label: "Taxable sales", valueMinor: base },
      { line: "", label: `${TAX_NAMES[tax]} collected`, valueMinor: collected },
    ],
    notes: [
      "PST you owe on things you bought without paying PST (self-assessment) isn't included; add it when you file.",
      "Your province may let you keep a commission when you file and pay on time; it isn't deducted here.",
    ],
  };
}

const fmt = (minor: bigint) => `$${(Number(minor) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ------------------------------------------------------- on the invoice

/** Each tax charged, for the invoice's totals: "GST 5%: $50.00". */
export function invoiceTaxRows(caTax: CanadaDocTax | null | undefined): { label: string; amountMinor: bigint }[] {
  return (caTax?.taxes ?? []).filter((t) => BigInt(t.amountMinor) > 0n).map((t) => ({ label: t.label, amountMinor: BigInt(t.amountMinor) }));
}

/**
 * The registration numbers a Canadian invoice shows: a customer needs the
 * supplier's GST/HST number (and QST number) on it to claim credits.
 */
export async function invoiceTaxNumbers(tx: Tx, entityId: string, caTax: CanadaDocTax | null | undefined): Promise<string[]> {
  if (!caTax) return [];
  const s = await getCanadaSalesTaxSettings(tx, entityId);
  const codes = new Set(caTax.taxes.map((t) => t.code));
  const out: string[] = [];
  if (s.gstAccount) out.push(`GST/HST registration no. ${s.gstAccount}`);
  if (s.qstAccount && codes.has("QST")) out.push(`QST registration no. ${s.qstAccount}`);
  for (const p of PST_PROVINCES) if (s.pst[p] && codes.has(`PST_${p}` as CaTaxCode)) out.push(`${p === "MB" ? "Manitoba RST" : `${p} PST`} no. ${s.pst[p]!.account}`);
  return out;
}
