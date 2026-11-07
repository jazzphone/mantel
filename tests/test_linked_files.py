"""The home's SF Pro and glyph file for a linked HK Frontend (linked_files.py): a client that asks (features=files)
is told which of them Mantel has after its hello and again after an upload or delete; it fetches them a piece at a
time with file_chunk; nobody else gets the frame or may ask; only the licensed files are ever named or sent. Every
font and glyph file here is GENERATED (tests/test_user_files_guard.py)."""
import asyncio
import base64
import hashlib
import json

from aiohttp import WSMsgType

import test_features
from mantel_server import linked_files as LF
from test_user_files import GLYPHS, dummy_woff2

build, make_env = test_features.build, test_features.make_env       # the fixtures

HK = "domain=hk_frontend; protocol=1; features=bridge,settings,files"


async def connect(env, header=HK):
    _acct, token = env.app["service_accounts"].create("home-assistant", ["linked"])
    env.m.client.session.headers.pop("Origin", None)
    try:
        ws = await env.m.client.ws_connect("/linked/ws", headers={"Authorization": f"Bearer {token}",
                                                                  **({"X-Mantel-Link": header} if header else {})})
    finally:
        env.m.client.session.headers["Origin"] = env.m.origin
    hello = await ws.receive_json(timeout=5)
    assert hello["type"] == "hello"
    return ws


async def frames(ws, timeout=1.0):
    """Every frame that arrives within `timeout` (then a ping's answer ends the wait)."""
    got = []
    await ws.send_json({"id": 99, "type": "ping"})
    while True:
        m = await ws.receive(timeout=timeout + 4)
        assert m.type == WSMsgType.TEXT
        f = json.loads(m.data)
        if f.get("type") == "result" and f.get("id") == 99:
            try:
                while True:
                    m = await ws.receive(timeout=timeout)
                    got.append(json.loads(m.data))
            except asyncio.TimeoutError:
                return got
        got.append(f)


def files_frames(got):
    return [f for f in got if f.get("type") == "files"]


async def ask(ws, mid, **payload):
    await ws.send_json({"id": mid, "type": "file_chunk", **payload})
    while True:
        f = await ws.receive_json(timeout=5)
        if f.get("type") == "result" and f.get("id") == mid:
            return f


def put(env, rel, data):
    store = env.app["user_files"]
    p = store.hk / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    return p


async def test_a_linked_hk_frontend_that_asks_is_told_which_files_mantel_has(make_env):
    env = await make_env()
    font = dummy_woff2(200)
    put(env, "fonts/SF-Pro.woff2", font)
    put(env, "fonts/Other.woff2", dummy_woff2())             # not one HK asks for: never named
    put(env, "sky/clouds-a.webp", b"x")
    ws = await connect(env)
    got = files_frames(await frames(ws, 0.4))
    assert got == [{"type": "files", "files": [{"path": "fonts/SF-Pro.woff2", "size": len(font),
                                                "sha256": hashlib.sha256(font).hexdigest()}]}]
    await ws.close()


async def test_nobody_else_gets_the_frame_or_may_ask(make_env):
    env = await make_env()
    put(env, "fonts/SF-Pro.woff2", dummy_woff2())
    for header in (None, "domain=hk_frontend; protocol=1; features=bridge,settings",
                   "domain=mantel; protocol=2; features=bridge,files"):
        ws = await connect(env, header)
        assert files_frames(await frames(ws, 0.3)) == [], header
        r = await ask(ws, 5, path="fonts/SF-Pro.woff2", offset=0)
        assert r["success"] is False, header
        await ws.close()


async def test_the_file_comes_a_piece_at_a_time_and_adds_up(make_env, monkeypatch):
    env = await make_env()
    font = dummy_woff2(5000)
    put(env, "fonts/SF-Pro.woff2", font)
    monkeypatch.setattr(LF, "CHUNK", 1024)
    ws = await connect(env)
    await frames(ws, 0.2)
    buf, mid = b"", 10
    while len(buf) < len(font):
        r = await ask(ws, mid, path="fonts/SF-Pro.woff2", offset=len(buf))
        assert r["success"], r
        res = r["result"]
        assert res["size"] == len(font) and res["sha256"] == hashlib.sha256(font).hexdigest()
        assert res["offset"] == len(buf)
        piece = base64.b64decode(res["data"])
        assert 0 < len(piece) <= 1024
        buf += piece
        mid += 1
    assert buf == font
    await ws.close()


async def test_only_the_licensed_files_and_sane_offsets(make_env):
    env = await make_env()
    put(env, "fonts/SF-Pro.woff2", dummy_woff2())
    put(env, "fonts/Other.woff2", dummy_woff2())
    ws = await connect(env)
    await frames(ws, 0.2)
    for mid, payload in enumerate(({"path": "fonts/Other.woff2", "offset": 0},
                                   {"path": "../../secrets/backup.key", "offset": 0},
                                   {"path": "fonts/SF-Pro.ttf", "offset": 0},          # licensed, but Mantel has none
                                   {"path": "fonts/SF-Pro.woff2", "offset": -1},
                                   {"path": "fonts/SF-Pro.woff2", "offset": True},
                                   {"path": "fonts/SF-Pro.woff2", "offset": 10 ** 9}), start=20):
        r = await ask(ws, mid, **payload)
        assert r["success"] is False and r["error"]["code"] in ("invalid", "not_found"), (payload, r)
    r = await ask(ws, 30, path="fonts/SF-Pro.woff2", offset=0, extra=1)
    assert r["success"] is False and r["error"]["code"] == "bad_request"
    await ws.close()


async def test_an_upload_or_a_delete_tells_them_again_once(make_env):
    env = await make_env()
    ws = await connect(env)
    first = files_frames(await frames(ws, 0.3))
    assert first == [{"type": "files", "files": []}], "told even when Mantel has none yet"
    store = env.app["user_files"]
    write, _ = store.prepare_font("SF-Pro.woff2", dummy_woff2(300))
    write()
    write, _ = store.prepare_glyphs(json.dumps(GLYPHS).encode())
    write()
    for kind in ("font", "glyphs", "font"):            # a burst goes out once
        store.changed(kind)
    store.changed("photo")                             # a photo is not one of them
    got = files_frames(await frames(ws, 0.6))
    assert len(got) == 1, got
    assert [f["path"] for f in got[0]["files"]] == ["fonts/SF-Pro.woff2", "iconset/hk-glyphs.js"]
    (store.hk / "fonts/SF-Pro.woff2").unlink()
    store.changed("font")
    got = files_frames(await frames(ws, 0.6))
    assert [f["path"] for f in got[-1]["files"]] == ["iconset/hk-glyphs.js"]
    await ws.close()
