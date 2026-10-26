"""The checks a write passes before it is stored: ``ThinModel``, and ``HkCoreModel`` when hk_core's model is present."""
from __future__ import annotations

import logging
import copy
import importlib
import re
import types
from typing import Any, Iterable, Mapping

from .docs import CHIP_CARD_MAX, CHIP_KINDS, ENTITY, FLAT_KEY, HA_ONLY_TOP, HOUSE_PATH, HOUSE_SECTIONS, MAX_CHANGES, MAX_DOC, SettingsError, USER_SECTIONS, _Invalid, _plain

log = logging.getLogger("mantel.settings")

# ---------------------------------------------------------------------------------------- model
# settings_api.py's patch paths and the reset: they need the real model's merge rules
NEEDS_MODEL = re.compile(r"^sky\.reset$|^sky\.(flat_image_look|image_look)\.patch$|^sky\.flat_page_image_looks\.|"
                         r"^look\.flat_colors\.|^look\.flat_page_colors\.")
NEEDS_MODEL_BOARD = re.compile(r"\.")
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

    def apply_user(self, doc: Mapping[str, Any], changes: Any, house: Mapping[str, Any]) -> tuple[dict, dict[str, str]]:
        """The thin checks, then each value as the house model checks it: a person may not keep what the house
        would be refused (``look.glass: "bogus"``; their copy is laid over the feed as it is)."""
        out, errors = super().apply_user(doc, changes, house)
        if errors:
            return out, errors
        values = {p: v for p, v in self._check_changes(changes).items() if v is not None}
        if values:
            _, bad = self.m.apply_house({"dashboard": copy.deepcopy(dict(house))}, values)
            if bad:
                return dict(doc), dict(bad)
        return out, {}

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
