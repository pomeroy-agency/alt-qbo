/**
 * One CSV cell. Text that a spreadsheet would read as a formula (starting
 * with =, +, -, @, a tab or a return) gets a leading apostrophe, so a name
 * or memo typed into the books can't run as a formula when the export is
 * opened. Plain numbers, negative ones included, are left as they are.
 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
