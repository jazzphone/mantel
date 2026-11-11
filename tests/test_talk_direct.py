"""Talking at a UniFi Protect doorbell directly (talk_direct.py, phase 5 of docs/phase13/CAMERAS-DIRECT.md): the
relay's decisions unchanged, the doorbell's side Mantel's own -- Protect's talkback session asked for once, the
tablet's PCM paced and encoded to Opus over RTP by hk_core/talk/core.py, and nothing sent to Home Assistant."""
import asyncio
import socket
import struct

import pytest

from gateway_fakes import gw, recv  # noqa: F401 -- fixtures
from hk_core.talk.core import Target
from mantel_server.ha.ha_client import HaCommandError
from mantel_server.talk_direct import DirectTalk, Speaker
from test_talk_live import SPEAKER, add_speaker, ha, open_talk, subscribe, ticket, until  # noqa: F401

pytest.importorskip("av")


class Door:
    """The doorbell's UDP 7004, on this machine."""

    def __init__(self):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.setblocking(False)
        self.asked = 0

    async def session(self, camera_id):
        assert camera_id == "cam-front"
        self.asked += 1
        return Target(f"rtp://127.0.0.1:{self.sock.getsockname()[1]}", "opus", 24000)

    def packets(self):
        out = []
        while True:
            try:
                out.append(self.sock.recv(4096))
            except BlockingIOError:
                return out


@pytest.fixture
def door(gw):
    d = Door()
    direct = DirectTalk()
    direct.set_speakers({SPEAKER: Speaker("cam-front", d.session)})
    gw.app["direct_talk"] = direct
    yield d
    d.sock.close()


async def test_a_direct_doorbell_hears_the_tablet_and_home_assistant_is_not_asked(gw, ha, door):
    add_speaker(gw)
    await gw.login("avery", "owner")
    hub = await gw.socket()
    reply = await ticket(gw, hub)
    ws = await open_talk(gw, reply["result"]["ticket"])
    assert (await recv(ws))["type"] == "auth_ok"
    assert (await subscribe(ws))["success"] is True
    assert (await recv(ws))["event"] == {"handler_id": 1, "rate": 24000, "codec": "opus", "warm": True}
    tone = struct.pack("<h", 6000) * 1920                      # 40 ms at 48 kHz
    for _ in range(15):                                          # 0.6 s of a hold
        await ws.send_bytes(b"\x01" + tone)
        await asyncio.sleep(0.04)
    got = []
    assert await until(lambda: bool(got.extend(door.packets()) or got), timeout=3), "Opus over RTP reached the doorbell"
    assert all(p[0] >> 6 == 2 for p in got), "RTP version 2"
    await ws.send_json({"id": 9, "type": "unsubscribe_events", "subscription": 2})
    await until(lambda: gw.audit(id=reply["audit_id"])[0]["result"] is not None)
    assert gw.audit(id=reply["audit_id"])[0]["result"] == "ok"
    assert door.asked == 1
    assert all(not c[1:] for c in ha.conns), "Home Assistant was not asked for anything"
    await ws.close()
    await hub.close()


async def test_a_console_that_cannot_give_a_session_is_refused_so_the_card_sends_its_clip(gw, ha, door):
    async def broken(_cid):
        raise OSError("no route")
    gw.app["direct_talk"].set_speakers({SPEAKER: Speaker("cam-front", broken)})
    add_speaker(gw)
    await gw.login("avery", "owner")
    hub = await gw.socket()
    reply = await ticket(gw, hub)
    ws = await open_talk(gw, reply["result"]["ticket"])
    assert (await recv(ws))["type"] == "auth_ok"
    r = await subscribe(ws)
    assert r["success"] is False and r["error"]["code"] == "unavailable"
    assert await until(lambda: gw.audit(id=reply["audit_id"])[0]["result"] == "error:unavailable")
    await hub.close()


async def test_the_session_is_asked_for_once_and_kept():
    asked = []

    async def session(cid):
        asked.append(cid)
        return Target("rtp://127.0.0.1:9", "opus", 24000)
    now = [0.0]
    d = DirectTalk(clock=lambda: now[0])
    d.set_speakers({SPEAKER: Speaker("cam", session)})
    await d.target(SPEAKER); await d.target(SPEAKER)
    assert asked == ["cam"]
    now[0] = 301
    await d.target(SPEAKER)
    assert asked == ["cam", "cam"]
    assert not d.handles("media_player.other")
    with pytest.raises(HaCommandError):
        await d.target("media_player.other")
