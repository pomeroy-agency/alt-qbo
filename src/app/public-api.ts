import type pg from "pg";
import { withTenant, type Tx } from "../db/pool.js";
import { appendAudit } from "../core/audit.js";
import { LedgerError } from "../core/errors.js";
import type { Actor } from "../core/ledger.js";
import { createContact, getDocument, updateContact, type Contact, type DocumentDetail } from "../core/documents.js";
import { currentCategories, issueInvoice, type InvoiceLineInput, type RateLookup } from "../core/sales-tax.js";
import { toMajor } from "../core/money.js";
import { checkAccess, subscriptionStatus, type BillingConfig } from "../billing/billing.js";
import { pacificToday } from "../payroll/business-days.js";
import {
  OAuthError, SCOPES, authenticateBearer, authenticateClient, exchangeToken, findClient, parseScopes, redirectWith, revokeToken,
  type Grant, type OAuthClient,
} from "./oauth.js";

// What a connected app (MilePost) sees: the OAuth endpoints under /oauth and
// a small REST API under /api/v1, scoped to the one business it was approved
// for. Errors are { error: { code, message } }. POSTs that carry an
// external_ref are idempotent on it: the same MilePost contact or deal twice
// returns the record made the first time.

export interface PublicApiOptions {
  oauthClients?: OAuthClient[];
  billing?: BillingConfig;
  taxRates?: RateLookup;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", pragma: "no-cache" },
  });
}

class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

async function formBody(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const b = await req.json().catch(() => ({}));
    return new URLSearchParams(Object.entries(b ?? {}).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(await req.text());
}

// ------------------------------------------------------------------ OAuth

/** /oauth/authorize, /oauth/token, /oauth/revoke, and what the consent page needs. Null when the path isn't one of them. */
export async function handleOAuth(req: Request, path: string, pool: pg.Pool, opts: PublicApiOptions): Promise<Response | null> {
  const clients = opts.oauthClients ?? [];
  const url = new URL(req.url);
  if (req.method === "GET" && path === "/oauth/authorize") {
    // The consent page is part of the web app, which keeps its routes after the #.
    return new Response(null, { status: 302, headers: { location: `/#/oauth/authorize?${url.searchParams.toString()}`, "cache-control": "no-store" } });
  }
  if (req.method === "GET" && path === "/api/oauth/client") {
    // For the consent page: who is asking, for what, and where "Cancel" goes. Nothing here is secret.
    const q = url.searchParams;
    try {
      if (q.get("response_type") !== "code") throw new OAuthError("unsupported_response_type", "the app must ask for response_type=code");
      const client = findClient(clients, q.get("client_id"), q.get("redirect_uri") ?? "");
      const redirectUri = q.get("redirect_uri")!;
      let scopes: string[];
      try {
        scopes = parseScopes(q.get("scope"));
      } catch (err) {
        // The address is known to be the app's own, so the app hears why.
        return json({ error: (err as Error).message, back: redirectWith(redirectUri, { error: "invalid_scope", error_description: (err as Error).message, state: q.get("state") ?? undefined }) }, 400);
      }
      return json({
        client: { id: client.id, name: client.name, homeUrl: client.homeUrl ?? null },
        scopes: scopes.map((s) => ({ id: s, description: SCOPES[s] })),
        denyUrl: redirectWith(redirectUri, { error: "access_denied", error_description: "the person declined", state: q.get("state") ?? undefined }),
      });
    } catch (err) {
      if (err instanceof OAuthError) return json({ error: err.message }, 400);
      throw err;
    }
  }
  if (req.method === "POST" && (path === "/oauth/token" || path === "/oauth/revoke")) {
    try {
      const form = await formBody(req);
      const client = authenticateClient(clients, req.headers.get("authorization"), form);
      if (path === "/oauth/revoke") {
        await revokeToken(pool, client, form.get("token") ?? "");
        return json({});
      }
      return json(await exchangeToken(pool, client, form));
    } catch (err) {
      if (err instanceof OAuthError) {
        const res = json({ error: err.code, error_description: err.message }, err.status);
        if (err.status === 401) res.headers.set("www-authenticate", 'Basic realm="TrailBook"');
        return res;
      }
      throw err;
    }
  }
  return null;
}

// --------------------------------------------------------------- REST API

interface Ctx { pool: pg.Pool; opts: PublicApiOptions; grant: Grant; actor: Actor; source: string }

function requireScope(ctx: Ctx, ...any: string[]) {
  if (!any.some((s) => ctx.grant.scopes.includes(s))) {
    throw new ApiError(403, "insufficient_scope", `this connection wasn't given ${any.join(" or ")}; connect again and allow it`);
  }
}

const tenant = <T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>) => withTenant(ctx.pool, ctx.grant.orgId, fn);

const money = (minor: bigint) => toMajor(minor).toFixed(2);

function text(v: unknown, field: string, max: number): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") throw new ApiError(400, "invalid_request", `${field} must be text`);
  const t = v.trim();
  if (t.length > max) throw new ApiError(400, "invalid_request", `${field} is too long`);
  return t || null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CustomerOut { id: string; display_name: string; email: string | null; phone: string | null; external_ref: string | null }

async function refFor(tx: Tx, ctx: Ctx, type: "contact" | "invoice", objectId: string): Promise<string | null> {
  const { rows } = await tx.query(
    "SELECT external_ref FROM external_refs WHERE entity_id = $1 AND source = $2 AND object_type = $3 AND object_id = $4",
    [ctx.grant.entityId, ctx.source, type, objectId],
  );
  return rows[0]?.external_ref ?? null;
}

async function objectFor(tx: Tx, ctx: Ctx, type: "contact" | "invoice", ref: string): Promise<string | null> {
  const { rows } = await tx.query(
    "SELECT object_id FROM external_refs WHERE entity_id = $1 AND source = $2 AND object_type = $3 AND external_ref = $4",
    [ctx.grant.entityId, ctx.source, type, ref],
  );
  return rows[0]?.object_id ?? null;
}

async function remember(tx: Tx, ctx: Ctx, type: "contact" | "invoice", objectId: string, ref: string) {
  await tx.query(
    `INSERT INTO external_refs (org_id, entity_id, source, object_type, object_id, external_ref) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [ctx.grant.orgId, ctx.grant.entityId, ctx.source, type, objectId, ref],
  );
}

function customerOut(c: Pick<Contact, "id" | "name" | "email" | "phone">, ref: string | null): CustomerOut {
  return { id: c.id, display_name: c.name, email: c.email, phone: c.phone, external_ref: ref };
}

async function getCustomer(tx: Tx, ctx: Ctx, id: string) {
  const { rows } = await tx.query(
    "SELECT id, kind, name, email, phone FROM contacts WHERE id = $1 AND entity_id = $2",
    [id, ctx.grant.entityId],
  );
  return rows[0] as (Pick<Contact, "id" | "kind" | "name" | "email" | "phone">) | undefined;
}

/** A name not yet used in these books: TrailBook keeps contact names unique. */
async function freeName(tx: Tx, entityId: string, name: string, email: string | null): Promise<string> {
  const taken = async (n: string) => Boolean((await tx.query("SELECT 1 FROM contacts WHERE entity_id = $1 AND lower(name) = lower($2)", [entityId, n])).rows[0]);
  if (!(await taken(name))) return name;
  if (email && !(await taken(`${name} (${email})`))) return `${name} (${email})`.slice(0, 200);
  for (let i = 2; i < 100; i++) if (!(await taken(`${name} (${i})`))) return `${name} (${i})`;
  throw new ApiError(409, "conflict", "too many customers with that name");
}

async function upsertCustomer(tx: Tx, ctx: Ctx, b: Record<string, unknown>): Promise<{ customer: CustomerOut; created: boolean }> {
  const email = text(b.email, "email", 200)?.toLowerCase() ?? null;
  if (email && !EMAIL.test(email)) throw new ApiError(400, "invalid_request", "email isn't a valid address");
  const phone = text(b.phone, "phone", 40);
  const ref = text(b.external_ref, "external_ref", 100);
  const person = [text(b.given_name, "given_name", 100), text(b.family_name, "family_name", 100)].filter(Boolean).join(" ");
  const displayName = text(b.display_name, "display_name", 150) || person || text(b.company_name, "company_name", 150) || email;
  const entityId = ctx.grant.entityId;

  let existingId = ref ? await objectFor(tx, ctx, "contact", ref) : null;
  if (!existingId && email) {
    const { rows } = await tx.query(
      "SELECT id FROM contacts WHERE entity_id = $1 AND lower(email) = $2 ORDER BY (kind = 'vendor'), created_at LIMIT 1",
      [entityId, email],
    );
    existingId = rows[0]?.id ?? null;
  }

  if (existingId) {
    const before = (await getCustomer(tx, ctx, existingId))!;
    if (before.kind === "vendor") {
      // Someone the business already buys from is now a customer too.
      await tx.query("UPDATE contacts SET kind = 'both' WHERE id = $1", [existingId]);
      await appendAudit(tx, {
        orgId: ctx.grant.orgId, entityId, actor: ctx.actor.id, action: "contact.updated", objectType: "contact", objectId: existingId,
        before: { kind: "vendor" }, after: { kind: "both" },
      });
    }
    const patch: { email?: string | null; phone?: string | null; name?: string } = {};
    if (email && email !== before.email) patch.email = email;
    if (phone && phone !== before.phone) patch.phone = phone;
    if (displayName && displayName !== before.name) {
      const free = !(await tx.query("SELECT 1 FROM contacts WHERE entity_id = $1 AND lower(name) = lower($2) AND id <> $3", [entityId, displayName, existingId])).rows[0];
      if (free) patch.name = displayName;
    }
    const after = Object.keys(patch).length
      ? await updateContact(tx, { orgId: ctx.grant.orgId, entityId, contactId: existingId, ...patch, actor: ctx.actor })
      : before;
    if (ref && !(await refFor(tx, ctx, "contact", existingId))) await remember(tx, ctx, "contact", existingId, ref);
    return { customer: customerOut(after, ref ?? (await refFor(tx, ctx, "contact", existingId))), created: false };
  }

  if (!displayName) throw new ApiError(400, "invalid_request", "send display_name, a name, a company_name or an email");
  const contact = await createContact(tx, {
    orgId: ctx.grant.orgId, entityId, kind: "customer", name: await freeName(tx, entityId, displayName, email), email, phone, actor: ctx.actor,
  });
  if (ref) await remember(tx, ctx, "contact", contact.id, ref);
  return { customer: customerOut(contact, ref), created: true };
}

function invoiceOut(d: DocumentDetail, ref: string | null, updatedAt?: string) {
  return {
    id: d.id, number: d.number, customer_id: d.contactId, customer_name: d.contactName, currency: d.currency,
    issue_date: d.issueDate, due_date: d.dueDate, memo: d.memo,
    subtotal: money(d.subtotalMinor), tax: money(d.taxMinor), total: money(d.totalMinor), paid: money(d.paidMinor), balance: money(d.dueMinor),
    status: d.status, external_ref: ref, ...(updatedAt ? { updated_at: updatedAt } : {}),
  };
}

function apiLines(raw: unknown, categories: Set<string>, fallback: string): InvoiceLineInput[] {
  if (!Array.isArray(raw) || !raw.length) throw new ApiError(400, "invalid_request", "send at least one line");
  if (raw.length > 200) throw new ApiError(400, "invalid_request", "too many lines");
  return raw.map((l: any, i) => {
    const n = i + 1;
    const qty = String(l?.quantity ?? "1");
    const price = l?.unit_price;
    if (!/^\d+(\.\d{1,4})?$/.test(qty) || Number(qty) <= 0) throw new ApiError(400, "invalid_request", `line ${n}: quantity must be a positive number`);
    if ((typeof price !== "number" && typeof price !== "string") || !/^\d+(\.\d{1,2})?$/.test(String(price))) {
      throw new ApiError(400, "invalid_request", `line ${n}: unit_price must be an amount like 125.00`);
    }
    // The kind of sale decides sales tax. Without one, the business's choice for this app on TrailBook's Integrations page.
    const category = typeof l.tax_category === "string" && l.tax_category ? l.tax_category : fallback;
    if (!categories.has(category)) throw new ApiError(400, "invalid_request", `line ${n}: unknown tax_category ${category}`);
    return {
      description: typeof l.description === "string" ? l.description.slice(0, 300) : "",
      quantity: qty, unitPrice: String(price), taxCategory: category,
      ...(typeof l.item_id === "string" && l.item_id ? { itemId: l.item_id } : {}),
    };
  });
}

/** When an invoice last changed: issued, paid or voided. */
const UPDATED_SQL = `greatest(d.created_at,
  (SELECT max(p.created_at) FROM document_payments p WHERE p.document_id = d.id),
  (SELECT max(e.occurred_at) FROM audit_events e WHERE e.object_type = 'invoice' AND e.object_id = d.id::text))`;

async function invoiceFor(tx: Tx, ctx: Ctx, id: string) {
  // An app sees the invoices it created, not the rest of the business's sales.
  const { rows } = await tx.query(
    `SELECT r.external_ref, ${UPDATED_SQL} AS updated_at FROM documents d
       JOIN external_refs r ON r.entity_id = d.entity_id AND r.source = $3 AND r.object_type = 'invoice' AND r.object_id = d.id
      WHERE d.id = $1 AND d.entity_id = $2 AND d.kind = 'invoice'`,
    [id, ctx.grant.entityId, ctx.source],
  );
  if (!rows[0]) throw new ApiError(404, "not_found", "invoice not found");
  return invoiceOut(await getDocument(tx, id), rows[0].external_ref, new Date(rows[0].updated_at).toISOString());
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

async function route(req: Request, path: string, ctx: Ctx): Promise<Response> {
  const url = new URL(req.url);
  const { grant } = ctx;
  if (req.method !== "GET" && ctx.opts.billing?.enforce) {
    const access = await checkAccess(ctx.pool, grant.orgId, ctx.opts.billing, pacificToday());
    if (access.level === "read_only") throw new ApiError(402, "subscription_inactive", access.reason ?? "this business's TrailBook subscription isn't active");
  }

  if (req.method === "GET" && path === "/api/v1/company") {
    requireScope(ctx, "company:read");
    const e = await tenant(ctx, async (tx) => (await tx.query("SELECT legal_name, functional_currency FROM entities WHERE id = $1", [grant.entityId])).rows[0]);
    const subscription = await subscriptionStatus(ctx.pool, grant.orgId, ctx.opts.billing ?? {}, pacificToday());
    return json({ id: grant.entityId, name: e.legal_name, currency: e.functional_currency.trim(), subscription });
  }

  if (path === "/api/v1/customers") {
    requireScope(ctx, "customers:write", "customers:read");
    if (req.method === "GET") {
      const email = url.searchParams.get("email")?.trim().toLowerCase() || null;
      const rows = await tenant(ctx, async (tx) => (await tx.query(
        `SELECT c.id, c.name, c.email, c.phone, r.external_ref FROM contacts c
           LEFT JOIN external_refs r ON r.entity_id = c.entity_id AND r.source = $2 AND r.object_type = 'contact' AND r.object_id = c.id
          WHERE c.entity_id = $1 AND c.kind IN ('customer', 'both') AND ($3::text IS NULL OR lower(c.email) = $3)
          ORDER BY lower(c.name) LIMIT 100`,
        [grant.entityId, ctx.source, email],
      )).rows);
      return json(rows.map((r) => customerOut(r, r.external_ref)));
    }
    if (req.method === "POST") {
      requireScope(ctx, "customers:write");
      const b = await req.json().catch(() => null);
      if (!b || typeof b !== "object") throw new ApiError(400, "invalid_request", "send a JSON body");
      const out = await tenant(ctx, (tx) => upsertCustomer(tx, ctx, b));
      return json(out.customer, out.created ? 201 : 200);
    }
  }

  if (path === "/api/v1/invoices" && req.method === "POST") {
    requireScope(ctx, "invoices:write");
    const b = await req.json().catch(() => null);
    if (!b || typeof b !== "object") throw new ApiError(400, "invalid_request", "send a JSON body");
    const ref = text(b.external_ref, "external_ref", 100);
    const customerId = typeof b.customer_id === "string" && UUID.test(b.customer_id) ? b.customer_id : null;
    if (!customerId) throw new ApiError(400, "invalid_request", "customer_id is required");
    const out = await tenant(ctx, async (tx) => {
      if (ref) {
        const existing = await objectFor(tx, ctx, "invoice", ref);
        if (existing) return { invoice: await invoiceFor(tx, ctx, existing), created: false };
      }
      const customer = await getCustomer(tx, ctx, customerId);
      if (!customer || customer.kind === "vendor") throw new ApiError(404, "not_found", "customer not found");
      const ent = (await tx.query("SELECT region, functional_currency FROM entities WHERE id = $1", [grant.entityId])).rows[0];
      const currency = ent.functional_currency.trim();
      if (b.currency && String(b.currency).toUpperCase() !== currency) throw new ApiError(422, "unsupported_currency", `these books are kept in ${currency}`);
      const issueDate = pacificToday();
      const dueDate = b.due_date === undefined || b.due_date === null || b.due_date === "" ? undefined : String(b.due_date);
      if (dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < issueDate)) throw new ApiError(400, "invalid_request", "due_date must be a date (YYYY-MM-DD) on or after today");
      const categories = new Set(currentCategories(ent.region).map((c) => c.id));
      const doc = await issueInvoice(tx, {
        orgId: grant.orgId, entityId: grant.entityId, contactId: customerId, issueDate, dueDate,
        memo: typeof b.memo === "string" ? b.memo.slice(0, 300) : "",
        lines: apiLines(b.lines, categories, String(grant.settings.taxCategory ?? "professional_service")),
        idempotencyKey: ref ? `${ctx.source}:${ref}` : crypto.randomUUID(),
        lookup: ctx.opts.taxRates, actor: ctx.actor,
      });
      if (ref) await remember(tx, ctx, "invoice", doc.id, ref);
      return { invoice: invoiceOut(doc, ref, new Date().toISOString()), created: true };
    });
    return json(out.invoice, out.created ? 201 : 200);
  }

  if (path === "/api/v1/invoices" && req.method === "GET") {
    requireScope(ctx, "invoices:read");
    const since = url.searchParams.get("updated_since");
    if (since && Number.isNaN(Date.parse(since))) throw new ApiError(400, "invalid_request", "updated_since must be an ISO date and time");
    const list = await tenant(ctx, async (tx) => {
      const { rows } = await tx.query(
        `SELECT * FROM (
           SELECT d.id, r.external_ref, ${UPDATED_SQL} AS updated_at FROM documents d
             JOIN external_refs r ON r.entity_id = d.entity_id AND r.source = $2 AND r.object_type = 'invoice' AND r.object_id = d.id
            WHERE d.entity_id = $1 AND d.kind = 'invoice') x
          WHERE $3::timestamptz IS NULL OR x.updated_at >= $3::timestamptz
          ORDER BY x.updated_at LIMIT 200`,
        [grant.entityId, ctx.source, since ? new Date(since).toISOString() : null],
      );
      const out = [];
      for (const r of rows) out.push(invoiceOut(await getDocument(tx, r.id), r.external_ref, new Date(r.updated_at).toISOString()));
      return out;
    });
    return json(list);
  }

  const one = /^\/api\/v1\/invoices\/([0-9a-fA-F-]{36})$/.exec(path);
  if (one && req.method === "GET") {
    requireScope(ctx, "invoices:read", "invoices:write");
    return json(await tenant(ctx, (tx) => invoiceFor(tx, ctx, one[1]!)));
  }

  throw new ApiError(404, "not_found", "no such endpoint");
}

/** /api/v1/*, authenticated with an OAuth access token. Null for any other path. */
export async function handlePublicApi(req: Request, path: string, pool: pg.Pool, opts: PublicApiOptions): Promise<Response | null> {
  if (!path.startsWith("/api/v1/")) return null;
  try {
    const grant = await authenticateBearer(pool, req.headers.get("authorization"));
    const source = opts.oauthClients?.find((c) => c.id === grant.clientId)?.app ?? grant.clientId;
    const ctx: Ctx = { pool, opts, grant, source, actor: { id: `app:${source}`, role: "bookkeeper" } };
    return await route(req, path, ctx);
  } catch (err) {
    if (err instanceof ApiError) return fail(err.status, err.code, err.message);
    if (err instanceof OAuthError) {
      const res = fail(err.status, err.code, err.message);
      res.headers.set("www-authenticate", `Bearer error="${err.code}"`);
      return res;
    }
    if (err instanceof LedgerError) return fail(err.code === "FORBIDDEN" ? 403 : err.code === "IDEMPOTENCY_CONFLICT" ? 409 : 422, err.code.toLowerCase(), err.message);
    console.error(err);
    return fail(500, "server_error", "something went wrong on our side");
  }
}
