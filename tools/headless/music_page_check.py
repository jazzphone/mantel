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
    parser.add_argument('--players', action='store_true', help='Kitchen plays another song: Playing in the house, its rows and their own play / pause')
    parser.add_argument('--group', action='store_true', help='Living Room and Kitchen play together: All Speakers, and its drag keeping the balance')
    args = parser.parse_args()
    if not os.environ.get('PLAYWRIGHT_PATH') or not os.environ.get('NODE'):
        print('music_page_check: NODE and PLAYWRIGHT_PATH are required; skipped')
        return 0
    import gallery
    from aiohttp.test_utils import TestServer
    mp = gallery.HOUSE['media_player.living_room']
    gallery.HOUSE['media_player.living_room'] = (mp[0], (mp[1][0], dict(mp[1][1], entity_picture='/hk/landscapes/01.webp')))
    if args.players:
        # (2026-11-12: Playing in the house as Apple's player list -- a row per stream, its own play / pause)
        lr = gallery.HOUSE['media_player.living_room']
        gallery.HOUSE['media_player.kitchen'] = ('kitchen', ('playing', dict(lr[1][1], friendly_name='Kitchen', media_title='Paper Lanterns',
                                                                             media_artist='Another Fictional Band', volume_level=0.4)))
    if args.group:
        # (2026-11-12: the Speakers panel's rows are the rooms' volumes, All Speakers over them -- two rooms in one music)
        both = ['media_player.living_room', 'media_player.kitchen']
        lr, kt = gallery.HOUSE['media_player.living_room'], gallery.HOUSE['media_player.kitchen']
        gallery.HOUSE['media_player.living_room'] = (lr[0], (lr[1][0], dict(lr[1][1], group_members=both)))
        gallery.HOUSE['media_player.kitchen'] = (kt[0], ('playing', dict(lr[1][1], friendly_name='Kitchen', volume_level=0.6, group_members=both)))
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(os.environ['NODE'], str(Path(__file__).with_suffix('.cjs')),
                                                        stdin=asyncio.subprocess.PIPE)
            await proc.communicate(json.dumps({'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'screen': gallery.SCREEN,
                                               'engine': args.engine, 'shots': str(args.shots or ''), 'only': args.shots_only, 'group': args.group, 'players': args.players,
                                               'sizes': [list(map(int, s.split('x'))) for s in args.size] if args.size else None}).encode())
            return proc.returncode


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
