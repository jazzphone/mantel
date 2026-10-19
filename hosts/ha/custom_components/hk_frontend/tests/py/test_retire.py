"""HK Frontend's retirement (retire.py; Mantel's docs/phase9/MANTEL-LINK.md): every release but the final one raises
nothing; the final one raises one repair, "HK Frontend is now Mantel", with the move guide, and keeps working. The
final build (tools/publish/publish.py --final) turns it on, puts the pointer README in, and sets its version."""
from __future__ import annotations

import importlib.util
import json
import os
import shutil

import pytest

from homeassistant.helpers import issue_registry as ir

from conftest import COMPONENT

PUBLISH = os.path.join(COMPONENT, "tools", "publish", "publish.py")


async def test_no_repair_before_the_final_release(hass, frontend):
    assert ir.async_get(hass).async_get_issue("hk_frontend", "now_mantel") is None


async def test_the_final_release_says_hk_frontend_is_now_mantel(hass, base, monkeypatch):
    from custom_components.hk_frontend import retire
    monkeypatch.setattr(retire, "RETIRED", True)
    from homeassistant.setup import async_setup_component
    assert await async_setup_component(hass, "hk_frontend", {})
    issue = ir.async_get(hass).async_get_issue("hk_frontend", "now_mantel")
    assert issue is not None and issue.severity == ir.IssueSeverity.WARNING and not issue.is_fixable
    assert issue.learn_more_url == retire.MOVE_GUIDE and "Moving-from-HK-Frontend" in retire.MOVE_GUIDE
    words = json.load(open(os.path.join(COMPONENT, "translations", "en.json")))["issues"]["now_mantel"]
    assert words["title"] == "HK Frontend is now Mantel" and "{guide}" in words["description"]


@pytest.mark.skipif(not os.path.isfile(os.path.join(COMPONENT, "tools", "publish", "final", "README.md")),
                    reason="the final release is built from the Mantel repository")
def test_the_final_build(tmp_path):
    spec = importlib.util.spec_from_file_location("hk_publish", PUBLISH)
    pub = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pub)
    comp = tmp_path / "custom_components" / "hk_frontend"
    comp.mkdir(parents=True)
    for f in ("retire.py", "manifest.json"):
        shutil.copy2(os.path.join(COMPONENT, f), comp / f)
    (tmp_path / "README.md").write_text("HK Frontend")
    pub.make_final(str(tmp_path))
    assert "\nRETIRED = True\n" in (comp / "retire.py").read_text()
    assert json.loads((comp / "manifest.json").read_text())["version"] == pub.FINAL_VERSION
    assert (tmp_path / "README.md").read_text().startswith("<h1 align=\"center\">HK Frontend is now Mantel</h1>")
