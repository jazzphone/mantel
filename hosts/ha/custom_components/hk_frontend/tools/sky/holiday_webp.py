"""The forecast screensaver's holiday art: from the delivered PNGs to what the
page loads (HK Frontend 1.5).

    python3 tools/sky/holiday_webp.py            check, then convert
    python3 tools/sky/holiday_webp.py --check    check only

SOURCES  tools/sky/src/land-holiday/                (hk_house/docs/CODEX-PROMPT-HOLIDAY-LANDSCAPES.md)
           land-<holiday>-<light>-src.png           8 landscapes: a season's land, decorated
           land-<holiday>-<light>-lights.png        5 lights layers: the full glow over the land's embers
           birthday-balloons-<light>-src.png        3 overlays: two clusters of balloons
           DONE.json                                their manifest: checksums, lights, balloon knots
         tools/sky/src/land/                        the 12 season lands they were made from
OUTPUT   frontend/sky/land-<holiday>-<light>.webp, land-<holiday>-<light>-lights.webp,
         birthday-<cluster>-<light>.webp, holiday.json   (hk-sky.js scene())

THE ART'S CONTRACT, held here rather than trusted: all 16 there, 2560 x 1600
RGBA, matching DONE.json's checksums, the top 34% clear; each landscape its
base season's land outside its decorations (the page cross-fades between the
two, and between a holiday's lights); nothing new over the forecast's place.

THE ALPHA. A landscape takes its base season's REPAIRED mask (land_webp.py's
repair_alpha, the same one the season's own webp has), so the two outlines
agree to the pixel; only where a decoration pokes past it (a bulb on a crown's
edge) does the holiday's own alpha add to it.

holiday.json, what the page places by (art pixels, 2560 x 1600):
  {"lights":   {"land-christmas-night-lights": [[x, y, r, "bulb"], ...], ...},
   "balloons": [{"cluster": "left", "box": [x, y, w, h], "knot": [x, y],
                "at": [x, y], "scale": s}, ...]}
(box and knot as cut from the overlay; drawn at `scale`, its knot at `at`)
The lights come from DONE.json's lists, or -- when a file has none -- are
found in the layer itself (its bright cores). Needs Pillow and numpy.
"""
import hashlib, json, os, sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import land_webp  # noqa: E402  (repair_alpha, and where the season lands live)

# the v6 delivery (CODEX-BRIEF-v6: the season lands decorated like the
# dashboards) when it is there, else the 1.5 one
SRC = (os.environ.get("HK_HOLIDAY_SRC") or
       (os.path.join(HERE, "src", "land-v6", "land-holiday")
        if os.path.isdir(os.path.join(HERE, "src", "land-v6", "land-holiday"))
        else os.path.join(HERE, "src", "land-holiday")))
BASE_SRC = land_webp.SRC
OUT = land_webp.OUT
W, H = land_webp.W, land_webp.H
CLEAR_TO = land_webp.CLEAR_TO
QUALITY = land_webp.QUALITY
FORECAST_FROM = 1060              # nothing new below this (the forecast's place)
SAME = 2                          # "unchanged" is within this, per channel
DECOR = 8                         # a decoration differs from its base by more than this

LANDS = [  # (holiday, light, base season)
    ("halloween", "dusk", "fall"), ("halloween", "night", "fall"),
    ("christmas", "day", "winter"), ("christmas", "dusk", "winter"), ("christmas", "night", "winter"),
    ("july4", "day", "summer"), ("july4", "dusk", "summer"), ("july4", "night", "summer"),
]
# v6 (tools/sky/src/land-v6, CODEX-BRIEF-v6): Halloween by day too, when its
# file is there
if os.path.exists(os.path.join(SRC, "land-halloween-day-src.png")):
    LANDS.insert(0, ("halloween", "day", "fall"))
# ...and a birthday's props (cafe lights, presents): an overlay over any
# season, as the balloons are, with its lights at dusk and night
PROPS = os.path.exists(os.path.join(SRC, "birthday-props-day-src.png"))
LIGHTS = [("halloween", "dusk"), ("halloween", "night"), ("christmas", "dusk"),
          ("christmas", "night"), ("july4", "night")]
BALLOON_LIGHTS = ("day", "dusk", "night")
# WHERE THE BALLOONS STAND: as delivered they were tied to the trunks and
# floated across the crowns, nearly a tree's size. On the page each cluster
# is drawn at BALLOON_SCALE, its knot staked in the grass beside its tree
# (BALLOON_AT, art pixels), so a bunch of balloons reads as a bunch of
# balloons in front of a fifteen-metre maple.
BALLOON_SCALE = 0.45
BALLOON_AT = {"left": (1158, 1016), "right": (1632, 1024)}


def land_name(h, l):
    return "land-%s-%s-src.png" % (h, l)


def lights_name(h, l):
    return "land-%s-%s-lights.png" % (h, l)


def balloon_name(l):
    return "birthday-balloons-%s-src.png" % l


def all_names():
    return ([land_name(h, l) for h, l, _ in LANDS] + [lights_name(h, l) for h, l in LIGHTS]
            + [balloon_name(l) for l in BALLOON_LIGHTS])


def rgba(im):
    return np.asarray(im).astype(np.int16)


def changed(a, b, by):
    """Where two RGBA images differ by more than `by` in any channel."""
    return (np.abs(rgba(a) - rgba(b)) > by).any(axis=2)


def components(mask, scale=4):
    """The separate islands of a boolean mask, biggest first, as full-size
    boolean masks. Found on a dilated, downscaled copy, so a balloon string a
    pixel wide still joins its cluster."""
    work = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9))
    work = work.resize((mask.shape[1] // scale, mask.shape[0] // scale), Image.NEAREST).copy()
    label, found = 1, []
    while label <= 250:
        ys, xs = np.nonzero(np.asarray(work) == 255)
        if not len(ys):
            break
        ImageDraw.floodfill(work, (int(xs[0]), int(ys[0])), label)
        found.append(label)
        label += 1
    lab = np.asarray(work.resize((mask.shape[1], mask.shape[0]), Image.NEAREST))
    out = [(lab == v) & mask for v in found]
    return sorted([m for m in out if m.sum()], key=lambda m: -int(m.sum()))


def check():
    problems = []
    done = os.path.join(SRC, "DONE.json")
    if not os.path.exists(done):
        return ["no DONE.json in %s" % SRC], {}, {}
    man = json.load(open(done))
    listed = {f.get("name"): f for f in man.get("files", [])}
    for k, v in (man.get("checks") or {}).items():
        # holes the BASE lands already had (and the delivery may not touch)
        # are filled here anyway: convert() puts the base's repaired mask on
        if k == "no_alpha_holes" and man["checks"].get("no_new_alpha_holes") is True:
            continue
        if v is not True:
            problems.append("DONE.json says %s is %r" % (k, v))
    imgs = {}
    for name in all_names():
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
        top = im.getchannel("A").crop((0, 0, W, CLEAR_TO)).getextrema()
        if top[1] != 0:
            problems.append("%s: the top 34%% is not fully transparent (max alpha %d)" % (name, top[1]))
        imgs[name] = im
    # each landscape: its base outside the decorations, nothing over the forecast
    foot = {}
    for h, l, season in LANDS:
        im = imgs.get(land_name(h, l))
        base_path = os.path.join(BASE_SRC, "land-%s-%s-src.png" % (season, l))
        if im is None or not os.path.exists(base_path):
            continue
        base = Image.open(base_path).convert("RGBA")
        diff = changed(im, base, SAME)
        low = diff[FORECAST_FROM:, :].mean()
        if low > 0.002:
            problems.append("%s: %.1f%% of the forecast's place (y > %d) differs from %s"
                            % (land_name(h, l), low * 100, FORECAST_FROM, os.path.basename(base_path)))
        whole = diff.mean()
        if whole > 0.25:
            problems.append("%s differs from its base on %.0f%% of the frame -- redrawn, not decorated"
                            % (land_name(h, l), whole * 100))
        foot[(h, l)] = changed(im, base, DECOR)
    # the same decorations in every light of a holiday (their footprints overlap)
    for h in ("halloween", "christmas", "july4"):
        fs = [foot[k] for k in foot if k[0] == h]
        for f in fs[1:]:
            a, b = fs[0], f
            union = (a | b).sum()
            if union and (a & b).sum() / float(union) < 0.25:
                problems.append("%s: its lights' decorations are not in the same places" % h)
    # the balloons: the same footprint in every light, two clusters
    ref = None
    for l in BALLOON_LIGHTS:
        im = imgs.get(balloon_name(l))
        if im is None:
            continue
        m = np.asarray(im.getchannel("A")) > 127
        if ref is None:
            ref = m
            n = len([c for c in components(m) if c.sum() > 2000])
            if n != 2:
                problems.append("%s has %d balloon clusters, not 2" % (balloon_name(l), n))
        elif (ref ^ m).mean() > 0.003:
            problems.append("%s: its balloons are not where the day's are" % balloon_name(l))
    return problems, imgs, man


def find_lights(im, candle):
    """A lights layer's light sources, when DONE.json does not list them: the
    peaks of its brightness. Candles are found at a coarser scale -- a
    pumpkin's whole face is one light."""
    a = np.asarray(im).astype(np.float32)
    v = (a[:, :, 0] * 0.3 + a[:, :, 1] * 0.59 + a[:, :, 2] * 0.11) * (a[:, :, 3] / 255.0)
    g = Image.fromarray(np.clip(v, 0, 255).astype(np.uint8))
    if candle:
        g = g.filter(ImageFilter.GaussianBlur(12))
    peak = np.asarray(g.filter(ImageFilter.MaxFilter(61 if candle else 9)))
    lv = np.asarray(g)
    thr = max(60, int(lv.max() * (0.45 if candle else 0.6)))
    ys, xs = np.nonzero((lv == peak) & (lv >= thr))
    pts = []
    for x, y in sorted(zip(xs.tolist(), ys.tolist()), key=lambda p: -int(lv[p[1], p[0]])):
        if all((x - px) ** 2 + (y - py) ** 2 > (40 if candle else 6) ** 2 for px, py, _, _ in pts):
            pts.append([int(x), int(y), 20 if candle else 4, "candle" if candle else "bulb"])
    return pts


def lights_of(man, name, im, candle):
    for f in man.get("files", []):
        if f.get("name") == name and f.get("lights"):
            out = []
            for L in f["lights"]:
                out.append([int(round(L["x"])), int(round(L["y"])), int(round(L.get("r", 20 if candle else 4))),
                            L.get("kind") or ("candle" if candle else "bulb")])
            return out, "DONE.json"
    return find_lights(im, candle), "found"


def anchors_of(man):
    for f in man.get("files", []):
        if f.get("kind") == "overlay" and f.get("anchors"):
            return {a["cluster"]: (int(round(a["x"])), int(round(a["y"]))) for a in f["anchors"]}
    return {}


def save(im, name):
    dest = os.path.join(OUT, name)
    im.save(dest, "WEBP", quality=QUALITY, method=6, exact=False)
    print("  %-34s %5d KB" % (name, os.path.getsize(dest) // 1024))


def convert(imgs, man):
    data = {"lights": {}, "balloons": []}
    masks = {}
    for h, l, season in LANDS:
        im = imgs[land_name(h, l)]
        if season not in masks:
            day = Image.open(os.path.join(BASE_SRC, "land-%s-day-src.png" % season))
            masks[season], _ = land_webp.repair_alpha(day.getchannel("A"))
        base = Image.open(os.path.join(BASE_SRC, "land-%s-%s-src.png" % (season, l))).convert("RGBA")
        deco = np.asarray(Image.fromarray((changed(im, base, DECOR) * 255).astype(np.uint8))
                          .filter(ImageFilter.MaxFilter(5))) > 0
        alpha = np.asarray(masks[season]).copy()
        own = np.asarray(im.getchannel("A"))
        alpha[deco] = np.maximum(alpha[deco], own[deco])
        alpha[:CLEAR_TO, :] = 0
        out = im.copy()
        out.putalpha(Image.fromarray(alpha))
        save(out, "land-%s-%s.webp" % (h, l))
    for h, l in LIGHTS:
        name = lights_name(h, l)
        im = imgs[name].copy()
        a = np.asarray(im.getchannel("A")).copy()
        a[:CLEAR_TO, :] = 0
        im.putalpha(Image.fromarray(a))
        save(im, "land-%s-%s-lights.webp" % (h, l))
        pts, how = lights_of(man, name, imgs[name], h == "halloween")
        data["lights"]["land-%s-%s-lights" % (h, l)] = pts
        print("    %d lights (%s)" % (len(pts), how))
    # the balloons: each cluster its own sprite, cut on the day's footprint
    # (the same in every light), with its knot
    day = imgs[balloon_name("day")]
    m = np.asarray(day.getchannel("A")) > 8
    clusters = [c for c in components(m) if c.sum() > 2000][:2]
    clusters.sort(key=lambda c: np.nonzero(c)[1].mean())
    knots = anchors_of(man)
    for c, side in zip(clusters, ("left", "right")):
        ys, xs = np.nonzero(c)
        pad = 12
        x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad)
        x1, y1 = min(W, xs.max() + pad + 1), min(H, ys.max() + pad + 1)
        knot = knots.get(side)
        if not knot:                       # the string's end: the cluster's lowest point
            yb = ys.max()
            knot = (int(xs[ys == yb].mean()), int(yb))
        keep = Image.fromarray((np.asarray(Image.fromarray((c * 255).astype(np.uint8))
                                           .filter(ImageFilter.MaxFilter(9))) > 0).astype(np.uint8) * 255)
        for l in BALLOON_LIGHTS:
            im = imgs[balloon_name(l)].copy()
            a = ImageChops.multiply(im.getchannel("A"), keep)
            im.putalpha(a)
            save(im.crop((x0, y0, x1, y1)), "birthday-%s-%s.webp" % (side, l))
        data["balloons"].append({"cluster": side, "box": [int(x0), int(y0), int(x1 - x0), int(y1 - y0)],
                                 "knot": [int(knot[0]), int(knot[1])],
                                 "at": list(BALLOON_AT[side]), "scale": BALLOON_SCALE})
        print("    %s cluster: box %s, knot %s" % (side, data["balloons"][-1]["box"], knot))
    if PROPS:
        # one box round what the props draw in any light (and their glow)
        ims = {l: Image.open(os.path.join(SRC, "birthday-props-%s-src.png" % l)).convert("RGBA") for l in BALLOON_LIGHTS}
        glow = {l: Image.open(os.path.join(SRC, "birthday-props-%s-lights.png" % l)).convert("RGBA")
                for l in ("dusk", "night") if os.path.exists(os.path.join(SRC, "birthday-props-%s-lights.png" % l))}
        m = np.zeros((H, W), bool)
        for im in list(ims.values()) + list(glow.values()):
            m |= np.asarray(im.getchannel("A")) > 4
        ys, xs = np.nonzero(m)
        pad = 8
        x0, y0 = max(0, xs.min() - pad), max(0, ys.min() - pad)
        x1, y1 = min(W, xs.max() + pad + 1), min(H, ys.max() + pad + 1)
        for l, im in ims.items():
            save(im.crop((x0, y0, x1, y1)), "birthday-props-%s.webp" % l)
        for l, im in glow.items():
            save(im.crop((x0, y0, x1, y1)), "birthday-props-%s-lights.webp" % l)
        data["props"] = {"box": [int(x0), int(y0), int(x1 - x0), int(y1 - y0)], "lights": sorted(glow)}
        print("    birthday props: box %s, lights %s" % (data["props"]["box"], sorted(glow)))
    with open(os.path.join(OUT, "holiday.json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print("  holiday.json %d KB" % (os.path.getsize(os.path.join(OUT, "holiday.json")) // 1024))


if __name__ == "__main__":
    problems, imgs, man = check()
    for p in problems:
        print("PROBLEM:", p)
    if problems:
        sys.exit(1)
    print("all 16 checked: 2560x1600 RGBA, checksums match, top 34% clear, decorated not redrawn")
    if "--check" not in sys.argv:
        convert(imgs, man)
