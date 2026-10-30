"""THE LOOKS in WebKit (hk_core/settings/looks.py, 2026-10-30), against the gallery's fictional house.

Each Look applied to a screen from its Looks page in HK Settings (what it says it changes, then Use), Home drawn at
a landscape tablet's, an upright one's and a phone's size with no page error, and Undo putting the screen back;
then Layout + Look in the Home Grid editor, which sets the layout too. With --shots DIR it keeps a screenshot of
each Look's Home and of the Looks page.

    PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=node python tools/headless/looks_check.py --shots DIR

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
    print('looks_check: skipped (needs NODE and PLAYWRIGHT_PATH)')
    raise SystemExit(0)
import gallery  # noqa: E402
from hk_core.settings import looks as L  # noqa: E402


async def main():
    from aiohttp.test_utils import TestServer
    gallery.SETTINGS['boards']['looks'] = {'title': 'Looks', 'pages': [], 'headers': {'home': True}, 'menu_custom': True, 'menu': 'tabbar'}
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td), real_model=True)
        async with TestServer(app) as server:
            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
            proc = await asyncio.create_subprocess_exec(args.node, str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE,
                                                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=os.environ)
            out, err = await proc.communicate(json.dumps({'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'screen': 'looks',
                                                          'looks': list(L.IDS), 'glass': {x['id']: 'flat' if x['settings'].get('flat') else x['settings'].get('glass') for x in L.LOOKS}, 'shots': str(args.shots) if args.shots else None}).encode())
            print(out.decode())
            if err.strip():
                print(err.decode(), file=sys.stderr)
            return proc.returncode


raise SystemExit(asyncio.run(main()))
