"""THE SCREENSAVER EDITOR (phase 13, phase 5: docs/phase13/EDITOR-SPEC.md) in WebKit, at a wall tablet's size, on the
gallery's fictional house against a real Mantel Server -- the editor in Settings (a screen -> Screensaver -> Edit
Screensaver) with a screen whose screensaver already has a Lock Screen's pieces.

    PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=node python tools/headless/saver_editor_check.py [--shots DIR]

What it checks (saver_editor_check.cjs says each one): the Looks gallery (ten Looks, the current one marked); a Look
tapped changes the Look only -- the Info stays, and what the Look has no place for waits; the four sections in their
order; the rows that apply (Depth says why where Behind can't be; Legibility on a busy background; Moving Color's Motion);
a piece from the library into a green place; a piece's page (its shapes drawn, Size, Backdrop, Color, its options, an
entity picker naming the suggestion, Show When); See a Slide and Day / Night; Start Over from This Look and Reset with
their in-page confirmations; a Save that is a v2 layout hk-saverlayout.js takes. No page errors.

--shots DIR keeps the screenshots (the Looks, the four sections, a piece's page, the library).

Without PLAYWRIGHT_PATH or Node it says why and exits 0.
"""
import argparse, asyncio, json, os, shutil, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / x) for x in ('tools/headless', 'tools', 'hosts/server', 'tests')]
ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('--node', default=os.environ.get('NODE') or shutil.which('node'))
ap.add_argument('--shots', type=Path)
ap.add_argument('--size', default='1280x800', help='the window: a wall tablet is 1280x800')
args = ap.parse_args()
if not args.node or not os.environ.get('PLAYWRIGHT_PATH'):
    print('saver_editor_check: skipped (needs NODE and PLAYWRIGHT_PATH)')
    raise SystemExit(0)
import gallery  # noqa: E402

SCREEN = 'saver-editor'


def pc(spec, **extra):
    piece, shape = spec.split('.')
    return dict({'piece': piece, 'shape': shape, 'back': 'glass' if shape == 'card' else 'none', 'color': 'auto'}, **extra)


# the Lock Screen's pieces on the Landscape, as the editor's Look draws it
LAYOUT = {'v': 2, 'big': {'kind': 'time', 'size': 26, 'pos': 'upper', 'align': 'center', 'depth': 'behind'}, 'row_at': 'under', 'upright': None,
          'zones': {'line': [pc('date.inline')], 'row': [pc('weather.circular'), pc('readings.circular', opts={'reading': 'aqi'}), pc('timers.circular'),
                                                          pc('status.circular')],
                    'tl': [], 'tr': [], 'bl': [pc('music.card')], 'br': [], 'bottom': []}}


async def main():
    from aiohttp.test_utils import TestServer
    w, h = (int(x) for x in args.size.split('x'))
    gallery.HOUSE['lock.back_door'] = ('kitchen', ('unlocked', {'friendly_name': 'Back Door'}))
    gallery.SETTINGS['settings']['security'] = {'alarm': 'alarm_control_panel.home', 'locks': ['lock.front_door', 'lock.back_door'],
                                                'doors': [], 'windows': [], 'garage': []}
    gallery.SETTINGS['boards'][SCREEN] = {'title': 'Living Room Tablet', 'pages': [], 'headers': {'home': True}, 'menu_custom': True, 'menu': 'tabbar',
                                          'screensaver': True, 'screensaver_options': {'show': 'forecast', 'clock_style': 'classic', 'layout': LAYOUT}}
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td), real_model=True)
        async with TestServer(app) as server:
            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
            proc = await asyncio.create_subprocess_exec(args.node, str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE,
                                                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=os.environ)
            out, err = await proc.communicate(json.dumps({'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'screen': SCREEN,
                                                          'size': [w, h], 'shots': str(args.shots) if args.shots else None}).encode())
            print(out.decode())
            if err.strip():
                print(err.decode(), file=sys.stderr)
            return proc.returncode


# (guarded: the server's picture worker starts with spawn, which imports this file again as its main module)
if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
