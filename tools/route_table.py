#!/usr/bin/env python3
"""Mantel Server's route table (phase 18, Part A; hosts/server/mantel_server/route_table.py).

    tools/route_table.py                 # the rules each route breaks, under every combination of the options
    tools/route_table.py --write         # regenerate docs/development/Routes.md and tests/fixtures/route_table.lock.json
    tools/route_table.py --check         # exit 1 when either is stale (tests/test_route_table.py does the same)
    tools/route_table.py --diff REV      # which routes and columns differ from REV's lock

The app is built with fakes (nothing connects anywhere; commands off, Rule 3) once for each combination of the
options that add routes (COMBOS), and the tables joined: a route only one combination adds is in the table too.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "hosts/server"), str(ROOT)]
LOCK = ROOT / "tests/fixtures/route_table.lock.json"
DOC = ROOT / "docs/development/Routes.md"

# every option that adds or changes routes, each alone and all together (decision 2: a route only one combination
# adds must not be able to surprise a house)
COMBOS: dict[str, dict] = {
    "plain": {},
    "ingress": {"ingress": True, "ingress_peers": ()},
    "connect": {"connect": True, "connect_port": 0, "connect_listen": "127.0.0.1"},
    "direct_tls": {"direct_tls": "acme", "direct_port": 0, "direct_hosts": ("mantel.example.test",)},
    "cf_access": {"cf_access_team": "example-team", "cf_access_aud": ("a" * 64,)},
    "commands": {"commands_enabled": True},
    "music_assistant": {"ma_url": "http://ma.example.test:8095"},
    "go2rtc": {"go2rtc_url": "http://go2rtc.example.test:1984"},       # Live TV, direct cameras and UniFi Protect
    "everything": {"go2rtc_url": "http://go2rtc.example.test:1984", "ingress": True, "ingress_peers": (), "connect": True, "connect_port": 0,
                   "connect_listen": "127.0.0.1", "direct_tls": "acme", "direct_port": 0,
                   "direct_hosts": ("mantel.example.test",), "cf_access_team": "example-team",
                   "cf_access_aud": ("a" * 64,), "commands_enabled": True,
                   "ma_url": "http://ma.example.test:8095"},
}


def build(options: dict, tmp: Path, strict: bool = False):
    """The app under one combination, its table installed without refusing (the caller reports what it breaks)."""
    from mantel_server import route_table
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.store import Store
    cfg = Config(data_dir=tmp / "data", secrets_dir=tmp / "secrets", port=0, **options)
    store = Store(cfg.data_dir / "mantel.db")
    install = route_table.install
    route_table.install = lambda app, strict=True, report=None: install(app, strict=strict and False, report=report)
    try:
        app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: 1_000_000.0)
    finally:
        route_table.install = install
        store.db.close()
    return app


def tables(strict: bool = False) -> tuple[dict, dict[str, list[str]]]:
    """The joined lock of every combination, and each combination's problems."""
    import logging
    from mantel_server import route_table
    logging.getLogger("mantel.route_table").setLevel(logging.ERROR)
    from mantel_server import socket_reads
    joined: dict = {}
    found: dict[str, list[str]] = {}
    never: set[str] | None = None
    for name, options in COMBOS.items():
        with tempfile.TemporaryDirectory() as tmp:
            app = build(options, Path(tmp))
        rows = app[route_table.APP_KEY]
        found[name] = route_table.problems(app, rows, route_table.all_tools(), route_table.public_paths(app)) \
            + socket_reads.problems(app)
        never = set(socket_reads.stale(app)) if never is None else never & set(socket_reads.stale(app))
        for key, cols in {**route_table.lock(rows), **socket_reads.lock_rows(app)}.items():
            joined.setdefault(key, cols)
    for t in sorted(never or ()):
        found["everything"].append(f"R13 READ {t}: declared in socket_reads.py, and no combination registers it")
    return dict(sorted(joined.items(), key=lambda kv: (kv[0].split(" ", 1)[1], kv[0]))), found


def render() -> tuple[str, str, dict[str, list[str]]]:
    from mantel_server import route_table
    table, found = tables()
    return json.dumps(table, indent=1, sort_keys=True) + "\n", route_table.markdown(table) + "\n", found


def diff(old: dict, new: dict) -> list[str]:
    out = []
    for key in sorted(set(old) | set(new)):
        if key not in old:
            out.append(f"+ {key}")
        elif key not in new:
            out.append(f"- {key}")
        else:
            for col in sorted(set(old[key]) | set(new[key])):
                if old[key].get(col) != new[key].get(col):
                    out.append(f"~ {key} {col}: {old[key].get(col)!r} -> {new[key].get(col)!r}")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--diff", metavar="REV")
    args = ap.parse_args(argv)
    lock_text, doc_text, found = render()
    if args.write:
        LOCK.write_text(lock_text)
        DOC.write_text(doc_text)
        print(f"wrote {LOCK.relative_to(ROOT)} and {DOC.relative_to(ROOT)} ({len(json.loads(lock_text))} routes)")
        return 0
    if args.check:
        stale = [p.relative_to(ROOT) for p, t in ((LOCK, lock_text), (DOC, doc_text))
                 if not p.is_file() or p.read_text() != t]
        if stale:
            print(f"stale: {', '.join(map(str, stale))}: run tools/route_table.py --write")
            return 1
        return 0
    if args.diff:
        old = subprocess.run(["git", "show", f"{args.diff}:{LOCK.relative_to(ROOT)}"], cwd=ROOT,
                             capture_output=True, text=True)
        lines = diff(json.loads(old.stdout) if old.returncode == 0 else {}, json.loads(lock_text))
        print("\n".join(lines))
        return 0
    status = 0
    every = sorted({p for ps in found.values() for p in ps})
    for line in every:
        names = [n for n, ps in found.items() if line in ps]
        print(line if len(names) == len(found) else f"{line}   [{', '.join(names)}]")
        status = 1
    print(f"{len(json.loads(lock_text))} routes; {len(every)} problems")
    return status


if __name__ == "__main__":
    sys.exit(main())
