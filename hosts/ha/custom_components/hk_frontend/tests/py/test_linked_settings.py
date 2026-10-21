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
    return [m["event"] for m in conn.sent if m.get("type") == "event"]


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
    assert linked_mode.mirrored(hass) == SETTINGS["payload"]
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
