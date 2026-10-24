"""Home Grid editor with a finger (2026-10-24, the owner on an iPad: the card list "keeps thinking I want to move a
card"): against the fictional home, with real touch input (Chrome's touch pipeline, so the list scrolls natively).

  - a finger moving up the card list scrolls it, and adds nothing
  - a finger dragging a card sideways, towards the grid, places it
  - a finger held on a card picks it up, and then carries it any way (down first, here) onto the grid
  - a tap still opens the card's preview

    python tools/headless/grid_editor_touch_check.py
"""
import asyncio
import sys
import tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]
from gallery import build, SCREEN
from cdp import Browser
from aiohttp.test_utils import TestServer


async def main():
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await build(Path(td))
        from mantel_server.settings_store import load_model
        app['settings'].model = load_model()
        async with TestServer(app) as server, Browser(1366, 1024, port=9409) as b:
            origin = str(server.make_url('')).rstrip('/')
            await b.restrict_origin(origin)
            await b.send('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
            await b.send('Emulation.setEmulatedMedia', features=[{'name': 'pointer', 'value': 'coarse'}])
            await b.open(origin + '/settings#/screens/' + SCREEN + '/home-grid', cookie)
            assert await b.wait("!!document.querySelector('hk-settings-panel')?.shadowRoot?.querySelector('hk-grid-editor')?.ui", 20)
            await b.eval("window.ed=document.querySelector('hk-settings-panel').shadowRoot.querySelector('hk-grid-editor');void 0")
            assert await b.wait("ed.sidebar.querySelectorAll('.starter').length>0", 20)
            await b.eval("ed.sidebar.querySelector('[data-starter=empty]').click()")
            assert await b.wait('!!ed.grid && ed.grid.items.length===0', 10)
            await asyncio.sleep(1)

            async def touch(kind, x, y):
                await b.send('Input.dispatchTouchEvent', type=kind, touchPoints=[] if kind == 'touchEnd' else [{'x': x, 'y': y}])

            async def gesture(path, hold=0.0):
                await touch('touchStart', *path[0])
                if hold:
                    await asyncio.sleep(hold)
                for x, y in path[1:]:
                    await touch('touchMove', x, y)
                    await asyncio.sleep(0.016)
                await touch('touchEnd', 0, 0)
                await asyncio.sleep(0.4)

            def line(a, z, n=20):
                return [(a[0] + (z[0] - a[0]) * i / n, a[1] + (z[1] - a[1]) * i / n) for i in range(n + 1)]

            row = "(k=>{let e=ed.palette.querySelector('[data-card='+k+']');e.scrollIntoView({block:'center'});let r=e.getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})"
            grid = await b.eval("(()=>{let r=ed.overlay.getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()")
            # 1. up the list: it scrolls, nothing is picked up or added
            await b.eval('ed.palette.scrollTop=0')
            start = await b.eval(row + "('scenes')")
            before = await b.eval('ed.palette.scrollTop')
            # (Chrome's own touch scroll: its touch events, then the scroll they make, as a finger's)
            await b.send('Input.synthesizeScrollGesture', x=int(start[0]), y=int(start[1]), yDistance=-300, gestureSourceType='touch', speed=800)
            await asyncio.sleep(0.5)
            scrolled = await b.eval('ed.palette.scrollTop') - before
            assert scrolled > 100, scrolled
            assert await b.eval("ed.grid.items.length===0 && !ed.shadowRoot.querySelector('.float')")
            print('a finger moving up the list scrolls it, %d px, and adds nothing' % scrolled, flush=True)
            # 2. sideways, towards the grid: the card is placed
            await b.eval('ed.palette.scrollTop=0')
            await asyncio.sleep(0.3)
            start = await b.eval(row + "('weather')")
            await gesture(line(start, (grid[0] + grid[2] * 0.25, start[1]), 30))
            assert await b.wait("ed.grid.items.some(i=>i.card==='weather')", 5), await b.eval('JSON.stringify(ed.grid.items)')
            print('a sideways drag places a card', flush=True)
            # 3. a hold, then down and over onto the grid
            start = await b.eval(row + "('clock')")
            path = line(start, (start[0], start[1] + 120), 10) + line((start[0], start[1] + 120), (grid[0] + grid[2] * 0.8, grid[1] + grid[3] * 0.8), 30)[1:]
            await gesture(path, hold=0.6)
            assert await b.wait("ed.grid.items.some(i=>i.card==='clock')", 5), await b.eval('JSON.stringify(ed.grid.items)')
            assert await b.eval("![...ed.palette.querySelectorAll('.pal-row')].some(r=>r.classList.contains('lifted'))")
            print('a hold picks a card up, and it goes down first and then onto the grid', flush=True)
            # 4. a tap opens the card's preview
            start = await b.eval(row + "('calendar')")
            await gesture([start])
            assert await b.wait("ed.palette.querySelector('[data-card=calendar]').getAttribute('aria-expanded')==='true'", 5)
            assert await b.eval('ed.grid.items.length===2')
            exceptions = [line for line in b.console if line.startswith('EXCEPTION:')]
            assert not exceptions, exceptions
            print('PASS: a finger scrolls the card list, and a sideways drag, a hold or a tap still add cards')

asyncio.run(main())
