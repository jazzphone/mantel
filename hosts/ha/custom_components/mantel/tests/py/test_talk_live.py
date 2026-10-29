"""Mantel Link's port of HK Frontend's (the same tests). Live talk (talk_live.py): a microphone streamed to a doorbell as you speak."""
from __future__ import annotations

import struct

import pytest

from custom_components.mantel import talk_live

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


# The real encoder and muxer to a UDP port (test_a_live_stream_is_steady_rtp_opus_at_real_time) is HK Frontend's
# suite's: it needs PyAV, which Home Assistant ships and this test venv doesn't, and Mantel Link's suite runs with no
# skips. The code under it (LiveTalk, Pacer) is the same file: hk_core/link/talk_live.py.


async def test_only_a_unifi_protect_speaker_is_a_target(hass):
    with pytest.raises(ValueError):
        await talk_live.async_target(hass, "media_player.nope")
