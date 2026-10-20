"""The Lights page's "Tonight" list (page_headers.py, ported from HK Frontend's): the triggers of a house's
lighting automations, the branch each runs, what it switches, and whether its conditions hold now, answered
to Mantel by `mantel/page_headers/get` (admin only). Fictional automations only."""
from __future__ import annotations

import pytest

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component

from custom_components.mantel import page_headers as P

YARD = {"alias": "Lighting - Yard - Schedule", "triggers": [
            {"trigger": "sun", "event": "sunset", "offset": "-00:15:00", "id": "dusk"},
            {"trigger": "time", "at": "22:00:00", "id": "late"}],
        "actions": [{"choose": [
            {"conditions": [{"condition": "trigger", "id": "dusk"}],
             "sequence": [{"action": "light.turn_on", "target": {"entity_id": ["light.yard", "light.path"]}}]},
            {"conditions": [{"condition": "trigger", "id": "late"}],
             "sequence": [{"action": "light.turn_off", "target": {"entity_id": "light.yard"}}]}]}]}
PORCH = {"alias": "Porch at dusk", "triggers": [{"trigger": "sun", "event": "sunset"}],
         "conditions": [{"condition": "state", "entity_id": "person.someone", "state": "home"}],
         "actions": [{"action": "light.turn_on", "target": {"entity_id": "light.porch"}}]}
ODD = {"alias": "Odd", "triggers": [{"trigger": "time", "at": "21:00"}],
       "conditions": [{"condition": "template", "value_template": "{{ trigger.now.hour > 1 }}"}],
       "actions": [{"action": "switch.turn_off", "target": {"entity_id": "switch.fountain"}}]}
MUSIC = {"alias": "Music at seven", "triggers": [{"trigger": "time", "at": "07:00"}],
         "actions": [{"action": "media_player.media_play", "target": {"entity_id": "media_player.x"}}]}


def test_the_pure_pieces() -> None:
    assert P.offset_s("-00:15:00") == -900 and P.offset_s({"hours": 1, "minutes": 30}) == 5400
    assert P.offset_s("soon") == 0 and P.offset_s(True) == 0
    assert P.trigger_times({"trigger": "time", "at": ["7:05", "input_datetime.wake"]}) == \
        [{"kind": "time", "at": "07:05"}, {"kind": "time", "entity": "input_datetime.wake"}]
    assert P.trigger_times({"trigger": "state", "entity_id": "x.y"}) == []
    assert P.label_of("Lighting - Yard - Schedule") == "Yard" and P.label_of("Porch at dusk") == ""
    seq, extra = P.branch_for(YARD["actions"], "late")
    assert seq == [{"action": "light.turn_off", "target": {"entity_id": "light.yard"}}] and extra == []


async def test_the_schedule_and_its_conditions(hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(P, "_automations", lambda h: [("automation.yard", YARD), ("automation.porch", PORCH),
                                                      ("automation.odd", ODD), ("automation.music", MUSIC)])
    hass.states.async_set("person.someone", "not_home")
    got = await P.schedule(hass)
    rows = {(e["automation"], e.get("event") or e.get("at")): e for e in got}
    assert set(rows) == {("automation.yard", "sunset"), ("automation.yard", "22:00"), ("automation.porch", "sunset"),
                         ("automation.odd", "21:00")}, "no row for what switches no light"
    dusk = rows[("automation.yard", "sunset")]
    assert (dusk["effect"], dusk["entities"], dusk["offset_s"], dusk["area"], dusk["ready"]) == \
        ("on", ["light.path", "light.yard"], -900, "Yard", True)
    assert rows[("automation.yard", "22:00")]["effect"] == "off"
    assert rows[("automation.porch", "sunset")]["ready"] is False, "someone isn't home"
    assert rows[("automation.odd", "21:00")]["ready"] is None, "needs the trigger: not judged"
    assert not any("_conditions" in e or "actions" in e for e in got), "never the configuration itself"
    hass.states.async_set("person.someone", "home")
    assert {e["automation"]: e for e in await P.schedule(hass)}["automation.porch"]["ready"] is True


async def test_mantel_asks_with_its_admin_credential(hass, hass_ws_client, hass_admin_user, monkeypatch) -> None:
    monkeypatch.setattr(P, "_automations", lambda h: [("automation.yard", YARD)])
    assert await async_setup_component(hass, "mantel", {})
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "mantel/page_headers/get"})
    got = await ws.receive_json()
    assert got["success"] and len(got["result"]["lights"]["schedule"]) == 2
    hass_admin_user.groups = []
    await ws.send_json({"id": 2, "type": "mantel/page_headers/get"})
    got = await ws.receive_json()
    assert not got["success"] and got["error"]["code"] == "unauthorized"
