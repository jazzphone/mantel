"""The shapes the settings store is made of: scopes, documents, who acted, the errors a save is refused with, and the diff helpers."""
from __future__ import annotations

import json
import re
from typing import Any, Mapping
from dataclasses import dataclass

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
                  "now_playing", "browse", "side_pane")
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
    via: str | None = None              # an assistant acting for the person (``mcp:<client name>``)

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


class _Invalid(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code
