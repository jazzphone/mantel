"""ReadProxy: live HA reads for a page (forecasts, notifications, history ...), through a second HA
connection with its OWN explicit allowlist. HaClient's allowlist is not touched.

Only messages in READ_ALLOWED, with only the listed keys, are sent. Anything else is refused before
it reaches HA. Nothing here can change anything in HA; tests/test_readproxy.py pins the list.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Callable

import aiohttp

log = logging.getLogger("mantel.readproxy")

# message type -> the keys it may carry besides id/type. Reads and read-only subscriptions only.
READ_ALLOWED: dict[str, frozenset[str]] = {
    "get_config": frozenset(),
    "frontend/get_themes": frozenset(),
    "weather/subscribe_forecast": frozenset({"entity_id", "forecast_type"}),
    "persistent_notification/subscribe": frozenset(),
    "history/history_during_period": frozenset({"start_time", "end_time", "entity_ids", "minimal_response",
                                                "no_attributes", "significant_changes_only"}),
    "logbook/get_events": frozenset({"start_time", "end_time", "entity_ids"}),
    "recorder/statistics_during_period": frozenset({"start_time", "end_time", "statistic_ids", "period", "types"}),
    "energy/get_prefs": frozenset(),
    "energy/info": frozenset(),
}
# housekeeping the proxy itself sends to end a subscription it started
INTERNAL = {"unsubscribe_events"}


class ReadBlocked(Exception):
    pass


def check_read(message: dict) -> None:
    kind = message.get("type")
    allowed = READ_ALLOWED.get(kind)
    if allowed is None:
        raise ReadBlocked(f"{kind!r} is not an allowed read")
    extra = set(message) - {"id", "type"} - allowed
    if extra:
        raise ReadBlocked(f"{kind!r} may not carry {sorted(extra)}")


class ReadProxy:
    def __init__(self, ha_url: str, token: str) -> None:
        self.ws_url = ha_url.rstrip("/").replace("http", "ws", 1) + "/api/websocket"
        self._token = token
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._http: aiohttp.ClientSession | None = None
        self._reader: asyncio.Task | None = None
        self._lock = asyncio.Lock()
        self._next = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._subs: dict[int, Callable[[dict], None]] = {}
        self.rx_bytes = 0
        self.sent_types: list[str] = []

    async def _connect(self) -> None:
        async with self._lock:
            if self._ws is not None and not self._ws.closed:
                return
            self._http = self._http or aiohttp.ClientSession()
            ws = await self._http.ws_connect(self.ws_url, max_msg_size=0, heartbeat=30)
            await ws.receive_json()
            await ws.send_json({"type": "auth", "access_token": self._token})
            if (await ws.receive_json()).get("type") != "auth_ok":
                raise RuntimeError("Home Assistant rejected the token")
            self._ws = ws
            self._reader = asyncio.create_task(self._read(ws))

    async def _read(self, ws: aiohttp.ClientWebSocketResponse) -> None:
        try:
            async for m in ws:
                if m.type != aiohttp.WSMsgType.TEXT:
                    break
                self.rx_bytes += len(m.data)
                data = json.loads(m.data)
                mid = data.get("id")
                if data.get("type") == "result" and mid in self._pending:
                    fut = self._pending.pop(mid)
                    if not fut.done():
                        if data.get("success"):
                            fut.set_result(data.get("result"))
                        else:
                            fut.set_exception(RuntimeError((data.get("error") or {}).get("code", "error")))
                elif data.get("type") == "event" and mid in self._subs:
                    self._subs[mid](data["event"])
        finally:
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(ConnectionError("Home Assistant connection closed"))
            self._pending.clear()
            self._subs.clear()

    async def _send(self, msg: dict) -> int:
        await self._connect()
        self._next += 1
        mid = self._next
        self.sent_types.append(msg["type"])
        await self._ws.send_str(json.dumps({**msg, "id": mid}))
        return mid

    async def request(self, msg: dict):
        check_read(msg)
        mid = await self._send(msg)
        fut = asyncio.get_running_loop().create_future()
        self._pending[mid] = fut
        return await asyncio.wait_for(fut, 30)

    async def subscribe(self, msg: dict, on_event: Callable[[dict], None]) -> int:
        check_read(msg)
        await self._connect()
        mid = self._next + 1                       # reserve the id before the events can arrive
        self._subs[mid] = on_event
        try:
            got = await self._send(msg)
            assert got == mid
            fut = asyncio.get_running_loop().create_future()
            self._pending[mid] = fut
            await asyncio.wait_for(fut, 30)
        except BaseException:
            self._subs.pop(mid, None)
            raise
        return mid

    async def unsubscribe(self, mid: int) -> None:
        if self._subs.pop(mid, None) is None:
            return
        try:
            await self._send({"type": "unsubscribe_events", "subscription": mid})
        except Exception:
            pass

    async def close(self) -> None:
        if self._ws is not None:
            await self._ws.close()
        if self._http is not None:
            await self._http.close()
