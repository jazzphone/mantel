"""PAIRING A SCREEN, and A SHOW on it: the steps docs/phase35/PLAN.md's table lists, worked out on a HomeView on
2026-11-24 (an iPhone's AirPlay captured through pyatv's atvproxy, then repeated from Mantel's side until the smallest
set that shows the picture was known).

* ``Pairing``: ``start()`` makes the screen show its code (the request names the sender, or a HomeView shows none),
  ``finish(code)`` returns the Credentials to keep.
* ``Show``: ``start(url)`` hands the screen a stream address to play; it plays until ``stop()``, the screen ends it, or
  the connection goes. ``ended`` is set then, with ``why``. Nothing here knows Live TV: live_tv.py makes the address.
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import plistlib
import random
import uuid
from typing import Any, Callable

from . import hap
from .rtsp import AirPlayError, Connection, EventChannel, open_events

log = logging.getLogger("mantel.airplay_out")

SENDER = "Mantel"                         # how the screen names Mantel (its code prompt, its AirPlay list)
FEEDBACK_S = 2.0                          # an AirPlay 2 sender's keep-alive
SENDER_MODEL = "Mac16,10"                 # what Mantel says it is (a HomeView shows the picture for any model)
CLIENT_TYPE = "A6B27562-B43A-4F2D-B75F-82391E250194"   # the remote-control stream's client type (an iPhone's)
EVENTS_KEPT = 40


def _uuid() -> str:
    return str(uuid.uuid4()).upper()


def _mac() -> str:
    return ":".join(f"{random.randint(0, 255):02X}" for _ in range(6))


# -- MediaRemote's NowPlayingClient (protobuf wire format, the fields a HomeView reads) ------------------------
def _varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b, n = n & 0x7F, n >> 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def now_playing_client(bundle: str, parent: str | None = None, name: str | None = None,
                       pid: int | None = None) -> bytes:
    """NowPlayingClient {1 processIdentifier, 2 bundleIdentifier, 3 parentApplicationBundleIdentifier,
    4 processUserIdentifier, 5 nowPlayingVisibility, 7 displayName}: what app is playing. A HomeView shows the picture
    only once a video app is named (step 5 of the plan's table)."""
    def text(num: int, value: str) -> bytes:
        raw = value.encode()
        return _varint(num << 3 | 2) + _varint(len(raw)) + raw
    out = _varint(1 << 3) + _varint(pid if pid is not None else random.randint(1000, 90000)) + text(2, bundle)
    if parent:
        out += text(3, parent)
    if name:
        out += _varint(4 << 3) + _varint(501) + _varint(5 << 3) + _varint(3) + text(7, name)
    return out


# -- pairing ----------------------------------------------------------------------------------------------------
class Pairing:
    """One pairing attempt, its connection kept open between the code showing and the code typed."""

    def __init__(self, conn: Connection) -> None:
        self.conn = conn
        self.setup = hap.PairSetup()
        self._m2 = b""

    @classmethod
    async def begin(cls, host: str, port: int = 7000) -> "Pairing":
        """Make the screen show its code."""
        p = cls(await Connection.open(host, port))
        try:
            await p.conn.http("/pair-pin-start", headers={"X-Apple-Client-Name": SENDER})
            got = await p.conn.http("/pair-setup", p.setup.m1())
            if got.code != 200:
                raise AirPlayError(f"the screen refused to pair ({got.code})", got.code)
            p._m2 = got.body
            hap._refused(hap.read_tlv(p._m2))
        except BaseException:
            p.close()
            raise
        return p

    async def finish(self, code: str) -> hap.Credentials:
        """The code the screen shows -> the pairing to keep. A wrong code raises PairingError(code=2)."""
        try:
            m4 = await self.conn.http("/pair-setup", self.setup.m3(self._m2, code))
            m6 = await self.conn.http("/pair-setup", self.setup.m5(m4.body))
            return self.setup.finish(m6.body)
        finally:
            self.close()

    def close(self) -> None:
        self.conn.close()


async def verified(host: str, creds: hap.Credentials, port: int = 7000) -> tuple[Connection, hap.PairVerify]:
    """A control connection, pair-verified and encrypted."""
    conn = await Connection.open(host, port)
    try:
        verify = hap.PairVerify(creds)
        m2 = await conn.http("/pair-verify", verify.m1())
        m4 = await conn.http("/pair-verify", verify.m3(m2.body))
        verify.done(m4.body)
        conn.secure(verify)
        return conn, verify
    except BaseException:
        conn.close()
        raise


# -- a show -----------------------------------------------------------------------------------------------------
class Show:
    """A stream address playing on one screen (docs/phase35/PLAN.md, "What was found", 4)."""

    def __init__(self, host: str, creds: hap.Credentials, port: int = 7000, name: str = SENDER,
                 psi: str | None = None, on_end: Callable[["Show"], None] | None = None) -> None:
        self.host, self.port, self.creds, self.name, self.psi = host, port, creds, name, psi
        self.on_end = on_end
        self.conn: Connection | None = None
        self.events: EventChannel | None = None
        self.stream_id = "1"
        self.ended = asyncio.Event()
        self.why = ""
        self.seen: list[str] = []               # the screen's event types, newest last (for the log and the checks)
        self._beat: asyncio.Task | None = None
        self.device_id, self.mac = _mac(), _mac()

    async def start(self, url: str) -> None:
        try:
            await self._start(url)
        except BaseException:
            self._end("did not start")
            raise

    async def _start(self, url: str) -> None:
        self.conn, verify = await verified(self.host, self.creds, self.port)
        c = self.conn
        ident = {"deviceID": self.device_id, "macAddress": self.mac, "model": SENDER_MODEL, "name": self.name,
                 "osName": "macOS", "osVersion": "27.2", "osBuildVersion": "25C56", "sourceVersion": "1005.13.1",
                 "combinedGetInfoWithControlSetup": True, "isSharedConnection": True,
                 "statsCollectionEnabled": False, "diagnosticsAndUsage": False, "internalBuild": False,
                 "updateSessionRequest": False}
        # 1. the remote-control session, and its event channel
        got = (await c.rtsp("SETUP", body={**ident, "isRemoteControlOnly": True, "timingProtocol": "None",
                                           "sessionUUID": _uuid(), "sessionCorrelationUUID": _uuid()})).plist()
        if not isinstance(got.get("eventPort"), int):
            raise AirPlayError("the screen gave no event port")
        self.psi = self.psi or str((got.get("info") or {}).get("psi") or "") or None
        self.events = await open_events(self.host, got["eventPort"], verify, self._event, self._lost)
        # 2. the full session (a PTP clock is named; a URL plays on the screen's own player, which never asks it)
        peer = {"ClockID": random.getrandbits(62), "DeviceType": 0, "ID": _uuid(), "SupportsClockPortMatchingOverride": True}
        await c.rtsp("SETUP", body={**ident, "sessionUUID": _uuid(), "sessionCorrelationUUID": peer["ID"],
                                    "groupUUID": _uuid(), "groupContainsGroupLeader": False, "isMultiSelectAirPlay": True,
                                    "senderSupportsRelay": False, "supportsGroupCohesion": True, "timingProtocol": "PTP",
                                    "asyncPTPClockConfig": True, "timingPeerInfo": peer, "timingPeerList": [peer]})
        # 3. now-playing info
        await self._mr("updateMRNowPlayingInfo", {"type": "npi-text", "params": {}, "mergePolicy": "replace"})
        # 4. the remote-control stream: its commands go as /command with its stream id (a HomeView gives no port)
        channel = f"{self.psi or _uuid()}-RCS-{random.randint(10, 999)}"
        got = (await c.rtsp("SETUP", body={"streams": [{"type": 130, "controlType": 1, "clientTypeUUID": CLIENT_TYPE,
                                                       "clientUUID": _uuid(), "channelID": channel}]})).plist()
        streams = got.get("streams") or []
        if not streams or "streamID" not in streams[0]:
            raise AirPlayError("the screen didn't open a remote-control stream")
        self.stream_id = str(streams[0]["streamID"])
        # 5. what is playing: without a video app named, a HomeView plays the sound and no picture
        await self._mr("updateMRPlaybackState", {"mrPlaybackState": 3})
        await self._mr("updateMRSupportedCommands", {"mrSupportedCommandsFromSender": []})
        await self._mr("updateMRNowPlayingClient", {"mrNowPlayingClient": now_playing_client("com.apple.airplayd")})
        await self._mr("updateMRPlaybackState", {"mrPlaybackState": 1})
        await self._mr("updateMRNowPlayingClient", {"mrNowPlayingClient": now_playing_client(
            "com.apple.WebKit.GPU", "com.apple.mobilesafari", "Safari")})
        # 6. the address, then play
        zero = {"epoch": 0, "flags": 0, "timescale": 0, "value": 0}
        await self._queue({"type": "insertPlayQueueItem", "item": {
            "Content-Location": url, "uuid": _uuid(), "mediaType": "streaming", "audioMode": "default",
            "clientBundleID": "com.apple.WebKit.GPU", "clientProcName": "com.apple.WebKit.GPU",
            "playbackRestrictions": 0, "referenceRestrictions": 3, "allowedCommonMediaClientDataKeys": 0,
            "snapTimeToPausePlayback": False, "supportsIntegratedTimeline": False,
            "timeToPauseBuffering": zero, "timeToPausePlayback": zero}})
        await self._queue({"type": "setProperty", "property": "actionAtItemEnd", "value": 1})
        await self._queue({"type": "setRate", "rate": 1.0})
        # 7. the keep-alive, until it ends
        self._beat = asyncio.create_task(self._feedback())

    async def _mr(self, kind: str, params: dict[str, Any]) -> None:
        assert self.conn is not None
        await self.conn.rtsp("POST", "/command", body={"type": kind, "params": params})

    async def _queue(self, inner: dict[str, Any]) -> None:
        assert self.conn is not None
        await self.conn.rtsp("POST", "/command", headers={"X-Apple-StreamID": self.stream_id},
                             body={"params": {"data": plistlib.dumps(inner, fmt=plistlib.FMT_BINARY)}})

    async def _feedback(self) -> None:
        while not self.ended.is_set():
            await asyncio.sleep(FEEDBACK_S)
            if self.ended.is_set() or self.conn is None:
                return
            try:
                await self.conn.rtsp("POST", "/feedback")
            except AirPlayError:
                self._end("the screen stopped answering")
                return

    def _event(self, start: str, headers: dict[str, str], body: bytes) -> None:
        kind = start.split(" ")[1] if " " in start else start
        if body.startswith(b"bplist"):
            with contextlib.suppress(Exception):
                d = plistlib.loads(body)
                if isinstance(d, dict):
                    kind = str(d.get("type") or kind)
        if kind not in self.seen:                    # what a screen says on pause or close, learned from the log
            log.info("airplay show on %s: the screen says %s", self.host, kind)
        self.seen = (self.seen + [kind])[-EVENTS_KEPT:]

    def _lost(self) -> None:
        if not self.ended.is_set():
            self._end("the screen closed the show")

    async def stop(self) -> None:
        if self.ended.is_set():
            return
        if self.conn is not None and not self.conn.closed:
            with contextlib.suppress(AirPlayError):
                await self._queue({"type": "setRate", "rate": 0.0})
            with contextlib.suppress(AirPlayError):
                await self.conn.rtsp("TEARDOWN", allow_error=True)
        self._end("stopped")

    def _end(self, why: str) -> None:
        if self.ended.is_set():
            return
        self.why = why
        self.ended.set()
        if self._beat is not None and self._beat is not asyncio.current_task():
            self._beat.cancel()
        if self.events is not None:
            self.events.close()
        if self.conn is not None:
            self.conn.close()
        log.info("airplay show on %s ended: %s (events: %s)", self.host, why, ", ".join(self.seen[-8:]) or "none")
        if self.on_end is not None:
            self.on_end(self)
