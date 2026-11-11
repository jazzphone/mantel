"""The House Timeline's REST and live feed (docs/phase19/HOUSE-TIMELINE.md "Who sees what", "The API and live feed"):
who may open the page and which rows each person or wall tablet gets, names and the audit id withheld, pictures behind
the camera rule with one 404 for everything, search that can't find a name, the writes' guards (Owner only, fresh
factor, CSRF, audit before the change), a person's own switches, forgetting a removed person, and the live feed that
is filtered per viewer and closes with the session. Fictional house and people (tests/timeline_world.py)."""
from __future__ import annotations

import asyncio
import json

import pytest

from timeline_world import House, JPEG
from mantel_server.timeline.store import Row

ALL = {"old_lock", "lock", "door", "garage", "alarm", "arrival", "stranger", "person", "ring", "hall_person",
       "system", "refused"}
ADULT = ALL - {"system", "refused"}
CAMERA_ROWS = {"person", "ring", "hall_person"}
# who gets the page, and the rows (by name) each is shown
SEES = {
    "avery": ALL,
    "boss": ALL,
    "mark": ADULT,
    "emma": ADULT,
    "tunnel_mark": ADULT,
    # a Child granted the page: the role still denies locks, the alarm, the garage and cameras; an arrival of a person
    # Mantel doesn't know is for Owners, Admins and Adults only
    "cody": {"door", "arrival"},
    # a wall tablet alone: the last 12 hours of its room's doors, locks and alarm, and the cameras every tablet may
    # watch (the doorbell pop-up); no arrivals, no System, no Refused, nothing from the driveway's garage
    "tablet": {"lock", "door", "alarm", "person", "ring", "hall_person"},
    # an Adult signed in at it: what the person and the tablet both allow, with no 12-hour limit; an Owner at it is no
    # manager there (no System, no Refused, no audit ids: a forgotten sign-in on a kitchen tablet must not read them)
    "mark_at_tablet": {"old_lock", "lock", "door", "alarm", "person", "ring", "hall_person"},
    "avery_at_tablet": {"old_lock", "lock", "door", "alarm", "person", "ring", "hall_person"},
}
NAMED = {"avery", "boss", "mark", "emma", "tunnel_mark", "mark_at_tablet", "avery_at_tablet"}
MANAGERS = ("avery", "boss")


@pytest.fixture
async def w(mantel):
    h = House(mantel)
    h.load()
    await h.people()
    await h.enroll_tablet()
    h.seed()
    h.grant_child_the_page("cody")
    for n in ("avery", "boss", "mark", "emma", "cody", "pip", "gwen"):
        await h.sign_in(n)
    h.tunnel_session("mark", "tunnel_mark")
    for who in ("mark", "avery"):
        h.use("tablet")
        await h.sign_in(who, as_name=f"{who}_at_tablet", keep=True)
    return h


def events(body):
    return body["events"]


# -- who may open the page, which rows ---------------------------------------------------------------------------------
@pytest.mark.parametrize("who", sorted(SEES))
async def test_each_viewer_gets_exactly_their_rows(w, who):
    status, body = await w.find(who)
    assert status == 200, body
    assert w.names_of(events(body)) == SEES[who], who
    # nobody is told about a row's family they may not see, nor its names by accident
    assert body["limited"] is (who == "tablet")
    assert ("system" in body["families"]) is (who in MANAGERS)


async def test_a_child_without_the_page_and_a_guest_are_refused(w):
    for who in ("pip", "gwen"):
        status, body = await w.find(who)
        assert (status, body) == (403, {"error": "forbidden"}), who
        assert (await w.get(who, "/api/timeline/summary"))[0] == 403
        assert (await w.get(who, "/api/timeline/me"))[0] == 200            # (their own switches are still theirs)


async def test_system_and_refused_rows_are_for_owners_and_admins_alone(w):
    for who in ("mark", "emma", "cody", "tablet", "mark_at_tablet", "avery_at_tablet"):
        _, body = await w.find(who)
        assert not {e["family"] for e in events(body)} & {"system", "refused"}, who
        _, body = await w.find(who, "family=system")
        assert events(body) == []
    for who in ("avery", "boss"):
        _, body = await w.find(who, "family=system")
        assert {e["family"] for e in events(body)} == {"system", "refused"}


async def test_a_childs_granted_page_never_shows_locks_the_alarm_the_garage_or_cameras(w):
    _, body = await w.find("cody")
    assert not {e["family"] for e in events(body)} & {"lock", "alarm", "garage", "detection", "doorbell", "motion"}
    # ... however the rows are asked for
    for q in ("family=lock", "family=garage", "family=alarm", "family=cameras", "camera=camera.hall",
              "entity=lock.back_door", "area=hall&family=lock,alarm"):
        assert events((await w.find("cody", q))[1]) == [], q


async def test_an_unmatched_arrival_is_for_owners_admins_and_adults_only(w):
    for who in ("avery", "boss", "mark", "emma"):
        assert "stranger" in w.names_of(events((await w.find(who, "family=people"))[1])), who
    _, body = await w.find("cody", "family=people")                    # may view both people, but is a Child
    assert w.names_of(events(body)) == {"arrival"}


async def test_the_tunnel_without_cameras_hides_the_cameras_rows_and_pictures(w):
    w.app["rbac"].set_override("adult", {"tunnel_cameras": False})
    _, body = await w.find("tunnel_mark")
    assert w.names_of(events(body)) == ADULT - CAMERA_ROWS
    _, body = await w.find("mark")                                      # the same person at home still sees them
    assert w.names_of(events(body)) == ADULT
    status, body = await w.get("tunnel_mark", f"/api/timeline/pic/{w.pics['hall']}")
    assert (status, body) == (404, {"error": "not_found"})
    assert (await w.get("mark", f"/api/timeline/pic/{w.pics['hall']}"))[0] == 200


async def test_an_arrival_needs_history_of_the_person_not_only_view(w):
    """Where someone was is location history: the tunnel's locations switch applies, and a person who may merely see
    the person entity doesn't get their arrivals."""
    w.app["rbac"].set_override("adult", {"tunnel_locations": False})
    _, body = await w.find("tunnel_mark")
    assert w.names_of(events(body)) == ADULT - {"arrival", "stranger"}
    assert w.names_of(events((await w.find("mark"))[1])) == ADULT          # at home they see them
    from mantel_server.identity.rbac import Grant
    for kind, eid, actions in (("feature", "timeline", ("view",)), ("entity", "person.emma", ("view",))):
        w.app["rbac"].add_grant(Grant(effect="allow", actions=actions, resource_kind=kind, resource=eid,
                                      users={w.uid["pip"]}))
    assert (await w.find("pip", "family=people"))[1]["events"] == []
    w.app["rbac"].add_grant(Grant(effect="allow", actions=("history",), resource_kind="entity", resource="person.emma",
                                  users={w.uid["pip"]}))                    # ... and with `history` of her they do
    assert w.names_of(events((await w.find("pip", "family=people"))[1])) == {"arrival"}


# -- names, the audit id, pictures --------------------------------------------------------------------------------------
async def test_names_only_for_signed_in_owners_admins_and_adults(w):
    for who in SEES:
        _, body = await w.find(who)
        named = [e["who"]["name"] for e in events(body) if e.get("who") and e["who"].get("name")]
        if who in NAMED:
            assert "Emma" in named, who
        else:
            assert named == [], who
    # a wall tablet alone sees no one's name anywhere in what it is sent, nor how or from where
    status, body = await w.find("tablet")
    text = json.dumps(body)
    assert all("who" not in e for e in events(body))
    assert "Emma" not in text and "Mark" not in text and "Hallway tablet" not in text and "audit_id" not in text
    # the Child sees the rows' "by whom" nowhere either
    _, body = await w.find("cody")
    assert all(not (e.get("who") or {}).get("name") for e in events(body))


async def test_the_audit_id_is_for_owners_and_admins_only(w):
    for who in SEES:
        _, body = await w.find(who)
        ids = {e["audit_id"] for e in events(body) if "audit_id" in e}
        assert bool(ids) is (who in MANAGERS), who
    _, body = await w.find("avery")
    assert {e["audit_id"] for e in events(body) if "audit_id" in e} == {7, 8, 9, 10}


async def test_the_one_who_did_it_is_marked_mine(w):
    _, body = await w.find("emma")
    mine = {e["id"] for e in events(body) if (e.get("who") or {}).get("mine")}
    assert mine == {w.rows["lock"], w.rows["alarm"]}
    _, body = await w.find("avery")
    assert not [e for e in events(body) if (e.get("who") or {}).get("mine")]


async def test_pictures_come_with_rows_except_at_a_wall_tablet(w):
    _, body = await w.find("avery")
    got = {k: [p["id"] for p in e["pics"]] for e in events(body) for k, v in w.rows.items() if v == e["id"]}
    assert got["person"] == [w.pics["drive"]] and got["ring"] == [w.pics["hall"]]
    assert all(p["url"] == f"/api/timeline/pic/{p['id']}" for e in events(body) for p in e["pics"])
    assert any(e["pics"] for e in events((await w.find("mark"))[1]))
    # a screen anyone in the room can read: no pictures, alone or with a person signed in, until the Owner says so
    for who in ("tablet", "mark_at_tablet", "avery_at_tablet"):
        _, body = await w.find(who)
        assert events(body) and all(e["pics"] == [] for e in events(body)), who
        assert (await w.get(who, f"/api/timeline/pic/{w.pics['hall']}")) == NOT_FOUND, who


async def test_a_tablet_the_owner_turned_pictures_on_for_gets_them(w):
    fams = ["door", "lock", "garage", "alarm", "doorbell", "detection"]
    w.tl.settings.set("wall", {"families": fams, "pictures": [w.tablet_id]})
    for who in ("tablet", "mark_at_tablet"):
        _, body = await w.find(who)
        assert any(e["pics"] for e in events(body)), who
        assert (await w.get(who, f"/api/timeline/pic/{w.pics['hall']}"))[0] == 200, who
    # another tablet isn't that one
    w.tl.settings.set("wall", {"families": fams, "pictures": ["some-other-tablet"]})
    for who in ("tablet", "mark_at_tablet"):
        _, body = await w.find(who)
        assert all(e["pics"] == [] for e in events(body)), who
        assert (await w.get(who, f"/api/timeline/pic/{w.pics['hall']}")) == NOT_FOUND, who


# -- the wall tablet's limited view -------------------------------------------------------------------------------------
async def test_a_wall_tablet_alone_sees_twelve_hours_and_cant_search_or_ask_who(w):
    t = w.now[0]
    w.add("eleven", at=t - 11.9 * 3600, family="lock", kind="locked", entity="lock.back_door", area="hall",
          title="Back Door locked", search="back door locked hallway")
    w.add("thirteen", at=t - 12.1 * 3600, family="lock", kind="locked", entity="lock.back_door", area="hall",
          title="Back Door locked", search="back door locked hallway")
    _, body = await w.find("tablet")
    names = w.names_of(events(body))
    assert "eleven" in names and "thirteen" not in names and "old_lock" not in names and body["limited"] is True
    assert body["names"] is False and body["search"] is False
    # the page can't ask for more: `since` only narrows
    _, body = await w.find("tablet", "since=0")
    assert "thirteen" not in w.names_of(events(body))
    assert (await w.find("avery"))[1]["limited"] is False
    assert {"thirteen", "old_lock"} <= w.names_of(events((await w.find("avery"))[1]))
    # no search, no asking who, no "only mine"
    assert await w.find("tablet", "q=back") == (403, {"error": "search_unavailable"})
    assert await w.find("tablet", "actor=" + w.uid["emma"]) == (403, {"error": "forbidden"})
    assert await w.find("tablet", "mine=1") == (403, {"error": "sign_in_first"})
    # ... and a person at the tablet may
    assert (await w.find("mark_at_tablet", "q=back"))[0] == 200
    assert (await w.find("mark_at_tablet", "actor=" + w.uid["emma"]))[0] == 200


async def test_the_owner_picks_the_families_of_the_tablets_view(w):
    w.tl.settings.set("wall", {"families": ["door"], "pictures": []})
    _, body = await w.find("tablet")
    assert w.names_of(events(body)) == {"door"} and body["families"] == ["door"]
    _, body = await w.find("mark_at_tablet")                          # a person's view isn't the tablet-alone one
    assert "lock" in w.names_of(events(body))


async def test_actor_is_refused_for_everyone_who_may_not_see_names(w):
    emma = w.uid["emma"]
    for who in ("tablet",):
        assert (await w.find(who, f"actor={emma}"))[0] == 403
    _, body = await w.find("mark", f"actor={emma}")
    assert w.names_of(events(body)) == {"lock", "alarm"}
    _, body = await w.find("avery", f"actor={emma}")
    assert w.names_of(events(body)) == {"lock", "alarm", "refused"}


async def test_mine_is_only_what_the_person_did(w):
    _, body = await w.find("emma", "mine=1")
    assert w.names_of(events(body)) == {"lock", "alarm"}
    _, body = await w.find("mark", "mine=1")
    assert w.names_of(events(body)) == {"garage"}
    _, body = await w.find("avery", "mine=1")
    assert events(body) == []


# -- search ----------------------------------------------------------------------------------------------------------
async def test_search_matches_the_search_words_and_never_a_name(w):
    for who in ("avery", "mark"):
        # the name is in `actor_name` and in a title, but not in the words a search looks through
        for q in ("emma", "EMMA", "Mark", "Hallway tablet", "emma arrived"):
            _, body = await w.find(who, "q=" + q)
            assert events(body) == [], (who, q)
    _, body = await w.find("avery", "q=back door")
    assert w.names_of(events(body)) == {"old_lock", "lock", "door"}
    _, body = await w.find("avery", "q=back unlocked")
    assert w.names_of(events(body)) == {"lock"}
    _, body = await w.find("mark", "q=hallway")                         # the area's name is searchable
    assert w.names_of(events(body)) >= {"lock", "door", "alarm", "ring"}
    _, body = await w.find("mark", "q=arrived")
    assert w.names_of(events(body)) == {"arrival", "stranger"}
    # the System family's words are the Owner's alone
    assert w.names_of(events((await w.find("avery", "q=backup"))[1])) == {"system"}
    assert events((await w.find("mark", "q=backup"))[1]) == []


async def test_search_words_are_cleaned_and_a_wildcard_matches_nothing_extra(w):
    n_all = len(events((await w.find("avery"))[1]))
    _, body = await w.find("avery", "q=%25_%27;--")                     # %_';--  (no letters: no filter)
    assert len(events(body)) == n_all
    _, body = await w.find("avery", "q=garage%25")                       # garage%
    assert w.names_of(events(body)) == {"garage"}


# -- filters, paging, bad queries -------------------------------------------------------------------------------------
async def test_filters_families_camera_area_entity_and_time(w):
    t = w.now[0]
    q = lambda s: w.find("avery", s)                                    # noqa: E731
    assert w.names_of(events((await q("family=doors"))[1])) == {"door"}
    assert w.names_of(events((await q("family=lock,garage"))[1])) == {"old_lock", "lock", "garage"}
    assert w.names_of(events((await q("family=cameras"))[1])) == CAMERA_ROWS - {"ring"}
    assert w.names_of(events((await q("family=doorbell"))[1])) == {"ring"}
    assert w.names_of(events((await q("camera=camera.hall"))[1])) == {"ring", "hall_person"}
    assert w.names_of(events((await q("entity=lock.back_door"))[1])) == {"old_lock", "lock"}
    assert w.names_of(events((await q("area=drive"))[1])) == {"garage", "person"}
    assert w.names_of(events((await q(f"since={t - 2450}&until={t - 2150}"))[1])) == {"person", "ring", "hall_person"}


async def test_a_camera_is_asked_for_by_any_of_its_channels_and_gets_its_devices_rows(w):
    # 2026-11-05: the camera sheet asks by the channel its tile shows (the low resolution one); Protect files the rows
    # under the channel it matched, Home Assistant under the device's own sensors. Recent said "Nothing recorded".
    t = w.now[0]
    w.add("hall_sensor", at=t - 2100, family="detection", kind="person", entity="binary_sensor.hall_person",
          area="hall", title="Person at Hall Cam", search="person at hall cam hallway")
    for cam in ("camera.hall_low", "camera.hall"):
        _, body = await w.find("avery", f"camera={cam}")
        assert w.names_of(events(body)) == {"ring", "hall_person", "hall_sensor"}, cam
    # another device's camera, an entity filter and a camera Home Assistant doesn't list keep to themselves
    _, body = await w.find("avery", "camera=camera.driveway")
    assert w.names_of(events(body)) == {"person"}
    _, body = await w.find("avery", "entity=camera.hall_low")
    assert events(body) == []
    _, body = await w.find("avery", "camera=camera.nowhere")
    assert events(body) == []
    # each row still by its own rules: a Child granted the page sees no camera's rows by any of its channels
    _, body = await w.find("cody", "camera=camera.hall_low")
    assert events(body) == []


async def test_bad_queries_are_refused_plainly(w):
    for q, err in (("family=nope", "bad_family"), ("limit=abc", "bad_limit"), ("before=abc", "bad_before"),
                   ("since=abc", "bad_since"), ("until=nan", "bad_until"), ("since=inf", "bad_since"),
                   ("surprise=1", "bad_query")):
        status, body = await w.find("avery", q)
        assert (status, body) == (400, {"error": err}), q
    assert (await w.find("avery", "limit=0"))[0] == 200 and len(events((await w.find("avery", "limit=0"))[1])) == 1
    assert len(events((await w.find("avery", "limit=100000"))[1])) <= 100


async def test_paging_with_before_and_a_limit_visits_every_row_once(w):
    t = w.now[0]
    for i in range(14):
        w.add(f"extra{i}", at=t - 100 - i, family="door", kind="opened", entity="binary_sensor.back_door", area="hall",
              title="Back Door opened", search="back door opened hallway")
    want = {e["id"] for e in events((await w.find("avery", "limit=100"))[1])}
    assert len(want) == 26
    seen: list[int] = []
    before = None
    pages = 0
    while True:
        status, body = await w.find("avery", "limit=5" + (f"&before={before}" if before else ""))
        assert status == 200
        seen += [e["id"] for e in events(body)]
        pages += 1
        before = body["next_before"]
        if before is None:
            break
        assert pages < 20
    assert sorted(seen) == sorted(want) and len(seen) == len(set(seen)) and seen == sorted(seen, reverse=True)
    assert pages >= 5


async def test_a_page_scans_past_rows_the_viewer_may_not_see(w):
    t = w.now[0]
    for i in range(60):                                                  # newest of all, and an Adult's never
        w.add(f"sys{i}", at=t - 10 + i / 100, family="system", kind="raised", entity=None, title=f"Alert {i}",
              search=f"alert {i}")
    status, body = await w.find("mark", "limit=3")
    assert status == 200 and len(events(body)) == 3 and body["next_before"] is not None
    assert not {e["family"] for e in events(body)} & {"system"}
    _, again = await w.find("mark", f"limit=3&before={body['next_before']}")
    assert not {e["id"] for e in events(body)} & {e["id"] for e in events(again)}
    # the Owner's first page is the System rows
    _, body = await w.find("avery", "limit=3")
    assert {e["family"] for e in events(body)} == {"system"}


# -- pictures ----------------------------------------------------------------------------------------------------------
NOT_FOUND = (404, {"error": "not_found"})


async def test_a_picture_goes_to_the_owner_as_the_bytes(w):
    pid = w.pics["drive"]
    r = await w.m.client.get(f"/api/timeline/pic/{pid}", headers=(w.use("avery"), w.m.headers(False))[1])
    assert r.status == 200 and await r.read() == JPEG and r.content_type == "image/jpeg"
    assert r.headers["X-Content-Type-Options"] == "nosniff" and "private" in r.headers["Cache-Control"]
    mode = w.tl.pic_path(pid, w.now[0]).stat().st_mode & 0o777
    assert mode == 0o600


async def test_one_404_for_unknown_malformed_unseen_and_unwatchable_pictures(w):
    # a picture on a row an Adult may not see (a System row), and one of a camera a tunnel Adult may not watch
    w.add_pic("secret", "system", "camera.hall")
    w.add_pic("sideways", "door", "camera.hall")           # a row a Child sees, with a camera's picture they may not
    w.app["rbac"].set_override("adult", {"tunnel_cameras": False})
    asks = [
        ("avery", "0" * 32),                                  # no such picture
        ("avery", "zz"),                                      # malformed
        ("avery", "A" * 32),                                  # the id's shape is lowercase hex
        ("avery", "g" * 32),
        ("avery", "a" * 33),
        ("avery", "a" * 31),
        ("mark", w.pics["secret"]),                           # the row isn't theirs to see
        ("tunnel_mark", w.pics["hall"]),                      # the camera isn't theirs to watch from outside
        ("cody", w.pics["hall"]),                             # a Child who may open the page, not see cameras
        ("cody", w.pics["sideways"]),                         # the row is theirs, the camera of its picture is not
        ("pip", w.pics["hall"]),                              # no page at all
        ("gwen", w.pics["hall"]),
        ("tablet", w.pics["hall"]),                           # a tablet alone: pictures are off
    ]
    answers = []
    for who, pid in asks:
        w.use(who)
        r = await w.m.client.get(f"/api/timeline/pic/{pid}", headers=w.m.headers(False, tunnel=w.tunnel.get(who, False)))
        answers.append((who, r.status, await r.read()))
    assert {(s, b) for _, s, b in answers} == {(404, b'{"error": "not_found"}')}, answers
    # ... and the Owner has all three of those pictures
    for pid in (w.pics["secret"], w.pics["hall"], w.pics["sideways"]):
        assert (await w.get("avery", f"/api/timeline/pic/{pid}"))[0] == 200
    # a query string is no way in either
    assert (await w.get("avery", f"/api/timeline/pic/{w.pics['hall']}?token=x")) == NOT_FOUND
    assert (await w.get("avery", f"/api/timeline/pic/{w.pics['hall']}?v=1"))[0] == 200


async def test_an_expired_picture_whose_file_is_gone_is_the_same_404(w):
    pid = w.pics["hall"]
    w.tl.pic_path(pid, w.now[0]).unlink()
    assert await w.get("avery", f"/api/timeline/pic/{pid}") == NOT_FOUND


async def test_a_picture_of_a_removed_row_is_gone_with_it(w):
    pid = w.pics["hall"]
    with w.db:
        w.db.execute("DELETE FROM timeline_events WHERE id = ?", (w.rows["ring"],))
    assert await w.get("avery", f"/api/timeline/pic/{pid}") == NOT_FOUND
    assert w.db.execute("SELECT COUNT(*) FROM timeline_pics WHERE id = ?", (pid,)).fetchone()[0] == 0


# -- reads that belong to the managers ------------------------------------------------------------------------------------
async def test_settings_and_summary_reads(w):
    for who, want in (("avery", 200), ("boss", 200), ("mark", 403), ("cody", 403), ("tablet", 403), ("gwen", 403)):
        assert (await w.get(who, "/api/timeline/settings"))[0] == want, who
    status, body = await w.get("avery", "/api/timeline/settings")
    assert body["retention_days"] == 30 and body["pictures"] == {"budget_mb": 500, "frames": 2}
    assert body["can_edit"] is True and "seen" not in body
    assert body["wall"]["pictures"] == [] and body["tablets"] == [{"id": w.tablet_id, "name": "Hallway tablet"}]
    assert (await w.get("boss", "/api/timeline/settings"))[1]["can_edit"] is False        # Admins read
    for who, want in (("avery", 200), ("mark", 200), ("tablet", 200), ("cody", 200), ("pip", 403), ("gwen", 403)):
        assert (await w.get(who, "/api/timeline/summary?window=24h"))[0] == want, who
    assert (await w.get("avery", "/api/timeline/summary?window=never"))[0] == 400


# -- the writes -------------------------------------------------------------------------------------------------------
SETTINGS = ("PUT", "/api/timeline/settings", {"retention_days": 7})
OVERRIDES = ("PUT", "/api/timeline/overrides", {"overrides": {"binary_sensor.loft_sensor": {"record": True}}})
DIGEST = ("POST", "/api/timeline/digest/test", {})
CLEAR = ("DELETE", "/api/timeline?confirm=clear", None)
WRITES = {"settings": SETTINGS, "overrides": OVERRIDES, "digest": DIGEST, "clear": CLEAR}
AUDIT = {"settings": "timeline.settings.saved", "overrides": "timeline.overrides.saved",
         "digest": "timeline.digest.test", "clear": "timeline.cleared"}


@pytest.fixture
def digest_sent(monkeypatch):
    """The digest's own sending is its tests' business (test_timeline_digest.py): here only that the route asks."""
    from mantel_server.timeline import digest
    calls: list[int] = []

    async def send_test(app):
        calls.append(1)
        return 1
    monkeypatch.setattr(digest, "send_test", send_test)
    return calls


def state_of(w, name):
    if name == "settings":
        return w.tl.settings.get("retention_days")
    if name == "overrides":
        return w.tl.settings.get("overrides")
    if name == "clear":
        return w.tl.rows.count()
    return None


@pytest.mark.parametrize("name", sorted(WRITES))
async def test_a_write_is_the_owners_alone_and_needs_csrf(w, digest_sent, name):
    method, path, body = WRITES[name]
    before = state_of(w, name)
    for who in ("boss", "mark", "cody", "gwen", "tablet", "mark_at_tablet"):
        status, got = await w.call(who, method, path, body)
        assert status == 403, (who, got)
        if who == "boss":
            assert got == {"error": "owner_only"}
    status, got = await w.call("avery", method, path, body, csrf=False)             # no CSRF token
    assert status == 403, got
    assert state_of(w, name) == before and digest_sent == [] and w.audit_rows() == []
    # the Owner, with the token
    status, got = await w.call("avery", method, path, body)
    assert status == 200, got
    assert state_of(w, name) != before or name == "digest"
    assert [a for a, _ in w.audit_rows()] == [AUDIT[name]]
    assert digest_sent == ([1] if name == "digest" else [])


@pytest.mark.parametrize("name", ["settings", "overrides", "digest"])
async def test_from_the_tunnel_a_change_needs_a_fresh_sign_in(w, digest_sent, name):
    method, path, body = WRITES[name]
    w.tunnel_session("avery", "tunnel_avery")
    w.now[0] += 360                                                     # the sign-in is no longer fresh
    before = state_of(w, name)
    status, got = await w.call("tunnel_avery", method, path, body)
    assert (status, got) == (403, {"error": "step_up_required"})
    assert state_of(w, name) == before and w.audit_rows() == [] and digest_sent == []
    # a fresh one is let through
    w.tunnel_session("avery", "tunnel_avery")
    assert (await w.call("tunnel_avery", method, path, body))[0] == 200


async def test_clearing_always_needs_a_fresh_sign_in_even_at_home(w):
    w.now[0] += 400
    status, got = await w.call("avery", *CLEAR)
    assert (status, got) == (403, {"error": "step_up_required"})
    assert w.tl.rows.count() == 12 and w.audit_rows() == []
    await w.sign_in("avery")
    status, got = await w.call("avery", *CLEAR)
    assert status == 200 and got["deleted"] == 12 and w.tl.rows.count() == 0


async def test_clear_timeline_needs_the_typed_confirmation_and_deletes_the_pictures_too(w):
    paths = [w.tl.pic_path(p, w.now[0]) for p in w.pics.values()]
    assert all(p.exists() for p in paths)
    for q in ("", "?confirm=yes", "?confirm=clear&surprise=1"):
        assert (await w.call("avery", "DELETE", "/api/timeline" + q))[1] == {"error": "confirm_required"}
    assert (await w.call("avery", "DELETE", "/api/timeline?confirm=clear&before=abc"))[1] == {"error": "bad_before"}
    assert w.tl.rows.count() == 12 and w.audit_rows() == []
    # only what is older than `before`
    cut = w.now[0] - 2500
    status, got = await w.call("avery", "DELETE", f"/api/timeline?confirm=clear&before={cut}")
    assert status == 200 and got["deleted"] == 6          # old_lock, lock, door, garage, alarm, arrival
    assert [a for a, _ in w.audit_rows()] == ["timeline.cleared"]
    status, got = await w.call("avery", *CLEAR)
    assert status == 200 and got["deleted"] == 6
    assert not any(p.exists() for p in paths)
    assert w.db.execute("SELECT COUNT(*) FROM timeline_pics").fetchone()[0] == 0


async def test_the_audit_row_is_written_before_the_change(w, digest_sent):
    audit = w.app["audit"]
    real = audit.config_event
    seen: dict[str, object] = {}

    def spy(row):
        action = row["action"] if isinstance(row, dict) else getattr(row, "action", None)
        if action and action.startswith("timeline."):
            seen[action] = (w.tl.settings.get("retention_days"), w.tl.settings.get("overrides"), w.tl.rows.count(),
                            len(digest_sent))
        return real(row)
    audit.config_event = spy
    for name in ("settings", "overrides", "digest", "clear"):
        method, path, body = WRITES[name]
        assert (await w.call("avery", method, path, body))[0] == 200
    assert seen["timeline.settings.saved"][0] == 30             # still the old value when the row was written
    assert seen["timeline.overrides.saved"][1] == {}
    assert seen["timeline.digest.test"][3] == 0
    assert seen["timeline.cleared"][2] == 12


@pytest.mark.parametrize("name", sorted(WRITES))
async def test_when_the_audit_cant_be_written_nothing_changes(w, digest_sent, name):
    def broken(_row):
        raise RuntimeError("disk full")
    w.app["audit"].config_event = broken
    method, path, body = WRITES[name]
    before = state_of(w, name)
    status, got = await w.call("avery", method, path, body)
    assert (status, got) == (503, {"error": "audit_unavailable"})
    assert state_of(w, name) == before and digest_sent == []
    assert w.tl.rows.count() == 12 and w.db.execute("SELECT COUNT(*) FROM timeline_pics").fetchone()[0] == 3 and all(
        w.tl.pic_path(p, w.now[0]).exists() for p in w.pics.values())


async def test_the_settings_are_checked_and_apply(w):
    for body in ({}, {"retention_days": 5}, {"retention_days": True}, {"families": {"nope": True}},
                 {"families": {"door": "yes"}}, {"pictures": {"budget_mb": 7}}, {"pictures": {"frames": 9}},
                 {"wall": {"families": ["system"]}}, {"wall": {"pictures": [3]}}, {"digest": {"at": "7am"}},
                 {"surprise": 1}):
        status, got = await w.call("avery", "PUT", "/api/timeline/settings", body)
        assert status == 400, (body, got)
    assert w.audit_rows() == [] and w.tl.settings.get("retention_days") == 30
    status, got = await w.call("avery", "PUT", "/api/timeline/settings", {
        "families": {"window": True, "garage": False}, "retention_days": 90, "pictures": {"frames": 3},
        "wall": {"families": ["door"], "pictures": [w.tablet_id]}, "digest": {"at": "06:30"}})
    assert status == 200, got
    assert got["families"]["window"] is True and got["families"]["garage"] is False and got["families"]["lock"] is True
    assert got["retention_days"] == 90 and got["pictures"] == {"budget_mb": 500, "frames": 3}
    assert got["wall"] == {"families": ["door"], "pictures": [w.tablet_id]} and got["digest"] == {"at": "06:30",
                                                                                                 "from": "21:00"}
    assert w.audit_rows() == [("timeline.settings.saved", {"changed": ["digest", "families", "pictures",
                                                                      "retention_days", "wall"]})]
    assert w.tl.on("window") and not w.tl.on("garage")


async def test_overrides_are_checked_and_audited_by_count_not_by_name(w):
    for body in ({}, {"overrides": []}, {"overrides": {"Bad Id": {"record": True}}},
                 {"overrides": {"lock.x": {"record": "yes"}}}, {"overrides": {"lock.x": {"record": True, "family": "system"}}},
                 {"overrides": {"lock.x": {"record": True, "label": "x" * 65}}},
                 {"overrides": {"lock.x": {"record": True, "surprise": 1}}}):
        assert (await w.call("avery", "PUT", "/api/timeline/overrides", body))[0] == 400, body
    assert w.audit_rows() == []
    status, got = await w.call("avery", "PUT", "/api/timeline/overrides", {
        "overrides": {"binary_sensor.loft_sensor": {"record": True, "family": "door", "label": " Loft Hatch "}}})
    assert status == 200
    assert w.tl.settings.get("overrides") == {"binary_sensor.loft_sensor": {"record": True, "family": "door",
                                                                            "label": "Loft Hatch"}}
    assert w.audit_rows() == [("timeline.overrides.saved", {"entities": 1})]


# -- a person's own switches -----------------------------------------------------------------------------------------
async def test_me_private_deletes_the_persons_arrivals_and_a_child_cant_set_it(w):
    mark = w.uid["mark"]
    w.add("mark_home", at=w.now[0] - 50, family="arrival", kind="arrived", entity="person.emma",
          title="Mark arrived home", search="arrived home", person=mark)
    status, got = await w.get("mark", "/api/timeline/me")
    assert status == 200 and got["private"] is False and got["may_private"] is True and got["arrivals"] == 1
    status, got = await w.call("mark", "PUT", "/api/timeline/me", {"private": True})
    assert status == 200 and got["private"] is True and got["arrivals"] == 0
    assert "mark_home" not in w.names_of(events((await w.find("avery"))[1]))
    assert "arrival" in w.names_of(events((await w.find("avery"))[1]))                # Emma's stay
    assert ("timeline.me.saved", {"private": True}) in w.audit_rows()
    assert w.tl.private_people() == {mark}
    # a Child's is the Owner's decision
    status, got = await w.get("cody", "/api/timeline/me")
    assert status == 200 and got["may_private"] is False
    assert await w.call("cody", "PUT", "/api/timeline/me", {"private": True}) == (403, {"error": "owner_decides"})
    assert w.tl.private_people() == {mark}
    assert (await w.call("cody", "PUT", "/api/timeline/me", {"summary": True}))[0] == 200
    # bad bodies, a tablet alone, no token
    for body in ({}, {"private": "yes"}, {"surprise": True}):
        assert (await w.call("mark", "PUT", "/api/timeline/me", body))[0] == 400
    assert (await w.get("tablet", "/api/timeline/me"))[0] == 403
    assert (await w.call("tablet", "PUT", "/api/timeline/me", {"private": True}))[0] == 403
    assert (await w.call("mark", "PUT", "/api/timeline/me", {"private": False}, csrf=False))[0] == 403
    assert (await w.call("mark", "PUT", "/api/timeline/me", {"private": False}))[1]["private"] is False


async def test_a_person_clears_their_own_past_arrivals(w):
    emma = w.uid["emma"]
    w.add("emma_two", at=w.now[0] - 40, family="arrival", kind="left", entity="person.emma",
          title="Emma left home", search="left home", person=emma)
    status, got = await w.call("emma", "DELETE", "/api/timeline/mine/presence")
    assert status == 200 and got["deleted"] == 2
    assert [a for a, _ in w.audit_rows()] == ["timeline.presence.cleared"]
    assert w.db.execute("SELECT COUNT(*) FROM timeline_events WHERE family = 'arrival'").fetchone()[0] == 1   # the stranger's
    assert (await w.call("tablet", "DELETE", "/api/timeline/mine/presence"))[0] == 403
    assert (await w.call("emma", "DELETE", "/api/timeline/mine/presence", csrf=False))[0] == 403


async def test_a_removed_person_is_forgotten_by_every_way_of_removing_them(w):
    kim = await w.m.user("kim", "adult")
    lee = await w.m.user("lee", "adult")
    t = w.now[0]
    for i, who in enumerate((kim, lee)):
        w.add(f"kim_arrives{i}", at=t - 30, family="arrival", kind="arrived", entity="person.emma",
              title="Kim arrived home", search="arrived home", person=who)
        w.add(f"kim_unlocks{i}", at=t - 20, family="lock", kind="unlocked", entity="lock.back_door", area="hall",
              title="Back Door unlocked", search="back door unlocked hallway", actor=who, actor_name="Kim",
              how="app", audit_id=70 + i)
    with w.db:
        w.db.execute("DELETE FROM users WHERE id = ?", (kim,))                           # (People removes a person)
    from mantel_server.ha import people_ha
    with w.db:
        w.db.execute("UPDATE users SET kind = 'ha_linked' WHERE id = ?", (lee,))
    people_ha.merge(w.app, lee, w.uid["mark"])                                           # (and a merge removes one)
    rows = {r["src"]: dict(r) for r in w.db.execute("SELECT * FROM timeline_events WHERE src LIKE 'test:kim_%'")}
    assert set(rows) == {"test:kim_unlocks0", "test:kim_unlocks1"}                       # their arrivals are gone
    for r in rows.values():
        assert r["actor"] is None and r["actor_name"] == "A former member" and r["person"] is None
        assert "Kim" not in json.dumps(r)
    _, body = await w.find("avery")
    assert {e["who"]["name"] for e in events(body) if e["id"] in {r["id"] for r in rows.values()}} == {
        "A former member"}
    _, body = await w.find("avery", "q=kim")                                              # and no search finds them
    assert events(body) == []


# -- the live feed -----------------------------------------------------------------------------------------------------
async def read_event(ws, rid, timeout=3.0):
    while True:
        m = await asyncio.wait_for(ws.receive_json(), timeout)
        if m.get("type") == "read_event" and m.get("id") == rid:
            return m["event"]
        assert m.get("type") != "error", m


async def subscribe(w, who, rid=1, **msg):
    w.use(who)
    ws = await w.m.client.ws_connect("/ws", headers={"X-Mantel-Door": "tunnel"} if w.tunnel.get(who) else None)
    await ws.send_json({"type": "read_subscribe", "id": rid, "msg": {"type": "timeline/subscribe", **msg}})
    first = await read_event(ws, rid)
    return ws, first


def push(w, name, **kw):
    kw.setdefault("at", w.now[0])
    kw.setdefault("src", f"live:{name}")
    w.tl.push(Row(**kw))
    w.tl.flush()


async def test_the_live_feed_sends_each_new_row_filtered_for_its_viewer(w):
    owner, first = await subscribe(w, "avery")
    assert first == {"ready": True}
    adult, _ = await subscribe(w, "mark")
    tablet, _ = await subscribe(w, "tablet")
    push(w, "system", family="system", kind="raised", entity=None, title="Home Assistant disconnected",
         search="home assistant disconnected", level="warning")
    push(w, "lock", family="lock", kind="unlocked", entity="lock.back_door", area="hall", title="Back Door unlocked",
         search="back door unlocked hallway", actor=w.uid["emma"], actor_name="Emma", device=w.tablet_id,
         device_name="Hallway tablet", how="tablet", audit_id=77)
    push(w, "garage", family="garage", kind="opened", entity="cover.garage", area="drive", title="Garage opened",
         search="garage opened driveway")
    got = {n: [] for n in ("owner", "adult", "tablet")}
    for name, ws, n in (("owner", owner, 3), ("adult", adult, 2), ("tablet", tablet, 1)):
        while len(got[name]) < n:
            got[name] += (await read_event(ws, 1))["events"]
    assert {e["family"] for e in got["owner"]} == {"system", "lock", "garage"}
    assert {e["family"] for e in got["adult"]} == {"lock", "garage"}               # an Adult never gets a System row
    assert [e["family"] for e in got["tablet"]] == ["lock"]                        # nor the garage: not its room
    lock = {n: next(e for e in got[n] if e["family"] == "lock") for n in got}
    assert lock["owner"]["audit_id"] == 77 and lock["owner"]["who"]["name"] == "Emma"
    assert "audit_id" not in lock["adult"] and lock["adult"]["who"]["name"] == "Emma"
    assert "who" not in lock["tablet"] and "audit_id" not in lock["tablet"] and lock["tablet"]["pics"] == []
    assert "Emma" not in json.dumps(got["tablet"])
    for ws in (owner, adult, tablet):
        await ws.close()


async def test_the_live_feed_can_be_narrowed_and_a_late_picture_arrives_as_an_update(w):
    ws, _ = await subscribe(w, "mark", family="cameras")
    push(w, "door", family="door", kind="opened", entity="binary_sensor.back_door", area="hall", title="Back Door opened",
         search="back door opened")
    push(w, "motion", family="detection", kind="person", entity="camera.hall", area="hall", title="Person at Hall Cam",
         search="person at hall cam")
    ev = (await read_event(ws, 1))["events"]
    assert [e["family"] for e in ev] == ["detection"] and ev[0]["pics"] == []
    row_id = ev[0]["id"]
    pid = w.app["timeline_pictures"].store(row_id, "camera.hall", JPEG)
    w.tl.publish(["live:motion"])
    ev = (await read_event(ws, 1))["events"]
    assert [e["id"] for e in ev] == [row_id] and [p["id"] for p in ev[0]["pics"]] == [pid]      # the same row, updated
    await ws.close()


async def test_a_cameras_live_feed_sends_its_devices_rows_whatever_channel_asked(w):
    ws, _ = await subscribe(w, "mark", camera="camera.hall_low")
    push(w, "drive", family="detection", kind="person", entity="camera.driveway", area="drive", title="Person at Driveway Cam",
         search="person at driveway cam")
    push(w, "hi", family="detection", kind="person", entity="camera.hall", area="hall", title="Person at Hall Cam",
         search="person at hall cam")
    push(w, "sensor", family="detection", kind="person", entity="binary_sensor.hall_person", area="hall",
         title="Person at Hall Cam", search="person at hall cam")
    got: list[dict] = []
    while len(got) < 2:
        got += (await read_event(ws, 1))["events"]
    assert [e["entity"] for e in got] == ["camera.hall", "binary_sensor.hall_person"]      # never the driveway's
    await ws.close()


async def refusal(w, who, rid, **msg):
    w.use(who)
    ws = await w.m.client.ws_connect("/ws")
    await ws.send_json({"type": "read_subscribe", "id": rid, "msg": {"type": "timeline/subscribe", **msg}})
    m = None
    while m is None or m.get("id") != rid:
        m = await asyncio.wait_for(ws.receive_json(), 3)
    await ws.close()
    return m


async def test_a_subscription_is_refused_without_the_page_and_carries_nothing_else(w):
    for who in ("pip", "gwen"):
        m = await refusal(w, who, 4)
        assert m["type"] == "read_result" and m["error"]["code"] == "not_allowed", m
        assert not w.tl.listeners
    for extra in ({"q": "emma"}, {"actor": "x"}, {"since": 0}):                  # the page's filters aren't the feed's
        m = await refusal(w, "avery", 5, **extra)
        assert m["error"]["code"] == "not_allowed", m
        assert not w.tl.listeners


async def ends(ws, timeout=2.0) -> bool:
    from aiohttp import WSMsgType
    try:
        while True:
            m = await asyncio.wait_for(ws.receive(), timeout)
            if m.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.CLOSING, WSMsgType.ERROR):
                return True
    except asyncio.TimeoutError:
        return False


def session_of(w, name):
    for s in w.app["hub"].sessions:
        ident = s.principal.identity
        if ident.user is not None and ident.user.id == w.uid[name]:
            return ident.session_id
    raise AssertionError("no socket for " + name)


async def test_the_live_feed_closes_when_the_session_is_revoked(w):
    ws, _ = await subscribe(w, "mark")
    assert len(w.tl.listeners) == 1
    w.app["sessions"].revoke(session_of(w, "mark"), "test")
    assert await ends(ws), "a revoked session kept its live timeline"
    await asyncio.sleep(0.05)
    assert w.tl.listeners == []


async def test_the_live_feed_ends_when_the_page_is_taken_away(w):
    from mantel_server.identity.rbac import Grant
    ws, _ = await subscribe(w, "mark")
    assert [e.kind for e in w.app["live"].entries()] == ["hub", "timeline/subscribe"]
    w.app["rbac"].add_grant(Grant(effect="deny", actions=("view",), resource_kind="feature", resource="timeline",
                                  users={w.uid["mark"]}))
    assert await w.app["live"].check() == 1                                 # the policy tick: the subscription only
    assert [e.kind for e in w.app["live"].entries()] == ["hub"] and w.tl.listeners == []
    push(w, "late", family="door", kind="opened", entity="binary_sensor.back_door", area="hall", title="Back Door opened",
         search="back door opened")
    with pytest.raises(asyncio.TimeoutError):
        await read_event(ws, 1, timeout=0.3)                                # nothing more is sent to them
    assert (await w.find("mark"))[0] == 403
    await ws.close()


async def test_the_live_feed_of_a_tablet_closes_when_the_tablet_is_revoked(w):
    ws, _ = await subscribe(w, "tablet")
    w.app["devices"].revoke(w.tablet_id, "test")
    assert await ends(ws)
    assert w.tl.listeners == []


async def test_actor_finds_only_rows_whose_names_the_viewer_may_see(tmp_path):
    """Asking by who did it is seeing who did it (the second Opus review): without `history` of an entity, `actor=`
    never returns its rows, and the "by hand" line isn't shown either."""
    from types import SimpleNamespace as NS
    from mantel_server.timeline.api import Viewer, find
    from mantel_server.timeline.store import Row

    class Fake(Viewer):
        def __init__(self, app):                              # an Adult with view but no history of the lock
            self.app, self.principal, self.authz, self.ctx = app, NS(valid=True), None, None
            self.user, self.device, self.role = NS(id="u-mark"), None, "adult"
            self.limited = self.manager = self.assistant = False
            self._view, self._still, self._history = {}, {}, {}
            self.wall_families, self.pictures = frozenset(), False

        def may_view(self, entity):
            return True

        def may_history(self, entity):
            return entity != "lock.back_door"

    from mantel_server.storage.store import Store
    store = Store(tmp_path / "m.db")
    from mantel_server.timeline.core import Timeline
    hub = NS(store=NS(states={}), registry=NS(areas={}, entries={}, entity_area={}))
    tl = Timeline({"cfg": None}, hub, store.db, clock=lambda: 1_800_000_000.0)
    app = {"timeline": tl, "hub": hub}
    tl.push(Row(src="a", at=1_799_999_000.0, family="lock", kind="unlocked", title="Back Door unlocked",
                entity="lock.back_door", actor="u-emma", actor_name="Emma", how="home"))
    tl.push(Row(src="b", at=1_799_999_100.0, family="lock", kind="locked", title="Side Door locked",
                entity="lock.side_door", actor="u-emma", actor_name="Emma", how="home"))
    tl.push(Row(src="c", at=1_799_999_200.0, family="lock", kind="locked", title="Back Door locked",
                entity="lock.back_door", how="hand_or_automation"))
    tl.flush()
    v = Fake(app)
    got = find(app, v, {"actor": "u-emma"}, 1_800_000_000.0)
    assert [e["title"] for e in got["events"]] == ["Side Door locked"]
    every = find(app, v, {}, 1_800_000_000.0)
    hand = next(e for e in every["events"] if e["title"] == "Back Door locked")
    assert "who" not in hand
    store.db.close()
