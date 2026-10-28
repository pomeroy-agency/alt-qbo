// A direct-deposit file in the NACHA format banks accept for payroll: one
// PPD batch of credits to employees' checking or savings accounts. The
// business uploads it to its own bank, which moves the money; TrailBook never
// does. Every record is 94 characters and the file is padded to a multiple
// of ten records, as the NACHA Operating Rules require.

export interface NachaOrigin {
  /** The business's bank (the ODFI) routing number, nine digits. */
  odfiRouting: string;
  /** Usually the bank's routing number; some banks give a different one. */
  immediateDestination: string;
  /** The bank's name, as it should appear in the file header. */
  destinationName: string;
  /** Ten characters the bank assigns; often "1" followed by the EIN. */
  immediateOrigin: string;
  /** Ten characters identifying the business in the batch; often "1" followed by the EIN. */
  companyId: string;
  /** The name employees see on their bank statement, 16 characters at most. */
  companyName: string;
  /** Balanced files add one debit from the business's own account for the total. */
  offset?: { account: string; accountType: "checking" | "savings" };
}

export interface NachaCredit {
  /** Shown on the employee's bank record, 15 characters at most. */
  individualId: string;
  name: string;
  routing: string;
  account: string;
  accountType: "checking" | "savings";
  amountMinor: bigint;
}

export interface NachaFile {
  text: string;
  entryCount: number;
  totalCreditMinor: bigint;
  totalDebitMinor: bigint;
}

/** True when a routing number has nine digits, a Federal Reserve prefix and a valid check digit. */
export function validRouting(routing: string): boolean {
  if (!/^\d{9}$/.test(routing)) return false;
  const prefix = Number(routing.slice(0, 2));
  // 00 is the U.S. government; 01-12 Federal Reserve districts, 21-32 thrifts, 61-72 electronic, 80 traveler's checks.
  if (!(prefix <= 12 || (prefix >= 21 && prefix <= 32) || (prefix >= 61 && prefix <= 72) || prefix === 80)) return false;
  const weights = [3, 7, 1, 3, 7, 1, 3, 7, 1];
  return [...routing].reduce((sum, c, i) => sum + Number(c) * weights[i]!, 0) % 10 === 0;
}

/** Bank account numbers: 4 to 17 letters or digits once spaces and dashes are taken out. */
export function cleanAccountNumber(v: string): string | null {
  const s = v.replace(/[\s-]/g, "").toUpperCase();
  return /^[0-9A-Z]{4,17}$/.test(s) ? s : null;
}

/** Upper-case letters, digits and a few marks, which every bank accepts. */
function text(v: string, width: number): string {
  const clean = v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 &'.,/-]/g, " ").replace(/\s+/g, " ").trim();
  return clean.slice(0, width).padEnd(width, " ");
}

function num(v: bigint | number | string, width: number): string {
  const s = String(v);
  if (s.length > width || !/^\d+$/.test(s)) throw new Error(`${s} does not fit in ${width} digits`);
  return s.padStart(width, "0");
}

/** A ten-character ID: a routing number gets a leading space, anything else is right-aligned. */
function field10(v: string): string {
  const s = v.replace(/\s/g, "").toUpperCase();
  if (!/^[0-9A-Z]{1,10}$/.test(s)) throw new Error(`${v} isn't a valid bank ID`);
  return s.padStart(10, " ");
}

const yymmdd = (iso: string) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);

function record(...fields: string[]): string {
  const r = fields.join("");
  if (r.length !== 94) throw new Error(`NACHA record is ${r.length} characters, not 94`);
  return r;
}

const CREDIT = { checking: "22", savings: "32" } as const;
const DEBIT = { checking: "27", savings: "37" } as const;

/**
 * Builds the file. `effectiveDate` is the pay date (YYYY-MM-DD), the day the
 * money should land; `createdAt` stamps the header.
 */
export function buildNachaFile(input: {
  origin: NachaOrigin;
  credits: NachaCredit[];
  effectiveDate: string;
  createdAt: Date;
  description?: string;
  fileIdModifier?: string;
}): NachaFile {
  const o = input.origin;
  if (!validRouting(o.odfiRouting)) throw new Error("the business's bank routing number isn't valid");
  if (!validRouting(o.immediateDestination)) throw new Error("the immediate destination isn't a valid routing number");
  if (!input.credits.length) throw new Error("no one in this run is paid by direct deposit");
  const modifier = input.fileIdModifier ?? "A";
  if (!/^[A-Z0-9]$/.test(modifier)) throw new Error("the file ID modifier is one letter or digit");

  const created = input.createdAt.toISOString();
  const odfi8 = o.odfiRouting.slice(0, 8);
  const lines: string[] = [];
  lines.push(record(
    "1", "01", " " + o.immediateDestination, field10(o.immediateOrigin),
    yymmdd(created.slice(0, 10)), created.slice(11, 13) + created.slice(14, 16), modifier, "094", "10", "1",
    text(o.destinationName, 23), text(o.companyName, 23), " ".repeat(8),
  ));
  const batchNo = num(1, 7);
  const description = text(input.description ?? "PAYROLL", 10);
  const effective = yymmdd(input.effectiveDate);
  const serviceClass = o.offset ? "200" : "220";
  lines.push(record(
    "5", serviceClass, text(o.companyName, 16), " ".repeat(20), field10(o.companyId), "PPD", description,
    effective, effective, "   ", "1", odfi8, batchNo,
  ));

  let seq = 0;
  let hash = 0n;
  let credit = 0n;
  let debit = 0n;
  const entry = (code: string, routing: string, account: string, amount: bigint, id: string, name: string) => {
    if (!validRouting(routing)) throw new Error(`${name}: the routing number isn't valid`);
    if (amount <= 0n) throw new Error(`${name}: the amount must be more than zero`);
    seq += 1;
    hash += BigInt(routing.slice(0, 8));
    lines.push(record(
      "6", code, routing.slice(0, 8), routing.slice(8), text(account, 17), num(amount, 10), text(id, 15), text(name, 22),
      "  ", "0", odfi8 + num(seq, 7),
    ));
  };
  for (const c of input.credits) {
    const account = cleanAccountNumber(c.account);
    if (!account) throw new Error(`${c.name}: the account number isn't valid`);
    entry(CREDIT[c.accountType], c.routing, account, c.amountMinor, c.individualId, c.name);
    credit += c.amountMinor;
  }
  if (o.offset) {
    const account = cleanAccountNumber(o.offset.account);
    if (!account) throw new Error("the business's account number isn't valid");
    entry(DEBIT[o.offset.accountType], o.odfiRouting, account, credit, "PAYROLL", o.companyName);
    debit = credit;
  }
  const entryHash = num(hash % 10_000_000_000n, 10);
  lines.push(record(
    "8", serviceClass, num(seq, 6), entryHash, num(debit, 12), num(credit, 12), field10(o.companyId),
    " ".repeat(19), " ".repeat(6), odfi8, batchNo,
  ));
  const recordCount = lines.length + 1;
  const blocks = Math.ceil(recordCount / 10);
  lines.push(record(
    "9", num(1, 6), num(blocks, 6), num(seq, 8), entryHash, num(debit, 12), num(credit, 12), " ".repeat(39),
  ));
  while (lines.length % 10) lines.push("9".repeat(94));
  return { text: lines.join("\r\n") + "\r\n", entryCount: seq, totalCreditMinor: credit, totalDebitMinor: debit };
}
