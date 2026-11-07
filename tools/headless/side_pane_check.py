"""THE SIDE PANE in a real browser (docs/phase11/HOMEVIEW-LOOK.md "Phase A2"), against the gallery's fictional house.

Screens with a Side Pane: beside a 3 x 3 Home Grid on the right and on the left, on Every Page of a generated
screen, eight sections together, in the screensaver (its own sections, on each side), each section alone at each
of its four sizes, the music playing; and the same screen held upright (a band under the page) and on a phone (no
pane). A Status (the owner's Mail chip as a section) hidden while the mailbox says No Mail, shown once the house says
otherwise -- the state changed in the server, as Home Assistant would push it -- and hidden again. It checks the pane is where it should be, never scrolls, narrows the page, and that no page error happens;
with --shots DIR it keeps a screenshot of each. No connection to a real home; any other request is refused.

    PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core python tools/headless/side_pane_check.py --engine webkit --shots DIR

Without PLAYWRIGHT_PATH or Node it says why and exits 0.
"""
import argparse
import asyncio
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / x) for x in ('tools/headless', 'tools', 'hosts/server', 'tests')]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--engine', choices=['chromium', 'webkit'], default='webkit')
parser.add_argument('--node', default=os.environ.get('NODE') or shutil.which('node'))
parser.add_argument('--shots', type=Path)
parser.add_argument('--size', action='append', help='WxH (default: 1180x820, 820x1180, 390x844)')
args = parser.parse_args()
if not args.node or not os.environ.get('PLAYWRIGHT_PATH'):
    print('side_pane_check: skipped (needs NODE and PLAYWRIGHT_PATH)')
    raise SystemExit(0)

import gallery  # noqa: E402

DASH = [{'kind': 'weather'}, {'kind': 'calendar'}, {'kind': 'now_playing', 'when': 'active'}]
EIGHT = [{'kind': k} for k in ('clock', 'weather', 'calendar', 'now_playing', 'security', 'timers', 'climate', 'people')]
SAVER = [{'kind': 'clock', 'size': 'tiny'}, {'kind': 'weather', 'size': 'less'}, {'kind': 'security', 'size': 'less'},
         {'kind': 'now_playing', 'size': 'less', 'when': 'active'}]
# a 3 x 3 Home Grid that fills the height (the Home with Pane starter's shape; this phase does not add the starter)
GRID = {'v': 1, 'cols': 3, 'rows': 3, 'frame': [800, 800], 'band': False, 'grow': True, 'items': [
    {'id': 'p1', 'card': 'thermostat', 'size': 'T', 'at': [0, 0]},
    {'id': 'p2', 'card': 'now_playing', 'size': 'L', 'at': [1, 0]},
    {'id': 'p3', 'card': 'security', 'size': 'S', 'at': [1, 2]},
    {'id': 'p4', 'card': 'action', 'size': 'S', 'at': [2, 2], 'opts': {'action': 'lights_off'}},
    {'id': 'p5', 'card': 'timers', 'size': 'S', 'at': [0, 2]}]}


# THE OWNER'S MAIL CHIP as a Side Pane section (2026-11-06): its entity, glyph, color, name and label, no tap, and its
# conditional card's rule
MAIL = {'kind': 'status', 'id': 'mail', 'entity': 'sensor.mailbox_status', 'icon': 'hk:mailbox-up', 'color': 'blue',
        'name': 'Mail', 'label': 'Likely Delivered', 'tap': 'none', 'size': 'less',
        'show': {'entity': 'sensor.mailbox_status', 'op': 'is', 'value': 'Mail Likely Delivered'}}


async def states_from(app, path: Path):
    """The browser side asks for a state change by writing {entity, state} to `path`: made in the server's store and
    pushed to the page as Home Assistant's would be (the file gone says it is done)."""
    import time
    hub = app['hub']
    while True:
        if path.exists():
            want = json.loads(path.read_text())
            now = time.time()
            hub.store.apply_event({'c': {want['entity']: {'+': {'s': want['state'], 'lc': now, 'lu': now}}}})
            hub.on_change({want['entity']})
            path.unlink()
        await asyncio.sleep(0.05)


# the board's six looks, each from the Clock section's choices (A is today's: none set)
CLOCK_LOOKS = {
    'A': {},
    'B': {'align': 'right', 'ampm': False},
    'C': {'align': 'center', 'scale': 'large', 'weight': 'light', 'ampm': False, 'colon': True, 'date': 'short'},
    'D': {'align': 'right', 'scale': 'large', 'weight': 'bold', 'ampm': False, 'line': 'sunset'},
    'E': {'face': 'stacked', 'date': 'short'},
    'F': {'face': 'analog'},
}


def screen(pane, grid=False, **extra):
    b = {'title': 'Side Pane', 'pages': [], 'headers': {'home': True}, 'menu_custom': True, 'menu': 'tabbar', 'side_pane': pane}
    if grid:
        b.update(home_style='grid', home_grid=GRID)
    b.update(extra)
    return b


SCREENS = {
    'pane-home-right': screen({'side': 'right', 'dashboard': {'show': 'home', 'sections': DASH}}, grid=True),
    'pane-home-left': screen({'side': 'left', 'dashboard': {'show': 'home', 'sections': DASH}}, grid=True),
    # (2026-11-01) swiping between pages: the pane and the tab bar's place go with the finger
    # (...and back from the Pages screen: the Home Grid comes in at its own width, the Pages screen's blur stays still)
    'pane-swipe': screen({'side': 'right', 'dashboard': {'show': 'home', 'sections': DASH}}, grid=True, swipe_pages='on',
                         pages_screen={'show': 'on'}),
    # Dim (2026-11-01): a shade over the glass, under the words
    'pane-home-dim': screen({'side': 'right', 'dim': 'high', 'dashboard': {'show': 'home', 'sections': DASH}}, grid=True),
    'pane-every-page': screen({'side': 'right', 'width': 'standard', 'dashboard': {'show': 'all', 'sections': DASH}}),
    'pane-eight': screen({'side': 'right', 'dashboard': {'show': 'home', 'sections': EIGHT}}, grid=True),
    'pane-saver-right': screen({'side': 'right', 'saver': {'show': 'own', 'sections': SAVER}}, screensaver=True),
    'pane-saver-left': screen({'side': 'left', 'saver': {'show': 'own', 'sections': SAVER}}, screensaver=True),
    'pane-none': screen(None),
    # (2026-10-31, item 41) Now Playing's Album Art Background set off: the pane keeps its ordinary ground
    'pane-art-off': screen({'side': 'right', 'dashboard': {'show': 'home', 'sections': [
        {'kind': 'weather', 'size': 'less'}, {'kind': 'now_playing', 'art': False}]}}, grid=True),
    # (2026-10-31, item 44) Now Playing's When Tapped: the panel in place, or the section flipped over to it
    **{f'pane-tap-{t}': screen({'side': 'right', 'dashboard': {'show': 'home', 'sections': [
        {'kind': 'weather', 'size': 'less'}, {'kind': 'now_playing', 'tap': t}]}}, grid=True) for t in ('panel', 'flip')},
    'pane-art-on': screen({'side': 'right', 'dashboard': {'show': 'home', 'sections': [
        {'kind': 'weather', 'size': 'less'}, {'kind': 'now_playing'}]}}, grid=True),
    # (2026-11-01) the same with a screensaver: a tap on the cover is its music, full screen
    'pane-cover': screen({'side': 'right', 'dashboard': {'show': 'home', 'sections': [
        {'kind': 'weather', 'size': 'less'}, {'kind': 'now_playing'}]}}, grid=True, screensaver=True,
        screensaver_options={'show': 'clock', 'starts_after': 0}),
    # (2026-10-31, item 43) the Clock section's six looks, A to F, the "Side Pane clock styles" board
    **{f'pane-clock-{k.lower()}': screen({'side': 'right', 'dashboard': {'show': 'home', 'sections': [dict(kind='clock', **look), {'kind': 'weather', 'size': 'less'}]}}, grid=True)
       for k, look in CLOCK_LOOKS.items()},
    # (2026-10-31, item 42) the camera's still in the pane: loaded over its glyph, its name hidden unless chosen
    'pane-camera': screen({'side': 'right', 'dashboard': {'show': 'home', 'sections': [
        {'kind': 'weather', 'size': 'less'}, {'kind': 'camera'}, {'kind': 'camera', 'entity': 'camera.backyard', 'size': 'less', 'name': 'show'}]}}, grid=True),
    # (2026-10-30) the music at the pane's foot, the rest at its top; a calendar of a week's events, scrolling
    'pane-placed': screen({'side': 'right', 'dashboard': {'show': 'all', 'sections': [
        {'kind': 'weather', 'size': 'less'}, {'kind': 'calendar', 'days': 7}, {'kind': 'people'},
        {'kind': 'now_playing', 'place': 'bottom'}]}}, grid=True),
    # (2026-11-06) A STATUS: the owner's Mail chip (custom:hk-status-chip-card under a conditional card) as a section --
    # beside the weather, and alone (the whole pane coming and going with it)
    'pane-status': screen({'side': 'right', 'dashboard': {'show': 'home', 'sections': [
        {'kind': 'weather', 'size': 'less'}, MAIL]}}, grid=True),
    'pane-status-alone': screen({'side': 'right', 'dashboard': {'show': 'home', 'sections': [dict(MAIL, size='more')]}}, grid=True),
}


async def main():
    from aiohttp.test_utils import TestServer
    gallery.SETTINGS['boards'].update(json.loads(json.dumps(SCREENS)))
    gallery.HOUSE['todo.groceries'] = (None, ('3', {'friendly_name': 'Groceries'}))
    # the song's cover (a bright picture: the album art behind the pane, and its words' contrast over it)
    mp = gallery.HOUSE['media_player.living_room']
    gallery.HOUSE['media_player.living_room'] = (mp[0], (mp[1][0], dict(mp[1][1], entity_picture='/hk/landscapes/01.webp')))
    gallery.HOUSE['sensor.house_power'] = (None, ('1400', {'unit_of_measurement': 'W', 'device_class': 'power'}))
    gallery.HOUSE['sensor.mailbox_status'] = (None, ('No Mail', {'friendly_name': 'Mailbox Status', 'icon': 'mdi:mailbox'}))
    gallery.HOUSE['alarm_control_panel.home'] = (None, ('armed_home', {'friendly_name': 'Home Alarm', 'changed_by': 'Sam'}))
    # two quick timers running, one paused, and the sun's next setting: the Timers rows (the ring the pause, the
    # red Stop) and the Clock's sunset at the right of its date
    import time
    at = lambda s: time.strftime('%Y-%m-%dT%H:%M:%S+00:00', time.gmtime(time.time() + s))
    gallery.HOUSE['sensor.running_quick_timers'] = (None, ('2', {'friendly_name': 'Running Quick Timers', 'running': [
        {'name': 'Pasta', 'entity_id': 'timer.quick_1', 'finishes_at': at(522)},
        {'name': 'Laundry', 'entity_id': 'timer.quick_2', 'finishes_at': at(1450)}]}))
    gallery.HOUSE['timer.quick_1'] = (None, ('active', {'friendly_name': 'Pasta', 'duration': '0:14:00', 'finishes_at': at(522)}))
    gallery.HOUSE['timer.quick_2'] = (None, ('active', {'friendly_name': 'Laundry', 'duration': '0:40:00', 'finishes_at': at(1450)}))
    gallery.HOUSE['timer.quick_3'] = (None, ('paused', {'friendly_name': 'Tea', 'duration': '0:05:00', 'remaining': '0:03:10'}))
    gallery.HOUSE['sun.sun'] = (None, ('above_horizon', {'friendly_name': 'Sun', 'elevation': 30.0, 'next_setting': at(6 * 3600)}))
    gallery.SETTINGS['settings']['features'] = {'power': 'sensor.house_power'}
    gallery.SETTINGS['settings']['security'] = {'alarm': 'alarm_control_panel.home'}
    sizes = [tuple(int(n) for n in s.split('x')) for s in (args.size or ['1180x820', '820x1180', '390x844'])]
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        async with TestServer(app) as server:
            if args.shots:
                args.shots.mkdir(parents=True, exist_ok=True)
            state_file = Path(td) / 'state.json'
            watch = asyncio.create_task(states_from(app, state_file))
            proc = await asyncio.create_subprocess_exec(
                args.node, str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=os.environ)
            out, err = await proc.communicate(json.dumps({
                'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'engine': args.engine,
                'shots': str(args.shots) if args.shots else None, 'sizes': sizes, 'looks': sorted(CLOCK_LOOKS),
                'stateFile': str(state_file)}).encode())
            watch.cancel()
            print(out.decode())
            if err.strip():
                print(err.decode(), file=sys.stderr)
            return proc.returncode


raise SystemExit(asyncio.run(main()))
