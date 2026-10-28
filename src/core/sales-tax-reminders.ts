import type pg from "pg";
import { withSystem, withTenant } from "../db/pool.js";
import type { Mailer } from "../app/mail.js";
import { EXAMPLE_ORG_NAME } from "../app/example.js";
import { addDays } from "../payroll/business-days.js";
import { REMIND_DAYS } from "../payroll/tax-deposits.js";
import { prepareSalesTaxReturn, returnPeriods, type FilingFrequency } from "./sales-tax-return.js";

// Emails reminding a business that its own sales and use tax return, or a
// quarterly prepayment, is coming due. TrailBook doesn't know when a return is
// filed, so there is one reminder per due date, a few days before it, and no
// overdue nagging. They go to the owners, admins and accountants of the
// organisation; a failed send is retried the next day.

const RECIPIENT_ROLES = ["owner", "admin", "accountant"];

const usd = (minor: bigint) => `$${(Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Due {
  /** Stored in tax_deposit_reminders.deposit_key, prefixed so it never meets a payroll deposit key. */
  key: string;
  line: string;
}

export interface SalesTaxReminderResult {
  sent: number;
  failed: number;
}

/** Sends the reminders due today. Safe to run more than once a day. */
export async function sendSalesTaxReminders(pool: pg.Pool, mailer: Mailer | undefined, today: string, appUrl?: string): Promise<SalesTaxReminderResult> {
  const result = { sent: 0, failed: 0 };
  if (!mailer) return result;
  const year = Number(today.slice(0, 4));
  const horizon = addDays(today, REMIND_DAYS);
  const entities = await withSystem(pool, async (tx) => (await tx.query(
    `SELECT e.id, e.org_id, e.legal_name, e.sales_tax_filing FROM entities e JOIN organizations o ON o.id = e.org_id
      WHERE e.sales_tax_filing IS NOT NULL AND o.name <> $1`,
    [EXAMPLE_ORG_NAME],
  )).rows);

  for (const ent of entities) {
    const due = await withTenant(pool, ent.org_id, async (tx) => {
      const periods = [...returnPeriods(ent.sales_tax_filing as FilingFrequency, year - 1, today), ...returnPeriods(ent.sales_tax_filing as FilingFrequency, year, today)];
      const sent = new Set((await tx.query(
        "SELECT deposit_key FROM tax_deposit_reminders WHERE entity_id = $1 AND deposit_key LIKE 'sales-tax:%'", [ent.id],
      )).rows.map((r) => r.deposit_key as string));
      const out: Due[] = [];
      for (const p of periods) {
        for (const [i, pre] of (p.prepayments ?? []).entries()) {
          const key = `sales-tax:${p.key}:prepayment-${i + 1}`;
          if (pre.dueDate >= today && pre.dueDate <= horizon && today > pre.to && !sent.has(key)) {
            out.push({ key, line: `- ${pre.month} prepayment for ${p.label}: due ${pre.dueDate}.` });
          }
        }
        const key = `sales-tax:${p.key}`;
        if (p.dueDate >= today && p.dueDate <= horizon && today > p.to && !sent.has(key)) {
          const r = await prepareSalesTaxReturn(tx, ent.id, p.key);
          const total = r.lines.find((l) => l.line === "Total tax")?.value;
          out.push({ key, line: `- Return for ${p.label}: due ${p.dueDate}${typeof total === "bigint" ? `, about ${usd(total)} of tax before any prepayments` : ""}.` });
        }
      }
      return out;
    });
    if (!due.length) continue;
    const recipients = await withSystem(pool, async (tx) => (await tx.query(
      `SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 AND m.role = ANY($2) ORDER BY u.email`,
      [ent.org_id, RECIPIENT_ROLES],
    )).rows.map((r) => r.email as string));
    if (!recipients.length) continue;

    const text = [
      `California sales and use tax for ${ent.legal_name}:`,
      "",
      ...due.map((d) => d.line),
      "",
      "Open the period on the Sales tax page for the worksheet, then file and pay in CDTFA online services. Payments made on the due date can miss the cutoff, so pay a day early.",
      ...(appUrl ? ["", `${appUrl.replace(/\/$/, "")}/#/e/${ent.id}/sales-tax`] : []),
    ].join("\n");
    try {
      for (const to of recipients) await mailer({ to, subject: `Sales tax due soon: ${ent.legal_name}`, text });
      await withTenant(pool, ent.org_id, async (tx) => {
        for (const d of due) {
          await tx.query(
            "INSERT INTO tax_deposit_reminders (org_id, entity_id, deposit_key, reminder) VALUES ($1, $2, $3, 'upcoming') ON CONFLICT DO NOTHING",
            [ent.org_id, ent.id, d.key],
          );
        }
      });
      result.sent += 1;
    } catch (err) {
      console.error(`sales tax reminder for entity ${ent.id} failed:`, (err as Error).message);
      result.failed += 1;
    }
  }
  return result;
}
