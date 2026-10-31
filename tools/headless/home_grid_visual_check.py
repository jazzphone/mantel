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
parser.add_argument('--homeview',action='store_true',help='the HomeView-style starters (square cells, Centred tiles) at tablet and phone sizes')
parser.add_argument('--only',action='append',help='--homeview: only this screen (its name, e.g. hv-sq-pane-4); may be given more than once')
args=parser.parse_args()
if not args.node: parser.error('Node is required; provide --node')
import gallery
from hk_core.settings import home_grid as HG
from aiohttp.test_utils import TestServer
# THE HOMEVIEW-STYLE STARTERS (2026-10-30, docs/phase11/HOMEVIEW-LOOK.md Phase A): made by the editor's own code
# (homeview_starters.cjs) from this fictional house, each at a landscape and an upright tablet's size and a phone's;
# the Square screen's also at its own 800 x 800
HV_SIZES=['1180x820','820x1180','390x844']
async def homeview():
    import subprocess
    # (a vacuum of this check's own, for the Vacuum blocks on square cells)
    gallery.HOUSE['vacuum.downstairs'] = ('living_room', ('docked', {'friendly_name': 'Downstairs', 'battery_level': 92,
                                                                    'fan_speed': 'Standard', 'supported_features': 16383}))
    states={k:{'state':v[1][0],'attributes':v[1][1]} for k,v in gallery.HOUSE.items()}
    house={'states':states,'entities':{k:{'area_id':v[0]} for k,v in gallery.HOUSE.items() if v[0]},
           'areas':{r[0]:{'name':r[1]} for r in gallery.ROOMS}}
    got=json.loads(subprocess.run([args.node,str(ROOT/'tools/headless/homeview_starters.cjs')],input=json.dumps({'house':house,'tablet_room':'living_room'}),
                                  capture_output=True,text=True,check=True).stdout)
    screens=[]
    for kind,starters in got.items():
        for key,grid in starters.items():
            name='hv-'+key.replace('_','-')
            HG.check(grid)                          # (a starter saves as it is)
            gallery.SETTINGS['boards'][name]={'home_style':'grid','home_grid':grid,'menu_custom':True,'menu':'auto' if kind=='square' else 'tabbar','glass':'blur'}
            screens.append({'screen':name,'sizes':HV_SIZES+(['800x800'] if kind=='square' else [])})
            # ...and each in the Home Tile Style (the default; the owner's own screen, 2026-10-30): every block's words
            # clear of its corners, a Square screen's 72 px outer ones too
            home=json.loads(json.dumps(grid))
            for it in home.get('items',[]): it['tile']='home'      # (chosen outright: Automatic is Centred on square cells)
            HG.check(home)
            gallery.SETTINGS['boards'][name+'-home']=dict(gallery.SETTINGS['boards'][name],home_grid=home)
            screens.append({'screen':name+'-home','sizes':HV_SIZES+(['800x800'] if kind=='square' else []),'homeTiles':True})
            # ...and the Security block Wide and Extra Large on square cells (2026-10-30)
            if key=='sq_pane':
                sec={'v':1,'cols':3,'rows':3,'frame':[1180,820],'band':False,'grow':True,'cell':'square','items':[
                    {'id':'s1','card':'security','size':'W','at':[0,0]},{'id':'s2','card':'security','size':'XL','at':[0,1]}]}
                HG.check(sec)
                gallery.SETTINGS['boards'][name+'-security']=dict(gallery.SETTINGS['boards'][name],home_grid=sec)
                screens.append({'screen':name+'-security','sizes':['1180x820']})
                # ...and the Vacuum block Small and Wide on square cells (2026-10-30, the owner: they "don't really
                # look good in the homeview layout")
                vac={'v':1,'cols':3,'rows':3,'frame':[1180,820],'band':False,'grow':True,'cell':'square','items':[
                    {'id':'v1','card':'vacuum','size':'S','at':[0,0]},{'id':'v2','card':'vacuum','size':'W','at':[1,0]},
                    {'id':'v3','card':'vacuum','size':'S','at':[0,1]}]}
                HG.check(vac)
                gallery.SETTINGS['boards'][name+'-vacuum']=dict(gallery.SETTINGS['boards'][name],home_grid=vac)
                screens.append({'screen':name+'-vacuum','sizes':['1180x820','390x844']})
                # ...and Accessory blocks Centred (2026-10-31, the owner): the alarm armed, its glyph the block's size,
                # not a room page's 27 px; a lamp whose Line Under Name is State says its state, not its room
                gallery.HOUSE['alarm_control_panel.bedroom'] = ('bedroom', ('armed_home', {'friendly_name': 'Bedroom Alarm', 'code_format': 'number'}))
                acc={'v':1,'cols':3,'rows':3,'frame':[1180,820],'band':False,'grow':True,'cell':'square','items':[
                    {'id':'a1','card':'accessory','size':'S','at':[0,0],'opts':{'entity':'alarm_control_panel.bedroom'}},
                    {'id':'a2','card':'accessory','size':'S','at':[1,0],'opts':{'entity':'alarm_control_panel.bedroom','secondary':{'mode':'state'}}},
                    {'id':'a3','card':'accessory','size':'S','at':[2,0],'opts':{'entity':'alarm_control_panel.home'}},
                    # ...and an Accessories block Centred (2026-10-31): its tiles HomeView's, each with its state
                    {'id':'a4','card':'accessories','size':'L','at':[0,1],'opts':{'accessories':[{'entity':'light.living_room_lamps'},
                     {'entity':'light.living_room_ceiling'},{'entity':'lock.front_door'},{'entity':'light.kitchen_pendants'}]}}]}
                HG.check(acc)
                gallery.SETTINGS['boards'][name+'-acc']=dict(gallery.SETTINGS['boards'][name],home_grid=acc)
                screens.append({'screen':name+'-acc','sizes':['1180x820']})
            # ...and Home with Pane at 4 columns (2026-10-30, the owner's "I could easily do 4"), the pane beside it
            if key=='sq_pane':
                four=json.loads(json.dumps(grid)); four['cols']=4; four['rows']=4
                HG.check(four)
                gallery.SETTINGS['boards'][name+'-4']=dict(gallery.SETTINGS['boards'][name],home_grid=four,
                    side_pane={'side':'right','dashboard':{'show':'home','sections':[{'kind':'weather'},{'kind':'calendar'}]}})
                screens.append({'screen':name+'-4','sizes':HV_SIZES+['1440x900']})
                # ...and at 5 columns with the same 4 rows: the same cells where the width holds them (1440 x 900)
                five=json.loads(json.dumps(four)); five['cols']=5
                HG.check(five)
                gallery.SETTINGS['boards'][name+'-5']=dict(gallery.SETTINGS['boards'][name+'-4'],home_grid=five)
                screens.append({'screen':name+'-5','sizes':['1180x820','1440x900']})
    if args.only: screens=[s for s in screens if s['screen'] in args.only]
    with tempfile.TemporaryDirectory() as td:
        app,cookie=await gallery.build(Path(td))
        async with TestServer(app) as server:
            if args.shots: args.shots.mkdir(parents=True,exist_ok=True)
            proc=await asyncio.create_subprocess_exec(args.node,str(Path(__file__).with_suffix('.cjs')),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE,env=os.environ)
            out,err=await proc.communicate(json.dumps({'homeview':True,'origin':str(server.make_url('')).rstrip('/'),'cookie':cookie,'screens':screens,
                                                       'shots':str(args.shots) if args.shots else None,'engine':args.engine,'browser':args.browser}).encode())
            print(out.decode());print(err.decode())
            return proc.returncode
async def main():
    if args.homeview: return await homeview()
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
