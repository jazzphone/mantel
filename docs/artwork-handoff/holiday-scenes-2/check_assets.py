"""Check the Thanksgiving and New Year's artwork (ARTWORK-REQUEST.md) and composite it for review.

    ~/.venvs/mantel/bin/python check_assets.py              # everything
    ~/.venvs/mantel/bin/python check_assets.py newyear      # one scene: thanks or newyear

Built on ../holiday-scenes/check_assets.py, which it imports and never changes. Prints PASS, FAIL or MISSING per check and writes
output/preview-<scene>-<screen>.png. HOLIDAY_ART_OUT reads and writes another folder (for testing this script). Exit status 1 if
anything fails or is missing. Writes nothing outside output/.
"""
import json
import os
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "holiday-scenes"))
OUT = Path(os.environ.get("HOLIDAY_ART_OUT") or HERE / "output")
os.environ["HOLIDAY_ART_OUT"] = str(OUT)        # the first batch's helpers read and write here too, never its own output
import check_assets as base  # noqa: E402  (the first batch's: same name, its own folder)

PLACE = json.loads((HERE / "references/placements.json").read_text())
LUMA = base.LUMA
ASSETS = {
    "thanks": {
        "thanks-wall.png": (1024, 1024, "tile"), "thanks-wainscot.png": (2048, 400, "band"), "thanks-floor.png": (1024, 1024, "tile"),
        "thanks-window-outside.png": (1000, 920, "opaque"), "thanks-window.png": (1160, 1136, "sprite"), "thanks-table.png": (1240, 656, "sprite"),
        "thanks-hutch.png": (1348, 2152, "sprite"), "thanks-harvest.png": (1400, 272, "sprite"), "thanks-board.png": (2000, 1515, "sprite"),
        "thanks-console.png": (2004, 232, "sprite"),
    },
    "newyear": {
        "ny-sky.png": (2560, 1600, "opaque"), "ny-skyline.png": (3200, 900, "strip"), "ny-rooftop.png": (3200, 520, "strip"),
        "ny-string-lights.png": (3200, 300, "strip"), "ny-board.png": (2000, 1515, "sprite"), "ny-crate.png": (2004, 232, "sprite"),
        "ny-party.png": (1240, 656, "sprite"), "ny-balloons.png": (1348, 2152, "sprite"), "ny-streamers.png": (1400, 272, "sprite"),
    },
}
BOARD_FACE = (120, 120, 1880, 1395)
NY_HOLE = (110, 150, 1890, 1345)
say = base.say


def check_thanks(a):
    w = a.get("thanks-wall.png")
    if w is not None:
        say((w[..., :3] @ LUMA).mean() <= 85, "thanks-wall.png: dark enough for white words", f"mean {(w[..., :3] @ LUMA).mean():.0f}")
    fl = a.get("thanks-floor.png")
    if fl is not None:
        m = (fl[..., :3] @ LUMA).mean()
        say(60 <= m <= 120, "thanks-floor.png: warm oak, mid-toned", f"mean {m:.0f}")
    win = a.get("thanks-window.png")
    if win is not None:
        share = (base.box_alpha(win, base.PANES) == 0).mean()
        say(.72 <= share <= .97, "thanks-window.png: the glass is transparent, the bars solid", f"{share:.2f}")
    b = a.get("thanks-board.png")
    if b is not None:
        f = b[BOARD_FACE[1]:BOARD_FACE[3], BOARD_FACE[0]:BOARD_FACE[2]]
        lum = f[..., :3] @ LUMA
        say(f[..., 3].min() == 255, "thanks-board.png: its face is solid")
        say(lum.mean() <= 60, "thanks-board.png: a dark slate face, for white chalk", f"mean {lum.mean():.0f}")
        say(lum.std() <= 16, "thanks-board.png: its face is blank: no writing or drawing", f"spread {lum.std():.0f}")
    p = OUT / "thanks-table.json"
    t = a.get("thanks-table.png")
    if not p.exists():
        say(False, "thanks-table.json: MISSING")
    elif t is not None:
        try:
            d = json.loads(p.read_text())
            good = all({"x", "y"} <= set(q) for q in d["candles"] + d["steam"])
        except (ValueError, KeyError, TypeError):
            d, good = {}, False
        if say(good, "thanks-table.json: {candles: [{x, y}], steam: [{x, y}]}"):
            say(2 <= len(d["candles"]) <= 8, "thanks-table.json: 2 to 8 candles", len(d["candles"]))
            say(2 <= len(d["steam"]) <= 5, "thanks-table.json: 2 to 5 steam points", len(d["steam"]))
            on = [0 <= q["x"] < t.shape[1] and 0 <= q["y"] < t.shape[0] for q in d["candles"] + d["steam"]]
            say(all(on), "thanks-table.json: every point is inside the picture", f"{on.count(False)} outside")


def check_newyear(a):
    s = a.get("ny-sky.png")
    if s is not None:
        lum = s[..., :3] @ LUMA
        say(lum[:520, :900].mean() <= 70 and lum[:520, :900].std() <= 24, "ny-sky.png: top left dark and calm, for the corner's words",
            f"mean {lum[:520, :900].mean():.0f}, spread {lum[:520, :900].std():.0f}")
        say(lum[:160, 1700:].mean() <= 80, "ny-sky.png: top right dark enough for House Status", f"{lum[:160, 1700:].mean():.0f}")
    sk = a.get("ny-skyline.png")
    if sk is not None:
        say(sk[:40, :, 3].max() == 0, "ny-skyline.png: clear along its top", f"max alpha {sk[:40, :, 3].max():.0f}")
        say(sk[-60:, :, 3].min() >= 200, "ny-skyline.png: solid along its foot", f"min alpha {sk[-60:, :, 3].min():.0f}")
    r = a.get("ny-rooftop.png")
    if r is not None:
        say(r[:20, :, 3].max() == 0, "ny-rooftop.png: clear along its top", f"max alpha {r[:20, :, 3].max():.0f}")
        say(r[-60:, :, 3].min() == 255, "ny-rooftop.png: solid along its foot")
        say((r[-60:, :, :3] @ LUMA).mean() <= 45, "ny-rooftop.png: its foot is dark enough for white words", f"mean {(r[-60:, :, :3] @ LUMA).mean():.0f}")
    b = a.get("ny-board.png")
    if b is not None:
        say(base.box_alpha(b, NY_HOLE).max() == 0, "ny-board.png: the opening is fully transparent", f"max alpha {base.box_alpha(b, NY_HOLE).max():.0f}")
        h = NY_HOLE
        say(b[h[1] - 30:h[1] - 8, 400:1600, 3].min() == 255 and b[h[3] + 8:h[3] + 30, 400:1600, 3].min() == 255, "ny-board.png: its housing closes around the opening")
    p = OUT / "ny-string-lights.json"
    st = a.get("ny-string-lights.png")
    if not p.exists():
        say(False, "ny-string-lights.json: MISSING")
    elif st is not None:
        try:
            bs = json.loads(p.read_text())
            good = isinstance(bs, list) and all({"x", "y"} <= set(q) for q in bs)
        except ValueError:
            bs, good = [], False
        if say(good, "ny-string-lights.json: a list of {x, y}"):
            say(30 <= len(bs) <= 70, "ny-string-lights.json: 30 to 70 bulbs", len(bs))
            on = [0 <= q["x"] < st.shape[1] and 0 <= q["y"] < st.shape[0] and st[int(q["y"]), int(q["x"]), 3] > 128 for q in bs]
            say(all(on), "ny-string-lights.json: every bulb is on the string", f"{on.count(False)} off it")


def across(c, name, box):
    """A strip, repeated across its box at the box's height."""
    p = OUT / name
    if not p.exists():
        return
    g = Image.open(p).convert("RGBA")
    h = max(1, round(box[3]))
    g = g.resize((max(1, round(g.width * h / g.height)), h), Image.LANCZOS)
    for x in range(0, c.width, g.width):
        c.alpha_composite(g.crop((0, 0, min(g.width, c.width - x), min(g.height, c.height - round(box[1])))), (x, round(box[1])))


def room_back(c, v, wall, band, floor):
    base.tile(c, wall, (0, 0, v["w"], v["borderY"]), v["z"] / 2)
    if (OUT / band).exists():
        b = Image.open(OUT / band).convert("RGBA")
        h = round(v["floorY"] - v["borderY"])
        b = b.resize((max(1, round(b.width * h / b.height)), h), Image.LANCZOS)
        for x in range(0, c.width, b.width):
            c.paste(b, (x, round(v["borderY"])))
    base.tile(c, floor, (0, v["floorY"], v["w"], v["h"] - v["floorY"]), v["z"] / 2)


def preview_thanks(v):
    c = Image.new("RGBA", (round(v["w"]), round(v["h"])), "#101010")
    room_back(c, v, "thanks-wall.png", "thanks-wainscot.png", "thanks-floor.png")
    base.put(c, "thanks-window-outside.png", v["outside"])
    base.put(c, "thanks-window.png", v["window"])
    base.put(c, "thanks-hutch.png", v["hutch"])
    base.put(c, "thanks-table.png", v["table"])
    base.put(c, "thanks-harvest.png", v["harvest"])
    base.put(c, "thanks-board.png", v["board"])
    base.put(c, "thanks-console.png", v["console"])
    x, y, w, h = v["board"]
    d = ImageDraw.Draw(c)
    d.text((x + w / 2, y + h * .43), "18", fill="#f2efe4", anchor="mm", font=base.font(w * .4))
    d.text((x + w / 2, y + h * .78), "DAYS TO THANKSGIVING", fill="#f2efe4", anchor="mm", font=base.font(w * .05))
    return c


def preview_newyear(v):
    c = Image.new("RGBA", (round(v["w"]), round(v["h"])), "#050714")
    if (OUT / "ny-sky.png").exists():
        s = Image.open(OUT / "ny-sky.png").convert("RGBA")
        k = max(c.width / s.width, c.height / s.height)
        s = s.resize((round(s.width * k), round(s.height * k)), Image.LANCZOS)
        c.paste(s, ((c.width - s.width) // 2, c.height - s.height))
    across(c, "ny-skyline.png", v["skyline"])
    across(c, "ny-rooftop.png", v["rooftop"])
    across(c, "ny-string-lights.png", v["lights"])
    base.put(c, "ny-balloons.png", v["balloons"])
    base.put(c, "ny-party.png", v["party"])
    base.put(c, "ny-streamers.png", v["streamers"])
    x, y, w, h = v["board"]
    k = w / 2000
    hole = (x + NY_HOLE[0] * k, y + NY_HOLE[1] * k, x + NY_HOLE[2] * k, y + NY_HOLE[3] * k)
    d = ImageDraw.Draw(c)
    d.rectangle(hole, fill="#0c0c0e")
    d.text(((hole[0] + hole[2]) / 2, y + h * .42), "54", fill="#f4f1e6", anchor="mm", font=base.font(w * .42))
    d.text(((hole[0] + hole[2]) / 2, y + h * .76), "DAYS TO NEW YEAR", fill="#f4f1e6", anchor="mm", font=base.font(w * .05))
    base.put(c, "ny-board.png", v["board"])
    base.put(c, "ny-crate.png", v["crate"])
    return c


if __name__ == "__main__":
    want = sys.argv[1:] or list(ASSETS)
    for scene in want:
        print(f"--- {scene}")
        arts = {}
        for name, spec in ASSETS[scene].items():
            _, a = base.common(name, spec)
            if a is not None:
                arts[name] = a
        (check_thanks if scene == "thanks" else check_newyear)(arts)
        for key, v in PLACE[scene].items():
            (preview_thanks if scene == "thanks" else preview_newyear)(v).convert("RGB").save(OUT / f"preview-{scene}-{key}.png")
        print(f"     wrote output/preview-{scene}-<wall, pane, ipad, phone, side>.png")
    print("ALL PASS" if not base.fails else f"{base.fails} FAILED")
    sys.exit(1 if base.fails else 0)
