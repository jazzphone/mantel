"""THE SCREENSAVER'S SHOWS FROM A SCREEN'S SETTINGS, in WebKit (2026-10-30), against the gallery's fictional house.

saver_faces_check.py draws each face by handing hk-saver.js its options directly; this one goes the way a house does:
a screen's saved settings (screensaver on, its Screensaver Options' Show and the faces' options), the strategy's
screensaver block built from them (hk-strategy.js hkSaver), and the screensaver it starts -- so a Show the strategy
drops (every new Show once became Photos: "they just keep showing photos") fails here. Each Show's face must be the one
drawn: Glance, Month and Day (ckface on the screensaver), Big Weather (fcbig) and Classic (neither).

    PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=node python tools/headless/saver_shows_check.py [--shots DIR]

Without PLAYWRIGHT_PATH or Node it says why and exits 0.
"""
import argparse, asyncio, json, os, shutil, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / x) for x in ('tools/headless', 'tools', 'hosts/server', 'tests')]
ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('--node', default=os.environ.get('NODE') or shutil.which('node'))
ap.add_argument('--shots', type=Path)
args = ap.parse_args()
if not args.node or not os.environ.get('PLAYWRIGHT_PATH'):
    print('saver_shows_check: skipped (needs NODE and PLAYWRIGHT_PATH)')
    raise SystemExit(0)
import gallery  # noqa: E402

# screen -> (its Screensaver Options, the face it must draw: ckface's value, 'big', or None for the classic forecast)
SHOWS = {
    'saver-glance': ({'show': 'glance'}, 'glance'),
    'saver-month': ({'show': 'month'}, 'month'),
    'saver-day': ({'show': 'day', 'day_look': 'dark'}, 'day'),
    'saver-bigweather': ({'show': 'forecast', 'forecast_layout': 'big'}, 'big'),
    'saver-forecast': ({'show': 'forecast'}, None),
}


async def main():
    from aiohttp.test_utils import TestServer
    for name, (opts, _) in SHOWS.items():
        gallery.SETTINGS['boards'][name] = {'title': name, 'pages': [], 'headers': {'home': True}, 'menu_custom': True, 'menu': 'tabbar',
                                            'screensaver': True, 'screensaver_options': opts}
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td), real_model=True)
        async with TestServer(app) as server:
            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
            proc = await asyncio.create_subprocess_exec(args.node, str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE,
                                                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=os.environ)
            out, err = await proc.communicate(json.dumps({'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie,
                                                          'shows': {k: v[1] for k, v in SHOWS.items()},
                                                          'shots': str(args.shots) if args.shots else None}).encode())
            print(out.decode())
            if err.strip():
                print(err.decode(), file=sys.stderr)
            return proc.returncode


raise SystemExit(asyncio.run(main()))
