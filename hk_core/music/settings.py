"""Music's settings, for the HK Settings page: each change checked, and each save shaped.

The host reads what it has (the stored options and items, the music server's players and
library, the house's users) and stores what this answers; the page's commands, who may send
them and where the result is kept are the host's (HA: features/music/settings_ws.py). Refusals
are BY FIELD: {field: a sentence to show}.
"""
from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from typing import Any

from .checks import playlist_errors, preset_errors, speakers_errors
from .config import MusicConfig, virtual_pairs
from .groups import kind, problem_text
from .const import (
    CONF_ANNOUNCE_ROOMS, CONF_CHOOSER, CONF_HOMES, CONF_ICON, CONF_IGNORE_ANNOUNCEMENTS, CONF_ITEMS, CONF_KEEP_READY,
    CONF_LEADERS, CONF_MEMBERS, CONF_NAME, CONF_ORDER, CONF_PAIRS, CONF_PLAYERS, CONF_SPEAKERS, CONF_VOLUME,
)

MSG = {
    "no_speakers": "Choose at least one speaker.",
    "no_name": "Give it a name.",
    "no_members": "Choose the rooms it plays in.",
    "not_a_speaker": "Every room must be one of the speakers.",
    "pair_alone": "A stereo pair plays on its own, so it can’t be in a preset with other rooms.",
    "no_items": "Choose at least one playlist.",
    "not_in_library": "That playlist isn’t in the Music Assistant library.",
    "volume": "Choose 0 to 100 %.",
    "homes": "A home room must be one of the speakers.",
    "rooms": "Every room must be one of the speakers.",
    "on_off": "Choose on or off.",
    "not_a_player": "That isn’t a Music Assistant player.",
    "list": "That list couldn’t be read.",
    "unknown": "That setting doesn’t exist.",
    "no_item": "That preset or playlist is gone.",
    "text": "That text is too long.",
    "pair_two": "Choose two different speakers.",
    "pair_twice": "A speaker can be in only one pair.",
    "pair_group": "Choose two speakers, not a Music Assistant group.",
    "pair_part": "That speaker is half of a pair. Unpair it first.",
    "no_pairs": "Speaker pairs are set up in Mantel Settings.",
}
TEXT_MAX = 60
SETTINGS = (CONF_SPEAKERS, CONF_VOLUME, CONF_HOMES, CONF_KEEP_READY, CONF_IGNORE_ANNOUNCEMENTS, CONF_PAIRS,
            CONF_LEADERS, CONF_ANNOUNCE_ROOMS)
ROOM_LISTS = (CONF_LEADERS, CONF_ANNOUNCE_ROOMS)     # lists of speakers, in order (MusicConfig.leader_of)
DEFAULT_ICON = "mdi:playlist-music"


def say(codes: Mapping[str, str]) -> dict[str, str]:
    """A check's codes, in words."""
    return {k: MSG.get(v, v) for k, v in codes.items()}


def text(v: Any) -> str:
    return str(v or "").strip()


def apply(options: Mapping[str, Any], changes: Mapping[str, Any], players: set[str],
          pairs: bool = False, ma_groups: Iterable[str] = ()) -> tuple[dict[str, Any], dict[str, str]]:
    """The options after `changes` (speakers in order, volume 0..1, homes {user: room or None},
    keep_ready and ignore_announcements on/off, the virtual pairs, the group leaders and announcement
    rooms: speakers, in order), and the refusals by field.
    `players`: the music server's players and whatever is chosen;
    `pairs`: whether this host plays virtual pairs (Mantel's engine does); `ma_groups`: the players
    that are Music Assistant groups (never half of a pair: a group cannot join another player)."""
    opts, errors = dict(options), {}
    for k in changes:
        if k not in SETTINGS:
            errors[k] = MSG["unknown"]
    if CONF_SPEAKERS in changes:
        sp = changes[CONF_SPEAKERS]
        seconds = {p[CONF_PLAYERS][1] for p in virtual_pairs(opts)}
        if not isinstance(sp, list) or not all(isinstance(x, str) for x in sp):
            errors[CONF_SPEAKERS] = MSG["list"]
        elif any(x not in players for x in sp):
            errors[CONF_SPEAKERS] = MSG["not_a_player"]
        elif CONF_PAIRS not in changes and set(sp) & seconds:
            errors[CONF_SPEAKERS] = MSG["pair_part"]
        elif e := speakers_errors(list(dict.fromkeys(sp))):
            errors.update(say(e))
        else:
            opts[CONF_SPEAKERS] = list(dict.fromkeys(sp))
            # a pair whose room is no longer a speaker is no pair: its second player is a player again
            if CONF_PAIRS in opts:
                opts[CONF_PAIRS] = [p for p in virtual_pairs(opts) if p[CONF_PLAYERS][0] in opts[CONF_SPEAKERS]]
            # a home room that is no longer a speaker is no home room
            opts[CONF_HOMES] = {u: r for u, r in (opts.get(CONF_HOMES) or {}).items() if r in opts[CONF_SPEAKERS]}
    if CONF_PAIRS in changes:
        if not pairs:
            errors[CONF_PAIRS] = MSG["no_pairs"]
        else:
            got, why = check_pairs(changes[CONF_PAIRS], players, set(ma_groups))
            if why:
                errors[CONF_PAIRS] = MSG[why]
            else:
                opts.update(pair_speakers(opts, got))
    for k in ROOM_LISTS:
        if k in changes:
            v, rooms = changes[k], opts.get(CONF_SPEAKERS) or []
            if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
                errors[k] = MSG["list"]
            elif any(x not in rooms for x in v):
                errors[k] = MSG["rooms"]
            else:
                opts[k] = list(dict.fromkeys(v))
    # a room that is no longer a speaker leads nothing and is announced to as no room
    for k in ROOM_LISTS:
        if k in opts:
            opts[k] = [r for r in opts[k] or [] if r in (opts.get(CONF_SPEAKERS) or [])]
    if CONF_VOLUME in changes:
        v = changes[CONF_VOLUME]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= v <= 1:
            errors[CONF_VOLUME] = MSG["volume"]
        else:
            opts[CONF_VOLUME] = round(float(v), 2)
    if CONF_IGNORE_ANNOUNCEMENTS in changes:
        if not isinstance(changes[CONF_IGNORE_ANNOUNCEMENTS], bool):
            errors[CONF_IGNORE_ANNOUNCEMENTS] = MSG["on_off"]
        else:
            opts[CONF_IGNORE_ANNOUNCEMENTS] = changes[CONF_IGNORE_ANNOUNCEMENTS]
    if CONF_KEEP_READY in changes:
        if not isinstance(changes[CONF_KEEP_READY], bool):
            errors[CONF_KEEP_READY] = MSG["on_off"]
        else:
            opts[CONF_KEEP_READY] = changes[CONF_KEEP_READY]
    if CONF_HOMES in changes:
        h = changes[CONF_HOMES]
        rooms = opts.get(CONF_SPEAKERS) or []
        if not isinstance(h, dict):
            errors[CONF_HOMES] = MSG["list"]
        elif any(r is not None and r not in rooms for r in h.values()):
            errors[CONF_HOMES] = MSG["homes"]
        else:
            homes = dict(opts.get(CONF_HOMES) or {})
            for user, r in h.items():
                if r:
                    homes[str(user)] = r
                else:
                    homes.pop(str(user), None)
            opts[CONF_HOMES] = homes
    return opts, errors


# ------------------------------------------------------------- virtual pairs
def check_pairs(v: Any, players: set[str], groups: set[str]) -> tuple[list[dict[str, Any]], str | None]:
    """The page's pairs ([{players: [first, second], name}]) checked: (the pairs, a refusal's code or None)."""
    if not isinstance(v, list):
        return [], "list"
    out, used = [], set()
    for p in v:
        two = p.get(CONF_PLAYERS) if isinstance(p, Mapping) else None
        name = p.get(CONF_NAME, "") if isinstance(p, Mapping) else None
        if not isinstance(two, list) or not all(isinstance(x, str) for x in two) \
                or not (name is None or isinstance(name, str)):
            return [], "list"
        if len(two) != 2 or two[0] == two[1]:
            return [], "pair_two"
        if any(x not in players for x in two):
            return [], "not_a_player"
        if set(two) & groups:
            return [], "pair_group"
        if set(two) & used:
            return [], "pair_twice"
        if len(text(name)) > TEXT_MAX:
            return [], "text"
        used.update(two)
        out.append({CONF_PLAYERS: list(two), CONF_NAME: text(name)})
    return out, None


def pair_speakers(options: Mapping[str, Any], pairs: list[dict[str, Any]]) -> dict[str, Any]:
    """The speakers and home rooms that go with new pairs: a pair is ONE speaker, in the place of the first of
    its two that was one (its first player, the room); a home room on its second player moves to the room. A
    pair taken apart gives its second player back, just after the first."""
    sp = list(options.get(CONF_SPEAKERS) or [])
    new = {(p[CONF_PLAYERS][0], p[CONF_PLAYERS][1]) for p in pairs}
    for p in virtual_pairs(options):
        a, b = p[CONF_PLAYERS]
        if (a, b) not in new and a in sp and b not in sp and not any(b in two for two in new):
            sp.insert(sp.index(a) + 1, b)
    homes = dict(options.get(CONF_HOMES) or {})
    for a, b in new:
        if a not in sp:
            if b in sp:
                sp[sp.index(b)] = a
            else:
                sp.append(a)
        sp = [x for x in sp if x != b]
        homes = {u: (a if r == b else r) for u, r in homes.items()}
    return {CONF_SPEAKERS: list(dict.fromkeys(sp)), CONF_PAIRS: pairs,
            CONF_HOMES: {u: r for u, r in homes.items() if r in sp}}


def pairs_page(cfg: MusicConfig, options: Mapping[str, Any], name: Callable[[str], str]) -> list[dict[str, Any]]:
    """The page's virtual pairs: {room, name (as set, maybe ""), shown (the room's name), players [{entity,
    name}], ma_group: Music Assistant's own group of the two (its name) or None}. `name`: a player's name."""
    out = []
    for p in virtual_pairs(options):
        a, b = p[CONF_PLAYERS]
        if a not in cfg.room_ids:
            continue
        g = cfg.pair_groups.get(a)
        out.append({"room": a, "name": p[CONF_NAME], "shown": cfg.name_of(a),
                    "players": [{"entity": e, "name": name(e)} for e in (a, b)],
                    "ma_group": name(g) if g else None})
    return out


# ------------------------------------------------------------- Music Assistant's groups
def groups_page(cfg: MusicConfig, players: Iterable[str]) -> dict[str, Any]:
    """What the page says about Music Assistant's groups (groups.py): ``ma_groups`` (the player list
    was read), ``pairs`` {speaker: {parts: [names], kind}} and, for each of ``players`` that is a
    group (never half of a virtual pair), ``groups`` {entity: {rooms, problems: [words]}}."""
    g = cfg.groups
    if g is None:
        return {"ma_groups": False, "pairs": {}, "groups": {}}
    order = [r.entity for r in sorted(cfg.rooms, key=lambda r: r.index)]
    groups = {}
    for e in players:
        got = g.rooms_of(e, order) if e not in cfg.pairs else None
        if got is not None:
            groups[e] = {"rooms": got.rooms, "problems": problems(cfg, got.problems)}
    return {"ma_groups": True, "groups": groups,
            "pairs": {r: {"parts": names, "kind": kind(names)} for r, names in cfg.pairs.items()}}


def problems(cfg: MusicConfig, found: Iterable[Mapping[str, Any]]) -> list[str]:
    return [problem_text(p, cfg.name_of(str(p.get("room") or ""))) for p in found]


# ------------------------------------------------------------- a preset
def check_preset(name: str, members: list[str], rooms: list[str], pairs: Iterable[str] = ()) -> dict[str, str]:
    """A preset save's refusals: the shared check, then its name's length."""
    errors = say(preset_errors(name, members, rooms, pairs))
    if not errors and len(name) > TEXT_MAX:
        errors[CONF_NAME] = MSG["text"]
    return errors


def preset_data(name: str, members: list[str]) -> dict[str, Any]:
    """A preset as it is stored: a name and its rooms (a group saved with an older one is dropped)."""
    return {CONF_NAME: name, CONF_MEMBERS: members}


# ------------------------------------------------------------- a playlist
def check_playlist(name: str, chooser: str, items: list[str], known: set[str] | None) -> dict[str, str]:
    """A playlist save's refusals: the shared check, then each text's length."""
    errors = say(playlist_errors(name, items, known))
    for k, v in ((CONF_NAME, name), (CONF_CHOOSER, chooser)):
        if not errors.get(k) and len(v) > TEXT_MAX:
            errors[k] = MSG["text"]
    return errors


def playlist_title(name: str, chooser: str | None) -> str:
    """How a playlist is listed: behind its chooser, when it has one."""
    return f"{chooser} · {name}" if chooser else name


def playlist_save(name: str, chooser: str, items: list[str], icon: Any, order: float | None,
                  old: Mapping[str, Any] | None, orders: Iterable[float]) -> tuple[str, dict[str, Any]]:
    """(the title, the data) a playlist is stored with. `old`: what it was (None: a new one);
    `orders`: every playlist's order. A new pill goes last; an edited one keeps its place."""
    was = dict(old) if old is not None else {}
    if order is None:
        order = was.get(CONF_ORDER) if old is not None else max(list(orders) or [0]) + 10
    data: dict[str, Any] = {CONF_NAME: name, CONF_ICON: text(icon) or was.get(CONF_ICON) or DEFAULT_ICON,
                            CONF_ITEMS: items, CONF_ORDER: float(order or 0)}
    if chooser:
        data[CONF_CHOOSER] = chooser
    return playlist_title(name, chooser), data


def reorder(orders: list[Any]) -> list[tuple[int, float]]:
    """The pills in a new order: each playlist's `order` becomes its place x 10. Answers
    (position, new order) for the ones that change."""
    return [(n - 1, float(n * 10)) for n, o in enumerate(orders, 1) if float(o or 0) != n * 10]
