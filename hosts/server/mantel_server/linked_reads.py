"""The features on a linked HK Frontend's dashboards, answered by Mantel (decision 29, docs/phase9/TWO-PRODUCTS.md
"features on HK Frontend's dashboards").

While Mantel runs the house HK Frontend runs no features in Home Assistant, so its dashboards' feature requests --
Live TV's channels, music, Clean Areas, the snooze and page-header feeds, a notification's snapshot, pop-ups --
had nobody to answer them. HK Frontend now passes each to Mantel over its link, and Mantel answers it with the same
handlers its own screens use (readproxy's ``read`` / ``read_subscribe`` / ``read_unsubscribe``), AS THE PERSON
linked to the Home Assistant user whose page asked (``ha_links``), so roles decide what each person gets.

    HK Frontend -> Mantel   page {id, ha_user, frame: {type: read | read_subscribe | read_unsubscribe, id, msg?}}
    Mantel -> HK Frontend   page_frame {ha_user, frame: {type: read_result | read_event, id, ...}}

* Only a linked HK Frontend that says so (feature ``reads``), and only the reads it forwards (``FORWARDED``, HK
  Frontend's ``READS_REQUEST`` and ``READS_SUBSCRIBE``; a test keeps them the same), each one of Mantel's own
  (``app["read_routes"]``): nothing here reaches Home Assistant's own data through Mantel, and a link credential
  cannot read Mantel's own data as a person (their saved data, settings history, Mantel Photos, cameras).
* An HA user linked to nobody is refused in words (``not_linked``), as a save is.
* One page context per (link, HA user); all of its subscriptions end when the link closes. HK Frontend asks
  again for what it had open when it reconnects. live.py's walk (a revocation, and the policy tick) re-checks
  each context as it does a page socket: an HA user unlinked, a person disabled or the user linked to someone
  else ends its subscriptions (at once when people_ha or ingress unlinks it); a role change applies to them at once.
* At most ``MAX_CONTEXTS`` (32) HA users' contexts per link: past it a new one is refused (``too_many``).
"""
from __future__ import annotations

import contextvars
import logging
from typing import Any

from aiohttp import web

log = logging.getLogger("mantel.linked_reads")

FEATURE = "reads"
# set while a relayed read runs: Mantel then never passes it on to Home Assistant (readproxy.FilteredReads), whose
# HK Frontend would relay it straight back here -- a loop (Live TV not on in Mantel: its interim read is HA's)
FROM_LINK: contextvars.ContextVar[bool] = contextvars.ContextVar("mantel_from_link", default=False)
FRAMES = ("read", "read_subscribe", "read_unsubscribe")
# the dashboards' reads HK Frontend forwards (its linked_mode.READS_REQUEST + READS_SUBSCRIBE), and nothing else
# page contexts one link may hold at once (one per Home Assistant user whose dashboard reads): a house has a handful
# of people and tablets; past it a new user's read is refused in words, the open ones go on
MAX_CONTEXTS = 32
FORWARDED = frozenset({"hk_tv/channels", "hk_music/queue", "hk_notify/snap/sign",
                       "hk_music/subscribe", "hk_clean_areas/subscribe", "hk_frontend/snooze/subscribe",
                       "hk_frontend/page_headers/subscribe", "hk_frontend/events/subscribe"})


class LinkedReads:
    def __init__(self, app: web.Application) -> None:
        self.app = app
        self.ctxs: dict[tuple[int, str], Any] = {}       # (id(client), ha_user) -> its page context
        self.entries: dict[tuple[int, str], Any] = {}    # ... -> its live.py entry

    def _person(self, ha_user: str) -> Any:
        from .network.ingress import linked_user
        from .linked import LinkedError
        from .identity.sessions import Identity, User
        row = linked_user(self.app["store"].db, ha_user)
        if row is None or row["disabled"]:
            from .linked_settings import UNLINKED
            raise LinkedError("not_linked", UNLINKED)
        user = User(id=row["id"], name=row["name"], role=row["role"], kind=row["kind"], username=row["username"],
                    ha_user_id=row["ha_user_id"])
        ident = Identity(user=user, device=None, door="ha")
        # the page socket's handlers ask the principal (RBAC's subject and gate), as for any page of Mantel's own
        # (authz.principal): a bare identity is nobody to them -- "may not use music", no Live TV channels
        authz = self.app.get("authz")
        return authz.principal_of(ident) if authz is not None else ident

    async def _ctx(self, client: Any, ha_user: str, identity: Any) -> Any:
        from .connectors import Ctx
        key = (id(client), ha_user)
        ctx = self.ctxs.get(key)
        if ctx is not None and not ctx.closed:
            if _person_id(ctx.identity) == _person_id(identity):
                authz = self.app.get("authz")
                if authz is not None and hasattr(ctx.identity, "gate"):
                    authz.refresh(ctx.identity)          # in place: what its subscriptions hold sees the new role
                return ctx
            await self._end(key)                         # linked to someone else now: the old person's reads end
        if sum(1 for k, c in self.ctxs.items() if k[0] == key[0] and not c.closed) >= MAX_CONTEXTS:
            from .linked import LinkedError
            raise LinkedError("too_many", f"one link relays the reads of at most {MAX_CONTEXTS} Home Assistant users "
                                          "at once")

        async def send(frame: dict) -> None:
            await client.send({"type": "page_frame", "ha_user": ha_user, "frame": frame})
        from . import live
        registry = live.of(self.app)
        ctx = self.ctxs[key] = Ctx(send=send, identity=identity, live=registry)
        if registry is not None:      # live.py: a revocation or the tick ends the context and its subscriptions
            async def close(_why: str) -> None:
                await self._end(key)
            self.entries[key] = registry.add("linked_reads", identity, close, keys=[f"ha:{ha_user}"])
        return ctx

    async def _end(self, key: tuple[int, str]) -> None:
        entry = self.entries.pop(key, None)
        if entry is not None:
            entry.forget()
        ctx = self.ctxs.pop(key, None)
        if ctx is None:
            return
        try:
            await ctx.close()
        except Exception:  # noqa: BLE001 -- already gone
            log.debug("linked reads: a page context ended badly", exc_info=True)

    async def page(self, client: Any, msg: dict[str, Any]) -> Any:
        """One ``page`` frame: the read, unsubscribe or subscription, handed to Mantel's own handlers. Their
        answers go back as ``page_frame``s; this only says it was taken."""
        from .connectors import ws_handlers
        from .linked import LinkedError
        from .linked_settings import _HA_USER
        if client.domain != "hk_frontend" or FEATURE not in client.features:
            raise LinkedError("not_set_up", "only a linked HK Frontend that forwards its dashboards' reads sends these")
        ha_user, frame = msg.get("ha_user"), msg.get("frame")
        if not isinstance(ha_user, str) or not _HA_USER.match(ha_user):
            raise LinkedError("invalid", "ha_user: a Home Assistant user id")
        if not isinstance(frame, dict) or frame.get("type") not in FRAMES or set(frame) - {"type", "id", "msg"} \
                or isinstance(frame.get("id"), bool) or not isinstance(frame.get("id"), int):
            raise LinkedError("invalid", "frame: {type: read | read_subscribe | read_unsubscribe, id, msg?}")
        if frame["type"] != "read_unsubscribe":
            inner = frame.get("msg")
            if not isinstance(inner, dict) or inner.get("type") not in FORWARDED \
                    or inner.get("type") not in (self.app.get("read_routes") or {}):
                raise LinkedError("not_mantels", f"{(inner or {}).get('type')!r} is not a read HK Frontend forwards")
        ctx = await self._ctx(client, ha_user, self._person(ha_user))
        handler = ws_handlers(self.app).get(frame["type"])
        if handler is None:
            raise LinkedError("not_set_up", "Mantel answers no page reads here")
        mark = FROM_LINK.set(True)
        try:
            await handler(ctx, frame)
        finally:
            FROM_LINK.reset(mark)
        return {"taken": True}

    async def closed(self, client: Any) -> None:
        for key in [k for k in self.ctxs if k[0] == id(client)]:
            await self._end(key)


def _person_id(identity: Any) -> str | None:
    user = getattr(identity, "user", None)
    return getattr(user, "id", None)


def register(app: web.Application) -> LinkedReads:
    """After linked.register and every read route's own register (they fill app["read_routes"])."""
    lr = LinkedReads(app)
    app["linked"].page = lr.page
    app["linked"].on_disconnect.append(lr.closed)
    app["linked_reads"] = lr
    return lr
