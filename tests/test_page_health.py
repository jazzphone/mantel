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


async def test_a_tablet_says_how_its_swipes_were_drawn(caplog):
    """SWIPES (2026-11-08): a `motion` frame is one log line a minute at most; one that says nothing usable, none."""
    caplog.set_level(logging.INFO, "mantel.page_health")
    c = ctx("Living Room")
    frame = {"type": "page_health", "event": "motion", "swipes": 3, "frames": 90, "ms": 2100, "late": 30, "worst": 180,
             "p95": 60, "kinds": {"page": 2, "block": 1, "x": 9}, "style": "bright_pre", "screen": "living-room-homeview"}
    await PH.page_health(c, frame)
    await PH.page_health(c, frame)                                                                 # within the minute
    await PH.page_health(ctx("Loft"), {**frame, "late": 91})                                       # more late than drawn
    await PH.page_health(ctx("Kitchen"), {**frame, "style": "<b>", "screen": "a b", "kinds": "page"})
    lines = [r.getMessage() for r in caplog.records]
    assert lines == [
        "page health: tablet 'Living Room' swiped 3 times (2 page, 1 block): 42.9 frames a second while moving, "
        "33% of frames late, 95% within 60 ms, the worst 180 ms; bright_pre on living-room-homeview",
        "page health: tablet 'Kitchen' swiped 3 times (swipes): 42.9 frames a second while moving, "
        "33% of frames late, 95% within 60 ms, the worst 180 ms; no style on a screen"]
