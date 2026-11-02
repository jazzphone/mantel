"""tools/ci.py, the local checks: which steps each tier runs, a skip is never a pass, a failure keeps its log, the
record names the commit, the hooks it installs, and a step whose inputs are unchanged since it passed is not run again.
The real steps are not run here (that is the runner's job)."""
from __future__ import annotations

import importlib.util
import json
import os
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
    assert {"page-swipe-check-chromium-1280x800", "page-swipe-check-webkit-1180x820"} <= set(full)
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


# ---- what each step reads, by content (2026-11-02)

def test_each_browser_check_and_hk_frontend_suite_names_what_it_reads():
    full = ci.select(ci.steps(), "full")
    keyed = {s.name for s in full if s.inputs}
    browser = {s.name for s in full if s.tier == "full"} - {"ha-build", "hk-frontend-py", "hk-frontend-js", "caddy-image"}
    assert browser and browser | {"hk-frontend-py", "hk-frontend-js"} == keyed
    # (what runs in seconds, builds what the others need, or reads everything: always)
    assert not keyed & {"build-tools", "main-suite", "private-words", "ha-build", "caddy-image", "check-links"}
    shows = next(s for s in full if s.name == "saver-shows-check-1of8")
    got = shows.inputs()
    assert {"web/", "hk_core/", "hosts/server/mantel_server/", "tools/headless/saver_shows_check.py",
            "tools/headless/saver_shows_check.cjs", "tools/headless/gallery.py", "tools/app_dev_server.py"} <= set(got)
    assert "tests/mantel_house_fakes.py" in got and not any(g.startswith("tests/test_") for g in got)
    assert set(ci.VERSION_FILES) <= set(got) and not set(ci.CHANGELOGS) & set(got)
    assert shows.needs == ("py", "playwright", "mac")
    assert "chrome" in next(s for s in full if s.name == "edit-mode-check-chromium-1280x800").needs
    assert "chrome" in next(s for s in full if s.name == "headless-client_smoke").needs
    assert "hosts/ha/" in next(s for s in full if s.name == "hk-frontend-js").inputs


def test_page_swipes_steps_are_the_checks_own_sizes():
    import ast
    tree = ast.parse((ROOT / "tools/headless/page_swipe_check.py").read_text())
    sizes = next(ast.literal_eval(n.value) for n in ast.walk(tree) if isinstance(n, ast.Assign)
                 and any(getattr(t, "id", "") == "ENGINE_SIZES" for t in n.targets))
    assert sizes == ci.PAGE_SWIPE


def test_imported_follows_a_checks_imports_and_its_other_half(tmp_path):
    files = {"tools/headless/a_check.py": "import json, b_help as b\nfrom c_fakes import X\n  import d  # lazy\n",
             "tools/headless/a_check.cjs": "// the browser half\n", "tools/headless/b_help.py": "import e_tool\n",
             "tools/e_tool.py": "", "tests/c_fakes.py": "", "tests/d.py": "", "tests/test_x.py": "",
             "tools/headless/other_check.py": "import b_help\n"}
    for name, text in files.items():
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_text(text)
    assert ci.imported(["tools/headless/a_check.py"], tmp_path) == [
        "tests/c_fakes.py", "tests/d.py", "tools/e_tool.py", "tools/headless/a_check.cjs", "tools/headless/a_check.py",
        "tools/headless/b_help.py"]


def test_matches_a_folder_a_glob_and_a_file():
    assert ci.matches("web/hk/x.js", "web/") and not ci.matches("webx/a", "web/")
    assert ci.matches("tests/a_fakes.py", "tests/*_fakes.py") and not ci.matches("tests/a.py", "tests/*_fakes.py")
    assert ci.matches("tools/ci.py", "tools/ci.py") and not ci.matches("tools/ci.pyc", "tools/ci.py")
    # (git's folder of new or ignored files: what it could hold)
    assert ci.matches("web/new/", "web/") and ci.matches("web/", "web/hk/") and ci.matches("tools/", "tools/ci.py")
    assert not ci.matches("docs/", "web/")


def keyed_repo(tmp_path):
    root = repo(tmp_path)
    (root / "web").mkdir()
    (root / "web/page.js").write_text("draw()\n")
    commit(root, "web")
    return root


def test_a_steps_key_is_what_it_reads_without_version_lines(tmp_path):
    root = keyed_repo(tmp_path)
    step = ci.Step("look", ["true"], inputs=("web/", "pyproject.toml"))
    key = lambda cmd=("true",): ci.step_key(step, ci.tree_blobs("HEAD", root), ci.uncommitted(root), list(cmd), root)  # noqa: E731
    k0 = key()
    assert k0 and key() == k0
    edit(root, "app.py", "1", "2")
    commit(root, "not an input")
    assert key() == k0
    edit(root, "pyproject.toml", '"0.1.1"', '"0.1.2"')
    edit(root, "CHANGELOG.md", "## Unreleased\n", "## Unreleased\n\n## 0.1.2\n")
    commit(root, "Release 0.1.2")
    assert key() == k0, "a release's version line is no change"
    assert key(["true", "--other"]) != k0, "nor is another command the same step"
    edit(root, "pyproject.toml", 'name = "x"', 'name = "y"')
    commit(root, "more than a version")
    k1 = key()
    assert k1 != k0
    (root / "web/page.js").write_text("draw(2)\n")
    assert key() is None, "an uncommitted input: no key, it runs"
    git(root, "checkout", "-q", "--", "web/page.js")
    (root / "web/new.js").write_text("")
    assert key() is None, "...a new file in an input too"
    (root / "web/new.js").unlink()
    (root / "web/__pycache__").mkdir()
    (root / "web/__pycache__/x.pyc").write_text("")
    (root / ".gitignore").write_text("__pycache__/\n*.ttf\n")
    commit(root, "ignore")
    assert key() == k1, "caches are not inputs"
    (root / "web/font.ttf").write_text("")
    assert key() is None, "...but an ignored file in an input is"
    (root / "web/font.ttf").unlink()
    assert ci.step_key(ci.Step("all", ["true"]), {}, [], ["true"], root) is None, "no inputs: no key, it always runs"


def test_a_step_unchanged_since_it_passed_is_not_run_again_and_counts_as_a_pass(tmp_path):
    root, rec, steps_store = keyed_repo(tmp_path), tmp_path / "rec", tmp_path / "steps.json"
    marks = tmp_path / "marks"
    code = tmp_path / "code"
    code.write_text("0")
    step = ci.Step("look", [sys.executable, "-c", f"import sys; open({str(marks)!r}, 'a').write('x'); "
                                                  f"sys.exit(int(open({str(code)!r}).read()))"],
                   inputs=("web/",), tier="full", timeout=30)
    always = ci.Step("always", [sys.executable, "-c", "pass"], tier="full")
    go = lambda **kw: ci.run([step, always], "full", record_dir=rec, echo=lambda _: None, step_store=steps_store,  # noqa: E731
                             root=root, **kw)
    first = go()
    assert first["ok"] and marks.read_text() == "x"
    second = go()
    by = {s["name"]: s for s in second["steps"]}
    assert marks.read_text() == "x", "not run again"
    assert by["look"]["status"] == "unchanged" and first["commit"][:9] in by["look"]["reason"]
    assert by["always"]["status"] == "passed" and second["ok"] is True
    assert "1 unchanged" in ci.table(second)
    assert ci.step_times(rec)["look"] == round(first["steps"][0]["seconds"], 1), "an unchanged step keeps its time"
    assert go(reuse=False)["ok"] and marks.read_text() == "xx", "--all runs it"
    edit(root, "app.py", "1", "2")
    commit(root, "not its input")
    assert go()["steps"][0]["status"] == "unchanged"
    (root / "web/page.js").write_text("draw(2)\n")
    commit(root, "its input")
    code.write_text("1")
    assert go()["steps"][0]["status"] == "failed" and marks.read_text() == "xxx"
    code.write_text("0")
    git(root, "reset", "-q", "--hard", "HEAD~1")
    # (back on the tree it passed on, but that key failed since: it is forgotten only for the failing key)
    assert go()["steps"][0]["status"] == "unchanged"
    git(root, "reset", "-q", "--hard", "HEAD@{1}")
    assert go()["steps"][0]["status"] == "passed" and marks.read_text() == "xxxx", "a failed key is not carried"


def test_a_run_that_moved_keeps_no_step_passes(tmp_path):
    store = tmp_path / "steps.json"
    rec = {"steady": False, "commit": "c", "finished": "f", "steps": [{"name": "look", "status": "passed"}]}
    assert not ci.remember_steps(rec, {"look": "k"}, store) and ci.step_passes(store) == {}
    assert ci.remember_steps({**rec, "steady": True}, {"look": "k"}, store)
    assert ci.carried_passes({"look": "k"}, store)["look"]["commit"] == "c"
    assert ci.carried_passes({"look": "other"}, store) == {}
    ci.remember_steps({**rec, "steady": True, "steps": [{"name": "look", "status": "failed"}]}, {"look": "k"}, store)
    assert ci.carried_passes({"look": "k"}, store) == {}


def test_a_mantel_step_runs_this_checkouts_code_first(monkeypatch):
    # (2026-11-02) the venv's editable install is the main checkout's: in a worktree the checks imported its hk_core
    monkeypatch.setenv("PYTHONPATH", "/elsewhere")
    env = ci.step_env(True)["PYTHONPATH"].split(os.pathsep)
    assert env == [str(ci.ROOT), str(ci.ROOT / "hosts/server"), "/elsewhere"]
    assert ci.step_env()["PYTHONPATH"] == "/elsewhere", "HK Frontend's harness keeps its own (the build's vendored hk_core)"


def test_a_step_never_timed_starts_among_the_longest(tmp_path):
    (tmp_path / "step-times.json").write_text(json.dumps({"short": 1, "long": 500}))
    seen = []
    steps = [ci.Step(n, [sys.executable, "-c", "pass"]) for n in ("short", "new", "long")]
    os.environ["CI_JOBS"] = "1"
    try:
        ci.run(steps, "full", record_dir=tmp_path, echo=lambda s: s.endswith(" ...") and seen.append(s.split()[0]))
    finally:
        del os.environ["CI_JOBS"]
    assert seen == ["new", "long", "short"] or seen == ["long", "new", "short"]


def test_a_fresh_worktree_orders_its_steps_by_every_worktrees_times(tmp_path):
    shared = tmp_path / "common/step-times.json"
    ci.run([fake("a")], "full", record_dir=tmp_path / "one", echo=lambda s: None, shared_times=shared)
    ci.run([fake("b")], "full", record_dir=tmp_path / "two", echo=lambda s: None, shared_times=shared)
    assert set(ci.read_times(shared)) == {"a", "b"}, "the second worktree knows the first one's step"
