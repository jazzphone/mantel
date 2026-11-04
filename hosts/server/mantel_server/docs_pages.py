"""/docs: Mantel's documentation, served by Mantel itself: Mantel's own page (the HA
App's DOCS.md) and HK's pages (HK Frontend's wiki, whose source is in this repository:
hosts/ha/custom_components/hk_frontend/docs). HK's screens and settings link here from Mantel
(hkShell.docsUrl in web/shim/mantel-shell.js); in Home Assistant they keep linking HK Frontend's wiki.

* **Who**: anyone signed in (the session middleware sends a signed-out browser to /login). Nothing here
  reads the house or any setting: the same text for everyone.
* **Paths**: ``/docs/`` (Mantel's page, with every page in the sidebar), ``/docs/<Page>`` (a page by its
  wiki name, e.g. ``Sleep-Screen``; ``#anchor`` as GitHub makes them), ``/docs/images/<file>``. Every
  link a page carries is relative, so the same HTML works under HA's Ingress prefix.
* **Rendering**: the small Markdown the wiki uses (headings, paragraphs, lists, tables, code, quotes,
  links, images), rendered here with every character of the source HTML-escaped. The only HTML passed
  through is the wiki's own ``<img src="images/..." width alt>`` and ``<sub>``, rebuilt from their
  attributes; links are relative or http(s), anything else is dropped.
* **HK's pages are written for HK Frontend in Home Assistant**: each says so at its top, with what that
  means in Mantel.
"""
from __future__ import annotations

import html
import re
from pathlib import Path

from aiohttp import web

from .guards import WHY_STATIC, open_route

MANTEL_PAGE = "Mantel"
PAGE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,80}$")
IMAGE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(?:png|jpe?g|webp|gif|svg)$", re.I)
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
               ".gif": "image/gif", ".svg": "image/svg+xml"}
HEADERS = {"Cache-Control": "no-cache"}

HK_NOTE = ("Written for HK Frontend in Home Assistant. In Mantel the screens and HK’s settings are the same: "
           "where this page says HK Frontend, read Mantel, and HK Settings is in Mantel Settings. Settings "
           "under Devices &amp; Services are Home Assistant’s.")


# ---------------------------------------------------------------------------------- the renderer
def slug(text: str, seen: dict[str, int] | None = None) -> str:
    """A heading's anchor as GitHub makes it: lower case, punctuation dropped, spaces to hyphens; a repeat
    gets -1, -2, ..."""
    s = re.sub(r"[^\w\- ]", "", text.strip().lower()).replace(" ", "-")
    if seen is None:
        return s
    n = seen.get(s, 0)
    seen[s] = n + 1
    return s if n == 0 else f"{s}-{n}"


def _href(target: str) -> str | None:
    """A link's target as served here: X.md#a -> X#a, images/ and #a as they are, http(s) as it is; any
    other scheme (javascript:, data:, ...) or a path leaving /docs is refused."""
    t = target.strip()
    if re.match(r"^https?://", t, re.I):
        return t
    if ":" in t.split("#", 1)[0] or t.startswith("/") or ".." in t:
        return None
    page, _, anchor = t.partition("#")
    if page.endswith(".md"):
        page = page[:-3]
    if page.startswith("_"):
        return None
    return page + ("#" + anchor if anchor else "")


_CODE = re.compile(r"(`+)(.+?)\1")
_IMG = re.compile(r"!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)")
_LINK = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
_RAW_IMG = re.compile(r"&lt;img\s+(.*?)&gt;")
_ATTR = re.compile(r'(\w+)=&quot;(.*?)&quot;')


def _raw_img(m: re.Match) -> str:
    attrs = dict(_ATTR.findall(m.group(1)))
    src = _href(html.unescape(attrs.get("src", "")))
    if not src or not src.startswith("images/"):
        return m.group(0)
    width = attrs.get("width", "")
    w = f' width="{width}"' if width.isdigit() else ""
    return f'<img src="{html.escape(src)}" alt="{attrs.get("alt", "")}"{w} loading="lazy">'


def inline(text: str) -> str:
    """One line's Markdown -> HTML, the source escaped first."""
    s = html.escape(text, quote=True)
    codes: list[str] = []

    def keep(m: re.Match) -> str:
        codes.append(f"<code>{m.group(2).strip()}</code>")
        return f"\0{len(codes) - 1}\0"
    s = _CODE.sub(keep, s)
    s = _RAW_IMG.sub(_raw_img, s)
    s = s.replace("&lt;sub&gt;", "<small>").replace("&lt;/sub&gt;", "</small>")

    def img(m: re.Match) -> str:
        src = _href(html.unescape(m.group(2)))
        if not src:
            return m.group(1)
        return f'<img src="{html.escape(src)}" alt="{m.group(1)}" loading="lazy">'

    def link(m: re.Match) -> str:
        href = _href(html.unescape(m.group(2)))
        if href is None:
            return m.group(1)
        ext = ' target="_blank" rel="noopener"' if href.lower().startswith("http") else ""
        return f'<a href="{html.escape(href)}"{ext}>{m.group(1)}</a>'
    s = _IMG.sub(img, s)
    s = _LINK.sub(link, s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", s)
    s = re.sub(r"(?<![\w])_(?!\s)(.+?)(?<!\s)_(?![\w])", r"<em>\1</em>", s)
    return re.sub(r"\0(\d+)\0", lambda m: codes[int(m.group(1))], s)


def _plain(text: str) -> str:
    """A heading's words without its Markdown (for its anchor)."""
    t = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    t = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", t)
    return re.sub(r"[`*_]", "", t)


_LIST = re.compile(r"^( *)([-*+]|\d+[.)]) +(.*)$")
_TABLE_SEP = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")


def _cells(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip() for c in re.split(r"(?<!\\)\|", s)]


def blocks(lines: list[str], seen: dict[str, int], tight: bool = False) -> str:
    """Markdown lines -> HTML blocks."""
    out: list[str] = []
    i, n = 0, len(lines)
    para: list[str] = []

    def flush() -> None:
        if para:
            body = inline(" ".join(x.strip() for x in para))
            out.append(body if tight else f"<p>{body}</p>")
            para.clear()
    while i < n:
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            flush()
            i += 1
            continue
        fence = re.match(r"^(\s*)(```+|~~~+)", line)
        if fence:
            flush()
            mark, j, code = fence.group(2), i + 1, []
            while j < n and not lines[j].strip().startswith(mark):
                code.append(lines[j][len(fence.group(1)):] if lines[j].startswith(fence.group(1)) else lines[j])
                j += 1
            out.append(f"<pre><code>{html.escape(chr(10).join(code))}</code></pre>")
            i = j + 1
            continue
        h = re.match(r"^(#{1,6})\s+(.*?)\s*#*\s*$", stripped)
        if h and not line.startswith("    "):
            flush()
            level, words = len(h.group(1)), h.group(2)
            out.append(f'<h{level} id="{html.escape(slug(_plain(words), seen))}">{inline(words)}</h{level}>')
            i += 1
            continue
        if re.match(r"^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$", stripped):
            flush()
            out.append("<hr>")
            i += 1
            continue
        if stripped.startswith(">"):
            flush()
            quote = []
            while i < n and lines[i].strip().startswith(">"):
                quote.append(re.sub(r"^\s*> ?", "", lines[i]))
                i += 1
            out.append(f"<blockquote>{blocks(quote, seen)}</blockquote>")
            continue
        if "|" in stripped and i + 1 < n and _TABLE_SEP.match(lines[i + 1]) and "-" in lines[i + 1]:
            flush()
            head = _cells(line)
            rows = []
            i += 2
            while i < n and lines[i].strip() and "|" in lines[i]:
                rows.append(_cells(lines[i]))
                i += 1
            th = "".join(f"<th>{inline(c)}</th>" for c in head)
            tr = "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in rows)
            out.append(f'<div class="tw"><table><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table></div>')
            continue
        m = _LIST.match(line)
        if m:
            flush()
            i = _list(lines, i, seen, out)
            continue
        para.append(line)
        i += 1
    flush()
    return "\n".join(out)


def _list(lines: list[str], i: int, seen: dict[str, int], out: list[str]) -> int:
    """A list from lines[i] (its first item): the items at its indent, each with the lines indented
    under it (a nested list, a second paragraph, code) and its lazy continuation lines."""
    first = _LIST.match(lines[i])
    base = len(first.group(1))
    ordered = first.group(2)[0].isdigit()
    items: list[list[str]] = []
    loose = False
    n = len(lines)

    def item_at(k: int) -> re.Match | None:
        m = _LIST.match(lines[k])
        return m if m and len(m.group(1)) == base and m.group(2)[0].isdigit() == ordered else None
    while i < n:
        m = item_at(i)
        if m:
            items.append([m.group(3)])
            inner = base + len(m.group(2)) + 1       # where the item's own text starts
            i += 1
            continue
        line = lines[i]
        indent = len(line) - len(line.lstrip(" "))
        if not line.strip():
            # a blank line: the list goes on if an indented line or another item follows
            if i + 1 < n and lines[i + 1].strip() and (len(lines[i + 1]) - len(lines[i + 1].lstrip(" ")) > base
                                                      or item_at(i + 1)):
                loose = loose or bool(item_at(i + 1))
                items[-1].append("")
                i += 1
                continue
            break
        if indent > base:
            items[-1].append(line[inner:] if indent >= inner else line.lstrip(" "))
            i += 1
            continue
        if _LIST.match(line) or line.lstrip().startswith(("#", ">", "|", "```")) or items[-1][-1] == "":
            break
        items[-1].append(line)   # a lazy continuation of the item's paragraph
        i += 1
    tag = "ol" if ordered else "ul"
    start = ""
    if ordered:
        num = re.match(r"\d+", first.group(2)).group(0)
        start = f' start="{num}"' if num != "1" else ""
    lis = "".join(f"<li>{blocks(item, seen, tight=not loose)}</li>" for item in items)
    out.append(f"<{tag}{start}>{lis}</{tag}>")
    return i


# an HTML comment that starts a line (a note to whoever edits the page, or a generated block's markers): the wiki
# hides it, and so does this page
COMMENT = re.compile(r"(?ms)^ {0,3}<!--.*?-->[ \t]*\n?")


def render(markdown: str) -> str:
    markdown = COMMENT.sub("", markdown.replace("\r\n", "\n"))
    return blocks(markdown.replace("\t", "    ").split("\n"), {})


# ------------------------------------------------------------------------------------- the pages
class Docs:
    """The pages, read from their folders (each request reads its file: they are small, and a changed
    file shows at once)."""

    def __init__(self, hk_dir: Path, mantel_file: Path):
        self.hk_dir = hk_dir
        self.mantel_file = mantel_file

    def source(self, name: str) -> Path | None:
        if name == MANTEL_PAGE:
            return self.mantel_file if self.mantel_file.is_file() else None
        if not PAGE_NAME.match(name):
            return None
        p = self.hk_dir / f"{name}.md"
        return p if p.is_file() else None

    def image(self, name: str) -> Path | None:
        if not IMAGE_NAME.match(name):
            return None
        p = self.hk_dir / "images" / name
        return p if p.is_file() else None

    def sidebar(self) -> str:
        p = self.hk_dir / "_Sidebar.md"
        # (no anchors: the page's own headings keep theirs)
        hk = re.sub(r' id="[^"]*"', "", render(p.read_text(encoding="utf-8"))) if p.is_file() else ""
        own = f'<h3><a href="{MANTEL_PAGE}">Mantel</a></h3>' if self.mantel_file.is_file() else ""
        return own + (f'<div class="hk">{hk}</div>' if hk else "")

    def footer(self) -> str:
        p = self.hk_dir / "_Footer.md"
        return render(p.read_text(encoding="utf-8")) if p.is_file() else ""

    def page(self, name: str) -> tuple[str, str] | None:
        """(title, HTML body) for a page, or None."""
        src = self.source(name)
        if src is None:
            return None
        md = src.read_text(encoding="utf-8")
        h1 = re.search(r"^#\s+(.+)$", md, re.M)
        title = _plain(h1.group(1)).strip() if h1 else name.replace("-", " ")
        body = render(md)
        if name != MANTEL_PAGE:
            body = f'<p class="note">{HK_NOTE}</p>\n' + body
        return title, body


CSS = """
:root{color-scheme:light dark;--bg:#f2f2f7;--card:#fff;--text:#1c1c1e;--dim:#6e6e73;--tint:#007aff;--sep:#d1d1d6;--code:#e9e9ee}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--text:#f2f2f7;--dim:#98989f;--tint:#0a84ff;--sep:#38383a;--code:#2c2c2e}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,'SF Pro Text',system-ui,sans-serif}
a{color:var(--tint);text-decoration:none}a:hover{text-decoration:underline}
.top{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:.5px solid var(--sep);background:var(--card);position:sticky;top:0;z-index:1}
.top b{font-size:17px}.top .sp{flex:1}
.wrap{display:flex;max-width:1180px;margin:0 auto;gap:28px;padding:0 16px}
nav{flex:none;width:250px;font-size:14px;padding:18px 0;position:sticky;top:52px;align-self:flex-start;max-height:calc(100vh - 52px);overflow:auto}
nav ul{list-style:none;margin:2px 0 10px;padding:0}nav li{margin:3px 0}nav h3{font-size:15px;margin:0 0 10px}
nav p{margin:12px 0 4px;color:var(--dim)}nav .hk{border-top:.5px solid var(--sep);padding-top:10px}
.pages{display:none}
main{flex:1;min-width:0;padding:18px 0 40px}
main img{max-width:100%;height:auto;border-radius:10px}
.note{background:var(--card);border-radius:10px;padding:10px 14px;color:var(--dim);font-size:14px}
pre{background:var(--code);padding:12px 14px;border-radius:10px;overflow:auto;font-size:13px;line-height:1.4}
code{background:var(--code);padding:1px 5px;border-radius:5px;font-size:.9em}pre code{background:none;padding:0}
blockquote{margin:12px 0;padding:2px 14px;border-left:3px solid var(--sep);color:var(--dim)}
.tw{overflow-x:auto}table{border-collapse:collapse;margin:12px 0;font-size:14px}
th,td{border:.5px solid var(--sep);padding:6px 10px;text-align:left;vertical-align:top}th{background:var(--card)}
hr{border:0;border-top:.5px solid var(--sep);margin:24px 0}
footer{color:var(--dim);font-size:13px;border-top:.5px solid var(--sep);margin-top:32px;padding-top:12px}
@media (max-width:800px){.wrap{flex-direction:column;gap:0}nav{order:2;width:auto;position:static;max-height:none;
 border-top:.5px solid var(--sep)}.pages{display:inline}}
"""


def _html(title: str, body: str, sidebar: str, footer: str, back: str) -> str:
    return ("<!doctype html><html lang=en><head><meta charset=utf-8>"
            "<meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>{html.escape(title)} · Mantel Docs</title><style>{CSS}</style></head><body>"
            f"<div class=top><a href='{back}'>‹ Mantel Settings</a><span class=sp></span>"
            f"<a class=pages href='#pages'>All Pages</a><b>Mantel Docs</b></div>"
            f"<div class=wrap><nav id=pages>{sidebar}</nav>"
            f"<main>{body}<footer>{footer}</footer></main></div></body></html>")


def add_routes(app: web.Application, docs: Docs) -> None:
    @open_route("static", why=WHY_STATIC)
    async def index_redirect(request: web.Request) -> web.StreamResponse:
        raise web.HTTPFound("/docs/")

    @open_route("static", why=WHY_STATIC)
    async def page(request: web.Request) -> web.StreamResponse:
        name = request.match_info.get("page") or MANTEL_PAGE
        # ../settings from /docs/ and /docs/<Page> alike
        back = "../settings"
        got = docs.page(name)
        if got is None:
            body = (f"<h1>No such page</h1><p>Mantel’s docs have no page called "
                    f"“{html.escape(name)}”. <a href='{MANTEL_PAGE}'>All pages</a>.</p>")
            return web.Response(text=_html("Not found", body, docs.sidebar(), "", back), status=404,
                                content_type="text/html", headers=HEADERS)
        title, body = got
        return web.Response(text=_html(title, body, docs.sidebar(), docs.footer(), back),
                            content_type="text/html", headers=HEADERS)

    @open_route("static", why=WHY_STATIC, stream="bounded:one picture file under docs/")
    async def image(request: web.Request) -> web.StreamResponse:
        p = docs.image(request.match_info["name"])
        if p is None:
            raise web.HTTPNotFound()
        return web.FileResponse(p, headers={"Cache-Control": "max-age=86400",
                                            "Content-Type": IMAGE_TYPES[p.suffix.lower()]})

    app.router.add_get("/docs", index_redirect)
    app.router.add_get("/docs/", page)
    app.router.add_get("/docs/images/{name}", image)
    app.router.add_get("/docs/{page}", page)
