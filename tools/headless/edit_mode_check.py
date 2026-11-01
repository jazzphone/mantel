"""Edit mode in a browser: Chromium with a finger and WebKit with a mouse, at a tablet's and a phone's size (the
tablet Chromium's an Android one's, 1280 x 800, WebKit's an 11" iPad's, 1180 x 820), on a fictional house
(gallery.py's), against a real Mantel Server.

    PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=/path/to/node \\
        python tools/headless/edit_mode_check.py [--engine chromium|webkit] [--size 1180x820|1280x800|390x844] \\
                                                 [--only SECTION ...] [--shots DIRECTORY]

What it checks (edit_mode_check.cjs says each one):
  who      Edit Page is in the menu and in the tab bar's More for an Owner (a Home Grid screen's Home too: its blocks,
           grid_edit_check.py), never for a Member or at a wall tablet
  room     a room page: a pill carried (a finger held ~300 ms, then moved; the mouse in WebKit), one made Tall,
           Done -- the room's Tile Order and the size saved, the page drawn again in the saved order; a quick
           swipe over the pills scrolls the page and lifts nothing
  pages    one move each on Lights, Security, Home's Favorites and Home's scenes row, saved
  menu     the side menu: a category moved, one hidden, the Room Order sheet's Move Up; a tab dropped on More --
           after Done and a reload the menu, the tab bar and More agree
  cancel   Cancel puts the page back as it was
  conflict the accessories or the screen changed on the server between Edit and Done: Reload / Save Anyway
  bar      the Edit bar beside a tab bar at the top, the bottom and on a rail: never over it, evenly spaced
           (screenshots with --shots)
  still    with Reduce Motion: no wiggle; every pill framed evenly round what it paints (a room's pill is wider
           than its element), a Tall one too; Cancel takes the frames away
  frost    on a Frosted screen (one shared blur cut to the pills' shapes): a carried pill blurs behind itself, out
           of the shared layer, on every move; after the drop every pill is on its cut-out again
No page errors and no console errors anywhere. Skips (exit 0, saying why) without PLAYWRIGHT_PATH or NODE.
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

ENGINES = ('chromium', 'webkit')
SIZES = ('1180x820', '1280x800', '390x844')
# each engine's own devices (2026-11-01: Chromium had the iPad's tablet size)
ENGINE_SIZES = {'chromium': ('1280x800', '390x844'), 'webkit': ('1180x820', '390x844')}
SECTIONS = ('who', 'room', 'pages', 'menu', 'cancel', 'conflict', 'bar', 'still', 'frost')
MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


def missing() -> str | None:
    """Why this check can't run here, or None."""
    pw, node = os.environ.get('PLAYWRIGHT_PATH'), os.environ.get('NODE')
    if not pw or not Path(pw).exists():
        return 'set PLAYWRIGHT_PATH to an installed playwright-core (its node_modules folder)'
    if not node or not Path(node).exists():
        return 'set NODE to a Node.js binary'
    if not (os.environ.get('CHROME') or Path(MAC_CHROME).exists()):
        return 'no Chrome for Playwright\'s Chromium (set CHROME)'
    return None


def house(gallery) -> None:
    """The fictional house's screens for the check (none of them is real)."""
    b = gallery.SETTINGS['boards']
    home = b[gallery.SCREEN]
    home['favorites'] = ['light.living_room_lamps', 'lock.front_door', 'light.kitchen_pendants', 'cover.garage_door']
    home['scenes_pages'] = ['security']
    # a second light in the Living Room's Lights group and a third in the Kitchen's: room pages to carry pills on
    gallery.HOUSE['light.kitchen_island'] = ('kitchen', gallery._light('Island', False))
    gallery.HOUSE['light.living_room_floor'] = ('living_room', gallery._light('Floor Lamp', False))
    # ...and a Living Room long enough to scroll at a tablet's size (a swipe over its pills scrolls it), the wall
    # tablets' wide 1280 x 800 too (twelve outlets left it 11 px taller than the window there)
    for i in range(1, 25):
        gallery.HOUSE[f'switch.living_room_outlet_{i}'] = ('living_room', ('off', {'friendly_name': f'Outlet {i}'}))
    base = {'pages': [], 'headers': {'home': True}, 'menu_custom': True}
    b['em-menu'] = {**base, 'menu': 'open'}
    b['em-tabs'] = {**base, 'menu': 'tabbar', 'menu_phone': 'tabbar'}
    b['em-top'] = {**base, 'menu': 'tabbar', 'menu_phone': 'tabbar', 'tab_bar_pos': 'top'}
    b['em-rail'] = {**base, 'menu': 'tabbar', 'menu_phone': 'tabbar', 'tab_bar_pos': 'left'}
    b['em-frost'] = {**home, 'glass': 'blur'}
    b['em-grid'] = {**base, 'menu': 'open', 'home_style': 'grid', 'home_grid': {
        'v': 1, 'cols': 6, 'rows': 4, 'frame': [1280, 800], 'band': False, 'items': [
            {'id': 'lamps', 'card': 'accessory', 'size': 'S', 'at': [0, 0], 'opts': {'entity': 'light.living_room_lamps'}}]}}


async def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--engine', action='append', choices=ENGINES)
    ap.add_argument('--size', action='append', choices=SIZES)
    ap.add_argument('--only', action='append', choices=SECTIONS)
    ap.add_argument('--shots', type=Path, help='where to write the screenshots (the Edit bar beside the tab bar)')
    args = ap.parse_args(argv)
    why = missing()
    if why:
        print(f'SKIPPED edit_mode_check: {why}')
        return 0
    import gallery
    from aiohttp.test_utils import TestServer
    house(gallery)
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    failed = 0
    for engine in args.engine or ENGINES:
        for size in args.size or ENGINE_SIZES[engine]:
            # a fresh house for each run: every run saves, and starts from the same layout
            with tempfile.TemporaryDirectory() as td:
                app, cookie = await gallery.build(Path(td))
                from mantel_server.settings_store import load_model
                app['settings'].model = load_model()
                store = app['store']
                store.link('gallery-member', 'adult', 'Jordan Lee')          # a Member: no `configure`
                member = store.create_session('gallery-member', 3600)
                # a wall tablet with the Owner signed in on top of it: still no Edit (hkShell.atTablet)
                _, device, _ = app['devices'].enroll('Loft Tablet', 'wall_tablet', 'office', None)
                async with TestServer(app) as server:
                    proc = await asyncio.create_subprocess_exec(
                        os.environ['NODE'], str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE)
                    await proc.communicate(json.dumps({
                        'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'member': member,
                        'device': device, 'screen': gallery.SCREEN, 'engine': engine, 'size': size,
                        'only': args.only or list(SECTIONS), 'shots': str(args.shots or ''),
                        'chrome': os.environ.get('CHROME') or MAC_CHROME}).encode())
                    if proc.returncode != 0:
                        failed += 1
                        print(f'FAIL {engine} {size}')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
