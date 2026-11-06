import type { TemplateAccount } from "./us-service.js";

// Canadian chart-of-accounts template for service businesses. Tax lines are
// CRA General Index of Financial Information (GIFI) codes, which the T2
// (corporations) and T5013 (partnerships) schedules use; the T2125 statement
// of business activities uses the same numbers for its income and expense
// lines and has no balance sheet. Codes from CRA guide RC4088; to be checked
// against the current guide before Canada is released (docs/rule-pack-review.md).

const gifi = (code: string) => ({ t2125: `GIFI.${code}`, t5013: `GIFI.${code}`, t2: `GIFI.${code}` });

/** A balance-sheet account: GIFI on the T2 and T5013, not reported on the T2125. */
export const gifiBs = (code: string) => ({ ...gifi(code), t2125: "T2125.NotReported" });

export const caServiceTemplate: readonly TemplateAccount[] = [
  // Assets
  { code: "1000", name: "Operating chequing", type: "asset", subtype: "bank", statementLine: "BS.CurrentAssets.Cash", cashFlowClass: "cash", taxLines: gifiBs("1002"), systemKey: "cash_operating" },
  { code: "1010", name: "Savings", type: "asset", subtype: "bank", statementLine: "BS.CurrentAssets.Cash", cashFlowClass: "cash", taxLines: gifiBs("1002") },
  { code: "1100", name: "Accounts receivable", type: "asset", subtype: "receivable", statementLine: "BS.CurrentAssets.Receivables", cashFlowClass: "operating", taxLines: gifiBs("1060"), systemKey: "accounts_receivable" },
  { code: "1200", name: "Prepaid expenses", type: "asset", subtype: "prepaid", statementLine: "BS.CurrentAssets.Prepaids", cashFlowClass: "operating", taxLines: gifiBs("1484") },
  { code: "1310", name: "GST/HST paid on purchases (input tax credits)", type: "asset", subtype: "other_current_asset", statementLine: "BS.CurrentAssets.Other", cashFlowClass: "operating", taxLines: gifiBs("1066"), systemKey: "gst_itc" },
  { code: "1320", name: "QST paid on purchases (input tax refunds)", type: "asset", subtype: "other_current_asset", statementLine: "BS.CurrentAssets.Other", cashFlowClass: "operating", taxLines: gifiBs("1066"), systemKey: "qst_itr" },
  { code: "1500", name: "Furniture and equipment", type: "asset", subtype: "fixed_asset", statementLine: "BS.NoncurrentAssets.PPE", cashFlowClass: "investing", taxLines: gifiBs("1787") },
  { code: "1590", name: "Accumulated amortization", type: "asset", subtype: "contra_asset", statementLine: "BS.NoncurrentAssets.PPE", cashFlowClass: "operating", taxLines: gifiBs("1788") },
  // Liabilities
  { code: "2000", name: "Accounts payable", type: "liability", subtype: "payable", statementLine: "BS.CurrentLiabilities.Payables", cashFlowClass: "operating", taxLines: gifiBs("2620"), systemKey: "accounts_payable" },
  { code: "2100", name: "Credit card", type: "liability", subtype: "credit_card", statementLine: "BS.CurrentLiabilities.Payables", cashFlowClass: "operating", taxLines: gifiBs("2707") },
  { code: "2200", name: "GST/HST and sales tax payable", type: "liability", subtype: "tax_payable", statementLine: "BS.CurrentLiabilities.Taxes", cashFlowClass: "operating", taxLines: gifiBs("2680"), systemKey: "sales_tax_payable" },
  { code: "2210", name: "QST payable", type: "liability", subtype: "tax_payable", statementLine: "BS.CurrentLiabilities.Taxes", cashFlowClass: "operating", taxLines: gifiBs("2680"), systemKey: "qst_payable" },
  { code: "2220", name: "PST payable", type: "liability", subtype: "tax_payable", statementLine: "BS.CurrentLiabilities.Taxes", cashFlowClass: "operating", taxLines: gifiBs("2680"), systemKey: "pst_payable" },
  { code: "2300", name: "Net pay clearing", type: "liability", subtype: "payroll_clearing", statementLine: "BS.CurrentLiabilities.Accrued", cashFlowClass: "operating", taxLines: gifiBs("2620"), systemKey: "net_pay_clearing" },
  { code: "2380", name: "RRSP and pension deductions payable", type: "liability", subtype: "payroll_deduction", statementLine: "BS.CurrentLiabilities.Accrued", cashFlowClass: "operating", taxLines: gifiBs("2620"), systemKey: "retirement_401k_payable" },
  { code: "2385", name: "Benefit deductions payable", type: "liability", subtype: "payroll_deduction", statementLine: "BS.CurrentLiabilities.Accrued", cashFlowClass: "operating", taxLines: gifiBs("2620"), systemKey: "section125_payable" },
  { code: "2390", name: "Other payroll deductions payable", type: "liability", subtype: "payroll_deduction", statementLine: "BS.CurrentLiabilities.Accrued", cashFlowClass: "operating", taxLines: gifiBs("2620"), systemKey: "post_tax_deductions_payable" },
  { code: "2395", name: "Employee reimbursements payable", type: "liability", subtype: "payable", statementLine: "BS.CurrentLiabilities.Accrued", cashFlowClass: "operating", taxLines: gifiBs("2620"), systemKey: "reimbursements_payable" },
  { code: "2400", name: "Deferred revenue", type: "liability", subtype: "deferred_revenue", statementLine: "BS.CurrentLiabilities.ContractLiabilities", cashFlowClass: "operating", taxLines: gifiBs("2960"), systemKey: "deferred_revenue" },
  { code: "2700", name: "Long-term loan", type: "liability", subtype: "long_term_debt", statementLine: "BS.NoncurrentLiabilities.Debt", cashFlowClass: "financing", taxLines: gifiBs("3140") },
  // Equity
  { code: "3000", name: "Owner's capital", type: "equity", subtype: "contributed_capital", statementLine: "BS.Equity.Contributed", cashFlowClass: "financing", taxLines: gifiBs("3500"), systemKey: "owner_capital" },
  { code: "3100", name: "Owner's drawings and dividends", type: "equity", subtype: "distributions", statementLine: "BS.Equity.Distributions", cashFlowClass: "financing", taxLines: gifiBs("3700") },
  { code: "3900", name: "Retained earnings", type: "equity", subtype: "retained_earnings", statementLine: "BS.Equity.RetainedEarnings", cashFlowClass: "none", taxLines: gifiBs("3600"), systemKey: "retained_earnings" },
  // Revenue
  { code: "4000", name: "Service revenue", type: "revenue", subtype: "operating_revenue", statementLine: "IS.Revenue", cashFlowClass: "operating", taxLines: gifi("8000"), systemKey: "service_revenue" },
  { code: "4900", name: "Interest income", type: "revenue", subtype: "other_income", statementLine: "IS.OtherIncome", cashFlowClass: "operating", taxLines: gifi("8090") },
  // Expenses
  { code: "5000", name: "Subcontracts", type: "expense", subtype: "cost_of_revenue", statementLine: "IS.CostOfRevenue", cashFlowClass: "operating", taxLines: gifi("8360") },
  { code: "6000", name: "Advertising", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: gifi("8521") },
  { code: "6100", name: "Bank charges", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: gifi("8715") },
  { code: "6200", name: "Insurance", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: gifi("8690") },
  { code: "6300", name: "Professional fees", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: gifi("8860") },
  { code: "6400", name: "Rent", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: gifi("8910") },
  { code: "6500", name: "Software and office expenses", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: gifi("8810") },
  { code: "6600", name: "Travel", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: gifi("9200") },
  { code: "6650", name: "Meals and entertainment (50% deductible)", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: gifi("8523") },
  { code: "6700", name: "Utilities and telephone", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: gifi("9220") },
  { code: "6800", name: "Amortization", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: gifi("8670") },
  { code: "7000", name: "Salaries and wages", type: "expense", subtype: "payroll_expense", statementLine: "IS.OperatingExpenses.Payroll", cashFlowClass: "operating", taxLines: gifi("9060"), systemKey: "wages_expense" },
  // CPP/QPP, EI, QPIP, health taxes and workers' compensation. The T2125 counts them with wages.
  { code: "7100", name: "Employer payroll contributions", type: "expense", subtype: "payroll_expense", statementLine: "IS.OperatingExpenses.Payroll", cashFlowClass: "operating", taxLines: { ...gifi("8622"), t2125: "GIFI.9060" }, systemKey: "employer_payroll_tax_expense" },
  { code: "7200", name: "Business taxes, licences and memberships", type: "expense", subtype: "operating_expense", statementLine: "IS.OperatingExpenses", cashFlowClass: "operating", taxLines: gifi("8760") },
  { code: "7900", name: "Interest expense", type: "expense", subtype: "other_expense", statementLine: "IS.OtherExpense", cashFlowClass: "operating", taxLines: gifi("8710") },
];
