"""HK's settings, Mantel's, while linked (linked_mode.py MIRROR; Mantel's linked_settings.py and decision 29 in
docs/phase9/TWO-PRODUCTS.md): the link asks for them (features=settings), the dashboards' settings feed is
answered from the last ones Mantel sent and follows each new one, the same version sent again changes nothing,
they survive a restart without Mantel, and while the house is Home Assistant's the entry's own are used."""
from __future__ import annotations

import pytest

from conftest import FakeConnection
from mantel_fake import FULL, FakeMantel, until
from test_linked_mode import _linked, _unload

SETTINGS = {"type": "settings", "version": "v1",
            "payload": {"configured": True, "boards": {"dashboard-den": {"title": "Den"}}, "personal": {}}}


@pytest.fixture
async def mantel(socket_enabled):
    fake = await FakeMantel().start()
    yield fake
    await fake.close()


def _feed(hass):
    from custom_components.hk_frontend import ws_settings_subscribe
    conn = FakeConnection(None)
    ws_settings_subscribe(hass, conn, {"id": 5, "type": "hk_frontend/settings/subscribe"})
    return conn


def _events(conn):
    """The feed's events, without `places` (where HK's texts send someone: added while Mantel runs the house)."""
    return [{k: v for k, v in m["event"].items() if k != "places"} for m in conn.sent if m.get("type") == "event"]


async def test_the_link_asks_for_the_settings(hass, base, mantel):
    e = await _linked(hass, mantel)
    assert "settings" in mantel.headers[-1]["X-Mantel-Link"].split("features=", 1)[1].split(",")
    await _unload(hass, e)


async def test_the_dashboards_get_mantel_s_settings_and_follow_them(hass, base, mantel):
    e = await _linked(hass, mantel)
    await mantel.push(SETTINGS)
    from custom_components.hk_frontend import linked_mode
    await until(hass, lambda: linked_mode.mirrored(hass) is not None)
    conn = _feed(hass)
    assert _events(conn)[-1] == SETTINGS["payload"], "the feed is Mantel's, not the entry's own"
    n = len(_events(conn))
    await mantel.push(SETTINGS)                   # the same version again: nothing new
    await mantel.push({**SETTINGS, "version": "v2",
                       "payload": {**SETTINGS["payload"], "boards": {"dashboard-den": {"title": "Study"}}}})
    await until(hass, lambda: len(_events(conn)) > n)
    await hass.async_block_till_done()
    assert len(_events(conn)) == n + 1 and _events(conn)[-1]["boards"]["dashboard-den"]["title"] == "Study"
    await _unload(hass, e)


async def test_settings_sent_badly_are_ignored(hass, base, mantel):
    e = await _linked(hass, mantel)
    for bad in ({"type": "settings", "version": 3, "payload": {}}, {"type": "settings", "version": "v", "payload": []},
                {"type": "settings", "version": "x" * 65, "payload": {}}):
        await mantel.push(bad)
    await mantel.push(SETTINGS)
    from custom_components.hk_frontend import linked_mode
    await until(hass, lambda: linked_mode.mirrored(hass) is not None)
    assert {k: v for k, v in linked_mode.mirrored(hass).items() if k != "places"} == SETTINGS["payload"]
    await _unload(hass, e)


async def test_a_restart_without_mantel_keeps_the_last_settings(hass, base, mantel, hass_storage):
    from custom_components.hk_frontend import linked_mode
    hass_storage[linked_mode.MIRROR_STORE] = {"version": linked_mode.MIRROR_VERSION, "minor_version": 1,
                                              "key": linked_mode.MIRROR_STORE,
                                              "data": {"version": "v1", "payload": SETTINGS["payload"]}}
    await mantel.close()                          # Mantel is away
    e = await _linked(hass, mantel, wait=False)
    assert _events(_feed(hass))[-1] == SETTINGS["payload"], "the dashboards still draw, with the last settings"
    await _unload(hass, e)


async def test_while_the_house_is_home_assistant_s_its_own_settings_are_used(hass, base, mantel):
    owners = {**FULL, "house": "ha"}
    mantel.owners = owners
    e = await _linked(hass, mantel, owners=owners, wait=False)
    await mantel.push(SETTINGS)
    await hass.async_block_till_done()
    from custom_components.hk_frontend import linked_mode
    assert linked_mode.mirrored(hass) is None
    assert _events(_feed(hass))[-1] != SETTINGS["payload"]
    await _unload(hass, e)


# ------------------------------------------------------------ saves, to Mantel
FAVORITE = {"type": "hk_frontend/board/favorite", "dashboard": "dashboard-den", "entity_id": "light.den",
            "favorite": True}


class Conn(FakeConnection):
    def send_result(self, msg_id, result=None):
        self.sent.append({"id": msg_id, "type": "result", "success": True, "result": result})

    def send_error(self, msg_id, code, message, *args, **kwargs):
        self.sent.append({"id": msg_id, "type": "result", "success": False,
                          "error": {"code": code, "message": message}})


async def _mirror(hass, mantel):
    from custom_components.hk_frontend import linked_mode
    await mantel.push(SETTINGS)
    await until(hass, lambda: linked_mode.mirrored(hass) is not None)


async def _save(hass, user, msg):
    """One save, through the handler HA has registered for it (as a page's websocket call reaches it)."""
    from homeassistant.components import websocket_api
    handler, schema = hass.data[websocket_api.DOMAIN][msg["type"]]
    conn = Conn(user)
    handler(hass, conn, schema({"id": 3, **msg}) if callable(schema) else {"id": 3, **msg})
    await until(hass, lambda: any(m.get("id") == 3 for m in conn.sent))
    return next(m for m in conn.sent if m.get("id") == 3)


async def _admin(hass):
    return await hass.auth.async_create_user("Fictional Admin", group_ids=["system-admin"])


async def test_a_save_goes_to_mantel_as_the_user_who_made_it(hass, base, mantel):
    e = await _linked(hass, mantel)
    await _mirror(hass, mantel)
    user = await _admin(hass)
    got = await _save(hass, user, FAVORITE)
    assert got["success"] and got["result"] == {"ok": True}, got
    sent = mantel.calls("settings_write")[-1]
    assert sent["msg"] == FAVORITE, "the save exactly as the page made it, without its id"
    assert sent["ha_user"] == user.id
    await _unload(hass, e)


async def test_mantel_s_refusal_reaches_the_page_in_its_words(hass, base, mantel):
    async def refuse(ws, msg):
        if msg.get("type") == "settings_write":
            return {"id": msg["id"], "type": "result", "success": False,
                    "error": {"code": "not_linked", "message": "Link your Home Assistant user to a person in Mantel"}}
        return await mantel.ok(ws, msg)
    mantel.answer = refuse
    e = await _linked(hass, mantel)
    await _mirror(hass, mantel)
    got = await _save(hass, await _admin(hass), FAVORITE)
    assert not got["success"] and got["error"]["code"] == "not_linked"
    assert "Link your Home Assistant user" in got["error"]["message"]
    await _unload(hass, e)


async def test_a_save_while_mantel_is_away_says_so(hass, base, mantel):
    e = await _linked(hass, mantel)
    await _mirror(hass, mantel)
    from custom_components.hk_frontend import linked_mode
    await mantel.close()
    await until(hass, lambda: not linked_mode.active(hass).connected)
    got = await _save(hass, await _admin(hass), FAVORITE)
    assert not got["success"] and got["error"]["code"] == "mantel_away"
    await _unload(hass, e)


async def test_while_the_house_is_home_assistant_s_a_save_stays_here(hass, base, mantel):
    owners = {**FULL, "house": "ha"}
    mantel.owners = owners
    e = await _linked(hass, mantel, owners=owners, wait=False)
    await mantel.push(SETTINGS)
    await hass.async_block_till_done()
    await _save(hass, await _admin(hass), FAVORITE)
    assert mantel.calls("settings_write") == [], "the house is Home Assistant's: the save is the entry's own"
    await _unload(hass, e)


async def test_a_screen_save_with_the_version_it_opened_goes_to_mantel_with_it(hass, base, mantel):
    """SET-7: board/set's expect_version passes HA's own schema (which checks first) and reaches Mantel unchanged:
    Mantel's settings store compares it, and its `conflict` reaches the page in its words."""
    async def conflict(ws, msg):
        if msg.get("type") == "settings_write":
            return {"id": msg["id"], "type": "result", "success": False,
                    "error": {"code": "conflict", "message": "board/dashboard-den changed meanwhile (now version 4)"}}
        return await mantel.ok(ws, msg)
    mantel.answer = conflict
    e = await _linked(hass, mantel)
    await _mirror(hass, mantel)
    save = {"type": "hk_frontend/board/set", "dashboard": "dashboard-den", "expect_version": 3,
            "changes": {"home_style": "grid"}}
    got = await _save(hass, await _admin(hass), save)
    assert mantel.calls("settings_write")[-1]["msg"] == save
    assert not got["success"] and got["error"]["code"] == "conflict"
    await _unload(hass, e)


async def test_a_layout_save_with_the_version_it_opened_goes_to_mantel_with_it(hass, base, mantel):
    """Edit mode: accessory/order, page_order, room_scenes and set take expect_version in HA's schema (Mantel's
    whole numbers too) and reach Mantel unchanged, which compares it with its accessories document."""
    e = await _linked(hass, mantel)
    await _mirror(hass, mantel)
    user = await _admin(hass)
    for save in ({"type": "hk_frontend/accessory/order", "area_id": "den", "entities": ["light.lamp"], "expect_version": 7},
                 {"type": "hk_frontend/accessory/page_order", "page": "security", "entities": [], "expect_version": 7},
                 {"type": "hk_frontend/accessory/room_scenes", "area_id": "den", "entities": None, "expect_version": 7},
                 {"type": "hk_frontend/accessory/set", "entity_id": "light.lamp", "size": "tall", "expect_version": 7}):
        got = await _save(hass, user, save)
        assert got["success"], (save, got)
        assert mantel.calls("settings_write")[-1]["msg"] == save
    await _unload(hass, e)


async def test_a_room_order_save_with_the_version_it_opened_goes_to_mantel_with_it(hass, base, mantel):
    """Edit mode's Room Order (settings/set {rooms.order, rooms.menu}) takes expect_version in HA's schema
    (Mantel's whole numbers too) and reaches Mantel unchanged, which compares it with its house settings."""
    e = await _linked(hass, mantel)
    await _mirror(hass, mantel)
    save = {"type": "hk_frontend/settings/set", "changes": {"rooms.order": ["den"], "rooms.menu": "order"},
            "expect_version": 7}
    got = await _save(hass, await _admin(hass), save)
    assert got["success"], got
    assert mantel.calls("settings_write")[-1]["msg"] == save
    await _unload(hass, e)


async def _panel_versions(hass, user):
    from custom_components.hk_frontend.panel import ws_panel_get
    conn = Conn(user)
    ws_panel_get(hass, conn, {"id": 9, "type": "hk_frontend/panel/get"})
    await until(hass, lambda: any(m.get("id") == 9 for m in conn.sent))
    got = next(m for m in conn.sent if m.get("id") == 9)
    assert got["success"], got
    return got["result"]["versions"]


async def test_panel_get_while_linked_gives_mantel_s_versions(hass, base, mantel):
    """While the settings are Mantel's, the saves the pages make go to Mantel, which compares their
    expect_version with its own documents' numbers: so panel/get (what Edit mode and HK Settings read the
    versions from) gives the ones Mantel's settings frame carried -- never this host's digests, which Mantel
    refuses. A frame without them (an older Mantel): none, and the saves go without a version, as before."""
    from custom_components.hk_frontend import linked_mode
    e = await _linked(hass, mantel)
    user = await _admin(hass)
    own = await _panel_versions(hass, user)
    assert isinstance(own["house"], str) and isinstance(own["accessories"], str), "not linked yet: this host's own"
    theirs = {"board/dashboard-den": 4, "accessories": 9, "house": 12, "house/settings": 12}
    await mantel.push({**SETTINGS, "versions": theirs})
    await until(hass, lambda: linked_mode.mirrored(hass) is not None)
    assert await _panel_versions(hass, user) == theirs
    # the same settings, newer numbers (a save that changed nothing the feed shows): taken all the same
    await mantel.push({**SETTINGS, "versions": {**theirs, "house": 13}})
    await until(hass, lambda: linked_mode.mirrored_versions(hass) == {**theirs, "house": 13})
    await mantel.push({**SETTINGS, "version": "v2"})
    await until(hass, lambda: linked_mode.mirrored_versions(hass) == {})
    assert await _panel_versions(hass, user) == {}
    await _unload(hass, e)


# ------------------------------------------------------------ setup: Repairs, and the dashboards reported
async def test_a_repairs_issue_while_admins_can_t_save(hass, base, mantel):
    from homeassistant.helpers import issue_registry as ir
    from custom_components.hk_frontend import linked_mode
    e = await _linked(hass, mantel)
    await mantel.push({**SETTINGS, "setup": {"saves": True, "unlinked_admins": 2}})
    await until(hass, lambda: ir.async_get(hass).async_get_issue("hk_frontend", linked_mode.ISSUE_UNLINKED) is not None)
    issue = ir.async_get(hass).async_get_issue("hk_frontend", linked_mode.ISSUE_UNLINKED)
    assert issue.translation_placeholders == {"count": "2"}
    # the same settings, now everyone linked: the issue clears (the version is the same; the setup is still read)
    await mantel.push({**SETTINGS, "setup": {"saves": True, "unlinked_admins": 0}})
    await until(hass, lambda: ir.async_get(hass).async_get_issue("hk_frontend", linked_mode.ISSUE_UNLINKED) is None)
    # saves off: nothing to fix from here
    await mantel.push({**SETTINGS, "setup": {"saves": False, "unlinked_admins": 3}})
    await hass.async_block_till_done()
    assert ir.async_get(hass).async_get_issue("hk_frontend", linked_mode.ISSUE_UNLINKED) is None
    await _unload(hass, e)


async def test_the_dashboards_are_reported_on_connect(hass, base, mantel):
    e = await _linked(hass, mantel)
    await until(hass, lambda: mantel.calls("report"))
    rep = mantel.calls("report")[-1]["report"]
    assert set(rep) == {"hk_dashboards"} and isinstance(rep["hk_dashboards"], list)
    await _unload(hass, e)


# ------------------------------------------------------------ handed back (mirror.py)
HANDED = {"configured": True, "clock": {"time": "sensor.fictional_time", "date": "sensor.date"},
          "calendar": {"entities": [], "colors": {}, "keywords": [], "event_colors": {"uid:e2e": "teal"}},
          "browse": {"discover": [{"key": "recent", "kind": "x"}]},
          "boards": {"dashboard-den": {"accent": "blue", "menu_custom": True, "tablets": ["den"], "idle_room": "den",
                                       "title": "Den"}},
          "tablet_items": {"den": {"name": "Den Tablet", "screen": "dashboard-den", "room": "", "user": "", "app": "",
                                   "idle_return": True, "idle_time": 50, "black_screen": "hk",
                                   "screensaver_switch": None, "black_switch": None}},
          "popups": [{"hash": "door", "name": "Front Door", "kind": "camera", "entity": "camera.front"}],
          "custom_pages": [], "custom_chips": [],
          "accessories": {"entities": {"light.den": {"name": "Den Lamp"}}, "rooms": {}, "into": {}, "pages": {}},
          "personal": {}}


def _stored(hass_storage, owned=True):
    from custom_components.hk_frontend import linked_mode
    hass_storage[linked_mode.MIRROR_STORE] = {"version": linked_mode.MIRROR_VERSION, "minor_version": 1,
                                              "key": linked_mode.MIRROR_STORE,
                                              "data": {"version": "v9", "payload": HANDED, "owned": owned}}


async def test_settings_handed_back_are_taken_in_once(hass, base, hass_storage):
    from conftest import house_entry
    from custom_components.hk_frontend import accessories, linked_mode, settings as S
    _stored(hass_storage)
    e = house_entry()                           # not linked (any more): the settings are this entry's own
    e.add_to_hass(hass)
    assert await hass.config_entries.async_setup(e.entry_id)
    await hass.async_block_till_done()
    assert S.merged(e.options)["clock"]["time"] == "sensor.fictional_time"
    assert (e.options[S.CONF_DASHBOARD].get("browse") or {}).get("discover") == ["recent"], "Discover rows back to keys"
    den = S.boards(e)["dashboard-den"]
    assert den["accent"] == "blue" and den["menu_custom"] is True
    assert "tablets" not in dict(next(s for s in e.subentries.values() if s.unique_id == "dashboard-den").data)
    assert S.tablets(e)["den"]["name"] == "Den Tablet"
    assert next(p for p in S.popups(e) if p["hash"] == "door")["name"] == "Front Door"
    assert hass.data["hk_frontend"][accessories.DATA].data["entities"]["light.den"]["name"] == "Den Lamp"
    assert (await linked_mode.mirror_store(hass).async_load())["owned"] is False, "taken once"
    # a later setup takes nothing again
    hass.config_entries.async_update_entry(e, options={**e.options, S.CONF_DASHBOARD: {}})
    assert await hass.config_entries.async_reload(e.entry_id)
    await hass.async_block_till_done()
    assert S.merged(e.options)["clock"]["time"] == "sensor.time"


async def test_settings_never_mantel_s_are_not_taken_in(hass, base, hass_storage):
    from conftest import house_entry
    from custom_components.hk_frontend import settings as S
    _stored(hass_storage, owned=False)
    e = house_entry()
    e.add_to_hass(hass)
    assert await hass.config_entries.async_setup(e.entry_id)
    await hass.async_block_till_done()
    assert S.merged(e.options)["clock"]["time"] == "sensor.time"


async def test_the_house_moved_back_keeps_mantel_s_last_settings(hass, base, mantel):
    from custom_components.hk_frontend import linked_mode, settings as S
    e = await _linked(hass, mantel)
    await mantel.push({"type": "settings", "version": "v7", "payload": HANDED})
    await until(hass, lambda: linked_mode.mirrored(hass) is not None)
    await mantel.push({"type": "owners", "owners": {**FULL, "house": "ha"}})
    await until(hass, lambda: "dashboard-den" in S.boards(e))
    await hass.async_block_till_done()
    assert S.merged(e.options)["clock"]["time"] == "sensor.fictional_time"
    conn = _feed(hass)
    ev = _events(conn)[-1]
    assert "dashboard-den" in ev["boards"] and ev["clock"]["time"] == "sensor.fictional_time"
    assert ev["calendar"]["event_colors"] == {"uid:e2e": "teal"}
    await _unload(hass, e)


async def test_the_mirror_is_on_disk_once_the_link_stops(hass, base, mantel, hass_storage):
    from custom_components.hk_frontend import linked_mode
    e = await _linked(hass, mantel)
    await mantel.push({"type": "settings", "version": "v8", "payload": HANDED})
    await until(hass, lambda: linked_mode.mirrored(hass) is not None)
    await _unload(hass, e)                       # well within the delayed write's second
    assert hass_storage[linked_mode.MIRROR_STORE]["data"]["version"] == "v8"
    assert hass_storage[linked_mode.MIRROR_STORE]["data"]["owned"] is True


# ------------------------------------------------------------ while Mantel runs the house: actions and items
async def test_the_features_actions_run_in_mantel(hass, base, mantel):
    e = await _linked(hass, mantel)
    await hass.services.async_call("hk_frontend", "music_stop", {"rooms": ["media_player.hall"]}, blocking=True)
    sent = mantel.calls("call_service")[-1]
    assert sent["service"] == "music_stop" and sent["data"] == {"rooms": ["media_player.hall"]}, \
        "Mantel's music engine runs it; HA's isn't running"
    assert "actions" in mantel.headers[-1]["X-Mantel-Link"]
    await _unload(hass, e)


async def test_while_the_house_is_home_assistant_s_its_own_actions_run(hass, base, mantel):
    owners = {**FULL, "house": "ha"}
    mantel.owners = owners
    e = await _linked(hass, mantel, owners=owners, wait=False)
    from homeassistant.exceptions import ServiceValidationError
    with pytest.raises(ServiceValidationError):
        await hass.services.async_call("hk_frontend", "music_stop", {"rooms": ["media_player.hall"]}, blocking=True)
    assert mantel.calls("call_service") == [], "HA's own music (not set up here) answered, nothing went to Mantel"
    await _unload(hass, e)


async def test_items_and_configure_point_to_mantel_settings(hass, base, mantel):
    e = await _linked(hass, mantel)
    flows = hass.config_entries.subentries
    for kind in ("feature", "dashboard", "tablet"):
        r = await flows.async_init((e.entry_id, kind), context={"source": "user"})
        assert r["type"] == "abort" and r["reason"] == "mantel_runs_it", (kind, r)
    r = await hass.config_entries.options.async_init(e.entry_id)
    assert r["type"] == "menu" and r["step_id"] == "init_mantel" and r["menu_options"] == ["linked", "check", "done"]
    await _unload(hass, e)


# ------------------------------------------------------------ the dashboards' feature reads, answered by Mantel
def _handler(hass, t):
    from homeassistant.components import websocket_api
    return hass.data[websocket_api.DOMAIN][t]


class SubConn(Conn):
    def __init__(self, user):
        super().__init__(user)
        self.subscriptions = {}


async def test_a_dashboard_s_live_tv_read_is_answered_by_mantel(hass, base, mantel):
    e = await _linked(hass, mantel)
    await _mirror(hass, mantel)
    user = await _admin(hass)
    handler, schema = _handler(hass, "hk_tv/channels")
    conn = SubConn(user)
    handler(hass, conn, schema({"id": 4, "type": "hk_tv/channels"}) if callable(schema) else {"id": 4, "type": "hk_tv/channels"})
    await until(hass, lambda: mantel.calls("page"))
    sent = mantel.calls("page")[-1]
    assert sent["ha_user"] == user.id and sent["frame"]["type"] == "read"
    assert sent["frame"]["msg"] == {"type": "hk_tv/channels"}
    await mantel.push({"type": "page_frame", "ha_user": user.id,
                       "frame": {"type": "read_result", "id": sent["frame"]["id"], "result": {"channels": [{"number": "9.1"}]}}})
    await until(hass, lambda: any(m.get("id") == 4 for m in conn.sent))
    got = next(m for m in conn.sent if m.get("id") == 4)
    assert got["success"] and got["result"] == {"channels": [{"number": "9.1"}]}
    await _unload(hass, e)


async def test_a_dashboard_s_subscription_stays_open_until_the_page_ends_it(hass, base, mantel):
    e = await _linked(hass, mantel)
    await _mirror(hass, mantel)
    user = await _admin(hass)
    handler, schema = _handler(hass, "hk_music/subscribe")
    conn = SubConn(user)
    handler(hass, conn, schema({"id": 5, "type": "hk_music/subscribe"}) if callable(schema) else {"id": 5, "type": "hk_music/subscribe"})
    await until(hass, lambda: mantel.calls("page"))
    tid = mantel.calls("page")[-1]["frame"]["id"]
    assert mantel.calls("page")[-1]["frame"]["type"] == "read_subscribe"
    # an event before the subscription's own answer waits for it
    await mantel.push({"type": "page_frame", "ha_user": user.id, "frame": {"type": "read_event", "id": tid, "event": {"n": 1}}})
    await mantel.push({"type": "page_frame", "ha_user": user.id, "frame": {"type": "read_result", "id": tid, "result": None}})
    await mantel.push({"type": "page_frame", "ha_user": user.id, "frame": {"type": "read_event", "id": tid, "event": {"n": 2}}})
    await until(hass, lambda: len([m for m in conn.sent if m.get("type") == "event"]) == 2)
    kinds = [m.get("type") for m in conn.sent]
    assert kinds == ["result", "event", "event"], conn.sent
    assert [m["event"] for m in conn.sent if m["type"] == "event"] == [{"n": 1}, {"n": 2}]
    conn.subscriptions[5]()                         # the page goes away
    await until(hass, lambda: any(c["frame"]["type"] == "read_unsubscribe" for c in mantel.calls("page")))
    await _unload(hass, e)


async def test_a_read_in_flight_when_the_link_drops_is_answered(hass, base, mantel):
    """HK-1 (Mantel's audit, second pass): a one-shot read Mantel had taken when the link dropped was never answered;
    the dashboard's request waited for ever and its tunnel stayed."""
    e = await _linked(hass, mantel)
    await _mirror(hass, mantel)
    user = await _admin(hass)
    handler, schema = _handler(hass, "hk_tv/channels")
    conn = SubConn(user)
    handler(hass, conn, schema({"id": 8, "type": "hk_tv/channels"}) if callable(schema) else {"id": 8, "type": "hk_tv/channels"})
    await until(hass, lambda: mantel.calls("page"))
    await mantel.drop()
    await until(hass, lambda: any(m.get("id") == 8 for m in conn.sent))
    got = next(m for m in conn.sent if m.get("id") == 8)
    assert not got["success"] and got["error"]["code"] == "mantel_away"
    from custom_components.hk_frontend import linked_mode
    assert not linked_mode.active(hass)._tunnels
    await _unload(hass, e)


async def test_mantel_s_refusal_of_a_read_reaches_the_page(hass, base, mantel):
    async def refuse(ws, msg):
        if msg.get("type") == "page":
            return {"id": msg["id"], "type": "result", "success": False,
                    "error": {"code": "not_linked", "message": "Link your Home Assistant user"}}
        return await mantel.ok(ws, msg)
    mantel.answer = refuse
    e = await _linked(hass, mantel)
    await _mirror(hass, mantel)
    handler, schema = _handler(hass, "hk_tv/channels")
    conn = SubConn(await _admin(hass))
    handler(hass, conn, schema({"id": 6, "type": "hk_tv/channels"}) if callable(schema) else {"id": 6, "type": "hk_tv/channels"})
    await until(hass, lambda: any(m.get("id") == 6 for m in conn.sent))
    got = next(m for m in conn.sent if m.get("id") == 6)
    assert not got["success"] and got["error"]["code"] == "not_linked"
    await _unload(hass, e)


async def test_the_feed_names_mantel_settings_for_setting_a_feature_up(hass, base, mantel):
    e = await _linked(hass, mantel)
    await _mirror(hass, mantel)
    from custom_components.hk_frontend import linked_mode
    assert linked_mode.mirrored(hass)["places"]["HK Frontend → Add feature"] == "Mantel Settings → Features"
    await _unload(hass, e)


async def test_a_password_the_browser_filled_in_never_replaces_the_credential(hass, base, mantel):
    """Linked to Mantel's credential box is a password field: a browser may fill a saved password into it. That
    isn't a Mantel Service credential, so it is refused and the saved one kept (the house, 2026-10-21)."""
    e = await _linked(hass, mantel)
    flows = hass.config_entries.options
    r = await flows.async_init(e.entry_id)
    r = await flows.async_configure(r["flow_id"], {"next_step_id": "linked"})
    r = await flows.async_configure(r["flow_id"], {"enabled": True, "url": mantel.url, "token": "a-saved-password-12345"})
    assert r["type"] == "form" and r["errors"] == {"token": "mantel_token_invalid"}
    from conftest import entry as house
    assert house(hass).data["mantel_link"]["token"].startswith("msvc_"), "the saved credential is kept"
    await _unload(hass, e)
