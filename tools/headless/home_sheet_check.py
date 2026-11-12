"""The Home block and its sheet (web/hk/cards/hk-home-block.js, docs/phase27/PLAN.md) in WebKit and Chromium, on a fictional house.

A real Mantel Server over the gallery's invented home, with house commands OFF (the gateway is taken down before the
page loads, and the page's socket is watched: not one command frame may leave it). A few extra fictional accessories
give the rooms something to say: a lock left unlocked, a garage door open, shades.

Three screens, each a Home Grid with the Home block at every size (Small, Wide, Tall, Large, Extra Large):

  home-sq      square cells, the Centered style (HomeView's): the block's glyphs bare
  home-tiles   tile cells (196 x 150), the Home style: the glyph in its well
  home-car     square cells on a screen whose own Home would be a car's: the sheet is still the generated Home

It checks, at each size of block: nothing past its plate, Tall up its lines a finger tall in a list that scrolls, Large's
categories as standard pills; the plate opening the sheet at Home and a room at that room, a category going to its own
page as its chip does. In the sheet, at the wall tablet's size, an iPad's and a phone's: the generated Home's own list
(the chips, the camera mosaic, Scenes, Favorites, the rooms) less its clock, its pop-ups and the menu key; a room's
heading opening the room inside the sheet with a "Home" key, an accessory opened there coming back to it, the key coming
back; a chip and Cameras going to the screen's own page, the sheet with them; Escape at Home closing it; nothing past
the window, no sideways scroll; Reduce Motion's fade.

    export PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=$(command -v node)
    ~/.venvs/mantel/bin/python tools/headless/home_sheet_check.py [--shots DIR] [--engine webkit|chromium|both]

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

# extra fictional accessories: entity_id -> (area, (state, attributes))
EXTRA = {
    "lock.back_door": ("kitchen", ("unlocked", {"friendly_name": "Back Door", "supported_features": 0})),
    "cover.garage_door": ("garage", ("open", {"friendly_name": "Garage Door", "device_class": "garage", "supported_features": 3})),
    "cover.living_room_shades": ("living_room", ("open", {"friendly_name": "Living Room Shades", "device_class": "shade",
                                                          "current_position": 100, "supported_features": 15})),
}
CHIPS = ["security", "climate", "lights", "speakers", "blinds"]


def grid(cell: str) -> dict:
    g = {"v": 1, "cols": 6, "rows": 4, "frame": [1180, 820], "band": False, "items": [
        {"id": "xl", "card": "home", "size": "XL", "at": [0, 0]},
        {"id": "l", "card": "home", "size": "L", "at": [3, 0]},
        {"id": "t", "card": "home", "size": "T", "at": [5, 0]},
        {"id": "w", "card": "home", "size": "W", "at": [0, 2]},
        {"id": "s", "card": "home", "size": "S", "at": [2, 2]},
        {"id": "s2", "card": "home", "size": "S", "at": [3, 2], "opts": {"title": "Linden House"}}]}
    if cell == "square":
        g["cell"] = "square"
    return g


def board(cell: str, style: str, car: bool = False) -> dict:
    b = {"title": "Home Block", "pages": [], "headers": {"home": True}, "menu_custom": True, "menu": "tabbar",
         "home_style": "grid", "home_grid": grid(cell), "chips": CHIPS, "tile_style": style}
    if car:
        b.update({"car": True, "car_layout": "car"})
    return b


async def main(shots: Path | None, engines: list[str], only: list[str], sizes: list[str]) -> int:
    import gallery
    from aiohttp.test_utils import TestServer
    from mantel_server.server import apply_commands
    gallery.HOUSE.update(EXTRA)
    gallery.SETTINGS["settings"]["security"]["alarm"] = "alarm_control_panel.home"
    gallery.SETTINGS["boards"]["home-sq"] = board("square", "centred")
    gallery.SETTINGS["boards"]["home-tiles"] = board("tile", "home")
    gallery.SETTINGS["boards"]["home-car"] = board("square", "centred", car=True)
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
    ap.add_argument("--sizes", nargs="*", default=[], help="the sheet's window sizes to run (1280x800 390x844 ...)")
    a = ap.parse_args()
    if not os.environ.get("PLAYWRIGHT_PATH") or not os.environ.get("NODE"):
        print("home_sheet_check: skipped (set PLAYWRIGHT_PATH to playwright-core and NODE to node)")
        sys.exit(0)
    if a.shots:
        a.shots.mkdir(parents=True, exist_ok=True)
    sys.exit(asyncio.run(main(a.shots, ["webkit", "chromium"] if a.engine == "both" else [a.engine], a.only, a.sizes)))
