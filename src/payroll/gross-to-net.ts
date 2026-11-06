import { D, type Dec, maxBig, minBig, toMajor, toMinor } from "../core/money.js";
import { usFederal, type ResolvedRules } from "../rules/index.js";
import type { DE4 } from "./california.js";
import { federalWithholding, type W4 } from "./federal.js";
import { localWithholding, stateWithholding, type StateWithholding } from "./state-withholding.js";
import { canadaTaxLines, type CanadaTd1 } from "./canada.js";
import { exemptSalaryOn, minimumWageOn, wageAreaName, wageHourFor } from "../rules/minimum-wage.js";

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

export type DeductionKind =
  /** Cafeteria plan (health premiums, FSA): exempt from FIT, FICA, FUTA, state income tax, SDI and UI. */
  | "section125"
  /** Traditional 401(k) deferral: exempt from FIT and state income tax only. */
  | "traditional401k"
  /** After-tax deduction (Roth, union dues, garnishment). */
  | "post_tax"
  /** Canada: registered pension plan or RRSP contribution at source: exempt from income tax, not from CPP or EI. */
  | "registered_retirement";

export interface Deduction {
  kind: DeductionKind;
  amount: string;
  description: string;
}

/** Year-to-date wages already subject to each capped tax, before this pay date (minor units). */
export interface YearToDate {
  socialSecurityWages: bigint;
  medicareWages: bigint;
  futaWages: bigint;
  /** Wages already taxed this year by each capped state tax, by tax code (CA_UI, TX_UI...). */
  stateWages?: Record<string, bigint>;
  /** Each tax code's amount so far this year (Canada: CPP, EI and QPIP stop at the year's maximums). */
  taxesPaid?: Record<string, bigint>;
}

export interface EmployeePayInput {
  employeeId: string;
  name: string;
  payFrequency: PayFrequency;
  hourlyRate?: string;
  regularHours?: string;
  overtimeHours?: string;
  doubleTimeHours?: string;
  salaryPerPeriod?: string;
  /** True for employees classified exempt from overtime; checked against the salary floor. */
  overtimeExempt?: boolean;
  bonus?: string;
  /** A bonus given at the employer's sole discretion (not promised or tied to work), which stays out of the regular rate. */
  bonusDiscretionary?: boolean;
  commission?: string;
  /** Non-taxable expense reimbursement, added to net pay. */
  reimbursement?: string;
  w4: W4;
  /** California employees' DE 4. */
  de4?: DE4;
  /** Other states' withholding certificate (Arizona A-4...). */
  stateWithholding?: StateWithholding | null;
  /** Canada: the employee's TD1 forms (TP-1015.3 in Quebec). */
  td1?: CanadaTd1 | null;
  /** Where they work, in states with minimum wage areas (Portland metro, New York City...). */
  workArea?: string | null;
  deductions?: Deduction[];
  ytd?: Partial<YearToDate>;
  sickLeave?: SickLeaveInput;
  /** Canada: statutory holiday pay for holidays in the period, worked out from earlier pay (src/payroll/employment-standards.ts). */
  holidayPay?: { date: string; name: string; amount: string; basis?: string }[];
  /** Canada: hours worked on a statutory holiday, paid at the region's premium on top of the holiday pay. */
  holidayHoursWorked?: string;
  holidayWorkedMultiplier?: string;
  /** Things the reviewer should check about the holiday pay (short history...). */
  holidayNotes?: string[];
  /** Canada: vacation pay, paid with each paycheck or accrued and paid when the employee takes time off. */
  vacation?: VacationInput;
  /** A city or county minimum wage above the state's where they work, if any. */
  localMinimumWage?: { place: string; rate: string; sizeNote?: string };
}

export type VacationMethod = "accrue" | "each_pay";

export interface VacationInput {
  method: VacationMethod;
  /** The vacation pay rate, as a fraction (0.04). */
  rate: string;
  /** "4%" or "3/52", for the stub. */
  label?: string;
  /** Vacation pay owed before this paycheck, in dollars (accrual). */
  balance?: string;
  /** Vacation pay taken from the balance with this paycheck, in dollars (accrual). */
  payout?: string;
  /** Pay the whole balance with this paycheck (the last one). */
  payOutAll?: boolean;
  excludesOvertime?: boolean;
  excludesHolidayPay?: boolean;
}

export type SickLeavePolicy = "accrual" | "front_load";

/** Paid sick leave for one paycheck, under the state's law (California Labor Code 245-249, Arizona A.R.S. 23-371...). */
export interface SickLeaveInput {
  /** Hours available before this paycheck. */
  balanceHours: string;
  policy?: SickLeavePolicy;
  /** Hours of sick leave taken in this pay period. */
  usedHours?: string;
  /** Lower accrual cap where the law allows it for a small employer (Arizona, under 15 employees); null for none. */
  accrualCapHours?: string | null;
  /** Front-loading: hours granted for the year with this paycheck; the balance becomes at least this (no carryover required). */
  grantHours?: string;
  /** Exempt and salaried employees: hours they are deemed to work for accrual (40 a week, Labor Code 246(b)(3)). */
  deemedHoursWorked?: string;
}

export interface EmployerSettings {
  /** Rates the agency assigned this employer (UI), by tax code; others use the pack's new-employer rate. */
  stateRates?: Record<string, string>;
}

export interface TaxLine {
  /** Federal codes (FIT, SS_EE...) or a state pack's codes (CA_PIT, CA_SDI, TX_UI...). */
  code: string;
  /** "IRS" or the state agency's short name. */
  agency: string;
  paidBy: "employee" | "employer";
  taxableWagesMinor: bigint;
  amountMinor: bigint;
}

export interface Paycheck {
  employeeId: string;
  name: string;
  earnings: { code: string; hours?: string; rate?: string; amountMinor: bigint; note?: string }[];
  grossMinor: bigint;
  reimbursementMinor: bigint;
  deductions: { kind: DeductionKind; description: string; amountMinor: bigint }[];
  taxes: TaxLine[];
  employeeTaxMinor: bigint;
  employerTaxMinor: bigint;
  netPayMinor: bigint;
  sickLeave?: { accruedHours: string; usedHours: string; grantedHours?: string; balanceHours: string };
  /** Canada: vacation pay earned, paid and still owed. */
  vacation?: { method: VacationMethod; rate: string; label?: string; vacationableMinor: bigint; accruedMinor: bigint; paidMinor: bigint; balanceMinor: bigint };
  /** Problems a reviewer must clear before approval (minimum wage, exempt test, negative net). */
  blockers: string[];
  warnings: string[];
}

function money(v: string | undefined): Dec {
  return new D(v ?? 0);
}

/**
 * Calculates one employee's paycheck. This computes and prepares only:
 * TrailBook never moves the money or files the taxes.
 */
export function calculatePaycheck(
  input: EmployeePayInput,
  rules: ResolvedRules,
  employer: EmployerSettings = {},
  /** The date the minimum wage is checked on (the period's last day); the pack's start when omitted. */
  onDate: string = rules.state.effectiveFrom,
): Paycheck {
  const st = rules.state.payroll;
  const area = wageAreaName(rules.state.wageHour, input.workArea);
  const wh = wageHourFor(rules.state.wageHour, area);
  const stateName = rules.state.name;
  const minimumWage = minimumWageOn(wh, onDate);
  const wageLabel = area ? `${stateName} (${area})` : stateName;
  const periods = PERIODS_PER_YEAR[input.payFrequency];
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Earnings
  const earnings: Paycheck["earnings"] = [];
  const rate = money(input.hourlyRate);
  const addHours = (code: string, hours: string | undefined, multiplier: number | string) => {
    if (!hours || new D(hours).isZero()) return;
    const r = rate.mul(multiplier);
    earnings.push({ code, hours, rate: r.toString(), amountMinor: toMinor(r.mul(hours)) });
  };
  if (input.hourlyRate) {
    if (rate.lt(minimumWage)) {
      blockers.push(`hourly rate ${rate.toFixed(2)} is below the ${wageLabel} minimum wage of ${minimumWage}`);
    } else if (input.localMinimumWage && rate.lt(input.localMinimumWage.rate)) {
      const local = input.localMinimumWage;
      warnings.push(`hourly rate ${rate.toFixed(2)} is below the ${local.place} minimum wage of ${local.rate}` +
        (local.sizeNote ? ` (${local.sizeNote})` : ""));
    }
    addHours("REGULAR", input.regularHours, 1);
    addHours("OVERTIME", input.overtimeHours, 1.5);
    addHours("DOUBLE_TIME", input.doubleTimeHours, 2);
    // Sick leave taken is paid at the hourly rate; it isn't hours worked for overtime or accrual.
    addHours("SICK", input.sickLeave?.usedHours, 1);
    addHours("HOLIDAY_WORKED", input.holidayHoursWorked, input.holidayWorkedMultiplier ?? "1.5");
  }
  warnings.push(...(input.holidayNotes ?? []));
  for (const h of input.holidayPay ?? []) {
    const amountMinor = toMinor(h.amount);
    if (amountMinor > 0n) earnings.push({ code: "HOLIDAY", amountMinor, note: `${h.name} ${h.date}${h.basis ? `: ${h.basis}` : ""}` });
  }
  if (input.salaryPerPeriod) {
    earnings.push({ code: "SALARY", amountMinor: toMinor(input.salaryPerPeriod) });
    const exemptFloor = exemptSalaryOn(wh, onDate);
    if (input.overtimeExempt && money(input.salaryPerPeriod).mul(periods).lt(exemptFloor)) {
      blockers.push(
        `annualised salary is below the ${wageLabel} exempt minimum of ${exemptFloor}; ` +
        "the employee cannot be classified exempt from overtime",
      );
    }
  }
  if (input.bonus) earnings.push({ code: "BONUS", amountMinor: toMinor(input.bonus) });
  if (input.commission) earnings.push({ code: "COMMISSION", amountMinor: toMinor(input.commission) });
  // Overtime on a bonus or commission (FLSA regular rate; Labor Code 510 in California): it raises the regular rate for the overtime hours.
  // A flat-sum bonus is spread over the non-overtime hours and paid at 1.5x / 2x (Alvarado v. Dave & Buster's,
  // 2018); a commission is spread over all hours, with the extra half (or whole) rate for overtime (or double
  // time). Worked over the pay period, which matches the workweek method when the hours and pay fall in it.
  const ot = money(input.overtimeHours), dt = money(input.doubleTimeHours), reg = money(input.regularHours);
  if (input.hourlyRate && (ot.gt(0) || dt.gt(0))) {
    let extra = new D(0);
    if (input.bonus && !input.bonusDiscretionary) {
      const spread = reg.gt(0) ? reg : reg.add(ot).add(dt);
      const r = money(input.bonus).div(spread);
      extra = extra.add(r.mul(1.5).mul(ot)).add(r.mul(2).mul(dt));
    }
    if (input.commission) {
      const r = money(input.commission).div(reg.add(ot).add(dt));
      extra = extra.add(r.mul(0.5).mul(ot)).add(r.mul(dt));
    }
    if (extra.gt(0)) earnings.push({ code: "OVERTIME_ON_BONUS", amountMinor: toMinor(extra) });
  }
  if (input.salaryPerPeriod && !input.overtimeExempt && (input.bonus || input.commission)) {
    warnings.push("this employee is salaried and not exempt; enter any overtime they worked as an hourly employee so it's paid");
  }
  // Vacation pay on the wages earned this period: paid now, or added to the balance owed.
  let vacation: Paycheck["vacation"];
  if (input.vacation) {
    const v = input.vacation;
    const overtime = new Set(["OVERTIME", "DOUBLE_TIME", "OVERTIME_ON_BONUS"]);
    let vacationableMinor = 0n;
    for (const e of earnings) {
      if (e.code === "BONUS" && input.bonusDiscretionary) continue;
      if (v.excludesOvertime && overtime.has(e.code)) continue;
      if (v.excludesHolidayPay && e.code === "HOLIDAY") continue;
      // Hours worked on a holiday count at straight time when overtime premiums don't.
      if (v.excludesOvertime && e.code === "HOLIDAY_WORKED") {
        vacationableMinor += toMinor(rate.mul(e.hours ?? 0));
        continue;
      }
      vacationableMinor += e.amountMinor;
    }
    const earned = toMinor(toMajor(vacationableMinor).mul(v.rate));
    if (v.method === "each_pay") {
      if (earned > 0n) earnings.push({ code: "VACATION", amountMinor: earned, ...(v.label ? { note: v.label } : {}) });
      vacation = { method: v.method, rate: v.rate, label: v.label, vacationableMinor, accruedMinor: earned, paidMinor: earned, balanceMinor: 0n };
    } else {
      const available = toMinor(v.balance ?? "0") + earned;
      let paid = v.payOutAll ? available : toMinor(v.payout ?? "0");
      if (paid < 0n) paid = 0n;
      if (paid > available) {
        blockers.push(`${toMajor(paid).toFixed(2)} of vacation pay taken, but only ${toMajor(available).toFixed(2)} is owed`);
      }
      if (paid > 0n) earnings.push({ code: "VACATION", amountMinor: paid, note: "from the vacation balance" });
      vacation = { method: v.method, rate: v.rate, label: v.label, vacationableMinor, accruedMinor: earned, paidMinor: paid, balanceMinor: available - paid > 0n ? available - paid : 0n };
    }
  }
  const grossMinor = earnings.reduce((s, e) => s + e.amountMinor, 0n);
  if (input.bonus || input.commission) {
    warnings.push("bonus and commission withheld with the aggregate method");
  }

  // Deductions and taxable wage bases
  const deductions = (input.deductions ?? []).map((d) => ({
    kind: d.kind, description: d.description, amountMinor: toMinor(d.amount),
  }));
  const sumKind = (k: DeductionKind) => deductions.filter((d) => d.kind === k).reduce((s, d) => s + d.amountMinor, 0n);
  const s125 = sumKind("section125");
  const k401 = sumKind("traditional401k") + sumKind("registered_retirement");

  const ficaWages = maxBig(grossMinor - s125, 0n);
  const incomeTaxWages = maxBig(grossMinor - s125 - k401, 0n);

  const ytd: YearToDate = {
    socialSecurityWages: input.ytd?.socialSecurityWages ?? 0n,
    medicareWages: input.ytd?.medicareWages ?? 0n,
    futaWages: input.ytd?.futaWages ?? 0n,
    stateWages: input.ytd?.stateWages ?? {},
    taxesPaid: input.ytd?.taxesPaid ?? {},
  };
  const capped = (wages: bigint, ytdWages: bigint, base: string) =>
    minBig(wages, maxBig(toMinor(base) - ytdWages, 0n));
  const pct = (wagesMinor: bigint, r: string) => toMinor(toMajor(wagesMinor).mul(r));

  const taxes: TaxLine[] = [];
  const add = (code: string, agency: string, paidBy: TaxLine["paidBy"], wages: bigint, amount: bigint) => {
    taxes.push({ code, agency, paidBy, taxableWagesMinor: wages, amountMinor: amount });
  };

  // Hours worked for taxes charged by the hour; a salaried employee counts as 40 hours a week.
  const hoursWorked = input.hourlyRate ? money(input.regularHours).add(money(input.overtimeHours)).add(money(input.doubleTimeHours)) : new D(2080).div(periods);
  const stateTax = (t: (typeof st.taxes)[number]) => {
    const wages = t.wageBase ? capped(ficaWages, ytd.stateWages?.[t.code] ?? 0n, t.wageBase) : ficaWages;
    const own = t.assignedRate ? employer.stateRates?.[t.code] : undefined;
    if (t.assignedRate?.required && !own) blockers.push(`enter your ${t.label} rate in payroll settings; ${stateName} sets each new employer's rate by industry`);
    const r = own || t.rate;
    let amount = t.perHour ? toMinor(hoursWorked.mul(t.perHour)) : pct(wages, r);
    if (t.perWeekCap) amount = minBig(amount, toMinor(new D(t.perWeekCap).mul(52).div(periods)));
    add(t.code, t.agency, t.paidBy, wages, amount);
  };
  const canada = rules.federal.kind === "ca-federal" && rules.province
    ? canadaTaxLines(rules.federal, rules.province, input.td1 ?? {}, {
      grossMinor, retirementMinor: k401, periodsPerYear: periods, ytdTaxes: ytd.taxesPaid ?? {}, ytdWages: ytd.stateWages ?? {},
    })
    : null;
  if (canada) {
    // Canada: income tax, CPP or QPP, EI and QPIP together (src/payroll/canada.ts).
    taxes.push(...canada.filter((t) => t.paidBy === "employee"));
    if (!input.td1 && st.incomeTax.method === "canada") warnings.push(`no TD1 or ${st.incomeTax.certificate} on file: tax worked out on the basic personal amounts`);
  } else {
    const fed = usFederal(rules).payroll;
    // Federal
    const fit = federalWithholding(fed.incomeTax, input.w4, toMajor(incomeTaxWages), periods);
    add("FIT", "IRS", "employee", incomeTaxWages, toMinor(fit));
    const ssWages = capped(ficaWages, ytd.socialSecurityWages, fed.socialSecurity.wageBase);
    add("SS_EE", "IRS", "employee", ssWages, pct(ssWages, fed.socialSecurity.employeeRate));
    add("MEDICARE_EE", "IRS", "employee", ficaWages, pct(ficaWages, fed.medicare.employeeRate));
    const threshold = toMinor(fed.medicare.additionalThreshold);
    const addlWages = maxBig(ytd.medicareWages + ficaWages - maxBig(threshold, ytd.medicareWages), 0n);
    if (addlWages > 0n) add("ADDL_MEDICARE_EE", "IRS", "employee", addlWages, pct(addlWages, fed.medicare.additionalRate));

    // State income tax, then the state's other wage taxes (SDI, UI, ETT...), all on wages less section 125.
    if (st.incomeTaxAgency) {
      // Massachusetts takes the employee's Social Security and Medicare off first, up to $2,000 a year.
      const ficaThisPeriod = taxes.filter((t) => t.paidBy === "employee" && t.code !== "FIT").reduce((sum, t) => sum + t.amountMinor, 0n);
      const fica = {
        thisPeriod: toMajor(ficaThisPeriod),
        yearToDate: toMajor(ytd.socialSecurityWages).mul(fed.socialSecurity.employeeRate).add(toMajor(ytd.medicareWages).mul(fed.medicare.employeeRate)),
      };
      const sit = stateWithholding(st.incomeTax, { de4: input.de4, state: input.stateWithholding, w4Status: input.w4.filingStatus }, toMajor(incomeTaxWages), periods, fit, fica);
      if (st.incomeTax.method === "or_formula" && !input.stateWithholding) {
        warnings.push(`no ${st.incomeTax.certificate} on file: ${stateName} income tax withheld at the flat ${new D(st.incomeTax.noCertificateRate).mul(100)}%`);
      }
      add(st.incomeTaxAgency.code, st.incomeTaxAgency.agency, "employee", incomeTaxWages, toMinor(sit));
      // City income taxes (New York City, Yonkers) for employees whose record says they apply.
      for (const local of st.localIncomeTaxes ?? []) {
        const amount = localWithholding(local, st.incomeTax, input.stateWithholding, toMajor(incomeTaxWages), periods, onDate);
        if (amount.gt(0)) add(local.code, local.agency, "employee", incomeTaxWages, toMinor(amount));
      }
    }
  }
  for (const t of st.taxes) if (t.paidBy === "employee") stateTax(t);

  if (canada) {
    taxes.push(...canada.filter((t) => t.paidBy === "employer"));
  } else {
    const fed = usFederal(rules).payroll;
    // Employer
    const ssWages = capped(ficaWages, ytd.socialSecurityWages, fed.socialSecurity.wageBase);
    add("SS_ER", "IRS", "employer", ssWages, pct(ssWages, fed.socialSecurity.employerRate));
    add("MEDICARE_ER", "IRS", "employer", ficaWages, pct(ficaWages, fed.medicare.employerRate));
    const futaWages = capped(ficaWages, ytd.futaWages, fed.futa.wageBase);
    add("FUTA", "IRS", "employer", futaWages, pct(futaWages, fed.futa.rate));
  }
  for (const t of st.taxes) if (t.paidBy === "employer") stateTax(t);

  const employeeTaxMinor = taxes.filter((t) => t.paidBy === "employee").reduce((s, t) => s + t.amountMinor, 0n);
  const employerTaxMinor = taxes.filter((t) => t.paidBy === "employer").reduce((s, t) => s + t.amountMinor, 0n);
  const deductionMinor = deductions.reduce((s, d) => s + d.amountMinor, 0n);
  const reimbursementMinor = toMinor(input.reimbursement ?? "0");
  const netPayMinor = grossMinor - employeeTaxMinor - deductionMinor + reimbursementMinor;
  if (netPayMinor < 0n) blockers.push("deductions and taxes exceed gross pay");

  // Paid sick leave: front-loaded hours at the start of the year, or one hour per 30 worked up to the
  // accrual cap; hours taken come off the balance and can't exceed it.
  let sickLeave: Paycheck["sickLeave"];
  if (input.sickLeave && wh.sickLeave) {
    const law = wh.sickLeave;
    const sl = input.sickLeave;
    // A grant tops the balance up to the year's hours; hours already earned above that (say, before
    // the business switched from accrual) are kept.
    const granted = sl.grantHours ? new D(sl.grantHours) : null;
    const start = granted ? D.max(granted, sl.balanceHours) : new D(sl.balanceHours);
    const used = money(sl.usedHours);
    if (used.gt(start)) blockers.push(`${used.toString()} sick hours taken, but only ${start.toString()} available`);
    const after = D.max(start.sub(used), 0);
    let accrued = new D(0);
    if ((sl.policy ?? "accrual") === "accrual") {
      const worked = sl.deemedHoursWorked ? new D(sl.deemedHoursWorked) : reg.add(ot).add(dt);
      const capHours = sl.accrualCapHours !== undefined ? sl.accrualCapHours : law.accrualCapHours;
      const earned = worked.div(law.hoursWorkedPerHourAccrued);
      accrued = D.max(capHours === null ? earned : D.min(earned, new D(capHours).sub(after)), 0).toDecimalPlaces(4);
    }
    sickLeave = {
      accruedHours: accrued.toString(), usedHours: used.toString(), ...(granted ? { grantedHours: granted.toString() } : {}),
      balanceHours: after.add(accrued).toString(),
    };
  }

  return {
    employeeId: input.employeeId,
    name: input.name,
    earnings,
    grossMinor,
    reimbursementMinor,
    deductions,
    taxes,
    employeeTaxMinor,
    employerTaxMinor,
    netPayMinor,
    sickLeave,
    ...(vacation ? { vacation } : {}),
    blockers,
    warnings,
  };
}
