"""The HA artifact is assembled from Mantel only, with no live installation writes."""
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def builder():
    spec = importlib.util.spec_from_file_location("build_ha", ROOT / "tools/build_ha.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_ha_build_has_one_frontend_source_and_no_server_or_house_files():
    pairs = builder().plan()
    dests = {dest: Path(src) for src, dest in pairs}
    assert len(dests) == len(pairs)
    prefix = "custom_components/hk_frontend/frontend/"
    assert dests[prefix + "cards/hk-stat.js"] == ROOT / "web/hk/cards/hk-stat.js"
    assert dests[prefix + "modules/hk-metric.js"] == ROOT / "web/cards/hk-metric.js"
    assert dests[prefix + "modules/hk-ha-client.js"] == ROOT / "hosts/ha/frontend/hk-ha-client.js"
    assert dests[prefix + "fonts/sf-pro.css"].is_file()
    assert all(Path(src).is_relative_to(ROOT) for src, _ in pairs)
    assert not any("mantel_server" in dest or "mantel_connect" in dest for dest in dests)
    assert not any(Path(dest).suffix.lower() in {".woff2", ".ttf", ".otf", ".key", ".db"} for dest in dests)
    assert not (ROOT / "hosts/ha/custom_components/hk_frontend/frontend").exists()


def test_build_refuses_existing_destination_without_replacing_files(tmp_path):
    marker = tmp_path / "keep.txt"
    marker.write_text("keep")
    with pytest.raises(FileExistsError):
        builder().build(tmp_path)
    assert marker.read_text() == "keep"


def test_shared_metric_has_no_raw_host_access_and_bootstraps_explicitly():
    source = (ROOT / "web/cards/hk-metric.js").read_text()
    assert "_hass" not in source and ".hass" not in source
    bootstrap = (ROOT / "hosts/ha/custom_components/hk_frontend/__init__.py").read_text()
    for filename in ("hk-client.js", "hk-ha-client.js", "hk-metric.js"):
        assert f'"/hk/modules/{filename}"' in bootstrap
