#!/usr/bin/env python3
"""Mantel's checks, run on this Mac instead of GitHub Actions (docs/development/Building-and-Testing.md, "Local
checks"). One runner, one table, one record:

    tools/ci.py quick            # the main suite and the release checks: what the pre-push hook runs (~1 min)
    tools/ci.py full             # also the HA build, HK Frontend's suites, the headless checks, Edit mode's
                                 # browser check (PLAYWRIGHT_PATH and NODE), the Caddy image -- each browser check
                                 # and HK Frontend suite only when what it reads changed since it passed
    tools/ci.py full --all       # every step, whatever passed before
    tools/ci.py versions         # what reads the version files and changelogs (seconds): a release's re-check
    tools/ci.py full --only js   # only the steps whose name contains "js"
    tools/ci.py full --release   # a release's run: also the motion checks, unless they passed in a release run as they are
    tools/ci.py full --only swipe-motion  # only the motion checks (swipe-motion, pre-glass-motion)
    tools/ci.py quick --skip-passed  # (the pre-push hook) a tree that already passed: only the commit messages
    tools/ci.py --list           # the steps of each tier
    tools/ci.py --install-hooks  # pre-commit: private words; pre-push: quick --skip-passed

Every step ends passed, failed or skipped, and a skip always says why: a skipped step is never counted as a pass.
The result goes to .ci/last-run.json (git ignores .ci/) with the commit it ran on, and a failed step's output to
.ci/<step>.log. The exit status is 0 only when no step failed.

A whole quick or full run that passed on a clean tree (nothing uncommitted but LOCAL_ONLY, HEAD the same from start
to end) is also kept in the passed runs (PASSED: in git's own folder, so every worktree of the repository shares
them), by the tree it checked. A tree's whole run that fails takes its passes away again.

A full step that names its inputs (the browser checks, HK Frontend's suites) is "unchanged" when what it reads is as it
was in a run where it passed: the same files in HEAD's tree, the same command, the same venv, Playwright, Node, Chrome
and macOS. An unchanged step is not run again; it counts as a pass, and the table says from which commit. Its inputs
uncommitted, --all or --only: it runs. (The passed steps, by key: steps.json beside the passed runs.)
"""
from __future__ import annotations

import argparse
import datetime
import fcntl
import fnmatch
import hashlib
import importlib.util
import json
import os
import platform
import plistlib
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
            "grid_blocks_check", "grid_music_turn_check", "timer_roller_check", "stereo_pair_check")
CADDY_IMAGE = "mantel-caddy:ci"
# the screensaver's Shows in parts side by side, each its own server and WebKit (2026-11-01: one part took ~7 minutes
# of a full run's ~7 alone; the others end within ~4. 2026-11-02: every Look under every slide made each of four parts
# ~510 s, the full run's last five minutes alone). This many until a run has timed them; then next_parts' count.
# (2026-11-08: a third of every full run's step time at three and four sizes; the release run checks each at one size)
SAVER_SHARDS = 4
# HOW LONG A STEP MAY TAKE (2026-11-02: the Shows' check grew from ~150 s to ~2000 s in one commit and nothing said so).
# A check in parts is cut again so its longest part stays near PART_TARGET (next_parts), between MIN_PARTS and
# MAX_PARTS; any step past STEP_BUDGET, or much slower than its own last runs, is named under the table (timing_warnings).
PART_TARGET = 150
MIN_PARTS, MAX_PARTS = 2, 12
STEP_BUDGET = 240
HISTORY = 10                                   # each step's last passed times kept (timing.json)
# Swipe Between Pages: each engine's sizes (page_swipe_check.py ENGINE_SIZES), each a step of its own (2026-11-02: an
# engine's four were ~140 s together)
# how a swipe moves (swipe_motion_check.py): a tablet and a phone per engine, each a step (one engine was 264 s)
SWIPE_MOTION = {"chromium": ("1280x800", "390x844"), "webkit": ("1180x820", "390x844")}
# THE MOTION CHECKS (phase 25, E2; decision 5: "every release's full run, and once on main after a change to the pager or
# the swipe"). They read the pager, the swipe and the glass under it, not the whole page: a full run runs them again only
# when one of these changed since they passed, and `full --release` runs them unless they passed in a release run as they
# are (release_house.py takes only a full run in which they ran, or were carried from a release run). They run after the
# rest, one lane per engine, the two lanes side by side: 20 of the 33 failed full runs from 2026-11-05 to 11-08 were these
# four on timing noise beside a dozen browsers. A failure is tried once more.
MOTION = ("swipe-motion-check-", "pre-glass-motion-check")
MOTION_INPUTS = ("web/hk/modules/hk-pageswipe.js", "web/hk/modules/hk-drag.js", "web/hk/layout/hk-layout-pager.js",
                 "web/hk/shell/", "web/hk/modules/hk-glass.js", "web/hk/modules/hk-frosttint.js", "web/hk/modules/hk-sky.js",
                 "tools/split_manifests/", "tools/build_static.py")
# THE RELEASE RUN'S SIZES (the owner, 2026-11-08: "a lot of these tests aren't needed"): the wall tablet, the iPad and a
# phone; the check's other sizes (page_swipe_check.py ENGINE_SIZES) run when it is run by hand
PAGE_SWIPE = {"chromium": ("1280x800",), "webkit": ("1180x820", "390x844")}
# Edit mode's sections that depend on the engine, the input or the size (edit_mode_check.py SECTIONS has the rest)
EDIT_GESTURES = ("bar", "room", "pages", "menu", "still", "frost")
LOCAL_ONLY: tuple[str, ...] = ()   # files changed here and never committed (none since the Apple apps moved out, 2026-11-08)
# WHAT A RELEASE CHANGES (2026-11-01). A full run of one commit speaks for another when nothing else differs: only
# version lines in VERSION_FILES (bump_version.py's files, tools/check_version.py FILES, and the components'
# manifests release_house.py sets), and anything in CHANGELOGS. Then `versions` re-runs what reads them.
VERSION_FILES = ("packaging/ha-app/config.yaml", "packaging/connect-app/config.yaml", "pyproject.toml",
                 "hosts/ha/custom_components/hk_frontend/manifest.json", "hosts/ha/custom_components/mantel/manifest.json")
CHANGELOGS = ("CHANGELOG.md", "docs/development/House-releases.md",
              "hosts/ha/custom_components/hk_frontend/tools/publish/root/CHANGELOG.md",
              "hosts/ha/custom_components/mantel/tools/publish/root/CHANGELOG.md")
VERSION_LINE = re.compile(r'^\s*"?version"?\s*[:=]\s*"?[0-9A-Za-z.+-]*"?\s*,?\s*(#.*)?$')
# WHAT A FULL STEP READS (2026-11-02; "unchanged" above). A folder ends in "/"; a version file counts without its version
# lines. A browser check: the page and the server it runs against (the gallery's fictional house over Mantel's own
# server, which also serves the guide), and its script's files (check_inputs). HK Frontend's suites: what its build
# takes (publish.py plan: the component, web/hk, the shared assets, hk_core) and the esbuild it minifies with.
PAGE_INPUTS = ("web/", "tools/split_manifests/", "hk_core/", "hosts/server/mantel_server/", "tests/fixtures/",
               "hosts/ha/custom_components/hk_frontend/docs/", "packaging/ha-app/DOCS.md", *VERSION_FILES)
HK_INPUTS = ("hosts/ha/", "web/", "hk_core/", "tools/build_ha.py", "tools/build_tools.py", "tools/package.json",
             "tools/package-lock.json", *VERSION_FILES)
# what types-py reads: the Python it checks and its own config and baselines
PY_INPUTS = ("hk_core/", "hosts/server/", "tools/", "tests/", "pyproject.toml")
# where a check's script finds the modules it imports (each puts these on sys.path)
SCAN_DIRS = ("tools/headless", "tools", "tests")
PLAYWRIGHT = ("py", "playwright", "mac")       # what a Playwright check runs with (env_print), Chromium's also "chrome"
KEY_VERSION = "1"                              # a new one when what goes into a key changes


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
    tier: str = "quick"                      # quick steps run in both tiers; full steps only in full; by-hand ones
                                             # only when named (full --only NAME; none since phase 25)
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
    # `alone` steps run after all the others, one at a time (the motion checks: frame timing on a quiet Mac), and a
    # failed one runs again up to `attempts` times in all, the result saying it needed another go
    alone: bool = False
    attempts: int = 1
    # in `versions` too: it reads the version files or the changelogs (a release's re-check)
    versions: bool = False
    # what it reads (PAGE_INPUTS): with them, a step that passed is "unchanged" while they are; without, it always runs
    inputs: tuple[str, ...] | Callable[[], tuple[str, ...]] = ()
    # what it runs with besides the tree (env_print's kinds): part of its key
    needs: tuple[str, ...] = ()
    # one part of a check run in parts (`--shard K/N`): the check's name, its parts counted by next_parts
    family: str = ""


@dataclass
class Result:
    name: str
    status: str                              # passed | failed | skipped | unchanged (a pass, carried)
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


def check_inputs(script: str, engine: str = "webkit") -> dict:
    """A browser check's `inputs` and `needs`: the page and its server, and the script's files (imported())."""
    return {"inputs": lambda: (*PAGE_INPUTS, *imported([script])),
            "needs": ("py", "chrome", "mac") if engine == "cdp" else PLAYWRIGHT + (("chrome",) * (engine == "chromium"))}


def motion_inputs(script: str, engine: str = "webkit") -> dict:
    """A motion check's: the pager, the swipe and the glass (MOTION_INPUTS) and its script's files; it runs after the rest,
    in its engine's lane (two lanes side by side)."""
    return {**check_inputs(script, engine), "inputs": lambda: (*MOTION_INPUTS, *imported([script])), "alone": True,
            "attempts": 2, "lane": "motion-" + engine}


def is_motion(name: str) -> bool:
    return name.startswith(MOTION)


def steps(build: Build | None = None, parts: dict[str, int] | None = None) -> list[Step]:
    """Every step; a check in parts in `parts`' count of them (timing.json's), else its default."""
    build = build or Build()
    shows = (parts or {}).get("saver-shows-check", SAVER_SHARDS)
    py = python()
    out = [
        # esbuild, pinned (tools/package.json): the image and HK Frontend builds minify with it, and the suite
        # checks what it makes (2026-10-29); npm ci only when tools/node_modules is not what the lock pins, the old
        # folder set aside first: the SMB share sometimes can't delete it in place (tools/build_tools.py, 2026-10-31)
        Step("build-tools", [py, "tools/build_tools.py"], skip=lambda: None if shutil.which("npm") else "no npm (Node.js)",
             timeout=300, first=True),
        # (on 8 workers where pytest-xdist is installed: about a minute, not four)
        Step("main-suite", lambda: [py, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-m", "not perf", *xdist_args(py)],
             env=private_env()),
        # TypeScript on every web file that opts in with // @ts-check (phase 18, Part C; its own pinned folder)
        Step("types-js", [py, "tools/typecheck/check.py"], timeout=300,
             skip=lambda: None if shutil.which("npm") and (os.environ.get("NODE") or shutil.which("node"))
             else "no npm or node (Node.js)"),
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
        # mypy on hk_core (the route table's modules strict) and ruff's pyflakes rules: per-file counts that only fall
        Step("types-py", [py, "tools/typecheck/py_check.py"], tier="full", timeout=600, inputs=PY_INPUTS,
             skip=lambda: None if subprocess.run([py, "-c", "import mypy, ruff"], capture_output=True).returncode == 0
             else "no mypy or ruff in the venv (pip install -e '.[dev]')"),
        Step("ha-build", lambda: [py, "tools/build_ha.py", str(build.ha)], tier="full", timeout=600, first=True),
        Step("hk-frontend-py", [str(HA_PY), "-m", "pytest", "-q", "-p", "no:cacheprovider"], tier="full",
             skip=lambda: build.missing() or (None if HA_PY.exists() else f"no harness venv at {HA_PY.parent.parent}"),
             cwd=lambda: build.ha / "tests/py", inputs=HK_INPUTS, needs=("ha",)),
        Step("hk-frontend-js", lambda: ["sh", str(build.ha / "tests/run")], tier="full",
             skip=lambda: build.missing() or (None if JSC.exists() else "no JavaScriptCore (macOS only)"),
             inputs=HK_INPUTS, needs=("jsc",)),
    ]
    out += [Step(f"headless-{n}", [py, f"tools/headless/{n}.py"], tier="full", timeout=600,
                 skip=lambda: None if chrome() else "no Chrome or Chromium (set CHROME)", lane="devtools",
                 **check_inputs(f"tools/headless/{n}.py", "cdp"))
            for n in HEADLESS]     # one at a time: each uses a fixed DevTools port
    # Edit mode in Chromium (a finger) and WebKit (a mouse), at a tablet's and a phone's size (Playwright's own
    # browsers, no fixed port); Chromium's tablet the wall tablets' 1280 x 800, WebKit's an 11" iPad's 1180 x 820
    # (each engine at each size a step of its own, so they run side by side: six minutes together)
    # (who sees Edit, Cancel and the server's changes are the same in every engine and size: once, in WebKit at a
    # tablet's, the owner's iPad; the gestures they use are the room's and the pages', checked in all four, 2026-11-01)
    out += [Step(f"edit-mode-check-{e}-{z}", [py, "tools/headless/edit_mode_check.py", "--engine", e, "--size", z,
                                              *([] if (e, z) == ("webkit", "1180x820") else
                                                [a for s in EDIT_GESTURES for a in ("--only", s)])], tier="full",
                 timeout=1200, skip=playwright_missing, **check_inputs("tools/headless/edit_mode_check.py", e))
            for e, z in (("chromium", "1280x800"), ("chromium", "390x844"), ("webkit", "1180x820"), ("webkit", "390x844"))]
    # Edit mode on a Home Grid in WebKit, a finger and a mouse, at a tablet either way and a phone (2026-10-31)
    # (each size a step of its own)
    out += [Step(f"grid-edit-check-{z}", [py, "tools/headless/grid_edit_check.py", "--size", z], tier="full",
                 timeout=900, skip=playwright_missing, **check_inputs("tools/headless/grid_edit_check.py"))
            for z in ("1180x820", "820x1180", "390x844")]
    # the Now Playing block while its speaker plays, in both engines, three sizes each (2026-11-05): the bar and time move and
    # the blurred cover is never touched, Background: Card, every card of a block with rules set in the Home Grid editor
    # (its --pixels, real frames of a window, is by hand: it opens one)
    out += [Step(f"media-card-check-{e}", [py, "tools/headless/media_card_check.py", "--engine", e], tier="full",
                 timeout=900, skip=playwright_missing, **check_inputs("tools/headless/media_card_check.py", e))
            for e in ("webkit", "chromium")]
    # the Intercom's block and sheet in WebKit with a finger: an iPad either way up, a phone either way up, a wall tablet
    # (each size a step of its own). It was by hand until 2026-11-05, and its message steps had gone stale unnoticed.
    out += [Step(f"intercom-check-{z}", [py, "tools/headless/intercom_check.py", "--size", z,
                                         "--shots", str(ROOT / ".ci" / "intercom-shots")], tier="full",
                 timeout=900, skip=playwright_missing, **check_inputs("tools/headless/intercom_check.py"))
            for z in ("ipad", "ipad-landscape", "phone", "phone-landscape", "wall")]
    # House Status's blocks and sheet (2026-11-07, docs/phase11/HOUSE-STATUS.md), house commands off: every size on square
    # and tile cells, the sections' taps, the sheet at the tablets' and phones' sizes (each engine and part a step of its own)
    out += [Step(f"house-status-check-{e}-{p}", [py, "tools/headless/house_status_check.py", "--engine", e, "--only", p], tier="full",
                 timeout=900, skip=playwright_missing, **check_inputs("tools/headless/house_status_check.py", e))
            for e in ("webkit", "chromium") for p in ("blocks", "sheet")]
    # The Alert (2026-11-10, docs/phase11/ALERT.md), house commands off: every size on square and tile cells with and without a
    # camera, its taps, and a Show When block going to the alert and back as the house moves (each engine a step of its own)
    out += [Step(f"alert-check-{e}", [py, "tools/headless/alert_check.py", "--engine", e], tier="full",
                 timeout=900, skip=playwright_missing, **check_inputs("tools/headless/alert_check.py", e))
            for e in ("webkit", "chromium")]
    # Laundry (2026-11-10, docs/phase22/LAUNDRY.md), house commands off: one machine and two, every size on square and tile
    # cells, the tap to the sheet at a tablet's and a phone's size, the room's tiles and the chip (each engine a step of its own)
    out += [Step(f"laundry-check-{e}", [py, "tools/headless/laundry_check.py", "--engine", e], tier="full",
                 timeout=900, skip=playwright_missing, **check_inputs("tools/headless/laundry_check.py", e))
            for e in ("webkit", "chromium")]
    # A block's Custom Detail Sheet and Security's HomeView sizes (2026-11-07, docs/phase11/HOME-GRID.md), house commands
    # off: the five sizes on square and tile cells, the overview and Back, the sheet at phone to tablet sizes
    out += [Step(f"custom-sheet-check-{e}", [py, "tools/headless/custom_sheet_check.py", "--engine", e], tier="full",
                 timeout=900, skip=playwright_missing, **check_inputs("tools/headless/custom_sheet_check.py", e))
            for e in ("webkit", "chromium")]
    # Pre-rendered glass (Blur and Bright Glass) over a moving wallpaper, the real detector and painter (2026-11-07)
    # (by hand 2026-11-08 to 11-11, like swipe-motion below; a motion check since phase 25: MOTION above)
    out.append(Step("pre-glass-motion-check", [py, "tools/headless/pre_glass_motion_check.py"], tier="full", timeout=600,
                    skip=playwright_missing, **motion_inputs("tools/headless/pre_glass_motion_check.py")))
    # the page beside the iPhone Duo's side strip, in WebKit (its insets stood in; 2026-10-30)
    out.append(Step("side-strip-check", [py, "tools/headless/side_strip_check.py"], tier="full", timeout=600,
                    skip=playwright_missing, **check_inputs("tools/headless/side_strip_check.py")))
    # Swipe Between Pages in Chromium and WebKit, with a finger, at two tablet and two phone sizes (2026-10-30)
    # (each engine at each size a step of its own)
    out += [Step(f"page-swipe-check-{e}-{z}", [py, "tools/headless/page_swipe_check.py", "--engine", e, "--size", z],
                 tier="full", timeout=900, skip=playwright_missing, **check_inputs("tools/headless/page_swipe_check.py", e))
            for e, sizes in PAGE_SWIPE.items() for z in sizes]
    # ...and how it moves, frame by frame: the finger, the release, what comes in, a new finger mid-settle (2026-11-04)
    # BY HAND from 2026-11-08 (20 of the 33 failed full runs since 2026-11-05 were these four on timing noise) until
    # phase 25: the phone-size failure then went unseen for three days. Motion checks now (MOTION above)
    out += [Step(f"swipe-motion-check-{e}-{z}", [py, "tools/headless/swipe_motion_check.py", "--engine", e, "--size", z], tier="full",
                 timeout=900, skip=playwright_missing, **motion_inputs("tools/headless/swipe_motion_check.py", e))
            for e, sizes in SWIPE_MOTION.items() for z in sizes]
    # a Home Grid block that swipes moves as a whole block, cut off in its gutter, in WebKit in four looks (2026-11-06)
    out.append(Step("pager-edges-check", [py, "tools/headless/pager_edges_check.py"], tier="full", timeout=600,
                    skip=playwright_missing, **check_inputs("tools/headless/pager_edges_check.py")))
    # the screensaver's HomeView-style faces and Time Behind in WebKit, a tablet either way and a phone (2026-10-30)
    out.append(Step("saver-faces-check", [py, "tools/headless/saver_faces_check.py"], tier="full", timeout=600,
                    skip=playwright_missing, **check_inputs("tools/headless/saver_faces_check.py")))
    # (the Holiday slide's scenes placed at five sizes, phase 20: its words, the corner and row clear, nothing floating,
    # its effects only while it is up -- a page of its own, no server)
    for e in ("webkit", "chromium"):
        out.append(Step(f"holiday-scenes-check-{e}", [py, "tools/headless/holiday_scenes_check.py", "--engine", e], tier="full", timeout=1500,
                        skip=playwright_missing, **dict(check_inputs("tools/headless/holiday_scenes_check.py", e),
                        inputs=lambda: (*PAGE_INPUTS, *imported(["tools/headless/holiday_scenes_check.py"]), "tools/headless/holiday_harness.html"))))
    # (the Timer slide at five sizes, phase 21: on the screen, nothing on anything, no frame asked for -- a page of its own, no server)
    for e in ("webkit", "chromium"):
        out.append(Step(f"timer-slide-check-{e}", [py, "tools/headless/timer_slide_check.py", "--engine", e], tier="full", timeout=600,
                        skip=playwright_missing, **dict(check_inputs("tools/headless/timer_slide_check.py", e),
                        inputs=lambda: (*PAGE_INPUTS, *imported(["tools/headless/timer_slide_check.py"]), "tools/headless/timer_slide_harness.html"))))
    # the Screensaver editor in WebKit (phase 13): Looks that keep the Info, the four sections, a piece's page, the library
    out += [Step(f"saver-designs-check-{e}-{z}", [py, "tools/headless/saver_designs_check.py", "--engine", e, "--size", z],
                 tier="full", timeout=600, skip=playwright_missing, **check_inputs("tools/headless/saver_designs_check.py", e))
            for e, z in (("chromium", "1280x800"), ("webkit", "1180x820"), ("webkit", "390x844"))]

    out.append(Step("saver-editor-check", [py, "tools/headless/saver_editor_check.py"], tier="full", timeout=900,
                    skip=playwright_missing, **check_inputs("tools/headless/saver_editor_check.py")))
    # the Side Pane in WebKit: beside Home on each side, Every Page, the screensaver, each section alone (2026-10-30)
    # (each size a step of its own, 2026-11-01: together they were the full run's longest step, ~4 minutes)
    out += [Step(f"side-pane-check-{z}", [py, "tools/headless/side_pane_check.py", "--size", z], tier="full", timeout=900,
                 skip=playwright_missing, **check_inputs("tools/headless/side_pane_check.py"))
            for z in ("1180x820", "820x1180", "390x844")]
    out += [Step(f"music-pane-check-{e}", [py, "tools/headless/music_pane_check.py", "--engine", e], tier="full", timeout=600,
                 skip=playwright_missing, **check_inputs("tools/headless/music_pane_check.py", e))
            for e in ("chromium", "webkit")]
    # the Music page's player (2026-11-09): the controls strip's touch rules, the pause halfway, a phone's mini player and sheet
    out += [Step(f"music-page-check-{e}", [py, "tools/headless/music_page_check.py", "--engine", e], tier="full", timeout=600,
                 skip=playwright_missing, **check_inputs("tools/headless/music_page_check.py", e))
            for e in ("chromium", "webkit")]
    # the Now Playing page: every size, its corner and controls, beside a pane, and swiping from Home
    out += [Step(f"now-playing-page-check-{e}", [py, "tools/headless/now_playing_page_check.py", "--engine", e], tier="full", timeout=600,
                 skip=playwright_missing, **check_inputs("tools/headless/now_playing_page_check.py", e))
            for e in ("chromium", "webkit")]
    # the Looks in WebKit: each applied from its page, Home at three sizes, Undo; Layout + Look in the editor (2026-10-30)
    out.append(Step("looks-check", [py, "tools/headless/looks_check.py"], tier="full", timeout=900,
                    skip=playwright_missing, **check_inputs("tools/headless/looks_check.py")))
    # the screensaver's Shows the way a house starts them: a screen's settings -> the strategy -> the screensaver
    # (in `shows` parts side by side, each every `shows`-th of its runs; each Show at its first size, 2026-11-08: the
    # phone and portrait sizes run when the check is run by hand)
    out += [Step(f"saver-shows-check-{i}of{shows}", [py, "tools/headless/saver_shows_check.py", "--one-size", "--shard",
                                                    f"{i}/{shows}"], tier="full", timeout=900, family="saver-shows-check",
                 skip=playwright_missing, **check_inputs("tools/headless/saver_shows_check.py"))
            for i in range(1, shows + 1)]
    # (phase 25) the timing budgets (pytest -m perf): alone, after every other step, so a busy Mac is not a failure
    out.append(Step("perf-budgets", [py, "-m", "pytest", "-q", "-p", "no:cacheprovider", "-m", "perf"], tier="full",
                    alone=True, env=private_env(), timeout=600))
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
    chosen = [s for s in all_steps if in_tier(s, tier) or (only and tier == "full" and s.tier == "by-hand")]
    if only:
        chosen = [s for s in chosen if any(o in s.name for o in only)]
        build = [s for s in all_steps if s.name == "ha-build"]
        if build and build[0] not in chosen and any(s.name.startswith("hk-frontend") for s in chosen):
            chosen.insert(0, build[0])           # HK Frontend's suites run in the build
    return chosen


def run_step(step: Step, log_dir: Path) -> Result:
    res = run_once(step, log_dir)
    tries = 1
    while res.status == "failed" and tries < step.attempts:
        tries += 1
        first = res
        res = run_once(step, log_dir)
        if res.status == "passed":
            res.reason = f"passed on try {tries} (try 1: {first.reason})"
    return res


def run_once(step: Step, log_dir: Path) -> Result:
    reason = step.skip()
    if reason:
        return Result(step.name, "skipped", reason=reason)
    cmd = step.cmd() if callable(step.cmd) else step.cmd
    cwd = step.cwd() if callable(step.cwd) else step.cwd
    start = time.monotonic()
    try:
        r = subprocess.run(cmd, cwd=cwd, env={**step_env(cmd[:1] == [python()]), **step.env}, stdin=subprocess.DEVNULL,
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
        store: Path | None = None, step_store: Path | None = None, reuse: bool = True, build: Build | None = None,
        root: Path = ROOT, shared_times: Path | None = None, timing: Path | None = None, release: bool = False) -> dict:
    """Run the steps and write the record; with `store`, a whole run (no `only`) is also remembered there. With
    `step_store`, each step with a key (step_keys, at the start) that passed is remembered there by it, and one that
    failed forgets it; and with `reuse`, a step whose key passed before is not run: it is unchanged. With `release`,
    the motion checks (MOTION) run whatever passed before."""
    record_dir.mkdir(exist_ok=True)
    started = datetime.datetime.now(datetime.timezone.utc)
    before = git_state(root)
    keys = step_keys(chosen, build, root) if step_store else {}
    carried = carried_passes(keys, step_store) if step_store and reuse else {}
    if release:
        # (a motion check carried only when its key passed in a release run already: a release's rerun after a flake
        # elsewhere doesn't run them again -- phase 25, the 0.1.166 night, ~14 minutes a rerun)
        carried = {k: v for k, v in carried.items() if not is_motion(k) or v.get("release")}
    if carried:
        echo(f"  ({len(carried)} of {len(chosen)} steps unchanged since they passed: not run again; --all runs them)")
    got: dict[str, Result] = {}
    lock = threading.Lock()

    def one(step: Step):
        if step.name in carried:
            was = carried[step.name]
            res = Result(step.name, "unchanged", reason=f"its inputs as on {was['commit'][:9]}, passed {was['finished']}")
            with lock:
                got[step.name] = res
                echo(f"  {step.name} unchanged (passed on {was['commit'][:9]})")
            return
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
    for step in [s for s in chosen if not s.first and not s.alone]:
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
    # (a step never timed yet counts as the longest: 2026-11-02, eight new saver parts would have started last; and
    # `shared_times`, every worktree's, first: a release's fresh worktree had none, and started the longest steps last)
    was = {**step_times(record_dir), **(read_times(shared_times) if shared_times else {})}
    new = max(was.values(), default=60)
    jobs.sort(key=lambda job: -sum(0 if s.name in carried else was.get(s.name, new) for s in job))
    # (13 at once on this 18-core Mac: the browser checks mostly wait, so the cores were two-thirds idle at 9 and
    # the run waited on width, not CPU -- 2026-11-01, 238 s at 9, 191 s at 14, every check steady and no slower)
    # (2026-11-02, CI_JOBS=22 here: `full --all` in 218-224 s, not ~320 s at 14, ~4 of 18 cores busy -- but two of
    # three runs failed on load flakes (a WebKit page error, the main suite's timing), each a whole rerun. 14 stays)
    width = max(1, int(os.environ.get("CI_JOBS") or min(14, max(2, (os.cpu_count() or 4) * 3 // 4))))
    with concurrent.futures.ThreadPoolExecutor(max_workers=width) as pool:
        for f in [pool.submit(lambda job=job: [one(s) for s in job]) for job in jobs]:
            f.result()
    # then the motion checks, after everything else: one lane per engine, the two lanes side by side (each lane's steps
    # one at a time) -- the noise that failed them was a dozen browsers at once, not two (phase 25)
    alone: dict[str, list[Step]] = {}
    for step in [s for s in chosen if s.alone and not s.first]:
        alone.setdefault(step.lane or step.name, []).append(step)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for f in [pool.submit(lambda job=job: [one(s) for s in job]) for job in alone.values()]:
            f.result()
    results = [got[s.name] for s in chosen]
    head, tree, dirty = git_state(root)
    record = {
        "tier": tier,
        "only": only or None,                # a part of the tier: never a whole run
        "release": release,                  # --release: the motion checks ran whatever passed before
        "commit": head,
        "tree": tree,
        "dirty": dirty,
        "steady": before == (head, tree, dirty),     # nothing committed or changed while it ran
        "started": started.isoformat(timespec="seconds"),
        "finished": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "ok": not any(r.status == "failed" for r in results),
        "steps": [vars(r) for r in results],
        # (what took longer than it should: timing_warnings, with `timing` the history it compares with)
        "warnings": keep_timing(chosen, results, timing, whole=tier == "full" and not only and bool(results)
                                and all(r.status == "passed" for r in results)) if timing else [],
    }
    (record_dir / "last-run.json").write_text(json.dumps(record, indent=2) + "\n")
    times = {**was, **{r.name: round(r.seconds, 1) for r in results if r.status in ("passed", "failed")}}
    (record_dir / "step-times.json").write_text(json.dumps(times, indent=1, sort_keys=True) + "\n")
    if shared_times:
        shared_times.parent.mkdir(parents=True, exist_ok=True)
        tmp = shared_times.with_suffix(f".{os.getpid()}.tmp")
        tmp.write_text(json.dumps({**read_times(shared_times), **times}, indent=1, sort_keys=True) + "\n")
        tmp.replace(shared_times)
    if store:
        remember(record, store)
    if step_store and keys:
        remember_steps(record, keys, step_store)
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
                 "release": bool(record.get("release")),
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


def motion_ran(run: dict) -> bool:
    """A stored run in which the motion checks ran and passed (not carried as unchanged)."""
    named = {n: st for n, st in (run.get("steps") or {}).items() if is_motion(n)}
    ok = ("passed", "unchanged") if run.get("release") else ("passed",)   # (carried in a release run: from a release pass)
    return bool(named) and all(st in ok for st in named.values())


def full_run_for(head: str, store: Path, root: Path = ROOT, look: int = 20,
                 motion: bool = False) -> tuple[dict | None, str]:
    """The passed full run that speaks for the commit `head`: (run, "same") when it ran on `head` itself; (run,
    "versions") when it ran on a commit with `head`'s tree, or one that differs from it only in versions and
    changelogs (`versions` must then pass on head); (None, why not) when none does. With `motion` (a release), only a
    run in which the motion checks ran (`full --release`, or one after a change to what they read) counts."""
    tree = subprocess.run(["git", "rev-parse", f"{head}^{{tree}}"], cwd=root, capture_output=True, text=True).stdout.strip()
    if failed := failed_tree(tree, store):
        return None, (f"the last whole {failed['tier']} run of HEAD's tree, on {failed['commit'][:9]}, failed: "
                      f"`tools/ci.py {failed['tier']}` must pass on it again")
    fulls = [r for r in reversed(passed_runs(store)) if r.get("tier") == "full"][:look]
    if not fulls:
        return None, "no passed full run: run `tools/ci.py full` first"
    if motion:
        fulls = [r for r in fulls if motion_ran(r)]
        if not fulls:
            return None, "no passed full run in which the motion checks ran: run `tools/ci.py full --release`"
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


# ---------------------------------------------------------------- what each step reads, by content (2026-11-02)
# A house release took 25-30 minutes, most of it `full` running again, in browsers, checks of what no commit since had
# touched. A full step with `inputs` has a key: the contents of those files in HEAD's tree (git's blob ids; a version
# file without its version lines, so a release's bump changes no key), its command, and what it runs with (env_print).
# A key that passed in a steady run is not run again (unchanged); a failure with it forgets it.

IMPORT = re.compile(r"^\s*(?:from\s+([A-Za-z_]\w*)|import\s+([A-Za-z_][\w., ]*))", re.M)


def imported(scripts: list[str], root: Path = ROOT) -> list[str]:
    """The scripts, the files beside each of the same name (a check's .cjs half), and each module of SCAN_DIRS they
    import, and those import, and so on (the working copy's: a changed one is uncommitted, so its step runs anyway)."""
    seen: list[str] = []
    todo = list(scripts)
    while todo:
        rel = todo.pop()
        path = root / rel
        if rel in seen or not path.is_file():
            continue
        seen.append(rel)
        todo += [str(q.relative_to(root)) for q in path.parent.glob(path.stem + ".*")
                 if q.suffix in (".py", ".cjs", ".mjs", ".js")]
        if path.suffix == ".cjs":              # a Playwright half's own helpers (require('./grid_ready.cjs'))
            todo += [str((path.parent / m).relative_to(root)) for m in re.findall(r"require\('\./([\w.-]+\.cjs)'\)", path.read_text(errors="replace"))]
        if path.suffix != ".py":
            continue
        for frm, imp in IMPORT.findall(path.read_text(errors="replace")):
            for name in [frm] if frm else [n.strip().split(".")[0].split(" ")[0] for n in imp.split(",")]:
                todo += [f"{d}/{name}.py" for d in SCAN_DIRS if (root / d / f"{name}.py").is_file()]
    return sorted(seen)


def matches(path: str, spec: str) -> bool:
    """A path in an input: a folder (ending in "/"), a glob, or the file itself. A path ending in "/" (git's untracked
    or ignored folder) matches what it could hold."""
    if path.endswith("/"):
        return spec.startswith(path) or path.startswith(spec) if spec.endswith("/") else spec.startswith(path)
    if spec.endswith("/"):
        return path.startswith(spec)
    return fnmatch.fnmatchcase(path, spec) if any(c in spec for c in "*?[") else path == spec


def tree_blobs(rev: str = "HEAD", root: Path = ROOT) -> dict[str, str]:
    """Each file of the commit's tree: its mode and blob id."""
    out = subprocess.run(["git", "ls-tree", "-r", "-z", "--full-tree", rev], cwd=root, capture_output=True, text=True,
                         check=True).stdout
    blobs = {}
    for entry in filter(None, out.split("\0")):
        meta, path = entry.split("\t", 1)
        mode, _, blob = meta.split()
        blobs[path] = f"{mode} {blob}"
    return blobs


def uncommitted(root: Path = ROOT) -> list[str]:
    """What the working copy has that HEAD hasn't: changed, staged, new (each file) and git-ignored files (but the
    caches and the folders of other tools), LOCAL_ONLY aside."""
    out = subprocess.run(["git", "status", "--porcelain", "-z", "--untracked-files=all", "--ignored"], cwd=root,
                         capture_output=True, text=True).stdout
    paths, skip_next = [], False
    for entry in out.split("\0"):
        if skip_next or not entry:
            skip_next = False
            continue
        code, path = entry[:2], entry[3:]
        skip_next = code[0] in "RC"                      # a rename: its old name follows
        if code == "!!" and (re.search(r"(^|/)(__pycache__|node_modules|\.ci|\.claude|\.venv|\.pytest_cache)(/|$)", path)
                             or path.endswith((".pyc", ".DS_Store")) or "/.smbdelete" in "/" + path):
            continue
        if path not in LOCAL_ONLY:
            paths.append(path)
    return paths


def versionless(path: str, root: Path = ROOT) -> str:
    try:
        text = (root / path).read_text()
    except OSError:
        return "missing"
    return hashlib.sha256("".join(ln for ln in text.splitlines(True) if not VERSION_LINE.match(ln.rstrip("\n")))
                          .encode()).hexdigest()


_PRINTS: dict[str, str] = {}
PACKAGES = ("import sys, importlib.metadata as m; print(sys.version); "
            "print(sorted({(d.metadata['Name'] or '').lower() + '==' + d.version for d in m.distributions()}))")


def _text(*cmd: str) -> str:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        return f"{r.returncode} {r.stdout.strip()}"
    except (OSError, subprocess.TimeoutExpired) as e:
        return f"error {e}"


def _stat(path: str | Path) -> str:
    try:
        st = Path(path).resolve().stat()
        return f"{Path(path).resolve()} {st.st_size} {st.st_mtime_ns}"
    except OSError:
        return f"{path} missing"


def _app(binary: str) -> str:
    """A macOS app's version (its Info.plist), else the binary itself."""
    for parent in Path(binary).resolve().parents:
        if parent.name == "Contents" and (parent / "Info.plist").exists():
            try:
                info = plistlib.loads((parent / "Info.plist").read_bytes())
                return f"{binary} {info.get('CFBundleIdentifier')} {info.get('CFBundleVersion')}"
            except (OSError, ValueError, plistlib.InvalidFileException):
                break
    return _stat(binary)


def env_print(kind: str) -> str:
    """What a step runs with besides the tree, as text (asked once a run): the venv's packages ("py", "ha"), Playwright,
    its browsers and Node ("playwright"), Chrome ("chrome"), JavaScriptCore ("jsc"), the Mac ("mac": its fonts)."""
    if kind not in _PRINTS:
        if kind == "py":
            got = _text(python(), "-c", PACKAGES)
        elif kind == "ha":
            got = _text(str(HA_PY), "-c", PACKAGES) if HA_PY.exists() else "none"
        elif kind == "mac":
            got = f"{platform.platform()} {platform.mac_ver()[0]}"
        elif kind == "jsc":
            got = f"{_stat(JSC)} {platform.mac_ver()[0]}"
        elif kind == "chrome":
            got = _app(c) if (c := chrome()) else "none"
        elif kind == "playwright":
            pw, node = os.environ.get("PLAYWRIGHT_PATH"), os.environ.get("NODE")
            try:
                version = json.loads((Path(pw) / "package.json").read_text()).get("version") if pw else None
            except (OSError, ValueError):
                version = None
            cache = Path(os.environ.get("PLAYWRIGHT_BROWSERS_PATH") or HOME / "Library/Caches/ms-playwright")
            got = json.dumps([pw, version, node and _text(node, "--version"), _stat(node) if node else None,
                              sorted(p.name for p in cache.glob("*")) if cache.is_dir() else None])
        else:
            raise ValueError(f"no such need: {kind}")
        _PRINTS[kind] = got
    return _PRINTS[kind]


def step_key(step: Step, blobs: dict[str, str], dirty: list[str], cmd: list[str], root: Path = ROOT) -> str | None:
    """The step's key (see above), or None: it names no inputs, or one of them is uncommitted."""
    specs = step.inputs() if callable(step.inputs) else step.inputs
    if not specs or any(matches(p, sp) for p in dirty for sp in specs):
        return None
    folders = tuple(sp for sp in specs if sp.endswith("/"))
    files = {sp for sp in specs if not sp.endswith("/") and not any(c in sp for c in "*?[")}
    globs = [sp for sp in specs if any(c in sp for c in "*?[")]
    h = hashlib.sha256()
    for part in (KEY_VERSION, step.name, json.dumps(cmd), json.dumps(sorted(step.env.items())),
                 *(env_print(k) for k in step.needs)):
        h.update(part.encode() + b"\0")
    for path in sorted(blobs):
        if path in files or path.startswith(folders) or any(fnmatch.fnmatchcase(path, g) for g in globs):
            h.update(f"{path}\0{versionless(path, root) if path in VERSION_FILES else blobs[path]}\0".encode())
    # (a file named but in no tree is part of the key too: when it appears, the key changes)
    for path in sorted(files - set(blobs)):
        h.update(f"{path}\0none\0".encode())
    return h.hexdigest()


def step_keys(chosen: list[Step], build: Build | None = None, root: Path = ROOT) -> dict[str, str]:
    """Each chosen step's key, for those that have one (HEAD's tree; the HA build's folder out of the commands)."""
    wanted = [s for s in chosen if s.inputs]
    if not wanted:
        return {}
    blobs, dirty = tree_blobs("HEAD", root), uncommitted(root)
    out = {}
    for s in wanted:
        cmd = s.cmd() if callable(s.cmd) else s.cmd
        if build and build.dir:
            cmd = [c.replace(str(build.dir), "$BUILD") for c in cmd]
        if key := step_key(s, blobs, dirty, cmd, root):
            out[s.name] = key
    return out


def step_store_path() -> Path:
    return store_path().with_name("steps.json")


def step_passes(store: Path) -> dict[str, list[dict]]:
    try:
        got = json.loads(store.read_text())["steps"]
        return {k: [e for e in v if isinstance(e, dict) and e.get("key")] for k, v in got.items() if isinstance(v, list)}
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return {}


def carried_passes(keys: dict[str, str], store: Path) -> dict[str, dict]:
    """The steps whose key passed before: their newest pass with it, by name."""
    passes = step_passes(store)
    return {name: e for name, key in keys.items()
            for e in [next((e for e in reversed(passes.get(name, [])) if e["key"] == key), None)] if e}


def remember_steps(record: dict, keys: dict[str, str], store: Path, keep: int = 40) -> bool:
    """A steady run's steps (its HEAD and working copy the same at the end): each that passed is kept by its key, each
    that failed forgets its key. (Each worktree's runs share the file: one at a time, under a lock.)"""
    if not record.get("steady"):
        return False
    store.parent.mkdir(parents=True, exist_ok=True)
    with open(store.with_suffix(".lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        passes = step_passes(store)
        for s in record["steps"]:
            key = keys.get(s["name"])
            if not key or s["status"] not in ("passed", "failed"):
                continue
            kept = [e for e in passes.get(s["name"], []) if e["key"] != key]
            if s["status"] == "passed":
                kept.append({"key": key, "commit": record["commit"], "finished": record["finished"],
                             "release": bool(record.get("release"))})
            passes[s["name"]] = kept[-keep:]
        tmp = store.with_suffix(f".{os.getpid()}.tmp")
        tmp.write_text(json.dumps({"steps": passes}, indent=1, sort_keys=True) + "\n")
        tmp.replace(store)
    return True


def read_times(path: Path) -> dict[str, float]:
    try:
        return {str(k): float(v) for k, v in json.loads(path.read_text()).items()}
    except (OSError, ValueError, TypeError, AttributeError):
        return {}


def step_times(record_dir: Path) -> dict[str, float]:
    """Each step's seconds the last time it ran (or, before step-times.json, the last run's)."""
    for name, read in (("step-times.json", lambda d: d), ("last-run.json", lambda d: {x["name"]: x["seconds"] for x in d["steps"]})):
        try:
            return {str(k): float(v) for k, v in read(json.loads((record_dir / name).read_text())).items()}
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            continue
    return {}


# ---------------------------------------------------------------- how long the steps take (2026-11-02)
# THE CHECKS GREW UNSEEN. One commit made the screensaver Shows' check every Look under every slide at four sizes (~150
# runs, each with seconds of fixed waits): four parts of ~510 s, the full run ten minutes, and no run said why. Now a
# check in parts is cut into more of them as it grows (next_parts), and a step that got much slower than its own last
# runs, or that is past STEP_BUDGET, is named under the table. Each kept in timing.json beside the passed runs.

def read_timing(path: Path | None) -> dict:
    """{"history": {step: [its last passed seconds]}, "parts": {check: how many parts}}, empty where unknown."""
    try:
        got = json.loads(path.read_text()) if path else {}
    except (OSError, ValueError):
        got = {}
    hist = got.get("history") if isinstance(got, dict) else None
    parts = got.get("parts") if isinstance(got, dict) else None
    return {"history": {k: [float(x) for x in v if isinstance(x, (int, float))] for k, v in hist.items()
                        if isinstance(v, list)} if isinstance(hist, dict) else {},
            "parts": {k: int(v) for k, v in parts.items() if isinstance(v, int) and MIN_PARTS <= v <= MAX_PARTS}
            if isinstance(parts, dict) else {}}


def next_parts(seconds: list[float], target: float = PART_TARGET, lo: int = MIN_PARTS, hi: int = MAX_PARTS) -> int:
    """How many parts a check should run in next, from its parts' seconds this run: the same while its longest part is
    within half and one and a half times `target` (so the count, part of each part's name and key, holds still), else
    enough for parts of about `target`."""
    n, longest = len(seconds), max(seconds)
    if longest > target * 1.5 or (longest < target / 2 and n > lo):
        return max(lo, min(hi, -(-int(sum(seconds)) // int(target))))
    return n


def _median(xs: list[float]) -> float:
    xs = sorted(xs)
    return (xs[(len(xs) - 1) // 2] + xs[len(xs) // 2]) / 2


def timing_warnings(results: list[Result], history: dict[str, list[float]], families: dict[str, str] | None = None,
                    nxt: dict[str, int] | None = None, budget: float = STEP_BUDGET) -> list[str]:
    """The steps that took longer than they should, each said with what to do. A whole run on a busy machine is slower
    in every step: each step is measured against the run's own pace (the median of its steps' times over their usual).
    `families`: each part's check; `nxt`: each check's count of parts for the next run."""
    families, nxt = families or {}, nxt or {}
    now = {f: sum(v == f for v in families.values()) for f in set(families.values())}
    ran = [r for r in results if r.status == "passed" and r.seconds >= 5]
    usual = {r.name: _median(history[r.name][-HISTORY:]) for r in ran if len(history.get(r.name, [])) >= 3}
    ratios = {n: r.seconds / usual[n] for r in ran if (n := r.name) in usual and usual[n] > 0}
    pace = run_pace(results, history)
    out = []
    for r in ran:
        fam = families.get(r.name, "")
        if r.seconds > budget * pace:
            if not fam:
                how = "run it in parts (--shard K/N, as saver_shows_check.py does) or cut its fixed waits"
            elif nxt.get(fam, now[fam]) > now[fam]:
                how = f"{fam} runs in {nxt[fam]} parts next time, not {now[fam]}"
            elif now[fam] >= MAX_PARTS:
                how = f"{fam} is in {now[fam]} parts already, the most: cut its fixed waits or its runs"
            else:
                how = f"its parts are uneven: {fam} deals its runs out in turn; give it a fairer split"
            out.append(f"{r.name}: {r.seconds:.0f} s, past the {budget:.0f} s one step may take"
                       + (f" (the machine ran at {pace:.1f}x its usual pace)" if pace > 1.05 else "") + f": {how}")
        # (twice its usual, two runs in a row: the main suite and HK Frontend's suites slow more than the waiting
        # browser checks on a busy machine -- 2026-11-02, the main suite 2-3x while another session ran its tests, at a
        # 1.0-1.2x pace; a busy machine passes, a check that grew stays grown. The Shows' that grew unseen was 3.4x)
        elif len(past := history.get(r.name, [])[-HISTORY:]) >= 4 and (base := _median(past[:-1])) > 0 \
                and r.seconds > 2 * pace * base and past[-1] > 1.5 * base and r.seconds - base * pace > 30:
            out.append(f"{r.name}: {r.seconds:.0f} s, {r.seconds / base / pace:.1f}x its usual {base:.0f} s two runs in a"
                       f" row (the other steps at {pace:.1f}x): what did the change add to it?")
    return out


def total_warnings(totals: dict[str, float], history: dict[str, list[float]], pace: float) -> list[str]:
    """A check in parts, or the whole run, that grew: each part stays short as the parts multiply, but the run waits
    on how many steps it may run at once (CI_JOBS), so their sum is what it takes. (Each total: all its steps' seconds.)"""
    out = []
    for name, secs in totals.items():
        past = history.get(name, [])[-HISTORY:]
        if len(past) >= 3 and (usual := _median(past)) > 0 and secs > 1.3 * usual * pace and secs - usual * pace > 60:
            out.append(f"{name}: {secs:.0f} s in all, {secs / usual / pace:.1f}x its usual {usual:.0f} s"
                       f"{f' (the machine at {pace:.1f}x)' if pace > 1.05 else ''}: what did this change add to it?")
    return out


def run_pace(results: list[Result], history: dict[str, list[float]]) -> float:
    """How much slower than usual the machine ran this run: the median of its steps' times over their usual, 1 at least."""
    ratios = [r.seconds / _median(history[r.name][-HISTORY:]) for r in results if r.status == "passed" and r.seconds >= 5
              and len(history.get(r.name, [])) >= 3 and _median(history[r.name][-HISTORY:]) > 0]
    return max(1.0, _median(ratios)) if len(ratios) >= 5 else 1.0


WHOLE = "(every full step)"                   # timing.json's history of whole full runs' total seconds


def keep_timing(chosen: list[Step], results: list[Result], path: Path, whole: bool = False) -> list[str]:
    """This run's timing warnings; and each passed step's time added to its history, each check that ran all its parts
    given its next count (next_parts) and its total kept, and, for a `whole` full run (every step run and passed), the
    run's total. Every worktree's runs share the file: one at a time, under a lock."""
    path.parent.mkdir(parents=True, exist_ok=True)
    by = {r.name: r for r in results}
    families = {s.name: s.family for s in chosen if s.family}
    with open(path.with_suffix(".lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        timing = read_timing(path)
        hist, parts = timing["history"], timing["parts"]
        totals = {WHOLE: sum(r.seconds for r in results)} if whole else {}
        for fam in sorted(set(families.values())):
            got = [by[n] for n, f in families.items() if f == fam and n in by]
            # (every part, each "KofN": a part run alone, with --only, says nothing of the whole)
            count = {int(m.group(1)) for n, f in families.items() if f == fam and (m := re.search(r"of(\d+)$", n))}
            if got and count == {len(got)} and all(r.status in ("passed", "failed") for r in got):
                parts[fam] = next_parts([r.seconds for r in got])
                if all(r.status == "passed" for r in got):
                    totals[fam] = sum(r.seconds for r in got)
        warnings = timing_warnings(results, hist, families, parts) + total_warnings(totals, hist, run_pace(results, hist))
        for name, secs in totals.items():
            hist[name] = (hist.get(name, []) + [round(secs, 1)])[-HISTORY:]
        for r in results:
            if r.status == "passed":
                hist[r.name] = (hist.get(r.name, []) + [round(r.seconds, 1)])[-HISTORY:]
        tmp = path.with_suffix(f".{os.getpid()}.tmp")
        tmp.write_text(json.dumps({"history": hist, "parts": parts}, indent=1, sort_keys=True) + "\n")
        tmp.replace(path)
    return warnings


def table(record: dict) -> str:
    rows = [f"{'step':<36} {'result':<9} {'time':>7}  note"]
    for s in record["steps"]:
        rows.append(f"{s['name']:<36} {s['status']:<9} {s['seconds']:>6.0f}s  {s['reason']}")
    counts = {k: sum(s["status"] == k for s in record["steps"]) for k in ("passed", "unchanged", "failed", "skipped")}
    rows.append(f"{record['tier']}: {counts['passed']} passed, "
                + (f"{counts['unchanged']} unchanged, " if counts["unchanged"] else "")
                + f"{counts['failed']} failed, {counts['skipped']} skipped on {record['commit'][:9]}"
                + (f" ({len(record['dirty'])} uncommitted)" if record["dirty"] else ""))
    if record.get("warnings"):
        rows += ["Slower than it should be:", *(f"  {w}" for w in record["warnings"])]
    near = near_size_limit()
    if near:
        rows += ["Near the size limit (a warning, not a failure: tests/test_file_sizes.py):", *(f"  {w}" for w in near)]
    return "\n".join(rows)


def near_size_limit() -> list[str]:
    """The files in the size rule's warning band (phase 24, A1), so a split is planned before the wall blocks a feature."""
    try:
        spec = importlib.util.spec_from_file_location("test_file_sizes", ROOT / "tests/test_file_sizes.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.near()
    except Exception as err:            # (a warning must never fail the run)
        return [f"(could not measure: {err})"]


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


# THIS CHECKOUT'S CODE, NOT THE VENV'S (2026-11-02). ~/.venvs/mantel installs the main checkout editable: in a worktree,
# a browser check (which puts tools/, tests/ and hosts/server/ on its path, never the root) imported the main
# checkout's hk_core, so it checked other code than the worktree's -- and a pass kept by the worktree's key would have
# vouched for it. A step run with Mantel's venv has this checkout's root and hosts/server first on PYTHONPATH.
def step_env(mantel: bool = False) -> dict:
    env = {k: v for k, v in os.environ.items() if k not in GIT_HOOK_VARS}
    if mantel:
        env["PYTHONPATH"] = os.pathsep.join([str(ROOT), str(ROOT / "hosts/server"), *filter(None, [env.get("PYTHONPATH")])])
    return env


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


def plan(chosen: list[Step], build: Build, store: Path, release: bool = False) -> str:
    """What a run would do with each step (--plan): run it, and why, or carry its pass."""
    keys = step_keys(chosen, build)
    carried = {k: v for k, v in carried_passes(keys, store).items() if not (release and is_motion(k) and not v.get("release"))}
    rows = []
    for s in chosen:
        if s.name in carried:
            why = f"unchanged: passed on {carried[s.name]['commit'][:9]} ({carried[s.name]['finished']})"
        elif release and is_motion(s.name):
            why = "runs: a motion check in a release's run"
        elif s.name in keys:
            why = "runs: its inputs are not as in any run it passed"
        elif s.inputs:
            why = "runs: one of its inputs is not committed"
        else:
            why = "runs: always"
        rows.append(f"{s.name:<36} {why}")
    rows.append(f"{len(chosen) - len(carried)} of {len(chosen)} steps would run")
    return "\n".join(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("tier", nargs="?", choices=("quick", "full", "versions"), default="quick")
    ap.add_argument("--only", action="append", help="run only the steps whose name contains this (repeatable); "
                                                     "they run even when unchanged")
    ap.add_argument("--all", action="store_true", help="run every step, even those whose inputs are unchanged")
    ap.add_argument("--release", action="store_true",
                    help="full: a release's run: the motion checks too, unless they passed in a release run as they are")
    ap.add_argument("--list", action="store_true", help="list the steps of each tier")
    ap.add_argument("--plan", action="store_true", help="say which steps would run and which are unchanged, run none")
    ap.add_argument("--skip-passed", action="store_true",
                    help="quick: when this clean tree already passed quick or full, check only the commit messages")
    ap.add_argument("--install-hooks", action="store_true", help="install the pre-commit and pre-push hooks")
    args = ap.parse_args(argv)
    if args.install_hooks:
        for path in install_hooks():
            print(f"installed {path}")
        return 0
    build = Build()
    timing = store_path().with_name("timing.json")
    all_steps = steps(build, read_timing(timing)["parts"])
    if args.list:
        for s in all_steps:
            print(f"{s.tier:<8} {s.name}" + ("  (also in versions)" if s.versions and s.tier != "versions" else ""))
        return 0
    chosen = select(all_steps, args.tier, args.only)
    if not chosen:
        print(f"no step matches {args.only}", file=sys.stderr)
        return 2
    store, only = store_path(), args.only
    if args.release and args.tier != "full":
        print("--release is for a full run", file=sys.stderr)
        return 2
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

    if args.plan:
        try:
            print(plan(chosen, build, step_store_path(), args.release))
        finally:
            build.clean()
        return 0
    print(f"Mantel checks, {args.tier}: {len(chosen)} steps")
    try:
        record = run(chosen, args.tier, after=after, only=only, store=store, step_store=step_store_path(),
                     reuse=not (args.all or args.only), build=build, shared_times=store.with_name("step-times.json"),
                     timing=timing, release=args.release)
    finally:
        build.clean()
    print(table(record))
    return 0 if record["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
