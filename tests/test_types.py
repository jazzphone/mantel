"""Phase 18, Part C: the type-checking ratchets (tools/typecheck/).

* The set of web files that start with ``// @ts-check`` only grows (tests/fixtures/ts_check.json ``checked``); a file
  that opts in is listed there in the same commit.
* A new authored ``.js`` file under web/ or hosts/ha/frontend/ starts with ``// @ts-check``: the files that were there before
  are the recorded exceptions (``unchecked_allowed``), and that list only shrinks.
"""
from __future__ import annotations

import importlib.util
import json
import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests/fixtures/ts_check.json"


def _check():
    spec = importlib.util.spec_from_file_location("typecheck_check", ROOT / "tools/typecheck/check.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_the_ts_check_files_only_grow_and_new_files_opt_in():
    tc = _check()
    fixture = json.loads(FIXTURE.read_text())
    checked, every = set(tc.checked_files()), set(tc.all_files())
    dropped = sorted(set(fixture["checked"]) - checked)
    assert not dropped, f"files that stopped starting with // @ts-check: {dropped}"
    new_unchecked = sorted(every - checked - set(fixture["unchecked_allowed"]))
    assert not new_unchecked, f"a new web file starts with // @ts-check: {new_unchecked}"
    unlisted = sorted(checked - set(fixture["checked"]))
    assert not unlisted, f"opted in: add to tests/fixtures/ts_check.json's checked (and take off unchecked_allowed): {unlisted}"
    stale = sorted(set(fixture["unchecked_allowed"]) & checked)
    assert not stale, f"now checked: take off unchecked_allowed: {stale}"


def test_the_baseline_counts_every_web_file():
    tc = _check()
    base = json.loads((ROOT / "tools/typecheck/baseline.json").read_text())
    assert base["total"] == sum(base["files"].values())
    assert set(tc.all_files()) - set(base["files"]) <= set(tc.checked_files()), "new files are measured when added"


def test_vendor_bundles_have_pinned_contents_and_licenses():
    tc = _check()
    files = tc.vendored_files()  # verifies every bundle and license checksum
    assert files == {str(p.relative_to(ROOT)) for p in (ROOT / 'web/hk/vendor').glob('*.js')}
    assert not files & set(tc.all_files())


@pytest.mark.parametrize('changed', ['d3-geo.js', 'LICENSE-d3-geo.txt'])
def test_vendor_changes_fail_before_exclusion(tmp_path, changed):
    tc = _check()
    target = tmp_path / 'web/hk/vendor'
    shutil.copytree(ROOT / 'web/hk/vendor', target)
    tc.ROOT = tmp_path
    assert tc.vendored_files()
    path = target / changed
    path.write_text(path.read_text() + '\nchanged\n')
    with pytest.raises(ValueError, match='vendor checksum or license differs'):
        tc.vendored_files()
