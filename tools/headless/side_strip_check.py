"""The page beside a side strip of system controls (the iPhone Duo's), in WebKit, on the fictional house.

The Duo keeps its camera, a Live Activity, the time and Wi-Fi at the top of an 84 pt strip down its right edge, and
the app's web view runs under it (2026-10-30). A headless browser has no safe area of its own, so the check stands
one in through the custom properties the page reads its insets through (--hk-safe-left / -right / -bottom, hk-base.js
SAFE) and looks at Home with the sky:

- **outer**: the Duo folded (466 x 678, the strip 84 at the right): the view keeps clear of the strip, the sky runs
  under it, the tab bar is a rail in the strip's foot below its reserve, the page keeps no room for a bar at its foot;
  More opens beside the strip.
- **inner**: the Duo open, held sideways (1000 x 703, the strip 84 at the right): the same, more tabs.
- **off**: Use the Side Strip off (the screen's own): the bar along the bottom, inside the strip's edge.
- **turned**: a phone held sideways (874 x 402, 62 at both sides, its Dynamic Island in one): no rail; the page
  and the bar clear of both sides.

    export PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=$(command -v node)
    ~/.venvs/mantel/bin/python tools/headless/side_strip_check.py [--shots DIR]

Without PLAYWRIGHT_PATH or NODE it says why and exits 0.
"""
import argparse, asyncio, json, os, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]


async def main(shots):
    import gallery
    from aiohttp.test_utils import TestServer
    # the screen's menu the tab bar, on tablets and on phones; a second screen with Use the Side Strip off
    base = {'pages': [], 'headers': {'home': True}, 'menu': 'tabbar', 'menu_phone': 'tabbar'}
    gallery.SETTINGS['boards'][gallery.SCREEN] = dict(base)
    gallery.SETTINGS['boards']['no-strip'] = dict(base, menu_own=['tab_bar_strip'], tab_bar_strip=False)
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        from mantel_server.settings_store import load_model
        app['settings'].model = load_model()
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(os.environ['NODE'], str(Path(__file__).with_suffix('.cjs')),
                                                        stdin=asyncio.subprocess.PIPE)
            await proc.communicate(json.dumps({'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie,
                                               'screen': gallery.SCREEN, 'shots': str(shots) if shots else ''}).encode())
            return proc.returncode


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--shots', type=Path, help='keep the screenshots here')
    args = ap.parse_args()
    if not os.environ.get('PLAYWRIGHT_PATH') or not os.environ.get('NODE'):
        print('side_strip_check: skipped -- set PLAYWRIGHT_PATH (playwright-core) and NODE')
        sys.exit(0)
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    sys.exit(asyncio.run(main(args.shots)))
