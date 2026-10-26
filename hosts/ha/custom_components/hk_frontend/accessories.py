"""ACCESSORY SETTINGS: how one thing shows up on the HK Frontend dashboards
-- the Home app's per-accessory settings, set once for the house.

    name       the tile's name, on every dashboard ("Lamp", not "Living Room
               Lamp Light"). Home Assistant's own name is untouched: a rename
               there reaches voice and every screen, and two players can
               already share a name (the AirPlay and the Music Assistant
               HomePod).
    names      {dashboard url path: name} -- a name on one dashboard only.
    icon       an hk: glyph (or mdi:) for its tile and its sheet.
    show_as    light / fan / switch / outlet -- what it is drawn as and which
               chip counts it (a coffee maker on an outlet, a fan on a switch).
    size       regular / tall -- its tile's height on a generated dashboard's
               rooms and pages, over what its kind is drawn as (a light as a
               tall tile, a lock as a pill). None: its kind's own.
    anim       whether its tile's glyph spins while it is on (a fan): 'spin'
               or 'none'. None (Automatic): its kind's own -- a fan spins,
               every other kind does not.
    status     False: left out of the status chips (Status & Chips). None: as
               found.
    home       False: not in its room's section on a generated Home. None:
               shown.
    room       False: not on its own room's page (2026-10-12, Hidden
               Accessories). None: shown.
    color      its color as a scene pill, a chip or a favorite (white,
               yellow, blue ...) -- a favorite's glyph when it is on.
    on_text    WHAT ITS STATES ARE CALLED on its tiles and as a
    off_text   favorite, for a switch-like accessory: "Blocked" / "Allowed"
               for a helper that blocks a game, in place of On / Off.
    when       as a chip ("Also as chips"): shown only while its state is this
               ("Mail Likely Delivered").
    label      as a chip: this instead of its state ("Likely Delivered").
    fav_name   AS A FAVORITE, on every dashboard where it is one:
    fav_icon   its name and glyph there ("Garage Door" in Favorites, "Door" in
               the Garage), and
    fav_with   the lights (or switches) it controls together with, as one
               favorite: "Main + Table Lights" toggles both, is lit while
               either is, and reads their brightness.
    fav_room   the room line above its name as a favorite, for a helper
               with no area of its own ("Emma's Room" over Game Block);
               empty: its area's name.

and, per room (area id), the order of its tiles -- and `into`: a room shown
as part of another (the Deck inside the Backyard) -- and `scenes`: the row of
scene pills on its room page (2026-10-01; a room missing here: Automatic, the
Home Assistant scenes in that room; an empty list: no row) -- and `pages`: the order
of a category page that mixes rooms, where the automatic A to Z is not how
the house thinks of them (PAGE_ORDERS; the Vacuums: Downstairs, Upstairs,
Office; Security's locks and garage doors: Front, Garage, Back).

Stored in `.storage/hk_frontend.accessories`, not in the config entry's
options: a house has hundreds of accessories, and each change is one small
write. Sent to every screen inside the settings feed (`accessories`).
Changed from the gear on a detail sheet (admins only), through the
websocket commands below; Status & Chips is re-resolved and every screen told.
"""
from __future__ import annotations

import re
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .const import DOMAIN, SIGNAL_CONFIG

DATA = "accessories"
STORAGE_KEY = f"{DOMAIN}.accessories"
STORAGE_VERSION = 1
SAVE_DELAY = 2.0

SHOW_AS = ("light", "fan", "switch", "outlet")
SIZES = ("regular", "tall")
ANIMS = ("spin", "none")
COLORS = ("white", "yellow", "orange", "red", "pink", "purple", "blue", "teal", "mint", "green")
ENTITY = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
ICON = re.compile(r"^(hk|mdi):[a-z0-9-]+$")
AREA = re.compile(r"^[a-z0-9_]+$")
PATH = re.compile(r"^[a-z0-9_-]+$")
PAGE_ORDERS = ("vacuums", "security")
ATTR = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_ .-]{0,59}$")
FIELDS = ("name", "icon", "show_as", "size", "anim", "status", "home", "room", "color", "when", "label", "attribute",
          "fav_name", "fav_icon", "fav_with", "fav_room", "on_text", "off_text")
FAV_WITH_MAX = 8


def blank() -> dict[str, Any]:
    return {"entities": {}, "rooms": {}, "into": {}, "pages": {}, "scenes": {}}


def version(data: Any) -> str:
    """THE ACCESSORIES' VERSION (Edit mode): a digest of the whole data, as
    panel.board_version is a screen's. panel/get sends it as
    versions["accessories"] (Mantel sends its document's number there), and
    accessory/order, page_order, room_scenes and set compare their
    expect_version with it, so a second editor's save can't silently
    replace the first's."""
    import hashlib
    import json
    text = json.dumps(dict(data or {}), sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(text.encode()).hexdigest()[:20]


# the version an editor opened: this host's digest, or Mantel's number while
# linked (the save goes on to Mantel, which compares it with its own)
EXPECT_VERSION = vol.Any(vol.All(str, vol.Length(max=64)), int)


def _stale(acc: "Accessories", connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> bool:
    """With expect_version: True (and the `conflict` sent, nothing written)
    when the Accessories changed since the editor read them."""
    if "expect_version" in msg and msg["expect_version"] != version(acc.data):
        connection.send_error(msg["id"], "conflict",
                              f"accessories changed meanwhile (now version {version(acc.data)})")
        return True
    return False


def _answer(acc: "Accessories", msg: dict[str, Any], answer: Any) -> Any:
    """With expect_version, the answer carries the new version, as Mantel's:
    a dict answer gains "version", a list comes as {"entities", "version"}.
    Without it, as before."""
    if "expect_version" not in msg:
        return answer
    v = version(acc.data)
    return {**answer, "version": v} if isinstance(answer, dict) else {"entities": answer, "version": v}


def _ids(v: Any) -> list[str]:
    seen: list[str] = []
    for i in v if isinstance(v, list) else []:
        if isinstance(i, str) and ENTITY.match(i) and i not in seen:
            seen.append(i)
    return seen


def clean_entity(v: Any) -> dict[str, Any]:
    """One accessory's stored settings, each value checked; empty ones gone."""
    v = v if isinstance(v, dict) else {}
    out: dict[str, Any] = {}
    name = v.get("name")
    if isinstance(name, str) and name.strip():
        out["name"] = name.strip()[:60]
    icon = v.get("icon")
    if isinstance(icon, str) and ICON.match(icon):
        out["icon"] = icon
    if v.get("show_as") in SHOW_AS:
        out["show_as"] = v["show_as"]
    if v.get("size") in SIZES:
        out["size"] = v["size"]
    if v.get("anim") in ANIMS:
        out["anim"] = v["anim"]
    if v.get("color") in COLORS:
        out["color"] = v["color"]
    for k, n in (("when", 60), ("label", 40), ("on_text", 30), ("off_text", 30), ("fav_room", 40)):
        if isinstance(v.get(k), str) and v[k].strip():
            out[k] = v[k].strip()[:n]
    # as a chip: an attribute shown in place of the state
    if isinstance(v.get("attribute"), str) and ATTR.match(v["attribute"].strip()):
        out["attribute"] = v["attribute"].strip()
    for k in ("status", "home", "room"):
        if v.get(k) is False:
            out[k] = False
    fav_name = v.get("fav_name")
    if isinstance(fav_name, str) and fav_name.strip():
        out["fav_name"] = fav_name.strip()[:60]
    fav_icon = v.get("fav_icon")
    if isinstance(fav_icon, str) and ICON.match(fav_icon):
        out["fav_icon"] = fav_icon
    fav_with = v.get("fav_with")
    if isinstance(fav_with, list):
        ids: list[str] = []
        for i in fav_with:
            if isinstance(i, str) and ENTITY.match(i) and i not in ids and len(ids) < FAV_WITH_MAX:
                ids.append(i)
        if ids:
            out["fav_with"] = ids
    names = v.get("names")
    if isinstance(names, dict):
        n = {p: s.strip()[:60] for p, s in names.items()
             if isinstance(p, str) and PATH.match(p) and isinstance(s, str) and s.strip()}
        if n:
            out["names"] = n
    return out


def clean(data: Any) -> dict[str, Any]:
    data = data if isinstance(data, dict) else {}
    ents = {}
    for eid, v in (data.get("entities") or {}).items():
        if isinstance(eid, str) and ENTITY.match(eid):
            c = clean_entity(v)
            if c:
                ents[eid] = c
    rooms = {}
    for area, ids in (data.get("rooms") or {}).items():
        if isinstance(area, str) and AREA.match(area) and isinstance(ids, list):
            seen: list[str] = []
            for i in ids:
                if isinstance(i, str) and ENTITY.match(i) and i not in seen:
                    seen.append(i)
            if seen:
                rooms[area] = seen
    into = {a: b for a, b in (data.get("into") or {}).items()
            if isinstance(a, str) and isinstance(b, str) and AREA.match(a) and AREA.match(b) and a != b}
    # one level only: a room shown inside one that is itself inside another
    # goes straight to the outer one
    into = {a: into.get(b, b) for a, b in into.items() if into.get(b, b) != a}
    pages = {k: _ids(v) for k, v in (data.get("pages") or {}).items() if k in PAGE_ORDERS}
    pages = {k: v for k, v in pages.items() if v}
    # a room's scenes row: its own list, kept EMPTY too (an empty list is "no
    # row", not "automatic")
    scenes = {a: _ids(v) for a, v in (data.get("scenes") or {}).items()
              if isinstance(a, str) and AREA.match(a) and isinstance(v, list)}
    return {"entities": ents, "rooms": rooms, "into": into, "pages": pages, "scenes": scenes}


class Accessories:
    """The store, in memory, saved a moment after each change."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store: Store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.data: dict[str, Any] = blank()

    async def async_load(self) -> None:
        self.data = clean(await self._store.async_load())

    @callback
    def _changed(self) -> None:
        self._store.async_delay_save(lambda: self.data, SAVE_DELAY)
        # Status & Chips reads `status` and `show_as`: re-resolve it first, so the
        # screens are sent the new lists with the new settings.
        from . import kinds
        tracker = self.hass.data.get(DOMAIN, {}).get(kinds.DATA)
        if tracker is not None:
            tracker.settings_changed()
        async_dispatcher_send(self.hass, SIGNAL_CONFIG)

    @callback
    def set(self, entity_id: str, changes: dict[str, Any], screen: str | None = None,
            quiet: bool = False) -> dict[str, Any]:
        """Apply `changes` to one accessory: a key set to None (or False where
        False is the default's opposite) goes back to automatic. `screen`
        with `name`: the name on that dashboard only."""
        cur = dict(self.data["entities"].get(entity_id) or {})
        for k, v in changes.items():
            if k == "name" and screen:
                names = dict(cur.get("names") or {})
                if isinstance(v, str) and v.strip():
                    names[screen] = v
                else:
                    names.pop(screen, None)
                cur["names"] = names
            elif k in FIELDS:
                if k == "fav_with" and isinstance(v, list):
                    v = [x for x in v if x != entity_id]          # never with itself
                if v is None or (k in ("status", "home", "room") and v is True):
                    cur.pop(k, None)
                else:
                    cur[k] = v
        new = clean_entity(cur)
        if new:
            self.data["entities"][entity_id] = new
        else:
            self.data["entities"].pop(entity_id, None)
        if not quiet:
            self._changed()
        return new

    @callback
    def set_many(self, changes: dict[str, dict[str, Any]]) -> None:
        """Several accessories at once (Hidden Accessories): one save, one
        nudge to the screens."""
        for eid, ch in changes.items():
            self.set(eid, ch, quiet=True)
        self._changed()

    @callback
    def into(self, area_id: str, target: str | None) -> dict[str, str]:
        """Show `area_id` as part of `target` (None: its own room again)."""
        cur = dict(self.data.get("into") or {})
        if target and target != area_id:
            cur[area_id] = target
        else:
            cur.pop(area_id, None)
        self.data["into"] = clean({"into": cur})["into"]
        self._changed()
        return self.data["into"]

    @callback
    def page_order(self, page: str, entities: list[str]) -> list[str]:
        """A category page's order (an empty list: automatic, A to Z)."""
        ids = _ids(entities)
        pages = dict(self.data.get("pages") or {})
        if ids:
            pages[page] = ids
        else:
            pages.pop(page, None)
        self.data["pages"] = pages
        self._changed()
        return ids

    @callback
    def room_scenes(self, area_id: str, entities: list[str] | None) -> list[str] | None:
        """A room's scenes row: these, in this order ([]: no row), or None:
        Automatic again."""
        cur = dict(self.data.get("scenes") or {})
        if entities is None:
            cur.pop(area_id, None)
        else:
            cur[area_id] = _ids(entities)
        self.data["scenes"] = cur
        self._changed()
        return cur.get(area_id)

    @callback
    def order(self, area_id: str, entities: list[str]) -> list[str]:
        ids = clean({"rooms": {area_id: entities}})["rooms"].get(area_id, [])
        if ids:
            self.data["rooms"][area_id] = ids
        else:
            self.data["rooms"].pop(area_id, None)
        self._changed()
        return ids


def get(hass: HomeAssistant) -> Accessories | None:
    return hass.data.get(DOMAIN, {}).get(DATA)


def current(hass: HomeAssistant) -> dict[str, Any]:
    acc = get(hass)
    return acc.data if acc else blank()


# ------------------------------------------------------------ websocket
@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/accessory/set",
    vol.Required("entity_id"): vol.All(str, vol.Match(ENTITY)),
    vol.Optional("name"): vol.Any(None, vol.All(str, vol.Length(max=60))),
    vol.Optional("icon"): vol.Any(None, vol.All(str, vol.Match(ICON))),
    vol.Optional("show_as"): vol.Any(None, vol.In(SHOW_AS)),
    vol.Optional("size"): vol.Any(None, vol.In(SIZES)),
    vol.Optional("anim"): vol.Any(None, vol.In(ANIMS)),
    vol.Optional("status"): vol.Any(None, bool),
    vol.Optional("home"): vol.Any(None, bool),
    vol.Optional("room"): vol.Any(None, bool),
    vol.Optional("color"): vol.Any(None, vol.In(COLORS)),
    vol.Optional("when"): vol.Any(None, vol.All(str, vol.Length(max=60))),
    vol.Optional("label"): vol.Any(None, vol.All(str, vol.Length(max=40))),
    vol.Optional("attribute"): vol.Any(None, vol.All(str, vol.Match(ATTR))),
    vol.Optional("fav_name"): vol.Any(None, vol.All(str, vol.Length(max=60))),
    vol.Optional("fav_icon"): vol.Any(None, vol.All(str, vol.Match(ICON))),
    vol.Optional("fav_with"): vol.Any(None, vol.All([vol.All(str, vol.Match(ENTITY))], vol.Length(max=FAV_WITH_MAX))),
    vol.Optional("fav_room"): vol.Any(None, vol.All(str, vol.Length(max=40))),
    vol.Optional("on_text"): vol.Any(None, vol.All(str, vol.Length(max=30))),
    vol.Optional("off_text"): vol.Any(None, vol.All(str, vol.Length(max=30))),
    vol.Optional("screen"): vol.Any(None, vol.All(str, vol.Match(PATH))),
    vol.Optional("expect_version"): EXPECT_VERSION,
})
@websocket_api.require_admin
@callback
def ws_accessory_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                     msg: dict[str, Any]) -> None:
    """Change one accessory's settings (admins: a wall tablet's user cannot)."""
    acc = get(hass)
    if acc is None:
        connection.send_error(msg["id"], "not_ready", "HK Frontend is still starting")
        return
    if _stale(acc, connection, msg):
        return
    changes = {k: msg[k] for k in FIELDS if k in msg}
    connection.send_result(msg["id"], _answer(acc, msg, acc.set(msg["entity_id"], changes, msg.get("screen"))))


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/accessory/order",
    vol.Required("area_id"): vol.All(str, vol.Match(AREA)),
    vol.Required("entities"): [vol.All(str, vol.Match(ENTITY))],
    vol.Optional("expect_version"): EXPECT_VERSION,
})
@websocket_api.require_admin
@callback
def ws_accessory_order(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                       msg: dict[str, Any]) -> None:
    """A room's tiles in this order (an empty list: the automatic order)."""
    acc = get(hass)
    if acc is None:
        connection.send_error(msg["id"], "not_ready", "HK Frontend is still starting")
        return
    if _stale(acc, connection, msg):
        return
    connection.send_result(msg["id"], _answer(acc, msg, acc.order(msg["area_id"], msg["entities"])))


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/board/favorite",
    vol.Required("dashboard"): vol.All(str, vol.Match(PATH)),
    vol.Required("entity_id"): vol.All(str, vol.Match(ENTITY)),
    vol.Required("favorite"): bool,
})
@websocket_api.require_admin
@callback
def ws_board_favorite(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                      msg: dict[str, Any]) -> None:
    """Add an accessory to (or take it off) one dashboard's Favorites -- its
    item's Home -> Favorites list, at the end."""
    from . import settings as S
    from . import features as F
    entry = F.frontend_entry(hass)
    sub = next((s for s in (entry.subentries.values() if entry else ())
                if s.subentry_type == S.SUBENTRY_DASHBOARD and s.unique_id == msg["dashboard"]), None)
    if sub is None:
        connection.send_error(msg["id"], "no_item",
                              "This dashboard has no item yet: add it under Dashboards on HK Frontend's page.")
        return
    favs = [f for f in (sub.data.get("favorites") or []) if f != msg["entity_id"]]
    if msg["favorite"]:
        favs.append(msg["entity_id"])
    hass.config_entries.async_update_subentry(entry, sub, data=S.board({**sub.data, "favorites": favs}))
    connection.send_result(msg["id"], {"favorites": favs})


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/accessory/into",
    vol.Required("area_id"): vol.All(str, vol.Match(AREA)),
    vol.Required("into"): vol.Any(None, vol.All(str, vol.Match(AREA))),
})
@websocket_api.require_admin
@callback
def ws_accessory_into(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                      msg: dict[str, Any]) -> None:
    """Show a room as part of another on the generated dashboards."""
    acc = get(hass)
    if acc is None:
        connection.send_error(msg["id"], "not_ready", "HK Frontend is still starting")
        return
    connection.send_result(msg["id"], acc.into(msg["area_id"], msg["into"]))


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/accessory/page_order",
    vol.Required("page"): vol.In(PAGE_ORDERS),
    vol.Required("entities"): [vol.All(str, vol.Match(ENTITY))],
    vol.Optional("expect_version"): EXPECT_VERSION,
})
@websocket_api.require_admin
@callback
def ws_accessory_page_order(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                            msg: dict[str, Any]) -> None:
    """A category page's order: the HK Settings page's drag list."""
    acc = get(hass)
    if acc is None:
        connection.send_error(msg["id"], "not_ready", "HK Frontend is still starting")
        return
    if _stale(acc, connection, msg):
        return
    connection.send_result(msg["id"], _answer(acc, msg, acc.page_order(msg["page"], msg["entities"])))


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/accessory/room_scenes",
    vol.Required("area_id"): vol.All(str, vol.Match(AREA)),
    vol.Required("entities"): vol.Any(None, [vol.All(str, vol.Match(ENTITY))]),
    vol.Optional("expect_version"): EXPECT_VERSION,
})
@websocket_api.require_admin
@callback
def ws_accessory_room_scenes(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                             msg: dict[str, Any]) -> None:
    """A room's scenes row on its page: a list ([] for none), or None for
    Automatic."""
    acc = get(hass)
    if acc is None:
        connection.send_error(msg["id"], "not_ready", "HK Frontend is still starting")
        return
    if _stale(acc, connection, msg):
        return
    connection.send_result(msg["id"], _answer(acc, msg, {"scenes": acc.room_scenes(msg["area_id"], msg["entities"])}))


def register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_accessory_room_scenes)
    websocket_api.async_register_command(hass, ws_accessory_page_order)
    websocket_api.async_register_command(hass, ws_accessory_into)
    websocket_api.async_register_command(hass, ws_accessory_set)
    websocket_api.async_register_command(hass, ws_accessory_order)
    websocket_api.async_register_command(hass, ws_board_favorite)
