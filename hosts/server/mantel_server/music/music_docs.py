"""music.py's the music settings document: its check and its import (moved here by tools/split_py.py from hosts/server/mantel_server/music/__init__.py:
tools/split_py_manifests/music.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any
from hk_core.music import settings as S
from hk_core.music.const import (CONF_CHOOSER, CONF_HOMES, CONF_ICON, CONF_IGNORE_ANNOUNCEMENTS, CONF_ITEMS,
    CONF_KEEP_READY, CONF_MEMBERS, CONF_NAME, CONF_ORDER, CONF_PAIRS, CONF_PLAYERS, CONF_SPEAKERS, CONF_VOLUME,
    DEFAULT_VOLUME, SUB_PLAYLIST, SUB_PRESET,)
from .music_names import IMPORT_READ, ITEMS_MAX, KEY, log, PLAYER, TEXT_MAX


# ------------------------------------------------------------------------------------- the settings doc
def empty_doc() -> dict[str, Any]:
    return {"options": {CONF_SPEAKERS: [], CONF_VOLUME: DEFAULT_VOLUME, CONF_HOMES: {}, CONF_KEEP_READY: False,
                        CONF_IGNORE_ANNOUNCEMENTS: True}, "items": [], "source": None}


def _text(v: Any, limit: int = TEXT_MAX) -> str:
    if not isinstance(v, str) or len(v) > limit:
        raise ValueError("text")
    return v


def check_doc(body: Any) -> dict[str, Any]:
    """``house/music`` as Mantel keeps it, checked: {options: {speakers, volume, homes, keep_ready,
    ignore_announcements, pairs?, leaders?, announce_rooms?}, items: [{kind, key, title, data}], source}. Raises ValueError."""
    if not isinstance(body, Mapping):
        raise ValueError("house/music is an object")
    out = empty_doc()
    opts = body.get("options") if isinstance(body.get("options"), Mapping) else {}
    sp = opts.get(CONF_SPEAKERS, [])
    if not isinstance(sp, list) or not all(isinstance(x, str) and PLAYER.match(x) for x in sp):
        raise ValueError("options.speakers: media_player entity ids")
    out["options"][CONF_SPEAKERS] = list(dict.fromkeys(sp))
    vol = opts.get(CONF_VOLUME, DEFAULT_VOLUME)
    if isinstance(vol, bool) or not isinstance(vol, (int, float)) or not 0 <= vol <= 1:
        raise ValueError("options.volume: 0..1")
    out["options"][CONF_VOLUME] = round(float(vol), 2)
    homes = opts.get(CONF_HOMES, {})
    if not isinstance(homes, Mapping) or not all(isinstance(k, str) and 0 < len(k) <= 100 and isinstance(v, str)
                                                  and PLAYER.match(v) for k, v in homes.items()):
        raise ValueError("options.homes: {person: media_player}")
    out["options"][CONF_HOMES] = dict(homes)
    for k in (CONF_KEEP_READY, CONF_IGNORE_ANNOUNCEMENTS):
        if k in opts:
            if not isinstance(opts[k], bool):
                raise ValueError(f"options.{k}: true or false")
            out["options"][k] = opts[k]
    for k in S.ROOM_LISTS:       # GROUP LEADERS and ANNOUNCEMENT ROOMS: speakers, in order (MusicConfig.leader_of)
        if k in opts:
            v = opts[k]
            if not isinstance(v, list) or len(v) > ITEMS_MAX or not all(isinstance(x, str) and PLAYER.match(x) for x in v):
                raise ValueError(f"options.{k}: media_player entity ids")
            out["options"][k] = list(dict.fromkeys(v))
    if CONF_PAIRS in opts:       # VIRTUAL PAIRS (docs/phase4/VIRTUAL-PAIRS.md): [{players: [first, second], name}]
        pairs = opts[CONF_PAIRS]
        if not isinstance(pairs, list) or len(pairs) > ITEMS_MAX or not all(
                isinstance(p, Mapping) and isinstance(p.get(CONF_PLAYERS), list) and len(p[CONF_PLAYERS]) == 2
                and all(isinstance(x, str) and PLAYER.match(x) for x in p[CONF_PLAYERS]) for p in pairs):
            raise ValueError("options.pairs: [{players: [two media_players], name}]")
        out["options"][CONF_PAIRS] = [{CONF_PLAYERS: list(p[CONF_PLAYERS]), CONF_NAME: _text(p.get(CONF_NAME) or "")}
                                      for p in pairs]
    items = body.get("items", [])
    if not isinstance(items, list) or len(items) > ITEMS_MAX:
        raise ValueError(f"items: at most {ITEMS_MAX}")
    seen = set()
    for it in items:
        if not isinstance(it, Mapping) or it.get("kind") not in (SUB_PRESET, SUB_PLAYLIST) \
                or not isinstance(it.get("key"), str) or not KEY.match(it["key"]) or it["key"] in seen:
            raise ValueError("items: {kind: preset|playlist, key, title, data}")
        seen.add(it["key"])
        d = it.get("data") if isinstance(it.get("data"), Mapping) else {}
        if it["kind"] == SUB_PRESET:
            # (a group saved with a preset before presets were Mantel's own is dropped: none plays it)
            members = d.get(CONF_MEMBERS)
            if not isinstance(members, list) or not all(isinstance(m, str) and PLAYER.match(m) for m in members):
                raise ValueError("a preset: {name, members}")
            data = {CONF_NAME: _text(d.get(CONF_NAME, "")), CONF_MEMBERS: list(members)}
        else:
            uris = d.get(CONF_ITEMS)
            order = d.get(CONF_ORDER, 0)
            if not isinstance(uris, list) or not all(isinstance(u, str) and 0 < len(u) <= 500 for u in uris) \
                    or isinstance(order, bool) or not isinstance(order, (int, float)):
                raise ValueError("a playlist: {name, icon, items, order, chooser?}")
            data = {CONF_NAME: _text(d.get(CONF_NAME, "")), CONF_ICON: _text(d.get(CONF_ICON) or S.DEFAULT_ICON),
                    CONF_ITEMS: list(uris), CONF_ORDER: float(order)}
            if d.get(CONF_CHOOSER):
                data[CONF_CHOOSER] = _text(d[CONF_CHOOSER])
        out["items"].append({"kind": it["kind"], "key": it["key"], "title": _text(it.get("title") or data[CONF_NAME]),
                             "data": data})
    src = body.get("source")
    out["source"] = src if isinstance(src, str) and len(src) <= 80 else None
    return out


def import_page(page: Any, source: str | None = None) -> dict[str, Any] | None:
    """HA's music settings page (``hk_music/settings/get``: settings_ws.page) -> ``house/music``, or None when
    HA's music is not set up. Home rooms are HA users' (``ha:<HA user id>``): a Mantel person linked to that HA
    user has that home room until one is chosen for them in Mantel. Values that would not pass check_doc are
    left out rather than failing the import."""
    if not isinstance(page, Mapping) or not page.get("configured"):
        return None
    sp = [s.get("entity") for s in page.get("speakers") or [] if isinstance(s, Mapping)]
    sp = [s for s in sp if isinstance(s, str) and PLAYER.match(s)]
    homes = {f"ha:{u}": r for u, r in (page.get("homes") or {}).items()
             if isinstance(u, str) and 0 < len(u) <= 64 and isinstance(r, str) and r in sp}
    vol = page.get("volume", DEFAULT_VOLUME)
    opts = {CONF_SPEAKERS: sp, CONF_VOLUME: vol if isinstance(vol, (int, float)) and not isinstance(vol, bool)
            and 0 <= vol <= 1 else DEFAULT_VOLUME, CONF_HOMES: homes,
            CONF_KEEP_READY: page.get("keep_ready") is True,
            CONF_IGNORE_ANNOUNCEMENTS: page.get("ignore_announcements", True) is not False}
    items = []
    for p in page.get("presets") or []:
        one = {"kind": SUB_PRESET, "key": p.get("id"), "title": p.get("name"),
               "data": {CONF_NAME: p.get("name"), CONF_MEMBERS: p.get("members")}} \
            if isinstance(p, Mapping) else None
        items.append(one)
    for p in page.get("playlists") or []:
        if not isinstance(p, Mapping):
            continue
        data = {CONF_NAME: p.get("name"), CONF_ICON: p.get("icon") or S.DEFAULT_ICON, CONF_ITEMS: p.get("items"),
                CONF_ORDER: p.get("order") or 0}
        if p.get("chooser"):
            data[CONF_CHOOSER] = p["chooser"]
        items.append({"kind": SUB_PLAYLIST, "key": p.get("id"),
                      "title": S.playlist_title(str(p.get("name") or ""), p.get("chooser")), "data": data})
    good = []
    for it in items:
        try:
            check_doc({"options": {}, "items": [it]})
            good.append(it)
        except (ValueError, TypeError):
            log.warning("music import: left out a preset or playlist HA has that Mantel cannot keep")
    return check_doc({"options": opts, "items": good, "source": source})


async def import_doc(panel: Any, read: Callable[[dict], Any], source: str | None = None) -> dict[str, Any] | None:
    """The feature import's music part: only when HA has Music added (panel/get's ``features.hk_music``), one
    server-only read of HA's music settings page. Reads only; never writes to HA."""
    feats = panel.get("features") if isinstance(panel, Mapping) else None
    hk = feats.get("hk_music") if isinstance(feats, Mapping) else None
    if not isinstance(hk, Mapping) or not hk.get("entries"):
        return None
    return import_page(await read({"type": IMPORT_READ}), source)
