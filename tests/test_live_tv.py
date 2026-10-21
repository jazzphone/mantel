"""Live TV served by Mantel (mantel_server/live_tv.py; docs/phase4/FEATURE-PARITY.md "Live TV served by
Mantel"): where Mantel has its own go2rtc it answers HK's channel list, owns the channel cameras and
"now playing" sensors (an overlay with HA's entity ids), sets each channel up in go2rtc on demand,
relays the WebRTC signaling, stops streams nobody watches, and counts the viewers (sensor.tv_viewers,
and linked HA's). Where it does not (the HA App), the interim is unchanged. A fake go2rtc and a fake
tuner on 127.0.0.1, a fictional house; house commands stay off throughout."""
import asyncio
import json
import sys
from pathlib import Path

import pytest
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

import gateway_fakes as GF
from conftest import Mantel
from live_tv_fakes import ANSWER, CANDIDATE, FakeGo2rtc
from mantel_server import features as F
from mantel_server import live_tv as L
from mantel_server.settings_store import Actor

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools/e2e"))
import fake_tuner  # noqa: E402

XMLTV = b"""<?xml version="1.0"?><tv>
<channel id="c1"><display-name>4.1</display-name><display-name>NATIONAL BROADCASTING COMPANY</display-name>
<icon src="https://img.example.invalid/nbc.png"/></channel>
<channel id="c2"><display-name>7.1</display-name></channel>
<programme channel="c1" start="20261018150000 +0000" stop="20261018170000 +0000"><title>The Fictional Hour</title>
<sub-title>Part One</sub-title></programme>
<programme channel="c1" start="20261018170000 +0000" stop="20261018180000 +0000"><title>Made-up News</title></programme>
</tv>"""
OFFER_SDP = "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 102\r\na=recvonly\r\n"
NOW_UTC = "2026-10-18T16:00:00+00:00"
ITEM = "01JLIVETV000000000000000AA"


def live_settings(tuner, **tv):
    return {"live_tv": {"enabled": True, "tuner": tuner, "guide_url": f"http://{tuner}/xmltv.xml",
                        "channels": ["4.1", "7.1"], "names": {"4.1": "NBC"}, **tv},
            "ha": {"added": ["live_tv"], "items": {"live_tv": [{"entry_id": ITEM, "title": "Live TV"}]}, "source": "ha"}}


class Rig:
    """A full app (commands off) with a fake go2rtc and a fake tuner, and helpers to talk to it."""

    def __init__(self, env, go2rtc, tuner, tv):
        self.env, self.go2rtc, self.tuner, self.tv = env, go2rtc, tuner, tv
        self.app = env.app

    async def socket(self, username, role):
        await self.env.login(username, role)
        return await self.env.socket(expect_caps=False)

    async def ask(self, ws, rid, msg, kind="read"):
        await ws.send_json({"type": kind, "id": rid, "msg": msg})
        while True:
            m = await GF.recv(ws)
            if m.get("type") == "read_result" and m.get("id") == rid:
                return m

    def state(self, eid):
        return self.app["hub"].store.states.get(eid)


@pytest.fixture
async def rig(tmp_path, monkeypatch):
    made = []

    async def make(*, go2rtc=True, settings=None, linked=False, tick=3600.0):
        from datetime import datetime
        from mantel_server.config import Config
        from mantel_server.ha_client import HaClient
        from mantel_server.readproxy import ReadProxy
        from mantel_server.server import build_app
        from mantel_server.store import Store

        async def forbidden(*a, **k):
            pytest.fail("a Live TV test attempted to reach Home Assistant")
        monkeypatch.setattr(HaClient, "run", forbidden)
        monkeypatch.setattr(HaClient, "_send", forbidden)
        monkeypatch.setattr(ReadProxy, "request", forbidden)
        fake = FakeGo2rtc()
        g_srv = TestServer(fake.app())
        await g_srv.start_server()
        t_app = fake_tuner.make_app(None, guide=XMLTV)
        t_srv = TestServer(t_app)
        await t_srv.start_server()
        tuner = f"127.0.0.1:{t_srv.port}"
        cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0,
                     go2rtc_url=str(g_srv.make_url("")).rstrip("/") if go2rtc else "")
        store = Store(cfg.data_dir / "mantel.db")
        now = [1_000_000.0]
        app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: now[0])
        app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
        hub = app["hub"]
        hub.registry.load(GF.HOUSE_AREAS, [], GF.HOUSE_ENTITIES)
        hub.store.apply_event({"a": {k: dict(v) for k, v in GF.STATES.items()}})
        body = settings if settings is not None else live_settings(tuner)
        if linked:
            body = {**body, "linked": {"enabled": True, "entry_id": "e2e0entry0id"}}
        app["settings"].store.write([("house", F.FEATURES_DOC, F.check_settings(body))], actor=Actor(label="test"))
        app["features"].hooks.now = lambda: datetime.fromisoformat(NOW_UTC)
        tv = app["live_tv"]
        mono = [100.0]
        tv.tv_hooks = L.LiveTvHooks(monotonic=lambda: mono[0], tick=tick, stop_grace=0.05)
        client = TestClient(TestServer(app))
        await client.start_server()
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin
        env = GF.Env(Mantel(app, client, store, now, origin), None)
        r = Rig(env, fake, t_app, tv)
        r.mono, r.tuner_addr, r.go2rtc_url = mono, tuner, cfg.go2rtc_url
        made.append((client, store, g_srv, t_srv))
        if tv.runs():
            await app["features"].tv.refresh()
            await tv.sync()
        return r
    yield make
    for client, store, g_srv, t_srv in made:
        await client.close()
        await g_srv.close()
        await t_srv.close()
        store.db.close()


# ------------------------------------------------------------------------------------- pure pieces
def test_the_slug_and_entity_ids_are_has():
    # hosts/ha/.../features/live_tv/__init__.py slug, copied: Mantel's ids must equal HA's for the same name
    def ha_slug(name):
        return "".join(c if c.isalnum() else "_" for c in name.lower()).strip("_") or "channel"
    for name in ("NBC", "WXXX-DT", "CBS 2.1", "  ", "Télé Québec", "ABC  News"):
        assert L.slug(name) == ha_slug(name)
    assert L.entity_ids("WXXX-DT") == {"camera": "camera.tv_wxxx_dt", "now": "sensor.tv_wxxx_dt_now"}
    assert L.stream_name("4.1") == "mantel_tv_4_1"


def test_the_stream_url_can_only_name_the_tuner():
    assert L.stream_url("192.0.2.40", "4.1") == "http://192.0.2.40:5004/auto/v4.1"
    assert L.stream_url("http://192.0.2.40/lineup.json", "4.1") == "http://192.0.2.40:5004/auto/v4.1"
    assert L.stream_url("192.0.2.40:8080", "4.1", "http://192.0.2.40:5004/auto/v4.1") == "http://192.0.2.40:5004/auto/v4.1"
    # the lineup's own URL is used only when it is a plain stream URL on the same tuner
    for bad in ("http://192.0.2.99:5004/auto/v4.1", "http://192.0.2.40:5004/auto/v4.1#raw=-f",
                "http://192.0.2.40:5004/auto/v7.1", "rtsp://192.0.2.40/auto/v4.1", "http://192.0.2.40/x?y"):
        assert L.stream_url("192.0.2.40", "4.1", bad) == "http://192.0.2.40:5004/auto/v4.1"
    assert L.stream_url("", "4.1") is None and L.stream_url("192.0.2.40", "../x") is None
    assert L.go2rtc_source("http://t:5004/auto/v4.1") == \
        "ffmpeg:http://t:5004/auto/v4.1#input=mantel_tv_in#video=mantel_tv_720#audio=opus"
    assert L.go2rtc_source("http://t:5004/auto/v4.1", "1080", "vaapi") == \
        "ffmpeg:http://t:5004/auto/v4.1#input=mantel_tv_in_vaapi#video=mantel_tv_1080_vaapi#audio=opus"
    assert L.go2rtc_source("u", "4k", "cuda").endswith("#video=mantel_tv_720#audio=opus")


def test_the_go2rtc_templates_mantel_names_exist():
    yaml = (Path(__file__).resolve().parent.parent / "packaging/compose/go2rtc/go2rtc.yaml").read_text()
    for t in ("mantel_tv_in", "mantel_tv_720", "mantel_tv_1080", "mantel_tv_in_vaapi", "mantel_tv_720_vaapi",
              "mantel_tv_1080_vaapi"):
        assert f"\n  {t}: " in yaml, t
    assert 'listen: "127.0.0.1:8554"' in yaml, "the ffmpeg source needs go2rtc's RTSP, on loopback only"
    assert "deinterlace_vaapi" in yaml and "h264_vaapi" in yaml          # Proof 4's pipeline


def test_viewers_expire_like_has():
    v = L.Viewers()
    assert v.set("device:k", {"name": "Kitchen", "person": None, "screen": "Kitchen"}, "4.1", 0.0)
    assert not v.set("device:k", {"name": "Kitchen", "person": None, "screen": "Kitchen"}, "4.1", 60.0)
    assert v.set("user:u1", {"name": "Jo", "person": "Jo", "screen": None}, "7.1", 100.0)
    assert v.names(100.0) == ["Jo", "Kitchen"]
    assert v.names(211.0) == ["Jo"] and v.prune(211.0)
    assert v.set("user:u1", {}, None, 212.0) and v.names(212.0) == []


def test_config_and_entrypoint_take_the_go2rtc_address():
    from mantel_server.config import parse_args
    cfg = parse_args(["--go2rtc-url", "http://go2rtc:1984/", "--live-tv-hardware", "vaapi"])
    assert (cfg.go2rtc_url, cfg.live_tv_hardware) == ("http://go2rtc:1984", "vaapi")
    assert parse_args([]).go2rtc_url == "" and parse_args([]).live_tv_hardware == ""
    for bad in ("go2rtc:1984", "ftp://go2rtc", "http://go2rtc:1984/api", "http://u:p@go2rtc:1984"):
        with pytest.raises(SystemExit):
            parse_args(["--go2rtc-url", bad])
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "packaging/docker"))
    import entrypoint
    env = {"MANTEL_HA_URL": "http://ha:8123", "MANTEL_PUBLIC_URL": "https://m.example/",
           "MANTEL_GO2RTC_URL": "http://go2rtc:1984", "MANTEL_LIVE_TV_HARDWARE": "vaapi"}
    args = entrypoint.container_args(env)
    assert args[args.index("--go2rtc-url") + 1] == "http://go2rtc:1984"
    assert args[args.index("--live-tv-hardware") + 1] == "vaapi"
    assert "--go2rtc-url" not in entrypoint.container_args({k: env[k] for k in ("MANTEL_HA_URL", "MANTEL_PUBLIC_URL")})
    with pytest.raises(entrypoint.ConfigError):
        entrypoint.container_args({**env, "MANTEL_LIVE_TV_HARDWARE": "cuda"})
    # the HA App never runs it (the interim: docs/phase4/FEATURE-PARITY.md)
    assert "--go2rtc-url" not in entrypoint.app_args({}, Path("/tmp/t"), {"MANTEL_GO2RTC_URL": "http://x:1984"})


async def test_the_import_turns_live_tv_on_only_where_mantel_runs_it():
    async def read(msg):
        return {"configured": True, "host": "192.0.2.40", "guide_url": "", "quality": "1080",
                "channels": [{"number": "4.1", "name": "NBC"}]}
    panel = {"features": {"hk_tv": {"kind": "live_tv", "entries": [{"entry_id": ITEM, "title": "Live TV"}]}}}
    off = await F.import_features(panel, read)
    on = await F.import_features(panel, read, live_tv_on=True)
    assert off["live_tv"]["enabled"] is False and on["live_tv"]["enabled"] is True
    assert on["live_tv"]["quality"] == "1080"
    with pytest.raises(ValueError):
        F.check_settings({"live_tv": {"quality": "4k"}})


# ------------------------------------------------------------------------------------- the interim
async def test_without_go2rtc_the_interim_is_unchanged(rig):
    r = await rig(go2rtc=False)
    assert r.tv.mode() == "ha" and not r.tv.runs()
    ws = await r.socket("owner1", "owner")
    got = await r.ask(ws, 1, {"type": "hk_tv/channels"})
    # forwarded to HA's Live TV exactly as before (no HA connection in this test: unavailable)
    assert got["error"]["code"] == "unavailable"
    await ws.send_json({"type": "tv_watching", "id": 2, "channel": "4.1"})
    m = await GF.recv(ws)
    assert m == {"type": "tv_watching_result", "id": 2, "result": {"viewers": ["Owner1"], "ha": True}}
    assert r.state(L.VIEWERS_ID) is None and r.state("camera.tv_nbc") is None, "HA keeps its own entities"
    assert r.tv.viewers.names(r.mono[0]) == ["Owner1"], "Mantel counts it all the same"
    await ws.close()


# ------------------------------------------------------------------------------------- served by Mantel
async def test_the_channels_and_their_entities(rig):
    r = await rig()
    assert r.tv.mode() == "mantel"
    ws = await r.socket("owner1", "owner")
    got = (await r.ask(ws, 1, {"type": "hk_tv/channels"}))["result"]
    assert got == {"configured": True, "channels": [
        {"number": "4.1", "name": "NBC", "camera": "camera.tv_nbc", "now": "sensor.tv_nbc_now"},
        {"number": "7.1", "name": "WFAK-DT", "camera": "camera.tv_wfak_dt", "now": "sensor.tv_wfak_dt_now"}]}
    now = r.state("sensor.tv_nbc_now")
    assert now["s"] == "The Fictional Hour"
    assert now["a"]["subtitle"] == "Part One" and now["a"]["next_title"] == "Made-up News"
    assert now["a"]["network"] == "NBC" and now["a"]["camera"] == "camera.tv_nbc"
    assert r.state("sensor.tv_wfak_dt_now")["s"] == "Live"
    cam = r.state("camera.tv_nbc")
    assert cam["s"] == "idle" and cam["a"]["channel"] == "4.1" and "entity_picture" not in cam["a"]
    assert r.state(L.VIEWERS_ID)["s"] == 0
    reg = r.app["hub"].registry.entries
    assert reg["camera.tv_nbc"]["platform"] == "hk_frontend", "HK's Cameras page leaves channel cameras out"
    # what a page receives carries no tuner or go2rtc address
    await ws.send_json({"type": "subscribe", "entity_ids": ["camera.tv_nbc", "sensor.tv_nbc_now", L.VIEWERS_ID]})
    snap = await GF.recv(ws)
    assert set(snap["entities"]) == {"camera.tv_nbc", "sensor.tv_nbc_now", L.VIEWERS_ID}
    text = json.dumps([got, snap])
    assert r.tuner_addr not in text and r.go2rtc_url not in text and "5004" not in text
    await ws.close()


async def test_the_channel_list_and_streams_follow_rbac(rig):
    r = await rig()
    ws = await r.socket("guest1", "guest")
    assert (await r.ask(ws, 1, {"type": "hk_tv/channels"}))["result"] == {"configured": True, "channels": []}
    got = await r.ask(ws, 2, {"type": "camera/webrtc/offer", "entity_id": "camera.tv_nbc", "offer": OFFER_SDP},
                      kind="read_subscribe")
    assert got["error"]["code"] == "forbidden"
    await ws.send_json({"type": "tv_watching", "id": 3, "channel": "4.1"})
    assert (await GF.recv(ws))["error"] == {"code": "forbidden"}
    assert r.go2rtc.calls == [] and r.go2rtc.offers == []
    await ws.close()
    # a child has no Live TV feature either; the wall tablets' grant is a house grant
    from mantel_server.authz import HOUSE_GRANTS
    assert any(g.resource == "live_tv" and set(g.roles) == {"wall_tablet"} and set(g.actions) == {"view"}
               for g in HOUSE_GRANTS)
    ws = await r.socket("kid1", "child")
    assert (await r.ask(ws, 4, {"type": "hk_tv/channels"}))["result"]["channels"] == []
    await ws.close()


async def test_a_channel_plays_through_go2rtc_and_stops_when_nobody_watches(rig):
    r = await rig()
    ws = await r.socket("owner1", "owner")
    cfg = await r.ask(ws, 1, {"type": "camera/webrtc/get_client_config", "entity_id": "camera.tv_nbc"})
    assert cfg["result"]["configuration"]["iceServers"] == L.ICE_SERVERS
    await ws.send_json({"type": "read_subscribe", "id": 2,
                        "msg": {"type": "camera/webrtc/offer", "entity_id": "camera.tv_nbc", "offer": OFFER_SDP}})
    frames, events = [], []
    while len(events) < 3:
        m = await GF.recv(ws)
        frames.append(m)
        if m.get("type") == "read_event" and m.get("id") == 2:
            events.append(m["event"])
        assert "error" not in m, m
    assert events[0]["type"] == "session" and len(events[0]["session_id"]) == 32
    assert events[1] == {"type": "answer", "answer": ANSWER}
    assert events[2] == {"type": "candidate", "candidate": {"candidate": CANDIDATE, "sdpMLineIndex": 0}}
    # the channel was set up in go2rtc on demand, from the tuner's lineup URL, with Mantel's templates
    assert r.go2rtc.calls == [("PATCH", "mantel_tv_4_1")]
    assert r.go2rtc.streams["mantel_tv_4_1"] == \
        f"ffmpeg:http://{r.tuner_addr}/auto/v4.1#input=mantel_tv_in#video=mantel_tv_720#audio=opus"
    assert r.go2rtc.offers == [("mantel_tv_4_1", OFFER_SDP)]
    # registered with media_proxy's /go2rtc/ gate while it is set up (as a Live TV stream of its camera)
    gate = r.tv.app["go2rtc_streams"]
    assert gate.kind_of("mantel_tv_4_1") == ("live_tv", "camera.tv_nbc")
    sid = events[0]["session_id"]
    got = await r.ask(ws, 3, {"type": "camera/webrtc/candidate", "entity_id": "camera.tv_nbc", "session_id": sid,
                              "candidate": {"candidate": "candidate:9 1 udp 1 192.0.2.77 5000 typ host",
                                            "sdpMid": "0", "sdpMLineIndex": 0}})
    assert got["result"] is None
    await asyncio.sleep(0.05)
    assert r.go2rtc.candidates == [("mantel_tv_4_1", "candidate:9 1 udp 1 192.0.2.77 5000 typ host")]
    # nothing the page received names the tuner or go2rtc's API
    text = json.dumps(frames)
    assert r.tuner_addr not in text and r.go2rtc_url not in text
    st = r.tv.status()
    assert st["sessions"][0]["channel"] == "4.1" and st["streams"] == ["4.1"]
    assert r.tuner_addr not in json.dumps(st) and r.go2rtc_url not in json.dumps(st)
    # the player closes: the session ends, and after the grace go2rtc's stream is removed
    await ws.send_json({"type": "read_unsubscribe", "id": 2})
    for _ in range(100):
        if ("DELETE", "mantel_tv_4_1") in r.go2rtc.calls:
            break
        await asyncio.sleep(0.02)
    assert ("DELETE", "mantel_tv_4_1") in r.go2rtc.calls and r.go2rtc.streams == {}
    assert r.tv.sessions == {} and r.tv.streams == {}
    assert gate.kind_of("mantel_tv_4_1") is None, "dropped from the /go2rtc/ gate with the stream"
    assert r.go2rtc.open.get("mantel_tv_4_1") == 0, "the go2rtc socket was closed"
    assert r.env.audit() == [], "watching TV is not a command"
    await ws.close()


async def test_a_quick_retune_keeps_the_stream(rig):
    r = await rig()
    ws = await r.socket("owner1", "owner")
    for rid in (1, 2):
        await ws.send_json({"type": "read_subscribe", "id": rid,
                            "msg": {"type": "camera/webrtc/offer", "entity_id": "camera.tv_nbc", "offer": OFFER_SDP}})
        await GF.recv(ws)
    await ws.send_json({"type": "read_unsubscribe", "id": 1})
    await asyncio.sleep(0.2)
    assert ("DELETE", "mantel_tv_4_1") not in r.go2rtc.calls, "another session still watches it"
    await ws.close()                   # the socket goes: its sessions end with it
    for _ in range(100):
        if ("DELETE", "mantel_tv_4_1") in r.go2rtc.calls:
            break
        await asyncio.sleep(0.02)
    assert ("DELETE", "mantel_tv_4_1") in r.go2rtc.calls


async def test_candidates_go_only_into_your_own_session(rig):
    r = await rig()
    a = await r.socket("owner1", "owner")
    await a.send_json({"type": "read_subscribe", "id": 1,
                       "msg": {"type": "camera/webrtc/offer", "entity_id": "camera.tv_nbc", "offer": OFFER_SDP}})
    sid = None
    while sid is None:
        m = await GF.recv(a)
        if m.get("type") == "read_event":
            sid = m["event"]["session_id"]
    b = await r.socket("adult1", "adult")
    cand = {"type": "camera/webrtc/candidate", "entity_id": "camera.tv_nbc", "session_id": sid,
            "candidate": "candidate:1 1 udp 1 192.0.2.1 1 typ host"}
    assert (await r.ask(b, 2, cand))["error"]["code"] == "forbidden"
    assert (await r.ask(b, 3, {**cand, "entity_id": "camera.tv_wfak_dt"}))["error"]["code"] == "forbidden"
    bad = await r.ask(b, 4, {"type": "camera/webrtc/offer", "entity_id": "camera.tv_nbc", "offer": "not sdp"},
                      kind="read_subscribe")
    assert bad["error"]["code"] == "not_allowed"
    extra = await r.ask(b, 5, {"type": "camera/webrtc/get_client_config", "entity_id": "camera.tv_nbc", "x": 1})
    assert extra["error"]["code"] == "not_allowed"
    assert r.go2rtc.candidates == []
    await a.close()
    await b.close()


async def test_other_cameras_still_go_to_the_camera_connector(rig):
    r = await rig()
    ws = await r.socket("owner1", "owner")
    got = await r.ask(ws, 1, {"type": "camera/webrtc/get_client_config", "entity_id": "camera.front_door"})
    # the camera connector's path (no HA signaling connection in this test), never go2rtc
    assert got["error"]["code"] in ("unavailable", "forbidden", "not_found")
    assert r.go2rtc.calls == []
    await ws.close()


async def test_go2rtc_unavailable_is_the_pages_error_not_the_servers(rig):
    r = await rig()
    r.go2rtc.fail_patch = True
    ws = await r.socket("owner1", "owner")
    got = await r.ask(ws, 1, {"type": "camera/webrtc/offer", "entity_id": "camera.tv_nbc", "offer": OFFER_SDP},
                      kind="read_subscribe")
    assert got["error"]["code"] == "unavailable" and r.tv.sessions == {}
    assert "refused" in (r.tv.status()["error"] or "")
    await ws.close()


async def test_the_viewers_sensor_counts_screens_and_people(rig):
    r = await rig()
    ws = await r.socket("owner1", "owner")
    await ws.send_json({"type": "tv_watching", "id": 1, "channel": "4.1"})
    assert (await GF.recv(ws))["result"] == {"viewers": ["Owner1"], "ha": False}
    v = r.state(L.VIEWERS_ID)
    assert v["s"] == 1 and v["a"]["users"] == ["Owner1"] and v["a"]["channels"] == ["4.1"]
    for bad, code in (({"channel": "../x"}, "invalid"), ({"channel": "9.9"}, "not_found"),
                      ({"channel": "4.1", "x": 1}, "invalid")):
        await ws.send_json({"type": "tv_watching", "id": 2, **bad})
        assert (await GF.recv(ws))["error"] == {"code": code}
    ws2 = await r.socket("adult1", "adult")
    await ws2.send_json({"type": "tv_watching", "id": 3, "channel": "7.1"})
    assert (await GF.recv(ws2))["result"]["viewers"] == ["Adult1", "Owner1"]
    assert r.state(L.VIEWERS_ID)["s"] == 2 and r.state(L.VIEWERS_ID)["a"]["channels"] == ["4.1", "7.1"]
    # stopped: null; a screen that stops sending heartbeats stops counting after HA's 150 s
    await ws2.send_json({"type": "tv_watching", "id": 4, "channel": None})
    assert (await GF.recv(ws2))["result"]["viewers"] == ["Owner1"]
    r.mono[0] += L.VIEWER_TTL_S + 1
    await r.tv.tick()
    assert r.state(L.VIEWERS_ID)["s"] == 0 and r.state(L.VIEWERS_ID)["a"]["users"] == []
    assert r.env.audit() == []
    await ws.close()
    await ws2.close()


async def test_linked_mode_publishes_has_live_tv_entities(rig):
    # linked_house.py is the one publisher of hk_frontend's Live TV entities (the ids it learns from HA's
    # registry); where Mantel serves Live TV they carry its viewer count and are available
    r = await rig(linked=True)
    entry = "e2e0entry0id"
    hub = r.app["hub"]
    hub.registry.update(entities=list(hub.registry.entity_entries) + [
        {"entity_id": "sensor.tv_viewers", "platform": "hk_frontend", "unique_id": f"{ITEM}_viewers",
         "config_entry_id": entry, "original_name": "TV viewers"},
        {"entity_id": "sensor.tv_nbc_now", "platform": "hk_frontend", "unique_id": f"{ITEM}_4.1_now",
         "config_entry_id": entry, "original_name": "TV NBC now"},
        {"entity_id": "camera.tv_nbc", "platform": "hk_frontend", "unique_id": f"{ITEM}_4.1_camera",
         "config_entry_id": entry, "original_name": "TV NBC"}])
    await r.env.login("owner1", "owner")
    resp = await r.env.m.client.put("/api/linked/owners", json={"unit": "house", "owner": "mantel"},
                                    headers=r.env.m.headers())
    assert resp.status == 200
    await r.tv.sync()
    reg = r.app["linked"].registry
    v = reg.get(f"{ITEM}_viewers")
    assert (v["entity_id"], v["platform"], v["state"]) == ("sensor.tv_viewers", "sensor", 0)
    cam = reg.get(f"{ITEM}_4.1_camera")
    assert cam["entity_id"] == "camera.tv_nbc" and cam["available"] is True and cam["features"] == {}, \
        "served by Mantel: available, and no stream source is handed to HA"
    assert reg.get(f"{ITEM}_4.1_now")["state"] == "The Fictional Hour"
    ws = await r.env.socket(expect_caps=False)
    await ws.send_json({"type": "tv_watching", "id": 1, "channel": "4.1"})
    await GF.recv(ws)
    v = reg.get(f"{ITEM}_viewers")
    assert v["state"] == 1 and v["attributes"]["users"] == ["Owner1"]
    # Live TV turned off: the cameras go unavailable and the viewers back to 0; Mantel's overlay goes
    body = F.check_settings({**r.app["features"].settings, "live_tv": {**r.app["features"].settings["live_tv"], "enabled": False}})
    r.app["settings"].store.write([("house", F.FEATURES_DOC, body)], actor=Actor(label="test"))
    await r.app["features"].reload()
    await r.tv.sync()
    assert reg.get(f"{ITEM}_4.1_camera")["available"] is False and reg.get(f"{ITEM}_viewers")["state"] == 0
    assert r.state(L.VIEWERS_ID) is None
    assert "camera.tv_nbc" in hub.registry.entries, "HA's own entry stays; Mantel's overlay entry is gone"
    assert not hub.registry.entries["camera.tv_nbc"].get("mantel_live_tv")
    await ws.close()


async def test_mantels_entities_win_over_has_copy(rig):
    r = await rig()
    hub = r.app["hub"]
    mine = r.state("sensor.tv_nbc_now")
    # a linked mirror's change, an HA removal, and a reconnect's replace_all: Mantel's copy is put back
    touched = hub.store.apply_event({"c": {"sensor.tv_nbc_now": {"+": {"s": "HA's idea", "a": {"x": 1}}}}})
    hub.ha.on_change(touched)
    assert r.state("sensor.tv_nbc_now") is mine
    touched = hub.store.apply_event({"r": ["sensor.tv_nbc_now"]})
    hub.ha.on_change(touched)
    assert r.state("sensor.tv_nbc_now") is mine
    touched = hub.store.replace_all({"a": {k: dict(v) for k, v in GF.STATES.items()}})
    hub.registry.update(entities=list(GF.HOUSE_ENTITIES))            # HaClient's first load (no callback)
    hub.ha.on_change(touched)
    assert r.state("sensor.tv_nbc_now") is mine and r.state("camera.tv_nbc")["s"] == "idle"
    assert hub.registry.entries["camera.tv_nbc"]["platform"] == "hk_frontend"
    assert set(GF.STATES) <= set(hub.store.states), "HA's own states are untouched"


async def test_streams_nobody_uses_are_reaped(rig):
    r = await rig()
    r.go2rtc.streams.update({"mantel_tv_9_9": "ffmpeg:x", "front_door": "rtsp://cam"})
    await r.tv.tick()
    assert "mantel_tv_9_9" not in r.go2rtc.streams and "front_door" in r.go2rtc.streams


async def test_the_status_is_owner_or_admin_only(rig):
    r = await rig()
    await r.env.login("adult1", "adult")
    assert (await r.env.m.get("/api/live_tv/status")).status == 403
    await r.env.login("owner1", "owner")
    resp = await r.env.m.get("/api/live_tv/status")
    body = await resp.json()
    assert resp.status == 200 and body["mode"] == "mantel" and body["hardware"] == "cpu"
    assert [c["camera"] for c in body["channels"]] == ["camera.tv_nbc", "camera.tv_wfak_dt"]
    assert r.tuner_addr not in json.dumps(body) and r.go2rtc_url not in json.dumps(body)


async def test_the_settings_feed_says_live_tv_is_added(rig):
    r = await rig()
    assert "live_tv" in r.app["features"].client_added()
    assert r.app["features"].panel_features()["hk_tv"]["entries"][0]["entry_id"] == ITEM


# ------------------------------------------------------------------------------------- /go2rtc/ gate
async def _start_nbc(r):
    ws = await r.socket("owner1", "owner")
    await ws.send_json({"type": "read_subscribe", "id": 2,
                        "msg": {"type": "camera/webrtc/offer", "entity_id": "camera.tv_nbc", "offer": OFFER_SDP}})
    for _ in range(100):
        if r.tv.streams:
            break
        await asyncio.sleep(0.02)
    assert r.tv.streams == {"mantel_tv_4_1": "4.1"}
    return ws


async def test_live_tv_streams_under_go2rtc_follow_the_live_tv_gate(rig):
    r = await rig()
    m = r.env.m
    url = "/go2rtc/api/frame.jpeg?src=mantel_tv_4_1"
    # nobody signed in, and nothing set up yet: refused
    m.forget_cookies()
    assert (await m.client.get(url)).status in (401, 403)
    ws = await _start_nbc(r)
    # an owner may view it (past the gate: the fake go2rtc has no still, so its own 404 is what comes back)
    assert (await m.client.get(url)).status != 403
    # the channel camera's own name is not an ordinary camera stream: refused, whoever asks
    assert (await m.client.get("/go2rtc/api/frame.jpeg?src=camera.tv_nbc")).status == 403
    # a child (no Live TV feature, no cameras by default) is refused
    await r.env.login("kid1", "child")
    assert (await m.client.get(url)).status == 403
    # signed out: refused
    m.forget_cookies()
    assert (await m.client.get(url)).status in (401, 403)
    # an adult has Live TV
    await r.env.login("adult1", "adult")
    assert (await m.client.get(url)).status != 403
    # the signaling socket under /go2rtc/ is gated the same way
    m.forget_cookies()
    await r.env.login("kid1", "child")
    import aiohttp
    with pytest.raises(aiohttp.WSServerHandshakeError) as bad:
        await m.client.ws_connect("/go2rtc/api/ws?src=mantel_tv_4_1")
    assert bad.value.status == 403
    # the stream is dropped with the last viewer: no longer reachable through the gate
    await r.env.login("owner1", "owner")
    await ws.send_json({"type": "read_unsubscribe", "id": 2})
    for _ in range(100):
        if not r.tv.streams:
            break
        await asyncio.sleep(0.02)
    assert (await m.client.get(url)).status == 403
    await ws.close()


async def test_the_app_mode_has_no_channel_gate_and_no_go2rtc_route(rig):
    r = await rig(go2rtc=False)
    m = r.env.m
    await r.env.login("owner1", "owner")
    # no go2rtc configured: /go2rtc/ is not configured at all (nothing of an HA transcode is exposed here)
    assert (await m.client.get("/go2rtc/api/frame.jpeg?src=mantel_tv_4_1")).status == 404


# ------------------------------------------------------------------------------------- through Mantel Link
LINK_ENTRY = "e2e0entry0id"


def _house_live_tv(hub):
    """What HK Frontend's Live TV left in HA's registry (now Mantel Link's, after the bridge hand-over)."""
    hub.registry.update(entities=list(hub.registry.entity_entries) + [
        {"entity_id": "sensor.tv_viewers", "platform": "mantel", "unique_id": f"{ITEM}_viewers",
         "config_entry_id": "mantellinkentry", "original_name": "TV viewers"},
        {"entity_id": "sensor.tv_nbc_now", "platform": "mantel", "unique_id": f"{ITEM}_4.1_now",
         "config_entry_id": "mantellinkentry", "original_name": "TV NBC now"},
        {"entity_id": "camera.tv_nbc", "platform": "mantel", "unique_id": f"{ITEM}_4.1_camera",
         "config_entry_id": "mantellinkentry", "original_name": "TV NBC"}])


def _mantel_link(r, monkeypatch, features=("bridge", "live_tv")):
    import types
    link = types.SimpleNamespace(domain="mantel", protocol=2, report={}, features=frozenset(features),
                                 ws=types.SimpleNamespace(closed=False))
    reg = r.app["linked"].registry
    monkeypatch.setattr(reg, "clients_of", lambda d: [link] if d == "mantel" else [])
    return link


async def _house_moved(r, monkeypatch, features=("bridge", "live_tv"), enabled=False):
    """The HA App's house: no go2rtc of Mantel's, Live TV imported from HK Frontend (so left off), the house
    moved to Mantel, Mantel Link connected."""
    _house_live_tv(r.app["hub"])
    _mantel_link(r, monkeypatch, features)
    await r.env.login("owner1", "owner")
    resp = await r.env.m.client.put("/api/linked/owners", json={"unit": "house", "owner": "mantel"},
                                    headers=r.env.m.headers())
    assert resp.status == 200
    await r.tv.tick()


async def test_the_ha_app_plays_live_tv_through_mantel_link(rig, monkeypatch):
    """HK Frontend gone, the house Mantel's: Mantel answers the channel list from its own Live TV piece (the
    piece an import left off, since HA ran it then) and publishes each channel camera with the tuner's stream
    for Mantel Link's transcode; HA's go2rtc plays it, so the video goes to HA's camera as before."""
    r = await rig(go2rtc=False, linked=True)
    body = {**r.app["features"].settings}
    body["live_tv"] = {**body["live_tv"], "enabled": False}
    r.app["settings"].store.write([("house", F.FEATURES_DOC, F.check_settings(body))], actor=Actor(label="test"))
    await r.app["features"].reload()
    assert r.tv.mode() == "ha", "the house still HA's: the interim"
    await _house_moved(r, monkeypatch)
    assert r.tv.mode() == "link" and r.tv.piece_on() and not r.tv.runs()
    assert r.app["features"].tv.fetched_at, "Mantel reads the tuner and the guide itself now"

    ws = await r.env.socket(expect_caps=False)
    got = (await r.ask(ws, 1, {"type": "hk_tv/channels"}))["result"]
    assert got == {"configured": True, "channels": [
        {"number": "4.1", "name": "NBC", "camera": "camera.tv_nbc", "now": "sensor.tv_nbc_now"},
        {"number": "7.1", "name": "WFAK-DT", "camera": "camera.tv_wfak_dt", "now": "sensor.tv_wfak_dt_now"}]}
    assert r.tuner_addr not in json.dumps(got), "the page never learns the tuner's address"

    reg = r.app["linked"].registry
    cam = reg.get(f"{ITEM}_4.1_camera")
    assert cam["entity_id"] == "camera.tv_nbc" and cam["available"] is True
    assert cam["features"] == {"tv": {"channel": "4.1", "source": f"http://{r.tuner_addr}/auto/v4.1",
                                      "quality": "720", "image": "https://img.example.invalid/nbc.png"}}
    # a channel HK Frontend never had gets entities of its own, under this entry
    new = reg.get(f"{LINK_ENTRY}_7.1_camera")
    assert new["entity_id"] == "camera.tv_wfak_dt" and new["features"]["tv"]["source"].endswith("/auto/v7.1")
    assert reg.get(f"{LINK_ENTRY}_7.1_now")["entity_id"] == "sensor.tv_wfak_dt_now"
    assert reg.get(f"{ITEM}_4.1_now")["state"] == "The Fictional Hour"
    # the entities are Home Assistant's (Mantel Link's), not an overlay of Mantel's own
    assert r.state("camera.tv_nbc") is None and r.state(L.VIEWERS_ID) is None

    # the heartbeat is counted here and published as sensor.tv_viewers; there is no HA Live TV to tell
    await ws.send_json({"type": "tv_watching", "id": 2, "channel": "4.1"})
    assert (await GF.recv(ws))["result"] == {"viewers": ["Owner1"], "ha": False}
    v = reg.get(f"{ITEM}_viewers")
    assert v["state"] == 1 and v["attributes"]["users"] == ["Owner1"]
    await ws.send_json({"type": "tv_watching", "id": 3, "channel": "9.9"})
    assert (await GF.recv(ws))["error"] == {"code": "not_found"}

    # a channel camera's offer is the camera connector's (to HA), never Mantel's own WebRTC
    assert not r.tv.ours({"entity_id": "camera.tv_nbc"})
    # the 1080 picture is the transcode's, named to Mantel Link
    body = {**r.app["features"].settings}
    body["live_tv"] = {**body["live_tv"], "quality": "1080"}
    r.app["settings"].store.write([("house", F.FEATURES_DOC, F.check_settings(body))], actor=Actor(label="test"))
    await r.app["features"].reload()
    await r.tv.sync()
    assert reg.get(f"{ITEM}_4.1_camera")["features"]["tv"]["quality"] == "1080"
    await ws.close()


async def test_a_mantel_link_without_the_transcode_keeps_the_interim(rig, monkeypatch):
    r = await rig(go2rtc=False, linked=True)
    await _house_moved(r, monkeypatch, features=("bridge",))
    assert r.tv.mode() == "ha" and not r.tv.serves()
    cam = r.app["linked"].registry.get(f"{ITEM}_4.1_camera")
    assert cam["available"] is False and cam["features"] == {}, "never a camera nothing can play"


async def test_live_tv_without_a_tuner_is_off_through_mantel_link(rig, monkeypatch):
    r = await rig(go2rtc=False, linked=True)
    body = {**r.app["features"].settings}
    body["live_tv"] = {**body["live_tv"], "enabled": False, "tuner": ""}
    r.app["settings"].store.write([("house", F.FEATURES_DOC, F.check_settings(body))], actor=Actor(label="test"))
    await r.app["features"].reload()
    await _house_moved(r, monkeypatch)
    assert not r.tv.piece_on() and r.tv.mode() == "ha"


def _offer(rid, cam="camera.tv_nbc"):
    return {"type": "read_subscribe", "id": rid, "msg": {"type": "camera/webrtc/offer", "entity_id": cam,
                                                         "offer": OFFER_SDP}}


async def test_offers_sent_together_still_meet_the_caps(rig):
    """The caps were checked before the go2rtc round trips and counted after: ten offers sent at once all passed
    the per-socket limit of four."""
    r = await rig()
    ws = await r.env.login("adult1", "adult") and await r.env.socket(expect_caps=False)
    for rid in range(1, 11):
        await ws.send_json(_offer(rid))
    await asyncio.sleep(0.5)
    assert len(r.tv.sessions) == L.MAX_SESSIONS_PER_SOCKET and r.tv.starting == 0
    await ws.close()


async def test_the_same_id_twice_never_leaks_a_session(rig):
    """A second read_subscribe with the same id overwrote the first's unsubscribe, which then never ran: its
    session and go2rtc stream outlived the socket, and 32 of them locked Live TV for everyone."""
    r = await rig()
    ws = await r.env.login("adult1", "adult") and await r.env.socket(expect_caps=False)
    await ws.send_json(_offer(7))
    await ws.send_json(_offer(7))
    await asyncio.sleep(0.3)
    await ws.close()
    await asyncio.sleep(0.5)
    await r.tv.tick()
    assert r.tv.sessions == {}


async def test_a_channel_no_longer_allowed_ends_at_the_next_tick(rig):
    from mantel_server import server
    from mantel_server.rbac import Grant
    r = await rig()
    ws = await r.env.login("adult1", "adult") and await r.env.socket(expect_caps=False)
    await ws.send_json(_offer(1))
    await asyncio.sleep(0.3)
    assert len(r.tv.sessions) == 1
    r.env.app["rbac"].add_grant(Grant(effect="deny", actions=("*",), resource_kind="feature", resource="live_tv",
                                      roles={"adult"}))
    await server.tick_once(r.env.app, r.env.app["hub"])
    assert r.tv.sessions == {}
    await ws.close()
