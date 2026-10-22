"""A fictional Mantel on this Mac for the iPhone/iPad/Mac apps in the Simulator (docs/phase10/APPLE-APPS.md, apple/README.md).

Run: .venv/bin/python tools/app_dev_server.py --data-dir /tmp/mantel-app-dev [--port 8766]

* Listens on 127.0.0.1 only, over plain http (the apps accept http for a loopback address only). The Simulator
  shares the Mac's network, so the app reaches it at http://127.0.0.1:<port>.
* No Home Assistant: a fictional house (a few lights, a lock, a speaker) lives in memory. Commands are ON, through
  Mantel's real gateway (RBAC, audit rows), but the command connection is a fake that only changes those
  fictional states. Nothing leaves this Mac.
* Signs in nobody by itself: it creates the fictional Owner "ann" (password printed once) and prints a pairing
  link to open in the Simulator (``xcrun simctl openurl booted '<link>'``), which signs the app in as ann.
* ``--push "Title|Body"`` (with the server stopped or running) writes a sealed notification for the app's
  registered notification key to <data-dir>/push.apns, for ``xcrun simctl push booted com.jazzphone.mantel.ios <file>``.
* ``--music``: the house's Music page too (the screens' playmusic: browse, speakers, volume, queue). A fictional
  Music Assistant (tests/music_fakes.py's HouseMa) answers on another loopback port; its speakers join the house
  and Mantel's own music engine runs, so the page's commands go through the gateway (audit rows) to that fake.
* ``--slow MS``: a slow connection: every script and stylesheet under /hk/ and /web/, and every message on the
  page's live socket, is MS milliseconds late (a page change that waits on the house shows what it does meanwhile).
* ``--busy``: a house that is never still, as a real one is (power readings, players): the kitchen light's
  brightness moves a little twice a second, so the page gets a state change about every 500 ms.
* ``--lan``: also answer on this Mac's home-network address, over plain http, for a DEBUG build of the app on a real
  iPhone (Release builds refuse http beyond loopback). Requests from private addresses are the
  LAN door. Writes the pairing link as a QR code (<data-dir>/pair.png) to scan with the iPhone's camera.
* ``--relay https://…workers.dev``: the house sends through the push relay (packaging/push-relay/); the app then
  registers with the relay and gives this house only a handle.
* ``--send-push "Title|Body"``: a REAL push to the phone that registered last: through the relay when the phone
  registered a relay handle, else directly with the team's APNs key from ~/.config/mantel/secrets (apns_key.p8,
  apns.json; never printed; needs httpx[http2]).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import secrets
import sqlite3
import sys
import time
from pathlib import Path

from aiohttp import web
from urllib.parse import quote, urlencode

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "hosts/server"))

AREAS = [{"area_id": "kitchen", "name": "Kitchen"}, {"area_id": "living_room", "name": "Living Room"},
         {"area_id": "porch", "name": "Porch"}]
ENTITIES = [{"entity_id": "light.kitchen", "area_id": "kitchen"}, {"entity_id": "light.living_room", "area_id": "living_room"},
            {"entity_id": "lock.front_door", "area_id": "porch"}, {"entity_id": "media_player.living_room", "area_id": "living_room"},
            {"entity_id": "switch.porch_lights", "area_id": "porch"}, {"entity_id": "scene.movie_night", "area_id": "living_room"}]
STATES = {
    "light.kitchen": {"s": "on", "a": {"friendly_name": "Kitchen", "brightness": 180}},
    "light.living_room": {"s": "off", "a": {"friendly_name": "Living Room"}},
    "lock.front_door": {"s": "locked", "a": {"friendly_name": "Front Door"}},
    "switch.porch_lights": {"s": "off", "a": {"friendly_name": "Porch Lights"}},
    "scene.movie_night": {"s": "scening", "a": {"friendly_name": "Movie Night"}},
    "media_player.living_room": {"s": "playing", "a": {"friendly_name": "Living Room Speaker", "media_title": "So What",
                                                         "media_artist": "Miles Davis", "volume_level": 0.3,
                                                         "media_album_name": "Kind of Blue", "media_duration": 562.0,
                                                         "media_position": 95.0}},
}
FLIP = {("light", "turn_on"): "on", ("light", "turn_off"): "off", ("switch", "turn_on"): "on", ("switch", "turn_off"): "off",
        ("lock", "lock"): "locked", ("lock", "unlock"): "unlocked"}


class FictionalCommander:
    """The gateway's command connection, standing in for Home Assistant: it changes the fictional states only."""

    def __init__(self, hub, writes):
        self.hub = hub
        self.writes = frozenset(writes)

    async def call(self, frame, ticket):
        from mantel_server.ha_client import check_command
        check_command(frame, ticket, self.writes)
        domain, service = frame.get("domain"), frame.get("service")
        data = frame.get("service_data") or {}
        targets = (frame.get("target") or {}).get("entity_id") or data.get("entity_id") or []
        for eid in [targets] if isinstance(targets, str) else targets:
            st = self.hub.store.states.get(eid)
            if st is None:
                continue
            new = FLIP.get((eid.split(".")[0] if domain == "homeassistant" else domain,
                            {"toggle": "turn_off" if st["s"] == "on" else "turn_on"}.get(service, service)))
            if domain == "media_player":
                new = {"media_play_pause": "paused" if st["s"] == "playing" else "playing", "media_play": "playing",
                       "media_pause": "paused"}.get(service, st["s"])
                if service == "volume_set":
                    self.hub.store.apply_event({"c": {eid: {"+": {"a": {"volume_level": data.get("volume_level")}}}}})
            if new and new != st["s"]:
                self.hub.store.apply_event({"c": {eid: {"+": {"s": new, "lc": time.time()}}}})
            self.hub.on_change({eid})
            print(f"  fictional command: {domain}.{service} on {eid} -> {self.hub.store.states[eid]['s']}")
        return {"context": {"id": "fictional"}, "response": None}

    async def http(self, *a):
        return {"ok": True}

    async def upload(self, *a):
        return {"ok": True}

    async def close(self):
        pass


def lan_address() -> str:
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 9))          # no packet is sent: this only picks the interface for the route
        return s.getsockname()[0]
    finally:
        s.close()


def private(ip: str | None) -> bool:
    from ipaddress import ip_address
    try:
        a = ip_address(ip or "")
    except ValueError:
        return False
    return a.is_private or a.is_loopback


async def fictional_ma() -> tuple[object, str]:
    """tests/music_fakes.py's fictional Music Assistant on a loopback port: (the fake, its WebSocket address)."""
    sys.path.insert(0, str(ROOT / "tests"))
    import music_fakes as MF
    fake = MF.HouseMa()
    runner = web.AppRunner(fake.app())
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    return fake, f"http://127.0.0.1:{port}/ws"


async def serve(data: Path, port: int, lan: bool = False, relay: str | None = None, music: bool = False,
                slow: int = 0, busy: bool = False) -> None:
    from mantel_server import app_auth
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.store import Store

    lan_ip = lan_address() if lan else None
    ma_fake, ma = None, {}
    if music:
        ma_fake, ma_url = await fictional_ma()
        from connector_fakes import MA_TOKEN
        token = data / "secrets" / "ma_token"
        token.parent.mkdir(parents=True, exist_ok=True)
        token.write_text(MA_TOKEN)           # the fake's fictional token
        ma = {"ma_url": ma_url, "ma_token_file": token}
    cfg = Config(data_dir=data / "data", secrets_dir=data / "secrets", host="127.0.0.1", port=port,
                 ha_url="http://127.0.0.1:9", commands_enabled=True, default_screen="dashboard-home",
                 allowed_hosts=(lan_ip,) if lan_ip else (), **ma)
    store = Store(cfg.data_dir / "mantel.db")
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False)
    if lan_ip:
        # the home network is the LAN door here (no proxy stamps one), and cookies over plain http are not Secure
        app["door_resolver"] = lambda request: "lan" if private(request.remote) else "tunnel"

        @web.middleware
        async def plain_http(request, handler):
            request["cookie_secure"] = False
            return await handler(request)
        app.middlewares.insert(0, plain_http)
    if slow > 0:
        @web.middleware
        async def slow_code(request, handler):
            if request.path.startswith(("/hk/", "/web/")) and request.path.endswith((".js", ".css")):
                await asyncio.sleep(slow / 1000)
            return await handler(request)
        app.middlewares.insert(0, slow_code)
        # ...and the house's live messages (the page's states: a first visit to a page waits for a snapshot)
        _send = web.WebSocketResponse.send_str

        async def slow_send(self, data, *args, **kw):
            await asyncio.sleep(slow / 1000)
            return await _send(self, data, *args, **kw)
        web.WebSocketResponse.send_str = slow_send
    hub = app["hub"]
    hub.registry.load(AREAS, [], ENTITIES)
    hub.store.apply_event({"a": {k: {"s": v["s"], "a": dict(v["a"]), "lc": time.time() - 3600} for k, v in STATES.items()}})
    if ma_fake is not None:
        import music_fakes as MF
        from mantel_server import music as M
        from mantel_server.settings_store import Actor
        known = {a["area_id"] for a in AREAS}
        hub.registry.load(AREAS + [a for a in MF.AREAS if a["area_id"] not in known], [], ENTITIES + MF.ENTITIES, MF.FLOORS)
        hub.store.apply_event({"a": MF.states(media_player__den_ma={"s": "playing", "a": {
            "media_title": "Blue in Green", "media_artist": "The Fictional Trio", "media_album_name": "Kind of Fictional",
            "media_duration": 337.0, "media_position": 40.0, "volume_level": 0.25,
            "media_position_updated_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime()),
            "entity_picture": f"http://{lan_ip or '127.0.0.1'}:{port}/app/fictional-cover.png"}})})
        ma_fake.hub = hub
        app["settings"].store.write([("house", M.MUSIC_DOC, json.loads(json.dumps(MF.DOC)))], actor=Actor(label="app_dev_server"))
    # a fictional album cover, served by this server itself (a "remote" picture, as a provider's CDN would be)
    hub.store.apply_event({"c": {"media_player.living_room": {"+": {"a": {
        "entity_picture": f"http://{lan_ip or '127.0.0.1'}:{port}/app/fictional-cover.png",
        "media_position_updated_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())}}}}})

    async def cover(request):
        return web.FileResponse(data / "fictional-cover.png")
    make_cover(data / "fictional-cover.png")
    app.router.add_get("/app/fictional-cover.png", cover)
    app.setdefault("public_paths", set()).add("/app/fictional-cover.png")
    if app.get("gateway") is None:     # control switched off in Mantel Settings on an earlier run: on again here
        await app["server_settings"].set("commands_enabled", True, None, time.time())
    app["gateway"].commander = FictionalCommander(hub, app["gateway"].writes)
    # Without --music: Music "set up" with the fictional speaker, as HK's music feed answers on a house with Music
    # Assistant, so the Music page (Play, the full player on a phone) is there to try; its library stays empty
    from mantel_server.connectors import Route

    async def music_request(ctx, msg):
        return {}

    async def music_subscribe(ctx, msg, on_event):
        asyncio.get_running_loop().call_soon(on_event, {"configured": True, "library_entry": "fictional", "speakers": [
            {"name": "Living Room Speaker", "entity": "media_player.living_room"}]})

        async def unsubscribe():
            return None
        return unsubscribe
    if not music:          # (--music: Mantel's own music engine answers it, with the fictional Music Assistant)
        app["read_routes"]["hk_music/subscribe"] = Route(request=music_request, subscribe=music_subscribe)
    if busy:
        async def churn():
            n = 0
            while True:
                await asyncio.sleep(0.5)
                n += 1
                hub.store.apply_event({"c": {"light.kitchen": {"+": {"a": {"brightness": 170 + n % 10}}}}})
        async def start_churn(_app):
            _app["churn"] = asyncio.ensure_future(churn())
        app.on_startup.append(start_churn)
    acc = app["accounts"]
    row = store.db.execute("SELECT id FROM users WHERE username = 'ann'").fetchone()
    if row is None:
        password = secrets.token_urlsafe(12)
        user = await acc.create_user("ann", "Ann Example", "owner", password)
        uid = user.id if hasattr(user, "id") else user
        (data / "ann-password.txt").write_text(password + "\n")          # a throwaway local account; never printed
        (data / "ann-password.txt").chmod(0o600)
        print("Created the fictional Owner 'ann' (password in ann-password.txt)")
        app["user_data"].set(f"u:{uid}", "favorites", ["light.kitchen", "light.living_room", "lock.front_door",
                                                       "switch.porch_lights", "scene.movie_night"])
        app["user_data"].set(f"u:{uid}", "hk_music_focus", {"key": "media_player.living_room"})
    else:
        uid = row["id"]
    if music:
        app["user_data"].set(f"u:{uid}", "hk_music_focus", {"key": "media_player.den_ma"})
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", port).start()
    if lan_ip:
        await web.TCPSite(runner, lan_ip, port).start()
    st: app_auth.AppAuth = app["app_auth"]
    origin = f"http://{lan_ip or '127.0.0.1'}:{port}"
    st.set_setting("local_url", origin)
    if relay:
        from mantel_server import apns
        st.set_setting(apns.RELAY_SETTING, relay)
        print("Notifications go through the push relay at", relay)
    code = st.codes.make(3600, kind="pairing", user_id=uid)
    link = "mantel://pair?" + urlencode({"v": "1", "l": origin, "fp": st.fingerprint(), "c": code,
                                          "n": "The Example House"}, quote_via=quote)
    (data / "pair.txt").write_text(link + "\n")
    if lan_ip:
        write_qr(link, data / "pair.png")
        print("Pairing QR code:", data / "pair.png")
    print(f"Fictional Mantel at {origin} (six digits: {st.fingerprint() and __import__('mantel_server.app_crypto', fromlist=['x']).short_code(st.fingerprint())})")
    print("Pairing link (one hour, once):", link)
    await asyncio.Event().wait()


def write_qr(text: str, path: Path) -> None:
    from PIL import Image
    from mantel_server import qr
    m = qr.encode(text)
    s, b = 10, 4
    n = len(m) + 2 * b
    img = Image.new("L", (n * s, n * s), 255)
    for y, row in enumerate(m):
        for x, v in enumerate(row):
            if v:
                img.paste(0, ((x + b) * s, (y + b) * s, (x + b + 1) * s, (y + b + 1) * s))
    img.save(path)


async def send_push(data: Path, text: str) -> None:
    from mantel_server import apns, push
    db = sqlite3.connect(data / "data" / "mantel.db")
    db.row_factory = sqlite3.Row
    row = db.execute("SELECT * FROM push_targets WHERE kind = 'apns' ORDER BY created DESC LIMIT 1").fetchone()
    if row is None:
        raise SystemExit("No app has registered for notifications yet.")
    title, _, body = text.partition("|")
    msg = push.Message(title=title, body=body, tag="real", important=True, entity="lock.front_door", url="/home")
    if row["env"] == "relay":
        from mantel_server.config import Config
        from mantel_server.server import build_app
        from mantel_server.store import Store
        cfg = Config(data_dir=data / "data", secrets_dir=data / "secrets", ha_url="http://127.0.0.1:9")
        store = Store(cfg.data_dir / "mantel.db")
        app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False)
        result = await app["push_relay"].send(dict(row), msg)
        print(f"through the relay: {result}")
        return
    sender = apns.Apns(Path("~/.config/mantel/secrets"))
    if sender.config() is None:
        raise SystemExit("No APNs key in ~/.config/mantel/secrets (apns_key.p8 + apns.json).")
    result = await sender.send(dict(row), msg)
    print(f"APNs ({row['env']}): {result}")


def make_cover(path: Path) -> None:
    """A fictional album cover (blue, with rings), drawn here: no real artwork is used."""
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (600, 600), (18, 52, 110))
    d = ImageDraw.Draw(img)
    for i, c in enumerate([(30, 90, 170), (60, 130, 200), (230, 190, 90), (240, 240, 230)]):
        r = 260 - i * 60
        d.ellipse([300 - r, 300 - r, 300 + r, 300 + r], outline=c, width=18)
    img.save(path)


def make_push(data: Path, text: str) -> Path:
    from mantel_server import apns, push
    db = sqlite3.connect(data / "data" / "mantel.db")
    db.row_factory = sqlite3.Row
    row = db.execute("SELECT p256dh FROM push_targets WHERE kind = 'apns' ORDER BY created DESC LIMIT 1").fetchone()
    if row is None:
        raise SystemExit("No app has registered for notifications yet (open the app and turn notifications on).")
    title, _, body = text.partition("|")
    msg = push.Message(title=title, body=body, tag="sim", important=True, entity="lock.front_door", url="/home")
    payload = apns.build_payload(msg, push.app_crypto.unb64u(row["p256dh"]))
    out = data / "push.apns"
    out.write_text(json.dumps({"Simulator Target Bundle": "com.jazzphone.mantel.ios", **payload}, indent=2))
    print("wrote", out)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", type=Path, required=True)
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--push")
    ap.add_argument("--send-push")
    ap.add_argument("--lan", action="store_true")
    ap.add_argument("--relay")
    ap.add_argument("--music", action="store_true")
    ap.add_argument("--slow", type=int, default=0)
    ap.add_argument("--busy", action="store_true")
    a = ap.parse_args()
    a.data_dir.mkdir(parents=True, exist_ok=True)
    if a.push:
        make_push(a.data_dir, a.push)
        return
    if a.send_push:
        asyncio.run(send_push(a.data_dir, a.send_push))
        return
    asyncio.run(serve(a.data_dir, a.port, a.lan, a.relay, a.music, a.slow, a.busy))


if __name__ == "__main__":
    main()
