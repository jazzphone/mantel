"""Offline smoke of Mantel's page as an HA App: under a fake Ingress prefix, behind a local stand-in for the
Supervisor's Ingress proxy, in an isolated headless Chrome. docs/phase3/HA-APP.md.

Run: .venv/bin/python tools/headless/ingress_smoke.py [--shot /tmp/ingress.png]

    Chrome --> 127.0.0.1:<proxy>/api/hassio_ingress/<token>/...   (the stand-in for HA + the Supervisor)
                 strips the prefix, adds X-Ingress-Path and X-Remote-User-* (the fictional Owner),
                 X-Forwarded-For/-Host/-Proto, and connects to Mantel FROM ::1
    Mantel  <-- [::1]:<port>   --ingress --ingress-only, Ingress peer ::1

127.0.0.2 is what a Linux test would use; macOS has no 127.0.0.2 without an lo0 alias (root), so the
IPv6 loopback stands in for the Supervisor's 172.30.32.2. Mantel also listens on 127.0.0.1, where a
request with forged X-Remote-User-* headers must be refused.

Checks: the page draws (view host, cards), 0 browser exceptions, the sign-in lands as the linked Owner
on door 'ha', the WebSocket and every request stay under the prefix (none reaches the stand-in's
"Home Assistant" side), HK navigation keeps the address under the prefix, a reload of the moved
address opens Mantel again, commands stay off, forged headers from elsewhere are refused.
No production token, DB, HA connection, fonts or captured personal fixtures are used.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import socket
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "hosts/server"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import aiohttp
from aiohttp import web
from cdp import Browser
from client_smoke import FICTIONAL_HA_SETTINGS, OfflineReads, stand_in_hk_feeds
from mantel_server import settings_store
from mantel_server.config import Config
from mantel_server.server import build_app
from mantel_server.sessions import Identity, User
from mantel_server.store import Store

TOKEN = "Fict1onal_Ingress-Token"
PREFIX = f"/api/hassio_ingress/{TOKEN}"
OWNER_HA = "0a1b2c3d4e5f60718293a4b5c6d7e8f9"
HOP = {"connection", "keep-alive", "transfer-encoding", "upgrade", "content-length", "content-encoding",
       "accept-encoding", "host", "proxy-connection", "te", "trailer"}
IDENTITY = ("x-remote-user-id", "x-remote-user-name", "x-remote-user-display-name", "x-ingress-path")


def free_port(host="127.0.0.1"):
    fam = socket.AF_INET6 if ":" in host else socket.AF_INET
    with socket.socket(fam) as s:
        s.bind((host, 0))
        return s.getsockname()[1]


class IngressStandIn:
    """What HA Core + the Supervisor do for an Ingress request, reduced to the parts Mantel sees."""

    def __init__(self, upstream_port: int):
        self.upstream = f"http://[::1]:{upstream_port}"
        self.escaped: list[str] = []        # requests outside the prefix: HA's own site would have answered
        self.seen: list[str] = []

    def headers(self, request: web.Request) -> dict:
        h = {k: v for k, v in request.headers.items() if k.lower() not in HOP and k.lower() not in IDENTITY
             and not k.lower().startswith("sec-websocket")}
        h["Host"] = request.host                                  # HA forwards the browser's Host
        h["X-Ingress-Path"] = PREFIX
        h["X-Remote-User-Id"] = OWNER_HA
        h["X-Remote-User-Name"] = "offline-owner"
        h["X-Remote-User-Display-Name"] = "Offline Owner"
        h["X-Forwarded-For"] = f"{request.remote}, 172.30.32.1"
        h["X-Forwarded-Host"] = request.host
        h["X-Forwarded-Proto"] = "http"
        return h

    async def handle(self, request: web.Request) -> web.StreamResponse:
        path = request.path
        if not (path == PREFIX or path.startswith(PREFIX + "/")):
            self.escaped.append(request.path_qs)
            return web.Response(status=404, text="(Home Assistant's own site)")
        tail = path[len(PREFIX):] or "/"
        self.seen.append(tail)
        url = self.upstream + tail + (f"?{request.query_string}" if request.query_string else "")
        session: aiohttp.ClientSession = request.app["session"]
        if request.headers.get("Upgrade", "").lower() == "websocket":
            return await self.websocket(request, session, url)
        body = await request.read()
        async with session.request(request.method, url, headers=self.headers(request), data=body or None,
                                   allow_redirects=False) as up:
            out = web.StreamResponse(status=up.status)
            for k, v in up.headers.items():
                if k.lower() not in HOP:
                    out.headers.add(k, v)
            await out.prepare(request)
            async for chunk in up.content.iter_chunked(65536):
                await out.write(chunk)
            await out.write_eof()
            return out

    async def websocket(self, request, session, url):
        ws_up = await session.ws_connect(url.replace("http://", "ws://", 1), headers=self.headers(request),
                                         max_msg_size=0)
        ws = web.WebSocketResponse(max_msg_size=0)
        await ws.prepare(request)

        async def pump(src, dst):
            async for m in src:
                if m.type == aiohttp.WSMsgType.TEXT:
                    await dst.send_str(m.data)
                elif m.type == aiohttp.WSMsgType.BINARY:
                    await dst.send_bytes(m.data)
                else:
                    break
            await dst.close()
        await asyncio.gather(pump(ws, ws_up), pump(ws_up, ws), return_exceptions=True)
        return ws


async def smoke(shot=None):
    with tempfile.TemporaryDirectory(prefix="mantel-ingress-smoke-") as folder:
        base = Path(folder)
        mantel_port, proxy_port = free_port("::1"), free_port()
        cfg = Config(data_dir=base / "data", secrets_dir=base / "secrets", fixtures=base / "fixtures",
                     hk_files=base / "user-files", default_screen="dashboard-proof", port=mantel_port,
                     ingress=True, ingress_peers=("::1",), ingress_only=True)
        store = Store(cfg.data_dir / "proof.db")
        store.link(OWNER_HA, "owner", "Offline Owner")
        app = build_app(cfg, "unused-offline-token", store=store, connect_ha=False)
        hub = app["hub"]
        owner = Identity(User(store.get_link(OWNER_HA)["user_id"], "Offline Owner", "owner", "ha_linked"), None, "ha")
        settings = settings_store.register(app, hub, settings_store.SettingsHooks(
            may_configure=settings_store.rbac_may_configure()), model=settings_store.ThinModel())

        async def fictional_ha():
            return json.loads(json.dumps(FICTIONAL_HA_SETTINGS))
        await settings_store.import_settings(settings.store, fictional_ha, actor=settings_store.Actor(label="smoke"))
        hub.readproxy = OfflineReads(app, owner)
        stand_in_hk_feeds(app, hub.readproxy)
        hub.store.apply_event({"a": {
            "sensor.proof": {"s": "21.4", "a": {"friendly_name": "Offline temperature", "unit_of_measurement": "°C"},
                             "lc": 1.0, "lu": 1.0},
            "light.proof": {"s": "off", "a": {"friendly_name": "Offline lamp", "supported_color_modes": ["brightness"]},
                            "lc": 1.0, "lu": 1.0},
            "scene.proof_evening": {"s": "unknown", "a": {"friendly_name": "Offline evening"}, "lc": 1.0, "lu": 1.0}}})
        hub.registry.load([], [], [{"entity_id": "sensor.proof", "platform": "demo"},
                                   {"entity_id": "light.proof", "platform": "demo"},
                                   {"entity_id": "scene.proof_evening", "platform": "demo"}])
        runner = web.AppRunner(app, access_log=None)
        await runner.setup()
        direct_port = free_port()
        for host, port in (("::1", mantel_port), ("127.0.0.1", direct_port)):
            await web.TCPSite(runner, host, port).start()
        stand_in = IngressStandIn(mantel_port)
        proxy = web.Application()
        proxy.router.add_route("*", "/{tail:.*}", stand_in.handle)

        async def session_ctx(a):
            async with aiohttp.ClientSession(auto_decompress=False) as s:
                a["session"] = s
                yield
        proxy.cleanup_ctx.append(session_ctx)
        prunner = web.AppRunner(proxy, access_log=None)
        await prunner.setup()
        await web.TCPSite(prunner, "127.0.0.1", proxy_port).start()
        origin = f"http://127.0.0.1:{proxy_port}"
        try:
            # forged identity headers straight to Mantel (not from the Ingress peer): refused
            async with aiohttp.ClientSession() as http:
                async with http.get(f"http://127.0.0.1:{direct_port}/api/me", headers={
                        "X-Remote-User-Id": OWNER_HA, "X-Ingress-Path": PREFIX}) as r:
                    forged = r.status
                async with http.get(f"http://127.0.0.1:{direct_port}/healthz") as r:
                    health = r.status
            assert forged == 403 and health == 200, (forged, health)
            async with Browser(port=free_port()) as browser:
                await browser.restrict_origin(origin)
                await browser.send("Page.navigate", url=origin + PREFIX + "/?narrow=0")
                if not await browser.wait("window.__mantelReady === true", 30):
                    raise AssertionError("Home did not load under the prefix: " + json.dumps(browser.console[-15:]))
                where = await browser.eval("({path: location.pathname, base: window.__mantelBase})")
                assert where == {"path": PREFIX + "/dashboard-proof/home", "base": PREFIX}, where
                me = await browser.eval(f"fetch('{PREFIX}/api/session').then(r => r.json())")
                assert me["user"]["role"] == "owner" and me["user"]["name"] == "Offline Owner" and me["door"] == "ha" \
                    and me["user"]["ha_user_id"] == OWNER_HA and me["session_id"], me
                cookie_path = await browser.send("Network.getCookies", urls=[origin + PREFIX + "/"])
                paths = sorted({c["path"] for c in cookie_path["cookies"]})
                assert paths == [PREFIX + "/"], paths
                drawn = await browser.eval("""(() => {
                  const cur = window.__mantelViewHost.current();
                  const cards = cur.cards;
                  return { path: cur.path, cards: cards.length,
                           drawn: cards.filter(c => c.isConnected && !c.hidden && c.localName !== 'hk-card-placeholder' &&
                                  ((c.shadowRoot && c.shadowRoot.childNodes.length > 0) || c.childNodes.length > 0)).length,
                           placeholders: cards.filter(c => c.localName === 'hk-card-placeholder').length,
                           sky: !!document.querySelector('hk-view-container#view > #hk-sky') };
                })()""")
                assert drawn["path"] == "home" and drawn["drawn"] >= 1 and drawn["placeholders"] == 0 and drawn["sky"], drawn
                # a card fed by the hub over the prefixed WebSocket follows a change
                await browser.eval("""(() => {
                  const m = window.hkViewHost.createCardElement({type:'custom:hk-stat-card',entity:'sensor.proof'}, window.__mantel.client);
                  document.getElementById('view').prepend(m);
                  window.__mantelOnSnapshot = () => window.hkHostClient.bridge(m, window.__mantel.client);
                  window.__proofMetric = m;
                })()""")
                text = "window.__proofMetric._e.state.textContent"
                assert await browser.wait(text + " === '21.4 °C'", 5), await browser.eval(text)
                hub.store.apply_event({"c": {"sensor.proof": {"+": {"s": "22.8", "lu": 2.0}}}})
                hub.on_change({"sensor.proof"})
                assert await browser.wait(text + " === '22.8 °C'", 5), "the update did not arrive over the prefixed socket"
                # HK's own navigation stays under the prefix; back returns Home
                await browser.eval("window.hkShell.navigate('/dashboard-proof/lights')")
                assert await browser.wait("window.__mantelViewHost.current().path === 'lights'", 10), browser.console[-10:]
                moved = await browser.eval("location.pathname")
                assert moved == PREFIX + "/dashboard-proof/lights", moved
                await browser.eval("history.back()")
                assert await browser.wait("window.__mantelViewHost.current().path === 'home'", 10)
                # a reload of a moved address opens Mantel again (not HA's own page)
                await browser.send("Page.navigate", url=origin + moved)
                if not await browser.wait("window.__mantelReady === true && "
                                          "window.__mantelViewHost.current().path === 'lights'", 30):
                    raise AssertionError("reload under the prefix failed: " + json.dumps(browser.console[-15:]))
                # commands are off: the action port refuses and nothing is sent
                refused = await browser.eval("""(async () => {
                  try { await window.__mantel.client.actions.callService('light', 'turn_on', {entity_id: 'light.proof'}); return 'sent'; }
                  catch (e) { return e.code; }
                })()""")
                assert refused == "commands_disabled", refused
                urls = [e["params"]["request"]["url"] for e in browser.events
                        if e.get("method") == "Network.requestWillBeSent"]
                # Chrome's own favicon probe of a top-level tab is not the page's (inside HA's sidebar the page is
                # an iframe and there is none); everything the page itself asks for must stay under the prefix
                outside = [u for u in urls if u.startswith("http") and not u.startswith(origin + PREFIX)
                           and u != origin + "/favicon.ico"]
                stand_in.escaped[:] = [u for u in stand_in.escaped if u != "/favicon.ico"]
                exceptions = [line for line in browser.console if line.startswith("EXCEPTION:")]
                assert not outside, outside
                assert not stand_in.escaped, stand_in.escaped
                assert not exceptions, exceptions
                assert not browser.blocked_requests, browser.blocked_requests
                sessions_made = store.db.execute("SELECT COUNT(*), MIN(method), MIN(door) FROM sessions").fetchone()
                if shot:
                    await browser.screenshot(shot)
                ws_seen = sum(1 for t in stand_in.seen if t.startswith("/ws"))
            return {"page": "drawn under " + PREFIX + "/dashboard-proof/home", "cards_drawn": drawn["drawn"],
                    "signed_in_as": f"{me['user']['name']} ({me['user']['role']}), door {me['door']}",
                    "cookies_path": paths[0], "sessions": tuple(sessions_made), "websocket_through_prefix": ws_seen,
                    "requests": len(urls), "requests_outside_prefix": 0, "escaped_to_ha": 0,
                    "navigation": f"{moved} then back to home; reload of {moved} drew Lights",
                    "live_update": "21.4 °C -> 22.8 °C", "commands": refused,
                    "forged_headers_direct": forged, "browser_exceptions": 0, "external_requests": 0}
        finally:
            await prunner.cleanup()
            await runner.cleanup()
            store.db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--shot")
    print(json.dumps(asyncio.run(smoke(parser.parse_args().shot)), indent=2))
