"""THE INTERCOM'S SETTINGS: the settings document ``house/intercom``, checked, with its defaults.

    { enabled, live_allowed, default_mode, max_live_s, max_message_s, chime: {message, live},
      stream_base, lag_ms, volume, max_volume, quiet_default: {schedule, from, to, while},
      rooms: { <speaker entity>: { enabled, live, volume, quiet, listeners, live_fails, demoted } } }

``check`` takes whatever is stored (or nothing) and returns the whole document, every field filled: an unknown key is
dropped, a value out of range is refused (ValueError, with words a Settings page can show). The house is opt-in: the
Intercom starts off, Live is not allowed until the proof has passed (decision 3), and every room starts off
(decision 7). Quiet hours default to 21:00-07:00 (decision 10), in Do Not Disturb's shape (notifications/dnd.py).
"""
from __future__ import annotations

import copy
import ipaddress
import re
from typing import Any, Mapping
from urllib.parse import urlsplit

from ..notifications.dnd import notify_dnd

MODES = ("message", "live")
LIVE_RANGE = (15, 120)          # decision 4: adjustable in Settings
MESSAGE_RANGE = (10, 60)
LIVE_FAILS_DEMOTE = 3           # decision 21: three Live failures in a row and a room is Message-only
MAX_LISTENERS = 16
DEFAULT_MAX_VOLUME = 70
DEFAULT_VOLUME = 40       # a room on Automatic (2026-11-05: Music Assistant's own level followed the speakers, at 2% a whisper)
PRIVATE_SUFFIXES = (".local", ".lan", ".home.arpa")
# a home network: RFC 1918 and IPv6 unique-local (never loopback, link-local, documentation or carrier ranges)
# (made from numbers: the packaging's scan refuses an address written out)
PRIVATE_NETS = (ipaddress.IPv4Network((10 << 24, 8)), ipaddress.IPv4Network(((172 << 24) | (16 << 16), 12)),
                ipaddress.IPv4Network(((192 << 24) | (168 << 16), 16)), ipaddress.IPv6Network((0xFC << 120, 7)))
_SPEAKER = re.compile(r"^media_player\.[a-z0-9_]+$")
_TABLET = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")

# THE PROOF'S MEASUREMENT (slice 0, 2026-11-03, Music Assistant 2.10.9, one idle HomePod): Live starts this far behind
# the talker (the median from the first byte to the player playing, plus AirPlay's own 2 s). The sheet says it, a
# listener tablet delays by it, and Settings offers "Live Allowed" only once it is known. Run tools/intercom_proof.py
# again on a newer Music Assistant and change it here.
PROOF_LAG_MS = 7450

QUIET_DEFAULT = {"schedule": True, "from": "21:00", "to": "07:00", "while": []}

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "live_allowed": False,
    "default_mode": "message",
    "max_live_s": 60,
    "max_message_s": 30,
    "chime": {"message": True, "live": False},
    "stream_base": "",
    "lag_ms": PROOF_LAG_MS,
    "max_volume": DEFAULT_MAX_VOLUME,
    "volume": DEFAULT_VOLUME,
    "quiet_default": QUIET_DEFAULT,
    "rooms": {},
}
ROOM_DEFAULTS: dict[str, Any] = {"enabled": False, "live": True, "volume": None, "quiet": None, "listeners": [],
                                 "live_fails": 0, "demoted": False}
HOUSE_FIELDS = frozenset(DEFAULTS) - {"rooms"}
ROOM_FIELDS = frozenset(ROOM_DEFAULTS)


def defaults() -> dict[str, Any]:
    return copy.deepcopy(DEFAULTS)


def _bool(v: Any, name: str) -> bool:
    if not isinstance(v, bool):
        raise ValueError(f"{name} is on or off")
    return v


def _int(v: Any, name: str, lo: int, hi: int) -> int:
    if (isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf"))
            or v != int(v) or not lo <= v <= hi):
        raise ValueError(f"{name} is a whole number from {lo} to {hi}")
    return int(v)


def _quiet(v: Any, name: str) -> dict[str, Any]:
    got = notify_dnd(v)
    if got is None:
        raise ValueError(f"{name} is quiet hours ({{schedule, from, to}})")
    return got


def base_problem(url: Any) -> str | None:
    """Why ``url`` can't be the address Music Assistant fetches the Intercom's audio from, or None. It must be
    plain http or https to a private address (RFC 1918, unique-local IPv6) or a .local, .lan or .home.arpa name, with
    a port and nothing after it: the listener is never reached through a tunnel or a public name."""
    if not isinstance(url, str) or not url.strip():
        return "Enter the address Music Assistant can reach Mantel on, such as http://<this server's address>:8767"
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return "The address starts with http:// and names this server"
    if parts.username or parts.password or parts.query or parts.fragment or parts.path not in ("", "/"):
        return "The address is just http://<host>:<port>, nothing after it"
    try:
        port = parts.port
    except ValueError:
        return "The port is a number from 1 to 65535"
    if port is None:
        return "The address needs the Intercom's port, such as :8767"
    host = parts.hostname.lower()
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        if host.endswith(PRIVATE_SUFFIXES):
            return None
        return "Use this server's private address (or a .local, .lan or .home.arpa name), never a public one"
    if not any(ip in n for n in PRIVATE_NETS if n.version == ip.version):
        return "Use this server's private address on the home network, never a public or loopback one"
    return None


def normal_base(url: str) -> str:
    """``url`` as links are made from it: no trailing slash."""
    return url.strip().rstrip("/")


def check_room(v: Any, name: str = "room") -> dict[str, Any]:
    if not isinstance(v, Mapping):
        raise ValueError(f"{name} is a set of settings")
    out = copy.deepcopy(ROOM_DEFAULTS)
    for k in ROOM_FIELDS & set(v):
        val = v[k]
        if k in ("enabled", "live", "demoted"):
            out[k] = _bool(val, k)
        elif k == "volume":
            out[k] = None if val is None else _int(val, "volume", 0, 100)
        elif k == "quiet":
            out[k] = None if val is None else _quiet(val, "quiet")
        elif k == "listeners":
            if not isinstance(val, list) or not all(isinstance(t, str) and _TABLET.match(t) for t in val):
                raise ValueError("listeners is a list of wall tablets")
            out[k] = list(dict.fromkeys(val))[:MAX_LISTENERS]
        elif k == "live_fails":
            out[k] = _int(val, "live_fails", 0, 1000)
    return out


def check(body: Any) -> dict[str, Any]:
    """The stored document (or None) -> the whole, checked document. ValueError when a field is wrong."""
    out = defaults()
    if body is None:
        return out
    if not isinstance(body, Mapping):
        raise ValueError("the Intercom's settings are a set of fields")
    for k in HOUSE_FIELDS & set(body):
        v = body[k]
        if k in ("enabled", "live_allowed"):
            out[k] = _bool(v, k)
        elif k == "default_mode":
            if v not in MODES:
                raise ValueError("the default mode is Message or Live")
            out[k] = v
        elif k == "max_live_s":
            out[k] = _int(v, "Live's limit", *LIVE_RANGE)
        elif k == "max_message_s":
            out[k] = _int(v, "a Message's limit", *MESSAGE_RANGE)
        elif k == "chime":
            if not isinstance(v, Mapping):
                raise ValueError("chime is {message, live}")
            out[k] = {m: _bool(v.get(m, DEFAULTS["chime"][m]), f"the {m} chime") for m in MODES}
        elif k == "stream_base":
            if v in ("", None):
                out[k] = ""
            else:
                why = base_problem(v)
                if why:
                    raise ValueError(why)
                out[k] = normal_base(v)
        elif k == "lag_ms":
            out[k] = None if v is None else _int(v, "lag_ms", 0, 60000)
        elif k == "max_volume":
            out[k] = _int(v, "the highest volume", 1, 100)
        elif k == "volume":
            out[k] = _int(v, "the volume", 1, 100)
        elif k == "quiet_default":
            out[k] = _quiet(v, "quiet hours")
    rooms = body.get("rooms")
    if rooms is not None:
        if not isinstance(rooms, Mapping):
            raise ValueError("rooms is {speaker: settings}")
        for eid, r in rooms.items():
            if not isinstance(eid, str) or not _SPEAKER.match(eid):
                raise ValueError(f"{eid!r} is not a speaker")
            out["rooms"][eid] = check_room(r, eid)
    if out["default_mode"] == "live" and not out["live_allowed"]:
        out["default_mode"] = "message"
    return out


def merge(doc: Mapping[str, Any], changes: Mapping[str, Any]) -> dict[str, Any]:
    """The house fields in ``changes`` over ``doc``, checked (rooms are changed one at a time: ``merge_room``)."""
    if not isinstance(changes, Mapping) or not changes or set(changes) - HOUSE_FIELDS:
        raise ValueError("change one or more of: " + ", ".join(sorted(HOUSE_FIELDS)))
    body = copy.deepcopy(dict(doc))
    for k, v in changes.items():
        body[k] = {**body.get(k, {}), **v} if k == "chime" and isinstance(v, Mapping) else v
    return check(body)


def merge_room(doc: Mapping[str, Any], entity: str, changes: Mapping[str, Any]) -> dict[str, Any]:
    """One room's fields in ``changes`` over ``doc``. ``reset_live`` clears its Live health (Try Live Again)."""
    if not isinstance(entity, str) or not _SPEAKER.match(entity):
        raise ValueError("not a speaker")
    if not isinstance(changes, Mapping) or not changes:
        raise ValueError("nothing to change")
    allowed = (ROOM_FIELDS - {"live_fails", "demoted"}) | {"reset_live"}
    if set(changes) - allowed:
        raise ValueError("change one or more of: " + ", ".join(sorted(allowed)))
    body = copy.deepcopy(dict(doc))
    room = dict(body.get("rooms", {}).get(entity) or ROOM_DEFAULTS)
    if changes.get("reset_live") is True:
        room["live_fails"], room["demoted"] = 0, False
    room.update({k: v for k, v in changes.items() if k != "reset_live"})
    body.setdefault("rooms", {})[entity] = room
    return check(body)


def room(doc: Mapping[str, Any], entity: str) -> dict[str, Any]:
    """A room's settings (its defaults when it has none: off)."""
    got = (doc.get("rooms") or {}).get(entity)
    return got if got is not None else copy.deepcopy(ROOM_DEFAULTS)


def limit_s(doc: Mapping[str, Any], mode: str) -> int:
    return int(doc["max_live_s"] if mode == "live" else doc["max_message_s"])


def live_offered(doc: Mapping[str, Any]) -> bool:
    """Live is drawn only when an Owner allows it (after the proof passed)."""
    return bool(doc.get("enabled") and doc.get("live_allowed"))


def volume_of(doc: Mapping[str, Any], entity: str) -> int | None:
    """A room's announcement volume (0-100): its own, else the house's (Automatic), capped by the house's highest. Never
    Music Assistant's own level: that follows the speaker's volume, and a speaker left at 2% announced in a whisper."""
    v = room(doc, entity).get("volume")
    if v is None:
        v = doc.get("volume") or DEFAULT_VOLUME
    return min(int(v), int(doc.get("max_volume") or DEFAULT_MAX_VOLUME))


def quiet_of(doc: Mapping[str, Any], entity: str) -> dict[str, Any]:
    return room(doc, entity).get("quiet") or doc.get("quiet_default") or QUIET_DEFAULT


def live_result(doc: Mapping[str, Any], entity: str, ok: bool) -> dict[str, Any]:
    """A Live result for a room (never about content): a success clears the count; three failures in a row make the
    room Message-only until an Owner presses Try Live Again (decision 21)."""
    body = copy.deepcopy(dict(doc))
    r = dict(room(body, entity))
    if ok:
        r["live_fails"] = 0
    else:
        r["live_fails"] = int(r.get("live_fails") or 0) + 1
        if r["live_fails"] >= LIVE_FAILS_DEMOTE:
            r["demoted"] = True
    body.setdefault("rooms", {})[entity] = r
    return check(body)


def listeners_of(doc: Mapping[str, Any], rooms: Any) -> set[str]:
    """The wall tablets listed as listeners of any of ``rooms``."""
    out: set[str] = set()
    for r in rooms:
        out.update(room(doc, r).get("listeners") or [])
    return out


def rooms_of_tablet(doc: Mapping[str, Any], tablet: str | None) -> list[str]:
    """The rooms that list ``tablet`` as a listener (the tablet is "here" in them)."""
    if not tablet:
        return []
    return [e for e, r in (doc.get("rooms") or {}).items() if tablet in (r.get("listeners") or [])]
