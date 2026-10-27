import type { Tx } from "../db/pool.js";
import { onOrNextBusinessDay, quarterEnd } from "../payroll/business-days.js";
import { appendAudit } from "./audit.js";
import { LedgerError } from "./errors.js";
import type { Actor, Role } from "./ledger.js";
import { D, type Dec } from "./money.js";
import { rulesFor, salesTaxReport } from "./sales-tax.js";

// The business's own California sales and use tax return (CDTFA-401), as a
// worksheet. Every figure comes from issued invoices and the tax frozen on
// each. Alt-QBO prepares the figures; the business (or its accountant) files
// the return and pays in CDTFA online services. Alt-QBO doesn't file anything.

export const FILING_FREQUENCIES = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  quarterly_prepay: "Quarterly with prepayments",
  yearly: "Yearly (calendar year)",
  fiscal_yearly: "Fiscal yearly (July to June)",
} as const;
export type FilingFrequency = keyof typeof FILING_FREQUENCIES;

const CAN_SET: Role[] = ["owner", "admin", "accountant", "system"];

export interface SalesTaxSettings {
  sellerPermit: string | null;
  filingFrequency: FilingFrequency | null;
}

export interface ReturnPeriod {
  /** "2027-M01", "2027-Q1", "2027" or "FY2027" (July 2026 to June 2027). */
  key: string;
  label: string;
  from: string;
  to: string;
  dueDate: string;
  /** Quarterly prepayments, for the first two months of the quarter. */
  prepayments?: { month: string; from: string; to: string; dueDate: string }[];
}

export interface ReturnLine {
  line: string;
  label: string;
  value: bigint | string | null;
  kind?: "money" | "text";
  note?: string;
}

export interface SalesTaxReturn {
  form: "CDTFA-401";
  title: string;
  period: ReturnPeriod;
  seller: { name: string; sellerPermit: string | null; address: string | null; filingFrequency: FilingFrequency | null };
  lines: ReturnLine[];
  /** District taxes by place, for Schedule A. */
  districts: { jurisdiction: string; rate: string; taxableMinor: bigint; taxMinor: bigint; districtTaxMinor: bigint }[];
  warnings: string[];
  fileAt: string;
}

const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12)).toISOString().slice(0, 10);
const monthEnd = (y: number, m: number) => iso(y, m + 1, 0);
const due = (date: string) => onOrNextBusinessDay(date, "california");
/** The last day of the month after `to`: when every CDTFA return is due. */
const returnDue = (to: string) => due(monthEnd(Number(to.slice(0, 4)), Number(to.slice(5, 7)) + 1));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The period a key names, with its due date. */
export function returnPeriod(key: string): ReturnPeriod {
  let m = key.match(/^(\d{4})-M(\d{2})$/);
  if (m) {
    const [y, mo] = [Number(m[1]), Number(m[2])];
    if (mo < 1 || mo > 12) throw new LedgerError("INVALID", "no such month");
    const to = monthEnd(y, mo);
    return { key, label: `${MONTHS[mo - 1]} ${y}`, from: iso(y, mo, 1), to, dueDate: returnDue(to) };
  }
  m = key.match(/^(\d{4})-Q([1-4])(P?)$/);
  if (m) {
    const [y, q] = [Number(m[1]), Number(m[2])];
    const from = iso(y, q * 3 - 2, 1);
    const to = quarterEnd(y, q);
    const period: ReturnPeriod = { key, label: `Q${q} ${y}`, from, to, dueDate: returnDue(to) };
    if (m[3]) {
      // Prepayments for the first two months, due the 24th of the month after each. In the
      // second quarter the second one covers May 1 to June 15, still due June 24.
      period.prepayments = [0, 1].map((i) => {
        const mo = q * 3 - 2 + i;
        if (q === 2 && i === 1) return { month: "May and June 1-15", from: iso(y, 5, 1), to: iso(y, 6, 15), dueDate: due(iso(y, 6, 24)) };
        return { month: MONTHS[mo - 1]!, from: iso(y, mo, 1), to: monthEnd(y, mo), dueDate: due(iso(y, mo + 1, 24)) };
      });
    }
    return period;
  }
  m = key.match(/^(\d{4})$/);
  if (m) {
    const y = Number(m[1]);
    return { key, label: String(y), from: iso(y, 1, 1), to: iso(y, 12, 31), dueDate: due(iso(y + 1, 1, 31)) };
  }
  m = key.match(/^FY(\d{4})$/);
  if (m) {
    const y = Number(m[1]);
    return { key, label: `July ${y - 1} to June ${y}`, from: iso(y - 1, 7, 1), to: iso(y, 6, 30), dueDate: due(iso(y, 7, 31)) };
  }
  throw new LedgerError("INVALID", "the period should look like 2027-Q1, 2027-M01, 2027 or FY2027");
}

/** The return periods that have started in a calendar year, newest first. */
export function returnPeriods(frequency: FilingFrequency, year: number, today: string): ReturnPeriod[] {
  const keys =
    frequency === "monthly" ? Array.from({ length: 12 }, (_, i) => `${year}-M${String(i + 1).padStart(2, "0")}`)
    : frequency === "quarterly" ? [1, 2, 3, 4].map((q) => `${year}-Q${q}`)
    : frequency === "quarterly_prepay" ? [1, 2, 3, 4].map((q) => `${year}-Q${q}P`)
    : frequency === "yearly" ? [String(year)]
    : [`FY${year}`, `FY${year + 1}`];
  return keys.map(returnPeriod).filter((p) => p.from <= today && p.from.slice(0, 4) <= String(year)).reverse();
}

export async function salesTaxSettings(tx: Tx, entityId: string): Promise<SalesTaxSettings> {
  const r = (await tx.query("SELECT seller_permit, sales_tax_filing FROM entities WHERE id = $1", [entityId])).rows[0];
  if (!r) throw new LedgerError("INVALID", "entity not found");
  return { sellerPermit: r.seller_permit, filingFrequency: r.sales_tax_filing };
}

/** Records the business's seller's permit and filing frequency, as on the CDTFA's permit letter. */
export async function setSalesTaxSettings(
  tx: Tx,
  input: { orgId: string; entityId: string; sellerPermit?: string | null; filingFrequency?: string | null; actor: Actor },
): Promise<SalesTaxSettings> {
  if (!CAN_SET.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", `role ${input.actor.role} cannot change sales tax settings`);
  const before = await salesTaxSettings(tx, input.entityId);
  const after = { ...before };
  if (input.sellerPermit !== undefined) {
    const permit = (input.sellerPermit ?? "").trim().toUpperCase().replace(/\s+/g, " ");
    if (permit && !/^[A-Z0-9][A-Z0-9 -]{4,23}$/.test(permit)) {
      throw new LedgerError("INVALID", "enter the seller's permit number as it appears on the permit, letters, digits and dashes only");
    }
    after.sellerPermit = permit || null;
  }
  if (input.filingFrequency !== undefined) {
    const f = input.filingFrequency || null;
    if (f !== null && !(f in FILING_FREQUENCIES)) throw new LedgerError("INVALID", "pick how often the CDTFA has you file");
    after.filingFrequency = f as FilingFrequency | null;
  }
  await tx.query("UPDATE entities SET seller_permit = $2, sales_tax_filing = $3 WHERE id = $1", [input.entityId, after.sellerPermit, after.filingFrequency]);
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "entity.sales_tax_settings_set",
    objectType: "entity", objectId: input.entityId, before: { ...before }, after: { ...after }, context: { role: input.actor.role },
  });
  return after;
}

const round = (d: Dec) => BigInt(d.toDecimalPlaces(0, D.ROUND_HALF_UP).toFixed(0));
const money = (line: string, label: string, value: bigint | null, note?: string): ReturnLine => ({ line, label, value, kind: "money", ...(note ? { note } : {}) });

/**
 * The return for one period, built on the sales tax report (accrual basis:
 * invoices dated in the period, less those voided by its end). On top of the
 * report it computes the tax the return will show, compares it with the tax
 * charged, and lists what to check before filing.
 */
export async function prepareSalesTaxReturn(tx: Tx, entityId: string, periodKey: string): Promise<SalesTaxReturn> {
  const period = returnPeriod(periodKey);
  const ent = (await tx.query(
    "SELECT legal_name, region, seller_permit, sales_tax_filing, address_line1, address_city, address_state, address_zip FROM entities WHERE id = $1",
    [entityId],
  )).rows[0];
  if (!ent) throw new LedgerError("INVALID", "entity not found");
  const pack = rulesFor(ent.region, period.to);
  const r = await salesTaxReport(tx, entityId, period.from, period.to);

  // Taxable sales and purchases subject to use tax are taxed alike: 7.25% statewide, plus each place's district tax.
  const places = new Map<string, { jurisdiction: string; rate: string; taxableMinor: bigint }>();
  const add = (jurisdiction: string, ratePercent: string, amount: bigint) => {
    const rate = new D(ratePercent).div(100).toFixed(5);
    const k = `${jurisdiction}|${rate}`;
    const row = places.get(k) ?? { jurisdiction, rate, taxableMinor: 0n };
    row.taxableMinor += amount;
    places.set(k, row);
  };
  for (const j of r.byJurisdiction) add(j.jurisdiction, j.ratePercent, j.taxableMinor);
  for (const j of r.useTax.byJurisdiction) add(j.jurisdiction, j.ratePercent, j.purchasesMinor);
  const districts = [...places.values()].map((d) => {
    const districtRate = D.max(new D(d.rate).minus(pack.statewideRate), 0);
    return {
      ...d,
      taxMinor: round(new D(d.taxableMinor.toString()).mul(d.rate)),
      districtTaxMinor: round(new D(d.taxableMinor.toString()).mul(districtRate)),
    };
  }).sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction));
  const taxable = r.taxableMinor + r.useTax.purchasesMinor;
  const state = round(new D(taxable.toString()).mul(pack.statewideRate));
  const districtTax = districts.reduce((s, d) => s + d.districtTaxMinor, 0n);
  const computed = state + districtTax;
  const charged = r.taxMinor + r.useTax.taxMinor;
  const nontaxable = r.nontaxable.reduce((s, n) => s + n.amountMinor, 0n);
  const deductions = r.resaleMinor + r.interstateMinor + nontaxable + r.directPayMinor + r.outsideCaUseMinor;

  const warnings: string[] = [];
  if (!ent.seller_permit) warnings.push("Record your seller's permit number on this page's settings. It goes at the top of every return");
  if (!ent.sales_tax_filing) warnings.push("Record how often the CDTFA has you file (it's on your permit), so Alt-QBO shows the right periods and due dates");
  if (charged > computed) {
    warnings.push(`Your invoices charged ${usdText(charged - computed)} more tax than the return computes, from per-invoice rounding or a rate set by hand. Tax collected from customers is owed to the state even when it is more than the tax due, so pay the extra with this return (Rev. & Tax. Code §6901.5)`);
  }
  if (districts.some((d) => d.jurisdiction.startsWith("Set by hand") || d.jurisdiction === "Entered by user")) {
    warnings.push("Some invoices had their rate set by hand. Check which district each belongs to before you fill in Schedule A");
  }
  const lateVoids = (await tx.query(
    `SELECT number, issue_date::text, void_date::text, tax_minor FROM documents
      WHERE entity_id = $1 AND kind = 'invoice' AND status = 'void' AND void_date BETWEEN $2::date AND $3::date AND issue_date < $2::date
      ORDER BY void_date, number`,
    [entityId, period.from, period.to],
  )).rows;
  for (const v of lateVoids) {
    warnings.push(`Invoice ${v.number} (${v.issue_date}) was voided on ${v.void_date}, after its own period. If that period's return is filed, take the sale off it with an amended return${BigInt(v.tax_minor) ? ` and refund the ${usdText(BigInt(v.tax_minor))} of tax to the customer` : ""}`);
  }

  const lines: ReturnLine[] = [
    money("Total sales", "Total (gross) sales", r.totalSalesMinor, "Invoice amounts before sales tax, for invoices dated in the period"),
    money("Use tax", "Purchases subject to use tax", r.useTax.purchasesMinor, "Bills that accrued California use tax because the vendor didn't charge it"),
    money("Deduction", "Sales to other retailers for resale", r.resaleMinor, "Customers with a resale certificate on file"),
    money("Deduction", "Sales in interstate and foreign commerce", r.interstateMinor, "Delivered outside California, or software billed to an address outside it"),
    money("Deduction", "Nontaxable sales (services and other)", nontaxable, r.nontaxable.map((n) => `${n.label} ${usdText(n.amountMinor)}`).join("; ") || undefined),
    money("Deduction", "Software sold to buyers with a use tax direct payment permit", r.directPayMinor, "The buyer reports the tax (SB 122). Claim it under other deductions and describe it"),
    money("Deduction", "Software used outside California (multiple points of use)", r.outsideCaUseMinor, "The out-of-state share from customers' certificates. Claim it under other deductions and describe it"),
    money("Deduction", "Sales tax included in total sales", 0n, "Alt-QBO keeps the tax apart from the sale, so there is none to deduct"),
    money("Deduction", "Bad debt losses on taxable sales", null, "Alt-QBO doesn't track written-off invoices yet. Enter any you wrote off this period"),
    money("Total deductions", "Total deductions", deductions),
    money("Taxable", "Total taxable sales and purchases", taxable),
    { line: "Rate", label: "State and local rate", value: `${new D(pack.statewideRate).mul(100).toString()}%`, kind: "text" },
    money("State and local tax", "State and local tax on the taxable total", state),
    money("District tax", "District taxes (from Schedule A)", districtTax),
    money("Total tax", "Total tax on this return", computed),
    money("Charged", "Sales tax charged on invoices and use tax accrued on bills, for comparison", charged, "It should match the total tax, give or take rounding"),
  ];
  for (const p of period.prepayments ?? []) {
    const m = await salesTaxReport(tx, entityId, p.from, p.to);
    const share = p.to.endsWith("-06-15")
      ? "Tax charged May 1 to June 15. Prepay at least 90% of May's tax plus 90% of June 1-15's (or 135% of May's, or half of last year's second quarter)"
      : "The month's tax charged. Prepay at least 90% of it, or a third of the same quarter's tax last year if you were in business all of that quarter";
    lines.push(money("Prepayment", `${p.month} prepayment, due ${p.dueDate}`, m.taxMinor, share));
  }

  return {
    form: "CDTFA-401",
    title: "California sales and use tax return worksheet",
    period,
    seller: {
      name: ent.legal_name, sellerPermit: ent.seller_permit, filingFrequency: ent.sales_tax_filing,
      address: ent.address_line1 ? `${ent.address_line1}, ${ent.address_city}, ${ent.address_state} ${ent.address_zip}` : null,
    },
    lines,
    districts,
    warnings,
    fileAt: "File and pay in CDTFA online services by the due date",
  };
}

function usdText(minor: bigint) {
  return `$${(Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
