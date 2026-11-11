"""The saves HK Frontend answered in Home Assistant that Mantel now keeps itself (docs/phase9/MANTEL-LINK.md "Parity":
HK Frontend can be removed): an accessory's settings, a room's order, a room shown inside another, a category page's
order, a room's scenes row, a screen's Favorites, and Hidden Accessories (hidden/set, hidden/also). Each is a
settings_write: checked as HK Frontend's schema checked it, RBAC ``configure``, a new version of the document with
who and why, the feed sent again, and nothing to Home Assistant. A FICTIONAL house (test_mantel_reads.py's)."""
import pytest

from mantel_server import accessories as ACC
from mantel_server import settings_store as S
from mantel_server.connectors import Ctx
from mantel_server.identity.sessions import Device, Identity, User
from test_mantel_reads import ADMIN, ADULT, OWNER, env, read  # noqa: F401 -- the fixture


async def save(env, who, msg, rid=1):
    got = []

    async def send(m):
        got.append(m)
    await env.app["ws_handlers"]["settings_write"](Ctx(send=send, identity=who),
                                                   {"type": "settings_write", "id": rid, "msg": msg})
    assert len(got) == 1 and got[0]["type"] == "settings_result" and got[0]["id"] == rid
    return got[0]


def acc(env):
    return env.service.store.get("house", "accessories")


def test_every_save_hk_frontend_answered_is_mantels_now():
    for t in ("hk_frontend/accessory/into", "hk_frontend/accessory/order", "hk_frontend/accessory/page_order",
              "hk_frontend/accessory/room_scenes", "hk_frontend/accessory/set", "hk_frontend/board/favorite",
              "hk_frontend/hidden/also", "hk_frontend/hidden/set"):
        assert S.SAVE_KINDS[t] == "settings" and t in S.WRITE_KEYS
    assert S.NOT_YET == {"hk_notify/mute"}, "nothing of HK's data is left for Home Assistant to keep"


async def test_an_accessorys_settings_are_saved_like_hk_frontends(env):
    v0 = acc(env).version
    got = await save(env, OWNER, {"type": "hk_frontend/accessory/set", "entity_id": "switch.coffee", "name": "  Coffee ",
                                  "show_as": "outlet", "fav_with": ["switch.coffee", "light.lamp"], "status": True})
    assert got["result"] == {"name": "Coffee", "show_as": "outlet", "fav_with": ["light.lamp"]}, \
        "trimmed, never favorite with itself, status True is automatic"
    d = acc(env)
    assert d.version == v0 + 1 and d.body["entities"]["switch.coffee"]["name"] == "Coffee"
    assert d.body["entities"]["light.lamp"] == {"status": False}, "the rest kept"
    # a name on one screen only
    got = await save(env, OWNER, {"type": "hk_frontend/accessory/set", "entity_id": "switch.coffee", "name": "Brew",
                                  "screen": "dashboard-kitchen"}, rid=2)
    assert got["result"]["names"] == {"dashboard-kitchen": "Brew"} and got["result"]["name"] == "Coffee"
    # every field back to automatic: the accessory leaves the document
    got = await save(env, OWNER, {"type": "hk_frontend/accessory/set", "entity_id": "switch.coffee", "name": None,
                                  "show_as": None, "fav_with": None}, rid=3)
    got = await save(env, OWNER, {"type": "hk_frontend/accessory/set", "entity_id": "switch.coffee", "name": None,
                                  "screen": "dashboard-kitchen"}, rid=4)
    assert got["result"] == {} and "switch.coffee" not in acc(env).body["entities"]


async def test_also_rename_in_home_assistant_is_kept_only_while_on(env):
    """The switch (2026-10-31) is a setting of the accessory; the registry write itself is the gateway's."""
    got = await save(env, OWNER, {"type": "hk_frontend/accessory/set", "entity_id": "switch.coffee", "name": "Coffee",
                                  "ha_name": True})
    assert got["result"] == {"name": "Coffee", "ha_name": True}
    got = await save(env, OWNER, {"type": "hk_frontend/accessory/set", "entity_id": "switch.coffee", "ha_name": False}, rid=2)
    assert got["result"] == {"name": "Coffee"}, "off is not stored: the name stays, the syncing stops"
    got = await save(env, OWNER, {"type": "hk_frontend/accessory/set", "entity_id": "switch.coffee", "ha_name": "yes"}, rid=3)
    assert got["error"]["code"] == "invalid_format" and "ha_name" in got["error"]["message"]


@pytest.mark.parametrize("msg, field", [
    ({"entity_id": "not an id"}, "entity_id"),
    ({"entity_id": "light.lamp", "show_as": "toaster"}, "show_as"),
    ({"entity_id": "light.lamp", "icon": "fa:x"}, "icon"),
    ({"entity_id": "light.lamp", "name": "x" * 61}, "name"),
    ({"entity_id": "light.lamp", "fav_with": ["light.a"] * 9}, "fav_with"),
    ({"entity_id": "light.lamp", "screen": "../x"}, "screen"),
])
async def test_an_accessory_change_hk_frontend_refused_is_refused(env, msg, field):
    v0 = acc(env).version
    got = await save(env, OWNER, {"type": "hk_frontend/accessory/set", **msg})
    assert got["error"]["code"] == "invalid_format" and field in got["error"]["message"]
    assert acc(env).version == v0


async def test_rooms_order_into_pages_and_scenes(env):
    got = await save(env, ADMIN, {"type": "hk_frontend/accessory/order", "area_id": "den",
                                  "entities": ["switch.coffee", "light.lamp", "switch.coffee"]})
    assert got["result"] == ["switch.coffee", "light.lamp"]
    got = await save(env, ADMIN, {"type": "hk_frontend/accessory/into", "area_id": "crawl", "into": "den"}, rid=2)
    assert got["result"] == {"crawl": "den"}
    got = await save(env, ADMIN, {"type": "hk_frontend/accessory/into", "area_id": "den", "into": "primary"}, rid=3)
    assert got["result"] == {"crawl": "primary", "den": "primary"}, "one level only, as HK Frontend's"
    got = await save(env, ADMIN, {"type": "hk_frontend/accessory/page_order", "page": "security",
                                  "entities": ["lock.back", "lock.front"]}, rid=4)
    assert got["result"] == ["lock.back", "lock.front"]
    assert (await save(env, ADMIN, {"type": "hk_frontend/accessory/page_order", "page": "lights", "entities": []},
                       rid=5))["error"]["code"] == "invalid_format"
    got = await save(env, ADMIN, {"type": "hk_frontend/accessory/room_scenes", "area_id": "den", "entities": []}, rid=6)
    assert got["result"] == {"scenes": []}, "an empty row is kept: no row, not automatic"
    got = await save(env, ADMIN, {"type": "hk_frontend/accessory/room_scenes", "area_id": "den", "entities": None}, rid=7)
    assert got["result"] == {"scenes": None} and "den" not in acc(env).body["scenes"]
    body = acc(env).body
    assert body["rooms"] == {"den": ["switch.coffee", "light.lamp"]} and body["pages"] == {"security": ["lock.back", "lock.front"]}
    hist = env.service.store.history("house", "accessories", 10, False)
    assert {h["message"] for h in hist} >= {"hk_frontend/accessory/order", "hk_frontend/accessory/into",
                                            "hk_frontend/accessory/room_scenes"}, "each save is a version, with why"


async def test_a_screens_favorites(env):
    env.service.store.write([("board", "dashboard-kitchen", {"favorites": ["light.lamp"]})], actor=S.Actor(label="t"))
    got = await save(env, OWNER, {"type": "hk_frontend/board/favorite", "dashboard": "dashboard-kitchen",
                                  "entity_id": "switch.coffee", "favorite": True})
    assert got["result"] == {"favorites": ["light.lamp", "switch.coffee"]}
    got = await save(env, OWNER, {"type": "hk_frontend/board/favorite", "dashboard": "dashboard-kitchen",
                                  "entity_id": "light.lamp", "favorite": False}, rid=2)
    assert env.service.store.body("board", "dashboard-kitchen")["favorites"] == ["switch.coffee"]
    got = await save(env, OWNER, {"type": "hk_frontend/board/favorite", "dashboard": "dashboard-nowhere",
                                  "entity_id": "light.lamp", "favorite": True}, rid=3)
    assert got["error"]["code"] == "no_item"


async def test_only_who_may_configure_saves_them(env):
    before = acc(env).version
    for msg in ({"type": "hk_frontend/accessory/set", "entity_id": "light.lamp", "name": "x"},
                {"type": "hk_frontend/hidden/set", "entity_ids": ["light.lamp"], "everywhere": True}):
        assert (await save(env, ADULT, msg))["error"]["code"] == "forbidden"
    assert acc(env).version == before


async def test_hidden_set_everywhere_and_places(env):
    got = await save(env, OWNER, {"type": "hk_frontend/hidden/set", "entity_ids": ["switch.coffee"], "everywhere": True})
    assert got["result"]["everywhere"] == ["switch.coffee"]
    assert "switch.coffee" in env.service.house_settings()["generated"]["exclude_entities"]
    # exactly Home and Lights: shown everywhere else again
    got = await save(env, OWNER, {"type": "hk_frontend/hidden/set", "entity_ids": ["light.lamp"], "everywhere": False,
                                  "places": {"home": True, "lights": True}}, rid=2)
    assert got["result"]["off"]["light.lamp"] == ["home", "lights"]
    body = acc(env).body["entities"]["light.lamp"]
    assert body.get("home") is False and "status" not in body, "Include in Status off became its kinds' places"
    assert "light.lamp" in env.service.house_settings()["counts"]["lights"]["exclude"]
    # shown again everywhere
    got = await save(env, OWNER, {"type": "hk_frontend/hidden/set", "entity_ids": ["light.lamp", "switch.coffee"],
                                  "everywhere": False, "places": {}}, rid=3)
    assert got["result"]["off"] == {} and got["result"]["everywhere"] == []
    assert (await save(env, OWNER, {"type": "hk_frontend/hidden/set", "entity_ids": ["light.lamp"], "everywhere": False,
                                    "places": {"nowhere": True}}, rid=4))["error"]["code"] == "invalid_format"


async def test_hidden_also_counts_an_outlet_as_a_light(env):
    got = await save(env, OWNER, {"type": "hk_frontend/hidden/also", "entity_ids": ["switch.coffee"],
                                  "kinds": {"lights": True, "thermostats": True}})
    assert got["result"]["added"] == {"switch.coffee": ["lights"]}, "only where it could be counted"
    assert env.service.house_settings()["counts"]["lights"]["include"] == ["switch.coffee"]
    got = await save(env, OWNER, {"type": "hk_frontend/hidden/also", "entity_ids": ["switch.coffee"],
                                  "kinds": {"lights": False}}, rid=2)
    assert got["result"]["added"] == {} and env.service.house_settings()["counts"]["lights"]["include"] == []


async def test_hidden_saves_need_mantels_copy_of_the_house(env):
    env.app["hiding"] = None
    got = await save(env, OWNER, {"type": "hk_frontend/hidden/set", "entity_ids": ["light.lamp"], "everywhere": True})
    assert got["error"]["code"] == "unavailable"


def test_the_document_checks_are_hk_frontends():
    assert ACC.clean({"entities": {"light.a": {"name": "", "status": True, "size": "huge"}},
                      "into": {"a": "b", "b": "c"}, "pages": {"lights": ["light.a"]}, "scenes": {"x": []}}) == \
        {"entities": {}, "rooms": {}, "into": {"a": "c", "b": "c"}, "pages": {}, "scenes": {"x": []}}


# ------------------------------------------------- Edit mode (Phase A): the accessories document's version
async def test_a_layout_save_with_the_version_it_opened_is_refused_once_someone_else_saved(env):
    """panel/get gives versions["accessories"] (the stored document's number); accessory/order, page_order,
    room_scenes and set take it as expect_version, as board/set does (SET-7): the same saves and answers the new
    one; an older one is a `conflict` and writes nothing; none at all saves and answers as before."""
    opened = (await read(env, OWNER, {"type": "hk_frontend/panel/get"}))["result"]["versions"]["accessories"]
    assert opened == acc(env).version
    got = await save(env, ADMIN, {"type": "hk_frontend/accessory/order", "area_id": "den", "expect_version": opened,
                                  "entities": ["switch.coffee", "light.lamp"]})
    assert got["result"] == {"entities": ["switch.coffee", "light.lamp"], "version": opened + 1} == \
        {"entities": acc(env).body["rooms"]["den"], "version": acc(env).version}
    for n, stale in enumerate((
            {"type": "hk_frontend/accessory/order", "area_id": "den", "entities": ["light.lamp"]},
            {"type": "hk_frontend/accessory/page_order", "page": "security", "entities": ["lock.front"]},
            {"type": "hk_frontend/accessory/room_scenes", "area_id": "den", "entities": []},
            {"type": "hk_frontend/accessory/set", "entity_id": "light.lamp", "size": "tall"}), start=2):
        got = await save(env, ADMIN, {**stale, "expect_version": opened}, rid=n)
        assert got["error"]["code"] == "conflict", (stale, got)
        assert acc(env).version == opened + 1, "nothing written"
    now = opened + 1
    got = await save(env, ADMIN, {"type": "hk_frontend/accessory/page_order", "page": "security",
                                  "entities": ["lock.front"], "expect_version": now}, rid=10)
    assert got["result"] == {"entities": ["lock.front"], "version": now + 1}
    got = await save(env, ADMIN, {"type": "hk_frontend/accessory/room_scenes", "area_id": "den", "entities": [],
                                  "expect_version": now + 1}, rid=11)
    assert got["result"] == {"scenes": [], "version": now + 2}
    got = await save(env, ADMIN, {"type": "hk_frontend/accessory/set", "entity_id": "light.lamp", "size": "tall",
                                  "expect_version": now + 2}, rid=12)
    assert got["result"]["size"] == "tall" and got["result"]["version"] == now + 3 == acc(env).version
    # nothing changed: no new version, and the answer says the one it is
    got = await save(env, ADMIN, {"type": "hk_frontend/accessory/set", "entity_id": "light.lamp", "size": "tall",
                                  "expect_version": now + 3}, rid=13)
    assert got["result"]["version"] == now + 3 == acc(env).version
    # without it: as before (Save Anyway)
    got = await save(env, ADMIN, {"type": "hk_frontend/accessory/order", "area_id": "den", "entities": ["light.lamp"]},
                     rid=14)
    assert got["result"] == ["light.lamp"]
    assert (await read(env, OWNER, {"type": "hk_frontend/panel/get"}))["result"]["versions"]["accessories"] == now + 4
    for bad in ("1", True, None, 1.0):
        got = await save(env, ADMIN, {"type": "hk_frontend/accessory/order", "area_id": "den", "entities": [],
                                      "expect_version": bad}, rid=20)
        assert got["error"]["code"] == "invalid_format" and "expect_version" in got["error"]["message"], bad
    assert acc(env).version == now + 4


async def test_a_wall_tablets_session_cannot_save_a_layout(env):
    """Phase 2's guard: a device session (alone, or a person signed in on top of it) has no `configure`, so Edit
    mode's saves are refused there whoever is signed in, and nothing is written."""
    tablet = Device("tablet-1", "Loft Tablet", "wall_tablet")
    before = acc(env).version
    for who in (Identity(None, tablet, "lan"), Identity(User("owner-id", "Owner", "owner", "hk"), tablet, "lan")):
        got = await save(env, who, {"type": "hk_frontend/accessory/order", "area_id": "den", "entities": ["light.lamp"],
                                    "expect_version": before})
        assert got["error"]["code"] == "forbidden", got
    assert acc(env).version == before


# ------------------------------------------------- Edit mode (Phase F): the house settings' version
def house(env):
    return env.service.store.get("house", "settings")


async def test_a_room_order_save_with_the_version_it_opened_is_refused_once_someone_else_saved(env):
    """Edit mode's Room Order on a screen whose Rooms follow All Screens saves settings/set {rooms.order,
    rooms.menu}: panel/get gives versions["house"] (the house settings document's number, 0 before there is one)
    and settings/set takes it as expect_version, as board/set (SET-7) and the accessory saves do: the same saves
    and answers the new one; an older one is a `conflict` and writes nothing; none at all saves as before."""
    opened = (await read(env, OWNER, {"type": "hk_frontend/panel/get"}))["result"]["versions"]["house"]
    assert opened == (house(env).version if house(env) else 0)
    order = {"type": "hk_frontend/settings/set", "changes": {"rooms.order": ["den", "kitchen"], "rooms.menu": "order"}}
    got = await save(env, ADMIN, {**order, "expect_version": opened})
    assert got["result"]["version"] == opened + 1 == house(env).version, got
    assert got["result"]["settings"]["rooms"]["order"] == ["den", "kitchen"]
    got = await save(env, ADMIN, {"type": "hk_frontend/settings/set", "changes": {"rooms.order": ["kitchen", "den"]},
                                  "expect_version": opened}, rid=2)
    assert got["error"]["code"] == "conflict", got
    assert house(env).version == opened + 1 and house(env).body["rooms"]["order"] == ["den", "kitchen"], "nothing written"
    got = await save(env, ADMIN, {"type": "hk_frontend/settings/set", "changes": {"rooms.order": ["kitchen", "den"]}},
                     rid=3)                                              # Save Anyway: no version
    assert "error" not in got and house(env).body["rooms"]["order"] == ["kitchen", "den"], got
    assert (await read(env, OWNER, {"type": "hk_frontend/panel/get"}))["result"]["versions"]["house"] == opened + 2
    for bad in ("1", True, None, 1.0):
        got = await save(env, ADMIN, {**order, "expect_version": bad}, rid=20)
        assert got["error"]["code"] == "invalid_format" and "expect_version" in got["error"]["message"], bad
    assert house(env).version == opened + 2
