"""A fictional Mantel on this Mac for the iPhone/iPad/Mac apps in the Simulator (docs/phase10/APPLE-APPS.md, apple/README.md).

Run: ~/.venvs/mantel/bin/python tools/app_dev_server.py --data-dir /tmp/mantel-app-dev [--port 8766]

* Listens on 127.0.0.1 only, over plain http (the apps accept http for a loopback address only). The Simulator
  shares the Mac's network, so the app reaches it at http://127.0.0.1:<port>.
* No Home Assistant: a fictional house (a few lights, a lock, a speaker) lives in memory. Commands are ON, through
  Mantel's real gateway (RBAC, audit rows), but the command connection is a fake that only changes those
  fictional states. Nothing leaves this Mac.
* Signs in nobody by itself: it creates the fictional Owner "ann" (password printed once) and prints a pairing
  link to open in the Simulator (``xcrun simctl openurl booted '<link>'``), which signs the app in as ann.
* ``--push "Title|Body"`` (with the server stopped or running) writes a sealed notification for the app's
  registered notification key to <data-dir>/push.apns, for ``xcrun simctl push booted app.mantel.ios <file>``.
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


async def serve(data: Path, port: int) -> None:
    from aiohttp import web
    from mantel_server import app_auth
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.store import Store

    cfg = Config(data_dir=data / "data", secrets_dir=data / "secrets", host="127.0.0.1", port=port,
                 ha_url="http://127.0.0.1:9", commands_enabled=True, default_screen="dashboard-home")
    store = Store(cfg.data_dir / "mantel.db")
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False)
    hub = app["hub"]
    hub.registry.load(AREAS, [], ENTITIES)
    hub.store.apply_event({"a": {k: {"s": v["s"], "a": dict(v["a"]), "lc": time.time() - 3600} for k, v in STATES.items()}})
    # a fictional album cover, served by this server itself (a "remote" picture, as a provider's CDN would be)
    hub.store.apply_event({"c": {"media_player.living_room": {"+": {"a": {
        "entity_picture": f"http://127.0.0.1:{port}/app/fictional-cover.png",
        "media_position_updated_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime())}}}}})

    async def cover(request):
        return web.FileResponse(data / "fictional-cover.png")
    make_cover(data / "fictional-cover.png")
    app.router.add_get("/app/fictional-cover.png", cover)
    app.setdefault("public_paths", set()).add("/app/fictional-cover.png")
    app["gateway"].commander = FictionalCommander(hub, app["gateway"].writes)
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
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", port).start()
    st: app_auth.AppAuth = app["app_auth"]
    origin = f"http://127.0.0.1:{port}"
    st.set_setting("local_url", origin)
    code = st.codes.make(3600, kind="pairing", user_id=uid)
    link = "mantel://pair?" + urlencode({"v": "1", "l": origin, "fp": st.fingerprint(), "c": code,
                                          "n": "The Example House"}, quote_via=quote)
    (data / "pair.txt").write_text(link + "\n")
    print(f"Fictional Mantel at {origin} (six digits: {st.fingerprint() and __import__('mantel_server.app_crypto', fromlist=['x']).short_code(st.fingerprint())})")
    print("Pairing link (one hour, once):", link)
    await asyncio.Event().wait()


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
    out.write_text(json.dumps({"Simulator Target Bundle": "app.mantel.ios", **payload}, indent=2))
    print("wrote", out)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", type=Path, required=True)
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--push")
    a = ap.parse_args()
    a.data_dir.mkdir(parents=True, exist_ok=True)
    if a.push:
        make_push(a.data_dir, a.push)
        return
    asyncio.run(serve(a.data_dir, a.port))


if __name__ == "__main__":
    main()
