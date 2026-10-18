#!/usr/bin/env python3
"""Export HKClient's write catalog (``hkClient.WRITES`` in web/client/hk-client.js) as JSON for the
command gateway, so the frontend and Mantel Server classify WebSocket writes from ONE list.

    python tools/export_writes.py            # (re)write hosts/server/mantel_server/hk_writes.json
    python tools/export_writes.py --check    # exit 1 if the JSON is not what hk-client.js says

The list is read by evaluating hk-client.js in Node when Node is installed (the authoritative
answer: exactly what the page gets), and by parsing the ``var WRITES = [...]`` literal otherwise;
tests/test_gateway_catalog.py checks that both agree with the committed JSON.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "web/client/hk-client.js"
TARGET = ROOT / "hosts/server/mantel_server/hk_writes.json"

_LITERAL = re.compile(r"var WRITES = \[(.*?)\];", re.S)
_STRING = re.compile(r"'([^'\\]*)'")

NODE_SNIPPET = """
globalThis.dispatchEvent = () => true;
globalThis.CustomEvent = class { constructor(n, d) { this.type = n; this.detail = d && d.detail; } };
require(process.argv[1]);
process.stdout.write(JSON.stringify(globalThis.hkClient.WRITES));
"""


def parse(source: str) -> list[str]:
    """The WRITES literal, parsed (no JavaScript engine needed)."""
    m = _LITERAL.search(source)
    if not m:
        raise SystemExit("export_writes: no `var WRITES = [...]` in hk-client.js")
    body = "\n".join(line.split("//", 1)[0] for line in m.group(1).splitlines())
    return _STRING.findall(body)


def evaluate(path: Path = SOURCE) -> list[str] | None:
    """hkClient.WRITES as Node sees it, or None when Node is not installed."""
    node = shutil.which("node")
    if not node:
        return None
    out = subprocess.run([node, "-e", NODE_SNIPPET, str(path)], capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise SystemExit(f"export_writes: node failed: {out.stderr.strip()[:400]}")
    return json.loads(out.stdout)


def catalog() -> dict:
    parsed = parse(SOURCE.read_text())
    seen = evaluate()
    if seen is not None and seen != parsed:
        raise SystemExit("export_writes: the parsed WRITES literal differs from what hk-client.js exports")
    if len(set(parsed)) != len(parsed):
        raise SystemExit("export_writes: WRITES has duplicates")
    return {"source": "web/client/hk-client.js", "symbol": "hkClient.WRITES", "writes": sorted(parsed)}


def render(data: dict) -> str:
    return json.dumps(data, indent=1) + "\n"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--check", action="store_true", help="only compare; exit 1 when out of date")
    a = p.parse_args(argv)
    text = render(catalog())
    if a.check:
        if not TARGET.is_file() or TARGET.read_text() != text:
            print(f"{TARGET.relative_to(ROOT)} is out of date: run tools/export_writes.py", file=sys.stderr)
            return 1
        return 0
    TARGET.write_text(text)
    print(f"wrote {TARGET.relative_to(ROOT)} ({len(json.loads(text)['writes'])} write types)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
