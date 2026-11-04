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
MANTEL_OWN = {"home.js", "shim/settings-page.js", "shim/mantel-settings.js", "shim/settings/core.js", "shim/settings/kit.js", "shim/settings/me.js",
              "shim/settings/people.js", "shim/settings/devices.js", "shim/settings/roles.js", "shim/settings/files.js", "shim/settings/backups.js",
              "shim/settings/alerts.js", "shim/settings/service.js", "shim/settings/assistants.js", "shim/settings/connect.js", "shim/settings/connections.js", "shim/settings/tablets.js",
              "shim/settings/ha-screens.js", "shim/settings/link.js", "shim/settings/proxy.js", "shim/settings/audit.js",
              "shim/settings/setup.js", "shim/settings/general.js", "shim/settings/about.js", "shim/settings/performance.js", "shim/settings/secure.js", "shim/settings/cameras.js", "shim/settings/intercom.js", "shim/settings/protect.js", "shim/base.js", "shim/hub.js", "shim/mantel-client.js", "shim/mantel-host.js",
              "shim/mantel-shell.js", "shim/ha-elements.js", "shim/mantel-photos.js", "shim/boot-retry.js", "shim/page-health.js",
              "shim/early-cards.js",
              "app/push.js"}   # Web Push (slice 10.0): its calls go through the settings page's api(); never under Ingress
# file -> (a fragment of the line, why it is not a URL Mantel's page fetches from Mantel)
NOT_MANTEL_URLS = [
    ("hk/cards/hk-cameras.js", "'/api/hk_frontend/talk?", "an HA API path, sent through the action port (refused while commands are off)"),
    ("hk/panels/hk-settings.js", "actions.request('/api/' + path", "HA API paths for the action port (mantel-client)"),
    ("hk/panels/hk-settings.js", "request('/api/image/upload'", "an HA API path for the action port"),
    ("hk/panels/hk-settings.js", "'/api/image/serve/'", "an HA image address (HK Settings photos live in HA, not Mantel)"),
    ("hk/panels/hk-settings.js", "DOMAIN + '/dashboard/titled'", "a WebSocket message type, not a path"),
    ("hk/panels/hk-settings-model.js", "'/dashboard-kitchen/0?hk_", "example text in a help string"),
    ("hk/cards/hk-detail.js", 'href="/hk-settings#', "a link: shim/base.js moves a clicked link under the prefix"),
    ("shim/settings/kit.js", "if (BASE) location.reload(); else location.assign('/login')", "only without a prefix (BASE: '')"),
    ("shim/settings/core.js", "location.assign('/login?next='", "only without a prefix (signedOut: under Ingress Home Assistant signs people in)"),
    ("shim/mantel-client.js", "indexOf('/api/') === 0", "HA API paths for the action port (hub.command), never fetched"),
]
WRAPPED = re.compile(r"(mantelUrl|api|post|wsUrl)\(\s*$|\bapi\('[A-Z]+',\s*$")


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
    assert not (WEB / "shim/mantel-stepup.js").exists()      # no step-up prompt (decision 25)
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
    assert '<meta name="referrer" content="same-origin">' in html   # HA's no-referrer would null the Origin
    refs = re.findall(r'(?:href|src)="([^"]+)"', html)
    assert refs and all(r.startswith(PREFIX + "/") for r in refs), refs


def test_base_js_accepts_only_an_ingress_prefix():
    text = (WEB / "shim/base.js").read_text()
    assert r"/^\/api\/hassio_ingress\/[A-Za-z0-9_-]{1,128}$/" in text
    assert ingress.PATH_RE.pattern == r"^/api/hassio_ingress/[A-Za-z0-9_-]{1,128}$"


def test_the_power_pictures_folder_from_the_settings_feed_is_moved_under_the_prefix(tmp_path):
    """The Power page's picture folder is data (the settings feed's energy.power.art), which the rewrite of
    HK's files never sees: through Ingress the page asked Home Assistant's own /hk/ for the house. The host
    adapter (shim/mantel-host.js, as Ingress serves it) moves it under the prefix; elsewhere it is untouched."""
    import json
    import shutil
    import subprocess

    import pytest
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    served = dict(served_files())["shim/mantel-host.js"]
    assert "raw(withArtBase(this._withScreens(p)))" in served          # the settings feed goes through it
    (tmp_path / "host.mjs").write_text(served)
    (tmp_path / "run.mjs").write_text("""
      import { withArtBase } from './host.mjs';
      const feed = (art) => ({ added: ['energy'], energy: { sections: [], power: { art, home: 'sensor.home' } } });
      const base = %s;
      console.log(JSON.stringify({
        moved: withArtBase(feed('/hk/power-house/'), base),
        direct: withArtBase(feed('/hk/power-house/'), ''),
        other: withArtBase(feed('/local/art/'), base),
        none: withArtBase({ added: [] }, base),
        global: (globalThis.window = { __mantelBase: base }, withArtBase(feed('/hk/power-house/')).energy.power.art),
      }));""" % json.dumps(PREFIX))
    out = subprocess.run(["node", str(tmp_path / "run.mjs")], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout)
    assert got["moved"]["energy"]["power"] == {"art": PREFIX + "/hk/power-house/", "home": "sensor.home"}
    assert got["moved"]["energy"]["sections"] == [] and got["moved"]["added"] == ["energy"]
    assert got["direct"]["energy"]["power"]["art"] == "/hk/power-house/"
    assert got["other"]["energy"]["power"]["art"] == "/local/art/"
    assert got["none"] == {"added": []}
    assert got["global"] == PREFIX + "/hk/power-house/"


def test_the_playlists_covers_in_the_music_feed_are_moved_under_the_prefix(tmp_path):
    """A playlist pill's picture is Mantel's /ma image path (music.py covers): through Ingress the prefix goes in front
    (shim/mantel-host.js withMusicBase); a web address, or no prefix, is left alone."""
    import json
    import shutil
    import subprocess

    import pytest
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    served = dict(served_files())["shim/mantel-host.js"]
    assert "raw(withMusicBase(p))" in served                           # the music feed goes through it
    (tmp_path / "host.mjs").write_text(served)
    (tmp_path / "run.mjs").write_text("""
      import { withMusicBase } from './host.mjs';
      const feed = () => ({ configured: true, playlists: [
        { name: 'A', key: 'a', image: '/ma/imageproxy/ab?size=256' }, { name: 'B', key: 'b' },
        { name: 'C', image: 'https://img.example/c.jpg', options: [{ name: 'C1', key: 'c1', image: '/ma/imageproxy/cd?size=256' }, { name: 'C2', key: 'c2' }] }] });
      const base = %s;
      console.log(JSON.stringify({ moved: withMusicBase(feed(), base), direct: withMusicBase(feed(), ''),
        other: withMusicBase({ configured: false }, base) }));""" % json.dumps(PREFIX))
    out = subprocess.run(["node", str(tmp_path / "run.mjs")], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout)
    a, b, c = got["moved"]["playlists"]
    assert a["image"] == PREFIX + "/ma/imageproxy/ab?size=256" and "image" not in b
    assert c["image"] == "https://img.example/c.jpg" and c["options"][0]["image"] == PREFIX + "/ma/imageproxy/cd?size=256"
    assert "image" not in c["options"][1]
    assert got["direct"]["playlists"][0]["image"] == "/ma/imageproxy/ab?size=256"
    assert got["other"] == {"configured": False}
