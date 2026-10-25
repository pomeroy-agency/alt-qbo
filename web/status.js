// Public status page: asks the API how it is, with nothing private in the answer.

const rows = document.getElementById("checks");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const row = (name, ok, detail) => `<tr><td>${esc(name)}</td><td class="${ok ? "ok" : "down"}">${ok ? "Working" : "Problem"}</td><td class="muted">${esc(detail)}</td></tr>`;

async function check() {
  let s;
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    s = await res.json();
  } catch {
    rows.innerHTML = row("Alt-QBO", false, "The service didn't answer.");
    return;
  }
  const b = s.backups;
  rows.innerHTML = [
    row("Web app and sign-in", s.api, "Answering requests."),
    row("Database", s.database, s.database ? "Reading and writing." : "Not answering."),
    row("Nightly backups", !b.lastNight || b.failed === 0,
      b.lastNight ? `${b.verified} of ${b.verified + b.failed} copies from the night of ${b.lastNight} read back and checked.` : "No nightly backup has run yet."),
  ].join("");
}

check();
setInterval(check, 60_000);
