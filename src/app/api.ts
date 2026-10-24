import type pg from "pg";
import { withSystem, withTenant, type Tx } from "../db/pool.js";
import { appendAudit, verifyAuditChain } from "../core/audit.js";
import { LedgerError } from "../core/errors.js";
import { findPeriod, getEntry, postJournal, reverseEntry, setPeriodStatus, type Actor, type LineInput, type PeriodStatus, type Role } from "../core/ledger.js";
import { trialBalance, taxLineExportCsv } from "../core/reports.js";
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

const ROLES: Role[] = ["owner", "admin", "bookkeeper", "approver", "accountant", "read_only"];
const ENTITY_TYPES: EntityType[] = ["sole_prop", "llc_single", "llc_partnership", "llc_s_corp", "s_corp", "c_corp", "partnership"];

interface Ctx {
  pool: pg.Pool;
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

route("GET", "/api/orgs/:org/members", async (_req, _p, ctx) => {
  const { rows } = await ctx.pool.query(
    `SELECT u.email, u.name, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = $1 ORDER BY m.created_at`,
    [ctx.orgId],
  );
  return json({ members: rows });
});

route("POST", "/api/orgs/:org/members", async (req, _p, ctx) => {
  requireRole(ctx, ["owner", "admin"]);
  const b = await body(req);
  const email = normaliseEmail(b.email);
  const role = b.role as Role;
  if (!ROLES.includes(role) || role === "owner") throw new HttpError(400, "pick a role other than owner");
  const name = str(b.name, "name");
  const passwordHash = await hashPassword(str(b.password, "password", 200));
  await withSystem(ctx.pool, async (tx) => {
    const existing = (await tx.query("SELECT id FROM users WHERE email = $1", [email])).rows[0];
    const userId = existing?.id ?? (await tx.query(
      "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id", [email, name, passwordHash],
    )).rows[0].id;
    await tx.query(
      "INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, $3) ON CONFLICT (user_id, org_id) DO NOTHING",
      [userId, ctx.orgId, role],
    );
  });
  await tenant(ctx, async (tx) => {
    await appendAudit(tx, {
      orgId: ctx.orgId, actor: ctx.actor.id, action: "member.added", objectType: "user", objectId: email,
      after: { email, role },
    });
  });
  return json({ ok: true }, 201);
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
      `SELECT id, code, name, type, subtype, statement_line, cash_flow_class, tax_line, system_key, is_active
         FROM accounts WHERE entity_id = $1 ORDER BY code`,
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

route("GET", "/api/orgs/:org/entities/:entity/journal", async (_req, p, ctx) =>
  tenant(ctx, async (tx) => {
    await ensureEntity(tx, p.entity!);
    const ids = (await tx.query(
      "SELECT id FROM journal_entries WHERE entity_id = $1 ORDER BY entry_number DESC LIMIT 100",
      [p.entity],
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

async function authRoutes(req: Request, path: string, pool: pg.Pool, opts: ApiOptions): Promise<Response | null> {
  if (req.method === "GET" && path === "/api/health") return json({ ok: true });
  if (req.method === "GET" && path === "/api/rule-packs") {
    return json({ packs: allRulePacks().map((p) => ({ id: p.id, version: p.version, status: p.status, effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo, sources: p.sources, reviewNotes: p.reviewNotes })) });
  }
  if (req.method === "POST" && path === "/api/auth/signup") {
    const b = await body(req);
    if (opts.signupCode && b.inviteCode !== opts.signupCode) throw new AuthError("that invite code isn't valid", 403);
    const email = normaliseEmail(b.email);
    const name = str(b.name, "name", 100);
    const orgName = str(b.orgName, "business name");
    const passwordHash = await hashPassword(str(b.password, "password", 200));
    const userId = await withSystem(pool, async (tx) => {
      if ((await tx.query("SELECT 1 FROM users WHERE email = $1", [email])).rows[0]) {
        throw new AuthError("an account with that email already exists; sign in instead", 409);
      }
      const uid = (await tx.query(
        "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id", [email, name, passwordHash],
      )).rows[0].id;
      const org = await createOrganization(tx, { name: orgName, actor: { id: `user:${email}`, role: "owner" } });
      await tx.query("INSERT INTO memberships (user_id, org_id, role) VALUES ($1, $2, 'owner')", [uid, org.id]);
      return uid;
    });
    const s = await createSession(pool, userId);
    return json({ ok: true }, 201, { "set-cookie": sessionCookie(s.token, s.maxAge) });
  }
  if (req.method === "POST" && path === "/api/auth/login") {
    const b = await body(req);
    const email = normaliseEmail(b.email);
    const { rows } = await pool.query("SELECT id, password_hash FROM users WHERE email = $1", [email]);
    const ok = rows[0] && (await verifyPassword(String(b.password ?? ""), rows[0].password_hash));
    if (!ok) throw new AuthError("wrong email or password");
    const s = await createSession(pool, rows[0].id);
    return json({ ok: true }, 200, { "set-cookie": sessionCookie(s.token, s.maxAge) });
  }
  if (req.method === "POST" && path === "/api/auth/logout") {
    await endSession(pool, cookie(req, SESSION_COOKIE));
    return json({ ok: true }, 200, { "set-cookie": sessionCookie("", 0) });
  }
  if (req.method === "GET" && path === "/api/me") {
    const user = await sessionUser(pool, cookie(req, SESSION_COOKIE));
    if (!user) throw new AuthError("not signed in");
    const { rows } = await pool.query(
      `SELECT o.id, o.name, m.role FROM memberships m JOIN organizations o ON o.id = m.org_id
        WHERE m.user_id = $1 ORDER BY m.created_at`,
      [user.id],
    );
    return json({ user, orgs: rows });
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
      const ctx: Ctx = { pool, user, orgId: params.org!, role, actor: { id: `user:${user.email}`, role } };
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
