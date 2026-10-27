"""Home Grid's Now Playing blocks turn over (2026-10-27) against the fictional home, never a household's: each
size (Wide, Tall, Large) has Speakers and Browse beside its transport, inside the block and clear of the cover; a
tap turns the card over into the screensaver's panel (Speakers / Volume / Queue / Browse), bigger than the block,
centred on it and on the screen; a tap outside, Escape or its X turns it back.

    python tools/headless/grid_music_turn_check.py [--shots DIRECTORY]
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
       "window.np=(id)=>deep(cell(id),'hk-now-playing-card')[0];" \
       "window.turned=()=>[...document.body.children].map(h=>h.shadowRoot&&h.shadowRoot.querySelector('.mpanel.turn')).filter(Boolean)[0]||null;"
GRID = {'v': 1, 'cols': 6, 'rows': 4, 'frame': [1280, 800], 'band': True, 'items': [
    {'id': 'w', 'card': 'now_playing', 'size': 'W', 'at': [0, 0]},
    {'id': 't', 'card': 'now_playing', 'size': 'T', 'at': [2, 0]},
    {'id': 'l', 'card': 'now_playing', 'size': 'L', 'at': [3, 0]},
    {'id': 'w2', 'card': 'now_playing', 'size': 'W', 'at': [0, 2]}]}
# the block's buttons, the cover and the transport, as rectangles
LAYOUT = """(id)=>{let r=np(id).shadowRoot,R=e=>{let b=e.getBoundingClientRect();return [b.left,b.top,b.right,b.bottom]};
  return {plate:R(r.querySelector('hk-plate')),art:R(r.querySelector('.art')),spk:R(r.querySelector('.spk')),brw:R(r.querySelector('.brw')),
          prev:R(r.querySelector('.prev')),play:R(r.querySelector('.play')),next:R(r.querySelector('.next')),
          shown:getComputedStyle(r.querySelector('.spk')).display!=='none'&&getComputedStyle(r.querySelector('.brw')).display!=='none'}}"""


def inside(a, b):
    return a[0] >= b[0] - 1 and a[1] >= b[1] - 1 and a[2] <= b[2] + 1 and a[3] <= b[3] + 1


def apart(a, b):
    return a[2] <= b[0] + 0.5 or b[2] <= a[0] + 0.5 or a[3] <= b[1] + 0.5 or b[3] <= a[1] + 0.5


async def main():
    gallery.SETTINGS['boards']['blocks'] = {'home_style': 'grid', 'home_grid': GRID, 'menu_custom': True, 'menu': 'tabbar'}
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))

        def state(entity, value):
            cur = app['hub'].store.states.get(entity) or {}
            touched = app['hub'].store.apply_event({'a': {entity: {'s': value, 'lc': gallery.NOW, 'lu': gallery.NOW, 'a': cur.get('a', {})}}})
            app['hub'].on_change(touched)
        async with TestServer(app) as server, Browser(1280, 800, port=9405) as b:
            origin = str(server.make_url('')).rstrip('/')
            await b.restrict_origin(origin)
            await b.open(origin + '/blocks/home', cookie)
            assert await b.wait('window.__mantelReady===true', 30)
            await b.eval(DEEP)
            state('media_player.living_room', 'playing')
            assert await b.wait("['w','t','l'].every(id=>np(id)&&np(id).shadowRoot.querySelector('.spk'))", 20)
            await asyncio.sleep(1.5)
            # each size: Speakers and Browse shown, inside the block, apart from the cover and the transport
            for bid in ('w', 't', 'l'):
                lay = await b.eval('(' + LAYOUT + ")('" + bid + "')")
                z = await b.eval("np('" + bid + "').getBoundingClientRect().width/np('" + bid + "').offsetWidth")
                assert lay['shown'], (bid, lay)
                for k in ('spk', 'brw', 'prev', 'play', 'next'):
                    assert inside(lay[k], lay['plate']), (bid, k, lay)
                for k in ('spk', 'brw'):
                    assert lay[k][2] - lay[k][0] >= 32 * z - 0.5 and lay[k][3] - lay[k][1] >= 32 * z - 0.5, (bid, k, z, lay)
                    for o in ('art', 'prev', 'play', 'next'):
                        assert apart(lay[k], lay[o]), (bid, k, o, lay)
                assert apart(lay['spk'], lay['brw']), (bid, lay)
            # music playing: Speakers can be tapped
            assert not await b.eval("np('l').shadowRoot.querySelector('.spk').classList.contains('dis')")
            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
                await b.screenshot(args.shots / 'turn-front.png')
            # Browse on the Large block: the card turns over into the panel, bigger than the block, on the screen
            await b.eval("np('l').shadowRoot.querySelector('.brw').click()")
            assert await b.wait('!!turned()', 5)
            await asyncio.sleep(1.2)
            back = await b.eval("""(()=>{let p=turned(),r=p.getBoundingClientRect(),c=np('l').shadowRoot.querySelector('hk-plate'),cr=c.getBoundingClientRect();
              return {box:[r.left,r.top,r.right,r.bottom],block:[cr.left,cr.top,cr.right,cr.bottom],hidden:getComputedStyle(c).visibility,
                      tabs:[...p.querySelectorAll('.mptabs [data-tab]')].map(t=>t.textContent),on:p.querySelector('.mptabs .on').textContent,
                      flat:getComputedStyle(p).transform}})()""")
            box, block = back['box'], back['block']
            assert back['tabs'] == ['Speakers', 'Volume', 'Queue', 'Browse'] and back['on'] == 'Browse', back
            assert back['hidden'] == 'hidden', 'the card\'s front stays up under its back'
            assert back['flat'] in ('none', 'matrix(1, 0, 0, 1, 0, 0)'), back
            assert box[2] - box[0] >= 520 and box[3] - box[1] > block[3] - block[1], back
            assert box[0] >= 0 and box[1] >= 0 and box[2] <= 1280 and box[3] <= 800, back
            if args.shots:
                await b.screenshot(args.shots / 'turn-browse.png')
            # its own tabs; a tap outside turns it back, the card's front up again
            await b.eval("turned().querySelector('[data-tab=\"queue\"]').click()")
            assert await b.wait("turned().querySelector('.mptabs .on').textContent==='Queue'", 5)
            await b.eval("[...document.body.children].find(h=>h.shadowRoot&&h.shadowRoot.querySelector('.mpanel.turn')).shadowRoot.querySelector('.scrim').click()")
            assert await b.wait("!turned() && getComputedStyle(np('l').shadowRoot.querySelector('hk-plate')).visibility==='visible'", 5)
            # Speakers on the Wide block (on Speakers); Escape turns it back
            await b.eval("np('w').shadowRoot.querySelector('.spk').click()")
            assert await b.wait("!!turned() && turned().querySelector('.mptabs .on').textContent==='Speakers'", 5)
            await asyncio.sleep(1.2)
            if args.shots:
                await b.screenshot(args.shots / 'turn-speakers.png')
            # (the Tall block's Browse, with the Wide's back up: one back at a time is the Wide's own business --
            # a tap outside it closes it first, as a person's would)
            await b.send('Input.dispatchKeyEvent', type='keyDown', key='Escape', code='Escape', windowsVirtualKeyCode=27)
            await b.send('Input.dispatchKeyEvent', type='keyUp', key='Escape', code='Escape', windowsVirtualKeyCode=27)
            assert await b.wait("!turned() && getComputedStyle(np('w').shadowRoot.querySelector('hk-plate')).visibility==='visible'", 5)
            # the Tall block: its corner buttons, then the X
            await b.eval("np('t').shadowRoot.querySelector('.brw').click()")
            assert await b.wait('!!turned()', 5)
            await asyncio.sleep(1.2)
            await b.eval("turned().querySelector('[data-k=\"close\"]').click()")
            assert await b.wait("!turned() && getComputedStyle(np('t').shadowRoot.querySelector('hk-plate')).visibility==='visible'", 5)
            # nothing playing: Speakers dims, Browse still opens (it is how something starts)
            state('media_player.living_room', 'idle')
            assert await b.wait("np('l').shadowRoot.querySelector('.spk').classList.contains('dis')", 10)
            await b.eval("np('l').shadowRoot.querySelector('.brw').click()")
            assert await b.wait('!!turned()', 5)
            await asyncio.sleep(1.5)
            assert await b.eval('!!turned()'), 'the back stays with nothing playing'
            exceptions = [line for line in b.console if line.startswith('EXCEPTION:')]
            assert not exceptions, exceptions
            print('PASS: Now Playing blocks (W, T, L): Speakers and Browse in place, the card turning over into the panel and back')

asyncio.run(main())
