import type { Tx } from "../db/pool.js";
import { appendAudit } from "../core/audit.js";
import { LedgerError, translateDbError } from "../core/errors.js";
import type { Actor, Role } from "../core/ledger.js";
import { D, toMinor } from "../core/money.js";
import { cleanSsn, seal } from "../core/pii.js";
import { cleanAddress, type Address } from "../core/sales-tax.js";
import { localWagePlace } from "../rules/local-minimum-wage.js";
import { cleanAccountNumber, validRouting } from "./nacha.js";
import type { DE4 } from "./california.js";
import type { W4 } from "./federal.js";
import { PERIODS_PER_YEAR, type Deduction, type DeductionKind, type PayFrequency } from "./gross-to-net.js";

// The people a business pays. Their pay, tax forms and deductions are kept
// here and copied into each pay run when it is prepared.

const CAN_WRITE: Role[] = ["owner", "admin", "bookkeeper", "accountant", "system"];

export interface OpeningYtd {
  /** The calendar year these figures are for. */
  year: number;
  /** Wages paid this year before TrailBook, as decimal strings. */
  wages: string;
  federalIncomeTax: string;
  socialSecurityTax: string;
  medicareTax: string;
  caIncomeTax: string;
  caSdi: string;
}

export interface Employee {
  id: string;
  name: string;
  email: string | null;
  address: Address | null;
  /** The city where they work, for a local minimum wage; null when not given. */
  workCity: string | null;
  hireDate: string;
  terminationDate: string | null;
  status: "active" | "terminated";
  payType: "salary" | "hourly";
  payFrequency: PayFrequency;
  /** Annual salary, or the hourly rate. */
  payRate: string;
  usualHours: string | null;
  overtimeExempt: boolean;
  w4: W4;
  de4: DE4;
  deductions: Deduction[];
  sickBalanceHours: string;
  ssnLast4: string | null;
  openingYtd: OpeningYtd | null;
  /** Where net pay goes by direct deposit; null means a paper check. */
  directDeposit: { routing: string; accountType: "checking" | "savings"; accountLast4: string } | null;
}

export interface EmployeeFields {
  name?: string;
  email?: string | null;
  address?: unknown;
  workCity?: string | null;
  hireDate?: string;
  terminationDate?: string | null;
  payType?: string;
  payFrequency?: string;
  payRate?: string;
  usualHours?: string | null;
  overtimeExempt?: boolean;
  w4?: Partial<Record<keyof W4, unknown>>;
  de4?: Partial<Record<keyof DE4, unknown>>;
  deductions?: { kind?: unknown; amount?: unknown; description?: unknown }[];
  sickBalanceHours?: string;
  /** Write-only: sealed on the way in, only the last four digits come back. */
  ssn?: string | null;
  openingYtd?: Partial<Record<keyof OpeningYtd, unknown>> | null;
  /** The account number is write-only, like the SSN; leave it out to keep the one on file. */
  directDeposit?: { routing?: unknown; accountType?: unknown; account?: unknown } | null;
}

const COLS = `id, name, email, address_line1, address_city, address_state, address_zip, work_city, hire_date::text, termination_date::text,
  pay_type, pay_frequency, pay_rate::text, usual_hours::text, overtime_exempt, w4, de4, deductions, sick_balance_hours::text,
  ssn_last4, opening_ytd, dd_routing, dd_account_type, dd_account_last4`;

function employeeOf(r: any): Employee {
  return {
    id: r.id, name: r.name, email: r.email,
    address: r.address_line1 ? { line1: r.address_line1, city: r.address_city, state: r.address_state, zip: r.address_zip } : null,
    workCity: r.work_city,
    hireDate: r.hire_date, terminationDate: r.termination_date,
    status: r.termination_date ? "terminated" : "active",
    payType: r.pay_type, payFrequency: r.pay_frequency, payRate: trimZeros(r.pay_rate), usualHours: r.usual_hours ? trimZeros(r.usual_hours) : null,
    overtimeExempt: r.overtime_exempt, w4: r.w4, de4: r.de4, deductions: r.deductions,
    sickBalanceHours: trimZeros(r.sick_balance_hours), ssnLast4: r.ssn_last4, openingYtd: r.opening_ytd,
    directDeposit: r.dd_routing ? { routing: r.dd_routing, accountType: r.dd_account_type, accountLast4: r.dd_account_last4 } : null,
  };
}

function trimZeros(v: string): string {
  return new D(v).toString();
}

const FREQUENCIES = Object.keys(PERIODS_PER_YEAR);
const DEDUCTION_KINDS: DeductionKind[] = ["section125", "traditional401k", "post_tax"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function invalid(message: string): never {
  throw new LedgerError("INVALID", message);
}

function amount(v: unknown, field: string, opts: { optional?: boolean; places?: number } = {}): string | undefined {
  if (v === undefined || v === null || v === "") {
    if (opts.optional) return undefined;
    invalid(`${field} is required`);
  }
  const s = typeof v === "number" ? String(v) : v;
  const places = opts.places ?? 2;
  if (typeof s !== "string" || !new RegExp(`^\\d{1,9}(\\.\\d{1,${places}})?$`).test(s.trim())) {
    invalid(`${field} should be an amount like 25.00`);
  }
  return s.trim();
}

function cleanW4(w: EmployeeFields["w4"] = {}): W4 {
  const status = w.filingStatus ?? "single_or_mfs";
  if (!["single_or_mfs", "mfj", "hoh"].includes(status as string)) invalid("pick a W-4 filing status");
  const out: W4 = { filingStatus: status as W4["filingStatus"], step2Checked: Boolean(w.step2Checked) };
  const opt = (k: "step3Credits" | "step4aOtherIncome" | "step4bDeductions" | "step4cExtraWithholding", label: string) => {
    const v = amount(w[k], label, { optional: true });
    if (v && !new D(v).isZero()) out[k] = v;
  };
  opt("step3Credits", "W-4 step 3 credits");
  opt("step4aOtherIncome", "W-4 step 4(a) other income");
  opt("step4bDeductions", "W-4 step 4(b) deductions");
  opt("step4cExtraWithholding", "W-4 step 4(c) extra withholding");
  if (w.exempt) out.exempt = true;
  return out;
}

function cleanDe4(d: EmployeeFields["de4"] = {}): DE4 {
  const status = d.filingStatus ?? "single";
  if (!["single", "married", "hoh"].includes(status as string)) invalid("pick a DE 4 filing status");
  const count = (v: unknown, label: string) => {
    const n = v === undefined || v === null || v === "" ? 0 : Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 99) invalid(`${label} should be a whole number`);
    return n;
  };
  const out: DE4 = { filingStatus: status as DE4["filingStatus"], regularAllowances: count(d.regularAllowances, "DE 4 allowances") };
  const est = count(d.estimatedDeductionAllowances, "DE 4 estimated deduction allowances");
  if (est) out.estimatedDeductionAllowances = est;
  const extra = amount(d.additionalWithholding, "DE 4 additional withholding", { optional: true });
  if (extra && !new D(extra).isZero()) out.additionalWithholding = extra;
  if (d.exempt) out.exempt = true;
  return out;
}

function cleanDeductions(list: EmployeeFields["deductions"]): Deduction[] {
  if (!Array.isArray(list)) invalid("deductions should be a list");
  if (list.length > 20) invalid("too many deductions");
  return list.flatMap((d) => {
    const amt = amount(d.amount, "deduction amount", { optional: true });
    if (!amt || new D(amt).isZero()) return [];
    if (!DEDUCTION_KINDS.includes(d.kind as DeductionKind)) invalid("pick what kind of deduction it is");
    const description = typeof d.description === "string" && d.description.trim() ? d.description.trim().slice(0, 60)
      : { section125: "Health premium (pre-tax)", traditional401k: "401(k)", post_tax: "After-tax deduction" }[d.kind as DeductionKind];
    return [{ kind: d.kind as DeductionKind, amount: amt, description }];
  });
}

function cleanOpeningYtd(o: EmployeeFields["openingYtd"]): OpeningYtd | null {
  if (!o) return null;
  const year = Number(o.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) invalid("say which year the earlier wages are for");
  const f = (k: keyof Omit<OpeningYtd, "year">, label: string) => amount(o[k], label, { optional: true }) ?? "0";
  const out = {
    year,
    wages: f("wages", "wages paid earlier this year"),
    federalIncomeTax: f("federalIncomeTax", "federal income tax withheld"),
    socialSecurityTax: f("socialSecurityTax", "Social Security withheld"),
    medicareTax: f("medicareTax", "Medicare withheld"),
    caIncomeTax: f("caIncomeTax", "California income tax withheld"),
    caSdi: f("caSdi", "California SDI withheld"),
  };
  const anything = Object.entries(out).some(([k, v]) => k !== "year" && !new D(v as string).isZero());
  return anything ? out : null;
}

function columns(f: EmployeeFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.name !== undefined) {
    const name = typeof f.name === "string" ? f.name.trim() : "";
    if (!name) invalid("an employee needs a name");
    if (name.length > 100) invalid("that name is too long");
    out.name = name;
  }
  if (f.email !== undefined) {
    const email = typeof f.email === "string" ? f.email.trim().toLowerCase() : "";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid("that email address doesn't look right");
    out.email = email || null;
  }
  if (f.address !== undefined) {
    const a = cleanAddress(f.address as any);
    out.address_line1 = a?.line1 ?? null;
    out.address_city = a?.city ?? null;
    out.address_state = a?.state ?? null;
    out.address_zip = a?.zip ?? null;
  }
  if (f.workCity !== undefined) {
    const city = typeof f.workCity === "string" ? f.workCity.trim().replace(/\s+/g, " ") : "";
    if (city.length > 60) invalid("that city name is too long");
    out.work_city = city ? localWagePlace(city) ?? city : null;
  }
  if (f.hireDate !== undefined) {
    if (!DATE.test(f.hireDate)) invalid("the hire date should be a date");
    out.hire_date = f.hireDate;
  }
  if (f.terminationDate !== undefined) {
    if (f.terminationDate && !DATE.test(f.terminationDate)) invalid("the last day should be a date");
    out.termination_date = f.terminationDate || null;
  }
  if (f.payType !== undefined) {
    if (!["salary", "hourly"].includes(f.payType)) invalid("pick salary or hourly");
    out.pay_type = f.payType;
  }
  if (f.payFrequency !== undefined) {
    if (!FREQUENCIES.includes(f.payFrequency)) invalid("pick how often they're paid");
    out.pay_frequency = f.payFrequency;
  }
  if (f.payRate !== undefined) {
    const rate = amount(f.payRate, "pay rate", { places: 4 })!;
    if (new D(rate).lte(0)) invalid("the pay rate should be more than zero");
    out.pay_rate = rate;
  }
  if (f.usualHours !== undefined) out.usual_hours = amount(f.usualHours, "usual hours", { optional: true }) ?? null;
  if (f.overtimeExempt !== undefined) out.overtime_exempt = Boolean(f.overtimeExempt);
  if (f.w4 !== undefined) out.w4 = JSON.stringify(cleanW4(f.w4));
  if (f.de4 !== undefined) out.de4 = JSON.stringify(cleanDe4(f.de4));
  if (f.deductions !== undefined) out.deductions = JSON.stringify(cleanDeductions(f.deductions));
  if (f.sickBalanceHours !== undefined) out.sick_balance_hours = amount(f.sickBalanceHours, "sick leave balance", { places: 4 });
  if (f.ssn !== undefined) {
    const ssn = f.ssn ? cleanSsn(f.ssn) : null;
    out.ssn_last4 = ssn ? ssn.slice(5) : null;
    out.ssn_sealed = ssn ? seal(ssn) : null;
  }
  if (f.directDeposit !== undefined) Object.assign(out, directDepositColumns(f.directDeposit));
  if (f.openingYtd !== undefined) {
    const o = cleanOpeningYtd(f.openingYtd);
    out.opening_ytd = o ? JSON.stringify(o) : null;
  }
  return out;
}

/** Bank details for direct deposit. Without an account number, the routing number and type change and the account on file stays. */
export function directDepositColumns(dd: EmployeeFields["directDeposit"]): Record<string, unknown> {
  if (dd === null) return { dd_routing: null, dd_account_type: null, dd_account_last4: null, dd_account_sealed: null };
  const routing = typeof dd!.routing === "string" ? dd!.routing.replace(/\s/g, "") : "";
  if (!validRouting(routing)) invalid("that routing number isn't right; it's the nine digits at the bottom left of a check");
  const type = dd!.accountType ?? "checking";
  if (type !== "checking" && type !== "savings") invalid("pick checking or savings");
  const out: Record<string, unknown> = { dd_routing: routing, dd_account_type: type };
  if (dd!.account !== undefined && dd!.account !== null && dd!.account !== "") {
    const account = typeof dd!.account === "string" ? cleanAccountNumber(dd!.account) : null;
    if (!account) invalid("an account number is 4 to 17 digits");
    out.dd_account_last4 = account.slice(-4);
    out.dd_account_sealed = seal(account);
  }
  return out;
}

/** What the audit log keeps about a change: never a sealed number. */
function auditable(cols: Record<string, unknown>) {
  const { ssn_sealed: _sealed, dd_account_sealed: _account, ...rest } = cols;
  return rest;
}

async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    translateDbError(err);
  }
}

function requireWriter(actor: Actor, what: string) {
  if (!CAN_WRITE.includes(actor.role)) throw new LedgerError("FORBIDDEN", `role ${actor.role} cannot ${what}`);
}

export async function listEmployees(tx: Tx, entityId: string): Promise<Employee[]> {
  const { rows } = await tx.query(`SELECT ${COLS} FROM employees WHERE entity_id = $1 ORDER BY termination_date IS NOT NULL, lower(name)`, [entityId]);
  return rows.map(employeeOf);
}

export async function getEmployee(tx: Tx, entityId: string, employeeId: string): Promise<Employee> {
  const { rows } = await tx.query(`SELECT ${COLS} FROM employees WHERE id = $1 AND entity_id = $2`, [employeeId, entityId]);
  if (!rows[0]) invalid("employee not found");
  return employeeOf(rows[0]);
}

export async function createEmployee(
  tx: Tx,
  input: EmployeeFields & { orgId: string; entityId: string; actor: Actor },
): Promise<Employee> {
  requireWriter(input.actor, "add employees");
  for (const k of ["name", "hireDate", "payType", "payFrequency", "payRate"] as const) {
    if (input[k] === undefined) invalid(`${{ name: "name", hireDate: "hire date", payType: "pay type", payFrequency: "pay frequency", payRate: "pay rate" }[k]} is required`);
  }
  const cols = columns({ w4: {}, de4: {}, deductions: [], ...input });
  checkShape(cols);
  if (cols.dd_routing && !cols.dd_account_sealed) invalid("enter the account number for direct deposit");
  const names = Object.keys(cols);
  const { rows } = await run(() => tx.query(
    `INSERT INTO employees (org_id, entity_id, ${names.join(", ")}) VALUES ($1, $2, ${names.map((_, i) => `$${i + 3}`).join(", ")}) RETURNING ${COLS}`,
    [input.orgId, input.entityId, ...Object.values(cols)],
  ));
  const employee = employeeOf(rows[0]);
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "employee.created",
    objectType: "employee", objectId: employee.id, after: auditable(cols),
  });
  return employee;
}

/** Changes an employee. Pay runs already prepared keep the details they were prepared with. */
export async function updateEmployee(
  tx: Tx,
  input: EmployeeFields & { orgId: string; entityId: string; employeeId: string; actor: Actor },
): Promise<Employee> {
  requireWriter(input.actor, "change employees");
  const before = (await tx.query(`SELECT ${COLS} FROM employees WHERE id = $1 AND entity_id = $2 FOR UPDATE`, [input.employeeId, input.entityId])).rows[0];
  if (!before) invalid("employee not found");
  const cols = columns(input);
  checkShape({ pay_type: before.pay_type, overtime_exempt: before.overtime_exempt, ...cols });
  if (cols.dd_routing && !cols.dd_account_sealed && !before.dd_account_last4) invalid("enter the account number for direct deposit");
  if (!Object.keys(cols).length) return employeeOf(before);
  const { rows } = await run(() => tx.query(
    `UPDATE employees SET ${Object.keys(cols).map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1 RETURNING ${COLS}`,
    [input.employeeId, ...Object.values(cols)],
  ));
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "employee.updated",
    objectType: "employee", objectId: input.employeeId, before: auditable(before), after: auditable(cols),
  });
  return employeeOf(rows[0]);
}

function checkShape(cols: Record<string, unknown>) {
  if (cols.pay_type === "hourly" && cols.overtime_exempt === true) invalid("hourly employees can't be exempt from overtime");
}

/** The employer's California UI rate, as a fraction, from its EDD notice. */
export async function setUiRate(tx: Tx, input: { orgId: string; entityId: string; rate: string | null; actor: Actor }) {
  requireWriter(input.actor, "change payroll settings");
  if (input.rate !== null && (!/^\d(\.\d{1,5})?$/.test(input.rate) || new D(input.rate).gt("0.2"))) {
    invalid("the UI rate should be a percentage between 0 and 20");
  }
  await tx.query("UPDATE entities SET ca_ui_rate = $2 WHERE id = $1", [input.entityId, input.rate]);
  await appendAudit(tx, {
    orgId: input.orgId, entityId: input.entityId, actor: input.actor.id, action: "entity.ui_rate_set",
    objectType: "entity", objectId: input.entityId, after: { caUiRate: input.rate },
  });
}

/** Salary per pay period from an annual salary, to the cent. */
export function salaryPerPeriod(annual: string, frequency: PayFrequency): string {
  return new D(annual).div(PERIODS_PER_YEAR[frequency]).toDecimalPlaces(2).toFixed(2);
}

/** Opening year-to-date figures in cents, for the year of a pay date. */
export function openingFor(e: Pick<Employee, "openingYtd">, year: number) {
  const o = e.openingYtd && e.openingYtd.year === year ? e.openingYtd : null;
  const m = (v: string | undefined) => toMinor(v ?? "0");
  return {
    wagesMinor: m(o?.wages),
    federalIncomeTaxMinor: m(o?.federalIncomeTax),
    socialSecurityTaxMinor: m(o?.socialSecurityTax),
    medicareTaxMinor: m(o?.medicareTax),
    caIncomeTaxMinor: m(o?.caIncomeTax),
    caSdiMinor: m(o?.caSdi),
  };
}
