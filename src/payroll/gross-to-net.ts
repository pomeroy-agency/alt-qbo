import { D, type Dec, maxBig, minBig, toMajor, toMinor } from "../core/money.js";
import type { ResolvedRules } from "../rules/index.js";
import { californiaWithholding, type DE4 } from "./california.js";
import { federalWithholding, type W4 } from "./federal.js";

export type PayFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly";

export const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

export type DeductionKind =
  /** Cafeteria plan (health premiums, FSA): exempt from FIT, FICA, FUTA, CA PIT, SDI and UI. */
  | "section125"
  /** Traditional 401(k) deferral: exempt from FIT and CA PIT only. */
  | "traditional401k"
  /** After-tax deduction (Roth, union dues, garnishment). */
  | "post_tax";

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
  caUiWages: bigint;
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
  commission?: string;
  /** Non-taxable expense reimbursement, added to net pay. */
  reimbursement?: string;
  w4: W4;
  de4: DE4;
  deductions?: Deduction[];
  ytd?: Partial<YearToDate>;
  sickLeave?: { balanceHours: string };
  /** A city or county minimum wage above the state's where they work, if any. */
  localMinimumWage?: { place: string; rate: string; sizeNote?: string };
}

export interface EmployerSettings {
  /** The employer's assigned UI rate from its EDD notice; defaults to the new-employer rate. */
  caUiRate?: string;
}

export interface TaxLine {
  code: "FIT" | "SS_EE" | "MEDICARE_EE" | "ADDL_MEDICARE_EE" | "CA_PIT" | "CA_SDI"
    | "SS_ER" | "MEDICARE_ER" | "FUTA" | "CA_UI" | "CA_ETT";
  agency: "IRS" | "EDD";
  paidBy: "employee" | "employer";
  taxableWagesMinor: bigint;
  amountMinor: bigint;
}

export interface Paycheck {
  employeeId: string;
  name: string;
  earnings: { code: string; hours?: string; rate?: string; amountMinor: bigint }[];
  grossMinor: bigint;
  reimbursementMinor: bigint;
  deductions: { kind: DeductionKind; description: string; amountMinor: bigint }[];
  taxes: TaxLine[];
  employeeTaxMinor: bigint;
  employerTaxMinor: bigint;
  netPayMinor: bigint;
  sickLeave?: { accruedHours: string; balanceHours: string };
  /** Problems a reviewer must clear before approval (minimum wage, exempt test, negative net). */
  blockers: string[];
  warnings: string[];
}

function money(v: string | undefined): Dec {
  return new D(v ?? 0);
}

/**
 * Calculates one employee's paycheck. This computes and prepares only:
 * Alt-QBO never moves the money or files the taxes.
 */
export function calculatePaycheck(
  input: EmployeePayInput,
  rules: ResolvedRules,
  employer: EmployerSettings = {},
): Paycheck {
  const fed = rules.federal.payroll;
  const ca = rules.state.payroll;
  const wh = rules.state.wageHour;
  const periods = PERIODS_PER_YEAR[input.payFrequency];
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Earnings
  const earnings: Paycheck["earnings"] = [];
  const rate = money(input.hourlyRate);
  const addHours = (code: string, hours: string | undefined, multiplier: number) => {
    if (!hours || new D(hours).isZero()) return;
    const r = rate.mul(multiplier);
    earnings.push({ code, hours, rate: r.toString(), amountMinor: toMinor(r.mul(hours)) });
  };
  if (input.hourlyRate) {
    if (rate.lt(wh.minimumWage)) {
      blockers.push(`hourly rate ${rate.toFixed(2)} is below the California minimum wage of ${wh.minimumWage}`);
    } else if (input.localMinimumWage && rate.lt(input.localMinimumWage.rate)) {
      const local = input.localMinimumWage;
      warnings.push(`hourly rate ${rate.toFixed(2)} is below the ${local.place} minimum wage of ${local.rate}` +
        (local.sizeNote ? ` (${local.sizeNote})` : ""));
    }
    addHours("REGULAR", input.regularHours, 1);
    addHours("OVERTIME", input.overtimeHours, 1.5);
    addHours("DOUBLE_TIME", input.doubleTimeHours, 2);
  }
  if (input.salaryPerPeriod) {
    earnings.push({ code: "SALARY", amountMinor: toMinor(input.salaryPerPeriod) });
    if (input.overtimeExempt && money(input.salaryPerPeriod).mul(periods).lt(wh.exemptAnnualSalaryMinimum)) {
      blockers.push(
        `annualised salary is below the California exempt minimum of ${wh.exemptAnnualSalaryMinimum}; ` +
        "the employee cannot be classified exempt from overtime",
      );
    }
  }
  if (input.bonus) earnings.push({ code: "BONUS", amountMinor: toMinor(input.bonus) });
  if (input.commission) earnings.push({ code: "COMMISSION", amountMinor: toMinor(input.commission) });
  const grossMinor = earnings.reduce((s, e) => s + e.amountMinor, 0n);
  if (input.bonus || input.commission) {
    warnings.push("supplemental wages withheld with the aggregate method; overtime regular-rate adjustment for bonuses is not applied");
  }

  // Deductions and taxable wage bases
  const deductions = (input.deductions ?? []).map((d) => ({
    kind: d.kind, description: d.description, amountMinor: toMinor(d.amount),
  }));
  const sumKind = (k: DeductionKind) => deductions.filter((d) => d.kind === k).reduce((s, d) => s + d.amountMinor, 0n);
  const s125 = sumKind("section125");
  const k401 = sumKind("traditional401k");

  const ficaWages = maxBig(grossMinor - s125, 0n);
  const incomeTaxWages = maxBig(grossMinor - s125 - k401, 0n);
  const sdiWages = ficaWages;
  const uiWagesThisPeriod = ficaWages;

  const ytd: YearToDate = {
    socialSecurityWages: input.ytd?.socialSecurityWages ?? 0n,
    medicareWages: input.ytd?.medicareWages ?? 0n,
    futaWages: input.ytd?.futaWages ?? 0n,
    caUiWages: input.ytd?.caUiWages ?? 0n,
  };
  const capped = (wages: bigint, ytdWages: bigint, base: string) =>
    minBig(wages, maxBig(toMinor(base) - ytdWages, 0n));
  const pct = (wagesMinor: bigint, r: string) => toMinor(toMajor(wagesMinor).mul(r));

  const taxes: TaxLine[] = [];
  const add = (code: TaxLine["code"], agency: TaxLine["agency"], paidBy: TaxLine["paidBy"], wages: bigint, amount: bigint) => {
    taxes.push({ code, agency, paidBy, taxableWagesMinor: wages, amountMinor: amount });
  };

  // Federal
  const fit = federalWithholding(fed.incomeTax, input.w4, toMajor(incomeTaxWages), periods);
  add("FIT", "IRS", "employee", incomeTaxWages, toMinor(fit));
  const ssWages = capped(ficaWages, ytd.socialSecurityWages, fed.socialSecurity.wageBase);
  add("SS_EE", "IRS", "employee", ssWages, pct(ssWages, fed.socialSecurity.employeeRate));
  add("MEDICARE_EE", "IRS", "employee", ficaWages, pct(ficaWages, fed.medicare.employeeRate));
  const threshold = toMinor(fed.medicare.additionalThreshold);
  const addlWages = maxBig(ytd.medicareWages + ficaWages - maxBig(threshold, ytd.medicareWages), 0n);
  if (addlWages > 0n) add("ADDL_MEDICARE_EE", "IRS", "employee", addlWages, pct(addlWages, fed.medicare.additionalRate));

  // California
  const pit = californiaWithholding(ca.pit, input.de4, toMajor(incomeTaxWages), periods);
  add("CA_PIT", "EDD", "employee", incomeTaxWages, toMinor(pit));
  const sdiTaxable = ca.sdi.wageBase ? capped(sdiWages, 0n, ca.sdi.wageBase) : sdiWages;
  add("CA_SDI", "EDD", "employee", sdiTaxable, pct(sdiTaxable, ca.sdi.rate));

  // Employer
  add("SS_ER", "IRS", "employer", ssWages, pct(ssWages, fed.socialSecurity.employerRate));
  add("MEDICARE_ER", "IRS", "employer", ficaWages, pct(ficaWages, fed.medicare.employerRate));
  const futaWages = capped(ficaWages, ytd.futaWages, fed.futa.wageBase);
  add("FUTA", "IRS", "employer", futaWages, pct(futaWages, fed.futa.rate));
  const uiWages = capped(uiWagesThisPeriod, ytd.caUiWages, ca.ui.wageBase);
  add("CA_UI", "EDD", "employer", uiWages, pct(uiWages, employer.caUiRate ?? ca.ui.newEmployerRate));
  const ettWages = capped(uiWagesThisPeriod, ytd.caUiWages, ca.ett.wageBase);
  add("CA_ETT", "EDD", "employer", ettWages, pct(ettWages, ca.ett.rate));

  const employeeTaxMinor = taxes.filter((t) => t.paidBy === "employee").reduce((s, t) => s + t.amountMinor, 0n);
  const employerTaxMinor = taxes.filter((t) => t.paidBy === "employer").reduce((s, t) => s + t.amountMinor, 0n);
  const deductionMinor = deductions.reduce((s, d) => s + d.amountMinor, 0n);
  const reimbursementMinor = toMinor(input.reimbursement ?? "0");
  const netPayMinor = grossMinor - employeeTaxMinor - deductionMinor + reimbursementMinor;
  if (netPayMinor < 0n) blockers.push("deductions and taxes exceed gross pay");

  // Paid sick leave: one hour per 30 worked, capped at the accrual cap.
  let sickLeave: Paycheck["sickLeave"];
  if (input.sickLeave) {
    const worked = money(input.regularHours).add(money(input.overtimeHours)).add(money(input.doubleTimeHours));
    const balance = new D(input.sickLeave.balanceHours);
    const cap = new D(wh.sickLeave.accrualCapHours);
    const accrued = D.max(D.min(worked.div(wh.sickLeave.hoursWorkedPerHourAccrued), cap.sub(balance)), 0)
      .toDecimalPlaces(4);
    sickLeave = { accruedHours: accrued.toString(), balanceHours: balance.add(accrued).toString() };
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
    blockers,
    warnings,
  };
}
