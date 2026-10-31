import type { Tx } from "../db/pool.js";
import { appendAudit } from "./audit.js";
import { LedgerError, translateDbError } from "./errors.js";
import type { Actor, Role } from "./ledger.js";
import { parseMoney } from "./money.js";

// Bank rules: "lines whose description contains GUSTO go to 6500 Payroll
// fees". A rule either suggests its category on the review screen or, when
// set to, records matching lines as they're imported. The first matching rule
// (oldest first) wins. Rules are switched off, never deleted.

const CAN_WRITE: Role[] = ["owner", "admin", "bookkeeper", "accountant", "system"];

export type RuleDirection = "any" | "in" | "out";

export interface BankRule {
  id: string;
  matchText: string;
  direction: RuleDirection;
  minMinor: bigint | null;
  maxMinor: bigint | null;
  bankAccount: string | null;
  account: string;
  accountName: string;
  autoRecord: boolean;
  memo: string | null;
  active: boolean;
  appliedCount: number;
  createdBy: string;
}

export interface RuleCandidate {
  description: string;
  amountMinor: bigint;
  bankAccountId: string;
}

interface RuleRow {
  id: string; match_text: string; direction: RuleDirection; min_minor: bigint | null; max_minor: bigint | null;
  bank_account_id: string | null; account_code: string; auto_record: boolean; memo: string | null;
}

/** Whether a rule applies to a bank line. Amount limits are on the size of the line, either direction. */
export function ruleMatches(rule: Pick<RuleRow, "match_text" | "direction" | "min_minor" | "max_minor" | "bank_account_id">, line: RuleCandidate): boolean {
  if (!line.description.toLowerCase().includes(rule.match_text.trim().toLowerCase())) return false;
  if (rule.direction === "in" && line.amountMinor <= 0n) return false;
  if (rule.direction === "out" && line.amountMinor >= 0n) return false;
  const abs = line.amountMinor < 0n ? -line.amountMinor : line.amountMinor;
  if (rule.min_minor !== null && abs < rule.min_minor) return false;
  if (rule.max_minor !== null && abs > rule.max_minor) return false;
  if (rule.bank_account_id && rule.bank_account_id !== line.bankAccountId) return false;
  return true;
}

/** The active rules, oldest first, ready for matching. */
export async function activeRules(tx: Tx, entityId: string): Promise<RuleRow[]> {
  return (await tx.query(
    `SELECT r.id, r.match_text, r.direction, r.min_minor, r.max_minor, r.bank_account_id, a.code AS account_code, r.auto_record, r.memo
       FROM bank_rules r JOIN accounts a ON a.id = r.account_id
      WHERE r.entity_id = $1 AND r.active AND a.is_active ORDER BY r.created_at, r.id`,
    [entityId],
  )).rows;
}

export function firstMatch(rules: RuleRow[], line: RuleCandidate): RuleRow | undefined {
  return rules.find((r) => ruleMatches(r, line));
}

export async function listBankRules(tx: Tx, entityId: string): Promise<BankRule[]> {
  const rows = (await tx.query(
    `SELECT r.*, a.code AS account_code, a.name AS account_name, b.code AS bank_code
       FROM bank_rules r JOIN accounts a ON a.id = r.account_id LEFT JOIN accounts b ON b.id = r.bank_account_id
      WHERE r.entity_id = $1 ORDER BY r.active DESC, r.created_at, r.id`,
    [entityId],
  )).rows;
  return rows.map((r) => ({
    id: r.id, matchText: r.match_text, direction: r.direction, minMinor: r.min_minor, maxMinor: r.max_minor, bankAccount: r.bank_code,
    account: r.account_code, accountName: r.account_name, autoRecord: r.auto_record, memo: r.memo, active: r.active,
    appliedCount: r.applied_count, createdBy: r.created_by,
  }));
}

export interface CreateRuleInput {
  orgId: string;
  entityId: string;
  matchText: string;
  direction?: RuleDirection;
  min?: string;
  max?: string;
  bankAccount?: string;
  account: string;
  autoRecord?: boolean;
  memo?: string;
  actor: Actor;
}

export async function createBankRule(tx: Tx, input: CreateRuleInput): Promise<BankRule> {
  if (!CAN_WRITE.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", `role ${input.actor.role} cannot set up bank rules`);
  const text = input.matchText.trim();
  if (text.length < 2 || text.length > 100) throw new LedgerError("INVALID", "enter 2 to 100 characters the description should contain");
  const direction = input.direction ?? "any";
  if (!["any", "in", "out"].includes(direction)) throw new LedgerError("INVALID", "direction must be any, in or out");
  const amount = (v: string | undefined, what: string) => {
    if (v === undefined || v.trim() === "") return null;
    try {
      const m = parseMoney(v.trim()).minor;
      if (m < 0n) throw new Error();
      return m;
    } catch {
      throw new LedgerError("INVALID", `${what} must be an amount like 50.00`);
    }
  };
  const min = amount(input.min, "the smallest amount"), max = amount(input.max, "the largest amount");
  if (min !== null && max !== null && max < min) throw new LedgerError("INVALID", "the largest amount is below the smallest");
  const acct = (await tx.query(
    "SELECT id, code, subtype, system_key, is_active FROM accounts WHERE entity_id = $1 AND (code = $2 OR system_key = $2)", [input.entityId, input.account],
  )).rows[0];
  if (!acct || !acct.is_active) throw new LedgerError("UNKNOWN_ACCOUNT", `no active account ${input.account} in these books`);
  if (acct.subtype === "bank") throw new LedgerError("INVALID", "a rule can't send lines to a bank account; record transfers by hand");
  if (["accounts_receivable", "accounts_payable"].includes(acct.system_key)) {
    throw new LedgerError("INVALID", "customer and vendor payments are matched to their invoice or bill, not sent by a rule");
  }
  let bankId: string | null = null;
  if (input.bankAccount) {
    const b = (await tx.query("SELECT id FROM accounts WHERE entity_id = $1 AND code = $2 AND subtype = 'bank'", [input.entityId, input.bankAccount])).rows[0];
    if (!b) throw new LedgerError("INVALID", `${input.bankAccount} isn't a bank account`);
    bankId = b.id;
  }
  let id: string;
  try {
    id = (await tx.query(
      `INSERT INTO bank_rules (org_id, entity_id, match_text, direction, min_minor, max_minor, bank_account_id, account_id, auto_record, memo, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [input.orgId, input.entityId, text, direction, min, max, bankId, acct.id, Boolean(input.autoRecord), input.memo?.trim().slice(0, 300) || null, input.actor.id],
    )).rows[0].id;
  } catch (err) {
    translateDbError(err);
  }
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "bank_rule.created", objectType: "bank_rule", objectId: id,
    after: { matchText: text, direction, min, max, bankAccount: input.bankAccount ?? null, account: acct.code, autoRecord: Boolean(input.autoRecord) },
    context: { role: input.actor.role },
  });
  return (await listBankRules(tx, input.entityId)).find((r) => r.id === id)!;
}

export async function switchOffBankRule(tx: Tx, input: { orgId: string; entityId: string; ruleId: string; actor: Actor }): Promise<void> {
  if (!CAN_WRITE.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", `role ${input.actor.role} cannot change bank rules`);
  const r = await tx.query("UPDATE bank_rules SET active = false WHERE id = $1 AND entity_id = $2 AND active RETURNING match_text", [input.ruleId, input.entityId]);
  if (!r.rows[0]) throw new LedgerError("INVALID", "that rule isn't on");
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "bank_rule.switched_off", objectType: "bank_rule", objectId: input.ruleId,
    after: { active: false }, context: { role: input.actor.role },
  });
}

export async function countRuleUse(tx: Tx, ruleId: string): Promise<void> {
  await tx.query("UPDATE bank_rules SET applied_count = applied_count + 1 WHERE id = $1", [ruleId]);
}
