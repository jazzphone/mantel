"""Privacy in logs (docs/phase19/HOUSE-TIMELINE.md "Privacy in logs"): a full session of the House Timeline with
fictional names (rows whose actors are Emma and Mark, "Emma arrived home", a Refused row, a picture, every route of the
matrix, a search by a name, a picture fetched, a person removed, the live feed, the pruner, the writer) under DEBUG
logging, and no log record names a person, a title, a search word or a picture."""
from __future__ import annotations

import asyncio
import logging

import pytest

from timeline_world import House
from mantel_server.timeline.store import Row

NAMES = ("Emma", "Mark", "Avery", "Hallway tablet")
TITLES = ("Back Door unlocked", "Back Door opened", "Garage opened", "Alarm disarmed", "Emma arrived home",
          "Visitor arrived home", "Person at Driveway Cam", "Someone rang Hall Cam", "Person at Hall Cam",
          "Backup finished", "tried to disarm", "Kim arrived home")
WORDS = ("arrived", "unlocked", "disarm", "backup finished", "driveway cam", "hallway")


@pytest.fixture
async def w(mantel, caplog):
    caplog.set_level(logging.DEBUG)          # before the first connection: the web server decides at its start
    h = House(mantel)
    h.load()
    await h.people()
    await h.enroll_tablet()
    h.seed()
    h.grant_child_the_page("cody")
    for n in ("avery", "boss", "mark", "emma", "cody", "pip", "gwen"):
        await h.sign_in(n)
    h.tunnel_session("mark", "tunnel_mark")
    h.use("tablet")
    await h.sign_in("mark", as_name="mark_at_tablet", keep=True)
    return h


def swept(caplog, w):
    """Every record's message (and what it was formatted from), checked against everything private."""
    private = list(NAMES) + list(TITLES) + list(WORDS) + list(w.pics.values())
    private += [f"/api/timeline/pic/{p}" for p in w.pics.values()]
    bad = []
    for r in caplog.records:
        for text in (r.getMessage(), str(r.msg), "" if r.exc_text is None else r.exc_text, *map(str, r.args or ())):
            low = text.lower()
            for p in private:
                if p.lower() in low:
                    bad.append((r.name, r.levelname, p, text[:160]))
    return bad


async def session(w):
    # every read of the matrix, as every kind of viewer
    for who in ("avery", "boss", "mark", "emma", "cody", "pip", "gwen", "tablet", "tunnel_mark", "mark_at_tablet"):
        await w.find(who)
        await w.find(who, "family=lock&limit=2")
        await w.find(who, "q=garage")
        await w.find(who, "q=emma")                                   # a name asked for
        await w.get(who, "/api/timeline/summary?window=24h")
        await w.get(who, "/api/timeline/me")
        for pid in w.pics.values():
            await w.get(who, f"/api/timeline/pic/{pid}")
    await w.find("avery", "actor=" + w.uid["emma"])
    await w.find("tablet", "actor=" + w.uid["emma"])
    await w.find("avery", "mine=1")
    await w.get("avery", "/api/timeline/settings")
    # the writes, refused and allowed
    await w.call("boss", "PUT", "/api/timeline/settings", {"retention_days": 7})
    await w.call("avery", "PUT", "/api/timeline/settings", {"retention_days": 90, "pictures": {"frames": 3}})
    await w.call("avery", "PUT", "/api/timeline/overrides", {"overrides": {"binary_sensor.loft": {"record": True,
                                                                                                   "label": "Emma's Hatch"}}})
    await w.call("mark", "PUT", "/api/timeline/me", {"private": True})
    await w.call("emma", "DELETE", "/api/timeline/mine/presence")
    # a person removed (the trigger), a row with their name still queued, the pruner, the writer, a failed audit
    kim = await w.m.user("kim", "adult")
    w.tl.push(Row(src="late:kim", at=w.now[0], family="arrival", kind="arrived", entity="person.emma",
                  title="Kim arrived home", search="arrived home", person=kim, actor=kim, actor_name="Kim"))
    w.tl.flush()
    with w.db:
        w.db.execute("DELETE FROM users WHERE id = ?", (kim,))
    w.tl.prune()
    w.tl.forget_gone()
    w.app["audit"].config_event = lambda row: (_ for _ in ()).throw(RuntimeError("disk full"))
    await w.call("avery", "PUT", "/api/timeline/settings", {"retention_days": 30})


async def test_a_full_session_names_no_one_and_quotes_nothing(w, caplog):
    caplog.set_level(logging.DEBUG)
    await session(w)
    assert caplog.records                                              # the sweep looked at something
    access = [r.getMessage() for r in caplog.records if r.name == "aiohttp.access" and "/api/timeline" in r.getMessage()]
    assert len(access) >= 50                                           # ... the web server's own lines among them,
    assert not [a for a in access if "?q=" in a or "/pic/" in a and "/pic/-" not in a]      # without a URL's secrets
    assert any("GET /api/timeline?-" in a for a in access)             # (the request itself is still there)
    assert swept(caplog, w) == []


async def test_the_live_feed_and_the_writer_log_counts_only(w, caplog):
    caplog.set_level(logging.DEBUG)
    w.use("avery")
    ws = await w.m.client.ws_connect("/ws")
    await ws.send_json({"type": "read_subscribe", "id": 1, "msg": {"type": "timeline/subscribe"}})
    await asyncio.wait_for(ws.receive_json(), 3)
    for i in range(3):
        w.tl.push(Row(src=f"live:{i}", at=w.now[0], family="lock", kind="unlocked", entity="lock.back_door",
                      area="hall", title="Back Door unlocked", search="back door unlocked hallway", actor=w.uid["emma"],
                      actor_name="Emma", device_name="Hallway tablet", how="tablet", audit_id=3))
    w.tl.flush()
    w.tl.refresh()
    await ws.close()
    # a failing listener is logged without what it was sent
    w.tl.listeners.append(lambda rows: 1 / 0)
    w.tl.push(Row(src="live:boom", at=w.now[0], family="lock", kind="locked", entity="lock.back_door",
                  title="Back Door locked", search="back door locked", actor_name="Emma"))
    w.tl.flush()
    assert any("listener failed" in r.getMessage() for r in caplog.records)
    assert swept(caplog, w) == []


async def test_a_full_queue_says_how_many_rows_and_nothing_else(w, caplog, monkeypatch):
    from mantel_server.timeline import core as T
    caplog.set_level(logging.DEBUG)
    monkeypatch.setattr(T, "QUEUE_MAX", 2)
    for i in range(6):
        w.tl.push(Row(src=f"q:{i}", at=w.now[0], family="lock", kind="locked", entity="lock.back_door",
                      title="Back Door locked", search="back door locked", actor_name="Emma"))
    assert w.tl.dropped == 4
    for msg in [r.getMessage() for r in caplog.records if r.name.startswith("mantel.timeline")]:
        assert "Emma" not in msg and "Back Door" not in msg


async def test_a_failing_write_is_logged_without_the_rows(w, caplog, monkeypatch):
    caplog.set_level(logging.DEBUG)

    def broken(ops):
        raise RuntimeError("disk full")
    monkeypatch.setattr(w.tl.rows, "write", broken)
    w.tl.push(Row(src="x:1", at=w.now[0], family="arrival", kind="arrived", entity="person.emma",
                  title="Emma arrived home", search="arrived home", actor_name="Emma"))
    assert w.tl.flush() == []
    mine = [r for r in caplog.records if r.name.startswith("mantel.timeline")]
    assert mine and "1 rows" in mine[0].getMessage()
    assert swept(caplog, w) == []


async def test_a_picture_that_cant_be_read_or_kept_is_logged_without_the_camera_or_the_picture(w, caplog):
    from mantel_server.timeline.pictures import Pictures

    async def bad_fetch(camera):
        raise ConnectionError(f"fictional: {camera} at 192.0.2.7 refused")

    async def bad_shrink(raw):
        raise ValueError("not a picture")
    caplog.set_level(logging.DEBUG)
    pics = Pictures(w.app, w.tl, fetch=bad_fetch)
    assert await pics.take("camera.hall") is None
    pics = Pictures(w.app, w.tl, fetch=lambda c: asyncio.sleep(0, b"raw"), shrink=bad_shrink)
    assert await pics.take("camera.hall") is None
    text = " ".join(r.getMessage() for r in caplog.records if r.name.startswith("mantel.timeline"))
    assert "192.0.2.7" not in text and "refused" not in text and "ConnectionError" in text


async def test_the_privacy_sweep_would_notice_a_leak(w, caplog):
    """The sweep itself: a record naming a person, quoting a title or carrying a picture is found."""
    caplog.set_level(logging.DEBUG)
    log = logging.getLogger("mantel.timeline")
    log.info("emma unlocked something")
    log.info("fetched %s", w.pics["hall"])
    log.warning("Back Door unlocked for %s", "somebody")
    found = {b[2] for b in swept(caplog, w)}
    assert {"Emma", "Back Door unlocked", w.pics["hall"], "unlocked"} <= found


def test_the_access_log_filter_hides_a_search_and_a_picture_id_and_nothing_else():
    from mantel_server.timeline.api import QuietAccess

    def line(text):
        rec = logging.LogRecord("aiohttp.access", logging.INFO, "x", 1, text, (), None)
        assert QuietAccess().filter(rec) is True
        return rec.getMessage()
    pid = "0123456789abcdef0123456789abcdef"
    assert line('1.2.3.4 "GET /api/timeline?q=emma&limit=5 HTTP/1.1" 200 9') == '1.2.3.4 "GET /api/timeline?- HTTP/1.1" 200 9'
    assert line(f'1.2.3.4 "GET /api/timeline/pic/{pid}?v=3 HTTP/1.1" 200 9') == \
        '1.2.3.4 "GET /api/timeline/pic/-?- HTTP/1.1" 200 9'
    assert line('"GET /api/timeline/summary?window=24h HTTP/1.1"') == '"GET /api/timeline/summary?- HTTP/1.1"'
    assert line('"DELETE /api/timeline?confirm=clear HTTP/1.1"') == '"DELETE /api/timeline?- HTTP/1.1"'
    # other routes are not touched
    other = '"GET /api/camera/camera.hall/still?v=abc HTTP/1.1" 200 9'
    assert line(other) == other
    assert line('"GET /api/timeline HTTP/1.1"') == '"GET /api/timeline HTTP/1.1"'
    # one filter on the logger however many apps are built
    from mantel_server.timeline import api
    api.quiet_access_log()
    api.quiet_access_log()
    assert len([f for f in logging.getLogger("aiohttp.access").filters if isinstance(f, QuietAccess)]) == 1
