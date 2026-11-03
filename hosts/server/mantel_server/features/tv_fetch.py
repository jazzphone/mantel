"""Live TV's fetching: ``http_fetch`` (a configured URL, size-limited) and ``LiveTv``, the tuner's lineup and the
XMLTV guide kept fresh. (``live_tv.py`` in the parent package serves the page from go2rtc.)"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, TYPE_CHECKING

from aiohttp import web
from hk_core import live_tv_guide as TV
from hk_core import needs as N

from .settings import MAX_FETCH

if TYPE_CHECKING:
    from .host import FeatureHost

log = logging.getLogger("mantel.features")

# ------------------------------------------------------------------------------------ live TV
async def http_fetch(app: web.Application, url: str, timeout: float = 60.0) -> bytes:
    """GET a configured URL (the tuner's lineup, the XMLTV guide), at most MAX_FETCH bytes."""
    import aiohttp
    session = app.get("http")
    own = session is None
    session = session or aiohttp.ClientSession()
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as r:
            r.raise_for_status()
            data = bytearray()
            async for chunk in r.content.iter_chunked(262144):
                data += chunk
                if len(data) > MAX_FETCH:
                    raise ValueError("file too large")
            return bytes(data)
    finally:
        if own:
            await session.close()


LINEUP_MAX = 2_000_000                   # a tuner's lineup.json is a few kilobytes


async def lan_get(app: web.Application, host: str, path: str = "/lineup.json", *, timeout: float = 8.0,
                  cap: int = LINEUP_MAX, check: Any = N.home_ip) -> bytes:
    """GET ``http://<host><path>`` on the home network only (features on by default, docs/phase16): ``host`` is one
    ``hk_core.needs.lan_host`` passed; a name is resolved here and EVERY address it has must be a home address
    (``check``), and the request goes to that address (the name as its Host), so the address checked is the one
    connected to. No redirects; at most ``cap`` bytes. ValueError for anything refused."""
    import socket
    import aiohttp
    name, port = host, 80
    if host.startswith("["):
        name, _, rest = host[1:].partition("]")
        port = int(rest[1:]) if rest.startswith(":") else 80
    elif host.count(":") == 1:
        name, p = host.split(":")
        port = int(p)
    infos = await asyncio.get_running_loop().getaddrinfo(name, port, type=socket.SOCK_STREAM)
    # the request goes to an address that passed, never to the name: an mDNS name's link-local address beside its
    # home one, say, is passed over, and nothing it resolves to later is connected to
    addrs = [a for a in dict.fromkeys(str(i[4][0]) for i in infos) if check(a)]
    if not addrs:
        raise ValueError(f"{host} isn't an address on the home network")
    ip = addrs[0]
    target = f"[{ip}]" if ":" in ip else ip
    session = app.get("http")
    own = session is None
    session = session or aiohttp.ClientSession()
    try:
        async with session.get(f"http://{target}:{port}{path}", headers={"Host": host}, allow_redirects=False,
                               timeout=aiohttp.ClientTimeout(total=timeout)) as r:
            if r.status != 200:
                raise ValueError(f"HTTP {r.status}")
            data = bytearray()
            async for chunk in r.content.iter_chunked(65536):
                data += chunk
                if len(data) > cap:
                    raise ValueError("too large")
            return bytes(data)
    finally:
        if own:
            await session.close()


class LiveTv:
    """The Live TV guide on Mantel: the tuner's lineup and the XMLTV guide, refreshed every 30 min."""

    def __init__(self, host: "FeatureHost") -> None:
        self.host = host
        self.lineup: list[dict[str, Any]] = []
        self.guide: dict[str, Any] = {}
        self.fetched_at: str | None = None
        self.error: str | None = None

    async def refresh(self) -> None:
        cfg = self.host.settings["live_tv"]
        fetch = self.host.fetch
        try:
            if cfg["tuner"]:
                url = cfg["tuner"] if cfg["tuner"].startswith(("http://", "https://")) else f"http://{cfg['tuner']}/lineup.json"
                # a tuner Mantel saved itself (features/auto.py turned Live TV on): its address checked, no redirects.
                # One a person typed is read as they typed it.
                mark = ((self.host.settings.get("auto") or {}).get("decided") or {}).get("live_tv") or {}
                home = N.lan_host(cfg["tuner"]) if url.startswith("http://") and mark.get("by") == "auto" else None
                raw = await lan_get(self.host.app, home, timeout=20.0) \
                    if home and self.host.hooks.fetch is None else await fetch(url)
                data = json.loads(raw)
                self.lineup = [{"number": c.get("GuideNumber"), "name": c.get("GuideName") or "", "hd": bool(c.get("HD")),
                                "url": c.get("URL") if isinstance(c.get("URL"), str) else None}
                               for c in data if isinstance(c, dict) and c.get("GuideNumber")]
            numbers = set(cfg["channels"]) or {c["number"] for c in self.lineup} or None
            if cfg["guide_url"]:
                raw = await fetch(cfg["guide_url"])
                self.guide = await asyncio.to_thread(TV.parse_xmltv, raw, numbers, self.host.now())
            self.fetched_at, self.error = self.host.now().isoformat(), None
        except Exception as exc:  # noqa: BLE001 -- a guide that cannot be read is reported, not fatal
            self.error = f"{type(exc).__name__}: {exc}"[:300]
            log.warning("Live TV guide not refreshed: %s", self.error)

    def channels(self) -> dict[str, Any]:
        cfg = self.host.settings["live_tv"]
        now = self.host.now()
        names = {**{c["number"]: c["name"] for c in self.lineup}, **cfg["names"]}   # a name of the house's own wins
        numbers = list(cfg["channels"]) or [c["number"] for c in self.lineup] or sorted(self.guide)
        out = []
        for n in numbers:
            g = self.guide.get(n) or {}
            cur, nxt = TV.now_next(g.get("programmes") or [], now)
            out.append({"number": n, "name": names.get(n, ""), "logo": g.get("logo"), "network": g.get("network"),
                        "now": cur, "next": nxt})
        return {"configured": bool(cfg["tuner"] or cfg["guide_url"]), "channels": out,
                "fetched_at": self.fetched_at, "error": self.error}
