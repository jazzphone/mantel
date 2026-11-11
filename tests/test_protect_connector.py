"""The UniFi Protect connector (mantel_server/protect_connector.py; docs/phase13/CAMERAS-DIRECT.md phase 4 and phase 5's
talk wiring): Connect's checks and the pin, picking cameras into cameras_direct, the match with Home Assistant's
camera and Video From with its RBAC unchanged, the events into the notifications (once, never twice), Notify For and
Turn On in Protect, the doorbell's direct talk, and the API key never shown.

The console is test_protect_api's: a local HTTPS server with a certificate made in the test, serving the payloads
recorded from a real console (sanitized). go2rtc is test_cameras_direct's fake. Home Assistant is never reached."""
import asyncio
import json
import logging

import aiohttp
import pytest
from aiohttp import web

import gateway_fakes as GF
from mantel_server import features as F
from mantel_server.cameras import protect_connector as P
from mantel_server.identity.rbac import Grant
from mantel_server.settings_store import Actor
from test_cameras_direct import OFFER_SDP, rig  # noqa: F401 -- the fixture
from test_protect_api import KEY, Console, closed_port

FRONT = "65a1b2c3d4e5f60718000001"          # the doorbell (a speaker, package detection)
LOFT = "65a1b2c3d4e5f60718000002"
OFFICE = "65a1b2c3d4e5f60718000005"
PASSWORD = "Fictional-Local-Passw0rd"
PORCH = [{"effect": "allow", "actions": ["view", "control", "control.sensitive"], "resource_kind": "area",
          "resource": "porch"}]


class LiveConsole(Console):
    """The recorded console, whose events socket the test speaks into."""

    def __init__(self, tmp_path):
        super().__init__(tmp_path)
        self.live: list[web.WebSocketResponse] = []

    async def events(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.sockets += 1
        self.live.append(ws)
        async for _ in ws:
            pass
        return ws

    async def stop(self):
        for ws in list(self.live):
            await ws.close()
        await super().stop()

    async def push(self, etype, item):
        for ws in list(self.live):
            if not ws.closed:
                await ws.send_str(json.dumps({"type": etype, "item": {"modelKey": "event", **item}}))


@pytest.fixture
async def console(tmp_path):
    c = await LiveConsole(tmp_path).start()
    yield c
    await c.stop()


# Home Assistant's own unifiprotect device for the doorbell, as the house's registry has it (2026-11-02: the MAC as a
# `connections` pair, no identifiers), with the entities it makes
HA_DEVICE = {"id": "dev_front", "name": "Front Door", "area_id": "porch", "connections": [["mac", "02:00:c0:ff:ee:01"]],
             "identifiers": []}
HA_CAM = "camera.front_door_high_resolution_channel"
HA_ENTITIES = [
    {"entity_id": HA_CAM, "device_id": "dev_front", "platform": "unifiprotect"},
    {"entity_id": "camera.front_door_low_resolution_channel", "device_id": "dev_front", "platform": "unifiprotect"},
    {"entity_id": "binary_sensor.front_door_person_detected", "device_id": "dev_front", "platform": "unifiprotect"},
    {"entity_id": "binary_sensor.front_door_motion", "device_id": "dev_front", "platform": "unifiprotect"},
    {"entity_id": "event.front_door_doorbell", "device_id": "dev_front", "platform": "unifiprotect"},
    {"entity_id": "media_player.front_door_speaker", "device_id": "dev_front", "platform": "unifiprotect"},
]
HA_STATES = {
    HA_CAM: {"s": "recording", "a": {"friendly_name": "Front Door High"}, "lc": 1.0, "lu": 1.0},
    "camera.front_door_low_resolution_channel": {"s": "recording", "a": {"friendly_name": "Front Door Low"}, "lc": 1.0, "lu": 1.0},
    "binary_sensor.front_door_person_detected": {"s": "off", "a": {"friendly_name": "Front Door Person detected"}, "lc": 1.0, "lu": 1.0},
    "binary_sensor.front_door_motion": {"s": "off", "a": {"friendly_name": "Front Door Motion", "device_class": "motion"}, "lc": 1.0, "lu": 1.0},
    "event.front_door_doorbell": {"s": "2026-11-01T10:00:00.000+00:00", "a": {"friendly_name": "Front Door Doorbell",
                                                                             "device_class": "doorbell", "event_type": "ring"}, "lc": 1.0, "lu": 1.0},
    "media_player.front_door_speaker": {"s": "idle", "a": {"friendly_name": "Front Door Speaker"}, "lc": 1.0, "lu": 1.0},
}


def ha_has_the_doorbell(r):
    hub = r.app["hub"]
    hub.store.apply_event({"a": {k: dict(v) for k, v in HA_STATES.items()}})
    hub.registry.load(GF.HOUSE_AREAS, [HA_DEVICE], GF.HOUSE_ENTITIES + HA_ENTITIES)
    hub.ha.on_registry()


async def until(cond, what, n=200):
    for _ in range(n):
        if cond():
            return
        await asyncio.sleep(0.02)
    raise AssertionError(what)


async def connected(r, console, *, role="owner", user="owner1"):
    await r.env.login(user, role)
    resp = await r.env.m.post("/api/protect", {"host": console.host, "api_key": KEY})
    assert resp.status == 200, await resp.text()
    conn = r.app["protect"]
    await until(lambda: conn.connected and conn.cameras, "connected, the list read")
    return conn


async def pick(r, pid, **extra):
    resp = await r.env.m.client.put(f"/api/protect/cameras/{pid}", json={"use": True, **extra},
                                    headers=r.env.m.headers())
    assert resp.status == 200, await resp.text()
    return (await resp.json())["camera"]


async def put(r, pid, **body):
    return await r.env.m.client.put(f"/api/protect/cameras/{pid}", json=body, headers=r.env.m.headers())


def notifications(r, items):
    """Notifications on, with these items; what reaches the screens is collected."""
    app = r.app
    app["settings"].store.write([("house", F.FEATURES_DOC, F.check_settings(
        {"notifications": {"enabled": True, "items": items}}))], actor=Actor(label="test"))
    host = app["features"]
    sent = []
    host.feed.send = lambda payload: sent.append(payload) or []
    return host, sent


def no_key(text):
    for s in (KEY, PASSWORD):
        assert s not in text, s


# ------------------------------------------------------------------------------------- where it runs
async def test_under_the_ha_app_only_the_status_says_so(rig):
    r = await rig(go2rtc=False)
    await r.env.login("owner1", "owner")
    body = await (await r.env.m.get("/api/protect")).json()
    assert body["protect"] == {"runs": False}
    assert "protect" not in r.app and "direct_talk" not in r.app
    assert (await r.env.m.post("/api/protect", {"host": "unifi.local", "api_key": KEY})).status in (404, 405)


# ------------------------------------------------------------------------------------- Connect and the pin
async def test_connect_runs_the_checks_in_order_and_pins_the_certificate(rig, console, caplog):
    caplog.set_level(logging.DEBUG)
    r = await rig()
    m = r.env.m
    await r.env.login("owner1", "owner")

    async def save(**body):
        resp = await m.post("/api/protect", {"host": console.host, "api_key": KEY, **body})
        return resp.status, await resp.json()

    status, got = await save(host=f"127.0.0.1:{closed_port()}")
    assert (status, got["error"]) == (422, "unreachable")
    status, got = await save(api_key="not-the-key")
    assert (status, got["error"]) == (422, "key_refused")
    assert not any(h["key_sent"] and h["path"] == "/v1/meta/info" and h["query"] == {} for h in console.hits[:1]), \
        "the first question goes without the key"
    console.version = "7.1.9"
    status, got = await save()
    assert (status, got["error"]) == (422, "protect_too_old") and "7.2.105" in got["message"]
    console.version = "7.3.70"
    status, got = await save(host="http://" + console.host)
    assert status == 422 and got["error"] == "not_a_console"
    status, got = await save(username="someone@example.com", password=PASSWORD)
    assert status == 422 and got["error"] == "local_user_only"
    assert r.app["protect"].record is None, "nothing kept from a failed Connect"
    status, got = await save(username="mantel", password=PASSWORD)
    assert status == 200, got
    p = got["protect"]
    assert p["saved"]["fingerprint"] == console.fingerprint and p["saved"]["version"] == "7.3.70"
    assert p["saved"]["signin"] == "api_key_and_local_user" and p["saved"]["local_user"] == "mantel"
    # sealed: neither the key nor the password is in the file
    raw = (r.app["cfg"].connections_dir / "protect.connection").read_bytes()
    assert KEY.encode() not in raw and PASSWORD.encode() not in raw
    conn = r.app["protect"]
    await until(lambda: conn.connected and conn.cameras, "the events socket is up, the list read")
    st = await (await m.get("/api/protect")).json()
    assert st["protect"]["events"]["connected"] is True and st["protect"]["cameras"] == 14
    rows = r.env.audit(kind="config")
    assert any(x["action"] == "connection.protect.saved" for x in rows)
    no_key(json.dumps(st) + json.dumps(rows) + caplog.text + repr(conn.record) + repr(conn.client))
    # an Admin reads the status, never changes it
    await r.env.login("admin1", "admin")
    assert (await m.get("/api/protect")).status == 200
    assert (await m.post("/api/protect", {"host": console.host, "api_key": KEY})).status == 403
    assert (await m.client.delete("/api/protect", headers=m.headers())).status == 403


async def test_a_changed_certificate_stops_it_and_an_owner_trusts_the_new_one(rig, console):
    r = await rig()
    conn = await connected(r, console)
    old = console.fingerprint
    await console.rotate_cert()
    m = r.env.m
    resp = await m.post("/api/protect/test", {"host": console.host, "api_key": KEY})
    got = await resp.json()
    assert resp.status == 422 and got["error"] == "certificate_changed"
    assert got["fingerprint"] == console.fingerprint and got["pinned"] == old
    # the events socket refuses it too, and says so (the client's pooled connections, made under the old
    # certificate, are dropped first: a real console's restart drops them itself)
    await conn.client._http().close()
    for ws in console.live:
        await ws.close()
    await until(lambda: conn.error_kind == "certificate_changed", "the socket stopped on the new certificate", n=600)
    assert (await (await m.get("/api/protect")).json())["protect"]["seen_fingerprint"] == console.fingerprint
    # only the one the console presents now
    resp = await m.post("/api/protect/trust", {"fingerprint": old})
    assert resp.status == 409 and (await resp.json())["fingerprint"] == console.fingerprint
    pretty = ":".join(console.fingerprint[i:i + 2].upper() for i in range(0, 64, 2))
    resp = await m.post("/api/protect/trust", {"fingerprint": pretty})
    assert resp.status == 200, await resp.text()
    assert conn.record.pin == console.fingerprint
    row = [x for x in r.env.audit(kind="config") if x["action"] == "connection.protect.certificate_trusted"]
    assert len(row) == 1 and old in json.dumps(row[0]) and console.fingerprint in json.dumps(row[0])
    await until(lambda: conn.connected, "connected again")


# ------------------------------------------------------------------------------------- discovery
async def test_picking_a_camera_puts_it_and_the_console_is_followed(rig, console):
    r = await rig()
    conn = await connected(r, console)
    m = r.env.m
    got = await (await m.get("/api/protect/cameras")).json()
    assert len(got["cameras"]) == 14 and ["porch", "Porch"] in got["areas"]
    front = next(c for c in got["cameras"] if c["id"] == FRONT)
    assert front["doorbell"] and front["speaker"] and front["kinds"] == ["ring", "person", "vehicle", "animal", "package"]
    still = await m.get(f"/api/protect/cameras/{FRONT}/still")
    assert still.status == 200 and (await still.read()).startswith(b"\xff\xd8")
    row = await pick(r, FRONT, area_id="porch")
    assert row["entity_id"] == "camera.mantel_front_door" and row["slug"] == "front_door" and row["matched"] is None
    src = r.cams.source("camera.mantel_front_door")
    assert (src.area_id, src.protect_id, src.speaker) == ("porch", FRONT, True)
    assert set(src.detections) == {"ring", "person", "vehicle", "animal", "package", "motion"}
    assert ("POST", f"/v1/cameras/{FRONT}/rtsps-stream") in [(h["method"], h["path"]) for h in console.hits]
    assert r.cams.secret("front_door").high.startswith("rtspx://")
    assert r.app["hub"].store.states["binary_sensor.mantel_front_door_person_detected"]["s"] == "off"
    assert r.app["hub"].registry.entries["binary_sensor.mantel_front_door_person_detected"]["device_id"] == "mantel_cam_front_door"
    # renamed in Protect, a stream token that changed: the refresh follows, reading only
    for cam in console.cameras:
        if cam["id"] == FRONT:
            cam["name"] = "Front Porch"
    console.streams[FRONT]["high"] = "rtsps://192.0.2.20:7441/FictionalNewToken?enableSrtp"
    writes = len(console.writes())
    await conn.refresh()
    assert r.cams.source("camera.mantel_front_door").name == "Front Porch"
    assert r.cams.secret("front_door").high == "rtspx://192.0.2.20:7441/FictionalNewToken"
    assert len(console.writes()) == writes, "the refresh only reads"
    # gone from the console: removed
    console.cameras = [c for c in console.cameras if c["id"] != FRONT]
    await conn.refresh()
    assert r.cams.sources() == [] and "binary_sensor.mantel_front_door_person_detected" not in r.app["hub"].store.states
    # un-picking
    await pick(r, LOFT)
    assert (await put(r, LOFT, use=False)).status == 200
    assert r.cams.sources() == []
    assert [x["action"] for x in r.env.audit(kind="config")].count("protect.camera.set") == 3


async def test_a_stream_go2rtc_cannot_play_has_its_token_asked_again(rig, console):
    r = await rig()
    conn = await connected(r, console)
    await pick(r, LOFT)
    console.streams[LOFT]["high"] = "rtsps://192.0.2.20:7441/FictionalFreshToken?enableSrtp"
    conn.on_stream_failed(r.cams.source("camera.mantel_loft"))
    await until(lambda: r.cams.secret("loft").high.endswith("FictionalFreshToken"), "the new token")
    conn.on_stream_failed(r.cams.source("camera.mantel_loft"))
    assert len(conn._token_asked) == 1, "at most once a minute"


# ------------------------------------------------------------------------------------- the same camera twice
async def test_a_camera_home_assistant_has_shows_once_and_plays_direct_with_its_own_rbac(rig, console):
    r = await rig()
    ha_has_the_doorbell(r)
    conn = await connected(r, console)
    row = await pick(r, FRONT)
    assert row["matched"] == HA_CAM and row["entity_id"] == HA_CAM and row["video_from"] == "direct"
    states = r.app["hub"].store.states
    assert "camera.mantel_front_door" not in states and not any(e.startswith("binary_sensor.mantel_") for e in states)
    assert r.cams.serves(HA_CAM) is not None and r.cams.status()["cameras"][0]["state"] == "matched"
    authz = r.app["authz"]
    m = r.env.m
    # the Owner: the still is Protect's own snapshot, under Home Assistant's entity id
    snaps = sum(1 for h in console.hits if h["path"].endswith("/snapshot"))
    resp = await m.get(f"/api/camera/{HA_CAM}/still")
    assert resp.status == 200 and (await resp.read()).endswith(b"lq")
    assert sum(1 for h in console.hits if h["path"].endswith("/snapshot")) == snaps + 1
    resp = await m.get(f"/api/camera/{HA_CAM}/still?width=1600&height=1200")
    assert (await resp.read()).endswith(b"hq"), "a large still asks for Protect's full-resolution one"
    # an Adult with only the porch: exactly what Home Assistant's camera gets, video and still
    r.app["rbac"].set_override("adult", {"grants": [
        {"effect": "allow", "actions": ["view", "control", "control.sensitive"], "resource_kind": "area",
         "resource": "kitchen"}]})
    await r.env.login("adult1", "adult")
    ws = await r.env.socket(expect_caps=False)
    p = next(e.principal for e in r.app["live"]._entries if not e.closed)
    assert authz.may_view(p, HA_CAM) is False
    assert (await m.get(f"/api/camera/{HA_CAM}/still")).status == 403
    calls = list(r.go2rtc.calls)
    got = await r.ask(ws, 1, {"type": "camera/webrtc/offer", "entity_id": HA_CAM, "offer": OFFER_SDP},
                      kind="read_subscribe")
    assert got["error"]["code"] == "forbidden" and r.go2rtc.calls == calls, "nothing reached go2rtc"
    await ws.close()
    r.app["rbac"].set_override("adult", {"grants": [
        {"effect": "allow", "actions": ["view", "control", "control.sensitive"], "resource_kind": "area",
         "resource": "porch"}]})
    await r.env.login("adult1", "adult")
    ws = await r.env.socket(expect_caps=False)
    p = next(e.principal for e in r.app["live"]._entries if not e.closed)
    assert authz.may_view(p, HA_CAM) is True
    assert (await m.get(f"/api/camera/{HA_CAM}/still")).status == 200
    await r.offer(ws, 2, eid=HA_CAM)
    assert any(c[1] == "mantel_cam_front_door_high" for c in r.go2rtc.calls if isinstance(c, tuple)), r.go2rtc.calls
    # a deny on Home Assistant's entity wins, as ever, and ends the session at the tick
    r.app["rbac"].add_grant(Grant(effect="deny", actions=("view",), resource_kind="entity", resource=HA_CAM,
                                  roles={"adult"}))
    assert authz.may_view(p, HA_CAM) is False and (await m.get(f"/api/camera/{HA_CAM}/still")).status == 403
    await r.app["live"].check(why="policy_tick")
    await until(lambda: r.cams.sessions == {}, "the denied session ended")
    await ws.close()
    # a Child: refused, as for every camera
    await r.env.login("kid1", "child")
    assert (await m.get(f"/api/camera/{HA_CAM}/still")).status == 403
    # Video From Home Assistant: back on Home Assistant's path; Protect is not asked
    await r.env.login("owner1", "owner")
    assert (await put(r, FRONT, video_from="ha")).status == 200
    assert r.cams.serves(HA_CAM) is None and "camera.mantel_front_door" not in states
    snaps = sum(1 for h in console.hits if h["path"].endswith("/snapshot"))
    await m.get(f"/api/camera/{HA_CAM}/still?width=320&height=240")
    assert sum(1 for h in console.hits if h["path"].endswith("/snapshot")) == snaps
    assert conn.video_from(FRONT) == "ha"


async def test_every_channel_of_a_matched_camera_plays_direct(rig, console):  # noqa: F811 -- the fixture
    """The tiles name Home Assistant's low-resolution channel (the house, 2026-11-07): with only the best channel
    aliased, they stayed on Home Assistant's video and went black at every Home Assistant restart."""
    r = await rig()
    ha_has_the_doorbell(r)
    await connected(r, console)
    await pick(r, FRONT)
    low = "camera.front_door_low_resolution_channel"
    assert r.cams.serves(HA_CAM) is not None and r.cams.serves(low) is not None
    assert r.cams.status()["cameras"][0]["matched"] == HA_CAM, "still shown once, as the best channel"
    snaps = sum(1 for h in console.hits if h["path"].endswith("/snapshot"))
    resp = await r.env.m.get(f"/api/camera/{low}/still")
    assert resp.status == 200 and sum(1 for h in console.hits if h["path"].endswith("/snapshot")) == snaps + 1
    ws = await r.env.socket(expect_caps=False)
    await r.offer(ws, 1, eid=low)
    assert any(c[1].startswith("mantel_cam_front_door_") for c in r.go2rtc.calls if isinstance(c, tuple)), r.go2rtc.calls
    await ws.close()
    assert (await put(r, FRONT, video_from="ha")).status == 200
    assert r.cams.serves(low) is None and r.cams.serves(HA_CAM) is None


async def test_rbac_of_a_matched_camera_is_identical_with_video_direct_or_not(rig, console):
    """may_view / may_still of Home Assistant's camera do not move when its video comes direct: the same answers
    for each subject, before and after, area grant, deny, Child and the tunnel's switch alike."""
    r = await rig()
    ha_has_the_doorbell(r)
    authz = r.app["authz"]
    r.app["rbac"].set_override("adult", {"grants": PORCH})
    principals = {}
    for user, role in (("owner1", "owner"), ("adult1", "adult"), ("kid1", "child"), ("guest1", "guest")):
        await r.env.login(user, role)
        ws = await r.env.socket(expect_caps=False)
        principals[role] = (next(e.principal for e in r.app["live"]._entries if not e.closed and e.principal.user
                                 and e.principal.user.role == role), ws)

    # and an Adult from outside (the tunnel), whose cameras an Owner may switch off
    from mantel_server.identity.accounts import totp
    m = r.env.m
    await r.env.login("adult2", "adult")
    seed = await r.env.enroll_totp()
    m.forget_cookies()
    r.env.now[0] += 60
    _, body = await m.sign_in("adult2", tunnel=True)
    resp = await m.post("/api/auth/totp/verify", {"pending": body["pending"], "code": totp(seed, r.env.now[0])},
                        csrf=False, tunnel=True)
    assert resp.status == 200
    ws = await r.env.socket(expect_caps=False, tunnel=True)
    principals["tunnel"] = (next(e.principal for e in r.app["live"]._entries if not e.closed and e.principal.door == "tunnel"), ws)

    def answers():
        return {role: (authz.may_view(p, HA_CAM), authz.may_still(p, HA_CAM)) for role, (p, _) in principals.items()}
    before = answers()
    assert before["owner"] == (True, True) and before["adult"] == (True, True)
    assert before["child"] == (False, False) and before["guest"] == (False, False)
    assert before["tunnel"] == (True, True)
    r.app["rbac"].set_override("adult", {"grants": PORCH, "tunnel_cameras": False})
    off = answers()
    assert off["tunnel"] == (False, False) and off["adult"] == (True, True)
    await connected(r, console)
    await pick(r, FRONT)
    assert r.cams.serves(HA_CAM) is not None
    assert answers() == off, "the tunnel's camera switch decides it as before"
    r.app["rbac"].set_override("adult", {"grants": PORCH})
    assert answers() == before
    r.app["rbac"].add_grant(Grant(effect="deny", actions=("view",), resource_kind="entity", resource=HA_CAM,
                                  roles={"adult"}))
    assert answers()["adult"] == (False, False)
    for _, ws in principals.values():
        await ws.close()


# ------------------------------------------------------------------------------------- events
async def test_a_ring_at_a_matched_doorbell_notifies_once_whichever_source(rig, console):
    r = await rig()
    ha_has_the_doorbell(r)
    conn = await connected(r, console)
    await pick(r, FRONT)
    host, sent = notifications(r, [
        {"id": "n_bell", "entity": "event.front_door_doorbell", "when": "any", "pop": "doorbell", "title": "", "message": ""},
        {"id": "n_person", "entity": "binary_sensor.front_door_person_detected", "when": "on", "title": "", "message": ""},
        {"id": "n_motion", "entity": "binary_sensor.front_door_motion", "when": "on", "title": "", "message": ""}])
    await host.reload()
    await console.push("add", {"id": "ev1", "type": "ring", "start": 1793623188000, "end": 1793623198000, "device": FRONT})
    await until(lambda: len(sent) == 1, "the ring notified")
    assert sent[0]["entity"] == "event.front_door_doorbell" and sent[0]["pop"] == "doorbell"
    # Home Assistant's own entity changes a moment later: held back, never a second notification
    hub = r.app["hub"]
    hub.ha.on_change(hub.store.apply_event({"c": {"event.front_door_doorbell": {"+": {"s": "2026-11-02T12:56:35.919+00:00", "lc": 2.0}}}}))
    await asyncio.sleep(0.1)
    assert len(sent) == 1
    # a person: on, and nothing from HA's copy of it
    await console.push("add", {"id": "ev2", "type": "smartDetectZone", "smartDetectTypes": ["person"], "start": 1793623200000,
                               "device": FRONT})
    await until(lambda: len(sent) == 2, "the person notified")
    assert sent[1]["entity"] == "binary_sensor.front_door_person_detected"
    hub.ha.on_change(hub.store.apply_event({"c": {"binary_sensor.front_door_person_detected": {"+": {"s": "on", "lc": 3.0}}}}))
    await asyncio.sleep(0.1)
    assert len(sent) == 2
    # Video From Home Assistant: HA's entities speak, the direct events do not
    assert (await put(r, FRONT, video_from="ha")).status == 200
    await console.push("add", {"id": "ev3", "type": "ring", "start": 1793623300000, "end": 1793623310000, "device": FRONT})
    await asyncio.sleep(0.2)
    assert len(sent) == 2
    hub.ha.on_change(hub.store.apply_event({"c": {"event.front_door_doorbell": {"+": {"s": "2026-11-02T13:00:00.000+00:00", "lc": 4.0}}}}))
    await until(lambda: len(sent) == 3, "HA's ring notified")
    # Direct again but the events socket down: HA's speak
    assert (await put(r, FRONT, video_from="direct")).status == 200
    conn.stream.connected = False
    hub.ha.on_change(hub.store.apply_event({"c": {"event.front_door_doorbell": {"+": {"s": "2026-11-02T13:01:00.000+00:00", "lc": 5.0}}}}))
    await until(lambda: len(sent) == 4, "HA's ring notified while the socket is down")
    # the motion of a camera with smart detection isn't one Notify For offers: Home Assistant's own sensor of it
    # notifies as it always did, socket up or not, and the console's motion events add nothing
    conn.stream.connected = True
    await console.push("add", {"id": "ev4", "type": "motion", "start": 1793623400000, "device": FRONT})
    await asyncio.sleep(0.2)
    assert len(sent) == 4
    hub.ha.on_change(hub.store.apply_event({"c": {"binary_sensor.front_door_motion": {"+": {"s": "on", "lc": 6.0}}}}))
    await until(lambda: len(sent) == 5 and sent[-1]["entity"] == "binary_sensor.front_door_motion", "HA's motion notified")


async def test_an_unmatched_doorbell_pops_up_and_its_detections_are_sensors(rig, console):
    r = await rig()
    await connected(r, console)
    await pick(r, FRONT, area_id="porch")
    await pick(r, LOFT, area_id="kitchen")
    host, sent = notifications(r, [
        {"id": "n_bells", "category": "doorbells", "when": "on", "pop": "doorbell", "snap": True, "tap": "camera",
         "title": "", "message": ""},
        {"id": "n_loft", "entity": "binary_sensor.mantel_loft_person_detected", "when": "on", "title": "", "message": ""}])
    await host.reload()
    assert "event.mantel_front_door_doorbell" in host.notifier.watched["n_bells"]
    await console.push("add", {"id": "ev1", "type": "ring", "start": 1793623188000, "end": 1793623198000, "device": FRONT})
    await until(lambda: len(sent) == 1, "the ring notified")
    bell = sent[0]
    assert bell["pop"] == "doorbell" and bell["sheet"] == "camera.mantel_front_door" and bell["camera"] == "camera.mantel_front_door"
    assert bell["snap"], "the snapshot came from the direct camera"
    states = r.app["hub"].store.states
    await console.push("add", {"id": "ev2", "type": "smartDetectZone", "smartDetectTypes": ["person"], "start": 1793623200000,
                               "device": LOFT})
    await until(lambda: states["binary_sensor.mantel_loft_person_detected"]["s"] == "on", "on")
    await until(lambda: len(sent) == 2, "the Loft's person notified")
    await console.push("update", {"id": "ev2", "type": "smartDetectZone", "smartDetectTypes": ["person"],
                                  "start": 1793623200000, "end": 1793623205000, "device": LOFT})
    await until(lambda: states["binary_sensor.mantel_loft_person_detected"]["s"] == "off", "off at its end")
    # the same update again is nothing
    await console.push("update", {"id": "ev2", "type": "smartDetectZone", "smartDetectTypes": ["person"],
                                  "start": 1793623200000, "end": 1793623205000, "device": LOFT})
    await asyncio.sleep(0.1)
    assert len(sent) == 2
    # a motion sensor in the camera's room (Live Camera Follows' motion)
    assert r.app["hub"].registry.entity_area["binary_sensor.mantel_loft_motion"] == "kitchen"


# ------------------------------------------------------------------------------------- Notify For, Turn On
async def test_notify_for_picks_the_kinds_and_turn_on_sets_only_that_camera(rig, console):
    for cam in console.cameras:
        if cam["id"] == OFFICE:
            cam["smartDetectSettings"]["objectTypes"] = ["person"]
    r = await rig()
    conn = await connected(r, console)
    row = await pick(r, OFFICE)
    assert row["kinds"] == ["person", "vehicle", "animal"] and row["kinds_on"] == ["person"]
    assert row["off_in_protect"] == ["vehicle", "animal"] and row["notify"] == ["person", "vehicle", "animal"]
    resp = await put(r, OFFICE, notify=["vehicle"])
    assert resp.status == 200 and (await resp.json())["camera"]["notify"] == ["vehicle"]
    assert (await put(r, OFFICE, notify=["ring"])).status == 400, "not a kind this camera has"
    host, sent = notifications(r, [
        {"id": "n_p", "entity": "binary_sensor.mantel_office_person_detected", "when": "on", "title": "", "message": ""},
        {"id": "n_v", "entity": "binary_sensor.mantel_office_vehicle_detected", "when": "on", "title": "", "message": ""}])
    await host.reload()
    await console.push("add", {"id": "e1", "type": "smartDetectZone", "smartDetectTypes": ["person", "vehicle"],
                               "start": 1793623200000, "device": OFFICE})
    await until(lambda: len(sent) == 1, "one notification")
    await asyncio.sleep(0.1)
    assert [s["entity"] for s in sent] == ["binary_sensor.mantel_office_vehicle_detected"], "the person is left out"
    # Turn On in Protect: that camera's own setting, merged with what is on; nothing else touched
    before = [h for h in console.writes() if h["method"] == "PATCH"]
    resp = await r.env.m.post(f"/api/protect/cameras/{OFFICE}/turn-on", {"types": ["animal"]})
    assert resp.status == 200, await resp.text()
    patches = [h for h in console.writes() if h["method"] == "PATCH"]
    assert len(patches) == len(before) + 1
    assert patches[-1]["path"] == f"/v1/cameras/{OFFICE}"
    assert patches[-1]["body"] == {"smartDetectSettings": {"objectTypes": ["person", "animal"]}}
    assert (await resp.json())["camera"]["off_in_protect"] == ["vehicle"]
    assert any(x["action"] == "protect.camera.smart_types_on" for x in r.env.audit(kind="config"))
    assert (await r.env.m.post(f"/api/protect/cameras/{OFFICE}/turn-on", {"types": ["face"]})).status == 400
    # an Adult may not
    await r.env.login("adult1", "adult")
    assert (await r.env.m.post(f"/api/protect/cameras/{OFFICE}/turn-on", {"types": ["vehicle"]})).status == 403
    assert conn.cameras[OFFICE].smart_on == ("person", "animal")


async def test_a_motion_only_camera_offers_motion(rig, console):
    for cam in console.cameras:
        if cam["id"] == LOFT:
            cam["featureFlags"]["smartDetectTypes"] = []
            cam["smartDetectSettings"]["objectTypes"] = []
    r = await rig()
    await connected(r, console)
    row = await pick(r, LOFT)
    assert row["motion_only"] and row["kinds"] == ["motion"] and row["notify"] == ["motion"]
    assert "binary_sensor.mantel_loft_motion" in r.app["hub"].store.states
    assert "binary_sensor.mantel_loft_person_detected" not in r.app["hub"].store.states


# ------------------------------------------------------------------------------------- direct talk
async def test_the_doorbells_speaker_is_talked_to_directly(rig, console):
    from mantel_server.identity.authz import talk_grants
    r = await rig()
    conn = await connected(r, console)
    await pick(r, FRONT)
    talk = r.app["direct_talk"]
    mine = "media_player.mantel_front_door_speaker"
    assert talk.handles(mine) and list(talk.speakers) == [mine]
    assert r.app["hub"].registry.entries[mine]["device_id"] == "mantel_cam_front_door"
    target = await talk.target(mine)
    assert (target.codec, target.rate) == ("opus", 24000) and target.url.startswith("rtp://")
    # HK's doorbell pop-up names it like any speaker, and camera.talk's grants come from the pop-up as before
    r.app["settings"].store.write([("house", "popups", {"items": [
        {"name": "Doorbell", "kind": "camera", "entity": "camera.mantel_front_door", "speaker": mine}]})],
        actor=Actor(label="test"))
    authz = r.app["authz"]
    assert authz.talk_speakers() == {mine}
    from mantel_server.identity.rbac import Subject
    sub = Subject(device_role="wall_tablet", device_id="t1")
    pol = authz.talk_policy(sub)
    assert set(talk_grants([mine])) <= set(pol.grants)
    # matched with Home Assistant's device: HA's own speaker entity is the one
    ha_has_the_doorbell(r)
    await conn.refresh()
    assert list(talk.speakers) == ["media_player.front_door_speaker"] and mine not in r.app["hub"].store.states
    # disconnected: no speakers, no cameras
    resp = await r.env.m.client.delete("/api/protect", headers=r.env.m.headers())
    assert resp.status == 200
    assert talk.speakers == {} and r.cams.sources() == []
    assert not (r.app["cfg"].connections_dir / "protect.connection").exists()


# ------------------------------------------------------------------------------------- the key stays in
async def test_the_key_never_leaves(rig, console, caplog):
    caplog.set_level(logging.DEBUG)
    r = await rig()
    await r.env.login("owner1", "owner")
    resp = await r.env.m.post("/api/protect", {"host": console.host, "api_key": KEY, "username": "mantel",
                                               "password": PASSWORD})
    assert resp.status == 200
    conn = r.app["protect"]
    await until(lambda: conn.connected and conn.cameras, "connected")
    await pick(r, FRONT)
    texts = [await resp.text()]
    for path in ("/api/protect", "/api/protect/cameras", "/api/cameras/direct"):
        texts.append(await (await r.env.m.get(path)).text())
    texts.append(json.dumps(r.env.audit()))
    texts.append(json.dumps(r.app["settings"].store.body("house", P.DOC)))
    texts.append(json.dumps(r.app["settings"].store.body("house", "cameras_direct")))
    texts.append(caplog.text)
    texts.append(repr(conn.record) + repr(conn.client) + repr(conn.stream))
    no_key("\n".join(texts))
    assert "FictionalHighToken" not in "\n".join(texts[:4])


async def test_a_camera_whose_ha_camera_is_off_notifies_once_from_mantels_own_sensor(rig, console):
    """The house's indoor cameras (2026-11-02): Home Assistant has their device, its camera entities turned off and
    its detection sensors on. Picked in Mantel the camera is Mantel's own; Home Assistant's person sensor must not
    notify the same person a second time while Mantel's events socket is up, and must when it is down."""
    r = await rig()
    hub = r.app["hub"]
    loft_dev = {"id": "dev_loft", "name": "Loft", "area_id": "kitchen", "connections": [["mac", "02:00:c0:ff:ee:02"]],
                "identifiers": []}
    hub.store.apply_event({"a": {"binary_sensor.loft_person_detected": {
        "s": "off", "a": {"friendly_name": "Loft Person detected"}, "lc": 1.0, "lu": 1.0}}})
    hub.registry.load(GF.HOUSE_AREAS, [loft_dev], GF.HOUSE_ENTITIES + [
        {"entity_id": "camera.loft_high_resolution_channel", "device_id": "dev_loft", "platform": "unifiprotect",
         "disabled_by": "user"},
        {"entity_id": "binary_sensor.loft_person_detected", "device_id": "dev_loft", "platform": "unifiprotect"}])
    hub.ha.on_registry()
    conn = await connected(r, console)
    await pick(r, LOFT, area_id="kitchen")
    assert LOFT not in conn.matches, "no camera of Home Assistant's to show it as"
    host, sent = notifications(r, [
        {"id": "n_mine", "entity": "binary_sensor.mantel_loft_person_detected", "when": "on", "title": "", "message": ""},
        {"id": "n_ha", "entity": "binary_sensor.loft_person_detected", "when": "on", "title": "", "message": ""}])
    await host.reload()
    await console.push("add", {"id": "ev1", "type": "smartDetectZone", "smartDetectTypes": ["person"],
                               "start": 1793623200000, "device": LOFT})
    await until(lambda: len(sent) == 1, "Mantel's sensor notified")
    hub.ha.on_change(hub.store.apply_event({"c": {"binary_sensor.loft_person_detected": {"+": {"s": "on", "lc": 2.0}}}}))
    await asyncio.sleep(0.1)
    assert len(sent) == 1 and sent[0]["entity"] == "binary_sensor.mantel_loft_person_detected"
    conn.stream.connected = False
    hub.ha.on_change(hub.store.apply_event({"c": {"binary_sensor.loft_person_detected": {"+": {"s": "off", "lc": 3.0}}}}))
    hub.ha.on_change(hub.store.apply_event({"c": {"binary_sensor.loft_person_detected": {"+": {"s": "on", "lc": 4.0}}}}))
    await until(lambda: len(sent) == 2 and sent[-1]["entity"] == "binary_sensor.loft_person_detected",
                "Home Assistant's notified while the socket is down")
