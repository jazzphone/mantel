"""HK FRONTEND IS NOW MANTEL: the final release's repair (docs/phase9/MANTEL-LINK.md, HK Frontend's retirement).

HK Frontend is replaced by Mantel (the server: the Home Assistant App, or Docker) and Mantel Link (Home Assistant's
side of it, from HACS). Its final release raises one repair in Home Assistant, "HK Frontend is now Mantel", with the
move guide. Everything else works as before until the house has moved; security fixes only after that.

RETIRED is False in every release but the final one: the final build sets it (tools/publish/publish.py --final).
"""
from __future__ import annotations

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir

from .const import DOMAIN

RETIRED = False
ISSUE = "now_mantel"
MOVE_GUIDE = "https://github.com/jazzphone/mantel-link/blob/main/docs/Moving-from-HK-Frontend.md"


@callback
def async_raise(hass: HomeAssistant) -> bool:
    """The repair, in the final release only. True when raised."""
    if not RETIRED:
        return False
    ir.async_create_issue(hass, DOMAIN, ISSUE, is_fixable=False, is_persistent=False,
                          severity=ir.IssueSeverity.WARNING, translation_key=ISSUE,
                          learn_more_url=MOVE_GUIDE, translation_placeholders={"guide": MOVE_GUIDE})
    return True
