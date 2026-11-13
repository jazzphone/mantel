"""THE SKY DRAWN BY THE TABLET APP, the page's half, in Chromium (phase 29, docs/phase29/PLAN.md steps 1-3 and 5).

    PLAYWRIGHT_PATH=... NODE=node python tools/headless/app_sky_check.py [--size WxH ...] [--shots DIR]

A real Mantel Server over the gallery's invented home; a wall tablet (Kitchen) running Mantel for Android with Sky
Drawn by the App on, and a stand-in for the app's bridge (window.mantelNative: every step answered yes, each one kept).
Chromium only: the app's page is Android's WebView. On a Bright Glass screen with the tab bar:

  * a busy sky (pouring rain) is handed over: the app told the setting, then begin, the sheets, play and shown; the
    page's sky clipped away; the glass wears the frost picture -- every layer its child with the picture fixed to the
    screen and no live blur, the tab bar its slice -- and a sheet opened over it wears the picture under its plate, no
    blur; a page moved by a swipe keeps the picture in line (its child fixed and moved back by as much);
  * something else moving on the page (a spinning tile): the sky is the page's again, and the app's once it is still;
  * a calm sky (a clear day) is handed back: stop, the clip gone, the glass the look's own again (live blur, no frost);
  * Sky Drawn by the App off: nothing handed over, the app told so;
  * no bridge (a browser, Home Assistant): nothing of it runs at all.

Prints PASS / FAIL lines. Without PLAYWRIGHT_PATH or Node it says why and exits 0.
"""
import argparse, asyncio, json, os, shutil, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / x) for x in ('tools/headless', 'tools', 'hosts/server', 'tests')]
ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('--node', default=os.environ.get('NODE') or shutil.which('node'))
ap.add_argument('--size', action='append')
ap.add_argument('--shots', type=Path, help='write each step\'s shot here')
args = ap.parse_args()
if not args.node or not os.environ.get('PLAYWRIGHT_PATH'):
    print('app_sky_check: skipped (needs NODE and PLAYWRIGHT_PATH)')
    raise SystemExit(0)
import gallery  # noqa: E402

SIZES = args.size or ['1280x800']
SCREEN = 'app-sky'


async def main():
    from aiohttp.test_utils import TestServer
    # (a still page: the ceiling fan off, or its tile spins and the page keeps its sky -- hk-sky-handover.js pageMoves)
    area, (_, attrs) = gallery.HOUSE['fan.bedroom_ceiling']
    gallery.HOUSE['fan.bedroom_ceiling'] = (area, ('off', {**attrs, 'percentage': 0}))
    gallery.SETTINGS['boards'][SCREEN] = {
        'title': 'App Sky', 'pages': [], 'headers': {'home': True}, 'menu_custom': True, 'menu': 'tabbar',
        'tab_bar_rooms': 'button', 'tab_bar_rooms_phone': 'button', 'glass': 'bright', 'sky': True}
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td), real_model=True)
        from mantel_server.settings_store import Actor
        service = app['settings']
        for tid, sky in (('loft', True), ('den', False)):
            service.store.write([('tablet', tid, {'name': tid.title(), 'room': 'living_room', 'screen': SCREEN,
                                                  'app': 'android_app', 'app_sky': sky, 'uid': f'tablet_{tid}'})],
                                actor=Actor(label='app_sky_check'))
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(
                args.node, str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
            out, _ = await proc.communicate(json.dumps({
                'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'screen': SCREEN, 'sizes': SIZES,
                'shots': str(args.shots) if args.shots else None}).encode())
    bad = [line for line in out.decode().splitlines() if print(line, flush=True) or line.startswith('FAIL')]
    if proc.returncode and not bad:
        bad.append('FAIL: the browser stopped')
    if bad:
        raise SystemExit(f'FAIL: {len(bad)}')
    print(f'PASS: the app\'s sky at {len(SIZES)} sizes')

asyncio.run(main())
