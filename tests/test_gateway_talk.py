"""Doorbell talk-back through the command gateway (docs/phase3/GATEWAY.md "Doorbell talk-back"): the
recorded clip HK's doorbell sheet POSTs to hk_frontend's talk view is the gateway's ONE binary upload.
Over the real hub socket of a full app with the fake command connection (it checks every upload and
ticket like HaCommander and sends nothing anywhere); HaCommander.upload itself against a loopback
stand-in for Home Assistant's talk view."""
import base64
import json

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from gateway_fakes import HOUSE_AREAS, HOUSE_ENTITIES, gw, off, recv  # noqa: F401 -- fixtures
from mantel_server.identity.accounts import totp
from mantel_server.gateway import Refused, classify, load_writes
from mantel_server.ha_client import (UPLOAD_MAX_BYTES, CommandBlocked, CommandTicket, HaCommander, check_upload)
from mantel_server.server import COMMANDS_DISABLED

WRITES = load_writes()
SPEAKER = "media_player.doorbell_speaker"
PATH = f"/api/hk_frontend/talk?entity_id={SPEAKER}"
CLIP = b"\x1aE\xdf\xa3" + bytes(range(256)) * 8          # a fictional webm-ish clip, 2052 bytes


def talk(clip=CLIP, ctype="audio/webm;codecs=opus", path=PATH, **extra):
    return {"kind": "http", "method": "POST", "path": path, "content_type": ctype,
            "body_b64": base64.b64encode(clip).decode(), **extra}


def add_speaker(env):
    hub = env.app["hub"]
    hub.registry.load(HOUSE_AREAS, [], HOUSE_ENTITIES + [{"entity_id": SPEAKER, "area_id": "porch"}])
    hub.store.apply_event({"a": {SPEAKER: {"s": "idle", "a": {"friendly_name": "Doorbell speaker"},
                                           "lc": 1.0, "lu": 1.0}}})


# -- allowed --------------------------------------------------------------------------------------
async def test_owner_talk_back_is_audited_first_then_uploaded(gw, monkeypatch):
    add_speaker(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    seen = []
    real = gw.fake.upload

    async def upload(path, ctype, body, ticket):
        (row,) = gw.audit()                         # THE ROW FIRST: written, result not yet known
        seen.append((row["id"], row["decision"], row["result"], ticket.audit_id))
        return await real(path, ctype, body, ticket)

    monkeypatch.setattr(gw.fake, "upload", upload)
    reply = await gw.command(ws, **talk())
    assert reply["type"] == "command_result" and reply["result"] == {"ok": True, "bytes": len(CLIP)}
    assert seen == [(reply["audit_id"], "allowed", None, reply["audit_id"])]
    assert gw.fake.uploads == [(PATH, "audio/webm", CLIP, reply["audit_id"])]   # the bare type, the exact bytes
    assert gw.fake.sent == ["POST /api/hk_frontend/talk"]
    (row,) = gw.audit()
    assert row["kind"] == "http" and row["action"] == "POST /api/hk_frontend/talk" and row["result"] == "ok"
    assert json.loads(row["target"]) == [SPEAKER, "feature:cameras"] and row["sensitive"] == "camera"
    assert row["door"] == "lan" and row["role"] == "owner"
    assert base64.b64encode(CLIP).decode()[:40] not in json.dumps(row)   # the clip is never stored
    await ws.close()


async def test_adult_on_the_lan_needs_no_step_up(gw):
    add_speaker(gw)
    await gw.login("jordan", "adult")
    gw.now[0] += 3600                                # the sign-in factor is long stale
    ws = await gw.socket()
    reply = await gw.command(ws, **talk())
    assert "result" in reply and gw.fake.sent == ["POST /api/hk_frontend/talk"]
    await ws.close()


# -- refused roles ----------------------------------------------------------------------------------
async def test_a_child_is_refused_even_with_the_speaker_in_their_room(gw):
    add_speaker(gw)
    await gw.login("cody", "child")
    uid = gw.app["store"].db.execute("SELECT id FROM users WHERE username = 'cody'").fetchone()[0]
    gw.app["rbac"].set_scopes("user", uid, ["porch"])            # media players in the porch: allowed
    ws = await gw.socket()
    reply = await gw.command(ws, **talk())
    assert reply["error"]["code"] == "forbidden" and reply["error"]["reason"] == "explicit_deny"
    assert reply["error"]["target"] == "feature:cameras"         # cameras are off for a Child
    assert gw.fake.sent == []
    (row,) = gw.audit()
    assert (row["decision"], row["reason"], row["result"]) == ("denied", "explicit_deny", "not_sent")
    await ws.close()


async def test_a_guest_without_the_speaker_is_refused(gw):
    add_speaker(gw)
    await gw.login("gwen", "guest")
    ws = await gw.socket()
    reply = await gw.command(ws, **talk())
    assert reply["error"]["code"] == "forbidden" and reply["error"]["reason"] == "no_grant"
    assert reply["error"]["target"] == SPEAKER and gw.fake.sent == []
    await ws.close()


async def test_wall_tablets_follow_the_camera_rules_and_the_speaker_grant(gw):
    add_speaker(gw)
    await gw.login("avery", "owner")
    r = await gw.m.post("/api/devices/enroll", {"name": "Porch tablet", "room": "porch"})
    assert r.status == 201
    ws = await gw.socket()
    reply = await gw.command(ws, **talk())                       # its room holds the speaker: no PIN on the LAN
    assert "result" in reply
    await ws.close()
    await gw.login("avery", "owner")
    r = await gw.m.post("/api/devices/enroll", {"name": "Kitchen tablet", "room": "kitchen"})
    assert r.status == 201
    ws = await gw.socket()
    reply = await gw.command(ws, **talk())                       # another room: the speaker needs a grant
    assert reply["error"]["reason"] == "no_grant" and reply["error"]["target"] == SPEAKER
    assert gw.fake.sent == ["POST /api/hk_frontend/talk"]
    await ws.close()


# -- the tunnel (§7) -----------------------------------------------------------------------------------
async def _tunnel_adult(gw):
    await gw.login("jordan", "adult")
    seed = await gw.enroll_totp()
    gw.m.forget_cookies()
    gw.now[0] += 60
    r, body = await gw.m.sign_in("jordan", tunnel=True)
    r = await gw.m.post("/api/auth/totp/verify", {"pending": body["pending"], "code": totp(seed, gw.now[0])},
                        csrf=False, tunnel=True)
    assert r.status == 200
    return seed


async def test_on_the_tunnel_talk_back_needs_no_fresh_factor(gw):
    # decision 25: no step-up on any door; the role's tunnel switches decide (next test)
    add_speaker(gw)
    await _tunnel_adult(gw)
    gw.now[0] += 3600                                            # the sign-in factor is long stale
    ws = await gw.socket(tunnel=True)
    reply = await gw.command(ws, **talk())
    assert reply["type"] == "command_result" and "result" in reply, reply
    assert gw.fake.sent == ["POST /api/hk_frontend/talk"]
    (row,) = [r for r in gw.audit() if r["kind"] != "config"]          # (not the TOTP enrolment's row)
    assert (row["decision"], row["reason"], row["result"], row["door"], row["sensitive"], row["step_up"]) == \
        ("allowed", "granted", "ok", "tunnel", "camera", None)
    await ws.close()


async def test_on_the_tunnel_the_roles_switches_apply(gw):
    add_speaker(gw)
    await _tunnel_adult(gw)                                      # a fresh factor: only the switches can refuse
    ws = await gw.socket(tunnel=True)
    gw.app["rbac"].set_override("adult", {"tunnel_cameras": False})
    reply = await gw.command(ws, **talk())
    assert reply["error"]["reason"] == "tunnel_cameras_off"
    gw.app["rbac"].set_override("adult", {"tunnel_cameras": True, "tunnel_sensitive": False})
    reply = await gw.command(ws, id=2, **talk())
    assert reply["error"]["reason"] == "tunnel_lan_only"
    gw.app["rbac"].clear_override("adult")
    reply = await gw.command(ws, id=3, **talk())
    assert "result" in reply
    assert gw.fake.sent == ["POST /api/hk_frontend/talk"]
    await ws.close()


async def test_a_guest_with_a_speaker_grant_never_talks_over_the_tunnel(gw):
    add_speaker(gw)
    from mantel_server.identity.rbac import Grant
    await gw.login("gwen", "guest")
    uid = gw.app["store"].db.execute("SELECT id FROM users WHERE username = 'gwen'").fetchone()[0]
    gw.app["rbac"].add_grant(Grant(effect="allow", actions=("control",), resource_kind="entity",
                                   resource=SPEAKER, users={uid}))
    ws = await gw.socket()
    reply = await gw.command(ws, **talk())
    assert reply["error"]["reason"] == "explicit_deny" and reply["error"]["target"] == "feature:cameras"
    assert gw.fake.sent == []
    await ws.close()


# -- commands disabled ----------------------------------------------------------------------------------
async def test_commands_disabled_refuses_talk_back_exactly_as_any_command(off):
    add_speaker(off)
    await off.login("avery", "owner")
    ws = await off.socket(expect_caps=False)
    await ws.send_json({"type": "command", "id": 5, **talk()})
    assert await recv(ws) == {**COMMANDS_DISABLED, "id": 5}
    await ws.close()
    assert off.audit() == [] and off.app["commander"] is None


# -- the allowlist, the type and the size ------------------------------------------------------------------
def test_talk_back_classification():
    c = classify(talk(), WRITES)
    assert c.upload == (PATH, "audio/webm", CLIP) and c.http is None
    assert [(k.action, k.entity_id, k.feature) for k in c.checks] == [
        ("media_player.play_media", SPEAKER, None), ("camera.talk", None, "cameras")]
    for ctype in ("audio/ogg;codecs=opus", "audio/mp4", "AUDIO/WEBM", "audio/x-wav"):
        assert classify(talk(ctype=ctype), WRITES).upload[1] == ctype.split(";")[0].lower()
    big = classify(talk(clip=b"x" * UPLOAD_MAX_BYTES), WRITES)
    assert len(big.upload[2]) == UPLOAD_MAX_BYTES


@pytest.mark.parametrize("bad, code", [
    (talk(path="/api/hk_frontend/talk_x?entity_id=media_player.x"), "unsupported_body"),
    (talk(path="/api/services/media_player/play_media"), "unsupported_body"),
    (talk(path="/api/config/config_entries/flow"), "unsupported_body"),
    (talk(path="/api/hk_frontend/talk?entity_id=lock.front_door"), "unsupported_body"),
    (talk(path="/api/hk_frontend/talk?entity_id=media_player.x&entity_id=media_player.y"), "unsupported_body"),
    (talk(path="/api/hk_frontend/talk?entity_id=media_player.x&x=1"), "unsupported_body"),
    (talk(path="/api/hk_frontend/talk/abc"), "unsupported_body"),
    (talk(path="/api/hk_frontend/talk"), "unsupported_body"),
    (talk(path="https://evil.example/api/hk_frontend/talk?entity_id=media_player.x"), "invalid_command"),
    (talk(path="/api/../api/hk_frontend/talk?entity_id=media_player.x"), "invalid_command"),
    ({**talk(), "method": "PUT"}, "unsupported_body"),
    ({**talk(), "method": "GET"}, "not_a_write"),
    (talk(ctype="text/html"), "unsupported_body"),
    (talk(ctype="image/svg+xml"), "unsupported_body"),
    (talk(ctype="application/octet-stream"), "unsupported_body"),
    (talk(ctype=None), "unsupported_body"),
    ({**talk(), "body_b64": "not base64!"}, "unsupported_body"),
    ({**talk(), "body_b64": "QUJD="}, "unsupported_body"),
    ({**talk(), "body_b64": 12}, "unsupported_body"),
    (talk(clip=b"x" * 199), "unsupported_body"),
    (talk(clip=b"x" * (UPLOAD_MAX_BYTES + 1)), "body_too_large"),
    (talk(clip=b"x" * (UPLOAD_MAX_BYTES + 3000)), "body_too_large"),
    ({**talk(), "body": {"a": 1}}, "invalid_command"),
    ({**talk(), "extra": 1}, "invalid_command"),
    ({"kind": "http", "method": "POST", "path": PATH, "body": {"clip": "x"}}, "unsupported_body"),
    ({"kind": "http", "method": "POST", "path": PATH}, "unsupported_body"),
])
def test_only_the_talk_back_clip_may_carry_bytes(bad, code):
    with pytest.raises(Refused) as e:
        classify(bad, WRITES)
    assert e.value.code == code, (bad, e.value.code)


async def test_a_refused_upload_is_audited_and_sends_nothing(gw):
    add_speaker(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()
    reply = await gw.command(ws, **talk(path="/api/config/config_entries/flow"))
    assert reply["error"]["code"] == "unsupported_body"
    reply = await gw.command(ws, id=2, **talk(ctype="text/html"))
    assert reply["error"]["code"] == "unsupported_body"
    reply = await gw.command(ws, id=3, **talk(clip=b"x" * (UPLOAD_MAX_BYTES + 1)))
    assert reply["error"]["code"] == "body_too_large"
    assert gw.fake.sent == []
    assert [(r["decision"], r["reason"], r["result"]) for r in gw.audit()] == [
        ("denied", "unsupported_body", "not_sent"), ("denied", "unsupported_body", "not_sent"),
        ("denied", "body_too_large", "not_sent")]
    await ws.close()


async def test_home_assistants_refusal_is_the_rows_result(gw, monkeypatch):
    from mantel_server.ha_client import HaCommandError
    add_speaker(gw)
    await gw.login("avery", "owner")
    ws = await gw.socket()

    async def refuse(path, ctype, body, ticket):
        check_upload("POST", path, ctype, body, ticket)
        raise HaCommandError("http_502", "media_player.doorbell_speaker could not play it")

    monkeypatch.setattr(gw.fake, "upload", refuse)
    reply = await gw.command(ws, **talk())
    assert reply["error"]["code"] == "http_502" and gw.audit()[0]["result"] == "error:http_502"
    await ws.close()


# -- the command connection's own guard -------------------------------------------------------------------
def test_the_upload_guard_needs_its_own_ticket_and_the_allowlist():
    with pytest.raises(CommandBlocked):
        check_upload("POST", PATH, "audio/webm", CLIP, CommandTicket(0, "upload"))        # no audit row
    with pytest.raises(CommandBlocked):
        check_upload("POST", PATH, "audio/webm", CLIP, CommandTicket(1, "http"))          # an http ticket is not an upload one
    with pytest.raises(CommandBlocked):
        check_upload("POST", "/api/x", "audio/webm", CLIP, CommandTicket(2, "upload"))
    with pytest.raises(CommandBlocked):
        check_upload("POST", PATH, "audio/webm;codecs=opus", CLIP, CommandTicket(3, "upload"))  # bare type only
    with pytest.raises(CommandBlocked):
        check_upload("POST", PATH, "audio/webm", b"x" * (UPLOAD_MAX_BYTES + 1), CommandTicket(4, "upload"))
    with pytest.raises(CommandBlocked):
        check_upload("PUT", PATH, "audio/webm", CLIP, CommandTicket(5, "upload"))
    t = CommandTicket(6, "upload")
    check_upload("POST", PATH, "audio/webm", CLIP, t)
    with pytest.raises(CommandBlocked):
        check_upload("POST", PATH, "audio/webm", CLIP, t)                                 # one shot


async def test_ha_commander_posts_the_raw_clip_to_the_talk_view():
    """HaCommander.upload over real HTTP to a loopback stand-in for hk_frontend's talk view."""
    from mantel_server.config import Config
    got = []

    async def talk_view(request):
        got.append({"path": request.path_qs, "type": request.headers.get("Content-Type"),
                    "auth": request.headers.get("Authorization"), "body": await request.read()})
        return web.json_response({"ok": True, "bytes": len(got[-1]["body"])})

    ha = web.Application()
    ha.router.add_post("/api/hk_frontend/talk", talk_view)
    async with TestServer(ha, host="127.0.0.1") as server:
        cfg = Config(commands_enabled=True, ha_url=str(server.make_url("")).rstrip("/"))
        commander = HaCommander(cfg, "fictional-token", WRITES)
        try:
            result = await commander.upload(PATH, "audio/webm", CLIP, CommandTicket(9, "upload"))
            with pytest.raises(CommandBlocked):
                await commander.upload("/api/config/core/update", "audio/webm", CLIP, CommandTicket(10, "upload"))
        finally:
            await commander.close()
    assert result == {"ok": True, "bytes": len(CLIP)}
    assert got == [{"path": PATH, "type": "audio/webm", "auth": "Bearer fictional-token", "body": CLIP}]
    # Mantel Link's view first (404 here: a Home Assistant with only HK Frontend), then HK Frontend's
    assert commander.sent == ["POST /api/mantel/talk", "POST /api/hk_frontend/talk"]


async def test_the_clip_goes_to_mantel_links_talk_view_when_ha_has_it():
    """With Mantel Link's talk view (its talk.py) the clip goes there, once: HK Frontend is not needed."""
    from mantel_server.config import Config
    got = []

    async def talk_view(request):
        got.append(request.path_qs)
        return web.json_response({"ok": True})
    ha = web.Application()
    ha.router.add_post("/api/mantel/talk", talk_view)
    async with TestServer(ha, host="127.0.0.1") as server:
        commander = HaCommander(Config(commands_enabled=True, ha_url=str(server.make_url("")).rstrip("/")),
                                "fictional-token", WRITES)
        try:
            assert await commander.upload(PATH, "audio/webm", CLIP, CommandTicket(11, "upload")) == {"ok": True}
        finally:
            await commander.close()
    assert got == [PATH.replace("/api/hk_frontend/", "/api/mantel/")]
    assert commander.sent == ["POST /api/mantel/talk"]
