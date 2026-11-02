"""Live talk (talk_live.py): a microphone streamed to a doorbell as you speak."""
from __future__ import annotations

import math
import socket
import struct
import threading
import time

import pytest

from custom_components.hk_frontend import talk_live

RATE = 48000
FRAME = RATE * talk_live.FRAME_MS // 1000 * 2          # bytes per frame


def pcm(ms, value=1000):
    return struct.pack("<h", value) * (RATE * ms // 1000)


def test_nothing_is_sent_until_the_prebuffer_is_in_hand():
    p = talk_live.Pacer(RATE)
    p.push(pcm(talk_live.PREBUFFER_MS - 20))
    assert not p.ready()
    p.push(pcm(20))
    assert p.ready() and len(p.pop()) == FRAME


def test_a_gap_becomes_silence_not_a_hole():
    p = talk_live.Pacer(RATE)
    p.push(pcm(talk_live.PREBUFFER_MS))
    frames = [p.pop() for _ in range(talk_live.PREBUFFER_MS // talk_live.FRAME_MS + 2)]
    assert all(len(f) == FRAME for f in frames), "every tick is a whole frame"
    assert frames[-1] == bytes(FRAME) and p.underruns == 2


def test_a_dry_spell_is_one_faded_gap_then_a_whole_cushion_not_stutter():
    """Late clumps must not play as on-off-on-off: once dry, nothing plays
    until PREBUFFER_MS is back."""
    p = talk_live.Pacer(RATE)
    p.push(pcm(talk_live.PREBUFFER_MS + 10, 8000))
    p.ready()
    for _ in range(talk_live.PREBUFFER_MS // talk_live.FRAME_MS):
        p.pop()
    last = p.pop()                                  # 10 ms of audio, then dry
    tail = struct.unpack("<%dh" % (len(last) // 2), last)
    edge = RATE * 10 // 1000
    assert tail[0] == 8000 and 0 <= tail[edge - 1] < 200, "faded out, not cut"
    assert p.gaps == 1
    p.push(pcm(talk_live.PREBUFFER_MS // 2, 8000))   # a late clump: not enough
    assert p.pop() == bytes(FRAME), "silence while the cushion refills -- no stutter"
    p.push(pcm(talk_live.PREBUFFER_MS // 2, 8000))
    back = struct.unpack("<%dh" % (FRAME // 2), p.pop())
    assert back[0] == 0 and back[-1] == 8000, "faded back in"
    assert p.gaps == 1 and p.underruns == 2


def test_a_flood_is_trimmed_so_the_delay_never_grows():
    p = talk_live.Pacer(RATE)
    p.push(pcm(talk_live.MAX_BUFFER_MS + 200))
    assert p.dropped_ms == pytest.approx(talk_live.MAX_BUFFER_MS + 200 - talk_live.PREBUFFER_MS)
    p.ready()
    n = 0
    while p.pop() != bytes(FRAME):
        n += 1
    assert n == talk_live.PREBUFFER_MS // talk_live.FRAME_MS


def test_letting_go_plays_out_what_is_left_without_counting_underruns():
    p = talk_live.Pacer(RATE)
    p.push(pcm(50))
    p.closing = True
    assert p.ready(), "a short burst still plays once the button is released"
    p.pop(); p.pop(); p.pop()
    assert p.drained() and p.underruns == 0


def test_a_warm_session_ends_a_talkspurt_once_let_go_and_waits_for_the_next():
    p = talk_live.Pacer(RATE)
    p.push(pcm(talk_live.PREBUFFER_MS))
    assert p.ready()
    for _ in range(talk_live.PREBUFFER_MS // talk_live.FRAME_MS):
        p.pop()
    assert not p.ended()
    for _ in range(talk_live.SPURT_END_MS // talk_live.FRAME_MS - 1):
        p.pop()
        assert not p.ended(), "a short gap mid-sentence is still the same talkspurt"
    p.pop()
    assert p.ended()
    p.rest()
    p.push(pcm(talk_live.PREBUFFER_MS - 20))
    assert not p.ready(), "the next hold waits for a whole cushion again"
    p.push(pcm(20))
    assert p.ready() and not p.ended()


class Seat:
    def __init__(self, name):
        self.name, self.heard, self.told_busy = name, [], False

    def tell(self, event):
        self.heard.append(event)


def test_one_talker_at_a_time_and_everyone_else_is_told_who():
    floor, a, b, c = talk_live.Floor(), Seat("Kitchen"), Seat("Hall"), Seat("Phone")
    floor.join(a); floor.join(b)
    assert floor.claim(a) and floor.claim(a)
    assert b.heard == [{"talker": "Kitchen"}] and a.heard == []
    assert not floor.claim(b) and not floor.claim(b)
    assert b.heard[-1] == {"busy": "Kitchen"} and b.heard.count({"busy": "Kitchen"}) == 1, "told once"
    floor.join(c)
    assert c.heard == [{"talker": "Kitchen"}], "a sheet opened mid-talk knows at once"
    floor.release(a)
    assert b.heard[-1] == {"talker": None} and c.heard[-1] == {"talker": None}
    assert floor.claim(b) and a.heard[-1] == {"talker": "Hall"}
    floor.leave(b)
    assert floor.holder is None and a.heard[-1] == {"talker": None}, "a closed sheet lets go"


@pytest.mark.enable_socket
def test_a_live_stream_is_steady_rtp_opus_at_real_time(socket_enabled):
    """The real encoder and muxer, to a UDP port on this machine."""
    pytest.importorskip("av")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 0))
    sock.settimeout(0.3)
    got, stop = [], threading.Event()

    def rx():
        while not stop.is_set():
            try:
                got.append((time.monotonic(), sock.recvfrom(4096)[0]))
            except socket.timeout:
                pass

    reader = threading.Thread(target=rx, daemon=True)
    reader.start()
    target = talk_live.Target(f"rtp://127.0.0.1:{sock.getsockname()[1]}", "opus", 24000)
    talk = talk_live.LiveTalk(target, RATE)
    talk.start()
    t0, n, chunk = time.monotonic(), 0, RATE // 25      # 40 ms chunks, 1 s
    while n < RATE:
        talk.feed(b"".join(struct.pack("<h", int(9000 * math.sin(2 * math.pi * 440 * (n + i) / RATE)))
                           for i in range(chunk)))
        n += chunk
        time.sleep(max(0, t0 + n / RATE - time.monotonic()))
    talk.finish()
    talk._thread.join(5)
    time.sleep(0.2)
    stop.set()
    reader.join(1)
    sock.close()
    assert talk.error is None and talk.pacer.underruns == 0
    assert 48 <= len(got) <= 53, "50 frames a second, one packet each"
    head = [struct.unpack(">BBHII", d[:12]) for _, d in got]
    assert head[0][0] >> 6 == 2, "RTP version 2"
    assert {b[3] - a[3] for a, b in zip(head, head[1:])} == {960}, "20 ms per packet (48 kHz RTP clock)"
    span = got[-1][0] - got[0][0]
    assert 0.9 < span < 1.35, "paced at real time, not sent in a burst"   # a burst is near 0; a busy Mac runs late


@pytest.mark.enable_socket
def test_a_warm_session_is_one_stream_per_hold_and_nothing_between(socket_enabled):
    """Two holds on one subscription: two RTP streams (each its own SSRC),
    and not a packet in the pause between them."""
    pytest.importorskip("av")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.1", 0))
    sock.settimeout(0.3)
    got, stop = [], threading.Event()

    def rx():
        while not stop.is_set():
            try:
                got.append((time.monotonic(), sock.recvfrom(4096)[0]))
            except socket.timeout:
                pass

    reader = threading.Thread(target=rx, daemon=True)
    reader.start()
    talk = talk_live.LiveTalk(talk_live.Target(f"rtp://127.0.0.1:{sock.getsockname()[1]}", "opus", 24000), RATE)
    spurts = []
    talk.on_spurt = spurts.append
    talk.start()
    time.sleep(0.3)                                    # warm: nothing sent before a word
    assert got == []

    def hold(secs):
        t0, n, chunk = time.monotonic(), 0, RATE // 25
        while n < RATE * secs:
            talk.feed(pcm(40, 6000))
            n += chunk
            time.sleep(max(0, t0 + n / RATE - time.monotonic()))

    hold(0.4)
    time.sleep((talk_live.PREBUFFER_MS + talk_live.SPURT_END_MS) / 1000 + 0.3)
    between = len(got)
    time.sleep(0.4)
    assert len(got) == between, "nothing between holds"
    hold(0.4)
    talk.finish()
    talk._thread.join(5)
    time.sleep(0.2)
    stop.set()
    reader.join(1)
    sock.close()
    assert talk.error is None and spurts == [True, False, True, False]
    ssrcs = {struct.unpack(">I", d[8:12])[0] for _, d in got}
    assert len(ssrcs) == 2, "each hold is a stream of its own"


async def test_only_a_unifi_protect_speaker_is_a_target(hass):
    with pytest.raises(ValueError):
        await talk_live.async_target(hass, "media_player.nope")
