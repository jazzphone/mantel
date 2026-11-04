"""One-time links: how Music Assistant is allowed to fetch one broadcast's audio (docs/phase17/INTERCOM.md
"Getting the audio to MA: the stream listener and the one-time link").

A link is a random token for exactly one spool. Mantel keeps only ``sha256(token)`` (a dictionary key, in memory,
so a restart forgets every link). The rules, all of them answered with ``None`` (the listener turns that into one
bare 404, so a caller can't tell a wrong token from an expired, used or wrong-peer one):

* unknown, expired or killed: no;
* the peer must be a home (private) address (``direct.in_lan``), and equal ``expected_peer()`` when that is set
  (the address MA's URL resolves to, when it is an IP address): a public peer gets nothing even if the port is
  wrongly forwarded;
* the first GET claims the link and records the peer; one more GET from that peer is allowed (MA retries a
  dropped connection); any other peer, or a third GET, gets nothing;
* HEAD never claims, and is allowed only before a claim or for the claimer.

Expiry: unclaimed after UNCLAIMED_LIVE (Message: UNCLAIMED_MESSAGE) seconds; claimed, AFTER_END seconds after the
spool ends (a Message: after it was claimed) and never later than the mode's limit plus LIMIT_GRACE. The token is
never logged.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from ipaddress import ip_address

from .. import direct
from .spool import Spool

log = logging.getLogger("mantel.intercom")

UNCLAIMED_LIVE = 20.0       # seconds a Live (or check) link waits for its first GET
UNCLAIMED_MESSAGE = 30.0    # the same for a Message
AFTER_END = 15.0            # seconds a claimed link outlives the end of its audio (a retry's window)
LIMIT_GRACE = 30.0          # past the mode's limit, the hard end of any link
MAX_GETS = 2                # the claim and one same-peer retry


@dataclass(eq=False)
class Link:
    spool: Spool
    finite: bool                    # a Message: the spool is finished and served with a Content-Length
    mode: str                       # "live" | "message" | "check"
    created: float
    limit_s: float                  # the mode's limit; the hard end is created + limit_s + LIMIT_GRACE
    peer: str | None = None         # who claimed it (the first GET)
    gets: int = 0                   # GETs served
    claimed_at: float | None = None
    fetch_started: asyncio.Event = field(default_factory=asyncio.Event)   # the first byte went out
    fetch_ended: asyncio.Event = field(default_factory=asyncio.Event)     # the response ended, however
    ended_early: bool = False       # a fetch ended before the spool was finished (the driver's failure signal)
    dead: bool = False
    served: int = 0                        # bytes of audio written to the fetcher (counts only, never content)
    stalls: int = 0                        # writes that waited over STALL_S for the fetcher to take them (the proof's P3)


def _key(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _norm(address: str | None) -> str | None:
    """An address in one spelling (IPv4-mapped IPv6 is the IPv4 address), or None if it isn't one."""
    try:
        ip = ip_address(address or "")
    except ValueError:
        return None
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return str(ip)


class Links:
    def __init__(self, cfg=None, clock: Callable[[], float] = time.monotonic,
                 expected_peer: Callable[[], str | None] = lambda: None):
        self.cfg = cfg
        self.clock = clock
        self.expected_peer = expected_peer
        self._links: dict[str, Link] = {}

    def __len__(self) -> int:
        return len(self._links)

    def mint(self, spool: Spool, *, mode: str, finite: bool, limit_s: float) -> tuple[str, Link]:
        """A new link to ``spool``. Only the relay calls this, after the gateway's checks and the audit row."""
        self.sweep()
        token = secrets.token_urlsafe(32)               # 43 characters, 256 bits
        link = Link(spool=spool, finite=finite, mode=mode, created=self.clock(), limit_s=limit_s)
        self._links[_key(token)] = link
        return token, link

    def expired(self, link: Link) -> bool:
        if link.dead or link.spool.dropped:
            return True
        now = self.clock()
        if now > link.created + link.limit_s + LIMIT_GRACE:
            return True
        if link.claimed_at is None:
            return now > link.created + (UNCLAIMED_MESSAGE if link.mode == "message" else UNCLAIMED_LIVE)
        ended = link.spool.ended_at
        return ended is not None and now > max(ended, link.claimed_at) + AFTER_END

    def claim(self, token: str, peer: str | None, method: str) -> Link | None:
        """The link for this request, or None for every kind of refusal (the caller answers one bare 404)."""
        link = self._links.get(_key(token)) if isinstance(token, str) else None
        if link is None:
            return None
        if self.expired(link):
            self.kill(link)
            return None
        who = _norm(peer)
        if who is None or not direct.in_lan(self.cfg, who):
            return None
        want = self.expected_peer()
        if want is not None and _norm(want) != who:
            return None
        if method == "HEAD":
            return link if link.peer is None or link.peer == who else None
        if method != "GET":
            return None
        if link.peer is None:
            link.peer, link.gets, link.claimed_at = who, 1, self.clock()
            log.info("intercom link claimed by %s", who)
            return link
        if link.peer == who and link.gets < MAX_GETS:
            link.gets += 1
            return link
        return None

    def kill(self, link: Link) -> None:
        """End a link now: no new request gets it, and a fetch in progress stops at its next wake-up."""
        link.dead = True
        for key, other in list(self._links.items()):
            if other is link:
                del self._links[key]
        link.spool.wake()

    def kill_all(self) -> None:
        for link in list(self._links.values()):
            self.kill(link)

    def sweep(self) -> None:
        """Forget the expired links (the relay calls this on its tick; mint does too)."""
        for link in list(self._links.values()):
            if self.expired(link):
                self.kill(link)
