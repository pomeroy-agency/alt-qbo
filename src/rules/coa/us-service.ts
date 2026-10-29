// US chart-of-accounts template for service businesses. Each account maps to
// a US GAAP statement line and a cash-flow class, and carries tax-line codes
// per return type for the trial-balance export to Intuit tax software.
// Tax-line codes name the form and line ("SchC.L8" = Schedule C line 8).

export type ReturnType = "sch_c" | "f1065" | "f1120s" | "f1120";

export interface TemplateAccount {
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "revenue" | "expense";
  subtype: string;
  statementLine: string;
  cashFlowClass: "cash" | "operating" | "investing" | "financing" | "none";
  taxLines: Partial<Record<ReturnType, string>>;
  systemKey?: string;
}

// Schedule C has no balance sheet, so balance-sheet accounts map to a
// "not reported" code there rather than being left unmapped.
const bs = (sch_c: string | undefined, f1065: string, f1120s: string, f1120: string) => ({
  sch_c: sch_c ?? "SchC.NotReported", f1065, f1120s, f1120,
});

export const usServiceTemplate: readonly TemplateAccount[] = [
  // Assets
  { code: "1000", name: "Operating checking", type: "asset", subtype: "bank", statementLine: "BS.CurrentAssets.Cash", cashFlowClass: "cash", taxLines: bs(undefined, "1065.L.L1", "1120S.L.L1", "1120.L.L1"), systemKey: "cash_operating" },
  { code: "1010", name: "Savings", type: "asset", subtype: "bank", statementLine: "BS.CurrentAssets.Cash", cashFlowClass: "cash", taxLines: bs(undefined, "1065.L.L1", "1120S.L.L1", "1120.L.L1") },
  { code: "1100", name: "Accounts receivable", type: "asset", subtype: "receivable", statementLine: "BS.CurrentAssets.Receivables", cashFlowClass: "operating", taxLines: bs(undefined, "1065.L.L2a", "1120S.L.L2a", "1120.L.L2a"), systemKey: "accounts_receivable" },
  { code: "1200", name: "Prepaid expenses", type: "asset", subtype: "prepaid", statementLine: "BS.CurrentAssets.Prepaids", cashFlowClass: "operating", taxLines: bs(undefined, "1065.L.L6", "1120S.L.L6", "1120.L.L6") },
  { code: "1500", name: "Furniture and equipment", type: "asset", subtype: "fixed_asset", statementLine: "BS.NoncurrentAssets.PPE", cashFlowClass: "investing", taxLines: bs(undefined, "1065.L.L10a", "1120S.L.L10a", "1120.L.L10a") },
  { code: "1590", name: "Accumulated depreciation", type: "asset", subtype: "contra_asset", statementLine: "BS.NoncurrentAssets.PPE", cashFlowClass: "operating", taxLines: bs(undefined, "1065.L.L10b", "1120S.L.L10b", "1120.L.L10b") },
  // Liabilities
  { code: "2000", name: "Accounts payable", type: "liability", subtype: "payable", statementLine: "BS.CurrentLiabilities.Payables", cashFlowClass: "operating", taxLines: bs(undefined, "1065.L.L15", "1120S.L.L16", "1120.L.L16"), systemKey: "accounts_payable" },
  { code: "2100", name: "Credit card", type: "liability", subtype: "credit_card", statementLine: "BS.CurrentLiabilities.Payables", cashFlowClass: "operating", taxLines: bs(undefined, "1065.L.L17", "1120S.L.L18", "1120.L.L18") },
  { code: "2200", name: "Sales tax payable", type: "liability", subtype: "tax_payable", statementLine: "BS.CurrentLiabilities.Taxes", cashFlowClass: "operating", taxLines: bs(undefined, "1065.L.L17", "1120S.L.L18", "1120.L.L18"), systemKey: "sales_tax_payable" },
  { code: "2300", name: "Net pay clearing", type: "liability", subtype: "payroll_clearing", statementLine: "BS.CurrentLiabilities.Accrued", cashFlowClass: "operating", taxLines: bs(undefined, "1065.L.L17", "1120S.L.L18", "1120.L.L18"), systemKey: "net_pay_clearing" },
  { code: "2310", name: "Federal income tax withheld", type: "liability", subtype: "payroll_tax", statementLine: "BS.CurrentLiabilities.Taxes", cashFlowClass: "operating", taxLines: bs(undefined, "1065.L.L17", "1120S.L.L18", "1120.L.L18"), systemKey: "fit_payable" },
  { code: "2320", name: "Social Security and Medicare payable", type: "liability", subtype: "payroll_tax", statementLine: "BS.CurrentLiabilities.Taxes", cashFlowClass: "operating", taxLines: bs(undefined, "1065.L.L17", "1120S.L.L18", "1120.L.L18"), systemKey: "fica_payable" },
  { code: "2330", name: "FUTA payable", type: "liability", subtype: "payroll_tax", statementLine: "BS.CurrentLiabilities.Taxes", cashFlowClass: "operating", taxLines: bs(undefined, "1065.L.L17", "1120S.L.L18", "1120.L.L18"), systemKey: "futa_payable" },
  { code: "2380", name: "401(k) deferrals payable", type: "liability", subtype: "payroll_deduction", statementLine: "BS.CurrentLiabilities.Accrued", cashFlowClass: "operating", taxLines: bs(undefined, "1065.L.L17", "1120S.L.L18", "1120.L.L18"), systemKey: "retirement_401k_payable" },
  { code: "2385", name: "Section 125 deductions payable", type: "liability", subtype: "payroll_deduction", statementLine: "BS.CurrentLiabilities.Accrued", cashFlowClass: "operating", taxLines: bs(undefined, "1065.L.L17", "1120S.L.L18", "1120.L.L18"), systemKey: "section125_payable" },
  { code: "2390", name: "Post-tax deductions payable", type: "liability", subtype: "payroll_deduction", statementLine: "BS.CurrentLiabilities.Accrued", cashFlowClass: "operating", taxLines: bs(undefined, "1065.L.L17", "1120S.L.L18", "1120.L.L18"), systemKey: "post_tax_deductions_payable" },
  { code: "2395", name: "Employee reimbursements payable", type: "liability", subtype: "payable", statementLine: "BS.CurrentLiabilities.Accrued", cashFlowClass: "operating", taxLines: bs(undefined, "1065.L.L17", "1120S.L.L18", "1120.L.L18"), systemKey: "reimbursements_payable" },
  { code: "2400", name: "Deferred revenue", type: "liability", subtype: "deferred_revenue", statementLine: "BS.CurrentLiabilities.ContractLiabilities", cashFlowClass: "operating", taxLines: bs(undefined, "1065.L.L17", "1120S.L.L18", "1120.L.L18"), systemKey: "deferred_revenue" },
  { code: "2700", name: "Long-term loan", type: "liability", subtype: "long_term_debt", statementLine: "BS.NoncurrentLiabilities.Debt", cashFlowClass: "financing", taxLines: bs(undefined, "1065.L.L19b", "1120S.L.L20", "1120.L.L20") },
  // Equity
  { code: "3000", name: "Owner's capital", type: "equity", subtype: "contributed_capital", statementLine: "BS.Equity.Contributed", cashFlowClass: "financing", taxLines: bs(undefined, "1065.L.L21", "1120S.L.L22", "1120.L.L22"), systemKey: "owner_capital" },
  { code: "3100", name: "Owner's draws and distributions", type: "equity", subtype: "distributions", statementLine: "BS.Equity.Distributions", cashFlowClass: "financing", taxLines: bs(undefined, "1065.M2.L6", "1120S.M2.L7", "1120.M2.L5") },
  { code: "3900", name: "Retained earnings", type: "equity", subtype: "retained_earnings", statementLine: "BS.Equity.RetainedEarnings", cashFlowClass: "none", taxLines: bs(undefined, "1065.L.L21", "1120S.L.L24", "1120.L.L25"), systemKey: "retained_earnings" },
  // Revenue
  { code: "4000", name: "Service revenue", type: "revenue", subtype: "operating_revenue", statementLine: "IS.Revenue", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L1", f1065: "1065.L1a", f1120s: "1120S.L1a", f1120: "1120.L1a" }, systemKey: "service_revenue" },
  { code: "4900", name: "Interest income", type: "revenue", subtype: "other_income", statementLine: "IS.OtherIncome", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L6", f1065: "1065.K.L5", f1120s: "1120S.K.L4", f1120: "1120.L5" } },
  // Expenses
  { code: "5000", name: "Subcontractors", type: "expense", subtype: "cost_of_revenue", statementLine: "IS.CostOfRevenue", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L11", f1065: "1065.L20", f1120s: "1120S.L19", f1120: "1120.L26" } },
  { code: "6000", name: "Advertising", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L8", f1065: "1065.L20", f1120s: "1120S.L16", f1120: "1120.L22" } },
  { code: "6100", name: "Bank and card fees", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L27a", f1065: "1065.L20", f1120s: "1120S.L19", f1120: "1120.L26" } },
  { code: "6200", name: "Insurance", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L15", f1065: "1065.L20", f1120s: "1120S.L19", f1120: "1120.L26" } },
  { code: "6300", name: "Legal and professional fees", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L17", f1065: "1065.L20", f1120s: "1120S.L19", f1120: "1120.L26" } },
  { code: "6400", name: "Rent", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L20b", f1065: "1065.L13", f1120s: "1120S.L11", f1120: "1120.L16" } },
  { code: "6500", name: "Software and subscriptions", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L18", f1065: "1065.L20", f1120s: "1120S.L19", f1120: "1120.L26" } },
  { code: "6600", name: "Travel", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L24a", f1065: "1065.L20", f1120s: "1120S.L19", f1120: "1120.L26" } },
  { code: "6650", name: "Meals (50% deductible)", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L24b", f1065: "1065.L20", f1120s: "1120S.L19", f1120: "1120.L26" } },
  { code: "6700", name: "Utilities and phone", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L25", f1065: "1065.L20", f1120s: "1120S.L19", f1120: "1120.L26" } },
  { code: "6800", name: "Depreciation", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L13", f1065: "1065.L16a", f1120s: "1120S.L14", f1120: "1120.L20" } },
  { code: "7000", name: "Wages and salaries", type: "expense", subtype: "payroll_expense", statementLine: "IS.OperatingExpenses.Payroll", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L26", f1065: "1065.L9", f1120s: "1120S.L8", f1120: "1120.L13" }, systemKey: "wages_expense" },
  { code: "7010", name: "Officer compensation", type: "expense", subtype: "payroll_expense", statementLine: "IS.OperatingExpenses.Payroll", cashFlowClass: "operating", taxLines: { f1120s: "1120S.L7", f1120: "1120.L12" } },
  { code: "7100", name: "Employer payroll taxes", type: "expense", subtype: "payroll_expense", statementLine: "IS.OperatingExpenses.Payroll", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L23", f1065: "1065.L14", f1120s: "1120S.L12", f1120: "1120.L17" }, systemKey: "employer_payroll_tax_expense" },
  { code: "7200", name: "Taxes and licenses", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L23", f1065: "1065.L14", f1120s: "1120S.L12", f1120: "1120.L17" } },
  { code: "7900", name: "Interest expense", type: "expense", subtype: "other_expense", statementLine: "IS.OtherExpense", cashFlowClass: "operating", taxLines: { sch_c: "SchC.L16b", f1065: "1065.L15", f1120s: "1120S.L13", f1120: "1120.L18" } },
];

/**
 * A state's payroll tax liability accounts (src/rules: each state pack lists
 * them), shaped like the template's other payroll tax liabilities.
 */
export function stateTaxAccounts(accounts: readonly { code: string; name: string; systemKey: string }[]): TemplateAccount[] {
  return accounts.map((a) => ({
    code: a.code, name: a.name, type: "liability", subtype: "payroll_tax", statementLine: "BS.CurrentLiabilities.Taxes", cashFlowClass: "operating",
    taxLines: bs(undefined, "1065.L.L17", "1120S.L.L18", "1120.L.L18"), systemKey: a.systemKey,
  }));
}

export const COA_TEMPLATES: Record<string, readonly TemplateAccount[]> = {
  "us-service": usServiceTemplate,
};

/** Return type implied by a US entity type, for picking tax-line codes. */
export function returnTypeFor(entityType: string): ReturnType {
  switch (entityType) {
    case "sole_prop":
    case "llc_single":
      return "sch_c";
    case "llc_partnership":
    case "partnership":
      return "f1065";
    case "llc_s_corp":
    case "s_corp":
      return "f1120s";
    case "c_corp":
      return "f1120";
    default:
      throw new Error(`unknown entity type ${entityType}`);
  }
}
