"""P3.5: HK's settings in Mantel's own database, versioned, with history, served with the message
types and shapes HK's frontend already uses (PLAN §2 "Settings live in a config entry", §4 "HK's own
data in SQLite", §5, §10 "HK Settings").

What is here:

* ``SettingsStore``: documents ``(scope, key) -> JSON object`` in ``settings_docs`` (migration
  ``0003_settings.sql``). Every change that changes something is a new version and an append-only
  ``settings_history`` row (who, which device, when, which message, the diff, the whole body).
  ``restore`` makes a NEW version from an older one's body; nothing is ever rewritten.
* ``ThinModel``: the checks a write passes before it is stored. It is a deliberately thin stand-in
  for HK's settings model (``settings.py`` / ``settings_api.py`` in the HA component, which another
  model, ``hk_core/settings/``). ``load_model()`` uses ``hk_core.settings.changes`` (apply_house,
  apply_board, apply_tablet) and ``hk_core.settings.model`` (merged) when present; otherwise ThinModel.
* ``SettingsService``: the client API.
    - reads (in a page's ``read`` / ``read_subscribe`` frame, routed by ``app["read_routes"]``):
      ``hk_frontend/settings/subscribe`` (the settings feed: the whole payload now and after every
      change, as HA's feed sends it), ``hk_frontend/panel/get`` (HK Settings' one read),
      ``mantel/settings/get`` and ``mantel/settings/history``.
    - saves (client message ``settings_write {id, msg}`` -> ``settings_result {id, result|error}``):
      ``hk_frontend/settings/set``, ``board/set``, ``tablet/set``, ``setup/done``,
      ``calendar/color``, ``chip/save``, ``chip/remove``, plus ``mantel/settings/user/set`` and
      ``mantel/settings/restore``.
  Every save asks ``hooks.may_configure(identity, Scope)`` (RBAC ``configure``: house, screen and
  tablet scopes are the ``settings`` feature, a person's own user scope is ``profile``).
  **Settings saves are HK's own data, not house commands**: they are allowed while house commands
  are disabled (``commands.enabled = false``), because nothing here sends anything to Home Assistant
  or to any device. Saves that would change Home Assistant (an HA
  helper or dashboard created, an image deleted, a service called ...) are refused (``ha_write``);
  HK data Mantel does not hold yet is refused as ``not_yet`` (only Mute 1 Hour now, which the page sends as
  Mantel's own frame: accessories, Hidden Accessories, Music and the Alarm PIN are Mantel's,
  docs/phase9/NO-HK-FRONTEND.md). ``SAVE_KINDS`` classifies every type in
  ``hkClient.WRITES`` (pinned by a test).
* ``import_settings``: the one-time import of HK's current settings from HA's config entry, over the
  read path only (``hk_frontend/panel/get``, the one read HK Settings itself makes), written as
  version 1 with the source recorded. Idempotent: a second run changes nothing and says when the
  first one ran. It never writes to HA. CLI ``mantel-server import-settings``; REST
  ``POST /api/settings/import`` (Owner only; Mantel Settings -> Connections offers it).
* ``seed_home_screen``: a Mantel with no screens and no import gets a generated Home screen
  (``board/dashboard-home``), which an import replaces while it is untouched.
* ``register(app, hub, hooks)``: fills ``app["read_routes"]``, ``app["ws_handlers"]`` and the REST
  routes, like P3.4's connectors. server.py is not touched here; P3.7 wires it.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import importlib
import inspect
import types
import json
import logging
import re
import sqlite3
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Iterable, Mapping

from aiohttp import web

from hk_core.settings import model as SM

from . import accessories as ACC
from .connectors import Ctx, Forbidden, Route, read_routes, ws_handlers

log = logging.getLogger("mantel.settings")

# ------------------------------------------------------------------------------------ documents
SCOPES = ("house", "board", "tablet", "user")
# house documents: the house-wide settings sections, the Setup Assistant's flag, the house's own
# content (pop-ups, custom pages, custom chips), accessories' settings, and the catalog (the model's
# choice lists HK Settings lays its controls out with; read-only, from the import until hk_core's
# model supplies them).
HOUSE_DOCS = ("settings", "setup", "popups", "custom_pages", "custom_chips", "accessories", "catalog")
CATALOG_KEYS = ("choices", "presets", "chip_kinds", "page_kinds", "scene_pages", "shelves")
# The house settings' sections (settings.py DEFAULTS, the HA component, 2026-10-18).
HOUSE_SECTIONS = ("status_rows", "headers", "security", "clock", "weather", "sky", "idle", "tablets", "car",
                  "generated", "counts", "features", "menu", "rooms", "cameras", "look", "calendar",
                  "now_playing", "browse")
# What a person may set for themselves (PLAN §5: an Adult has "no settings beyond their own"). Their
# values lie over the house's in their own settings feed. Appearance only, for now.
USER_SECTIONS = ("look", "sky")

KEY_RE = {
    "board": re.compile(r"^[a-z0-9_-]{1,80}$"),
    "tablet": re.compile(r"^[a-z0-9_-]{1,80}$"),
    "user": re.compile(r"^[A-Za-z0-9_-]{1,64}$"),
}
HOUSE_PATH = re.compile(r"^([a-z][a-z0-9_]*)\.([a-z0-9][a-z0-9_]*)$")
FLAT_KEY = re.compile(r"^[a-z][a-z0-9_]*$")
ENTITY = re.compile(r"^([a-z0-9_]+)\.[a-z0-9_]+$")
# settings_api.py's patch paths and the reset: they need the real model's merge rules
NEEDS_MODEL = re.compile(r"^sky\.reset$|^sky\.flat_image_look\.patch$|^sky\.flat_page_image_looks\.|"
                         r"^look\.flat_colors\.|^look\.flat_page_colors\.")
NEEDS_MODEL_BOARD = re.compile(r"\.")
# options of the HA integration itself (its sidebar panel, HK as its own HA panel, the files folder
# on HA's disk): they change Home Assistant, not HK's settings
HA_ONLY_TOP = frozenset({"sidebar", "hk_panel", "files_folder"})
PILL_COLORS = ("white", "yellow", "orange", "red", "pink", "purple", "blue", "teal", "mint", "green")
CHIP_KINDS = ("weather_alert", "security", "doors_windows", "climate", "lights", "blinds",
              "timers", "vacuums", "speakers", "water", "energy")
CHIP_TOKEN = "chip:"
CHIP_CARD_MAX = 20_000
MAX_DOC = 2_000_000        # bytes of JSON per document
MAX_VALUE = 200_000        # bytes of JSON per changed value
MAX_DEPTH = 16
MAX_CHANGES = 200
HISTORY_LIMIT = 200


@dataclass(frozen=True)
class Scope:
    """What a save changes, as RBAC sees it: ``kind`` is a scope, ``key`` the document."""
    kind: str
    key: str

    def __str__(self) -> str:
        return f"{self.kind}/{self.key}"


@dataclass(frozen=True)
class Doc:
    scope: str
    key: str
    version: int
    body: dict
    updated: float
    updated_by: str | None


@dataclass(frozen=True)
class Actor:
    """Who made a change, for the history row."""
    user_id: str | None = None
    role: str | None = None
    device_id: str | None = None
    label: str | None = None

    @property
    def id(self) -> str:
        if self.user_id:
            return self.user_id
        if self.device_id:
            return f"device:{self.device_id}"
        return self.label or "system"


class SettingsError(Exception):
    """A save or read that cannot be made. ``code`` is what the page gets; ``fields`` (path -> reason)
    is sent as the message, as JSON, exactly as HA's ``invalid_format`` refusals are."""

    def __init__(self, code: str, message: str = "", fields: Mapping[str, str] | None = None) -> None:
        self.code = code
        self.fields = dict(fields or {})
        super().__init__(json.dumps(self.fields, sort_keys=True) if self.fields else (message or code))


def _canon(value: Any) -> str:
    """For comparing and checksums only (key order ignored)."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _stored(value: Any) -> str:
    """As stored: key order kept."""
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _depth(v: Any, d: int = 0) -> int:
    if d > MAX_DEPTH:
        return d
    if isinstance(v, dict):
        return max([_depth(x, d + 1) for x in v.values()] or [d + 1])
    if isinstance(v, list):
        return max([_depth(x, d + 1) for x in v] or [d + 1])
    return d


def _plain(value: Any, limit: int = MAX_VALUE) -> Any:
    """A JSON value (str keys, finite numbers), not too big or deep, as a fresh copy; else Invalid."""
    try:
        text = json.dumps(value, allow_nan=False, ensure_ascii=False)
    except (TypeError, ValueError) as exc:
        raise _Invalid("invalid") from exc
    if len(text.encode()) > limit or _depth(value) > MAX_DEPTH:
        raise _Invalid("too_big")
    return json.loads(text)


def diff(old: Any, new: Any, prefix: str = "") -> dict[str, dict]:
    """What changed between two documents, by dotted path (lists are compared whole)."""
    out: dict[str, dict] = {"added": {}, "removed": {}, "changed": {}}

    def walk(a: Any, b: Any, p: str) -> None:
        if isinstance(a, dict) and isinstance(b, dict):
            for k in a:
                q = f"{p}.{k}" if p else str(k)
                if k not in b:
                    out["removed"][q] = a[k]
                else:
                    walk(a[k], b[k], q)
            for k in b:
                if k not in a:
                    out["added"][f"{p}.{k}" if p else str(k)] = b[k]
        elif _canon(a) != _canon(b):
            out["changed"][p or "."] = [a, b]

    walk(old, new, prefix)
    return out


def _empty(d: Mapping[str, dict]) -> bool:
    return not (d["added"] or d["removed"] or d["changed"])


# ---------------------------------------------------------------------------------------- store
class SettingsStore:
    """The documents and their history over the shared sqlite connection (db.py)."""

    def __init__(self, conn: sqlite3.Connection, clock: Callable[[], float] = time.time) -> None:
        self.conn = conn
        self.clock = clock

    @staticmethod
    def _doc(row: sqlite3.Row) -> Doc:
        return Doc(row["scope"], row["key"], row["version"], json.loads(row["body"]), row["updated"], row["updated_by"])

    def get(self, scope: str, key: str) -> Doc | None:
        row = self.conn.execute("SELECT * FROM settings_docs WHERE scope=? AND key=?", (scope, key)).fetchone()
        return self._doc(row) if row else None

    def body(self, scope: str, key: str) -> dict:
        d = self.get(scope, key)
        return copy.deepcopy(d.body) if d else {}

    def docs(self, scope: str) -> dict[str, Doc]:
        rows = self.conn.execute("SELECT * FROM settings_docs WHERE scope=? ORDER BY key", (scope,)).fetchall()
        return {r["key"]: self._doc(r) for r in rows}

    def empty(self) -> bool:
        return self.conn.execute("SELECT 1 FROM settings_docs LIMIT 1").fetchone() is None

    def _write_one(self, scope: str, key: str, body: dict, *, actor: Actor, action: str, message: str | None,
                   source: str | None, now: float, expect_version: int | None = None) -> Doc | None:
        if scope not in SCOPES:
            raise SettingsError("invalid", f"unknown scope {scope!r}")
        if not isinstance(body, dict):
            raise SettingsError("invalid", "a settings document is a JSON object")
        text = _stored(body)                      # key order kept (a card's YAML reads back as written)
        if len(text.encode()) > MAX_DOC:
            raise SettingsError("too_big", f"{scope}/{key} would be larger than {MAX_DOC} bytes")
        cur = self.get(scope, key)
        if expect_version is not None and (cur.version if cur else 0) != expect_version:
            raise SettingsError("conflict", f"{scope}/{key} changed meanwhile (now version {cur.version if cur else 0})")
        old = cur.body if cur else {}
        d = diff(old, body)
        if cur is not None and _empty(d):
            return None                                        # nothing changed: no new version
        version = (cur.version if cur else self._last_version(scope, key)) + 1
        self.conn.execute(
            "INSERT INTO settings_history (scope, key, version, body, diff, action, message, actor, actor_role, device,"
            " source, created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (scope, key, version, text, _stored(d), action, message, actor.id, actor.role, actor.device_id, source, now))
        self.conn.execute(
            "INSERT INTO settings_docs (scope, key, version, body, updated, updated_by) VALUES (?,?,?,?,?,?) "
            "ON CONFLICT(scope, key) DO UPDATE SET version=excluded.version, body=excluded.body, "
            "updated=excluded.updated, updated_by=excluded.updated_by",
            (scope, key, version, text, now, actor.id))
        return Doc(scope, key, version, json.loads(text), now, actor.id)

    def _last_version(self, scope: str, key: str) -> int:
        """The last version a document had, also when it was removed (its history stays; a new one goes on)."""
        row = self.conn.execute("SELECT MAX(version) AS v FROM settings_history WHERE scope=? AND key=?",
                                (scope, key)).fetchone()
        return int(row["v"] or 0) if row is not None else 0

    def remove(self, scope: str, key: str, *, actor: Actor, message: str | None = None) -> bool:
        """Remove a document (a tablet taken off Wall Tablets). Its history stays, with a last version saying it
        was removed (an empty body; the message says why: the history's actions are set, restore and import), so
        ``restore`` can bring any earlier version back."""
        cur = self.get(scope, key)
        if cur is None:
            return False
        with self.conn:
            self._remove_one(cur, actor=actor, message=message, now=float(self.clock()))
        return True

    def _remove_one(self, cur: Doc, *, actor: Actor, message: str | None, now: float) -> None:
        """remove()'s two statements, inside the caller's transaction."""
        self.conn.execute(
            "INSERT INTO settings_history (scope, key, version, body, diff, action, message, actor, actor_role,"
            " device, source, created) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (cur.scope, cur.key, cur.version + 1, "{}", _stored(diff(cur.body, {})), "set", message or "removed",
             actor.id, actor.role, actor.device_id, None, now))
        self.conn.execute("DELETE FROM settings_docs WHERE scope=? AND key=?", (cur.scope, cur.key))

    def write(self, changes: Iterable[tuple[str, str, dict]], *, actor: Actor, action: str = "set",
              message: str | None = None, source: str | None = None,
              expect: Mapping[tuple[str, str], int] | None = None) -> list[Doc]:
        """Write several documents in ONE transaction (all or nothing). Returns the new versions of the
        documents that actually changed (an unchanged body makes no version)."""
        now = float(self.clock())
        out: list[Doc] = []
        with self.conn:
            for scope, key, body in changes:
                got = self._write_one(scope, key, body, actor=actor, action=action, message=message, source=source,
                                      now=now, expect_version=(expect or {}).get((scope, key)))
                if got is not None:
                    out.append(got)
        return out

    def history(self, scope: str, key: str, limit: int = 50, bodies: bool = False) -> list[dict]:
        limit = max(1, min(int(limit), HISTORY_LIMIT))
        rows = self.conn.execute("SELECT * FROM settings_history WHERE scope=? AND key=? ORDER BY version DESC LIMIT ?",
                                 (scope, key, limit)).fetchall()
        out = []
        for r in rows:
            item = {"version": r["version"], "action": r["action"], "message": r["message"], "actor": r["actor"],
                    "actor_role": r["actor_role"], "device": r["device"], "source": r["source"], "created": r["created"],
                    "diff": json.loads(r["diff"])}
            if bodies:
                item["body"] = json.loads(r["body"])
            out.append(item)
        return out

    def version_body(self, scope: str, key: str, version: int) -> dict | None:
        row = self.conn.execute("SELECT body FROM settings_history WHERE scope=? AND key=? AND version=?",
                                (scope, key, int(version))).fetchone()
        return json.loads(row["body"]) if row else None

    def restore(self, scope: str, key: str, version: int, *, actor: Actor, message: str | None = None) -> Doc | None:
        """A NEW version whose body is ``version``'s. None if the document already is that body."""
        body = self.version_body(scope, key, version)
        if body is None:
            raise SettingsError("no_version", f"{scope}/{key} has no version {version}")
        got = self.write([(scope, key, body)], actor=actor, action="restore", message=message, source=f"v{int(version)}")
        return got[0] if got else None

    # -- the one-time import -----------------------------------------------------------------
    def import_record(self) -> dict | None:
        row = self.conn.execute("SELECT * FROM settings_import WHERE id=1").fetchone()
        if row is None:
            return None
        return {"source": row["source"], "read": row["read"], "checksum": row["checksum"],
                "written": json.loads(row["written"]), "skipped": json.loads(row["skipped"]),
                "actor": row["actor"], "created": row["created"]}

    def user_exists(self, user_id: str) -> bool:
        try:
            return self.conn.execute("SELECT 1 FROM users WHERE id=?", (user_id,)).fetchone() is not None
        except sqlite3.OperationalError:          # a bare connection without P3.1's users table (tests)
            return True


# ---------------------------------------------------------------------------------------- model
class _Invalid(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _jtype(v: Any) -> str:
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, str):
        return "text"
    if isinstance(v, list):
        return "list"
    if isinstance(v, dict):
        return "object"
    return "null"


def _like(current: Any, value: Any) -> None:
    """A value keeps its kind: a bool stays a bool, an entity id stays an entity id (null clears)."""
    if current is None or value is None:
        return
    if _jtype(current) != _jtype(value):
        raise _Invalid(_jtype(current))
    if isinstance(current, str) and ENTITY.match(current) and value != "" and not ENTITY.match(value):
        raise _Invalid("entity")
    if (isinstance(current, list) and current and all(isinstance(x, str) and ENTITY.match(x) for x in current)
            and not all(isinstance(x, str) and ENTITY.match(x) for x in value)):
        raise _Invalid("entity")


class ThinModel:
    """The checks every save passes until hk_core's settings model is here.

    Thin on purpose, and strict where it is thin: a change names a known section (house) or a key
    the document already has; its value is plain JSON of the kind the stored value is; the paths that
    need the real model's merge rules (patches, the sky reset) are refused (``needs_model``) rather
    than stored wrongly; nothing is written unless every change in the call is good (as
    ``settings_api.apply_house`` does). Errors are ``{path: code}``.
    """
    name = "thin"

    def _check_changes(self, changes: Any) -> Mapping[str, Any]:
        if not isinstance(changes, dict) or not changes:
            raise SettingsError("invalid_format", fields={"changes": "object"})
        if len(changes) > MAX_CHANGES:
            raise SettingsError("invalid_format", fields={"changes": "too_many"})
        return changes

    def apply_house(self, doc: Mapping[str, Any], changes: Any) -> tuple[dict, dict[str, str]]:
        changes = self._check_changes(changes)
        out = copy.deepcopy(dict(doc))
        errors: dict[str, str] = {}
        for path, value in changes.items():
            try:
                if not isinstance(path, str):
                    raise _Invalid("unknown")
                if path in HA_ONLY_TOP:
                    raise _Invalid("ha_only")
                if NEEDS_MODEL.match(path):
                    raise _Invalid("needs_model")
                m = HOUSE_PATH.match(path)
                if not m or m.group(1) not in HOUSE_SECTIONS:
                    raise _Invalid("unknown")
                section, key = m.groups()
                values = out.get(section) if isinstance(out.get(section), dict) else {}
                if values and key not in values:
                    raise _Invalid("unknown")
                value = _plain(value)
                _like(values.get(key), value)
                out[section] = {**values, key: value}
            except _Invalid as err:
                errors[str(path)] = err.code
        return (dict(doc), errors) if errors else (out, {})

    def _apply_flat(self, doc: Mapping[str, Any], changes: Any, frozen: Iterable[str] = ()) -> tuple[dict, dict[str, str]]:
        changes = self._check_changes(changes)
        out = copy.deepcopy(dict(doc))
        errors: dict[str, str] = {}
        for key, value in changes.items():
            try:
                if not isinstance(key, str):
                    raise _Invalid("unknown")
                if NEEDS_MODEL_BOARD.search(key):
                    raise _Invalid("needs_model")
                if not FLAT_KEY.match(key) or key in frozen or (out and key not in out):
                    raise _Invalid("unknown")
                value = _plain(value)
                _like(out.get(key), value)
                out[key] = value
            except _Invalid as err:
                errors[str(key)] = err.code
        return (dict(doc), errors) if errors else (out, {})

    def apply_board(self, doc: Mapping[str, Any], changes: Any) -> tuple[dict, dict[str, str]]:
        return self._apply_flat(doc, changes)

    def apply_tablet(self, doc: Mapping[str, Any], changes: Any, tablet_id: str) -> tuple[dict, dict[str, str]]:
        new, errors = self._apply_flat(doc, changes, frozen=("uid",))
        if not errors and "name" in changes:
            name = changes["name"]
            if not isinstance(name, str) or not name.strip() or len(name.strip()) > 40:
                errors = {"name": "name_needed"}
                new = dict(doc)
            else:
                new["name"] = name.strip()
        return new, errors

    def apply_user(self, doc: Mapping[str, Any], changes: Any, house: Mapping[str, Any]) -> tuple[dict, dict[str, str]]:
        """A person's own values over the house's: ``{"look.glass": "clear"}``; null takes one away."""
        changes = self._check_changes(changes)
        out = copy.deepcopy(dict(doc))
        errors: dict[str, str] = {}
        for path, value in changes.items():
            try:
                m = HOUSE_PATH.match(path) if isinstance(path, str) else None
                if not m or NEEDS_MODEL.match(path):
                    raise _Invalid("unknown")
                section, key = m.groups()
                if section not in USER_SECTIONS:
                    raise _Invalid("not_personal")
                hv = house.get(section) if isinstance(house.get(section), dict) else {}
                if hv and key not in hv:
                    raise _Invalid("unknown")
                mine = dict(out.get(section) or {})
                if value is None:
                    mine.pop(key, None)
                else:
                    value = _plain(value)
                    _like(hv.get(key), value)
                    mine[key] = value
                if mine:
                    out[section] = mine
                else:
                    out.pop(section, None)
            except _Invalid as err:
                errors[str(path)] = err.code
        return (dict(doc), errors) if errors else (out, {})

    def chip(self, name: Any, after: Any, card: Any) -> tuple[dict, dict[str, str]]:
        """A custom chip as stored (settings.py custom_chip / chip_card), or the fields refused."""
        errors: dict[str, str] = {}
        name = name.strip() if isinstance(name, str) else ""
        if not name or len(name) > 40:
            errors["name"] = "name_needed"
        after = after or "end"
        if after not in ("start", "end") and after not in CHIP_KINDS:
            errors["after"] = "choice"
        good_card = None
        if isinstance(card, dict) and isinstance(card.get("type"), str) and card["type"]:
            try:
                good_card = _plain(card, CHIP_CARD_MAX)
            except _Invalid:
                good_card = None
        if good_card is None:
            errors["card"] = "chip_card"
        return {"name": name, "after": after, "card": good_card}, errors

    def check_document(self, scope: str, key: str, body: Any) -> None:
        """What an imported or restored document must be: a JSON object, not too big, house settings
        as sections of values."""
        if not isinstance(body, dict):
            raise SettingsError("invalid", f"{scope}/{key} is not a JSON object")
        try:
            _plain(body, MAX_DOC)
        except _Invalid as err:
            raise SettingsError(err.code, f"{scope}/{key} is not plain JSON of a sane size") from err
        if scope == "house" and key == "settings" and not all(isinstance(v, dict) for v in body.values()):
            raise SettingsError("invalid", "house settings are sections of values")


class HkCoreModel(ThinModel):
    """hk_core's settings model, when it exists, behind the same methods (the plug point).

    Expected (as settings_api.py has them today): ``apply_house(options, changes) -> (options,
    errors)`` over the config-entry options (``{"dashboard": {section: {...}}}``) and ``merged(options)``;
    ``apply_board(data, changes)``; ``apply_tablet(data, changes, tablet_id)``. The document here is the
    MERGED house settings, so it is wrapped as options and merged back.
    """
    name = "hk_core"

    def __init__(self, module: Any) -> None:
        self.m = module

    def apply_house(self, doc: Mapping[str, Any], changes: Any) -> tuple[dict, dict[str, str]]:
        changes = self._check_changes(changes)
        bad = {p: "ha_only" for p in changes if p in HA_ONLY_TOP}
        if bad:
            return dict(doc), bad
        options, errors = self.m.apply_house({"dashboard": copy.deepcopy(dict(doc))}, changes)
        if errors:
            return dict(doc), dict(errors)
        return dict(self.m.merged(options)), {}

    def apply_board(self, doc: Mapping[str, Any], changes: Any) -> tuple[dict, dict[str, str]]:
        data, errors = self.m.apply_board(dict(doc), self._check_changes(changes))
        return (dict(doc), dict(errors)) if errors else (dict(data), {})

    def apply_tablet(self, doc: Mapping[str, Any], changes: Any, tablet_id: str) -> tuple[dict, dict[str, str]]:
        data, errors = self.m.apply_tablet(dict(doc), self._check_changes(changes), tablet_id)
        return (dict(doc), dict(errors)) if errors else (dict(data), {})


def load_model() -> ThinModel:
    """hk_core's settings model if it is installed and complete; the thin model otherwise."""
    # hk_core keeps the writes in `changes` and the schema/merge in `model` (hk_core/settings/);
    # imported by name through sys.modules, so a test can stand either in.
    try:
        changes = importlib.import_module("hk_core.settings.changes")
        schema = importlib.import_module("hk_core.settings.model")
    except ImportError:
        return ThinModel()
    m = types.SimpleNamespace(apply_house=getattr(changes, "apply_house", None),
                              apply_board=getattr(changes, "apply_board", None),
                              apply_tablet=getattr(changes, "apply_tablet", None),
                              merged=getattr(schema, "merged", None))
    if all(callable(getattr(m, n, None)) for n in ("apply_house", "apply_board", "apply_tablet", "merged")):
        return HkCoreModel(m)
    log.warning("hk_core.settings exists but lacks apply_house/apply_board/apply_tablet/merged; using the thin model")
    return ThinModel()


# ---------------------------------------------------------------------------------------- hooks
async def _resolve(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def deny_configure(identity: Any, scope: Scope) -> bool:
    return False


@dataclass(frozen=True)
class SettingsHooks:
    """may_configure(identity, Scope) -> bool (may be async): may this subject save this document?
    Exactly ``True`` allows; anything else refuses. Deny by default.
    fetch_ha_settings() -> awaitable HA ``hk_frontend/panel/get`` answer, for the import (default:
    the hub's ReadProxy).
    read_ha({"type": ...}) -> awaitable answer of one of HA's server-only reads, for the feature items
    the import brings over too (default: the hub's ReadProxy.read_server, only when fetch_ha_settings
    is the default too, so both come from the same Home Assistant)."""
    may_configure: Callable[[Any, Scope], bool | Awaitable[bool]] = deny_configure
    fetch_ha_settings: Callable[[], Awaitable[Any]] | None = None
    read_ha: Callable[[dict], Awaitable[Any]] | None = None

    @classmethod
    def coerce(cls, hooks: Any) -> "SettingsHooks":
        if hooks is None:
            return cls()
        if isinstance(hooks, cls):
            return hooks
        if isinstance(hooks, Mapping):
            return cls(**{k: v for k, v in hooks.items() if k in ("may_configure", "fetch_ha_settings", "read_ha")})
        return cls(may_configure=getattr(hooks, "may_configure", deny_configure),
                   fetch_ha_settings=getattr(hooks, "fetch_ha_settings", None),
                   read_ha=getattr(hooks, "read_ha", None))

    def feature_reader(self, proxy: Any) -> Callable[[dict], Awaitable[Any]] | None:
        """What the import reads the feature items with (see read_ha)."""
        if self.read_ha is not None:
            return self.read_ha
        return getattr(proxy, "read_server", None) if self.fetch_ha_settings is None else None


def _sides(identity: Any) -> tuple[str | None, str | None, str | None, str | None, str, float | None]:
    """(user_id, user_role, device_id, device_role, door, fresh_factor_at) from a P3.1 Identity or a dict."""
    if identity is None:
        return None, None, None, None, "lan", None
    if isinstance(identity, Mapping):
        return (identity.get("user_id"), identity.get("role") or identity.get("user_role"), identity.get("device_id"),
                identity.get("device_role"), identity.get("door") or "lan", identity.get("fresh_factor_at"))
    user, device = getattr(identity, "user", None), getattr(identity, "device", None)
    return (getattr(user, "id", None), getattr(user, "role", None), getattr(device, "id", None),
            getattr(device, "role", None), getattr(identity, "door", "lan") or "lan",
            getattr(identity, "fresh_factor_at", None))


def actor_of(identity: Any, label: str | None = None) -> Actor:
    uid, urole, did, _drole, _door, _fresh = _sides(identity)
    return Actor(user_id=uid, role=urole, device_id=did, label=label)


def feature_for(identity: Any, scope: Scope) -> str:
    """RBAC feature of a save: a person's OWN user scope is ``profile``; everything else ``settings``."""
    uid = _sides(identity)[0]
    return "profile" if scope.kind == "user" and uid is not None and scope.key == uid else "settings"


def rbac_may_configure(policy: Any = None, *, rbac_store: Any = None,
                       clock: Callable[[], float] = time.time) -> Callable[[Any, Scope], bool]:
    """The ``may_configure`` hook over P3.2's engine: ``configure`` on feature ``settings`` (house,
    screens, tablets, someone else's user scope) or ``profile`` (your own). With the default roles:
    Owner and Admin may save everything; Adult and Child only their own user scope; Guest, Wall
    Tablet and Service nothing. ``policy`` is a Policy or a callable returning one (default: the
    RbacStore's stored policy, else the default roles)."""
    from . import rbac

    def current_policy() -> Any:
        if callable(policy):
            return policy()
        if policy is not None:
            return policy
        if rbac_store is not None:
            return rbac_store.policy()
        return rbac.Policy.build()

    def may(identity: Any, scope: Scope) -> bool:
        uid, urole, did, drole, door, fresh = _sides(identity)
        if uid is None and urole is None and did is None and drole is None:
            return False
        kw = dict(user_role=urole, user_id=uid, device_role=drole, device_id=did,
                  door=door if door in ("lan", "tunnel") else "tunnel", fresh_factor_at=fresh)
        subject = rbac_store.subject(**kw) if rbac_store is not None else rbac.Subject(**kw)
        decision = current_policy().decide(subject, "configure", None, rbac.Context(now=clock()),
                                           feature=feature_for(identity, scope))
        return decision.allowed is True
    return may


# ----------------------------------------------------------------------------------- the import
IMPORT_READ = "hk_frontend/panel/get"


# HA's panel/get answers each screen and tablet AS READ (hk_core resolved(): All Screens' screensaver, menu,
# rooms and cameras filled in; All Tablets' Idle settings filled in, the own ones beside them), and the import
# copies that answer. Kept that way, a screen that followed All Screens' screensaver held a frozen copy of it
# (and a tablet All Tablets' Idle). As stored, it follows again: what the screen or tablet says itself.
_READ_ONLY_BOARD = ("screensaver_house", "rooms_house", "cameras_house", "menu_house", "tablets", "idle_room")


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
        ("house", "settings", {k: v for k, v in payload["settings"].items() if isinstance(v, dict)}),
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
    for path, board in sorted((payload.get("boards") or {}).items()):
        if isinstance(board, dict) and KEY_RE["board"].match(str(path)):
            out.append(("board", str(path), as_stored("board", board)))
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
        from . import features as F
        try:
            docs.append(("house", F.FEATURES_DOC, await F.import_features(payload, read_features, None, source[:80])))
        except Exception as exc:  # noqa: BLE001 -- the settings still come over; the features can be read again
            features_error = type(exc).__name__
            log.warning("the feature items were not imported (%s); POST /api/features/import reads them again",
                        features_error)
        from . import music as M     # Music's settings (house/music), when HA has Music added
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


# -------------------------------------------------------------------------------------- service
# Every write type the shared frontend has (web/client/hk-client.js WRITES), and what Mantel does
# with it. "settings": saved here. "ha_write": it changes Home Assistant (refused: house commands are
# disabled, and this store never sends anything to HA). "not_yet": HK data Mantel does not hold yet.
SETTINGS_SAVES = frozenset({
    "hk_frontend/settings/set", "hk_frontend/board/set", "hk_frontend/tablet/set", "hk_frontend/setup/done",
    "hk_frontend/calendar/color", "hk_frontend/chip/save", "hk_frontend/chip/remove",
    # accessories, favorites and Hidden Accessories (accessories.py, hidden.py): Mantel's since HK Frontend can go
    "hk_frontend/accessory/into", "hk_frontend/accessory/order", "hk_frontend/accessory/page_order",
    "hk_frontend/accessory/room_scenes", "hk_frontend/accessory/set", "hk_frontend/board/favorite",
    "hk_frontend/hidden/also", "hk_frontend/hidden/set",
    # Wall Tablets' Add and Remove (a tablet is Mantel's document), and a screen's title (Mantel's screens)
    "hk_frontend/tablet/add", "hk_frontend/tablet/remove", "hk_frontend/dashboard/titled",
})
MANTEL_SAVES = frozenset({"mantel/settings/user/set", "mantel/settings/restore"})
HA_WRITES = frozenset({
    "call_service", "calendar/event/create", "calendar/event/delete", "calendar/event/update",
    "config/entity_registry/update", "config_entries/subentries/delete", "frontend/set_user_data", "image/delete",
    "input_select/create", "lovelace/config/save", "lovelace/dashboards/create", "lovelace/dashboards/delete",
    "lovelace/dashboards/update",
    # the page never sends these to HA on Mantel: mantel-client.js answers them with Mantel's own frames
    # (tablet_act, tablets_restart, screen_report) or locally (tablet/seen: Mantel enrols tablets itself)
    "hk_frontend/tablet/act",        # wakes / sleeps / restarts a tablet, fixes its kiosk's screensaver
    "hk_frontend/screensaver/black", "hk_frontend/screensaver/touch",   # a tablet's switches
    "hk_frontend/tablet/seen",       # a tablet reports itself to HA's tablets engine
    "hk_frontend/talk/live",         # doorbell talk-back
    "hk_music/queue_play", "hk_tv/watching", "hk_music/used",
})
# HK Settings -> Features saves Mantel takes (feature_pages.SAVES): checked by the shared checks and stored
# in Mantel's feature settings (house/mantel_features, audited), never sent to HA. Notifications' test is
# here too: Mantel's own delivery to its screens, nothing reaches the house.
FEATURE_SAVES = frozenset({
    "hk_notify/settings/set", "hk_notify/item/save", "hk_notify/item/remove", "hk_notify/test",
    "hk_clean_areas/settings/set", "hk_energy/settings/set", "hk_energy/device/set", "hk_energy/device/section",
    "hk_tv/settings/set",
    # Music's settings (house/music, music.py) and the Alarm PIN's (alarm_pin.py's table): Mantel's own
    "hk_music/settings/set", "hk_music/item/remove", "hk_music/playlist/save", "hk_music/playlists/order",
    "hk_music/preset/save",
    "hk_alarm_pin/settings/set", "hk_alarm_pin/add", "hk_alarm_pin/remove",
})
NOT_YET = frozenset({
    # Mute 1 Hour: the page sends it as Mantel's own notify_mute (mantel-client.js), never as a save
    "hk_notify/mute",
})
SAVE_KINDS: dict[str, str] = {**{t: "settings" for t in SETTINGS_SAVES | MANTEL_SAVES},
                              **{t: "ha_write" for t in HA_WRITES}, **{t: "not_yet" for t in NOT_YET},
                              **{t: "feature" for t in FEATURE_SAVES}}
REFUSALS = {
    "ha_write": "This save changes Home Assistant. Mantel's house commands are disabled, and the settings "
                "store never sends anything to Home Assistant.",
    "not_yet": "Mantel does not hold this part of HK's data yet; it is still saved in Home Assistant.",
}
WRITE_KEYS = {  # what each save may carry besides "type" (and the page's "id"), as HA's schemas say
    "hk_frontend/settings/set": ({"changes"}, set()),
    "hk_frontend/board/set": ({"dashboard", "changes"}, set()),
    "hk_frontend/tablet/set": ({"tablet", "changes"}, set()),
    "hk_frontend/setup/done": ({"done"}, set()),
    "hk_frontend/calendar/color": ({"key"}, {"color"}),
    "hk_frontend/chip/save": ({"name", "card"}, {"key", "after"}),
    "hk_frontend/chip/remove": ({"key"}, set()),
    "mantel/settings/user/set": ({"changes"}, {"user_id"}),
    "mantel/settings/restore": ({"scope", "key", "version"}, set()),
    "hk_frontend/accessory/set": ({"entity_id"}, set(ACC.FIELDS) | {"screen"}),
    "hk_frontend/accessory/order": ({"area_id", "entities"}, set()),
    "hk_frontend/accessory/into": ({"area_id", "into"}, set()),
    "hk_frontend/accessory/page_order": ({"page", "entities"}, set()),
    "hk_frontend/accessory/room_scenes": ({"area_id", "entities"}, set()),
    "hk_frontend/board/favorite": ({"dashboard", "entity_id", "favorite"}, set()),
    "hk_frontend/hidden/set": ({"entity_ids", "everywhere"}, {"places"}),
    "hk_frontend/hidden/also": ({"entity_ids", "kinds"}, set()),
    "hk_frontend/tablet/add": ({"tablet"}, set()),
    "hk_frontend/tablet/remove": ({"tablet"}, set()),
    "hk_frontend/dashboard/titled": ({"dashboard"}, set()),
}
READS = ("hk_frontend/settings/subscribe", "hk_frontend/panel/get", "mantel/settings/get", "mantel/settings/history")


def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", str(text or "").lower().replace("'", "").replace("’", "")).strip("-")
    return s[:40]


class SettingsService:
    """The client API over the store. Every save: shape check, RBAC, model check, store, feed."""

    def __init__(self, store: SettingsStore, hooks: Any = None, model: ThinModel | None = None) -> None:
        self.store = store
        self.hooks = SettingsHooks.coerce(hooks)
        self.model = model or load_model()
        self._feeds: dict[int, tuple[Any, Callable[[dict], None]]] = {}
        self._next = 0
        # the feature host (features.register sets it): the feed's `added` / `energy` per subject
        # (``client_part(identity)``) and panel/get's `features` (``panel_features()``), as HA adds them
        self.features: Any = None
        # Hidden Accessories' house copy (hidden.Hiding, readproxy.register puts it in app["hiding"]): a getter
        self.hiding: Any = None
        # whether Mantel has the house's states yet (register: Home Assistant's first full state): until then
        # Status & Chips' lists are not sent, and the screens find them themselves (hk-chip.js FIND)
        self.house_ready: Callable[[], bool] = lambda: False
        self.kinds_sent: dict[str, list[str]] | None = None      # the lists the screens were last sent

    # -- RBAC -----------------------------------------------------------------------------------
    async def allowed(self, identity: Any, scope: Scope) -> bool:
        try:
            return (await _resolve(self.hooks.may_configure(identity, scope))) is True
        except Exception:  # noqa: BLE001 -- a failing hook refuses
            log.exception("may_configure failed; refusing")
            return False

    async def need(self, identity: Any, scope: Scope) -> None:
        if not await self.allowed(identity, scope):
            log.warning("refused a settings change of %s", scope)
            raise SettingsError("forbidden", f"may not change {scope}")

    # -- payloads -------------------------------------------------------------------------------
    def _items(self, key: str) -> list:
        return list(self.store.body("house", key).get("items") or [])

    def house_settings(self) -> dict:
        return self.store.body("house", "settings")

    def personal(self, identity: Any) -> dict:
        uid = _sides(identity)[0]
        return self.store.body("user", uid) if uid else {}

    def _base_feed(self) -> dict:
        house = self.house_settings()
        sections = {k: dict(v) for k, v in house.items() if isinstance(v, dict) and k != "counts"}
        # Browse Music's Discover rows go out as the queries themselves (HA's as_client: discover_rows), not
        # the stored keys: a screen runs each as music_assistant.get_library and keeps no copy of SHELVES.
        # (Sent as keys, every shelf asked for nothing and drew empty: the house, 2026-10-18.)
        disc = (sections.get("browse") or {}).get("discover")
        if isinstance(disc, list) and all(isinstance(k, str) for k in disc):
            sections["browse"]["discover"] = SM.discover_rows(disc)
        # the screens and tablets AS READ (stored_of), as HA's feed sends them: a screen following All Screens'
        # menu, tab bar, screensaver, rooms or cameras gets All Screens'; a tablet following All Tablets' Idle
        # gets it (sent raw, every screen kept the defaults, and no tablet returned Home when idle)
        stored = stored_of(self.store)
        tablets = SM.tablets(stored)
        acc = self.store.body("house", "accessories") or {"entities": {}, "rooms": {}, "into": {}, "pages": {}}
        return {
            "configured": not self.store.empty(),
            **sections,
            "boards": SM.boards(stored),
            "tablet_items": {tid: {
                "name": t["name"], "screen": t["screen"], "room": t["room"], "user": t["user"],
                "app": t["app"], "idle_return": t["idle_return"], "idle_time": t["idle_time"],
                "black_screen": t["black_screen"],
                # a tablet's own HA switches: HA run-time entities, not settings (linked mode, later)
                "screensaver_switch": None, "black_switch": None,
            } for tid, t in tablets.items()},
            "accessories": acc,
            "extras": {},
            "popups": self._items("popups"),
            "custom_pages": self._items("custom_pages"),
            "custom_chips": self._items("custom_chips"),
            "kinds": {},
            "added": [],
        }

    @staticmethod
    def _personalise(base: dict, personal: Mapping[str, Any]) -> dict:
        out = dict(base)
        for section, values in personal.items():
            if section in USER_SECTIONS and isinstance(values, dict):
                out[section] = {**(out.get(section) or {}), **values}
        out["personal"] = copy.deepcopy(dict(personal))
        return out

    def feed_payload(self, identity: Any) -> dict:
        """What ``hk_frontend/settings/subscribe`` sends this subject: the same shape HA's feed sends
        (settings.as_client), with the person's own values over the house's (``personal`` says which)."""
        found = self.kind_lists()
        self.kinds_sent = found
        return self._with_kinds(self._with_features(self._personalise(self._base_feed(), self.personal(identity)),
                                                    identity), identity, found)

    # -- Status & Chips: what each kind counts (HA: kinds.Tracker, settings.as_client's `kinds`) ----------
    def kind_lists(self) -> dict[str, list[str]] | None:
        """What each kind counts now (hidden.resolve over Mantel's copy of the house), or None before Mantel
        has the house's states (the screens then find them themselves, as from a server without them)."""
        hiding = self.hiding() if callable(self.hiding) else None
        if hiding is None or not hiding.ready or not self.house_ready():
            return None
        try:
            return hiding.found(self._hide_settings())
        except Exception:  # noqa: BLE001 -- the feed still goes out; the screens find the kinds themselves
            log.exception("Status & Chips' kinds failed")
            return None

    def _visible(self, identity: Any, ids: Iterable[str]) -> set[str] | None:
        """The ids this subject may view, asked synchronously (the feed is built in a callback); None when
        that cannot be asked (fail closed: no lists at all)."""
        host = self.features
        check = getattr(getattr(host, "hooks", None), "may_read", None)
        if check is None or identity is None:
            return None
        try:
            got = check(identity, "view", sorted(set(ids)))
        except Exception:  # noqa: BLE001 -- a failing hook refuses
            log.exception("Status & Chips' kinds: the read hook failed")
            return None
        if inspect.isawaitable(got):
            if hasattr(got, "close"):
                got.close()
            return None
        return set(got or ())

    def _with_kinds(self, payload: dict, identity: Any, found: Mapping[str, list[str]] | None) -> dict:
        """HA's as_client: ``kinds`` (each kind's entities) and the older lists that are a kind's
        (kinds.LEGACY: security's locks, doors, windows and garage; features' thermostats) set to it. Each list
        holds only what this subject may view, so a chip counts what its screen can show."""
        if not found:
            return payload
        ok = self._visible(identity, (e for v in found.values() for e in v))
        if ok is None:
            return payload
        from hk_core.settings.kinds import LEGACY
        kinds = {k: [e for e in v if e in ok] for k, v in found.items()}
        payload["kinds"] = kinds
        for kind, (section, key) in LEGACY.items():
            if isinstance(payload.get(section), dict) and kind in kinds:
                payload[section] = {**payload[section], key: list(kinds[kind])}
        return payload

    def _with_features(self, payload: dict, identity: Any) -> dict:
        """HA's feed adds which features are added (`added`) and the Energy page's plan (`energy`); so
        does Mantel's, from its feature host (``house/mantel_features``), once there is one."""
        if self.features is None:
            return payload
        try:
            payload.update(self.features.client_part(identity))
        except Exception:  # noqa: BLE001 -- the rest of the feed still goes out (as HA's does)
            log.exception("the features' part of the settings feed failed")
        return payload

    @staticmethod
    def screen_title(path: str, board: Mapping[str, Any]) -> str:
        """A screen's name: the board's own ``title`` if it has one, else its address made readable
        (``dashboard-kitchen`` -> ``Kitchen``). The import keeps no dashboard titles (HA's are Lovelace's)."""
        t = board.get("title") if isinstance(board, Mapping) else None
        if isinstance(t, str) and t.strip():
            return t.strip()
        words = re.sub(r"^(dashboard|hk)-", "", path).replace("-", " ").replace("_", " ").strip()
        return words.title() if words else path

    def dashboards(self, boards: Mapping[str, Mapping[str, Any]]) -> list[dict]:
        """``dashboards`` of panel/get (panel.py ``_dashboards``' shape) from Mantel's boards: each board is
        a screen HK draws itself (so ``generated``), kept here rather than in Lovelace (``mode`` is
        ``mantel``: not renamable or deletable the way a stored HA dashboard is), and has its settings
        (``item`` is the board's key)."""
        out = [{"path": path, "title": self.screen_title(path, b), "mode": "mantel", "id": None,
                "generated": True, "require_admin": False, "item": path, "icon": (b or {}).get("icon")}
               for path, b in boards.items()]
        return sorted(out, key=lambda d: d["title"].lower())

    def panel_payload(self) -> dict:
        """What ``hk_frontend/panel/get`` answers (panel.py ws_panel_get's shape). The parts HA works out
        at run time (its dashboards, entities per tablet, third-party status, HA's users) are empty here;
        Hidden Accessories and Status & Chips' ``counts`` and ``kinds`` are added by register's panel_get,
        from Mantel's copy of the house, for what the person may view."""
        stored = stored_of(self.store)
        boards = SM.boards(stored)                     # as read, as HA's panel/get (S.boards)
        pages = [{**p, "used_on": [path for path, b in boards.items()
                                   if p.get("path") in (b.get("custom_pages") or [])]}
                 for p in self._items("custom_pages")]
        catalog = self.store.body("house", "catalog")
        features: dict = {}
        if self.features is not None:
            try:
                features = self.features.panel_features()
            except Exception:  # noqa: BLE001 -- HK Settings still opens
                log.exception("panel/get's features failed")
        # the kiosk apps' devices in HA (a tablet's Setup -> Device), as HK Frontend lists them; it was always
        # empty here, so no tablet could be given its device in Mantel (the house, 2026-10-20)
        kiosk_devices: list = []
        house = getattr(self.features, "house", None)
        if house is not None:
            try:
                from hk_core.tablets import kiosk as KT
                kiosk_devices = KT.devices(house)
            except Exception:  # noqa: BLE001 -- HK Settings still opens
                log.exception("panel/get's kiosk devices failed")
        return {
            "entry_id": "mantel", "source": "mantel",
            "settings": self.house_settings(),
            "boards": boards,
            "screensavers": {},
            "tablets": {k: {**t, "parts": {}} for k, t in SM.tablets(stored).items()},   # with idle_*_own
            "kiosk_devices": kiosk_devices, "tablet_suggest": [], "dashboards": self.dashboards(boards),
            "popups": self._items("popups"),
            "custom_pages": pages,
            "custom_chips": self._items("custom_chips"),
            "accessories": self.store.body("house", "accessories") or {"entities": {}},
            "kinds": {}, "hidden": {},
            "presets": catalog.get("presets", []), "chip_kinds": catalog.get("chip_kinds", list(CHIP_KINDS)),
            "page_kinds": catalog.get("page_kinds", []), "scene_pages": catalog.get("scene_pages", []),
            "shelves": catalog.get("shelves", {}),
            "setup_done": bool(self.store.body("house", "setup").get("setup_done")),
            "suggest": {}, "counts": {}, "users": [], "integration": {}, "thirdparty": {}, "features": features,
            "choices": catalog.get("choices", {}),
            "versions": {f"{s}/{k}": d.version for s in SCOPES if s != "user"
                         for k, d in self.store.docs(s).items()},
        }

    # -- the feed -------------------------------------------------------------------------------
    def subscribe_feed(self, identity: Any, on_event: Callable[[dict], None]) -> Callable[[], None]:
        self._next += 1
        sid = self._next
        self._feeds[sid] = (identity, on_event)
        on_event(self.feed_payload(identity))                 # now, as HA's feed does
        return lambda: self._feeds.pop(sid, None) and None

    def publish(self, user_only: str | None = None) -> int:
        """Send the feed again to every subscriber (or only to one person's, after a personal save)."""
        base = None
        found: Any = ()
        sent = 0
        for identity, cb in list(self._feeds.values()):
            uid = _sides(identity)[0]
            if user_only is not None and uid != user_only:
                continue
            base = base if base is not None else self._base_feed()
            if found == ():
                found = self.kind_lists()            # once per publish, not per screen
                self.kinds_sent = found
            try:
                cb(self._with_kinds(self._with_features(self._personalise(base, self.personal(identity)), identity),
                                    identity, found))
                sent += 1
            except Exception:  # noqa: BLE001 -- one bad listener never stops the others
                log.exception("settings feed listener failed")
        return sent

    # -- reads ----------------------------------------------------------------------------------
    @staticmethod
    def _only(msg: dict, required: set[str], optional: set[str] = frozenset()) -> None:
        extra = set(msg) - {"type", "id"} - required - set(optional)
        missing = required - set(msg)
        if extra or missing:
            raise SettingsError("invalid_format", fields={**{k: "unexpected" for k in sorted(extra)},
                                                          **{k: "required" for k in sorted(missing)}})

    def _scope(self, kind: Any, key: Any) -> Scope:
        if kind not in SCOPES or not isinstance(key, str):
            raise SettingsError("invalid_format", fields={"scope": "choice"})
        if kind == "house" and key not in HOUSE_DOCS:
            raise SettingsError("invalid_format", fields={"key": "choice"})
        if kind != "house" and not KEY_RE[kind].match(key):
            raise SettingsError("invalid_format", fields={"key": "invalid"})
        return Scope(kind, key)

    async def panel_get(self, identity: Any, msg: dict) -> dict:
        self._only(msg, set())
        if not await self.allowed(identity, Scope("house", "settings")):
            raise Forbidden("HK Settings needs configure on settings")
        return self.panel_payload()

    async def get(self, identity: Any, msg: dict) -> dict:
        self._only(msg, {"scope", "key"})
        scope = self._scope(msg["scope"], msg["key"])
        if not await self.allowed(identity, scope):
            raise Forbidden(f"may not read {scope}")
        d = self.store.get(scope.kind, scope.key)
        return {"scope": scope.kind, "key": scope.key, "version": d.version if d else 0, "body": d.body if d else {}}

    async def history(self, identity: Any, msg: dict) -> dict:
        self._only(msg, {"scope", "key"}, {"limit", "bodies"})
        scope = self._scope(msg["scope"], msg["key"])
        if not await self.allowed(identity, scope):
            raise Forbidden(f"may not read the history of {scope}")
        limit = msg.get("limit", 50)
        if not isinstance(limit, int) or isinstance(limit, bool):
            raise SettingsError("invalid_format", fields={"limit": "number"})
        d = self.store.get(scope.kind, scope.key)
        return {"scope": scope.kind, "key": scope.key, "version": d.version if d else 0,
                "history": self.store.history(scope.kind, scope.key, limit, bool(msg.get("bodies")))}

    # -- saves ----------------------------------------------------------------------------------
    async def save(self, identity: Any, msg: Any) -> Any:
        """One save, as the page sends it to HA (same type, same keys). Raises SettingsError."""
        if not isinstance(msg, dict) or not isinstance(msg.get("type"), str):
            raise SettingsError("invalid_format", fields={"type": "required"})
        t = msg["type"]
        kind = SAVE_KINDS.get(t)
        if kind is None:
            raise SettingsError("unknown_type", f"{t!r} is not a settings save")
        if kind == "feature":
            return await self._feature_save(identity, msg)
        if kind != "settings":
            raise SettingsError(kind, REFUSALS[kind])
        required, optional = WRITE_KEYS[t]
        self._only(msg, required, optional)
        actor = actor_of(identity)
        handler = getattr(self, "_" + t.split("/", 1)[1].replace("/", "_"))
        return await handler(identity, actor, msg)

    async def _feature_save(self, identity: Any, msg: dict) -> Any:
        """A feature page's save (HK Settings -> Features): Mantel's feature host checks it with the shared
        checks and stores it in ``house/mantel_features`` (feature_pages.py). Without a feature host: not yet."""
        pages = getattr(self.features, "pages", None)
        if pages is None:
            raise SettingsError("not_yet", REFUSALS["not_yet"])
        from .feature_pages import PageError
        try:
            return await pages.save(identity, msg)
        except PageError as exc:
            if exc.code == "forbidden":
                log.warning("refused a feature settings change: %s", msg.get("type"))
            raise SettingsError(exc.code, str(exc), exc.fields or None) from None

    def _store(self, changes: list[tuple[str, str, dict]], actor: Actor, msg: dict, user_only: str | None = None,
               **kw) -> list[Doc]:
        got = self.store.write(changes, actor=actor, message=msg["type"], **kw)
        if got:
            self.publish(user_only=user_only)
        return got

    async def _settings_set(self, identity, actor, msg):
        await self.need(identity, Scope("house", "settings"))
        new, errors = self.model.apply_house(self.house_settings(), msg["changes"])
        if errors:
            raise SettingsError("invalid_format", fields=errors)
        self._store([("house", "settings", new)], actor, msg)
        return {"settings": self.house_settings()}

    async def _calendar_color(self, identity, actor, msg):
        key, color = msg["key"], msg.get("color")
        if not isinstance(key, str) or not 5 <= len(key) <= 240:
            raise SettingsError("invalid_format", fields={"key": "invalid"})
        if color is not None and color not in PILL_COLORS:
            raise SettingsError("invalid_format", fields={"color": "choice"})
        await self.need(identity, Scope("house", "settings"))
        house = self.house_settings()
        cur = dict((house.get("calendar") or {}).get("event_colors") or {})
        if color:
            cur[key] = color
        else:
            cur.pop(key, None)
        new, errors = self.model.apply_house(house, {"calendar.event_colors": cur})
        if errors:
            raise SettingsError("invalid_format", fields=errors)
        self._store([("house", "settings", new)], actor, msg)
        return {"event_colors": cur}

    async def _board_set(self, identity, actor, msg):
        dash = msg["dashboard"]
        if not isinstance(dash, str) or not KEY_RE["board"].match(dash):
            raise SettingsError("invalid_format", fields={"dashboard": "invalid"})
        await self.need(identity, Scope("board", dash))
        cur = self.store.get("board", dash)
        if cur is None:
            raise SettingsError("no_item", "This dashboard has no item yet")
        new, errors = self.model.apply_board(cur.body, msg["changes"])
        if errors:
            raise SettingsError("invalid_format", fields=errors)
        self._store([("board", dash, new)], actor, msg, expect={("board", dash): cur.version})
        return {"board": self.store.body("board", dash)}

    async def _tablet_set(self, identity, actor, msg):
        tid = msg["tablet"]
        if not isinstance(tid, str) or not KEY_RE["tablet"].match(tid):
            raise SettingsError("no_tablet", "There is no such tablet")
        await self.need(identity, Scope("tablet", tid))
        cur = self.store.get("tablet", tid)
        if cur is None:
            raise SettingsError("no_tablet", "There is no such tablet")
        new, errors = self.model.apply_tablet(cur.body, msg["changes"], tid)
        if errors:
            raise SettingsError("invalid_format", fields=errors)
        self._store([("tablet", tid, new)], actor, msg, expect={("tablet", tid): cur.version})
        return {"tablet": self.store.body("tablet", tid)}

    async def _setup_done(self, identity, actor, msg):
        if not isinstance(msg["done"], bool):
            raise SettingsError("invalid_format", fields={"done": "bool"})
        await self.need(identity, Scope("house", "setup"))
        self._store([("house", "setup", {**self.store.body("house", "setup"), "setup_done": msg["done"]})], actor, msg)
        return {"setup_done": msg["done"]}

    async def _chip_save(self, identity, actor, msg):
        await self.need(identity, Scope("house", "custom_chips"))
        chips = self._items("custom_chips")
        data, errors = self.model.chip(msg["name"], msg.get("after"), msg["card"])
        key = msg.get("key")
        if key and not any(c.get("key") == key for c in chips):
            errors["key"] = "chip_gone"
        if errors:
            raise SettingsError("invalid_format", fields=errors)
        if not key:
            taken = {c.get("key") for c in chips} | {p.get("path") for p in self._items("custom_pages")}
            base = (_slug(data["name"]) or "chip")[:36]
            key, n = base, 2
            while key in taken:
                key, n = f"{base}-{n}", n + 1
            chips.append({"key": key, **data})
        else:
            chips = [{"key": key, **data} if c.get("key") == key else c for c in chips]
        chips.sort(key=lambda c: str(c.get("name", "")).lower())
        self._store([("house", "custom_chips", {"items": chips})], actor, msg)
        return {"key": key, "custom_chips": chips}

    async def _chip_remove(self, identity, actor, msg):
        key = msg["key"]
        await self.need(identity, Scope("house", "custom_chips"))
        chips = self._items("custom_chips")
        if not isinstance(key, str) or not any(c.get("key") == key for c in chips):
            raise SettingsError("invalid_format", fields={"key": "chip_gone"})
        changes: list[tuple[str, str, dict]] = [
            ("house", "custom_chips", {"items": [c for c in chips if c.get("key") != key]})]
        token = CHIP_TOKEN + key
        for path, d in self.store.docs("board").items():      # and from every screen that listed it
            mine, order = list(d.body.get("chips_custom") or []), list(d.body.get("chips") or [])
            if key in mine or token in order:
                if not await self.allowed(identity, Scope("board", path)):
                    raise SettingsError("forbidden", f"may not change board/{path}")
                changes.append(("board", path, {**d.body, "chips_custom": [k for k in mine if k != key],
                                                "chips": [k for k in order if k != token]}))
        self._store(changes, actor, msg)                       # one transaction, all or nothing
        return {"custom_chips": self._items("custom_chips")}

    async def _settings_user_set(self, identity, actor, msg):
        uid = msg.get("user_id") or _sides(identity)[0]
        if not isinstance(uid, str) or not KEY_RE["user"].match(uid):
            raise SettingsError("invalid_format", fields={"user_id": "required"})
        await self.need(identity, Scope("user", uid))
        if not self.store.user_exists(uid):
            raise SettingsError("no_user", "There is no such user")
        new, errors = self.model.apply_user(self.store.body("user", uid), msg["changes"], self.house_settings())
        if errors:
            raise SettingsError("invalid_format", fields=errors)
        self._store([("user", uid, new)], actor, msg, user_only=uid)
        return {"user_id": uid, "settings": self.store.body("user", uid)}

    async def _settings_restore(self, identity, actor, msg):
        scope = self._scope(msg["scope"], msg["key"])
        version = msg["version"]
        if not isinstance(version, int) or isinstance(version, bool) or version < 1:
            raise SettingsError("invalid_format", fields={"version": "number"})
        if scope == Scope("house", "catalog"):
            raise SettingsError("forbidden", "the catalog is not edited")
        await self.need(identity, scope)
        body = self.store.version_body(scope.kind, scope.key, version)
        if body is None:
            raise SettingsError("no_version", f"{scope} has no version {version}")
        self.model.check_document(scope.kind, scope.key, body)
        got = self.store.restore(scope.kind, scope.key, version, actor=actor, message=msg["type"])
        if got:
            self.publish(user_only=scope.key if scope.kind == "user" else None)
        d = self.store.get(scope.kind, scope.key)
        return {"scope": scope.kind, "key": scope.key, "version": d.version if d else 0, "restored_from": version,
                "changed": got is not None}


    # -- Wall Tablets' Add and Remove, a screen's title (HK Frontend's panel.py, now Mantel's) ------------------
    async def _tablet_add(self, identity, actor, msg):
        """A new tablet (Add Tablet): its settings checked as any change, its id from its name."""
        given = msg["tablet"]
        if not isinstance(given, dict):
            raise SettingsError("invalid_format", fields={"tablet": "object"})
        tid = SM.tablet_id(str(given.get("name") or ""), set(self.store.docs("tablet")))
        if not KEY_RE["tablet"].match(tid):
            raise SettingsError("invalid_format", fields={"name": "name_needed"})
        await self.need(identity, Scope("tablet", tid))
        return self.add_tablet(given, actor, msg["type"], tid=tid)

    def add_tablet(self, given: dict, actor: Actor, message: str, *, tid: str | None = None) -> dict:
        """Write a new HK tablet (its settings checked by the model) and publish it. The caller has decided who may:
        the socket's Add Tablet through RBAC (``_tablet_add``), enrolment as an Owner or Admin (devices.enroll)."""
        tid = tid or SM.tablet_id(str(given.get("name") or ""), set(self.store.docs("tablet")))
        if not KEY_RE["tablet"].match(tid):
            raise SettingsError("invalid_format", fields={"name": "name_needed"})
        new, errors = self.model.apply_tablet({}, {"name": "", **given}, tid)
        if errors:
            raise SettingsError("invalid_format", fields=errors)
        new["uid"] = f"tablet_{tid}"
        self._store([("tablet", tid, new)], actor, {"type": message})
        return {"id": tid, "tablet": self.store.body("tablet", tid)}

    async def _tablet_remove(self, identity, actor, msg):
        """A tablet gone: its document (its history stays); its screen and its kiosk app stay."""
        tid = msg["tablet"]
        if not isinstance(tid, str) or not KEY_RE["tablet"].match(tid) or self.store.get("tablet", tid) is None:
            raise SettingsError("no_tablet", "There is no such tablet")
        await self.need(identity, Scope("tablet", tid))
        self.store.remove("tablet", tid, actor=actor, message=msg["type"])
        self.publish()
        return {"removed": tid}

    async def _dashboard_titled(self, identity, actor, msg):
        """HK Settings asks this after renaming a screen: on Mantel a screen's title is its board's own, so this
        only answers it (HK Frontend followed an HA dashboard's title here)."""
        path = msg["dashboard"]
        if not isinstance(path, str) or not KEY_RE["board"].match(path) or self.store.get("board", path) is None:
            raise SettingsError("no_dashboard", "There's no dashboard at that address")
        await self.need(identity, Scope("board", path))
        return {"title": self.screen_title(path, self.store.body("board", path))}

    # -- accessories, favorites, Hidden Accessories (HK Frontend's accessories.py and hiding.py, now Mantel's) ---
    def _accessories(self) -> dict:
        return ACC.clean(self.store.body("house", "accessories"))

    async def _acc_change(self, identity, actor, msg, work):
        await self.need(identity, Scope("house", "accessories"))
        try:
            doc, answer = work(self._accessories())
        except ACC.Refused as exc:
            raise SettingsError("invalid_format", fields=exc.fields) from None
        self._store([("house", "accessories", doc)], actor, msg)
        return answer

    async def _accessory_set(self, identity, actor, msg):
        changes = {k: msg[k] for k in ACC.FIELDS if k in msg}
        return await self._acc_change(identity, actor, msg,
                                      lambda d: ACC.set_one(d, msg["entity_id"], changes, msg.get("screen")))

    async def _accessory_order(self, identity, actor, msg):
        return await self._acc_change(identity, actor, msg, lambda d: ACC.order(d, msg["area_id"], msg["entities"]))

    async def _accessory_into(self, identity, actor, msg):
        return await self._acc_change(identity, actor, msg, lambda d: ACC.into(d, msg["area_id"], msg["into"]))

    async def _accessory_page_order(self, identity, actor, msg):
        return await self._acc_change(identity, actor, msg, lambda d: ACC.page_order(d, msg["page"], msg["entities"]))

    async def _accessory_room_scenes(self, identity, actor, msg):
        def work(d):
            doc, scenes = ACC.room_scenes(d, msg["area_id"], msg["entities"])
            return doc, {"scenes": scenes}
        return await self._acc_change(identity, actor, msg, work)

    async def _board_favorite(self, identity, actor, msg):
        """An accessory added to (or taken off) one screen's Favorites, at the end (HK's board/favorite)."""
        dash, eid, on = msg["dashboard"], msg["entity_id"], msg["favorite"]
        if not isinstance(dash, str) or not KEY_RE["board"].match(dash):
            raise SettingsError("invalid_format", fields={"dashboard": "invalid"})
        if not isinstance(eid, str) or not ACC.ENTITY.match(eid):
            raise SettingsError("invalid_format", fields={"entity_id": "invalid"})
        if not isinstance(on, bool):
            raise SettingsError("invalid_format", fields={"favorite": "bool"})
        await self.need(identity, Scope("board", dash))
        cur = self.store.get("board", dash)
        if cur is None:
            raise SettingsError("no_item", "This dashboard has no item yet")
        favs = [f for f in (cur.body.get("favorites") or []) if f != eid]
        if on:
            favs.append(eid)
        self._store([("board", dash, {**cur.body, "favorites": favs})], actor, msg, expect={("board", dash): cur.version})
        return {"favorites": favs}

    def _hiding(self):
        hiding = self.hiding() if callable(self.hiding) else None
        if hiding is None or not hiding.ready:
            raise SettingsError("unavailable", "Mantel has no copy of the house to work Hidden Accessories out from")
        return hiding

    def _hide_settings(self) -> dict:
        return {**self.house_settings(), "accessories": self._accessories()}

    @staticmethod
    def _hide_ids(msg) -> list[str]:
        ids = msg["entity_ids"]
        if not isinstance(ids, list) or not 1 <= len(ids) <= ACC.IDS_MAX or \
                not all(isinstance(i, str) and ACC.ENTITY.match(i) for i in ids):
            raise SettingsError("invalid_format", fields={"entity_ids": "invalid"})
        return list(dict.fromkeys(ids))

    async def _hide_write(self, identity, actor, msg, changes: dict, acc_changes: dict) -> None:
        writes: list[tuple[str, str, dict]] = []
        if changes:
            await self.need(identity, Scope("house", "settings"))
            new, errors = self.model.apply_house(self.house_settings(), changes)
            if errors:
                raise SettingsError("invalid_format", fields=errors)
            writes.append(("house", "settings", new))
        if acc_changes:
            await self.need(identity, Scope("house", "accessories"))
            writes.append(("house", "accessories", ACC.set_many(self._accessories(), acc_changes)))
        if writes:
            self._store(writes, actor, msg)                     # one transaction, as HA's one save

    async def _hidden_set(self, identity, actor, msg):
        """Hide these accessories everywhere, or from exactly the places given (HK's hidden/set)."""
        from .hidden import ORDER
        await self.need(identity, Scope("house", "settings"))
        ids, places = self._hide_ids(msg), msg.get("places", {})
        if not isinstance(msg["everywhere"], bool):
            raise SettingsError("invalid_format", fields={"everywhere": "bool"})
        if not isinstance(places, dict) or not all(k in ORDER and isinstance(v, bool) for k, v in places.items()):
            raise SettingsError("invalid_format", fields={"places": "invalid"})
        hiding = self._hiding()
        changes, acc_changes = hiding.plan(self._hide_settings(), ids, msg["everywhere"], places)
        await self._hide_write(identity, actor, msg, changes, acc_changes)
        return hiding.snapshot(self._hide_settings(), ids)

    async def _hidden_also(self, identity, actor, msg):
        """Also count these accessories in (or no longer in) the kinds given (HK's hidden/also)."""
        from hk_core.settings.kinds import KINDS
        await self.need(identity, Scope("house", "settings"))
        ids, kinds = self._hide_ids(msg), msg["kinds"]
        if not isinstance(kinds, dict) or not all(k in KINDS and isinstance(v, bool) for k, v in kinds.items()):
            raise SettingsError("invalid_format", fields={"kinds": "invalid"})
        hiding = self._hiding()
        changes = hiding.also_plan(self._hide_settings(), ids, kinds)
        await self._hide_write(identity, actor, msg, changes, {})
        return hiding.snapshot(self._hide_settings(), ids)


# ------------------------------------------------------------------------------------- register
def _error(exc: BaseException) -> dict:
    if isinstance(exc, SettingsError):
        return {"code": exc.code, "message": str(exc)}
    if isinstance(exc, Forbidden):
        return {"code": "forbidden", "message": str(exc)}
    return {"code": "failed", "message": "the settings store failed"}


def register(app: web.Application, hub: Any, hooks: Any = None, *, store: SettingsStore | None = None,
             conn: sqlite3.Connection | None = None, model: ThinModel | None = None) -> SettingsService:
    """Offer HK's settings from Mantel's store.

    * ``app["read_routes"]``: ``hk_frontend/settings/subscribe`` (subscription), ``hk_frontend/panel/get``,
      ``mantel/settings/get``, ``mantel/settings/history`` — the page's ``read`` / ``read_subscribe``
      frames reach these (readproxy.register looks here first), never Home Assistant.
    * ``app["ws_handlers"]["settings_write"]``: ``{type: "settings_write", id, msg: <the save, exactly as
      the page sends it to HA>}`` -> ``{type: "settings_result", id, result}`` or ``{..., error: {code,
      message}}``. Not a command type: server.classify lets it through while commands are disabled,
      on purpose (HK's own data; nothing reaches HA or a device).
    * REST ``GET /api/settings/import`` (the import's record; Owner/Admin) and ``POST
      /api/settings/import`` (run it; Owner only).
    """
    if store is None:
        if conn is None:
            st = app.get("store") if hasattr(app, "get") else None
            conn = getattr(st, "db", None)
        if conn is None:
            raise ValueError("settings_store.register needs a store, a connection, or app['store']")
        store = SettingsStore(conn, app.get("clock", time.time) if hasattr(app, "get") else time.time)
    service = SettingsService(store, hooks, model)
    service.hiding = lambda: app.get("hiding") if hasattr(app, "get") else None
    app["settings"] = service

    async def feed(ctx: Ctx, msg: dict, on_event: Callable[[dict], None]):
        SettingsService._only(msg, set())
        end = service.subscribe_feed(ctx.identity, on_event)

        async def unsubscribe() -> None:
            end()
        return unsubscribe

    async def panel_get(ctx: Ctx, msg: dict):
        payload = await service.panel_get(ctx.identity, msg)
        # a paired tablet's Reload and Clear Cache (tablet_links.panel_parts): HK Settings' Wall Tablets buttons,
        # pressed through Mantel's host and the command gateway (HA works these out from the tablet's entities)
        from . import tablet_links
        parts = tablet_links.panel_parts(app)
        if parts:
            payload = {**payload, "tablets": {k: {**t, "parts": {**(t.get("parts") or {}), **parts.get(k, {})}}
                                              for k, t in (payload.get("tablets") or {}).items()}}
        # Hidden Accessories (HA: hiding.snapshot in panel.py), worked out from Mantel's own states and
        # registries (hidden.py, installed by readproxy.register) and cut down to what the person may view
        hiding, reads = app.get("hiding"), app.get("filtered_reads")
        if hiding is not None and hiding.ready and reads is not None:
            from .connectors import allowed_ids
            settings = {**service.house_settings(),
                        "accessories": service.store.body("house", "accessories") or {"entities": {}}}
            snap = hiding.snapshot(settings)
            visible = await allowed_ids(reads.hooks, ctx.identity, "view", sorted(hiding.entity_ids_in(snap)))
            payload = {**payload, "hidden": hiding.only_visible(snap, set(visible), None)}
            # Status & Chips kind by kind (HA: panel._counts) and how many each counts (HA's `kinds`): what a
            # chip's What It Counts and Accessories' types show, cut down to what the person may view
            if service.house_ready():
                counts = hiding.counts(settings)
                ids = {e for c in counts.values() for k in ("auto", "found", "exclude", "include") for e in c[k]}
                ok = set(await allowed_ids(reads.hooks, ctx.identity, "view", sorted(ids)))
                counts = {k: {**c, **{f: [e for e in c[f] if e in ok] for f in ("auto", "found", "exclude", "include")}}
                          for k, c in counts.items()}
                payload = {**payload, "counts": counts, "kinds": {k: len(c["found"]) for k, c in counts.items()}}
        return payload

    async def setup_check(ctx: Ctx, msg: dict):
        # HK Settings' Setup Check: Mantel's own needs (setup_check.py), never HA's check
        SettingsService._only(msg, set())
        if not await service.allowed(ctx.identity, Scope("house", "settings")):
            raise Forbidden("HK Settings needs configure on settings")
        from . import setup_check as checks
        from . import tablet_links
        lines = checks.lines(app, len(service.store.docs("board")))
        return {"lines": lines + await tablet_links.setup_lines(app)}

    async def get(ctx: Ctx, msg: dict):
        return await service.get(ctx.identity, msg)

    async def history(ctx: Ctx, msg: dict):
        return await service.history(ctx.identity, msg)

    read_routes(app).update({
        "hk_frontend/settings/subscribe": Route(subscribe=feed),
        "hk_frontend/panel/get": Route(request=panel_get),
        "hk_frontend/setup/check": Route(request=setup_check),
        "mantel/settings/get": Route(request=get),
        "mantel/settings/history": Route(request=history),
    })

    async def on_write(ctx: Ctx, msg: dict) -> None:
        rid = msg.get("id")
        try:
            if set(msg) - {"type", "id", "msg"}:
                raise SettingsError("invalid_format", fields={k: "unexpected" for k in sorted(set(msg) - {"type", "id", "msg"})})
            result = await service.save(ctx.identity, msg.get("msg"))
        except Exception as exc:  # noqa: BLE001 -- a refused save is the page's error, never the socket's
            if not isinstance(exc, (SettingsError, Forbidden)):
                log.exception("settings save failed")
            await ctx.send({"type": "settings_result", "id": rid, "error": _error(exc)})
            return
        await ctx.send({"type": "settings_result", "id": rid, "result": result})

    ws_handlers(app)["settings_write"] = on_write


    async def fetch_from_hub() -> Any:
        proxy = getattr(hub, "readproxy", None)
        if proxy is None or not hasattr(proxy, "read_hk_settings"):
            raise SettingsError("unavailable", "no connection to Home Assistant to import from")
        try:
            return await proxy.read_hk_settings()
        except RuntimeError as exc:
            if str(exc) == "unknown_command":       # HA answered: it doesn't know hk_frontend/panel/get
                raise SettingsError("no_hk_frontend", NO_HK_FRONTEND) from None
            raise

    def who(request: web.Request) -> Any:
        from .sessions import identity
        return identity(request)

    async def import_status(request: web.Request) -> web.Response:
        ident = who(request)
        if _sides(ident)[1] not in ("owner", "admin"):
            return web.json_response({"error": "forbidden"}, status=403)
        return web.json_response({"import": store.import_record(), "empty": store.empty()})

    async def run_import(request: web.Request) -> web.Response:
        ident = who(request)
        uid, role = _sides(ident)[:2]
        if uid is None:
            return web.json_response({"error": "unauthenticated"}, status=401)
        if role != "owner":
            return web.json_response({"error": "owner_only"}, status=403)
        try:
            got = await import_settings(store, service.hooks.fetch_ha_settings or fetch_from_hub,
                                        actor=actor_of(ident), model=service.model,
                                        read_features=service.hooks.feature_reader(getattr(hub, "readproxy", None)))
        except SettingsError as exc:
            status = {"unavailable": 503, "no_hk_frontend": 409}.get(exc.code, 400)
            return web.json_response({"error": exc.code, "message": str(exc)}, status=status)
        except Exception as exc:  # noqa: BLE001 -- HA unreachable or refused
            log.warning("settings import failed: %s", exc)
            return web.json_response({"error": "import_failed", "message": str(exc)}, status=502)
        if got.get("imported"):
            service.publish()
        return web.json_response(got)

    app.router.add_get("/api/settings/import", import_status)
    app.router.add_post("/api/settings/import", run_import)
    _watch_kinds(service, hub)
    return service


# ------------------------------------------------------------------------------------- Status & Chips, kept current
KINDS_COOLDOWN_S = 1.0


def _watch_kinds(service: SettingsService, hub: Any) -> None:
    """HA's kinds.Tracker: the screens are sent the feed again (at most once a second) when what a kind counts
    changed -- an entity appeared or went, its device class or group members changed, a thermostat gained or
    lost a reading, a registry changed -- and only when a list really changed. Chained after HaClient's own
    callbacks, as features.py's are."""
    ha = getattr(hub, "ha", None)
    if ha is None:
        return
    service.house_ready = lambda: ha.ready.is_set() and getattr(hub, "registry", None) is not None
    from hk_core.settings.kinds import KINDS
    wanted = {d for k in KINDS.values() for d in k.domains + k.also}
    seen: dict[str, tuple] = {}
    timer: list[asyncio.TimerHandle | None] = [None]

    def check() -> None:
        timer[0] = None
        if service.kind_lists() != service.kinds_sent:
            service.publish()

    def poke() -> None:
        if timer[0] is not None:
            return
        try:
            timer[0] = asyncio.get_running_loop().call_later(KINDS_COOLDOWN_S, check)
        except RuntimeError:                     # no loop (a test without one): nothing to keep current
            pass

    def what(eid: str) -> tuple | None:
        st = hub.store.states.get(eid)
        if st is None:
            return None
        a = st.get("a") or {}
        live = st.get("s") not in ("unavailable", "unknown")
        return (a.get("device_class"), isinstance(a.get("entity_id"), list), isinstance(a.get("group_entities"), list),
                live and "current_temperature" in a, live and "current_humidity" in a)

    first_change, first_registry = ha.on_change, ha.on_registry

    def on_change(changed: set[str]) -> None:
        first_change(changed)
        try:
            moved = False
            for eid in changed:
                if eid.split(".", 1)[0] not in wanted:
                    continue
                now = what(eid)
                if seen.get(eid, ()) != now:
                    seen[eid] = now
                    moved = True
            if moved:
                poke()
        except Exception:  # noqa: BLE001 -- never break the hub's own callback
            log.exception("Status & Chips' kinds: a state change failed")

    def on_registry() -> None:
        if first_registry is not None:
            first_registry()
        poke()
    ha.on_change, ha.on_registry = on_change, on_registry


# ------------------------------------------------------------------------------------------ CLI
async def import_cli(data_dir, ha_url: str, token: str, out=print, ws_url: str | None = None) -> int:
    """``mantel-server import-settings``: read HK's settings from HA once (the read path only) and
    write them as version 1. Exit 0 when imported or already imported."""
    from pathlib import Path

    from .readproxy import ReadProxy
    from .store import Store
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
