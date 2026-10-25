import { randomUUID } from "node:crypto";
import type { Tx } from "../db/pool.js";
import { appendAudit } from "../core/audit.js";
import { LedgerError, translateDbError } from "../core/errors.js";
import { postJournal, type Actor, type LineInput, type Role } from "../core/ledger.js";
import { addDays } from "./business-days.js";
import { DEPOSIT_ACCOUNTS, DEPOSIT_LABEL, depositSchedule, type Deposit, type FederalSchedule, type RunTaxes } from "./deposits.js";
import type { TaxLine } from "./gross-to-net.js";

// Payroll tax deposits for a business: what's due from its posted pay runs,
// what's been paid, and recording a payment made at EFTPS or the EDD.

const CAN_PAY: Role[] = ["owner", "admin", "bookkeeper", "accountant", "system"];
const CAN_SET: Role[] = ["owner", "admin", "accountant", "system"];

/** Days before the due date that a deposit shows as coming up and the reminder email goes out. */
export const REMIND_DAYS = 5;

export type DepositStatus = "paid" | "overdue" | "due_soon" | "upcoming";

export interface DepositView extends Deposit {
  agency: "IRS" | "EDD";
  what: string;
  where: string;
  paidMinor: bigint;
  remainingMinor: bigint;
  status: DepositStatus;
  payments: { paidDate: string; amountMinor: bigint; confirmation: string | null; entryId: string; createdBy: string }[];
}

function invalid(message: string): never {
  throw new LedgerError("INVALID", message);
}

export async function federalDepositSchedule(tx: Tx, entityId: string): Promise<FederalSchedule> {
  return (await tx.query("SELECT federal_deposit_schedule FROM entities WHERE id = $1", [entityId])).rows[0]?.federal_deposit_schedule ?? "monthly";
}

export async function setFederalDepositSchedule(tx: Tx, input: { orgId: string; entityId: string; schedule: string; actor: Actor }) {
  if (!CAN_SET.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", `role ${input.actor.role} cannot change payroll settings`);
  if (input.schedule !== "monthly" && input.schedule !== "semiweekly") invalid("pick monthly or semiweekly");
  const before = await federalDepositSchedule(tx, input.entityId);
  await tx.query("UPDATE entities SET federal_deposit_schedule = $2 WHERE id = $1", [input.entityId, input.schedule]);
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "entity.deposit_schedule_set",
    objectType: "entity", objectId: input.entityId, before: { schedule: before }, after: { schedule: input.schedule },
  });
}

/** Every deposit for the year's posted runs, with what's been paid against each. */
export async function taxDeposits(tx: Tx, entityId: string, year: number, today: string): Promise<DepositView[]> {
  const { rows } = await tx.query(
    `SELECT id, pay_date::text, result FROM pay_runs
      WHERE entity_id = $1 AND status = 'posted' AND pay_date >= $2 AND pay_date <= $3 ORDER BY pay_date, created_at`,
    [entityId, `${year}-01-01`, `${year}-12-31`],
  );
  const runs: RunTaxes[] = rows.map((r) => ({
    payRunId: r.id, payDate: r.pay_date,
    byTax: Object.fromEntries(Object.entries(r.result.totals.byTax as Record<string, string>).map(([k, v]) => [k, BigInt(v)])),
  }));
  const deposits = depositSchedule(runs, await federalDepositSchedule(tx, entityId));
  const { rows: paid } = await tx.query(
    `SELECT deposit_key, paid_date::text, amount_minor, by_tax, confirmation, entry_id, created_by
       FROM tax_deposit_payments WHERE entity_id = $1 AND deposit_key = ANY($2) ORDER BY created_at`,
    [entityId, deposits.map((d) => d.key)],
  );
  return deposits.map((d) => {
    const payments = paid.filter((p) => p.deposit_key === d.key).map((p) => ({
      paidDate: p.paid_date, amountMinor: BigInt(p.amount_minor), confirmation: p.confirmation, entryId: p.entry_id, createdBy: p.created_by,
    }));
    const paidMinor = payments.reduce((s, p) => s + p.amountMinor, 0n);
    const remainingMinor = d.amountMinor - paidMinor;
    // A small quarter that's over can be paid with Form 941, so it isn't late until the return is due.
    const due = d.payWithReturnBy && today > d.payWithReturnBy.quarterEnd ? d.payWithReturnBy.dueDate : d.dueDate;
    const status: DepositStatus = remainingMinor <= 0n ? "paid"
      : due < today ? "overdue"
      : due <= addDays(today, REMIND_DAYS) ? "due_soon"
      : "upcoming";
    return { ...d, ...DEPOSIT_LABEL[d.kind], paidMinor, remainingMinor: remainingMinor > 0n ? remainingMinor : 0n, status, payments };
  });
}

/**
 * Records a deposit made at EFTPS or the EDD: pays what's left of it from a
 * bank account and posts the entry that clears the tax liabilities.
 */
export async function recordDepositPayment(
  tx: Tx,
  input: { orgId: string; entityId: string; key: string; paidDate: string; bankAccount?: string; confirmation?: string; actor: Actor; today: string },
) {
  if (!CAN_PAY.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", `role ${input.actor.role} cannot record tax deposits`);
  const year = Number(input.key.match(/(\d{4})-/)?.[1]);
  if (!year) invalid("deposit not found");
  // Serialise payments for this business so two can't pay the same remainder.
  await tx.query("SELECT 1 FROM entities WHERE id = $1 FOR UPDATE", [input.entityId]);
  const deposit = (await taxDeposits(tx, input.entityId, year, input.today)).find((d) => d.key === input.key);
  if (!deposit) invalid("deposit not found");
  if (deposit.remainingMinor <= 0n) invalid("this deposit is already paid");

  const { rows: earlier } = await tx.query("SELECT by_tax FROM tax_deposit_payments WHERE entity_id = $1 AND deposit_key = $2", [input.entityId, input.key]);
  const remaining: Partial<Record<TaxLine["code"], bigint>> = {};
  for (const [code, amount] of Object.entries(deposit.byTax) as [TaxLine["code"], bigint][]) {
    const before = earlier.reduce((s, r) => s + BigInt(r.by_tax[code] ?? 0), 0n);
    if (amount - before > 0n) remaining[code] = amount - before;
  }
  const amount = Object.values(remaining).reduce((s, v) => s + (v ?? 0n), 0n);
  if (amount <= 0n) invalid("this deposit is already paid");

  const bankKey = input.bankAccount || "cash_operating";
  const bank = (await tx.query("SELECT code, subtype FROM accounts WHERE entity_id = $1 AND (code = $2 OR system_key = $2)", [input.entityId, bankKey])).rows[0];
  if (!bank || bank.subtype !== "bank") invalid(`${bankKey} is not a bank account`);

  const byAccount = new Map<string, bigint>();
  for (const [code, v] of Object.entries(remaining) as [TaxLine["code"], bigint][]) {
    const account = DEPOSIT_ACCOUNTS[deposit.kind][code]!;
    byAccount.set(account, (byAccount.get(account) ?? 0n) + v);
  }
  const id = randomUUID();
  const lines: LineInput[] = [
    ...[...byAccount.entries()].map(([account, v]) => ({ account, debit: v, description: deposit.what })),
    { account: bank.code, credit: amount, description: `${deposit.agency} deposit` },
  ];
  const confirmation = input.confirmation?.trim().slice(0, 60) || null;
  const lastDay = deposit.payWithReturnBy && input.paidDate > deposit.payWithReturnBy.quarterEnd ? deposit.payWithReturnBy.dueDate : deposit.dueDate;
  const late = input.paidDate > lastDay;
  const entry = await postJournal(tx, {
    orgId: input.orgId, entityId: input.entityId, date: input.paidDate,
    memo: `${deposit.agency} tax deposit · ${deposit.period}${confirmation ? ` · ${confirmation}` : ""}`,
    sourceType: "tax_deposit", sourceId: id, idempotencyKey: `tax_deposit:${id}`, actor: input.actor, lines,
  });
  try {
    await tx.query(
      `INSERT INTO tax_deposit_payments (id, org_id, entity_id, deposit_key, kind, due_date, paid_date, amount_minor, by_tax, confirmation, entry_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [id, input.orgId, input.entityId, input.key, deposit.kind, deposit.dueDate, input.paidDate, amount,
        JSON.stringify(Object.fromEntries(Object.entries(remaining).map(([k, v]) => [k, String(v)]))), confirmation, entry.id, input.actor.id],
    );
  } catch (err) {
    translateDbError(err);
  }
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "tax_deposit.recorded",
    objectType: "tax_deposit", objectId: id,
    after: { key: input.key, kind: deposit.kind, period: deposit.period, dueDate: deposit.dueDate, paidDate: input.paidDate, amountMinor: String(amount), confirmation, entryId: entry.id, late },
    context: { role: input.actor.role },
  });
  return { id, entryId: entry.id, amountMinor: amount, late };
}
