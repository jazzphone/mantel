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
    # not in the folder -> the bundle's
    assert files.resolve(hass, "cards/hk-base.js") == (files.BUNDLE / "cards" / "hk-base.js").resolve()
    # never outside either root
    assert files.resolve(hass, "../__init__.py") is None
    assert files.resolve(hass, "../../mine/fonts/sf-pro.css") is None
    assert files.resolve(hass, "nope.js") is None


async def test_a_folder_made_after_start_is_found_without_a_restart(hass, config_dir, monkeypatch):
    """The folder asked for need not exist yet: once made, it is served (it is
    looked for again, at most every RECHECK_S seconds, while missing)."""
    from custom_components.hk_frontend import files
    files.set_folder(hass, "hk_later")
    assert files.resolve(hass, "fonts/sf-pro.css") == files.BUNDLE.resolve() / "fonts" / "sf-pro.css"
    _write(config_dir / "hk_later" / "fonts" / "sf-pro.css", "mine")
    assert files.resolve(hass, "fonts/sf-pro.css").read_text() != "mine", "not before the next look"
    monkeypatch.setattr(files, "RECHECK_S", 0.0)
    assert files.resolve(hass, "fonts/sf-pro.css").read_text() == "mine"


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
