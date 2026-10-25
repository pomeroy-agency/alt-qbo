import { describe, expect, it } from "vitest";
import { businessDaysAfter, californiaHolidays, federalHolidays, onOrNextBusinessDay, pacificToday } from "../src/payroll/business-days.js";
import { depositSchedule, type RunTaxes } from "../src/payroll/deposits.js";

let n = 0;
const run = (payDate: string, byTax: Record<string, number>): RunTaxes => ({
  payRunId: `run-${++n}`, payDate,
  byTax: Object.fromEntries(Object.entries(byTax).map(([k, v]) => [k, BigInt(Math.round(v * 100))])),
});
const of = (deposits: ReturnType<typeof depositSchedule>, kind: string) => deposits.filter((d) => d.kind === kind);

describe("business days", () => {
  it("knows the 2026 District of Columbia legal holidays listed in Pub 15", () => {
    expect([...federalHolidays(2026)].sort()).toEqual([
      "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-16", "2026-05-25", "2026-06-19",
      "2026-07-03", "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25",
    ]);
    // California dates only move for holidays it shares with the federal calendar.
    expect(californiaHolidays(2026).has("2026-04-16")).toBe(false);
    expect(californiaHolidays(2026).has("2026-10-12")).toBe(false);
    expect(californiaHolidays(2026).has("2026-11-26")).toBe(true);
    expect(onOrNextBusinessDay("2026-11-15", "federal")).toBe("2026-11-16");
    expect(businessDaysAfter("2026-09-04", 3, "federal")).toBe("2026-09-10");
    expect(pacificToday(new Date("2026-10-26T05:00:00Z"))).toBe("2026-10-25");
  });
});

describe("Form 941 deposits", () => {
  it("monthly depositors pay by the 15th of the next month, moved past weekends", () => {
    const d = of(depositSchedule([run("2026-10-02", { FIT: 300, SS_EE: 100, SS_ER: 100 }), run("2026-10-16", { FIT: 300 })], "monthly"), "federal_941");
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ key: "federal_941:m:2026-10", period: "October 2026", dueDate: "2026-11-16", amountMinor: 80000n });
  });

  it("semiweekly depositors pay Wednesday-Friday paydays by the next Wednesday, with a day added for a holiday", () => {
    const d = of(depositSchedule([run("2026-05-29", { FIT: 30000 }), run("2026-09-04", { FIT: 30000 }), run("2026-06-02", { FIT: 30000 })], "semiweekly"), "federal_941");
    expect(d.map((x) => [x.payDates, x.dueDate])).toEqual([
      [["2026-05-29"], "2026-06-03"], // Pub 15's Green, Inc. example
      [["2026-06-02"], "2026-06-05"], // Tuesday payday: the next Friday
      [["2026-09-04"], "2026-09-10"], // Labor Day gives an extra day
    ]);
  });

  it("splits a semiweekly period that spans two quarters, as in Pub 15", () => {
    const d = of(depositSchedule([run("2026-09-30", { FIT: 30000 }), run("2026-10-02", { FIT: 30000 })], "semiweekly"), "federal_941");
    expect(d).toHaveLength(2);
    expect(d.map((x) => x.dueDate)).toEqual(["2026-10-07", "2026-10-07"]);
  });

  it("applies the $100,000 next-day rule, after which a monthly depositor is semiweekly", () => {
    const d = of(depositSchedule([run("2026-03-06", { FIT: 60000, SS_EE: 25000, SS_ER: 25000 }), run("2026-03-20", { FIT: 1000 })], "monthly"), "federal_941");
    expect(d[0]).toMatchObject({ dueDate: "2026-03-09", amountMinor: 11_000_000n });
    expect(d[0]!.rule).toMatch(/next-day/);
    expect(d[1]).toMatchObject({ dueDate: "2026-03-25", amountMinor: 100_000n });
  });

  it("notes when a quarter is small enough to pay with Form 941", () => {
    const [d] = of(depositSchedule([run("2026-01-16", { FIT: 400 })], "monthly"), "federal_941");
    expect(d!.note).toMatch(/Form 941 \(due 2026-04-30\)/);
  });
});

describe("FUTA, PIT/SDI and UI/ETT deposits", () => {
  it("carries FUTA of $500 or less into the next quarter", () => {
    const d = of(depositSchedule([run("2026-02-13", { FUTA: 300 }), run("2026-05-15", { FUTA: 300 })], "monthly"), "federal_940");
    expect(d).toEqual([expect.objectContaining({ key: "federal_940:2026-Q2", amountMinor: 60000n, dueDate: "2026-07-31" })]);
  });

  it("deposits California PIT and SDI quarterly, monthly or on the federal timing by how much PIT has built up", () => {
    const quarterly = of(depositSchedule([run("2026-07-17", { CA_PIT: 200, CA_SDI: 50 })], "monthly"), "ca_pit_sdi");
    expect(quarterly).toEqual([expect.objectContaining({ key: "ca_pit_sdi:q:2026-Q3", dueDate: "2026-11-02", amountMinor: 25000n })]);
    const monthly = of(depositSchedule([run("2026-02-13", { CA_PIT: 200 }), run("2026-02-27", { CA_PIT: 200, CA_SDI: 80 })], "monthly"), "ca_pit_sdi");
    expect(monthly).toEqual([expect.objectContaining({ key: "ca_pit_sdi:m:2026-02", dueDate: "2026-03-16", amountMinor: 48000n })]);
    const semiweekly = of(depositSchedule([run("2026-02-13", { CA_PIT: 450 })], "semiweekly"), "ca_pit_sdi");
    expect(semiweekly[0]).toMatchObject({ dueDate: "2026-02-18" });
    // $350-$400 for a semiweekly federal depositor is monthly.
    const between = of(depositSchedule([run("2026-02-13", { CA_PIT: 380 })], "semiweekly"), "ca_pit_sdi");
    expect(between[0]).toMatchObject({ key: "ca_pit_sdi:m:2026-02", dueDate: "2026-03-16" });
  });

  it("deposits UI and ETT with each quarter's DE 9, on the EDD's 2026 dates", () => {
    const d = of(depositSchedule([run("2026-08-14", { CA_UI: 100, CA_ETT: 3 }), run("2026-11-13", { CA_UI: 20 })], "monthly"), "ca_ui_ett");
    expect(d.map((x) => [x.period, x.dueDate])).toEqual([["Q3 2026", "2026-11-02"], ["Q4 2026", "2027-02-01"]]);
  });
});
