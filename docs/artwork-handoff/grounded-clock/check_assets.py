"""Check the grounded clock's foreground strips (ARTWORK-REQUEST.md) and composite them for review.

    python3 check_assets.py                 # every output/fg-meadow-*.png present
    python3 check_assets.py fall winter     # just these seasons

Needs Pillow and NumPy (Mantel's .venv has both: /Volumes/data/mantel/.venv/bin/python). Prints PASS/FAIL per check
and writes, per season, output/preview-<season>.png (the strip on its meadow, in front of the numerals, at the 16:10
reference size) and output/preview-<season>-zoom.png (the numerals' feet at 3x). Exit status 1 if anything fails.
Read-only for everything outside output/.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
OUT = HERE / "output"
REF = HERE / "references"
SEASONS = ("fall", "summer", "spring", "winter")

# the strip's frame (ARTWORK-REQUEST.md, "The files")
W, H = 3600, 200
GROUND = 140            # the ground line, px from the top: the numerals' baseline
CLEAR_TOP = 30          # rows 0-29: nothing at all
STEMS_TOP = 30          # rows 30-69: only rare thin stems and seed heads
TUFTS_TOP = 70          # rows 70-109: tufts, sparse
FRINGE_TOP = 110        # rows 110-139: the low fringe
LITTER_END = 185        # rows 140-184: blade bases and ground litter; rows 185-199: nothing at all
# where it goes on the land (2560 x 1600 art px): one strip px is half an art px
ART_GROUND = 1088
ART_LEFT = 46           # the strip's left edge at the 16:10 reference: 60 art px left of the time's ink (art x 106)


def say(ok, what, got=""):
    print(("PASS " if ok else "FAIL ") + what + ("" if ok or got == "" else f"   got {got}"))
    return ok


def check(season):
    p = OUT / f"fg-meadow-{season}.png"
    if not p.exists():
        print(f"SKIP {season}: {p.name} is not there")
        return None
    im = Image.open(p)
    ok = True
    ok &= say(im.format == "PNG", f"{p.name}: a PNG", im.format)
    ok &= say(im.size == (W, H), f"{p.name}: {W} x {H}", im.size)
    ok &= say(im.mode == "RGBA", f"{p.name}: RGBA", im.mode)
    if im.size != (W, H):
        return False
    a = np.asarray(im.convert("RGBA"), dtype=np.float32)
    al = a[..., 3] / 255.0
    ok &= say(al[:CLEAR_TOP].max() == 0, "rows 0-29 fully transparent", f"max alpha {al[:CLEAR_TOP].max():.3f}")
    ok &= say(al[LITTER_END:].max() == 0, "rows 185-199 fully transparent", f"max alpha {al[LITTER_END:].max():.3f}")
    cov = lambda y0, y1: float((al[y0:y1] > 0.5).mean())
    ok &= say(cov(STEMS_TOP, TUFTS_TOP) <= 0.03, "stems band (30-69) under 3 % covered", f"{cov(STEMS_TOP, TUFTS_TOP):.3f}")
    ok &= say(cov(TUFTS_TOP, FRINGE_TOP) <= 0.20, "tufts band (70-109) under 20 % covered", f"{cov(TUFTS_TOP, FRINGE_TOP):.3f}")
    ok &= say(cov(FRINGE_TOP, GROUND) <= 0.60, "fringe band (110-139) under 60 % covered", f"{cov(FRINGE_TOP, GROUND):.3f}")
    ok &= say(cov(GROUND - 4, GROUND + 6) >= 0.35, "something at the ground line itself (at least 35 %)", f"{cov(GROUND - 4, GROUND + 6):.3f}")
    # gaps: runs of columns with nothing above the ground line taller than the fringe's lowest third
    col = (al[TUFTS_TOP:GROUND - 10] > 0.35).any(axis=0)
    runs, n = [], 0
    for v in list(col) + [True]:
        if not v:
            n += 1
        else:
            if n:
                runs.append(n)
            n = 0
    gaps = [r for r in runs if r >= 40]
    ok &= say(len(gaps) >= 8, "at least 8 open gaps 40 px or wider above the low fringe", f"{len(gaps)} ({sorted(runs)[-8:]})")
    ok &= say(max(runs or [0]) <= 600, "no open gap wider than 600 px (it is never a strip with a hole)", max(runs or [0]))
    # not a straight strip: the fringe's top edge must wander
    tops = []
    for x in range(0, W, 16):
        ys = np.nonzero(al[:GROUND, x] > 0.5)[0]
        tops.append(ys.min() if len(ys) else GROUND)
    ok &= say(np.std(tops) >= 8, "the top edge is irregular (spread of its height 8 px or more)", f"{np.std(tops):.1f}")
    # halos: nearly-transparent edge pixels must not be much darker or lighter than the opaque pixels near them
    edge = (al > 0.02) & (al < 0.35)
    solid = al > 0.9
    if edge.any() and solid.any():
        le = (a[..., :3][edge] @ [0.299, 0.587, 0.114]).mean()
        ls = (a[..., :3][solid] @ [0.299, 0.587, 0.114]).mean()
        ok &= say(abs(le - ls) <= 45, "no dark or light halo at the edges (edge vs body luminance within 45)", f"{le:.0f} vs {ls:.0f}")
    # a plain fill would read as a strip: the strip has to carry texture
    body = a[..., :3][al > 0.9] @ [0.299, 0.587, 0.114]
    ok &= say(body.std() >= 12, "it has texture (luminance spread 12 or more)", f"{body.std():.1f}")
    preview(season, im)
    return ok


def preview(season, strip):
    land = REPO / f"web/hk/sky/land-{season}-day.webp"
    digits = REF / "clean/digits-1248-art-2560x1600.png"
    base = Image.open(land).convert("RGBA")
    if digits.exists():
        base.alpha_composite(Image.open(digits).convert("RGBA"))
    half = strip.resize((W // 2, H // 2), Image.LANCZOS)
    base.alpha_composite(half, (ART_LEFT, ART_GROUND - GROUND // 2))
    base.convert("RGB").resize((1280, 800), Image.LANCZOS).save(OUT / f"preview-{season}.png")
    z = base.crop((0, 960, 1700, 1160))
    z.convert("RGB").resize((z.width, z.height), Image.LANCZOS).save(OUT / f"preview-{season}-zoom.png")
    print(f"     wrote output/preview-{season}.png and output/preview-{season}-zoom.png")


if __name__ == "__main__":
    want = sys.argv[1:] or SEASONS
    results = [check(s) for s in want]
    if all(r is None for r in results):
        print("nothing to check yet")
    sys.exit(1 if any(r is False for r in results) else 0)
