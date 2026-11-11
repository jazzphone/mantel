"""Check the holiday scenes' artwork (ARTWORK-REQUEST.md) and composite it for review.

    ~/.venvs/mantel/bin/python check_assets.py              # everything
    ~/.venvs/mantel/bin/python check_assets.py room         # one scene: room or haunt

Needs Pillow and NumPy. Prints PASS, FAIL or MISSING per check and writes output/preview-<scene>-<screen>.png: the pieces
placed where references/placements.json says, at each screen size. HOLIDAY_ART_OUT reads and writes another folder (for
testing this script). Exit status 1 if anything fails or is missing. Writes nothing outside output/.
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
OUT = Path(os.environ.get("HOLIDAY_ART_OUT") or HERE / "output")
PLACE = json.loads((HERE / "references/placements.json").read_text())

# name: (width, height, kind). opaque: no transparency at all. tile: opaque, and seamless both ways. band: opaque, seamless
# left to right. sprite: a cut-out, its edges transparent. strip: a cut-out, seamless left to right
ASSETS = {
    "room": {
        "room-wall.png": (1024, 1024, "tile"), "room-wainscot.png": (2048, 400, "band"), "room-carpet.png": (1024, 1024, "tile"),
        "room-window-outside.png": (1000, 920, "opaque"), "room-window.png": (1160, 1136, "sprite"), "room-couch.png": (1240, 656, "sprite"),
        "room-tree.png": (1348, 2152, "sprite"), "room-presents.png": (1400, 272, "sprite"), "room-tv.png": (2000, 1515, "sprite"),
        "room-tv-antenna.png": (908, 288, "sprite"), "room-stand.png": (2004, 232, "sprite"),
        # round 3 (ROUND-3.md): the TV, VCR and stand as one entertainment center; the presents as a staggered pile
        "room-entertainment-center.png": (2400, 1600, "sprite"), "room-presents-pile.png": (1600, 720, "sprite"),
    },
    "haunt": {
        "haunt-sky.png": (2560, 1600, "opaque"), "haunt-house.png": (2368, 2048, "sprite"), "haunt-house-lit.png": (2368, 2048, "overlay"),
        "haunt-shutter.png": (180, 380, "sprite"), "haunt-tree.png": (936, 1328, "sprite"), "haunt-grounds.png": (3200, 780, "strip"),
        "haunt-stone.png": (1640, 1700, "sprite"), "haunt-grass.png": (2048, 184, "strip"), "haunt-pumpkin-large.png": (480, 480, "sprite"),
        "haunt-pumpkin-small.png": (480, 480, "sprite"),
    },
}
TV_HOLE = (76, 76, 1924, 1295)          # room-tv.png: the screen's opening
TV_CORNER = (166, 134)                  # ...its corners: rounded this far across and down (code draws the picture to the same shape)
UNIT_HOLE = (600, 220, 1800, 1130)      # room-entertainment-center.png: its TV's screen opening
UNIT_CORNER = (108, 100)
UNIT_CLOCK = (1000, 1290, 1260, 1360)   # ...and its VCR's dark clock window
CARPET = (95, 140)                      # room-carpet.png: oatmeal, its mean brightness
BULB_TINT = {"red": 0, "green": 1, "blue": 2}
PANES = (180, 120, 980, 880)            # room-window.png: the glass, between the drapes
CLOCK = (420, 70, 700, 162)             # room-stand.png: the VCR's dark clock window
STONE_FACE = (0.15, 0.18, 0.85, 0.92)   # haunt-stone.png: left clean for the carved words, as shares of its size
LUMA = np.array([0.299, 0.587, 0.114])
fails = 0


def say(ok, what, got=""):
    global fails
    if not ok:
        fails += 1
    print(("PASS " if ok else "FAIL ") + what + ("" if ok or got == "" else f"   got {got}"))
    return ok


def load(name):
    return np.asarray(Image.open(OUT / name).convert("RGBA"), dtype=np.float32)


def seam(a, axis):
    """How much the seam differs, against how much neighboring lines differ anywhere else in the picture: 1 is invisible."""
    rgb = a[..., :3]
    n = rgb.shape[axis]
    wrap = np.abs(np.take(rgb, 0, axis) - np.take(rgb, n - 1, axis)).mean()
    inner = np.abs(np.take(rgb, n // 2, axis) - np.take(rgb, n // 2 + 1, axis)).mean()
    return wrap / max(inner, 1.0)


def common(name, want):
    p = OUT / name
    if not p.exists():
        return say(False, f"{name}: MISSING"), None
    w, h, kind = want
    im = Image.open(p)
    ok = say(im.format == "PNG", f"{name}: a PNG", im.format)
    ok &= say(im.size == (w, h), f"{name}: {w} x {h}", im.size)
    ok &= say(im.mode == "RGBA", f"{name}: RGBA", im.mode)
    if im.size != (w, h):
        return False, None
    a = load(name)
    al = a[..., 3]
    if kind in ("opaque", "tile", "band"):
        ok &= say(al.min() == 255, f"{name}: fully opaque", f"min alpha {al.min():.0f}")
    if kind in ("sprite", "overlay"):
        edge = np.concatenate([al[0], al[-1], al[:, 0], al[:, -1]])
        ok &= say((edge == 0).mean() >= 0.45, f"{name}: a real cut-out (transparent along its edges)", f"{(edge == 0).mean():.2f}")
    if kind in ("sprite", "strip"):
        solid, thin = al > 230, (al > 5) & (al < 90)
        if solid.any() and thin.any():
            le, ls = (a[..., :3][thin] @ LUMA).mean(), (a[..., :3][solid] @ LUMA).mean()
            ok &= say(abs(le - ls) <= 70, f"{name}: no dark or light halo at its edges", f"{le:.0f} vs {ls:.0f}")
    if kind in ("tile",):
        ok &= say(seam(a, 0) <= 2.2 and seam(a, 1) <= 2.2, f"{name}: seamless both ways", f"{seam(a, 0):.2f}, {seam(a, 1):.2f}")
    if kind in ("band", "strip"):
        ok &= say(seam(a, 1) <= 2.2, f"{name}: seamless left to right", f"{seam(a, 1):.2f}")
    if kind != "overlay":
        body = a[..., :3][al > 200] @ LUMA
        ok &= say(body.size > 0 and body.std() >= 4, f"{name}: has texture, not a flat fill", f"{body.std() if body.size else 0:.1f}")
    return ok, a


def rounded_hole(a, name, b, corner):
    """An opening with elliptical corners: clear inside them, the case in them."""
    ys, xs = np.mgrid[b[1]:b[3], b[0]:b[2]]
    rx, ry = corner
    dx = np.maximum(np.maximum(b[0] + rx - xs, xs - (b[2] - 1 - rx)), 0) / rx
    dy = np.maximum(np.maximum(b[1] + ry - ys, ys - (b[3] - 1 - ry)), 0) / ry
    r = np.hypot(dx, dy)
    al = a[b[1]:b[3], b[0]:b[2], 3]
    say(al[r < .97].max() == 0, f"{name}: the rounded screen opening is fully transparent", f"max alpha {al[r < .97].max():.0f}")
    say(al[r > 1.03].min() == 255, f"{name}: the case fills the opening's corners", f"min alpha {al[r > 1.03].min():.0f}")


def box_alpha(a, b):
    return a[b[1]:b[3], b[0]:b[2], 3]


def check_room(arts):
    wall = arts.get("room-wall.png")
    if wall is not None:
        say((wall[..., :3] @ LUMA).mean() <= 85, "room-wall.png: dark enough for white words over it", f"mean {(wall[..., :3] @ LUMA).mean():.0f}")
    cp = arts.get("room-carpet.png")
    if cp is not None:
        m = (cp[..., :3] @ LUMA).mean()
        say(CARPET[0] <= m <= CARPET[1], "room-carpet.png: oatmeal, not brown", f"mean {m:.0f}")
    tv = arts.get("room-tv.png")
    if tv is not None:
        b = TV_HOLE
        ys, xs = np.mgrid[b[1]:b[3], b[0]:b[2]]
        rx, ry = TV_CORNER
        dx = np.maximum(np.maximum(b[0] + rx - xs, xs - (b[2] - 1 - rx)), 0) / rx
        dy = np.maximum(np.maximum(b[1] + ry - ys, ys - (b[3] - 1 - ry)), 0) / ry
        r = np.hypot(dx, dy)                # under 1 is inside the rounded opening
        al = box_alpha(tv, b)
        say(al[r < .97].max() == 0, "room-tv.png: the rounded opening is fully transparent", f"max alpha {al[r < .97].max():.0f}")
        say(al[r > 1.03].min() == 255, "room-tv.png: the case fills the opening's corners", f"min alpha {al[r > 1.03].min():.0f}")
        say(tv[b[1] - 30:b[1] - 8, 400:1600, 3].min() == 255 and tv[b[3] + 8:b[3] + 30, 400:1600, 3].min() == 255, "room-tv.png: its case closes around the screen")
    win = arts.get("room-window.png")
    if win is not None:
        share = (box_alpha(win, PANES) == 0).mean()
        say(0.72 <= share <= 0.97, "room-window.png: the glass is transparent, the bars solid", f"{share:.2f} of the panes")
    un = arts.get("room-entertainment-center.png")
    if un is not None:
        rounded_hole(un, "room-entertainment-center.png", UNIT_HOLE, UNIT_CORNER)
        b = UNIT_CLOCK
        lum = un[b[1]:b[3], b[0]:b[2], :3] @ LUMA
        say(lum.mean() <= 30 and un[b[1]:b[3], b[0]:b[2], 3].min() == 255, "room-entertainment-center.png: the VCR's clock window is dark, opaque and blank", f"mean {lum.mean():.0f}")
        say((un[-6:, 300:2100, 3] > 128).mean() >= .6, "room-entertainment-center.png: it stands on its bottom edge")
    st = arts.get("room-stand.png")
    if st is not None:
        lum = st[CLOCK[1]:CLOCK[3], CLOCK[0]:CLOCK[2], :3] @ LUMA
        say(lum.mean() <= 30 and st[CLOCK[1]:CLOCK[3], CLOCK[0]:CLOCK[2], 3].min() == 255, "room-stand.png: the clock window is dark, opaque and blank", f"mean {lum.mean():.0f}")
    p = OUT / "room-tree-bulbs.json"
    tree = arts.get("room-tree.png")
    if not p.exists():
        say(False, "room-tree-bulbs.json: MISSING")
    elif tree is not None:
        try:
            bulbs = json.loads(p.read_text())
            shape_ok = isinstance(bulbs, list) and all(isinstance(b, dict) and {"x", "y", "color"} <= set(b) for b in bulbs)
        except ValueError:
            bulbs, shape_ok = [], False
        if say(shape_ok, "room-tree-bulbs.json: a list of {x, y, color}"):
            say(60 <= len(bulbs) <= 110, "room-tree-bulbs.json: 60 to 110 bulbs", len(bulbs))
            say({b["color"] for b in bulbs} == {"red", "green", "gold", "blue"}, "room-tree-bulbs.json: red, green, gold and blue", {b["color"] for b in bulbs})
            on = [0 <= int(b["x"]) < tree.shape[1] and 0 <= int(b["y"]) < tree.shape[0] and tree[int(b["y"]), int(b["x"]), 3] > 128 for b in bulbs]
            say(all(on), "room-tree-bulbs.json: every bulb is on the tree", f"{on.count(False)} off it")
            # each entry's color is the painted bulb's own tint: a painted red bulb must not light up blue
            hits = n = 0
            for b in bulbs:
                x, y = int(b["x"]), int(b["y"])
                m = tree[max(y - 4, 0):y + 5, max(x - 4, 0):x + 5, :3].reshape(-1, 3).mean(axis=0)
                n += 1
                if b["color"] == "gold":
                    hits += m[0] > m[2] * 1.15 and m[1] > m[2] * 1.05
                else:
                    hits += int(np.argmax(m)) == BULB_TINT[b["color"]]
            say(hits / max(n, 1) >= .85, "room-tree-bulbs.json: each color matches its painted bulb", f"{hits} of {n}")


def check_haunt(arts):
    sky = arts.get("haunt-sky.png")
    if sky is not None:
        lum = sky[..., :3] @ LUMA
        say(lum[:520, :900].mean() <= 70 and lum[:520, :900].std() <= 24, "haunt-sky.png: top left dark and calm, for the corner's words",
            f"mean {lum[:520, :900].mean():.0f}, spread {lum[:520, :900].std():.0f}")
        say(lum[:160, 1700:].mean() <= 80, "haunt-sky.png: top right dark enough for House Status", f"{lum[:160, 1700:].mean():.0f}")
    house, lit = arts.get("haunt-house.png"), arts.get("haunt-house-lit.png")
    if house is not None and lit is not None:
        outside = ((lit[..., 3] > 16) & (house[..., 3] < 128)).sum() / max(1, (lit[..., 3] > 16).sum())
        say(outside <= 0.01, "haunt-house-lit.png: light only on the house", f"{outside:.3f} outside it")
        share = (lit[..., 3] > 128).mean()
        say(0.005 <= share <= 0.12, "haunt-house-lit.png: only the lit windows", f"{share:.3f} of the frame")
        h = house[house[..., 3] > 200, :3] @ LUMA
        say(h.mean() <= 75, "haunt-house.png: a dark house, windows unlit", f"mean {h.mean():.0f}")
    p = OUT / "haunt-windows.json"
    if not p.exists():
        say(False, "haunt-windows.json: MISSING")
    elif lit is not None:
        try:
            w = json.loads(p.read_text())
            rows = w["windows"]
            shape_ok = all({"x", "y", "w", "h"} <= set(r) for r in rows) and isinstance(w["figure"], int) and isinstance(w["shutter"], int)
        except (ValueError, KeyError, TypeError):
            rows, shape_ok = [], False
        if say(shape_ok, "haunt-windows.json: {windows: [{x, y, w, h}], figure, shutter}"):
            say(4 <= len(rows) <= 10, "haunt-windows.json: 4 to 10 lit windows", len(rows))
            on = [lit[r["y"] + r["h"] // 2, r["x"] + r["w"] // 2, 3] > 128 for r in rows]
            say(all(on), "haunt-windows.json: each one is lit in haunt-house-lit.png", f"{on.count(False)} dark")
            say(0 <= w["figure"] < len(rows) and 0 <= w["shutter"] < len(rows) and w["figure"] != w["shutter"], "haunt-windows.json: figure and shutter are two different windows")
    st = arts.get("haunt-stone.png")
    if st is not None:
        H, W = st.shape[:2]
        b = (int(W * STONE_FACE[0]), int(H * STONE_FACE[1]), int(W * STONE_FACE[2]), int(H * STONE_FACE[3]))
        face = st[b[1]:b[3], b[0]:b[2]]
        lum = face[..., :3] @ LUMA
        say(face[..., 3].min() == 255, "haunt-stone.png: its face is solid")
        say(115 <= lum.mean() <= 205, "haunt-stone.png: its face is light enough for dark carved words", f"mean {lum.mean():.0f}")
        say(lum.std() <= 24, "haunt-stone.png: its face is clean: no words, cracks or moss where the words go", f"spread {lum.std():.0f}")
    gr = arts.get("haunt-grounds.png")
    if gr is not None:
        say(gr[-40:, :, 3].min() == 255, "haunt-grounds.png: solid along its foot")
        say(gr[:40, :, 3].max() == 0, "haunt-grounds.png: clear along its top", f"max alpha {gr[:40, :, 3].max():.0f}")


def fit(im, box):
    """The piece in its box, at its own shape, standing on the box's foot."""
    x, y, w, h = box
    k = min(w / im.width, h / im.height)
    nw, nh = max(1, round(im.width * k)), max(1, round(im.height * k))
    return im.resize((nw, nh), Image.LANCZOS), (round(x + (w - nw) / 2), round(y + h - nh))


def put(canvas, name, box):
    if box and (OUT / name).exists():
        im, at = fit(Image.open(OUT / name).convert("RGBA"), box)
        canvas.alpha_composite(im, (max(at[0], 0), max(at[1], 0))) if at[0] >= 0 and at[1] >= 0 else canvas.paste(im, at, im)


def tile(canvas, name, box, scale):
    p = OUT / name
    if not p.exists():
        return
    im = Image.open(p).convert("RGBA")
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    x, y, w, h = [round(v) for v in box]
    for ty in range(y, y + h, im.height):
        for tx in range(x, x + w, im.width):
            canvas.paste(im.crop((0, 0, min(im.width, x + w - tx), min(im.height, y + h - ty))), (tx, ty))


def font(px):
    for f in ("/System/Library/Fonts/Supplemental/Courier New Bold.ttf", "/System/Library/Fonts/Menlo.ttc"):
        try:
            return ImageFont.truetype(f, max(8, round(px)))
        except OSError:
            continue
    return ImageFont.load_default()


def preview_room(key, v):
    c = Image.new("RGBA", (round(v["w"]), round(v["h"])), "#101010")
    z = v["z"]
    tile(c, "room-wall.png", (0, 0, v["w"], v["borderY"]), z / 2)
    if (OUT / "room-wainscot.png").exists():
        band = Image.open(OUT / "room-wainscot.png").convert("RGBA")
        h = round(v["floorY"] - v["borderY"])
        band = band.resize((max(1, round(band.width * h / band.height)), h), Image.LANCZOS)
        for x in range(0, c.width, band.width):
            c.paste(band, (x, round(v["borderY"])))
    tile(c, "room-carpet.png", (0, v["floorY"], v["w"], v["h"] - v["floorY"]), z / 2)
    put(c, "room-window-outside.png", v["outside"])
    put(c, "room-window.png", v["window"])
    put(c, "room-couch.png", v["couch"])
    put(c, "room-tree.png", v["tree"])
    bp = OUT / "room-tree-bulbs.json"
    if bp.exists() and (OUT / "room-tree.png").exists():
        k = min(v["tree"][2] / 1348, v["tree"][3] / 2152)
        ox, oy = v["tree"][0] + (v["tree"][2] - 1348 * k) / 2, v["tree"][1] + v["tree"][3] - 2152 * k
        d = ImageDraw.Draw(c, "RGBA")
        for b in json.loads(bp.read_text()):
            col = {"red": (255, 70, 60), "green": (70, 220, 110), "gold": (255, 200, 60), "blue": (80, 150, 255)}.get(b.get("color"), (255, 255, 255))
            x, y = ox + b["x"] * k, oy + b["y"] * k
            d.ellipse((x - 3, y - 3, x + 3, y + 3), fill=col + (235,))
    if (OUT / "room-presents-pile.png").exists() and v.get("pile"):
        put(c, "room-presents-pile.png", v["pile"])
    else:
        put(c, "room-presents.png", v["presents"])
    if (OUT / "room-entertainment-center.png").exists() and v.get("unit"):
        x, y, w, h = v["unit"]
        k = min(w / 2400, h / 1600)
        ox, oy = x + (w - 2400 * k) / 2, y + h - 1600 * k
        hole = (ox + UNIT_HOLE[0] * k, oy + UNIT_HOLE[1] * k, ox + UNIT_HOLE[2] * k, oy + UNIT_HOLE[3] * k)
        d = ImageDraw.Draw(c)
        d.rectangle(hole, fill="#1636dc")
        d.text(((hole[0] + hole[2]) / 2, (hole[1] + hole[3]) * .47), "47", fill="white", anchor="mm", font=font((hole[2] - hole[0]) * .42))
        put(c, "room-entertainment-center.png", v["unit"])
        return c
    put(c, "room-tv-antenna.png", v["antenna"])
    x, y, w, h = v["tv"]
    k = w / 2000
    hole = (x + TV_HOLE[0] * k, y + TV_HOLE[1] * k, x + TV_HOLE[2] * k, y + TV_HOLE[3] * k)
    d = ImageDraw.Draw(c)
    d.rectangle(hole, fill="#1636dc")
    d.text(((hole[0] + hole[2]) / 2, (hole[1] + hole[3]) * .47), "47", fill="white", anchor="mm", font=font(w * .4))
    d.text(((hole[0] + hole[2]) / 2, hole[3] - (hole[3] - hole[1]) * .18), "DAYS UNTIL CHRISTMAS", fill="white", anchor="mm", font=font(w * .05))
    put(c, "room-tv.png", v["tv"])
    put(c, "room-stand.png", v["stand"])
    return c


def preview_haunt(key, v):
    c = Image.new("RGBA", (round(v["w"]), round(v["h"])), "#07091a")
    if (OUT / "haunt-sky.png").exists():
        sky = Image.open(OUT / "haunt-sky.png").convert("RGBA")
        k = max(c.width / sky.width, c.height / sky.height)
        sky = sky.resize((round(sky.width * k), round(sky.height * k)), Image.LANCZOS)
        c.paste(sky, ((c.width - sky.width) // 2, c.height - sky.height))
    moon = REPO / "web/hk/sky/moon-hallow.webp"
    if moon.exists():
        m, at = fit(Image.open(moon).convert("RGBA"), v["moon"])
        c.alpha_composite(m, (max(at[0], 0), max(at[1], 0)))
    put(c, "haunt-tree.png", v["tree"])
    put(c, "haunt-house.png", v["house"])
    put(c, "haunt-house-lit.png", v["house"])
    if (OUT / "haunt-grounds.png").exists():
        g = Image.open(OUT / "haunt-grounds.png").convert("RGBA")
        h = round(v["grounds"][3])
        g = g.resize((max(1, round(g.width * h / g.height)), h), Image.LANCZOS)
        for x in range(0, c.width, g.width):
            c.alpha_composite(g.crop((0, 0, min(g.width, c.width - x), g.height)), (x, round(v["grounds"][1])))
        foot = round(v["grounds"][1]) + h
        if foot < c.height:
            ImageDraw.Draw(c).rectangle((0, foot, c.width, c.height), fill=tuple(np.asarray(g)[-1, g.width // 2]))
    put(c, "haunt-stone.png", v["stone"])
    x, y, w, h = v["stone"]
    d = ImageDraw.Draw(c)
    d.text((x + w / 2, y + h * .45), "13", fill="#17191d", anchor="mm", font=font(w * .42))
    d.text((x + w / 2, y + h * .78), "HALLOWEEN", fill="#17191d", anchor="mm", font=font(w * .1))
    if (OUT / "haunt-grass.png").exists():
        g = Image.open(OUT / "haunt-grass.png").convert("RGBA")
        h2 = round(v["grass"][3])
        g = g.resize((max(1, round(g.width * h2 / g.height)), h2), Image.LANCZOS)
        for gx in range(0, c.width, g.width):
            c.alpha_composite(g.crop((0, 0, min(g.width, c.width - gx), g.height)), (gx, round(v["grass"][1])))
    for i, b in enumerate(v["pumpkins"]):
        put(c, "haunt-pumpkin-large.png" if i == 0 else "haunt-pumpkin-small.png", b)
    return c


def previews(scene):
    make = preview_room if scene == "room" else preview_haunt
    for key, v in PLACE[scene].items():
        make(key, v).convert("RGB").save(OUT / f"preview-{scene}-{key}.png")
    print(f"     wrote output/preview-{scene}-<wall, pane, ipad, phone, side>.png")


if __name__ == "__main__":
    want = sys.argv[1:] or list(ASSETS)
    for scene in want:
        print(f"--- {scene}")
        arts = {}
        for name, spec in ASSETS[scene].items():
            _, a = common(name, spec)
            if a is not None:
                arts[name] = a
        (check_room if scene == "room" else check_haunt)(arts)
        previews(scene)
    print("ALL PASS" if not fails else f"{fails} FAILED")
    sys.exit(1 if fails else 0)
