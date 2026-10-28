// Terms and privacy pages: fill in who the agreement is with, from the API.
fetch("/api/terms", { cache: "no-store" })
  .then((r) => (r.ok ? r.json() : null))
  .then((t) => {
    if (!t?.company) return;
    for (const el of document.querySelectorAll("[data-company]")) el.textContent = t.company;
  })
  .catch(() => {});
