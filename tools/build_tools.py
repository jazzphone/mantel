#!/usr/bin/env python3
"""Install the build tools (tools/package.json: esbuild, pinned) for tools/ci.py's build-tools step.

    python tools/build_tools.py          # npm ci --prefix tools, unless tools/node_modules already matches the lock

On the SMB checkout `npm ci` sometimes cannot delete tools/node_modules in place: the share keeps esbuild's
binary open (a `.smbdelete…` file, EBUSY) after an earlier step ran it, or the rmdir finds the folder not yet
empty (ENOTEMPTY), and esbuild is then missing for the rest of the run (2026-10-31). So:

- when tools/node_modules already holds exactly what tools/package-lock.json pins (npm's own record of it,
  node_modules/.package-lock.json, agrees with the lock, and the esbuild binary reports the pinned version),
  nothing is installed;
- otherwise the old folder is renamed into .ci/old-node_modules/ (a rename the share allows while a file is
  held) and `npm ci` installs into an empty place. Its failure is the step's failure. Old folders are removed
  on a later run, when the share has let go of them.

Stdlib only, like the other tools.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
MODULES = TOOLS / "node_modules"
ASIDE = ROOT / ".ci/old-node_modules"
NPM_CI = ["npm", "ci", "--prefix", str(TOOLS), "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"]


def read(path: Path) -> dict | None:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def stale() -> str | None:
    """Why tools/node_modules must be installed again, or None when it matches the lock."""
    pkg, lock = read(TOOLS / "package.json"), read(TOOLS / "package-lock.json")
    if not pkg or not lock:
        return "no package.json or package-lock.json"
    root = lock.get("packages", {}).get("", {})
    for key in ("dependencies", "devDependencies"):
        if pkg.get(key, {}) != root.get(key, {}):
            return f"package.json's {key} differ from the lock"    # npm ci says what is wrong
    hidden = read(MODULES / ".package-lock.json")
    if not hidden:
        return "nothing installed"
    want = {k: v for k, v in lock["packages"].items() if k}
    have = hidden.get("packages", {})
    for key, entry in have.items():
        if key not in want or (want[key].get("version"), want[key].get("integrity")) != (
                entry.get("version"), entry.get("integrity")):
            return f"{key} is not what the lock pins"
        if not (TOOLS / key / "package.json").exists():
            return f"{key} is missing"
    for key, entry in want.items():
        if key not in have and not entry.get("optional"):
            return f"{key} is not installed"
    version = want.get("node_modules/esbuild", {}).get("version")
    if version:
        bins = sorted(MODULES.glob("@esbuild/*/bin/esbuild"))
        try:
            got = [subprocess.run([str(b), "--version"], capture_output=True, text=True, timeout=30).stdout.strip()
                   for b in bins]
        except (OSError, subprocess.TimeoutExpired):
            got = []
        if version not in got:
            return f"no esbuild {version} binary"
    return None


def sweep():
    """Remove the folders earlier runs set aside; one the share still holds waits for a later run."""
    for old in sorted(ASIDE.glob("*")) if ASIDE.is_dir() else []:
        shutil.rmtree(old, ignore_errors=True)


def main() -> int:
    sweep()
    reason = stale()
    if reason is None:
        print("tools/node_modules matches tools/package-lock.json")
        return 0
    print(f"installing: {reason}", flush=True)
    if MODULES.exists() or MODULES.is_symlink():
        ASIDE.mkdir(parents=True, exist_ok=True)
        MODULES.rename(ASIDE / f"{time.strftime('%Y%m%d-%H%M%S')}-{time.monotonic_ns()}")
    r = subprocess.run(NPM_CI, stdin=subprocess.DEVNULL)
    if r.returncode:
        return r.returncode
    reason = stale()
    if reason:
        print(f"npm ci passed but tools/node_modules is not what the lock pins: {reason}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
