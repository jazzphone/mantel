"""tools/ci.py, the local checks: which steps each tier runs, a skip is never a pass, a failure keeps its log, the
record names the commit, and the hooks it installs. The real steps are not run here (that is the runner's job)."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("ci", ROOT / "tools/ci.py")
ci = importlib.util.module_from_spec(spec)
sys.modules["ci"] = ci
spec.loader.exec_module(ci)


def fake(name, code=0, tier="quick", skip=None, out="done"):
    return ci.Step(name, [sys.executable, "-c", f"print({out!r}); raise SystemExit({code})"], tier=tier,
                   skip=skip or (lambda: None), timeout=30)


def test_quick_is_part_of_full_and_full_adds_the_rest():
    steps = ci.steps()
    quick = [s.name for s in ci.select(steps, "quick")]
    full = [s.name for s in ci.select(steps, "full")]
    assert quick == ["build-tools", "main-suite", "check-links", "check-version", "package-check", "private-words"]
    assert full[:len(quick)] == quick
    assert {"ha-build", "hk-frontend-py", "hk-frontend-js", "caddy-image"} <= set(full)
    assert [n for n in full if n.startswith("headless-")] == [f"headless-{n}" for n in ci.HEADLESS]
    assert full.index("ha-build") < full.index("hk-frontend-py") < full.index("hk-frontend-js")
    assert {"edit-mode-check-chromium-1180x820", "edit-mode-check-webkit-390x844"} <= set(full)
    assert "side-strip-check" in full and "side-strip-check" not in quick
    assert {"page-swipe-check-chromium", "page-swipe-check-webkit"} <= set(full)
    assert not any(n.startswith(("edit-mode", "page-swipe")) for n in quick)


def test_edit_mode_check_skips_saying_why_without_playwright(monkeypatch, tmp_path):
    step = next(s for s in ci.steps() if s.name == "edit-mode-check-webkit-1180x820")
    assert step.tier == "full" and "tools/headless/edit_mode_check.py" in step.cmd and step.cmd[-4:] == ["--engine", "webkit", "--size", "1180x820"]
    monkeypatch.delenv("PLAYWRIGHT_PATH", raising=False)
    monkeypatch.delenv("NODE", raising=False)
    assert "PLAYWRIGHT_PATH" in step.skip()
    monkeypatch.setenv("PLAYWRIGHT_PATH", str(tmp_path))
    assert "NODE" in step.skip()
    monkeypatch.setenv("NODE", sys.executable)              # any file that exists
    monkeypatch.setattr(ci, "chrome", lambda: None)
    assert "Chrome" in step.skip()
    monkeypatch.setattr(ci, "chrome", lambda: "/a/chrome")
    assert step.skip() is None


def test_only_narrows_and_brings_the_build_hk_frontend_needs():
    steps = ci.steps()
    assert [s.name for s in ci.select(steps, "full", ["js"])] == ["ha-build", "hk-frontend-js"]
    assert [s.name for s in ci.select(steps, "quick", ["check"])] == ["check-links", "check-version",
                                                                     "package-check"]
    assert ci.select(steps, "quick", ["headless"]) == []      # a full step is not in quick


def test_a_skip_says_why_and_is_never_a_pass_and_a_failure_keeps_its_log(tmp_path):
    steps = [fake("ok"), fake("broken", code=3, out="3 failed, 10 passed"),
             fake("needs-docker", skip=lambda: "Docker is not running")]
    seen = []
    record = ci.run(steps, "quick", record_dir=tmp_path, echo=seen.append)
    by = {s["name"]: s for s in record["steps"]}
    assert by["ok"]["status"] == "passed" and not (tmp_path / "ok.log").exists()
    assert by["broken"]["status"] == "failed" and "3 failed, 10 passed" in by["broken"]["reason"]
    assert (tmp_path / "broken.log").read_text().strip() == "3 failed, 10 passed"
    assert by["needs-docker"] == {"name": "needs-docker", "status": "skipped", "seconds": 0.0,
                                  "reason": "Docker is not running"}
    assert record["ok"] is False and len([x for x in seen if x.endswith(" ...")]) == 3   # (and each one done, said as it ends)
    assert "1 passed, 1 failed, 1 skipped" in ci.table(record)


def test_the_record_names_the_tier_and_commit(tmp_path):
    record = ci.run([fake("ok"), fake("skipped", skip=lambda: "no Chrome")], "full", record_dir=tmp_path,
                    echo=lambda s: None)
    saved = json.loads((tmp_path / "last-run.json").read_text())
    assert saved == record
    assert saved["tier"] == "full" and saved["ok"] is True
    assert len(saved["commit"]) == 40 and isinstance(saved["dirty"], list)
    assert all(not p.startswith(" ") and p for p in saved["dirty"])


def test_a_step_that_hangs_fails_with_a_timeout(tmp_path):
    step = ci.Step("hangs", [sys.executable, "-c", "import time; time.sleep(30)"], timeout=0.5)
    res = ci.run_step(step, tmp_path)
    assert res.status == "failed" and "timed out" in res.reason


def test_the_hooks_check_staged_words_and_run_quick_before_a_push(tmp_path):
    written = {p.name: p for p in ci.install_hooks(tmp_path)}
    assert set(written) == {"pre-commit", "pre-push"}
    assert all(p.stat().st_mode & 0o111 for p in written.values())
    assert "tools/check_private.py --staged" in written["pre-commit"].read_text()
    assert "tools/ci.py quick" in written["pre-push"].read_text()


@pytest.mark.parametrize("workflow", ["tests.yml", "release.yml"])
def test_github_runs_the_workflows_only_by_hand(workflow):
    yaml = pytest.importorskip("yaml")
    wf = yaml.safe_load((ROOT / ".github/workflows" / workflow).read_text())
    on = wf[True] if True in wf else wf["on"]
    assert set(on) == {"workflow_dispatch"}


def test_a_step_never_sees_gits_hook_environment(tmp_path, monkeypatch):
    # the pre-push hook runs with GIT_DIR and GIT_INDEX_FILE set; a step's own throwaway repository then hit the real
    # one (2026-10-30: the shared repository made bare, a worktree's index emptied)
    monkeypatch.setenv("GIT_DIR", "/nowhere/.git")
    monkeypatch.setenv("GIT_INDEX_FILE", "/nowhere/index")
    monkeypatch.setenv("KEEP_ME", "1")
    probe = "import os,sys; sys.exit(0 if 'GIT_DIR' not in os.environ and 'GIT_INDEX_FILE' not in os.environ and os.environ.get('KEEP_ME') == '1' else 1)"
    step = ci.Step("probe", [sys.executable, "-c", probe])
    assert ci.run_step(step, tmp_path).status == "passed"


def test_steps_run_side_by_side_but_the_first_ones_first_and_a_lane_in_order(tmp_path, monkeypatch):
    # (2026-10-30) the build first; the rest at once, CI_JOBS of them; a lane's steps one after another
    log = tmp_path / "order"
    def stamp(name, secs=0.4):
        return ci.Step(name, [sys.executable, "-c", f"import time,sys; open({str(log)!r},'a').write('{name}+\\n'); "
                                                    f"time.sleep({secs}); open({str(log)!r},'a').write('{name}-\\n')"], timeout=30)
    a, b, c = stamp("a"), stamp("b"), stamp("c")
    first = stamp("build", 0.1); first.first = True
    l1, l2 = stamp("lane1", 0.2), stamp("lane2", 0.2)
    l1.lane = l2.lane = "port"
    monkeypatch.setenv("CI_JOBS", "6")
    rec = ci.run([first, a, b, c, l1, l2], "full", record_dir=tmp_path / "rec", echo=lambda _: None)
    seq = log.read_text().split()
    assert rec["ok"] and [x["name"] for x in rec["steps"]] == ["build", "a", "b", "c", "lane1", "lane2"]
    assert seq[:2] == ["build+", "build-"], seq                   # before everything
    assert seq.index("lane1-") < seq.index("lane2+"), seq          # a lane in order
    # a, b and c side by side: each started before any of them ended (by the order of their marks, not the clock --
    # a loaded machine stretches the clock)
    ends = min(seq.index(n + "-") for n in "abc")
    assert all(seq.index(n + "+") < ends for n in "abc"), seq
