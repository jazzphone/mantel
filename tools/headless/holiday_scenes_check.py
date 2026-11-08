"""THE HOLIDAY SLIDE'S SCENES, placed, in WebKit and Chromium (phase 20, docs/phase20/HOLIDAY-SLIDE.md "Tests").

The slide alone (web/hk/modules/hk-saver-holiday.js and its calendar, scenes and effects) on a page of its own
(holiday_harness.html), a stand-in slide corner beside it at Time Size 100 % and 250 % -- the screensaver's own corner,
turns and preview are saver_shows_check.py's. At each of the five sizes (the wall tablet 1280 x 800, beside the Side Pane
880 x 800, an iPad upright 820 x 1180, a phone 390 x 844 and on its side 844 x 390), each painted scene and the outdoor
version, a count, tomorrow, the day itself and a three-figure count:

  * every live word inside its piece (the TV's picture, the stone's face, the board's face, the flaps' opening)
  * the corner and the row meet none of the slide's words; no live word off the screen; the number clear of its words
  * the bigger window's glass clear of House Status
  * nothing floats: every floor-standing piece's feet at or above the scene's front edge
  * its effects run while it is up; Effects Off and Reduce Motion give one still picture with no animation frame left
  * after 20 turns the same layer and canvases, and once it has left no loop and no frame waiting
  * every scene's pieces load

    PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=node python tools/headless/holiday_scenes_check.py
        [--shots DIR] [--engine webkit|chromium|both] [--size wall|pane|ipad|phone|side]

Without PLAYWRIGHT_PATH or Node it says why and exits 0.
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SIZES = {"wall": (1280, 800), "pane": (880, 800), "ipad": (820, 1180), "phone": (390, 844), "side": (844, 390)}


class Handler(http.server.SimpleHTTPRequestHandler):
    """web/ as the site's root (/hk/... as the house serves it), and the harness page beside it."""

    def translate_path(self, path):
        p = path.split("?", 1)[0]
        if p == "/holiday_harness.html":
            return str(ROOT / "tools/headless/holiday_harness.html")
        return str(ROOT / "web" / p.lstrip("/"))

    def log_message(self, *a):
        pass


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--node", default=os.environ.get("NODE") or shutil.which("node"))
    ap.add_argument("--shots", type=Path)
    ap.add_argument("--engine", default="both", choices=("webkit", "chromium", "both"))
    ap.add_argument("--size", choices=tuple(SIZES), help="one size only")
    a = ap.parse_args()
    if not a.node or not os.environ.get("PLAYWRIGHT_PATH"):
        print("holiday_scenes_check: skipped (needs NODE and PLAYWRIGHT_PATH)")
        return 0
    if a.shots:
        a.shots.mkdir(parents=True, exist_ok=True)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(ROOT / "web")))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        sizes = [[k, *SIZES[k]] for k in ([a.size] if a.size else SIZES)]
        inp = {"origin": f"http://127.0.0.1:{srv.server_address[1]}", "engines": ["webkit", "chromium"] if a.engine == "both" else [a.engine],
               "shots": str(a.shots) if a.shots else None, "sizes": sizes}
        r = subprocess.run([a.node, str(ROOT / "tools/headless/holiday_scenes_check.cjs")], input=json.dumps(inp), text=True, timeout=1500)
        return r.returncode
    finally:
        srv.shutdown()


if __name__ == "__main__":
    sys.exit(main())
