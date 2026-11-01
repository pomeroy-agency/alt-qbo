import type { Tx } from "../db/pool.js";
import { LedgerError } from "../core/errors.js";
import { D, toMajor, toMinor } from "../core/money.js";
import { resolveRules, statePackFor, type Place, type StateWageHourRules } from "../rules/index.js";
import { minimumWageOn } from "../rules/minimum-wage.js";
import { localMinimumAbove } from "../rules/local-minimum-wage.js";
import { listEmployees, openingFor, salaryPerPeriod, type Employee } from "./employees.js";
import type { EmployeePayInput, Paycheck, SickLeaveInput, SickLeavePolicy, TaxLine, YearToDate } from "./gross-to-net.js";
import { splitWorkweek } from "./hours.js";
import { employmentStandardsFor, type EmploymentStandards } from "../rules/canada/employment-standards-2026.js";
import { holidayPayFor, holidaysInPeriod, usualDailyHours, vacationRateFor, type WageSlice } from "./employment-standards.js";
import { addDays } from "./business-days.js";
import { calculatePayRun, type PayRun, type PayRunInput } from "./pay-run.js";

// Pay runs built from saved employees. A run copies each employee's pay and
// tax choices when it is prepared, and year-to-date wages are worked out
// from posted runs every time it is calculated, so approving a run after
// another one posts still stops each capped tax at its wage base.

export interface PayRunLine {
  employeeId: string;
  regularHours?: string;
  overtimeHours?: string;
  doubleTimeHours?: string;
  /** Hours worked each day, one or two workweeks of seven days; overtime is worked out from them. */
  dailyHours?: (string | number)[];
  bonus?: string;
  /** The bonus was at the employer's discretion, so it adds no overtime. */
  bonusDiscretionary?: boolean;
  commission?: string;
  reimbursement?: string;
  /** Hours of paid sick leave taken in the period. */
  sickHoursUsed?: string;
  /** Canada: hours worked on a statutory holiday in the period, on top of the regular hours. */
  holidayHoursWorked?: string;
  /** Canada: the holiday wasn't a day the employee would normally have worked (Alberta), so no holiday pay. */
  noHolidayPay?: boolean;
  /** Canada: vacation pay taken from the employee's balance this period, in dollars. */
  vacationPay?: string;
}

export interface PayRunRequest {
  periodStart: string;
  periodEnd: string;
  payDate: string;
  lines: PayRunLine[];
}

function invalid(message: string): never {
  throw new LedgerError("INVALID", message);
}

/** The pay run input for the employees named in the request, as their records stand now. */
export async function payRunInputFromEmployees(tx: Tx, entityId: string, req: PayRunRequest, payRunId: string): Promise<PayRunInput> {
  if (req.periodEnd < req.periodStart) invalid("the pay period ends before it starts");
  if (req.payDate < req.periodStart) invalid("the pay date is before the pay period starts");
  if (!req.lines.length) invalid("pick at least one employee to pay");
  const ids = new Set<string>();
  for (const l of req.lines) {
    if (ids.has(l.employeeId)) invalid("an employee is listed twice");
    ids.add(l.employeeId);
  }
  const all = new Map((await listEmployees(tx, entityId)).map((e) => [e.id, e]));
  const entity = (await tx.query("SELECT country, region, state_tax_rates, sick_leave_policy FROM entities WHERE id = $1", [entityId])).rows[0];
  const place: Place = { country: entity.country, region: entity.region };
  const rules = resolveRules(place, req.payDate);
  const headcount = employeeCount([...all.values()], req.periodEnd);
  const employees = req.lines.map((l): EmployeePayInput => {
    const e = all.get(l.employeeId);
    if (!e) invalid("employee not found");
    if (e.hireDate > req.periodEnd) invalid(`${e.name} starts on ${e.hireDate}, after this pay period`);
    if (e.terminationDate && e.terminationDate < req.periodStart) invalid(`${e.name}'s last day was ${e.terminationDate}, before this pay period`);
    const input = payInput(e, l, rules.state.wageHour, { policy: entity?.sick_leave_policy ?? "accrual", year: Number(req.payDate.slice(0, 4)), headcount });
    // The rate in force at the end of the period, for the business's size.
    const local = input.hourlyRate
      ? localMinimumAbove(place, minimumWageOn(rules.state.wageHour, req.periodEnd), e.workCity, req.periodEnd, headcount)
      : null;
    const withArea = rules.state.wageHour.areas && e.workCity ? { ...input, workArea: e.workCity } : input;
    return local ? { ...withArea, localMinimumWage: local } : withArea;
  });
  const standards = place.country === "CA" ? employmentStandardsFor(place.region) : null;
  if (standards) {
    const history = await wageHistory(tx, entityId, addDays(req.periodStart, -45), req.periodStart);
    for (const [i, l] of req.lines.entries()) {
      employees[i] = withEmploymentStandards(employees[i]!, all.get(l.employeeId)!, l, standards, req, history.get(l.employeeId) ?? []);
    }
  }
  return {
    payRunId, kind: "regular", periodStart: req.periodStart, periodEnd: req.periodEnd, payDate: req.payDate, place,
    employer: Object.keys(entity?.state_tax_rates ?? {}).length ? { stateRates: entity.state_tax_rates } : {},
    employees, live: true,
  };
}

/** Earlier posted pay for each employee in pay periods ending from `from` to the day before `before`, for holiday pay. */
async function wageHistory(tx: Tx, entityId: string, from: string, before: string): Promise<Map<string, WageSlice[]>> {
  const { rows } = await tx.query(
    `SELECT result FROM pay_runs WHERE entity_id = $1 AND status = 'posted'
        AND (result->>'periodEnd')::date >= $2 AND (result->>'periodEnd')::date < $3`,
    [entityId, from, before],
  );
  const out = new Map<string, WageSlice[]>();
  for (const r of rows) {
    for (const p of r.result.paychecks as Paycheck[]) {
      const list = out.get(p.employeeId) ?? out.set(p.employeeId, []).get(p.employeeId)!;
      list.push({ periodStart: r.result.periodStart, periodEnd: r.result.periodEnd, earnings: p.earnings });
    }
  }
  return out;
}

/**
 * Canada: statutory holiday pay for holidays in the period and vacation pay,
 * under the province's or territory's employment standards. Salaried employees
 * keep their salary over holidays and vacations, so only hourly employees get
 * these lines.
 */
function withEmploymentStandards(
  input: EmployeePayInput, e: Employee, l: PayRunLine, std: EmploymentStandards, req: PayRunRequest, history: WageSlice[],
): EmployeePayInput {
  if (!input.hourlyRate) {
    if (l.holidayHoursWorked || l.vacationPay) invalid(`${e.name} is salaried; their salary covers holidays and vacation, so enter holiday hours and vacation pay for hourly employees only`);
    return input;
  }
  const out: EmployeePayInput = { ...input };
  const holidays = holidaysInPeriod(std, req.periodStart, req.periodEnd);
  const dailyHours = usualDailyHours(e.usualHours, e.payFrequency);
  if (l.holidayHoursWorked && !holidays.length) invalid(`${e.name}: there's no ${std.name} statutory holiday between ${req.periodStart} and ${req.periodEnd}`);
  if (holidays.length && !l.noHolidayPay) {
    // This period's own regular pay counts for the days before each holiday that fall in it.
    const current: WageSlice = {
      periodStart: req.periodStart, periodEnd: req.periodEnd,
      earnings: [{ code: "REGULAR", hours: input.regularHours ?? "0", amountMinor: toMinor(new D(input.hourlyRate).mul(input.regularHours ?? 0)) }],
    };
    const pay = holidays
      .filter((h) => !e.terminationDate || h.date <= e.terminationDate)
      .filter((h) => h.date >= e.hireDate)
      .map((h) => holidayPayFor(std, h, { hireDate: e.hireDate, hourlyRate: e.payRate, dailyHours }, [...history, current]))
      .filter((h) => h !== null);
    out.holidayPay = pay.map((h) => ({ date: h.date, name: h.name, amount: h.amount, basis: h.basis }));
    out.holidayNotes = pay.flatMap((h) => (h.warning ? [h.warning] : []));
  }
  if (l.holidayHoursWorked) {
    out.holidayHoursWorked = l.holidayHoursWorked;
    out.holidayWorkedMultiplier = std.holidayPay.workedMultiplier;
  }
  const rate = vacationRateFor(std, e.hireDate, req.periodEnd, e.vacationPercent ? new D(e.vacationPercent).div(100).toString() : null);
  const lastPay = Boolean(e.terminationDate && e.terminationDate <= req.periodEnd);
  out.vacation = {
    method: e.vacationMethod, rate: rate.rate, label: rate.label,
    excludesOvertime: std.vacationExcludesOvertime, excludesHolidayPay: std.vacationExcludesHolidayPay,
    ...(e.vacationMethod === "accrue" ? { balance: e.vacationBalance, payout: l.vacationPay, payOutAll: lastPay } : {}),
  };
  if (e.vacationMethod === "each_pay" && l.vacationPay) invalid(`${e.name} gets vacation pay with each paycheck, so there's no balance to take it from`);
  return out;
}

/** Employees on the payroll on `date`, for minimum wages that depend on the employer's size. */
export function employeeCount(employees: Employee[], date: string): number {
  return employees.filter((e) => e.hireDate <= date && (!e.terminationDate || e.terminationDate >= date)).length;
}

/** Weeks in one pay period, for the 40 hours a week salaried employees are deemed to work. */
const WEEKS_PER_PERIOD: Record<Employee["payFrequency"], string> = { weekly: "1", biweekly: "2", semimonthly: "2.1667", monthly: "4.3333" };

function payInput(
  e: Employee, l: PayRunLine, wageHour: StateWageHourRules, sick: { policy: SickLeavePolicy; year: number; headcount: number },
): EmployeePayInput {
  const frontLoad = sick.policy === "front_load";
  const law = wageHour.sickLeave;
  // A smaller employer may cap use and accrual lower where the state allows it.
  const caps = law?.smallEmployer && sick.headcount < law.smallEmployer.under ? law.smallEmployer : law;
  const sickLeave: SickLeaveInput = {
    balanceHours: e.sickBalanceHours, policy: sick.policy, usedHours: l.sickHoursUsed,
    ...(caps && caps !== law ? { accrualCapHours: caps.accrualCapHours } : {}),
    // Front-loading grants the year's hours on the first run of the year; nothing carries over.
    ...(caps && frontLoad && e.sickGrantedYear !== sick.year ? { grantHours: caps.annualUseCapHours } : {}),
  };
  const base: EmployeePayInput = {
    employeeId: e.id, name: e.name, payFrequency: e.payFrequency,
    w4: e.w4, de4: e.de4, stateWithholding: e.stateWithholding, td1: e.td1, deductions: e.deductions,
    bonus: l.bonus, bonusDiscretionary: l.bonusDiscretionary, commission: l.commission, reimbursement: l.reimbursement,
  };
  if (e.payType === "salary") {
    return {
      ...base, salaryPerPeriod: salaryPerPeriod(e.payRate, e.payFrequency), overtimeExempt: e.overtimeExempt,
      sickLeave: { ...sickLeave, deemedHoursWorked: new D(40).mul(WEEKS_PER_PERIOD[e.payFrequency]).toString() },
    };
  }
  let hours = { regular: l.regularHours, overtime: l.overtimeHours, doubleTime: l.doubleTimeHours };
  if (l.dailyHours) {
    if (l.dailyHours.length !== 7 && l.dailyHours.length !== 14) invalid(`${e.name}: enter hours for each day of one or two workweeks`);
    const weeks = [l.dailyHours.slice(0, 7), l.dailyHours.slice(7)].filter((w) => w.length);
    const sum = { regular: new D(0), overtime: new D(0), doubleTime: new D(0) };
    for (const w of weeks) {
      let s;
      try {
        // Nevada's daily overtime is only for employees paid under 1.5 times the minimum wage.
        const ot = wageHour.overtime;
        const daily = !ot.dailyOnlyBelowHourlyRate || new D(e.payRate).lt(ot.dailyOnlyBelowHourlyRate);
        const rules = daily ? wageHour : { ...wageHour, overtime: { weeklyAfter: ot.weeklyAfter } };
        s = splitWorkweek(w.map((h) => Number(h) || 0), rules);
      } catch (err) {
        invalid(`${e.name}: ${(err as Error).message}`);
      }
      sum.regular = sum.regular.add(s.regular);
      sum.overtime = sum.overtime.add(s.overtime);
      sum.doubleTime = sum.doubleTime.add(s.doubleTime);
    }
    hours = { regular: sum.regular.toString(), overtime: sum.overtime.toString(), doubleTime: sum.doubleTime.toString() };
  }
  return {
    ...base, hourlyRate: e.payRate,
    regularHours: hours.regular, overtimeHours: hours.overtime, doubleTimeHours: hours.doubleTime,
    sickLeave,
  };
}

const FEDERAL_CODES = new Set(["FIT", "SS_EE", "SS_ER", "MEDICARE_EE", "MEDICARE_ER", "ADDL_MEDICARE_EE", "FUTA"]);

/** Year-to-date figures for one employee, in cents. */
export interface EmployeeYtd extends YearToDate {
  grossMinor: bigint;
  netPayMinor: bigint;
  byTax: Record<string, bigint>;
  byDeduction: Record<string, bigint>;
}

function emptyYtd(): EmployeeYtd {
  return { socialSecurityWages: 0n, medicareWages: 0n, futaWages: 0n, stateWages: {}, grossMinor: 0n, netPayMinor: 0n, byTax: {}, byDeduction: {} };
}

/**
 * Each employee's totals for the calendar year of `payDate`: posted runs paid
 * on or before it (except `excludeRunId`), plus anything paid before the
 * business started with TrailBook.
 */
export async function yearToDate(
  tx: Tx,
  entityId: string,
  payDate: string,
  opts: { excludeRunId?: string; throughRunId?: string } = {},
): Promise<Map<string, EmployeeYtd>> {
  const year = Number(payDate.slice(0, 4));
  const { rows } = await tx.query(
    `SELECT id, result FROM pay_runs
      WHERE entity_id = $1 AND status = 'posted' AND pay_date >= $2 AND pay_date <= $3 AND id IS DISTINCT FROM $4
      ORDER BY pay_date, created_at`,
    [entityId, `${year}-01-01`, payDate, opts.excludeRunId ?? null],
  );
  const out = new Map<string, EmployeeYtd>();
  const get = (id: string) => out.get(id) ?? out.set(id, emptyYtd()).get(id)!;
  for (const r of rows) {
    for (const p of r.result.paychecks as any[]) {
      const y = get(p.employeeId);
      const taxWages = (code: string) => BigInt(p.taxes.find((t: any) => t.code === code)?.taxableWagesMinor ?? 0);
      y.socialSecurityWages += taxWages("SS_EE");
      y.medicareWages += taxWages("MEDICARE_EE");
      y.futaWages += taxWages("FUTA");
      // Every other tax's taxable wages, for the state taxes capped at a wage base.
      for (const t of p.taxes) {
        if (!FEDERAL_CODES.has(t.code)) y.stateWages![t.code] = (y.stateWages![t.code] ?? 0n) + BigInt(t.taxableWagesMinor);
      }
      y.grossMinor += BigInt(p.grossMinor);
      y.netPayMinor += BigInt(p.netPayMinor);
      for (const t of p.taxes) y.byTax[t.code] = (y.byTax[t.code] ?? 0n) + BigInt(t.amountMinor);
      for (const d of p.deductions) y.byDeduction[d.kind] = (y.byDeduction[d.kind] ?? 0n) + BigInt(d.amountMinor);
    }
    if (r.id === opts.throughRunId) break;
  }
  const { rows: opening } = await tx.query("SELECT id, opening_ytd FROM employees WHERE entity_id = $1 AND opening_ytd IS NOT NULL", [entityId]);
  const ent = opening.length ? (await tx.query("SELECT country, region FROM entities WHERE id = $1", [entityId])).rows[0] : null;
  const state = ent ? statePackFor({ country: ent.country, region: ent.region }, payDate) : null!;
  for (const e of opening) {
    const o = openingFor({ openingYtd: e.opening_ytd }, year);
    if (o.wagesMinor === 0n && o.federalIncomeTaxMinor === 0n) continue;
    const y = get(e.id);
    // Wages paid elsewhere count toward every wage base; the caps are applied when each tax is worked out.
    y.socialSecurityWages += o.wagesMinor;
    y.medicareWages += o.wagesMinor;
    y.futaWages += o.wagesMinor;
    for (const t of state.payroll.taxes) y.stateWages![t.code] = (y.stateWages![t.code] ?? 0n) + o.wagesMinor;
    y.grossMinor += o.wagesMinor;
    const add = (code: string | undefined, v: bigint) => { if (code && v) y.byTax[code] = (y.byTax[code] ?? 0n) + v; };
    y.netPayMinor += o.wagesMinor - o.federalIncomeTaxMinor - o.socialSecurityTaxMinor - o.medicareTaxMinor - o.caIncomeTaxMinor - o.caSdiMinor;
    if (ent.country === "CA") {
      // Canada: CPP or QPP (with QPIP in Quebec) and EI, on wages paid earlier this year.
      const quebec = ent.region === "QC";
      const plan = quebec ? "QPP" : "CPP";
      for (const code of [`${plan}_EE`, "EI_EE", ...(quebec ? ["QPIP_EE"] : [])]) y.stateWages![code] = (y.stateWages![code] ?? 0n) + o.wagesMinor;
      add("CA_FIT", o.federalIncomeTaxMinor);
      add(quebec ? "QC_PIT" : "CA_PIT", o.caIncomeTaxMinor);
      add(`${plan}_EE`, o.socialSecurityTaxMinor);
      add("EI_EE", o.medicareTaxMinor);
      add("QPIP_EE", quebec ? o.caSdiMinor : 0n);
      continue;
    }
    add("FIT", o.federalIncomeTaxMinor);
    add("SS_EE", o.socialSecurityTaxMinor);
    add("MEDICARE_EE", o.medicareTaxMinor);
    // The opening figures' "caIncomeTax" and "caSdi" are the state's income tax and employee tax (SDI) wherever the business is.
    add(state.payroll.incomeTaxAgency?.code, o.caIncomeTaxMinor);
    add(state.payroll.taxes.find((t) => t.paidBy === "employee")?.code, o.caSdiMinor);
  }
  return out;
}

/** Calculates a saved run with year-to-date wages as of now. */
export async function calculateSavedRun(tx: Tx, entityId: string, input: PayRunInput): Promise<PayRun> {
  const ytd = await yearToDate(tx, entityId, input.payDate, { excludeRunId: input.payRunId });
  // Saved runs are real payroll: only released rule packs may calculate them.
  return calculatePayRun({
    ...input, live: true,
    employees: input.employees.map((e) => {
      const y = ytd.get(e.employeeId);
      return y ? { ...e, ytd: { socialSecurityWages: y.socialSecurityWages, medicareWages: y.medicareWages, futaWages: y.futaWages, stateWages: y.stateWages, taxesPaid: y.byTax } } : e;
    }),
  });
}

/** After posting: each employee's vacation pay owed moves to what the paycheck shows (accrual). */
export async function carryVacationPay(tx: Tx, entityId: string, paychecks: Paycheck[]) {
  for (const p of paychecks) {
    if (p.vacation?.method !== "accrue") continue;
    await tx.query("UPDATE employees SET vacation_balance = $3, updated_at = now() WHERE id = $1 AND entity_id = $2",
      [p.employeeId, entityId, toMajor(BigInt(p.vacation.balanceMinor)).toFixed(2)]);
  }
}

/** After posting: each employee's sick leave balance moves to what the paycheck shows. */
export async function carrySickLeave(tx: Tx, entityId: string, paychecks: Paycheck[], payDate: string) {
  for (const p of paychecks) {
    if (!p.sickLeave) continue;
    await tx.query(
      `UPDATE employees SET sick_balance_hours = $3, sick_granted_year = CASE WHEN $4 THEN $5::int ELSE sick_granted_year END, updated_at = now()
        WHERE id = $1 AND entity_id = $2`,
      [p.employeeId, entityId, p.sickLeave.balanceHours, p.sickLeave.grantedHours !== undefined, Number(payDate.slice(0, 4))],
    );
  }
}
