import type pg from "pg";
import { withSystem, withTenant, type Tx } from "../db/pool.js";
import { attention, closedThrough } from "./overview.js";
import { taxDeposits } from "../payroll/tax-deposits.js";

// The firm console: every organisation a person belongs to, and what each
// client's books need, on one page. An accounting or HR firm's staff are
// invited into each client's organisation (usually as accountants), so the
// list is simply their memberships; nothing here crosses a tenant boundary
// that their own sign-in couldn't already cross one organisation at a time.

export interface ClientEntity {
  id: string;
  name: string;
  country: string;
  region: string;
  bankToReview: number;
  overdueInvoices: number;
  billsDueSoon: number;
  payRunsToApprove: number;
  /** Payroll tax deposits overdue or due within the week. */
  taxDepositsDue: number;
  nextDeposit: { dueDate: string; what: string; overdue: boolean } | null;
  /** Bank accounts in use and not reconciled within 45 days. */
  unreconciled: number;
  closedThrough: string | null;
  /** Months that ended over a month ago and are still open. */
  monthsToClose: number;
  lastActivity: string | null;
  /** How many of the checks above need doing. */
  tasks: number;
}

export interface ClientOrg {
  id: string;
  name: string;
  role: string;
  example: boolean;
  /** Set when the organisation can't be read with this sign-in (it requires two-factor). */
  locked: string | null;
  entities: ClientEntity[];
}

async function entityStatus(tx: Tx, e: { id: string; legal_name: string; country: string; region: string }, today: string): Promise<ClientEntity> {
  const a = await attention(tx, e.id, today);
  const year = Number(today.slice(0, 4));
  // Deposits need a state rule pack; a business whose pack can't load still shows the rest.
  const deposits = await Promise.resolve()
    .then(async () => [...await taxDeposits(tx, e.id, year - 1, today), ...await taxDeposits(tx, e.id, year, today)])
    .catch(() => []);
  const open = deposits.filter((d) => d.status === "overdue" || d.status === "due_soon").sort((x, y) => x.dueDate.localeCompare(y.dueDate));
  const extra = (await tx.query(
    `SELECT
       (SELECT count(*) FROM accounts a
          WHERE a.entity_id = $1 AND a.subtype = 'bank' AND a.is_active
            AND EXISTS (SELECT 1 FROM journal_lines l WHERE l.account_id = a.id)
            AND coalesce((SELECT max(r.statement_date) FROM reconciliations r WHERE r.bank_account_id = a.id), '1900-01-01') < $2::date - 45)::int AS unreconciled,
       (SELECT count(*) FROM periods WHERE entity_id = $1 AND status = 'open' AND end_date < date_trunc('month', $2::date) - interval '1 month')::int AS months,
       (SELECT max(occurred_at) FROM audit_events WHERE entity_id = $1) AS last`,
    [e.id, today],
  )).rows[0];
  const s = {
    id: e.id, name: e.legal_name, country: e.country.trim(), region: e.region,
    ...a, taxDepositsDue: open.length,
    nextDeposit: open[0] ? { dueDate: open[0].dueDate, what: `${open[0].agency} ${open[0].what}`.trim(), overdue: open[0].status === "overdue" } : null,
    unreconciled: extra.unreconciled, closedThrough: await closedThrough(tx, e.id), monthsToClose: extra.months,
    lastActivity: extra.last ? new Date(extra.last).toISOString() : null,
  };
  const tasks = [s.bankToReview, s.overdueInvoices, s.payRunsToApprove, s.taxDepositsDue, s.unreconciled, s.monthsToClose].filter((n) => n > 0).length;
  return { ...s, tasks };
}

/** Every client this person can open, with each business's to-do counts. */
export async function clientOverview(
  pool: pg.Pool, user: { id: string }, opts: { today: string; exampleOrgName: string },
): Promise<ClientOrg[]> {
  const orgs = await withSystem(pool, async (tx) => (await tx.query(
    `SELECT o.id, o.name, m.role, o.require_mfa, u.totp_enabled_at IS NOT NULL AS has_mfa
       FROM memberships m JOIN organizations o ON o.id = m.org_id JOIN users u ON u.id = m.user_id
      WHERE m.user_id = $1 ORDER BY lower(o.name)`,
    [user.id],
  )).rows);
  const out: ClientOrg[] = [];
  // One organisation at a time, each in its own tenant transaction.
  for (const o of orgs) {
    const base = { id: o.id, name: o.name, role: o.role, example: o.name === opts.exampleOrgName };
    if (o.require_mfa && !o.has_mfa) {
      out.push({ ...base, locked: "This client requires two-factor sign-in; turn it on under Your account to see their books.", entities: [] });
      continue;
    }
    const entities = await withTenant(pool, o.id, async (tx) => {
      const ents = (await tx.query("SELECT id, legal_name, country, region FROM entities ORDER BY created_at")).rows;
      const list: ClientEntity[] = [];
      for (const e of ents) list.push(await entityStatus(tx, e, opts.today));
      return list;
    });
    out.push({ ...base, locked: null, entities });
  }
  // The example business goes last; it's practice data.
  return [...out.filter((o) => !o.example), ...out.filter((o) => o.example)];
}
