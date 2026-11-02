#!/usr/bin/env python3
"""Mantel's checks, run on this Mac instead of GitHub Actions (docs/development/Building-and-Testing.md, "Local
checks"). One runner, one table, one record:

    tools/ci.py quick            # the main suite and the release checks: what the pre-push hook runs (~1 min)
    tools/ci.py full             # also the HA build, HK Frontend's suites, the headless checks, Edit mode's
                                 # browser check (PLAYWRIGHT_PATH and NODE), the Caddy image
    tools/ci.py versions         # what reads the version files and changelogs (seconds): a release's re-check
    tools/ci.py full --only js   # only the steps whose name contains "js"
    tools/ci.py quick --skip-passed  # (the pre-push hook) a tree that already passed: only the commit messages
    tools/ci.py --list           # the steps of each tier
    tools/ci.py --install-hooks  # pre-commit: private words; pre-push: quick --skip-passed

Every step ends passed, failed or skipped, and a skip always says why: a skipped step is never counted as a pass.
The result goes to .ci/last-run.json (git ignores .ci/) with the commit it ran on, and a failed step's output to
.ci/<step>.log. The exit status is 0 only when no step failed.

A whole quick or full run that passed on a clean tree (nothing uncommitted but LOCAL_ONLY, HEAD the same from start
to end) is also kept in the passed runs (PASSED: in git's own folder, so every worktree of the repository shares
them), by the tree it checked. A tree's whole run that fails takes its passes away again.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import threading
import concurrent.futures
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]
RECORD_DIR = ROOT / ".ci"
HOME = Path.home()
PRIVATE_FILE = HOME / ".config/mantel/private-words"
HA_PY = HOME / ".venvs/hk-ha-test/bin/python"
JSC = Path("/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc")
MAC_CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
HEADLESS = ("client_smoke", "gateway_page_check", "admin_page_check", "settings_viewports", "ingress_smoke",
            "grid_blocks_check", "grid_music_turn_check")
CADDY_IMAGE = "mantel-caddy:ci"
# the screensaver's Shows in this many parts side by side, each its own server and WebKit (2026-11-01: one part took
# ~7 minutes of a full run's ~7 alone; the others end within ~4)
SAVER_SHARDS = 4
# Edit mode's sections that depend on the engine, the input or the size (edit_mode_check.py SECTIONS has the rest)
EDIT_GESTURES = ("bar", "room", "pages", "menu", "still", "frost")
LOCAL_ONLY = ("apple/Mantel.xcodeproj/project.pbxproj",)    # the signing team: changed here, never committed
# WHAT A RELEASE CHANGES (2026-11-01). A full run of one commit speaks for another when nothing else differs: only
# version lines in VERSION_FILES (bump_version.py's files, tools/check_version.py FILES, and the components'
# manifests release_house.py sets), and anything in CHANGELOGS. Then `versions` re-runs what reads them.
VERSION_FILES = ("packaging/ha-app/config.yaml", "packaging/connect-app/config.yaml", "pyproject.toml",
                 "hosts/ha/custom_components/hk_frontend/manifest.json", "hosts/ha/custom_components/mantel/manifest.json")
CHANGELOGS = ("CHANGELOG.md", "docs/development/House-releases.md",
              "hosts/ha/custom_components/hk_frontend/tools/publish/root/CHANGELOG.md",
              "hosts/ha/custom_components/mantel/tools/publish/root/CHANGELOG.md")
VERSION_LINE = re.compile(r'^\s*"?version"?\s*[:=]\s*"?[0-9A-Za-z.+-]*"?\s*,?\s*(#.*)?$')


def python() -> str:
    """Mantel's venv: $MANTEL_PY, else ~/.venvs/mantel, else .venv, else this interpreter."""
    for cand in (os.environ.get("MANTEL_PY"), HOME / ".venvs/mantel/bin/python", ROOT / ".venv/bin/python"):
        if cand and Path(cand).exists():
            return str(cand)
    return sys.executable


@dataclass
class Step:
    name: str
    cmd: list[str] | Callable[[], list[str]]
    tier: str = "quick"                      # quick steps run in both tiers; full steps only in full
    skip: Callable[[], str | None] = lambda: None   # a reason to skip, checked just before the step runs
    env: dict[str, str] = field(default_factory=dict)
    cwd: Path | Callable[[], Path] = ROOT
    timeout: float = 1800
    # HOW IT RUNS BESIDE THE OTHERS (2026-10-30: one at a time, full took 24 minutes on an 18-core Mac): `first`
    # steps run before everything, in order (the build tools, HK Frontend's build its suites run in); the rest run
    # side by side (CI_JOBS at once: three quarters of the cores, at most 14, unless set), except that steps sharing a `lane` run one after another in it
    # (the CDP checks share one fixed DevTools port)
    first: bool = False
    lane: str = ""
    # in `versions` too: it reads the version files or the changelogs (a release's re-check)
    versions: bool = False


@dataclass
class Result:
    name: str
    status: str                              # passed | failed | skipped
    seconds: float = 0.0
    reason: str = ""


_XDIST: dict[str, bool] = {}


def xdist_args(py: str) -> list[str]:
    """The main suite's workers: 8 where pytest-xdist is installed in `py` (asked once), none where it isn't."""
    if py not in _XDIST:
        _XDIST[py] = subprocess.run([py, "-c", "import xdist"], capture_output=True).returncode == 0
    return ["-n", os.environ.get("CI_PYTEST_WORKERS") or "8"] if _XDIST[py] else []


def private_env() -> dict[str, str]:
    if os.environ.get("HK_PRIVATE") or os.environ.get("HK_PRIVATE_FILE"):
        return {}
    return {"HK_PRIVATE_FILE": str(PRIVATE_FILE)} if PRIVATE_FILE.exists() else {}


def no_private_words() -> str | None:
    if os.environ.get("HK_PRIVATE") or os.environ.get("HK_PRIVATE_FILE") or PRIVATE_FILE.exists():
        return None
    return f"no private words: set HK_PRIVATE or HK_PRIVATE_FILE, or create {PRIVATE_FILE}"


def no_upstream() -> str | None:
    r = subprocess.run(["git", "rev-parse", "--verify", "-q", "origin/main"], cwd=ROOT, capture_output=True)
    return None if r.returncode == 0 else "no origin/main to compare the new commits with"


def chrome() -> str | None:
    if os.environ.get("CHROME"):
        return os.environ["CHROME"]
    if MAC_CHROME.exists():
        return str(MAC_CHROME)
    return next((p for n in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser")
                 if (p := shutil.which(n))), None)


def playwright_missing() -> str | None:
    """Why the Playwright checks (Edit mode's, in Chromium and WebKit) can't run here, or None."""
    pw, node = os.environ.get("PLAYWRIGHT_PATH"), os.environ.get("NODE")
    if not pw or not Path(pw).exists():
        return "set PLAYWRIGHT_PATH to an installed playwright-core (and NODE to a Node.js binary)"
    if not node or not Path(node).exists():
        return "set NODE to a Node.js binary (PLAYWRIGHT_PATH is set)"
    return None if chrome() else "no Chrome or Chromium (set CHROME)"


def docker_down() -> str | None:
    if not shutil.which("docker"):
        return "Docker is not installed"
    r = subprocess.run(["docker", "info"], capture_output=True)
    return None if r.returncode == 0 else "Docker is not running"


class Build:
    """The HA build (tools/build_ha.py) that HK Frontend's suites run in, made once per run."""

    def __init__(self):
        self.dir: Path | None = None
        self.ok = False

    @property
    def ha(self) -> Path:
        if self.dir is None:
            self.dir = Path(tempfile.mkdtemp(prefix="mantel-ci-"))
        return self.dir / "ha"

    def missing(self) -> str | None:
        return None if self.ok else "the HA build did not pass"

    def clean(self):
        if self.dir:
            shutil.rmtree(self.dir, ignore_errors=True)


def steps(build: Build | None = None) -> list[Step]:
    build = build or Build()
    py = python()
    out = [
        # esbuild, pinned (tools/package.json): the image and HK Frontend builds minify with it, and the suite
        # checks what it makes (2026-10-29); npm ci only when tools/node_modules is not what the lock pins, the old
        # folder set aside first: the SMB share sometimes can't delete it in place (tools/build_tools.py, 2026-10-31)
        Step("build-tools", [py, "tools/build_tools.py"], skip=lambda: None if shutil.which("npm") else "no npm (Node.js)",
             timeout=300, first=True),
        # (on 8 workers where pytest-xdist is installed: about a minute, not four)
        Step("main-suite", lambda: [py, "-m", "pytest", "-q", "-p", "no:cacheprovider", *xdist_args(py)], env=private_env()),
        Step("check-links", [py, "tools/check_links.py"], timeout=300, versions=True),
        Step("check-version", [py, "tools/check_version.py"], timeout=300, versions=True),
        Step("package-check", [py, "tools/package_check.py", "--release"], timeout=600, versions=True),
        # what is committed (what a push sends), and the messages of the commits origin/main hasn't got
        Step("private-words", lambda: [py, "tools/check_private.py", "--rev", "HEAD",
                                       *([] if no_upstream() else ["--messages", "origin/main..HEAD"])],
             skip=no_private_words, env=private_env(), timeout=300, versions=True),
        # (`versions` only: the main suite's files that read a version file or a changelog; quick and full run them all)
        Step("version-tests", lambda: [py, "-m", "pytest", "-q", "-p", "no:cacheprovider", *xdist_args(py), *version_readers()],
             tier="versions", versions=True, env=private_env()),
        Step("ha-build", lambda: [py, "tools/build_ha.py", str(build.ha)], tier="full", timeout=600, first=True),
        Step("hk-frontend-py", [str(HA_PY), "-m", "pytest", "-q", "-p", "no:cacheprovider"], tier="full",
             skip=lambda: build.missing() or (None if HA_PY.exists() else f"no harness venv at {HA_PY.parent.parent}"),
             cwd=lambda: build.ha / "tests/py"),
        Step("hk-frontend-js", lambda: ["sh", str(build.ha / "tests/run")], tier="full",
             skip=lambda: build.missing() or (None if JSC.exists() else "no JavaScriptCore (macOS only)")),
    ]
    out += [Step(f"headless-{n}", [py, f"tools/headless/{n}.py"], tier="full", timeout=600,
                 skip=lambda: None if chrome() else "no Chrome or Chromium (set CHROME)", lane="devtools")
            for n in HEADLESS]     # one at a time: each uses a fixed DevTools port
    # Edit mode in Chromium (a finger) and WebKit (a mouse), at a tablet's and a phone's size (Playwright's own
    # browsers, no fixed port); Chromium's tablet the wall tablets' 1280 x 800, WebKit's an 11" iPad's 1180 x 820
    # (each engine at each size a step of its own, so they run side by side: six minutes together)
    # (who sees Edit, Cancel and the server's changes are the same in every engine and size: once, in WebKit at a
    # tablet's, the owner's iPad; the gestures they use are the room's and the pages', checked in all four, 2026-11-01)
    out += [Step(f"edit-mode-check-{e}-{z}", [py, "tools/headless/edit_mode_check.py", "--engine", e, "--size", z,
                                              *([] if (e, z) == ("webkit", "1180x820") else
                                                [a for s in EDIT_GESTURES for a in ("--only", s)])], tier="full",
                 timeout=1200, skip=playwright_missing)
            for e, z in (("chromium", "1280x800"), ("chromium", "390x844"), ("webkit", "1180x820"), ("webkit", "390x844"))]
    # Edit mode on a Home Grid in WebKit, a finger and a mouse, at a tablet either way and a phone (2026-10-31)
    # (each size a step of its own)
    out += [Step(f"grid-edit-check-{z}", [py, "tools/headless/grid_edit_check.py", "--size", z], tier="full",
                 timeout=900, skip=playwright_missing) for z in ("1180x820", "820x1180", "390x844")]
    # the page beside the iPhone Duo's side strip, in WebKit (its insets stood in; 2026-10-30)
    out.append(Step("side-strip-check", [py, "tools/headless/side_strip_check.py"], tier="full", timeout=600,
                    skip=playwright_missing))
    # Swipe Between Pages in Chromium and WebKit, with a finger, at two tablet and two phone sizes (2026-10-30)
    # (each engine a step of its own)
    out += [Step(f"page-swipe-check-{e}", [py, "tools/headless/page_swipe_check.py", "--engine", e], tier="full", timeout=1800,
                 skip=playwright_missing) for e in ("chromium", "webkit")]
    # the screensaver's HomeView-style faces and Time Behind in WebKit, a tablet either way and a phone (2026-10-30)
    out.append(Step("saver-faces-check", [py, "tools/headless/saver_faces_check.py"], tier="full", timeout=600,
                    skip=playwright_missing))
    # the Screensaver editor in WebKit (phase 13): Looks that keep the Info, the four sections, a piece's page, the library
    out.append(Step("saver-editor-check", [py, "tools/headless/saver_editor_check.py"], tier="full", timeout=900,
                    skip=playwright_missing))
    # the Side Pane in WebKit: beside Home on each side, Every Page, the screensaver, each section alone (2026-10-30)
    # (each size a step of its own, 2026-11-01: together they were the full run's longest step, ~4 minutes)
    out += [Step(f"side-pane-check-{z}", [py, "tools/headless/side_pane_check.py", "--size", z], tier="full", timeout=900,
                 skip=playwright_missing) for z in ("1180x820", "820x1180", "390x844")]
    # the Looks in WebKit: each applied from its page, Home at three sizes, Undo; Layout + Look in the editor (2026-10-30)
    out.append(Step("looks-check", [py, "tools/headless/looks_check.py"], tier="full", timeout=900,
                    skip=playwright_missing))
    # the screensaver's Shows the way a house starts them: a screen's settings -> the strategy -> the screensaver
    # (in SAVER_SHARDS parts side by side, each every SAVER_SHARDS-th of its runs)
    out += [Step(f"saver-shows-check-{i}of{SAVER_SHARDS}", [py, "tools/headless/saver_shows_check.py", "--shard",
                                                           f"{i}/{SAVER_SHARDS}"], tier="full", timeout=900,
                 skip=playwright_missing) for i in range(1, SAVER_SHARDS + 1)]
    out.append(Step("caddy-image", ["sh", "-c",
                    f"docker build -q -f packaging/docker/caddy.Dockerfile -t {CADDY_IMAGE} packaging/docker && "
                    f'"{py}" -m pytest -q -p no:cacheprovider tests/test_packaging.py -k caddy_image'],
                    tier="full", skip=docker_down, env={"MANTEL_CADDY_TEST_IMAGE": CADDY_IMAGE}))
    return out


def in_tier(step: Step, tier: str) -> bool:
    if tier == "versions":
        return step.versions
    return step.tier == "quick" or step.tier == tier == "full"


def version_readers(root: Path = ROOT) -> list[str]:
    """The main suite's files that name a version file or a changelog (or the tools that read them)."""
    names = re.compile("|".join(re.escape(Path(p).name) for p in (*VERSION_FILES, *CHANGELOGS))
                       + "|check_version|bump_version")
    return [str(p.relative_to(root)) for p in sorted((root / "tests").glob("test_*.py")) if names.search(p.read_text())]


def select(all_steps: list[Step], tier: str, only: list[str] | None = None) -> list[Step]:
    chosen = [s for s in all_steps if in_tier(s, tier)]
    if only:
        chosen = [s for s in chosen if any(o in s.name for o in only)]
        build = [s for s in all_steps if s.name == "ha-build"]
        if build and build[0] not in chosen and any(s.name.startswith("hk-frontend") for s in chosen):
            chosen.insert(0, build[0])           # HK Frontend's suites run in the build
    return chosen


def run_step(step: Step, log_dir: Path) -> Result:
    reason = step.skip()
    if reason:
        return Result(step.name, "skipped", reason=reason)
    cmd = step.cmd() if callable(step.cmd) else step.cmd
    cwd = step.cwd() if callable(step.cwd) else step.cwd
    start = time.monotonic()
    try:
        r = subprocess.run(cmd, cwd=cwd, env={**step_env(), **step.env}, stdin=subprocess.DEVNULL,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=step.timeout)
        output, code = r.stdout.decode(errors="replace"), r.returncode
    except subprocess.TimeoutExpired as e:
        output, code = (e.stdout or b"").decode(errors="replace") + f"\n[timed out after {step.timeout:.0f}s]", -1
    except OSError as e:
        output, code = str(e), -1
    seconds = time.monotonic() - start
    log = log_dir / f"{step.name}.log"
    if code == 0:
        log.unlink(missing_ok=True)
        return Result(step.name, "passed", seconds)
    log.write_text(output)
    last = [ln for ln in output.strip().splitlines() if ln.strip()][-1:] or [f"exit {code}"]
    shown = log.relative_to(ROOT) if log.is_relative_to(ROOT) else log
    return Result(step.name, "failed", seconds, reason=f"{last[0].strip()[:160]} (log: {shown})")


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout.rstrip()


def git_state(root: Path = ROOT) -> tuple[str, str, list[str]]:
    """HEAD, its tree, and the files not committed (`git status`: changed, staged or untracked)."""
    out = lambda *a: subprocess.run(["git", *a], cwd=root, capture_output=True, text=True).stdout   # noqa: E731
    return (out("rev-parse", "HEAD").strip(), out("rev-parse", "HEAD^{tree}").strip(),
            [ln[3:] for ln in out("status", "--porcelain").splitlines()])     # (not stripped: " M" starts a line)


def say(text: str):
    print(text, flush=True)


def run(chosen: list[Step], tier: str, record_dir: Path = RECORD_DIR, echo: Callable[[str], None] = say,
        after: Callable[[Step, Result], None] | None = None, only: list[str] | None = None,
        store: Path | None = None) -> dict:
    """Run the steps and write the record; with `store`, a whole run (no `only`) is also remembered there."""
    record_dir.mkdir(exist_ok=True)
    started = datetime.datetime.now(datetime.timezone.utc)
    before = git_state()
    got: dict[str, Result] = {}
    lock = threading.Lock()

    def one(step: Step):
        with lock:
            echo(f"  {step.name} ...")
        res = run_step(step, record_dir)
        with lock:
            got[step.name] = res
            if after:
                after(step, res)
            if res.status != "skipped":
                echo(f"  {step.name} {res.status} ({res.seconds:.0f}s)")

    for step in [s for s in chosen if s.first]:
        one(step)
    # the rest side by side: each step a job, or a lane's steps one job in their order
    jobs: list[list[Step]] = []
    lanes: dict[str, list[Step]] = {}
    for step in [s for s in chosen if not s.first]:
        if step.lane:
            if step.lane not in lanes:
                lanes[step.lane] = []
                jobs.append(lanes[step.lane])
            lanes[step.lane].append(step)
        else:
            jobs.append([step])
    # (the longest first, by each step's last time, so a long one doesn't end the run alone: kept in step-times.json,
    # not last-run.json, which a quick, versions or --only run replaces -- 2026-11-01, a full run after them waited
    # 90 s on a long step started last)
    was = step_times(record_dir)
    jobs.sort(key=lambda job: -sum(was.get(s.name, 60) for s in job))
    # (13 at once on this 18-core Mac: the browser checks mostly wait, so the cores were two-thirds idle at 9 and
    # the run waited on width, not CPU -- 2026-11-01, 238 s at 9, 191 s at 14, every check steady and no slower)
    width = max(1, int(os.environ.get("CI_JOBS") or min(14, max(2, (os.cpu_count() or 4) * 3 // 4))))
    with concurrent.futures.ThreadPoolExecutor(max_workers=width) as pool:
        for f in [pool.submit(lambda job=job: [one(s) for s in job]) for job in jobs]:
            f.result()
    results = [got[s.name] for s in chosen]
    head, tree, dirty = git_state()
    record = {
        "tier": tier,
        "only": only or None,                # a part of the tier: never a whole run
        "commit": head,
        "tree": tree,
        "dirty": dirty,
        "steady": before == (head, tree, dirty),     # nothing committed or changed while it ran
        "started": started.isoformat(timespec="seconds"),
        "finished": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "ok": not any(r.status == "failed" for r in results),
        "steps": [vars(r) for r in results],
    }
    (record_dir / "last-run.json").write_text(json.dumps(record, indent=2) + "\n")
    times = {**was, **{r.name: round(r.seconds, 1) for r in results if r.status != "skipped"}}
    (record_dir / "step-times.json").write_text(json.dumps(times, indent=1, sort_keys=True) + "\n")
    if store:
        remember(record, store)
    return record


# ---------------------------------------------------------------- the passed runs, by tree (2026-11-01)
# A house release once took 30 minutes, half of them checking again what had passed: a second full run after a
# version bump, quick before each of three pushes. A tree that passed has passed: the pre-push hook doesn't run quick
# again on it, and a release takes a full run of a commit that differs from HEAD only in versions and changelogs.

def store_path() -> Path:
    common = Path(git("rev-parse", "--git-common-dir") or ".git")
    return (common if common.is_absolute() else ROOT / common) / "mantel-ci" / "passed.json"


def stored_runs(store: Path) -> list[dict]:
    try:
        runs = json.loads(store.read_text())["runs"]
        return [r for r in runs if isinstance(r, dict) and r.get("tree")] if isinstance(runs, list) else []
    except (OSError, ValueError, KeyError, TypeError):
        return []


def passed_runs(store: Path) -> list[dict]:
    return [r for r in stored_runs(store) if r.get("ok") is True]


def failed_tree(tree: str, store: Path) -> dict | None:
    return next((r for r in stored_runs(store) if r["tree"] == tree and r.get("ok") is not True), None)


def remember(record: dict, store: Path, keep: int = 200) -> bool:
    """A whole run (quick, full or versions) on a clean, steady tree: a pass is kept beside the tree's other passes;
    a failure takes them all away and stays until the tree passes again."""
    if record.get("only") or record.get("tier") not in ("quick", "full", "versions") or not record.get("steady") \
            or [p for p in record.get("dirty", []) if p not in LOCAL_ONLY] or not record.get("tree"):
        return False
    runs = [r for r in stored_runs(store) if r["tree"] != record["tree"] or (record["ok"] and r.get("ok") is True)]
    runs.append({"tree": record["tree"], "commit": record["commit"], "tier": record["tier"], "ok": bool(record["ok"]),
                 "finished": record["finished"], "steps": {s["name"]: s["status"] for s in record["steps"]}})
    store.parent.mkdir(parents=True, exist_ok=True)
    tmp = store.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps({"runs": runs[-keep:]}, indent=1) + "\n")
    tmp.replace(store)
    return True


def passed_tree(tree: str, store: Path, tiers: tuple[str, ...] = ("quick", "full")) -> dict | None:
    """The newest passed run of this tree in one of these tiers (quick's steps are all in full), or None."""
    return next((r for r in reversed(passed_runs(store)) if r["tree"] == tree and r.get("tier") in tiers), None)


def beyond_versions(base: str, head: str = "HEAD", root: Path = ROOT) -> str | None:
    """What changed from `base` to `head` besides version lines (VERSION_FILES) and changelogs (CHANGELOGS), said
    in a few words; None when nothing did, and a run of `base` speaks for `head` once `versions` passes there."""
    def out(*a: str) -> str:
        r = subprocess.run(["git", *a], cwd=root, capture_output=True, text=True)
        if r.returncode:
            raise ValueError(r.stderr.strip()[:200])
        return r.stdout
    try:
        names = out("diff", "--name-only", base, head, "--").splitlines()
        others = [n for n in names if n not in VERSION_FILES and n not in CHANGELOGS]
        if others:
            return f"{len(others)} other file{'s' * (len(others) > 1)} changed ({', '.join(others[:3])})"
        for name in [n for n in names if n in VERSION_FILES]:
            lines = [ln[1:] for ln in out("diff", "-U0", base, head, "--", name).splitlines()
                     if ln[:1] in "+-" and not ln.startswith(("+++", "---"))]
            if bad := [ln for ln in lines if not VERSION_LINE.match(ln)]:
                return f"{name} changed more than its version ({bad[0].strip()[:60]})"
    except ValueError as e:
        return f"cannot compare it with {base[:9]}: {e}"
    return None


def full_run_for(head: str, store: Path, root: Path = ROOT, look: int = 20) -> tuple[dict | None, str]:
    """The passed full run that speaks for the commit `head`: (run, "same") when it ran on `head` itself; (run,
    "versions") when it ran on a commit with `head`'s tree, or one that differs from it only in versions and
    changelogs (`versions` must then pass on head); (None, why not) when none does."""
    tree = subprocess.run(["git", "rev-parse", f"{head}^{{tree}}"], cwd=root, capture_output=True, text=True).stdout.strip()
    if failed := failed_tree(tree, store):
        return None, (f"the last whole {failed['tier']} run of HEAD's tree, on {failed['commit'][:9]}, failed: "
                      f"`tools/ci.py {failed['tier']}` must pass on it again")
    fulls = [r for r in reversed(passed_runs(store)) if r.get("tier") == "full"][:look]
    if not fulls:
        return None, "no passed full run: run `tools/ci.py full` first"
    for r in fulls:
        if r.get("commit") == head:
            return r, "same"
    newest = None
    for r in fulls:
        why = beyond_versions(r["commit"], head, root)
        if why is None:
            return r, "versions"
        newest = newest or why
    return None, f"the last passed full run was on {fulls[0]['commit'][:9]}, not HEAD {head[:9]}, and {newest}"


def step_times(record_dir: Path) -> dict[str, float]:
    """Each step's seconds the last time it ran (or, before step-times.json, the last run's)."""
    for name, read in (("step-times.json", lambda d: d), ("last-run.json", lambda d: {x["name"]: x["seconds"] for x in d["steps"]})):
        try:
            return {str(k): float(v) for k, v in read(json.loads((record_dir / name).read_text())).items()}
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            continue
    return {}


def table(record: dict) -> str:
    rows = [f"{'step':<34} {'result':<8} {'time':>7}  note"]
    for s in record["steps"]:
        rows.append(f"{s['name']:<34} {s['status']:<8} {s['seconds']:>6.0f}s  {s['reason']}")
    counts = {k: sum(s["status"] == k for s in record["steps"]) for k in ("passed", "failed", "skipped")}
    rows.append(f"{record['tier']}: {counts['passed']} passed, {counts['failed']} failed, "
                f"{counts['skipped']} skipped on {record['commit'][:9]}"
                + (f" ({len(record['dirty'])} uncommitted)" if record["dirty"] else ""))
    return "\n".join(rows)


PRE_COMMIT = """#!/bin/sh
# installed by tools/ci.py --install-hooks: no private words in what is committed
HK_PRIVATE_FILE="${{HK_PRIVATE_FILE:-$HOME/.config/mantel/private-words}}" exec "{py}" tools/check_private.py --staged
"""
PRE_PUSH = """#!/bin/sh
# installed by tools/ci.py --install-hooks: the quick checks before every push (git push --no-verify skips them);
# a tree that already passed only has its commit messages checked again. (A checkout whose ci.py predates
# --skip-passed runs quick whole: the hooks are every worktree's.)
if grep -q -- --skip-passed tools/ci.py; then exec "{py}" tools/ci.py quick --skip-passed </dev/null; fi
exec "{py}" tools/ci.py quick </dev/null
"""


# GIT'S HOOK ENVIRONMENT STAYS OUT OF THE STEPS (2026-10-30). A hook runs with GIT_DIR, GIT_INDEX_FILE and the like
# set to the repository it was called from; a step that makes a throwaway repository of its own (test_publish_release
# runs `git init --bare`, test_check_private stages files) then acted on the REAL one: the pre-push hook made the
# shared repository bare and emptied a worktree's index. Each step runs with them cleared.
GIT_HOOK_VARS = ("GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_PREFIX", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY",
                 "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_QUARANTINE_PATH", "GIT_NAMESPACE")


def step_env() -> dict:
    return {k: v for k, v in os.environ.items() if k not in GIT_HOOK_VARS}


def install_hooks(hooks: Path | None = None) -> list[Path]:
    hooks = hooks or Path(git("rev-parse", "--git-path", "hooks"))
    if not hooks.is_absolute():
        hooks = ROOT / hooks
    hooks.mkdir(parents=True, exist_ok=True)
    written = []
    for name, text in (("pre-commit", PRE_COMMIT), ("pre-push", PRE_PUSH)):
        path = hooks / name
        path.write_text(text.format(py=python()))
        path.chmod(0o755)
        written.append(path)
    return written


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("tier", nargs="?", choices=("quick", "full", "versions"), default="quick")
    ap.add_argument("--only", action="append", help="run only the steps whose name contains this (repeatable)")
    ap.add_argument("--list", action="store_true", help="list the steps of each tier")
    ap.add_argument("--skip-passed", action="store_true",
                    help="quick: when this clean tree already passed quick or full, check only the commit messages")
    ap.add_argument("--install-hooks", action="store_true", help="install the pre-commit and pre-push hooks")
    args = ap.parse_args(argv)
    if args.install_hooks:
        for path in install_hooks():
            print(f"installed {path}")
        return 0
    build = Build()
    all_steps = steps(build)
    if args.list:
        for s in all_steps:
            print(f"{s.tier:<8} {s.name}" + ("  (also in versions)" if s.versions and s.tier != "versions" else ""))
        return 0
    chosen = select(all_steps, args.tier, args.only)
    if not chosen:
        print(f"no step matches {args.only}", file=sys.stderr)
        return 2
    store, only = store_path(), args.only
    if args.skip_passed:
        if args.tier != "quick" or args.only:
            print("--skip-passed is for a whole quick run", file=sys.stderr)
            return 2
        _, tree, dirty = git_state()
        hit = None if [p for p in dirty if p not in LOCAL_ONLY] else passed_tree(tree, store)
        if hit:
            # (the messages origin/main hasn't got are not in the tree: they are checked whatever passed)
            chosen, only = [s for s in chosen if s.name == "private-words"], ["private-words"]
            print(f"This tree ({tree[:9]}) passed {hit['tier']} on {hit['commit'][:9]} at {hit['finished']}: "
                  "only the commit messages are checked again.")

    def after(step: Step, res: Result):
        if step.name == "ha-build":
            build.ok = res.status == "passed"

    print(f"Mantel checks, {args.tier}: {len(chosen)} steps")
    try:
        record = run(chosen, args.tier, after=after, only=only, store=store)
    finally:
        build.clean()
    print(table(record))
    return 0 if record["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
