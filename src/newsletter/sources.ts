import { COUNTRIES } from "../rules/jurisdictions.js";

// Where the weekly newsletter's news comes from, and what makes an item worth
// a small-business owner's attention.
//
// Feeds move. The Newsletter page shows when each source last answered, so a
// dead address shows up there and gets fixed here.

export type SourceFormat = "rss" | "federal_register";

export interface NewsSource {
  id: string;
  name: string;
  url: string;
  format: SourceFormat;
  /** Points added to every item from this source: agencies make the rules, trade press reports on them. */
  weight: number;
}

/** The Federal Register's documents API, for rules and notices from the agencies that set payroll and tax rules. */
function federalRegister(agencies: string[]): string {
  const q = agencies.map((a) => `conditions%5Bagencies%5D%5B%5D=${a}`).join("&");
  return `https://www.federalregister.gov/api/v1/documents.json?per_page=40&order=newest&${q}`;
}

/** A Google News search, which collects many publishers' stories on one topic. */
function googleNews(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

export const SOURCES: readonly NewsSource[] = Object.freeze([
  { id: "fedreg-tax-labor", name: "Federal Register (IRS, Labor, SSA, SBA)", format: "federal_register", weight: 25,
    url: federalRegister(["internal-revenue-service", "wage-and-hour-division", "social-security-administration", "small-business-administration"]) },
  { id: "irs-newsroom", name: "IRS newsroom", format: "rss", weight: 25, url: "https://www.irs.gov/newsroom/rss" },
  { id: "dol-news", name: "U.S. Department of Labor", format: "rss", weight: 20, url: "https://www.dol.gov/rss/releases.xml" },
  { id: "accounting-today", name: "Accounting Today", format: "rss", weight: 15, url: "https://www.accountingtoday.com/feed?rss=true" },
  { id: "journal-of-accountancy", name: "Journal of Accountancy", format: "rss", weight: 15, url: "https://www.journalofaccountancy.com/news.xml" },
  { id: "cpa-practice-advisor", name: "CPA Practice Advisor", format: "rss", weight: 15, url: "https://www.cpapracticeadvisor.com/feed/" },
  { id: "news-payroll", name: "News: payroll tax and minimum wage", format: "rss", weight: 10,
    url: googleNews('("payroll tax" OR "minimum wage" OR "withholding") small business when:7d') },
  { id: "news-small-business-tax", name: "News: small business tax", format: "rss", weight: 10,
    url: googleNews('("IRS" OR "sales tax" OR "1099") "small business" when:7d') },
  { id: "news-selling", name: "News: small business sales and marketing", format: "rss", weight: 5,
    url: googleNews('"small business" (sales OR customers OR pricing) tips when:7d') },
]);

// Words that make an item matter to a TrailBook customer, with the points each adds.
// An item scores each group once, however many of its words it contains.
export const KEYWORD_GROUPS: readonly { label: string; points: number; words: readonly string[] }[] = Object.freeze([
  { label: "deadline or penalty", points: 20, words: ["deadline", "due date", "penalty", "penalties", "extension", "extended", "relief"] },
  { label: "rate or threshold change", points: 20, words: ["rate change", "new rate", "rates for", "increase", "decrease", "threshold", "wage base", "standard mileage", "inflation adjust"] },
  { label: "payroll", points: 15, words: ["payroll", "withholding", "w-2", "w-4", "form 941", "form 940", "futa", "fica", "social security", "medicare", "overtime", "minimum wage"] },
  { label: "small business tax", points: 15, words: ["small business", "self-employed", "1099", "estimated tax", "sales tax", "s corporation", "s corp", "llc", "deduction", "credit"] },
  { label: "new rule or law", points: 15, words: ["final rule", "proposed rule", "new law", "legislation", "signed into law", "guidance", "notice 20", "rev. proc", "revenue procedure"] },
  { label: "fraud or scam warning", points: 10, words: ["scam", "fraud", "phishing", "identity theft"] },
  { label: "selling and growth", points: 10, words: ["sales", "customers", "pricing", "marketing", "referral", "cash flow"] },
]);

/** States where TrailBook runs payroll. A story naming one is more likely to touch a customer. */
export function supportedPlaces(): string[] {
  return COUNTRIES.flatMap((c) => c.regions.filter((r) => r.status === "live").map((r) => r.name));
}

/** Items at or above this score get their facts written up and can go in an issue. */
export const NOTABLE_SCORE = 60;
