import { createHash } from "node:crypto";
import type { Tx } from "../db/pool.js";
import { appendAudit, canonicalJson, verifyAuditChain } from "./audit.js";
import { LedgerError } from "./errors.js";
import type { Actor, Role } from "./ledger.js";

// A complete copy of one business's books in a single JSON file: every row
// behind the ledger, invoices, bank, reconciliations, payroll and the
// organisation's audit chain, as stored. Nothing secret goes in it: no
// passwords, sessions, email links, connection credentials or Social
// Security numbers.

export const BACKUP_FORMAT = "alt-qbo-backup";
export const BACKUP_VERSION = 1;

const CAN_BACK_UP: Role[] = ["owner", "admin", "accountant", "system"];

/** Each table and the query for this entity's rows, in an order that restores cleanly. */
const TABLES: [string, string][] = [
  ["accounts", "SELECT * FROM accounts WHERE entity_id = $1 ORDER BY code"],
  ["periods", "SELECT * FROM periods WHERE entity_id = $1 ORDER BY start_date"],
  ["journal_entries", "SELECT * FROM journal_entries WHERE entity_id = $1 ORDER BY entry_number"],
  ["journal_lines", "SELECT l.* FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE l.entity_id = $1 ORDER BY e.entry_number, l.line_no"],
  ["contacts", "SELECT * FROM contacts WHERE entity_id = $1 ORDER BY lower(name)"],
  ["items", "SELECT * FROM items WHERE entity_id = $1 ORDER BY lower(name)"],
  ["documents", "SELECT * FROM documents WHERE entity_id = $1 ORDER BY kind, issue_date, number"],
  ["document_lines", "SELECT l.* FROM document_lines l JOIN documents d ON d.id = l.document_id WHERE l.entity_id = $1 ORDER BY d.kind, d.number, l.line_no"],
  ["document_payments", "SELECT * FROM document_payments WHERE entity_id = $1 ORDER BY payment_date, created_at"],
  ["bank_imports", "SELECT * FROM bank_imports WHERE entity_id = $1 ORDER BY created_at"],
  ["bank_lines", "SELECT * FROM bank_lines WHERE entity_id = $1 ORDER BY txn_date, created_at"],
  ["reconciliations", "SELECT * FROM reconciliations WHERE entity_id = $1 ORDER BY statement_date"],
  ["reconciliation_lines", "SELECT * FROM reconciliation_lines WHERE entity_id = $1 ORDER BY reconciliation_id, journal_line_id"],
  // Social Security numbers stay out; only their last four digits are copied.
  ["employees", `SELECT id, org_id, entity_id, name, email, address_line1, address_city, address_state, address_zip, hire_date, termination_date,
     pay_type, pay_frequency, pay_rate, usual_hours, overtime_exempt, w4, de4, deductions, sick_balance_hours, ssn_last4, opening_ytd, created_at, updated_at
     FROM employees WHERE entity_id = $1 ORDER BY lower(name)`],
  ["pay_runs", "SELECT * FROM pay_runs WHERE entity_id = $1 ORDER BY created_at"],
  // Connection credentials stay out; the backup only says the connection existed.
  ["connections", "SELECT id, org_id, entity_id, kind, display_name, external_ref, scopes, status, created_at FROM connections WHERE entity_id = $1 ORDER BY created_at"],
];

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  createdBy: string;
  organization: { id: string; name: string };
  entity: Record<string, unknown>;
  counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
  /** The whole organisation's audit chain, so it can be checked on its own. */
  audit: { verification: unknown; events: Record<string, unknown>[] };
  /** SHA-256 of the canonical JSON of entity, tables and audit events, to spot a damaged or edited file. */
  checksum: string;
}

/** Copies one entity's books. Downloading a backup is itself recorded in the audit log. */
export async function backupEntity(tx: Tx, input: { orgId: string; entityId: string; actor: Actor }): Promise<Backup> {
  if (!CAN_BACK_UP.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", `role ${input.actor.role} cannot download a backup`);
  const entity = (await tx.query("SELECT * FROM entities WHERE id = $1", [input.entityId])).rows[0];
  if (!entity) throw new LedgerError("INVALID", "entity not found");
  const org = (await tx.query("SELECT id, name FROM organizations WHERE id = $1", [input.orgId])).rows[0];
  const tables: Backup["tables"] = {};
  for (const [name, sql] of TABLES) tables[name] = (await tx.query(sql, [input.entityId])).rows;
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));

  // Recorded before the copy of the chain is taken, so the backup includes its own download.
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "entity.backup_downloaded",
    objectType: "entity", objectId: input.entityId, after: { counts }, context: { role: input.actor.role },
  });
  const events = (await tx.query("SELECT * FROM audit_events WHERE org_id = $1 ORDER BY seq", [input.orgId])).rows;
  const verification = await verifyAuditChain(tx, input.orgId);
  const checksum = createHash("sha256").update(canonicalJson(plain({ entity, tables, events }))).digest("hex");
  return {
    format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(), createdBy: input.actor.id,
    organization: { id: org.id, name: org.name }, entity, counts, tables, audit: { verification, events }, checksum,
  };
}

/** Rows as they will appear in the file: bigints and dates as strings. */
function plain<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}

/** Checks a downloaded file: right format, and nothing changed since it was made. */
export function verifyBackup(file: unknown): { ok: boolean; reason?: string } {
  const b = file as Partial<Backup> | null;
  if (b?.format !== BACKUP_FORMAT) return { ok: false, reason: "not an Alt-QBO backup" };
  if (b.version !== BACKUP_VERSION) return { ok: false, reason: `backup version ${b.version} isn't supported` };
  const sum = createHash("sha256").update(canonicalJson({ entity: b.entity, tables: b.tables, events: b.audit?.events })).digest("hex");
  return sum === b.checksum ? { ok: true } : { ok: false, reason: "the file has been changed or damaged since it was made" };
}
