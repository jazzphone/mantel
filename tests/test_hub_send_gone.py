"""Phase 25 E1: a page that goes away mid-send is logged once, at debug level, with no traceback, and aiohttp's
send task never ends up as "Task exception was never retrieved"."""
from __future__ import annotations

import asyncio
import gc
import logging

from aiohttp.client_exceptions import ClientConnectionResetError

from mantel_server.server import ClientSession
from mantel_server.stats import Counter


class GoneSocket:
    """A socket whose transport closed: every send fails, after a short wait when `slow` (aiohttp's big compressed
    frames are sent by a task of their own behind a shield)."""

    def __init__(self, slow: float = 0.0) -> None:
        self.slow = slow
        self.calls = 0

    async def send_str(self, data: str) -> None:
        self.calls += 1
        if self.slow:
            await asyncio.sleep(self.slow)
        raise ClientConnectionResetError("Cannot write to closing transport")


def bare_session(ws) -> ClientSession:
    s = ClientSession.__new__(ClientSession)
    s.ws, s.tx, s.gone, s.who = ws, Counter(), False, "Loft"
    return s


def run(coro_fn):
    loop = asyncio.new_event_loop()
    unretrieved: list[dict] = []
    loop.set_exception_handler(lambda _loop, ctx: unretrieved.append(ctx))
    try:
        loop.run_until_complete(coro_fn())
        gc.collect()
        loop.run_until_complete(asyncio.sleep(0))
    finally:
        loop.close()
    gc.collect()
    return unretrieved


def test_a_send_to_a_page_that_went_away_is_one_debug_line(caplog):
    ws = GoneSocket()
    s = bare_session(ws)

    async def go():
        for _ in range(3):
            await s.send({"type": "pong"}, count=False)   # no exception reaches the handler

    with caplog.at_level(logging.DEBUG, logger="mantel"):
        assert run(go) == []
    assert s.gone and ws.calls == 1                       # the later sends are dropped, never tried
    lines = [r for r in caplog.records if "went away" in r.getMessage()]
    assert len(lines) == 1 and lines[0].levelno == logging.DEBUG and lines[0].exc_info is None
    assert "Loft" in lines[0].getMessage()


def test_a_cancelled_send_still_has_its_failure_read(caplog):
    ws = GoneSocket(slow=0.05)
    s = bare_session(ws)

    async def go():
        t = asyncio.ensure_future(s.send({"type": "snapshot"}))
        await asyncio.sleep(0.01)
        t.cancel()                                          # run() ending cancels the pump mid-send
        try:
            await t
        except asyncio.CancelledError:
            pass
        await asyncio.sleep(0.1)                            # the send task ends after its caller

    with caplog.at_level(logging.DEBUG, logger="mantel"):
        unretrieved = run(go)
    assert unretrieved == [], unretrieved
    assert s.gone
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING]
