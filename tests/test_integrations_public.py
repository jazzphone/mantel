"""What HACS and hassfest need of the two public integration repositories, as their builders lay them out: the
manifest's keys, hacs.json, the brand/ images, the issue templates, a CHANGELOG.md for the releases' notes and the
README's badges. Mantel Link's builder offers what HK Frontend's does."""
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
COMPONENTS = ROOT / "hosts/ha/custom_components"
PRODUCTS = {
    "hk_frontend": {"repo": "jazzphone/hk-frontend", "name": "HK Frontend", "domain": "hk_frontend"},
    "mantel": {"repo": "jazzphone/mantel-link", "name": "Mantel Link", "domain": "mantel"},
}


def plan(folder: str) -> set[str]:
    path = COMPONENTS / folder / "tools/publish/publish.py"
    spec = importlib.util.spec_from_file_location(f"public_{folder}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return {dest for _src, dest in module.plan()}


@pytest.mark.parametrize("folder", PRODUCTS)
def test_the_manifest_has_what_hacs_and_hassfest_ask(folder):
    p = PRODUCTS[folder]
    m = json.loads((COMPONENTS / folder / "manifest.json").read_text())
    assert m["domain"] == p["domain"] and m["name"] == p["name"]
    assert m["codeowners"] and all(c.startswith("@") for c in m["codeowners"])
    assert m["documentation"].startswith(f"https://github.com/{p['repo']}")
    assert m["issue_tracker"] == f"https://github.com/{p['repo']}/issues"
    assert re.fullmatch(r"\d+\.\d+\.\d+", m["version"]), "a custom integration's version, X.Y.Z"
    assert m["config_flow"] is True and m["iot_class"] and m["integration_type"]
    assert list(m)[:2] == ["domain", "name"] and list(m)[2:] == sorted(list(m)[2:]), "hassfest's key order"


@pytest.mark.parametrize("folder", PRODUCTS)
def test_hacs_json_names_the_integration_and_the_oldest_home_assistant(folder):
    p = PRODUCTS[folder]
    hacs = json.loads((COMPONENTS / folder / "tools/publish/root/hacs.json").read_text())
    assert hacs["name"] == p["name"] and re.fullmatch(r"\d{4}\.\d+\.\d+", hacs["homeassistant"])
    assert set(hacs) <= {"name", "homeassistant", "render_readme", "hide_default_branch", "country", "hacs"}
    badge = hacs["homeassistant"].rsplit(".", 1)[0]                        # 2026.9.0 -> 2026.9
    readme = (COMPONENTS / folder / "README.md").read_text()
    assert f"Home Assistant {badge} or newer" in readme and f"{badge}%2B" in readme


@pytest.mark.parametrize("folder", PRODUCTS)
def test_the_repository_lays_out_its_brand_templates_and_changelog(folder):
    dests = plan(folder)
    domain = PRODUCTS[folder]["domain"]
    for name in ("icon", "icon@2x", "logo", "logo@2x", "dark_logo", "dark_logo@2x"):
        assert f"custom_components/{domain}/brand/{name}.png" in dests, name
    assert {"README.md", "LICENSE", "hacs.json", "CHANGELOG.md", ".gitignore",
            ".github/ISSUE_TEMPLATE/bug_report.md", ".github/ISSUE_TEMPLATE/feature_request.md",
            ".github/workflows/tests.yml", ".github/workflows/validate.yml"} <= dests
    assert not [d for d in dests if d.startswith("tools/publish/root")], "the root files are laid at the root"


@pytest.mark.parametrize("folder", PRODUCTS)
def test_the_readme_has_the_badges(folder):
    p = PRODUCTS[folder]
    readme = (COMPONENTS / folder / "README.md").read_text()
    head = readme[:readme.index("\n\n", readme.index("<img"))]
    assert f"github.com/{p['repo']}/releases/latest" in head and f"img.shields.io/github/license/{p['repo']}" in head
    assert "HACS-custom" in head and "Home%20Assistant-" in head
