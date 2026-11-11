"""RTSP cameras: Add Camera, Test, change, remove, linked sensors (mantel_server/camera_setup.py;
docs/phase13/CAMERAS-DIRECT.md phase 6). Against the fake go2rtc of the other camera tests (tests/live_tv_fakes.py,
which answers as the real go2rtc 1.9.9 was seen to: a probe that says why a stream failed, a frame of nothing when it
did), a fictional house and fictional secrets; house commands stay off throughout.

The thread through every test: the user name, the password and the address's path never reach a response, a log line,
an audit row, the settings document or an exception -- only the sealed file holds the login."""
from __future__ import annotations

import asyncio
import base64
import json
import logging

import pytest
from aiohttp import web

import gateway_fakes as GF
from hk_core.notifications import accessories as NA, banner as NB, rules as NR, settings as NS
from live_tv_fakes import FRAME
from mantel_server.cameras import camera_setup as CS
from mantel_server.cameras import cameras_direct as D
from mantel_server import features as F
from mantel_server.identity.rbac import Grant
from mantel_server.settings_store import Actor
from test_cameras_direct import PROTECT_HIGH, PROTECT_LOW, rig  # noqa: F401 -- the fixture and the Protect fixture

USER = "viewer"
PASSWORD = "Fictional-P@ss/w0rd"
ENCODED = "Fictional-P%40ss%2Fw0rd"              # as the sealed URL holds it
PATH_TOKEN = "FictionalPathToken9"
HOST = "192.0.2.31"
ADDRESS = f"rtsp://{HOST}:554/stream1?token={PATH_TOKEN}"
LOW = f"rtsp://{HOST}:554/stream2?token={PATH_TOKEN}"
SECRETS = (PASSWORD, ENCODED, USER, PATH_TOKEN)
API = "/api/cameras/rtsp"
NONE = {"motion": None, "person": None, "doorbell": None}       # every link cleared (a role left out keeps its own)

# the house's sensors (Frigate's, a doorbell event, a plain ring sensor) beside test_cameras_direct's cameras
SENSORS = {
    "binary_sensor.driveway_person_occupancy": ("Driveway Person Occupancy", {"device_class": "occupancy"}, "off"),
    "binary_sensor.driveway_motion": ("Driveway Motion", {"device_class": "motion"}, "off"),
    "event.driveway_doorbell": ("Driveway Doorbell", {"device_class": "doorbell"}, "2026-11-02T10:00:00+00:00"),
    "binary_sensor.porch_ring": ("Porch Ring", {}, "off"),
    "binary_sensor.hall_person_detected": ("Hall Person detected", {}, "off"),
    "binary_sensor.secret_closet": ("Secret Closet", {"device_class": "motion"}, "off"),
}


@pytest.fixture
def ha_there(monkeypatch):
    """Home Assistant set up and connected, as far as the page asks (the tests run without one)."""
    monkeypatch.setattr(CS, "ha_state", lambda app: {"set_up": True, "connected": True})


def add_sensors(r):
    hub = r.app["hub"]
    hub.registry.update(entities=list(hub.registry.entity_entries) + [
        {"entity_id": eid, "platform": "frigate", "area_id": "porch"} for eid in SENSORS])
    hub.store.apply_event({"a": {eid: {"s": st, "a": {"friendly_name": name, **attrs}, "lc": 1.0}
                                 for eid, (name, attrs, st) in SENSORS.items()}})


class Api:
    """The page's calls, and every body that came back."""

    def __init__(self, r):
        self.r, self.bodies = r, []

    async def call(self, method, path, body=None, tunnel=False):
        m = self.r.env.m
        kw = {"headers": m.headers(True, tunnel)}
        if body is not None:
            kw["json"] = body
        resp = await m.client.request(method, path, **kw)
        text = await resp.text()
        self.bodies.append(text)
        try:
            return resp.status, json.loads(text)
        except ValueError:
            return resp.status, text

    def leaked(self):
        text = "\n".join(self.bodies)
        return [s for s in SECRETS if s in text]


def camera(**over):
    return {"name": "Driveway", "area_id": "porch", "address": ADDRESS, "username": USER, "password": PASSWORD, **over}


def camera_rows(r):
    """The camera audit rows, each with its detail read back from the row's `target`."""
    return [{**x, "detail": json.loads(x["target"])} for x in r.env.audit(kind="config") if x["action"].startswith("camera.")]


def everything_said(r, api, caplog):
    """All the places a secret could land: bodies, logs, the audit log, the settings document and its history."""
    audit = json.dumps(r.env.audit(), default=str)
    doc = json.dumps(r.app["settings"].store.body("house", D.DOC))
    hist = json.dumps(r.app["settings"].store.history("house", D.DOC), default=str) \
        if hasattr(r.app["settings"].store, "history") else ""
    # (the fake go2rtc's own access log shows the PATCH it was sent, whose query holds the stream: go2rtc's API takes
    # it there. That line is the fake's, in the same process; Mantel's own lines are the ones under test)
    logs = "\n".join(rec.getMessage() for rec in caplog.records if "/api/streams?" not in rec.getMessage())
    return "\n".join(api.bodies) + audit + doc + hist + logs


# ------------------------------------------------------------------------------------- the pure pieces
def test_the_address_is_checked_and_a_login_in_it_is_refused():
    assert CS.check_address(" rtsp://192.0.2.31:554/stream1 ") == "rtsp://192.0.2.31:554/stream1"
    assert CS.check_address("RTSPS://cam.local/x?a=b&c=d") == "rtsps://cam.local/x?a=b&c=d"
    assert CS.check_address("rtsp://[fd00::5]:8554/live") == "rtsp://[fd00::5]:8554/live"
    for bad, code in (("", "address_required"), (None, "address_required"), ("http://192.0.2.31/x", "address_invalid"),
                      ("192.0.2.31:554/x", "address_invalid"), ("rtsp://", "address_invalid"),
                      ("rtsp://host:99999/x", "address_invalid"), ("rtsp://host/x#exec:rm", "address_invalid"),
                      ("rtsp://host/x y", "address_invalid"), ("rtsp://" + "h" * 3000, "address_invalid"),
                      (f"rtsp://{USER}:{PASSWORD}@{HOST}/x", "login_in_address"), (f"rtsp://{USER}@{HOST}/x", "login_in_address")):
        with pytest.raises(CS.SetupError) as e:
            CS.check_address(bad)
        assert e.value.code == code, bad
        assert not [s for s in SECRETS if s in str(e.value)], "the refusal never repeats the login"
    # the `@` inside a path is no login
    assert CS.check_address("rtsp://host/live@720") == "rtsp://host/live@720"


def test_the_login_goes_into_the_url_encoded_and_comes_out_again():
    sealed = CS.with_login("rtsp://192.0.2.31:554/s1?x=y", USER, PASSWORD)
    assert sealed == f"rtsp://{USER}:{ENCODED}@192.0.2.31:554/s1?x=y"
    assert CS.split_login(sealed) == ("rtsp://192.0.2.31:554/s1?x=y", USER, PASSWORD)
    assert CS.with_login("rtsp://h/p", "", "") == "rtsp://h/p" and CS.split_login("rtsp://h/p") == ("rtsp://h/p", "", "")
    assert CS.split_login(CS.with_login("rtsp://h:1/p", "only", "")) == ("rtsp://h:1/p", "only", "")
    assert CS.split_login(CS.with_login("rtsps://[fd00::5]/p", "a b", "c:d@e")) == ("rtsps://[fd00::5]/p", "a b", "c:d@e")
    # what a camera is shown by: its host, not its login or path
    assert CS.address_of(sealed) == "rtsp://192.0.2.31:554"
    assert CS.slug_of("Front Door!", set()) == "front_door" and CS.slug_of("Front Door", {"front_door"}) == "front_door_2"
    assert CS.slug_of("###", set()) == "camera" and len(CS.slug_of("x" * 90, set())) <= 40
    assert D.SLUG.match(CS.slug_of("Café Ñandú 2", set()))


def test_go2rtc_s_reasons_become_four_plain_answers():
    seen = {"streams: wrong user/pass": "auth", "streams: user/pass not provided": "auth",
            "streams: dial tcp 192.168.65.254:1: connect: connection refused": "unreachable",
            "streams: dial tcp 192.0.2.77:554: i/o timeout": "unreachable",
            "streams: dial tcp: lookup nosuchhost.invalid on 192.168.65.7:53: no such host": "unreachable",
            "streams: read tcp 172.17.0.2:57766->192.168.65.254:18556: i/o timeout": "unreachable",
            "streams: codecs not matched: video:H265": "codec",
            "streams: wrong response on DESCRIBE": "other",
            # a port with 401 in it is no unauthorized
            "streams: dial tcp 192.0.2.5:401: connect: connection refused": "unreachable",
            "RTSP/1.0 401 Unauthorized": "auth", "something new": "other", "": "other"}
    for text, want in seen.items():
        assert CS.classify(text) == want, text
    assert CS.video_codecs(["video, recvonly, H264", "audio, recvonly, PCMA", "video, recvonly, H265"]) == ["H264", "H265"]
    assert CS.video_codecs(["video, recvonly, evil codec name that is long"]) == []
    assert CS.audio_codecs(["video, recvonly, H264", "audio, recvonly, PCMA"]) == ["PCMA"]


# ------------------------------------------------------------------------------------- who
async def test_only_an_owner_or_an_admin_and_never_a_wall_tablet(rig):
    r = await rig()
    api = Api(r)
    for name, role in (("adult1", "adult"), ("kid1", "child"), ("guest1", "guest")):
        await r.env.login(name, role)
        for method, path in (("GET", API), ("GET", API + "/sensors"), ("POST", API + "/test"), ("POST", API),
                             ("PUT", API + "/front"), ("DELETE", API + "/front")):
            status, body = await api.call(method, path, camera())
            assert status == 403, (role, method, path, body)
    for role in ("owner", "admin"):
        await r.env.login(role + "1", role)
        status, body = await api.call("GET", API)
        assert status == 200 and body["can_edit"] is True and body["needs_fresh"] is False, role
    # a wall tablet, even with an Owner's session behind the browser, gets nothing
    await r.env.login("owner2", "owner")
    status, _ = await api.call("POST", "/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert status == 201
    for method, path in (("GET", API), ("GET", API + "/sensors"), ("POST", API + "/test"), ("POST", API),
                         ("PUT", API + "/front"), ("DELETE", API + "/front")):
        assert (await api.call(method, path, camera()))[0] == 403, (method, path)
    assert r.cams.sources() == [] and r.go2rtc.calls == [], "nothing was kept and nothing reached go2rtc"


async def test_away_from_home_a_change_asks_for_a_fresh_sign_in_an_admin_too(rig):
    r = await rig()
    api = Api(r)
    for role in ("owner", "admin"):
        uid = await r.env.m.user(role + "9", role)
        issued = r.app["sessions"].create(uid, "tunnel", "passkey")
        r.env.m.set_cookies(mantel_session=issued.access, mantel_csrf=issued.csrf)
        r.env.now[0] += 360                                               # the sign-in factor is no longer fresh
        status, body = await api.call("GET", API, tunnel=True)
        assert status == 200 and body["can_edit"] is True and body["needs_fresh"] is True, role
        before, rows = list(r.go2rtc.calls), camera_rows(r)
        for method, path in (("POST", API), ("POST", API + "/test"), ("PUT", API + "/front"), ("DELETE", API + "/front")):
            status, body = await api.call(method, path, camera(), tunnel=True)
            assert status == 403 and body["error"] == "step_up_required", (role, method, path, body)
        assert r.go2rtc.calls == before and camera_rows(r) == rows
        r.env.m.store.db.execute("UPDATE sessions SET fresh_factor_at = ?", (r.env.now[0],))
        status, body = await api.call("POST", API, camera(), tunnel=True)
        assert status == 201, (role, body)
        await r.cams.remove(body["camera"]["slug"])


async def test_under_the_ha_app_the_page_says_so_and_there_is_nothing_to_add(rig):
    r = await rig(go2rtc=False)
    r.app["connections"].app_mode = True
    api = Api(r)
    await r.env.login("owner1", "owner")
    status, body = await api.call("GET", API)
    assert status == 200 and body["mode"] == "ha_app" and body["cameras"] == [] and body["ha_docs"].startswith("https://www.home-assistant.io/")
    for method, path in (("POST", API + "/test"), ("POST", API), ("PUT", API + "/front"), ("DELETE", API + "/front")):
        status, body = await api.call(method, path, camera())
        assert status == 409 and body["error"] == "provided_by_app" and "Generic Camera" in body["message"], (method, path, body)
    assert (await api.call("GET", API + "/sensors"))[0] == 409
    # Docker or the LXC started without go2rtc says that instead
    r.app["connections"].app_mode = False
    status, body = await api.call("GET", API)
    assert status == 200 and body["mode"] == "no_go2rtc"
    assert (await api.call("POST", API, camera()))[1]["error"] == "no_go2rtc"


# ------------------------------------------------------------------------------------- adding, changing, removing
async def test_a_camera_is_added_and_its_login_stays_in_the_sealed_file(rig, caplog):
    caplog.set_level(logging.DEBUG)
    r = await rig()
    api = Api(r)
    await r.env.login("owner1", "owner")
    status, body = await api.call("POST", API, camera(low_address=LOW))
    assert status == 201, body
    cam = body["camera"]
    assert cam["slug"] == "driveway" and cam["entity_id"] == "camera.mantel_driveway" and cam["source"] == "rtsp"
    assert cam["address"] == f"rtsp://{HOST}:554" and cam["low_address"] == f"rtsp://{HOST}:554" and cam["has_login"] is True
    assert cam["area_id"] == "porch" and cam["area_name"] == "Porch" and cam["state"] == "ok" and cam["editable"] is True
    # the camera is an entity with its area; the sealed file holds the login, encoded, for both streams
    assert r.state("camera.mantel_driveway")["a"]["friendly_name"] == "Driveway"
    assert r.app["hub"].registry.entity_area["camera.mantel_driveway"] == "porch"
    sec = r.cams.secret("driveway")
    assert sec.high == f"rtsp://{USER}:{ENCODED}@{HOST}:554/stream1?token={PATH_TOKEN}"
    assert sec.low == f"rtsp://{USER}:{ENCODED}@{HOST}:554/stream2?token={PATH_TOKEN}"
    raw = (r.app["cfg"].connections_dir / "camera-driveway.connection").read_bytes()
    assert not [s for s in SECRETS if s.encode() in raw], "sealed"
    # the page's own read of it, the audit rows and every log line: no login, no path
    status, page = await api.call("GET", API)
    assert status == 200 and page["mode"] == "direct" and [c["slug"] for c in page["cameras"]] == ["driveway"]
    assert page["can_edit"] is True and {"id": "porch", "name": "Porch"} in page["areas"]
    rows = camera_rows(r)
    assert [x["action"] for x in rows] == ["camera.rtsp.add"]
    assert rows[0]["detail"]["address"] == f"rtsp://{HOST}:554" and rows[0]["detail"]["login"] is True
    said = everything_said(r, api, caplog)
    assert not [s for s in SECRETS if s in said], [s for s in SECRETS if s in said]
    # a second camera of the same name is another slug; an area that is not Home Assistant's is refused
    status, body = await api.call("POST", API, camera(address=f"rtsp://{HOST}:554/other"))
    assert status == 201 and body["camera"]["slug"] == "driveway_2"
    status, body = await api.call("POST", API, camera(area_id="the_moon"))
    assert status == 422 and body["field"] == "area_id" and body["error"] == "area_unknown"
    # no login at all is fine; a password with no user name is not
    status, body = await api.call("POST", API, camera(name="Bare", username="", password=""))
    assert status == 201 and body["camera"]["has_login"] is False and r.cams.secret("bare").high == f"rtsp://{HOST}:554/stream1?token={PATH_TOKEN}"
    status, body = await api.call("POST", API, camera(name="Odd", username=""))
    assert status == 422 and body["field"] == "username"
    assert not [s for s in SECRETS if s in "\n".join(api.bodies[-1:])]


async def test_what_is_typed_wrong_is_refused_in_plain_words_without_the_login(rig, caplog):
    caplog.set_level(logging.DEBUG)
    r = await rig()
    api = Api(r)
    await r.env.login("owner1", "owner")
    for over, field, code in (({"address": f"rtsp://{USER}:{PASSWORD}@{HOST}/s"}, "address", "login_in_address"),
                              ({"address": "http://" + HOST}, "address", "address_invalid"),
                              ({"address": ""}, "address", "address_required"),
                              ({"low_address": f"rtsp://{USER}:{PASSWORD}@{HOST}/s2"}, "low_address", "login_in_address"),
                              ({"name": "  "}, "name", "name_required"), ({"name": "x" * 200}, "name", "invalid"),
                              ({"password": "p" * 500}, "password", "invalid")):
        status, body = await api.call("POST", API, camera(**over))
        assert status == 422 and body["field"] == field and body["error"] == code, (over, body)
    assert r.cams.sources() == [] and not r.cams.local.mine
    assert not [s for s in SECRETS if s in everything_said(r, api, caplog)]


async def test_a_change_with_the_password_left_blank_keeps_the_saved_login(rig, caplog):
    caplog.set_level(logging.DEBUG)
    r = await rig()
    api = Api(r)
    await r.env.login("owner1", "owner")
    assert (await api.call("POST", API, camera(low_address=LOW)))[0] == 201
    # name and area only: the address, the sub-stream and the login are all kept
    status, body = await api.call("PUT", API + "/driveway", {"name": "Driveway Cam", "area_id": "kitchen"})
    assert status == 200, body
    assert body["camera"]["name"] == "Driveway Cam" and body["camera"]["area_name"] == "Kitchen" and body["camera"]["slug"] == "driveway"
    sec = r.cams.secret("driveway")
    assert sec.high == f"rtsp://{USER}:{ENCODED}@{HOST}:554/stream1?token={PATH_TOKEN}" and sec.low.endswith("/stream2?token=" + PATH_TOKEN)
    # a new address with the boxes left blank keeps the login on it
    status, body = await api.call("PUT", API + "/driveway", {"name": "Driveway Cam", "area_id": "kitchen",
                                                              "address": f"rtsps://{HOST}:322/new?token={PATH_TOKEN}"})
    assert status == 200 and body["camera"]["address"] == f"rtsps://{HOST}:322"
    assert r.cams.secret("driveway").high == f"rtsps://{USER}:{ENCODED}@{HOST}:322/new?token={PATH_TOKEN}"
    assert r.cams.secret("driveway").low.startswith(f"rtsp://{USER}:{ENCODED}@"), "the sub-stream stays"
    # a new password keeps the user name; a new user name keeps the password
    await api.call("PUT", API + "/driveway", {"name": "Driveway Cam", "area_id": "kitchen", "password": "Fictional-New-Pw"})
    assert CS.split_login(r.cams.secret("driveway").high)[1:] == (USER, "Fictional-New-Pw")
    await api.call("PUT", API + "/driveway", {"name": "Driveway Cam", "area_id": "kitchen", "username": "other"})
    assert CS.split_login(r.cams.secret("driveway").high)[1:] == ("other", "Fictional-New-Pw")
    # the sub-stream removed, then the login cleared
    status, body = await api.call("PUT", API + "/driveway", {"name": "Driveway Cam", "area_id": "kitchen", "low_address": ""})
    assert status == 200 and body["camera"]["low"] is False and r.cams.secret("driveway").low is None
    status, body = await api.call("PUT", API + "/driveway", {"name": "Driveway Cam", "area_id": "kitchen", "clear_login": True})
    assert status == 200 and body["camera"]["has_login"] is False and "@" not in r.cams.secret("driveway").high
    # audit rows name what changed, never the values
    rows = [x for x in camera_rows(r) if x["action"] == "camera.rtsp.edit"]
    assert [x["detail"]["changed"] for x in rows] == [["name", "area"], ["address"], ["password"], ["user_name"], ["sub_stream"], ["user_name", "password"]]
    said = everything_said(r, api, caplog)
    assert not [s for s in SECRETS + ("Fictional-New-Pw", "other:") if s in said]
    assert (await api.call("PUT", API + "/nope", camera()))[0] == 404
    assert (await api.call("PUT", API + "/Bad!", camera()))[0] == 404


async def test_a_camera_is_removed_with_its_sealed_file(rig):
    r = await rig()
    api = Api(r)
    await r.env.login("owner1", "owner")
    await api.call("POST", API, camera())
    path = r.app["cfg"].connections_dir / "camera-driveway.connection"
    assert path.exists()
    assert (await api.call("DELETE", API + "/nope"))[0] == 404
    status, body = await api.call("DELETE", API + "/driveway")
    assert status == 200 and body["removed"] == "driveway" and not path.exists()
    assert r.state("camera.mantel_driveway") is None and r.cams.sources() == []
    assert [x["action"] for x in camera_rows(r)] == ["camera.rtsp.add", "camera.rtsp.remove"]
    # a Protect camera is not this page's to remove
    await r.cams.put({"slug": "front", "name": "Front Door", "source": "protect", "streams": {"high": PROTECT_HIGH, "low": PROTECT_LOW}})
    status, body = await api.call("DELETE", API + "/front")
    assert status == 409 and body["error"] == "not_rtsp" and r.cams.sources()
    status, body = await api.call("PUT", API + "/front", camera())
    assert status == 404, "and cannot be changed as an RTSP camera"
    page = (await api.call("GET", API))[1]
    assert page["cameras"][0]["editable"] is False and page["cameras"][0]["address"] is None


async def test_an_id_home_assistant_has_is_refused_and_named_plainly(rig):
    r = await rig()
    api = Api(r)
    hub = r.app["hub"]
    hub.registry.update(entities=list(hub.registry.entity_entries) + [
        {"entity_id": "camera.mantel_driveway", "platform": "generic", "original_name": "HA Driveway", "area_id": "porch"}])
    await r.env.login("owner1", "owner")
    status, body = await api.call("POST", API, camera())
    assert status == 409 and body["error"] == "ha_has_that_id" and body["entity_id"] == "camera.mantel_driveway"
    assert "HA Driveway" in body["message"] and "another name" in body["message"]
    assert r.cams.sources() == [] and not (r.app["cfg"].connections_dir / "camera-driveway.connection").exists()
    assert not Api.leaked(api)
    # another name goes through
    assert (await api.call("POST", API, camera(name="Driveway East")))[0] == 201


# ------------------------------------------------------------------------------------- Test
async def test_test_shows_the_picture_and_leaves_nothing_behind(rig, caplog):
    caplog.set_level(logging.DEBUG)
    r = await rig()
    api = Api(r)
    await r.env.login("owner1", "owner")
    status, body = await api.call("POST", API + "/test", camera())
    assert status == 200, body
    res = body["result"]
    assert res["ok"] is True and res["video"] == "H264" and res["audio"] == "PCMA" and res["low"] is False
    import base64
    assert res["still"].startswith("data:image/jpeg;base64,") and base64.b64decode(res["still"].split(",", 1)[1]) == FRAME
    # one temporary stream, asked to open, drawn at a small width, and removed again
    [(name, src)] = r.go2rtc.patched
    assert name.startswith("mantel_cam_test_") and src == f"rtsp://{USER}:{ENCODED}@{HOST}:554/stream1?token={PATH_TOKEN}"
    assert r.go2rtc.probes == [{"src": name, "video": "all", "audio": "all"}] and r.go2rtc.frames[0]["width"] == "640"
    assert r.go2rtc.streams == {} and r.cams.testing == set() and r.cams.sources() == []
    assert camera_rows(r) == [], "a Test keeps nothing and is not a change"
    assert not [s for s in SECRETS if s in everything_said(r, api, caplog)]
    # the sub-stream is tried too (no picture of it)
    status, body = await api.call("POST", API + "/test", camera(low_address=LOW))
    assert status == 200 and body["result"]["low"] is True and len(r.go2rtc.patched) == 3
    assert r.go2rtc.streams == {}


async def test_test_names_what_went_wrong_in_four_plain_words(rig, caplog):
    caplog.set_level(logging.DEBUG)
    r = await rig()
    api = Api(r)
    await r.env.login("owner1", "owner")
    fake = r.go2rtc
    cases = [
        ({"user/pass": "streams: wrong user/pass"}, "auth", "user name or password"),
        ({"dial": "streams: dial tcp 192.0.2.31:554: connect: connection refused"}, "unreachable", "could not reach"),
        ({"dial": "streams: dial tcp 192.0.2.31:554: i/o timeout"}, "unreachable", "could not reach"),
        ({"dial": "streams: dial tcp: lookup cam.invalid on 10.0.0.1:53: no such host"}, "unreachable", "could not reach"),
        ({"dial": "streams: wrong response on DESCRIBE"}, "other", "no stream at that address"),
        ({"dial": "streams: something go2rtc has not said before"}, "other", "could not get a picture"),
    ]
    for fail, code, words in cases:
        fake.probe_fail = {HOST: next(iter(fail.values()))}
        status, body = await api.call("POST", API + "/test", camera())
        assert status == 422 and body["error"] == code and words in body["message"], (fail, status, body)
    # a codec the browser cannot play: H.265 only, or JPEG only
    fake.probe_fail = {}
    for medias, said in ((["video, recvonly, H265", "audio, recvonly, AAC"], "H265"), (["video, recvonly, JPEG"], "JPEG"), (["audio, recvonly, PCMA"], "something else")):
        fake.medias = medias
        status, body = await api.call("POST", API + "/test", camera())
        assert status == 422 and body["error"] == "codec" and said in body["message"] and "H.264" in body["message"], body
    # H.264 beside H.265 is fine
    fake.medias = ["video, recvonly, H265", "video, recvonly, H264"]
    assert (await api.call("POST", API + "/test", camera()))[0] == 200
    # connected, but no picture ever came
    fake.medias = ["video, recvonly, H264"]
    fake.silent = {HOST}
    status, body = await api.call("POST", API + "/test", camera())
    assert status == 422 and body["error"] == "other" and "no picture" in body["message"]
    fake.silent = set()
    # a probe that never answers within the budget: the camera is not there
    r.cams.testing.clear()
    CS.TEST_BUDGET_S, was = 0.3, CS.TEST_BUDGET_S
    try:
        fake.probe_delay = 1.0
        status, body = await api.call("POST", API + "/test", camera())
    finally:
        CS.TEST_BUDGET_S = was
    assert status == 422 and body["error"] == "unreachable"
    # none of it left a stream behind or said a secret
    assert fake.streams == {} and r.cams.testing == set()
    said = everything_said(r, api, caplog)
    assert not [s for s in SECRETS if s in said] and "192.0.2.31:554: " not in said, "go2rtc's own words are never passed on"
    # a sub-stream that fails is said to be the sub-stream
    fake.probe_delay, fake.probe_fail = 0, {"stream2": "streams: wrong user/pass"}
    status, body = await api.call("POST", API + "/test", camera(low_address=LOW))
    assert status == 422 and body["error"] == "auth" and body["message"].startswith("The sub-stream:")


async def test_test_when_go2rtc_is_down_says_so_and_a_second_test_waits(rig):
    r = await rig()
    api = Api(r)
    await r.env.login("owner1", "owner")
    # go2rtc refuses the stream
    r.go2rtc.fail_patch = True
    status, body = await api.call("POST", API + "/test", camera())
    assert status == 422 and body["error"] == "other" and "video relay" in body["message"]
    r.go2rtc.fail_patch = False
    # one test at a time
    async with r.cams.testing_lock:
        status, body = await api.call("POST", API + "/test", camera())
    assert status == 409 and body["error"] == "busy"
    # a new camera's address is required to test it; a saved one is tried with its saved login
    assert (await api.call("POST", API + "/test", {"name": "x"}))[1]["error"] == "address_required"
    await api.call("POST", API, camera())
    r.go2rtc.patched.clear()
    status, body = await api.call("POST", API + "/test", {"slug": "driveway"})
    assert status == 200
    assert r.go2rtc.patched[0][1] == f"rtsp://{USER}:{ENCODED}@{HOST}:554/stream1?token={PATH_TOKEN}"
    assert not Api.leaked(api)
    # the tick does not reap a stream a test is using
    r.go2rtc.streams["mantel_cam_test_0000"] = "rtsp://x"
    r.cams.testing.add("mantel_cam_test_0000")
    await r.cams.tick()
    assert "mantel_cam_test_0000" in r.go2rtc.streams
    r.cams.testing.clear()
    await r.cams.tick()
    assert "mantel_cam_test_0000" not in r.go2rtc.streams, "...but one a crash left is reaped"


# ------------------------------------------------------------------------------------- linked sensors
async def test_the_sensors_on_offer_are_the_ones_the_person_may_see_with_suggestions(rig, ha_there):
    r = await rig()
    add_sensors(r)
    api = Api(r)
    await r.env.login("admin1", "admin")
    r.app["rbac"].add_grant(Grant(effect="deny", actions=("view",), resource_kind="entity",
                                  resource="binary_sensor.secret_closet", roles={"admin"}))
    status, body = await api.call("GET", API + "/sensors?name=Driveway")
    assert status == 200 and body["ha"] == {"set_up": True, "connected": True}
    ids = [s["entity_id"] for s in body["sensors"]]
    assert "binary_sensor.secret_closet" not in ids, "a sensor the person may not see is not offered"
    assert set(ids) == set(SENSORS) - {"binary_sensor.secret_closet"}
    assert "light.kitchen" not in ids and "camera.doorbell" not in ids, "binary sensors and events only"
    assert body["suggested"] == {"motion": "binary_sensor.driveway_motion", "person": "binary_sensor.driveway_person_occupancy",
                                 "doorbell": "event.driveway_doorbell"}
    assert (await api.call("GET", API + "/sensors?name=Nothing Like It"))[1]["suggested"] == {"motion": None, "person": None, "doorbell": None}
    # one linked to another camera is not suggested again, and says whom it is linked to
    await r.env.login("owner1", "owner")
    assert (await api.call("POST", API, camera(sensors={"motion": "binary_sensor.driveway_motion"})))[0] == 201
    body = (await api.call("GET", API + "/sensors?name=Driveway"))[1]
    assert body["suggested"]["motion"] is None
    assert next(s for s in body["sensors"] if s["entity_id"] == "binary_sensor.driveway_motion")["linked_to"] == "Driveway"
    # ...but is still offered to the camera that has it
    body = (await api.call("GET", API + "/sensors?name=Driveway&slug=driveway"))[1]
    assert body["suggested"]["motion"] == "binary_sensor.driveway_motion"


async def test_without_home_assistant_there_is_no_sensor_to_link_and_the_page_says_so(rig, monkeypatch):
    monkeypatch.setattr(CS, "ha_state", lambda app: {"set_up": False, "connected": False})
    r = await rig()
    add_sensors(r)
    api = Api(r)
    await r.env.login("owner1", "owner")
    status, body = await api.call("GET", API + "/sensors?name=Driveway")
    assert status == 200 and body["ha"] == {"set_up": False, "connected": False} and body["sensors"] == []
    assert (await api.call("GET", API))[1]["ha"]["set_up"] is False
    status, body = await api.call("POST", API, camera(sensors={"motion": "binary_sensor.driveway_motion"}))
    assert status == 422 and body["error"] == "no_ha" and body["field"] == "sensors.motion"
    assert r.cams.sources() == []
    assert (await api.call("POST", API, camera()))[0] == 201, "a camera without sensors needs no Home Assistant"


async def test_a_linked_sensor_is_checked_and_stored_on_the_source(rig, ha_there):
    r = await rig()
    add_sensors(r)
    api = Api(r)
    await r.env.login("admin1", "admin")
    r.app["rbac"].add_grant(Grant(effect="deny", actions=("view",), resource_kind="entity",
                                  resource="binary_sensor.secret_closet", roles={"admin"}))
    mine = {"motion": "binary_sensor.driveway_motion", "person": "binary_sensor.driveway_person_occupancy", "doorbell": "event.driveway_doorbell"}
    status, body = await api.call("POST", API, camera(sensors=mine))
    assert status == 201, body
    assert body["camera"]["sensors"]["doorbell"] == {"entity_id": "event.driveway_doorbell", "name": "Driveway Doorbell", "missing": False}
    [src] = r.cams.sources()
    assert src.links == mine and src.detections == ("motion", "person", "ring"), "detections mirror the roles"
    assert r.app["settings"].store.body("house", D.DOC)["cameras"][0]["sensors"] == mine
    # a sensor that does not exist and one the person may not see are refused in the same words (no oracle)
    said = []
    for eid in ("binary_sensor.no_such_thing", "binary_sensor.secret_closet"):
        status, body = await api.call("PUT", API + "/driveway", camera(sensors={"motion": eid}))
        assert status == 422 and body["field"] == "sensors.motion" and body["error"] == "sensor_unknown"
        said.append(body["message"])
    assert said[0] == said[1]
    # the wrong kind of entity, and one sensor twice
    for sensors, code in (({"motion": "light.kitchen"}, "sensor_invalid"), ({"motion": "camera.doorbell"}, "sensor_invalid"),
                          ({"motion": 5}, "sensor_invalid"), ({"nap": "binary_sensor.driveway_motion"}, "invalid"),
                          ({"motion": "binary_sensor.porch_ring", "person": "binary_sensor.porch_ring"}, "sensor_twice")):
        status, body = await api.call("PUT", API + "/driveway", camera(sensors=sensors))
        assert status == 422 and body["error"] == code, (sensors, body)
    # one camera's sensor is not another's
    status, body = await api.call("POST", API, camera(name="Hall", address=f"rtsp://{HOST}/hall",
                                                      sensors={"person": "binary_sensor.driveway_person_occupancy"}))
    assert status == 422 and body["error"] == "sensor_taken" and "Driveway" in body["message"]
    # a change that leaves `sensors` out keeps them; an empty one clears them
    status, body = await api.call("PUT", API + "/driveway", {"name": "Driveway", "area_id": "porch"})
    assert status == 200 and r.cams.sources()[0].links == mine
    # a sensor kept as it was stays even when this person cannot see it now (the page cannot have changed it)
    r.cams.sources()
    await r.cams.put({"slug": "driveway", "name": "Driveway", "source": "rtsp", "area_id": "porch",
                      "sensors": {**mine, "motion": "binary_sensor.secret_closet"}})
    status, body = await api.call("PUT", API + "/driveway", camera(sensors={**mine, "motion": "binary_sensor.secret_closet"}))
    assert status == 200, body
    page = (await api.call("GET", API))[1]
    assert page["cameras"][0]["sensors"]["motion"] == {"entity_id": None, "name": "A sensor you cannot see", "missing": False}
    # the page was never told which, so it leaves that role out of what it sends: the link stays; null clears one
    status, body = await api.call("PUT", API + "/driveway", {"name": "Driveway", "area_id": "porch", "sensors": {"person": None}})
    assert status == 200 and r.cams.sources()[0].links == {"motion": "binary_sensor.secret_closet", "doorbell": mine["doorbell"]}
    assert (await api.call("PUT", API + "/driveway", camera(sensors={**mine, "motion": "binary_sensor.secret_closet"})))[0] == 200
    status, body = await api.call("PUT", API + "/driveway", camera(sensors=NONE))
    assert status == 200 and r.cams.sources()[0].sensors == () and r.cams.sensor_links() == {}
    assert not Api.leaked(api)


# ------------------------------------------------------------------------------------- reaching the notification rules
async def test_linked_sensors_stand_in_for_the_device_the_camera_does_not_have(rig, ha_there):
    r = await rig()
    add_sensors(r)
    api = Api(r)
    house = r.app["features"].house
    await r.env.login("owner1", "owner")
    # before: nothing ties the camera to its sensors, and a plain ring sensor is a "binary" one
    await r.cams.put({"slug": "driveway", "name": "Driveway", "source": "rtsp", "area_id": "porch", "streams": {"high": ADDRESS}})
    assert NA.camera_for(house, "binary_sensor.porch_ring") is None and NA.trigger_for(house, "camera.mantel_driveway") is None
    assert NA.kind(house, "binary_sensor.porch_ring") == "binary" and NA.kind(house, "binary_sensor.driveway_person_occupancy") == "presence"
    assert house.camera_links() == {}
    # the page links them
    mine = {"motion": "binary_sensor.driveway_motion", "person": "binary_sensor.driveway_person_occupancy", "doorbell": "binary_sensor.porch_ring"}
    status, _ = await api.call("PUT", API + "/driveway", {"name": "Driveway", "area_id": "porch", "sensors": mine})
    assert status == 200
    cam = "camera.mantel_driveway"
    assert house.camera_links() == {eid: (cam, role) for role, eid in mine.items()}
    # the same functions the rules use now answer for them: the camera of a sensor, the sensor of a camera, the kind
    assert NA.camera_for(house, "binary_sensor.porch_ring") == cam and NA.camera_for(house, "binary_sensor.driveway_motion") == cam
    assert NA.camera_for(house, "binary_sensor.hall_person_detected") is None, "an unlinked sensor still finds nothing"
    assert NA.kind(house, "binary_sensor.porch_ring") == "doorbell" and NA.kind(house, "binary_sensor.driveway_person_occupancy") == "person"
    assert NA.kind(house, "binary_sensor.driveway_motion") == "motion"
    assert NA.trigger_for(house, cam) == "binary_sensor.driveway_person_occupancy", "person first, as a device's"
    d = NA.describe(house, "binary_sensor.porch_ring")
    assert d["kind"] == "doorbell" and d["camera"] == cam and d["choices"] == [["on", "Rings"]]
    assert NR.category_of(d["kind"]) == "doorbells" and NR.CAMERA_KINDS.count("doorbell") == 1
    assert NA.candidates(house, "doorbells") == ["binary_sensor.porch_ring", "event.driveway_doorbell"], "(the event is a doorbell by its own class)"
    # an Admin of Home Assistant's own device-based cameras is unchanged: a camera on a device still finds its own
    assert NA.camera_for(house, "camera.doorbell") is None


async def test_a_linked_doorbell_rings_the_doorbells_notification_with_the_cameras_snapshot_and_pop_up(rig, ha_there):
    r = await rig()
    add_sensors(r)
    api = Api(r)
    host = r.app["features"]
    bells = NS.new_category("doorbells", set())
    cams = NS.new_category("cameras", {bells["id"]})
    r.app["settings"].store.write([("house", F.FEATURES_DOC, F.check_settings(
        {"notifications": {"enabled": True, "items": [bells, cams]}}))], actor=Actor(label="test"))
    await host.reload()
    await r.env.login("owner1", "owner")
    # a Cameras category with no sensor linked to the camera watches nothing for it
    await r.cams.put({"slug": "driveway", "name": "Driveway", "source": "rtsp", "area_id": "porch", "streams": {"high": ADDRESS}})
    own_bell = ["event.driveway_doorbell"]               # a doorbell by its own device class, camera or not
    assert host.notifier.watched[bells["id"]] == own_bell and host.notifier.watched[cams["id"]] == []
    # linking them (through the page) makes the notifier look again by itself
    mine = {"person": "binary_sensor.driveway_person_occupancy", "doorbell": "binary_sensor.porch_ring"}
    assert (await api.call("PUT", API + "/driveway", {"name": "Driveway", "area_id": "porch", "sensors": mine}))[0] == 200
    assert host.notifier.watched[bells["id"]] == ["binary_sensor.porch_ring"] + own_bell
    assert host.notifier.watched[cams["id"]] == ["binary_sensor.driveway_person_occupancy"], "the Cameras category's trigger"
    pair = next(p for p in NA.camera_pairs(host.house, cams) if p["camera"] == "camera.mantel_driveway")
    assert pair["trigger"] == "binary_sensor.driveway_person_occupancy" and pair["on"] is True and pair["view"] == pair["camera"]
    # a ring: the Doorbells notification goes off, with the camera's snapshot and the doorbell pop-up
    hub = r.app["hub"]
    touched = hub.store.apply_event({"c": {"binary_sensor.porch_ring": {"+": {"s": "on", "lc": 2.0}}}})
    hub.ha.on_change(touched)
    await asyncio.sleep(0.05)
    assert [s["entity"] for s in host.notifier.sent] == ["binary_sensor.porch_ring"]
    new = host.house.state("binary_sensor.porch_ring")
    payload = NB.build(host.house, host.notifier.opts, bells, new, eid="binary_sensor.porch_ring")
    assert payload["kind"] == "doorbell" and payload["pop"] == "doorbell" and payload["tap"] == "camera"
    assert payload["camera"] == "camera.mantel_driveway" and payload["sheet"] == "camera.mantel_driveway"
    # a person: the Cameras category's, its own camera's snapshot
    touched = hub.store.apply_event({"c": {"binary_sensor.driveway_person_occupancy": {"+": {"s": "on", "lc": 3.0}}}})
    hub.ha.on_change(touched)
    await asyncio.sleep(0.05)
    assert host.notifier.sent[-1]["entity"] == "binary_sensor.driveway_person_occupancy" and host.notifier.sent[-1]["item"] == cams["id"]
    new = host.house.state("binary_sensor.driveway_person_occupancy")
    payload = NB.build(host.house, host.notifier.opts, cams, new, eid="binary_sensor.driveway_person_occupancy")
    assert payload["kind"] == "person" and payload["camera"] == "camera.mantel_driveway" and payload["title"] == "Driveway"
    # unlinked, the camera's sensors stop counting as its own
    assert (await api.call("PUT", API + "/driveway", {"name": "Driveway", "area_id": "porch", "sensors": NONE}))[0] == 200
    assert host.notifier.watched[bells["id"]] == own_bell and host.notifier.watched[cams["id"]] == []
    assert host.house.camera_links() == {}
    # the camera goes: its links go
    assert (await api.call("PUT", API + "/driveway", {"name": "Driveway", "area_id": "porch", "sensors": mine}))[0] == 200
    assert (await api.call("DELETE", API + "/driveway"))[0] == 200
    assert host.house.camera_links() == {} and host.notifier.watched[bells["id"]] == own_bell


def test_the_house_without_links_is_what_it_was():
    """A House with no camera_links (Home Assistant's, or any written before), and the suggestions by name."""
    from hk_core.house import Entity, State
    from test_hk_core_notifications import FakeHouse
    h = FakeHouse(states=[State("binary_sensor.a", "off", {"device_class": "motion"}), State("camera.a", "idle", {})],
                  entities=[Entity("binary_sensor.a", device_id="d1"), Entity("camera.a", device_id="d1")])
    assert NA.links(h) == {} and NA.kind(h, "binary_sensor.a") == "motion" and NA.camera_for(h, "binary_sensor.a") == "camera.a"

    class Linked(FakeHouse):
        def camera_links(self):
            return {"binary_sensor.a": ("camera.x", "doorbell")}
    lk = Linked(states=[State("binary_sensor.a", "off", {"device_class": "motion"}), State("camera.x", "idle", {})],
                entities=[Entity("binary_sensor.a", device_id="d1"), Entity("camera.x")])
    assert NA.kind(lk, "binary_sensor.a") == "doorbell" and NA.camera_for(lk, "binary_sensor.a") == "camera.x"
    # a link to a camera the house no longer has finds none
    gone = Linked(states=[State("binary_sensor.a", "off", {})], entities=[Entity("binary_sensor.a")])
    assert NA.camera_for(gone, "binary_sensor.a") is None


# -- the snapshot address (2026-11-02, the owner) ---------------------------------------------------------------------
class SnapshotCamera:
    """A camera's own snapshot URL on this machine: a JPEG, behind HTTP Basic with the camera's login."""
    JPEG = b"\xff\xd8fictional-snapshot\xff\xd9"

    def __init__(self):
        self.asked = 0

    async def handler(self, request):
        self.asked += 1
        import base64 as b64
        want = "Basic " + b64.b64encode(f"{USER}:{PASSWORD}".encode()).decode()
        if request.headers.get("Authorization") != want:
            return web.Response(status=401)
        return web.Response(body=self.JPEG, content_type="image/jpeg")


async def test_a_snapshot_address_gives_the_pictures_with_the_cameras_login(rig, caplog):
    from aiohttp.test_utils import TestServer
    caplog.set_level(logging.DEBUG)
    cam_http = SnapshotCamera()
    app = web.Application()
    app.router.add_get("/snap.jpg", cam_http.handler)
    async with TestServer(app, host="127.0.0.1") as server:
        snap = str(server.make_url("/snap.jpg")) + f"?token={PATH_TOKEN}"
        r = await rig()
        api = Api(r)
        await r.env.login("owner1", "owner")
        # a login typed into it is refused, as for the streams
        status, body = await api.call("POST", API, camera(snapshot_address=snap.replace("http://", f"http://{USER}:x@")))
        assert status == 422 and body["field"] == "snapshot_address" and body["error"] == "login_in_address"
        status, body = await api.call("POST", API, camera(snapshot_address="ftp://192.0.2.31/x.jpg"))
        assert status == 422 and body["field"] == "snapshot_address"
        # Test fetches it with the camera's login and shows that picture
        status, body = await api.call("POST", API + "/test", camera(snapshot_address=snap))
        assert status == 200 and body["result"]["snapshot"] is True, body
        assert body["result"]["still"].endswith(base64.b64encode(SnapshotCamera.JPEG).decode())
        status, body = await api.call("POST", API + "/test", camera(snapshot_address=snap, password="wrong"))
        assert status == 422 and body["error"] == "auth" and "Basic" in body["message"]
        # saved: the stills come from it
        status, body = await api.call("POST", API, camera(snapshot_address=snap))
        assert status == 201 and body["camera"]["snapshot_address"].startswith("http://127.0.0.1:")
        assert r.cams.secret("driveway").still.startswith(f"http://{USER}:{ENCODED}@127.0.0.1:")
        frames = len(r.go2rtc.frames)
        resp = await r.env.m.get("/api/camera/camera.mantel_driveway/still")
        assert resp.status == 200 and await resp.read() == SnapshotCamera.JPEG
        assert len(r.go2rtc.frames) == frames, "no frame from go2rtc: the snapshot address answered"
        # a change that leaves it blank keeps it; "" removes it, and the stills come from the streams again
        status, body = await api.call("PUT", API + "/driveway", {"name": "Driveway"})
        assert status == 200 and r.cams.secret("driveway").still
        status, body = await api.call("PUT", API + "/driveway", {"name": "Driveway", "snapshot_address": ""})
        assert status == 200 and body["camera"]["snapshot_address"] is None and r.cams.secret("driveway").still is None
        # (the fake camera's and the fake go2rtc's own access logs show what they were asked: theirs, not Mantel's)
        caplog.records[:] = [rec for rec in caplog.records if rec.name != "aiohttp.access"]
        said = everything_said(r, api, caplog)
        assert not [s for s in SECRETS if s in said], [s for s in SECRETS if s in said]
