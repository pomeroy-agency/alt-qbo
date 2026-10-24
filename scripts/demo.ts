// End-to-end walk through Phase 0 against DATABASE_URL:
//   npm run migrate && npm run demo
import { createPool, withSystem, withTenant } from "../src/db/pool.js";
import { createEntity, createOrganization } from "../src/core/tenancy.js";
import { postJournal, type Actor } from "../src/core/ledger.js";
import { trialBalance } from "../src/core/reports.js";
import { verifyAuditChain } from "../src/core/audit.js";
import { formatMoney, money } from "../src/core/money.js";
import { approveAndPostPayRun, calculatePayRun } from "../src/payroll/pay-run.js";

const owner: Actor = { id: "user:demo-owner", role: "owner" };
const bookkeeper: Actor = { id: "user:demo-bookkeeper", role: "bookkeeper" };
const pool = createPool();

try {
  const org = await withSystem(pool, (tx) => createOrganization(tx, { name: "Demo Studio", actor: owner }));
  const entity = await withTenant(pool, org.id, (tx) =>
    createEntity(tx, {
      orgId: org.id, legalName: "Demo Studio LLC", entityType: "llc_single",
      place: { country: "US", region: "CA" }, firstFiscalYear: 2026, actor: owner,
    }),
  );
  console.log(`entity ${entity.legalName}: ${entity.framework}, ${entity.functionalCurrency}, return ${entity.taxReturnType}`);

  await withTenant(pool, org.id, async (tx) => {
    await postJournal(tx, {
      orgId: org.id, entityId: entity.id, date: "2026-06-01", idempotencyKey: "demo-capital",
      sourceType: "journal_voucher", memo: "Owner contribution", actor: bookkeeper,
      lines: [{ account: "cash_operating", debit: "20000.00" }, { account: "owner_capital", credit: "20000.00" }],
    });
    await postJournal(tx, {
      orgId: org.id, entityId: entity.id, date: "2026-06-05", idempotencyKey: "demo-inv-1001",
      sourceType: "invoice", memo: "Invoice 1001", actor: bookkeeper,
      lines: [{ account: "accounts_receivable", debit: "8500.00" }, { account: "service_revenue", credit: "8500.00" }],
    });
  });

  const run = calculatePayRun({
    payRunId: "demo-pr-1", kind: "regular", periodStart: "2026-06-01", periodEnd: "2026-06-14",
    payDate: "2026-06-19", place: { country: "US", region: "CA" }, live: false,
    employees: [{
      employeeId: "e1", name: "Maya Chen", payFrequency: "biweekly", salaryPerPeriod: "3000.00",
      w4: { filingStatus: "single_or_mfs", step2Checked: false },
      de4: { filingStatus: "single", regularAllowances: 1 },
    }],
  });
  for (const p of run.paychecks) {
    console.log(`${p.name}: gross ${formatMoney(money(p.grossMinor))}, net ${formatMoney(money(p.netPayMinor))}`);
    for (const t of p.taxes) console.log(`  ${t.code.padEnd(16)} ${formatMoney(money(t.amountMinor))}`);
  }
  await withTenant(pool, org.id, (tx) =>
    approveAndPostPayRun(tx, { orgId: org.id, entityId: entity.id, run, preparedBy: bookkeeper, approvedBy: owner }),
  );

  const tb = await withTenant(pool, org.id, (tx) => trialBalance(tx, entity.id, "2026-06-30"));
  console.log("\ntrial balance 2026-06-30");
  for (const r of tb.rows) console.log(`  ${r.code} ${r.name.padEnd(40)} ${formatMoney(money(r.balanceMinor))}`);
  console.log(`  debits ${formatMoney(money(tb.totalDebitMinor))} = credits ${formatMoney(money(tb.totalCreditMinor))}`);

  const chain = await withTenant(pool, org.id, (tx) => verifyAuditChain(tx, org.id));
  console.log(`\naudit chain: ${chain.ok ? "verified" : "BROKEN"} (${chain.events} events)`);
} finally {
  await pool.end();
}
