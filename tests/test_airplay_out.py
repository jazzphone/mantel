"""Phase 35's AirPlay sender (cameras/airplay_out): HAP pairing against srptools' own numbers, pair-verify, and a show's
requests in the plan's order (docs/phase35/PLAN.md, "What was found", 4) against a fake screen (airplay_fakes.py)."""
from __future__ import annotations

import asyncio
import plistlib

import pytest

from airplay_fakes import FakeScreen
from mantel_server.cameras.airplay_out import hap, session
from mantel_server.cameras.airplay_out.rtsp import AirPlayError

# srptools' SRP-6a (pyatv's dependency) with a = 0x6b..6b, code 4067, its server's salt and b = 0x5a..5a
SALT = "eab102b3f02837d9c0db18c930da7761"
B = ("5fab60b6a6ce967c777620806ac5492b8f40067dcb1b4babed3a4a5fc40f53a44592635a7d64bc554b97050abecb70d3a724619060bee4"
     "728127a5b0913af1b5770e67b0a5fe53a9e328820098a9c6403bc9ccc6ae5313217b96302d24488813170fc34c2773b2a1a2a6c121530622"
     "1597161a6cbc376a364cd2814defebac1746220947c8c52c1fe2a1b0ef150f455fe23b96b7e24ab8266604ceb9f2557bc3b5ff9fa766e878"
     "086b1a202c10ce799b620faf70a70c71e477287bd043c98003d925fc4612d76fdab22efd91e6b6727f16ce8264f84e0df479afe966b6733d"
     "9458d44031fe5d74d7329c9eb80573f062d322d4a83b0a959d66cf64f3321522f186a1133591630afb9bd23758bb973abf24090d263c5851"
     "21e0091e7cb420aba7a76c6a2aef211418b5507cb1712afdd3db4b85ada62c695b0e09b7718c0cfbeebda253634876f232496de62baafe70"
     "523bfe2a78206ceb8776285056a52d6e366ecc5ef0bcbbcb330596e4155e101e81dfedc4cc7a7ed708ceef4e98e8a35079")
A = ("5c9b06e0f30982f8c1890ab7769a4f99082c33780cedf1d251efcff58acc4cde70a356a79113e91b75afc5ff4338a85a8a06a4d2894f33a6"
     "be42b4be64046e6d01831d72610adcedfac4913ec76393ce02f37cf21a7d2f285483b62b432bd3597ecaeb99dea519257b20a990e9a336f5"
     "b7ef415bf92015fabfd80374c11640dd5bf96783efd27ee4fdd73dcf456883504faa96d7c181c7a6fa5f8bd4594207eefc6fe82f01f3d109"
     "2132ffc22528732ca34b110104b27ffa62f7473357d9c6059a03848e4555f3d737b054b751ed7c148720debe82ab8ee160c3b3a4d6113db8"
     "07b924ac602d4ea185c4a9e43ae94a517a786fe4da63e1abf7a2292104106886865d01020ec0b00f280c0de4ecd3569861d06f2d5b373994"
     "0e9739ec80e7958684047866c3cf5c029301e5f3f682f0634c55940fbed4178cb0c3fdedf6513074321483f8a9a0359f8cb92413deb05bbc"
     "3517687f96e1a8dcd411605d480973e58e91538bc4df29fa1c86decb7be6160f24adcd773fe7ebffda03258803797fde")
M1 = ("c4da3aa33c63dd1c446447913ba16c782eecd75ae2d042b630c0b99595072cee0229c8c10533a588a24cfda1a6a4484b5a39285f0f34aa30"
      "a05b23825e0e0ad6")
M2 = ("4cbd39c5f4e82cec23a95c8d97e20dbddd459dc716a717bea6868e86ba24bff3a401ff52aec1af13a4018b6347fdc84c5ee294a5f0f452d2"
      "be2cb69e803481e0")


def test_srp_matches_srptools():
    """The client's A and proof, and the screen's proof it checks, are srptools' to the byte: the numbers pyatv pairs
    Apple's screens with."""
    p = hap.PairSetup(a=int("6b" * 32, 16))
    m3 = hap.read_tlv(p.m3(hap.write_tlv([(hap.SALT, bytes.fromhex(SALT)), (hap.PUBLIC_KEY, bytes.fromhex(B))]), "4067"))
    assert m3[hap.PUBLIC_KEY].hex() == A and m3[hap.PROOF].hex() == M1
    p.m5(hap.write_tlv([(hap.PROOF, bytes.fromhex(M2))]))                   # the screen's proof is accepted ...
    with pytest.raises(hap.PairingError) as bad:
        p.m5(hap.write_tlv([(hap.PROOF, b"\x00" * 64)]))                   # ... a wrong one is a wrong code
    assert bad.value.code == 2


def test_tlv_splits_and_joins_long_values():
    raw = hap.write_tlv([(hap.PUBLIC_KEY, bytes(range(256)) * 2), (hap.SEQ, b"\x02")])
    assert hap.read_tlv(raw) == {hap.PUBLIC_KEY: bytes(range(256)) * 2, hap.SEQ: b"\x02"}


def test_framing_round_trips_in_blocks():
    a, b = hap.Framing(b"k" * 32, b"j" * 32), hap.Framing(b"j" * 32, b"k" * 32)
    big = bytes(3000)
    sealed = a.encrypt(big)
    assert b.decrypt(sealed[:500]) == b""                                    # a partial block waits
    assert b.decrypt(sealed[500:]) == big
    assert b.decrypt(a.encrypt(b"two")) == b"two"                             # the counters move together


def test_credentials_are_pyatvs_format():
    c = hap.Credentials(b"\x01" * 32, b"\x02" * 32, b"psi", b"CLIENT")
    assert hap.Credentials.loads(c.dumps()) == c and c.dumps().count(":") == 3
    with pytest.raises(ValueError):
        hap.Credentials.loads("ab:cd")


def test_now_playing_client_is_the_wire_format_a_homeview_reads():
    """The 63-byte record an iPhone's Safari sends, field for field (captured 2026-11-24)."""
    got = session.now_playing_client("com.apple.WebKit.GPU", "com.apple.mobilesafari", "Safari", pid=81963)
    assert got.hex().startswith("08ab800512146")
    assert b"com.apple.WebKit.GPU" in got and b"com.apple.mobilesafari" in got and got.endswith(b"Safari")
    assert len(got) == 63


async def _paired(screen: FakeScreen) -> hap.Credentials:
    p = await session.Pairing.begin("127.0.0.1", screen.port)
    return await p.finish(screen.code)


async def test_pairing_shows_the_code_for_mantel_and_keeps_a_pairing():
    screen = await FakeScreen().start()
    try:
        creds = await _paired(screen)
        assert screen.pin_shown_for == ["Mantel"]                  # without the name a HomeView shows no code
        assert creds.atv_id == screen.atv_id and creds.client_id in screen.paired
        # a wrong code
        p = await session.Pairing.begin("127.0.0.1", screen.port)
        with pytest.raises(hap.PairingError) as bad:
            await p.finish("0000")
        assert bad.value.code == 2
    finally:
        await screen.close()


async def test_a_show_sends_the_plans_steps_in_order():
    screen = await FakeScreen().start()
    try:
        creds = await _paired(screen)
        screen.requests.clear()
        show = session.Show("127.0.0.1", creds, screen.port)
        url = "https://house.example/go2rtc/key/K/api/stream.m3u8?src=mantel_tv_4_1_hls&mp4"
        await show.start(url)
        steps = []
        for what, headers, data in screen.requests:
            if what.startswith("SETUP"):
                steps.append("SETUP " + ("rc" if data.get("isRemoteControlOnly") else
                                         "streams" if "streams" in data else data.get("timingProtocol", "")))
            elif what == "POST /command" and "inner" in data:
                steps.append(f"stream{data['stream']}:{data['inner']['type']}")
            elif what == "POST /command":
                steps.append(data["type"])
            elif not what.startswith("POST /pair"):
                steps.append(what)
        assert steps == ["SETUP rc", "SETUP PTP", "updateMRNowPlayingInfo", "SETUP streams", "updateMRPlaybackState",
                         "updateMRSupportedCommands", "updateMRNowPlayingClient", "updateMRPlaybackState",
                         "updateMRNowPlayingClient", "stream1:insertPlayQueueItem", "stream1:setProperty",
                         "stream1:setRate"]
        item = next(d["inner"]["item"] for w, h, d in screen.requests if isinstance(d, dict) and "inner" in d and d["inner"]["type"] == "insertPlayQueueItem")
        assert item["Content-Location"] == url and item["mediaType"] == "streaming"
        video_app = [d for w, h, d in screen.requests if w == "POST /command" and isinstance(d, dict) and d.get("type") == "updateMRNowPlayingClient"][-1]
        assert b"com.apple.WebKit.GPU" in video_app["params"]["mrNowPlayingClient"]   # the picture's condition
        rc = next(d for w, h, d in screen.requests if w.startswith("SETUP") and isinstance(d, dict) and "streams" in d)
        assert rc["streams"][0]["channelID"].startswith(screen.psi + "-RCS-")
        # an event from the screen is answered and kept
        await screen.event({"type": "updateMRNowPlayingInfo"})
        for _ in range(50):
            if screen.answers:
                break
            await asyncio.sleep(0.01)
        assert screen.answers == ["RTSP/1.0 200 OK"] and show.seen == ["updateMRNowPlayingInfo"]
        # Mantel stops it: rate 0 and a teardown, then the connection goes
        await show.stop()
        assert show.ended.is_set() and show.why == "stopped"
        assert [w for w, h, d in screen.requests][-1] == "TEARDOWN " + f"rtsp://127.0.0.1/{show.conn.session_id}"
    finally:
        await screen.close()


async def test_the_screen_ending_the_show_ends_it_here(monkeypatch):
    monkeypatch.setattr(session, "FEEDBACK_S", 0.02)
    screen = await FakeScreen().start()
    ended = []
    try:
        creds = await _paired(screen)
        show = session.Show("127.0.0.1", creds, screen.port, on_end=lambda s: ended.append(s.why))
        await show.start("https://house.example/x.m3u8")
        await asyncio.sleep(0.08)
        assert any(w == "POST /feedback" for w, h, d in screen.requests)      # kept alive
        screen.stop()
        await asyncio.wait_for(show.ended.wait(), 2)
        assert ended and ended[0] in ("the screen closed the show", "the screen stopped answering")
    finally:
        await screen.close()


async def test_a_screen_that_forgot_mantel_is_said_so():
    screen = await FakeScreen().start()
    try:
        creds = await _paired(screen)
        screen.refuse_verify = True                    # reset, or Mantel removed in the screen's own settings
        with pytest.raises(hap.PairingError) as bad:
            await session.Show("127.0.0.1", creds, screen.port).start("https://house.example/x.m3u8")
        assert bad.value.code == 2
        other = await FakeScreen().start()             # another screen answering at the address: refused
        try:
            with pytest.raises(hap.PairingError):
                await session.verified("127.0.0.1", creds, other.port)
        finally:
            await other.close()
    finally:
        await screen.close()


async def test_a_screen_that_answers_an_error_stops_the_start():
    screen = await FakeScreen().start()
    try:
        creds = await _paired(screen)
        orig = screen._handle

        def refuse(start, headers, body, state):
            if start.startswith("SETUP") and b"streams" in body:
                return 400, b"", {}, None
            return orig(start, headers, body, state)
        screen._handle = refuse
        show = session.Show("127.0.0.1", creds, screen.port)
        with pytest.raises(AirPlayError):
            await show.start("https://house.example/x.m3u8")
        assert show.ended.is_set() and show.why == "did not start"
    finally:
        await screen.close()


def test_plist_bodies_are_binary():
    from mantel_server.cameras.airplay_out.rtsp import _body
    raw, ctype = _body({"a": 1})
    assert raw.startswith(b"bplist") and ctype == "application/x-apple-binary-plist"
    assert plistlib.loads(raw) == {"a": 1}
