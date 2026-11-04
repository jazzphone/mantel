"""LIVE TALK'S CORE: the Pacer, the encoder and the one-talker Floor, with nothing of Home Assistant's.

Split out of hk_core/link/talk_live.py (2026-11-02, docs/phase13/CAMERAS-DIRECT.md phase 5) so that Mantel itself
can talk to a UniFi Protect doorbell on Docker and the LXC, where Home Assistant and Mantel Link are not in the
chain: Mantel opens the talkback session with Protect's public API and runs exactly this. Home Assistant's side
(the `<domain>/talk/live` subscription, finding a Protect speaker through HA's unifiprotect entities) stays in
talk_live.py, which imports everything here; its docstring is the whole story of why the audio is paced as it is.

PyAV (`av`) is imported only when a talkspurt starts: Home Assistant ships it, and Mantel's server image has it
for this (packaging/docker).

ONE STREAM PER SESSION, KEPT ALIVE BETWEEN HOLDS (measured at the house's G4 Doorbell Pro, 2026-11-02, by a 1 kHz
tone heard in the doorbell's own microphone). A NEW RTP stream loses its start: 0.4-0.7 s of a 1 s tone was heard,
speech arriving 0.8-1.1 s after the press, and the first stream after Protect hands out a talkback session was not
heard at all; a stream already flowing was heard whole, 0.37 s after the press. So a session's stream opens at its
first hold, with LEAD_MS of silence before the words, and then stays open, sending silence between holds (the
Pacer's dry state), until the session ends, it has been silent STREAM_IDLE_S, or ANOTHER session takes the floor:
then it is cut at once (``cut``, the Floor's doing), so two streams never reach the doorbell's one port together.
A talkspurt (``on_spurt``) still ends SPURT_END_MS after the last word, which frees the floor for the others.
"""
from __future__ import annotations

from array import array
from dataclasses import dataclass, field
from fractions import Fraction
import logging
import threading
import time

_LOGGER = logging.getLogger(__name__)

FRAME_MS = 20
PREBUFFER_MS = 200        # the jitter a tablet on Wi-Fi needs; the whole delay we add
MAX_BUFFER_MS = 500       # beyond this, drop the oldest: never let the delay grow
FADE_MS = 5               # the ramp either side of a gap, so it does not click
MAX_SESSION_S = 120       # a stuck button must not hold the doorbell open
SPURT_END_MS = 800        # dry this long (the button let go): the talkspurt ends (the floor is free again)
LEAD_MS = 400             # silence a new stream starts with: a Protect doorbell loses the start of a new stream
STREAM_IDLE_S = 30        # a stream silent this long closes (the next hold opens another, lead-in and all)
RATES = (8000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000)
CODECS = {"opus": ("libopus", "rtp"), "aac": ("aac", "adts")}


class Pacer:
    """PCM in, in any sizes; exactly one frame out per tick.

    Pure bookkeeping (no clock, no threads), so the rules are testable:

    * nothing is emitted until PREBUFFER_MS has arrived;
    * after that every pop() returns a whole frame;
    * WHEN IT RUNS DRY IT REBUFFERS. Emitting whatever has arrived and
      padding the rest with silence, frame by frame, plays a late clump from
      the tablet as on-off-on-off: choppy speech. So the first dry frame
      fades out and the pacer sends clean silence until PREBUFFER_MS is in
      hand again, then fades back in: one short gap, and the cushion is
      whole again for the next hiccup;
    * the buffer is trimmed back to PREBUFFER_MS past MAX_BUFFER_MS."""

    def __init__(self, rate: int, frame_ms: int = FRAME_MS,
                 prebuffer_ms: int = PREBUFFER_MS, max_ms: int = MAX_BUFFER_MS,
                 fade_ms: int = FADE_MS):
        self.frame_bytes = rate * frame_ms // 1000 * 2
        self._pre = rate * prebuffer_ms // 1000 * 2
        self._max = rate * max_ms // 1000 * 2
        self._fade = max(1, rate * fade_ms // 1000)
        self._buf = bytearray()
        self._lock = threading.Lock()
        self.started = False
        self.closing = False
        self._dry = False
        self.frames = 0
        self.underruns = 0
        self.gaps = 0
        self.dropped_ms = 0.0
        self._rate = rate
        self._frame_ms = frame_ms
        self._quiet = 0                 # silent frames since it ran dry (SPURT_END_MS)

    def push(self, pcm: bytes) -> None:
        with self._lock:
            self._buf += pcm
            if len(self._buf) > self._max:
                cut = len(self._buf) - self._pre
                cut -= cut % 2
                del self._buf[:cut]
                self.dropped_ms += cut / 2 / self._rate * 1000

    def ready(self) -> bool:
        """True once there is a frame to emit (the prebuffer was reached, or
        the speaker has let go and what is left should play out)."""
        with self._lock:
            if not self.started and (len(self._buf) >= self._pre or
                                     (self.closing and self._buf)):
                self.started = True
            return self.started

    def _ramp(self, pcm: bytes, down: bool) -> bytes:
        """A linear fade over the last (down) or first (up) FADE_MS."""
        a = array("h")
        a.frombytes(pcm)
        n = min(self._fade, len(a))
        for i in range(n):
            j = len(a) - n + i if down else i
            g = (n - i) / n if down else i / n
            a[j] = int(a[j] * g)
        return a.tobytes()

    def pop(self) -> bytes:
        with self._lock:
            n = self.frame_bytes
            self.frames += 1
            if self._dry:
                if len(self._buf) >= self._pre or (self.closing and self._buf):
                    self._dry = False
                    self._quiet = 0
                    take = min(n, len(self._buf))
                    out = self._ramp(bytes(self._buf[:take]), down=False) + bytes(n - take)
                    del self._buf[:take]
                    return out
                if not self.closing:
                    self.underruns += 1
                    self._quiet += 1
                return bytes(n)
            if len(self._buf) >= n:
                out = bytes(self._buf[:n])
                del self._buf[:n]
                return out
            # Dry: fade out what is left, then silence until the cushion is back.
            out = self._ramp(bytes(self._buf), down=True) + bytes(n - len(self._buf))
            self._buf.clear()
            if not self.closing:
                self.underruns += 1
                self.gaps += 1
                self._dry = True
                self._quiet = 1
            return out

    def ended(self) -> bool:
        """The talkspurt is over: dry for SPURT_END_MS (a warm session's button
        was let go and what it held has played)."""
        with self._lock:
            return self._dry and self._quiet * self._frame_ms >= SPURT_END_MS

    def rest(self) -> None:
        """Between talkspurts: nothing in hand, and the next one waits for a
        whole PREBUFFER_MS again."""
        with self._lock:
            self._buf.clear()
            self.started = False
            self._dry = False
            self._quiet = 0

    def has_audio(self) -> bool:
        with self._lock:
            return bool(self._buf)

    def speaking(self) -> bool:
        """Words are playing (started and not run dry)."""
        with self._lock:
            return self.started and not self._dry

    def drained(self) -> bool:
        with self._lock:
            return self.closing and not self._buf


@dataclass
class Target:
    """Where the audio goes: the talkback session."""
    url: str
    codec: str
    rate: int


@dataclass
class LiveTalk:
    """One held button: a Pacer and the thread that feeds the doorbell."""
    target: Target
    in_rate: int
    pacer: Pacer = field(init=False)
    error: str | None = None
    _stop: threading.Event = field(default_factory=threading.Event)
    _thread: threading.Thread | None = None
    _t0: float = field(default_factory=time.monotonic)
    on_error: object = None        # called from the thread with the message
    on_spurt: object = None        # called from the thread: True when a talkspurt starts, False when it ends
    spurts: int = 0
    streams: int = 0
    idle_s: float = STREAM_IDLE_S
    _cut: threading.Event = field(default_factory=threading.Event)

    def __post_init__(self) -> None:
        self.pacer = Pacer(self.in_rate)

    def start(self, open_output=None) -> None:
        self._thread = threading.Thread(target=self._run, args=(open_output,),
                                        name="hk_talk_live", daemon=True)
        self._thread.start()

    def feed(self, pcm: bytes) -> None:
        if not self.pacer.closing:
            self.pacer.push(pcm)

    def finish(self) -> None:
        """The speaker let go: play what is buffered, then stop."""
        self.pacer.closing = True

    def cut(self) -> None:
        """Another session took the floor: close this one's stream now (its silence must not reach the door
        beside theirs). The session stays open; its next hold opens a new stream."""
        self._cut.set()

    def abort(self) -> None:
        self.pacer.closing = True
        self._stop.set()

    def _run(self, open_output) -> None:
        try:
            self._stream(open_output)
            if not self.pacer.closing and not self._stop.is_set():
                # the time limit, with the subscription still open: a warm card opens another
                raise TimeoutError(f"the {MAX_SESSION_S} s limit")
        except Exception as err:  # noqa: BLE001 - reported to the screen
            self.error = str(err) or type(err).__name__
            _LOGGER.warning("live talk to %s failed: %s", self.target.url, self.error)
            if self.on_error:
                self.on_error(self.error)
        p = self.pacer
        _LOGGER.debug("live talk %s: %.1f s, %d frames, %d gaps (%d silent frames), %.0f ms dropped",
                      self.target.url, time.monotonic() - self._t0, p.frames,
                      p.gaps, p.underruns, p.dropped_ms)

    def _stream(self, open_output) -> None:
        import av  # noqa: PLC0415 - HA ships it; import off the event loop

        encoder, fmt = CODECS[self.target.codec]
        opener = open_output or (lambda: av.open(self.target.url, "w", format=fmt, timeout=5))
        deadline = time.monotonic() + MAX_SESSION_S
        while not self._stop.is_set() and time.monotonic() < deadline:
            if not self.pacer.has_audio():
                if self.pacer.closing:
                    break                          # let go before a word arrived
                self._stop.wait(0.005)
                continue
            self._cut.clear()
            self.streams += 1
            self._open(av, opener, encoder, deadline)
            if self.pacer.closing:
                break
            self.pacer.rest()                      # cut, or idle: the next hold opens a new stream

    def _open(self, av, opener, encoder, deadline: float) -> None:
        """One stream: LEAD_MS of silence, then the words; silence between holds; until the session ends, it is
        cut, or it has been silent idle_s."""
        with opener() as out:
            st = out.add_stream(encoder, rate=self.target.rate)
            st.layout = "mono"
            samples = self.pacer.frame_bytes // 2
            silence = bytes(self.pacer.frame_bytes)
            tb = Fraction(1, self.in_rate)
            pts = 0
            tick = FRAME_MS / 1000
            nxt = None
            lead = LEAD_MS // FRAME_MS
            talking = False
            quiet = time.monotonic()
            while not self._stop.is_set() and not self._cut.is_set():
                now = time.monotonic()
                if now > deadline or self.pacer.drained():
                    break
                if lead > 0 or not self.pacer.ready():
                    lead -= 1
                    pcm = silence
                else:
                    pcm = self.pacer.pop()
                if not talking and self.pacer.speaking():
                    talking = True
                    self.spurts += 1
                    if self.on_spurt:
                        self.on_spurt(True)
                elif talking and self.pacer.ended():
                    talking = False
                    quiet = now
                    if self.on_spurt:
                        self.on_spurt(False)
                elif not talking and lead <= 0 and now - quiet > self.idle_s:
                    break
                frame = av.AudioFrame(format="s16", layout="mono", samples=samples)
                frame.planes[0].update(pcm)
                frame.sample_rate = self.in_rate
                frame.time_base = tb
                frame.pts = pts
                pts += samples
                for packet in st.encode(frame):
                    out.mux(packet)
                # THE CLOCK: one frame per tick from the first one, and never
                # a burst to catch up after a stall -- restart the clock.
                nxt = (now if nxt is None else nxt) + tick
                wait = nxt - time.monotonic()
                if wait < -0.1:
                    nxt = time.monotonic()
                elif wait > 0 and self._stop.wait(wait):
                    break
            if talking and self.on_spurt:
                self.on_spurt(False)
            if not self._stop.is_set():
                for packet in st.encode(None):
                    out.mux(packet)


class Floor:
    """One talker at a time on one speaker (see ONE TALKER AT A TIME above).

    Members are the open sessions on the speaker, each with a `name` and a
    `tell(event)`. Pure bookkeeping on the event loop."""

    def __init__(self) -> None:
        self.members: list = []
        self.holder = None
        self.streamer = None           # whose stream is open at the door (it outlives a talkspurt: see core's docstring)

    def join(self, member) -> None:
        self.members.append(member)
        if self.holder is not None:
            member.tell({"talker": self.holder.name})

    def leave(self, member) -> None:
        if member in self.members:
            self.members.remove(member)
        if self.streamer is member:
            self.streamer = None
        self.release(member)

    def claim(self, member) -> bool:
        """May this member's audio go to the doorbell now?"""
        if self.holder is member:
            return True
        if self.holder is not None:
            if not getattr(member, "told_busy", False):
                member.told_busy = True
                member.tell({"busy": self.holder.name})
            return False
        self.holder = member
        member.told_busy = False
        if self.streamer is not None and self.streamer is not member:
            cut = getattr(self.streamer, "cut", None)
            if callable(cut):
                cut()                  # its silence must not reach the door beside these words
        self.streamer = member
        self._tell_others(member, {"talker": member.name})
        return True

    def release(self, member) -> None:
        if self.holder is not member:
            return
        self.holder = None
        for m in self.members:
            m.told_busy = False
        self._tell_others(member, {"talker": None})

    def _tell_others(self, member, event: dict) -> None:
        for m in list(self.members):
            if m is not member:
                m.tell(event)
