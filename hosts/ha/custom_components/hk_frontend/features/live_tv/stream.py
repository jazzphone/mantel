"""The transcode: one channel, HDHomeRun MPEG-2/AC-3 -> H.264/AAC MPEG-TS.

    GET /api/hk_tv/stream/<channel>      (localhost only: go2rtc is the client)

Each channel camera's stream_source is this URL. go2rtc reads MPEG-TS over
HTTP natively and only RELAYS it to WebRTC (Home Assistant adds its usual
AAC -> Opus audio producer), so the heavy work is this one process, started
when go2rtc connects and killed when it goes -- go2rtc holds one connection
per stream however many screens watch, so viewers share a tuner.

Why not go2rtc's own `ffmpeg:` source: it refuses `#raw=` (HTTP 400) and
`#video=h264` never produces a track.

The path uses Live TV's hk_tv prefix: every channel camera's stream source
names it.
"""
from __future__ import annotations

import asyncio
import logging

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import CONF_CHANNELS, DATA
from ...hk_core.link.tv_stream import BENIGN, QUALITY, ffmpeg_args  # noqa: F401 -- shared with Mantel Link

_LOGGER = logging.getLogger(__name__)

URL = "/api/hk_tv/stream"




class TvStreamView(HomeAssistantView):
    url = URL + "/{channel}"
    name = "hk_frontend:live_tv_stream"
    requires_auth = False       # localhost only -- checked below

    def __init__(self, hass: HomeAssistant) -> None:
        self._hass = hass

    async def get(self, request: web.Request, channel: str) -> web.StreamResponse:
        if request.remote not in ("127.0.0.1", "::1"):
            return web.Response(status=403)
        data = self._hass.data.get(DATA, {})
        entry = data.get("entry")
        if entry is None or channel not in {c["number"] for c in entry.options.get(CONF_CHANNELS, [])}:
            return web.Response(status=404)
        url = f"http://{data['host']}:5004/auto/v{channel}"
        proc = await asyncio.create_subprocess_exec(
            *ffmpeg_args(url, data.get("quality", "720")),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        _LOGGER.debug("channel %s: ffmpeg %s started", channel, proc.pid)

        async def log_errors():
            async for line in proc.stderr:
                text = line.decode(errors="replace").rstrip()
                # Until the first full frame arrives the MPEG-2 decoder
                # complains about every partial one -- harmless, and over a
                # hundred warnings an hour.
                if any(b in text for b in BENIGN):
                    _LOGGER.debug("channel %s: %s", channel, text)
                    continue
                # 503 from the tuner = every tuner busy (another channel, or
                # another app such as Plex).
                _LOGGER.warning("channel %s: %s", channel, text)
        err = asyncio.create_task(log_errors())

        # THE PROCESS IS OURS FROM THE MOMENT IT EXISTS: the try opens here, not
        # after prepare(). A client that resets (or a handler cancelled) while
        # the response is being prepared left ffmpeg running, blocked on a full
        # pipe -- holding one of the tuner's two tuners until a restart.
        sent = 0
        try:
            resp = web.StreamResponse(headers={"Content-Type": "video/mp2t",
                                               "Cache-Control": "no-store"})
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
            _LOGGER.debug("channel %s: ffmpeg %s ended (%s, %d bytes)", channel,
                          proc.pid, proc.returncode, sent)
        return resp
