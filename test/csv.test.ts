import { describe, expect, it } from "vitest";
import { csvCell } from "../src/core/csv.js";

describe("CSV cells", () => {
  it("quotes commas and quotes, and keeps text from running as a spreadsheet formula", () => {
    expect(csvCell("Acme, Inc.")).toBe('"Acme, Inc."');
    expect(csvCell('Say "hi"')).toBe('"Say ""hi"""');
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell("+1 call me")).toBe("'+1 call me");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-5.00")).toBe("-5.00");
    expect(csvCell("125.00")).toBe("125.00");
    expect(csvCell(null)).toBe("");
  });
});
