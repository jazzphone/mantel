"""The forecast screensaver's landscapes: from the 12 source PNGs to what the
page loads (HK Frontend 1.3).

    python3 tools/sky/land_webp.py            check, then convert
    python3 tools/sky/land_webp.py --check    check only

SOURCES  tools/sky/src/land/land-<season>-<light>-src.png   (2560 x 1600 RGBA)
         tools/sky/src/land/DONE.json                        (their manifest)
OUTPUT   frontend/sky/land-<season>-<light>.webp            (hk-sky.js scene())

The art's contract (hk_house/docs/CODEX-PROMPT-FORECAST-LANDSCAPES.md), held
here rather than trusted: all 12 there, 2560 x 1600 RGBA, matching DONE.json's
checksums; the top 34% fully transparent (the live sky shows there, and the
clock sits on it); and the 12 pixel-aligned -- the page cross-fades between
them, so a hill that moves between two versions would show. Needs Pillow and
numpy.

THE ALPHA IS REPAIRED ON THE WAY (the sources are left as delivered). The
first delivery (2026-09-30) matted the tree crowns with small SQUARE holes
-- pockets of transparency inside the foliage, the foliage colour still under
them -- which the live sky would show through as square blotches, orange at
dusk. repair_alpha(): every transparent pocket that cannot be reached from the
open sky is filled back in (gaps that really open onto the sky are kept), and
the outline is blurred and re-sharpened, which rounds off its
square steps. One repaired
mask per season, shared by its three lights, so they stay pixel-aligned.
"""
import hashlib, json, os, sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get("HK_LAND_SRC") or os.path.join(HERE, "src", "land")   # (override: a dry run)
_UP = os.path.abspath(os.path.join(HERE, "..", ".."))
COMPONENT = (os.path.join(_UP, "custom_components", "hk_frontend")
             if os.path.isdir(os.path.join(_UP, "custom_components", "hk_frontend")) else _UP)
OUT = os.environ.get("HK_LAND_OUT") or os.path.join(COMPONENT, "frontend", "sky")
SEASONS = ("spring", "summer", "fall", "winter")
LIGHTS = ("day", "dusk", "night")
W, H = 2560, 1600
CLEAR_TO = int(H * 0.34)          # rows 0 .. CLEAR_TO-1 must be alpha 0
QUALITY = 82                      # WebP, alpha kept (lossless alpha plane)


def names():
    return [(s, l, "land-%s-%s-src.png" % (s, l)) for s in SEASONS for l in LIGHTS]


def check():
    problems = []
    done = os.path.join(SRC, "DONE.json")
    if not os.path.exists(done):
        return ["no DONE.json in %s" % SRC], {}
    man = json.load(open(done))
    listed = {f.get("name"): f for f in man.get("files", [])}
    for k, v in (man.get("checks") or {}).items():
        if v is not True:
            problems.append("DONE.json says %s is %r" % (k, v))
    masks, imgs = {}, {}
    for season, light, name in names():
        path = os.path.join(SRC, name)
        if not os.path.exists(path):
            problems.append("missing %s" % name)
            continue
        if name not in listed:
            problems.append("%s is not in DONE.json" % name)
        elif listed[name].get("sha256") and listed[name]["sha256"] != hashlib.sha256(open(path, "rb").read()).hexdigest():
            problems.append("%s does not match its sha256 in DONE.json" % name)
        im = Image.open(path)
        if im.size != (W, H) or im.mode != "RGBA":
            problems.append("%s is %s %s, not %dx%d RGBA" % (name, im.size, im.mode, W, H))
            continue
        a = im.getchannel("A")
        top = a.crop((0, 0, W, CLEAR_TO)).getextrema()
        if top[1] != 0:
            problems.append("%s: the top 34%% is not fully transparent (max alpha %d)" % (name, top[1]))
        masks[(season, light)] = a.point(lambda v: 255 if v > 127 else 0).resize((W // 8, H // 8))
        imgs[(season, light)] = im
    # pixel-aligned within a season (same scene relit): silhouettes agree
    for season in SEASONS:
        ref = masks.get((season, "day"))
        for light in LIGHTS[1:]:
            m = masks.get((season, light))
            if ref is None or m is None:
                continue
            hist = ImageChops.difference(ref, m).histogram()
            share = sum(hist[1:]) / float(ref.width * ref.height)
            if share > 0.01:
                problems.append("%s %s: its outline differs from %s day on %.1f%% of the frame"
                                % (season, light, season, share * 100))
    return problems, imgs


HOLE_BELOW = 250                  # an enclosed pocket under this is filled (half-clear squares too)


def repair_alpha(alpha):
    """The season's mask, repaired: enclosed pockets filled, outline softened.
    Returns (new mask, how many pixels were filled)."""
    a = np.asarray(alpha).astype(np.uint8)
    # .copy(): an image made from an array is read-only, and floodfill() then
    # silently fills nothing (it did, once: the whole sky came back a "pocket")
    air = Image.fromarray(np.where(a < HOLE_BELOW, 255, 0).astype(np.uint8), "L").copy()
    # the open sky: everything transparent that is connected to the (fully
    # clear) top edge; what stays 255 after the fill is a pocket
    ImageDraw.floodfill(air, (0, 0), 128)
    pocket = np.asarray(air) == 255
    if pocket.sum() > a.size * 0.02:
        raise SystemExit("repair_alpha: %d px of pockets is not pockets -- the fill did not run" % pocket.sum())
    fixed = a.copy()
    fixed[pocket] = 255
    # the outline: blurred, then its middle band stretched back to a crisp
    # edge -- the square steps come out rounded, the edge stays sharp
    blur = np.asarray(Image.fromarray(fixed, "L").filter(ImageFilter.GaussianBlur(3.0))).astype(np.float32)
    soft = np.clip((blur - 48.0) * (255.0 / (207.0 - 48.0)), 0, 255).astype(np.uint8)
    soft[:CLEAR_TO, :] = 0
    return Image.fromarray(soft, "L"), int(pocket.sum())


def convert(imgs):
    masks = {}
    for season in SEASONS:
        day = imgs.get((season, "day"))
        if day is None:
            continue
        masks[season], n = repair_alpha(day.getchannel("A"))
        print("  %-8s alpha repaired: %d px of pockets filled, outline softened" % (season, n))
    for (season, light), im in sorted(imgs.items()):
        out = im.copy()
        if season in masks:
            out.putalpha(masks[season])
        dest = os.path.join(OUT, "land-%s-%s.webp" % (season, light))
        out.save(dest, "WEBP", quality=QUALITY, method=6, exact=False)
        print("  %-26s %5d KB" % (os.path.basename(dest), os.path.getsize(dest) // 1024))


if __name__ == "__main__":
    problems, imgs = check()
    for p in problems:
        print("PROBLEM:", p)
    if problems:
        sys.exit(1)
    print("all 12 checked: 2560x1600 RGBA, checksums match, top 34% clear, aligned per season")
    if "--check" not in sys.argv:
        convert(imgs)
