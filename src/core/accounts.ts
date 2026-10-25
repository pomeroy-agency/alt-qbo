import type { Tx } from "../db/pool.js";
import { COA_TEMPLATES, type ReturnType, type TemplateAccount } from "../rules/coa/us-service.js";
import { appendAudit } from "./audit.js";
import { LedgerError, translateDbError } from "./errors.js";
import type { Actor, Role } from "./ledger.js";

// Chart-of-accounts editing, ported from Ledgerline. New accounts pick a kind
// (which fixes type, subtype, statement line and cash-flow class) and a tax
// line for the entity's return. The database refuses mismatched statement
// lines, changes to an account's identity, and deactivating an account that
// still carries a balance or that the system posts to.

const CAN_EDIT: Role[] = ["owner", "admin", "accountant", "system"];

export interface AccountKind {
  key: string;
  label: string;
  type: TemplateAccount["type"];
  subtype: string;
  statementLine: string;
  cashFlowClass: TemplateAccount["cashFlowClass"];
}

/** The kinds of account a user can add. Control accounts (receivables, payables, payroll) stay system-only. */
export const ACCOUNT_KINDS: readonly AccountKind[] = [
  { key: "bank", label: "Bank account", type: "asset", subtype: "bank", statementLine: "BS.CurrentAssets.Cash", cashFlowClass: "cash" },
  { key: "prepaid", label: "Prepaid expense", type: "asset", subtype: "prepaid", statementLine: "BS.CurrentAssets.Prepaids", cashFlowClass: "operating" },
  { key: "other_current_asset", label: "Other current asset", type: "asset", subtype: "other_current_asset", statementLine: "BS.CurrentAssets.Other", cashFlowClass: "operating" },
  { key: "fixed_asset", label: "Furniture, equipment or vehicle", type: "asset", subtype: "fixed_asset", statementLine: "BS.NoncurrentAssets.PPE", cashFlowClass: "investing" },
  { key: "contra_asset", label: "Accumulated depreciation", type: "asset", subtype: "contra_asset", statementLine: "BS.NoncurrentAssets.PPE", cashFlowClass: "operating" },
  { key: "credit_card", label: "Credit card", type: "liability", subtype: "credit_card", statementLine: "BS.CurrentLiabilities.Payables", cashFlowClass: "operating" },
  { key: "accrued", label: "Other current liability", type: "liability", subtype: "accrued", statementLine: "BS.CurrentLiabilities.Accrued", cashFlowClass: "operating" },
  { key: "tax_payable", label: "Tax payable", type: "liability", subtype: "tax_payable", statementLine: "BS.CurrentLiabilities.Taxes", cashFlowClass: "operating" },
  { key: "long_term_debt", label: "Loan (long-term)", type: "liability", subtype: "long_term_debt", statementLine: "BS.NoncurrentLiabilities.Debt", cashFlowClass: "financing" },
  { key: "contributed_capital", label: "Owner or partner capital", type: "equity", subtype: "contributed_capital", statementLine: "BS.Equity.Contributed", cashFlowClass: "financing" },
  { key: "distributions", label: "Owner draws or distributions", type: "equity", subtype: "distributions", statementLine: "BS.Equity.Distributions", cashFlowClass: "financing" },
  { key: "operating_revenue", label: "Income", type: "revenue", subtype: "operating_revenue", statementLine: "IS.Revenue", cashFlowClass: "operating" },
  { key: "other_income", label: "Other income", type: "revenue", subtype: "other_income", statementLine: "IS.OtherIncome", cashFlowClass: "operating" },
  { key: "cost_of_revenue", label: "Cost of services", type: "expense", subtype: "cost_of_revenue", statementLine: "IS.CostOfRevenue", cashFlowClass: "operating" },
  { key: "operating_expense", label: "Expense", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating" },
  { key: "other_expense", label: "Other expense", type: "expense", subtype: "other_expense", statementLine: "IS.OtherExpense", cashFlowClass: "operating" },
];

export interface TaxLineOption {
  code: string;
  /** Template accounts that map here, so the choice reads as "like Advertising". */
  usedBy: string[];
}

/** Tax-line codes the entity's template uses for its return, by account type. Only these can be chosen. */
export function taxLineOptions(coaTemplate: string, returnType: ReturnType): Record<AccountKind["type"], TaxLineOption[]> {
  const template = COA_TEMPLATES[coaTemplate];
  if (!template) throw new LedgerError("INVALID", `no chart-of-accounts template ${coaTemplate}`);
  const out: Record<string, Map<string, string[]>> = {};
  for (const a of template) {
    const code = a.taxLines[returnType];
    if (!code) continue;
    const byType = (out[a.type] ??= new Map());
    byType.set(code, [...(byType.get(code) ?? []), a.name]);
  }
  return Object.fromEntries(
    ["asset", "liability", "equity", "revenue", "expense"].map((t) => [
      t, [...(out[t] ?? new Map()).entries()].map(([code, usedBy]) => ({ code, usedBy })).sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true })),
    ]),
  ) as Record<AccountKind["type"], TaxLineOption[]>;
}

/** The tax line the template gives accounts of this kind, as a starting suggestion. */
export function suggestedTaxLine(coaTemplate: string, returnType: ReturnType, kindKey: string): string | null {
  const kind = ACCOUNT_KINDS.find((k) => k.key === kindKey);
  const template = COA_TEMPLATES[coaTemplate] ?? [];
  const match = template.find((a) => a.subtype === kind?.subtype && a.statementLine === kind?.statementLine && a.taxLines[returnType])
    ?? template.find((a) => a.statementLine === kind?.statementLine && a.taxLines[returnType]);
  return match?.taxLines[returnType] ?? null;
}

async function entitySettings(tx: Tx, entityId: string) {
  const e = (await tx.query("SELECT coa_template, tax_return_type FROM entities WHERE id = $1", [entityId])).rows[0];
  if (!e) throw new LedgerError("INVALID", "entity not found");
  return { coaTemplate: e.coa_template as string, returnType: e.tax_return_type as ReturnType };
}

async function checkTaxLine(tx: Tx, entityId: string, type: AccountKind["type"], taxLine: string | null) {
  if (taxLine === null) return;
  const s = await entitySettings(tx, entityId);
  if (!taxLineOptions(s.coaTemplate, s.returnType)[type].some((o) => o.code === taxLine)) {
    throw new LedgerError("INVALID", `${taxLine} isn't a ${s.returnType} tax line for ${type} accounts`);
  }
}

function canEdit(actor: Actor) {
  if (!CAN_EDIT.includes(actor.role)) throw new LedgerError("FORBIDDEN", `role ${actor.role} cannot change the chart of accounts`);
}

export async function createAccount(
  tx: Tx,
  input: { orgId: string; entityId: string; code: string; name: string; kind: string; taxLine: string | null; actor: Actor },
): Promise<{ id: string; code: string }> {
  canEdit(input.actor);
  const kind = ACCOUNT_KINDS.find((k) => k.key === input.kind);
  if (!kind) throw new LedgerError("INVALID", "choose what kind of account this is");
  const name = input.name.trim();
  if (!name || name.length > 120) throw new LedgerError("INVALID", "the account needs a name of up to 120 characters");
  if (!/^\d{3,6}$/.test(input.code)) throw new LedgerError("INVALID", "account codes are 3 to 6 digits");
  if ((await tx.query("SELECT 1 FROM accounts WHERE entity_id = $1 AND code = $2", [input.entityId, input.code])).rows[0]) {
    throw new LedgerError("INVALID", `account ${input.code} already exists`);
  }
  await checkTaxLine(tx, input.entityId, kind.type, input.taxLine);
  try {
    const { rows } = await tx.query(
      `INSERT INTO accounts (org_id, entity_id, code, name, type, subtype, statement_line, cash_flow_class, tax_line)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [input.orgId, input.entityId, input.code, name, kind.type, kind.subtype, kind.statementLine, kind.cashFlowClass, input.taxLine],
    );
    await appendAudit(tx, {
      orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "account.created", objectType: "account", objectId: rows[0].id,
      after: { code: input.code, name, kind: kind.key, statementLine: kind.statementLine, taxLine: input.taxLine }, context: { role: input.actor.role },
    });
    return { id: rows[0].id, code: input.code };
  } catch (err) {
    translateDbError(err);
  }
}

/** Renames an account, remaps its tax line, or switches it on or off. Code and kind never change. */
export async function updateAccount(
  tx: Tx,
  input: { orgId: string; entityId: string; accountId: string; name?: string; taxLine?: string | null; active?: boolean; actor: Actor },
): Promise<void> {
  canEdit(input.actor);
  const a = (await tx.query(
    "SELECT id, code, name, type, tax_line, is_active FROM accounts WHERE entity_id = $1 AND id = $2 FOR UPDATE",
    [input.entityId, input.accountId],
  )).rows[0];
  if (!a) throw new LedgerError("INVALID", "account not found");
  const name = input.name === undefined ? a.name : input.name.trim();
  if (!name || name.length > 120) throw new LedgerError("INVALID", "the account needs a name of up to 120 characters");
  const taxLine = input.taxLine === undefined ? a.tax_line : input.taxLine;
  if (taxLine !== a.tax_line) await checkTaxLine(tx, input.entityId, a.type, taxLine);
  const active = input.active ?? a.is_active;
  if (name === a.name && taxLine === a.tax_line && active === a.is_active) return;
  try {
    await tx.query("UPDATE accounts SET name = $2, tax_line = $3, is_active = $4 WHERE id = $1", [a.id, name, taxLine, active]);
  } catch (err) {
    translateDbError(err);
  }
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  if (name !== a.name) { before.name = a.name; after.name = name; }
  if (taxLine !== a.tax_line) { before.taxLine = a.tax_line; after.taxLine = taxLine; }
  if (active !== a.is_active) { before.active = a.is_active; after.active = active; }
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id,
    action: active !== a.is_active ? (active ? "account.reactivated" : "account.deactivated") : "account.updated",
    objectType: "account", objectId: a.id, before, after, context: { role: input.actor.role, code: a.code },
  });
}
