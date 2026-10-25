import type pg from "pg";
import { withSystem, withTenant, type Tx } from "../db/pool.js";
import { appendAudit, verifyAuditChain } from "../core/audit.js";
import { LedgerError } from "../core/errors.js";
import { findPeriod, getEntry, postJournal, reverseEntry, setPeriodStatus, type Actor, type LineInput, type PeriodStatus, type Role } from "../core/ledger.js";
import { trialBalance, taxLineExportCsv } from "../core/reports.js";
import { aging, createContact, getDocument, issueDocument, listContacts, listDocuments, recordPayment, voidDocument, type ContactKind, type DocumentKind } from "../core/documents.js";
import { categorizeBankLine, importBankCsv, listBankLines, matchBankLine, setBankLineExcluded, undoBankLine, MAX_CSV_BYTES, type BankLineStatus } from "../core/bank.js";
import { completeReconciliation, listReconciliations, reconciliationItems } from "../core/reconcile.js";
import { balanceSheet, balanceSheetCsv, booksHealth, generalLedger, generalLedgerAll, generalLedgerCsv, profitAndLoss, profitAndLossCsv } from "../core/statements.js";
import { attention, closeBooksThrough, closedThrough, moneyAtAGlance } from "../core/overview.js";
import { EXAMPLE_ORG_NAME, createExampleBusiness } from "./example.js";
import { toMajor } from "../core/money.js";
import { ACCOUNT_KINDS, createAccount, suggestedTaxLine, taxLineOptions, updateAccount } from "../core/accounts.js";
import { acceptInvitation, changeRole, invite, listInvitations, listMembers, previewInvitation, removeMember, revokeInvitation, type InviteRole, type MemberRole } from "./team.js";
import { emailText, issueEmailToken, useEmailToken, type EmailPurpose } from "./email-auth.js";
import type { Mailer } from "./mail.js";
import { addConnection, createEntity, createOrganization, getEntity, type ConnectionKind, type EntityType } from "../core/tenancy.js";
import { JurisdictionError, allRulePacks } from "../rules/index.js";
import { approveAndPostPayRun, calculatePayRun, type PayRunInput } from "../payroll/pay-run.js";
import { splitCaliforniaWeek } from "../payroll/hours.js";
import { usCalifornia2026 } from "../rules/us-ca-2026.js";
import {
  AuthError, SESSION_COOKIE, createSession, endSession, hashPassword, membershipRole, normaliseEmail,
  sessionUser, verifyPassword, type SessionUser,
} from "./auth.js";

export interface ApiOptions {
  /** When set, sign-up requires this invite code. */
  signupCode?: string;
  /** Sends sign-in, reset, confirmation and invitation emails. Without one, those features say email isn't set up. */
  mailer?: Mailer;
  /** The site's own address for links in emails. Taken from configuration, not the request, so a forged Host header can't redirect a reset link. */
  appUrl?: string;
}

/** Where emailed and copied links point. */
function appUrl(req: Request, opts: ApiOptions): string {
  return (opts.appUrl || new URL(req.url).origin).replace(/\/+$/, "");
}

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } },
  );
}

function cookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get("cookie") ?? "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function sessionCookie(token: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

async function body(req: Request): Promise<Record<string, any>> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    throw new HttpError(415, "send JSON");
  }
  try {
    const b = await req.json();
    if (!b || typeof b !== "object") throw new Error();
    return b as Record<string, any>;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

function str(v: unknown, field: string, max = 200): string {
  if (typeof v !== "string" || !v.trim()) throw new HttpError(400, `${field} is required`);
  if (v.length > max) throw new HttpError(400, `${field} is too long`);
  return v.trim();
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function date(v: unknown, field: string): string {
  if (typeof v !== "string" || !DATE.test(v)) throw new HttpError(400, `${field} must be a date (YYYY-MM-DD)`);
  return v;
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function uuid(v: unknown, message: string): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new HttpError(400, message);
  return v;
}

const ENTITY_TYPES: EntityType[] = ["sole_prop", "llc_single", "llc_partnership", "llc_s_corp", "s_corp", "c_corp", "partnership"];

interface Ctx {
  pool: pg.Pool;
  opts: ApiOptions;
  user: SessionUser;
  orgId: string;
  role: Role;
  actor: Actor;
}

type Handler = (req: Request, params: Record<string, string>, ctx: Ctx) => Promise<Response>;
interface Route { method: string; pattern: RegExp; keys: string[]; handler: Handler }

const routes: Route[] = [];
function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp(
    "^" + path.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return "([0-9a-fA-F-]{36})"; }) + "$",
  );
  routes.push({ method, pattern, keys, handler });
}

function requireRole(ctx: Ctx, allowed: Role[]) {
  if (!allowed.includes(ctx.role)) throw new HttpError(403, `your role (${ctx.role}) cannot do this`);
}

const tenant = <T>(ctx: Ctx, fn: (tx: Tx) => Promise<T>, opts?: { allowSoftClosed?: boolean }) =>
  withTenant(ctx.pool, ctx.orgId, fn, opts);

async function ensureEntity(tx: Tx, entityId: string) {
  const { rows } = await tx.query("SELECT 1 FROM entities WHERE id = $1", [entityId]);
  if (!rows[0]) throw new HttpError(404, "entity not found");
}

// ------------------------------------------------------------ organisation

route("GET", "/api/orgs/:org", async (_req, _p, ctx) =>
  tenant(ctx, async (tx) => {
    const org = (await tx.query("SELECT id, name, kind FROM organizations WHERE id = $1", [ctx.orgId])).rows[0];
    const entities = (await tx.query(
      `SELECT id, legal_name, entity_type, region, framework, functional_currency, tax_return_type
         FROM entities ORDER BY created_at`,
    )).rows;
    return json({ org, role: ctx.role, entities });
  }),
);

route("POST", "/api/orgs/:org/entities", async (req, _p, ctx) => {
  requireRole(ctx, ["owner", "admin"]);
  const b = await body(req);
  const entityType = b.entityType as EntityType;
  if (!ENTITY_TYPES.includes(entityType)) throw new HttpError(400, "pick an entity type");
  const year = Number(b.firstFiscalYear ?? 2026);
  const entity = await tenant(ctx, (tx) =>
    createEntity(tx, {
      orgId: ctx.orgId,
      legalName: str(b.legalName, "legal name"),
      entityType,
      place: { country: str(b.country ?? "US", "country"), region: str(b.region ?? "CA", "state") },
      firstFiscalYear: year,
      ein: typeof b.ein === "string" && b.ein ? b.ein : undefined,
      actor: ctx.actor,
    }),
  );
  return json(entity, 201);
});

route("GET", "/api/orgs/:org/members", async (_req, _p, ctx) =>
  withSystem(ctx.pool, async (tx) => json({
    members: await listMembers(tx, ctx.orgId),
    invitations: ["owner", "admin"].includes(ctx.role) ? await listInvitations(tx, ctx.orgId) : [],
  })),
);

route("POST", "/api/orgs/:org/invitations", async (req, _p, ctx) => {
  requireRole(ctx, ["owner", "admin"]);
  const b = await body(req);
  const email = normaliseEmail(b.email);
  const out = await withSystem(ctx.pool, (tx) => invite(tx, { orgId: ctx.orgId, email, role: b.role as InviteRole, actor: ctx.actor }));
  const link = `${appUrl(req, ctx.opts)}/#/join/${out.token}`;
  // The link is always returned so it can be copied; emailing it is a convenience on top.
  let emailed = false;
  if (ctx.opts.mailer) {
    const org = (await ctx.pool.query("SELECT name FROM organizations WHERE id = $1", [ctx.orgId])).rows[0];
    try {
      await ctx.opts.mailer({ to: email, ...emailText.invite(org.name, ROLE_NAMES[b.role as string] ?? String(b.role), ctx.user.name, link) });
      emailed = true;
    } catch (err) {
      console.error("invitation email failed", err);
    }
  }
  return json({ id: out.id, email, token: out.token, link, emailed }, 201);
});

route("POST", "/api/orgs/:org/invitations/:invitation/revoke", async (_req, p, ctx) => {
  requireRole(ctx, ["owner", "admin"]);
  await withSystem(ctx.pool, (tx) => revokeInvitation(tx, { orgId: ctx.orgId, invitationId: p.invitation!, actor: ctx.actor }));
  return json({ ok: true });
});

route("POST", "/api/orgs/:org/members/:user/role", async (req, p, ctx) => {
  requireRole(ctx, ["owner", "admin"]);
  const b = await body(req);
  await withSystem(ctx.pool, (tx) => changeRole(tx, { orgId: ctx.orgId, userId: p.user!, role: b.role as MemberRole, actor: ctx.actor }));
  return json({ ok: true });
});

route("POST", "/api/orgs/:org/members/:user/remove", async (_req, p, ctx) => {
  requireRole(ctx, ["owner", "admin"]);
  if (p.user === ctx.user.id) throw new HttpError(400, "use Leave to remove yourself");
  await withSystem(ctx.pool, (tx) => removeMember(tx, { orgId: ctx.orgId, userId: p.user!, actor: ctx.actor }));
  return json({ ok: true });
});

route("POST", "/api/orgs/:org/leave", async (_req, _p, ctx) => {
  await withSystem(ctx.pool, (tx) => removeMember(tx, { orgId: ctx.orgId, userId: ctx.user.id, actor: ctx.actor, self: true }));
  return json({ ok: true });
});

route("GET", "/api/orgs/:org/audit", async (_req, _p, ctx) =>
  tenant(ctx, async (tx) => {
    const events = (await tx.query(
      `SELECT seq, occurred_at, actor, action, object_type, object_id, context, hash
         FROM audit_events WHERE org_id = $1 ORDER BY seq DESC LIMIT 200`,
      [ctx.orgId],
    )).rows;
    const verification = await verifyAuditChain(tx, ctx.orgId);
    return json({ events, verification });
  }),
);

// ------------------------------------------------------------------ entity

route("GET", "/api/orgs/:org/entities/:entity", async (_req, p, ctx) =>
  tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    const entity = await getEntity(tx, p.entity!);
    const accounts = (await tx.query(
      `SELECT a.id, a.code, a.name, a.type, a.subtype, a.statement_line, a.cash_flow_class, a.tax_line, a.system_key, a.is_active,
              coalesce((SELECT sum(l.debit_minor - l.credit_minor) FROM journal_lines l WHERE l.account_id = a.id), 0)::bigint AS balance_minor
         FROM accounts a WHERE a.entity_id = $1 ORDER BY a.code`,
      [p.entity],
    )).rows;
    const periods = (await tx.query(
      "SELECT id, start_date, end_date, status FROM periods WHERE entity_id = $1 ORDER BY start_date",
      [p.entity],
    )).rows;
    const connections = (await tx.query(
      "SELECT id, kind, display_name, scopes, status, created_at FROM connections WHERE entity_id = $1 ORDER BY created_at",
      [p.entity],
    )).rows;
    return json({ entity, accounts, periods, connections });
  }),
);

route("GET", "/api/orgs/:org/entities/:entity/journal", async (req, p, ctx) =>
  tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    // Search matches the entry number, the memo, a line's description or account name, the lines of the
    // invoice or bill behind the entry, or an amount on any line ("1,450" or "1450.00").
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
    const amount = /^\$?[\d,]+(\.\d{1,2})?$/.test(q) ? Math.round(Number(q.replace(/[$,]/g, "")) * 100) : null;
    const ids = (await tx.query(
      `SELECT e.id FROM journal_entries e
        WHERE e.entity_id = $1 AND ($2 = '' OR e.entry_number::text = ltrim($2, '#') OR e.memo ILIKE $3
          OR EXISTS (SELECT 1 FROM journal_lines l JOIN accounts a ON a.id = l.account_id
                      WHERE l.entry_id = e.id AND (l.description ILIKE $3 OR a.name ILIKE $3 OR l.debit_minor = $4 OR l.credit_minor = $4))
          OR EXISTS (SELECT 1 FROM documents d JOIN document_lines dl ON dl.document_id = d.id
                      WHERE (d.entry_id = e.id OR d.id IN (SELECT document_id FROM document_payments WHERE entry_id = e.id)) AND dl.description ILIKE $3))
        ORDER BY e.entry_number DESC LIMIT 100`,
      [p.entity, q, `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, amount],
    )).rows;
    const entries = [];
    for (const r of ids) entries.push(await getEntry(tx, r.id));
    const reversed = new Set(entries.map((e) => e.reversesEntryId).filter(Boolean));
    const all = (await tx.query("SELECT reverses_entry_id FROM journal_entries WHERE entity_id = $1 AND reverses_entry_id IS NOT NULL", [p.entity])).rows;
    for (const r of all) reversed.add(r.reverses_entry_id);
    return json({ entries: entries.map((e) => ({ ...e, isReversed: reversed.has(e.id) })) });
  }),
);

route("POST", "/api/orgs/:org/entities/:entity/journal", async (req, p, ctx) => {
  const b = await body(req);
  if (!Array.isArray(b.lines)) throw new HttpError(400, "lines are required");
  const lines: LineInput[] = b.lines.map((l: any, i: number) => {
    const debit = typeof l.debit === "string" && l.debit.trim() ? l.debit.trim() : undefined;
    const credit = typeof l.credit === "string" && l.credit.trim() ? l.credit.trim() : undefined;
    if (debit && !/^\d+(\.\d{1,2})?$/.test(debit)) throw new HttpError(400, `line ${i + 1}: debit must be an amount like 125.00`);
    if (credit && !/^\d+(\.\d{1,2})?$/.test(credit)) throw new HttpError(400, `line ${i + 1}: credit must be an amount like 125.00`);
    return {
      account: str(l.account, `line ${i + 1} account`, 40),
      debit, credit,
      description: typeof l.description === "string" ? l.description.slice(0, 200) : "",
      dimensions: { project: typeof l.project === "string" ? l.project.slice(0, 60) : undefined },
    };
  });
  const sourceType = ["journal_voucher", "invoice", "bill", "payment", "opening_balance"].includes(b.sourceType)
    ? b.sourceType : "journal_voucher";
  const entry = await tenant(
    ctx,
    async (tx) => {
      await ensureEntity(tx, p.entity!);
      return postJournal(tx, {
        orgId: ctx.orgId,
        entityId: p.entity!,
        date: date(b.date, "date"),
        memo: typeof b.memo === "string" ? b.memo.slice(0, 300) : "",
        sourceType,
        idempotencyKey: typeof b.idempotencyKey === "string" && b.idempotencyKey ? b.idempotencyKey.slice(0, 100) : crypto.randomUUID(),
        actor: ctx.actor,
        lines,
      });
    },
    { allowSoftClosed: ["owner", "admin", "accountant"].includes(ctx.role) },
  );
  return json(entry, entry.replayed ? 200 : 201);
});

route("POST", "/api/orgs/:org/entities/:entity/journal/:entry/reverse", async (req, p, ctx) => {
  const b = await body(req);
  const entry = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    const original = await getEntry(tx, p.entry!);
    if (original.entityId !== p.entity) throw new HttpError(404, "entry not found");
    // These entries belong to a document or bank line; undoing them here would leave that record out of step.
    const owner = { invoice: "void the invoice instead", bill: "void the bill instead", bank_line: "undo it from the Bank page instead", payment: "payments can't be reversed yet" } as Record<string, string>;
    if (owner[original.sourceType]) throw new HttpError(409, `this entry came from a ${original.sourceType.replace("_", " ")}; ${owner[original.sourceType]}`);
    return reverseEntry(tx, {
      orgId: ctx.orgId, entryId: p.entry!, date: date(b.date, "date"), reason: str(b.reason, "reason", 300), actor: ctx.actor,
    });
  });
  return json(entry, 201);
});

route("POST", "/api/orgs/:org/entities/:entity/periods/:period", async (req, p, ctx) => {
  const b = await body(req);
  const status = b.status as PeriodStatus;
  if (!["open", "soft_closed", "locked"].includes(status)) throw new HttpError(400, "unknown status");
  await tenant(ctx, async (tx) => {
    const { rows } = await tx.query("SELECT 1 FROM periods WHERE id = $1 AND entity_id = $2", [p.period, p.entity]);
    if (!rows[0]) throw new HttpError(404, "period not found");
    await setPeriodStatus(tx, {
      orgId: ctx.orgId, periodId: p.period!, status, actor: ctx.actor,
      reason: typeof b.reason === "string" ? b.reason.slice(0, 300) : undefined,
    });
  });
  return json({ ok: true });
});

route("GET", "/api/orgs/:org/entities/:entity/trial-balance", async (req, p, ctx) => {
  const asOf = new URL(req.url).searchParams.get("asOf") ?? "2026-12-31";
  return tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return json(await trialBalance(tx, p.entity!, date(asOf, "asOf")));
  });
});

route("GET", "/api/orgs/:org/entities/:entity/tax-export", async (req, p, ctx) => {
  const asOf = date(new URL(req.url).searchParams.get("asOf") ?? "2026-12-31", "asOf");
  const csv = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return taxLineExportCsv(tx, p.entity!, asOf);
  });
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="trial-balance-tax-lines-${asOf}.csv"`,
      "cache-control": "no-store",
    },
  });
});

route("POST", "/api/orgs/:org/entities/:entity/connections", async (req, p, ctx) => {
  requireRole(ctx, ["owner", "admin"]);
  const b = await body(req);
  const kind = b.kind as ConnectionKind;
  if (!["bank", "card_issuer", "processor", "agency", "business"].includes(kind)) throw new HttpError(400, "pick a connection type");
  const out = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return addConnection(tx, {
      orgId: ctx.orgId, entityId: p.entity!, kind, displayName: str(b.displayName, "name"), actor: ctx.actor,
    });
  });
  return json(out, 201);
});

// ------------------------------------------------- receivables and payables

route("GET", "/api/orgs/:org/entities/:entity/contacts", async (_req, p, ctx) =>
  tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return json({ contacts: await listContacts(tx, p.entity!) });
  }),
);

route("POST", "/api/orgs/:org/entities/:entity/contacts", async (req, p, ctx) => {
  const b = await body(req);
  const kind = b.kind as ContactKind;
  if (!["customer", "vendor", "both"].includes(kind)) throw new HttpError(400, "pick customer, vendor or both");
  const contact = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return createContact(tx, {
      orgId: ctx.orgId, entityId: p.entity!, kind, name: str(b.name, "name"),
      email: typeof b.email === "string" && b.email.trim() ? str(b.email, "email") : undefined, actor: ctx.actor,
    });
  });
  return json(contact, 201);
});

/** "7.25" (percent) to 725 basis points. */
function taxRateBps(v: unknown): number {
  if (v === undefined || v === null || v === "") return 0;
  if (typeof v !== "string" || !/^\d{1,3}(\.\d{1,2})?$/.test(v.trim())) throw new HttpError(400, "tax rate must be a percentage like 7.25");
  const bps = Math.round(Number(v.trim()) * 100);
  if (bps > 10000) throw new HttpError(400, "tax rate cannot be over 100%");
  return bps;
}

for (const kind of ["invoice", "bill"] as DocumentKind[]) {
  const base = `/api/orgs/:org/entities/:entity/${kind}s`;

  route("GET", base, async (req, p, ctx) => {
    const asOf = new URL(req.url).searchParams.get("asOf");
    return tenant(ctx, async (tx) => {
      await ensureEntity(tx, p.entity!);
      return json({ documents: await listDocuments(tx, p.entity!, kind, asOf ? date(asOf, "asOf") : undefined) });
    });
  });

  route("GET", `${base}/aging`, async (req, p, ctx) => {
    const asOf = new URL(req.url).searchParams.get("asOf");
    return tenant(ctx, async (tx) => {
      await ensureEntity(tx, p.entity!);
      return json(await aging(tx, p.entity!, kind, asOf ? date(asOf, "asOf") : undefined));
    });
  });

  route("POST", base, async (req, p, ctx) => {
    const b = await body(req);
    if (!Array.isArray(b.lines) || !b.lines.length) throw new HttpError(400, "add at least one line");
    if (b.lines.length > 200) throw new HttpError(400, "too many lines");
    const lines = b.lines.map((l: any, i: number) => ({
      account: str(l.account, `line ${i + 1} account`, 40),
      description: typeof l.description === "string" ? l.description.slice(0, 300) : "",
      quantity: str(String(l.quantity ?? "1"), `line ${i + 1} quantity`, 20),
      unitPrice: str(l.unitPrice, `line ${i + 1} price`, 20),
      taxable: Boolean(l.taxable),
    }));
    const doc = await tenant(
      ctx,
      async (tx) => {
        await ensureEntity(tx, p.entity!);
        return issueDocument(tx, {
          orgId: ctx.orgId, entityId: p.entity!, kind,
          contactId: uuid(b.contactId, kind === "invoice" ? "choose a customer" : "choose a vendor"),
          issueDate: date(b.issueDate, "date"),
          dueDate: b.dueDate ? date(b.dueDate, "due date") : undefined,
          memo: typeof b.memo === "string" ? b.memo.slice(0, 300) : "",
          reference: typeof b.reference === "string" ? b.reference.slice(0, 60) : undefined,
          taxRateBps: kind === "invoice" ? taxRateBps(b.taxRate) : 0,
          lines,
          idempotencyKey: typeof b.idempotencyKey === "string" && b.idempotencyKey ? b.idempotencyKey.slice(0, 100) : crypto.randomUUID(),
          actor: ctx.actor,
        });
      },
      { allowSoftClosed: ["owner", "admin", "accountant"].includes(ctx.role) },
    );
    return json(doc, doc.replayed ? 200 : 201);
  });

  route("GET", `${base}/:doc`, async (_req, p, ctx) =>
    tenant(ctx, async (tx) => {
      const { rows } = await tx.query("SELECT 1 FROM documents WHERE id = $1 AND entity_id = $2 AND kind = $3", [p.doc, p.entity, kind]);
      if (!rows[0]) throw new HttpError(404, `${kind} not found`);
      return json(await getDocument(tx, p.doc!));
    }),
  );

  route("POST", `${base}/:doc/payments`, async (req, p, ctx) => {
    const b = await body(req);
    const amount = str(b.amount, "amount", 20);
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) throw new HttpError(400, "amount must be like 125.00");
    const doc = await tenant(
      ctx,
      async (tx) => {
        const { rows } = await tx.query("SELECT 1 FROM documents WHERE id = $1 AND entity_id = $2 AND kind = $3", [p.doc, p.entity, kind]);
        if (!rows[0]) throw new HttpError(404, `${kind} not found`);
        return recordPayment(tx, {
          orgId: ctx.orgId, entityId: p.entity!, documentId: p.doc!, date: date(b.date, "date"), amount,
          bankAccount: typeof b.bankAccount === "string" && b.bankAccount ? b.bankAccount.slice(0, 40) : undefined,
          idempotencyKey: typeof b.idempotencyKey === "string" && b.idempotencyKey ? b.idempotencyKey.slice(0, 100) : crypto.randomUUID(),
          actor: ctx.actor,
        });
      },
      { allowSoftClosed: ["owner", "admin", "accountant"].includes(ctx.role) },
    );
    return json(doc, doc.replayed ? 200 : 201);
  });

  route("POST", `${base}/:doc/void`, async (req, p, ctx) => {
    const b = await body(req);
    const doc = await tenant(ctx, async (tx) => {
      const { rows } = await tx.query("SELECT 1 FROM documents WHERE id = $1 AND entity_id = $2 AND kind = $3", [p.doc, p.entity, kind]);
      if (!rows[0]) throw new HttpError(404, `${kind} not found`);
      return voidDocument(tx, { orgId: ctx.orgId, entityId: p.entity!, documentId: p.doc!, date: date(b.date, "date"), reason: str(b.reason, "reason", 300), actor: ctx.actor });
    });
    return json(doc);
  });
}

// -------------------------------------------------------------------- bank

const writeOpts = (ctx: Ctx) => ({ allowSoftClosed: ["owner", "admin", "accountant"].includes(ctx.role) });

route("GET", "/api/orgs/:org/entities/:entity/bank-lines", async (req, p, ctx) => {
  const q = new URL(req.url).searchParams;
  const status = q.get("status") as BankLineStatus | null;
  if (status && !["new", "posted", "excluded"].includes(status)) throw new HttpError(400, "unknown status");
  const account = q.get("account");
  return tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return json({ lines: await listBankLines(tx, { entityId: p.entity!, bankAccount: account ? account.slice(0, 40) : undefined, status: status ?? undefined }) });
  });
});

route("POST", "/api/orgs/:org/entities/:entity/bank-imports", async (req, p, ctx) => {
  const b = await body(req);
  if (typeof b.csv !== "string" || !b.csv.trim()) throw new HttpError(400, "choose a CSV file");
  if (b.csv.length > MAX_CSV_BYTES) throw new HttpError(413, "the file is larger than 2 MB; split it");
  const out = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return importBankCsv(tx, {
      orgId: ctx.orgId, entityId: p.entity!, bankAccount: str(b.bankAccount, "bank account", 40), csv: b.csv,
      fileName: typeof b.fileName === "string" ? b.fileName.slice(0, 200) : "", actor: ctx.actor,
    });
  });
  return json(out, 201);
});

async function ensureLine(tx: Tx, entityId: string, lineId: string) {
  const { rows } = await tx.query("SELECT 1 FROM bank_lines WHERE id = $1 AND entity_id = $2", [lineId, entityId]);
  if (!rows[0]) throw new HttpError(404, "bank line not found");
}

route("POST", "/api/orgs/:org/entities/:entity/bank-lines/:line/categorize", async (req, p, ctx) => {
  const b = await body(req);
  const line = await tenant(ctx, async (tx) => {
    await ensureLine(tx, p.entity!, p.line!);
    return categorizeBankLine(tx, {
      orgId: ctx.orgId, entityId: p.entity!, lineId: p.line!, account: str(b.account, "account", 40),
      memo: typeof b.memo === "string" ? b.memo.slice(0, 300) : undefined, actor: ctx.actor,
    });
  }, writeOpts(ctx));
  return json(line);
});

route("POST", "/api/orgs/:org/entities/:entity/bank-lines/:line/match", async (req, p, ctx) => {
  const b = await body(req);
  const line = await tenant(ctx, async (tx) => {
    await ensureLine(tx, p.entity!, p.line!);
    return matchBankLine(tx, { orgId: ctx.orgId, entityId: p.entity!, lineId: p.line!, documentId: uuid(b.documentId, "choose an invoice or bill"), actor: ctx.actor });
  }, writeOpts(ctx));
  return json(line);
});

for (const [action, excluded] of [["exclude", true], ["restore", false]] as const) {
  route("POST", `/api/orgs/:org/entities/:entity/bank-lines/:line/${action}`, async (_req, p, ctx) => {
    const line = await tenant(ctx, async (tx) => {
      await ensureLine(tx, p.entity!, p.line!);
      return setBankLineExcluded(tx, { orgId: ctx.orgId, entityId: p.entity!, lineId: p.line!, excluded, actor: ctx.actor });
    });
    return json(line);
  });
}

route("POST", "/api/orgs/:org/entities/:entity/bank-lines/:line/undo", async (req, p, ctx) => {
  const b = await body(req);
  const line = await tenant(ctx, async (tx) => {
    await ensureLine(tx, p.entity!, p.line!);
    return undoBankLine(tx, { orgId: ctx.orgId, entityId: p.entity!, lineId: p.line!, date: date(b.date, "date"), reason: str(b.reason, "reason", 300), actor: ctx.actor });
  }, writeOpts(ctx));
  return json(line);
});

// ---------------------------------------------------------- reconciliation

route("GET", "/api/orgs/:org/entities/:entity/reconciliations", async (req, p, ctx) => {
  const q = new URL(req.url).searchParams;
  const account = str(q.get("account") ?? "", "account", 40);
  const statementDate = q.get("statementDate");
  return tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return json({
      history: await listReconciliations(tx, p.entity!, account),
      ...(statementDate ? await reconciliationItems(tx, { entityId: p.entity!, bankAccount: account, statementDate: date(statementDate, "statement date") }) : {}),
    });
  });
});

route("POST", "/api/orgs/:org/entities/:entity/reconciliations", async (req, p, ctx) => {
  const b = await body(req);
  if (!Array.isArray(b.clearedLineIds) || b.clearedLineIds.length > 5000) throw new HttpError(400, "send the ticked lines");
  const ids = b.clearedLineIds.map((x: unknown) => uuid(x, "invalid line id"));
  const balance = str(b.statementBalance, "statement balance", 20);
  if (!/^-?[\d,]+(\.\d{1,2})?$/.test(balance)) throw new HttpError(400, "statement balance must be an amount like 12345.67");
  const out = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return completeReconciliation(tx, {
      orgId: ctx.orgId, entityId: p.entity!, bankAccount: str(b.bankAccount, "bank account", 40),
      statementDate: date(b.statementDate, "statement date"), statementBalance: balance, clearedLineIds: ids, actor: ctx.actor,
    });
  });
  return json(out, 201);
});

// -------------------------------------------------------- chart of accounts

route("GET", "/api/orgs/:org/entities/:entity/accounts/options", async (_req, p, ctx) =>
  tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    const e = await getEntity(tx, p.entity!);
    const rt = e.taxReturnType as Parameters<typeof taxLineOptions>[1];
    return json({
      kinds: ACCOUNT_KINDS.map((k) => ({ ...k, suggestedTaxLine: suggestedTaxLine(e.coaTemplate, rt, k.key) })),
      taxLines: taxLineOptions(e.coaTemplate, rt),
    });
  }),
);

const taxLineOf = (v: unknown) => (v === null || v === "" ? null : str(v, "tax line", 40));

route("POST", "/api/orgs/:org/entities/:entity/accounts", async (req, p, ctx) => {
  const b = await body(req);
  const out = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return createAccount(tx, {
      orgId: ctx.orgId, entityId: p.entity!, code: str(b.code, "code", 6), name: str(b.name, "name", 120), kind: str(b.kind, "kind", 40),
      taxLine: taxLineOf(b.taxLine ?? null), actor: ctx.actor,
    });
  });
  return json(out, 201);
});

route("POST", "/api/orgs/:org/entities/:entity/accounts/:account", async (req, p, ctx) => {
  const b = await body(req);
  await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    await updateAccount(tx, {
      orgId: ctx.orgId, entityId: p.entity!, accountId: p.account!,
      name: b.name === undefined ? undefined : str(b.name, "name", 120),
      taxLine: b.taxLine === undefined ? undefined : taxLineOf(b.taxLine),
      active: typeof b.active === "boolean" ? b.active : undefined,
      actor: ctx.actor,
    });
  });
  return json({ ok: true });
});

// ----------------------------------------------------------------- reports

function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename.replace(/[^\w.-]+/g, "-")}"`,
      "cache-control": "no-store",
    },
  });
}

const serverToday = () => new Date().toISOString().slice(0, 10);

route("GET", "/api/orgs/:org/entities/:entity/reports/profit-and-loss", async (req, p, ctx) => {
  const q = new URL(req.url).searchParams;
  const from = date(q.get("from"), "from"), to = date(q.get("to"), "to");
  const pl = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return profitAndLoss(tx, p.entity!, from, to);
  });
  return q.get("format") === "csv" ? csvResponse(profitAndLossCsv(pl), `profit-and-loss-${from}-to-${to}.csv`) : json(pl);
});

route("GET", "/api/orgs/:org/entities/:entity/reports/balance-sheet", async (req, p, ctx) => {
  const q = new URL(req.url).searchParams;
  const asOf = date(q.get("asOf"), "asOf");
  const bs = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return balanceSheet(tx, p.entity!, asOf);
  });
  return q.get("format") === "csv" ? csvResponse(balanceSheetCsv(bs), `balance-sheet-${asOf}.csv`) : json(bs);
});

route("GET", "/api/orgs/:org/entities/:entity/reports/general-ledger", async (req, p, ctx) => {
  const q = new URL(req.url).searchParams;
  const from = date(q.get("from"), "from"), to = date(q.get("to"), "to");
  const account = str(q.get("account") ?? "", "account", 40);
  if (account === "all") {
    const ledgers = await tenant(ctx, async (tx) => {
      await ensureEntity(tx, p.entity!);
      return generalLedgerAll(tx, p.entity!, from, to);
    });
    return q.get("format") === "csv" ? csvResponse(generalLedgerCsv(ledgers), `general-ledger-all-${from}-to-${to}.csv`) : json({ from, to, ledgers });
  }
  const gl = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return generalLedger(tx, p.entity!, account, from, to);
  });
  return q.get("format") === "csv" ? csvResponse(generalLedgerCsv(gl), `general-ledger-${gl.account.code}-${from}-to-${to}.csv`) : json(gl);
});

for (const kind of ["invoice", "bill"] as DocumentKind[]) {
  route("GET", `/api/orgs/:org/entities/:entity/reports/${kind === "invoice" ? "receivables" : "payables"}-aging`, async (req, p, ctx) => {
    const asOf = date(new URL(req.url).searchParams.get("asOf"), "asOf");
    const ag = await tenant(ctx, async (tx) => {
      await ensureEntity(tx, p.entity!);
      return aging(tx, p.entity!, kind, asOf);
    });
    const cell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [`${kind === "invoice" ? "Receivables" : "Payables"} aging,as of ${asOf}`, "Number,Contact,Due date,Days past due,Bucket,Still due"];
    for (const r of ag.rows) lines.push([r.number, cell(r.contactName), r.dueDate, String(r.daysPastDue), r.bucket, toMajor(r.dueMinor).toFixed(2)].join(","));
    lines.push(`Total,,,,,${toMajor(ag.totalMinor).toFixed(2)}`);
    return csvResponse(lines.join("\n") + "\n", `${kind === "invoice" ? "receivables" : "payables"}-aging-${asOf}.csv`);
  });
}

route("GET", "/api/orgs/:org/entities/:entity/health", async (_req, p, ctx) =>
  tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return json({ checks: await booksHealth(tx, p.entity!, serverToday()) });
  }),
);

route("GET", "/api/orgs/:org/entities/:entity/glance", async (_req, p, ctx) =>
  tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return json({ ...(await moneyAtAGlance(tx, p.entity!, serverToday())), closedThrough: await closedThrough(tx, p.entity!) });
  }),
);

route("GET", "/api/orgs/:org/entities/:entity/attention", async (_req, p, ctx) =>
  tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return json(await attention(tx, p.entity!, serverToday()));
  }),
);

route("POST", "/api/orgs/:org/entities/:entity/close-through", async (req, p, ctx) => {
  const b = await body(req);
  const status = b.status === "soft_closed" ? "soft_closed" : "locked";
  const out = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return closeBooksThrough(tx, { orgId: ctx.orgId, entityId: p.entity!, through: date(b.through, "through"), status, actor: ctx.actor });
  });
  return json(out);
});

route("POST", "/api/orgs/:org/entities/:entity/settings", async (req, p, ctx) => {
  requireRole(ctx, ["owner", "admin"]);
  const b = await body(req);
  const ein = str(b.ein, "EIN", 20);
  if (!/^\d{2}-?\d{7}$/.test(ein)) throw new HttpError(400, "EIN must look like 12-3456789");
  const formatted = `${ein.replace("-", "").slice(0, 2)}-${ein.replace("-", "").slice(2)}`;
  await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    const before = (await tx.query("SELECT ein FROM entities WHERE id = $1", [p.entity])).rows[0].ein;
    await tx.query("UPDATE entities SET ein = $2 WHERE id = $1", [p.entity, formatted]);
    await appendAudit(tx, {
      orgId: ctx.orgId, entityId: p.entity!, actor: ctx.actor.id, action: "entity.updated", objectType: "entity", objectId: p.entity!,
      before: { ein: before }, after: { ein: formatted }, context: { role: ctx.role },
    });
  });
  return json({ ok: true, ein: formatted });
});

// ----------------------------------------------------------------- payroll

function payRunInput(b: Record<string, any>): PayRunInput {
  if (!Array.isArray(b.employees) || b.employees.length === 0) throw new HttpError(400, "add at least one employee");
  if (b.employees.length > 200) throw new HttpError(400, "too many employees in one run");
  const amount = (v: unknown, field: string) => {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string" || !/^\d+(\.\d{1,4})?$/.test(v)) throw new HttpError(400, `${field} must be a number like 25.00`);
    return v;
  };
  return {
    payRunId: crypto.randomUUID(),
    kind: "regular",
    periodStart: date(b.periodStart, "period start"),
    periodEnd: date(b.periodEnd, "period end"),
    payDate: date(b.payDate, "pay date"),
    place: { country: "US", region: "CA" },
    employer: { caUiRate: amount(b.caUiRate, "UI rate") },
    live: false,
    employees: b.employees.map((e: any, i: number) => {
      const n = `employee ${i + 1}`;
      let hours = { regular: amount(e.regularHours, `${n} hours`), overtime: amount(e.overtimeHours, `${n} overtime`), doubleTime: amount(e.doubleTimeHours, `${n} double time`) };
      if (Array.isArray(e.dailyHours) && e.dailyHours.length === 7) {
        let s;
        try {
          s = splitCaliforniaWeek(e.dailyHours.map((h: unknown) => Number(h) || 0), usCalifornia2026.wageHour);
        } catch (err) {
          throw new HttpError(400, `${n}: ${(err as Error).message}`);
        }
        hours = { regular: s.regular, overtime: s.overtime, doubleTime: s.doubleTime };
      }
      const status = ["single_or_mfs", "mfj", "hoh"].includes(e.federalStatus) ? e.federalStatus : "single_or_mfs";
      const caStatus = ["single", "married", "hoh"].includes(e.caStatus) ? e.caStatus : "single";
      const deductions = [];
      if (amount(e.k401, `${n} 401(k)`)) deductions.push({ kind: "traditional401k" as const, amount: e.k401, description: "401(k)" });
      if (amount(e.section125, `${n} section 125`)) deductions.push({ kind: "section125" as const, amount: e.section125, description: "Section 125" });
      return {
        employeeId: `emp-${i + 1}`,
        name: str(e.name, `${n} name`, 100),
        payFrequency: ["weekly", "biweekly", "semimonthly", "monthly"].includes(e.payFrequency) ? e.payFrequency : "biweekly",
        hourlyRate: amount(e.hourlyRate, `${n} hourly rate`),
        regularHours: hours.regular,
        overtimeHours: hours.overtime,
        doubleTimeHours: hours.doubleTime,
        salaryPerPeriod: amount(e.salaryPerPeriod, `${n} salary`),
        overtimeExempt: Boolean(e.overtimeExempt),
        bonus: amount(e.bonus, `${n} bonus`),
        w4: { filingStatus: status, step2Checked: Boolean(e.step2Checked), step4cExtraWithholding: amount(e.extraFederal, `${n} extra withholding`) },
        de4: { filingStatus: caStatus, regularAllowances: Math.max(0, Math.min(20, Number(e.caAllowances) || 0)) },
        deductions,
        // Accrual is driven by hours worked, so it applies to hourly staff here.
        sickLeave: e.hourlyRate ? { balanceHours: amount(e.sickBalance, `${n} sick balance`) ?? "0" } : undefined,
      };
    }),
  };
}

route("POST", "/api/orgs/:org/entities/:entity/pay-runs/preview", async (req, _p, _ctx) => {
  return json(calculatePayRun(payRunInput(await body(req))));
});

route("POST", "/api/orgs/:org/entities/:entity/pay-runs", async (req, p, ctx) => {
  requireRole(ctx, ["owner", "admin", "bookkeeper", "accountant"]);
  const input = payRunInput(await body(req));
  const run = calculatePayRun(input);
  const saved = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    const { rows } = await tx.query(
      `INSERT INTO pay_runs (id, org_id, entity_id, input, result, prepared_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [input.payRunId, ctx.orgId, p.entity, JSON.stringify(input), JSON.stringify(run, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), ctx.actor.id],
    );
    await appendAudit(tx, {
      orgId: ctx.orgId, entityId: p.entity!, actor: ctx.actor.id, action: "pay_run.prepared",
      objectType: "pay_run", objectId: rows[0].id, after: { totals: run.totals, rulePacks: run.rulePacks },
    });
    return rows[0];
  });
  return json({ id: saved.id, run }, 201);
});

route("GET", "/api/orgs/:org/entities/:entity/pay-runs", async (_req, p, ctx) =>
  tenant(ctx, async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, status, prepared_by, approved_by, entry_id, created_at, result
         FROM pay_runs WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [p.entity],
    );
    return json({ payRuns: rows });
  }),
);

route("POST", "/api/orgs/:org/entities/:entity/pay-runs/:run/approve", async (_req, p, ctx) => {
  requireRole(ctx, ["owner", "admin", "approver"]);
  const entry = await tenant(ctx, async (tx) => {
    const { rows } = await tx.query(
      "SELECT input, prepared_by, status FROM pay_runs WHERE id = $1 AND entity_id = $2 FOR UPDATE",
      [p.run, p.entity],
    );
    const pr = rows[0];
    if (!pr) throw new HttpError(404, "pay run not found");
    if (pr.status !== "prepared") throw new HttpError(409, `pay run is already ${pr.status}`);
    // Recalculate from the saved input so the posted figures can't be tampered with in transit.
    const run = calculatePayRun(pr.input as PayRunInput);
    const posted = await approveAndPostPayRun(tx, {
      orgId: ctx.orgId, entityId: p.entity!, run,
      preparedBy: { id: pr.prepared_by, role: "bookkeeper" }, approvedBy: ctx.actor,
    });
    await tx.query("UPDATE pay_runs SET status = 'posted', approved_by = $2, entry_id = $3 WHERE id = $1", [p.run, ctx.actor.id, posted.id]);
    return posted;
  });
  return json(entry, 201);
});

// --------------------------------------------------------------- dispatch

const ROLE_NAMES: Record<string, string> = { admin: "an admin", bookkeeper: "a bookkeeper", approver: "an approver", accountant: "an accountant", read_only: "a viewer" };

const EMAIL_ROUTE: Record<string, EmailPurpose> = { "email-link": "sign_in", reset: "reset", verify: "verify" };
const EMAIL_HASH: Record<EmailPurpose, string> = { sign_in: "email-link", reset: "reset", verify: "verify" };

/** Emails a one-time link if the account exists and isn't over its hourly limit. Says nothing either way, so the form can't be used to find accounts. */
async function sendEmailLink(req: Request, pool: pg.Pool, opts: ApiOptions, email: string, purpose: EmailPurpose): Promise<void> {
  if (!opts.mailer) throw new HttpError(503, "email isn't set up on this site yet");
  const issued = await withSystem(pool, async (tx) => {
    const user = (await tx.query("SELECT id, email, name FROM users WHERE email = $1", [email])).rows[0];
    if (!user) return null;
    const token = await issueEmailToken(tx, user, purpose);
    return token ? { user, token } : null;
  });
  if (!issued) return;
  const link = `${appUrl(req, opts)}/#/${EMAIL_HASH[purpose]}/${issued.token}`;
  try {
    await opts.mailer({ to: issued.user.email, ...emailText[purpose](issued.user.name, link) });
  } catch (err) {
    console.error(`${purpose} email failed`, err);
  }
}

async function authRoutes(req: Request, path: string, pool: pg.Pool, opts: ApiOptions): Promise<Response | null> {
  if (req.method === "GET" && path === "/api/auth/options") return json({ email: Boolean(opts.mailer) });
  if (req.method === "POST" && (path === "/api/auth/email-link" || path === "/api/auth/reset")) {
    const b = await body(req);
    await sendEmailLink(req, pool, opts, normaliseEmail(b.email), path.endsWith("reset") ? "reset" : "sign_in");
    return json({ ok: true });
  }
  if (req.method === "POST" && path === "/api/auth/verify-resend") {
    const user = await sessionUser(pool, cookie(req, SESSION_COOKIE));
    if (!user) throw new AuthError("not signed in");
    await sendEmailLink(req, pool, opts, user.email, "verify");
    return json({ ok: true });
  }
  const tokenPath = /^\/api\/auth\/(email-link|reset|verify)\/([\w-]{20,100})$/.exec(path);
  if (req.method === "POST" && tokenPath) {
    const purpose = EMAIL_ROUTE[tokenPath[1]!]!;
    const b = purpose === "reset" ? await body(req) : {};
    const passwordHash = purpose === "reset" ? await hashPassword(str(b.password, "password", 200)) : null;
    const user = await withSystem(pool, async (tx) => {
      const u = await useEmailToken(tx, tokenPath[2]!, purpose);
      if (passwordHash) {
        await tx.query("UPDATE users SET password_hash = $2 WHERE id = $1", [u.id, passwordHash]);
        // A new password signs out every other session, in case the old one leaked.
        await tx.query("DELETE FROM sessions WHERE user_id = $1", [u.id]);
      }
      return u;
    });
    if (purpose === "verify") return json({ ok: true, email: user.email });
    const s = await createSession(pool, user.id);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(s.token, s.maxAge) });
  }
  if (req.method === "GET" && path === "/api/health") return json({ ok: true });
  if (req.method === "GET" && path === "/api/rule-packs") {
    return json({ packs: allRulePacks().map((p) => ({ id: p.id, version: p.version, status: p.status, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo, sources: p.sources, reviewNotes: p.reviewNotes })) });
  }
  const invitePath = /^\/api\/invitations\/([\w-]{20,64})$/.exec(path);
  if (req.method === "GET" && invitePath) {
    const inv = await withSystem(pool, (tx) => previewInvitation(tx, invitePath[1]!));
    if (!inv) throw new HttpError(404, "this invitation link isn't valid");
    return json(inv);
  }
  const acceptPath = /^\/api\/invitations\/([\w-]{20,64})\/accept$/.exec(path);
  if (req.method === "POST" && acceptPath) {
    const user = await sessionUser(pool, cookie(req, SESSION_COOKIE));
    if (!user) throw new AuthError("not signed in");
    return json(await withSystem(pool, (tx) => acceptInvitation(tx, { token: acceptPath[1]!, userId: user.id })));
  }
  if (req.method === "POST" && path === "/api/auth/signup") {
    const b = await body(req);
    // Someone joining through an invitation doesn't need the sign-up code or a business of their own.
    const inviteToken = typeof b.inviteToken === "string" && b.inviteToken ? b.inviteToken : null;
    if (!inviteToken && opts.signupCode && b.inviteCode !== opts.signupCode) throw new AuthError("that invite code isn't valid", 403);
    const email = normaliseEmail(b.email);
    const name = str(b.name, "name", 100);
    const orgName = inviteToken ? null : str(b.orgName, "business name");
    const passwordHash = await hashPassword(str(b.password, "password", 200));
    let joined: string | undefined;
    const userId = await withSystem(pool, async (tx) => {
      if ((await tx.query("SELECT 1 FROM users WHERE email = $1", [email])).rows[0]) {
        throw new AuthError("an account with that email already exists; sign in instead", 409);
      }
      const uid = (await tx.query(
        "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id", [email, name, passwordHash],
      )).rows[0].id;
      if (inviteToken) {
        joined = (await acceptInvitation(tx, { token: inviteToken, userId: uid })).orgId;
      } else {
        const org = await createOrganization(tx, { name: orgName!, actor: { id: `user:${email}`, role: "owner" } });
        await tx.query("INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, 'owner')", [uid, org.id]);
      }
      return uid;
    });
    if (opts.mailer) await sendEmailLink(req, pool, opts, email, "verify");
    const s = await createSession(pool, userId);
    return json({ ok: true, joined }, 201, { "set-cookie": sessionCookie(s.token, s.maxAge) });
  }
  if (req.method === "POST" && path === "/api/auth/login") {
    const b = await body(req);
    const email = normaliseEmail(b.email);
    const { rows } = await pool.query("SELECT id, password_hash FROM users WHERE email = $1", [email]);
    const ok = rows[0] && (await verifyPassword(String(b.password ?? ""), rows[0].password_hash));
    if (!ok) throw new AuthError("wrong email or password");
    const joined = typeof b.inviteToken === "string" && b.inviteToken
      ? (await withSystem(pool, (tx) => acceptInvitation(tx, { token: b.inviteToken, userId: rows[0].id }))).orgId
      : undefined;
    const s = await createSession(pool, rows[0].id);
    return json({ ok: true, joined }, 200, { "set-cookie": sessionCookie(s.token, s.maxAge) });
  }
  if (req.method === "POST" && path === "/api/auth/logout") {
    await endSession(pool, cookie(req, SESSION_COOKIE));
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
  }
  if (req.method === "POST" && path === "/api/example") {
    const user = await sessionUser(pool, cookie(req, SESSION_COOKIE));
    if (!user) throw new AuthError("not signed in");
    // One example per person: opening it again goes back to the same books.
    const existing = (await pool.query(
      `SELECT o.id AS org_id, (SELECT e.id FROM entities e WHERE e.org_id = o.id ORDER BY e.created_at LIMIT 1) AS entity_id
         FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $1 AND o.name = $2 LIMIT 1`,
      [user.id, EXAMPLE_ORG_NAME],
    )).rows[0];
    if (existing?.entity_id) return json({ orgId: existing.org_id, entityId: existing.entity_id });
    return json(await createExampleBusiness(pool, user), 201);
  }
  if (req.method === "GET" && path === "/api/me") {
    const user = await sessionUser(pool, cookie(req, SESSION_COOKIE));
    if (!user) throw new AuthError("not signed in");
    const { rows } = await pool.query(
      `SELECT o.id, o.name, m.role FROM memberships m JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = $1 ORDER BY m.created_at`,
      [user.id],
    );
    const verified = (await pool.query("SELECT email_verified_at IS NOT NULL AS v FROM users WHERE id = $1", [user.id])).rows[0].v;
    return json({ user: { ...user, emailVerified: verified }, orgs: rows, emailEnabled: Boolean(opts.mailer) });
  }
  return null;
}

/** Handles one API request. Framework-free so it runs in a Netlify Function, a test, or a local server. */
export async function handleApi(req: Request, pool: pg.Pool, opts: ApiOptions = {}): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  try {
    if (req.method !== "GET") {
      // Cookie-authenticated writes must come from this site.
      const origin = req.headers.get("origin");
      if (origin && new URL(origin).host !== url.host) throw new HttpError(403, "cross-site request refused");
    }
    const open = await authRoutes(req, path, pool, opts);
    if (open) return open;

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.pattern.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = m[i + 1]!));
      const user = await sessionUser(pool, cookie(req, SESSION_COOKIE));
      if (!user) throw new AuthError("not signed in");
      const role = await membershipRole(pool, user.id, params.org!);
      if (!role) throw new HttpError(404, "organisation not found");
      if (req.method !== "GET" && role === "read_only") throw new HttpError(403, "read-only users cannot make changes");
      const ctx: Ctx = { pool, opts, user, orgId: params.org!, role, actor: { id: `user:${user.email}`, role } };
      return await r.handler(req, params, ctx);
    }
    return json({ error: "not found" }, 404);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    if (err instanceof AuthError) return json({ error: err.message }, err.status);
    if (err instanceof LedgerError) {
      const status = err.code === "FORBIDDEN" ? 403 : err.code === "IDEMPOTENCY_CONFLICT" ? 409 : 422;
      return json({ error: err.message, code: err.code }, status);
    }
    if (err instanceof JurisdictionError) return json({ error: err.message, code: "JURISDICTION" }, 422);
    console.error(err);
    return json({ error: "something went wrong on our side" }, 500);
  }
}
