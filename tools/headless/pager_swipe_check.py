"""How reliably a touch swipe turns a Home Grid block's page, against the fictional home, never a household.

Real touch input (CDP Input.dispatchTouchEvent) in headless Chrome at 1280 x 800. Every paged block -- rooms,
cameras, scenes, an accessory group, thermostats -- is swiped left and right from a grid of starting points across
the block (on pills, on their names, on gaps, on a camera's picture). A swipe passes when the block lands on the next
page, and a swipe back lands where it started. Points on the thermostat's dial are the dial's own (it owns its drag)
and are left out.

    python tools/headless/pager_swipe_check.py [--fast] [--report]
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
parser.add_argument('--fast', action='store_true', help='quick flicks only (no slow drags)')
parser.add_argument('--report', action='store_true', help='print every miss')
args = parser.parse_args()

ACC = ['light.living_room_lamps', 'light.living_room_ceiling', 'light.kitchen_pendants', 'light.kitchen_cabinets',
       'light.dining_chandelier', 'light.office_desk', 'fan.bedroom_ceiling', 'switch.garage_outlet']
SCENES = ['scene.good_morning', 'scene.movie_night', 'scene.dinner', 'scene.good_night']
GRID = {'v': 1, 'cols': 6, 'rows': 4, 'frame': [1280, 800], 'band': True, 'items': [
    {'id': 'room', 'card': 'room', 'size': 'L', 'at': [0, 0], 'pages': {'source': 'rooms'}},
    {'id': 'camera', 'card': 'camera', 'size': 'L', 'at': [2, 0], 'pages': {'source': 'cameras'}},
    {'id': 'thermo', 'card': 'thermostat', 'size': 'T', 'at': [4, 0], 'pages': {'source': 'thermostats'}},
    {'id': 'roomw', 'card': 'room', 'size': 'W', 'at': [0, 2], 'pages': {'source': 'rooms'}},
    {'id': 'scenes', 'card': 'scenes', 'size': 'W', 'at': [0, 3],
     'pages': {'source': 'list', 'list': [{'opts': {'scenes': SCENES[:2]}}, {'opts': {'scenes': SCENES[2:]}}]}},
    {'id': 'acc', 'card': 'accessories', 'size': 'L', 'at': [2, 2], 'opts': {'accessories': [{'entity': e} for e in ACC]},
     'pages': {'source': 'accessories'}},
    {'id': 'roomscroll', 'card': 'room', 'size': 'L', 'at': [4, 2], 'opts': {'accessory_display': 'scroll'},
     'pages': {'source': 'rooms'}}]}

FIND = """window.deep=(r,s)=>[...r.querySelectorAll('*')].flatMap(e=>[...(e.matches(s)?[e]:[]),...(e.shadowRoot?deep(e.shadowRoot,s):[])]);
window.pagerOf=(id)=>deep(document,'.cell[data-id="'+id+'"]')[0].querySelector('hk-pager-card');"""


async def swipe(b, x, y, dx, steps, ms):
    await b.send('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{'x': x, 'y': y}])
    for i in range(1, steps + 1):
        await asyncio.sleep(ms / 1000)
        await b.send('Input.dispatchTouchEvent', type='touchMove', touchPoints=[{'x': x + dx * i / steps, 'y': y + i * 0.4}])
    await b.send('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])


async def main():
    screen = 'pager-swipes'
    for i in range(6):                        # enough in the first room for its list to scroll
        gallery.HOUSE[f'light.dining_room_extra_{i}'] = ('dining_room', gallery._light(f'Extra {i}', False, 0))
    gallery.SETTINGS['boards'][screen] = {'home_style': 'grid', 'home_grid': GRID, 'menu_custom': True, 'menu': 'tabbar'}
    misses, total = [], 0
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        async with TestServer(app) as server, Browser(1280, 800, port=9395) as b:
            origin = str(server.make_url('')).rstrip('/')
            await b.restrict_origin(origin)
            await b.send('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
            await b.send('Page.bringToFront')
            await b.send('Emulation.setFocusEmulationEnabled', enabled=True)
            await b.open(origin + '/' + screen + '/home', cookie)
            assert await b.wait('window.__mantelReady===true', 30)
            await b.eval(FIND)
            ids = [it['id'] for it in GRID['items']]
            assert await b.wait('[' + ','.join(f"pagerOf('{i}')?._pages?.length>1" for i in ids) + '].every(Boolean)', 20)
            await asyncio.sleep(1.5)
            kinds = [('flick', 6, 12, 170)] + ([] if args.fast else [('drag', 18, 25, 150), ('short', 8, 16, 90)])
            for bid in ids:
                box = await b.eval(f"(()=>{{let r=pagerOf('{bid}').getBoundingClientRect();return [r.x,r.y,r.width,r.height]}})()")
                for fx in (0.25, 0.5, 0.75):
                    for fy in (0.12, 0.35, 0.6, 0.82):
                        x, y = box[0] + box[2] * fx, box[1] + box[3] * fy
                        if bid == 'thermo' and 0.2 < fy < 0.85:
                            continue                      # the dial owns its own drag
                        for name, steps, ms, dist in kinds:
                            # every swipe starts and ends inside the block
                            dist = min(dist, box[2] * 0.6, 2 * min(x - box[0], box[0] + box[2] - x) - 12)
                            before = await b.eval(f"pagerOf('{bid}')._index")
                            await swipe(b, x + dist / 2, y, -dist, steps, ms)
                            await asyncio.sleep(0.9)
                            after = await b.eval(f"pagerOf('{bid}')._index")
                            await swipe(b, x - dist / 2, y, dist, steps, ms)
                            await asyncio.sleep(0.9)
                            back = await b.eval(f"pagerOf('{bid}')._index")
                            total += 1
                            what = await b.eval(f"(()=>{{let e=document.elementFromPoint({x},{y});while(e&&e.shadowRoot){{let n=e.shadowRoot.elementFromPoint({x},{y});if(!n||n===e)break;e=n}}return e?(e.localName+'.'+[...e.classList].join('.')):'-'}})()")
                            if after != before + 1 or back != before:
                                misses.append((bid, name, round(fx, 2), round(fy, 2), what, before, after, back))
                            # a tap may have toggled something: no matter, only the page is measured
            # ---- what must still work around the swipe
            async def tap(x, y, hold=0.0, dy=0):
                await b.send('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{'x': x, 'y': y}])
                await asyncio.sleep(hold)
                for i in range(1, 6 if dy else 1):
                    await b.send('Input.dispatchTouchEvent', type='touchMove', touchPoints=[{'x': x, 'y': y + dy * i / 5}])
                    await asyncio.sleep(0.03)
                await b.send('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
                await asyncio.sleep(0.6)
            # a light in the room block: a tap toggles it, a swipe across it doesn't, a hold and drag dims it
            await b.eval("window.room=pagerOf('room')._els[pagerOf('room')._index];window.calls=[];"
                         "deep(room.shadowRoot,'*').concat([room]).forEach(e=>{if(e._call)e._call=(...a)=>{calls.push(a);return Promise.resolve(true)}});"
                         "window.slot=room.shadowRoot.querySelector('.slot');window.cardCalls=()=>calls.length")
            sx, sy = await b.eval("(()=>{let r=slot.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()")
            start = await b.eval("pagerOf('room')._index")
            await tap(sx, sy)
            checks = {'a tap on a light reaches it': await b.eval('calls.length') == 1}
            await b.eval('calls.length=0')
            await swipe(b, sx + 40, sy, -80, 6, 12)
            await asyncio.sleep(0.9)
            checks['a swipe across a light turns the page and sends nothing'] = (
                await b.eval("pagerOf('room')._index") == start + 1 and await b.eval('calls.length') == 0)
            await b.eval("pagerOf('room').goTo(%d,false)" % start)
            await asyncio.sleep(0.5)
            await b.eval("window.room=pagerOf('room')._els[pagerOf('room')._index];window.calls=[];"
                         "room._call=(...a)=>{calls.push(a);return Promise.resolve(true)};window.slot=room.shadowRoot.querySelector('.slot')")
            sx, sy = await b.eval("(()=>{let r=slot.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()")
            await tap(sx, sy, hold=0.6, dy=-40)
            checks['press, hold and drag dims the light, page unchanged'] = (
                await b.eval("calls.length===1&&calls[0][0]==='light'&&!!calls[0][2].brightness_pct") and
                await b.eval("pagerOf('room')._index") == start)
            # a room that scrolls still scrolls up and down
            await b.eval("window.list=pagerOf('roomscroll')._els[pagerOf('roomscroll')._index].shadowRoot.querySelector('.tiles')")
            lx, ly = await b.eval("(()=>{let r=list.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height-20]})()")
            page0 = await b.eval("pagerOf('roomscroll')._index")
            await tap(lx, ly, dy=-120)
            checks['a room list scrolls up and down without turning'] = (
                await b.eval('list.scrollTop') > 20 and await b.eval("pagerOf('roomscroll')._index") == page0)
            # the dots: a tap on a dot goes there, a swipe on them turns the page
            await b.eval("pagerOf('camera').goTo(0,false)")
            dx_, dy_ = await b.eval("(()=>{let d=pagerOf('camera').shadowRoot.querySelectorAll('.dot')[1].getBoundingClientRect();return [d.x+d.width/2,d.y+d.height-8]})()")
            await tap(dx_, dy_)
            checks['a tap on the second dot goes to page 2'] = await b.eval("pagerOf('camera')._index") == 1
            px, py = await b.eval("(()=>{let r=pagerOf('scenes').shadowRoot.querySelector('.pc').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height-10]})()")
            await b.eval("pagerOf('scenes').goTo(0,false)")
            await swipe(b, px + 30, py, -60, 6, 12)
            await asyncio.sleep(0.9)
            checks['a swipe that starts on the dots turns the page'] = await b.eval("pagerOf('scenes')._index") == 1
            # a mouse drag on a desktop
            await b.send('Emulation.setTouchEmulationEnabled', enabled=False)
            await b.eval("pagerOf('acc').goTo(0,false)")
            ax, ay = await b.eval("(()=>{let r=pagerOf('acc').getBoundingClientRect();return [r.x+r.width*0.7,r.y+r.height*0.5]})()")
            await b.send('Input.dispatchMouseEvent', type='mousePressed', x=ax, y=ay, button='left', clickCount=1, buttons=1)
            for i in range(1, 9):
                await b.send('Input.dispatchMouseEvent', type='mouseMoved', x=ax - 20 * i, y=ay, button='left', buttons=1)
            await b.send('Input.dispatchMouseEvent', type='mouseReleased', x=ax - 160, y=ay, button='left', clickCount=1)
            await asyncio.sleep(0.9)
            checks['a mouse drag turns the page'] = await b.eval("pagerOf('acc')._index") == 1
            for name, ok in checks.items():
                print(('ok   ' if ok else 'FAIL ') + name)
            if not all(checks.values()):
                misses.append(('interaction checks',))
    for bid in dict.fromkeys(m[0] for m in misses):
        n = sum(1 for m in misses if m[0] == bid)
        print(f'{bid}: {n} missed')
    if args.report:
        for m in misses:
            print('  MISS', m)
    print(f'{total - len(misses)} of {total} swipes turned the page and came back')
    return 1 if misses else 0

raise SystemExit(asyncio.run(main()))
