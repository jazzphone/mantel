"""Screenshots for the docs, from a fictional house: a real Mantel Server, a made-up home, headless Chrome.

    python tools/headless/gallery.py [--out docs/images] [--only NAME ...] [--list]

Nothing real is involved: no Home Assistant, no network beyond 127.0.0.1 (cdp.Browser.restrict_origin), and the
house, its people and its music are invented here. The pages are Mantel's own, drawn as a signed-in Owner.

Fonts: Apple's SF Pro never ships (README "Rules"), so the shots use the browser's fallback font unless this
machine has SF Pro installed. Chrome: $CHROME, else macOS's Google Chrome, else Chrome/Chromium on PATH (cdp.py).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "hosts/server"))
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(ROOT / "tools"))

from aiohttp.test_utils import TestServer  # noqa: E402

from cdp import Browser  # noqa: E402
from client_smoke import FictionalLibrary, OfflineReads, stand_in_cameras, stand_in_hk_feeds  # noqa: E402

SCREEN = "dashboard-home"
NOW = time.time()

FLOORS = [{"floor_id": "main", "name": "Main Floor", "level": 0}, {"floor_id": "upstairs", "name": "Upstairs", "level": 1},
          {"floor_id": "outside", "name": "Outside", "level": 2}]
ROOMS = [("living_room", "Living Room", "main"), ("kitchen", "Kitchen", "main"), ("dining_room", "Dining Room", "main"),
         ("office", "Office", "main"), ("bedroom", "Bedroom", "upstairs"), ("guest_room", "Guest Room", "upstairs"),
         ("porch", "Porch", "outside"), ("garage", "Garage", "outside"), ("backyard", "Backyard", "outside")]


def _light(name, on, pct=70, color=False):
    a = {"friendly_name": name, "supported_color_modes": ["hs", "color_temp"] if color else ["brightness"],
         "color_mode": ("hs" if color else "brightness") if on else None}
    if on:
        a["brightness"] = round(pct * 2.55)
        if color:
            a["hs_color"] = [32.0, 60.0]
    return "on" if on else "off", a


def _sensor(name, value, unit, device_class):
    return str(value), {"friendly_name": name, "unit_of_measurement": unit, "device_class": device_class,
                        "state_class": "measurement"}


def _climate(name, current, target, action):
    return "heat_cool", {"friendly_name": name, "current_temperature": current, "target_temp_low": target - 2,
                         "target_temp_high": target + 2, "temperature": None, "hvac_action": action,
                         "hvac_modes": ["off", "heat", "cool", "heat_cool"], "min_temp": 50, "max_temp": 90,
                         "supported_features": 26, "current_humidity": 44}


# entity_id -> (area, (state, attributes))
HOUSE = {
    "light.living_room_lamps": ("living_room", _light("Lamps", True, 60, color=True)),
    "light.living_room_ceiling": ("living_room", _light("Ceiling Light", False)),
    "light.kitchen_pendants": ("kitchen", _light("Pendants", True, 85)),
    "light.kitchen_cabinets": ("kitchen", _light("Under Cabinets", True, 40)),
    "light.dining_chandelier": ("dining_room", _light("Chandelier", False)),
    "light.office_desk": ("office", _light("Desk Lamp", True, 100)),
    "light.bedroom_lamps": ("bedroom", _light("Bedside Lamps", False)),
    "light.guest_room": ("guest_room", _light("Guest Room Light", False)),
    "light.porch": ("porch", _light("Porch Light", True, 50)),
    "light.backyard_string": ("backyard", _light("String Lights", True, 80, color=True)),
    "switch.garage_outlet": ("garage", ("off", {"friendly_name": "Workbench Outlet"})),
    "fan.bedroom_ceiling": ("bedroom", ("on", {"friendly_name": "Ceiling Fan", "percentage": 33, "supported_features": 1})),
    "climate.main_floor": ("living_room", _climate("Main Floor", 71, 70, "idle")),
    "climate.upstairs": ("bedroom", _climate("Upstairs", 73, 70, "cooling")),
    "sensor.living_room_temperature": ("living_room", _sensor("Temperature", 71.2, "°F", "temperature")),
    "sensor.living_room_humidity": ("living_room", _sensor("Humidity", 44, "%", "humidity")),
    "sensor.office_temperature": ("office", _sensor("Temperature", 72.6, "°F", "temperature")),
    "sensor.bedroom_temperature": ("bedroom", _sensor("Temperature", 73.1, "°F", "temperature")),
    "sensor.backyard_temperature": ("backyard", _sensor("Temperature", 64.4, "°F", "temperature")),
    "lock.front_door": ("porch", ("locked", {"friendly_name": "Front Door"})),
    "lock.back_door": ("kitchen", ("locked", {"friendly_name": "Back Door"})),
    "cover.garage_door": ("garage", ("closed", {"friendly_name": "Garage Door", "device_class": "garage",
                                                "supported_features": 3})),
    "binary_sensor.front_door": ("porch", ("off", {"friendly_name": "Front Door", "device_class": "door"})),
    "binary_sensor.office_window": ("office", ("on", {"friendly_name": "Office Window", "device_class": "window"})),
    "binary_sensor.porch_motion": ("porch", ("off", {"friendly_name": "Porch Motion", "device_class": "motion"})),
    "media_player.living_room": ("living_room", ("playing", {
        "friendly_name": "Living Room", "media_title": "Blue in Green", "media_artist": "The Fictional Trio",
        "media_album_name": "Kind of Fictional", "media_duration": 337.0, "media_position": 95.0, "volume_level": 0.3,
        "media_content_type": "music", "supported_features": 152463,
        "media_position_updated_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(NOW))})),
    "media_player.kitchen": ("kitchen", ("idle", {"friendly_name": "Kitchen", "volume_level": 0.2,
                                                  "supported_features": 152463})),
    "camera.front_door": ("porch", ("idle", {"friendly_name": "Front Door", "access_token": "fictional",
                                             "entity_picture": "/api/camera_proxy/camera.front_door?token=fictional"})),
    "camera.backyard": ("backyard", ("idle", {"friendly_name": "Backyard", "access_token": "fictional",
                                              "entity_picture": "/api/camera_proxy/camera.backyard?token=fictional"})),
    "scene.good_morning": (None, ("unknown", {"friendly_name": "Good Morning"})),
    "scene.movie_night": ("living_room", ("unknown", {"friendly_name": "Movie Night"})),
    "scene.dinner": ("dining_room", ("unknown", {"friendly_name": "Dinner"})),
    "scene.good_night": (None, ("unknown", {"friendly_name": "Good Night"})),
    "alarm_control_panel.home": (None, ("disarmed", {"friendly_name": "Home Alarm", "code_format": "number",
                                                     "supported_features": 63})),
    "person.sam": (None, ("home", {"friendly_name": "Sam"})),
    "person.alex": (None, ("not_home", {"friendly_name": "Alex"})),
    "weather.home": (None, ("partlycloudy", {"friendly_name": "Home", "temperature": 64, "temperature_unit": "°F",
                                             "humidity": 52, "wind_speed": 6, "wind_speed_unit": "mph"})),
}

SETTINGS = {
    "entry_id": "gallery-entry", "setup_done": True,
    "settings": {"sky": {}, "look": {}, "generated": {"include_entities": []}, "weather": {"place": "Riverside"},
                 "security": {}, "features": {}, "headers": {}},
    "boards": {SCREEN: {"pages": [], "headers": {"home": True}, "menu": "auto"}},
    "dashboards": [], "popups": [], "custom_chips": [], "chip_kinds": [], "page_kinds": [], "custom_pages": [],
    "accessories": {"entities": {}}, "kinds": {}, "hidden": {}, "counts": {}, "features": {}, "thirdparty": {},
    "choices": {}, "tablets": {}, "screensavers": {}, "kiosk_devices": [], "tablet_suggest": [], "users": [],
    "presets": [], "suggest": {}, "integration": {}, "scene_pages": [], "shelves": {},
}

DESKTOP, TABLET, PHONE = (1440, 900), (1180, 820), (390, 844)
# a wall tablet's page from its Setup down: HK's Setup, then Mantel's group (who is signed in as it)
SCROLL_TO_SETUP = """(() => { const find = (root) => { for (const el of root.querySelectorAll('*')) {
  if (el.shadowRoot) { const got = find(el.shadowRoot); if (got) return got; }
  if (el.tagName === 'H2' && el.textContent.trim().toUpperCase() === 'SETUP') return el; } return null; };
  const h = find(document); if (h) h.scrollIntoView({ block: 'start' }); })()"""

# name -> (path, viewport, signed in, script to run before the shot)
SHOTS = {
    "home-desktop": (f"/{SCREEN}/home", DESKTOP, True, None),
    "home-tablet": (f"/{SCREEN}/home", TABLET, True, None),
    "home-phone": (f"/{SCREEN}/home", PHONE, True, None),
    "lights-desktop": (f"/{SCREEN}/lights", DESKTOP, True, None),
    "climate-desktop": (f"/{SCREEN}/climate", DESKTOP, True, None),
    "security-desktop": (f"/{SCREEN}/security", DESKTOP, True, None),
    "cameras-desktop": (f"/{SCREEN}/cameras", DESKTOP, True, None),
    "room-desktop": (f"/{SCREEN}/room-living-room", DESKTOP, True, None),
    "music-phone": (f"/{SCREEN}/playmusic", PHONE, True, None),
    "settings-me": ("/settings#/mantel/me", DESKTOP, True, None),
    "settings-people": ("/settings#/mantel/people", DESKTOP, True, None),
    "settings-wall-tablet": ("/settings#/house/tablets/kitchen", DESKTOP, True, SCROLL_TO_SETUP),
    "settings-roles": ("/settings#/mantel/roles", DESKTOP, True, None),
    "settings-audit": ("/settings#/mantel/audit", DESKTOP, True, None),
    "settings-phone": ("/settings", PHONE, True, None),
    "login": ("/login", DESKTOP, False, None),
    "login-phone": ("/login", PHONE, False, None),
}


class GalleryLibrary(FictionalLibrary):
    """Music Assistant's library with made-up but plausible names."""
    NAMES = {"track": ["Blue in Green", "Late Train Home", "Paper Lanterns", "Saturday Coffee", "Northern Lights",
                       "Slow Tide", "Back Porch", "City at Dusk"],
             "playlist": ["Dinner Party", "Sunday Morning", "Focus", "Road Trip", "Kids' Favorites", "Rainy Day"],
             "album": ["Kind of Fictional", "Quiet Hours", "Harbor Lights", "The Long Way", "Open Windows"],
             "artist": ["The Fictional Trio", "June Avenue", "Harbor Club", "Maple & Stone", "The Late Shift"],
             "radio": ["Jazz Radio", "Morning Classical", "Indie Mix"]}

    async def library(self, media_type, **args):
        items = await super().library(media_type, **args)
        names = self.NAMES.get(media_type.rstrip("s"), [])
        for n, item in enumerate(items):
            if names:
                item["name"] = names[n % len(names)]
            for a in item.get("artists", []):
                a["name"] = "The Fictional Trio"
        return items


def stand_in_stills() -> None:
    """Each camera's still is one of HK's own landscapes (a picture of somewhere, not of anyone's home)."""
    from aiohttp import web
    from mantel_server.connectors import camera_still
    pictures = {"camera.front_door": "07.webp", "camera.backyard": "21.webp"}

    async def still(request, url, params, token, what, unavailable, not_found):
        name = next((v for k, v in pictures.items() if k in url), "01.webp")
        return web.Response(body=(ROOT / "web/hk/landscapes" / name).read_bytes(), content_type="image/webp")
    camera_still.proxy_image = still


async def build(base: Path):
    from mantel_server import settings_store
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.sessions import Identity, User
    from mantel_server.store import Store

    cfg = Config(data_dir=base / "data", fixtures=base / "fixtures", hk_files=base / "user-files", default_screen=SCREEN,
                 commands_enabled=True)
    store = Store(cfg.data_dir / "gallery.db")
    store.link("gallery-owner", "owner", "Sam Rivera")
    cookie = store.create_session("gallery-owner", 3600)
    app = build_app(cfg, "unused-gallery-token", store=store, connect_ha=False)
    hub = app["hub"]
    app["ma"] = GalleryLibrary()
    from app_dev_server import FictionalCommander
    app["gateway"].commander = FictionalCommander(hub, app["gateway"].writes)     # changes the fictional states only
    owner = Identity(User(store.get_link("gallery-owner")["user_id"], "Sam Rivera", "owner", "ha_linked"), None, "lan")
    settings = settings_store.register(app, hub, settings_store.SettingsHooks(
        may_configure=settings_store.rbac_may_configure()), model=settings_store.ThinModel())

    async def fictional_ha():
        return json.loads(json.dumps(SETTINGS))
    await settings_store.import_settings(settings.store, fictional_ha, actor=settings_store.Actor(label="gallery"))
    hub.readproxy = OfflineReads(app, owner)
    stand_in_hk_feeds(app, hub.readproxy)
    stand_in_cameras(app)
    stand_in_stills()
    areas = [{"area_id": a, "name": n, "floor_id": f} for a, n, f in ROOMS]
    entities = [{"entity_id": eid, "area_id": area, "platform": "demo"} for eid, (area, _) in HOUSE.items()]
    hub.registry.load(areas, [], entities, FLOORS)
    hub.store.apply_event({"a": {eid: {"s": s, "a": a, "lc": NOW - 1800, "lu": NOW - 60}
                                 for eid, (_, (s, a)) in HOUSE.items()}})
    stand_in_music(app)
    await seed_people(app, owner.user.id)
    return app, cookie


def stand_in_music(app) -> None:
    """Music Assistant set up, with the house's two speakers (HK's music feed, as tools/app_dev_server.py has it)."""
    from mantel_server.connectors import Route

    async def request(ctx, msg):
        return {}

    async def subscribe(ctx, msg, on_event):
        asyncio.get_running_loop().call_soon(on_event, {"configured": True, "library_entry": "fictional", "speakers": [
            {"name": "Living Room", "entity": "media_player.living_room"},
            {"name": "Kitchen", "entity": "media_player.kitchen"}]})

        async def unsubscribe():
            return None
        return unsubscribe
    app["read_routes"]["hk_music/subscribe"] = Route(request=request, subscribe=subscribe)


async def seed_people(app, owner_id: str) -> None:
    """Mantel accounts beside the Owner, a wall tablet, and an evening's audit log."""
    import secrets
    from types import SimpleNamespace
    from mantel_server.sessions import Identity, User
    acc = app["accounts"]
    people = {}
    for username, name, role in (("alex", "Alex Rivera", "adult"), ("riley", "Riley Rivera", "child"),
                                 ("grandma", "Pat Rivera", "guest")):
        people[username] = await acc.create_user(username, name, role, secrets.token_urlsafe(16))
    app["devices"].enroll("Kitchen Tablet", "wall_tablet", "kitchen", owner_id)
    app["devices"].enroll("Hallway Tablet", "wall_tablet", "living_room", owner_id)
    service = app.get("settings")
    if service is not None:                  # HK's wall tablets the two devices are (a tablet's page: Mantel's group)
        from mantel_server.settings_store import Actor
        for tid, name, room in (("kitchen", "Kitchen", "kitchen"), ("hallway", "Hallway", "living_room")):
            service.store.write([("tablet", tid, {"name": name, "room": room, "screen": SCREEN, "app": "fully",
                                                  "uid": f"tablet_{tid}"})], actor=Actor(label="gallery"))
    app["user_data"].set(f"u:{owner_id}", "hk_music_focus", {"key": "media_player.living_room"})
    audit = app["audit"]
    clock = audit.clock
    rows = [(95, owner_id, "Sam Rivera", "owner", "light.turn_on", ["light.living_room_lamps"], "allowed", "ok"),
            (80, people["alex"], "Alex Rivera", "adult", "lock.unlock", ["lock.front_door"], "allowed", "ok"),
            (64, people["alex"], "Alex Rivera", "adult", "lock.lock", ["lock.front_door"], "allowed", "ok"),
            (41, people["riley"], "Riley Rivera", "child", "lock.unlock", ["lock.back_door"], "denied", None),
            (30, owner_id, "Sam Rivera", "owner", "climate.set_temperature", ["climate.upstairs"], "allowed", "ok"),
            (12, people["riley"], "Riley Rivera", "child", "light.turn_off", ["light.guest_room"], "allowed", "ok"),
            (5, owner_id, "Sam Rivera", "owner", "scene.turn_on", ["scene.movie_night"], "allowed", "ok")]
    try:
        for minutes, uid, name, role, action, targets, decision, result in rows:
            audit.clock = lambda m=minutes: NOW - m * 60
            ident = Identity(User(uid, name, role, "hk"), None, "lan")
            audit.record(principal=SimpleNamespace(identity=ident, source_ip="192.0.2.20"), kind="service", action=action, targets=targets,
                         decision=decision, reason="role" if decision == "allowed" else "not_granted", result=result)
    finally:
        audit.clock = clock


async def shoot(out: Path, only: list[str] | None) -> list[Path]:
    written = []
    with tempfile.TemporaryDirectory(prefix="mantel-gallery-") as folder:
        app, cookie = await build(Path(folder))
        async with TestServer(app) as server:
            origin = str(server.make_url("")).rstrip("/")
            for name, (path, (w, h), signed_in, script) in SHOTS.items():
                if only and name not in only:
                    continue
                async with Browser(width=w, height=h, port=9381) as b:
                    await b.restrict_origin(origin)
                    await b.open(origin + path, cookie if signed_in else None)
                    if path.startswith(f"/{SCREEN}/"):
                        await b.wait("window.__mantelReady === true", 25)
                    else:
                        await b.wait("document.readyState === 'complete'", 25)
                    await asyncio.sleep(2.5)            # the sky, pictures and fonts settle
                    if script:
                        await b.eval(script)
                        await asyncio.sleep(1.5)
                    shot = Path(folder) / f"{name}.png"
                    await b.screenshot(shot)
                    target = out / f"{name}.webp"
                    from PIL import Image                # a dependency of Mantel's (photos.py)
                    Image.open(shot).save(target, "WEBP", quality=88, method=6)
                    written.append(target)
                    print("wrote", target.relative_to(ROOT) if target.is_relative_to(ROOT) else target)
    return written


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out", type=Path, default=ROOT / "docs/images")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--list", action="store_true")
    a = ap.parse_args(argv)
    if a.list:
        print("\n".join(SHOTS))
        return 0
    a.out.mkdir(parents=True, exist_ok=True)
    asyncio.run(shoot(a.out, a.only))
    return 0


if __name__ == "__main__":
    sys.exit(main())
