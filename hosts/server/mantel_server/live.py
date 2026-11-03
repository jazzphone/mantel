"""One lifecycle for long-lived connections: everything that stays open holding a person, a wall tablet or a link
credential is in one registry, ``app["live"]``.

Before this, each kind kept its own list and its own idea of when to look again: the policy tick re-read the page
sockets and the relayed reads, the media proxy and Mantel Link each had a timer of their own, a live talk looked at
the tick, and the subscriptions inside a socket (Music Assistant's events, the music feed, the settings feed) were
never asked again at all. A revoked session, device or link credential ended them up to a minute later, and one
whose role lost a feature kept what it had (RBAC-2, RBAC-3, WEB-1 in the second-pass audit).

An entry (``Live.add``) says:

* ``kind``: what it is (``hub``, ``linked_reads``, ``talk``, ``media_proxy:music_assistant``, ``mantel_link``, or a
  subscription's message type, ``hk_music/subscribe``, ``ma/subscribe``, ...);
* ``principal``: who it is open as (an ``authz.Principal``, refreshed in place, or for Mantel Link its Service
  account); its ``subject_keys`` (``user:<id>``, ``device:<id>``, ``session:<id>``, ``ha:<HA user>``, and any the
  caller adds, ``service:<id>``) are what a revocation names;
* ``close(why)``: ends it (sync or async);
* ``recheck()``: optional, whether it may go on now (the feature grant, the speaker, the credential);
* ``needs_commands``: it only makes sense while house commands are on (a live talk, a Music Assistant page signed
  in past the gateway).

Three things walk it:

* ``revoke(*subjects)``: what changed a person, a tablet, a session or a credential calls it (``notify`` from sync
  code, which runs it on the next turn of the loop). Each matching entry is re-checked at once: its principal is
  read again (``Authz.refresh``) and its ``recheck`` asked; one no longer allowed is closed. So a revocation ends
  what it named within one turn of the loop, and only that.
* ``check()``: the same over every entry, from the once-a-minute policy tick (schedules, guest windows, a role
  lowered or a grant removed).
* ``commands_off()`` and ``close_all()``: Allow Control of the House turned off ends every ``needs_commands`` entry;
  shutting down ends everything.

A principal shared by several entries (a page socket and the subscriptions it opened) is read once per walk.
"""
from __future__ import annotations

import asyncio
import inspect
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Iterable

log = logging.getLogger("mantel.live")

# the kinds a route may declare as ``stream="live:<kind>"`` (route_table.py, R5): what each long-lived answer adds
# here under (an entry's kind is this, or this followed by ``:`` and what it holds)
KINDS = frozenset({"hub", "talk", "linked", "linked_reads", "media_proxy"})

SHUTDOWN = "server_shutting_down"
REVOKED = "revoked"
NOT_ALLOWED = "no_longer_allowed"
COMMANDS_OFF = "refused:commands_disabled"


async def _resolve(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def subject_keys(principal: Any) -> frozenset[str]:
    """What a revocation may name for this principal: its person, its tablet, its session, their HA users."""
    ident = getattr(principal, "identity", principal)
    keys: set[str] = set()
    user, device = getattr(ident, "user", None), getattr(ident, "device", None)
    if user is not None and getattr(user, "id", None):
        keys.add(f"user:{user.id}")
        if getattr(user, "ha_user_id", None):
            keys.add(f"ha:{user.ha_user_id}")
    if device is not None and getattr(device, "id", None):
        keys.add(f"device:{device.id}")
        if getattr(device, "ha_user_id", None):
            keys.add(f"ha:{device.ha_user_id}")
    sid = getattr(ident, "session_id", None)
    if sid:
        keys.add(f"session:{sid}")
    return frozenset(keys)


@dataclass(eq=False)
class Entry:
    kind: str
    principal: Any
    close_fn: Callable[[str], Awaitable[None] | None]
    recheck: Callable[[], Awaitable[bool] | bool] | None = None
    needs_commands: bool = False
    keys: frozenset[str] = frozenset()
    closed: bool = False
    why: str | None = None
    live: "Live | None" = field(default=None, repr=False)

    @property
    def subject_keys(self) -> frozenset[str]:
        return self.keys | subject_keys(self.principal)

    def forget(self) -> None:
        """It ended by itself (the client left): out of the registry, nothing to close."""
        self.closed = True
        if self.live is not None:
            self.live.discard(self)

    async def close(self, why: str) -> None:
        if self.closed:
            return
        self.closed, self.why = True, why
        if self.live is not None:
            self.live.discard(self)
        try:
            await _resolve(self.close_fn(why))
        except Exception:  # noqa: BLE001 -- gone already: it is out of the registry either way
            log.debug("closing a %s entry failed", self.kind, exc_info=True)


class Live:
    def __init__(self, authz: Callable[[], Any] | None = None) -> None:
        self._authz = authz or (lambda: None)
        self._entries: dict[Entry, None] = {}            # insertion order: a socket before what it opened
        self._tasks: set[asyncio.Task] = set()

    # -- the registry -------------------------------------------------------------------------------------------
    def add(self, kind: str, principal: Any, close: Callable[[str], Awaitable[None] | None], *,
            recheck: Callable[[], Awaitable[bool] | bool] | None = None, needs_commands: bool = False,
            keys: Iterable[str] = ()) -> Entry:
        entry = Entry(kind, principal, close, recheck, bool(needs_commands), frozenset(keys), live=self)
        self._entries[entry] = None
        return entry

    def discard(self, entry: Entry | None) -> None:
        if entry is not None:
            self._entries.pop(entry, None)

    def entries(self, kind: str | None = None) -> list[Entry]:
        return [e for e in self._entries if kind is None or e.kind == kind]

    def matching(self, *subjects: str) -> list[Entry]:
        wanted = {s for s in subjects if isinstance(s, str) and s}
        return [e for e in self._entries if wanted & e.subject_keys]

    # -- walking it ---------------------------------------------------------------------------------------------
    async def check(self, entries: Iterable[Entry] | None = None, why: str = NOT_ALLOWED, *, strict: bool = False) -> int:
        """Each entry's principal read again, then its own recheck: one that may not go on is closed. The number
        closed. ``strict`` (a revocation): an entry that can neither be read again nor rechecked is closed."""
        from .authz import Principal
        authz = self._authz()
        read: dict[int, bool] = {}
        ended = 0
        for e in list(self._entries if entries is None else entries):
            if e.closed:
                continue
            p = e.principal
            if isinstance(p, Principal) and authz is not None:
                if id(p) not in read:
                    read[id(p)] = authz.refresh(p)
                ok = read[id(p)]
            else:
                ok = getattr(p, "valid", True) is not False and not (strict and e.recheck is None)
            if ok and e.recheck is not None:
                try:
                    ok = bool(await _resolve(e.recheck()))
                except Exception:  # noqa: BLE001 -- a check that fails is a no
                    log.exception("the check of a %s entry failed; ending it", e.kind)
                    ok = False
            if not ok:
                log.info("ending a %s no longer allowed (%s)", e.kind, why)
                await e.close(why)
                ended += 1
        return ended

    async def revoke(self, *subjects: str, why: str = REVOKED) -> int:
        """A person, tablet, session, HA user or credential changed: what it holds is checked now."""
        got = self.matching(*subjects)
        return await self.check(got, why, strict=True) if got else 0

    def notify(self, *subjects: str, why: str = REVOKED) -> None:
        """``revoke`` from sync code (a manager's revoke): on the next turn of the loop. Outside a loop (the command
        line) nothing is open anyway."""
        if not self._entries:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        task = loop.create_task(self.revoke(*subjects, why=why))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def close(self, entries: Iterable[Entry], why: str) -> int:
        got = [e for e in entries if not e.closed]
        for e in got:
            await e.close(why)
        return len(got)

    async def commands_off(self) -> int:
        """Allow Control of the House turned off: what needed it ends now."""
        return await self.close([e for e in self._entries if e.needs_commands], COMMANDS_OFF)

    async def close_all(self, why: str = SHUTDOWN, timeout: float = 3.0) -> None:
        """Shutting down: everything at once, each given ``timeout`` (the runner ends what does not answer)."""
        async def one(e: Entry) -> None:
            try:
                await asyncio.wait_for(e.close(why), timeout)
            except Exception:  # noqa: BLE001 -- gone already, or it will not answer
                pass
        await asyncio.gather(*(one(e) for e in list(self._entries)))


def of(app: Any) -> Live | None:
    return app.get("live") if hasattr(app, "get") else None


def notify(app: Any, *subjects: str, why: str = REVOKED) -> None:
    """For code that has the app and not the registry (accounts, people_ha, ingress): ``Live.notify``."""
    live = of(app)
    if live is not None:
        live.notify(*subjects, why=why)
