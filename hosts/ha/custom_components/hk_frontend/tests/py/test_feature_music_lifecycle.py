"""Music's lifecycle: the house's entry unloaded and reloaded, the feature
removed and added again, a Music entry of a pre-release of 1.0 folded into
the house's entry, and what callers are told at each step."""
from __future__ import annotations

import pytest

from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.setup import async_setup_component

from conftest import (DOMAIN, FakeConnection, add_feature, entry, feature_entries, house_entry,
                      pre_release_entry)
from music_sample_house import OFF, ROOMS, VOLUME, music_entry, subentries
from music_sample_house import house, music  # noqa: F401 -- the fixtures

ACTIONS = {"music_play", "music_transfer", "music_stop", "music_transport", "music_play_media"}


async def test_unload_then_reload(hass, music):
    """Music runs with the house's entry: unloaded with it, back with it."""
    from custom_components.hk_frontend.features.music import ws_music_subscribe
    house_ = entry(hass)
    conn = FakeConnection(None)
    ws_music_subscribe(hass, conn, {"id": 1})
    assert conn.sent[-1]["event"]["configured"] is True
    assert await hass.config_entries.async_unload(house_.entry_id)
    await hass.async_block_till_done()
    assert not music_entry(hass).loaded
    with pytest.raises(ServiceValidationError) as err:
        await hass.services.async_call(DOMAIN, "music_stop", {}, blocking=True, return_response=True)
    assert err.value.translation_key == "music_not_set_up"
    for _ in range(3):
        assert await hass.config_entries.async_reload(house_.entry_id)
        await hass.async_block_till_done()
    assert conn.sent[-1]["event"]["configured"] is True
    assert len(house_.update_listeners) == 1
    assert music_entry(hass).loaded and len(music_entry(hass).subentries) == 13
    res = await hass.services.async_call(DOMAIN, "music_stop", {}, blocking=True, return_response=True)
    assert res == {"ok": True}


@pytest.mark.parametrize("how", ["house unloaded", "feature removed"])
async def test_screens_are_told_music_is_gone(hass, music, how):
    """The house's entry unloaded, or the feature removed: every screen's feed
    says so at once (the Play Music page stops offering what cannot play)."""
    from custom_components.hk_frontend import features as F
    from custom_components.hk_frontend.features.music import ws_music_subscribe
    conn = FakeConnection(None)
    ws_music_subscribe(hass, conn, {"id": 1})
    assert conn.sent[-1]["event"]["configured"] is True
    if how == "house unloaded":
        assert await hass.config_entries.async_unload(entry(hass).entry_id)
    else:
        F.async_remove(hass, music_entry(hass))
    await hass.async_block_till_done()
    assert conn.sent[-1]["event"] == {"configured": False}, "screens were not told"


async def test_a_second_music_cannot_be_added(hass, frontend, house):
    """Add feature no longer offers it; a form opened before it was added
    finds it added."""
    flows = hass.config_entries.subentries
    early = await flows.async_init((frontend.entry_id, "feature"), context={"source": "user"})
    assert "music" in early["menu_options"]
    assert (await add_feature(hass, "music", {}))["type"] == "create_entry"
    r = await flows.async_init((frontend.entry_id, "feature"), context={"source": "user"})
    assert r["type"] == "menu" and "music" not in r["menu_options"]
    flows.async_abort(r["flow_id"])
    r = await flows.async_configure(early["flow_id"], {"next_step_id": "music"})
    assert r["type"] == "abort" and r["reason"] == "already_configured"
    assert len(feature_entries(hass, "music")) == 1


async def test_an_automation_learns_of_a_refusal(hass, music, house):
    with pytest.raises(HomeAssistantError, match="no playlist called nope"):
        await hass.services.async_call(DOMAIN, "music_play", {"rooms": [OFF], "playlist": "nope"},
                                       blocking=True)
    res = await hass.services.async_call(DOMAIN, "music_play", {"rooms": [OFF], "playlist": "nope"},
                                         blocking=True, return_response=True)
    assert res["ok"] is False
    await hass.services.async_call(DOMAIN, "music_stop", {}, blocking=True)


async def test_transport_level_is_bounded(hass, music, house):
    import voluptuous as vol
    with pytest.raises(vol.Invalid):
        await hass.services.async_call(DOMAIN, "music_transport",
                                       {"player": OFF, "command": "volume_set", "level": 7},
                                       blocking=True)


async def test_a_pre_release_music_entry_is_folded_into_the_house(hass, base, house):
    """A Music of a pre-release of 1.0 (an entry of its own, its presets and
    playlists its items) becomes an item of the house's entry at start, with
    the entry's id: its speakers, volume and home rooms come along, and every
    preset and playlist moves to the house's entry with ITS id -- a
    playlist's key, which an automation names -- playable at once."""
    from custom_components.hk_frontend import features as F
    user = await hass.auth.async_create_user("kitchen")
    options = {"speakers": list(ROOMS), "volume": VOLUME, "homes": {user.id: OFF}}
    items = [{"data": dict(s.data), "subentry_id": s.subentry_id, "subentry_type": s.subentry_type,
              "title": s.title, "unique_id": s.unique_id} for s in subentries()]
    items[0]["unique_id"] = "everywhere"          # a unique id is carried too
    house_ = house_entry()
    house_.add_to_hass(hass)
    old = pre_release_entry("music", {}, options, unique_id="music", subentries_data=items)
    old.add_to_hass(hass)
    assert await async_setup_component(hass, DOMAIN, {})
    await hass.async_block_till_done()

    assert hass.config_entries.async_get_entry(old.entry_id) is None, "the old entry is gone"
    (e,) = feature_entries(hass, "music")
    assert e.entry_id == old.entry_id and e.title == "Music" and e.unique_id == F.unique_id("music")
    assert dict(house_.subentries[e.entry_id].data) == F.item_data("music", old.data, old.options)
    assert e.options == options and e.data == {"kind": "music"}
    assert set(e.subentries) == {i["subentry_id"] for i in items}, "every item keeps its id"
    got = sorted((s.subentry_type, s.title, dict(s.data), s.unique_id) for s in e.subentries.values())
    want = sorted((i["subentry_type"], i["title"], i["data"], i["unique_id"]) for i in items)
    assert got == want, "the same presets and playlists"
    assert all(k in house_.subentries for k in e.subentries), "items of the house's entry"
    assert ACTIONS <= set(hass.services.async_services_for_domain(DOMAIN))

    assert e.loaded
    mgr = e.runtime_data
    mgr.settle = 0
    key = next(p.key for p in mgr.config.playlists if p.name == "Country")
    assert key in {i["subentry_id"] for i in items}
    res = await hass.services.async_call(DOMAIN, "music_play", {"rooms": [OFF], "playlist": key},
                                         blocking=True, return_response=True)
    assert res == {"ok": True, "leader": OFF}
    assert mgr.config.as_client(user.id)["home"] == OFF

    # and only once
    assert await hass.config_entries.async_reload(house_.entry_id)
    await hass.async_block_till_done()
    assert len(feature_entries(hass, "music")) == 1 and len(music_entry(hass).subentries) == len(items)


async def test_remove(hass, music):
    """Removing it: its actions say so, and it can be added again."""
    from custom_components.hk_frontend import features as F
    e = music_entry(hass)
    F.async_remove(hass, e)
    await hass.async_block_till_done()
    assert not feature_entries(hass, "music") and e.entry_id not in entry(hass).subentries
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call(DOMAIN, "music_stop", {}, blocking=True, return_response=True)
    # and it can be added again
    flows = hass.config_entries.subentries
    r = await flows.async_init((entry(hass).entry_id, "feature"), context={"source": "user"})
    assert "music" in r["menu_options"]
    flows.async_abort(r["flow_id"])
