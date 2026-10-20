"""THE LIGHTS PAGE'S "TONIGHT" LIST on Mantel's screens (hk-headers.js subscribes ``hk_frontend/page_headers/subscribe``).

The list says what the house's lighting automations will do next ("6:40 PM  Front Yard lights on · sunset"). It is
worked out from each automation's own configuration and Home Assistant's condition helpers, so inside Home Assistant:
HK Frontend did it, and since it can be removed (docs/phase9/NO-HK-FRONTEND.md) Mantel Link does
(``mantel/page_headers/get``, its page_headers.py, admin only, read only). Mantel never served it before, so its pages
showed no Tonight list at all.

Here: one copy of the schedule, read by Mantel itself (a server-only read) when a screen first subscribes, again every
``REFRESH_S`` while any screen does, and soon after an automation is turned on or off or HA's registries change (a
condition's ``ready`` follows within a refresh). Each subscriber gets it as HK Frontend sent it, ``{lights:
{schedule: [...]}}``, cut down to the lights and switches that person may view (an entry with none left is dropped),
and only when that changes. Without Mantel Link (or an older one) the list is empty, as it always was here.

Nothing is written, nothing is sent to Home Assistant but the read.
"""
from __future__ import annotations

import asyncio
import itertools
import logging
from typing import Any, Callable

from aiohttp import web

log = logging.getLogger("mantel.page_headers")

FEED = "hk_frontend/page_headers/subscribe"
READ = "mantel/page_headers/get"
REFRESH_S = 60.0
SOON_S = 3.0
ROUTE_RULES = {FEED: "signed in; Mantel Link's mantel/page_headers/get (a server-only read) cut down to the lights "
                     "and switches the subject may view (an entry with none left is dropped); carries nothing"}


def _entries(got: Any) -> list[dict[str, Any]]:
    sched = ((got or {}).get("lights") or {}).get("schedule") if isinstance(got, dict) else None
    return [e for e in sched if isinstance(e, dict)] if isinstance(sched, list) else []


class PageHeaders:
    def __init__(self, app: web.Application, hub: Any) -> None:
        self.app, self.hub = app, hub
        self.schedule: list[dict[str, Any]] = []
        self.read_ok = False
        self._subs: dict[int, tuple[Any, Callable[[dict], None], list]] = {}
        self._ids = itertools.count(1)
        self._task: asyncio.Task | None = None
        self._soon: asyncio.TimerHandle | None = None

    # -- the one copy ---------------------------------------------------------------------------------------------
    async def refresh(self) -> None:
        read = getattr(getattr(self.hub, "readproxy", None), "read_server", None)
        if read is None:
            return
        try:
            got = await read({"type": READ})
        except Exception as exc:  # noqa: BLE001 -- no Mantel Link (or an older one), HA away: keep what we had
            if self.read_ok:
                log.info("the lighting schedule could not be read again (%s); keeping the last one", type(exc).__name__)
            self.read_ok = False
            return
        self.read_ok = True
        new = _entries(got)
        if new != self.schedule:
            self.schedule = new
        await self.push()

    async def push(self) -> None:
        for sid in list(self._subs):
            await self._send(sid)

    async def _send(self, sid: int) -> None:
        sub = self._subs.get(sid)
        if sub is None:
            return
        identity, on_event, last = sub
        payload = {"lights": {"schedule": await self.visible(identity)}}
        if last and last[0] == payload:
            return
        last[:] = [payload]
        try:
            on_event(payload)
        except Exception:  # noqa: BLE001 -- one bad listener never stops the others
            log.exception("a page headers listener failed")

    async def visible(self, identity: Any) -> list[dict[str, Any]]:
        """The schedule with only the lights and switches this subject may view."""
        from .connectors import allowed_ids
        reads = self.app.get("filtered_reads")
        names = sorted({x for e in self.schedule for x in e.get("entities") or [] if isinstance(x, str)})
        seen = set(await allowed_ids(reads.hooks, identity, "view", names)) if reads is not None and names else set()
        out = []
        for e in self.schedule:
            ents = [x for x in e.get("entities") or [] if x in seen]
            if ents:
                out.append({**e, "entities": ents})
        return out

    # -- when to read again ---------------------------------------------------------------------------------------
    def soon(self) -> None:
        """An automation switched, the registries changed: read again shortly (once for a burst)."""
        if not self._subs:
            return
        loop = asyncio.get_running_loop()
        if self._soon is not None:
            self._soon.cancel()
        self._soon = loop.call_later(SOON_S, lambda: loop.create_task(self.refresh()))

    async def _ticker(self) -> None:
        while self._subs:
            await asyncio.sleep(REFRESH_S)
            try:
                await self.refresh()
            except Exception:  # noqa: BLE001 -- the next tick tries again
                log.exception("the lighting schedule refresh failed")
        self._task = None

    # -- the screens ------------------------------------------------------------------------------------------------
    async def subscribe(self, identity: Any, on_event: Callable[[dict], None]) -> Callable[[], None]:
        sid = next(self._ids)
        first = not self._subs
        self._subs[sid] = (identity, on_event, [])
        if first or not self.read_ok:
            await self.refresh()
        await self._send(sid)                    # now, as HK Frontend's subscription answered (empty without one)
        if self._task is None:
            self._task = asyncio.get_running_loop().create_task(self._ticker())

        def end() -> None:
            self._subs.pop(sid, None)
            if not self._subs:
                if self._task is not None:
                    self._task.cancel()
                    self._task = None
                if self._soon is not None:
                    self._soon.cancel()
                    self._soon = None
        return end


def register(app: web.Application, hub: Any) -> PageHeaders:
    """The route, and the hub's changes that make it read again. After readproxy.register."""
    if "page_headers" in app:
        return app["page_headers"]
    from .connectors import Ctx, Forbidden, Route, read_routes
    ph = app["page_headers"] = PageHeaders(app, hub)

    async def feed(ctx: Ctx, msg: dict, on_event: Callable[[dict], None]):
        from .readproxy import ReadBlocked
        if set(msg) - {"type", "id"}:
            raise ReadBlocked(f"{FEED} carries nothing")
        ident = ctx.identity
        if getattr(ident, "user", None) is None and getattr(ident, "device", None) is None:
            raise Forbidden("sign in to see the lighting schedule")
        end = await ph.subscribe(ident, on_event)

        async def unsubscribe() -> None:
            end()
        return unsubscribe
    read_routes(app)[FEED] = Route(subscribe=feed)

    ha = getattr(hub, "ha", None)
    if ha is not None:
        first_change, first_registry = ha.on_change, ha.on_registry

        def on_change(changed: set[str]) -> None:
            first_change(changed)
            if any(isinstance(e, str) and e.startswith("automation.") for e in changed):
                ph.soon()

        def on_registry() -> None:
            if first_registry is not None:
                first_registry()
            ph.soon()
        ha.on_change, ha.on_registry = on_change, on_registry

    async def stop(_app: web.Application) -> None:
        for end in [lambda sid=sid: ph._subs.pop(sid, None) for sid in list(ph._subs)]:
            end()
        if ph._task is not None:
            ph._task.cancel()
        if ph._soon is not None:
            ph._soon.cancel()
    app.on_cleanup.append(stop)
    return ph
