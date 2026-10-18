"""Realistic clouds: from Codex's source cut-outs to what the page loads.

    python3 tools/sky/cloud_art.py            convert, then verify
    python3 tools/sky/cloud_art.py --check    verify only (nothing is written)

SOURCES  tools/sky/src/clouds/<set>-<nn>-<variant>-v1-src.png   45 clouds x 5
           lightings (day, grey, golden, dusk, night), RGBA, the alpha
           identical across a cloud's lightings; clouds-v1.json lists them.
           CODEX-BRIEF-v1.md is what they were made to. The sources are NOT in
           git (236 MB): they stay in that folder, untracked.
OUTPUT   frontend/sky/clouds/<id>-<variant>.webp   hk-sky.js (Clouds: Realistic)
         frontend/sky/clouds/manifest.json         what hk-sky.js reads

HALF SIZE. A cloud is soft: drawn at twice its stored size it loses nothing a
wall tablet can show, and it costs a quarter of the memory and the download
(the overcast decks keep 5/8, being the whole sky).

LOSSY COLOUR, LOSSLESS ALPHA, as near_webp.py: the soft edge is the cloud --
a lossy alpha plane bands and rings in the wisps.

manifest.json is MEASURED here: each cloud's shipped size, its visual base and
bounds as fractions, its mean alpha (how much of its box it covers), and each
lighting's alpha-weighted Rec.709 luminance -- the luminance cap's inputs
(hk-sky.js paint). Needs Pillow and numpy.
"""
import json, os, sys

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get("HK_CLOUD_SRC") or os.path.join(HERE, "src", "clouds")
_UP = os.path.abspath(os.path.join(HERE, "..", ".."))
COMPONENT = (os.path.join(_UP, "custom_components", "hk_frontend")
             if os.path.isdir(os.path.join(_UP, "custom_components", "hk_frontend")) else _UP)
OUT = os.environ.get("HK_CLOUD_OUT") or os.path.join(COMPONENT, "frontend", "sky", "clouds")
QUALITY = 84
SCALE = {"overcast-deck": 0.625}          # every other set: 0.5
# SOFT EDGES (px at the shipped size): the delivered cut-outs go from solid to
# clear in a pixel or two, which reads as paper, not vapour. Each cloud's rim
# is thinned inward -- its outline's detail kept, not blurred (a blur read as
# out of focus) -- once, from its day lighting, so its five stay identical;
# more for the big near clouds than the small far ones. The wisps, the
# overcast deck and the haze are soft already.
FEATHER = {"cumulus-near": 7.0, "stratocumulus": 7.0, "cumulonimbus": 5.0, "cumulus-mid": 5.0,
           "overcast-patch": 5.0, "altocumulus": 3.0, "cumulus-far": 2.0}
VARIANTS = ("day", "grey", "golden", "dusk", "night")
# DEPTH OF FIELD: every cloud the sky draws at a distance also ships at a
# ladder of smaller widths (<id>-<variant>-w<N>.webp, a hair of blur each).
# The sky picks, by a cloud's distance, the copy it upscales by as much as
# that distance should soften it -- the nearest sharp, the far ones soft --
# for nothing on a tablet: no filter, and less to hold.
SOFT_SETS = ("cumulus-near", "cumulus-large", "cumulus-mid", "cumulus-small", "cumulus-far",
             "stratocumulus", "cumulus-fractus", "cumulus-row", "overcast-patch")
SOFT_WIDTHS = (480, 240, 120, 64, 32)
SOFT_BLUR = 0.5


def luma(px):
    """Alpha-weighted Rec.709 luminance 0..255 of an RGBA array."""
    a = px[..., 3].astype(np.float64) / 255.0
    y = px[..., 0] * 0.2126 + px[..., 1] * 0.7152 + px[..., 2] * 0.0722
    return float((y * a).sum() / max(a.sum(), 1e-9))


def shipped(c, variant):
    """The cloud at its shipped size, as an RGBA array."""
    im = Image.open(os.path.join(SRC, c["files"][variant])).convert("RGBA")
    s = SCALE.get(c["set"], 0.5)
    w, h = max(1, round(c["width"] * s)), max(1, round(c["height"] * s))
    return np.asarray(im.resize((w, h), Image.LANCZOS))


def feather(arrays, radius):
    """The same thinned alpha on every lighting: the outline's own detail kept,
    its rim faded inward over about `radius` px, the body solid."""
    if not radius:
        return arrays
    a = arrays["day"][..., 3]
    near = np.asarray(Image.fromarray(a).filter(ImageFilter.GaussianBlur(radius))).astype(np.float64) / 255.0
    alpha = a.astype(np.float64) * np.clip(near * 1.6 - 0.15, 0, 1) ** 1.1
    alpha = np.round(alpha).astype(np.uint8)
    out = {}
    for v, px in arrays.items():
        q = px.copy(); q[..., 3] = alpha; out[v] = q
    return out


def soft_copy(px, width):
    """A smaller, softened copy of a shipped cloud (alpha and colour blurred
    alike; the colour is bled under the rim, so no halo)."""
    h, w = px.shape[:2]
    fh = max(1, round(h * width / w))
    im = Image.fromarray(px).resize((width, fh), Image.LANCZOS)
    return np.asarray(im.filter(ImageFilter.GaussianBlur(SOFT_BLUR)))


def fade_base(arrays, c):
    """A far bank's underside fades into the haze, not onto a straight line:
    its alpha thins over the lowest fifth of what is drawn (the same on all
    five lightings)."""
    a = arrays["day"][..., 3].astype(np.float64)
    h = a.shape[0]
    ys = np.nonzero(a.max(1) > 4)[0]
    top, bot = ys.min(), ys.max() + 1
    y = np.arange(h)[:, None].astype(np.float64)
    start = bot - (bot - top) * 0.22
    ramp = np.clip((bot - y) / max(bot - start, 1), 0, 1) ** 1.3
    alpha = np.round(a * ramp).astype(np.uint8)
    out = {}
    for v, px in arrays.items():
        q = px.copy(); q[..., 3] = alpha; out[v] = q
    return out


def entry(c, arrays):
    day = arrays["day"]
    h, w = day.shape[:2]
    a = day[..., 3]
    ys, xs = np.nonzero(a > 4)
    return {"id": c["id"], "set": c["set"], "band": c.get("band"), "w": w, "h": h,
            # the visual base and the drawn bounds, as fractions of the box
            # (wisps and fractus have no flat base: their lowest drawn row)
            "base": round((c["base_y"] if c.get("base_y") is not None else c["bbox"][3]) / c["height"], 4),
            "bbox": [round(xs.min() / w, 4), round(ys.min() / h, 4),
                     round((xs.max() + 1) / w, 4), round((ys.max() + 1) / h, 4)],
            "alpha": round(float(a.mean()) / 255.0, 4),
            "luma": {v: round(luma(arrays[v]), 1) for v in VARIANTS}}


def build(write):
    # every delivery's manifest: v1 (CODEX-BRIEF-v1) and v2 (CODEX-BRIEF-v2,
    # more cumulus, horizon rows, cirrus streaks, fractus -- soft-edged as
    # delivered, so FEATHER leaves them be)
    man = {"clouds": []}
    for name in ("clouds-v1.json", "clouds-v2.json"):
        path = os.path.join(SRC, name)
        if os.path.exists(path):
            man["clouds"] += json.load(open(path))["clouds"]
    if write:
        os.makedirs(OUT, exist_ok=True)
    out, problems, total = [], [], 0
    for c in man["clouds"]:
        arrays = feather({v: shipped(c, v) for v in VARIANTS}, FEATHER.get(c["set"], 0))
        if c["set"] == "cumulus-row":
            arrays = fade_base(arrays, c)
        out.append(entry(c, arrays))
        if c["set"] in SOFT_SETS:
            widths = [x for x in SOFT_WIDTHS if x < arrays["day"].shape[1] * 0.8]
            out[-1]["soft"] = widths
            for sw in widths:
                for v in VARIANTS:
                    path = os.path.join(OUT, "%s-%s-w%d.webp" % (c["id"], v, sw))
                    if write:
                        Image.fromarray(soft_copy(arrays[v], sw)).save(path, "WEBP", quality=QUALITY, alpha_quality=100,
                                                                      method=6, exact=False)
                    if not os.path.exists(path):
                        problems.append("missing %s -- run cloud_art.py" % os.path.basename(path))
                    else:
                        total += os.path.getsize(path)
        for v in VARIANTS:
            path = os.path.join(OUT, "%s-%s.webp" % (c["id"], v))
            if write:
                Image.fromarray(arrays[v]).save(path, "WEBP", quality=QUALITY, alpha_quality=100,
                                                         method=6, exact=False)
            if not os.path.exists(path):
                problems.append("missing %s -- run cloud_art.py" % os.path.basename(path))
                continue
            got = np.asarray(Image.open(path).convert("RGBA"))
            total += os.path.getsize(path)
            if got.shape != arrays[v].shape or not np.array_equal(got[..., 3], arrays[v][..., 3]):
                problems.append("%s does not match its source" % os.path.basename(path))
        if any(not np.array_equal(arrays["day"][..., 3], arrays[v][..., 3]) for v in VARIANTS[1:]):
            problems.append("%s: its lightings' alpha differ" % c["id"])
    manifest = {"version": 1, "variants": list(VARIANTS), "clouds": out}
    mpath = os.path.join(OUT, "manifest.json")
    if write:
        with open(mpath, "w") as f:
            json.dump(manifest, f, indent=1)
            f.write("\n")
    elif not os.path.exists(mpath) or json.load(open(mpath)) != manifest:
        problems.append("manifest.json is stale -- run cloud_art.py")
    files = sum(len(VARIANTS) * (1 + len(c.get("soft", []))) for c in out)
    print("  %d clouds, %d files, %.1f MB shipped" % (len(out), files, total / 1e6))
    return problems


if __name__ == "__main__":
    problems = build("--check" not in sys.argv[1:])
    for p in problems:
        print("  PROBLEM  " + p)
    if problems:
        sys.exit("%d problem(s)" % len(problems))
    print("  all clouds match their sources (alpha bit-exact)")
