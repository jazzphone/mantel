"""The Pages screen (docs/phase11/HOMEVIEW-LOOK.md, Phase J) in WebKit, on the fictional house.

All Screens' Pages Screen on; two screens: the fictional house's own (the side menu, no tab bar) and one whose menu
is the tab bar. At a landscape tablet (1180 x 820), an upright one (820 x 1180) and a phone (390 x 844), each with and
without the tab bar, and with widgets (a stand-in for the Side Pane's section renderer, Phase A2), it checks:

- /pages draws the screen's pages as icons, every icon inside the window and none under the tab bar;
- the grid is 6 x 3, 4 x 5 or 4 x 6 (as the plan's table), the rooms in one folder;
- the Home pill is there without a tab bar and not beside one, and the page itself never scrolls;
- the tab bar's second tab is Pages; a tap on an icon opens its page, the folder opens and closes, the pill goes Home;
- no page errors.

    export PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=$(command -v node)
    ~/.venvs/mantel/bin/python tools/headless/pages_screen_check.py [--shots DIR]

Without PLAYWRIGHT_PATH or NODE it says why and exits 0.
"""
import argparse, asyncio, json, os, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]


async def main(shots):
    import gallery
    from aiohttp.test_utils import TestServer
    gallery.SETTINGS['settings']['pages_screen'] = {'show': 'on'}
    base = {'pages': [], 'headers': {'home': True}}
    gallery.SETTINGS['boards'][gallery.SCREEN] = dict(base, menu='auto')
    gallery.SETTINGS['boards']['with-bar'] = dict(base, menu='tabbar', menu_phone='tabbar')
    # with widgets: a Large one at the right, a Small one at the left (this screen's own)
    widgets = [{'kind': 'weather', 'size': 'more', 'place': 'right'}, {'kind': 'clock', 'size': 'less', 'place': 'left'}]
    gallery.SETTINGS['boards']['with-widgets'] = dict(base, menu='auto', pages_screen={'widgets': widgets})
    gallery.SETTINGS['boards']['with-widgets-bar'] = dict(base, menu='tabbar', menu_phone='tabbar', pages_screen={'widgets': widgets})
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
        print('pages_screen_check: skipped -- set PLAYWRIGHT_PATH (playwright-core) and NODE')
        sys.exit(0)
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    sys.exit(asyncio.run(main(args.shots)))
