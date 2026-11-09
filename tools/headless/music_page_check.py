"""THE MUSIC PAGE'S PLAYER (hk-music.js, Play Music) in a real browser, against the gallery's fictional house, playing.

The page's player is the controls strip every music player draws with since 2026-11-09 (web/hk/modules/hk-np-strip.js;
the owner: "more space in general above and below the play button", then "move the music page too"). At each size --
a landscape tablet, an upright one, a phone (whose player is a sheet over the page, opened from its mini player) -- the
strip keeps the touch rules, measured by hkNpStrip.check: every target 44 px, play / pause the biggest, no two
overlapping, 12 px clear between the progress and the keys and between the keys and the volume; the player bare and the
pause glyph's ink halfway between the bars (player_look.js); the column's margins even either side of it. The phone's
mini player: its play / pause and Speakers 44 px, play / pause the bigger, its cover's gap to the song its margin to the
edge. With --shots DIR, a screenshot of each (--shots-only: no assertions, for a tree before the strip).

    NODE=... PLAYWRIGHT_PATH=... python tools/headless/music_page_check.py [--engine webkit] [--shots DIR] [--size WxH]
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


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', choices=('chromium', 'webkit'), default='webkit')
    parser.add_argument('--shots', type=Path)
    parser.add_argument('--shots-only', action='store_true')
    parser.add_argument('--size', action='append', help='WxH; omit for all standard sizes')
    args = parser.parse_args()
    if not os.environ.get('PLAYWRIGHT_PATH') or not os.environ.get('NODE'):
        print('music_page_check: NODE and PLAYWRIGHT_PATH are required; skipped')
        return 0
    import gallery
    from aiohttp.test_utils import TestServer
    mp = gallery.HOUSE['media_player.living_room']
    gallery.HOUSE['media_player.living_room'] = (mp[0], (mp[1][0], dict(mp[1][1], entity_picture='/hk/landscapes/01.webp')))
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(os.environ['NODE'], str(Path(__file__).with_suffix('.cjs')),
                                                        stdin=asyncio.subprocess.PIPE)
            await proc.communicate(json.dumps({'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'screen': gallery.SCREEN,
                                               'engine': args.engine, 'shots': str(args.shots or ''), 'only': args.shots_only,
                                               'sizes': [list(map(int, s.split('x'))) for s in args.size] if args.size else None}).encode())
            return proc.returncode


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
