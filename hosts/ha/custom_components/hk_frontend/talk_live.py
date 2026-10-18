"""LIVE TALK: the screen's microphone, streamed to a doorbell as you speak.

The doorbell sheet's talk button (hk-doorbell-card). talk.py's clip is a
walkie-talkie -- record, release, upload, play -- so the first word reaches
the door only after the last one is spoken. This streams instead, without
making the audio crackle:

    ws  hk_frontend/talk/live  {entity_id, rate}      (a subscription)
        -> event {handler_id, rate, codec}
    binary frames  [handler_id][s16le mono PCM at `rate`]   every ~40 ms
    unsubscribe    -> the rest of the buffer plays, then the session ends

THE DOORBELL ALREADY TAKES A LIVE STREAM. A UniFi Protect camera's talkback
is a UDP/RTP port on the camera (7004), and Protect's public API hands out a
session for it (POST /v1/cameras/<id>/talkback-session ->
rtp://<camera>:7004, opus 24 kHz). uiprotect's own TalkbackStream feeds it a
FILE through PyAV, reading ahead before it plays a note -- fine for a clip,
useless for a voice. So this opens the same session and runs its own PyAV
encoder on audio as it arrives. Same muxer, same codec, same port; only the
source differs.

WHY IT DOES NOT CRACKLE. Audio from a tablet over Wi-Fi arrives in bursts.
A decoder fed in bursts runs dry between them, and a dry decoder is the
crackle. So the sender never forwards what arrives: it keeps PREBUFFER_MS in
hand and emits one frame every FRAME_MS on its own clock, a steady stream at
exactly real time. A late burst is absorbed by the buffer; a real gap
becomes one faded SILENCE while the cushion refills, never a hole and
never on-off stutter (see Pacer); and a flood (a stalled socket letting go) is
trimmed back to the buffer so the delay never grows. Stats go to the debug
log at the end of every session.

THE BROWSER SENDS RAW PCM, not MediaRecorder's WebM: a WebM stream has to be
parsed by the reader and arrives in whatever chunks the recorder likes. PCM
frames of a known size need nothing but the encoder, which resamples to the
camera's rate itself.

Only UniFi Protect speakers can do this. For anything else (or if the
session cannot open) the card falls back to talk.py's clip.
"""
from __future__ import annotations

from array import array
from dataclasses import dataclass, field
from fractions import Fraction
import logging
import threading
import time

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

_LOGGER = logging.getLogger(__name__)

FRAME_MS = 20
PREBUFFER_MS = 200        # the jitter a tablet on Wi-Fi needs; the whole delay we add
MAX_BUFFER_MS = 500       # beyond this, drop the oldest: never let the delay grow
FADE_MS = 5               # the ramp either side of a gap, so it does not click
MAX_SESSION_S = 120       # a stuck button must not hold the doorbell open
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
                    take = min(n, len(self._buf))
                    out = self._ramp(bytes(self._buf[:take]), down=False) + bytes(n - take)
                    del self._buf[:take]
                    return out
                if not self.closing:
                    self.underruns += 1
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
            return out

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

    def abort(self) -> None:
        self.pacer.closing = True
        self._stop.set()

    def _run(self, open_output) -> None:
        try:
            self._stream(open_output)
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
        with opener() as out:
            st = out.add_stream(encoder, rate=self.target.rate)
            st.layout = "mono"
            samples = self.pacer.frame_bytes // 2
            tb = Fraction(1, self.in_rate)
            pts = 0
            tick = FRAME_MS / 1000
            nxt = None
            deadline = time.monotonic() + MAX_SESSION_S
            while not self._stop.is_set():
                now = time.monotonic()
                if now > deadline:
                    break
                if not self.pacer.ready():
                    if self.pacer.closing:
                        break                      # let go before a word arrived
                    self._stop.wait(0.005)
                    continue
                if self.pacer.drained():
                    break
                frame = av.AudioFrame(format="s16", layout="mono", samples=samples)
                frame.planes[0].update(self.pacer.pop())
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
            if not self._stop.is_set():
                for packet in st.encode(None):
                    out.mux(packet)


TARGET_TTL_S = 300
_targets: dict[str, tuple[float, Target]] = {}


async def async_cached_target(hass: HomeAssistant, entity_id: str) -> Target:
    """async_target, remembered for TARGET_TTL_S: the session is a fixed
    port on the camera, and asking Protect for it on every press would be a
    round trip in front of the first word of each one."""
    hit = _targets.get(entity_id)
    if hit and time.monotonic() - hit[0] < TARGET_TTL_S:
        return hit[1]
    target = await async_target(hass, entity_id)
    _targets[entity_id] = (time.monotonic(), target)
    return target


async def async_target(hass: HomeAssistant, entity_id: str) -> Target:
    """The talkback session for a UniFi Protect speaker entity.

    Reaches the camera through the media_player entity the unifiprotect
    integration made (its `device` is the uiprotect Camera). Raises
    ValueError when the entity is not one."""
    from homeassistant.components.media_player import DATA_COMPONENT  # noqa: PLC0415

    comp = hass.data.get(DATA_COMPONENT)
    ent = comp.get_entity(entity_id) if comp else None
    cam = getattr(ent, "device", None)
    if ent is None or ent.platform.platform_name != "unifiprotect" or cam is None:
        raise ValueError(f"{entity_id} is not a UniFi Protect speaker")
    if not cam.feature_flags.has_speaker:
        raise ValueError(f"{entity_id} has no speaker")
    api = cam.api
    if getattr(api, "_api_key", None):
        s = await api.create_talkback_session_public(cam.id)
        return Target(s.url, s.codec, int(s.sampling_rate))
    ts = cam.talkback_settings                         # no API key: the old way
    return Target(f"udp://{cam.host}:{ts.bind_port}", ts.type_fmt.value, int(ts.sampling_rate))


def async_register(hass: HomeAssistant) -> None:
    @websocket_api.websocket_command({
        vol.Required("type"): "hk_frontend/talk/live",
        vol.Required("entity_id"): str,
        vol.Required("rate"): vol.In(RATES),
    })
    @websocket_api.async_response
    async def ws_live(hass, connection, msg):
        try:
            target = await async_cached_target(hass, msg["entity_id"])
        except Exception as err:  # noqa: BLE001 - the card falls back to a clip
            connection.send_error(msg["id"], "not_supported", str(err))
            return
        if target.codec not in CODECS:
            connection.send_error(msg["id"], "not_supported", f"codec {target.codec}")
            return
        talk = LiveTalk(target, msg["rate"])

        @callback
        def on_audio(_hass, _conn, payload: bytes) -> None:
            talk.feed(payload[: len(payload) - len(payload) % 2])

        handler_id, unregister = connection.async_register_binary_handler(on_audio)

        @callback
        def done() -> None:
            # Unsubscribe (the button let go) or the socket closed.
            unregister()
            talk.finish()

        @callback
        def failed(message: str) -> None:
            _targets.pop(msg["entity_id"], None)     # ask Protect afresh next time
            # The screen keeps a clip of the same words and sends that instead.
            if connection.subscriptions.get(msg["id"]) is done:
                connection.send_event(msg["id"], {"error": message})

        talk.on_error = lambda m: hass.loop.call_soon_threadsafe(failed, m)
        connection.subscriptions[msg["id"]] = done
        talk.start()
        connection.send_result(msg["id"])
        connection.send_event(msg["id"], {"handler_id": handler_id,
                                          "rate": target.rate, "codec": target.codec})

    websocket_api.async_register_command(hass, ws_live)
