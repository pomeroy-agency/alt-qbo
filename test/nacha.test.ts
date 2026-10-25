import { describe, expect, it } from "vitest";
import { buildNachaFile, cleanAccountNumber, validRouting, type NachaCredit, type NachaOrigin } from "../src/payroll/nacha.js";

const origin: NachaOrigin = {
  odfiRouting: "121000358", immediateDestination: "121000358", destinationName: "Bank of America",
  immediateOrigin: "1123456789", companyId: "1123456789", companyName: "Sunset Design Studio LLC",
};
const credits: NachaCredit[] = [
  { individualId: "EMP1", name: "Maya Chén", routing: "011000015", account: "1234-5678 90", accountType: "checking" as const, amountMinor: 215_432n },
  { individualId: "EMP2", name: "Jordan Alvarez", routing: "322271627", account: "987654321", accountType: "savings" as const, amountMinor: 98_765n },
];
const at = new Date("2026-10-25T14:05:00Z");

describe("NACHA direct deposit file", () => {
  it("checks routing numbers with the ABA check digit and Federal Reserve prefix", () => {
    expect(validRouting("121000358")).toBe(true);
    expect(validRouting("011000015")).toBe(true);
    expect(validRouting("322271627")).toBe(true);
    expect(validRouting("121000359")).toBe(false); // wrong check digit
    expect(validRouting("12100035")).toBe(false);
    expect(validRouting("500000005")).toBe(false); // 50 isn't a Federal Reserve prefix
    expect(cleanAccountNumber(" 1234-5678 90 ")).toBe("1234567890");
    expect(cleanAccountNumber("123")).toBe(null);
    expect(cleanAccountNumber("123456789012345678")).toBe(null);
  });

  it("writes one PPD credit batch with the right records, counts, hash and totals", () => {
    const f = buildNachaFile({ origin, credits, effectiveDate: "2026-10-30", createdAt: at });
    const lines = f.text.split("\r\n").filter(Boolean);
    expect(lines.every((l) => l.length === 94)).toBe(true);
    expect(lines).toHaveLength(10); // 6 records padded to a block of ten
    const [header, batch, e1, e2, batchControl, fileControl, ...pad] = lines as [string, string, string, string, string, string, ...string[]];
    expect(pad.every((l) => l === "9".repeat(94))).toBe(true);

    expect(header).toBe("101 121000358112345678926102514" + "05A094101" + "BANK OF AMERICA".padEnd(23) + "SUNSET DESIGN STUDIO LL" + " ".repeat(8));
    expect(batch.slice(0, 4)).toBe("5220");
    expect(batch.slice(4, 20)).toBe("SUNSET DESIGN ST");
    expect(batch.slice(40, 50)).toBe("1123456789");
    expect(batch.slice(50, 53)).toBe("PPD");
    expect(batch.slice(53, 63)).toBe("PAYROLL   ");
    expect(batch.slice(69, 75)).toBe("261030"); // effective date
    expect(batch.slice(78, 87)).toBe("112100035");
    expect(batch.slice(87)).toBe("0000001");

    expect(e1.slice(0, 3)).toBe("622"); // checking credit
    expect(e1.slice(3, 12)).toBe("011000015");
    expect(e1.slice(12, 29)).toBe("1234567890".padEnd(17));
    expect(e1.slice(29, 39)).toBe("0000215432");
    expect(e1.slice(54, 76)).toBe("MAYA CHEN".padEnd(22));
    expect(e1.slice(79)).toBe("121000350000001");
    expect(e2.slice(0, 3)).toBe("632"); // savings credit
    expect(e2.slice(79)).toBe("121000350000002");

    // Entry hash: 01100001 + 32227162.
    const hash = String(1100001 + 32227162).padStart(10, "0");
    expect(batchControl).toBe("8220000002" + hash + "0".repeat(12) + "000000314197" + "1123456789" + " ".repeat(25) + "12100035" + "0000001");
    expect(fileControl).toBe("9000001000001" + "00000002" + hash + "0".repeat(12) + "000000314197" + " ".repeat(39));
    expect(f).toMatchObject({ entryCount: 2, totalCreditMinor: 314_197n, totalDebitMinor: 0n });
  });

  it("adds an offsetting debit from the business account for banks that want a balanced file", () => {
    const f = buildNachaFile({ origin: { ...origin, offset: { account: "55500011", accountType: "checking" } }, credits, effectiveDate: "2026-10-30", createdAt: at });
    const [, batch, , , offset, batchControl] = f.text.split("\r\n") as [string, string, string, string, string, string];
    expect(batch.slice(1, 4)).toBe("200");
    expect(offset.slice(0, 12)).toBe("627121000358");
    expect(offset.slice(29, 39)).toBe("0000314197");
    expect(batchControl.slice(20, 44)).toBe("000000314197000000314197");
    expect(f.totalDebitMinor).toBe(314_197n);
  });

  it("refuses bad input rather than writing a file the bank would reject", () => {
    expect(() => buildNachaFile({ origin, credits: [], effectiveDate: "2026-10-30", createdAt: at })).toThrow(/no one/);
    expect(() => buildNachaFile({ origin, credits: [{ ...credits[0]!, routing: "011000016" }], effectiveDate: "2026-10-30", createdAt: at })).toThrow(/routing/);
    expect(() => buildNachaFile({ origin, credits: [{ ...credits[0]!, amountMinor: 0n }], effectiveDate: "2026-10-30", createdAt: at })).toThrow(/more than zero/);
    expect(() => buildNachaFile({ origin: { ...origin, odfiRouting: "1" }, credits, effectiveDate: "2026-10-30", createdAt: at })).toThrow(/routing/);
  });
});
