#!/usr/bin/env python3
"""Type-check the web app's JavaScript with TypeScript (phase 18, Part C; docs/phase18/CODE-HEALTH.md).

    tools/typecheck/check.py              # tsc on every file that starts with // @ts-check (the ci.py step types-js)
    tools/typecheck/check.py --measure    # every file checked, the errors counted per file (nothing changes)
    tools/typecheck/check.py --baseline   # the same, written to tools/typecheck/baseline.json
    tools/typecheck/check.py --strict     # tsconfig.strict.json (noImplicitAny; the pure logic files), every listed file checked, counted
    tools/typecheck/check.py --globals    # regenerate types/globals.d.ts from the window.hk*/mantel* names
    tools/typecheck/check.py --install    # npm ci in tools/typecheck (TypeScript, pinned)

tsconfig.strict.json (decision 8) lists the pure logic files that also take noImplicitAny; it is not part of the default
run until a file in it is clean (hk-settings-model.js, the first, is not yet: see --strict for the count).

tsconfig.json reads every file under web/ and hosts/ha/frontend/ so names resolve, with checkJs off: only a file
that opts in with ``// @ts-check`` is checked. TypeScript lives in its own folder (decision 7): the Docker image's
esbuild stage and tools/package.json don't change. Node: $NODE, else node on the PATH.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
TSC = HERE / "node_modules/typescript/bin/tsc"
BASELINE = HERE / "baseline.json"
GLOBALS = HERE / "types/globals.d.ts"
SOURCES = ("web", "hosts/ha/frontend")
# // @ts-check counts only in the comments that open a file (as tsc reads it, however long the banner)
LEADING_TS_CHECK = re.compile(r"^(?:\ufeff)?(?:\s*(?://[^\n]*\n|/\*.*?\*/))*?\s*//\s*@ts-check\b", re.S)
ERROR = re.compile(r"^(?P<file>[^(\s][^(]*)\((?P<line>\d+),(?P<col>\d+)\): error (?P<code>TS\d+): (?P<text>.*)$")


def node() -> str:
    found = os.environ.get("NODE") or shutil.which("node")
    if not found:
        raise SystemExit("no node: set NODE or put node on the PATH")
    return found


def stale() -> str | None:
    """Why tools/typecheck/node_modules isn't what package.json pins (None: it is)."""
    want = json.loads((HERE / "package.json").read_text())["devDependencies"]["typescript"]
    got = HERE / "node_modules/typescript/package.json"
    if not got.is_file() or not TSC.is_file():
        return "TypeScript is not installed"
    have = json.loads(got.read_text()).get("version")
    return None if have == want else f"TypeScript {have} installed, {want} pinned"


def install() -> int:
    """npm ci when what is installed isn't the pin. As tools/build_tools.py does on the SMB share: the old folder is
    renamed aside first (the share can't always delete it in place), and npm ci installs into an empty place."""
    if stale() is None:
        return 0
    modules = HERE / "node_modules"
    if modules.exists():
        aside = ROOT / ".ci/old-typecheck-node_modules" / str(int(time.time() * 1000))
        aside.parent.mkdir(parents=True, exist_ok=True)
        modules.rename(aside)
        shutil.rmtree(aside, ignore_errors=True)
    return subprocess.run(["npm", "ci", "--prefix", str(HERE), "--ignore-scripts", "--no-audit", "--no-fund",
                           "--loglevel=error"]).returncode


def tsc(project: Path) -> list[dict]:
    """tsc's errors for ``project``, each {file (from the repository), line, code, text}."""
    if install() != 0 or stale() is not None:
        raise SystemExit(f"npm ci in tools/typecheck failed: {stale()}")
    run = subprocess.run([node(), str(TSC), "-p", str(project), "--pretty", "false"], capture_output=True,
                         text=True, cwd=HERE)
    out = []
    for line in run.stdout.splitlines():
        m = ERROR.match(line)
        if m:
            path = (HERE / m["file"]).resolve()
            out.append({"file": str(path.relative_to(ROOT)) if path.is_relative_to(ROOT) else m["file"],
                        "line": int(m["line"]), "code": m["code"], "text": m["text"]})
    if run.returncode not in (0, 2) or (run.returncode == 2 and not out):
        raise SystemExit(f"tsc failed:\n{run.stdout}{run.stderr}")
    return out


def checked_files() -> list[str]:
    """The files that opt in (// @ts-check on one of their first lines)."""
    out = []
    for base in SOURCES:
        for path in sorted((ROOT / base).rglob("*.js")):
            if "node_modules" in path.parts:
                continue
            if LEADING_TS_CHECK.match(path.read_text(errors="replace")):
                out.append(str(path.relative_to(ROOT)))
    return out


def all_files() -> list[str]:
    return [str(p.relative_to(ROOT)) for base in SOURCES for p in sorted((ROOT / base).rglob("*.js"))
            if "node_modules" not in p.parts]


def measure() -> dict[str, int]:
    """Every file checked (a scratch config with checkJs on): errors per file, every file listed."""
    with tempfile.TemporaryDirectory() as tmp:
        cfg = Path(tmp) / "tsconfig.json"
        cfg.write_text(json.dumps({"extends": str(HERE / "tsconfig.json"), "compilerOptions": {"checkJs": True},
                                   "include": [str(ROOT / s / "**/*.js") for s in SOURCES]
                                   + [str(HERE / "types/*.d.ts")]}))
        errors = tsc(cfg)
    counts = {f: 0 for f in all_files()}
    for e in errors:
        counts[e["file"]] = counts.get(e["file"], 0) + 1
    return dict(sorted(counts.items()))


def measure_strict() -> dict[str, int]:
    """tsconfig.strict.json's files, checked whether or not they opt in (a scratch config with checkJs on): errors per file."""
    strict = HERE / "tsconfig.strict.json"
    files = json.loads(strict.read_text())["files"]
    with tempfile.TemporaryDirectory() as tmp:
        cfg = Path(tmp) / "tsconfig.json"
        cfg.write_text(json.dumps({"extends": str(strict), "compilerOptions": {"checkJs": True}}))
        errors = tsc(cfg)
    counts = {str((HERE / f).resolve().relative_to(ROOT)): 0 for f in files}
    for e in errors:
        if e["file"] in counts:
            counts[e["file"]] += 1
    return counts


def globals_text() -> str:
    names: set[str] = set()
    for f in all_files():
        names |= set(re.findall(r"\bwindow\.((?:hk|mantel|HK|Mantel)[A-Za-z0-9_]*)", (ROOT / f).read_text()))
    lines = ["// The names the web app shares through window (phase 18, C0): typed any at first, so tsc resolves them;",
             "// a typed part narrows its own. Regenerate with tools/typecheck/check.py --globals.",
             "export {};", "declare global {", "  interface Window {"]
    lines += [f"    {n}: any;" for n in sorted(names)]
    lines += ["    [key: string]: any;", "  }", "}", ""]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--measure", action="store_true")
    ap.add_argument("--baseline", action="store_true")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--globals", action="store_true")
    ap.add_argument("--install", action="store_true")
    args = ap.parse_args(argv)
    if args.install:
        return install()
    if args.globals:
        GLOBALS.write_text(globals_text())
        print(f"wrote {GLOBALS.relative_to(ROOT)}")
        return 0
    if args.strict:
        counts = measure_strict()
        for f, c in counts.items():
            print(f"{c:5d}  {f}")
        return 0
    if args.measure or args.baseline:
        counts = measure()
        total = sum(counts.values())
        if args.baseline:
            BASELINE.write_text(json.dumps({"total": total, "files": counts}, indent=1) + "\n")
            print(f"wrote {BASELINE.relative_to(ROOT)}: {total} errors in {sum(1 for c in counts.values() if c)} of "
                  f"{len(counts)} files")
        else:
            for f, c in sorted(counts.items(), key=lambda kv: -kv[1]):
                if c:
                    print(f"{c:5d}  {f}")
            print(f"{total} errors in {sum(1 for c in counts.values() if c)} of {len(counts)} files")
        return 0
    errors = [e for e in tsc(HERE / "tsconfig.json")]
    for e in errors:
        print(f"{e['file']}:{e['line']}: {e['code']} {e['text']}")
    print(f"tsc: {len(checked_files())} files checked, {len(errors)} errors")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
