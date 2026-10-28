"""Copy the products table (tools/products_table.md) into every page that shows it, or check that they match.

    python tools/products_table.py           write the table into each page below
    python tools/products_table.py --check   exit 1 when a page's copy differs (tests/test_products_table.py runs it)

The table compares the Mantel App, Mantel with Docker or the LXC, HK Frontend alone, HK Frontend linked to Mantel,
and Mantel Link. It is written once, in tools/products_table.md, and each page holds a copy between the two marker
comments below. Every link in it is a full https:// address, since the copies live in different repositories
and wikis. Stdlib only.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "tools/products_table.md"
START = "<!-- products-table: copied from tools/products_table.md in Mantel by tools/products_table.py; edit it there -->"
END = "<!-- /products-table -->"
PAGES = (
    "README.md",                                                   # Mantel's README
    "docs/guide/Home.md",                                          # Mantel's wiki Home
    "docs/guide/HK-Frontend-and-Mantel.md",
    "hosts/ha/custom_components/hk_frontend/README.md",            # HK Frontend's README
    "hosts/ha/custom_components/hk_frontend/docs/Home.md",         # HK Frontend's wiki Home
    "hosts/ha/custom_components/hk_frontend/docs/HK-Frontend-and-Mantel.md",
    "hosts/ha/custom_components/mantel/README.md",                 # Mantel Link's README
)
BLOCK = re.compile(re.escape(START) + r"\n.*?" + re.escape(END), re.S)


def table(root: Path = ROOT) -> str:
    text = (root / SOURCE.relative_to(ROOT)).read_text(encoding="utf-8").strip("\n")
    for target in re.findall(r"\]\(([^)\s]+)\)", text):
        if not target.startswith("https://"):
            raise SystemExit(f"tools/products_table.md: every link must be a full https:// address: {target}")
    return text


def apply(page: str, text: str) -> str:
    blocks = BLOCK.findall(page)
    if len(blocks) != 1:
        raise ValueError(f"expected one products table between its markers, found {len(blocks)}")
    return BLOCK.sub(lambda _: f"{START}\n{text}\n{END}", page)


def problems(root: Path = ROOT) -> list[str]:
    text = table(root)
    out = []
    for rel in PAGES:
        page = (root / rel).read_text(encoding="utf-8")
        try:
            if apply(page, text) != page:
                out.append(f"{rel}: its products table differs from tools/products_table.md "
                           "(run tools/products_table.py)")
        except ValueError as e:
            out.append(f"{rel}: {e}")
    return out


def write(root: Path = ROOT) -> list[str]:
    text, changed = table(root), []
    for rel in PAGES:
        path = root / rel
        page = path.read_text(encoding="utf-8")
        new = apply(page, text)
        if new != page:
            path.write_text(new, encoding="utf-8")
            changed.append(rel)
    return changed


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    if a.check:
        found = problems()
        print("\n".join(found) if found else f"products table: {len(PAGES)} pages match")
        return 1 if found else 0
    for rel in write():
        print("updated", rel)
    return 0


if __name__ == "__main__":
    sys.exit(main())
