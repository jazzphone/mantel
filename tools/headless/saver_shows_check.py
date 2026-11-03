"""THE SCREENSAVER'S SHOWS FROM A SCREEN'S SETTINGS, in WebKit (2026-10-30), against the gallery's fictional house.

saver_faces_check.py draws each face by handing hk-saver.js its options directly; this one goes the way a house does:
a screen's saved settings (screensaver on, its Screensaver Options' Show and the faces' options), the strategy's
screensaver block built from them (hk-strategy.js hkSaver), and the screensaver it starts -- so a Show the strategy
drops (every new Show once became Photos: "they just keep showing photos") fails here. Each Show's face must be the one
drawn: Glance, Month and Day (ckface on the screensaver), Big Weather (fcbig) and Classic (neither).

The Screensaver editor's saved layouts too (2026-11-01, the saver-lay- screens): the big element, the widgets and the corner
cards where the plan puts them, at a tablet either way and a phone -- all on the screen, none on another (Lock Screen, the
wall tablet, Planted, a Clock on a background, a Month); the screensaver's own corners under the music slide, the layout's
after it; and a Show with no layout never draws one.

    PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=node python tools/headless/saver_shows_check.py [--shots DIR]
        [--shard K/N]

--only TEXT runs just the screens with TEXT in their names (saver-lay-, say), to work on one.

--shard K/N runs every N-th of the runs (each Show at each size), from the K-th: tools/ci.py runs the N parts side by
side, each with its own server and WebKit (2026-11-01: whole, it was a full run's last ~3 minutes alone).

Without PLAYWRIGHT_PATH or Node it says why and exits 0.
"""
import argparse, asyncio, json, os, shutil, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / x) for x in ('tools/headless', 'tools', 'hosts/server', 'tests')]
ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('--node', default=os.environ.get('NODE') or shutil.which('node'))
ap.add_argument('--shots', type=Path)
ap.add_argument('--shard', default='1/1', help='K/N: every N-th run, from the K-th')
ap.add_argument('--only', default='', help='only the screens whose name has this in it (saver-lay-, say), for working on one')
args = ap.parse_args()
try:
    shard, shards = (int(x) for x in args.shard.split('/'))
    assert 1 <= shard <= shards
except (ValueError, AssertionError):
    ap.error('--shard is K/N, 1 <= K <= N')
if not args.node or not os.environ.get('PLAYWRIGHT_PATH'):
    print('saver_shows_check: skipped (needs NODE and PLAYWRIGHT_PATH)')
    raise SystemExit(0)
import gallery  # noqa: E402

def _layout(big, **zones):
    """A saved layout (hk_core/settings/saver_layout.py): the big element and, per zone, the widgets' ids."""
    return {'v': 1, 'big': big, 'zones': {z: [{'id': w} for w in ids] for z, ids in zones.items()}}


def _pieces(big, **zones):
    """A v2 layout (phase 13): per zone, its pieces as 'piece.shape' (with any options after a '?': 'readings.circular?reading=aqi')."""
    def one(w):
        ps, _, q = w.partition('?')
        piece, shape = ps.split('.')
        out = {'piece': piece, 'shape': shape}
        if q:
            out['opts'] = dict(kv.split('=') for kv in q.split('&'))
        return out
    return {'v': 2, 'big': big, 'zones': {z: [one(w) for w in ws] for z, ws in zones.items()}}


# screen -> (its Screensaver Options, the face it must draw: ckface's value, 'big', or None for the classic forecast)
SHOWS = {
    'saver-glance': ({'show': 'glance'}, 'glance'),
    'saver-month': ({'show': 'month'}, 'month'),
    'saver-day': ({'show': 'day', 'day_look': 'dark'}, 'day'),
    'saver-bigweather': ({'show': 'forecast', 'forecast_layout': 'big'}, 'big'),
    'saver-forecast': ({'show': 'forecast'}, None),
    # Photos with Time Behind (2026-10-31): the weather in the upper-left corner, as on Clock, clear of the time
    'saver-timebehind': ({'show': 'photos', 'time_behind': True, 'photo_titles': True, 'zoom': True, 'portrait_zoom': 150, 'landscape_zoom': 150}, 'tb'),
    # (the owner on 0.1.118: "sometimes the clock is off center when set to behind faces" -- the Today face, its song and
    # weather under the time)
    'saver-timebehind-today': ({'show': 'photos', 'time_behind': True, 'clock_style': 'today', 'clock_today_music': True}, 'tb'),
    # (2026-11-03, the owner's recordings: the people over the time stayed solid while the rest crossfaded, and a zoomed
    # whole portrait sat off center) -- two photos with people, one a portrait with them at its left, Portrait Zoom 140 %
    'saver-tb-fade': ({'show': 'photos', 'time_behind': True, 'portrait_fill': False, 'portrait_zoom': 140, 'each_photo': 60}, 'tb-fade'),
    # 26 (2026-10-30): the photo options where they apply -- Clock on sharp photos offers Time Behind and draws it;
    # on Soft photos neither (left on from Photos, it couldn't be turned off from Clock)
    'saver-clockphotos': ({'show': 'clock', 'clock_bg': 'photos', 'time_behind': True}, 'clock-tb'),
    'saver-clocksoft': ({'show': 'clock', 'clock_bg': 'photos', 'clock_photo_soft': True, 'time_behind': True}, 'clock-soft'),
    # 2026-10-31: the light Day face's corners in dark ink (they were white on its near-white page), at a tablet and a
    # phone; Big Weather's corners never on its own words -- Home Status under its time, what plays on its bottom row
    # beside the readings, the same margin each side -- held sideways, upright and on a phone
    'saver-daylight': ({'show': 'day', 'day_look': 'light'}, 'day-ink'),
    'saver-bigcorners': ({'show': 'forecast', 'forecast_layout': 'big'}, 'big-corners'),
    # THE PLANTED NUMERALS (2026-11-01): Big Weather's time standing in the meadow -- its feet on the land's ground line,
    # the sun's shadow by day and none at night, the grass in front, clear of the readings and what plays
    'saver-planted': ({'show': 'forecast', 'forecast_layout': 'big', 'forecast_big': 'clock'}, 'planted'),
    # Settings' preview, just what is changing (2026-10-31): the screensaver alone in the frame on its pages, a change
    # shown in place, the screen again once they are left
    'saver-preview': ({'show': 'clock', 'clock_bg': 'gradient', 'clock_style': 'classic'}, 'preview'),
    # ...and on the Appearance pages the look alone: the screen with a few of its cards, a change there in moments
    'look-preview': ({'show': 'photos'}, 'look'),
    # THE SCREENSAVER EDITOR'S LAYOUTS (2026-11-01, docs/phase12/SCREENSAVER-EDITOR.md): a screen's saved layout -- a big
    # element, widgets in zones, the corner cards where the plan puts them -- drawn over its Show, at a tablet either way and
    # a phone: everything on the screen, nothing on anything else
    'saver-lay-lock': ({'show': 'forecast', 'layout': _layout({'kind': 'time', 'size': 26, 'pos': 'upper'},
                        line=['date'], row=['temp', 'aqi', 'timer', 'locks'], bl=['music_card'], tr=['status_card'])}, 'lay-lock'),
    # (the wall tablet: no photos for a new screen, so Photos falls back to the forecast, and the time must stand in front)
    'saver-lay-wall': ({'show': 'photos', 'layout': _layout({'kind': 'time', 'size': 40, 'pos': 'top', 'depth': 'behind'},
                        tl=['weather_card'], tr=['status_card'], bl=['music_card'], br=['timers_card'])}, 'lay-wall'),
    'saver-lay-planted': ({'show': 'forecast', 'clock_style': 'classic', 'layout': _layout(
                        {'kind': 'time', 'size': 40, 'pos': 'ground', 'align': 'left', 'depth': 'planted'},
                        tl=['weather_line'], tr=['status_card'], bl=['music_card'], bottom=['readings'])}, 'lay-planted'),
    'saver-lay-clock': ({'show': 'clock', 'clock_bg': 'aurora', 'clock_style': 'neon', 'layout': _layout(
                        {'kind': 'time', 'size': 30, 'pos': 'center'}, line=['date'], tl=['weather_card'], tr=['status_card'],
                        bl=['music_card'])}, 'lay-clock'),
    'saver-lay-month': ({'show': 'month', 'layout': _layout({'kind': 'month', 'size': 34, 'pos': 'center'}, tr=['clock_card'])}, 'lay-month'),
    # (behind the land, 2026-11-01: the land drawn again over the time, in a box the time's size)
    # (2026-11-01: a layout with the Battery widget held the page -- the house's wall tablets died and Settings froze --
    # the Energy page's sums waking the widget that had just read them, at once, forever; the row on two lines, along the
    # bottom, a card with Glass)
    'saver-lay-energy': ({'show': 'photos', 'layout': dict(_layout({'kind': 'time', 'size': 30, 'pos': 'top'},
                          row=['battery', 'inside', 'energy_today', 'solar', 'temp'], tr=['status_card']), row_at='bottom')}, 'lay-energy'),
    'saver-lay-behind': ({'show': 'forecast', 'layout': _layout({'kind': 'time', 'size': 34, 'pos': 'upper', 'depth': 'behind'},
                          tr=['status_card'])}, 'lay-behind'),
    # (UNDER A SLIDE, 2026-11-01, the owner's wall tablets: Time Behind with the date, the weather and what plays at the bottom
    # left, Home Status at the bottom right -- under the music the time was gone and the weather ran into Up Next. The
    # screensaver's own corners under it, the layout's again after it)
    'saver-lay-slides': ({'show': 'both', 'music_slide': True, 'music_first': True, 'forecast_layout': 'big',
                          'layout': _layout({'kind': 'time', 'size': 35, 'pos': 'top', 'depth': 'behind'}, tl=['date'],
                                            bl=['weather_card', 'music_card'], br=['status_card', 'timers_card'])}, 'lay-slides'),
    # BEHIND WITH ANY FACE (phase 13, phase 3): Photos, a layout's Neon time behind the drawn person -- the face itself, the
    # subject's twin over it, never Time Behind's own figures
    'saver-lay-tb': ({'show': 'photos', 'clock_style': 'neon', 'layout': _pieces({'kind': 'time', 'size': 30, 'pos': 'top', 'depth': 'behind'},
                      tl=['date.inline'], tr=['status.inline'])}, 'lay-tb'),
    # THE GLANCE CATALOG (phase 13, phase 1b; the plan's rule 7: every piece in this check at least once, at every size):
    # wave A -- the sky's four gauges and two more on two lines, Countdown above the time, the alert and the rest of today's
    # events in the top corners, another city's time and the sun at the bottom
    'saver-lay-glance-a': ({'show': 'forecast', 'layout': _pieces({'kind': 'time', 'size': 20, 'pos': 'top'},
                            line=['countdown.inline'], row=['uv.circular', 'wind.circular', 'pressure.circular', 'feels.circular',
                                                            'rain.rectangular', 'moon.circular', 'sun.circular'],
                            tl=['alert.card'], tr=['events.card'], bl=['world.inline'],
                            br=['sun.inline'])}, 'lay-pieces'),
    'saver-lay-glance-a2': ({'show': 'clock', 'clock_bg': 'aurora', 'layout': _pieces({'kind': 'time', 'size': 24, 'pos': 'upper'},
                             row=['world.rectangular', 'rain.circular', 'moon.circular', 'sun.rectangular', 'world.circular?city=America/New_York'],
                             tl=['moon.inline'], tr=['rain.inline'], bl=['alert.inline'], br=['events.rectangular'])}, 'lay-pieces'),
    # ...wave B: the house's state, its people, its energy, its music and its cameras
    'saver-lay-glance-b': ({'show': 'forecast', 'layout': _pieces({'kind': 'time', 'size': 20, 'pos': 'top'},
                            line=['security.inline'], row=['doors.circular', 'garage.circular', 'climate.circular', 'lights.circular',
                                                            'climate.rectangular', 'grid.circular', 'ev.circular'],
                            tl=['notify.inline', 'vacuum.inline'], tr=['who.rectangular'], bl=['upnext.inline', 'playin.inline'],
                            br=['package.inline', 'thisday.inline'])}, 'lay-pieces'),
    'saver-lay-glance-b2': ({'show': 'clock', 'clock_bg': 'aurora', 'layout': _pieces({'kind': 'time', 'size': 22, 'pos': 'upper'},
                             row=['security.circular', 'who.circular', 'doors.rectangular', 'notify.rectangular', 'camera.rectangular'],
                             tl=['ring.inline', 'garage.inline'], tr=['lights.inline', 'grid.inline'], bl=['camera.card'],
                             br=['ring.card'], line=['ev.inline'])}, 'lay-pieces'),
    'saver-lay-glance-b3': ({'show': 'photos', 'layout': _pieces({'kind': 'time', 'size': 22, 'pos': 'top'},
                             row=['vacuum.circular', 'package.circular', 'notify.circular', 'climate.circular', 'upnext.rectangular'],
                             tl=['climate.inline', 'doors.inline'], bl=['playin.inline'], bottom=[],
                             line=['who.inline'])}, 'lay-pieces'),
    # ...wave C: one entity picked (the suggested default, none being picked here), Any Sensor on a picked entity, the photo's title
    'saver-lay-glance-c': ({'show': 'photos', 'photo_titles': True, 'layout': _pieces({'kind': 'time', 'size': 22, 'pos': 'top'},
                            line=['title.inline'], row=['alarm.circular', 'trash.circular', 'pollen.circular', 'travel.circular',
                                                        'appliance.rectangular', 'sensor.circular?entity=lock.back_door'],
                            tl=['price.inline', 'travel.inline'], tr=['leak.inline', 'sensor.inline?entity=lock.front_door'],
                            bl=['appliance.inline', 'alarm.inline'], br=['leak.card'])}, 'lay-pieces'),
}


# EVERY LOOK, EVERY SLIDE, AT EVERY SIZE (phase 13, phase 6; the plan's "Done": saver_shows_check over every Look x slide x
# three sizes, phones not skipped): the editor's own Looks (hk-saver-editor.js LOOKS, applyLook + lookLayout -- so what is
# checked is what the owner picks), each with every slide on. One screen a Look steps through its slides with the editor's
# See a Slide (hkSaver.previewSlide); a second has the Forecast's Big layout, for the Forecast, Big slide
def look_shows():
    import subprocess
    jsc = Path('/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc')
    if not jsc.exists():
        return {}
    pre = ("var window = this; var HTMLElement = function () {}; var customElements = { get: function () { return null; }, define: function () {} };\n"
           f"load({json.dumps(str(ROOT / 'web/hk/modules/hk-saverlayout.js'))});\n"
           f"load({json.dumps(str(ROOT / 'web/hk/panels/hk-saver-editor.js'))});\n"
           "var E = window.hkSaverEditor;\n"
           "print(JSON.stringify(E.LOOKS.map(function (look) { var o = { show: 'photos', layout: E.lookLayout(look) }; E.applyLook(o, look, false); return [look.id, o]; })));\n")
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False) as f:
        f.write(pre)
    try:
        looks = json.loads(subprocess.run([str(jsc), f.name], capture_output=True, text=True, check=True, timeout=30).stdout)
    finally:
        os.unlink(f.name)
    out = {}
    for lid, o in looks:
        slides = dict(o, extra_music=True, weather_slide=True, energy_slide=True, extra_forecast=True)
        out[f'saver-look-{lid}'] = (slides, 'look-slides')
        out[f'saver-look-{lid}-fb'] = (dict(slides, forecast_layout='big'), 'look-fb')
    # (the Slides section's own settings, 2026-11-02: the corner's time at 200 % and no weather; Music Full Screen
    # without its album, volume and Up Next)
    for lid, o in looks:
        if lid == 'photo':
            out['saver-look-photo-own'] = (dict(o, extra_music=True, weather_slide=True, energy_slide=True, extra_forecast=True, corner_time_size=200,
                                                corner_hide=['weather'], music_hide=['album', 'volume', 'next']), 'look-slides')
    return out


SHOWS.update(look_shows())


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
        # (the fade's album: that photo again, and a portrait with its person at the left)
        async with http.post(base + '/api/photos/albums', json={'name': 'Two Ways'}, headers=h) as r:
            aid2 = (await r.json())['album']['id']
        im2 = Image.new('RGB', (900, 1200))
        d2 = ImageDraw.Draw(im2)
        for y in range(1200):
            d2.line([(0, y), (900, y)], fill=(int(120 + 80 * y / 1200), int(170 - 60 * y / 1200), int(210 - 110 * y / 1200)))
        d2.ellipse([150, 260, 370, 540], fill=(214, 168, 140))
        d2.rounded_rectangle([40, 600, 480, 1260], radius=110, fill=(110, 40, 60))
        buf2 = io.BytesIO(); im2.save(buf2, 'JPEG', quality=88)
        for name, data in (('person.jpg', buf.getvalue()), ('portrait.jpg', buf2.getvalue())):
            fd = FormData(); fd.add_field('file', data, filename=name, content_type='image/jpeg')
            async with http.post(base + f'/api/photos/albums/{aid2}/upload', data=fd, headers=h) as r:
                assert r.status == 201, await r.text()
        async with http.put(base + '/api/photos/screens/saver-tb-fade', json={'album': aid2}, headers=h) as r:
            assert r.status == 200, await r.text()


async def main():
    from aiohttp.test_utils import TestServer
    # (something for Home Status to say: the back door unlocked, the house's locks and alarm the status is made of)
    gallery.HOUSE['lock.back_door'] = ('kitchen', ('unlocked', {'friendly_name': 'Back Door'}))
    gallery.SETTINGS['settings']['security'] = {'alarm': 'alarm_control_panel.home', 'locks': ['lock.front_door', 'lock.back_door'],
                                                'doors': [], 'windows': [], 'garage': []}
    for name, (opts, _) in SHOWS.items():
        gallery.SETTINGS['boards'][name] = {'title': name, 'pages': [], 'headers': {'home': True}, 'menu_custom': True, 'menu': 'tabbar',
                                            'screensaver': True, 'screensaver_options': opts}
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td), real_model=True)
        async with TestServer(app) as server:
            await photos_for(server, cookie, ('saver-timebehind', 'saver-timebehind-today', 'saver-clockphotos', 'saver-clocksoft', 'saver-lay-slides', 'saver-lay-tb')
                             + tuple(k for k in SHOWS if k.startswith('saver-look-photo')))
            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
            proc = await asyncio.create_subprocess_exec(args.node, str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE,
                                                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=os.environ)
            out, err = await proc.communicate(json.dumps({'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie,
                                                          'shows': {k: v[1] for k, v in SHOWS.items()},
                                                          'shard': [shard, shards], 'only': args.only,
                                                          'shots': str(args.shots) if args.shots else None}).encode())
            print(out.decode())
            if err.strip():
                print(err.decode(), file=sys.stderr)
            return proc.returncode


# (guarded: the server's picture worker starts with spawn, which imports this file again as its main module -- unguarded,
# the whole check ran a second time inside the worker, 2026-11-01)
if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
