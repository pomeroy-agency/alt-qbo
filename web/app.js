// TrailBook web client. Plain ES modules, no build step.

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

/** Today's date where the user is (not UTC, which is already tomorrow on a California evening). */
function today() {
  return new Date().toLocaleDateString("en-CA");
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

/** A tax code's name: federal and California ones above, the business's state's from the server, else the code. */
function taxLabel(code, labels) {
  return TAX_LABEL[code] ?? labels?.[code] ?? pay.state?.taxLabels?.[code] ?? code.replace(/_/g, " ");
}

// ------------------------------------------------------------------ layout

// Light, dark, or follow the device. Kept per browser; the page works without it.
const THEMES = ["auto", "dark", "light"];
function theme() {
  try { return THEMES.includes(localStorage.getItem("altqbo_theme")) ? localStorage.getItem("altqbo_theme") : "auto"; } catch { return "auto"; }
}
function applyTheme(t = theme()) {
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
applyTheme();

function topbar() {
  const orgs = state.me?.orgs ?? [];
  const t = theme();
  return `
    <header class="topbar">
      <a class="brand" href="#/"><img src="/favicon.svg" alt=""><span>TrailBook</span></a>
      ${orgs.length > 1 ? `<select data-action="switch-org" aria-label="Organisation">${orgs.map((o) => `<option value="${o.id}" ${o.id === state.orgId ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>` : `<span>${esc(state.org?.org?.name ?? "")}</span>`}
      <span class="spacer"></span>
      <a class="who" href="#/account" title="Your account and sign-in security">${esc(state.me?.user?.name)} · ${esc(state.org?.role ?? "")}</a>
      <button class="link" data-action="theme" title="Switch between light, dark and your device's setting">${{ auto: "Theme: device", dark: "Theme: dark", light: "Theme: light" }[t]}</button>
      <button class="secondary" data-action="logout">Sign out</button>
    </header>
    ${state.org?.access?.level === "read_only" ? `<div class="banner bad">Changes are paused: ${esc(state.org.access.reason)}. ${["owner", "admin"].includes(state.org.role) ? `<a href="#/billing">Go to Billing</a>` : "Ask an owner to check Billing."}</div>`
      : state.org?.access?.warning ? `<div class="banner info">${esc(state.org.access.warning)} ${["owner", "admin"].includes(state.org.role) ? `<a href="#/billing">Go to Billing</a>` : ""}</div>` : ""}
    ${termsBanner()}
    ${state.me?.emailEnabled && state.me.user && !state.me.user.emailVerified ? `<div class="banner info">Please confirm your email: we sent a link to ${esc(state.me.user.email)}. <button class="link" data-action="resend-verify">Send it again</button></div>` : ""}`;
}

// The everyday menu stays short. Bookkeeping mechanics live under "Accountant tools".
const ENTITY_TABS = [
  ["overview", "Overview"], ["invoices", "Invoices", "overdueInvoices", "overdue"], ["bills", "Bills", "billsDueSoon", "due within a week"],
  ["bank", "Bank", "bankToReview", "to review"], ["contacts", "Customers and vendors"], ["items", "Products and services"], ["reports", "Reports"], ["payroll", "Payroll", "payrollToDo", "to approve or pay"],
];
const ACCOUNTANT_TABS = [
  ["reconcile", "Reconcile"], ["sales-tax", "Sales tax"], ["journal", "Journal"], ["trial-balance", "Trial balance"], ["periods", "Close the books"], ["accounts", "Chart of accounts"], ["connections", "Connections"], ["integrations", "Integrations"],
];

/** The everyday menu, plus a tab for each linked app (MilePost) while the link is live. */
function entityTabs() {
  return state.entity?.apps?.milepost ? [...ENTITY_TABS, ["milepost", "MilePost"]] : ENTITY_TABS;
}

// Shorter names for the phone menu, where buttons sit three to a row.
const SHORT = { contacts: "Contacts", items: "Products", "trial-balance": "Trial bal.", periods: "Close books", accounts: "Accounts" };

// When the terms of service change, an owner or admin accepts the new version for the business.
function termsBanner() {
  const o = state.me?.orgs?.find((x) => x.id === state.orgId);
  if (!o || o.termsAccepted) return "";
  return ["owner", "admin"].includes(o.role)
    ? `<div class="banner info">Our <a href="/terms.html" target="_blank" rel="noopener">Terms of Service</a> have been updated (version ${esc(state.me.termsVersion)}). Please read them and accept them for ${esc(o.name)}. <button class="link" data-action="accept-terms" data-org="${o.id}" data-version="${esc(state.me.termsVersion)}">I accept for ${esc(o.name)}</button></div>`
    : "";
}

function shell(active, content) {
  const e = state.entity?.entity;
  const attn = state.entity?.attention ?? {};
  const count = (c) => (c ? attn[c] : 0);
  const link = ([k, l, c, what]) => {
    const n = count(c);
    return `<a href="#/e/${e.id}/${k}" class="${active === k ? "on" : ""}">${l}${n ? ` <span class="badge" title="${n} ${what}">${n}</span>` : ""}</a>`;
  };
  const nav = e ? `
    <div class="label">${esc(e.legalName)}</div>
    ${entityTabs().map(link).join("")}
    <div class="label">Accountant tools</div>
    ${ACCOUNTANT_TABS.map(link).join("")}` : "";
  // On a phone the everyday pages are a grid of buttons; everything else sits under More.
  const btn = (href, k, l, n = 0, what = "") =>
    `<a href="${href}" class="${active === k ? "on" : ""}">${esc(l)}${n ? `<span class="badge" title="${n} ${what}">${n}</span>` : ""}</a>`;
  const tab = ([k, l, c, what]) => btn(`#/e/${e.id}/${k}`, k, SHORT[k] ?? l, count(c), what);
  const billing = ["owner", "admin"].includes(state.org?.role) ? [["billing", "#/billing", "Billing"]] : [];
  const org = [["home", "#/", "Businesses"], ["team", "#/team", "Team"], ["audit", "#/audit", "Audit log"], ...billing, ["account", "#/account", "Your account"]];
  const main = e ? entityTabs().map(tab) : org.map(([k, h, l]) => btn(h, k, l));
  const more = [
    ...(e ? [btn("#/", "home", "Businesses"), ...ACCOUNTANT_TABS.map(tab)] : []),
    ...(e ? org.slice(1).map(([k, h, l]) => btn(h, k, l)) : []),
  ];
  const moreOn = e && (["home", "team", "audit", "billing", "account"].includes(active) || ACCOUNTANT_TABS.some(([k]) => k === active));
  const mobile = `
      <nav class="mobile">
        <div class="tiles">${main.join("")}${more.length ? `<button type="button" class="more${moreOn ? " on" : ""}" data-action="nav-more" aria-expanded="false">More</button>` : ""}</div>
        ${more.length ? `<div class="tiles more-tiles" hidden>${more.join("")}</div>` : ""}
      </nav>`;
  return `${topbar()}
    <div class="wrap shell">
      <nav class="side">
        <a href="#/" class="${active === "home" ? "on" : ""}">Businesses</a>
        ${nav}
        <div class="label">Organisation</div>
        <a href="#/team" class="${active === "team" ? "on" : ""}">Team</a>
        <a href="#/audit" class="${active === "audit" ? "on" : ""}">Audit log</a>
        ${billing.length ? `<a href="#/billing" class="${active === "billing" ? "on" : ""}">Billing</a>` : ""}
        <a href="#/account" class="${active === "account" ? "on" : ""}">Your account</a>
      </nav>
      ${mobile}
      <main>${content}</main>
    </div>`;
}

// ------------------------------------------------------------------ auth

let emailEnabled = null;
async function emailOn() {
  if (emailEnabled === null) emailEnabled = await api("/api/auth/options").then((o) => o.email).catch(() => false);
  return emailEnabled;
}

const authPage = (inner) => `
    <div class="wrap auth">
      <div class="panel">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><img src="/favicon.svg" width="32" height="32" alt=""><h1>TrailBook</h1></div>
        ${inner}
      </div>
      <p class="muted" style="text-align:center;font-size:14px"><a href="/pricing.html">Pricing</a> · <a href="/promises.html">Our promises</a> · <a href="/security.html">Security</a> · <a href="/status.html">Status</a></p>
    </div>`;

async function authView(mode, error = "", notice = "") {
  const signup = mode === "signup";
  const email = await emailOn();
  const alerts = `${error ? `<div class="alert bad">${esc(error)}</div>` : ""}${notice ? `<div class="alert good">${esc(notice)}</div>` : ""}`;
  if (mode === "forgot" || mode === "magic") {
    const forgot = mode === "forgot";
    app.innerHTML = authPage(`
      <p class="muted">${forgot ? "Enter your email and we'll send a link to choose a new password." : "Enter your email and we'll send a link that signs you in, no password needed."}</p>
      ${alerts}
      <form data-form="${mode}">
        <label>Email<input name="email" type="email" required autocomplete="email"></label>
        <button type="submit">${forgot ? "Send reset link" : "Email me a sign-in link"}</button>
      </form>
      <p style="margin-top:14px"><a href="#/login">Back to sign in</a></p>`);
    return;
  }
  app.innerHTML = authPage(`
        <p class="muted">${signup ? "Create your account and your first organisation." : "Sign in to your books."}</p>
        ${alerts}
        <form data-form="${mode}">
          ${signup ? `<label>Your name<input name="name" required autocomplete="name"></label>` : ""}
          <label>Email<input name="email" type="email" required autocomplete="email"></label>
          <label>Password<input name="password" type="password" required minlength="${signup ? 10 : 1}" autocomplete="${signup ? "new-password" : "current-password"}"></label>
          ${signup ? `
            <label>Business or firm name<input name="orgName" required></label>
            <label>Invite code <span class="muted">(optional, only if someone gave you one)</span><input name="inviteCode" autocomplete="off"></label>
            <label class="check"><input type="checkbox" name="acceptTerms" required> I agree to the <a href="/terms.html" target="_blank" rel="noopener">Terms of Service</a> for my business, and I've read the <a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</label>` : ""}
          <button type="submit">${signup ? "Create account" : "Sign in"}</button>
        </form>
        ${!signup && email ? `<p style="margin-top:12px"><a href="#/magic">Email me a sign-in link instead</a> · <a href="#/forgot">Forgot your password?</a></p>` : ""}
        <p style="margin-top:14px">${signup ? `Already have an account? <a href="#/login">Sign in</a>` : `New here? <a href="#/signup">Create an account</a>`}</p>`);
}

/**
 * The second sign-in step for someone with two-factor on. `then` says where
 * to go after: "home", or "join" with the invitation's token.
 */
function mfaView(ticket, then = "home", inviteToken = "", error = "") {
  app.innerHTML = authPage(`
    <p class="muted">Enter the 6-digit code from your authenticator app. Lost your phone? Enter one of your recovery codes instead.</p>
    ${error ? `<div class="alert bad">${esc(error)}</div>` : ""}
    <form data-form="mfa" data-ticket="${esc(ticket)}" data-then="${esc(then)}" data-invite="${esc(inviteToken)}">
      <label>Code<input name="code" required autocomplete="one-time-code" inputmode="text" maxlength="20" autofocus></label>
      <button type="submit">Sign in</button>
    </form>
    <p style="margin-top:14px"><a href="#/login">Start over</a></p>`);
  app.querySelector("input[name=code]")?.focus();
}

/** Pages opened from an emailed link. */
async function emailLinkView(kind, token, error = "") {
  if (kind === "reset") {
    app.innerHTML = authPage(`
      <p class="muted">Choose a new password. Signing in with it signs you out everywhere else.</p>
      ${error ? `<div class="alert bad">${esc(error)}</div>` : ""}
      <form data-form="reset-password" data-token="${esc(token)}">
        <label>New password<input name="password" type="password" minlength="10" required autocomplete="new-password"></label>
        <button type="submit">Save and sign in</button>
      </form>`);
    return;
  }
  try {
    const r = await api(`/api/auth/${kind}/${token}`, { body: {} });
    state.me = null; state.org = null;
    if (r.mfaRequired) return mfaView(r.ticket);
    if (kind === "verify") {
      app.innerHTML = authPage(`<div class="alert good">Thanks, ${esc(r.email)} is confirmed.</div><p><a href="#/">Go to your books</a></p>`);
      return;
    }
    location.hash = "#/";
  } catch (err) {
    app.innerHTML = authPage(`<div class="alert bad">${esc(err.message)}</div><p><a href="#/${kind === "verify" ? "" : "magic"}">${kind === "verify" ? "Go to your books" : "Send a new link"}</a></p>`);
  }
}

// ------------------------------------------------------------------ views

async function homeView() {
  state.entity = null;
  const ents = state.org.entities;
  const canAdd = ["owner", "admin"].includes(state.org.role);
  const isExample = state.org.org.name.startsWith("Example:");
  app.innerHTML = shell("home", `
    <div class="head"><div><h1>Businesses</h1><p class="muted">Each legal entity keeps its own books, periods and tax settings.</p></div></div>
    ${isExample ? `<div class="alert warn">These are example books with made-up figures. Use the menu at the top to switch back to your own organisation.</div>` : `
    <div class="panel ${ents.length ? "" : "hero"}">
      <h2>${ents.length ? "Want to try something first?" : "New here? Look around an example business first"}</h2>
      <p class="muted">Sunset Design Studio is a made-up California design studio with a year of invoices, bills, payments and a bank statement waiting to be reviewed. It sits in its own organisation, so nothing in it touches your books.</p>
      <button class="${ents.length ? "secondary" : ""}" data-action="open-example">Open the example business</button>
    </div>`}
    <div class="cards">
      ${ents.map((e) => `
        <a class="card" href="#/e/${e.id}/overview">
          <strong>${esc(e.legal_name)}</strong><br>
          <span class="muted">${esc(ENTITY_TYPES[e.entity_type] ?? e.entity_type)} · ${esc(placeName(e.country ?? "US", e.region))}</span><br>
          <span class="pill">${esc(e.framework.replace("_", " "))}</span> <span class="pill grey">${esc(RETURN_LABEL[e.tax_return_type] ?? e.tax_return_type)}</span>
        </a>`).join("") || `<p class="muted">No businesses yet.</p>`}
    </div>
    ${canAdd ? `
    <div class="panel" style="margin-top:20px">
      <h2>Add a business</h2>
      <p class="muted">The principal place of business sets the accounting framework, currency, chart of accounts and tax rules. ${esc(liveSummary())}</p>
      <form data-form="entity" class="grid">
        <label>Legal name<input name="legalName" required placeholder="Sunset Design Studio LLC"></label>
        <label>Entity type<select name="entityType">${Object.entries(ENTITY_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
        <label>Country<select name="country">${(state.org.countries ?? []).map((c) => `<option value="${esc(c.code)}" ${c.status === "live" ? "" : "disabled"}>${esc(c.name)}${c.status === "live" ? "" : " (coming later)"}</option>`).join("")}</select></label>
        <label><span data-region-label>${esc(countryOf("US")?.regionLabel ?? "State")}</span><select name="region">${regionOptions("US")}</select></label>
        <label>First fiscal year<select name="firstFiscalYear">${Array.from({ length: Number(today().slice(0, 4)) - 2025 }, (_, i) => 2026 + i).reverse().map((y) => `<option>${y}</option>`).join("")}</select></label>
        <label>EIN (optional)<input name="ein" placeholder="12-3456789"></label>
        <label>&nbsp;<button type="submit">Create business</button></label>
      </form>
    </div>` : ""}`);
}

const countryOf = (code) => (state.org?.countries ?? []).find((c) => c.code === code);

/** "California, United States": a region's name and its country's. */
function placeName(country, region) {
  const c = countryOf(country);
  const r = c?.regions.find((x) => x.code === region);
  return `${r?.name ?? region}, ${c?.name ?? country}`;
}

/** Live states first, then the rest, which can't be picked yet. */
function regionOptions(country) {
  const regions = countryOf(country)?.regions ?? [];
  const live = regions.filter((r) => r.status === "live");
  const later = regions.filter((r) => r.status !== "live");
  return live.map((r) => `<option value="${esc(r.code)}">${esc(r.name)}</option>`).join("") +
    (later.length ? `<optgroup label="Coming soon">${later.map((r) => `<option value="${esc(r.code)}" disabled>${esc(r.name)}</option>`).join("")}</optgroup>` : "");
}

function liveSummary() {
  const live = (state.org?.countries ?? []).flatMap((c) => c.regions.filter((r) => r.status === "live").map((r) => r.name));
  if (!live.length) return "";
  return live.length === 1 ? `${live[0]} is the only state live so far.` : `Live so far: ${live.join(", ")}.`;
}

async function loadEntity(id) {
  const stale = state.entity?.entity?.id !== id || !state.entity.fresh;
  const [ent, attention] = await Promise.all([
    stale ? api(orgPath(`/entities/${id}`)) : state.entity,
    api(orgPath(`/entities/${id}/attention`)),
  ]);
  state.entity = ent;
  state.entity.fresh = true;
  state.entity.attention = { ...attention, payrollToDo: attention.payRunsToApprove + (attention.taxDepositsDue ?? 0) };
  return state.entity;
}

const CREDIT_NORMAL = new Set(["liability", "equity", "revenue"]);
/** An account's balance on its normal side, so income and what you owe read as positive. */
const normalBalance = (a) => (CREDIT_NORMAL.has(a.type) ? -BigInt(a.balance_minor ?? 0) : BigInt(a.balance_minor ?? 0));

/** Opens one account's general ledger, from any screen. */
function openLedger(code) {
  rep.tab = "gl";
  rep.account = code;
  location.hash = `#/e/${state.entity.entity.id}/reports`;
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

const jr = { q: "" };

async function journalView(id) {
  await loadEntity(id);
  const { entries } = await api(entPath(`/journal${jr.q ? `?q=${encodeURIComponent(jr.q)}` : ""}`));
  const acct = Object.fromEntries(state.entity.accounts.map((a) => [a.code, a.name]));
  app.innerHTML = shell("journal", `
    <div class="head"><div><h1>Journal</h1><p class="muted">Posted entries can't be edited. To correct one, reverse it and post a new entry.</p></div>
      <form data-form="journal-search" class="row">
        <label>Find an entry<input name="q" type="search" value="${esc(jr.q)}" placeholder="Memo, description, #12 or 1450.00" style="width:260px"></label>
        <button type="submit" class="secondary">Search</button>
        ${jr.q ? `<button type="button" class="link" data-action="journal-clear">Show all</button>` : ""}
      </form>
    </div>
    <div class="panel">
      <h2>New entry</h2>
      <form data-form="journal">
        <div class="row" style="margin-bottom:12px">
          <label>Date<input type="date" name="date" value="${bookDate()}" min="${booksStart()}" required></label>
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
      <h2>${jr.q ? `Entries matching “${esc(jr.q)}”` : "Posted entries"}</h2>
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
      }).join("") : `<p class="muted">${jr.q ? "No entries match." : "Nothing posted yet."}</p>`}
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

async function trialBalanceView(id, asOf = today()) {
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

const monthName = (d) => new Date(d + "T00:00:00Z").toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const longDate = (d) => new Date(d + "T00:00:00Z").toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Last day of the unbroken run of closed months from the start of the books. */
function closedThroughOf(periods) {
  let through = null;
  for (const p of periods) { if (p.status === "open") break; through = p.end_date; }
  return through;
}

async function periodsView(id) {
  await loadEntity(id);
  const canClose = ["owner", "admin", "accountant"].includes(state.org.role);
  const canReopen = ["owner", "accountant"].includes(state.org.role);
  const periods = state.entity.periods;
  const through = closedThroughOf(periods);
  const ended = periods.filter((p) => p.end_date < today() && p.status !== "locked");
  const anyOpenLater = through && periods.some((p) => p.end_date > through && p.status !== "open");
  app.innerHTML = shell("periods", `
    <div class="head"><div><h1>Close the books</h1><p class="muted">Once you've reconciled the bank and checked the month, close the books through that date so nothing dated on or before it can change by accident.</p></div></div>
    <div class="panel">
      <div class="stat" style="font-family:inherit">${through ? `Closed through ${longDate(through)}` : "Nothing closed yet"}</div>
      ${anyOpenLater ? `<p class="hash">Some later months are closed too, but an earlier one is open.</p>` : ""}
      ${canClose && ended.length ? `<form data-form="close-through" class="row" style="margin-top:12px">
        <label>Close through<select name="through">${ended.map((p, i) => `<option value="${p.end_date}" ${i === ended.length - 1 ? "selected" : ""}>${longDate(p.end_date)}</option>`).join("")}</select></label>
        <label>How<select name="status"><option value="locked">Lock: nobody can post</option><option value="soft_closed">Soft-close: accountants can still adjust</option></select></label>
        <button type="submit">Close the books</button>
      </form>` : canClose ? `<p class="muted" style="margin-top:8px">Every month that has ended is already locked.</p>` : ""}
      <p class="hash" style="margin-top:8px">Reopening a month needs ${canReopen ? "" : "an owner or accountant and "}a reason, and is recorded in the audit log.</p>
    </div>
    <details class="panel"${anyOpenLater ? " open" : ""}><summary><strong>Month by month</strong></summary>
    <div class="table-wrap" style="margin-top:12px"><table>
      <thead><tr><th>Month</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${periods.map((p) => {
        const month = monthName(p.start_date);
        const acts = [];
        if (canClose && p.status === "open") acts.push(`<button class="secondary" data-action="period" data-id="${p.id}" data-status="soft_closed">Soft-close</button>`);
        if (canClose && p.status !== "locked") acts.push(`<button class="secondary" data-action="period" data-id="${p.id}" data-status="locked">Lock</button>`);
        if (canReopen && p.status !== "open") acts.push(`<form class="row" data-form="reopen" data-id="${p.id}"><input name="reason" placeholder="Reason for reopening" required><button class="secondary" type="submit">Reopen</button></form>`);
        return `<tr><td>${month}</td><td><span class="${STATUS_PILL[p.status]}">${STATUS_LABEL[p.status]}</span></td><td><div class="row">${acts.join("") || `<span class="muted">No actions for your role</span>`}</div></td></tr>`;
      }).join("")}</tbody>
    </table></div></details>`);
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
    <div class="head"><div><h1>Chart of accounts</h1><p class="muted">Every account maps to a financial-statement line, a cash-flow class and a ${esc(RETURN_LABEL[e.taxReturnType])} tax line. Click a balance to see every entry behind it. Codes and kinds never change once created; an account can be switched off only at a zero balance.</p></div></div>
    <div class="panel table-wrap"><table>
      <thead><tr><th>Code</th><th>Name</th><th>Type</th><th class="num">Balance</th><th>Statement line</th><th>Tax line</th><th></th></tr></thead>
      <tbody>${rows.map((a) => `<tr class="${a.is_active ? "" : "muted"}">
        <td class="mono">${a.code}</td><td>${esc(a.name)}${a.is_active ? "" : ` <span class="pill grey">Inactive</span>`}${a.system_key ? ` <span class="pill grey" title="Used by invoices, bills, payroll or the bank feed">System</span>` : ""}</td>
        <td>${TYPE_LABEL[a.type]}</td>
        <td class="num"><button class="link mono" data-action="open-ledger" data-code="${a.code}" title="Open this account's ledger">${usd(normalBalance(a))}</button></td>
        <td class="mono muted">${esc(a.statement_line)}</td><td class="mono">${esc(a.tax_line ?? "—")}</td>
        <td>${canEdit ? `<button class="link" data-action="acct-edit" data-id="${a.id}">Edit</button>` : ""}</td></tr>
        <tr data-acct-edit="${a.id}" hidden><td></td><td colspan="6">
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

// ------------------------------------------------------------ integrations

const MP = { search: "" };

function when(ts) {
  return ts ? new Date(ts).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "never";
}

async function integrationsView(id) {
  await loadEntity(id);
  const r = await api(entPath("/integrations"));
  const mp = r.milepost;
  const admin = ["owner", "admin"].includes(state.org.role);
  const canSetTax = ["owner", "admin", "accountant"].includes(state.org.role);
  const g = mp.grant;
  const linked = Boolean(g || mp.key);
  app.innerHTML = shell("integrations", `
    <div class="head"><div><h1>Integrations</h1><p class="muted">Apps connected to ${esc(state.entity.entity.legalName)}. Each connection covers this business only.</p></div></div>
    <div class="cards" style="margin-bottom:16px">
      <div class="card">
        <h2 style="margin-top:0">MilePost CRM</h2>
        <p class="muted">Your CRM. Once linked, a MilePost tab appears here, and a TrailBook tab appears in MilePost for as long as this business's TrailBook subscription is active.</p>
        <p><span class="pill ${linked ? "" : "grey"}">${linked ? "Connected" : "Not connected"}</span></p>
      </div>
    </div>

    <div class="panel">
      <h2>1. Let MilePost send customers and invoices</h2>
      <p class="muted">MilePost adds its customers here and, when a deal is won, issues the invoice in these books, then shows when it's paid. Only MilePost creates those invoices, so nothing is invoiced twice.</p>
      ${g ? `
        <p>Connected by ${esc(g.approvedBy)} on ${esc(when(g.createdAt))} · last used ${esc(when(g.lastUsedAt))}.</p>
        <p class="muted">MilePost may: ${g.scopes.map((x) => `<span class="pill grey">${esc(x)}</span>`).join(" ")}</p>
        <form data-form="app-settings" data-grant="${g.id}" class="row">
          <label style="flex:1">Kind of sale on MilePost's invoices <span class="muted">(decides sales tax when MilePost doesn't say)</span>
            <select name="taxCategory" ${canSetTax ? "" : "disabled"}>${r.taxCategories.map((c) => `<option value="${esc(c.id)}" ${c.id === (g.settings.taxCategory ?? "professional_service") ? "selected" : ""}>${esc(c.label)}${c.taxable ? " (taxable)" : ""}</option>`).join("")}</select>
          </label>
          ${canSetTax ? `<button type="submit" class="secondary">Save</button>` : ""}
        </form>
        ${admin ? `<p><button class="secondary" data-action="revoke-app" data-grant="${g.id}">Disconnect MilePost</button></p>` : ""}`
      : mp.oauthReady ? `
        <p>Start in MilePost: open <b>Integrations</b>, find <b>TrailBook</b> under Accounting &amp; payroll and choose <b>Connect</b>. You'll come back here to choose this business and allow it.</p>
        <p><a class="btn" href="${esc(mp.url)}/app/integrations" target="_blank" rel="noopener">Open MilePost Integrations</a></p>`
      : `<p class="muted">Not available yet: the server needs MilePost's client ID and secret (MILEPOST_OAUTH_CLIENT_ID and MILEPOST_OAUTH_CLIENT_SECRET).</p>`}
    </div>

    <div class="panel">
      <h2>2. Show MilePost inside TrailBook</h2>
      <p class="muted">With a MilePost API key, the MilePost tab lists your CRM contacts and lets you add them as customers. The key is encrypted before it's stored and never reaches your browser.</p>
      ${mp.key ? `
        <p>Linked to ${esc(mp.key.account_name ?? "MilePost")} with the key ending ${esc(mp.key.key_hint)} · checked ${esc(when(mp.key.checked_at))}${mp.key.active ? "" : ` · <span class="pill bad">MilePost subscription inactive</span>`}.</p>
        ${admin ? `<p><button class="secondary" data-action="remove-milepost-key">Remove the key</button></p>` : ""}`
      : admin ? `
        <p>In MilePost, open <b>Integrations</b>, <b>API keys</b>, and create a key named TrailBook. Paste it here; it's shown only once.</p>
        <form data-form="milepost-key" class="row">
          <label style="flex:1">MilePost API key<input name="apiKey" required autocomplete="off" placeholder="pacrm_…"></label>
          <button type="submit">Link MilePost</button>
        </form>`
      : `<p class="muted">An owner or admin can link MilePost.</p>`}
    </div>`);
}

async function milepostView(id) {
  await loadEntity(id);
  const q = MP.search ? `?email=${encodeURIComponent(MP.search)}` : "";
  const r = await api(entPath(`/milepost${q}`));
  const canAdd = ["owner", "admin", "bookkeeper", "accountant"].includes(state.org.role);
  const name = (c) => [c.first_name, c.last_name].filter(Boolean).join(" ") || c.email || "(no name)";
  app.innerHTML = shell("milepost", `
    <div class="head"><div><h1>MilePost</h1><p class="muted">Your CRM, linked to ${esc(state.entity.entity.legalName)}.</p></div>
      <a class="btn secondary" href="${esc(r.url)}/app" target="_blank" rel="noopener">Open MilePost</a></div>
    ${r.error ? `<div class="alert bad">${esc(r.error)}</div>` : ""}
    <div class="panel table-wrap">
      <h2>Invoices from MilePost</h2>
      <p class="muted">Issued by MilePost when a deal was won. They're ordinary invoices in these books.</p>
      <table>
        <thead><tr><th>Number</th><th>Customer</th><th>Date</th><th class="num">Total</th><th class="num">Due</th><th>Status</th></tr></thead>
        <tbody>${r.invoices.map((d) => `<tr>
          <td><a href="#/e/${id}/invoices/${d.id}">${esc(d.number)}</a></td><td>${esc(d.contactName)}</td><td>${esc(d.issueDate)}</td>
          <td class="num">${usd(d.totalMinor)}</td><td class="num">${usd(d.dueMinor)}</td><td><span class="${STATUS_PILL[d.status] ?? "pill"}">${STATUS_LABEL[d.status] ?? esc(d.status)}</span></td></tr>`).join("")
          || `<tr><td colspan="6" class="muted">None yet. When MilePost is connected (Integrations, step 1), won deals are invoiced here.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="panel table-wrap">
      <h2>MilePost contacts</h2>
      ${r.key ? `
        <form data-form="mp-search" class="row">
          <label style="flex:1">Find by email<input name="email" type="email" value="${esc(MP.search)}" placeholder="Leave blank for the 25 newest"></label>
          <button type="submit" class="secondary">Search</button>
        </form>
        <table>
          <thead><tr><th>Name</th><th>Email</th><th>Stage</th><th></th></tr></thead>
          <tbody>${(r.contacts ?? []).map((c) => `<tr>
            <td>${esc(name(c))}</td><td>${esc(c.email ?? "")}</td><td>${esc(c.lifecycle_stage ?? "")}</td>
            <td>${c.customerId ? `<span class="pill grey">Customer here</span>` : canAdd && c.email ? `<button class="link" data-action="mp-add-customer" data-id="${esc(c.id)}" data-email="${esc(c.email)}">Add as customer</button>` : ""}</td></tr>`).join("")
            || `<tr><td colspan="4" class="muted">${r.contacts ? "No contacts found." : ""}</td></tr>`}</tbody>
        </table>`
      : `<p class="muted">Link MilePost with an API key under <a href="#/e/${id}/integrations">Integrations</a> (step 2) to see your CRM contacts here.</p>`}
    </div>`);
}

/** The consent page an app sends someone to: choose the business, see what the app asks for, allow or cancel. */
async function oauthAuthorizeView(query) {
  const q = new URLSearchParams(query);
  let info;
  try {
    info = await api(`/api/oauth/client?${q.toString()}`);
  } catch (err) {
    app.innerHTML = authPage(`<div class="alert bad">${esc(err.message)}</div><p><a href="#/">Go to your books</a></p>`);
    return;
  }
  // Only businesses where this person is an owner or admin can be connected.
  const orgs = state.me.orgs.filter((o) => ["owner", "admin"].includes(o.role) && !o.name.startsWith("Example:"));
  const choices = [];
  for (const o of orgs) {
    try {
      const d = await api(`/api/orgs/${o.id}`);
      for (const e of d.entities) choices.push({ org: o, entity: e });
    } catch (err) {
      choices.push({ org: o, error: err.message });
    }
  }
  const usable = choices.filter((c) => c.entity);
  app.innerHTML = authPage(`
    <h2>Connect ${esc(info.client.name)} to TrailBook</h2>
    <p class="muted">Signed in as ${esc(state.me.user.email)}. ${esc(info.client.name)} will be able to:</p>
    <ul>${info.scopes.map((s) => `<li>${esc(s.description)}</li>`).join("")}</ul>
    <p class="muted">It never sees Social Security numbers, bank account numbers, payroll or your other businesses. You can disconnect it any time under Integrations.</p>
    ${choices.filter((c) => c.error).map((c) => `<div class="alert warn">${esc(c.org.name)}: ${esc(c.error)}</div>`).join("")}
    ${usable.length ? `
      <form data-form="oauth-allow">
        <label>Business<select name="target">${usable.map((c) => `<option value="${c.org.id}/${c.entity.id}">${esc(c.entity.legal_name)}${orgs.length > 1 ? ` (${esc(c.org.name)})` : ""}</option>`).join("")}</select></label>
        <input type="hidden" name="query" value="${esc(q.toString())}">
        <button type="submit">Allow</button> <a class="btn secondary" href="${esc(info.denyUrl)}">Cancel</a>
      </form>`
    : `<div class="alert warn">You need to be an owner or admin of a business in TrailBook to connect an app to it.</div><p><a class="btn secondary" href="${esc(info.denyUrl)}">Back to ${esc(info.client.name)}</a></p>`}`);
}

// ------------------------------------------------ invoices, bills, contacts

/** The first day the books cover; nothing can be dated before it. */
function booksStart() {
  return state.entity?.periods?.[0]?.start_date ?? "2026-01-01";
}

/** Today, or the first day of the books when they start later. A new fiscal year opens by itself when something is dated in it. */
function bookDate() {
  const t = today();
  return t < booksStart() ? booksStart() : t;
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
    blurb: "Recording a bill posts it to payables. Sales tax a vendor charges is part of the expense. If a vendor didn't charge California tax on something taxable, such as software from 2027, tick the use tax box and TrailBook adds the use tax you owe the state." },
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

// Sales tax: each line's kind of sale says whether it's taxable; the rate comes from the customer's address.
const taxCategories = () => state.entity.salesTaxCategories ?? [];
const isTaxable = (category) => taxCategories().find((c) => c.id === category)?.taxable ?? false;
/** Software (a digital product): its tax follows when the customer's access starts, so the line asks for the dates. */
const isSoftware = (category) => taxCategories().find((c) => c.id === category)?.digitalProduct ?? false;
const DEFAULT_KIND = "professional_service";
/** Use tax on bills is mostly about software and SaaS from vendors that don't charge California tax. */
const DEFAULT_PURCHASE_KIND = "prewritten_software";
const useTaxOn = () => Boolean(document.querySelector("form[data-form=document][data-kind=bill] [name=useTax]")?.checked);
const pct = (rate) => `${(Number(rate) * 100).toFixed(3).replace(/\.?0+$/, "")}%`;

function kindOptions(selected) {
  return taxCategories().map((c) => `<option value="${c.id}" title="${esc(c.help)}" ${c.id === selected ? "selected" : ""}>${esc(c.label)}</option>`).join("");
}

function itemOptions(selected = "") {
  return `<option value="">Other…</option>${(state.items ?? []).filter((i) => i.isActive || i.id === selected)
    .map((i) => `<option value="${i.id}" ${i.id === selected ? "selected" : ""}>${esc(i.name)}</option>`).join("")}`;
}

function docLineRow(kind, l = {}, useTax = useTaxOn()) {
  const tail = `
    <td><input name="quantity" class="mono" inputmode="decimal" aria-label="Quantity" value="${esc(l.quantity ?? "1")}" style="width:80px"></td>
    <td><input name="unitPrice" class="mono" inputmode="decimal" aria-label="Price" placeholder="0.00" value="${esc(l.unitPrice ?? "")}"></td>
    <td class="num" data-amount></td>
    <td><button type="button" class="link" data-action="remove-doc-line" aria-label="Remove line">✕</button></td>`;
  if (kind === "invoice") {
    const cat = l.taxCategory ?? DEFAULT_KIND;
    return `<tr>
      <td><select name="itemId" aria-label="Product or service">${itemOptions(l.itemId)}</select></td>
      <td><input name="description" aria-label="Description" value="${esc(l.description ?? "")}"></td>
      <td><select name="taxCategory" aria-label="Kind of sale">${kindOptions(cat)}</select><div class="hash" data-taxable>${isTaxable(cat) ? "Taxable" : "Not taxable"}</div>
        <div data-period ${isSoftware(cat) ? "" : "hidden"}><label class="hash">Access from<input name="servicePeriodStart" type="date" value="${esc(l.servicePeriodStart ?? "")}"></label>
          <label class="hash">to<input name="servicePeriodEnd" type="date" value="${esc(l.servicePeriodEnd ?? "")}"></label></div></td>
      ${tail}
    </tr>`;
  }
  // A bill's line asks what was bought only when the bill adds use tax.
  const cat = l.taxCategory ?? DEFAULT_PURCHASE_KIND;
  return `<tr>
    <td><select name="account" aria-label="Account">${docAccountOptions(kind, l.account ?? DOC[kind].defaultAccount)}</select></td>
    <td><input name="description" aria-label="Description" value="${esc(l.description ?? "")}">
      <div data-use-kind ${useTax ? "" : "hidden"} style="margin-top:6px"><select name="taxCategory" aria-label="Kind of purchase">${kindOptions(cat)}</select><div class="hash" data-taxable>${isTaxable(cat) ? "Use tax" : "No use tax"}</div>
        <div data-period ${isSoftware(cat) ? "" : "hidden"}><label class="hash">Access from<input name="servicePeriodStart" type="date" value="${esc(l.servicePeriodStart ?? "")}"></label>
          <label class="hash">to<input name="servicePeriodEnd" type="date" value="${esc(l.servicePeriodEnd ?? "")}"></label></div></div></td>
    ${tail}
  </tr>`;
}

function readDocLines() {
  return [...document.querySelectorAll("#doc-lines tr")].map((tr) => {
    const v = (n) => tr.querySelector(`[name=${n}]`)?.value.trim() ?? "";
    const common = { description: v("description"), quantity: v("quantity"), unitPrice: v("unitPrice") };
    const software = isSoftware(v("taxCategory"));
    if (tr.querySelector("[name=account]")) {
      if (!useTaxOn()) return { ...common, account: v("account") };
      return {
        ...common, account: v("account"), taxCategory: v("taxCategory"),
        servicePeriodStart: software ? v("servicePeriodStart") || undefined : undefined,
        servicePeriodEnd: software ? v("servicePeriodEnd") || undefined : undefined,
      };
    }
    return {
      ...common, itemId: v("itemId") || undefined, taxCategory: v("taxCategory"),
      servicePeriodStart: software ? v("servicePeriodStart") || undefined : undefined,
      servicePeriodEnd: software ? v("servicePeriodEnd") || undefined : undefined,
    };
  });
}

/** What the server said about this invoice's sales tax, for the figures shown while typing. */
const docTax = { rate: null, explanation: "", error: "", taxable: null, taxShare: null, timer: null, seq: 0 };

/** Asks the server how this invoice will be taxed. Called when the customer, date or kinds of sale change. */
function scheduleTaxPreview() {
  clearTimeout(docTax.timer);
  docTax.timer = setTimeout(runTaxPreview, 250);
}

async function runTaxPreview() {
  if (document.querySelector("form[data-form=document][data-kind=bill]")) return runUseTaxPreview();
  const form = document.querySelector("form[data-form=document][data-kind=invoice]");
  if (!form) return;
  const d = formData(form);
  const lines = readDocLines();
  // Software can be taxable in a later year than the invoice date, so always ask the server about it.
  const anyTaxable = lines.some((l) => isTaxable(l.taxCategory) || isSoftware(l.taxCategory));
  const seq = ++docTax.seq;
  const show = (rate, explanation, error = "", r = {}) => {
    if (seq !== docTax.seq) return;
    Object.assign(docTax, { rate, explanation, error, taxable: r.taxable ?? null, taxShare: r.taxShare ?? null });
    const note = document.getElementById("doc-tax-note");
    note.className = error || r.warnings?.length ? "alert warn" : "hash";
    note.textContent = [error || explanation, ...(r.warnings ?? [])].filter(Boolean).join(" ");
    const manual = form.querySelector("[data-manual]");
    if (manual) manual.hidden = !error;
    updateDocTotals();
  };
  if (!anyTaxable) return show("0", "No sales tax: nothing on this invoice is taxable in California.");
  if (!d.contactId || d.contactId === "__new") return show(null, "Sales tax will be worked out from the new customer's address when you issue the invoice.");
  const manualTax = d.manualRate && d.manualReason ? { ratePercent: d.manualRate, reason: d.manualReason } : undefined;
  try {
    const r = await api(entPath("/invoices/tax-preview"), { body: { contactId: d.contactId, issueDate: d.issueDate, lines, manualTax } });
    show(r.rate, r.explanation, "", r);
  } catch (err) {
    show(null, "", err.message);
  }
}

/** Asks the server what use tax this bill adds, when the vendor didn't charge California tax. */
async function runUseTaxPreview() {
  const form = document.querySelector("form[data-form=document][data-kind=bill]");
  if (!form) return;
  const on = useTaxOn();
  form.querySelectorAll("[data-use-tax]").forEach((el) => { el.hidden = !on; });
  form.querySelectorAll("[data-use-kind]").forEach((el) => { el.hidden = !on; });
  const d = formData(form);
  const seq = ++docTax.seq;
  const show = (rate, explanation, error = "", r = {}) => {
    if (seq !== docTax.seq) return;
    Object.assign(docTax, { rate, explanation, error, taxable: r.taxable ?? null, taxShare: null });
    const note = document.getElementById("doc-tax-note");
    note.className = error ? "alert warn" : "hash";
    note.textContent = on ? error || explanation : "";
    const manual = form.querySelector("[data-manual]");
    if (manual) manual.hidden = !on || !error;
    updateDocTotals();
  };
  if (!on) return show("0", "");
  const lines = readDocLines();
  const manualTax = d.manualRate && d.manualReason ? { ratePercent: d.manualRate, reason: d.manualReason } : undefined;
  try {
    const r = await api(entPath("/bills/use-tax-preview"), { body: { issueDate: d.issueDate, lines, manualTax } });
    show(r.rate, `${r.explanation} If you don't have a seller's permit, report it on a CDTFA use tax return or your California income tax return.`, "", r);
  } catch (err) {
    show(null, "", err.message);
  }
}

/** Rough preview of the totals; the server's figures are the ones that post. */
function updateDocTotals() {
  const form = document.querySelector("form[data-form=document]");
  if (!form) return;
  const rate = Number(docTax.rate ?? 0);
  let sub = 0n, tax = 0n, bad = false;
  const bill = form.dataset.kind === "bill";
  const useTax = bill && useTaxOn();
  // The server's answer per line wins once it has one; it knows the access dates and the customer's certificates.
  const lineTaxable = (i, cat) => docTax.taxable?.[i] ?? isTaxable(cat);
  document.querySelectorAll("#doc-lines tr").forEach((tr, i) => {
    const cat = tr.querySelector("[name=taxCategory]");
    if (cat && bill) {
      tr.querySelector("[data-taxable]").textContent = lineTaxable(i, cat.value) ? "Use tax" : "No use tax";
      tr.querySelector("[data-period]").hidden = !isSoftware(cat.value);
    } else if (cat) {
      const share = docTax.taxShare?.[i];
      tr.querySelector("[data-taxable]").textContent = !lineTaxable(i, cat.value) ? "Not taxable" : share ? `Taxable on ${Number(share) * 100}%` : "Taxable";
      tr.querySelector("[data-period]").hidden = !isSoftware(cat.value);
    }
    const q = Number(tr.querySelector("[name=quantity]").value || 0);
    const p = cents(tr.querySelector("[name=unitPrice]").value.trim());
    if (p === null || !(q > 0)) { bad = true; tr.querySelector("[data-amount]").textContent = ""; return; }
    const amt = BigInt(Math.round(q * Number(p)));
    sub += amt;
    if (cat && (!bill || useTax) && lineTaxable(i, cat.value)) tax += BigInt(Math.round(Math.round(Number(amt) * Number(docTax.taxShare?.[i] ?? 1)) * rate));
    tr.querySelector("[data-amount]").textContent = usd(amt);
  });
  document.getElementById("doc-sub").textContent = usd(sub);
  if (bill) {
    // Use tax is owed to the state, not the vendor: shown below the bill's total, never in it.
    const ut = document.getElementById("doc-use-tax");
    if (ut) ut.textContent = useTax && docTax.rate === null ? "—" : usd(useTax ? tax : 0n);
    const ul = document.getElementById("doc-use-tax-label");
    if (ul) ul.textContent = useTax && docTax.rate && Number(docTax.rate) > 0 ? `Use tax you owe the state, ${pct(docTax.rate)} (not paid to the vendor)` : "Use tax you owe the state (not paid to the vendor)";
    document.getElementById("doc-total").textContent = usd(sub);
    document.getElementById("doc-save").disabled = bad || sub <= 0n;
    return;
  }
  const t = document.getElementById("doc-tax");
  if (t) t.textContent = docTax.rate === null && tax === 0n && form.dataset.kind === "invoice" && !document.getElementById("doc-tax-note").textContent.startsWith("No sales tax") ? "—" : usd(tax);
  const tl = document.getElementById("doc-tax-label");
  if (tl) tl.textContent = docTax.rate && Number(docTax.rate) > 0 ? `Sales tax ${pct(docTax.rate)}` : "Sales tax";
  document.getElementById("doc-total").textContent = usd(sub + tax);
  document.getElementById("doc-save").disabled = bad || sub + tax <= 0n;
}

/** Fills a line from the product or service picked for it. */
function fillFromItem(tr, itemId) {
  const item = (state.items ?? []).find((i) => i.id === itemId);
  if (!item) return;
  const desc = tr.querySelector("[name=description]");
  if (!desc.value.trim() || (state.items ?? []).some((i) => i.name === desc.value)) desc.value = item.name;
  tr.querySelector("[name=taxCategory]").value = item.taxCategory;
  tr.querySelector("[name=unitPrice]").value = (Number(item.unitPriceMinor) / 100).toFixed(2);
}

async function docsView(id, kind) {
  await loadEntity(id);
  const d = DOC[kind];
  const [{ documents }, ag, { contacts }, { items }] = await Promise.all([
    api(entPath(`/${d.path}`)), api(entPath(`/${d.path}/aging`)), api(entPath("/contacts")),
    kind === "invoice" ? api(entPath("/items")) : { items: [] },
  ]);
  state.items = items;
  state.docContacts = contacts;
  Object.assign(docTax, { rate: null, explanation: "", error: "", taxable: null, taxShare: null });
  const canSetRate = ["owner", "accountant"].includes(state.org.role);
  const who = contacts.filter((c) => d.contactKinds.includes(c.kind));
  const useTaxDefault = kind === "bill" && Boolean(who[0]?.accrueUseTax);
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
          <div data-new-contact class="row" ${who.length ? "hidden" : ""}>
            <label>New ${d.who.toLowerCase()} name<input name="newContact" placeholder="${kind === "invoice" ? "Acme Corp" : "Pixel Freelance"}"></label>
            ${kind === "invoice" ? `<label>Street<input name="newLine1" placeholder="123 Main St"></label><label>City<input name="newCity" style="width:140px"></label>
              <label>State<input name="newState" value="CA" maxlength="2" style="width:56px"></label><label>ZIP<input name="newZip" inputmode="numeric" style="width:90px"></label>` : ""}
          </div>
          <label>Date<input type="date" name="issueDate" value="${issue}" min="${booksStart()}" required></label>
          <label>Due<input type="date" name="dueDate" value="${plusDays(issue, 30)}" required></label>
          ${kind === "invoice" ? "" : `<label>Vendor's invoice no.<input name="reference" style="width:150px"></label>`}
          <label style="flex:1;min-width:200px">Memo<input name="memo"></label>
        </div>
        ${kind === "bill" ? `<label class="check" style="margin-bottom:12px"><input type="checkbox" name="useTax" ${useTaxDefault ? "checked" : ""}> The vendor didn't charge California sales tax: add the use tax I owe</label>` : ""}
        <div class="table-wrap"><table>
          <thead><tr>${kind === "invoice" ? `<th style="width:17%">Product or service</th><th>Description</th><th style="width:25%">Kind of sale</th>` : `<th style="width:28%">Account</th><th>Description</th>`}<th>Qty</th><th class="num" style="width:12%">Price</th><th class="num">Amount</th><th></th></tr></thead>
          <tbody id="doc-lines">${docLineRow(kind, {}, useTaxDefault)}</tbody>
          <tfoot>
            <tr><td><button type="button" class="link" data-action="add-doc-line" data-kind="${kind}">+ Add line</button></td><td colspan="${kind === "invoice" ? 4 : 3}" class="num muted">Subtotal</td><td class="num" id="doc-sub">$0.00</td><td></td></tr>
            ${kind === "invoice" ? `<tr><td colspan="5" class="num muted" id="doc-tax-label">Sales tax</td><td class="num" id="doc-tax">$0.00</td><td></td></tr>` : ""}
            <tr><td colspan="${kind === "invoice" ? 5 : 4}" class="num">Total</td><td class="num" id="doc-total">$0.00</td><td></td></tr>
            ${kind === "bill" ? `<tr data-use-tax ${useTaxDefault ? "" : "hidden"}><td colspan="4" class="num muted" id="doc-use-tax-label">Use tax you owe the state (not paid to the vendor)</td><td class="num" id="doc-use-tax">$0.00</td><td></td></tr>` : ""}
          </tfoot>
        </table></div>
        <p id="doc-tax-note" class="hash" style="margin-top:8px"></p>
        ${canSetRate ? `<div data-manual class="row" hidden>
          <label>Set the rate by hand (%)<input name="manualRate" inputmode="decimal" placeholder="9.5" style="width:90px"></label>
          <label style="flex:1">Why<input name="manualReason" placeholder="e.g. CDTFA lookup down; rate from the CDTFA website"></label>
        </div>` : ""}
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
            <a href="#/e/${id}/${d.path}/${x.id}">View</a>
            ${canWrite && x.status !== "void" && x.dueMinor !== "0" ? `<button class="link" data-action="doc-toggle" data-form="pay" data-id="${x.id}">${kind === "invoice" ? "Receive payment" : "Pay"}</button>` : ""}
            ${canWrite && x.status !== "void" && x.paidMinor === "0" ? `<button class="link" data-action="doc-toggle" data-form="void" data-id="${x.id}">Void</button>` : ""}
          </div></td>
        </tr>
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
  if (canWrite && (kind === "invoice" || useTaxDefault)) runTaxPreview();
}

/** One invoice or bill as a document: what the customer sees, plus its payments. Prints cleanly. */
async function docPageView(id, kind, docId) {
  await loadEntity(id);
  const d = DOC[kind];
  const [x, { contacts }] = await Promise.all([api(entPath(`/${d.path}/${docId}`)), api(entPath("/contacts"))]);
  const e = state.entity.entity;
  const who = contacts.find((c) => c.id === x.contactId);
  const invoice = kind === "invoice";
  const addr = (a) => (a ? `<div>${esc(a.line1)}</div><div>${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}</div>` : "");
  const status = x.status === "void" ? "void" : BigInt(x.totalMinor) - BigInt(x.paidMinor) <= 0n ? "paid" : x.dueDate < today() ? "overdue" : BigInt(x.paidMinor) > 0n ? "partial" : "open";
  const due = status === "void" ? 0n : BigInt(x.totalMinor) - BigInt(x.paidMinor);
  app.innerHTML = shell(d.path, `
    <div class="head no-print">
      <div><a href="#/e/${id}/${d.path}">← All ${d.title.toLowerCase()}</a></div>
      <div class="row"><button class="secondary" data-action="print">Print or save as PDF</button></div>
    </div>
    <article class="panel doc">
      <div class="row" style="justify-content:space-between;align-items:flex-start">
        <div>
          <div class="doc-title">${invoice ? "Invoice" : "Bill"} ${esc(x.number)}</div>
          ${x.reference ? `<div class="muted">Vendor's invoice no. ${esc(x.reference)}</div>` : ""}
          <span class="${STATUS_PILL[status]}">${STATUS_LABEL[status]}</span>
        </div>
        <div style="text-align:right"><strong>${esc(e.legalName)}</strong>${addr(e.address)}</div>
      </div>
      <div class="row" style="gap:40px;margin:20px 0">
        <div><div class="muted">${invoice ? "Bill to" : "From"}</div><strong>${esc(x.contactName)}</strong>${addr(who?.address)}${who?.email ? `<div>${esc(who.email)}</div>` : ""}</div>
        <div><div class="muted">${invoice ? "Invoice date" : "Bill date"}</div>${longDate(x.issueDate)}</div>
        <div><div class="muted">Due</div>${longDate(x.dueDate)}</div>
        <div><div class="muted">Balance due</div><strong class="mono">${usd(due)}</strong></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead>
        <tbody>${x.lines.map((l) => `<tr><td>${esc(l.description || l.accountName)}${l.taxable ? ` <span class="hash">taxable${l.taxableMinor !== null && l.taxableMinor !== undefined ? ` on ${usd(l.taxableMinor)}` : ""}</span>` : ""}${l.useTaxable ? ` <span class="hash">use tax ${usd(l.useTaxMinor)}</span>` : ""}${l.servicePeriodStart ? `<div class="hash">Access ${longDate(l.servicePeriodStart)}${l.servicePeriodEnd ? ` to ${longDate(l.servicePeriodEnd)}` : ""}</div>` : ""}</td>
          <td class="num">${esc(l.quantity)}</td><td class="num">${usd(l.unitPriceMinor)}</td><td class="num">${usd(l.amountMinor)}</td></tr>`).join("")}</tbody>
        <tfoot>
          <tr><td colspan="3" class="num muted">Subtotal</td><td class="num">${usd(x.subtotalMinor)}</td></tr>
          ${invoice && BigInt(x.taxMinor) ? `<tr><td colspan="3" class="num muted">Sales tax ${pct(x.taxRate)}</td><td class="num">${usd(x.taxMinor)}</td></tr>` : ""}
          <tr><td colspan="3" class="num">Total</td><td class="num">${usd(x.totalMinor)}</td></tr>
          ${!invoice && BigInt(x.useTaxMinor) ? `<tr><td colspan="3" class="num muted">Use tax you owe the state, ${pct(x.useTaxRate)} (not paid to the vendor)</td><td class="num">${usd(x.useTaxMinor)}</td></tr>` : ""}
          ${BigInt(x.paidMinor) ? `<tr><td colspan="3" class="num muted">Paid</td><td class="num">${usd(-BigInt(x.paidMinor))}</td></tr><tr><td colspan="3" class="num">Balance due</td><td class="num">${usd(due)}</td></tr>` : ""}
        </tfoot>
      </table></div>
      ${x.memo ? `<p style="margin-top:16px">${esc(x.memo)}</p>` : ""}
    </article>
    ${x.status === "void" ? `<div class="alert warn">Voided ${x.voidDate}: ${esc(x.voidReason)}</div>` : ""}
    <div class="panel no-print">
      <h2>Behind the scenes</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Account</th><th>Line</th><th class="num">Amount</th><th class="num">Tax</th></tr></thead>
        <tbody>${x.lines.map((l) => `<tr><td>${l.accountCode} · ${esc(l.accountName)}</td><td>${esc(l.description)}</td><td class="num">${usd(l.amountMinor)}</td><td class="num">${usd(invoice ? l.taxMinor : l.useTaxMinor, { blankZero: true })}</td></tr>`).join("")}</tbody>
      </table></div>
      ${invoice ? `<p style="margin-top:8px">${esc(taxExplanation(x))}</p>` : x.useTaxSource !== "none" ? `<p style="margin-top:8px">${esc(useTaxExplanation(x))}</p>` : ""}
      <p class="hash" style="margin-top:8px">Created by ${esc(x.createdBy.replace("user:", ""))}</p>
      ${x.payments.length ? `<h3>Payments</h3>${x.payments.map((p) => `<div class="hash">${p.date} · ${usd(p.amountMinor)} · account ${p.bankAccountCode} · by ${esc(p.createdBy.replace("user:", ""))}</div>`).join("")}` : ""}
    </div>`);
}

/** Why a bill has the use tax it has, from what was frozen on it. Mirrors explainUseTax on the server. */
function useTaxExplanation(x) {
  const at = x.useTaxAddress ? ` (${x.useTaxAddress})` : "";
  return {
    not_taxable: "No use tax: nothing on this bill is taxable in California.",
    lookup: `Use tax ${pct(x.useTaxRate)} on taxable lines, the rate for ${x.useTaxJurisdiction}${at}. You owe it to the CDTFA, not the vendor; it's in sales tax payable.`,
    manual: `Use tax ${pct(x.useTaxRate)}, set by hand: ${x.useTaxNote}. You owe it to the CDTFA, not the vendor; it's in sales tax payable.`,
  }[x.useTaxSource] ?? "No use tax.";
}

/** Why an issued invoice has the tax it has, from what was frozen on it. Mirrors explainTax on the server. */
function taxExplanation(x) {
  const at = x.taxAddress ? ` (${x.taxAddress})` : "";
  return {
    not_taxable: "No sales tax: nothing on this invoice is taxable in California.",
    resale: `No sales tax: ${x.taxNote ?? "sale for resale"}.`,
    out_of_state: `No sales tax: delivered outside California${at}.`,
    lookup: `Sales tax ${pct(x.taxRate)} on taxable lines, the rate for ${x.taxJurisdiction}${at}.${x.taxNote ? ` ${x.taxNote}.` : ""}`,
    direct_pay: `No sales tax on software: ${x.taxNote ?? "the buyer pays California use tax directly"}.`,
    manual: `Sales tax ${pct(x.taxRate)}, set by hand: ${x.taxNote}.`,
    user_entered: `Sales tax ${pct(x.taxRate)}, entered by hand before the rate was worked out automatically.`,
  }[x.taxSource] ?? "No sales tax.";
}

async function contactsView(id) {
  await loadEntity(id);
  const { contacts } = await api(entPath("/contacts"));
  const canWrite = state.org.role !== "read_only" && state.org.role !== "approver";
  const canSetTaxStatus = ["owner", "accountant"].includes(state.org.role);
  const oneLine = (a) => (a ? `${a.line1}, ${a.city}, ${a.state} ${a.zip}` : "");
  const addressFields = (a = {}) => `
    <label>Street<input name="line1" value="${esc(a?.line1 ?? "")}" placeholder="123 Main St"></label>
    <label>City<input name="city" value="${esc(a?.city ?? "")}" style="width:140px"></label>
    <label>State<input name="state" value="${esc(a?.state ?? "CA")}" maxlength="2" style="width:56px"></label>
    <label>ZIP<input name="zip" value="${esc(a?.zip ?? "")}" inputmode="numeric" style="width:90px"></label>`;
  app.innerHTML = shell("contacts", `
    <div class="head"><div><h1>Customers and vendors</h1><p class="muted">The people and businesses you invoice and pay. A customer's address decides the sales tax rate on what you sell them.</p></div></div>
    <div class="panel table-wrap"><table>
      <thead><tr><th>Name</th><th>Type</th><th>Email</th><th>Address</th><th></th></tr></thead>
      <tbody>${contacts.map((c) => `<tr><td>${esc(c.name)}${c.resalePermit ? `<div class="hash">Resale certificate · permit ${esc(c.resalePermit)}</div>` : ""}${c.directPayPermit ? `<div class="hash">Pays use tax on software directly · permit ${esc(c.directPayPermit)}</div>` : ""}${c.mpu ? `<div class="hash">Software ${esc(c.mpu.caPercent)}% used in California · certificate ${esc(c.mpu.certificateDate)}</div>` : ""}${c.accrueUseTax ? `<div class="hash">Doesn't charge California tax · bills add use tax</div>` : ""}</td><td>${CONTACT_LABEL[c.kind]}</td>
          <td>${esc(c.email ?? "")}</td><td>${esc(oneLine(c.address)) || (c.kind === "vendor" ? "" : `<span class="muted">No address</span>`)}</td>
          <td>${canWrite ? `<button class="link" data-action="doc-toggle" data-form="contact-edit" data-id="${c.id}">Edit</button>` : ""}</td></tr>
        <tr hidden data-contact-edit="${c.id}"><td colspan="5">
          <form data-form="contact-edit" data-id="${c.id}" class="row">
            <label>Email<input name="email" type="email" value="${esc(c.email ?? "")}"></label>
            ${addressFields(c.address)}
            ${c.kind !== "vendor" ? `<label>Seller's permit<input name="resalePermit" value="${esc(c.resalePermit ?? "")}" placeholder="Only with a resale certificate" style="width:190px"></label>` : ""}
            ${c.kind !== "vendor" && canSetTaxStatus ? `
              <label title="Past $5,000,000 of software a year from you, the buyer reports the tax (SB 122)">Direct payment permit<input name="directPayPermit" value="${esc(c.directPayPermit ?? "")}" placeholder="Only if they pay use tax directly" style="width:190px"></label>
              <label title="From the customer's multiple-points-of-use certificate">Software used in California %<input name="mpuCaPercent" inputmode="decimal" value="${esc(c.mpu?.caPercent ?? "")}" placeholder="All" style="width:80px"></label>
              <label>Certificate date<input name="mpuCertificateDate" type="date" value="${esc(c.mpu?.certificateDate ?? "")}"></label>` : ""}
            ${c.kind !== "customer" ? `<label class="check" style="white-space:nowrap" title="Their bills then add the California use tax you owe, for example on software or SaaS from 2027"><input type="checkbox" name="accrueUseTax" ${c.accrueUseTax ? "checked" : ""}> Doesn't charge California sales tax</label>` : ""}
            <button type="submit">Save</button>
          </form></td></tr>`).join("") || `<tr><td colspan="5" class="muted">No customers or vendors yet.</td></tr>`}</tbody>
    </table></div>
    ${canWrite ? `<div class="panel"><h2>Add a customer or vendor</h2>
      <form data-form="contact" class="row">
        <label style="flex:1">Name<input name="name" required></label>
        <label>Type<select name="kind"><option value="customer">Customer</option><option value="vendor">Vendor</option><option value="both">Both</option></select></label>
        <label>Email (optional)<input name="email" type="email"></label>
        ${addressFields()}
        <button type="submit">Add</button>
      </form>
      <p class="hash">A customer who buys to resell can give you a resale certificate (CDTFA-230). Add their seller's permit number with Edit, and TrailBook won't charge them sales tax.
        For software from 2027, an owner or accountant can also record a buyer's use tax direct payment permit, or the California share from their multiple-points-of-use certificate.</p></div>` : ""}`);
}

/** The four address fields of a form, as the API takes them; null when left blank. */
function addressOf(d, prefix = "") {
  const a = { line1: d[`${prefix}line1`] ?? d[`${prefix}Line1`], city: d[`${prefix}city`] ?? d[`${prefix}City`], state: d[`${prefix}state`] ?? d[`${prefix}State`], zip: d[`${prefix}zip`] ?? d[`${prefix}Zip`] };
  return [a.line1, a.city, a.zip].some((v) => v?.trim()) ? a : null;
}

// ---------------------------------------------------------- products and services

async function itemsView(id) {
  await loadEntity(id);
  const { items } = await api(entPath("/items"));
  const canWrite = state.org.role !== "read_only" && state.org.role !== "approver";
  const label = (cat) => taxCategories().find((c) => c.id === cat)?.label ?? cat;
  const income = (selected) => docAccountOptions("invoice", selected);
  app.innerHTML = shell("items", `
    <div class="head"><div><h1>Products and services</h1><p class="muted">What you sell. Picking one on an invoice fills in the description and price, and its kind of sale tells TrailBook whether California taxes it.</p></div></div>
    <div class="panel table-wrap"><table>
      <thead><tr><th>Name</th><th>Kind of sale</th><th>Sales tax</th><th class="num">Price</th><th></th></tr></thead>
      <tbody>${items.map((i) => `<tr class="${i.isActive ? "" : "muted"}"><td>${esc(i.name)}${i.isActive ? "" : " <span class=\"pill grey\">Retired</span>"}</td><td>${esc(label(i.taxCategory))}</td>
          <td>${isTaxable(i.taxCategory) ? "Taxable" : "Not taxable"}</td><td class="num">${usd(i.unitPriceMinor)}</td>
          <td>${canWrite ? `<button class="link" data-action="doc-toggle" data-form="item-edit" data-id="${i.id}">Edit</button>` : ""}</td></tr>
        <tr hidden data-item-edit="${i.id}"><td colspan="5">
          <form data-form="item-edit" data-id="${i.id}" class="row">
            <label>Name<input name="name" value="${esc(i.name)}" required></label>
            <label>Kind of sale<select name="taxCategory">${kindOptions(i.taxCategory)}</select></label>
            <label>Price<input name="unitPrice" class="mono" inputmode="decimal" value="${(Number(i.unitPriceMinor) / 100).toFixed(2)}" style="width:110px"></label>
            <label>Income account<select name="account">${income(i.accountCode)}</select></label>
            <label class="row"><input type="checkbox" name="active" ${i.isActive ? "checked" : ""}> Still sold</label>
            <button type="submit">Save</button>
          </form></td></tr>`).join("") || `<tr><td colspan="5" class="muted">Nothing yet. Add what you sell most often.</td></tr>`}</tbody>
    </table></div>
    ${canWrite ? `<div class="panel"><h2>Add a product or service</h2>
      <form data-form="item" class="row">
        <label style="flex:1">Name<input name="name" required placeholder="Logo design"></label>
        <label>Kind of sale<select name="taxCategory">${kindOptions(DEFAULT_KIND)}</select></label>
        <label>Price<input name="unitPrice" class="mono" inputmode="decimal" placeholder="0.00" style="width:110px"></label>
        <label>Income account<select name="account">${income("4000")}</select></label>
        <button type="submit">Add</button>
      </form>
      <ul class="hash">${taxCategories().map((c) => `<li><strong>${esc(c.label)}</strong> (${c.taxable ? "taxable" : "not taxable"}): ${esc(c.help)}</li>`).join("")}</ul>
    </div>` : ""}`);
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

const SOURCE_LABEL = { journal_voucher: "Journal entry", invoice: "Invoice", bill: "Bill", payment: "Payment", opening_balance: "Opening balance", reversal: "Reversal", bank_line: "Bank", pay_run: "Payroll" };

async function overviewView(id) {
  await loadEntity(id);
  const [{ checks }, g, bk] = await Promise.all([api(entPath("/health")), api(entPath("/glance")), api(entPath("/backups")).catch(() => null)]);
  const e = state.entity.entity;
  const attn = state.entity.attention;
  const canSettings = ["owner", "admin"].includes(state.org.role);
  const canWrite = !["read_only", "approver"].includes(state.org.role);
  const problems = checks.filter((c) => !c.ok && !c.warn).length;
  const warnings = checks.filter((c) => !c.ok && c.warn).length;
  const summary = problems ? `<div class="alert bad">${problems} thing${problems === 1 ? " needs" : "s need"} fixing in the books.</div>`
    : warnings ? `<div class="alert warn">The books are sound. ${warnings} housekeeping item${warnings === 1 ? " is" : "s are"} worth a look.</div>`
    : `<div class="alert good">Everything checks out.</div>`;
  const einMissing = checks.some((c) => c.key === "ein" && !c.ok);
  const go = (k) => `#/e/${e.id}/${k}`;
  const kpi = (label, minor, href, note = "") => `<a class="card kpi" href="${href}"><div class="muted">${label}</div><div class="stat">${usd(minor)}</div>${note ? `<div class="hash">${note}</div>` : ""}</a>`;
  const todo = [
    [attn.bankToReview, `bank line${attn.bankToReview === 1 ? "" : "s"} to review`, "bank"],
    [attn.overdueInvoices, `invoice${attn.overdueInvoices === 1 ? " is" : "s are"} overdue`, "invoices"],
    [attn.billsDueSoon, `bill${attn.billsDueSoon === 1 ? " is" : "s are"} due within a week`, "bills"],
    [attn.payRunsToApprove, `pay run${attn.payRunsToApprove === 1 ? "" : "s"} waiting for approval`, "payroll"],
    [attn.taxDepositsDue, `payroll tax deposit${attn.taxDepositsDue === 1 ? " is" : "s are"} due soon or late`, "payroll"],
  ].filter(([n]) => n);
  app.innerHTML = shell("overview", `
    <div class="head"><div><h1>${esc(e.legalName)}</h1><p class="muted">${g.closedThrough ? `Books closed through ${longDate(g.closedThrough)}.` : "Your money at a glance, as of today."}</p></div>
      ${canWrite ? `<div class="row quick">
        <a class="btn" href="${go("invoices")}">New invoice</a>
        <a class="btn secondary" href="${go("bills")}">Record a bill</a>
        <a class="btn secondary" href="${go("bank")}">Import bank statement</a>
      </div>` : ""}
    </div>
    <div class="cards kpis">
      ${kpi("Cash in the bank", g.cashMinor, go("bank"), "per the books")}
      ${kpi("Customers owe you", g.owedToYouMinor, go("invoices"))}
      ${kpi("You owe vendors", g.youOweMinor, go("bills"))}
      ${kpi("Profit this year", g.profitThisYearMinor, go("reports"), `since ${longDate(g.fiscalYearFrom)}`)}
      ${BigInt(g.salesTaxHeldMinor) ? kpi("Sales tax to set aside", g.salesTaxHeldMinor, go("reports/st"), "collected, not yet paid to the CDTFA") : ""}
    </div>
    <div class="split">
      <div class="panel">
        <h2>To do</h2>
        ${todo.length ? `<ul class="todo">${todo.map(([n, what, k]) => `<li><a href="${go(k)}"><span class="badge">${n}</span> ${what}</a></li>`).join("")}</ul>` : `<p class="muted">Nothing waiting on you.</p>`}
        ${!e.address && canSettings ? `<form data-form="business-address" style="margin-top:12px">
          <p><strong>Add your business address.</strong> <span class="muted">TrailBook uses it for the sales tax rate when a customer has no address of their own.</span></p>
          <div class="row">
            <label>Street<input name="line1" required placeholder="123 Main St"></label><label>City<input name="city" required style="width:140px"></label>
            <label>State<input name="state" value="CA" maxlength="2" style="width:56px"></label><label>ZIP<input name="zip" required inputmode="numeric" style="width:90px"></label>
            <button type="submit">Save</button>
          </div></form>` : ""}
      </div>
      <div class="panel">
        <h2>Recent activity</h2>
        ${g.recent.length ? `<table><tbody>${g.recent.map((r) => `<tr><td>${r.date}</td><td>${esc(r.memo || SOURCE_LABEL[r.sourceType] || r.sourceType)}<div class="hash">${SOURCE_LABEL[r.sourceType] ?? r.sourceType} #${r.entryNumber}</div></td><td class="num">${usd(r.amountMinor)}</td></tr>`).join("")}</tbody></table>`
          : `<p class="muted">Nothing posted yet. Start with an invoice, a bill or a bank statement.</p>`}
      </div>
    </div>
    <details class="panel"${problems ? " open" : ""}><summary><strong>Books health</strong> <span class="muted">· bookkeeping checks, not a tax or compliance review</span></summary>
    <div style="margin-top:12px">${summary}</div>
    <div class="table-wrap"><table>
      <thead><tr><th></th><th>Check</th><th>Detail</th><th></th></tr></thead>
      <tbody>${checks.map((c) => `<tr>
        <td><span class="${c.ok ? "pill" : c.warn ? "pill warn" : "pill bad"}">${c.ok ? "OK" : c.warn ? "Review" : "Fix"}</span></td>
        <td>${esc(c.title)}</td><td class="muted">${esc(c.detail)}</td>
        <td>${!c.ok && c.go ? `<a href="${go(c.go)}">Go there</a>` : ""}</td></tr>`).join("")}</tbody>
    </table></div>
    ${einMissing && canSettings ? `<form data-form="ein" class="row" style="margin-top:12px">
        <label>Add the EIN<input name="ein" placeholder="12-3456789" required pattern="\\d{2}-?\\d{7}" class="mono"></label>
        <button type="submit">Save</button>
      </form>` : ""}
    </details>
    ${["owner", "admin", "accountant"].includes(state.org.role) ? `<div class="panel">
      <div class="row" style="justify-content:space-between">
        <div><strong>Backup</strong><div class="muted">Save a complete copy of these books (every entry, invoice, bill, bank line and the audit log) as one file on your computer.</div></div>
        <button class="secondary" data-action="backup">Download a backup</button>
      </div>
      ${backupPanel(bk)}
    </div>` : ""}`);
}

/** The nightly copies: the latest one, and the last 30 days to download from. */
function backupPanel(bk) {
  const points = bk?.restorePoints ?? [];
  if (!points.length) return `<p class="muted" style="margin-top:10px">Nightly backups start after the first night. Each copy is encrypted, stored apart from the database, read back and checked, and kept for 30 days.</p>`;
  const last = points[0];
  return `<p style="margin-top:10px">${last.verified
      ? `<span class="pill">Checked</span> Last nightly backup ${longDate(last.date)}: read back and matched the books.`
      : `<span class="pill bad">Problem</span> The nightly backup on ${longDate(last.date)} didn't pass its check (${esc(last.problem)}). We've been alerted.`}</p>
    <details><summary>Restore points (${points.length})</summary><div class="table-wrap"><table>
      <thead><tr><th>Night of</th><th>Check</th><th>Size</th><th></th></tr></thead>
      <tbody>${points.map((r) => `<tr><td>${longDate(r.date)}</td><td>${r.verified ? "Passed" : esc(r.problem)}</td><td>${Math.max(1, Math.round(r.bytes / 1024))} KB</td>
        <td>${r.verified && bk.downloadable ? `<button class="link" data-action="restore-point" data-id="${r.id}">Download</button>` : ""}</td></tr>`).join("")}</tbody>
    </table></div></details>`;
}

// ------------------------------------------------------------- reports

const REPORTS = [["pl", "Profit and loss"], ["bs", "Balance sheet"], ["gl", "General ledger"], ["ar", "Receivables aging"], ["ap", "Payables aging"], ["st", "Sales tax"]];
const rep = { tab: "pl", preset: "this-year", asPreset: "today", from: "", to: "", asOf: "", account: "all" };

const RANGE_PRESETS = [["this-month", "This month"], ["last-month", "Last month"], ["this-quarter", "This quarter"], ["last-quarter", "Last quarter"], ["this-year", "This year to date"], ["last-year", "Last year"], ["custom", "Custom dates"]];
const ASOF_PRESETS = [["today", "Today"], ["end-last-month", "End of last month"], ["end-last-quarter", "End of last quarter"], ["end-last-year", "End of last year"], ["custom", "Custom date"]];

const ymd = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
/** Months are 1-based; day 0 of the next month is this month's last day, and Date handles the year rollover. */
const monthEnd = (y, m) => ymd(y, m + 1, 0);

/** Date ranges people actually ask for. Years follow the business's fiscal year; quarters are calendar quarters. */
function presetRange(k) {
  const t = today();
  const [y, m] = t.split("-").map(Number);
  const fm = state.entity.entity.fiscalYearStartMonth ?? 1;
  const fy = m >= fm ? y : y - 1;
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return {
    "this-month": [ymd(y, m, 1), t],
    "last-month": [ymd(y, m - 1, 1), monthEnd(y, m - 1)],
    "this-quarter": [ymd(y, q, 1), t],
    "last-quarter": [ymd(y, q - 3, 1), monthEnd(y, q - 1)],
    "this-year": [ymd(fy, fm, 1), t],
    "last-year": [ymd(fy - 1, fm, 1), ymd(fy, fm, 0)],
  }[k];
}

function presetAsOf(k) {
  const t = today();
  const [y, m] = t.split("-").map(Number);
  const fm = state.entity.entity.fiscalYearStartMonth ?? 1;
  const fy = m >= fm ? y : y - 1;
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return { today: t, "end-last-month": monthEnd(y, m - 1), "end-last-quarter": monthEnd(y, q - 1), "end-last-year": ymd(fy, fm, 0) }[k];
}

function reportDefaults() {
  if (rep.preset !== "custom" || !rep.from) [rep.from, rep.to] = presetRange(rep.preset === "custom" ? "this-year" : rep.preset);
  if (rep.asPreset !== "custom" || !rep.asOf) rep.asOf = presetAsOf(rep.asPreset === "custom" ? "today" : rep.asPreset);
  if (rep.account !== "all" && !state.entity.accounts.some((a) => a.code === rep.account)) rep.account = "all";
}

function reportQuery() {
  if (rep.tab === "pl") return ["/reports/profit-and-loss", `from=${rep.from}&to=${rep.to}`, `profit-and-loss-${rep.from}-to-${rep.to}`];
  if (rep.tab === "bs") return ["/reports/balance-sheet", `asOf=${rep.asOf}`, `balance-sheet-${rep.asOf}`];
  if (rep.tab === "st") return ["/reports/sales-tax", `from=${rep.from}&to=${rep.to}`, `sales-tax-${rep.from}-to-${rep.to}`];
  if (rep.tab === "gl") return ["/reports/general-ledger", `account=${encodeURIComponent(rep.account)}&from=${rep.from}&to=${rep.to}`, `general-ledger-${rep.account}-${rep.from}-to-${rep.to}`];
  const kind = rep.tab === "ar" ? "receivables" : "payables";
  return [`/reports/${kind}-aging`, `asOf=${rep.asOf}`, `${kind}-aging-${rep.asOf}`];
}

const ledgerTable = (gl) => `<table>
  <thead><tr><th>Date</th><th>Entry</th><th>Memo</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Balance</th></tr></thead>
  <tbody><tr><td>${gl.from}</td><td></td><td class="muted">Opening balance</td><td></td><td></td><td class="num">${usd(gl.openingMinor)}</td></tr>
  ${gl.lines.map((l) => `<tr><td>${l.date}</td><td class="mono">#${l.entryNumber}</td><td>${esc(l.memo || l.description)}</td>
    <td class="num">${usd(l.debitMinor, { blankZero: true })}</td><td class="num">${usd(l.creditMinor, { blankZero: true })}</td><td class="num">${usd(l.balanceMinor)}</td></tr>`).join("")}</tbody>
  <tfoot><tr><td colspan="5">Closing balance</td><td class="num">${usd(gl.closingMinor)}</td></tr></tfoot></table>`;

const sectionRows = (s) => `
  <tr><th colspan="3">${esc(s.label)}</th></tr>
  ${s.rows.map((r) => `<tr><td class="mono">${r.code}</td><td>${esc(r.name)}</td><td class="num">${usd(r.amountMinor)}</td></tr>`).join("") || `<tr><td></td><td class="muted">None</td><td></td></tr>`}
  <tr><td></td><td><strong>Total ${esc(s.label.toLowerCase())}</strong></td><td class="num"><strong>${usd(s.totalMinor)}</strong></td></tr>`;
const totalRow = (label, minor) => `<tr><td></td><td><strong>${label}</strong></td><td class="num"><strong>${usd(minor)}</strong></td></tr>`;

async function reportsView(id) {
  await loadEntity(id);
  reportDefaults();
  const [path, q] = reportQuery();
  const range = ["pl", "gl", "st"].includes(rep.tab);
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
  } else if (rep.tab === "st") {
    const r = await api(entPath(`${path}?${q}`));
    const line = (label, minor, note = "") => `<tr><td>${label}${note ? `<div class="hash">${note}</div>` : ""}</td><td class="num">${usd(minor)}</td></tr>`;
    body = `<p class="muted">The figures for your CDTFA sales and use tax return, from invoices and bills dated in this period. TrailBook prepares them; you or your accountant file and pay on the CDTFA's site.</p>
      <table><tbody>
        ${line("Total sales", r.totalSalesMinor, "All invoiced sales before tax")}
        ${r.nontaxable.map((n) => line(`Less nontaxable: ${esc(n.label)}`, n.amountMinor)).join("")}
        ${line("Less sales for resale", r.resaleMinor, "To customers with a resale certificate on file")}
        ${line("Less sales delivered outside California", r.interstateMinor)}
        ${BigInt(r.directPayMinor) ? line("Less software to buyers who pay use tax directly", r.directPayMinor, "Customers with a use tax direct payment permit on file (SB 122)") : ""}
        ${BigInt(r.outsideCaUseMinor) ? line("Less software used outside California", r.outsideCaUseMinor, "The out-of-state share on multiple-points-of-use certificates") : ""}
      </tbody><tfoot>
        <tr><td>Taxable sales</td><td class="num">${usd(r.taxableMinor)}</td></tr>
        <tr><td>Sales tax charged on invoices</td><td class="num">${usd(r.taxMinor)}</td></tr>
      </tfoot></table>
      <h3>By tax area</h3>
      <table><thead><tr><th>Where</th><th class="num">Rate</th><th class="num">Invoices</th><th class="num">Taxable sales</th><th class="num">Tax</th></tr></thead>
      <tbody>${r.byJurisdiction.map((j) => `<tr><td>${esc(j.jurisdiction)}</td><td class="num">${j.ratePercent}%</td><td class="num">${j.invoices}</td><td class="num">${usd(j.taxableMinor)}</td><td class="num">${usd(j.taxMinor)}</td></tr>`).join("")
        || `<tr><td colspan="5" class="muted">No taxable sales in these dates.</td></tr>`}</tbody></table>
      <h3>Use tax on purchases</h3>
      <p class="muted">From bills where the vendor didn't charge California tax. On the return this is "purchases subject to use tax". Without a seller's permit, report it on a CDTFA use tax return or your California income tax return.</p>
      <table><tbody>
        ${line("Purchases subject to use tax", r.useTax.purchasesMinor)}
        ${line("Use tax owed", r.useTax.taxMinor)}
      </tbody></table>
      ${r.useTax.byJurisdiction.length ? `<table><thead><tr><th>Where</th><th class="num">Rate</th><th class="num">Bills</th><th class="num">Purchases</th><th class="num">Use tax</th></tr></thead>
      <tbody>${r.useTax.byJurisdiction.map((j) => `<tr><td>${esc(j.jurisdiction)}</td><td class="num">${j.ratePercent}%</td><td class="num">${j.bills}</td><td class="num">${usd(j.purchasesMinor)}</td><td class="num">${usd(j.taxMinor)}</td></tr>`).join("")}</tbody></table>` : ""}
      <p style="margin-top:12px">Sales and use tax owed per the books on ${longDate(r.to)}: <strong class="mono">${usd(r.payableMinor)}</strong></p>`;
  } else if (rep.tab === "gl") {
    const gl = await api(entPath(`${path}?${q}`));
    body = rep.account === "all"
      ? gl.ledgers.map((g) => `<h3>${g.account.code} · ${esc(g.account.name)}</h3>${ledgerTable(g)}`).join("") || `<p class="muted">No activity in these dates.</p>`
      : ledgerTable(gl);
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
        ${rep.tab === "gl" ? `<label>Account<select name="account" data-autosubmit><option value="all">All accounts</option>${state.entity.accounts.map((a) => `<option value="${a.code}" ${a.code === rep.account ? "selected" : ""}>${a.code} · ${esc(a.name)}</option>`).join("")}</select></label>` : ""}
        ${range
          ? `<label>Dates<select name="preset" data-autosubmit>${RANGE_PRESETS.map(([k, l]) => `<option value="${k}" ${rep.preset === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
             <label>From<input type="date" name="from" value="${rep.from}" required data-custom="preset"></label><label>To<input type="date" name="to" value="${rep.to}" required data-custom="preset"></label>`
          : `<label>As of<select name="asPreset" data-autosubmit>${ASOF_PRESETS.map(([k, l]) => `<option value="${k}" ${rep.asPreset === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
             <label>Date<input type="date" name="asOf" value="${rep.asOf}" required data-custom="asPreset"></label>`}
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

const FREQ_LABEL = { weekly: "Weekly", biweekly: "Every two weeks", semimonthly: "Twice a month", monthly: "Monthly" };
const FREQ_DAYS = { weekly: 7, biweekly: 14, semimonthly: 15, monthly: 30 };
const DEDUCTION_LABEL = { traditional401k: "401(k)", section125: "Health premium (pre-tax)", post_tax: "After-tax deduction" };
const pay = { employees: [], stateRates: {}, state: null, adding: false, workCities: [] };

/** A rate as a percentage without float noise: "0.034" reads as "3.4". */
const pct100 = (r) => String(Number((Number(r) * 100).toFixed(4)));

/** The state withholding certificate's fields: California's DE 4, an elected rate (Arizona A-4), or nothing where there's no income tax. */
function stateCertificateFields(e, v, sel) {
  const it = pay.state?.incomeTax ?? { method: "ca_method_b", certificate: "DE 4" };
  if (it.method === "ca_method_b") {
    return `<label>DE 4 filing status${sel("de4Status", [["single", "Single or married with two incomes"], ["married", "Married, one income"], ["hoh", "Head of household"]], e?.de4.filingStatus ?? "single")}</label>
      <label>DE 4 allowances<input name="de4Allowances" value="${v(e?.de4.regularAllowances ?? 1)}" inputmode="numeric"></label>
      <label>DE 4 extra each paycheck ($)<input name="de4Extra" value="${v(e?.de4.additionalWithholding)}" inputmode="decimal" placeholder="0"></label>`;
  }
  if (it.method === "elected_percent") {
    const sw = e?.stateWithholding ?? {};
    const pctLabel = (r) => `${pct100(r)}%`;
    const opts = [["", `Not filed (${pctLabel(it.defaultRate)})`], ...it.choices.map((r) => [r, pctLabel(r)])];
    return `<label>${esc(it.certificate)} rate${sel("swRate", opts, sw.rate ?? "")}</label>
      <label>${esc(it.certificate)} extra each paycheck ($)<input name="swExtra" value="${v(sw.additionalWithholding)}" inputmode="decimal" placeholder="0"></label>
      ${it.zeroAllowed ? `<label class="check"><input type="checkbox" name="swExempt" ${sw.exempt ? "checked" : ""}> Elected zero withholding for this year</label>` : ""}`;
  }
  if (it.method === "annual_formula") {
    const sw = e?.stateWithholding ?? {};
    if (!it.certificate) return `<p class="hash">${esc(pay.state.name)} withholding uses the filing status on the federal W-4; there's no state form.</p>`;
    const statuses = it.statuses.map((s) => [s.id, s.label]);
    const opts = it.statusFromW4 ? [["", "Same as the federal W-4"], ...statuses] : statuses;
    const status = sw.filingStatus ?? (it.statusFromW4 ? "" : it.noCertificateStatus);
    const counts = [sw.allowances ?? 0, sw.allowances2 ?? 0];
    return `<input type="hidden" name="swForm" value="1">
      ${statuses.length > 1 ? `<label>${esc(it.certificate)} status${sel("swStatus", opts, status)}</label>` : ""}
      ${it.allowances.map((label, i) => `<label>${esc(label)}<input name="swAllowances${i ? i + 1 : ""}" value="${v(counts[i])}" inputmode="numeric"></label>`).join("")}
      ${it.dollarAllowance ? `<label>${esc(it.dollarAllowance)}<input name="swAllowanceAmount" value="${v(sw.allowanceAmount)}" inputmode="decimal" placeholder="Leave blank to use the W-4"></label>` : ""}
      <label>${esc(it.certificate)} extra each paycheck ($)<input name="swExtra" value="${v(sw.additionalWithholding)}" inputmode="decimal" placeholder="0"></label>
      <label class="check"><input type="checkbox" name="swExempt" ${sw.exempt ? "checked" : ""}> Claimed exempt for this year</label>`;
  }
  if (it.method === "or_formula" || it.method === "ny_exact") {
    const sw = e?.stateWithholding ?? {};
    const statuses = [["single", "Single"], ["married", "Married"], ["married_single_rate", "Married, but withhold at the higher single rate"]];
    // Oregon withholds a flat rate without an OR-W-4; New York treats a missing IT-2104 as single with no allowances.
    const opts = it.method === "or_formula" ? [["", `Not filed (flat ${pct100(it.noCertificateRate)}%)`], ...statuses] : statuses;
    const status = e?.stateWithholding ? (sw.filingStatus ?? "single") : (it.method === "or_formula" && e ? "" : "single");
    return `<label>${esc(it.certificate)} status${sel("swStatus", opts, status)}</label>
      <label>${esc(it.certificate)} allowances<input name="swAllowances" value="${v(sw.allowances ?? 0)}" inputmode="numeric"></label>
      <label>${esc(it.certificate)} extra each paycheck ($)<input name="swExtra" value="${v(sw.additionalWithholding)}" inputmode="decimal" placeholder="0"></label>
      <label class="check"><input type="checkbox" name="swExempt" ${sw.exempt ? "checked" : ""}> Claimed exempt for this year</label>
      ${(pay.state?.localIncomeTaxes ?? []).map((l) => `<label class="check"><input type="checkbox" name="swLocal" value="${esc(l.id)}" ${sw.localities?.includes(l.id) ? "checked" : ""}> ${esc(l.label)}</label>`).join("")}`;
  }
  return `<p class="hash">${esc(pay.state?.name ?? "This state")} has no income tax on wages, so there's no state withholding form.</p>`;
}

/** Hours to two decimals at most: 2.6667 reads as 2.67. */
const hrs = (h) => String(Math.round(Number(h) * 100) / 100);

function payLabel(e) {
  return e.payType === "salary" ? `${usd(Math.round(Number(e.payRate) * 100))} a year` : `${usd(Math.round(Number(e.payRate) * 100))} an hour`;
}

function employeeForm(e = null) {
  const v = (x) => esc(x ?? "");
  const sel = (name, opts, cur) => `<select name="${name}">${opts.map(([k, l]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const ded = (kind) => e?.deductions.find((d) => d.kind === kind)?.amount ?? "";
  const o = e?.openingYtd ?? {};
  const hourly = e?.payType === "hourly";
  return `<form data-form="employee" ${e ? `data-id="${e.id}"` : ""}>
    <div class="grid">
      <label>Name<input name="name" value="${v(e?.name)}" required></label>
      <label>Email (optional)<input name="email" type="email" value="${v(e?.email)}"></label>
      <label>Hire date<input type="date" name="hireDate" value="${v(e?.hireDate ?? bookDate())}" required></label>
      ${e ? `<label>Last day (if they've left)<input type="date" name="terminationDate" value="${v(e.terminationDate)}"></label>` : ""}
      <label>Pay type${sel("payType", [["salary", "Salary"], ["hourly", "Hourly"]], e?.payType ?? "salary")}</label>
      <label><span data-pay-label>${hourly ? "Hourly rate ($)" : "Annual salary ($)"}</span><input name="payRate" value="${v(e?.payRate)}" inputmode="decimal" required placeholder="${hourly ? "25.00" : "65000"}"></label>
      <label>How often they're paid${sel("payFrequency", Object.entries(FREQ_LABEL), e?.payFrequency ?? "biweekly")}</label>
      ${pay.state?.wageAreas?.length ? `<label>Where they work${sel("workCity", pay.state.wageAreas.map((a, i) => [i === 0 ? "" : a, a]), e?.workCity ?? "")}<span class="hash">The minimum wage depends on the area.</span></label>`
        : pay.workCities.length || e?.workCity ? `<label>City where they work<input name="workCity" value="${v(e?.workCity)}" list="work-cities" placeholder="e.g. San Jose"><span class="hash">Some cities have a higher minimum wage than the state.</span></label>` : ""}
      <label data-only="hourly" ${hourly ? "" : "hidden"}>Usual hours each pay period<input name="usualHours" value="${v(e?.usualHours)}" inputmode="decimal" placeholder="80"></label>
      <label class="check" data-only="salary" ${hourly ? "hidden" : ""}><input type="checkbox" name="overtimeExempt" ${e ? (e.overtimeExempt ? "checked" : "") : "checked"}> Exempt from overtime</label>
      <label>Social Security number<input name="ssn" autocomplete="off" inputmode="numeric" placeholder="${e?.ssnLast4 ? `On file, ends ${e.ssnLast4}` : "123-45-6789"}"></label>
    </div>
    <h3>Home address <span class="muted">(for the W-2)</span></h3>
    <div class="row">
      <label>Street<input name="line1" value="${v(e?.address?.line1)}"></label>
      <label>City<input name="city" value="${v(e?.address?.city)}" style="width:140px"></label>
      <label>State<input name="state" value="${v(e?.address?.state ?? pay.state?.code ?? "CA")}" maxlength="2" style="width:56px"></label>
      <label>ZIP<input name="zip" value="${v(e?.address?.zip)}" inputmode="numeric" style="width:90px"></label>
    </div>
    <h3>Tax forms</h3>
    <div class="grid">
      <label>W-4 filing status${sel("w4Status", [["single_or_mfs", "Single or married filing separately"], ["mfj", "Married filing jointly"], ["hoh", "Head of household"]], e?.w4.filingStatus ?? "single_or_mfs")}</label>
      <label class="check"><input type="checkbox" name="w4Step2" ${e?.w4.step2Checked ? "checked" : ""}> W-4 step 2 box checked</label>
      <label>W-4 step 3 credits ($ a year)<input name="w4Step3" value="${v(e?.w4.step3Credits)}" inputmode="decimal" placeholder="0"></label>
      <label>W-4 step 4(a) other income ($ a year)<input name="w4Step4a" value="${v(e?.w4.step4aOtherIncome)}" inputmode="decimal" placeholder="0"></label>
      <label>W-4 step 4(b) deductions ($ a year)<input name="w4Step4b" value="${v(e?.w4.step4bDeductions)}" inputmode="decimal" placeholder="0"></label>
      <label>W-4 step 4(c) extra each paycheck ($)<input name="w4Step4c" value="${v(e?.w4.step4cExtraWithholding)}" inputmode="decimal" placeholder="0"></label>
      ${stateCertificateFields(e, v, sel)}
    </div>
    <h3>Direct deposit <span class="muted">(leave blank for a paper check)</span></h3>
    <div class="row">
      <label>Routing number<input name="ddRouting" value="${v(e?.directDeposit?.routing)}" inputmode="numeric" maxlength="9" placeholder="9 digits" style="width:120px"></label>
      <label>Account number<input name="ddAccount" autocomplete="off" inputmode="numeric" placeholder="${e?.directDeposit ? `On file, ends ${e.directDeposit.accountLast4}` : "From their voided check"}"></label>
      <label>Type${sel("ddType", [["checking", "Checking"], ["savings", "Savings"]], e?.directDeposit?.accountType ?? "checking")}</label>
    </div>
    <h3>Taken from each paycheck</h3>
    <div class="grid">
      <label>401(k) ($)<input name="k401" value="${v(ded("traditional401k"))}" inputmode="decimal" placeholder="0"></label>
      <label>Health premium, pre-tax ($)<input name="section125" value="${v(ded("section125"))}" inputmode="decimal" placeholder="0"></label>
      <label>After-tax deduction ($)<input name="postTax" value="${v(ded("post_tax"))}" inputmode="decimal" placeholder="0"></label>
      ${pay.state?.sickLeave === null ? "" : `<label>Sick leave balance (hours)<input name="sickBalanceHours" value="${v(e?.sickBalanceHours ?? "0")}" inputmode="decimal"></label>`}
    </div>
    <details ${o.wages ? "open" : ""}><summary>Paid earlier this year, before TrailBook</summary>
      <p class="hash">If you switched from another payroll service mid-year, enter this year's totals so far. They keep Social Security and unemployment taxes from going over their yearly limits, and they go on the W-2.</p>
      <div class="grid">
        <label>Year<input name="ytdYear" value="${v(o.year ?? bookDate().slice(0, 4))}" inputmode="numeric"></label>
        <label>Wages ($)<input name="ytdWages" value="${v(o.wages)}" inputmode="decimal" placeholder="0"></label>
        <label>Federal income tax withheld ($)<input name="ytdFit" value="${v(o.federalIncomeTax)}" inputmode="decimal" placeholder="0"></label>
        <label>Social Security withheld ($)<input name="ytdSs" value="${v(o.socialSecurityTax)}" inputmode="decimal" placeholder="0"></label>
        <label>Medicare withheld ($)<input name="ytdMed" value="${v(o.medicareTax)}" inputmode="decimal" placeholder="0"></label>
        ${pay.state?.incomeTax.method === "none" ? "" : `<label>${esc(pay.state?.code ?? "CA")} income tax withheld ($)<input name="ytdPit" value="${v(o.caIncomeTax)}" inputmode="decimal" placeholder="0"></label>`}
        ${(pay.state?.code ?? "CA") === "CA" ? `<label>CA SDI withheld ($)<input name="ytdSdi" value="${v(o.caSdi)}" inputmode="decimal" placeholder="0"></label>` : ""}
      </div>
    </details>
    <div class="row" style="margin-top:12px"><button type="submit">${e ? "Save" : "Add employee"}</button>
      <button type="button" class="secondary" data-action="${e ? "doc-toggle" : "emp-cancel"}" ${e ? `data-form="emp-edit" data-id="${e.id}"` : ""}>Cancel</button></div>
  </form>`;
}

/** The API body for an employee form. */
function employeeBody(f) {
  const d = formData(f);
  const body = {
    name: d.name, email: d.email, hireDate: d.hireDate, payType: d.payType, payRate: d.payRate.replace(/[$,\s]/g, ""), payFrequency: d.payFrequency,
    usualHours: d.payType === "hourly" ? d.usualHours : "", overtimeExempt: d.payType === "salary" && f.querySelector("[name=overtimeExempt]").checked,
    address: addressOf(d), ...(d.workCity !== undefined ? { workCity: d.workCity.trim() } : {}),
    w4: { filingStatus: d.w4Status, step2Checked: f.querySelector("[name=w4Step2]").checked, step3Credits: d.w4Step3, step4aOtherIncome: d.w4Step4a, step4bDeductions: d.w4Step4b, step4cExtraWithholding: d.w4Step4c },
    ...(d.de4Status ? { de4: { filingStatus: d.de4Status, regularAllowances: d.de4Allowances, additionalWithholding: d.de4Extra } } : {}),
    ...(d.swRate !== undefined ? { stateWithholding: { rate: d.swRate, additionalWithholding: d.swExtra, exempt: Boolean(f.querySelector("[name=swExempt]")?.checked) } } : {}),
    ...(d.swForm !== undefined ? { stateWithholding: {
      filingStatus: d.swStatus || undefined, allowances: d.swAllowances, allowances2: d.swAllowances2, additionalWithholding: d.swExtra,
      allowanceAmount: d.swAllowanceAmount?.replace(/[$,\s]/g, "") || undefined, exempt: Boolean(f.querySelector("[name=swExempt]")?.checked),
    } } : d.swStatus !== undefined ? { stateWithholding: d.swStatus
      ? { filingStatus: d.swStatus, allowances: d.swAllowances, additionalWithholding: d.swExtra, exempt: Boolean(f.querySelector("[name=swExempt]")?.checked),
          localities: [...f.querySelectorAll("[name=swLocal]:checked")].map((i) => i.value) }
      : null } : {}),
    deductions: [{ kind: "traditional401k", amount: d.k401 }, { kind: "section125", amount: d.section125 }, { kind: "post_tax", amount: d.postTax }],
    openingYtd: d.ytdWages ? { year: d.ytdYear, wages: d.ytdWages, federalIncomeTax: d.ytdFit, socialSecurityTax: d.ytdSs, medicareTax: d.ytdMed, caIncomeTax: d.ytdPit, caSdi: d.ytdSdi } : null,
  };
  body.sickBalanceHours = d.sickBalanceHours || "0";
  if (d.terminationDate !== undefined) body.terminationDate = d.terminationDate;
  if (d.ssn.trim()) body.ssn = d.ssn.trim();
  const routing = d.ddRouting.replace(/\s/g, "");
  if (routing) body.directDeposit = { routing, accountType: d.ddType, ...(d.ddAccount.trim() ? { account: d.ddAccount.trim() } : {}) };
  else if (f.dataset.id && f.querySelector("[name=ddAccount]").placeholder.startsWith("On file")) body.directDeposit = null;
  return body;
}

/** Where the next pay period starts: the day after the last one, or two weeks back from today. */
function nextPeriod(payRuns) {
  const freq = pay.employees.find((e) => e.status === "active")?.payFrequency ?? "biweekly";
  const last = payRuns.map((r) => r.result.periodEnd).sort().at(-1);
  const start = last ? plusDays(last, 1) : plusDays(bookDate(), -(FREQ_DAYS[freq] - 1));
  const end = plusDays(start, FREQ_DAYS[freq] - 1);
  return { start, end, payDate: plusDays(end, 5) };
}

function runLine(e) {
  const hours = (name, v = "") => `<input data-line="${name}" value="${esc(v)}" inputmode="decimal" style="width:64px" placeholder="0">`;
  return `<tr data-emp-line="${e.id}">
    <td style="white-space:nowrap"><label class="check" style="flex-direction:row;align-items:center;justify-content:flex-start;gap:6px"><input type="checkbox" data-line="include" checked> ${esc(e.name)}</label><div class="hash">${payLabel(e)}</div></td>
    ${e.payType === "hourly" ? `<td>${hours("regularHours", e.usualHours ?? "")}</td><td>${hours("overtimeHours")}</td><td>${hours("doubleTimeHours")}</td>
      <td><button class="link" data-action="daily-toggle" data-id="${e.id}">Daily hours</button></td>` : `<td colspan="4" class="muted">Salary: ${usd(Math.round(Number(e.payRate) * 100 / { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 }[e.payFrequency]))} this period</td>`}
    <td>${hours("sickHoursUsed")}</td>
    <td>${hours("bonus")}<label class="check hash" title="Given at your sole discretion, not promised or tied to hours, sales or performance; it adds no overtime"><input type="checkbox" data-line="bonusDiscretionary"> discretionary</label></td>
    <td>${hours("commission")}</td><td>${hours("reimbursement")}</td>
  </tr>
  ${e.payType === "hourly" ? `<tr hidden data-daily="${e.id}"><td colspan="9">
    <p class="hash">Hours each day, two workweeks. ${pay.state?.overtime?.dailyAfter
      ? `${esc(pay.state.name)} overtime is worked out from these: over ${esc(pay.state.overtime.dailyAfter)} in a day, over ${esc(pay.state.overtime.weeklyAfter)} in a week${pay.state.overtime.seventhDayDoubleTimeAfter ? ", and the seventh day in a row" : ""}.`
      : `Overtime is worked out from these: over ${esc(pay.state?.overtime?.weeklyAfter ?? "40")} hours in a week.`}</p>
    <div class="row">${Array.from({ length: 14 }, (_, d) => `<label>${d < 7 ? "Wk 1" : "Wk 2"} day ${(d % 7) + 1}<input data-day="${d}" style="width:56px" inputmode="decimal"></label>`).join("")}</div>
  </td></tr>` : ""}`;
}

function payRunBody() {
  const lines = [...document.querySelectorAll("[data-emp-line]")].flatMap((row) => {
    if (!row.querySelector("[data-line=include]").checked) return [];
    const val = (k) => row.querySelector(`[data-line=${k}]`)?.value.trim() ?? "";
    const line = { employeeId: row.dataset.empLine, regularHours: val("regularHours"), overtimeHours: val("overtimeHours"), doubleTimeHours: val("doubleTimeHours"), bonus: val("bonus"), bonusDiscretionary: Boolean(row.querySelector("[data-line=bonusDiscretionary]")?.checked), commission: val("commission"), reimbursement: val("reimbursement"), sickHoursUsed: val("sickHoursUsed") };
    const daily = document.querySelector(`tr[data-daily="${row.dataset.empLine}"]`);
    if (daily && !daily.hidden) line.dailyHours = [...daily.querySelectorAll("[data-day]")].map((i) => i.value.trim() || "0");
    return [line];
  });
  return {
    periodStart: document.querySelector("[name=periodStart]").value,
    periodEnd: document.querySelector("[name=periodEnd]").value,
    payDate: document.querySelector("[name=payDate]").value,
    lines,
  };
}

function runTable(run) {
  const taxCodes = [...new Set(run.paychecks.flatMap((p) => p.taxes.map((t) => t.code)))];
  const paidBy = new Map(run.paychecks.flatMap((p) => p.taxes.map((t) => [t.code, t.paidBy])));
  const ee = taxCodes.filter((c) => paidBy.get(c) === "employee");
  const er = taxCodes.filter((c) => !ee.includes(c));
  const amt = (p, c) => usd(p.taxes.find((t) => t.code === c)?.amountMinor ?? 0);
  const issues = run.paychecks.flatMap((p) => [...p.blockers.map((b) => ["bad", `${p.name}: ${b}`]), ...p.warnings.map((w) => ["warn", `${p.name}: ${w}`])]);
  return `
    ${issues.map(([k, m]) => `<div class="alert ${k}">${k === "bad" ? "Must fix before approval: " : ""}${esc(m)}</div>`).join("")}
    <div class="table-wrap"><table>
      <thead><tr><th>Employee</th><th class="num">Gross</th>${ee.map((c) => `<th class="num">${esc(taxLabel(c))}</th>`).join("")}<th class="num">Deductions</th><th class="num">Net pay</th></tr></thead>
      <tbody>${run.paychecks.map((p) => `<tr><td>${esc(p.name)}${p.earnings.map((e) => `<div class="hash">${e.code.toLowerCase().replace("_", " ")}${e.hours ? ` ${e.hours}h @ $${Number(e.rate).toFixed(2)}` : ""}: ${usd(e.amountMinor)}</div>`).join("")}${p.sickLeave ? `<div class="hash">sick leave ${p.sickLeave.grantedHours ? `${hrs(p.sickLeave.grantedHours)}h granted for the year, ` : ""}+${hrs(p.sickLeave.accruedHours)}h earned, ${hrs(p.sickLeave.usedHours ?? 0)}h taken, balance ${hrs(p.sickLeave.balanceHours)}h</div>` : ""}</td>
        <td class="num">${usd(p.grossMinor)}</td>${ee.map((c) => `<td class="num">${amt(p, c)}</td>`).join("")}
        <td class="num">${usd(p.deductions.reduce((s, d) => s + BigInt(d.amountMinor), 0n))}</td><td class="num"><strong>${usd(p.netPayMinor)}</strong></td></tr>`).join("")}</tbody>
    </table></div>
    <h3>Employer taxes</h3>
    <div class="table-wrap"><table>
      <thead><tr><th>Employee</th>${er.map((c) => `<th class="num">${esc(taxLabel(c))}</th>`).join("")}<th class="num">Total</th></tr></thead>
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

async function payrollView(id) {
  await loadEntity(id);
  const [{ employees, stateRates, state: st, directDeposit, workCities, sickLeavePolicy }, { payRuns, soleApprover }, deposits] = await Promise.all([api(entPath("/employees")), api(entPath("/pay-runs")), api(entPath("/tax-deposits"))]);
  pay.employees = employees;
  pay.stateRates = stateRates ?? {};
  pay.state = st;
  pay.workCities = workCities ?? [];
  const agencies = ["IRS", ...(st?.agencies ?? ["EDD"])];
  const sick = st?.sickLeave;
  const canSetUpBank = ["owner", "admin", "accountant"].includes(state.org.role);
  const me = `user:${state.me.user.email}`;
  const canApprove = ["owner", "admin", "approver"].includes(state.org.role);
  const canWrite = ["owner", "admin", "bookkeeper", "accountant"].includes(state.org.role);
  const active = employees.filter((e) => e.status === "active");
  const next = nextPeriod(payRuns);
  app.innerHTML = shell("payroll", `
    <div class="head"><div><h1>Payroll</h1><p class="muted">TrailBook works out pay, taxes and deductions, makes pay stubs and posts payroll to the books. You pay employees from your own bank and file and pay the taxes with the ${esc(agencies.join(", ").replace(/, ([^,]*)$/, " and $1"))} yourself.</p></div>
      <div class="row"><a class="btn secondary" href="#/e/${id}/payroll/forms">Tax forms</a></div></div>
    <div class="panel">
      <div class="row" style="justify-content:space-between"><h2>Employees</h2>${canWrite && !pay.adding ? `<button data-action="emp-add">+ Add employee</button>` : ""}</div>
      ${pay.adding ? `<div class="emp">${employeeForm()}</div>` : ""}
      <div class="table-wrap"><table>
        <thead><tr><th>Name</th><th>Pay</th><th>Paid</th><th>Status</th><th></th></tr></thead>
        <tbody>${employees.map((e) => `<tr class="${e.status === "active" ? "" : "muted"}"><td>${esc(e.name)}${e.ssnLast4 ? `<div class="hash">SSN ends ${e.ssnLast4}</div>` : `<div class="hash">No SSN on file yet</div>`}<div class="hash">${e.directDeposit ? `Direct deposit to ${e.directDeposit.accountType} ending ${esc(e.directDeposit.accountLast4)}` : "Paid by check"}</div></td>
            <td>${payLabel(e)}${e.payType === "salary" && !e.overtimeExempt ? `<div class="hash">gets overtime</div>` : ""}${e.belowLocalMinimum ? `<div class="alert warn">Below the ${esc(e.belowLocalMinimum.place)} minimum wage of ${usd(Math.round(Number(e.belowLocalMinimum.rate) * 100))} an hour</div>` : ""}</td><td>${FREQ_LABEL[e.payFrequency]}</td>
            <td>${e.status === "active" ? `<span class="pill">Active</span>` : `<span class="pill grey">Left ${e.terminationDate}</span>`}</td>
            <td>${canWrite ? `<button class="link" data-action="doc-toggle" data-form="emp-edit" data-id="${e.id}">Edit</button>` : ""}</td></tr>
          ${canWrite ? `<tr hidden data-emp-edit="${e.id}"><td colspan="5">${employeeForm(e)}</td></tr>` : ""}`).join("") || `<tr><td colspan="5" class="muted">No employees yet. Add the people you pay to run payroll.</td></tr>`}</tbody>
      </table></div>
      <datalist id="work-cities">${pay.workCities.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
      ${(st?.assignedRates ?? []).map((r) => `<form data-form="ui-rate" data-code="${esc(r.code)}" class="row" style="margin-top:12px">
        <label>${esc(r.label)}<input name="ratePercent" value="${pay.stateRates[r.code] ? esc(pct100(pay.stateRates[r.code])) : ""}" placeholder="${esc(pct100(r.newEmployerRate))} (new employer)" style="width:170px" ${canWrite ? "" : "disabled"}></label>
        ${canWrite ? `<button type="submit" class="secondary">Save rate</button>` : ""}
        <span class="hash">${esc(r.hint)}</span>
      </form>`).join("")}
      ${sick ? `<form data-form="sick-policy" class="row" style="margin-top:12px">
        <label>Paid sick leave<select name="sickLeavePolicy" ${["owner", "admin", "accountant"].includes(state.org.role) ? "" : "disabled"}>
          <option value="accrual" ${sickLeavePolicy !== "front_load" ? "selected" : ""}>Accrual: 1 hour per ${esc(sick.hoursWorkedPerHourAccrued)} worked${sick.accrualCapHours ? `, up to ${esc(sick.accrualCapHours)}` : ", no cap"}</option>
          <option value="front_load" ${sickLeavePolicy === "front_load" ? "selected" : ""}>Front-load: ${esc(sick.annualUseCapHours)} hours at the start of each year</option>
        </select></label>
        ${["owner", "admin", "accountant"].includes(state.org.role) ? `<button type="submit" class="secondary">Save</button>` : ""}
        <span class="hash">${esc(st.name)} requires at least ${esc(sick.annualUseCapHours)} hours a year${sick.smallEmployer ? ` (${esc(sick.smallEmployer.annualUseCapHours)} for employers with fewer than ${sick.smallEmployer.under} employees)` : ""}. Salaried exempt employees accrue as if they work 40 hours a week. Front-loaded hours don't carry over.</span>
      </form>` : `<p class="hash" style="margin-top:12px">${esc(st?.name ?? "")} has no statewide paid sick leave law, so TrailBook doesn't track sick hours.</p>`}
    </div>
    ${taxDepositsPanel(deposits, canWrite, canSetUpBank)}
    ${directDepositPanel(directDeposit, canSetUpBank)}
    ${canWrite && active.length ? `<div class="panel">
      <h2>Run payroll</h2>
      <div class="row" style="margin-bottom:12px">
        <label>Period start<input type="date" name="periodStart" value="${next.start}"></label>
        <label>Period end<input type="date" name="periodEnd" value="${next.end}"></label>
        <label>Pay date<input type="date" name="payDate" value="${next.payDate}"></label>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Employee</th><th>Hours</th><th>Overtime</th><th>Double time</th><th></th><th>Sick hours taken</th><th>Bonus ($)</th><th>Commission ($)</th><th>Reimbursement ($)</th></tr></thead>
        <tbody id="run-lines">${active.map(runLine).join("")}</tbody>
      </table></div>
      <div class="row" style="margin-top:12px">
        <button data-action="preview-run">Calculate</button>
        <button data-action="save-run" disabled>Send for approval</button>
      </div>
      <div id="preview" style="margin-top:16px"></div>
    </div>` : ""}
    <div class="panel">
      <h2>Pay runs</h2>
      <p class="muted">A pay run posts to the books only after it's approved: by someone other than its preparer, unless you're the only person here who can approve.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Pay date</th><th>Period</th><th>Employees</th><th class="num">Gross</th><th class="num">Net</th><th>Prepared by</th><th>Status</th><th></th></tr></thead>
        <tbody>${payRuns.map((r) => `<tr>
          <td><a href="#/e/${id}/payroll/run/${r.id}">${r.result.payDate}</a></td><td>${r.result.periodStart} to ${r.result.periodEnd}</td><td>${r.result.paychecks.length}</td>
          <td class="num">${usd(r.result.totals.grossMinor)}</td><td class="num">${usd(r.result.totals.netPayMinor)}</td>
          <td>${esc(r.prepared_by.replace("user:", ""))}</td>
          <td><span class="${STATUS_PILL[r.status]}">${STATUS_LABEL[r.status]}</span>${r.approved_by ? `<div class="hash">by ${esc(r.approved_by.replace("user:", ""))}</div>` : ""}</td>
          <td><a href="#/e/${id}/payroll/run/${r.id}">Pay stubs</a>
            ${r.status === "prepared" && canApprove ? (r.prepared_by === me && !soleApprover ? `<div class="muted">Needs another approver</div>` : `<div><button data-action="approve-run" data-id="${r.id}">Approve and post</button></div>`) : ""}</td>
        </tr>`).join("") || `<tr><td colspan="8" class="muted">No pay runs yet.</td></tr>`}</tbody>
      </table></div>
    </div>`);
}

const DEPOSIT_STATUS = {
  overdue: ["pill bad", "Late"], due_soon: ["pill warn", "Due soon"], upcoming: ["pill grey", "Upcoming"], paid: ["pill", "Paid"],
};

function taxDepositsPanel(t, canPay, canSet) {
  const open = t.deposits.filter((d) => d.status !== "paid");
  const paid = t.deposits.filter((d) => d.status === "paid");
  const row = (d) => `<tr>
    <td style="white-space:nowrap">${esc(d.dueDate)}</td>
    <td><strong>${d.agency}</strong> · ${esc(d.what)}<div class="hash">${esc(d.period)}. ${esc(d.rule)}.</div>${d.note && d.status !== "paid" ? `<div class="hash">${esc(d.note)}</div>` : ""}</td>
    <td class="num">${usd(d.status === "paid" ? d.amountMinor : d.remainingMinor)}${BigInt(d.paidMinor) && d.status !== "paid" ? `<div class="hash">${usd(d.paidMinor)} paid</div>` : ""}</td>
    <td><span class="${DEPOSIT_STATUS[d.status][0]}">${DEPOSIT_STATUS[d.status][1]}</span>${d.payments.map((p) => `<div class="hash">Paid ${esc(p.paidDate)}${p.confirmation ? ` · ${esc(p.confirmation)}` : ""}</div>`).join("")}</td>
    <td>${canPay && d.status !== "paid" ? `<button class="link" data-action="doc-toggle" data-form="dep-pay" data-id="${esc(d.key)}">Record payment</button>` : ""}</td>
  </tr>
  ${canPay && d.status !== "paid" ? `<tr hidden data-dep-pay="${esc(d.key)}"><td colspan="5">
    <form data-form="dep-pay" data-key="${esc(d.key)}" class="row">
      <span class="muted">Pay ${usd(d.remainingMinor)} through ${esc(d.where)} first, then record it here.</span>
      <label>Paid on<input type="date" name="paidDate" value="${t.today}" max="${t.today}" required></label>
      <label>From<select name="bankAccount">${bankOptions()}</select></label>
      <label>Confirmation number (optional)<input name="confirmation" maxlength="60" style="width:160px"></label>
      <button type="submit">Record payment</button>
    </form></td></tr>` : ""}`;
  return `<div class="panel">
    <h2>Tax deposits</h2>
    <p class="muted">What each approved pay run owes the IRS and the state, and when. Pay through EFTPS (or IRS Direct Pay) and the state agency's online service, then record each payment here so your books show it. TrailBook emails a reminder a few days before each due date.</p>
    <form data-form="deposit-schedule" class="row" style="margin-bottom:12px">
      <label>Federal deposit schedule<select name="federalDepositSchedule" ${canSet ? "" : "disabled"}>
        <option value="monthly" ${t.federalSchedule === "monthly" ? "selected" : ""}>Monthly</option>
        <option value="semiweekly" ${t.federalSchedule === "semiweekly" ? "selected" : ""}>Semiweekly</option></select></label>
      ${canSet ? `<button type="submit" class="secondary">Save</button>` : ""}
      <span class="hash">New employers are monthly. After that, you're semiweekly if your Form 941 taxes from July two years ago through last June were over $50,000. The IRS tells you which in its fall notice.</span>
    </form>
    <div class="table-wrap"><table>
      <thead><tr><th>Due</th><th>What</th><th class="num">Amount</th><th>Status</th><th></th></tr></thead>
      <tbody>${open.map(row).join("") || `<tr><td colspan="5" class="muted">Nothing to pay right now. Deposits show up here once a pay run is approved.</td></tr>`}</tbody>
    </table></div>
    ${paid.length ? `<details style="margin-top:8px"><summary>Paid this year (${paid.length})</summary><div class="table-wrap"><table><tbody>${paid.map(row).join("")}</tbody></table></div></details>` : ""}
  </div>`;
}

function directDepositPanel(dd, canEdit) {
  const v = (x) => esc(x ?? "");
  return `<div class="panel">
    <div class="row" style="justify-content:space-between"><h2>Direct deposit</h2>${dd ? `<span class="pill">Set up</span>` : ""}</div>
    <p class="muted">After a pay run is approved, download its bank file and upload it to your bank's ACH or direct-deposit page. Your bank moves the money; TrailBook never does.
      Ask your bank for ACH origination if it isn't turned on; they'll give you the details below.</p>
    ${dd ? `<p>${esc(dd.destinationName)}, routing ${esc(dd.odfiRouting)}, company ID ${esc(dd.companyId)}, shown to employees as <strong>${esc(dd.companyName)}</strong>.${dd.balanced ? ` Balanced file, taken from account ending ${esc(dd.accountLast4)}.` : ""}</p>` : ""}
    ${canEdit ? `<details ${dd ? "" : "open"}><summary>${dd ? "Change bank details" : "Add your bank details"}</summary>
      <form data-form="dd-settings">
        <div class="grid">
          <label>Your bank's name<input name="destinationName" value="${v(dd?.destinationName)}" maxlength="23" required placeholder="Bank of America"></label>
          <label>Your business account's routing number<input name="odfiRouting" value="${v(dd?.odfiRouting)}" inputmode="numeric" maxlength="9" required placeholder="9 digits"></label>
          <label>Name on employees' bank statements<input name="companyName" value="${v(dd?.companyName ?? (state.entity.entity.legalName ?? "").slice(0, 16))}" maxlength="16"></label>
        </div>
        <details><summary>Details from your bank (only if they gave you different ones)</summary>
          <p class="hash">Most banks use "1" followed by your EIN for both IDs, and their own routing number as the destination. Leave these blank to use that.</p>
          <div class="grid">
            <label>Company ID<input name="companyId" value="${v(dd?.companyId)}" maxlength="10"></label>
            <label>Immediate origin<input name="immediateOrigin" value="${v(dd?.immediateOrigin)}" maxlength="10"></label>
            <label>Immediate destination<input name="immediateDestination" value="${v(dd?.immediateDestination)}" maxlength="9"></label>
            <label class="check"><input type="checkbox" name="balanced" ${dd?.balanced ? "checked" : ""}> My bank wants a balanced file (adds a debit from my account)</label>
            <label>Business account number (balanced files only)<input name="account" autocomplete="off" placeholder="${dd?.accountLast4 ? `On file, ends ${esc(dd.accountLast4)}` : ""}"></label>
            <label>Account type<select name="accountType"><option value="checking">Checking</option><option value="savings" ${dd?.accountType === "savings" ? "selected" : ""}>Savings</option></select></label>
          </div>
        </details>
        <div class="row" style="margin-top:12px"><button type="submit" class="secondary">Save bank details</button></div>
      </form></details>` : ""}
  </div>`;
}

/** Who gets a deposit and who gets a check, with the download, once a run is posted. */
function payEmployeesPanel(r) {
  const dd = r.directDeposit;
  if (!dd || r.status !== "posted") return "";
  const canDownload = ["owner", "admin", "approver", "accountant"].includes(state.org.role);
  return `<div class="panel no-print">
    <h2>Pay your employees</h2>
    ${dd.warnings.map((w) => `<div class="alert warn">${esc(w)}</div>`).join("")}
    ${dd.deposits.length ? `<p>Direct deposit, ${usd(dd.totalMinor)} in all:</p><ul>${dd.deposits.map((d) => `<li>${esc(d.name)}: ${usd(d.amountMinor)} to ${d.accountType} ending ${esc(d.accountLast4)}</li>`).join("")}</ul>` : ""}
    ${dd.paperChecks.length ? `<p>Write a paper check for:</p><ul>${dd.paperChecks.map((c) => `<li>${esc(c.name)}: ${usd(c.amountMinor)}</li>`).join("")}</ul>` : ""}
    ${dd.ready && canDownload ? `<div class="row"><button data-action="dd-download" data-id="${r.id}">Download direct deposit file</button>
      <span class="muted">Upload it to your bank at least two business days before ${esc(r.result.payDate)} so the money lands on time.</span></div>`
      : dd.problem && dd.deposits.length ? `<p class="muted">To make the bank file, ${esc(dd.problem)}${dd.problem.startsWith("add") ? ` on the <a href="#/e/${state.entity.entity.id}/payroll">Payroll page</a>` : ""}.</p>` : ""}
  </div>`;
}

function stubCard(r, c, s) {
  const y = s?.ytd ?? { grossMinor: 0, netPayMinor: 0, byTax: {}, byDeduction: {} };
  const eeTaxes = c.taxes.filter((t) => t.paidBy === "employee");
  // Hours worked (Labor Code 226(a)(2)): sick leave taken is paid but isn't time worked.
  const hours = c.earnings.filter((e) => e.code !== "SICK").reduce((n, e) => n + Number(e.hours ?? 0), 0);
  const addr = (a) => (a ? `${esc(a.line1)}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}` : "");
  return `<div class="panel stub">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div><strong>${esc(r.employer.name)}</strong><div class="hash">${addr(r.employer.address) || "Add the business address on the Overview page"}</div></div>
      <div style="text-align:right"><strong>Pay stub</strong><div class="hash">Pay date ${r.result.payDate}<br>Period ${r.result.periodStart} to ${r.result.periodEnd}</div></div>
    </div>
    <div class="row" style="margin:12px 0"><div><strong>${esc(c.name)}</strong><div class="hash">${s?.ssnLast4 ? `SSN xxx-xx-${s.ssnLast4}` : `Employee ID ${esc(c.employeeId.slice(0, 8))}`}${s?.address ? `<br>${addr(s.address)}` : ""}</div></div></div>
    <table>
      <thead><tr><th>Earnings</th><th class="num">Hours</th><th class="num">Rate</th><th class="num">This period</th><th class="num">Year to date</th></tr></thead>
      <tbody>${c.earnings.map((e) => `<tr><td>${e.code.charAt(0) + e.code.slice(1).toLowerCase().replace("_", " ")}</td><td class="num">${e.hours ?? ""}</td><td class="num">${e.rate ? `$${Number(e.rate).toFixed(2)}` : ""}</td><td class="num">${usd(e.amountMinor)}</td><td></td></tr>`).join("")}
        <tr><td><strong>Gross pay</strong></td><td class="num">${hours || ""}</td><td></td><td class="num"><strong>${usd(c.grossMinor)}</strong></td><td class="num">${usd(y.grossMinor)}</td></tr></tbody>
      <thead><tr><th colspan="3">Taxes withheld</th><th class="num"></th><th class="num"></th></tr></thead>
      <tbody>${eeTaxes.map((t) => `<tr><td colspan="3">${esc(taxLabel(t.code, r.taxLabels))}</td><td class="num">${usd(t.amountMinor)}</td><td class="num">${usd(y.byTax[t.code] ?? 0)}</td></tr>`).join("")}</tbody>
      ${c.deductions.length ? `<thead><tr><th colspan="5">Deductions</th></tr></thead><tbody>${c.deductions.map((d) => `<tr><td colspan="3">${esc(d.description)}</td><td class="num">${usd(d.amountMinor)}</td><td class="num">${usd(y.byDeduction[d.kind] ?? 0)}</td></tr>`).join("")}</tbody>` : ""}
      <tbody>${BigInt(c.reimbursementMinor) ? `<tr><td colspan="3">Expense reimbursement (not taxed)</td><td class="num">${usd(c.reimbursementMinor)}</td><td></td></tr>` : ""}
        <tr><td colspan="3"><strong>Net pay</strong></td><td class="num"><strong>${usd(c.netPayMinor)}</strong></td><td class="num">${usd(y.netPayMinor)}</td></tr></tbody>
    </table>
    ${c.sickLeave ? `<p class="hash">Paid sick leave: ${c.sickLeave.grantedHours ? `${hrs(c.sickLeave.grantedHours)} hours granted for the year, ` : ""}${hrs(c.sickLeave.accruedHours)} hours earned and ${hrs(c.sickLeave.usedHours ?? 0)} taken this period, ${hrs(c.sickLeave.balanceHours)} hours available.</p>` : ""}
  </div>`;
}

async function formsView(id, yearParam) {
  await loadEntity(id);
  const year = Number(yearParam) || Number(bookDate().slice(0, 4));
  const t = await api(entPath(`/payroll-forms?year=${year}`));
  const canSet = ["owner", "admin", "accountant"].includes(state.org.role);
  const acct = t.stateEmployerAccount;
  const ea = t.employerAccount ?? { label: "EDD employer payroll tax account number", hint: "", format: "###-####-#" };
  let i = 0;
  const shown = acct && ea.format && ea.format.replace(/[^#]/g, "").length === acct.length ? ea.format.replace(/#/g, () => acct[i++]) : acct;
  app.innerHTML = shell("payroll", `
    <div class="head"><div><p><a href="#/e/${id}/payroll">&larr; Payroll</a></p><h1>Payroll tax forms</h1>
      <p class="muted">Each form's figures come from approved pay runs and the deposits you've recorded. Copy them into the filing site (or hand them to your accountant), check them, and sign. TrailBook doesn't file anything.</p></div>
      <div class="row"><a class="btn secondary" href="#/e/${id}/payroll/forms/${year - 1}">${year - 1}</a>${year < Number(bookDate().slice(0, 4)) ? `<a class="btn secondary" href="#/e/${id}/payroll/forms/${year + 1}">${year + 1}</a>` : ""}</div></div>
    <div class="panel">
      <form data-form="edd-account" class="row" style="margin-bottom:12px">
        <label>${esc(ea.label)}<input name="stateEmployerAccount" value="${esc(shown ?? "")}" placeholder="${esc(ea.format ? (() => { let n = 0; return ea.format.replace(/#/g, () => "1234567890"[n++ % 10]); })() : "")}" style="width:160px" ${canSet ? "" : "disabled"}></label>
        ${canSet ? `<button type="submit" class="secondary">Save</button>` : ""}
        <span class="hash">${esc(ea.hint)}</span>
      </form>
      <div class="table-wrap"><table>
        <thead><tr><th>Form</th><th>Period</th><th>Due</th><th></th></tr></thead>
        <tbody>${t.forms.map((f) => `<tr><td>${esc(f.form)}</td><td>${esc(f.period)}</td><td>${esc(f.dueDate)}</td>
          <td><a href="#/e/${id}/payroll/form/${f.slug}/${f.year}${f.quarter ? `/${f.quarter}` : ""}">Open</a></td></tr>`).join("")}</tbody>
      </table></div>
    </div>`);
}

const fmtLine = (l) => l.value === null ? `<span class="muted">${l.kind === "money" ? "blank" : ""}</span>` : l.kind === "money" ? usd(l.value) : esc(String(l.value));

/** "wagesMinor" reads as "Wages", "TX_UITaxableMinor" as "TX UI taxable". */
function columnLabel(k) {
  if (k === "ssn") return "SSN";
  if (k === "name") return "Employee";
  const m = k.match(/^([A-Z]{2,3}_[A-Z0-9_]+)(Taxable|Withheld)Minor$/);
  if (m) return `${m[1].replace(/_/g, " ")} ${m[2] === "Taxable" ? "taxable wages" : "withheld"}`;
  return { wagesMinor: "Wages", withheldMinor: "Withheld" }[k] ?? k;
}

async function formView(id, slug, year, quarter, fullSsn = false) {
  await loadEntity(id);
  const f = await api(entPath(`/payroll-forms/prepared?form=${slug}&year=${year}${quarter ? `&quarter=${quarter}` : ""}${fullSsn ? "&ssn=full" : ""}`));
  const canSee = ["owner", "admin", "accountant"].includes(state.org.role);
  const emp = f.employer;
  const head = `<div><strong>${esc(emp.name)}</strong>${emp.ein ? ` · EIN ${esc(emp.ein)}` : ""}${emp.address ? `<div class="hash">${esc(emp.address.line1)}, ${esc(emp.address.city)}, ${esc(emp.address.state)} ${esc(emp.address.zip)}</div>` : ""}</div>`;
  const rows = f.employees ?? [];
  const table = slug === "de9" ? `<h3>DE 9C wage detail</h3><div class="table-wrap"><table>
      <thead><tr><th>SSN</th><th>Employee</th><th class="num">Total subject wages</th><th class="num">PIT wages</th><th class="num">PIT withheld</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${esc(r.ssn ?? "missing")}</td><td>${esc(r.name)}</td><td class="num">${usd(r.subjectWagesMinor)}</td><td class="num">${usd(r.pitWagesMinor)}</td><td class="num">${usd(r.pitWithheldMinor)}</td></tr>`).join("")}</tbody></table></div>`
    : slug === "w2" ? rows.map((w) => `<div class="panel stub">
      <div class="row" style="justify-content:space-between"><div><strong>W-2 ${esc(f.period)}: ${esc(w.name)}</strong><div class="hash">SSN ${esc(w.ssn ?? "missing")}${w.address ? `<br>${esc(w.address.line1)}, ${esc(w.address.city)}, ${esc(w.address.state)} ${esc(w.address.zip)}` : ""}</div></div>${head}</div>
      <table><tbody>
        <tr><td>1 Wages, tips, other compensation</td><td class="num">${usd(w.box1)}</td><td>2 Federal income tax withheld</td><td class="num">${usd(w.box2)}</td></tr>
        <tr><td>3 Social security wages</td><td class="num">${usd(w.box3)}</td><td>4 Social security tax withheld</td><td class="num">${usd(w.box4)}</td></tr>
        <tr><td>5 Medicare wages and tips</td><td class="num">${usd(w.box5)}</td><td>6 Medicare tax withheld</td><td class="num">${usd(w.box6)}</td></tr>
        <tr><td>12</td><td colspan="3">${w.box12.map((b) => `${esc(b.code)} ${usd(b.amountMinor)}`).join(", ") || "—"}</td></tr>
        <tr><td>14 Other</td><td colspan="3">${w.box14.map((b) => `${esc(b.label)} ${usd(b.amountMinor)}`).join(", ") || "—"}</td></tr>
        ${w.box15 ? `<tr><td>15 State / employer's state ID</td><td>${esc(w.box15.state)} ${esc(w.box15.employerStateId ?? "missing")}</td><td>16 State wages</td><td class="num">${usd(w.box16)}</td></tr>
        <tr><td></td><td></td><td>17 State income tax</td><td class="num">${usd(w.box17)}</td></tr>` : `<tr><td>15 to 17</td><td colspan="3" class="muted">No state income tax</td></tr>`}
        ${(w.local ?? []).map((l) => `<tr><td>18 Local wages</td><td class="num">${usd(l.wagesMinor)}</td><td>19 Local income tax / 20 ${esc(l.locality)}</td><td class="num">${usd(l.taxMinor)}</td></tr>`).join("")}
      </tbody></table></div>`).join("")
    : rows.length ? `<h3>Wage detail</h3><div class="table-wrap"><table>
      <thead><tr>${Object.keys(rows[0]).map((k) => `<th class="${k.endsWith("Minor") ? "num" : ""}">${esc(columnLabel(k))}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${Object.entries(r).map(([k, v]) => `<td class="${k.endsWith("Minor") ? "num" : ""}">${k.endsWith("Minor") ? usd(v) : esc(v ?? "missing")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
    : "";
  app.innerHTML = shell("payroll", `
    <div class="head no-print"><div><p><a href="#/e/${id}/payroll/forms/${year}">&larr; Tax forms</a></p><h1>${esc(f.title)}</h1>
      <p class="muted">${esc(f.period)} · due ${esc(f.dueDate)}. ${esc(f.fileAt)}.</p></div>
      <div class="row"><button class="secondary" data-action="print">Print</button>
        ${rows.length ? `<button class="secondary" data-action="form-csv" data-slug="${slug}" data-year="${year}" data-quarter="${quarter ?? ""}">Download CSV</button>` : ""}
        ${rows.length && canSee && !fullSsn ? `<button class="secondary" data-action="form-ssn" data-slug="${slug}" data-year="${year}" data-quarter="${quarter ?? ""}">Show full SSNs</button>` : ""}</div></div>
    ${f.warnings.map((w) => `<div class="alert warn no-print">${esc(w)}</div>`).join("")}
    <div class="panel">
      ${head}
      <div class="table-wrap" style="margin-top:12px"><table>
        <thead><tr><th>Line</th><th>Description</th><th class="num">Amount</th></tr></thead>
        <tbody>${f.lines.map((l) => `<tr><td style="white-space:nowrap">${esc(l.line)}</td><td>${esc(l.label)}${l.note ? `<div class="hash">${esc(l.note)}</div>` : ""}</td><td class="num">${fmtLine(l)}</td></tr>`).join("")}</tbody>
      </table></div>
      ${f.liabilities?.length ? `<h3>Tax liability</h3><div class="table-wrap"><table><tbody>${f.liabilities.map((x) => `<tr><td>${esc(x.label)}</td><td class="num">${usd(x.amountMinor)}</td></tr>`).join("")}
        <tr><td><strong>Total</strong></td><td class="num"><strong>${usd(f.liabilities.reduce((s, x) => s + BigInt(x.amountMinor), 0n))}</strong></td></tr></tbody></table></div>` : ""}
      ${slug !== "w2" ? table : ""}
    </div>
    ${slug === "w2" ? table : ""}`);
}

// ------------------------------------------------------------- sales tax

async function salesTaxView(id, yearParam) {
  await loadEntity(id);
  const year = Number(yearParam) || Number(bookDate().slice(0, 4));
  const t = await api(entPath(`/sales-tax?year=${year}`));
  const canSet = ["owner", "admin", "accountant"].includes(state.org.role);
  const freq = Object.entries(t.frequencies).map(([k, l]) => `<option value="${k}" ${k === t.filingFrequency ? "selected" : ""}>${esc(l)}</option>`).join("");
  app.innerHTML = shell("sales-tax", `
    <div class="head"><div><h1>Sales tax returns</h1>
      <p class="muted">Your own California sales and use tax returns. The figures come from the invoices you've issued and the tax on each. Copy them into CDTFA online services (or hand them to your accountant), check them, and file. TrailBook doesn't file or pay anything.</p></div>
      <div class="row"><a class="btn secondary" href="#/e/${id}/sales-tax/${year - 1}">${year - 1}</a>${year <= Number(bookDate().slice(0, 4)) ? `<a class="btn secondary" href="#/e/${id}/sales-tax/${year + 1}">${year + 1}</a>` : ""}</div></div>
    <div class="panel">
      <form data-form="sales-tax-settings" class="row" style="margin-bottom:12px">
        <label>Seller's permit number<input name="sellerPermit" value="${esc(t.sellerPermit ?? "")}" placeholder="As on your permit" style="width:180px" ${canSet ? "" : "disabled"}></label>
        <label>How often you file<select name="filingFrequency" ${canSet ? "" : "disabled"}><option value="">Not set</option>${freq}</select></label>
        ${canSet ? `<button type="submit" class="secondary">Save</button>` : ""}
        <span class="hash">Both are on the permit the CDTFA sends you. You need a permit before you charge sales tax, and from January 1, 2027 that includes software and SaaS.</span>
      </form>
      ${t.filingFrequency ? `<div class="table-wrap"><table>
        <thead><tr><th>Period</th><th>Due</th><th></th></tr></thead>
        <tbody>${t.periods.map((r) => `<tr><td>${esc(r.label)}${r.prepayments ? `<div class="hash">Prepayments due ${r.prepayments.map((x) => esc(x.dueDate)).join(" and ")}</div>` : ""}</td><td>${esc(r.dueDate)}</td>
          <td><a href="#/e/${id}/sales-tax/return/${encodeURIComponent(r.key)}">Open</a></td></tr>`).join("") || `<tr><td colspan="3" class="muted">No periods in ${year} yet.</td></tr>`}</tbody>
      </table></div>` : `<p class="muted">Pick how often you file to see your return periods and due dates.</p>`}
    </div>`);
}

async function salesTaxReturnView(id, key) {
  await loadEntity(id);
  const f = await api(entPath(`/sales-tax/return?period=${encodeURIComponent(key)}`));
  const s = f.seller;
  app.innerHTML = shell("sales-tax", `
    <div class="head no-print"><div><p><a href="#/e/${id}/sales-tax/${f.period.from.slice(0, 4)}">&larr; Sales tax returns</a></p><h1>${esc(f.title)}</h1>
      <p class="muted">${esc(f.period.label)} (${esc(f.period.from)} to ${esc(f.period.to)}) · due ${esc(f.period.dueDate)}. ${esc(f.fileAt)}.</p></div>
      <div class="row"><button class="secondary" data-action="print">Print</button>
        <button class="secondary" data-action="st-range" data-from="${esc(f.period.from)}" data-to="${esc(f.period.to)}">Sales tax report</button></div></div>
    ${f.warnings.map((w) => `<div class="alert warn no-print">${esc(w)}</div>`).join("")}
    <div class="panel">
      <div><strong>${esc(s.name)}</strong> · seller's permit ${esc(s.sellerPermit ?? "not recorded")}${s.address ? `<div class="hash">${esc(s.address)}</div>` : ""}</div>
      <div class="table-wrap" style="margin-top:12px"><table>
        <thead><tr><th>Line</th><th>Description</th><th class="num">Amount</th></tr></thead>
        <tbody>${f.lines.map((l) => `<tr><td style="white-space:nowrap">${esc(l.line)}</td><td>${esc(l.label)}${l.note ? `<div class="hash">${esc(l.note)}</div>` : ""}</td><td class="num">${fmtLine(l)}</td></tr>`).join("")}</tbody>
      </table></div>
      <h3>Schedule A: district taxes</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Place</th><th class="num">Rate</th><th class="num">Taxable sales</th><th class="num">District tax</th></tr></thead>
        <tbody>${f.districts.map((d) => `<tr><td>${esc(d.jurisdiction)}</td><td class="num">${pct(d.rate)}</td><td class="num">${usd(d.taxableMinor)}</td><td class="num">${usd(d.districtTaxMinor)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No taxable sales this period.</td></tr>`}</tbody>
      </table></div>
    </div>`);
}

async function payRunView(id, runId) {
  await loadEntity(id);
  const r = await api(entPath(`/pay-runs/${runId}`));
  const stubs = new Map(r.stubs.map((s) => [s.employeeId, s]));
  const me = `user:${state.me.user.email}`;
  const canApprove = ["owner", "admin", "approver"].includes(state.org.role) && r.status === "prepared" && (r.prepared_by !== me || r.soleApprover);
  app.innerHTML = shell("payroll", `
    <div class="head no-print"><div><p><a href="#/e/${id}/payroll">&larr; Payroll</a></p><h1>Pay run for ${r.result.payDate}</h1>
      <p class="muted"><span class="${STATUS_PILL[r.status]}">${STATUS_LABEL[r.status]}</span> ${r.result.paychecks.length} employee${r.result.paychecks.length === 1 ? "" : "s"}, net pay ${usd(r.result.totals.netPayMinor)}.
      ${r.status === "prepared" ? "These stubs are drafts until the run is approved." : ""}</p></div>
      <div class="row"><button class="secondary" data-action="print">Print pay stubs</button>${canApprove ? `<button data-action="approve-run" data-id="${r.id}">Approve and post</button>` : ""}</div></div>
    ${payEmployeesPanel(r)}
    ${r.result.paychecks.map((c) => stubCard(r, c, stubs.get(c.employeeId))).join("")}`);
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
  const [{ members, invitations }, security] = await Promise.all([api(orgPath("/members")), api(orgPath("/security"))]);
  const mfaOf = new Map(security.members.map((m) => [m.email, m.mfa]));
  const mine = state.org.role;
  const canManage = ["owner", "admin"].includes(mine);
  const me = state.me.user.id;
  const manageable = (m) => m.userId !== me && (mine === "owner" || (mine === "admin" && m.role !== "owner"));
  const roleChoices = (current) => Object.entries(ROLE_LABEL).filter(([k]) => mine === "owner" || k !== "owner")
    .map(([k, l]) => `<option value="${k}" ${k === current ? "selected" : ""}>${l}</option>`).join("");
  const link = team.link;
  team.link = null;
  app.innerHTML = shell("team", `
    <div class="head"><div><h1>Team</h1><p class="muted">Roles control who can post, close periods and approve payroll. For payroll, one person prepares a run and another approves it; if you're the only person who can approve, you approve your own runs.</p></div></div>
    ${link ? `<div class="alert good">${link.emailed ? `We emailed the invitation to ${esc(link.email)}. You can also copy the link below; it` : `Invitation ready. Send this link to ${esc(link.email)}; it`} works once, for that email, for 14 days.
      <div class="row" style="margin-top:8px"><input id="invite-link" class="mono" readonly value="${esc(link.link)}" style="flex:1;min-width:260px"><button class="secondary" data-action="copy-invite">Copy link</button></div></div>` : ""}
    <div class="panel table-wrap"><table>
      <thead><tr><th>Name</th><th>Email</th>${canManage ? "<th>Two-factor</th>" : ""}<th>Role</th><th>Joined</th><th></th></tr></thead>
      <tbody>${members.map((m) => `<tr><td>${esc(m.name)}${m.userId === me ? ` <span class="muted">(you)</span>` : ""}</td><td>${esc(m.email)}</td>
        ${canManage ? `<td>${mfaOf.get(m.email) ? `<span class="pill">On</span>` : `<span class="pill grey">Off</span>`}</td>` : ""}
        <td>${canManage && manageable(m) ? `<select data-action="member-role" data-id="${m.userId}" aria-label="Role for ${esc(m.name)}">${roleChoices(m.role)}</select>` : ROLE_LABEL[m.role]}</td>
        <td>${m.createdAt.slice(0, 10)}</td>
        <td>${canManage && manageable(m) ? `<button class="link" data-action="member-remove" data-id="${m.userId}" data-name="${esc(m.name)}">Remove</button>`
          : m.userId === me ? `<button class="link" data-action="leave-org">Leave</button>` : ""}</td></tr>`).join("")}</tbody>
    </table></div>
    <div class="panel"><h2>Two-factor sign-in</h2>
      ${security.requireMfa
        ? `<p><span class="pill">Required</span> Everyone in this organisation must sign in with a code from an authenticator app.</p>`
        : `<p><span class="pill grey">Optional</span> Each person can turn it on under <a href="#/account">Your account</a>.</p>`}
      ${mine === "owner" ? (security.requireMfa
        ? `<button class="secondary" data-action="require-mfa" data-on="0">Make it optional</button>`
        : state.me.user.mfa?.enabled
          ? `<button data-action="require-mfa" data-on="1">Require it for everyone</button>`
          : `<p class="muted">To require it for everyone, first turn it on for yourself under <a href="#/account">Your account</a>.</p>`) : ""}
    </div>
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
    <h2>New to TrailBook</h2>
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
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px"><img src="/favicon.svg" width="32" height="32" alt=""><h1>TrailBook</h1></div>
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

// ------------------------------------------------------------------ billing

const PLAN_LABEL = { books: "Books", books_payroll: "Books + Payroll" };
const CHARGE_LABEL = { renewal: "Subscription", people: "People paid", upgrade: "Upgrade" };
const CHARGE_STATUS = { pending: "Due", processing: "Charging", paid: "Paid", failed: "Payment failed", held: "Being checked", waived: "Waived" };
const bill = { interval: null };

async function billingView() {
  const b = await api(orgPath("/billing"));
  if (b.free) {
    app.innerHTML = shell("billing", `<div class="head"><div><h1>Billing</h1></div></div><div class="panel"><p>This organisation doesn't pay for TrailBook.</p></div>`);
    return;
  }
  const owner = state.org.role === "owner";
  const interval = bill.interval ?? b.nextInterval ?? b.interval;
  const per = interval === "month" ? "a month" : "a year";
  const price = (minor) => usd(minor).replace(/\.00$/, "");
  const status = {
    trialing: b.access.level === "full"
      ? `<span class="pill">Free trial</span> Everything is included until ${longDate(b.trialEndsOn)}.${b.card ? " Your card is charged the day after." : " Add a card before then to keep making changes."}`
      : `<span class="pill bad">Trial ended</span> Your books are read-only. Add a card to keep going; nothing has been deleted.`,
    active: b.cancelAtPeriodEnd
      ? `<span class="pill warn">Ending</span> ${PLAN_LABEL[b.plan]} ends on ${longDate(b.periodEnd)}. After that the books stay readable and downloadable.`
      : `<span class="pill">Active</span> ${PLAN_LABEL[b.plan]}, paid ${b.interval === "month" ? "monthly" : "yearly"}, through ${longDate(b.periodEnd)}.`,
    past_due: `<span class="pill bad">Payment failed</span> ${esc(b.access.warning ?? b.access.reason ?? "")}`,
    canceled: `<span class="pill grey">Ended</span> The subscription has ended. Your books stay readable and downloadable.`,
  }[b.status];
  const planCard = (k, blurb) => {
    const on = (b.nextPlan ?? b.plan) === k;
    return `<label class="card plan ${on ? "on" : ""}">
      <input type="radio" name="plan" value="${k}" ${on ? "checked" : ""} ${owner || state.org.role === "admin" ? "" : "disabled"}>
      <div class="muted">${PLAN_LABEL[k]}</div>
      <div class="plan-price">${price(b.prices.plan[k][interval])} <span class="muted">${per}</span></div>
      ${k === "books_payroll" ? `<div>plus ${price(b.prices.perPersonMonth)} for each person paid in a month</div>` : ""}
      <div class="muted">${blurb}</div>
      <div class="muted small">Each extra business ${price(b.prices.extraBusiness[k][interval])} ${per}</div>
    </label>`;
  };
  const next = b.next ? `<p>Next charge on ${longDate(b.next.periodStart)}: <strong>${usd(b.next.subtotalMinor)}</strong> plus California sales tax where it applies, for ${longDate(b.next.periodStart)} to ${longDate(b.next.periodEnd)}.</p>
      <ul class="muted">${b.next.lines.map((l) => `<li>${esc(l.description)}${l.quantity > 1 ? ` × ${l.quantity}` : ""}: ${usd(l.quantity * l.unitMinor)}</li>`).join("")}</ul>` : "";
  const addr = b.billing.address ?? {};
  app.innerHTML = shell("billing", `
    <div class="head"><div><h1>Billing</h1><p class="muted">One price per business, unlimited users, invoices and bills. Prices are before sales tax. <a href="/pricing.html" target="_blank" rel="noopener">Pricing</a> · <a href="/promises.html" target="_blank" rel="noopener">Our promises</a></p></div></div>
    <div class="panel"><p>${status}</p>
      ${b.founding ? `<p><span class="pill">Founding customer</span> Your prices are locked until ${longDate(b.priceLockedUntil)}.</p>`
        : b.status === "trialing" && b.foundingSeatsLeft ? `<p class="muted">Founding offer: the first 100 businesses to start paying keep their price for 24 months. ${b.foundingSeatsLeft} places left.</p>` : ""}
      ${next}
    </div>
    <div class="panel">
      <div class="row" style="justify-content:space-between"><h2>Plan</h2>
        <div class="row seg"><button class="${interval === "month" ? "" : "secondary"}" data-action="bill-interval" data-v="month">Monthly</button><button class="${interval === "year" ? "" : "secondary"}" data-action="bill-interval" data-v="year">Yearly, 2 months free</button></div></div>
      <form data-form="bill-plan" data-interval="${interval}">
        <div class="grid plans">${planCard("books", "Invoices, bills, bank import and reconciliation, reports, sales tax, audit trail, backups.")}${planCard("books_payroll", "Everything in Books, plus payroll: state and city overtime and minimum-wage checks, pay stubs, direct-deposit file, prepared 941, W-2 and state quarterly forms.")}</div>
        <p class="muted">${b.businesses ? `You have ${b.businesses} business${b.businesses === 1 ? "" : "es"} here.` : "No businesses added yet; the plan price covers the first one."} ${b.status === "trialing" ? "Changes apply right away." : "Moving up to Books + Payroll applies now, charged for the days left; anything else applies at the next renewal."}</p>
        <button type="submit">Save plan</button>
      </form>
    </div>
    <div class="panel"><h2>Billing details</h2>
      <p class="muted">The name and address on your invoices. California sales tax is worked out from this address.</p>
      <form data-form="bill-details">
        <div class="grid two">
          <label>Business name<input name="name" required value="${esc(b.billing.name ?? state.org.org.name)}"></label>
          <label>Billing email<input name="email" type="email" required value="${esc(b.billing.email ?? state.me.user.email)}"></label>
          <label>Street address<input name="line1" required value="${esc(addr.line1 ?? "")}"></label>
          <label>City<input name="city" required value="${esc(addr.city ?? "")}"></label>
          <label>State<input name="state" required maxlength="2" value="${esc(addr.state ?? "CA")}"></label>
          <label>ZIP code<input name="zip" required value="${esc(addr.zip ?? "")}"></label>
        </div>
        <button type="submit" class="secondary">Save details</button>
      </form>
    </div>
    <div class="panel"><h2>Card</h2>
      ${b.card ? `<p>${esc(b.card.brand.toUpperCase())} ending ${esc(b.card.last4)}, expires ${esc(b.card.exp)}.</p>` : `<p class="muted">No card yet.</p>`}
      ${b.cardPayments
        ? b.billing.address ? `<button data-action="bill-card">${b.card ? "Replace card" : "Add a card"}</button>
          <p class="muted">You type the card on our payment processor's secure page (Stripe). TrailBook never sees or stores the card number.</p>` : `<p class="muted">Save the billing details first.</p>`
        : `<p class="muted">Card payments aren't switched on yet. Your trial carries on in the meantime.</p>`}
    </div>
    ${b.charges.length ? `<div class="panel table-wrap"><h2>Payments</h2><table>
      <thead><tr><th>Date</th><th>For</th><th>Invoice</th><th class="num">Amount</th><th class="num">Tax</th><th class="num">Total</th><th>Status</th></tr></thead>
      <tbody>${b.charges.map((c) => `<tr><td>${new Date(c.created_at).toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })}</td><td>${CHARGE_LABEL[c.kind]}, ${c.period_start} to ${c.period_end}</td><td class="mono">${esc(c.invoice_number ?? "")}</td>
        <td class="num">${usd(c.subtotal_minor)}</td><td class="num">${c.tax_minor == null ? "" : usd(c.tax_minor)}</td><td class="num">${c.total_minor == null ? "" : usd(c.total_minor)}</td>
        <td>${CHARGE_STATUS[c.status]}${c.failure ? `<div class="hash">${esc(c.failure)}</div>` : ""}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${owner ? `<div class="panel"><h2>${b.status === "canceled" || b.cancelAtPeriodEnd ? "Restart" : "Cancel"}</h2>
      ${b.status === "canceled" || b.cancelAtPeriodEnd
        ? `<p>Pick up where you left off.${b.status === "canceled" ? " Billing starts again today." : ""}</p><button data-action="bill-resume">Restart subscription</button>`
        : `<p class="muted">Cancel any time. ${b.status === "trialing" ? "The trial ends now." : `You keep full use until ${longDate(b.periodEnd)}.`} Your books stay readable and downloadable for 7 years, free. A yearly plan cancelled within 60 days of paying is refunded for the unused months.</p>
          <button class="secondary" data-action="bill-cancel">Cancel subscription</button>`}
    </div>` : ""}`);
}

/** Where the card processor sends people back after saving a card. */
async function cardReturnView(sessionId) {
  app.innerHTML = shell("billing", `<div class="panel"><p>Saving your card…</p></div>`);
  try {
    const r = await api(orgPath("/billing/card/confirm"), { body: { sessionId } });
    state.org.stale = true;
    toast(r.charged ? `Card saved and charged. Thank you!` : r.failed ? "Card saved, but the payment didn't go through" : `Card ending ${r.card.last4} saved`);
  } catch (err) {
    toast(err.message);
  }
  location.hash = "#/billing";
}

// ------------------------------------------------------------------ account

const acct = { setup: null, codes: null };

async function accountView() {
  if (!state.me) state.me = await api("/api/me");
  const u = state.me.user;
  const codes = acct.codes;
  acct.codes = null;
  const setup = acct.setup;
  let mfa;
  if (codes) {
    mfa = `<div class="alert good">Save these recovery codes now. Each one works once if you lose your phone. They won't be shown again.</div>
      <pre class="mono recovery">${codes.map(esc).join("\n")}</pre>
      <div class="row"><button class="secondary" data-action="copy-codes" data-codes="${esc(codes.join("\n"))}">Copy codes</button><button class="secondary" data-action="print">Print</button></div>`;
  } else if (u.mfa.enabled) {
    mfa = `<p><span class="pill">On</span> Signing in needs your password and a code from your authenticator app. ${u.mfa.recoveryCodesLeft} recovery code${u.mfa.recoveryCodesLeft === 1 ? "" : "s"} left.</p>
      <details><summary>Make new recovery codes</summary>
        <form data-form="mfa-codes" class="row">
          <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
          <label>Code from your app<input name="code" required autocomplete="one-time-code" maxlength="20"></label>
          <button type="submit" class="secondary">Make new codes</button>
        </form></details>
      <details><summary>Turn two-factor off</summary>
        <form data-form="mfa-disable" class="row">
          <label>Password<input name="password" type="password" required autocomplete="current-password"></label>
          <label>Code from your app<input name="code" required autocomplete="one-time-code" maxlength="20"></label>
          <button type="submit" class="secondary">Turn off</button>
        </form></details>`;
  } else if (setup) {
    mfa = `<ol class="steps">
        <li>Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password, Authy and others all work) and scan this code.
          <div class="qr">${setup.qrSvg}</div>
          <p class="muted">Can't scan? Enter this key instead: <span class="mono">${esc(setup.secret.replace(/(.{4})/g, "$1 ").trim())}</span></p></li>
        <li>Type the 6-digit code the app shows.
          <form data-form="mfa-enable" class="row">
            <label>Code<input name="code" required inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}"></label>
            <button type="submit">Turn on</button>
          </form></li>
      </ol>`;
    acct.setup = setup;
  } else {
    mfa = `<p><span class="pill warn">Off</span> Add a second step to signing in: a 6-digit code from an app on your phone. Someone who learns your password still can't get in.</p>
      <button data-action="mfa-setup">Set up two-factor sign-in</button>`;
  }
  app.innerHTML = shell("account", `
    <div class="head"><div><h1>Your account</h1><p class="muted">${esc(u.name)} · ${esc(u.email)}${u.emailVerified ? "" : " (not confirmed yet)"}</p></div></div>
    <div class="panel"><h2>Two-factor sign-in</h2>${mfa}</div>
    <div class="panel"><h2>Safety and privacy</h2>
      <p>How we protect your books, and what we promise about prices and your data: <a href="/security.html" target="_blank" rel="noopener">Security</a> · <a href="/promises.html" target="_blank" rel="noopener">Our promises</a> · <a href="/pricing.html" target="_blank" rel="noopener">Pricing</a></p></div>`);
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

/** Where to go after signing in: back to an app's consent page if that's what sent the person here. */
function afterLogin() {
  let next = null;
  try { next = sessionStorage.getItem("tb_after_login"); sessionStorage.removeItem("tb_after_login"); } catch {}
  return next && next.startsWith("#/oauth/") ? next : "#/";
}

async function route() {
  const hash = location.hash || "#/";
  const parts = hash.slice(2).split("/");
  try {
    if (["login", "signup", "forgot", "magic"].includes(parts[0])) return await authView(parts[0]);
    if (["email-link", "reset", "verify"].includes(parts[0]) && parts[1]) return await emailLinkView(parts[0], parts[1]);
    if (parts[0] === "join" && parts[1]) return await joinView(parts[1]);
    if (!state.me) {
      try { state.me = await api("/api/me"); } catch {
        // An app sent someone here to connect: come back to the consent page after signing in.
        if (hash.startsWith("#/oauth/")) try { sessionStorage.setItem("tb_after_login", hash); } catch {}
        return await authView("login");
      }
    }
    if (hash.startsWith("#/oauth/authorize")) return await oauthAuthorizeView(hash.split("?")[1] ?? "");
    if (!state.me.orgs.length) return authView("login", "Your account isn't part of any organisation yet.");
    if (!state.orgId || !state.me.orgs.some((o) => o.id === state.orgId)) {
      let saved = null;
      try { saved = localStorage.getItem("altqbo_org"); } catch {}
      state.orgId = state.me.orgs.some((o) => o.id === saved) ? saved : state.me.orgs[0].id;
    }
    // Before the organisation loads: one that requires two-factor refuses everything until it's on.
    if (parts[0] === "account") return await accountView();
    if (!state.org || state.org.org.id !== state.orgId || state.org.stale) state.org = await api(orgPath());
    if (parts[0] === "e" && parts[1]) {
      if (parts[2] === "reports" && REPORTS.some(([k]) => k === parts[3])) rep.tab = parts[3];
      if (parts[2] === "payroll" && parts[3] === "run" && parts[4]) return await payRunView(parts[1], parts[4]);
      if (parts[2] === "payroll" && parts[3] === "forms") return await formsView(parts[1], parts[4]);
      if (parts[2] === "sales-tax" && parts[3] === "return" && parts[4]) return await salesTaxReturnView(parts[1], decodeURIComponent(parts[4]));
      if (parts[2] === "sales-tax") return await salesTaxView(parts[1], parts[3]);
      if (parts[2] === "payroll" && parts[3] === "form" && parts[4]) return await formView(parts[1], parts[4], parts[5], parts[6]);
      if (["invoices", "bills"].includes(parts[2]) && parts[3]) return await docPageView(parts[1], parts[2] === "invoices" ? "invoice" : "bill", parts[3]);
      const view = { overview: overviewView, reports: reportsView, invoices: (i) => docsView(i, "invoice"), bills: (i) => docsView(i, "bill"), contacts: contactsView, items: itemsView, bank: bankView, reconcile: reconcileView, journal: journalView, "trial-balance": trialBalanceView, periods: periodsView, payroll: payrollView, accounts: accountsView, connections: connectionsView, integrations: integrationsView, milepost: milepostView }[parts[2] ?? "overview"] ?? overviewView;
      return await view(parts[1]);
    }
    if (parts[0] === "team") return await teamView();
    if (parts[0] === "billing" && parts[1] === "card" && parts[2]) return await cardReturnView(parts[2]);
    if (parts[0] === "billing") return await billingView();
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
  if (t.dataset.custom && t.form) t.form.elements.namedItem(t.dataset.custom).value = "custom";
  if (t.closest("#run-lines") || ["periodStart", "periodEnd", "payDate"].includes(t.name)) {
    const save = document.querySelector("[data-action=save-run]");
    if (save) save.disabled = true;
  }
});
document.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.name === "country" && t.closest("form[data-form=entity]")) {
    t.form.elements.namedItem("region").innerHTML = regionOptions(t.value);
    t.form.querySelector("[data-region-label]").textContent = countryOf(t.value)?.regionLabel ?? "State";
  }
  if (t.name === "payType" && t.closest("form[data-form=employee]")) {
    const hourly = t.value === "hourly";
    t.form.querySelectorAll("[data-only]").forEach((el) => { el.hidden = el.dataset.only !== t.value; });
    t.form.querySelector("[data-pay-label]").textContent = hourly ? "Hourly rate ($)" : "Annual salary ($)";
  }
  if (t.closest("#run-lines")) {
    const save = document.querySelector("[data-action=save-run]");
    if (save) save.disabled = true;
  }
  if (t.dataset.autosubmit !== undefined && t.form) t.form.requestSubmit();
  if (t.name === "contactId" && t.closest("form[data-form=document]")) {
    const box = t.form.querySelector("[data-new-contact]");
    box.hidden = t.value !== "__new";
    if (!box.hidden) box.querySelector("input").focus();
    // A vendor marked as not charging California tax turns use tax on.
    const useTax = t.form.querySelector("[name=useTax]");
    if (useTax) useTax.checked = Boolean((state.docContacts ?? []).find((c) => c.id === t.value)?.accrueUseTax);
  }
  if (t.closest("form[data-form=document][data-kind=bill]") && ["contactId", "useTax", "issueDate", "taxCategory", "servicePeriodStart", "servicePeriodEnd", "manualRate", "manualReason"].includes(t.name)) {
    updateDocTotals();
    scheduleTaxPreview();
  }
  if (t.name === "itemId" && t.closest("#doc-lines")) fillFromItem(t.closest("tr"), t.value);
  if (t.closest("form[data-form=document][data-kind=invoice]") && ["contactId", "issueDate", "itemId", "taxCategory", "servicePeriodStart", "servicePeriodEnd", "manualRate", "manualReason"].includes(t.name)) {
    updateDocTotals();
    scheduleTaxPreview();
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
    if (a === "accept-terms") {
      b.disabled = true;
      await api(`/api/orgs/${b.dataset.org}/terms/accept`, { body: { version: b.dataset.version } });
      state.me = null;
      toast("Thank you. The terms are accepted for your business");
      await route();
    } else if (a === "resend-verify") {
      b.disabled = true;
      await api("/api/auth/verify-resend", { body: {} });
      b.textContent = "Sent. Check your inbox.";
    } else if (a === "theme") {
      const next = THEMES[(THEMES.indexOf(theme()) + 1) % THEMES.length];
      try { localStorage.setItem("altqbo_theme", next); } catch {}
      applyTheme(next);
      b.textContent = { auto: "Theme: device", dark: "Theme: dark", light: "Theme: light" }[next];
    } else if (a === "nav-more") {
      const tiles = b.closest("nav").querySelector(".more-tiles");
      tiles.hidden = !tiles.hidden;
      b.setAttribute("aria-expanded", String(!tiles.hidden));
    } else if (a === "revoke-app" || a === "remove-milepost-key") {
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = a === "revoke-app" ? "Disconnect MilePost? Click again" : "Remove the key? Click again"; return; }
      b.disabled = true;
      await api(entPath(a === "revoke-app" ? `/integrations/apps/${b.dataset.grant}/revoke` : "/integrations/milepost/key/remove"), { body: {} });
      state.entity.fresh = false;
      toast(a === "revoke-app" ? "MilePost is disconnected" : "The key is removed");
      await integrationsView(state.entity.entity.id);
    } else if (a === "mp-add-customer") {
      b.disabled = true;
      await api(entPath("/milepost/customers"), { body: { contactId: b.dataset.id, email: b.dataset.email } });
      toast("Added as a customer");
      await milepostView(state.entity.entity.id);
    } else if (a === "open-example") {
      b.disabled = true;
      const label = b.textContent;
      b.textContent = "Setting up the example…";
      const r = await api("/api/example", { body: {} }).catch((err) => {
        b.disabled = false;
        b.textContent = label;
        throw err;
      });
      state.me = null; state.org = null; state.orgId = r.orgId;
      try { localStorage.setItem("altqbo_org", r.orgId); } catch {}
      location.hash = `#/e/${r.entityId}/overview`;
    } else if (a === "open-ledger") {
      openLedger(b.dataset.code);
    } else if (a === "journal-clear") {
      jr.q = "";
      await journalView(state.entity.entity.id);
    } else if (a === "dd-download") {
      b.disabled = true;
      const res = await api(entPath(`/pay-runs/${b.dataset.id}/direct-deposit`), { raw: true });
      if (!res.ok) throw new Error((await res.json()).error);
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "direct-deposit.ach";
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement("a"), { href: url, download: name }).click();
      URL.revokeObjectURL(url);
      b.disabled = false;
      toast("Bank file downloaded. Upload it on your bank's ACH page, then delete it from this computer");
    } else if (a === "form-ssn") {
      await formView(state.entity.entity.id, b.dataset.slug, b.dataset.year, b.dataset.quarter || undefined, true);
    } else if (a === "st-range") {
      Object.assign(rep, { tab: "st", preset: "custom", from: b.dataset.from, to: b.dataset.to });
      location.hash = `#/e/${state.entity.entity.id}/reports/st`;
    } else if (a === "form-csv") {
      const res = await api(entPath(`/payroll-forms/prepared?form=${b.dataset.slug}&year=${b.dataset.year}${b.dataset.quarter ? `&quarter=${b.dataset.quarter}` : ""}&format=csv${document.querySelector("[data-action=form-ssn]") ? "" : "&ssn=full"}`), { raw: true });
      if (!res.ok) throw new Error((await res.json()).error);
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "form.csv";
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement("a"), { href: url, download: name }).click();
      URL.revokeObjectURL(url);
    } else if (a === "print") {
      window.print();
    } else if (a === "logout") {
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
      if (b.dataset.kind === "invoice" || useTaxOn()) scheduleTaxPreview();
    } else if (a === "remove-doc-line") {
      if (document.querySelectorAll("#doc-lines tr").length > 1) b.closest("tr").remove();
      updateDocTotals();
      if (document.querySelector("form[data-form=document][data-kind=invoice]") || useTaxOn()) scheduleTaxPreview();
    } else if (a === "doc-toggle") {
      const row = document.querySelector(`tr[data-${b.dataset.form}="${b.dataset.id}"]`);
      row.hidden = !row.hidden;
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
    } else if (a === "bill-interval") {
      bill.interval = b.dataset.v;
      await billingView();
    } else if (a === "bill-card") {
      b.disabled = true;
      const r = await api(orgPath("/billing/card"), { body: {} });
      location.href = r.url;
    } else if (a === "bill-cancel") {
      if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Cancel the subscription? Click again"; return; }
      b.disabled = true;
      await api(orgPath("/billing/cancel"), { body: {} });
      state.org.stale = true;
      toast("Subscription cancelled. Your books stay readable and downloadable");
      await billingView();
    } else if (a === "bill-resume") {
      b.disabled = true;
      await api(orgPath("/billing/resume"), { body: {} });
      state.org.stale = true;
      toast("Subscription restarted");
      await route();
    } else if (a === "mfa-setup") {
      b.disabled = true;
      acct.setup = await api("/api/me/mfa/setup", { body: {} });
      await accountView();
    } else if (a === "copy-codes") {
      await navigator.clipboard.writeText(b.dataset.codes).catch(() => {});
      toast("Recovery codes copied");
    } else if (a === "require-mfa") {
      b.disabled = true;
      await api(orgPath("/security"), { body: { requireMfa: b.dataset.on === "1" } });
      toast(b.dataset.on === "1" ? "Everyone here now needs two-factor sign-in" : "Two-factor sign-in is now optional here");
      await teamView();
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
    } else if (a === "restore-point") {
      b.disabled = true;
      const res = await api(entPath(`/backups/${b.dataset.id}/download`), { body: {}, raw: true });
      if (!res.ok) throw new Error((await res.json()).error);
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "trailbook-backup.json";
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement("a"), { href: url, download: name }).click();
      URL.revokeObjectURL(url);
      b.disabled = false;
    } else if (a === "backup") {
      b.disabled = true;
      const res = await api(entPath("/backup"), { body: {}, raw: true });
      if (!res.ok) throw new Error((await res.json()).error);
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "trailbook-backup.json";
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement("a"), { href: url, download: name }).click();
      URL.revokeObjectURL(url);
      toast("Backup downloaded. Keep it somewhere safe: it holds all of these books");
      b.disabled = false;
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
    } else if (a === "emp-add" || a === "emp-cancel") {
      pay.adding = a === "emp-add";
      await payrollView(state.entity.entity.id);
      if (pay.adding) document.querySelector("form[data-form=employee] [name=name]").focus();
    } else if (a === "daily-toggle") {
      const row = document.querySelector(`tr[data-daily="${b.dataset.id}"]`);
      row.hidden = !row.hidden;
      const line = document.querySelector(`tr[data-emp-line="${b.dataset.id}"]`);
      line.querySelectorAll("[data-line$=Hours]").forEach((i) => { i.disabled = !row.hidden; });
      document.querySelector("[data-action=save-run]").disabled = true;
    } else if (a === "preview-run") {
      b.disabled = true;
      const run = await api(entPath("/pay-runs/preview"), { body: payRunBody() });
      document.getElementById("preview").innerHTML = runTable(run);
      document.querySelector("[data-action=save-run]").disabled = run.blockers.length > 0;
      b.disabled = false;
    } else if (a === "save-run") {
      b.disabled = true;
      const saved = await api(entPath("/pay-runs"), { body: payRunBody() });
      toast("Pay run sent for approval");
      location.hash = `#/e/${state.entity.entity.id}/payroll/run/${saved.id}`;
    } else if (a === "approve-run") {
      b.disabled = true;
      await api(entPath(`/pay-runs/${b.dataset.id}/approve`), { body: {} });
      state.entity.fresh = false;
      toast("Pay run approved and posted to the books");
      await route();
    } else if (a === "print") {
      window.print();
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
      let r;
      try {
        r = await api(`/api/auth/${kind}`, { body: kind === "signup" ? { ...d, acceptTerms: d.acceptTerms === "on" } : d });
      } catch (err) {
        return authView(kind, err.message);
      }
      if (r.mfaRequired) return mfaView(r.ticket);
      state.me = null; state.org = null; state.orgId = null;
      location.hash = afterLogin();
      await route();
    } else if (kind === "mfa") {
      const { ticket, then, invite } = f.dataset;
      let r;
      try {
        r = await api("/api/auth/mfa", { body: { ticket, code: d.code, inviteToken: invite || undefined } });
      } catch (err) {
        // A ticket that ran out of tries or time can't be used again.
        if (/sign in again/.test(err.message)) return then === "join" ? joinView(invite, err.message) : authView("login", err.message);
        return mfaView(ticket, then, invite, err.message);
      }
      if (then === "join") return joined(r.joined);
      state.me = null; state.org = null; state.orgId = null;
      location.hash = afterLogin();
      await route();
    } else if (kind === "bill-plan") {
      await api(orgPath("/billing/plan"), { body: { plan: d.plan, interval: f.dataset.interval } });
      bill.interval = null;
      state.org.stale = true;
      toast("Plan saved");
      await billingView();
    } else if (kind === "bill-details") {
      await api(orgPath("/billing/details"), { body: { name: d.name, email: d.email, address: { line1: d.line1, city: d.city, state: d.state, zip: d.zip } } });
      toast("Billing details saved");
      await billingView();
    } else if (kind === "mfa-enable") {
      const r = await api("/api/me/mfa/enable", { body: d });
      state.me = null;
      acct.codes = r.recoveryCodes;
      await accountView();
      toast("Two-factor sign-in is on");
    } else if (kind === "mfa-disable") {
      await api("/api/me/mfa/disable", { body: d });
      state.me = null;
      await accountView();
      toast("Two-factor sign-in is off");
    } else if (kind === "mfa-codes") {
      const r = await api("/api/me/mfa/recovery-codes", { body: d });
      state.me = null;
      acct.codes = r.recoveryCodes;
      await accountView();
      toast("New recovery codes made; the old ones no longer work");
    } else if (kind === "forgot" || kind === "magic") {
      try {
        await api(`/api/auth/${kind === "forgot" ? "reset" : "email-link"}`, { body: d });
      } catch (err) {
        return authView(kind, err.message);
      }
      return authView(kind, "", `If ${d.email} has an TrailBook account, a link is on its way. Check your inbox and spam folder.`);
    } else if (kind === "reset-password") {
      let r;
      try {
        r = await api(`/api/auth/reset/${f.dataset.token}`, { body: d });
      } catch (err) {
        return emailLinkView("reset", f.dataset.token, err.message);
      }
      if (r.mfaRequired) {
        toast("Password changed");
        return mfaView(r.ticket);
      }
      state.me = null; state.org = null; state.orgId = null;
      location.hash = "#/";
      toast("Password changed");
    } else if (kind === "entity") {
      const e = await api(orgPath("/entities"), { body: d });
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
      if (d.preset && d.preset !== "custom") [rep.from, rep.to] = presetRange(d.preset);
      if (d.asPreset && d.asPreset !== "custom") rep.asOf = presetAsOf(d.asPreset);
      await reportsView(state.entity.entity.id);
    } else if (kind === "journal-search") {
      jr.q = d.q.trim();
      await journalView(state.entity.entity.id);
    } else if (kind === "close-through") {
      const r = await api(entPath("/close-through"), { body: d });
      state.entity.fresh = false;
      toast(r.closed ? `Closed ${r.closed} month${r.closed === 1 ? "" : "s"}. Books closed through ${longDate(r.closedThrough ?? d.through)}` : "Those months were already closed");
      await periodsView(state.entity.entity.id);
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
    } else if (kind === "oauth-allow") {
      const [orgId, entityId] = d.target.split("/");
      const q = new URLSearchParams(d.query);
      const r = await api(`/api/orgs/${orgId}/entities/${entityId}/oauth/approve`, {
        body: { clientId: q.get("client_id"), redirectUri: q.get("redirect_uri"), scope: q.get("scope"), state: q.get("state") ?? undefined },
      });
      location.href = r.redirect;
      return;
    } else if (kind === "milepost-key") {
      await api(entPath("/integrations/milepost/key"), { body: { apiKey: d.apiKey } });
      state.entity.fresh = false;
      toast("MilePost is linked");
      await integrationsView(state.entity.entity.id);
    } else if (kind === "app-settings") {
      await api(entPath(`/integrations/apps/${f.dataset.grant}/settings`), { body: { taxCategory: d.taxCategory } });
      toast("Saved");
    } else if (kind === "mp-search") {
      MP.search = (d.email ?? "").trim();
      await milepostView(state.entity.entity.id);
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
        contactId = (await api(entPath("/contacts"), { body: {
          kind: k === "invoice" ? "customer" : "vendor", name: d.newContact, ...(k === "invoice" ? { address: addressOf(d, "new") } : {}),
        } })).id;
      }
      const lines = readDocLines().filter((l) => l.unitPrice || l.itemId);
      const manualTax = d.manualRate?.trim() ? { ratePercent: d.manualRate.trim(), reason: d.manualReason ?? "" } : undefined;
      const useTax = k === "bill" ? useTaxOn() : undefined;
      const doc = await api(entPath(`/${DOC[k].path}`), { body: { ...d, contactId, lines, manualTax, useTax, idempotencyKey: crypto.randomUUID() } });
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
    } else if (kind === "employee") {
      const body = employeeBody(f);
      if (f.dataset.id) await api(entPath(`/employees/${f.dataset.id}`), { body });
      else await api(entPath("/employees"), { body });
      pay.adding = false;
      toast(f.dataset.id ? "Saved" : `${body.name} added`);
      await payrollView(state.entity.entity.id);
    } else if (kind === "dep-pay") {
      const r = await api(entPath("/tax-deposits/pay"), { body: { key: f.dataset.key, paidDate: d.paidDate, bankAccount: d.bankAccount, confirmation: d.confirmation } });
      state.entity.fresh = false;
      toast(r.late ? "Recorded. It was paid after the due date, so a late-deposit penalty may follow" : "Payment recorded and posted to the books");
      await payrollView(state.entity.entity.id);
    } else if (kind === "sales-tax-settings") {
      await api(entPath("/sales-tax-settings"), { body: { sellerPermit: d.sellerPermit, filingFrequency: d.filingFrequency } });
      toast("Sales tax settings saved");
      await route();
    } else if (kind === "edd-account") {
      await api(entPath("/payroll-settings"), { body: { stateEmployerAccount: d.stateEmployerAccount } });
      toast("Account number saved");
      await route();
    } else if (kind === "deposit-schedule") {
      await api(entPath("/payroll-settings"), { body: { federalDepositSchedule: d.federalDepositSchedule } });
      toast("Deposit schedule saved");
      await payrollView(state.entity.entity.id);
    } else if (kind === "dd-settings") {
      await api(entPath("/direct-deposit-settings"), { body: {
        destinationName: d.destinationName, odfiRouting: d.odfiRouting.replace(/\s/g, ""), companyName: d.companyName,
        companyId: d.companyId, immediateOrigin: d.immediateOrigin, immediateDestination: d.immediateDestination,
        balanced: f.querySelector("[name=balanced]").checked, accountType: d.accountType, ...(d.account.trim() ? { account: d.account.trim() } : {}),
      } });
      toast("Bank details saved");
      await payrollView(state.entity.entity.id);
    } else if (kind === "sick-policy") {
      await api(entPath("/payroll-settings"), { body: { sickLeavePolicy: d.sickLeavePolicy } });
      toast("Sick leave policy saved");
      await payrollView(state.entity.entity.id);
    } else if (kind === "ui-rate") {
      await api(entPath("/payroll-settings"), { body: { stateRatesPercent: { [f.dataset.code]: d.ratePercent } } });
      toast("Rate saved");
      await payrollView(state.entity.entity.id);
    } else if (kind === "contact") {
      await api(entPath("/contacts"), { body: { name: d.name, kind: d.kind, email: d.email, address: addressOf(d) } });
      toast(`${d.name} added`);
      await contactsView(state.entity.entity.id);
    } else if (kind === "contact-edit") {
      await api(entPath(`/contacts/${f.dataset.id}`), { body: {
        email: d.email, address: addressOf(d), ...(d.resalePermit !== undefined ? { resalePermit: d.resalePermit } : {}),
        ...(d.directPayPermit !== undefined ? { directPayPermit: d.directPayPermit } : {}),
        ...(d.mpuCaPercent !== undefined ? { mpu: d.mpuCaPercent.trim() ? { caPercent: d.mpuCaPercent.trim(), certificateDate: d.mpuCertificateDate } : null } : {}),
        ...(f.querySelector("[name=accrueUseTax]") ? { accrueUseTax: f.querySelector("[name=accrueUseTax]").checked } : {}),
      } });
      toast("Saved");
      await contactsView(state.entity.entity.id);
    } else if (kind === "item" || kind === "item-edit") {
      const body = { name: d.name, taxCategory: d.taxCategory, unitPrice: d.unitPrice || "0", account: d.account };
      if (kind === "item") await api(entPath("/items"), { body });
      else await api(entPath(`/items/${f.dataset.id}`), { body: { ...body, active: f.querySelector("[name=active]").checked } });
      toast(kind === "item" ? `${d.name} added` : "Saved");
      await itemsView(state.entity.entity.id);
    } else if (kind === "business-address") {
      await api(entPath("/address"), { body: { address: addressOf(d) } });
      state.entity.fresh = false;
      toast("Business address saved");
      await overviewView(state.entity.entity.id);
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
      if (r.mfaRequired) return mfaView(r.ticket, "join", token);
      await joined(r.joined);
    }
  } catch (err) {
    toast(err.message);
  } finally {
    if (btn && document.contains(btn)) btn.disabled = false;
  }
});

route();
