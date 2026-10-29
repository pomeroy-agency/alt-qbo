import type { Draft } from "./ai.js";

// The email itself: simple tables and inline styles, which every mail client
// shows the same way. Brevo replaces {{ unsubscribe }} with each reader's own
// link, so the footer always has a working way out, plus the postal address
// U.S. (CAN-SPAM) and Canadian (CASL) law both ask for.

export type IssueContent = Pick<Draft, "intro" | "sections" | "closing">;

export interface RenderOptions {
  subject: string;
  preheader: string;
  sendOn: string;
  postalAddress: string;
  appUrl?: string;
}

const BRAND = "#1f5f4a";
const SECTION_LABEL = { news: "This week's news", trailbook: "New in TrailBook", tip: "Tip of the week" } as const;

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function paragraphs(body: string): string {
  return body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px;font-size:16px;line-height:1.55;color:#1d2a24">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

function safeLink(link: string | null): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function longDate(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function renderHtml(c: IssueContent, o: RenderOptions): string {
  let lastKind = "";
  const sections = c.sections.map((s) => {
    const label = s.kind !== lastKind ? `<p style="margin:28px 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${BRAND};font-weight:bold">${SECTION_LABEL[s.kind]}</p>` : "";
    lastKind = s.kind;
    const link = safeLink(s.link);
    return `${label}<h2 style="margin:0 0 10px;font-size:20px;line-height:1.3;color:#1d2a24">${esc(s.heading)}</h2>${paragraphs(s.body)}${link ? `<p style="margin:0 0 20px;font-size:14px"><a href="${esc(link)}" style="color:${BRAND}">Read the source</a></p>` : ""}`;
  }).join("");
  const app = o.appUrl ? `<a href="${esc(o.appUrl)}" style="color:${BRAND}">TrailBook</a>` : "TrailBook";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(o.subject)}</title></head>
<body style="margin:0;padding:0;background:#f3f6f4">
<div style="display:none;max-height:0;overflow:hidden">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f6f4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;font-family:Georgia,'Times New Roman',serif">
<tr><td style="background:${BRAND};color:#ffffff;padding:20px 28px;border-radius:8px 8px 0 0;font-family:Arial,Helvetica,sans-serif">
<div style="font-size:22px;font-weight:bold">TrailBook News</div><div style="font-size:14px;opacity:.85">${esc(longDate(o.sendOn))}</div></td></tr>
<tr><td style="padding:24px 28px 8px">${paragraphs(c.intro)}${sections}${paragraphs(c.closing)}
<p style="margin:0 0 24px;font-size:16px;color:#1d2a24">Greg Pomeroy<br><span style="color:#5b6b63">${app}, from Pomeroy Agency</span></p></td></tr>
<tr><td style="padding:18px 28px 24px;border-top:1px solid #e3ebe6;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#5b6b63">
<p style="margin:0 0 8px">General information only, not tax or legal advice for your situation. Rules change; check the source or ask your accountant before acting.</p>
<p style="margin:0 0 8px">You're getting TrailBook News because you signed up for it. <a href="{{ unsubscribe }}" style="color:#5b6b63">Unsubscribe</a> at any time.</p>
<p style="margin:0">Pomeroy Agency, a DBA of Harmony in the Wild, LLC · ${esc(o.postalAddress)}</p></td></tr>
</table></td></tr></table></body></html>`;
}

/** The same issue as plain text, for the review page and for checking word counts. */
export function renderText(c: IssueContent, o: RenderOptions): string {
  const parts = [`TrailBook News, ${longDate(o.sendOn)}`, "", c.intro, ""];
  for (const s of c.sections) {
    parts.push(`## ${s.heading}`, "", s.body, ...(safeLink(s.link) ? [`Source: ${s.link}`] : []), "");
  }
  parts.push(c.closing, "", "Greg Pomeroy", "", "---", "General information only, not tax or legal advice for your situation.",
    "Unsubscribe: {{ unsubscribe }}", `Pomeroy Agency, a DBA of Harmony in the Wild, LLC · ${o.postalAddress}`);
  return parts.join("\n");
}

export function wordCount(c: IssueContent): number {
  return [c.intro, ...c.sections.flatMap((s) => [s.heading, s.body]), c.closing].join(" ").split(/\s+/).filter(Boolean).length;
}
