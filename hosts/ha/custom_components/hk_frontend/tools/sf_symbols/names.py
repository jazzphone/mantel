"""The SF Symbols the glyph file is built from, as two lists a person can use
without running the builder:

    symbols.txt              every SF symbol name, one per line -- what
                             export_all.sh exports on a Mac
    docs/Glyph-Names.md      every hk: icon -> the SF symbol it is drawn from

Both are generated from manifest.json, and a test fails if either falls
behind it. After changing the manifest:

    python3 names.py [--docs <path to docs/Glyph-Names.md>]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def manifest() -> dict:
    return json.load(open(os.path.join(HERE, "manifest.json"), encoding="utf-8"))


def symbols(m: dict) -> list[str]:
    names = {v["symbol"] for v in m["icons"].values() if "symbol" in v}
    names |= {v["symbol"] for v in m["twotone"].values()}
    names |= set(m.get("weather", []))
    return sorted(names)


def symbols_txt(m: dict) -> str:
    return "\n".join(symbols(m)) + "\n"


def _note(v: dict) -> str:
    if "path" in v:
        return "Material Design shape, included (not Apple’s)"
    if "scale" in v:
        return f"scaled to {v['scale']:g}"
    return ""


def docs(m: dict) -> str:
    rows = [f"| `hk:{k}` | `{v['symbol']}` | {_note(v)} |" if "symbol" in v
            else f"| `hk:{k}` | — | {_note(v)} |" for k, v in sorted(m["icons"].items())]
    two = [f"| `hk:{k}` | `{v['symbol']}` | two-tone{'; ' + _note(v) if _note(v) else ''} |"
           for k, v in sorted(m["twotone"].items())]
    wx = [f"| `{s}` |" for s in m.get("weather", [])]
    n = len(symbols(m))
    return f"""# Glyph names

<!-- Generated from tools/sf_symbols/manifest.json by tools/sf_symbols/names.py. Don’t edit by hand. -->

Every `hk:` icon, and the SF Symbol it is drawn from — {n} symbols in all, listed one per line in `tools/sf_symbols/symbols.txt`. You don’t need this table to build the glyph file; it is for finding a symbol in the SF Symbols app, checking what an icon should look like, or [exporting the symbols another way](Making-Your-Files.md#no-python-on-the-mac).

A symbol name that your version of SF Symbols doesn’t have (Apple renames one now and then) stops the build with its name. Search for the icon in the SF Symbols app to find the new name, and [open an issue](https://github.com/jazzphone/hk-frontend/issues) so the list can be updated.

## Icons

| Icon | SF Symbol | Note |
|---|---|---|
{chr(10).join(rows + two)}

## Weather

Drawn in color in the header, the menu and the Weather page, not as `hk:` icons.

| SF Symbol |
|---|
{chr(10).join(wx)}
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--docs", help="where docs/Glyph-Names.md is (default: the docs beside tools/)")
    a = ap.parse_args()
    m = manifest()
    open(os.path.join(HERE, "symbols.txt"), "w", encoding="utf-8").write(symbols_txt(m))
    path = a.docs or os.path.join(HERE, "..", "..", "docs", "Glyph-Names.md")
    open(path, "w", encoding="utf-8").write(docs(m))
    print(f"wrote symbols.txt ({len(symbols(m))} symbols) and {os.path.normpath(path)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
