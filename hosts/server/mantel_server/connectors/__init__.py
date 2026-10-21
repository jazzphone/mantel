"""P3.4 connectors: Music Assistant (ma.py), camera signaling (camera.py); the read proxies live in
readproxy.py. What they share is here: the hooks (RBAC and the MA command gate) the orchestrator
passes to each module's `register(app, hub, hooks)`, the per-connection context their WebSocket
handlers get, and the two app tables they register into.

Wiring contract for P3.7 (server.py), the only place that joins these together:

* ``app["ws_handlers"]``: client message type -> ``async handler(ctx, msg)``. server.py's
  ClientSession dispatches a message whose type is in this table to its handler, AFTER
  ``classify()`` has refused anything command-shaped (so commands stay disabled whatever is
  registered here). The handler answers through ``ctx.send``.
* ``app["read_routes"]``: HA message type (inside a client ``read`` / ``read_subscribe``) ->
  ``Route``. readproxy.py's ``read`` handlers look here first, so a connector (camera) can answer
  a read the page sends exactly as it would to HA.
* one ``Ctx`` per client connection: ``Ctx(send=session.send, identity=<user+device>)``; call
  ``await ctx.close()`` when the socket ends (it ends every subscription the handlers opened).

Deny by default: every hook left out of ``Hooks`` refuses.
"""
from __future__ import annotations

import asyncio
import inspect
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Iterable, Mapping

log = logging.getLogger("mantel.connectors")


class Forbidden(Exception):
    """The subject may not read/view this. Nothing was forwarded."""


async def resolve(value: Any) -> Any:
    """A hook may answer directly or with an awaitable (P3.2's engine may need the db)."""
    if inspect.isawaitable(value):
        return await value
    return value


def deny_read(identity: Any, kind: str, ids: list[str]) -> Iterable[str]:
    return ()


def deny_view(identity: Any, entity_id: str) -> bool:
    return False


class RefuseAll:
    """The default Music Assistant command gate: nothing is ever allowed. P3.3's gateway replaces it."""

    def allow(self, identity: Any, command: str, args: Mapping[str, Any]) -> bool:
        return False


REFUSE_ALL = RefuseAll()


@dataclass(frozen=True)
class Hooks:
    """What the orchestrator passes to every ``register``.

    may_read(identity, kind, ids) -> the subset of ``ids`` the subject may ``kind`` ("view" or
        "history"). Ids are entity ids, statistic ids, or ``feature:<name>`` (music, energy,
        notifications, media, locations) for a whole feature, as PLAN §5's resources.
    may_view(identity, entity_id) -> bool: camera live view (``control.sensitive``/view-gated, §5).
    ma_gate.allow(identity, command, args) -> bool: may this MA command be sent (P3.3 owns it).
    ha_token() -> str: Mantel's HA credential, for connectors that open their own HA connection.
    """
    may_read: Callable[[Any, str, list[str]], Iterable[str] | Awaitable[Iterable[str]]] = deny_read
    may_view: Callable[[Any, str], bool | Awaitable[bool]] = deny_view
    ma_gate: Any = REFUSE_ALL
    ha_token: Callable[[], str] | None = None

    @classmethod
    def coerce(cls, hooks: "Hooks | Mapping[str, Any] | None") -> "Hooks":
        if hooks is None:
            return cls()
        if isinstance(hooks, cls):
            return hooks
        return cls(**dict(hooks))


async def allowed_ids(hooks: Hooks, identity: Any, kind: str, ids: Iterable[str]) -> set[str]:
    """The ids the subject may `kind`, never more than were asked about (a hook can't widen a read)."""
    asked = [i for i in dict.fromkeys(ids) if isinstance(i, str)]
    if not asked:
        return set()
    got = await resolve(hooks.may_read(identity, kind, list(asked)))
    return set(asked) & set(got or ())


async def may_feature(hooks: Hooks, identity: Any, feature: str) -> bool:
    key = f"feature:{feature}"
    return key in await allowed_ids(hooks, identity, "view", [key])


@dataclass
class Route:
    """How a connector answers an HA message type the page reads (see readproxy.register).

    request(ctx, msg) -> result; subscribe(ctx, msg, on_event) -> an async unsubscribe function.
    """
    request: Callable[["Ctx", dict], Awaitable[Any]] | None = None
    subscribe: Callable[["Ctx", dict, Callable[[dict], None]], Awaitable[Callable[[], Awaitable[None]]]] | None = None


@dataclass
class Ctx:
    """One client connection, as the connectors' handlers see it."""
    send: Callable[[dict], Awaitable[None]]
    identity: Any = None
    subs: dict[Any, Callable[[], Awaitable[None]]] = field(default_factory=dict)  # key -> async unsubscribe
    state: dict[str, Any] = field(default_factory=dict)                           # per-connector scratch
    starting: set = field(default_factory=set)       # keys whose subscription is being made (reserve/keep)
    _ended: set = field(default_factory=set)         # of those, keys ended (or the connection closed) meanwhile
    closed: bool = False

    def emit(self, msg: dict) -> None:
        """Send from a synchronous callback (an upstream event)."""
        asyncio.get_running_loop().create_task(self._emit(msg))

    async def _emit(self, msg: dict) -> None:
        try:
            await self.send(msg)
        except Exception as exc:  # noqa: BLE001 -- the client went away; its close() cleans up
            log.debug("dropped an event for a closed client: %s", exc)

    # A subscription whose start awaits (an upstream round trip) RESERVES its key first, so a second frame
    # with the same id is refused instead of overwriting the first's unsubscribe (which then never ran, and
    # its upstream session leaked: HA's WebRTC sessions, Live TV's streams). One ended, or whose connection
    # closed, while it started is ended as soon as it has started.
    def reserve(self, key: Any) -> bool:
        if self.closed or key in self.subs or key in self.starting:
            return False
        self.starting.add(key)
        return True

    async def keep(self, key: Any, unsub: Callable[[], Awaitable[None]] | None) -> None:
        self.starting.discard(key)
        if key in self._ended or self.closed:
            self._ended.discard(key)
            if unsub is not None:
                self.subs[key] = unsub
                await self.end(key)
            return
        if unsub is not None:
            self.subs[key] = unsub

    def unreserve(self, key: Any) -> None:
        """The start failed: the key is free again."""
        self.starting.discard(key)
        self._ended.discard(key)

    async def end(self, key: Any) -> None:
        if key in self.starting:
            self._ended.add(key)
        unsub = self.subs.pop(key, None)
        if unsub is not None:
            try:
                await unsub()
            except Exception as exc:  # noqa: BLE001 -- already ended upstream
                log.debug("unsubscribe %r: %s", key, exc)

    async def close(self) -> None:
        self.closed = True
        for key in list(self.subs):
            await self.end(key)


def ws_handlers(app) -> dict[str, Callable[[Ctx, dict], Awaitable[None]]]:
    if "ws_handlers" not in app:
        app["ws_handlers"] = {}
    return app["ws_handlers"]


def read_routes(app) -> dict[str, Route]:
    if "read_routes" not in app:
        app["read_routes"] = {}
    return app["read_routes"]
