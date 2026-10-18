"""End-to-end: hk_core's features running in Mantel Server against the SCRATCH Home Assistant (tools/testha/).

    ~/.venvs/mantel/bin/python tools/e2e/features_e2e.py [--keep-up] [--reuse]

1. Starts the scratch HA (``testha.py up --fresh``: 127.0.0.1:8124, HA's ``demo`` devices only). If
   ``testha.py status`` says it is already running, another job is using it: this waits and retries
   (``--reuse``: use a scratch HA this caller started itself, and leave it running).
2. Runs Mantel Server in this process against it TWICE, each with a temp database and secrets, the
   scratch HA's throwaway credential (traded for a short access token; never printed), and the one
   wiring line the orchestrator adds to server.py (``features.register(app, hub, hooks)``):
   * phase A, house commands DISABLED (the default): a demo state change sets off a notification
     rule and reaches a fictional screen (a signed-in socket on ``hk_frontend/events/subscribe``); a
     fake linked ``hk_frontend`` (a Service credential on ``/linked/ws``) sends ``set_black_screen``:
     the confirmed handshake holds, NOTHING is sent to HA (the demo light is unchanged, no command
     connection exists), the audit has a ``denied`` / ``commands_disabled`` row for the Service actor
     and ``GET /api/features/status`` lists the intended ``light.turn_on``. Also (MANTEL-FEATURES.md
     "Phase 4 ports"): the notification carries a SNAPSHOT of the demo camera, taken by Mantel through its
     own credential and served by Mantel's route; the CALENDARS look-ahead sends the demo calendar's
     event; HK Settings' Notifications page is read and saved in Mantel (nothing read from or written
     to HA for it); a page's PHOTOS report reaches linked HA's photo screensaver switch.
   * phase B, house commands ENABLED (only here): the same black-screen request results in the
     demo ``light.turn_on`` (the tablet's backlight, ``light.bed_light``) through the command gateway,
     HA's state changes, and the audit row is ``allowed`` / ``ok`` for actor ``mantel:features``;
     the wake carries the brightness back.
3. Stops the scratch HA (unless --keep-up / --reuse).

SAFETY: refuses to run unless the HA URL is the scratch one; never reads ~/.config/mantel or touches
/Volumes/config or the house's HA. Prints no credential.
"""
from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import secrets
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "hosts/server"))
sys.path.insert(0, str(ROOT))

import aiohttp  # noqa: E402
from aiohttp.test_utils import TestServer  # noqa: E402

_spec = importlib.util.spec_from_file_location("gateway_e2e", ROOT / "tools/e2e/gateway_e2e.py")
GE = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(GE)
testha = GE.testha

SCRATCH_URL = GE.SCRATCH_URL
LEAK = "binary_sensor.basement_floor_wet"      # demo moisture sensor (off)
BACKLIGHT = "light.bed_light"                  # demo light (Bedroom): the fictional tablet's backlight
CAMERA = "camera.demo_camera"                  # demo camera: the leak notification's snapshot
CALENDAR = "calendar.calendar_1"               # demo calendar: "Future Event", 30 min after HA started
ENTRY = "e2e0scratch0entry"
UID = {k: f"{ENTRY}_hall_{k}" for k in ("black_screen", "photo_screensaver", "screen_in_use", "sleep_screen")}
TARGET = [{"entity_id": "switch.hall_black_screen", "unique_id": UID["black_screen"]}]
RESULTS: list[str] = []


def say(*a):
    print("[features-e2e]", *a, flush=True)


def check(cond, what):
    if not cond:
        raise GE.Fail(what)
    say("PASS", what)
    RESULTS.append(what)


async def ha_get(http, token, eid) -> dict:
    async with http.get(f"{SCRATCH_URL}/api/states/{eid}", headers={"Authorization": f"Bearer {token}"}) as r:
        return await r.json()


async def ha_set_state(http, token, eid, state, attrs) -> None:
    """The scratch HA's own REST: a demo entity's state changed (the harness's hand, not Mantel's)."""
    async with http.post(f"{SCRATCH_URL}/api/states/{eid}", headers={"Authorization": f"Bearer {token}"},
                         json={"state": state, "attributes": attrs}) as r:
        assert r.status in (200, 201), r.status


async def ha_service(http, token, domain, service, data) -> None:
    async with http.post(f"{SCRATCH_URL}/api/services/{domain}/{service}", headers={"Authorization": f"Bearer {token}"},
                         json=data) as r:
        assert r.status == 200, r.status


class LinkedClient:
    """A fake linked hk_frontend: HA's side of /linked/ws (a Service credential, no browser Origin)."""

    def __init__(self, base: str, token: str) -> None:
        self.base, self.token = base, token
        self.http = aiohttp.ClientSession()
        self.ws = None

    async def connect(self) -> dict:
        self.ws = await self.http.ws_connect(self.base + "/linked/ws", headers={"Authorization": f"Bearer {self.token}"})
        return await self.ws.receive_json(timeout=10)

    async def call(self, mid: int, **body) -> tuple[dict, list[dict]]:
        await self.ws.send_json({"id": mid, **body})
        frames = []
        while True:
            f = await self.ws.receive_json(timeout=15)
            if f.get("type") == "result" and f.get("id") == mid:
                return f, frames
            frames.append(f)

    async def close(self) -> None:
        if self.ws is not None:
            await self.ws.close()
        await self.http.close()


async def until(fn, timeout=15.0, every=0.25):
    t0 = time.time()
    while True:
        got = await fn()
        if got or time.time() - t0 > timeout:
            return got
        await asyncio.sleep(every)


async def phase(token: str, commands: bool) -> dict:
    from mantel_server import features
    from mantel_server.config import Config
    from mantel_server.connectors import Hooks
    from mantel_server.server import build_app
    from mantel_server.settings_store import Actor
    from mantel_server.store import Store
    from hk_core.notifications.settings import new_category

    label = "B (commands ENABLED)" if commands else "A (commands disabled)"
    say(f"--- phase {label}")
    with tempfile.TemporaryDirectory(prefix="mantel-features-e2e-") as folder:
        base_dir = Path(folder)
        cfg = Config(ha_url=SCRATCH_URL, data_dir=base_dir / "data", secrets_dir=base_dir / "secrets", port=0,
                     commands_enabled=commands)
        assert cfg.ha_url == SCRATCH_URL and "192.168." not in cfg.ha_url
        store = Store(cfg.data_dir / "mantel.db")
        app = build_app(cfg, token, store=store, connect_ha=True)
        hub = app["hub"]
        # Mantel's own settings: a fictional wall tablet and the feature pieces this run turns on
        app["settings"].store.write([
            ("board", "hk-e2e", {}),
            ("tablet", "hall", {"name": "Hall", "screen": "hk-e2e", "room": "bedroom", "app": "browser",
                                "black_screen": "hk", "uid": "hall"}),
            ("house", features.FEATURES_DOC, features.check_settings({
                "notifications": {"enabled": True, "items": [
                    {"id": "n_leak", "entity": LEAK, "when": "on", "snap": True, "camera": CAMERA},
                    {**new_category("calendars", {"n_leak"}), "id": "n_cal"}]},
                "linked": {"enabled": True, "entry_id": ENTRY, "backlight": True, "backlights": {"hall": BACKLIGHT}},
            })),
        ], actor=Actor(label="e2e"))
        # linked mode's per-tablet ownership: the hall tablet is Mantel's (every tablet is HA's by default)
        app["linked_owners"].set("hall", "mantel", by="e2e")
        # server.wire registers the feature host (after linked.register); use the app's own
        host = app["features"]
        out: dict = {"phase": label}
        people: list = []
        async with TestServer(app, host="127.0.0.1") as server, aiohttp.ClientSession() as ha:
            base = str(server.make_url("")).rstrip("/")
            await asyncio.wait_for(hub.ha.ready.wait(), 60)
            say(f"Mantel is up on {base}, reading the scratch HA ({len(hub.store.states)} entities)")
            check(LEAK in hub.store.states and BACKLIGHT in hub.store.states,
                  f"Mantel reads the scratch HA's demo devices ({LEAK}, {BACKLIGHT})")
            check(host.house.state(BACKLIGHT) is not None and host.house.area_ids() >= {"bedroom", "kitchen"},
                  "MantelHouse answers from the hub (states and areas)")
            for _ in range(40):
                if app["authz"].tz_source == "home_assistant":
                    break
                await asyncio.sleep(0.25)
            check(host.house.local_time().tzinfo.key == "America/New_York", "MantelHouse's local time is the house's zone")

            owner = GE.Browser(base, "owner")
            people.append(owner)
            st, body = await owner.post("/api/bootstrap", {"token": app["accounts"].issue_bootstrap_token(),
                                                          "username": "e2e-owner", "name": "Fictional Owner",
                                                          "password": secrets.token_urlsafe(18)})
            assert st == 200, body
            caps = await owner.connect() if commands else None
            if not commands:
                owner.ws = await owner.http.ws_connect(base + "/ws")
            check((caps or {}).get("commands") is (True if commands else None),
                  "the screen's socket says commands are " + ("on" if commands else "off (no capabilities frame)"))
            # -- the fictional screen listens to the house's events ------------------------------------
            await owner.ws.send_json({"type": "read_subscribe", "id": 7, "msg": {"type": "hk_frontend/events/subscribe"}})
            got = await owner.recv()
            assert got.get("type") == "read_result" and "error" not in got, got

            async def next_event(kind, timeout=15.0):
                t0 = time.time()
                while time.time() - t0 < timeout:
                    m = await owner.recv(timeout)
                    if m.get("type") == "read_event" and m.get("id") == 7 and m["event"].get("type") == kind:
                        return m["event"]
                raise GE.Fail(f"no {kind} event")

            # -- 1. a demo state change sets off a notification rule ------------------------------------
            leak = await ha_get(ha, token, LEAK)
            await ha_set_state(ha, token, LEAK, "on", leak.get("attributes") or {})
            ev = await next_event("notification")
            check(ev["item"] == "n_leak" and ev["entity"] == LEAK and ev["kind"] == "leak",
                  f"the demo {LEAK} going on set off the notification rule: '{ev['title']}: {ev['message']}' "
                  "reached the fictional screen")
            out["notification"] = {k: ev[k] for k in ("item", "entity", "kind", "title", "message", "important", "mute")}
            await ha_set_state(ha, token, LEAK, "off", leak.get("attributes") or {})
            check([r for r in app["audit"].rows() if r["kind"] != "config"] == [],
                  "a notification is delivered by Mantel itself: no house command, no audit row "
                  "(only the hall's move to Mantel, a config row)")
            if not commands:
                await ports(app, host, owner, ev, next_event, out)

            # -- 2. linked mode: a black-screen request from a fake linked client ---------------------------
            _acct, svc_token = app["service_accounts"].create("e2e-home-assistant", ["linked"])
            lk = LinkedClient(base, svc_token)
            people.append(lk)
            hello = await lk.connect()
            uids = {e["unique_id"] for e in hello["entities"]}
            check(uids == set(UID.values()), "the linked hello carries the tablet's four entities with hk_frontend's unique ids")
            before_light = await ha_get(ha, token, BACKLIGHT)
            res, frames = await lk.call(1, type="call_service", service="set_black_screen",
                                        data={"black": True, "brightness": 150}, targets=TARGET)
            check(res["success"] and frames and frames[0]["type"] == "state" and frames[0]["state"] == "on"
                  and frames[0]["attributes"]["confirmed"] is False,
                  "set_black_screen: the black screen's new state was pushed before the answer (confirmed handshake)")
            await owner.ws.send_json({"type": "screen_report", "id": 8, "tablet": "hall", "black": True})
            f = await lk.ws.receive_json(timeout=10)
            check(f["type"] == "state" and f["attributes"]["confirmed"] is True,
                  "the screen reported black: linked HA sees confirmed: true")
            if not commands:
                await owner.ws.send_json({"type": "screen_report", "id": 9, "tablet": "hall", "photos": True})
                f = await lk.ws.receive_json(timeout=10)
                check(f["type"] == "state" and f["unique_id"] == UID["photo_screensaver"] and f["state"] == "on",
                      "the page's photos report (screen_report photos) reaches linked HA's photo screensaver switch")

            async def status():
                st, body = await owner.post("/api/features/status", method="GET")
                assert st == 200, body
                return body

            if not commands:
                s = await until(lambda: _would(status))
                would = s["would"]
                check([(w["action"], w["data"]) for w in would] ==
                      [("light.turn_on", {"entity_id": BACKLIGHT, "brightness": 1})],
                      f"status lists the intended action: light.turn_on {BACKLIGHT} brightness 1 (would, not sent)")
                row = app["audit"].rows(id=would[0]["audit_id"])[0]
                check((row["actor"], row["role"], row["decision"], row["reason"], row["result"]) ==
                      ("mantel:features", "service", "denied", "commands_disabled", "not_sent"),
                      "the intended action has an audit row: Service actor, denied, commands_disabled, not_sent")
                await asyncio.sleep(1.0)
                after = await ha_get(ha, token, BACKLIGHT)
                check(app["commander"] is None and after["state"] == before_light["state"]
                      and after["attributes"].get("brightness") == before_light["attributes"].get("brightness"),
                      f"nothing was sent: no command connection exists and {BACKLIGHT} is still {after['state']}")
                out["status_would"] = would
            else:
                lit = await until(lambda: _light(ha, token, "on", 1))
                check(bool(lit), f"the black screen set the backlight through the gateway: HA says {BACKLIGHT} on, brightness 1")
                rows = app["audit"].rows(actor="mantel:features")
                check([(r["action"], r["decision"], r["result"], r["role"]) for r in rows] ==
                      [("light.turn_on", "allowed", "ok", "service")],
                      "its audit row: actor mantel:features (service), light.turn_on, allowed, ok")
                check(app["commander"].sent == ["light.turn_on"], "exactly one call reached HA: light.turn_on")
                res, frames = await lk.call(2, type="call_service", service="set_black_screen",
                                            data={"black": False, "brightness": 150}, targets=TARGET)
                check(res["success"] and frames[0]["state"] == "off", "the wake: the black screen is off in linked HA")
                lit = await until(lambda: _light(ha, token, "on", 150))
                check(bool(lit), f"the wake carried the brightness back: HA says {BACKLIGHT} brightness 150")
                out["sent_to_ha"] = list(app["commander"].sent)
                await ha_service(ha, token, "light", "turn_off", {"entity_id": BACKLIGHT})   # tidy the demo light
            out["audit"] = [{k: r[k] for k in ("id", "actor", "actor_name", "role", "kind", "action", "target",
                                                "decision", "reason", "result")} for r in app["audit"].rows()]
            out["status"] = {k: v for k, v in (await status()).items() if k in ("commands_enabled", "pieces", "grants",
                                                                                  "calls", "linked", "screens")}
            for p in people:
                await p.close()
        store.db.close()
    return out


async def ports(app, host, owner, ev, next_event, out) -> None:
    """The Phase 4 ports against the scratch HA: the snapshot, the calendars, a feature page."""
    import re
    sid = ev.get("snap")
    check(isinstance(sid, str) and re.fullmatch(r"[0-9a-f]{32}", sid) is not None,
          f"the notification carries a snapshot of {CAMERA}, taken by Mantel through its own credential")
    got = await owner.read({"type": "hk_notify/snap/sign", "snaps": [sid]})
    check(got.get("result") == {"signed": {sid: f"/api/notify/snap/{sid}"}},
          "hk_notify/snap/sign answers Mantel's own route (no HA token, no HA address)")
    async with owner.http.get(owner.base + f"/api/notify/snap/{sid}") as r:
        body, ctype = await r.read(), r.headers.get("Content-Type", "")
    check(r.status == 200 and ctype.startswith("image/") and len(body) > 100,
          f"GET /api/notify/snap/<id> serves the picture ({ctype}, {len(body)} bytes) from Mantel's data")
    out["snapshot"] = {"content_type": ctype, "bytes": len(body), "kept": host.snaps.status()}
    # the calendars' look-ahead: the demo calendar's event, sent when start - 15 min has just passed
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    evs = await host.calendars.events([CALENDAR], now - timedelta(hours=2), now + timedelta(days=7))
    timed = [e for e in evs.get(CALENDAR, []) if "T" in (e.get("start") or "")]
    check(bool(timed), f"Mantel reads {CALENDAR}'s events itself (the REST calendar read): {[e['summary'] for e in timed]}")
    start = datetime.fromisoformat(timed[0]["start"])
    host.calendars.last = None
    sent = await host.calendars.look(now=start - timedelta(minutes=15))
    cal = await next_event("notification")
    check(len(sent) == 1 and cal["kind"] == "calendar" and cal["event"]["summary"] == timed[0]["summary"],
          f"the calendars' look-ahead sent '{cal['title']}: {cal['message']}' to the fictional screen")
    out["calendar"] = {k: cal[k] for k in ("title", "message", "kind")}
    # HK Settings -> Features -> Notifications: read and saved in Mantel, nothing read from or written to HA
    before = len(app["hub"].readproxy.sent_types)
    page = await owner.read({"type": "hk_notify/settings/get"})
    check(page.get("result", {}).get("configured") is True and
          {i["id"] for i in page["result"]["items"]} == {"n_leak", "n_cal"},
          "HK Settings' Notifications page is answered by Mantel (its own settings and House)")
    saved = await owner.save({"type": "hk_notify/settings/set", "changes": {"stay": 60}})
    check(saved.get("result", {}).get("options", {}).get("stay") == 60 and host.notifier.opts["stay"] == 60,
          "its save went to Mantel's settings store (house/mantel_features), checked by the shared checks")
    check(not [t for t in app["hub"].readproxy.sent_types[before:] if t.startswith("hk_notify")],
          "nothing about the page was read from or written to Home Assistant")
    out["feature_page"] = {"items": len(page["result"]["items"]), "saved_stay": 60}


async def _would(status):
    s = await status()
    return s if s["would"] else None


async def _light(ha, token, state, brightness):
    s = await ha_get(ha, token, BACKLIGHT)
    return s if s["state"] == state and s["attributes"].get("brightness") == brightness else None


async def run(token: str) -> dict:
    a = await phase(token, commands=False)
    b = await phase(token, commands=True)
    return {"mantel": "in-process", "home_assistant": SCRATCH_URL, "phases": [a, b], "checks": RESULTS}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--keep-up", action="store_true", help="leave the scratch HA running afterwards")
    ap.add_argument("--reuse", action="store_true", help="use the scratch HA this caller already started; leave it up")
    a = ap.parse_args()
    if not a.reuse:
        GE.wait_for_free_harness()
        say("starting the scratch HA (testha.py up --fresh); this takes a few minutes")
        GE.harness("up", "--fresh")
    elif not testha.ready():
        raise SystemExit("--reuse: the scratch HA is not answering on 127.0.0.1:8124")
    try:
        token = asyncio.run(GE.token_for_scratch())
        evidence = asyncio.run(run(token))
        del token
        out = Path(testha.SCRATCH) / "features_e2e.json"
        out.write_text(json.dumps(evidence, indent=1, default=str))
        say(f"ALL {len(RESULTS)} CHECKS PASSED; evidence in {out}")
        return 0
    except GE.Fail as exc:
        say("FAIL", exc)
        return 1
    finally:
        if not (a.keep_up or a.reuse):
            GE.harness("down")
            say("scratch HA stopped")


if __name__ == "__main__":
    sys.exit(main())
