// Brevo's email campaign API, for the newsletter only. Transactional email
// (sign-in links, reminders) still goes over SMTP; see src/app/mail.ts.
//
// A campaign is created as a draft. It is only given a send time when a
// person approves the issue, and Brevo then sends it to the newsletter list,
// with Brevo's own unsubscribe handling.

export interface CampaignContent {
  name: string;
  subject: string;
  previewText: string;
  htmlContent: string;
}

export type CampaignStatus = "draft" | "sent" | "archive" | "queued" | "suspended" | "in_process" | "inReview" | string;

export interface Campaigns {
  create(c: CampaignContent): Promise<number>;
  update(id: number, c: CampaignContent): Promise<void>;
  /** Sends a test copy to these addresses (Brevo only sends tests to addresses on the account's test list). */
  sendTest(id: number, to: string[]): Promise<void>;
  /** Gives the campaign the list and a send time. */
  schedule(id: number, listId: number, at: Date): Promise<void>;
  /** Takes a scheduled campaign back off the schedule. */
  suspend(id: number): Promise<void>;
  status(id: number): Promise<CampaignStatus>;
}

export class BrevoError extends Error {}

export function brevoCampaigns(apiKey: string, senderId: number, replyTo?: string, fetcher: typeof fetch = fetch): Campaigns {
  async function call(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetcher(`https://api.brevo.com/v3${path}`, {
      method,
      headers: { "api-key": apiKey, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text;
      try { message = JSON.parse(text).message ?? text; } catch {}
      throw new BrevoError(`Brevo said ${res.status}: ${message.slice(0, 300)}`);
    }
    return text ? JSON.parse(text) : null;
  }
  const fields = (c: CampaignContent) => ({
    name: c.name, subject: c.subject, previewText: c.previewText, htmlContent: c.htmlContent,
    sender: { id: senderId }, ...(replyTo ? { replyTo } : {}), tag: "trailbook-newsletter",
  });
  return {
    async create(c) {
      return Number((await call("POST", "/emailCampaigns", fields(c))).id);
    },
    async update(id, c) {
      await call("PUT", `/emailCampaigns/${id}`, fields(c));
    },
    async sendTest(id, to) {
      await call("POST", `/emailCampaigns/${id}/sendTest`, { emailTo: to });
    },
    async schedule(id, listId, at) {
      await call("PUT", `/emailCampaigns/${id}`, { recipients: { listIds: [listId] }, scheduledAt: at.toISOString() });
    },
    async suspend(id) {
      await call("PUT", `/emailCampaigns/${id}/status`, { status: "suspended" });
    },
    async status(id) {
      return (await call("GET", `/emailCampaigns/${id}?excludeHtmlContent=true`)).status;
    },
  };
}
