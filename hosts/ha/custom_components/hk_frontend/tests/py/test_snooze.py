"""Off Until Tomorrow (snooze.py): an automation turned off now and on again
at the time kept -- through a restart, and forgotten when turned on or off by
hand."""
from __future__ import annotations

from datetime import timedelta

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.util import dt as dt_util

from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.hk_frontend import snooze as S


def _fake_automation(hass: HomeAssistant, calls: list[str]) -> None:
    async def turn(call: ServiceCall) -> None:
        for eid in call.data["entity_id"] if isinstance(call.data["entity_id"], list) else [call.data["entity_id"]]:
            calls.append(f"{call.service}:{eid}")
            hass.states.async_set(eid, "on" if call.service == "turn_on" else "off")
    hass.services.async_register("automation", "turn_on", turn)
    hass.services.async_register("automation", "turn_off", turn)


def test_next_midnight() -> None:
    now = dt_util.as_local(dt_util.parse_datetime("2026-10-16T18:30:00-04:00"))
    m = S.next_midnight(now)
    assert (m.hour, m.minute, m.day) == (0, 0, 17)


async def test_pause_and_back_on(hass: HomeAssistant) -> None:
    calls: list[str] = []
    _fake_automation(hass, calls)
    hass.states.async_set("automation.porch", "on")
    s = S.Snoozes(hass)
    at = dt_util.utcnow() + timedelta(hours=1)
    await s.pause("automation.porch", at)
    assert hass.states.get("automation.porch").state == "off"
    assert "automation.porch" in s.payload()
    async_fire_time_changed(hass, at + timedelta(seconds=1))
    await hass.async_block_till_done()
    assert hass.states.get("automation.porch").state == "on"
    assert s.payload() == {}
    s.stop()


async def test_by_hand_ends_the_pause(hass: HomeAssistant) -> None:
    calls: list[str] = []
    _fake_automation(hass, calls)
    hass.states.async_set("automation.porch", "on")
    s = S.Snoozes(hass)
    hass.bus.async_listen("state_changed", s.state_changed)
    await s.pause("automation.porch", None)
    await hass.async_block_till_done()
    assert "automation.porch" in s.payload()          # our own turn-off kept it
    hass.states.async_set("automation.porch", "on")   # turned on by hand
    await hass.async_block_till_done()
    assert s.payload() == {}
    s.stop()


async def test_kept_through_restart(hass: HomeAssistant) -> None:
    calls: list[str] = []
    _fake_automation(hass, calls)
    hass.states.async_set("automation.a", "off")
    hass.states.async_set("automation.b", "off")
    past = (dt_util.utcnow() - timedelta(minutes=5)).isoformat()
    later = (dt_util.utcnow() + timedelta(hours=3)).isoformat()
    s = S.Snoozes(hass)
    await s.store.async_save({"until": {"automation.a": past, "automation.b": later}})
    await s.load()
    assert hass.states.get("automation.a").state == "on"     # past its time: on at once
    assert set(s.payload()) == {"automation.b"}             # the other timed again
    await s.resume("automation.b")
    assert hass.states.get("automation.b").state == "on" and s.payload() == {}
    s.stop()
