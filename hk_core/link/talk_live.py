"""LIVE TALK: the screen's microphone, streamed to a doorbell as you speak.

ONE FILE, TWO INTEGRATIONS: this is hk_core's (hk_core/link/), vendored into HK
Frontend and Mantel Link, whose own talk_live.py gives it their domain
(`hk_frontend/talk/live`, `mantel/talk/live`). The Pacer, the encoder and
the Floor live in hk_core/talk/core.py (2026-11-02), with nothing of Home
Assistant's, so Mantel runs them itself on Docker and the LXC.

The doorbell sheet's talk button (hk-doorbell-card). talk.py's clip is a
walkie-talkie -- record, release, upload, play -- so the first word reaches
the door only after the last one is spoken. This streams instead, without
making the audio crackle:

    ws  <domain>/talk/live  {entity_id, rate}      (a subscription)
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

A WARM SESSION (2026-11-02, docs/phase13/CAMERAS-DIRECT.md "Proper"
push-to-talk). The card opens its subscription when the doorbell sheet
opens, not at the press, so a press no longer waits on the chain (the
socket, the auth, Protect's session, the encoder) and the first word is not
clipped. Nothing reaches the doorbell until audio does. The session's
stream then opens with a short silent lead-in and stays open between holds,
sending silence, because a Protect doorbell loses the start of every NEW
stream (measured 2026-11-02: see hk_core/talk/core.py); it is cut the moment
another session takes the floor, so several open sheets never put streams
side by side on the doorbell's one port. A TALKSPURT (from the first word
until the pacer has been dry SPURT_END_MS) is what holds the floor. The first event says `warm: true`; a card that sees
it keeps the subscription across holds, an older one unsubscribes at each
release as before (and an older server, without `warm`, gets that too).

ONE TALKER AT A TIME (the Floor). The doorbell has one speaker. The first
session whose audio arrives holds the floor for its talkspurt; any other
session's audio meanwhile is dropped, and it is told `{busy: <name>}` once.
Every other open session hears `{talker: <name>}` when the floor is taken and
`{talker: null}` when it is free again, so the button can say who is talking
before anyone presses. The name is the Home Assistant user's (for Mantel,
whose tablets share one user, Mantel's relay keeps a floor of its own with
the tablets' names in front of this one).
"""
from __future__ import annotations

from dataclasses import dataclass
import logging
import time

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from ..talk.core import (CODECS, FADE_MS, FRAME_MS, MAX_BUFFER_MS, MAX_SESSION_S,  # noqa: F401 -- re-exported
                         LEAD_MS, PREBUFFER_MS, RATES, SPURT_END_MS, STREAM_IDLE_S, Floor, LiveTalk,
                         Pacer, Target)

_LOGGER = logging.getLogger(__name__)


TARGET_TTL_S = 300
_targets: dict[str, tuple[float, Target]] = {}
_floors: dict[str, Floor] = {}


@dataclass(eq=False)
class _Member:
    """An open session on the Floor, as the floor sees it."""
    name: str
    tell: object
    told_busy: bool = False
    cut: object = None             # close its stream at the door (another session took the floor)


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


def async_register(hass: HomeAssistant, domain: str) -> None:
    """The subscription `<domain>/talk/live`."""
    @websocket_api.websocket_command({
        vol.Required("type"): f"{domain}/talk/live",
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
        entity_id = msg["entity_id"]
        floor = _floors.setdefault(entity_id, Floor())
        user = getattr(connection, "user", None)

        def tell(event: dict) -> None:
            if connection.subscriptions.get(msg["id"]) is done:
                connection.send_event(msg["id"], event)

        member = _Member(getattr(user, "name", None) or "Someone", tell, cut=talk.cut)

        @callback
        def on_audio(_hass, _conn, payload: bytes) -> None:
            if floor.claim(member):
                talk.feed(payload[: len(payload) - len(payload) % 2])

        @callback
        def spurt(started: bool) -> None:
            if not started:
                floor.release(member)

        handler_id, unregister = connection.async_register_binary_handler(on_audio)

        @callback
        def done() -> None:
            # Unsubscribe (the button let go) or the socket closed.
            unregister()
            talk.finish()
            floor.leave(member)
            if not floor.members and _floors.get(entity_id) is floor:
                del _floors[entity_id]

        @callback
        def failed(message: str) -> None:
            _targets.pop(msg["entity_id"], None)     # ask Protect afresh next time
            # The screen keeps a clip of the same words and sends that instead.
            if connection.subscriptions.get(msg["id"]) is done:
                connection.send_event(msg["id"], {"error": message})

        talk.on_error = lambda m: hass.loop.call_soon_threadsafe(failed, m)
        talk.on_spurt = lambda started: hass.loop.call_soon_threadsafe(spurt, started)
        connection.subscriptions[msg["id"]] = done
        talk.start()
        connection.send_result(msg["id"])
        connection.send_event(msg["id"], {"handler_id": handler_id, "rate": target.rate,
                                          "codec": target.codec, "warm": True})
        floor.join(member)                         # says who is talking, if anyone is

    websocket_api.async_register_command(hass, ws_live)
