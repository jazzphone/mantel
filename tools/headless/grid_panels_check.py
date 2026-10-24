"""Home Grid's page panels as blocks (2026-10-24) against the fictional home, never a household's: Power (the status
in sentences at Wide, the house picture or flow chart at Large), Music (the speaker picker), Doors & Locks (the house
with its ways in), an Extra Large thermostat (its full controls), Live TV and Water each draw inside their block, and
a block whose feature isn't set up says where to set it up. The Clock block draws a screensaver face without its box,
and HK's own clock at Small, on a phone held sideways, beside an icon-only tab bar rail that leaves the grid the
screen's full height.

    python tools/headless/grid_panels_check.py [--shots DIRECTORY]
"""
import argparse
import asyncio
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
args = parser.parse_args()

DEEP = "window.deep=(r,s)=>[...r.querySelectorAll('*')].flatMap(e=>[...(e.matches(s)?[e]:[]),...(e.shadowRoot?deep(e.shadowRoot,s):[])]);" \
       "window.cell=(id)=>deep(document,'.cell[data-id=\"'+id+'\"]')[0];"
BIG = {'v': 1, 'cols': 6, 'rows': 4, 'frame': [1280, 800], 'band': True, 'items': [
    {'id': 'thermo', 'card': 'thermostat', 'size': 'XL', 'at': [0, 0]},
    {'id': 'power', 'card': 'power', 'size': 'L', 'at': [3, 0]},
    {'id': 'doors', 'card': 'doors', 'size': 'L', 'at': [0, 2]},
    {'id': 'music', 'card': 'music', 'size': 'L', 'at': [2, 2]},
    {'id': 'tv', 'card': 'live_tv', 'size': 'L', 'at': [4, 2]}]}
SMALL = {'v': 1, 'cols': 6, 'rows': 4, 'frame': [1280, 800], 'band': True, 'items': [
    {'id': 'power', 'card': 'power', 'size': 'W', 'at': [0, 0]},
    {'id': 'water', 'card': 'water', 'size': 'XL', 'at': [0, 1]},
    {'id': 'doors', 'card': 'doors', 'size': 'XL', 'at': [3, 1]}]}
# the Energy feature's power plan, as Settings keeps it (features/energy/power.py)
POWER = {'grid': 'sensor.grid_power', 'home': 'sensor.home_power', 'solar': 'sensor.solar_power', 'grid_status': 'binary_sensor.grid_status',
         'picture': True, 'art': '/hk/power-house/', 'battery': {'level': 'sensor.battery_level', 'charge': 'sensor.battery_charge', 'discharge': 'sensor.battery_discharge'}}
STUB = """(()=>{let g=hkSettings.get.bind(hkSettings),P=%s;
  hkSettings.get=(k,d)=>k==='added'?(g('added',[])||[]).concat(['energy','live_tv']):k==='energy'?{power:P}:k==='headers'?Object.assign({},g('headers',{}),{water:{meter:'sensor.water_meter',supply:'valve.main_water'}}):g(k,d);
  deep(document,'hk-grid-panel-card').forEach(c=>c.redraw());void 0})()"""


async def main():
    import json
    for k, v in {'sensor.grid_power': 1200, 'sensor.home_power': 2400, 'sensor.solar_power': 1500, 'sensor.battery_charge': 0,
                 'sensor.battery_discharge': 300}.items():
        gallery.HOUSE[k] = (None, (str(v), {'friendly_name': k.split('.')[1].replace('_', ' ').title(), 'unit_of_measurement': 'W', 'device_class': 'power'}))
    area, (st, attrs) = gallery.HOUSE['climate.main_floor']
    gallery.HOUSE['climate.main_floor'] = (area, (st, dict(attrs, fan_modes=['auto', 'on'], fan_mode='auto', supported_features=attrs['supported_features'] | 8)))
    gallery.HOUSE['sensor.battery_level'] = (None, ('76', {'friendly_name': 'Battery', 'unit_of_measurement': '%', 'device_class': 'battery'}))
    gallery.HOUSE['binary_sensor.grid_status'] = (None, ('on', {'friendly_name': 'Grid', 'device_class': 'power'}))
    gallery.HOUSE['sensor.water_meter'] = (None, ('1234.5', {'friendly_name': 'Water Meter', 'unit_of_measurement': 'gal', 'device_class': 'water', 'state_class': 'total_increasing'}))
    gallery.HOUSE['valve.main_water'] = (None, ('open', {'friendly_name': 'Main Water', 'device_class': 'water', 'supported_features': 3}))
    gallery.HOUSE['calendar.family'] = (None, ('off', {'friendly_name': 'Family'}))
    gallery.SETTINGS['boards']['night'] = {'home_style': 'grid', 'menu_custom': True, 'menu': 'tabbar', 'tab_bar_pos': 'left', 'tab_bar_labels': 'icons', 'home_grid': {
        'v': 1, 'cols': 3, 'rows': 2, 'frame': [844, 390], 'band': False, 'boxes': False, 'grow': True, 'items': [
            {'id': 'big', 'card': 'clock', 'size': 'L', 'at': [0, 0], 'opts': {'clock_style': 'classic', 'bare': True}},
            {'id': 'small', 'card': 'clock', 'size': 'S', 'at': [2, 0]}]}}
    # Big Temperature and Month View, StandBy's (a Tall weather block is always the big number)
    gallery.SETTINGS['boards']['standby'] = {'home_style': 'grid', 'menu_custom': True, 'menu': 'tabbar', 'home_grid': {
        'v': 1, 'cols': 3, 'rows': 2, 'frame': [844, 390], 'band': False, 'boxes': False, 'grow': True, 'night': {'mode': 'always'}, 'items': [
            {'id': 'wx', 'card': 'weather', 'size': 'T', 'at': [0, 0]},
            {'id': 'cal', 'card': 'calendar', 'size': 'L', 'at': [1, 0], 'opts': {'month': True}}]}}
    gallery.SETTINGS['boards']['panels'] = {'home_style': 'grid', 'home_grid': BIG, 'menu_custom': True, 'menu': 'tabbar'}
    gallery.SETTINGS['boards']['panels2'] = {'home_style': 'grid', 'home_grid': SMALL, 'menu_custom': True, 'menu': 'tabbar'}
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        async with TestServer(app) as server, Browser(1280, 800, port=9405) as b:
            origin = str(server.make_url('')).rstrip('/')
            await b.restrict_origin(origin)
            for screen, ids in (('panels', ['thermo', 'power', 'doors', 'music', 'tv']), ('panels2', ['power', 'water', 'doors'])):
                await b.open(origin + '/' + screen + '/home', cookie)
                assert await b.wait('window.__mantelReady===true', 30), [l for l in b.console if 'EXCEPTION' in l or 'rror' in l][:5]
                await b.eval(DEEP)
                assert await b.wait("deep(document,'hk-grid-panel-card').length>=%d" % len(ids), 20), screen
                await asyncio.sleep(1)
                if screen == 'panels2':
                    # nothing set up: each block says where
                    empty = await b.eval("deep(cell('power'),'.empty').map(e=>e.textContent)")
                    assert empty and 'Energy' in empty[0], empty
                await b.eval(STUB % json.dumps(POWER))
                await asyncio.sleep(2.5)
                if screen == 'panels':
                    # Live TV's channels (the integration's list, stood in): tiles that scroll inside the block
                    await b.eval("(()=>{let t=deep(cell('tv'),'hk-tv-guide-card')[0];t._configured=true;"
                                 "t._channels=[1,2,3,4,5].map(i=>({name:'Channel '+i,number:i+'.1',now:null}));t._hkSig=null;t.redraw();void 0})()")
                    await asyncio.sleep(0.5)
                    assert await b.eval("deep(cell('tv'),'hk-tv-guide-card')[0].shadowRoot.querySelectorAll('.tv-grid > *').length") == 5
                # every block's parts stay inside it
                got = await b.eval("""(()=>{let out={};%s.forEach(id=>{let c=cell(id),r=c.getBoundingClientRect(),p=deep(c,'hk-grid-panel-card')[0],
                  kids=[...p.shadowRoot.querySelectorAll('.part > *')];
                  out[id]={kids:kids.map(k=>k.localName),empty:!!p.shadowRoot.querySelector('.empty'),
                    inside:kids.every(k=>{let q=k.getBoundingClientRect();return q.width>0&&q.height>0&&q.bottom<=r.bottom+2&&q.right<=r.right+2&&q.top>=r.top-2})}});
                  return out})()""" % json.dumps(ids))
                assert all(not g['empty'] and g['kids'] for g in got.values()), got
                # what scrolls inside its own plate (Music's speakers, Live TV's channels) may run past it; the rest fit
                assert all(g['inside'] for k, g in got.items() if k not in ('music', 'tv')), got
                if screen == 'panels':
                    assert got['thermo']['kids'] == ['hk-control-card', 'div'] and got['power']['kids'] == ['hk-power-house-card'], got
                    # the thermostat's modes and fan beside its dial, the current ones pressed
                    pressed = await b.eval("[...deep(cell('thermo'),'hk-grid-panel-card')[0].shadowRoot.querySelectorAll('.rd button[aria-pressed=\"true\"]')].map(x=>x.textContent)")
                    assert pressed == ['Auto', 'Auto'], pressed
                else:
                    assert got['water']['kids'] == ['hk-water-day-card', 'hk-water-supply-card'] and got['power']['kids'] == ['hk-power-status-card'], got
                if args.shots:
                    args.shots.mkdir(parents=True, exist_ok=True)
                    await b.screenshot(args.shots / f'{screen}.png')
            # THE CLOCK BLOCK on a phone on its side (Phone, Landscape: 3 x 2, the tab bar at the left): a screensaver
            # face on the wallpaper with no box, filling its block (StandBy's digits), and HK's own clock, boxed, at Small
            await b.send('Emulation.setDeviceMetricsOverride', width=844, height=390, deviceScaleFactor=1, mobile=False)
            await b.open(origin + '/night/home', cookie)
            assert await b.wait('window.__mantelReady===true', 30)
            await b.eval(DEEP)
            assert await b.wait("deep(cell('big'),'.ckroot .face.f-classic').length===1", 15)
            ck = await b.eval("""(()=>{let c=cell('big'),k=deep(c,'.ck')[0],r=c.getBoundingClientRect(),f=deep(c,'.face')[0].firstElementChild.getBoundingClientRect(),
              s=cell('small'),sr=s.getBoundingClientRect(),t=deep(s,'[data-hk-clock=clock]')[0];
              return {plate:k.classList.contains('plate'),inside:f.width>0&&f.left>=r.left-1&&f.right<=r.right+1&&f.top>=r.top-1&&f.bottom<=r.bottom+1,fills:f.width>r.width*0.6,
                      small:!!t&&t.getBoundingClientRect().right<=sr.right+1}})()""")
            assert ck == {'plate': False, 'inside': True, 'fills': True, 'small': True}, ck
            # Show Boxes off: the small clock's box is clear and out of the shared blur, on its block's cell
            box = await b.eval("""(()=>{let s=cell('small'),p=deep(s,'hk-plate.clock')[0],cs=getComputedStyle(p);
              return [s.hasAttribute('data-bare'),cs.backgroundColor,cs.boxShadow,cs.getPropertyValue('--hk-glass-surface').trim()]})()""")
            assert box == [True, 'rgba(0, 0, 0, 0)', 'none', '0'], box
            # the tab bar's Icons Only: a rail of icons, each tab still named for a screen reader; the grid keeps the
            # screen's full height beside it
            tabs = await b.eval("""(()=>{let t=deep(document,'.tab');return t.map(x=>[getComputedStyle(x.querySelector('span')).display,x.getAttribute('aria-label')])})()""")
            assert tabs and all(d == 'none' and n for d, n in tabs), tabs
            v = await b.eval("(()=>{let r=deep(document,'hk-home-grid-view')[0].getBoundingClientRect();return [r.top,r.bottom]})()")
            assert v == [0, 390], v
            if args.shots:
                await b.screenshot(args.shots / 'night.png')
            await b.open(origin + '/standby/home', cookie)
            assert await b.wait('window.__mantelReady===true', 30)
            await b.eval(DEEP)
            assert await b.wait("deep(cell('cal'),'.md').length>=28 && deep(cell('wx'),'.wb.big .bn').length===1", 15)
            sb = await b.eval("""(()=>{let c=cell('cal'),r=c.getBoundingClientRect(),now=deep(c,'.md.now')[0],days=deep(c,'.md:not(.out)'),
              n=deep(cell('wx'),'.bn')[0];
              return {today:+now.textContent===new Date().getDate(),days:days.length===new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate(),
                inside:days.every(d=>{let q=d.getBoundingClientRect();return q.bottom<=r.bottom+1&&q.right<=r.right+1}),
                big:parseFloat(getComputedStyle(n).fontSize)>=3*parseFloat(getComputedStyle(deep(cell('wx'),'.place-name')[0]).fontSize)}})()""")
            assert sb == {'today': True, 'days': True, 'inside': True, 'big': True}, sb
            if args.shots:
                await b.screenshot(args.shots / 'standby.png')
            # Night Mode (Always here): the page black, one red wash over everything; today's number black on its circle
            night = await b.eval("""(()=>{let w=document.getElementById('hk-night-wash'),sky=document.getElementById('hk-sky');
              return [document.documentElement.hasAttribute('hk-night'),!!w&&getComputedStyle(w).mixBlendMode,!sky||getComputedStyle(sky).visibility,
                      getComputedStyle(deep(cell('cal'),'.md.now')[0]).color]})()""")
            assert night == [True, 'multiply', 'hidden', 'rgb(0, 0, 0)'], night
            # a day in Month View opens that day on the Calendar page
            day = await b.eval("(()=>{let d=deep(cell('cal'),'.md[data-ymd]')[9];d.click();return d.getAttribute('data-ymd')})()")
            assert await b.wait("location.pathname.endsWith('/calendar') && location.search.includes('day=%s')" % day, 10), await b.eval('location.href')
            # ...and leaving Home lets the night go
            assert await b.wait("!document.documentElement.hasAttribute('hk-night') && !document.getElementById('hk-night-wash')", 10)
            exceptions = [line for line in b.console if line.startswith('EXCEPTION:')]
            assert not exceptions, exceptions
            print('PASS: power, music, doors & locks, the thermostat\'s full controls, Live TV and water as blocks, the clock faces, Big Temperature, Month View and Night Mode')

asyncio.run(main())
