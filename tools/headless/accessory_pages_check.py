"""Fictional collection paging, caption editing and content-sized person sheets."""
import asyncio, json, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]
import gallery
from cdp import Browser
from aiohttp.test_utils import TestServer

async def main():
    # Use the fictional home's real names, then add a scalar reading.
    entries = [{'entity': x} for x in list(gallery.HOUSE) if x.startswith(('light.', 'fan.'))][:4]
    gallery.HOUSE['sensor.grid_reading'] = (None, ('12', {'friendly_name': 'Air Quality', 'battery_level': 85}))
    entries.append({'entity': 'sensor.grid_reading', 'secondary': {'mode': 'attribute', 'attribute': 'battery_level', 'unit': '%'}})
    gallery.HOUSE['person.sam'] = (None, ('home', {'friendly_name': 'Sam', 'latitude': 40, 'longitude': -100, 'device_trackers': ['device_tracker.sam_phone']}))
    gallery.HOUSE['device_tracker.sam_phone'] = (None, ('home', {'friendly_name': 'Sam’s Phone'}))
    gallery.HOUSE['sensor.sam_phone_battery'] = (None, ('85', {'friendly_name': 'Sam’s Phone', 'device_class': 'battery', 'unit_of_measurement': '%'}))
    screen = 'collection-review'
    gallery.SETTINGS['boards'][screen] = {'home_style': 'grid', 'menu_custom': True, 'menu': 'tabbar', 'home_grid': {
        'v': 1, 'cols': 6, 'rows': 4, 'frame': [1280, 800], 'band': False, 'items': [
            {'id': 'group', 'card': 'accessories', 'size': 'L', 'at': [0, 0], 'opts': {'title': 'Selected Devices', 'accessories': entries}, 'pages': {'source': 'accessories'}},
            {'id': 'one', 'card': 'accessory', 'size': 'S', 'at': [2, 0], 'opts': {'entity': 'sensor.grid_reading', 'secondary': {'mode': 'attribute', 'attribute': 'battery_level', 'unit': '%'}}}]}}
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        from mantel_server.settings_store import load_model
        app['settings'].model = load_model()
        reg = app['hub'].registry
        entities = [dict(e, device_id='sam-phone') if e['entity_id'] in ('device_tracker.sam_phone', 'sensor.sam_phone_battery') else e for e in reg.entity_entries]
        reg.update(entities=entities)
        async with TestServer(app) as server, Browser(1280, 800, port=9394) as b:
            origin = str(server.make_url('')).rstrip('/')
            await b.restrict_origin(origin)
            await b.open(origin + '/' + screen + '/home', cookie)
            assert await b.wait('window.__mantelReady', 20)
            await b.eval("window.deep=(r,s)=>[...r.querySelectorAll('*')].flatMap(e=>[...(e.matches(s)?[e]:[]),...(e.shadowRoot?deep(e.shadowRoot,s):[])]);window.p=deep(document,'hk-pager-card')[0]")
            assert await b.wait('p?._pages?.length===2 && p._els[0]?._kids?.length===4', 10)
            await b.eval('p.goTo(1,false)')
            ready = await b.wait("p._els[1]?._kids?.length===1 && deep(p._els[1].shadowRoot,'.label')[0]?.textContent==='85 %'", 10)
            assert ready
            assert await b.eval(
                "(()=>{let g=p._els[1],slot=g.shadowRoot.querySelector('.slot'),box=g.shadowRoot.querySelector('.tiles');"
                "return slot.getBoundingClientRect().height<box.getBoundingClientRect().height*.6})()")
            st = app['hub'].store.apply_event({'a': {'sensor.grid_reading': {'s': '12', 'lc': gallery.NOW, 'lu': gallery.NOW + 1, 'a': {'friendly_name': 'Air Quality', 'battery_level': 72}}}})
            app['hub'].on_change(st)
            assert await b.wait("deep(p._els[1].shadowRoot,'.label')[0]?.textContent==='72 %'", 10)
            await b.eval("window.hkDetail.open('person.sam')")
            assert await b.wait("!!document.querySelector('.hkd.open hk-detail-person')?.shadowRoot?.querySelector('.map')", 10)
            assert await b.wait("getComputedStyle(document.querySelector('.hkd .sheet')).transform==='none'", 3)
            assert await b.eval(
                "(()=>{let sheet=document.querySelector('.hkd .sheet'),p=sheet.querySelector('hk-detail-person'),r=sheet.getBoundingClientRect(),c=p.getBoundingClientRect();"
                "return r.bottom-c.bottom<40 && r.height<650 && p.shadowRoot.querySelector('.map').getBoundingClientRect().height>=279})()")
            await b.eval(
                "(()=>{function font(r){let s=document.createElement('style');s.textContent='*{font-family:Arial,sans-serif!important}';(r.head||r).appendChild(s);"
                "for(let e of r.querySelectorAll('*'))if(e.shadowRoot)font(e.shadowRoot)}font(document)})()")
            await b.screenshot('/private/tmp/mantel-person-compact.png')
            await b.send('Emulation.setDeviceMetricsOverride', width=390, height=600, deviceScaleFactor=1, mobile=False)
            await b.eval('window.hkDetail.close()')
            await b.eval("window.hkDetail.open('person.sam')")
            assert await b.wait("!!document.querySelector('.hkd.open hk-detail-person')?.shadowRoot?.querySelector('.pp.one')", 10)
            assert await b.wait("getComputedStyle(document.querySelector('.hkd .sheet')).transform==='none'", 3)
            phone = await b.eval(
                "(()=>{let s=document.querySelector('.hkd .sheet'),b=s.querySelector('.body'),p=s.querySelector('hk-detail-person');b.scrollTop=b.scrollHeight;"
                "return {bottom:s.getBoundingClientRect().bottom,height:innerHeight,scroll:b.scrollTop,content:b.scrollHeight,body:b.clientHeight,"
                "map:p.shadowRoot.querySelector('.map').getBoundingClientRect().height}})()")
            assert phone['bottom']<=phone['height'] and (phone['content']<=phone['body'] or phone['scroll']>0) and phone['map']==240, phone
            await b.send('Emulation.setDeviceMetricsOverride', width=1280, height=800, deviceScaleFactor=1, mobile=False)
            await b.eval('window.hkDetail.close()')
            await b.open(origin + '/settings#/screens/' + screen + '/home-grid')
            assert await b.wait("!!document.querySelector('hk-settings-panel')?.shadowRoot?.querySelector('hk-grid-editor')?.previewView?.isConnected", 25)
            await b.eval(
                "window.ed=document.querySelector('hk-settings-panel').shadowRoot.querySelector('hk-grid-editor');ed.select('group');"
                "window.field=(root,label)=>[...root.querySelectorAll('.cell')].find(e=>e.querySelector('.t')?.textContent===label)?.querySelector('select');window.choose=(el,value)=>{el.value=value;"
                "el.dispatchEvent(new Event('change'))};choose(field(ed.sidebar,'Show'),'list')")
            assert await b.eval("ed.grid.items[0].pages.list.map(p=>p.opts.accessories.length).join()==='4,1'")
            await b.eval("[...[...ed.sidebar.querySelectorAll('.cell')].find(e=>e.querySelector('.t')?.textContent==='Size').querySelectorAll('[role=radio]')].find(r=>r.textContent==='Wide').click()")
            assert await b.eval("ed.grid.items[0].size==='L' && ed.message.textContent.includes('holds 2 accessories')")
            await b.eval("window.page2=[...ed.sidebar.querySelectorAll('.grp')].find(g=>g.querySelector('h2')?.textContent==='Page 2 of 2');choose(field(page2,'Line Under Name'),'state')")
            assert await b.eval("ed.grid.items[0].pages.list[1].opts.accessories[0].secondary.mode==='state'")
            await b.eval("page2=[...ed.sidebar.querySelectorAll('.grp')].find(g=>g.querySelector('h2')?.textContent==='Page 2 of 2');choose(field(page2,'Line Under Name'),'attribute')")
            await b.eval("page2=[...ed.sidebar.querySelectorAll('.grp')].find(g=>g.querySelector('h2')?.textContent==='Page 2 of 2');choose(field(page2,'Attribute'),'battery_level')")
            await ed_save(b)
            saved = app['settings'].store.body('board', screen)['home_grid']['items'][0]
            assert len(saved['pages']['list']) == 2 and saved['pages']['list'][1]['opts']['accessories'][0]['secondary']['attribute'] == 'battery_level'
            print('PASS: ordered automatic/custom pages, caption selection and live attributes, compact person sheet, save', flush=True)

async def ed_save(b):
    await b.eval('ed.save()')
    assert await b.wait('!ed.busy && !ed.dirty()', 20)
    assert not await b.eval("ed.message?.textContent.startsWith('Couldn')")

asyncio.run(main())
