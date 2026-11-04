"""The Intercom stream listener (intercom/listener.py), on a real in-process listener (port 0): only
/s/<token>.wav, one identical bare 404 for every refusal, Message with a Content-Length, Live chunked and ending
on finish and on silence, no cookie/CORS/Server header, and the token never in a log record."""
import asyncio
import logging
from types import SimpleNamespace

import aiohttp
import pytest

from mantel_server.intercom import listener as lis
from mantel_server.intercom.links import Links
from mantel_server.intercom.listener import StreamListener
from mantel_server.intercom.spool import Spool, streaming_wav_header, wav_header

LAN = SimpleNamespace(lan_networks=("127.0.0.0/8",))
PUBLIC = SimpleNamespace(lan_networks=("10.0.0.0/8",))        # 127.0.0.1 is outside: a "public" peer


@pytest.fixture
async def stack():
    made = []

    async def make(cfg=LAN, **kw):
        links = Links(cfg=cfg, **kw)
        listener = StreamListener(links, "127.0.0.1", 0)
        await listener.start()
        session = aiohttp.ClientSession(base_url=f"http://127.0.0.1:{listener.port}")
        made.append((listener, session))
        return links, listener, session

    yield make
    for listener, session in made:
        await session.close()
        await listener.stop()


def message(links, pcm=bytes(range(200)) * 5):
    spool = Spool(24000, 30)
    spool.append(pcm)
    spool.finish()
    token, link = links.mint(spool, mode="message", finite=True, limit_s=30)
    return token, link, pcm


def live(links, rate=24000):
    spool = Spool(rate, 60)
    token, link = links.mint(spool, mode="live", finite=False, limit_s=60)
    return token, link, spool


async def shape(resp):
    """What a caller can see of a response, minus the clock."""
    headers = {k: v for k, v in resp.headers.items() if k.lower() != "date"}
    return resp.status, headers, await resp.read()


BARE_404 = (404, {"Cache-Control": "no-store", "Content-Length": "0"}, b"")


async def test_start_stop_and_port(stack):
    links, listener, session = await stack()
    assert listener.running and listener.port > 0
    await listener.stop()
    assert not listener.running
    with pytest.raises(aiohttp.ClientConnectionError):
        await session.get("/s/x.wav")
    await listener.stop()                                         # twice is harmless
    await listener.start()
    assert listener.running
    await listener.start()                                        # so is starting twice


async def test_message_is_a_whole_wav_with_content_length(stack):
    links, _, session = await stack()
    token, link, pcm = message(links)
    async with session.get(f"/s/{token}.wav") as r:
        assert r.status == 200
        assert r.headers["Content-Type"] == "audio/wav"
        assert r.headers["Content-Length"] == str(44 + len(pcm))
        assert r.headers["Accept-Ranges"] == "none"
        assert r.headers["Cache-Control"] == "no-store"
        assert "chunked" not in r.headers.get("Transfer-Encoding", "")
        assert await r.read() == wav_header(24000, len(pcm)) + pcm
    await asyncio.wait_for(link.fetch_ended.wait(), 1)
    assert link.fetch_started.is_set() and not link.ended_early


async def test_head_gives_the_headers_and_claims_nothing(stack):
    links, _, session = await stack()
    token, link, pcm = message(links)
    for _ in range(3):
        async with session.head(f"/s/{token}.wav") as r:
            assert r.status == 200 and r.headers["Content-Type"] == "audio/wav"
            assert r.headers["Content-Length"] == str(44 + len(pcm))
            assert await r.read() == b""
    assert link.peer is None and link.gets == 0 and not link.fetch_started.is_set()
    for want in (200, 200, 404):                                  # HEAD didn't use the claim or the retry
        async with session.get(f"/s/{token}.wav") as r:
            assert r.status == want


async def test_second_same_peer_get_works_once_and_the_third_does_not(stack):
    links, _, session = await stack()
    token, _, pcm = message(links)
    bodies = []
    for _ in range(3):
        async with session.get(f"/s/{token}.wav") as r:
            bodies.append((r.status, await r.read()))
    assert [b[0] for b in bodies] == [200, 200, 404]
    assert bodies[0][1] == bodies[1][1] and len(bodies[0][1]) == 44 + len(pcm)
    assert bodies[2][1] == b""


async def test_every_refusal_is_the_identical_bare_404(stack):
    clock = [0.0]
    links, _, session = await stack(cfg=LAN, clock=lambda: clock[0])
    good, link, _ = message(links)
    expired, _, _ = message(links)
    killed, klink, _ = message(links)
    links.kill(klink)
    used, _, _ = message(links)
    for _ in range(2):
        async with session.get(f"/s/{used}.wav"):
            pass
    shapes = []
    for token in ("A" * 43, "short", "z" * 128, expired, killed, used):
        if token == expired:
            clock[0] = 31.0                                       # past the Message's 30 s; `good` expires too
        async with session.get(f"/s/{token}.wav") as r:
            shapes.append(await shape(r))
    assert shapes == [BARE_404] * 6
    # a wrong-peer and a public-peer request on a live link
    links2, _, session2 = await stack(cfg=LAN, expected_peer=lambda: "10.0.0.9")
    other, _, _ = message(links2)
    links3, _, session3 = await stack(cfg=PUBLIC)
    public, _, _ = message(links3)
    for sess, token in ((session2, other), (session3, public)):
        async with sess.get(f"/s/{token}.wav") as r:
            assert await shape(r) == BARE_404
        async with sess.head(f"/s/{token}.wav") as r:
            assert (r.status, r.headers.get("Content-Length")) == (404, "0")


async def test_a_refused_link_stays_usable_by_the_right_peer(stack):
    peers = [None]
    links, _, session = await stack(expected_peer=lambda: peers[0])
    token, _, pcm = message(links)
    peers[0] = "10.0.0.9"
    async with session.get(f"/s/{token}.wav") as r:
        assert r.status == 404
    peers[0] = None
    async with session.get(f"/s/{token}.wav") as r:
        assert r.status == 200


async def test_a_killed_link_is_404(stack):
    links, _, session = await stack()
    token, link, _ = message(links)
    links.kill(link)
    async with session.get(f"/s/{token}.wav") as r:
        assert await shape(r) == BARE_404


async def raw(listener, method, target):
    """One request written by hand (the client libraries tidy '..', '//' and spaces away), as (status, headers, body)."""
    reader, writer = await asyncio.open_connection("127.0.0.1", listener.port)
    writer.write(f"{method} {target} HTTP/1.1\r\nHost: intercom\r\nConnection: close\r\n\r\n".encode())
    await writer.drain()
    data = await asyncio.wait_for(reader.read(), 3)
    writer.close()
    head, _, body = data.partition(b"\r\n\r\n")
    lines = head.decode().split("\r\n")
    headers = {}
    for line in lines[1:]:
        k, _, v = line.partition(": ")
        headers[k] = v
    return int(lines[0].split()[1]), {k: v for k, v in headers.items() if k not in ("Date", "Connection")}, body


NOT_ROUTABLE = [
    "/", "/api", "/api/auth/password", "/ws", "/ws/intercom", "/s", "/s/", "/s/.wav", "/s/x.wav/", "/s/x",
    "/s//x.wav", "/s/../s/x.wav", "/s/%2e%2e/x.wav", "/s/x.wav/extra", "/S/x.wav", "/static/app.js",
    "/favicon.ico", "/.well-known/x", "//", "/s/" + "a" * 5000 + ".wav", "/" + "a" * 20000,
    "/s/a%20b.wav", "/s/x.wav?next=/api", "/s/x.mp3","http://evil.example/s/x.wav", "/../etc/passwd",
]


@pytest.mark.parametrize("path", NOT_ROUTABLE, ids=[f"path{i}" for i in range(len(NOT_ROUTABLE))])
async def test_nothing_else_is_routable(stack, path):
    links, listener, _ = await stack()
    message(links)
    for method in ("GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"):
        status, headers, body = await raw(listener, method, path)
        assert status == 404 and body == b""
        assert headers == {"Cache-Control": "no-store", "Content-Length": "0"}


async def test_a_real_token_with_the_wrong_method_or_shape_is_404(stack):
    links, listener, _ = await stack()
    token, link, _ = message(links)
    for method in ("POST", "PUT", "DELETE", "PATCH", "OPTIONS", "TRACE"):
        assert await raw(listener, method, f"/s/{token}.wav") == BARE_404
    for path in (f"/s/{token}.wav/", f"/s/{token}", f"/s/{token}.wav.wav", f"/s/{token}.mp3", f"//s/{token}.wav",
                 f"/s/{token}.WAV", f"/s/{token}.wav/../x"):
        assert await raw(listener, "GET", path) == BARE_404
    assert link.peer is None
    status, _, body = await raw(listener, "GET", f"/s/{token}.wav?x=1")      # a query string is ignored, as usual
    assert status == 200 and len(body) > 44


async def test_no_cookie_cors_or_server_header_anywhere(stack):
    links, _, session = await stack()
    token, _, _ = message(links)
    ltoken, _, lspool = live(links)
    lspool.append(bytes(100))
    lspool.finish()
    for method, path in (("GET", f"/s/{token}.wav"), ("GET", f"/s/{token}.wav"), ("GET", f"/s/{ltoken}.wav"),
                         ("HEAD", f"/s/{ltoken}.wav"), ("GET", "/api"), ("OPTIONS", f"/s/{token}.wav")):
        async with session.request(method, path, headers={"Origin": "https://evil.example"}) as r:
            await r.read()
            names = {k.lower() for k in r.headers}
            assert "server" not in names and "set-cookie" not in names
            assert not any(n.startswith("access-control-") for n in names)
            assert "location" not in names
            assert r.headers["Cache-Control"] == "no-store"
    assert not session.cookie_jar.filter_cookies(session._base_url)


async def test_live_is_chunked_open_ended_and_ends_when_the_talker_does(stack):
    links, _, session = await stack()
    token, link, spool = live(links, rate=16000)
    spool.append(b"\x01\x00" * 100)
    async with session.get(f"/s/{token}.wav") as r:
        assert r.status == 200 and r.headers["Content-Type"] == "audio/wav"
        assert r.headers["Transfer-Encoding"] == "chunked" and "Content-Length" not in r.headers
        assert r.headers["Accept-Ranges"] == "none"
        head = await r.content.readexactly(44)
        assert head == streaming_wav_header(16000)
        first = await r.content.readexactly(200)
        await asyncio.wait_for(link.fetch_started.wait(), 1)
        assert not link.fetch_ended.is_set()                      # still open, waiting for more
        spool.append(b"\x02\x00" * 50)
        await asyncio.sleep(0.05)
        spool.append(b"\x03\x00" * 50)
        spool.finish()
        rest = await r.content.read()
    assert first == b"\x01\x00" * 100
    assert rest == b"\x02\x00" * 50 + b"\x03\x00" * 50
    await asyncio.wait_for(link.fetch_ended.wait(), 1)
    assert link.ended_early is False


async def test_live_ends_after_the_idle_time_with_no_audio(stack, monkeypatch):
    monkeypatch.setattr(lis, "LIVE_IDLE", 0.2)
    assert lis.LIVE_IDLE != 10.0
    links, _, session = await stack()
    token, link, spool = live(links)
    spool.append(bytes(400))
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    async with session.get(f"/s/{token}.wav") as r:
        body = await asyncio.wait_for(r.read(), 3)
    assert body == streaming_wav_header(24000) + bytes(400)
    assert 0.15 < loop.time() - t0 < 2.0
    await asyncio.wait_for(link.fetch_ended.wait(), 1)
    assert link.ended_early is True and not spool.finished       # the driver's failure signal


def test_the_real_idle_is_ten_seconds():
    assert lis.LIVE_IDLE == 10.0


async def test_live_notices_a_client_that_hung_up(stack):
    links, _, session = await stack()
    token, link, spool = live(links)
    spool.append(bytes(400))
    r = await session.get(f"/s/{token}.wav")
    await r.content.readexactly(44 + 400)
    r.close()                                                     # MA gave up
    await asyncio.wait_for(link.fetch_ended.wait(), 2)
    assert link.ended_early is True


async def test_a_dropped_or_killed_live_stream_ends_without_a_failure_signal(stack):
    links, _, session = await stack()
    for how in ("drop", "kill"):
        token, link, spool = live(links)
        spool.append(bytes(100))
        r = await session.get(f"/s/{token}.wav")
        await r.content.readexactly(144)
        await asyncio.sleep(0.02)
        spool.drop() if how == "drop" else links.kill(link)
        assert await asyncio.wait_for(r.content.read(), 2) == b""
        await asyncio.wait_for(link.fetch_ended.wait(), 1)
        assert link.ended_early is False
        r.close()


async def test_a_finished_live_broadcast_is_still_drained_when_its_link_is_killed(stack):
    links, _, session = await stack()
    token, link, spool = live(links)
    spool.append(b"\x07\x00" * 300)
    r = await session.get(f"/s/{token}.wav")
    await r.content.readexactly(44)
    spool.finish()
    links.kill(link)                                              # "a finished broadcast kills its link at once"
    assert await asyncio.wait_for(r.content.read(), 2) == b"\x07\x00" * 300
    async with session.get(f"/s/{token}.wav") as again:
        assert again.status == 404
    r.close()


async def test_stop_ends_streams_in_progress(stack):
    links, listener, session = await stack()
    token, link, spool = live(links)
    spool.append(bytes(100))
    r = await session.get(f"/s/{token}.wav")
    await r.content.readexactly(144)
    await asyncio.wait_for(listener.stop(), 6)
    assert link.dead
    r.close()


async def test_the_token_never_reaches_a_log_record(stack, caplog):
    caplog.set_level(logging.DEBUG)
    links, _, session = await stack()
    tokens = []
    for _ in range(2):
        token, link, _ = message(links)
        tokens.append(token)
        for method, path in (("HEAD", f"/s/{token}.wav"), ("GET", f"/s/{token}.wav"), ("GET", f"/s/{token}.wav"),
                             ("GET", f"/s/{token}.wav"), ("POST", f"/s/{token}.wav"), ("GET", f"/s/{token}")):
            async with session.request(method, path) as r:
                await r.read()
    ltoken, _, lspool = live(links)
    tokens.append(ltoken)
    lspool.append(bytes(100))
    lspool.finish()
    async with session.get(f"/s/{ltoken}.wav") as r:
        await r.read()
    async with session.get("/s/" + "q" * 70000 + ".wav") as r:    # past even this listener's line limit
        await r.read()
    assert any("claimed by 127.0.0.1" in r.getMessage() for r in caplog.records)
    for rec in caplog.records:
        text = " ".join([rec.getMessage(), str(rec.args), str(rec.exc_text), rec.name, rec.pathname])
        for token in tokens:
            assert token not in text
        assert "/s/" not in rec.getMessage()


async def test_message_with_a_dropped_connection_marks_the_fetch_ended(stack):
    links, _, session = await stack()
    token, link, _ = message(links, pcm=bytes(4_000_000))        # bigger than the socket buffers
    r = await session.get(f"/s/{token}.wav")
    await r.content.readexactly(1000)
    r.close()
    await asyncio.wait_for(link.fetch_ended.wait(), 3)
    assert link.fetch_started.is_set()
