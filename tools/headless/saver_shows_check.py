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
    # Photos with Time Behind (2026-10-31): the weather in the upper-left corner, as on Clock, clear of the time
    'saver-timebehind': ({'show': 'photos', 'time_behind': True, 'photo_titles': True}, 'tb'),
    # 26 (2026-10-30): the photo options where they apply -- Clock on sharp photos offers Time Behind and draws it;
    # on Soft photos neither (left on from Photos, it couldn't be turned off from Clock)
    'saver-clockphotos': ({'show': 'clock', 'clock_bg': 'photos', 'time_behind': True}, 'clock-tb'),
    'saver-clocksoft': ({'show': 'clock', 'clock_bg': 'photos', 'clock_photo_soft': True, 'time_behind': True}, 'clock-soft'),
}


async def photos_for(server, cookie, screens):
    """Photos for Time Behind: a drawn person against a drawn sky, uploaded to a Mantel album the screen shows (as an
    Owner does in Mantel Settings). No real photo."""
    import io
    from aiohttp import ClientSession, FormData
    from PIL import Image, ImageDraw
    base = str(server.make_url('')).rstrip('/')
    async with ClientSession(cookies={'mantel_session': cookie}) as http:
        async with http.get(base + '/api/session') as r:
            csrf = (await r.json()).get('csrf')
        h = {'X-CSRF-Token': csrf} if csrf else {}
        async with http.post(base + '/api/photos/albums', json={'name': 'Lake Weekend'}, headers=h) as r:
            aid = (await r.json())['album']['id']
        im = Image.new('RGB', (1500, 1000))
        d = ImageDraw.Draw(im)
        for y in range(1000):
            d.line([(0, y), (1500, y)], fill=(int(233 - 90 * y / 1000), int(160 - 100 * y / 1000), int(140 - 90 * y / 1000)))
        d.ellipse([640, 160, 860, 440], fill=(214, 168, 140))
        d.rounded_rectangle([490, 500, 1010, 1060], radius=120, fill=(52, 72, 110))
        buf = io.BytesIO(); im.save(buf, 'JPEG', quality=88)
        fd = FormData(); fd.add_field('file', buf.getvalue(), filename='person.jpg', content_type='image/jpeg')
        async with http.post(base + f'/api/photos/albums/{aid}/upload', data=fd, headers=h) as r:
            assert r.status == 201, await r.text()
        for screen in screens:
            async with http.put(base + f'/api/photos/screens/{screen}', json={'album': aid}, headers=h) as r:
                assert r.status == 200, await r.text()


async def main():
    from aiohttp.test_utils import TestServer
    for name, (opts, _) in SHOWS.items():
        gallery.SETTINGS['boards'][name] = {'title': name, 'pages': [], 'headers': {'home': True}, 'menu_custom': True, 'menu': 'tabbar',
                                            'screensaver': True, 'screensaver_options': opts}
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td), real_model=True)
        async with TestServer(app) as server:
            await photos_for(server, cookie, ('saver-timebehind', 'saver-clockphotos', 'saver-clocksoft'))
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
