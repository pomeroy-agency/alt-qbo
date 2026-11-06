import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withSystem, withTenant } from "../src/db/pool.js";
import { createEntity, createOrganization } from "../src/core/tenancy.js";
import { resolveRules } from "../src/rules/index.js";
import { EMPLOYMENT_STANDARDS_2026 as ES } from "../src/rules/canada/employment-standards-2026.js";
import { holidayPayFor, holidaysInPeriod, usualDailyHours, vacationRateFor, yearsOfService } from "../src/payroll/employment-standards.js";
import { calculatePaycheck, type EmployeePayInput } from "../src/payroll/gross-to-net.js";
import { createEmployee, listEmployees, setStateTaxRate, updateEmployee } from "../src/payroll/employees.js";
import { carryVacationPay, payRunInputFromEmployees } from "../src/payroll/runs.js";
import { approveAndPostPayRun, calculatePayRun } from "../src/payroll/pay-run.js";
import { formRoe } from "../src/payroll/canada-forms.js";
import { approver, bookkeeper, owner, pool } from "./helpers.js";

const dates = (region: keyof typeof ES, year = 2026) => ES[region].holidays(year).map((h) => h.date);

describe("statutory holidays", () => {
  it("lists each region's holidays for 2026", () => {
    expect(dates("ON")).toEqual(["2026-01-01", "2026-02-16", "2026-04-03", "2026-05-18", "2026-07-01", "2026-09-07", "2026-10-12", "2026-12-25", "2026-12-26"]);
    expect(dates("QC")).toContain("2026-06-24");
    expect(ES.QC.holidays(2026).find((h) => h.date === "2026-05-18")?.name).toBe("National Patriots' Day");
    expect(dates("NL")).toHaveLength(6);
    expect(dates("MB")).toContain("2026-09-30");
    expect(dates("MB")).not.toContain("2026-11-11");
    expect(dates("BC")).toContain("2026-08-03");
    expect(ES.YT.holidays(2026).find((h) => h.name === "Discovery Day")?.date).toBe("2026-08-17");
    expect(dates("NB")).not.toContain("2026-05-18");
    expect(holidaysInPeriod(ES.ON, "2026-12-20", "2027-01-02").map((h) => h.date)).toEqual(["2026-12-25", "2026-12-26", "2027-01-01"]);
    for (const std of Object.values(ES)) {
      expect(std.holidays(2027).length).toBeGreaterThanOrEqual(6);
      expect(std.sources.length).toBeGreaterThan(0);
    }
  });

  it("works out holiday pay by each region's formula", () => {
    const person = { hireDate: "2025-01-06", hourlyRate: "25", dailyHours: "8" };
    const fourWeeks = [{ periodStart: "2026-08-10", periodEnd: "2026-09-06", earnings: [
      { code: "REGULAR", hours: "160", amountMinor: 400000n }, { code: "OVERTIME", hours: "4", amountMinor: 15000n }, { code: "VACATION", amountMinor: 16000n },
    ] }];
    const labour = { date: "2026-09-07", name: "Labour Day" };
    // Ontario: regular wages and vacation pay over 20, no overtime.
    expect(holidayPayFor(ES.ON, labour, person, fourWeeks)?.amount).toBe("208.00");
    // Quebec: 1/20 without overtime or vacation pay.
    expect(holidayPayFor(ES.QC, labour, person, fourWeeks)?.amount).toBe("200.00");
    // Alberta: wages over days worked (164 hours over 8 is 20.5 days).
    expect(holidayPayFor(ES.AB, labour, person, fourWeeks)?.amount).toBe(String((4160 / 20.5).toFixed(2)));
    // A regular day in the territories.
    expect(holidayPayFor(ES.NT, labour, person, [])).toMatchObject({ amount: "200.00" });
    // New Brunswick: 90 days' employment first.
    expect(holidayPayFor(ES.NB, labour, { ...person, hireDate: "2026-07-01" }, fourWeeks)).toBeNull();
    // Half the window in TrailBook: a warning to check it.
    const half = [{ ...fourWeeks[0]!, periodStart: "2026-08-24", earnings: [{ code: "REGULAR", hours: "80", amountMinor: 200000n }] }];
    const short = holidayPayFor(ES.ON, labour, person, half)!;
    expect(short.amount).toBe("100.00");
    expect(short.warning).toMatch(/14 of the 28 days/);
    // No pay before the holiday at all: a regular day, flagged.
    expect(holidayPayFor(ES.MB, labour, person, [])).toMatchObject({ amount: "200.00", warning: expect.stringMatching(/regular day/) });
    expect(usualDailyHours("75", "biweekly")).toBe("7.5");
    expect(usualDailyHours(null, "weekly")).toBe("8");
  });
});

describe("vacation pay", () => {
  it("steps up with years of service, and takes an employer's higher rate", () => {
    expect(yearsOfService("2021-09-01", "2026-08-31")).toBe(4);
    expect(yearsOfService("2021-09-01", "2026-09-01")).toBe(5);
    expect(vacationRateFor(ES.ON, "2021-09-01", "2026-08-31").rate).toBe("0.04");
    expect(vacationRateFor(ES.ON, "2021-09-01", "2026-09-01")).toMatchObject({ rate: "0.06", label: "6%" });
    expect(vacationRateFor(ES.MB, "2016-01-01", "2026-06-01").rate).toBe("0.08");
    expect(vacationRateFor(ES.QC, "2023-01-01", "2026-06-01").rate).toBe("0.06");
    expect(vacationRateFor(ES.SK, "2024-01-01", "2026-06-01")).toMatchObject({ label: "3/52" });
    expect(Number(vacationRateFor(ES.SK, "2024-01-01", "2026-06-01").rate)).toBeCloseTo(3 / 52, 12);
    expect(vacationRateFor(ES.ON, "2026-01-01", "2026-06-01", "0.08")).toMatchObject({ rate: "0.08", lawRate: "0.04" });
    expect(vacationRateFor(ES.ON, "2020-01-01", "2026-06-01", "0.05").rate).toBe("0.06");
  });

  it("pays it each paycheck or accrues it, and won't pay out more than is owed", () => {
    const rules = resolveRules({ country: "CA", region: "ON" }, "2026-08-21");
    const base: EmployeePayInput = { employeeId: "e1", name: "Sam", payFrequency: "biweekly", hourlyRate: "25", regularHours: "80", overtimeHours: "2", w4: { filingStatus: "single" } as any };
    const each = calculatePaycheck({ ...base, vacation: { method: "each_pay", rate: "0.04", label: "4%" } }, rules, { stateRates: { ON_WSIB: "0.012" } }, "2026-08-14");
    // 2,000 regular and 75 overtime: Ontario counts overtime, so 4% of 2,075.
    expect(each.earnings.find((e) => e.code === "VACATION")?.amountMinor).toBe(8300n);
    expect(each.grossMinor).toBe(215800n);
    const accrue = calculatePaycheck({ ...base, vacation: { method: "accrue", rate: "0.04", balance: "100", payout: "50" } }, rules, {}, "2026-08-14");
    expect(accrue.vacation).toMatchObject({ accruedMinor: 8300n, paidMinor: 5000n, balanceMinor: 13300n });
    expect(accrue.grossMinor).toBe(212500n);
    const tooMuch = calculatePaycheck({ ...base, vacation: { method: "accrue", rate: "0.04", balance: "100", payout: "500" } }, rules, {}, "2026-08-14");
    expect(tooMuch.blockers.join()).toMatch(/only 183.00 is owed/);
    const last = calculatePaycheck({ ...base, vacation: { method: "accrue", rate: "0.04", balance: "100", payOutAll: true } }, rules, {}, "2026-08-14");
    expect(last.vacation).toMatchObject({ paidMinor: 18300n, balanceMinor: 0n });
    // Alberta leaves overtime out.
    const ab = calculatePaycheck({ ...base, vacation: { method: "each_pay", rate: "0.04", excludesOvertime: true } }, resolveRules({ country: "CA", region: "AB" }, "2026-08-21"), {}, "2026-08-14");
    expect(ab.earnings.find((e) => e.code === "VACATION")?.amountMinor).toBe(8000n);
  });
});

const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

describe("a British Columbia business's pay runs", () => {
  it("pays BC Day from the pay before it, accrues vacation pay and carries the balance", async () => {
    const org = await withSystem(pool, (tx) => createOrganization(tx, { name: "Cedar BC", actor: owner }));
    const entity = await withTenant(pool, org.id, (tx) =>
      createEntity(tx, { orgId: org.id, legalName: "Cedar Ltd", entityType: "ca_corporation", place: { country: "CA", region: "BC" }, firstFiscalYear: 2026, actor: owner }),
    );
    await withTenant(pool, org.id, (tx) => setStateTaxRate(tx, { orgId: org.id, entityId: entity.id, code: "BC_WCB", rate: "0.0155", actor: owner }));
    const e = await withTenant(pool, org.id, (tx) =>
      createEmployee(tx, {
        orgId: org.id, entityId: entity.id, actor: owner, name: "Jo Park", hireDate: "2026-06-01",
        payType: "hourly", payFrequency: "biweekly", payRate: "25", usualHours: "80", sin: "130 692 544", vacationBalance: "40",
      }),
    );
    expect(e).toMatchObject({ vacationMethod: "accrue", vacationBalance: "40.00", vacationPercent: null });

    const post = async (periodStart: string, periodEnd: string, payDate: string, line: Record<string, unknown>) => {
      const input = await withTenant(pool, org.id, (tx) => payRunInputFromEmployees(tx, entity.id, { periodStart, periodEnd, payDate, lines: [{ employeeId: e.id, ...line }] }, randomUUID()));
      const run = calculatePayRun({ ...input, live: false });
      expect(run.blockers).toEqual([]);
      await withTenant(pool, org.id, async (tx) => {
        const posted = await approveAndPostPayRun(tx, { orgId: org.id, entityId: entity.id, run, preparedBy: bookkeeper, approvedBy: approver });
        await tx.query(
          `INSERT INTO pay_runs (id, org_id, entity_id, input, result, prepared_by, pay_date, status, approved_by, entry_id) VALUES ($1, $2, $3, $4, $5, $6, $7, 'posted', $8, $9)`,
          [input.payRunId, org.id, entity.id, toJson(input), toJson(run), bookkeeper.id, payDate, approver.id, posted.id],
        );
        await carryVacationPay(tx, entity.id, run.paychecks);
      });
      return run.paychecks[0]!;
    };

    // Two weeks in July: no holiday, 4% of 2,000 saved up.
    const july = await post("2026-07-04", "2026-07-17", "2026-07-24", { regularHours: "80" });
    expect(july.earnings.map((x) => x.code)).toEqual(["REGULAR"]);
    expect(july.vacation).toMatchObject({ accruedMinor: 8000n, balanceMinor: 12000n });
    await post("2026-07-18", "2026-07-31", "2026-08-07", { regularHours: "80" });

    // BC Day, August 3: an average day's pay from the 30 days before, plus 1.5 times for 4 hours worked.
    const aug = await post("2026-08-01", "2026-08-14", "2026-08-21", { regularHours: "72", holidayHoursWorked: "4", vacationPay: "100" });
    const holiday = aug.earnings.find((x) => x.code === "HOLIDAY")!;
    expect(holiday.note).toMatch(/^British Columbia Day 2026-08-03/);
    // July 4-31 (2,000 x 2, 160 hours) and August 1-2 (2/14 of 1,800 and of 72 hours) over 8-hour days.
    const wages = 4000 + 1800 * 2 / 14, days = Math.round(((160 + 72 * 2 / 14) / 8) * 100) / 100;
    expect(Number(holiday.amountMinor)).toBe(Math.round((wages / days) * 100));
    expect(aug.earnings.find((x) => x.code === "HOLIDAY_WORKED")).toMatchObject({ hours: "4", rate: "37.5", amountMinor: 15000n });
    expect(aug.earnings.find((x) => x.code === "VACATION")?.amountMinor).toBe(10000n);
    const vacationable = 180000n + holiday.amountMinor + 15000n;
    expect(aug.vacation!.accruedMinor).toBe(BigInt(Math.round(Number(vacationable) * 0.04)));
    const owed = 4000n + 8000n + 8000n + aug.vacation!.accruedMinor - 10000n;
    expect(aug.vacation!.balanceMinor).toBe(owed);
    expect((await withTenant(pool, org.id, (tx) => listEmployees(tx, entity.id)))[0]!.vacationBalance).toBe((Number(owed) / 100).toFixed(2));

    // Salaried employees keep their salary; there are no holiday or vacation lines to enter.
    await expect(withTenant(pool, org.id, async (tx) => {
      const s = await createEmployee(tx, { orgId: org.id, entityId: entity.id, actor: owner, name: "Lee", hireDate: "2026-06-01", payType: "salary", payFrequency: "biweekly", payRate: "52000" });
      return payRunInputFromEmployees(tx, entity.id, { periodStart: "2026-08-15", periodEnd: "2026-08-28", payDate: "2026-09-04", lines: [{ employeeId: s.id, vacationPay: "10" }] }, randomUUID());
    })).rejects.toThrow(/salaried/);

    // The last pay pays out everything still owed, and the ROE says so.
    await withTenant(pool, org.id, (tx) => updateEmployee(tx, { orgId: org.id, entityId: entity.id, employeeId: e.id, terminationDate: "2026-08-21", actor: owner }));
    const last = await post("2026-08-15", "2026-08-28", "2026-09-04", { regularHours: "40" });
    expect(last.vacation).toMatchObject({ balanceMinor: 0n });
    expect(last.vacation!.paidMinor).toBe(owed + 4000n);
    const roe = await withTenant(pool, org.id, (tx) => formRoe(tx, { orgId: org.id, entityId: entity.id, employeeId: e.id, fullSsn: false, actor: owner }));
    expect(roe.warnings.join()).toMatch(/Block 17A: vacation pay of/);

    // Each pay instead: an employer's higher rate goes on every paycheck.
    const updated = await withTenant(pool, org.id, (tx) => updateEmployee(tx, { orgId: org.id, entityId: entity.id, employeeId: e.id, vacationMethod: "each_pay", vacationPercent: "6", actor: owner }));
    expect(updated).toMatchObject({ vacationMethod: "each_pay", vacationPercent: "6" });
    await expect(withTenant(pool, org.id, (tx) => updateEmployee(tx, { orgId: org.id, entityId: entity.id, employeeId: e.id, vacationPercent: "60", actor: owner }))).rejects.toThrow(/between 0 and 50/);
  });
});
