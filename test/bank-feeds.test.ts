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

import { connectFeed, listFeeds, removeFeed, syncAllFeeds, syncFeed } from "../src/core/bank-feeds.js";
import { PlaidError, plaidClient, type PlaidClient, type PlaidTransaction } from "../src/app/plaid.js";
import { accountant } from "./helpers.js";

/** A stand-in for Plaid: pages of transactions, and a switch to make the bank ask for a sign-in. */
function fakePlaid(pages: PlaidTransaction[][]) {
  const calls: string[] = [];
  let loginNeeded = false;
  const c: PlaidClient & { calls: string[]; needLogin(): void; more(p: PlaidTransaction[]): void } = {
    env: "sandbox", calls,
    needLogin: () => { loginNeeded = true; },
    more: (p) => { pages.push(p); },
    linkToken: async () => "link-sandbox-1",
    exchange: async (t) => { calls.push(`exchange:${t}`); return { accessToken: "access-sandbox-secret", itemId: "item-1" }; },
    accounts: async () => [{ id: "acc-chk", name: "Business Checking", mask: "0000", type: "checking" }, { id: "acc-sav", name: "Savings", mask: "1111", type: "savings" }],
    sync: async (_token, cursor) => {
      if (loginNeeded) throw new PlaidError("the bank needs you to sign in again", "ITEM_LOGIN_REQUIRED");
      const i = cursor ? Number(cursor) : 0;
      calls.push(`sync:${i}`);
      return { added: pages[i] ?? [], modified: [], removed: [], nextCursor: String(Math.min(i + 1, pages.length)), hasMore: i + 1 < pages.length };
    },
    remove: async () => { calls.push("remove"); },
  };
  return c;
}

const txn = (id: string, amount: number, extra: Partial<PlaidTransaction> = {}): PlaidTransaction =>
  ({ transaction_id: id, account_id: "acc-chk", amount, date: "2026-03-10", name: "ADOBE *CREATIVE", merchant_name: "Adobe", pending: false, ...extra });

describe("automatic bank feeds", () => {
  it("connects one account, brings in posted lines only, keeps the token sealed, and never adds a line twice", async () => {
    const { org, entity } = await setupCaliforniaBusiness("Feed Co");
    const t = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(pool, org.id, fn);
    const base = { orgId: org.id, entityId: entity.id };
    const plaid = fakePlaid([[txn("t1", 54.99), txn("t2", -1500, { name: "DEPOSIT", merchant_name: null }), txn("t3", 9, { pending: true }), txn("t4", 20, { account_id: "acc-sav" })], [txn("t5", 40.5, { name: "SHELL OIL", merchant_name: "Shell" })]]);

    await expectLedgerError(t((tx) => connectFeed(tx, plaid, { ...base, bankAccount: "1000", publicToken: "public-1", actor: accountant })), "INVALID");
    expect(plaid.calls).toContain("remove"); // an unused login isn't left connected
    await expectLedgerError(t((tx) => connectFeed(tx, plaid, { ...base, bankAccount: "1000", publicToken: "public-1", providerAccountId: "acc-chk", actor: bookkeeper })), "FORBIDDEN");

    const { feed, sync } = await t((tx) => connectFeed(tx, plaid, { ...base, bankAccount: "1000", publicToken: "public-1", providerAccountId: "acc-chk", institution: "First Platypus Bank", actor: accountant }));
    expect(feed).toMatchObject({ bankAccount: "1000", institution: "First Platypus Bank", accountMask: "0000", status: "active" });
    expect(sync).toMatchObject({ added: 3, status: "active" });
    const lines = await t((tx) => listBankLines(tx, { entityId: entity.id, bankAccount: "1000", status: "new" }));
    expect(lines.map((l) => [l.description, l.amountMinor])).toEqual(expect.arrayContaining([["ADOBE *CREATIVE", -5499n], ["DEPOSIT", 150000n], ["SHELL OIL", -4050n]]));
    const row = (await t((tx) => tx.query("SELECT access_token_sealed, sync_cursor FROM bank_feeds WHERE id = $1", [feed.id]))).rows[0];
    expect(row.access_token_sealed).not.toContain("access-sandbox-secret");
    expect(row.sync_cursor).toBe("2");

    // Nothing new: nothing added. A second connection on the same account is refused.
    expect(await t((tx) => syncFeed(tx, plaid, { ...base, feedId: feed.id, actor: bookkeeper }))).toMatchObject({ added: 0 });
    await expectLedgerError(t((tx) => connectFeed(tx, plaid, { ...base, bankAccount: "1000", publicToken: "public-2", providerAccountId: "acc-chk", actor: accountant })), "INVALID");

    // The daily run picks up new lines; a bank asking for a sign-in marks the connection, not the run.
    plaid.more([txn("t6", 12)]);
    expect(await syncAllFeeds(pool, plaid)).toMatchObject({ synced: expect.any(Number), added: expect.any(Number) });
    expect((await t((tx) => listBankLines(tx, { entityId: entity.id, bankAccount: "1000", status: "new" }))).length).toBe(4);
    plaid.needLogin();
    expect(await t((tx) => syncFeed(tx, plaid, { ...base, feedId: feed.id, actor: bookkeeper }))).toMatchObject({ status: "needs_login", added: 0 });
    expect((await t((tx) => listFeeds(tx, entity.id)))[0]!.status).toBe("needs_login");

    await t((tx) => removeFeed(tx, plaid, { ...base, feedId: feed.id, actor: accountant }));
    expect(await t((tx) => listFeeds(tx, entity.id))).toEqual([]);
    expect((await t((tx) => listBankLines(tx, { entityId: entity.id, bankAccount: "1000", status: "new" }))).length).toBe(4);
  });

  it("talks to Plaid's API with the keys in the body and reads its errors", async () => {
    const seen: { url: string; body: any }[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      seen.push({ url, body: JSON.parse(init.body) });
      if (url.endsWith("/transactions/sync")) return new Response(JSON.stringify({ error_code: "ITEM_LOGIN_REQUIRED", error_message: "login required" }), { status: 400 });
      return new Response(JSON.stringify({ link_token: "link-sandbox-x" }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = plaidClient({ clientId: "cid", secret: "sec", env: "sandbox" }, fetchImpl);
    expect(await c.linkToken({ userId: "o:u" })).toBe("link-sandbox-x");
    expect(seen[0]).toMatchObject({ url: "https://sandbox.plaid.com/link/token/create", body: { client_id: "cid", secret: "sec", products: ["transactions"], user: { client_user_id: "o:u" } } });
    await expect(c.sync("tok", null)).rejects.toMatchObject({ code: "ITEM_LOGIN_REQUIRED" });
  });
});
