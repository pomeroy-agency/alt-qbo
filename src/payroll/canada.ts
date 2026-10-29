import { D, type Dec } from "../core/money.js";
import type { CanadaFederalRulePack, PensionPlanRules, PremiumRow, ProvinceRulePack, QuebecIncomeTax, RateRow, T4127ProvincialTax } from "../rules/canada/types.js";

// Canadian source deductions for one pay period, by CRA's T4127 Payroll
// Deductions Formulas (option 1, the annualized method) and, for Quebec
// income tax, Revenu Québec's TP-1015.F-V. Letters in the comments are
// T4127's: A annual taxable income, C CPP, EI premium, T1 federal tax,
// T2 provincial tax, P pay periods.

/** What one employee's TD1 forms and year to date say, plus this period's pay. */
export interface CanadaPayInput {
  /** P: pay periods in the year (52, 26, 24, 12...). */
  periodsPerYear: number;
  /** I: gross taxable remuneration this period, including taxable benefits. */
  gross: string;
  /** Pensionable earnings this period, when not the same as `gross`. */
  pensionable?: string;
  /** Insurable earnings this period, when not the same as `gross`. */
  insurable?: string;
  /** F: registered pension plan and RRSP contributions taken at source this period. */
  retirementContributions?: string;
  /** U1: union dues this period. */
  unionDues?: string;
  /** HD: annual northern residents deduction (TD1 line for prescribed zones). */
  northernDeduction?: string;
  /** F1: other annual deductions CRA authorized (child care, support payments). */
  annualDeductions?: string;
  /** TC: total claim on the federal TD1; null when none is filed (the basic personal amount then applies). */
  federalClaim?: string | null;
  /** TCP: total claim on the provincial TD1 (TP-1015.3 in Quebec); null when none is filed. */
  provincialClaim?: string | null;
  /** K1 (Quebec): other non-refundable credits Revenu Québec authorized for the year (TP-1016). */
  otherProvincialCredits?: string;
  /** Q + Q1 (Quebec): withheld this period for Fonds de solidarité FTQ or Fondaction shares. */
  labourFundShares?: string;
  /** Ontario tax reduction: dependants under 19 and dependants with a disability claimed on the TD1ON. */
  ontarioDependants?: number;
  /** L: extra tax asked for on the TD1 (federal) or TP-1015.3 (Quebec), per period. */
  extraFederalTax?: string;
  extraProvincialTax?: string;
  /** Exempt from CPP/QPP (under 18, over 70 and elected out, or a CPT30 on file) or from EI. */
  cppExempt?: boolean;
  cpp2Exempt?: boolean;
  eiExempt?: boolean;
  /** Year to date before this period. */
  ytd?: {
    /** D: CPP or QPP first contributions. */
    pension?: string;
    /** D2: CPP2 or QPP2 contributions. */
    pension2?: string;
    /** Pensionable earnings so far this year (PIYTD), for CPP2. */
    pensionableEarnings?: string;
    /** D1: EI premiums. */
    ei?: string;
    /** QPIP premiums. */
    qpip?: string;
    /** QPIP insurable earnings so far. */
    qpipEarnings?: string;
  };
}

export interface CanadaDeductions {
  /** CPP (or QPP) first contribution, CPP2 (or QPP2), EI and QPIP withheld this period. */
  pension: Dec;
  pension2: Dec;
  ei: Dec;
  qpip: Dec;
  federalTax: Dec;
  provincialTax: Dec;
  /** Employer's share: matching CPP/QPP, 1.4 × EI, and QPIP's employer rate. */
  employer: { pension: Dec; pension2: Dec; ei: Dec; qpip: Dec };
  /** A: annual taxable income the tax was worked out on. */
  annualTaxableIncome: Dec;
}

const zero = new D(0);
const clamp0 = (v: Dec) => D.max(v, 0);
const cents = (v: Dec) => v.toDecimalPlaces(2);

/**
 * Tax on annual income through rate thresholds: R × A − K with the agency's
 * published constant when the rows carry one (T4127 Table 8.1, TP-1015.F-V),
 * so results match CRA and Revenu Québec to the cent; otherwise bracket by bracket.
 */
export function bracketTax(rows: readonly RateRow[], income: Dec): Dec {
  if (rows.every((r) => r.constant !== undefined)) {
    let row = rows[0]!;
    for (const r of rows) if (income.gt(r.over)) row = r;
    return income.mul(row.rate).sub(row.constant!);
  }
  let tax = zero;
  rows.forEach((row, i) => {
    const next = rows[i + 1];
    const top = next ? D.min(income, next.over) : income;
    if (top.gt(row.over)) tax = tax.add(top.sub(row.over).mul(row.rate));
  });
  return tax;
}

/** Linear phase-out between two incomes: `max` up to `from`, `min` from `to`. */
function phased(max: Dec, min: Dec, from: string, to: string, income: Dec): Dec {
  if (income.lte(from)) return max;
  if (income.gte(to)) return min;
  return max.sub(max.sub(min).mul(income.sub(from)).div(new D(to).sub(from)));
}

export function federalBasicPersonalAmount(pack: CanadaFederalRulePack, netIncome: Dec): Dec {
  const b = pack.incomeTax.basicPersonalAmount;
  return cents(phased(new D(b.max), new D(b.min), b.phaseFrom, b.phaseTo, netIncome));
}

function healthPremium(rows: readonly PremiumRow[], income: Dec): Dec {
  let row: PremiumRow | undefined;
  for (const r of rows) if (income.gt(r.over)) row = r;
  if (!row) return zero;
  return D.min(row.cap, new D(row.base).add(income.sub(row.over).mul(row.rate)));
}

/** First contribution (C) and second (C2) for a pension plan, per T4127 chapter 4 step 1. */
function pensionContributions(plan: PensionPlanRules, input: CanadaPayInput, pensionable: Dec) {
  const p = input.periodsPerYear;
  const maxFirst = new D(plan.ympe).sub(plan.basicExemption).mul(plan.rate);
  const maxSecond = new D(plan.yampe).sub(plan.ympe).mul(plan.secondRate);
  const first = input.cppExempt ? zero : clamp0(D.min(
    maxFirst.sub(input.ytd?.pension ?? 0),
    // The exemption for the period keeps two decimals without rounding ($3,500 ÷ 26 = $134.61).
    pensionable.sub(new D(plan.basicExemption).div(p).toDecimalPlaces(2, D.ROUND_DOWN)).mul(plan.rate),
  ));
  // C2: on pensionable earnings for the year above the YMPE, up to the YAMPE.
  const ytdEarnings = new D(input.ytd?.pensionableEarnings ?? 0);
  const w = D.max(ytdEarnings, plan.ympe);
  const second = input.cppExempt || input.cpp2Exempt ? zero : clamp0(D.min(
    maxSecond.sub(input.ytd?.pension2 ?? 0),
    ytdEarnings.add(pensionable).sub(w).mul(plan.secondRate),
  ));
  return { first: cents(first), second: cents(second), maxBase: new D(plan.ympe).sub(plan.basicExemption).mul(plan.baseRate) };
}

/** Source deductions for one Canadian pay period. */
export function canadaDeductions(federal: CanadaFederalRulePack, province: ProvinceRulePack, input: CanadaPayInput): CanadaDeductions {
  const quebec = province.incomeTax.method === "quebec";
  const p = new D(input.periodsPerYear);
  const gross = new D(input.gross);
  const pensionable = new D(input.pensionable ?? input.gross);
  const insurable = new D(input.insurable ?? input.gross);
  const plan = quebec ? federal.qpp : federal.cpp;

  // Step 1: CPP/QPP, EI and QPIP.
  const pension = pensionContributions(plan, input, pensionable);
  const eiRate = quebec ? federal.ei.quebecRate : federal.ei.rate;
  const maxEi = new D(federal.ei.maxInsurableEarnings).mul(eiRate);
  const ei = input.eiExempt ? zero : cents(clamp0(D.min(maxEi.sub(input.ytd?.ei ?? 0), insurable.mul(eiRate))));
  let qpip = zero;
  let qpipEarnings = zero;
  if (quebec) {
    const max = new D(federal.qpip.maxInsurableEarnings);
    qpipEarnings = clamp0(D.min(insurable, max.sub(input.ytd?.qpipEarnings ?? 0)));
    qpip = cents(clamp0(D.min(max.mul(federal.qpip.employeeRate).sub(input.ytd?.qpip ?? 0), qpipEarnings.mul(federal.qpip.employeeRate))));
  }

  // F5: the enhanced (first additional and second) contributions are deducted from income, not credited.
  const enhancedFirst = pension.first.mul(new D(plan.rate).sub(plan.baseRate)).div(plan.rate);
  const f5 = enhancedFirst.add(pension.second);

  // Step 2: A, annual taxable income.
  const periodIncome = gross.sub(input.retirementContributions ?? 0).sub(input.unionDues ?? 0).sub(f5);
  const a = clamp0(periodIncome.mul(p).sub(input.northernDeduction ?? 0).sub(input.annualDeductions ?? 0));

  // Credits for CPP/QPP base contributions and EI (and QPIP in Quebec): annualized, or the year to date if that's more
  // (so the year's maximum is used once it's reached, as T4127 recommends), capped at the year's maximums.
  const baseRatio = new D(plan.baseRate).div(plan.rate);
  const annualized = (period: Dec, ytd: string | undefined, max: Dec) => D.min(max, D.max(period.mul(p), period.add(ytd ?? 0)));
  const baseAnnual = annualized(pension.first, input.ytd?.pension, pension.maxBase.div(baseRatio)).mul(baseRatio);
  const eiAnnual = annualized(ei, input.ytd?.ei, maxEi);
  const qpipAnnual = quebec ? annualized(qpip, input.ytd?.qpip, new D(federal.qpip.maxInsurableEarnings).mul(federal.qpip.employeeRate)) : zero;
  const contributionCredits = baseAnnual.add(eiAnnual).add(qpipAnnual);

  // Step 3: basic federal tax T3 and annual federal tax T1.
  const ft = federal.incomeTax;
  const fRate = ft.creditRate;
  const tc = input.federalClaim != null ? new D(input.federalClaim) : federalBasicPersonalAmount(federal, a.add(input.northernDeduction ?? 0));
  const k1 = tc.mul(fRate);
  const k2 = contributionCredits.mul(fRate);
  // K4: the Canada employment amount, up to the year's employment income before deductions.
  const employmentIncome = gross.mul(p);
  const k4 = D.min(employmentIncome, ft.canadaEmploymentAmount).mul(fRate);
  const t3 = clamp0(bracketTax(ft.brackets, a).sub(k1).sub(k2).sub(k4));
  const t1 = quebec ? t3.sub(t3.mul(ft.quebecAbatement)) : t3;
  const federalTax = cents(t1.div(p).add(input.extraFederalTax ?? 0));

  // Step 4: provincial tax.
  const tax = province.incomeTax;
  const t2 = tax.method === "quebec"
    ? quebecAnnualTax(tax, input, gross, pension, plan)
    : provincialAnnualTax(tax, federal, input, a, contributionCredits, employmentIncome);
  const provincialTax = cents(clamp0(t2).div(p).add(input.extraProvincialTax ?? 0));

  const employerEi = cents(ei.mul(federal.ei.employerMultiple));
  return {
    pension: pension.first,
    pension2: pension.second,
    ei,
    qpip,
    federalTax: clamp0(federalTax),
    provincialTax: clamp0(provincialTax),
    employer: {
      pension: pension.first,
      pension2: pension.second,
      ei: employerEi,
      qpip: quebec ? cents(qpipEarnings.mul(federal.qpip.employerRate)) : zero,
    },
    annualTaxableIncome: cents(a),
  };
}

/** T2: annual provincial tax by T4127 (every province and territory but Quebec). */
function provincialAnnualTax(tax: T4127ProvincialTax, federal: CanadaFederalRulePack, input: CanadaPayInput, a: Dec, contributionCredits: Dec, employmentIncome: Dec): Dec {
  const rate = tax.creditRate;
  const ni = a.add(input.northernDeduction ?? 0);
  const bpa = tax.basicPersonalAmount === "federal"
    ? federalBasicPersonalAmount(federal, ni)
    : tax.bpaPhaseOut
      ? cents(phased(new D(tax.basicPersonalAmount), new D(tax.bpaPhaseOut.min), tax.bpaPhaseOut.from, tax.bpaPhaseOut.to, ni))
      : new D(tax.basicPersonalAmount);
  let tcp = input.provincialClaim != null ? new D(input.provincialClaim) : bpa;
  if (tax.claimReplaced && tcp.eq(tax.claimReplaced.old)) tcp = new D(tax.claimReplaced.now);
  const k1p = tcp.mul(rate);
  const k2p = contributionCredits.mul(rate);
  const k4p = tax.canadaEmploymentAmount ? D.min(employmentIncome, federal.incomeTax.canadaEmploymentAmount).mul(rate) : zero;
  // K5P (Alberta): a share of the credits K1P + K2P above a set amount.
  const k5p = tax.supplementalCredit
    ? clamp0(k1p.add(k2p).sub(tax.supplementalCredit.over)).mul(tax.supplementalCredit.rate)
    : zero;
  const t4 = clamp0(bracketTax(tax.brackets, a).sub(k1p).sub(k2p).sub(k4p).sub(k5p));

  // V1: surtax on basic provincial tax (Ontario).
  const v1 = (tax.surtax ?? []).reduce((sum, row) => sum.add(clamp0(t4.sub(row.over)).mul(row.rate)), zero);
  // V2: Ontario Health Premium.
  const v2 = tax.healthPremium ? healthPremium(tax.healthPremium, a) : zero;

  // S: low-income tax reduction.
  let s = zero;
  const r = tax.taxReduction;
  if (r?.kind === "bc") {
    s = a.gt(r.zeroAbove) ? zero : D.min(t4, clamp0(new D(r.amount).sub(clamp0(a.sub(r.over)).mul(r.rate))));
  } else if (r?.kind === "on") {
    const basic = new D(r.basic).add(new D(r.perDependant).mul(input.ontarioDependants ?? 0));
    s = D.min(t4.add(v1), clamp0(basic.mul(2).sub(t4.add(v1))));
  }
  return clamp0(t4.add(v1).sub(s)).add(v2);
}

/**
 * Quebec income tax for the year by TP-1015.F-V section 2.1.1: I = P × (G −
 * F − H − CSA) − J − J1, then Y = T × I − K − K1 − 14% × E − 15% × P × (Q +
 * Q1). Union dues aren't deducted at source in Quebec.
 */
function quebecAnnualTax(tax: QuebecIncomeTax, input: CanadaPayInput, gross: Dec, pension: { first: Dec; second: Dec }, plan: PensionPlanRules): Dec {
  const p = new D(input.periodsPerYear);
  // H: deduction for workers, 6% of the period's pay up to the year's maximum spread over the periods.
  const h = cents(D.min(gross.mul(tax.employmentDeduction.rate), new D(tax.employmentDeduction.max).div(p)));
  // CSA: the additional QPP contributions (first additional share of C, and C2).
  const csa = cents(pension.first.mul(new D(plan.rate).sub(plan.baseRate)).div(plan.rate)).add(pension.second);
  const i = clamp0(gross.sub(input.retirementContributions ?? 0).sub(h).sub(csa).mul(p).sub(input.annualDeductions ?? 0));
  // E: the TP-1015.3 amount rounded to the dollar.
  const e = (input.provincialClaim != null ? new D(input.provincialClaim) : new D(tax.basicPersonalAmount)).toDecimalPlaces(0);
  const labourFunds = new D(input.labourFundShares ?? 0).mul(p).mul(tax.labourFundCreditRate);
  return clamp0(bracketTax(tax.brackets, i).sub(input.otherProvincialCredits ?? 0).sub(e.mul(tax.creditRate)).sub(labourFunds));
}
