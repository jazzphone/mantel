"""tools/headless/gallery.py: the docs' screenshots come from an invented house only."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/headless"))
spec = importlib.util.spec_from_file_location("gallery", ROOT / "tools/headless/gallery.py")
gallery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gallery)


def test_every_shot_is_one_of_mantel_s_own_pages():
    screens = {"/" + gallery.SCREEN + "/", "/" + gallery.GRID_SCREEN + "/"}       # Home, and the Home Grid screen
    for name, (path, (w, h), signed_in, script) in gallery.SHOTS.items():
        assert path.startswith(tuple(screens) + ("/settings", "/login")), name
        assert w > 0 and h > 0 and isinstance(signed_in, bool) and (script is None or isinstance(script, str)), name


def test_the_home_grid_screen_uses_the_home_grid_layout():
    from hk_core.settings import home_grid
    board = gallery.wall_display()
    assert board["home_style"] == "grid" and home_grid.check(board["home_grid"]) == board["home_grid"]
    cards = {i["card"] for i in board["home_grid"]["items"]}
    assert {"now_playing", "camera", "thermostat", "room", "scenes"} <= cards      # the blocks the shots turn over and open
    assert gallery.SETTINGS["boards"][gallery.SCREEN].get("home_style") is None     # the other screen stays Home


def test_the_power_page_reads_only_the_invented_house():
    power = gallery.POWER_PLAN["power"]
    named = [power[k] for k in ("home", "grid", "grid_export", "grid_status", "solar")]
    named += list(power["battery"].values())
    for car in power["cars"]:
        named += [car[k] for k in ("level", "power", "home", "plugged", "charge", "charger")]
    for section in power["sections"]:
        named += [item["power"] for item in section["items"]]
    assert all(eid in gallery.HOUSE for eid in named), [e for e in named if e not in gallery.HOUSE]
    assert gallery.FictionalFeatures().client_part(None)["added"] == ["energy"]


def test_the_owner_is_the_docs_fictional_owner():
    assert gallery.OWNER.startswith("Avery ")


def test_the_house_is_invented():
    rooms = {a for a, _, _ in gallery.ROOMS}
    for eid, (area, (state, attrs)) in gallery.HOUSE.items():
        assert area is None or area in rooms, eid
        assert isinstance(state, str) and attrs.get("friendly_name"), eid
    # the cameras' stills are HK's own landscapes, never a picture of a home
    assert all((ROOT / "web/hk/landscapes" / n).is_file() for n in ("07.webp", "21.webp"))


def test_the_docs_images_are_the_gallery_s():
    images = {p.stem for p in (ROOT / "docs/images").glob("*.webp")}
    assert set(gallery.SHOTS) <= images


def test_hk_frontend_s_help_screenshots_are_small_webp():
    """2026-10-29: 157 PNG and JPG files (79 MB) became WebP of at most 1440 px, as the guide's own are. A new
    screenshot goes in the same way (docs/development/Screenshots.md), not as a PNG that ships in every image."""
    from PIL import Image
    folder = ROOT / "hosts/ha/custom_components/hk_frontend/docs/images"
    assert [p.name for p in folder.iterdir() if p.suffix.lower() != ".webp"] == []
    for p in folder.glob("*.webp"):
        with Image.open(p) as im:
            assert max(im.size) <= 1440, p.name
