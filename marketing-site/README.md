# TrailBook on pomeroyagency.com

The Pomeroy Agency site is a Wix site where every page is one full-page HTML
embed. This folder holds the TrailBook additions to it.

- `pages/` – the three new pages (product, pricing, for accountants): metadata, page CSS and body.
- `_shell.html`, `partials/` – the shared parts copied from the live pages: the PA-HEADER-V2 styles,
  the header (now V3, with TrailBook in it), PA Analytics Part 2 and the mobile-nav and colour fixes.
- `build.py` – assembles `dist/<page>.html`, one file per Wix embed. `APP` is the app's address.
- `patch_existing.py` – builds `dist/patch.js`, which updates the live pages' embeds in the browser:
  new header, a footer link, and a TrailBook band on the home, pricing and Systems & Automation pages.
- `audit_fixes.py` – builds `dist/fixes.js` with the copy fixes from the 28 Oct 2026 site audit: the broken TrailBook nav label, privacy-policy links in every footer and next to the Blueprint forms, and the Install button (email to start, instead of a Stripe link that charged the full $15,000). All applied and published 2026-10-28.
- `pages/privacy-policy.html` – a new Pomeroy Agency privacy policy to replace the old Wix template page (live at /privacy-policy since 2026-10-28).
- `analytics-part1-v6.html` – v5 with `trailbook_firm_click` mapped to Meta "Lead" so firm-page CTA clicks reach Meta (live as revision 6).
- `analytics-part1-v5.html` – v4 plus Global Privacy Control support, which the new privacy policy promises (live as revision 5).
- `analytics-part1-v4.html` – the site-wide "PA Analytics" Custom Code with the seven TrailBook events added to its allowlist.

Run `python3 marketing-site/build.py && python3 marketing-site/patch_existing.py && python3 marketing-site/audit_fixes.py`.
