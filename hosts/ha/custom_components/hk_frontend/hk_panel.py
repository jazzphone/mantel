"""HK AS ITS OWN PANEL (Phase 2 P2.6, opt-in): a screen drawn by HK's own view host
inside Home Assistant, with no Lovelace -- no hui-root, no Lovelace restyling, no
Lovelace-wide state.

OFF UNLESS SWITCHED ON. Nothing is registered, and nothing a screen is sent changes,
until the entry's options carry `hk_panel` (written by hk_frontend/settings/set, an admin
command, like the HK Settings page's own `sidebar` switch):

    hk_panel: {screen: "dashboard-kitchen", admin: false, sidebar: true}

  screen   the HK dashboard whose settings and strategy options the panel draws with
           (its item's settings, and its own `strategy:` options from its YAML). Empty:
           HK's defaults, as a new screen with no item has.
  admin    for admins only (default: everyone, like a dashboard)
  sidebar  in the sidebar (default: yes); the address works either way

The Lovelace dashboards stay exactly as they are: the panel is one more page, at
/hk-panel/<view>, until the owner switches it on.

THE PANEL is frontend/modules/hk-ha-panel.js (hosts/ha/frontend/ in Mantel), registered
as panel_custom does it (a "custom" panel naming the element and its module), directly,
as panel.py does for HK Settings, so it can be kept out of the sidebar.

THE SCREEN'S ADDRESS. HK's frontend knows a screen by its address's first segment
(`boards[seg]`, in the strategy, the menu, the sky, the kiosk...). The panel's segment is
URL_PATH, so the settings feed hands the chosen screen's settings to it under that name as
well (mirror, below) -- only while the panel is on.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant, callback

URL_PATH = "hk-panel"            # not "hk": /hk/ is the file view (__init__.py)
ELEMENT = "hk-ha-panel"
TITLE = "HK"
ICON = "mdi:home-variant-outline"
OPTION = "hk_panel"
MODULE = Path(__file__).parent / "frontend" / "modules" / "hk-ha-panel.js"
_SCREEN = re.compile(r"^[a-z0-9_-]{0,80}$")


def settings(options: Any) -> dict[str, Any] | None:
    """The panel's settings from the entry's options, or None while it is off (the
    default). Anything not shaped like a setting is off."""
    raw = (options or {}).get(OPTION)
    if not isinstance(raw, dict):
        return None
    screen = raw.get("screen") or ""
    if not isinstance(screen, str) or not _SCREEN.match(screen):
        return None
    return {"screen": screen, "admin": raw.get("admin") is True, "sidebar": raw.get("sidebar") is not False}


def check(value: Any) -> dict[str, Any] | None:
    """hk_frontend/settings/set's check for `hk_panel`: None or False (off), or
    {screen, admin?, sidebar?}. Raises ValueError("hk_panel") for anything else."""
    if value is None or value is False:
        return None
    if not isinstance(value, dict) or set(value) - {"screen", "admin", "sidebar"}:
        raise ValueError("hk_panel")
    screen = value.get("screen", "")
    if screen is None:
        screen = ""
    if not isinstance(screen, str) or not _SCREEN.match(screen):
        raise ValueError("hk_panel")
    for k in ("admin", "sidebar"):
        if k in value and not isinstance(value[k], bool):
            raise ValueError("hk_panel")
    out: dict[str, Any] = {"screen": screen}
    if value.get("admin") is True:
        out["admin"] = True
    if value.get("sidebar") is False:
        out["sidebar"] = False
    return out


async def async_register(hass: HomeAssistant, conf: dict[str, Any]) -> None:
    """The panel, as `conf` (settings()) says. Called again on a change: `update`
    replaces it in place. The module URL carries the file's time, so an edit reaches
    the next load without a restart's cache."""
    from homeassistant.components import frontend
    from . import resources
    try:
        stamp = await hass.async_add_executor_job(lambda: int(MODULE.stat().st_mtime))
    except OSError:
        stamp = 0
    # HK's own card files and stylesheets (resources.py), which the panel loads beside the
    # Lovelace resources: a house whose resources are written by hand still gets them
    try:
        cards = [list(r) for r in await hass.async_add_executor_job(resources.wanted)]
    except OSError:
        cards = []
    frontend.async_register_built_in_panel(
        hass, component_name="custom", sidebar_title=TITLE, sidebar_icon=ICON,
        frontend_url_path=URL_PATH, require_admin=conf["admin"], show_in_sidebar=conf["sidebar"],
        update=True,
        config={"_panel_custom": {"name": ELEMENT, "embed_iframe": False, "trust_external": False,
                                  "handle_safe_area": False,
                                  "module_url": f"/hk/modules/hk-ha-panel.js?v={stamp}"},
                # what the element draws: the screen whose settings and options it uses
                "screen": conf["screen"], "resources": cards})


@callback
def async_unregister(hass: HomeAssistant) -> None:
    from homeassistant.components import frontend
    frontend.async_remove_panel(hass, URL_PATH, warn_if_unknown=False)


async def async_follow(hass: HomeAssistant, options: Any, was: dict[str, Any] | None) -> dict[str, Any] | None:
    """Register, update or remove the panel when its settings changed from `was`.
    Returns the settings now. Off and still off does nothing at all."""
    now = settings(options)
    if now == was:
        return now
    if now is None:
        async_unregister(hass)
    else:
        await async_register(hass, now)
    return now


def mirror(payload: dict[str, Any], options: Any) -> dict[str, Any]:
    """The settings feed, with the panel's screen's settings also under the panel's
    own address (see THE SCREEN'S ADDRESS). Untouched while the panel is off."""
    conf = settings(options)
    boards = payload.get("boards")
    if conf is None or not isinstance(boards, dict):
        return payload
    if conf["screen"] and isinstance(boards.get(conf["screen"]), dict):
        payload["boards"] = {**boards, URL_PATH: boards[conf["screen"]]}
    return payload
