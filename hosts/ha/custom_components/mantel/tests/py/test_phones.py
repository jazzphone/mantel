"""The Companion app's phones (phones.py; slice 9.7): Mantel Link tells Mantel which phones Home Assistant can
notify, carries out Mantel's `phone_notify` for exactly those (a Companion-app notify service, the known fields
only), and sends a Dismiss tapped on a phone back to Mantel."""
from __future__ import annotations

from pytest_homeassistant_custom_component.common import MockConfigEntry

from conftest import linked
from mantel_fake import until

PHONE = "mobile_app_avery_s_iphone"


def a_phone(hass):
    calls = []
    MockConfigEntry(domain="mobile_app", data={"device_name": "Avery's iPhone"}, title="Avery's iPhone").add_to_hass(hass)

    async def notify(call):
        calls.append(dict(call.data))
    hass.services.async_register("notify", PHONE, notify)
    hass.services.async_register("notify", "persistent_notification", notify)
    return calls


async def test_phones_are_reported_and_followed(hass, mantel):
    await linked(hass, mantel)
    await until(hass, lambda: [r for r in mantel.reports if "phones" in r])
    assert [r for r in mantel.reports if "phones" in r][-1]["phones"] == []
    a_phone(hass)
    await until(hass, lambda: [r for r in mantel.reports if "phones" in r][-1]["phones"])
    assert [r for r in mantel.reports if "phones" in r][-1]["phones"] == [{"service": PHONE, "name": "Avery's iPhone"}], "Companion-app phones only"


async def test_a_phone_notification_is_carried_out_and_nothing_else(hass, mantel):
    calls = a_phone(hass)
    await linked(hass, mantel)
    good = {"type": "phone_notify", "service": PHONE, "title": "Laundry", "message": "The washer is done.",
            "data": {"tag": "mantel-n1", "group": "mantel", "url": "https://mantel.example.com/home",
                     "actions": [{"action": "MANTEL_DISMISS_n1", "title": "Dismiss"},
                                 {"action": "SCRIPT_UNLOCK", "title": "Unlock"}],
                     "push": {"interruption-level": "critical", "sound": "x"}, "priority": "high", "ttl": 0,
                     "command": "request_location_update", "entity_id": "lock.front"}}
    await mantel.push(good)
    await until(hass, lambda: calls)
    assert calls == [{"title": "Laundry", "message": "The washer is done.",
                      "data": {"tag": "mantel-n1", "group": "mantel", "url": "https://mantel.example.com/home",
                               "actions": [{"action": "MANTEL_DISMISS_n1", "title": "Dismiss"}],
                               "priority": "high", "ttl": 0}}], "Mantel's actions and known fields only"
    for bad in ({**good, "service": "persistent_notification"}, {**good, "service": "mobile_app_nobody"},
                {**good, "title": ""}, {**good, "title": "x" * 200}, {**good, "service": "mobile_app_../x"}):
        await mantel.push(bad)
    await mantel.push({"type": "call_service", "domain": "notify", "service": PHONE, "data": {"title": "x"}})
    await hass.async_block_till_done()
    assert len(calls) == 1, "nothing but a known phone, a title, a message"


async def test_a_dismiss_on_a_phone_reaches_mantel(hass, mantel):
    a_phone(hass)
    await linked(hass, mantel)
    hass.bus.async_fire("mobile_app_notification_action", {"action": "SCRIPT_SOMETHING"})
    hass.bus.async_fire("mobile_app_notification_action", {"action": "MANTEL_DISMISS_n1"})
    await until(hass, lambda: mantel.calls("phone_action"))
    assert [m["action"] for m in mantel.calls("phone_action")] == ["MANTEL_DISMISS_n1"]
