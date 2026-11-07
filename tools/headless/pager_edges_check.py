"""A Home Grid block that swipes moves as a whole block, in WebKit (Safari's engine), on the fictional house.

The owner's video (2026-11-06, a paged Lock block in HomeView's Bright Glass): while the pages moved, the block's own
outline stayed put -- the pages were cut off at the block's edge, its shadow cast where they had been, and the
background showed through that frame between them. Now each page is a whole block, its corners, rim and shadow, cut
off only halfway into the gutter beside the block (hk-layout.js hk-pager-card, .win).

A finger (pointer events, pointerType touch) holds a Lock block's swipe partway, and the screen is compared with the
block at rest, in each look asked for: in the half of the gutter next to the block the page going out must be drawn
(the old clip at the block's edge left the background there); past the gutter's middle nothing may change (a page never
slides over the blocks beside it); no frame is drawn where the block was (no shadow of its own); and let go, it lands
on its next page with the clip gone. Headless WebKit draws no backdrop blur, so the glass looks are told apart by their
plates, not their frost: real frames of the frost are taken by hand (a headed window and screencapture, as
media_card_check.py --pixels does).

    export PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=$(command -v node)
    ~/.venvs/mantel/bin/python tools/headless/pager_edges_check.py [--look bright ...] [--size 1180x820 ...] [--shots DIR]

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

# Bright Glass (the owner's, HomeView's look) in its Shared Layer and Each Card modes, the Blur look, and Flat
LOOKS = ('bright', 'bright_each', 'blur', 'flat')
SIZES = ('1180x820', '390x844')
# a gutter column's mean change, 0-255 a channel: a page drawn there changes it by far more than NEAR (~25-60 measured);
# past the gutter's middle nothing may move (FAR): the block's own shadow, cut there as it starts to move, changes it by ~3
NEAR, FAR = 8.0, 6.0


def grid() -> dict:
    """HomeView's square cells: a lamp, the paged Lock block, a light beside it, and a paged Accessories block below."""
    lights = ['light.living_room_lamps', 'light.living_room_ceiling', 'light.kitchen_pendants', 'light.kitchen_cabinets']
    return {'v': 1, 'cols': 4, 'rows': 3, 'frame': [1180, 820], 'band': False, 'grow': True, 'cell': 'square', 'items': [
        {'id': 'lamp', 'card': 'accessory', 'size': 'S', 'at': [0, 0], 'opts': {'entity': 'light.living_room_lamps'}},
        {'id': 'lock', 'card': 'accessory', 'size': 'S', 'at': [1, 0], 'opts': {'entity': 'lock.front_door'},
         'pages': {'source': 'list', 'list': [{'opts': {'entity': 'lock.front_door'}}, {'opts': {'entity': 'lock.back_door'}}]}},
        {'id': 'light', 'card': 'accessory', 'size': 'S', 'at': [2, 0], 'opts': {'entity': 'light.kitchen_pendants'}},
        {'id': 'group', 'card': 'accessories', 'size': 'W', 'at': [0, 1], 'opts': {'accessories': [{'entity': e} for e in lights]},
         'pages': {'source': 'accessories'}}]}


def board(look: str) -> dict:
    out = {'home_style': 'grid', 'home_grid': grid(), 'menu_custom': True, 'menu': 'tabbar'}
    if look == 'flat':
        out['flat'] = True
    else:
        out.update(flat=False, glass=look)
        if look.startswith('bright'):
            out['bright_pages'] = 'all'
    return out


def column(img, x: int, y0: int, y1: int):
    """A column of RGB pixels, two wide (a screen pixel and its neighbor)."""
    return [img.getpixel((x + dx, y)) for dx in (0, 1) for y in range(y0, y1)]


def change(a, b) -> float:
    return sum(abs(p - q) for pa, pb in zip(a, b) for p, q in zip(pa, pb)) / (3 * len(a))


def judge(res: dict) -> list[tuple[bool, str, object]]:
    from PIL import Image
    rest, mid = Image.open(res['rest']).convert('RGB'), Image.open(res['mid']).convert('RGB')
    r, g = res['rect'], res['gap']
    # rows away from the corners and the dots: the middle half of the block
    y0, y1 = int(r['y'] + r['h'] * 0.25), int(r['y'] + r['h'] * 0.7)
    near = int(r['x'] - g * 0.25) - 1            # inside the gutter's half next to the block
    far = int(r['x'] - g * 0.5) - 3              # past its middle, toward the block beside it
    farR = int(r['x'] + r['w'] + g * 0.5) + 2    # ...and on the other side
    n = change(column(rest, near, y0, y1), column(mid, near, y0, y1))
    f = max(change(column(rest, far, y0, y1), column(mid, far, y0, y1)),
            change(column(rest, farR, y0, y1), column(mid, farR, y0, y1)))
    s = res['state']
    return [
        (n > NEAR, f'the page going out is drawn in the gutter beside the block (change {n:.1f} > {NEAR})', n),
        (f < FAR, f'nothing moves past the gutter\'s middle (change {f:.1f} < {FAR})', f),
        (s['frame'] == 'none', 'no frame drawn where the block was while it moves', s['frame']),
        (s['clip'] == 'clip' and s['rested'] == 'visible', 'cut off sideways while it moves, not at rest', s),
        (s['whole'], 'the page going out keeps the block\'s size and corners', s),
        (s['landed'], 'let go, it lands on its next page, in line with the block', s),
    ]


async def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--look', action='append', choices=LOOKS)
    ap.add_argument('--size', action='append')
    ap.add_argument('--shots', type=Path, help='keep the screenshots here')
    args = ap.parse_args(argv)
    if not os.environ.get('PLAYWRIGHT_PATH') or not os.environ.get('NODE'):
        print('NOT RUN pager_edges_check: set PLAYWRIGHT_PATH (playwright-core) and NODE')
        return 2
    import gallery
    from aiohttp.test_utils import TestServer
    looks, sizes = args.look or list(LOOKS), args.size or list(SIZES)
    screens = []
    for look in looks:
        name = 'pager-edges-' + look.replace('_', '-')
        gallery.SETTINGS['boards'][name] = board(look)
        screens.append({'screen': name, 'look': look})
    # HomeView's wallpaper, still: a plate over it shows, and nothing moves under the comparison
    gallery.SETTINGS['settings']['sky'] = {'background': 'wallpaper', 'wallpaper': 'ribbons_rose', 'wallpaper_night': 'auto',
                                           'wallpaper_motion': 'off'}
    fails = 0
    with tempfile.TemporaryDirectory() as td, tempfile.TemporaryDirectory() as shots:
        out = args.shots or Path(shots)
        out.mkdir(parents=True, exist_ok=True)
        app, cookie = await gallery.build(Path(td))
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(
                os.environ['NODE'], str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE)
            got, _ = await proc.communicate(json.dumps({
                'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'screens': screens, 'sizes': sizes,
                'out': str(out)}).encode())
            if proc.returncode != 0:
                fails += 1
                print('FAIL pager_edges_check: the browser half ended with ' + str(proc.returncode))
        seen = 0
        for line in got.decode().splitlines():
            if not line.startswith('{'):
                print(line)
                continue
            res = json.loads(line)
            seen += 1
            for ok, what, val in judge(res):
                fails += not ok
                print(('PASS ' if ok else 'FAIL ') + f"{res['look']} {res['size']} {what}" + ('' if ok else f'  got {val}'))
        if seen != len(looks) * len(sizes):
            fails += 1
            print(f'FAIL pager_edges_check: {seen} of {len(looks) * len(sizes)} looks and sizes reported')
    print('pager_edges_check: ' + ('FAILED' if fails else 'all passed'))
    return 1 if fails else 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
