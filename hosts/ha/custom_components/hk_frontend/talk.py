"""TALK: a short clip recorded on a screen, played on a speaker.

The doorbell sheet's hold-to-talk button (hk-doorbell-card). The
screen records while the button is held, and on release POSTs the clip here;
this keeps it in memory for a couple of minutes and has the speaker's own
integration play it:

    POST /api/hk_frontend/talk?entity_id=media_player.front_door_camera_speaker
         body = the clip (audio/webm;codecs=opus from MediaRecorder)
    ->   media_player.play_media  music  <signed URL of the clip>
    GET  /api/hk_frontend/talk/<id>?authSig=...   (the speaker fetches this)

THE CLIP IS THE FALLBACK. A UniFi Protect doorbell takes the words LIVE
(talk_live.py streams the microphone into the camera's own talkback
session as they are spoken); this is what the card sends when that
cannot open or fails, and all that a speaker other than a Protect doorbell
ever gets. A media_player only plays a URL (uiprotect hands it to ffmpeg and
streams the result to the talkback session), so a clip is a walkie-talkie:
release, and the words play a couple of seconds later. Any media_player that
plays a URL works the same way.

THE CLIP URL IS SIGNED, not public: the GET view requires auth, and the
signature (async_sign_path, tied to the uploading user's refresh token,
TTL_S) is what lets the speaker's ffmpeg in. Clips live only in memory and
are dropped when they expire; nothing is written to disk.

ONLY AUDIO GOES OUT. The clip is served from HA's own origin with the type
it was uploaded with, and that type is the uploader's to choose --
`text/html` would be served as a page. So the upload
must name one of AUDIO_TYPES (else 415), only that bare type is kept, and
the clip goes out with nosniff and a sandboxing CSP.
"""
from __future__ import annotations

from datetime import timedelta
import logging
import secrets
import time

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

URL = "/api/hk_frontend/talk"
MAX_BYTES = 3_000_000        # ~3 min of 32 kbit opus; a hold is seconds
TTL_S = 120                  # long enough for ffmpeg to open it, no longer
KEEP = 8                     # never hold more than this many clips
# What a browser's MediaRecorder makes (Chrome/Android webm, Firefox ogg,
# Safari mp4) and the other common clip containers ffmpeg reads.
AUDIO_TYPES = frozenset({"audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg",
                         "audio/aac", "audio/wav", "audio/x-wav"})
SAFE_HEADERS = {"X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; sandbox"}


def clip_type(content_type: str | None) -> str | None:
    """The bare audio type of an upload (`audio/webm;codecs=opus` ->
    `audio/webm`), or None when it is not one of AUDIO_TYPES."""
    bare = (content_type or "").split(";")[0].strip().lower()
    return bare if bare in AUDIO_TYPES else None


class Clips:
    """In-memory clips by random id, expiring after TTL_S."""

    def __init__(self, now=time.monotonic):
        self._now = now
        self._clips: dict[str, tuple[bytes, str, float]] = {}

    def add(self, body: bytes, ctype: str) -> str:
        self.prune()
        while len(self._clips) >= KEEP:
            self._clips.pop(next(iter(self._clips)))
        clip_id = secrets.token_urlsafe(18)
        self._clips[clip_id] = (body, ctype, self._now())
        return clip_id

    def get(self, clip_id: str):
        self.prune()
        clip = self._clips.get(clip_id)
        return (clip[0], clip[1]) if clip else None

    def prune(self) -> None:
        now = self._now()
        for k in [k for k, v in self._clips.items() if now - v[2] > TTL_S]:
            del self._clips[k]

    def __len__(self) -> int:
        return len(self._clips)


def check_target(hass: HomeAssistant, entity_id: str | None) -> str | None:
    """Why this target is refused, or None when it is a media player here."""
    if not entity_id or not entity_id.startswith("media_player."):
        return "entity_id must be a media_player"
    if hass.states.get(entity_id) is None:
        return f"{entity_id} does not exist"
    return None


async def async_play(hass: HomeAssistant, clips: Clips, entity_id: str,
                     body: bytes, ctype: str, context=None, sign=None,
                     base=None) -> str:
    """Keep the clip and have entity_id play it. Returns the clip id.

    `sign` and `base` are the URL signer and this instance's own address;
    tests pass stand-ins (the harness has no auth store or network)."""
    clip_id = clips.add(body, ctype)
    if sign is None:
        from homeassistant.components.http.auth import async_sign_path
        sign = lambda p: async_sign_path(hass, p, timedelta(seconds=TTL_S))  # noqa: E731
    if base is None:
        from homeassistant.helpers.network import get_url
        # The speaker's ffmpeg runs inside Home Assistant: the internal
        # address, never the public one.
        base = get_url(hass, allow_external=False, prefer_external=False)
    url = base + sign(f"{URL}/{clip_id}")
    await hass.services.async_call(
        "media_player", "play_media",
        {"entity_id": entity_id, "media_content_type": "music",
         "media_content_id": url},
        blocking=True, context=context)
    return clip_id


def async_register(hass: HomeAssistant) -> Clips:
    clips = Clips()

    class TalkView(HomeAssistantView):
        url = URL
        name = "hk_frontend:talk"
        requires_auth = True

        async def post(self, request: web.Request) -> web.Response:
            entity_id = request.query.get("entity_id")
            why = check_target(hass, entity_id)
            if why:
                return self.json_message(why, 400)
            # request.content_type, not the raw header: aiohttp has parsed it,
            # and it is application/octet-stream when none was sent.
            ctype = clip_type(request.content_type)
            if ctype is None:
                return self.json_message(f"not an audio clip: {request.content_type}", 415)
            from .art import read_limited     # the whole body, not one chunk
            body = await read_limited(request.content, MAX_BYTES)
            if body is None:
                return self.json_message("clip too long", 413)
            if len(body) < 200:
                return self.json_message("clip empty", 400)
            try:
                await async_play(hass, clips, entity_id, body, ctype,
                                 context=self.context(request))
            except Exception as err:  # noqa: BLE001 - the screen shows it
                _LOGGER.warning("talk: %s could not play the clip: %s", entity_id, err)
                return self.json_message(f"{entity_id} could not play it: {err}", 502)
            return self.json({"ok": True, "bytes": len(body)})

    class TalkClipView(HomeAssistantView):
        url = URL + "/{clip_id}"
        name = "hk_frontend:talk:clip"
        requires_auth = True      # the signed path is the credential

        async def get(self, request: web.Request, clip_id: str) -> web.Response:
            clip = clips.get(clip_id)
            if clip is None:
                return web.Response(status=404, headers=SAFE_HEADERS)
            # The type was checked at upload (clip_type); checked again here
            # so no other way into Clips can make this serve anything else.
            ctype = clip_type(clip[1])
            if ctype is None:
                return web.Response(status=415, headers=SAFE_HEADERS)
            return web.Response(body=clip[0], content_type=ctype,
                                headers={"Cache-Control": "no-store", **SAFE_HEADERS})

    hass.http.register_view(TalkView())
    hass.http.register_view(TalkClipView())
    return clips
