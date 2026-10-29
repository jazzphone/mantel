"""Your files: the folder served under /hk/ ahead of the bundle, where the
Apple font and glyphs go."""
from __future__ import annotations

import os

import pytest
from homeassistant.helpers import issue_registry as ir

DOMAIN = "hk_frontend"


@pytest.fixture
def config_dir(hass, tmp_path):
    hass.config.config_dir = str(tmp_path)
    return tmp_path


def _write(path, text="x"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)


async def test_folder_validation_refuses_anything_but_a_dedicated_subfolder(config_dir):
    from custom_components.hk_frontend.files import validate_folder
    d = str(config_dir)
    assert validate_folder(d, "hk_local") is None               # need not exist yet
    assert validate_folder(d, "") == "folder_required"
    assert validate_folder(d, "../etc") == "folder_outside_config"
    assert validate_folder(d, "a/../../etc") == "folder_outside_config"
    assert validate_folder(d, "/config") == "folder_is_config"
    assert validate_folder(d, d) == "folder_is_config"
    assert validate_folder(d, ".") == "folder_is_config"
    _write(config_dir / "shared" / "secrets.yaml")
    assert validate_folder(d, "shared") == "folder_not_dedicated"
    (config_dir / "store" / ".storage").mkdir(parents=True)
    assert validate_folder(d, "store") == "folder_not_dedicated"
    # Home Assistant's own data, served without sign-in: .storage/auth holds
    # refresh tokens. A hidden folder, one inside it, or HA's own folders.
    (config_dir / ".storage").mkdir(exist_ok=True)
    for bad in (".storage", ".cloud", "hk/.git", "backups", "custom_components/x", "deps", "esphome"):
        assert validate_folder(d, bad) == "folder_not_dedicated", bad
    assert validate_folder(d, "hk_house/www") is None


async def test_only_web_files_are_answered_from_your_folder(hass, config_dir):
    """Whatever the folder, a file a page never loads is not served from it
    (without sign-in): no extensionless store, no YAML, database or key."""
    from custom_components.hk_frontend import files
    for name in ("auth", "notes.yaml", "home.db", "tesla.key", "fonts/SF-Pro.woff2", "pages/p.html"):
        _write(config_dir / "mine" / name)
    files.set_folder(hass, "mine")
    for name in ("auth", "notes.yaml", "home.db", "tesla.key"):
        assert files.resolve(hass, name) is None, name
    assert files.resolve(hass, "fonts/SF-Pro.woff2") is not None
    assert files.resolve(hass, "pages/p.html") is not None


async def test_what_people_type_is_always_relative_to_config(config_dir):
    from custom_components.hk_frontend.files import normalize
    d = str(config_dir)
    for typed in ("hk_local", "/hk_local", "hk_local/", "/config/hk_local", d + "/hk_local"):
        assert normalize(d, typed) == "hk_local", typed
    assert normalize(d, "/etc") == "etc"          # inside /config, never /etc


async def test_your_file_wins_over_the_bundled_one_at_the_same_url(hass, config_dir):
    from custom_components.hk_frontend import files
    _write(config_dir / "mine" / "fonts" / "sf-pro.css", "mine")
    files.set_folder(hass, "mine")
    got = files.resolve(hass, "fonts/sf-pro.css")
    assert got.read_text() == "mine"
    # not in the folder -> the bundle's (its minified copy where the published component has one)
    assert files.resolve(hass, "cards/hk-base.js") == files._minified((files.BUNDLE / "cards" / "hk-base.js").resolve())
    # never outside either root
    assert files.resolve(hass, "../__init__.py") is None
    assert files.resolve(hass, "../../mine/fonts/sf-pro.css") is None
    assert files.resolve(hass, "nope.js") is None


async def test_a_folder_made_after_start_is_found_without_a_restart(hass, config_dir, monkeypatch):
    """The folder asked for need not exist yet: once made, it is served (it is
    looked for again, at most every RECHECK_S seconds, while missing)."""
    from custom_components.hk_frontend import files
    files.set_folder(hass, "hk_later")
    assert files.resolve(hass, "fonts/sf-pro.css") == files._minified(files.BUNDLE.resolve() / "fonts" / "sf-pro.css")
    _write(config_dir / "hk_later" / "fonts" / "sf-pro.css", "mine")
    assert files.resolve(hass, "fonts/sf-pro.css").read_text() != "mine", "not before the next look"
    monkeypatch.setattr(files, "RECHECK_S", 0.0)
    assert files.resolve(hass, "fonts/sf-pro.css").read_text() == "mine"


# COMMENTS AND INDENTATION STRIPPED (2026-10-29): the published component carries frontend_min/, its .js and .css
# minified (publish.py); /hk sends that copy, unless the readable file is newer (edited in place on a house).
async def test_the_minified_copy_is_sent_unless_the_source_is_newer(hass, config_dir, monkeypatch, tmp_path):
    from custom_components.hk_frontend import files
    bundle, small = tmp_path / "frontend", tmp_path / "frontend_min"
    _write(bundle / "cards" / "hk-x.js", "// readable\nvar x = 1;\n")
    _write(bundle / "sky" / "a.webp", "img")
    _write(bundle / "cards" / "hk-y.js", "var y = 1;\n")
    _write(small / "cards" / "hk-x.js", "var x=1;\n")
    monkeypatch.setattr(files, "BUNDLE_ROOT", bundle.resolve())
    monkeypatch.setattr(files, "MINIFIED_ROOT", small.resolve())
    files.set_folder(hass, None)
    old = (bundle / "cards" / "hk-x.js").stat().st_mtime - 10
    os.utime(bundle / "cards" / "hk-x.js", (old, old))
    assert files.resolve(hass, "cards/hk-x.js").read_text() == "var x=1;\n"
    assert files.resolve(hass, "cards/hk-y.js") == (bundle / "cards" / "hk-y.js").resolve()     # no copy: the file
    assert files.resolve(hass, "sky/a.webp") == (bundle / "sky" / "a.webp").resolve()          # never an image
    newer = (small / "cards" / "hk-x.js").stat().st_mtime + 10
    os.utime(bundle / "cards" / "hk-x.js", (newer, newer))
    assert "readable" in files.resolve(hass, "cards/hk-x.js").read_text(), "edited in place: the edit is sent"


async def test_a_symlink_out_of_the_folder_is_not_followed(hass, config_dir):
    from custom_components.hk_frontend import files
    _write(config_dir / "secret.txt", "secret")
    (config_dir / "mine").mkdir()
    os.symlink(config_dir / "secret.txt", config_dir / "mine" / "leak.txt")
    files.set_folder(hass, "mine")
    assert files.resolve(hass, "leak.txt") is None


async def test_an_unsafe_or_missing_folder_serves_only_the_bundle(hass, config_dir):
    from custom_components.hk_frontend import files
    files.set_folder(hass, "does_not_exist")
    assert hass.data[DOMAIN][files.FILES] is None
    files.set_folder(hass, "..")
    assert hass.data[DOMAIN][files.FILES] is None
    assert files.resolve(hass, "cards/hk-base.js") is not None


async def test_status_and_repairs_name_what_is_missing(hass, config_dir):
    from custom_components.hk_frontend import files
    (config_dir / "mine").mkdir()
    files.set_folder(hass, "mine")
    st = files.status(hass)
    assert st["font"] is None and st["glyphs"] is None
    files.raise_issues(hass, st, "mine")
    reg = ir.async_get(hass)
    placeholders = reg.async_get_issue(DOMAIN, "missing_font").translation_placeholders
    assert placeholders["folder"] == "mine" and placeholders["guide_url"].endswith("/wiki/Your-Files")
    assert reg.async_get_issue(DOMAIN, "missing_glyphs") is not None
    # Apple's own .ttf is enough for the font; the glyph file clears the other
    _write(config_dir / "mine" / "fonts" / "SF-Pro.ttf")
    _write(config_dir / "mine" / "iconset" / "hk-glyphs.js")
    st = files.status(hass)
    assert st["font"] == "folder:fonts/SF-Pro.ttf" and st["glyphs"] == "folder:iconset/hk-glyphs.js"
    files.raise_issues(hass, st, "mine")
    assert reg.async_get_issue(DOMAIN, "missing_font") is None
    assert reg.async_get_issue(DOMAIN, "missing_glyphs") is None


async def test_the_files_page_saves_only_its_own_key(hass, frontend, config_dir):
    e = hass.config_entries.async_entries(DOMAIN)[0]
    before = dict(e.options)
    r = await hass.config_entries.options.async_init(e.entry_id)
    r = await hass.config_entries.options.async_configure(r["flow_id"], {"next_step_id": "files"})
    assert r["step_id"] == "files"
    r = await hass.config_entries.options.async_configure(r["flow_id"], {"files_folder": ".."})
    assert r["errors"] == {"files_folder": "folder_outside_config"}
    (config_dir / "my_house" / "www").mkdir(parents=True)
    r = await hass.config_entries.options.async_configure(r["flow_id"], {"files_folder": "/my_house/www/"})
    assert r["type"] == "menu"          # saved, and back to the menu
    assert e.options == {**before, "files_folder": "my_house/www"}
    await hass.async_block_till_done()
    from custom_components.hk_frontend import files
    assert hass.data[DOMAIN][files.FILES] == (config_dir / "my_house" / "www").resolve()


async def test_the_bundle_ships_no_apple_files():
    """The whole point: nothing of Apple's is in the integration's folder."""
    from custom_components.hk_frontend import files
    bundle = files.BUNDLE
    assert not (bundle / "fonts" / "SF-Pro.woff2").exists()
    assert not (bundle / "fonts" / "SF-Pro.ttf").exists()
    assert not (bundle / "iconset" / "hk-glyphs.js").exists()


# GZIP, MADE HERE AND KEPT (2026-10-29): the component carries no .gz copies, so the view gzips the text files
# for a browser that accepts it -- once, in the executor, kept by path, mtime and size.
async def test_a_text_file_is_gzipped_for_a_browser_that_takes_gzip(hass, frontend, config_dir, monkeypatch):
    import gzip
    import threading
    from aiohttp import web
    from aiohttp.test_utils import make_mocked_request
    from custom_components.hk_frontend import files
    # (http is a stand-in in these tests: the view is the one the component registered)
    view = next(c.args[0] for c in hass.http.register_view.call_args_list if c.args[0].name == "hk_frontend:file")

    async def get(path, **headers):
        return await view.get(make_mocked_request("GET", "/hk/" + path, headers=headers), path)
    text = "var hk = 'a line of HK code, repeated';\n" * 300
    _write(config_dir / "mine" / "modules" / "hk-big.js", text)
    _write(config_dir / "mine" / "modules" / "hk-tiny.js", "var a = 1;\n")
    files.set_folder(hass, "mine")
    files._GZIPPED.clear()
    files._GZIPPED_SIZE[0] = 0
    where = []
    real = files.gzipped

    def spy(target):
        where.append(threading.current_thread() is threading.main_thread())
        return real(target)
    monkeypatch.setattr(files, "gzipped", spy)
    r = await get("modules/hk-big.js", **{"Accept-Encoding": "gzip"})
    assert r.status == 200 and r.headers["Content-Encoding"] == "gzip"
    assert r.headers["Vary"] == "Accept-Encoding" and r.headers["Cache-Control"] == "no-cache"
    assert r.content_type == "text/javascript" or r.content_type == "application/javascript"
    assert gzip.decompress(r.body).decode() == text and len(r.body) < len(text) / 4
    etag = r.headers["ETag"]
    assert etag.endswith('-gz"')
    assert where == [False], "compressed off the event loop"
    # kept: the second request is the same bytes from the one cache entry
    r2 = await get("modules/hk-big.js", **{"Accept-Encoding": "gzip, deflate"})
    assert r2.body == r.body and len(files._GZIPPED) == 1
    # a 304 for the ETag held, a full answer for any other
    r3 = await get("modules/hk-big.js", **{"Accept-Encoding": "gzip", "If-None-Match": etag})
    assert r3.status == 304 and r3.headers["ETag"] == etag
    assert (await get("modules/hk-big.js", **{"Accept-Encoding": "gzip", "If-None-Match": '"other"'})).status == 200
    # no gzip taken: the file as it is (aiohttp's own, with its own ETag), never the gzipped body
    for none in ({"Accept-Encoding": "identity"}, {"Accept-Encoding": "gzip;q=0"}, {}):
        r4 = await get("modules/hk-big.js", **none)
        assert isinstance(r4, web.FileResponse) and "Content-Encoding" not in r4.headers
        assert r4.headers["Vary"] == "Accept-Encoding" and r4.headers["Cache-Control"] == "no-cache"
    # small files go as they are
    assert isinstance(await get("modules/hk-tiny.js", **{"Accept-Encoding": "gzip"}), web.FileResponse)
    assert (await get("nope.js", **{"Accept-Encoding": "gzip"})).status == 404
    # the ordered boot file is gzipped too, and still the same text
    rb = await get("modules/hk-boot.js", **{"Accept-Encoding": "gzip"})
    assert rb.headers["Content-Encoding"] == "gzip"
    plain = await get("modules/hk-boot.js", **{"Accept-Encoding": "identity"})
    assert "Content-Encoding" not in plain.headers and gzip.decompress(rb.body).decode() == plain.text
    assert (await get("modules/hk-boot.js", **{"Accept-Encoding": "gzip", "If-None-Match": rb.headers["ETag"]})).status == 304


async def test_an_edited_file_is_gzipped_again_and_the_cache_is_bounded(hass, config_dir, monkeypatch):
    import gzip
    from custom_components.hk_frontend import files
    files._GZIPPED.clear()
    files._GZIPPED_SIZE[0] = 0
    f = config_dir / "a.js"
    _write(f, "var one = 1;\n" * 400)
    first = files.gzipped(f)
    assert gzip.decompress(first[0]).decode() == "var one = 1;\n" * 400
    _write(f, "var two = 2;\n" * 401)                   # another size and time: another key, another ETag
    second = files.gzipped(f)
    assert gzip.decompress(second[0]).decode() == "var two = 2;\n" * 401 and second[1] != first[1]
    # bounded: room for about two bodies, the oldest goes first
    monkeypatch.setattr(files, "GZIP_CACHE_LIMIT", len(first[0]) + len(second[0]) + 10)
    g, h = config_dir / "b.js", config_dir / "c.js"
    _write(g, "var three = 3;\n" * 500)
    _write(h, "var four = 4;\n" * 500)
    files.gzipped(g)
    files.gzipped(h)
    assert files._GZIPPED_SIZE[0] <= files.GZIP_CACHE_LIMIT or len(files._GZIPPED) == 1
    assert [k[0].rsplit("/", 1)[1] for k in files._GZIPPED][-2:] == ["b.js", "c.js"]
    assert sum(len(b) for b, _ in files._GZIPPED.values()) == files._GZIPPED_SIZE[0]
    # not text, small, or too large: sent as it is
    _write(config_dir / "p.png", "x" * 5000)
    _write(config_dir / "s.js", "x")
    monkeypatch.setattr(files, "GZIP_MAX", 100)
    assert files.gzipped(config_dir / "p.png") is None and files.gzipped(config_dir / "s.js") is None
    assert files.gzipped(config_dir / "a.js") is None
    assert files.accepts_gzip("gzip, deflate, br") and files.accepts_gzip("*") and not files.accepts_gzip("identity")
    assert not files.accepts_gzip("gzip;q=0") and files.accepts_gzip("deflate, gzip;q=0.5") and not files.accepts_gzip(None)
