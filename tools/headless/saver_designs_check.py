"""Saved screensaver scope, persistence, preview selection and touch editor on a fictional house."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]


async def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--engine', choices=('chromium', 'webkit'), default='webkit')
    ap.add_argument('--size', default='1280x800')
    ap.add_argument('--shots', type=Path)
    ap.add_argument('--thumbs-only', action='store_true', help='check responsive gallery thumbnails only')
    ap.add_argument('--preview-only', action='store_true', help='check preview controls and face option updates')
    args = ap.parse_args()
    if not os.environ.get('NODE') or not os.environ.get('PLAYWRIGHT_PATH'):
        print('NOT RUN: NODE and PLAYWRIGHT_PATH are required')
        return 2
    import gallery
    from aiohttp.test_utils import TestServer
    from hk_core.settings import model as M
    screen = 'design-test'
    original = M.saver_options({'show': 'clock', 'clock_style': 'classic'})
    original['designs'] = [{'id': 'original', 'name': 'Original', 'options': {'show': 'clock', 'clock_style': 'classic'}}]
    original['active_design'] = 'original'
    gallery.SETTINGS['settings']['look']['saver'] = original
    gallery.SETTINGS['boards'][screen] = {'title': 'Fictional Design Tablet', 'pages': [], 'screensaver': True, 'screensaver_options': None,
        'side_pane': {'dashboard': {'show': 'off', 'sections': []}, 'saver': {'show': 'own', 'sections': [{'kind': 'clock'}, {'kind': 'weather'}]}}}
    gallery.SETTINGS['boards']['design-off'] = {'title': 'Fictional Disabled Pane', 'pages': [], 'screensaver': True, 'screensaver_options': None, 'side_pane': {'dashboard': {'show': 'off', 'sections': []}, 'saver': {'show': 'off', 'sections': []}}}
    gallery.HOUSE['sensor.test_market'] = (None, ('123.45', {'friendly_name': 'Fictional Index', 'change_percent': -1.2, 'unit_of_measurement': 'USD'}))
    gallery.HOUSE['sensor.test_news'] = (None, ('3', {'entries': [{'title': 'Fictional headline for the test'}]}))
    for key,(meta,reading) in list(gallery.HOUSE.items()):
        if key.startswith('media_player.'):
            gallery.HOUSE[key] = (meta, ('idle', reading[1]))
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td), showcase=True, real_model=True)
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(os.environ['NODE'], str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE)
            await proc.communicate(json.dumps({'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie, 'engine': args.engine,
                'size': args.size, 'screen': screen, 'shots': str(args.shots or ''), 'thumbsOnly': args.thumbs_only, 'previewOnly': args.preview_only}).encode())
            return proc.returncode


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
