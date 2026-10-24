"""The Glass looks' Image Look (2026-10-24) against the fictional home, never a household.

A Blur screen on Landscapes with Image Look Balanced must show the treated picture (a blob address on the sky's
photo layer, tinted: its colors pulled toward one hue), and Settings must offer the Image Look under the Glass
looks' Landscapes and save a choice there.

    python tools/headless/glass_image_look_check.py [--shots DIRECTORY]
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

DEEP = "window.deep=(r,s)=>[...r.querySelectorAll('*')].flatMap(e=>[...(e.matches(s)?[e]:[]),...(e.shadowRoot?deep(e.shadowRoot,s):[])]);"
# how far the picture's pixels are from gray, on average: a tinted picture is near one hue
SPREAD = """(async()=>{let el=document.getElementById('hk-sky'),u=getComputedStyle(el).getPropertyValue('--art').match(/url\\("?([^")]+)"?\\)/);
 if(!u)return null;let im=new Image();im.src=u[1];await im.decode();let c=document.createElement('canvas');c.width=64;c.height=40;
 let x=c.getContext('2d');x.drawImage(im,0,0,64,40);let d=x.getImageData(0,0,64,40).data,hues=[];
 for(let i=0;i<d.length;i+=4){let r=d[i],g=d[i+1],b=d[i+2],mx=Math.max(r,g,b),mn=Math.min(r,g,b);if(mx-mn<12)continue;
  let h=mx===r?(g-b)/(mx-mn):mx===g?2+(b-r)/(mx-mn):4+(r-g)/(mx-mn);hues.push(((h*60)+360)%360)}
 if(!hues.length)return {url:u[1],spread:0};let s=0,cc=0;hues.forEach(h=>{s+=Math.sin(h*Math.PI/180);cc+=Math.cos(h*Math.PI/180)});
 return {url:u[1],spread:1-Math.hypot(s,cc)/hues.length}})()"""


async def main():
    gallery.SETTINGS['settings']['look'] = {'flat': False, 'glass': 'blur'}
    gallery.SETTINGS['settings']['sky'] = {'background': 'landscapes', 'landscape': 'every:1440'}
    base = dict(gallery.SETTINGS['boards'][gallery.SCREEN])
    gallery.SETTINGS['boards']['glass-plain'] = dict(base)
    gallery.SETTINGS['boards']['glass-tinted'] = dict(base, sky_image_look={'mode': 'tinted', 'color': '#3a7bd5', 'strength': 100,
                                                                            'depth': 40, 'brightness': 0, 'fade': 20})
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        from mantel_server.settings_store import load_model
        app['settings'].model = load_model()             # the real merge rules, for a patch
        async with TestServer(app) as server, Browser(1280, 800, port=9401) as b:
            origin = str(server.make_url('')).rstrip('/')
            await b.restrict_origin(origin)
            got = {}
            for screen in ('glass-plain', 'glass-tinted'):
                await b.open(origin + '/' + screen + '/home', cookie)
                assert await b.wait('window.__mantelReady===true', 30)
                assert await b.wait("/url\\(/.test(getComputedStyle(document.getElementById('hk-sky')||document.body).getPropertyValue('--art'))", 20), screen
                await asyncio.sleep(1)
                got[screen] = await b.eval(SPREAD)
                if args.shots:
                    args.shots.mkdir(parents=True, exist_ok=True)
                    await b.screenshot(args.shots / f'{screen}.png')
            plain, tinted = got['glass-plain'], got['glass-tinted']
            print('plain', plain['url'][:40], round(plain['spread'], 3), '| tinted', tinted['url'][:40], round(tinted['spread'], 3))
            assert plain['url'].startswith('/hk/landscapes/'), plain
            assert tinted['url'].startswith('blob:'), tinted
            assert tinted['spread'] < plain['spread'] * 0.6, got        # pulled toward one hue
            # Settings: the Glass looks' Landscapes offer the Image Look, and it saves
            await b.open(origin + '/settings#/house/sky', cookie)
            assert await b.wait("!!document.querySelector('hk-settings-panel')?.shadowRoot?.textContent.includes('Image Look')", 20)
            await b.eval(DEEP + "window.sel=deep(document.querySelector('hk-settings-panel').shadowRoot,'select').find(s=>[...s.options].some(o=>o.value==='balanced'));"
                         "sel.value='balanced';sel.dispatchEvent(new Event('change'));void 0")
            assert await b.wait("(document.querySelector('hk-settings-panel').data.settings.sky.image_look||{}).mode==='tinted'", 15), \
                await b.eval("JSON.stringify([document.querySelector('hk-settings-panel').data.settings.sky.image_look, sel&&sel.value])")
            if args.shots:
                await b.screenshot(args.shots / 'settings.png')
            exceptions = [line for line in b.console if line.startswith('EXCEPTION:')]
            assert not exceptions, exceptions
            print('PASS: the Glass looks show the treated landscape, and Settings offers and saves the Image Look')

asyncio.run(main())
