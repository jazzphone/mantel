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
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "hosts/server"))
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(ROOT / "tools"))

from aiohttp.test_utils import TestServer  # noqa: E402

from cdp import Browser  # noqa: E402
from client_smoke import FictionalLibrary, OfflineReads, stand_in_cameras, stand_in_hk_feeds  # noqa: E402

SCREEN = "dashboard-home"
GRID_SCREEN = "dashboard-wall"          # the second screen: Home Grid, as a wall display uses it
OWNER = "Avery Rivera"                  # the fictional Owner every shot is signed in as
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


def _watts(name, value):
    return str(value), {"friendly_name": name, "unit_of_measurement": "W", "device_class": "power",
                        "state_class": "measurement"}


# the Power page's house: a sunny afternoon, the battery filling, the car charging, a little going back to the grid
# (4200 W of sun = 1800 for the house + 1400 for the car + 500 for the battery + 500 to the grid)
HOUSE.update({eid: (None, state) for eid, state in {
    "sensor.home_power": _watts("Home Power", 1800),
    "sensor.grid_power": _watts("Grid Power", 0),
    "sensor.grid_export_power": _watts("Grid Export", 500),
    "sensor.solar_power": _watts("Solar Power", 4200),
    "sensor.battery_charge_power": _watts("Battery Charging", 500),
    "sensor.battery_discharge_power": _watts("Battery Discharging", 0),
    "sensor.battery_level": ("78", {"friendly_name": "Battery", "unit_of_measurement": "%", "device_class": "battery",
                                    "state_class": "measurement"}),
    "sensor.car_level": ("64", {"friendly_name": "Family Car Battery", "unit_of_measurement": "%",
                                "device_class": "battery", "state_class": "measurement"}),
    "sensor.car_charge_power": _watts("Family Car Charging", 1400),
    "binary_sensor.grid_status": ("on", {"friendly_name": "Grid", "device_class": "power"}),
    "binary_sensor.car_cable": ("on", {"friendly_name": "Family Car Cable", "device_class": "plug"}),
    "device_tracker.family_car": ("home", {"friendly_name": "Family Car", "source_type": "gps"}),
    "switch.car_charging": ("on", {"friendly_name": "Family Car Charging"}),
    "sensor.upstairs_ac_power": _watts("Upstairs AC", 780),
    "sensor.kitchen_power": _watts("Kitchen", 240),
    "sensor.refrigerator_power": _watts("Refrigerator", 110),
    "sensor.office_power": _watts("Office", 160),
    "sensor.network_rack_power": _watts("Network Rack", 90),
}.items()})


def _device(key, name, icon, color, power, backed):
    return {"key": key, "kind": "device", "name": name, "icon": icon, "color": color, "power": power, "stat": None,
            "control": None, "backed": backed}


# the Energy feature's plan as Mantel's settings feed carries it (hk_core.energy.plan.build): its Power page
POWER_PLAN = {
    "title": "Energy", "total": {"power": "sensor.home_power", "stat": None}, "top": [], "usages": [], "sections": [],
    "detail": False, "devices": {}, "names": {}, "sources": {},
    "power": {
        "title": "Power", "path": "power", "picture": True, "art": "/hk/power-house/", "home": "sensor.home_power",
        "grid": "sensor.grid_power", "grid_export": "sensor.grid_export_power", "grid_status": "binary_sensor.grid_status",
        "solar": "sensor.solar_power", "backs_up": "some", "groups": "type",
        "battery": {"level": "sensor.battery_level", "charge": "sensor.battery_charge_power",
                    "discharge": "sensor.battery_discharge_power"},
        "cars": [{"name": "Family Car", "level": "sensor.car_level", "power": "sensor.car_charge_power",
                  "home": "device_tracker.family_car", "plugged": "binary_sensor.car_cable",
                  "charge": "switch.car_charging", "charger": "sensor.car_charge_power"}],
        "sections": [
            {"id": "hvac", "name": "Heating & Cooling", "items": [
                _device("hvac.upstairs", "Upstairs AC", "hk:air-conditioner", "blue", "sensor.upstairs_ac_power", False)]},
            {"id": "rooms", "name": "Rooms", "items": [
                _device("rooms.kitchen", "Kitchen", "hk:silverware-fork-knife", "orange", "sensor.kitchen_power", True),
                _device("rooms.office", "Office", "hk:desk", "purple", "sensor.office_power", True)]},
            {"id": "appliances", "name": "Appliances", "items": [
                _device("app.fridge", "Refrigerator", "hk:fridge-outline", "mint", "sensor.refrigerator_power", True),
                _device("app.rack", "Network Rack", "hk:server-network", "yellow", "sensor.network_rack_power", True)]}],
    },
}


class FictionalFeatures:
    """What Mantel's feature host tells the screens (the settings feed's `added` and `energy`): the Energy
    feature is added and has a Power page. There is no Home Assistant here to work an Energy plan out of."""

    def client_part(self, identity):
        return {"added": ["energy"], "energy": json.loads(json.dumps(POWER_PLAN))}

    def house_part(self):
        return self.client_part(None)

    # Advanced -> Features as a Mantel-held house tells it (panel/get's `features` and `features_auto`): Mantel
    # turned Music and Clean Areas on by itself, Live TV is off with a note on what it still needs
    ADDED = ("hk_music", "hk_clean_areas")
    AUTO = {"hk_music": {"at": "2026-11-04T15:00:00+00:00", "why": "Music Assistant is connected."},
            "hk_clean_areas": {"at": "2026-11-04T15:00:00+00:00", "why": "A vacuum has a map of the house’s rooms."}}
    NOTE = {"hk_tv": "Home Assistant has an HDHomeRun, but Mantel doesn’t know its address: add it on Live TV’s page."}

    class _Auto:
        def switch(self):
            return True
    auto = _Auto()

    def panel_features(self):
        from mantel_server.features.settings import COMPANIONS
        out = {}
        for fid, kind, name in COMPANIONS:
            added = fid in self.ADDED
            out[fid] = {"name": name, "kind": kind, "installed": True, "own": True,
                        "entries": [{"entry_id": f"gallery_{kind}", "title": name, "state": "loaded"}] if added else []}
            if fid in self.AUTO:
                out[fid]["auto"] = self.AUTO[fid]
            elif fid in self.NOTE:
                out[fid]["note"] = self.NOTE[fid]
        return out


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



def wall_display() -> dict:
    """A second screen that uses the Home Grid layout (Starter A, Tap Weight), filled from the invented house."""
    from hk_core.settings import home_grid
    grid = home_grid.starter(
        "A", scenes=[e for e in HOUSE if e.startswith("scene.")], rooms=[a for a, _, _ in ROOMS],
        cameras=[e for e in HOUSE if e.startswith("camera.")], climate=[e for e in HOUSE if e.startswith("climate.")])
    return {"title": "Wall Display", "pages": [], "headers": {"home": True}, "menu_custom": True, "menu": "tabbar",
            "home_style": "grid", "home_grid": grid}



INTERCOM_SCREEN = "dashboard-intercom"   # the third screen: the Intercom's blocks beside a few others (showcase only)


def intercom_display() -> dict:
    """A Home Grid screen with the Intercom block, Small and Wide, beside a lamp, an action, a scene and a room."""
    grid = {"v": 1, "cols": 6, "rows": 4, "frame": [1280, 800], "band": True, "items": [
        {"id": "ic-s", "card": "intercom", "size": "S", "at": [0, 0]},
        {"id": "ic-w", "card": "intercom", "size": "W", "at": [1, 0]},
        {"id": "lamp", "card": "accessory", "size": "S", "at": [3, 0], "opts": {"entity": "light.living_room_lamps"}},
        {"id": "lock", "card": "action", "size": "S", "at": [4, 0], "opts": {"action": "lock_up"}},
        {"id": "scene", "card": "scene", "size": "W", "at": [0, 1], "opts": {"scene": "scene.movie_night"}},
        {"id": "room", "card": "room", "size": "W", "at": [2, 1], "opts": {"area": "living_room"}}]}
    return {"title": "Intercom", "pages": [], "headers": {"home": True}, "menu_custom": True, "menu": "tabbar",
            "home_style": "grid", "home_grid": grid}


# the Intercom's made-up feed and microphone (the browser checks' too), then the sheet in a state: the fakes in, the
# sheet opened, and the microphone pressed as a finger does (intercom_fakes.js)
INTERCOM_FAKES = (Path(__file__).parent / "intercom_fakes.js").read_text()
INTERCOM_OPEN = INTERCOM_FAKES + """await until(() => window.hkIntercom && window.hkDetail && deep(document, 'hk-intercom-card').length);
__intercomFake.install({});
await pause(800);
hkIntercom.open();
const sheet = await until(() => { const c = deep(document, 'hk-intercom-sheet-card')[0]; return c && c.shadowRoot.querySelectorAll('.rooms .pill').length && c; });
const tap = (sel, n = 0) => __intercomFake.press([...sheet.shadowRoot.querySelectorAll(sel)].filter((e) => !e.closest('[hidden]'))[n]);
await pause(1000);"""
INTERCOM_RECORD = """await tap('.mb'); await pause(1500); __intercomFake.mic().speak(7); await tap('.mb'); await pause(600);"""

DESKTOP, TABLET, PHONE = (1440, 900), (1180, 820), (390, 844)
EDITOR = (1600, 1000)                     # the Home Grid editor wants room for its preview
GRID_DESKTOP = (1280, 800)                # the grid's own frame
# a wall tablet's page from its Setup down: HK's Setup, then Mantel's group (who is signed in as it)
SCROLL_TO_SETUP = """(() => { const find = (root) => { for (const el of root.querySelectorAll('*')) {
  if (el.shadowRoot) { const got = find(el.shadowRoot); if (got) return got; }
  if (el.tagName === 'H2' && el.textContent.trim().toUpperCase() === 'SETUP') return el; } return null; };
  const h = find(document); if (h) h.scrollIntoView({ block: 'start' }); })()"""

# a channel's page around Quiet Hours (the minimum level above it, its setup below)
SCROLL_TO_QUIET = """(() => { const find = (root) => { for (const el of root.querySelectorAll('*')) {
  if (el.shadowRoot) { const got = find(el.shadowRoot); if (got) return got; }
  if (el.tagName === 'H2' && el.textContent.trim().toUpperCase() === 'QUIET HOURS') return el; } return null; };
  const h = find(document); if (h) h.scrollIntoView({ block: 'center' }); })()"""
# Me, from System Alerts down
SCROLL_TO_SYSTEM_ALERTS = """(() => { const find = (root) => { for (const el of root.querySelectorAll('*')) {
  if (el.shadowRoot) { const got = find(el.shadowRoot); if (got) return got; }
  if (el.tagName === 'H2' && el.textContent.trim().toUpperCase() === 'SYSTEM ALERTS') return el; } return null; };
  const h = find(document); if (h) h.scrollIntoView({ block: 'center' }); })()"""

# a script for a shot: async JS that may wait for the page (until) and look inside shadow roots (deep)
JS_HELPERS = """const deep = (r, s) => [...r.querySelectorAll('*')].flatMap(e => [...(e.matches(s) ? [e] : []), ...(e.shadowRoot ? deep(e.shadowRoot, s) : [])]);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, ms = 30000) => { const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = f(); if (v) return v; } catch (e) { /* not there yet */ } await pause(200); }
  throw new Error('gallery: timed out waiting for ' + f); };
"""


def script(body: str) -> str:
    return "(async () => {" + JS_HELPERS + body + "})()"


# Home Grid's Now Playing block turned over (its Speakers or Browse button): the panel it turns into
TURN_OVER = """const card = await until(() => deep(document, 'hk-now-playing-card').find((c) => c.shadowRoot && c.shadowRoot.querySelector('.%s')));
await pause(800);
card.shadowRoot.querySelector('.%s').click();
await until(() => [...document.body.children].some((h) => h.shadowRoot && h.shadowRoot.querySelector('.mpanel.turn')));
await pause(2500);"""
# Edit mode: the page's tiles wiggle, the Edit bar says Done and Cancel
EDIT_MODE = """await until(() => window.hkEdit && window.hkCards && hkCards.client && hkCards.client());
hkEdit.enter(hkCards.client());
await until(() => hkEdit.active());
await pause(1000);"""
# the live previews in Settings are windows in front: their cameras play
PREVIEWS_PLAY = """await pause(3000);
deep(document, 'iframe').forEach((f) => { try { f.contentWindow.focus(); } catch (e) { /* another origin */ } });
await pause(9000);"""
# the Home Grid editor (Settings -> a screen -> Arrange Home Grid)
GRID_EDITOR = """const panel = await until(() => document.querySelector('hk-settings-panel'));
const ed = await until(() => { const e = panel.shadowRoot.querySelector('hk-grid-editor'); return e && e.ui && e.shadowRoot.querySelector('.tools') && e; });
window.ed = ed;
"""
GRID_PREVIEW = """await until(() => ed.previewView && ed.previewView.isConnected, 60000);
ed.iframe.contentWindow.focus();           // the preview is a window in front: its cameras play
await pause(5000);"""
GRID_STARTERS = "await until(() => ed.starterGrids && ed.sidebar.querySelectorAll('.starter').length === 8);"
GRID_PICKER = """ed.remove('a7');          // the Timers block, so there is room to add
await until(() => ed.previewView && ed.previewView.isConnected, 60000);
ed.message.textContent = '';
ed.select(null); ed.pickerCard = 'accessory'; ed.drawPalette();
await until(() => { const f = ed.palette.querySelector('[data-preview-card] iframe'); return f && f.contentWindow.galleryCard && f.contentWindow.galleryCard._config; }, 60000);
await pause(1000);
ed.palette.querySelector('.pal-detail').scrollIntoView({ block: 'center' });"""
GRID_BACKGROUND = """ed.select('a2');
await pause(500);
[...ed.sidebar.querySelectorAll('.cell')].find((row) => row.textContent.includes('Custom Group Background')).querySelector('button').click();
await pause(500);
const opacity = ed.sidebar.querySelector('input[type=range]'); opacity.value = '42';
opacity.dispatchEvent(new Event('input')); opacity.dispatchEvent(new Event('change'));
await pause(800);"""

# the Screensaver editor (Settings -> a screen -> Screensaver Options -> Edit Screensaver): the Lock Screen Look tapped, once the
# screensaver inside it has drawn its sky and its pieces
SAVER_EDITOR = """const ed = await until(() => deep(document, 'hk-saver-editor').find((e) => e.shadowRoot && e.shadowRoot.querySelector('.lk') && e.shadowRoot.querySelector('.ov')));
await until(() => [...ed.shadowRoot.querySelectorAll('.lk')].length >= 10);
[...ed.shadowRoot.querySelectorAll('.lk')].find((r) => r.textContent.includes('Lock Screen')).click();
await until(() => ed.shadowRoot.querySelector('.ov').children.length > 0, 60000);
await pause(12000);"""
# ...and the big element tapped, so the right-hand side shows the Look's Face, Color, Size, Position and Depth
SAVER_EDITOR_TIME = SAVER_EDITOR + """
ed.shadowRoot.querySelector('.ov .big').click();
await pause(2500);"""
# ...and a piece tapped (phase 13): its page, its shapes drawn, its Size, Backdrop, Color and Show
SAVER_EDITOR_PIECE = SAVER_EDITOR + """
[...ed.shadowRoot.querySelectorAll('.ov .w')].find((w) => /weather|Weather/.test(w.getAttribute('aria-label') || '')).click();
await pause(2500);"""

# name -> (path, viewport, signed in, script to run before the shot)
# The path is one of Mantel's own pages: a screen (SCREEN's, or GRID_SCREEN's, which lays Home out as a Home Grid),
# /settings... or /login.
SHOTS = {
    "home-desktop": (f"/{SCREEN}/home", DESKTOP, True, None),
    "home-tablet": (f"/{SCREEN}/home", TABLET, True, None),
    "home-phone": (f"/{SCREEN}/home", PHONE, True, None),
    "lights-desktop": (f"/{SCREEN}/lights", DESKTOP, True, None),
    "climate-desktop": (f"/{SCREEN}/climate", DESKTOP, True, None),
    "security-desktop": (f"/{SCREEN}/security", DESKTOP, True, None),
    "cameras-desktop": (f"/{SCREEN}/cameras", DESKTOP, True, None),
    "room-desktop": (f"/{SCREEN}/room-living-room", DESKTOP, True, None),
    "power-desktop": (f"/{SCREEN}/power", DESKTOP, True, None),
    "music-phone": (f"/{SCREEN}/playmusic", PHONE, True, None),
    "edit-mode-desktop": (f"/{SCREEN}/room-living-room", DESKTOP, True, script(EDIT_MODE)),
    "home-grid": (f"/{GRID_SCREEN}/home", GRID_DESKTOP, True, None),
    "intercom-block": (f"/{INTERCOM_SCREEN}/home", GRID_DESKTOP, True, None),
    "intercom-picker": (f"/{INTERCOM_SCREEN}/home", GRID_DESKTOP, True, script(INTERCOM_OPEN)),
    "intercom-sheet-message": (f"/{INTERCOM_SCREEN}/home", GRID_DESKTOP, True, script(INTERCOM_OPEN + """await tap('.mb'); await pause(1800);""")),
    "intercom-sheet-review": (f"/{INTERCOM_SCREEN}/home", GRID_DESKTOP, True, script(INTERCOM_OPEN + INTERCOM_RECORD)),
    "home-grid-speakers": (f"/{GRID_SCREEN}/home", GRID_DESKTOP, True, script(TURN_OVER % ("spk", "spk"))),
    "home-grid-browse": (f"/{GRID_SCREEN}/home", GRID_DESKTOP, True, script(TURN_OVER % ("brw", "brw"))),
    "home-grid-editor": (f"/settings#/screens/{GRID_SCREEN}/home-grid", EDITOR, True, script(GRID_EDITOR + GRID_PREVIEW)),
    "home-grid-starters": (f"/settings#/screens/{SCREEN}/home-grid", EDITOR, True, script(GRID_EDITOR + GRID_STARTERS)),
    "home-grid-picker": (f"/settings#/screens/{GRID_SCREEN}/home-grid", EDITOR, True,
                         script(GRID_EDITOR + GRID_PREVIEW + GRID_PICKER)),
    "home-grid-background": (f"/settings#/screens/{GRID_SCREEN}/home-grid", EDITOR, True,
                             script(GRID_EDITOR + GRID_PREVIEW + GRID_BACKGROUND)),
    "screensaver-editor": (f"/settings#/screens/{SCREEN}/screensaver/editor", DESKTOP, True, script(SAVER_EDITOR)),
    "screensaver-editor-time": (f"/settings#/screens/{SCREEN}/screensaver/editor", DESKTOP, True, script(SAVER_EDITOR_TIME)),
    "screensaver-editor-piece": (f"/settings#/screens/{SCREEN}/screensaver/editor", DESKTOP, True, script(SAVER_EDITOR_PIECE)),
    "settings-me": ("/settings#/mantel/me", DESKTOP, True, None),
    "settings-people": ("/settings#/mantel/people", DESKTOP, True, None),
    "settings-wall-tablet": ("/settings#/house/tablets/kitchen", DESKTOP, True, SCROLL_TO_SETUP),
    "settings-roles": ("/settings#/mantel/roles", DESKTOP, True, None),
    "settings-audit": ("/settings#/mantel/audit", DESKTOP, True, None),
    "settings-connections": ("/settings#/mantel/connections", DESKTOP, True, None),
    "settings-general": ("/settings#/mantel/general", DESKTOP, True, None),
    "settings-setup": ("/settings#/mantel/setup", DESKTOP, True, None),
    "settings-screen": (f"/settings#/screens/{SCREEN}", DESKTOP, True, script(PREVIEWS_PLAY)),
    "settings-connections-ma": ("/settings#/mantel/connections/ma", DESKTOP, True, None),
    "settings-connections-ha": ("/settings#/mantel/connections/ha", DESKTOP, True, None),
    "settings-phone": ("/settings", PHONE, True, None),
    "settings-alerts": ("/settings#/mantel/alerts", DESKTOP, True, None),
    "settings-alerts-channel": ("/settings#/mantel/alerts/channel/{discord}", DESKTOP, True, None),
    "settings-alerts-email": ("/settings#/mantel/alerts/channel/{email}", DESKTOP, True, SCROLL_TO_QUIET),
    "settings-me-system-alerts": ("/settings#/mantel/me", DESKTOP, True, SCROLL_TO_SYSTEM_ALERTS),
    "settings-alerts-history": ("/settings#/mantel/alerts/history", DESKTOP, True, None),
    "features": ("/settings#/advanced/features", DESKTOP, True, None),
    "settings-about-updates": ("/settings#/mantel/about", DESKTOP, True, None),
    "login": ("/login", DESKTOP, False, None),
    "login-phone": ("/login", PHONE, False, None),
}


class GalleryLibrary(FictionalLibrary):
    """Music Assistant's library with made-up but plausible names, and Music Assistant's own account of itself."""
    server_info = {"server_version": "2.7.1"}
    user = {"user_id": "gallery-ma", "username": "mantel", "display_name": "Mantel", "role": "user"}

    def __init__(self):
        super().__init__()
        self.connected = asyncio.Event()
        self.connected.set()

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


# when each light was on today, in hours from midnight (None: still on)
LIGHT_HOURS = {"light.living_room_lamps": [(17.5, None)], "light.kitchen_pendants": [(6.5, 8.0), (17.0, None)],
               "light.kitchen_cabinets": [(6.5, 8.0), (17.5, None)], "light.office_desk": [(9.0, None)],
               "light.porch": [(17.75, None)], "light.backyard_string": [(18.0, None)],
               "light.bedroom_lamps": [(6.0, 7.0)]}
# hours (from midnight) the upstairs, then the main floor, cooled today
COOLING_HOURS = {"climate.upstairs": range(13, 18), "climate.main_floor": range(15, 17)}


class GalleryReads(OfflineReads):
    """The offline reads, and made-up days: the lights' and thermostats' history and the weather's forecast."""

    async def request(self, msg):
        if msg["type"] != "history/history_during_period":
            return await super().request(msg)
        start = datetime.fromisoformat(msg["start_time"].replace("Z", "+00:00")).timestamp()
        out = {}
        for eid in msg.get("entity_ids") or []:
            if eid in LIGHT_HOURS:
                rows = [{"s": "off", "lu": start}]
                for a, b in LIGHT_HOURS[eid]:
                    rows.append({"s": "on", "lu": start + a * 3600})
                    if b is not None:
                        rows.append({"s": "off", "lu": start + b * 3600})
                out[eid] = rows
            elif eid in COOLING_HOURS:
                _area, (_state, attrs) = HOUSE[eid]
                out[eid] = [{"s": "heat_cool", "lu": start + hour * 3600,
                             "a": {**attrs, "hvac_action": "cooling" if hour in COOLING_HOURS[eid] else "idle",
                                   "current_temperature": attrs["current_temperature"] - 1 + (hour % 3) * 0.7}}
                            for hour in range(24)]
            elif eid.startswith("weather."):
                out[eid] = [{"s": "partlycloudy", "lu": start + hour * 3600,
                             "a": {"temperature": round(52 + 14 * max(0.0, 1 - abs(hour - 15) / 9))}} for hour in range(24)]
            else:
                out[eid] = []
        return out

    async def subscribe(self, msg, callback):
        if msg["type"] != "weather/subscribe_forecast":
            return await super().subscribe(msg, callback)
        self.serial += 1
        hourly = msg.get("forecast_type") == "hourly"
        step, count = (3600, 12) if hourly else (86400, 5)
        conditions = ["partlycloudy", "partlycloudy", "sunny", "sunny", "cloudy", "rainy", "partlycloudy"]
        base = int(NOW // step * step)
        forecast = [{"datetime": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(base + (n + 1) * step)),
                     "condition": conditions[n % len(conditions)],
                     "temperature": 63 - n // 3 if hourly else (64, 66, 63, 60, 62)[n], "templow": 48 + n % 4,
                     "precipitation_probability": 10 + 15 * (n % 3)} for n in range(count)]
        asyncio.get_running_loop().call_soon(callback, {"type": msg.get("forecast_type"), "forecast": forecast})
        return self.serial


def stand_in_stills() -> None:
    """Each camera's still is one of HK's own landscapes (a picture of somewhere, not of anyone's home)."""
    from aiohttp import web
    from mantel_server.connectors import camera_still
    pictures = {"camera.front_door": "07.webp", "camera.backyard": "21.webp"}

    async def still(request, url, params, token, what, unavailable, not_found):
        name = next((v for k, v in pictures.items() if k in url), "01.webp")
        return web.Response(body=(ROOT / "web/hk/landscapes" / name).read_bytes(), content_type="image/webp")
    camera_still.proxy_image = still

    async def read(app, url, params, token, what):        # the shared-still route reads the whole picture (2026-10-29)
        name = next((v for k, v in pictures.items() if k in url), "01.webp")
        return (ROOT / "web/hk/landscapes" / name).read_bytes(), "image/webp"
    camera_still.read_image = read


def stand_in_connections(app, store) -> None:
    """The Connections page's two connections, as if set up: Home Assistant and Music Assistant at invented
    addresses. Nothing is saved or applied, so nothing ever tries to connect."""
    from mantel_server.connections import Record
    link = store.get_link("gallery-owner")["user_id"]
    ha = Record(kind="ha", url="http://homeassistant.local:8123", token="fictional", method="oauth", since=NOW - 9 * 86400,
                user={"id": "gallery-ha", "name": "Mantel", "is_admin": True}, by=link, by_name=OWNER, version="2026.10.2")
    ma = Record(kind="ma", url="http://music.local:8095", token="fictional", method="login", since=NOW - 9 * 86400,
                user={"id": "gallery-ma", "name": "Mantel", "is_admin": False}, by=link, by_name=OWNER, version="2.7.1")
    app["connections"].own.update({"ha": ha, "ma": ma})
    ha_client = app["hub"].ha                         # never started here: only what it would say about itself
    ha_client.connected_since, ha_client.ha_version = NOW - 3 * 3600, "2026.10.2"


async def build(base: Path, showcase: bool = False, real_model: bool = False):
    """The invented house and a real Mantel Server over it. `showcase` (the docs' shots): also a day's history, a
    forecast, the Energy feature with its Power page, and Home Assistant and Music Assistant as connected. The
    other headless checks that build on this house leave it off, and get the plainer house they were written for."""
    from mantel_server import settings_store
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.sessions import Identity, User
    from mantel_server.store import Store

    cfg = Config(data_dir=base / "data", fixtures=base / "fixtures", hk_files=base / "user-files", default_screen=SCREEN,
                 commands_enabled=True)
    store = Store(cfg.data_dir / "gallery.db")
    store.link("gallery-owner", "owner", OWNER)
    cookie = store.create_session("gallery-owner", 3600)
    app = build_app(cfg, "unused-gallery-token", store=store, connect_ha=False)
    hub = app["hub"]
    app["ma"] = GalleryLibrary()
    if showcase:
        stand_in_connections(app, store)
    from app_dev_server import FictionalCommander
    app["gateway"].commander = FictionalCommander(hub, app["gateway"].writes)     # changes the fictional states only
    owner = Identity(User(store.get_link("gallery-owner")["user_id"], OWNER, "owner", "ha_linked"), None, "lan")
    settings = settings_store.register(app, hub, settings_store.SettingsHooks(
        may_configure=settings_store.rbac_may_configure()),
        # (real_model: hk_core's settings model, as a house runs -- a check that writes keys the stored screen
        # doesn't have yet, the Looks')
        model=settings_store.load_model() if real_model else settings_store.ThinModel())
    if showcase:
        settings.features = FictionalFeatures()      # the Energy feature is added, with its Power page

    async def fictional_ha():
        data = json.loads(json.dumps(SETTINGS))
        if showcase:
            data["boards"][GRID_SCREEN] = wall_display()         # beside Home: a screen that uses the Home Grid layout
            data["boards"][INTERCOM_SCREEN] = intercom_display()
        return data
    await settings_store.import_settings(settings.store, fictional_ha, actor=settings_store.Actor(label="gallery"))
    hub.readproxy = (GalleryReads if showcase else OfflineReads)(app, owner)
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
    if showcase:
        seed_alerts(app)
    return app, cookie


def seed_alerts(app) -> None:
    """Mantel Settings -> Alerts, as a house that set it up: two channels (a Discord channel that has sent, an email
    that is quiet at night), a week of what was sent, and an update waiting. Written through the alerts' own stores;
    the secrets are made up and sealed like any other (nothing is sent: the center's loop is not running here)."""
    from mantel_server import about, alerts
    from mantel_server.alerts.updates import newer
    import os
    os.environ.setdefault("MANTEL_INSTALL", "lxc")      # About says how to update this install: one line, not both
    a = app["alerts"]
    app["gallery_alert_ids"] = {}
    discord = a.channels.add("discord", "Family Discord", events=alerts.catalog.defaults(), min_level="info", quiet={},
                             config={}, secret={"url": "https://discord.com/api/webhooks/123456789012345678/"
                                                       "fictional-token-AbCdEfGhIjKlMnOpQrStUv", "main": "https://discord.com/api/webhooks/123456789012345678/"
                                                       "fictional-token-AbCdEfGhIjKlMnOpQrStUv"})
    mail_events = [e for e in alerts.catalog.defaults() if not e.startswith(("tablet.", "update."))] + ["backup.ok"]
    email = a.channels.add("email", "Email", events=mail_events, min_level="warning",
                           quiet={"on": True, "from": "22:00", "to": "07:00", "critical": True},
                           config={"host": "smtp.example.com", "port": 587, "security": "starttls", "user": "maple@example.com",
                                   "from": "mantel@example.com", "to": ["maple@example.com"]},
                           # as email.clean keeps it: the server and user it was typed for, and no hint ("main")
                           secret={"password": "fictional-app-password", "host": "smtp.example.com",
                                   "user": "maple@example.com"})
    a.channels.sent(discord)
    a.channels.sent(email)
    app["gallery_alert_ids"].update(discord=discord, email=email)
    log = a.log
    now = NOW
    rows = [(25 * 3600, "backup.ok", "", "info", True, "Backup finished", "mantel-20261101-031500.mbk (48.2 MB).", [email]),
            (18 * 3600, "tablet.offline", "kitchen", "warning", True, "Kitchen tablet is offline",
             "Its kiosk app hasn't been heard from for 10 minutes. It may be off the Wi-Fi, or behind the lock screen after a restart.", [discord, "app"]),
            (17.8 * 3600, "tablet.offline", "kitchen", "warning", False, "Kitchen tablet is back", "", [discord, "app"]),
            (9 * 3600, "ma.lost", "", "warning", True, "Music Assistant disconnected",
             "Mantel can't reach Music Assistant. Music on the screens won't play or show what's on.", [discord, email, "app"]),
            (8.9 * 3600, "ma.lost", "", "warning", False, "Music Assistant is back", "Mantel is connected to Music Assistant again.", [discord, email, "app"]),
            (3 * 3600, "backup.failed", "", "critical", True, "Backup failed", "The backup folder is full.", [discord, email, "app"]),
            (2.2 * 3600, "backup.failed", "", "critical", False, "Backups work again", "The next backup finished: mantel-20261102-063000.mbk.", [discord, email, "app"]),
            (30 * 60, "update.mantel", "", "info", True, "Mantel 0.1.114 is available", "In Home Assistant: Settings → Add-ons → Mantel → Update.", [discord, "app"])]
    for ago, kind, key, level, up, title, body, to in rows:
        log.add(now - ago, kind, key, level, up, title, body, to)
    have = about.release().get("version") or "0.1.113"
    parts = have.split(".")
    want = ".".join(parts[:-1] + [str(int(parts[-1]) + 1)]) if parts[-1].isdigit() else have
    assert newer(want, have)
    a.settings.set("updates_state", {"latest": {"mantel": {"version": want, "date": now - 3600, "url": "https://github.com/jazzphone/mantel/releases"}},
                                     "checked_at": now - 1800, "error": None})


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
    rows = [(95, owner_id, OWNER, "owner", "light.turn_on", ["light.living_room_lamps"], "allowed", "ok"),
            (80, people["alex"], "Alex Rivera", "adult", "lock.unlock", ["lock.front_door"], "allowed", "ok"),
            (64, people["alex"], "Alex Rivera", "adult", "lock.lock", ["lock.front_door"], "allowed", "ok"),
            (41, people["riley"], "Riley Rivera", "child", "lock.unlock", ["lock.back_door"], "denied", None),
            (30, owner_id, OWNER, "owner", "climate.set_temperature", ["climate.upstairs"], "allowed", "ok"),
            (12, people["riley"], "Riley Rivera", "child", "light.turn_off", ["light.guest_room"], "allowed", "ok"),
            (5, owner_id, OWNER, "owner", "scene.turn_on", ["scene.movie_night"], "allowed", "ok")]
    try:
        for minutes, uid, name, role, action, targets, decision, result in rows:
            audit.clock = lambda m=minutes: NOW - m * 60
            ident = Identity(User(uid, name, role, "hk"), None, "lan")
            audit.record(principal=SimpleNamespace(identity=ident, source_ip="192.0.2.20"), kind="service", action=action, targets=targets,
                         decision=decision, reason="role" if decision == "allowed" else "not_granted", result=result)
    finally:
        audit.clock = clock


# Apple's SF Pro never appears in the repository (Rules): every shot is set in Arial, in every shadow root and frame
ARIAL = """(() => { const visit = (root) => { if (!root.querySelector('style[data-gallery-font]')) {
    const s = document.createElement('style'); s.dataset.galleryFont = '';
    s.textContent = '*{font-family:Arial,Helvetica,sans-serif!important}'; (root.head || root).appendChild(s); }
  for (const e of root.querySelectorAll('*')) { if (e.shadowRoot) visit(e.shadowRoot);
    if (e.localName === 'iframe') { try { visit(e.contentDocument); } catch (x) { /* another origin */ } } } };
  visit(document); })()"""


# the test server's own address (a different port every run) is written as an address a home would have
ADDRESSES = r"""(() => { const fix = (t) => t.replace(/http:\/\/127\.0\.0\.1:\d+/g, 'http://mantel.local:8080').replace(/127\.0\.0\.1/g, '192.0.2.10');
  const visit = (root) => { const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
    while ((n = walk.nextNode())) { const t = fix(n.nodeValue); if (t !== n.nodeValue) n.nodeValue = t; }
    for (const e of root.querySelectorAll('*')) { if (e.shadowRoot) visit(e.shadowRoot);
      if (e.localName === 'iframe') { try { visit(e.contentDocument); } catch (x) { /* another origin */ } } } };
  visit(document); })()"""


def is_screen(path: str) -> bool:
    return not path.startswith(("/settings", "/login"))


async def shoot(out: Path, only: list[str] | None, system_font: bool = False) -> list[Path]:
    written = []
    with tempfile.TemporaryDirectory(prefix="mantel-gallery-") as folder:
        app, cookie = await build(Path(folder), showcase=True)
        async with TestServer(app) as server:
            origin = str(server.make_url("")).rstrip("/")
            for name, (path, (w, h), signed_in, script) in SHOTS.items():
                if only and name not in only:
                    continue
                path = path.format(**app.get("gallery_alert_ids", {})) if "{" in path else path
                async with Browser(width=w, height=h, port=9381) as b:
                    await b.restrict_origin(origin)
                    await b.send("Emulation.setFocusEmulationEnabled", enabled=True)    # a window in front: cameras play, the sky moves
                    await b.open(origin + path, cookie if signed_in else None)
                    if is_screen(path):
                        await b.wait("window.__mantelReady === true", 25)
                    else:
                        await b.wait("document.readyState === 'complete'", 25)
                    await asyncio.sleep(2.5)            # the sky, pictures and fonts settle
                    if script:
                        await b.eval(script)
                        await asyncio.sleep(1.5)
                    await b.eval(ADDRESSES)
                    if not system_font:
                        await b.eval(ARIAL)
                        await asyncio.sleep(0.8)
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
    ap.add_argument("--system-font", action="store_true", help="leave the machine's own font (never for the docs)")
    a = ap.parse_args(argv)
    if a.list:
        print("\n".join(SHOTS))
        return 0
    a.out.mkdir(parents=True, exist_ok=True)
    asyncio.run(shoot(a.out, a.only, a.system_font))
    return 0


if __name__ == "__main__":
    sys.exit(main())
