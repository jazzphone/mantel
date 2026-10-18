"""The HA artifact is assembled from Mantel only, with no live installation writes."""
import importlib.util
import json
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
    assert dests[prefix + "modules/hk-ha-shell.js"] == ROOT / "hosts/ha/frontend/hk-ha-shell.js"
    assert dests[prefix + "modules/hk-ha-elements.js"] == ROOT / "hosts/ha/frontend/hk-ha-elements.js"
    assert dests[prefix + "elements/hk-elements.js"] == ROOT / "web/hk/elements/hk-elements.js"
    assert dests[prefix + "modules/hk-host-shell.js"] == ROOT / "web/client/hk-host-shell.js"
    assert dests[prefix + "fonts/sf-pro.css"].is_file()
    assert all(Path(src).is_relative_to(ROOT) for src, _ in pairs)
    assert not any("mantel_server" in dest or "mantel_connect" in dest for dest in dests)
    assert not any(Path(dest).suffix.lower() in {".woff2", ".ttf", ".otf", ".key", ".db"} for dest in dests)
    assert not (ROOT / "hosts/ha/custom_components/hk_frontend/frontend").exists()
    for url, source in json.loads((ROOT / "web/shared-assets.json").read_text()).items():
        assert dests[prefix + url] == ROOT / "web" / source


def test_build_refuses_existing_destination_without_replacing_files(tmp_path):
    marker = tmp_path / "keep.txt"
    marker.write_text("keep")
    with pytest.raises(FileExistsError):
        builder().build(tmp_path)
    assert marker.read_text() == "keep"


def test_shared_metric_has_no_raw_host_access_and_bootstraps_explicitly():
    source = (ROOT / "web/cards/hk-metric.js").read_text()
    assert "_hass" not in source and ".hass" not in source
    for filename in ("hk-client.js", "hk-ha-client.js", "hk-metric.js"):
        assert f"modules/{filename}" in boot().CORE


def boot():
    spec = importlib.util.spec_from_file_location("hk_boot", ROOT / "hosts/ha/custom_components/hk_frontend/boot.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_ha_registers_one_ordered_boot_module():
    # HA imports extra modules in parallel and in no fixed order (boot.py): only the boot file.
    bootstrap = (ROOT / "hosts/ha/custom_components/hk_frontend/__init__.py").read_text()
    assert "add_extra_js_url(hass, boot.URL)" in bootstrap
    assert bootstrap.count("add_extra_js_url(hass,") == 1
    assert '"/hk/modules/hk-client.js"' not in bootstrap


def test_host_shell_bootstraps_before_every_module_that_uses_it():
    b = boot()
    seq = list(b.CORE) + list(b.AFTER)
    pos = {p.rsplit("/", 1)[-1]: i for i, p in enumerate(seq)}
    assert pos["hk-client.js"] < pos["hk-card-state.js"] < pos["hk-ha-client.js"]
    assert pos["hk-host-shell.js"] < pos["hk-ha-shell.js"] < pos["tesla-viewport.js"]
    # what needs the core is imported after it has run
    for late in ("hk-settings.js", "hk-loader.js", "hk-strategy.js", "hk-header.js", "hk-icons.js"):
        assert f"{late}" in [p.rsplit("/", 1)[-1] for p in b.AFTER]


def test_boot_core_files_are_plain_scripts_and_the_bundle_keeps_their_order():
    b = boot()
    pairs = builder().plan()
    by_dest = {dest: Path(src) for src, dest in pairs}
    texts = {}
    for path in b.CORE + b.AFTER:
        src = by_dest["custom_components/hk_frontend/frontend/" + path]
        texts[path] = src.read_text()
    for path in b.CORE:
        assert b.is_plain(texts[path]), f"{path} must stay a plain script to be joined into the boot file"
    text = b.bundle(lambda p: texts.get(p))
    marks = [text.index(f"/* ---- /hk/{p} ---- */") for p in b.CORE]
    assert marks == sorted(marks)
    assert "imported separately" not in text
    tail = text[text.rindex(";(function () {"):]
    assert all(f'"/hk/{p}"' in tail for p in b.AFTER)
    # a missing or module-syntax core file falls back to its own import, said aloud
    fallback = b.bundle(lambda p: None if p == "modules/hk-tap.js" else "export const x = 1;" if p == "modules/hk-metric.js" else "var a = 1;")
    assert "hk-tap.js missing; imported separately" in fallback and '"/hk/modules/hk-tap.js"' in fallback[fallback.rindex(";(function"):]
    assert "hk-metric.js not a plain script" in fallback



def test_view_host_is_published_but_not_loaded_in_ha():
    """Phase 2 P2.3: HK's view host ships with the frontend (P2.6's panel will load it), but HA's
    bootstrap does not load it: Lovelace still draws HK dashboards in HA."""
    dests = {dest: Path(src) for src, dest in builder().plan()}
    assert dests["custom_components/hk_frontend/frontend/shell/hk-view-host.js"] == ROOT / "web/hk/shell/hk-view-host.js"
    bootstrap = (ROOT / "hosts/ha/custom_components/hk_frontend/__init__.py").read_text()
    assert "hk-view-host" not in bootstrap
    shell = (ROOT / "hosts/ha/frontend/hk-ha-shell.js").read_text()
    assert "card: 'hui-card'" in shell          # containers keep Lovelace's wrapper in HA
