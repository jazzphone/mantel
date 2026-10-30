#!/usr/bin/env python3
"""Mantel's checks, run on this Mac instead of GitHub Actions (docs/development/Building-and-Testing.md, "Local
checks"). One runner, one table, one record:

    tools/ci.py quick            # the main suite and the release checks: what the pre-push hook runs (~4 min)
    tools/ci.py full             # also the HA build, HK Frontend's suites, the headless checks, Edit mode's
                                 # browser check (PLAYWRIGHT_PATH and NODE), the Caddy image
    tools/ci.py full --only js   # only the steps whose name contains "js"
    tools/ci.py --list           # the steps of each tier
    tools/ci.py --install-hooks  # pre-commit: private words; pre-push: quick

Every step ends passed, failed or skipped, and a skip always says why: a skipped step is never counted as a pass.
The result goes to .ci/last-run.json (git ignores .ci/) with the commit it ran on, and a failed step's output to
.ci/<step>.log. The exit status is 0 only when no step failed.
"""
from __future__ import annotations

import argparse
import datetime
import json
import os
import shutil
import subprocess
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


@dataclass
class Result:
    name: str
    status: str                              # passed | failed | skipped
    seconds: float = 0.0
    reason: str = ""


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
        # checks what it makes (2026-10-29)
        Step("build-tools", ["npm", "ci", "--prefix", "tools", "--ignore-scripts", "--no-audit", "--no-fund",
                             "--loglevel=error"], skip=lambda: None if shutil.which("npm") else "no npm (Node.js)",
             timeout=300),
        Step("main-suite", [py, "-m", "pytest", "-q", "-p", "no:cacheprovider"], env=private_env()),
        Step("check-links", [py, "tools/check_links.py"], timeout=300),
        Step("check-version", [py, "tools/check_version.py"], timeout=300),
        Step("package-check", [py, "tools/package_check.py", "--release"], timeout=600),
        # what is committed (what a push sends), and the messages of the commits origin/main hasn't got
        Step("private-words", lambda: [py, "tools/check_private.py", "--rev", "HEAD",
                                       *([] if no_upstream() else ["--messages", "origin/main..HEAD"])],
             skip=no_private_words, env=private_env(), timeout=300),
        Step("ha-build", lambda: [py, "tools/build_ha.py", str(build.ha)], tier="full", timeout=600),
        Step("hk-frontend-py", [str(HA_PY), "-m", "pytest", "-q", "-p", "no:cacheprovider"], tier="full",
             skip=lambda: build.missing() or (None if HA_PY.exists() else f"no harness venv at {HA_PY.parent.parent}"),
             cwd=lambda: build.ha / "tests/py"),
        Step("hk-frontend-js", lambda: ["sh", str(build.ha / "tests/run")], tier="full",
             skip=lambda: build.missing() or (None if JSC.exists() else "no JavaScriptCore (macOS only)")),
    ]
    out += [Step(f"headless-{n}", [py, f"tools/headless/{n}.py"], tier="full", timeout=600,
                 skip=lambda: None if chrome() else "no Chrome or Chromium (set CHROME)")
            for n in HEADLESS]     # one at a time: each uses a fixed DevTools port
    # Edit mode in Chromium (a finger) and WebKit (a mouse), at a tablet's and a phone's size (Playwright's own
    # browsers, no fixed port)
    out.append(Step("edit-mode-check", [py, "tools/headless/edit_mode_check.py"], tier="full", timeout=1200,
                    skip=playwright_missing))
    # the page beside the iPhone Duo's side strip, in WebKit (its insets stood in; 2026-10-30)
    out.append(Step("side-strip-check", [py, "tools/headless/side_strip_check.py"], tier="full", timeout=600,
                    skip=playwright_missing))
    out.append(Step("caddy-image", ["sh", "-c",
                    f"docker build -q -f packaging/docker/caddy.Dockerfile -t {CADDY_IMAGE} packaging/docker && "
                    f'"{py}" -m pytest -q -p no:cacheprovider tests/test_packaging.py -k caddy_image'],
                    tier="full", skip=docker_down, env={"MANTEL_CADDY_TEST_IMAGE": CADDY_IMAGE}))
    return out


def select(all_steps: list[Step], tier: str, only: list[str] | None = None) -> list[Step]:
    chosen = [s for s in all_steps if tier == "full" or s.tier == "quick"]
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


def say(text: str):
    print(text, flush=True)


def run(chosen: list[Step], tier: str, record_dir: Path = RECORD_DIR, echo: Callable[[str], None] = say,
        after: Callable[[Step, Result], None] | None = None) -> dict:
    record_dir.mkdir(exist_ok=True)
    started = datetime.datetime.now(datetime.timezone.utc)
    results = []
    for step in chosen:
        echo(f"  {step.name} ...")
        res = run_step(step, record_dir)
        results.append(res)
        if after:
            after(step, res)
    record = {
        "tier": tier,
        "commit": git("rev-parse", "HEAD").strip(),
        "dirty": [ln[3:] for ln in git("status", "--porcelain").splitlines()],
        "started": started.isoformat(timespec="seconds"),
        "finished": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "ok": not any(r.status == "failed" for r in results),
        "steps": [vars(r) for r in results],
    }
    (record_dir / "last-run.json").write_text(json.dumps(record, indent=2) + "\n")
    return record


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
# installed by tools/ci.py --install-hooks: the quick checks before every push (git push --no-verify skips them)
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
    ap.add_argument("tier", nargs="?", choices=("quick", "full"), default="quick")
    ap.add_argument("--only", action="append", help="run only the steps whose name contains this (repeatable)")
    ap.add_argument("--list", action="store_true", help="list the steps of each tier")
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
            print(f"{s.tier:<6} {s.name}")
        return 0
    chosen = select(all_steps, args.tier, args.only)
    if not chosen:
        print(f"no step matches {args.only}", file=sys.stderr)
        return 2

    def after(step: Step, res: Result):
        if step.name == "ha-build":
            build.ok = res.status == "passed"

    print(f"Mantel checks, {args.tier}: {len(chosen)} steps")
    try:
        record = run(chosen, args.tier, after=after)
    finally:
        build.clean()
    print(table(record))
    return 0 if record["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
