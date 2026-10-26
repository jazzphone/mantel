"""Live TV's fetching: ``http_fetch`` (a configured URL, size-limited) and ``LiveTv``, the tuner's lineup and the
XMLTV guide kept fresh. (``live_tv.py`` in the parent package serves the page from go2rtc.)"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, TYPE_CHECKING

from aiohttp import web
from hk_core import live_tv_guide as TV

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
                data = json.loads(await fetch(url))
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
