"""/docs (docs_pages.py): Mantel's documentation served by Mantel, for anyone signed in. HK's pages are HK
Frontend's wiki source in this repository and Mantel's own page is the HA App's DOCS.md; the renderer
escapes the source, so a page can carry no markup of its own beyond the wiki's images."""
from __future__ import annotations

import re
from pathlib import Path

from mantel_server import docs_pages as D

ROOT = Path(__file__).resolve().parents[1]
HK_DOCS = ROOT / "hosts/ha/custom_components/hk_frontend/docs"


# ------------------------------------------------------------------ the renderer
def test_the_source_is_escaped_and_only_safe_links_survive():
    out = D.render("<script>alert(1)</script> [x](javascript:alert(1)) [y](/etc/passwd) [z](../up.md) "
                   "![i](data:image/png;base64,AAAA) <img src=\"https://evil.example/x.png\" onerror=\"x()\">")
    assert "<script" not in out and "&lt;script&gt;" in out
    assert "href" not in out and "<img" not in out
    assert "javascript:" not in out.replace("[x](javascript:", "")


def test_wiki_links_and_images_become_relative_paths_here():
    out = D.render("[Sleep](Sleep-Screen.md#decided-by) ![a tile](images/tile.png) [home](https://example.com)")
    assert '<a href="Sleep-Screen#decided-by">Sleep</a>' in out
    assert '<img src="images/tile.png" alt="a tile" loading="lazy">' in out
    assert '<a href="https://example.com" target="_blank" rel="noopener">home</a>' in out


def test_the_wikis_own_img_tag_is_rebuilt_from_its_attributes():
    out = D.render('<img src="images/phone.jpg" width="260" alt="A phone">')
    assert out == '<p><img src="images/phone.jpg" alt="A phone" width="260" loading="lazy"></p>'


def test_headings_get_githubs_anchors():
    out = D.render("# A tablet’s page\n## The rules, in order\n## The rules, in order\n### `code` [link](X.md)")
    assert 'id="a-tablets-page"' in out and 'id="the-rules-in-order"' in out and 'id="the-rules-in-order-1"' in out
    assert 'id="code-link"' in out


def test_lists_tables_code_and_quotes():
    md = ("1. one\n   - nested\n2. two\n\n| A | B |\n|---|---|\n| `x` | **y** |\n\n```yaml\na: <b>\n```\n\n"
          "> quoted *word*")
    out = D.render(md).replace("\n", "")
    assert "<ol><li>one<ul><li>nested</li></ul></li><li>two</li></ol>" in out
    assert "<th>A</th>" in out and "<td><code>x</code></td><td><strong>y</strong></td>" in out
    assert "<pre><code>a: &lt;b&gt;</code></pre>" in out
    assert "<blockquote><p>quoted <em>word</em></p></blockquote>" in out


def test_every_anchor_hk_settings_links_to_is_on_its_page():
    """HK Settings' Your Own Dashboards links each snippet to its heading (hk-settings-model.js anchors)."""
    model = (ROOT / "web/hk/panels/hk-settings-model.js").read_text(encoding="utf-8")
    anchors = set(re.findall(r"anchor: '([a-z0-9-]+)'", model))
    assert anchors
    docs = D.Docs(HK_DOCS, ROOT / "packaging/ha-app/DOCS.md")
    _, body = docs.page("Your-Own-Dashboard")
    ids = set(re.findall(r' id="([^"]+)"', body))
    assert anchors <= ids, anchors - ids
    assert docs.page("Sleep-Screen") is not None


# ------------------------------------------------------------------ the routes
async def test_docs_are_for_the_signed_in(mantel):
    r = await mantel.client.get("/docs/Sleep-Screen", allow_redirects=False,
                                headers={"Accept": "text/html", "Sec-Fetch-Dest": "document"})
    assert r.status in (302, 303) and "/login" in r.headers["Location"]
    r = await mantel.client.get("/docs/images/hero.webp", allow_redirects=False)
    assert r.status == 401


async def test_signed_in_the_pages_and_their_images(mantel):
    await mantel.user("ada", "adult")
    r, _ = await mantel.sign_in("ada")
    assert r.status == 200
    r = await mantel.get("/docs")
    assert str(r.url).endswith("/docs/")
    text = await r.text()
    assert r.status == 200 and "<h1 id=\"mantel\">Mantel</h1>" in text and 'href="Sleep-Screen"' in text
    r = await mantel.get("/docs/Sleep-Screen")
    text = await r.text()
    assert r.status == 200 and 'id="decided-by-an-automation"' in text and "Written for HK Frontend in Home Assistant" in text
    assert "href='../settings'" in text
    r = await mantel.get("/docs/images/hero.webp")
    assert r.status == 200 and r.headers["Content-Type"] == "image/webp"
    for bad in ("/docs/_Sidebar", "/docs/..%2Fconfig", "/docs/Nope"):
        assert (await mantel.get(bad)).status == 404, bad
    for bad in ("/docs/images/..%2F..%2FREADME.md", "/docs/images/x.txt"):
        assert (await mantel.get(bad)).status == 404, bad
