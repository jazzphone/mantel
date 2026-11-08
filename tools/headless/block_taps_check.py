"""Every block of the Home Grid opens something when it is tapped (2026-10-31, the owner's note on 0.1.94, item 29:
"ALL the blocks should do something if you tap on them" -- the Weather block did not open Weather), against the
fictional home, never a household's.

The catalog's every key at every size it has (home_grid_audit.py's screens: a 6 x 4 grid per key, the sizes placed
across it), tapped in WebKit (block_taps_check.cjs): a lattice of points over each block, those whose element and
every element above it is no control, one click each, and where it went read from the shell -- a page, an entity's
sheet, a detail sheet or the tab bar's More. A control inside a block (a light's toggle, a timer's ring, a
thermostat's arrows) keeps its own tap: it is not among the points. Prints the table (key, size, where a tap on the
plate goes) and, with `--expect`, fails when a block's empty plate does nothing -- but for the keys in NO_TAP, each
with its reason (tests/test_blocks_taps.js holds the same list for the jsc suite).

    python tools/headless/block_taps_check.py [--cell tile|square] [--homeview] [--size 1180x820] [--only KEY ...]
                                              [--expect] [--json FILE] [--shots DIR]

Skipped, saying so, without PLAYWRIGHT_PATH and NODE (edit_mode_check.py's).
"""
import argparse
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]
import gallery
import home_grid_audit as A
from aiohttp.test_utils import TestServer
from hk_core.settings import home_grid as HG

# KEYS WHOSE PLATE OPENS NOTHING, and why (the same list, key by key, as NO_TAP in tests/test_blocks_taps.js): the
# block is made of controls and has no plate of its own between them
NO_TAP = {
    'accessory': 'the whole block is the accessory\'s control: a tap toggles it, a hold opens its sheet',
    'accessories': 'the block is its tiles, each a control: a tap toggles it, a hold opens its sheet',
    'scene': 'the whole block is the scene\'s control: a tap runs it',
    'scenes': 'the block is its scenes, each a control: a tap runs it',
    'action': 'the whole block is the action\'s control: a tap runs it',
    'scene_suggested': 'the whole block is the suggested scene\'s control: a tap runs it',
    'energy_rings S': 'Small is its own switch: a tap changes the period (the owner\'s mock-up)',
    'live_tv S': 'Small is one channel\'s tile: a tap plays it full screen',
    'cameras': 'the block is its camera tiles, each a control: a tap opens that camera, live',
}

# A KEY WHOSE PAGE THE SCREEN DOES NOT HAVE (and whose reading is no sensor the fictional house names) has nothing to open
# there: the tap does nothing, silently, as it should
NO_PAGE = {'doors': 'this screen has no Doors & Windows page and its doors are no one sheet',
           'water': 'this screen has no Water page and names no water meter'}

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--cell', choices=['tile', 'square'], default='square')
parser.add_argument('--homeview', action='store_true', help='square cells, Centred tiles, Big Number, Analog Numbers')
parser.add_argument('--size', default='1180x820', help='the page, WxH (an iPad\'s; a phone\'s is 390x844)')
parser.add_argument('--only', nargs='*', help='catalog keys (default: all)')
parser.add_argument('--expect', action='store_true', help='fail when a block\'s empty plate does nothing')
parser.add_argument('--json', type=Path)
parser.add_argument('--shots', type=Path)
parser.add_argument('--debug', action='store_true', help='for a tap that went nowhere, the path it took')
parser.add_argument('--lattice', type=int, default=7, help='points across a block, each way')
parser.add_argument('--opts', nargs='*', default=[], metavar='KEY=JSON', help='a block\'s options over the audit\'s (on_now=\'{"open": "page"}\')')
parser.add_argument('--parts', action='store_true',
                    help='also tap each part that stands for something (On Now\'s kinds, House Status\'s sections, Everything\'s "+N") and print where it went')
args = parser.parse_args()


def summarize(cells):
    """key -> size -> {points: plate points tried, did: those that went somewhere, where: the places, blind: [x, y] of those that went nowhere}."""
    out = {}
    for c in cells:
        key = c['key']
        plate = [p for p in c['pts'] if p['control'] is None]
        did = [p for p in plate if p['went']]
        where = sorted({w for p in did for w in p['went']})
        out.setdefault(key, {})[c['bsize']] = {'tag': c['tag'], 'cell': [c['w'], c['h']], 'plate': len(plate), 'did': len(did), 'where': where,
                                               'blind': [[p['x'], p['y'], p['on']] + ([p['path']] if p.get('path') else []) for p in plate if not p['went']][:3]}
    return out


async def main():
    pw, node = os.environ.get('PLAYWRIGHT_PATH'), os.environ.get('NODE')
    if not (pw and Path(pw).exists() and node and Path(node).exists()):
        print('SKIPPED the block taps: set PLAYWRIGHT_PATH and NODE (edit_mode_check.py\'s)')
        return 0
    A.CELL.update(cell='square' if args.homeview else args.cell, homeview=args.homeview)
    for o in args.opts:
        k, _, v = o.partition('=')
        A.OPTS[k] = {**A.OPTS.get(k, {}), **json.loads(v)}
    keys = args.only or list(HG.CATALOG)
    parts = A.parts(keys)
    look = 'flat_light'
    gallery.HOUSE.update(A.EXTRA)
    gallery.SETTINGS = A.settings([(k, look, True) for k in parts])
    A.stand_in_reads()
    cells, errors = [], []
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        A.stand_in_app(app)
        # the sun's next setting, which the Weather block's Extra Large reads
        app['hub'].store.apply_event({'a': {'sun.sun': {'s': 'above_horizon', 'lc': gallery.NOW, 'lu': gallery.NOW,
                                                        'a': {'friendly_name': 'Sun', 'elevation': 40.0, 'azimuth': 180.0, 'next_setting': A.SUNSET}}}})
        async with TestServer(app) as server:
            origin = str(server.make_url('')).rstrip('/')
            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
            for part in parts:
                proc = await asyncio.create_subprocess_exec(node, str(Path(__file__).with_suffix('.cjs')),
                                                            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
                out, _ = await proc.communicate(json.dumps({
                    'origin': origin, 'cookie': cookie, 'screen': A.screen(part, look), 'size': args.size, 'engine': 'webkit',
                    'feed': A.feed_script(), 'lattice': args.lattice, 'debug': args.debug, 'shots': str(args.shots or ''),
                    'parts': '[data-open-kind],.sm-t[data-i],.app.mo' if args.parts else ''}).encode())
                if proc.returncode != 0:
                    errors.append(f'{part}: the page failed')
                for line in out.decode().splitlines():
                    if line.startswith('CELL '):
                        c = json.loads(line[5:])
                        c['key'] = part.split(':')[0]
                        cells.append(c)
                    elif line.startswith('PAGES ') and args.only:
                        print(part, line)
                    elif line.startswith('ERROR '):
                        errors.append(f'{part}: {line[6:]}')
    table = summarize(cells)
    if args.json:
        args.json.write_text(json.dumps({'cells': cells, 'table': table}, indent=1))
    bad = []
    order = {s: i for i, s in enumerate(['S', 'W', 'T', 'L', 'XL', 'XXL', 'F'])}
    for key in keys:
        for size in sorted(table.get(key, {}), key=lambda s: order.get(s, 9)):
            r = table[key][size]
            share = r['did'] / r['plate'] if r['plate'] else 0
            line = f"{key:16} {size:3} {r['tag'] or '-':26} {r['did']:2}/{r['plate']:<2} " + (', '.join(r['where']) or 'nothing')
            reason = NO_TAP.get(f'{key} {size}') or NO_TAP.get(key)
            if args.expect and key in NO_PAGE:
                line = 'ok   ' + line + f"   ({NO_PAGE[key]})"
            elif args.expect and reason:
                line = 'ok   ' + line + f"   ({reason})"
            elif args.expect and (share < 0.75 or not r['did']):
                bad.append(line)
                line = 'FAIL ' + line + f"   blind at {r['blind']}"
            else:
                line = 'ok   ' + line if args.expect else line
            print(line)
            if args.parts:
                for c in cells:
                    if c['key'] == key and c['bsize'] == size:
                        for pt in c.get('parts', []):
                            print(f"       part {pt['what'][:28]:28} {pt['w']}x{pt['h']} -> " + (', '.join(pt['went']) or 'nothing'))
                            if not pt['went'] and args.expect:
                                bad.append(f"{key} {size} part {pt['what']}")
        if key not in table:
            print(f'{key:16} not drawn')
            bad.append(key + ' not drawn')
    for e in errors:
        print('ERROR', e)
    if args.expect:
        assert not bad and not errors, f'{len(bad)} block(s) with an empty plate that opens nothing, {len(errors)} error(s)'
        print('PASS: every block opens something where its plate is empty -- ' + args.size + ', ' + (
            'HomeView' if args.homeview else args.cell + ' cells'))
    return 0

raise SystemExit(asyncio.run(main()))
