"""Swipe Between Pages in Chromium and WebKit, with a finger, on the fictional house (docs/phase11/HOMEVIEW-LOOK.md,
Phase 0).

Each engine at a tablet held sideways and upright and a phone upright and sideways (390 x 844, 844 x 390) --
Chromium's tablet the wall tablets' (Android WebView in Fully Kiosk, 1280 x 800, 800 x 1280), WebKit's an 11" iPad
(1180 x 820, 820 x 1180) -- against a real Mantel Server and gallery.py's invented house:

- **bar**: a screen with the tab bar (Swipe Between Pages Automatic). A sideways swipe on a tile goes to the next
  tab's page and back; the highlight is on the page's tab after each, at rest; the page it goes back to (Home, held
  by the view host) slides in as itself, not a stand-in. A swipe on the scenes row (it scrolls sideways) does not
  turn the page; an up-and-down swipe on a long page still scrolls it.
- **grid**: a Home Grid with two views and the tab bar: a swipe on a tile turns the views first, the next swipe goes
  on to the next page, and the swipe back lands on the last view. A swipe on a block that swipes its pages (rooms)
  and on a slider or the thermostat's ring does not turn the page.
- **rail**: the tab bar as a rail (tablets): the highlight follows it down the rail.
- **menu**: no tab bar, Swipe Between Pages On, Swipe from Left Edge on: a swipe from the left 24 px opens the side
  menu and turns no page; one from the middle goes to the menu's next page.
- **off**: Swipe Between Pages Off: a swipe turns nothing.
- **kitchen** (tablets held sideways): the Kitchen tablet's screen -- a Home Grid with the Side Pane on Home, the
  Pages screen, the Calendar, the Now Playing Bar on every page, the music playing. Swiped Home, Pages, Calendar:
  the bar comes up on the Calendar and the swipes go on under it; a swipe on the Calendar turns the page, not its
  month, even with the finger's own element drawn away mid-swipe; back on the Calendar the bar is up again; a quick
  short flick turns the page.

Chromium's finger is CDP's (Input.dispatchTouchEvent: the browser's own touch-action and scrolling); WebKit's is
pointer events with pointerType touch at the element under the point (Playwright has no touch drag in WebKit), and a
mouse for the side menu's edge. `--shots DIR` keeps the screenshots, mid-swipe and after.

    export PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=$(command -v node)
    ~/.venvs/mantel/bin/python tools/headless/page_swipe_check.py [--engine webkit] [--size 390x844] [--shots DIR]

Without PLAYWRIGHT_PATH or NODE (or Chrome, for Chromium) it says why and exits 0.
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
SIZES = ('1180x820', '820x1180', '1280x800', '800x1280', '390x844', '844x390')
# each engine's own devices (2026-11-01: Chromium had the iPad's tablet size, never the wall tablets')
ENGINE_SIZES = {'chromium': ('1280x800', '800x1280', '390x844', '844x390'),
                'webkit': ('1180x820', '820x1180', '390x844', '844x390')}
MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'


def missing(engines) -> str | None:
    if not os.environ.get('PLAYWRIGHT_PATH') or not os.environ.get('NODE'):
        return 'set PLAYWRIGHT_PATH (playwright-core) and NODE'
    if 'chromium' in engines and not (os.environ.get('CHROME') or Path(MAC_CHROME).exists()):
        return 'no Chrome (set CHROME)'
    return None


def house(gallery) -> None:
    """The fictional house's screens for the check (none of them is real)."""
    gallery.MOTION_PAGES = True
    b = gallery.SETTINGS['boards']
    home = b[gallery.SCREEN]
    home['favorites'] = ['light.living_room_lamps', 'lock.front_door', 'light.kitchen_pendants', 'cover.garage_door']
    # scenes enough that the row scrolls sideways at every size
    for i in range(1, 9):
        gallery.HOUSE[f'scene.evening_{i}'] = (None, ('unknown', {'friendly_name': f'Evening {i}'}))
    base = {'pages': [], 'headers': {'home': True}, 'menu_custom': True}
    b['ps-bar'] = {**home, **base, 'menu': 'tabbar', 'menu_phone': 'tabbar'}
    b['ps-rail'] = {**b['ps-bar'], 'tab_bar_pos': 'left'}
    b['ps-off'] = {**b['ps-bar'], 'swipe_pages': 'off'}
    # two tabs, the rest of the pages under More, and Swipe Right on Home on Security (2026-11-06)
    b['ps-more'] = {**b['ps-bar'], 'tab_bar_tabs': 2, 'tab_bar_tabs_rail': 2, 'tab_bar_tabs_phone': 2, 'swipe_left': 'security'}
    b['ps-menu'] = {**home, **base, 'menu': 'auto', 'menu_phone': 'button', 'swipe': True, 'swipe_pages': 'on'}
    wall = gallery.wall_display()
    grid = dict(wall['home_grid'])
    grid['views'] = 2
    grid['items'] = list(grid['items']) + [{'id': 'v2', 'card': 'action', 'size': 'S', 'at': [0, 0], 'view': 1,
                                            'opts': {'action': 'lights_off'}}]
    b['ps-grid'] = {**wall, **base, 'menu': 'tabbar', 'menu_phone': 'tabbar', 'home_grid': grid}
    # the Kitchen's shape (2026-11-02, the owner's video): a Home Grid with the Side Pane on Home only (its Now
    # Playing), the Pages screen, the Calendar, and the Now Playing Bar on every page -- the music playing
    gallery.HOUSE['calendar.family'] = (None, ('off', {'friendly_name': 'Family'}))
    for i in range(1, 7):
        gallery.HOUSE[f'camera.tv_{i}'] = (None, ('idle', {'friendly_name': f'Fictional Channel {i}'}))
        gallery.HOUSE[f'sensor.tv_{i}'] = (None, ('Fictional Programme', {'title': 'Fictional Programme', 'channel_name': f'Fictional Channel {i}'}))
    b['ps-kitchen'] = {**gallery.wall_display(), **base, 'menu': 'tabbar', 'menu_phone': 'tabbar',
                       'pages': ['calendar', 'live_tv', 'music'], 'pages_screen': {'show': 'on'},
                       'now_playing': True, 'bar_all_pages': True,
                       'side_pane': {'side': 'right', 'dashboard': {'show': 'home', 'sections': [
                           {'kind': 'clock'}, {'kind': 'calendar'}, {'kind': 'now_playing'}]}}}


async def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--engine', action='append', choices=ENGINES)
    ap.add_argument('--size', action='append', choices=SIZES)
    ap.add_argument('--shots', type=Path, help='keep the screenshots here')
    args = ap.parse_args(argv)
    engines = args.engine or list(ENGINES)
    why = missing(engines)
    if why:
        print(f'SKIPPED page_swipe_check: {why}')
        return 0
    import gallery
    from aiohttp.test_utils import TestServer
    house(gallery)
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    failed = 0
    for engine in engines:
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
                        'shots': str(args.shots or ''), 'chrome': os.environ.get('CHROME') or MAC_CHROME}).encode())
                    if proc.returncode != 0:
                        failed += 1
                        print(f'FAIL {engine} {size}')
    print('page_swipe_check: ' + ('FAILED' if failed else 'all passed'))
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
