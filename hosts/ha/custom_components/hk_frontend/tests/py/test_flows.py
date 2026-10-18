"""Adding the integration, the items its one entry offers, and what its own
entry does not hold."""
from __future__ import annotations

from conftest import DOMAIN, add_feature, entry

ITEM_TYPES = ["feature", "dashboard", "popup", "page", "chip", "tablet", "preset", "playlist"]


async def test_only_one_house(hass, frontend):
    """A second HK Frontend is refused: there is only ever one entry, and
    Add feature is one of its items, never a second house."""
    r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert r["type"] == "abort" and r["reason"] in ("single_instance_allowed", "already_configured")
    assert hass.config_entries.async_entries(DOMAIN) == [frontend]


async def test_setup_starts_empty_and_assumes_no_house(hass, base):
    """Adding the integration asks nothing and imports nothing."""
    r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": "user"})
    assert r["type"] == "form" and not r["data_schema"].schema
    r = await hass.config_entries.flow.async_configure(r["flow_id"], {})
    assert r["type"] == "create_entry"
    e = entry(hass)
    assert e.options == {} and not e.subentries
    assert e.minor_version == 16, "a new entry is already the latest version"


async def test_its_items_in_the_order_its_page_lists_them(hass, frontend):
    """The house's entry offers every item, in the order the integration's
    page lists its Add buttons: Add feature first, Music's last."""
    from homeassistant.config_entries import HANDLERS
    assert list(HANDLERS[DOMAIN].async_get_supported_subentry_types(frontend)) == ITEM_TYPES


async def test_add_feature_offers_what_the_house_does_not_have(hass, frontend):
    """A menu of the features not added yet; Alarm PIN (one per alarm) is
    always offered."""
    flows = hass.config_entries.subentries
    r = await flows.async_init((frontend.entry_id, "feature"), context={"source": "user"})
    assert r["type"] == "menu" and r["step_id"] == "user"
    assert r["menu_options"] == ["music", "live_tv", "clean_areas", "alarm_pin", "energy", "notifications"]
    flows.async_abort(r["flow_id"])
    await add_feature(hass, "clean_areas", {})
    r = await flows.async_init((frontend.entry_id, "feature"), context={"source": "user"})
    assert r["menu_options"] == ["music", "live_tv", "alarm_pin", "energy", "notifications"]
    flows.async_abort(r["flow_id"])


async def test_the_house_entry_holds_no_music(hass, frontend):
    """Whole-home music is the Music feature: the house's Configure has no
    Speakers page, and a preset or a playlist waits for Music to be added."""
    r = await hass.config_entries.options.async_init(frontend.entry_id)
    assert r["type"] == "menu" and "music" not in r["menu_options"]
    for kind in ("preset", "playlist"):
        r = await hass.config_entries.subentries.async_init((frontend.entry_id, kind), context={"source": "user"})
        assert r["type"] == "abort" and r["reason"] == "music_not_added", kind
    assert not frontend.subentries
    # its actions: Show pop-up, and the features' own (each answers "not
    # added" until its feature is)
    assert {"show_popup", "close_popup", "clean_areas"} <= set(hass.services.async_services_for_domain(DOMAIN))
