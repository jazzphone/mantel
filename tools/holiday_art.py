#!/usr/bin/env python3
"""The Holiday slide's painted scenes, from the full-size paintings to what ships (phase 20,
docs/phase20/HOLIDAY-SLIDE.md "Shipping the art").

    tools/holiday_art.py                 # read the PNGs, write web/hk/holiday/*.webp and scenes.json
    tools/holiday_art.py --check         # exit 1 when web/hk/holiday/ names a piece the list does not, or lacks one
    tools/holiday_art.py --src DIR ...   # read the paintings from other folders (each a Codex handoff's output/)
    tools/holiday_art.py --fonts DIR     # the four scenes' fonts, from Google Fonts' .ttf files in DIR, to WOFF2

The paintings are full-size PNGs, git-ignored, on the owner's Mac (docs/artwork-handoff/holiday-scenes/output/ for
Christmas and Halloween, docs/artwork-handoff/holiday-scenes-2/output/ for Thanksgiving and New Year's); a worktree
has none, so by default they are read from the main checkout at /Volumes/data/mantel. Each piece ships as WebP at half
size (quality 86, method 6, exact: the mock-up's own settings), which covers a 1920 x 1200 screen; a repainted piece
is this one command. The positions Codex measured (the tree's bulbs, the haunted house's windows, the table's candles
and steam) are folded into one scenes.json, in full-size px as the files have them.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web/hk/holiday"
MAIN = Path("/Volumes/data/mantel/docs/artwork-handoff")
SOURCES = [MAIN / "holiday-scenes/output", MAIN / "holiday-scenes-2/output"]

# THE PIECES EACH SCENE DRAWS (hk-saver-holiday-scenes.js PIECES is the same list). Not shipped: room-tv,
# room-tv-antenna, room-stand and room-presents (the entertainment center and the pile replaced them), and
# ny-string-lights (code hangs the strands).
PIECES = {
    "room": ["room-wall", "room-wainscot", "room-carpet", "room-window-outside", "room-window", "room-couch", "room-tree",
             "room-presents-pile", "room-entertainment-center", "room-garland"],
    "haunt": ["haunt-sky", "haunt-house", "haunt-house-lit", "haunt-shutter", "haunt-tree", "haunt-grounds", "haunt-stone",
              "haunt-grass", "haunt-pumpkin-large", "haunt-pumpkin-small"],
    "thanks": ["thanks-wall", "thanks-wainscot", "thanks-floor", "thanks-window-outside", "thanks-window", "thanks-table",
               "thanks-hutch", "thanks-harvest", "thanks-board", "thanks-console"],
    "newyear": ["ny-sky", "ny-skyline", "ny-rooftop", "ny-board", "ny-crate", "ny-party", "ny-balloons", "ny-streamers"],
}
# the measured positions: which file, and what scenes.json calls it
POSITIONS = {"room-tree-bulbs.json": "treeBulbs", "haunt-windows.json": "hauntWindows", "thanks-table.json": "thanksTable"}


# THE SCENES' FONTS (each under the SIL Open Font License 1.1, its text beside it in web/hk/holiday/fonts/): the
# file in Google Fonts' repository (github.com/google/fonts, ofl/), what is kept, and the file that ships. Only the
# glyphs a scene can show (Basic Latin, the curly quotes, the dots and the play mark); Cabin Sketch's license reserves
# its name for the unmodified font, so it ships whole, only converted to WOFF2 (the OFL's FAQ: a format conversion
# is not a modified version)
FONTS = [("VT323-Regular.ttf", "subset", None, "vt323.woff2", "VT323-OFL.txt"),
         ("Cinzel.ttf", "subset", (600, 800), "cinzel.woff2", "Cinzel-OFL.txt"),
         ("CabinSketch-Bold.ttf", "whole", None, "cabin-sketch-bold.woff2", "CabinSketch-OFL.txt"),
         ("Oswald.ttf", "subset", 500, "oswald-500.woff2", "Oswald-OFL.txt")]
UNICODES = list(range(0x20, 0x7F)) + [0xA0, 0xB7, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026, 0x25B6]


def fonts(src: Path) -> int:
    from fontTools import subset
    from fontTools.ttLib import TTFont
    from fontTools.varLib import instancer
    out = OUT / "fonts"
    out.mkdir(parents=True, exist_ok=True)
    for ttf, how, wght, woff, lic in FONTS:
        f = TTFont(src / ttf)
        if how == "subset":
            if wght is not None and "fvar" in f:
                f = instancer.instantiateVariableFont(f, {"wght": wght if isinstance(wght, int) else tuple(wght)})
                buf = io.BytesIO()
                f.save(buf)
                f = TTFont(io.BytesIO(buf.getvalue()))
            opts = subset.Options()
            opts.flavor, opts.layout_features, opts.name_IDs, opts.notdef_outline = "woff2", ["*"], ["*"], True
            s = subset.Subsetter(opts)
            s.populate(unicodes=UNICODES)
            s.subset(f)
        else:
            f.flavor = "woff2"
        f.save(out / woff)
        (out / lic).write_bytes((src / lic).read_bytes())
        print(f"{woff}: {(out / woff).stat().st_size / 1000:.0f} KB")
    return 0


def find(name: str, sources: list[Path]) -> Path | None:
    for d in sources:
        p = d / name
        if p.exists():
            return p
    return None


def convert(sources: list[Path]) -> int:
    from PIL import Image
    OUT.mkdir(parents=True, exist_ok=True)
    missing, total = [], 0
    for scene, names in PIECES.items():
        for n in names:
            src = find(n + ".png", sources)
            if not src:
                missing.append(n + ".png")
                continue
            im = Image.open(src).convert("RGBA")
            half = im.resize((max(1, im.width // 2), max(1, im.height // 2)), Image.LANCZOS)
            dst = OUT / (n + ".webp")
            half.save(dst, "WEBP", quality=86, method=6, exact=True)
            total += dst.stat().st_size
    if missing:
        print("missing paintings: " + ", ".join(missing), file=sys.stderr)
        return 1
    pos = {"note": "Measured by the painter in full-size px (tools/holiday_art.py folds them in).", "pieces": PIECES}
    for f, key in POSITIONS.items():
        src = find(f, sources)
        if not src:
            print("missing positions: " + f, file=sys.stderr)
            return 1
        raw = json.loads(src.read_text())
        if key == "treeBulbs":
            raw = [[b["x"], b["y"], b["color"]] for b in raw]
        pos[key] = raw
    (OUT / "scenes.json").write_text(json.dumps(pos, indent=1) + "\n")
    print(f"wrote {sum(len(v) for v in PIECES.values())} pieces ({total / 1e6:.2f} MB) and scenes.json to {OUT.relative_to(ROOT)}")
    return 0


def check() -> int:
    want = {n + ".webp" for names in PIECES.values() for n in names}
    have = {p.name for p in OUT.glob("*.webp")}
    bad = sorted(want - have) + sorted(have - want)
    try:
        listed = json.loads((OUT / "scenes.json").read_text()).get("pieces")
    except (OSError, ValueError):
        listed = None
    if bad or listed != PIECES:
        print("web/hk/holiday/ is out of step with tools/holiday_art.py: " + (", ".join(bad) or "scenes.json's pieces"))
        return 1
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="the shipped files agree with the list")
    ap.add_argument("--src", nargs="+", type=Path, help="folders holding the full-size PNGs and their positions")
    ap.add_argument("--fonts", type=Path, help="a folder holding the four fonts' .ttf files and their OFL.txt")
    a = ap.parse_args()
    if a.fonts:
        return fonts(a.fonts)
    return check() if a.check else convert(a.src or SOURCES)


if __name__ == "__main__":
    sys.exit(main())
