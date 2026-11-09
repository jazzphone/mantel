"""The timer wheels (hk-roller.js; the owner's mockup 5c, 2026-11-09, "Yes, build it") against the fictional home, never a
household's: an Extra Large Timers block with nothing running makes a timer in the block -- three wheels (hours,
minutes, seconds) on 0, 15 and 0; a finger's flick on the minutes wheel settles on another number and Start says so; a
tap on a number moves its wheel there; Start sends script.quick_timer_start the HH:MM:SS. The "+" on a Wide block opens
the New Timer sheet, the same wheels where the keypad was.

    python tools/headless/timer_roller_check.py [--shots DIRECTORY]
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
       "window.cell=(id)=>deep(document,'.cell[data-id=\"'+id+'\"]')[0];" \
       "window.blk=(id)=>deep(cell(id),'hk-timer-strip-card')[0];" \
       "window.maker=()=>deep(blk('x').shadowRoot,'hk-timer-new-card')[0];" \
       "window.wheels=(r)=>deep(r,'.hkr-w');"
GRID = {'v': 1, 'cols': 6, 'rows': 4, 'frame': [1280, 800], 'band': True, 'items': [
    {'id': 'x', 'card': 'timers', 'size': 'XL', 'at': [0, 0]},
    {'id': 'w', 'card': 'timers', 'size': 'W', 'at': [3, 0]}]}


async def main():
    gallery.SETTINGS['boards']['blocks'] = {'home_style': 'grid', 'home_grid': GRID, 'menu_custom': True, 'menu': 'tabbar'}
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        # (nothing running: the blocks' idle faces)
        store = app['hub'].store
        app['hub'].on_change(store.apply_event({'a': {'sensor.running_quick_timers': {'s': '0', 'lc': gallery.NOW, 'lu': gallery.NOW, 'a': {'running': []}}}}))
        for eid, st in list(store.states.items()):
            if eid.startswith('timer.') and st.get('s') in ('active', 'paused'):
                app['hub'].on_change(store.apply_event({'a': {eid: {'s': 'idle', 'lc': gallery.NOW, 'lu': gallery.NOW, 'a': st.get('a', {})}}}))
        async with TestServer(app) as server, Browser(1280, 800, port=9407) as b:
            origin = str(server.make_url('')).rstrip('/')
            await b.restrict_origin(origin)
            await b.open(origin + '/blocks/home', cookie)
            assert await b.wait('window.__mantelReady===true', 30)
            await b.eval(DEEP)
            assert await b.wait("!!maker() && wheels(maker().shadowRoot).length===3", 20), 'the Extra Large block has the New Timer card, three wheels'
            await asyncio.sleep(0.8)
            vals = "wheels(maker().shadowRoot).map(w=>w.getAttribute('aria-valuenow'))"
            start = "deep(maker().shadowRoot,'.start')[0].textContent"
            assert await b.eval(vals) == ['0', '15', '0'] and await b.eval(start) == 'Start 15 min', (await b.eval(vals), await b.eval(start))
            # (the minutes wheel at 15 in its band: scrolled 15 rows)
            got = await b.eval("(()=>{const w=wheels(maker().shadowRoot)[1];return {top:w.scrollTop,row:w.clientHeight/5}})()")
            assert abs(got['top'] - 15 * got['row']) < 1.5, got
            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
                await b.screenshot(args.shots / 'roller-xl.png')
            # A FLICK UP on the minutes wheel: it spins on and settles on a whole number past 15, and Start follows
            r = await b.eval("(()=>{const b=wheels(maker().shadowRoot)[1].getBoundingClientRect();return {x:(b.left+b.right)/2,y:b.top+b.height*.7,h:b.height}})()")
            await b.send('Input.synthesizeScrollGesture', x=r['x'], y=r['y'], yDistance=-int(r['h'] * 0.42), gestureSourceType='touch', speed=500)
            assert await b.wait("(()=>{const w=wheels(maker().shadowRoot)[1],t=w.scrollTop;return new Promise(k=>setTimeout(()=>k(w.scrollTop===t),300))})()", 8)
            await asyncio.sleep(0.4)
            m = int(await b.eval(vals + "[1]"))
            row = await b.eval("(()=>{const w=wheels(maker().shadowRoot)[1];return {top:w.scrollTop,row:w.clientHeight/5}})()")
            assert m > 15 and abs(row['top'] - m * row['row']) < 1.5, (m, row)
            assert await b.eval(start) == f'Start {m} min', await b.eval(start)
            print(f'  flick: the minutes wheel settled on {m}, Start says so')
            # A TAP ON A NUMBER: the hours wheel's 1, under the band
            t = await b.eval("(()=>{const e=deep(maker().shadowRoot,'.hkr-w')[0].querySelector('[data-v=\"1\"]').getBoundingClientRect();return {x:(e.left+e.right)/2,y:(e.top+e.bottom)/2}})()")
            await b.send('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{'x': t['x'], 'y': t['y']}])
            await b.send('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
            assert await b.wait(vals + "[0]==='1'", 5), await b.eval(vals)
            await asyncio.sleep(0.8)
            assert await b.eval(start) == f'Start 1 hr {m} min', await b.eval(start)
            print('  tap: the hours wheel moved to 1')
            # THE KEYS: the seconds wheel focused, Down twice -- 2 seconds
            await b.eval("wheels(maker().shadowRoot)[2].focus()")
            for _ in range(2):
                await b.send('Input.dispatchKeyEvent', type='keyDown', key='ArrowDown', code='ArrowDown', windowsVirtualKeyCode=40)
                await b.send('Input.dispatchKeyEvent', type='keyUp', key='ArrowDown', code='ArrowDown', windowsVirtualKeyCode=40)
            assert await b.wait(vals + "[2]==='2'", 5), await b.eval(vals)
            # START: the start script with the wheels' HH:MM:SS
            await b.eval("window.__sent=null;maker()._callResp=(d,s,data)=>{window.__sent={call:d+'.'+s,data};return Promise.resolve({ok:true,response:{started:true}})}")
            await b.eval("deep(maker().shadowRoot,'.start')[0].click()")
            assert await b.wait("!!window.__sent", 5)
            sent = await b.eval("window.__sent")
            assert sent['call'] == 'script.quick_timer_start' and sent['data']['duration'] == f'01:{m:02d}:02', sent
            print(f"  start: {sent['call']} {sent['data']['duration']}")
            # THE NEW TIMER SHEET (the Wide block's +): the same wheels, no keypad
            await b.eval("deep(blk('w').shadowRoot,'[data-new]')[0].click()")
            assert await b.wait("deep(document,'hk-timer-new-card').some(c=>c!==maker()&&wheels(c.shadowRoot).length===3)", 8), 'the sheet has the wheels'
            await asyncio.sleep(1.2)
            sh = await b.eval("(()=>{const c=deep(document,'hk-timer-new-card').find(c=>c!==maker());return {keys:deep(c.shadowRoot,'.pad,.key').length,"
                              "vals:wheels(c.shadowRoot).map(w=>w.getAttribute('aria-valuenow')),start:deep(c.shadowRoot,'.start')[0].textContent}})()")
            assert sh['keys'] == 0 and sh['vals'] == ['1', str(m), '2'] and sh['start'] == f'Start 1 hr {m} min 2 sec', sh
            if args.shots:
                await b.screenshot(args.shots / 'roller-sheet.png')
            print('  sheet: the wheels where the keypad was, opened on the last timer started')
    print('PASS: the timer wheels set, settle, tap and start, in the Extra Large block and the New Timer sheet')


asyncio.run(main())
