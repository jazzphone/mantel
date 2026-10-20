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
    for name, (path, (w, h), signed_in, _script) in gallery.SHOTS.items():
        assert path.startswith(("/" + gallery.SCREEN + "/", "/settings", "/login")), name
        assert w > 0 and h > 0 and isinstance(signed_in, bool)


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
