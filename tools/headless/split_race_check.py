#!/usr/bin/env python3
"""The no-wait check (phase 24, A2: docs/phase24/CLEAN-CODE.md, gate 6): a page that uses a file cut into parts before
its parts have run.

    python tools/headless/split_race_check.py [--engine chromium --engine webkit] [--delay 300] [--no-ready]

Every other browser check waits for `__hkSplitDone` before it looks, which would hide this race. This one loads Home Grid,
Home, Settings and a screensaver preview on the gallery's fictional house, each twice per engine: once as it is, and once
with every part file (each split shell's folder, and the detail sheets) held back --delay ms by a request hook. It waits for
the page's first draw (web/home.js's `rendered`, the Settings panel ready, `window.hkSaver`) and for every shell that
started to have run its parts, then looks.

The delayed load passes when it has no page error or console error that the load as it is didn't have (so a page's own
noise, a 404 of a missing picture, is not counted) and every hk-* element in its DOM that is defined in the load as it is
is defined in it too. --no-ready is the control:
the loaders' readiness promises are thrown away (window.__hkSplitReady can't be written), so nothing waits for parts; once a
file a page reads at load is a shell, that control must fail.

Needs PLAYWRIGHT_PATH and NODE.
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
sys.path[:0] = [str(ROOT / x) for x in ("tools/headless", "tools", "hosts/server", "tests")]

PAGES = {
    "home-grid": "/{grid}/home",
    "home": "/{screen}/home",
    "settings": "/settings#/overview",
    "saver": "/{screen}/home?hk_preview=saver",
}


def part_folders() -> list[str]:
    out = {"sheets"}                                       # hk-detail.js's sheets (cut by hand)
    for m in sorted((ROOT / "tools/split_manifests").glob("*.json")):
        out.add(Path(json.loads(m.read_text())["folder"]).name)
    return sorted(out)


async def run(engines: list[str], delay: int, no_ready: bool) -> dict:
    import gallery
    from aiohttp.test_utils import TestServer
    with tempfile.TemporaryDirectory(prefix="mantel-split-race-") as td:
        app, cookie = await gallery.build(Path(td), showcase=True, real_model=True)
        async with TestServer(app) as server:
            origin = str(server.make_url("")).rstrip("/")
            pages = {k: v.format(grid=gallery.GRID_SCREEN, screen=gallery.SCREEN) for k, v in PAGES.items()}
            spec = {"origin": origin, "cookie": cookie, "pages": pages, "engines": engines, "delay": delay,
                    "folders": part_folders(), "noReady": no_ready}
            proc = await asyncio.create_subprocess_exec(os.environ.get("NODE", "node"), str(Path(__file__).with_suffix(".cjs")),
                                                        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                                                        env=os.environ)
            out, _ = await proc.communicate(json.dumps(spec).encode())
            if proc.returncode:
                raise SystemExit(f"split_race_check.cjs failed ({proc.returncode})")
            return json.loads(out.decode().strip().splitlines()[-1])


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--engine", action="append", choices=["chromium", "webkit"])
    ap.add_argument("--delay", type=int, default=300)
    ap.add_argument("--no-ready", action="store_true", help="the control: nothing waits for the parts")
    a = ap.parse_args(argv)
    got = asyncio.run(run(a.engine or ["chromium", "webkit"], a.delay, a.no_ready))
    bad = 0
    for key, r in got.items():
        new = sorted(set(r["delayed"]["errors"]) - set(r["plain"]["errors"]))
        undefined = sorted(set(r["delayed"]["undefined"]) - set(r["plain"]["undefined"]))   # (hk-view-container is never one)
        ok = not new and not undefined and r["delayed"]["drawn"]
        bad += not ok
        print(f"{'ok  ' if ok else 'FAIL'} {key:22s} parts held back {a.delay} ms: drawn {r['delayed']['drawn']}, "
              f"{len(new)} new errors, {len(undefined)} undefined elements; shells {r['delayed']['shells']}")
        for e in new[:8]:
            print("       error:", e)
        for t in undefined[:8]:
            print("       not defined:", t)
    print(f"split_race_check{' (control: --no-ready)' if a.no_ready else ''}: {len(got) - bad} of {len(got)} pages pass")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
