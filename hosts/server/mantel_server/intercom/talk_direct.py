"""TALKING AT A UNIFI PROTECT DOORBELL DIRECTLY (docs/phase13/CAMERAS-DIRECT.md, phase 5, 2026-11-02).

On Docker and the LXC Mantel reaches the console itself (protect_api.py, an API key), so talking at the door no
longer needs Home Assistant and Mantel Link in the chain: Mantel opens Protect's talkback session (``POST
/v1/cameras/<id>/talkback-session`` -> ``rtp://<camera>:7004``, Opus) and runs hk_core/talk/core.py's Pacer and
encoder on the tablet's PCM, exactly what Mantel Link runs inside Home Assistant. The HA App keeps Link's path.

``DirectTalkLink`` is a drop-in for ``ha_client.HaTalkLink`` as talk_relay.py uses it (``connect``, ``open``,
``recv``, ``send_audio``, ``stop``, ``close``, ``handler_id``, ``info``, ``rate``, ``frames``), so everything the relay
decides stays as it is: the gateway's ticket and audit row, who may talk (``camera.talk``), the rate cap, the time
limit, and the relay's own floor (one talker at a time, with the tablets' names). It answers as talk_live.py does:
``{handler_id, rate, codec, warm: true}`` first, ``{error}`` if the stream fails.

``DirectTalk`` (``app["direct_talk"]``) says which speakers Mantel talks to itself: the Protect connector registers
each doorbell's speaker id (a direct camera's ``media_player.mantel_<slug>_speaker``, or Home Assistant's speaker
of a camera matched to it, decision 2) with the camera's Protect id and a way to ask for its session. The session's
address is kept TARGET_TTL seconds, as talk_live.py keeps it: a fixed port on the camera, and asking on every press
would be a round trip in front of the first word.
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from hk_core.talk.core import CODECS, LiveTalk, Target

from ..ha.ha_client import HaCommandError, talk_frame_max

log = logging.getLogger("mantel.talk_direct")

TARGET_TTL = 300.0
HID = 1


@dataclass
class Speaker:
    camera_id: str                                   # Protect's id for the camera
    session: Callable[[str], Awaitable[Target]]      # camera id -> its talkback session (protect_api)


class DirectTalk:
    """The doorbells Mantel talks to itself, by speaker entity id."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.speakers: dict[str, Speaker] = {}
        self._targets: dict[str, tuple[float, Target]] = {}
        self.clock = clock

    def set_speakers(self, speakers: dict[str, Speaker]) -> None:
        self.speakers = dict(speakers)
        for sid in list(self._targets):
            if sid not in self.speakers:
                del self._targets[sid]

    def handles(self, speaker: str) -> bool:
        return speaker in self.speakers

    async def target(self, speaker: str) -> Target:
        hit = self._targets.get(speaker)
        if hit is not None and self.clock() - hit[0] < TARGET_TTL:
            return hit[1]
        sp = self.speakers.get(speaker)
        if sp is None:
            raise HaCommandError("not_supported", f"{speaker} is not a doorbell Mantel talks to")
        target = await sp.session(sp.camera_id)
        self._targets[speaker] = (self.clock(), target)
        return target

    def forget(self, speaker: str) -> None:
        self._targets.pop(speaker, None)

    def link(self, speaker: str, rate: int) -> "DirectTalkLink":
        return DirectTalkLink(self, speaker, rate)


class DirectTalkLink:
    """One talk session to a doorbell, without Home Assistant (see the module docstring)."""

    def __init__(self, direct: DirectTalk, speaker: str, rate: int) -> None:
        self.direct, self.entity_id, self.rate = direct, speaker, rate
        self.handler_id: int | None = None
        self.info: dict = {}
        self.frames = 0
        self.bytes = 0
        self.frame_max = talk_frame_max(rate)
        self._talk: LiveTalk | None = None
        self._events: asyncio.Queue = asyncio.Queue()
        self._closed = False
        self._target: Target | None = None

    def __repr__(self) -> str:  # never the session's address
        return f"<DirectTalkLink {self.entity_id} {self.rate}>"

    @property
    def closed(self) -> bool:
        return self._closed

    def set_rate(self, rate: int) -> None:
        if self._talk is None:
            self.rate, self.frame_max = rate, talk_frame_max(rate)

    async def connect(self) -> None:
        """Early (talk_relay.issue): the doorbell's session is asked for while the page opens its socket."""
        self._target = await self.direct.target(self.entity_id)

    async def open(self) -> None:
        try:
            target = self._target or await self.direct.target(self.entity_id)
        except HaCommandError:
            raise
        except Exception as exc:  # noqa: BLE001 -- the console's own trouble: the card sends its clip instead
            raise HaCommandError("unavailable", f"the doorbell's talkback session ({type(exc).__name__})") from exc
        if target.codec not in CODECS:
            raise HaCommandError("not_supported", f"codec {target.codec}")
        loop = asyncio.get_running_loop()
        talk = self._talk = LiveTalk(target, self.rate)

        def failed(message: str) -> None:
            self.direct.forget(self.entity_id)               # ask Protect afresh next time
            if not self._closed:
                self._events.put_nowait({"error": message[:200]})
        talk.on_error = lambda m: loop.call_soon_threadsafe(failed, m)
        talk.start()
        self.handler_id = HID
        self.info = {"rate": target.rate, "codec": target.codec, "warm": True}
        self._events.put_nowait({"handler_id": HID, **self.info})

    async def recv(self) -> dict | None:
        if self._closed:
            return None
        return await self._events.get()

    async def send_audio(self, pcm: bytes) -> bool:
        if (self._talk is None or self._closed or not isinstance(pcm, bytes) or not pcm or len(pcm) % 2
                or len(pcm) > self.frame_max):
            return False
        self._talk.feed(pcm)
        self.frames += 1
        self.bytes += len(pcm)
        return True

    def cut(self) -> None:
        """Another tablet took the floor: this session's stream at the door closes now (talk_relay.claim)."""
        if self._talk is not None:
            self._talk.cut()

    async def stop(self) -> None:
        """Let go: what is buffered plays out, then the session ends."""
        if self._talk is not None:
            self._talk.finish()

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._talk is not None:
            self._talk.finish()
        self._events.put_nowait(None)
