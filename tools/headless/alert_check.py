"""The Alert block (web/hk/cards/hk-alert.js, docs/phase11/ALERT.md) in WebKit and Chromium, on a fictional house.

A real Mantel Server over the gallery's invented home, with house commands OFF (the gateway is down, and the page's sockets are
watched: not one command frame may leave). The garage door is open, 23 minutes now; a garage camera has a still; the washer's
camera is unavailable. Four screens:

  al-square   square cells: the garage's alert at every size (camera, action, time), and two laundry alerts (Large, Small)
              whose camera is unavailable and that have no action
  al-tiles    the same on tile cells (196 x 150, the 10 px gap)
  al-nocam    square cells: the garage's alert at every size with a camera the house doesn't have
  al-rules    two House Status blocks (Large, Tall) with the house's rules: the water alert, the garage's, the laundry's

It checks, at each size: everything inside the plate's inset (Small's picture to its corners), the action a finger's height and
saying Close, the line counting from the door's open time, the picture where a camera has a still and none where it hasn't; a
tap on the action opening the garage door's sheet, a tap on the picture the camera's, Small's plate doing the action; and, as the
house changes, House Status, then the garage's alert, still the garage's when the laundry is done too (first match), the
laundry's when the garage closes, and House Status again when that clears.

    export PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=$(command -v node)
    ~/.venvs/mantel/bin/python tools/headless/alert_check.py [--shots DIR] [--engine webkit|chromium|both]

Without PLAYWRIGHT_PATH or NODE it says why and exits 0. `--shots` keeps the screenshots (PNG, 2x) there.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests', '.')]

EXTRA = {
    "camera.garage": ("garage", ("idle", {"friendly_name": "Garage", "access_token": "fictional",
                                          "entity_picture": "/api/camera_proxy/camera.garage?token=fictional"})),
    "camera.washer": ("garage", ("unavailable", {"friendly_name": "Washer"})),
    "binary_sensor.garage_door_open_too_long": ("garage", ("off", {"friendly_name": "Garage Open Too Long"})),
    "sensor.washer_job_state": ("garage", ("none", {"friendly_name": "Washer Job State"})),
    "input_select.water_running_monitor_status": (None, ("idle", {"friendly_name": "Water Monitor", "options": ["idle", "notified"]})),
}
GARAGE = {"title": "Garage Still Open", "since": "cover.garage_door", "camera": "camera.garage", "control": "cover.garage_door",
          "icon": "hk:garage-open", "color": "teal"}
LAUNDRY = {"title": "Laundry Ready", "text": "Cycle complete", "since": "sensor.washer_job_state", "camera": "camera.washer",
           "icon": "mdi:washing-machine"}
RULES = [{"when": {"all": [{"kind": "entity_state", "entity": "input_select.water_running_monitor_status", "state": "notified"}]}, "card": "water"},
         {"when": {"all": [{"kind": "entity_state", "entity": "binary_sensor.garage_door_open_too_long", "state": "on"}]}, "card": "alert", "opts": GARAGE},
         {"when": {"all": [{"kind": "entity_state", "entity": "sensor.washer_job_state", "state": "finish"}]}, "card": "alert", "opts": LAUNDRY}]


def every_size(cell: str, garage: dict) -> dict:
    g = {"v": 1, "cols": 6, "rows": 4, "frame": [1180, 820], "band": False, "items": [
        {"id": "xl", "card": "alert", "size": "XL", "at": [0, 0], "opts": garage},
        {"id": "l", "card": "alert", "size": "L", "at": [3, 0], "opts": garage},
        {"id": "t", "card": "alert", "size": "T", "at": [5, 0], "opts": garage},
        {"id": "w", "card": "alert", "size": "W", "at": [0, 2], "opts": garage},
        {"id": "s", "card": "alert", "size": "S", "at": [2, 2], "opts": garage},
        {"id": "ll", "card": "alert", "size": "L", "at": [3, 2], "opts": LAUNDRY},
        {"id": "ls", "card": "alert", "size": "S", "at": [5, 2], "opts": LAUNDRY},
        {"id": "lw", "card": "alert", "size": "W", "at": [0, 3], "opts": LAUNDRY}]}
    if cell == "square":
        g["cell"] = "square"
    return g


def rules_grid() -> dict:
    return {"v": 1, "cols": 5, "rows": 4, "frame": [1180, 820], "band": False, "cell": "square", "items": [
        {"id": "big", "card": "house_status", "size": "L", "at": [0, 0], "rules": RULES},
        {"id": "tall", "card": "house_status", "size": "T", "at": [3, 0], "rules": RULES},
        {"id": "clock", "card": "clock", "size": "S", "at": [4, 0]}]}


def board(grid: dict) -> dict:
    return {"title": "Alert", "pages": [], "headers": {"home": True}, "menu_custom": True, "menu": "tabbar", "home_style": "grid",
            "home_grid": grid, "chips": ["climate", "lights", "security"]}


async def main(shots: Path | None, engines: list[str], only: list[str]) -> int:
    import gallery
    from aiohttp import web
    from aiohttp.test_utils import TestServer
    from mantel_server.server import apply_commands
    gallery.HOUSE.update(EXTRA)
    gallery.SETTINGS["boards"]["al-square"] = board(every_size("square", GARAGE))
    gallery.SETTINGS["boards"]["al-tiles"] = board(every_size("tile", GARAGE))
    gallery.SETTINGS["boards"]["al-nocam"] = board(every_size("square", {**GARAGE, "camera": "camera.not_in_the_house"}))
    gallery.SETTINGS["boards"]["al-rules"] = board(rules_grid())
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        app["cfg"].commands_enabled = False
        await apply_commands(app, app["hub"], False)
        hub = app["hub"]
        # THE GARAGE DOOR, OPEN for 23 minutes: its open-state time is what the line counts from
        hub.on_change(hub.store.apply_event({"c": {"cover.garage_door": {"+": {"s": "open", "lc": gallery.NOW - 23 * 60, "lu": gallery.NOW - 23 * 60}}}}))

        # the house moving, on the check's word: {entity_id: state}
        async def move(request):
            body = json.loads(request.query["s"])
            touched = hub.store.apply_event({"c": {eid: {"+": {"s": s, "lc": gallery.NOW, "lu": gallery.NOW}} for eid, s in body.items()}})
            hub.on_change(touched)
            return web.json_response({"ok": sorted(touched)})
        app.router.add_get("/__alert_check/move", move)
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(os.environ["NODE"], str(Path(__file__).with_suffix(".cjs")), stdin=asyncio.subprocess.PIPE)
            await proc.communicate(json.dumps({"origin": str(server.make_url("")).rstrip("/"), "cookie": cookie,
                                               "shots": str(shots) if shots else "", "engines": engines, "only": only}).encode())
            return proc.returncode or 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--shots", type=Path, help="keep the screenshots here")
    ap.add_argument("--engine", choices=["webkit", "chromium", "both"], default="both")
    ap.add_argument("--only", nargs="*", default=[], help="parts to run: sizes, taps, rules")
    a = ap.parse_args()
    if not os.environ.get("PLAYWRIGHT_PATH") or not os.environ.get("NODE"):
        print("alert_check: skipped (set PLAYWRIGHT_PATH to playwright-core and NODE to node)")
        sys.exit(0)
    if a.shots:
        a.shots.mkdir(parents=True, exist_ok=True)
    sys.exit(asyncio.run(main(a.shots, ["webkit", "chromium"] if a.engine == "both" else [a.engine], a.only)))
