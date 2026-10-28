// Local server: serves web/ and the API against DATABASE_URL.
//   DATABASE_URL=postgres://... npm run dev
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createPool } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { handleApi } from "../src/app/api.js";
import { oauthClientsFromEnv } from "../src/app/oauth.js";
import { mailerFromEnv, type Mailer } from "../src/app/mail.js";
import { cdtfaRateLookup, sampleRateLookup } from "../src/app/cdtfa.js";
import { billingFromEnv } from "../src/app/billing-config.js";
import { memoryStore } from "../src/core/nightly-backups.js";
import { randomBytes } from "node:crypto";

const pool = createPool();
await migrate(pool);
const root = path.resolve("web");
const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
const port = Number(process.env.PORT ?? 8888);
// DEV_MAIL=log prints emails to the console instead of sending them.
const logMailer: Mailer = async (m) => console.log(`\n--- email to ${m.to}: ${m.subject}\n${m.text}---`);
const mailer = mailerFromEnv() ?? (process.env.DEV_MAIL === "log" ? logMailer : undefined);
// DEV_TAX_RATES=sample uses stand-in sales tax rates instead of asking the CDTFA.
const taxRates = process.env.DEV_TAX_RATES === "sample" ? sampleRateLookup : cdtfaRateLookup();
// Local data only: a fixed key for sealing Social Security numbers when PII_KEY isn't set.
process.env.PII_KEY ??= Buffer.alloc(32, 1).toString("base64");
// Billing settings come from the same variables as production (see docs/launch-setup.md); restore points stay in memory.
const billing = billingFromEnv();
const backups = { store: memoryStore(), key: randomBytes(32) };

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${port}`);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/oauth/")) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const request = new Request(url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
    });
    const response = await handleApi(request, pool, { signupCode: process.env.SIGNUP_CODE, mailer, appUrl: `http://localhost:${port}`, taxRates, billing, backups, oauthClients: oauthClientsFromEnv(), milepost: { url: process.env.MILEPOST_URL || "https://crm.pomeroyagency.com" } });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  const file = path.join(root, url.pathname === "/" ? "index.html" : url.pathname);
  try {
    if (!file.startsWith(root)) throw new Error();
    const data = await readFile(file);
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(await readFile(path.join(root, "index.html")));
  }
}).listen(port, () => console.log(`TrailBook on http://localhost:${port}`));
