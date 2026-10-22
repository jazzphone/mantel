"""LIVE TALK through Mantel (docs/phase3/GATEWAY.md "Doorbell talk-back"; talk_relay.py): the gateway's
`talk_live` command issues a one-time ticket, the card's Worker opens /ws/talk with it and speaks HA's
protocol, and Mantel relays ONE subscription and its binary frames to Home Assistant over a socket of
its own (ha_client.HaTalkLink). Over a full app (gateway_fakes) with a loopback stand-in for Home
Assistant's WebSocket that speaks hk_frontend's talk/live protocol (talk_live.py) and records every
frame Mantel sends it."""
import asyncio
import json

import aiohttp
import pytest
from aiohttp import WSMsgType, web
from aiohttp.test_utils import TestServer

from gateway_fakes import gw, off, recv  # noqa: F401 -- fixtures
from mantel_server import talk_relay
from mantel_server.config import Config
from mantel_server.gateway import Refused, classify, load_writes
from mantel_server.ha_client import (CommandBlocked, CommandTicket, HaCommandError, HaCommander, HaTalkLink, check_command,
                                     check_talk, talk_frame_max)
from mantel_server.server import COMMANDS_DISABLED, tick_once
from mantel_server.settings_store import Actor
from test_gateway_talk import CLIP, SPEAKER, add_speaker, talk

WRITES = load_writes()
HA_TOKEN = "fictional-mantel-ha-token"
HA_HID = 7


class FakeHa:
    """hk_frontend's talk/live on a loopback HA WebSocket: auth, the subscription (result, then the
    handler event), binary frames, unsubscribe. Records every frame it receives, per connection."""

    def __init__(self):
        self.conns: list[list] = []
        self.live = 0                                # connections still open
        self.refuse: dict[str, str] = {}             # entity -> HA's error message (not_supported)
        self.fail_after: int | None = None           # send {"error"} after this many frames
        self.server = None
        # the subscriptions this Home Assistant has: Mantel Link's (talk_live.py) and HK Frontend's; any other
        # type is HA's own unknown_command, as a real HA answers
        self.kinds = {"mantel/talk/live", "hk_frontend/talk/live"}

    async def handler(self, request):
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        seen: list = []
        self.conns.append(seen)
        self.live += 1
        try:
            return await self._serve(ws, seen)
        finally:
            self.live -= 1

    async def _serve(self, ws, seen):
        await ws.send_json({"type": "auth_required", "ha_version": "fictional"})
        auth = await ws.receive_json()
        seen.append(auth)
        if auth.get("access_token") != HA_TOKEN:
            await ws.send_json({"type": "auth_invalid"})
            await ws.close()
            return ws
        await ws.send_json({"type": "auth_ok", "ha_version": "fictional"})
        frames = 0
        async for m in ws:
            if m.type == WSMsgType.TEXT:
                msg = json.loads(m.data)
                seen.append(msg)
                if msg.get("type", "").endswith("/talk/live") and msg["type"] not in self.kinds:
                    await ws.send_json({"id": msg["id"], "type": "result", "success": False,
                                        "error": {"code": "unknown_command", "message": "Unknown command."}})
                elif msg.get("type") in self.kinds:
                    if msg["entity_id"] in self.refuse:
                        await ws.send_json({"id": msg["id"], "type": "result", "success": False,
                                            "error": {"code": "not_supported", "message": self.refuse[msg["entity_id"]]}})
                    else:
                        await ws.send_json({"id": msg["id"], "type": "result", "success": True, "result": None})
                        await ws.send_json({"id": msg["id"], "type": "event",
                                            "event": {"handler_id": HA_HID, "rate": 24000, "codec": "opus"}})
                elif msg.get("type") == "unsubscribe_events":
                    await ws.send_json({"id": msg["id"], "type": "result", "success": True, "result": None})
            elif m.type == WSMsgType.BINARY:
                seen.append(bytes(m.data))
                frames += 1
                if self.fail_after is not None and frames == self.fail_after:
                    await ws.send_json({"id": 1, "type": "event", "event": {"error": "talkback session ended"}})
        return ws

    def subscribed(self):
        """The connections Mantel sent anything but its sign-in on (it connects while the page does)."""
        return [c for c in self.conns if c[1:]]

    def binaries(self, i=-1):
        return [f for f in self.conns[i] if isinstance(f, bytes)] if self.conns else []


@pytest.fixture
async def ha(gw):
    fake = FakeHa()
    app = web.Application()
    app.router.add_get("/api/websocket", fake.handler)
    async with TestServer(app, host="127.0.0.1") as server:
        cfg = Config(commands_enabled=True, ha_url=str(server.make_url("")).rstrip("/"))
        real = HaCommander(cfg, HA_TOKEN, WRITES)
        gw.fake.talk_link = real.talk_link           # the fake command connection gains the real talk path
        fake.server = server
        yield fake
        if gw.app.get("talk") is not None:
            await gw.app["talk"].close()             # a ticket never used: its early socket to HA goes
        await real.close()


def popups(env, *items):
    env.app["settings"].store.write([("house", "popups", {"items": list(items)})], actor=Actor(label="test"))


DOORBELL = {"name": "Doorbell", "kind": "camera", "hash": "doorbell", "entity": "camera.doorbell", "speaker": SPEAKER}


async def ticket(env, ws, speaker=SPEAKER, **extra):
    reply = await env.command(ws, kind="talk_live", speaker=speaker, **extra)
    return reply


async def open_talk(env, token, *, origin=True):
    headers = None if origin else {"Origin": ""}
    ws = await env.m.client.ws_connect("/ws/talk", headers=headers)
    assert (await recv(ws))["type"] == "auth_required"
    await ws.send_json({"type": "auth", "access_token": token})
    return ws


async def subscribe(ws, speaker=SPEAKER, rate=48000, sid=2):
    await ws.send_json({"id": sid, "type": "hk_frontend/talk/live", "entity_id": speaker, "rate": rate})
    return await recv(ws)


async def closed(ws, timeout=3):
    m = await asyncio.wait_for(ws.receive(), timeout)
    while m.type not in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.CLOSING):
        m = await asyncio.wait_for(ws.receive(), timeout)
    return ws.close_code


async def let_go(ha):
    """Nothing but Mantel's early sign-in reached Home Assistant, and that socket was closed again."""
    return not ha.subscribed() and await until(lambda: ha.live == 0)


async def until(cond, timeout=3):
    for _ in range(int(timeout / 0.02)):
        if cond():
            return True
        await asyncio.sleep(0.02)
    return cond()


# -- the whole path ---------------------------------------------------------------------------------
async def test_owner_live_talk_is_audited_first_then_relayed_exactly(gw, ha, monkeypatch):
    add_speaker(gw)
    await gw.login("avery", "owner")
    hub = await gw.socket()
    seen = []
    relay = gw.app["talk"]
    real_issue = relay.issue

    def issue(principal, speaker, aid):
        (row,) = gw.audit()                      # THE ROW FIRST: written, no result yet, nothing opened to HA
        seen.append((row["id"], row["decision"], row["result"], len(ha.conns)))
        return real_issue(principal, speaker, aid)

    monkeypatch.setattr(relay, "issue", issue)
    reply = await ticket(gw, hub)
    tok = reply["result"]["ticket"]
    assert reply["type"] == "command_result" and reply["result"]["expires_in"] == 10 and len(tok) > 30
    assert seen == [(reply["audit_id"], "allowed", None, 0)]
    (row,) = gw.audit()
    assert (row["kind"], row["action"], row["decision"], row["sensitive"]) == ("ws", "hk_frontend/talk/live", "allowed", "camera")
    assert json.loads(row["target"]) == [SPEAKER, "feature:cameras"] and row["result"] is None

    ws = await open_talk(gw, tok)
    got = [await recv(ws)]
    assert got[0] == {"type": "auth_ok", "ha_version": "mantel"}
    got.append(await subscribe(ws))
    assert got[1] == {"id": 2, "type": "result", "success": True, "result": None}
    got.append(await recv(ws))
    assert got[2] == {"id": 2, "type": "event", "event": {"handler_id": 1, "rate": 24000, "codec": "opus"}}
    pcm = [bytes([i]) * 3840 for i in range(1, 4)]            # 40 ms at 48 kHz
    for p in pcm:
        await ws.send_bytes(b"\x01" + p)
    assert await until(lambda: len(ha.binaries()) == 3)
    assert ha.binaries() == [bytes([HA_HID]) + p for p in pcm]   # HA's own handler id, the exact PCM
    await ws.send_json({"id": 3, "type": "unsubscribe_events", "subscription": 2})
    got.append(await recv(ws))
    assert got[3] == {"id": 3, "type": "result", "success": True, "result": None}
    await closed(ws)
    (conn,) = ha.conns
    assert conn[0] == {"type": "auth", "access_token": HA_TOKEN}
    assert conn[1] == {"id": 1, "type": "mantel/talk/live", "entity_id": SPEAKER, "rate": 48000}   # Mantel Link's
    assert conn[2:5] == [bytes([HA_HID]) + p for p in pcm]
    assert conn[5:] == [{"id": 2, "type": "unsubscribe_events", "subscription": 1}]
    assert HA_TOKEN not in json.dumps(got) and HA_TOKEN not in json.dumps(gw.audit())
    assert await until(lambda: gw.audit()[0]["result"] == "ok")
    assert gw.fake.sent == []                  # nothing on the command connection
    await hub.close()


async def test_the_ticket_is_single_use(gw, ha):
    add_speaker(gw)
    await gw.login("avery", "owner")
    hub = await gw.socket()
    tok = (await ticket(gw, hub))["result"]["ticket"]
    ws = await open_talk(gw, tok)
    assert (await recv(ws))["type"] == "auth_ok"
    await ws.close()
    again = await open_talk(gw, tok)
    assert (await recv(again))["type"] == "auth_invalid"
    assert await closed(again) == 1008
    assert await let_go(ha)
    await hub.close()


async def test_the_ticket_expires(gw, ha):
    add_speaker(gw)
    await gw.login("avery", "owner")
    hub = await gw.socket()
    first = await ticket(gw, hub)
    unused = await ticket(gw, hub, id=2)
    gw.now[0] += 11
    ws = await open_talk(gw, first["result"]["ticket"])
    assert (await recv(ws))["type"] == "auth_invalid"
    gw.app["talk"].sweep()                     # the never-used one: at the next issue or policy tick
    rows = {r["id"]: r for r in gw.audit()}
    assert rows[first["audit_id"]]["result"] == "error:ticket_expired"
    assert rows[unused["audit_id"]]["result"] == "error:ticket_unused"
    assert await let_go(ha)
    await hub.close()


async def test_a_ticket_is_bound_to_who_asked(gw, ha):
    add_speaker(gw)
    await gw.login("avery", "owner")
    hub = await gw.socket()
    reply = await ticket(gw, hub)
    await hub.close()
    await gw.login("jordan", "adult")        # another person's cookies
    ws = await open_talk(gw, reply["result"]["ticket"])
    assert (await recv(ws))["type"] == "auth_invalid"
    assert await let_go(ha) and gw.audit(id=reply["audit_id"])[0]["result"] == "error:ticket_other_identity"


async def test_garbage_tokens_are_refused(gw, ha):
    await gw.login("avery", "owner")
    for token in ("", "x" * 43, None):
        ws = await open_talk(gw, token)
        assert (await recv(ws))["type"] == "auth_invalid"
    ws = await gw.m.client.ws_connect("/ws/talk")
    await recv(ws)
    await ws.send_json({"type": "auth", "access_token": "x", "extra": 1})
    assert (await recv(ws))["type"] == "auth_invalid"
    assert await let_go(ha)


# -- the subscription and the frames ---------------------------------------------------------------
async def _live(gw, ha, rate=48000):
    add_speaker(gw)
    await gw.login("avery", "owner")
    hub = await gw.socket()
    reply = await ticket(gw, hub)
    ws = await open_talk(gw, reply["result"]["ticket"])
    assert (await recv(ws))["type"] == "auth_ok"
    assert (await subscribe(ws, rate=rate))["success"] is True
    assert (await recv(ws))["event"]["handler_id"] == 1
    return hub, ws, reply["audit_id"]


async def test_another_speaker_is_refused_and_nothing_opened(gw, ha):
    add_speaker(gw)
    await gw.login("avery", "owner")
    hub = await gw.socket()
    reply = await ticket(gw, hub)
    ws = await open_talk(gw, reply["result"]["ticket"])
    await recv(ws)
    r = await subscribe(ws, speaker="media_player.kitchen")
    assert r["success"] is False and r["error"]["code"] == "not_allowed" and r["id"] == 2
    assert await closed(ws) == 1008
    assert await let_go(ha) and gw.audit(id=reply["audit_id"])[0]["result"] == "refused:other_speaker"
    await hub.close()


@pytest.mark.parametrize("sub", [
    {"id": 2, "type": "hk_frontend/talk/live", "entity_id": SPEAKER, "rate": 12345},
    {"id": 2, "type": "hk_frontend/talk/live", "entity_id": SPEAKER, "rate": 48000, "extra": 1},
    {"id": 2, "type": "subscribe_events", "event_type": "state_changed"},
    {"id": 2, "type": "call_service", "domain": "lock", "service": "unlock"},
    {"id": "2", "type": "hk_frontend/talk/live", "entity_id": SPEAKER, "rate": 48000},
])
async def test_only_the_one_subscription_is_accepted(gw, ha, sub):
    add_speaker(gw)
    await gw.login("avery", "owner")
    hub = await gw.socket()
    reply = await ticket(gw, hub)
    ws = await open_talk(gw, reply["result"]["ticket"])
    await recv(ws)
    await ws.send_json(sub)
    r = await recv(ws)
    assert r["type"] == "result" and r["success"] is False
    assert await closed(ws) == 1008 and await let_go(ha)
    await hub.close()


async def test_a_frame_with_another_handler_id_closes_the_socket(gw, ha):
    hub, ws, aid = await _live(gw, ha)
    await ws.send_bytes(b"\x07" + bytes(3840))               # HA's id, not the one Mantel gave
    assert await closed(ws) == 1008
    assert ha.binaries() == []
    assert await until(lambda: gw.audit(id=aid)[0]["result"] == "refused:bad_frame")
    assert await until(lambda: ha.conns[0][-1] == {"id": 2, "type": "unsubscribe_events", "subscription": 1})
    await hub.close()


@pytest.mark.parametrize("frame", [b"\x01", b"\x01" + bytes(3), b"\x01" + bytes(talk_frame_max(48000) + 2)])
async def test_empty_odd_or_oversized_frames_close_the_socket(gw, ha, frame):
    hub, ws, _ = await _live(gw, ha)
    await ws.send_bytes(frame)
    assert await closed(ws) in (1008, 1009)
    assert ha.binaries() == []
    await hub.close()


async def test_any_other_text_frame_closes_the_socket(gw, ha):
    hub, ws, aid = await _live(gw, ha)
    await ws.send_json({"id": 9, "type": "call_service", "domain": "lock", "service": "unlock"})
    assert await closed(ws) == 1008
    assert all(f.get("type") != "call_service" for f in ha.conns[0] if isinstance(f, dict))
    assert await until(lambda: gw.audit(id=aid)[0]["result"] == "refused:bad_message")
    await hub.close()


async def test_the_rate_is_capped(gw, ha):
    hub, ws, _ = await _live(gw, ha, rate=8000)              # 16,000 bytes/s, one second of burst
    frame = b"\x01" + bytes(1600)                             # 100 ms each
    for _ in range(30):                                       # 3 s of audio at once
        await ws.send_bytes(frame)
    await asyncio.sleep(0.3)
    n = len(ha.binaries())
    assert 9 <= n <= 12, n                                    # ~1 s burst plus a sliver of refill
    await ws.close()
    await hub.close()


async def test_the_session_is_closed_at_the_time_cap(gw, ha):
    gw.app["talk"].max_session = 0.3
    hub, ws, aid = await _live(gw, ha)
    assert await closed(ws) == 1000
    assert await until(lambda: gw.audit(id=aid)[0]["result"] == "ok:max_session")
    assert ha.conns[0][-1] == {"id": 2, "type": "unsubscribe_events", "subscription": 1}
    await hub.close()


async def test_one_live_talk_per_person_at_a_time(gw, ha):
    hub, ws, _ = await _live(gw, ha)
    second = await ticket(gw, hub, id=5)
    ws2 = await open_talk(gw, second["result"]["ticket"])
    await recv(ws2)
    r = await subscribe(ws2)
    assert r["success"] is False and r["error"]["code"] == "busy"
    assert len(ha.subscribed()) == 1 and gw.audit(id=second["audit_id"])[0]["result"] == "refused:busy"
    await ws.close()
    await hub.close()


async def test_home_assistant_refusing_is_relayed_and_the_rows_result(gw, ha):
    ha.refuse[SPEAKER] = f"{SPEAKER} is not a UniFi Protect speaker"
    add_speaker(gw)
    await gw.login("avery", "owner")
    hub = await gw.socket()
    reply = await ticket(gw, hub)
    ws = await open_talk(gw, reply["result"]["ticket"])
    await recv(ws)
    r = await subscribe(ws)
    assert r["success"] is False and r["error"]["code"] == "not_supported" and r["id"] == 2
    assert "not a UniFi Protect speaker" in r["error"]["message"]
    assert await until(lambda: gw.audit(id=reply["audit_id"])[0]["result"] == "error:not_supported")
    await hub.close()


async def test_a_failure_mid_stream_reaches_the_worker(gw, ha):
    ha.fail_after = 2
    hub, ws, aid = await _live(gw, ha)
    for _ in range(2):
        await ws.send_bytes(b"\x01" + bytes(3840))
    r = await recv(ws)
    assert r == {"id": 2, "type": "event", "event": {"error": "talkback session ended"}}
    await ws.send_json({"id": 3, "type": "unsubscribe_events", "subscription": 2})   # the card lets go
    assert (await recv(ws))["success"] is True
    assert await until(lambda: gw.audit(id=aid)[0]["result"] == "error:ha_failed")
    await hub.close()


async def test_the_page_going_away_lets_go_on_home_assistant(gw, ha):
    hub, ws, aid = await _live(gw, ha)
    await ws.close()
    await until(lambda: gw.audit(id=aid)[0]["result"] is not None)
    assert gw.audit(id=aid)[0]["result"] == "ok"
    assert ha.conns[0][-1] == {"id": 2, "type": "unsubscribe_events", "subscription": 1}
    await hub.close()


async def test_a_revoked_session_closes_the_stream_at_the_policy_tick(gw, ha):
    hub, ws, aid = await _live(gw, ha)
    db = gw.app["store"].db
    (sid,) = db.execute("SELECT id FROM sessions ORDER BY created DESC LIMIT 1").fetchone()
    gw.app["sessions"].revoke(sid, "test", gw.now[0])
    await tick_once(gw.app, gw.app["hub"])
    assert await closed(ws) == 1008
    await until(lambda: gw.audit(id=aid)[0]["result"] is not None)
    assert gw.audit(id=aid)[0]["result"] == "error:unauthenticated"


# -- who may ---------------------------------------------------------------------------------------
async def test_a_child_and_a_guest_get_no_ticket(gw, ha):
    add_speaker(gw)
    await gw.login("cody", "child")
    hub = await gw.socket()
    r = await ticket(gw, hub)
    assert r["error"]["code"] == "forbidden" and "result" not in r
    await hub.close()
    await gw.login("gwen", "guest")
    hub = await gw.socket()
    r = await ticket(gw, hub)
    assert r["error"]["reason"] == "no_grant" and r["error"]["target"] == SPEAKER
    assert gw.app["talk"].tickets == {} and ha.conns == []
    await hub.close()


async def test_on_the_tunnel_a_stale_factor_still_gets_a_ticket(gw, ha):
    # decision 25: no step-up on any door; the role's tunnel switches decide (test_gateway_talk.py)
    from test_gateway_talk import _tunnel_adult
    add_speaker(gw)
    await _tunnel_adult(gw)
    gw.now[0] += 3600
    hub = await gw.socket(tunnel=True)
    r = await ticket(gw, hub)
    assert r["type"] == "command_result" and "ticket" in r["result"], r
    r = await ticket(gw, hub, id=2, step_up={"method": "pin", "pin": "1234"})
    assert r["error"]["code"] == "invalid_command"            # a command never takes a PIN
    await hub.close()


async def test_wall_tablets_talk_on_the_doorbell_speaker_from_hks_popups(gw, ha):
    add_speaker(gw)
    await gw.login("avery", "owner")
    r = await gw.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert r.status == 201
    hub = await gw.socket()
    r = await ticket(gw, hub)                                   # no pop-up names the speaker yet
    assert r["error"]["reason"] == "no_grant" and r["error"]["target"] == SPEAKER
    popups(gw, DOORBELL, {"name": "Garage", "kind": "camera", "entity": "camera.garage",
                          "speaker": "media_player.garage_speaker"},
           {"name": "Alarm", "kind": "alarm", "entity": "alarm_control_panel.house", "speaker": "media_player.kitchen"})
    assert gw.app["authz"].talk_speakers() == {SPEAKER, "media_player.garage_speaker"}
    r = await ticket(gw, hub, id=2)                             # live: no PIN on the LAN
    assert "ticket" in r["result"]
    r = await gw.command(hub, id=3, **talk())                   # and the clip
    assert r["result"]["ok"] is True
    r = await gw.command(hub, id=4, kind="service", domain="media_player", service="volume_set",
                         target={"entity_id": SPEAKER}, data={"volume_level": 1})
    assert r["error"]["reason"] == "no_grant"                   # TALK ONLY: nothing else on the speaker
    # the Owner turns it off with an ordinary deny grant (deny wins)
    await hub.close()
    await gw.login("avery", "owner")
    r = await gw.m.post("/api/rbac/grants", {"effect": "deny", "actions": ["control"], "resource_kind": "entity",
                                             "resource": SPEAKER, "roles": ["wall_tablet"]})
    assert r.status == 201
    r = await gw.m.post("/api/devices/enroll", {"name": "Kitchen tablet 2", "room": "kitchen"})
    hub = await gw.socket()
    r = await ticket(gw, hub, id=5)
    assert r["error"]["reason"] == "explicit_deny"
    await hub.close()


def test_talk_speakers_come_only_from_camera_popups():
    from mantel_server.authz import talk_grants, talk_speakers
    assert talk_speakers([DOORBELL, {"kind": "camera", "speaker": "light.x"}, {"kind": "cards", "speaker": SPEAKER},
                          {"speaker": "media_player.default_kind"}, "junk", None]) == {SPEAKER, "media_player.default_kind"}
    assert talk_speakers(None) == frozenset()
    (g,) = talk_grants([SPEAKER])
    assert (g.effect, sorted(g.actions), g.resource_kind, g.resource, sorted(g.roles)) == \
        ("allow", ["control"], "entity", SPEAKER, ["wall_tablet"])


# -- commands off, the origin, the boundaries --------------------------------------------------------
async def test_commands_disabled_refuses_live_talk_and_opens_nothing(off):
    add_speaker(off)
    await off.login("avery", "owner")
    ws = await off.socket(expect_caps=False)
    await ws.send_json({"type": "command", "id": 5, "kind": "talk_live", "speaker": SPEAKER})
    assert await recv(ws) == {**COMMANDS_DISABLED, "id": 5}
    await ws.close()
    with pytest.raises(aiohttp.WSServerHandshakeError) as exc:
        await off.m.client.ws_connect("/ws/talk")
    assert exc.value.status == 403
    assert off.audit() == [] and off.app["talk"] is None and off.app["commander"] is None


async def test_the_upgrade_needs_a_session_and_our_origin(gw, ha):
    with pytest.raises(aiohttp.WSServerHandshakeError) as exc:      # signed out
        await gw.m.client.ws_connect("/ws/talk")
    assert exc.value.status == 401
    await gw.login("avery", "owner")
    gw.m.client.session.headers.pop("Origin")
    try:
        with pytest.raises(aiohttp.WSServerHandshakeError) as exc:
            await gw.m.client.ws_connect("/ws/talk")
        assert exc.value.status == 403
        with pytest.raises(aiohttp.WSServerHandshakeError) as exc:
            await gw.m.client.ws_connect("/ws/talk", headers={"Origin": "https://evil.example"})
        assert exc.value.status == 403
    finally:
        gw.m.client.session.headers["Origin"] = gw.m.origin


def test_classification_and_the_command_connection_guard():
    c = classify({"kind": "talk_live", "speaker": SPEAKER}, WRITES)
    assert (c.kind, c.action, c.live) == ("ws", "hk_frontend/talk/live", SPEAKER)
    assert [(k.action, k.entity_id, k.feature, k.talk) for k in c.checks] == [
        ("media_player.play_media", SPEAKER, None, True), ("camera.talk", None, "cameras", True)]
    for bad in ({"kind": "talk_live", "speaker": "lock.front_door"}, {"kind": "talk_live"},
                {"kind": "talk_live", "speaker": SPEAKER, "rate": 48000}):
        with pytest.raises(Refused):
            classify(bad, WRITES)
    with pytest.raises(Refused) as exc:                     # never as a plain WebSocket write
        classify({"kind": "ws", "msg": {"type": "hk_frontend/talk/live", "entity_id": SPEAKER, "rate": 48000}}, WRITES)
    assert exc.value.code == "unsupported_command"
    with pytest.raises(CommandBlocked):
        check_command({"type": "hk_frontend/talk/live", "entity_id": SPEAKER, "rate": 48000},
                      CommandTicket(1, "ws"), WRITES)


def test_the_talk_link_guard():
    t = CommandTicket(4, "talk")
    check_talk(SPEAKER, 48000, t)
    with pytest.raises(CommandBlocked):
        check_talk(SPEAKER, 48000, t)                       # one shot
    for args in ((SPEAKER, 48000, CommandTicket(4, "ws")), ("lock.front_door", 48000, CommandTicket(4, "talk")),
                 (SPEAKER, 12345, CommandTicket(4, "talk")), (SPEAKER, True, CommandTicket(4, "talk")),
                 (SPEAKER, 48000, CommandTicket(0, "talk"))):
        with pytest.raises(CommandBlocked):
            check_talk(*args)
    link = HaTalkLink("ws://127.0.0.1:9/api/websocket", HA_TOKEN, SPEAKER, 48000)
    assert HA_TOKEN not in repr(link)


async def test_the_link_sends_nothing_but_its_frames(gw, ha):
    cfg = Config(commands_enabled=True, ha_url=str(ha.server.make_url("")).rstrip("/"))
    commander = HaCommander(cfg, HA_TOKEN, WRITES)
    link = commander.talk_link(SPEAKER, 16000, CommandTicket(3, "talk"))
    assert await link.send_audio(bytes(640)) is False            # not open: no handler id
    await link.open()
    ev = await link.recv()
    assert ev["handler_id"] == HA_HID and link.handler_id == HA_HID
    for bad in (b"", bytes(3), bytes(talk_frame_max(16000) + 2), "text"):
        assert await link.send_audio(bad) is False
    assert await link.send_audio(bytes(640)) is True
    await link.stop()
    await link.stop()                                            # once
    assert await link.send_audio(bytes(640)) is False            # after letting go
    await link.close()
    await commander.close()
    assert await until(lambda: len(ha.conns[-1]) == 4)
    assert ha.conns[-1] == [{"type": "auth", "access_token": HA_TOKEN},
                            {"id": 1, "type": "mantel/talk/live", "entity_id": SPEAKER, "rate": 16000},
                            bytes([HA_HID]) + bytes(640), {"id": 2, "type": "unsubscribe_events", "subscription": 1}]
    assert commander.sent == [f"hk_frontend/talk/live {SPEAKER}"]


async def test_without_mantel_link_the_link_asks_hk_frontend(gw, ha):
    """A Home Assistant with only HK Frontend: Mantel Link's subscription is unknown there, so the same speaker
    and rate go to HK Frontend's, once; the unsubscribe names the subscription HA took."""
    ha.kinds = {"hk_frontend/talk/live"}
    cfg = Config(commands_enabled=True, ha_url=str(ha.server.make_url("")).rstrip("/"))
    commander = HaCommander(cfg, HA_TOKEN, WRITES)
    link = commander.talk_link(SPEAKER, 16000, CommandTicket(4, "talk"))
    await link.open()
    assert (await link.recv())["handler_id"] == HA_HID
    assert await link.send_audio(bytes(640)) is True
    await link.stop()
    await link.close()
    await commander.close()
    assert await until(lambda: len(ha.conns[-1]) == 5)
    assert ha.conns[-1] == [{"type": "auth", "access_token": HA_TOKEN},
                            {"id": 1, "type": "mantel/talk/live", "entity_id": SPEAKER, "rate": 16000},
                            {"id": 3, "type": "hk_frontend/talk/live", "entity_id": SPEAKER, "rate": 16000},
                            bytes([HA_HID]) + bytes(640), {"id": 2, "type": "unsubscribe_events", "subscription": 3}]


async def test_a_refusal_other_than_unknown_is_final(gw, ha):
    ha.refuse[SPEAKER] = "not a UniFi Protect speaker"
    cfg = Config(commands_enabled=True, ha_url=str(ha.server.make_url("")).rstrip("/"))
    commander = HaCommander(cfg, HA_TOKEN, WRITES)
    link = commander.talk_link(SPEAKER, 16000, CommandTicket(5, "talk"))
    with pytest.raises(HaCommandError) as e:
        await link.open()
    assert e.value.code == "not_supported"
    await commander.close()
    assert [m.get("type") for m in ha.conns[-1] if isinstance(m, dict)] == ["auth", "mantel/talk/live"]


# -- HK's own Worker, unchanged, against /ws/talk --------------------------------------------------------
async def run_worker(env, token, frames=5, rate=48000, speaker=SPEAKER):
    import shutil
    from pathlib import Path
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    root = Path(__file__).resolve().parent.parent
    jar = env.m.client.session.cookie_jar.filter_cookies(env.m.client.make_url("/"))
    cookie = "; ".join(f"{k}={v.value}" for k, v in jar.items())
    url = str(env.m.client.make_url("/ws/talk")).replace("http", "ws", 1)
    proc = await asyncio.create_subprocess_exec(
        "node", str(root / "tests/talk_worker_harness.mjs"), str(root / "web/hk/cards/hk-cameras.js"), url, token,
        cookie, env.m.origin, speaker, str(rate), str(frames), stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE)
    out, err = await asyncio.wait_for(proc.communicate(), 30)
    assert proc.returncode == 0, err.decode()
    return json.loads(out.decode().strip().splitlines()[-1])


async def test_hks_own_talk_worker_streams_through_mantel(gw, ha):
    add_speaker(gw)
    await gw.login("avery", "owner")
    hub = await gw.socket()
    reply = await ticket(gw, hub)
    got = await run_worker(gw, reply["result"]["ticket"], frames=5)
    assert got["said"] == [{"id": 1, "live": True}] and got["sent"] == 5
    assert await until(lambda: len(ha.conns) == 1 and isinstance(ha.conns[0][-1], dict)
                       and ha.conns[0][-1].get("type") == "unsubscribe_events")
    frames = ha.binaries()
    assert len(frames) == 5 and all(f[0] == HA_HID and len(f) == 1 + 1920 * 2 for f in frames)
    assert await until(lambda: gw.audit(id=reply["audit_id"])[0]["result"] == "ok")
    await hub.close()


async def test_hks_worker_falls_back_when_live_cannot_start(gw, ha):
    ha.refuse[SPEAKER] = f"{SPEAKER} is not a UniFi Protect speaker"
    add_speaker(gw)
    await gw.login("avery", "owner")
    hub = await gw.socket()
    reply = await ticket(gw, hub)
    got = await run_worker(gw, reply["result"]["ticket"])
    assert got["sent"] == 0 and got["said"][0] == {"id": 1, "error": f"{SPEAKER} is not a UniFi Protect speaker"}
    got = await run_worker(gw, "spent-or-forged")                               # auth_invalid
    assert got["sent"] == 0 and got["said"] and "error" in got["said"][0]       # the card: s.fail -> the clip
    r = await gw.command(hub, id=7, **talk())                                    # and the clip still goes
    assert r["result"] == {"ok": True, "bytes": len(CLIP)}
    await hub.close()


async def test_home_assistant_s_socket_is_ready_before_the_page_opens_its_own(gw, ha):
    """A press waited on the gateway, the page's socket, then Mantel's own socket to HA, one after the other, and
    the card gave up on live after 1.5 s (the house, 2026-10-22): Mantel connects and signs in to HA as the ticket
    is issued, and the subscription (at the page's own rate) is all that is left when the page arrives."""
    add_speaker(gw)
    await gw.login("avery", "owner")
    hub = await gw.socket()
    tok = (await ticket(gw, hub))["result"]["ticket"]
    assert await until(lambda: ha.conns == [[{"type": "auth", "access_token": HA_TOKEN}]])   # signed in, nothing else
    ws = await open_talk(gw, tok)
    assert (await recv(ws))["type"] == "auth_ok"
    assert (await subscribe(ws, rate=44100))["success"] is True
    assert (await recv(ws))["event"]["handler_id"] == 1
    (conn,) = ha.conns                                           # the same socket, not a second one
    assert conn[1] == {"id": 1, "type": "mantel/talk/live", "entity_id": SPEAKER, "rate": 44100}
    await ws.close()
    await hub.close()
