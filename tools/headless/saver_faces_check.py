"""The screensaver's HomeView-style faces (docs/phase11/HOMEVIEW-LOOK.md, Phase I) in WebKit, at a tablet held either
way (1180 x 820, 820 x 1180) and a phone (390 x 844): the Shows Glance, Month, Day (light and dark) and Big Weather
(hk-saverfaces.js), the clock faces Liquid, Giant Numerals and Scattered Numerals (hk-saverclock.js) full screen and
in each size of the Home Grid's Clock block, and a photo with Titles and Time Behind -- the photo, the time, then the
photo's subject masked over it, through hk-saver.js's own layers and CSS -- and one that doesn't qualify (the time in
front). The photo and its cut-out are GENERATED here (a drawn plant against a drawn sky) and judged by cutout.py's own
rules; no real photo, and no model.

Each face is drawn on a page of its own, the modules served from web/ on loopback (nothing else is reached); a face
must draw something inside its box, never throw, and never overflow the screen sideways. `--shots DIR` keeps the
screenshots, and the mock-up's faces section (the brief's bright-glass-home-grid.html, when it is there) beside them.

    export PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=$(command -v node)
    ~/.venvs/mantel/bin/python tools/headless/saver_faces_check.py [--shots DIR] [--mock PATH]

Without PLAYWRIGHT_PATH or NODE it says why and exits 0.
"""
import argparse
import asyncio
import io
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "hosts/server")]


def fixtures(dest: Path) -> dict:
    """A drawn photo (a plant in a pot against an evening sky), its cut-out as cutout.py stores it, and where the
    time goes by cutout.py's own rules."""
    import numpy as np
    from PIL import Image, ImageDraw
    from mantel_server import cutout
    W, H = 1500, 1000
    sky = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(sky)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=(int(233 - 90 * t), int(160 - 100 * t), int(140 - 90 * t)))
    mask = Image.new("L", (W, H), 0)

    def plant(dr, stem, leaf, pot):
        dr.rectangle([742, 420, 758, 1000], fill=stem)
        for cx, cy, rx, ry in ((750, 360, 120, 150), (640, 420, 110, 80), (860, 430, 110, 80), (700, 300, 70, 90), (800, 290, 70, 95)):
            dr.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=leaf)
        dr.polygon([(600, 1000), (630, 820), (870, 820), (900, 1000)], fill=pot)
    plant(d, (58, 42, 26), (47, 109, 58), (200, 100, 60))
    plant(ImageDraw.Draw(mask), 255, 255, 255)
    sky.save(dest / "photo.jpg", quality=88)
    got = cutout.result(mask, np)
    assert got["ok"], got
    (dest / "mask.png").write_bytes(got["mask"])
    Image.new("RGB", (W, H), (120, 150, 190)).save(dest / "plain.jpg", quality=80)
    return {"box": got["box"], "cover": got["cover"], "overlap": got["overlap"]}


async def main(shots, mock):
    from aiohttp import web
    with tempfile.TemporaryDirectory() as td:
        fx = Path(td)
        made = fixtures(fx)
        app = web.Application()
        app.router.add_static("/fx/", fx)
        app.router.add_static("/hk/", ROOT / "web/hk")
        app.router.add_static("/client/", ROOT / "web/client")

        async def page(_r):
            return web.Response(text="<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width'>"
                                     "<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}</style><body></body>",
                                content_type="text/html")
        app.router.add_get("/", page)
        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        try:
            proc = await asyncio.create_subprocess_exec(os.environ["NODE"], str(Path(__file__).with_suffix(".cjs")),
                                                        stdin=asyncio.subprocess.PIPE)
            await proc.communicate(json.dumps({"origin": f"http://127.0.0.1:{port}", "shots": str(shots) if shots else "",
                                               "mock": str(mock) if mock else "", "made": made}).encode())
            return proc.returncode
        finally:
            await runner.cleanup()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--shots", type=Path, help="keep the screenshots here")
    ap.add_argument("--mock", type=Path, help="the mock-up page (bright-glass-home-grid.html), to screenshot its faces beside")
    args = ap.parse_args()
    if not os.environ.get("PLAYWRIGHT_PATH") or not os.environ.get("NODE"):
        print("saver_faces_check: skipped -- set PLAYWRIGHT_PATH (playwright-core) and NODE")
        sys.exit(0)
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    sys.exit(asyncio.run(main(args.shots, args.mock)))
