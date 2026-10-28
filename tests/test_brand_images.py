"""The store images: the integrations' brand/ folders (the brands repository's rules, which Home Assistant 2026.3
and later reads from a custom integration's own folder) and the Apps' icon.png / logo.png. tools/make_brand_logos.py
draws the logos; these checks hold whatever drew them."""
from pathlib import Path

import struct

import pytest

ROOT = Path(__file__).resolve().parents[1]
BRANDS = [ROOT / "hosts/ha/custom_components/hk_frontend/brand", ROOT / "hosts/ha/custom_components/mantel/brand"]


def size(path: Path) -> tuple[int, int]:
    head = path.read_bytes()[:24]
    assert head[:8] == b"\x89PNG\r\n\x1a\n" and head[12:16] == b"IHDR", f"{path} is a PNG"
    return struct.unpack(">II", head[16:24])


@pytest.mark.parametrize("brand", BRANDS, ids=lambda p: p.parent.name)
def test_the_brand_folder_follows_the_brands_repository(brand):
    assert size(brand / "icon.png") == (256, 256) and size(brand / "icon@2x.png") == (512, 512)
    for prefix in ("", "dark_"):
        w1, h1 = size(brand / f"{prefix}logo.png")
        w2, h2 = size(brand / f"{prefix}logo@2x.png")
        assert w1 > h1, "a logo is landscape"
        assert 128 <= min(w1, h1) <= 256 and 256 <= min(w2, h2) <= 512, "the shortest side's range"
        assert (w2, h2) == (w1 * 2, h1 * 2)
    assert size(brand / "logo.png") == size(brand / "dark_logo.png")


@pytest.mark.parametrize("brand", BRANDS, ids=lambda p: p.parent.name)
def test_the_logos_are_trimmed_and_transparent(brand):
    Image = pytest.importorskip("PIL.Image")
    for name in ("logo.png", "dark_logo.png", "logo@2x.png", "dark_logo@2x.png"):
        with Image.open(brand / name) as img:
            alpha = img.convert("RGBA").getchannel("A")
            assert alpha.getbbox() == (0, 0, img.width, img.height), f"{name}: no empty border left"
            assert alpha.getextrema()[0] == 0, f"{name}: a transparent background"


def test_the_apps_have_their_icons_and_logos():
    """Home Assistant's App store: icon.png square (128), logo.png about 250x100."""
    for app in ("ha-app", "connect-app"):
        assert size(ROOT / "packaging" / app / "icon.png") == (128, 128), app
        assert size(ROOT / "packaging" / app / "logo.png") == (250, 100), app
    a = (ROOT / "packaging/ha-app/icon.png").read_bytes()
    assert a != (ROOT / "packaging/connect-app/icon.png").read_bytes(), "Mantel Connect is another App"
