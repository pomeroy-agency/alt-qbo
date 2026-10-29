import { createHmac, timingSafeEqual } from "node:crypto";
import type { Mailer } from "../app/mail.js";
import { claudeNewsletterAI } from "./ai.js";
import { brevoCampaigns, brevoDoubleOptIn } from "./brevo.js";
import type { NewsletterConfig } from "./newsletter.js";

/**
 * The newsletter's settings from the environment. It is off (no page, no
 * jobs) until NEWSLETTER_ORG_ID names the operator's own organisation.
 *
 *   ANTHROPIC_API_KEY          Claude writes up the news and drafts each issue.
 *   BREVO_API_KEY              Brevo campaigns (a v3 API key, not the SMTP key).
 *   NEWSLETTER_SENDER_ID       the Brevo sender the issue comes from.
 *   NEWSLETTER_LIST_ID         the Brevo list of people who signed up.
 *   NEWSLETTER_POSTAL_ADDRESS  the address in every footer.
 *   NEWSLETTER_REVIEWER_EMAIL  who hears a draft is ready (default OPS_EMAIL).
 *   NEWSLETTER_REPLY_TO        where replies go (default: the sender).
 *   NEWSLETTER_OPTIN_TEMPLATE_ID  the Brevo double opt-in email (tagged "optin"); turns on sign-up.
 */
export function newsletterFromEnv(env: Record<string, string | undefined> = process.env, mailer?: Mailer, appUrl?: string): NewsletterConfig | undefined {
  const orgId = env.NEWSLETTER_ORG_ID?.trim();
  if (!orgId) return undefined;
  const senderId = Number(env.NEWSLETTER_SENDER_ID);
  const listId = Number(env.NEWSLETTER_LIST_ID);
  const optinTemplate = Number(env.NEWSLETTER_OPTIN_TEMPLATE_ID);
  const site = (appUrl || "https://app.pomeroyagency.com").replace(/\/+$/, "");
  return {
    orgId,
    ai: env.ANTHROPIC_API_KEY ? claudeNewsletterAI(env.ANTHROPIC_API_KEY.trim()) : undefined,
    campaigns: env.BREVO_API_KEY && senderId > 0 ? brevoCampaigns(env.BREVO_API_KEY.trim(), senderId, env.NEWSLETTER_REPLY_TO?.trim() || undefined) : undefined,
    listId: listId > 0 ? listId : undefined,
    postalAddress: env.NEWSLETTER_POSTAL_ADDRESS?.trim() || undefined,
    reviewerEmail: env.NEWSLETTER_REVIEWER_EMAIL?.trim() || env.OPS_EMAIL?.trim() || undefined,
    mailer,
    appUrl,
    doubleOptIn: env.BREVO_API_KEY && listId > 0 && optinTemplate > 0
      ? brevoDoubleOptIn(env.BREVO_API_KEY.trim(), listId, optinTemplate, `${site}/subscribe-done.html`) : undefined,
  };
}

/**
 * The secret the scheduled job and the Newsletter page use to start the
 * background worker, derived from PII_KEY so there's nothing else to set.
 */
export function jobSecret(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.PII_KEY ? createHmac("sha256", env.PII_KEY).update("trailbook:newsletter-job").digest("hex") : undefined;
}

export function jobSecretMatches(given: string | null, env: Record<string, string | undefined> = process.env): boolean {
  const want = jobSecret(env);
  if (!want || !given) return false;
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type NewsletterTask = "watch" | "draft" | "redraft" | "daily";

/** Starts the background worker (Netlify gives background functions 15 minutes; Claude can take a few). */
export async function startNewsletterJob(baseUrl: string, task: NewsletterTask, env: Record<string, string | undefined> = process.env): Promise<void> {
  const secret = jobSecret(env);
  if (!secret) throw new Error("PII_KEY is not set, so the newsletter job can't be started");
  const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/.netlify/functions/newsletter-background`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-newsletter-job": secret },
    body: JSON.stringify({ task }),
  });
  // A background function answers 202 at once and carries on.
  if (res.status !== 202 && !res.ok) throw new Error(`the newsletter job didn't start (HTTP ${res.status})`);
}
