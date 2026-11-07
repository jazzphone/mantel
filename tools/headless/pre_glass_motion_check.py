"""PRE-RENDERED GLASS OVER A MOVING WALLPAPER, in WebKit (2026-11-07).

    PLAYWRIGHT_PATH=... NODE=node python tools/headless/pre_glass_motion_check.py [--size WxH ...] [--shots DIR]

The glass's picture of the sky (hk-glass.js, Blur Mode Pre-rendered, in Blur and in Bright Glass) over a drawn
wallpaper that moves as a whole (Shards) and a motion theme whose layers move (Waves), Motion Fast -- with the real
detector (hkSky.drifting) and the real painter (hk-skyshot.js), nothing stood in. On each: the sky says it drifts; a
new picture comes every couple of seconds while nothing touches the page, and its pixels differ from the first one's;
the cards' glass and the pinned tab bar wear the newest. A Side Pane and a docked
side menu wear it too, in both looks, with no live blur left on them. Then Motion Off (the settings as the house would send them):
painted again at once, the still frame, and no more pictures after it; Motion Slow: painted at once and followed
again. Prints PASS / FAIL lines.

Without PLAYWRIGHT_PATH or Node it says why and exits 0.
"""
import argparse, asyncio, json, os, shutil, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / x) for x in ('tools/headless', 'tools', 'hosts/server', 'tests')]
ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('--node', default=os.environ.get('NODE') or shutil.which('node'))
ap.add_argument('--size', action='append')
ap.add_argument('--shots', type=Path, help='write each screen\'s shot here')
args = ap.parse_args()
if not args.node or not os.environ.get('PLAYWRIGHT_PATH'):
    print('pre_glass_motion_check: skipped (needs NODE and PLAYWRIGHT_PATH)')
    raise SystemExit(0)
import gallery  # noqa: E402

SIZES = args.size or ['1180x820']
GLASSES = ['blur_pre', 'bright_pre']
WALLS = {'shards': 'blue', 'waves': 'teal'}
DASH = [{'kind': 'weather'}, {'kind': 'calendar'}, {'kind': 'now_playing', 'when': 'active'}]


async def main():
    from aiohttp.test_utils import TestServer
    screens = []
    for glass in GLASSES:
        for wall, color in WALLS.items():
            name = 'pgm-' + glass.replace('_', '') + '-' + wall
            gallery.SETTINGS['boards'][name] = {
                'title': name, 'pages': [], 'headers': {'home': True}, 'menu_custom': True, 'menu': 'tabbar',
                'tab_bar_rooms': 'button', 'tab_bar_rooms_phone': 'button', 'glass': glass, 'sky': True,
                'sky_background': 'wallpaper', 'sky_wallpaper': wall, 'sky_wallpaper_color': color, 'sky_wallpaper_motion': 'fast'}
            screens.append({'path': name, 'glass': glass, 'wall': wall})
        # the persistent glass a wall tablet keeps up: a Side Pane beside every page (side_pane_check.py's), and a
        # docked side menu
        base = {'pages': [], 'headers': {'home': True}, 'glass': glass, 'sky': True, 'sky_background': 'wallpaper',
                'sky_wallpaper': 'shards', 'sky_wallpaper_color': 'blue', 'sky_wallpaper_motion': 'fast'}
        for kind, extra in (('pane', {'menu_custom': True, 'menu': 'tabbar', 'side_pane': {
                                'side': 'right', 'width': 'standard', 'dashboard': {'show': 'all', 'sections': DASH}}}),
                            ('menu', {'menu': 'open'})):
            name = 'pgm-' + glass.replace('_', '') + '-' + kind
            gallery.SETTINGS['boards'][name] = {'title': name, **base, **extra}
            screens.append({'path': name, 'glass': glass, 'wall': 'shards', 'surface': kind})
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td), real_model=True)
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(
                args.node, str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
            out, _ = await proc.communicate(json.dumps({
                'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'screens': screens, 'sizes': SIZES, 'shots': str(args.shots) if args.shots else None}).encode())
    bad = [line for line in out.decode().splitlines() if print(line, flush=True) or line.startswith('FAIL')]
    if proc.returncode and not bad:
        bad.append('FAIL: the browser stopped')
    if bad:
        raise SystemExit(f'FAIL: {len(bad)}')
    print(f'PASS: {len(screens)} screens at {len(SIZES)} sizes')

asyncio.run(main())
