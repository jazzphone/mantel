"""Direct camera sources (mantel_server/cameras_direct.py; docs/phase13/CAMERAS-DIRECT.md phase 3): where Mantel has
its own go2rtc, a Protect or RTSP camera becomes ``camera.mantel_<slug>``, an entity in Mantel's overlay with its
area in the registry, decided by exactly the camera rules Home Assistant's cameras are; its video is set up in
go2rtc on demand and relayed like Live TV's, its still drawn from go2rtc, its URLs sealed and never shown. Under
the HA App nothing changes. A fake go2rtc on 127.0.0.1, a fictional house; house commands stay off throughout."""
import asyncio
import json
import sys
from pathlib import Path

import pytest
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

import gateway_fakes as GF
from conftest import Mantel
from live_tv_fakes import ANSWER, CANDIDATE, FRAME, FakeGo2rtc
from mantel_server import cameras_direct as D
from mantel_server import features as F
from mantel_server import live_tv as L
from mantel_server.rbac import Grant
from mantel_server.settings_store import Actor

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools/e2e"))
import fake_tuner  # noqa: E402

OFFER_SDP = "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 102\r\na=recvonly\r\n"
# fictional addresses and secrets: what must never reach a page, a status or the settings document
PROTECT_HIGH = "rtsps://192.0.2.20:7441/FictionalHighToken0?enableSrtp"
PROTECT_LOW = "rtsps://192.0.2.20:7441/FictionalLowToken00?enableSrtp"
RTSP_URL = "rtsp://viewer:Fictional-Passw0rd@192.0.2.31:554/stream1"
SECRETS = ("FictionalHighToken0", "FictionalLowToken00", "Fictional-Passw0rd", "192.0.2.20", "192.0.2.31")


def porch_cam(**over):
    return {"slug": "front", "name": "Front Door", "area_id": "porch", "source": "protect",
            "streams": {"high": PROTECT_HIGH, "low": PROTECT_LOW}, "protect_id": "65a0fictional0001",
            "speaker": True, "detections": ["person", "package", "ring"], **over}


def kitchen_cam(**over):
    return {"slug": "kitchen", "name": "Kitchen", "area_id": "kitchen", "source": "rtsp",
            "streams": {"high": RTSP_URL}, **over}


class Rig:
    def __init__(self, env, go2rtc):
        self.env, self.go2rtc = env, go2rtc
        self.app = env.app
        self.cams: D.DirectCameras | None = env.app.get("cameras_direct")

    async def socket(self, username, role, *, tunnel=False):
        await self.env.login(username, role, tunnel=tunnel)
        return await self.env.socket(expect_caps=False, tunnel=tunnel)

    async def ask(self, ws, rid, msg, kind="read"):
        await ws.send_json({"type": kind, "id": rid, "msg": msg})
        while True:
            m = await GF.recv(ws)
            if m.get("type") == "read_result" and m.get("id") == rid:
                return m

    async def offer(self, ws, rid, eid="camera.mantel_front"):
        """An offer that plays: its three events (session, answer, candidate) and every frame received."""
        await ws.send_json({"type": "read_subscribe", "id": rid,
                            "msg": {"type": "camera/webrtc/offer", "entity_id": eid, "offer": OFFER_SDP}})
        frames, events = [], []
        while len(events) < 3:
            m = await GF.recv(ws)
            frames.append(m)
            assert "error" not in m, m
            if m.get("type") == "read_event" and m.get("id") == rid:
                events.append(m["event"])
        return events, frames

    def state(self, eid):
        return self.app["hub"].store.states.get(eid)

    async def until(self, cond, what):
        for _ in range(150):
            if cond():
                return
            await asyncio.sleep(0.02)
        raise AssertionError(what)


@pytest.fixture
async def rig(tmp_path, monkeypatch):
    made = []

    async def make(*, go2rtc=True, live_tv=False):
        from datetime import datetime
        from mantel_server.config import Config
        from mantel_server.ha_client import HaClient
        from mantel_server.readproxy import ReadProxy
        from mantel_server.server import build_app
        from mantel_server.store import Store

        async def forbidden(*a, **k):
            pytest.fail("a direct camera test attempted to reach Home Assistant")
        monkeypatch.setattr(HaClient, "run", forbidden)
        monkeypatch.setattr(HaClient, "_send", forbidden)
        monkeypatch.setattr(ReadProxy, "request", forbidden)
        fake = FakeGo2rtc()
        g_srv = TestServer(fake.app())
        await g_srv.start_server()
        servers = [g_srv]
        cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0,
                     go2rtc_url=str(g_srv.make_url("")).rstrip("/") if go2rtc else "")
        store = Store(cfg.data_dir / "mantel.db")
        now = [1_000_000.0]
        app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: now[0])
        app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
        hub = app["hub"]
        hub.registry.load(GF.HOUSE_AREAS, [], GF.HOUSE_ENTITIES)
        hub.store.apply_event({"a": {k: dict(v) for k, v in GF.STATES.items()}})
        if live_tv:
            t_app = fake_tuner.make_app(None, guide=b'<?xml version="1.0"?><tv></tv>')
            t_srv = TestServer(t_app)
            await t_srv.start_server()
            servers.append(t_srv)
            tuner = f"127.0.0.1:{t_srv.port}"
            body = {"live_tv": {"enabled": True, "tuner": tuner, "guide_url": f"http://{tuner}/xmltv.xml",
                                "channels": ["4.1"], "names": {"4.1": "NBC"}}}
            app["settings"].store.write([("house", F.FEATURES_DOC, F.check_settings(body))], actor=Actor(label="test"))
            app["features"].hooks.now = lambda: datetime.fromisoformat("2026-10-18T16:00:00+00:00")
            app["live_tv"].tv_hooks = L.LiveTvHooks(tick=3600.0, stop_grace=0.05)
        if app.get("cameras_direct") is not None:
            app["cameras_direct"].cam_hooks = D.DirectHooks(tick=3600.0, stop_grace=0.05)
        client = TestClient(TestServer(app))
        await client.start_server()
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin
        env = GF.Env(Mantel(app, client, store, now, origin), None)
        r = Rig(env, fake)
        r.go2rtc_url = cfg.go2rtc_url
        if live_tv:
            await app["features"].tv.refresh()
            await app["live_tv"].sync()
        made.append((client, store, servers))
        return r
    yield make
    for client, store, servers in made:
        await client.close()
        for s in servers:
            await s.close()
        store.db.close()


def no_secrets(text):
    for s in SECRETS:
        assert s not in text, s


# ------------------------------------------------------------------------------------- pure pieces
def test_a_source_is_checked_and_its_urls_kept_apart():
    src, secret = D.check_source(porch_cam())
    assert src.entity_id == "camera.mantel_front" and src.low and not src.still
    assert src.detections == ("person", "package", "ring")
    # Protect's RTSPS becomes rtspx (no SRTP: go2rtc relays it untouched, the spike), without ?enableSrtp
    assert secret.high == "rtspx://192.0.2.20:7441/FictionalHighToken0"
    assert secret.low == "rtspx://192.0.2.20:7441/FictionalLowToken00"
    assert secret.kind == "camera-front"
    no_secrets(repr(secret) + json.dumps(src.public()))
    # an RTSP source keeps its URL as given (its credentials go to the sealed file only)
    assert D.check_source(kitchen_cam())[1].high == RTSP_URL
    assert D.protect_source(RTSP_URL) == RTSP_URL
    for bad, fld in (({"slug": "Front"}, "slug"), ({"slug": "x" * 41}, "slug"), ({"name": ""}, "name"),
                     ({"source": "ha"}, "source"), ({"area_id": "Porch!"}, "area_id"),
                     ({"detections": ["faces"]}, "detections"), ({"speaker": "yes"}, "speaker"),
                     ({"streams": {"high": "http://192.0.2.20/x"}}, "streams.high"),
                     ({"streams": {"high": "rtsp://192.0.2.20/x#exec:rm"}}, "streams.high"),
                     ({"streams": {"high": "rtsp://192.0.2.20/x y"}}, "streams.high"),
                     ({"streams": {"high": PROTECT_HIGH, "mid": PROTECT_LOW}}, "streams"),
                     ({"still": "file:///etc/passwd"}, "still"), ({"extra": 1}, "extra")):
        with pytest.raises(D.SourceError) as e:
            D.check_source(porch_cam(**bad))
        assert e.value.field == fld, (bad, e.value.field)
        no_secrets(str(e.value))
    with pytest.raises(D.SourceError):
        D.check_source(kitchen_cam(protect_id="abc"))         # a Protect id for a Protect source only
    assert D.stream_name("front") == "mantel_cam_front_high" and len(D.stream_name("x" * 40, "high")) <= 64


def test_both_overlays_keep_each_others_registry_entries():
    class Reg:
        def __init__(self):
            self.entity_entries = [{"entity_id": "light.kitchen"}]

        def update(self, entities):
            self.entity_entries = entities

    class Hub:
        registry = Reg()
        store = type("S", (), {"states": {}})()

    tv = L.LocalEntities(Hub)                                # Live TV's flag by default
    cams = L.LocalEntities(Hub, flag=D.FLAG)
    tv.registry = {"camera.tv_nbc": {"entity_id": "camera.tv_nbc", "mantel_live_tv": True}}
    cams.registry = {"camera.mantel_front": {"entity_id": "camera.mantel_front", D.FLAG: True}}
    for _ in range(2):                                       # each merging after the other, twice
        for ov in (tv, cams):
            merged = ov.merged_entities(Hub.registry.entity_entries)
            if merged is not None:
                Hub.registry.update(merged)
    ids = [e["entity_id"] for e in Hub.registry.entity_entries]
    assert sorted(ids) == ["camera.mantel_front", "camera.tv_nbc", "light.kitchen"]


# ------------------------------------------------------------------------------------- where it runs
async def test_under_the_ha_app_nothing_is_installed(rig):
    r = await rig(go2rtc=False)
    assert r.cams is None and "cameras_direct" not in r.app
    ws = await r.socket("owner1", "owner")
    got = await r.ask(ws, 1, {"type": "camera/webrtc/get_client_config", "entity_id": "camera.mantel_front"})
    assert got["error"]["code"] in ("unavailable", "forbidden", "not_found"), "the camera connector's path"
    assert r.go2rtc.calls == []
    r.env.m.forget_cookies()
    await r.env.login("owner1", "owner")
    assert (await r.env.m.get("/api/cameras/direct")).status == 404
    await ws.close()


# ------------------------------------------------------------------------------------- the registry
async def test_a_source_becomes_a_camera_entity_and_its_urls_stay_sealed(rig):
    r = await rig()
    got = await r.cams.put(porch_cam())
    assert got.entity_id == "camera.mantel_front"
    await r.cams.put(kitchen_cam())
    st = r.state("camera.mantel_front")
    assert st["s"] == "idle"
    assert st["a"] == {"friendly_name": "Front Door", "supported_features": 2, "frontend_stream_type": "web_rtc",
                       "mantel_source": "protect", "entity_picture": "/api/camera/camera.mantel_front/still"}
    reg = r.app["hub"].registry
    assert reg.entries["camera.mantel_front"]["area_id"] == "porch" and reg.entity_area["camera.mantel_kitchen"] == "kitchen"
    assert reg.entries["camera.mantel_front"]["platform"] == D.PLATFORM
    # the settings document has no URL, token or password; the sealed files have none in the clear
    doc = r.app["settings"].store.body("house", D.DOC)
    assert [c["slug"] for c in doc["cameras"]] == ["front", "kitchen"] and doc["cameras"][0]["low"] is True
    no_secrets(json.dumps(doc))
    folder = r.app["cfg"].connections_dir
    for slug in ("front", "kitchen"):
        raw = (folder / f"camera-{slug}.connection").read_bytes()
        assert all(s.encode() not in raw for s in SECRETS)
        assert oct((folder / f"camera-{slug}.connection").stat().st_mode & 0o777) == "0o600"
    # read again from the sealed file (a restart): the same URLs
    r.cams._secrets.clear()
    assert r.cams.secret("front").high == "rtspx://192.0.2.20:7441/FictionalHighToken0"
    # the page's own settings reads cannot name the document
    from mantel_server.settings_store import HOUSE_DOCS
    assert D.DOC not in HOUSE_DOCS
    # a change without streams keeps the camera's own; a new camera needs them
    await r.cams.put({k: v for k, v in porch_cam(name="Front Porch").items() if k != "streams"})
    assert r.state("camera.mantel_front")["a"]["friendly_name"] == "Front Porch" and r.cams.sources()[0].low
    with pytest.raises(D.SourceError):
        await r.cams.put({k: v for k, v in kitchen_cam(slug="new").items() if k != "streams"})
    # the status: Owner/Admin only, no URL
    await r.env.login("adult1", "adult")
    assert (await r.env.m.get("/api/cameras/direct")).status == 403
    await r.env.login("owner1", "owner")
    resp = await r.env.m.get("/api/cameras/direct")
    body = await resp.json()
    assert resp.status == 200 and [c["state"] for c in body["cameras"]] == ["ok", "ok"]
    text = json.dumps(body)
    no_secrets(text)
    assert r.go2rtc_url not in text
    # removed: entity, registry entry and sealed file go
    assert await r.cams.remove("kitchen") and not await r.cams.remove("kitchen")
    assert r.state("camera.mantel_kitchen") is None and "camera.mantel_kitchen" not in reg.entries
    assert not (folder / "camera-kitchen.connection").exists()


async def test_an_id_home_assistant_has_is_refused_and_named(rig):
    r = await rig()
    hub = r.app["hub"]
    hub.registry.update(entities=list(hub.registry.entity_entries) + [
        {"entity_id": "camera.mantel_garage", "platform": "generic", "original_name": "Garage", "area_id": "porch"}])
    with pytest.raises(D.CameraConflict) as e:
        await r.cams.put(kitchen_cam(slug="garage"))
    assert "camera.mantel_garage" in str(e.value) and "Garage" in str(e.value) and "generic" in str(e.value)
    # a state of HA's own (no registry entry) counts too
    hub.store.apply_event({"a": {"camera.mantel_side": {"s": "idle", "a": {"friendly_name": "Side Yard"}}}})
    with pytest.raises(D.CameraConflict) as e:
        await r.cams.put(kitchen_cam(slug="side"))
    assert "Side Yard" in str(e.value)
    assert r.cams.sources() == [] and not (r.app["cfg"].connections_dir / "camera-side.connection").exists()


async def test_when_home_assistant_gains_the_id_its_entity_wins(rig):
    r = await rig()
    hub = r.app["hub"]
    await r.cams.put(porch_cam())
    ws = await r.socket("owner1", "owner")
    await r.offer(ws, 1)
    # HA gains camera.mantel_front: its state stays, the direct camera is set aside and reported
    touched = hub.store.apply_event({"a": {"camera.mantel_front": {"s": "recording", "a": {"friendly_name": "HA's"}}}})
    hub.ha.on_change(touched)
    assert r.state("camera.mantel_front")["s"] == "recording"
    assert not r.cams.owns("camera.mantel_front") and "camera.mantel_front" not in hub.registry.entries
    await r.cams.tick()                                      # its sessions end
    assert r.cams.sessions == {}
    st = r.cams.status()["cameras"][0]
    assert st["state"] == "conflict" and st["conflict"] == "HA's"
    # signaling for that id goes to HA's camera path now, never go2rtc
    before = list(r.go2rtc.calls)
    got = await r.ask(ws, 2, {"type": "camera/webrtc/get_client_config", "entity_id": "camera.mantel_front"})
    assert got["error"]["code"] in ("unavailable", "forbidden", "not_found") and r.go2rtc.calls == before
    # HA's goes away: the direct camera is back
    hub.ha.on_change(hub.store.apply_event({"r": ["camera.mantel_front"]}))
    assert r.state("camera.mantel_front")["s"] == "idle" and r.cams.owns("camera.mantel_front")
    assert hub.registry.entries["camera.mantel_front"][D.FLAG] is True
    # a reconnect's replace_all (HA without it) and its registry load: put back
    touched = hub.store.replace_all({"a": {k: dict(v) for k, v in GF.STATES.items()}})
    hub.registry.update(entities=list(GF.HOUSE_ENTITIES))
    hub.ha.on_change(touched)
    assert r.state("camera.mantel_front")["s"] == "idle" and hub.registry.entity_area["camera.mantel_front"] == "porch"
    await ws.close()


async def test_the_overlay_lives_beside_live_tvs(rig):
    r = await rig(live_tv=True)
    hub = r.app["hub"]
    assert r.app["live_tv"].runs() and r.state("camera.tv_nbc") is not None
    await r.cams.put(porch_cam())
    await r.app["live_tv"].sync()
    for _ in range(2):
        r.cams.sync_states()
        r.app["live_tv"].sync_states()
    ents = hub.registry.entries
    assert ents["camera.tv_nbc"]["mantel_live_tv"] and ents["camera.mantel_front"][D.FLAG]
    # HA's registry reloaded (both overlays' entries gone), then its callback: both come back
    hub.registry.update(entities=list(GF.HOUSE_ENTITIES))
    hub.ha.on_registry()
    ents = hub.registry.entries
    assert "camera.tv_nbc" in ents and "camera.mantel_front" in ents and "light.kitchen" in ents
    # Live TV's channel offers still go to Live TV, the direct camera's to this module
    ws = await r.socket("owner1", "owner")
    await r.offer(ws, 1, "camera.tv_nbc")
    await r.offer(ws, 2, "camera.mantel_front")
    assert ("PATCH", "mantel_tv_4_1") in r.go2rtc.calls and ("PATCH", "mantel_cam_front_high") in r.go2rtc.calls
    # the cameras' reap leaves Live TV's streams alone
    await r.cams.reap()
    assert "mantel_tv_4_1" in r.go2rtc.streams
    await ws.close()


# ------------------------------------------------------------------------------------- the video
async def test_a_direct_camera_plays_through_go2rtc_and_stops_when_nobody_watches(rig):
    r = await rig()
    await r.cams.put(porch_cam())
    ws = await r.socket("owner1", "owner")
    cfg = await r.ask(ws, 1, {"type": "camera/webrtc/get_client_config", "entity_id": "camera.mantel_front"})
    assert cfg["result"]["configuration"]["iceServers"] == L.ICE_SERVERS
    events, frames = await r.offer(ws, 2)
    assert events[0]["type"] == "session" and len(events[0]["session_id"]) == 32
    assert events[1] == {"type": "answer", "answer": ANSWER}
    assert events[2] == {"type": "candidate", "candidate": {"candidate": CANDIDATE, "sdpMLineIndex": 0}}
    assert r.go2rtc.calls[-1] == ("PATCH", "mantel_cam_front_high")
    assert r.go2rtc.streams["mantel_cam_front_high"] == "rtspx://192.0.2.20:7441/FictionalHighToken0"
    assert r.go2rtc.offers == [("mantel_cam_front_high", OFFER_SDP)]
    gate = r.app["go2rtc_streams"]
    assert gate.kind_of("mantel_cam_front_high") == ("camera", "camera.mantel_front")
    sid = events[0]["session_id"]
    got = await r.ask(ws, 3, {"type": "camera/webrtc/candidate", "entity_id": "camera.mantel_front", "session_id": sid,
                              "candidate": {"candidate": "candidate:9 1 udp 1 192.0.2.77 5000 typ host",
                                            "sdpMid": "0", "sdpMLineIndex": 0}})
    assert got["result"] is None
    await r.until(lambda: r.go2rtc.candidates, "the candidate reached go2rtc")
    assert r.go2rtc.candidates == [("mantel_cam_front_high", "candidate:9 1 udp 1 192.0.2.77 5000 typ host")]
    no_secrets(json.dumps(frames))
    assert r.go2rtc_url not in json.dumps(frames)
    await ws.send_json({"type": "read_unsubscribe", "id": 2})
    await r.until(lambda: ("DELETE", "mantel_cam_front_high") in r.go2rtc.calls, "the stream was removed")
    assert r.cams.sessions == {} and r.cams.streams == {} and gate.kind_of("mantel_cam_front_high") is None
    assert r.env.audit() == [], "watching a camera is not a command"
    await ws.close()


async def test_candidates_go_only_into_your_own_session_and_the_caps_hold(rig, monkeypatch):
    r = await rig()
    await r.cams.put(porch_cam())
    await r.cams.put(kitchen_cam())
    a = await r.socket("owner1", "owner")
    events, _ = await r.offer(a, 1)
    sid = events[0]["session_id"]
    b = await r.socket("adult1", "adult")
    cand = {"type": "camera/webrtc/candidate", "entity_id": "camera.mantel_front", "session_id": sid,
            "candidate": "candidate:1 1 udp 1 192.0.2.1 1 typ host"}
    assert (await r.ask(b, 2, cand))["error"]["code"] == "forbidden"
    assert (await r.ask(b, 3, {**cand, "entity_id": "camera.mantel_kitchen"}))["error"]["code"] == "forbidden"
    bad = await r.ask(b, 4, {"type": "camera/webrtc/offer", "entity_id": "camera.mantel_front", "offer": "not sdp"},
                      kind="read_subscribe")
    assert bad["error"]["code"] == "not_allowed"
    assert r.go2rtc.candidates == []
    # the caps: per socket, then every socket together
    monkeypatch.setattr(D, "MAX_SESSIONS_PER_SOCKET", 2)
    await r.offer(b, 5)
    await r.offer(b, 6, "camera.mantel_kitchen")
    over = await r.ask(b, 7, {"type": "camera/webrtc/offer", "entity_id": "camera.mantel_front", "offer": OFFER_SDP},
                       kind="read_subscribe")
    assert over["error"]["code"] == "forbidden" and len(r.cams.sessions) == 3
    monkeypatch.setattr(D, "MAX_SESSIONS_PER_SOCKET", 16)
    monkeypatch.setattr(D, "MAX_SESSIONS", 3)
    over = await r.ask(a, 8, {"type": "camera/webrtc/offer", "entity_id": "camera.mantel_front", "offer": OFFER_SDP},
                       kind="read_subscribe")
    assert over["error"]["code"] == "forbidden" and len(r.cams.sessions) == 3
    await a.close()
    await b.close()


async def test_go2rtc_unavailable_is_the_pages_error(rig):
    r = await rig()
    await r.cams.put(porch_cam())
    r.go2rtc.fail_patch = True
    ws = await r.socket("owner1", "owner")
    got = await r.ask(ws, 1, {"type": "camera/webrtc/offer", "entity_id": "camera.mantel_front", "offer": OFFER_SDP},
                      kind="read_subscribe")
    assert got["error"]["code"] == "unavailable" and r.cams.sessions == {}
    no_secrets(json.dumps(r.cams.status()))
    await ws.close()


async def test_streams_nobody_uses_are_reaped(rig):
    r = await rig()
    await r.cams.put(kitchen_cam())
    r.go2rtc.streams.update({"mantel_cam_gone_high": "rtsp://192.0.2.99/x", "someone_elses": "rtsp://192.0.2.98/y"})
    await r.cams.tick()
    assert "mantel_cam_gone_high" not in r.go2rtc.streams and "someone_elses" in r.go2rtc.streams


# ------------------------------------------------------------------------------------- RBAC
async def test_area_grants_decide_a_direct_camera_as_an_ha_camera(rig):
    r = await rig()
    await r.cams.put(porch_cam())
    await r.cams.put(kitchen_cam())
    # Adults may see only the porch: view + live view by area, as an Owner would grant for HA's cameras
    r.app["rbac"].set_override("adult", {"grants": [
        {"effect": "allow", "actions": ["view", "control", "control.sensitive"], "resource_kind": "area",
         "resource": "porch"}]})
    authz = r.app["authz"]
    await r.env.login("adult1", "adult")
    ws = await r.env.socket(expect_caps=False)
    p = next(e.principal for e in r.app["live"]._entries if not e.closed)
    assert authz.may_view(p, "camera.mantel_front") is True and authz.may_view(p, "camera.doorbell") is True
    assert authz.may_view(p, "camera.mantel_kitchen") is False
    # the still route and the signaling agree
    assert (await r.env.m.get("/api/camera/camera.mantel_front/still")).status == 200
    assert (await r.env.m.get("/api/camera/camera.mantel_kitchen/still")).status == 403
    calls = list(r.go2rtc.calls)
    for rid, t in enumerate(("camera/webrtc/get_client_config", "camera/webrtc/offer"), 1):
        msg = {"type": t, "entity_id": "camera.mantel_kitchen", **({"offer": OFFER_SDP} if t.endswith("offer") else {})}
        got = await r.ask(ws, rid, msg, kind="read_subscribe" if t.endswith("offer") else "read")
        assert got["error"]["code"] == "forbidden"
    assert r.go2rtc.calls == calls, "nothing reached go2rtc for a camera the subject may not view"
    await r.offer(ws, 9)                                      # the porch one plays
    # a deny on the entity wins over the area grant, and ends the open session at the policy tick
    r.app["rbac"].add_grant(Grant(effect="deny", actions=("view",), resource_kind="entity",
                                  resource="camera.mantel_front", roles={"adult"}))
    assert authz.may_view(p, "camera.mantel_front") is False
    assert (await r.env.m.get("/api/camera/camera.mantel_front/still")).status == 403
    await r.app["live"].check(why="policy_tick")
    await r.until(lambda: r.cams.sessions == {}, "the denied session ended")
    await ws.close()


async def test_children_guests_and_the_tunnel_are_refused_as_for_ha_cameras(rig):
    r = await rig()
    await r.cams.put(porch_cam())
    for user, role in (("kid1", "child"), ("guest1", "guest")):
        ws = await r.socket(user, role)
        got = await r.ask(ws, 1, {"type": "camera/webrtc/offer", "entity_id": "camera.mantel_front", "offer": OFFER_SDP},
                          kind="read_subscribe")
        assert got["error"]["code"] == "forbidden", role
        assert (await r.env.m.get("/api/camera/camera.mantel_front/still")).status == 403
        assert (await r.env.m.get("/api/camera/camera.doorbell/still")).status == 403, "the same as HA's"
        await ws.close()
    assert r.go2rtc.calls == [], "nothing reached go2rtc"
    # Cameras from Outside off for Adults: the tunnel refuses a direct camera as it does HA's
    from mantel_server.accounts import totp
    m = r.env.m
    await r.env.login("adult1", "adult")
    seed = await r.env.enroll_totp()
    m.forget_cookies()
    r.env.now[0] += 60
    _, body = await m.sign_in("adult1", tunnel=True)
    resp = await m.post("/api/auth/totp/verify", {"pending": body["pending"], "code": totp(seed, r.env.now[0])},
                        csrf=False, tunnel=True)
    assert resp.status == 200
    ws = await r.env.socket(expect_caps=False, tunnel=True)
    assert (await m.get("/api/camera/camera.mantel_front/still", tunnel=True)).status == 200
    got = await r.ask(ws, 1, {"type": "camera/webrtc/get_client_config", "entity_id": "camera.mantel_front"})
    assert "result" in got, got
    r.app["rbac"].set_override("adult", {"tunnel_cameras": False})
    for eid in ("camera.mantel_front", "camera.doorbell"):
        assert (await m.get(f"/api/camera/{eid}/still", tunnel=True)).status == 403, eid
    got = await r.ask(ws, 2, {"type": "camera/webrtc/get_client_config", "entity_id": "camera.mantel_front"})
    assert got["error"]["code"] == "forbidden"
    await ws.close()


# ------------------------------------------------------------------------------------- stills
async def test_a_direct_cameras_still_comes_from_go2rtc_and_is_shared(rig):
    r = await rig()
    await r.cams.put(porch_cam())
    await r.cams.put(kitchen_cam())
    await r.env.login("owner1", "owner")
    resp = await r.env.m.get("/api/camera/camera.mantel_front/still?width=640&height=480")
    assert resp.status == 200 and await resp.read() == FRAME
    assert resp.headers["Content-Type"] == "image/jpeg" and resp.headers["Cache-Control"] == "no-store"
    # from the low stream, scaled by go2rtc; the stream removed after the grace
    assert r.go2rtc.frames == [{"src": "mantel_cam_front_low", "width": "640", "height": "480"}]
    await r.until(lambda: ("DELETE", "mantel_cam_front_low") in r.go2rtc.calls, "the still's stream was removed")
    # shared: a second tablet within STILL_SHARE costs nothing more
    assert (await r.env.m.get("/api/camera/camera.mantel_front/still?width=640&height=480")).status == 200
    assert len(r.go2rtc.frames) == 1
    # no low stream: the high one
    assert (await r.env.m.get("/api/camera/camera.mantel_kitchen/still")).status == 200
    assert r.go2rtc.frames[-1] == {"src": "mantel_cam_kitchen_high"}
    # phase 4's hook: a Protect source's provider answers instead
    asked = []

    async def protect_snapshot(src, width, height):
        asked.append((src.slug, src.protect_id, width, height))
        return b"\xff\xd8protect\xff\xd9", "image/jpeg"
    r.cams.set_still_provider("protect", protect_snapshot)
    resp = await r.env.m.get("/api/camera/camera.mantel_front/still?width=1920&height=1080")
    assert await resp.read() == b"\xff\xd8protect\xff\xd9" and asked == [("front", "65a0fictional0001", 1920, 1080)]
    # go2rtc has no frame: the page's usual error, no URL
    r.cams.set_still_provider("protect", None)
    r.go2rtc.frames.clear()
    r.app["camera_still_share"]._done.clear()
    r.go2rtc.fail_patch = True
    resp = await r.env.m.get("/api/camera/camera.mantel_front/still")
    assert resp.status == 502 and (await resp.json())["error"] == "camera_unavailable"
