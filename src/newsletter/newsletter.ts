import type pg from "pg";
import { withSystem, type Tx } from "../db/pool.js";
import { appendAudit } from "../core/audit.js";
import { addDays, pacificToday, weekday } from "../payroll/business-days.js";
import type { Mailer } from "../app/mail.js";
import { Draft, SECTION_KINDS, type DraftInput, type Facts, type NewsletterAI } from "./ai.js";
import { createHash } from "node:crypto";
import type { Campaigns, DoubleOptIn } from "./brevo.js";
import { parseFeed, plainText, titleKey } from "./feeds.js";
import { renderHtml, renderText, wordCount, type IssueContent } from "./render.js";
import { scoreEntry } from "./score.js";
import { NOTABLE_SCORE, SOURCES, type NewsSource } from "./sources.js";

// The newsletter pipeline: watch the news, draft the week's issue, and, only
// after a person approves it, schedule it in Brevo. Nothing here sends to the
// list without that approval.

export interface NewsletterConfig {
  /** The operator's own organisation (Pomeroy Agency): the only one that sees the Newsletter page. */
  orgId: string;
  /** Claude. Without it, items are scored but not written up, and drafts are built from a template. */
  ai?: NewsletterAI;
  /** Brevo campaigns. Without it, issues can be drafted and edited but not tested or scheduled. */
  campaigns?: Campaigns;
  /** The Brevo list of people who signed up. Scheduling is refused until it's set. */
  listId?: number;
  /** The postal address every issue's footer must show. Scheduling is refused until it's set. */
  postalAddress?: string;
  /** Who hears that a draft is ready. */
  reviewerEmail?: string;
  mailer?: Mailer;
  appUrl?: string;
  fetcher?: typeof fetch;
  /** Starts Brevo's double opt-in for someone who asked to subscribe. Without it, sign-up is off. */
  doubleOptIn?: DoubleOptIn;
}

export class NewsletterError extends Error {
  constructor(message: string, public readonly status = 422) {
    super(message);
  }
}

const USER_AGENT = "TrailBookNewsBot/1.0 (+https://app.pomeroyagency.com)";
const MAX_ENTRIES_PER_SOURCE = 40;
const MAX_WRITEUPS_PER_RUN = 12;
const MAX_ARTICLE_CHARS = 30_000;
/** How long a story stays eligible for an issue. */
const FRESH_DAYS = 10;
const MAX_NEWS_PER_ISSUE = 5;
/** Issues go out on Tuesdays at 7 a.m. Pacific. */
const SEND_WEEKDAY = 2;
const SEND_HOUR = 7;

/** Only public web addresses: never a bare host name or an IP address, so a feed can't point the job at an internal service. */
function fetchable(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname;
    return h.includes(".") && !/^[\d.]+$/.test(h) && !h.includes(":") && !h.endsWith(".internal") && !h.endsWith(".local");
  } catch {
    return false;
  }
}

async function get(fetcher: typeof fetch, url: string, maxChars: number, timeoutMs = 15_000): Promise<string> {
  if (!fetchable(url)) throw new Error("not a public web address");
  const res = await fetcher(url, { headers: { "user-agent": USER_AGENT, accept: "*/*" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  return body.length > maxChars ? body.slice(0, maxChars) : body;
}

// ------------------------------------------------------------------ watch

export interface WatchResult {
  sourcesOk: number;
  sourcesFailed: number;
  added: number;
  writtenUp: number;
}

/** Reads every source, keeps new stories with their score, and has Claude write up the notable ones. */
export async function runNewsWatch(pool: pg.Pool, cfg: NewsletterConfig, now = new Date(), sources: readonly NewsSource[] = SOURCES): Promise<WatchResult> {
  const fetcher = cfg.fetcher ?? fetch;
  const result: WatchResult = { sourcesOk: 0, sourcesFailed: 0, added: 0, writtenUp: 0 };
  for (const source of sources) {
    let entries;
    try {
      entries = parseFeed(await get(fetcher, source.url, 3_000_000), source.format).slice(0, MAX_ENTRIES_PER_SOURCE);
    } catch (err) {
      result.sourcesFailed++;
      await withSystem(pool, (tx) => tx.query(
        `INSERT INTO news_sources_status (source_id, last_checked_at, last_error) VALUES ($1, $2, $3)
         ON CONFLICT (source_id) DO UPDATE SET last_checked_at = $2, last_error = $3`,
        [source.id, now, String((err as Error).message).slice(0, 300)],
      ));
      continue;
    }
    result.sourcesOk++;
    await withSystem(pool, async (tx) => {
      for (const e of entries) {
        const key = titleKey(e.title);
        // The same story, already found from another feed in the last three weeks.
        const dup = await tx.query("SELECT 1 FROM news_items WHERE title_key = $1 AND found_at > $2::timestamptz - interval '21 days'", [key, now]);
        if (dup.rows[0]) continue;
        const { score, reasons } = scoreEntry(e, source, now);
        const ins = await tx.query(
          `INSERT INTO news_items (source_id, url, title, title_key, published_at, found_at, excerpt, score, reasons)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (url) DO NOTHING`,
          [source.id, e.url, e.title, key, e.publishedAt, now, e.excerpt, score, reasons],
        );
        result.added += ins.rowCount ?? 0;
      }
      await tx.query(
        `INSERT INTO news_sources_status (source_id, last_checked_at, last_ok_at, last_error, items_last_seen) VALUES ($1, $2, $2, NULL, $3)
         ON CONFLICT (source_id) DO UPDATE SET last_checked_at = $2, last_ok_at = $2, last_error = NULL, items_last_seen = $3`,
        [source.id, now, entries.length],
      );
    });
  }
  if (cfg.ai) result.writtenUp = await writeUpNotable(pool, cfg.ai, fetcher, now, sources);
  return result;
}

async function writeUpNotable(pool: pg.Pool, ai: NewsletterAI, fetcher: typeof fetch, now: Date, sources: readonly NewsSource[]): Promise<number> {
  const { rows } = await withSystem(pool, (tx) => tx.query(
    `SELECT id, source_id, url, title, published_at, excerpt FROM news_items
      WHERE status = 'new' AND facts IS NULL AND facts_error IS NULL AND score >= $1 AND found_at > $2::timestamptz - make_interval(days => $3)
      ORDER BY score DESC, found_at DESC LIMIT $4`,
    [NOTABLE_SCORE, now, FRESH_DAYS, MAX_WRITEUPS_PER_RUN],
  ));
  let done = 0;
  for (const it of rows) {
    let articleText: string | undefined;
    try {
      articleText = plainText(await get(fetcher, it.url, 2_000_000, 10_000), MAX_ARTICLE_CHARS) || undefined;
    } catch {
      // Paywalls, redirects and blocked bots are common: the excerpt is enough to judge, and the write-up says less.
    }
    try {
      const facts = await ai.extractFacts({
        title: it.title, url: it.url, excerpt: it.excerpt, articleText,
        sourceName: sources.find((s) => s.id === it.source_id)?.name ?? it.source_id,
        publishedAt: it.published_at ? new Date(it.published_at).toISOString().slice(0, 10) : null,
      });
      await withSystem(pool, (tx) => facts
        ? tx.query(`UPDATE news_items SET facts = $2, facts_at = now(), status = CASE WHEN $3 THEN status ELSE 'dismissed' END WHERE id = $1`, [it.id, facts, facts.notable])
        : tx.query("UPDATE news_items SET facts_error = 'Claude declined or ran out of room' WHERE id = $1", [it.id]));
      if (facts) done++;
    } catch (err) {
      await withSystem(pool, (tx) => tx.query("UPDATE news_items SET facts_error = $2 WHERE id = $1", [it.id, String((err as Error).message).slice(0, 300)]));
    }
  }
  return done;
}

// ------------------------------------------------------------------ dates

/** The next Tuesday after a date (a draft written on Monday goes out the next day). */
export function nextSendOn(today: string): string {
  const ahead = (SEND_WEEKDAY - weekday(today) + 7) % 7 || 7;
  return addDays(today, ahead);
}

/** 7 a.m. Pacific on a date, as an instant, through daylight saving changes. */
export function pacificSendTime(date: string, hour = SEND_HOUR): Date {
  for (const offset of [7, 8]) {
    const t = new Date(`${date}T${String(hour + offset).padStart(2, "0")}:00:00Z`);
    const local = t.toLocaleString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hour12: false });
    if (Number(local) === hour) return t;
  }
  throw new Error(`no ${hour}:00 in Pacific time on ${date}`);
}

// ------------------------------------------------------------------ drafting

interface NoteRow { id: string; kind: "update" | "tip"; title: string; body: string; link: string | null }

/** A plain draft from the write-ups and notes, used when Claude isn't configured or doesn't answer. */
export function templateDraft(input: DraftInput): Draft {
  const news = input.news.map((n) => ({
    kind: "news" as const, heading: n.facts.headline,
    body: [n.facts.summary, `Who it affects: ${n.facts.whoItAffects}`, `What to do: ${n.facts.whatToDo}`].join("\n\n"),
    link: n.url, itemId: n.id, noteId: null,
  }));
  const notes = input.notes.map((n) => ({
    kind: n.kind === "update" ? "trailbook" as const : "tip" as const, heading: n.title, body: n.body, link: n.link, itemId: null, noteId: n.id,
  }));
  return {
    subject: news[0] ? `TrailBook News: ${news[0].heading}`.slice(0, 70) : "TrailBook News for the week",
    preheader: news.length ? `${news.length} change${news.length === 1 ? "" : "s"} worth knowing about this week` : "This week's notes from TrailBook",
    intro: news.length ? "Here's what changed this week for small businesses, and what to do about it." : "A quiet week for rule changes. Here's what's new with us.",
    sections: [...news, ...notes.filter((s) => s.kind === "trailbook"), ...notes.filter((s) => s.kind === "tip").slice(0, 1)],
    closing: "Reply to this email any time: it comes straight to me.",
  };
}

const MAX = { subject: 150, preheader: 250, intro: 3000, heading: 300, body: 6000, closing: 2000, sections: 12 };

/** Checks an issue's content from Claude or from the edit form, and keeps only what the page and the email can show. */
export function cleanContent(raw: unknown): { subject: string; preheader: string; content: IssueContent } {
  const parsed = Draft.safeParse(raw);
  if (!parsed.success) throw new NewsletterError("the issue is missing a subject, intro, sections or closing", 400);
  const d = parsed.data;
  const need = (v: string, field: string, max: number) => {
    const t = v.trim();
    if (!t) throw new NewsletterError(`${field} can't be empty`, 400);
    if (t.length > max) throw new NewsletterError(`${field} is too long (at most ${max} characters)`, 400);
    return t;
  };
  if (d.sections.length > MAX.sections) throw new NewsletterError(`at most ${MAX.sections} sections`, 400);
  return {
    subject: need(d.subject, "The subject", MAX.subject),
    preheader: d.preheader.trim().slice(0, MAX.preheader),
    content: {
      intro: need(d.intro, "The intro", MAX.intro),
      closing: need(d.closing, "The closing", MAX.closing),
      sections: d.sections.map((s, i) => ({
        kind: SECTION_KINDS.includes(s.kind) ? s.kind : "news",
        heading: need(s.heading, `Section ${i + 1}'s heading`, MAX.heading),
        body: need(s.body, `Section ${i + 1}'s text`, MAX.body),
        link: s.link?.trim() || null, itemId: s.itemId || null, noteId: s.noteId || null,
      })),
    },
  };
}

export interface DraftResult { issueId: string; sendOn: string; created: boolean; draftedBy: "claude" | "template" }

/**
 * Writes the draft for the coming Tuesday. An existing draft is left alone
 * unless replace is set (the page's "Write it again"); a scheduled or sent
 * issue is never replaced.
 */
export async function draftWeeklyIssue(pool: pg.Pool, cfg: NewsletterConfig, today = pacificToday(), opts: { replace?: boolean } = {}): Promise<DraftResult> {
  const sendOn = nextSendOn(today);
  const existing = await withSystem(pool, (tx) => tx.query("SELECT id, status, drafted_by FROM newsletter_issues WHERE send_on = $1", [sendOn]));
  const ex = existing.rows[0];
  if (ex && (!opts.replace || ex.status !== "draft")) {
    if (opts.replace) throw new NewsletterError(`the issue for ${sendOn} is ${ex.status}, so it can't be written again`, 409);
    return { issueId: ex.id, sendOn, created: false, draftedBy: ex.drafted_by };
  }
  const input = await withSystem(pool, async (tx): Promise<DraftInput> => {
    const news = (await tx.query(
      `SELECT i.id, i.url, i.source_id, i.facts FROM news_items i
        WHERE i.status = 'new' AND (i.facts->>'notable')::boolean AND i.score >= $1 AND i.found_at > now() - make_interval(days => $2)
        ORDER BY i.score DESC, i.found_at DESC LIMIT $3`,
      [NOTABLE_SCORE, FRESH_DAYS, MAX_NEWS_PER_ISSUE],
    )).rows;
    const notes = (await tx.query<NoteRow>(
      `SELECT n.id, n.kind, n.title, n.body, n.link FROM newsletter_notes n
        WHERE n.removed_at IS NULL AND (n.issue_id IS NULL OR n.issue_id IN (SELECT id FROM newsletter_issues WHERE status IN ('draft', 'discarded')))
        ORDER BY n.created_at`,
    )).rows;
    const recent = (await tx.query("SELECT subject FROM newsletter_issues WHERE send_on < $1 ORDER BY send_on DESC LIMIT 8", [sendOn])).rows;
    return {
      sendOn,
      news: news.map((n) => ({ id: n.id, url: n.url, sourceName: SOURCES.find((s) => s.id === n.source_id)?.name ?? n.source_id, facts: n.facts as Facts })),
      notes,
      recentSubjects: recent.map((r) => r.subject),
    };
  });
  let draft: Draft | null = null;
  let draftedBy: "claude" | "template" = "template";
  if (cfg.ai) {
    try {
      draft = await cfg.ai.draftIssue(input);
      if (draft) draftedBy = "claude";
    } catch (err) {
      console.error(`newsletter draft: Claude failed, using the template: ${(err as Error).message}`);
    }
  }
  const clean = cleanContent(draft ?? templateDraft(input));
  // Only ids that were offered can be linked, whatever came back.
  const itemIds = new Set(input.news.map((n) => n.id));
  const noteIds = new Set(input.notes.map((n) => n.id));
  for (const s of clean.content.sections) {
    if (s.itemId && !itemIds.has(s.itemId)) s.itemId = null;
    if (s.noteId && !noteIds.has(s.noteId)) s.noteId = null;
  }
  const issueId = await withSystem(pool, async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO newsletter_issues (send_on, subject, preheader, content, drafted_by, updated_by) VALUES ($1, $2, $3, $4, $5, 'system:newsletter')
       ON CONFLICT (send_on) DO UPDATE SET subject = $2, preheader = $3, content = $4, drafted_by = $5, updated_at = now(), updated_by = 'system:newsletter'
         WHERE newsletter_issues.status = 'draft'
       RETURNING id`,
      [sendOn, clean.subject, clean.preheader, clean.content, draftedBy],
    );
    if (!rows[0]) throw new NewsletterError(`the issue for ${sendOn} was approved meanwhile`, 409);
    return rows[0].id as string;
  });
  if (cfg.mailer && cfg.reviewerEmail && !ex) {
    await cfg.mailer({
      to: cfg.reviewerEmail,
      subject: `TrailBook News for ${sendOn} is ready for review`,
      text: `The draft for ${sendOn} is ready: "${clean.subject}".\n\nRead it, edit it, send yourself a test and approve it on the Newsletter page${cfg.appUrl ? `: ${cfg.appUrl}/#/newsletter/${issueId}` : ""}.\n\nNothing is sent to subscribers until you approve it.`,
    }).catch((err) => console.error(`newsletter draft: review email failed: ${(err as Error).message}`));
  }
  return { issueId, sendOn, created: !ex, draftedBy };
}

// ------------------------------------------------------------------ review page

function renderOptions(issue: { subject: string; preheader: string; send_on: string }, cfg: NewsletterConfig) {
  return { subject: issue.subject, preheader: issue.preheader, sendOn: issue.send_on, postalAddress: cfg.postalAddress || "[postal address not set]", appUrl: cfg.appUrl };
}

export function setupStatus(cfg: NewsletterConfig) {
  return { claude: Boolean(cfg.ai), brevo: Boolean(cfg.campaigns), listId: cfg.listId ?? null, postalAddress: cfg.postalAddress ?? null, reviewerEmail: cfg.reviewerEmail ?? null };
}

export async function newsletterOverview(pool: pg.Pool, cfg: NewsletterConfig) {
  return withSystem(pool, async (tx) => {
    const issues = (await tx.query(
      `SELECT id, send_on, status, subject, drafted_by, updated_at, approved_by, send_at, sent_at, last_test_at
         FROM newsletter_issues WHERE status <> 'discarded' ORDER BY send_on DESC LIMIT 12`,
    )).rows;
    const items = (await tx.query(
      `SELECT i.id, i.source_id, i.url, i.title, i.published_at, i.found_at, i.score, i.reasons, i.facts, i.facts_error, i.status, s.send_on AS used_in
         FROM news_items i LEFT JOIN newsletter_issues s ON s.id = i.issue_id
        WHERE i.found_at > now() - interval '14 days'
        ORDER BY (i.facts IS NOT NULL AND i.status = 'new') DESC, i.score DESC, i.found_at DESC LIMIT 80`,
    )).rows;
    const notes = (await tx.query(
      `SELECT n.id, n.kind, n.title, n.body, n.link, n.created_by, n.created_at, s.send_on AS used_in, s.status AS used_status
         FROM newsletter_notes n LEFT JOIN newsletter_issues s ON s.id = n.issue_id
        WHERE n.removed_at IS NULL AND (n.issue_id IS NULL OR s.status IN ('draft', 'discarded'))
        ORDER BY n.created_at DESC`,
    )).rows;
    const status = new Map((await tx.query("SELECT * FROM news_sources_status")).rows.map((r) => [r.source_id, r]));
    const sources = SOURCES.map((s) => {
      const st = status.get(s.id);
      return { id: s.id, name: s.name, url: s.url, weight: s.weight, lastCheckedAt: st?.last_checked_at ?? null, lastOkAt: st?.last_ok_at ?? null, lastError: st?.last_error ?? null, itemsLastSeen: st?.items_last_seen ?? 0 };
    });
    return { setup: setupStatus(cfg), issues, items: items.map((i) => ({ ...i, sourceName: SOURCES.find((s) => s.id === i.source_id)?.name ?? i.source_id })), notes, sources, notableScore: NOTABLE_SCORE };
  });
}

async function loadIssue(tx: Tx, id: string, lock = false) {
  const { rows } = await tx.query(`SELECT * FROM newsletter_issues WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id]);
  if (!rows[0]) throw new NewsletterError("issue not found", 404);
  return rows[0];
}

export async function getIssue(pool: pg.Pool, cfg: NewsletterConfig, id: string) {
  const issue = await withSystem(pool, (tx) => loadIssue(tx, id));
  const o = renderOptions(issue, cfg);
  return {
    issue,
    html: renderHtml(issue.content, o),
    text: renderText(issue.content, o),
    words: wordCount(issue.content),
    // A test of the version being approved: sent after the last edit.
    testedCurrent: Boolean(issue.last_test_at && issue.last_test_at >= issue.updated_at),
    setup: setupStatus(cfg),
  };
}

export async function saveIssue(pool: pg.Pool, id: string, raw: unknown, actor: string) {
  const clean = cleanContent(raw);
  return withSystem(pool, async (tx) => {
    const issue = await loadIssue(tx, id, true);
    if (issue.status !== "draft") throw new NewsletterError(`this issue is ${issue.status}; cancel the send first to edit it`, 409);
    await tx.query(
      "UPDATE newsletter_issues SET subject = $2, preheader = $3, content = $4, updated_at = now(), updated_by = $5 WHERE id = $1",
      [id, clean.subject, clean.preheader, clean.content, actor],
    );
  });
}

export async function discardIssue(pool: pg.Pool, id: string, actor: string) {
  await withSystem(pool, async (tx) => {
    const issue = await loadIssue(tx, id, true);
    if (issue.status !== "draft") throw new NewsletterError(`only a draft can be set aside; this one is ${issue.status}`, 409);
    await tx.query("UPDATE newsletter_issues SET status = 'discarded', updated_at = now(), updated_by = $2 WHERE id = $1", [id, actor]);
  });
}

function campaignContent(issue: any, cfg: NewsletterConfig) {
  return { name: `TrailBook News ${issue.send_on}`, subject: issue.subject, previewText: issue.preheader, htmlContent: renderHtml(issue.content, renderOptions(issue, cfg)) };
}

/** Puts the current version into the Brevo campaign (making the campaign the first time), as a draft with no recipients or send time. */
async function syncCampaign(tx: Tx, issue: any, cfg: NewsletterConfig): Promise<number> {
  if (!cfg.campaigns) throw new NewsletterError("Brevo isn't set up: add BREVO_API_KEY and NEWSLETTER_SENDER_ID in Netlify", 409);
  if (issue.brevo_campaign_id) {
    await cfg.campaigns.update(Number(issue.brevo_campaign_id), campaignContent(issue, cfg));
    return Number(issue.brevo_campaign_id);
  }
  const id = await cfg.campaigns.create(campaignContent(issue, cfg));
  await tx.query("UPDATE newsletter_issues SET brevo_campaign_id = $2 WHERE id = $1", [issue.id, id]);
  return id;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sends a test copy of the current version, only to the addresses given (never the list). */
export async function sendTest(pool: pg.Pool, cfg: NewsletterConfig, id: string, to: string[], actor: string) {
  const list = [...new Set(to.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (!list.length || list.length > 5 || !list.every((t) => EMAIL.test(t))) throw new NewsletterError("give one to five email addresses for the test", 400);
  return withSystem(pool, async (tx) => {
    const issue = await loadIssue(tx, id, true);
    if (issue.status !== "draft") throw new NewsletterError(`this issue is ${issue.status}`, 409);
    const campaignId = await syncCampaign(tx, issue, cfg);
    await cfg.campaigns!.sendTest(campaignId, list);
    await tx.query("UPDATE newsletter_issues SET last_test_at = now(), last_test_to = $2 WHERE id = $1", [id, list.join(", ")]);
    await appendAudit(tx, { orgId: cfg.orgId, actor, action: "newsletter.test_sent", objectType: "newsletter_issue", objectId: id, after: { to: list, campaignId } });
  });
}

/**
 * Approves the issue and schedules it in Brevo for 7 a.m. Pacific on its
 * Tuesday (or fifteen minutes from now, if that has passed). Refused until
 * Brevo, the list and the postal address are set, and until a test of this
 * exact version has gone out.
 */
export async function approveIssue(pool: pg.Pool, cfg: NewsletterConfig, id: string, actor: string, now = new Date()) {
  if (!cfg.campaigns) throw new NewsletterError("Brevo isn't set up: add BREVO_API_KEY and NEWSLETTER_SENDER_ID in Netlify", 409);
  if (!cfg.listId) throw new NewsletterError("no subscriber list is set: add NEWSLETTER_LIST_ID in Netlify", 409);
  if (!cfg.postalAddress) throw new NewsletterError("the footer needs a postal address: add NEWSLETTER_POSTAL_ADDRESS in Netlify", 409);
  return withSystem(pool, async (tx) => {
    const issue = await loadIssue(tx, id, true);
    if (issue.status !== "draft") throw new NewsletterError(`this issue is ${issue.status}`, 409);
    if (!issue.last_test_at || issue.last_test_at < issue.updated_at) throw new NewsletterError("send yourself a test of this version first", 409);
    let sendAt = pacificSendTime(issue.send_on);
    const earliest = new Date(now.getTime() + 15 * 60_000);
    if (sendAt < earliest) sendAt = earliest;
    const campaignId = await syncCampaign(tx, issue, cfg);
    await cfg.campaigns!.schedule(campaignId, cfg.listId!, sendAt);
    await tx.query(
      "UPDATE newsletter_issues SET status = 'scheduled', approved_by = $2, approved_at = now(), send_at = $3 WHERE id = $1",
      [id, actor, sendAt],
    );
    const sections: IssueContent["sections"] = issue.content.sections;
    const itemIds = sections.map((s) => s.itemId).filter(Boolean);
    const noteIds = sections.map((s) => s.noteId).filter(Boolean);
    await tx.query("UPDATE news_items SET status = 'used', issue_id = $1 WHERE id = ANY($2::uuid[]) AND status = 'new'", [id, itemIds]);
    await tx.query("UPDATE newsletter_notes SET issue_id = $1 WHERE id = ANY($2::uuid[])", [id, noteIds]);
    await appendAudit(tx, {
      orgId: cfg.orgId, actor, action: "newsletter.scheduled", objectType: "newsletter_issue", objectId: id,
      after: { subject: issue.subject, sendAt: sendAt.toISOString(), campaignId, listId: cfg.listId },
    });
    return { sendAt: sendAt.toISOString() };
  });
}

/** Takes a scheduled issue off the schedule before it goes out, back to a draft. */
export async function cancelIssue(pool: pg.Pool, cfg: NewsletterConfig, id: string, actor: string, now = new Date()) {
  return withSystem(pool, async (tx) => {
    const issue = await loadIssue(tx, id, true);
    if (issue.status !== "scheduled") throw new NewsletterError(`this issue is ${issue.status}, not scheduled`, 409);
    if (issue.send_at <= now) throw new NewsletterError("its send time has passed; check Brevo", 409);
    await cfg.campaigns?.suspend(Number(issue.brevo_campaign_id));
    await tx.query(
      `UPDATE newsletter_issues SET status = 'draft', approved_by = NULL, approved_at = NULL, send_at = NULL, updated_at = now(), updated_by = $2 WHERE id = $1`,
      [id, actor],
    );
    await tx.query("UPDATE news_items SET status = 'new', issue_id = NULL WHERE issue_id = $1", [id]);
    await appendAudit(tx, { orgId: cfg.orgId, actor, action: "newsletter.cancelled", objectType: "newsletter_issue", objectId: id, before: { sendAt: issue.send_at } });
  });
}

/** Marks scheduled issues sent once Brevo says so. */
export async function refreshSent(pool: pg.Pool, cfg: NewsletterConfig, now = new Date()): Promise<number> {
  if (!cfg.campaigns) return 0;
  const due = (await withSystem(pool, (tx) => tx.query("SELECT id, brevo_campaign_id FROM newsletter_issues WHERE status = 'scheduled' AND send_at <= $1", [now]))).rows;
  let sent = 0;
  for (const d of due) {
    try {
      if ((await cfg.campaigns.status(Number(d.brevo_campaign_id))) !== "sent") continue;
      await withSystem(pool, (tx) => tx.query("UPDATE newsletter_issues SET status = 'sent', sent_at = now() WHERE id = $1 AND status = 'scheduled'", [d.id]));
      sent++;
    } catch (err) {
      console.error(`newsletter: couldn't check campaign ${d.brevo_campaign_id}: ${(err as Error).message}`);
    }
  }
  return sent;
}

// ------------------------------------------------------------------ items and notes

export async function setItemStatus(pool: pg.Pool, id: string, status: "new" | "dismissed") {
  const r = await withSystem(pool, (tx) => tx.query("UPDATE news_items SET status = $2 WHERE id = $1 AND status <> 'used'", [id, status]));
  if (!r.rowCount) throw new NewsletterError("item not found, or it's already in a scheduled issue", 404);
}

/** Lets a failed write-up be tried again on the next run. */
export async function retryItem(pool: pg.Pool, id: string) {
  await withSystem(pool, (tx) => tx.query("UPDATE news_items SET facts_error = NULL WHERE id = $1 AND facts IS NULL", [id]));
}

export async function addNote(pool: pg.Pool, input: { kind: string; title: string; body: string; link?: string | null }, actor: string) {
  if (input.kind !== "update" && input.kind !== "tip") throw new NewsletterError("a note is an update or a tip", 400);
  const title = input.title?.trim(), body = input.body?.trim();
  if (!title || title.length > 200) throw new NewsletterError("a note needs a title of up to 200 characters", 400);
  if (!body || body.length > 4000) throw new NewsletterError("a note needs text of up to 4,000 characters", 400);
  let link: string | null = null;
  if (input.link?.trim()) {
    try {
      const u = new URL(input.link.trim());
      if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error();
      link = u.toString();
    } catch {
      throw new NewsletterError("the link must be a web address", 400);
    }
  }
  const { rows } = await withSystem(pool, (tx) => tx.query(
    "INSERT INTO newsletter_notes (kind, title, body, link, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [input.kind, title, body, link, actor],
  ));
  return rows[0].id as string;
}

export async function removeNote(pool: pg.Pool, id: string) {
  await withSystem(pool, (tx) => tx.query("UPDATE newsletter_notes SET removed_at = now() WHERE id = $1 AND removed_at IS NULL", [id]));
}

// ------------------------------------------------------------------ sign-up

/**
 * Someone asked for TrailBook News: Brevo emails them a confirmation link and
 * adds them to the list only when they click it. An address gets at most one
 * confirmation an hour, so the form can't be used to flood an inbox; the
 * answer is the same either way, so it doesn't reveal who has asked before.
 */
export async function requestSubscription(pool: pg.Pool, cfg: NewsletterConfig, rawEmail: unknown, source: "website" | "app_signup"): Promise<void> {
  if (!cfg.doubleOptIn) throw new NewsletterError("newsletter sign-up isn't open yet", 503);
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!EMAIL.test(email) || email.length > 254) throw new NewsletterError("enter a valid email address", 400);
  const hash = createHash("sha256").update(email).digest("hex");
  const fresh = await withSystem(pool, async (tx) => {
    const recent = await tx.query("SELECT 1 FROM newsletter_signups WHERE email_hash = $1 AND requested_at > now() - interval '1 hour'", [hash]);
    if (recent.rows[0]) return false;
    await tx.query("INSERT INTO newsletter_signups (email_hash, source) VALUES ($1, $2)", [hash, source]);
    return true;
  });
  if (fresh) await cfg.doubleOptIn(email);
}
