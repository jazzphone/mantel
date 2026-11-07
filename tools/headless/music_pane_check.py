"""Music beside a pane: proportional art, stacked slides and a queue that uses spare height.

Fictional house only. Run with NODE and PLAYWRIGHT_PATH; --shots saves visual evidence.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', choices=('chromium', 'webkit'), default='webkit')
    parser.add_argument('--shots', type=Path)
    parser.add_argument('--size', action='append', help='WxH; omit for all standard sizes')
    args = parser.parse_args()
    if not os.environ.get('PLAYWRIGHT_PATH') or not os.environ.get('NODE'):
        parser.error('NODE and PLAYWRIGHT_PATH are required')
    import gallery
    from aiohttp.test_utils import TestServer
    from client_smoke import OfflineReads
    from app_dev_server import FictionalCommander
    original_read = OfflineReads.request
    original_call = FictionalCommander.call

    for side in ('left', 'right'):
        for width in ('narrow', 'standard', 'wide'):
            gallery.SETTINGS['boards'][f'music-{side}-{width}'] = {
                'title': 'Music Layout Check', 'pages': [], 'screensaver': True,
                'screensaver_options': {'show': 'clock', 'starts_after': 0, 'music_slide': True},
                'side_pane': {'side': side, 'width': width,
                              'dashboard': {'show': 'all', 'sections': [{'kind': 'now_playing', 'size': 'more'}]},
                              'saver': {'show': 'own', 'sections': [{'kind': 'clock', 'size': 'less'}]}}}
    gallery.SETTINGS['boards']['music-full'] = {
        **gallery.SETTINGS['boards']['music-right-standard'],
        'side_pane': {'dashboard': {'show': 'off', 'sections': []}, 'saver': {'show': 'off', 'sections': []}}}
    mp = gallery.HOUSE['media_player.living_room']
    gallery.HOUSE['media_player.living_room'] = (mp[0], (mp[1][0], dict(mp[1][1], entity_picture='/hk/landscapes/01.webp')))

    async def queue(self, msg):
        if msg['type'] != 'hk_music/queue':
            return await original_read(self, msg)
        limit = msg.get('limit', 40)
        return {'ok': True, 'items': [{'id': str(i), 'title': f'Upcoming Song {i}',
                                     'artist': 'The Fictional Trio', 'duration': 180} for i in range(limit)]}

    async def service(self, frame, ticket):
        result = await original_call(self, frame, ticket)
        if frame.get('domain') == 'music_assistant' and frame.get('service') == 'get_queue':
            entity = frame['service_data']['entity_id']
            result['response'] = {entity: {'next_item': {'name': 'Late Train Home', 'media_item': {
                'name': 'Late Train Home', 'artists': [{'name': 'The Fictional Trio'}],
                'image': '/hk/landscapes/01.webp'}}}}
        return result

    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td, patch.object(OfflineReads, 'request', queue), patch.object(FictionalCommander, 'call', service):
        app, cookie = await gallery.build(Path(td))
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(os.environ['NODE'], str(Path(__file__).with_suffix('.cjs')),
                                                        stdin=asyncio.subprocess.PIPE)
            await proc.communicate(json.dumps({'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie,
                                               'engine': args.engine, 'python': sys.executable, 'shots': str(args.shots or ''),
                                               'sizes': [list(map(int, s.split('x'))) for s in args.size] if args.size else None}).encode())
            return proc.returncode


if __name__ == '__main__':
    raise SystemExit(asyncio.run(main()))
