import type { Tx } from "../db/pool.js";
import { LedgerError } from "../core/errors.js";
import type { Actor } from "../core/ledger.js";
import { D, toMinor } from "../core/money.js";
import { unseal } from "../core/pii.js";
import { resolveRules, type StateRulePack } from "../rules/index.js";
import type { CanadaFederalRulePack } from "../rules/canada/types.js";
import { addDays, onOrNextBusinessDay } from "./business-days.js";
import type { CanadaTd1 } from "./canada.js";
import { CRA_REMITTANCE, RQ_ANNUAL, RQ_REMITTANCE } from "./canada-remittances.js";
import { auditSsn, CAN_SEE_SSN, depositsPaid, load, money, perEmployee, type Employer, type FormLine, type PostedRun, type PreparedForm } from "./forms.js";
import type { PayFrequency } from "./gross-to-net.js";

// Canadian year-end slips and the Record of Employment: T4 slips and their
// T4 Summary for the CRA (guide RC4120), RL-1 slips and the RL-1 summary
// (RLZ-1.S) for Revenu Québec (guide RL-1.G-V), and the ROE for Service
// Canada when an employee's earnings stop. Every figure comes from posted pay
// runs and recorded remittances. TrailBook prepares them; the business files
// them (T4 and RL-1 by the last day of February, the ROE through ROE Web).

interface CanadianEmployee {
  id: string;
  name: string;
  sinLast4: string | null;
  sinSealed: string | null;
  address: { line1: string; city: string; state: string; zip: string } | null;
  hireDate: string;
  terminationDate: string | null;
  payType: "salary" | "hourly";
  payFrequency: PayFrequency;
  usualHours: string | null;
  td1: CanadaTd1 | null;
  openingYtd: { year: number } | null;
}

async function canadianEmployees(tx: Tx, entityId: string): Promise<Map<string, CanadianEmployee>> {
  const { rows } = await tx.query(
    `SELECT id, name, ssn_last4, ssn_sealed, address_line1, address_city, address_state, address_zip, hire_date::text, termination_date::text,
            pay_type, pay_frequency, usual_hours::text, td1, opening_ytd FROM employees WHERE entity_id = $1`,
    [entityId],
  );
  return new Map(rows.map((r) => [r.id, {
    id: r.id, name: r.name, sinLast4: r.ssn_last4, sinSealed: r.ssn_sealed, hireDate: r.hire_date, terminationDate: r.termination_date,
    payType: r.pay_type, payFrequency: r.pay_frequency, usualHours: r.usual_hours, td1: r.td1, openingYtd: r.opening_ytd,
    address: r.address_line1 ? { line1: r.address_line1, city: r.address_city, state: r.address_state, zip: r.address_zip } : null,
  }]));
}

/** "123 456 789" for people allowed to see it, "XXX XX6 789"-style for everyone else. */
function sinOf(e: CanadianEmployee | undefined, full: boolean): string | null {
  if (!e?.sinLast4) return null;
  if (!full || !e.sinSealed) return `xxx xx${e.sinLast4.slice(0, 1)} ${e.sinLast4.slice(1)}`;
  const s = unseal(e.sinSealed);
  return `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6)}`;
}

function checkYear(year: number) {
  if (!Number.isInteger(year) || year < 2026 || year > 2100) throw new LedgerError("INVALID", "pick a year from 2026 on");
}

function requireCanada(pack: StateRulePack) {
  if (pack.place.country !== "CA") throw new LedgerError("INVALID", "the T4, RL-1 and ROE are for Canadian businesses");
}

/** The federal pack for the year's last day: its insurable and pensionable maximums cap the slips' earnings boxes. */
function federalFor(pack: StateRulePack, date: string): CanadaFederalRulePack {
  return resolveRules(pack.place, date).federal as CanadaFederalRulePack;
}

/**
 * The CRA payroll program account (123456789RP0001). Outside Quebec it's the
 * account in payroll settings; a Quebec business keeps its Revenu Québec
 * number there, so its CRA account is read from the business number.
 */
function craAccount(employer: Employer, warnings: string[]): string | null {
  if (employer.stateEmployerAccount && /^\d{9}RP\d{4}$/.test(employer.stateEmployerAccount)) return employer.stateEmployerAccount;
  if (employer.ein && /^\d{9}$/.test(employer.ein)) {
    warnings.push(`Using ${employer.ein}RP0001 as the CRA payroll account; if yours isn't RP0001, use the account on your PD7A.`);
    return `${employer.ein}RP0001`;
  }
  warnings.push("Add your CRA business number (on the Overview page) or payroll account (in payroll settings); every slip needs it.");
  return null;
}

const cap = (v: bigint, max: string) => (v < toMinor(max) ? v : toMinor(max));
const sum = <T>(list: T[], f: (x: T) => bigint) => list.reduce((s, x) => s + f(x), 0n);

function baseWarnings(employer: Employer, runs: PostedRun[]): string[] {
  const w: string[] = [];
  if (!runs.length) w.push("No approved pay runs in this year.");
  if (!employer.address) w.push("Add the business address on the Overview page.");
  return w;
}

/** T4 slips for a year, with the T4 Summary. */
export async function formT4(tx: Tx, input: { orgId: string; entityId: string; year: number; fullSsn: boolean; actor: Actor }): Promise<PreparedForm> {
  checkYear(input.year);
  const { runs, employer, pack } = await load(tx, input.entityId, `${input.year}-01-01`, `${input.year}-12-31`);
  requireCanada(pack);
  const full = input.fullSsn && CAN_SEE_SSN.includes(input.actor.role);
  if (full) await auditSsn(tx, input.orgId, input.entityId, input.actor, "T4", String(input.year));
  const people = await canadianEmployees(tx, input.entityId);
  const fed = federalFor(pack, `${input.year}-12-31`);
  const quebec = pack.place.region === "QC";
  const warnings = baseWarnings(employer, runs);
  const account = craAccount(employer, warnings);
  const dental = (await tx.query("SELECT t4_dental_code FROM entities WHERE id = $1", [input.entityId])).rows[0]?.t4_dental_code ?? null;

  const slips = [...perEmployee(runs).entries()].map(([id, e]) => {
    const t = (c: string) => e.byTax.get(c) ?? { wages: 0n, amount: 0n };
    const p = people.get(id);
    const plan = quebec ? "QPP" : "CPP";
    return {
      employeeId: id, name: e.name, sin: sinOf(p, full), address: p?.address ?? null,
      box10: pack.place.region, box14: e.gross,
      box16: quebec ? 0n : t("CPP_EE").amount, box16A: quebec ? 0n : t("CPP2_EE").amount,
      box17: quebec ? t("QPP_EE").amount : 0n, box17A: quebec ? t("QPP2_EE").amount : 0n,
      box18: t("EI_EE").amount, box20: e.byDeduction.get("registered_retirement") ?? 0n,
      // Outside Quebec box 22 is federal and provincial tax together; a Quebec employee's provincial tax goes on the RL-1.
      box22: t("CA_FIT").amount + (quebec ? 0n : t("CA_PIT").amount),
      box24: p?.td1?.eiExempt ? 0n : cap(t("EI_EE").wages, fed.ei.maxInsurableEarnings),
      box26: p?.td1?.cppExempt ? 0n : cap(t(`${plan}_EE`).wages, (quebec ? fed.qpp : fed.cpp).ympe),
      box28: [p?.td1?.cppExempt ? "CPP/QPP" : "", p?.td1?.eiExempt ? "EI" : "", quebec && p?.td1?.qpipExempt ? "PPIP" : ""].filter(Boolean).join(", "),
      box45: dental,
      box55: quebec ? t("QPIP_EE").amount : 0n,
      box56: quebec && !p?.td1?.qpipExempt ? cap(t("QPIP_EE").wages, fed.qpip.maxInsurableEarnings) : 0n,
      hasEarlierPay: Boolean(p?.openingYtd && p.openingYtd.year === input.year),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const total = (k: "box14" | "box16" | "box16A" | "box18" | "box20" | "box22") => sum(slips, (s) => s[k]);
  const er = (c: string) => sum(runs, (r) => sum(r.paychecks, (p) => p.taxes.find((x) => x.code === c)?.amountMinor ?? 0n));
  const box27 = quebec ? 0n : er("CPP_ER");
  const box27A = quebec ? 0n : er("CPP2_ER");
  const box19 = er("EI_ER");
  const box80 = total("box16") + total("box16A") + box27 + box27A + total("box18") + box19 + total("box22");
  const paid = await depositsPaid(tx, input.entityId, [CRA_REMITTANCE.kind], (k) => k.includes(`:${input.year}-`));
  const box82 = Object.values(paid).reduce((s, v) => s + v, 0n);
  const diff = box80 - box82;

  if (dental === null && slips.length) warnings.push("Pick the box 45 dental benefits code in payroll settings; every T4 needs it.");
  if (slips.some((s) => !s.sin)) warnings.push("Some employees have no SIN on file; every T4 needs one.");
  if (slips.some((s) => !s.address)) warnings.push("Some employees have no home address on file; every T4 needs one.");
  if (slips.some((s) => s.box20)) warnings.push("Box 20 shows RRSP or pension deductions. Box 20 is only for a registered pension plan (RPP); if they went to an RRSP, leave box 20 blank (the RRSP issuer sends the receipt).");
  for (const s of slips.filter((x) => x.hasEarlierPay)) {
    warnings.push(`${s.name} was paid earlier in ${input.year} before TrailBook. These figures cover only pay through TrailBook; the earlier payroll issues its own T4 for that part.`);
  }
  return {
    form: "T4", title: "T4 slips and T4 Summary, Statement of Remuneration Paid", period: String(input.year),
    dueDate: onOrNextBusinessDay(addDays(`${input.year + 1}-03-01`, -1), "canada"), employer,
    fileAt: "Give each employee their T4 by the due date, and file the slips and summary through the CRA's Internet file transfer or Web Forms",
    lines: [
      { line: "Account", label: "Employer's CRA payroll account number", value: account ?? "missing", kind: "text" },
      { line: "88", label: "Total number of T4 slips filed", value: slips.length, kind: "count" },
      money("14", "Employment income", total("box14")),
      money("20", "Registered pension plan (RPP) contributions", total("box20")),
      money("16", "Employees' CPP contributions", total("box16")),
      money("16A", "Employees' second CPP contributions", total("box16A")),
      money("27", "Employer's CPP contributions", box27),
      money("27A", "Employer's second CPP contributions", box27A),
      money("18", "Employees' EI premiums", total("box18")),
      money("19", "Employer's EI premiums", box19),
      money("22", "Income tax deducted", total("box22")),
      money("80", "Total deductions reported (16 + 16A + 27 + 27A + 18 + 19 + 22)", box80),
      money("82", "Minus: remittances", box82, "CRA remittances recorded on the Payroll page"),
      money(diff >= 0n ? "86" : "84", diff >= 0n ? "Balance due" : "Overpayment", diff >= 0n ? diff : -diff),
      ...(quebec ? [{ line: "Note", label: "QPP contributions, QPIP and Quebec tax go on the RL-1 summary, not here", value: null, kind: "text" } as FormLine] : []),
    ],
    employees: slips,
    warnings,
  };
}

/** RL-1 slips for a year, with the RL-1 summary (RLZ-1.S) of contributions. */
export async function formRl1(tx: Tx, input: { orgId: string; entityId: string; year: number; fullSsn: boolean; actor: Actor }): Promise<PreparedForm> {
  checkYear(input.year);
  const { runs, employer, pack } = await load(tx, input.entityId, `${input.year}-01-01`, `${input.year}-12-31`);
  requireCanada(pack);
  if (pack.place.region !== "QC") throw new LedgerError("INVALID", "the RL-1 is for Quebec businesses");
  const full = input.fullSsn && CAN_SEE_SSN.includes(input.actor.role);
  if (full) await auditSsn(tx, input.orgId, input.entityId, input.actor, "RL-1", String(input.year));
  const people = await canadianEmployees(tx, input.entityId);
  const fed = federalFor(pack, `${input.year}-12-31`);
  const warnings = baseWarnings(employer, runs);
  if (!employer.stateEmployerAccount) warnings.push("Add your Revenu Québec identification number in payroll settings; every RL-1 needs it.");

  const slips = [...perEmployee(runs).entries()].map(([id, e]) => {
    const t = (c: string) => e.byTax.get(c) ?? { wages: 0n, amount: 0n };
    const p = people.get(id);
    return {
      employeeId: id, name: e.name, sin: sinOf(p, full), address: p?.address ?? null,
      boxA: e.gross, boxB: t("QPP_EE").amount, boxBA: t("QPP2_EE").amount, boxC: t("EI_EE").amount,
      boxD: e.byDeduction.get("registered_retirement") ?? 0n, boxE: t("QC_PIT").amount,
      boxG: p?.td1?.cppExempt ? 0n : cap(t("QPP_EE").wages, fed.qpp.ympe),
      boxH: t("QPIP_EE").amount, boxI: p?.td1?.qpipExempt ? 0n : cap(t("QPIP_EE").wages, fed.qpip.maxInsurableEarnings),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const tax = (c: string) => sum(runs, (r) => sum(r.paychecks, (p) => p.taxes.find((x) => x.code === c)?.amountMinor ?? 0n));
  const qpp = tax("QPP_EE") + tax("QPP2_EE") + tax("QPP_ER") + tax("QPP2_ER");
  const qpip = tax("QPIP_EE") + tax("QPIP_ER");
  const qcTax = tax("QC_PIT");
  const hsf = tax("QC_HSF");
  const cnt = tax("QC_CNT");
  const wsdrf = tax("QC_WSDRF");
  const cnesst = tax("QC_CNESST");
  const owed = qpp + qpip + qcTax + hsf + cnt + wsdrf + cnesst;
  const paid = await depositsPaid(tx, input.entityId, [RQ_REMITTANCE.kind, RQ_ANNUAL.kind], (k) => k.includes(`:${input.year}-`));
  const paidTotal = Object.values(paid).reduce((s, v) => s + v, 0n);

  if (slips.some((s) => !s.sin)) warnings.push("Some employees have no SIN on file; every RL-1 needs one.");
  if (slips.some((s) => s.boxD)) warnings.push("Box D shows RRSP or pension deductions. Box D is only for a registered pension plan; if they went to an RRSP, leave it blank.");
  return {
    form: "RL-1", title: "RL-1 slips and RL-1 summary (RLZ-1.S), Employment and Other Income", period: String(input.year),
    dueDate: onOrNextBusinessDay(addDays(`${input.year + 1}-03-01`, -1), "quebec"), employer,
    fileAt: "Give each employee their RL-1 by the due date, and file the slips and the RLZ-1.S summary through My Account for businesses (Mon dossier)",
    lines: [
      { line: "ID", label: "Revenu Québec identification number", value: employer.stateEmployerAccount ?? "missing", kind: "text" },
      { line: "Slips", label: "Number of RL-1 slips", value: slips.length, kind: "count" },
      money("A", "Employment income (all slips)", sum(slips, (s) => s.boxA)),
      money("QPP", "QPP contributions, employees' and employer's", qpp),
      money("QPIP", "QPIP premiums, employees' and employer's", qpip),
      money("E", "Quebec income tax withheld", qcTax),
      money("HSF", "Health services fund contribution", hsf, "Worked out at the rate in payroll settings; the summary recalculates it from your total payroll"),
      money("CNT", "Labour standards contribution", cnt),
      money("WSDRF", "Workforce skills development and recognition fund", wsdrf),
      money("CNESST", "CNESST premiums remitted with source deductions", cnesst),
      money("Total", "Total contributions and source deductions", owed),
      money("Paid", "Minus: remittances", paidTotal, "Revenu Québec remittances recorded on the Payroll page"),
      money(owed >= paidTotal ? "Due" : "Over", owed >= paidTotal ? "Balance due" : "Overpayment", owed >= paidTotal ? owed - paidTotal : paidTotal - owed),
    ],
    employees: slips,
    warnings,
  };
}

/** How many of the final pay periods an ROE reports insurable hours and earnings for (Block 15). */
const ROE_PERIODS: Record<PayFrequency, number> = { weekly: 53, biweekly: 27, semimonthly: 25, monthly: 13 };
const ROE_PERIOD_TYPE: Record<PayFrequency, string> = { weekly: "W (weekly)", biweekly: "B (biweekly)", semimonthly: "S (semi-monthly)", monthly: "M (monthly)" };
const WEEKS: Record<PayFrequency, string> = { weekly: "1", biweekly: "2", semimonthly: "2.1667", monthly: "4.3333" };

/** The Record of Employment for an employee whose earnings have stopped. */
export async function formRoe(tx: Tx, input: { orgId: string; entityId: string; employeeId: string; fullSsn: boolean; actor: Actor }): Promise<PreparedForm> {
  const people = await canadianEmployees(tx, input.entityId);
  const e = people.get(input.employeeId);
  if (!e) throw new LedgerError("INVALID", "employee not found");
  if (!e.terminationDate) throw new LedgerError("INVALID", `${e.name} has no last day on file; add it on the employee first`);
  // A year and a half of runs covers 53 weekly periods.
  const { runs: all, employer, pack } = await load(tx, input.entityId, addDays(e.terminationDate, -560), addDays(e.terminationDate, 62));
  requireCanada(pack);
  const full = input.fullSsn && CAN_SEE_SSN.includes(input.actor.role);
  if (full) await auditSsn(tx, input.orgId, input.entityId, input.actor, "ROE", e.name);
  const warnings = baseWarnings(employer, all).filter((w) => !w.startsWith("No approved"));
  const account = craAccount(employer, warnings);

  const mine = all.flatMap((r) => r.paychecks.filter((p) => p.employeeId === e.id).map((p) => ({ run: r, p })))
    .sort((a, b) => b.run.periodEnd.localeCompare(a.run.periodEnd));
  if (!mine.length) warnings.push(`${e.name} has no approved pay runs; the ROE needs their insurable earnings.`);
  const n = ROE_PERIODS[e.payFrequency];
  const recent = mine.slice(0, n);
  // Insurable hours: hours paid, or for a salaried employee their usual hours (40 a week when none are on file).
  const deemed = e.usualHours ? new D(e.usualHours) : new D(40).mul(WEEKS[e.payFrequency]);
  const hoursOf = (p: (typeof mine)[number]["p"]) => {
    const paid = p.earnings.reduce((s, x) => s.add(x.hours ?? 0), new D(0));
    return paid.gt(0) ? paid : p.earnings.some((x) => x.code === "SALARY") ? deemed : new D(0);
  };
  const insurable = (p: (typeof mine)[number]["p"]) => p.taxes.find((t) => t.code === "EI_EE")?.taxableWagesMinor ?? p.grossMinor;
  const hours = recent.reduce((s, x) => s.add(hoursOf(x.p)), new D(0));
  const finalPeriodEnd = mine[0]?.run.periodEnd ?? e.terminationDate;
  if (!e.sinLast4) warnings.push(`${e.name} has no SIN on file; the ROE needs it.`);
  if (e.payType === "salary" && !e.usualHours) warnings.push("Salaried hours are counted at 40 a week; change them in ROE Web if the employee's usual hours were different.");
  warnings.push("Pick the reason for issuing (Block 16) in ROE Web: A shortage of work, E quit, M dismissal, N leave of absence, K other, and so on. Add any vacation pay or other money paid on separation (Block 17) there too.");

  return {
    form: "ROE", title: `Record of Employment: ${e.name}`, period: `Last day ${e.terminationDate}`,
    // Electronic ROEs: within five calendar days of the end of the pay period in which the earnings stopped.
    dueDate: addDays(finalPeriodEnd, 5), employer,
    fileAt: "Issue it through ROE Web (Service Canada); the employee sees it in My Service Canada Account",
    lines: [
      { line: "5", label: "CRA payroll account number", value: account ?? "missing", kind: "text" },
      { line: "6", label: "Pay period type", value: ROE_PERIOD_TYPE[e.payFrequency], kind: "text" },
      { line: "8", label: "Social Insurance Number", value: sinOf(e, full) ?? "missing", kind: "text" },
      { line: "9", label: "Employee", value: `${e.name}${e.address ? `, ${e.address.line1}, ${e.address.city} ${e.address.state} ${e.address.zip}` : ""}`, kind: "text" },
      { line: "10", label: "First day worked", value: e.hireDate, kind: "text" },
      { line: "11", label: "Last day for which paid", value: e.terminationDate, kind: "text" },
      { line: "12", label: "Final pay period ending date", value: finalPeriodEnd, kind: "text" },
      { line: "15A", label: `Total insurable hours (last ${n} pay periods)`, value: hours.toDecimalPlaces(0).toString(), kind: "count" },
      money("15C", `Total insurable earnings (last ${n} pay periods)`, sum(recent, (x) => insurable(x.p))),
      { line: "16", label: "Reason for issuing", value: "Pick in ROE Web", kind: "text" },
    ],
    employees: recent.map((x, i) => ({ payPeriod: i + 1, periodEnding: x.run.periodEnd, hours: hoursOf(x.p).toString(), insurableEarningsMinor: insurable(x.p) })),
    warnings,
  };
}

/** The year-end slips due for a Canadian business, for the forms page. */
export function canadaFormsFor(year: number, pack: StateRulePack) {
  return [
    { form: "T4", slug: "t4", period: String(year), year, dueDate: onOrNextBusinessDay(addDays(`${year + 1}-03-01`, -1), "canada") },
    ...(pack.place.region === "QC" ? [{ form: "RL-1", slug: "rl1", period: String(year), year, dueDate: onOrNextBusinessDay(addDays(`${year + 1}-03-01`, -1), "quebec") }] : []),
  ];
}

/** ROEs: one for each employee whose last day falls in the year. */
export async function roesFor(tx: Tx, entityId: string, year: number) {
  const { rows } = await tx.query(
    "SELECT id, name, termination_date::text FROM employees WHERE entity_id = $1 AND termination_date >= $2 AND termination_date <= $3 ORDER BY termination_date",
    [entityId, `${year}-01-01`, `${year}-12-31`],
  );
  return rows.map((r) => ({ form: "ROE", slug: `roe-${r.id}`, period: `${r.name}, last day ${r.termination_date}`, year, dueDate: addDays(r.termination_date, 5) }));
}
