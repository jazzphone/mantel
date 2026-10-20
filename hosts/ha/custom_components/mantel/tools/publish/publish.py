"""BUILD MANTEL LINK'S PUBLIC REPOSITORY from this component (decision M1: a public HACS repository, built from the
Mantel repository the way HK Frontend's is). LOCAL ONLY: it writes a folder and, with --commit, commits there. It
never creates a GitHub repository and never pushes: publishing is the maintainer's step (docs/phase9/MANTEL-LINK.md 9.9).

    custom_components/mantel/   what HACS installs (no tests, tools, docs)
    tests/  docs/               beside it
    README.md                   the component's README
    LICENSE  hacs.json  .gitignore  .github/   tools/publish/root/ (this builder itself is not published)

Every published file is scanned for private data with HK Frontend's rules (tools/publish/publish.py in HK Frontend:
private network addresses, keys and tokens, plus HK_PRIVATE); one hit and nothing is written. Then Mantel Link's
suite runs IN the built repository, so the published layout is proven.

    python3 tools/publish/publish.py REPO_DIR [--commit "message"] [--no-tests]
    python3 tools/publish/publish.py --scan
"""
from __future__ import annotations

import argparse
import importlib.util
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
COMPONENT = os.path.dirname(os.path.dirname(HERE))
BESIDE = ("tests", "docs")
SKIP = {"__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".DS_Store"}
HK_PUBLISHER = os.path.join(os.path.dirname(COMPONENT), "hk_frontend", "tools", "publish", "publish.py")


def hk_publisher():
    """HK Frontend's publisher: its scan rules, its build and its staging, shared."""
    spec = importlib.util.spec_from_file_location("hk_publisher", HK_PUBLISHER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def plan() -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for d, dirs, files in os.walk(COMPONENT):
        dirs[:] = sorted(x for x in dirs if x not in SKIP)
        for f in sorted(files):
            if f in SKIP or f.endswith((".pyc", ".pyo")):
                continue
            src = os.path.join(d, f)
            rel = os.path.relpath(src, COMPONENT)
            top = rel.split(os.sep, 1)[0]
            if top == "tools":
                if rel.startswith(os.path.join("tools", "publish", "root") + os.sep):
                    out.append((src, os.path.relpath(src, os.path.join(HERE, "root"))))
                continue          # this builder needs the Mantel repository: it stays there
            if top in BESIDE:
                out.append((src, rel))
            elif rel == "README.md":
                out.append((src, "README.md"))
            else:
                out.append((src, os.path.join("custom_components", "mantel", rel)))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("repo", nargs="?")
    ap.add_argument("--scan", action="store_true")
    ap.add_argument("--commit")
    ap.add_argument("--no-tests", action="store_true")
    a = ap.parse_args()
    hk = hk_publisher()
    pairs = plan()
    hits = hk.scan(pairs)
    if a.scan:
        print("\n".join(hits) if hits else "clean")
        return 2 if hits else 0
    if not a.repo:
        ap.error("REPO_DIR is required")
    if hits:
        print("PRIVATE DATA -- nothing was written:")
        print("\n".join(hits[:60]))
        return 2
    os.makedirs(a.repo, exist_ok=True)
    hk.build(a.repo, pairs)
    print(f"built {len(pairs)} files in {a.repo}")
    if not a.no_tests:
        pytest = os.path.expanduser("~/.venvs/hk-ha-test/bin/pytest")
        env = {k: v for k, v in os.environ.items() if k not in ("MANTEL_ROOT", "HK_FRONTEND_COMPONENT", "PYTHONPATH")}
        if subprocess.call([pytest, "-q", "-p", "no:cacheprovider"], cwd=os.path.join(a.repo, "tests", "py"),
                           env=env) != 0:
            return 1
    if a.commit:
        if not os.path.isdir(os.path.join(a.repo, ".git")):
            hk.run(["git", "init", "-b", "main"], a.repo)
        hk.stage(a.repo)
        if hk.run(["git", *hk.AS_PUBLISHER, "commit", "-q", "-m", a.commit], a.repo) != 0:
            return 1
    print("Not pushed: creating and pushing the public repository is the maintainer's step.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
