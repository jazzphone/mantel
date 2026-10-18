"""Music, a feature of HK Frontend: adding it (an item of the house's
entry), its gear, presets and playlists (items of the house's entry too) --
and what a screen is handed over the websocket as a result."""
from __future__ import annotations

from unittest.mock import patch

import pytest

from homeassistant import config_entries
from homeassistant.helpers import area_registry as ar, floor_registry as fr
from homeassistant.helpers import entity_registry as er

from conftest import DOMAIN, FakeConnection, add_feature, entry, feature_entries, feature_gear, update_feature
from music_sample_house import DOWNG, EVERY, K, LOFT, OFF, ROOMS, music_entry
from music_sample_house import house, music  # noqa: F401 -- the fixtures

ACTIONS = {"music_play", "music_transfer", "music_stop", "music_transport", "music_play_media"}


def with_library(hass):
    """A LOADED Music Assistant entry is what the forms look for. Stood in
    for, so the real integration (and its client library) is never imported."""
    fake_ma = config_entries.ConfigEntry(
        domain="music_assistant", title="MA", data={}, options={}, source="user",
        version=1, minor_version=1, unique_id=None, discovery_keys={}, subentries_data=None)
    fake_ma._async_set_state(hass, config_entries.ConfigEntryState.LOADED, None)
    real = hass.config_entries.async_entries
    return patch.object(hass.config_entries, "async_entries",
                        lambda d=None, **kw: [fake_ma] if d == "music_assistant" else real(d, **kw))


# ------------------------------------------------------------------ setup
async def test_the_sample_house_is_what_the_tests_run_on(hass, music):
    e = music_entry(hass)
    assert e.title == "Music" and e.data["kind"] == "music"
    assert e.options["speakers"] == ROOMS
    assert e.options["volume"] == 0.35
    subs = list(e.subentries.values())
    presets = [s for s in subs if s.subentry_type == "preset"]
    playlists = [s for s in subs if s.subentry_type == "playlist"]
    assert [p.title for p in presets] == ["Everywhere", "Downstairs"]
    assert len(playlists) == 11
    decades = [p for p in playlists if p.data.get("chooser") == "Decades"]
    assert len(decades) == 6 and decades[0].title == "Decades · 2020s"


async def test_only_one_per_house(hass, music):
    """Once added, the feature menu no longer offers it."""
    flows = hass.config_entries.subentries
    r = await flows.async_init((entry(hass).entry_id, "feature"), context={"source": "user"})
    assert r["type"] == "menu" and "music" not in r["menu_options"]
    assert "clean_areas" in r["menu_options"]
    flows.async_abort(r["flow_id"])


async def test_setup_starts_empty_and_assumes_no_house(hass, frontend, house):
    """Adding it asks nothing and imports nothing: no speakers, no presets,
    no playlists, no home rooms."""
    await hass.auth.async_create_user("kitchen")
    flows = hass.config_entries.subentries
    r = await flows.async_init((frontend.entry_id, "feature"), context={"source": "user"})
    assert r["type"] == "menu" and "music" in r["menu_options"]
    r = await flows.async_configure(r["flow_id"], {"next_step_id": "music"})
    assert r["type"] == "form" and r["step_id"] == "music" and not r["data_schema"].schema
    r = await flows.async_configure(r["flow_id"], {})
    assert r["type"] == "create_entry" and r["title"] == "Music"
    await hass.async_block_till_done()
    e = music_entry(hass)
    assert e.options == {"speakers": [], "volume": 0.35, "homes": {}}
    assert e.unique_id == "feature:music" and e.loaded
    assert not e.subentries, "no presets, no playlists"
    assert ACTIONS <= set(hass.services.async_services_for_domain(DOMAIN))


async def music_page(hass, e):
    """Its gear: opens on the speakers page."""
    r = await feature_gear(hass, e)
    assert r["type"] == "form" and r["step_id"] == "music_options"
    return r


async def submit(hass, r, user_input):
    """The next page of a gear or an item's form."""
    r = await hass.config_entries.subentries.async_configure(r["flow_id"], user_input)
    await hass.async_block_till_done()
    return r


def saved(r):
    return r["type"] == "abort" and r["reason"] == "reconfigure_successful"


# ---------------------------------------------------------------- options
async def test_its_gear_sets_speakers_volume_and_homes(hass, music):
    user = await hass.auth.async_create_user("kitchen")
    e = music_entry(hass)
    r = await music_page(hass, e)
    r = await submit(hass, r, {"speakers": [K, OFF, LOFT], "volume": 20})
    assert r["step_id"] == "music_homes"
    assert "kitchen" in r["data_schema"].schema
    r = await submit(hass, r, {"kitchen": OFF})
    assert saved(r)
    assert e.options["speakers"] == [K, OFF, LOFT]
    assert e.options["volume"] == 0.2
    assert e.options["homes"] == {user.id: OFF}
    assert music.config.volume == 0.2
    assert music.config.room_ids == [K, OFF, LOFT]


async def test_its_gear_refuses_nonsense(hass, music):
    from homeassistant.data_entry_flow import InvalidData
    e = music_entry(hass)
    r = await music_page(hass, e)
    r = await submit(hass, r, {"speakers": [], "volume": 35})
    # the feature item's flows share one error table: Music's codes carry its prefix
    assert r["errors"] == {"speakers": "music_no_speakers"}
    # A preset's sync group is not even OFFERED as a room: the picker excludes
    # it, so HA's own schema refuses it before this flow's check is reached.
    with pytest.raises(InvalidData):
        await submit(hass, r, {"speakers": [K, DOWNG], "volume": 35})


async def test_its_gear_keeps_what_it_does_not_show(hass, music):
    e = music_entry(hass)
    update_feature(hass, e, options={**e.options, "future": 1})
    await hass.async_block_till_done()
    r = await music_page(hass, e)
    r = await submit(hass, r, {"speakers": [OFF], "volume": 35})
    r = await submit(hass, r, {})
    assert saved(r) and e.options["future"] == 1 and e.options["speakers"] == [OFF]


async def test_a_home_room_must_be_one_of_the_speakers(hass, music):
    """A room that is no longer a speaker is neither offered nor kept."""
    from homeassistant.data_entry_flow import InvalidData
    user = await hass.auth.async_create_user("kitchen")
    e = music_entry(hass)
    update_feature(hass, e, options={**e.options, "homes": {user.id: K}})
    await hass.async_block_till_done()
    r = await music_page(hass, e)
    r = await submit(hass, r, {"speakers": [OFF], "volume": 35})
    with pytest.raises(InvalidData):
        await submit(hass, r, {"kitchen": K})
    r = await submit(hass, r, {})
    assert saved(r) and e.options["homes"] == {}


# ---------------------------------------------------------------- presets
async def test_add_and_edit_a_preset(hass, music):
    e = music_entry(hass)
    r = await hass.config_entries.subentries.async_init((e.house.entry_id, "preset"),
                                                        context={"source": "user"})
    assert r["step_id"] == "user"
    r = await hass.config_entries.subentries.async_configure(
        r["flow_id"], {"name": "Upstairs", "group": "media_player.upstairs_group",
                       "members": [OFF, LOFT]})
    assert r["type"] == "create_entry"
    assert [p.name for p in music.config.presets][-1] == "Upstairs"
    sub = next(s for s in e.subentries.values() if s.title == "Upstairs")
    assert sub.subentry_type == "preset" and sub.subentry_id in entry(hass).subentries, "an item of the house"
    r = await hass.config_entries.subentries.async_init(
        (e.house.entry_id, "preset"), context={"source": "reconfigure", "subentry_id": sub.subentry_id})
    r = await hass.config_entries.subentries.async_configure(
        r["flow_id"], {"name": "Top Floor", "group": "media_player.upstairs_group",
                       "members": [OFF, LOFT]})
    assert r["reason"] == "reconfigure_successful"
    assert e.subentries[sub.subentry_id].title == "Top Floor"


async def test_preset_validation(hass, music):
    from homeassistant.data_entry_flow import InvalidData
    e = music_entry(hass)
    r = await hass.config_entries.subentries.async_init((e.house.entry_id, "preset"),
                                                        context={"source": "user"})
    r = await hass.config_entries.subentries.async_configure(
        r["flow_id"], {"name": "X", "group": "media_player.g", "members": []})
    assert r["errors"] == {"members": "no_members"}
    # A room is not offered as the group, nor a non-speaker as a member: the
    # pickers exclude them, so HA's schema refuses before the flow's checks.
    with pytest.raises(InvalidData):
        await hass.config_entries.subentries.async_configure(
            r["flow_id"], {"name": "X", "group": K, "members": [OFF]})
    with pytest.raises(InvalidData):
        await hass.config_entries.subentries.async_configure(
            r["flow_id"], {"name": "X", "group": "media_player.g", "members": ["media_player.tv"]})


async def test_its_items_are_presets_and_playlists_only(hass, music, frontend):
    """Its presets and playlists are items of the house's entry; what Music
    reads as its own are those and nothing else of the house's (not its own
    item, not a dashboard's)."""
    e = music_entry(hass)
    assert e.entry_id in frontend.subentries and frontend.subentries[e.entry_id].subentry_type == "feature"
    assert {s.subentry_type for s in e.subentries.values()} == {"preset", "playlist"}
    assert set(e.subentries) == {k for k, s in frontend.subentries.items() if s.subentry_type in ("preset", "playlist")}


async def test_presets_and_playlists_wait_for_music(hass, frontend, house):
    """Add preset and Add playlist say Music is not added; once it is, they
    are the forms."""
    flows = hass.config_entries.subentries
    for kind in ("preset", "playlist"):
        r = await flows.async_init((frontend.entry_id, kind), context={"source": "user"})
        assert r["type"] == "abort" and r["reason"] == "music_not_added", kind
    await add_feature(hass, "music", {})
    for kind in ("preset", "playlist"):
        r = await flows.async_init((frontend.entry_id, kind), context={"source": "user"})
        assert r["type"] == "form" and r["step_id"] == "user", kind
        flows.async_abort(r["flow_id"])


# -------------------------------------------------------------- playlists
async def test_add_a_playlist_from_the_library(hass, music, house):
    e = music_entry(hass)
    with with_library(hass):
        r = await hass.config_entries.subentries.async_init((e.house.entry_id, "playlist"),
                                                            context={"source": "user"})
    options = r["data_schema"].schema["items"].config["options"]
    assert {"value": "library://playlist/124", "label": "Country Hits"} in options
    r = await hass.config_entries.subentries.async_configure(
        r["flow_id"], {"name": "Road Trip", "icon": "mdi:car", "items": ["library://playlist/124"],
                       "order": 5})
    assert r["type"] == "create_entry"
    pl = music.config.playlist(next(s.subentry_id for s in e.subentries.values()
                                    if s.title == "Road Trip"))
    assert pl.items == ["library://playlist/124"] and pl.icon == "mdi:car"
    assert house.called("get_library")[0]["media_type"] == "playlist"


async def test_a_playlist_needs_a_name_and_an_item(hass, music):
    e = music_entry(hass)
    r = await hass.config_entries.subentries.async_init((e.house.entry_id, "playlist"),
                                                        context={"source": "user"})
    r = await hass.config_entries.subentries.async_configure(r["flow_id"], {"name": "", "items": ["x"]})
    assert r["errors"] == {"name": "no_name"}
    r = await hass.config_entries.subentries.async_configure(r["flow_id"], {"name": "A", "items": []})
    assert r["errors"] == {"items": "no_items"}


async def test_a_new_playlist_is_playable_at_once(hass, music, house):
    e = music_entry(hass)
    r = await hass.config_entries.subentries.async_init((e.house.entry_id, "playlist"),
                                                        context={"source": "user"})
    await hass.config_entries.subentries.async_configure(
        r["flow_id"], {"name": "Fresh", "items": ["library://playlist/999"], "order": 1})
    pk = next(s.subentry_id for s in e.subentries.values() if s.title == "Fresh")
    res = await music.play([OFF], pk)
    assert res["ok"] and "999" in str(house.called("ma_play_media")[-1]["media_id"])


async def test_a_playlist_link_the_library_lacks_is_refused(hass, music, house):
    e = music_entry(hass)
    with with_library(hass):
        r = await hass.config_entries.subentries.async_init((e.house.entry_id, "playlist"),
                                                            context={"source": "user"})
        r = await hass.config_entries.subentries.async_configure(
            r["flow_id"], {"name": "Dead", "items": ["library://playlist/999999"], "order": 1})
    assert r["errors"] == {"items": "not_in_library"}


# ------------------------------------------------------ what screens receive
async def test_screens_get_floors_names_choosers_and_their_own_home(hass, music, house):
    floors = fr.async_get(hass)
    areas = ar.async_get(hass)
    ents = er.async_get(hass)
    up = floors.async_create("Upstairs", level=2)
    main = floors.async_create("Main Floor", level=1)
    for entity, name, floor in ((K, "Kitchen", main), (OFF, "Office", up),
                                (LOFT, "Loft", up)):
        area = areas.async_create(name, floor_id=floor.floor_id)
        # Registered BEFORE its state exists, or the registry avoids the
        # taken id and names it `..._2`.
        st = hass.states.get(entity)
        hass.states.async_remove(entity)
        reg = ents.async_get_or_create("media_player", "music_assistant", entity,
                                       suggested_object_id=entity.split(".")[1])
        assert reg.entity_id == entity
        ents.async_update_entity(entity, area_id=area.id)
        hass.states.async_set(entity, st.state, st.attributes)
    from custom_components.hk_frontend.features.music import ws_music_subscribe
    kitchen_user = await hass.auth.async_create_user("kitchen")
    e = music_entry(hass)
    update_feature(hass, e, options={**e.options, "homes": {kitchen_user.id: K}})
    await hass.async_block_till_done()
    conn = FakeConnection(kitchen_user)
    ws_music_subscribe(hass, conn, {"id": 1, "type": "hk_music/subscribe"})
    assert conn.sent[0]["success"]
    cfg = conn.sent[-1]["event"]
    assert cfg["home"] == K, "the kitchen tablet's user gets the Kitchen"
    other = FakeConnection(await hass.auth.async_create_user("someone"))
    ws_music_subscribe(hass, other, {"id": 2, "type": "hk_music/subscribe"})
    assert other.sent[-1]["event"]["home"] is None, "and nobody else does"
    assert cfg["configured"] is True
    names = {s["entity"]: s["name"] for s in cfg["speakers"]}
    assert names[K] == "Kitchen" and names[DOWNG] == "Downstairs"
    assert cfg["floors"][0]["name"] == "Main Floor" and K in cfg["floors"][0]["entities"]
    assert any(f["name"] == "Upstairs" and OFF in f["entities"] for f in cfg["floors"])
    decades = next(p for p in cfg["playlists"] if p["name"] == "Decades")
    assert [o["name"] for o in decades["options"]][:2] == ["2020s", "2010s"]
    assert cfg["speakers"][0]["entity"] == EVERY and cfg["speakers"][0]["members"] == ROOMS
    # a change reaches the screen without a reload
    before = len(conn.sent)
    r = await music_page(hass, e)
    r = await submit(hass, r, {"speakers": ROOMS, "volume": 10})
    assert saved(await submit(hass, r, {}))
    assert len(conn.sent) > before
    assert conn.sent[-1]["event"]["volume"] == 0.1
    # and closing the subscription stops the messages
    conn.subscriptions[1]()
    n = len(conn.sent)
    update_feature(hass, e, options={**e.options, "volume": 0.3})
    await hass.async_block_till_done()
    assert len(conn.sent) == n


async def test_a_renamed_area_reaches_the_screens(hass, music, house):
    from custom_components.hk_frontend.features.music import ws_music_subscribe
    conn = FakeConnection(None)
    ws_music_subscribe(hass, conn, {"id": 1, "type": "hk_music/subscribe"})
    before = len(conn.sent)
    ar.async_get(hass).async_create("Porch")
    await hass.async_block_till_done()
    assert len(conn.sent) > before


async def test_actions_answer_the_caller(hass, music, house):
    pk = next(p.key for p in music.config.playlists if p.name == "Country")
    res = await hass.services.async_call(DOMAIN, "music_play", {"rooms": [OFF], "playlist": pk},
                                         blocking=True, return_response=True)
    assert res == {"ok": True, "leader": OFF}
    res = await hass.services.async_call(DOMAIN, "music_transport",
                                         {"player": OFF, "command": "play_pause"},
                                         blocking=True, return_response=True)
    assert res == {"ok": True}
    house.set(OFF, "playing", media_content_id="q1")
    res = await hass.services.async_call(DOMAIN, "music_transfer", {"rooms": [LOFT], "source": OFF},
                                         blocking=True, return_response=True)
    assert res == {"ok": True, "leader": LOFT}
    res = await hass.services.async_call(DOMAIN, "music_play_media",
                                         {"player": OFF, "media_content_id": "library://track/1",
                                          "media_content_type": "music"},
                                         blocking=True, return_response=True)
    assert res == {"ok": True, "leader": OFF}
    res = await hass.services.async_call(DOMAIN, "music_stop", {}, blocking=True, return_response=True)
    assert res == {"ok": True}
    res = await hass.services.async_call(DOMAIN, "music_play", {"rooms": [OFF], "playlist": "nope"},
                                         blocking=True, return_response=True)
    assert res["ok"] is False
    # the actions are HK Frontend's own: nothing under hk_music
    assert not hass.services.has_service("hk_music", "play")


async def test_actions_before_the_feature_is_added_say_so(hass, frontend, house):
    from homeassistant.exceptions import ServiceValidationError
    assert not feature_entries(hass, "music")
    with pytest.raises(ServiceValidationError) as err:
        await hass.services.async_call(DOMAIN, "music_stop", {}, blocking=True, return_response=True)
    assert err.value.translation_domain == DOMAIN
    assert err.value.translation_key == "music_not_set_up"


async def test_the_feed_says_not_configured_before_it_is_added(hass, frontend):
    from custom_components.hk_frontend.features.music import ws_music_subscribe
    conn = FakeConnection(None)
    ws_music_subscribe(hass, conn, {"id": 1, "type": "hk_music/subscribe"})
    assert conn.sent[-1]["event"] == {"configured": False}
    r = await add_feature(hass, "music", {})
    assert r["type"] == "create_entry"
    assert conn.sent[-1]["event"]["configured"] is True, "told once it is running"


async def test_two_users_with_one_name_keep_their_own_rooms(hass, music):
    """A home-room field is keyed by the user's name; two people called the
    same get their id appended rather than sharing one field."""
    a = await hass.auth.async_create_user("Tablet")
    b = await hass.auth.async_create_user("Tablet")
    e = music_entry(hass)
    r = await music_page(hass, e)
    r = await submit(hass, r, {"speakers": [OFF, K], "volume": 35})
    keys = [str(k) for k in r["data_schema"].schema]
    ka = next(k for k in keys if a.id[:6] in k)
    kb = next(k for k in keys if b.id[:6] in k)
    r = await submit(hass, r, {ka: OFF, kb: K})
    assert saved(r)
    assert e.options["homes"][a.id] == OFF and e.options["homes"][b.id] == K


async def test_diagnostics(hass, music):
    """The house's diagnostics carry each feature's own export."""
    from custom_components.hk_frontend.diagnostics import (
        async_get_config_entry_diagnostics,
    )
    e = music_entry(hass)
    d = (await async_get_config_entry_diagnostics(hass, entry(hass)))["features"][f"Music ({e.entry_id})"]
    assert d["kind"] == "music" and d["options"]["speakers"] == ROOMS
    assert len(d["subentries"]) == 13
    assert d["resolved"]["configured"] is True and d["resolved"]["volume"] == 0.35
    assert d["running"] is True
