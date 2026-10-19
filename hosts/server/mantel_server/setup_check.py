"""HK Settings' Setup Check on Mantel: ``hk_frontend/setup/check`` answered by Mantel itself.

In Home Assistant the check (hosts/ha/.../setup_check.py) reports what HK needs from that HA: its version, the
kiosk theme, Lovelace resources, ffmpeg, Adaptive Lighting, ... Those are HA's own matters and say nothing about
Mantel, so Mantel answers with what *its* screens need, in the same shape the page draws
(``{"lines": [{"ok": True | False | None, "title", "detail"}]}``; None is "worth a look", False "needs doing"):

* Home Assistant: connected, and its version (the house's states and registries come from it).
* Music Assistant: connected (optional: the Music page's own engine, Browse's library).
* SF Pro and the SF Symbols glyphs: uploaded in Mantel settings -> Your files (Apple's, never shipped).
* House commands: on or off (the App's `commands_enabled`; off means read-only).
* Screens: how many Mantel has (imported from HK in HA, or made here).

Owner/Admin, like HK Settings' other reads (``configure`` on settings). Read only; nothing reaches HA.
"""
from __future__ import annotations

from typing import Any

from . import connections


def _line(ok: bool | None, title: str, detail: str) -> dict[str, Any]:
    return {"ok": ok, "title": title, "detail": detail}


def lines(app: Any, boards: int) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        ha = connections.status(app, "ha")
    except Exception:  # noqa: BLE001 -- a check that can't read its own status still answers
        ha = None
    live = (ha or {}).get("live") or {}
    if live.get("connected"):
        out.append(_line(True, f"Home Assistant {live.get('version') or ''}".strip(), "Connected."))
    else:
        out.append(_line(False, "Home Assistant", "Not connected. Mantel settings → Connections."))
    try:
        ma = connections.status(app, "ma")
    except Exception:  # noqa: BLE001
        ma = None
    mlive = (ma or {}).get("live") or {}
    if mlive.get("connected"):
        out.append(_line(True, f"Music Assistant {mlive.get('version') or ''}".strip(), "Connected."))
    elif (ma or {}).get("state") == "set":
        out.append(_line(False, "Music Assistant", "Set up but not connected. Mantel settings → Connections."))
    else:
        out.append(_line(None, "Music Assistant", "Not set up. Optional, for whole-home music and Browse: "
                                                    "Mantel settings → Connections."))
    files = app.get("user_files") if hasattr(app, "get") else None
    status = {}
    if files is not None:
        try:
            status = files.listing().get("status") or {}
        except Exception:  # noqa: BLE001
            status = {}
    if status.get("font") and status.get("glyphs"):
        out.append(_line(True, "SF Pro & the SF Symbols Glyphs", "Uploaded."))
    else:
        missing = [n for n, k in (("SF-Pro.woff2", "font"), ("hk-glyphs.js", "glyphs")) if not status.get(k)]
        out.append(_line(None, "Apple’s Font & Glyphs", "Not uploaded: " + ", ".join(missing) +
                         ". Fallback font and icons stand in. Mantel settings → Your files."))
    cfg = app.get("cfg") if hasattr(app, "get") else None
    if getattr(cfg, "commands_enabled", False):
        out.append(_line(True, "House Commands", "On: people may control the house within their roles; every "
                                                  "command is audited."))
    else:
        out.append(_line(None, "House Commands", "Off: Mantel is read-only. The App's Configuration turns them on."))
    out.append(_line(True if boards else False, "Screens",
                     f"{boards} in Mantel." if boards else "None yet: import HK's settings from Home Assistant."))
    return out
