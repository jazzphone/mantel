"""PAGE HEALTH (page_health.py): a screen's page tells Mantel's log how the page before it ended and how big its heap
is, to find the wall tablets' 15-minute reloads. Numbers only, nothing answered, one beat a connection per 50 s."""
import logging
from types import SimpleNamespace

from mantel_server import page_health as PH
from mantel_server.connectors import Ctx


async def _send(msg):
    raise AssertionError("page_health answers nothing")


def ctx(name="Master Bathroom"):
    return Ctx(_send, identity=SimpleNamespace(device=SimpleNamespace(name=name), user=None))


async def test_a_page_that_died_says_so_and_beats_are_spaced(caplog):
    caplog.set_level(logging.INFO, "mantel.page_health")
    c = ctx()
    await PH.page_health(c, {"type": "page_health", "event": "load", "prev": "died", "prev_heap": 612, "prev_up": 15.9,
                             "heap": 40, "limit": 4096})
    await PH.page_health(c, {"type": "page_health", "event": "beat", "up": 1, "heap": 80, "limit": 4096})   # too soon
    await PH.page_health(c, {"type": "page_health", "event": "launch", "heap": "x"})                           # not one
    await PH.page_health(c, {"type": "page_health", "event": "load", "prev": "<script>", "heap": True})
    lines = [r.getMessage() for r in caplog.records]
    assert lines[0] == ("page health: tablet 'Master Bathroom' loaded (the page before it DIED without closing, "
                        "after 15.9 min at 612.0 MB); heap 40.0 MB of 4096.0")
    assert len(lines) == 2 and "unknown" in lines[1] and "None MB" in lines[1]
