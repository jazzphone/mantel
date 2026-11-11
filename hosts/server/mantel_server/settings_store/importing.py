"""The one-time import of HK's settings from HA (read path only), the generated Home screen, and ``import_cli``."""
from __future__ import annotations

import logging
import hashlib
import json
import sqlite3
import time
from typing import Any, Awaitable, Callable, Mapping

from hk_core.settings import model as SM

from .docs import Actor, CATALOG_KEYS, Doc, KEY_RE, SettingsError, _canon
from .model import ThinModel
from .store import SettingsStore

log = logging.getLogger("mantel.settings")

# ----------------------------------------------------------------------------------- the import
IMPORT_READ = "hk_frontend/panel/get"


# HA's panel/get answers each screen and tablet AS READ (hk_core resolved(): All Screens' screensaver, menu,
# rooms and cameras filled in; All Tablets' Idle settings filled in, the own ones beside them), and the import
# copies that answer. Kept that way, a screen that followed All Screens' screensaver held a frozen copy of it
# (and a tablet All Tablets' Idle). As stored, it follows again: what the screen or tablet says itself.
_READ_ONLY_BOARD = ("screensaver_house", "rooms_house", "cameras_house", "menu_house", "tablets", "idle_room",
                    "side_pane_read")


def as_stored(scope: str, body: Mapping[str, Any]) -> dict:
    """A screen's or tablet's document as its own settings, whether it came from HA's resolved answer or not."""
    b = dict(body)
    if scope == "board":
        follows = b.get("screensaver_house") is True
        for k in _READ_ONLY_BOARD:
            b.pop(k, None)
        if follows:
            b["screensaver_options"] = None
    elif scope == "tablet":
        for k in ("idle_return", "idle_time"):
            if k + "_own" in b:
                b[k] = b.pop(k + "_own")
        b.pop("item", None)
    return b


# ---------------------------------------------------------------------------- the house settings
# HOW THE HOUSE SETTINGS ARE KEPT (SET-2): ``house/settings`` is stored as Home Assistant's HK Frontend stores its
# options' ``dashboard``: per section, only what differs from the defaults (hk_core ``model.house_stored``). What
# reads the whole shape reads ``merged_house`` (``SettingsService.house_settings``), so a default computed from the
# house's place (the sky's hemisphere, the US-only themes) or changed in a later version still applies to a house
# that never chose it. Before 0.1.78 Mantel stored the merged settings, every default baked in.
NORMALISED = "normalised to stored differences"
# the place defaults a house had before Home Assistant said where it is (model.place_sky_defaults with no place)
_NO_PLACE = {"hemisphere": "north", "themes": list(SM.THEMES)}


def merged_house(body: Mapping[str, Any] | None) -> dict:
    """The house settings as every reader sees them: the stored differences over the defaults."""
    return SM.merged({SM.CONF_DASHBOARD: dict(body or {})})


def looks_merged(body: Mapping[str, Any] | None) -> bool:
    """A body with every default in it (what Mantel stored before 0.1.78, HA's panel/get, an old version), not the
    differences: sections a merged body has always had, and the sky's place defaults."""
    if not isinstance(body, Mapping):
        return False
    sky = body.get("sky")
    return all(isinstance(body.get(s), Mapping) for s in ("look", "menu", "clock", "weather", "counts")) and \
        isinstance(sky, Mapping) and "hemisphere" in sky and "themes" in sky


def stored_house(body: Mapping[str, Any] | None, merged_form: bool = True) -> dict:
    """A body as stored: per section, what differs from the defaults (as HK Frontend's mirror.house_options and its
    1.15 trim, settings_trimmed); an empty section goes. ``merged_form`` (HA's panel/get, an old version): the
    sky's hemisphere and themes also go when they are the place default from before the place was known, since a
    merged body baked whichever default was in effect when it was written, and that was never a choice. Browse
    Music's rows go back to their keys."""
    now = merged_house(body)
    out: dict = {}
    for section, values in (body or {}).items():
        if not isinstance(values, Mapping) or section not in now:
            out[section] = values
            continue
        values = dict(values)
        disc = values.get("discover") if section == "browse" else None
        if isinstance(disc, list) and disc and all(isinstance(r, Mapping) for r in disc):
            values["discover"] = [r["key"] for r in disc if isinstance(r.get("key"), str)]
            now[section]["discover"] = values["discover"]
        keep = {k: now[section][k] for k in values if k in now[section]}
        # the Wallpaper and its colour as the pair they are read as (item 45, 2026-11-01): an old id alone
        # ("pinwheel_teal") is Pinwheel in Teal, and both go with it
        if section == "sky" and ("wallpaper" in keep or "wallpaper_color" in keep):
            keep.update({k: now[section][k] for k in ("wallpaper", "wallpaper_color")})
        if section == "sky" and merged_form:
            for k, baked in _NO_PLACE.items():
                if k in keep and keep[k] == baked:
                    keep.pop(k)
        got = SM.house_stored(section, keep)
        if got:
            out[section] = got
    return out


def normalise_house(store: "SettingsStore") -> bool:
    """Once, at start-up: a house/settings stored merged (before 0.1.78) rewritten as the stored differences, as
    a version of its own (``NORMALISED``), so the history keeps the merged one and it can be restored. Idempotent:
    a body already stored as differences is left alone (trimming it again would compare it with a place not known
    yet at start-up, and drop a chosen "north"). True if written."""
    cur = store.get("house", "settings")
    if cur is None or not looks_merged(cur.body):
        return False
    got = store.write([("house", "settings", stored_house(cur.body))], actor=Actor(label="mantel"),
                      message=NORMALISED, expect={("house", "settings"): cur.version})
    if got:
        log.info("house settings normalised to stored differences (version %d)", got[0].version)
    return bool(got)


MENUS_PER_SETTING = "each screen's menu follows All Screens one setting at a time"


def menus_per_setting(store: "SettingsStore") -> bool:
    """Once, at start-up: each screen stored with menu_custom (before 0.1.86; HK Frontend's entry 1.17) rewritten
    with its own menu settings one at a time (hk_core ``menu_per_setting``: what equals All Screens' follows
    again), as a version of its own. Idempotent: a screen without menu_custom is left alone. True if written."""
    docs = {k: d for k, d in store.docs("board").items() if "menu_custom" in d.body}
    if not docs:
        return False
    house = {SM.CONF_DASHBOARD: store.body("house", "settings") or {}}
    moved = SM.menu_per_setting(house, {k: d.body for k, d in docs.items()})
    got = store.write([("board", k, body) for k, body in moved.items()], actor=Actor(label="mantel"),
                      message=MENUS_PER_SETTING, expect={("board", k): d.version for k, d in docs.items()})
    if got:
        log.info("%d screens' menus now follow All Screens one setting at a time", len(got))
    return bool(got)


SIDE_PANES = "the screensaver's pane and Now Playing's moved into the Side Pane"


def side_panes_lifted(store: "SettingsStore") -> bool:
    """Once, at start-up: the screensaver's Calendar / Music pane and Now Playing's Show As: Side Pane (before
    the Side Pane; HK Frontend's entry 1.18) written as the house's and each screen's Side Pane groups (hk_core
    ``side_pane_lifted``), as a version of its own. Mantel's page and server are one release, so the older keys
    are set back as they are moved (``clear``): a second start finds nothing to move. True if written."""
    house = store.get("house", "settings")
    hbody = dict(house.body) if house is not None else {}
    docs = store.docs("board")
    options, items = SM.side_pane_lifted({SM.CONF_DASHBOARD: hbody}, {k: d.body for k, d in docs.items()}, clear=True)
    changes = [("board", k, body) for k, body in items.items() if body != docs[k].body]
    expect = {("board", k): docs[k].version for _, k, _ in changes}
    if options is not None and options[SM.CONF_DASHBOARD] != hbody:
        changes.append(("house", "settings", options[SM.CONF_DASHBOARD]))
        expect[("house", "settings")] = house.version if house is not None else 0
    if not changes:
        return False
    got = store.write(changes, actor=Actor(label="mantel"), message=SIDE_PANES, expect=expect)
    if got:
        log.info("the Side Pane took over the screensaver's and Now Playing's panes (%d documents)", len(got))
    return bool(got)


def stored_of(store: "SettingsStore") -> SM.Stored:
    """Mantel's settings documents as hk_core's model reads HA's entry (SM.Stored), for SM.boards / SM.tablets:
    the screens and tablets AS READ, which is what HA's feed and panel/get hand a screen and HK Settings."""
    items = [SM.Item(SM.SUBENTRY_DASHBOARD, k, as_stored("board", d.body)) for k, d in store.docs("board").items()]
    items += [SM.Item(SM.SUBENTRY_TABLET, k, as_stored("tablet", d.body)) for k, d in store.docs("tablet").items()]
    return SM.Stored({SM.CONF_DASHBOARD: store.body("house", "settings")}, tuple(items))


def docs_from_panel(payload: Any) -> list[tuple[str, str, dict]]:
    """HA's ``hk_frontend/panel/get`` answer -> the documents Mantel keeps. What HA works out at run
    time (its dashboards, the kiosk devices, counts, third-party status, the users of HA, each
    tablet's entities) is not settings and is not kept."""
    if not isinstance(payload, dict) or not isinstance(payload.get("settings"), dict):
        raise SettingsError("not_hk_settings", "Home Assistant's answer has no HK settings in it")
    out: list[tuple[str, str, dict]] = [
        # HA's panel/get answers the merged settings: kept as HA keeps them, the differences (stored_house)
        ("house", "settings", stored_house({k: v for k, v in payload["settings"].items() if isinstance(v, dict)})),
        ("house", "setup", {"setup_done": bool(payload.get("setup_done"))}),
        ("house", "popups", {"items": [p for p in payload.get("popups") or [] if isinstance(p, dict)]}),
        ("house", "custom_pages", {"items": [{k: v for k, v in p.items() if k != "used_on"}
                                             for p in payload.get("custom_pages") or [] if isinstance(p, dict)]}),
        ("house", "custom_chips", {"items": [c for c in payload.get("custom_chips") or [] if isinstance(c, dict)]}),
    ]
    if isinstance(payload.get("accessories"), dict):
        out.append(("house", "accessories", payload["accessories"]))
    catalog = {k: payload[k] for k in CATALOG_KEYS if k in payload}
    if catalog:
        out.append(("house", "catalog", catalog))
    boards = {str(path): as_stored("board", board) for path, board in sorted((payload.get("boards") or {}).items())
              if isinstance(board, dict) and KEY_RE["board"].match(str(path))}
    # each screen's menu one setting at a time (hk_core menu_per_setting): an older HK Frontend answers menu_custom,
    # and every answer bakes All Screens' menu into the screens that follow it
    for path, body in SM.menu_per_setting({SM.CONF_DASHBOARD: out[0][2]}, boards).items():
        out.append(("board", path, body))
    for tid, tablet in sorted((payload.get("tablets") or {}).items()):
        if isinstance(tablet, dict) and KEY_RE["tablet"].match(str(tid)):
            out.append(("tablet", str(tid), as_stored("tablet", {k: v for k, v in tablet.items() if k != "parts"})))
    return out


# A Mantel with no screens (a fresh one whose Home Assistant has no HK Frontend, or one not imported yet) gets
# one: a Home screen HK's strategy builds from the house's rooms and devices (its pages empty), as a screen
# Add Screen makes for phones and computers (hk_core new_board). Written once, as version 1 from
# GENERATED, only while there is no board and no import; the import replaces it while it is untouched.
HOME_SCREEN = "dashboard-home"
GENERATED = "mantel:generated"
NO_HK_FRONTEND = ("Home Assistant doesn't run HK Frontend, so there is nothing to import. Mantel's generated Home "
                  "screen builds itself from your rooms and devices.")


def seed_home_screen(store: SettingsStore) -> bool:
    """Give a Mantel without screens its generated Home screen. False (and nothing written) when it has a
    screen or has imported HK's settings (an imported house keeps exactly what came over)."""
    if store.docs("board") or store.import_record() is not None:
        return False
    house = store.body("house", "settings")
    body = SM.new_board("personal", {SM.CONF_DASHBOARD: house} if house else None)
    try:
        with store.conn:
            if store.conn.execute("SELECT 1 FROM settings_docs WHERE scope='board' LIMIT 1").fetchone() or \
                    store.conn.execute("SELECT 1 FROM settings_import WHERE id=1").fetchone():
                return False
            store._write_one("board", HOME_SCREEN, body, actor=Actor(label="mantel"), action="set",
                             message="a generated Home screen: Mantel had no screens", source=GENERATED,
                             now=float(store.clock()))
    except sqlite3.Error as exc:     # never fatal: /home then opens Mantel Settings, as before
        log.warning("the generated Home screen was not written (%s)", type(exc).__name__)
        return False
    log.info("Mantel had no screens: it has a generated Home screen (/%s/home)", HOME_SCREEN)
    return True


def _untouched_seed(store: SettingsStore) -> Doc | None:
    """The generated Home screen, while nobody has changed it (its only version is the one written)."""
    cur = store.get("board", HOME_SCREEN)
    if cur is None or cur.version != 1:
        return None
    first = store.history("board", HOME_SCREEN, limit=1)
    return cur if first and first[0]["source"] == GENERATED else None


async def import_settings(store: SettingsStore, fetch: Callable[[], Awaitable[Any]], *, actor: Actor,
                          model: ThinModel | None = None,
                          read_features: Callable[[dict], Awaitable[Any]] | None = None) -> dict:
    """The one-time import. Reads HA once (``fetch``: the ``hk_frontend/panel/get`` read), writes each
    document that does not exist yet as version 1 (``action='import'``, ``source='ha:<entry>'``),
    leaves any that exist alone, and records the import. A second run reads nothing and changes
    nothing: it answers ``{"imported": False, "already": <the first import>}``.

    The generated Home screen (seed_home_screen) gives way when HA's answer has screens and nobody has
    changed it: it is removed in the same transaction (``replaced``), so an imported house has exactly
    HA's screens. Once changed, it is the house's own and is left alone like any other document.

    ``read_features`` (a server-only read, ``{"type": ...}`` -> HA's answer): the feature items too
    (features.import_features: which HK features HA has added, and the settings of Notifications, Clean
    Areas, Energy and Live TV) as ``house/mantel_features``. A feature read that fails leaves that
    document out (``features_error``); the rest is imported, and ``POST /api/features/import`` can read
    the features again on their own."""
    model = model or ThinModel()
    prior = store.import_record()
    if prior is not None:
        return {"imported": False, "already": prior}
    payload = await fetch()
    docs = docs_from_panel(payload)
    entry = payload.get("entry_id")
    source = f"ha:{entry}" if isinstance(entry, str) and entry else "ha"
    features_error = None
    if read_features is not None:
        from .. import features as F
        try:
            docs.append(("house", F.FEATURES_DOC, await F.import_features(payload, read_features, None, source[:80])))
        except Exception as exc:  # noqa: BLE001 -- the settings still come over; the features can be read again
            features_error = type(exc).__name__
            log.warning("the feature items were not imported (%s); POST /api/features/import reads them again",
                        features_error)
        from .. import music as M     # Music's settings (house/music), when HA has Music added
        try:
            body = await M.import_doc(payload, read_features, source[:80])
            if body is not None:
                docs.append(("house", M.MUSIC_DOC, body))
        except Exception as exc:  # noqa: BLE001 -- as the features: POST /api/features/import reads it again
            log.warning("the music settings were not imported (%s); POST /api/features/import reads them again",
                        type(exc).__name__)
    for scope, key, body in docs:
        model.check_document(scope, key, body)
    checksum = hashlib.sha256(_canon(payload).encode()).hexdigest()
    now = float(store.clock())
    written, skipped, replaced = [], [], []
    try:
        with store.conn:
            if store.conn.execute("SELECT 1 FROM settings_import WHERE id=1").fetchone():
                raise sqlite3.IntegrityError("already imported")
            seed = _untouched_seed(store) if any(scope == "board" for scope, _, _ in docs) else None
            if seed is not None:
                store._remove_one(seed, actor=actor, message="replaced by the import", now=now)
                replaced.append(f"board/{HOME_SCREEN}")
            for scope, key, body in docs:
                if store.get(scope, key) is not None:
                    skipped.append(f"{scope}/{key}")
                    continue
                store._write_one(scope, key, body, actor=actor, action="import", message=IMPORT_READ, source=source,
                                 now=now)
                written.append(f"{scope}/{key}")
            store.conn.execute(
                "INSERT INTO settings_import (id, source, read, checksum, written, skipped, actor, created) "
                "VALUES (1,?,?,?,?,?,?,?)",
                (source, IMPORT_READ, checksum, json.dumps(written), json.dumps(skipped), actor.id, now))
    except sqlite3.IntegrityError:
        return {"imported": False, "already": store.import_record()}
    log.info("imported HK settings from %s: %d documents written, %d left as they were", source, len(written), len(skipped))
    out = {"imported": True, "source": source, "read": IMPORT_READ, "checksum": checksum,
           "written": written, "skipped": skipped}
    if replaced:
        out["replaced"] = replaced
    if read_features is not None:
        out["features_error"] = features_error
    return out


# ------------------------------------------------------------------------------------------ CLI
async def import_cli(data_dir, ha_url: str, token: str, out=print, ws_url: str | None = None) -> int:
    """``mantel-server import-settings``: read HK's settings from HA once (the read path only) and
    write them as version 1. Exit 0 when imported or already imported."""
    from pathlib import Path

    from ..ha.readproxy import ReadProxy
    from ..store import Store
    st = Store(Path(data_dir).expanduser() / "mantel.db")
    proxy = ReadProxy(ha_url, token, ws_url=ws_url)
    try:
        got = await import_settings(SettingsStore(st.db), proxy.read_hk_settings, actor=Actor(label="cli"),
                                    read_features=proxy.read_server)
    except SettingsError as exc:
        out(f"mantel-server: import refused: {exc.code}: {exc}")
        return 1
    except Exception as exc:  # noqa: BLE001
        out(f"mantel-server: could not read HK's settings from Home Assistant: {exc}")
        return 1
    finally:
        await proxy.close()
        st.db.close()
    if got["imported"]:
        out(f"imported HK settings from {got['source']}: {len(got['written'])} documents written as version 1"
            + (f", {len(got['skipped'])} already in Mantel left as they were" if got["skipped"] else ""))
        if got.get("replaced"):
            out("Mantel's generated Home screen, never changed, gave way to HK's screens")
        if got.get("features_error"):
            out(f"the feature items were not read ({got['features_error']}); POST /api/features/import reads them again")
    else:
        a = got["already"] or {}
        out(f"already imported from {a.get('source')} at {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(a.get('created') or 0))}; nothing changed")
    return 0
