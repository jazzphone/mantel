"""The Laundry block, its sheet, its room tile and its chip (docs/phase22/LAUNDRY.md) in WebKit and Chromium, on a fictional house.

A real Mantel Server over the gallery's invented home, with house commands OFF (the gateway is down, and the page's sockets are
watched: not one command frame may leave). The house is built twice:

  one     a washer-dryer (Samsung's spellings) drying, 24 minutes left, 74% through
  two     a washer (spinning, 6 minutes) and a dryer (LG's spellings, drying, 52 minutes)

and each time four screens: la-square (every size on square cells), la-tiles (every size on tile cells), the Laundry room's
generated page (the machines' tiles, the Laundry chip). It checks, at each size: everything inside the plate's inset, no words cut,
what each machine says; that a tap on the plate (or on one machine's half) opens the laundry sheet; the sheet at the sheets' own
Wide size and height with its two columns' tops and feet lined up; on the room page each machine a still tile with the house glyph,
and the Laundry chip.

    export PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=$(command -v node)
    ~/.venvs/mantel/bin/python tools/headless/laundry_check.py [--shots DIR] [--engine webkit|chromium|both]

Without PLAYWRIGHT_PATH or NODE it says why and exits 0. `--shots` keeps the screenshots (PNG, 2x) there.
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests', '.')]


def iso(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, dt.timezone.utc).isoformat(timespec="seconds")


def extra(now: float, two: bool) -> dict:
    job = ["air_wash", "ai_rinse", "ai_spin", "ai_wash", "cooling", "drying", "finish", "none", "rinse", "spin", "wash", "wrinkle_prevent"]
    out = {
        "select.washer": ("laundry", ("run", {"friendly_name": "Washer", "options": ["stop", "run", "pause"]})),
        "sensor.washer_machine_state": ("laundry", ("run", {"friendly_name": "Washer Machine State", "device_class": "enum", "options": ["pause", "run", "stop"]})),
        "sensor.washer_job_state": ("laundry", ("spin" if two else "drying", {"friendly_name": "Washer Job State", "device_class": "enum", "options": job})),
        "sensor.washer_completion_time": ("laundry", (iso(now + (6 if two else 24) * 60 + 20), {"friendly_name": "Washer Completion Time", "device_class": "timestamp"})),
        "sensor.washer_progress": ("laundry", ("91" if two else "74", {"friendly_name": "Washer Progress", "unit_of_measurement": "%"})),
        "binary_sensor.washer_remote_control": ("laundry", ("off", {"friendly_name": "Washer Remote Control"})),
        "binary_sensor.laundry_leak": ("laundry", ("off", {"friendly_name": "Laundry Leak Sensor", "device_class": "moisture"})),
        "sensor.dryer_current_status": ("laundry", ("drying", {"friendly_name": "Dryer Current Status", "device_class": "enum",
                                                               "options": ["power_off", "drying", "cooling", "wrinkle_care", "end", "error"]})),
        "sensor.dryer_remain": ("laundry", (iso(now + 52 * 60 + 20), {"friendly_name": "Dryer Remaining Time", "device_class": "timestamp"})),
    }
    return out


WASHER = {"id": "washer", "name": "Washer", "kind": "combo", "area": "laundry", "watts": 10, "status": "sensor.washer_machine_state",
          "phase": "sensor.washer_job_state", "time": "sensor.washer_completion_time", "progress": "sensor.washer_progress",
          "remote": "binary_sensor.washer_remote_control", "leak": "binary_sensor.laundry_leak"}
DRYER = {"id": "dryer", "name": "Dryer", "kind": "dryer", "area": "laundry", "watts": 10, "status": "sensor.dryer_current_status",
         "time": "sensor.dryer_remain", "leak": "binary_sensor.laundry_leak"}


def every_size(cell: str) -> dict:
    g = {"v": 1, "cols": 6, "rows": 4, "frame": [1180, 820], "band": False, "items": [
        {"id": "xl", "card": "laundry", "size": "XL", "at": [0, 0]},
        {"id": "l", "card": "laundry", "size": "L", "at": [3, 0]},
        {"id": "t", "card": "laundry", "size": "T", "at": [5, 0]},
        {"id": "w", "card": "laundry", "size": "W", "at": [0, 2]},
        {"id": "s", "card": "laundry", "size": "S", "at": [2, 2]}]}
    if cell == "square":
        g["cell"] = "square"
    return g


def board(grid: dict | None) -> dict:
    b = {"title": "Laundry", "pages": [], "headers": {"home": True}, "menu_custom": True, "menu": "tabbar",
         "chips": ["laundry", "lights", "security"], "chips_quiet": []}
    if grid:
        b.update({"home_style": "grid", "home_grid": grid})
    return b


async def run(shots: Path | None, engines: list[str], only: list[str], two: bool) -> int:
    import gallery
    from mantel_server.server import apply_commands
    from aiohttp.test_utils import TestServer
    if not any(a == "laundry" for a, _, _ in gallery.ROOMS):
        gallery.ROOMS.append(("laundry", "Laundry", "main"))
    gallery.HOUSE.update(extra(gallery.NOW, two))
    gallery.SETTINGS["settings"]["features"]["laundry"] = [WASHER | ({"kind": "washer"} if two else {}), DRYER] if two else [WASHER]
    gallery.SETTINGS["boards"]["la-square"] = board(every_size("square"))
    gallery.SETTINGS["boards"]["la-tiles"] = board(every_size("tile"))
    gallery.SETTINGS["boards"]["la-room"] = board(None)
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        app["cfg"].commands_enabled = False
        await apply_commands(app, app["hub"], False)
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(os.environ["NODE"], str(Path(__file__).with_suffix(".cjs")), stdin=asyncio.subprocess.PIPE)
            await proc.communicate(json.dumps({"origin": str(server.make_url("")).rstrip("/"), "cookie": cookie, "two": two,
                                               "shots": str(shots) if shots else "", "engines": engines, "only": only}).encode())
            return proc.returncode or 0


async def main(shots: Path | None, engines: list[str], only: list[str]) -> int:
    bad = 0
    for two in (False, True):
        bad |= await run(shots, engines, only, two)
    return bad


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--shots", type=Path, help="keep the screenshots here")
    ap.add_argument("--engine", choices=["webkit", "chromium", "both"], default="both")
    ap.add_argument("--only", nargs="*", default=[], help="parts to run: sizes, taps, sheet, room")
    a = ap.parse_args()
    if not os.environ.get("PLAYWRIGHT_PATH") or not os.environ.get("NODE"):
        print("laundry_check: skipped (set PLAYWRIGHT_PATH to playwright-core and NODE to node)")
        sys.exit(0)
    if a.shots:
        a.shots.mkdir(parents=True, exist_ok=True)
    sys.exit(asyncio.run(main(a.shots, ["webkit", "chromium"] if a.engine == "both" else [a.engine], a.only)))
