"""The page headers' server side (page_headers.py): Tonight's lighting
schedule, read from a sample house's automations (fixtures/
sample_automations.json, four sun and time
automations -- the back garden's schedule, its seasonal schedule, the overnight
thermostat and the interior evening lights) -- the triggers, the branch each runs, what it switches, and whether
its conditions hold now."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from homeassistant.core import HomeAssistant

from custom_components.hk_frontend import page_headers as P

HOUSE = json.loads((Path(__file__).parents[1] / "fixtures" / "sample_automations.json").read_text())


def test_offsets() -> None:
    assert P.offset_s("-00:15:00") == -900
    assert P.offset_s("+00:30:00") == 1800
    assert P.offset_s("1:00") == 3600
    assert P.offset_s(90) == 90
    assert P.offset_s({"hours": 1, "minutes": 30}) == 5400
    assert P.offset_s(None) == 0 and P.offset_s("soon") == 0 and P.offset_s(True) == 0


def test_trigger_times() -> None:
    assert P.trigger_times({"trigger": "sun", "event": "sunset", "offset": "-00:15:00"}) == \
        [{"kind": "sun", "event": "sunset", "offset_s": -900}]
    assert P.trigger_times({"platform": "time", "at": "22:00:00"}) == [{"kind": "time", "at": "22:00"}]
    assert P.trigger_times({"trigger": "time", "at": ["7:05", "input_datetime.wake"]}) == \
        [{"kind": "time", "at": "07:05"}, {"kind": "time", "entity": "input_datetime.wake"}]
    # not a schedule: a state trigger, a disabled one, a sun trigger with no event
    assert P.trigger_times({"trigger": "state", "entity_id": "x.y"}) == []
    assert P.trigger_times({"trigger": "time", "at": "22:00", "enabled": False}) == []
    assert P.trigger_times({"trigger": "sun"}) == []


def test_label() -> None:
    assert P.label_of("Lighting - Back Garden - Evening Lights") == "Back Garden"
    assert P.label_of("Porch lights at dusk") == ""


def _rows(eid: str) -> list[tuple[str | None, str, list[str]]]:
    raw = HOUSE[eid]
    acts = raw.get("actions", raw.get("action"))
    out = []
    for t in raw.get("triggers", raw.get("trigger")):
        if not P.trigger_times(t):
            continue
        tid = str(t["id"]) if t.get("id") is not None else None
        seq, _extra = P.branch_for(acts, tid)
        fx = P.effects(seq if seq is not None else acts)
        out.append((tid, "on" if len(fx["on"]) >= len(fx["off"]) and fx["on"] else "off" if fx["off"] else "-",
                    sorted(x for x in fx["on"] | fx["off"] if isinstance(x, str))))
    return out


def test_garden_branches() -> None:
    """Four triggers, each its own choose option: on at sunset, off at eleven,
    on before sunrise, off after -- read from the branch, not the whole list."""
    rows = {r[0]: r for r in _rows("automation.lighting_back_garden_evening_lights")}
    assert rows["sunset_on"][1] == "on" and "light.garden_path_lights" in rows["sunset_on"][2]
    assert rows["sunset_off"][1] == "off" and "light.pergola_string_lights" in rows["sunset_off"][2]
    assert rows["sunrise_on"][1] == "on"
    assert rows["sunrise_off"][1] == "off"


def test_no_light_actions_no_row() -> None:
    """The seasonal schedule picks playlists and runs scripts: nothing it does
    turns a light on or off by name, so it is not on the schedule."""
    assert all(r[1] == "-" for r in _rows("automation.lighting_back_garden_seasonal_schedule"))
    # nor is a thermostat's overnight setting
    assert all(r[1] == "-" for r in _rows("automation.climate_home_set_sleep_temp"))


def test_effects_targets() -> None:
    fx = P.effects([{"parallel": [
        {"action": "light.turn_on", "target": {"entity_id": ["light.a", "light.b"], "area_id": "porch"}},
        {"service": "switch.turn_off", "entity_id": "switch.c"},
        {"action": "light.turn_on", "target": {"entity_id": "{{ states('x') }}"}},
        {"if": [{"condition": "state", "entity_id": "x", "state": "on"}],
         "then": [{"action": "homeassistant.turn_off", "target": {"label_id": "outside"}}]},
        {"action": "notify.notify", "data": {"message": "hi"}}]}])
    assert fx["on"] == {"light.a", "light.b", ("area", "porch")}
    assert fx["off"] == {"switch.c", ("label", "outside")}


def test_branch_or_trigger_condition() -> None:
    acts = [{"choose": [
        {"conditions": [{"condition": "or", "conditions": [{"condition": "trigger", "id": "a"},
                                                           {"condition": "trigger", "id": "b"}]},
                        {"condition": "state", "entity_id": "person.x", "state": "home"}],
         "sequence": [{"action": "light.turn_on", "target": {"entity_id": "light.x"}}]}],
        "default": [{"action": "light.turn_off", "target": {"entity_id": "light.x"}}]}]
    seq, extra = P.branch_for(acts, "b")
    assert seq == [{"action": "light.turn_on", "target": {"entity_id": "light.x"}}]
    assert extra == [{"condition": "state", "entity_id": "person.x", "state": "home"}]
    assert P.branch_for(acts, "zzz") == (None, [])


async def test_plan_and_conditions(hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch) -> None:
    """The whole pass on the sample house's automations: rows only for lights, and a
    row whose condition fails now is ready False until it holds."""
    monkeypatch.setattr(P, "_automations", lambda h: sorted(HOUSE.items()))
    hass.states.async_set("person.alex", "not_home")
    entries = P.plan(hass)
    autos = {e["automation"] for e in entries}
    assert "automation.lighting_back_garden_evening_lights" in autos
    assert "automation.lighting_back_garden_seasonal_schedule" not in autos
    fy = [e for e in entries if e["automation"].endswith("back_garden_evening_lights")]
    assert {(e.get("event") or e.get("at"), e["effect"]) for e in fy} == \
        {("sunset", "on"), ("23:00", "off"), ("sunrise", "on"), ("sunrise", "off")}
    assert all(e["area"] == "Back Garden" for e in fy)

    sched = P.Schedule(hass)
    out = await sched.ensure()
    assert all(set(e) >= {"automation", "kind", "effect", "entities", "ready"} for e in out)
    assert not any("_conditions" in e for e in out)
    sched.stop()


async def test_condition_ready(hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch) -> None:
    raw = {"alias": "Lighting - Porch - Dusk", "triggers": [{"trigger": "sun", "event": "sunset", "id": "dusk"}],
           "conditions": [{"condition": "state", "entity_id": "person.a", "state": "home"}],
           "actions": [{"action": "light.turn_on", "target": {"entity_id": "light.porch"}}]}
    trig = {"alias": "Lighting - Porch - Odd", "triggers": [{"trigger": "time", "at": "21:00"}],
            "conditions": [{"condition": "template", "value_template": "{{ trigger.now.hour > 1 }}"}],
            "actions": [{"action": "light.turn_off", "target": {"entity_id": "light.porch"}}]}
    monkeypatch.setattr(P, "_automations", lambda h: [("automation.a", raw), ("automation.b", trig)])
    hass.states.async_set("person.a", "not_home")
    sched = P.Schedule(hass)
    out = {e["automation"]: e for e in await sched.ensure()}
    assert out["automation.a"]["ready"] is False
    assert out["automation.b"]["ready"] is None           # needs the trigger: not judged
    hass.states.async_set("person.a", "home")
    assert {e["automation"]: e for e in sched.payload()}["automation.a"]["ready"] is True
    sched.stop()


def test_header_settings() -> None:
    """settings.headers.<page>: each key checked, the rest its default; a
    wrong kind of entity, a number out of range or an unknown key refused."""
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend import settings_api as A
    opts, errs = A.apply_house({}, {"headers.lights": {"rooms": 4, "automations": ["automation.a"], "show": False}})
    assert not errs
    got = S.merged(opts)["headers"]["lights"]
    assert got["rooms"] == 4 and got["automations"] == ["automation.a"] and got["show"] is False
    assert got["after_min"] == 10 and got["left_on"] is True           # untouched: the defaults
    assert S.merged({})["headers"]["security"]["low_battery"] == 20
    for bad in ({"rooms": 9}, {"rooms": True}, {"automations": ["light.a"]}, {"nope": 1}, {"after_min": 1}):
        _o, e = A.apply_house({}, {"headers.lights": bad})
        assert "headers.lights" in e, bad
    _o, e = A.apply_house({}, {"headers.security": {"front_door": ["lock.front", "binary_sensor.front"], "low_battery": 25}})
    assert not e
    _o, e = A.apply_house({}, {"headers.security": {"front_door": ["light.x"]}})
    assert e == {"headers.security": "entity"}
    _o, e = A.apply_house({}, {"headers.lights": {"sky_follow": False, "sky_source": ["switch.adaptive_lighting_default"]}})
    assert not e
    _o, e = A.apply_house({}, {"headers.lights": {"sky_source": ["light.a"]}})
    assert e == {"headers.lights": "entity"}
    _o, e = A.apply_house({}, {"headers.climate": {"thermostats": ["climate.a"]}})
    assert not e


def test_utility_header_settings() -> None:
    """The Water, Timers and Vacuums headers (2026-10-16, Pages): a meter, a
    supply valve, Quick Start's durations and names, the mission counters --
    each checked; None is Automatic."""
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend import settings_api as A
    m = S.merged({})["headers"]
    assert m["water"] == {"show": True, "meter": None, "supply": None}
    assert m["timers"]["presets"] == [5, 10, 15, 20, 30, 60] and len(m["timers"]["names"]) == 6
    assert m["vacuums"] == {"show": True, "counters": None}
    # the defaults are never shared with what is merged
    m["timers"]["presets"].append(90)
    assert S.HEADERS["timers"]["presets"] == [5, 10, 15, 20, 30, 60]
    o, e = A.apply_house({}, {"headers.water": {"meter": "sensor.water_meter", "supply": "valve.main"},
                              "headers.timers": {"presets": [3, 45], "names": [" Eggs ", "Nap"]},
                              "headers.vacuums": {"counters": ["sensor.r_successful_missions"]}})
    assert not e
    got = S.merged(o)["headers"]
    assert got["water"]["supply"] == "valve.main" and got["water"]["show"] is True
    assert got["timers"] == {"show": True, "presets": [3, 45], "names": ["Eggs", "Nap"]}
    assert got["vacuums"]["counters"] == ["sensor.r_successful_missions"]
    _o, e = A.apply_house({}, {"headers.water": {"supply": "switch.main_water"}})
    assert not e, "a supply may be a switch"
    for page, bad in (("water", {"meter": "light.a"}), ("water", {"supply": ["valve.main"]}),
                      ("timers", {"presets": []}), ("timers", {"presets": [5, 5]}), ("timers", {"presets": [0]}),
                      ("timers", {"presets": [1, 2, 3, 4, 5, 6, 7]}), ("timers", {"names": ["x" * 17]}),
                      ("timers", {"names": [""]}), ("vacuums", {"counters": ["vacuum.r"]}), ("vacuums", {"nope": 1})):
        _o, e = A.apply_house({}, {"headers." + page: bad})
        assert "headers." + page in e, (page, bad)


def test_a_screen_turns_a_header_off() -> None:
    """A screen's own page headers (boards.<screen>.headers): {page: False}
    for each it turns off; missing is Same as All Screens."""
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend import settings_api as A
    assert S.board({})["headers"] == {}
    b, e = A.apply_board({}, {"headers": {"water": False, "timers": False}})
    assert not e and S.board(b)["headers"] == {"water": False, "timers": False}
    for bad in ({"water": True}, {"garden": False}, ["water"]):
        _b, e = A.apply_board({}, {"headers": bad})
        assert e == {"headers": "choice"}, bad
    # stored junk is dropped as read
    assert S.board({"headers": {"water": False, "nope": False, "lights": 1}})["headers"] == {"water": False}


def test_calendar_colors_settings() -> None:
    """Colors by keyword and an event's own color: checked, the rest refused."""
    from custom_components.hk_frontend import settings as S
    from custom_components.hk_frontend import settings_api as A
    o, e = A.apply_house({}, {"calendar.keywords": [{"word": " Doctor ", "color": "red"}],
                              "calendar.event_colors": {"uid:abc": "teal", "title:dentist": "blue"}})
    assert not e
    cal = S.merged(o)["calendar"]
    assert cal["keywords"] == [{"word": "Doctor", "color": "red"}] and cal["event_colors"]["uid:abc"] == "teal"
    for bad in ({"calendar.keywords": [{"word": "", "color": "red"}]}, {"calendar.keywords": [{"word": "x", "color": "beige"}]},
                {"calendar.event_colors": {"nope": "red"}}, {"calendar.event_colors": {"uid:a": "beige"}}):
        _o, e = A.apply_house({}, bad)
        assert e, bad


async def test_calendar_color_ws(hass, hass_ws_client) -> None:
    """hk_frontend/calendar/color: any user, calendar.event_colors only."""
    from pytest_homeassistant_custom_component.common import MockConfigEntry
    from homeassistant.setup import async_setup_component
    from custom_components.hk_frontend.const import DOMAIN
    from custom_components.hk_frontend import settings as S
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, data={}, options={})
    entry.add_to_hass(hass)
    from custom_components.hk_frontend import panel
    from homeassistant.components import websocket_api
    websocket_api.async_register_command(hass, panel.ws_calendar_color)
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "hk_frontend/calendar/color", "key": "uid:abc", "color": "teal"})
    r = await ws.receive_json()
    assert r["success"], r
    assert S.merged(entry.options)["calendar"]["event_colors"] == {"uid:abc": "teal"}
    await ws.send_json({"id": 2, "type": "hk_frontend/calendar/color", "key": "uid:abc", "color": None})
    r = await ws.receive_json()
    assert r["success"] and S.merged(entry.options)["calendar"]["event_colors"] == {}
