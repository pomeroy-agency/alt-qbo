import { describe, expect, it } from "vitest";
import { withTenant, type Tx } from "../src/db/pool.js";
import { LedgerError } from "../src/core/errors.js";
import { importBankCsv, isOfx, listBankLines, readOfx } from "../src/core/bank.js";
import { bookkeeper, pool, setupCaliforniaBusiness } from "./helpers.js";

async function expectLedgerError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof LedgerError && e.code === code);
}

// OFX 1.x: SGML, no closing tags on values.
const OFX1 = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260331</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>USD
<BANKACCTFROM><BANKID>121000248<ACCTID>000123456789<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260301<DTEND>20260331
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260302120000[-8:PST]<TRNAMT>-54.99<FITID>2026030201<NAME>ADOBE CREATIVE<MEMO>Subscription
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260305<TRNAMT>1500.00<FITID>2026030501<NAME>CLIENT DEPOSIT
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260305<TRNAMT>-40.00<FITID>2026030502<NAME>SHELL OIL &amp; GAS
</BANKTRANLIST><LEDGERBAL><BALAMT>5000.00<DTASOF>20260331</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
`;

// OFX 2.x: XML.
const OFX2 = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="220"?>
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>USD</CURDEF>
<CCACCTFROM><ACCTID>4111111111111111</ACCTID></CCACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260306</DTPOSTED><TRNAMT>-12.50</TRNAMT><FITID>A1</FITID><NAME>COFFEE</NAME></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260307</DTPOSTED><TRNAMT>-12.50</TRNAMT><FITID>A2</FITID><NAME>COFFEE</NAME></STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;

describe("OFX, QFX and QBO bank files", () => {
  it("reads OFX 1 (SGML) and OFX 2 (XML)", () => {
    expect(isOfx(OFX1)).toBe(true);
    expect(isOfx("Date,Description,Amount\n")).toBe(false);
    const a = readOfx(OFX1);
    expect(a.rows.map((r) => [r.date, r.description, r.amountMinor, r.fitid])).toEqual([
      ["2026-03-02", "ADOBE CREATIVE Subscription", -5499n, "2026030201"],
      ["2026-03-05", "CLIENT DEPOSIT", 150000n, "2026030501"],
      ["2026-03-05", "SHELL OIL & GAS", -4000n, "2026030502"],
    ]);
    const b = readOfx(OFX2);
    expect(b.rows.map((r) => r.fitid)).toEqual(["A1", "A2"]);
  });

  it("imports by the bank's transaction ID, so a re-download adds nothing and same-day twins both count", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
    const base = { orgId: org.id, entityId: entity.id, bankAccount: "1000", actor: bookkeeper };
    expect(await t((tx) => importBankCsv(tx, { ...base, csv: OFX1, fileName: "march.qfx" }))).toMatchObject({ added: 3, duplicates: 0 });
    expect(await t((tx) => importBankCsv(tx, { ...base, csv: OFX1, fileName: "march.qfx" }))).toMatchObject({ added: 0, duplicates: 3 });
    expect(await t((tx) => importBankCsv(tx, { ...base, csv: OFX2, fileName: "card.ofx" }))).toMatchObject({ added: 2 });
    const lines = await t((tx) => listBankLines(tx, { entityId: entity.id, bankAccount: "1000", status: "new" }));
    expect(lines).toHaveLength(5);
  });

  it("asks for one account at a time", async () => {
    const two = OFX1.replace("</STMTRS>", "</STMTRS><STMTRS><BANKACCTFROM><ACCTID>999988887777</BANKACCTFROM><BANKTRANLIST></BANKTRANLIST></STMTRS>");
    expect(() => readOfx(two)).toThrow(/2 accounts \(ending 6789, 7777\)/);
    expect(readOfx(two, "6789").rows).toHaveLength(3);
    const { org, entity } = await setupCaliforniaBusiness("Ofx Two");
    await expectLedgerError(withTenant(pool, org.id, (tx) => importBankCsv(tx, { orgId: org.id, entityId: entity.id, bankAccount: "1000", csv: "<OFX></OFX>", actor: bookkeeper })), "INVALID");
  });
});
