import { describe, expect, it } from "vitest";
import { buildCpa005File, cleanCanadianAccount, julian } from "../src/payroll/cpa005.js";

const origin = {
  originatorId: "TBK0001234", dataCentre: "00330", shortName: "Coast Ltd", longName: "Coast Design Studio Ltd",
  returnInstitution: "003", returnTransit: "01234", returnAccount: "1002003", fileNumber: 7,
};
const credit = (name: string, cents: number) => ({ reference: "emp-1", name, institution: "004", transit: "12345", account: "5678-901", amountMinor: BigInt(cents) });

describe("CPA 005 direct deposit file", () => {
  it("writes the day of the year as 0YYDDD", () => {
    expect(julian("2026-01-01")).toBe("026001");
    expect(julian("2026-08-21")).toBe("026233");
    expect(julian("2028-12-31")).toBe("028366");
  });

  it("checks Canadian account numbers", () => {
    expect(cleanCanadianAccount("1234-567")).toBe("1234567");
    expect(cleanCanadianAccount("1234")).toBeNull();
    expect(cleanCanadianAccount("1234567890123")).toBeNull();
  });

  it("builds A, C and Z records of 1,464 characters with payroll credits", () => {
    const f = buildCpa005File({ origin, credits: [credit("Avery Chén", 154505), credit("Sam Roy", 100000)], dueDate: "2026-08-21", createdAt: new Date("2026-08-19T15:00:00Z") });
    const lines = f.text.split("\r\n").filter(Boolean);
    expect(lines.map((l) => l.length)).toEqual([1464, 1464, 1464]);
    const [a, c, z] = lines as [string, string, string];
    expect(a.slice(0, 30)).toBe("A000000001TBK00012340007026231");
    expect(a.slice(30, 35)).toBe("00330");
    expect(a.slice(55, 58)).toBe("CAD");
    expect(c.slice(0, 24)).toBe("C000000002TBK00012340007");
    const seg = c.slice(24, 264);
    expect(seg.slice(0, 3)).toBe("200");
    expect(seg.slice(3, 13)).toBe("0000154505");
    expect(seg.slice(13, 19)).toBe("026233");
    expect(seg.slice(19, 28)).toBe("000412345");
    expect(seg.slice(28, 40)).toBe("5678901     ");
    expect(seg.slice(65, 80)).toBe("COAST LTD      ");
    expect(seg.slice(80, 110).trim()).toBe("AVERY CHEN");
    expect(seg.slice(140, 150)).toBe("TBK0001234");
    expect(seg.slice(169, 178)).toBe("000301234");
    expect(seg.slice(178, 190).trim()).toBe("1002003");
    expect(c.slice(264, 267)).toBe("200");
    expect(c.slice(504).trim()).toBe("");
    expect(z.slice(0, 24)).toBe("Z000000003TBK00012340007");
    expect(z.slice(24, 46)).toBe("0".repeat(22));
    expect(z.slice(46, 60)).toBe("00000000254505");
    expect(z.slice(60, 68)).toBe("00000002");
    expect(f).toMatchObject({ entryCount: 2, totalCreditMinor: 254505n });
  });

  it("starts a new C record after six payments", () => {
    const f = buildCpa005File({ origin, credits: Array.from({ length: 7 }, (_, i) => credit(`Person ${i}`, 1000)), dueDate: "2026-08-21", createdAt: new Date() });
    const lines = f.text.split("\r\n").filter(Boolean);
    expect(lines.map((l) => l[0])).toEqual(["A", "C", "C", "Z"]);
    expect(lines[2]!.slice(24, 27)).toBe("200");
    expect(lines[2]!.slice(264).trim()).toBe("");
  });

  it("refuses bad bank details", () => {
    const build = (o: object, c = [credit("A", 100)]) => () => buildCpa005File({ origin: { ...origin, ...o }, credits: c, dueDate: "2026-08-21", createdAt: new Date() });
    expect(build({ dataCentre: "330" })).toThrow(/processing centre/);
    expect(build({ fileNumber: 0 })).toThrow(/file number/);
    expect(build({}, [{ ...credit("A", 100), transit: "1234" }])).toThrow(/institution and transit/);
    expect(build({}, [])).toThrow(/no one/);
  });
});
