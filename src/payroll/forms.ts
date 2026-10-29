import type { Tx } from "../db/pool.js";
import { appendAudit } from "../core/audit.js";
import { LedgerError } from "../core/errors.js";
import type { Actor, Role } from "../core/ledger.js";
import { D, toMajor, toMinor } from "../core/money.js";
import { unseal } from "../core/pii.js";
import { resolveRules, statePackFor, type Place, type StateQuarterlyForm, type StateRulePack } from "../rules/index.js";
import { addDays, endOfNextMonth, onOrNextBusinessDay, quarterEnd, quarterOf } from "./business-days.js";
import type { DepositKind } from "./deposits.js";
import type { Paycheck } from "./gross-to-net.js";
import { placeOf } from "./tax-deposits.js";

// Prepared payroll tax forms: Form 941 and Form 940 for the IRS, the state's
// quarterly returns (California's DE 9 and DE 9C, other states' UI wage
// reports and withholding returns, as their rule packs list them), and W-2s
// with their W-3 for employees and the SSA. Every figure comes from posted
// pay runs and recorded deposits. TrailBook prepares the figures; the
// business (or its accountant) files them with each agency, and signs.

const CAN_SEE_SSN: Role[] = ["owner", "admin", "accountant", "system"];

interface PostedRun {
  id: string;
  payDate: string;
  periodStart: string;
  periodEnd: string;
  paychecks: Paycheck[];
}

interface Employer {
  name: string;
  ein: string | null;
  address: { line1: string; city: string; state: string; zip: string } | null;
  /** The business's state, for state lines and labels. */
  state: { code: string; name: string };
  /** The state payroll account number (EDD in California). */
  stateEmployerAccount: string | null;
  /** Rates by tax code: the employer's assigned rate where it has one, else the pack's. */
  stateRates: Record<string, string>;
  federalSchedule: "monthly" | "semiweekly";
}

export interface FormLine {
  line: string;
  label: string;
  /** Cents, or a plain count or rate when `kind` says so. */
  value: bigint | string | number | null;
  kind?: "money" | "count" | "rate" | "text";
  note?: string;
}

export interface PreparedForm {
  form: string;
  title: string;
  period: string;
  dueDate: string;
  employer: Employer;
  lines: FormLine[];
  /** Per-employee rows (DE 9C, W-2), when the form has them. */
  employees?: Record<string, unknown>[];
  /** Monthly or per-day liabilities (941 line 16 or Schedule B; 940 Part 5). */
  liabilities?: { label: string; amountMinor: bigint }[];
  warnings: string[];
  fileAt: string;
}

const big = (v: unknown) => BigInt((v as string | number | bigint | undefined) ?? 0);

function revive(p: any): Paycheck {
  return {
    ...p,
    grossMinor: big(p.grossMinor), reimbursementMinor: big(p.reimbursementMinor), netPayMinor: big(p.netPayMinor),
    employeeTaxMinor: big(p.employeeTaxMinor), employerTaxMinor: big(p.employerTaxMinor),
    deductions: p.deductions.map((d: any) => ({ ...d, amountMinor: big(d.amountMinor) })),
    taxes: p.taxes.map((t: any) => ({ ...t, taxableWagesMinor: big(t.taxableWagesMinor), amountMinor: big(t.amountMinor) })),
  };
}

async function load(tx: Tx, entityId: string, from: string, to: string) {
  const { rows } = await tx.query(
    `SELECT id, pay_date::text, result FROM pay_runs
      WHERE entity_id = $1 AND status = 'posted' AND pay_date >= $2 AND pay_date <= $3 ORDER BY pay_date, created_at`,
    [entityId, from, to],
  );
  const runs: PostedRun[] = rows.map((r) => ({
    id: r.id, payDate: r.pay_date, periodStart: r.result.periodStart, periodEnd: r.result.periodEnd, paychecks: r.result.paychecks.map(revive),
  }));
  const e = (await tx.query(
    `SELECT legal_name, ein, country, region, address_line1, address_city, address_state, address_zip, state_employer_id, state_tax_rates, federal_deposit_schedule
       FROM entities WHERE id = $1`, [entityId],
  )).rows[0];
  const place: Place = { country: e.country, region: e.region };
  const pack = statePackFor(place, to);
  const stateRates: Record<string, string> = {};
  for (const t of pack.payroll.taxes) stateRates[t.code] = (t.assignedRate && e.state_tax_rates?.[t.code]) || t.rate;
  const employer: Employer = {
    name: e.legal_name, ein: e.ein,
    address: e.address_line1 ? { line1: e.address_line1, city: e.address_city, state: e.address_state, zip: e.address_zip } : null,
    state: { code: e.region, name: pack.name }, stateEmployerAccount: e.state_employer_id, stateRates,
    federalSchedule: e.federal_deposit_schedule,
  };
  return { runs, employer, place, pack };
}

/** Deposits recorded against this period's liabilities, by kind of deposit and tax code. */
async function depositsPaid(tx: Tx, entityId: string, kinds: DepositKind[], inPeriod: (key: string) => boolean) {
  const { rows } = await tx.query("SELECT deposit_key, by_tax FROM tax_deposit_payments WHERE entity_id = $1 AND kind = ANY($2)", [entityId, kinds]);
  const out: Record<string, bigint> = {};
  for (const r of rows) {
    if (!inPeriod(r.deposit_key)) continue;
    for (const [code, v] of Object.entries(r.by_tax as Record<string, string>)) out[code] = (out[code] ?? 0n) + BigInt(v);
  }
  return out;
}

/** Deposits recorded for a state form's tax codes in a quarter. */
async function stateDepositsPaid(tx: Tx, entityId: string, pack: StateRulePack, codes: string[], from: string, to: string) {
  const kinds = pack.payroll.deposits.filter((d) => d.codes.some((c) => codes.includes(c))).map((d) => d.kind);
  const paid = await depositsPaid(tx, entityId, kinds, (k) => { const d = keyDate(k); return d >= from && d <= to; });
  return codes.reduce((s, c) => s + (paid[c] ?? 0n), 0n);
}

/** The pay date a deposit key's liabilities belong to, enough to place it in a quarter or year. */
function keyDate(key: string): string {
  const q = key.match(/(\d{4})-Q(\d)/);
  if (q) return quarterEnd(Number(q[1]), Number(q[2]));
  const d = key.match(/(\d{4}-\d{2})(-\d{2})?/);
  return d ? `${d[1]}${d[2] ?? "-01"}` : "";
}

const sumTax = (runs: PostedRun[], code: string, field: "amountMinor" | "taxableWagesMinor" = "amountMinor") =>
  runs.reduce((s, r) => s + r.paychecks.reduce((t, p) => t + (p.taxes.find((x) => x.code === code)?.[field] ?? 0n), 0n), 0n);
const sumDeduction = (runs: PostedRun[], kind: string) =>
  runs.reduce((s, r) => s + r.paychecks.reduce((t, p) => t + p.deductions.filter((d) => d.kind === kind).reduce((u, d) => u + d.amountMinor, 0n), 0n), 0n);
const times = (wagesMinor: bigint, rate: string) => toMinor(toMajor(wagesMinor).mul(rate).toFixed(2));
const money = (line: string, label: string, value: bigint | null, note?: string): FormLine => ({ line, label, value, kind: "money", ...(note ? { note } : {}) });

/** Distinct employees paid for a pay period that includes the given date. */
function paidOn(runs: PostedRun[], date: string): number {
  const ids = new Set<string>();
  for (const r of runs) if (r.periodStart <= date && date <= r.periodEnd) for (const p of r.paychecks) if (p.grossMinor > 0n) ids.add(p.employeeId);
  return ids.size;
}

function quarterRange(year: number, q: number) {
  const from = `${year}-${String((q - 1) * 3 + 1).padStart(2, "0")}-01`;
  return { from, to: quarterEnd(year, q), months: [0, 1, 2].map((i) => `${year}-${String((q - 1) * 3 + 1 + i).padStart(2, "0")}`) };
}

const FICA: string[] = ["SS_EE", "SS_ER", "MEDICARE_EE", "MEDICARE_ER", "ADDL_MEDICARE_EE"];
const liability941 = (r: PostedRun) => r.paychecks.reduce((s, p) => s + p.taxes.filter((t) => t.code === "FIT" || FICA.includes(t.code)).reduce((u, t) => u + t.amountMinor, 0n), 0n);

function checkQuarter(year: number, q: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || ![1, 2, 3, 4].includes(q)) throw new LedgerError("INVALID", "pick a year and a quarter from 1 to 4");
}

/** Form 941 for a quarter. */
export async function form941(tx: Tx, entityId: string, year: number, q: number): Promise<PreparedForm> {
  checkQuarter(year, q);
  const { from, to, months } = quarterRange(year, q);
  const { runs, employer } = await load(tx, entityId, from, to);
  const rates = resolveRules(await placeOf(tx, entityId), to).federal.payroll;
  const ssRate = new D(rates.socialSecurity.employeeRate).add(rates.socialSecurity.employerRate).toString();
  const medRate = new D(rates.medicare.employeeRate).add(rates.medicare.employerRate).toString();
  const ssWages = sumTax(runs, "SS_EE", "taxableWagesMinor");
  const medWages = sumTax(runs, "MEDICARE_EE", "taxableWagesMinor");
  const addlWages = sumTax(runs, "ADDL_MEDICARE_EE", "taxableWagesMinor");
  const l5a = times(ssWages, ssRate);
  const l5c = times(medWages, medRate);
  const l5d = times(addlWages, rates.medicare.additionalRate);
  const l5e = l5a + l5c + l5d;
  const l3 = sumTax(runs, "FIT");
  const l6 = l3 + l5e;
  const actualFica = FICA.reduce((s, c) => s + sumTax(runs, c), 0n);
  const l7 = actualFica - l5e;
  const l10 = l6 + l7;
  const l12 = l10;
  const paid = await depositsPaid(tx, entityId, ["federal_941"], (k) => { const d = keyDate(k); return d >= from && d <= to; });
  const l13 = Object.values(paid).reduce((s, v) => s + v, 0n);
  const nextDay = runs.some((r) => liability941(r) >= toMinor(rates.deposits.nextDayAtOrAbove));
  const small = l12 < toMinor(rates.deposits.payWithReturnUnder) && !nextDay;
  const semiweekly = employer.federalSchedule === "semiweekly" || nextDay;
  const byMonth = months.map((m) => runs.filter((r) => r.payDate.startsWith(m)).reduce((s, r) => s + liability941(r), 0n));
  const byDay = new Map<string, bigint>();
  for (const r of runs) byDay.set(r.payDate, (byDay.get(r.payDate) ?? 0n) + liability941(r));

  const warnings = baseWarnings(employer, runs);
  if (l13 !== l12 && runs.length) warnings.push(l13 < l12 ? "Deposits recorded for this quarter are less than the tax: line 14 shows the balance due." : "Deposits recorded for this quarter are more than the tax: line 15 shows the overpayment.");
  return {
    form: "941", title: "Form 941, Employer's Quarterly Federal Tax Return", period: `Q${q} ${year}`,
    dueDate: onOrNextBusinessDay(endOfNextMonth(to), "federal"), employer,
    fileAt: "File through IRS e-file (through tax software or a provider) or by mail",
    lines: [
      { line: "1", label: `Employees paid for the pay period including ${months[2]}-12`, value: paidOn(runs, `${months[2]}-12`), kind: "count" },
      money("2", "Wages, tips, and other compensation", sumTax(runs, "FIT", "taxableWagesMinor")),
      money("3", "Federal income tax withheld", l3),
      money("5a col 1", "Taxable social security wages", ssWages),
      money("5a col 2", `× ${new D(ssRate).mul(100)}%`, l5a),
      money("5c col 1", "Taxable Medicare wages & tips", medWages),
      money("5c col 2", `× ${new D(medRate).mul(100)}%`, l5c),
      money("5d col 1", "Taxable wages subject to Additional Medicare Tax withholding", addlWages),
      money("5d col 2", `× ${new D(rates.medicare.additionalRate).mul(100)}%`, l5d),
      money("5e", "Total social security and Medicare taxes", l5e),
      money("6", "Total taxes before adjustments", l6),
      money("7", "Current quarter's adjustment for fractions of cents", l7, "Rounding each paycheck to the cent versus the quarter's totals"),
      money("10", "Total taxes after adjustments", l10),
      money("12", "Total taxes after adjustments and nonrefundable credits", l12),
      money("13", "Total deposits for this quarter", l13, "Deposits recorded on the Payroll page"),
      money("14", "Balance due", l12 > l13 ? l12 - l13 : 0n),
      money("15", "Overpayment", l13 > l12 ? l13 - l12 : 0n),
      {
        line: "16", kind: "text",
        label: "Deposit schedule and tax liability",
        value: small ? "Line 12 is less than $2,500 (check the first box)"
          : semiweekly ? "Semiweekly schedule depositor: attach Schedule B (Form 941) with the daily liabilities below"
          : "Monthly schedule depositor: enter the monthly liabilities below",
      },
    ],
    liabilities: small ? [] : semiweekly
      ? [...byDay.entries()].map(([d, v]) => ({ label: `Schedule B, ${d}`, amountMinor: v }))
      : months.map((m, i) => ({ label: `Month ${i + 1} (${m})`, amountMinor: byMonth[i]! })),
    warnings,
  };
}

/** Form 940 for a year. */
export async function form940(tx: Tx, entityId: string, year: number): Promise<PreparedForm> {
  checkQuarter(year, 1);
  const { runs, employer, place } = await load(tx, entityId, `${year}-01-01`, `${year}-12-31`);
  const futa = resolveRules(place, `${year}-12-31`).federal.payroll.futa;
  const st = employer.state;
  const l3 = runs.reduce((s, r) => s + r.paychecks.reduce((t, p) => t + p.grossMinor, 0n), 0n);
  const l4 = sumDeduction(runs, "section125");
  const l7 = sumTax(runs, "FUTA", "taxableWagesMinor");
  const l5 = l3 - l4 - l7;
  const l6 = l4 + l5;
  const l8 = times(l7, futa.rate);
  // A state missing from the table isn't expected to be a credit reduction state.
  const reduction = st.code in futa.creditReduction ? futa.creditReduction[st.code]! : "0";
  const l11 = reduction && !new D(reduction).isZero() ? times(l7, reduction) : null;
  const l12 = l8 + (l11 ?? 0n);
  const paid = await depositsPaid(tx, entityId, ["federal_940"], (k) => keyDate(k).startsWith(String(year)));
  const l13 = paid.FUTA ?? 0n;
  const byQuarter = [1, 2, 3, 4].map((q) => runs.filter((r) => quarterOf(r.payDate) === q).reduce((s, r) => s + r.paychecks.reduce((t, p) => t + (p.taxes.find((x) => x.code === "FUTA")?.amountMinor ?? 0n), 0n), 0n));
  // The credit reduction is a fourth-quarter liability.
  if (l11) byQuarter[3]! += l11;
  const warnings = baseWarnings(employer, runs);
  if (reduction === null) warnings.push(`${st.name} is expected to be a credit reduction state for ${year}. The Department of Labor announces the rate in November; line 11 (Schedule A) is left blank until it's in the rule pack.${st.code === "CA" ? " For 2025 it was 1.2% of California FUTA wages." : ""}`);
  return {
    form: "940", title: "Form 940, Employer's Annual Federal Unemployment (FUTA) Tax Return", period: String(year),
    dueDate: onOrNextBusinessDay(`${year + 1}-01-31`, "federal"), employer,
    fileAt: "File through IRS e-file (through tax software or a provider) or by mail",
    lines: [
      { line: "1a", label: "State where you paid state unemployment tax", value: st.code, kind: "text" },
      { line: "2", label: "Paid wages in a credit reduction state", value: reduction === null ? `Yes (${st.name}, rate pending)` : !new D(reduction).isZero() ? `Yes (${st.name}): complete Schedule A` : "No", kind: "text" },
      money("3", "Total payments to all employees", l3),
      money("4", "Payments exempt from FUTA tax (4a fringe benefits: section 125 health premiums)", l4),
      money("5", "Total of payments made to each employee in excess of $7,000", l5),
      money("6", "Subtotal (line 4 + line 5)", l6),
      money("7", "Total taxable FUTA wages", l7),
      money("8", `FUTA tax before adjustments (line 7 × ${new D(futa.rate).mul(100)}%)`, l8),
      money("11", "Credit reduction (Schedule A)", l11),
      money("12", "Total FUTA tax after adjustments", l12),
      money("13", "FUTA tax deposited for the year", l13),
      money("14", "Balance due", l12 > l13 ? l12 - l13 : 0n),
      money("15a", "Overpayment", l13 > l12 ? l13 - l12 : 0n),
    ],
    liabilities: l12 > toMinor("500") ? byQuarter.map((v, i) => ({ label: `16${"abcd"[i]} Quarter ${i + 1}`, amountMinor: v })) : [],
    warnings,
  };
}

function baseWarnings(employer: Employer, runs: PostedRun[]): string[] {
  const w: string[] = [];
  if (!runs.length) w.push("No approved pay runs in this period.");
  if (!employer.ein) w.push("Add the business's EIN in settings; every form needs it.");
  if (!employer.address) w.push("Add the business address on the Overview page.");
  return w;
}

interface EmployeeRow {
  id: string;
  name: string;
  ssnLast4: string | null;
  ssnSealed: string | null;
  address: { line1: string; city: string; state: string; zip: string } | null;
  openingYtd: { year: number } | null;
}

async function employeesOf(tx: Tx, entityId: string): Promise<Map<string, EmployeeRow>> {
  const { rows } = await tx.query(
    "SELECT id, name, ssn_last4, ssn_sealed, address_line1, address_city, address_state, address_zip, opening_ytd FROM employees WHERE entity_id = $1",
    [entityId],
  );
  return new Map(rows.map((r) => [r.id, {
    id: r.id, name: r.name, ssnLast4: r.ssn_last4, ssnSealed: r.ssn_sealed, openingYtd: r.opening_ytd,
    address: r.address_line1 ? { line1: r.address_line1, city: r.address_city, state: r.address_state, zip: r.address_zip } : null,
  }]));
}

/** "123-45-6789" for people allowed to see it, "xxx-xx-6789" for everyone else. */
function ssnOf(e: EmployeeRow | undefined, full: boolean): string | null {
  if (!e?.ssnLast4) return null;
  if (!full || !e.ssnSealed) return `xxx-xx-${e.ssnLast4}`;
  const s = unseal(e.ssnSealed);
  return `${s.slice(0, 3)}-${s.slice(3, 5)}-${s.slice(5)}`;
}

/** Totals per employee over a set of runs. */
function perEmployee(runs: PostedRun[]) {
  const out = new Map<string, { name: string; gross: bigint; byTax: Map<string, { wages: bigint; amount: bigint }>; byDeduction: Map<string, bigint> }>();
  for (const r of runs) {
    for (const p of r.paychecks) {
      const e = out.get(p.employeeId) ?? { name: p.name, gross: 0n, byTax: new Map(), byDeduction: new Map() };
      e.gross += p.grossMinor;
      for (const t of p.taxes) {
        const x = e.byTax.get(t.code) ?? { wages: 0n, amount: 0n };
        x.wages += t.taxableWagesMinor;
        x.amount += t.amountMinor;
        e.byTax.set(t.code, x);
      }
      for (const d of p.deductions) e.byDeduction.set(d.kind, (e.byDeduction.get(d.kind) ?? 0n) + d.amountMinor);
      out.set(p.employeeId, e);
    }
  }
  return out;
}

async function auditSsn(tx: Tx, orgId: string, entityId: string, actor: Actor, form: string, period: string) {
  await appendAudit(tx, {
    orgId, entityId, actor: actor.id, action: "payroll_form.viewed_with_ssn", objectType: "entity", objectId: entityId,
    after: { form, period }, context: { role: actor.role },
  });
}

/** The DE 9 and its DE 9C wage detail for a quarter. */
export async function formDe9(
  tx: Tx, input: { orgId: string; entityId: string; year: number; quarter: number; fullSsn: boolean; actor: Actor },
): Promise<PreparedForm> {
  checkQuarter(input.year, input.quarter);
  const { from, to, months } = quarterRange(input.year, input.quarter);
  const { runs, employer, pack } = await load(tx, input.entityId, from, to);
  if (!pack.forms.quarterly.some((f) => f.kind === "ca_de9")) throw new LedgerError("INVALID", "the DE 9 is for California businesses");
  const full = input.fullSsn && CAN_SEE_SSN.includes(input.actor.role);
  if (full) await auditSsn(tx, input.orgId, input.entityId, input.actor, "DE 9C", `Q${input.quarter} ${input.year}`);
  const people = await employeesOf(tx, input.entityId);

  // Subject wages are all wages California taxes for UI and SDI: gross less section 125 (the Medicare base, uncapped).
  const subject = sumTax(runs, "MEDICARE_EE", "taxableWagesMinor");
  const uiWages = sumTax(runs, "CA_UI", "taxableWagesMinor");
  const d3 = sumTax(runs, "CA_UI");
  const e2 = sumTax(runs, "CA_ETT");
  const f2 = sumTax(runs, "CA_SDI", "taxableWagesMinor");
  const f3 = sumTax(runs, "CA_SDI");
  const g = sumTax(runs, "CA_PIT");
  const h = d3 + e2 + f3 + g;
  const paid = await depositsPaid(tx, input.entityId, ["ca_pit_sdi", "ca_ui_ett"], (k) => { const d = keyDate(k); return d >= from && d <= to; });
  const i = Object.values(paid).reduce((s, v) => s + v, 0n);
  const pct = (r: string) => `${new D(r).mul(100).toString()}%`;

  const rows = [...perEmployee(runs).entries()].map(([id, e]) => ({
    ssn: ssnOf(people.get(id), full),
    name: e.name,
    subjectWagesMinor: e.byTax.get("MEDICARE_EE")?.wages ?? 0n,
    pitWagesMinor: e.byTax.get("CA_PIT")?.wages ?? 0n,
    pitWithheldMinor: e.byTax.get("CA_PIT")?.amount ?? 0n,
  })).sort((a, b) => a.name.localeCompare(b.name));

  const warnings = baseWarnings(employer, runs);
  if (!employer.stateEmployerAccount) warnings.push("Add your EDD employer payroll tax account number in payroll settings; the DE 9 and DE 9C need it.");
  if (rows.some((r) => !r.ssn)) warnings.push("Some employees have no Social Security number on file; the DE 9C needs one for each.");
  return {
    form: "DE 9", title: "DE 9, Quarterly Contribution Return and Report of Wages, with DE 9C", period: `Q${input.quarter} ${input.year}`,
    dueDate: onOrNextBusinessDay(endOfNextMonth(to), pack.calendar), employer,
    fileAt: "File through EDD e-Services for Business (required online)",
    lines: [
      money("C", "Total subject wages paid this quarter", subject),
      { line: "D1", label: "UI rate", value: pct(employer.stateRates.CA_UI!), kind: "rate" },
      money("D2", "UI taxable wages for the quarter", uiWages),
      money("D3", "UI contributions", d3),
      { line: "E1", label: "ETT rate", value: pct(employer.stateRates.CA_ETT!), kind: "rate" },
      money("E2", "ETT contributions", e2),
      { line: "F1", label: "SDI rate", value: pct(employer.stateRates.CA_SDI!), kind: "rate" },
      money("F2", "SDI taxable wages for the quarter", f2),
      money("F3", "SDI employee contributions withheld", f3),
      money("G", "California PIT withheld", g),
      money("H", "Subtotal (D3 + E2 + F3 + G)", h),
      money("I", "Less: contributions and withholdings paid for the quarter", i, "EDD deposits recorded on the Payroll page"),
      money("J", "Total taxes due or overpaid (H − I)", h - i),
      ...months.map((m, n): FormLine => ({ line: `DE 9C A${n + 1}`, label: `Employees in the pay period including ${m}-12`, value: paidOn(runs, `${m}-12`), kind: "count" })),
      money("DE 9C K", "Grand total subject wages", rows.reduce((s, r) => s + r.subjectWagesMinor, 0n)),
      money("DE 9C L", "Grand total PIT wages", rows.reduce((s, r) => s + r.pitWagesMinor, 0n)),
      money("DE 9C M", "Grand total PIT withheld", rows.reduce((s, r) => s + r.pitWithheldMinor, 0n)),
    ],
    employees: rows,
    warnings,
  };
}

/** W-2s for a year, with the W-3 totals. */
export async function formW2(
  tx: Tx, input: { orgId: string; entityId: string; year: number; fullSsn: boolean; actor: Actor },
): Promise<PreparedForm> {
  checkQuarter(input.year, 1);
  const { runs, employer, pack } = await load(tx, input.entityId, `${input.year}-01-01`, `${input.year}-12-31`);
  const full = input.fullSsn && CAN_SEE_SSN.includes(input.actor.role);
  if (full) await auditSsn(tx, input.orgId, input.entityId, input.actor, "W-2", String(input.year));
  const people = await employeesOf(tx, input.entityId);
  const st = employer.state.code;
  // Boxes 15 to 17 are for state income tax; states without one leave them empty.
  const income = pack.payroll.incomeTaxAgency;
  const stateId = formatAccount(employer.stateEmployerAccount, pack.payroll.employerAccount.format);

  const w2s = [...perEmployee(runs).entries()].map(([id, e]) => {
    const t = (c: string | undefined) => (c && e.byTax.get(c)) || { wages: 0n, amount: 0n };
    const p = people.get(id);
    const box12: { code: string; amountMinor: bigint }[] = [];
    const k401 = e.byDeduction.get("traditional401k") ?? 0n;
    if (k401) box12.push({ code: "D", amountMinor: k401 });
    return {
      employeeId: id, name: e.name, ssn: ssnOf(p, full), address: p?.address ?? null,
      box1: t("FIT").wages, box2: t("FIT").amount, box3: t("SS_EE").wages, box4: t("SS_EE").amount,
      box5: t("MEDICARE_EE").wages, box6: t("MEDICARE_EE").amount + t("ADDL_MEDICARE_EE").amount,
      box12, box14: pack.forms.w2Box14.filter((b) => t(b.code).amount).map((b) => ({ label: b.label, amountMinor: t(b.code).amount })),
      box15: income ? { state: st, employerStateId: stateId } : null, box16: t(income?.code).wages, box17: t(income?.code).amount,
      // Boxes 18 to 20: each city tax withheld (New York City, Yonkers).
      local: (pack.payroll.localIncomeTaxes ?? []).filter((l) => t(l.code).amount).map((l) => ({ locality: l.w2Locality, wagesMinor: t(l.code).wages, taxMinor: t(l.code).amount })),
      hasEarlierPay: Boolean(p?.openingYtd && p.openingYtd.year === input.year),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const total = (k: "box1" | "box2" | "box3" | "box4" | "box5" | "box6" | "box16" | "box17") => w2s.reduce((s, w) => s + w[k], 0n);
  const warnings = baseWarnings(employer, runs);
  if (income && !stateId) warnings.push(`Add your ${pack.payroll.employerAccount.label} in payroll settings; it goes in box 15.`);
  if (w2s.some((w) => !w.ssn)) warnings.push("Some employees have no Social Security number on file; every W-2 needs one.");
  if (w2s.some((w) => !w.address)) warnings.push("Some employees have no home address on file; every W-2 needs one.");
  for (const w of w2s.filter((x) => x.hasEarlierPay)) {
    warnings.push(`${w.name} was paid earlier in ${input.year} before TrailBook. These figures cover only pay through TrailBook; add the earlier payroll's W-2 figures, or have the earlier provider issue a W-2 for that part.`);
  }
  if (sumDeduction(runs, "section125")) warnings.push("Box 12 code DD (cost of employer health coverage) isn't filled in: TrailBook knows only the employee's pre-tax share. Employers filing fewer than 250 W-2s don't have to report it.");
  return {
    form: "W-2", title: "Forms W-2 and W-3, Wage and Tax Statements", period: String(input.year),
    dueDate: onOrNextBusinessDay(`${input.year + 1}-01-31`, "federal"), employer,
    fileAt: "Give each employee their W-2 by the due date, and file Copy A with the W-3 through SSA Business Services Online",
    lines: [
      { line: "W-3 b", label: "Kind of payer / kind of employer", value: "941 / None apply", kind: "text" },
      { line: "W-3 c", label: "Total number of Forms W-2", value: w2s.length, kind: "count" },
      money("W-3 1", "Wages, tips, other compensation", total("box1")),
      money("W-3 2", "Federal income tax withheld", total("box2")),
      money("W-3 3", "Social security wages", total("box3")),
      money("W-3 4", "Social security tax withheld", total("box4")),
      money("W-3 5", "Medicare wages and tips", total("box5")),
      money("W-3 6", "Medicare tax withheld", total("box6")),
      money("W-3 12a", "Deferred compensation (box 12 code D)", w2s.reduce((s, w) => s + w.box12.reduce((t, b) => t + b.amountMinor, 0n), 0n)),
      ...(income ? [
        { line: "W-3 15", label: "State / employer's state ID number", value: stateId ? `${st} ${stateId}` : `${st} (account number missing)`, kind: "text" } as FormLine,
        money("W-3 16", "State wages", total("box16")),
        money("W-3 17", "State income tax", total("box17")),
      ] : []),
    ],
    employees: w2s,
    warnings,
  };
}

/** "12345678" printed as "###-####-#" says, like "123-4567-8". */
function formatAccount(account: string | null, format: string | undefined): string | null {
  if (!account || !format || format.replace(/[^#]/g, "").length !== account.length) return account;
  let i = 0;
  return format.replace(/#/g, () => account[i++]!);
}

/**
 * A state's quarterly UI wage report (Texas C-3, Florida RT-6...) or
 * withholding return (Arizona A1-QRT): the figures, from posted runs, that
 * the agency's online filing asks for.
 */
export async function formStateQuarterly(
  tx: Tx, input: { orgId: string; entityId: string; year: number; quarter: number; slug: string; fullSsn: boolean; actor: Actor },
): Promise<PreparedForm> {
  checkQuarter(input.year, input.quarter);
  const { from, to, months } = quarterRange(input.year, input.quarter);
  const { runs, employer, pack } = await load(tx, input.entityId, from, to);
  const spec = pack.forms.quarterly.find((f) => f.slug === input.slug && f.kind !== "ca_de9");
  if (!spec) throw new LedgerError("INVALID", "no such form");
  const full = input.fullSsn && CAN_SEE_SSN.includes(input.actor.role);
  if (full) await auditSsn(tx, input.orgId, input.entityId, input.actor, spec.form, `Q${input.quarter} ${input.year}`);
  const people = await employeesOf(tx, input.entityId);
  const pct = (r: string) => `${new D(r).mul(100).toString()}%`;
  const label = (code: string) => pack.payroll.taxes.find((t) => t.code === code)?.label
    ?? pack.payroll.localIncomeTaxes?.find((t) => t.code === code)?.name
    ?? pack.payroll.incomeTaxAgency?.label ?? code;
  const warnings = baseWarnings(employer, runs);
  if (!employer.stateEmployerAccount) warnings.push(`Add your ${pack.payroll.employerAccount.label} in payroll settings; the ${spec.form} needs it.`);
  const paid = await stateDepositsPaid(tx, input.entityId, pack, [...spec.codes, ...(spec.withholdingCodes ?? [])], from, to);
  const lines: FormLine[] = [];
  let due = 0n;
  let rows: Record<string, unknown>[];
  const each = [...perEmployee(runs).entries()];

  if (spec.kind === "ui_wage_report" || spec.kind === "combined_return") {
    // Gross wages less section 125 (the Medicare base, uncapped) are the wages the state counts.
    const total = sumTax(runs, "MEDICARE_EE", "taxableWagesMinor");
    lines.push(
      ...months.map((m, n): FormLine => ({ line: `Month ${n + 1}`, label: `Employees in the pay period including ${m}-12`, value: paidOn(runs, `${m}-12`), kind: "count" })),
      money("Total wages", "Total wages paid this quarter", total),
    );
    for (const code of spec.codes) {
      const taxable = sumTax(runs, code, "taxableWagesMinor");
      const tax = sumTax(runs, code);
      due += tax;
      lines.push(
        money(`${label(code)} excess`, `Wages over the ${label(code)} wage base`, total - taxable),
        money(`${label(code)} taxable`, `${label(code)} taxable wages`, taxable),
        { line: `${label(code)} rate`, label: `${label(code)} rate`, value: pct(employer.stateRates[code] ?? "0"), kind: "rate" },
        money(`${label(code)} due`, `${label(code)} due`, tax),
      );
    }
    const withheld = spec.withholdingCodes ?? [];
    for (const code of withheld) {
      const tax = sumTax(runs, code);
      due += tax;
      lines.push(
        money(`${label(code)} wages`, `Wages subject to ${label(code)}`, sumTax(runs, code, "taxableWagesMinor")),
        money(`${label(code)} withheld`, `${label(code)} withheld`, tax),
      );
    }
    rows = each.map(([id, e]) => ({
      ssn: ssnOf(people.get(id), full), name: e.name, wagesMinor: e.byTax.get("MEDICARE_EE")?.wages ?? 0n,
      ...Object.fromEntries(spec.codes.map((c) => [`${c}TaxableMinor`, e.byTax.get(c)?.wages ?? 0n])),
      ...Object.fromEntries(withheld.map((c) => [`${c}WithheldMinor`, e.byTax.get(c)?.amount ?? 0n])),
    }));
  } else {
    const code = spec.codes[0]!;
    due = sumTax(runs, code);
    lines.push(
      money("Wages", "Wages subject to state withholding", sumTax(runs, code, "taxableWagesMinor")),
      money("Withheld", `${label(code)} withheld`, due),
    );
    rows = each.map(([id, e]) => ({
      ssn: ssnOf(people.get(id), full), name: e.name, wagesMinor: e.byTax.get(code)?.wages ?? 0n, withheldMinor: e.byTax.get(code)?.amount ?? 0n,
    }));
  }
  lines.push(
    money("Paid", "Less: deposits recorded for the quarter", paid, "Recorded on the Payroll page"),
    money("Balance", due >= paid ? "Balance due" : "Overpaid", due >= paid ? due - paid : paid - due),
  );
  if (rows.some((r) => !r.ssn)) warnings.push(`Some employees have no Social Security number on file; the ${spec.form} needs one for each.`);
  return {
    form: spec.form, title: spec.title, period: `Q${input.quarter} ${input.year}`,
    dueDate: onOrNextBusinessDay(endOfNextMonth(to), pack.calendar), employer, fileAt: spec.fileAt,
    lines, employees: rows.sort((a, b) => String(a.name).localeCompare(String(b.name))), warnings,
  };
}

/** The forms due for a business, newest period first, so the page can list them. */
export function formsFor(year: number, today: string, state: StateRulePack) {
  const out: { form: string; slug: string; period: string; year: number; quarter?: number; dueDate: string }[] = [];
  for (const q of [4, 3, 2, 1]) {
    const end = quarterEnd(year, q);
    if (addDays(end, -92) > today) continue;
    out.push({ form: "941", slug: "941", period: `Q${q} ${year}`, year, quarter: q, dueDate: onOrNextBusinessDay(endOfNextMonth(end), "federal") });
    for (const f of state.forms.quarterly) {
      out.push({ form: f.form, slug: f.slug, period: `Q${q} ${year}`, year, quarter: q, dueDate: onOrNextBusinessDay(endOfNextMonth(end), state.calendar) });
    }
  }
  out.unshift(
    { form: "940", slug: "940", period: String(year), year, dueDate: onOrNextBusinessDay(`${year + 1}-01-31`, "federal") },
    { form: "W-2", slug: "w2", period: String(year), year, dueDate: onOrNextBusinessDay(`${year + 1}-01-31`, "federal") },
  );
  return out;
}
