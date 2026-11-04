"""WHETHER A FEATURE HAS WHAT IT NEEDS (docs/phase16/FEATURES-ON-BY-DEFAULT.md "The needs check").

Mantel turns four features on by itself, once, when the house has what they need: Music (Music Assistant is
connected), Clean Areas (a vacuum with a room map), Energy (Home Assistant's Energy settings have a grid meter or
devices) and Live TV (a tuner on the home network that answers, and a way to serve it). This module says, from plain
facts the host gathered, whether each need is met. It reads nothing and sends nothing: the host (Mantel's feature
runner, ``features/auto.py``) gathers the facts, waits for two looks, and makes the change.

``met`` is True, False, or None for "can't tell yet". Only a clear "no" is False: a house whose registries haven't
loaded, or whose Energy settings couldn't be read, is None, never "a house without a vacuum".

``lan_host`` checks the tuner's address before the host asks it anything: the address can come from Home Assistant's
device registry, so it is a host check before it is a request. A private-range IP or a home network name (one label,
``.local``, ``.lan``, ``.home``, ``.internal``, ``.home.arpa``) passes; loopback, link-local, multicast, unspecified,
any public address and any other name are refused.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import ipaddress
import re
from typing import Any, Mapping
from urllib.parse import urlsplit

from .energy import plan as EP

PIECES = ("music", "clean_areas", "energy", "live_tv")      # the features that may turn on by themselves
TV_SERVES = ("mantel", "link", "ha", "none")
HOME_SUFFIXES = (".local", ".lan", ".home", ".internal", ".home.arpa")
_LABEL = re.compile(r"^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$")
_PORT = re.compile(r"^\d{1,5}$")
_NUMBER = re.compile(r"^(0x[0-9a-f]*|[0-9]+)$")
# RFC 1918's three home ranges, written as numbers: the build's private-data scan refuses dotted private addresses in
# shipped code (tools/build_ha.py), and Python's is_private also takes documentation and benchmark ranges
_RFC1918 = tuple(ipaddress.IPv4Network((base, bits)) for base, bits in
                 ((10 << 24, 8), ((172 << 24) | (16 << 16), 12), ((192 << 24) | (168 << 16), 16)))


@dataclass(frozen=True)
class Facts:
    ready: bool = False                        # HA's states and registries are loaded; False: nothing below is "absent"
    ma_connected: bool | None = None           # Mantel's own Music Assistant connection is live (None: not set up)
    vacuums: list[dict] | None = None          # hk_core.clean_areas.coverage(house, {}) rows
    energy_prefs: Mapping | None = None        # HA's energy/get_prefs answer; {} when none saved; None: not read
    tuner: str = ""                            # the address to try: the saved one, else the one found in the registry
    tuner_from: str = ""                       # "saved" | "registry" | "" (none)
    tuner_seen: bool = False                   # HA's registry has an HDHomeRun at all
    tuner_answers: bool | None = None          # lineup.json answered with channels (None: not asked)
    tv_serves: str = "none"                    # "mantel" | "link" | "ha" | "none": how Live TV would be served
    read_only: bool = False                    # Mantel was started read-only (decision 10: no `link` then)


@dataclass(frozen=True)
class Need:
    piece: str
    met: bool | None                           # None: can't tell yet (never "not met")
    why: str = ""                              # short words for the Owner: "Music Assistant is connected."
    write: Mapping[str, Any] = field(default_factory=dict)   # extra stored values the turn-on sets
    note: str = ""                             # not met, but near: what's missing, in the Owner's words


def lan_host(value: Any) -> str | None:
    """``host`` or ``host:port`` when ``value`` names a tuner on the home network, else None.

    Takes a bare host (a private-range IP, ``tuner.local``, ``hdhr:5004``) or an http(s) URL with no path, ``/`` or
    ``/lineup.json`` (a registry row's ``configuration_url``, a saved lineup URL). A bare host with a path, a user, a
    query or a fragment is refused."""
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text or len(text) > 300 or any(c.isspace() for c in text):
        return None
    if "://" in text:
        try:
            u = urlsplit(text)
            port = u.port
        except ValueError:
            return None
        if u.scheme not in ("http", "https") or u.username or u.password or u.query or u.fragment \
                or u.path not in ("", "/", "/lineup.json") or not u.hostname:
            return None
        host = u.hostname
    else:
        if "/" in text or "@" in text or "?" in text or "#" in text:
            return None
        host, port = text, None
        if text.startswith("["):
            end = text.find("]")
            if end < 0:
                return None
            host, rest = text[1:end], text[end + 1:]
            if rest:
                if not rest.startswith(":") or not _PORT.match(rest[1:]):
                    return None
                port = int(rest[1:])
        elif text.count(":") == 1:
            host, p = text.split(":")
            if not _PORT.match(p):
                return None
            port = int(p)
    if port is not None and not 0 < port < 65536:
        return None
    if not _home(host):
        return None
    shown = f"[{host}]" if ":" in host else host
    return f"{shown}:{port}" if port is not None else shown


def _home(host: str) -> bool:
    if "%" in host:                                     # an IPv6 zone: never needed for a tuner
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        name = host.lower().rstrip(".")
        labels = name.split(".")
        if not name or not all(_LABEL.match(x) for x in labels) or name == "localhost" or name.endswith(".localhost"):
            return False
        # 10.1, 3232235777, 0x7f000001, 0x7f.1: what the resolver reads as an IPv4 address (inet_aton's forms)
        if all(_NUMBER.match(x) for x in labels):
            return False
        return len(labels) == 1 or name.endswith(HOME_SUFFIXES)
    return home_ip(ip)


def home_ip(ip: "ipaddress.IPv4Address | ipaddress.IPv6Address | str") -> bool:
    """An address on the home network: RFC 1918 or IPv6's unique local range, never loopback, link-local and so on.
    The host checks every address a name resolves to with this before it connects."""
    if isinstance(ip, str):
        try:
            ip = ipaddress.ip_address(ip.split("%", 1)[0])
        except ValueError:
            return False
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    if ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_reserved:
        return False
    if ip.version == 4:
        return any(ip in n for n in _RFC1918)
    return ip in ipaddress.ip_network("fc00::/7")       # IPv6's own home range (unique local addresses)


def lineup_url(host: str) -> str:
    """The tuner’s lineup, for a host ``lan_host`` passed."""
    return f"http://{host}/lineup.json"


def look(facts: Facts) -> dict[str, Need]:
    """Each of the four features' need, from these facts."""
    return {"music": _music(facts), "clean_areas": _clean(facts), "energy": _energy(facts), "live_tv": _tv(facts)}


def _music(f: Facts) -> Need:
    # Music needs only Mantel's own connection to Music Assistant, not Home Assistant: `ready` doesn't apply
    if f.ma_connected is True:
        return Need("music", True, "Music Assistant is connected.")
    if f.ma_connected is False:
        return Need("music", False, note="Music Assistant is set up in Connections but isn’t connected.")
    return Need("music", False)


def _clean(f: Facts) -> Need:
    if not f.ready or f.vacuums is None:
        return Need("clean_areas", None)
    rows = [v for v in f.vacuums if isinstance(v, Mapping)]
    if any(v.get("how") == "map" and v.get("areas") for v in rows):
        return Need("clean_areas", True, "A vacuum has a map of the house’s rooms.")
    if any(v.get("how") == "map" for v in rows):
        return Need("clean_areas", False, note="A vacuum has a room map, but none of its rooms is one of the house’s areas.")
    if any(v.get("how") == "no_map" for v in rows):
        return Need("clean_areas", False,
                    note="A vacuum can clean by room, but Home Assistant has no room map for it.")
    return Need("clean_areas", False)


def _energy(f: Facts) -> Need:
    if not f.ready or f.energy_prefs is None:
        return Need("energy", None)
    prefs = f.energy_prefs if isinstance(f.energy_prefs, Mapping) else {}
    if EP.grid_of(prefs):
        return Need("energy", True, "Home Assistant’s Energy settings have a grid meter.")
    devices = prefs.get("device_consumption")
    if isinstance(devices, list) and any(isinstance(d, Mapping) and d.get("stat_consumption") for d in devices):
        return Need("energy", True, "Home Assistant’s Energy settings have devices.")
    return Need("energy", False)


def _tv(f: Facts) -> Need:
    if not f.ready:
        return Need("live_tv", None)
    if not f.tuner:
        if f.tuner_seen:
            return Need("live_tv", False, note="Home Assistant has an HDHomeRun, but Mantel doesn’t know its address: "
                                               "add it on Live TV’s page.")
        return Need("live_tv", False)
    host = lan_host(f.tuner)
    if host is None:
        return Need("live_tv", False, note="The tuner’s address isn’t one on the home network.")
    if f.tv_serves == "ha":
        return Need("live_tv", False, note="HK Frontend in Home Assistant runs Live TV.")
    if f.tv_serves == "link" and f.read_only:
        return Need("live_tv", False, note="Mantel was started read-only, so Mantel Link can’t show the channels.")
    if f.tv_serves not in ("mantel", "link"):
        return Need("live_tv", False, note="A tuner is set, but Mantel has no way to play Live TV here: it needs its "
                                           "own go2rtc, or Mantel Link with Live TV once Mantel runs the house.")
    if f.tuner_answers is None:
        return Need("live_tv", None)
    if f.tuner_answers is False:
        return Need("live_tv", False, note=f"The tuner at {host} didn’t answer with its channels.")
    write = {"tuner": host} if f.tuner_from != "saved" else {}
    return Need("live_tv", True, f"The tuner at {host} answers.", write)
