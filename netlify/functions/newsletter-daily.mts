import type { Config } from "@netlify/functions";
import { newsletterFromEnv, startNewsletterJob } from "../../src/newsletter/config.js";

// Every morning, start the newsletter worker: read the news and, on Mondays,
// write the draft for Tuesday. Scheduled functions get 30 seconds, so the work
// itself happens in newsletter-background.

export default async () => {
  if (!newsletterFromEnv()) return;
  await startNewsletterJob(process.env.URL!, "daily");
};

// 13:00 UTC is 5 or 6 a.m. in California, so Monday's draft is waiting before the workday.
export const config: Config = { schedule: "0 13 * * *" };
