"""Music: the Music page's settings and saves (house/music, music.py, through settings_write's feature saves), the
library's playlists, and ``music_relink``: pills whose ``library://`` links are gone from Music Assistant's library,
matched again by name (the 2026-10-31 move of Music Assistant, as one reviewed change)."""
from __future__ import annotations

import re
import unicodedata
from typing import Any

from ..dispatch import ToolError, change, read, save
from . import Tool

LIBRARY_PLAYLIST = "library://playlist/"


async def _page(caller) -> dict:
    got = await read(caller, {"type": "hk_music/settings/get"})
    if not isinstance(got, dict) or not got.get("configured"):
        raise ToolError("not_set_up", "Music is not set up on this Mantel (Mantel Settings → Music)")
    return got


async def _library(caller) -> list[dict]:
    got = await read(caller, {"type": "hk_music/settings/library"})
    return [i for i in (got or {}).get("items") or [] if isinstance(i, dict) and isinstance(i.get("uri"), str)]


async def music_settings(caller, args: dict) -> dict:
    page = await _page(caller)
    names: dict[str, str] = {}
    ready = bool(page.get("library_ready"))
    if ready:
        try:
            names = {i["uri"]: i.get("name") or i["uri"] for i in await _library(caller)}
        except ToolError:
            ready = False
    for pl in page.get("playlists") or []:
        pl["links"] = [{"uri": u, "name": names.get(u),
                        "gone": bool(ready and u.startswith(LIBRARY_PLAYLIST) and u not in names)}
                       for u in pl.get("items") or []]
    page["library_checked"] = ready
    return page


async def music_library(caller, args: dict) -> dict:
    kind = args.get("kind", "playlists")
    if kind == "playlists":
        items = await _library(caller)
    else:
        query = {"type": "music_assistant/get_library", "media_type": kind[:-1], "limit": args.get("limit", 200)}
        if args.get("query"):
            query["search"] = args["query"]
        got = await read(caller, query)
        items = (got or {}).get("items") or []
    q = (args.get("query") or "").casefold()
    if q:
        items = [i for i in items if q in str(i.get("name") or "").casefold()]
    return {"kind": kind, "count": len(items), "items": items[: args.get("limit", 200)]}


def _music_save(caller, t: str, body: dict):
    return lambda: save(caller, {"type": t, **body})


async def music_playlist_save(caller, args: dict) -> dict:
    body = {k: args[k] for k in ("name", "items", "item", "icon", "chooser", "order") if k in args}
    return await change(caller, "music_playlist_save", args, _music_save(caller, "hk_music/playlist/save", body))


async def music_preset_save(caller, args: dict) -> dict:
    body = {k: args[k] for k in ("name", "members", "item") if k in args}
    return await change(caller, "music_preset_save", args, _music_save(caller, "hk_music/preset/save", body))


async def music_item_remove(caller, args: dict) -> dict:
    return await change(caller, "music_item_remove", args,
                        _music_save(caller, "hk_music/item/remove", {"item": args["item"]}))


async def music_pills_order(caller, args: dict) -> dict:
    return await change(caller, "music_pills_order", args,
                        _music_save(caller, "hk_music/playlists/order", {"ids": args["ids"]}))


async def music_settings_set(caller, args: dict) -> dict:
    return await change(caller, "music_settings_set", args,
                        _music_save(caller, "hk_music/settings/set", {"changes": args["changes"]}))


def _norm(s: Any) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().casefold()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def relink_plan(playlists: list[dict], library: list[dict], mapping: dict[str, str]) -> tuple[list[dict], list[dict]]:
    """(the pills to save again with their new links, the dead links with no match). A dead link is mapped by
    ``mapping`` first, else to the library playlist of the pill's own name (or its chooser's), when exactly one
    library playlist has that name and the pill has only that one dead link."""
    have = {i["uri"] for i in library}
    by_name: dict[str, list[str]] = {}
    for i in library:
        by_name.setdefault(_norm(i.get("name")), []).append(i["uri"])
    fixes, stuck = [], []
    for pl in playlists:
        items = list(pl.get("items") or [])
        dead = [u for u in items if u.startswith(LIBRARY_PLAYLIST) and u not in have]
        if not dead:
            continue
        new, why = list(items), []
        for u in dead:
            target = mapping.get(u)
            if target is None and len(dead) == 1:
                for n in (pl.get("name"), pl.get("chooser")):
                    hits = by_name.get(_norm(n), [])
                    if len(hits) == 1:
                        target = hits[0]
                        why.append(f"named {n!r}")
                        break
            if target is None or target not in have:
                stuck.append({"pill": pl.get("id"), "name": pl.get("name"), "link": u,
                              "why": "no library playlist of this pill's name" if target is None
                              else f"{target} is not in the library either"})
                continue
            new[new.index(u)] = target
        if new != items:
            fixes.append({"pill": pl["id"], "name": pl.get("name"), "from": items, "to": new, "matched": why})
    return fixes, stuck


async def music_relink(caller, args: dict) -> dict:
    page = await _page(caller)
    if not page.get("library_ready"):
        raise ToolError("unavailable", "Music Assistant is not connected, so the library cannot be checked")
    library = await _library(caller)
    fixes, stuck = relink_plan(page.get("playlists") or [], library, dict(args.get("mapping") or {}))
    pills = {p["id"]: p for p in page.get("playlists") or []}

    async def run():
        done = []
        for f in fixes:
            p = pills[f["pill"]]
            body = {"item": p["id"], "name": p["name"], "items": f["to"], "icon": p.get("icon"),
                    "order": p.get("order")}
            if p.get("chooser"):
                body["chooser"] = p["chooser"]
            await save(caller, {"type": "hk_music/playlist/save", **body})
            done.append(f["pill"])
        return {"relinked": done}
    out = await change(caller, "music_relink", args, run)
    out["fixes"], out["no_match"] = fixes, stuck
    return out


PILL = {"type": "string", "maxLength": 64, "description": "a pill's or preset's id (music_settings)"}
TOOLS = [
    Tool("music_settings", "Music settings",
         "The Music page: speakers, volume, people's home rooms, presets, playlist pills (each link with its "
         "playlist's name, and `gone: true` when it is no longer in the library), Music Assistant's groups.",
         {}, music_settings),
    Tool("music_library", "Music library",
         "Music Assistant's library: playlists (default, with their library:// links), or albums, artists, tracks, "
         "radios. `query` filters by name.",
         {"kind": {"type": "string", "enum": ["playlists", "albums", "artists", "tracks", "radios"]},
          "query": {"type": "string", "maxLength": 120},
          "limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 200}}, music_library),
    Tool("music_playlist_save", "Save a playlist pill",
         "Add a playlist pill (no `item`) or change one (`item` = its id): name, library:// links (`items`, played as "
         "one queue), icon, chooser, order. Planned first.",
         {"item": PILL, "name": {"type": "string", "maxLength": 80},
          "items": {"type": "array", "items": {"type": "string", "maxLength": 500}, "maxItems": 50},
          "icon": {"type": "string", "maxLength": 80}, "chooser": {"type": "string", "maxLength": 80},
          "order": {"type": "number"}},
         music_playlist_save, needs="settings", required=("name", "items"), write=True),
    Tool("music_preset_save", "Save a speaker preset",
         "Add a preset (no `item`) or change one: its name and member rooms. Planned first.",
         {"item": PILL, "name": {"type": "string", "maxLength": 80},
          "members": {"type": "array", "items": {"type": "string", "maxLength": 255}, "maxItems": 50}},
         music_preset_save, needs="settings", required=("name", "members"), write=True),
    Tool("music_item_remove", "Remove a pill or preset", "Remove a playlist pill or a preset. Planned first.",
         {"item": PILL}, music_item_remove, needs="settings", required=("item",), write=True, destructive=True),
    Tool("music_pills_order", "Order the playlist pills", "The playlist pills in this order (their ids). Planned first.",
         {"ids": {"type": "array", "items": PILL, "maxItems": 200}}, music_pills_order, needs="settings",
         required=("ids",), write=True, idempotent=True),
    Tool("music_settings_set", "Change Music's options",
         "The Music page's options (speakers, volume, homes...), as its own save checks them. Planned first.",
         {"changes": {"type": "object"}}, music_settings_set, needs="settings", required=("changes",), write=True),
    Tool("music_relink", "Relink playlist pills",
         "Pills whose library:// links are no longer in Music Assistant's library (it moved, a playlist was "
         "re-added): each matched again to the library playlist of the pill's name, or by `mapping` {old: new}. "
         "Planned first: the plan answer lists every fix and every link with no match.",
         {"mapping": {"type": "object", "description": "old library:// link -> new one"}},
         music_relink, needs="settings", write=True),
]
