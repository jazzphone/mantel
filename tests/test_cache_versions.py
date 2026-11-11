"""Cache that lasts (Phase 5, 2026-10-29): an image's build stamps ?v=<build id> on every import of its own code and
on the pages' script and stylesheet links (tools/build_static.py), an address put together at run time gets the same
from web/shim/base.js's hkV(), and the server lets a browser keep a file asked for with the build's id for a year
(server.py IMMUTABLE). Anything else -- unstamped, another id, a checkout -- stays no-cache."""
from __future__ import annotations

import importlib.util
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from aiohttp.test_utils import TestClient, TestServer

from mantel_server.auth import SESSION_COOKIE
from mantel_server.config import Config
from mantel_server.server import IMMUTABLE, NO_CACHE, build_app
from mantel_server.store import Store
import web_sources  # (a file cut into parts is read whole: tools/split_js.py)

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("mantel_build_static", ROOT / "tools/build_static.py")
bs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bs)
V = "0123456789abcdef"


def test_own_imports_are_stamped_and_nothing_else():
    src = ("import{a as b}from\"./base.js\";import\"../client/hk-client.js\";import x from'/hk/cards/hk-tile.js';"
           "export*from\"./more.mjs\";import(\"/hk/modules/hk-radar.js\");import( '/web/shim/ha-frame.js' );"
           "import(\"https://example.invalid/x.js\");import(\"/hk/modules/hk-x.js?t=1\");import(u);"
           "import(\"/hk/sky/a.webp\");var s=\"/hk/modules/hk-y.js\";fetch(\"/hk/modules/hk-z.js\");")
    out = bs.stamp_text(src, V)
    for kept in (f'from"./base.js?v={V}"', f'import"../client/hk-client.js?v={V}"', f"from'/hk/cards/hk-tile.js?v={V}'",
                 f'from"./more.mjs?v={V}"', f'import("/hk/modules/hk-radar.js?v={V}")',
                 f"import( '/web/shim/ha-frame.js?v={V}' )"):
        assert kept in out, kept
    # not an own script, already has a query, put together at run time, not a module, not an import
    for left in ('"https://example.invalid/x.js"', '"/hk/modules/hk-x.js?t=1"', "import(u)", '"/hk/sky/a.webp"',
                 'var s="/hk/modules/hk-y.js"', 'fetch("/hk/modules/hk-z.js")'):
        assert left in out, left
    assert out.count("?v=") == 6


def test_a_page_s_scripts_and_stylesheets_are_stamped():
    html = ('<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/apple-touch-icon.png">'
            '<link rel="stylesheet" href="/hk/fonts/sf-pro.css"><link rel="modulepreload" href="/hk/modules/hk-tap.js">'
            '<script type="module" src="/web/home.js"></script><a href="/hk/cards/hk-x.js">not a link to load</a>')
    out = bs.stamp_text(html, V, html=True)
    assert f'href="/hk/fonts/sf-pro.css?v={V}"' in out and f'href="/hk/modules/hk-tap.js?v={V}"' in out
    assert f'src="/web/home.js?v={V}"' in out
    assert 'href="/manifest.webmanifest"' in out and 'href="/apple-touch-icon.png"' in out
    assert '<a href="/hk/cards/hk-x.js">' in out


def test_base_js_gives_a_put_together_address_its_own_version():
    base = (ROOT / "web/shim/base.js").read_text()
    assert "new URL(import.meta.url).searchParams.get('v')" in base and "window.hkV = hkV" in base
    # every import whose address is put together at run time goes through it
    for rel, needle in (("web/home.js", "import(hkV(u))"), ("web/shim/settings-page.js", "import(hkV(u))"),
                        ("web/shim/early-cards.js", "link.href = hkV('/hk/cards/' + c)"),
                        ("web/hk/modules/hk-loader.js", "V('/hk/modules/' + m)"),
                        ("web/hk/modules/hk-loader.js", "import(V('/hk/cards/' + name))"),
                        ("web/hk/cards/hk-detail.js", "import(window.hkV ? window.hkV(u) : u)"),
                        ("web/hk/cards/hk-weather.js", "window.hkV ? window.hkV(RADAR_URL) : RADAR_URL"),
                        ("web/hk/modules/hk-edit-menu.js", "global.hkV ? global.hkV(KIT_URL) : KIT_URL")):
        assert needle in web_sources.read(rel), (rel, needle)                  # (a shell with its parts)


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    if bs.esbuild() is None:
        pytest.skip("esbuild not installed (npm ci --prefix tools)")
    out = tmp_path_factory.mktemp("stamped") / "out"
    build = bs.build(ROOT / "web", out)
    return out, build


def test_the_build_stamps_its_own_id(built):
    out, build = built
    web = out / "web"
    assert (out / "BUILD_ID").read_text().strip() == build
    home = (web / "home.html").read_text()
    preloads = re.findall(r'rel="modulepreload" href="([^"]+)"', home)
    assert len(preloads) == 9 and all(p.endswith("?v=" + build) for p in preloads)
    assert f'src="/web/home.js?v={build}"' in home and f'src="/web/shim/early-cards.js?v={build}"' in home
    assert f'from"./shim/base.js?v={build}"' in (web / "home.js").read_text()
    assert f'from"./base.js?v={build}"' in (web / "shim/early-cards.js").read_text()
    # the manifest describes the files as they ship (stamped)
    manifest = json.loads((out / "static-manifest.json").read_text())
    assert manifest["build"] == build and manifest["files"]["home.html"]["size"] == (web / "home.html").stat().st_size


@pytest.mark.skipif(shutil.which("node") is None, reason="node not installed")
def test_every_static_import_of_an_own_module_carries_the_id(built, tmp_path):
    """Node's own parser (vm.SourceTextModule.moduleRequests) lists each module's static imports: every one of this
    app's own is stamped. A module imported under two addresses would run twice."""
    out, build = built
    probe = tmp_path / "requests.mjs"
    probe.write_text("""import { readFileSync, readdirSync, statSync } from 'node:fs'; import { join } from 'node:path';
import vm from 'node:vm';
const root = process.argv[2], got = {};
(function walk(d) { for (const n of readdirSync(d)) { const p = join(d, n);
  if (statSync(p).isDirectory()) walk(p); else if (n.endsWith('.js')) {
    try { const m = new vm.SourceTextModule(readFileSync(p, 'utf8'));
      got[p.slice(root.length + 1)] = (m.moduleRequests || []).map((r) => r.specifier); } catch (e) { /* a script */ } } } })(root);
console.log(JSON.stringify(got));""")
    r = subprocess.run(["node", "--experimental-vm-modules", "--no-warnings", str(probe), str(out / "web")],
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    requests = json.loads(r.stdout.strip().splitlines()[-1])
    own = [(f, s) for f, specs in requests.items() for s in specs if re.match(r"(\.{1,2}/|/hk/|/web/)", s)]
    assert len(own) > 100
    assert [x for x in own if not x[1].endswith("?v=" + build)] == []


# -- the server ------------------------------------------------------------------------------------------------
@pytest.fixture
async def served(tmp_path):
    web = tmp_path / "app/web"
    (web / "hk/cards").mkdir(parents=True)
    (web / "shim").mkdir()
    (web / "hk/cards/hk-tile.js").write_text("var a=1;\n")
    (web / "shim/base.js").write_text("export const b=1;\n")
    (web / "home.html").write_text("<p>")
    (tmp_path / "app/BUILD_ID").write_text(V + "\n")
    dev = tmp_path / "dev-files"
    (dev / "cards").mkdir(parents=True)
    (dev / "cards/hk-dev.js").write_text("var d=1;\n")
    store = Store(tmp_path / "db")
    store.link("fictional-owner", "owner")
    cookie = store.create_session("fictional-owner", 60)
    cfg = Config(data_dir=tmp_path / "data", web=web, hk_frontend=web / "hk", hk_files=dev, fixtures=tmp_path / "none")
    async with TestClient(TestServer(build_app(cfg, "unused", store=store, connect_ha=False))) as client:
        client.session.cookie_jar.update_cookies({SESSION_COOKIE: cookie})
        yield client
    store.db.close()


async def test_a_file_of_this_build_asked_for_with_its_id_is_kept(served):
    for path in (f"/hk/cards/hk-tile.js?v={V}", f"/web/shim/base.js?v={V}"):
        r = await served.get(path)
        assert r.status == 200 and r.headers["Cache-Control"] == IMMUTABLE["Cache-Control"], path
    assert "private" in IMMUTABLE["Cache-Control"] and "immutable" in IMMUTABLE["Cache-Control"]


async def test_everything_else_is_asked_for_again(served):
    for path in ("/hk/cards/hk-tile.js", "/hk/cards/hk-tile.js?v=fedcba9876543210", "/web/shim/base.js?v=",
                 f"/hk/cards/hk-dev.js?v={V}"):                       # (the last: a developer's files folder)
        r = await served.get(path)
        assert r.status == 200 and r.headers["Cache-Control"] == NO_CACHE["Cache-Control"], path


async def test_a_checkout_keeps_no_cache_for_every_file(tmp_path):
    store = Store(tmp_path / "db")
    store.link("fictional-owner", "owner")
    cookie = store.create_session("fictional-owner", 60)
    cfg = Config(data_dir=tmp_path / "data", hk_files=tmp_path / "none", fixtures=tmp_path / "none")
    async with TestClient(TestServer(build_app(cfg, "unused", store=store, connect_ha=False))) as client:
        client.session.cookie_jar.update_cookies({SESSION_COOKIE: cookie})
        for path in ("/hk/cards/hk-tile.js?v=dev", "/hk/cards/hk-tile.js?v=" + V):
            assert (await client.get(path)).headers["Cache-Control"] == "no-cache"
    store.db.close()
