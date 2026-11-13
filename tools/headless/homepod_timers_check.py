"""HOMEPOD TIMERS on the screens (phase 28, docs/phase28/HOMEPOD-TIMERS.md), in WebKit and Chromium, on the fictional house.

A real Mantel Server over the gallery's invented home, with a stand-in HomePod timer reader in place of the real one
(features/homepod_timers.py's ``get`` and ``post``): two HomePod timers, one running in the Kitchen and one paused in the
Bedroom, beside one of Mantel's own. Nothing is mirrored: the helpers' states are put straight into the store, as Home
Assistant would have them. At the wall tablet's size (1280 x 800), an iPad's (820 x 1180) and a phone's (390 x 844):

  * the Timers page: a HomePod's card wears the HomePod's glyph and says where it rings, with Pause (Resume) and Cancel
    only; Mantel's own keeps its four keys; nothing past the window
  * Pause on it reaches the reader, through the gateway, with its HomePod, row and label; Cancel the same
  * its sheet: Pause and Cancel, "Kitchen HomePod" under the countdown
  * the alarms under Running: the time, the HomePod and room, the switch on or off; the switch and Edit's Delete (after its
    confirmation) reach the reader
  * Settings > Timers: the reader's state and the Home app rooms, one of them not matched
  * the reader down: the page says "HomePod timers unavailable"

    export PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=$(command -v node)
    ~/.venvs/mantel/bin/python tools/headless/homepod_timers_check.py [--shots DIR] [--engine webkit|chromium|both]

Without PLAYWRIGHT_PATH or NODE it says why and exits 0.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests', '.')]
SIZES = [("wall", 1280, 800), ("ipad", 820, 1180), ("phone", 390, 844)]


def iso(t: float) -> str:
    return datetime.fromtimestamp(t, tz=timezone.utc).isoformat().replace("+00:00", "Z")


class Reader:
    """The stand-in reader: what /timers.json and /alarms.json answer, and every command it is sent."""

    def __init__(self, now: float) -> None:
        self.t0, self.broken, self.posts = now, False, []

    def timers(self, now: float) -> list[dict]:
        return [{"label": "Pasta", "left_s": max(0, int(self.t0 + 900 - now)), "ends_at": iso(self.t0 + 900), "paused": False, "room": "Kitchen",
                 "homepod": "HomePod", "tile": "Kitchen-HomePod-TileCell", "index": 0, "read_at": iso(now)},
                {"label": "Timer", "left_s": 420, "paused": True, "room": "Bedroom", "homepod": "HomePod mini", "tile": "Bedroom-HomePod-mini-TileCell",
                 "index": 0, "read_at": iso(now)},
                {"label": "Tea", "left_s": max(0, int(self.t0 + 1500 - now)), "ends_at": iso(self.t0 + 1500), "paused": False, "room": "Sunroom",
                 "homepod": "HomePod", "tile": "Sunroom-HomePod-TileCell", "index": 0, "read_at": iso(now)}]

    async def get(self, path: str):
        import time
        now = time.time()
        if path.startswith("/command"):
            return {"id": 1, "state": "done", "detail": "pressed"}
        if path == "/timers.json":
            return {"at": iso(now), "broken": self.broken, "timers": self.timers(now)}
        return {"at": iso(now), "broken": self.broken, "alarms": [
            {"label": "Alarm", "time": "6:30 AM", "time_24": "06:30", "enabled": True, "repeats": "Weekdays", "room": "Bedroom",
             "homepod": "HomePod mini", "tile": "Bedroom-HomePod-mini-TileCell", "index": 0},
            {"label": "Alarm", "time": "9:00 PM", "time_24": "21:00", "enabled": False, "room": "Kitchen", "homepod": "HomePod",
             "tile": "Kitchen-HomePod-TileCell", "index": 0}]}

    async def post(self, path: str, params: dict):
        self.posts.append([path, params])
        return {"ok": True, "command": len(self.posts)}


async def main(shots: Path | None, engines: list[str]) -> int:
    import time
    import gallery
    from aiohttp import web
    from aiohttp.test_utils import TestServer
    from hk_core import timers as R
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        hub, host = app["hub"], app["homepod_timers"]
        reader = Reader(time.time())
        host.get, host.post = reader.get, reader.post
        host._current = lambda: SimpleNamespace(url="http://reader.invalid", token="fictional")

        async def no_mirror() -> None:      # (the helpers are put in the store below, as Home Assistant would have them)
            host._arm_wake()
        host.mirror = no_mirror
        await host.look()
        now = time.time()
        put = {}
        for k in host.known.values():
            a = {"friendly_name": k.label, "icon": "mdi:timer-outline", "duration": "0:15:00"}
            if k.paused:
                a["remaining"] = "0:07:00"
            else:
                a["finishes_at"] = iso(k.ends)
            put[k.entity_id] = {"s": "paused" if k.paused else "active", "a": a, "lc": now, "lu": now}
        put["timer.hk_timer_1"] = {"s": "active", "a": {"friendly_name": "Oven", "duration": "0:45:00", "finishes_at": iso(now + 2400)}, "lc": now, "lu": now}
        hub.on_change(hub.store.apply_event({"a": put}))
        hub.on_change({R.SENSOR})
        homepods = {k.label: k.entity_id for k in host.known.values()}

        async def flip(request: web.Request) -> web.Response:     # (the check's own switch: the reader down, or back)
            reader.broken = request.query.get("broken") == "1"
            await host.look()
            hub.on_change({R.SENSOR})
            return web.json_response({"state": host.availability()})

        async def posts(_request: web.Request) -> web.Response:
            return web.json_response(reader.posts)
        app.router.add_get("/__check/flip", flip)
        app.router.add_get("/__check/posts", posts)
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(os.environ["NODE"], str(Path(__file__).with_suffix(".cjs")), stdin=asyncio.subprocess.PIPE)
            await proc.communicate(json.dumps({
                "origin": str(server.make_url("")).rstrip("/"), "cookie": cookie, "shots": str(shots) if shots else "",
                "engines": engines, "sizes": SIZES, "screen": gallery.SCREEN, "homepods": homepods}).encode())
            return proc.returncode or 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--shots", type=Path, help="keep the screenshots here")
    ap.add_argument("--engine", choices=["webkit", "chromium", "both"], default="both")
    a = ap.parse_args()
    if not os.environ.get("PLAYWRIGHT_PATH") or not os.environ.get("NODE"):
        print("homepod_timers_check: skipped (set PLAYWRIGHT_PATH to playwright-core and NODE to node)")
        sys.exit(0)
    if a.shots:
        a.shots.mkdir(parents=True, exist_ok=True)
    sys.exit(asyncio.run(main(a.shots, ["webkit", "chromium"] if a.engine == "both" else [a.engine])))
