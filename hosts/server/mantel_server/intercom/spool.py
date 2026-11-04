"""The spool: where an Intercom broadcast's audio waits until Music Assistant fetches it (docs/phase17/INTERCOM.md "The spool").

The page sends s16le mono PCM in small frames. The relay appends them here, and the stream listener serves the
spool to MA as a WAV: a Message is finished first and served whole with a real Content-Length; Live is served as
it fills, after an open-ended header. The audio lives in memory only, is capped at the mode's limit, and is
forgotten the moment a broadcast is cancelled (``drop``). Nothing here touches disk or the network.

``append`` is synchronous (the relay calls it from a frame handler), so waiting readers are woken by swapping an
``asyncio.Event`` rather than with a Condition, which would need the lock held to notify.
"""
from __future__ import annotations

import asyncio
import math
import struct
import time
from collections.abc import AsyncIterator, Callable

FRAME = 1                       # binary frames from the page: [FRAME][s16le mono PCM]
CHUNK = 16384                   # the most one read() yields at a time
BYTES_PER_SAMPLE = 2            # 16-bit mono


def _fmt(rate: int) -> bytes:
    """The 'fmt ' chunk: PCM, mono, 16-bit."""
    return b"fmt " + struct.pack("<LHHLLHH", 16, 1, 1, rate, rate * BYTES_PER_SAMPLE, BYTES_PER_SAMPLE, 16)


def wav_header(rate: int, nbytes: int) -> bytes:
    """The 44-byte RIFF/WAVE header for ``nbytes`` of PCM, with real sizes."""
    return b"RIFF" + struct.pack("<L", 36 + nbytes) + b"WAVE" + _fmt(rate) + b"data" + struct.pack("<L", nbytes)


def streaming_wav_header(rate: int) -> bytes:
    """The header for audio whose length isn't known yet: RIFF and data sizes 0xFFFFFFFF.

    Byte-equal to Music Assistant 2.10.9's ``create_streaming_wave_header`` for mono 16-bit (its comment: clients
    honoring the WAV length fields must not cut the stream off).
    """
    return b"RIFF" + struct.pack("<L", 0xFFFFFFFF) + b"WAVE" + _fmt(rate) + b"data" + struct.pack("<L", 0xFFFFFFFF)


def tone_wav(rate: int = 24000, seconds: float = 0.2, freq: float | None = None, level: float = 0.0) -> bytes:
    """A finite WAV: silence (``level`` 0 or no ``freq``) or a soft sine (``level`` 0..1 of full scale)."""
    n = max(0, int(rate * seconds))
    if freq is None or level <= 0:
        pcm = bytes(n * BYTES_PER_SAMPLE)
    else:
        amp = min(1.0, level) * 32767
        pcm = struct.pack(f"<{n}h", *(int(amp * math.sin(2 * math.pi * freq * i / rate)) for i in range(n)))
    return wav_header(rate, len(pcm)) + pcm


class Spool:
    """One broadcast's audio, appended by the relay and read (any number of times) by the stream listener."""

    def __init__(self, rate: int, max_seconds: float, clock: Callable[[], float] = time.monotonic):
        self.rate = int(rate)
        self.cap = int(self.rate * BYTES_PER_SAMPLE * max_seconds) & ~1      # whole samples
        self.finished = False
        self.dropped = False
        self.full = False
        self.last_append = clock()
        self.ended_at: float | None = None      # clock() when finished or dropped (the link's "end plus 15 s")
        self._clock = clock
        self._data = bytearray()
        self._odd = b""                         # a frame's odd last byte, joined to the next frame
        self._tick = asyncio.Event()

    @property
    def nbytes(self) -> int:
        return len(self._data)

    @property
    def seconds(self) -> float:
        return len(self._data) / (self.rate * BYTES_PER_SAMPLE)

    def _wake(self) -> None:
        tick, self._tick = self._tick, asyncio.Event()
        tick.set()

    wake = _wake        # public: the links wake readers when a link is killed

    def append(self, pcm: bytes) -> bool:
        """Add PCM. True if all of it was kept; False once the spool is full, finished or dropped, or when this
        call hit the cap (the part that fit is kept and ``full`` is set)."""
        if self.finished or self.dropped or self.full:
            return False
        pcm = self._odd + bytes(pcm)
        self._odd = b""
        if len(pcm) % 2:
            pcm, self._odd = pcm[:-1], pcm[-1:]
        room = self.cap - len(self._data)
        kept = pcm[:room]
        if kept:
            self._data += kept
            self.last_append = self._clock()
            self._wake()
        if len(kept) < len(pcm) or len(self._data) >= self.cap:
            self.full = True
            self._odd = b""
            self._wake()
        return len(kept) == len(pcm) and not self.full

    def finish(self) -> None:
        """No more audio. Readers drain what is there, then end."""
        if not (self.finished or self.dropped):
            self.finished = True
            self.ended_at = self._clock()
            self._wake()

    def drop(self) -> None:
        """Forget the audio (Cancel, Re-record, a dropped socket). Readers end at once."""
        self.dropped = True
        if self.ended_at is None:
            self.ended_at = self._clock()
        self._data = bytearray()
        self._odd = b""
        self._wake()

    async def read(self, start: int = 0, idle: float | None = None,
                   halt: Callable[[], bool] | None = None) -> AsyncIterator[bytes]:
        """Yield the audio from byte ``start``, waiting for more as it arrives.

        Ends after ``finish`` (once drained), at ``drop``, when ``halt()`` is true (checked each time the reader
        wakes; ``wake()`` makes it wake), or after ``idle`` seconds with nothing new. Each reader has its own
        cursor, so a retried fetch starts again from the top.
        """
        cursor = start - start % 2
        while True:
            if self.dropped or (halt is not None and halt()):
                return
            if cursor < len(self._data):
                chunk = bytes(self._data[cursor:cursor + CHUNK])
                cursor += len(chunk)
                yield chunk
                continue
            if self.finished or self.full:
                return
            tick = self._tick
            try:
                await asyncio.wait_for(tick.wait(), idle)
            except TimeoutError:
                return

    def to_wav(self) -> bytes:
        """The whole spool as a finite WAV (real sizes)."""
        return wav_header(self.rate, len(self._data)) + bytes(self._data)
