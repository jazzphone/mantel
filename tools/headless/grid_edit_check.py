"""Edit mode on a Home Grid (2026-10-31, hk-edit-grid.js) in WebKit, with a finger and with a mouse, at a tablet held
either way and a phone, on a fictional house (gallery.py's), against a real Mantel Server.

    PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=/path/to/node \\
        python tools/headless/grid_edit_check.py [--size 1180x820|820x1180|390x844 ...] [--shots DIRECTORY]

What it checks (grid_edit_check.cjs says each one), for the mouse and for a finger at each size:
  tiles    a 6 x 4 Home Grid with its band, under a tab bar: Edit This Page in the tab bar's More; every block with
           its cover, a minus and its size; a block carried to an empty cell (its outline red where it can't go),
           one carried onto another (which makes room), one made Wide from its size sheet, one removed, one added
           from Add; Done -- the screen's home_grid saved as arranged (valid, as hk_core checks it) and drawn the
           same after a reload
  square   a Square screen (3 x 3 square cells, no band), from an accessory's sheet (its gear, Edit This Page):
           a block carried, then Cancel -- the page as it was, nothing saved
  pane     a 3 x 3 Home Grid beside the Side Pane: the pane stays beside the grid while it is edited; a block
           carried, Escape while it is held puts it back; Done saves
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

SIZES = ('1180x820', '820x1180', '390x844')
INPUTS = ('mouse', 'finger')

TILES = {'v': 1, 'cols': 6, 'rows': 4, 'frame': [1280, 800], 'band': True, 'items': [
    {'id': 'clock', 'card': 'clock', 'size': 'L', 'at': [0, 0]},
    {'id': 'weather', 'card': 'weather', 'size': 'W', 'at': [2, 0]},
    {'id': 'cam', 'card': 'camera', 'size': 'L', 'at': [4, 0]},
    {'id': 'np', 'card': 'now_playing', 'size': 'W', 'at': [2, 1]},
    {'id': 'lock', 'card': 'action', 'size': 'S', 'at': [0, 2], 'opts': {'action': 'lock_up'}},
    {'id': 'timers', 'card': 'timers', 'size': 'S', 'at': [1, 2]},
    {'id': 'thermo', 'card': 'thermostat', 'size': 'T', 'at': [2, 2]}]}
SQUARE = {'v': 1, 'cols': 3, 'rows': 3, 'frame': [800, 800], 'band': False, 'grow': True, 'cell': 'square', 'screen': 'square',
          'items': [
              {'id': 'clock', 'card': 'clock', 'size': 'L', 'at': [0, 0]},
              {'id': 'lamps', 'card': 'accessory', 'size': 'S', 'at': [2, 0], 'opts': {'entity': 'light.living_room_lamps'}},
              {'id': 'thermo', 'card': 'thermostat', 'size': 'T', 'at': [2, 1]},
              {'id': 'lock', 'card': 'action', 'size': 'S', 'at': [0, 2], 'opts': {'action': 'lock_up'}}]}
PANE_GRID = {'v': 1, 'cols': 3, 'rows': 3, 'frame': [800, 800], 'band': False, 'grow': True, 'items': [
    {'id': 'p1', 'card': 'thermostat', 'size': 'T', 'at': [0, 0]},
    {'id': 'p2', 'card': 'now_playing', 'size': 'L', 'at': [1, 0]},
    {'id': 'p3', 'card': 'security', 'size': 'S', 'at': [1, 2]},
    {'id': 'p5', 'card': 'timers', 'size': 'S', 'at': [0, 2]}]}


def missing() -> str | None:
    """Why this check can't run here, or None."""
    pw, node = os.environ.get('PLAYWRIGHT_PATH'), os.environ.get('NODE')
    if not pw or not Path(pw).exists():
        return 'set PLAYWRIGHT_PATH to an installed playwright-core (its node_modules folder)'
    if not node or not Path(node).exists():
        return 'set NODE to a Node.js binary'
    return None


def house(gallery) -> None:
    """The fictional house's Home Grid screens for the check (none of them is real)."""
    b = gallery.SETTINGS['boards']
    base = {'pages': [], 'headers': {'home': True}, 'menu_custom': True, 'menu': 'tabbar', 'menu_phone': 'tabbar',
            'home_style': 'grid'}
    for i in INPUTS:
        b[f'ge-tiles-{i}'] = {**base, 'title': 'Den Wall', 'home_grid': json.loads(json.dumps(TILES))}
        b[f'ge-square-{i}'] = {**base, 'title': 'Kitchen Square', 'home_grid': json.loads(json.dumps(SQUARE))}
        b[f'ge-pane-{i}'] = {**base, 'title': 'Hall Pane', 'home_grid': json.loads(json.dumps(PANE_GRID)),
                             'side_pane': {'side': 'right', 'dashboard': {'show': 'home', 'sections': [
                                 {'kind': 'weather'}, {'kind': 'calendar'}, {'kind': 'timers'}]}}}


async def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--size', action='append', choices=SIZES)
    ap.add_argument('--shots', type=Path, help='where to write the screenshots')
    args = ap.parse_args(argv)
    why = missing()
    if why:
        print(f'SKIPPED grid_edit_check: {why}')
        return 0
    import gallery
    from aiohttp.test_utils import TestServer
    house(gallery)
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    failed = 0
    for size in args.size or SIZES:
        # a fresh house for each size: every run saves, and starts from the same layouts
        with tempfile.TemporaryDirectory() as td:
            app, cookie = await gallery.build(Path(td))
            from mantel_server.settings_store import load_model
            app['settings'].model = load_model()
            async with TestServer(app) as server:
                proc = await asyncio.create_subprocess_exec(
                    os.environ['NODE'], str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE)
                await proc.communicate(json.dumps({
                    'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'size': size,
                    'inputs': list(INPUTS), 'shots': str(args.shots or '')}).encode())
                if proc.returncode != 0:
                    failed += 1
                    print(f'FAIL webkit {size}')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
