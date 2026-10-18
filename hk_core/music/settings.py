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
from .const import (
    CONF_CHOOSER, CONF_GROUP, CONF_HOMES, CONF_ICON, CONF_IGNORE_ANNOUNCEMENTS, CONF_ITEMS, CONF_KEEP_READY,
    CONF_MEMBERS, CONF_NAME, CONF_ORDER, CONF_SPEAKERS, CONF_VOLUME,
)

MSG = {
    "no_speakers": "Choose at least one speaker.",
    "group_is_room": "A sync group can’t also be a room: add it as a preset.",
    "no_name": "Give it a name.",
    "no_members": "Choose the rooms it plays in.",
    "not_a_speaker": "Every room must be one of the speakers.",
    "group_room": "Choose the sync group’s own player, not a room.",
    "no_items": "Choose at least one playlist.",
    "not_in_library": "That playlist isn’t in the Music Assistant library.",
    "volume": "Choose 0 to 100 %.",
    "homes": "A home room must be one of the speakers.",
    "on_off": "Choose on or off.",
    "not_a_player": "That isn’t a Music Assistant player.",
    "list": "That list couldn’t be read.",
    "unknown": "That setting doesn’t exist.",
    "no_item": "That preset or playlist is gone.",
    "text": "That text is too long.",
}
TEXT_MAX = 60
SETTINGS = (CONF_SPEAKERS, CONF_VOLUME, CONF_HOMES, CONF_KEEP_READY, CONF_IGNORE_ANNOUNCEMENTS)
DEFAULT_ICON = "mdi:playlist-music"


def say(codes: Mapping[str, str]) -> dict[str, str]:
    """A check's codes, in words (a preset's group that is a room says so its own way)."""
    out = {}
    for k, v in codes.items():
        out[k] = MSG["group_room"] if (k == CONF_GROUP and v == "group_is_room") else MSG.get(v, v)
    return out


def text(v: Any) -> str:
    return str(v or "").strip()


def apply(options: Mapping[str, Any], changes: Mapping[str, Any], players: set[str],
          groups: list[str]) -> tuple[dict[str, Any], dict[str, str]]:
    """The options after `changes` (speakers in order, volume 0..1, homes {user: room or None},
    keep_ready and ignore_announcements on/off), and the refusals by field. `players`: the music
    server's players and whatever is chosen; `groups`: the presets' sync groups."""
    opts, errors = dict(options), {}
    for k in changes:
        if k not in SETTINGS:
            errors[k] = MSG["unknown"]
    if CONF_SPEAKERS in changes:
        sp = changes[CONF_SPEAKERS]
        if not isinstance(sp, list) or not all(isinstance(x, str) for x in sp):
            errors[CONF_SPEAKERS] = MSG["list"]
        elif any(x not in players for x in sp):
            errors[CONF_SPEAKERS] = MSG["not_a_player"]
        elif e := speakers_errors(list(dict.fromkeys(sp)), groups):
            errors.update(say(e))
        else:
            opts[CONF_SPEAKERS] = list(dict.fromkeys(sp))
            # a home room that is no longer a speaker is no home room
            opts[CONF_HOMES] = {u: r for u, r in (opts.get(CONF_HOMES) or {}).items() if r in opts[CONF_SPEAKERS]}
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


# ------------------------------------------------------------- a preset
def check_preset(name: str, group: str, members: list[str], rooms: list[str],
                 players: Callable[[], Iterable[str]]) -> dict[str, str]:
    """A preset save's refusals: the shared check, then its name's length, then a group that is
    one of the music server's players (`players`, asked only when it comes to that)."""
    errors = say(preset_errors(name, group, members, rooms))
    if not errors and len(name) > TEXT_MAX:
        errors[CONF_NAME] = MSG["text"]
    if not errors and group not in players():
        errors[CONF_GROUP] = MSG["not_a_player"]
    return errors


def preset_data(name: str, group: str, members: list[str]) -> dict[str, Any]:
    return {CONF_NAME: name, CONF_GROUP: group, CONF_MEMBERS: members}


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
