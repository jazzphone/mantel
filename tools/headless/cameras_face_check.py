"""The Cameras face (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase G) against the fictional home, never a
household's: nine cameras of HK's own landscapes on a Home Grid -- Full (the view's whole grid) on a landscape tablet's
6 x 4, on a portrait tablet and on a phone's 2 x 4, and Extra Large and Full Width blocks beside other blocks. In WebKit
(cameras_face_check.cjs), at 1180 x 820, 820 x 1180 and 390 x 844: the tiles are arranged to the block (3 x 3; 2 x 4 on
a phone; 3 x 2 and 4 x 2), each inside its cell with its picture and its name, nothing scrolls; a doorbell ring makes
the doorbell's tile live in place (ringed, LIVE), the only live one; a tap on a tile opens that camera's sheet.

Skipped, saying so, without PLAYWRIGHT_PATH and NODE (edit_mode_check.py's).

    python tools/headless/cameras_face_check.py [--shots DIRECTORY] [--size 1180x820]
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
from aiohttp.test_utils import TestServer

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--shots', type=Path)
parser.add_argument('--size', action='append', help='only this size (WxH); may be given more than once')
args = parser.parse_args()

# the fictional home's cameras, each one of HK's own landscapes (a picture of somewhere, not of anyone's home)
CAMERAS = {'camera.front_door': ('porch', 'Front Door', '07.webp'), 'camera.front_doorbell': ('porch', 'Doorbell', '12.webp'),
           'camera.driveway': ('porch', 'Driveway', '03.webp'), 'camera.backyard': ('backyard', 'Backyard', '21.webp'),
           'camera.garage': ('garage', 'Garage', '15.webp'), 'camera.side_gate': ('backyard', 'Side Gate', '28.webp'),
           'camera.patio': ('backyard', 'Patio', '33.webp'), 'camera.pool': ('backyard', 'Pool', '09.webp'),
           'camera.garden': ('backyard', 'Garden', '36.webp')}
ORDER = list(CAMERAS)


def grid(cols, rows, items, band=False):
    return {'v': 1, 'cols': cols, 'rows': rows, 'frame': [1180, 820], 'band': band, 'items': items}


FULL = [{'id': 'cams', 'card': 'cameras', 'size': 'F', 'at': [0, 0]}]
SIZES = [{'id': 'wide', 'card': 'cameras', 'size': 'XXL', 'at': [0, 0], 'opts': {'refresh': 15}},
         {'id': 'six', 'card': 'cameras', 'size': 'XL', 'at': [0, 2], 'opts': {'cameras': ORDER[:6]}},
         {'id': 'clock', 'card': 'clock', 'size': 'L', 'at': [3, 2]},
         {'id': 'timers', 'card': 'timers', 'size': 'S', 'at': [5, 2]}]
# [screen, its layout, the sizes it is looked at]
SCREENS = [('cams-full', grid(6, 4, FULL), ['1180x820', '820x1180']),
           ('cams-phone', grid(2, 4, FULL), ['390x844']),
           ('cams-sizes', grid(6, 4, SIZES, band=True), ['1180x820'])]


def stand_in_stills():
    """Each camera's still its own landscape (gallery.stand_in_stills gives the cameras it doesn't know one)."""
    from aiohttp import web
    from mantel_server.connectors import camera_still

    def pick(url):
        return next((v[2] for k, v in sorted(CAMERAS.items(), key=lambda kv: -len(kv[0])) if k in url), '01.webp')

    async def still(request, url, params, token, what, unavailable, not_found):
        return web.Response(body=(ROOT / 'web/hk/landscapes' / pick(url)).read_bytes(), content_type='image/webp')

    async def read(app, url, params, token, what):
        return (ROOT / 'web/hk/landscapes' / pick(url)).read_bytes(), 'image/webp'
    camera_still.proxy_image = still
    camera_still.read_image = read


async def main():
    pw, node = os.environ.get('PLAYWRIGHT_PATH'), os.environ.get('NODE')
    if not (pw and Path(pw).exists() and node and Path(node).exists()):
        print('SKIPPED the Cameras face: set PLAYWRIGHT_PATH and NODE (edit_mode_check.py\'s)')
        return 0
    for eid, (area, name, _) in CAMERAS.items():
        gallery.HOUSE[eid] = (area, ('idle', {'friendly_name': name, 'access_token': 'fictional',
                                             'entity_picture': f'/api/camera_proxy/{eid}?token=fictional'}))
    for screen, board, _ in SCREENS:
        gallery.SETTINGS['boards'][screen] = {'home_style': 'grid', 'home_grid': board, 'menu_custom': True, 'menu': 'tabbar',
                                              'cameras': ORDER}
    failed = []
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        stand_in_stills()
        from mantel_server.settings_store import load_model
        app['settings'].model = load_model()
        async with TestServer(app) as server:
            origin = str(server.make_url('')).rstrip('/')
            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
            for screen, _, sizes in SCREENS:
                for size in sizes:
                    if args.size and size not in args.size:
                        continue
                    proc = await asyncio.create_subprocess_exec(node, str(Path(__file__).with_suffix('.cjs')),
                                                                stdin=asyncio.subprocess.PIPE)
                    await proc.communicate(json.dumps({
                        'origin': origin, 'cookie': cookie, 'screen': screen, 'size': size, 'engine': 'webkit',
                        'doorbell': 'camera.front_doorbell', 'shots': str(args.shots or '')}).encode())
                    if proc.returncode != 0:
                        failed.append(screen + ' ' + size)
    assert not failed, 'the Cameras face failed: ' + ', '.join(failed)
    print('PASS: the Cameras face -- Full at 1180 x 820, 820 x 1180 and 390 x 844; Extra Large and Full Width beside other blocks')
    return 0

raise SystemExit(asyncio.run(main()))
