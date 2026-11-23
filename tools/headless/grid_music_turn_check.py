"""Home Grid's Now Playing blocks, drawn from the kit (round 12, 2026-11-23), against the fictional home, never a household's: Large and
Extra Large have the room, the cover, the progress, the volume and Previous / Play / Next inside the block, clear of each other (the volume as
wide as the progress bar); a tap on the COVER or the room opens a sheet over the page -- Browse, Queue and Speakers as three tabs at its top
(the owner: "Taping the artwork can open up browse or queue pop ups with the 3 tabs at the top"), on Queue while a song plays, Browse when
nothing does -- and a tap outside, Escape or its X closes it. Extra Large's Up Next has the next four songs, each a cover that plays, and a
Queue key at its foot.

WHAT FITS (as before 2026-11-08, with the kit's own measures): Small has the cover and the song alone; Wide and Tall have Play / Pause and Next
(no Previous: "remove the back/rewind button and just have the next/skip") -- each a 44 px target with 8 px or more clear between -- and the volume
where the block is tall enough for it as a full row.

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
from unittest.mock import patch
from client_smoke import OfflineReads

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--shots', type=Path)
args = parser.parse_args()

DEEP = "window.deep=(r,s)=>[...r.querySelectorAll('*')].flatMap(e=>[...(e.matches(s)?[e]:[]),...(e.shadowRoot?deep(e.shadowRoot,s):[])]);" \
       "window.cell=(id)=>deep(document,'.cell[data-id=\"'+id+'\"]')[0];" \
       "window.np=(id)=>deep(cell(id),'hk-now-playing-card')[0];" \
       "window.sheet=()=>document.querySelector('.hkd');" \
       "window.panel=()=>deep(document,'.mpanel')[0]||null;" \
       "window.tab=()=>{const m=panel(),t=m&&m.querySelector('.mptabs .on');return t?t.textContent:null};"
GRID = {'v': 1, 'cols': 6, 'rows': 4, 'frame': [1280, 800], 'band': True, 'items': [
    {'id': 'w', 'card': 'now_playing', 'size': 'W', 'at': [0, 0]},
    {'id': 't', 'card': 'now_playing', 'size': 'T', 'at': [2, 0]},
    {'id': 'l', 'card': 'now_playing', 'size': 'L', 'at': [3, 0]},
    {'id': 'x', 'card': 'now_playing', 'size': 'XL', 'at': [3, 2]},
    {'id': 's', 'card': 'now_playing', 'size': 'S', 'at': [0, 2]}]}
# the block's parts as rectangles (left, top, right, bottom), null where the size draws none
LAYOUT = """(id)=>{let r=np(id).shadowRoot,R=e=>{if(!e)return null;let b=e.getBoundingClientRect();return [b.left,b.top,b.right,b.bottom]},q=s=>R(r.querySelector(s));
  return {plate:q('hk-plate'),cover:q('[data-np=cover]'),room:q('[data-np=room]'),prog:q('.npp .trk'),vol:q('[data-np=vol]'),volTrack:q('[data-np=vol] .t'),
          prev:q('[data-np=prev]'),play:q('[data-np=pp]'),next:q('[data-np=next]'),queue:q('[data-np=queue]'),
          up:[...r.querySelectorAll('[data-np=upnext]')].map(R),upLabel:[...r.querySelectorAll('.a.kl')].some(e=>e.textContent==='Up Next')}}"""


def inside(a, b):
    return a[0] >= b[0] - 1 and a[1] >= b[1] - 1 and a[2] <= b[2] + 1 and a[3] <= b[3] + 1


def apart(a, b, gap=0):
    return a[2] <= b[0] - gap + 0.5 or b[2] <= a[0] - gap + 0.5 or a[3] <= b[1] - gap + 0.5 or b[3] <= a[1] - gap + 0.5


async def main():
    gallery.SETTINGS['boards']['blocks'] = {'home_style': 'grid', 'home_grid': GRID, 'menu_custom': True, 'menu': 'tabbar'}
    # (Music Assistant's queue: what plays and twenty songs, more than Extra Large's Up Next shows at once)
    ask = OfflineReads.request

    async def queue(self, msg):
        if msg['type'] != 'hk_music/queue':
            return await ask(self, msg)
        return {'ok': True, 'items': [{'id': str(i), 'title': f'Upcoming Song {i}', 'artist': 'The Fictional Trio', 'duration': 180} for i in range(21)]}
    with tempfile.TemporaryDirectory() as td, patch.object(OfflineReads, 'request', queue):
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
            assert await b.wait("['w','t','l','x','s'].every(id=>np(id)&&np(id).shadowRoot.querySelector('[data-np=cover]'))", 20)
            # (Extra Large's Up Next comes in once the queue has been asked for)
            assert await b.wait("np('x').shadowRoot.querySelectorAll('[data-np=upnext]').length===4", 20)
            await asyncio.sleep(1.5)
            lay = {bid: await b.eval('(' + LAYOUT + ")('" + bid + "')") for bid in ('w', 't', 'l', 'x', 's')}
            z = {bid: await b.eval("np('" + bid + "').getBoundingClientRect().width/np('" + bid + "').offsetWidth") for bid in lay}
            # Large, and Extra Large's left 405: the room's capsule, the cover, the progress, the volume and Previous / Play / Next inside the block,
            # the keys 44 px or more with 8 px clear; the volume's track exactly as wide as the progress bar's (the owner: "The volume slider
            # doesn't match the width of the progress bar!"); the cover 8 px clear of the keys and the volume
            for bid in ('l', 'x'):
                d = lay[bid]
                for k in ('room', 'cover', 'prog', 'vol', 'prev', 'play', 'next'):
                    assert d[k] and inside(d[k], d['plate']), (bid, k, d)
                for k in ('prev', 'play', 'next'):
                    assert d[k][2] - d[k][0] >= 44 * z[bid] - 0.5 and d[k][3] - d[k][1] >= 44 * z[bid] - 0.5, (bid, k, z[bid], d)
                assert apart(d['prev'], d['play'], 8 * z[bid]) and apart(d['play'], d['next'], 8 * z[bid]), (bid, d)
                for o in ('prev', 'play', 'next', 'vol'):
                    assert apart(d['cover'], d[o], 8 * z[bid]), (bid, 'cover', o, d)
                assert abs((d['volTrack'][2] - d['volTrack'][0]) - (d['prog'][2] - d['prog'][0])) <= 1, ('the volume as wide as the progress', bid, d)
                assert abs(d['volTrack'][0] - d['prog'][0]) <= 1, ('...and from the same edge', bid, d)
            # EXTRA LARGE: Up Next, the next four songs as covers (each plays), and a Queue key at the foot, inside the block and clear of the covers
            d = lay['x']
            assert d['upLabel'] and len(d['up']) == 4 and d['queue'], d
            for u in d['up']:
                assert inside(u, d['plate']) and u[2] - u[0] >= 44 * z['x'] and apart(u, d['queue'], 8 * z['x']), (u, d)
            assert d['queue'][3] - d['queue'][1] >= 44 * z['x'] - 0.5 and inside(d['queue'], d['plate']), d
            assert d['queue'][0] >= d['next'][2] - 1, ('Up Next is beside the player, not under it', d)
            # Small: the cover and the song alone; Wide and Tall: Play / Pause and Next (no Previous), the volume only where it fits as a full row
            d = lay['s']
            assert d['cover'] and not d['vol'] and not d['prog'] and not d['prev'] and not d['next'], d
            for bid in ('w', 't'):
                d = lay[bid]
                assert d['cover'] and not d['prev'] and d['play'] and d['next'] and not d['queue'], (bid, d)
                for k in ('play', 'next'):
                    assert inside(d[k], d['plate']), (bid, k, d)
                    assert d[k][2] - d[k][0] >= 44 * z[bid] - 0.5 and d[k][3] - d[k][1] >= 44 * z[bid] - 0.5, (bid, k, z[bid], d)
                assert apart(d['play'], d['next'], 8 * z[bid]), (bid, d)
                if d['vol']:
                    assert inside(d['vol'], d['plate']) and apart(d['vol'], d['play'], 0) and apart(d['vol'], d['next'], 0), (bid, d)
            # (the Tall block has the progress under the song; its volume needs a block 342 px tall for a full row, and this grid's tile-sized
            # Tall is 289: the Speakers tab has every room's volume, as the owner's "while still having good size touch areas" says)
            assert lay['t']['prog'] and not lay['t']['vol'] and not lay['w']['vol'], (lay['t'], lay['w'])
            print('  w, t, l, x, s: the keys 44 px or more with 8 clear; the volume as wide as the progress bar on L and XL')
            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
                await b.screenshot(args.shots / 'turn-front.png')
            # THE COVER OPENS THE SHEET (Large): over the page, three tabs at its top -- Browse, Queue, Speakers -- on Queue while a song plays
            await b.eval("np('l').shadowRoot.querySelector('[data-np=cover]').click()")
            assert await b.wait("!!sheet() && !!panel() && tab()==='Queue'", 8), await b.eval("({sheet:!!sheet(),panel:!!panel(),tab:tab()})")
            await asyncio.sleep(1.0)
            back = await b.eval("""(()=>{let m=panel(),sh=sheet().querySelector('.sheet').getBoundingClientRect();
              return {tabs:[...m.querySelectorAll('.mptabs [data-tab]')].map(t=>t.textContent),on:tab(),box:[sh.left,sh.top,sh.right,sh.bottom],
                      title:sheet().querySelector('.tt').textContent}})()""")
            assert back['tabs'] == ['Browse', 'Queue', 'Speakers'] and back['on'] == 'Queue' and back['title'] == 'Now Playing', back
            box = back['box']
            assert box[0] >= 0 and box[1] >= 0 and box[2] <= 1280 and box[3] <= 800 and box[2] - box[0] >= 400, back
            if args.shots:
                await b.screenshot(args.shots / 'turn-queue.png')
            # its own tabs; a tap outside it (its scrim) closes it, the page as it was
            await b.eval("panel().querySelector('[data-tab=\"browse\"]').click()")
            assert await b.wait("tab()==='Browse'", 5)
            if args.shots:
                await b.screenshot(args.shots / 'turn-browse.png')
            await b.eval("sheet().querySelector('.bd').click()")
            assert await b.wait("!sheet()", 5)
            # the room's capsule opens it on Speakers (Extra Large's), and Escape closes it
            await b.eval("np('x').shadowRoot.querySelector('[data-np=room]').click()")
            assert await b.wait("!!panel() && tab()==='Speakers'", 8), await b.eval("tab()")
            await asyncio.sleep(1.0)
            if args.shots:
                await b.screenshot(args.shots / 'turn-speakers.png')
            await b.send('Input.dispatchKeyEvent', type='keyDown', key='Escape', code='Escape', windowsVirtualKeyCode=27)
            await b.send('Input.dispatchKeyEvent', type='keyUp', key='Escape', code='Escape', windowsVirtualKeyCode=27)
            assert await b.wait("!sheet()", 5)
            # EXTRA LARGE'S UP NEXT (round 12: the next four songs as covers, no list to scroll): a tap on a cover plays that song
            # (hk_music/queue_play); the first of the queue is what plays now, so Up Next starts at the second
            assert await b.eval("[...np('x').shadowRoot.querySelectorAll('[data-np=upnext]')].map(e=>e.getAttribute('data-qid')).join()") == '1,2,3,4'
            t = await b.eval("(()=>{const e=np('x').shadowRoot.querySelectorAll('[data-np=upnext]')[2].getBoundingClientRect();return {x:(e.left+e.right)/2,y:(e.top+e.bottom)/2}})()")
            # (what the tap asks for, recorded: the card's own "playing it" mark clears as soon as the server answers, which a loaded machine's
            # check could miss -- 2026-11-09, the release run)
            await b.eval("window.__played=[];np('x')._playQueued=function(id){window.__played.push(id)}")
            for _ in range(2):
                await b.send('Input.dispatchTouchEvent', type='touchStart', touchPoints=[{'x': t['x'], 'y': t['y']}])
                await b.send('Input.dispatchTouchEvent', type='touchEnd', touchPoints=[])
                if await b.wait("window.__played.length>0", 3):
                    break
            assert await b.eval("window.__played[0]==='3'"), ('a tap on the third cover plays its song', await b.eval("window.__played"))
            print('  x: Up Next is four covers, a tap plays the song')
            # the Extra Large block's Queue key (in Up Next's place at the foot), then the sheet's X
            await b.eval("np('x').shadowRoot.querySelector('[data-np=queue]').click()")
            assert await b.wait("!!panel() && tab()==='Queue'", 8)
            await asyncio.sleep(1.0)
            await b.eval("sheet().querySelector('.x').click()")
            assert await b.wait("!sheet()", 5)
            # nothing playing: the block says so, and the cover still opens the sheet, on Browse (it is how something starts)
            state('media_player.living_room', 'idle')
            assert await b.wait("np('l').shadowRoot.querySelector('.a.kd').textContent==='Nothing Playing'", 10)
            await b.eval("np('l').shadowRoot.querySelector('[data-np=cover]').click()")
            assert await b.wait("!!panel() && tab()==='Browse'", 8), await b.eval("tab()")
            await asyncio.sleep(1.5)
            assert await b.eval('!!sheet()'), 'the sheet stays with nothing playing'
            exceptions = [line for line in b.console if line.startswith('EXCEPTION:')]
            assert not exceptions, exceptions
            print('PASS: Now Playing blocks: S the cover alone, W and T Play and Next at 44 px with 8 clear, L and XL the whole player; the cover opens Browse / Queue / Speakers in a sheet')

asyncio.run(main())
