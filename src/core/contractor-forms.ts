import type { Tx } from "../db/pool.js";
import { appendAudit } from "./audit.js";
import { LedgerError } from "./errors.js";
import type { Actor, Role } from "./ledger.js";
import { cleanSin, cleanSsn, seal, unseal } from "./pii.js";
import { csvCell } from "./csv.js";

// Year-end forms for contractors: 1099-NEC (with the 1096 summary) in the
// US, and T4A box 048 (fees for services) in Canada. TrailBook prepares them
// from the bill payments made to each vendor in the calendar year; the
// business or its accountant files them (IRS IRIS or FIRE, CRA Internet
// file transfer or My Business Account) and sends recipients their copies.
//
// Only payments by cash, cheque or bank transfer count, which is all a bill
// payment in TrailBook can be: payments by card or through a payment app are
// reported by the card company or app on Form 1099-K instead.

const CAN_SET: Role[] = ["owner", "admin", "accountant"];

/**
 * The reporting threshold for 1099-NEC box 1, by payment year. Public Law
 * 119-21 (2025) section 70433 raised it from $600 to $2,000 for payments made
 * after December 31, 2025, indexed for inflation after 2026. For Greg's rule
 * review: confirm 2027's indexed figure when the IRS publishes it.
 */
export const NEC_THRESHOLD_MINOR: Record<number, bigint> = { 2024: 60000n, 2025: 60000n, 2026: 200000n };

/** T4A box 048: fees for services over $500 in the year (CRA, T4A guide RC4157). */
export const T4A_THRESHOLD_MINOR = 50000n;

export type ContractorForm = "1099_nec" | "t4a";
export type RecipientType = "individual" | "partnership" | "llc" | "corporation" | "attorney" | "other";

export interface ContractorTaxInfo {
  contactId: string;
  form: ContractorForm;
  recipientType: RecipientType;
  tinKind: "ssn" | "ein" | "sin" | "bn" | null;
  tinLast4: string | null;
  legalName: string | null;
}

function necThreshold(year: number): bigint {
  const known = Object.keys(NEC_THRESHOLD_MINOR).map(Number).sort();
  if (NEC_THRESHOLD_MINOR[year] !== undefined) return NEC_THRESHOLD_MINOR[year]!;
  // A later year whose indexed figure isn't in yet: the latest known, flagged on the form.
  return NEC_THRESHOLD_MINOR[known.at(-1)!]!;
}

function cleanEin(v: string): string {
  const digits = v.replace(/[\s-]/g, "");
  if (!/^\d{9}$/.test(digits)) throw new LedgerError("INVALID", "an EIN has nine digits, like 12-3456789");
  return digits;
}

function cleanBn(v: string): string {
  const digits = v.replace(/[\s-]/g, "").toUpperCase();
  // The nine-digit business number, optionally with a program account (RT0001).
  if (!/^\d{9}([A-Z]{2}\d{4})?$/.test(digits)) throw new LedgerError("INVALID", "a business number has nine digits, like 123456789 (or 123456789RT0001)");
  return digits;
}

export async function getContractorInfo(tx: Tx, contactId: string): Promise<ContractorTaxInfo | null> {
  const r = (await tx.query("SELECT * FROM contractor_tax_info WHERE contact_id = $1", [contactId])).rows[0];
  return r ? { contactId: r.contact_id, form: r.form, recipientType: r.recipient_type, tinKind: r.tin_kind, tinLast4: r.tin_last4, legalName: r.legal_name } : null;
}

/** Marks a vendor for a 1099-NEC or T4A (or clears it), with its taxpayer number sealed. */
export async function setContractorInfo(
  tx: Tx,
  input: {
    orgId: string; entityId: string; contactId: string; form: ContractorForm | null; recipientType?: RecipientType;
    /** Left out keeps the number on file; "" clears it. */
    tin?: string; tinKind?: "ssn" | "ein" | "sin" | "bn"; legalName?: string; actor: Actor;
  },
): Promise<ContractorTaxInfo | null> {
  if (!CAN_SET.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", "only an owner, admin or accountant can record a contractor's tax details");
  const c = (await tx.query("SELECT kind FROM contacts WHERE id = $1 AND entity_id = $2", [input.contactId, input.entityId])).rows[0];
  if (!c) throw new LedgerError("INVALID", "contact not found");
  if (!input.form) {
    await tx.query("DELETE FROM contractor_tax_info WHERE contact_id = $1", [input.contactId]);
    await appendAudit(tx, {
      orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "contractor.cleared", objectType: "contact", objectId: input.contactId,
      after: { form: null }, context: { role: input.actor.role },
    });
    return null;
  }
  if (c.kind === "customer") throw new LedgerError("INVALID", "only vendors get a 1099-NEC or T4A");
  const country = (await tx.query("SELECT country FROM entities WHERE id = $1", [input.entityId])).rows[0].country.trim();
  if (input.form === "1099_nec" && country !== "US") throw new LedgerError("INVALID", "1099-NEC forms are for US businesses; Canadian businesses use the T4A");
  if (input.form === "t4a" && country !== "CA") throw new LedgerError("INVALID", "T4A slips are for Canadian businesses; US businesses use the 1099-NEC");
  const recipientType = input.recipientType ?? "individual";
  if (!["individual", "partnership", "llc", "corporation", "attorney", "other"].includes(recipientType)) throw new LedgerError("INVALID", "unknown recipient type");

  const prior = (await tx.query("SELECT tin_kind, tin_sealed, tin_last4 FROM contractor_tax_info WHERE contact_id = $1", [input.contactId])).rows[0];
  let tin: { kind: string | null; sealed: string | null; last4: string | null } = { kind: prior?.tin_kind ?? null, sealed: prior?.tin_sealed ?? null, last4: prior?.tin_last4 ?? null };
  if (input.tin !== undefined) {
    if (!input.tin.trim()) tin = { kind: null, sealed: null, last4: null };
    else {
      const kind = input.tinKind ?? (input.form === "1099_nec" ? "ssn" : "sin");
      const ok = input.form === "1099_nec" ? ["ssn", "ein"] : ["sin", "bn"];
      if (!ok.includes(kind)) throw new LedgerError("INVALID", input.form === "1099_nec" ? "a 1099 recipient has an SSN or EIN" : "a T4A recipient has a SIN or business number");
      const clean = kind === "ssn" ? cleanSsn(input.tin) : kind === "ein" ? cleanEin(input.tin) : kind === "sin" ? cleanSin(input.tin) : cleanBn(input.tin);
      tin = { kind, sealed: seal(clean), last4: clean.slice(0, 9).slice(-4) };
    }
  }
  if (tin.kind && !(input.form === "1099_nec" ? ["ssn", "ein"] : ["sin", "bn"]).includes(tin.kind)) tin = { kind: null, sealed: null, last4: null };
  await tx.query(
    `INSERT INTO contractor_tax_info (contact_id, org_id, entity_id, form, recipient_type, tin_kind, tin_sealed, tin_last4, legal_name, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (contact_id) DO UPDATE SET form = EXCLUDED.form, recipient_type = EXCLUDED.recipient_type, tin_kind = EXCLUDED.tin_kind,
       tin_sealed = EXCLUDED.tin_sealed, tin_last4 = EXCLUDED.tin_last4, legal_name = EXCLUDED.legal_name, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [input.contactId, input.orgId, input.entityId, input.form, recipientType, tin.kind, tin.sealed, tin.last4, input.legalName?.trim().slice(0, 200) || null, input.actor.id],
  );
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "contractor.updated", objectType: "contact", objectId: input.contactId,
    // Only the last four digits ever reach the audit log.
    after: { form: input.form, recipientType, tinKind: tin.kind, tinLast4: tin.last4, legalName: input.legalName?.trim() || null },
    context: { role: input.actor.role },
  });
  return getContractorInfo(tx, input.contactId);
}

export interface ContractorTotal {
  contactId: string;
  name: string;
  legalName: string | null;
  form: ContractorForm | null;
  recipientType: RecipientType | null;
  tinKind: string | null;
  tinLast4: string | null;
  address: { line1: string; city: string; state: string; zip: string } | null;
  paidMinor: bigint;
  /** Whether a form is due for this vendor and year. */
  reportable: boolean;
  /** Why not, or what's missing. */
  notes: string[];
}

export interface ContractorSummary {
  year: number;
  country: string;
  form: ContractorForm;
  thresholdMinor: bigint;
  dueDate: string;
  payer: { name: string; tin: string | null; address: { line1: string; city: string; state: string; zip: string } | null };
  vendors: ContractorTotal[];
  /** 1096 (US) or T4A Summary (Canada): forms and total box amount. */
  summary: { forms: number; totalMinor: bigint };
  warnings: string[];
}

/** Every vendor paid in the year, how much, and whether they get a form. */
export async function contractorSummary(tx: Tx, entityId: string, year: number): Promise<ContractorSummary> {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new LedgerError("INVALID", "choose a year");
  const ent = (await tx.query("SELECT legal_name, country, ein, address_line1, address_city, address_state, address_zip FROM entities WHERE id = $1", [entityId])).rows[0];
  if (!ent) throw new LedgerError("INVALID", "entity not found");
  const country = ent.country.trim();
  const form: ContractorForm = country === "CA" ? "t4a" : "1099_nec";
  const threshold = form === "t4a" ? T4A_THRESHOLD_MINOR : necThreshold(year);
  const rows = (await tx.query(
    `SELECT c.id, c.name, c.address_line1, c.address_city, c.address_state, c.address_zip,
            i.form, i.recipient_type, i.tin_kind, i.tin_last4, i.legal_name,
            coalesce(sum(p.amount_minor), 0)::bigint AS paid
       FROM contacts c
       JOIN documents d ON d.contact_id = c.id AND d.kind = 'bill'
       JOIN document_payments p ON p.document_id = d.id AND p.payment_date BETWEEN make_date($2, 1, 1) AND make_date($2, 12, 31)
       LEFT JOIN contractor_tax_info i ON i.contact_id = c.id
      WHERE c.entity_id = $1
      GROUP BY c.id, i.contact_id
      ORDER BY lower(c.name)`,
    [entityId, year],
  )).rows;
  const vendors: ContractorTotal[] = rows.map((r) => {
    const notes: string[] = [];
    let reportable = false;
    if (!r.form) notes.push("Not marked for a form. If they're an unincorporated contractor, mark them and add their tax number.");
    else if (r.form !== form) notes.push(`Marked for a ${r.form === "t4a" ? "T4A" : "1099-NEC"}, which doesn't apply to a ${country === "CA" ? "Canadian" : "US"} business.`);
    else if (form === "1099_nec" && r.recipient_type === "corporation") notes.push("Corporations don't get a 1099-NEC (unless the payments were for legal services: mark them as an attorney).");
    else if (r.paid < threshold) notes.push(`Paid less than ${money(threshold)} this year, so no form is needed.`);
    else reportable = true;
    if (reportable && !r.tin_last4) notes.push(`Missing their ${form === "t4a" ? "SIN or business number" : "SSN or EIN"}: ask for a ${form === "t4a" ? "number for the T4A" : "Form W-9"}.`);
    if (reportable && !r.address_line1) notes.push("Missing their mailing address.");
    return {
      contactId: r.id, name: r.name, legalName: r.legal_name, form: r.form, recipientType: r.recipient_type, tinKind: r.tin_kind, tinLast4: r.tin_last4,
      address: r.address_line1 ? { line1: r.address_line1, city: r.address_city, state: r.address_state, zip: r.address_zip } : null,
      paidMinor: r.paid, reportable, notes,
    };
  });
  const due = vendors.filter((v) => v.reportable);
  const warnings: string[] = [];
  if (form === "1099_nec" && NEC_THRESHOLD_MINOR[year] === undefined) {
    warnings.push(`The ${year} threshold isn't confirmed yet; this uses ${money(threshold)}. The IRS indexes it for inflation after 2026.`);
  }
  if (form === "1099_nec" && !ent.ein) warnings.push("Add your business's EIN (Overview) before preparing the forms.");
  if (form === "t4a" && !ent.ein) warnings.push("Add your business number (Overview) before preparing the slips.");
  if (form === "1099_nec" && due.length >= 10) warnings.push("With 10 or more information returns in total (including W-2s), the IRS requires electronic filing, for example through IRIS.");
  if (due.some((v) => !v.tinLast4 || !v.address)) warnings.push("Some recipients are missing a tax number or address; see the notes beside them.");
  return {
    year, country, form, thresholdMinor: threshold,
    // 1099-NEC: January 31 to recipients and the IRS (next business day if a weekend). T4A: last day of February.
    dueDate: form === "1099_nec" ? `${year + 1}-01-31` : `${year + 1}-02-${new Date(Date.UTC(year + 1, 2, 0)).getUTCDate()}`,
    payer: {
      name: ent.legal_name, tin: ent.ein ?? null,
      address: ent.address_line1 ? { line1: ent.address_line1, city: ent.address_city, state: ent.address_state, zip: ent.address_zip } : null,
    },
    vendors, summary: { forms: due.length, totalMinor: due.reduce((s, v) => s + v.paidMinor, 0n) }, warnings,
  };
}

const money = (m: bigint) => `$${(m / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${m % 100n ? `.${String(m % 100n).padStart(2, "0")}` : ""}`;

function formatTin(kind: string, digits: string): string {
  if (kind === "ssn") return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  if (kind === "ein") return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  if (kind === "sin") return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  return digits;
}

export interface PreparedContractorForm {
  form: ContractorForm;
  year: number;
  payer: ContractorSummary["payer"];
  recipient: { name: string; tin: string | null; address: ContractorTotal["address"] };
  /** 1099-NEC box 1, or T4A box 048. */
  amountMinor: bigint;
  box: string;
  dueDate: string;
}

/**
 * The forms for the reportable vendors. Taxpayer numbers are masked to the
 * last four digits unless `full` is set (the caller checks the second factor).
 */
export async function prepareContractorForms(
  tx: Tx, entityId: string, year: number, opts: { full?: boolean; orgId?: string; actor?: Actor } = {},
): Promise<PreparedContractorForm[]> {
  const s = await contractorSummary(tx, entityId, year);
  const full = !!opts.full && !!opts.actor && !!opts.orgId && CAN_SET.includes(opts.actor.role);
  if (full) {
    await appendAudit(tx, {
      orgId: opts.orgId!, entityId, actor: opts.actor!.id, action: "contractor_forms.viewed_with_tin", objectType: "entity", objectId: entityId,
      after: { form: s.form, year }, context: { role: opts.actor!.role },
    });
  }
  const sealed = new Map((await tx.query("SELECT contact_id, tin_sealed FROM contractor_tax_info WHERE entity_id = $1", [entityId])).rows.map((r) => [r.contact_id, r.tin_sealed]));
  return s.vendors.filter((v) => v.reportable).map((v) => {
    let tin: string | null = null;
    if (v.tinKind && v.tinLast4) {
      tin = full && sealed.get(v.contactId) ? formatTin(v.tinKind, unseal(sealed.get(v.contactId)!)) : `${v.tinKind === "ein" || v.tinKind === "bn" ? "**-***" : "***-**-"}${v.tinLast4}`;
    }
    return {
      form: s.form, year, payer: s.payer, recipient: { name: v.legalName || v.name, tin, address: v.address },
      amountMinor: v.paidMinor, box: s.form === "1099_nec" ? "1 Nonemployee compensation" : "048 Fees for services", dueDate: s.dueDate,
    };
  });
}

/** One row per form, for the business's filing software or its accountant. */
export function contractorFormsCsv(forms: PreparedContractorForm[]): string {
  const out = ["Form,Year,Payer,Payer TIN,Recipient,Recipient TIN,Address,City,State or province,ZIP or postal code,Box,Amount"];
  for (const f of forms) {
    out.push([
      f.form === "1099_nec" ? "1099-NEC" : "T4A", f.year, csvCell(f.payer.name), csvCell(f.payer.tin ?? ""), csvCell(f.recipient.name), csvCell(f.recipient.tin ?? ""),
      csvCell(f.recipient.address?.line1 ?? ""), csvCell(f.recipient.address?.city ?? ""), csvCell(f.recipient.address?.state ?? ""), csvCell(f.recipient.address?.zip ?? ""),
      csvCell(f.box), (Number(f.amountMinor) / 100).toFixed(2),
    ].join(","));
  }
  return out.join("\n") + "\n";
}
