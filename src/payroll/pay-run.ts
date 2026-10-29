import type { Tx } from "../db/pool.js";
import { appendAudit } from "../core/audit.js";
import { LedgerError } from "../core/errors.js";
import { getEntry, postJournal, type Actor, type LineInput, type PostedEntry, type Role } from "../core/ledger.js";
import { resolveRules, type Place } from "../rules/index.js";
import { calculatePaycheck, type EmployeePayInput, type EmployerSettings, type Paycheck } from "./gross-to-net.js";

export interface PayRunInput {
  payRunId: string;
  kind: "regular" | "off_cycle" | "bonus" | "final";
  periodStart: string;
  periodEnd: string;
  payDate: string;
  place: Place;
  employer?: EmployerSettings;
  employees: EmployeePayInput[];
  /** Live runs must use released rule packs; previews may use drafts. */
  live: boolean;
}

export interface PayRun {
  payRunId: string;
  kind: PayRunInput["kind"];
  periodStart: string;
  periodEnd: string;
  payDate: string;
  rulePacks: string[];
  /** The liability account for each tax code, from the rule packs. */
  taxAccounts: Record<string, string>;
  paychecks: Paycheck[];
  totals: {
    grossMinor: bigint;
    netPayMinor: bigint;
    reimbursementMinor: bigint;
    employeeTaxMinor: bigint;
    employerTaxMinor: bigint;
    byTax: Record<string, bigint>;
    byDeduction: Record<string, bigint>;
  };
  blockers: string[];
}

/** Preview: computes every paycheck under the rules in force on the pay date. */
export function calculatePayRun(input: PayRunInput): PayRun {
  const rules = resolveRules(input.place, input.payDate, { requireReleased: input.live });
  const paychecks = input.employees.map((e) => calculatePaycheck(e, rules, input.employer, input.periodEnd));
  const st = rules.state.payroll;
  const taxAccounts: Record<string, string> = { ...FEDERAL_TAX_ACCOUNT };
  if (st.incomeTaxAgency) taxAccounts[st.incomeTaxAgency.code] = st.incomeTaxAgency.account;
  for (const t of [...(st.localIncomeTaxes ?? []), ...st.taxes]) taxAccounts[t.code] = t.account;
  const byTax: Record<string, bigint> = {};
  const byDeduction: Record<string, bigint> = {};
  for (const p of paychecks) {
    for (const t of p.taxes) byTax[t.code] = (byTax[t.code] ?? 0n) + t.amountMinor;
    for (const d of p.deductions) byDeduction[d.kind] = (byDeduction[d.kind] ?? 0n) + d.amountMinor;
  }
  const sum = (f: (p: Paycheck) => bigint) => paychecks.reduce((s, p) => s + f(p), 0n);
  return {
    payRunId: input.payRunId,
    kind: input.kind,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    payDate: input.payDate,
    rulePacks: rules.provenance,
    taxAccounts,
    paychecks,
    totals: {
      grossMinor: sum((p) => p.grossMinor),
      netPayMinor: sum((p) => p.netPayMinor),
      reimbursementMinor: sum((p) => p.reimbursementMinor),
      employeeTaxMinor: sum((p) => p.employeeTaxMinor),
      employerTaxMinor: sum((p) => p.employerTaxMinor),
      byTax,
      byDeduction,
    },
    blockers: paychecks.flatMap((p) => p.blockers.map((b) => `${p.name}: ${b}`)),
  };
}

const FEDERAL_TAX_ACCOUNT: Record<string, string> = {
  FIT: "fit_payable",
  SS_EE: "fica_payable",
  MEDICARE_EE: "fica_payable",
  ADDL_MEDICARE_EE: "fica_payable",
  SS_ER: "fica_payable",
  MEDICARE_ER: "fica_payable",
  FUTA: "futa_payable",
};

const DEDUCTION_ACCOUNT: Record<string, string> = {
  section125: "section125_payable",
  traditional401k: "retirement_401k_payable",
  post_tax: "post_tax_deductions_payable",
};

/** Journal lines for a pay run: expenses on the debit side, a liability per tax and deduction on the credit side. */
export function payRunJournalLines(run: PayRun): LineInput[] {
  const debit: LineInput[] = [];
  const credit = new Map<string, bigint>();
  const addCredit = (account: string, amount: bigint) => {
    if (amount > 0n) credit.set(account, (credit.get(account) ?? 0n) + amount);
  };
  if (run.totals.grossMinor > 0n) debit.push({ account: "wages_expense", debit: run.totals.grossMinor, description: "Gross wages" });
  if (run.totals.employerTaxMinor > 0n) {
    debit.push({ account: "employer_payroll_tax_expense", debit: run.totals.employerTaxMinor, description: "Employer payroll taxes" });
  }
  // Reimbursements were booked to a payable by the expense report; paying them with payroll clears it.
  if (run.totals.reimbursementMinor > 0n) {
    debit.push({ account: "reimbursements_payable", debit: run.totals.reimbursementMinor, description: "Expense reimbursements paid with payroll" });
  }
  addCredit("net_pay_clearing", run.totals.netPayMinor);
  for (const [code, amount] of Object.entries(run.totals.byTax)) {
    const account = run.taxAccounts[code];
    if (!account) throw new LedgerError("INVALID", `no liability account for tax ${code}`);
    addCredit(account, amount);
  }
  for (const [kind, amount] of Object.entries(run.totals.byDeduction)) addCredit(DEDUCTION_ACCOUNT[kind]!, amount);
  return [
    ...debit,
    ...[...credit.entries()].map(([account, amount]) => ({ account, credit: amount, description: "Payroll liability" })),
  ];
}

const CAN_APPROVE: Role[] = ["owner", "admin", "approver"];

/**
 * Second-user approval: freezes the computed figures in the audit log and
 * posts the run to the ledger. The preparer cannot approve their own run.
 */
export async function approveAndPostPayRun(
  tx: Tx,
  input: { orgId: string; entityId: string; run: PayRun; preparedBy: Actor; approvedBy: Actor; soleApprover?: boolean },
): Promise<PostedEntry> {
  const { run, preparedBy, approvedBy } = input;
  // A business with nobody else who can approve (a one-person business) approves its own runs; the audit log says so.
  if (approvedBy.id === preparedBy.id && !input.soleApprover) {
    throw new LedgerError("FORBIDDEN", "a pay run must be approved by someone other than its preparer");
  }
  if (!CAN_APPROVE.includes(approvedBy.role)) {
    throw new LedgerError("FORBIDDEN", `role ${approvedBy.role} cannot approve pay runs`);
  }
  if (run.blockers.length) {
    throw new LedgerError("INVALID", `pay run has unresolved blockers: ${run.blockers.join("; ")}`);
  }
  const posted = await tx.query(
    "SELECT id FROM journal_entries WHERE entity_id = $1 AND idempotency_key = $2",
    [input.entityId, `pay_run:${run.payRunId}`],
  );
  if (posted.rows[0]) return { ...(await getEntry(tx, posted.rows[0].id)), replayed: true };
  await appendAudit(tx, {
    orgId: input.orgId,
    entityId: input.entityId,
    actor: approvedBy.id,
    action: "pay_run.approved",
    objectType: "pay_run",
    objectId: run.payRunId,
    after: run,
    context: { preparedBy: preparedBy.id, rulePacks: run.rulePacks, ...(approvedBy.id === preparedBy.id ? { selfApproved: "no one else in the organisation can approve pay runs" } : {}) },
  });
  return postJournal(tx, {
    orgId: input.orgId,
    entityId: input.entityId,
    date: run.payDate,
    memo: `Payroll ${run.kind} ${run.periodStart} to ${run.periodEnd}`,
    sourceType: "pay_run",
    sourceId: run.payRunId,
    idempotencyKey: `pay_run:${run.payRunId}`,
    actor: { id: approvedBy.id, role: "system" },
    lines: payRunJournalLines(run),
  });
}
