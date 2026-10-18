"""Nothing Mantel's page loads or calls escapes HA's Ingress prefix (docs/phase3/HA-APP.md, "The prefix").

A static scan of every JS/CSS/HTML file the page can load (web/, the HK code shared with the HA build
included), as the server sends it through Ingress (ingress.rewrite with a fictional prefix):
* no absolute reference to Mantel's asset roots (/hk/, /web/, /static/mdi/) is left un-prefixed;
* every read of location.pathname is the prefix-stripped one;
* every other absolute URL-root literal is either Mantel's own REST/WebSocket path built through
  shim/base.js, or on a short list of literals that are not URLs fetched from Mantel (Home Assistant API
  paths for the action port, example text, a WS message type, a comment), each with its reason.
The headless smoke (tools/headless/ingress_smoke.py) checks the same thing in a browser.
"""
from __future__ import annotations

import re
from pathlib import Path

from mantel_server import ingress

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
PREFIX = "/api/hassio_ingress/Fict1onalToken"
ASSET_LEFT = re.compile(r"""(["'`(])/(hk|web|static/mdi)/""")
URL_ROOT = re.compile(r"""(["'`(])(?!""" + re.escape(PREFIX) + r""")/(api|hk|web|static|ws|auth|login|logout|dev|"""
                      r"""local|hacsfiles|frontend|hk-settings|dashboard)\b""")
MANTEL_OWN = {"home.js", "shim/base.js", "shim/hub.js", "shim/mantel-client.js", "shim/mantel-host.js",
              "shim/mantel-shell.js", "shim/mantel-stepup.js", "shim/ha-elements.js"}
# file -> (a fragment of the line, why it is not a URL Mantel's page fetches from Mantel)
NOT_MANTEL_URLS = [
    ("hk/cards/hk-cameras.js", "'/api/hk_frontend/talk?", "an HA API path, sent through the action port (refused while commands are off)"),
    ("hk/panels/hk-settings.js", "actions.request('/api/' + path", "HA API paths for the action port (mantel-client)"),
    ("hk/panels/hk-settings.js", "request('/api/image/upload'", "an HA API path for the action port"),
    ("hk/panels/hk-settings.js", "'/api/image/serve/'", "an HA image address (HK Settings photos live in HA, not Mantel)"),
    ("hk/panels/hk-settings.js", "DOMAIN + '/dashboard/titled'", "a WebSocket message type, not a path"),
    ("hk/panels/hk-settings-model.js", "'/dashboard-kitchen/0?hk_", "example text in a help string"),
    ("hk/cards/hk-detail.js", 'href="/hk-settings#', "a link: shim/base.js moves a clicked link under the prefix"),
    ("shim/mantel-client.js", "indexOf('/api/') === 0", "HA API paths for the action port (hub.command), never fetched"),
]
WRAPPED = re.compile(r"(mantelUrl|api|post|wsUrl)\(\s*$")


def served_files():
    for f in sorted(WEB.rglob("*")):
        if f.suffix in (".js", ".mjs", ".css", ".html") and "mdi" not in f.relative_to(WEB).parts:
            yield f.relative_to(WEB).as_posix(), ingress.rewrite(f.read_text(encoding="utf-8"), PREFIX)


def test_no_asset_reference_escapes_the_prefix():
    left = [f"{rel}:{n}" for rel, text in served_files() for n, line in enumerate(text.splitlines(), 1)
            if ASSET_LEFT.search(line)]
    assert left == []


def test_every_location_pathname_read_is_prefix_stripped():
    bad = []
    for rel, text in served_files():
        for m in re.finditer(r"location\.pathname(\.slice\((\d+)\))?", text):
            if m.group(1) is None or int(m.group(2)) != len(PREFIX):
                bad.append(f"{rel}: {text[max(0, m.start() - 30):m.end() + 10]!r}")
    assert bad == []


def test_other_absolute_urls_are_mantels_own_through_base_js_or_listed():
    unexplained, used = [], set()
    for rel, text in served_files():
        for n, line in enumerate(text.splitlines(), 1):
            for m in URL_ROOT.finditer(line):
                if line.strip().startswith(("//", "*", "/*")):
                    continue                                     # a comment line
                listed = [i for i, (f, frag, _) in enumerate(NOT_MANTEL_URLS) if f == rel and frag in line]
                if listed:
                    used.update(listed)
                    continue
                if rel in MANTEL_OWN and WRAPPED.search(line[:m.start()]):
                    continue                                     # mantelUrl('/api/..'), api(..), post(..), wsUrl('/ws')
                unexplained.append(f"{rel}:{n}: {line.strip()[:120]}")
    assert unexplained == []
    assert used == set(range(len(NOT_MANTEL_URLS))), "a listed literal is gone: shorten NOT_MANTEL_URLS"


def test_mantels_own_code_builds_its_urls_through_base_js():
    stepup = (WEB / "shim/mantel-stepup.js").read_text()
    assert "fetch(api(path)" in stepup and "fetch(api('/api/session')" in stepup
    hub = (WEB / "shim/hub.js").read_text()
    assert "new WebSocket(wsUrl('/ws'))" in hub and "from './base.js'" in hub
    host = (WEB / "shim/mantel-host.js").read_text()
    assert "location.origin + (window.__mantelBase || '') + path" in host
    home = (WEB / "home.js").read_text()
    first_import = re.search(r"^import .*$", home, re.M).group(0)
    assert "./shim/base.js" in first_import                  # the prefix is known before anything else runs
    for rel in MANTEL_OWN:
        text = (WEB / rel).read_text()
        assert not re.search(r"location\.host\}/|location\.(origin|host)\s*\+\s*['\"]/", text), rel


def test_the_page_html_is_entirely_under_the_prefix():
    html = ingress.rewrite(ingress.inject_base((WEB / "home.html").read_text(), PREFIX), PREFIX)
    assert f'<meta name="mantel-base" content="{PREFIX}">' in html
    refs = re.findall(r'(?:href|src)="([^"]+)"', html)
    assert refs and all(r.startswith(PREFIX + "/") for r in refs), refs


def test_base_js_accepts_only_an_ingress_prefix():
    text = (WEB / "shim/base.js").read_text()
    assert r"/^\/api\/hassio_ingress\/[A-Za-z0-9_-]{1,128}$/" in text
    assert ingress.PATH_RE.pattern == r"^/api/hassio_ingress/[A-Za-z0-9_-]{1,128}$"
