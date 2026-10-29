import type pg from "pg";
import { withSystem, withTenant } from "../db/pool.js";
import type { Mailer } from "../app/mail.js";
import { EXAMPLE_ORG_NAME } from "../app/example.js";
import { addDays } from "./business-days.js";
import { taxDeposits, type DepositView } from "./tax-deposits.js";

// Emails reminding a business of payroll tax deposits: once when a deposit
// comes within a few days of its due date, and once more if the due date
// passes unpaid. They go to the owners, admins and accountants of the
// organisation. Each reminder is sent once; a failed send is retried the
// next day.

const RECIPIENT_ROLES = ["owner", "admin", "accountant"];
const OVERDUE_WINDOW_DAYS = 14;

const usd = (minor: bigint) => `$${(Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function line(d: DepositView) {
  return `- ${d.what}, ${d.period}: ${usd(d.remainingMinor)} due ${d.dueDate}. Pay it through ${d.where}.`;
}

export interface ReminderResult {
  sent: number;
  failed: number;
}

/** Sends the reminders due today. Safe to run more than once a day. */
export async function sendDepositReminders(pool: pg.Pool, mailer: Mailer | undefined, today: string, appUrl?: string): Promise<ReminderResult> {
  const result = { sent: 0, failed: 0 };
  if (!mailer) return result;
  const year = Number(today.slice(0, 4));
  // Businesses with a posted pay run this year or last (December's taxes are due in January).
  const entities = await withSystem(pool, async (tx) => (await tx.query(
    `SELECT DISTINCT e.id, e.org_id, e.legal_name FROM entities e
       JOIN organizations o ON o.id = e.org_id
       JOIN pay_runs r ON r.entity_id = e.id AND r.status = 'posted' AND r.pay_date >= $1
      WHERE o.name <> $2`,
    [`${year - 1}-01-01`, EXAMPLE_ORG_NAME],
  )).rows);

  for (const ent of entities) {
    const due = await withTenant(pool, ent.org_id, async (tx) => {
      const deposits = [...await taxDeposits(tx, ent.id, year - 1, today), ...await taxDeposits(tx, ent.id, year, today)];
      const sent = new Set((await tx.query("SELECT deposit_key || ':' || reminder AS k FROM tax_deposit_reminders WHERE entity_id = $1", [ent.id])).rows.map((r) => r.k));
      return deposits.flatMap((d) => {
        // Only recent misses: older ones were most likely paid before the business recorded payments here.
        const reminder = d.status === "overdue" && d.dueDate >= addDays(today, -OVERDUE_WINDOW_DAYS) ? "overdue" : d.status === "due_soon" ? "upcoming" : null;
        return reminder && !sent.has(`${d.key}:${reminder}`) ? [{ d, reminder }] : [];
      });
    });
    if (!due.length) continue;
    const recipients = await withSystem(pool, async (tx) => (await tx.query(
      `SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 AND m.role = ANY($2) ORDER BY u.email`,
      [ent.org_id, RECIPIENT_ROLES],
    )).rows.map((r) => r.email as string));
    if (!recipients.length) continue;

    const overdue = due.filter((x) => x.reminder === "overdue").map((x) => x.d);
    const upcoming = due.filter((x) => x.reminder === "upcoming").map((x) => x.d);
    const text = [
      `Payroll tax deposits for ${ent.legal_name}:`,
      "",
      ...(overdue.length ? ["Past due (the IRS and state agencies charge penalties and interest on late deposits, so pay these as soon as you can):", ...overdue.map(line), ""] : []),
      ...(upcoming.length ? ["Coming up:", ...upcoming.map(line), ""] : []),
      "After you pay, record each deposit on the Payroll page so your books show it.",
      ...(appUrl ? ["", `${appUrl.replace(/\/$/, "")}/#/e/${ent.id}/payroll`] : []),
    ].join("\n");
    const subject = overdue.length ? `Payroll tax deposit past due: ${ent.legal_name}` : `Payroll tax deposit due soon: ${ent.legal_name}`;
    try {
      for (const to of recipients) await mailer({ to, subject, text });
      await withTenant(pool, ent.org_id, async (tx) => {
        for (const { d, reminder } of due) {
          await tx.query(
            "INSERT INTO tax_deposit_reminders (org_id, entity_id, deposit_key, reminder) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
            [ent.org_id, ent.id, d.key, reminder],
          );
        }
      });
      result.sent += 1;
    } catch (err) {
      console.error(`deposit reminder for entity ${ent.id} failed:`, (err as Error).message);
      result.failed += 1;
    }
  }
  return result;
}
