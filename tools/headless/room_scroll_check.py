"""Room scrolling and entity icons in Chromium and WebKit, using a fictional house."""
import asyncio, json, os, sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]
import gallery
from aiohttp.test_utils import TestServer

async def main():
    for i in range(8):
        gallery.HOUSE[f'light.kitchen_extra_{i}'] = ('kitchen', gallery._light(f'Extra {i}', True, 50))
    gallery.HOUSE['switch.coffee'] = ('kitchen', ('off', {'friendly_name': 'Coffee Maker', 'icon': 'mdi:coffee-maker'}))
    gallery.HOUSE['input_button.good_morning'] = (None, ('unknown', {'friendly_name': 'Good Morning'}))
    gallery.HOUSE['switch.unsupported_icon'] = (None, ('off', {'friendly_name': 'Unknown Icon', 'icon': 'mdi:missing-test-icon'}))
    gallery.SETTINGS['boards']['room-scroll'] = {'home_style': 'grid', 'home_grid': {
        'v': 1, 'cols': 6, 'rows': 4, 'frame': [1280, 800], 'band': False, 'items': [
            {'id': 'room', 'card': 'room', 'size': 'L', 'at': [0, 0], 'opts': {'area': 'kitchen', 'accessory_display': 'scroll'}, 'pages': {'source': 'rooms'}},
            {'id': 'coffee', 'card': 'accessory', 'size': 'S', 'at': [2, 0], 'opts': {'entity': 'switch.coffee'}},
            {'id': 'morning', 'card': 'accessory', 'size': 'S', 'at': [3, 0], 'opts': {'entity': 'input_button.good_morning'}},
            {'id': 'fallback', 'card': 'accessory', 'size': 'S', 'at': [4, 0], 'opts': {'entity': 'switch.unsupported_icon'}}]}}
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        from mantel_server.settings_store import load_model
        app['settings'].model = load_model()
        async with TestServer(app) as server:
            proc = await asyncio.create_subprocess_exec(os.environ['NODE'], str(Path(__file__).with_suffix('.cjs')), stdin=asyncio.subprocess.PIPE)
            await proc.communicate(json.dumps({'origin': str(server.make_url('')).rstrip('/'), 'cookie': cookie}).encode())
            assert proc.returncode == 0
asyncio.run(main())
