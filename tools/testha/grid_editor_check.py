"""Home Grid editor in the running fictional scratch HA (tools/testha/README.md).

    TESTHA_DIR=... python tools/testha/grid_editor_check.py

Uses the scratch harness only; never accepts an arbitrary HA address or credential.
"""
import asyncio, sys, os, json, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT / 'tools/testha'),str(ROOT / 'tools/headless')]
import testha
from check import HELPERS, Run, Browser
import aiohttp
async def main():
    async with aiohttp.ClientSession() as h:
        token=await testha.access_token(h)
        c=testha.creds()
        async with h.post(testha.BASE+'/auth/token',data={'grant_type':'refresh_token','client_id':testha.CLIENT_ID,'refresh_token':c['refresh_token']}) as response:
            tok=await response.json()
    tok.update(hassUrl=testha.BASE,clientId=testha.CLIENT_ID,refresh_token=c['refresh_token'],expires=int(time.time()*1000)+tok['expires_in']*1000)
    async with Browser(1600,1000) as b:
        await b.send('Page.addScriptToEvaluateOnNewDocument',source=HELPERS)
        await b.open(testha.BASE+'/manifest.json')
        await asyncio.sleep(1)
        await b.eval("localStorage.setItem('hassTokens', %s)"%json.dumps(json.dumps(tok)))
        await b.open(testha.BASE+'/hk-settings#/screens/hk-wall/home-grid')
        ready=await b.wait("!!window.__deep(document,n=>n.localName==='hk-grid-editor')[0]?.shadowRoot?.querySelector('.tools')",30)
        print('HA editor ready',ready,flush=True)
        if not ready:
            raise AssertionError('editor did not open: '+str(b.console[-10:]))
        await b.eval("window.ed=__deep(document,n=>n.localName==='hk-grid-editor')[0];ed.starter('A')")
        ready=await b.wait('ed.previewView?.isConnected',30)
        print('HA preview ready',ready,await b.eval('ed.message.textContent'),flush=True)
        print(b.console[-8:],flush=True)
        testha.SCRATCH.joinpath('shots').mkdir(exist_ok=True)
        await b.screenshot(testha.SCRATCH / 'shots' / 'home-grid-editor.png')
        assert ready
        assert not await b.eval("!!ed.panel.host()?.gridHistory")
        rects=await b.eval(
            "window.pair=ed.grid.items.filter(i=>i.size==='S').slice(-2);pair.map(it=>{let r=ed.overlay.querySelector('[data-id='+it.id+']').getBoundingClientRect();"
            "return {x:r.x+r.width/2,y:r.y+r.height/2}})")
        a,z=rects
        for t,pos,kw in [('mousePressed',a,{'button':'left','clickCount':1}),('mouseMoved',z,{'button':'left','buttons':1}),('mouseReleased',z,{'button':'left','clickCount':1})]:
            await b.send('Input.dispatchMouseEvent',type=t,x=pos['x'],y=pos['y'],**kw)
        assert await b.eval("ed.grid.items.find(i=>i.id===pair[0].id).at.join()===pair[1].at.join()")
        await b.eval('ed.save()')
        print('HA saved',await b.eval('({message:ed.message.textContent,connected:ed.isConnected})'),flush=True)
        assert not await b.eval('ed.isConnected')
        print('PASS HA real drag, shared editor, preview, save',flush=True)
asyncio.run(main())
