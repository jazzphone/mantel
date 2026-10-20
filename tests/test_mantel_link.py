"""Mantel Link (hosts/ha/custom_components/mantel, decision 28, docs/phase9/MANTEL-LINK.md): its whole
pytest suite on Home Assistant's test harness, run from Mantel's own suite so the full validation
covers it, with both neighbours present:

* ``MANTEL_ROOT`` (this checkout): the end-to-end tests against the real ``mantel_server/linked.py``;
* ``HK_FRONTEND_COMPONENT``: HK Frontend's Python staged the way ``tools/build_ha.py`` builds it
  (without its 3,000 frontend files, which these tests don't read), for the hand-over tests against the
  real HK Frontend.

The harness lives in its own venv (``~/.venvs/hk-ha-test``); skipped when that venv is absent."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from test_linked_e2e import HA_PYTEST, ROOT, stage

SUITE = ROOT / "hosts/ha/custom_components/mantel/tests/py"


@pytest.mark.skipif(not HA_PYTEST.exists(), reason="Home Assistant's test venv (~/.venvs/hk-ha-test) is not here")
def test_mantel_link_suite(tmp_path):
    stage(tmp_path / "ha")
    hk = tmp_path / "ha" / "custom_components" / "hk_frontend"
    env = {**os.environ, "MANTEL_ROOT": str(ROOT), "HK_FRONTEND_COMPONENT": str(hk)}
    env.pop("PYTHONPATH", None)
    run = subprocess.run([str(HA_PYTEST), "-q", "-p", "no:cacheprovider"], cwd=SUITE, env=env,
                         capture_output=True, text=True, timeout=900)
    tail = (run.stdout + run.stderr)[-6000:]
    assert run.returncode == 0, tail
    last = run.stdout.strip().splitlines()[-1]
    assert " passed" in last and "skipped" not in last and "error" not in last, tail


def test_mantel_link_s_public_repository_builds_clean(tmp_path):
    """tools/publish/publish.py (local only): the published layout, scanned for private data, nothing of Mantel's
    tests or tools inside what HACS installs, no HK Frontend name in its dependencies (hassfest knows core only)."""
    import importlib.util
    import json
    path = ROOT / "hosts/ha/custom_components/mantel/tools/publish/publish.py"
    spec = importlib.util.spec_from_file_location("ml_publish", path)
    pub = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pub)
    pairs = pub.plan()
    assert pub.hk_publisher().scan(pairs) == [], "nothing private"
    dests = {d for _s, d in pairs}
    assert {"README.md", "LICENSE", "hacs.json", "custom_components/mantel/manifest.json", "docs/Setup.md",
            "tests/py/conftest.py", "custom_components/mantel/frontend/mantel-link.js",
            "custom_components/mantel/brand/icon.png"} <= dests
    assert not [d for d in dests if d.startswith("custom_components/mantel/") and
                d.split("/")[2] in ("tests", "tools", "docs")]
    assert not [d for d in dests if d.startswith("tools/")], "the builder stays in Mantel"
    manifest = json.loads((ROOT / "hosts/ha/custom_components/mantel/manifest.json").read_text())
    assert manifest["domain"] == "mantel" and manifest["name"] == "Mantel Link"
    assert "hk_frontend" not in manifest.get("after_dependencies", []) + manifest.get("dependencies", [])


def test_hk_frontend_s_final_release_builds(tmp_path):
    """HK Frontend's final release (9.10), prepared, never published from here: the whole HK build with --final's
    changes: the retirement repair on, the pointer README, version 1.10.0, still scanned clean."""
    import importlib.util
    import json
    path = ROOT / "hosts/ha/custom_components/hk_frontend/tools/publish/publish.py"
    spec = importlib.util.spec_from_file_location("hk_publish_final", path)
    pub = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pub)
    pairs = [(s, d) for s, d in pub.plan() if not d.startswith("custom_components/hk_frontend/frontend/")]
    assert pub.scan(pairs) == []
    pub.build(str(tmp_path), pairs)
    pub.make_final(str(tmp_path))
    comp = tmp_path / "custom_components/hk_frontend"
    assert "\nRETIRED = True\n" in (comp / "retire.py").read_text()
    assert json.loads((comp / "manifest.json").read_text())["version"] == "1.10.0"
    readme = (tmp_path / "README.md").read_text()
    assert "HK Frontend is now Mantel" in readme and "Moving-from-HK-Frontend" in readme
    assert pub.scan([(str(tmp_path / "README.md"), "README.md")]) == []
