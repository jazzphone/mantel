"""THE MOTION THEMES, in WebKit (2026-10-31, the owner on 0.1.94: more moving backgrounds, any colour).

    PLAYWRIGHT_PATH=... NODE=node python tools/headless/motion_themes_check.py --shots DIRECTORY [--size WxH ...]

The fictional house (gallery.py), one screen per theme and colour (hk-wallpapers.js THEMES, two colours each: a preset
and one of the owner's own), its Background a Wallpaper with Motion Medium in Bright Glass. On each, at each size: the
sky shows the theme's ground with its layers, they move by transform and opacity alone, and the page keeps its frame
rate; on one, Animations Off and Reduce Motion each leave the still frame. Then HK Settings' picker with a theme and
its Color, and the Clock screensaver over a theme and over a drawn wallpaper with its own Background picker. Writes
<screen>-<size>.png and the Settings and screensaver shots; prints PASS / FAIL lines.

Without PLAYWRIGHT_PATH or Node it says why and exits 0.
"""
import argparse, asyncio, json, os, shutil, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / x) for x in ('tools/headless', 'tools', 'hosts/server', 'tests')]
ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('--node', default=os.environ.get('NODE') or shutil.which('node'))
ap.add_argument('--shots', type=Path, required=True)
ap.add_argument('--size', action='append')
args = ap.parse_args()
if not args.node or not os.environ.get('PLAYWRIGHT_PATH'):
    print('motion_themes_check: skipped (needs NODE and PLAYWRIGHT_PATH)')
    raise SystemExit(0)
import gallery  # noqa: E402

SIZES = args.size or ['1180x820', '390x844']
# each theme in a preset and in a colour of the owner's own
THEMES = {'aurora': ('teal', '#ff5fa2'), 'blobs': ('violet', '#ff8800'), 'waves': ('blue', '#2ec4b6'),
          'dots': ('rose', '#c0f000'), 'beams': ('amber', '#6a8cff'), 'meteors': ('graphite', '#9b5cff')}
STILL = 'mt-still'                  # Animations off: the still frame
SAVER = {'mt-saver-theme': {'clock_wallpaper': 'meteors', 'clock_wallpaper_color': 'violet'},
         'mt-saver-drawn': {'clock_wallpaper': 'petals_violet'}}


def board(theme, color, **more):
    return {'title': theme + ' ' + color, 'pages': [], 'headers': {'home': True}, 'menu_custom': True, 'menu': 'tabbar',
            'glass': 'bright', 'sky': True, 'sky_background': 'wallpaper', 'sky_wallpaper': theme, 'sky_wallpaper_color': color,
            'sky_wallpaper_motion': 'medium', **more}


async def main():
    from aiohttp.test_utils import TestServer
    screens = []
    for theme, colors in THEMES.items():
        for color in colors:
            name = 'mt-' + theme + '-' + color.lstrip('#')
            gallery.SETTINGS['boards'][name] = board(theme, color)
            screens.append({'path': name, 'theme': theme, 'color': color})
    gallery.SETTINGS['boards'][STILL] = board('waves', 'blue', sky_animations=False)
    for name, opts in SAVER.items():
        gallery.SETTINGS['boards'][name] = {'title': name, 'pages': [], 'headers': {'home': True}, 'menu_custom': True, 'menu': 'tabbar',
                                            'screensaver': True, 'screensaver_options': {'show': 'clock', 'clock_bg': 'wallpaper', 'clock_style': 'classic', **opts}}
    gallery.SETTINGS['settings']['sky'] = {'background': 'wallpaper', 'wallpaper': 'aurora', 'wallpaper_color': 'teal', 'wallpaper_motion': 'medium'}
    args.shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td), real_model=True)
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(
                args.node, str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
            out, _ = await proc.communicate(json.dumps({
                'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'screens': screens, 'still': STILL,
                'saver': list(SAVER), 'sizes': SIZES, 'shots': str(args.shots)}).encode())
    bad = [line for line in out.decode().splitlines() if print(line, flush=True) or line.startswith('FAIL')]
    if proc.returncode and not bad:
        bad.append('FAIL: the browser stopped')
    if bad:
        raise SystemExit(f'FAIL: {len(bad)}')
    print(f'PASS: {len(screens)} theme screens at {len(SIZES)} sizes, the still frame, Settings and the screensaver')

asyncio.run(main())
