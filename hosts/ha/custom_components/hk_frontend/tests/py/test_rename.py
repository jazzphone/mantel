"""Following an entity rename (rename.py): exact ids, HK Frontend's own
structured settings only, card configurations reported and never rewritten,
nothing overwritten, everything said in one notification."""
from __future__ import annotations

from types import MappingProxyType

from custom_components.hk_frontend import rename as R

OLD, NEW = "light.a", "light.b"


# ------------------------------------------------------------ the rules
def test_only_an_exact_value_is_replaced():
    assert R._swap(OLD, OLD, NEW) == (NEW, True)
    assert R._swap("light.a_2", OLD, NEW) == ("light.a_2", False), "never a substring"
    assert R._swap("xlight.a", OLD, NEW) == ("xlight.a", False)
    assert R._swap(["light.z", OLD, "light.a_2"], OLD, NEW) == (["light.z", NEW, "light.a_2"], True)
    assert R._swap({"entity": OLD}, OLD, NEW) == ({"entity": OLD}, False), "a mapping is not a value"
    assert R._swap(5, OLD, NEW) == (5, False)


def test_a_list_that_already_names_the_new_id_keeps_one():
    assert R._swap([NEW, OLD, "light.z"], OLD, NEW) == ([NEW, "light.z"], True)


def test_options_follow_value_list_and_counts_but_never_the_radar():
    dash = {"weather": {"entity": "weather.home", "outside": OLD, "radar": {"layers": [OLD]}},
            "features": {"house_timers": ["timer.x", OLD]},
            "counts": {"lights": {"exclude": [OLD], "include": []}},
            "security": {"alarm": "alarm_control_panel.a"}}
    out, paths = R.rewrite_options(dash, OLD, NEW)
    assert out["weather"]["outside"] == NEW and out["features"]["house_timers"] == ["timer.x", NEW]
    assert out["counts"]["lights"]["exclude"] == [NEW]
    assert out["weather"]["radar"] == {"layers": [OLD]}, "third-party card options are never touched"
    assert sorted(paths) == ["counts.lights.exclude", "features.house_timers", "weather.outside"]
    assert dash["weather"]["outside"] == OLD, "the original is not mutated"


def test_items_follow_only_their_named_fields():
    board = {"favorites": [OLD], "cameras": [], "scenes": [OLD], "title": OLD,
             "wallpanel_options": {"entity": OLD}, "custom_pages": ["light.a"]}
    out, paths = R.rewrite_fields(board, R.BOARD_KEYS, OLD, NEW)
    assert out["favorites"] == [NEW] and out["scenes"] == [NEW] and sorted(paths) == ["favorites", "scenes"]
    assert out["title"] == OLD and out["wallpanel_options"] == {"entity": OLD} and out["custom_pages"] == ["light.a"]


def test_accessories_move_the_settings_and_every_order():
    data = {"entities": {OLD: {"name": "Lamp"}, "light.k": {"fav_with": [OLD, "light.z"]}},
            "rooms": {"kitchen": ["light.k", OLD]}, "pages": {"vacuums": ["vacuum.x"]}, "into": {},
            "scenes": {"den": [OLD], "garage": []}}
    out, changed, clash = R.rewrite_accessories(data, OLD, NEW)
    assert out["entities"][NEW] == {"name": "Lamp"} and OLD not in out["entities"]
    assert out["entities"]["light.k"]["fav_with"] == [NEW, "light.z"]
    assert out["rooms"]["kitchen"] == ["light.k", NEW] and out["pages"] == {"vacuums": ["vacuum.x"]}
    assert out["scenes"] == {"den": [NEW], "garage": []}
    assert not clash and len(changed) == 4


def test_accessories_never_overwrite_the_new_ids_own_settings():
    data = {"entities": {OLD: {"name": "Old"}, NEW: {"name": "Mine"}}, "rooms": {}, "pages": {}}
    out, changed, clash = R.rewrite_accessories(data, OLD, NEW)
    assert out["entities"] == {OLD: {"name": "Old"}, NEW: {"name": "Mine"}}
    assert clash and not changed


def test_a_favorite_with_itself_is_dropped_after_the_rename():
    data = {"entities": {NEW: {"fav_with": [OLD, "light.z"]}}, "rooms": {}, "pages": {}}
    out, _c, _x = R.rewrite_accessories(data, OLD, NEW)
    assert out["entities"][NEW]["fav_with"] == ["light.z"]


# ------------------------------------------------ through the registry
async def _house(hass, frontend):
    """An entry with an old id in each place it may be: options, a screen, a
    pop-up, a custom page's cards (with an action that looks like an id),
    and the accessories store. Items hold their data as Home Assistant does,
    read-only (MappingProxyType): with plain dicts this passed while nothing
    was followed on a real house."""
    from homeassistant.config_entries import ConfigSubentry
    from custom_components.hk_frontend import accessories
    e = frontend
    dash = dict(e.options.get("dashboard") or {})
    dash["features"] = {**(dash.get("features") or {}), "temperature": OLD, "house_timers": []}
    hass.config_entries.async_update_entry(e, options={**e.options, "dashboard": dash})
    hass.config_entries.async_add_subentry(e, ConfigSubentry(
        data=MappingProxyType({"dashboard": "dashboard-kitchen", "favorites": [OLD, "light.z"], "wallpanel_options": {"x": OLD}}),
        subentry_type="dashboard", title="Kitchen", unique_id="dashboard-kitchen"))
    hass.config_entries.async_add_subentry(e, ConfigSubentry(
        data=MappingProxyType({"kind": "accessories", "entities": [OLD], "name": "Lamps"}),
        subentry_type="popup", title="Lamps", unique_id="lamps"))
    view = {"cards": [{"type": "custom:hk-stat-card", "entity": OLD,
                       "tap_action": {"action": "perform-action", "perform_action": "select.select_option"}}]}
    hass.config_entries.async_add_subentry(e, ConfigSubentry(
        data=MappingProxyType({"title": "Energy", "view": view}), subentry_type="page", title="Energy", unique_id="energy"))
    acc = accessories.get(hass)
    acc.set(OLD, {"name": "Lamp"})
    await hass.async_block_till_done()
    return e, view


def _registered(hass, object_id="a"):
    from homeassistant.helpers import entity_registry as er
    reg = er.async_get(hass)
    return reg, reg.async_get_or_create("light", "test", object_id, suggested_object_id=object_id)


async def test_a_rename_is_followed_everywhere_it_may_be_and_said(hass, frontend):
    from custom_components.hk_frontend import accessories
    e, view = await _house(hass, frontend)
    reg, ent = _registered(hass)
    assert ent.entity_id == OLD
    reg.async_update_entity(OLD, new_entity_id=NEW)
    await hass.async_block_till_done()

    assert e.options["dashboard"]["features"]["temperature"] == NEW
    subs = {s.unique_id: s for s in e.subentries.values()}
    assert subs["dashboard-kitchen"].data["favorites"] == [NEW, "light.z"]
    assert subs["lamps"].data["entities"] == [NEW]
    assert accessories.get(hass).data["entities"].get(NEW) == {"name": "Lamp"}
    # never rewritten: a card configuration, a third-party option
    assert subs["energy"].data["view"] == view, "the custom page's cards are untouched"
    assert subs["dashboard-kitchen"].data["wallpanel_options"] == {"x": OLD}
    # and said, both halves
    from homeassistant.components import persistent_notification
    notes = persistent_notification._async_get_or_create_notifications(hass)
    msg = next(n["message"] for k, n in notes.items() if k.startswith(R.NOTIFY_ID))
    assert "light.a" in msg and "custom page Energy" in msg and "wallpanel_options" in msg


async def test_anything_that_is_not_a_rename_changes_nothing(hass, frontend):
    e, _view = await _house(hass, frontend)
    before = (dict(e.options), {s.unique_id: dict(s.data) for s in e.subentries.values()})
    reg, _ent = _registered(hass)
    reg.async_update_entity(OLD, name="A new friendly name")      # an update, no new id
    reg.async_remove(OLD)                                          # a removal
    await hass.async_block_till_done()
    assert (dict(e.options), {s.unique_id: dict(s.data) for s in e.subentries.values()}) == before


async def test_a_failure_changes_nothing_further_and_is_logged(hass, frontend, caplog):
    from unittest.mock import patch
    await _house(hass, frontend)
    reg, _ent = _registered(hass)
    with patch.object(R, "rewrite_options", side_effect=RuntimeError("boom")):
        reg.async_update_entity(OLD, new_entity_id=NEW)
        await hass.async_block_till_done()
    assert "failed; nothing further was changed" in caplog.text


# ------------------------------------------------------ the features' items
def test_a_feature_item_follows_only_the_fields_its_feature_names():
    stored = {"kind": "music", "data": {},
              "options": {"speakers": ["media_player.z", "media_player.a"], "volume": 0.3,
                          "homes": {"u1": "media_player.a", "u2": "media_player.z"}, "note": "media_player.a"}}
    spec = {"options": ("speakers", "homes")}
    out, paths = R.rewrite_feature(stored, spec, "media_player.a", "media_player.b")
    assert out["options"]["speakers"] == ["media_player.z", "media_player.b"]
    assert out["options"]["homes"] == {"u1": "media_player.b", "u2": "media_player.z"}
    assert out["options"]["note"] == "media_player.a", "a field the feature does not name is never touched"
    assert sorted(paths) == ["homes", "speakers"]
    assert stored["options"]["speakers"][1] == "media_player.a", "the original is not mutated"


async def test_a_rename_is_followed_into_music_clean_areas_presets_and_reported_in_chips(hass, frontend):
    """Features became items of the house's entry on 2026-09-28: a renamed
    speaker or vacuum must be followed there, and a custom chip's card that
    names it reported (never rewritten)."""
    from homeassistant.config_entries import ConfigSubentry
    from homeassistant.helpers import entity_registry as er
    from conftest import put_feature
    reg = er.async_get(hass)
    spk = reg.async_get_or_create("media_player", "test", "k1", suggested_object_id="kitchen_ma").entity_id
    vac = reg.async_get_or_create("vacuum", "test", "v1", suggested_object_id="downstairs").entity_id
    music = await put_feature(hass, "music", options={"speakers": [spk, "media_player.x"], "volume": 0.3,
                                                      "homes": {"u1": spk}})
    clean = await put_feature(hass, "clean_areas", options={"vacuums": [vac], "areas": []})
    hass.config_entries.async_add_subentry(frontend, ConfigSubentry(
        data=MappingProxyType({"name": "Downstairs", "group": "media_player.group", "members": [spk, "media_player.x"]}),
        subentry_type="preset", title="Downstairs", unique_id="preset-downstairs"))
    hass.config_entries.async_add_subentry(frontend, ConfigSubentry(
        data=MappingProxyType({"name": "Kitchen music", "card": {"type": "custom:hk-status-chip-card", "entity": spk}}),
        subentry_type="chip", title="Kitchen music", unique_id="kitchen-music"))
    await hass.async_block_till_done()

    reg.async_update_entity(spk, new_entity_id="media_player.kitchen_speaker")
    reg.async_update_entity(vac, new_entity_id="vacuum.downstairs_vacuum")
    await hass.async_block_till_done()

    assert music.options["speakers"] == ["media_player.kitchen_speaker", "media_player.x"]
    assert music.options["homes"] == {"u1": "media_player.kitchen_speaker"}
    assert clean.options["vacuums"] == ["vacuum.downstairs_vacuum"]
    subs = {s.unique_id: s for s in frontend.subentries.values()}
    assert subs["preset-downstairs"].data["members"] == ["media_player.kitchen_speaker", "media_player.x"]
    assert subs["kitchen-music"].data["card"]["entity"] == spk, "a chip's card is never rewritten"
    from homeassistant.components import persistent_notification
    notes = persistent_notification._async_get_or_create_notifications(hass)
    msg = next(n["message"] for k, n in notes.items() if k == f"{R.NOTIFY_ID}_media_player.kitchen_speaker")
    assert "custom chip Kitchen music" in msg and "speakers" in msg


async def test_renaming_the_protected_alarm_moves_the_alarm_pin_with_it(hass, base):
    """The Alarm PIN item names its alarm in data, unique id and title: all
    three move, and the PIN panel keeps mirroring the (renamed) alarm."""
    from homeassistant import config_entries
    from homeassistant.helpers import entity_registry as er
    from conftest import DOMAIN, add_feature, feature_entries
    reg = er.async_get(hass)
    old = reg.async_get_or_create("alarm_control_panel", "lyric", "a1", suggested_object_id="lyric_alarm").entity_id
    hass.states.async_set(old, "disarmed", {"supported_features": 3, "code_format": None})
    r = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    await hass.config_entries.flow.async_configure(r["flow_id"], {})
    await hass.async_block_till_done()
    await add_feature(hass, "alarm_pin", {"alarm": old, "pin": "4321", "pin_again": "4321", "arm_required": True})
    feat = feature_entries(hass, "alarm_pin")[0]
    panel = reg.async_get_entity_id("alarm_control_panel", DOMAIN, feat.entry_id)

    new = "alarm_control_panel.house_alarm"
    reg.async_update_entity(old, new_entity_id=new)
    hass.states.async_remove(old)           # what the alarm's integration does after a rename
    hass.states.async_set(new, "armed_home", {"supported_features": 3, "code_format": None})
    await hass.async_block_till_done()

    feat = feature_entries(hass, "alarm_pin")[0]
    assert feat.data["alarm"] == new
    assert feat.unique_id == f"feature:alarm_pin:{new}"
    assert hass.states.get(panel).state == "armed_home", "the PIN panel mirrors the renamed alarm"
