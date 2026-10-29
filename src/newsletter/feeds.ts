import { XMLParser } from "fast-xml-parser";
import type { NewsSource } from "./sources.js";

// Reads RSS 2.0, Atom and RDF feeds and the Federal Register's JSON into one
// shape. Only the title, link, date and the feed's own short summary are kept;
// article text is read later, once, to write up the facts, and never stored.

export interface FeedEntry {
  title: string;
  url: string;
  publishedAt: string | null;
  excerpt: string;
}

const MAX_EXCERPT = 1200;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text", processEntities: true, htmlEntities: true });

const list = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function text(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) return text((v as Record<string, unknown>)["#text"]);
  return "";
}

/** Plain text from a feed's HTML summary: tags dropped, entities decoded, spaces collapsed. */
export function plainText(html: string, max = MAX_EXCERPT): string {
  const t = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function isoDate(v: string): string | null {
  if (!v) return null;
  const d = new Date(v.trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function httpUrl(v: string): string | null {
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function atomLink(links: unknown): string {
  for (const l of list(links as Record<string, string> | Record<string, string>[])) {
    if (typeof l === "string") return l;
    if (!l["@rel"] || l["@rel"] === "alternate") return l["@href"] ?? "";
  }
  return "";
}

/** Parses a feed's body. Entries without a title or a web address are skipped. */
export function parseFeed(body: string, format: NewsSource["format"]): FeedEntry[] {
  const raw: { title: string; link: string; date: string; summary: string }[] = [];
  if (format === "federal_register") {
    const doc = JSON.parse(body) as { results?: { title?: string; html_url?: string; publication_date?: string; abstract?: string; type?: string }[] };
    for (const r of doc.results ?? []) {
      raw.push({ title: r.title ?? "", link: r.html_url ?? "", date: r.publication_date ?? "", summary: [r.type, r.abstract].filter(Boolean).join(": ") });
    }
  } else {
    const doc = parser.parse(body) as Record<string, any>;
    if (doc.rss) {
      for (const i of list(doc.rss.channel?.item)) {
        raw.push({ title: text(i.title), link: text(i.link) || text(i.guid), date: text(i.pubDate) || text(i["dc:date"]), summary: text(i.description) });
      }
    } else if (doc.feed) {
      for (const e of list(doc.feed.entry)) {
        raw.push({ title: text(e.title), link: atomLink(e.link), date: text(e.published) || text(e.updated), summary: text(e.summary) || text(e.content) });
      }
    } else if (doc["rdf:RDF"]) {
      for (const i of list(doc["rdf:RDF"].item)) {
        raw.push({ title: text(i.title), link: text(i.link), date: text(i["dc:date"]), summary: text(i.description) });
      }
    } else {
      throw new Error("not an RSS, Atom or RDF feed");
    }
  }
  const out: FeedEntry[] = [];
  for (const r of raw) {
    const title = plainText(r.title, 300);
    const url = httpUrl(r.link);
    if (!title || !url) continue;
    out.push({ title, url, publishedAt: isoDate(r.date), excerpt: plainText(r.summary) });
  }
  return out;
}

/** A title reduced to its words, so the same story from two feeds is noticed. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    // Google News appends " - Publisher".
    .replace(/\s+[-|–]\s+[^-|–]{2,60}$/, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
