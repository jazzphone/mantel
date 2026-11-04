"""tools/ci.py, the local checks: which steps each tier runs, a skip is never a pass, a failure keeps its log, the
record names the commit, and the hooks it installs. The real steps are not run here (that is the runner's job)."""
from __future__ import annotations

import importlib.util
import json
import subprocess
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
    assert {"edit-mode-check-chromium-1280x800", "edit-mode-check-webkit-1180x820"} <= set(full)
    assert "side-strip-check" in full and "side-strip-check" not in quick
    assert {"page-swipe-check-chromium", "page-swipe-check-webkit"} <= set(full)
    assert {"swipe-motion-check-chromium", "swipe-motion-check-webkit"} <= set(full)
    assert not any(n.startswith(("edit-mode", "page-swipe")) for n in quick)
    # `versions`, a release's re-check, never in quick or full itself; it knows bump_version's files
    assert [s.name for s in ci.select(steps, "versions")][-1] == "version-tests" and "version-tests" not in full
    spec = importlib.util.spec_from_file_location("cv", ROOT / "tools/check_version.py")
    cv = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cv)
    assert set(cv.FILES) <= set(ci.VERSION_FILES)


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
    assert "tools/ci.py quick --skip-passed" in written["pre-push"].read_text()


# ---- the passed runs, by tree (2026-11-01)

def record(tree="t1", ok=True, tier="full", **over):
    return {"tier": tier, "only": None, "commit": "c-" + tree, "tree": tree, "dirty": [], "steady": True, "ok": ok,
            "finished": "2026-11-01T12:00:00+00:00", "steps": [{"name": "main-suite", "status": "passed" if ok else "failed"}],
            **over}


def test_a_whole_clean_run_is_remembered_and_a_failure_takes_its_trees_passes_away(tmp_path):
    store = tmp_path / "passed.json"
    for bad in ({"only": ["js"]}, {"steady": False}, {"dirty": ["web/hk/x.js"]}):
        assert not ci.remember(record(**bad), store), bad
    ci.remember(record("t1", dirty=list(ci.LOCAL_ONLY)), store)          # the never-committed local file
    ci.remember(record("t1", tier="quick"), store)
    ci.remember(record("t2"), store)
    assert {r["tier"] for r in ci.passed_runs(store) if r["tree"] == "t1"} == {"full", "quick"}
    ci.remember(record("t1", ok=False, tier="quick"), store)
    assert ci.passed_tree("t1", store) is None and ci.failed_tree("t1", store) and ci.passed_tree("t2", store)
    ci.remember(record("t1", tier="quick"), store)
    assert ci.failed_tree("t1", store) is None and ci.passed_tree("t1", store)["tier"] == "quick"
    ci.remember(record("t3", tier="versions"), store)
    assert ci.passed_tree("t3", store) is None, "a `versions` pass never stands for quick"


def test_the_hook_checks_only_the_messages_of_a_tree_that_passed(tmp_path, monkeypatch):
    store = tmp_path / "passed.json"
    monkeypatch.setattr(ci, "store_path", lambda: store)
    monkeypatch.setattr(ci, "git_state", lambda root=ci.ROOT: ("c-t1", "t1", list(ci.LOCAL_ONLY)))
    ran = []
    monkeypatch.setattr(ci, "run", lambda chosen, tier, **kw: ran.append(([s.name for s in chosen], kw["only"])) or
                        {"ok": True, "tier": tier, "commit": "c-t1", "dirty": [], "steps": []})
    monkeypatch.setattr(ci, "table", lambda record: "")
    assert ci.main(["quick", "--skip-passed"]) == 0
    assert ran[-1][0] == [s.name for s in ci.select(ci.steps(), "quick")] and ran[-1][1] is None   # nothing passed yet
    ci.remember(record("t1", tier="full"), store)
    assert ci.main(["quick", "--skip-passed"]) == 0
    assert ran[-1] == (["private-words"], ["private-words"])
    assert ci.main(["quick"]) == 0 and len(ran[-1][0]) > 1, "without the flag, quick is whole"
    monkeypatch.setattr(ci, "git_state", lambda root=ci.ROOT: ("c-t1", "t1", ["web/hk/x.js"]))
    assert ci.main(["quick", "--skip-passed"]) == 0 and len(ran[-1][0]) > 1, "uncommitted work is checked whole"
    assert ci.main(["full", "--skip-passed"]) == 2


def repo(tmp_path) -> Path:
    """A throwaway repository with a version file, a manifest, a changelog and some code."""
    root = tmp_path / "repo"
    files = {"pyproject.toml": '[project]\nname = "x"\nversion = "0.1.1"\n',
             "packaging/ha-app/config.yaml": 'name: X\nversion: "0.1.1"\nslug: x\n',
             "hosts/ha/custom_components/hk_frontend/manifest.json": '{\n  "domain": "hk",\n  "version": "1.0.0"\n}\n',
             "CHANGELOG.md": "# Changelog\n\n## Unreleased\n", "app.py": "X = 1\n"}
    for name, text in files.items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(text)
    git(root, "init", "-q", "-b", "main")
    commit(root, "base")
    return root


def git(root, *args):
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args], cwd=root,
                          capture_output=True, text=True, check=True).stdout.strip()


def commit(root, message):
    git(root, "add", "-A")
    git(root, "commit", "-q", "--allow-empty", "-m", message)
    return git(root, "rev-parse", "HEAD")


def edit(root, name, old, new):
    path = root / name
    path.write_text(path.read_text().replace(old, new))


def test_the_full_run_that_speaks_for_a_commit(tmp_path):
    root, store = repo(tmp_path), tmp_path / "passed.json"
    base = git(root, "rev-parse", "HEAD")
    tree = lambda c: git(root, "rev-parse", f"{c}^{{tree}}")                     # noqa: E731
    assert ci.full_run_for(base, store, root)[0] is None
    ci.remember(record(tree(base), commit=base), store)
    assert ci.full_run_for(base, store, root)[1] == "same"
    # version lines and changelogs: the run speaks for it once `versions` passes
    edit(root, "pyproject.toml", '"0.1.1"', '"0.1.2"')
    edit(root, "hosts/ha/custom_components/hk_frontend/manifest.json", '"1.0.0"', '"1.1.0"')
    edit(root, "CHANGELOG.md", "## Unreleased\n", "## Unreleased\n\n## 0.1.2 - 2026-11-01\n\n- notes\n")
    bumped = commit(root, "Release 0.1.2")
    found, how = ci.full_run_for(bumped, store, root)
    assert how == "versions" and found["commit"] == base
    # more than a version line, or any other file: it doesn't
    edit(root, "hosts/ha/custom_components/hk_frontend/manifest.json", '"domain": "hk"', '"domain": "other"')
    assert "manifest.json changed more than its version" in ci.full_run_for(commit(root, "a key"), store, root)[1]
    git(root, "reset", "-q", "--hard", bumped)
    edit(root, "app.py", "1", "2")
    assert "1 other file changed (app.py)" in ci.full_run_for(commit(root, "code"), store, root)[1]
    # a failed whole run of HEAD's own tree outweighs the older pass
    ci.remember(record(tree(bumped), ok=False, tier="versions", commit=bumped), store)
    assert "must pass on it again" in ci.full_run_for(bumped, store, root)[1]


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


def test_each_steps_time_outlasts_a_smaller_run(tmp_path):
    # the longest first needs each step's time; a quick, versions or --only run once replaced them all (2026-11-01)
    ci.run([fake("long"), fake("short")], "full", record_dir=tmp_path, echo=lambda s: None)
    ci.run([fake("short")], "quick", record_dir=tmp_path, echo=lambda s: None)
    assert set(ci.step_times(tmp_path)) == {"long", "short"}
