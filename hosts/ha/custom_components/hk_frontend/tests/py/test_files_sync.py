"""Your files from Mantel Server (files_sync.py; Mantel's linked_files.py): the link asks for them (features=files);
a file Mantel has and Your files' folder lacks is fetched a piece at a time, checked by its bytes and written
there, so /hk/ serves it and its Repairs entry goes; the glyph file is written by this side; a copy someone put
there is never replaced; a file that is not what Mantel announced, or not a font, is not written; nothing is
fetched again after a restart. Every font and glyph file here is GENERATED, nothing of Apple's."""
from __future__ import annotations

import base64
import hashlib
import json
import struct

import pytest
from homeassistant.helpers import issue_registry as ir

from mantel_fake import FakeMantel, until
from test_linked_mode import _linked, _unload

DOMAIN = "hk_frontend"
GLYPHS = {"icons": {"light-on": "M 1 1 L 5 5 Z"}, "twotone": {}, "weather": {}}


def woff2(extra=3000) -> bytes:
    total = 48 + extra
    return struct.pack(">4sIIHH", b"wOF2", 0x00010000, total, 1, 0) + b"\x00" * 32 + b"\x01" * extra


def glyphs_js() -> bytes:
    return ("// someone's glyphs\nwindow.hkGlyphs = " + json.dumps(GLYPHS) + ";\n").encode()


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def frame(files: dict[str, bytes], **override) -> dict:
    return {"type": "files", "files": [{"path": p, "size": len(b), "sha256": sha(b), **override.get(p, {})}
                                       for p, b in files.items()]}


@pytest.fixture
async def mantel(socket_enabled):
    fake = await FakeMantel().start()
    fake.files = {}

    async def answer(ws, msg):
        if msg.get("type") != "file_chunk":
            return await fake.ok(ws, msg)
        data = fake.files.get(msg["path"])
        if data is None:
            return {"id": msg["id"], "type": "result", "success": False,
                    "error": {"code": "not_found", "message": "no such file"}}
        piece = data[msg["offset"]:msg["offset"] + 1000]
        return {"id": msg["id"], "type": "result", "success": True,
                "result": {"path": msg["path"], "offset": msg["offset"], "size": len(data), "sha256": sha(data),
                           "data": base64.b64encode(piece).decode()}}
    fake.answer = answer
    yield fake
    await fake.close()


@pytest.fixture
def config_dir(hass, tmp_path):
    hass.config.config_dir = str(tmp_path)
    return tmp_path


def _state(hass):
    from custom_components.hk_frontend import files_sync
    return files_sync.state(hass)


async def test_the_link_asks_for_the_files(hass, base, mantel, config_dir):
    e = await _linked(hass, mantel)
    assert "files" in mantel.headers[-1]["X-Mantel-Link"].split("features=", 1)[1].split(",")
    await _unload(hass, e)


async def test_missing_files_are_taken_from_mantel_and_served(hass, base, mantel, config_dir):
    from custom_components.hk_frontend import files
    font, js = woff2(), glyphs_js()
    mantel.files = {"fonts/SF-Pro.woff2": font, "iconset/hk-glyphs.js": js}
    e = await _linked(hass, mantel)
    await mantel.push(frame(mantel.files))
    await until(hass, lambda: _state(hass) == {"fonts/SF-Pro.woff2": "mantel", "iconset/hk-glyphs.js": "mantel"})
    await hass.async_block_till_done()
    root = config_dir / "hk_local"
    assert (root / "fonts/SF-Pro.woff2").read_bytes() == font
    assert len(mantel.calls("file_chunk")) >= 4, "a piece at a time"
    # the glyph file is this side's own writing of the data, never the bytes that came
    written = (root / "iconset/hk-glyphs.js").read_text()
    assert "someone's glyphs" not in written and "HK Frontend, from Mantel Server" in written
    assert json.dumps("M 1 1 L 5 5 Z") in written
    assert files.resolve(hass, "fonts/SF-Pro.woff2") == (root / "fonts/SF-Pro.woff2").resolve()
    reg = ir.async_get(hass)
    assert reg.async_get_issue(DOMAIN, "missing_font") is None and reg.async_get_issue(DOMAIN, "missing_glyphs") is None
    # the same list again: nothing fetched again
    n = len(mantel.calls("file_chunk"))
    await mantel.push(frame(mantel.files))
    await hass.async_block_till_done()
    await until(hass, lambda: True)
    assert len(mantel.calls("file_chunk")) == n
    await _unload(hass, e)


async def test_a_copy_put_here_is_never_replaced(hass, base, mantel, config_dir):
    mine = woff2(500)
    (config_dir / "hk_local/fonts").mkdir(parents=True)
    (config_dir / "hk_local/fonts/SF-Pro.woff2").write_bytes(mine)
    mantel.files = {"fonts/SF-Pro.woff2": woff2(3000)}
    e = await _linked(hass, mantel)
    await mantel.push(frame(mantel.files))
    await until(hass, lambda: _state(hass).get("fonts/SF-Pro.woff2") == "kept")
    assert (config_dir / "hk_local/fonts/SF-Pro.woff2").read_bytes() == mine
    assert mantel.calls("file_chunk") == []
    await _unload(hass, e)


async def test_a_copy_identical_to_mantel_s_is_adopted_and_then_follows_mantel(hass, base, mantel, config_dir):
    first = woff2(500)
    (config_dir / "hk_local/fonts").mkdir(parents=True)
    (config_dir / "hk_local/fonts/SF-Pro.woff2").write_bytes(first)
    mantel.files = {"fonts/SF-Pro.woff2": first}
    e = await _linked(hass, mantel)
    await mantel.push(frame(mantel.files))
    await until(hass, lambda: _state(hass).get("fonts/SF-Pro.woff2") == "mantel")
    assert mantel.calls("file_chunk") == []
    newer = woff2(2500)
    mantel.files = {"fonts/SF-Pro.woff2": newer}       # an Owner uploads a new one to Mantel
    await mantel.push(frame(mantel.files))
    await until(hass, lambda: (config_dir / "hk_local/fonts/SF-Pro.woff2").read_bytes() == newer)
    await _unload(hass, e)


async def test_what_is_not_the_announced_file_or_not_a_font_is_not_written(hass, base, mantel, config_dir):
    mantel.files = {"fonts/SF-Pro.woff2": b"<script>not a font</script>" * 10}
    e = await _linked(hass, mantel)
    await mantel.push(frame(mantel.files))
    await until(hass, lambda: _state(hass).get("fonts/SF-Pro.woff2") == "failed")
    assert not (config_dir / "hk_local/fonts/SF-Pro.woff2").exists()
    # announced as one file, sent as another
    mantel.files = {"fonts/SF-Pro.woff2": woff2()}
    await mantel.push(frame(mantel.files, **{"fonts/SF-Pro.woff2": {"sha256": "0" * 64}}))
    await hass.async_block_till_done()
    await until(hass, lambda: len(mantel.calls("file_chunk")) >= 2)
    await hass.async_block_till_done()
    assert not (config_dir / "hk_local/fonts/SF-Pro.woff2").exists()
    await _unload(hass, e)


async def test_only_the_licensed_files_are_taken(hass, base, mantel, config_dir):
    from custom_components.hk_frontend.files_sync import announced
    ok = {"path": "fonts/SF-Pro.woff2", "size": 10, "sha256": "a" * 64}
    assert announced({"files": [ok]}) == [ok]
    for bad in ({**ok, "path": "../../secrets.yaml"}, {**ok, "path": "fonts/Evil.woff2"}, {**ok, "size": 0},
                {**ok, "size": True}, {**ok, "sha256": "x"}, "fonts/SF-Pro.woff2"):
        assert announced({"files": [bad]}) == [], bad
    assert announced({"files": {"fonts/SF-Pro.woff2": ok}}) == []
    assert announced({"files": [ok, ok]}) == [ok]


async def test_a_restart_does_not_fetch_again(hass, base, mantel, config_dir, hass_storage):
    mantel.files = {"fonts/SF-Pro.woff2": woff2()}
    e = await _linked(hass, mantel)
    await mantel.push(frame(mantel.files))
    await until(hass, lambda: _state(hass).get("fonts/SF-Pro.woff2") == "mantel")
    await hass.async_block_till_done()
    await _unload(hass, e)
    n = len(mantel.calls("file_chunk"))
    hass.data.get(DOMAIN, {}).pop("files_from_mantel", None)
    assert await hass.config_entries.async_setup(e.entry_id)
    await hass.async_block_till_done()
    await until(hass, lambda: mantel.connects >= 2)
    await mantel.push(frame(mantel.files))
    await until(hass, lambda: _state(hass).get("fonts/SF-Pro.woff2") == "mantel")
    assert len(mantel.calls("file_chunk")) == n
    await _unload(hass, e)
