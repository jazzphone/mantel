"""End-to-end: a fresh Mantel against a Home Assistant WITHOUT HK Frontend shows a working generated Home screen.

    ~/.venvs/mantel/bin/python tools/e2e/home_screen_e2e.py [--region us|metric] [--keep-up] [--reuse]

No Docker. For each region (both, by default) it:

1. Starts the SCRATCH Home Assistant (``testha.py up --fresh --no-hk --rooms --region <r>``: 127.0.0.1:8124, HA's
   ``demo`` devices only, the demo devices put in four rooms, no HK Frontend). ``us`` is the scratch house as every
   other e2e has it; ``metric`` is metric units, German language and country, Sydney (southern hemisphere, 24 hours).
   Waits while another job uses it; ``--reuse``: use one this caller started (and its region), and leave it running.
2. Runs Mantel Server in this process, new: no Home Assistant, no screens, no people (a temp database). Creates the
   Owner through the bootstrap API and connects Home Assistant through Connections as a person would (the page's own
   ``POST /api/connections/ha/test`` and ``/ha``, with a long-lived token made in HA).
3. In an isolated headless Chrome (tools/headless/cdp.py; every request must stay on Mantel's own origin), as the
   Owner: opens ``/home`` and checks it lands on the generated screen (``/dashboard-home/home``); that the rooms and
   the tiles of the demo's areas and devices are drawn; opens a room's page, Lights, Climate and Security; and that
   no page logged a console error or exception, or had a failed or refused request (HTTP 4xx/5xx, a network failure,
   a request that left Mantel's origin).

Asserts on rendering and errors only, not on text formats (locale, units and dates are other checks' business).
Evidence: ``<TESTHA_DIR>/home_screen_e2e-<region>.json`` and screenshots ``home-<region>-*.png`` beside it.

SAFETY: refuses to run unless the HA URL is the scratch one; never reads ~/.config/mantel or touches /Volumes/config
or the house's HA. The token is made in the scratch HA, held in memory, and never printed.
"""
from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import secrets
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "hosts/server"))
sys.path.insert(0, str(ROOT / "tools/headless"))

import aiohttp  # noqa: E402
from aiohttp.test_utils import TestServer  # noqa: E402
from cdp import Browser  # noqa: E402

_spec = importlib.util.spec_from_file_location("gateway_e2e", ROOT / "tools/e2e/gateway_e2e.py")
GE = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(GE)
testha = GE.testha
SCRATCH_URL = GE.SCRATCH_URL
RESULTS: list[str] = []
EVIDENCE: dict = {}
ROOMS = ["Living Room", "Kitchen", "Bedroom", "Office"]       # tools/testha/testha.py ROOMS
PORT = 9361
# Apple's font and the SF Symbols glyph data cannot ship with Mantel: the owner supplies them (Mantel Settings -> Your
# files), and until then the page asks, gets a 404 and falls back to system fonts and Material icons (setup_check.py
# and Repairs say so). Those four answers, and only those, are expected on a new Mantel.
LICENSED_404 = ("/hk/fonts/SF-Pro.woff2", "/hk/fonts/SF-Pro.ttf", "/hk/iconset/hk-glyphs.js")


def say(*a):
    print("[home-e2e]", *a, flush=True)


def check(cond, what):
    if not cond:
        raise GE.Fail(what)
    say("PASS", what)
    RESULTS.append(what)


# What a view's page holds, read from the DOM: the cards the view host made, and the tiles drawn inside them
# (every hk-*-card in any shadow root that is not a layout container).
DRAWN = """(() => {
  const vh = window.__mantelViewHost, cur = vh.current(), cards = cur.cards;
  const tiles = []; const walk = (r) => { for (const e of r.querySelectorAll('*')) {
    if (e.localName === 'hk-tile-card' || e.localName === 'hk-light-card' || e.localName === 'hk-control-card') tiles.push(e);
    if (e.shadowRoot) walk(e.shadowRoot); } };
  walk(cur.element.shadowRoot || cur.element);
  return { path: cur.path, type: cur.element.localName, attached: cur.element.isConnected,
           cards: cards.length,
           drawn: cards.filter(c => c.isConnected && !c.hidden && c.localName !== 'hk-card-placeholder' &&
                               ((c.shadowRoot && c.shadowRoot.childNodes.length > 0) || c.childNodes.length > 0)).length,
           placeholders: cards.filter(c => c.localName === 'hk-card-placeholder').length,
           errors: cards.filter(c => c.localName === 'hk-error-card' || /error/i.test(c.localName)).length,
           tiles: tiles.length, text: (cur.element.innerText || '').length,
           views: window.hkShell.dashboardConfig().views.map(v => ({ path: v.path, title: v.title })) };
})()"""


def problems(b: Browser) -> list[str]:
    """Everything the page did wrong so far: console errors and exceptions, failed or refused requests (the licensed
    files' 404s are in ``expected`` instead)."""
    out = [line for line in b.console if line.startswith(("EXCEPTION:", "error:", "assert:"))]
    urls: dict[str, str] = {}
    for ev in b.events:
        m, p = ev.get("method"), ev.get("params", {})
        if m == "Network.requestWillBeSent":
            urls[p["requestId"]] = p["request"]["url"]
        elif m == "Network.responseReceived" and p["response"]["status"] >= 400:
            out.append(f"HTTP {p['response']['status']} {p['response']['url']}")
        elif m == "Network.loadingFailed" and not p.get("canceled"):
            out.append(f"request failed ({p.get('errorText')}) {urls.get(p['requestId'], '?')}")
        elif m == "Log.entryAdded" and p["entry"]["level"] == "error":
            out.append("log error: " + p["entry"]["text"][:200] + " " + p["entry"].get("url", ""))
    out += [f"left Mantel's origin: {h}" for h in getattr(b, "blocked_requests", [])]
    return sorted({line for line in out if not any(p in line for p in LICENSED_404)})


async def ha_token(http: aiohttp.ClientSession, token: str) -> str:
    """A long-lived access token made in the scratch HA, as a person makes one on their profile page."""
    async with http.ws_connect(SCRATCH_URL.replace("http", "ws") + "/api/websocket") as ws:
        await ws.receive_json()
        await ws.send_json({"type": "auth", "access_token": token})
        assert (await ws.receive_json())["type"] == "auth_ok"
        await ws.send_json({"id": 1, "type": "auth/long_lived_access_token", "client_name": "mantel-home-e2e-" + secrets.token_hex(3),
                            "lifespan": 1})
        while True:
            m = await ws.receive_json(timeout=30)
            if m.get("id") == 1:
                assert m.get("success"), m
                return m["result"]


async def run(token: str, region: str, shots: Path) -> dict:
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.store import Store

    evidence: dict = {"region": region}
    EVIDENCE.clear()
    EVIDENCE.update(evidence)
    async with aiohttp.ClientSession() as http:
        llat = await ha_token(http, token)
        async with http.get(SCRATCH_URL + "/api/config", headers={"Authorization": "Bearer " + token}) as r:
            conf = await r.json()
    want = testha.REGIONS[region]
    evidence["ha_config"] = {k: conf.get(k) for k in ("country", "language", "time_zone", "latitude")} | \
        {"temperature": conf["unit_system"]["temperature"], "length": conf["unit_system"]["length"]}
    check(conf["country"] == want["country"] and conf["language"] == want["language"]
          and conf["latitude"] == want["lat"] and conf["time_zone"] == want["tz"],
          f"the scratch HA is the {region} house ({evidence['ha_config']})")
    with tempfile.TemporaryDirectory(prefix="mantel-home-e2e-") as folder:
        base_dir = Path(folder)
        # a new Mantel: no Home Assistant yet, no screens, no people
        cfg = Config(ha_url="", data_dir=base_dir / "data", secrets_dir=base_dir / "secrets", port=0,
                     token_file=base_dir / "no-ha-token", ma_token_file=base_dir / "no-ma-token",
                     fixtures=base_dir / "fixtures", hk_files=base_dir / "user-files")
        store = Store(cfg.data_dir / "mantel.db")
        app = build_app(cfg, "", store=store, connect_ha=True)
        hub = app["hub"]
        async with TestServer(app, host="127.0.0.1") as server:
            origin = str(server.make_url("")).rstrip("/")
            say(f"Mantel is up on {origin}, new: no Home Assistant, no screens")
            owner = GE.Browser(origin, "owner")
            try:
                st, body = await owner.post("/api/bootstrap", {
                    "token": app["accounts"].issue_bootstrap_token(), "username": "e2e-owner",
                    "name": "Fictional Owner", "password": secrets.token_urlsafe(18)})
                check(st == 200 and body.get("ok"), "the first Owner is created through the bootstrap API")
                # Connections, as the page does it: test, then save
                st, body = await owner.post("/api/connections/ha/test", {"url": SCRATCH_URL, "token": llat})
                check(st == 200 and body.get("result", {}).get("entities", 0) > 0,
                      f"Connections tests the scratch HA ({body.get('result', {}).get('entities')} entities)")
                st, body = await owner.post("/api/connections/ha", {"url": SCRATCH_URL, "token": llat})
                check(st == 200, f"Connections saves it ({st})")
                del llat
                await asyncio.wait_for(hub.ha.ready.wait(), 60)
                check(len(hub.store.states) > 20, f"Mantel reads the scratch HA ({len(hub.store.states)} entities)")
                for _ in range(100):
                    if hub.registry.areas:
                        break
                    await asyncio.sleep(0.2)
                got = set(hub.registry.areas.values())
                check(set(ROOMS) <= got, f"it has the scratch HA's areas ({sorted(got)})")
                check(app["settings"].store.get("board", "dashboard-home") is not None,
                      "Mantel wrote its generated Home screen (dashboard-home) on first start")
                cookie = owner.cookie("mantel_session")
                await page(origin, cookie, region, shots, evidence)
            finally:
                await owner.close()
        store.db.close()
    return evidence


async def goto(b: Browser, path: str, *, first: bool = False) -> dict:
    """Move to a view through HK's own navigation, wait for it, and read what it drew."""
    if not first:
        await b.eval(f"window.hkShell.navigate({json.dumps(path)})")
    want = path.rstrip("/").rsplit("/", 1)[-1]
    ok = await b.wait(f"window.__mantelViewHost && window.__mantelViewHost.current() && "
                      f"window.__mantelViewHost.current().path === {json.dumps(want)} && "
                      f"window.__mantelViewHost.current().element.isConnected", 30)
    check(ok, f"{path} opens (console: {json.dumps(b.console[-3:])})")
    await asyncio.sleep(1.5)                       # cards draw as the states arrive
    return await b.eval(DRAWN)


async def page(origin: str, cookie: str, region: str, shots: Path, evidence: dict) -> None:
    async with Browser(width=1280, height=800, port=PORT) as b:
        await b.send("Log.enable")
        await b.restrict_origin(origin)
        await b.open(origin + "/home", cookie)
        ok = await b.wait("window.__mantelReady === true", 60)
        check(ok, "/home loads and Mantel's page is ready: " + json.dumps(b.console[-6:]))
        await b.wait("window.__mantelViewHost && window.__mantelViewHost.current() && "
                     "window.__mantelViewHost.current().cards.length > 0", 30)
        await asyncio.sleep(2)
        url = await b.eval("location.pathname")
        check(url == "/dashboard-home/home", f"/home lands on the generated screen ({url})")
        home = await b.eval(DRAWN)
        evidence["home"] = home
        paths = [v["path"] for v in home["views"]]
        check(home["path"] == "home" and home["type"] == "hk-grid-view" and home["attached"],
              f"the Home page is a grid view, drawn in the page ({home['type']})")
        check(home["cards"] >= 3 and home["drawn"] >= 3 and home["placeholders"] == 0 and home["errors"] == 0,
              f"its cards are drawn: {home['drawn']} of {home['cards']}, no placeholders or error cards")
        check(home["tiles"] >= 4, f"tiles for the demo's devices are drawn ({home['tiles']})")
        rooms = [v for v in home["views"] if v["path"].startswith("room-")]
        names = {v["title"] for v in rooms}
        check(set(ROOMS) <= names, f"a room page for each demo area ({sorted(names)})")
        shown = await b.eval("""(() => { const out = new Set(); const walk = (r) => { for (const e of r.querySelectorAll('*')) {
            if (e.shadowRoot) walk(e.shadowRoot); } };
          const t = []; const grab = (r) => { for (const e of r.querySelectorAll('*')) { if (e.shadowRoot) { t.push(e.shadowRoot.textContent); grab(e.shadowRoot); } } };
          grab(document); return t.join(' '); })()""")
        seen = [r for r in ROOMS if r in shown]
        check(len(seen) >= 3, f"the Home page shows the rooms by name ({seen})")
        for name in ("lights", "climate", "security"):
            check(name in paths, f"the generated screen has a {name} page ({paths})")
        await b.screenshot(str(shots / f"home-{region}-home.png"), full=False)
        opened = {}
        kitchen = next(v["path"] for v in rooms if v["title"] == "Kitchen")
        for path in (kitchen, "lights", "climate", "security"):
            got = await goto(b, "/dashboard-home/" + path)
            opened[path] = {k: got[k] for k in ("cards", "drawn", "placeholders", "errors", "tiles", "text")}
            check(got["type"] == "hk-grid-view" and got["attached"] and got["cards"] >= 1 and got["drawn"] >= 1
                  and got["placeholders"] == 0 and got["errors"] == 0,
                  f"{path} is drawn: {got['drawn']} of {got['cards']} cards, {got['tiles']} tiles")
            if path in (kitchen, "lights"):
                check(got["tiles"] >= 1, f"{path} has tiles for the demo's devices ({got['tiles']})")
            await b.screenshot(str(shots / f"home-{region}-{path}.png"), full=False)
        evidence["pages"] = opened
        wide = await b.eval("document.documentElement.scrollWidth - window.innerWidth")
        check(wide <= 1, f"the page does not scroll sideways ({wide}px)")
        bad = problems(b)
        evidence["problems"] = bad
        evidence["warnings"] = sorted({line for line in b.console if line.startswith("warning:")})
        for line in evidence["warnings"]:
            say("note:", line[:160])
        check(not bad, "no console error, exception, failed or refused request on any page: " + json.dumps(bad[:8]))


def one_region(region: str, reuse: bool, keep_up: bool) -> int:
    out = Path(testha.SCRATCH)
    if not reuse:
        GE.wait_for_free_harness()
        say(f"starting the scratch HA ({region}): testha.py up --fresh --no-hk --rooms --region {region}")
        GE.harness("up", "--fresh", "--no-hk", "--rooms", "--region", region)
    try:
        token = asyncio.run(GE.token_for_scratch())
        evidence = asyncio.run(run(token, region, out))
        del token
        (out / f"home_screen_e2e-{region}.json").write_text(json.dumps(evidence, indent=1, default=str))
        say(f"{region}: ALL CHECKS PASSED; evidence in {out}/home_screen_e2e-{region}.json")
        return 0
    except (GE.Fail, asyncio.TimeoutError) as exc:
        say(f"{region}: FAIL", repr(exc))
        (out / f"home_screen_e2e-{region}.json").write_text(json.dumps(EVIDENCE, indent=1, default=str))
        return 1
    finally:
        if not (keep_up or reuse):
            GE.harness("down")
            say("scratch HA stopped")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--region", choices=sorted(testha.REGIONS), help="only this region (default: every region)")
    ap.add_argument("--keep-up", action="store_true", help="leave the scratch HA running afterwards")
    ap.add_argument("--reuse", action="store_true", help="use the scratch HA this caller started; leave it up")
    a = ap.parse_args()
    regions = [a.region] if a.region else list(testha.REGIONS)
    failed = [r for r in regions if one_region(r, a.reuse, a.keep_up)]
    say("FAILED: " + ", ".join(failed) if failed else f"ALL REGIONS PASSED ({', '.join(regions)})")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
