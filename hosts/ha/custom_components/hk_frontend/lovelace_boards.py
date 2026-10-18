"""Home Assistant's dashboards, by the address HK Frontend knows them by.

Lovelace keeps its dashboards in one dict keyed by url path -- except the
built-in OVERVIEW, the default dashboard, which is keyed None: it has no url
path of its own and lives at /lovelace/<view>. Everything in HK Frontend keys a
dashboard by the first segment of its address (a screen's item, its settings,
the frontend's `boards[seg]`), so the Overview is "lovelace" here, and this is
the one place that turns that back into Lovelace's None. (No other dashboard
can be "lovelace": Home Assistant requires a hyphen in every url path it
creates.)

Before this the Overview was skipped wherever the dict was read (`if not
path`), so it could not be added under Existing Dashboards: no HK settings, no
notifications, no menu on the dashboard many homes use most (2026-10-12).
"""
from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant

OVERVIEW = "lovelace"          # the Overview's address: /lovelace/<view>
OVERVIEW_TITLE = "Overview"    # its name in the sidebar until it is given one


def _raw(hass: HomeAssistant) -> dict[Any, Any]:
    from homeassistant.components.lovelace.const import LOVELACE_DATA
    return hass.data[LOVELACE_DATA].dashboards


def all_boards(hass: HomeAssistant) -> dict[str, Any]:
    """Every dashboard by its address, the Overview as "lovelace". Raises what
    reading Lovelace's data raises (ImportError, KeyError, AttributeError) when
    it has not started, as the callers already expect."""
    out: dict[str, Any] = {}
    for key, board in _raw(hass).items():
        out[str(key) if key else OVERVIEW] = board
    return out


def get(hass: HomeAssistant, path: str | None) -> Any:
    """One dashboard by its address, or None."""
    try:
        boards = _raw(hass)
    except (ImportError, KeyError, AttributeError):
        return None
    return boards.get(None if path in (None, "", OVERVIEW) else path)


def config(board: Any) -> dict[str, Any]:
    """A dashboard's entry in the dashboards collection (title, mode, id...):
    empty for the Overview, which has none."""
    return getattr(board, "config", None) or {}


def title(hass: HomeAssistant, path: str) -> str:
    """Its name as the sidebar shows it: its title, "Overview" for the
    Overview, else its address."""
    t = config(get(hass, path)).get("title")
    if t:
        return str(t)
    return OVERVIEW_TITLE if path == OVERVIEW else path


def mode(board: Any) -> str:
    """storage or yaml (the Overview says so on the object itself)."""
    return str(config(board).get("mode") or getattr(board, "mode", None) or "storage")
