"""The wall tablets' kiosk apps (tablets.py, 1.14): a Kiosk Satellite's
entities found by role, what may be a tablet that isn't one, the checks
against what HK needs, the alerts and the scheduled restart."""
from __future__ import annotations

from datetime import timedelta

from pytest_homeassistant_custom_component.common import MockConfigEntry, async_fire_time_changed

from homeassistant.config_entries import ConfigSubentry
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.util import dt as dt_util

from conftest import entry

KS = {"battery": "sensor.loft_kiosk_battery", "charging": "binary_sensor.loft_kiosk_charging",
      "online": "binary_sensor.loft_kiosk_connectivity", "seen": "sensor.loft_kiosk_last_seen",
      "app": "sensor.loft_kiosk_foreground_app", "active": "switch.loft_kiosk_screensaver_active",
      "adaptive": "switch.loft_kiosk_adaptive_brightness", "saver_mode": "select.loft_kiosk_screensaver_mode",
      "saver_timeout": "number.loft_kiosk_screensaver_timeout", "kiosk_mode": "switch.loft_kiosk_kiosk_mode",
      "page": "sensor.loft_kiosk_current_page", "clear_cache": "button.loft_kiosk_clear_cache",
      "restart_device": "button.loft_kiosk_restart_device", "update": "update.loft_kiosk_update"}


def _kiosk(hass, **states):
    ce = MockConfigEntry(domain="esphome")
    ce.add_to_hass(hass)
    dev = dr.async_get(hass).async_get_or_create(config_entry_id=ce.entry_id, identifiers={("esphome", "loft")},
                                                 name="Loft Kiosk")
    reg = er.async_get(hass)
    for role, eid in KS.items():
        d, obj = eid.split(".")
        reg.async_get_or_create(d, "esphome", "loft-" + role, suggested_object_id=obj, device_id=dev.id,
                                config_entry=ce)
    base = {"battery": "80", "charging": "on", "online": "on", "seen": dt_util.utcnow().isoformat(),
            "app": "me.jxl.kiosk_satellite", "active": "off", "adaptive": "off", "saver_mode": "Black",
            "saver_timeout": "86400", "kiosk_mode": "on", "page": "https://x/dashboard-loft/0",
            "clear_cache": "unknown", "restart_device": "unknown", "update": "off"}
    base.update(states)
    for role, v in base.items():
        hass.states.async_set(KS[role], v)
    return dev.id


async def _tablet(hass, device="", app="kiosk_satellite", **more):
    data = {"name": "Loft", "screen": "dashboard-loft", "app": app, "device": device, **more}
    hass.config_entries.async_add_subentry(entry(hass), ConfigSubentry(
        data=data, subentry_type="tablet", title="Loft", unique_id="loft"))
    await hass.async_block_till_done(wait_background_tasks=True)


async def test_a_kiosk_satellites_parts_are_found_by_role(hass, frontend):
    from custom_components.hk_frontend import tablets
    dev = _kiosk(hass)
    p = tablets.parts(hass, "kiosk_satellite", dev)
    assert p["battery"] == KS["battery"] and p["restart_device"] == KS["restart_device"]
    assert p["saver_mode"] == KS["saver_mode"] and "screen" not in p, "only what the device has"
    assert tablets.parts(hass, "browser", dev) == {} and tablets.parts(hass, "kiosk_satellite", "") == {}
    assert [d["app"] for d in tablets.devices(hass)] == ["kiosk_satellite"]


async def test_a_kiosk_no_tablet_uses_is_suggested_with_its_screen(hass, frontend):
    from custom_components.hk_frontend import tablets
    hass.config_entries.async_add_subentry(entry(hass), ConfigSubentry(
        data={}, subentry_type="dashboard", title="Loft", unique_id="dashboard-loft"))
    dev = _kiosk(hass)
    got = tablets.suggestions(hass, entry(hass))
    assert [(s["key"], s["name"], s["screen"]) for s in got] == [(f"device:{dev}", "Loft Kiosk", "dashboard-loft")]
    await _tablet(hass, dev)
    assert tablets.suggestions(hass, entry(hass)) == [], "a tablet uses it now"


async def test_the_checks_say_what_to_fix(hass, frontend):
    from custom_components.hk_frontend import settings as S, tablets
    dev = _kiosk(hass, adaptive="on", saver_mode="Clock", battery="92", kiosk_mode="off")
    await _tablet(hass, dev)
    t = S.tablets(entry(hass))["loft"]
    got = {c["key"]: c for c in tablets.checks(hass, t, tablets.parts(hass, t["app"], t["device"]))}
    assert not got["adaptive"]["ok"] and got["adaptive"]["fix"] == ["switch", "turn_off", {"entity_id": KS["adaptive"]}]
    assert not got["saver"]["ok"] and got["saver"]["fix"][:2] == ["hk", "kiosk_saver"]
    assert not got["kiosk_mode"]["ok"] and got["update"]["ok"]
    assert not got["battery"]["ok"] and "Protect Battery" in got["battery"]["detail"]
    assert "online" not in got
    for role, v in (("adaptive", "off"), ("saver_mode", "Black"), ("battery", "80"), ("kiosk_mode", "on")):
        hass.states.async_set(KS[role], v)
    assert all(c["ok"] for c in tablets.checks(hass, t, tablets.parts(hass, t["app"], t["device"])))


async def test_offline_for_ten_minutes_raises_an_alert_once_and_clears_it(hass, frontend, freezer):
    from custom_components.hk_frontend import tablets
    dev = _kiosk(hass)
    await _tablet(hass, dev)
    hass.states.async_set(KS["online"], "off")
    w = tablets.watch(hass)
    w._check()
    freezer.tick(timedelta(minutes=9))
    w._check()
    assert not hass.states.async_entity_ids("persistent_notification") and not w._raised
    freezer.tick(timedelta(minutes=2))
    w._check()
    assert ("loft", "offline") in w._raised
    w._check()
    assert len(w._raised) == 1, "once"
    hass.states.async_set(KS["online"], "on")
    hass.states.async_set(KS["seen"], dt_util.utcnow().isoformat())
    w._check()
    assert not w._raised, "back: the alert goes"


async def test_the_alerts_can_be_turned_off(hass, frontend, freezer):
    from custom_components.hk_frontend import tablets
    from test_settings_api import _set
    dev = _kiosk(hass, charging="off")
    await _tablet(hass, dev)
    await _set(hass, {"tablets.alert_charging": False})
    w = tablets.watch(hass)
    w._check()
    freezer.tick(timedelta(minutes=11))
    w._check()
    assert not w._raised


async def test_the_scheduled_restart_clears_then_restarts_and_checks_it_came_back(hass, frontend, freezer, monkeypatch):
    from custom_components.hk_frontend import tablets
    from test_settings_api import _set
    monkeypatch.setattr(tablets, "CLEAR_WAIT", 0)
    pressed = []
    hass.services.async_register("button", "press", lambda call: pressed.append(call.data["entity_id"]))
    dev = _kiosk(hass)
    await _tablet(hass, dev)
    await _set(hass, {"tablets.restart": True, "tablets.restart_times": ["03:00"]})
    w = tablets.watch(hass)
    assert await w.restart_all() == ["loft"]
    assert pressed == [KS["clear_cache"], KS["restart_device"]], "the cache first, then the restart"
    hass.states.async_set(KS["app"], "com.android.systemui")      # the lock screen in front
    freezer.tick(timedelta(minutes=4))
    w._check()
    assert ("loft", "restart") in w._raised
    hass.states.async_set(KS["app"], "me.jxl.kiosk_satellite")
    w._restarted["loft"] = dt_util.utcnow() - timedelta(minutes=4)
    w._check()
    assert ("loft", "restart") not in w._raised


async def test_wake_and_sleep_now_need_hk_to_decide(hass, frontend):
    from custom_components.hk_frontend.panel import ws_tablet_act
    from test_settings_api import _admin
    await _tablet(hass, "", app="browser")
    conn = await _admin(hass)
    ws_tablet_act(hass, conn, {"id": 1, "type": "hk_frontend/tablet/act", "tablet": "loft", "act": "wake"})
    await hass.async_block_till_done()
    assert conn.sent[-1]["error"] == "not_deciding"
    ws_tablet_act(hass, conn, {"id": 2, "type": "hk_frontend/tablet/act", "tablet": "nope", "act": "wake"})
    await hass.async_block_till_done()
    assert conn.sent[-1]["error"] == "no_tablet"
