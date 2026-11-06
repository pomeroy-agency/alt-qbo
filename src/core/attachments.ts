import { createHash, randomUUID } from "node:crypto";
import type { Tx } from "../db/pool.js";
import { appendAudit } from "./audit.js";
import { LedgerError } from "./errors.js";
import type { Actor, Role } from "./ledger.js";

// Receipts and other supporting files on invoices, bills, bank lines and
// journal entries. The file goes to a store apart from the database (Netlify
// Blobs in production); the database keeps what it is, who added it and its
// SHA-256. Removing a file hides it and deletes the stored copy, but the row
// and the audit trail stay.

const CAN_WRITE: Role[] = ["owner", "admin", "bookkeeper", "accountant", "system"];
/** Uploads travel as base64 in JSON, and a function request tops out near 6 MB, so files stay under 4 MB. */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/gif"] as const;
export type AttachmentObject = "document" | "bank_line" | "journal_entry";

export interface FileStore {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export interface Attachment {
  id: string;
  objectType: AttachmentObject;
  objectId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: string;
}

const storeKey = (orgId: string, id: string) => `${orgId}/${id}`;

/** What the file really is, from its first bytes; a name or a browser's word isn't trusted. */
export function sniffType(b: Uint8Array): (typeof ATTACHMENT_TYPES)[number] | null {
  const starts = (...xs: number[]) => xs.every((x, i) => b[i] === x);
  if (starts(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x52, 0x49, 0x46, 0x46) && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  const brand = String.fromCharCode(...b.slice(4, 12));
  if (brand.startsWith("ftyp") && /heic|heix|mif1|msf1|hevc/.test(brand.slice(4))) return "image/heic";
  return null;
}

async function objectExists(tx: Tx, entityId: string, type: AttachmentObject, id: string): Promise<boolean> {
  const table = { document: "documents", bank_line: "bank_lines", journal_entry: "journal_entries" }[type];
  return Boolean((await tx.query(`SELECT 1 FROM ${table} WHERE id = $1 AND entity_id = $2`, [id, entityId])).rows[0]);
}

function attachmentOf(r: any): Attachment {
  return {
    id: r.id, objectType: r.object_type, objectId: r.object_id, fileName: r.file_name, contentType: r.content_type,
    sizeBytes: r.size_bytes, sha256: r.sha256, uploadedBy: r.uploaded_by, uploadedAt: r.uploaded_at.toISOString(),
  };
}

export async function addAttachment(
  tx: Tx,
  store: FileStore,
  input: { orgId: string; entityId: string; objectType: AttachmentObject; objectId: string; fileName: string; data: Uint8Array; actor: Actor },
): Promise<Attachment> {
  if (!CAN_WRITE.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", `role ${input.actor.role} cannot add files`);
  if (!["document", "bank_line", "journal_entry"].includes(input.objectType)) throw new LedgerError("INVALID", "files go on invoices, bills, bank lines or journal entries");
  if (!(await objectExists(tx, input.entityId, input.objectType, input.objectId))) throw new LedgerError("INVALID", "that record isn't in these books");
  if (!input.data.length) throw new LedgerError("INVALID", "the file is empty");
  if (input.data.length > MAX_ATTACHMENT_BYTES) throw new LedgerError("INVALID", "files can be up to 4 MB; a phone photo saved as JPEG is usually well under");
  const type = sniffType(input.data);
  if (!type) throw new LedgerError("INVALID", "add a PDF or a photo (JPEG, PNG, HEIC, WebP or GIF)");
  const name = input.fileName.replace(/[\\/\r\n"]/g, "_").trim().slice(0, 200) || "receipt";
  const id = randomUUID();
  const sha = createHash("sha256").update(input.data).digest("hex");
  await tx.query(
    `INSERT INTO attachments (id, org_id, entity_id, object_type, object_id, file_name, content_type, size_bytes, sha256, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [id, input.orgId, input.entityId, input.objectType, input.objectId, name, type, input.data.length, sha, input.actor.id],
  );
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "attachment.added", objectType: input.objectType, objectId: input.objectId,
    after: { attachmentId: id, fileName: name, contentType: type, sizeBytes: input.data.length, sha256: sha }, context: { role: input.actor.role },
  });
  // Stored last: if the store fails the transaction rolls back, and a stored file without a row is never served.
  await store.put(storeKey(input.orgId, id), input.data);
  return attachmentOf((await tx.query("SELECT * FROM attachments WHERE id = $1", [id])).rows[0]);
}

export async function listAttachments(tx: Tx, entityId: string, objectType: AttachmentObject, objectId: string): Promise<Attachment[]> {
  const rows = (await tx.query(
    "SELECT * FROM attachments WHERE entity_id = $1 AND object_type = $2 AND object_id = $3 AND removed_at IS NULL ORDER BY uploaded_at",
    [entityId, objectType, objectId],
  )).rows;
  return rows.map(attachmentOf);
}

/** How many files each record has, for showing a paperclip in lists. */
export async function attachmentCounts(tx: Tx, entityId: string, objectType: AttachmentObject): Promise<Record<string, number>> {
  const rows = (await tx.query(
    "SELECT object_id, count(*)::int AS n FROM attachments WHERE entity_id = $1 AND object_type = $2 AND removed_at IS NULL GROUP BY object_id",
    [entityId, objectType],
  )).rows;
  return Object.fromEntries(rows.map((r) => [r.object_id, r.n]));
}

/** The file, checked against the hash taken when it was added. */
export async function readAttachment(tx: Tx, store: FileStore, entityId: string, id: string): Promise<{ meta: Attachment; data: Uint8Array }> {
  const r = (await tx.query("SELECT * FROM attachments WHERE id = $1 AND entity_id = $2 AND removed_at IS NULL", [id, entityId])).rows[0];
  if (!r) throw new LedgerError("INVALID", "file not found");
  const data = await store.get(storeKey(r.org_id, id));
  if (!data) throw new LedgerError("INVALID", "the stored file is missing");
  if (createHash("sha256").update(data).digest("hex") !== r.sha256) throw new LedgerError("INVALID", "the stored file doesn't match what was uploaded");
  return { meta: attachmentOf(r), data };
}

export async function removeAttachment(tx: Tx, store: FileStore, input: { orgId: string; entityId: string; attachmentId: string; actor: Actor }): Promise<void> {
  if (!CAN_WRITE.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", `role ${input.actor.role} cannot remove files`);
  const r = (await tx.query(
    "UPDATE attachments SET removed_by = $3, removed_at = now() WHERE id = $1 AND entity_id = $2 AND removed_at IS NULL RETURNING object_type, object_id, file_name",
    [input.attachmentId, input.entityId, input.actor.id],
  )).rows[0];
  if (!r) throw new LedgerError("INVALID", "file not found");
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "attachment.removed", objectType: r.object_type, objectId: r.object_id,
    after: { attachmentId: input.attachmentId, fileName: r.file_name }, context: { role: input.actor.role },
  });
  await store.delete(storeKey(input.orgId, input.attachmentId));
}
