"""The Intercom's security review (2026-11-03): one test for each thing the review changed, on the real stream listener
(port 0, loopback) and the full app of tests/intercom_fakes.py. Nothing real is contacted; no sound is made.

* the listener answers a request its parser refuses with the same bare 404 (never aiohttp's 400 page, which echoes the
  request line and names aiohttp in a ``Server`` header), and never logs that request line (it may carry a token);
* a connection that sends no whole request is closed after IDLE_CLOSE; too many from one address are closed at once;
* X-Forwarded-For is never believed: the socket's peer decides;
* the policy tick sweeps expired links;
* Check Reach never opens the port while house commands are off, and runs one at a time;
* Send Test's rate limit holds for two presses in flight;
* Live: Cancel, or a socket that ends mid-talk by any other path, closes the run and gives the play row its result.
"""
from __future__ import annotations

import asyncio
import logging
from types import SimpleNamespace

import pytest

import intercom_fakes as IF
from intercom_fakes import KITCHEN, chunks, closed, recv_until, send_audio, until
from mantel_server.intercom import listener as lis
from mantel_server.intercom import routes as RT
from mantel_server.intercom.links import Links
from mantel_server.intercom.listener import StreamListener
from mantel_server.intercom.spool import Spool

LAN = SimpleNamespace(lan_networks=("127.0.0.0/8",))
PUBLIC = SimpleNamespace(lan_networks=("10.0.0.0/8",))        # 127.0.0.1 is outside: a "public" peer


@pytest.fixture
async def listening():
    made = []

    async def make(cfg=LAN, **kw):
        links = Links(cfg=cfg, **kw)
        listener = StreamListener(links, "127.0.0.1", 0)
        await listener.start()
        made.append(listener)
        return links, listener

    yield make
    for listener in made:
        await listener.stop()


def message(links):
    spool = Spool(24000, 30)
    spool.append(bytes(range(200)) * 5)
    spool.finish()
    return links.mint(spool, mode="message", finite=True, limit_s=30)


async def raw(port: int, data: bytes, wait: float = 3) -> bytes:
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write(data)
    await writer.drain()
    try:
        return await asyncio.wait_for(reader.read(), wait)
    finally:
        writer.close()


def split(resp: bytes) -> tuple[int, dict, bytes]:
    head, _, body = resp.partition(b"\r\n\r\n")
    lines = head.decode("latin-1").split("\r\n")
    headers = dict(line.split(": ", 1) for line in lines[1:] if ": " in line)
    return int(lines[0].split()[1]), {k: v for k, v in headers.items() if k not in ("Date", "Connection")}, body


# ------------------------------------------------------------------------- the listener's malformed requests
async def test_a_request_the_parser_refuses_gets_the_bare_404_and_its_line_is_never_logged(listening, caplog):
    links, listener = await listening()
    token, link = message(links)
    bad = [
        f"G@T /s/{token}.wav HTTP/1.1\r\nHost: a\r\n\r\n",                                    # a bad method
        f"GET /s/{token}.wav HTTP/9.9\r\nHost: a\r\n\r\n",                                    # a bad version
        f"GET /s/{token}.wav HTTP/1.1\r\nHost a\r\n\r\n",                                     # a bad header
        f"GET /s/{token}.wav HTTP/1.1\r\nHost: a\r\nX: {'a' * 20000}\r\n\r\n",                # a header too long
        f"GET /s/{token}.wav HTTP/1.1\r\nHost: a\r\nContent-Length: 3\r\n"
        f"Transfer-Encoding: chunked\r\n\r\n0\r\n\r\n",                                        # smuggling's shape
        "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n",                                                    # an HTTP/2 preface
        "\x00\x01\x02\r\n\r\n",                                                                # not HTTP at all
    ]
    with caplog.at_level(logging.DEBUG):
        for req in bad:
            status, headers, body = split(await raw(listener.port, req.encode()))
            assert (status, headers, body) == (404, {"Cache-Control": "no-store", "Content-Length": "0"}, b""), req[:20]
    assert link.peer is None and link.gets == 0, "a refused request claims nothing"
    for rec in caplog.records:
        text = rec.getMessage() + (logging.Formatter().formatException(rec.exc_info) if rec.exc_info else "")
        assert token not in text
    # and the link still works for the real fetch
    status, _, body = split(await raw(listener.port, f"GET /s/{token}.wav HTTP/1.1\r\nHost: a\r\n"
                                                     f"Connection: close\r\n\r\n".encode()))
    assert status == 200 and body.startswith(b"RIFF")


async def test_a_connection_with_no_whole_request_is_closed(listening, monkeypatch):
    monkeypatch.setattr(lis, "IDLE_CLOSE", 0.5)
    _, listener = await listening()
    reader, writer = await asyncio.open_connection("127.0.0.1", listener.port)
    writer.write(b"GET /s/abc")                                   # slow headers: never finished
    await writer.drain()
    got = await asyncio.wait_for(reader.read(), 5)                # EOF: the listener closed it
    assert got == b""
    writer.close()


async def test_too_many_connections_from_one_address_are_closed(listening, monkeypatch):
    monkeypatch.setattr(lis, "MAX_PER_PEER", 3)
    links, listener = await listening()
    conns = [await asyncio.open_connection("127.0.0.1", listener.port) for _ in range(5)]
    await asyncio.sleep(0.1)
    shut = 0
    for reader, _ in conns:
        try:
            if await asyncio.wait_for(reader.read(), 0.3) == b"":
                shut += 1
        except asyncio.TimeoutError:
            pass
    assert shut == 2, "the fourth and fifth were closed as they opened"
    for _, writer in conns:
        writer.close()
    await asyncio.sleep(0.1)
    token, _ = message(links)                                     # the port still answers once they are gone
    status, _, _ = split(await raw(listener.port, f"GET /s/{token}.wav HTTP/1.1\r\nHost: a\r\n"
                                                  f"Connection: close\r\n\r\n".encode()))
    assert status == 200


async def test_x_forwarded_for_is_never_believed(listening):
    links, listener = await listening(cfg=PUBLIC)                 # the socket's peer, 127.0.0.1, is "public"
    token, link = message(links)
    for header in ("X-Forwarded-For: 10.0.0.5", "Forwarded: for=10.0.0.5", "X-Real-IP: 10.0.0.5"):
        status, _, body = split(await raw(listener.port, f"GET /s/{token}.wav HTTP/1.1\r\nHost: a\r\n{header}\r\n"
                                                         f"Connection: close\r\n\r\n".encode()))
        assert (status, body) == (404, b"")
    assert link.peer is None
    links2, listener2 = await listening(cfg=LAN, expected_peer=lambda: "10.0.0.9")    # MA's own address
    token2, link2 = message(links2)
    status, _, _ = split(await raw(listener2.port, f"GET /s/{token2}.wav HTTP/1.1\r\nHost: a\r\n"
                                                   f"X-Forwarded-For: 10.0.0.9\r\nConnection: close\r\n\r\n".encode()))
    assert status == 404 and link2.peer is None


# ------------------------------------------------------------------------------------------ the full app
ic = IF.fixture(commands=True)
ic_off = IF.fixture(commands=False)


async def test_the_policy_tick_sweeps_expired_links(ic, monkeypatch):
    clock = [0.0]
    links = ic.host.links
    monkeypatch.setattr(links, "clock", lambda: clock[0])
    token, link = message(links)
    assert len(links) == 1
    await ic.relay.tick()
    assert len(links) == 1
    clock[0] = 31.0                                               # past a Message's 30 s unclaimed
    await ic.relay.tick()
    assert len(links) == 0 and link.dead


async def test_check_reach_never_opens_the_port_while_commands_are_off(ic_off):
    owner = await ic_off.actor("avery", "owner")
    assert ic_off.host.listener is None or not ic_off.host.listener.running
    status, body = await owner.post("/api/intercom/check")
    assert status == 200 and body["ok"] is False
    assert ic_off.host.listener is None or not ic_off.host.listener.running
    assert ic_off.ma.item_calls == [] and len(ic_off.host.links) == 0
    await ic_off.host.start_listener_for_check()                  # the host's own step refuses too
    assert ic_off.host.listener is None or not ic_off.host.listener.running


async def test_check_reach_runs_one_at_a_time(ic, monkeypatch):
    monkeypatch.setattr(RT, "CHECK_WAIT", 1.0)
    ic.ma.item_fetch = False                                      # MA never fetches: the first check waits
    owner = await ic.actor("avery", "owner")
    first = asyncio.create_task(owner.post("/api/intercom/check"))
    assert await until(lambda: ic.host.check_lock.locked())
    status, body = await owner.post("/api/intercom/check")
    assert status == 200 and body["ok"] is False and "already running" in body["message"]
    status, body = await first
    assert status == 200 and body["ok"] is False                  # could not reach (the fake didn't fetch)
    assert len(ic.ma.item_calls) == 1 and len(ic.host.links) == 0


async def test_send_test_rate_holds_for_two_presses_in_flight(ic):
    owner = await ic.actor("avery", "owner")
    a, b = await asyncio.gather(owner.post("/api/intercom/test", {"room": KITCHEN}),
                                owner.post("/api/intercom/test", {"room": KITCHEN}))
    assert sorted([a[0], b[0]]) == [200, 429], (a, b)
    assert len(ic.ma.announced()) == 1
    assert len(ic.host.links) == 0


async def live_talk(ic):
    ic.edit(live_allowed=True)
    avery = await ic.actor("avery", "owner")
    ws = await avery.talk("live")
    await ws.send_json({"type": "start", "rooms": [KITCHEN]})
    got = await recv_until(ws, "sending")
    assert got[-1]["type"] == "sending", got
    await send_audio(ws, chunks(5))
    assert await until(lambda: ic.play_rows() != [])
    (row,) = ic.play_rows()
    (s,) = ic.relay.sessions
    return ws, row["id"], s.broadcast


async def test_cancel_mid_live_ends_the_run_and_the_link_and_writes_the_row(ic):
    ws, aid, b = await live_talk(ic)
    await ws.send_json({"type": "cancel"})
    await closed(ws)
    assert await until(lambda: ic.audit(id=aid)[0]["result"] is not None)
    assert ic.audit(id=aid)[0]["result"] == "error:cancelled"
    assert not b.run.open and b.link.dead and len(ic.host.links) == 0
    assert ic.relay.floor is None and ic.relay.sessions == set()


async def test_a_socket_that_ends_mid_live_by_a_bad_frame_still_closes_the_run(ic):
    ws, aid, b = await live_talk(ic)
    await ws.send_bytes(b"\x07bad")                               # not a frame: the socket closes (1008)
    assert await closed(ws) == 1008
    assert await until(lambda: ic.audit(id=aid)[0]["result"] is not None)
    assert ic.audit(id=aid)[0]["result"] == "error:bad_frame"
    assert not b.run.open and b.link.dead and len(ic.host.links) == 0
    assert ic.relay.floor is None
