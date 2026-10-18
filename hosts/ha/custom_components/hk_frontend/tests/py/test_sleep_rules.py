"""Sleep Screen's rules (sleep_rules.py), held to the house's own cases --
the priority order the generated tablets ran from 2026-09
(hk_house/generator/tablet_want_template.yaml, docs/TABLET-INVARIANTS.md)."""
from __future__ import annotations

from datetime import datetime, time

from custom_components.hk_frontend import sleep_rules as R


def f(**kw):
    base = {"present": False, "in_use": False, "lit": True, "prev": "dark"}
    base.update(kw)
    return base


def test_the_priority_order():
    smoke = f(wake_q=["Smoke"], quiet=True, hold=["Doorbell"], dark=["Away"])
    assert R.decide(smoke) == ("dashboard", "Smoke is on"), "smoke beats everything, quiet hours too"
    assert R.decide(f(quiet=True, present=True))[0] == "dark", "quiet hours: dark in an occupied room"
    assert R.decide(f(quiet=True, in_use=True))[0] == "dashboard", "...but a deliberate tap wakes it"
    assert R.decide(f(quiet=True, app_front=True, app_name="tv"))[0] == "hold", "...and another app in front is left alone"
    assert R.decide(f(quiet=True, hold_q=["Doorbell"]))[0] == "hold", "the doorbell works in quiet hours"
    assert R.decide(f(quiet=True, hold=["Alarm"]))[0] == "dark", "the alarm does not (it is below quiet hours)"
    assert R.decide(f(quiet=True, wake=["Yard"]))[0] == "dark", "nor a Wake for not marked for quiet hours"
    assert R.decide(f(wake=["Yard"], hold=["Alarm"])) == ("dashboard", "Yard is on")
    assert R.decide(f(hold=["Alarm"], app_front=True))[1] == "Alarm is on", "a claim beats another app"
    assert R.decide(f(app_front=True, app_name="com.netflix", awake=["TV"]))[0] == "hold"
    assert R.decide(f(awake=["Live TV"], dark=["Away"])) == ("dashboard", "Live TV is on"), "watching TV beats away"
    assert R.decide(f(dark=["Away"], in_use=True, present=True))[0] == "dark", "away beats somebody at it"


def test_holds_never_guess():
    assert R.decide(f(present=None, prev="photos")) == ("photos", "holding - an input is unavailable")
    assert R.decide(f(present=None, prev="hold"))[0] == "hold"
    assert R.decide(f(present=None, quiet=True, prev="dashboard"))[0] == "dashboard", \
        "a reload in quiet hours does not sleep a tablet somebody was using (bedroom 19:43:37)"
    assert R.decide(f(present=None, wake_q=["Smoke"]))[0] == "dashboard", "claims still beat a missing input"


def test_presence_and_use():
    assert R.decide(f(present=True)) == ("photos", "somebody is in the room")
    assert R.decide(f(in_use=True)) == ("dashboard", "somebody is at the tablet"), "in use needs no presence"
    assert R.decide(f()) == ("dark", "nobody here")
    # Good Night, and After the Screensaver: presence that predates it
    assert R.decide(f(present=True, slept=True, slept_why="Good night"))[0] == "dark"
    assert R.decide(f(present=True, slept=True, in_use=True))[0] == "dashboard", "a tap still lights it"


def test_the_screensaver_in_use():
    # a touch on the screensaver's own controls (its music, its panel) keeps
    # the photos: it is neither a wake nor nobody here
    assert R.decide(f(saver_use=True)) == ("photos", "somebody is using the screensaver")
    assert R.decide(f(saver_use=True, in_use=True))[0] == "dashboard", "a touch of the page is still a wake"
    assert R.decide(f(saver_use=True, quiet=True)) == ("photos", "somebody is using the screensaver"), \
        "quiet hours do not black it under a finger"
    assert R.decide(f(saver_use=True, dark=["Away"]))[0] == "dark", "a Stay Dark While still wins"
    assert R.decide(f(saver_use=True, lit=False, touched_since_dark=False))[0] == "dark"
    assert R.decide(f(saver_use=True, lit=False, touched_since_dark=True))[0] == "photos"


def test_the_lit_gate():
    # Master Bathroom, 2026-09-21: lights off after the last touch -> dark now
    assert R.decide(f(present=True, lit=False)) == ("dark", "the room's lights are off")
    assert R.decide(f(in_use=True, lit=False, touched_since_dark=False))[0] == "dark"
    # touched AFTER the lights went off: somebody using it in a dark room
    assert R.decide(f(in_use=True, lit=False, touched_since_dark=True))[0] == "dashboard"


def test_what_to_do():
    assert R.action("photos", "dashboard") is None, "awake on the dashboard: the photos come by themselves"
    assert R.action("photos", "photos") is None
    assert R.action("photos", "dark") == "wake", "arriving in a dark room wakes it (to the dashboard)"
    assert R.action("dashboard", "photos") == "wake"
    assert R.action("dark", "photos") == "sleep"
    assert R.action("dark", "dark") is None
    assert R.action("hold", "dark") is None and R.action("hold", "dashboard") is None


def test_options():
    d = R.sleep_options(None)
    assert d["decided_by"] == "automation" and d["presence"] == [] and d["linger"] == 60
    good = R.sleep_options({"decided_by": "hk", "presence": ["binary_sensor.a", "binary_sensor.a", "binary_sensor.b"],
                            "quiet_from": "9:5", "after_saver": 30, "bright_day": 200.0})
    assert good["presence"] == ["binary_sensor.a", "binary_sensor.b"] and good["quiet_from"] == "09:05"
    assert good["bright_day"] == 200 and good["dark_display"] == "lowest"
    for bad in ({"decided_by": "me"}, {"presence": ["not an id"]}, {"after_saver": 7}, {"quiet_to": "25:00"},
                {"linger": True}, {"nope": 1}, {"bright_night": 0}, {"bright_sensor": "x"}, "string"):
        assert R.sleep_options(bad) is None, bad
    assert set(R.inputs(good)) == {"binary_sensor.a", "binary_sensor.b"}


def test_on_and_the_schedule():
    assert all(R.is_on(s) for s in ("on", "active", "triggered", "open", "playing"))
    assert not any(R.is_on(s) for s in ("off", "idle", "armed_away", "closed", None, "unavailable"))
    assert R.in_window(time(23, 0), "22:00", "07:00") and R.in_window(time(6, 59), "22:00", "07:00")
    assert not R.in_window(time(7, 0), "22:00", "07:00") and not R.in_window(time(12, 0), "22:00", "07:00")
    assert R.in_window(time(14, 0), "13:00", "15:30") and not R.in_window(time(15, 30), "13:00", "15:30")
    nb = R.next_boundary(datetime(2026, 10, 9, 21, 30), "22:00", "07:00")
    assert nb == datetime(2026, 10, 9, 22, 0)
    nb = R.next_boundary(datetime(2026, 10, 9, 23, 0), "22:00", "07:00")
    assert nb == datetime(2026, 10, 10, 7, 0)


def test_day_and_night_brightness():
    o = R.sleep_options({"brightness": "fixed", "bright_day": 174, "bright_night": 75,
                         "night_while": ["timer.night"], "day_while": ["binary_sensor.vanity_bright"]})
    assert R.brightness_now(o, [], time(23, 0)) == (174, "day"), "not by the clock: day unless Night While"
    assert R.brightness_now(o, ["timer.night"], time(12, 0)) == (75, "night")
    # the Master Bathroom's vanity, turned up bright at night: day
    assert R.brightness_now(o, ["timer.night", "binary_sensor.vanity_bright"], time(2, 0)) == (174, "day")
    clock = dict(o, bright_clock=True, day_from="07:00", night_from="22:00")
    assert R.brightness_now(clock, [], time(23, 30))[1] == "night" and R.brightness_now(clock, [], time(6, 59))[1] == "night"
    assert R.brightness_now(clock, [], time(7, 0))[1] == "day"
    assert R.brightness_now(clock, ["binary_sensor.vanity_bright"], time(23, 30))[1] == "day", "Day While beats the clock"
    assert R.brightness_now(R.sleep_options(None), [], time(12, 0)) == (None, ""), "Leave It"
    assert set(R.inputs(o)) == {"timer.night", "binary_sensor.vanity_bright"}
    assert R.sleep_options({"day_from": "7:5"})["day_from"] == "07:05" and R.sleep_options({"night_from": "x"}) is None
