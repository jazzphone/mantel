"""HK Settings' Setup Check on Mantel: ``hk_frontend/setup/check`` answered by Mantel itself.

In Home Assistant the check (hosts/ha/.../setup_check.py) reports what HK needs from that HA: its version, the
kiosk theme, Lovelace resources, ffmpeg, Adaptive Lighting, ... Those are HA's own matters and say nothing about
Mantel, so Mantel answers with what *its* screens need, in the same shape the page draws
(``{"lines": [{"ok": True | False | None, "title", "detail"}]}``; None is "worth a look", False "needs doing"):

* Home Assistant: connected, and its version (the house's states and registries come from it).
* Music Assistant: connected (optional: the Music page's own engine, Browse's library).
* SF Pro and the SF Symbols glyphs: uploaded in Mantel settings -> Your files (Apple's, never shipped).
* House commands: on or off (Mantel Settings → General, Allow Control of the House; off means read-only).
* Photos: only when Mantel Photos has photos and faces can't be found on this platform (faces.py); and Time Behind,
  when the cut-out model can't run (cutout.py: not installed, not the expected file, or no ONNX Runtime).
* Screens: how many Mantel has (imported from HK in HA, or made here).
* Wall Tablets: every tablet with a Direct Connection reached now, at once (tablet_links.setup_lines: Kiosk
  Satellite's ``/api/health``, Fully's ``deviceInfo``; reads only). No line when none has one.

Owner/Admin, like HK Settings' other reads (``configure`` on settings). Read only; nothing reaches HA.
"""
from __future__ import annotations

from typing import Any

from . import connections, setup_guide


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
        how = setup_guide.READ_ONLY_HOW if getattr(cfg, "read_only", False) else setup_guide.COMMANDS_HOW
        out.append(_line(None, "House Commands", "Off: Mantel is read-only. " + how[setup_guide.install(cfg)]))
    photos = app.get("photos") if hasattr(app, "get") else None
    try:
        has_photos = photos is not None and photos.count() > 0
    except Exception:  # noqa: BLE001
        has_photos = False
    if has_photos:
        from . import imaging
        if not imaging.faces_available():
            out.append(_line(None, "Photos", "Faces aren’t found on this platform; the screens’ own focus is used."))
        if not imaging.cutouts_available():
            from . import cutout
            why = cutout.why_not() or "the cut-out model can’t run here"
            out.append(_line(None, "Time Behind", why[:1].upper() + why[1:] + ", so photos show the time in front."))
    out.append(_line(True if boards else False, "Screens",
                     f"{boards} in Mantel." if boards else
                     "None yet. Once Home Assistant is connected Mantel builds a Home screen from your rooms; "
                     "with HK Frontend in Home Assistant, import its screens on Connections instead."))
    return out
