"""Ready manifests (phase 25, Part E): tools/split_manifests/ready/<name>.json is a manifest for a file that is near the size limit
and not split yet. Nothing that globs tools/split_manifests/*.json (the tests, ci.py, split_race_check) may see one, the tool finds
it by name, proves it against the unsplit file (`--check`, nothing written), and `--all` never splits one."""
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
READY = sorted((ROOT / "tools/split_manifests/ready").glob("*.json"))
SPLIT = sorted((ROOT / "tools/split_manifests").glob("*.json"))


def _tool():
    spec = importlib.util.spec_from_file_location("split_js_ready", ROOT / "tools/split_js.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["split_js_ready"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_there_are_ready_manifests():
    assert READY, "tools/split_manifests/ready/ holds the manifests of the files near the limit"


@pytest.mark.parametrize("path", READY, ids=[p.stem for p in READY])
def test_a_ready_manifest_names_a_file_that_is_not_split_yet(path):
    man = json.loads(path.read_text())
    tool = _tool()
    shell = ROOT / man["shell"]
    assert shell.is_file()
    assert not tool.is_split(shell.read_text()), "split: the manifest belongs in tools/split_manifests/ (split_js.py moves it)"
    assert "source" not in man                      # (recorded by the split itself)
    assert not (ROOT / man["folder"]).exists()
    assert not man["folder"].startswith("web/hk/cards")      # (both hosts load every file of that folder as a card)
    assert 3 <= len(man["parts"]) <= 6
    assert not man.get("bind_ahead")                # (retired in phase 25)
    split = [json.loads(p.read_text()) for p in SPLIT]
    for key in ("shell", "folder", "global", "label"):
        assert man[key] not in {m[key] for m in split}, key
    others = [json.loads(p.read_text()) for p in READY if p != path]
    for key in ("shell", "folder", "global", "label"):
        assert man[key] not in {m[key] for m in others}, key
    names = [p["name"] for p in man["parts"]]
    assert len(names) == len(set(names))
    named = [m for p in man["parts"] for m in p["members"]]
    assert len(named) == len(set(named))


@pytest.mark.parametrize("path", READY, ids=[p.stem for p in READY])
def test_the_tool_finds_a_ready_manifest_by_name_and_a_split_one_is_not_confused_with_it(path):
    tool = _tool()
    man, found = tool.load_manifest(path.stem)
    assert found == path and man["name"] == path.stem
    assert path.stem not in {p.stem for p in SPLIT}


@pytest.mark.parametrize("path", READY, ids=[p.stem for p in READY])
def test_a_ready_manifest_is_proven_against_the_unsplit_file(path):
    """`split_js.py <name> --check`: every moved member's text the same, nothing else new, tsc finds no missing name,
    nothing written."""
    if shutil.which("node") is None or not (ROOT / "tools/typecheck/node_modules/typescript/package.json").is_file():
        pytest.skip("node or TypeScript (tools/typecheck) not installed")
    before = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, cwd=ROOT).stdout
    run = subprocess.run([sys.executable, str(ROOT / "tools/split_js.py"), path.stem, "--check"],
                         capture_output=True, text=True, timeout=300)
    assert run.returncode == 0, run.stdout + run.stderr
    assert "proven" in run.stdout and "nothing written" in run.stdout
    assert subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, cwd=ROOT).stdout == before


def test_all_never_splits_a_ready_file(monkeypatch):
    """`--all` (no --check) splits what is not split: a ready manifest is only ever checked."""
    tool = _tool()
    calls = []
    monkeypatch.setattr(tool, "do_split", lambda man, p, check_only: calls.append((man["name"], check_only)) or 0)
    assert tool.main(["--all"]) == 0
    ready = {p.stem for p in READY}
    assert {n for n, _ in calls if n in ready} == ready
    assert all(check for n, check in calls if n in ready)
