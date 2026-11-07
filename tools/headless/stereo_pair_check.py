"""A stereo pair is one speaker on the generated dashboards (2026-11-06; web/hk/modules/hk-pairs.js), on the fictional
house: two HomePods in the Office, made one room in Music settings as "Office HomePods" (a virtual pair: the music
feed's speaker with `parts`), and two in the Bedroom whose pair has no name of its own (named by its room there).

- Home's Speakers chip counts each pair once (3 Playing: the Living Room and the two pairs, every half playing);
- Home's Office section draws one speaker, the pair's first player, named "HomePods" (the room dropped, as every
  tile's); the right HomePod nowhere. The Bedroom's is "Bedroom Speakers" -> "Speakers", never "Bedroom" twice;
- the Office's room page (Speakers & TVs) draws the same one tile, and its status row counts one speaker;
- the Living Room and Kitchen, single speakers, are as they were;
- no page errors.

    python tools/headless/stereo_pair_check.py [--shots DIRECTORY]
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

parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
parser.add_argument('--shots', type=Path)
args = parser.parse_args()


def homepod(name):
    return 'playing', {   # both halves of a playing pair say so, as Music Assistant's players do
        'friendly_name': name, 'device_class': 'speaker', 'volume_level': 0.3, 'supported_features': 152463,
        'app_id': 'music_assistant', 'mass_player_type': 'player'}


PAIRED = {'media_player.office_left_homepod': ('office', homepod('Office Left HomePod')),
          'media_player.office_right_homepod': ('office', homepod('Office Right HomePod')),
          'media_player.bedroom_left_homepod': ('bedroom', homepod('Bedroom Left HomePod')),
          'media_player.bedroom_right_homepod': ('bedroom', homepod('Bedroom Right HomePod'))}
DEEP = "window.deep=(r,s)=>[...r.querySelectorAll('*')].flatMap(e=>[...(e.matches(s)?[e]:[]),...(e.shadowRoot?deep(e.shadowRoot,s):[])]);"
# every speaker tile drawn: its entity and the name it shows
SPEAKERS = "deep(document,'hk-media-card').map(c=>c._config&&[c._config.entity,c._config.name]).filter(Boolean)"


async def main():
    gallery.HOUSE.update(PAIRED)
    gallery.SPEAKERS.extend([
        {'name': 'Office HomePods', 'entity': 'media_player.office_left_homepod',
         'parts': ['media_player.office_left_homepod', 'media_player.office_right_homepod']},
        {'name': 'Bedroom', 'entity': 'media_player.bedroom_left_homepod',
         'parts': ['media_player.bedroom_left_homepod', 'media_player.bedroom_right_homepod']}])
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        async with TestServer(app) as server, Browser(1280, 800, port=9407) as b:
            origin = str(server.make_url('')).rstrip('/')
            await b.restrict_origin(origin)

            async def speakers(path):
                await b.open(origin + path, cookie)
                assert await b.wait('window.__mantelReady===true', 30), path
                await b.eval(DEEP)
                assert await b.wait(f"{SPEAKERS}.length>0", 20), f'{path}: no speaker tiles'
                await asyncio.sleep(1.0)
                return [tuple(x) for x in await b.eval(SPEAKERS)]

            home = await speakers(f'/{gallery.SCREEN}/home')
            ids = [e for e, _ in home]
            assert ids.count('media_player.office_left_homepod') == 1, home
            assert ids.count('media_player.bedroom_left_homepod') == 1, home
            for half in ('media_player.office_right_homepod', 'media_player.bedroom_right_homepod'):
                assert half not in ids, (half, home)
            named = dict(home)
            # the Speakers chip: three playing (the Living Room and the two pairs), not five
            assert await b.eval("deep(document,'*').some(e=>/^\\s*Speakers\\s*3 Playing\\s*$/.test(e.textContent))"), \
                'the Speakers chip does not say 3 Playing'
            assert named['media_player.office_left_homepod'] == 'HomePods', home
            assert named['media_player.bedroom_left_homepod'] == 'Speakers', home
            assert named.get('media_player.living_room') and named.get('media_player.kitchen'), home
            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
                await b.screenshot(args.shots / 'stereo-pair-home.png')

            room = await speakers(f'/{gallery.SCREEN}/room-office')
            assert room == [('media_player.office_left_homepod', 'HomePods')], room
            # the room's status row: one speaker, playing
            row = await b.eval("""(()=>{let c=window.hkCards.client(),it=window.hkRoom.roomItems(c,['office'],{})||[];
              return it.filter(i=>i.kind==='speakers').map(i=>({ids:i.ids,title:i.title,value:i.value}))})()""")
            assert len(row) == 1 and row[0]['ids'] == ['media_player.office_left_homepod'], row
            if args.shots:
                await b.screenshot(args.shots / 'stereo-pair-room.png')
            exceptions = [line for line in b.console if line.startswith('EXCEPTION:')]
            assert not exceptions, exceptions
            print('PASS: stereo pairs: one speaker each on Home and the room page, under the pair\'s name; '
                  'the other halves left out; the room counts one speaker')

asyncio.run(main())
