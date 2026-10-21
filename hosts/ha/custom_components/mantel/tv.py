"""LIVE TV'S TRANSCODE: one channel, HDHomeRun MPEG-2/AC-3 -> H.264/AAC MPEG-TS
(Mantel Link's, ported from HK Frontend's live_tv/stream.py so Live TV needs
no HK Frontend where Mantel runs as the Home Assistant App).

    GET /api/mantel/tv/stream/<channel>      (this machine only: go2rtc is the client)

Mantel names the channels: each of Live TV's channel cameras (bridge.py
mirrors them, entity.py's LinkedCamera) carries `features.tv` =
{channel, source, quality, image}. `source` is the tuner's own stream URL for
that channel (`http://<tuner>[:port]/auto/v<n>`, nothing else); the camera's
stream_source is this view, on this Home Assistant's own port. Home
Assistant's go2rtc reads MPEG-TS over HTTP natively and only RELAYS it to
WebRTC, so the heavy work is this one process, started when go2rtc connects
and killed when it goes -- go2rtc holds one connection per stream however
many screens watch, so viewers share a tuner.

ONLY A CHANNEL MANTEL LINK MIRRORS. The channel must be a camera this side
mirrors now (Mantel holds the house, the bridge is Mantel Link's), and its
source must be a plain tuner stream URL: ffmpeg is never pointed anywhere
else. The view answers 127.0.0.1 / ::1 only (no auth: go2rtc has none).
"""
from __future__ import annotations

import asyncio
from asyncio import create_subprocess_exec
import logging
import re
from typing import Any

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

_LOGGER = logging.getLogger(__name__)

URL = "/api/mantel/tv/stream"
CHANNEL = re.compile(r"^\d{1,4}(\.\d{1,4})?$")
SOURCE = re.compile(r"^http://[A-Za-z0-9.\-]{1,253}(:\d{1,5})?/auto/v(?P<n>\d{1,4}(\.\d{1,4})?)$")
IMAGE = re.compile(r"^https?://[^\s]{1,2000}$")

BENIGN = ("Invalid frame dimensions 0x0", "Error submitting packet to decoder",
          "Last message repeated")

QUALITY = {
    # Broadcast HD is 1080i: yadif makes it progressive at 29.97 fps.
    "720": ["-vf", "yadif=0:-1:0,scale=-2:720",
            "-b:v", "3000k", "-maxrate", "3500k", "-bufsize", "3000k"],
    "1080": ["-vf", "yadif=0:-1:0",
             "-b:v", "6000k", "-maxrate", "7000k", "-bufsize", "6000k"],
}


def channel_of(features: Any) -> dict[str, Any] | None:
    """A camera's `features.tv`, checked: {channel, source, quality, image}, or None."""
    tv = features.get("tv") if isinstance(features, dict) else None
    if not isinstance(tv, dict):
        return None
    n, src = tv.get("channel"), tv.get("source")
    if not (isinstance(n, str) and CHANNEL.match(n) and isinstance(src, str)):
        return None
    m = SOURCE.match(src)
    if m is None or m.group("n") != n:
        return None
    image = tv.get("image")
    return {"channel": n, "source": src, "quality": tv.get("quality") if tv.get("quality") in QUALITY else "720",
            "image": image if isinstance(image, str) and IMAGE.match(image) else None}


def stream_url(hass: HomeAssistant, channel: str) -> str:
    """This Home Assistant's own address for the view (the view answers only this machine):
    8123 and http unless it is set up otherwise."""
    api = getattr(getattr(hass, "config", None), "api", None)
    port = api.port if api else 8123
    scheme = "https" if api and api.use_ssl else "http"
    return f"{scheme}://127.0.0.1:{port}{URL}/{channel}"


def ffmpeg_args(url: str, quality: str) -> list[str]:
    return [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        # FAST START: probe a second of the stream, not ffmpeg's default five,
        # and put a key frame every second so WebRTC can start on one soon.
        "-probesize", "1500000", "-analyzeduration", "1000000",
        "-fflags", "+genpts+discardcorrupt", "-i", url,
        "-map", "0:v:0", "-map", "0:a:0",
        *QUALITY.get(quality, QUALITY["720"]),
        "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
        "-profile:v", "high", "-level:v", "4.1", "-pix_fmt", "yuv420p",
        "-g", "30", "-keyint_min", "30",
        "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000",
        "-f", "mpegts", "-muxdelay", "0", "pipe:1",
    ]


def find(hass: HomeAssistant, channel: str) -> dict[str, Any] | None:
    """The channel's `features.tv`, from a camera Mantel Link mirrors now; else None."""
    from .bridge import bridge_of
    bridge = bridge_of(hass)
    if bridge is None:
        return None
    for d in list(bridge.descs.values()):
        if d.get("platform") != "camera" or not d.get("available", True) or not bridge.mine(d):
            continue
        tv = channel_of(d.get("features"))
        if tv is not None and tv["channel"] == channel:
            return tv
    return None


class TvStreamView(HomeAssistantView):
    url = URL + "/{channel}"
    name = "mantel:tv:stream"
    requires_auth = False       # this machine only -- checked below

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass
        self.running = 0

    async def get(self, request: web.Request, channel: str) -> web.StreamResponse:
        if request.remote not in ("127.0.0.1", "::1"):
            return web.Response(status=403)
        tv = find(self._hass, channel) if CHANNEL.match(channel) else None
        if tv is None:
            return web.Response(status=404)
        proc = await create_subprocess_exec(*ffmpeg_args(tv["source"], tv["quality"]),
                                 stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        self.running += 1
        _LOGGER.debug("channel %s: ffmpeg %s started", channel, proc.pid)

        async def log_errors() -> None:
            async for line in proc.stderr:
                text = line.decode(errors="replace").rstrip()
                # Until the first full frame arrives the MPEG-2 decoder
                # complains about every partial one: harmless.
                if any(b in text for b in BENIGN):
                    _LOGGER.debug("channel %s: %s", channel, text)
                    continue
                # 503 from the tuner = every tuner busy (another channel, or another app)
                _LOGGER.warning("channel %s: %s", channel, text)
        err = asyncio.create_task(log_errors())

        # THE PROCESS IS OURS FROM THE MOMENT IT EXISTS: the try opens here, not
        # after prepare(). A client that resets while the response is being
        # prepared must not leave ffmpeg running, holding one of the tuner's tuners.
        sent = 0
        try:
            resp = web.StreamResponse(headers={"Content-Type": "video/mp2t", "Cache-Control": "no-store"})
            await resp.prepare(request)
            while True:
                chunk = await proc.stdout.read(65536)
                if not chunk:
                    break
                await resp.write(chunk)
                sent += len(chunk)
        except ConnectionResetError:
            pass                              # the viewer left: the normal end
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()
            err.cancel()
            self.running -= 1
            _LOGGER.debug("channel %s: ffmpeg %s ended (%s, %d bytes)", channel, proc.pid, proc.returncode, sent)
        return resp


def async_register(hass: HomeAssistant) -> TvStreamView:
    view = TvStreamView(hass)
    hass.http.register_view(view)
    return view
