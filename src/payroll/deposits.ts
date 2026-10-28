import { D, toMinor } from "../core/money.js";
import { resolveRules } from "../rules/index.js";
import {
  addDays, businessDaysAfter, endOfNextMonth, fifteenthOfNextMonth, onOrNextBusinessDay, quarterEnd, quarterOf, weekday,
} from "./business-days.js";
import type { TaxLine } from "./gross-to-net.js";

// When each payroll tax is due. Liabilities arise on the pay date (cash
// basis), and the rules come from the rule packs: Pub 15 for Form 941 and
// 940 taxes, the EDD's deposit table for PIT and SDI, and the DE 9 dates for
// UI and ETT. TrailBook works out what's due and when; the business pays the
// IRS (EFTPS) and the EDD (e-Services) itself.

export type DepositKind = "federal_941" | "federal_940" | "ca_pit_sdi" | "ca_ui_ett";
export type FederalSchedule = "monthly" | "semiweekly";

export const DEPOSIT_LABEL: Record<DepositKind, { agency: "IRS" | "EDD"; what: string; where: string }> = {
  federal_941: { agency: "IRS", what: "Federal income tax, Social Security and Medicare (Form 941)", where: "EFTPS or IRS Direct Pay" },
  federal_940: { agency: "IRS", what: "Federal unemployment tax (Form 940)", where: "EFTPS or IRS Direct Pay" },
  ca_pit_sdi: { agency: "EDD", what: "California income tax and SDI withheld", where: "EDD e-Services for Business" },
  ca_ui_ett: { agency: "EDD", what: "California UI and ETT", where: "EDD e-Services for Business" },
};

const CODES: Record<DepositKind, TaxLine["code"][]> = {
  federal_941: ["FIT", "SS_EE", "SS_ER", "MEDICARE_EE", "MEDICARE_ER", "ADDL_MEDICARE_EE"],
  federal_940: ["FUTA"],
  ca_pit_sdi: ["CA_PIT", "CA_SDI"],
  ca_ui_ett: ["CA_UI", "CA_ETT"],
};

/** The liability accounts each deposit pays down. */
export const DEPOSIT_ACCOUNTS: Record<DepositKind, Partial<Record<TaxLine["code"], string>>> = {
  federal_941: { FIT: "fit_payable", SS_EE: "fica_payable", SS_ER: "fica_payable", MEDICARE_EE: "fica_payable", MEDICARE_ER: "fica_payable", ADDL_MEDICARE_EE: "fica_payable" },
  federal_940: { FUTA: "futa_payable" },
  ca_pit_sdi: { CA_PIT: "ca_pit_payable", CA_SDI: "ca_sdi_payable" },
  ca_ui_ett: { CA_UI: "ca_ui_payable", CA_ETT: "ca_ett_payable" },
};

/** One posted pay run's taxes, as the schedule needs them. */
export interface RunTaxes {
  payRunId: string;
  payDate: string;
  byTax: Partial<Record<TaxLine["code"], bigint>>;
}

export interface Deposit {
  /** Stable for the same liabilities, so a payment can point at it. */
  key: string;
  kind: DepositKind;
  /** Plain words for the period covered, like "October 2026" or "Q3 2026". */
  period: string;
  dueDate: string;
  amountMinor: bigint;
  byTax: Partial<Record<TaxLine["code"], bigint>>;
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
  byTax: Partial<Record<TaxLine["code"], bigint>> = {};
  payDates: string[] = [];
  payRunIds: string[] = [];
  add(run: RunTaxes, codes: TaxLine["code"][]) {
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
    return Object.values(this.byTax).reduce((s, v) => s + (v ?? 0n), 0n);
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

/**
 * Every deposit for one calendar year's posted runs. `federalSchedule` is the
 * business's schedule for the year from its lookback period (new employers
 * are monthly).
 */
export function depositSchedule(runs: RunTaxes[], federalSchedule: FederalSchedule): Deposit[] {
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
      const rules = resolveRules({ country: "US", region: "CA" }, run.payDate).federal.payroll.deposits;
      const key = schedule === "monthly" ? run.payDate.slice(0, 7) : `${semiweeklyPeriodEnd(run.payDate)}:${qKey(run.payDate)}`;
      if (key !== periodKey || schedule !== periodSchedule) {
        close();
        periodKey = key;
        periodSchedule = schedule;
        periodEnd = schedule === "monthly" ? run.payDate : semiweeklyPeriodEnd(run.payDate);
        periodLabel = schedule === "monthly" ? monthName(run.payDate) : `Paydays through ${semiweeklyPeriodEnd(run.payDate)}`;
      }
      bucket.add(run, CODES.federal_941);
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
      const limit = minor(resolveRules({ country: "US", region: "CA" }, d.payDates[0]!).federal.payroll.deposits.payWithReturnUnder);
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
      for (const run of sorted.filter((r) => qKey(r.payDate) === q)) bucket.add(run, CODES.federal_940);
      const end = quarterEnd(Number(q.slice(0, 4)), Number(q.slice(-1)));
      const limit = minor(resolveRules({ country: "US", region: "CA" }, end).federal.payroll.deposits.futaDepositOver);
      if (bucket.total > limit || (q.endsWith("Q4") && bucket.total > 0n)) {
        push(bucket.take("federal_940", `federal_940:${q}`, `${q.slice(-2)} ${q.slice(0, 4)}`, onOrNextBusinessDay(endOfNextMonth(end), "federal"),
          q.endsWith("Q4") ? "Whatever FUTA is left for the year is due by January 31" : "FUTA over $500 is deposited by the end of the month after the quarter"));
      }
    }
  }

  // California PIT and SDI.
  {
    const bucket = new Bucket();
    let pit = 0n;
    const fedTiming = federalSchedule === "semiweekly";
    for (let i = 0; i < sorted.length; i++) {
      const run = sorted[i]!;
      const rules = resolveRules({ country: "US", region: "CA" }, run.payDate).state.payroll.deposits;
      bucket.add(run, CODES.ca_pit_sdi);
      pit += run.byTax.CA_PIT ?? 0n;
      const next = sorted[i + 1];
      if (fedTiming && pit > minor(rules.federalTimingOver)) {
        const end = semiweeklyPeriodEnd(run.payDate);
        // Paydays Wednesday-Friday are due the next Wednesday; Saturday-Tuesday the next Friday.
        const due = onOrNextBusinessDay(addDays(end, weekday(end) === 5 ? 5 : 3), "california");
        push(bucket.take("ca_pit_sdi", `ca_pit_sdi:sw:${run.payDate}:${run.payRunId}`, `Payday ${run.payDate}`, due,
          `Semiweekly: more than $${rules.federalTimingOver} of California income tax withheld, on the federal semiweekly timing`));
        pit = 0n;
        continue;
      }
      const monthEnds = !next || next.payDate.slice(0, 7) !== run.payDate.slice(0, 7);
      if (monthEnds && pit >= minor(rules.monthlyAtOrAbove)) {
        push(bucket.take("ca_pit_sdi", `ca_pit_sdi:m:${run.payDate.slice(0, 7)}`, monthName(run.payDate), onOrNextBusinessDay(fifteenthOfNextMonth(run.payDate), "california"),
          `Monthly: $${rules.monthlyAtOrAbove} or more of California income tax withheld, due the 15th of the next month`));
        pit = 0n;
        continue;
      }
      const quarterEnds = !next || qKey(next.payDate) !== qKey(run.payDate);
      if (quarterEnds) {
        const end = quarterEnd(Number(run.payDate.slice(0, 4)), quarterOf(run.payDate));
        push(bucket.take("ca_pit_sdi", `ca_pit_sdi:q:${qKey(run.payDate)}`, qLabel(run.payDate), onOrNextBusinessDay(endOfNextMonth(end), "california"),
          `Quarterly: under $${rules.monthlyAtOrAbove} of California income tax withheld, due with the quarter's DE 9`));
        pit = 0n;
      }
    }
  }

  // California UI and ETT: quarterly, with the DE 9.
  {
    const bucket = new Bucket();
    for (let i = 0; i < sorted.length; i++) {
      const run = sorted[i]!;
      bucket.add(run, CODES.ca_ui_ett);
      const next = sorted[i + 1];
      if (!next || qKey(next.payDate) !== qKey(run.payDate)) {
        const end = quarterEnd(Number(run.payDate.slice(0, 4)), quarterOf(run.payDate));
        push(bucket.take("ca_ui_ett", `ca_ui_ett:${qKey(run.payDate)}`, qLabel(run.payDate), onOrNextBusinessDay(endOfNextMonth(end), "california"),
          "UI and ETT are paid quarterly, by the DE 9 due date"));
      }
    }
  }

  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.kind.localeCompare(b.kind));
}
