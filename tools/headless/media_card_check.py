"""The Now Playing block while music really plays (2026-11-05, the owner's screen recordings and "make sure the test
includes the progress bar moving and updating the card"), against a real Mantel Server over the gallery's fictional house.

For as long as it runs this script pushes the speaker's state, as Music Assistant does: its position, then now and again a
new title; between pushes the card moves its own bar and time. In WebKit and Chromium, at three sizes:

  flicker     the time and the progress bar are seen to move and the card to draw again, and through all of it the blurred
              cover stays one element, untouched, on a layer of its own (will-change: the docked bar's only in WebKit)
  wells       the Speakers and Browse glyphs' ink centered in their round wells at every size (an inline icon sat on a
              line of text, up to 1.7 px low)
  background  Blurred Album is the default; Background: Card is the plate and the inks of the Music block beside it, its
              bar and time still moving, no cover decoded behind it -- on the house's look, and again on Flat Light
  pane        (Living Room leading Kitchen) the Side Pane's volume sets both rooms and shows their level; the music
              panel's Browse has each playlist's cover and its whole name, and its background is blurred, not a small
              copy of the cover stretched
  editor      on a block with rules (and every card in the catalog as a rule): Settings For, opening on the card on screen,
              offers the options that card has as a block; what is set goes in the rule, the preview follows, Save is
              accepted by hk_core, and the screen draws it

A browser's own screenshot paints the page afresh, so it can't see the flicker itself: that lives in what the compositor
keeps. With --pixels (a Mac only; it opens a browser window, so tools/ci.py leaves it out) real frames of that window
are taken with screencapture while the bar moves, and the check fails if any part of the block other than the bar and
the time changes from one frame to the next. Before the fix, 8 frames of 25 in WebKit did, across the whole block.

    PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=/path/to/node \\
        python tools/headless/media_card_check.py [--engine webkit|chromium] [--size 1180x820] [--shots DIR] [--pixels]

Skips (exit 0, saying why) without PLAYWRIGHT_PATH or NODE.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import struct
import subprocess
import sys
import tempfile
import time
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]

ENGINES = ('webkit', 'chromium')
SIZES = ('1181x821', '821x1181', '1501x1001')
PLAYER = 'media_player.living_room'
SCREEN = 'media-card'
NOW_PLAYING = {'card': 'now_playing', 'opts': {'speaker': PLAYER}}
# (where the blocks are matters: the flicker showed where a repaint's rectangle fell across the browser's tiles of the
# block, so the owner's block, `cond`, stands where it flickered on main every run, 2026-11-05)
GRID = {'v': 1, 'cols': 6, 'rows': 4, 'frame': [1280, 800], 'band': True, 'items': [
    {'id': 'scene', 'card': 'scene', 'size': 'S', 'at': [0, 0]},
    # the owner's block: Music, and Now Playing while it plays
    {'id': 'cond', 'size': 'L', 'at': [0, 1], 'card': 'music', 'opts': {'show': 'presets', 'tap': 'playlists'},
     'rules': [{'when': {'all': [{'kind': 'music_playing', 'entity': PLAYER}]}, **NOW_PLAYING}]},
    {'id': 'wide', 'size': 'W', 'at': [2, 0], **NOW_PLAYING},
    # Background: Card, Tall: its bar and time move too
    {'id': 'plain', 'size': 'T', 'at': [2, 1], 'card': 'now_playing', 'opts': {'speaker': PLAYER, 'background': 'card'}},
    {'id': 'small', 'size': 'S', 'at': [3, 1], **NOW_PLAYING},
    {'id': 'album', 'size': 'L', 'at': [4, 1], **NOW_PLAYING},
    {'id': 'music', 'size': 'W', 'at': [0, 3], 'card': 'music'},
    {'id': 'cond2', 'size': 'W', 'at': [2, 3], 'card': 'clock',
     'rules': [{'when': {'all': [{'kind': 'after_sunset'}]}, 'card': 'weather'}]}]}


# THE PANE RUN: Living Room leading Kitchen (a group, as the house's Everywhere is), the Side Pane's Now Playing beside
# a Now Playing block
PANE_SCREEN = 'media-pane'
PANE_GRID = {'v': 1, 'cols': 6, 'rows': 4, 'frame': [1280, 800], 'band': True, 'items': [
    {'id': 'album', 'size': 'L', 'at': [0, 0], **NOW_PLAYING}]}
PANE = {'side': 'right', 'dashboard': {'show': 'home', 'sections': [{'kind': 'weather'}, {'kind': 'now_playing', 'size': 'more'}]}}
GROUP = ['media_player.living_room', 'media_player.kitchen']


def missing() -> str | None:
    pw, node = os.environ.get('PLAYWRIGHT_PATH'), os.environ.get('NODE')
    if not pw or not Path(pw).exists():
        return 'set PLAYWRIGHT_PATH to an installed playwright-core (its node_modules folder)'
    if not node or not Path(node).exists():
        return 'set NODE to a Node.js binary'
    return None


def cover() -> bytes:
    """A made-up album cover, no real artwork: 480 px of a face-like disc on bands, as much detail as a real cover has. A
    small or plain one blurs to so smooth a picture that a second blur of part of it can't be told from the first, and
    the flicker would pass unseen."""
    w = h = 480
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        for x in range(w):
            d = (x - 260) ** 2 + (y - 200) ** 2
            if d < 130 ** 2:
                px = (240, 214, 190) if (x // 12 + y // 12) % 7 else (200, 160, 130)
            elif x < 110:
                px = (22, 20, 34)
            elif y < 150:
                px = (232, 196, 146)
            elif y < 330:
                px = (172, 34, 48) if (x + y) // 24 % 3 else (140, 20, 36)
            else:
                px = (112, 12, 28)
            rows += bytes(px)
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(bytes(rows))) + chunk(b'IEND', b'')


class Playing:
    """The speaker as Music Assistant keeps it: its state pushed every `every` seconds, the position moving on, a new title
    now and again; between pushes the card moves its own bar and time, as it does at home. Starts well before the end of
    the track, so a slow run can't reach the end and have a still bar pass for a calm one."""

    def __init__(self, app, gallery, titles: bool, every: float = 1.0):
        self.app, self.gallery, self.titles, self.every = app, gallery, titles, every
        self.started, self.pushes = time.time(), 0
        self.attrs = dict(gallery.HOUSE[PLAYER][1][1])
        # (a song's length: a long track's bar creeps under a pixel a step and seldom repaints, and the flicker came with
        # the repaints -- 2026-11-05, a 50-minute track hid it)
        self.attrs.update(media_duration=337.0, entity_picture_local='/local/media-card-cover.png')

    def push(self) -> None:
        now = time.time()
        self.pushes += 1
        attrs = dict(self.attrs, media_position=30.0 + (now - self.started) % 280,
                     media_position_updated_at=time.strftime('%Y-%m-%dT%H:%M:%S+00:00', time.gmtime(now)))
        if self.titles and self.pushes // 4 % 2:
            attrs['media_title'] = 'Green in Blue'
        hub = self.app['hub']
        hub.on_change(hub.store.apply_event({'a': {PLAYER: {'s': 'playing', 'lc': self.gallery.NOW, 'lu': now, 'a': attrs}}}))

    async def run(self) -> None:
        while True:
            self.push()
            await asyncio.sleep(self.every)


def window_id(viewport_w: int, engine: str) -> int | None:
    """The check's own browser window (screencapture -l wants its number): never the owner's Chrome or Safari."""
    source = ('import CoreGraphics\nfor w in CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String:Any]] {\n'
              'let b = w[kCGWindowBounds as String] as? [String:Any] ?? [:]\n'
              'print(w[kCGWindowNumber as String] ?? 0, "|", w[kCGWindowOwnerName as String] ?? "", "|", b["Width"] ?? 0, "|", b["Height"] ?? 0)\n}\n')
    out = subprocess.run(['swift', '-'], input=source, capture_output=True, text=True, timeout=120).stdout
    owners = ('Playwright',) if engine == 'webkit' else ('Chrome for Testing', 'Chromium')
    found = []
    for line in out.splitlines():
        n, owner, w, h = [x.strip() for x in line.split('|')]
        if any(o in owner for o in owners) and int(float(w)) >= viewport_w and int(float(w)) <= viewport_w + 40:
            found.append((int(float(h)), int(n)))
    return max(found)[1] if found else None


async def pixels(gallery, engine: str, size: str, frames: int, shots: Path | None, every: float) -> list[str]:
    """Real frames while the bar moves: the block outside the bar and the time must not change."""
    with tempfile.TemporaryDirectory() as td, tempfile.TemporaryDirectory() as frames_dir:
        return await _pixels(gallery, engine, size, frames, shots, Path(td), Path(frames_dir), every)


async def _pixels(gallery, engine: str, size: str, frames: int, shots: Path | None, td: Path, shots_dir: Path, every: float) -> list[str]:
    from aiohttp.test_utils import TestServer
    from PIL import Image          # (Mantel's venv has both; --pixels only)
    import numpy as np
    w, h = (int(x) for x in size.split('x'))
    fails: list[str] = []
    if True:
        app, cookie = await gallery.build(td)
        local = Path(app['user_files'].local)
        local.mkdir(parents=True, exist_ok=True)
        (local / 'media-card-cover.png').write_bytes(cover())
        playing = Playing(app, gallery, titles=False, every=every)
        task = asyncio.create_task(playing.run())
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(
                os.environ['NODE'], str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
            proc.stdin.write(json.dumps({'mode': 'hold', 'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'engine': engine,
                                         'size': size, 'screen': SCREEN, 'seconds': frames + 25}).encode())
            proc.stdin.close()
            ready = json.loads((await asyncio.wait_for(proc.stdout.readline(), 60)).decode())
            wid = await asyncio.to_thread(window_id, w, engine)
            assert wid, f'no window for {engine} {size}'
            names = []
            for i in range(frames):
                names.append(shots_dir / f'{i:03}.png')
                await asyncio.to_thread(subprocess.run, ['screencapture', '-x', '-o', f'-l{wid}', str(names[-1])], check=True)
                await asyncio.sleep(0.15)
            end = json.loads((await asyncio.wait_for(proc.stdout.readline(), frames + 60)).decode())
            proc.kill()
            await proc.wait()
        task.cancel()
    first = Image.open(names[0]).convert('L')
    scale = 2
    top = first.height - h * scale
    def box(r):
        return tuple(int(v) for v in (r['x'] * scale, r['y'] * scale + top, (r['x'] + r['w']) * scale, (r['y'] + r['h']) * scale + top))
    grabs = [np.asarray(Image.open(n).convert('L')).astype(int) for n in names]
    for bid, rects in ready['rects'].items():
        tile, sub = box(rects['tile']), box(rects['moving'])
        calm, moved = [], 0
        for a, b in zip(grabs, grabs[1:]):
            d = np.abs(a - b)
            moved += int(d[sub[1]:sub[3], sub[0]:sub[2]].max() > 8)
            d[sub[1]:sub[3], sub[0]:sub[2]] = 0
            calm.append(float(d[tile[1]:tile[3], tile[0]:tile[2]].mean()))
        t0, t1 = ready['now'][bid], end['now'][bid]
        tag = f'pixels {engine} {size} {bid}'
        print(f'{tag}: {len(names)} frames; biggest change outside the bar and time {max(calm):.3f}; frames with the bar or time moving {moved}; '
              f'time {t0["time"]} to {t1["time"]}; card drawn {t1["renders"]} times', flush=True)
        if moved < 3:
            fails.append(f'{tag}: the bar and the time hardly moved ({moved} frames): this run proves nothing')
        if t1['time'] == t0['time'] or t1['renders'] < 3 or not t1['same']:
            fails.append(f'{tag}: the card did not update in place ({t0["time"]} to {t1["time"]}, {t1["renders"]} draws, same cover {t1["same"]})')
        if max(calm) > 0.2:
            fails.append(f'{tag}: the block flickered: {sum(1 for c in calm if c > 0.2)} of {len(calm)} frames changed outside the bar and time (biggest {max(calm):.2f})')
        if shots:
            # a frame, and the biggest change from one frame to the next outside the bar and time, 25 times as bright
            shots.mkdir(parents=True, exist_ok=True)
            Image.open(names[len(names) // 2]).convert('RGB').crop(tile).save(shots / f'pixels-{engine}-{size}-{bid}.png')
            worst = int(np.argmax(calm))
            d = np.abs(grabs[worst] - grabs[worst + 1])
            d[sub[1]:sub[3], sub[0]:sub[2]] = 0
            Image.fromarray(np.clip(d[tile[1]:tile[3], tile[0]:tile[2]] * 25, 0, 255).astype('uint8')).save(shots / f'pixels-{engine}-{size}-{bid}-change.png')
    return fails


async def browser(gallery, engine: str, size: str, shots: Path | None, light: bool = False, pane: bool = False) -> bool:
    look = gallery.SETTINGS['settings']['look']
    gallery.SETTINGS['settings']['look'] = {'flat': True, 'flat_theme': 'light'} if light else look
    house = {k: gallery.HOUSE[k] for k in GROUP}
    if pane:                     # Kitchen joins Living Room's music
        for k in GROUP:
            area, (state, attrs) = gallery.HOUSE[PLAYER if k == PLAYER else k]
            lead = gallery.HOUSE[PLAYER][1][1]
            gallery.HOUSE[k] = (area, ('playing', dict(lead, friendly_name=attrs.get('friendly_name'), group_members=list(GROUP),
                                                        volume_level=0.3 if k == PLAYER else 0.6)))
    try:
        with tempfile.TemporaryDirectory() as td:
            return await _browser(gallery, engine, size, shots, light, Path(td), pane)
    finally:
        gallery.SETTINGS['settings']['look'] = look
        gallery.HOUSE.update(house)


async def _browser(gallery, engine: str, size: str, shots: Path | None, light: bool, td: Path, pane: bool = False) -> bool:
    from aiohttp.test_utils import TestServer
    from mantel_server.settings_store import load_model
    if True:
        app, cookie = await gallery.build(td)
        app['settings'].model = load_model()
        local = Path(app['user_files'].local)
        local.mkdir(parents=True, exist_ok=True)
        (local / 'media-card-cover.png').write_bytes(cover())
        playing = Playing(app, gallery, titles=True)
        task = asyncio.create_task(playing.run())
        try:
            async with TestServer(app) as server:
                proc = await asyncio.create_subprocess_exec(
                    os.environ['NODE'], str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE)
                await proc.communicate(json.dumps({'mode': 'pane' if pane else 'light' if light else 'check', 'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'engine': engine,
                                                   'size': size, 'screen': SCREEN, 'shots': str(shots or '')}).encode())
                if proc.returncode:
                    print(f'FAIL {engine} {size}', flush=True)
                    return False
                # what Save sent was taken by hk_core, in the rule
                items = {i['id']: i for i in app['settings'].store.body('board', SCREEN)['home_grid']['items']}
        finally:
            task.cancel()
        rule = items['cond']['rules'][0]
        if light or pane or int(size.split('x')[0]) < 1180:                    # (no editor at this size: the layout as it was)
            return True
        if rule.get('opts', {}).get('background') != 'card' or items['cond'].get('opts', {}).get('background'):
            print(f'FAIL {engine} {size}: saved block {items["cond"]}', flush=True)
            return False
        if items['cond2']['rules'][0].get('opts', {}).get('sky') is not True:
            print(f'FAIL {engine} {size}: saved block {items["cond2"]}', flush=True)
            return False
        print(f'{engine} {size}: saved as set, in the rules', flush=True)
    return True


async def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--engine', action='append', choices=ENGINES)
    ap.add_argument('--size', action='append')
    ap.add_argument('--shots', type=Path)
    ap.add_argument('--pixels', action='store_true', help='real frames of a real window (a Mac; opens a window)')
    ap.add_argument('--frames', type=int, default=25)
    ap.add_argument('--every', type=float, default=6.0, help='--pixels: seconds between the speaker pushes (Music Assistant: several)')
    args = ap.parse_args(argv)
    why = missing()
    if why:
        print(f'SKIPPED media_card_check: {why}')
        return 0
    import gallery
    gallery.SETTINGS['boards'][PANE_SCREEN] = {'title': 'Media Pane', 'pages': [], 'headers': {'home': True}, 'menu_custom': True,
                                               'menu': 'tabbar', 'home_style': 'grid', 'home_grid': json.loads(json.dumps(PANE_GRID)),
                                               'side_pane': json.loads(json.dumps(PANE))}
    gallery.SETTINGS['boards'][SCREEN] = {'title': 'Media Card', 'pages': [], 'headers': {'home': True}, 'menu_custom': True, 'menu': 'tabbar',
                                          'home_style': 'grid', 'home_grid': json.loads(json.dumps(GRID))}
    failed = 0
    for engine in args.engine or ENGINES:
        for size in args.size or SIZES:
            if args.pixels:
                for line in await pixels(gallery, engine, size, args.frames, args.shots, args.every):
                    print('FAIL', line, flush=True)
                    failed += 1
            elif not await browser(gallery, engine, size, args.shots):
                failed += 1
        # Background: Card on Flat Light: the plate and the inks of a light look (dark text), at one size
        if not args.pixels and not await browser(gallery, engine, (args.size or SIZES)[0], args.shots, light=True):
            failed += 1
        # the Side Pane's volume on a group, and the music panel's Browse and background, at one size
        if not args.pixels and not await browser(gallery, engine, (args.size or SIZES)[0], args.shots, pane=True):
            failed += 1
    print('media_card_check:', 'FAILED' if failed else 'passed', flush=True)
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
