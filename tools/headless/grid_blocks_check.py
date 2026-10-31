"""Home Grid's full-control blocks, rules and following cameras (2026-10-24) against the fictional home, never a
household's: a Large Security block is the alarm keypad with its keys inside the block, a Large Vacuum block its
controls over Clean Areas, a block's rules switch its card in place (music playing; a time window and the alarm
armed), and a cameras block follows motion in its cameras' rooms. A calendar block shows the days it is asked for,
as many rows as fit and "N more" at its foot, and opens an event's sheet; a room block leaves out the house's Hidden
Accessories.

The editor makes room (2026-10-30, grid_blocks_check.cjs): on a screen shaped like the owner's tablet, a Large camera
carried onto four small tiles -- they slide into the space it left while it is held, the drop keeps that and one Undo
takes it back; Escape or letting go off the grid changes nothing. In Chromium with a finger and WebKit with a mouse,
at an iPad's size; skipped, saying so, without PLAYWRIGHT_PATH and NODE (edit_mode_check.py's).

    python tools/headless/grid_blocks_check.py [--shots DIRECTORY] [--cell square]

`--cell square` (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase A) runs the same on square cells (196 x 196, the
13 px gap): every block at its square height.
"""
import argparse
import asyncio
import json
import os
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
parser.add_argument('--cell', choices=['tile', 'square'], default='tile')
args = parser.parse_args()

DEEP = "window.deep=(r,s)=>[...r.querySelectorAll('*')].flatMap(e=>[...(e.matches(s)?[e]:[]),...(e.shadowRoot?deep(e.shadowRoot,s):[])]);" \
       "window.cell=(id)=>deep(document,'.cell[data-id=\"'+id+'\"]')[0];"
RULES = [{'when': {'all': [{'kind': 'music_playing'}]}, 'card': 'now_playing'},
         {'when': {'all': [{'kind': 'time', 'from': '00:00', 'to': '23:59'}, {'kind': 'alarm_armed'}]}, 'card': 'security'}]
GRID = {'v': 1, 'cols': 6, 'rows': 4, 'frame': [1280, 800], 'band': True, 'items': [
    {'id': 'keypad', 'card': 'security', 'size': 'L', 'at': [0, 0]},
    {'id': 'vac', 'card': 'vacuum', 'size': 'L', 'at': [2, 0], 'opts': {'entity': 'vacuum.robot'}},
    {'id': 'cams', 'card': 'camera', 'size': 'L', 'at': [4, 0], 'opts': {'follow': 'motion'}, 'pages': {'source': 'cameras'}},
    {'id': 'ruled', 'card': 'weather', 'size': 'L', 'at': [0, 2], 'rules': RULES},
    {'id': 'room', 'card': 'room', 'size': 'L', 'at': [2, 2], 'opts': {'area': 'living_room', 'accessory_display': 'scroll'}},
    {'id': 'cal', 'card': 'calendar', 'size': 'L', 'at': [4, 2], 'opts': {'calendars': ['calendar.family'], 'days': 7}}]}
# THE OWNER'S TABLET'S SHAPE (6 x 4, fictional accessories): three Large blocks across the top; four small tiles,
# the Calendar, a Tall thermostat and two scenes below
REFLOW = {'v': 1, 'cols': 6, 'rows': 4, 'frame': [1180, 820], 'band': True, 'items': [
    {'id': 'weather', 'card': 'weather', 'size': 'L', 'at': [0, 0], 'opts': {'entity': 'weather.home'}},
    {'id': 'camera', 'card': 'camera', 'size': 'L', 'at': [2, 0], 'opts': {'entity': 'camera.front_door'}},
    {'id': 'music', 'card': 'now_playing', 'size': 'L', 'at': [4, 0]},
    {'id': 'coffee', 'card': 'accessory', 'size': 'S', 'at': [0, 2], 'opts': {'entity': 'light.living_room_lamps'}},
    {'id': 'fire', 'card': 'accessory', 'size': 'S', 'at': [1, 2], 'opts': {'entity': 'light.kitchen_pendants'}},
    {'id': 'tread', 'card': 'accessory', 'size': 'S', 'at': [0, 3], 'opts': {'entity': 'lock.front_door'}},
    {'id': 'lights', 'card': 'accessory', 'size': 'S', 'at': [1, 3], 'opts': {'entity': 'cover.garage_door'}},
    {'id': 'cal', 'card': 'calendar', 'size': 'L', 'at': [2, 2], 'opts': {'calendars': ['calendar.family']}},
    {'id': 'thermo', 'card': 'thermostat', 'size': 'T', 'at': [4, 2], 'opts': {'entity': 'climate.main_floor'}},
    {'id': 'morning', 'card': 'scene', 'size': 'S', 'at': [5, 2], 'opts': {'scene': 'scene.good_morning'}},
    {'id': 'relax', 'card': 'scene', 'size': 'S', 'at': [5, 3], 'opts': {'scene': 'scene.movie_night'}}]}
MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
# a week of the fictional family's events, two a day: more than the block holds
EVENTS = """(()=>{let d0=new Date();d0.setHours(0,0,0,0);let out=[];for(let i=0;i<7;i++)for(let h of [19,21]){
  let s=new Date(+d0+i*864e5+h*36e5),e=new Date(+s+36e5);out.push({summary:'Event '+i+'-'+h,uid:'u'+i+h,start:{dateTime:s.toISOString()},end:{dateTime:e.toISOString()}})}
  return out})()"""


async def main():
    gallery.HOUSE['vacuum.robot'] = (None, ('docked', {'friendly_name': 'Robot', 'battery_level': 90, 'supported_features': 16383}))
    gallery.HOUSE['binary_sensor.yard_motion'] = ('backyard', ('off', {'friendly_name': 'Yard Motion', 'device_class': 'motion'}))
    gallery.HOUSE['media_player.living_room'] = ('living_room', ('paused', dict(gallery.HOUSE['media_player.living_room'][1][1])))
    gallery.HOUSE['media_player.kitchen'] = ('kitchen', ('idle', dict(gallery.HOUSE['media_player.kitchen'][1][1])))
    gallery.HOUSE['calendar.family'] = (None, ('off', {'friendly_name': 'Family'}))
    gallery.SETTINGS['settings']['added'] = ['clean_areas']
    gallery.SETTINGS['settings']['generated'] = {'exclude_entities': ['light.living_room_ceiling']}
    if args.cell == 'square':
        GRID['cell'] = REFLOW['cell'] = 'square'
    gallery.SETTINGS['boards']['blocks'] = {'home_style': 'grid', 'home_grid': GRID, 'menu_custom': True, 'menu': 'tabbar'}
    gallery.SETTINGS['boards']['reflow'] = {'home_style': 'grid', 'home_grid': REFLOW, 'menu_custom': True, 'menu': 'tabbar'}
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        from mantel_server.settings_store import load_model
        app['settings'].model = load_model()

        def state(entity, value, attrs=None):
            cur = app['hub'].store.states.get(entity) or {}
            touched = app['hub'].store.apply_event({'a': {entity: {'s': value, 'lc': gallery.NOW, 'lu': gallery.NOW,
                                                                   'a': attrs if attrs is not None else cur.get('a', {})}}})
            app['hub'].on_change(touched)
        async with TestServer(app) as server, Browser(1280, 800, port=9404) as b:
            origin = str(server.make_url('')).rstrip('/')
            await b.restrict_origin(origin)
            await b.open(origin + '/blocks/home', cookie)
            assert await b.wait('window.__mantelReady===true', 30)
            await b.eval(DEEP)
            assert await b.wait("!!cell('keypad') && !!cell('ruled')", 20)
            await asyncio.sleep(1.5)
            # the keypad: side by side, every key inside the block, at least 44 px tall
            assert await b.wait("deep(cell('keypad'),'hk-alarm-keypad-card').length===1", 10)
            keys = await b.eval("""(()=>{let c=cell('keypad').getBoundingClientRect(),kp=deep(cell('keypad'),'hk-alarm-keypad-card')[0],
              ks=[...kp.shadowRoot.querySelectorAll('.k,.a')].map(k=>k.getBoundingClientRect());
              return {side:!!kp.shadowRoot.querySelector('.side'),n:ks.length,inside:ks.every(r=>r.bottom<=c.bottom+1&&r.right<=c.right+1&&r.top>=c.top-1),
                      tall:Math.min(...ks.map(r=>r.height)),scale:deep(document,'hk-home-grid-view')[0]._gridScale}})()""")
            # (square cells: the whole canvas is scaled further down to fit, so the keys are measured on the canvas)
            if args.cell == 'square':
                keys['tall'] /= keys['scale']
            # the ways to arm stack in the keypad's right column, each a real button
            acts = await b.eval("(()=>{let kp=deep(cell('keypad'),'hk-alarm-keypad-card')[0];return [...kp.shadowRoot.querySelectorAll('.acts .a')].map(a=>Math.round(a.getBoundingClientRect().width))})()")
            assert len(acts) >= 2 and min(acts) >= 100, acts
            assert not await b.eval("deep(cell('keypad'),'hk-alarm-keypad-card')[0].shadowRoot.textContent.includes('Unavailable')"), 'the home\'s alarm'
            assert keys['side'] and keys['n'] >= 12 and keys['inside'] and keys['tall'] >= 40, keys
            # the vacuum: its card fills the block without Clean Areas, and sits over them with
            assert await b.eval("deep(cell('vac'),'hk-vacuum-card').length===1 && deep(cell('vac'),'hk-area-select-card').length===0")
            await b.eval("(()=>{let g=hkSettings.get.bind(hkSettings);hkSettings.get=(k,d)=>k==='added'?['clean_areas']:g(k,d);deep(cell('vac'),'hk-grid-vacuum-card')[0].redraw()})()")
            assert await b.wait("deep(cell('vac'),'hk-vacuum-card').length===1 && deep(cell('vac'),'hk-area-select-card').length===1", 10)
            # rules: nothing holds -> the default; music -> Now Playing; the alarm armed in the window -> the keypad
            kind = "(()=>{let c=deep(cell('ruled'),'hk-grid-conditional-card')[0];return c&&c._child&&c._child.localName})()"
            assert await b.wait(kind + "==='hk-weather-band-card'", 10), await b.eval(kind)
            before = await b.eval("(()=>{let r=cell('ruled').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
            state('media_player.living_room', 'playing')
            assert await b.wait(kind + "==='hk-now-playing-card'", 10), await b.eval(kind)
            state('media_player.living_room', 'paused')
            state('alarm_control_panel.home', 'armed_away')
            assert await b.wait(kind + "==='hk-grid-keypad-card'", 10), await b.eval(kind)
            state('media_player.living_room', 'playing')
            assert await b.wait(kind + "==='hk-now-playing-card'", 10), 'the first rule that holds wins'
            assert before == await b.eval("(()=>{let r=cell('ruled').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
            # a cameras block that follows motion: the porch's camera, then the yard's
            pager = "cell('cams').querySelector('hk-pager-card')"
            page = "(()=>{let p=" + pager + ";return p._pages[p._index].entity})()"
            state('binary_sensor.porch_motion', 'on')
            assert await b.wait(page + "==='camera.front_door'", 10), await b.eval(page)
            state('binary_sensor.porch_motion', 'off')
            state('binary_sensor.yard_motion', 'on')
            assert await b.wait(page + "==='camera.backyard'", 10), await b.eval(page)
            # a room block leaves out what the house hides (the ceiling light), as the room's page does
            tiles = "deep(cell('room'),'[entity]').map(e=>e.getAttribute('entity')||'').concat(deep(cell('room'),'*').map(e=>e._config&&e._config.entity).filter(Boolean))"
            assert await b.wait(tiles + ".includes('light.living_room_lamps')", 10), await b.eval(tiles)
            assert 'light.living_room_ceiling' not in await b.eval(tiles), 'a hidden accessory in the room block'
            # the calendar: seven days of events, under their days' headings, as many rows as the block has room for
            # and "N more" at its foot (2026-10-31, Calendar's widgets: no scroll); a tap opens one
            # (the house's client is frozen, so the card is handed what Home Assistant would answer)
            await b.eval("(()=>{let c=deep(cell('cal'),'hk-calendar-pane-card')[0];let ev=" + EVENTS + ";"
                         "c._evs=ev.map(e=>hkCalendar._.norm('calendar.family',e));c._n++;c.redraw();void 0})()")
            pane = "deep(cell('cal'),'hk-calendar-pane-card')[0].shadowRoot"
            assert await b.wait(pane + ".querySelectorAll('.ev2').length>=12", 15), await b.eval(pane + ".innerHTML.slice(0,300)")
            cal = await b.eval("(()=>{let r=" + pane + ",c=cell('cal').getBoundingClientRect(),vis=[...r.querySelectorAll('.ev2')].filter(e=>e.offsetParent);"
                               "return {heads:[...r.querySelectorAll('.gh')].map(e=>e.textContent),shown:vis.length,all:r.querySelectorAll('.ev2').length,"
                               "inside:vis.every(e=>e.getBoundingClientRect().bottom<=c.bottom+1),foot:(r.querySelector('.ft')||{}).textContent}})()")
            assert cal['heads'] and cal['heads'][0] == 'Tomorrow' and 0 < cal['shown'] < cal['all'] and cal['inside'] and \
                cal['foot'] == f"{cal['all'] - cal['shown']} more", cal
            await b.eval("(()=>{window.__opened=null;let D=window.hkDetail;if(D){let o=D.open.bind(D);D.open=function(a,b,c){window.__opened=c&&c.event&&c.event.title;return o(a,b,c)}}"
                         "let r=" + pane + ",ev=[...r.querySelectorAll('.ev2')].filter(e=>e.offsetParent);window.__want=ev[ev.length-1].querySelector('b').textContent;ev[ev.length-1].click()})()")
            assert await b.wait("window.__opened&&window.__opened===window.__want", 10), await b.eval('[window.__opened,window.__want]')
            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
                await b.screenshot(args.shots / 'blocks.png')
            exceptions = [line for line in b.console if line.startswith('EXCEPTION:')]
            assert not exceptions, exceptions
            print('PASS: keypad and vacuum blocks, rules switching in place, cameras following motion, the calendar\'s days, rows that fit and taps, the room\'s hidden accessories', flush=True)
            # THE EDITOR MAKES ROOM, in Playwright's Chromium (a finger) and WebKit (a mouse) at an iPad's size
            pw, node = os.environ.get('PLAYWRIGHT_PATH'), os.environ.get('NODE')
            if not (pw and Path(pw).exists() and node and Path(node).exists()):
                print('SKIPPED the editor making room: set PLAYWRIGHT_PATH and NODE (edit_mode_check.py\'s)')
                return
            failed = []
            for engine in ('chromium', 'webkit'):
                proc = await asyncio.create_subprocess_exec(node, str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE)
                await proc.communicate(json.dumps({
                    'origin': origin, 'cookie': cookie, 'screen': 'reflow', 'engine': engine, 'size': '1180x820',
                    'shots': str(args.shots or ''), 'chrome': os.environ.get('CHROME') or MAC_CHROME}).encode())
                if proc.returncode != 0:
                    failed.append(engine)
            assert not failed, 'the editor making room failed in ' + ', '.join(failed)

asyncio.run(main())
