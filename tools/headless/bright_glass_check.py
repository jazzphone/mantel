"""Bright Glass over the Wallpapers, in WebKit (Safari's engine): the shots to look over (2026-10-30).

    PLAYWRIGHT_PATH=... python tools/headless/bright_glass_check.py --shots DIRECTORY [--wallpaper ID ...] [--size WxH ...]

docs/phase11/HOMEVIEW-LOOK.md Phases D, D2 and E: the fictional house in Bright Glass over each wallpaper asked
for (four by default), by day and by night, at an iPad on its side and upright and a phone. For each: Home with the
tab bar, a room page, a detail sheet, and a screen whose side menu is open. It checks what the page says it wears
-- the look's attribute, the wallpaper's layer and stops on the sky, the tab bar's material -- and that no page
error was thrown, and writes a contact sheet per wallpaper and time of day (contact-<id>-<day|night>.png).

Headless WebKit draws no backdrop blur: the plates show the wallpaper sharp behind their wash (Bright Glass's 4 px
blur is close to that); the sheets' frost is stood in for by their plate over the wallpaper's middle stops, as
sheet_review.py --look bright does.
"""
import argparse, asyncio, json, os, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]
import gallery
from aiohttp.test_utils import TestServer

ap = argparse.ArgumentParser()
ap.add_argument('--shots', type=Path, required=True)
ap.add_argument('--wallpaper', action='append')
ap.add_argument('--size', action='append')
args = ap.parse_args()

WALLS = args.wallpaper or ['ribbons_rose', 'shards_blue', 'pinwheel_teal', 'petals_amber']
SIZES = args.size or ['1180x820', '820x1180', '390x844']
MENU = 'dashboard-menu'          # a second screen: its side menu, always open where it fits
VIEWS = ['home', 'room', 'sheet', 'menu']


def contact(shots: Path, key: str):
    from PIL import Image, ImageDraw
    k = 260 / 1180
    cells = [(s, v) for s in SIZES for v in VIEWS]
    tw = max(int(int(s.split('x')[0]) * k) for s in SIZES)
    th = max(int(int(s.split('x')[1]) * k) for s in SIZES)
    sheet = Image.new('RGB', (len(VIEWS) * (tw + 8) + 8, len(SIZES) * (th + 26) + 8), (40, 40, 44))
    d = ImageDraw.Draw(sheet)
    for i, (s, v) in enumerate(cells):
        p = shots / f'{key}-{s}-{v}.png'
        if not p.exists():
            continue
        w, h = (int(x) for x in s.split('x'))
        x, y = 8 + (i % len(VIEWS)) * (tw + 8), 8 + (i // len(VIEWS)) * (th + 26)
        sheet.paste(Image.open(p).convert('RGB').resize((int(w * k), int(h * k))), (x, y + 18))
        d.text((x, y + 2), f'{s} {v}', fill=(230, 230, 230))
    sheet.save(shots / f'contact-{key}.png')


async def one(wall: str, night: str) -> list[str]:
    data = gallery.SETTINGS
    data['settings']['look'] = {'glass': 'bright'}
    data['settings']['sky'] = {'background': 'wallpaper', 'wallpaper': wall, 'wallpaper_night': night}
    data['boards'][gallery.SCREEN] = {'pages': [], 'headers': {'home': True}, 'menu': 'tabbar'}
    data['boards'][MENU] = {'pages': [], 'headers': {'home': True}, 'menu': 'open'}
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(
                os.environ.get('NODE', 'node'), str(Path(__file__).with_suffix('.cjs')),
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
            out, _ = await proc.communicate(json.dumps({
                'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'screen': gallery.SCREEN, 'menu': MENU,
                'wall': wall, 'night': night, 'sizes': SIZES, 'shots': str(args.shots)}).encode())
    bad = []
    for line in out.decode().splitlines():
        print(line, flush=True)
        if line.startswith('FAIL'):
            bad.append(line)
    if proc.returncode:
        bad.append(f'FAIL {wall} {night}: the browser stopped')
    contact(args.shots, f'{wall}-{night}')
    return bad


async def main():
    args.shots.mkdir(parents=True, exist_ok=True)
    bad = []
    for wall in WALLS:
        for night in ('day', 'night'):
            bad += await one(wall, night)
    if bad:
        raise SystemExit(f'FAIL: {len(bad)}')
    print(f'PASS: {len(WALLS)} wallpapers, day and night, at {len(SIZES)} sizes')

asyncio.run(main())
