"""The house entry's lifecycle: unload, reload, remove, re-add, and a newer
entry refused. Contracts, not internals: what a screen is sent at each step."""
from __future__ import annotations

from homeassistant import config_entries
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import MockConfigEntry

from conftest import FakeConnection, house_entry, pre_release_entry

DOMAIN = "hk_frontend"


def _entry(hass):
    return hass.config_entries.async_entries(DOMAIN)[0]


async def test_unload_then_reload(hass, frontend):
    from custom_components.hk_frontend import ws_settings_subscribe
    e = _entry(hass)
    conn = FakeConnection(None)
    ws_settings_subscribe(hass, conn, {"id": 2})
    assert conn.sent[-1]["event"]["configured"] is True
    switch = "switch.hk_frontend_seasonal_decorations"
    assert hass.states.get(switch).state == "on"

    assert await hass.config_entries.async_unload(e.entry_id)
    await hass.async_block_till_done()
    assert conn.sent[-1]["event"]["configured"] is True, "an unloaded entry keeps its settings"
    assert hass.states.get(switch).state == "unavailable"

    for _ in range(3):                             # repeated reloads leave one of everything
        assert await hass.config_entries.async_reload(e.entry_id)
        await hass.async_block_till_done()
    assert len(e.update_listeners) == 1
    assert hass.states.get(switch).state == "on"
    hass.config_entries.async_update_entry(e, options={**e.options, "files_folder": "hk_local"})
    await hass.async_block_till_done()
    sent = len(conn.sent)
    hass.config_entries.async_update_entry(e, options={**e.options, "files_folder": "hk_other"})
    await hass.async_block_till_done()
    assert len(conn.sent) == sent + 1, "one change, one message -- not one per reload"


async def test_remove_clears_its_repairs_and_screens_get_the_defaults(hass, frontend):
    from custom_components.hk_frontend import ws_settings_subscribe
    e = _entry(hass)
    reg = ir.async_get(hass)
    assert reg.async_get_issue(DOMAIN, "missing_font"), "the test house has no font"
    conn = FakeConnection(None)
    ws_settings_subscribe(hass, conn, {"id": 3})
    assert await hass.config_entries.async_remove(e.entry_id)
    await hass.async_block_till_done()
    assert not reg.async_get_issue(DOMAIN, "missing_font")
    assert not reg.async_get_issue(DOMAIN, "missing_glyphs")
    assert conn.sent[-1]["event"]["configured"] is False

    # ...and adding it again starts empty, nothing carried over
    r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    r = await hass.config_entries.flow.async_configure(r["flow_id"], {})
    assert r["type"] == "create_entry" and r["title"] == "HK Frontend"
    new = _entry(hass)
    assert new.options == {} and not new.subentries


async def test_a_newer_entry_is_refused_not_guessed(hass, base):
    newer = MockConfigEntry(domain=DOMAIN, title="HK Frontend", version=2, unique_id=DOMAIN,
                            data={}, options={})
    newer.add_to_hass(hass)
    assert not await hass.config_entries.async_setup(newer.entry_id)
    assert newer.state is config_entries.ConfigEntryState.MIGRATION_ERROR


async def test_a_second_house_entry_cannot_be_added(hass, frontend):
    """With the house's entry there, adding HK Frontend again is refused
    (single_config_entry), from the user or from an import; the features
    are its items (Add feature) instead."""
    for source in (config_entries.SOURCE_USER, config_entries.SOURCE_IMPORT):
        r = await hass.config_entries.flow.async_init(
            DOMAIN, context={"source": source}, data={} if source == config_entries.SOURCE_IMPORT else None)
        assert r["type"] == "abort" and r["reason"] in ("single_instance_allowed", "already_configured"), source
    assert len(hass.config_entries.async_entries(DOMAIN)) == 1
    assert not hass.config_entries.flow.async_progress()


async def test_pre_release_feature_entries_fold_into_the_house_at_start(hass, base):
    """A pre-release of 1.0 made each feature an entry of its own. At start
    every one becomes an item of the house's entry, with its own id, and is
    removed; the house's own items and settings are left as they were."""
    from homeassistant.setup import async_setup_component

    from custom_components.hk_frontend import features as F
    popup = {"subentry_type": "popup", "title": "Doorbell", "unique_id": "doorbell",
             "data": {"name": "Doorbell", "kind": "camera", "entity": "camera.door"}}
    house = house_entry(popup, options={"files_folder": "hk_local"})
    house.add_to_hass(hass)
    olds = [pre_release_entry("music", {}, {"speakers": [], "volume": 0.35, "homes": {}}, unique_id="music"),
            pre_release_entry("live_tv", {"host": "tuner.local", "guide_url": ""},
                              {"channels": [{"number": "4.1", "name": "NBC"}], "quality": "720"}, unique_id="live_tv"),
            pre_release_entry("clean_areas", {}, {"vacuums": []}, unique_id="clean_areas"),
            pre_release_entry("alarm_pin", {"alarm": "alarm_control_panel.home"}, {"arm_required": True},
                              title="Home", unique_id="alarm_pin:alarm_control_panel.home")]
    for old in olds:
        old.add_to_hass(hass)
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()
    assert hass.config_entries.async_entries(DOMAIN) == [house]
    assert house.state is config_entries.ConfigEntryState.LOADED
    for old in olds:
        kind = old.data["kind"]
        item = house.subentries[old.entry_id]
        assert item.subentry_type == "feature" and item.unique_id == F.unique_id(
            kind, old.data.get("alarm", "")), kind
        assert dict(item.data) == F.item_data(kind, old.data, old.options), kind
        assert item.title == ("Home PIN" if kind == "alarm_pin" else old.title), kind
    assert {f.entry_id for f in F.loaded(hass)} == {o.entry_id for o in olds}, "every one is running"
    assert "doorbell" in {s.unique_id for s in house.subentries.values()}, "the house's own items stay"
    assert house.options == {"files_folder": "hk_local"}


async def test_many_writes_at_once_send_the_feed_once(hass, frontend):
    """Removing a chip writes its subentry and every screen that listed it;
    Home Assistant runs the update listener once per write, after them all.
    Each run used to send every open page the whole feed again -- identical
    copies. One change, one send."""
    from types import MappingProxyType
    from homeassistant.config_entries import ConfigSubentry
    from homeassistant.helpers.dispatcher import async_dispatcher_connect
    from custom_components.hk_frontend.const import SIGNAL_CONFIG
    e = frontend
    sent = []
    async_dispatcher_connect(hass, SIGNAL_CONFIG, lambda *a: sent.append(1))
    for n in range(4):
        hass.config_entries.async_add_subentry(e, ConfigSubentry(
            data=MappingProxyType({"name": "C%d" % n, "after": "end", "card": {"type": "custom:hk-status-chip-card"}}),
            subentry_type="chip", title="C%d" % n, unique_id="c%d" % n))
    await hass.async_block_till_done()
    assert len(sent) == 1, sent
    hass.config_entries.async_update_entry(e, options={**e.options, "setup_done": True})
    await hass.async_block_till_done()
    assert len(sent) == 2, "a later change still sends"
