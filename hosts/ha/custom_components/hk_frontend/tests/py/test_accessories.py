"""Accessory settings (accessories.py): stored house-wide, changed by admins,
sent to every screen, and read by Status & Chips."""
from __future__ import annotations

import pytest

from conftest import FakeConnection, entry

DOMAIN = "hk_frontend"


class Conn(FakeConnection):
    """A connection that keeps the result's payload and errors."""

    def send_result(self, msg_id, result=None):
        self.sent.append({"id": msg_id, "type": "result", "success": True, "result": result})

    def send_error(self, msg_id, code, message):
        self.sent.append({"id": msg_id, "type": "result", "success": False, "error": code})


async def _admin(hass):
    user = await hass.auth.async_create_user("Admin", group_ids=["system-admin"])
    return Conn(user)


def _house(hass):
    for eid, st, attrs in (("light.lamp", "on", {}), ("switch.coffee", "off", {}),
                           ("switch.fan_plug", "off", {}), ("light.porch", "off", {})):
        hass.states.async_set(eid, st, attrs)


async def test_an_admin_names_and_draws_an_accessory_and_every_screen_is_told(hass, frontend):
    from custom_components.hk_frontend import ws_settings_subscribe
    from custom_components.hk_frontend.accessories import ws_accessory_set
    screen = FakeConnection(None)
    ws_settings_subscribe(hass, screen, {"id": 1})
    assert screen.sent[-1]["event"]["accessories"] == {"entities": {}, "rooms": {}, "into": {}, "pages": {}, "scenes": {}}
    conn = await _admin(hass)
    ws_accessory_set(hass, conn, {"id": 2, "type": "hk_frontend/accessory/set", "entity_id": "switch.coffee",
                                  "name": "Coffee Maker", "icon": "hk:coffee"})
    assert conn.sent[-1]["result"] == {"name": "Coffee Maker", "icon": "hk:coffee"}
    await hass.async_block_till_done()
    assert screen.sent[-1]["event"]["accessories"]["entities"]["switch.coffee"] == {
        "name": "Coffee Maker", "icon": "hk:coffee"}
    # a name for one dashboard only, beside the house's
    ws_accessory_set(hass, conn, {"id": 3, "type": "hk_frontend/accessory/set", "entity_id": "switch.coffee",
                                  "name": "Coffee", "screen": "dashboard-kitchen"})
    assert conn.sent[-1]["result"]["names"] == {"dashboard-kitchen": "Coffee"}
    assert conn.sent[-1]["result"]["name"] == "Coffee Maker"
    # None puts a setting back to automatic; nothing left = no entry at all
    ws_accessory_set(hass, conn, {"id": 4, "type": "hk_frontend/accessory/set", "entity_id": "switch.coffee",
                                  "name": None, "icon": None})
    ws_accessory_set(hass, conn, {"id": 5, "type": "hk_frontend/accessory/set", "entity_id": "switch.coffee",
                                  "name": None, "screen": "dashboard-kitchen"})
    await hass.async_block_till_done()
    assert "switch.coffee" not in screen.sent[-1]["event"]["accessories"]["entities"]


async def test_a_wall_tablet_cannot_change_an_accessory(hass, frontend):
    from homeassistant.exceptions import Unauthorized
    from custom_components.hk_frontend.accessories import ws_accessory_set
    await hass.auth.async_create_user("Owner")         # the first user made is the owner
    tablet = Conn(await hass.auth.async_create_user("kitchen"))            # not an admin
    assert not tablet.user.is_admin
    with pytest.raises(Unauthorized):
        ws_accessory_set(hass, tablet, {"id": 1, "type": "hk_frontend/accessory/set",
                                        "entity_id": "light.lamp", "name": "x"})


async def test_status_and_show_as_change_what_counts(hass, frontend):
    """Include in status off: in no chip. Show as a light: a Lights chip
    counts it; as an outlet: no longer a light."""
    from custom_components.hk_frontend import kinds
    from custom_components.hk_frontend.accessories import ws_accessory_set
    _house(hass)
    tracker = hass.data[DOMAIN][kinds.DATA]
    tracker.settings_changed()
    assert set(kinds.current(hass)["lights"]) == {"light.lamp", "light.porch"}
    conn = await _admin(hass)
    ws_accessory_set(hass, conn, {"id": 1, "type": "hk_frontend/accessory/set",
                                  "entity_id": "switch.coffee", "show_as": "light"})
    ws_accessory_set(hass, conn, {"id": 2, "type": "hk_frontend/accessory/set",
                                  "entity_id": "light.porch", "status": False})
    ws_accessory_set(hass, conn, {"id": 3, "type": "hk_frontend/accessory/set",
                                  "entity_id": "switch.fan_plug", "show_as": "fan"})
    ws_accessory_set(hass, conn, {"id": 4, "type": "hk_frontend/accessory/set",
                                  "entity_id": "light.lamp", "show_as": "outlet"})
    k = kinds.current(hass)
    assert k["lights"] == ["switch.coffee"], k["lights"]
    assert k["fans"] == ["switch.fan_plug"]
    ws_accessory_set(hass, conn, {"id": 5, "type": "hk_frontend/accessory/set",
                                  "entity_id": "light.porch", "status": True})
    assert "light.porch" in kinds.current(hass)["lights"], "True is the default: stored as nothing"


async def test_a_room_order_and_a_favorite(hass, frontend):
    from custom_components.hk_frontend.accessories import ws_accessory_order, ws_board_favorite
    from custom_components.hk_frontend.settings import as_client
    conn = await _admin(hass)
    ws_accessory_order(hass, conn, {"id": 1, "type": "hk_frontend/accessory/order", "area_id": "kitchen",
                                    "entities": ["light.lamp", "switch.coffee", "light.lamp"]})
    assert conn.sent[-1]["result"] == ["light.lamp", "switch.coffee"], "each once, in order"
    ws_board_favorite(hass, conn, {"id": 2, "type": "hk_frontend/board/favorite",
                                   "dashboard": "dashboard-kitchen", "entity_id": "light.lamp", "favorite": True})
    assert conn.sent[-1]["success"] is False and conn.sent[-1]["error"] == "no_item"
    e = entry(hass)
    from homeassistant.config_entries import ConfigSubentry
    hass.config_entries.async_add_subentry(e, ConfigSubentry(
        data={"favorites": ["lock.front"]}, subentry_type="dashboard", title="Kitchen",
        unique_id="dashboard-kitchen"))
    ws_board_favorite(hass, conn, {"id": 3, "type": "hk_frontend/board/favorite",
                                   "dashboard": "dashboard-kitchen", "entity_id": "light.lamp", "favorite": True})
    assert as_client(entry(hass))["boards"]["dashboard-kitchen"]["favorites"] == ["lock.front", "light.lamp"]
    ws_board_favorite(hass, conn, {"id": 4, "type": "hk_frontend/board/favorite",
                                   "dashboard": "dashboard-kitchen", "entity_id": "lock.front", "favorite": False})
    assert as_client(entry(hass))["boards"]["dashboard-kitchen"]["favorites"] == ["light.lamp"]


async def test_the_store_survives_a_restart(hass, frontend, hass_storage):
    from custom_components.hk_frontend import accessories as A
    acc = A.get(hass)
    acc.set("light.lamp", {"name": "Lamp", "home": False})
    acc.order("living_room", ["light.lamp"])
    await hass.async_block_till_done()
    # the delayed write, flushed the way Home Assistant flushes it on stop
    from homeassistant.const import EVENT_HOMEASSISTANT_FINAL_WRITE
    hass.bus.async_fire(EVENT_HOMEASSISTANT_FINAL_WRITE)
    await hass.async_block_till_done()
    assert A.STORAGE_KEY in hass_storage, "written"
    fresh = A.Accessories(hass)
    await fresh.async_load()
    assert fresh.data == {"entities": {"light.lamp": {"name": "Lamp", "home": False}},
                          "rooms": {"living_room": ["light.lamp"]}, "into": {}, "pages": {}, "scenes": {}}


async def test_a_room_shown_inside_another(hass, frontend):
    from custom_components.hk_frontend.accessories import ws_accessory_into
    from custom_components.hk_frontend.settings import as_client
    conn = await _admin(hass)
    ws_accessory_into(hass, conn, {"id": 1, "type": "hk_frontend/accessory/into", "area_id": "deck", "into": "backyard"})
    assert conn.sent[-1]["result"] == {"deck": "backyard"}
    ws_accessory_into(hass, conn, {"id": 2, "type": "hk_frontend/accessory/into", "area_id": "backyard", "into": "garden"})
    assert conn.sent[-1]["result"] == {"deck": "garden", "backyard": "garden"}, "one level: the deck goes straight to the garden"
    ws_accessory_into(hass, conn, {"id": 3, "type": "hk_frontend/accessory/into", "area_id": "deck", "into": None})
    assert conn.sent[-1]["result"] == {"backyard": "garden"}


async def test_as_a_favorite_a_name_a_glyph_and_what_it_controls_with(hass, frontend):
    """An accessory's name and glyph on the favorites row, and the
    lights it is one favorite with ("Main + Table Lights") -- never with
    itself, no more than eight, None or an empty list back to none."""
    from custom_components.hk_frontend.accessories import FAV_WITH_MAX, ws_accessory_set
    conn = await _admin(hass)
    ws_accessory_set(hass, conn, {"id": 1, "type": "hk_frontend/accessory/set", "entity_id": "light.main",
                                  "fav_name": " Main + Table Lights ", "fav_icon": "hk:lightbulb-group",
                                  "fav_with": ["light.table", "light.main", "light.table"]})
    assert conn.sent[-1]["result"] == {"fav_name": "Main + Table Lights", "fav_icon": "hk:lightbulb-group",
                                       "fav_with": ["light.table"]}
    import voluptuous as vol
    schema = ws_accessory_set._ws_schema
    with pytest.raises(vol.Invalid):
        schema({"id": 2, "type": "hk_frontend/accessory/set", "entity_id": "light.main", "fav_icon": "fire"})
    with pytest.raises(vol.Invalid):
        schema({"id": 3, "type": "hk_frontend/accessory/set", "entity_id": "light.main",
                "fav_with": [f"light.l{i}" for i in range(FAV_WITH_MAX + 1)]})
    ws_accessory_set(hass, conn, {"id": 4, "type": "hk_frontend/accessory/set", "entity_id": "light.main",
                                  "fav_with": [], "fav_icon": None})
    assert conn.sent[-1]["result"] == {"fav_name": "Main + Table Lights"}
    # a helper's room line as a favorite, and what On and Off are called
    ws_accessory_set(hass, conn, {"id": 5, "type": "hk_frontend/accessory/set", "entity_id": "input_boolean.block_game",
                                  "fav_room": " Emma’s Room ", "on_text": "Blocked", "off_text": "Allowed"})
    assert conn.sent[-1]["result"] == {"fav_room": "Emma’s Room", "on_text": "Blocked", "off_text": "Allowed"}
    with pytest.raises(vol.Invalid):
        schema({"id": 6, "type": "hk_frontend/accessory/set", "entity_id": "input_boolean.x", "on_text": "x" * 31})
    ws_accessory_set(hass, conn, {"id": 7, "type": "hk_frontend/accessory/set", "entity_id": "input_boolean.block_game",
                                  "fav_room": None, "on_text": "", "off_text": None})
    assert conn.sent[-1]["result"] == {}, "None or empty: back to automatic"


async def test_a_page_in_its_own_order(hass, frontend):
    """The Vacuums page's order (the settings page's drag list) --
    ids once each, only the pages that have one, an empty list back to A to Z."""
    import voluptuous as vol
    from custom_components.hk_frontend.accessories import clean, current, ws_accessory_page_order
    conn = await _admin(hass)
    ws_accessory_page_order(hass, conn, {"id": 1, "type": "hk_frontend/accessory/page_order", "page": "vacuums",
                                         "entities": ["vacuum.down", "vacuum.up", "vacuum.down"]})
    assert conn.sent[-1]["result"] == ["vacuum.down", "vacuum.up"]
    assert current(hass)["pages"] == {"vacuums": ["vacuum.down", "vacuum.up"]}
    with pytest.raises(vol.Invalid):
        ws_accessory_page_order._ws_schema({"id": 2, "type": "hk_frontend/accessory/page_order", "page": "locks",
                                             "entities": []})
    ws_accessory_page_order(hass, conn, {"id": 3, "type": "hk_frontend/accessory/page_order", "page": "vacuums",
                                         "entities": []})
    assert current(hass)["pages"] == {}
    assert clean({"pages": {"vacuums": ["vacuum.a", 5], "locks": ["lock.a"]}})["pages"] == {"vacuums": ["vacuum.a"]}
    # Security's locks and garage doors
    ws_accessory_page_order(hass, conn, {"id": 4, "type": "hk_frontend/accessory/page_order", "page": "security",
                                         "entities": ["lock.front", "cover.garage", "lock.back"]})
    assert current(hass)["pages"] == {"security": ["lock.front", "cover.garage", "lock.back"]}


def test_optional_cards_are_found_where_hacs_keeps_them(tmp_path):
    """The Weather page's radar map: its URL when HACS has installed the card
    (the file's time on it), None when not."""
    from custom_components.hk_frontend.settings import find_extras
    assert find_extras(str(tmp_path)) == {"wallpanel": None, "kiosk": None, "radar": None}
    f = tmp_path / "www" / "community" / "weather-radar-card"
    f.mkdir(parents=True)
    (f / "weather-radar-card.js").write_text("//")
    url = find_extras(str(tmp_path))["radar"]
    assert url.startswith("/hacsfiles/weather-radar-card/weather-radar-card.js?v=")


def test_clean_drops_what_it_cannot_use():
    from custom_components.hk_frontend.accessories import clean
    assert clean({"entities": {"light.x": {"name": "  ", "icon": "phu:tree", "show_as": "car",
                                           "status": True, "names": {"BAD PATH": "x", "dash-a": "A"}},
                               "not an id": {"name": "y"}},
                  "rooms": {"kitchen": ["light.x", 3, "light.x"], "Bad Area": ["light.y"]}}) == {
        "entities": {"light.x": {"names": {"dash-a": "A"}}}, "rooms": {"kitchen": ["light.x"]}, "into": {}, "pages": {}, "scenes": {}}


def test_a_chip_can_show_an_attribute():
    """As a chip: "Shows" -- an attribute in place of the state."""
    from custom_components.hk_frontend.accessories import clean_entity
    assert clean_entity({"attribute": " range "}) == {"attribute": "range"}
    assert clean_entity({"attribute": "Alerts.0.Event"}) == {"attribute": "Alerts.0.Event"}
    assert clean_entity({"attribute": "<script>"}) == {}
    assert clean_entity({"attribute": ""}) == {}


def test_a_tile_can_be_tall_or_regular():
    """Size: a light as a tall tile, a lock as a pill -- or its kind's own."""
    from custom_components.hk_frontend.accessories import clean_entity
    assert clean_entity({"size": "tall"}) == {"size": "tall"}
    assert clean_entity({"size": "regular"}) == {"size": "regular"}
    assert clean_entity({"size": "huge"}) == {}
    assert clean_entity({"size": None}) == {}


async def test_an_admin_makes_a_light_tall(hass, frontend):
    from custom_components.hk_frontend.accessories import ws_accessory_set
    conn = await _admin(hass)
    ws_accessory_set(hass, conn, {"id": 1, "type": "hk_frontend/accessory/set", "entity_id": "light.lamp", "size": "tall"})
    assert conn.sent[-1]["result"] == {"size": "tall"}
    ws_accessory_set(hass, conn, {"id": 2, "type": "hk_frontend/accessory/set", "entity_id": "light.lamp", "size": None})
    assert conn.sent[-1]["result"] == {}


def test_a_fan_can_be_told_not_to_spin():
    """Anim: a fan's glyph turns while it is on by default -- 'still' keeps
    a chosen icon from doing so. None is automatic (its kind)."""
    from custom_components.hk_frontend.accessories import clean_entity
    assert clean_entity({"anim": "none"}) == {"anim": "none"}
    assert clean_entity({"anim": "spin"}) == {"anim": "spin"}
    assert clean_entity({"anim": "wobble"}) == {}
    assert clean_entity({"anim": None}) == {}
    assert clean_entity({"anim": "Still"}) == {}, "case: only the two choices"


async def test_an_admin_stills_a_fan_and_every_screen_is_told(hass, frontend):
    from custom_components.hk_frontend import ws_settings_subscribe
    from custom_components.hk_frontend.accessories import ws_accessory_set
    hass.states.async_set("fan.den", "on", {})
    import voluptuous as vol
    screen = FakeConnection(None)
    ws_settings_subscribe(hass, screen, {"id": 1})
    conn = await _admin(hass)
    ws_accessory_set(hass, conn, {"id": 2, "type": "hk_frontend/accessory/set",
                                  "entity_id": "fan.den", "anim": "none", "icon": "hk:ceiling-fan"})
    assert conn.sent[-1]["result"] == {"icon": "hk:ceiling-fan", "anim": "none"}
    await hass.async_block_till_done()
    assert screen.sent[-1]["event"]["accessories"]["entities"]["fan.den"] == {
        "icon": "hk:ceiling-fan", "anim": "none"}
    schema = ws_accessory_set._ws_schema
    with pytest.raises(vol.Invalid):
        schema({"id": 3, "type": "hk_frontend/accessory/set", "entity_id": "fan.den", "anim": "wobble"})
    ws_accessory_set(hass, conn, {"id": 4, "type": "hk_frontend/accessory/set",
                                  "entity_id": "fan.den", "anim": None})
    assert conn.sent[-1]["result"] == {"icon": "hk:ceiling-fan"}, "None: back to its kind -- it spins again"


async def test_a_rooms_scenes_row(hass, frontend):
    """A room's scenes row: its own list, none ([] -- kept, not dropped), or
    Automatic again (None)."""
    from custom_components.hk_frontend.accessories import clean, current, ws_accessory_room_scenes
    conn = await _admin(hass)
    ws_accessory_room_scenes(hass, conn, {"id": 1, "type": "hk_frontend/accessory/room_scenes", "area_id": "kitchen",
                                          "entities": ["input_button.nap", "scene.dinner", "input_button.nap"]})
    assert conn.sent[-1]["result"] == {"scenes": ["input_button.nap", "scene.dinner"]}
    ws_accessory_room_scenes(hass, conn, {"id": 2, "type": "hk_frontend/accessory/room_scenes", "area_id": "garage",
                                          "entities": []})
    assert current(hass)["scenes"] == {"kitchen": ["input_button.nap", "scene.dinner"], "garage": []}
    ws_accessory_room_scenes(hass, conn, {"id": 3, "type": "hk_frontend/accessory/room_scenes", "area_id": "kitchen",
                                          "entities": None})
    assert current(hass)["scenes"] == {"garage": []}
    assert clean({"scenes": {"Bad Area": ["scene.x"], "den": "scene.x", "loft": ["scene.y", 3]}})["scenes"] == {
        "loft": ["scene.y"]}
