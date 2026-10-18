"""Raw-host (`hass`/`_hass`) counts against docs/phase1/legacy-ha-access.json.

    python tools/hass_budget.py           # per-file changes and the total
    python tools/hass_budget.py --write   # lower budgets to the counts; drop files at 0

Budgets only go down (tests/test_boundaries.py enforces it); --write never raises one.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUDGETS = ROOT / "docs/phase1/legacy-ha-access.json"
RAW = re.compile(r"\b(?:hass|_hass)\b")


def main() -> None:
    budgets = json.loads(BUDGETS.read_text())
    counts = {f: len(RAW.findall((ROOT / f).read_text())) if (ROOT / f).exists() else 0 for f in budgets}
    for f, n in budgets.items():
        if counts[f] != n:
            print(f"{f}: {n} -> {counts[f]}")
    print(f"total {sum(budgets.values())} -> {sum(counts.values())}")
    if "--write" in sys.argv:
        out = {f: min(n, counts[f]) for f, n in budgets.items() if min(n, counts[f]) > 0}
        BUDGETS.write_text(json.dumps(out, indent=2) + "\n")


if __name__ == "__main__":
    main()
