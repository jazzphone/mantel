"""Home Grid editor: real mouse drag, draft/refusal/save, fictional home only.

    python tools/headless/grid_editor_smoke.py [--shots DIRECTORY]
"""
import asyncio, sys, tempfile, json, argparse
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]
PARSER = argparse.ArgumentParser(description=__doc__)
PARSER.add_argument('--shots', type=Path)
ARGS = PARSER.parse_args()
from gallery import build, SCREEN
from cdp import Browser
from aiohttp.test_utils import TestServer
async def screenshot_font(browser):
    # Documentation images never include Apple's licensed fonts or glyph files.
    await browser.eval("""(()=>{function visit(root){let style=document.createElement('style');style.textContent='*{font-family:Arial,sans-serif!important}';(root.head||root).appendChild(style);for(let e of root.querySelectorAll('*')){if(e.shadowRoot)visit(e.shadowRoot);if(e.localName==='iframe'){try{visit(e.contentDocument)}catch(x){}}}}visit(document)})()""")

async def main():
    with tempfile.TemporaryDirectory() as td:
        app,cookie=await build(Path(td))
        from mantel_server.settings_store import load_model
        app['settings'].model=load_model()
        from mantel_server.settings_store import Actor
        b=app['settings'].store.body('board',SCREEN)
        app['settings'].store.write([('board',SCREEN,{**b,'menu_custom':True,'menu':'tabbar'})],actor=Actor(label='editor smoke'))
        async with TestServer(app) as server, Browser(1600,1000) as b:
            origin=str(server.make_url('')).rstrip('/')
            await b.restrict_origin(origin)
            await b.open(origin+'/settings#/screens/'+SCREEN+'/home-grid',cookie)
            ready=await b.wait("!!document.querySelector('hk-settings-panel')?.shadowRoot?.querySelector('hk-grid-editor')?.shadowRoot?.querySelector('.tools')",10)
            assert ready
            print('editor ready',flush=True)
            await b.eval("window.ed=document.querySelector('hk-settings-panel').shadowRoot.querySelector('hk-grid-editor'); ed.starter('A')")
            ready=await b.wait('ed.previewView?.isConnected',30)
            print('live preview ready:', ready, flush=True)
            if ARGS.shots:
                ARGS.shots.mkdir(parents=True, exist_ok=True)
                await screenshot_font(b)
                await b.screenshot(ARGS.shots / 'home-grid-editor.png')

            assert ready
            assert await b.eval('ed.grid.items.length > 0')
            assert await b.eval("!ed.sidebar.querySelector('.screen-settings').open")
            await b.eval("ed.sidebar.querySelector('.screen-settings').open=true")
            assert await b.wait('ed.screenSettingsOpen===true', 5)
            await b.eval("[...ed.sidebar.querySelectorAll('.cell')].find(e=>e.textContent.includes('Header Clock')).querySelector('button').click()")
            assert await b.eval('ed.grid.header_clock===false && ed.grid.header_weather!==false')
            await b.eval("[...ed.sidebar.querySelectorAll('.cell')].find(e=>e.textContent.includes('Header Clock')).querySelector('button').click()")
            # Mouse drag between equal-size blocks must swap, and stay a draft.
            rects=await b.eval("['a7','a10'].map(id=>{let r=ed.overlay.querySelector('[data-id='+id+']').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})")
            a,z=rects
            await b.send('Input.dispatchMouseEvent', type='mousePressed', x=a['x'], y=a['y'], button='left', clickCount=1)
            await b.send('Input.dispatchMouseEvent', type='mouseMoved', x=z['x'], y=z['y'], button='left', buttons=1)
            await b.send('Input.dispatchMouseEvent', type='mouseReleased', x=z['x'], y=z['y'], button='left', clickCount=1)
            assert await b.eval("ed.grid.items.find(i=>i.id==='a7').at[1]===3 && ed.grid.items.find(i=>i.id==='a10').at[1]===2")
            assert await b.wait('ed.previewView?.isConnected && ed.previewView._config.cards.find(c=>c.hk_cell?.id==="a7").hk_cell.at[1]===3',10)
            # Every overlay matches its actual cell in the scaled iframe.
            geometry=await b.eval("(()=>{let fr=ed.iframe.getBoundingClientRect(),scale=fr.width/ed.grid.frame[0];return [...ed.overlay.querySelectorAll('.block')].every(btn=>{let r=btn.getBoundingClientRect(),c=ed.previewView.shadowRoot.querySelector('[data-id='+btn.dataset.id+']').getBoundingClientRect();return Math.abs(r.x-fr.x-c.x*scale)<2 && Math.abs(r.y-fr.y-c.y*scale)<2 && Math.abs(r.width-c.width*scale)<2 && Math.abs(r.height-c.height*scale)<2})})()")
            assert geometry
            assert await b.eval("(()=>{let w=ed.iframe.contentWindow,v=ed.previewView,p=v.shadowRoot.querySelector('[data-id=a2]').firstElementChild,room=p._els[p._index],plate=room.shadowRoot.querySelector('.room'),radius=parseFloat(w.getComputedStyle(plate).borderTopLeftRadius)*v._gridScale;return [...ed.overlay.querySelectorAll('.block,.slot')].every(e=>Math.abs(parseFloat(getComputedStyle(e).borderTopLeftRadius)-radius)<0.1)})()")
            print('drag swap and overlay geometry passed',flush=True)
            # Room paging has one starting-room choice; a selected room is respected on a desktop.
            await b.eval("ed.screenSettingsOpen=false;ed.select('a2');ed.update('a2',{opts:{area:'kitchen'},pages:{source:'rooms',start:'tablet_room'}})")
            assert await b.wait("ed.previewView?.shadowRoot.querySelector('[data-id=a2]')?.firstElementChild?._pages?.[ed.previewView.shadowRoot.querySelector('[data-id=a2]').firstElementChild._index]?.area==='kitchen'",15)
            assert await b.eval("[...ed.sidebar.querySelectorAll('button')].filter(e=>e.textContent==='Tap Weight'||e.textContent==='Glance Up, Touch Down').every(e=>e.closest('.screen-settings')&&!e.closest('.screen-settings').open&&!e.checkVisibility())")
            assert await b.eval("!ed.sidebar.textContent.includes('Start on Tablet’s Room') && ![...ed.sidebar.querySelectorAll('.cell')].some(e=>e.querySelector('select')&&e.textContent.startsWith('Area'))")
            assert await b.eval("[...ed.sidebar.querySelectorAll('.cell')].find(e=>e.textContent.startsWith('Starting Room')).querySelector('select').value==='kitchen'")
            await b.eval("(()=>{let s=[...ed.sidebar.querySelectorAll('.cell')].find(e=>e.textContent.startsWith('Starting Room')).querySelector('select');s.value='kitchen';s.dispatchEvent(new Event('change'))})()")
            assert await b.eval("ed.grid.items.find(i=>i.id==='a2').opts.area==='kitchen'&&!ed.grid.items.find(i=>i.id==='a2').pages.start")
            # Single-room mode uses the same selected room, then paging keeps it as the start.
            await b.eval("(()=>{let s=[...ed.sidebar.querySelectorAll('.cell')].find(e=>e.textContent.startsWith('Room Display')).querySelector('select');s.value='';s.dispatchEvent(new Event('change'))})()")
            assert await b.wait("ed.previewView?.shadowRoot.querySelector('[data-id=a2]')?.firstElementChild?.localName==='hk-grid-room-card'",15)
            assert await b.eval("ed.previewView.shadowRoot.querySelector('[data-id=a2]').firstElementChild._area()==='kitchen'")
            await b.eval("(()=>{let s=[...ed.sidebar.querySelectorAll('.cell')].find(e=>e.textContent.startsWith('Room Display')).querySelector('select');s.value='rooms';s.dispatchEvent(new Event('change'))})()")
            assert await b.wait("ed.previewView?.shadowRoot.querySelector('[data-id=a2]')?.firstElementChild?._pages?.[ed.previewView.shadowRoot.querySelector('[data-id=a2]').firstElementChild._index]?.area==='kitchen'",15)
            await b.eval("(()=>{let p=ed.previewView.shadowRoot.querySelector('[data-id=a2]').firstElementChild;p.goTo(0,false);ed.iframe.contentWindow.dispatchEvent(new Event('hk-idle-return'))})()")
            assert await b.wait("ed.previewView.shadowRoot.querySelector('[data-id=a2]').firstElementChild._pages[ed.previewView.shadowRoot.querySelector('[data-id=a2]').firstElementChild._index].area==='kitchen'",10)
            if ARGS.shots:
                await screenshot_font(b)
                await b.screenshot(ARGS.shots / 'home-grid-room-options.png')
            print('room start matches selected Kitchen, display modes agree, and starters stay in collapsed screen settings',flush=True)

            await b.eval('ed.catalog=true; ed.side()')
            assert await b.eval("ed.sidebar.querySelectorAll('.catalog-row').length === 18")
            assert await b.wait("[...ed.sidebar.querySelectorAll('.catalog-row hk-icon')].every(e=>!!e.drawn?.path)",10)
            if ARGS.shots:
                await screenshot_font(b)
                await b.screenshot(ARGS.shots / 'home-grid-gallery.png')
            # Real wheel scrolling stays in the side panel; the preview never moves.
            async def check_panel_scroll():
                before = await b.eval("(()=>{let r=ed.box.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
                point = await b.eval("(()=>{let r=ed.sidebar.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height-60}})()")
                assert await b.eval('ed.sidebar.scrollHeight > ed.sidebar.clientHeight')
                await b.send('Input.dispatchMouseEvent', type='mouseWheel', x=point['x'], y=point['y'], deltaX=0, deltaY=4000)
                assert await b.wait('ed.sidebar.scrollTop>0',5)
                assert before == await b.eval("(()=>{let r=ed.box.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
                assert await b.eval('ed.scrollTop===0 && ed.ui.scrollTop===0 && ed.box.getBoundingClientRect().bottom<=innerHeight')
                # At the panel's end, more wheel input must not escape to the editor.
                await b.eval('ed.sidebar.scrollTop=ed.sidebar.scrollHeight')
                await b.send('Input.dispatchMouseEvent', type='mouseWheel', x=point['x'], y=point['y'], deltaX=0, deltaY=4000)
                assert before == await b.eval("(()=>{let r=ed.box.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
                await b.eval('ed.sidebar.scrollTop=0')
            await check_panel_scroll()
            await b.eval("ed.sidebar.querySelector('[data-card=accessory]').click()")
            assert await b.eval("ed.sidebar.querySelectorAll('[data-preview-card] > iframe').length === 1")
            assert await b.wait("ed.sidebar.querySelector('[data-preview-card] iframe').contentWindow.galleryCard?._config.entity.startsWith('light.')",20)
            assert await b.eval("ed.sidebar.querySelector('.size-choices').textContent.includes('Small')")
            if ARGS.shots:
                await screenshot_font(b)
                await b.screenshot(ARGS.shots / 'home-grid-picker.png')
            for key in ('thermostat', 'weather', 'now_playing'):
                await b.eval(f"ed.pickerCard='{key}'; ed.pickerSize='L'; ed.side()")
                assert await b.wait("!!ed.sidebar.querySelector('[data-preview-card] iframe').contentWindow.galleryCard?.shadowRoot",20)
                assert await b.eval("ed.sidebar.textContent.includes('sample readings')")
                if key == 'thermostat':
                    assert await b.wait("ed.sidebar.querySelector('[data-preview-card] iframe').contentWindow.galleryCard?._state()?.attributes.current_temperature===71",10)
                if key == 'weather':
                    assert await b.wait("ed.sidebar.querySelector('[data-preview-card] iframe').contentWindow.galleryCard?.shadowRoot.querySelectorAll('.day').length===3",10)
            await b.eval("let it=ed.grid.items.find(i=>i.card==='camera');ed.select(it.id)")
            await b.eval("(()=>{let s=[...ed.sidebar.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='camera.backyard'));s.value='camera.backyard';s.dispatchEvent(new Event('change'))})()")
            assert await b.eval("(()=>{let it=ed.grid.items.find(i=>i.card==='camera');return !it.pages && it.opts.entity==='camera.backyard'})()")
            await b.eval("ed.select('a2'); [...ed.sidebar.querySelectorAll('.cell')].find(row=>row.textContent.includes('Custom Group Background')).querySelector('button').click()")
            assert await b.eval("ed.grid.items.find(i=>i.id==='a2').opts.surface.opacity===30")
            await b.eval("let opacity=ed.sidebar.querySelector('input[type=range]');opacity.value='42';opacity.dispatchEvent(new Event('input'));opacity.dispatchEvent(new Event('change'))")
            assert await b.eval("ed.grid.items.find(i=>i.id==='a2').opts.surface.opacity===42")
            if ARGS.shots:
                await screenshot_font(b)
                await b.screenshot(ARGS.shots / 'home-grid-background.png')
            await check_panel_scroll()
            # Short desktop windows scale the preview to the actual remaining height.
            await b.send('Emulation.setDeviceMetricsOverride', width=1280, height=650, deviceScaleFactor=1, mobile=False)
            assert await b.wait('ed.box.getBoundingClientRect().bottom<=innerHeight && ed.sidebar.getBoundingClientRect().bottom<=innerHeight',5)
            await check_panel_scroll()
            await b.send('Emulation.setDeviceMetricsOverride', width=1600, height=1000, deviceScaleFactor=1, mobile=False)
            await b.wait('ed.box.getBoundingClientRect().width>500',5)
            print('picker and settings scroll independently; preview stays visible at both desktop sizes',flush=True)
            # Both states of a conditional block stay in exactly the same cell.
            await b.eval("ed.select('a3'); ed.update('a3',{when:{kind:'music_playing'},fallback:{card:'weather'}}); ed.conditionPreview=false; ed.preview();void 0")
            assert await b.wait("ed.previewView?.querySelectorAll && ed.previewView._config.cards.some(c=>c.force===false)",10)
            assert await b.wait("(()=>{let c=ed.previewView.cards.find(c=>c.localName==='hk-grid-conditional-card'); return c?._child?.localName==='hk-weather-band-card'})()",10)
            await b.eval('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
            before = await b.eval("(()=>{let r=ed.overlay.querySelector('[data-id=a3]').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
            await b.eval("ed.conditionPreview=true; ed.preview();void 0")
            assert await b.wait("(()=>{let c=ed.previewView.cards.find(c=>c.localName==='hk-grid-conditional-card'); return c?._child?.localName==='hk-now-playing-card'})()",10)
            await b.eval('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
            after = await b.eval("(()=>{let r=ed.overlay.querySelector('[data-id=a3]').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
            assert all(abs(a-z) < 1 for a, z in zip(before, after)), (before, after)
            await b.eval("ed.conditionPreview=null; ed.update('a3',{when:null,fallback:null}); ed.catalog=false; ed.side()")

            # Refusal leaves the draft intact and the editor usable.
            await b.eval("ed.originalActions=ed.panel.actions;ed.panel.actions=()=>({callWS:()=>Promise.reject(new Error('Fictional refusal'))});ed.save()")
            assert await b.eval("ed.isConnected && !ed.busy && ed.message.textContent.includes('Fictional refusal')")
            await b.eval('ed.panel.actions=ed.originalActions')
            # No save before Save.
            assert not app['settings'].store.body('board',SCREEN).get('home_grid')
            await b.eval("ed.grid.band=false; ed.change(ed.grid); ed.save()")

            assert app['settings'].store.body('board',SCREEN).get('home_style')=='grid'
            print('refusal preserved draft; Save applied one layout',flush=True)
            # History restores only a draft; Copy applies only the layout to the other screen.
            saved = app['settings'].store.body('board',SCREEN)['home_grid']
            app['settings'].store.write([('board','dashboard-copy',{'title':'Other Screen','pages':['weather'],'menu':'tabbar','menu_custom':True})], actor=Actor(label='editor smoke'))
            await b.open(origin+'/settings#/screens/'+SCREEN+'/home-grid')
            assert await b.wait("!!document.querySelector('hk-settings-panel')?.shadowRoot?.querySelector('hk-grid-editor')?.shadowRoot?.querySelector('.tools')",20)
            await b.eval("window.ed=document.querySelector('hk-settings-panel').shadowRoot.querySelector('hk-grid-editor'); ed.history()")
            assert await b.eval('ed.histories.length > 0')
            latest=app['settings'].store.get('board',SCREEN).version
            # Editing and then restoring history leaves the saved screen alone.
            await b.eval("ed.grid.band=true;ed.change(ed.grid);void ed.restore(ed.histories[0])")
            assert await b.wait("[...ed.shadowRoot.querySelectorAll('button')].some(b=>b.textContent==='Restore Draft')",5)
            await b.eval("[...ed.shadowRoot.querySelectorAll('button')].find(b=>b.textContent==='Restore Draft').click()")
            assert await b.eval('ed.grid.band===false')
            assert app['settings'].store.get('board',SCREEN).version==latest
            await b.eval("void ed.copyTo('dashboard-copy')")
            assert await b.wait("[...ed.shadowRoot.querySelectorAll('button')].some(b=>b.textContent==='Copy Layout')",5)
            await b.eval("[...ed.shadowRoot.querySelectorAll('button')].find(b=>b.textContent==='Copy Layout').click()")
            assert await b.wait("ed.message.textContent==='Layout copied.'",5)
            target=app['settings'].store.body('board','dashboard-copy')
            assert target['home_grid']==saved and target['pages']==['weather']
            # Cancel a subsequent edit: the original screen's version does not advance.
            await b.eval("ed.grid.band=true;ed.change(ed.grid);void ed.cancel()")
            assert await b.wait("[...ed.shadowRoot.querySelectorAll('button')].some(b=>b.textContent==='Discard')",5)
            await b.eval("[...ed.shadowRoot.querySelectorAll('button')].find(b=>b.textContent==='Discard').click()")
            assert not await b.eval('ed.isConnected')
            assert app['settings'].store.get('board',SCREEN).version==latest
            print('history draft, copy preserving target options, Cancel without a write passed',flush=True)
            await b.send('Emulation.setDeviceMetricsOverride', width=1280, height=800, deviceScaleFactor=1, mobile=False)
            await b.open(origin+'/'+SCREEN+'/home')
            assert await b.wait("!!window.__mantelReady && window.hkShell?.view()?.localName==='hk-home-grid-view'",30)
            assert await b.eval('document.documentElement.scrollHeight <= innerHeight + 1')
            if ARGS.shots:
                await asyncio.sleep(1)
                await screenshot_font(b)
                await b.screenshot(ARGS.shots / 'home-grid.png')
            exceptions=[line for line in b.console if line.startswith('EXCEPTION:')]
            assert not exceptions, exceptions
            print('PASS: editor drag, geometry, catalog, refusal, draft/save and no-scroll grid',flush=True)
asyncio.run(main())
