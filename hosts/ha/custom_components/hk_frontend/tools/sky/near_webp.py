"""New Decorations' woodland art: from the source PNGs to what the page loads.

    python3 tools/sky/near_webp.py            convert, then verify
    python3 tools/sky/near_webp.py --check    verify only (nothing is written)

SOURCES  tools/sky/src/near/<name>-v1-src.png    9 RGBA cut-outs (docs/Seasonal-Decorations.md):
           fall, halloween, christmas, winter, spring, summer, july4, birthday
           1585/1586 x 992; balloons 1024 x 1536
OUTPUT   frontend/sky/near/<name>-v1.webp        mountNearScenery() in hk-sky.js
         frontend/sky/near/manifest.json         size, mean alpha and luma of each

WHY: the delivered PNGs were 1.6-3.1 MB each, 24 MB in all, shipped to every
HACS install for an opt-in style -- the rest of the sky has shipped as WebP
since 1.3. These come to about 6 MB.

LOSSY RGB, LOSSLESS ALPHA (2026-10-04). These are feathered foreground
cut-outs over a LIVE sky: the alpha edge is what the sky shows through, so it
must not move, and a lossy alpha plane rings along every branch. The colour
can take the land converter's treatment, a little higher (90, not 82) because
the art sits close and full-height rather than far off across the bottom.
Measured on the first delivery: alpha bit-identical; RGB under alpha > 0 off
by ~2-3.5 per channel on average (the encoder rounds 4:2:0 chroma, so single
pixels of fine detail differ by up to ~70 as composited; the straight colour
of a near-transparent fringe pixel can move further, and shows as little). exact=False, as in land_webp.py:
the encoder may rewrite the colour under fully transparent pixels, which
nothing draws -- the Halloween candle filter reads luminance, but only inside
its carved openings, which are opaque (alpha >= 251).

THE LIGHTING ART (2026-10-04, delivery notes in src/near/lighting-artwork-v1.md):
lit twins and overlays, pixel-aligned with their scene. They ship as PATCHES,
not full-canvas layers -- a wall tablet composites a few small images for
nothing and four more full-screen ones for a lot:
  lantern   halloween-lanterns(-lit)-v1-src.png: the four lanterns hung in the
            trees, cropped to each (twine and aura included); the unlit one
            always shown, its lit twin over it after dark
  pumpkin   halloween-lit-v1-src.png against halloween-v1-src.png: each lit
            ground pumpkin and its spill
  bulb      christmas-lit-v1-src.png against christmas-v1-src.png: each lit
            bulb and its halo
  front     birthday-v1-src.png, cut along an outline traced here (FRONT):
            what stands in front of the birthday balloons -- the rock the left
            bunch rises from behind, the presents the right one does
A lit patch is the twin's colour with an alpha that FADES OUT round what the
lighting changed (the difference, dilated and blurred) times the scene's own
alpha -- so its edge never shows as a rectangle where the two webps' rounding
differs. Each patch's place (x, y, w, h in the art's pixels) goes in
manifest.json "patches" and in hk-sky.js's NEAR_PATCHES; --check holds them to
each other and to the sources.

manifest.json is MEASURED here, from the sources, and checked against
hk-sky.js's NEAR_LIGHT: "alpha" is the mean alpha (0..1), "luma" the
alpha-weighted Rec.709 luminance (0..255) -- the luminance cap's inputs for
the near layer (paintSeason). Change the art, rerun this, and copy any
changed pair into NEAR_LIGHT; --check fails until they agree. Needs Pillow
and numpy.
"""
import json, os, re, sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get("HK_NEAR_SRC") or os.path.join(HERE, "src", "near")   # (override: a dry run)
_UP = os.path.abspath(os.path.join(HERE, "..", ".."))
# the component's own tools/sky, or the repository's tools/sky beside
# custom_components/hk_frontend (the same resolution as gen_sky.py)
COMPONENT = (os.path.join(_UP, "custom_components", "hk_frontend")
             if os.path.isdir(os.path.join(_UP, "custom_components", "hk_frontend")) else _UP)
OUT = os.environ.get("HK_NEAR_OUT") or os.path.join(COMPONENT, "frontend", "sky", "near")
SKY_JS = os.path.join(COMPONENT, "frontend", "modules", "hk-sky.js")

THEMES = ("halloween", "christmas", "fall", "summer", "july4", "spring", "winter", "birthday")
NAMES = THEMES + ("balloons",)    # the birthday's two clusters, not a theme of its own
VERSION = "v1"
QUALITY = 90                      # RGB; the alpha plane is lossless (alpha_quality 100)
RGB_MEAN_MAX = 4.0                # mean abs error per channel under alpha > 0


def stem(name):
    return "%s-%s" % (name, VERSION)


# ---- the lighting patches
# kind: (theme, base source, lit source or None, overlay source or None)
PATCH_KINDS = {
    "lantern": ("halloween", None, "halloween-lanterns-lit", "halloween-lanterns"),
    "pumpkin": ("halloween", "halloween", "halloween-lit", None),
    "bulb": ("christmas", "christmas", "christmas-lit", None),
    "front": ("birthday", "birthday", None, None),
}
# The front pieces' outlines, traced on birthday-v1-src.png (x, y): the
# balloons' ribbons go behind them, so each bunch rises from the ground. Left
# tree's first. The edge is feathered a pixel; the piece is the scene's own
# pixels, so where nothing is behind it, it simply matches.
FRONT = [
    # the mossy rock below the left tree, and the bushes in front of it
    [(152, 792), (162, 780), (182, 773), (226, 771), (282, 773), (316, 780), (332, 798), (341, 828),
     (339, 862), (336, 884), (160, 884), (150, 842)],
    # the presents at the right tree's foot: the bow, the three boxes, the
    # hydrangeas in front of them
    [(1430, 742), (1452, 740), (1458, 728), (1478, 722), (1497, 724), (1500, 706), (1515, 704),
     (1522, 716), (1530, 704), (1556, 704), (1566, 716), (1562, 736), (1586, 738), (1586, 884),
     (1492, 884), (1490, 946), (1328, 946), (1326, 858), (1370, 854), (1368, 792), (1430, 788)],
]
BLOCK = 8                         # px: regions are found on an 8 px grid


def regions(mask, gap=2):
    """Bounding boxes (x, y, w, h) of the mask's separate regions: blocks of
    BLOCK px that touch (or come within `gap` blocks) are one region. Sorted
    by x, then y -- left tree first, then right."""
    h, w = mask.shape
    gh, gw = -(-h // BLOCK), -(-w // BLOCK)
    pad = np.zeros((gh * BLOCK, gw * BLOCK), bool)
    pad[:h, :w] = mask
    grid = pad.reshape(gh, BLOCK, gw, BLOCK).any(axis=(1, 3))
    seen = np.zeros_like(grid)
    out = []
    for gy, gx in zip(*np.nonzero(grid)):
        if seen[gy, gx]:
            continue
        stack, cells = [(gy, gx)], []
        seen[gy, gx] = True
        while stack:
            cy, cx = stack.pop()
            cells.append((cy, cx))
            for ny in range(max(0, cy - gap), min(gh, cy + gap + 1)):
                for nx in range(max(0, cx - gap), min(gw, cx + gap + 1)):
                    if grid[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        ys, xs = zip(*cells)
        x0, y0 = min(xs) * BLOCK, min(ys) * BLOCK
        x1, y1 = min(w, (max(xs) + 1) * BLOCK), min(h, (max(ys) + 1) * BLOCK)
        out.append((int(x0), int(y0), int(x1 - x0), int(y1 - y0)))
    return sorted(out, key=lambda r: (r[0] + r[2] / 2 > w / 2, r[1], r[0]))


def patch_sources(kind):
    """[(x, y, w, h), unlit RGBA or None, lit RGBA or None] for each patch of a kind."""
    theme, base, lit, overlay = PATCH_KINDS[kind]
    if lit is None:
        B = rgba(os.path.join(SRC, stem(base) + "-src.png"))
        out = []
        for poly in FRONT:
            m = Image.new("L", (B.shape[1], B.shape[0]), 0)
            ImageDraw.Draw(m).polygon(poly, fill=255)
            f = np.asarray(m.filter(ImageFilter.GaussianBlur(1))).astype(np.float64) / 255.0
            ys, xs = np.nonzero(f > 0.01)
            x, y, w, h = int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
            px = B[y:y + h, x:x + w].copy()
            px[..., 3] = np.round(px[..., 3] * f[y:y + h, x:x + w]).astype(np.uint8)
            out.append(((x, y, w, h), px, None))
        return out
    L = rgba(os.path.join(SRC, stem(lit) + "-src.png"))
    if overlay:
        O = rgba(os.path.join(SRC, stem(overlay) + "-src.png"))
        mask = (O[..., 3] > 8) | (L[..., 3] > 8)
        boxes = regions(mask, gap=3)
        return [(b, O[b[1]:b[1] + b[3], b[0]:b[0] + b[2]], L[b[1]:b[1] + b[3], b[0]:b[0] + b[2]]) for b in boxes]
    B = rgba(os.path.join(SRC, stem(base) + "-src.png"))
    diff = np.abs(L.astype(int) - B.astype(int)).max(axis=2) > 6
    # the lighting's reach, softened: dilate, then blur, to an alpha 0..1. A
    # bulb's is tight; a pumpkin's spill is wide, and two pumpkins side by
    # side are one patch.
    grow, blur = (5, 3) if kind == "bulb" else (9, 6)
    soft = Image.fromarray((diff * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(grow)) \
                                                        .filter(ImageFilter.GaussianBlur(blur))
    f = np.asarray(soft).astype(np.float64) / 255.0
    if kind == "bulb":
        # ONE PATCH A BULB, each twinkling on its own: a 44 px square round
        # each dot of the delivery's control mask (christmas-bulbs), which
        # Codex centred on the painted bulbs
        dots = np.asarray(Image.open(os.path.join(SRC, stem("christmas-bulbs") + "-src.png")).convert("L")) > 128
        h, w = dots.shape
        boxes = []
        for (x, y, bw, bh) in regions(dots, gap=1):
            cx, cy = x + bw // 2, y + bh // 2
            x0, y0 = max(0, cx - 22), max(0, cy - 22)
            boxes.append((x0, y0, min(w, cx + 22) - x0, min(h, cy + 22) - y0))
    else:
        boxes = regions(f > 0.02, gap=2)
    out = []
    for b in boxes:
        x, y, w, h = b
        px = L[y:y + h, x:x + w].copy()
        px[..., 3] = np.round(px[..., 3] * f[y:y + h, x:x + w]).astype(np.uint8)
        out.append((b, None, px))
    return out


def patch_files(kind, i):
    """(unlit file or None, lit file or None) of a kind's i-th patch."""
    theme = PATCH_KINDS[kind][0]
    if PATCH_KINDS[kind][2] is None:
        return "%s-%s-%d-%s.webp" % (theme, kind, i + 1, VERSION), None
    lit = "%s-%s-lit-%d-%s.webp" % (theme, kind, i + 1, VERSION)
    return ("%s-%s-%d-%s.webp" % (theme, kind, i + 1, VERSION) if PATCH_KINDS[kind][3] else None), lit


def near_patches():
    """hk-sky.js's NEAR_PATCHES table, or None."""
    try:
        src = open(SKY_JS).read()
    except OSError:
        return None
    m = re.search(r"var NEAR_PATCHES = (\{.*?\});", src, re.S)
    if not m:
        return None
    body = re.sub(r"([{,]\s*)([A-Za-z0-9_]+)\s*:", r'\1"\2":', m.group(1)).replace("'", '"')
    return json.loads(body)


def rgba(path):
    return np.asarray(Image.open(path).convert("RGBA"))


def measure(px):
    """Mean alpha (0..1) and alpha-weighted Rec.709 luma (0..255)."""
    x = px.astype(np.float64)
    w = x[..., 3] / 255.0
    y = 0.2126 * x[..., 0] + 0.7152 * x[..., 1] + 0.0722 * x[..., 2]
    return round(float(w.mean()), 4), round(float((y * w).sum() / max(w.sum(), 1e-9)), 2)


def near_light():
    """hk-sky.js's NEAR_LIGHT table, or None when it cannot be found."""
    try:
        src = open(SKY_JS).read()
    except OSError:
        return None
    m = re.search(r"var NEAR_LIGHT = (\{.*?\});", src, re.S)
    if not m:
        return None
    body = re.sub(r"([{,]\s*)([A-Za-z0-9_]+)\s*:", r'\1"\2":', m.group(1))
    return json.loads(body)


def check():
    """Every webp present, the same picture as its source. Problems list."""
    problems = []
    man_path = os.path.join(OUT, "manifest.json")
    man = json.load(open(man_path)) if os.path.exists(man_path) else None
    if man is None:
        problems.append("no manifest.json in %s -- run near_webp.py" % OUT)
    for name in NAMES:
        src = os.path.join(SRC, stem(name) + "-src.png")
        webp = os.path.join(OUT, stem(name) + ".webp")
        if not os.path.exists(src):
            problems.append("%s: no source %s" % (name, src))
            continue
        if not os.path.exists(webp):
            problems.append("%s: no %s -- run near_webp.py" % (name, os.path.basename(webp)))
            continue
        a, b = rgba(src), rgba(webp)
        if a.shape != b.shape:
            problems.append("%s: the webp is %sx%s, the source %sx%s"
                            % (name, b.shape[1], b.shape[0], a.shape[1], a.shape[0]))
            continue
        if not np.array_equal(a[..., 3], b[..., 3]):
            problems.append("%s: the webp's ALPHA differs from the source's" % name)
        seen = a[..., 3] > 0
        diff = np.abs(a[..., :3].astype(int) - b[..., :3].astype(int))
        err = diff[seen]
        # as composited: the difference weighted by the (identical) alpha --
        # a near-transparent fringe pixel's colour may move a lot and show none
        shown = diff * (a[..., 3:].astype(np.float64) / 255.0)
        if err.mean() > RGB_MEAN_MAX:
            problems.append("%s: RGB mean error %.2f > %.1f" % (name, err.mean(), RGB_MEAN_MAX))
        alpha, luma = measure(a)
        entry = (man or {}).get(stem(name))
        if man is not None and (not entry or entry.get("alpha") != alpha or entry.get("luma") != luma
                                or entry.get("width") != a.shape[1] or entry.get("height") != a.shape[0]
                                or entry.get("file") != stem(name) + ".webp"):
            problems.append("%s: manifest.json is stale (measured alpha %s, luma %s)" % (name, alpha, luma))
        print("  %-18s alpha identical  rgb err mean %.2f, composited max %3.0f   %5.0f KB of %5.0f KB png"
              % (stem(name) + ".webp", err.mean(), shown.max(),
                 os.path.getsize(webp) / 1024, os.path.getsize(src) / 1024))
    # the lighting patches: each file there, the right size, the manifest and
    # NEAR_PATCHES saying the same places
    want = {}
    for kind, (theme, base, lit, _o) in PATCH_KINDS.items():
        if not os.path.exists(os.path.join(SRC, stem(lit or base) + "-src.png")):
            continue
        for i, (box, unlit_px, lit_px) in enumerate(patch_sources(kind)):
            want.setdefault(theme, []).append([kind] + list(box))
            for fname, px in zip(patch_files(kind, i), (unlit_px, lit_px)):
                if not fname:
                    continue
                path = os.path.join(OUT, fname)
                if not os.path.exists(path):
                    problems.append("%s: no %s -- run near_webp.py" % (kind, fname))
                    continue
                got = rgba(path)
                if got.shape != px.shape or not np.array_equal(got[..., 3], px[..., 3]):
                    problems.append("%s: %s does not match its source region" % (kind, fname))
        print("  %-18s %d patches" % (kind, sum(1 for e in want.get(theme, []) if e[0] == kind)))
    if man is not None and want and man.get("patches") != want:
        problems.append("manifest.json's patches are stale -- run near_webp.py")
    js = near_patches()
    if want and js != want:
        problems.append("NEAR_PATCHES in hk-sky.js is %s, the sources say %s" % (js, want))
    table = near_light()
    if table is None:
        problems.append("NEAR_LIGHT not found in %s" % SKY_JS)
    elif man is not None:
        for name in THEMES:
            entry = man.get(stem(name)) or {}
            if table.get(name) != [entry.get("alpha"), entry.get("luma")]:
                problems.append("NEAR_LIGHT.%s is %s, manifest.json says %s"
                                % (name, table.get(name), [entry.get("alpha"), entry.get("luma")]))
        extra = sorted(set(table) - set(THEMES))
        if extra:
            problems.append("NEAR_LIGHT has themes this tool does not know: %s" % ", ".join(extra))
    return problems


def convert():
    man = {}
    os.makedirs(OUT, exist_ok=True)
    for name in NAMES:
        src = os.path.join(SRC, stem(name) + "-src.png")
        if not os.path.exists(src):
            print("  %-18s missing source %s" % (name, src))
            return False
        im = Image.open(src).convert("RGBA")
        im.save(os.path.join(OUT, stem(name) + ".webp"), "WEBP", quality=QUALITY,
                alpha_quality=100, method=6, exact=False)
        alpha, luma = measure(np.asarray(im))
        man[stem(name)] = {"file": stem(name) + ".webp", "width": im.width,
                           "height": im.height, "alpha": alpha, "luma": luma}
    patches = {}
    for kind, (theme, base, lit, _o) in PATCH_KINDS.items():
        if not os.path.exists(os.path.join(SRC, stem(lit or base) + "-src.png")):
            continue
        for i, (box, unlit_px, lit_px) in enumerate(patch_sources(kind)):
            off, on = patch_files(kind, i)
            if off:
                Image.fromarray(unlit_px).save(os.path.join(OUT, off), "WEBP", quality=QUALITY,
                                               alpha_quality=100, method=6, exact=False)
            if on:
                Image.fromarray(lit_px).save(os.path.join(OUT, on), "WEBP", quality=QUALITY,
                                             alpha_quality=100, method=6, exact=False)
            patches.setdefault(theme, []).append([kind] + list(box))
    if patches:
        man["patches"] = patches
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(man, f, indent=2)
        f.write("\n")
    return True


if __name__ == "__main__":
    check_only = "--check" in sys.argv[1:]
    if not check_only:
        if convert():
            print("  written:  " + ", ".join(stem(n) + ".webp" for n in NAMES) + ", manifest.json")
        else:
            sys.exit("no source PNGs to convert")
    problems = check()
    if problems:
        for p in problems:
            print("  PROBLEM  " + p)
        sys.exit("%d problem(s) -- the committed near art does not match its sources" % len(problems))
    print("  all %d near images match their sources (alpha bit-exact), NEAR_LIGHT agrees" % len(NAMES))
