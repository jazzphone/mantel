"""HK Settings' Music page (features/music/settings_ws.py): what its gear
and the preset / playlist dialogs set, one change at a time, checked by the
same helpers, refused by field, stored where they store it (the Music item
and the house's preset and playlist items) -- and heard by the screens at
once."""
from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from homeassistant import config_entries

from music_sample_house import DOWNG, EVERY, K, LOFT, OFF, ROOMS, music_entry as entry
from music_sample_house import house, music  # noqa: F401 -- the fixtures


class Conn:
    def __init__(self, user):
        self.user, self.sent, self.subscriptions = user, [], {}

    def send_result(self, msg_id, result=None):
        self.sent.append({"id": msg_id, "success": True, "result": result})

    def send_error(self, msg_id, code, message):
        self.sent.append({"id": msg_id, "success": False, "error": code, "message": message})

    def send_message(self, msg):
        self.sent.append(msg)


async def _admin(hass):
    return Conn(await hass.auth.async_create_user("Admin", group_ids=["system-admin"]))


async def _call(hass, conn, which, **msg):
    from custom_components.hk_frontend.features.music import settings_ws as W
    handler = {"get": W.ws_settings_get, "set": W.ws_settings_set, "library": W.ws_library,
               "preset": W.ws_preset_save, "playlist": W.ws_playlist_save,
               "order": W.ws_playlists_order, "remove": W.ws_item_remove}[which]
    handler(hass, conn, {"id": len(conn.sent) + 1, "type": "x", **msg})
    await hass.async_block_till_done(wait_background_tasks=True)
    return conn.sent[-1]


def _why(r, field):
    assert not r["success"], r
    return json.loads(r["message"])[field]


def _with_library(hass):
    """A LOADED Music Assistant entry, stood in for (as the flow tests do)."""
    fake = config_entries.ConfigEntry(
        domain="music_assistant", title="MA", data={}, options={}, source="user", version=1,
        minor_version=1, unique_id=None, discovery_keys={}, subentries_data=None)
    fake._async_set_state(hass, config_entries.ConfigEntryState.LOADED, None)
    real = hass.config_entries.async_entries
    return patch.object(hass.config_entries, "async_entries",
                        lambda d=None, **kw: [fake] if d == "music_assistant" else real(d, **kw))


async def test_the_page_is_the_house_as_configured(hass, music):
    p = (await _call(hass, await _admin(hass), "get"))["result"]
    assert p["configured"] and [s["entity"] for s in p["speakers"]] == ROOMS
    assert p["volume"] == 0.35
    assert {x["name"] for x in p["presets"]} == {"Everywhere", "Downstairs"}
    assert len(p["playlists"]) == 11 and p["playlists"][0]["name"] == "Favorites Mix"
    players = {x["entity"] for x in p["players"]}
    assert set(ROOMS) <= players and {EVERY, DOWNG} <= players, "choices: the speakers and the groups"
    assert any(u["name"] == "Admin" for u in p["users"])


async def test_speakers_in_order_and_what_goes_with_them(hass, music):
    conn = await _admin(hass)
    user = await hass.auth.async_create_user("Loft Tablet")
    r = await _call(hass, conn, "set", changes={"homes": {user.id: LOFT}})
    assert r["success"] and entry(hass).options["homes"] == {user.id: LOFT}
    r = await _call(hass, conn, "set", changes={"speakers": [OFF, K] + [x for x in ROOMS if x not in (OFF, K, LOFT)]})
    assert r["success"], r
    assert entry(hass).options["speakers"][:2] == [OFF, K]
    assert entry(hass).options["homes"] == {}, "a home room that is no longer a speaker goes"
    assert _why(await _call(hass, conn, "set", changes={"speakers": []}), "speakers") == "Choose at least one speaker."
    assert "sync group" in _why(await _call(hass, conn, "set", changes={"speakers": [K, EVERY]}), "speakers")
    assert "Music Assistant player" in _why(await _call(hass, conn, "set", changes={"speakers": ["media_player.tv"]}), "speakers")
    assert entry(hass).options["speakers"][:2] == [OFF, K], "a refusal changes nothing"


async def test_volume_and_home_rooms(hass, music):
    conn = await _admin(hass)
    assert (await _call(hass, conn, "set", changes={"volume": 0.5}))["success"] and entry(hass).options["volume"] == 0.5
    for bad in (2, -0.1, True, "loud"):
        assert _why(await _call(hass, conn, "set", changes={"volume": bad}), "volume") == "Choose 0 to 100 %."
    user = await hass.auth.async_create_user("Kitchen Tablet")
    assert (await _call(hass, conn, "set", changes={"homes": {user.id: K}}))["success"]
    assert entry(hass).options["homes"][user.id] == K
    assert _why(await _call(hass, conn, "set", changes={"homes": {user.id: EVERY}}), "homes") == "A home room must be one of the speakers."
    assert (await _call(hass, conn, "set", changes={"homes": {user.id: None}}))["success"]
    assert user.id not in entry(hass).options["homes"], "none: no home room"
    assert _why(await _call(hass, conn, "set", changes={"loudness": 1}), "loudness") == "That setting doesn’t exist."


async def test_presets_add_edit_and_remove(hass, music):
    conn = await _admin(hass)
    r = await _call(hass, conn, "preset", name=" Upstairs ", group="media_player.upstairs_group", members=[OFF, LOFT])
    assert "Music Assistant player" in _why(r, "group"), "the group must be a player the house has"
    from homeassistant.helpers import entity_registry as er
    # registered BEFORE its state, or the registry picks ..._2 (the id is taken)
    er.async_get(hass).async_get_or_create("media_player", "music_assistant", "ups", suggested_object_id="upstairs_group")
    hass.states.async_set("media_player.upstairs_group", "idle")
    r = await _call(hass, conn, "preset", name=" Upstairs ", group="media_player.upstairs_group", members=[OFF, LOFT])
    assert r["success"], r
    p = [x for x in r["result"]["presets"] if x["name"] == "Upstairs"][0]
    assert p["members"] == [OFF, LOFT]
    assert _why(await _call(hass, conn, "preset", name="", group=EVERY, members=[K]), "name") == "Give it a name."
    assert _why(await _call(hass, conn, "preset", name="X", group=EVERY, members=[]), "members") == "Choose the rooms it plays in."
    assert _why(await _call(hass, conn, "preset", name="X", group=EVERY, members=[EVERY]), "members") == "Every room must be one of the speakers."
    assert "not a room" in _why(await _call(hass, conn, "preset", name="X", group=K, members=[OFF]), "group")
    r = await _call(hass, conn, "preset", item=p["id"], name="Up", group="media_player.upstairs_group", members=[LOFT])
    assert r["success"] and [x for x in r["result"]["presets"] if x["id"] == p["id"]][0]["name"] == "Up"
    assert entry(hass).subentries[p["id"]].title == "Up"
    r = await _call(hass, conn, "remove", item=p["id"])
    assert r["success"] and p["id"] not in entry(hass).subentries
    assert _why(await _call(hass, conn, "remove", item=p["id"]), "item") == "That preset or playlist is gone."


async def test_playlists_add_edit_order_and_remove(hass, music, house):
    conn = await _admin(hass)
    with _with_library(hass):
        lib = (await _call(hass, conn, "library"))["result"]["items"]
        assert {"uri": "library://playlist/124", "name": "Country Hits"} in lib
        assert "isn’t in the Music Assistant library" in _why(
            await _call(hass, conn, "playlist", name="Road", items=["library://playlist/999999"]), "items")
        r = await _call(hass, conn, "playlist", name="Road Trip", icon="mdi:car", items=["library://playlist/124"])
        assert r["success"], r
    pl = r["result"]["playlists"]
    road = [x for x in pl if x["name"] == "Road Trip"][0]
    assert pl[-1]["id"] == road["id"] and road["icon"] == "mdi:car", "a new pill goes last"
    assert _why(await _call(hass, conn, "playlist", name="", items=["x"]), "name") == "Give it a name."
    assert _why(await _call(hass, conn, "playlist", name="Y", items=[]), "items") == "Choose at least one playlist."
    r = await _call(hass, conn, "playlist", item=road["id"], name="Road", items=["library://playlist/124"], chooser="Trips")
    road2 = [x for x in r["result"]["playlists"] if x["id"] == road["id"]][0]
    assert road2["chooser"] == "Trips" and road2["order"] == road["order"] and road2["icon"] == "mdi:car", "an edit keeps its place and icon"
    assert entry(hass).subentries[road["id"]].title == "Trips · Road"
    ids = [x["id"] for x in r["result"]["playlists"]]
    r = await _call(hass, conn, "order", ids=[ids[-1]] + ids[:-1])
    assert [x["id"] for x in r["result"]["playlists"]][0] == road["id"], "moved to the front"
    assert _why(await _call(hass, conn, "order", ids=["nope"]), "ids") == "That preset or playlist is gone."
    assert (await _call(hass, conn, "remove", item=road["id"]))["success"] and road["id"] not in entry(hass).subentries


async def test_the_screens_hear_it_at_once(hass, music):
    from custom_components.hk_frontend.features.music import ws_music_subscribe
    tablet = Conn(await hass.auth.async_create_user("Kitchen"))
    ws_music_subscribe(hass, tablet, {"id": 9, "type": "hk_music/subscribe"})
    before = len(tablet.sent)
    await _call(hass, await _admin(hass), "set", changes={"volume": 0.6})
    await hass.async_block_till_done()
    events = [m["event"] for m in tablet.sent[before:] if m.get("type") == "event"]
    assert events and events[-1]["volume"] == 0.6


async def test_only_an_admin(hass, music):
    from homeassistant.exceptions import Unauthorized
    await hass.auth.async_create_user("Owner")
    with pytest.raises(Unauthorized):
        await _call(hass, Conn(await hass.auth.async_create_user("Kitchen")), "set", changes={"volume": 0.1})


async def test_before_it_is_added_the_page_says_so(hass, frontend):
    conn = await _admin(hass)
    assert (await _call(hass, conn, "get"))["result"] == {"configured": False}
    r = await _call(hass, conn, "set", changes={"volume": 0.5})
    assert not r["success"] and r["error"] == "not_set_up" and r["message"] == "Music is not added"
