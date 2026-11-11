"""model.py's what is stored (moved here by tools/split_py.py from hk_core/settings/model.py:
tools/split_py_manifests/model.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from .schema import CONF_DASHBOARD
from .pages_screen_rules import merged
from .dashboard_rules import board
from .tablet_rules import tablet


# ------------------------------------------------------------ what is stored
# ONLY WHAT WAS SET (2026-10-14, the user's choice): a setting is stored when
# it differs from its default, and every read fills the rest in (merged(),
# board(), tablet()). Saving one setting used to store its whole section --
# every default with it, frozen at that day's value -- so a default changed
# in a later version never reached a screen that had ever been saved. Now it
# does, for anything left at its default. Entry 1.15 (settings_trimmed)
# tidies what was stored before.
def only_set(values: Mapping[str, Any], defaults: Mapping[str, Any],
             keep: tuple[str, ...] = ()) -> dict[str, Any]:
    """`values` less those equal to their default (`keep`: always stored)."""
    return {k: v for k, v in values.items() if k in keep or k not in defaults or v != defaults[k]}


def house_stored(section: str, values: Mapping[str, Any]) -> dict[str, Any]:
    """A house section as stored: what differs from its default. The Wallpaper and its colour go together: they are
    read as a pair (wallpaper_choice), where nothing stored means Ribbons in Rose -- so either differing keeps both."""
    out = only_set(values, merged(None).get(section) or {})
    if section == "sky" and ("wallpaper" in out or "wallpaper_color" in out):
        out.update({k: values[k] for k in ("wallpaper", "wallpaper_color") if k in values})
    return out


def board_stored(data: Mapping[str, Any] | None) -> dict[str, Any]:
    """A screen's item as stored: its settings, checked, less the defaults."""
    return only_set(board(data), board(None))


# a tablet's name and id are its identity (its item's title, its entities'
# ids): stored even when they read as the defaults would
TABLET_KEEP = ("name", "uid")


def tablet_stored(data: Mapping[str, Any] | None, tid: str = "") -> dict[str, Any]:
    """A tablet's item as stored: its settings, checked, less the defaults."""
    return only_set(tablet(data, tid), tablet(None, tid), TABLET_KEEP)


def settings_trimmed(options: Mapping[str, Any] | None, boards_: Mapping[str, Mapping[str, Any]],
                     tablets_: Mapping[str, Mapping[str, Any]]
                     ) -> tuple[dict[str, Any] | None, dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """Entry 1.15: everything stored before 1.15, less what equals today's
    defaults. -> (options or None when unchanged, boards, tablets) -- each
    item as it should be stored now."""
    stored = dict((options or {}).get(CONF_DASHBOARD) or {})
    now = merged(options)
    dash = {}
    for section, values in stored.items():
        if isinstance(values, Mapping) and section in now:
            # (a key the settings no longer have goes too, as on every save)
            dash[section] = house_stored(section, {k: now[section][k] for k in values if k in now[section]})
        else:
            dash[section] = values
    opts = None if dash == stored else {**dict(options or {}), CONF_DASHBOARD: dash}
    return (opts, {p: board_stored(d) for p, d in boards_.items()},
            {t: tablet_stored(d, t) for t, d in tablets_.items()})
