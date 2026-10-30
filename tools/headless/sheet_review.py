"""Every detail sheet at every screen size, in WebKit (Safari's engine), measured and shot.

    PLAYWRIGHT_PATH=... python tools/headless/sheet_review.py [--shots DIRECTORY] [--size WxH ...] [--only ID ...] [--report]
        [--look bright [--wallpaper ID]]

Opens each panel kind (and the variants that draw differently: a light that only
dims or only switches, a heat-only thermostat, media with nothing playing...)
on a fictional house at the phone, tablet and car sizes, and measures from
inside each sheet:

- the sheet inside the screen, nothing scrolling, nothing in its padding;
- the X as far from the top as from the right;
- what it draws as far from the left as from the right (3 px), and, on the
  short screens where the control is centred, from the top as from the bottom;
- no control under 30 pt in either direction (the X and the segments included).

With --shots, a screenshot of each and a contact sheet per size
(contact-WxH.png) to look over. It fails on any sheet past those lines,
unless --report.

--look bright (2026-10-30): the house in Bright Glass over a Wallpaper (Rose
Ribbons, or --wallpaper's), the sheets' frost stood in by Bright Glass's sheet
plate over the wallpaper's middle stops.
"""
import argparse, asyncio, json, os, sys, tempfile, time
from datetime import datetime, timezone
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]
import gallery
from aiohttp.test_utils import TestServer

ap = argparse.ArgumentParser()
ap.add_argument('--shots', type=Path)
ap.add_argument('--size', action='append')
ap.add_argument('--only', action='append')
ap.add_argument('--report', action='store_true')
ap.add_argument('--look', choices=['bright'])
ap.add_argument('--wallpaper', default='ribbons_rose')
args = ap.parse_args()

# phone upright (small, common), phone on its side (small, common), iPad upright and on its side, the large iPad, the car
SIZES = ['375x667', '390x844', '667x375', '844x390', '820x1180', '1180x820', '1366x1024', '1280x720']
NOW = gallery.NOW

# entity_id -> (area, (state, attributes)): what the gallery's house lacks for a sheet of every kind
EXTRA = {
    'light.bedroom_reading': ('bedroom', ('on', {'friendly_name': 'Reading Light', 'brightness': 150, 'color_mode': 'color_temp',
                                                 'supported_color_modes': ['color_temp'], 'color_temp_kelvin': 3000,
                                                 'min_color_temp_kelvin': 2200, 'max_color_temp_kelvin': 6500})),
    'cover.living_room_shade': ('living_room', ('open', {'friendly_name': 'Shade', 'device_class': 'shade', 'current_position': 60, 'supported_features': 15})),
    'cover.patio_awning': (None, ('open', {'friendly_name': 'Awning', 'device_class': 'awning', 'supported_features': 3})),
    'climate.office': ('office', ('heat', {'friendly_name': 'Office', 'hvac_modes': ['off', 'heat'], 'hvac_action': 'heating',
                                          'temperature': 68, 'current_temperature': 66, 'min_temp': 50, 'max_temp': 90, 'supported_features': 1})),
    'sensor.washer_status': (None, ('Rinsing', {'friendly_name': 'Washer'})),
    'vacuum.robot': (None, ('docked', {'friendly_name': 'Robot', 'battery_level': 90, 'supported_features': 16383})),
    'humidifier.bedroom': ('bedroom', ('on', {'friendly_name': 'Humidifier', 'device_class': 'humidifier', 'humidity': 45,
                                              'current_humidity': 38, 'min_humidity': 30, 'max_humidity': 60, 'mode': 'normal',
                                              'available_modes': ['normal', 'sleep', 'auto'], 'action': 'humidifying', 'supported_features': 1})),
    'water_heater.tank': (None, ('eco', {'friendly_name': 'Water Heater', 'temperature': 120, 'current_temperature': 118,
                                         'min_temp': 95, 'max_temp': 140, 'operation_mode': 'eco',
                                         'operation_list': ['eco', 'electric', 'performance', 'off'], 'supported_features': 3})),
    'valve.sprinkler': (None, ('closed', {'friendly_name': 'Sprinkler', 'device_class': 'water', 'supported_features': 3})),
    'valve.main_water': (None, ('open', {'friendly_name': 'Main Water', 'device_class': 'water', 'current_position': 100, 'supported_features': 7})),
    'input_number.speaker_volume': (None, ('40', {'friendly_name': 'Speaker Volume', 'min': 0, 'max': 100, 'step': 5, 'mode': 'slider',
                                                 'unit_of_measurement': '%'})),
    'input_select.house_mode': (None, ('Home', {'friendly_name': 'House Mode', 'options': ['Home', 'Away', 'Night', 'Vacation']})),
    'button.restart_router': (None, ('unknown', {'friendly_name': 'Restart Router', 'device_class': 'restart'})),
    'automation.porch_lights': (None, ('on', {'friendly_name': 'Porch Lights at Sunset', 'last_triggered': '2026-10-24T18:12:00+00:00', 'mode': 'single'})),
    'timer.laundry': (None, ('active', {'friendly_name': 'Laundry', 'duration': '0:45:00', 'remaining': '0:30:00',
                                        'finishes_at': datetime.fromtimestamp(time.time() + 1800, timezone.utc).isoformat()})),
    'calendar.family': (None, ('off', {'friendly_name': 'Family'})),
}

# (name, entity or 'event'): one of each panel kind, and the variants that draw differently
SHEETS = [
    ('light-color', 'light.living_room_lamps'), ('light-dim', 'light.kitchen_pendants'), ('light-white', 'light.bedroom_reading'),
    ('light-onoff', 'light.living_room_ceiling'), ('switch', 'switch.garage_outlet'), ('fan', 'fan.bedroom_ceiling'),
    ('shade', 'cover.living_room_shade'), ('awning', 'cover.patio_awning'), ('garage', 'cover.garage_door'), ('lock', 'lock.front_door'),
    ('climate-range', 'climate.main_floor'), ('climate-fan', 'climate.upstairs'), ('climate-heat', 'climate.office'),
    ('media-playing', 'media_player.living_room'), ('media-idle', 'media_player.kitchen'),
    ('sensor', 'sensor.living_room_temperature'), ('state', 'sensor.washer_status'), ('door', 'binary_sensor.front_door'),
    ('motion', 'binary_sensor.porch_motion'), ('vacuum', 'vacuum.robot'), ('humidifier', 'humidifier.bedroom'),
    ('water-heater', 'water_heater.tank'), ('valve', 'valve.sprinkler'), ('valve-position', 'valve.main_water'),
    ('number', 'input_number.speaker_volume'), ('select', 'input_select.house_mode'), ('button', 'button.restart_router'),
    ('alarm', 'alarm_control_panel.home'), ('camera', 'camera.front_door'), ('person', 'person.sam'), ('weather', 'weather.home'),
    ('automation', 'automation.porch_lights'), ('timer', 'timer.laundry'), ('event', 'event'),
]


# sheets that scroll by design: the weather's hours and days run on, as Apple's Weather does
SCROLLS = {'weather'}


def faults(size, m, name=''):
    """What is wrong with one sheet's numbers (an empty list: nothing)."""
    w, h = (int(v) for v in size.split('x'))
    out = []
    if not m['inside']:
        out.append('off the screen')
    if m['scroll'] > 2 and name not in SCROLLS:
        out.append('scrolls %d' % m['scroll'])
    if m['wide']:
        out.append('in the padding: ' + ', '.join(m['wide']))
    if m['x'] and abs(m['x'][0] - m['x'][1]) > 1:
        out.append('X %s' % m['x'])
    # (4: a colour light's labels step in 4 px to share their edge with the circles' ring room)
    if m['lr'] is not None and abs(m['lr'][0] - m['lr'][1]) > 4:
        out.append('left/right %s' % m['lr'])
    # (10: the thermostat's ring and the alarm's word sit a line's leading below the body's top)
    if h <= 500 and w > h and m['tb'] is not None and abs(m['tb'][0] - m['tb'][1]) > 10:
        out.append('top/bottom %s' % m['tb'])
    if m['small']:
        out.append('under 30: ' + ', '.join(m['small']))
    return out


def contact(shots: Path, size: str, names):
    from PIL import Image, ImageDraw
    w, h = (int(v) for v in size.split('x'))
    k = 300 / max(w, h)
    tw, th = int(w * k), int(h * k)
    cols = 6 if w < h else 4
    rows = -(-len(names) // cols)
    sheet = Image.new('RGB', (cols * (tw + 8) + 8, rows * (th + 26) + 8), (40, 40, 44))
    d = ImageDraw.Draw(sheet)
    for i, n in enumerate(names):
        p = shots / f'{size}-{n}.png'
        if not p.exists():
            continue
        x, y = 8 + (i % cols) * (tw + 8), 8 + (i // cols) * (th + 26)
        sheet.paste(Image.open(p).convert('RGB').resize((tw, th)), (x, y + 18))
        d.text((x, y + 2), n, fill=(230, 230, 230))
    sheet.save(shots / f'contact-{size}.png')


async def main():
    gallery.HOUSE.update(EXTRA)
    if args.look == 'bright':
        gallery.SETTINGS['settings']['look'] = {'glass': 'bright'}
        gallery.SETTINGS['settings']['sky'] = {'background': 'wallpaper', 'wallpaper': args.wallpaper}
    sheets = [s for s in SHEETS if not args.only or s[0] in args.only]
    sizes = args.size or SIZES
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(
                os.environ.get('NODE', 'node'), str(Path(__file__).with_suffix('.cjs')),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
            out, _ = await proc.communicate(json.dumps({
                'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'screen': gallery.SCREEN,
                'sheets': sheets, 'sizes': sizes, 'shots': str(args.shots) if args.shots else None, 'look': args.look}).encode())
    bad, seen = [], 0
    for line in out.decode().splitlines():
        if not line.startswith('{'):
            print(line)
            continue
        r = json.loads(line)
        seen += 1
        f = ['did not open'] if not r['m'] else faults(r['size'], r['m'], r['name'])
        print(r['size'], r['name'], '--' if not f else '; '.join(f), flush=True)
        if f:
            bad.append((r['size'], r['name'], f))
    if args.shots:
        for size in sizes:
            contact(args.shots, size, [n for n, _ in sheets])
    if proc.returncode or seen != len(sheets) * len(sizes):
        raise SystemExit('FAIL: the browser stopped after %d of %d sheets' % (seen, len(sheets) * len(sizes)))
    if bad and not args.report:
        raise SystemExit('FAIL: %d of %d sheets' % (len(bad), seen))
    print('%s: %d sheets, %d kinds at %d sizes' % ('REPORT' if bad else 'PASS', seen, len(sheets), len(sizes)))

asyncio.run(main())
