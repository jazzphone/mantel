"""Round-two Home Grid interactions against the fictional home, never a household.

Checks live conditional swaps, one-camera selection, timer commands at a fake action
port, paused timers, the creation sheet, and the alarm sheet without a command.
"""
import asyncio
import sys
import tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]
import gallery
from cdp import Browser
from aiohttp.test_utils import TestServer


async def main():
    gallery.HOUSE['weather.grid_card'] = (None, ('rainy', dict(gallery.HOUSE['weather.home'][1][1])))
    gallery.HOUSE['binary_sensor.grid_condition'] = (None, ('off', {}))
    gallery.HOUSE['sensor.running_quick_timers'] = (None, ('1', {'running': [
        {'entity_id': 'timer.quick_1', 'name': 'Tea', 'finishes_at': '2099-01-01T00:00:00+00:00'}]}))
    gallery.HOUSE['timer.quick_1'] = (None, ('active', {'friendly_name': 'Tea', 'duration': '00:05:00', 'finishes_at': '2099-01-01T00:00:00+00:00'}))
    screen = 'grid-review'
    gallery.SETTINGS['boards'][screen] = {'home_style': 'grid', 'menu_custom': True, 'menu': 'tabbar', 'home_grid': {
        'v': 1, 'cols': 6, 'rows': 4, 'frame': [1280, 800], 'band': True, 'header_clock': False, 'header_weather': False, 'items': [
            {'id': 'conditional', 'card': 'clock', 'size': 'W', 'at': [0, 0],
             'when': {'kind': 'entity_state', 'entity': 'binary_sensor.grid_condition', 'state': 'on'}, 'fallback': {'card': 'weather'}},
            {'id': 'timer', 'card': 'timers', 'size': 'S', 'at': [2, 0]},
            {'id': 'security', 'card': 'security', 'size': 'W', 'at': [3, 0]},
            {'id': 'camera', 'card': 'camera', 'size': 'L', 'at': [0, 1], 'opts': {'entity': 'camera.backyard'}},
            {'id': 'room', 'card': 'room', 'size': 'L', 'at': [2, 1], 'opts': {'area': 'living_room'}},
            {'id': 'weather', 'card': 'weather', 'size': 'L', 'at': [4, 1], 'opts': {'entity': 'weather.grid_card', 'sky': True}}]}}
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        async with TestServer(app) as server, Browser(1280, 800, port=9393) as b:
            origin = str(server.make_url('')).rstrip('/')
            await b.restrict_origin(origin)
            await b.open(origin + '/' + screen + '/home', cookie)
            assert await b.wait('window.__mantelReady===true', 30)
            await b.eval(
                "window.deep=(r,s)=>[...r.querySelectorAll('*')].flatMap(e=>[...(e.matches(s)?[e]:[]),...(e.shadowRoot?deep(e.shadowRoot,s):[])]);"
                " window.conditional=deep(document,'hk-grid-conditional-card')[0]")
            assert await b.wait("conditional?._child?.localName==='hk-weather-band-card'", 10)
            bounds = await b.eval('(()=>{let r=conditional.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()')
            def state(entity, value, attrs):
                touched = app['hub'].store.apply_event({'a': {entity: {'s': value, 'lc': gallery.NOW, 'lu': gallery.NOW, 'a': attrs}}})
                app['hub'].on_change(touched)
            state('binary_sensor.grid_condition', 'on', {})
            assert await b.wait("conditional._child.localName==='hk-grid-clock-card'", 10)
            assert bounds == await b.eval('(()=>{let r=conditional.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()')
            state('binary_sensor.grid_condition', 'off', {})
            assert await b.wait("conditional._child.localName==='hk-weather-band-card'", 10)
            assert await b.eval("deep(document,'hk-camera-mosaic-card')[0]._config.cameras.length===1 && deep(document,'hk-camera-mosaic-card')[0]._config.cameras[0].entity==='camera.backyard'")
            assert await b.eval("deep(document,'hk-camera-mosaic-card')[0]._cams().length===1 && deep(document,'hk-camera-mosaic-card')[0]._cams()[0].entity==='camera.backyard'")
            assert await b.eval("deep(document,'hk-grid-room-card')[0].shadowRoot.querySelectorAll('hk-room-status-card').length===0")
            assert await b.eval("deep(document,'.band-clock,.band-weather').every(e=>getComputedStyle(e).display==='none')")
            assert await b.wait("!!deep(document,'hk-grid-weather-sky')[0]?._scene", 10)
            assert await b.eval("deep(document,'hk-grid-weather-sky')[0]._scene.el.classList.contains('skyonly')")
            assert await b.eval("(()=>{let e=deep(document,'hk-grid-weather-sky')[0];return e._scene.update(e._client).cond==='rainy'})()")
            assert await b.eval(
                "(()=>{let e=deep(document,'hk-grid-weather-sky')[0],a=e.getBoundingClientRect(),s=e._scene.el.getBoundingClientRect();"
                "return Math.abs(a.width-s.width)<1 && Math.abs(a.height-s.height)<1})()")
            await b.send('Emulation.setEmulatedMedia', features=[{'name': 'prefers-reduced-motion', 'value': 'reduce'}])
            assert await b.wait("deep(document,'hk-grid-weather-sky')[0]._scene.el.classList.contains('held')",5)
            await b.send('Emulation.setEmulatedMedia', features=[])
            await b.eval("window.wx=deep(document,'hk-weather-band-card').find(c=>c._config.sky);window.oldSky=deep(document,'hk-grid-weather-sky')[0];wx.setConfig({...wx._config,sky:false})")
            assert await b.wait("deep(document,'hk-grid-weather-sky').length===0 && oldSky._scene===null",5)
            await b.eval("wx.setConfig({...wx._config,sky:true})")
            assert await b.wait("!!deep(document,'hk-grid-weather-sky')[0]?._scene",5)
            # The group plate changes independently of its accessory pills.
            await b.eval(
                "window.room=deep(document,'hk-grid-room-card')[0];window.originalRoom=room._config;window.pillBackground=getComputedStyle(deep(room.shadowRoot,'hk-plate')[0]).background;"
                "room.setConfig({...originalRoom,surface:{color:'#345678',opacity:42,blur:'none'}})")
            assert await b.eval("getComputedStyle(room.shadowRoot.querySelector('.room')).backgroundColor==='rgba(52, 86, 120, 0.42)'")
            assert await b.eval("getComputedStyle(room.shadowRoot.querySelector('.room')).backdropFilter==='none'")
            assert await b.eval("getComputedStyle(deep(room.shadowRoot,'hk-plate')[0]).background===pillBackground")
            await b.eval("room.setConfig({...originalRoom,surface:{color:'#345678',opacity:42,blur:'light'}})")
            assert await b.eval("getComputedStyle(room.shadowRoot.querySelector('.room')).backdropFilter.includes('blur(20px)')")
            await b.eval('room.setConfig(originalRoom)')
            await b.eval(
                "window.timer=deep(document,'hk-timer-strip-card')[0]; window.calls=[];timer._call=(...args)=>{calls.push(args);return Promise.resolve(true)};"
                "timer.shadowRoot.querySelector('[data-service=pause]').click()")
            assert await b.eval("calls.length===1 && calls[0][0]==='timer' && calls[0][1]==='pause'")
            state('timer.quick_1', 'paused', {'friendly_name': 'Tea', 'remaining': '00:02:30', 'duration': '00:05:00'})
            state('sensor.running_quick_timers', '0', {'running': []})
            assert await b.wait("!!timer.shadowRoot.querySelector('[data-service=start]')", 10)
            assert await b.eval("timer.shadowRoot.querySelector('hk-countdown').getAttribute('hold')==='150'")
            await b.eval("timer.shadowRoot.querySelector('[data-service=start]').click();timer.shadowRoot.querySelector('[data-service=cancel]').click()")
            assert await b.eval("calls.map(c=>c[1]).join(',')==='pause,start,cancel'")
            state('timer.quick_1', 'idle', {'friendly_name': 'Tea'})
            assert await b.wait("!!timer.shadowRoot.querySelector('[data-new]')", 10)
            await b.eval("timer.shadowRoot.querySelector('[data-new]').click()")
            assert await b.wait("deep(document,'hk-timer-new-card').length>0", 10)
            await b.eval('hkDetail.close()')
            await b.eval("deep(document,'hk-grid-security-card')[0]._tap()")
            assert await b.wait("deep(document,'hk-alarm-keypad-card').length>0", 10)
            assert await b.eval('calls.length===3')
            state('alarm_control_panel.home', 'armed_away', {'friendly_name': 'Home Alarm', 'code_format': 'number'})
            # (what the block draws: the widget, since 2026-10-31, has no tile's _look)
            assert await b.wait("deep(document,'hk-grid-security-card')[0].shadowRoot.textContent.replace(/\\s+/g,'').includes('ArmedAway')", 10), \
                await b.eval("deep(document,'hk-grid-security-card')[0].shadowRoot.textContent")
            assert await b.eval('document.documentElement.scrollHeight<=innerHeight+1')
            errors = [line for line in b.console if line.startswith('EXCEPTION:')]
            assert not errors, errors
            print('PASS: live fallback swaps, fixed geometry, single camera, room contents, timer pause/resume/cancel and paused countdown, timer creation and alarm sheets')


if __name__ == '__main__':
    asyncio.run(main())
