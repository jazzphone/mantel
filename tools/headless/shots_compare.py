#!/usr/bin/env python3
"""Two folders of screenshots compared pixel for pixel (phase 24, A6: docs/phase24/CLEAN-CODE.md "Part P").

gallery.py, house_twin.py render and sheet_review.py only write PNGs; the Settings sweep is the one tool that compares
by itself (settings_sweep.py --compare). This is the comparer for the rest:

    python tools/headless/shots_compare.py BASE NEW [--diffs DIR] [--volatile FILE] [--tolerance N]
    python tools/headless/shots_compare.py BASE BASE.2 --write-volatile FILE      # two runs of one tree: what varies by itself

Every *.png and *.webp under BASE (by its path relative to BASE) is looked for under NEW. Two shots are the same when they have the
same size and no more than --tolerance pixels differ (default 0). A shot missing on either side is a difference.

A VOLATILE SHOT (a clock, a "2 min ago", an animation caught mid-way) differs between two runs of the same tree, so a pixel
comparison of it proves nothing. --write-volatile lists the shots that differ between two runs of one tree; --volatile reads
that list, and each such shot is judged by its DOM instead: the file of the same name ending .txt or .html beside it, when
the tool that took it wrote one, compared as text; when there is none it is reported as not compared (never as passing).

For each shot that differs, --diffs DIR gets a picture: the new shot with the changed pixels in magenta.
The exit status is 0 when nothing compared differs, 1 otherwise.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageChops


def shots(folder: Path) -> dict[str, Path]:
    return {p.relative_to(folder).as_posix(): p for p in sorted([*folder.rglob("*.png"), *folder.rglob("*.webp")])}


def changed_pixels(a: Path, b: Path) -> tuple[int, Image.Image | None, str]:
    """(pixels that differ, the mask, why) -- a size mismatch counts as every pixel."""
    ia, ib = Image.open(a).convert("RGBA"), Image.open(b).convert("RGBA")
    if ia.size != ib.size:
        return ia.size[0] * ia.size[1], None, f"size {ia.size} -> {ib.size}"
    diff = ImageChops.difference(ia, ib)
    mask = diff.convert("L").point(lambda v: 255 if v else 0)
    n = sum(1 for v in mask.getdata() if v)
    return n, mask, ""


def dom_of(png: Path) -> Path | None:
    for ext in (".txt", ".html"):
        p = png.with_suffix(ext)
        if p.is_file():
            return p
    return None


def compare(base: Path, new: Path, volatile: set[str], tolerance: int, diffs: Path | None) -> dict:
    a, b = shots(base), shots(new)
    out: dict = {"same": [], "differ": [], "missing": [], "extra": [], "dom_same": [], "dom_differ": [], "not_compared": []}
    for name, pa in a.items():
        pb = b.get(name)
        if pb is None:
            out["missing"].append(name)
            continue
        if name in volatile:
            da, db = dom_of(pa), dom_of(pb)
            if da is None or db is None:
                out["not_compared"].append(name)
            elif da.read_bytes() == db.read_bytes():
                out["dom_same"].append(name)
            else:
                out["dom_differ"].append(name)
            continue
        n, mask, why = changed_pixels(pa, pb)
        if n <= tolerance:
            out["same"].append(name)
            continue
        out["differ"].append(f"{name}: {why or str(n) + ' pixels'}")
        if diffs is not None and mask is not None:
            pic = Image.open(pb).convert("RGBA")
            pic.paste((255, 0, 255, 255), mask=mask)
            target = diffs / name
            target.parent.mkdir(parents=True, exist_ok=True)
            pic.save(target)
    out["extra"] = sorted(set(b) - set(a))
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("base", type=Path)
    ap.add_argument("new", type=Path)
    ap.add_argument("--diffs", type=Path, help="write a picture of each shot that differs here")
    ap.add_argument("--volatile", type=Path, help="a JSON list of shots (paths relative to BASE) to judge by their DOM")
    ap.add_argument("--write-volatile", type=Path, help="BASE and NEW are two runs of one tree: write the shots that differ")
    ap.add_argument("--tolerance", type=int, default=0, help="pixels a shot may differ by and still be the same")
    ap.add_argument("--json", action="store_true", help="print the whole result as JSON")
    args = ap.parse_args(argv)
    volatile = set(json.loads(args.volatile.read_text())) if args.volatile else set()
    got = compare(args.base, args.new, volatile, args.tolerance, args.diffs)
    if args.write_volatile:
        names = sorted({d.split(": ", 1)[0] for d in got["differ"]})
        args.write_volatile.write_text(json.dumps(names, indent=1) + "\n")
        print(f"{len(names)} of {len(got['same']) + len(names)} shots differ between the two runs: written to {args.write_volatile}")
        if got["missing"] or got["extra"]:
            print(f"  (and the two runs took different shots: missing {got['missing'][:5]}, extra {got['extra'][:5]})")
        return 0
    if args.json:
        print(json.dumps(got, indent=1))
    bad = got["differ"] + got["missing"] + got["extra"] + got["dom_differ"]
    print(f"{len(got['same'])} shots identical, {len(got['dom_same'])} volatile shots identical by DOM, "
          f"{len(got['not_compared'])} volatile shots not compared (no DOM file), {len(bad)} differences")
    for line in got["differ"]:
        print("  differs:", line)
    for name in got["dom_differ"]:
        print("  DOM differs:", name)
    for name in got["missing"]:
        print("  missing in", args.new, ":", name)
    for name in got["extra"]:
        print("  only in", args.new, ":", name)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
