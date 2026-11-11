"""Home Grid editor: real mouse drag, draft/refusal/save, fictional home only.

    python tools/headless/grid_editor_smoke.py [--shots DIRECTORY]
"""
import asyncio
import json, sys, tempfile, json, argparse
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
            # A touch screen (an iPad) gets the editor too, and Settings follows the device's dark appearance.
            await b.send('Emulation.setTouchEmulationEnabled', enabled=True, maxTouchPoints=5)
            await b.send('Emulation.setEmulatedMedia', features=[{'name': 'pointer', 'value': 'coarse'}, {'name': 'prefers-color-scheme', 'value': 'dark'}])
            await b.open(origin+'/settings#/screens/'+SCREEN+'/home-grid',cookie)
            assert await b.wait(
                "(()=>{let p=document.querySelector('hk-settings-panel'),e=p?.shadowRoot?.querySelector('hk-grid-editor');"
                "return !!e?.ui && matchMedia('(pointer:coarse)').matches && getComputedStyle(e.shadowRoot.querySelector('.work')).display!=='none' && "
                "getComputedStyle(e.shadowRoot.querySelector('.desktop-note')).display==='none' && p.hasAttribute('dark')})()",20)
            await b.send('Emulation.setEmulatedMedia', features=[{'name': 'prefers-color-scheme', 'value': 'light'}])
            assert await b.wait("!document.querySelector('hk-settings-panel').hasAttribute('dark')",5)
            await b.send('Emulation.setTouchEmulationEnabled', enabled=False)
            await b.send('Emulation.setEmulatedMedia', features=[])
            print('touch screens get the editor; Settings follows the device to dark and back',flush=True)
            await b.open(origin+'/settings#/screens/'+SCREEN+'/home-grid',cookie)
            ready=await b.wait("!!document.querySelector('hk-settings-panel')?.shadowRoot?.querySelector('hk-grid-editor')?.shadowRoot?.querySelector('.tools')",10)
            assert ready
            print('editor ready',flush=True)
            await b.eval("window.ed=document.querySelector('hk-settings-panel').shadowRoot.querySelector('hk-grid-editor');void 0")
            # The starters: each with a map of the blocks it would put on this screen.
            assert await b.wait("!!ed.starterGrids && ed.sidebar.querySelectorAll('.starter[data-starter]').length===8", 20)
            assert await b.eval("[...ed.sidebar.querySelectorAll('.starter[data-starter]')].every(s=>s.dataset.starter==='empty'||s.querySelectorAll('.mini i').length>=6)")
            assert await b.eval("Object.values(ed.starterGrids).every(g=>g.items.reduce((n,i)=>n+({S:1,W:2,T:2,L:4,XL:6,XXL:12})[i.size],0)>=20)")
            if ARGS.shots:
                ARGS.shots.mkdir(parents=True, exist_ok=True)
                await asyncio.sleep(0.5)
                await screenshot_font(b)
                await b.screenshot(ARGS.shots / 'home-grid-starters.png')
            await b.eval("ed.sidebar.querySelector('[data-starter=R]').click()")
            assert await b.wait("ed.grid?.items.some(i=>i.card==='room'&&i.size==='XL')", 10)
            await b.eval("void ed.starter('A')")
            assert await b.wait("[...ed.shadowRoot.querySelectorAll('button')].some(b=>b.textContent==='Use Starter')",5)
            await b.eval("[...ed.shadowRoot.querySelectorAll('button')].find(b=>b.textContent==='Use Starter').click()")
            assert await b.wait("ed.grid.items.some(i=>i.card==='scene_suggested')", 10)
            await b.eval("ed.undoStack=[];ed.undoButton.disabled=true")
            ready=await b.wait('ed.previewView?.isConnected',30)
            print('live preview ready:', ready, flush=True)
            if ARGS.shots:
                await screenshot_font(b)
                await b.screenshot(ARGS.shots / 'home-grid-editor.png')

            assert ready
            assert await b.eval('ed.grid.items.length > 0')
            # A preview that fails says why, steps aside to a strip, keeps the blocks usable, and recovers.
            await b.eval(
                "window.realGenerate=ed.iframe.contentWindow.hkStrategy.generate;ed.iframe.contentWindow.hkStrategy.generate=async()=>{throw new Error('Fictional failure')};ed.previewView=null;"
                "ed.preview();void 0")
            assert await b.wait("ed.box.getAttribute('data-loading')==='slow' && ed.box.getAttribute('data-why').includes('Fictional failure')", 10)
            assert await b.eval("ed.overlay.querySelectorAll('.block').length===ed.grid.items.length && ed.overlay.getBoundingClientRect().width>200")
            await b.eval("ed.iframe.contentWindow.hkStrategy.generate=realGenerate;ed.preview();void 0")
            assert await b.wait("!ed.box.hasAttribute('data-loading') && !!ed.previewView?.isConnected", 15)
            print('a failing preview says why and leaves the blocks usable',flush=True)
            # a new room block scrolls through all its accessories
            assert await b.eval("ed.grid.items.find(i=>i.card==='room').opts.accessory_display==='scroll'")
            assert await b.eval("!ed.sidebar.querySelector('.screen-settings').open")
            await b.eval("ed.sidebar.querySelector('.screen-settings').open=true")
            assert await b.wait('ed.screenSettingsOpen===true', 5)
            await b.eval("[...ed.sidebar.querySelectorAll('.cell')].find(e=>e.querySelector('.t')?.textContent==='Clock').querySelector('button').click()")
            assert await b.eval('ed.grid.header_clock===false && ed.grid.header_weather!==false')
            await b.eval("[...ed.sidebar.querySelectorAll('.cell')].find(e=>e.querySelector('.t')?.textContent==='Clock').querySelector('button').click()")
            # A card dragged out of the palette lands where its footprint shows; a taken space refuses it.
            await b.eval("ed.remove('a8')")
            assert await b.eval("!ed.grid.items.some(i=>i.id==='a8') && !ed.undoButton.disabled")
            async def palette_drag(card, cell):
                src = await b.eval("(()=>{let e=ed.palette.querySelector('[data-card=%s]');e.scrollIntoView({block:'center'});let r=e.getBoundingClientRect();return {x:r.x+30,y:r.y+20}})()" % card)
                dst = await b.eval("(()=>{let r=ed.overlay.querySelectorAll('.slot')[%d].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()" % cell)
                await b.send('Input.dispatchMouseEvent', type='mousePressed', x=src['x'], y=src['y'], button='left', clickCount=1, buttons=1)
                for i in range(1, 11):
                    await b.send('Input.dispatchMouseEvent', type='mouseMoved', x=src['x'] + (dst['x'] - src['x']) * i / 10, y=src['y'] + (dst['y'] - src['y']) * i / 10, button='left', buttons=1)
                assert await b.eval("!!ed.overlay.querySelector('.ghost') && !!ed.shadowRoot.querySelector('.float')")
                bad = await b.eval("ed.overlay.querySelector('.ghost').classList.contains('bad')")
                # (what the held card says it would do: the blocks it replaces, marked, and the hint line's words)
                palette_drag.held = await b.eval(
                    "({replace:ed.overlay.querySelector('.ghost').classList.contains('replace'),going:[...ed.overlay.querySelectorAll('.block.going')].map(x=>x.dataset.id),"
                    "note:ed.stage.querySelector('.note').textContent})")
                await b.send('Input.dispatchMouseEvent', type='mouseReleased', x=dst['x'], y=dst['y'], button='left', clickCount=1)
                assert await b.eval("!ed.overlay.querySelector('.ghost') && !ed.shadowRoot.querySelector('.float')")
                return bad
            await b.eval("ed.paletteSizes.security='S';ed.drawPalette()")
            assert not await palette_drag('security', 18)            # column 1, row 4: the space a8 left
            assert await b.eval("(()=>{let it=ed.grid.items.find(i=>i.card==='security'&&i.at.join()==='0,3');return !!it && it.size==='S' && ed.selected===it.id})()")
            # a taken space on a full grid (the Small security just filled the last cell): the card takes the cells it
            # covers and the block there goes -- marked while held, named in the hint line, one Undo brings it back
            before_taken = await b.eval('JSON.stringify(ed.grid)')
            assert not await palette_drag('security', 1)
            assert palette_drag.held['replace'] and len(palette_drag.held['going']) == 1 and palette_drag.held['note'].startswith('Dropping here replaces '), palette_drag.held
            assert await b.eval("ed.grid.items.filter(i=>i.card==='security').length===2 && ed.grid.items.length===" + str(
                len(json.loads(before_taken)['items'])) + " && ed.message.textContent.includes('was replaced by Security')"), await b.eval('ed.message.textContent')
            assert await b.eval("!ed.stage.querySelector('.note').classList.contains('warn') && ed.stage.querySelector('.note').textContent.startsWith('Drag a card')")
            await b.eval("ed.undo()")
            assert await b.eval('JSON.stringify(ed.grid)===' + json.dumps(before_taken))
            await b.eval("ed.undo()")
            assert await b.eval("!ed.grid.items.some(i=>i.card==='security'&&i.at.join()==='0,3')")
            await b.eval("ed.undo()")
            assert await b.eval("ed.grid.items.some(i=>i.id==='a8') && ed.undoButton.disabled===false")
            # Delete on a chosen block removes it; Escape lets it go.
            await b.eval("ed.select('a8');ed.overlay.querySelector('[data-id=a8]').focus()")
            await b.send('Input.dispatchKeyEvent', type='keyDown', key='Delete', code='Delete', windowsVirtualKeyCode=46)
            await b.send('Input.dispatchKeyEvent', type='keyUp', key='Delete', code='Delete', windowsVirtualKeyCode=46)
            assert await b.eval("!ed.grid.items.some(i=>i.id==='a8')")
            await b.eval("ed.undo();ed.select(null)")
            assert await b.eval("ed.grid.items.some(i=>i.id==='a8') && ed.sidebar.textContent.includes('Screen')")
            print('palette drag, refusal, undo and delete passed',flush=True)
            # Mouse drag between equal-size blocks must swap, and stay a draft.
            rects=await b.eval("['a7','a10'].map(id=>{let r=ed.overlay.querySelector('[data-id='+id+']').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})")
            a,z=rects
            await b.send('Input.dispatchMouseEvent', type='mousePressed', x=a['x'], y=a['y'], button='left', clickCount=1)
            await b.send('Input.dispatchMouseEvent', type='mouseMoved', x=z['x'], y=z['y'], button='left', buttons=1)
            await b.send('Input.dispatchMouseEvent', type='mouseReleased', x=z['x'], y=z['y'], button='left', clickCount=1)
            assert await b.eval("ed.grid.items.find(i=>i.id==='a7').at[1]===3 && ed.grid.items.find(i=>i.id==='a10').at[1]===2")
            assert await b.wait('ed.previewView?.isConnected && ed.previewView._config.cards.find(c=>c.hk_cell?.id==="a7").hk_cell.at[1]===3',10)
            # Every overlay matches its actual cell in the scaled iframe.
            geometry=await b.eval(
                "(()=>{let fr=ed.iframe.getBoundingClientRect(),scale=fr.width/ed.grid.frame[0];"
                "return [...ed.overlay.querySelectorAll('.block')].every(btn=>{let "
                "r=btn.getBoundingClientRect(),c=ed.previewView.shadowRoot.querySelector('[data-id='+btn.dataset.id+']').getBoundingClientRect();"
                "return Math.abs(r.x-fr.x-c.x*scale)<2 && Math.abs(r.y-fr.y-c.y*scale)<2 && Math.abs(r.width-c.width*scale)<2 && Math.abs(r.height-c.height*scale)<2})})()")
            assert geometry
            assert await b.eval(
                "(()=>{let w=ed.iframe.contentWindow,v=ed.previewView,p=v.shadowRoot.querySelector('[data-id=a2]').firstElementChild,room=p._els[p._index],"
                "plate=room.shadowRoot.querySelector('.room'),radius=parseFloat(w.getComputedStyle(plate).borderTopLeftRadius)*v._gridScale;return [...ed.overlay.querySelectorAll('.block,"
                ".slot')].every(e=>Math.abs(parseFloat(getComputedStyle(e).borderTopLeftRadius)-radius)<0.1)})()")
            print('drag swap and overlay geometry passed',flush=True)
            # Room paging has one starting-room choice; a selected room is respected on a desktop.
            await b.eval("ed.screenSettingsOpen=false;ed.select('a2');ed.update('a2',{opts:{area:'kitchen'},pages:{source:'rooms',start:'tablet_room'}})")
            assert await b.wait("ed.previewView?.shadowRoot.querySelector('[data-id=a2]')?.firstElementChild"
                "?._pages?.[ed.previewView.shadowRoot.querySelector('[data-id=a2]').firstElementChild._index]?.area==='kitchen'",15)
            assert await b.eval(
                "[...ed.sidebar.querySelectorAll('button')].filter(e=>e.textContent==='Tap Weight'||e.textContent==='Glance Up, Touch "
                "Down').every(e=>e.closest('.screen-settings')&&!e.closest('.screen-settings').open&&!e.checkVisibility())")
            assert await b.eval(
                "!ed.sidebar.textContent.includes('Start on Tablet’s Room') && ![...ed.sidebar.querySelectorAll('.cell')].some(e=>e.querySelector('select')&&e.textContent.startsWith('Area'))")
            assert await b.eval("[...ed.sidebar.querySelectorAll('.cell')].find(e=>e.textContent.startsWith('Starting Room')).querySelector('select').value==='kitchen'")
            await b.eval(
                "(()=>{let s=[...ed.sidebar.querySelectorAll('.cell')].find(e=>e.textContent.startsWith('Starting Room')).querySelector('select');s.value='kitchen';"
                "s.dispatchEvent(new Event('change'))})()")
            assert await b.eval("ed.grid.items.find(i=>i.id==='a2').opts.area==='kitchen'&&!ed.grid.items.find(i=>i.id==='a2').pages.start")
            # Single-room mode uses the same selected room, then paging keeps it as the start.
            await b.eval(
                "(()=>{let s=[...ed.sidebar.querySelectorAll('.cell')].find(e=>e.querySelector('.t')?.textContent==='Show').querySelector('select');s.value='';s.dispatchEvent(new Event('change'))})()"
                )
            assert await b.wait("ed.previewView?.shadowRoot.querySelector('[data-id=a2]')?.firstElementChild?.localName==='hk-grid-room-card'",15)
            assert await b.eval("ed.previewView.shadowRoot.querySelector('[data-id=a2]').firstElementChild._area()==='kitchen'")
            await b.eval(
                "(()=>{let s=[...ed.sidebar.querySelectorAll('.cell')].find(e=>e.querySelector('.t')?.textContent==='Show').querySelector('select');s.value='rooms';"
                "s.dispatchEvent(new Event('change'))})()")
            assert await b.wait("ed.previewView?.shadowRoot.querySelector('[data-id=a2]')?.firstElementChild"
                "?._pages?.[ed.previewView.shadowRoot.querySelector('[data-id=a2]').firstElementChild._index]?.area==='kitchen'",15)
            await b.eval("(()=>{let p=ed.previewView.shadowRoot.querySelector('[data-id=a2]').firstElementChild;p.goTo(0,false);ed.iframe.contentWindow.dispatchEvent(new Event('hk-idle-return'))})()")
            assert await b.wait(
                "ed.previewView.shadowRoot.querySelector('[data-id=a2]').firstElementChild._pages[ed.previewView.shadowRoot.querySelector('[data-id=a2]').firstElementChild._index].area==='kitchen'",
                10)
            if ARGS.shots:
                await screenshot_font(b)
                await b.screenshot(ARGS.shots / 'home-grid-room-options.png')
            print('room start matches selected Kitchen, display modes agree, and starters stay in collapsed screen settings',flush=True)

            await b.eval('ed.select(null)')
            # SCREEN TYPES: the draft's grid names its type; Phone, Portrait re-packs the blocks onto 2 x 5, asks
            # before dropping what can't fit, and Undo brings the 6-column layout back
            before = await b.eval('JSON.stringify(ed.grid)')
            assert await b.eval("[...ed.sidebar.querySelectorAll('select')].some(s=>[...s.options].some(o=>o.value==='phone_portrait'))")
            await b.eval('ed.screenType("phone_portrait");void 0')
            if await b.wait("[...ed.shadowRoot.querySelectorAll('button')].some(b=>b.textContent==='Use Phone, Portrait')", 3):
                await b.eval("[...ed.shadowRoot.querySelectorAll('button')].find(b=>b.textContent==='Use Phone, Portrait').click()")
            assert await b.wait("ed.grid.cols===2 && ed.grid.rows===5 && ed.grid.band===false && ed.grid.frame.join()==='390,844'", 5), await b.eval('JSON.stringify(ed.grid)')
            fit = await b.eval("ed.grid.items.every(it=>{let z={S:[1,1],W:[2,1],T:[1,2],L:[2,2],XL:[3,2],XXL:[6,2]}[it.size];return it.at[0]+z[0]<=2&&it.at[1]+z[1]<=5})")
            assert fit and await b.eval('ed.grid.items.length') >= 1
            await b.eval('ed.undo();void 0')
            assert await b.wait('JSON.stringify(ed.grid)===' + json.dumps(before), 5)
            print('screen types re-pack the draft, ask before dropping blocks, and undo', flush=True)
            # VIEWS: a second view added from the Views row, a block added there stays there, the grid shows only it,
            # and removing the view (it has a block: asked first) takes them both away
            views_before = await b.eval('JSON.stringify(ed.grid)')
            await b.eval("[...ed.sidebar.querySelectorAll('[role=radio]')].find(x=>x.textContent.trim()==='+').click()")
            assert await b.wait('ed.grid.views===2', 5), await b.eval('JSON.stringify(ed.grid.views)')
            await b.eval("ed.addCard('clock','S');void 0")
            assert await b.wait("ed.grid.items.some(i=>i.card==='clock'&&i.size==='S'&&i.view===1)", 5)
            shown = await b.eval("[...ed.overlay.querySelectorAll('.block')].map(x=>x.dataset.id)")
            ids1 = await b.eval("ed.grid.items.filter(i=>i.view===1).map(i=>i.id)")
            assert shown == ids1, (shown, ids1)
            await b.eval('ed.select(null);void 0')
            await b.eval("[...ed.sidebar.querySelectorAll('button')].find(x=>x.textContent.includes('Remove View 2')).click()")
            assert await b.wait("[...ed.shadowRoot.querySelectorAll('button')].some(b=>b.textContent==='Remove View')", 5)
            await b.eval("[...ed.shadowRoot.querySelectorAll('button')].find(b=>b.textContent==='Remove View').click()")
            assert await b.wait('JSON.stringify(ed.grid)===' + json.dumps(views_before), 5), await b.eval('JSON.stringify(ed.grid)')
            print('views: added, edited one at a time, removed with their blocks', flush=True)
            # every block of the catalog is a row (2026-10-31: On Now, To-do and Energy Rings were not), by its name
            assert await b.eval("ed.palette.querySelectorAll('.pal-row').length === Object.keys(hkGridCatalog.table()).filter(k=>ed.sizesOf(k).length).length")
            assert await b.eval("['on_now','todo','energy_rings'].every(k=>!!ed.palette.querySelector('[data-card='+k+']'))")
            assert await b.eval("[...ed.palette.querySelectorAll('.pal-row b')].map(x=>x.textContent).filter(x=>['On Now','To-do','Energy Rings'].includes(x)).length===3")
            assert await b.wait("[...ed.palette.querySelectorAll('.pal-row > hk-icon')].every(e=>!!e.drawn?.path)",10)
            if ARGS.shots:
                await screenshot_font(b)
                await b.screenshot(ARGS.shots / 'home-grid-gallery.png')
            # Real wheel scrolling stays in the side panel; the preview never moves.
            async def check_panel_scroll():
                before = await b.eval("(()=>{let r=ed.box.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
                for pane in ('palette', 'sidebar'):
                    if not await b.eval(f'ed.{pane}.scrollHeight > ed.{pane}.clientHeight'):
                        continue
                    point = await b.eval(f"(()=>{{let r=ed.{pane}.getBoundingClientRect();return {{x:r.x+r.width/2,y:r.y+r.height-60}}}})()")
                    await b.send('Input.dispatchMouseEvent', type='mouseWheel', x=point['x'], y=point['y'], deltaX=0, deltaY=4000)
                    assert await b.wait(f'ed.{pane}.scrollTop>0',5)
                    assert before == await b.eval("(()=>{let r=ed.box.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
                    assert await b.eval('ed.scrollTop===0 && ed.ui.scrollTop===0 && ed.box.getBoundingClientRect().bottom<=innerHeight')
                    # At the panel's end, more wheel input must not escape to the editor.
                    await b.eval(f'ed.{pane}.scrollTop=ed.{pane}.scrollHeight')
                    await b.send('Input.dispatchMouseEvent', type='mouseWheel', x=point['x'], y=point['y'], deltaX=0, deltaY=4000)
                    assert before == await b.eval("(()=>{let r=ed.box.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
                    await b.eval(f'ed.{pane}.scrollTop=0')
                assert await b.eval('ed.palette.scrollHeight > ed.palette.clientHeight')
            await check_panel_scroll()
            src = await b.eval("(()=>{let e=ed.palette.querySelector('[data-card=accessory]');e.scrollIntoView({block:'center'});let r=e.getBoundingClientRect();return {x:r.x+30,y:r.y+20}})()")
            await b.send('Input.dispatchMouseEvent', type='mousePressed', x=src['x'], y=src['y'], button='left', clickCount=1, buttons=1)
            await b.send('Input.dispatchMouseEvent', type='mouseReleased', x=src['x'], y=src['y'], button='left', clickCount=1)
            assert await b.wait("ed.pickerCard==='accessory'",5)
            assert await b.eval("ed.palette.querySelectorAll('[data-preview-card] > iframe').length === 1")
            assert await b.wait("ed.palette.querySelector('[data-preview-card] iframe').contentWindow.galleryCard?._config.entity.startsWith('light.')",20)
            assert await b.eval("ed.palette.querySelector('[data-card=accessory] .chips').textContent.includes('Small')")
            await b.eval("ed.palette.querySelector('.pal-detail').scrollIntoView({block:'center'})")
            if ARGS.shots:
                await screenshot_font(b)
                await b.screenshot(ARGS.shots / 'home-grid-picker.png')
            for key in ('thermostat', 'weather', 'now_playing'):
                await b.eval(f"ed.pickerCard='{key}'; ed.paletteSizes['{key}']='L'; ed.side()")
                assert await b.wait("!!ed.palette.querySelector('[data-preview-card] iframe').contentWindow.galleryCard?.shadowRoot",20)
                assert await b.eval("ed.palette.textContent.includes('Sample readings')")
                if key == 'thermostat':
                    assert await b.wait("ed.palette.querySelector('[data-preview-card] iframe').contentWindow.galleryCard?._state()?.attributes.current_temperature===71",10)
                if key == 'weather':
                    assert await b.wait("ed.palette.querySelector('[data-preview-card] iframe').contentWindow.galleryCard?.shadowRoot.querySelectorAll('.day').length>=3",10)
            await b.eval("ed.pickerCard=null;let it=ed.grid.items.find(i=>i.card==='camera');ed.select(it.id)")
            # Swipe All Cameras hides the one-camera choice; One Camera shows it
            assert await b.eval("![...ed.sidebar.querySelectorAll('select')].some(s=>[...s.options].some(o=>o.value==='camera.backyard'))")
            await b.eval(
                "(()=>{let s=[...ed.sidebar.querySelectorAll('.cell')].find(e=>e.querySelector('.t')?.textContent==='Show').querySelector('select');s.value='';s.dispatchEvent(new Event('change'))})()"
                )
            await b.eval(
                "(()=>{let s=[...ed.sidebar.querySelectorAll('select')].find(s=>[...s.options].some(o=>o.value==='camera.backyard'));s.value='camera.backyard';s.dispatchEvent(new Event('change'))})()"
                )
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
            # Rules: the default and each rule's card fill exactly the same cell, and the panel builds them.
            await b.eval("ed.select('a3'); ed.update('a3',{rules:[{when:{all:[{kind:'music_playing'}]},card:'weather'}]}); ed.conditionPreview=0; ed.preview();void 0")
            assert await b.wait("ed.previewView?.querySelectorAll && ed.previewView._config.cards.some(c=>c.force===0)",10)
            assert await b.wait("(()=>{let c=ed.previewView.cards.find(c=>c.localName==='hk-grid-conditional-card'); return c?._child?.localName==='hk-weather-band-card'})()",10)
            await b.eval('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
            before = await b.eval("(()=>{let r=ed.overlay.querySelector('[data-id=a3]').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
            await b.eval("ed.conditionPreview=-1; ed.preview();void 0")
            assert await b.wait("(()=>{let c=ed.previewView.cards.find(c=>c.localName==='hk-grid-conditional-card'); return c?._child?.localName==='hk-now-playing-card'})()",10)
            await b.eval('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
            after = await b.eval("(()=>{let r=ed.overlay.querySelector('[data-id=a3]').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()")
            assert all(abs(a-z) < 1 for a, z in zip(before, after)), (before, after)
            # the panel: And Also adds a condition, a time window's From, Add Rule, Remove Rule
            await b.eval("ed.conditionPreview=null; ed.side()")
            assert await b.eval("ed.sidebar.textContent.includes('Rule 1 · Weather') && ed.sidebar.textContent.includes('Then Show: Weather')")
            await b.eval(
                "(()=>{let s=[...ed.sidebar.querySelectorAll('.cell')].find(e=>e.querySelector('.t')?.textContent==='And Also').querySelector('select');s.value='time';"
                "s.dispatchEvent(new Event('change'))})()")
            assert await b.eval("JSON.stringify(ed.grid.items.find(i=>i.id==='a3').rules[0].when.all)===JSON.stringify([{kind:'music_playing'},{kind:'time',from:'06:00',to:'09:00'}])")
            await b.eval("[...ed.sidebar.querySelectorAll('button')].find(b=>b.textContent==='Add Rule').click()")
            assert await b.eval("ed.grid.items.find(i=>i.id==='a3').rules.length===2")
            await b.eval("[...ed.sidebar.querySelectorAll('button')].filter(b=>b.textContent==='Remove Rule').pop().click()")
            assert await b.eval("ed.grid.items.find(i=>i.id==='a3').rules.length===1")
            print('rules: default and rule cards share one cell; conditions and rules are added and removed',flush=True)

            # Refusal leaves the draft intact and the editor usable.
            await b.eval("ed.originalActions=ed.panel.actions;ed.panel.actions=()=>({callWS:()=>Promise.reject(new Error('Fictional refusal'))});ed.save()")
            assert await b.eval("ed.isConnected && !ed.busy && ed.message.textContent.includes('Fictional refusal')")
            await b.eval('ed.panel.actions=ed.originalActions')
            # No save before Save.
            assert not app['settings'].store.body('board',SCREEN).get('home_grid')
            await b.eval("ed.grid.band=false; ed.change(ed.grid); ed.save()")
            assert await b.wait("!ed.isConnected", 10)
            saved_a3 = next(i for i in app['settings'].store.body('board',SCREEN)['home_grid']['items'] if i['id']=='a3')
            assert len(saved_a3['rules']) == 1 and saved_a3['rules'][0]['card'] == 'weather', saved_a3
            assert saved_a3['rules'][0]['when'] == {'all': [{'kind': 'music_playing'}, {'kind': 'time', 'from': '06:00', 'to': '09:00'}]}, saved_a3

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
