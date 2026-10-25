export type LedgerErrorCode =
  | "UNBALANCED"
  | "IMMUTABLE"
  | "PERIOD_LOCKED"
  | "PERIOD_SOFT_CLOSED"
  | "PERIOD_MISMATCH"
  | "PERIOD_OVERLAP"
  | "NO_PERIOD"
  | "UNKNOWN_ACCOUNT"
  | "INACTIVE_ACCOUNT"
  | "IDEMPOTENCY_CONFLICT"
  | "ALREADY_REVERSED"
  | "FORBIDDEN"
  | "INVALID"
  | "OVERPAID"
  | "AUDIT_CHAIN"
  | "TAX_LOOKUP";

export class LedgerError extends Error {
  constructor(
    public readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

const DB_CODES: LedgerErrorCode[] = [
  "UNBALANCED", "IMMUTABLE", "PERIOD_LOCKED", "PERIOD_SOFT_CLOSED", "PERIOD_MISMATCH", "PERIOD_OVERLAP", "AUDIT_CHAIN",
  "OVERPAID", "INVALID", "FORBIDDEN", "INACTIVE_ACCOUNT",
];

/** Turns a database-raised rule violation ("CODE: detail") into a LedgerError; rethrows anything else. */
export function translateDbError(err: unknown): never {
  const e = err as { code?: string; message?: string };
  if (e?.code === "P0001" && e.message) {
    const code = DB_CODES.find((c) => e.message!.startsWith(`${c}:`));
    if (code) throw new LedgerError(code, e.message);
  }
  throw err;
}
