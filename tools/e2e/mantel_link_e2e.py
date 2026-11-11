"""Mantel Link against a REAL Home Assistant (docs/phase9/MANTEL-LINK.md): the scratch HA's Mantel Link
(custom_components/mantel) linked to Mantel in-process.

Phase ``alone`` (slice 9.2), a Home Assistant WITHOUT HK Frontend:
  1. Starts the scratch HA without HK Frontend (``testha.py up --fresh --no-hk``; Mantel Link installed,
     not set up), or ``--reuse`` one.
  2. Runs Mantel in-process on 127.0.0.1 against it, read-only (commands DISABLED), with a fictional
     wall tablet (Hall) that an Owner moves to Mantel, its ``linked`` piece on, a pop-up, and a Service
     account for HA.
  3. Adds Mantel Link through the scratch HA's own REST, as a user does in its UI (Settings, Devices &
     Services, Add, Mantel Link: the address and a pairing code the Owner made in Mantel Settings, 9.4).
     Then checks, on the real HA:
     - the tablet's four entities are live, Mantel Link's (platform ``mantel``), with Mantel's unique ids;
     - ``mantel.set_black_screen`` and the alias ``hk_frontend.set_black_screen`` both reach Mantel,
       and the black screen's ``confirmed`` handshake holds (the page's report confirms it);
     - ``mantel.show_popup`` and ``hk_frontend.show_popup`` reach Mantel's screens; an unknown pop-up is
       Mantel's validation error in HA under the name it was called by;
     - Mantel sees Mantel Link (protocol 2) and its report (no HK Frontend); an Owner hands it the
       bridge (Mantel Settings' REST, audited);
     - HA's diagnostics never show the credential.
  4. Removes Mantel Link's entry; stops the scratch HA (unless --keep-up / --reuse).

Phase ``handover`` (slice 9.3), a Home Assistant WITH HK Frontend, linked (``--phase handover``):
  1. Starts the scratch HA with HK Frontend (``testha.py up --fresh``), or ``--reuse`` one.
  2. Mantel as above, its linked entry id HK Frontend's; HK Frontend linked to it (Configure -> Linked to
     Mantel Server) mirrors the Hall tablet; Mantel Link is added and stays dormant.
  3. A sleep script (HA's own script engine, ``execute_script``) turns the Hall black through
     ``hk_frontend.set_black_screen`` and waits for the page's ``confirmed``.
  4. An Owner hands the bridge to Mantel Link (Mantel's REST, audited): the four registry entries move to
     Mantel Link (the same registry entries and entity ids, the device's area carried over); the page's
     confirm then ends the script; ``hk_frontend.set_black_screen`` still reaches the tablet; HA's history of
     the switch runs on across the move.
  5. The Owner gives the bridge back: HK Frontend takes the same entries back.
  6. Removes Mantel Link's entry and unlinks HK Frontend; stops the scratch HA (unless --keep-up / --reuse).

Phase ``house`` (HK Frontend removed, docs/phase9/NO-HK-FRONTEND.md), a Home Assistant WITH HK Frontend at first:
  1. HK Frontend (the scratch build) gets an Alarm PIN keypad in front of the demo alarm (its own page's
     ``hk_alarm_pin/add``, a random fictional PIN) and has its Seasonal decorations switch; HK Frontend is linked,
     the Hall tablet is Mantel's, Mantel Link is added and an Owner hands it the bridge (as ``handover``).
  2. The Owner moves ``house`` to Mantel: the Seasonal decorations switch and the Alarm PIN panel move to Mantel
     Link: the same registry entries, entity ids and unique ids, live. Mantel's keypad table got its row.
  3. HK Settings' Alarm PIN page on Mantel sets the PIN in Mantel only (nothing to HA). HA's keypad panel then
     checks Mantel's PIN: a wrong code is "Wrong code", the right one reaches Mantel's gateway, which sends
     nothing (commands off); the demo alarm is untouched. Seasonal decorations turned off in HA is Mantel's setting.
  4. ``house`` back to Home Assistant: HK Frontend takes the same entries back; then to Mantel again.
  5. HK Frontend's entry is REMOVED: every entity stays (same ids, Mantel Link's, live), Mantel Link registers the
     ``hk_frontend.*`` aliases, and an AUTOMATION and a SCRIPT calling ``hk_frontend.show_popup`` /
     ``hk_frontend.set_black_screen`` still reach Mantel; Mantel Link's talk view plays a clip on a demo speaker,
     ``mantel/talk/live`` and ``mantel/energy/sources`` answer, a fictional sunset automation reaches a Mantel screen
     as the Lights page's Tonight list; HA's history of the Seasonal switch runs on.
  6. With HK Frontend gone, moving ``house`` back to Home Assistant is refused in words.

Phase ``phones`` (slice 9.7): a stand-in Companion-app phone in the scratch HA (``testha.py up --phone-probe``:
``notify.mobile_app_e2e_phone`` records what it gets as an event); an Owner picks it for themself; ``mantel.notify``
reaches a Mantel screen and the phone (with Mantel's Dismiss); the Companion app's ``mobile_app_notification_action``
for it reaches Mantel, which takes the banner down; another app's action does nothing.

Phase ``docs`` (slice 9.9): Mantel Link installed from its BUILT public repository (tools/publish/publish.py), set
up the two ways its Setup page says: App-like (the App's real announcer, supervisor_discovery.py, to a stand-in
Supervisor that hands it to the scratch HA's hassio discovery: ``testha.py --supervisor-probe``; Discovered: Mantel,
Add; the next start's new credential followed), then Docker-like by hand (the address and a pairing code); every
action under both names.

Phase ``actions`` (slice 9.8): HK Frontend's music, Clean Areas and automation-snooze actions from the scratch HA
(no HK Frontend, so ``hk_frontend.*`` are Mantel Link's aliases) reach Mantel's own engines: with Mantel's commands
off, a Clean Areas dry run answers its plan and the rest are refused in words (and audited), music without Mantel's
music engine is refused and never sent back to HA; with commands on (fictional demo devices only), Clean Areas
starts the demo robot in the Kitchen through Mantel's gateway as ``mantel:linked``.

Phase ``zeroconf`` (slice 9.5): Mantel's real announcer (mantel_server/announce.py, run with the scratch HA's
own python-zeroconf) announces a fictional Mantel as ``_mantel._tcp`` on LOOPBACK ONLY, and the scratch HA
(``testha.py up --zeroconf-probe``: a scratch-only component browsing that one type on loopback, since HA's own
zeroconf would browse the home network) hands it to Mantel Link: "Discovered: Mantel" waits for a pairing code,
with Mantel's https address; a second announcement of the same Mantel makes no second flow. The code exchange
itself needs Mantel's real https address and is covered by the pairing tests and the alone phase.

Phase ``livetv`` (HK Frontend removed, the HA App's Live TV): the scratch HA without HK Frontend, with HA's own stream
player (``testha.py up --fresh --no-hk --stream``; go2rtc stays off); a FAKE tuner on 127.0.0.1 sending real MPEG-2
video and AC-3 audio (tools/e2e/fake_tuner.py, made with ffmpeg's test sources); Mantel with no go2rtc of its own and
Live TV as an import from HK Frontend leaves it (set up, not turned on). The house moved to Mantel and Mantel Link
holding the bridge, Mantel serves Live TV through Mantel Link: Mantel sees Mantel Link's ``live_tv`` feature; the
channel camera is live in HA (Mantel Link's, streaming) with its now-on sensor and ``sensor.tv_viewers``; the page's
``hk_tv/channels`` is Mantel's (no tuner address in it); HA's own player plays the camera (HLS: H.264 and AAC, pulled
from Mantel Link's transcode, which pulls the tuner); a viewer heartbeat reaches ``sensor.tv_viewers`` in HA; the
transcode refuses a channel Mantel did not name.

SAFETY: refuses to run unless the HA URL is the scratch one; never reads ~/.config/mantel or touches
/Volumes/config or the house's HA. Prints no credential. Commands stay disabled throughout.
"""
from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "hosts/server"))
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools/e2e"))

import aiohttp  # noqa: E402
import aiohttp.web  # noqa: E402
from aiohttp.test_utils import TestServer  # noqa: E402

_spec = importlib.util.spec_from_file_location("gateway_e2e", ROOT / "tools/e2e/gateway_e2e.py")
GE = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(GE)
_spec2 = importlib.util.spec_from_file_location("linked_e2e", ROOT / "tools/e2e/linked_e2e.py")
LE = importlib.util.module_from_spec(_spec2)
_spec2.loader.exec_module(LE)
testha = GE.testha

SCRATCH_URL = GE.SCRATCH_URL
assert SCRATCH_URL == "http://127.0.0.1:8124"
TABLET = {"name": "Hall", "screen": "hk-e2e", "room": "bedroom", "app": "browser", "black_screen": "hk", "uid": "hall"}
BLACK, PHOTOS, SLEEP, INUSE = ("switch.hall_black_screen", "switch.hall_photo_screensaver",
                               "sensor.hall_sleep_screen", "binary_sensor.hall_screen_in_use")
RESULTS: list[str] = []


def say(*a):
    print("[mantel-link-e2e]", *a, flush=True)


def check(cond, what):
    if not cond:
        raise GE.Fail(what)
    say("PASS", what)
    RESULTS.append(what)


until = LE.until


class HA(LE.HA):
    """The scratch HA's own REST and WebSocket, as its admin."""

    async def add_mantel_link(self, url: str, token: str | None = None, code: str | None = None) -> dict:
        st, flow = await self.post("/api/config/config_entries/flow", {"handler": "mantel"})
        assert st == 200 and flow.get("step_id") == "user", flow
        st, done = await self.post(f"/api/config/config_entries/flow/{flow['flow_id']}",
                                   {"url": url, **({"token": token} if token else {}), **({"code": code} if code else {})})
        assert st == 200, done
        return done

    async def mantel_entry(self) -> dict | None:
        st, body = await self.get("/api/config/config_entries/entry?domain=mantel")
        return body[0] if st == 200 and body else None

    async def delete_entry(self, entry_id: str) -> None:
        async with self.http.delete(f"{SCRATCH_URL}/api/config/config_entries/entry/{entry_id}", headers=self.h) as r:
            await r.read()

    async def ws(self, **msg):
        async with self.http.ws_connect(SCRATCH_URL.replace("http", "ws") + "/api/websocket") as ws:
            await ws.receive_json()
            await ws.send_json({"type": "auth", "access_token": self.h["Authorization"].split(" ", 1)[1]})
            assert (await ws.receive_json())["type"] == "auth_ok"
            await ws.send_json({"id": 1, **msg})
            while True:
                m = await ws.receive_json()
                if m.get("id") == 1:
                    return m.get("result") if m.get("success") else {"error": m.get("error")}

    async def registry(self, eid: str) -> dict:
        return await self.ws(type="config/entity_registry/get", entity_id=eid)


def mantel_app(token: str, folder: Path, entry_id: str | None = None, port: int = 0, board: dict | None = None,
               frame_ancestors: tuple[str, ...] = (), commands: bool = False):
    from mantel_server import features
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.settings_store import Actor
    from mantel_server.store import Store
    cfg = Config(data_dir=folder / "data", secrets_dir=folder / "secrets", port=port, ha_url=SCRATCH_URL,
                 frame_ancestors=tuple(frame_ancestors),
                 ha_ws_url=SCRATCH_URL.replace("http", "ws") + "/api/websocket", commands_enabled=commands)
    assert cfg.ha_url == SCRATCH_URL and "192.168." not in cfg.ha_url
    store = Store(cfg.data_dir / "mantel.db")
    app = build_app(cfg, token, store=store, connect_ha=True)
    app["settings"].store.write([
        ("board", "hk-e2e", dict(board or {})),
        ("tablet", "hall", dict(TABLET)),
        ("house", "popups", {"items": [{"hash": "doorbell", "name": "Doorbell"}]}),
        ("house", features.FEATURES_DOC, features.check_settings(
            {"linked": {"enabled": True, **({"entry_id": entry_id} if entry_id else {})}})),
    ], actor=Actor(label="e2e"))
    return app, store, cfg


async def run_alone(token: str) -> dict:
    out: dict = {}
    with tempfile.TemporaryDirectory(prefix="mantel-link-e2e-") as folder:
        app, store, cfg = mantel_app(token, Path(folder))
        hub = app["hub"]
        async with aiohttp.ClientSession() as http, TestServer(app, host="127.0.0.1") as server:
            ha = HA(http, token)
            base = str(server.make_url("")).rstrip("/")
            await asyncio.wait_for(hub.ha.ready.wait(), 60)
            check(not cfg.commands_enabled and app.get("gateway") is None,
                  "Mantel runs with house commands DISABLED (no gateway, no command connection)")
            st, _ = await ha.get("/api/config/config_entries/entry?domain=hk_frontend")
            check(st == 200 and not _, "the scratch HA has no HK Frontend")
            owner = GE.Browser(base, "owner")
            try:
                st, body = await owner.post("/api/bootstrap", {
                    "token": app["accounts"].issue_bootstrap_token(), "username": "e2e-owner",
                    "name": "Fictional Owner", "password": secrets.token_urlsafe(18)})
                assert st == 200, body
                st, body = await owner.post("/api/linked/owners", {"unit": "hall", "owner": "mantel"}, method="PUT")
                check(st == 200 and body["wire"]["tablets"] == ["hall"], "an Owner moves the Hall tablet to Mantel")
                try:
                    await steps_alone(app, ha, owner, base, out)
                finally:
                    e = await ha.mantel_entry()
                    if e:
                        await ha.delete_entry(e["entry_id"])
                        say("removed Mantel Link's entry from the scratch HA")
            finally:
                await owner.http.close()
            out["audit"] = [{k: r[k] for k in ("actor", "role", "kind", "action", "target", "decision")}
                            for r in app["audit"].rows()]
        store.db.close()
    return out


async def steps_alone(app, ha: HA, owner, base: str, out: dict) -> None:
    lk = app["linked"]
    instance = lk.instance
    st, made = await owner.post("/api/linked/pair", {})
    check(st == 200 and made.get("code"), "the Owner makes a pairing code (Mantel Settings, Mantel in Home Assistant)")
    done = await ha.add_mantel_link(base, code=made["code"])
    check(done.get("type") == "create_entry", "Settings, Devices & Services, Add, Mantel Link: the address and the "
                                               "code, traded for a credential, tested and saved")
    entry = done["result"]["entry_id"]
    st, pend = await owner.post("/api/linked/pair", method="GET")
    check(pend.get("pending") is None and pend.get("paired"), "the code is spent; Mantel made the credential")
    diag = await until(lambda: _diag(ha, entry, lambda d: d.get("connected")))
    check(diag is not None and diag["instance"] == instance and diag["protocol"] == 2,
          "HA's diagnostics: linked to this Mantel (its instance id), protocol 2")
    clients = await until(lambda: asyncio.sleep(0, lk.registry.clients_of("mantel")))
    check(bool(clients) and clients[0].protocol == 2 and "bridge" in clients[0].features,
          "Mantel sees Mantel Link, speaking protocol 2")
    rep = await until(lambda: asyncio.sleep(0, clients[0].report.get("hk_frontend")))
    check(rep == {"installed": False, "loaded": False, "linked": False}, "...and its report: no HK Frontend here")
    states = await until(lambda: _all_live(ha))
    check(states is not None, "the Hall tablet's four entities are live in HA: " + ", ".join(sorted(states or {})))
    regs = {eid: await ha.registry(eid) for eid in (BLACK, PHOTOS, SLEEP, INUSE)}
    check(all(r.get("platform") == "mantel" and r.get("config_entry_id") == entry for r in regs.values()),
          "each is Mantel Link's (platform mantel, its entry)")
    check(all(r.get("unique_id") == f"{instance}_hall_{eid.split('.', 1)[1][5:]}" for eid, r in regs.items()),
          "with Mantel's unique ids (no HK Frontend ever: Mantel's instance id, the tablet, the key)")
    out["registry"] = {eid: {k: r.get(k) for k in ("unique_id", "platform")} for eid, r in regs.items()}
    # -- set_black_screen under both names, and the confirmed handshake ---------------------------------
    owner.ws = await owner.http.ws_connect(base + "/ws")
    n = 100
    for domain in ("mantel", "hk_frontend"):
        s, _ = await ha.post(f"/api/services/{domain}/set_black_screen",
                             {"entity_id": BLACK, "black": True, "brightness": 150})
        st = await ha.state(BLACK)
        check(s == 200 and st["state"] == "on" and st["attributes"].get("confirmed") is False
              and st["attributes"].get("brightness") == 150,
              f"{domain}.set_black_screen reaches Mantel: on, brightness 150, not yet confirmed when it returns")
        n += 1
        await owner.ws.send_json({"type": "screen_report", "id": n, "tablet": "hall", "black": True})
        got = await until(lambda: _attr_is(ha, BLACK, "confirmed", True))
        check(got is not None, "the page says it went black: HA sees confirmed: true")
        s, _ = await ha.post(f"/api/services/{domain}/set_black_screen", {"entity_id": BLACK, "black": False})
        st = await ha.state(BLACK)
        check(s == 200 and st["state"] == "off", f"{domain}.set_black_screen off")
    # -- pop-ups under both names -------------------------------------------------------------------------
    await owner.ws.send_json({"type": "read_subscribe", "id": 7, "msg": {"type": "hk_frontend/events/subscribe"}})
    while True:
        got = await owner.recv()
        if got.get("type") == "read_result" and got.get("id") == 7:
            break
    assert "error" not in got, got
    for domain in ("mantel", "hk_frontend"):
        s, _ = await ha.post(f"/api/services/{domain}/show_popup", {"popup": "doorbell"})
        ev = await _event(owner, "popup")
        check(s == 200 and ev is not None and ev.get("popup") == "doorbell",
              f"{domain}.show_popup reaches a Mantel screen's event feed")
    log = Path(testha.SCRATCH) / "hass.log"
    words = "Mantel refused hk_frontend.show_popup"
    seen = log.read_text(errors="replace").count(words)
    s, _ = await ha.post("/api/services/hk_frontend/show_popup", {"popup": "no-such-popup"})
    now = log.read_text(errors="replace").count(words)
    check(s >= 400 and now > seen, f"an unknown pop-up is Mantel's validation error in HA (HTTP {s}; '{words}' in HA's log)")
    await owner.ws.close()
    # -- the bridge: an Owner hands it to Mantel Link (no HK Frontend here, so nothing to wait for) ---------
    st_code, body = await owner.post("/api/linked/owners", {"unit": "bridge", "owner": "mantel"}, method="PUT")
    check(st_code == 200 and body["wire"]["bridge"] == "mantel", "an Owner hands the bridge to Mantel Link")
    rows = app["audit"].rows(kind="config")
    check(rows and rows[-1]["action"] == "linked.bridge", "the hand-over is audited (linked.bridge)")
    diag = await until(lambda: _diag(ha, entry, lambda d: d.get("owners", {}).get("bridge") == "mantel"
                                     and d.get("connected")))
    check(diag is not None and diag["state"] == "mirroring" and diag["connected"],
          "HA's diagnostics: connected, mirroring, Mantel Link holds the bridge")
    check("msvc_" not in json.dumps(diag), "no credential in HA's diagnostics")
    st = await until(lambda: _all_live(ha))
    check(st is not None, "the four entities are still live after the reload")
    check(app["audit"].rows(kind="service") == [], "no household service was called (commands disabled)")


async def _all_live(ha: HA):
    out = {}
    for eid in (BLACK, PHOTOS, SLEEP, INUSE):
        st = await ha.state(eid)
        if st is None or st["state"] in ("unavailable", "unknown"):
            return None
        out[eid] = st["state"]
    return out


async def _attr_is(ha: HA, eid: str, key: str, value):
    st = await ha.state(eid)
    return st if st is not None and st["attributes"].get(key) == value else None


async def _attr_is_like(ha: HA, eid: str, key: str, part: str):
    st = await ha.state(eid)
    return st if st is not None and part in str(st["attributes"].get(key) or "") else None


async def _diag(ha: HA, entry: str, ok):
    st, body = await ha.get(f"/api/diagnostics/config_entry/{entry}")
    d = (body or {}).get("data") if st == 200 and isinstance(body, dict) else None
    return d if d is not None and ok(d) else None        # not answering while the entry reloads


async def _event(owner, kind: str, timeout: float = 15.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            m = await owner.recv(timeout)
        except asyncio.TimeoutError:
            return None
        if m.get("type") == "read_event" and m.get("id") == 7 and m["event"].get("type") == kind:
            return m["event"]
    return None


# ------------------------------------------------------------------------------------- phase: livetv
LIVE_XMLTV = b"""<?xml version="1.0"?><tv>
<channel id="c1"><display-name>4.1</display-name><display-name>FICTIONAL TEST NETWORK</display-name></channel>
<programme channel="c1" start="20200101000000 +0000" stop="20991231000000 +0000"><title>The Endless Test Pattern</title></programme>
</tv>"""
TV_CAMERA, TV_NOW, TV_VIEWERS = "camera.tv_wtst_hd", "sensor.tv_wtst_hd_now", "sensor.tv_viewers"


def _ffprobe(data: bytes) -> list[str]:
    """The codecs in an MPEG-TS segment (ffprobe on this machine)."""
    with tempfile.NamedTemporaryFile(suffix=".ts") as f:
        f.write(data)
        f.flush()
        got = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", f.name],
                             capture_output=True, text=True)
    return sorted(x.strip() for x in got.stdout.split() if x.strip())


async def run_livetv(token: str) -> dict:
    import fake_tuner
    from mantel_server import features
    from mantel_server.settings_store import Actor
    _spec3 = importlib.util.spec_from_file_location("live_tv_e2e", ROOT / "tools/e2e/live_tv_e2e.py")
    LT = importlib.util.module_from_spec(_spec3)
    _spec3.loader.exec_module(LT)
    out: dict = {}
    with tempfile.TemporaryDirectory(prefix="mantel-link-e2e-tv-") as folder:
        ts = LT.make_ts(Path(folder))
        t_app = fake_tuner.make_app(ts, guide=LIVE_XMLTV)
        async with TestServer(t_app, host="127.0.0.1") as tuner_srv:
            tuner = f"127.0.0.1:{tuner_srv.port}"
            app, store, cfg = mantel_app(token, Path(folder))
            check(not cfg.go2rtc_url, "Mantel runs as the HA App does: no go2rtc of its own")
            # Live TV as the import from HK Frontend leaves it: set up, not turned on (HA ran it then)
            body = features.check_settings({
                "linked": {"enabled": True},
                "live_tv": {"enabled": False, "tuner": tuner, "guide_url": f"http://{tuner}/xmltv.xml",
                            "channels": ["4.1"], "quality": "720"},
                "ha": {"added": ["live_tv"], "items": {}, "source": "e2e"}})
            app["settings"].store.write([("house", features.FEATURES_DOC, body)], actor=Actor(label="e2e"))
            hub = app["hub"]
            async with aiohttp.ClientSession() as http, TestServer(app, host="127.0.0.1") as server:
                ha = HA(http, token)
                base = str(server.make_url("")).rstrip("/")
                await asyncio.wait_for(hub.ha.ready.wait(), 60)
                await app["features"].reload()
                st, _ = await ha.get("/api/config/config_entries/entry?domain=hk_frontend")
                check(st == 200 and not _, "the scratch HA has no HK Frontend")
                owner = GE.Browser(base, "owner")
                try:
                    st, b = await owner.post("/api/bootstrap", {
                        "token": app["accounts"].issue_bootstrap_token(), "username": "e2e-owner",
                        "name": "Fictional Owner", "password": secrets.token_urlsafe(18)})
                    assert st == 200, b
                    try:
                        await steps_livetv(app, ha, owner, base, t_app, tuner, out)
                    finally:
                        e = await ha.mantel_entry()
                        if e:
                            await ha.delete_entry(e["entry_id"])
                            say("removed Mantel Link's entry from the scratch HA")
                finally:
                    await owner.http.close()
                out["audit"] = [{k: r[k] for k in ("actor", "role", "kind", "action", "target", "decision")}
                                for r in app["audit"].rows()]
            store.db.close()
    return out


async def steps_livetv(app, ha: HA, owner, base: str, t_app, tuner: str, out: dict) -> None:
    lk, tv = app["linked"], app["live_tv"]
    check(tv.mode() == "ha", "before the house moves: the interim (HA's Live TV)")
    st, made = await owner.post("/api/linked/pair", {})
    done = await ha.add_mantel_link(base, code=made["code"])
    check(done.get("type") == "create_entry", "Mantel Link added to the scratch HA (the address and a pairing code)")
    clients = await until(lambda: asyncio.sleep(0, lk.registry.clients_of("mantel")))
    check(bool(clients) and "live_tv" in clients[0].features, "Mantel sees Mantel Link with Live TV's transcode")
    st, body = await owner.post("/api/linked/owners", {"unit": "bridge", "owner": "mantel"}, method="PUT")
    check(st == 200, "an Owner hands the bridge to Mantel Link")
    st, body = await owner.post("/api/linked/owners", {"unit": "hall", "owner": "mantel"}, method="PUT")
    check(st == 200, "an Owner moves the Hall tablet to Mantel (the tablets first)")
    st, body = await owner.post("/api/linked/owners", {"unit": "house", "owner": "mantel"}, method="PUT")
    check(st == 200 and body["wire"]["house"] == "mantel", f"an Owner moves the house to Mantel {'' if st == 200 else body}")
    await tv.tick()
    check(tv.mode() == "link" and app["features"].tv.lineup, "Mantel serves Live TV through Mantel Link "
                                                            "(it read the tuner's lineup and the guide itself)")
    cam = await until(lambda: _state_is(ha, TV_CAMERA, ("idle", "streaming")))
    check(cam is not None and cam["attributes"].get("supported_features", 0) & 2,
          f"{TV_CAMERA} is live in HA and streams (CameraEntityFeature.STREAM)")
    reg = await ha.registry(TV_CAMERA)
    check(reg.get("platform") == "mantel", "...Mantel Link's")
    now = await until(lambda: _state_is(ha, TV_NOW, ("The Endless Test Pattern",)))
    check(now is not None, f"{TV_NOW}: what is on, from Mantel's own guide")
    v = await until(lambda: _state_is(ha, TV_VIEWERS, ("0",)))
    check(v is not None, f"{TV_VIEWERS} is 0")
    owner.ws = await owner.http.ws_connect(base + "/ws")
    await owner.ws.send_json({"type": "read", "id": 5, "msg": {"type": "hk_tv/channels"}})
    while True:
        m = await owner.recv()
        if m.get("id") == 5:
            break
    got = m.get("result") or {}
    check(got.get("configured") and [c["camera"] for c in got.get("channels", [])] == [TV_CAMERA],
          "the page's hk_tv/channels is Mantel's: channel 4.1 on " + TV_CAMERA)
    check(tuner not in json.dumps(m), "...and never names the tuner")
    # HA's own player: the camera's stream comes from Mantel Link's transcode, which pulls the tuner
    res = await ha.ws(type="camera/stream", entity_id=TV_CAMERA, format="hls")
    check(isinstance(res, dict) and res.get("url"), "HA opens the channel camera's stream (camera/stream, HLS)")
    playlist = None
    segment = b""
    t0 = time.time()
    async with aiohttp.ClientSession() as plain:
        while time.time() - t0 < 60 and not segment:
            async with plain.get(SCRATCH_URL + res["url"]) as r:
                text = await r.text() if r.status == 200 else ""
            media = next((ln for ln in text.splitlines() if ln and not ln.startswith("#")), None)
            if media:
                async with plain.get(SCRATCH_URL + res["url"].rsplit("/", 1)[0] + "/" + media) as r:
                    playlist = await r.text() if r.status == 200 else None
                seg = next((ln for ln in (playlist or "").splitlines() if ln and not ln.startswith("#")
                            and "segment" in ln), None)
                if seg:
                    base_url = SCRATCH_URL + res["url"].rsplit("/", 1)[0] + "/"
                    init = next((ln.split('URI="', 1)[1].split('"', 1)[0] for ln in playlist.splitlines()
                                 if ln.startswith("#EXT-X-MAP")), None)
                    head = b""
                    if init:
                        async with plain.get(base_url + init) as r:
                            head = await r.read()
                    async with plain.get(base_url + seg) as r:
                        segment = head + await r.read() if r.status == 200 else b""
            if not segment:
                await asyncio.sleep(1)
    check(bool(segment), "HA's player has a segment of the channel")
    codecs = _ffprobe(segment)
    check("h264" in codecs and "aac" in codecs,
          f"...transcoded from the tuner's MPEG-2 and AC-3 by Mantel Link: {', '.join(codecs)}")
    check("4.1" in t_app["stats"]["streams"] or t_app["stats"]["served"] >= 1,
          "Mantel Link's transcode pulled channel 4.1 from the tuner")
    out["codecs"] = codecs
    # a viewer's heartbeat: counted by Mantel, published to HA as sensor.tv_viewers
    await owner.ws.send_json({"type": "tv_watching", "id": 6, "channel": "4.1"})
    while True:
        m = await owner.recv()
        if m.get("id") == 6:
            break
    check(m.get("result", {}).get("ha") is False, "the heartbeat is Mantel's alone (no HA Live TV to tell)")
    v = await until(lambda: _state_is(ha, TV_VIEWERS, ("1",)))
    check(v is not None and v["attributes"].get("users") == ["Fictional Owner"], f"{TV_VIEWERS} in HA: 1, the Owner")
    await owner.ws.close()
    async with aiohttp.ClientSession() as plain:
        async with plain.get(SCRATCH_URL + "/api/mantel/tv/stream/9.9") as r:
            check(r.status == 404, "the transcode refuses a channel Mantel did not name")
    check(app["audit"].rows(kind="service") == [], "no household service was called (commands disabled)")


# ------------------------------------------------------------------------------------- phase: handover
async def run_handover(token: str) -> dict:
    out: dict = {}
    with tempfile.TemporaryDirectory(prefix="mantel-link-e2e-") as folder:
        async with aiohttp.ClientSession() as http:
            ha = HA(http, token)
            hk_entry = await ha.entry_id()
            app, store, cfg = mantel_app(token, Path(folder), entry_id=hk_entry)
            hub = app["hub"]
            async with TestServer(app, host="127.0.0.1") as server:
                base = str(server.make_url("")).rstrip("/")
                await asyncio.wait_for(hub.ha.ready.wait(), 60)
                check(not cfg.commands_enabled and app.get("gateway") is None,
                      "Mantel runs with house commands DISABLED (no gateway, no command connection)")
                owner = GE.Browser(base, "owner")
                try:
                    st, body = await owner.post("/api/bootstrap", {
                        "token": app["accounts"].issue_bootstrap_token(), "username": "e2e-owner",
                        "name": "Fictional Owner", "password": secrets.token_urlsafe(18)})
                    assert st == 200, body
                    st, body = await owner.post("/api/linked/owners", {"unit": "hall", "owner": "mantel"}, method="PUT")
                    check(st == 200, "an Owner moves the Hall tablet to Mantel")
                    _a, svc_hk = app["service_accounts"].create("scratch-hk-frontend", ["linked"])
                    _b, svc_ml = app["service_accounts"].create("scratch-mantel-link", ["linked"])
                    try:
                        await steps_handover(app, ha, owner, base, hk_entry, svc_hk, svc_ml, out)
                    finally:
                        e = await ha.mantel_entry()
                        if e:
                            await ha.delete_entry(e["entry_id"])
                            say("removed Mantel Link's entry from the scratch HA")
                        try:
                            await ha.configure_link(hk_entry, enabled=False)
                            say("unlinked HK Frontend in the scratch HA")
                        except Exception as exc:  # noqa: BLE001
                            say("note: could not unlink HK Frontend:", exc)
                finally:
                    await owner.http.close()
                out["audit"] = [{k: r[k] for k in ("actor", "role", "kind", "action", "target", "decision")}
                                for r in app["audit"].rows()]
            store.db.close()
    return out


async def _platforms(ha: HA) -> dict:
    return {eid: (await ha.registry(eid)) for eid in (BLACK, PHOTOS, SLEEP, INUSE)}


async def _all_on(ha: HA, platform: str):
    regs = await _platforms(ha)
    if not all(r.get("platform") == platform for r in regs.values()):
        return None
    return regs if await _all_live(ha) else None


async def steps_handover(app, ha: HA, owner, base: str, hk_entry: str, svc_hk: str, svc_ml: str, out: dict) -> None:
    lk = app["linked"]
    t0 = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() - 5)) + "+00:00"
    done = await ha.configure_link(hk_entry, enabled=True, url=base, token=svc_hk)
    check(done.get("type") == "menu", "HK Frontend: Configure -> Linked to Mantel Server saved")
    regs = await until(lambda: _all_on(ha, "hk_frontend"), timeout=60)
    check(regs is not None, "HK Frontend mirrors the Hall tablet's four entities (platform hk_frontend)")
    ids = {eid: r["id"] for eid, r in regs.items()}
    hk_client = await until(lambda: asyncio.sleep(0, lk.registry.clients_of("hk_frontend")))
    check(bool(hk_client) and "bridge" in hk_client[0].features, "HK Frontend says it can hand over (feature bridge)")
    areas = await ha.ws(type="config/area_registry/list")
    area = next((a for a in areas if a["name"] == "E2E Hall"), None) or \
        await ha.ws(type="config/area_registry/create", name="E2E Hall")
    await ha.ws(type="config/device_registry/update", device_id=regs[BLACK]["device_id"], area_id=area["area_id"])
    done = await ha.add_mantel_link(base, svc_ml)
    check(done.get("type") == "create_entry", "Mantel Link added through HA's own flow")
    ml_entry = done["result"]["entry_id"]
    diag = await until(lambda: _diag(ha, ml_entry, lambda d: d.get("connected")))
    check(diag is not None and diag["state"] == "dormant" and diag["hk_frontend"] == {
        "installed": True, "loaded": True, "linked": True}, "Mantel Link is dormant: HK Frontend holds the bridge")
    link_client = lk.registry.clients_of("mantel")
    rep = await until(lambda: asyncio.sleep(0, link_client and link_client[0].report.get("hk_frontend")))
    check(rep == {"installed": True, "loaded": True, "linked": True}, "Mantel knows HK Frontend is there and linked")
    # -- a sleep script, waiting on the page's confirm -------------------------------------------------------
    async with ha.http.ws_connect(SCRATCH_URL.replace("http", "ws") + "/api/websocket") as ws:
        await ws.receive_json()
        await ws.send_json({"type": "auth", "access_token": ha.h["Authorization"].split(" ", 1)[1]})
        assert (await ws.receive_json())["type"] == "auth_ok"
        await ws.send_json({"id": 1, "type": "subscribe_events", "event_type": "mantel_e2e_sleep_done"})
        assert (await ws.receive_json())["success"]
        await ws.send_json({"id": 2, "type": "execute_script", "sequence": [
            {"action": "hk_frontend.set_black_screen", "target": {"entity_id": BLACK},
             "data": {"black": True, "brightness": 120}},
            {"wait_template": "{{ state_attr('%s', 'confirmed') }}" % BLACK, "timeout": 120,
             "continue_on_timeout": False},
            {"event": "mantel_e2e_sleep_done"}]})
        st = await until(lambda: _state_is(ha, BLACK, ("on",)))
        check(st is not None and st["attributes"].get("confirmed") is False,
              "the sleep script turned the Hall black through hk_frontend.set_black_screen and waits for the confirm")
        # -- the hand-over ----------------------------------------------------------------------------------
        st_code, body = await owner.post("/api/linked/owners", {"unit": "bridge", "owner": "mantel"}, method="PUT")
        check(st_code == 200 and body["wire"]["bridge"] == "mantel", "an Owner hands the bridge to Mantel Link")
        check(app["audit"].rows(kind="config")[-1]["action"] == "linked.bridge", "audited (linked.bridge)")
        regs = await until(lambda: _all_on(ha, "mantel"), timeout=90)
        check(regs is not None, "the four are Mantel Link's now, live")
        check({eid: r["id"] for eid, r in regs.items()} == ids, "the same registry entries (and so the same entity ids)")
        check(all(r["config_entry_id"] == ml_entry for r in regs.values()), "on Mantel Link's entry")
        dev = await ha.ws(type="config/device_registry/list")
        mine = next((d for d in dev if d["id"] == regs[BLACK]["device_id"]), None)
        check(mine is not None and mine["area_id"] == area["area_id"] and ml_entry in mine["config_entries"],
              "on Mantel Link's own device for the Hall, in the area HK Frontend's device had")
        owner.ws = await owner.http.ws_connect(base + "/ws")
        await owner.ws.send_json({"type": "screen_report", "id": 300, "tablet": "hall", "black": True})
        got = None
        t1 = time.time()
        while time.time() - t1 < 20:
            m = await asyncio.wait_for(ws.receive_json(), 20)
            if m.get("id") == 2:
                check(m.get("success") is True, "the sleep script ran without an error")
            if m.get("id") == 1 and m.get("type") == "event":
                got = m
                break
        check(got is not None, "the page's confirm ended the sleep script's wait (it never failed across the move)")
    # -- hk_frontend.set_black_screen still reaches it (HK Frontend's, through Mantel Link) -----------------
    s, _ = await ha.post("/api/services/hk_frontend/set_black_screen", {"entity_id": BLACK, "black": False})
    st = await until(lambda: _state_is(ha, BLACK, ("off",)))
    check(s == 200 and st is not None, "hk_frontend.set_black_screen (HK Frontend's) reaches the Hall through Mantel Link")
    async def history():
        # the recorder writes every few seconds: ask until the latest change is in
        st, hist = await ha.get(f"/api/history/period/{t0}?filter_entity_id={BLACK}&minimal_response&no_attributes")
        got = [x["state"] for x in (hist[0] if st == 200 and hist else [])]
        return got if got and got[-1] == "off" and "on" in got else None
    states = await until(history, timeout=30) or []
    check(states[:1] != [] and "on" in states and states[-1] == "off",
          f"HA's history of {BLACK} runs on across the move ({' -> '.join(states)})")
    out["history"] = states
    # -- and back -----------------------------------------------------------------------------------------------
    st_code, body = await owner.post("/api/linked/owners", {"unit": "bridge", "owner": "hk_frontend"}, method="PUT")
    check(st_code == 200 and body["wire"]["bridge"] == "hk_frontend", "the Owner gives the bridge back to HK Frontend")
    regs = await until(lambda: _all_on(ha, "hk_frontend"), timeout=90)
    check(regs is not None and {eid: r["id"] for eid, r in regs.items()} == ids,
          "HK Frontend takes the same registry entries back, live")
    diag = await until(lambda: _diag(ha, ml_entry, lambda d: d.get("connected") and d.get("state") == "dormant"))
    check(diag is not None, "Mantel Link is dormant again")
    check(app["audit"].rows(kind="service") == [], "no household service was called (commands disabled)")
    await owner.ws.close()


async def _state_is(ha: HA, eid: str, states: tuple[str, ...]):
    st = await ha.state(eid)
    return st if st is not None and st["state"] in states else None


# ------------------------------------------------------------------------------------- phase: house
DEMO_ALARM = "alarm_control_panel.security"           # HA's demo integration's (fictional) manual alarm


async def _entries_by_uid(ha: HA, uids: set[str]) -> dict[str, dict]:
    regs = await ha.ws(type="config/entity_registry/list")
    return {r["unique_id"]: r for r in regs if r.get("unique_id") in uids}


async def _house_on(ha: HA, uids: set[str], platform: str):
    got = await _entries_by_uid(ha, uids)
    if len(got) != len(uids) or not all(r["platform"] == platform for r in got.values()):
        return None
    for r in got.values():
        st = await ha.state(r["entity_id"])
        if st is None or st["state"] in ("unavailable", "unknown"):
            return None
    return got


def _log_count(words: str) -> int:
    return (Path(testha.SCRATCH) / "hass.log").read_text(errors="replace").count(words)


async def run_house(token: str) -> dict:
    out: dict = {}
    with tempfile.TemporaryDirectory(prefix="mantel-link-e2e-") as folder:
        async with aiohttp.ClientSession() as http:
            ha = HA(http, token)
            hk_entry = await ha.entry_id()
            app, store, cfg = mantel_app(token, Path(folder), entry_id=hk_entry)
            hub = app["hub"]
            async with TestServer(app, host="127.0.0.1") as server:
                base = str(server.make_url("")).rstrip("/")
                await asyncio.wait_for(hub.ha.ready.wait(), 60)
                check(not cfg.commands_enabled and app.get("gateway") is None,
                      "Mantel runs with house commands DISABLED (no gateway, no command connection)")
                owner = GE.Browser(base, "owner")
                try:
                    st, body = await owner.post("/api/bootstrap", {
                        "token": app["accounts"].issue_bootstrap_token(), "username": "e2e-owner",
                        "name": "Fictional Owner", "password": secrets.token_urlsafe(18)})
                    assert st == 200, body
                    st, body = await owner.post("/api/linked/owners", {"unit": "hall", "owner": "mantel"}, method="PUT")
                    check(st == 200, "an Owner moves the Hall tablet to Mantel")
                    _a, svc_hk = app["service_accounts"].create("scratch-hk-frontend", ["linked"])
                    _b, svc_ml = app["service_accounts"].create("scratch-mantel-link", ["linked"])
                    try:
                        await steps_house(app, ha, owner, base, hk_entry, svc_hk, svc_ml, out)
                    finally:
                        e = await ha.mantel_entry()
                        if e:
                            await ha.delete_entry(e["entry_id"])
                            say("removed Mantel Link's entry from the scratch HA")
                finally:
                    if owner.ws is not None:
                        await owner.ws.close()
                    await owner.http.close()
                out["audit"] = [{k: r[k] for k in ("actor", "role", "kind", "action", "target", "decision")}
                                for r in app["audit"].rows()]
            store.db.close()
    return out


async def steps_house(app, ha: HA, owner, base: str, hk_entry: str, svc_hk: str, svc_ml: str, out: dict) -> None:
    lk = app["linked"]
    t0 = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() - 5)) + "+00:00"
    pin = "".join(secrets.choice("123456789") for _ in range(6))        # fictional, this run only, never printed
    # -- HK Frontend's own house: an Alarm PIN keypad in front of the demo alarm, its Seasonal switch ----------
    page = await ha.ws(type="hk_alarm_pin/add", alarm=DEMO_ALARM, pin=pin, pin_again=pin, arm_required=True)
    keypad = next((a["panel"] for a in (page or {}).get("alarms") or [] if a.get("alarm") == DEMO_ALARM), None)
    check(keypad is not None and keypad.startswith("alarm_control_panel."),
          f"HK Frontend has an Alarm PIN keypad in front of the demo alarm ({keypad})")
    alarm_before = (await ha.state(DEMO_ALARM))["state"]
    seasonal_uid = f"{hk_entry}_seasonal_decorations"
    keypad_reg = await ha.registry(keypad)
    uids = {seasonal_uid, keypad_reg["unique_id"]}
    hk_regs = await until(lambda: _house_on(ha, uids, "hk_frontend"), timeout=60)
    check(hk_regs is not None, "HK Frontend's Seasonal decorations switch and its Alarm PIN panel are live, HK's")
    reg_ids = {u: r["id"] for u, r in hk_regs.items()}
    eids = {u: r["entity_id"] for u, r in hk_regs.items()}
    seasonal = eids[seasonal_uid]
    # -- linked, the Hall Mantel's, Mantel Link holding the bridge (as phase handover) ----------------------------
    done = await ha.configure_link(hk_entry, enabled=True, url=base, token=svc_hk)
    check(done.get("type") == "menu", "HK Frontend: Configure -> Linked to Mantel saved")
    check(await until(lambda: _all_on(ha, "hk_frontend"), timeout=60) is not None, "HK Frontend mirrors the Hall")
    done = await ha.add_mantel_link(base, svc_ml)
    check(done.get("type") == "create_entry", "Mantel Link added through HA's own flow")
    ml_entry = done["result"]["entry_id"]
    check(await until(lambda: _diag(ha, ml_entry, lambda d: d.get("connected"))) is not None, "Mantel Link connected")
    await until(lambda: asyncio.sleep(0, (lk.registry.clients_of("mantel") or [None])[0]
                                      and lk.registry.clients_of("mantel")[0].report.get("hk_frontend")))
    st_code, body = await owner.post("/api/linked/owners", {"unit": "bridge", "owner": "mantel"}, method="PUT")
    check(st_code == 200 and body["wire"]["bridge"] == "mantel", "an Owner hands the bridge to Mantel Link")
    check(await until(lambda: _all_on(ha, "mantel"), timeout=90) is not None, "the Hall's four are Mantel Link's")
    check(await _house_on(ha, uids, "hk_frontend") is not None, "the house's own entities are still HK Frontend's")
    learned = await until(lambda: asyncio.sleep(0, ((app["linked_owners"].remembered("keypads") or {}).get(
        "panels") or {}).get(keypad, {}).get("protects")), timeout=90)
    check(learned == DEMO_ALARM, "Mantel learned (read-only) which alarm HK Frontend's keypad protects, while HK runs it")
    # -- the house hand-over ------------------------------------------------------------------------------------
    st_code, body = await owner.post("/api/linked/owners", {"unit": "house", "owner": "mantel"}, method="PUT")
    check(st_code == 200 and body["wire"]["house"] == "mantel", "the Owner moves `house` to Mantel (audited)")
    moves = [r for r in app["audit"].rows(kind="config") if r["action"] == "linked.owner"]
    check(bool(moves), "audited (linked.owner)")
    regs = await until(lambda: _house_on(ha, uids, "mantel"), timeout=120)
    if regs is None:
        now = await _entries_by_uid(ha, uids)
        say("published by Mantel:", sorted(app["linked_house"].descs), "rows:",
            [e.entity for e in app["alarm_pin"].entries()], "remembered:", app["linked_owners"].remembered("keypads"))
        for u, r in now.items():
            st = await ha.state(r["entity_id"])
            say("  ", r["entity_id"], r["platform"], (st or {}).get("state"))
    check(regs is not None, "Seasonal decorations and the Alarm PIN panel are Mantel Link's now, live")
    check({u: r["id"] for u, r in regs.items()} == reg_ids and {u: r["entity_id"] for u, r in regs.items()} == eids,
          "the same registry entries, entity ids and unique ids")
    check(all(r["config_entry_id"] == ml_entry for r in regs.values()), "on Mantel Link's entry")
    row = app["alarm_pin"].entry(keypad)
    check(row is not None and row.forward_to == DEMO_ALARM and not row.house_code,
          "Mantel's keypad table has the panel, in front of the demo alarm (no PIN yet: HA never gives its PIN out)")
    # -- HK Settings' Alarm PIN page: Mantel's table only ---------------------------------------------------------
    owner.ws = await owner.http.ws_connect(base + "/ws")
    got = await owner.read({"type": "hk_alarm_pin/settings/get"})
    mine = [a for a in got["result"]["alarms"] if a["panel"] == keypad]
    check(mine and mine[0]["pin_set"] is False and mine[0]["alarm"] == DEMO_ALARM,
          "HK Settings' Alarm PIN page is Mantel's table (the panel, its alarm, no PIN set in Mantel yet)")
    got = await owner.save({"type": "hk_alarm_pin/settings/set", "entry_id": keypad,
                            "changes": {"pin": pin, "pin_again": pin}})
    check("result" in got and [a for a in got["result"]["alarms"] if a["panel"] == keypad][0]["pin_set"] is True,
          "the page sets the Alarm PIN in Mantel (commands off: a settings save, nothing sent to HA)")
    check(app["audit"].rows(kind="service") == [] and app["audit"].rows(kind="ws") == [],
          "no command and no HA write for it")
    # HA's keypad panel checks MANTEL's PIN now
    seen = _log_count("Wrong code")
    s, _ = await ha.post("/api/services/alarm_control_panel/alarm_disarm", {"entity_id": keypad, "code": "0000"})
    check(s >= 400 and _log_count("Wrong code") > seen, f"a wrong code at HA's keypad panel: Mantel's \"Wrong code\" (HTTP {s})")
    sent_none, wrong = _log_count("nothing was sent"), _log_count("Wrong code")
    s, _ = await ha.post("/api/services/alarm_control_panel/alarm_arm_away", {"entity_id": keypad, "code": pin})
    # past the PIN, the gateway still sends nothing: the demo alarm wants a code of its own that Mantel doesn't hold
    # (alarm_ha_code_missing), and with commands off nothing would be sent anyway
    check(s >= 400 and _log_count("Wrong code") == wrong and _log_count("nothing was sent") > sent_none,
          f"the right code passes Mantel's PIN check; its gateway then sends nothing (HTTP {s})")
    check((await ha.state(DEMO_ALARM))["state"] == alarm_before, "the demo alarm is untouched")
    # Seasonal decorations: Mantel's own setting
    s, _ = await ha.post("/api/services/switch/turn_off", {"entity_id": seasonal})
    sky = app["settings"].house_settings().get("sky") or {}
    st = await until(lambda: _state_is(ha, seasonal, ("off",)))
    check(s == 200 and sky.get("decorations") is False and st is not None,
          "Seasonal decorations turned off in HA is Mantel's house setting")
    # -- house back to Home Assistant (HK Frontend is there) and to Mantel again ----------------------------------
    st_code, body = await owner.post("/api/linked/owners", {"unit": "house", "owner": "ha"}, method="PUT")
    check(st_code == 200 and body["wire"]["house"] == "ha", "the Owner moves `house` back to Home Assistant")
    back = await until(lambda: _house_on(ha, uids, "hk_frontend"), timeout=120)
    check(back is not None and {u: r["id"] for u, r in back.items()} == reg_ids,
          "HK Frontend takes the same registry entries back, live (reversible)")
    st_code, body = await owner.post("/api/linked/owners", {"unit": "house", "owner": "mantel"}, method="PUT")
    check(st_code == 200 and await until(lambda: _house_on(ha, uids, "mantel"), timeout=120) is not None,
          "and to Mantel again")
    # -- HK Frontend removed ---------------------------------------------------------------------------------------
    await ha.delete_entry(hk_entry)
    st, left = await ha.get("/api/config/config_entries/entry?domain=hk_frontend")
    check(st == 200 and not left, "HK Frontend's entry is removed from the scratch HA")
    diag = await until(lambda: _diag(ha, ml_entry, lambda d: d.get("connected") and d.get("hk_frontend", {}).get(
        "installed") is False), timeout=60)
    check(diag is not None and diag["state"] == "mirroring", "Mantel Link: connected, mirroring, no HK Frontend")
    regs = await until(lambda: _house_on(ha, uids, "mantel"), timeout=60)
    check(regs is not None and {u: r["id"] for u, r in regs.items()} == reg_ids,
          "the house's entities live on: the same registry entries and entity ids")
    hall = await until(lambda: _all_on(ha, "mantel"), timeout=60)
    check(hall is not None, "and the Hall tablet's four")
    st, services = await ha.get("/api/services")
    hk = next((d["services"] for d in services if d["domain"] == "hk_frontend"), {})
    check({"set_black_screen", "show_popup", "close_popup", "notify", "clean_areas", "pause_automation",
           "music_play"} <= set(hk), "Mantel Link answers the hk_frontend.* actions now (aliases)")
    # an automation and a script written for HK Frontend still work
    await owner.ws.send_json({"type": "read_subscribe", "id": 7, "msg": {"type": "hk_frontend/events/subscribe"}})
    while True:
        m = await owner.recv()
        if m.get("type") == "read_result" and m.get("id") == 7:
            break
    s, _ = await ha.post("/api/config/automation/config/mantel_e2e_ring", {
        "alias": "E2E ring (fictional)", "triggers": [{"trigger": "event", "event_type": "mantel_e2e_ring"}],
        "actions": [{"action": "hk_frontend.show_popup", "data": {"popup": "doorbell"}}], "mode": "single"})
    check(s == 200, "an automation calling hk_frontend.show_popup saved in the scratch HA")
    await asyncio.sleep(2)
    await ha.post("/api/events/mantel_e2e_ring", {})
    ev = await _event(owner, "popup", timeout=20)
    check(ev is not None and ev.get("popup") == "doorbell",
          "the automation's hk_frontend.show_popup reaches a Mantel screen with HK Frontend gone")
    s, _ = await ha.post("/api/config/script/config/mantel_e2e_black", {
        "alias": "E2E black (fictional)", "sequence": [
            {"action": "hk_frontend.set_black_screen", "target": {"entity_id": BLACK}, "data": {"black": True}}]})
    await asyncio.sleep(2)
    s, _ = await ha.post("/api/services/script/mantel_e2e_black", {})
    st = await until(lambda: _state_is(ha, BLACK, ("on",)))
    check(s == 200 and st is not None, "a script's hk_frontend.set_black_screen turns the Hall black through Mantel")
    await ha.post("/api/services/mantel/set_black_screen", {"entity_id": BLACK, "black": False})
    # -- what only code inside HA can do, now Mantel Link's: talk-back and the Energy plan's helper sources -------
    speakers = [x["entity_id"] for x in (await ha.get("/api/states"))[1]
                if x["entity_id"].startswith("media_player.")
                and int(x["attributes"].get("supported_features") or 0) & 512]          # PLAY_MEDIA
    check(bool(speakers), f"the scratch HA has a demo speaker that plays media ({speakers[:1]})")
    clip = b"\x1aE\xdf\xa3" + bytes(400)                                      # a fictional, silent "clip"
    async with ha.http.post(f"{SCRATCH_URL}/api/mantel/talk?entity_id={speakers[0]}", data=clip,
                            headers={**ha.h, "Content-Type": "audio/webm"}) as r:
        st, body = r.status, await r.json(content_type=None)
    played = await until(lambda: _attr_is_like(ha, speakers[0], "media_content_id", "/api/mantel/talk/"))
    check(st == 200 and body.get("ok") and played is not None,
          "Mantel Link's talk view (HK Frontend's, ported): the clip is played on the speaker from a signed URL")
    got = await ha.ws(type="mantel/talk/live", entity_id=speakers[0], rate=48000)
    check(isinstance(got, dict) and (got.get("error") or {}).get("code") == "not_supported",
          "mantel/talk/live is there (a demo speaker isn't a UniFi Protect doorbell: refused, the card sends the clip)")
    got = await ha.ws(type="mantel/energy/sources")
    check(isinstance(got, dict) and isinstance(got.get("sources"), dict), "mantel/energy/sources answers (read only)")
    # -- the Lights page's "Tonight" list: Mantel Link works it out, Mantel's screen gets it -----------------------
    s, _ = await ha.post("/api/config/automation/config/mantel_e2e_dusk", {
        "alias": "Lighting - E2E Bedroom - Dusk (fictional)", "mode": "single",
        "triggers": [{"trigger": "sun", "event": "sunset", "offset": "-00:10:00", "id": "dusk"}],
        "actions": [{"action": "light.turn_on", "target": {"entity_id": "light.bed_light"}}]})
    check(s == 200, "a fictional sunset automation for a demo light saved in the scratch HA")
    await asyncio.sleep(2)
    await owner.ws.send_json({"type": "read_subscribe", "id": 8, "msg": {"type": "hk_frontend/page_headers/subscribe"}})

    async def tonight():
        for _ in range(40):
            m = await owner.recv(20)
            if m.get("id") == 8 and m.get("type") == "read_event":
                rows = [e for e in m["event"]["lights"]["schedule"] if e.get("automation") == "automation.lighting_e2e_bedroom_dusk_fictional"]
                if rows:
                    return rows[0]
        return None
    row = await tonight()
    check(row is not None and (row["kind"], row["event"], row["offset_s"], row["effect"], row["entities"], row["area"],
                               row["ready"]) == ("sun", "sunset", -600, "on", ["light.bed_light"], "E2E Bedroom", True),
          "the Lights page's Tonight list reaches a Mantel screen from Mantel Link (sunset -10 min, Bedroom light on)")
    # -- no going back without HK Frontend ------------------------------------------------------------------------
    st_code, body = await owner.post("/api/linked/owners", {"unit": "house", "owner": "ha"}, method="PUT")
    check(st_code == 400 and body["error"]["code"] == "no_hk_frontend" and app["linked_owners"].house(),
          "with HK Frontend gone, moving `house` back to Home Assistant is refused in words")

    async def history():
        st, hist = await ha.get(f"/api/history/period/{t0}?filter_entity_id={seasonal}&minimal_response&no_attributes")
        got = [x["state"] for x in (hist[0] if st == 200 and hist else [])]
        return got if "off" in got and got[-1] in ("on", "off") else None
    states = await until(history, timeout=30) or []
    check(states[:1] == ["on"] and "off" in states,
          f"HA's history of {seasonal} runs on across every move ({' -> '.join(states)})")
    out.update(history=states, keypad=keypad, entities=sorted(eids.values()))
    tried = app["audit"].rows(kind="service")
    check(tried and all(r["action"].startswith("alarm_control_panel.") and r["decision"] != "allowed" for r in tried),
          f"no household service was called: only the {len(tried)} keypad attempts, each refused and audited")


# ------------------------------------------------------------------------------------- phase: zeroconf
async def run_zeroconf(token: str) -> dict:
    import os
    import subprocess
    out: dict = {}
    instance = secrets.token_hex(16)
    with tempfile.TemporaryDirectory(prefix="mantel-link-zc-") as folder:
        from mantel_server import announce
        f = Path(folder) / "announce.json"
        announce.write(f, instance, "https://mantel.example.test:8443/")
        py = Path(testha.VENV) / "bin/python"
        env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
        env["PYTHONPATH"] = str(ROOT / "hosts/server")
        proc = subprocess.Popen([str(py), "-m", "mantel_server.announce", "--file", str(f), "--every", "1",
                                 "--interface", "127.0.0.1"], env=env, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, text=True)
        try:
            async with aiohttp.ClientSession() as http:
                ha = HA(http, token)

                async def flow():
                    flows = await ha.ws(type="config_entries/flow/progress")
                    mine = [x for x in (flows if isinstance(flows, list) else []) if x.get("handler") == "mantel"
                            and (x.get("context") or {}).get("unique_id") == instance]
                    return mine or None
                got = await until(flow, timeout=60)
                check(got is not None and len(got) == 1, "the announcement on loopback reached the real HA: one "
                      "'Discovered: Mantel' flow, keyed by Mantel's instance id")
                fl = got[0]
                check(fl["context"].get("source") == "zeroconf" and fl.get("step_id") == "zeroconf_confirm",
                      "it waits for a pairing code (zeroconf_confirm)")
                st, form = await ha.get(f"/api/config/config_entries/flow/{fl['flow_id']}")
                check(st == 200 and (form.get("description_placeholders") or {}).get("url")
                      == "https://mantel.example.test:8443", "with Mantel's https address from the announcement")
                check([k["name"] for k in form.get("data_schema") or []] == ["code"], "asking only for the code")
                await asyncio.sleep(3)
                again = await flow()
                check(again is not None and len(again) == 1, "the same Mantel announced again: still one flow")
                async with http.delete(f"{SCRATCH_URL}/api/config/config_entries/flow/{fl['flow_id']}",
                                       headers=ha.h) as r:
                    await r.read()
                out["flow"] = {k: fl.get(k) for k in ("handler", "step_id")}
        finally:
            proc.terminate()
            try:
                logs = proc.communicate(timeout=10)[0]
            except subprocess.TimeoutExpired:
                proc.kill()
                logs = proc.communicate()[0]
            out["announcer"] = logs[-2000:]
    return out


# ------------------------------------------------------------------------------------- phase: docs
async def run_docs(token: str) -> dict:
    """Setup as Mantel Link's docs say (docs/Setup.md), on a scratch HA with Mantel Link installed from the BUILT
    public repository: App-like (the App's real announcer -> a stand-in Supervisor -> HA's hassio discovery ->
    Discovered: Mantel -> Add), its credential rotated at the next start; then Docker-like by hand (the address and
    a pairing code)."""
    import socket
    out: dict = {}
    with socket.socket() as sk:
        sk.bind(("127.0.0.1", 0))
        port = sk.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="mantel-link-docs-") as folder:
        app, store, cfg = mantel_app(token, Path(folder), port=port)
        sup_token = Path(folder) / "supervisor_token"
        sup_token.write_text("fictional-supervisor-credential")
        async with aiohttp.ClientSession() as http:
            ha = HA(http, token)
            forwarded: list[dict] = []

            async def sup_info(request):
                return aiohttp.web.json_response({"data": {"hostname": "127.0.0.1"}})

            async def sup_post(request):
                body = await request.json()
                forwarded.append({"service": body.get("service"), "url": body["config"].get("url")})
                s2, _ = await ha.post("/api/mantel_e2e/discovery", {**body, "uuid": f"u{len(forwarded)}"})
                return aiohttp.web.json_response({"result": "ok", "data": {"uuid": f"u{len(forwarded)}"}},
                                                 status=200 if s2 == 200 else 500)

            async def sup_delete(request):
                return aiohttp.web.json_response({"result": "ok"})
            sup = aiohttp.web.Application()
            sup.router.add_get("/addons/self/info", sup_info)
            sup.router.add_post("/discovery", sup_post)
            sup.router.add_delete("/discovery/{uuid}", sup_delete)
            async with TestServer(sup, host="127.0.0.1") as sup_server, \
                    TestServer(app, host="127.0.0.1", port=port) as server:
                base = str(server.make_url("")).rstrip("/")
                await asyncio.wait_for(app["hub"].ha.ready.wait(), 60)
                object.__setattr__(cfg, "supervisor_url", str(sup_server.make_url("")).rstrip("/"))
                object.__setattr__(cfg, "token_file", sup_token)
                owner = GE.Browser(base, "owner")
                try:
                    st, body = await owner.post("/api/bootstrap", {
                        "token": app["accounts"].issue_bootstrap_token(), "username": "e2e-owner",
                        "name": "Fictional Owner", "password": secrets.token_urlsafe(18)})
                    assert st == 200, body
                    await steps_docs(app, ha, owner, base, port, out)
                finally:
                    await owner.http.close()
                    e = await ha.mantel_entry()
                    if e:
                        await ha.delete_entry(e["entry_id"])
            out["forwarded"] = forwarded
        store.db.close()
    return out


async def _discovered(ha: HA):
    flows = await ha.ws(type="config_entries/flow/progress")
    mine = [x for x in (flows if isinstance(flows, list) else []) if x.get("handler") == "mantel"
            and (x.get("context") or {}).get("source") == "hassio"]
    return mine or None


async def steps_docs(app, ha: HA, owner, base: str, port: int, out: dict) -> None:
    from mantel_server.ha import supervisor_discovery as SD
    st, manifest = await ha.get("/api/config/config_entries/flow_handlers")
    check("mantel" in (manifest or []), "Mantel Link, installed from the built public repository, is offered by HA")
    first = await SD.announce(app)
    check(first is not None and first["url"] == f"http://127.0.0.1:{port}",
          "the App announces Mantel to the Supervisor: its own address and a credential it made")
    flows = await until(lambda: _discovered(ha), timeout=30)
    check(flows is not None and len(flows) == 1 and flows[0]["step_id"] == "hassio_confirm",
          "Settings, Devices & Services: Discovered: Mantel (Setup.md, from the App)")
    st, done = await ha.post(f"/api/config/config_entries/flow/{flows[0]['flow_id']}", {})
    check(st == 200 and done.get("type") == "create_entry", "Add: one click, tested and saved")
    entry = done["result"]["entry_id"]
    diag = await until(lambda: _diag(ha, entry, lambda d: d.get("connected")))
    check(diag is not None and diag["instance"] == app["linked"].instance, "linked to this Mantel")
    acct1 = first["account"]
    second = await SD.announce(app)
    accounts = app["service_accounts"]
    check(second["account"] != acct1 and not accounts.live(acct1),
          "the App's next start: a new credential, the previous one revoked")
    clients = await until(lambda: asyncio.sleep(0, [c for c in app["linked"].registry.clients_of("mantel")
                                                    if getattr(c.account, "id", None) == second["account"]]),
                          timeout=60)
    check(bool(clients), "...and Home Assistant's entry followed it: linked again with the new one, nothing typed")
    flows = await _discovered(ha)
    check(not flows, "no second 'Discovered' card for the same Mantel")
    await ha.delete_entry(entry)
    # -- Docker-like: by hand, Mantel's address and a pairing code (Setup.md, By hand) -------------------------
    st, made = await owner.post("/api/linked/pair", {})
    done = await ha.add_mantel_link(base, code=made["code"])
    check(done.get("type") == "create_entry", "By hand: Mantel's address and a pairing code, tested and saved")
    entry = done["result"]["entry_id"]
    diag = await until(lambda: _diag(ha, entry, lambda d: d.get("connected")))
    check(diag is not None and diag["state"] == "mirroring" and diag["hk_frontend"]["installed"] is False,
          "linked; with no HK Frontend, Mantel Link shows Mantel's entities")
    for svc in ("set_black_screen", "show_popup", "notify", "clean_areas", "music_play", "pause_automation"):
        st, services = await ha.get("/api/services")
        names = {d["domain"]: set(d["services"]) for d in services}
        if svc not in names.get("hk_frontend", set()) or svc not in names.get("mantel", set()):
            check(False, f"mantel.{svc} and hk_frontend.{svc} both offered")
    check(True, "every action under both names (Actions.md)")


# ------------------------------------------------------------------------------------- phase: actions
VACUUM = "vacuum.demo_vacuum_2_second_floor"     # a demo robot that starts (no room map): cleans the area it is in


async def run_actions(token: str) -> dict:
    out: dict = {}
    async with aiohttp.ClientSession() as http:
        ha = HA(http, token)
        areas = {a["name"]: a["area_id"] for a in await ha.ws(type="config/area_registry/list")}
        for v in ("vacuum.demo_vacuum_3_third_floor",):          # an earlier run's choice, out of the Kitchen
            await ha.ws(type="config/entity_registry/update", entity_id=v, area_id=None)
        await ha.ws(type="config/entity_registry/update", entity_id=VACUUM, area_id=areas["Kitchen"])
        await ha.post("/api/services/vacuum/return_to_base", {"entity_id": VACUUM})
        for commands in (False, True):
            with tempfile.TemporaryDirectory(prefix="mantel-link-actions-") as folder:
                app, store, cfg = mantel_app(token, Path(folder), commands=commands)
                from mantel_server import features
                from mantel_server.settings_store import Actor
                app["settings"].store.write([("house", features.FEATURES_DOC, features.check_settings(
                    {"linked": {"enabled": True}, "clean_areas": {"enabled": True}}))], actor=Actor(label="e2e"))
                async with TestServer(app, host="127.0.0.1") as server:
                    base = str(server.make_url("")).rstrip("/")
                    await asyncio.wait_for(app["hub"].ha.ready.wait(), 60)
                    owner = GE.Browser(base, "owner")
                    try:
                        st, body = await owner.post("/api/bootstrap", {
                            "token": app["accounts"].issue_bootstrap_token(), "username": "e2e-owner",
                            "name": "Fictional Owner", "password": secrets.token_urlsafe(18)})
                        assert st == 200, body
                        st, made = await owner.post("/api/linked/pair", {})
                        done = await ha.add_mantel_link(base, code=made["code"])
                        check(done.get("type") == "create_entry",
                              f"Mantel Link added (Mantel with house commands {'ON' if commands else 'off'})")
                        entry = done["result"]["entry_id"]
                        await until(lambda: _diag(ha, entry, lambda d: d.get("connected")))
                        try:
                            await (steps_actions_on if commands else steps_actions_off)(app, ha, out)
                        finally:
                            await ha.delete_entry(entry)
                    finally:
                        await owner.http.close()
                store.db.close()
        await ha.post("/api/services/vacuum/return_to_base", {"entity_id": VACUUM})
    return out


async def _refused(ha: HA, path: str, body: dict, words: str) -> bool:
    log = Path(testha.SCRATCH) / "hass.log"
    seen = log.read_text(errors="replace").count(words)
    s, _ = await ha.post(path, body)
    return s >= 400 and log.read_text(errors="replace").count(words) > seen


async def steps_actions_off(app, ha: HA, out: dict) -> None:
    s, got = await ha.post("/api/services/hk_frontend/clean_areas?return_response", {"areas": ["kitchen"], "dry_run": True})
    plan = (got or {}).get("service_response") or {} if isinstance(got, dict) else {}
    if not plan:
        say("note: HA answered", s, str(got)[:300])
    check(s == 200 and plan.get("dry_run") is True and plan["plan"][0]["vacuum"] == VACUUM,
          "hk_frontend.clean_areas (a dry run) reaches Mantel's Clean Areas: its plan comes back")
    check(await _refused(ha, "/api/services/mantel/clean_areas", {"areas": ["kitchen"]},
                         "Mantel refused mantel.clean_areas: house commands are disabled"),
          "mantel.clean_areas with Mantel's commands off: refused in words (HA's log), nothing sent")
    check(await _refused(ha, "/api/services/hk_frontend/pause_automation", {"entity_id": "automation.e2e"},
                         "Mantel refused hk_frontend.pause_automation: house commands are disabled"),
          "hk_frontend.pause_automation with commands off: refused in words")
    check(await _refused(ha, "/api/services/mantel/music_stop", {},
                         "Mantel refused mantel.music_stop: Mantel's music isn't on"),
          "mantel.music_stop without Mantel's music: refused in words, never sent back to HA")
    rows = [r for r in app["audit"].rows() if r["actor"] == "mantel:linked"]
    check(rows and all(r["reason"] == "commands_disabled" for r in rows), "each attempt audited as mantel:linked")
    st = await ha.state(VACUUM)
    check(st["state"] == "docked", f"{VACUUM} untouched")


async def steps_actions_on(app, ha: HA, out: dict) -> None:
    s, got = await ha.post("/api/services/mantel/clean_areas?return_response", {"areas": ["kitchen"]})
    res = ((got or {}).get("service_response") or {}) if isinstance(got, dict) else {}
    if res.get("ok") is not True:
        say("note: HA answered", s, str(got)[:400])
    check(s == 200 and res.get("ok") is True, "mantel.clean_areas with commands on: Mantel's Clean Areas answers ok")
    st = await until(lambda: _state_is(ha, VACUUM, ("cleaning",)))
    check(st is not None, f"...and the demo robot {VACUUM} is cleaning (vacuum.start through Mantel's gateway)")
    row = app["audit"].rows(action="vacuum.start")[0]
    check((row["actor"], row["decision"], row["result"]) == ("mantel:linked", "allowed", "ok"),
          "audited as mantel:linked, allowed, sent")
    out["clean"] = res


# ------------------------------------------------------------------------------------- phase: phones
async def run_phones(token: str) -> dict:
    out: dict = {}
    with tempfile.TemporaryDirectory(prefix="mantel-link-phones-") as folder:
        app, store, cfg = mantel_app(token, Path(folder))
        from mantel_server import features
        from mantel_server.settings_store import Actor
        app["settings"].store.write([("house", features.FEATURES_DOC, features.check_settings(
            {"linked": {"enabled": True}, "notifications": {"enabled": True}}))], actor=Actor(label="e2e"))
        hub = app["hub"]
        async with aiohttp.ClientSession() as http, TestServer(app, host="127.0.0.1") as server:
            ha = HA(http, token)
            base = str(server.make_url("")).rstrip("/")
            await asyncio.wait_for(hub.ha.ready.wait(), 60)
            owner = GE.Browser(base, "owner")
            try:
                st, body = await owner.post("/api/bootstrap", {
                    "token": app["accounts"].issue_bootstrap_token(), "username": "e2e-owner",
                    "name": "Fictional Owner", "password": secrets.token_urlsafe(18)})
                assert st == 200, body
                st, made = await owner.post("/api/linked/pair", {})
                done = await ha.add_mantel_link(base, code=made["code"])
                check(done.get("type") == "create_entry", "Mantel Link added with a pairing code")
                try:
                    await steps_phones(app, ha, owner, base, out)
                finally:
                    e = await ha.mantel_entry()
                    if e:
                        await ha.delete_entry(e["entry_id"])
            finally:
                await owner.http.close()
        store.db.close()
    return out


async def steps_phones(app, ha: HA, owner, base: str, out: dict) -> None:
    st, got = await owner.post("/api/phones", method="GET")
    phones = await until(lambda: _phones(owner), timeout=30)
    check(phones is not None and {"service": "mobile_app_e2e_phone", "name": "E2E Phone"} in phones,
          "Mantel Link reported the Companion-app phone (notify.mobile_app_e2e_phone), and nothing else")
    me = app["accounts"].db.execute("SELECT id FROM users WHERE username='e2e-owner'").fetchone()[0]
    st, body = await owner.post(f"/api/users/{me}/phones", {"services": ["mobile_app_e2e_phone"], "send": "all"},
                                method="PUT")
    check(st == 200, "an Owner picks the phone for a person (People, Phones), audited")
    owner.ws = await owner.http.ws_connect(base + "/ws")
    await owner.ws.send_json({"type": "read_subscribe", "id": 7, "msg": {"type": "hk_frontend/events/subscribe"}})
    while (await owner.recv()).get("id") != 7:
        pass
    async with ha.http.ws_connect(SCRATCH_URL.replace("http", "ws") + "/api/websocket") as ws:
        await ws.receive_json()
        await ws.send_json({"type": "auth", "access_token": ha.h["Authorization"].split(" ", 1)[1]})
        assert (await ws.receive_json())["type"] == "auth_ok"
        await ws.send_json({"id": 1, "type": "subscribe_events", "event_type": "mantel_e2e_phone_notified"})
        assert (await ws.receive_json())["success"]
        s, resp = await ha.post("/api/services/mantel/notify?return_response",
                                {"title": "Laundry", "message": "The washer is done."})
        check(s == 200, "mantel.notify called in HA")
        nid = ((resp or {}).get("service_response") or {}).get("id")
        ev = await _event(owner, "notification")
        check(ev is not None and ev["title"] == "Laundry", "the banner reaches a Mantel screen")
        got = None
        t0 = time.time()
        while time.time() - t0 < 15:
            m = await asyncio.wait_for(ws.receive_json(), 15)
            if m.get("type") == "event":
                got = m["event"]["data"]
                break
        check(got is not None and got["title"] == "Laundry" and got["message"] == "The washer is done.",
              "...and the phone gets it through Mantel Link (notify.mobile_app_e2e_phone)")
        acts = (got or {}).get("data", {}).get("actions") or []
        check(acts == [{"action": f"MANTEL_DISMISS_{nid}", "title": "Dismiss"}] and got["data"]["tag"] == f"mantel-{nid}",
              "with Mantel's Dismiss action and its tag")
        out["phone"] = got
    # the phone's Dismiss (the Companion app fires mobile_app_notification_action)
    s, _ = await ha.post("/api/events/mobile_app_notification_action", {"action": f"MANTEL_DISMISS_{nid}"})
    ev = await _event(owner, "notification_dismiss")
    check(ev is not None and ev.get("id") == nid, "a Dismiss on the phone reaches Mantel and takes the banner down")
    check(any(a["id"] == nid for a in app["phones"].actions), "Mantel noted it")
    s, _ = await ha.post("/api/events/mobile_app_notification_action", {"action": "SCRIPT_SOMETHING_ELSE"})
    await asyncio.sleep(1)
    check(len(app["phones"].actions) == 1, "another app's action is not Mantel's")
    check(app["audit"].rows(kind="service") == [], "no household service was called")
    await owner.ws.close()


async def _phones(owner):
    st, got = await owner.post("/api/phones", method="GET")
    return got.get("available") if st == 200 and got.get("available") else None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--keep-up", action="store_true", help="leave the scratch HA running afterwards")
    ap.add_argument("--reuse", action="store_true", help="use the scratch HA this caller already started; leave it up")
    ap.add_argument("--phase", choices=["alone", "handover", "house", "zeroconf", "phones", "actions", "docs", "livetv"],
                    default="alone",
                    help="alone: no HK Frontend (9.2); handover: HK Frontend linked, the bridge handed over and back (9.3)")
    a = ap.parse_args()
    if not a.reuse:
        GE.wait_for_free_harness()
        extra = {"alone": ("--no-hk",), "handover": (), "house": (), "zeroconf": ("--no-hk", "--zeroconf-probe"),
                 "phones": ("--no-hk", "--phone-probe"), "actions": ("--no-hk",),
                 "docs": ("--no-hk", "--supervisor-probe"), "livetv": ("--no-hk", "--stream")}[a.phase]
        if a.phase == "docs":
            # Mantel Link from the BUILT public repository (tools/publish/publish.py), as HACS would install it
            built = Path(testha.SCRATCH) / "mantel-link-repo"
            if built.exists():
                shutil.rmtree(built)
            subprocess.run([sys.executable, str(ROOT / "hosts/ha/custom_components/mantel/tools/publish/publish.py"),
                            str(built), "--no-tests"], check=True, stdout=subprocess.DEVNULL)
            os.environ["TESTHA_MANTEL_LINK_DIR"] = str(built / "custom_components/mantel")
        say(f"starting the scratch HA (testha.py up --fresh {' '.join(extra)}); this takes a few minutes")
        GE.harness("up", "--fresh", *extra)
    elif not testha.ready():
        raise SystemExit("--reuse: the scratch HA is not answering on 127.0.0.1:8124")
    try:
        token = asyncio.run(GE.token_for_scratch())
        evidence = asyncio.run({"alone": run_alone, "handover": run_handover, "house": run_house, "zeroconf": run_zeroconf,
                                "phones": run_phones, "actions": run_actions, "docs": run_docs,
                                "livetv": run_livetv}[a.phase](token))
        del token
        out = Path(testha.SCRATCH) / f"mantel_link_e2e_{a.phase}.json"
        out.write_text(json.dumps({"checks": RESULTS, **evidence}, indent=1, default=str))
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
