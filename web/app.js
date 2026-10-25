// Alt-QBO web client. Plain ES modules, no build step.

const app = document.getElementById("app");
const state = { me: null, orgId: null, org: null, entity: null, cache: {} };

// ------------------------------------------------------------------ helpers

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Formats minor units (string or number of cents) as dollars. */
function usd(minor, { blankZero = false } = {}) {
  const n = BigInt(minor ?? 0);
  if (blankZero && n === 0n) return "";
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const dollars = (abs / 100n).toLocaleString("en-US");
  const cents = String(abs % 100n).padStart(2, "0");
  return `${neg ? "(" : ""}$${dollars}.${cents}${neg ? ")" : ""}`;
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 3500);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: opts.body ? { "content-type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  if (opts.raw) return res;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/api/auth")) {
    state.me = null;
    location.hash = "#/login";
    throw new Error(data.error ?? "please sign in");
  }
  if (!res.ok) throw new Error(data.error ?? `request failed (${res.status})`);
  return data;
}

const orgPath = (p = "") => `/api/orgs/${state.orgId}${p}`;
const entPath = (p = "") => orgPath(`/entities/${state.entity.entity.id}${p}`);

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_PILL = { open: "pill", soft_closed: "pill warn", locked: "pill grey", prepared: "pill warn", posted: "pill", voided: "pill grey", partial: "pill warn", overdue: "pill bad", paid: "pill grey", void: "pill grey" };
const STATUS_LABEL = { open: "Open", soft_closed: "Soft-closed", locked: "Locked", prepared: "Awaiting approval", posted: "Posted", voided: "Voided", partial: "Part paid", overdue: "Overdue", paid: "Paid", void: "Void" };
const CONTACT_LABEL = { customer: "Customer", vendor: "Vendor", both: "Customer and vendor" };
const AGING_LABEL = { current: "Not yet due", d1_30: "1 to 30 days", d31_60: "31 to 60 days", d61_90: "61 to 90 days", over_90: "Over 90 days" };
const ENTITY_TYPES = {
  llc_single: "Single-member LLC", sole_prop: "Sole proprietorship", llc_partnership: "Multi-member LLC",
  llc_s_corp: "LLC taxed as S corp", s_corp: "S corporation", c_corp: "C corporation", partnership: "Partnership",
};
const RETURN_LABEL = { sch_c: "Schedule C", f1065: "Form 1065", f1120s: "Form 1120-S", f1120: "Form 1120" };
const TAX_LABEL = {
  FIT: "Federal income tax", SS_EE: "Social Security", MEDICARE_EE: "Medicare", ADDL_MEDICARE_EE: "Additional Medicare",
  CA_PIT: "CA income tax", CA_SDI: "CA SDI", SS_ER: "Social Security (employer)", MEDICARE_ER: "Medicare (employer)",
  FUTA: "FUTA", CA_UI: "CA UI", CA_ETT: "CA ETT",
};

// ------------------------------------------------------------------ layout

function topbar() {
  const orgs = state.me?.orgs ?? [];
  return `
    <header class="topbar">
      <a class="brand" href="#/"><img src="/favicon.svg" alt="">Alt-QBO</a>
      ${orgs.length > 1 ? `<select data-action="switch-org" aria-label="Organisation">${orgs.map((o) => `<option value="${o.id}" ${o.id === state.orgId ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>` : `<span>${esc(state.org?.org?.name ?? "")}</span>`}
      <span class="spacer"></span>
      <span class="who">${esc(state.me?.user?.name)} · ${esc(state.org?.role ?? "")}</span>
      <button class="secondary" data-action="logout">Sign out</button>
    </header>
    <div class="banner">Preview build. The 2026 federal and California tax figures are drafts awaiting review, so use test data only.</div>`;
}

const ENTITY_TABS = [
  ["overview", "Overview"], ["invoices", "Invoices"], ["bills", "Bills"], ["bank", "Bank"], ["reconcile", "Reconcile"], ["contacts", "Customers and vendors"], ["journal", "Journal"], ["reports", "Reports"], ["trial-balance", "Trial balance"], ["periods", "Periods"], ["payroll", "Payroll"],
  ["accounts", "Chart of accounts"], ["connections", "Connections"],
];

function shell(active, content) {
  const e = state.entity?.entity;
  const nav = e ? `
    <div class="label">${esc(e.legalName)}</div>
    ${ENTITY_TABS.map(([k, l]) => `<a href="#/e/${e.id}/${k}" class="${active === k ? "on" : ""}">${l}</a>`).join("")}` : "";
  return `${topbar()}
    <div class="wrap shell">
      <nav class="side">
        <a href="#/" class="${active === "home" ? "on" : ""}">Businesses</a>
        <a href="#/team" class="${active === "team" ? "on" : ""}">Team</a>
        <a href="#/audit" class="${active === "audit" ? "on" : ""}">Audit log</a>
        ${nav}
      </nav>
      <main>${content}</main>
    </div>`;
}

// ------------------------------------------------------------------ auth

function authView(mode, error = "") {
  const signup = mode === "signup";
  app.innerHTML = `
    <div class="wrap auth">
      <div class="panel">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><img src="/favicon.svg" width="32" height="32" alt=""><h1>Alt-QBO</h1></div>
        <p class="muted">${signup ? "Create your account and your first organisation." : "Sign in to your books."}</p>
        ${error ? `<div class="alert bad">${esc(error)}</div>` : ""}
        <form data-form="${mode}">
          ${signup ? `<label>Your name<input name="name" required autocomplete="name"></label>` : ""}
          <label>Email<input name="email" type="email" required autocomplete="email"></label>
          <label>Password<input name="password" type="password" required minlength="${signup ? 10 : 1}" autocomplete="${signup ? "new-password" : "current-password"}"></label>
          ${signup ? `
            <label>Business or firm name<input name="orgName" required></label>
            <label>Invite code<input name="inviteCode" autocomplete="off"></label>` : ""}
          <button type="submit">${signup ? "Create account" : "Sign in"}</button>
        </form>
        <p style="margin-top:14px">${signup ? `Already have an account? <a href="#/login">Sign in</a>` : `New here? <a href="#/signup">Create an account</a>`}</p>
      </div>
    </div>`;
}

// ------------------------------------------------------------------ views

async function homeView() {
  state.entity = null;
  const ents = state.org.entities;
  const canAdd = ["owner", "admin"].includes(state.org.role);
  app.innerHTML = shell("home", `
    <div class="head"><div><h1>Businesses</h1><p class="muted">Each legal entity keeps its own books, periods and tax settings.</p></div></div>
    <div class="cards">
      ${ents.map((e) => `
        <a class="card" href="#/e/${e.id}/overview">
          <strong>${esc(e.legal_name)}</strong><br>
          <span class="muted">${esc(ENTITY_TYPES[e.entity_type] ?? e.entity_type)} · ${esc(e.region)}, US</span><br>
          <span class="pill">${esc(e.framework.replace("_", " "))}</span> <span class="pill grey">${esc(RETURN_LABEL[e.tax_return_type] ?? e.tax_return_type)}</span>
        </a>`).join("") || `<p class="muted">No businesses yet.</p>`}
    </div>
    ${canAdd ? `
    <div class="panel" style="margin-top:20px">
      <h2>Add a business</h2>
      <p class="muted">The principal place of business sets the accounting framework, currency, chart of accounts and tax rules. California is the only state live so far.</p>
      <form data-form="entity" class="grid">
        <label>Legal name<input name="legalName" required placeholder="Sunset Design Studio LLC"></label>
        <label>Entity type<select name="entityType">${Object.entries(ENTITY_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
        <label>Principal place of business<select name="region"><option value="CA">California, United States</option><option value="TX">Texas (not launched yet)</option></select></label>
        <label>First fiscal year<select name="firstFiscalYear"><option>2026</option></select></label>
        <label>EIN (optional)<input name="ein" placeholder="12-3456789"></label>
        <label>&nbsp;<button type="submit">Create business</button></label>
      </form>
    </div>` : ""}`);
}

async function loadEntity(id) {
  if (state.entity?.entity?.id !== id || !state.entity.fresh) {
    state.entity = await api(orgPath(`/entities/${id}`));
    state.entity.fresh = true;
  }
  return state.entity;
}

function accountOptions(selected = "") {
  return state.entity.accounts.filter((a) => a.is_active)
    .map((a) => `<option value="${a.code}" ${a.code === selected ? "selected" : ""}>${a.code} · ${esc(a.name)}</option>`).join("");
}

function lineRow(i, l = {}) {
  return `<tr data-line="${i}">
    <td><select name="account" aria-label="Account">${accountOptions(l.account)}</select></td>
    <td><input name="description" aria-label="Description" value="${esc(l.description ?? "")}"></td>
    <td><input name="debit" class="mono" inputmode="decimal" aria-label="Debit" placeholder="0.00" value="${esc(l.debit ?? "")}"></td>
    <td><input name="credit" class="mono" inputmode="decimal" aria-label="Credit" placeholder="0.00" value="${esc(l.credit ?? "")}"></td>
    <td><button type="button" class="link" data-action="remove-line" aria-label="Remove line">✕</button></td>
  </tr>`;
}

async function journalView(id) {
  await loadEntity(id);
  const { entries } = await api(entPath("/journal"));
  const acct = Object.fromEntries(state.entity.accounts.map((a) => [a.code, a.name]));
  app.innerHTML = shell("journal", `
    <div class="head"><div><h1>Journal</h1><p class="muted">Posted entries can't be edited. To correct one, reverse it and post a new entry.</p></div></div>
    <div class="panel">
      <h2>New entry</h2>
      <form data-form="journal">
        <div class="row" style="margin-bottom:12px">
          <label>Date<input type="date" name="date" value="${today() < "2026-01-01" ? "2026-01-01" : today() > "2026-12-31" ? "2026-12-31" : today()}" min="2026-01-01" max="2026-12-31" required></label>
          <label>Type<select name="sourceType">
            <option value="journal_voucher">Journal entry</option><option value="invoice">Invoice</option>
            <option value="bill">Bill</option><option value="payment">Payment</option><option value="opening_balance">Opening balance</option>
          </select></label>
          <label style="flex:1;min-width:220px">Memo<input name="memo" placeholder="What is this entry for?"></label>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th style="width:32%">Account</th><th>Description</th><th class="num" style="width:14%">Debit</th><th class="num" style="width:14%">Credit</th><th></th></tr></thead>
          <tbody id="lines">${lineRow(0, { account: "1100" })}${lineRow(1, { account: "4000" })}</tbody>
          <tfoot><tr><td><button type="button" class="link" data-action="add-line">+ Add line</button></td><td class="muted" id="diff"></td><td class="num" id="dr">$0.00</td><td class="num" id="cr">$0.00</td><td></td></tr></tfoot>
        </table></div>
        <div class="row" style="margin-top:12px"><button type="submit" id="post-btn" disabled>Post entry</button></div>
      </form>
    </div>
    <div class="panel">
      <h2>Posted entries</h2>
      ${entries.length ? entries.map((e) => {
        const total = e.lines.reduce((s, l) => s + BigInt(l.debitMinor), 0n);
        return `<div class="entry">
          <div class="meta">
            <strong class="mono">#${e.entryNumber}</strong><span>${e.date}</span>
            <span class="pill grey">${esc(e.sourceType.replace("_", " "))}</span>
            <span style="flex:1">${esc(e.memo)}</span>
            <span class="mono">${usd(total)}</span>
            ${e.isReversed ? `<span class="pill bad">Reversed</span>` : e.sourceType !== "reversal" ? `<button class="link" data-action="show-reverse" data-id="${e.id}">Reverse</button>` : ""}
          </div>
          <table><tbody>${e.lines.map((l) => `<tr>
            <td style="width:40%">${l.accountCode} · ${esc(acct[l.accountCode] ?? "")}</td><td class="muted">${esc(l.description)}</td>
            <td class="num">${usd(l.debitMinor, { blankZero: true })}</td><td class="num">${usd(l.creditMinor, { blankZero: true })}</td></tr>`).join("")}</tbody></table>
          <form data-form="reverse" data-id="${e.id}" class="row" hidden style="padding:8px 12px;border-top:1px solid var(--line)">
            <label>Reversal date<input type="date" name="date" value="${e.date}" required></label>
            <label style="flex:1">Reason<input name="reason" required placeholder="Why is this being reversed?"></label>
            <button type="submit">Post reversal</button>
          </form>
          <div class="hash" style="padding:4px 12px 8px">Posted by ${esc(e.postedBy)}</div>
        </div>`;
      }).join("") : `<p class="muted">Nothing posted yet.</p>`}
    </div>`);
  updateTotals();
}

function readLines() {
  return [...document.querySelectorAll("#lines tr")].map((tr) => ({
    account: tr.querySelector("[name=account]").value,
    description: tr.querySelector("[name=description]").value,
    debit: tr.querySelector("[name=debit]").value.trim(),
    credit: tr.querySelector("[name=credit]").value.trim(),
  }));
}

function cents(v) {
  if (!v) return 0n;
  if (!/^\d+(\.\d{0,2})?$/.test(v)) return null;
  const [d, c = ""] = v.split(".");
  return BigInt(d) * 100n + BigInt((c + "00").slice(0, 2));
}

function updateTotals() {
  const lines = readLines();
  let dr = 0n, cr = 0n, bad = false;
  for (const l of lines) {
    const d = cents(l.debit), c = cents(l.credit);
    if (d === null || c === null || (d > 0n && c > 0n)) bad = true;
    dr += d ?? 0n; cr += c ?? 0n;
  }
  document.getElementById("dr").textContent = usd(dr);
  document.getElementById("cr").textContent = usd(cr);
  const diff = document.getElementById("diff");
  const ok = !bad && dr > 0n && dr === cr && lines.length >= 2;
  diff.textContent = bad ? "Each line needs a debit or a credit, as an amount like 125.00." : dr === cr ? (dr > 0n ? "Balanced" : "") : `Out of balance by ${usd(dr > cr ? dr - cr : cr - dr)}`;
  diff.style.color = ok ? "var(--good-ink)" : "var(--bad-ink)";
  document.getElementById("post-btn").disabled = !ok;
}

async function trialBalanceView(id, asOf = "2026-12-31") {
  await loadEntity(id);
  const tb = await api(entPath(`/trial-balance?asOf=${asOf}`));
  const e = state.entity.entity;
  app.innerHTML = shell("trial-balance", `
    <div class="head">
      <div><h1>Trial balance</h1><p class="muted">Straight from posted lines. Tax lines map each account to ${esc(RETURN_LABEL[e.taxReturnType])}.</p></div>
      <form data-form="tb" class="row">
        <label>As of<input type="date" name="asOf" value="${asOf}"></label>
        <button type="submit" class="secondary">Update</button>
        <button type="button" data-action="tax-export" data-asof="${asOf}">Export for tax software (CSV)</button>
      </form>
    </div>
    <div class="panel table-wrap">
      <table>
        <thead><tr><th>Account</th><th>Name</th><th>Tax line</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead>
        <tbody>${tb.rows.filter((r) => r.balanceMinor !== "0").map((r) => {
          const b = BigInt(r.balanceMinor);
          return `<tr><td class="mono">${r.code}</td><td>${esc(r.name)}</td><td class="mono muted">${esc(r.taxLine ?? "unmapped")}</td>
            <td class="num">${b > 0n ? usd(b) : ""}</td><td class="num">${b < 0n ? usd(-b) : ""}</td></tr>`;
        }).join("") || `<tr><td colspan="5" class="muted">No balances yet.</td></tr>`}</tbody>
        <tfoot><tr><td colspan="3">Totals</td><td class="num">${usd(netSide(tb.rows, 1n))}</td><td class="num">${usd(netSide(tb.rows, -1n))}</td></tr></tfoot>
      </table>
    </div>`);
}

function netSide(rows, sign) {
  return rows.reduce((s, r) => {
    const b = BigInt(r.balanceMinor) * sign;
    return b > 0n ? s + b : s;
  }, 0n);
}

async function periodsView(id) {
  await loadEntity(id);
  const canClose = ["owner", "admin", "accountant"].includes(state.org.role);
  const canReopen = ["owner", "accountant"].includes(state.org.role);
  app.innerHTML = shell("periods", `
    <div class="head"><div><h1>Periods</h1><p class="muted">Soft-close a month so only accountants can post adjustments, then lock it. Reopening needs a reason and is recorded in the audit log.</p></div></div>
    <div class="panel table-wrap"><table>
      <thead><tr><th>Month</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${state.entity.periods.map((p) => {
        const month = new Date(p.start_date + "T00:00:00Z").toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
        const acts = [];
        if (canClose && p.status === "open") acts.push(`<button class="secondary" data-action="period" data-id="${p.id}" data-status="soft_closed">Soft-close</button>`);
        if (canClose && p.status !== "locked") acts.push(`<button class="secondary" data-action="period" data-id="${p.id}" data-status="locked">Lock</button>`);
        if (canReopen && p.status !== "open") acts.push(`<form class="row" data-form="reopen" data-id="${p.id}"><input name="reason" placeholder="Reason for reopening" required><button class="secondary" type="submit">Reopen</button></form>`);
        return `<tr><td>${month}</td><td><span class="${STATUS_PILL[p.status]}">${STATUS_LABEL[p.status]}</span></td><td><div class="row">${acts.join("") || `<span class="muted">No actions for your role</span>`}</div></td></tr>`;
      }).join("")}</tbody>
    </table></div>`);
}

const TYPE_LABEL = { asset: "Asset", liability: "Liability", equity: "Equity", revenue: "Income", expense: "Expense" };
const coa = { options: null, kind: "operating_expense", showInactive: false };

const taxLineChoices = (type, selected) => `<option value="">Not mapped (blocks the tax export)</option>${(coa.options.taxLines[type] ?? [])
  .map((o) => `<option value="${o.code}" ${o.code === selected ? "selected" : ""}>${o.code} · like ${esc(o.usedBy.slice(0, 2).join(", "))}${o.usedBy.length > 2 ? "…" : ""}</option>`).join("")}`;

async function accountsView(id) {
  await loadEntity(id);
  coa.options ??= {};
  if (coa.options.entityId !== id) coa.options = { entityId: id, ...(await api(entPath("/accounts/options"))) };
  const e = state.entity.entity;
  const canEdit = ["owner", "admin", "accountant"].includes(state.org.role);
  const kind = coa.options.kinds.find((k) => k.key === coa.kind) ?? coa.options.kinds[0];
  const rows = state.entity.accounts.filter((a) => coa.showInactive || a.is_active);
  const hidden = state.entity.accounts.length - rows.length;
  app.innerHTML = shell("accounts", `
    <div class="head"><div><h1>Chart of accounts</h1><p class="muted">Every account maps to a financial-statement line, a cash-flow class and a ${esc(RETURN_LABEL[e.taxReturnType])} tax line. Codes and kinds never change once created; an account can be switched off only at a zero balance.</p></div></div>
    <div class="panel table-wrap"><table>
      <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Statement line</th><th>Tax line</th><th></th></tr></thead>
      <tbody>${rows.map((a) => `<tr class="${a.is_active ? "" : "muted"}">
        <td class="mono">${a.code}</td><td>${esc(a.name)}${a.is_active ? "" : ` <span class="pill grey">Inactive</span>`}${a.system_key ? ` <span class="pill grey" title="Used by invoices, bills, payroll or the bank feed">System</span>` : ""}</td>
        <td>${TYPE_LABEL[a.type]}</td><td class="mono muted">${esc(a.statement_line)}</td><td class="mono">${esc(a.tax_line ?? "—")}</td>
        <td>${canEdit ? `<button class="link" data-action="acct-edit" data-id="${a.id}">Edit</button>` : ""}</td></tr>
        <tr data-acct-edit="${a.id}" hidden><td></td><td colspan="5">
          <form data-form="account-edit" data-id="${a.id}" class="row">
            <label>Name<input name="name" value="${esc(a.name)}" required maxlength="120"></label>
            <label>Tax line<select name="taxLine">${taxLineChoices(a.type, a.tax_line)}</select></label>
            <button type="submit">Save</button>
            ${a.system_key ? "" : `<button type="button" class="secondary" data-action="acct-active" data-id="${a.id}" data-active="${a.is_active ? "false" : "true"}">${a.is_active ? "Deactivate" : "Reactivate"}</button>`}
          </form></td></tr>`).join("")}</tbody>
    </table>
    ${hidden || coa.showInactive ? `<p style="margin-top:8px"><button class="link" data-action="acct-inactive">${coa.showInactive ? "Hide inactive accounts" : `Show ${hidden} inactive account${hidden === 1 ? "" : "s"}`}</button></p>` : ""}
    </div>
    ${canEdit ? `<div class="panel">
      <h2>Add an account</h2>
      <form data-form="account" class="row">
        <label>Kind<select name="kind" data-action="acct-kind">${["asset", "liability", "equity", "revenue", "expense"].map((t) => `<optgroup label="${TYPE_LABEL[t]}">${coa.options.kinds.filter((k) => k.type === t)
          .map((k) => `<option value="${k.key}" ${k.key === kind.key ? "selected" : ""}>${esc(k.label)}</option>`).join("")}</optgroup>`).join("")}</select></label>
        <label>Code<input name="code" class="mono" required pattern="\\d{3,6}" style="width:100px" placeholder="6550"></label>
        <label style="flex:1">Name<input name="name" required maxlength="120"></label>
        <label>Tax line<select name="taxLine">${taxLineChoices(kind.type, kind.suggestedTaxLine)}</select></label>
        <button type="submit">Add account</button>
      </form>
      <p class="hash" style="margin-top:8px">Reports it on ${esc(kind.statementLine)}. The tax line is a suggestion from the template; check it with whoever prepares the return.</p>
    </div>` : ""}`);
}

async function connectionsView(id) {
  await loadEntity(id);
  const c = state.entity.connections;
  const canAdd = ["owner", "admin"].includes(state.org.role);
  app.innerHTML = shell("connections", `
    <div class="head"><div><h1>Connections</h1><p class="muted">Banks, card issuers, payment processors, agencies and other businesses this entity deals with. Live bank feeds come with the banking module; for now this records the relationship.</p></div></div>
    <div class="panel table-wrap"><table>
      <thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Added</th></tr></thead>
      <tbody>${c.map((x) => `<tr><td>${esc(x.display_name)}</td><td>${x.kind.replace("_", " ")}</td><td><span class="pill grey">${x.status}</span></td><td>${x.created_at.slice(0, 10)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No connections yet.</td></tr>`}</tbody>
    </table></div>
    ${canAdd ? `<div class="panel"><h2>Add a connection</h2>
      <form data-form="connection" class="row">
        <label style="flex:1">Name<input name="displayName" required placeholder="First Coast Bank checking"></label>
        <label>Type<select name="kind"><option value="bank">Bank</option><option value="card_issuer">Card issuer</option><option value="processor">Payment processor</option><option value="agency">Government agency</option><option value="business">Another business</option></select></label>
        <button type="submit">Add</button>
      </form></div>` : ""}`);
}

// ------------------------------------------------ invoices, bills, contacts

/** Today, kept inside the open 2026 fiscal year. */
function bookDate() {
  const t = today();
  return t < "2026-01-01" ? "2026-01-01" : t > "2026-12-31" ? "2026-12-31" : t;
}

function plusDays(d, n) {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

const DOC = {
  invoice: { path: "invoices", title: "Invoices", one: "invoice", who: "Customer", contactKinds: ["customer", "both"], lineTypes: ["revenue", "liability"], defaultAccount: "4000",
    blurb: "Issuing an invoice posts it to receivables straight away. An issued invoice can't be edited; void it and issue a new one." },
  bill: { path: "bills", title: "Bills", one: "bill", who: "Vendor", contactKinds: ["vendor", "both"], lineTypes: ["expense", "asset"], defaultAccount: "6000",
    blurb: "Recording a bill posts it to payables. Sales tax you pay on purchases is part of the expense, so bills don't carry a tax line." },
};

function docAccountOptions(kind, selected) {
  return state.entity.accounts
    .filter((a) => a.is_active && DOC[kind].lineTypes.includes(a.type) && a.subtype !== "bank" && !["accounts_receivable", "accounts_payable"].includes(a.system_key))
    .map((a) => `<option value="${a.code}" ${a.code === selected ? "selected" : ""}>${a.code} · ${esc(a.name)}</option>`).join("");
}

function bankOptions() {
  return state.entity.accounts.filter((a) => a.is_active && a.subtype === "bank")
    .map((a) => `<option value="${a.code}">${a.code} · ${esc(a.name)}</option>`).join("");
}

function docLineRow(kind, l = {}) {
  return `<tr>
    <td><select name="account" aria-label="Account">${docAccountOptions(kind, l.account ?? DOC[kind].defaultAccount)}</select></td>
    <td><input name="description" aria-label="Description" value="${esc(l.description ?? "")}"></td>
    <td><input name="quantity" class="mono" inputmode="decimal" aria-label="Quantity" value="${esc(l.quantity ?? "1")}" style="width:80px"></td>
    <td><input name="unitPrice" class="mono" inputmode="decimal" aria-label="Price" placeholder="0.00" value="${esc(l.unitPrice ?? "")}"></td>
    ${kind === "invoice" ? `<td style="text-align:center"><input type="checkbox" name="taxable" aria-label="Taxable" ${l.taxable ? "checked" : ""}></td>` : ""}
    <td class="num" data-amount></td>
    <td><button type="button" class="link" data-action="remove-doc-line" aria-label="Remove line">✕</button></td>
  </tr>`;
}

function readDocLines() {
  return [...document.querySelectorAll("#doc-lines tr")].map((tr) => ({
    account: tr.querySelector("[name=account]").value,
    description: tr.querySelector("[name=description]").value,
    quantity: tr.querySelector("[name=quantity]").value.trim(),
    unitPrice: tr.querySelector("[name=unitPrice]").value.trim(),
    taxable: tr.querySelector("[name=taxable]")?.checked ?? false,
  }));
}

/** Rough preview of the totals; the server's figures are the ones that post. */
function updateDocTotals() {
  const form = document.querySelector("form[data-form=document]");
  if (!form) return;
  const bps = Math.round(Number(form.querySelector("[name=taxRate]")?.value || 0) * 100) || 0;
  let sub = 0n, tax = 0n, bad = false;
  document.querySelectorAll("#doc-lines tr").forEach((tr) => {
    const q = Number(tr.querySelector("[name=quantity]").value || 0);
    const p = cents(tr.querySelector("[name=unitPrice]").value.trim());
    if (p === null || !(q > 0)) { bad = true; tr.querySelector("[data-amount]").textContent = ""; return; }
    const amt = BigInt(Math.round(q * Number(p)));
    sub += amt;
    if (tr.querySelector("[name=taxable]")?.checked) tax += BigInt(Math.round(Number(amt) * bps / 10000));
    tr.querySelector("[data-amount]").textContent = usd(amt);
  });
  document.getElementById("doc-sub").textContent = usd(sub);
  const t = document.getElementById("doc-tax");
  if (t) t.textContent = usd(tax);
  document.getElementById("doc-total").textContent = usd(sub + tax);
  document.getElementById("doc-save").disabled = bad || sub + tax <= 0n;
}

async function docsView(id, kind) {
  await loadEntity(id);
  const d = DOC[kind];
  const [{ documents }, ag, { contacts }] = await Promise.all([
    api(entPath(`/${d.path}`)), api(entPath(`/${d.path}/aging`)), api(entPath("/contacts")),
  ]);
  const who = contacts.filter((c) => d.contactKinds.includes(c.kind));
  const canWrite = state.org.role !== "read_only" && state.org.role !== "approver";
  const issue = bookDate();
  app.innerHTML = shell(d.path, `
    <div class="head"><div><h1>${d.title}</h1><p class="muted">${d.blurb}</p></div></div>
    <div class="panel">
      <h2>${kind === "invoice" ? "Receivables" : "Payables"} aging</h2>
      <div class="row" style="gap:24px">
        ${Object.entries(AGING_LABEL).map(([k, l]) => `<div><div class="muted">${l}</div><div class="stat">${usd(ag.buckets[k])}</div></div>`).join("")}
        <div><div class="muted">Total still due</div><div class="stat">${usd(ag.totalMinor)}</div></div>
      </div>
    </div>
    ${canWrite ? `<div class="panel">
      <h2>New ${d.one}</h2>
      <form data-form="document" data-kind="${kind}">
        <div class="row" style="margin-bottom:12px">
          <label style="min-width:220px">${d.who}<select name="contactId" required>
            ${who.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}
            <option value="__new">+ New ${d.who.toLowerCase()}…</option>
          </select></label>
          <label data-new-contact ${who.length ? "hidden" : ""}>New ${d.who.toLowerCase()} name<input name="newContact" placeholder="${kind === "invoice" ? "Acme Corp" : "Pixel Freelance"}"></label>
          <label>Date<input type="date" name="issueDate" value="${issue}" min="2026-01-01" max="2026-12-31" required></label>
          <label>Due<input type="date" name="dueDate" value="${plusDays(issue, 30)}" required></label>
          ${kind === "invoice"
            ? `<label>Sales tax rate (%)<input name="taxRate" inputmode="decimal" placeholder="7.25" style="width:110px"></label>`
            : `<label>Vendor's invoice no.<input name="reference" style="width:150px"></label>`}
          <label style="flex:1;min-width:200px">Memo<input name="memo"></label>
        </div>
        ${kind === "invoice" ? `<p class="hash">You enter the sales tax rate for the customer's location; Alt-QBO does not look it up yet. Tick the lines it applies to.</p>` : ""}
        <div class="table-wrap"><table>
          <thead><tr><th style="width:28%">Account</th><th>Description</th><th>Qty</th><th class="num" style="width:13%">Price</th>${kind === "invoice" ? "<th>Tax</th>" : ""}<th class="num">Amount</th><th></th></tr></thead>
          <tbody id="doc-lines">${docLineRow(kind)}</tbody>
          <tfoot>
            <tr><td><button type="button" class="link" data-action="add-doc-line" data-kind="${kind}">+ Add line</button></td><td colspan="${kind === "invoice" ? 4 : 3}" class="num muted">Subtotal</td><td class="num" id="doc-sub">$0.00</td><td></td></tr>
            ${kind === "invoice" ? `<tr><td colspan="5" class="num muted">Sales tax</td><td class="num" id="doc-tax">$0.00</td><td></td></tr>` : ""}
            <tr><td colspan="${kind === "invoice" ? 5 : 4}" class="num">Total</td><td class="num" id="doc-total">$0.00</td><td></td></tr>
          </tfoot>
        </table></div>
        <div class="row" style="margin-top:12px"><button type="submit" id="doc-save" disabled>${kind === "invoice" ? "Issue invoice" : "Record bill"}</button></div>
      </form>
    </div>` : ""}
    <div class="panel">
      <h2>All ${d.title.toLowerCase()}</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>No.</th><th>${d.who}</th><th>Date</th><th>Due</th><th class="num">Total</th><th class="num">Still due</th><th>Status</th><th></th></tr></thead>
        <tbody>${documents.map((x) => `<tr>
          <td class="mono">${esc(x.number)}${x.reference ? `<div class="hash">${esc(x.reference)}</div>` : ""}</td>
          <td>${esc(x.contactName)}${x.memo ? `<div class="hash">${esc(x.memo)}</div>` : ""}</td>
          <td>${x.issueDate}</td><td>${x.dueDate}</td>
          <td class="num">${usd(x.totalMinor)}</td><td class="num">${usd(x.dueMinor, { blankZero: true })}</td>
          <td><span class="${STATUS_PILL[x.status]}">${STATUS_LABEL[x.status]}</span></td>
          <td><div class="row">
            <button class="link" data-action="doc-detail" data-id="${x.id}">Details</button>
            ${canWrite && x.status !== "void" && x.dueMinor !== "0" ? `<button class="link" data-action="doc-toggle" data-form="pay" data-id="${x.id}">${kind === "invoice" ? "Receive payment" : "Pay"}</button>` : ""}
            ${canWrite && x.status !== "void" && x.paidMinor === "0" ? `<button class="link" data-action="doc-toggle" data-form="void" data-id="${x.id}">Void</button>` : ""}
          </div></td>
        </tr>
        <tr hidden data-detail="${x.id}"><td colspan="8" id="detail-${x.id}"></td></tr>
        <tr hidden data-pay="${x.id}"><td colspan="8">
          <form data-form="pay" data-kind="${kind}" data-id="${x.id}" class="row">
            <label>Date<input type="date" name="date" value="${bookDate() < x.issueDate ? x.issueDate : bookDate()}" min="${x.issueDate}" required></label>
            <label>Amount<input name="amount" class="mono" inputmode="decimal" value="${(Number(x.dueMinor) / 100).toFixed(2)}" required style="width:130px"></label>
            <label>${kind === "invoice" ? "Deposited to" : "Paid from"}<select name="bankAccount">${bankOptions()}</select></label>
            <button type="submit">Record payment</button>
          </form></td></tr>
        <tr hidden data-void="${x.id}"><td colspan="8">
          <form data-form="void-doc" data-kind="${kind}" data-id="${x.id}" class="row">
            <label>Void date<input type="date" name="date" value="${bookDate() < x.issueDate ? x.issueDate : bookDate()}" min="${x.issueDate}" required></label>
            <label style="flex:1">Reason<input name="reason" required placeholder="Why is this being voided?"></label>
            <button type="submit">Void and post reversal</button>
          </form></td></tr>`).join("") || `<tr><td colspan="8" class="muted">No ${d.title.toLowerCase()} yet.</td></tr>`}</tbody>
      </table></div>
    </div>`);
  updateDocTotals();
}

function docDetail(x) {
  return `<div class="entry" style="margin:0">
    <table><thead><tr><th>Account</th><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th><th class="num">Tax</th></tr></thead>
    <tbody>${x.lines.map((l) => `<tr><td>${l.accountCode} · ${esc(l.accountName)}</td><td>${esc(l.description)}</td><td class="num">${esc(l.quantity)}</td>
      <td class="num">${usd(l.unitPriceMinor)}</td><td class="num">${usd(l.amountMinor)}</td><td class="num">${usd(l.taxMinor, { blankZero: true })}</td></tr>`).join("")}</tbody></table>
    <div class="hash" style="padding:6px 12px">${x.taxRateBps ? `Sales tax ${(x.taxRateBps / 100).toFixed(2)}% (entered by user) · ` : ""}Created by ${esc(x.createdBy.replace("user:", ""))}</div>
    ${x.payments.length ? `<div style="padding:0 12px 8px"><strong>Payments</strong>${x.payments.map((p) => `<div class="hash">${p.date} · ${usd(p.amountMinor)} · account ${p.bankAccountCode} · by ${esc(p.createdBy.replace("user:", ""))}</div>`).join("")}</div>` : ""}
    ${x.status === "void" ? `<div class="alert warn" style="margin:0 12px 10px">Voided ${x.voidDate}: ${esc(x.voidReason)}</div>` : ""}
  </div>`;
}

async function contactsView(id) {
  await loadEntity(id);
  const { contacts } = await api(entPath("/contacts"));
  const canWrite = state.org.role !== "read_only" && state.org.role !== "approver";
  app.innerHTML = shell("contacts", `
    <div class="head"><div><h1>Customers and vendors</h1><p class="muted">The people and businesses you invoice and pay.</p></div></div>
    <div class="panel table-wrap"><table>
      <thead><tr><th>Name</th><th>Type</th><th>Email</th></tr></thead>
      <tbody>${contacts.map((c) => `<tr><td>${esc(c.name)}</td><td>${CONTACT_LABEL[c.kind]}</td><td>${esc(c.email ?? "")}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">No customers or vendors yet.</td></tr>`}</tbody>
    </table></div>
    ${canWrite ? `<div class="panel"><h2>Add a customer or vendor</h2>
      <form data-form="contact" class="row">
        <label style="flex:1">Name<input name="name" required></label>
        <label>Type<select name="kind"><option value="customer">Customer</option><option value="vendor">Vendor</option><option value="both">Both</option></select></label>
        <label>Email (optional)<input name="email" type="email"></label>
        <button type="submit">Add</button>
      </form></div>` : ""}`);
}

// -------------------------------------------------------------------- bank

const bankUi = { account: null, status: "new" };

async function bankView(id) {
  await loadEntity(id);
  const banks = state.entity.accounts.filter((a) => a.is_active && a.subtype === "bank");
  if (!banks.some((a) => a.code === bankUi.account)) bankUi.account = banks[0]?.code ?? null;
  const q = `?account=${encodeURIComponent(bankUi.account ?? "")}&status=${bankUi.status}`;
  const [{ lines }, inv, bills] = await Promise.all([
    api(entPath(`/bank-lines${q}`)),
    bankUi.status === "new" ? api(entPath("/invoices")) : { documents: [] },
    bankUi.status === "new" ? api(entPath("/bills")) : { documents: [] },
  ]);
  const open = (docs) => docs.filter((d) => d.status !== "void" && d.dueMinor !== "0");
  const openInv = open(inv.documents), openBills = open(bills.documents);
  const cats = state.entity.accounts.filter((a) => a.is_active && a.code !== bankUi.account && !["accounts_receivable", "accounts_payable"].includes(a.system_key));
  const canWrite = state.org.role !== "read_only" && state.org.role !== "approver";
  const choice = (l) => {
    const deposit = BigInt(l.amountMinor) > 0n;
    const docs = deposit ? openInv : openBills;
    const s = l.suggestion;
    const pick = s ? (s.kind === "account" ? `acct:${s.account}` : `doc:${s.documentId}`) : "";
    return `<select data-line-choice="${l.id}" aria-label="Record as">
      <option value="">Choose…</option>
      ${docs.length ? `<optgroup label="${deposit ? "Payment of an invoice" : "Payment of a bill"}">${docs.map((d) => `<option value="doc:${d.id}" ${pick === `doc:${d.id}` ? "selected" : ""}>${esc(d.number)} · ${esc(d.contactName)} · ${usd(d.dueMinor)} due</option>`).join("")}</optgroup>` : ""}
      <optgroup label="Category">${cats.map((a) => `<option value="acct:${a.code}" ${pick === `acct:${a.code}` ? "selected" : ""}>${a.code} · ${esc(a.name)}</option>`).join("")}</optgroup>
    </select>${s ? `<div class="hash">Suggested: ${esc(s.label)}</div>` : ""}`;
  };
  const tab = (k, l) => `<button class="${bankUi.status === k ? "" : "secondary"}" data-action="bank-status" data-status="${k}">${l}</button>`;
  app.innerHTML = shell("bank", `
    <div class="head"><div><h1>Bank</h1><p class="muted">Import statements as CSV, then record each line: match it to an invoice or bill, give it a category, or exclude it. Live bank connections come later.</p></div></div>
    ${banks.length ? "" : `<div class="alert warn">This business has no active bank account in its chart of accounts.</div>`}
    <div class="panel">
      <div class="row" style="justify-content:space-between">
        <label>Bank account<select data-action="bank-account">${banks.map((a) => `<option value="${a.code}" ${a.code === bankUi.account ? "selected" : ""}>${a.code} · ${esc(a.name)}</option>`).join("")}</select></label>
        <div class="row">${tab("new", "To review")}${tab("posted", "Recorded")}${tab("excluded", "Excluded")}</div>
      </div>
    </div>
    ${canWrite && banks.length ? `<div class="panel">
      <h2>Import a statement</h2>
      <p class="muted">Download a CSV from your bank. It needs a date, a description, and either an Amount column or separate withdrawal and deposit columns. Lines already imported are skipped.</p>
      <form data-form="bank-import" class="row">
        <label>CSV file<input type="file" name="file" accept=".csv,text/csv"></label>
        <label style="flex:1;min-width:240px">or paste it here<textarea name="csv" rows="2" placeholder="Date,Description,Amount"></textarea></label>
        <button type="submit">Import</button>
      </form>
    </div>` : ""}
    <div class="panel">
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th style="width:38%">${bankUi.status === "new" ? "Record as" : bankUi.status === "posted" ? "Recorded as" : ""}</th><th></th></tr></thead>
        <tbody>${lines.map((l) => {
          const amt = BigInt(l.amountMinor);
          const amount = `<td class="num" style="color:${amt > 0n ? "var(--good-ink)" : "inherit"}">${usd(l.amountMinor)}</td>`;
          if (l.status === "new") return `<tr><td>${l.date}</td><td>${esc(l.description)}</td>${amount}
            <td>${canWrite ? choice(l) : ""}</td>
            <td>${canWrite ? `<div class="row"><button data-action="bank-record" data-id="${l.id}">Record</button><button class="link" data-action="bank-exclude" data-id="${l.id}">Exclude</button></div>` : ""}</td></tr>`;
          if (l.status === "posted") return `<tr><td>${l.date}</td><td>${esc(l.description)}</td>${amount}
            <td>${l.documentNumber ? `Payment · ${esc(l.documentNumber)}` : `${esc(l.categoryAccount)} · ${esc(state.entity.accounts.find((a) => a.code === l.categoryAccount)?.name ?? "")}`}<div class="hash">by ${esc((l.decidedBy ?? "").replace("user:", ""))}</div></td>
            <td>${canWrite && !l.documentNumber ? `<form data-form="bank-undo" data-id="${l.id}" class="row"><input name="reason" placeholder="Reason" required style="width:140px"><button class="secondary" type="submit">Undo</button></form>` : ""}</td></tr>`;
          return `<tr><td>${l.date}</td><td>${esc(l.description)}</td>${amount}<td></td>
            <td>${canWrite ? `<button class="secondary" data-action="bank-restore" data-id="${l.id}">Restore</button>` : ""}</td></tr>`;
        }).join("") || `<tr><td colspan="5" class="muted">${bankUi.status === "new" ? "Nothing to review. Import a statement to get started." : "Nothing here."}</td></tr>`}</tbody>
      </table></div>
    </div>`);
}

// ------------------------------------------------------------ overview

async function overviewView(id) {
  await loadEntity(id);
  const { checks } = await api(entPath("/health"));
  const e = state.entity.entity;
  const canSettings = ["owner", "admin"].includes(state.org.role);
  const problems = checks.filter((c) => !c.ok && !c.warn).length;
  const warnings = checks.filter((c) => !c.ok && c.warn).length;
  const summary = problems ? `<div class="alert bad">${problems} thing${problems === 1 ? " needs" : "s need"} fixing in the books.</div>`
    : warnings ? `<div class="alert warn">The books are sound. ${warnings} housekeeping item${warnings === 1 ? " is" : "s are"} worth a look.</div>`
    : `<div class="alert good">Everything checks out.</div>`;
  const einMissing = checks.some((c) => c.key === "ein" && !c.ok);
  app.innerHTML = shell("overview", `
    <div class="head"><div><h1>${esc(e.legalName)}</h1><p class="muted">Books health for today. These are bookkeeping checks, not a tax or compliance review.</p></div></div>
    ${summary}
    <div class="panel table-wrap"><table>
      <thead><tr><th></th><th>Check</th><th>Detail</th><th></th></tr></thead>
      <tbody>${checks.map((c) => `<tr>
        <td><span class="${c.ok ? "pill" : c.warn ? "pill warn" : "pill bad"}">${c.ok ? "OK" : c.warn ? "Review" : "Fix"}</span></td>
        <td>${esc(c.title)}</td><td class="muted">${esc(c.detail)}</td>
        <td>${!c.ok && c.go ? `<a href="#/e/${e.id}/${c.go}">Go there</a>` : ""}</td></tr>`).join("")}</tbody>
    </table></div>
    ${einMissing && canSettings ? `<div class="panel">
      <h2>Add the EIN</h2>
      <form data-form="ein" class="row">
        <label>EIN<input name="ein" placeholder="12-3456789" required pattern="\\d{2}-?\\d{7}" class="mono"></label>
        <button type="submit">Save</button>
      </form>
    </div>` : ""}`);
}

// ------------------------------------------------------------- reports

const REPORTS = [["pl", "Profit and loss"], ["bs", "Balance sheet"], ["gl", "General ledger"], ["ar", "Receivables aging"], ["ap", "Payables aging"]];
const rep = { tab: "pl", from: "", to: "", asOf: "", account: "" };

function reportDefaults() {
  const t = today();
  if (!rep.to) rep.to = t;
  if (!rep.asOf) rep.asOf = t;
  if (!rep.from) {
    const m = state.entity.entity.fiscalYearStartMonth ?? 1;
    const [y, mo] = t.split("-").map(Number);
    rep.from = `${mo >= m ? y : y - 1}-${String(m).padStart(2, "0")}-01`;
  }
  if (!rep.account) rep.account = state.entity.accounts.find((a) => a.subtype === "bank")?.code ?? state.entity.accounts[0]?.code ?? "";
}

function reportQuery() {
  if (rep.tab === "pl") return ["/reports/profit-and-loss", `from=${rep.from}&to=${rep.to}`, `profit-and-loss-${rep.from}-to-${rep.to}`];
  if (rep.tab === "bs") return ["/reports/balance-sheet", `asOf=${rep.asOf}`, `balance-sheet-${rep.asOf}`];
  if (rep.tab === "gl") return ["/reports/general-ledger", `account=${encodeURIComponent(rep.account)}&from=${rep.from}&to=${rep.to}`, `general-ledger-${rep.account}-${rep.from}-to-${rep.to}`];
  const kind = rep.tab === "ar" ? "receivables" : "payables";
  return [`/reports/${kind}-aging`, `asOf=${rep.asOf}`, `${kind}-aging-${rep.asOf}`];
}

const sectionRows = (s) => `
  <tr><th colspan="3">${esc(s.label)}</th></tr>
  ${s.rows.map((r) => `<tr><td class="mono">${r.code}</td><td>${esc(r.name)}</td><td class="num">${usd(r.amountMinor)}</td></tr>`).join("") || `<tr><td></td><td class="muted">None</td><td></td></tr>`}
  <tr><td></td><td><strong>Total ${esc(s.label.toLowerCase())}</strong></td><td class="num"><strong>${usd(s.totalMinor)}</strong></td></tr>`;
const totalRow = (label, minor) => `<tr><td></td><td><strong>${label}</strong></td><td class="num"><strong>${usd(minor)}</strong></td></tr>`;

async function reportsView(id) {
  await loadEntity(id);
  reportDefaults();
  const [path, q] = reportQuery();
  const range = ["pl", "gl"].includes(rep.tab);
  let body;
  if (rep.tab === "pl") {
    const pl = await api(entPath(`${path}?${q}`));
    const [rev, cor, opx, oi, oe] = pl.sections;
    body = `<table><tbody>${sectionRows(rev)}${sectionRows(cor)}${totalRow("Gross profit", pl.grossProfitMinor)}${sectionRows(opx)}
      ${totalRow("Operating income", pl.operatingIncomeMinor)}${sectionRows(oi)}${sectionRows(oe)}</tbody>
      <tfoot><tr><td></td><td>Net income</td><td class="num">${usd(pl.netIncomeMinor)}</td></tr></tfoot></table>`;
  } else if (rep.tab === "bs") {
    const bs = await api(entPath(`${path}?${q}`));
    const [ca, nca, cl, ncl, eq] = bs.sections;
    body = `${bs.balanced ? "" : `<div class="alert bad">This balance sheet doesn't balance. Check the trial balance.</div>`}
      <table><tbody>${sectionRows(ca)}${sectionRows(nca)}${totalRow("Total assets", bs.totalAssetsMinor)}
      ${sectionRows(cl)}${sectionRows(ncl)}${totalRow("Total liabilities", bs.totalLiabilitiesMinor)}
      <tr><th colspan="3">Equity</th></tr>
      ${eq.rows.map((r) => `<tr><td class="mono">${r.code}</td><td>${esc(r.name)}</td><td class="num">${usd(r.amountMinor)}</td></tr>`).join("")}
      <tr><td></td><td>Prior years' earnings</td><td class="num">${usd(bs.priorYearsEarningsMinor)}</td></tr>
      <tr><td></td><td>Current year earnings</td><td class="num">${usd(bs.currentYearEarningsMinor)}</td></tr>
      ${totalRow("Total equity", bs.totalEquityMinor)}</tbody>
      <tfoot><tr><td></td><td>Liabilities and equity</td><td class="num">${usd(BigInt(bs.totalLiabilitiesMinor) + BigInt(bs.totalEquityMinor))}</td></tr></tfoot></table>`;
  } else if (rep.tab === "gl") {
    const gl = await api(entPath(`${path}?${q}`));
    body = `<table>
      <thead><tr><th>Date</th><th>Entry</th><th>Memo</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
      <tbody><tr><td>${gl.from}</td><td></td><td class="muted">Opening balance</td><td></td><td></td><td class="num">${usd(gl.openingMinor)}</td></tr>
      ${gl.lines.map((l) => `<tr><td>${l.date}</td><td class="mono">#${l.entryNumber}</td><td>${esc(l.memo || l.description)}</td>
        <td class="num">${usd(l.debitMinor, { blankZero: true })}</td><td class="num">${usd(l.creditMinor, { blankZero: true })}</td><td class="num">${usd(l.balanceMinor)}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td colspan="5">Closing balance</td><td class="num">${usd(gl.closingMinor)}</td></tr></tfoot></table>`;
  } else {
    const ag = await api(entPath(`/${rep.tab === "ar" ? "invoices" : "bills"}/aging?asOf=${rep.asOf}`));
    body = `<div class="row" style="gap:24px;margin-bottom:12px">
        ${Object.entries(AGING_LABEL).map(([k, l]) => `<div><div class="muted">${l}</div><div class="stat">${usd(ag.buckets[k])}</div></div>`).join("")}
      </div>
      <table><thead><tr><th>Number</th><th>${rep.tab === "ar" ? "Customer" : "Vendor"}</th><th>Due</th><th>Days past due</th><th class="num">Still due</th></tr></thead>
      <tbody>${ag.rows.map((r) => `<tr><td class="mono">${esc(r.number)}</td><td>${esc(r.contactName)}</td><td>${r.dueDate}</td><td>${r.daysPastDue || ""}</td><td class="num">${usd(r.dueMinor)}</td></tr>`).join("")
        || `<tr><td colspan="5" class="muted">Nothing outstanding.</td></tr>`}</tbody>
      <tfoot><tr><td colspan="4">Total</td><td class="num">${usd(ag.totalMinor)}</td></tr></tfoot></table>`;
  }
  app.innerHTML = shell("reports", `
    <div class="head"><div><h1>Reports</h1><p class="muted">Built from posted journal lines, so they always agree with the trial balance.</p></div></div>
    <div class="row" style="margin-bottom:12px">${REPORTS.map(([k, l]) => `<button class="${rep.tab === k ? "" : "secondary"}" data-action="report-tab" data-tab="${k}">${l}</button>`).join("")}</div>
    <div class="panel">
      <form data-form="report" class="row" style="margin-bottom:12px">
        ${rep.tab === "gl" ? `<label>Account<select name="account">${accountOptions(rep.account)}</select></label>` : ""}
        ${range ? `<label>From<input type="date" name="from" value="${rep.from}" required></label><label>To<input type="date" name="to" value="${rep.to}" required></label>`
          : `<label>As of<input type="date" name="asOf" value="${rep.asOf}" required></label>`}
        <button type="submit" class="secondary">Update</button>
        <button type="button" data-action="report-csv">Download CSV</button>
      </form>
      <div class="table-wrap">${body}</div>
    </div>`);
}

// ---------------------------------------------------------- reconciliation

const recon = { account: null, statementDate: "", statementBalance: "", data: null };

async function reconcileView(id) {
  await loadEntity(id);
  const banks = state.entity.accounts.filter((a) => a.is_active && a.subtype === "bank");
  if (!banks.some((a) => a.code === recon.account)) { recon.account = banks[0]?.code ?? null; recon.data = null; }
  const q = `?account=${encodeURIComponent(recon.account ?? "")}${recon.statementDate ? `&statementDate=${recon.statementDate}` : ""}`;
  const res = recon.account ? await api(entPath(`/reconciliations${q}`)) : { history: [] };
  recon.data = recon.statementDate ? res : null;
  const canWrite = !["read_only", "approver"].includes(state.org.role);
  const last = res.history[0];
  app.innerHTML = shell("reconcile", `
    <div class="head"><div><h1>Reconcile</h1><p class="muted">Tick each item that appears on your bank statement. It completes only when the difference is zero, and reconciled items can't be cleared again.</p></div></div>
    <div class="panel">
      <form data-form="recon-start" class="row">
        <label>Bank account<select name="account">${banks.map((a) => `<option value="${a.code}" ${a.code === recon.account ? "selected" : ""}>${a.code} · ${esc(a.name)}</option>`).join("")}</select></label>
        <label>Statement ending date<input type="date" name="statementDate" value="${recon.statementDate}" required></label>
        <label>Statement ending balance<input name="statementBalance" class="mono" inputmode="decimal" value="${esc(recon.statementBalance)}" placeholder="0.00" required style="width:160px"></label>
        <button type="submit" class="secondary">Show items</button>
      </form>
      <p class="hash" style="margin-top:8px">${last ? `Last reconciled through ${last.statementDate} at ${usd(last.statementMinor)}.` : "Not reconciled yet; the first reconciliation starts from zero."}</p>
    </div>
    ${recon.data ? `<div class="panel">
      <div class="row" style="gap:24px;margin-bottom:12px">
        <div><div class="muted">Beginning balance</div><div class="stat">${usd(recon.data.beginningMinor)}</div></div>
        <div><div class="muted">Cleared</div><div class="stat" id="rc-cleared">$0.00</div></div>
        <div><div class="muted">Statement balance</div><div class="stat">${usd(statementMinor() ?? 0n)}</div></div>
        <div><div class="muted">Difference</div><div class="stat" id="rc-diff">$0.00</div></div>
      </div>
      <div class="row" style="margin-bottom:8px">
        <button class="link" data-action="rc-all">Tick all</button><button class="link" data-action="rc-none">Clear ticks</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th></th><th>Date</th><th>Entry</th><th>Memo</th><th class="num">Money in</th><th class="num">Money out</th></tr></thead>
        <tbody id="rc-items">${recon.data.items.map((i) => {
          const a = BigInt(i.amountMinor);
          return `<tr><td><input type="checkbox" data-rc="${i.lineId}" data-amount="${i.amountMinor}" aria-label="Cleared"></td><td>${i.date}</td><td class="mono">#${i.entryNumber}</td>
            <td>${esc(i.memo || i.description)}</td><td class="num">${a > 0n ? usd(a) : ""}</td><td class="num">${a < 0n ? usd(-a) : ""}</td></tr>`;
        }).join("") || `<tr><td colspan="6" class="muted">No open items on or before this date.</td></tr>`}</tbody>
      </table></div>
      ${canWrite ? `<div class="row" style="margin-top:12px"><button id="rc-finish" data-action="rc-finish" disabled>Finish reconciliation</button></div>` : ""}
    </div>` : ""}
    <div class="panel">
      <h2>Completed</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Statement date</th><th class="num">Beginning</th><th class="num">Cleared</th><th class="num">Ending</th><th>Items</th><th>By</th></tr></thead>
        <tbody>${res.history.map((r) => `<tr><td>${r.statementDate}</td><td class="num">${usd(r.beginningMinor)}</td><td class="num">${usd(r.clearedMinor)}</td>
          <td class="num">${usd(r.statementMinor)}</td><td>${r.lines}</td><td>${esc(r.completedBy.replace("user:", ""))}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">None yet.</td></tr>`}</tbody>
      </table></div>
    </div>`);
  updateRecon();
}

function statementMinor() {
  return statementMinorOf(recon.statementBalance);
}

function statementMinorOf(v) {
  const raw = String(v ?? "").trim().replace(/,/g, "");
  const neg = raw.startsWith("-");
  const c = cents(raw.replace(/^-/, ""));
  return c === null ? null : neg ? -c : c;
}

function updateRecon() {
  if (!recon.data) return;
  const ticked = [...document.querySelectorAll("[data-rc]:checked")];
  const cleared = ticked.reduce((s, x) => s + BigInt(x.dataset.amount), 0n);
  const stmt = statementMinor() ?? 0n;
  const diff = stmt - (BigInt(recon.data.beginningMinor) + cleared);
  document.getElementById("rc-cleared").textContent = usd(cleared);
  const d = document.getElementById("rc-diff");
  d.textContent = usd(diff);
  d.style.color = diff === 0n ? "var(--good-ink)" : "var(--bad-ink)";
  const btn = document.getElementById("rc-finish");
  if (btn) btn.disabled = diff !== 0n || statementMinor() === null;
}

// --------------------------------------------------------------- payroll

let employees = [];
function blankEmployee(i) {
  return { name: i === 0 ? "Maya Chen" : "", payType: "salary", payFrequency: "biweekly", salaryPerPeriod: i === 0 ? "3000.00" : "", hourlyRate: "", regularHours: "", overtimeHours: "", doubleTimeHours: "", useDaily: false, dailyHours: ["", "", "", "", "", "", ""], federalStatus: "single_or_mfs", step2Checked: false, caStatus: "single", caAllowances: "1", k401: "", section125: "", overtimeExempt: true };
}

function employeeCard(e, i) {
  const sel = (name, opts, v) => `<select data-emp="${i}" data-field="${name}">${opts.map(([k, l]) => `<option value="${k}" ${k === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const inp = (name, v, ph = "", extra = "") => `<input data-emp="${i}" data-field="${name}" value="${esc(v)}" placeholder="${ph}" ${extra}>`;
  return `<div class="emp">
    <div class="row" style="justify-content:space-between;margin-bottom:8px"><strong>Employee ${i + 1}</strong>${employees.length > 1 ? `<button class="link" data-action="remove-emp" data-i="${i}">Remove</button>` : ""}</div>
    <div class="grid">
      <label>Name${inp("name", e.name, "Full name")}</label>
      <label>Pay frequency${sel("payFrequency", [["weekly", "Weekly"], ["biweekly", "Every two weeks"], ["semimonthly", "Twice a month"], ["monthly", "Monthly"]], e.payFrequency)}</label>
      <label>Pay type${sel("payType", [["salary", "Salary"], ["hourly", "Hourly"]], e.payType)}</label>
      ${e.payType === "salary" ? `
        <label>Salary per period ($)${inp("salaryPerPeriod", e.salaryPerPeriod, "3000.00", 'inputmode="decimal"')}</label>
        <label class="check"><input type="checkbox" data-emp="${i}" data-field="overtimeExempt" ${e.overtimeExempt ? "checked" : ""}> Exempt from overtime</label>` : `
        <label>Hourly rate ($)${inp("hourlyRate", e.hourlyRate, "25.00", 'inputmode="decimal"')}</label>
        <label class="check"><input type="checkbox" data-emp="${i}" data-field="useDaily" ${e.useDaily ? "checked" : ""}> Enter daily hours (CA overtime)</label>
        ${e.useDaily ? "" : `
        <label>Regular hours${inp("regularHours", e.regularHours, "80")}</label>
        <label>Overtime hours${inp("overtimeHours", e.overtimeHours, "0")}</label>
        <label>Double-time hours${inp("doubleTimeHours", e.doubleTimeHours, "0")}</label>`}`}
      <label>Federal filing status (W-4)${sel("federalStatus", [["single_or_mfs", "Single or married filing separately"], ["mfj", "Married filing jointly"], ["hoh", "Head of household"]], e.federalStatus)}</label>
      <label class="check"><input type="checkbox" data-emp="${i}" data-field="step2Checked" ${e.step2Checked ? "checked" : ""}> W-4 Step 2 box checked</label>
      <label>California status (DE 4)${sel("caStatus", [["single", "Single or dual income married"], ["married", "Married (one income)"], ["hoh", "Head of household"]], e.caStatus)}</label>
      <label>DE 4 allowances${inp("caAllowances", e.caAllowances, "1")}</label>
      <label>401(k) per period ($)${inp("k401", e.k401, "0.00")}</label>
      <label>Section 125 per period ($)${inp("section125", e.section125, "0.00")}</label>
    </div>
    ${e.payType === "hourly" && e.useDaily ? `<h3>Hours each day of the workweek</h3><div class="row">${e.dailyHours.map((h, d) => `<label>Day ${d + 1}<input style="width:70px" data-emp="${i}" data-field="daily" data-day="${d}" value="${esc(h)}" inputmode="decimal"></label>`).join("")}</div>` : ""}
  </div>`;
}

function payrollBody() {
  return {
    periodStart: document.querySelector("[name=periodStart]").value,
    periodEnd: document.querySelector("[name=periodEnd]").value,
    payDate: document.querySelector("[name=payDate]").value,
    caUiRate: document.querySelector("[name=caUiRate]").value.trim() ? String(Number(document.querySelector("[name=caUiRate]").value) / 100) : "",
    employees: employees.map((e) => ({
      ...e,
      salaryPerPeriod: e.payType === "salary" ? e.salaryPerPeriod : "",
      hourlyRate: e.payType === "hourly" ? e.hourlyRate : "",
      overtimeExempt: e.payType === "salary" && e.overtimeExempt,
      dailyHours: e.payType === "hourly" && e.useDaily ? e.dailyHours : undefined,
    })),
  };
}

function runTable(run) {
  const taxCodes = [...new Set(run.paychecks.flatMap((p) => p.taxes.map((t) => t.code)))];
  const ee = taxCodes.filter((c) => !c.endsWith("_ER") && !["FUTA", "CA_UI", "CA_ETT"].includes(c));
  const er = taxCodes.filter((c) => !ee.includes(c));
  const amt = (p, c) => usd(p.taxes.find((t) => t.code === c)?.amountMinor ?? 0);
  const issues = run.paychecks.flatMap((p) => [...p.blockers.map((b) => ["bad", `${p.name}: ${b}`]), ...p.warnings.map((w) => ["warn", `${p.name}: ${w}`])]);
  return `
    ${issues.map(([k, m]) => `<div class="alert ${k}">${k === "bad" ? "Must fix before approval: " : ""}${esc(m)}</div>`).join("")}
    <div class="table-wrap"><table>
      <thead><tr><th>Employee</th><th class="num">Gross</th>${ee.map((c) => `<th class="num">${TAX_LABEL[c]}</th>`).join("")}<th class="num">Deductions</th><th class="num">Net pay</th></tr></thead>
      <tbody>${run.paychecks.map((p) => `<tr><td>${esc(p.name)}${p.earnings.map((e) => `<div class="hash">${e.code.toLowerCase().replace("_", " ")}${e.hours ? ` ${e.hours}h @ $${Number(e.rate).toFixed(2)}` : ""}: ${usd(e.amountMinor)}</div>`).join("")}${p.sickLeave ? `<div class="hash">sick leave +${p.sickLeave.accruedHours}h, balance ${p.sickLeave.balanceHours}h</div>` : ""}</td>
        <td class="num">${usd(p.grossMinor)}</td>${ee.map((c) => `<td class="num">${amt(p, c)}</td>`).join("")}
        <td class="num">${usd(p.deductions.reduce((s, d) => s + BigInt(d.amountMinor), 0n))}</td><td class="num"><strong>${usd(p.netPayMinor)}</strong></td></tr>`).join("")}</tbody>
    </table></div>
    <h3>Employer taxes</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Employee</th>${er.map((c) => `<th class="num">${TAX_LABEL[c]}</th>`).join("")}<th class="num">Total</th></tr></thead>
      <tbody>${run.paychecks.map((p) => `<tr><td>${esc(p.name)}</td>${er.map((c) => `<td class="num">${amt(p, c)}</td>`).join("")}<td class="num">${usd(p.employerTaxMinor)}</td></tr>`).join("")}</tbody>
    </table></div>
    <div class="row" style="margin-top:12px;gap:24px">
      <div><div class="muted">Total gross</div><div class="stat">${usd(run.totals.grossMinor)}</div></div>
      <div><div class="muted">Net pay to employees</div><div class="stat">${usd(run.totals.netPayMinor)}</div></div>
      <div><div class="muted">Employee taxes withheld</div><div class="stat">${usd(run.totals.employeeTaxMinor)}</div></div>
      <div><div class="muted">Employer taxes</div><div class="stat">${usd(run.totals.employerTaxMinor)}</div></div>
    </div>
    <p class="hash" style="margin-top:8px">Rules used: ${run.rulePacks.map(esc).join(", ")}</p>`;
}

async function payrollView(id, preview = null) {
  await loadEntity(id);
  if (!employees.length) employees = [blankEmployee(0)];
  const { payRuns } = await api(entPath("/pay-runs"));
  const me = `user:${state.me.user.email}`;
  const canApprove = ["owner", "admin", "approver"].includes(state.org.role);
  app.innerHTML = shell("payroll", `
    <div class="head"><div><h1>Payroll</h1><p class="muted">Alt-QBO calculates pay, taxes and deductions and posts them to the books. You pay employees from your own bank and file and pay taxes with the IRS and EDD yourself.</p></div></div>
    <div class="panel">
      <h2>New pay run</h2>
      <div class="row" style="margin-bottom:12px">
        <label>Period start<input type="date" name="periodStart" value="2026-06-01"></label>
        <label>Period end<input type="date" name="periodEnd" value="2026-06-14"></label>
        <label>Pay date<input type="date" name="payDate" value="2026-06-19"></label>
        <label>Your CA UI rate (%)<input name="caUiRate" placeholder="3.4 (new employer)" style="width:170px"></label>
      </div>
      <div id="emps">${employees.map(employeeCard).join("")}</div>
      <div class="row">
        <button class="secondary" data-action="add-emp">+ Add employee</button>
        <button data-action="preview-run">Calculate</button>
        <button data-action="save-run" ${preview && !preview.blockers.length ? "" : "disabled"}>Send for approval</button>
      </div>
      <div id="preview" style="margin-top:16px">${preview ? runTable(preview) : ""}</div>
    </div>
    <div class="panel">
      <h2>Pay runs</h2>
      <p class="muted">A pay run posts to the books only after someone other than its preparer approves it.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Created</th><th>Pay date</th><th>Employees</th><th class="num">Gross</th><th class="num">Net</th><th>Prepared by</th><th>Status</th><th></th></tr></thead>
        <tbody>${payRuns.map((r) => `<tr>
          <td>${r.created_at.slice(0, 10)}</td><td>${r.result.payDate}</td><td>${r.result.paychecks.length}</td>
          <td class="num">${usd(r.result.totals.grossMinor)}</td><td class="num">${usd(r.result.totals.netPayMinor)}</td>
          <td>${esc(r.prepared_by.replace("user:", ""))}</td>
          <td><span class="${STATUS_PILL[r.status]}">${STATUS_LABEL[r.status]}</span>${r.approved_by ? `<div class="hash">by ${esc(r.approved_by.replace("user:", ""))}</div>` : ""}</td>
          <td>${r.status === "prepared" && canApprove ? (r.prepared_by === me ? `<span class="muted">Needs another approver</span>` : `<button data-action="approve-run" data-id="${r.id}">Approve and post</button>`) : ""}</td>
        </tr>`).join("") || `<tr><td colspan="8" class="muted">No pay runs yet.</td></tr>`}</tbody>
      </table></div>
    </div>`);
}

// ------------------------------------------------------------- org views

const ROLE_LABEL = {
  owner: "Owner", admin: "Admin", bookkeeper: "Bookkeeper", approver: "Approver", accountant: "Accountant", read_only: "View only",
};
const ROLE_HELP = {
  admin: "manages the team and settings", bookkeeper: "posts entries, prepares payroll", approver: "approves payroll",
  accountant: "closes periods, adjustments", read_only: "sees everything, changes nothing",
};
const team = { link: null };

async function teamView() {
  const { members, invitations } = await api(orgPath("/members"));
  const mine = state.org.role;
  const canManage = ["owner", "admin"].includes(mine);
  const me = state.me.user.id;
  const manageable = (m) => m.userId !== me && (mine === "owner" || (mine === "admin" && m.role !== "owner"));
  const roleChoices = (current) => Object.entries(ROLE_LABEL).filter(([k]) => mine === "owner" || k !== "owner")
    .map(([k, l]) => `<option value="${k}" ${k === current ? "selected" : ""}>${l}</option>`).join("");
  const link = team.link;
  team.link = null;
  app.innerHTML = shell("team", `
    <div class="head"><div><h1>Team</h1><p class="muted">Roles control who can post, close periods and approve payroll. Payroll needs at least two people: one prepares, another approves.</p></div></div>
    ${link ? `<div class="alert good">Invitation ready. Send this link to ${esc(link.email)}; it works once, for that email, for 14 days.
      <div class="row" style="margin-top:8px"><input id="invite-link" class="mono" readonly value="${esc(link.link)}" style="flex:1;min-width:260px"><button class="secondary" data-action="copy-invite">Copy link</button></div></div>` : ""}
    <div class="panel table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th></th></tr></thead>
      <tbody>${members.map((m) => `<tr><td>${esc(m.name)}${m.userId === me ? ` <span class="muted">(you)</span>` : ""}</td><td>${esc(m.email)}</td>
        <td>${canManage && manageable(m) ? `<select data-action="member-role" data-id="${m.userId}" aria-label="Role for ${esc(m.name)}">${roleChoices(m.role)}</select>` : ROLE_LABEL[m.role]}</td>
        <td>${m.createdAt.slice(0, 10)}</td>
        <td>${canManage && manageable(m) ? `<button class="link" data-action="member-remove" data-id="${m.userId}" data-name="${esc(m.name)}">Remove</button>`
          : m.userId === me ? `<button class="link" data-action="leave-org">Leave</button>` : ""}</td></tr>`).join("")}</tbody>
    </table></div>
    ${canManage ? `<div class="panel">
      <h2>Invite someone</h2>
      <p class="muted">They join by signing up, or signing in, with this email through the link you send them. You never set a password for anyone.</p>
      <form data-form="invite" class="row">
        <label>Email<input name="email" type="email" required style="width:260px"></label>
        <label>Role<select name="role">${Object.entries(ROLE_HELP).filter(([k]) => mine === "owner" || k !== "owner")
          .map(([k, h]) => `<option value="${k}" ${k === "bookkeeper" ? "selected" : ""}>${ROLE_LABEL[k]} (${h})</option>`).join("")}</select></label>
        <button type="submit">Create invitation</button>
      </form>
      ${invitations.length ? `<h2 style="margin-top:16px">Pending invitations</h2><div class="table-wrap"><table>
        <thead><tr><th>Email</th><th>Role</th><th>Sent</th><th>Expires</th><th></th></tr></thead>
        <tbody>${invitations.map((i) => `<tr><td>${esc(i.email)}</td><td>${ROLE_LABEL[i.role]}</td><td>${i.createdAt.slice(0, 10)}</td><td>${i.expiresAt.slice(0, 10)}</td>
          <td><button class="link" data-action="invite-revoke" data-id="${i.id}">Revoke</button></td></tr>`).join("")}</tbody>
      </table></div>` : ""}
    </div>` : ""}`);
}

/** The page an invitation link opens. */
async function joinView(token, error = "") {
  let inv;
  try { inv = await api(`/api/invitations/${token}`); } catch (err) { inv = null; error = error || err.message; }
  let me = state.me;
  if (!me) {
    // Not api(): a 401 here just means "not signed in yet", not a redirect to the login page.
    const res = await api("/api/me", { raw: true });
    me = state.me = res.ok ? await res.json() : null;
  }
  const pending = inv?.status === "pending";
  const signedInAs = me?.user?.email;
  let body;
  if (!inv) body = `<p>Ask whoever invited you for a new link.</p>`;
  else if (!pending) body = `<p>This invitation has ${inv.status === "accepted" ? "already been used" : inv.status === "expired" ? "expired" : "been withdrawn"}. ${inv.status === "accepted" ? `<a href="#/">Go to your books</a>` : "Ask for a new link."}</p>`;
  else if (signedInAs === inv.email) body = `<button data-action="accept-invite" data-token="${esc(token)}">Join ${esc(inv.orgName)}</button>`;
  else if (signedInAs) body = `<p>You're signed in as ${esc(signedInAs)}, but this invitation is for ${esc(inv.email)}.</p><button class="secondary" data-action="logout-join">Sign out and continue</button>`;
  else body = `
    <h2>New to Alt-QBO</h2>
    <form data-form="join-signup" data-token="${esc(token)}">
      <label>Your name<input name="name" required autocomplete="name"></label>
      <label>Email<input name="email" value="${esc(inv.email)}" readonly></label>
      <label>Choose a password<input name="password" type="password" minlength="10" required autocomplete="new-password"></label>
      <button type="submit">Create account and join</button>
    </form>
    <h2 style="margin-top:18px">Already have an account</h2>
    <form data-form="join-login" data-token="${esc(token)}">
      <input type="hidden" name="email" value="${esc(inv.email)}">
      <label>Password for ${esc(inv.email)}<input name="password" type="password" required autocomplete="current-password"></label>
      <button type="submit" class="secondary">Sign in and join</button>
    </form>`;
  app.innerHTML = `
    <div class="wrap auth">
      <div class="panel">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><img src="/favicon.svg" width="32" height="32" alt=""><h1>Alt-QBO</h1></div>
        ${inv ? `<p>You're invited to join <strong>${esc(inv.orgName)}</strong> as ${esc(ROLE_LABEL[inv.role] ?? inv.role)}.</p>` : ""}
        ${error ? `<div class="alert bad">${esc(error)}</div>` : ""}
        ${body}
      </div>
    </div>`;
}

async function joined(orgId) {
  state.me = null; state.org = null;
  if (orgId) { state.orgId = orgId; try { localStorage.setItem("altqbo_org", orgId); } catch {} }
  location.hash = "#/";
  await route();
  toast("You've joined the team");
}

async function auditView() {
  const { events, verification } = await api(orgPath("/audit"));
  app.innerHTML = shell("audit", `
    <div class="head"><div><h1>Audit log</h1><p class="muted">Every change, in order. Each event is chained to the one before it with a SHA-256 hash, so any edit or deletion breaks the chain.</p></div></div>
    ${verification.ok
      ? `<div class="alert good">Chain verified: all ${verification.events} events are intact.</div>`
      : `<div class="alert bad">Chain broken at event ${verification.brokenAt}: ${esc(verification.reason)}</div>`}
    <div class="panel table-wrap"><table>
      <thead><tr><th>#</th><th>When</th><th>Who</th><th>What</th><th>Hash</th></tr></thead>
      <tbody>${events.map((e) => `<tr><td class="mono">${e.seq}</td><td>${new Date(e.occurred_at).toLocaleString()}</td><td>${esc(e.actor.replace("user:", ""))}</td>
        <td>${esc(e.action)}${e.context?.reason ? `<div class="hash">reason: ${esc(e.context.reason)}</div>` : ""}</td><td class="hash">${e.hash.slice(0, 16)}…</td></tr>`).join("")}</tbody>
    </table></div>`);
}

// ------------------------------------------------------------------ router

async function route() {
  const hash = location.hash || "#/";
  const parts = hash.slice(2).split("/");
  try {
    if (parts[0] === "login" || parts[0] === "signup") return authView(parts[0]);
    if (parts[0] === "join" && parts[1]) return await joinView(parts[1]);
    if (!state.me) {
      try { state.me = await api("/api/me"); } catch { return authView("login"); }
    }
    if (!state.me.orgs.length) return authView("login", "Your account isn't part of any organisation yet.");
    if (!state.orgId || !state.me.orgs.some((o) => o.id === state.orgId)) {
      let saved = null;
      try { saved = localStorage.getItem("altqbo_org"); } catch {}
      state.orgId = state.me.orgs.some((o) => o.id === saved) ? saved : state.me.orgs[0].id;
    }
    if (!state.org || state.org.org.id !== state.orgId || state.org.stale) state.org = await api(orgPath());
    if (parts[0] === "e" && parts[1]) {
      const view = { overview: overviewView, reports: reportsView, invoices: (i) => docsView(i, "invoice"), bills: (i) => docsView(i, "bill"), contacts: contactsView, bank: bankView, reconcile: reconcileView, journal: journalView, "trial-balance": trialBalanceView, periods: periodsView, payroll: payrollView, accounts: accountsView, connections: connectionsView }[parts[2] ?? "overview"] ?? overviewView;
      return await view(parts[1]);
    }
    if (parts[0] === "team") return await teamView();
    if (parts[0] === "audit") return await auditView();
    return await homeView();
  } catch (err) {
    app.innerHTML = shell("", `<div class="alert bad">${esc(err.message)}</div><p><a href="#/">Back to businesses</a></p>`);
  }
}

window.addEventListener("hashchange", route);

// ------------------------------------------------------------------ events

document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.closest("#lines")) updateTotals();
  if (t.closest("form[data-form=document]")) updateDocTotals();
  if (t.dataset.rc !== undefined) updateRecon();
  if (t.dataset.emp !== undefined) {
    const e = employees[Number(t.dataset.emp)];
    if (t.dataset.field === "daily") e.dailyHours[Number(t.dataset.day)] = t.value;
    else if (t.type === "checkbox") e[t.dataset.field] = t.checked;
    else e[t.dataset.field] = t.value;
    if (["payType", "useDaily"].includes(t.dataset.field)) document.getElementById("emps").innerHTML = employees.map(employeeCard).join("");
    const save = document.querySelector("[data-action=save-run]");
    if (save) save.disabled = true;
  }
});
document.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.name === "contactId" && t.closest("form[data-form=document]")) {
    const box = t.form.querySelector("[data-new-contact]");
    box.hidden = t.value !== "__new";
    if (!box.hidden) box.querySelector("input").focus();
  }
  if (t.dataset.action === "bank-account") {
    bankUi.account = t.value;
    bankView(state.entity.entity.id).catch((err) => toast(err.message));
  }
  if (t.dataset.action === "acct-kind") {
    coa.kind = t.value;
    const field = (form, n) => form.elements.namedItem(n);
    const keep = { code: field(t.form, "code").value, name: field(t.form, "name").value };
    accountsView(state.entity.entity.id).then(() => {
      const nf = document.querySelector("form[data-form=account]");
      field(nf, "code").value = keep.code; field(nf, "name").value = keep.name;
    }).catch((err) => toast(err.message));
  }
  if (t.dataset.action === "member-role") {
    api(orgPath(`/members/${t.dataset.id}/role`), { body: { role: t.value } })
      .then(() => toast(`Role changed to ${ROLE_LABEL[t.value]}`))
      .catch((err) => toast(err.message))
      .finally(() => teamView());
  }
  if (t.dataset.action === "switch-org") {
    state.orgId = t.value;
    try { localStorage.setItem("altqbo_org", t.value); } catch {}
    state.org = null;
    location.hash = "#/";
    route();
  }
});

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-action]");
  if (!b || b.tagName === "SELECT") return;
  const a = b.dataset.action;
  try {
    if (a === "logout") {
      await api("/api/auth/logout", { body: {} });
      state.me = null; state.org = null; state.orgId = null;
      location.hash = "#/login";
    } else if (a === "add-line") {
      const tbody = document.getElementById("lines");
      tbody.insertAdjacentHTML("beforeend", lineRow(tbody.children.length));
      updateTotals();
    } else if (a === "remove-line") {
      if (document.querySelectorAll("#lines tr").length > 2) b.closest("tr").remove();
      updateTotals();
    } else if (a === "add-doc-line") {
      document.getElementById("doc-lines").insertAdjacentHTML("beforeend", docLineRow(b.dataset.kind));
      updateDocTotals();
    } else if (a === "remove-doc-line") {
      if (document.querySelectorAll("#doc-lines tr").length > 1) b.closest("tr").remove();
      updateDocTotals();
    } else if (a === "doc-toggle") {
      const row = document.querySelector(`tr[data-${b.dataset.form}="${b.dataset.id}"]`);
      row.hidden = !row.hidden;
    } else if (a === "doc-detail") {
      const row = document.querySelector(`tr[data-detail="${b.dataset.id}"]`);
      row.hidden = !row.hidden;
      if (!row.hidden) {
        const kind = location.hash.includes("/bills") ? "bills" : "invoices";
        document.getElementById(`detail-${b.dataset.id}`).innerHTML = docDetail(await api(entPath(`/${kind}/${b.dataset.id}`)));
      }
    } else if (a === "acct-edit") {
      const row = document.querySelector(`tr[data-acct-edit="${b.dataset.id}"]`);
      row.hidden = !row.hidden;
    } else if (a === "acct-inactive") {
      coa.showInactive = !coa.showInactive;
      await accountsView(state.entity.entity.id);
    } else if (a === "acct-active") {
      b.disabled = true;
      await api(entPath(`/accounts/${b.dataset.id}`), { body: { active: b.dataset.active === "true" } });
      state.entity.fresh = false;
      toast(b.dataset.active === "true" ? "Account reactivated" : "Account deactivated");
      await accountsView(state.entity.entity.id);
    } else if (a === "copy-invite") {
      const input = document.getElementById("invite-link");
      await navigator.clipboard.writeText(input.value).catch(() => { input.select(); document.execCommand("copy"); });
      toast("Link copied");
    } else if (a === "invite-revoke") {
      b.disabled = true;
      await api(orgPath(`/invitations/${b.dataset.id}/revoke`), { body: {} });
      toast("Invitation revoked; the link no longer works");
      await teamView();
    } else if (a === "member-remove") {
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = `Remove ${b.dataset.name}? Click again`; return; }
      b.disabled = true;
      await api(orgPath(`/members/${b.dataset.id}/remove`), { body: {} });
      toast(`${b.dataset.name} removed`);
      await teamView();
    } else if (a === "leave-org") {
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Leave this organisation? Click again"; return; }
      b.disabled = true;
      await api(orgPath("/leave"), { body: {} });
      state.me = null; state.org = null; state.orgId = null;
      location.hash = "#/";
      await route();
    } else if (a === "accept-invite") {
      b.disabled = true;
      const r = await api(`/api/invitations/${b.dataset.token}/accept`, { body: {} });
      await joined(r.orgId);
    } else if (a === "logout-join") {
      await api("/api/auth/logout", { body: {} });
      state.me = null; state.org = null; state.orgId = null;
      await route();
    } else if (a === "report-tab") {
      rep.tab = b.dataset.tab;
      await reportsView(state.entity.entity.id);
    } else if (a === "report-csv") {
      const [path, q, name] = reportQuery();
      const res = await api(entPath(`${path}?${q}&format=csv`), { raw: true });
      if (!res.ok) throw new Error((await res.json()).error);
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement("a"), { href: url, download: `${name}.csv` }).click();
      URL.revokeObjectURL(url);
    } else if (a === "rc-all" || a === "rc-none") {
      document.querySelectorAll("[data-rc]").forEach((x) => { x.checked = a === "rc-all"; });
      updateRecon();
    } else if (a === "rc-finish") {
      b.disabled = true;
      const ids = [...document.querySelectorAll("[data-rc]:checked")].map((x) => x.dataset.rc);
      await api(entPath("/reconciliations"), { body: { bankAccount: recon.account, statementDate: recon.statementDate, statementBalance: recon.statementBalance.trim(), clearedLineIds: ids } });
      toast(`Reconciled through ${recon.statementDate}`);
      recon.statementDate = ""; recon.statementBalance = "";
      await reconcileView(state.entity.entity.id);
    } else if (a === "bank-status") {
      bankUi.status = b.dataset.status;
      await bankView(state.entity.entity.id);
    } else if (a === "bank-record") {
      const v = document.querySelector(`[data-line-choice="${b.dataset.id}"]`).value;
      if (!v) throw new Error("Choose what this line is first");
      b.disabled = true;
      const [k, ref] = [v.slice(0, v.indexOf(":")), v.slice(v.indexOf(":") + 1)];
      await api(entPath(`/bank-lines/${b.dataset.id}/${k === "doc" ? "match" : "categorize"}`), { body: k === "doc" ? { documentId: ref } : { account: ref } });
      toast("Recorded and posted");
      await bankView(state.entity.entity.id);
    } else if (a === "bank-exclude" || a === "bank-restore") {
      b.disabled = true;
      await api(entPath(`/bank-lines/${b.dataset.id}/${a === "bank-exclude" ? "exclude" : "restore"}`), { method: "POST" });
      toast(a === "bank-exclude" ? "Excluded. It won't post to the books." : "Restored to the review list");
      await bankView(state.entity.entity.id);
    } else if (a === "show-reverse") {
      const f = document.querySelector(`form[data-form=reverse][data-id="${b.dataset.id}"]`);
      f.hidden = !f.hidden;
    } else if (a === "period") {
      b.disabled = true;
      await api(entPath(`/periods/${b.dataset.id}`), { body: { status: b.dataset.status } });
      state.entity.fresh = false;
      toast("Period updated");
      await periodsView(state.entity.entity.id);
    } else if (a === "tax-export") {
      const res = await api(entPath(`/tax-export?asOf=${b.dataset.asof}`), { raw: true });
      if (!res.ok) throw new Error((await res.json()).error);
      const url = URL.createObjectURL(await res.blob());
      const link = Object.assign(document.createElement("a"), { href: url, download: `trial-balance-tax-lines-${b.dataset.asof}.csv` });
      link.click();
      URL.revokeObjectURL(url);
    } else if (a === "add-emp") {
      employees.push(blankEmployee(employees.length));
      document.getElementById("emps").innerHTML = employees.map(employeeCard).join("");
    } else if (a === "remove-emp") {
      employees.splice(Number(b.dataset.i), 1);
      document.getElementById("emps").innerHTML = employees.map(employeeCard).join("");
    } else if (a === "preview-run") {
      b.disabled = true;
      const run = await api(entPath("/pay-runs/preview"), { body: payrollBody() });
      document.getElementById("preview").innerHTML = runTable(run);
      document.querySelector("[data-action=save-run]").disabled = run.blockers.length > 0;
      b.disabled = false;
    } else if (a === "save-run") {
      b.disabled = true;
      await api(entPath("/pay-runs"), { body: payrollBody() });
      toast("Pay run sent for approval");
      await payrollView(state.entity.entity.id);
    } else if (a === "approve-run") {
      b.disabled = true;
      await api(entPath(`/pay-runs/${b.dataset.id}/approve`), { body: {} });
      toast("Pay run approved and posted to the journal");
      await payrollView(state.entity.entity.id);
    }
  } catch (err) {
    toast(err.message);
    if (b.tagName === "BUTTON") b.disabled = false;
  }
});

document.addEventListener("submit", async (ev) => {
  const f = ev.target;
  const kind = f.dataset.form;
  if (!kind) return;
  ev.preventDefault();
  const btn = f.querySelector("button[type=submit]");
  if (btn) btn.disabled = true;
  try {
    const d = formData(f);
    if (kind === "login" || kind === "signup") {
      try {
        await api(`/api/auth/${kind}`, { body: d });
      } catch (err) {
        return authView(kind, err.message);
      }
      state.me = null; state.org = null; state.orgId = null;
      location.hash = "#/";
      await route();
    } else if (kind === "entity") {
      const e = await api(orgPath("/entities"), { body: { ...d, country: "US" } });
      state.org.stale = true;
      toast(`${e.legalName} created with ${RETURN_LABEL[e.taxReturnType]} tax lines`);
      location.hash = `#/e/${e.id}/overview`;
    } else if (kind === "journal") {
      const lines = readLines().filter((l) => l.debit || l.credit);
      const e = await api(entPath("/journal"), { body: { ...d, lines, idempotencyKey: crypto.randomUUID() } });
      toast(`Entry #${e.entryNumber} posted`);
      await journalView(state.entity.entity.id);
    } else if (kind === "reverse") {
      const e = await api(entPath(`/journal/${f.dataset.id}/reverse`), { body: d });
      toast(`Reversal #${e.entryNumber} posted`);
      await journalView(state.entity.entity.id);
    } else if (kind === "report") {
      Object.assign(rep, d);
      await reportsView(state.entity.entity.id);
    } else if (kind === "ein") {
      await api(entPath("/settings"), { body: { ein: d.ein } });
      toast("EIN saved");
      await overviewView(state.entity.entity.id);
    } else if (kind === "tb") {
      await trialBalanceView(state.entity.entity.id, d.asOf);
    } else if (kind === "reopen") {
      await api(entPath(`/periods/${f.dataset.id}`), { body: { status: "open", reason: d.reason } });
      state.entity.fresh = false;
      toast("Period reopened; the reason is in the audit log");
      await periodsView(state.entity.entity.id);
    } else if (kind === "connection") {
      await api(entPath("/connections"), { body: d });
      state.entity.fresh = false;
      toast("Connection added");
      await connectionsView(state.entity.entity.id);
    } else if (kind === "document") {
      const k = f.dataset.kind;
      let contactId = d.contactId;
      if (contactId === "__new" || !contactId) {
        if (!d.newContact?.trim()) throw new Error(`Enter the new ${DOC[k].who.toLowerCase()}'s name`);
        contactId = (await api(entPath("/contacts"), { body: { kind: k === "invoice" ? "customer" : "vendor", name: d.newContact } })).id;
      }
      const lines = readDocLines().filter((l) => l.unitPrice);
      const doc = await api(entPath(`/${DOC[k].path}`), { body: { ...d, contactId, lines, idempotencyKey: crypto.randomUUID() } });
      toast(`${doc.number} ${k === "invoice" ? "issued" : "recorded"} for ${usd(doc.totalMinor)}`);
      await docsView(state.entity.entity.id, k);
    } else if (kind === "pay") {
      const k = f.dataset.kind;
      await api(entPath(`/${DOC[k].path}/${f.dataset.id}/payments`), { body: { ...d, idempotencyKey: crypto.randomUUID() } });
      toast("Payment recorded and posted");
      await docsView(state.entity.entity.id, k);
    } else if (kind === "void-doc") {
      const k = f.dataset.kind;
      const doc = await api(entPath(`/${DOC[k].path}/${f.dataset.id}/void`), { body: d });
      toast(`${doc.number} voided; the reversal is in the journal`);
      await docsView(state.entity.entity.id, k);
    } else if (kind === "recon-start") {
      if (statementMinorOf(d.statementBalance) === null) throw new Error("Enter the statement balance as an amount like 12345.67");
      Object.assign(recon, { account: d.account, statementDate: d.statementDate, statementBalance: d.statementBalance });
      await reconcileView(state.entity.entity.id);
    } else if (kind === "bank-import") {
      const file = f.querySelector("[name=file]").files[0];
      const csv = file ? await file.text() : d.csv;
      if (!csv?.trim()) throw new Error("Choose a CSV file or paste one");
      const r = await api(entPath("/bank-imports"), { body: { bankAccount: bankUi.account, csv, fileName: file?.name ?? "pasted" } });
      toast(`Imported ${r.added} line${r.added === 1 ? "" : "s"}${r.duplicates ? `, skipped ${r.duplicates} already imported` : ""}${r.unreadableRows.length ? `. Couldn't read rows ${r.unreadableRows.join(", ")}` : ""}`);
      bankUi.status = "new";
      await bankView(state.entity.entity.id);
    } else if (kind === "bank-undo") {
      await api(entPath(`/bank-lines/${f.dataset.id}/undo`), { body: { date: bookDate(), reason: d.reason } });
      toast("Undone; the reversal is in the journal");
      await bankView(state.entity.entity.id);
    } else if (kind === "contact") {
      await api(entPath("/contacts"), { body: d });
      toast(`${d.name} added`);
      await contactsView(state.entity.entity.id);
    } else if (kind === "account") {
      const r = await api(entPath("/accounts"), { body: { ...d, taxLine: d.taxLine || null } });
      state.entity.fresh = false;
      toast(`Account ${r.code} added`);
      await accountsView(state.entity.entity.id);
    } else if (kind === "account-edit") {
      await api(entPath(`/accounts/${f.dataset.id}`), { body: { name: d.name, taxLine: d.taxLine || null } });
      state.entity.fresh = false;
      toast("Account saved");
      await accountsView(state.entity.entity.id);
    } else if (kind === "invite") {
      team.link = await api(orgPath("/invitations"), { body: d });
      await teamView();
    } else if (kind === "join-signup" || kind === "join-login") {
      const token = f.dataset.token;
      let r;
      try {
        r = await api(`/api/auth/${kind === "join-signup" ? "signup" : "login"}`, { body: { ...d, inviteToken: token } });
      } catch (err) {
        return joinView(token, err.message);
      }
      await joined(r.joined);
    }
  } catch (err) {
    toast(err.message);
  } finally {
    if (btn && document.contains(btn)) btn.disabled = false;
  }
});

route();
