"""The Intercom spool (intercom/spool.py): appends, cursors, a reader that waits, finish, the byte cap, WAV sizes,
the open-ended header (equal to Music Assistant's), and drop on cancel."""
import asyncio
import io
import struct
import wave

from mantel_server.intercom import spool as sp
from mantel_server.intercom.spool import Spool, streaming_wav_header, tone_wav, wav_header


def ma_streaming_wave_header(sample_rate: int, channels: int = 1, bit_depth: int = 16) -> bytes:
    """music_assistant/helpers/audio.py create_streaming_wave_header, Music Assistant 2.10.9 (copied, not imported):
    RIFF and data sizes both 0xFFFFFFFF."""
    byte_rate = sample_rate * channels * (bit_depth // 8)
    block_align = channels * (bit_depth // 8)
    return (
        b"RIFF"
        + struct.pack("<L", 0xFFFFFFFF)
        + b"WAVE"
        + b"fmt "
        + struct.pack("<LHHLLHH", 16, 1, channels, sample_rate, byte_rate, block_align, bit_depth)
        + b"data"
        + struct.pack("<L", 0xFFFFFFFF)
    )


async def collect(reader):
    return b"".join([c async for c in reader])


def test_streaming_header_is_ma_2_10_9_byte_for_byte():
    for rate in (16000, 24000, 44100, 48000):
        assert streaming_wav_header(rate) == ma_streaming_wave_header(rate)
    h = streaming_wav_header(24000)
    assert len(h) == 44
    assert h[4:8] == h[40:44] == b"\xff\xff\xff\xff"


def test_wav_header_has_real_sizes_and_parses():
    pcm = bytes(range(256)) * 10
    h = wav_header(24000, len(pcm))
    assert len(h) == 44 and h[:4] == b"RIFF" and h[8:12] == b"WAVE"
    assert struct.unpack("<L", h[4:8])[0] == 36 + len(pcm)
    assert struct.unpack("<L", h[40:44])[0] == len(pcm)
    with wave.open(io.BytesIO(h + pcm)) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (1, 2, 24000, len(pcm) // 2)
        assert w.readframes(10**6) == pcm


def test_tone_wav_silence_and_sine():
    quiet = tone_wav()
    with wave.open(io.BytesIO(quiet)) as w:
        assert w.getframerate() == 24000 and w.getnframes() == 4800
        assert set(w.readframes(4800)) == {0}
    assert tone_wav(freq=440, level=0.0) == quiet                 # level 0 is silence whatever the pitch
    soft = tone_wav(rate=8000, seconds=0.5, freq=440, level=0.2)
    with wave.open(io.BytesIO(soft)) as w:
        samples = struct.unpack("<4000h", w.readframes(4000))
    assert 0.15 * 32767 < max(samples) <= 0.2 * 32767 and min(samples) < 0


def test_basic_fields_and_cap():
    s = Spool(24000, 2.0)
    assert (s.rate, s.cap, s.nbytes, s.seconds) == (24000, 96000, 0, 0.0)
    assert not (s.finished or s.dropped or s.full)
    assert Spool(11025, 1.0).cap % 2 == 0
    assert s.append(bytes(48000)) is True
    assert s.nbytes == 48000 and s.seconds == 1.0


def test_append_truncates_at_the_cap_then_refuses():
    s = Spool(1000, 1.0)                                          # 2000 bytes
    assert s.append(b"\x01\x00" * 600) is True
    assert s.append(b"\x02\x00" * 600) is False                   # 400 bytes fit, the rest is cut
    assert s.nbytes == 2000 and s.full
    assert s.append(b"\x03\x00") is False
    assert s.nbytes == 2000
    assert s.to_wav()[44:].count(b"\x03") == 0


def test_odd_frames_are_joined_to_whole_samples():
    s = Spool(1000, 1.0)
    s.append(b"\x01\x02\x03")
    s.append(b"\x04")
    assert s.nbytes == 4 and s.to_wav()[44:] == b"\x01\x02\x03\x04"


def test_last_append_uses_the_clock():
    now = [100.0]
    s = Spool(1000, 1.0, clock=lambda: now[0])
    assert s.last_append == 100.0
    now[0] = 105.0
    s.append(bytes(10))
    assert s.last_append == 105.0
    now[0] = 109.0
    s.finish()
    assert s.ended_at == 109.0 and s.last_append == 105.0


def test_finish_stops_appends_and_to_wav_sizes():
    s = Spool(24000, 5.0)
    s.append(bytes(960))
    s.finish()
    assert s.finished and s.append(bytes(960)) is False and s.nbytes == 960
    wav = s.to_wav()
    assert len(wav) == 44 + 960 and wav[:44] == wav_header(24000, 960)
    s.finish()                                                    # twice is harmless


async def test_a_reader_gets_what_is_there_then_waits_then_ends_at_finish():
    s = Spool(1000, 5.0)
    s.append(b"ab")
    got = []

    async def reader():
        async for c in s.read():
            got.append(c)

    task = asyncio.create_task(reader())
    await asyncio.sleep(0.02)
    assert got == [b"ab"] and not task.done()                     # waiting for more
    s.append(b"cd")
    await asyncio.sleep(0.02)
    assert b"".join(got) == b"abcd" and not task.done()
    s.append(b"ef")
    s.finish()
    await asyncio.wait_for(task, 1)
    assert b"".join(got) == b"abcdef"                             # drained after finish


async def test_readers_have_their_own_cursors_and_a_start_offset():
    s = Spool(1000, 5.0)
    s.append(bytes(range(20)))
    s.finish()
    assert await collect(s.read()) == bytes(range(20))
    assert await collect(s.read()) == bytes(range(20))            # a second reader starts from the top
    assert await collect(s.read(start=6)) == bytes(range(6, 20))
    assert await collect(s.read(start=100)) == b""


async def test_big_audio_comes_out_in_bounded_chunks():
    s = Spool(48000, 5.0)
    s.append(bytes(100000))
    s.finish()
    chunks = [c async for c in s.read()]
    assert sum(map(len, chunks)) == 100000 and max(map(len, chunks)) <= sp.CHUNK


async def test_idle_ends_a_reader_with_nothing_new():
    s = Spool(1000, 5.0)
    s.append(b"ab")
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    assert await collect(s.read(idle=0.1)) == b"ab"
    assert 0.08 < loop.time() - t0 < 1.0
    assert not s.finished and not s.dropped                       # the spool itself is untouched


async def test_idle_restarts_after_each_chunk():
    s = Spool(1000, 5.0)

    async def feeder():
        for _ in range(4):
            await asyncio.sleep(0.06)
            s.append(b"xy")

    task = asyncio.create_task(feeder())
    got = await asyncio.wait_for(collect(s.read(idle=0.15)), 2)   # 0.24 s in all, never 0.15 s quiet
    await task
    assert got == b"xy" * 4


async def test_drop_forgets_the_audio_and_ends_readers_at_once():
    s = Spool(1000, 5.0)
    s.append(b"abcd")
    task = asyncio.create_task(collect(s.read(start=4)))
    await asyncio.sleep(0.02)
    s.drop()
    assert await asyncio.wait_for(task, 1) == b""
    assert s.dropped and s.nbytes == 0 and s.append(b"ab") is False
    assert await collect(s.read()) == b""                         # nothing left to hand to a late reader
    assert s.to_wav() == wav_header(1000, 0)


async def test_a_full_spool_ends_its_readers_after_draining():
    s = Spool(1000, 0.002)                                        # 4 bytes
    s.append(b"abcdef")
    assert s.full
    assert await asyncio.wait_for(collect(s.read()), 1) == b"abcd"


async def test_halt_and_wake_end_a_waiting_reader():
    s = Spool(1000, 5.0)
    stop = []
    task = asyncio.create_task(collect(s.read(halt=lambda: bool(stop))))
    await asyncio.sleep(0.02)
    assert not task.done()
    stop.append(1)
    s.wake()
    assert await asyncio.wait_for(task, 1) == b""
