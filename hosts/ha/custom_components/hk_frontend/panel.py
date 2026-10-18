"""THE HK SETTINGS PAGE: an admin panel in the sidebar ("HK Settings") that
holds every setting of the HK Frontend dashboards in one place, laid out as
an Apple settings screen: each screen on a page of its own beside a live
preview of it, the settings every screen shares, the accessories, pop-ups
and custom pages.

The panel is frontend/panels/hk-settings.js (+ its -model and -kit). What it
needs from here: one read of everything (panel/get), and writes of only what
changed (settings/set, board/set -- checked in settings_api.py exactly as
Configure checks them, into the same storage). Pop-ups, custom pages and a new
screen's item go through their own flows (config_flow.py), driven by the
page. Its first run is the Setup Assistant.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from . import accessories, hiding, kinds, lovelace_boards, settings_api
from . import settings as S
from . import sleep_rules as SR
from .const import CONF_FILES_FOLDER, DEFAULT_FILES_FOLDER, DOMAIN

_LOGGER = logging.getLogger(__name__)

URL_PATH = "hk-settings"
ELEMENT = "hk-settings-panel"
MODULE = Path(__file__).parent / "frontend" / "panels" / "hk-settings.js"

def sidebar_shown(options: Any) -> bool:
    """Configure -> HK Settings page -> Show HK Settings in the sidebar (on
    unless off)."""
    return (options or {}).get("sidebar", True) is not False


async def async_register(hass: HomeAssistant, sidebar: bool = True) -> None:
    """The panel, for admins; in the sidebar unless Configure -> HK Settings
    page says not, where a link opens it either way.

    NOT registered as the domain's config panel (`config_panel_domain`):
    Home Assistant would then open the page from the integration card's gear
    INSTEAD of Configure; the gear keeps Configure, with the switch and the
    link on its first page.

    Registered as panel_custom does it (a "custom" panel whose config names
    the element and module), but directly, because panel_custom has no way to
    keep a panel out of the sidebar. Called again when the switch changes:
    `update` replaces the panel in place.

    The module URL carries the file's time, so an edit reaches the next load
    without a restart's cache."""
    from homeassistant.components import frontend
    # the newest of the page's files (hk-settings.js loads its model and kit
    # with this same stamp)
    try:
        stamp = await hass.async_add_executor_job(
            lambda: int(max(p.stat().st_mtime for p in MODULE.parent.glob("hk-settings*.js"))))
    except (OSError, ValueError):
        stamp = 0
    frontend.async_register_built_in_panel(
        hass, component_name="custom", sidebar_title="HK Settings", sidebar_icon="mdi:home-heart",
        frontend_url_path=URL_PATH, require_admin=True, show_in_sidebar=sidebar, update=True,
        config={"_panel_custom": {"name": ELEMENT, "embed_iframe": False, "trust_external": False,
                                  "handle_safe_area": False,
                                  "module_url": f"/hk/panels/hk-settings.js?v={stamp}"}})


@callback
def async_unregister(hass: HomeAssistant) -> None:
    from homeassistant.components import frontend
    frontend.async_remove_panel(hass, URL_PATH, warn_if_unknown=False)


def _entry(hass: HomeAssistant):
    from . import features as F
    return F.frontend_entry(hass)


def _kiosks(hass: HomeAssistant) -> list[dict[str, str]]:
    from .sleep_engine import kiosks
    try:
        return kiosks(hass)
    except Exception:                                   # noqa: BLE001 -- a registry mid-change
        return []


def _screensavers(hass: HomeAssistant) -> dict[str, dict[str, str | None]]:
    from . import screensaver
    mgr = screensaver.manager(hass)
    return mgr.entity_ids() if mgr else {}


def _tablets(hass: HomeAssistant, entry: Any) -> dict[str, dict[str, Any]]:
    from . import tablets
    items = {s.unique_id: s.subentry_id for s in entry.subentries.values()
             if s.subentry_type == S.SUBENTRY_TABLET and s.unique_id}
    out = {}
    for tid, t in S.tablets(entry).items():
        try:
            p = tablets.parts(hass, t["app"], t["device"])
        except Exception:                               # noqa: BLE001 -- a registry mid-change
            p = {}
        out[tid] = {**t, "item": items.get(tid), "parts": p}
    return out


def _kiosk_devices(hass: HomeAssistant) -> list[dict[str, str]]:
    from . import tablets
    try:
        return tablets.devices(hass)
    except Exception:                                   # noqa: BLE001
        return []


def _suggest(hass: HomeAssistant, entry: Any) -> list[dict[str, Any]]:
    from . import tablets
    try:
        return tablets.suggestions(hass, entry)
    except Exception:                                   # noqa: BLE001
        _LOGGER.debug("tablet suggestions", exc_info=True)
        return []


async def _dashboards(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Every dashboard: its url path, title, whether it is generated, and
    whether it has an item (and which)."""
    out: list[dict[str, Any]] = []
    try:
        boards = lovelace_boards.all_boards(hass)            # the Overview as "lovelace"
    except (ImportError, KeyError, AttributeError):
        return out
    entry = _entry(hass)
    items = {s.unique_id: s.subentry_id for s in (entry.subentries.values() if entry else ())
             if s.subentry_type == S.SUBENTRY_DASHBOARD and s.unique_id}
    for path, dash in boards.items():
        generated = False
        try:
            cfg = await dash.async_load(False)
            strat = (cfg or {}).get("strategy") if isinstance(cfg, dict) else None
            generated = isinstance(strat, dict) and str(strat.get("type", "")).endswith("hk-dashboard")
        except Exception:  # noqa: BLE001 -- an empty dashboard is simply not generated
            pass
        conf = lovelace_boards.config(dash)
        # `id`: the dashboards collection's own, which renaming it takes
        # (lovelace/dashboards/update) -- a YAML dashboard has none, nor has
        # the Overview
        out.append({"path": path, "title": lovelace_boards.title(hass, path), "mode": lovelace_boards.mode(dash),
                    "id": conf.get("id"),
                    "generated": generated, "require_admin": bool(conf.get("require_admin")),
                    "item": items.get(path)})
    return sorted(out, key=lambda d: str(d["title"]).lower())


@websocket_api.websocket_command({vol.Required("type"): "hk_frontend/panel/get"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_panel_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                       msg: dict[str, Any]) -> None:
    """Everything the settings page shows, in one answer."""
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "HK Frontend is not set up")
        return
    popups = [{**p, "item": next((s.subentry_id for s in entry.subentries.values()
                                  if s.subentry_type == S.SUBENTRY_POPUP and s.unique_id == p["hash"]), None)}
              for p in S.popups(entry)]
    items = {s.unique_id: s.subentry_id for s in entry.subentries.values()
             if s.subentry_type == S.SUBENTRY_PAGE and s.unique_id}
    boards = S.boards(entry)
    pages = [{**p, "item": items.get(p["path"]),
              "used_on": [path for path, b in boards.items() if p["path"] in (b.get("custom_pages") or [])]}
             for p in S.custom_pages(entry)]
    found = kinds.current(hass) or {}
    from homeassistant.helpers import entity_registry as er
    from . import files, thirdparty
    dashboards = await _dashboards(hass)
    # a hand-written screen's menu, as its views make it (Menu -> Pages in
    # Menu): which pages, at the top by their own YAML, listed when automatic
    for d in dashboards:
        if d["item"] and not d["generated"]:
            d["menu_layout"] = await _menu_layout(hass, d["path"], boards.get(d["path"]))
    status = await thirdparty.async_status(hass)
    connection.send_result(msg["id"], {
        "entry_id": entry.entry_id,
        "settings": S.merged(entry.options),
        "boards": S.boards(entry),
        # each tablet's own entities (screensaver.py), by tablet id
        "screensavers": _screensavers(hass),
        # THE WALL TABLETS (1.14): each tablet as stored, with All Tablets'
        # idle filled in, its kiosk app's entities by role (tablets.parts),
        # the kiosk apps' devices, and what may be a tablet that isn't one
        "tablets": _tablets(hass, entry),
        "kiosk_devices": _kiosk_devices(hass),
        "tablet_suggest": _suggest(hass, entry),
        "dashboards": dashboards,
        "popups": popups,
        "custom_pages": pages,
        "custom_chips": S.custom_chips(entry),
        "accessories": accessories.current(hass),
        "kinds": {k: len(v) for k, v in found.items()},
        # Hidden Accessories (hiding.py): what can hide what, and what is hidden
        "hidden": hiding.snapshot(hass, hiding.settings_of(hass, entry)),
        "presets": list(S.SCREEN_PRESETS),
        "chip_kinds": list(S.CHIP_KINDS), "page_kinds": list(S.PAGE_ORDER),
        "scene_pages": list(S.SCENE_PAGES), "shelves": {k: v["title"] for k, v in S.SHELVES.items()},
        "setup_done": bool(entry.options.get("setup_done")),
        # a house that never chose an alarm: the one it probably has (General
        # offers it)
        "suggest": ({"alarm": S.suggestions(hass)["alarm"]}
                    if (entry.options.get(S.CONF_DASHBOARD) or {}).get("security") is None else {}),
        # the page lays every setting out itself: Status & Chips kind by kind,
        # the people a wall tablet can sign in as, the integration's own
        # options and switch, the optional cards' state
        "counts": _counts(hass, entry),
        "users": sorted({u.name for u in await hass.auth.async_get_users()
                         if u.name and not u.system_generated}),
        "integration": {
            "sidebar": sidebar_shown(entry.options),
            "files_folder": entry.options.get(CONF_FILES_FOLDER) or DEFAULT_FILES_FOLDER,
            "files": await hass.async_add_executor_job(files.status, hass),
            "decorations": er.async_get(hass).async_get_entity_id(
                "switch", DOMAIN, f"{entry.entry_id}_seasonal_decorations"),
        },
        "thirdparty": {k: {"state": v, "note": thirdparty.note(k, v), "name": S.THIRD_PARTY[k]["name"]}
                       for k, v in status.items()},
        "features": await _features(hass),
        "choices": {
            "status_kinds": list(S.STATUS_KINDS), "browse_categories": list(S.BROWSE_CATEGORIES),
            "status_rows": {p: {"kinds": list(k), "default": list(d)} for p, (k, d) in S.STATUS_ROWS.items()},
            "themes": list(S.THEMES), "sky_often": {k: list(v) for k, v in S.SKY_OFTEN.items()},
            "sky_built_in": {k: {"north": list(S.sky_built_in(k, "north")),
                                 "south": list(S.sky_built_in(k, "south"))} for k in S.SKY_BUILT_IN},
            "sky_backdrops": [dict(p) for p in S.SKY_BACKDROPS],
            "flat_colors": [dict(p) for p in S.FLAT_COLORS],
            # Liveliness: every knob's kind and type, and each occasion's
            # knobs with the decoration style that draws each
            "sky_lively": {"knobs": {k: list(v) for k, v in S.LIVELY_KNOBS.items()},
                           "occasions": {o: [list(x) for x in v] for o, v in S.LIVELY_OCCASIONS.items()}},
            "chips_quiet": list(S.CHIPS_QUIET),
            # Sleep Screen: the Kiosk Satellite devices, and its choices
            "kiosks": _kiosks(hass),
            "sleep": {"after_saver": list(SR.AFTER_SAVER), "linger": list(SR.LINGER)},
        },
    })


# hk-chip.js KIND_ORDER / KIND_PAGES: the chips card's kinds, and the pages
# each opens (the first the dashboard has)
_KIND_ORDER = ("weather_alert", "security", "doors_windows", "climate", "lights", "blinds",
               "timers", "vacuums", "speakers", "water", "energy")
_KIND_PAGES = {"weather_alert": ("weather",), "security": ("security", "alarm"),
               "doors_windows": ("doors-windows", "doors", "security"), "climate": ("climate",), "lights": ("lights",),
               "blinds": ("blinds", "shades", "climate"), "timers": ("timers",), "vacuums": ("vacuums",),
               "speakers": ("playmusic", "speakers"), "water": ("water", "leaks"), "energy": ("energy",)}


def _chip_paths(view: Any, dash: str, views: list | None = None,
                board: dict[str, Any] | None = None) -> list[str]:
    """The pages Home's status chips open, in the order they sit (hk-menu.js
    chipPaths): every hk-status-chip-card's navigate target, as a view path,
    and the chips card's kinds -- the screen's own Chips, else the card's
    `chips:`, else every kind -- each as the first of its pages there is."""
    out: list[str] = []
    board = board or {}
    have = {str(v.get("path") or i) for i, v in enumerate(views or []) if isinstance(v, dict)}

    def walk(node: Any, depth: int) -> None:
        if depth > 14:
            return
        if isinstance(node, list):
            for n in node:
                walk(n, depth + 1)
            return
        if not isinstance(node, dict):
            return
        if node.get("type") == "custom:hk-chips-card" and node.get("in_menu") is False:
            return
        if node.get("type") == "custom:hk-chips-card" and board.get("chips_row") is not False:
            kinds = board.get("chips") or node.get("chips") or _KIND_ORDER
            for k in kinds if isinstance(kinds, (list, tuple)) else ():
                page = next((p for p in _KIND_PAGES.get(k, ()) if p in have), None) if isinstance(k, str) else None
                if page and page not in out:
                    out.append(page)
        if node.get("type") == "custom:hk-status-chip-card":
            t = node.get("tap_action") or {}
            p = str(t.get("navigation_path") or "").split("#")[0].split("?")[0]
            if t.get("action") == "navigate" and p:
                seg = [x for x in p.removeprefix("./").split("/") if x]
                key = seg[1] if len(seg) > 1 and seg[0] == dash else (seg[-1] if seg else "")
                if key and key not in out:
                    out.append(key)
        for v in node.values():
            if isinstance(v, (dict, list)):
                walk(v, depth + 1)

    if isinstance(view, dict):
        walk(view.get("cards") or view.get("sections") or [], 0)
    return out


async def _menu_layout(hass: HomeAssistant, path: str,
                       screen: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """A hand-written dashboard's pages as its menu lists them (hk-menu.js
    model): not Home (the first view), not room pages, not a page that follows
    another; `top` -- its own `menu: top`; `auto` -- listed under Categories
    while that is automatic (Home's chips open it, or there are no chips).
    `screen`: its settings, for the Chips its chips card draws."""
    try:
        board = lovelace_boards.get(hass, path)
        cfg = await board.async_load(False) if board is not None else None
    except Exception:  # noqa: BLE001 -- an unreadable dashboard has no menu to set
        return []
    views = cfg.get("views") if isinstance(cfg, dict) else None
    if not views:
        return []
    chips = _chip_paths(views[0], path, views, screen)
    out: list[dict[str, Any]] = []
    for i, v in enumerate(views):
        if not i or not isinstance(v, dict) or v.get("menu_follows"):
            continue
        if v.get("area") or (isinstance(v.get("strategy"), dict) and v["strategy"].get("area")):
            continue
        title = v.get("menu_title") or v.get("title")
        if not title:
            continue
        key = str(v.get("path") or i)
        off = v.get("menu") in (False, "hidden")
        item = {"path": key, "title": str(title), "top": v.get("menu") == "top",
                "auto": not off and (not chips or key in chips)}
        # its menu name is not its page name (a "House Battery" entry that
        # opens a custom page)
        if v.get("title") and str(v["title"]) != item["title"]:
            item["page"] = str(v["title"])
        out.append(item)
    return out


async def _features(hass: HomeAssistant) -> dict[str, dict[str, Any]]:
    """THE FEATURES (features/, setup_check.COMPANIONS): each one's entries,
    so the page lists a Features page for each one that has been added --
    and a way to add one that is not. Each page reads and saves through that
    feature's own `<id>/settings/*` commands. Always installed: they are part
    of this integration."""
    from . import features as F
    from .setup_check import COMPANIONS
    out: dict[str, dict[str, Any]] = {}
    for fid, kind, name, _what in COMPANIONS:
        entries = [{"entry_id": e.entry_id, "title": e.title, "state": e.state.value}
                   for e in F.entries(hass, kind)]
        out[fid] = {"name": name, "kind": kind, "installed": True, "entries": entries}
    return out


def _counts(hass: HomeAssistant, entry) -> dict[str, dict[str, Any]]:
    """Status & Chips, kind by kind: what it finds by itself (`auto`), what it
    counts now (`found`), the saved Leave out / Also count (or the house's
    old list turned into them, as Configure offers it), whether anything is
    saved, and the domains Also count may add."""
    now = S.merged(entry.options)
    now["accessories"] = accessories.current(hass)
    cands = kinds.candidates(hass)
    auto = kinds.automatic(cands, now.get("generated"))
    found = kinds.resolve(cands, now)
    offer = kinds.suggest(cands, now)
    saved = now.get("counts") or {}
    return {k: {"auto": auto[k], "found": found[k], "exclude": offer[k]["exclude"],
                "include": offer[k]["include"], "saved": saved.get(k) is not None,
                "domains": list(kinds.KINDS[k].domains), "also": list(kinds.KINDS[k].also)}
            for k in kinds.KINDS}


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/setup/done",
    vol.Required("done"): bool,
})
@websocket_api.require_admin
@callback
def ws_setup_done(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                  msg: dict[str, Any]) -> None:
    """The wizard was finished (or is to run again)."""
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "HK Frontend is not set up")
        return
    hass.config_entries.async_update_entry(entry, options={**entry.options, "setup_done": msg["done"]})
    connection.send_result(msg["id"], {"setup_done": msg["done"]})


def _refused(connection: websocket_api.ActiveConnection, msg_id: int, errors: dict[str, str]) -> None:
    """A refusal the page can place on its fields: the message is the
    field -> reason map, as JSON."""
    connection.send_error(msg_id, "invalid_format", json.dumps(errors))


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/settings/set",
    vol.Required("changes"): dict,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_settings_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                          msg: dict[str, Any]) -> None:
    """House settings, only the ones that changed (settings_api.HOUSE), plus
    the page's own two: Show in the sidebar and the files folder."""
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "HK Frontend is not set up")
        return
    changes = dict(msg["changes"])
    folder = changes.pop(CONF_FILES_FOLDER, None) if CONF_FILES_FOLDER in changes else False
    # THE ONE SLOW STEP FIRST (the folder check, in the executor), and the
    # options read only after it: read before the await, a change another
    # write made meanwhile was overwritten with the old value and both
    # writes still answered success.
    errors: dict[str, str] = {}
    path = None
    if folder is not False:
        from . import files
        path = files.normalize(hass.config.config_dir, folder)
        err = await hass.async_add_executor_job(files.validate_folder, hass.config.config_dir, path)
        if err:
            errors[CONF_FILES_FOLDER] = err
    options, more = settings_api.apply_house(entry.options, changes)
    errors.update(more)
    if path is not None and not errors:
        options = {**options, CONF_FILES_FOLDER: path}
    if errors:
        _refused(connection, msg["id"], errors)
        return
    hass.config_entries.async_update_entry(entry, options=options)
    connection.send_result(msg["id"], {"settings": S.merged(options)})


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/calendar/color",
    vol.Required("key"): vol.All(str, vol.Length(min=5, max=240)),
    vol.Optional("color"): vol.Any(None, vol.In(settings_api.PILL_COLORS)),
})
@websocket_api.async_response
async def ws_calendar_color(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                            msg: dict[str, Any]) -> None:
    """AN EVENT'S OWN COLOR, from its sheet (hk-calendar.js): open to every
    user, as editing the event is -- it changes calendar.event_colors and
    nothing else. No color: back to its keyword's or its calendar's."""
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "HK Frontend is not set up")
        return
    cur = dict((S.merged(entry.options).get("calendar") or {}).get("event_colors") or {})
    if msg.get("color"):
        cur[msg["key"]] = msg["color"]
    else:
        cur.pop(msg["key"], None)
    options, errors = settings_api.apply_house(entry.options, {"calendar.event_colors": cur})
    if errors:
        _refused(connection, msg["id"], errors)
        return
    hass.config_entries.async_update_entry(entry, options=options)
    connection.send_result(msg["id"], {"event_colors": cur})


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/board/set",
    vol.Required("dashboard"): vol.All(str, vol.Match(r"^[a-z0-9_-]+$")),
    vol.Required("changes"): dict,
})
@websocket_api.require_admin
@callback
def ws_board_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                 msg: dict[str, Any]) -> None:
    """One screen's settings, only the ones that changed (settings_api.BOARD)."""
    entry = _entry(hass)
    sub = next((s for s in (entry.subentries.values() if entry else ())
                if s.subentry_type == S.SUBENTRY_DASHBOARD and s.unique_id == msg["dashboard"]), None)
    if sub is None:
        connection.send_error(msg["id"], "no_item", "This dashboard has no item yet")
        return
    data, errors = settings_api.apply_board(sub.data, msg["changes"])
    if errors:
        _refused(connection, msg["id"], errors)
        return
    hass.config_entries.async_update_subentry(entry, sub, data=S.board_stored(data))
    # as READ (resolved): a screen following All Screens' rooms or screensaver
    # is handed back with them, as the settings feed sends it
    connection.send_result(msg["id"], {"board": S.resolved(S.board(data), entry.options)})


# ------------------------------------------------------------ wall tablets
def _tablet_sub(entry: Any, tid: str) -> Any:
    return next((s for s in (entry.subentries.values() if entry else ())
                 if s.subentry_type == S.SUBENTRY_TABLET and s.unique_id == tid), None)


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/tablet/set",
    vol.Required("tablet"): str,
    vol.Required("changes"): dict,
})
@websocket_api.require_admin
@callback
def ws_tablet_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """One tablet's settings, only the ones that changed (settings_api.TABLET).
    Its name is its item's title, and its device's name (screensaver.py)."""
    entry = _entry(hass)
    sub = _tablet_sub(entry, msg["tablet"])
    if sub is None:
        connection.send_error(msg["id"], "no_tablet", "There is no such tablet")
        return
    data, errors = settings_api.apply_tablet(sub.data, msg["changes"], msg["tablet"])
    if errors:
        _refused(connection, msg["id"], errors)
        return
    hass.config_entries.async_update_subentry(entry, sub, data=S.tablet_stored(data, msg["tablet"]), title=data["name"])
    connection.send_result(msg["id"], {"tablet": S.tablets(entry).get(msg["tablet"])})


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/tablet/add",
    vol.Required("tablet"): dict,
})
@websocket_api.require_admin
@callback
def ws_tablet_add(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """A new tablet (Add Tablet): its name, screen, room, user, kiosk app and
    device, checked as any change; its id from its name."""
    from types import MappingProxyType
    from homeassistant.config_entries import ConfigSubentry
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "HK Frontend is not set up")
        return
    taken = {s.unique_id for s in entry.subentries.values() if s.subentry_type == S.SUBENTRY_TABLET}
    tid = S.tablet_id(str(msg["tablet"].get("name") or ""), taken)
    data, errors = settings_api.apply_tablet({}, {"name": "", **msg["tablet"]}, tid)
    if errors:
        _refused(connection, msg["id"], errors)
        return
    data["uid"] = f"tablet_{tid}"
    hass.config_entries.async_add_subentry(entry, ConfigSubentry(
        data=MappingProxyType(S.tablet_stored(data, tid)), subentry_type=S.SUBENTRY_TABLET, title=data["name"], unique_id=tid))
    connection.send_result(msg["id"], {"id": tid, "tablet": S.tablets(entry).get(tid)})


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/tablet/remove",
    vol.Required("tablet"): str,
})
@websocket_api.require_admin
@callback
def ws_tablet_remove(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """A tablet gone: its item and its entities (the screen and the kiosk
    app stay)."""
    entry = _entry(hass)
    sub = _tablet_sub(entry, msg["tablet"])
    if sub is None:
        connection.send_error(msg["id"], "no_tablet", "There is no such tablet")
        return
    hass.config_entries.async_remove_subentry(entry, sub.subentry_id)
    connection.send_result(msg["id"], {"removed": msg["tablet"]})


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/tablet/act",
    vol.Required("tablet"): str,
    vol.Required("act"): vol.In(("wake", "sleep", "restart_all", "kiosk_saver")),
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_tablet_act(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                        msg: dict[str, Any]) -> None:
    """Wake Now (as a touch: the dashboard for its in-use window), Sleep Now
    (Sleep Screen's own sleep, once -- the rules decide again after), Fix
    for the kiosk's screensaver (Black, after a day), and the scheduled
    restart run now (`tablet` "*")."""
    from . import screensaver, tablets
    act, tid = msg["act"], msg["tablet"]
    if act == "restart_all":
        w = tablets.watch(hass)
        done = await w.restart_all() if w else []
        connection.send_result(msg["id"], {"restarted": done})
        return
    entry = _entry(hass)
    t = S.tablets(entry).get(tid) if entry else None
    if t is None:
        connection.send_error(msg["id"], "no_tablet", "There is no such tablet")
        return
    if act == "kiosk_saver":
        from .hk_core.tablets.kiosk import kiosk_saver_calls
        for domain, service, data in kiosk_saver_calls(tablets.parts(hass, t["app"], t["device"])):
            await hass.services.async_call(domain, service, data, blocking=True)
        connection.send_result(msg["id"], {"ok": True})
        return
    mgr = screensaver.manager(hass)
    eng = mgr.engines.get(tid) if mgr else None
    if eng is None or not eng.acting:
        connection.send_error(msg["id"], "not_deciding", "HK Frontend doesn't decide when this tablet sleeps")
        return
    if act == "wake":
        mgr.touched(tid)
        eng.evaluate()
    else:
        await eng.sleep(eng.power_off_wanted())
    connection.send_result(msg["id"], {"ok": True})


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/tablet/seen",
    vol.Required("screen"): vol.All(str, vol.Match(r"^[a-z0-9_-]{0,80}$")),
    vol.Required("app"): str,
    vol.Optional("tablet"): vol.Any(None, str),
})
@callback
def ws_tablet_seen(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """A page that looks like a wall tablet's (hk-settings.js: a kiosk app's
    browser) and isn't one of the tablets: a suggestion on Wall Tablets."""
    from . import tablets
    user = connection.user
    if user is None or not user.name:
        connection.send_result(msg["id"], {})
        return
    tablets.saw(hass, user.name, msg["screen"], msg["app"], msg.get("tablet"))
    connection.send_result(msg["id"], {})


@websocket_api.websocket_command({vol.Required("type"): "hk_frontend/setup/check"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_setup_check(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                         msg: dict[str, Any]) -> None:
    """Setup check (setup_check.py) as lines the page draws itself."""
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "HK Frontend is not set up")
        return
    from . import setup_check
    lines = await setup_check.async_run(hass, dict(entry.options), S.boards(entry))
    connection.send_result(msg["id"], {"lines": [{"ok": ln.ok, "title": ln.title, "detail": ln.detail}
                                                 for ln in lines]})


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/chip/save",
    vol.Optional("key"): vol.Any(None, str),
    vol.Required("name"): str,
    vol.Optional("after", default="end"): str,
    vol.Required("card"): dict,
})
@websocket_api.require_admin
@callback
def ws_chip_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """A CUSTOM CHIP (settings.py SUBENTRY_CHIP) made or changed: its name,
    where it sits and its card. Refused by field, as the page's other saves."""
    from homeassistant.config_entries import ConfigSubentry
    from types import MappingProxyType
    from .config_flow import chip_key
    entry = _entry(hass)
    if entry is None:
        connection.send_error(msg["id"], "not_set_up", "HK Frontend is not set up")
        return
    errors: dict[str, str] = {}
    name = msg["name"].strip()
    card = S.chip_card(msg["card"])
    after = msg.get("after") or "end"
    if not name or len(name) > 40:
        errors["name"] = "name_needed"
    if card is None:
        errors["card"] = "chip_card"
    if after not in ("start", "end") and after not in S.CHIP_KINDS:
        errors["after"] = "choice"
    subs = {s.unique_id: s for s in entry.subentries.values() if s.subentry_type == S.SUBENTRY_CHIP}
    sub = subs.get(msg.get("key")) if msg.get("key") else None
    if msg.get("key") and sub is None:
        errors["key"] = "chip_gone"
    if errors:
        _refused(connection, msg["id"], errors)
        return
    data = {"name": name, "after": after, "card": card}
    if sub is None:
        key = chip_key(name, S.taken_ids(entry))
        hass.config_entries.async_add_subentry(entry, ConfigSubentry(
            data=MappingProxyType(data), subentry_type=S.SUBENTRY_CHIP, title=name, unique_id=key))
    else:
        key = sub.unique_id
        hass.config_entries.async_update_subentry(entry, sub, title=name, data=data)
    connection.send_result(msg["id"], {"key": key, "custom_chips": S.custom_chips(entry)})


@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/chip/remove",
    vol.Required("key"): str,
})
@websocket_api.require_admin
@callback
def ws_chip_remove(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """A custom chip gone -- and from every screen that listed it."""
    entry = _entry(hass)
    sub = next((s for s in (entry.subentries.values() if entry else ())
                if s.subentry_type == S.SUBENTRY_CHIP and s.unique_id == msg["key"]), None)
    if sub is None:
        _refused(connection, msg["id"], {"key": "chip_gone"})
        return
    hass.config_entries.async_remove_subentry(entry, sub.subentry_id)
    token = S.CHIP_TOKEN + msg["key"]
    for item in list(entry.subentries.values()):
        if item.subentry_type != S.SUBENTRY_DASHBOARD:
            continue
        d = dict(item.data)
        mine, order = list(d.get("chips_custom") or []), list(d.get("chips") or [])
        if msg["key"] in mine or token in order:
            d["chips_custom"] = [k for k in mine if k != msg["key"]]
            d["chips"] = [k for k in order if k != token]
            hass.config_entries.async_update_subentry(entry, item, data=d)
    connection.send_result(msg["id"], {"custom_chips": S.custom_chips(entry)})


# A SCREEN RENAMED. HK Settings renames the dashboard itself with Home
# Assistant's own lovelace/dashboards/update (its title: the sidebar's name;
# the address stays), then asks for this: the screen's item takes the
# dashboard's new title -- and with it the screensaver's device (screensaver.py
# follows the item's title). Only ever the title Home Assistant now has.
@websocket_api.websocket_command({
    vol.Required("type"): "hk_frontend/dashboard/titled",
    vol.Required("dashboard"): vol.All(str, vol.Match(r"^[a-z0-9_-]+$")),
})
@websocket_api.require_admin
@callback
def ws_dashboard_titled(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                        msg: dict[str, Any]) -> None:
    path = msg["dashboard"]
    board = lovelace_boards.get(hass, path)
    title = lovelace_boards.title(hass, path) if board is not None else ""
    if not title:
        connection.send_error(msg["id"], "no_dashboard", "There's no dashboard at that address")
        return
    entry = _entry(hass)
    sub = next((s for s in (entry.subentries.values() if entry else ())
                if s.subentry_type == S.SUBENTRY_DASHBOARD and s.unique_id == path), None)
    if sub is not None and sub.title != title:
        hass.config_entries.async_update_subentry(entry, sub, title=title)
    connection.send_result(msg["id"], {"title": title})


def register_commands(hass: HomeAssistant) -> None:
    for cmd in (ws_tablet_set, ws_tablet_add, ws_tablet_remove, ws_tablet_act, ws_tablet_seen):
        websocket_api.async_register_command(hass, cmd)
    for cmd in (ws_panel_get, ws_setup_done, ws_settings_set, ws_calendar_color, ws_board_set, ws_setup_check,
                ws_chip_save, ws_chip_remove, ws_dashboard_titled):
        websocket_api.async_register_command(hass, cmd)
