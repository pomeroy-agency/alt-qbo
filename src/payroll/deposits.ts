import { D, toMinor } from "../core/money.js";
import { resolveRules, type Place, type StateRulePack } from "../rules/index.js";
import {
  addDays, businessDaysAfter, endOfNextMonth, fifteenthOfNextMonth, onOrNextBusinessDay, onOrPreviousBusinessDay, quarterEnd, quarterOf, weekday,
} from "./business-days.js";

// When each payroll tax is due. Liabilities arise on the pay date (cash
// basis), and the rules come from the rule packs: Pub 15 for Form 941 and
// 940 taxes, the EDD's deposit table for PIT and SDI, and the DE 9 dates for
// UI and ETT. TrailBook works out what's due and when; the business pays the
// IRS (EFTPS) and the EDD (e-Services) itself.

/** "federal_941", "federal_940", or a state pack's deposit kind ("ca_pit_sdi", "tx_ui"...). */
export type DepositKind = string;
export type FederalSchedule = "monthly" | "semiweekly";

const FEDERAL: Record<string, { agency: string; what: string; where: string; codes: string[]; accounts: Record<string, string> }> = {
  federal_941: {
    agency: "IRS", what: "Federal income tax, Social Security and Medicare (Form 941)", where: "EFTPS or IRS Direct Pay",
    codes: ["FIT", "SS_EE", "SS_ER", "MEDICARE_EE", "MEDICARE_ER", "ADDL_MEDICARE_EE"],
    accounts: { FIT: "fit_payable", SS_EE: "fica_payable", SS_ER: "fica_payable", MEDICARE_EE: "fica_payable", MEDICARE_ER: "fica_payable", ADDL_MEDICARE_EE: "fica_payable" },
  },
  federal_940: { agency: "IRS", what: "Federal unemployment tax (Form 940)", where: "EFTPS or IRS Direct Pay", codes: ["FUTA"], accounts: { FUTA: "futa_payable" } },
};

/** Who a deposit is paid to and what it covers. */
export function depositLabel(kind: DepositKind, state: StateRulePack): { agency: string; what: string; where: string } {
  const f = FEDERAL[kind];
  if (f) return { agency: f.agency, what: f.what, where: f.where };
  const r = state.payroll.deposits.find((d) => d.kind === kind);
  if (!r) throw new Error(`unknown deposit kind ${kind}`);
  return { agency: r.agency, what: r.what, where: r.where };
}

/** The liability account each tax code in a deposit pays down. */
export function depositAccounts(kind: DepositKind, state: StateRulePack): Record<string, string> {
  const f = FEDERAL[kind];
  if (f) return f.accounts;
  const r = state.payroll.deposits.find((d) => d.kind === kind);
  if (!r) throw new Error(`unknown deposit kind ${kind}`);
  const accounts: Record<string, string> = {};
  for (const code of r.codes) {
    const account = state.payroll.incomeTaxAgency?.code === code ? state.payroll.incomeTaxAgency.account
      : [...(state.payroll.localIncomeTaxes ?? []), ...state.payroll.taxes].find((t) => t.code === code)?.account;
    if (account) accounts[code] = account;
  }
  return accounts;
}

/** One posted pay run's taxes, as the schedule needs them. */
export interface RunTaxes {
  payRunId: string;
  payDate: string;
  byTax: Record<string, bigint>;
}

export interface Deposit {
  /** Stable for the same liabilities, so a payment can point at it. */
  key: string;
  kind: DepositKind;
  /** Plain words for the period covered, like "October 2026" or "Q3 2026". */
  period: string;
  dueDate: string;
  amountMinor: bigint;
  byTax: Record<string, bigint>;
  payDates: string[];
  payRunIds: string[];
  /** Why it's due when it is. */
  rule: string;
  note?: string;
  /** Set when the quarter's Form 941 taxes are under $2,500: once the quarter is over, paying with the return by this date is on time. */
  payWithReturnBy?: { quarterEnd: string; dueDate: string };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthName = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
const qLabel = (date: string) => `Q${quarterOf(date)} ${date.slice(0, 4)}`;
const qKey = (date: string) => `${date.slice(0, 4)}-Q${quarterOf(date)}`;

class Bucket {
  byTax: Record<string, bigint> = {};
  payDates: string[] = [];
  payRunIds: string[] = [];
  add(run: RunTaxes, codes: string[]) {
    let added = 0n;
    for (const c of codes) {
      const v = run.byTax[c] ?? 0n;
      if (!v) continue;
      this.byTax[c] = (this.byTax[c] ?? 0n) + v;
      added += v;
    }
    if (added) {
      if (!this.payDates.includes(run.payDate)) this.payDates.push(run.payDate);
      this.payRunIds.push(run.payRunId);
    }
    return added;
  }
  get total() {
    return Object.values(this.byTax).reduce((s, v) => s + v, 0n);
  }
  take(kind: DepositKind, key: string, period: string, dueDate: string, rule: string): Deposit | null {
    const amountMinor = this.total;
    const d = amountMinor > 0n ? { key, kind, period, dueDate, amountMinor, byTax: this.byTax, payDates: this.payDates, payRunIds: this.payRunIds, rule } : null;
    this.byTax = {};
    this.payDates = [];
    this.payRunIds = [];
    return d;
  }
}

/** The Saturday-Tuesday or Wednesday-Friday semiweekly period a pay date falls in, by its last day. */
function semiweeklyPeriodEnd(payDate: string): string {
  const w = weekday(payDate);
  // Wed (3), Thu (4), Fri (5) end on Friday; Sat (6), Sun (0), Mon (1), Tue (2) end on Tuesday.
  if (w >= 3 && w <= 5) return addDays(payDate, 5 - w);
  return addDays(payDate, (2 - w + 7) % 7);
}

const minor = (v: string) => toMinor(new D(v).toFixed(2));

export interface StateDepositOptions {
  /**
   * Average state income tax withheld per quarter over the four quarters
   * before the year, for states whose timing depends on it (Arizona).
   */
  priorQuarterlyAverageMinor?: bigint;
  /** Last calendar year's totals by tax code, for rules that look back at their own taxes (monthly_or_larger). */
  priorYearMinorByCode?: Record<string, bigint>;
}

/**
 * Every deposit for one calendar year's posted runs. `federalSchedule` is the
 * business's schedule for the year from its lookback period (new employers
 * are monthly); `place` picks the state's deposit rules.
 */
export function depositSchedule(runs: RunTaxes[], federalSchedule: FederalSchedule, place: Place, opts: StateDepositOptions = {}): Deposit[] {
  const sorted = [...runs].sort((a, b) => a.payDate.localeCompare(b.payDate));
  const out: Deposit[] = [];
  const push = (d: Deposit | null) => { if (d) out.push(d); };
  let schedule = federalSchedule;

  // Form 941 taxes.
  {
    const bucket = new Bucket();
    let periodKey = "";
    let periodEnd = "";
    let periodLabel = "";
    let periodSchedule: FederalSchedule = schedule;
    const close = () => {
      if (!periodKey) return;
      if (periodSchedule === "monthly") {
        push(bucket.take("federal_941", `federal_941:m:${periodKey}`, periodLabel, onOrNextBusinessDay(fifteenthOfNextMonth(periodEnd), "federal"),
          "Monthly depositor: by the 15th of the next month"));
      } else {
        push(bucket.take("federal_941", `federal_941:sw:${periodKey}`, periodLabel, businessDaysAfter(periodEnd, 3, "federal"),
          "Semiweekly depositor: Wednesday-Friday paydays by the next Wednesday, Saturday-Tuesday by the next Friday"));
      }
      periodKey = "";
    };
    for (const run of sorted) {
      const rules = resolveRules(place, run.payDate).federal.payroll.deposits;
      const key = schedule === "monthly" ? run.payDate.slice(0, 7) : `${semiweeklyPeriodEnd(run.payDate)}:${qKey(run.payDate)}`;
      if (key !== periodKey || schedule !== periodSchedule) {
        close();
        periodKey = key;
        periodSchedule = schedule;
        periodEnd = schedule === "monthly" ? run.payDate : semiweeklyPeriodEnd(run.payDate);
        periodLabel = schedule === "monthly" ? monthName(run.payDate) : `Paydays through ${semiweeklyPeriodEnd(run.payDate)}`;
      }
      bucket.add(run, FEDERAL.federal_941!.codes);
      if (bucket.total >= minor(rules.nextDayAtOrAbove)) {
        push(bucket.take("federal_941", `federal_941:nd:${run.payDate}:${run.payRunId}`, `Payday ${run.payDate}`,
          businessDaysAfter(run.payDate, 1, "federal"), "$100,000 next-day rule: by the next business day"));
        // A monthly depositor who hits $100,000 is semiweekly from the next day on.
        if (schedule === "monthly") schedule = "semiweekly";
        periodKey = "";
      }
    }
    close();
    // A quarter under $2,500 may be paid with the return instead.
    const byQuarter = new Map<string, bigint>();
    for (const d of out) byQuarter.set(qKey(d.payDates[0]!), (byQuarter.get(qKey(d.payDates[0]!)) ?? 0n) + d.amountMinor);
    for (const d of out) {
      const q = qKey(d.payDates[0]!);
      const limit = minor(resolveRules(place, d.payDates[0]!).federal.payroll.deposits.payWithReturnUnder);
      if (byQuarter.get(q)! < limit && !d.key.includes(":nd:")) {
        const end = quarterEnd(Number(q.slice(0, 4)), Number(q.slice(-1)));
        const returnDue = onOrNextBusinessDay(endOfNextMonth(end), "federal");
        d.payWithReturnBy = { quarterEnd: end, dueDate: returnDue };
        d.note = `This quarter's Form 941 taxes are under $2,500 so far. If the whole quarter stays under, you may pay them with Form 941 (due ${returnDue}) instead of depositing.`;
      }
    }
  }

  // FUTA: deposit at a quarter's end once more than $500 is owed; less carries into the next quarter.
  if (sorted.length) {
    const bucket = new Bucket();
    const year = sorted[0]!.payDate.slice(0, 4);
    const lastQuarter = qKey(sorted.at(-1)!.payDate);
    for (const q of [1, 2, 3, 4].map((n) => `${year}-Q${n}`)) {
      if (q > lastQuarter) break;
      for (const run of sorted.filter((r) => qKey(r.payDate) === q)) bucket.add(run, FEDERAL.federal_940!.codes);
      const end = quarterEnd(Number(q.slice(0, 4)), Number(q.slice(-1)));
      const limit = minor(resolveRules(place, end).federal.payroll.deposits.futaDepositOver);
      if (bucket.total > limit || (q.endsWith("Q4") && bucket.total > 0n)) {
        push(bucket.take("federal_940", `federal_940:${q}`, `${q.slice(-2)} ${q.slice(0, 4)}`, onOrNextBusinessDay(endOfNextMonth(end), "federal"),
          q.endsWith("Q4") ? "Whatever FUTA is left for the year is due by January 31" : "FUTA over $500 is deposited by the end of the month after the quarter"));
      }
    }
  }

  // State taxes, by each of the state's deposit rules.
  if (sorted.length) {
    const state = resolveRules(place, sorted[0]!.payDate).state;
    for (const rule of state.payroll.deposits) {
      const cal = state.calendar;
      const bucket = new Bucket();
      const stateTaxes = (run: RunTaxes) => resolveRules(place, run.payDate).state;
      const quarterly = (run: RunTaxes, why: string) => {
        const end = quarterEnd(Number(run.payDate.slice(0, 4)), quarterOf(run.payDate));
        const day = rule.schedule === "quarterly" && rule.dueDay ? `${endOfNextMonth(end).slice(0, 8)}${String(rule.dueDay).padStart(2, "0")}` : endOfNextMonth(end);
        const due = rule.schedule === "quarterly" && rule.noWeekendExtension ? onOrPreviousBusinessDay(day, cal) : onOrNextBusinessDay(day, cal);
        push(bucket.take(rule.kind, `${rule.kind}:${rule.schedule === "ca_edd" ? "q:" : ""}${qKey(run.payDate)}`, qLabel(run.payDate), due, why));
      };
      if (rule.schedule === "quarterly") {
        for (let i = 0; i < sorted.length; i++) {
          const run = sorted[i]!;
          bucket.add(run, rule.codes);
          const next = sorted[i + 1];
          if (!next || qKey(next.payDate) !== qKey(run.payDate)) quarterly(run, `Paid quarterly, by the ${rule.report} due date`);
        }
      } else if (rule.schedule === "federal_timing_by_average") {
        // Over the average: the same dates as the federal 941 deposits; otherwise quarterly with the return.
        const followFederal = rule.federalTimingAverageOver === null || (opts.priorQuarterlyAverageMinor ?? 0n) > minor(rule.federalTimingAverageOver);
        const why = rule.federalTimingAverageOver === null
          ? "Due on the same dates as your federal deposits"
          : `More than $${rule.federalTimingAverageOver} a quarter withheld on average last year: due with your federal deposits`;
        for (let i = 0; i < sorted.length; i++) {
          const run = sorted[i]!;
          bucket.add(run, rule.codes);
          const next = sorted[i + 1];
          if (followFederal) {
            const fed = out.find((d) => d.kind === "federal_941" && d.payRunIds.includes(run.payRunId));
            const periodEnds = !next || out.find((d) => d.kind === "federal_941" && d.payRunIds.includes(next.payRunId))?.key !== fed?.key;
            if (fed && periodEnds) {
              push(bucket.take(rule.kind, `${rule.kind}:${fed.key.replace(/^federal_941:/, "")}`, fed.period, fed.dueDate, why));
            } else if (!fed && (!next || qKey(next.payDate) !== qKey(run.payDate))) {
              quarterly(run, `Paid with the quarter's ${rule.report}`);
            }
          } else if (!next || qKey(next.payDate) !== qKey(run.payDate)) {
            quarterly(run, `Quarterly: $${rule.federalTimingAverageOver} or less a quarter withheld on average last year, due with the ${rule.report}`);
          }
        }
      } else if (rule.schedule === "monthly_or_larger") {
        // Monthly by default; larger filers (by last year's withholding) on the federal dates or weekly.
        // Last year's withholding: of this rule's own taxes where known (Philadelphia's wage tax), else the state income tax.
        const priorYear = opts.priorYearMinorByCode ? rule.codes.reduce((sum, c) => sum + (opts.priorYearMinorByCode![c] ?? 0n), 0n)
          : (opts.priorQuarterlyAverageMinor ?? 0n) * 4n;
        const large = rule.lookbackOver !== null && priorYear > minor(rule.lookbackOver);
        const semimonthly = !large && rule.semimonthlyOver !== undefined && priorYear > minor(rule.semimonthlyOver);
        const dueMonthly = (date: string) => onOrNextBusinessDay(rule.dueDay === "last" ? endOfNextMonth(date)
          : `${endOfNextMonth(date).slice(0, 8)}${String(rule.dueDay).padStart(2, "0")}`, cal);
        const dueText = rule.dueDay === "last" ? "the end of the next month" : `the ${rule.dueDay}th of the next month`;
        for (let i = 0; i < sorted.length; i++) {
          const run = sorted[i]!;
          bucket.add(run, rule.codes);
          const next = sorted[i + 1];
          if (large && rule.largeFiler === "weekly") {
            const friday = addDays(run.payDate, (5 - weekday(run.payDate) + 7) % 7);
            if (!next || addDays(next.payDate, (5 - weekday(next.payDate) + 7) % 7) !== friday) {
              push(bucket.take(rule.kind, `${rule.kind}:w:${friday}`, `Week ending ${friday}`, businessDaysAfter(friday, 3, cal),
                `Weekly filer (more than $${rule.lookbackOver} withheld last year): by the third business day after the week's Friday`));
            }
          } else if (large) {
            const fed = out.find((d) => d.kind === "federal_941" && d.payRunIds.includes(run.payRunId));
            const periodEnds = !next || out.find((d) => d.kind === "federal_941" && d.payRunIds.includes(next.payRunId))?.key !== fed?.key;
            if (fed && periodEnds) {
              push(bucket.take(rule.kind, `${rule.kind}:${fed.key.replace(/^federal_941:/, "")}`, fed.period, fed.dueDate,
                `More than $${rule.lookbackOver} withheld last year: due with your federal deposits`));
            } else if (!fed && (!next || next.payDate.slice(0, 7) !== run.payDate.slice(0, 7))) {
              push(bucket.take(rule.kind, `${rule.kind}:m:${run.payDate.slice(0, 7)}`, monthName(run.payDate), dueMonthly(run.payDate), `Monthly: by ${dueText}`));
            }
          } else if (semimonthly) {
            // The 1st to the 15th and the 16th to the month's end, each due the third business day after it closes.
            const half = (d: string) => `${d.slice(0, 7)}${Number(d.slice(8)) <= 15 ? "a" : "b"}`;
            if (!next || half(next.payDate) !== half(run.payDate)) {
              const end = Number(run.payDate.slice(8)) <= 15 ? `${run.payDate.slice(0, 8)}15` : addDays(`${endOfNextMonth(run.payDate).slice(0, 8)}01`, -1);
              push(bucket.take(rule.kind, `${rule.kind}:s:${half(run.payDate)}`, `${monthName(run.payDate)}, ${end.slice(8) === "15" ? "1st to 15th" : "16th to end"}`,
                businessDaysAfter(end, 3, cal), `Semi-monthly filer (more than $${rule.semimonthlyOver} withheld last year): by the third business day after the half-month closes`));
            }
          } else if (!next || next.payDate.slice(0, 7) !== run.payDate.slice(0, 7)) {
            push(bucket.take(rule.kind, `${rule.kind}:m:${run.payDate.slice(0, 7)}`, monthName(run.payDate), dueMonthly(run.payDate),
              `Monthly: by ${dueText}, with or before the ${rule.report}`));
          }
        }
      } else if (rule.schedule === "accumulated_threshold") {
        // New York: once the withholding not yet paid reaches the threshold, it's due within a few business days.
        for (let i = 0; i < sorted.length; i++) {
          const run = sorted[i]!;
          bucket.add(run, rule.codes);
          const next = sorted[i + 1];
          if (bucket.total >= minor(rule.atOrAbove)) {
            push(bucket.take(rule.kind, `${rule.kind}:t:${run.payDate}:${run.payRunId}`, `Payday ${run.payDate}`, businessDaysAfter(run.payDate, rule.businessDays, cal),
              `$${rule.atOrAbove} or more withheld and not yet paid: due within ${rule.businessDays} business days of the payday`));
          } else if (!next || qKey(next.payDate) !== qKey(run.payDate)) {
            quarterly(run, `Under $${rule.atOrAbove} withheld since the last payment: due with the quarter's ${rule.report}`);
          }
        }
      } else {
        // California PIT and SDI.
        let pit = 0n;
        const incomeCode = state.payroll.incomeTaxAgency?.code ?? "";
        const fedTiming = federalSchedule === "semiweekly";
        for (let i = 0; i < sorted.length; i++) {
          const run = sorted[i]!;
          const r = stateTaxes(run).payroll.deposits.find((d) => d.kind === rule.kind);
          const rules = r?.schedule === "ca_edd" ? r : rule;
          bucket.add(run, rule.codes);
          pit += run.byTax[incomeCode] ?? 0n;
          const next = sorted[i + 1];
          if (fedTiming && pit > minor(rules.federalTimingOver)) {
            const end = semiweeklyPeriodEnd(run.payDate);
            // Paydays Wednesday-Friday are due the next Wednesday; Saturday-Tuesday the next Friday.
            const due = onOrNextBusinessDay(addDays(end, weekday(end) === 5 ? 5 : 3), cal);
            push(bucket.take(rule.kind, `${rule.kind}:sw:${run.payDate}:${run.payRunId}`, `Payday ${run.payDate}`, due,
              `Semiweekly: more than $${rules.federalTimingOver} of ${state.name} income tax withheld, on the federal semiweekly timing`));
            pit = 0n;
            continue;
          }
          const monthEnds = !next || next.payDate.slice(0, 7) !== run.payDate.slice(0, 7);
          if (monthEnds && pit >= minor(rules.monthlyAtOrAbove)) {
            push(bucket.take(rule.kind, `${rule.kind}:m:${run.payDate.slice(0, 7)}`, monthName(run.payDate), onOrNextBusinessDay(fifteenthOfNextMonth(run.payDate), cal),
              `Monthly: $${rules.monthlyAtOrAbove} or more of ${state.name} income tax withheld, due the 15th of the next month`));
            pit = 0n;
            continue;
          }
          if (!next || qKey(next.payDate) !== qKey(run.payDate)) {
            quarterly(run, `Quarterly: under $${rules.monthlyAtOrAbove} of ${state.name} income tax withheld, due with the quarter's DE 9`);
            pit = 0n;
          }
        }
      }
    }
  }

  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.kind.localeCompare(b.kind));
}
