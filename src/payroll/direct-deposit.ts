import type { Tx } from "../db/pool.js";
import { appendAudit } from "../core/audit.js";
import { LedgerError } from "../core/errors.js";
import type { Actor, Role } from "../core/ledger.js";
import { seal, unseal } from "../core/pii.js";
import { buildNachaFile, cleanAccountNumber, validRouting, type NachaCredit } from "./nacha.js";
import { buildCpa005File, cleanCanadianAccount, validInstitution, validTransit, type Cpa005Credit } from "./cpa005.js";
import { canadaHolidays } from "./business-days.js";

// The business's bank details for direct deposit, and the bank file for an
// approved pay run. The file is built fresh each time it's downloaded, from
// the posted run's net pay and the bank accounts on file at that moment.

const CAN_SET_UP: Role[] = ["owner", "admin", "accountant", "system"];
/** Downloading the file reveals full account numbers, so it's limited to people who can release pay. */
const CAN_DOWNLOAD: Role[] = ["owner", "admin", "approver", "accountant", "system"];

export interface DirectDepositSettings {
  odfiRouting: string;
  immediateDestination: string;
  destinationName: string;
  immediateOrigin: string;
  companyId: string;
  companyName: string;
  balanced: boolean;
  accountType: "checking" | "savings" | null;
  accountLast4: string | null;
}

export interface DirectDepositInput {
  odfiRouting?: unknown;
  immediateDestination?: unknown;
  destinationName?: unknown;
  immediateOrigin?: unknown;
  companyId?: unknown;
  companyName?: unknown;
  balanced?: unknown;
  accountType?: unknown;
  /** Write-only; leave it out to keep the one on file. */
  account?: unknown;
}

function invalid(message: string): never {
  throw new LedgerError("INVALID", message);
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function settingsOf(r: any): DirectDepositSettings {
  return {
    odfiRouting: r.odfi_routing, immediateDestination: r.immediate_destination, destinationName: r.destination_name,
    immediateOrigin: r.immediate_origin, companyId: r.company_id, companyName: r.company_name, balanced: r.balanced,
    accountType: r.account_type, accountLast4: r.account_last4,
  };
}

export async function getDirectDepositSettings(tx: Tx, entityId: string): Promise<DirectDepositSettings | null> {
  const { rows } = await tx.query("SELECT * FROM direct_deposit_settings WHERE entity_id = $1", [entityId]);
  return rows[0] ? settingsOf(rows[0]) : null;
}

/** Saves the bank details. Company ID and immediate origin default to "1" and the EIN, which is what most banks use. */
export async function saveDirectDepositSettings(
  tx: Tx,
  input: DirectDepositInput & { orgId: string; entityId: string; actor: Actor },
): Promise<DirectDepositSettings> {
  if (!CAN_SET_UP.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", `role ${input.actor.role} cannot change direct deposit settings`);
  const entity = (await tx.query("SELECT legal_name, ein FROM entities WHERE id = $1", [input.entityId])).rows[0];
  const before = (await tx.query("SELECT * FROM direct_deposit_settings WHERE entity_id = $1 FOR UPDATE", [input.entityId])).rows[0];

  const routing = str(input.odfiRouting).replace(/\s/g, "");
  if (!validRouting(routing)) invalid("that routing number isn't right; it's the nine digits at the bottom left of your business checks");
  const destination = str(input.immediateDestination).replace(/\s/g, "") || routing;
  if (!validRouting(destination)) invalid("the immediate destination should be a routing number your bank gives you");
  const einId = entity?.ein ? "1" + entity.ein.replace("-", "") : "";
  const id10 = (v: unknown, label: string) => {
    const s = str(v).replace(/[\s-]/g, "").toUpperCase() || einId;
    if (!s) invalid(`add the business's EIN first, or enter the ${label} your bank gave you`);
    if (!/^[0-9A-Z]{1,10}$/.test(s)) invalid(`the ${label} is up to 10 letters or digits`);
    return s;
  };
  const companyId = id10(input.companyId, "company ID");
  const origin = id10(input.immediateOrigin || companyId, "immediate origin");
  const companyName = (str(input.companyName) || entity.legal_name).slice(0, 16);
  const destinationName = str(input.destinationName);
  if (!destinationName) invalid("enter your bank's name");
  if (destinationName.length > 23) invalid("the bank name can be 23 characters at most");
  const balanced = Boolean(input.balanced);

  let accountType: string | null = before?.account_type ?? null;
  let last4: string | null = before?.account_last4 ?? null;
  let sealed: string | null = before?.account_sealed ?? null;
  if (input.account !== undefined && input.account !== "") {
    if (input.account === null) {
      accountType = last4 = sealed = null;
    } else {
      const account = typeof input.account === "string" ? cleanAccountNumber(input.account) : null;
      if (!account) invalid("an account number is 4 to 17 digits");
      last4 = account.slice(-4);
      sealed = seal(account);
    }
  }
  if (sealed) {
    const t = input.accountType ?? accountType ?? "checking";
    if (t !== "checking" && t !== "savings") invalid("pick checking or savings");
    accountType = t;
  }
  if (balanced && !sealed) invalid("a balanced file takes the total from your business account, so enter its account number");

  const { rows } = await tx.query(
    `INSERT INTO direct_deposit_settings (entity_id, org_id, odfi_routing, immediate_destination, destination_name, immediate_origin, company_id, company_name, balanced, account_type, account_last4, account_sealed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (entity_id) DO UPDATE SET odfi_routing = $3, immediate_destination = $4, destination_name = $5, immediate_origin = $6,
       company_id = $7, company_name = $8, balanced = $9, account_type = $10, account_last4 = $11, account_sealed = $12, updated_at = now()
     RETURNING *`,
    [input.entityId, input.orgId, routing, destination, destinationName, origin, companyId, companyName, balanced, accountType, last4, sealed],
  );
  const saved = settingsOf(rows[0]);
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "entity.direct_deposit_set",
    objectType: "entity", objectId: input.entityId, before: before ? settingsOf(before) : null, after: saved,
  });
  return saved;
}

/** A Canadian business's details for CPA 005 files. */
export interface CanadaDirectDepositSettings {
  format: "cpa005";
  originatorId: string;
  dataCentre: string;
  shortName: string;
  longName: string;
  returnInstitution: string;
  returnTransit: string;
  returnAccountLast4: string;
  lastFileNumber: number;
}

export interface CanadaDirectDepositInput {
  originatorId?: unknown;
  dataCentre?: unknown;
  shortName?: unknown;
  longName?: unknown;
  returnInstitution?: unknown;
  returnTransit?: unknown;
  /** Write-only; leave it out to keep the one on file. */
  returnAccount?: unknown;
}

function caSettingsOf(r: any): CanadaDirectDepositSettings {
  return {
    format: "cpa005", originatorId: r.originator_id, dataCentre: r.data_centre, shortName: r.short_name, longName: r.long_name,
    returnInstitution: r.return_institution, returnTransit: r.return_transit, returnAccountLast4: r.return_account_last4, lastFileNumber: r.last_file_number,
  };
}

async function isCanadian(tx: Tx, entityId: string): Promise<boolean> {
  return (await tx.query("SELECT country FROM entities WHERE id = $1", [entityId])).rows[0]?.country === "CA";
}

/** The business's direct deposit details: NACHA for a US business, CPA 005 for a Canadian one. */
export async function getEntityDirectDepositSettings(tx: Tx, entityId: string): Promise<DirectDepositSettings | CanadaDirectDepositSettings | null> {
  if (!(await isCanadian(tx, entityId))) return getDirectDepositSettings(tx, entityId);
  const { rows } = await tx.query("SELECT * FROM ca_direct_deposit_settings WHERE entity_id = $1", [entityId]);
  return rows[0] ? caSettingsOf(rows[0]) : null;
}

/** Saves a Canadian business's CPA 005 details, from what its bank gave it for payroll files. */
export async function saveCanadaDirectDepositSettings(
  tx: Tx,
  input: CanadaDirectDepositInput & { orgId: string; entityId: string; actor: Actor },
): Promise<CanadaDirectDepositSettings> {
  if (!CAN_SET_UP.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", `role ${input.actor.role} cannot change direct deposit settings`);
  const entity = (await tx.query("SELECT legal_name, country FROM entities WHERE id = $1", [input.entityId])).rows[0];
  if (entity?.country !== "CA") invalid("CPA 005 files are for Canadian businesses");
  const before = (await tx.query("SELECT * FROM ca_direct_deposit_settings WHERE entity_id = $1 FOR UPDATE", [input.entityId])).rows[0];

  const originatorId = str(input.originatorId).replace(/[\s-]/g, "").toUpperCase();
  if (!/^[0-9A-Z]{1,10}$/.test(originatorId)) invalid("enter the originator ID your bank gave you (up to 10 letters or digits)");
  const dataCentre = str(input.dataCentre).replace(/\s/g, "");
  if (!/^\d{5}$/.test(dataCentre)) invalid("the processing centre (destination data centre) is the five digits your bank gave you");
  const longName = (str(input.longName) || entity.legal_name).slice(0, 30).trim();
  const shortName = (str(input.shortName) || longName).slice(0, 15).trim();
  const returnInstitution = str(input.returnInstitution).replace(/\s/g, "");
  if (!validInstitution(returnInstitution)) invalid("the institution number is three digits, like 003 for RBC or 004 for TD");
  const returnTransit = str(input.returnTransit).replace(/\s/g, "");
  if (!validTransit(returnTransit)) invalid("the transit (branch) number is five digits");
  let last4: string | null = before?.return_account_last4 ?? null;
  let sealed: string | null = before?.return_account_sealed ?? null;
  if (input.returnAccount !== undefined && input.returnAccount !== null && input.returnAccount !== "") {
    const account = typeof input.returnAccount === "string" ? cleanCanadianAccount(input.returnAccount) : null;
    if (!account) invalid("an account number is 5 to 12 digits");
    last4 = account.slice(-4);
    sealed = seal(account);
  }
  if (!sealed) invalid("enter your business account number, where the bank sends any payment it can't deposit");

  const { rows } = await tx.query(
    `INSERT INTO ca_direct_deposit_settings (entity_id, org_id, originator_id, data_centre, short_name, long_name, return_institution, return_transit, return_account_last4, return_account_sealed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (entity_id) DO UPDATE SET originator_id = $3, data_centre = $4, short_name = $5, long_name = $6, return_institution = $7,
       return_transit = $8, return_account_last4 = $9, return_account_sealed = $10, updated_at = now()
     RETURNING *`,
    [input.entityId, input.orgId, originatorId, dataCentre, shortName, longName, returnInstitution, returnTransit, last4, sealed],
  );
  const saved = caSettingsOf(rows[0]);
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "entity.direct_deposit_set",
    objectType: "entity", objectId: input.entityId, before: before ? caSettingsOf(before) : null, after: saved,
  });
  return saved;
}

/** A Canadian employee's bank as stored: "0", the institution and the transit number. */
export const splitCanadianBank = (routing: string) => ({ institution: routing.slice(1, 4), transit: routing.slice(4, 9) });

export interface DirectDepositSummary {
  ready: boolean;
  /** What stops a file being made, if anything. */
  problem: string | null;
  deposits: { employeeId: string; name: string; accountType: string; accountLast4: string; amountMinor: bigint }[];
  /** Employees with net pay and no account on file get a paper check. */
  paperChecks: { employeeId: string; name: string; amountMinor: bigint }[];
  totalMinor: bigint;
  warnings: string[];
}

async function runAndAccounts(tx: Tx, entityId: string, runId: string) {
  const pr = (await tx.query("SELECT status, result FROM pay_runs WHERE id = $1 AND entity_id = $2", [runId, entityId])).rows[0];
  if (!pr) invalid("pay run not found");
  const { rows } = await tx.query(
    "SELECT id, dd_routing, dd_account_type, dd_account_last4, dd_account_sealed FROM employees WHERE entity_id = $1 AND dd_routing IS NOT NULL",
    [entityId],
  );
  return { pr, accounts: new Map(rows.map((r) => [r.id, r])) };
}

/** Who in a run is paid by direct deposit and who needs a check. */
export async function directDepositSummary(tx: Tx, entityId: string, runId: string): Promise<DirectDepositSummary> {
  const { pr, accounts } = await runAndAccounts(tx, entityId, runId);
  const canada = await isCanadian(tx, entityId);
  const settings = await getEntityDirectDepositSettings(tx, entityId);
  const deposits: DirectDepositSummary["deposits"] = [];
  const paperChecks: DirectDepositSummary["paperChecks"] = [];
  for (const p of pr.result.paychecks as any[]) {
    const amount = BigInt(p.netPayMinor);
    if (amount <= 0n) continue;
    const a = accounts.get(p.employeeId);
    if (a) deposits.push({ employeeId: p.employeeId, name: p.name, accountType: a.dd_account_type, accountLast4: a.dd_account_last4, amountMinor: amount });
    else paperChecks.push({ employeeId: p.employeeId, name: p.name, amountMinor: amount });
  }
  const problem = pr.status !== "posted" ? "the run needs to be approved first"
    : !settings ? "add your business's bank details for direct deposit first"
    : !deposits.length ? "no one in this run has a bank account on file for direct deposit"
    : null;
  const payDate: string = pr.result.payDate;
  const warnings = isWeekend(payDate)
    ? [`The pay date, ${payDate}, is a weekend. Banks don't move ${canada ? "payments" : "ACH money"} on weekends, so deposits will land the next business day.`]
    : canada && canadaHolidays(Number(payDate.slice(0, 4))).has(payDate)
      ? [`The pay date, ${payDate}, is a bank holiday, so deposits will land the next business day.`]
      : [];
  return { ready: !problem, problem, deposits, paperChecks, totalMinor: deposits.reduce((s, d) => s + d.amountMinor, 0n), warnings };
}

/** The NACHA file for a posted run. Each download is recorded in the audit log. */
export async function directDepositFile(
  tx: Tx,
  input: { orgId: string; entityId: string; runId: string; actor: Actor; now?: Date },
): Promise<{ fileName: string; text: string; summary: DirectDepositSummary }> {
  if (!CAN_DOWNLOAD.includes(input.actor.role)) throw new LedgerError("FORBIDDEN", `role ${input.actor.role} cannot download the direct deposit file`);
  const summary = await directDepositSummary(tx, input.entityId, input.runId);
  if (summary.problem) invalid(summary.problem);
  const { pr, accounts } = await runAndAccounts(tx, input.entityId, input.runId);
  if (await isCanadian(tx, input.entityId)) return canadaFile(tx, input, summary, pr, accounts);
  const s = (await tx.query("SELECT * FROM direct_deposit_settings WHERE entity_id = $1", [input.entityId])).rows[0];
  const credits: NachaCredit[] = summary.deposits.map((d) => {
    const a = accounts.get(d.employeeId);
    return {
      individualId: d.employeeId.replace(/-/g, "").slice(0, 15), name: d.name,
      routing: a.dd_routing, account: unseal(a.dd_account_sealed), accountType: a.dd_account_type, amountMinor: d.amountMinor,
    };
  });
  let file;
  try {
    file = buildNachaFile({
      origin: {
        odfiRouting: s.odfi_routing, immediateDestination: s.immediate_destination, destinationName: s.destination_name,
        immediateOrigin: s.immediate_origin, companyId: s.company_id, companyName: s.company_name,
        offset: s.balanced ? { account: unseal(s.account_sealed), accountType: s.account_type } : undefined,
      },
      credits, effectiveDate: pr.result.payDate, createdAt: input.now ?? new Date(),
    });
  } catch (err) {
    invalid((err as Error).message);
  }
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "pay_run.direct_deposit_downloaded",
    objectType: "pay_run", objectId: input.runId,
    after: { entries: file.entryCount, totalCreditMinor: file.totalCreditMinor.toString(), paperChecks: summary.paperChecks.length },
    context: { role: input.actor.role },
  });
  return { fileName: `direct-deposit-${pr.result.payDate}.ach`, text: file.text, summary };
}

/** The CPA 005 file for a Canadian run. Each download takes the next file creation number. */
async function canadaFile(
  tx: Tx,
  input: { orgId: string; entityId: string; runId: string; actor: Actor; now?: Date },
  summary: DirectDepositSummary,
  pr: any,
  accounts: Map<string, any>,
): Promise<{ fileName: string; text: string; summary: DirectDepositSummary }> {
  const s = (await tx.query(
    "UPDATE ca_direct_deposit_settings SET last_file_number = last_file_number % 9999 + 1 WHERE entity_id = $1 RETURNING *",
    [input.entityId],
  )).rows[0];
  const credits: Cpa005Credit[] = summary.deposits.map((d) => {
    const a = accounts.get(d.employeeId);
    return { reference: d.employeeId.replace(/-/g, "").slice(0, 19), name: d.name, ...splitCanadianBank(a.dd_routing), account: unseal(a.dd_account_sealed), amountMinor: d.amountMinor };
  });
  let file;
  try {
    file = buildCpa005File({
      origin: {
        originatorId: s.originator_id, dataCentre: s.data_centre, shortName: s.short_name, longName: s.long_name,
        returnInstitution: s.return_institution, returnTransit: s.return_transit, returnAccount: unseal(s.return_account_sealed), fileNumber: s.last_file_number,
      },
      credits, dueDate: pr.result.payDate, createdAt: input.now ?? new Date(),
    });
  } catch (err) {
    invalid((err as Error).message);
  }
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "pay_run.direct_deposit_downloaded",
    objectType: "pay_run", objectId: input.runId,
    after: { format: "cpa005", fileNumber: s.last_file_number, entries: file.entryCount, totalCreditMinor: file.totalCreditMinor.toString(), paperChecks: summary.paperChecks.length },
    context: { role: input.actor.role },
  });
  return { fileName: `cpa005-${pr.result.payDate}-${String(s.last_file_number).padStart(4, "0")}.txt`, text: file.text, summary };
}

/** Saturday or Sunday: banks don't settle ACH then, so the money lands the next business day. */
export function isWeekend(isoDate: string): boolean {
  const d = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}
