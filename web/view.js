// A customer's view of one invoice or estimate, opened from the link in an
// email. The token sits after the # so it never reaches server logs or other
// sites; it is sent to the API in the body of a POST.

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (minor, currency) => {
  const n = BigInt(minor);
  const abs = n < 0n ? -n : n;
  return `${n < 0n ? "-" : ""}${currency === "CAD" ? "CA$" : "$"}${(abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(abs % 100n).toString().padStart(2, "0")}`;
};
const longDate = (d) => new Date(`${d}T00:00:00Z`).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const STATUS = { open: "Open", partial: "Part paid", overdue: "Overdue", paid: "Paid", void: "Void", accepted: "Accepted", declined: "Declined", expired: "Expired" };

async function load() {
  const box = document.getElementById("doc");
  const token = location.hash.slice(1);
  if (!token) { box.innerHTML = `<div class="alert bad">This link is incomplete. Ask the business to send it again.</div>`; return; }
  const res = await fetch("/api/view", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  const v = await res.json().catch(() => ({}));
  if (!res.ok) { box.innerHTML = `<div class="alert bad">${esc(v.error ?? "This link can't be opened.")}</div>`; return; }
  const m = (x) => money(x, v.currency);
  const invoice = v.kind === "invoice";
  const a = v.business.address;
  document.title = `${invoice ? "Invoice" : "Estimate"} ${v.number} from ${v.business.name}`;
  box.innerHTML = `<article class="panel doc">
    <div class="row" style="justify-content:space-between;align-items:flex-start">
      <div><div class="doc-title">${invoice ? "Invoice" : "Estimate"} ${esc(v.number)}</div><span class="pill">${esc(STATUS[v.status] ?? v.status)}</span></div>
      <div style="text-align:right"><strong>${esc(v.business.name)}</strong>${a ? `<div>${esc(a.line1)}</div><div>${esc(a.city)}, ${esc(a.state)} ${esc(a.zip)}</div>` : ""}</div>
    </div>
    <div class="row" style="gap:40px;margin:20px 0">
      <div><div class="muted">${invoice ? "Bill to" : "Prepared for"}</div><strong>${esc(v.customer)}</strong></div>
      <div><div class="muted">Date</div>${longDate(v.issueDate)}</div>
      <div><div class="muted">${invoice ? "Due" : "Good until"}</div>${longDate(v.dueDate)}</div>
      <div><div class="muted">${invoice ? "Balance due" : "Total"}</div><strong class="mono">${m(v.dueMinor)}</strong></div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead>
      <tbody>${v.lines.map((l) => `<tr><td>${esc(l.description)}</td><td class="num">${esc(l.quantity)}</td><td class="num">${m(l.unitPriceMinor)}</td><td class="num">${m(l.amountMinor)}</td></tr>`).join("")}</tbody>
      <tfoot>
        <tr><td colspan="3" class="num muted">Subtotal</td><td class="num">${m(v.subtotalMinor)}</td></tr>
        ${BigInt(v.taxMinor) ? `<tr><td colspan="3" class="num muted">${invoice ? "Sales tax" : "Estimated sales tax"}</td><td class="num">${m(v.taxMinor)}</td></tr>` : ""}
        <tr><td colspan="3" class="num">Total</td><td class="num">${m(v.totalMinor)}</td></tr>
        ${invoice && BigInt(v.paidMinor) ? `<tr><td colspan="3" class="num muted">Paid</td><td class="num">${m(-BigInt(v.paidMinor))}</td></tr><tr><td colspan="3" class="num">Balance due</td><td class="num">${m(v.dueMinor)}</td></tr>` : ""}
      </tfoot>
    </table></div>
    ${v.memo ? `<p style="margin-top:16px">${esc(v.memo)}</p>` : ""}
  </article>`;
  document.getElementById("print").hidden = false;
}

document.getElementById("print").addEventListener("click", () => window.print());
load().catch(() => { document.getElementById("doc").innerHTML = `<div class="alert bad">This link can't be opened right now. Try again in a minute.</div>`; });
