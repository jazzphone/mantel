"""HomePod timers' rules (hk_core.timers.homepod; docs/phase28/HOMEPOD-TIMERS.md): what the reader says, staleness, one timer
the same timer from read to read, the helper's steps, room matching and alarms. The fictional house's rooms only."""
from datetime import datetime, timezone

import pytest

from hk_core import timers as R
from hk_core.timers import homepod as H

T0 = 1_800_000_000.0


def iso(t):
    return datetime.fromtimestamp(t, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def read(tile="Kitchen-HomePod-TileCell", index=0, label="Timer", left=600.0, paused=False, at=T0, room="Kitchen"):
    return H.Read(tile, index, label, left, paused, None if paused else at + left, room, "HomePod", at)


def known(n=1, tile="Kitchen-HomePod-TileCell", label="Timer", ends=T0 + 600, paused=False, left=0.0):
    return H.Known(n, tile, label, "Kitchen", "HomePod", None if paused else ends, left, paused)


# ---- what the reader says
def test_the_reader_s_timers_are_read_and_bad_rows_left_out():
    doc = {"at": iso(T0), "broken": False, "timers": [
        {"label": "Pasta", "left_s": 300, "ends_at": iso(T0 + 300), "paused": False, "room": "Kitchen", "homepod": "HomePod",
         "tile": "Kitchen-HomePod-TileCell", "index": 0, "read_at": iso(T0 - 2)},
        {"label": "Timer", "left_s": 90, "paused": True, "room": "Den", "tile": "Den-HomePod-TileCell", "index": 0},
        {"label": "x", "left_s": "soon", "tile": "t", "index": 0}, {"tile": "", "index": 0, "left_s": 1}, "junk",
        {"label": "y", "left_s": 5, "tile": "t", "index": True}]}
    broken, rows = H.parse_timers(doc, T0)
    assert broken is False and [(r.label, r.left, r.paused) for r in rows] == [("Pasta", 300.0, False), ("Timer", 90.0, True)]
    assert rows[0].ends == T0 + 300 and rows[1].ends is None and rows[1].left_at(T0 + 500) == 90.0
    assert H.parse_timers({"broken": True, "timers": []}, T0) == (True, [])
    assert H.parse_timers({"nothing": 1}, T0) is None and H.parse_timers([], T0) is None


def test_an_alarm_has_an_id_that_survives_its_row_moving():
    def doc(*rows):
        return {"alarms": [dict(r, index=i) for i, r in enumerate(rows)]}
    a = {"label": "Alarm", "time": "6:30 AM", "time_24": "06:30", "enabled": True, "room": "Den", "tile": "Den-HomePod-TileCell"}
    b = {"label": "Alarm", "time": "9:00 PM", "time_24": "21:00", "enabled": False, "repeats": "Weekdays", "room": "Den", "tile": "Den-HomePod-TileCell"}
    _, first = H.parse_alarms(doc(a, b))
    _, later = H.parse_alarms(doc(b))                    # the 6:30 one deleted: the 9:00 one moved up a row
    assert first[1].id == later[0].id and later[0].index == 0 and first[0].id != first[1].id
    assert H.find_alarm(later, first[1].id) is later[0] and H.find_alarm(later, first[0].id) is None
    _, bad = H.parse_alarms({"alarms": [dict(a, index=0, time_24="25:00"), dict(a, index=-1)]})
    assert bad == []
    _, two = H.parse_alarms(doc(a, a))                   # two alike: told apart by their order
    assert two[0].id != two[1].id


# ---- staleness: unavailable, never "no timers"
def test_a_reader_that_is_broken_or_silent_is_unavailable():
    assert H.availability(None, False, T0, T0 + 5) == "starting"
    assert H.availability(None, False, T0, T0 + H.STALE_AFTER + 1) == "unavailable"
    assert H.availability(T0, False, T0, T0 + H.STALE_AFTER) == "ok"
    assert H.availability(T0, False, T0, T0 + H.STALE_AFTER + 1) == "unavailable"
    assert H.availability(T0 + 100, True, T0, T0 + 101) == "unavailable"
    assert not H.alert_due(None, T0) and not H.alert_due(T0, T0 + H.ALERT_AFTER - 1) and H.alert_due(T0, T0 + H.ALERT_AFTER)


# ---- identity from one read to the next
def test_the_same_timer_read_again_is_the_same_timer():
    k = known(ends=T0 + 600)
    pairs, new, gone = H.match([k], [read(left=598, at=T0 + 2)])          # two seconds on, the same end
    assert pairs == [(k, pairs[0][1])] and not new and not gone


def test_rows_that_move_keep_their_timers():
    pasta, rice = known(1, label="Pasta", ends=T0 + 300), known(2, label="Rice", ends=T0 + 900)
    # the pasta's row ended above it: rice is index 0 now
    pairs, new, gone = H.match([pasta, rice], [read(index=0, label="Rice", left=890, at=T0 + 10)])
    assert [(k.n, r.label) for k, r in pairs] == [(2, "Rice")] and gone == [pasta] and not new


def test_two_timers_with_one_label_are_told_apart_by_their_ends():
    a, b = known(1, ends=T0 + 120), known(2, ends=T0 + 1200)
    reads = [read(index=0, left=1190, at=T0 + 10), read(index=1, left=110, at=T0 + 10)]
    pairs, new, gone = H.match([a, b], reads)
    assert {k.n: r.index for k, r in pairs} == {1: 1, 2: 0} and not new and not gone


def test_a_pause_or_a_resume_between_reads_is_the_same_timer():
    k = known(ends=T0 + 600)
    pairs, new, gone = H.match([k], [read(left=560, paused=True, at=T0 + 30)])    # paused 20 s before this read
    assert len(pairs) == 1 and not new and not gone
    k.take(pairs[0][1])
    assert k.paused and k.ends is None and k.left == 560
    pairs, new, gone = H.match([k], [read(left=560, at=T0 + 400)])                 # resumed much later
    assert len(pairs) == 1 and not new and not gone


def test_a_new_timer_on_the_same_homepod_is_new():
    k = known(ends=T0 + 600)
    pairs, new, gone = H.match([k], [read(index=0, left=590, at=T0 + 10), read(index=1, label="Eggs", left=420, at=T0 + 10)])
    assert len(pairs) == 1 and [r.label for r in new] == ["Eggs"] and not gone
    other = H.match([k], [read(tile="Den-HomePod-TileCell", left=590, at=T0 + 10)])     # another HomePod's: never this one
    assert other[0] == [] and len(other[1]) == 1 and other[2] == [k]


def test_a_timer_over_is_never_matched_again():
    k = known(ends=T0 + 600)
    k.over = "canceled"
    assert H.match([k], [read(left=590, at=T0 + 10)])[0] == []


def test_gone_at_its_end_it_ended_and_before_it_was_canceled():
    assert H.how_gone(known(ends=T0 + 3), T0) == "ended"          # the HomePod rang: its helper finishes by itself
    assert H.how_gone(known(ends=T0 + 120), T0) == "canceled"
    assert H.how_gone(known(paused=True, left=30), T0) == "canceled"
    assert H.next_number([1, 2, 4]) == 3


# ---- keeping a helper in step
def test_a_new_helper_starts_at_what_is_left_and_pauses_if_paused():
    assert H.steps(None, known(ends=T0 + 600), T0) == [("start", {"duration": "00:10:00"})]
    assert H.steps(None, known(paused=True, left=95), T0) == [("start", {"duration": "00:01:35"}), ("pause", {})]
    assert H.steps({"s": "idle"}, known(ends=T0 + 61), T0) == [("start", {"duration": "00:01:01"})]


def test_a_helper_in_step_is_left_alone_and_one_out_of_step_is_moved():
    h = {"s": "active", "ends": T0 + 601, "remaining": None, "duration": 900.0}
    assert H.steps(h, known(ends=T0 + 600), T0) == []                                   # within SYNC_TOL
    assert H.steps(dict(h, ends=T0 + 650), known(ends=T0 + 600), T0) == [("change", {"duration": "-00:00:50"})]
    # beyond its length Home Assistant refuses a change: a restart at what is left
    assert H.steps(dict(h, ends=T0 + 100, duration=120.0), known(ends=T0 + 600), T0) == [("start", {"duration": "00:10:00"})]
    assert H.steps(h, known(paused=True, left=600), T0) == [("pause", {})]


def test_a_paused_helper_resumes_when_the_homepod_does():
    h = {"s": "paused", "ends": None, "remaining": 300.0, "duration": 600.0}
    assert H.steps(h, known(ends=T0 + 300), T0) == [("start", {})]
    assert H.steps(h, known(ends=T0 + 200), T0) == [("start", {}), ("change", {"duration": "-00:01:40"})]
    assert H.steps(h, known(paused=True, left=301), T0) == []
    assert H.steps(h, known(paused=True, left=200), T0) == [("start", {"duration": "00:03:20"}), ("pause", {})]


def test_a_timer_at_its_end_is_left_for_home_assistant_to_finish():
    assert H.steps({"s": "active", "ends": T0 + 30, "duration": 60.0}, known(ends=T0 + 0.5), T0) == []
    assert H.steps(None, known(ends=T0 - 3), T0) == []


def test_home_assistant_s_times_are_read():
    got = H.helper_now({"s": "paused", "a": {"remaining": "0:04:05", "duration": "0:10:00"}})
    assert got == {"s": "paused", "ends": None, "remaining": 245.0, "duration": 600.0}
    assert H.helper_now(None) is None and H.secs("soon") is None and H.hms(-5, signed=True) == "-00:00:05"


# ---- never ringing in Mantel
def test_a_homepod_helper_shows_but_is_never_mantel_s_own():
    assert R.counts("timer.hk_homepod_3") and R.is_homepod("timer.hk_homepod_3") and not R.is_made("timer.hk_homepod_3")
    assert not R.is_homepod("timer.hk_timer_3") and H.is_helper("timer.hk_homepod_12") and not H.is_helper("timer.hk_homepod_x")
    states = {"timer.hk_homepod_1": {"s": "active", "a": {"finishes_at": "2026-11-12T20:00:00+00:00", "friendly_name": "Pasta"}}}
    n, a = R.sensor_attributes(states)
    assert n == 1 and a["made"] == ["timer.hk_homepod_1"] and a["running"][0]["name"] == "Pasta"


# ---- rooms
AREAS = {"kitchen": "Kitchen", "den": "Den", "sams_room": "Sam's Room", "loft": "Loft"}


@pytest.mark.parametrize("home,area,how", [
    ("Kitchen", "kitchen", "name"), ("kitchen", "kitchen", "name"), ("Sam’s Room", "sams_room", "name"),
    ("Sams Room", "sams_room", "name"), ("  Den ", "den", "name"), ("Garage", None, "none"), ("", None, "none")])
def test_a_home_app_room_is_matched_by_name(home, area, how):
    assert H.room_for(home, AREAS) == (area, how)


def test_the_owner_s_choice_wins_and_a_bad_one_is_ignored():
    assert H.room_for("Garage", AREAS, {"Garage": "loft"}) == ("loft", "chosen")
    assert H.room_for("Kitchen", AREAS, {"kitchen": "den"}) == ("den", "chosen")
    assert H.room_for("Kitchen", AREAS, {"Kitchen": "gone"}) == ("kitchen", "name")
    table = H.room_table(["Kitchen", "Garage", "Kitchen", ""], AREAS, {})
    assert table == [{"home": "Garage", "area": None, "area_name": None, "how": "none"},
                     {"home": "Kitchen", "area": "kitchen", "area_name": "Kitchen", "how": "name"}]
    assert H.clean_rooms({"Garage": "loft", "X": "nowhere", 3: "den"}, AREAS) == {"Garage": "loft"}


# ---- alarms
def alarm(time_24="07:00", enabled=True, repeats="", tile="Den-HomePod-TileCell", label="Alarm"):
    a = H.Alarm(tile, 0, label, time_24, time_24, enabled, repeats, "Den", "HomePod")
    return H.alarm_ids([a])[0]


@pytest.mark.parametrize("text,days", [("", None), ("Every Day", set(range(7))), ("Weekdays", set(range(5))),
                                       ("Weekends", {5, 6}), ("Mon, Wed, Fri", {0, 2, 4}), ("Sun Sat", {5, 6}),
                                       ("Sometimes", set(range(7)))])
def test_a_repeat_line_is_read(text, days):
    got = H.repeat_days(text)
    assert (got is None and days is None) or set(got) == days


def test_the_next_alarm_of_each_homepod():
    wed = datetime(2026, 11, 11, 8, 0)                       # a Wednesday, 8:00
    assert H.next_ring(alarm("07:00"), wed) == datetime(2026, 11, 12, 7, 0)       # one-time: tomorrow
    assert H.next_ring(alarm("09:00"), wed) == datetime(2026, 11, 11, 9, 0)
    assert H.next_ring(alarm("07:00", repeats="Weekends"), wed) == datetime(2026, 11, 14, 7, 0)
    assert H.next_ring(alarm("07:00", enabled=False), wed) is None
    got = H.next_alarms([alarm("07:00"), alarm("09:00", label="Late"), alarm("06:00", enabled=False, tile="Loft-HomePod-TileCell")], wed)
    assert got["Den-HomePod-TileCell"][0].label == "Late" and got["Loft-HomePod-TileCell"] is None


def test_a_one_time_alarm_that_turned_off_at_its_time_went_off():
    on, off = alarm("07:00"), alarm("07:00", enabled=False)
    assert H.went_off([on], [off], datetime(2026, 11, 11, 7, 1)) == [off]
    assert H.went_off([on], [off], datetime(2026, 11, 11, 12, 0)) == []              # turned off by hand
    rep_on, rep_off = alarm("07:00", repeats="Weekdays"), alarm("07:00", enabled=False, repeats="Weekdays")
    assert H.went_off([rep_on], [rep_off], datetime(2026, 11, 11, 7, 1)) == []      # a repeating one stays on when it rings
    assert H.slug("Sam’s Room HomePod") == "sams_room_homepod"


# ---- a timer that went off (2026-11-13, the house's kitchen): the Home app shows it back at its full length while it rings
def test_a_ringing_timer_is_read_as_ringing_at_its_own_end():
    doc = {"at": iso(T0 + 3), "timers": [{"id": "t-1", "label": "Timer", "left_s": 0, "ringing": True, "ends_at": iso(T0), "rang_at": iso(T0),
                                          "paused": False, "room": "Kitchen", "tile": "Kitchen-HomePod-TileCell", "index": 0}]}
    _, (r,) = H.parse_timers(doc, T0 + 3)
    assert r.ringing and r.rid == "t-1" and r.ends == T0 and r.left == 0 and r.left_at(T0 + 30) == 0 and r.rang_at == T0


def test_ringing_is_the_same_timer_and_never_moves_its_helper():
    k = known(ends=T0 + 1)
    ring = H.Read("Kitchen-HomePod-TileCell", 0, "Timer", 0.0, False, T0 + 60, "Kitchen", "HomePod", T0 + 5, "", True, T0 + 1)
    pairs, new, gone = H.match([k], [ring])              # (an end the Home app shows back at its full length: still this one)
    assert len(pairs) == 1 and not new and not gone
    k.take(ring)
    assert k.ringing and k.ends == T0 + 1                # the end it had, not a new countdown
    assert H.steps({"s": "active", "ends": T0 + 6, "duration": 60.0}, k, T0 + 5) == []
    assert H.steps({"s": "idle"}, k, T0 + 9) == []
    assert H.how_gone(k, T0 + 300) == "ended"            # stopped while ringing: it ended, its helper finished


def test_the_reader_s_id_wins():
    a, b = known(1, ends=T0 + 100), known(2, ends=T0 + 100)
    a.rid, b.rid = "t-a", "t-b"
    reads = [H.Read("Kitchen-HomePod-TileCell", i, "Timer", 90.0, False, T0 + 100, "Kitchen", "HomePod", T0 + 10, rid) for i, rid in enumerate(("t-b", "t-a"))]
    pairs, new, gone = H.match([a, b], reads)
    assert {k.n: r.rid for k, r in pairs} == {1: "t-a", 2: "t-b"} and not new and not gone
    assert "stop" in H.TIMER_ACTIONS


def test_a_ringing_homepod_timer_s_speakers_are_also_play_in_s_but_its_own_room_s():
    rooms = [("media_player.kitchen", "kitchen"), ("media_player.den", "den"), ("media_player.porch", None)]
    assert H.ring_speakers("kitchen", ["all"], rooms) == ["media_player.den", "media_player.porch"]
    assert H.ring_speakers("kitchen", ["den", "kitchen"], rooms) == ["media_player.den"]
    assert H.ring_speakers("kitchen", [], rooms) == []                       # Also Play In off: the HomePod alone
    assert H.ring_speakers(None, ["all"], rooms) == [e for e, _a in rooms]   # its room not matched: nothing to leave out
    assert H.ring_until(100.0, 900.0, 60) == 160.0 and H.ring_until(None, 900.0, 60) == 960.0
