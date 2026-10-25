import type { Tx } from "../db/pool.js";
import { LedgerError } from "../core/errors.js";
import { D } from "../core/money.js";
import { resolveRules } from "../rules/index.js";
import { listEmployees, openingFor, salaryPerPeriod, type Employee } from "./employees.js";
import type { EmployeePayInput, Paycheck, TaxLine, YearToDate } from "./gross-to-net.js";
import { splitCaliforniaWeek } from "./hours.js";
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
  commission?: string;
  reimbursement?: string;
}

export interface PayRunRequest {
  periodStart: string;
  periodEnd: string;
  payDate: string;
  lines: PayRunLine[];
}

const CA = { country: "US", region: "CA" } as const;

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
  const entity = (await tx.query("SELECT ca_ui_rate::text FROM entities WHERE id = $1", [entityId])).rows[0];
  const rules = resolveRules(CA, req.payDate);
  const employees = req.lines.map((l): EmployeePayInput => {
    const e = all.get(l.employeeId);
    if (!e) invalid("employee not found");
    if (e.hireDate > req.periodEnd) invalid(`${e.name} starts on ${e.hireDate}, after this pay period`);
    if (e.terminationDate && e.terminationDate < req.periodStart) invalid(`${e.name}'s last day was ${e.terminationDate}, before this pay period`);
    return payInput(e, l, rules.state.wageHour);
  });
  return {
    payRunId, kind: "regular", periodStart: req.periodStart, periodEnd: req.periodEnd, payDate: req.payDate, place: CA,
    employer: entity?.ca_ui_rate ? { caUiRate: new D(entity.ca_ui_rate).toString() } : {},
    employees, live: false,
  };
}

function payInput(e: Employee, l: PayRunLine, wageHour: Parameters<typeof splitCaliforniaWeek>[1]): EmployeePayInput {
  const base: EmployeePayInput = {
    employeeId: e.id, name: e.name, payFrequency: e.payFrequency,
    w4: e.w4, de4: e.de4, deductions: e.deductions,
    bonus: l.bonus, commission: l.commission, reimbursement: l.reimbursement,
  };
  if (e.payType === "salary") {
    return { ...base, salaryPerPeriod: salaryPerPeriod(e.payRate, e.payFrequency), overtimeExempt: e.overtimeExempt };
  }
  let hours = { regular: l.regularHours, overtime: l.overtimeHours, doubleTime: l.doubleTimeHours };
  if (l.dailyHours) {
    if (l.dailyHours.length !== 7 && l.dailyHours.length !== 14) invalid(`${e.name}: enter hours for each day of one or two workweeks`);
    const weeks = [l.dailyHours.slice(0, 7), l.dailyHours.slice(7)].filter((w) => w.length);
    const sum = { regular: new D(0), overtime: new D(0), doubleTime: new D(0) };
    for (const w of weeks) {
      let s;
      try {
        s = splitCaliforniaWeek(w.map((h) => Number(h) || 0), wageHour);
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
    sickLeave: { balanceHours: e.sickBalanceHours },
  };
}

/** Year-to-date figures for one employee, in cents. */
export interface EmployeeYtd extends YearToDate {
  grossMinor: bigint;
  netPayMinor: bigint;
  byTax: Partial<Record<TaxLine["code"], bigint>>;
  byDeduction: Record<string, bigint>;
}

function emptyYtd(): EmployeeYtd {
  return { socialSecurityWages: 0n, medicareWages: 0n, futaWages: 0n, caUiWages: 0n, grossMinor: 0n, netPayMinor: 0n, byTax: {}, byDeduction: {} };
}

/**
 * Each employee's totals for the calendar year of `payDate`: posted runs paid
 * on or before it (except `excludeRunId`), plus anything paid before the
 * business started with Alt-QBO.
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
      y.caUiWages += taxWages("CA_UI");
      y.grossMinor += BigInt(p.grossMinor);
      y.netPayMinor += BigInt(p.netPayMinor);
      for (const t of p.taxes) y.byTax[t.code as TaxLine["code"]] = (y.byTax[t.code as TaxLine["code"]] ?? 0n) + BigInt(t.amountMinor);
      for (const d of p.deductions) y.byDeduction[d.kind] = (y.byDeduction[d.kind] ?? 0n) + BigInt(d.amountMinor);
    }
    if (r.id === opts.throughRunId) break;
  }
  const { rows: opening } = await tx.query("SELECT id, opening_ytd FROM employees WHERE entity_id = $1 AND opening_ytd IS NOT NULL", [entityId]);
  for (const e of opening) {
    const o = openingFor({ openingYtd: e.opening_ytd }, year);
    if (o.wagesMinor === 0n && o.federalIncomeTaxMinor === 0n) continue;
    const y = get(e.id);
    // Wages paid elsewhere count toward every wage base; the caps are applied when each tax is worked out.
    y.socialSecurityWages += o.wagesMinor;
    y.medicareWages += o.wagesMinor;
    y.futaWages += o.wagesMinor;
    y.caUiWages += o.wagesMinor;
    y.grossMinor += o.wagesMinor;
    const add = (code: TaxLine["code"], v: bigint) => { if (v) y.byTax[code] = (y.byTax[code] ?? 0n) + v; };
    add("FIT", o.federalIncomeTaxMinor);
    add("SS_EE", o.socialSecurityTaxMinor);
    add("MEDICARE_EE", o.medicareTaxMinor);
    add("CA_PIT", o.caIncomeTaxMinor);
    add("CA_SDI", o.caSdiMinor);
    y.netPayMinor += o.wagesMinor - o.federalIncomeTaxMinor - o.socialSecurityTaxMinor - o.medicareTaxMinor - o.caIncomeTaxMinor - o.caSdiMinor;
  }
  return out;
}

/** Calculates a saved run with year-to-date wages as of now. */
export async function calculateSavedRun(tx: Tx, entityId: string, input: PayRunInput): Promise<PayRun> {
  const ytd = await yearToDate(tx, entityId, input.payDate, { excludeRunId: input.payRunId });
  return calculatePayRun({
    ...input,
    employees: input.employees.map((e) => {
      const y = ytd.get(e.employeeId);
      return y ? { ...e, ytd: { socialSecurityWages: y.socialSecurityWages, medicareWages: y.medicareWages, futaWages: y.futaWages, caUiWages: y.caUiWages } } : e;
    }),
  });
}

/** After posting: each hourly employee's sick leave balance moves to what the paycheck shows. */
export async function carrySickLeave(tx: Tx, entityId: string, paychecks: Paycheck[]) {
  for (const p of paychecks) {
    if (!p.sickLeave) continue;
    await tx.query("UPDATE employees SET sick_balance_hours = $3, updated_at = now() WHERE id = $1 AND entity_id = $2", [p.employeeId, entityId, p.sickLeave.balanceHours]);
  }
}
