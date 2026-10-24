import type { Tx } from "../db/pool.js";
import { resolveRules, type Place } from "../rules/index.js";
import { COA_TEMPLATES, returnTypeFor } from "../rules/coa/us-service.js";
import { appendAudit, initAuditChain } from "./audit.js";
import { LedgerError } from "./errors.js";
import type { Actor } from "./ledger.js";

export type OrgKind = "business" | "accounting_firm" | "hr_firm";

export type EntityType =
  | "sole_prop" | "llc_single" | "llc_partnership" | "llc_s_corp" | "s_corp" | "c_corp" | "partnership";

export interface Organization {
  id: string;
  name: string;
  kind: OrgKind;
}

/**
 * Creates an organisation and starts its audit chain. Runs as the system
 * owner because no tenant exists yet; everything after this runs in withTenant.
 */
export async function createOrganization(
  tx: Tx,
  input: { name: string; kind?: OrgKind; actor: Actor },
): Promise<Organization> {
  const { rows } = await tx.query<Organization>(
    "INSERT INTO organizations (name, kind) VALUES ($1, $2) RETURNING id, name, kind",
    [input.name, input.kind ?? "business"],
  );
  const org = rows[0]!;
  await initAuditChain(tx, org.id);
  await appendAudit(tx, {
    orgId: org.id,
    actor: input.actor.id,
    action: "organization.created",
    objectType: "organization",
    objectId: org.id,
    after: org,
  });
  return org;
}

export interface Entity {
  id: string;
  orgId: string;
  legalName: string;
  entityType: EntityType;
  country: string;
  region: string | null;
  framework: string;
  functionalCurrency: string;
  fiscalYearStartMonth: number;
  coaTemplate: string;
  taxReturnType: string;
  ledgerRetentionYears: number;
  payrollRetentionYears: number;
}

export interface CreateEntityInput {
  orgId: string;
  legalName: string;
  entityType: EntityType;
  /** Principal place of business; sets the framework, currency, rule packs and chart of accounts. */
  place: Place;
  fiscalYearStartMonth?: number;
  /** Fiscal year whose monthly periods are opened at setup. */
  firstFiscalYear: number;
  ein?: string;
  stateEmployerId?: string;
  actor: Actor;
}

/**
 * Sets up a legal entity from its principal place of business: picks the
 * reporting framework and defaults from the rule pack, loads the chart of
 * accounts with tax-line codes, and opens twelve monthly periods.
 */
export async function createEntity(tx: Tx, input: CreateEntityInput): Promise<Entity> {
  const fyStart = input.fiscalYearStartMonth ?? 1;
  const firstDay = `${input.firstFiscalYear}-${String(fyStart).padStart(2, "0")}-01`;
  const rules = resolveRules(input.place, firstDay);
  const defaults = rules.federal.entityDefaults;
  const template = COA_TEMPLATES[defaults.coaTemplate];
  if (!template) throw new LedgerError("INVALID", `no chart-of-accounts template ${defaults.coaTemplate}`);
  const returnType = returnTypeFor(input.entityType);

  const { rows } = await tx.query(
    `INSERT INTO entities (org_id, legal_name, entity_type, country, region, locality, framework,
        functional_currency, fiscal_year_start_month, coa_template, tax_return_type,
        ledger_retention_years, payroll_retention_years, ein, state_employer_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id`,
    [
      input.orgId, input.legalName, input.entityType, input.place.country, input.place.region ?? null,
      input.place.locality ?? null, defaults.framework, defaults.functionalCurrency, fyStart,
      defaults.coaTemplate, returnType, defaults.ledgerRetentionYears, defaults.payrollRetentionYears,
      input.ein ?? null, input.stateEmployerId ?? null,
    ],
  );
  const entityId: string = rows[0].id;

  for (const a of template) {
    await tx.query(
      `INSERT INTO accounts (org_id, entity_id, code, name, type, subtype, statement_line,
          cash_flow_class, tax_line, system_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.orgId, entityId, a.code, a.name, a.type, a.subtype, a.statementLine, a.cashFlowClass,
        a.taxLines[returnType] ?? null, a.systemKey ?? null,
      ],
    );
  }

  await openFiscalYear(tx, { orgId: input.orgId, entityId, fiscalYear: input.firstFiscalYear, startMonth: fyStart });

  const entity = await getEntity(tx, entityId);
  await appendAudit(tx, {
    orgId: input.orgId,
    entityId,
    actor: input.actor.id,
    action: "entity.created",
    objectType: "entity",
    objectId: entityId,
    after: entity,
    context: { rulePacks: rules.provenance, accounts: template.length },
  });
  return entity;
}

/** Opens the twelve monthly periods of a fiscal year. */
export async function openFiscalYear(
  tx: Tx,
  input: { orgId: string; entityId: string; fiscalYear: number; startMonth: number },
): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const m0 = input.startMonth - 1 + i;
    const year = input.fiscalYear + Math.floor(m0 / 12);
    const month = (m0 % 12) + 1;
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    await tx.query(
      "INSERT INTO periods (org_id, entity_id, start_date, end_date) VALUES ($1, $2, $3, $4)",
      [input.orgId, input.entityId, start, end],
    );
  }
}

export async function getEntity(tx: Tx, entityId: string): Promise<Entity> {
  const { rows } = await tx.query(
    `SELECT id, org_id, legal_name, entity_type, country, region, framework, functional_currency,
            fiscal_year_start_month, coa_template, tax_return_type, ledger_retention_years,
            payroll_retention_years
       FROM entities WHERE id = $1`,
    [entityId],
  );
  const r = rows[0];
  if (!r) throw new LedgerError("INVALID", `entity ${entityId} not found`);
  return {
    id: r.id,
    orgId: r.org_id,
    legalName: r.legal_name,
    entityType: r.entity_type,
    country: r.country,
    region: r.region,
    framework: r.framework,
    functionalCurrency: r.functional_currency.trim(),
    fiscalYearStartMonth: r.fiscal_year_start_month,
    coaTemplate: r.coa_template,
    taxReturnType: r.tax_return_type,
    ledgerRetentionYears: r.ledger_retention_years,
    payrollRetentionYears: r.payroll_retention_years,
  };
}

export type ConnectionKind = "bank" | "card_issuer" | "processor" | "agency" | "business";

/**
 * Records a link to an outside party. Only a reference to a vaulted token is
 * kept, never the credential itself.
 */
export async function addConnection(
  tx: Tx,
  input: {
    orgId: string;
    entityId: string;
    kind: ConnectionKind;
    displayName: string;
    externalRef?: string;
    scopes?: string[];
    tokenRef?: string;
    actor: Actor;
  },
): Promise<{ id: string }> {
  if (input.tokenRef && !/^vault:/.test(input.tokenRef)) {
    throw new LedgerError("INVALID", "tokenRef must be a vault reference (vault:...), never a raw credential");
  }
  const { rows } = await tx.query(
    `INSERT INTO connections (org_id, entity_id, kind, display_name, external_ref, scopes, token_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [input.orgId, input.entityId, input.kind, input.displayName, input.externalRef ?? null,
     input.scopes ?? [], input.tokenRef ?? null],
  );
  await appendAudit(tx, {
    orgId: input.orgId,
    entityId: input.entityId,
    actor: input.actor.id,
    action: "connection.added",
    objectType: "connection",
    objectId: rows[0].id,
    after: { kind: input.kind, displayName: input.displayName, scopes: input.scopes ?? [] },
  });
  return { id: rows[0].id };
}
