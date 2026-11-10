"""House Status (web/hk/cards/hk-house-status.js, docs/phase11/HOUSE-STATUS.md) in WebKit and Chromium, on a fictional house.

A real Mantel Server over the gallery's invented home, with house commands OFF (the gateway is taken down before the
page loads, and the page's socket is watched: not one command frame may leave it). Extra fictional accessories give
every status kind something to say: two shades (one open), three timers (two running, one paused), a leak sensor, a
vacuum cleaning, a weather alert, a mailbox sensor.

Three screens, each a Home Grid with House Status at every size (Small, Wide, Tall, Large, Extra Large):

  hs-six     square cells: the handoff's six chips (Climate, Timers, Energy, Blinds, Lights, Security), Blinds When
             Active, and the screen's chip row switched OFF -- House Status still shows them
  hs-all     square cells: every kind, an entity chip and three custom chips (a status chip, a conditional one, and a
             card House Status can't read, named in the sheet)
  hs-tiles   the same as hs-six on tile cells (196 x 150, the 10 px gap)

It checks, at each size of block: every section a line of 56 px in one list that scrolls (2026-11-09: no "+N more"; the
list's last line reachable, its fade gone at the foot), nothing past the plate, a section's tap navigating once to its
chip's page, the headline (the plate's tap) and Small opening the sheet. The sheet at the tablets' and phones' sizes (and the 640 / 500
thresholds either side): wide panels or rows as its width allows, inside the window, its header fixed while the body
scrolls, the first and last reachable, no sideways scroll, Escape closing it with the focus back where it was.

    export PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=$(command -v node)
    ~/.venvs/mantel/bin/python tools/headless/house_status_check.py [--shots DIR] [--engine webkit|chromium|both]

Without PLAYWRIGHT_PATH or NODE it says why and exits 0. `--shots` keeps the screenshots (PNG, 2x) there.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests', '.')]

NOW = time.time()

# extra fictional accessories: entity_id -> (area, (state, attributes))
EXTRA = {
    "cover.living_room_shades": ("living_room", ("open", {"friendly_name": "Living Room Shades", "device_class": "shade",
                                                          "current_position": 100, "supported_features": 15})),
    "cover.bedroom_blinds": ("bedroom", ("closed", {"friendly_name": "Bedroom Blinds", "device_class": "blind",
                                                    "current_position": 0, "supported_features": 15})),
    "timer.pasta": ("kitchen", ("active", {"friendly_name": "Pasta", "duration": "0:12:00", "remaining": "0:12:00",
                                           "finishes_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(NOW + 522))})),
    "timer.laundry": ("garage", ("active", {"friendly_name": "Laundry", "duration": "0:45:00", "remaining": "0:45:00",
                                            "finishes_at": time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(NOW + 1900))})),
    "timer.tea": ("kitchen", ("paused", {"friendly_name": "Tea", "duration": "0:05:00", "remaining": "0:03:10"})),
    "binary_sensor.laundry_leak": ("garage", ("on", {"friendly_name": "Laundry Leak", "device_class": "moisture"})),
    "vacuum.downstairs": ("living_room", ("cleaning", {"friendly_name": "Downstairs Vacuum", "battery_level": 80,
                                                       "supported_features": 16383})),
    "sensor.weather_alerts": (None, ("1", {"friendly_name": "Weather Alerts", "Alerts": [
        {"Event": "Wind Advisory", "Headline": "Wind Advisory until 6 PM", "Severity": "Moderate"}]})),
    "binary_sensor.mailbox": ("porch", ("on", {"friendly_name": "Mailbox", "device_class": "opening"})),
    "sensor.pool_temperature": ("backyard", ("78", {"friendly_name": "Pool", "unit_of_measurement": "°F",
                                                    "device_class": "temperature"})),
}

SIX = ["climate", "timers", "energy", "blinds", "lights", "security"]
ALL = ["weather_alert", "security", "doors_windows", "climate", "lights", "blinds", "timers", "vacuums", "speakers",
       "water", "energy", "sensor.pool_temperature", "chip:mail", "chip:porch", "chip:odd"]
CUSTOM = [
    # a status chip of the house's own: read like any chip
    {"key": "mail", "name": "Mail", "after": "end", "card": {
        "type": "custom:hk-status-chip-card", "entity": "binary_sensor.mailbox", "name": "Mail", "icon": "hk:mailbox",
        "label_map": {"on": "Delivered", "off": "Empty"}}},
    # a conditional around one: read, its condition judged
    {"key": "porch", "name": "Porch Light", "after": "end", "card": {
        "type": "conditional", "conditions": [{"condition": "state", "entity": "light.porch", "state": "on"}],
        "card": {"type": "custom:hk-status-chip-card", "entity": "light.porch", "name": "Porch Light"}}},
    # a card House Status can't read: named in the sheet, never dropped unseen
    {"key": "odd", "name": "Garden Glance", "after": "end", "card": {
        "type": "glance", "entities": ["sensor.backyard_temperature"]}},
]


def grid(cell: str) -> dict:
    g = {"v": 1, "cols": 6, "rows": 4, "frame": [1180, 820], "band": False, "items": [
        {"id": "xl", "card": "house_status", "size": "XL", "at": [0, 0]},
        {"id": "l", "card": "house_status", "size": "L", "at": [3, 0]},
        {"id": "t", "card": "house_status", "size": "T", "at": [5, 0]},
        {"id": "w", "card": "house_status", "size": "W", "at": [0, 2]},
        {"id": "s", "card": "house_status", "size": "S", "at": [2, 2]},
        {"id": "w2", "card": "house_status", "size": "W", "at": [3, 2]}]}
    if cell == "square":
        g["cell"] = "square"
    return g


def board(chips: list, cell: str, quiet: list | None = None, row: bool = True, custom: list | None = None) -> dict:
    b = {"title": "House Status", "pages": [], "headers": {"home": True}, "menu_custom": True, "menu": "tabbar",
         "home_style": "grid", "home_grid": grid(cell), "chips": chips}
    if quiet is not None:
        b["chips_quiet"] = quiet
    if not row:
        b["chips_row"] = False
    if custom:
        b["chips_custom"] = custom
    extra = [c for c in chips if "." in c]
    if extra:
        b["chips_extra"] = extra
    return b


async def main(shots: Path | None, engines: list[str], only: list[str], sizes: list[str]) -> int:
    import gallery
    from aiohttp.test_utils import TestServer
    from mantel_server.server import apply_commands
    gallery.HOUSE.update(EXTRA)
    gallery.SETTINGS["settings"]["weather"]["alerts"] = "sensor.weather_alerts"
    gallery.SETTINGS["settings"]["features"]["power"] = "sensor.home_power"
    gallery.SETTINGS["settings"]["security"]["alarm"] = "alarm_control_panel.home"
    gallery.SETTINGS["custom_chips"] = CUSTOM
    gallery.SETTINGS["boards"]["hs-six"] = board(SIX, "square", quiet=["blinds"], row=False)
    gallery.SETTINGS["boards"]["hs-all"] = board(ALL, "square", quiet=[], custom=["mail", "porch", "odd"])
    gallery.SETTINGS["boards"]["hs-tiles"] = board(SIX, "tile", quiet=["blinds"])
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        # HOUSE COMMANDS OFF for the whole run: no gateway, every command refused (the page is watched too)
        app["cfg"].commands_enabled = False
        await apply_commands(app, app["hub"], False)
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(os.environ["NODE"], str(Path(__file__).with_suffix(".cjs")),
                                                        stdin=asyncio.subprocess.PIPE)
            await proc.communicate(json.dumps({
                "origin": str(server.make_url("")).rstrip("/"), "cookie": cookie, "shots": str(shots) if shots else "",
                "engines": engines, "only": only, "sizes": sizes}).encode())
            return proc.returncode or 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--shots", type=Path, help="keep the screenshots here")
    ap.add_argument("--engine", choices=["webkit", "chromium", "both"], default="both")
    ap.add_argument("--only", nargs="*", default=[], help="parts to run: blocks, sheet")
    ap.add_argument("--sizes", nargs="*", default=[], help="the sheet's window sizes to run (1180x820 390x844 ...)")
    a = ap.parse_args()
    if not os.environ.get("PLAYWRIGHT_PATH") or not os.environ.get("NODE"):
        print("house_status_check: skipped (set PLAYWRIGHT_PATH to playwright-core and NODE to node)")
        sys.exit(0)
    if a.shots:
        a.shots.mkdir(parents=True, exist_ok=True)
    sys.exit(asyncio.run(main(a.shots, ["webkit", "chromium"] if a.engine == "both" else [a.engine], a.only, a.sizes)))
