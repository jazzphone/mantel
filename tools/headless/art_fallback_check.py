"""NEVER THE BROKEN-IMAGE "?" in WebKit (2026-10-31, the owner's item 46: the Now Playing block's cover and Who's Home's
faces drew the "?"), against the gallery's fictional house.

A screen with Now Playing, Music and Who's Home blocks on a Home Grid and a Side Pane (Now Playing and Who's Home in
it), and the Pages screen (its person's face): every picture address the house hands out is stood in for (/__art/...:
the test's own routes) and the page fails when any VISIBLE <img>, in any shadow tree, has no picture
(naturalWidth === 0). Three scenarios:

    bad              every cover and face answers 404
    unavailable      the same, and the speaker is `unavailable` with no picture (Music Assistant away): its block
                     draws its own note, no <img> at all
    good-then-bad    the pictures load once; then the next version of each is refused: the last good one is shown

At an iPad's size (1180 x 820), upright (820 x 1180) and a phone's (390 x 844); --shots DIR keeps a screenshot each.

    PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=/opt/homebrew/bin/node \\
        ~/.venvs/mantel/bin/python tools/headless/art_fallback_check.py [--shots DIR] [--scenario NAME ...]

Without PLAYWRIGHT_PATH or NODE it says "skipped" (that is not a pass).
"""
import argparse
import asyncio
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / x) for x in ('tools/headless', 'tools', 'hosts/server', 'tests')]
SCENARIOS = ['bad', 'unavailable', 'good-then-bad']
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--engine', choices=['chromium', 'webkit'], default='webkit')
parser.add_argument('--node', default=os.environ.get('NODE') or shutil.which('node'))
parser.add_argument('--shots', type=Path)
parser.add_argument('--scenario', nargs='*', choices=SCENARIOS, default=SCENARIOS)
parser.add_argument('--size', action='append', help='WxH (default: 1180x820, 820x1180, 390x844)')
args = parser.parse_args()
if not args.node or not os.environ.get('PLAYWRIGHT_PATH'):
    print('art_fallback_check: skipped (needs NODE and PLAYWRIGHT_PATH)')
    raise SystemExit(0)

import gallery  # noqa: E402

# a 6 x 4 Home Grid: Now Playing at four sizes, Music at two, Who's Home at both of its
GRID = {'v': 1, 'cols': 6, 'rows': 4, 'frame': [1280, 800], 'band': True, 'items': [
    {'id': 'n1', 'card': 'now_playing', 'size': 'L', 'at': [0, 0], 'opts': {'speaker': 'media_player.living_room'}},
    {'id': 'm1', 'card': 'music', 'size': 'XL', 'at': [2, 0]},
    {'id': 'n2', 'card': 'now_playing', 'size': 'T', 'at': [5, 0], 'opts': {'speaker': 'media_player.living_room'}},
    {'id': 'n3', 'card': 'now_playing', 'size': 'W', 'at': [0, 2], 'opts': {'speaker': 'media_player.living_room'}},
    {'id': 'p1', 'card': 'people', 'size': 'W', 'at': [2, 2]},
    {'id': 'p2', 'card': 'people', 'size': 'S', 'at': [4, 2]},
    {'id': 'm2', 'card': 'music', 'size': 'W', 'at': [2, 3]},
    {'id': 'n4', 'card': 'now_playing', 'size': 'S', 'at': [0, 3], 'opts': {'speaker': 'media_player.living_room'}}]}
PANE = {'side': 'right', 'dashboard': {'show': 'home', 'sections': [
    {'kind': 'now_playing', 'size': 'more'}, {'kind': 'people', 'size': 'more'}, {'kind': 'now_playing', 'size': 'less', 'place': 'bottom'}]}}
SCREENS = {
    'art-grid': {'title': 'Art', 'pages': [], 'headers': {'home': True}, 'menu_custom': True, 'menu': 'tabbar', 'side_pane': PANE,
                 'home_style': 'grid', 'home_grid': GRID},
    'art-pages': {'title': 'Pages', 'pages': [], 'headers': {'home': True}, 'menu': 'tabbar', 'menu_phone': 'tabbar'},
}


async def run(scenario):
    from aiohttp.test_utils import TestServer
    gallery.SETTINGS['boards'].update(json.loads(json.dumps(SCREENS)))
    gallery.SETTINGS['settings']['pages_screen'] = {'show': 'on'}
    mp = gallery.HOUSE['media_player.living_room']
    if scenario == 'unavailable':
        gallery.HOUSE['media_player.living_room'] = (mp[0], ('unavailable', {'friendly_name': 'Living Room'}))
    else:
        gallery.HOUSE['media_player.living_room'] = (mp[0], (mp[1][0], dict(mp[1][1], entity_picture_local='/__art/cover.png',
                                                                           entity_picture='http://music.invalid:8095/cover.png')))
    for who, pic in (('sam', '/__art/sam.png'), ('alex', '/__art/alex.png')):
        p = gallery.HOUSE['person.' + who]
        gallery.HOUSE['person.' + who] = (p[0], (p[1][0], dict(p[1][1], entity_picture=pic)))
    sizes = [tuple(int(n) for n in s.split('x')) for s in (args.size or ['1180x820', '820x1180', '390x844'])]
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        # the signed-in person's own face (the Pages screen's corner reads the person whose user is this one)
        # (the page's user id is the link's Home Assistant user, "gallery-owner" in the gallery)
        app['hub'].store.apply_event({'a': {'person.sam': {'s': 'home', 'lc': gallery.NOW, 'lu': gallery.NOW, 'a': {
            'friendly_name': 'Sam', 'user_id': 'gallery-owner', 'entity_picture': '/__art/sam.png'}}}})
        async with TestServer(app) as server:
            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
            views = [{'screen': 'art-grid', 'view': 'home', 'expectFallback': scenario == 'bad', 'expectNone': scenario == 'unavailable'},
                     {'screen': 'art-pages', 'view': 'pages', 'expectFallback': False}]
            proc = await asyncio.create_subprocess_exec(
                args.node, str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=os.environ)
            out, err = await proc.communicate(json.dumps({
                'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'engine': args.engine, 'scenario': scenario,
                'art': 'good-then-bad' if scenario == 'good-then-bad' else 'bad', 'views': views,
                'shots': str(args.shots) if args.shots else None, 'sizes': sizes}).encode())
            print(out.decode())
            if err.strip():
                print(err.decode(), file=sys.stderr)
            return proc.returncode


async def main():
    worst = 0
    for s in args.scenario:
        worst = worst or await run(s)
    return worst


raise SystemExit(asyncio.run(main()))
