// A direct-deposit file in Payments Canada's Standard 005 format (often
// called CPA 005), which Canadian banks take for payroll. One "A" header,
// "C" credit records holding up to six 240-character payments each, and a
// "Z" trailer; every record is 1,464 characters. The business uploads it to
// its own bank, which moves the money; TrailBook never does. Banks differ in
// small ways (line endings, blank versus zero filler in unused segments), so
// each bank's own CPA 005 guide has the final word.

export interface Cpa005Origin {
  /** The originator ID the bank assigns, up to 10 letters or digits. */
  originatorId: string;
  /** The bank's processing (destination data) centre, five digits. */
  dataCentre: string;
  /** Up to 15 characters, shown on employees' bank statements. */
  shortName: string;
  /** The business's full name, up to 30 characters. */
  longName: string;
  /** Where returned payments go: the business's own account. */
  returnInstitution: string;
  returnTransit: string;
  returnAccount: string;
  /** 1 to 9999, a new number for each file sent to the bank. */
  fileNumber: number;
}

export interface Cpa005Credit {
  /** The business's reference for the payment, up to 19 characters. */
  reference: string;
  name: string;
  institution: string;
  transit: string;
  account: string;
  amountMinor: bigint;
}

export interface Cpa005File {
  text: string;
  entryCount: number;
  totalCreditMinor: bigint;
}

/** Transaction code 200: payroll deposit. */
const PAYROLL = "200";
const RECORD = 1464;
const SEGMENT = 240;

export const validInstitution = (v: string) => /^\d{3}$/.test(v);
export const validTransit = (v: string) => /^\d{5}$/.test(v);
/** Canadian account numbers are 5 to 12 digits once spaces and dashes are taken out. */
export function cleanCanadianAccount(v: string): string | null {
  const s = v.replace(/[\s-]/g, "");
  return /^\d{5,12}$/.test(s) ? s : null;
}

function text(v: string, width: number): string {
  const clean = v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 &'.,/-]/g, " ").replace(/\s+/g, " ").trim();
  return clean.slice(0, width).padEnd(width, " ");
}

function num(v: bigint | number | string, width: number): string {
  const s = String(v);
  if (s.length > width || !/^\d+$/.test(s)) throw new Error(`${s} does not fit in ${width} digits`);
  return s.padStart(width, "0");
}

/** 0YYDDD: a zero, the year's last two digits and the day of the year. */
export function julian(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const day = Math.round((d.getTime() - start) / 86_400_000) + 1;
  return "0" + iso.slice(2, 4) + String(day).padStart(3, "0");
}

const bankId = (institution: string, transit: string) => "0" + institution + transit;

function check(r: string): string {
  if (r.length !== RECORD) throw new Error(`CPA 005 record is ${r.length} characters, not ${RECORD}`);
  return r;
}

/** Builds the file. `dueDate` is the pay date (YYYY-MM-DD), the day the money should land. */
export function buildCpa005File(input: { origin: Cpa005Origin; credits: Cpa005Credit[]; dueDate: string; createdAt: Date }): Cpa005File {
  const o = input.origin;
  const originator = o.originatorId.replace(/\s/g, "").toUpperCase();
  if (!/^[0-9A-Z]{1,10}$/.test(originator)) throw new Error("the originator ID is up to 10 letters or digits");
  if (!/^\d{5}$/.test(o.dataCentre)) throw new Error("the processing centre is five digits");
  if (!validInstitution(o.returnInstitution) || !validTransit(o.returnTransit)) throw new Error("the business's institution and transit numbers aren't valid");
  const returnAccount = cleanCanadianAccount(o.returnAccount);
  if (!returnAccount) throw new Error("the business's account number isn't valid");
  if (!Number.isInteger(o.fileNumber) || o.fileNumber < 1 || o.fileNumber > 9999) throw new Error("the file number is 1 to 9999");
  if (!input.credits.length) throw new Error("no one in this run is paid by direct deposit");

  const origin10 = originator.padEnd(10, " ");
  const fileNo = num(o.fileNumber, 4);
  const due = julian(input.dueDate);
  const lines: string[] = [];
  let count = 0;
  const prefix = (type: string) => type + num(++count, 9) + origin10 + fileNo;

  lines.push(check(prefix("A") + julian(input.createdAt.toISOString().slice(0, 10)) + o.dataCentre + " ".repeat(20) + "CAD" + " ".repeat(RECORD - 58)));

  let total = 0n;
  const segments: string[] = [];
  for (const c of input.credits) {
    if (!validInstitution(c.institution) || !validTransit(c.transit)) throw new Error(`${c.name}: the institution and transit numbers aren't valid`);
    const account = cleanCanadianAccount(c.account);
    if (!account) throw new Error(`${c.name}: the account number isn't valid`);
    if (c.amountMinor <= 0n) throw new Error(`${c.name}: the amount must be more than zero`);
    total += c.amountMinor;
    const seg = PAYROLL + num(c.amountMinor, 10) + due + bankId(c.institution, c.transit) + account.padEnd(12, " ")
      + "0".repeat(22) + "000" + text(o.shortName, 15) + text(c.name, 30) + text(o.longName, 30) + origin10
      + text(c.reference, 19) + bankId(o.returnInstitution, o.returnTransit) + returnAccount.padEnd(12, " ")
      + " ".repeat(15) + " ".repeat(22) + "  " + "0".repeat(11);
    if (seg.length !== SEGMENT) throw new Error(`CPA 005 segment is ${seg.length} characters, not ${SEGMENT}`);
    segments.push(seg);
  }
  for (let i = 0; i < segments.length; i += 6) {
    const chunk = segments.slice(i, i + 6);
    lines.push(check(prefix("C") + chunk.join("") + " ".repeat(SEGMENT * (6 - chunk.length))));
  }
  lines.push(check(prefix("Z") + num(0, 14) + num(0, 8) + num(total, 14) + num(segments.length, 8) + num(0, 14) + num(0, 8) + num(0, 14) + num(0, 8) + " ".repeat(RECORD - 112)));
  return { text: lines.join("\r\n") + "\r\n", entryCount: segments.length, totalCreditMinor: total };
}
