"""Home Grid's Now Playing blocks turn over (2026-10-27) against the fictional home, never a household's: Large and
Extra Large have Speakers and Browse beside their transport, inside the block, clear of the cover and each other; a
tap turns the card over into the screensaver's panel (Speakers / Volume / Queue / Browse), bigger than the block,
centred on it and on the screen; a tap outside, Escape or its X turns it back.

WHAT FITS (2026-11-08, the owner: what does not fit goes to the player's sheet): Wide and Tall have the three keys only
-- each a 44 px target with 8 px or more clear between -- and no Speakers, Browse or volume; Small has play / pause alone.

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
    {'id': 'x', 'card': 'now_playing', 'size': 'XL', 'at': [3, 2]},
    {'id': 's', 'card': 'now_playing', 'size': 'S', 'at': [0, 2]}]}
# the block's buttons, the cover and the transport, as rectangles
LAYOUT = """(id)=>{let r=np(id).shadowRoot,R=e=>{let b=e.getBoundingClientRect();return [b.left,b.top,b.right,b.bottom]};
  return {plate:R(r.querySelector('hk-plate')),art:R(r.querySelector('.art')),spk:R(r.querySelector('[data-act=spk]')),brw:R(r.querySelector('[data-act=brw]')),
          prev:R(r.querySelector('[data-act=prev]')),play:R(r.querySelector('[data-act=pp]')),next:R(r.querySelector('[data-act=next]')),
          shown:getComputedStyle(r.querySelector('[data-act=spk]')).display!=='none'&&getComputedStyle(r.querySelector('[data-act=brw]')).display!=='none',
          vol:getComputedStyle(r.querySelector('.mvol')).display!=='none'}}"""


def inside(a, b):
    return a[0] >= b[0] - 1 and a[1] >= b[1] - 1 and a[2] <= b[2] + 1 and a[3] <= b[3] + 1


def apart(a, b, gap=0):
    return a[2] <= b[0] - gap + 0.5 or b[2] <= a[0] - gap + 0.5 or a[3] <= b[1] - gap + 0.5 or b[3] <= a[1] - gap + 0.5


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
            assert await b.wait("['w','t','l','x','s'].every(id=>np(id)&&np(id).shadowRoot.querySelector('[data-act=spk]'))", 20)
            await asyncio.sleep(1.5)
            # Large and Extra Large: Speakers and Browse shown, inside the block, apart (8 px) from the cover and the transport
            for bid in ('l', 'x'):
                lay = await b.eval('(' + LAYOUT + ")('" + bid + "')")
                z = await b.eval("np('" + bid + "').getBoundingClientRect().width/np('" + bid + "').offsetWidth")
                assert lay['shown'] and lay['vol'], (bid, lay)
                for k in ('spk', 'brw', 'prev', 'play', 'next'):
                    assert inside(lay[k], lay['plate']), (bid, k, lay)
                    assert lay[k][2] - lay[k][0] >= 44 * z - 0.5 and lay[k][3] - lay[k][1] >= 44 * z - 0.5, (bid, k, z, lay)
                for k in ('spk', 'brw'):
                    for o in ('art', 'prev', 'play', 'next'):
                        assert apart(lay[k], lay[o], 8 * z), (bid, k, o, lay)
                assert apart(lay['prev'], lay['play'], 8 * z) and apart(lay['play'], lay['next'], 8 * z), (bid, lay)
            # Small, Wide and Tall: no Speakers or Browse (the sheet has them); the keys 44 px with 8 px clear; Wide and Tall
            # the volume again (2026-11-09, the owner: "Looks like the tall and the wide cards lost their volume slider?") --
            # but not on this grid's tile-sized Wide, 110 px inside, where the keys and the volume do not both fit as targets
            for bid, keys in (('s', ('play',)), ('w', ('prev', 'play', 'next')), ('t', ('prev', 'play', 'next'))):
                lay = await b.eval('(' + LAYOUT + ")('" + bid + "')")
                z = await b.eval("np('" + bid + "').getBoundingClientRect().width/np('" + bid + "').offsetWidth")
                short = lay['plate'][3] - lay['plate'][1] < 180 * z
                assert not lay['shown'] and lay['vol'] == (bid != 's' and not short), (bid, lay)
                for k in keys:
                    assert inside(lay[k], lay['plate']), (bid, k, lay)
                    assert lay[k][2] - lay[k][0] >= 44 * z - 0.5 and lay[k][3] - lay[k][1] >= 44 * z - 0.5, (bid, k, z, lay)
                for x, y in zip(keys, keys[1:]):
                    assert apart(lay[x], lay[y], 8 * z), (bid, x, y, lay)
            # EVERY PLAYER'S LOOK (player_look.js): no wells behind the buttons; on Tall and Large the progress bar and
            # the volume's track as far from the pause glyph's ink
            await b.eval((ROOT / 'tools/headless/player_look.js').read_text())
            for bid in ('w', 't', 'l', 'x'):
                look = await b.eval("playerLook(np('" + bid + "').shadowRoot,{bar:'.prog-track',pp:'.mpp svg',vol:'.range-wrap input',buttons:'.hks .mbtn'})")
                assert not look['wells'], (bid, look)
                # (not where the progress is the thin read-only line -- a tile-sized Large, 2026-11-09, the owner: "Volume is
                # more important than the progress bar": the line stays 12 px over the keys, the room it would take for the
                # glyph's halfway is the cover's)
                thin = await b.eval("deep(np('" + bid + "').shadowRoot,'.prog-track')[0].getBoundingClientRect().height < 4.5")
                if bid in ('l', 'x') and not thin:
                    assert 'above' in look and abs(look['above'] - look['below']) <= 3, (bid, look)
                print(f"  {bid}: no wells" + (f", {look['above']} px above the pause, {look['below']} below" if 'above' in look else ''))
            # music playing: Speakers can be tapped
            assert not await b.eval("np('l').shadowRoot.querySelector('[data-act=spk]').classList.contains('dis')")
            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
                await b.screenshot(args.shots / 'turn-front.png')
            # Browse on the Large block: the card turns over into the panel, bigger than the block, on the screen
            await b.eval("np('l').shadowRoot.querySelector('[data-act=brw]').click()")
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
            # Speakers on the Extra Large block (on Speakers); Escape turns it back
            await b.eval("np('x').shadowRoot.querySelector('[data-act=spk]').click()")
            assert await b.wait("!!turned() && turned().querySelector('.mptabs .on').textContent==='Speakers'", 5)
            await asyncio.sleep(1.2)
            if args.shots:
                await b.screenshot(args.shots / 'turn-speakers.png')
            # (the Tall block's Browse, with the Wide's back up: one back at a time is the Wide's own business --
            # a tap outside it closes it first, as a person's would)
            await b.send('Input.dispatchKeyEvent', type='keyDown', key='Escape', code='Escape', windowsVirtualKeyCode=27)
            await b.send('Input.dispatchKeyEvent', type='keyUp', key='Escape', code='Escape', windowsVirtualKeyCode=27)
            assert await b.wait("!turned() && getComputedStyle(np('x').shadowRoot.querySelector('hk-plate')).visibility==='visible'", 5)
            # the Extra Large block: its Browse, then the X
            await b.eval("np('x').shadowRoot.querySelector('[data-act=brw]').click()")
            assert await b.wait('!!turned()', 5)
            await asyncio.sleep(1.2)
            await b.eval("turned().querySelector('[data-k=\"close\"]').click()")
            assert await b.wait("!turned() && getComputedStyle(np('x').shadowRoot.querySelector('hk-plate')).visibility==='visible'", 5)
            # nothing playing: Speakers dims, Browse still opens (it is how something starts)
            state('media_player.living_room', 'idle')
            assert await b.wait("np('l').shadowRoot.querySelector('[data-act=spk]').classList.contains('dis')", 10)
            await b.eval("np('l').shadowRoot.querySelector('[data-act=brw]').click()")
            assert await b.wait('!!turned()', 5)
            await asyncio.sleep(1.5)
            assert await b.eval('!!turned()'), 'the back stays with nothing playing'
            exceptions = [line for line in b.console if line.startswith('EXCEPTION:')]
            assert not exceptions, exceptions
            print('PASS: Now Playing blocks: S, W and T keep their keys at 44 px with 8 clear; L and XL have Speakers and Browse, the card turning over into the panel and back')

asyncio.run(main())
