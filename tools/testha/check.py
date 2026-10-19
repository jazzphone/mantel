"""Click through the HACS build of HK Frontend in the scratch Home Assistant (see README.md).

    ~/.venvs/mantel/bin/python tools/testha/check.py [--shots DIR] [--only 1,2,3]

Needs `testha.py up` to have run. Drives an isolated headless Chrome that can reach
127.0.0.1 ONLY (its DNS is blocked for everything else; attempts are listed). Everything it taps is a demo
(fictional) entity in the scratch Home Assistant. Prints one PASS/FAIL line per item and writes
results.json beside the screenshots.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
import time
from pathlib import Path

import subprocess
import aiohttp

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "headless"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import testha                                   # noqa: E402
from cdp import Browser, CHROME                 # noqa: E402

# Only 127.0.0.1 may be reached. A DNS rule does it without pausing every request (cdp.Browser.restrict_origin
# intercepts each one, which reorders parallel module loads and so distorts the load-order probe).
_popen = subprocess.Popen


def _popen_local_only(args, *a, **k):
    if args and args[0] == CHROME:
        args = list(args) + ["--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1"]
    return _popen(args, *a, **k)


subprocess.Popen = _popen_local_only

BASE = testha.BASE
CODES = ("not_allowed", "read_only", "commands_disabled", "HKClient")
# expected, harmless: Apple's glyph file is licensed and never ships
EXPECTED = (re.compile(r"HK-ICONS: no glyph data"), re.compile(r"/hk/iconset/hk-glyphs\.js"),
            re.compile(r"/hk/fonts/SF-Pro"), re.compile(r"/hk/fonts/sf-pro"),
            # HA's demo cameras are HLS-only: the WebRTC offer is refused by HA itself (webrtc_offer_failed)
            re.compile(r"\[hk-doorbell\] could not start"))

HELPERS = r"""
window.__deep = function (root, pred, out) {
  out = out || [];
  var w = function (n) {
    if (!n) return;
    if (n.nodeType === 1 && pred(n)) out.push(n);
    if (n.shadowRoot) w(n.shadowRoot);
    var c = n.children || n.childNodes;
    for (var i = 0; i < (c || []).length; i++) w(c[i]);
  };
  w(root);
  return out;
};
window.__text = function (root) {
  var t = [];
  var w = function (n) {
    if (!n) return;
    if (n.nodeType === 3) { t.push(n.textContent); return; }
    if (n.nodeType === 1 && /^(STYLE|SCRIPT)$/.test(n.tagName)) return;
    if (n.shadowRoot) w(n.shadowRoot);
    var c = n.childNodes || [];
    for (var i = 0; i < c.length; i++) w(c[i]);
  };
  w(root);
  return t.join(' ').replace(/\s+/g, ' ').trim();
};
window.__sheet = function () { return __deep(document, function (n) { return n.classList && n.classList.contains('hkd'); })[0]; };
window.__tag = function (name, pred) { return __deep(document, function (n) { return n.localName === name && (!pred || pred(n)); }); };
window.__tile = function (entity) {
  return __deep(document, function (n) { return /^hk-[a-z-]+-card$/.test(n.localName) && n._config && n._config.entity === entity; })[0];
};
"""


class Run:
    def __init__(self, b: Browser, shots: Path, token: str):
        self.b, self.shots, self.token = b, shots, token
        self.results: list[dict] = []
        self.mark = 0

    # ---- browser plumbing
    async def ws(self, type_, **kw):
        """One admin websocket call (settings the checks flip, never a device)."""
        async with aiohttp.ClientSession() as h:
            async with h.ws_connect(BASE + "/api/websocket") as raw:
                await raw.receive_json()
                await raw.send_json({"type": "auth", "access_token": self.token})
                await raw.receive_json()
                return await testha.WS(raw).call(type=type_, **kw)

    async def js(self, expr):
        return await self.b.eval(expr)

    async def goto(self, path, wait="window.__tag('hk-grid-view').length>0", timeout=60):
        await self.b.open(BASE + path)
        ok = await self.b.wait(wait, timeout)
        await asyncio.sleep(2.5)
        return ok

    async def center(self, expr):
        return await self.js("(function(){var e=%s; if(!e) return null; e.scrollIntoView({block:'center',inline:'center'});"
                             "var r=e.getBoundingClientRect(); return [r.x+r.width/2, r.y+r.height/2, r.width, r.height];})()" % expr)

    async def click(self, expr):
        """A real mouse click on the element `expr` evaluates to. False if there is no such element."""
        c = await self.center(expr)
        if not c or c[2] == 0:
            return False
        x, y = c[0], c[1]
        await self.b.send("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y)
        await self.b.send("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y, button="left", clickCount=1)
        await asyncio.sleep(0.06)
        await self.b.send("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y, button="left", clickCount=1)
        return True

    async def shot(self, name):
        p = self.shots / f"{name}.png"
        await self.b.screenshot(str(p))
        return str(p)

    async def state(self, entity):
        async with aiohttp.ClientSession() as h:
            async with h.get(f"{BASE}/api/states/{entity}", headers={"Authorization": "Bearer " + self.token}) as r:
                return await r.json()

    async def service(self, domain, service, data):
        async with aiohttp.ClientSession() as h:
            async with h.post(f"{BASE}/api/services/{domain}/{service}", json=data,
                              headers={"Authorization": "Bearer " + self.token}) as r:
                return r.status

    # ---- what the page said
    def console_since(self, start=0):
        return [m for m in self.b.console[start:] if not any(p.search(m) for p in EXPECTED)]

    def frames(self):
        """(sent {id: message}, received [(id, success, error)]) for every websocket frame seen."""
        sent, got = {}, []
        for ev in self.b.events:
            m = ev.get("method")
            if m not in ("Network.webSocketFrameSent", "Network.webSocketFrameReceived"):
                continue
            try:
                d = json.loads(ev["params"]["response"]["payloadData"])
            except (ValueError, KeyError):
                continue
            if m.endswith("Sent") and isinstance(d, dict) and "id" in d:
                sent[d["id"]] = d
            elif isinstance(d, dict) and d.get("type") == "result":
                got.append((d.get("id"), d.get("success"), d.get("error")))
        return sent, got

    def ws_errors(self):
        sent, got = self.frames()
        return [(sent.get(i, {}).get("type", "?"), e) for i, ok, e in got if ok is False]

    def ws_types(self):
        sent, got = self.frames()
        out: dict[str, list[int]] = {}
        ok = {i: s for i, s, _ in got}
        for i, m in sent.items():
            t = m.get("type", "?")
            if t == "subscribe_events":
                t += ":" + str(m.get("event_type"))
            out.setdefault(t, [0, 0])
            out[t][0 if ok.get(i, True) else 1] += 1
        return out

    def http_failures(self):
        out = []
        for ev in self.b.events:
            if ev.get("method") == "Network.responseReceived":
                r = ev["params"]["response"]
                if r["status"] >= 400 and r["url"].startswith(BASE):
                    out.append((r["status"], r["url"][len(BASE):]))
        return sorted(set(out))

    def record(self, n, name, ok, detail="", shots=(), extra=None):
        errs = self.console_since(self.mark)
        exc = [e for e in errs if e.startswith("EXCEPTION")]
        codes = [e for e in errs if any(c in e for c in CODES)]
        r = {"item": n, "name": name, "pass": bool(ok), "detail": detail, "console_errors": [e for e in errs if e.startswith(("error", "EXCEPTION"))][:12],
             "exceptions": len(exc), "code_hits": codes[:6], "shots": list(shots)}
        if extra:
            r.update(extra)
        self.results.append(r)
        print(f"{'PASS' if ok else 'FAIL'}  {n}. {name}: {detail}", flush=True)
        for e in r["console_errors"]:
            print("        console:", e[:220])
        self.mark = len(self.b.console)


# ---------------------------------------------------------------- the checks
async def check_home(r: Run):
    await r.goto("/hk-scratch")
    await r.b.wait("window.__tag('hk-status-chip-card').length>0", 30)
    s = await r.shot("01-home")
    d = await r.js("JSON.stringify({header: __tag('hk-header-card').length, chips: __tag('hk-status-chip-card').length,"
                   "tiles: __deep(document, n=>/^hk-(light|cover|fan|climate-tall|tile)-card$/.test(n.localName)).length,"
                   "sections: __tag('hk-heading-card').map(n=>__text(n)).slice(0,8), cams: __tag('hk-camera-mosaic-card').length})")
    d = json.loads(d)
    ok = d["header"] and d["chips"] >= 3 and d["tiles"] >= 3
    r.record(1, "Home renders", ok, f"header {d['header']}, chips {d['chips']}, tiles {d['tiles']}, sections {d['sections']}", [s])


async def drag(r: Run, x, y0, y1):
    b = r.b
    await b.send("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y0)
    await b.send("Input.dispatchMouseEvent", type="mousePressed", x=x, y=y0, button="left", clickCount=1)
    for i in range(1, 9):
        await b.send("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y0 + (y1 - y0) * i / 8, buttons=1)
        await asyncio.sleep(0.04)
    await b.send("Input.dispatchMouseEvent", type="mouseReleased", x=x, y=y1, button="left", clickCount=1)


async def check_light(r: Run):
    ent = "light.kitchen_lights"
    await r.goto("/hk-scratch/lights")
    well = "(function(){var t=__tile('%s'); return t && t.shadowRoot.querySelector('[data-hk-role=well]');})()" % ent
    name = "(function(){var t=__tile('%s'); return t && t.shadowRoot.querySelector('[data-hk-role=name]');})()" % ent
    if (await r.state(ent))["state"] != "on":
        await r.click(well)
        await asyncio.sleep(1.5)
    before = (await r.state(ent))["state"]
    clicked = await r.click(well)
    await asyncio.sleep(2)
    after = (await r.state(ent))["state"]
    await r.click(well)                                 # back to how it was
    await asyncio.sleep(2)
    back = (await r.state(ent))["state"]
    r.record(2, "Light tile toggles (real service call into the scratch HA)", clicked and after != before and back == before,
             f"{ent}: {before} -> {after} -> {back}", [await r.shot("02-light-tiles")])
    # the detail sheet, and brightness
    mark = r.mark
    b0 = (await r.state(ent))["attributes"].get("brightness")
    opened = await r.click(name)
    await r.b.wait("window.__sheet() !== undefined", 10)
    await asyncio.sleep(1.5)
    sheet_shot = await r.shot("02b-light-sheet")
    vs = "(function(){var s=__sheet(); return s && __deep(s,n=>n.classList&&n.classList.contains('vs'))[0];})()"
    c = await r.center(vs)
    b1 = b0
    if c:
        x, top, h = c[0], c[1] - c[3] / 2, c[3]
        # toward the other end from where it is now, so it always changes and never reaches off
        low = (b0 or 0) > 130
        await drag(r, x, top + h * 0.5, top + h * (0.75 if low else 0.25))
        await asyncio.sleep(2)
        b1 = (await r.state(ent))["attributes"].get("brightness")
    title = await r.js("(function(){var s=__sheet(); return s ? (s.querySelector('.tt')||{}).textContent : null;})()")
    await r.click("(function(){var s=__sheet(); return s && s.querySelector('.x');})()")
    await asyncio.sleep(1)
    r.record("2b", "Detail sheet opens (tap the name), brightness slider moves the light", bool(opened and title and c and b1 and abs(b1 - (b0 or 0)) > 5),
             f"sheet '{title}', brightness {b0} -> {b1}", [sheet_shot])
    r.mark = max(r.mark, mark)


async def check_weather(r: Run):
    await r.goto("/hk-scratch/weather", "window.__tag('hk-weather-band-card').length>0")
    await asyncio.sleep(5)
    txt = await r.js("JSON.stringify({band: __tag('hk-weather-band-card').map(n=>__text(n).slice(0,160)),"
                     "tiles: __tag('hk-weather-tile-card').map(n=>__text(n).slice(0,80))})")
    d = json.loads(txt)
    shot = await r.shot("03-weather")
    ft = r.ws_types().get("weather/subscribe_forecast", [0, 0])
    joined = " ".join(d["band"] + d["tiles"])
    has_hours = re.search(r"\b\d{1,2} ?(AM|PM)\b", joined) is not None or "Now" in joined
    has_days = bool(re.search(r"Today|Mon|Tue|Wed|Thu|Fri|Sat|Sun", joined)) and "°" in joined
    errs = [e for e in r.ws_errors() if "forecast" in str(e).lower() or "not_allowed" in str(e)]
    ok = ft[0] >= 1 and ft[1] == 0 and has_hours and has_days and not errs
    r.record(3, "Weather page: hourly + 7-day forecast from weather/subscribe_forecast", ok,
             f"forecast subscriptions ok/refused {ft}, hourly labels {has_hours}, daily rows {has_days}, ws errors {errs}", [shot],
             {"band_text": d["band"][:2]})
    # the weather sheet from a tile
    opened = await r.click("__tag('hk-weather-tile-card')[0]")
    await asyncio.sleep(2.5)
    sh = await r.js("(function(){var s=__sheet(); return s ? __text(s).slice(0,200) : null;})()")
    await r.shot("03b-weather-sheet")
    await r.click("(function(){var s=__sheet(); return s && s.querySelector('.x');})()")
    r.results[-1]["weather_sheet"] = sh
    print("        weather sheet:", sh)


async def check_cameras(r: Run):
    await r.goto("/hk-scratch/cameras", "window.__tag('hk-camera-live-card').length>0")
    await asyncio.sleep(6)
    shot = await r.shot("04-cameras")
    d = json.loads(await r.js("JSON.stringify({cards: __tag('hk-camera-live-card').length,"
                              "pics: __deep(document, n=>n.localName==='img' && n.naturalWidth>0 && /camera_proxy/.test(n.src)).length})"))
    # open the first camera: its sheet starts WebRTC signalling through the client's port
    n_before = len(r.frames()[0])
    opened = await r.click("(function(){var m=__tag('hk-camera-live-card')[0]; if(!m) return null;"
                           "return __deep(m,n=>n.localName==='img')[0]||m;})()")
    await asyncio.sleep(10)
    shot2 = await r.shot("04b-camera-opened")
    sheet = await r.js("(function(){var s=__sheet(); return s ? __text(s).slice(0,120) : null;})()")
    sent, got = r.frames()
    ids = {i for i, m in sent.items() if str(m.get("type", "")).startswith("camera/")}
    cams: dict[str, int] = {}
    for i in ids:
        cams[sent[i]["type"]] = cams.get(sent[i]["type"], 0) + 1
    cam_err = sorted({(sent[i]["type"], (e or {}).get("code")) for i, ok, e in got if i in ids and ok is False})
    notallowed = [e for e in r.console_since(r.mark) if any(c in e for c in CODES)] + \
                 [x for x in cam_err if x[1] in ("not_allowed", "commands_disabled", "read_only")]
    refused = [m[:160] for m in r.b.console[r.mark:] if "[hk-doorbell] could not start" in m]
    r.record(4, "Cameras page: demo camera cards draw; a camera opens and signals WebRTC", d["cards"] >= 1 and d["pics"] >= 1 and bool(opened) and not notallowed,
             f"live cards {d['cards']}, pictures {d['pics']}, sheet '{sheet}', camera ws {cams}, HA answered {cam_err} "
             f"(demo cameras are HLS-only, so HA refuses WebRTC itself; that is not a client-port refusal), "
             f"card logged 'could not start' {len(refused)}x", [shot, shot2])
    await r.click("(function(){var s=__sheet(); return s && s.querySelector('.x');})()")


async def check_menu(r: Run):
    await r.ws("hk_frontend/board/set", dashboard="hk-phone", changes={"menu": "auto"})     # a crashed earlier run may have left the tab bar on
    # a narrow page: the menu is behind a button (hk-phone follows the house menu setting 'auto')
    await r.b.send("Emulation.setDeviceMetricsOverride", width=820, height=900, deviceScaleFactor=1, mobile=False)
    await r.goto("/hk-phone", "window.__tag('hk-menu-button-card').length>0")
    await asyncio.sleep(3)
    opened = await r.click("(function(){var m=__tag('hk-menu-button-card')[0]; return m && m.shadowRoot && m.shadowRoot.querySelector('hk-plate, ha-card');})()")
    await asyncio.sleep(2)
    shot = await r.shot("05-menu-open")
    badge = "(function(){var b=__deep(document,n=>n.classList&&n.classList.contains('bdg')&&n.getAttribute('data-badge')==='%s')[0]; return b? {t:b.textContent,h:b.hidden}:null;})()"
    rows = await r.js("__deep(document,n=>n.classList&&n.classList.contains('row')).map(n=>__text(n)).join('|')")
    n0 = await r.js(badge % "notif")
    s0 = await r.js(badge % "settings")
    await r.service("persistent_notification", "create", {"title": "HK scratch test", "message": "fictional", "notification_id": "hk_scratch_test"})
    await asyncio.sleep(3)
    n1 = await r.js(badge % "notif")
    shot2 = await r.shot("05b-menu-badge")
    await r.service("persistent_notification", "dismiss", {"notification_id": "hk_scratch_test"})
    await asyncio.sleep(2.5)
    n2 = await r.js(badge % "notif")
    up = n0 and n1 and int(n1["t"] or 0) == int(n0["t"] or 0) + 1 and not n1["h"]
    r.record(5, "Side menu opens; notification badge follows persistent_notification", bool(opened and rows and up),
             f"menu rows: {rows[:140]}; notif badge {n0} -> {n1} -> {n2}; settings badge {s0}", [shot, shot2])
    # a row navigates
    await r.click("__deep(document,n=>n.classList&&n.classList.contains('row')&&/^Lights$/.test(__text(n)))[0]")
    await asyncio.sleep(2)
    path = await r.js("location.pathname")
    r.results[-1]["menu_navigation"] = path
    print("        menu row 'Lights' ->", path)
    await r.b.send("Emulation.setDeviceMetricsOverride", width=r.b.width, height=r.b.height, deviceScaleFactor=1, mobile=False)


async def check_tabs(r: Run):
    await r.ws("hk_frontend/board/set", dashboard="hk-phone", changes={"menu": "tabbar"})
    await r.goto("/hk-phone", "document.querySelector('home-assistant') !== null && window.__deep(document,n=>n.id==='hk-tabbar').length>0")
    await asyncio.sleep(3)
    shot = await r.shot("06-tabbar")
    tabs = await r.js("__deep(document,n=>n.id==='hk-tabbar').map(n=>__text(n))[0]")
    paths = []
    for label in ("Lights", "Climate", "Home"):
        clicked = await r.click("(function(){var bar=__deep(document,n=>n.id==='hk-tabbar')[0]; if(!bar) return null;"
                                "var all=__deep(bar,n=>(n.localName==='button'||n.localName==='a'||n.classList.contains('tab'))&&/^%s$/.test(__text(n))); return all[0]||null;})()" % label)
        await asyncio.sleep(2)
        paths.append((label, clicked, await r.js("location.pathname")))
    ok = all(c for _, c, _ in paths) and paths[0][2].endswith("/lights") and paths[1][2].endswith("/climate")
    r.record(6, "Tab bar draws and navigates between pages", ok, f"tabs '{tabs}', clicks {paths}", [shot])
    await r.ws("hk_frontend/board/set", dashboard="hk-phone", changes={"menu": "auto"})
    # the HK Settings panel
    mark = r.mark
    await r.goto("/hk-settings", "window.__tag('hk-settings-panel').length>0", 60)
    await asyncio.sleep(5)
    shot2 = await r.shot("06b-hk-settings")
    txt = await r.js("__text(__tag('hk-settings-panel')[0]).slice(0,300)")
    d = len(txt or "")
    r.record("6b", "HK Settings panel opens", d > 40, f"panel text: {txt[:150]!r}", [shot2])
    # HK Frontend on its own shows HK Settings only (decision 27, docs/phase8/SETTINGS.md): no host's pages, no
    # Mantel tab, link, request or word, on any page -- including Mantel's own addresses and /admin's old ones
    seen = []
    for frag in ("#/", "#/screens/hk-wall", "#/add-screen", "#/mantel/people", "#/connections"):
        await r.js("location.hash = %s" % json.dumps(frag))
        await asyncio.sleep(1.5)
        seen.append(await r.js("(function(){var p=__tag('hk-settings-panel')[0]; var t=__text(p);"
                               "var links=__deep(p,n=>n.localName==='a').map(a=>a.getAttribute('href')||'');"
                               "return {frag: location.hash, title: (__deep(p,n=>n.localName==='h1')[0]||{}).textContent||'',"
                               "mantel: /mantel/i.test(t) || links.some(h=>/mantel|\\/admin|\\/settings(?!\\w)/i.test(h))};})()"))
    host = await r.js("JSON.stringify([window.hkShell.settingsHost(), window.hkShell.hostMenu()])")
    reqs = [u for u in (ev.get("params", {}).get("request", {}).get("url", "") for ev in r.b.events
                        if ev.get("method") == "Network.requestWillBeSent") if re.search(r"mantel|/api/admin|/settings\b", u, re.I)]
    sent = [m.get("type", "") for m in r.frames()[0].values() if "mantel" in str(m.get("type", "")).lower()]
    ok2 = not any(x["mantel"] for x in seen) and host == "[null,[]]" and not reqs and not sent
    r.record("6c", "HK Settings in HA has no Mantel tab, link, request or word", ok2,
             f"pages {[(x['frag'], x['title'], x['mantel']) for x in seen]}, host {host}, requests {reqs[:3]}, ws {sent[:3]}")


async def check_saver(r: Run):
    await r.goto("/hk-wall?hk_saver=force")
    await asyncio.sleep(3)
    started = await r.js("hkSaver.start()")
    await asyncio.sleep(4)
    clock = await r.shot("07-saver-clock")
    run1 = await r.js("hkSaver.running()")
    await r.js("hkSaver.stop()")
    await asyncio.sleep(1)
    await r.goto("/hk-wall?hk_saver=force")
    await asyncio.sleep(3)
    await r.js("hkSaver.preview(true,'weather')")        # HK Settings' own hook: the screensaver's weather screen
    await asyncio.sleep(9)
    wx = await r.shot("07b-saver-weather")
    st = json.loads(await r.js("JSON.stringify({running: hkSaver.running(), weather: hkSaver.stats().weatherSlide,"
                               "txt: __text(__tag('hk-screensaver')[0]).slice(0,300)})"))
    ft = r.ws_types().get("weather/subscribe_forecast", [0, 0])
    r.record(7, "Screensaver starts (force) and its weather screen draws", bool(started and run1 and st["weather"]),
             f"started {started}, running {run1}, weather screen showing {st['weather']}, forecast subscriptions {ft}, text: {st['txt'][:140]!r}", [clock, wx])
    await r.js("hkSaver.preview(false)")


async def check_race(r: Run, n=12):
    """HA's frontend import()s every extra module in parallel (index.html), so HK's bootstrap modules run in
    whatever order they finish loading. Count the loads where one threw because a module it needs had not run."""
    by: dict[str, int] = {}
    bad_loads = 0
    sample = []
    for i in range(n):
        start = len(r.b.console)
        await r.b.open(BASE + "/hk-scratch")
        await r.b.wait("window.__tag('hk-grid-view').length>0", 40)
        await asyncio.sleep(3)
        bad = [m for m in r.b.console[start:] if "Failed to load extra module" in m]
        bad_loads += bool(bad)
        for m in bad:
            mod = (re.search(r"module (\S+)", m) or [None, "?"])[1].rsplit("/", 1)[-1]
            by[mod] = by.get(mod, 0) + 1
            if len(sample) < 3 and not any(mod in x for x in sample):
                sample.append(m.split("\n")[0][:200])
    r.record(9, "Bootstrap modules survive HA's parallel extra-module load order", bad_loads == 0,
             f"{bad_loads}/{n} loads had a module fail to load: {by}", extra={"samples": sample})
    r.mark = len(r.b.console)


async def check_race_sim(r: Run):
    """The same race, made deterministic: hold one bootstrap file back for 2.5 s (as if it arrived last) and see
    what the HA build does. Only the file named is paused; nothing else is touched."""
    ent = "light.kitchen_lights"
    for n, slow in (("9b", "hk-host-shell.js"), ("9c", "hk-client.js")):
        async def hold(event, slow=slow):
            await asyncio.sleep(2.5)
            await r.b.send("Fetch.continueRequest", requestId=event["requestId"])
        r.b._check_request = hold
        await r.b.send("Fetch.enable", patterns=[{"urlPattern": "*/hk/modules/" + slow + "*", "requestStage": "Request"}])
        start = len(r.b.console)
        await r.b.open(BASE + "/hk-scratch/lights")
        drew = await r.b.wait("window.__tag('hk-grid-view').length>0", 25)
        await asyncio.sleep(5)
        kind = await r.js("window.hkShell && hkShell.kind")
        await r.click("(function(){var t=__tile('%s'); return t && t.shadowRoot.querySelector('[data-hk-role=name]');})()" % ent)
        await asyncio.sleep(2)
        sheet = await r.js("!!window.__sheet()")
        shot = await r.shot("09-sim-" + slow.replace(".js", ""))
        await r.b.send("Fetch.disable")
        msgs: dict[str, int] = {}
        for m in r.b.console[start:]:
            if m.startswith(("error", "EXCEPTION")):
                k = m.split("\n")[0][:150]
                msgs[k] = msgs.get(k, 0) + 1
        top = sorted(msgs.items(), key=lambda kv: -kv[1])[:6]
        r.record(n, f"Dashboard works when {slow} arrives last (held back 2.5 s)", bool(drew and sheet and not msgs),
                 f"dashboard drew {drew}, hkShell.kind {kind!r}, detail sheet opens {sheet}, errors {sum(msgs.values())}: {top}", [shot])
    r.mark = len(r.b.console)


def external_requests(b) -> list[str]:
    """URLs the page tried to reach other than 127.0.0.1:8124 (all fail: DNS is blocked)."""
    out = set()
    for ev in b.events:
        if ev.get("method") == "Network.requestWillBeSent":
            u = ev["params"]["request"]["url"]
            if u.startswith(("http://", "https://")) and not u.startswith(BASE):
                out.add(u[:140])
    return sorted(out)


def frontend_log_errors(since: int) -> list[str]:
    """HA logs every uncaught browser error ("[frontend.js.modern...] Uncaught error") with its stack."""
    try:
        text = testha.LOG.read_text(errors="replace")[since:]
    except OSError:
        return []
    out = []
    for block in text.split("\n20")[1:]:
        if "[frontend.js" in block:
            lines = block.splitlines()
            out.append((lines[1] if len(lines) > 1 else lines[0])[:120] + " @ " + (lines[2].strip() if len(lines) > 2 else ""))
    return out


async def main_async(a):
    shots = Path(a.shots)
    shots.mkdir(parents=True, exist_ok=True)
    c = testha.creds()
    if not c or not testha.ready():
        raise SystemExit("scratch HA is not running: run tools/testha/testha.py up first")
    async with aiohttp.ClientSession() as h:
        token = await testha.access_token(h)
        async with h.post(BASE + "/auth/token", data={"grant_type": "refresh_token", "client_id": BASE + "/",
                                                      "refresh_token": c["refresh_token"]}) as resp:
            tok = await resp.json()
    tok.update(hassUrl=BASE, clientId=BASE + "/", refresh_token=c["refresh_token"],
               expires=int(time.time() * 1000) + tok["expires_in"] * 1000)
    try:
        log0 = testha.LOG.stat().st_size
    except OSError:
        log0 = 0
    async with Browser(a.width, a.height, port=9333) as b:
        await b.send("Log.enable")
        if a.ordered:
            # list order, as the Python module list intends: host shell and client first, then what needs them,
            # then (Lovelace's) cards. Only holds; nothing is sped up or changed.
            async def late(event):
                await asyncio.sleep(2.0 if "/hk/cards/" in event["request"]["url"] else 0.4)
                await b.send("Fetch.continueRequest", requestId=event["requestId"])
            b._check_request = late
            late_files = ("hk-ha-shell.js", "hk-ha-client.js", "hk-card-state.js", "hk-metric.js", "hk-settings.js",
                          "tesla-viewport.js", "hk-loader.js", "hk-tap.js", "hk-header.js")
            await b.send("Fetch.enable", patterns=[{"urlPattern": "*/hk/modules/" + f + "*", "requestStage": "Request"} for f in late_files]
                         + [{"urlPattern": "*/hk/cards/*", "requestStage": "Request"}])
        await b.send("Page.addScriptToEvaluateOnNewDocument", source=HELPERS)
        await b.open(BASE + "/manifest.json")
        await asyncio.sleep(1)
        await b.eval("localStorage.setItem('hassTokens', %s)" % json.dumps(json.dumps(tok)))
        r = Run(b, shots, token)
        r.mark = 0
        names = {"home": check_home, "light": check_light, "weather": check_weather, "cameras": check_cameras,
                 "menu": check_menu, "tabs": check_tabs, "saver": check_saver, "race": check_race}
        only = [x for x in a.only.split(",") if x]
        for key, fn in names.items():
            if (only and key not in only) or (a.ordered and key == "race"):
                continue
            try:
                await fn(r)
            except Exception as e:                    # a broken check is a result, not a crash
                r.record(fn.__name__, fn.__name__, False, f"check raised {type(e).__name__}: {e}")
        # 8: the whole session, for the error codes that mean a client-port regression
        every = list(b.console)
        hits = [m for m in every if any(c in m for c in CODES)]
        wserr = r.ws_errors()
        codes_ws = [e for e in wserr if e[1] and e[1].get("code") in ("not_allowed", "read_only", "commands_disabled")]
        exc = [m for m in every if m.startswith("EXCEPTION")]
        r.record(8, "No not_allowed / read_only / commands_disabled / HKClient anywhere", not hits and not codes_ws,
                 f"console hits {len(hits)}, ws error frames {len(wserr)} (client-port codes {len(codes_ws)}), uncaught exceptions {len(exc)}")
        flog = frontend_log_errors(log0)
        every_before_sim = list(every)
        r.record("8b", "HA's own log: uncaught frontend errors reported by the browser", not flog,
                 f"{len(flog)} in hass.log since the run began" + (": " + "; ".join(flog[:4]) if flog else ""))
        try:
            if (not only or "sim" in only) and not a.ordered:
                await check_race_sim(r)           # after 8/8b: it breaks the build on purpose
        except Exception as e:
            r.record("9b", "race simulation", False, f"check raised {type(e).__name__}: {e}")
        summary = {"frontend_log_errors": flog, "ws_types": r.ws_types(), "ws_errors": [[t, e] for t, e in wserr], "http_failures": r.http_failures(),
                   "blocked_external": external_requests(b), "console_unexpected": [m for m in r.console_since(0) if m in every_before_sim][:60],
                   "exceptions": exc[:10]}
        print("blocked external requests:", summary["blocked_external"])
        print("ws errors:", summary["ws_errors"])
        print("http failures:", summary["http_failures"])
        (shots / "results.json").write_text(json.dumps({"results": r.results, **summary}, indent=1))
        print("wrote", shots / "results.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", default=str(testha.SCRATCH / "shots"))
    ap.add_argument("--only", default="", help="comma list of: home,light,weather,cameras,menu,tabs,saver,race,sim")
    ap.add_argument("--ordered", action="store_true",
                    help="hold back the modules that depend on hk-client.js / hk-host-shell.js by 0.4 s (and the cards by 2 s) so they run in "
                         "list order: checks the rest of the build independent of the load-order race (skips 9, 9b, 9c)")
    ap.add_argument("--width", type=int, default=1280)
    ap.add_argument("--height", type=int, default=900)
    asyncio.run(main_async(ap.parse_args()))


if __name__ == "__main__":
    main()
