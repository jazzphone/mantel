"""Resources (read-only context a client can attach) and prompts (one-click starting points).

Resources answer through the same tools (and so the same RBAC): ``mantel://house``, ``mantel://screens``,
``mantel://screens/{key}``, ``mantel://settings/schema/{scope}``, ``mantel://grid/cards``, and the user guide as
Mantel's /docs serves it (``mantel://guide/{page}``: its Markdown, the same for everyone).
"""
from __future__ import annotations

import json
import re
from typing import Any

from .dispatch import ToolError

PAGE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,80}\Z")
STATIC = [
    ("mantel://house", "House summary", "Floors, rooms, screens, tablets, Mantel's version: house_summary."),
    ("mantel://screens", "Screens", "Every screen and the tablets on it: screens_list."),
    ("mantel://grid/cards", "Home Grid catalogue", "Cards, sizes and options: grid_cards."),
    ("mantel://settings/schema/house", "House settings schema", "Every house key settings_change takes."),
    ("mantel://settings/schema/board", "Screen settings schema", "Every screen key settings_change takes."),
    ("mantel://settings/schema/tablet", "Wall tablet settings schema", "Every tablet key settings_change takes."),
]
TEMPLATES = [
    {"uriTemplate": "mantel://screens/{key}", "name": "screen", "title": "A screen",
     "description": "One screen's settings and Home Grid (screen_get)", "mimeType": "application/json"},
    {"uriTemplate": "mantel://guide/{page}", "name": "guide", "title": "User guide page",
     "description": "A page of Mantel's user guide, in Markdown (mantel://guide lists them)", "mimeType": "text/markdown"},
]


def _docs(app):
    from ..docs_pages import Docs
    cfg = app["cfg"]
    return Docs(cfg.docs_hk, cfg.docs_mantel)


def guide_pages(app) -> list[str]:
    d = _docs(app)
    names = sorted(p.stem for p in d.hk_dir.glob("*.md") if not p.stem.startswith("_")) if d.hk_dir.is_dir() else []
    return (["Mantel"] if d.mantel_file.is_file() else []) + names


def listing(caller) -> list[dict]:
    out = [{"uri": u, "name": u.split("://", 1)[1], "title": t, "description": d, "mimeType": "application/json"}
           for u, t, d in STATIC]
    out.append({"uri": "mantel://guide", "name": "guide", "title": "User guide",
                "description": "The user guide's pages", "mimeType": "application/json"})
    return out


async def read_resource(caller, uri: str) -> dict:
    from .tools import house, screens, settings
    if uri == "mantel://house":
        body: Any = await house.house_summary(caller, {})
    elif uri == "mantel://screens":
        body = await screens.screens_list(caller, {})
    elif uri.startswith("mantel://screens/"):
        body = await screens.screen_get(caller, {"screen": uri[len("mantel://screens/"):]})
    elif uri == "mantel://grid/cards":
        body = await screens.grid_cards(caller, {})
    elif uri.startswith("mantel://settings/schema/") and uri.rsplit("/", 1)[1] in ("house", "board", "tablet"):
        body = await settings.settings_schema(caller, {"scope": uri.rsplit("/", 1)[1]})
    elif uri == "mantel://guide":
        body = {"pages": [f"mantel://guide/{p}" for p in guide_pages(caller.app)]}
    elif uri.startswith("mantel://guide/"):
        name = uri[len("mantel://guide/"):]
        src = _docs(caller.app).source(name) if PAGE.match(name) else None
        if src is None:
            raise ToolError("not_found", f"no guide page {name!r}")
        return {"uri": uri, "mimeType": "text/markdown", "text": src.read_text(encoding="utf-8")[:200_000]}
    else:
        raise ToolError("not_found", f"no resource {uri!r}")
    return {"uri": uri, "mimeType": "application/json", "text": json.dumps(body, indent=1, default=str)}


# -- prompts ---------------------------------------------------------------------------------------------------------
PROMPTS = {
    "set_up_wall_tablet": {
        "title": "Set up a wall tablet",
        "description": "A wall tablet with its own screen and Home Grid, its room first.",
        "arguments": [{"name": "tablet", "description": "the wall tablet's id or name", "required": True},
                      {"name": "room", "description": "the room it hangs in", "required": False}],
        "text": "Set up the wall tablet {tablet}{room_part}. Read the house first (house_summary, rooms_list). Make it "
                "its own screen: copy the closest existing screen (screen_create with copy_from) or start from a "
                "template (screen_templates, screen_from_template), lay out a Home Grid with its room first "
                "(grid_cards, grid_starter, grid_set), then point the tablet at the screen (tablet_setup). Plan every "
                "change (dry_run) and show me the plan before applying it. Finish with the link I open on the tablet "
                "to enrol it, and a preview (screen_preview) if you can open it."},
    "build_home_grid": {
        "title": "Build a Home Grid for a room",
        "description": "A Home Grid layout for one room's screen.",
        "arguments": [{"name": "room", "description": "the room", "required": True},
                      {"name": "screen", "description": "the screen (its address), if it exists", "required": False}],
        "text": "Build a Home Grid for {room}{screen_part}. Look at the room's accessories (rooms_list, house_find) "
                "and the catalogue (grid_cards). Propose a layout (what goes where and why), plan it with grid_set "
                "(dry_run), fix anything the checks refuse, and apply it only when I say so."},
    "copy_screen": {
        "title": "Copy a screen to another room",
        "description": "A new screen made from an existing one, its entities moved to another room's.",
        "arguments": [{"name": "screen", "description": "the screen to copy", "required": True},
                      {"name": "room", "description": "the room the copy is for", "required": True}],
        "text": "Copy the screen {screen} for {room}: export it (screen_export), map its entities to {room}'s own "
                "(house_find), and import it as a new screen (screen_import with a mapping). Plan it, show me what "
                "matched and what didn't, then apply it when I say so."},
    "fix_music": {
        "title": "Fix Music after a library change",
        "description": "Playlist pills whose links went stale, matched again.",
        "arguments": [],
        "text": "Music Assistant's library changed. Check the Music settings (music_settings) for pills whose links "
                "are gone, plan music_relink, show me every fix and every link with no match, and apply it when I "
                "say so. For links with no match, suggest playlists from music_library."},
    "what_changed": {
        "title": "What changed recently?",
        "description": "The audit log and settings history, summarised.",
        "arguments": [{"name": "days", "description": "how many days back (default 7)", "required": False}],
        "text": "What changed in Mantel over the last {days} days? Read the audit log (audit_recent with since) and, "
                "for the settings that changed most, their history (settings_history). Summarise who changed what, "
                "and which changes an assistant made (via)."},
}


def prompt_list() -> list[dict]:
    return [{"name": k, "title": v["title"], "description": v["description"], "arguments": v["arguments"]}
            for k, v in PROMPTS.items()]


def prompt_get(name: str, arguments: Any) -> dict:
    p = PROMPTS.get(name)
    if p is None:
        raise KeyError(name)
    a = {k: str(v)[:200] for k, v in (arguments or {}).items() if isinstance(k, str)} if isinstance(arguments, dict) else {}
    for arg in p["arguments"]:
        if arg["required"] and not a.get(arg["name"]):
            raise ValueError(f"argument {arg['name']!r} is required")
    fill = {"tablet": a.get("tablet", ""), "room": a.get("room", ""), "screen": a.get("screen", ""),
            "days": a.get("days") or "7",
            "room_part": f" in {a['room']}" if a.get("room") else "",
            "screen_part": f" (screen {a['screen']})" if a.get("screen") else ""}
    return {"description": p["description"],
            "messages": [{"role": "user", "content": {"type": "text", "text": p["text"].format(**fill)}}]}
