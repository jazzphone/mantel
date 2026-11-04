"""The Intercom's block and sheet in WebKit (Safari's engine) with a finger, on a fictional house: a real Mantel Server
(gallery.py's), the page's own cards, and a made-up feed and microphone (intercom_fakes.js) -- nothing is recorded,
played or sent anywhere.

    PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=/path/to/node \\
        python tools/headless/intercom_check.py [--shots DIRECTORY] [--size NAME ...]

At an iPad's two ways up, a phone's two ways up and a wall tablet's size (intercom_check.cjs says each step):
  block    the Intercom block, Small and Wide, shows the rooms last picked; a touch on it opens the sheet
  picker   floors, presets and Whole House as chips (presets dashed); every room a pill with its glyph; a skipped pill
           says why in one line and is not picked; every touch target at least 44 pt; nothing past the sheet's edge
  message  tap to record (Connecting, Recording, the level and the time left), tap to stop, then Play, Re-record, Cancel
           and Send -- Send says Sending and then Sent to 2 rooms; a pointercancel on the microphone starts nothing
  words    Needs HTTPS on a plain page; Live drawn only when the feed allows it (a hold records, a release ends it)
  costs    a page without the block loads neither hk-intercom.js nor hk-mic.js and never asks the feed; `#intercom` on its
           address then brings both in and opens the sheet (the app's menu button); a wall tablet that listens: hkIntercom.listen()
No page errors and no console errors. With --shots a screenshot of each state (SIZE-STATE.png) goes to the directory;
the default is the build session's scratchpad. Skips (exit 0, saying why) without PLAYWRIGHT_PATH or NODE.
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

SCREEN = 'dashboard-intercom'
# the iPad's and the phone's own devices (Playwright's), and a wall tablet's size
SIZES = {
    'ipad': {'device': 'iPad Pro 11'},
    'ipad-landscape': {'device': 'iPad Pro 11 landscape'},
    'phone': {'device': 'iPhone 13'},
    'phone-landscape': {'device': 'iPhone 13 landscape'},
    'wall': {'viewport': [1280, 800]},
}
GRID = {'v': 1, 'cols': 6, 'rows': 4, 'frame': [1280, 800], 'band': True, 'items': [
    {'id': 'ic-s', 'card': 'intercom', 'size': 'S', 'at': [0, 0]},
    {'id': 'ic-w', 'card': 'intercom', 'size': 'W', 'at': [1, 0]},
    {'id': 'lamp', 'card': 'accessory', 'size': 'S', 'at': [3, 0], 'opts': {'entity': 'light.living_room_lamps'}},
    {'id': 'lock', 'card': 'action', 'size': 'S', 'at': [4, 0], 'opts': {'action': 'lock_up'}},
    {'id': 'scene', 'card': 'scene', 'size': 'W', 'at': [0, 1], 'opts': {'scene': 'scene.movie_night'}},
    {'id': 'room', 'card': 'room', 'size': 'W', 'at': [2, 1], 'opts': {'area': 'living_room'}}]}
DEFAULT_SHOTS = Path('/private/tmp/claude-501/-Volumes-data-mantel--claude-worktrees-sweet-khayyam-01407a/'
                     '239b49fb-67ff-483f-ad43-d6b6cd8bdfac/scratchpad/shots')


def missing() -> str | None:
    pw, node = os.environ.get('PLAYWRIGHT_PATH'), os.environ.get('NODE')
    if not (pw and Path(pw).exists() and node and Path(node).exists()):
        return 'set PLAYWRIGHT_PATH and NODE (edit_mode_check.py\'s)'
    return None


async def main(args) -> int:
    why = missing()
    if why:
        print('SKIPPED the Intercom check:', why)
        return 0
    import gallery
    from aiohttp.test_utils import TestServer
    gallery.SETTINGS['boards'][SCREEN] = {'title': 'Intercom', 'pages': [], 'headers': {'home': True}, 'menu_custom': True, 'menu': 'tabbar',
                                          'home_style': 'grid', 'home_grid': GRID}
    gallery.HOUSE['media_player.living_room'] = ('living_room', ('idle', dict(gallery.HOUSE['media_player.living_room'][1][1])))
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        async with TestServer(app) as server:
            shots = args.shots or DEFAULT_SHOTS
            shots.mkdir(parents=True, exist_ok=True)
            names = args.size or list(SIZES)
            proc = await asyncio.create_subprocess_exec(
                os.environ['NODE'], str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE)
            out, _ = await proc.communicate(json.dumps({
                'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'screen': SCREEN, 'plain': gallery.SCREEN,
                'shots': str(shots),
                'fakes': (Path(__file__).parent / 'intercom_fakes.js').read_text(),
                'sizes': {n: SIZES[n] for n in names}}).encode())
    failed = []
    for line in out.decode().splitlines():
        print(line, flush=True)
        if line.startswith('FAIL'):
            failed.append(line)
    if proc.returncode or failed:
        print('FAIL: %d problem(s)' % (len(failed) or 1))
        return 1
    print('PASS: the Intercom block and sheet at %d sizes, with a finger' % len(names))
    return 0


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--shots', type=Path)
    ap.add_argument('--size', action='append', choices=list(SIZES))
    raise SystemExit(asyncio.run(main(ap.parse_args())))
