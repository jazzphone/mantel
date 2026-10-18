"""The cloud masks as WebP: from gen_sky.py's PNGs to what the page loads.

    python3 tools/sky/cloud_webp.py            convert, then verify
    python3 tools/sky/cloud_webp.py --check    verify only (nothing is written)

SOURCES  frontend/sky/clouds-{a,b,c}.png   gen_sky.py's output: grey+alpha
OUTPUT   frontend/sky/clouds-{a,b,c}.webp  lossless; the .cl mask-image in hk-sky.js

The cloud decks are a mask-image over a gradient fill, so the ALPHA channel
is the whole picture -- the luminance payload is never painted (that is why
gen_sky.py's clouds are flat 255 grey). A lossless WebP of these masks is
45-55% smaller than the PNG and decodes faster, with the alpha plane bit
identical, so the same three textures recolor exactly as before. Needs
Pillow, like land_webp.py and holiday_webp.py (gen_sky.py stays pure-stdlib
and keeps the PNGs as the canonical pixels; this re-encode is a derivative).

LOSSLESS, deliberately, not the quality-82 of the landscape converter: the
alpha EDGES are the art, and lossless keeps the check trivial -- re-decode
and the alpha plane must equal the PNG's byte for byte. (The encoder may
still differ a little in the unused luminance payload; the mask ignores it,
and the CLOUD_ALPHA mean-alphas in hk-sky.js -- measured on the pixels, not
the file -- apply to both.)

RUN IT AFTER gen_sky.py, then run the suites.

THE PNGS ARE KEPT ALONGSIDE, NOT DELETED, for the rollout: /hk/ is served
no-cache, so an already-loaded page REVALIDATES the .png it fetched, and a
file that has vanished is a 404 -- and a missing mask-image is not "no
clouds", it is a solid tinted slab over the whole sky. Remove the PNGs in a
LATER change, once every page has reloaded on the .webp URLs.
"""
import os, sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
_UP = os.path.abspath(os.path.join(HERE, "..", ".."))
# the component's own tools/sky, or the repository's tools/sky beside
# custom_components/hk_frontend (the same resolution as gen_sky.py)
_COMPONENT = (os.path.join(_UP, "custom_components", "hk_frontend")
              if os.path.isdir(os.path.join(_UP, "custom_components", "hk_frontend")) else _UP)
OUT = os.path.join(_COMPONENT, "frontend", "sky")

MASKS = ("clouds-a", "clouds-b", "clouds-c")


def check():
    """Every committed webp must be the same mask as its png. Problems list."""
    problems = []
    for stem in MASKS:
        png = os.path.join(OUT, stem + ".png")
        webp = os.path.join(OUT, stem + ".webp")
        if not os.path.exists(png):
            problems.append("%s: no %s -- run gen_sky.py" % (stem, stem + ".png"))
            continue
        if not os.path.exists(webp):
            problems.append("%s: no %s -- run cloud_webp.py" % (stem, stem + ".webp"))
            continue
        a = Image.open(png).convert("RGBA")
        b = Image.open(webp).convert("RGBA")
        if a.size != b.size:
            problems.append("%s: the webp is %sx%s, the png is %sx%s"
                            % (stem, b.width, b.height, a.width, a.height))
        elif a.getchannel("A").tobytes() != b.getchannel("A").tobytes():
            problems.append("%s: the webp's ALPHA differs from the png's" % stem)
        else:
            print("  %-14s alpha identical   %5.0f KB of %5.0f KB png"
                  % (stem + ".webp", os.path.getsize(webp) / 1024,
                     os.path.getsize(png) / 1024))
    return problems


def convert():
    for stem in MASKS:
        png = os.path.join(OUT, stem + ".png")
        if not os.path.exists(png):
            print("  %-14s missing -- run gen_sky.py first" % stem)
            return False
        im = Image.open(png).convert("RGBA")
        webp = os.path.join(OUT, stem + ".webp")
        im.save(webp, "WEBP", lossless=True, method=6)
    return True


if __name__ == "__main__":
    check_only = "--check" in sys.argv[1:]
    if not check_only:
        if convert():
            print("  written:  " + ", ".join(m + ".webp" for m in MASKS))
        else:
            sys.exit("no source PNGs to convert")
    problems = check()
    if problems:
        for p in problems:
            print("  PROBLEM  " + p)
        sys.exit("%d problem(s) -- the committed webp does not match the png" % len(problems))
    print("  all %d masks identical (alpha bit-exact)" % len(MASKS))
