import type { Config, Context } from "@netlify/functions";

// The visitor's country from their IP address, for the USD/CAD price switch on pomeroyagency.com and the pricing page.
// Only the two-letter country code is returned, and nothing is stored.
export default async (_req: Request, context: Context) =>
  new Response(JSON.stringify({ country: context.geo?.country?.code ?? null }), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });

export const config: Config = { path: "/geo" };
