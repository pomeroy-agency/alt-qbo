import { describe, expect, it } from "vitest";
import { withSystem, withTenant } from "../src/db/pool.js";
import { findPeriod, postJournal, reverseEntry, setPeriodStatus, type PostInput } from "../src/core/ledger.js";
import { LedgerError } from "../src/core/errors.js";
import { accountBalance, taxLineExportCsv, trialBalance } from "../src/core/reports.js";
import { accountant, bookkeeper, owner, pool, setupCaliforniaBusiness } from "./helpers.js";

function invoice(orgId: string, entityId: string, key: string, amount = "1500.00", date = "2026-03-15"): PostInput {
  return {
    orgId, entityId, date, idempotencyKey: key, sourceType: "invoice", sourceId: key, memo: "Website build",
    actor: bookkeeper,
    lines: [
      { account: "accounts_receivable", debit: amount, dimensions: { project: "acme-site" } },
      { account: "4000", credit: amount, dimensions: { project: "acme-site" } },
    ],
  };
}

async function expectLedgerError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof LedgerError && e.code === code);
}

describe("posting", () => {
  it("posts a balanced entry with gapless numbers and drills down to lines", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    const [a, b] = await withTenant(pool, org.id, async (tx) => [
      await postJournal(tx, invoice(org.id, entity.id, "inv-1001")),
      await postJournal(tx, invoice(org.id, entity.id, "inv-1002", "250.00")),
    ]);
    expect(a!.entryNumber).toBe(1n);
    expect(b!.entryNumber).toBe(2n);
    expect(a!.lines).toHaveLength(2);
    expect(a!.lines[0]).toMatchObject({ accountCode: "1100", debitMinor: 150000n, creditMinor: 0n, currency: "USD" });
    expect(a!.lines[0]!.dimensions).toEqual({ project: "acme-site" });

    const tb = await withTenant(pool, org.id, (tx) => trialBalance(tx, entity.id, "2026-12-31"));
    expect(tb.totalDebitMinor).toBe(175000n);
    expect(tb.totalCreditMinor).toBe(175000n);
  });

  it("refuses an unbalanced entry in the service and in the database", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    const bad = invoice(org.id, entity.id, "inv-bad");
    bad.lines[1]!.credit = "1499.99";
    await expectLedgerError(withTenant(pool, org.id, (tx) => postJournal(tx, bad)), "UNBALANCED");

    // Bypass the service: the deferred constraint trigger still refuses at commit.
    const acct = await withTenant(pool, org.id, async (tx) =>
      (await tx.query("SELECT id FROM accounts WHERE entity_id = $1 AND code IN ('1100','4000') ORDER BY code", [entity.id])).rows,
    );
    const period = await withTenant(pool, org.id, (tx) => findPeriod(tx, entity.id, "2026-03-15"));
    const direct = withTenant(pool, org.id, async (tx) => {
      const { rows } = await tx.query(
        `INSERT INTO journal_entries (org_id, entity_id, entry_number, entry_date, period_id, source_type,
           idempotency_key, content_hash, posted_by)
         VALUES ($1, $2, 999, '2026-03-15', $3, 'journal_voucher', 'raw', 'x', 'raw') RETURNING id`,
        [org.id, entity.id, period.id],
      );
      await tx.query(
        `INSERT INTO journal_lines (org_id, entity_id, entry_id, line_no, account_id, currency, debit_minor)
         VALUES ($1, $2, $3, 1, $4, 'USD', 100)`,
        [org.id, entity.id, rows[0].id, acct[0].id],
      );
      await tx.query(
        `INSERT INTO journal_lines (org_id, entity_id, entry_id, line_no, account_id, currency, credit_minor)
         VALUES ($1, $2, $3, 2, $4, 'USD', 99)`,
        [org.id, entity.id, rows[0].id, acct[1].id],
      );
    });
    await expect(direct).rejects.toThrow(/UNBALANCED/);
  });

  it("balances per currency, not just in total", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    const mixed: PostInput = {
      orgId: org.id, entityId: entity.id, date: "2026-03-01", idempotencyKey: "fx-1", sourceType: "journal_voucher",
      actor: bookkeeper,
      lines: [
        { account: "1000", debit: "100.00", currency: "USD" },
        { account: "4000", credit: "100.00", currency: "CAD" },
      ],
    };
    await expectLedgerError(withTenant(pool, org.id, (tx) => postJournal(tx, mixed)), "UNBALANCED");
  });

  it("rejects lines with both or neither side, and unknown accounts", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    const both = invoice(org.id, entity.id, "x1");
    both.lines[0]!.credit = "1.00";
    await expectLedgerError(withTenant(pool, org.id, (tx) => postJournal(tx, both)), "INVALID");
    const unknown = invoice(org.id, entity.id, "x2");
    unknown.lines[1]!.account = "9999";
    await expectLedgerError(withTenant(pool, org.id, (tx) => postJournal(tx, unknown)), "UNKNOWN_ACCOUNT");
    await expect(
      withTenant(pool, org.id, (tx) => postJournal(tx, { ...invoice(org.id, entity.id, "x3", "10.001") })),
    ).rejects.toThrow(/decimal places/);
  });

  it("is idempotent: a replay returns the original, a different payload with the same key is refused", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    const first = await withTenant(pool, org.id, (tx) => postJournal(tx, invoice(org.id, entity.id, "bank-line-77")));
    const replay = await withTenant(pool, org.id, (tx) => postJournal(tx, invoice(org.id, entity.id, "bank-line-77")));
    expect(replay.id).toBe(first.id);
    expect(replay.replayed).toBe(true);
    await expectLedgerError(
      withTenant(pool, org.id, (tx) => postJournal(tx, invoice(org.id, entity.id, "bank-line-77", "9.99"))),
      "IDEMPOTENCY_CONFLICT",
    );
    const bal = await withTenant(pool, org.id, (tx) => accountBalance(tx, entity.id, "1100", "2026-12-31"));
    expect(bal).toBe(150000n);
  });

  it("checks roles", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    const ro = { ...invoice(org.id, entity.id, "ro"), actor: { id: "user:viewer", role: "read_only" as const } };
    await expectLedgerError(withTenant(pool, org.id, (tx) => postJournal(tx, ro)), "FORBIDDEN");
  });
});

describe("immutability", () => {
  it("never lets a posted entry, line or audit event be changed or deleted, even by the owner role", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    const e = await withTenant(pool, org.id, (tx) => postJournal(tx, invoice(org.id, entity.id, "inv-imm")));
    for (const sql of [
      "UPDATE journal_entries SET memo = 'edited' WHERE id = $1",
      "DELETE FROM journal_entries WHERE id = $1",
      "UPDATE journal_lines SET debit_minor = 1 WHERE entry_id = $1",
      "DELETE FROM journal_lines WHERE entry_id = $1",
    ]) {
      await expect(withSystem(pool, (tx) => tx.query(sql, [e.id]))).rejects.toThrow(/IMMUTABLE/);
    }
    await expect(withSystem(pool, (tx) => tx.query("UPDATE audit_events SET actor = 'x' WHERE org_id = $1", [org.id])))
      .rejects.toThrow(/IMMUTABLE/);
    await expect(withSystem(pool, (tx) => tx.query("DELETE FROM audit_events WHERE org_id = $1", [org.id])))
      .rejects.toThrow(/IMMUTABLE/);
    await expect(withSystem(pool, (tx) => tx.query("TRUNCATE journal_lines CASCADE"))).rejects.toThrow(/IMMUTABLE/);
  });

  it("refuses new lines added to an entry after it was posted", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    const e = await withTenant(pool, org.id, (tx) => postJournal(tx, invoice(org.id, entity.id, "inv-grow")));
    await expect(
      withTenant(pool, org.id, async (tx) => {
        for (const [n, side] of [[3, "debit_minor"], [4, "credit_minor"]] as const) {
          await tx.query(
            `INSERT INTO journal_lines (org_id, entity_id, entry_id, line_no, account_id, currency, ${side})
             VALUES ($1, $2, $3, $4, $5, 'USD', 500)`,
            [org.id, entity.id, e.id, n, e.lines[0]!.accountId],
          );
        }
      }),
    ).rejects.toThrow(/IMMUTABLE/);
  });

  it("corrects by reversal, once, and the reversal nets the original to zero", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    const e = await withTenant(pool, org.id, (tx) => postJournal(tx, invoice(org.id, entity.id, "inv-rev")));
    const r = await withTenant(pool, org.id, (tx) =>
      reverseEntry(tx, { orgId: org.id, entryId: e.id, date: "2026-03-20", reason: "billed wrong client", actor: bookkeeper }),
    );
    expect(r.reversesEntryId).toBe(e.id);
    expect(r.lines[0]).toMatchObject({ accountCode: "1100", creditMinor: 150000n });
    const bal = await withTenant(pool, org.id, (tx) => accountBalance(tx, entity.id, "1100", "2026-12-31"));
    expect(bal).toBe(0n);
    await expectLedgerError(
      withTenant(pool, org.id, (tx) =>
        reverseEntry(tx, { orgId: org.id, entryId: e.id, date: "2026-03-21", reason: "again", actor: bookkeeper }),
      ),
      "ALREADY_REVERSED",
    );
  });
});

describe("periods", () => {
  it("opens twelve monthly periods for the fiscal year and refuses dates outside them", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    const { rows } = await withTenant(pool, org.id, (tx) =>
      tx.query("SELECT start_date, end_date FROM periods WHERE entity_id = $1 ORDER BY start_date", [entity.id]),
    );
    expect(rows).toHaveLength(12);
    expect(rows[1]).toEqual({ start_date: "2026-02-01", end_date: "2026-02-28" });
    await expectLedgerError(
      withTenant(pool, org.id, (tx) => postJournal(tx, invoice(org.id, entity.id, "late", "1.00", "2027-01-05"))),
      "NO_PERIOD",
    );
  });

  it("soft close admits only accountants, lock admits nobody, reopen needs a reason and is logged", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    const march = await withTenant(pool, org.id, (tx) => findPeriod(tx, entity.id, "2026-03-31"));
    await withTenant(pool, org.id, (tx) =>
      setPeriodStatus(tx, { orgId: org.id, periodId: march.id, status: "soft_closed", actor: accountant }),
    );
    await expectLedgerError(
      withTenant(pool, org.id, (tx) => postJournal(tx, invoice(org.id, entity.id, "sc-1"))),
      "FORBIDDEN",
    );
    // An accountant can post an adjusting entry, but only when the session allows it.
    await expectLedgerError(
      withTenant(pool, org.id, (tx) => postJournal(tx, { ...invoice(org.id, entity.id, "sc-2"), actor: accountant })),
      "PERIOD_SOFT_CLOSED",
    );
    await withTenant(
      pool, org.id,
      (tx) => postJournal(tx, { ...invoice(org.id, entity.id, "sc-3"), actor: accountant }),
      { allowSoftClosed: true },
    );

    await withTenant(pool, org.id, (tx) =>
      setPeriodStatus(tx, { orgId: org.id, periodId: march.id, status: "locked", actor: accountant }),
    );
    await expectLedgerError(
      withTenant(pool, org.id, (tx) => postJournal(tx, { ...invoice(org.id, entity.id, "lk-1"), actor: owner }),
        { allowSoftClosed: true }),
      "PERIOD_LOCKED",
    );

    await expectLedgerError(
      withTenant(pool, org.id, (tx) =>
        setPeriodStatus(tx, { orgId: org.id, periodId: march.id, status: "open", actor: bookkeeper, reason: "fix" }),
      ),
      "FORBIDDEN",
    );
    await expectLedgerError(
      withTenant(pool, org.id, (tx) => setPeriodStatus(tx, { orgId: org.id, periodId: march.id, status: "open", actor: owner })),
      "INVALID",
    );
    await withTenant(pool, org.id, (tx) =>
      setPeriodStatus(tx, { orgId: org.id, periodId: march.id, status: "open", actor: owner, reason: "late vendor bill" }),
    );
    const { rows } = await withTenant(pool, org.id, (tx) =>
      tx.query("SELECT action, context FROM audit_events WHERE org_id = $1 AND action = 'period.reopened'", [org.id]),
    );
    expect(rows[0].context).toMatchObject({ reason: "late vendor bill", flagIssuedReports: true, role: "owner" });
  });

  it("refuses a locked-period post made straight to the database", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    const jan = await withTenant(pool, org.id, (tx) => findPeriod(tx, entity.id, "2026-01-15"));
    await withTenant(pool, org.id, (tx) =>
      setPeriodStatus(tx, { orgId: org.id, periodId: jan.id, status: "locked", actor: owner }),
    );
    await expect(
      withSystem(pool, (tx) =>
        tx.query(
          `INSERT INTO journal_entries (org_id, entity_id, entry_number, entry_date, period_id, source_type,
             idempotency_key, content_hash, posted_by)
           VALUES ($1, $2, 500, '2026-01-15', $3, 'journal_voucher', 'raw-lock', 'x', 'raw')`,
          [org.id, entity.id, jan.id],
        ),
      ),
    ).rejects.toThrow(/PERIOD_LOCKED/);
  });
});

describe("tax-line export", () => {
  it("exports the trial balance by tax line for Intuit import", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    await withTenant(pool, org.id, async (tx) => {
      await postJournal(tx, invoice(org.id, entity.id, "inv-t1", "1000.00"));
      await postJournal(tx, {
        orgId: org.id, entityId: entity.id, date: "2026-03-20", idempotencyKey: "rent-mar",
        sourceType: "bill", actor: bookkeeper,
        lines: [{ account: "6400", debit: "400.00" }, { account: "accounts_payable", credit: "400.00" }],
      });
    });
    const csv = await withTenant(pool, org.id, (tx) => taxLineExportCsv(tx, entity.id, "2026-12-31"));
    expect(csv.split("\n")).toEqual([
      "account_number,account_name,tax_line,debit,credit",
      "1100,Accounts receivable,SchC.NotReported,1000.00,",
      "2000,Accounts payable,SchC.NotReported,,400.00",
      "4000,Service revenue,SchC.L1,,1000.00",
      "6400,Rent,SchC.L20b,400.00,",
      "",
    ]);
  });

  it("blocks the export, not the books, when an account with a balance has no tax line", async () => {
    const { org, entity } = await setupCaliforniaBusiness();
    // Officer compensation has no Schedule C line.
    await withTenant(pool, org.id, (tx) =>
      postJournal(tx, {
        orgId: org.id, entityId: entity.id, date: "2026-04-01", idempotencyKey: "oc-1", sourceType: "journal_voucher",
        actor: bookkeeper, lines: [{ account: "7010", debit: "10.00" }, { account: "1000", credit: "10.00" }],
      }),
    );
    await expect(withTenant(pool, org.id, (tx) => taxLineExportCsv(tx, entity.id, "2026-12-31")))
      .rejects.toThrow(/without a tax-line code: 7010/);
  });
});
