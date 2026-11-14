"""AirPlay Groups on Mantel's Connections screen: ma-airplay-groups' status page, looked at once a minute.

hk_core.music.airplay_groups has the rules; this module runs them. The connection (connections.py, kind
``airplay_groups``) is an address only: the page takes no token, and Mantel only ever reads ``/status.json`` (never
the page's AirPlay password box). The last good read is what Settings → Connections shows; a page unreachable for ten
minutes, or a speaker locked out, is an alert (alerts/sources.py).
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable

import aiohttp
from aiohttp import web

from hk_core.music import airplay_groups as AG

log = logging.getLogger("mantel.airplay_groups")
KIND = "airplay_groups"
TIMEOUT = 10.0              # seconds for one look at the page

Fetch = Callable[[str], Awaitable[Any]]


class LookFailed(Exception):
    """One look at the page failed; ``str()`` is plain words for Settings, never the page's own text."""


class AirPlayGroups:
    def __init__(self, app: web.Application, clock: Callable[[], float], fetch: Fetch | None = None) -> None:
        self.app = app
        self.clock = clock
        self.fetch = fetch or self._fetch
        self.summary: dict[str, Any] | None = None
        self.last_ok: float | None = None
        self.down_since: float | None = None
        self.error: str | None = None
        self.looked = False
        self.kick = asyncio.Event()
        self.task: asyncio.Task | None = None

    def url(self) -> str | None:
        conns = self.app.get("connections")
        cur = conns.current(KIND) if conns is not None else None
        return cur.url if cur is not None else None

    async def _fetch(self, url: str) -> Any:
        http = self.app.get("http")
        if http is None:
            raise LookFailed("Mantel is still starting")
        try:
            async with http.get(url + AG.STATUS_PATH, allow_redirects=False, timeout=aiohttp.ClientTimeout(total=TIMEOUT)) as r:
                if r.status != 200:
                    raise LookFailed(f"the status page answered HTTP {r.status}")
                return await r.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError, OSError, ValueError) as exc:
            raise LookFailed("the status page didn't answer" if isinstance(exc, (asyncio.TimeoutError, aiohttp.ClientConnectorError, OSError))
                             else f"the status page couldn't be read ({type(exc).__name__})") from None

    def reset(self) -> None:
        self.summary, self.last_ok, self.down_since, self.error, self.looked = None, None, None, None, False

    async def look(self) -> None:
        url = self.url()
        if url is None:
            self.reset()
            return
        try:
            got = AG.read(await self.fetch(url))
            if got is None:
                raise LookFailed("that address answered, but not as AirPlay Groups' status page does")
        except LookFailed as exc:
            if self.down_since is None:
                log.warning("airplay groups: %s", exc)
            self.error, self.down_since = str(exc), self.down_since or self.clock()
        else:
            if self.down_since is not None:
                log.info("airplay groups: the status page answers again")
            self.summary, self.last_ok, self.down_since, self.error = got, self.clock(), None, None
        self.looked = True

    # -- what Settings and the alerts see ------------------------------------------------------------------------------
    def state(self) -> str:
        if self.url() is None:
            return "off"
        if not self.looked:
            return "starting"
        return "ok" if self.down_since is None else "unavailable"

    def status(self) -> dict[str, Any]:
        state = self.state()
        return {"connected": state == "ok", "state": state, "error": self.error, "last_ok": self.last_ok,
                "version": (self.summary or {}).get("version") if state == "ok" else None,
                "summary": self.summary if state == "ok" else None}

    def alert_due(self) -> bool:
        return self.state() == "unavailable" and AG.alert_due(self.down_since, self.clock())

    def locked_out(self) -> str:
        return AG.locked_out(self.summary) if self.state() == "ok" else ""

    # -- running -------------------------------------------------------------------------------------------------------
    async def run(self) -> None:
        while True:
            try:
                await self.look()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 -- the next look
                log.exception("airplay groups: a look failed")
            self.kick.clear()
            try:
                await asyncio.wait_for(self.kick.wait(), AG.POLL_EVERY)
            except asyncio.TimeoutError:
                pass

    async def close(self) -> None:
        if self.task is not None:
            self.task.cancel()


def register(app: web.Application) -> AirPlayGroups:
    """``app["airplay_groups"]``, looking once the server starts, and again at once when the connection changes."""
    host = AirPlayGroups(app, lambda: app["clock"]())
    app["airplay_groups"] = host
    conns = app.get("connections")
    if conns is not None:
        async def applied(kind: str, _cur: Any) -> None:
            if kind == KIND:
                host.reset()
                host.kick.set()
        conns.appliers.append(applied)

    async def start(_app: web.Application) -> None:
        host.task = asyncio.ensure_future(host.run())

    async def stop(_app: web.Application) -> None:
        await host.close()
    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return host
