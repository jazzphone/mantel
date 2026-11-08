"""Writes references/placements.json and references/annotated/ for ARTWORK-REQUEST.md. Each scene's pieces take the same places
as the 90s living room's, measured in ../holiday-scenes/references/placements.json, so they fit every screen the same way.

    ~/.venvs/mantel/bin/python make_references.py
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOM = json.loads((HERE.parent / "holiday-scenes/references/placements.json").read_text())["room"]
out = {"thanks": {}, "newyear": {}}
for key, v in ROOM.items():
    z, W, H = v["z"], v["w"], v["h"]
    out["thanks"][key] = {"w": W, "h": H, "z": z, "floorY": v["floorY"], "railY": v["railY"], "borderY": v["borderY"], "board": v["tv"], "console": v["stand"],
                          "window": v["window"], "outside": v["outside"], "table": v["couch"], "hutch": v["tree"], "harvest": v["presents"]}
    sky_h = max(W * 900 / 3200, min(v["floorY"], H * .62))
    roof_y = v["floorY"] - 26 * z
    out["newyear"][key] = {"w": W, "h": H, "z": z, "floorY": v["floorY"], "board": v["tv"], "crate": v["stand"], "party": v["couch"], "balloons": v["tree"], "streamers": v["presents"],
                           "skyline": [0, v["floorY"] - sky_h, W, sky_h], "rooftop": [0, roof_y, W, H - roof_y], "lights": [0, max(v["borderY"] - 214 * z, 0.09 * H), W, 96 * z]}
(HERE / "references/placements.json").write_text(json.dumps(out, indent=1))
ann = HERE / "references/annotated"
ann.mkdir(parents=True, exist_ok=True)
cols = ["#ff3b30", "#ffd60a", "#30d158", "#64d2ff", "#bf5af2", "#ff9f0a", "#ffffff", "#ff7ab8"]
for scene, sizes in out.items():
    for key, v in sizes.items():
        im = Image.new("RGB", (round(v["w"]), round(v["h"])), "#20242c")
        d = ImageDraw.Draw(im)
        n = 0
        for name, b in v.items():
            if isinstance(b, list):
                c = cols[n % len(cols)]; n += 1
                d.rectangle((b[0], b[1], b[0] + b[2], b[1] + b[3]), outline=c, width=2)
                d.rectangle((b[0], b[1], b[0] + 8 * len(name) + 6, b[1] + 15), fill=c)
                d.text((b[0] + 3, b[1] + 2), name, fill="#000")
        # what the screen keeps for itself
        m = .06 * min(v["w"], v["h"])
        d.rectangle((m, m, m + .36 * v["w"] if v["w"] < v["h"] else m + 200 * v["z"], m + 86 * v["z"]), outline="#cccccc", width=1); d.text((m + 3, m + 3), "time, date, weather: keep calm", fill="#ccc")
        d.text((m, v["floorY"] + (v["h"] - v["floorY"]) * .6), "the row along the bottom (live words)", fill="#ccc")
        im.save(ann / f"{scene}-{key}.png")
print("wrote references/placements.json and annotated/")
