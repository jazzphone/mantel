"""Phase 5 linked mode, end to end across both hosts: Home Assistant's test harness running the
hk_frontend integration linked to the real ``mantel_server/linked/__init__.py`` endpoint, in one process.

The HA harness lives in its own venv (``~/.venvs/hk-ha-test``, which has Home Assistant but not
Mantel's dependencies), so this stages the integration's Python, tests and translations the way
``tools/build_ha.py`` would (without the 3,000 frontend files, which these tests don't read) and runs
the HA side's ``test_linked_e2e.py``, ``test_linked_mode.py`` and ``test_linked_owners.py`` there
with ``MANTEL_ROOT`` pointing here. Skipped when that venv is absent."""
from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HA_PYTEST = Path.home() / ".venvs" / "hk-ha-test" / "bin" / "pytest"


def stage(out: Path) -> Path:
    spec = importlib.util.spec_from_file_location("build_ha", ROOT / "tools/build_ha.py")
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    for src, dest in builder.plan():
        if dest.startswith(("custom_components/hk_frontend/frontend/", "docs/", "tools/")):
            continue
        if not (dest.startswith("custom_components/") or dest.startswith("tests/py/")):
            continue
        target = out / dest
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, target)
    return out / "tests" / "py"


@pytest.mark.skipif(not HA_PYTEST.exists(), reason="Home Assistant's test venv (~/.venvs/hk-ha-test) is not here")
def test_home_assistant_linked_to_the_real_endpoint(tmp_path):
    tests = stage(tmp_path / "ha")
    env = {**os.environ, "MANTEL_ROOT": str(ROOT)}
    env.pop("PYTHONPATH", None)
    run = subprocess.run([str(HA_PYTEST), "-q", "-p", "no:cacheprovider", "test_linked_e2e.py",
                          "test_linked_mode.py", "test_linked_owners.py"],
                         cwd=tests, env=env, capture_output=True, text=True, timeout=900)
    tail = (run.stdout + run.stderr)[-6000:]
    assert run.returncode == 0, tail
    assert " passed" in run.stdout and "skipped" not in run.stdout.splitlines()[-1], tail
