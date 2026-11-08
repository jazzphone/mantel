"""The Home Grid editor's card previews follow the screen's tile style (2026-11-08, the owner: "the card previews followed
the appearance default for tiles (centered vs home) so you have an idea of what things look like").

Automatic is Centered on square cells and Home on tiles; the screen's own Centered or Home wins; Security past Small keeps
its own look, as it does on the screen (hk-strategy.js homeGridView).

    python tools/headless/editor_preview_tile_check.py
"""
import asyncio
import sys, tempfile
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests')]
from gallery import build, SCREEN
from cdp import Browser
from aiohttp.test_utils import TestServer

TILE = "ed.palette.querySelector('[data-preview-card] iframe').contentWindow.galleryCard?.getAttribute('tile')"
CASES = (("accessory", "tile", "auto", None), ("accessory", "square", "auto", "centred"), ("accessory", "tile", "centred", "centred"),
         ("accessory", "square", "home", None), ("security", "square", "centred", None), ("scene", "tile", "auto", None))


async def main():
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await build(Path(td))
        from mantel_server.settings_store import load_model
        app['settings'].model = load_model()
        async with TestServer(app) as server, Browser(1600, 1000) as b:
            origin = str(server.make_url('')).rstrip('/')
            await b.restrict_origin(origin)
            await b.open(origin + '/settings#/screens/' + SCREEN + '/home-grid', cookie)
            assert await b.wait("!!document.querySelector('hk-settings-panel')?.shadowRoot?.querySelector('hk-grid-editor')?.shadowRoot?.querySelector('.tools')", 20)
            await b.eval("window.ed=document.querySelector('hk-settings-panel').shadowRoot.querySelector('hk-grid-editor');void 0")
            assert await b.wait("!!ed.starterGrids && ed.sidebar.querySelectorAll('.starter[data-starter]').length===8", 20)
            await b.eval("ed.sidebar.querySelector('[data-starter=R]').click()")
            assert await b.wait("ed.grid?.items.some(i=>i.card==='room'&&i.size==='XL')", 10)
            await b.eval("void ed.starter('A')")
            assert await b.wait("[...ed.shadowRoot.querySelectorAll('button')].some(b=>b.textContent==='Use Starter')", 5)
            await b.eval("[...ed.shadowRoot.querySelectorAll('button')].find(b=>b.textContent==='Use Starter').click()")
            assert await b.wait("ed.grid.items.some(i=>i.card==='scene_suggested') && !!ed.palette", 10)
            for card, cell, own, want in CASES:
                await b.eval(f"ed.grid.cell='{cell}'; ed.o.board.tile_style='{own}'; ed.pickerCard='{card}'; ed.paletteSizes['{card}']='{'L' if card == 'security' else 'S'}'; ed.side(); void 0")
                assert await b.wait("!!ed.palette.querySelector('[data-preview-card] iframe')?.contentWindow?.galleryCard?.shadowRoot", 30), (card, cell, own)
                got = await b.eval(TILE)
                assert got == want, (card, cell, own, 'wanted', want, 'got', got)
                print('ok', card, cell, own, got, flush=True)

asyncio.run(main())
