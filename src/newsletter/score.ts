import { KEYWORD_GROUPS, supportedPlaces, type NewsSource } from "./sources.js";
import type { FeedEntry } from "./feeds.js";

export interface Score {
  score: number;
  reasons: string[];
}

/**
 * How notable an item is, 0 to 100: the source's weight, each group of
 * keywords it mentions, a state TrailBook supports, and how fresh it is.
 * Plain arithmetic, so the page can say why an item scored what it did.
 */
export function scoreEntry(entry: FeedEntry, source: NewsSource, now: Date, places = supportedPlaces()): Score {
  const reasons: string[] = [`${source.name} (+${source.weight})`];
  let score = source.weight;
  const hay = ` ${entry.title} ${entry.excerpt} `.toLowerCase();
  for (const g of KEYWORD_GROUPS) {
    if (g.words.some((w) => hay.includes(w))) {
      score += g.points;
      reasons.push(`${g.label} (+${g.points})`);
    }
  }
  const place = places.find((p) => new RegExp(`\\b${p.toLowerCase()}\\b`).test(hay));
  if (place) {
    score += 5;
    reasons.push(`mentions ${place} (+5)`);
  }
  if (entry.publishedAt) {
    const days = (now.getTime() - new Date(entry.publishedAt).getTime()) / 86_400_000;
    if (days <= 2) {
      score += 10;
      reasons.push("published in the last two days (+10)");
    } else if (days > 14) {
      score -= 30;
      reasons.push("over two weeks old (-30)");
    }
  }
  return { score: Math.max(0, Math.min(100, score)), reasons };
}
