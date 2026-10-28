# TrailBook on pomeroyagency.com

The Pomeroy Agency site is a Wix site where every page is one full-page HTML
embed. This folder holds the TrailBook additions to it.

- `pages/` – the three new pages (product, pricing, for accountants): metadata, page CSS and body.
- `_shell.html`, `partials/` – the shared parts copied from the live pages: the PA-HEADER-V2 styles,
  the header (now V3, with TrailBook in it), PA Analytics Part 2 and the mobile-nav and colour fixes.
- `build.py` – assembles `dist/<page>.html`, one file per Wix embed. `APP` is the app's address.
- `patch_existing.py` – builds `dist/patch.js`, which updates the live pages' embeds in the browser:
  new header, a footer link, and a TrailBook band on the home, pricing and Systems & Automation pages.
- `analytics-part1-v4.html` – the site-wide "PA Analytics" Custom Code with the seven TrailBook events added to its allowlist.

Run `python3 marketing-site/build.py && python3 marketing-site/patch_existing.py`.
