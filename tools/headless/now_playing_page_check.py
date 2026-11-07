"""THE NOW PLAYING PAGE (2026-11-07, the owner: "swipe right on the main dashboard screen to ... the interactive music
slide page for a full screen music player"; docs/mockups/now-playing-page.html) in a real browser, against the
gallery's fictional house: the screensaver's music slide as a page (hk-now-playing-page-card, hk-saver-pane.js).

At each size: the page as tall as the screen leaves it, nothing past its foot; the song and its buttons under the
corner (the time, the date and the weather; the home's status at the right); the player bare, the pause glyph's ink
halfway between the progress bar and the volume (player_look.js). Beside a Side Pane on a landscape tablet: the cover
and the song side by side, Up Next listed beside the cover. On Home with Swipe Right on Home set to Now Playing: the
page is the swipe's first, before Home, and a swipe right lands on it. With --shots DIR, a screenshot of each.

    NODE=... PLAYWRIGHT_PATH=... python tools/headless/now_playing_page_check.py [--engine webkit] [--shots DIR] [--size WxH]
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', choices=('chromium', 'webkit'), default='webkit')
    parser.add_argument('--shots', type=Path)
    parser.add_argument('--size', action='append', help='WxH; omit for all standard sizes')
    args = parser.parse_args()
    if not os.environ.get('PLAYWRIGHT_PATH') or not os.environ.get('NODE'):
        print('now_playing_page_check: NODE and PLAYWRIGHT_PATH are required; skipped')
        return 0
    import gallery
    from aiohttp.test_utils import TestServer
    from client_smoke import OfflineReads
    original_read = OfflineReads.request

    gallery.SETTINGS['boards']['np-full'] = {'title': 'Now Playing Check', 'pages': [], 'swipe_left': 'now-playing', 'menu_custom': True, 'menu': 'tabbar',
                                             'side_pane': {'dashboard': {'show': 'off', 'sections': []}}}
    gallery.SETTINGS['boards']['np-pane'] = {'title': 'Now Playing Check', 'pages': [], 'swipe_left': 'now-playing', 'menu_custom': True, 'menu': 'tabbar',
                                             'side_pane': {'side': 'right', 'width': 'standard', 'dashboard': {
                                                 'show': 'all', 'sections': [{'kind': 'clock', 'size': 'less'},
                                                                             {'kind': 'weather', 'size': 'less'}]}}}
    mp = gallery.HOUSE['media_player.living_room']
    gallery.HOUSE['media_player.living_room'] = (mp[0], (mp[1][0], dict(mp[1][1], entity_picture='/hk/landscapes/01.webp')))

    async def queue(self, msg):
        if msg['type'] != 'hk_music/queue':
            return await original_read(self, msg)
        return {'ok': True, 'items': [{'id': str(i), 'title': f'Upcoming Song {i}', 'artist': 'The Fictional Trio',
                                       'duration': 180} for i in range(msg.get('limit', 40))]}

    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td, patch.object(OfflineReads, 'request', queue):
        app, cookie = await gallery.build(Path(td))
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(os.environ['NODE'], str(Path(__file__).with_suffix('.cjs')),
                                                        stdin=asyncio.subprocess.PIPE)
            await proc.communicate(json.dumps({'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie,
                                               'engine': args.engine, 'python': sys.executable, 'shots': str(args.shots or ''),
                                               'sizes': [list(map(int, s.split('x'))) for s in args.size] if args.size else None}).encode())
            return proc.returncode


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
