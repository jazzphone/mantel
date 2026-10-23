"""Check complete starter layouts in Chromium or WebKit against a fictional home.

Requires Node, Playwright (or playwright-core), and its installed browser. For example:
    PLAYWRIGHT_PATH=/path/to/node_modules/playwright python tools/headless/home_grid_visual_check.py --engine webkit --shots /tmp/grid-shots
No connection to a real home; external browser requests are blocked.
"""
import argparse,asyncio,sys,tempfile,json,os,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT / x) for x in ('tools/headless','tools','hosts/server','tests')]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--engine',choices=['chromium','webkit'],default='chromium')
parser.add_argument('--node',default=shutil.which('node'))
parser.add_argument('--browser',help='optional browser executable')
parser.add_argument('--shots',type=Path)
args=parser.parse_args()
if not args.node: parser.error('Node is required; provide --node')
import gallery
from hk_core.settings import home_grid as HG
from aiohttp.test_utils import TestServer
async def main():
    screens=[]
    gallery.HOUSE['sensor.time']=(None,('11:59',{'friendly_name':'Time'}))
    gallery.HOUSE['climate.bedroom']=('bedroom',('heat_cool',dict(gallery.HOUSE['climate.main_floor'][1][1],friendly_name='Bedroom')))
    for look in ['flat_light','flat_dark','blur_day']:
        for concept in ['A','C']:
            name=f'polish-{concept.lower()}-{look.replace("_","-")}'
            screens.append(name)
            grid=HG.starter(concept,scenes=[x for x in gallery.HOUSE if x.startswith('scene.')],rooms=[x[0] for x in gallery.ROOMS],cameras=['camera.front_door','camera.backyard'],climate=['climate.main_floor','climate.bedroom'],tablet_room='kitchen')
            gallery.SETTINGS['boards'][name]={'home_style':'grid','home_grid':grid,'menu_custom':True,'menu':'tabbar','flat':look.startswith('flat'),'flat_theme':'light' if look=='flat_light' else 'dark','glass':'blur'}
    with tempfile.TemporaryDirectory() as td:
        app,cookie=await gallery.build(Path(td))
        async with TestServer(app) as server:
            shots=args.shots
            if shots: shots.mkdir(parents=True,exist_ok=True)
            probe=shots or Path(td)/'shared-blur-probe'
            probe.mkdir(parents=True,exist_ok=True)
            proc=await asyncio.create_subprocess_exec(args.node,str(Path(__file__).with_suffix('.cjs')),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE,env=os.environ)
            out,err=await proc.communicate(json.dumps({'origin':str(server.make_url('')).rstrip('/'),'cookie':cookie,'screens':screens,'shots':str(shots) if shots else None,'engine':args.engine,'browser':args.browser,'probe':str(probe)}).encode())
            print(out.decode());print(err.decode())
            if proc.returncode: return proc.returncode
            from PIL import Image,ImageStat
            sample=json.loads((probe/'shared-pattern.json').read_text())
            im=Image.open(probe/'shared-pattern.png').convert('L')
            contrast=lambda box:ImageStat.Stat(im.crop(tuple(box))).stddev[0]
            baseline,thermostat=contrast(sample['baseline']),contrast(sample['sample'])
            print(f'shared blur contrast: baseline={baseline:.2f}, thermostat={thermostat:.2f}')
            if baseline<20:
                if thermostat>=20: raise AssertionError('Thermostat shared blur did not suppress the wallpaper pattern')
            elif args.engine=='chromium': raise AssertionError('Chromium baseline blur unavailable')
            else: print('Pixel assertion unavailable: this WebKit renderer also omits the standalone baseline blur; structural and interaction checks passed.')
            return 0
raise SystemExit(asyncio.run(main()))
