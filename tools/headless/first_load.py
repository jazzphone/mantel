#!/usr/bin/env python3
"""First-load numbers for Home, Settings and a screensaver screen, cold, on the gallery's fictional house (phase 24, Part P).

    python tools/headless/first_load.py [--runs 5] [--engine chromium --engine webkit] [--out FILE.json]

A split shell's parts arrive a round trip after the shell, so each split is held to "first draw within 50 ms of the
parent" (docs/phase24/CLEAN-CODE.md, gate 7). home_numbers.py measures a running server signed in with a measuring cookie;
this one starts its own (tools/headless/gallery.py's test server, commands off) so the parent and a change are measured the
same way on the same disk. Every load is in a fresh browser context with the cache off. Per page and engine it prints the
median of --runs loads of:

  draw_ms     Home and the saver screen: navigation start to web/home.js's `rendered` mark; Settings: to the panel
              being ready with its data (what settings_sweep.cjs waits for)
  parts_ms    navigation start to every split shell that started having run its parts (`__hkSplitDone`)
  requests    requests the page made until then

Needs PLAYWRIGHT_PATH and NODE.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
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


async def run(runs: int, engines: list[str]) -> dict:
    import gallery
    from aiohttp.test_utils import TestServer
    with tempfile.TemporaryDirectory(prefix="mantel-first-load-") as td:
        app, cookie = await gallery.build(Path(td), showcase=True, real_model=True)
        async with TestServer(app) as server:
            origin = str(server.make_url("")).rstrip("/")
            pages = {k: v.format(grid=gallery.GRID_SCREEN, screen=gallery.SCREEN) for k, v in PAGES.items()}
            spec = {"origin": origin, "cookie": cookie, "pages": pages, "runs": runs, "engines": engines}
            proc = await asyncio.create_subprocess_exec(os.environ.get("NODE", "node"), str(Path(__file__).with_suffix(".cjs")),
                                                        stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                                                        env=os.environ)
            out, _ = await proc.communicate(json.dumps(spec).encode())
            if proc.returncode:
                raise SystemExit(f"first_load.cjs failed ({proc.returncode})")
            return json.loads(out.decode().strip().splitlines()[-1])


def summary(raw: dict) -> dict:
    out: dict = {}
    for key, loads in raw.items():
        row = {}
        for k in ("draw_ms", "parts_ms", "requests"):
            vals = [x[k] for x in loads if x.get(k) is not None]
            row[k] = statistics.median(vals) if vals else None
            row[k + "_runs"] = vals
        row["errors"] = sorted({e for x in loads for e in x.get("errors", [])})[:10]
        out[key] = row
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--runs", type=int, default=5)
    ap.add_argument("--engine", action="append", choices=["chromium", "webkit"])
    ap.add_argument("--out", type=Path)
    a = ap.parse_args(argv)
    got = summary(asyncio.run(run(a.runs, a.engine or ["chromium", "webkit"])))
    for key, row in got.items():
        print(f"{key:24s} draw {row['draw_ms']!s:>7} ms  parts {row['parts_ms']!s:>7} ms  requests {row['requests']!s:>5}"
              f"   runs {row['draw_ms_runs']}" + (f"   errors {row['errors']}" if row["errors"] else ""))
    if a.out:
        a.out.write_text(json.dumps(got, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
