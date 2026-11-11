#!/usr/bin/env python3
"""Python's type and lint ratchets (phase 18, Part C; docs/phase18/CODE-HEALTH.md C3 and C4).

    tools/typecheck/py_check.py              # mypy on hk_core, the route table's modules strict, ruff's pyflakes rules
    tools/typecheck/py_check.py --baseline   # write the per-file counts (mypy_baseline.json, ruff_baseline.json)

Each file's count of mypy errors (hk_core) and of ruff findings (the pyflakes rules: undefined names, unused imports,
redefinitions; hk_core, hosts/server, tools, tests) may only fall: a file whose count went up, or a new file with any,
fails. The route table's modules (STRICT) have none under ``mypy --strict``. The ci.py step is types-py.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
MYPY_BASELINE = HERE / "mypy_baseline.json"
RUFF_BASELINE = HERE / "ruff_baseline.json"
RUFF_PATHS = ("hk_core", "hosts/server", "tools", "tests")
STRICT = ("mantel_server/route_table.py", "mantel_server/identity/guards.py", "mantel_server/live.py",
          "mantel_server/socket_reads.py", "mantel_server/mcp_parity.py")
LINE = re.compile(r"^(?P<file>[^:\s]+\.py):\d+(?::\d+)?: (?:error|[A-Z]+\d+)")


def run(cmd: list[str], cwd: Path = ROOT) -> str:
    got = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return got.stdout + got.stderr


def counts(text: str, prefix: str = "") -> dict[str, int]:
    c: Counter[str] = Counter()
    for line in text.splitlines():
        m = LINE.match(line)
        if m:
            c[prefix + m["file"]] += 1
    return dict(sorted(c.items()))


def mypy() -> tuple[dict[str, int], str]:
    out = run([sys.executable, "-m", "mypy", "--no-error-summary"])
    return counts(out), out


def mypy_strict() -> str:
    cache = str(ROOT / ".ci/mypy_cache_strict")
    out = run([sys.executable, "-m", "mypy", "--strict", "--follow-imports=silent", "--ignore-missing-imports",
               "--no-error-summary", "--cache-dir", cache, *STRICT], cwd=ROOT / "hosts/server")
    return "\n".join(l for l in out.splitlines() if LINE.match(l))


def ruff() -> tuple[dict[str, int], str]:
    out = run([sys.executable, "-m", "ruff", "check", "--output-format", "concise", "--no-fix", *RUFF_PATHS])
    return counts(out), out


def worse(now: dict[str, int], base: dict[str, int]) -> list[str]:
    return [f"{f}: {n} (was {base.get(f, 0)})" for f, n in sorted(now.items()) if n > base.get(f, 0)]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--baseline", action="store_true")
    args = ap.parse_args(argv)
    (m, mout), (r, rout) = mypy(), ruff()
    if args.baseline:
        MYPY_BASELINE.write_text(json.dumps({"total": sum(m.values()), "files": m}, indent=1) + "\n")
        RUFF_BASELINE.write_text(json.dumps({"total": sum(r.values()), "files": r}, indent=1) + "\n")
        print(f"mypy: {sum(m.values())} errors in {len(m)} files; ruff: {sum(r.values())} in {len(r)} files")
        return 0
    status = 0
    strict = mypy_strict()
    if strict:
        print("the route table's modules under mypy --strict:\n" + strict)
        status = 1
    for name, now, path, out in (("mypy", m, MYPY_BASELINE, mout), ("ruff", r, RUFF_BASELINE, rout)):
        bad = worse(now, json.loads(path.read_text())["files"])
        if bad:
            print(f"{name}: more than its baseline ({path.name}):\n  " + "\n  ".join(bad))
            print("\n".join(l for l in out.splitlines() if any(l.startswith(b.split(":")[0]) for b in bad)))
            status = 1
        else:
            print(f"{name}: {sum(now.values())} (baseline {json.loads(path.read_text())['total']})")
    return status


if __name__ == "__main__":
    sys.exit(main())
