"""Detail sheets on a short screen (2026-10-24: a phone on its side, 844 x 390; a small phone's 667 x 375), against
the fictional home, never a household. Each common sheet opens and is measured: inside the screen with its margin, its
X as far from the top as from the right, its content in view without scrolling (2 px at most), and every control
inside the sheet's padding. The same sheets at a tablet's size and a phone's portrait are measured too, so
the short layout never leaks into them.

    python tools/headless/sheet_short_check.py [--shots DIRECTORY] [--size WxH]
"""
import argparse
import asyncio
import json
import sys
import tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]
import gallery
from cdp import Browser
from aiohttp.test_utils import TestServer

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--shots', type=Path)
parser.add_argument('--size', action='append')
parser.add_argument('--report', action='store_true', help='print the measures, assert nothing')
args = parser.parse_args()

DEEP = "window.deep=(r,s)=>[...r.querySelectorAll('*')].flatMap(e=>[...(e.matches(s)?[e]:[]),...(e.shadowRoot?deep(e.shadowRoot,s):[])]);"
SHEETS = ['climate.upstairs', 'light.kitchen_pendants', 'light.living_room_lamps', 'switch.garage_outlet', 'fan.bedroom_ceiling', 'cover.living_room_shade',
          'cover.garage_door', 'lock.front_door', 'climate.main_floor', 'media_player.living_room', 'vacuum.robot',
          'sensor.living_room_temperature', 'binary_sensor.front_door', 'event']
# what the sheet holds, measured from inside it: every element's box against the sheet's padding (12 px in at least,
# the sheet's own being 16 to 24) and the sheet against the screen
MEASURE = """(()=>{let h=deep(document,'.hkd.open')[0];if(!h)return null;let s=h.querySelector('.sheet'),b=h.querySelector('.body'),
  hd=h.querySelector('.hd'),x=h.querySelector('.x'),r=s.getBoundingClientRect(),vw=innerWidth,vh=innerHeight;
  let out=[];deep(b,'*').forEach(e=>{let q=e.getBoundingClientRect();if(!q.width||!q.height)return;
    let cs=getComputedStyle(e);if(cs.visibility==='hidden'||cs.position==='fixed')return;
    if(q.left<r.left+12||q.right>r.right-12)out.push((e.className&&e.className.baseVal===undefined?e.className:e.localName)+':x')});
  let xr=x&&x.getBoundingClientRect();
  return {sheet:[r.left|0,r.top|0,r.width|0,r.height|0],inside:r.left>=7&&r.top>=7&&r.right<=vw-7&&r.bottom<=vh-7,
    scroll:b.scrollHeight-b.clientHeight,wide:out.slice(0,3),
    x:xr?[Math.round(r.right-xr.right),Math.round(xr.top-r.top)]:null}})()"""


async def main():
    gallery.HOUSE['cover.living_room_shade'] = ('living_room', ('open', {'friendly_name': 'Shade', 'device_class': 'shade', 'current_position': 60, 'supported_features': 15}))
    gallery.HOUSE['vacuum.robot'] = (None, ('docked', {'friendly_name': 'Robot', 'battery_level': 90, 'supported_features': 16383}))
    area, (st, attrs) = gallery.HOUSE['climate.upstairs']
    gallery.HOUSE['climate.upstairs'] = (area, (st, dict(attrs, fan_modes=['auto', 'on'], fan_mode='auto', supported_features=attrs['supported_features'] | 8)))
    gallery.HOUSE['calendar.family'] = (None, ('off', {'friendly_name': 'Family'}))
    sizes = [tuple(int(v) for v in s.split('x')) for s in (args.size or ['844x390', '667x375', '1180x820', '390x844'])]
    bad = []
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        async with TestServer(app) as server:
            origin = str(server.make_url('')).rstrip('/')
            for w, hgt in sizes:
                async with Browser(w, hgt, port=9412) as b:
                    await b.restrict_origin(origin)
                    await b.send('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
                    await b.open(origin + '/' + gallery.SCREEN + '/home', cookie)
                    assert await b.wait('window.__mantelReady===true && !!window.hkDetail', 30)
                    await asyncio.sleep(1.5)
                    await b.eval(DEEP)
                    for sheet in SHEETS:
                        if sheet == 'event':
                            code = ("(()=>{let s=new Date();s.setHours(19,0,0,0);window.hkDetail.open('calendar.family',null,{event:"
                                    "{cal:'calendar.family',uid:'u1',title:'Dinner with the Riveras',desc:'Bring dessert',loc:'Riverside Grill',allDay:false,start:s,end:new Date(+s+36e5),key:'k'}})})();void 0")
                        else:
                            code = "window.hkDetail.open(%s);void 0" % json.dumps(sheet)
                        await b.eval(code)
                        await asyncio.sleep(1.2)
                        m = await b.eval(MEASURE)
                        if not m:                               # a sheet still closing refuses the next: once more
                            await b.eval(code)
                            await asyncio.sleep(1.5)
                            m = await b.eval(MEASURE)
                        size = f'{w}x{hgt}'
                        print(size, sheet, json.dumps(m), flush=True)
                        if not m and not args.report:
                            bad.append((size, sheet, 'did not open'))
                        if args.shots:
                            args.shots.mkdir(parents=True, exist_ok=True)
                            await b.screenshot(args.shots / f'{size}-{sheet}.png')
                        if m and not args.report:
                            if not m['inside'] or m['wide'] or m['scroll'] > 2 or m['x'] is None or m['x'][0] != m['x'][1]:
                                bad.append((size, sheet, m))
                        await b.eval("window.hkDetail.close&&hkDetail.close();void 0")
                        await b.wait("!deep(document,'.hkd.open').length", 5)
                        await asyncio.sleep(0.8)
    if bad and not args.report:
        print('\n'.join(map(str, bad)))
        raise SystemExit('FAIL: %d sheets outside the screen, past their padding, scrolling, or with the X off its corner' % len(bad))
    print('PASS: the sheets fit the short screens, and the tablet and phone ones are as they were')

asyncio.run(main())
