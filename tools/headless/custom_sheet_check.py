"""A Home Grid block's Custom Detail Sheet and Security's HomeView sizes (docs/phase11/HOME-GRID.md) in WebKit and
Chromium, on a fictional house, with house commands OFF.

A real Mantel Server over the gallery's invented home (the gateway is taken down before the page loads, and the page's
socket is watched: not one command frame may leave it). Extra fictional entries make the handoff's six accessories: an
alarm, four locks (the last, "Crawl Space", unlocked) and a garage door.

Screens, each a Home Grid:

  cs-square  square cells: Security in HomeView at Small, Wide, Compact, Large and Extra Large; a Weather block (a card
             of readings: its corner button) and a light (one button) with custom sheets
  cs-tiles   the same on tile cells (196 x 150): Extra Large's entries overflow into "N more"
  cs-mixed   a Clock whose sheet mixes Home pills and HomeView tiles, twelve entries

It checks: each Security size drawn, its entries 44 px or more on screen, inside its plate, an entry not secured on the
white plate with dark words; "N more" a slot as big as the rest whose count adds up, and the alarm's line still naming
the hidden unlocked entry; a tap on Large's alarm opening the overview (the six as tiles, HomeView's on square cells),
a tile opening its accessory's sheet and Back coming to the overview; the light's tap opening its sheet and not
toggling it; Weather's corner button; the mixed sheet at a tablet's, a phone's, a phone on its side's and a short
window's size: inside the window, every entry reachable by scrolling, no sideways scroll; Escape closing it.

    export PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=$(command -v node)
    ~/.venvs/mantel/bin/python tools/headless/custom_sheet_check.py [--shots DIR] [--engine webkit|chromium|both]

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

# the handoff's six, invented: entity_id -> (area, (state, attributes))
EXTRA = {
    "lock.garage_entry": ("garage", ("locked", {"friendly_name": "Garage Entry"})),
    "lock.crawl_space": ("garage", ("unlocked", {"friendly_name": "Crawl Space"})),
}
MEMBERS = ["lock.front_door", "lock.back_door", "lock.garage_entry", "cover.garage_door", "lock.crawl_space"]
SIX = ["alarm_control_panel.home"] + MEMBERS


def entries(ids: list[str], **look) -> list[dict]:
    return [{"id": "e%d" % (i + 1), "entity": e, **(look.get(e) or {})} for i, e in enumerate(ids)]


def security(cell: str) -> dict:
    hv = {"presentation": "homeview", "members": MEMBERS}
    g = {"v": 1, "cols": 6, "rows": 4, "frame": [1180, 820], "band": False, "items": [
        {"id": "c", "card": "security", "size": "C", "at": [0, 0], "opts": hv},
        {"id": "w", "card": "security", "size": "W", "at": [3, 0], "opts": hv},
        {"id": "s", "card": "security", "size": "S", "at": [5, 0], "opts": hv},
        {"id": "l", "card": "security", "size": "L", "at": [0, 1], "opts": hv},
        {"id": "xl", "card": "security", "size": "XL", "at": [2, 1], "opts": hv},
        {"id": "wx", "card": "weather", "size": "S", "at": [5, 1], "interaction": {"tap": "custom_sheet", "custom_sheet": {
            "v": 1, "title": "Outside", "entries": entries(["light.porch", "sensor.backyard_temperature"])}}},
        {"id": "lt", "card": "accessory", "size": "S", "at": [5, 2], "opts": {"entity": "light.porch"}, "interaction": {
            "tap": "custom_sheet", "custom_sheet": {"v": 1, "title": "Porch", "entries": entries(["light.porch", "lock.front_door"])}}}]}
    if cell == "square":
        g["cell"] = "square"
    return g


def mixed() -> dict:
    ids = SIX + ["light.porch", "light.porch", "sensor.backyard_temperature", "cover.garage_door", "lock.front_door", "lock.back_door"]
    look = {"lock.front_door": {"name": "Front Door", "color": "teal"}, "light.porch": {"tile_style": "home", "secondary": {"mode": "room"}}}
    es = entries(ids, **look)
    es[7]["secondary"] = {"mode": "state"}            # the same light twice, a different line under each
    return {"v": 1, "cols": 6, "rows": 4, "frame": [1180, 820], "band": False, "cell": "square", "items": [
        {"id": "ck", "card": "clock", "size": "W", "at": [0, 0], "interaction": {"tap": "custom_sheet", "custom_sheet": {
            "v": 1, "title": "Everything Outside", "tile_style": "centred", "entries": es}}}]}


def board(title: str, grid: dict) -> dict:
    return {"title": title, "pages": [], "headers": {"home": True}, "menu_custom": True, "menu": "tabbar",
            "home_style": "grid", "home_grid": grid}


async def main(shots: Path | None, engines: list[str], only: list[str]) -> int:
    import gallery
    from aiohttp.test_utils import TestServer
    from hk_core.settings import home_grid as HG
    from mantel_server.server import apply_commands
    gallery.HOUSE.update(EXTRA)
    gallery.SETTINGS["settings"]["security"]["alarm"] = "alarm_control_panel.home"
    for name, title, grid in (("cs-square", "Sheets Square", security("square")), ("cs-tiles", "Sheets Tiles", security("tile")),
                              ("cs-mixed", "Sheets Mixed", mixed())):
        HG.check(grid)                          # (each layout saves as it is)
        gallery.SETTINGS["boards"][name] = board(title, grid)
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
                "engines": engines, "only": only, "six": SIX}).encode())
            return proc.returncode or 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--shots", type=Path, help="keep the screenshots here")
    ap.add_argument("--engine", choices=["webkit", "chromium", "both"], default="both")
    ap.add_argument("--only", nargs="*", default=[], help="parts to run: security, taps, sheet")
    a = ap.parse_args()
    if not os.environ.get("PLAYWRIGHT_PATH") or not os.environ.get("NODE"):
        print("custom_sheet_check: skipped (set PLAYWRIGHT_PATH to playwright-core and NODE to node)")
        sys.exit(0)
    if a.shots:
        a.shots.mkdir(parents=True, exist_ok=True)
    sys.exit(asyncio.run(main(a.shots, ["webkit", "chromium"] if a.engine == "both" else [a.engine], a.only)))
