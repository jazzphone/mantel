"""The Timeline page (web/hk/cards/hk-timeline.js, docs/phase19/HOUSE-TIMELINE.md) in WebKit, on a fictional house.

A real Mantel Server over an invented home (Emma, Mark and Anna; the Back Door, the Front Door, the Garage and the
Driveway Cam), with 44 rows over three days -- every family, a motion burst, a row that keeps changing, a row written
late, a leak, Mantel's own alerts, two with pictures, one whose picture was not kept -- the server's own clock fixed at
Tuesday 3:30 PM so the days are always "Today", "Yesterday" and a date. Signed in as an Owner (Emma). At an iPad
upright (820 x 1180), an iPad across (1180 x 820) and a phone (390 x 844), each with touch, it checks and shoots:

- the page: the summary, the filter bar, the days and their hours, every row's icon, title, time, room and who line;
- every tap target is at least 44 px, nothing is clipped at the window's edge, the page has no sideways scroll;
- the filters (Doors, a search, a day, Only Mine) change what the page reads, and "Show All" from a row's sheet;
- the sheet: the pictures swipe, the exact time, the who line; the live feed brings a new row in;
- the empty state, the error state (Try Again), and no page errors.

    export PLAYWRIGHT_PATH=/path/to/node_modules/playwright-core NODE=$(command -v node)
    ~/.venvs/mantel/bin/python tools/headless/timeline_check.py [--shots DIR]

Without PLAYWRIGHT_PATH or NODE it says why and exits 0. `--shots` keeps the screenshots (PNG, 2x) there.
"""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / p) for p in ('tools/headless', 'tools', 'hosts/server', 'tests', '.')]

ZONE = "America/Chicago"
# Tuesday, November 3, 2026, 3:30 PM at the house
NOW = datetime(2026, 11, 3, 15, 30, tzinfo=ZoneInfo(ZONE)).timestamp()
OWNER_NAME = "Emma Rivera"

# extra entities the timeline's rows are about (the gallery's house has the locks, the garage, the doors, the cameras)
EXTRA = {
    "camera.driveway_cam": ("garage", ("idle", {"friendly_name": "Driveway Cam", "access_token": "fictional",
                                                "entity_picture": "/api/camera_proxy/camera.driveway_cam?token=fictional"})),
    "binary_sensor.kitchen_leak": ("kitchen", ("off", {"friendly_name": "Kitchen Sink Leak", "device_class": "moisture"})),
    "person.emma": (None, ("home", {"friendly_name": "Emma"})),
    "person.mark": (None, ("home", {"friendly_name": "Mark"})),
    "person.anna": (None, ("not_home", {"friendly_name": "Anna"})),
}


def at(days_ago: int, hhmm: str, sec: int = 0) -> float:
    """A time at the house: `days_ago` days before the fixed Tuesday, at HH:MM."""
    h, m = (int(x) for x in hhmm.split(":"))
    base = datetime.fromtimestamp(NOW, ZoneInfo(ZONE)).replace(hour=h, minute=m, second=sec, microsecond=0)
    return base.timestamp() - days_ago * 86400


def jpeg(seed: int, label: int) -> bytes:
    """A made-up camera picture: a porch or a drive at dusk, a figure, no one's house. (PIL, drawn here.)"""
    from PIL import Image, ImageDraw, ImageFilter
    w, h = 640, 360
    img = Image.new("RGB", (w, h))
    px = img.load()
    top, bot = [(40, 52, 84), (62, 44, 70), (30, 60, 66)][seed % 3], [(150, 112, 92), (120, 96, 110), (96, 120, 96)][seed % 3]
    for y in range(h):
        t = y / (h - 1)
        c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = c
    d = ImageDraw.Draw(img)
    d.rectangle([0, 250, w, h], fill=(52, 48, 46))                       # the ground
    d.rectangle([40, 70, 230, 270], fill=(88, 70, 62))                   # a door
    d.rectangle([60, 90, 210, 270], outline=(150, 128, 110), width=5)
    d.ellipse([196, 170, 210, 184], fill=(214, 184, 120))               # a knob
    x = 330 + label * 70
    if seed % 2:
        d.rectangle([x - 40, 214, x + 40, 262], fill=(150, 108, 66))     # a package
        d.line([x - 40, 238, x + 40, 238], fill=(205, 170, 120), width=4)
    else:
        d.ellipse([x - 22, 110, x + 22, 154], fill=(70, 64, 72))         # a figure
        d.rounded_rectangle([x - 34, 150, x + 34, 262], radius=22, fill=(70, 64, 72))
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=72)
    return out.getvalue()


def seed(app, uid: str) -> dict:
    """The rows. Returns what the check needs to know: how many, and the ids of the rows with pictures."""
    from hk_core.timeline import words as W
    from mantel_server.timeline.store import Row
    tl = app["timeline"]
    pics = app["timeline_pictures"]
    areas = {"porch": "Porch", "kitchen": "Kitchen", "garage": "Garage", "living_room": "Living Room", "backyard": "Backyard"}
    n = [0]

    def row(day, hhmm, family, kind, label, entity, area, *, sec=0, level="info", who=None, ended=None, count=None,
            late=False, flapping=False, extra=None, person=None, zone=None, alert=None, audit=None, gone=False):
        n[0] += 1
        t = at(day, hhmm, sec)
        title = label if family == "system" else W.title(family, kind, label, {"count": count} if count else {"device": (who or {}).get("device_for_title")})
        detail = {"s": kind}
        if count:
            detail["count"] = count
        if ended and count:
            detail["last"] = at(day, ended)
        if flapping:
            detail["flapping"] = True
        if late:
            detail["late"] = True
        if zone:
            detail["zone"] = zone
        if gone:
            detail["pics_gone"] = True
        if alert:
            detail["alert"] = alert
        if extra:
            detail.update(extra)
        w = who or {}
        if w.get("keypad"):
            detail["keypad"] = w["keypad"]
        r = Row(src=f"seed:{n[0]}", at=t, family=family, kind=kind, title=title, level=level, entity=entity, area=area,
                search=W.search_words(family, kind, label, areas.get(area), title), detail=detail,
                person=person, actor=uid if w.get("mine") else (w.get("actor")), actor_name=w.get("name"),
                device=None, device_name=w.get("device"), how=w.get("how"), audit_id=audit,
                ended=at(day, ended) if ended else None)
        tl.rows.write([("row", r)])
        return tl.rows.by_src([r.src])[0]["id"]

    # Mark and Anna are people of the house too (a removed person's arrivals are forgotten)
    store = app["store"]
    store.link("gallery-mark", "adult", "Mark")
    store.link("gallery-anna", "adult", "Anna")
    u_mark, u_anna = (store.get_link(k)["user_id"] for k in ("gallery-mark", "gallery-anna"))
    emma = {"name": "Emma", "mine": True}
    tab = {**emma, "device": "Hallway tablet", "how": "tablet"}
    hand = {"how": "hand_or_automation"}
    mark_away = {"name": "Mark", "how": "away", "actor": u_mark}
    anna_home = {"name": "Anna", "how": "home", "actor": u_anna}
    assistant = {**emma, "how": "assistant"}
    door, front, garage, drive, fcam = "lock.back_door", "binary_sensor.front_door", "cover.garage_door", "camera.driveway_cam", "camera.front_door"
    ids = {}
    # -- today, Tuesday (a busy day: its hours get their own heading) -----------------------------------------------
    row(0, "15:12", "arrival", "arrived", "Mark", "person.mark", None, person=u_mark)
    ids["package"] = row(0, "14:48", "detection", "package", "Front Door", fcam, "porch", count=2, ended="14:52")
    ids["ring"] = row(0, "14:47", "doorbell", "ring", "Front Door", fcam, "porch")
    row(0, "13:05", "lock", "locked", "Back Door", door, "kitchen", who=tab, audit=412)
    row(0, "12:58", "lock", "unlocked", "Back Door", door, "kitchen", who=tab, audit=411)
    ids["gone"] = row(0, "12:20", "detection", "vehicle", "Driveway Cam", drive, "garage", gone=True)
    row(0, "11:02", "door", "closed", "Front Door", front, "porch")
    row(0, "11:01", "door", "opened", "Front Door", front, "porch")
    row(0, "09:42", "garage", "closed", "Garage", garage, "garage", who=mark_away)
    row(0, "09:41", "garage", "opened", "Garage", garage, "garage", who=mark_away)
    row(0, "08:15", "alarm", "disarmed", "Home Alarm", "alarm_control_panel.home", None, who={**tab, "keypad": "Anna"}, audit=409)
    row(0, "07:30", "detection", "animal", "Driveway Cam", drive, "garage")
    row(0, "06:12", "garage", "opened", "Garage", garage, "garage", who=hand)
    row(0, "03:40", "detection", "person", "Driveway Cam", drive, "garage", count=14, ended="03:58")
    row(0, "02:10", "door", "flapping", "Front Door", front, "porch", count=14, ended="02:40", flapping=True)
    row(0, "02:04", "lock", "unlocked", "Back Door", door, "kitchen", who=hand)
    row(0, "01:50", "garage", "opened", "Garage", garage, "garage", late=True)
    # -- yesterday ------------------------------------------------------------------------------------------------
    row(1, "22:30", "alarm", "armed_night", "Home Alarm", "alarm_control_panel.home", None, who=tab, audit=401)
    row(1, "22:28", "lock", "locked", "Front Door", "lock.front_door", "porch", who=tab, audit=400)
    row(1, "22:27", "lock", "locked", "Back Door", door, "kitchen", who=assistant, audit=399)
    row(1, "21:10", "arrival", "arrived", "Anna", "person.anna", None, person=u_anna, zone=None)
    row(1, "19:45", "lock", "unlocked", "Back Door", door, "kitchen", who=anna_home, audit=395)
    row(1, "18:02", "refused", "unlock", "Back Door", door, "kitchen", level="warning", who={"device_for_title": "Kitchen"}, audit=392)
    row(1, "16:20", "arrival", "left", "Mark", "person.mark", None, person=u_mark)
    row(1, "14:05", "safety", "leak", "Kitchen Sink Leak", "binary_sensor.kitchen_leak", "kitchen", level="warning")
    row(1, "14:09", "safety", "clear", "Kitchen Sink Leak", "binary_sensor.kitchen_leak", "kitchen")
    row(1, "09:00", "system", "alert", "Music Assistant disconnected", None, None, level="warning", alert="ma.lost")
    row(1, "09:12", "system", "alert", "Music Assistant is back", None, None, alert="ma.lost")
    row(1, "07:50", "garage", "closed", "Garage", garage, "garage", who=tab, audit=380)
    row(1, "07:48", "garage", "opened", "Garage", garage, "garage", who=tab, audit=379)
    row(1, "03:15", "system", "alert", "Backup finished", None, None, alert="backup.ok")
    # -- Sunday ---------------------------------------------------------------------------------------------------
    row(2, "21:40", "alarm", "armed_home", "Home Alarm", "alarm_control_panel.home", None, who=tab, audit=360)
    row(2, "21:38", "lock", "locked", "Back Door", door, "kitchen", who=tab, audit=359)
    row(2, "19:20", "detection", "person", "Driveway Cam", drive, "garage")
    row(2, "17:15", "arrival", "arrived", "Emma", "person.emma", None, person=uid)
    row(2, "15:00", "doorbell", "ring", "Front Door", fcam, "porch")
    row(2, "12:40", "lock", "jammed", "Front Door", "lock.front_door", "porch", level="warning")
    row(2, "12:41", "lock", "locked", "Front Door", "lock.front_door", "porch", who=hand)
    row(2, "10:05", "door", "opened", "Front Door", front, "porch")
    row(2, "10:06", "door", "closed", "Front Door", front, "porch")
    row(2, "08:30", "arrival", "left", "Anna", "person.anna", None, person=u_anna)
    # -- the pictures: made up, kept the way the server keeps them ----------------------------------------------
    real = tl.clock
    for key, cam, frames in (("ring", "camera.front_door", 2), ("package", "camera.front_door", 2)):
        ev = tl.rows.get(ids[key])
        for i in range(frames):
            tl.clock = lambda t=ev["at"] + 2 + 5 * i: t
            pics.store(ids[key], cam, jpeg(0 if key == "ring" else 1, i))
    tl.clock = real
    # a real timeline's ids follow the time its rows were written: renumber the made-up rows in time order (the API
    # pages by id, so the newest are the first a small block reads)
    db = tl.db
    order = [r[0] for r in db.execute("SELECT id FROM timeline_events ORDER BY at, id")]
    db.execute("PRAGMA foreign_keys = OFF")
    with db:
        for new, old in enumerate(order, start=1):
            db.execute("UPDATE timeline_events SET id = ? WHERE id = ?", (-new, old))
            db.execute("UPDATE timeline_pics SET event = ? WHERE event = ?", (-new, old))
        db.execute("UPDATE timeline_events SET id = -id")
        db.execute("UPDATE timeline_pics SET event = -event")
    db.execute("PRAGMA foreign_keys = ON")
    remap = {old: new for new, old in enumerate(order, start=1)}
    ids = {k: remap.get(v, v) for k, v in ids.items()}
    return {"rows": n[0], "ids": ids}


def block_screen(app) -> None:
    """--block: the screen's Home laid out as a Home Grid with two Recent blocks (latest, the morning summary) and a
    camera, for the block's and the camera sheet's strip's shots (slice 19.4)."""
    import gallery
    from mantel_server.settings_store import Actor
    store = app["settings"].store
    body = dict(store.body("board", gallery.SCREEN) or {})
    body.update(home_style="grid", home_grid={"v": 1, "cols": 6, "rows": 4, "frame": [1280, 800], "band": True, "items": [
        {"id": "t1", "card": "timeline", "size": "L", "at": [0, 0], "opts": {"show": "latest"}},
        {"id": "t2", "card": "timeline", "size": "L", "at": [2, 0], "opts": {"show": "digest"}},
        {"id": "c1", "card": "camera", "size": "L", "at": [4, 0], "opts": {"entity": "camera.driveway_cam"}},
        {"id": "t3", "card": "timeline", "size": "W", "at": [0, 2], "opts": {"show": "auto"}}]})
    store.write([("board", gallery.SCREEN, body)], actor=Actor(label="gallery"), message="timeline_check --block")


async def main(shots, only, skip_live, block=False) -> int:
    import gallery
    gallery.OWNER = OWNER_NAME
    from aiohttp.test_utils import TestServer
    with tempfile.TemporaryDirectory() as td:
        app, cookie = await gallery.build(Path(td))
        # the extra entities, in the registry and the states
        areas = [{"area_id": a, "name": nm, "floor_id": f} for a, nm, f in gallery.ROOMS]
        ents = [{"entity_id": e, "area_id": a, "platform": "demo"} for e, (a, _) in {**gallery.HOUSE, **EXTRA}.items()]
        app["hub"].registry.load(areas, [], ents, gallery.FLOORS)
        app["hub"].store.apply_event({"a": {e: {"s": s, "a": at_, "lc": NOW - 1800, "lu": NOW - 60} for e, (_, (s, at_)) in EXTRA.items()}})
        app["clock"] = lambda: NOW
        # the house's time zone, as Home Assistant's config says it (the page shows times in it)
        rp = app["hub"].readproxy
        first = rp.request

        async def request(msg):
            got = await first(msg)
            return {**got, "time_zone": ZONE} if msg.get("type") == "get_config" else got
        rp.request = request
        app["authz"].tz = ZONE
        uid = app["store"].get_link("gallery-owner")["user_id"]
        info = seed(app, uid)
        if block:
            block_screen(app)
        print(f"timeline_check: {info['rows']} rows seeded")
        go = Path(td) / "live.go"
        done = Path(td) / "live.done"
        async with TestServer(app) as server:
            async def live():
                # the browser says when its page is ready (a file); one more row then comes through the live feed
                while not go.exists():
                    await asyncio.sleep(0.1)
                from hk_core.timeline import words as W
                from mantel_server.timeline.store import Row
                tl = app["timeline"]
                t = NOW - 60
                title = W.title("lock", "locked", "Front Door")
                tl.push(Row(src="seed:live", at=t, family="lock", kind="locked", title=title, entity="lock.front_door", area="porch",
                            search=W.search_words("lock", "locked", "Front Door", "Porch", title), detail={"s": "locked"},
                            actor=uid, actor_name="Emma", device_name="Hallway tablet", how="tablet"))
                tl.flush()
                done.write_text("1")
            # (Mantel's own start-up row, "Mantel started", is the real clock's: not part of the made-up house)
            app["timeline"].flush()
            with app["timeline"].db:
                app["timeline"].db.execute("DELETE FROM timeline_events WHERE src NOT LIKE 'seed:%'")
            task = asyncio.get_running_loop().create_task(live())
            proc = await asyncio.create_subprocess_exec(os.environ["NODE"], str(Path(__file__).with_suffix(".cjs")),
                                                        stdin=asyncio.subprocess.PIPE)
            await proc.communicate(json.dumps({
                "origin": str(server.make_url("")).rstrip("/"), "cookie": cookie, "screen": gallery.SCREEN, "zone": ZONE,
                "now": NOW * 1000, "shots": str(shots) if shots else "", "only": only or [], "go": str(go), "done": str(done),
                "skipLive": bool(skip_live), "block": bool(block)}).encode())
            task.cancel()
            return proc.returncode


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--shots", type=Path, help="keep the screenshots here")
    ap.add_argument("--only", nargs="*", help="sizes to run (820x1180 1180x820 390x844)")
    ap.add_argument("--skip-live", action="store_true")
    ap.add_argument("--block", action="store_true", help="shoot the Home Grid's Recent blocks and the camera strip only")
    args = ap.parse_args()
    if not os.environ.get("PLAYWRIGHT_PATH") or not os.environ.get("NODE"):
        print("timeline_check: skipped -- set PLAYWRIGHT_PATH (playwright-core) and NODE")
        sys.exit(0)
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    sys.exit(asyncio.run(main(args.shots, args.only, args.skip_live, args.block)))
