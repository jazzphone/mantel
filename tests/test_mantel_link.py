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
