"""THE HOUSE'S TWIN: a real screen of the house, drawn by this checkout's code, at a wall tablet's size (2026-11-08).

The owner, after round three of the cards review: "All of these issues point to not testing on live dashboards ... things
need to be tested at the appropriate resolution!! Remember tablets are 1280x800." The gallery's invented house never
had his screens' layouts (a Side Pane beside a Home Grid makes every cell smaller), so the review judged blocks at sizes
no tablet draws them. This draws HIS screens instead, without his browser, a sign-in or the live site:

    pull    the house's settings documents (every screen, the house's own settings, the tablets) read-only from Mantel's
            database on the LXC over SSH (house.json's lxc_ssh / lxc_key), and Home Assistant's states and registries
            (areas, floors, devices, entities) with the admin token (~/.config/mantel/ha_token, house.json's ha_url),
            into ~/.cache/mantel-twin/ -- never into the repository: it is the house's own data (camera tokens dropped)
    render  a test Mantel Server (tools/headless/gallery.py's, commands off: nothing reaches the house) over those
            states with those settings, and each SCREEN's Home at --size in WebKit (an iPad's engine) or Chromium (the
            Android wall tablets'), a screenshot each into --shots

    python tools/headless/house_twin.py pull
    python tools/headless/house_twin.py render kitchen-homeview [--size 1280x800] [--engine webkit] [--shots DIR] [--path home]
        [--set kitchen-homeview:b2.height=full]
    python tools/headless/house_twin.py screens          # the house's screens, by name
    python tools/headless/house_twin.py render kitchen-homeview --busy --sheets   # a busy house; every block's sheet too
    python tools/headless/house_twin.py render "settings#/screens/kitchen-homeview" --path home-grid --size 1440x900   # the editor

The states are a snapshot (`pull` again for fresh ones); the server's own reads (calendars, forecasts, Music Assistant,
the Timeline) are the gallery's stand-ins. Needs PLAYWRIGHT_PATH and NODE for `render`.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / x) for x in ("tools/headless", "tools", "hosts/server", "tests")]
CACHE = Path(os.environ.get("MANTEL_TWIN_CACHE", Path.home() / ".cache/mantel-twin"))
CONF = Path.home() / ".config/mantel"
DUMP = r'''
import sqlite3, json
c = sqlite3.connect("file:/data/mantel.db?mode=ro", uri=True)
print(json.dumps([{"scope": s, "key": k, "body": json.loads(b)} for s, k, b in c.execute("SELECT scope, key, body FROM settings_docs")]))
'''


def house() -> dict:
    return json.loads((CONF / "house.json").read_text())


def pull_settings() -> list[dict]:
    h = house()
    out = subprocess.run(["ssh", "-i", os.path.expanduser(h["lxc_key"]), "-o", "BatchMode=yes", h["lxc_ssh"],
                          "docker exec -i mantel-server python -"], input=DUMP, capture_output=True, text=True, timeout=60)
    if out.returncode:
        raise SystemExit(f"house_twin: reading the settings failed: {out.stderr.strip()[-300:]}")
    return json.loads(out.stdout)


async def pull_ha() -> dict:
    import aiohttp
    url, token = house()["ha_url"].rstrip("/"), (CONF / "ha_token").read_text().strip()
    async with aiohttp.ClientSession(headers={"Authorization": f"Bearer {token}"}) as s:
        async with s.get(url + "/api/states") as r:
            r.raise_for_status()
            states = await r.json()
        async with s.ws_connect(url.replace("http", "ws", 1) + "/api/websocket") as ws:
            await ws.receive_json()
            await ws.send_json({"type": "auth", "access_token": token})
            if (await ws.receive_json()).get("type") != "auth_ok":
                raise SystemExit("house_twin: Home Assistant refused the token")
            reg = {}
            for i, kind in enumerate(("area", "floor", "device", "entity"), 1):
                await ws.send_json({"id": i, "type": f"config/{kind}_registry/list"})
                while True:
                    m = await ws.receive_json()
                    if m.get("id") == i:
                        reg[kind] = m.get("result") or []
                        break
    for st in states:                       # nothing that opens a camera or an image from outside this Mac
        a = st.get("attributes") or {}
        a.pop("access_token", None)
        if st["entity_id"].startswith("camera.") or "token=" in str(a.get("entity_picture", "")):
            a.pop("entity_picture", None)
    return {"states": states, "registry": reg, "pulled": time.time()}


def cmd_pull() -> int:
    CACHE.mkdir(parents=True, exist_ok=True)
    os.chmod(CACHE, 0o700)
    docs = pull_settings()
    ha = asyncio.run(pull_ha())
    (CACHE / "settings.json").write_text(json.dumps(docs))
    (CACHE / "ha.json").write_text(json.dumps(ha))
    boards = sorted(d["key"] for d in docs if d["scope"] == "board")
    print(f"house_twin: {len(docs)} settings documents ({len(boards)} screens), {len(ha['states'])} states -> {CACHE}")
    return 0


def load() -> tuple[list[dict], dict]:
    try:
        return json.loads((CACHE / "settings.json").read_text()), json.loads((CACHE / "ha.json").read_text())
    except FileNotFoundError:
        raise SystemExit("house_twin: nothing pulled yet -- run `house_twin.py pull` first")


def cmd_screens() -> int:
    docs, _ = load()
    for d in sorted((d for d in docs if d["scope"] == "board"), key=lambda d: d["key"]):
        b = d["body"]
        print(f"{d['key']:28} {b.get('title') or '':28} home: {b.get('home_view') or b.get('home_style') or '-'}")
    return 0


def busy(ha: dict) -> dict:
    """`--busy`: the house with things going on -- every light and fan on, the switches on, the first two timers running, a
    speaker playing, the vacuums cleaning, a door open and a lock unlocked -- so the layouts are judged full as well as quiet."""
    import copy
    ha = copy.deepcopy(ha)
    now = time.time()
    timers = 0
    for st in ha["states"]:
        eid, a = st["entity_id"], st.setdefault("attributes", {})
        dom = eid.split(".", 1)[0]
        if dom in ("light", "fan", "switch", "input_boolean"):
            st["state"] = "on"
            if dom == "light":
                a["brightness"] = 180
            if dom == "fan":
                a["percentage"] = 66
        elif dom == "timer" and timers < 2:
            timers += 1
            st["state"] = "active"
            a.update(duration="0:30:00", remaining="0:12:00",
                     finishes_at=time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(now + 720 * timers)))
        elif dom == "vacuum":
            st["state"] = "cleaning"
        elif dom == "media_player" and st["state"] in ("idle", "paused", "off", "standby", "on"):
            st["state"] = "playing"
            a.update(media_title=a.get("media_title") or "Blue in Green", media_artist=a.get("media_artist") or "Miles Davis",
                     media_duration=a.get("media_duration") or 337, media_position=100,
                     media_position_updated_at=time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(now)))
        elif dom == "binary_sensor" and a.get("device_class") == "door" and not ha.get("_door"):
            st["state"] = "on"
            ha["_door"] = eid
        elif dom == "lock" and not ha.get("_lock") and st["state"] == "locked":
            st["state"] = "unlocked"
            ha["_lock"] = eid
    return ha


def twin_house(ha: dict) -> None:
    """gallery.HOUSE / ROOMS / FLOORS as the house's: each entity in its area (its own, else its device's)."""
    import gallery
    reg = ha["registry"]
    dev_area = {d["id"]: d.get("area_id") for d in reg.get("device", [])}
    ent_area = {e["entity_id"]: e.get("area_id") or dev_area.get(e.get("device_id")) for e in reg.get("entity", [])}
    gallery.HOUSE.clear()
    gallery.HOUSE.update({st["entity_id"]: (ent_area.get(st["entity_id"]), (st["state"], st.get("attributes") or {}))
                          for st in ha["states"]})
    gallery.FLOORS[:] = [{"floor_id": f["floor_id"], "name": f["name"], "level": f.get("level")} for f in reg.get("floor", [])]
    gallery.ROOMS[:] = [(a["area_id"], a["name"], a.get("floor_id")) for a in reg.get("area", [])]


def grid_entities(docs: list[dict], screen: str) -> list[str]:
    """What a screen's Home Grid blocks name -- each one's sheet, for `--sheets`."""
    out: list[str] = []
    for d in docs:
        if d["scope"] == "board" and d["key"] == screen:
            for it in (d["body"].get("home_grid") or {}).get("items") or []:
                o = it.get("opts") or {}
                for eid in [o.get("entity"), o.get("scene"), *[a.get("entity") for a in o.get("accessories") or [] if isinstance(a, dict)]]:
                    if eid and eid not in out:
                        out.append(eid)
    return out


def with_opts(docs: list[dict], sets: list[str]) -> list[dict]:
    """`--set SCREEN:ITEM.KEY=JSON`: one block's option changed for this render only (what would it look like Full?)."""
    for spec in sets:
        where, _, val = spec.partition("=")
        screen, _, rest = where.partition(":")
        item, _, key = rest.partition(".")
        for d in docs:
            if d["scope"] == "board" and d["key"] == screen:
                for it in (d["body"].get("home_grid") or {}).get("items") or []:
                    if it.get("id") == item:
                        try:
                            it.setdefault("opts", {})[key] = json.loads(val)
                        except ValueError:
                            it.setdefault("opts", {})[key] = val          # a plain word: full, half
    return docs


async def render(screens: list[str], size: tuple[int, int], engine: str, shots: Path, path: str, sets: list[str] = (),
                 js: str = "", tag: str = "", sheets: bool = False, is_busy: bool = False) -> int:
    docs, ha = load()
    if is_busy:
        ha = busy(ha)
        tag = tag or "busy"
    docs = with_opts(docs, list(sets))
    import gallery
    from aiohttp.test_utils import TestServer
    from mantel_server import settings_store
    twin_house(ha)
    # (what the house's server reads beyond states -- Energy's plan and statistics, Live TV's guide, the to-do lists, Clean Areas --
    # stood in as the grid audit stands them in, so those blocks draw full in the house's own layouts, not their "set up" notes)
    import home_grid_audit as A
    A.stand_in_reads()
    shots.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="mantel-twin-") as td:
        app, cookie = await gallery.build(Path(td), real_model=True)
        A.stand_in_app(app)
        settings = app["settings"]
        settings.store.write([(d["scope"], d["key"], d["body"]) for d in docs],
                             actor=settings_store.Actor(label="house twin"), action="import", message="the house's settings")
        async with TestServer(app) as server:
            origin = str(server.make_url("")).rstrip("/")
            script = Path(__file__).with_suffix(".cjs")
            spec = {"origin": origin, "cookie": cookie, "screens": screens, "path": path, "w": size[0], "h": size[1],
                    "engine": engine, "shots": str(shots), "js": js, "tag": tag,
                    "init": A.feed_script(),
                    "sheets": {s: grid_entities(docs, s) for s in screens} if sheets else {}}
            proc = await asyncio.create_subprocess_exec(os.environ.get("NODE", "node"), str(script),
                                                        stdin=asyncio.subprocess.PIPE, env=os.environ)
            await proc.communicate(json.dumps(spec).encode())
            return proc.returncode or 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("pull")
    sub.add_parser("screens")
    r = sub.add_parser("render")
    r.add_argument("screens", nargs="+")
    r.add_argument("--size", default="1280x800")
    r.add_argument("--engine", choices=["webkit", "chromium"], default="webkit")
    r.add_argument("--shots", type=Path, default=Path(tempfile.gettempdir()) / "mantel-twin-shots")
    r.add_argument("--path", default="home", help="the page under each screen (home, or another page's path)")
    r.add_argument("--js", default="", help="run this in the page before the shot (open a sheet: it may await)")
    r.add_argument("--tag", default="", help="a word added to the shot's name")
    r.add_argument("--busy", action="store_true", help="the house with things going on (busy()): lights on, timers, music, a door open")
    r.add_argument("--sheets", action="store_true", help="also open the sheet of every entity the screen's Home Grid names, a shot each")
    r.add_argument("--set", action="append", default=[], metavar="SCREEN:ITEM.KEY=VALUE",
                   help="change one block's option for this render (kitchen-homeview:b2.height=full)")
    a = ap.parse_args(argv)
    if a.cmd == "pull":
        return cmd_pull()
    if a.cmd == "screens":
        return cmd_screens()
    if not os.environ.get("PLAYWRIGHT_PATH"):
        raise SystemExit("house_twin: render needs PLAYWRIGHT_PATH (and NODE)")
    w, h = (int(x) for x in a.size.split("x"))
    return asyncio.run(render(a.screens, (w, h), a.engine, a.shots, a.path, a.set, a.js, a.tag, a.sheets, a.busy))


if __name__ == "__main__":
    sys.exit(main())
