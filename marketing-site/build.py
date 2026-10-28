"""Assemble the TrailBook pages for the Pomeroy Agency Wix site.

Each file in pages/ holds TITLE/DESC/PA_PAGE lines, the page's own CSS and its
body. The shared shell, header, analytics bridge and tail come from _shell.html
and partials/. Output goes to dist/, one complete HTML file per Wix embed.

APP is the TrailBook app's address. Change it here once the app moves to its
pomeroyagency.com subdomain, rebuild, and paste the pages again.
"""
import pathlib, re

APP = "https://app.pomeroyagency.com"
ROOT = pathlib.Path(__file__).parent
part = lambda n: (ROOT / "partials" / n).read_text()

def build(src: pathlib.Path) -> str:
    head, rest = src.read_text().split("---CSS---\n", 1)
    css, body = rest.split("---BODY---\n", 1)
    meta = dict(re.findall(r"^(TITLE|DESC|PA_PAGE): (.*)$", head, re.M))
    out = (ROOT / "_shell.html").read_text()
    for k, v in {
        "%%HEADER_CSS%%": part("header-css.html"),
        "%%ANALYTICS%%": part("analytics.html"),
        "%%HEADER%%": part("header.html"),
        "%%TAIL%%": part("tail.html"),
        "%%PAGE_CSS%%": css,
        "%%BODY%%": body,
    }.items():
        out = out.replace(k, v)
    out = (out.replace("%%TITLE%%", meta["TITLE"]).replace("%%DESC%%", meta["DESC"])
              .replace("%%PA_PAGE%%", meta["PA_PAGE"]).replace("%%APP%%", APP))
    assert "%%" not in out, src.name
    return out

(ROOT / "dist").mkdir(exist_ok=True)
for src in sorted((ROOT / "pages").glob("*.html")):
    html = build(src)
    (ROOT / "dist" / src.name).write_text(html)
    print(f"{src.name}: {len(html):,} chars")
