"""UNIFI PROTECT'S PUBLIC API, AS MANTEL'S OWN CLIENT (docs/phase13/CAMERAS-DIRECT.md, phase 4: "UniFi Protect
connector", "Signing in to UniFi").

Where Mantel runs on Docker or an LXC (not the HA App), it can ask the UniFi console for its cameras directly
instead of through Home Assistant's integration: the list, a still, the RTSPS streams go2rtc plays, which
smart detections are on, the talkback session, and the events (ring, motion, person, vehicle, ...) as they
happen. This module is that conversation and nothing else: no settings page, no go2rtc, no rules. The session
that wires it in gets plain values (``Camera``, ``ProtectEvent``) and errors with a ``kind`` it can show.

THE PUBLIC INTEGRATION API, NOT THE PRIVATE ONE. One API key (UniFi OS: Settings, Control Plane, Integrations),
sent as ``X-API-KEY``, against ``https://<console>/proxy/protect/integration/v1/...``. It is supported and
versioned, it is what Home Assistant's own integration is moving onto, and a key needs no user password. It
is not the private API uiprotect grew up on (zones, plate text, face names stay in Protect's own app). Needs
Protect 7.2.105 or later.

TRUST IS BY PINNING. A console's certificate is self-signed, so there is nothing to verify it against. The
first connect (``fetch_certificate``, no request is sent) learns its SHA-256 fingerprint; the caller keeps it
(``ProtectClient.pinned_sha256``) and shows it; from then on EVERY connection, requests and the events socket
alike, is checked against it by aiohttp's ``Fingerprint`` DURING the TLS handshake, before a byte of the
request, so before the API key, leaves Mantel. A different certificate (a replaced console, a reset, or
someone in between) is ``CertificateChanged`` and nothing is sent. The key is also never sent to an address
that has not first answered, without it, like a Protect console (``NotAConsole``).

PACING. The console allows 10 requests a second per key (``ratelimit-policy: "10-in-1sec"``, a 429 beyond
it). A token bucket keeps Mantel under that on its own (any one-second window holds at most RATE_PER_S +
BURST requests, which is 9), the ``ratelimit: ...; r=<left>; t=<seconds to reset>`` header of each answer
pauses the bucket when none is left, and a 429 that happens anyway is retried once after the wait the
console names (``Retry-After``, else the ``t=``). A wall of tablets asking for stills is therefore slowed,
not refused.

WHAT THE HOUSE'S CONSOLE ANSWERED (UNVR G2 Pro, Protect 7.3.70; tests/fixtures/protect/), where it differs
from what one would guess:

* ``GET /v1/nvrs`` is ONE object, not a list. ``GET /v1/meta/info`` is just ``{"applicationVersion"}``.
* A camera's ``type`` is its model ("UVC G4 Doorbell Pro"). There is no doorbell flag: the doorbell is the
  model name, plus ``lcdMessage`` (only a doorbell has the screen) and ``hasPackageCamera``. A G4 Doorbell
  Pro lists ``package`` among ``featureFlags.smartDetectTypes``; the others do not.
* ``featureFlags.smartDetectTypes`` is what the model CAN detect, ``smartDetectSettings.objectTypes`` what is
  ON; every house camera had everything on, so the motion-only camera (no smart types) is covered by tests
  that make one up, not by a recording.
* The RTSPS answer has up to four qualities (``high``, ``medium``, ``low`` and, for the doorbell,
  ``package``), each ``rtsps://<console>:7441/<token>?enableSrtp``. The token IS the credential.
* Events: ``add`` then ``update``s, and an update is not a diff: it repeats the event's fields, sometimes
  several times in a row byte for byte (or with the keys in another order). A smart detection's
  ``smartDetectTypes`` GROWS while it runs (``["person"]``, then ``["face", "person"]``). ``end`` appears when
  it stops; the first sight of an event can be its last update (a reconnect in the middle of it). Motion
  fires on a camera alongside its smart detections (a person is also motion). A ``ring`` arrives once, in
  one ``add``, already carrying an ``end`` (its ring-tone length), so ``end`` does not mean it is over.

Nothing here logs or prints the API key or a stream token: ``ProtectClient``'s ``repr`` names neither, and
``StreamUrl`` (the RTSP address handed to go2rtc) shows its token as ``***`` in its ``repr``. The key lives in
one attribute and goes into one header.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import ssl
import time
from collections import OrderedDict
from dataclasses import dataclass, field, replace
from typing import Any, AsyncIterator, Awaitable, Callable, Iterable, NamedTuple
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import aiohttp

log = logging.getLogger("mantel.protect")

API_ROOT = "/proxy/protect/integration"
MIN_VERSION = (7, 2, 105)                  # the public API's floor: the same as Home Assistant's integration
RATE_PER_S = 6.0                           # the console allows 10 a second; RATE + BURST stays under it
BURST = 3
RETRY_AFTER_MAX_S = 10.0                   # a 429 is waited out for at most this long
CONNECT_TIMEOUT_S = 5.0
REQUEST_TIMEOUT_S = 20.0                   # a full-size still is ~400 KB over a console that may be busy
HEARTBEAT_S = 20.0                         # websocket pings: a socket that stops answering is dropped, then redialed
BACKOFF_S = (1.0, 2.0, 5.0, 10.0, 30.0)    # between events-socket attempts; the last repeats
STABLE_S = 30.0                            # a socket that lived this long (or spoke) starts the backoff over
MEMORY = 512                               # events remembered for merging and de-duplication

# What Protect calls a smart detection, and what Mantel calls the event it makes of it.
SMART_KINDS = {"person": "person", "vehicle": "vehicle", "animal": "animal", "package": "package",
               "face": "face", "licensePlate": "license_plate"}
SMART_NAMES = {kind: name for name, kind in SMART_KINDS.items()}
KINDS = ("ring", "motion", *SMART_KINDS.values())


# -- errors: each kind is one thing the Connect page can tell the owner to fix ------------------------------
class ProtectError(Exception):
    """Anything that goes wrong talking to the console. ``kind`` is stable (the settings page switches on it),
    ``str()`` is a sentence for the owner: what to fix, never the key."""
    kind = "error"


class Unreachable(ProtectError):
    """No answer: wrong address, console off, network down, timed out."""
    kind = "unreachable"


class NotAConsole(ProtectError):
    """Something answers there, but not as a UniFi console running Protect (a web server, another device, UniFi OS
    without Protect, plain HTTP on the port)."""
    kind = "not_a_console"


class KeyRefused(ProtectError):
    """The console answered 401 or 403 to the API key: wrong, deleted, or its maker disabled."""
    kind = "key_refused"


class ProtectTooOld(ProtectError):
    """Protect is older than the public API's floor (MIN_VERSION)."""
    kind = "protect_too_old"

    def __init__(self, version: str):
        self.version = version
        need = ".".join(map(str, MIN_VERSION))
        what = f"UniFi Protect {version}" if version else "This UniFi Protect"
        super().__init__(f"{what} is too old: Mantel needs {need} or later. Update Protect in UniFi OS, then connect again.")


class CertificateChanged(ProtectError):
    """The console's certificate is not the one Mantel pinned. Nothing was sent to it."""
    kind = "certificate_changed"

    def __init__(self, expected: str = "", seen: str = ""):
        self.expected, self.seen = expected, seen
        super().__init__("The console's certificate is not the one Mantel trusted. If you replaced or reset the console, "
                         "trust the new certificate; if you did not, something else may be answering at this address.")


class RateLimited(ProtectError):
    """429 twice running: the console wants fewer requests than Mantel's pacing sent (another client shares the key)."""
    kind = "rate_limited"


class ProtectApiError(ProtectError):
    """Any other refusal (a camera that is offline, an unknown id, a 5xx). ``status`` is the HTTP status."""
    kind = "api_error"

    def __init__(self, status: int, message: str = ""):
        self.status = status
        super().__init__(f"UniFi Protect answered {status}" + (f": {message}" if message else "") + ".")


class SmartTypeUnsupported(ProtectError, ValueError):
    """A smart detection this camera's model cannot do (or one Protect does not know): refused before anything is sent."""
    kind = "smart_type_unsupported"


# -- addresses, fingerprints ---------------------------------------------------------------------------------
def split_host(host: str) -> tuple[str, int]:
    """``unifi.local``, ``console.lan:8443``, ``https://[fe80::1]/`` -> (name, port), 443 by default."""
    text = (host or "").strip()
    if "://" in text:
        text = text.split("://", 1)[1]
    text = text.split("/", 1)[0]
    try:
        parts = urlsplit("//" + text)
        name, port = parts.hostname, parts.port
    except ValueError:
        name, port = None, None
    if not name:
        raise NotAConsole("Enter the console's address, such as unifi.local.")
    return name, port or 443


def normalize_fingerprint(value: str) -> str:
    """A SHA-256 fingerprint as lowercase hex with no colons or spaces; ValueError if it is not 64 hex digits."""
    text = re.sub(r"[\s:]", "", value or "").lower()
    if not re.fullmatch(r"[0-9a-f]{64}", text):
        raise ValueError("not a SHA-256 fingerprint")
    return text


def _no_verify_context() -> ssl.SSLContext:
    """TLS that accepts any certificate: only for LOOKING at the certificate (fetch_certificate), which sends nothing."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


async def fetch_certificate(host: str, *, timeout: float = CONNECT_TIMEOUT_S) -> str:
    """The SHA-256 fingerprint (lowercase hex, no colons) of the leaf certificate ``host`` presents.

    The first-connect step of pinning: a TLS handshake and nothing else, so no request, and no API key, reaches
    an address that has not been looked at. ``NotAConsole`` when the port does not speak TLS, ``Unreachable``
    when nothing answers."""
    name, port = split_host(host)
    try:
        _reader, writer = await asyncio.wait_for(
            asyncio.open_connection(name, port, ssl=_no_verify_context(), ssl_handshake_timeout=timeout), timeout + 1)
    except ssl.SSLError as err:
        raise NotAConsole(f"{host} answers, but not with HTTPS, so it is not a UniFi console. "
                          "Check the address (the console's own, such as unifi.local).") from err
    except (OSError, asyncio.TimeoutError) as err:
        raise Unreachable(f"Mantel can't reach {host} ({err.__class__.__name__}). "
                          "Check the address and that the console is on.") from err
    try:
        der = writer.get_extra_info("ssl_object").getpeercert(binary_form=True)
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except OSError:
            pass
    if not der:
        raise NotAConsole(f"{host} did not present a certificate.")
    return hashlib.sha256(der).hexdigest()


class StreamUrl(str):
    """An RTSP address for go2rtc. A plain ``str`` (go2rtc's config wants the text), whose ``repr`` hides the token:
    the path of a Protect stream address IS its credential, so a log line that shows a dict of them shows ``***``."""

    def __repr__(self) -> str:
        parts = urlsplit(str(self))
        return f"StreamUrl({urlunsplit((parts.scheme, parts.netloc, '/***', '', ''))!r})"


def rtspx_url(url: str) -> StreamUrl:
    """Protect's ``rtsps://host:7441/<token>?enableSrtp`` as go2rtc's ``rtspx://host:7441/<token>``.

    ``rtspx`` is go2rtc's RTSP over TLS that tolerates the console's self-signed certificate; without
    ``enableSrtp`` the media is plain RTP inside that TLS connection (go2rtc cannot take SRTP here, and the
    house's spike played Front Door that way). Other query parameters, if Protect ever adds any, stay."""
    parts = urlsplit(url)
    scheme = "rtspx" if parts.scheme == "rtsps" else parts.scheme
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "enableSrtp"]
    return StreamUrl(urlunsplit((scheme, parts.netloc, parts.path, urlencode(query), "")))


def parse_version(text: str) -> tuple[int, ...]:
    """``7.3.70`` -> (7, 3, 70); a suffix ("-beta") is ignored; () when there are no digits at all."""
    m = re.match(r"\s*v?(\d+(?:\.\d+)*)", text or "")
    return tuple(int(p) for p in m.group(1).split(".")) if m else ()


# -- the camera --------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Camera:
    """One camera as the public API lists it (only what Mantel uses).

    ``smart_types`` is what the MODEL can detect (``featureFlags.smartDetectTypes``) and ``smart_on`` what is
    TURNED ON in Protect (``smartDetectSettings.objectTypes``), both in Protect's words ("licensePlate").
    A camera with no ``smart_types`` reports motion only."""
    id: str
    name: str
    model: str                       # Protect's ``type``, e.g. "UVC G4 Doorbell Pro"
    state: str                       # CONNECTED, DISCONNECTED, ...
    mac: str                         # as Protect gives it: 12 hex digits, uppercase, no colons
    has_speaker: bool
    has_mic: bool
    smart_types: tuple[str, ...]
    smart_on: tuple[str, ...]
    is_doorbell: bool
    has_package_camera: bool = False
    full_hd_snapshot: bool = False   # ``snapshot(high=True)`` is a real step up only where this is true

    @classmethod
    def from_api(cls, d: dict[str, Any]) -> "Camera":
        flags = d.get("featureFlags") or {}
        settings = d.get("smartDetectSettings") or {}
        model = str(d.get("type") or "")
        # No doorbell flag exists in the public API. The model name says it, and only a doorbell has the LCD.
        doorbell = "doorbell" in model.lower() or "lcdMessage" in d
        return cls(id=str(d.get("id") or ""), name=str(d.get("name") or ""), model=model, state=str(d.get("state") or ""),
                   mac=str(d.get("mac") or "").upper(), has_speaker=bool(flags.get("hasSpeaker")),
                   has_mic=bool(flags.get("hasMic")), smart_types=tuple(flags.get("smartDetectTypes") or ()),
                   smart_on=tuple(settings.get("objectTypes") or ()), is_doorbell=doorbell,
                   has_package_camera=bool(d.get("hasPackageCamera")),
                   full_hd_snapshot=bool(flags.get("supportFullHdSnapshot")))

    @property
    def online(self) -> bool:
        return self.state == "CONNECTED"

    @property
    def motion_only(self) -> bool:
        """The model has no smart detection: its own motion detection is all it reports (the plan's decision 3)."""
        return not self.smart_types

    @property
    def smart_off(self) -> tuple[str, ...]:
        """Supported but not on in Protect: the ones "Turn On in Protect" offers."""
        return tuple(t for t in self.smart_types if t not in self.smart_on)

    @property
    def kinds(self) -> tuple[str, ...]:
        """The Mantel event kinds this camera can report (what "Notify For" lists): ``ring`` for a doorbell, then
        its smart types, or ``motion`` where it has none."""
        out = ["ring"] if self.is_doorbell else []
        smart = [SMART_KINDS[t] for t in self.smart_types if t in SMART_KINDS]
        return tuple(out + (smart or ["motion"]))

    @property
    def kinds_on(self) -> tuple[str, ...]:
        """Of ``kinds``, the ones Protect is actually detecting now (``motion`` is always on)."""
        out = ["ring"] if self.is_doorbell else []
        if self.motion_only:
            return tuple(out + ["motion"])
        return tuple(out + [SMART_KINDS[t] for t in self.smart_types if t in self.smart_on and t in SMART_KINDS])


class Talkback(NamedTuple):
    """A talkback session: where to send RTP (``rtp://<camera>:7004``), in what codec, at what sampling rate."""
    url: str
    codec: str
    sampling_rate: int


# -- pacing ----------------------------------------------------------------------------------------------
class TokenBucket:
    """``rate`` tokens a second up to ``burst``; ``acquire`` waits for one. In any window of ``w`` seconds at most
    ``burst + rate * w`` are granted, so RATE_PER_S + BURST is the busiest second there can be.

    ``pause`` holds everything back for a while (the console said none are left, or answered 429). The clock and the
    sleep are parameters so a test runs a minute of pacing in no time."""

    def __init__(self, rate: float = RATE_PER_S, burst: int = BURST, *,
                 clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep):
        self.rate, self.burst = float(rate), int(burst)
        self._clock, self._sleep = clock, sleep
        self._tokens = float(burst)
        self._at = clock()
        self._paused_until = 0.0

    def pause(self, seconds: float) -> None:
        self._paused_until = max(self._paused_until, self._clock() + max(seconds, 0.0))

    async def acquire(self) -> None:
        while True:
            now = self._clock()
            self._tokens = min(float(self.burst), self._tokens + (now - self._at) * self.rate)
            self._at = now
            wait = self._paused_until - now
            if wait <= 0 and self._tokens >= 1.0 - 1e-9:       # (a float that is a hair under one is one)
                self._tokens = max(self._tokens - 1.0, 0.0)
                return
            await self._sleep(max(wait if wait > 0 else (1.0 - self._tokens) / self.rate, 0.001))


_RATE_R = re.compile(r"\br=(\d+)")
_RATE_T = re.compile(r"\bt=(\d+(?:\.\d+)?)")


@dataclass
class _Reply:
    status: int
    headers: Any
    body: bytes

    @property
    def content_type(self) -> str:
        return (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()

    def json(self) -> Any:
        try:
            return json.loads(self.body)
        except ValueError:
            return None

    def message(self) -> str:
        data = self.json()
        err = data.get("error") if isinstance(data, dict) else None
        if isinstance(err, dict):
            return str(err.get("message") or "")
        return str(err or (data.get("message") if isinstance(data, dict) else "") or "")


class ProtectClient:
    """The public API of one console.

    ``host`` is the console's address (``unifi.local``, optionally ``:port``); ``session_factory`` makes the
    ``aiohttp.ClientSession`` used (called once, on first use; ``close()`` closes it, so give it a session of its
    own). ``pinned_sha256`` is the certificate fingerprint to hold the console to; None on the very first connect,
    when the first request learns it (``fetch_certificate``) and ``pinned_sha256`` then holds it for the caller to
    keep. ``clock`` and ``sleep`` are for tests."""

    def __init__(self, host: str, api_key: str, session_factory: Callable[[], aiohttp.ClientSession],
                 pinned_sha256: str | None = None, *, clock: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep):
        name, port = split_host(host)
        self.host = host.strip()
        self._netloc = (f"[{name}]" if ":" in name else name) + ("" if port == 443 else f":{port}")
        self._api_key = api_key
        self._session_factory = session_factory
        self._session: aiohttp.ClientSession | None = None
        self._pin: str | None = None
        self._fingerprint: aiohttp.Fingerprint | None = None
        self.set_pin(pinned_sha256)
        self._sleep = sleep
        self._bucket = TokenBucket(clock=clock, sleep=sleep)

    def __repr__(self) -> str:                                 # the key never appears in a log line or a traceback
        pin = f"{self._pin[:12]}..." if self._pin else None
        return f"ProtectClient(host={self.host!r}, pinned={pin!r})"

    # -- trust ----------------------------------------------------------------------------------------
    @property
    def pinned_sha256(self) -> str | None:
        return self._pin

    def set_pin(self, fingerprint: str | None) -> None:
        """Pin (or, with None, un-pin) the certificate. The ``Fingerprint`` is kept as one object: aiohttp keys its
        pooled connections by it, and a new object per request would be a new TLS connection per request."""
        if fingerprint:
            self._pin = normalize_fingerprint(fingerprint)
            self._fingerprint = aiohttp.Fingerprint(bytes.fromhex(self._pin))
        else:
            self._pin, self._fingerprint = None, None

    async def _ensure_pin(self) -> aiohttp.Fingerprint:
        if self._fingerprint is None:
            self.set_pin(await fetch_certificate(self._netloc))
            log.info("protect %s: pinned certificate %s", self.host, self._pin)
        assert self._fingerprint is not None
        return self._fingerprint

    # -- plumbing -------------------------------------------------------------------------------------
    def _url(self, path: str, scheme: str = "https") -> str:
        return f"{scheme}://{self._netloc}{API_ROOT}{path}"

    def _http(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = self._session_factory()
        return self._session

    async def close(self) -> None:
        if self._session is not None and not self._session.closed:
            await self._session.close()
        self._session = None

    async def __aenter__(self) -> "ProtectClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()

    def _note_rate(self, headers: Any) -> None:
        """``ratelimit: "10-in-1sec"; r=9; t=1``: with none left (r=0), hold off until the window resets (t seconds)."""
        value = headers.get("RateLimit") or ""
        left, reset = _RATE_R.search(value), _RATE_T.search(value)
        if left and reset and int(left.group(1)) == 0:
            self._bucket.pause(float(reset.group(1)))

    def _retry_wait(self, headers: Any) -> float:
        """How long a 429 asks to wait: ``Retry-After`` (seconds), else the ``t=`` of ``ratelimit``, else a second."""
        reset = _RATE_T.search(headers.get("RateLimit") or "")
        for raw in (headers.get("Retry-After"), reset.group(1) if reset else None):
            try:
                return min(max(float(raw), 0.05), RETRY_AFTER_MAX_S)
            except (TypeError, ValueError):
                continue
        return 1.0

    async def _call(self, method: str, path: str, *, params: dict[str, str] | None = None, body: Any = None,
                    authed: bool = True) -> _Reply:
        """One paced request. ``authed=False`` is the probe that must not carry the key. Raises KeyRefused on 401 or
        403 (authed), RateLimited on a second 429, ProtectApiError on any other 4xx or 5xx, CertificateChanged,
        Unreachable."""
        fingerprint = await self._ensure_pin()
        headers = {"X-API-KEY": self._api_key} if authed else {}
        for attempt in (0, 1):
            await self._bucket.acquire()
            try:
                async with self._http().request(
                        method, self._url(path), headers=headers, params=params, json=body, ssl=fingerprint,
                        allow_redirects=False,
                        timeout=aiohttp.ClientTimeout(total=REQUEST_TIMEOUT_S, connect=CONNECT_TIMEOUT_S)) as resp:
                    reply = _Reply(resp.status, resp.headers, await resp.read())
            except aiohttp.ServerFingerprintMismatch as err:
                raise CertificateChanged(self._pin or "", err.got.hex()) from None
            except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as err:
                raise Unreachable(f"Mantel lost the connection to {self.host} ({err.__class__.__name__}).") from err
            self._note_rate(reply.headers)
            if reply.status == 429:
                wait = self._retry_wait(reply.headers)
                self._bucket.pause(wait)
                if attempt == 0:
                    log.debug("protect %s: 429 on %s %s, retrying after %.2fs", self.host, method, path, wait)
                    continue
                raise RateLimited("UniFi Protect is limiting requests from this key. Another program may share it; "
                                  "wait a moment and try again.")
            if authed and reply.status in (401, 403):
                raise KeyRefused("The console refused the API key. Make a new one in UniFi OS (Settings, Control Plane, "
                                 "Integrations) and enter it again.")
            if reply.status >= 400 and authed:
                raise ProtectApiError(reply.status, reply.message())
            return reply
        raise AssertionError("unreachable")                          # pragma: no cover

    async def _json(self, method: str, path: str, **kw: Any) -> Any:
        reply = await self._call(method, path, **kw)
        data = reply.json()
        if data is None and reply.body.strip():
            raise ProtectApiError(reply.status, "not the answer Protect gives")
        return data

    # -- Connect's checks -------------------------------------------------------------------------------
    async def check(self) -> dict[str, Any]:
        """Run Connect's checks in order and return ``{version, console_name, cameras, fingerprint}``; the first that
        fails raises its own error: ``Unreachable`` / ``NotAConsole`` (the address), ``CertificateChanged`` (the pin),
        ``KeyRefused`` (the key), ``ProtectTooOld`` (the version).

        1. The address answers as a Protect console. Asked WITHOUT the key, so the key goes nowhere else:
           ``/v1/meta/info`` must answer JSON, 401 for an unauthenticated caller or 200.
        2. (With the probe) the certificate: learned on the first connect, held to afterwards.
        3. The key works: ``/v1/meta/info`` with it.
        4. Protect is at least MIN_VERSION."""
        fresh = self._fingerprint is None
        probe = await self._call("GET", "/v1/meta/info", authed=False)
        if probe.status not in (200, 401, 403) or probe.content_type != "application/json":
            if fresh:
                self.set_pin(None)                   # nothing here deserves trust: do not keep its pin
            raise NotAConsole(f"{self.host} does not answer as a UniFi console running Protect. Check the address "
                              "(the console's own, such as unifi.local) and that Protect is installed.")
        info = await self._json("GET", "/v1/meta/info")
        version = str((info or {}).get("applicationVersion") or "")
        if not version or parse_version(version) < MIN_VERSION:
            raise ProtectTooOld(version)
        console = None
        try:
            nvr = await self._json("GET", "/v1/nvrs")
            nvr = nvr[0] if isinstance(nvr, list) and nvr else nvr           # one object on 7.3.70; a list is tolerated
            console = str(nvr.get("name") or "") or None if isinstance(nvr, dict) else None
        except ProtectApiError:
            pass                                                              # the name is a courtesy, not a check
        cams = await self._json("GET", "/v1/cameras")
        return {"version": version, "console_name": console, "cameras": len(cams or []), "fingerprint": self._pin}

    # -- cameras ---------------------------------------------------------------------------------------
    async def cameras(self) -> list[Camera]:
        return [Camera.from_api(d) for d in (await self._json("GET", "/v1/cameras") or []) if isinstance(d, dict)]

    async def camera(self, camera_id: str) -> Camera:
        return Camera.from_api(await self._json("GET", f"/v1/cameras/{camera_id}") or {})

    async def rtsps_streams(self, camera_id: str, create: bool = True,
                            qualities: Iterable[str] = ("high", "low")) -> dict[str, StreamUrl]:
        """The camera's streams as go2rtc addresses (``rtspx://``), by quality (``high``, ``medium``, ``low``,
        ``package``). Protect makes a stream only when asked: with ``create`` the wanted ``qualities`` that do not exist
        yet are made (POST ``{"qualities": [...]}``; the owner's camera is not otherwise touched), with ``create=False``
        only what exists is returned. Every quality Protect lists comes back, wanted or not."""
        path = f"/v1/cameras/{camera_id}/rtsps-stream"
        try:
            have = self._streams(await self._json("GET", path))
        except ProtectApiError as err:
            if err.status != 404:
                raise
            have = {}
        missing = [q for q in qualities if q not in have]
        if create and missing:
            have.update(self._streams(await self._json("POST", path, body={"qualities": missing})))
        return have

    @staticmethod
    def _streams(data: Any) -> dict[str, StreamUrl]:
        return {q: rtspx_url(u) for q, u in (data or {}).items() if isinstance(u, str) and u} if isinstance(data, dict) else {}

    async def snapshot(self, camera_id: str, high: bool = False) -> bytes:
        """A still (JPEG). ``high`` asks for full resolution, which only a camera with ``Camera.full_hd_snapshot`` has."""
        reply = await self._call("GET", f"/v1/cameras/{camera_id}/snapshot", params={"highQuality": "true"} if high else None)
        if not reply.content_type.startswith("image/"):
            raise ProtectApiError(reply.status, "not a picture")
        return reply.body

    async def set_smart_types(self, camera_id: str, types: Iterable[str], *, merge: bool = False) -> Camera:
        """Turn on exactly ``types`` for ONE camera (``PATCH /v1/cameras/<id>`` ``{"smartDetectSettings":
        {"objectTypes": [...]}}``, nothing else in the body), in Protect's words (``licensePlate``) or Mantel's
        (``license_plate``). With ``merge``, ``types`` are added to what is on now, which is what "Turn On in
        Protect" wants: a type is switched on and nothing else is switched off.

        Refused with ``SmartTypeUnsupported``, before anything is sent, for a type the camera's model cannot do (or
        one Protect has no such thing as); Protect would ignore or reject it, and the owner should be told which.
        Returns the camera as it is afterwards."""
        wanted = [SMART_NAMES.get(t, t) for t in types]
        cam = await self.camera(camera_id)
        bad = [t for t in wanted if t not in cam.smart_types]
        if bad:
            raise SmartTypeUnsupported(f"{cam.name or camera_id} ({cam.model}) can't detect {', '.join(bad)}; "
                                       f"it can do {', '.join(cam.smart_types) or 'motion only'}.")
        union = set(wanted) | (set(cam.smart_on) if merge else set())
        ordered = [t for t in cam.smart_types if t in union] + sorted(t for t in union if t not in cam.smart_types)
        data = await self._json("PATCH", f"/v1/cameras/{camera_id}", body={"smartDetectSettings": {"objectTypes": ordered}})
        if isinstance(data, dict) and data.get("featureFlags"):
            return Camera.from_api(data)
        return replace(cam, smart_on=tuple(ordered))

    async def talkback_session(self, camera_id: str) -> Talkback:
        """Open a talkback session on a camera with a speaker: where to send RTP, in what codec, at what rate. (What
        the audio is, and the Pacer that feeds it, is hk_core/link/talk_live.py's.)"""
        data = await self._json("POST", f"/v1/cameras/{camera_id}/talkback-session")
        if not isinstance(data, dict) or not data.get("url"):
            raise ProtectApiError(200, "no talkback session")
        return Talkback(str(data["url"]), str(data.get("codec") or ""), int(data.get("samplingRate") or 0))

    # -- the websocket ----------------------------------------------------------------------------------
    async def connect_socket(self, channel: str = "events") -> aiohttp.ClientWebSocketResponse:
        """Open ``/v1/subscribe/<channel>`` (``events``, or ``devices``): aiohttp speaks the HTTP/1.1 upgrade the
        console wants. Pinned like every other connection; the key goes in the header, never the URL."""
        fingerprint = await self._ensure_pin()
        await self._bucket.acquire()
        try:
            return await asyncio.wait_for(
                self._http().ws_connect(self._url(f"/v1/subscribe/{channel}", "wss"), headers={"X-API-KEY": self._api_key},
                                        ssl=fingerprint, heartbeat=HEARTBEAT_S), CONNECT_TIMEOUT_S * 3)
        except aiohttp.WSServerHandshakeError as err:
            if err.status in (401, 403):
                raise KeyRefused("The console refused the API key. Make a new one in UniFi OS (Settings, Control Plane, "
                                 "Integrations) and enter it again.") from None
            raise ProtectApiError(err.status, "the events socket was refused") from None
        except aiohttp.ServerFingerprintMismatch as err:
            raise CertificateChanged(self._pin or "", err.got.hex()) from None
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as err:
            raise Unreachable(f"Mantel lost the connection to {self.host} ({err.__class__.__name__}).") from err


# -- events ------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class ProtectEvent:
    """One thing the camera reported, in Mantel's words.

    ``kind`` is one of KINDS. ``event_id`` is Protect's, shared by every kind of one detection (a person and a
    face seen together are two ``ProtectEvent``s with one ``event_id``), so a consumer keys on (event_id, kind).
    ``start`` and ``end`` are milliseconds since the epoch; ``active`` is true from the first sight until ``end``
    arrives. A ``ring`` is one moment: it is yielded once, ``active``, and never again."""
    kind: str
    camera_id: str
    event_id: str
    start: int
    end: int | None
    active: bool


@dataclass
class _Seen:
    item: dict[str, Any] = field(default_factory=dict)             # the event as merged from every message so far
    sent: dict[str, tuple] = field(default_factory=dict)           # kind -> the state last yielded for it


class EventStream:
    """Protect's events websocket as an endless iterator of ``ProtectEvent``s.

    ``async for event in EventStream(client).events():`` connects, and when the socket drops or cannot open,
    waits BACKOFF_S (1, 2, 5, 10, 30 s, the last repeating; starting over once a socket spoke or lived STABLE_S)
    and connects again, for as long as the consumer iterates. Only two things end it, by raising: a certificate
    that is no longer the pinned one, and a refused key. Retrying those would only hammer the console; the caller
    shows the owner what to fix. ``close()`` ends it quietly.

    WHAT IT DOES TO THE MESSAGES (see the module notes for what the console sends):

    * It MERGES. Updates are not diffs and may omit fields, so each event is kept (the last MEMORY of them) and every
      message is folded into it; ``smartDetectTypes`` only ever grows.
    * It DE-DUPLICATES. An event is yielded when what it says changed: a new kind (the face that joins a person), or
      ``end`` arriving. The same update twice, three times, in another key order, yields nothing.
    * It NORMALIZES. ``smartDetectZone`` becomes one event per type (face -> ``face``, licensePlate ->
      ``license_plate``), ``motion`` and ``ring`` stay. Anything else (a sensor, smart audio, a line crossing, a type
      Mantel has no kind for) is ignored, and logged once per name, not per message.

    Health, for Connections: ``last_message_at`` (``clock()`` at the last message of any kind, None before the
    first; a quiet night is old, not broken, so ``connected`` says whether the socket is up), ``connected``,
    ``last_error`` (the last reason it was not), ``reconnects``."""

    def __init__(self, client: ProtectClient, *, channel: str = "events", backoff: tuple[float, ...] = BACKOFF_S,
                 stable_s: float = STABLE_S, clock: Callable[[], float] = time.time,
                 monotonic: Callable[[], float] = time.monotonic,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep):
        self._client, self._channel, self._backoff, self._stable_s = client, channel, backoff, stable_s
        self._clock, self._monotonic, self._sleep = clock, monotonic, sleep
        self._seen: OrderedDict[str, _Seen] = OrderedDict()
        self._ignored: set[str] = set()
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._closed = False
        self.last_message_at: float | None = None
        self.connected = False
        self.last_error: str | None = None
        self.reconnects = 0

    def __repr__(self) -> str:
        return f"EventStream({self._client!r}, connected={self.connected})"

    def __aiter__(self) -> AsyncIterator[ProtectEvent]:
        return self.events()

    async def close(self) -> None:
        self._closed = True
        if self._ws is not None and not self._ws.closed:
            await self._ws.close()

    async def events(self) -> AsyncIterator[ProtectEvent]:
        step = 0
        while not self._closed:
            opened = None
            spoke = False
            try:
                self._ws = await self._client.connect_socket(self._channel)
                opened, self.connected, self.last_error = self._monotonic(), True, None
                async for msg in self._ws:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        spoke = True
                        self.last_message_at = self._clock()
                        for event in self._ingest(msg.data):
                            yield event
                    elif msg.type == aiohttp.WSMsgType.ERROR:
                        self.last_error = f"socket error: {self._ws.exception()}"
                        break
                if self.last_error is None:
                    self.last_error = "the console closed the events socket"
            except (CertificateChanged, KeyRefused) as err:
                self.last_error = str(err)
                raise
            except ProtectError as err:
                self.last_error = str(err)
            except (aiohttp.ClientError, asyncio.TimeoutError, OSError) as err:
                self.last_error = f"events socket: {err.__class__.__name__}"
            finally:
                self.connected = False
                ws, self._ws = self._ws, None
                if ws is not None and not ws.closed:
                    await ws.close()
            if self._closed:
                return
            if spoke or (opened is not None and self._monotonic() - opened >= self._stable_s):
                step = 0
            delay = self._backoff[min(step, len(self._backoff) - 1)]
            step += 1
            self.reconnects += 1
            log.info("protect %s: events socket down (%s); redialing in %gs", self._client.host, self.last_error, delay)
            await self._sleep(delay)

    # -- one message -----------------------------------------------------------------------------------
    def _ignore(self, what: str) -> None:
        if what not in self._ignored:
            self._ignored.add(what)
            log.info("protect: ignoring events of type %r (Mantel has no kind for them)", what)

    def _ingest(self, raw: str) -> list[ProtectEvent]:
        try:
            msg = json.loads(raw)
        except ValueError:
            self._ignore("<not JSON>")
            return []
        item = msg.get("item") if isinstance(msg, dict) else None
        if not isinstance(item, dict) or item.get("modelKey") != "event" or not item.get("id"):
            return []
        if msg.get("type") not in ("add", "update"):
            return []
        seen = self._seen.get(item["id"])
        if seen is None:
            seen = self._seen[item["id"]] = _Seen()
            while len(self._seen) > MEMORY:
                self._seen.popitem(last=False)
        self._seen.move_to_end(item["id"])
        merged = seen.item
        for key, value in item.items():
            if key == "smartDetectTypes":
                merged[key] = list(dict.fromkeys([*merged.get(key, []), *(value or [])]))      # only ever grows
            elif value is not None:
                merged[key] = value

        etype, camera = merged.get("type"), merged.get("device")
        if etype == "motion":
            kinds = ["motion"]
        elif etype == "ring":
            kinds = ["ring"]
        elif etype == "smartDetectZone":
            kinds = []
            for name in merged.get("smartDetectTypes", []):
                if name in SMART_KINDS:
                    kinds.append(SMART_KINDS[name])
                else:
                    self._ignore(f"smartDetectZone/{name}")
        else:
            self._ignore(str(etype))
            return []
        if not camera:
            return []
        try:
            start = int(merged.get("start") or self._clock() * 1000)
        except (TypeError, ValueError):
            return []
        end = merged.get("end")
        end = int(end) if isinstance(end, (int, float)) else None

        out = []
        for kind in kinds:
            # A ring has an end from its first message (the ring tone's length): it is one moment, never "over".
            active = True if kind == "ring" else end is None
            state = (start,) if kind == "ring" else (start, end, active)
            if seen.sent.get(kind) != state:
                seen.sent[kind] = state
                out.append(ProtectEvent(kind, str(camera), str(item["id"]), start, end, active))
        return out
