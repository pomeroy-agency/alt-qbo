import { addDays, businessDaysAfter, endOfNextMonth, fifteenthOfNextMonth, onOrNextBusinessDay, quarterEnd, quarterOf, type Calendar } from "./business-days.js";
import type { Deposit, RunTaxes } from "./deposits.js";

// Canadian source deduction remittances. Deductions are owed when the pay is
// paid, and the remitter type sets when they're due: CRA's guide T4001
// (chapter 8) and Revenu Québec's TP-1015.G-V use the same four frequencies,
// set by the employer's average monthly withholding two years before. A due
// date on a weekend or public holiday moves to the next business day. The
// business pays through My Business Account, Mon dossier or its bank;
// TrailBook works out what's due and when.

/** How often a business remits, as CRA (or Revenu Québec) has told it. */
export type RemitterType = "quarterly" | "regular" | "threshold1" | "threshold2";

export const REMITTER_TYPES: Record<RemitterType, { cra: string; rq: string }> = {
  quarterly: { cra: "Quarterly (CRA approved it: small, with a clean record)", rq: "Quarterly" },
  regular: { cra: "Regular (monthly): new employers and most small ones", rq: "Monthly: new employers and most small ones" },
  threshold1: { cra: "Accelerated threshold 1 (twice a month): $25,000 to $99,999.99 a month", rq: "Twice a month: $25,000 to $99,999.99 a month" },
  threshold2: { cra: "Accelerated threshold 2 (up to four times a month): $100,000 or more a month", rq: "Four times a month: $100,000 or more a month" },
};

interface Remittance {
  kind: string;
  agency: string;
  what: string;
  where: string;
  codes: string[];
  calendar: Calendar;
}

/** CRA: income tax (federal, and provincial outside Quebec), CPP and EI. */
export const CRA_REMITTANCE: Remittance = {
  kind: "ca_cra_remit", agency: "CRA", what: "Source deductions: income tax, CPP and EI (PD7A)",
  where: "My Business Account, your bank's online banking (CRA source deductions payee), or a pre-authorized debit",
  codes: ["CA_FIT", "CA_PIT", "CPP_EE", "CPP2_EE", "CPP_ER", "CPP2_ER", "EI_EE", "EI_ER"], calendar: "canada",
};

/** Revenu Québec: Quebec tax, QPP, QPIP, the health services fund and CNESST premiums. */
export const RQ_REMITTANCE: Remittance = {
  kind: "qc_rq_remit", agency: "Revenu Québec",
  what: "Source deductions and employer contributions: Quebec tax, QPP, QPIP, health services fund and CNESST (TPZ-1015.R.14)",
  where: "My Account for businesses (Mon dossier), or your bank's online banking (Revenu Québec source deductions payee)",
  codes: ["QC_PIT", "QPP_EE", "QPP2_EE", "QPP_ER", "QPP2_ER", "QPIP_EE", "QPIP_ER", "QC_HSF", "QC_CNESST"], calendar: "quebec",
};

/** Revenu Québec, once a year with the RL-1 summary: the labour standards contribution and the WSDRF. */
export const RQ_ANNUAL: Remittance = {
  kind: "qc_rlz1s", agency: "Revenu Québec", what: "Labour standards contribution (CNT) and WSDRF, with the RL-1 summary (RLZ-1.S)",
  where: "My Account for businesses (Mon dossier), with the RLZ-1.S", codes: ["QC_CNT", "QC_WSDRF"], calendar: "quebec",
};

export const CANADA_REMITTANCES = [CRA_REMITTANCE, RQ_REMITTANCE, RQ_ANNUAL];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
const lastOfMonth = (date: string) => addDays(`${endOfNextMonth(date).slice(0, 8)}01`, -1);

/** The remittance period a pay date falls in: its key, label, last day and due date, with the rule in words. */
function period(payDate: string, type: RemitterType, cal: Calendar) {
  const ym = payDate.slice(0, 7);
  const dom = Number(payDate.slice(8));
  if (type === "quarterly") {
    const q = quarterOf(payDate);
    const end = quarterEnd(Number(payDate.slice(0, 4)), q);
    return { key: `${payDate.slice(0, 4)}-Q${q}`, label: `Q${q} ${payDate.slice(0, 4)}`, due: onOrNextBusinessDay(fifteenthOfNextMonth(end), cal),
      rule: "Quarterly remitter: by the 15th of the month after the quarter" };
  }
  if (type === "regular") {
    return { key: `${ym}`, label: monthName(payDate), due: onOrNextBusinessDay(fifteenthOfNextMonth(payDate), cal),
      rule: "Monthly: by the 15th of the month after the pay date" };
  }
  if (type === "threshold1") {
    return dom <= 15
      ? { key: `${ym}-a`, label: `${monthName(payDate)}, 1st to 15th`, due: onOrNextBusinessDay(`${ym}-25`, cal), rule: "Twice a month: pay dates from the 1st to the 15th by the 25th" }
      : { key: `${ym}-b`, label: `${monthName(payDate)}, 16th to end`, due: onOrNextBusinessDay(`${fifteenthOfNextMonth(payDate).slice(0, 8)}10`, cal),
        rule: "Twice a month: pay dates from the 16th to the month's end by the 10th of the next month" };
  }
  // Threshold 2: the 1st to 7th, 8th to 14th, 15th to 21st and 22nd to the end, each due three working days after it closes.
  const part = dom <= 7 ? 0 : dom <= 14 ? 1 : dom <= 21 ? 2 : 3;
  const end = part === 3 ? lastOfMonth(payDate) : `${ym}-${String((part + 1) * 7).padStart(2, "0")}`;
  return { key: `${ym}-w${part + 1}`, label: `${monthName(payDate)}, ${["1st to 7th", "8th to 14th", "15th to 21st", "22nd to end"][part]}`,
    due: businessDaysAfter(end, 3, cal), rule: "Four times a month: by the third working day after each period closes" };
}

/**
 * Canadian remittances for one calendar year's posted runs: CRA's and, in
 * Quebec, Revenu Québec's by the business's remitter types, and Quebec's
 * yearly CNT and WSDRF with the RL-1 summary.
 */
export function canadaRemittanceSchedule(runs: RunTaxes[], types: { cra: RemitterType; rq: RemitterType }): Deposit[] {
  const sorted = [...runs].sort((a, b) => a.payDate.localeCompare(b.payDate));
  const out: Deposit[] = [];
  for (const r of [CRA_REMITTANCE, RQ_REMITTANCE]) {
    const type = r === CRA_REMITTANCE ? types.cra : types.rq;
    const groups = new Map<string, { p: ReturnType<typeof period>; runs: RunTaxes[] }>();
    for (const run of sorted) {
      const p = period(run.payDate, type, r.calendar);
      const g = groups.get(p.key) ?? groups.set(p.key, { p, runs: [] }).get(p.key)!;
      g.runs.push(run);
    }
    for (const { p, runs: rs } of groups.values()) push(out, r, `${r.kind}:${p.key}`, p.label, p.due, p.rule, rs);
  }
  if (sorted.length) {
    const year = Number(sorted[0]!.payDate.slice(0, 4));
    push(out, RQ_ANNUAL, `${RQ_ANNUAL.kind}:${year}-Y`, String(year), onOrNextBusinessDay(addDays(`${year + 1}-03-01`, -1), "quebec"),
      "Yearly: with the RL-1 summary, by the last day of February", sorted);
  }
  return out;
}

function push(out: Deposit[], r: Remittance, key: string, period: string, dueDate: string, rule: string, runs: RunTaxes[]) {
  const byTax: Record<string, bigint> = {};
  const payDates: string[] = [];
  const payRunIds: string[] = [];
  for (const run of runs) {
    let added = 0n;
    for (const c of r.codes) {
      const v = run.byTax[c] ?? 0n;
      if (!v) continue;
      byTax[c] = (byTax[c] ?? 0n) + v;
      added += v;
    }
    if (added) {
      if (!payDates.includes(run.payDate)) payDates.push(run.payDate);
      payRunIds.push(run.payRunId);
    }
  }
  const amountMinor = Object.values(byTax).reduce((s, v) => s + v, 0n);
  if (amountMinor > 0n) out.push({ key, kind: r.kind, period, dueDate, amountMinor, byTax, payDates, payRunIds, rule });
}
