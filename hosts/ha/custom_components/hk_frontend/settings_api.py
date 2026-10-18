"""THE SETTINGS PAGE'S WRITES: one change, checked, saved.

The checks are shared (hk_core/settings/changes.py: apply_house, apply_board,
apply_tablet and every field's check, refused with the field's name rather
than quietly turned into a default; nothing is made unless every change in
the call is good). They are re-exported here under their names; what is Home
Assistant's stays: the integration's own option that makes HK its own sidebar
panel (`hk_panel`, hk_panel.py), and the saving -- the websocket commands
(panel.py, hiding.py) write the entry's options and its items, so the page and
the flows can be used side by side.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .hk_core.settings import changes as C
from .hk_core.settings.changes import *  # noqa: F401,F403 -- shared
from .hk_core.settings.changes import Invalid


def _hk_panel(v: Any) -> dict[str, Any] | None:
    """HK as its own panel (hk_panel.py): None/False (off), or {screen, admin?, sidebar?}."""
    from . import hk_panel
    try:
        return hk_panel.check(v)
    except ValueError as err:
        raise Invalid("hk_panel") from err


# Options of the integration itself, beside `dashboard`: the shared ones and Home Assistant's.
TOP = {**C.TOP, "hk_panel": _hk_panel}


def apply_house(options: Mapping[str, Any], changes: Mapping[str, Any]
                ) -> tuple[dict[str, Any], dict[str, str]]:
    """The entry's options with `changes` made, and any refusals (path ->
    code). Nothing is made when anything is refused."""
    return C.apply_house(options, changes, TOP)
