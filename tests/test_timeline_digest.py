"""The House Timeline's morning digest (docs/phase19/HOUSE-TIMELINE.md "The morning digest", slice 19.6): the words
(hk_core, pure), the house version through the alert center, the personal version for each person's own view, once a
day, and the restart rule."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

from hk_core.timeline import classify as C
from hk_core.timeline import digest as D
from mantel_server.config import Config
from mantel_server.server import build_app
from mantel_server.storage.store import Store
from mantel_server.timeline import digest as TD
from mantel_server.timeline.api import Viewer
from mantel_server.timeline.store import Row

TZ = ZoneInfo("America/Los_Angeles")
PASSWORD = "correct horse battery staple"


def ep(day: int, h: int, m: int = 0) -> float:
    """An epoch for 2026-11-<day> h:m in the house's time (Pacific standard time from November 1)."""
    return datetime(2026, 11, day, h, m, tzinfo=TZ).timestamp()


def local(t: float) -> datetime:
    return datetime.fromtimestamp(t, TZ)


START, END = ep(3, 21), ep(4, 7)

_n = [0]


def row(family, kind, title, entity, at, **kw):
    _n[0] += 1
    return {"id": _n[0], "family": family, "kind": kind, "title": title, "entity": entity, "at": at,
            "ended": kw.pop("ended", None), "detail": kw.pop("detail", {}), "level": kw.pop("level", "info"), **kw}


LOCKS = {"lock.front_door": ("locked", "Front Door", "lock"), "lock.back_door": ("locked", "Back Door", "lock")}
GARAGE = {"cover.garage": ("closed", "Garage", "garage")}
HOUSE = {**LOCKS, **GARAGE}


def make(rows=(), states=None, **kw):
    kw.setdefault("start_states", {"lock.front_door": "locked", "lock.back_door": "locked"})
    return D.lines(list(rows), start=kw.pop("start", START), end=kw.pop("end", END),
                   now_states=HOUSE if states is None else states, local_time=local, **kw)


# -- the words (hk_core) ----------------------------------------------------------------------------------------------
def test_the_plan_s_whole_example_reads_as_written():
    rows = [
        row("alarm", "armed_away", "Alarm armed away", "alarm_control_panel.house", ep(3, 22, 2)),
        row("system", "raised", "Kitchen tablet is offline", None, ep(4, 1, 10), level="warning",
            detail={"alert": "tablet.offline", "key": "kitchen"}),
        row("system", "cleared", "Kitchen tablet is back", None, ep(4, 1, 25),
            detail={"alert": "tablet.offline", "key": "kitchen", "up": False}),
        row("detection", "person", "Person at Driveway", "camera.driveway", ep(3, 23)),
        row("detection", "person", "Person at Driveway", "camera.driveway", ep(4, 0, 30)),
        row("detection", "vehicle", "Vehicle at Driveway", "camera.driveway", ep(4, 3)),
        row("detection", "person", "Person at Driveway", "camera.driveway", ep(4, 5)),
        row("detection", "package", "Package at Front Door", "camera.front_door", ep(4, 2)),
        row("detection", "package", "Package at Front Door", "camera.front_door", ep(4, 4)),
        row("garage", "opened", "Garage opened", "cover.garage", ep(4, 6, 12)),
        row("garage", "closed", "Garage closed", "cover.garage", ep(4, 6, 20)),
        row("alarm", "disarmed", "Alarm disarmed", "alarm_control_panel.house", ep(4, 6, 30)),
    ]
    got = make(rows, system=True)
    assert got["title"] == "Overnight at the house (9 PM to 7 AM)"
    assert got["lines"] == [
        "Front Door and Back Door locked all night.",
        "Garage opened 6:12 AM, closed 6:20 AM.",
        "2 package deliveries at Front Door.",
        "3 people and 1 vehicle at Driveway.",
        "Alarm armed 10:02 PM, disarmed 6:30 AM.",
        "1 alert: Kitchen tablet offline 1:10 to 1:25 AM.",
        "Right now: all locks locked, garage closed.",
    ]
    assert got["quiet"] is False


def test_locked_all_night_is_true_only_with_a_locked_start_no_unlock_and_locked_now():
    two = make([row("detection", "package", "Package at Porch", "camera.porch", ep(4, 2))])["lines"]
    assert two[0] == "Front Door and Back Door locked all night."
    one = make([row("detection", "package", "Package at Porch", "camera.porch", ep(4, 2))],
               states={"lock.front_door": LOCKS["lock.front_door"]})["lines"]
    assert one[0] == "Front Door locked all night."
    three = make([row("detection", "package", "Package at Porch", "camera.porch", ep(4, 2))],
                 states={**LOCKS, "lock.side": ("locked", "Side Door", "lock")},
                 start_states={"lock.front_door": "locked", "lock.back_door": "locked", "lock.side": "locked"})
    assert three["lines"][0] == "Front Door, Back Door, and Side Door locked all night."
    many = {f"lock.l{i}": ("locked", f"Lock {i}", "lock") for i in range(5)}
    five = make([row("detection", "package", "Package at Porch", "camera.porch", ep(4, 2))], states=many,
                start_states={e: "locked" for e in many})
    assert five["lines"][0] == "All 5 locks locked all night."


def test_an_unlock_in_the_window_is_named_and_the_lock_is_not_locked_all_night():
    rows = [row("lock", "unlocked", "Back Door unlocked", "lock.back_door", ep(4, 2, 4)),
            row("lock", "locked", "Back Door locked", "lock.back_door", ep(4, 2, 10))]
    got = make(rows)["lines"]
    assert got[0] == "Front Door locked all night."
    assert "Back Door unlocked 2:04 AM, locked 2:10 AM." in got
    assert not any(line.startswith("Back Door locked all night") for line in got)


def test_a_lock_that_was_unlocked_at_the_start_or_never_known_is_not_claimed():
    pkg = [row("detection", "package", "Package at Porch", "camera.porch", ep(4, 2))]
    start_unlocked = make(pkg, start_states={"lock.front_door": "unlocked", "lock.back_door": "locked"})["lines"]
    assert start_unlocked[0] == "Back Door locked all night."
    # no row ever recorded before the window and none in it: it was as it is now
    unknown = make(pkg, start_states={"lock.front_door": None, "lock.back_door": None})["lines"]
    assert unknown[0] == "Front Door and Back Door locked all night."
    # a row in the window and no earlier one: the start can't be known, so nothing is claimed
    rows = [row("lock", "locked", "Back Door locked", "lock.back_door", ep(3, 22))] + pkg
    unsure = make(rows, start_states={"lock.front_door": "locked", "lock.back_door": None})["lines"]
    assert unsure[0] == "Front Door locked all night."
    assert "Back Door locked 10:00 PM." in unsure


def test_a_lock_unlocked_at_digest_time_leads_and_so_does_an_open_garage():
    states = {"lock.front_door": ("locked", "Front Door", "lock"), "lock.back_door": ("unlocked", "Back Door", "lock"),
              "cover.garage": ("open", "Garage", "garage")}
    rows = [row("garage", "opened", "Garage opened", "cover.garage", ep(4, 6, 12)),
            row("lock", "unlocked", "Back Door unlocked", "lock.back_door", ep(4, 6, 40))]
    got = make(rows, states=states)
    assert got["lines"][0] == "Garage is still open."
    assert got["lines"][1] == "Back Door is unlocked."
    assert "Garage opened 6:12 AM." in got["lines"]
    assert not any(x.startswith("Right now") for x in got["lines"])      # nothing is "as it should be" to add
    assert got["quiet"] is False
    both = make([], states={"cover.garage": ("open", "Garage", "garage"), "cover.gate": ("open", "Side Gate", "garage")})
    assert both["lines"][0] == "Garage and Side Gate are still open."
    jam = make([], states={"lock.front_door": ("jammed", "Front Door", "lock")})
    assert jam["lines"][0] == "Front Door is jammed."


def test_a_door_left_open_leads_and_closed_doors_are_part_of_right_now():
    states = {**HOUSE, "binary_sensor.patio": ("on", "Patio Door", "door")}
    got = make([row("door", "opened", "Patio Door opened", "binary_sensor.patio", ep(4, 5))], states=states)["lines"]
    assert got[0] == "Patio Door is still open."
    assert "Patio Door opened 5:00 AM." in got
    fine = make([row("door", "opened", "Patio Door opened", "binary_sensor.patio", ep(4, 5)),
                 row("door", "closed", "Patio Door closed", "binary_sensor.patio", ep(4, 5, 2))],
                states={**HOUSE, "binary_sensor.patio": ("off", "Patio Door", "door")})["lines"]
    assert "Patio Door opened 5:00 AM, closed 5:02 AM." in fine
    assert fine[-1] == "Right now: all locks locked, garage closed, Patio Door closed."


def test_a_quiet_night_is_one_line_even_with_locks_locked_all_night():
    got = make([])
    assert got["lines"] == ["A quiet night. Everything is locked and closed."] and got["quiet"] is True
    assert make([], states={})["lines"] == ["A quiet night."]
    unavailable = make([], states={"lock.front_door": ("unavailable", "Front Door", "lock")})
    assert unavailable["lines"] == ["A quiet night."]
    today = D.lines([], start=ep(4, 0), end=ep(4, 15), now_states=HOUSE, local_time=local, label="Today")
    assert today["lines"] == ["A quiet day. Everything is locked and closed."]
    assert today["title"] == "Today at the house (12 AM to 3 PM)"
    day = D.lines([], start=END - 86400, end=END, now_states=HOUSE, local_time=local, label="Last 24 hours")
    assert day["title"] == "Last 24 hours at the house" and day["lines"][0].startswith("A quiet stretch.")


def test_motion_alone_and_a_cleared_alert_alone_do_not_break_a_quiet_night():
    rows = [row("motion", "motion", "Motion at Garden", "camera.garden", ep(4, 3), detail={"count": 5}),
            row("system", "cleared", "Kitchen tablet is back", None, ep(4, 1, 25), detail={"alert": "tablet.offline"})]
    assert make(rows, system=True)["quiet"] is True


def test_package_deliveries_count_each_row_once_and_say_deliveries():
    one = make([row("detection", "package", "Package at Front Door", "camera.front_door", ep(4, 2),
                    detail={"count": 3})])["lines"]
    assert "1 package delivery at Front Door." in one                # three events in 30 minutes are one delivery
    two = make([row("detection", "package", "Package at Front Door", "camera.front_door", ep(4, 2)),
                row("detection", "package", "Package at Side Gate", "camera.side_gate", ep(4, 3)),
                row("detection", "package", "Package at Front Door", "camera.front_door", ep(4, 4))])["lines"]
    assert "3 package deliveries: 2 at Front Door and 1 at Side Gate." in two


def test_people_vehicles_and_animals_are_counted_per_camera():
    rows = [row("detection", "person", "Person at Driveway", "camera.driveway", ep(4, 1)),
            row("detection", "animal", "Animal at Garden", "camera.garden", ep(4, 2)),
            row("detection", "animal", "Animal at Garden", "camera.garden", ep(4, 3)),
            row("detection", "person", "Person at Garden", "camera.garden", ep(4, 3, 30)),
            row("detection", "vehicle", "Vehicle at Garden", "camera.garden", ep(4, 4))]
    got = make(rows)["lines"]
    assert "1 person at Driveway." in got
    assert "1 person, 1 vehicle, and 2 animals at Garden." in got


def test_the_doorbell_is_counted_and_a_leak_is_said():
    rows = [row("doorbell", "ring", "Someone rang Front Door", "camera.front_door", ep(3, 23)),
            row("doorbell", "ring", "Someone rang Front Door", "camera.front_door", ep(4, 0)),
            row("doorbell", "ring", "Someone rang Side Gate", "camera.side_gate", ep(4, 1)),
            row("safety", "leak", "Leak at Kitchen Sink", "binary_sensor.leak", ep(4, 3, 10)),
            row("safety", "clear", "Kitchen Sink is clear", "binary_sensor.leak", ep(4, 3, 40))]
    got = make(rows)["lines"]
    assert "Someone rang Front Door 2 times." in got and "Someone rang Side Gate." in got
    assert "Leak at Kitchen Sink, 3:10 AM." in got and not any("is clear" in line for line in got)


def test_arrivals_are_said_only_to_a_version_that_may_say_who():
    rows = [row("arrival", "left", "Mark left home", "person.mark", ep(3, 21, 30)),
            row("arrival", "arrived", "Mark arrived home", "person.mark", ep(3, 23, 5)),
            row("arrival", "arrived", "Emma arrived home", "person.emma", ep(3, 23, 40))]
    with_names = make(rows, names=True)["lines"]
    assert "Emma arrived home 11:40 PM." in with_names
    assert "Mark left home 9:30 PM and arrived home 11:05 PM." in with_names
    without = make(rows)
    assert without["quiet"] is True and "Emma" not in " ".join(without["lines"])


def test_system_and_refused_rows_only_when_the_version_may_see_them():
    rows = [row("system", "raised", "Backup failed", None, ep(4, 2), level="warning",
                detail={"alert": "backup.failed", "key": ""}),
            row("system", "raised", "Backup finished", None, ep(4, 3), level="info", detail={"alert": "backup.ok"}),
            row("refused", "unlock", "Hallway tablet tried to unlock Back Door; refused", "lock.back_door", ep(4, 3, 2),
                level="warning")]
    seen = make(rows, system=True)["lines"]
    assert "1 alert: Backup failed 2:00 AM." in seen
    assert "1 refused command: Hallway tablet tried to unlock Back Door; refused, 3:02 AM." in seen
    assert not any("finished" in line for line in seen)               # an Info raise isn't an alert
    hidden = make(rows)
    assert hidden["quiet"] is True


def test_alerts_pair_by_their_own_key_and_many_are_counted():
    rows = [row("system", "raised", "Kitchen tablet is offline", None, ep(4, 1, 10), level="warning",
                detail={"alert": "tablet.offline", "key": "kitchen"}),
            row("system", "raised", "Loft tablet is offline", None, ep(4, 1, 12), level="warning",
                detail={"alert": "tablet.offline", "key": "loft"}),
            row("system", "cleared", "Loft tablet is back", None, ep(4, 1, 30),
                detail={"alert": "tablet.offline", "key": "loft"}),
            row("system", "raised", "Backup failed", None, ep(4, 2), level="warning", detail={"alert": "backup.failed"})]
    line = [x for x in make(rows, system=True)["lines"] if "alert" in x][0]
    assert line == "3 alerts: Kitchen tablet offline 1:10 AM; Loft tablet offline 1:12 to 1:30 AM; and 1 more."


def test_times_that_cross_noon_or_midnight_keep_both_markers():
    assert D.span(local(ep(4, 1, 10)), local(ep(4, 1, 25))) == "1:10 to 1:25 AM"
    assert D.span(local(ep(3, 23, 50)), local(ep(4, 0, 5))) == "11:50 PM to 12:05 AM"
    assert D.clock(local(ep(4, 12, 0))) == "12:00 PM" and D.clock(local(ep(4, 0, 9))) == "12:09 AM"
    rows = [row("alarm", "armed_home", "Alarm armed home", "alarm_control_panel.house", ep(3, 22)),
            row("alarm", "armed_night", "Alarm armed night", "alarm_control_panel.house", ep(3, 23)),
            row("alarm", "triggered", "Alarm triggered", "alarm_control_panel.house", ep(4, 3)),
            row("alarm", "disarmed", "Alarm disarmed", "alarm_control_panel.house", ep(4, 3, 5))]
    assert "Alarm armed 10:00 PM, triggered 3:00 AM, disarmed 3:05 AM." in make(rows)["lines"]


def test_the_list_is_at_most_eight_lines_and_says_what_it_left_out():
    rows = []
    for i in range(6):
        rows.append(row("detection", "person", f"Person at Cam {i}", f"camera.c{i}", ep(4, 1, i)))
        rows.append(row("garage", "opened", f"Gate {i} opened", f"cover.g{i}", ep(4, 2, i)))
    got = make(rows)["lines"]
    assert len(got) <= D.MAX_LINES
    assert got[-1] == "Right now: all locks locked, garage closed."
    assert got[-2].startswith("Plus ") and got[-2].endswith(" more on the Timeline.")


def test_many_events_of_one_door_are_cut_with_and_n_more():
    rows = [row("door", "opened" if i % 2 == 0 else "closed", "Pet Door x", "binary_sensor.pet", ep(4, 1, i))
            for i in range(10)]
    line = [x for x in make(rows)["lines"] if x.startswith("Pet Door")][0]
    assert line.endswith(", and 6 more.") and line.count("AM") == 4


def test_rows_outside_the_window_are_ignored():
    rows = [row("garage", "opened", "Garage opened", "cover.garage", ep(3, 20)),
            row("garage", "opened", "Garage opened", "cover.garage", END)]
    assert make(rows)["quiet"] is True


# -- the host: the full app --------------------------------------------------------------------------------------------
class Env:
    def __init__(self, app, client, store, now):
        self.app, self.client, self.store, self.now = app, client, store, now
        self.tl = app["timeline"]
        self.center = app["alerts"].center
        self.sent: list = []
        self.pushed: list = []
        self.push_log: list[str] = []

        async def send(ch, msg):
            self.sent.append((ch["name"], msg))
        self.center.send = send
        self.center.retries = (0.0, 0.0, 0.0)
        self.center.started -= 3600
        self.tl.members = {
            "lock.front_door": C.Member("lock", "Front Door", None, None),
            "lock.back_door": C.Member("lock", "Back Door", None, None),
            "cover.garage": C.Member("garage", "Garage", None, None),
            "person.emma": C.Member("arrival", "Emma", None, None),
        }
        app["hub"].store.replace_all({"a": {
            "lock.front_door": {"s": "locked", "a": {}, "lc": START - 7200},
            "lock.back_door": {"s": "locked", "a": {}, "lc": START - 7200},
            "cover.garage": {"s": "closed", "a": {}, "lc": START - 7200}}})
        app["authz"].set_tz("America/Los_Angeles", "home_assistant")    # as Home Assistant's config tells it
        self.tl.settings.set("since", START - 86400)                     # watching since the night before

    def add_row(self, family, kind, title, entity, at, *, person=None, detail=None, level="info", **kw):
        self.tl.rows.write([("row", Row(src=f"t:{entity}:{kind}:{at}", at=at, family=family, kind=kind, title=title,
                                        entity=entity, person=person, detail=detail or {}, level=level, **kw))])

    def channel(self, name="Discord", **kw):
        kw.setdefault("events", ["house.digest"])
        kw.setdefault("min_level", "info")
        kw.setdefault("quiet", {})
        return self.app["alerts"].channels.add("discord", name, config={}, secret={"url": "x", "main": "x"}, **kw)

    async def run(self, seconds, step=5.0):
        end = self.now[0] + seconds
        while self.now[0] < end:
            self.now[0] = min(end, self.now[0] + step)
            await self.center.tick()
            await asyncio.sleep(0)
            await asyncio.gather(*self.center.tasks, return_exceptions=True)

    async def user(self, name, role):
        from mantel_server.identity.sessions import User
        uid = await self.app["accounts"].create_user(name, name.title(), role, PASSWORD)
        r = self.store.db.execute("SELECT id, username, name, role, kind FROM users WHERE id = ?", (uid,)).fetchone()
        return User(id=r["id"], name=r["name"], role=r["role"], kind=r["kind"], username=r["username"])

    def viewer(self, user, door="lan"):
        from mantel_server.identity.sessions import Identity
        return Viewer(self.app, self.app["authz"].principal_of(Identity(user=user, device=None, door=door)))

    def switch(self, user, key=TD.SUMMARY_KEY, on=True):
        with self.store.db:
            self.store.db.execute("INSERT INTO user_data (subject, key, value, updated) VALUES (?,?,?,?) ON CONFLICT"
                                  "(subject, key) DO UPDATE SET value = excluded.value",
                                  (f"u:{user.id}", key, json.dumps(on), self.now[0]))

    def target(self, user, endpoint):
        pusher = self.app["pusher"]
        pusher.targets.add(user.id, "web", endpoint, "p", "a", name="phone")

        async def send_web(row, msg):
            self.pushed.append((row["user_id"], msg))
            return "ok"
        pusher.senders["web"] = send_web


@pytest.fixture
async def env(tmp_path):
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, ha_url="",
                 token_file=tmp_path / "none", ma_token_file=tmp_path / "none2")
    store = Store(cfg.data_dir / "mantel.db")
    now = [ep(4, 7, 5)]
    app = build_app(cfg, "", store=store, connect_ha=False, clock=lambda: now[0])
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    client = TestClient(TestServer(app))
    await client.start_server()
    e = Env(app, client, store, now)
    yield e
    await client.close()
    store.db.close()


def busy_night(env):
    env.add_row("garage", "opened", "Garage opened", "cover.garage", ep(4, 6, 12))
    env.add_row("garage", "closed", "Garage closed", "cover.garage", ep(4, 6, 20))
    env.add_row("arrival", "arrived", "Emma arrived home", "person.emma", ep(3, 23, 40), person="someone-id")
    env.add_row("system", "raised", "Kitchen tablet is offline", None, ep(4, 1, 10), level="warning",
                detail={"alert": "tablet.offline", "key": "k"})
    env.add_row("refused", "unlock", "Hallway tablet tried to unlock Back Door; refused", "lock.back_door",
                ep(4, 3), level="warning")
    env.add_row("lock", "unlocked", "Back Door unlocked", "lock.back_door", ep(4, 2, 4), actor="u1", actor_name="Emma",
                how="home")
    env.add_row("lock", "locked", "Back Door locked", "lock.back_door", ep(4, 2, 10), actor="u1", actor_name="Emma",
                how="home")


async def test_the_house_version_has_house_facts_only_no_name_no_arrival_no_system_row(env):
    busy_night(env)
    start, end, _ = TD.window_of(env.app, "overnight", env.now[0])
    version = TD.house_version(env.app, start, end, env.now[0])
    text = version["title"] + "\n" + "\n".join(version["lines"])
    assert "Emma" not in text and "arrived" not in text and "alert" not in text and "refused" not in text.lower()
    assert "Garage opened 6:12 AM, closed 6:20 AM." in version["lines"]
    assert "Back Door unlocked 2:04 AM, locked 2:10 AM." in version["lines"]      # house facts; no "by Emma"
    assert version["quiet"] is False and (start, end) == (START, END)


async def test_the_house_version_goes_through_the_center_to_a_channel_that_picked_it(env):
    busy_night(env)
    env.channel("Discord")
    env.channel("Other", events=[])                                   # a channel that didn't pick it gets nothing
    assert await env.app["timeline_digests"].tick() is True
    await env.run(30)
    assert [n for n, m in env.sent] == ["Discord"]
    msg = env.sent[0][1]
    assert msg.title == "Mantel · Overnight at the house (9 PM to 7 AM)"
    assert "• Garage opened 6:12 AM, closed 6:20 AM." in msg.body and "Emma" not in msg.body
    assert msg.tag.startswith("system:house.digest:2026-11-04")


async def test_a_new_channel_does_not_take_the_digest_until_it_picks_it(env):
    from mantel_server.alerts import catalog
    assert "house.digest" not in catalog.defaults() and catalog.kind("house.digest").group == "house"
    assert catalog.GROUP_NAMES["house"] == "House" and "house" in catalog.GROUPS
    env.channel("Default", events=catalog.defaults())
    await env.app["timeline_digests"].tick()
    await env.run(30)
    assert env.sent == []


async def test_it_is_stored_even_when_no_channel_takes_it_and_the_tablets_can_read_it(env):
    busy_night(env)
    assert await env.app["timeline_digests"].tick() is True
    kept = TD.stored(env.app, "2026-11-04")
    assert kept["title"].startswith("Overnight at the house") and kept["since"] == START and kept["until"] == END
    assert "Garage opened 6:12 AM, closed 6:20 AM." in kept["lines"] and kept["sent"] == env.now[0]
    assert TD.stored(env.app, "2026-11-03") is None


async def test_once_a_day(env):
    env.channel()
    d = env.app["timeline_digests"]
    assert await d.tick() is True
    env.now[0] += 60
    assert await d.tick() is False
    await env.run(30)
    assert len(env.sent) == 1
    n = env.store.db.execute("SELECT COUNT(*) FROM timeline_digests").fetchone()[0]
    assert n == 1
    env.now[0] = ep(5, 7, 0)                                          # the next day, a new row
    assert await d.tick() is True
    assert env.store.db.execute("SELECT COUNT(*) FROM timeline_digests").fetchone()[0] == 2


async def test_a_restart_sends_it_after_the_time_if_it_wasnt_sent_but_not_after_noon(env):
    d = env.app["timeline_digests"]
    env.now[0] = ep(4, 6, 59)
    assert await d.tick() is False and TD.stored(env.app, "2026-11-04") is None
    env.now[0] = ep(4, 11, 59)                                        # a restart at 11:59 AM: still this morning's
    assert await d.tick() is True
    env.now[0] = ep(5, 12, 1)                                         # a restart at 12:01 PM: too late
    assert await d.tick() is False and TD.stored(env.app, "2026-11-05") is None


async def test_no_digest_before_the_houses_own_time_zone_is_known(env):
    """At a start, until Home Assistant says the house's zone, the zone is UTC: 10:50 UTC is 7:00 at no house that
    hasn't said so (the first release on the house sent its digest at 5:50 AM)."""
    d = env.app["timeline_digests"]
    env.app["authz"].tz, env.app["authz"].tz_source = "UTC", "config"
    env.now[0] = ep(4, 8, 0)
    assert await d.tick() is False and TD.stored(env.app, "2026-11-04") is None
    env.app["authz"].set_tz("America/Los_Angeles", "home_assistant")
    assert await d.tick() is True


async def test_no_digest_for_a_night_the_timeline_didnt_watch_from_its_start(env):
    """The day it's installed the timeline saw nothing of the night before: no "quiet night" it can't vouch for."""
    d = env.app["timeline_digests"]
    env.now[0] = ep(4, 7, 30)
    env.tl.settings.set("since", ep(4, 5, 50))
    assert await d.tick() is False and TD.stored(env.app, "2026-11-04") is None
    env.now[0] = ep(5, 7, 30)                                         # the next morning: a whole night watched
    assert await d.tick() is True


async def test_the_digest_time_and_window_are_the_settings(env):
    env.tl.settings.set("digest", {"at": "06:30", "from": "22:00"})
    d = env.app["timeline_digests"]
    env.now[0] = ep(4, 6, 29)
    assert await d.tick() is False
    env.now[0] = ep(4, 6, 31)
    assert await d.tick() is True
    kept = TD.stored(env.app, "2026-11-04")
    assert kept["since"] == ep(3, 22) and kept["until"] == ep(4, 6, 30)
    assert kept["title"] == "Overnight at the house (10 PM to 6:30 AM)"


async def test_an_info_digest_waits_for_a_channels_quiet_hours_then_goes(env):
    busy_night(env)
    env.channel("Discord", quiet={"on": True, "from": "22:00", "to": "07:30"})
    env.now[0] = ep(4, 7, 5)
    assert await env.app["timeline_digests"].tick() is True
    await env.run(60)
    assert env.sent == []                                             # 7:06 is inside its quiet hours
    await env.run(30 * 60)                                            # 7:36: they ended
    assert [n for n, m in env.sent] == ["Discord"] and "Garage opened" in env.sent[0][1].body


async def test_send_test_sends_now_whatever_was_sent_today_and_counts_the_channels(env):
    env.channel("Discord")
    env.channel("Other", events=[])
    assert await TD.send_test(env.app) == 1
    await env.run(30)
    assert await TD.send_test(env.app) == 1                           # not held to once a day
    await env.run(30)
    assert len(env.sent) == 2 and env.store.db.execute("SELECT COUNT(*) FROM timeline_digests").fetchone()[0] == 0
    assert await env.app["timeline_digests"].tick() is True           # and doesn't use up the real one


async def test_the_digest_is_not_one_of_the_timelines_own_system_rows(env):
    env.channel()
    await env.app["timeline_digests"].tick()
    await env.run(30)
    env.tl.flush()
    assert all("house.digest" not in (r["detail"] or "") and "Overnight" not in r["title"] for r in
               env.store.db.execute("SELECT title, detail FROM timeline_events"))


async def test_a_personal_version_goes_to_each_person_who_turned_it_on_for_their_own_view(env):
    busy_night(env)
    adult = await env.user("emma", "adult")
    other = await env.user("noah", "adult")                           # Morning Summary off: nothing
    env.switch(adult)
    env.target(adult, "https://push.example/a")
    env.target(other, "https://push.example/b")
    d = env.app["timeline_digests"]
    viewer = d.viewer_for(next(u for u in d.people() if u.id == adult.id))
    assert viewer is not None
    assert await d.tick() is True
    [(uid, msg)] = env.pushed
    assert uid == adult.id and msg.title == "Overnight at the house (9 PM to 7 AM)"
    assert msg.category == "timeline" and msg.level == "info" and msg.url == TD.PAGE_URL
    assert "Garage opened 6:12 AM, closed 6:20 AM." in msg.body


async def test_the_personal_version_follows_the_roles_arrivals_and_names_for_an_adult_not_a_child(env):
    busy_night(env)
    adult = await env.user("emma", "adult")
    child = await env.user("cody", "child")
    admin = await env.user("avery", "admin")
    d = env.app["timeline_digests"]
    start, end, now = START, END, env.now[0]
    views = {u.role: env.viewer(u) for u in (adult, child, admin)}
    assert views["adult"].feature() and views["admin"].feature() and not views["child"].feature()
    adult_lines = TD.build(env.app, views["adult"], start, end, now, "Overnight")["lines"]
    admin_lines = TD.build(env.app, views["admin"], start, end, now, "Overnight")["lines"]
    assert any("Emma arrived home 11:40 PM" in x for x in adult_lines)         # an Adult may see arrivals and names
    assert not any("alert" in x or "refused" in x for x in adult_lines)         # System and Refused: managers only
    assert any(x.startswith("1 alert: Kitchen tablet offline") for x in admin_lines)
    assert any("refused command" in x for x in admin_lines)
    # a child has no Timeline: no summary is sent, though the switch is on
    env.switch(child)
    env.target(child, "https://push.example/c")
    assert d.viewer_for(next(u for u in d.people() if u.id == child.id)) is None
    assert await d.tick() is True and env.pushed == []


async def test_the_summary_route_s_function_is_the_viewers_own_lines_counts_and_events(env):
    busy_night(env)
    adult = await env.user("emma", "adult")
    viewer = env.viewer(adult)
    got = TD.summary(env.app, viewer, "overnight", env.now[0])
    assert set(got) == {"window", "label", "since", "until", "title", "lines", "quiet", "counts", "events"}
    assert got["window"] == "overnight" and got["label"] == "Overnight" and (got["since"], got["until"]) == (START, END)
    assert got["counts"]["garage"] == 2 and got["counts"]["lock"] == 2 and got["counts"]["arrival"] == 1
    assert "system" not in got["counts"] and "Emma arrived home 11:40 PM." in got["lines"]
    assert all(e["family"] != "system" for e in got["events"]) and len(got["events"]) <= 12
    today = TD.summary(env.app, viewer, "today", env.now[0])
    assert today["label"] == "Today" and today["title"].startswith("Today at the house")


async def test_a_signed_in_summary_route_answers_for_an_owner_with_system_rows(env):
    busy_night(env)
    await env.user("avery", "owner")
    r = await env.client.post("/api/auth/password", json={"username": "avery", "password": PASSWORD},
                              headers={"Origin": str(env.client.make_url("")).rstrip("/")})
    assert r.status == 200
    r = await env.client.get("/api/timeline/summary?window=overnight")
    assert r.status == 200
    body = await r.json()
    assert any(x.startswith("1 alert: Kitchen tablet offline") for x in body["lines"])
    assert body["title"] == "Overnight at the house (9 PM to 7 AM)"
