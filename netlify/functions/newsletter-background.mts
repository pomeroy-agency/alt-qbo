import { getConnectionString } from "@netlify/database";
import pg from "pg";
import { mailerFromEnv } from "../../src/app/mail.js";
import { pacificToday, weekday } from "../../src/payroll/business-days.js";
import { jobSecretMatches, newsletterFromEnv, type NewsletterTask } from "../../src/newsletter/config.js";
import { draftWeeklyIssue, refreshSent, runNewsWatch } from "../../src/newsletter/newsletter.js";
import { strictSsl } from "../../src/db/pool.js";

// The newsletter's worker, a background function so reading the feeds and
// waiting on Claude can take minutes. Started by the daily schedule
// (newsletter-daily) and by the Newsletter page, never by anyone else: the
// caller must present the job secret. It never sends to the list; it only
// writes drafts for a person to approve.

export default async (req: Request) => {
  if (req.method !== "POST" || !jobSecretMatches(req.headers.get("x-newsletter-job"))) return;
  const appUrl = process.env.APP_URL || process.env.URL;
  const cfg = newsletterFromEnv(process.env, mailerFromEnv(), appUrl);
  if (!cfg) return;
  const task = ((await req.json().catch(() => ({}))) as { task?: NewsletterTask }).task ?? "daily";
  const pool = new pg.Pool({ connectionString: strictSsl(getConnectionString()), max: 2 });
  try {
    if (task === "daily" || task === "watch") {
      const w = await runNewsWatch(pool, cfg);
      console.log(`newsletter watch: ${w.sourcesOk} sources read, ${w.sourcesFailed} failed, ${w.added} new items, ${w.writtenUp} written up`);
    }
    const today = pacificToday();
    // Mondays: the draft for Tuesday. The page can ask for one any day.
    if ((task === "daily" && weekday(today) === 1) || task === "draft" || task === "redraft") {
      const d = await draftWeeklyIssue(pool, cfg, today, { replace: task === "redraft" });
      console.log(`newsletter draft for ${d.sendOn}: ${d.created ? "written" : task === "redraft" ? "rewritten" : "already there"} (${d.draftedBy})`);
    }
    if (task === "daily") console.log(`newsletter: ${await refreshSent(pool, cfg)} issue(s) confirmed sent`);
  } catch (err) {
    console.error(`newsletter ${task} failed: ${(err as Error).message}`);
  } finally {
    await pool.end();
  }
};
