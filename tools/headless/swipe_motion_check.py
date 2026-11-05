"""How a full-page swipe MOVES, frame by frame, in Chromium and WebKit, on the fictional house (docs/development/Motion.md).

page_swipe_check.py says where a swipe ends. This one watches it on the way: at each animation frame where the page is
against the finger, what the page coming in shows (its pixels, not its route), how it goes on when the finger lifts, and
what a new finger, a cancel, a resize or a hidden window do to a swipe already under way. Every failure it looks for was
reproduced on the build before this check was written: a settle interrupted left the page off screen for five seconds,
rapid flicks left it there for good, a page not yet visited came in as a title on the sky.

Chromium's finger is CDP's (Input.dispatchTouchEvent: real touch input, the browser's touch-action and hit testing).
WebKit's is pointer events with pointerType touch, dispatched at the element under the point: the same code paths in
Mantel, none of the browser's own touch handling, and no statement about a real iPad. Times are not asserted (a loaded
machine stretches them); positions, the order of things and the state left behind are.

    export PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=$(command -v node)
    ~/.venvs/mantel/bin/python tools/headless/swipe_motion_check.py [--engine webkit] [--size 390x844] [--only NAME] [--shots DIR]

Without PLAYWRIGHT_PATH or NODE it says so and exits 2: a check that did not run has checked nothing.
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
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]

ENGINE_SIZES = {'chromium': ('1280x800', '390x844'), 'webkit': ('1180x820', '390x844')}


async def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--engine', action='append', choices=tuple(ENGINE_SIZES))
    ap.add_argument('--size', action='append')
    ap.add_argument('--only', help='comma-separated sections')
    ap.add_argument('--shots', type=Path, help='keep mid-swipe screenshots here')
    args = ap.parse_args(argv)
    if not os.environ.get('PLAYWRIGHT_PATH') or not os.environ.get('NODE'):
        print('NOT RUN swipe_motion_check: set PLAYWRIGHT_PATH (playwright-core) and NODE')
        return 2
    import gallery
    import page_swipe_check
    from aiohttp.test_utils import TestServer
    page_swipe_check.house(gallery)
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    failed = 0
    for engine in args.engine or list(ENGINE_SIZES):
        for size in args.size or ENGINE_SIZES[engine]:
            with tempfile.TemporaryDirectory() as td:
                app, cookie = await gallery.build(Path(td))
                from mantel_server.settings_store import load_model
                app['settings'].model = load_model()
                async with TestServer(app) as server:
                    proc = await asyncio.create_subprocess_exec(
                        os.environ['NODE'], str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE)
                    await proc.communicate(json.dumps({
                        'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'engine': engine, 'size': size,
                        'only': args.only or '', 'shots': str(args.shots or '')}).encode())
                    if proc.returncode != 0:
                        failed += 1
                        print(f'FAIL {engine} {size}')
    print('swipe_motion_check: ' + ('FAILED' if failed else 'all passed'))
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
