"""A LIVE TV STREAM'S OWN KEY, for a screen that plays it without Mantel's sign-in (2026-11-24, the owner: Live TV
AirPlayed from Safari to an Apple HomeView "acted like it was trying...but never succeeded", while Plex's did).

AirPlay hands the receiver the stream's address and the receiver fetches it itself, with none of the sender's
cookies: Mantel answered the HomeView "401 sign in". Plex's addresses carry their own token; Live TV's HLS address
now does too, under ``/go2rtc/key/<key>/`` (media_proxy.keyed), and it opens exactly what the person it was made
for may watch:

* one stream: the key names the HLS stream it was made for, and only that stream's playlists and segments
  (media_proxy.KEYED) are served under it;
* as that person: each request asks the same question a signed-in one does (Go2rtcStreams.may) with the principal
  of the connection that asked for the stream, re-read first (Authz.refresh): a session signed out, a device
  removed, a grant taken away, and the key opens nothing;
* for a while: KEY_TTL from when it was made, and only while Live TV has the stream set up;
* unguessable: 32 random bytes; a wrong key is a plain 404, as an unknown path.

While a screen fetches through it, the stream is held (live_tv.hold), so the HomeView keeps playing after the
phone that sent it locks or closes the page. Plain values only; the module keeps keys in memory (a restart forgets
them, and the page asks for a new one when it plays again).
"""
from __future__ import annotations

import re
import secrets
import time
from collections import OrderedDict
from typing import Any, Callable, NamedTuple

KEY_TTL = 8 * 3600.0              # a key opens its stream for this long after it was made
MAX_KEYS = 256                    # the oldest goes first beyond this
KEY = re.compile(r"^[A-Za-z0-9_-]{40,64}$")


class Grant(NamedTuple):
    src: str                      # the go2rtc stream it opens
    principal: Any                # who asked for it (authz.Principal), asked again on every request
    expires: float


class StreamKeys:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self.clock = clock
        self._keys: OrderedDict[str, Grant] = OrderedDict()

    def mint(self, principal: Any, src: str) -> str:
        """The key for ``src`` as ``principal``: the one already made on this connection while it has at least half
        its time left (the page renews every 45 s; one key a show), else a new one."""
        now = self.clock()
        self._expire(now)
        for key, g in self._keys.items():
            if g.src == src and g.principal is principal and g.expires - now > KEY_TTL / 2:
                return key
        key = secrets.token_urlsafe(32)
        self._keys[key] = Grant(src, principal, now + KEY_TTL)
        while len(self._keys) > MAX_KEYS:
            self._keys.popitem(last=False)
        return key

    def get(self, key: str) -> Grant | None:
        """The grant behind ``key``, or None (malformed, unknown or out of time)."""
        if not isinstance(key, str) or not KEY.match(key):
            return None
        g = self._keys.get(key)
        if g is None or g.expires <= self.clock():
            return None
        return g

    def forget(self, src: str) -> None:
        """Every key for a stream Live TV dropped."""
        for key in [k for k, g in self._keys.items() if g.src == src]:
            del self._keys[key]

    def _expire(self, now: float) -> None:
        for key in [k for k, g in self._keys.items() if g.expires <= now]:
            del self._keys[key]
