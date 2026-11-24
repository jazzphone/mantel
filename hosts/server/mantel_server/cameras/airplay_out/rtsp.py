"""ONE AIRPLAY CONTROL CONNECTION to a screen (its port 7000): HTTP/1.1 for pairing, RTSP/1.0 after, both encrypted
once pair-verify is done (hap.Framing); and the screen's EVENT CHANNEL, which the screen talks on and Mantel answers.

Requests go one at a time (a lock): AirPlay answers in order on a connection. Bodies are bytes; a dict is sent as a
binary plist. Ported in part from pyatv (MIT License, Copyright (c) 2017-2025 Pierre Ståhl): support/http.py's
framing, support/rtsp.py's headers, protocols/airplay/channels.py's event channel.
"""
from __future__ import annotations

import asyncio
import logging
import plistlib
import random
from dataclasses import dataclass, field
from typing import Any, Callable

from . import hap

log = logging.getLogger("mantel.airplay_out")

USER_AGENT = "AirPlay/550.10"
TIMEOUT = 10.0
MAX_BODY = 1 << 20


@dataclass
class Response:
    code: int
    headers: dict[str, str]
    body: bytes = b""

    def plist(self) -> dict[str, Any]:
        if not self.body.startswith(b"bplist"):
            return {}
        got = plistlib.loads(self.body)
        return got if isinstance(got, dict) else {}


class AirPlayError(Exception):
    """The screen answered an error, or stopped answering."""

    def __init__(self, message: str, code: int | None = None) -> None:
        super().__init__(message)
        self.code = code


def _head(raw: bytes) -> tuple[str, dict[str, str]]:
    lines = raw.decode("utf-8", "replace").split("\r\n")
    headers: dict[str, str] = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    return lines[0], headers


def split_message(buf: bytes) -> tuple[tuple[str, dict[str, str], bytes] | None, bytes]:
    """One whole message off the front of ``buf`` (start line, lower-case headers, body), or None when it isn't all
    there yet; and what is left."""
    end = buf.find(b"\r\n\r\n")
    if end < 0:
        return None, buf
    start, headers = _head(buf[:end])
    size = int(headers.get("content-length", "0") or 0)
    if size < 0 or size > MAX_BODY:
        raise AirPlayError("a message too large from the screen")
    if len(buf) < end + 4 + size:
        return None, buf
    return (start, headers, buf[end + 4:end + 4 + size]), buf[end + 4 + size:]


def _body(body: bytes | dict | list | None) -> tuple[bytes, str | None]:
    if body is None:
        return b"", None
    if isinstance(body, (dict, list)):
        return plistlib.dumps(body, fmt=plistlib.FMT_BINARY), "application/x-apple-binary-plist"
    return body, None


class Connection:
    """``await Connection.open(host)``; ``http(...)`` for pairing, ``secure(verify)`` to encrypt, ``rtsp(...)``."""

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, host: str) -> None:
        self.reader, self.writer, self.host = reader, writer, host
        self.framing: hap.Framing | None = None
        self._buf = b""
        self._lock = asyncio.Lock()
        self.cseq = 0
        self.session_id = random.randrange(2 ** 32)
        self.dacp_id = f"{random.getrandbits(64):016X}"
        self.active_remote = str(random.getrandbits(32))
        self.closed = False

    @classmethod
    async def open(cls, host: str, port: int = 7000, timeout: float = TIMEOUT) -> "Connection":
        reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
        return cls(reader, writer, host)

    @property
    def local_ip(self) -> str:
        sock = self.writer.get_extra_info("sockname")
        return sock[0] if sock else "0.0.0.0"

    @property
    def uri(self) -> str:
        return f"rtsp://{self.local_ip}/{self.session_id}"

    def secure(self, verify: hap.PairVerify) -> None:
        """Encrypt from here on with the control channel's keys (pair-verify must be done)."""
        out_key, in_key = verify.keys("Control-Salt", "Control-Write-Encryption-Key", "Control-Read-Encryption-Key")
        self.framing = hap.Framing(out_key, in_key)

    async def http(self, path: str, body: bytes = b"", headers: dict[str, str] | None = None) -> Response:
        """A pairing request (HTTP/1.1 POST, as AirPlay's pairing is)."""
        hdrs = {"User-Agent": "AirPlay/320.20", "Connection": "keep-alive", "X-Apple-HKP": "3",
                "Content-Type": "application/octet-stream"}
        hdrs.update(headers or {})
        return await self._exchange("POST", path, "HTTP/1.1", hdrs, body)

    async def rtsp(self, method: str, path: str | None = None, body: bytes | dict | list | None = None,
                   headers: dict[str, str] | None = None, content_type: str | None = None,
                   allow_error: bool = False) -> Response:
        data, ctype = _body(body)
        self.cseq += 1
        hdrs = {"CSeq": str(self.cseq), "DACP-ID": self.dacp_id, "Active-Remote": self.active_remote,
                "Client-Instance": self.dacp_id, "User-Agent": USER_AGENT}
        if content_type or ctype:
            hdrs["Content-Type"] = content_type or ctype
        hdrs.update(headers or {})
        got = await self._exchange(method, path or self.uri, "RTSP/1.0", hdrs, data)
        if not allow_error and got.code >= 400:
            raise AirPlayError(f"{method} {path or ''} answered {got.code}", got.code)
        return got

    async def _exchange(self, method: str, path: str, protocol: str, headers: dict[str, str],
                        body: bytes) -> Response:
        if self.closed:
            raise AirPlayError("the connection to the screen is closed")
        head = f"{method} {path} {protocol}\r\n" + "".join(f"{k}: {v}\r\n" for k, v in headers.items())
        head += f"Content-Length: {len(body)}\r\n\r\n"
        raw = head.encode() + body
        async with self._lock:
            try:
                self.writer.write(self.framing.encrypt(raw) if self.framing else raw)
                await self.writer.drain()
                return await asyncio.wait_for(self._response(), TIMEOUT)
            except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError, hap.PairingError) as exc:
                self.close()
                raise AirPlayError(f"the screen stopped answering ({type(exc).__name__})") from exc

    async def _response(self) -> Response:
        while True:
            got, self._buf = split_message(self._buf)
            if got is not None:
                start, headers, body = got
                parts = start.split(" ", 2)
                try:
                    code = int(parts[1])
                except (IndexError, ValueError):
                    raise AirPlayError(f"not an answer: {start[:60]!r}") from None
                return Response(code, headers, body)
            chunk = await self.reader.read(65536)
            if not chunk:
                raise asyncio.IncompleteReadError(b"", None)
            self._buf += self.framing.decrypt(chunk) if self.framing else chunk

    def close(self) -> None:
        if not self.closed:
            self.closed = True
            self.writer.close()


@dataclass
class EventChannel(asyncio.Protocol):
    """The screen's event channel: Mantel connects to the event port the session's SETUP named, and the screen sends
    requests on it (what it is playing, that it stopped); each is answered 200 and handed to ``on_event``."""
    framing: hap.Framing
    on_event: Callable[[str, dict[str, str], bytes], None]
    on_lost: Callable[[], None]
    transport: asyncio.Transport | None = None
    _buf: bytes = field(default=b"", repr=False)

    def connection_made(self, transport) -> None:
        self.transport = transport

    def data_received(self, data: bytes) -> None:
        try:
            self._buf += self.framing.decrypt(data)
            while True:
                got, self._buf = split_message(self._buf)
                if got is None:
                    return
                start, headers, body = got
                answer = "RTSP/1.0 200 OK\r\nContent-Length: 0\r\nAudio-Latency: 0\r\n"
                if "cseq" in headers:
                    answer += f"CSeq: {headers['cseq']}\r\n"
                if self.transport is not None:
                    self.transport.write(self.framing.encrypt((answer + "\r\n").encode()))
                self.on_event(start, headers, body)
        except (hap.PairingError, AirPlayError) as exc:
            log.warning("the screen's event channel: %s", exc)
            self.close()

    def connection_lost(self, exc) -> None:
        self.transport = None
        self.on_lost()

    def close(self) -> None:
        if self.transport is not None:
            self.transport.close()
            self.transport = None


async def open_events(host: str, port: int, verify: hap.PairVerify, on_event, on_lost) -> EventChannel:
    """Connect to the screen's event port; Mantel reads what the screen writes ("Events-Write") and the other way."""
    out_key, in_key = verify.keys("Events-Salt", "Events-Read-Encryption-Key", "Events-Write-Encryption-Key")
    loop = asyncio.get_running_loop()
    _, channel = await asyncio.wait_for(loop.create_connection(
        lambda: EventChannel(hap.Framing(out_key, in_key), on_event, on_lost), host, port), TIMEOUT)
    return channel
