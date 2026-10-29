import { describe, expect, it } from "vitest";
import { D } from "../src/core/money.js";
import { bracketTax, canadaDeductions, federalBasicPersonalAmount, type CanadaPayInput } from "../src/payroll/canada.js";
import { allCanadaRulePacks, resolveCanadaRules } from "../src/rules/canada/index.js";
import { COUNTRIES } from "../src/rules/index.js";

const pay = (region: string, input: Partial<CanadaPayInput> & { gross: string }) => {
  const { federal, province } = resolveCanadaRules(region, "2026-11-13");
  return canadaDeductions(federal, province, { periodsPerYear: 26, ...input });
};

describe("Canada rule packs", () => {
  it("has a released pack for every province and territory in the country picker", () => {
    const regions = COUNTRIES.find((c) => c.code === "CA")!.regions.map((r) => r.code).sort();
    const packs = allCanadaRulePacks().filter((p) => p.kind === "ca-province");
    expect(packs.map((p) => p.place.region).sort()).toEqual(regions);
    expect(allCanadaRulePacks().every((p) => p.status === "released")).toBe(true);
    for (const p of allCanadaRulePacks()) expect(p.sources.length).toBeGreaterThan(0);
  });

  it("resolves released packs for live pay runs and refuses dates without a pack", () => {
    expect(resolveCanadaRules("BC", "2026-11-13", { requireReleased: true }).province.id).toBe("ca-bc");
    expect(() => resolveCanadaRules("BC", "2027-01-15")).toThrow(/no Canadian rule pack/);
    expect(resolveCanadaRules("BC", "2026-11-13").provenance[1]).toMatch(/^ca-bc@2026\.3#[0-9a-f]{12}$/);
  });
});

describe("CPP, EI and QPIP", () => {
  it("takes CPP above the basic exemption for the period and EI on all insurable earnings", () => {
    const d = pay("BC", { gross: "2000" });
    // 5.95% × (2,000 − 3,500 / 26)
    expect(d.pension.toFixed(2)).toBe("110.99");
    expect(d.ei.toFixed(2)).toBe("32.60");
    expect(d.employer.ei.toFixed(2)).toBe("45.64");
    expect(d.employer.pension.toFixed(2)).toBe("110.99");
  });

  it("stops CPP and EI at the year's maximums", () => {
    const d = pay("ON", { gross: "3000", ytd: { pension: "4200", ei: "1120", pensionableEarnings: "60000" } });
    expect(d.pension.toFixed(2)).toBe("30.45"); // 4,230.45 − 4,200
    expect(d.ei.toFixed(2)).toBe("3.07"); // 1,123.07 − 1,120
  });

  it("starts CPP2 once pensionable earnings pass the YMPE and stops it at the YAMPE", () => {
    const crossing = pay("ON", { gross: "4000", ytd: { pension: "4230.45", pensionableEarnings: "73600" } });
    expect(crossing.pension.toFixed(2)).toBe("0.00");
    expect(crossing.pension2.toFixed(2)).toBe("120.00"); // 4% × (77,600 − 74,600)
    const capped = pay("ON", { gross: "4000", ytd: { pension: "4230.45", pension2: "400", pensionableEarnings: "84000" } });
    expect(capped.pension2.toFixed(2)).toBe("16.00"); // 416 − 400
  });

  it("uses QPP, the lower EI rate and QPIP in Quebec", () => {
    const d = pay("QC", { gross: "2000" });
    expect(d.pension.toFixed(2)).toBe("117.52"); // 6.30% × (2,000 − 134.62)
    expect(d.ei.toFixed(2)).toBe("26.00");
    expect(d.qpip.toFixed(2)).toBe("8.60");
    expect(d.employer.qpip.toFixed(2)).toBe("12.04");
  });

  it("skips exempt contributions", () => {
    const d = pay("AB", { gross: "2000", cppExempt: true, eiExempt: true });
    expect(d.pension.isZero() && d.pension2.isZero() && d.ei.isZero()).toBe(true);
  });
});

describe("federal income tax", () => {
  it("phases the basic personal amount from $16,452 to $14,829", () => {
    const { federal } = resolveCanadaRules("ON", "2026-11-13");
    expect(federalBasicPersonalAmount(federal, new D(100000)).toFixed(0)).toBe("16452");
    expect(federalBasicPersonalAmount(federal, new D(300000)).toFixed(0)).toBe("14829");
    expect(federalBasicPersonalAmount(federal, new D(219961)).toFixed(2)).toBe("15640.50");
  });

  it("works out T4127's annual formula by hand for $2,000 every two weeks", () => {
    const d = pay("BC", { gross: "2000" });
    // A = 26 × (2,000 − 110.99 × 1/5.95) = 51,515.00
    expect(d.annualTaxableIncome.toFixed(2)).toBe("51515.00");
    // T3 = 14% × 51,515 − 14% × (16,452 + 26 × 110.99 × 4.95/5.95 + 26 × 32.60 + 1,501)
    const t3 = new D(51515).mul(0.14).sub(new D(16452).add(new D(110.99).mul(26).mul(4.95).div(5.95)).add(new D(32.6).mul(26)).add(1501).mul(0.14));
    expect(d.federalTax.toFixed(2)).toBe(t3.div(26).toFixed(2));
  });

  it("takes the 16.5% Quebec abatement off federal tax", () => {
    const qc = pay("QC", { gross: "3000", eiExempt: true, cppExempt: true });
    const on = pay("ON", { gross: "3000", eiExempt: true, cppExempt: true });
    // Without QPP or EI the federal base is the same, less the credit for QPIP premiums; then the abatement.
    const qpipCredit = qc.qpip.mul(26).mul(0.14);
    expect(qc.federalTax.toFixed(2)).toBe(on.federalTax.mul(26).sub(qpipCredit).mul(0.835).div(26).toFixed(2));
  });

  it("adds extra tax asked for on the TD1 and never goes below zero", () => {
    expect(pay("NS", { gross: "300" }).federalTax.toFixed(2)).toBe("0.00");
    expect(pay("NS", { gross: "300", extraFederalTax: "25" }).federalTax.toFixed(2)).toBe("25.00");
  });
});

describe("provincial income tax", () => {
  it("sums tax through the brackets", () => {
    const rows = [{ over: "0", rate: "0.1" }, { over: "100", rate: "0.2" }];
    expect(bracketTax(rows, new D(150)).toFixed(2)).toBe("20.00");
  });

  it("gives BC's tax reduction to low earners and none above the phase-out", () => {
    const low = pay("BC", { gross: "1000" });
    expect(low.provincialTax.toFixed(2)).toBe("0.00");
    const { province } = resolveCanadaRules("BC", "2026-11-13");
    const tax = province.incomeTax;
    if (tax.method !== "t4127" || tax.taxReduction?.kind !== "bc") throw new Error("BC pack shape");
    // Above $25,570 + $805 / 3.56% the reduction is gone.
    const high = pay("BC", { gross: "2500" });
    expect(high.annualTaxableIncome.gt(25570 + 805 / 0.0356)).toBe(true);
  });

  it("adds Ontario's surtax and health premium", () => {
    // $8,000 every two weeks: A ≈ 205,000, basic Ontario tax well over both surtax thresholds, premium $900.
    const d = pay("ON", { gross: "8000", ytd: { pension: "4230.45", pension2: "416", ei: "1123.07", pensionableEarnings: "90000" } });
    const a = d.annualTaxableIncome;
    const { province } = resolveCanadaRules("ON", "2026-11-13");
    const tax = province.incomeTax;
    if (tax.method !== "t4127") throw new Error("ON pack shape");
    // CPP and EI are at their maximums for the year, so the credits use the maximums (T4127 K2 note).
    const t4 = bracketTax(tax.brackets, a).sub(new D(12989).add(3519.45).add(1123.07).mul(0.0505));
    const v1 = t4.sub(5818).mul(0.2).add(t4.sub(7446).mul(0.36));
    const premium = D.min(900, new D(750).add(a.sub(200000).mul(0.25)));
    expect(d.provincialTax.toFixed(2)).toBe(t4.add(v1).add(premium).div(26).toFixed(2));
  });

  it("phases out Manitoba's basic personal amount between $200,000 and $400,000", () => {
    const below = pay("MB", { gross: "4000", cppExempt: true, eiExempt: true });
    const above = pay("MB", { gross: "16000", cppExempt: true, eiExempt: true });
    const { province } = resolveCanadaRules("MB", "2026-11-13");
    if (province.incomeTax.method !== "t4127") throw new Error("MB pack shape");
    expect(above.provincialTax.toFixed(2)).toBe(bracketTax(province.incomeTax.brackets, above.annualTaxableIncome).div(26).toFixed(2));
    expect(below.provincialTax.toFixed(2)).toBe(bracketTax(province.incomeTax.brackets, below.annualTaxableIncome).sub(new D(15780).mul(0.108)).div(26).toFixed(2));
  });

  it("gives Yukon the Canada employment amount and the federal basic personal amount", () => {
    const d = pay("YT", { gross: "2000", cppExempt: true, eiExempt: true });
    expect(d.provincialTax.toFixed(2)).toBe(new D(52000).mul(0.064).sub(new D(16452 + 1501).mul(0.064)).div(26).toFixed(2));
  });

  it("works out Quebec tax after the deduction for employment income", () => {
    const d = pay("QC", { gross: "2000", cppExempt: true, eiExempt: true });
    // 52,000 − 6% capped at 1,450, less QPIP doesn't apply to tax; credits 14% × 18,952
    const expected = new D(52000 - 1450).mul(0.14).sub(new D(18952).mul(0.14)).div(26);
    expect(d.provincialTax.toFixed(2)).toBe(expected.toFixed(2));
  });

  it("works out tax in every province and territory", () => {
    for (const p of allCanadaRulePacks()) {
      if (p.kind !== "ca-province") continue;
      const d = pay(p.place.region!, { gross: "2500" });
      expect(d.provincialTax.gt(0), p.name).toBe(true);
      expect(d.federalTax.gt(0), p.name).toBe(true);
    }
  });
});

describe("Revenu Québec's worked examples (TP-1015.F-V 2026)", () => {
  // Appendix 1: $4,000 every two weeks, $200 RPP, TP-1015.3 line 10 $21,830, $2,000 FTQ and $3,000 Fondaction shares over 20 pays.
  const appendix1 = (ytd: CanadaPayInput["ytd"], shares: string) => pay("QC", {
    gross: "4000", retirementContributions: "200", provincialClaim: "21830", labourFundShares: shares, ytd,
  });

  it("withholds $444.51 for the first 18 pays", () => {
    const d = appendix1({}, "250");
    expect(d.pension.toFixed(2)).toBe("243.52");
    expect(d.provincialTax.toFixed(2)).toBe("444.51");
  });

  it("withholds $421.46 once only QPP2 is taken ($160 a pay)", () => {
    const d = appendix1({ pension: "4479.30", pension2: "56", pensionableEarnings: "76000" }, "250");
    expect(d.pension2.toFixed(2)).toBe("160.00");
    expect(d.provincialTax.toFixed(2)).toBe("421.46");
  });

  it("withholds $481.76 on the 22nd pay and $489.36 after QPP2 is done", () => {
    expect(appendix1({ pension: "4479.30", pension2: "376", pensionableEarnings: "84000" }, "0").provincialTax.toFixed(2)).toBe("481.76");
    expect(appendix1({ pension: "4479.30", pension2: "416", pensionableEarnings: "88000" }, "0").provincialTax.toFixed(2)).toBe("489.36");
  });

  it("works out Appendix 3's QPP contributions for the 19th to 22nd pays", () => {
    const p19 = pay("QC", { gross: "4000", ytd: { pension: "4383.36", pensionableEarnings: "72000" } });
    expect([p19.pension.toFixed(2), p19.pension2.toFixed(2)]).toEqual(["95.94", "56.00"]);
    const p20 = pay("QC", { gross: "4000", ytd: { pension: "4479.30", pension2: "56", pensionableEarnings: "76000" } });
    expect([p20.pension.toFixed(2), p20.pension2.toFixed(2)]).toEqual(["0.00", "160.00"]);
    const p22 = pay("QC", { gross: "4000", ytd: { pension: "4479.30", pension2: "376", pensionableEarnings: "84000" } });
    expect(p22.pension2.toFixed(2)).toBe("40.00");
  });
});

describe("T4127 July 2026 changes", () => {
  it("uses CRA's constants: federal tax on $60,000 is 20.5% × A − $3,804", () => {
    const { federal } = resolveCanadaRules("ON", "2026-11-13");
    expect(bracketTax(federal.incomeTax.brackets, new D(60000)).toFixed(2)).toBe("8496.00");
  });

  it("gives no BC tax reduction above $44,952", () => {
    const { federal, province } = resolveCanadaRules("BC", "2026-11-13");
    const at = (gross: string) => canadaDeductions(federal, province, { periodsPerYear: 26, gross, cppExempt: true, eiExempt: true, provincialClaim: "0" });
    const t4 = (a: number) => a * 0.0614 - (a > 50363 ? 786 : 0);
    // $1,700 × 26 = $44,200: reduction $805 − 3.56% × $18,630 = $141.77
    expect(at("1700").provincialTax.toFixed(2)).toBe(new D(t4(44200)).sub(805 - (44200 - 25570) * 0.0356).div(26).toFixed(2));
    // $1,750 × 26 = $45,500: none
    expect(at("1750").provincialTax.toFixed(2)).toBe(new D(t4(45500)).div(26).toFixed(2));
  });

  it("reads a TD1NL for the old $11,188 basic amount as the prorated $15,000", () => {
    const old = pay("NL", { gross: "2000", provincialClaim: "11188" });
    const none = pay("NL", { gross: "2000" });
    expect(old.provincialTax.toFixed(2)).toBe(none.provincialTax.toFixed(2));
  });

  it("applies PEI's prorated 21% over $200,000", () => {
    const { province } = resolveCanadaRules("PE", "2026-11-13");
    if (province.incomeTax.method !== "t4127") throw new Error("PE pack shape");
    expect(bracketTax(province.incomeTax.brackets, new D(250000)).toFixed(2)).toBe("42036.00"); // 21% × 250,000 − 10,464
  });
});

describe("T4127 January 2026 formulas", () => {
  it("takes CPP and EI on $1,000 a week as in CRA's bonus example ($55.50 and $16.30)", () => {
    const d = pay("ON", { gross: "1000", periodsPerYear: 52 });
    expect([d.pension.toFixed(2), d.ei.toFixed(2)]).toEqual(["55.50", "16.30"]);
  });

  it("gives Alberta's supplemental credit: 25% of K1P + K2P over $4,896", () => {
    const big = pay("AB", { gross: "3000", provincialClaim: "70000", cppExempt: true, eiExempt: true });
    const { province } = resolveCanadaRules("AB", "2026-11-13");
    if (province.incomeTax.method !== "t4127") throw new Error("AB pack shape");
    const k1p = new D(70000).mul(0.08);
    const t4 = D.max(0, bracketTax(province.incomeTax.brackets, new D(78000)).sub(k1p).sub(k1p.sub(4896).mul(0.25)));
    expect(big.provincialTax.toFixed(2)).toBe(t4.div(26).toFixed(2));
  });

  it("uses the year's maximum CPP and EI credits once they're reached", () => {
    const { federal } = resolveCanadaRules("SK", "2026-11-13");
    const maxed = pay("SK", { gross: "3000", ytd: { pension: "4230.45", ei: "1123.07", pensionableEarnings: "90000", pension2: "416" } });
    const a = new D(78000);
    const t3 = bracketTax(federal.incomeTax.brackets, a).sub(new D(16452).add(3519.45).add(1123.07).add(1501).mul(0.14));
    expect(maxed.federalTax.toFixed(2)).toBe(t3.div(26).toFixed(2));
  });
});
