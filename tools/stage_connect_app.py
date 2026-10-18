#!/usr/bin/env python3
"""Assemble the Mantel Connect Home Assistant App folder (a LOCAL App) from this repository. docs/phase3/CONNECT.md.

    python tools/stage_connect_app.py --dry-run              # list what would be staged + the private-content scan
    python tools/stage_connect_app.py TARGET                 # write a new folder (TARGET must not exist)
    python tools/stage_connect_app.py TARGET --replace       # replace a folder this tool staged before

The folder is what HA's Supervisor builds: packaging/connect-app/ (config.yaml, Dockerfile, DOCS.md,
README.md, requirements.txt, translations/) plus icon.png (the Mantel App's) and app/mantel_connect/: the
Connect App's code and the pairing protocol it shares with Mantel Server. Nothing of Mantel Server itself.

The same rules as tools/stage_ha_app.py, whose scan it reuses: before anything is written the whole plan is
scanned and staging stops on any finding (secret-shaped text, private-network addresses beyond the allowed
few, key/token/database files). It never writes outside TARGET, never inside the repository, and with
--replace it refuses a folder that was not staged by THIS tool.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_SRC = ROOT / "packaging/connect-app"
APP_FILES = ("config.yaml", "Dockerfile", "DOCS.md", "README.md", "requirements.txt", "translations/en.yaml")
ICON = ROOT / "packaging/ha-app/icon.png"
CODE = ROOT / "hosts/server/mantel_connect"
CODE_FILES = ("__init__.py", "__main__.py", "app.py", "pairing.py", "pki.py", "protocol.py")
TOOL = "tools/stage_connect_app.py"


def _base():
    spec = importlib.util.spec_from_file_location("mantel_stage_ha_app", ROOT / "tools/stage_ha_app.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


base = _base()
MARKER = base.MARKER


def plan() -> list[tuple[Path, str]]:
    """(source file, path inside the App folder) for every copied file."""
    pairs = [(APP_SRC / name, name) for name in APP_FILES]
    pairs.append((ICON, "icon.png"))
    pairs += [(CODE / name, f"app/mantel_connect/{name}") for name in CODE_FILES]
    return pairs


def scan(pairs):
    return base.scan(pairs)


def write(target: Path, pairs: list[tuple[Path, str]]) -> dict:
    """Copy into a new sibling temp folder, stamp it, then move it into place."""
    target = target.resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=".mantel-stage-", dir=target.parent))
    try:
        for src, dest in pairs:
            out = tmp / dest
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, out)
        digest = hashlib.sha256()
        for p in sorted(tmp.rglob("*")):
            if p.is_file():
                digest.update(p.relative_to(tmp).as_posix().encode() + b"\0" + p.read_bytes())
        info = {"tool": TOOL, "commit": base._commit(), "files": sum(1 for p in tmp.rglob("*") if p.is_file()),
                "sha256": digest.hexdigest()}
        (tmp / MARKER).write_text(json.dumps(info, indent=1) + "\n")
        old = None
        if target.exists():
            old = target.parent / f".{target.name}.replaced-{os.getpid()}"
            target.rename(old)
        tmp.rename(target)
        if old is not None:
            shutil.rmtree(old)
        return info
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def staged_by_this_tool(folder: Path) -> bool:
    try:
        return json.loads((folder / MARKER).read_text()).get("tool") == TOOL
    except (OSError, ValueError):
        return False


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("target", nargs="?", type=Path, help="the App folder to create (e.g. <local apps share>/mantel_connect)")
    p.add_argument("--dry-run", action="store_true", help="list and scan only; write nothing")
    p.add_argument("--replace", action="store_true", help="replace a folder this tool staged before")
    p.add_argument("--list", action="store_true", help="with --dry-run: print every file")
    a = p.parse_args(argv)
    if not a.dry_run and a.target is None:
        p.error("give a TARGET folder, or --dry-run")
    pairs = plan()
    hits = scan(pairs)
    if a.dry_run:
        total = sum(src.stat().st_size for src, _ in pairs)
        print(f"Mantel Connect App: {len(pairs)} files, {total / 1e3:.0f} kB (+ {MARKER})")
        if a.list:
            for _, dest in pairs:
                print("   ", dest)
        if a.target is not None:
            print(f"would write: {a.target.resolve()}")
    if hits:
        print(f"PRIVATE-CONTENT SCAN: {len(hits)} finding(s); nothing written", file=sys.stderr)
        for h in hits[:50]:
            print("  " + h, file=sys.stderr)
        return 1
    print("private-content scan: clean (no secrets, no private addresses beyond the allowed few, no key/token/database files)")
    if a.dry_run:
        return 0
    target = a.target.resolve()
    try:
        target.relative_to(ROOT)
        print("refusing to stage inside the repository", file=sys.stderr)
        return 2
    except ValueError:
        pass
    if target.exists():
        if not a.replace:
            print(f"{target} exists; pass --replace to replace a folder this tool staged", file=sys.stderr)
            return 2
        if not staged_by_this_tool(target):
            print(f"{target} was not staged by {TOOL} ({MARKER} missing or from another tool); refusing to replace it",
                  file=sys.stderr)
            return 2
    info = write(target, pairs)
    print(f"staged {info['files']} files into {target} (commit {info['commit']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
