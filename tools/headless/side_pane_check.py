"""THE SIDE PANE in a real browser (docs/phase11/HOMEVIEW-LOOK.md "Phase A2"), against the gallery's fictional house.

Screens with a Side Pane: beside a 3 x 3 Home Grid on the right and on the left, on Every Page of a generated
screen, eight sections together, in the screensaver (its own sections, on each side), each section alone at each
of its four sizes, the music playing; and the same screen held upright (a band under the page) and on a phone (no
pane). It checks the pane is where it should be, never scrolls, narrows the page, and that no page error happens;
with --shots DIR it keeps a screenshot of each. No connection to a real home; any other request is refused.

    PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core python tools/headless/side_pane_check.py --engine webkit --shots DIR

Without PLAYWRIGHT_PATH or Node it says why and exits 0.
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
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--engine', choices=['chromium', 'webkit'], default='webkit')
parser.add_argument('--node', default=os.environ.get('NODE') or shutil.which('node'))
parser.add_argument('--shots', type=Path)
parser.add_argument('--size', action='append', help='WxH (default: 1180x820, 820x1180, 390x844)')
args = parser.parse_args()
if not args.node or not os.environ.get('PLAYWRIGHT_PATH'):
    print('side_pane_check: skipped (needs NODE and PLAYWRIGHT_PATH)')
    raise SystemExit(0)

import gallery  # noqa: E402

DASH = [{'kind': 'weather'}, {'kind': 'calendar'}, {'kind': 'now_playing', 'when': 'active'}]
EIGHT = [{'kind': k} for k in ('clock', 'weather', 'calendar', 'now_playing', 'security', 'timers', 'climate', 'people')]
SAVER = [{'kind': 'clock', 'size': 'tiny'}, {'kind': 'weather', 'size': 'less'}, {'kind': 'security', 'size': 'less'},
         {'kind': 'now_playing', 'size': 'less', 'when': 'active'}]
# a 3 x 3 Home Grid that fills the height (the Home with Pane starter's shape; this phase does not add the starter)
GRID = {'v': 1, 'cols': 3, 'rows': 3, 'frame': [800, 800], 'band': False, 'grow': True, 'items': [
    {'id': 'p1', 'card': 'thermostat', 'size': 'T', 'at': [0, 0]},
    {'id': 'p2', 'card': 'now_playing', 'size': 'L', 'at': [1, 0]},
    {'id': 'p3', 'card': 'security', 'size': 'S', 'at': [1, 2]},
    {'id': 'p4', 'card': 'action', 'size': 'S', 'at': [2, 2], 'opts': {'action': 'lights_off'}},
    {'id': 'p5', 'card': 'timers', 'size': 'S', 'at': [0, 2]}]}


def screen(pane, grid=False, **extra):
    b = {'title': 'Side Pane', 'pages': [], 'headers': {'home': True}, 'menu_custom': True, 'menu': 'tabbar', 'side_pane': pane}
    if grid:
        b.update(home_style='grid', home_grid=GRID)
    b.update(extra)
    return b


SCREENS = {
    'pane-home-right': screen({'side': 'right', 'dashboard': {'show': 'home', 'sections': DASH}}, grid=True),
    'pane-home-left': screen({'side': 'left', 'dashboard': {'show': 'home', 'sections': DASH}}, grid=True),
    'pane-every-page': screen({'side': 'right', 'width': 'standard', 'dashboard': {'show': 'all', 'sections': DASH}}),
    'pane-eight': screen({'side': 'right', 'dashboard': {'show': 'home', 'sections': EIGHT}}, grid=True),
    'pane-saver-right': screen({'side': 'right', 'saver': {'show': 'own', 'sections': SAVER}}, screensaver=True),
    'pane-saver-left': screen({'side': 'left', 'saver': {'show': 'own', 'sections': SAVER}}, screensaver=True),
    'pane-none': screen(None),
}


async def main():
    from aiohttp.test_utils import TestServer
    gallery.SETTINGS['boards'].update(json.loads(json.dumps(SCREENS)))
    gallery.HOUSE['todo.groceries'] = (None, ('3', {'friendly_name': 'Groceries'}))
    gallery.HOUSE['sensor.house_power'] = (None, ('1400', {'unit_of_measurement': 'W', 'device_class': 'power'}))
    gallery.HOUSE['alarm_control_panel.home'] = (None, ('armed_home', {'friendly_name': 'Home Alarm', 'changed_by': 'Sam'}))
    gallery.SETTINGS['settings']['features'] = {'power': 'sensor.house_power'}
    gallery.SETTINGS['settings']['security'] = {'alarm': 'alarm_control_panel.home'}
    sizes = [tuple(int(n) for n in s.split('x')) for s in (args.size or ['1180x820', '820x1180', '390x844'])]
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        async with TestServer(app) as server:
            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
            proc = await asyncio.create_subprocess_exec(
                args.node, str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=os.environ)
            out, err = await proc.communicate(json.dumps({
                'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'engine': args.engine,
                'shots': str(args.shots) if args.shots else None, 'sizes': sizes}).encode())
            print(out.decode())
            if err.strip():
                print(err.decode(), file=sys.stderr)
            return proc.returncode


raise SystemExit(asyncio.run(main()))
