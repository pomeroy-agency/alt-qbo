import type pg from "pg";
import { withSystem, withTenant, type Tx } from "../db/pool.js";
import { appendAudit, verifyAuditChain } from "../core/audit.js";
import { LedgerError } from "../core/errors.js";
import { findPeriod, getEntry, postJournal, reverseEntry, setPeriodStatus, type Actor, type LineInput, type PeriodStatus, type Role } from "../core/ledger.js";
import { trialBalance, taxLineExportCsv } from "../core/reports.js";
import { aging, createContact, getDocument, listContacts, listDocuments, priceLine, recordPayment, updateContact, voidDocument, type ContactKind, type DocumentKind } from "../core/documents.js";
import {
  cleanAddress, createItem, currentCategories, decideSalesTax, decideUseTax, explainTax, explainUseTax, issueInvoice, listItems, recordBill, salesTaxReport, setBusinessAddress,
  updateItem, type InvoiceLineInput, type RateLookup,
} from "../core/sales-tax.js";
import { categorizeBankLine, importBankCsv, listBankLines, matchBankLine, setBankLineExcluded, undoBankLine, MAX_CSV_BYTES, type BankLineStatus } from "../core/bank.js";
import { completeReconciliation, listReconciliations, reconciliationItems } from "../core/reconcile.js";
import { balanceSheet, balanceSheetCsv, booksHealth, generalLedger, generalLedgerAll, generalLedgerCsv, profitAndLoss, profitAndLossCsv } from "../core/statements.js";
import { backupEntity } from "../core/backup.js";
import { listRestorePoints, readRestorePoint, type BackupStore } from "../core/nightly-backups.js";
import {
  BillingError, billingSummary, cancel as cancelSubscription, checkAccess, choosePlan, ensureSubscription, resume as resumeSubscription,
  runBilling, saveBillingDetails, saveCard, type BillingConfig,
} from "../billing/billing.js";
import { GatewayError } from "../billing/gateway.js";
import { attention, closeBooksThrough, closedThrough, moneyAtAGlance } from "../core/overview.js";
import { EXAMPLE_ORG_NAME, createExampleBusiness } from "./example.js";
import { D, parseMoney, toMajor } from "../core/money.js";
import { csvCell } from "../core/csv.js";
import { ACCOUNT_KINDS, createAccount, suggestedTaxLine, taxLineOptions, updateAccount } from "../core/accounts.js";
import { acceptInvitation, changeRole, invite, listInvitations, listMembers, previewInvitation, removeMember, revokeInvitation, type InviteRole, type MemberRole } from "./team.js";
import { emailText, issueEmailToken, useEmailToken, type EmailPurpose } from "./email-auth.js";
import { beginMfaSetup, checkSecondFactor, disableMfa, enableMfa, issueMfaTicket, mfaStatus, redeemMfaTicket, regenerateRecoveryCodes } from "./mfa.js";
import type { Mailer } from "./mail.js";
import { TERMS_VERSION, acceptTerms, orgsAccepted } from "./terms.js";
import { addConnection, createEntity, createOrganization, getEntity, type ConnectionKind, type EntityType } from "../core/tenancy.js";
import { JurisdictionError, allRulePacks, resolveRules } from "../rules/index.js";
import { LOCAL_MINIMUM_WAGE_PLACES, localMinimumAbove } from "../rules/local-minimum-wage.js";
import { approveAndPostPayRun, type PayRunInput } from "../payroll/pay-run.js";
import { createEmployee, listEmployees, setUiRate, updateEmployee, type Employee, type EmployeeFields } from "../payroll/employees.js";
import { directDepositFile, directDepositSummary, getDirectDepositSettings, saveDirectDepositSettings } from "../payroll/direct-deposit.js";
import { pacificToday } from "../payroll/business-days.js";
import { FILING_FREQUENCIES, prepareSalesTaxReturn, returnPeriods, salesTaxSettings, setSalesTaxSettings, type FilingFrequency } from "../core/sales-tax-return.js";
import { form940, form941, formDe9, formsFor, formW2, type PreparedForm } from "../payroll/forms.js";
import { federalDepositSchedule, recordDepositPayment, setFederalDepositSchedule, taxDeposits } from "../payroll/tax-deposits.js";
import { calculateSavedRun, carrySickLeave, employeeCount, payRunInputFromEmployees, yearToDate, type PayRunRequest } from "../payroll/runs.js";
import {
  AuthError, SESSION_COOKIE, checkSignInAllowed, createSession, recordSignIn, endSession, hashPassword, membershipRole, normaliseEmail,
  sessionUser, verifyPassword, type SessionUser,
} from "./auth.js";

export interface ApiOptions {
  /** When set, sign-up requires this invite code. */
  signupCode?: string;
  /** Sends sign-in, reset, confirmation and invitation emails. Without one, those features say email isn't set up. */
  mailer?: Mailer;
  /** The site's own address for links in emails. Taken from configuration, not the request, so a forged Host header can't redirect a reset link. */
  appUrl?: string;
  /** Looks up the California sales tax rate for an address (the CDTFA in production). Without one, only an owner or accountant can issue a taxable invoice, by setting the rate by hand. */
  taxRates?: RateLookup;
  /** Where the nightly encrypted backups are kept, and their key. Without it, restore points can't be downloaded. */
  backups?: { store: BackupStore; key: Buffer };
  /** TrailBook's own subscriptions: card processor, seller's books, and whether unpaid organisations become read-only. */
  billing?: BillingConfig;
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

route("GET", "/api/orgs/:org", async (_req, _p, ctx) => {
  // Whether changes are paused for an unpaid subscription, so every page can say so.
  const access = ctx.opts.billing?.enforce ? await checkAccess(ctx.pool, ctx.orgId, ctx.opts.billing, pacificToday()) : { level: "full" };
  return tenant(ctx, async (tx) => {
    const org = (await tx.query("SELECT id, name, kind FROM organizations WHERE id = $1", [ctx.orgId])).rows[0];
    const entities = (await tx.query(
      `SELECT id, legal_name, entity_type, region, framework, functional_currency, tax_return_type
         FROM entities ORDER BY created_at`,
    )).rows;
    return json({ org, role: ctx.role, entities, access });
  });
});

route("POST", "/api/orgs/:org/entities", async (req, _p, ctx) => {
  requireRole(ctx, ["owner", "admin"]);
  const b = await body(req);
  const entityType = b.entityType as EntityType;
  if (!ENTITY_TYPES.includes(entityType)) throw new HttpError(400, "pick an entity type");
  const year = Number(b.firstFiscalYear ?? pacificToday().slice(0, 4));
  if (!Number.isInteger(year) || year < 2026 || year > Number(pacificToday().slice(0, 4))) throw new HttpError(400, "the first fiscal year can be 2026 up to this year");
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

route("GET", "/api/orgs/:org/security", async (_req, _p, ctx) => {
  const org = (await ctx.pool.query("SELECT require_mfa FROM organizations WHERE id = $1", [ctx.orgId])).rows[0];
  const members = (await ctx.pool.query(
    `SELECT u.name, u.email, m.role, u.totp_enabled_at IS NOT NULL AS mfa FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1 ORDER BY lower(u.name)`,
    [ctx.orgId],
  )).rows;
  return json({ requireMfa: org.require_mfa, members: ["owner", "admin"].includes(ctx.role) ? members : [] });
});

route("POST", "/api/orgs/:org/security", async (req, _p, ctx) => {
  requireRole(ctx, ["owner"]);
  const b = await body(req);
  const requireMfa = b.requireMfa === true;
  if (requireMfa && !(await mfaStatus(ctx.pool, ctx.user.id)).enabled) {
    throw new HttpError(400, "turn on two-factor sign-in for yourself first");
  }
  await withSystem(ctx.pool, async (tx) => {
    await tx.query("UPDATE organizations SET require_mfa = $2 WHERE id = $1", [ctx.orgId, requireMfa]);
    await appendAudit(tx, {
      orgId: ctx.orgId, actor: ctx.actor.id, action: requireMfa ? "org.mfa_required" : "org.mfa_optional",
      objectType: "organization", objectId: ctx.orgId, after: { requireMfa }, context: { role: ctx.role },
    });
  });
  return json({ ok: true, requireMfa });
});

// ----------------------------------------------------------------- billing

const billingCfg = (ctx: Ctx): BillingConfig => ({ ...ctx.opts.billing, mailer: ctx.opts.mailer, taxRates: ctx.opts.taxRates, appUrl: ctx.opts.appUrl });

route("GET", "/api/orgs/:org/billing", async (_req, _p, ctx) => {
  requireRole(ctx, ["owner", "admin"]);
  return withSystem(ctx.pool, async (tx) => json(await billingSummary(tx, ctx.orgId, pacificToday(), billingCfg(ctx))));
});

route("POST", "/api/orgs/:org/billing/details", async (req, _p, ctx) => {
  requireRole(ctx, ["owner", "admin"]);
  const b = await body(req);
  await withSystem(ctx.pool, (tx) => saveBillingDetails(tx, ctx.orgId, pacificToday(), b));
  return json({ ok: true });
});

route("POST", "/api/orgs/:org/billing/plan", async (req, _p, ctx) => {
  requireRole(ctx, ["owner", "admin"]);
  const b = await body(req);
  const today = pacificToday();
  const out = await withSystem(ctx.pool, (tx) => choosePlan(tx, ctx.orgId, today, b.plan, b.interval));
  if (out.upgradeChargeId) await runBilling(ctx.pool, billingCfg(ctx), today, ctx.orgId);
  return json({ ok: true });
});

route("POST", "/api/orgs/:org/billing/cancel", async (_req, _p, ctx) => {
  requireRole(ctx, ["owner"]);
  await withSystem(ctx.pool, (tx) => cancelSubscription(tx, ctx.orgId, pacificToday()));
  return json({ ok: true });
});

route("POST", "/api/orgs/:org/billing/resume", async (_req, _p, ctx) => {
  requireRole(ctx, ["owner"]);
  const today = pacificToday();
  await withSystem(ctx.pool, (tx) => resumeSubscription(tx, ctx.orgId, today));
  await runBilling(ctx.pool, billingCfg(ctx), today, ctx.orgId);
  return json({ ok: true });
});

// Card details are typed on the card processor's own page, never here.
route("POST", "/api/orgs/:org/billing/card", async (req, _p, ctx) => {
  requireRole(ctx, ["owner", "admin"]);
  const gateway = ctx.opts.billing?.gateway;
  if (!gateway || !ctx.opts.billing?.seller) throw new HttpError(503, "card payments aren't switched on yet");
  const sub = await withSystem(ctx.pool, (tx) => ensureSubscription(tx, ctx.orgId, pacificToday()));
  if (!sub.address_line1) throw new HttpError(400, "add the billing name, email and address first");
  const base = appUrl(req, ctx.opts);
  const out = await gateway.startCardSetup({
    orgId: ctx.orgId, customerId: sub.processor_customer, email: sub.billing_email!, name: sub.billing_name!,
    successUrl: `${base}/#/billing/card/{CHECKOUT_SESSION_ID}`, cancelUrl: `${base}/#/billing`,
  });
  if (!sub.processor_customer) await ctx.pool.query("UPDATE subscriptions SET processor_customer = $2 WHERE org_id = $1", [ctx.orgId, out.customerId]);
  return json({ url: out.url });
});

route("POST", "/api/orgs/:org/billing/card/confirm", async (req, _p, ctx) => {
  requireRole(ctx, ["owner", "admin"]);
  const gateway = ctx.opts.billing?.gateway;
  if (!gateway) throw new HttpError(503, "card payments aren't switched on yet");
  const b = await body(req);
  const card = await gateway.finishCardSetup(str(b.sessionId, "card setup", 300));
  const today = pacificToday();
  await withSystem(ctx.pool, async (tx) => {
    await saveCard(tx, ctx.orgId, card, today);
    await appendAudit(tx, {
      orgId: ctx.orgId, actor: ctx.actor.id, action: "billing.card_saved", objectType: "organization", objectId: ctx.orgId,
      after: { brand: card.brand, last4: card.last4 }, context: { role: ctx.role },
    });
  });
  // Anything due (a trial that already ended, a failed payment) is charged to the new card straight away.
  const run = await runBilling(ctx.pool, billingCfg(ctx), today, ctx.orgId);
  return json({ ok: true, card: { brand: card.brand, last4: card.last4 }, charged: run.charged, failed: run.failed });
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
    return json({ entity, accounts, periods, connections, salesTaxCategories: currentCategories(entity.region) });
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
    const owner = { invoice: "void the invoice instead", bill: "void the bill instead", bank_line: "undo it from the Bank page instead", payment: "payments can't be reversed yet", tax_deposit: "tax deposits can't be reversed yet" } as Record<string, string>;
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
  const asOf = new URL(req.url).searchParams.get("asOf") ?? pacificToday();
  return tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return json(await trialBalance(tx, p.entity!, date(asOf, "asOf")));
  });
});

route("GET", "/api/orgs/:org/entities/:entity/tax-export", async (req, p, ctx) => {
  const asOf = date(new URL(req.url).searchParams.get("asOf") ?? pacificToday(), "asOf");
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
    return createContact(tx, { orgId: ctx.orgId, entityId: p.entity!, kind, name: str(b.name, "name"), ...contactFields(b), actor: ctx.actor });
  });
  return json(contact, 201);
});

route("POST", "/api/orgs/:org/entities/:entity/contacts/:contact", async (req, p, ctx) => {
  const b = await body(req);
  const contact = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return updateContact(tx, {
      orgId: ctx.orgId, entityId: p.entity!, contactId: p.contact!, ...contactFields(b),
      ...(b.name !== undefined ? { name: str(b.name, "name") } : {}), actor: ctx.actor,
    });
  });
  return json(contact);
});

/** The optional parts of a contact, from a request. A field left out is left alone. */
function contactFields(b: Record<string, any>) {
  const optional = (v: unknown, field: string, max: number) => (typeof v === "string" && v.trim() ? str(v, field, max) : null);
  return {
    ...(b.email !== undefined ? { email: optional(b.email, "email", 200) } : {}),
    ...(b.address !== undefined ? { address: cleanAddress(b.address) } : {}),
    ...(b.resalePermit !== undefined ? { resalePermit: optional(b.resalePermit, "seller's permit", 40) } : {}),
    ...(b.directPayPermit !== undefined ? { directPayPermit: optional(b.directPayPermit, "direct payment permit", 40) } : {}),
    ...(b.mpu !== undefined ? {
      mpu: b.mpu && (b.mpu.caPercent !== undefined && String(b.mpu.caPercent).trim() !== "")
        ? { caPercent: str(String(b.mpu.caPercent), "California share", 10), certificateDate: date(b.mpu.certificateDate, "certificate date") }
        : null,
    } : {}),
    ...(typeof b.accrueUseTax === "boolean" ? { accrueUseTax: b.accrueUseTax } : {}),
  };
}

function invoiceLines(raw: unknown): InvoiceLineInput[] {
  if (!Array.isArray(raw) || !raw.length) throw new HttpError(400, "add at least one line");
  if (raw.length > 200) throw new HttpError(400, "too many lines");
  return raw.map((l: any, i: number) => ({
    itemId: l.itemId ? uuid(l.itemId, `line ${i + 1}: choose a product or service`) : undefined,
    account: typeof l.account === "string" && l.account ? str(l.account, `line ${i + 1} account`, 40) : undefined,
    description: typeof l.description === "string" ? l.description.slice(0, 300) : "",
    quantity: str(String(l.quantity ?? "1"), `line ${i + 1} quantity`, 20),
    unitPrice: typeof l.unitPrice === "string" && l.unitPrice.trim() ? str(l.unitPrice, `line ${i + 1} price`, 20) : undefined,
    taxCategory: typeof l.taxCategory === "string" && l.taxCategory ? str(l.taxCategory, `line ${i + 1} kind of sale`, 40) : undefined,
    servicePeriodStart: l.servicePeriodStart ? date(l.servicePeriodStart, `line ${i + 1} access start`) : undefined,
    servicePeriodEnd: l.servicePeriodEnd ? date(l.servicePeriodEnd, `line ${i + 1} access end`) : undefined,
  }));
}

/** An owner's or accountant's own rate, with the reason, for when the lookup can't be used. */
function manualTax(v: any): { ratePercent: string; reason: string } | undefined {
  if (!v || (v.ratePercent === undefined && v.reason === undefined)) return undefined;
  return { ratePercent: str(String(v.ratePercent ?? ""), "tax rate", 10), reason: str(v.reason, "reason for setting the rate", 300) };
}

route("POST", "/api/orgs/:org/entities/:entity/invoices/tax-preview", async (req, p, ctx) => {
  const b = await body(req);
  const lines = invoiceLines(b.lines);
  return tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    const items = await listItems(tx, p.entity!);
    const categories = lines.map((l) => l.taxCategory || items.find((it) => it.id === l.itemId)?.taxCategory || "");
    const manual = manualTax(b.manualTax);
    const amount = (l: InvoiceLineInput) => {
      try { return priceLine(l.quantity, parseMoney(l.unitPrice ?? "0").minor, false, "0").amountMinor; } catch { return 0n; }
    };
    const d = await decideSalesTax(tx, {
      entityId: p.entity!, contactId: uuid(b.contactId, "choose a customer"), date: date(b.issueDate, "date"), categories,
      lines: lines.map((l) => ({ periodStart: l.servicePeriodStart, periodEnd: l.servicePeriodEnd, amountMinor: amount(l) })),
      lookup: ctx.opts.taxRates, manual: manual ? { ...manual, actor: ctx.actor } : undefined,
    });
    return json({ ...d, explanation: explainTax(d) });
  });
});

route("POST", "/api/orgs/:org/entities/:entity/bills/use-tax-preview", async (req, p, ctx) => {
  const b = await body(req);
  const lines = invoiceLines(b.lines);
  return tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    const manual = manualTax(b.manualTax);
    const d = await decideUseTax(tx, {
      entityId: p.entity!, date: date(b.issueDate, "date"), categories: lines.map((l) => l.taxCategory ?? ""),
      lines: lines.map((l) => ({ periodStart: l.servicePeriodStart, periodEnd: l.servicePeriodEnd })),
      lookup: ctx.opts.taxRates, manual: manual ? { ...manual, actor: ctx.actor } : undefined,
    });
    return json({ ...d, explanation: explainUseTax(d) });
  });
});

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
    const lines = invoiceLines(b.lines);
    const common = {
      orgId: ctx.orgId, entityId: p.entity!,
      contactId: uuid(b.contactId, kind === "invoice" ? "choose a customer" : "choose a vendor"),
      issueDate: date(b.issueDate, "date"),
      dueDate: b.dueDate ? date(b.dueDate, "due date") : undefined,
      memo: typeof b.memo === "string" ? b.memo.slice(0, 300) : "",
      reference: typeof b.reference === "string" ? b.reference.slice(0, 60) : undefined,
      idempotencyKey: typeof b.idempotencyKey === "string" && b.idempotencyKey ? b.idempotencyKey.slice(0, 100) : crypto.randomUUID(),
      actor: ctx.actor,
    };
    const doc = await tenant(
      ctx,
      async (tx) => {
        await ensureEntity(tx, p.entity!);
        if (kind === "invoice") return issueInvoice(tx, { ...common, lines, lookup: ctx.opts.taxRates, manual: manualTax(b.manualTax) });
        return recordBill(tx, {
          ...common,
          useTax: typeof b.useTax === "boolean" ? b.useTax : undefined, lookup: ctx.opts.taxRates, manual: manualTax(b.manualTax),
          lines: lines.map((l, i) => {
            if (!l.account) throw new HttpError(400, `line ${i + 1}: choose an account`);
            if (!l.unitPrice) throw new HttpError(400, `line ${i + 1}: enter a price`);
            return {
              account: l.account, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice,
              ...(l.taxCategory ? { taxCategory: l.taxCategory } : {}),
              ...(l.servicePeriodStart ? { servicePeriodStart: l.servicePeriodStart } : {}),
              ...(l.servicePeriodEnd ? { servicePeriodEnd: l.servicePeriodEnd } : {}),
            };
          }),
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

// California books: "today" is the Pacific date, so evening work isn't dated tomorrow.
const serverToday = () => pacificToday();

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
    const cell = csvCell;
    const lines = [`${kind === "invoice" ? "Receivables" : "Payables"} aging,as of ${asOf}`, "Number,Contact,Due date,Days past due,Bucket,Still due"];
    for (const r of ag.rows) lines.push([r.number, cell(r.contactName), r.dueDate, String(r.daysPastDue), r.bucket, toMajor(r.dueMinor).toFixed(2)].join(","));
    lines.push(`Total,,,,,${toMajor(ag.totalMinor).toFixed(2)}`);
    return csvResponse(lines.join("\n") + "\n", `${kind === "invoice" ? "receivables" : "payables"}-aging-${asOf}.csv`);
  });
}

// ------------------------------------------------- products and sales tax

route("GET", "/api/orgs/:org/entities/:entity/items", async (_req, p, ctx) =>
  tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return json({ items: await listItems(tx, p.entity!) });
  }),
);

function itemFields(b: Record<string, any>) {
  return {
    ...(b.name !== undefined ? { name: str(b.name, "name", 120) } : {}),
    ...(typeof b.description === "string" ? { description: b.description.slice(0, 300) } : {}),
    ...(b.taxCategory !== undefined ? { taxCategory: str(b.taxCategory, "kind of sale", 40) } : {}),
    ...(b.unitPrice !== undefined ? { unitPrice: String(b.unitPrice ?? "").trim().slice(0, 20) } : {}),
    ...(typeof b.account === "string" && b.account ? { account: str(b.account, "account", 40) } : {}),
    ...(typeof b.active === "boolean" ? { active: b.active } : {}),
  };
}

route("POST", "/api/orgs/:org/entities/:entity/items", async (req, p, ctx) => {
  const b = await body(req);
  const item = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return createItem(tx, { orgId: ctx.orgId, entityId: p.entity!, ...itemFields(b), actor: ctx.actor });
  });
  return json(item, 201);
});

route("POST", "/api/orgs/:org/entities/:entity/items/:item", async (req, p, ctx) => {
  const b = await body(req);
  await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    await updateItem(tx, { orgId: ctx.orgId, entityId: p.entity!, itemId: p.item!, ...itemFields(b), actor: ctx.actor });
  });
  return json({ ok: true });
});

route("GET", "/api/orgs/:org/entities/:entity/reports/sales-tax", async (req, p, ctx) => {
  const q = new URL(req.url).searchParams;
  const from = date(q.get("from"), "from"), to = date(q.get("to"), "to");
  const r = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return salesTaxReport(tx, p.entity!, from, to);
  });
  if (q.get("format") !== "csv") return json(r);
  const m = (v: bigint) => toMajor(v).toFixed(2);
  const cell = csvCell;
  const lines = [
    `Sales tax return figures,${from} to ${to}`, "Line,Amount",
    `Total sales,${m(r.totalSalesMinor)}`,
    ...r.nontaxable.map((n) => `${cell(`Nontaxable: ${n.label}`)},${m(n.amountMinor)}`),
    `Sales for resale,${m(r.resaleMinor)}`, `Sales delivered outside California,${m(r.interstateMinor)}`,
    `Software to buyers who pay use tax directly,${m(r.directPayMinor)}`, `Software used outside California (multiple-points-of-use certificates),${m(r.outsideCaUseMinor)}`,
    `Taxable sales,${m(r.taxableMinor)}`, `Sales tax charged,${m(r.taxMinor)}`, "",
    "Jurisdiction,Rate %,Invoices,Taxable sales,Tax",
    ...r.byJurisdiction.map((j) => [cell(j.jurisdiction), j.ratePercent, String(j.invoices), m(j.taxableMinor), m(j.taxMinor)].join(",")),
    "", `Purchases subject to use tax,${m(r.useTax.purchasesMinor)}`, `Use tax owed on purchases,${m(r.useTax.taxMinor)}`,
    ...(r.useTax.byJurisdiction.length ? ["", "Use tax by jurisdiction,Rate %,Bills,Purchases,Use tax",
      ...r.useTax.byJurisdiction.map((j) => [cell(j.jurisdiction), j.ratePercent, String(j.bills), m(j.purchasesMinor), m(j.taxMinor)].join(","))] : []),
    "", `Sales and use tax payable on ${to},${m(r.payableMinor)}`,
  ];
  return csvResponse(lines.join("\n") + "\n", `sales-tax-${from}-to-${to}.csv`);
});

route("GET", "/api/orgs/:org/entities/:entity/backups", async (_req, p, ctx) =>
  tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return json({ restorePoints: await listRestorePoints(tx, p.entity!), downloadable: Boolean(ctx.opts.backups) });
  }),
);

// Downloads one nightly copy, decrypted. A POST because it is recorded in the audit log.
route("POST", "/api/orgs/:org/entities/:entity/backups/:run/download", async (_req, p, ctx) => {
  requireRole(ctx, ["owner", "admin", "accountant"]);
  const backups = ctx.opts.backups;
  if (!backups) throw new HttpError(503, "nightly backups aren't set up on this site yet");
  const backup = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    let b;
    try {
      b = await readRestorePoint(tx, backups.store, backups.key, p.entity!, p.run!);
    } catch (err) {
      throw new HttpError(404, err instanceof Error ? err.message : "that backup isn't available");
    }
    await appendAudit(tx, {
      orgId: ctx.orgId, entityId: p.entity!, actor: ctx.actor.id, action: "entity.restore_point_downloaded",
      objectType: "entity", objectId: p.entity!, after: { takenAt: b.createdAt }, context: { role: ctx.role },
    });
    return b;
  });
  const name = `trailbook-backup-${String(backup.entity.legal_name).toLowerCase()}-${backup.createdAt.slice(0, 10)}.json`.replace(/[^\w.-]+/g, "-");
  return json(backup, 200, { "content-disposition": `attachment; filename="${name}"` });
});

// A POST, not a GET, because taking a backup is recorded in the audit log.
route("POST", "/api/orgs/:org/entities/:entity/backup", async (_req, p, ctx) => {
  requireRole(ctx, ["owner", "admin", "accountant"]);
  const backup = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return backupEntity(tx, { orgId: ctx.orgId, entityId: p.entity!, actor: ctx.actor });
  });
  const name = `trailbook-backup-${String(backup.entity.legal_name).toLowerCase()}-${backup.createdAt.slice(0, 10)}.json`.replace(/[^\w.-]+/g, "-");
  return json(backup, 200, { "content-disposition": `attachment; filename="${name}"` });
});

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
    const today = pacificToday();
    const year = Number(today.slice(0, 4));
    const open = [...await taxDeposits(tx, p.entity!, year - 1, today), ...await taxDeposits(tx, p.entity!, year, today)]
      .filter((d) => d.status === "overdue" || d.status === "due_soon");
    return json({ ...(await attention(tx, p.entity!, serverToday())), taxDepositsDue: open.length });
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

route("POST", "/api/orgs/:org/entities/:entity/address", async (req, p, ctx) => {
  requireRole(ctx, ["owner", "admin"]);
  const b = await body(req);
  const address = cleanAddress(b.address);
  await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    await setBusinessAddress(tx, { orgId: ctx.orgId, entityId: p.entity!, address, actor: ctx.actor });
  });
  return json({ ok: true, address });
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

const toJson = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

route("GET", "/api/orgs/:org/entities/:entity/employees", async (_req, p, ctx) =>
  tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    const uiRate = (await tx.query("SELECT ca_ui_rate::text FROM entities WHERE id = $1", [p.entity])).rows[0]?.ca_ui_rate;
    const employees = await listEmployees(tx, p.entity!);
    return json({
      employees: withLocalMinimums(employees, pacificToday()), caUiRate: uiRate ? String(Number(uiRate)) : null,
      directDeposit: await getDirectDepositSettings(tx, p.entity!), workCities: LOCAL_MINIMUM_WAGE_PLACES,
    });
  }),
);

route("POST", "/api/orgs/:org/entities/:entity/employees", async (req, p, ctx) => {
  const b = await body(req);
  const employee = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return createEmployee(tx, { orgId: ctx.orgId, entityId: p.entity!, ...employeeFields(b), actor: ctx.actor });
  });
  return json(employee, 201);
});

route("POST", "/api/orgs/:org/entities/:entity/employees/:employee", async (req, p, ctx) => {
  const b = await body(req);
  const employeeId = uuid(p.employee, "employee not found");
  const { employee, before, business } = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    const before = (await tx.query("SELECT dd_routing, dd_account_last4 FROM employees WHERE id = $1 AND entity_id = $2", [employeeId, p.entity])).rows[0];
    const business = (await tx.query("SELECT legal_name FROM entities WHERE id = $1", [p.entity])).rows[0].legal_name as string;
    const employee = await updateEmployee(tx, { orgId: ctx.orgId, entityId: p.entity!, employeeId, ...employeeFields(b), actor: ctx.actor });
    return { employee, before, business };
  });
  // Changed pay-to bank details are the usual way payroll gets diverted, so every owner and admin hears about it.
  const after = employee.directDeposit;
  if (before && ((before.dd_routing ?? null) !== (after?.routing ?? null) || (before.dd_account_last4 ?? null) !== (after?.accountLast4 ?? null))) {
    await notifyAdmins(ctx, {
      subject: `Direct deposit details changed for ${employee.name}`,
      text: `${ctx.user.name} (${ctx.user.email}) changed where ${employee.name}'s pay is deposited, for ${business} on TrailBook.\n\n` +
        `Before: ${before?.dd_account_last4 ? `account ending ${before.dd_account_last4}` : "no account"}\nNow: ${after?.accountLast4 ? `account ending ${after.accountLast4}` : "no account"}\n\n` +
        "If you didn't expect this, confirm it with the employee directly (not by replying to an email) before approving the next pay run.\n",
    });
  }
  return json(employee);
});

/** Emails every owner and admin of the organisation. Best effort: a failed email doesn't undo the change. */
async function notifyAdmins(ctx: Ctx, msg: { subject: string; text: string }) {
  if (!ctx.opts.mailer) return;
  const { rows } = await ctx.pool.query(
    "SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 AND m.role IN ('owner', 'admin')",
    [ctx.orgId],
  );
  for (const r of rows) {
    try {
      await ctx.opts.mailer({ to: r.email, ...msg });
    } catch (err) {
      console.error("admin notice failed", err);
    }
  }
}

/** Each hourly employee paid below a higher city or county minimum wage today gets `belowLocalMinimum`. */
function withLocalMinimums(employees: Employee[], today: string) {
  let stateMinimum: string;
  try {
    stateMinimum = resolveRules({ country: "US", region: "CA" }, today).state.wageHour.minimumWage;
  } catch {
    return employees;
  }
  const headcount = employeeCount(employees, today);
  return employees.map((e) => {
    const local = e.payType === "hourly" && e.status === "active" ? localMinimumAbove(stateMinimum, e.workCity, today, headcount) : null;
    return local && new D(e.payRate).lt(local.rate) ? { ...e, belowLocalMinimum: local } : e;
  });
}

/** The parts of an employee in a request; a field left out is left alone. Checked in payroll/employees.ts. */
function employeeFields(b: Record<string, any>): EmployeeFields {
  const keys = ["name", "email", "address", "workCity", "hireDate", "terminationDate", "payType", "payFrequency", "payRate", "usualHours",
    "overtimeExempt", "w4", "de4", "deductions", "sickBalanceHours", "ssn", "openingYtd", "directDeposit"] as const;
  const out: Record<string, unknown> = {};
  for (const k of keys) if (b[k] !== undefined) out[k] = b[k];
  for (const k of ["name", "email", "workCity", "hireDate", "terminationDate", "payType", "payFrequency", "payRate", "usualHours", "sickBalanceHours", "ssn"]) {
    if (out[k] !== undefined && out[k] !== null && typeof out[k] !== "string") throw new HttpError(400, `${k} should be text`);
  }
  for (const k of ["w4", "de4", "openingYtd", "address", "directDeposit"]) {
    if (out[k] !== undefined && out[k] !== null && typeof out[k] !== "object") throw new HttpError(400, `${k} should be an object`);
  }
  return out as EmployeeFields;
}

route("POST", "/api/orgs/:org/entities/:entity/payroll-settings", async (req, p, ctx) => {
  const b = await body(req);
  const percent = typeof b.caUiRatePercent === "string" && b.caUiRatePercent.trim() ? b.caUiRatePercent.trim() : null;
  if (percent !== null && !/^\d{1,2}(\.\d{1,3})?$/.test(percent)) throw new HttpError(400, "the UI rate should be a percentage like 3.4");
  await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    if (b.caUiRatePercent !== undefined) {
      await setUiRate(tx, { orgId: ctx.orgId, entityId: p.entity!, rate: percent === null ? null : new D(percent).div(100).toString(), actor: ctx.actor });
    }
    if (b.caEmployerAccount !== undefined) {
      const account = typeof b.caEmployerAccount === "string" ? b.caEmployerAccount.replace(/[\s-]/g, "") : "";
      if (account && !/^\d{8}$/.test(account)) throw new HttpError(400, "the EDD account number has 8 digits, like 123-4567-8");
      requireRole(ctx, ["owner", "admin", "accountant"]);
      const before = (await tx.query("SELECT ca_employer_account FROM entities WHERE id = $1", [p.entity])).rows[0].ca_employer_account;
      await tx.query("UPDATE entities SET ca_employer_account = $2 WHERE id = $1", [p.entity, account || null]);
      await appendAudit(tx, {
        orgId: ctx.orgId, entityId: p.entity!, actor: ctx.actor.id, action: "entity.updated", objectType: "entity", objectId: p.entity!,
        before: { caEmployerAccount: before }, after: { caEmployerAccount: account || null }, context: { role: ctx.role },
      });
    }
    if (b.federalDepositSchedule !== undefined) {
      await setFederalDepositSchedule(tx, { orgId: ctx.orgId, entityId: p.entity!, schedule: String(b.federalDepositSchedule), actor: ctx.actor });
    }
  });
  return json({ ok: true });
});

/** Payroll tax deposits for a year: what's due when, and what's been paid. */
route("GET", "/api/orgs/:org/entities/:entity/tax-deposits", async (req, p, ctx) => {
  const today = pacificToday();
  const yearParam = new URL(req.url).searchParams.get("year");
  const year = yearParam ? Number(yearParam) : Number(today.slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, "year should be like 2026");
  return tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    const deposits = await taxDeposits(tx, p.entity!, year, today);
    // December's deposits fall due in January, so the start of a year also shows last year's still open.
    const carried = (await taxDeposits(tx, p.entity!, year - 1, today)).filter((d) => d.status !== "paid");
    return new Response(toJson({ year, today, federalSchedule: await federalDepositSchedule(tx, p.entity!), deposits: [...carried, ...deposits] }), {
      headers: { "content-type": "application/json" },
    });
  });
});

route("POST", "/api/orgs/:org/entities/:entity/tax-deposits/pay", async (req, p, ctx) => {
  const b = await body(req);
  const key = str(b.key, "deposit", 200);
  const paidDate = date(b.paidDate, "paid date");
  const today = pacificToday();
  if (paidDate > today) throw new HttpError(400, "the paid date can't be in the future");
  const paid = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return recordDepositPayment(tx, {
      orgId: ctx.orgId, entityId: p.entity!, key, paidDate, today,
      bankAccount: typeof b.bankAccount === "string" ? b.bankAccount : undefined,
      confirmation: typeof b.confirmation === "string" ? b.confirmation : undefined, actor: ctx.actor,
    });
  });
  return new Response(toJson(paid), { status: 201, headers: { "content-type": "application/json" } });
});

/** Prepared payroll tax forms: the list, and each form's figures (JSON, or CSV of its employee rows). */
route("GET", "/api/orgs/:org/entities/:entity/payroll-forms", async (req, p, ctx) => {
  const today = pacificToday();
  const year = Number(new URL(req.url).searchParams.get("year") ?? today.slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, "year should be like 2026");
  return tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    const ca = (await tx.query("SELECT ca_employer_account FROM entities WHERE id = $1", [p.entity])).rows[0].ca_employer_account;
    return json({ year, forms: formsFor(year, today), caEmployerAccount: ca });
  });
});

route("GET", "/api/orgs/:org/entities/:entity/payroll-forms/prepared", async (req, p, ctx) => {
  const q = new URL(req.url).searchParams;
  const year = Number(q.get("year"));
  const quarter = Number(q.get("quarter") ?? 1);
  const fullSsn = q.get("ssn") === "full";
  const form = await tenant(ctx, async (tx): Promise<PreparedForm> => {
    await ensureEntity(tx, p.entity!);
    const base = { orgId: ctx.orgId, entityId: p.entity!, year, actor: ctx.actor, fullSsn };
    switch (q.get("form")) {
      case "941": return form941(tx, p.entity!, year, quarter);
      case "940": return form940(tx, p.entity!, year);
      case "de9": return formDe9(tx, { ...base, quarter });
      case "w2": return formW2(tx, base);
      default: throw new HttpError(404, "no such form");
    }
  });
  if (q.get("format") === "csv") {
    if (!form.employees) throw new HttpError(400, "this form has no employee rows to download");
    const cents = (v: unknown) => (typeof v === "bigint" ? (Number(v) / 100).toFixed(2) : v);
    const flat = form.employees.map((row) => Object.fromEntries(Object.entries(row).flatMap(([k, v]): [string, unknown][] => {
      if (Array.isArray(v)) return [[k, v.map((x: any) => `${x.code ?? x.label} ${cents(x.amountMinor)}`).join("; ")]];
      if (v && typeof v === "object") return Object.entries(v).map(([k2, v2]) => [`${k}.${k2}`, v2]);
      return [[k, cents(v)]];
    })));
    const cols = [...new Set(flat.flatMap((r) => Object.keys(r)))];
    const cell = csvCell;
    const csv = [cols.join(","), ...flat.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8", "cache-control": "no-store",
        "content-disposition": `attachment; filename="${form.form.replace(/\s/g, "")}-${form.period.replace(/\s/g, "-")}.csv"`,
      },
    });
  }
  return new Response(toJson(form), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
});

/** The business's own sales tax: its seller's permit, filing frequency and return periods. */
route("GET", "/api/orgs/:org/entities/:entity/sales-tax", async (req, p, ctx) => {
  const today = pacificToday();
  const year = Number(new URL(req.url).searchParams.get("year") ?? today.slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, "year should be like 2027");
  return tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    const settings = await salesTaxSettings(tx, p.entity!);
    const periods = settings.filingFrequency ? returnPeriods(settings.filingFrequency, year, today) : [];
    return json({ year, today, ...settings, frequencies: FILING_FREQUENCIES, periods });
  });
});

route("POST", "/api/orgs/:org/entities/:entity/sales-tax-settings", async (req, p, ctx) => {
  const b = await body(req);
  for (const k of ["sellerPermit", "filingFrequency"]) if (b[k] !== undefined && b[k] !== null && typeof b[k] !== "string") throw new HttpError(400, `${k} should be text`);
  const saved = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return setSalesTaxSettings(tx, { orgId: ctx.orgId, entityId: p.entity!, sellerPermit: b.sellerPermit, filingFrequency: b.filingFrequency as FilingFrequency | null | undefined, actor: ctx.actor });
  });
  return json(saved);
});

/** The prepared return for one period. */
route("GET", "/api/orgs/:org/entities/:entity/sales-tax/return", async (req, p, ctx) => {
  const period = new URL(req.url).searchParams.get("period") ?? "";
  return tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return json(await prepareSalesTaxReturn(tx, p.entity!, period));
  });
});

/** The business's bank details for direct deposit files. */
route("POST", "/api/orgs/:org/entities/:entity/direct-deposit-settings", async (req, p, ctx) => {
  const b = await body(req);
  const keys = ["odfiRouting", "immediateDestination", "destinationName", "immediateOrigin", "companyId", "companyName", "accountType", "account"];
  for (const k of keys) if (b[k] !== undefined && b[k] !== null && typeof b[k] !== "string") throw new HttpError(400, `${k} should be text`);
  const saved = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return saveDirectDepositSettings(tx, { ...Object.fromEntries(keys.map((k) => [k, b[k]])), balanced: b.balanced === true, orgId: ctx.orgId, entityId: p.entity!, actor: ctx.actor });
  });
  return json(saved);
});

function payRunRequest(b: Record<string, any>): PayRunRequest {
  if (!Array.isArray(b.lines)) throw new HttpError(400, "pick the employees to pay");
  if (b.lines.length > 500) throw new HttpError(400, "too many employees in one run");
  const amount = (v: unknown, field: string) => {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string" || !/^\d{1,7}(\.\d{1,4})?$/.test(v.trim())) throw new HttpError(400, `${field} must be a number like 25.00`);
    return v.trim();
  };
  return {
    periodStart: date(b.periodStart, "period start"),
    periodEnd: date(b.periodEnd, "period end"),
    payDate: date(b.payDate, "pay date"),
    lines: b.lines.map((l: any, i: number) => {
      const n = `line ${i + 1}`;
      if (Array.isArray(l.dailyHours) && l.dailyHours.some((h: unknown) => h !== "" && h !== null && !Number.isFinite(Number(h)))) {
        throw new HttpError(400, `${n}: daily hours must be numbers`);
      }
      return {
        employeeId: uuid(l.employeeId, `${n}: employee not found`),
        regularHours: amount(l.regularHours, `${n} hours`),
        overtimeHours: amount(l.overtimeHours, `${n} overtime`),
        doubleTimeHours: amount(l.doubleTimeHours, `${n} double time`),
        dailyHours: Array.isArray(l.dailyHours) ? l.dailyHours.map((h: unknown) => String(h ?? "")) : undefined,
        bonus: amount(l.bonus, `${n} bonus`),
        commission: amount(l.commission, `${n} commission`),
        reimbursement: amount(l.reimbursement, `${n} reimbursement`),
      };
    }),
  };
}

route("POST", "/api/orgs/:org/entities/:entity/pay-runs/preview", async (req, p, ctx) => {
  const request = payRunRequest(await body(req));
  return tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    const input = await payRunInputFromEmployees(tx, p.entity!, request, crypto.randomUUID());
    return json(await calculateSavedRun(tx, p.entity!, input));
  });
});

route("POST", "/api/orgs/:org/entities/:entity/pay-runs", async (req, p, ctx) => {
  requireRole(ctx, ["owner", "admin", "bookkeeper", "accountant"]);
  const request = payRunRequest(await body(req));
  const saved = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    const input = await payRunInputFromEmployees(tx, p.entity!, request, crypto.randomUUID());
    const run = await calculateSavedRun(tx, p.entity!, input);
    await tx.query(
      `INSERT INTO pay_runs (id, org_id, entity_id, input, result, prepared_by, pay_date) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [input.payRunId, ctx.orgId, p.entity, toJson(input), toJson(run), ctx.actor.id, input.payDate],
    );
    await appendAudit(tx, {
      orgId: ctx.orgId, entityId: p.entity!, actor: ctx.actor.id, action: "pay_run.prepared",
      objectType: "pay_run", objectId: input.payRunId, after: { totals: run.totals, rulePacks: run.rulePacks },
    });
    return { id: input.payRunId, run };
  });
  return json(saved, 201);
});

route("GET", "/api/orgs/:org/entities/:entity/pay-runs", async (_req, p, ctx) =>
  tenant(ctx, async (tx) => {
    const { rows } = await tx.query(
      `SELECT id, status, prepared_by, approved_by, entry_id, created_at, result
         FROM pay_runs WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [p.entity],
    );
    return json({ payRuns: rows, soleApprover: await soleApprover(ctx) });
  }),
);

/** One run with what its pay stubs need: the business, each employee and their year to date through this run. */
route("GET", "/api/orgs/:org/entities/:entity/pay-runs/:run", async (_req, p, ctx) =>
  tenant(ctx, async (tx) => {
    const { rows } = await tx.query(
      "SELECT id, status, prepared_by, approved_by, entry_id, created_at, result, pay_date::text FROM pay_runs WHERE id = $1 AND entity_id = $2",
      [uuid(p.run, "pay run not found"), p.entity],
    );
    const pr = rows[0];
    if (!pr) throw new HttpError(404, "pay run not found");
    const ent = (await tx.query("SELECT legal_name, ein, address_line1, address_city, address_state, address_zip FROM entities WHERE id = $1", [p.entity])).rows[0];
    const people = new Map((await listEmployees(tx, p.entity!)).map((e) => [e.id, e]));
    // A posted run's stubs show the year through this run; a prepared one adds itself to what's posted so far.
    const ytd = await yearToDate(tx, p.entity!, pr.pay_date ?? pr.result.payDate, pr.status === "posted" ? { throughRunId: pr.id } : {});
    if (pr.status !== "posted") {
      for (const c of pr.result.paychecks) {
        const y = ytd.get(c.employeeId) ?? { grossMinor: 0n, netPayMinor: 0n, byTax: {}, byDeduction: {} } as any;
        y.grossMinor += BigInt(c.grossMinor);
        y.netPayMinor += BigInt(c.netPayMinor);
        for (const t of c.taxes) y.byTax[t.code] = (y.byTax[t.code] ?? 0n) + BigInt(t.amountMinor);
        for (const d of c.deductions) y.byDeduction[d.kind] = (y.byDeduction[d.kind] ?? 0n) + BigInt(d.amountMinor);
        ytd.set(c.employeeId, y);
      }
    }
    const stubs = pr.result.paychecks.map((c: any) => {
      const e = people.get(c.employeeId);
      const y = ytd.get(c.employeeId);
      return {
        employeeId: c.employeeId, ssnLast4: e?.ssnLast4 ?? null, address: e?.address ?? null, payType: e?.payType ?? null,
        ytd: y ? { grossMinor: y.grossMinor, netPayMinor: y.netPayMinor, byTax: y.byTax, byDeduction: y.byDeduction } : null,
      };
    });
    const directDeposit = await directDepositSummary(tx, p.entity!, pr.id);
    return new Response(toJson({
      ...pr,
      soleApprover: await soleApprover(ctx),
      directDeposit,
      employer: { name: ent.legal_name, ein: ent.ein, address: ent.address_line1 ? { line1: ent.address_line1, city: ent.address_city, state: ent.address_state, zip: ent.address_zip } : null },
      stubs,
    }), { headers: { "content-type": "application/json" } });
  }),
);

/** The bank file for an approved run, to upload to the business's bank. */
route("GET", "/api/orgs/:org/entities/:entity/pay-runs/:run/direct-deposit", async (_req, p, ctx) => {
  const file = await tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    return directDepositFile(tx, { orgId: ctx.orgId, entityId: p.entity!, runId: uuid(p.run, "pay run not found"), actor: ctx.actor });
  });
  return new Response(file.text, {
    headers: {
      "content-type": "text/plain; charset=us-ascii",
      "content-disposition": `attachment; filename="${file.fileName}"`,
      "cache-control": "no-store",
    },
  });
});

/** True when nobody in the organisation but this person can approve pay runs, so they may approve runs they prepared. */
async function soleApprover(ctx: Ctx): Promise<boolean> {
  const { rows } = await ctx.pool.query(
    "SELECT count(*)::int AS n FROM memberships WHERE org_id = $1 AND user_id <> $2 AND role IN ('owner', 'admin', 'approver')",
    [ctx.orgId, ctx.user.id],
  );
  return rows[0].n === 0;
}

route("POST", "/api/orgs/:org/entities/:entity/pay-runs/:run/approve", async (_req, p, ctx) => {
  requireRole(ctx, ["owner", "admin", "approver"]);
  const sole = await soleApprover(ctx);
  const entry = await tenant(ctx, async (tx) => {
    const { rows } = await tx.query(
      "SELECT input, prepared_by, status FROM pay_runs WHERE id = $1 AND entity_id = $2 FOR UPDATE",
      [uuid(p.run, "pay run not found"), p.entity],
    );
    const pr = rows[0];
    if (!pr) throw new HttpError(404, "pay run not found");
    if (pr.status !== "prepared") throw new HttpError(409, `pay run is already ${pr.status}`);
    // California pay stubs must show the employer's legal name and address (Labor Code 226(a)(8)).
    const addr = (await tx.query("SELECT address_line1 FROM entities WHERE id = $1", [p.entity])).rows[0];
    if (!addr?.address_line1) throw new HttpError(409, "add the business address on the Overview page first; California pay stubs must show it");
    // Recalculate from the saved input, with year-to-date wages as they stand now, so the
    // posted figures can't be tampered with in transit and caps count every earlier run.
    const run = await calculateSavedRun(tx, p.entity!, pr.input as PayRunInput);
    const posted = await approveAndPostPayRun(tx, {
      orgId: ctx.orgId, entityId: p.entity!, run,
      preparedBy: { id: pr.prepared_by, role: "bookkeeper" }, approvedBy: ctx.actor, soleApprover: sole,
    });
    await tx.query("UPDATE pay_runs SET status = 'posted', approved_by = $2, entry_id = $3, result = $4 WHERE id = $1", [p.run, ctx.actor.id, posted.id, toJson(run)]);
    await carrySickLeave(tx, p.entity!, run.paychecks);
    return posted;
  });
  return json(entry, 201);
});

// --------------------------------------------------------------- dispatch

/** Still allowed when unpaid books are read-only: paying, leaving, security (removing people), and taking the books away. */
const ALWAYS_ALLOWED = /\/(billing(\/.*)?|leave|security|backup|backups\/[^/]+\/download|members\/[^/]+\/remove|invitations\/[^/]+\/revoke)$/;

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

/** Signs someone in, joining an invitation if they came through one. */
async function startSession(pool: pg.Pool, userId: string, inviteToken?: unknown): Promise<Response> {
  const joined = typeof inviteToken === "string" && inviteToken
    ? (await withSystem(pool, (tx) => acceptInvitation(tx, { token: inviteToken, userId }))).orgId
    : undefined;
  const s = await createSession(pool, userId);
  return json({ ok: true, joined }, 200, { "set-cookie": sessionCookie(s.token, s.maxAge) });
}

/**
 * After a password or an emailed link passed: a session, or, for someone
 * with two-factor on, a ticket for the code step and no session yet. An
 * invitation waits until the code is entered too.
 */
async function signedIn(pool: pg.Pool, userId: string, inviteToken?: unknown): Promise<Response> {
  if ((await mfaStatus(pool, userId)).enabled) {
    return json({ ok: true, mfaRequired: true, ticket: await issueMfaTicket(pool, userId) });
  }
  return startSession(pool, userId, inviteToken);
}

async function requireMfaIfOrgDoes(pool: pg.Pool, orgId: string, userId: string): Promise<void> {
  const { rows } = await pool.query(
    "SELECT o.require_mfa, u.totp_enabled_at IS NOT NULL AS has_mfa FROM organizations o, users u WHERE o.id = $1 AND u.id = $2",
    [orgId, userId],
  );
  if (rows[0]?.require_mfa && !rows[0].has_mfa) {
    throw new HttpError(403, "this organisation requires two-factor sign-in; turn it on under Your account first");
  }
}

/** Turning two-factor sign-in on and off for the signed-in person. */
async function mfaRoutes(req: Request, path: string, pool: pg.Pool, opts: ApiOptions): Promise<Response> {
  const user = await sessionUser(pool, cookie(req, SESSION_COOKIE));
  if (!user) throw new AuthError("not signed in");
  const b = await body(req);
  const notify = async (on: boolean) => {
    if (!opts.mailer) return;
    try {
      await opts.mailer({ to: user.email, ...emailText[on ? "mfa_on" : "mfa_off"](user.name) });
    } catch (err) {
      console.error("two-factor notice failed", err);
    }
  };
  if (path === "/api/me/mfa/setup") {
    if ((await mfaStatus(pool, user.id)).enabled) throw new HttpError(409, "two-factor sign-in is already on");
    return json(await beginMfaSetup(pool, user));
  }
  if (path === "/api/me/mfa/enable") {
    const recoveryCodes = await withSystem(pool, (tx) => enableMfa(tx, user.id, b.code));
    await notify(true);
    return json({ ok: true, recoveryCodes });
  }
  if (path === "/api/me/mfa/disable" || path === "/api/me/mfa/recovery-codes") {
    // Both need the password and a current code, so a borrowed session alone can't weaken the account.
    const row = (await pool.query("SELECT password_hash FROM users WHERE id = $1", [user.id])).rows[0];
    if (!(await verifyPassword(String(b.password ?? ""), row.password_hash))) throw new AuthError("wrong password", 403);
    const out = await withSystem(pool, async (tx) => {
      if (!(await checkSecondFactor(tx, user.id, b.code))) return null;
      if (path.endsWith("disable")) {
        await disableMfa(tx, user.id);
        return [];
      }
      return regenerateRecoveryCodes(tx, user.id);
    });
    if (!out) throw new AuthError("that code isn't right", 403);
    if (path.endsWith("disable")) {
      await notify(false);
      return json({ ok: true });
    }
    return json({ ok: true, recoveryCodes: out });
  }
  throw new HttpError(404, "not found");
}

async function authRoutes(req: Request, path: string, pool: pg.Pool, opts: ApiOptions): Promise<Response | null> {
  if (req.method === "GET" && path === "/api/auth/options") return json({ email: Boolean(opts.mailer) });
  // Checks the sales tax rate lookup end to end with one fixed address
  // (Los Angeles City Hall). Takes no input, so it can't be used to look up
  // anything else; answers are cached like any other lookup.
  if (req.method === "GET" && path === "/api/health/tax-lookup") {
    if (!opts.taxRates) return json({ ok: false, error: "no rate lookup is set up" });
    try {
      const r = await opts.taxRates({ line1: "200 N Spring St", city: "Los Angeles", state: "CA", zip: "90012" });
      return json({ ok: true, address: "200 N Spring St, Los Angeles, CA 90012", rate: r.rate, jurisdiction: r.jurisdiction });
    } catch (err) {
      return json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
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
    return signedIn(pool, user.id);
  }
  if (req.method === "GET" && path === "/api/health") return json({ ok: true });
  // For the public status page: up or down, and last night's backups as counts only.
  if (req.method === "GET" && path === "/api/status") {
    try {
      const b = (await pool.query(
        `SELECT max(backup_date)::text AS night,
                count(*) FILTER (WHERE verified)::int AS verified, count(*) FILTER (WHERE NOT verified)::int AS failed
           FROM backup_runs WHERE backup_date = (SELECT max(backup_date) FROM backup_runs)`,
      )).rows[0];
      return json({ api: true, database: true, backups: { lastNight: b.night, verified: b.verified, failed: b.failed } });
    } catch (err) {
      console.error("status check failed", err);
      return json({ api: true, database: false, backups: { lastNight: null, verified: 0, failed: 0 } });
    }
  }
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
    // Whoever creates an organisation accepts the terms of service for it.
    if (!inviteToken && b.acceptTerms !== true) throw new HttpError(400, "to create an account, agree to the Terms of Service for your business");
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
        await acceptTerms(tx, org.id, uid);
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
    await checkSignInAllowed(pool, email);
    const { rows } = await pool.query("SELECT id, password_hash FROM users WHERE email = $1", [email]);
    const ok = Boolean(rows[0] && (await verifyPassword(String(b.password ?? ""), rows[0].password_hash)));
    await recordSignIn(pool, email, ok);
    if (!ok) throw new AuthError("wrong email or password");
    return signedIn(pool, rows[0].id, b.inviteToken);
  }
  // The second step of signing in, for someone with two-factor on.
  if (req.method === "POST" && path === "/api/auth/mfa") {
    const b = await body(req);
    const out = await withSystem(pool, (tx) => redeemMfaTicket(tx, b.ticket, b.code));
    if ("error" in out) throw new AuthError(out.error);
    return startSession(pool, out.userId, b.inviteToken);
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
    const mfa = await mfaStatus(pool, user.id);
    const accepted = await withSystem(pool, (tx) => orgsAccepted(tx, rows.map((r) => r.id)));
    return json({
      user: { ...user, emailVerified: verified, mfa }, orgs: rows.map((r) => ({ ...r, termsAccepted: accepted.has(r.id) || r.name === EXAMPLE_ORG_NAME })),
      emailEnabled: Boolean(opts.mailer), termsVersion: TERMS_VERSION,
    });
  }
  // An owner or admin accepts the current terms for their organisation.
  const termsPath = /^\/api\/orgs\/([0-9a-f-]{36})\/terms\/accept$/.exec(path);
  if (req.method === "POST" && termsPath) {
    const user = await sessionUser(pool, cookie(req, SESSION_COOKIE));
    if (!user) throw new AuthError("not signed in");
    const b = await body(req);
    if (b.version !== TERMS_VERSION) throw new HttpError(409, "the terms have changed since you opened them; reload and read the current version");
    await withSystem(pool, async (tx) => {
      const m = (await tx.query("SELECT role FROM memberships WHERE user_id = $1 AND org_id = $2", [user.id, termsPath[1]])).rows[0];
      if (!m) throw new HttpError(404, "organisation not found");
      if (!["owner", "admin"].includes(m.role)) throw new HttpError(403, "only an owner or admin can accept the terms for the business");
      await acceptTerms(tx, termsPath[1]!, user.id);
    });
    return json({ ok: true, version: TERMS_VERSION });
  }
  // For the public terms page: the version and who the agreement is with.
  if (req.method === "GET" && path === "/api/terms") {
    const seller = opts.billing?.seller;
    const company = seller
      ? await withSystem(pool, async (tx) => (await tx.query("SELECT legal_name FROM entities WHERE id = $1 AND org_id = $2", [seller.entityId, seller.orgId])).rows[0]?.legal_name ?? null)
      : null;
    return json({ version: TERMS_VERSION, company });
  }
  if (path.startsWith("/api/me/mfa/") && req.method === "POST") return mfaRoutes(req, path, pool, opts);
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
      if (!path.endsWith("/leave")) await requireMfaIfOrgDoes(pool, params.org!, user.id);
      if (req.method !== "GET" && opts.billing?.enforce && !ALWAYS_ALLOWED.test(path)) {
        const access = await checkAccess(pool, params.org!, opts.billing, pacificToday(), path);
        if (access.level === "read_only") throw new HttpError(402, access.reason!);
      }
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
    if (err instanceof BillingError) return json({ error: err.message }, err.status);
    if (err instanceof GatewayError) return json({ error: err.message }, 502);
    if (err instanceof JurisdictionError) return json({ error: err.message, code: "JURISDICTION" }, 422);
    console.error(err);
    return json({ error: "something went wrong on our side" }, 500);
  }
}
