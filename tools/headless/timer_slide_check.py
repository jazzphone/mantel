"""THE TIMER SLIDE, placed, in WebKit and Chromium (phase 21, docs/phase21/TIMER-SLIDE.md).

The slide alone (web/hk/modules/hk-saver-timers.js and hk-timers.js) on a page of its own (timer_slide_harness.html), a
stand-in slide corner beside it -- the screensaver's own corner, turns and preview are saver_shows_check.py's. At each of
the five sizes, one timer, several, more than fit, hours, the last minute and long names:

  * every word and ring on the screen, the corner on none of them, each number inside its ring
  * the small rings' count, the +N, the last minute's look and the last ten seconds' red
  * a House Timer never shows
  * nothing asks for an animation frame while it holds still, and nothing ticks once it has left

    PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=node python tools/headless/timer_slide_check.py
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
        if p == "/timer_slide_harness.html":
            return str(ROOT / "tools/headless/timer_slide_harness.html")
        return str(ROOT / "web" / p.lstrip("/"))

    def log_message(self, *a):
        pass


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--node", default=os.environ.get("NODE") or shutil.which("node"))
    ap.add_argument("--shots", type=Path)
    ap.add_argument("--engine", default="both", choices=("webkit", "chromium", "both"))
    ap.add_argument("--size", choices=tuple(SIZES), help="one size only")
    a = ap.parse_args()
    if not a.node or not os.environ.get("PLAYWRIGHT_PATH"):
        print("timer_slide_check: skipped (needs NODE and PLAYWRIGHT_PATH)")
        return 0
    if a.shots:
        a.shots.mkdir(parents=True, exist_ok=True)
    srv = Server(("127.0.0.1", 0), functools.partial(Handler, directory=str(ROOT / "web")))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        sizes = [[k, *SIZES[k]] for k in ([a.size] if a.size else SIZES)]
        inp = {"origin": f"http://127.0.0.1:{srv.server_address[1]}", "engines": ["webkit", "chromium"] if a.engine == "both" else [a.engine],
               "shots": str(a.shots) if a.shots else None, "sizes": sizes}
        r = subprocess.run([a.node, str(ROOT / "tools/headless/timer_slide_check.cjs")], input=json.dumps(inp), text=True, timeout=1500)
        return r.returncode
    finally:
        srv.shutdown()


if __name__ == "__main__":
    sys.exit(main())
