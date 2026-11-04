"""The socket's doors in the route table (phase 18, A8): every read a page may ask over ``/ws``, and every message
Mantel Link may send over ``/linked/ws``, declared once.

A read's type is answered by Mantel itself (a connector's ``read_routes`` entry, or readproxy's ``MANTEL_READS``) or
relayed to Home Assistant (readproxy's ``READ_ALLOWED``, the keys each may carry, and ``RULES``, how its answer is
filtered). Each type is declared here with what it may show (``reads``, as a route's) and whether a read-only screen
preview may ask it (``preview``). This replaced the two lists a preview was checked against (``server.PREVIEW_READS``
and ``PREVIEW_READS_NEVER``, third audit pass SRV-2): Mantel refuses to start when a read type is registered with no
declaration here, or a declaration names no read (route_table.py, R13), and the generated table (Routes.md) lists
them beside the HTTP routes.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .guards import READS


@dataclass(frozen=True)
class Read:
    reads: str
    preview: bool
    why: str = ""

    def __post_init__(self) -> None:
        if self.reads not in READS and not self.reads.startswith("feature:"):
            raise ValueError(f"reads={self.reads!r}")
        if self.preview and self.reads == "admin":
            raise ValueError("a screen preview never reads settings")


SETTINGS = "an Owner's or Admin's Settings document or editor (configure on settings)"
SERVER_ONLY = "never for a page (readproxy.SERVER_ONLY_READS): an import's or Mantel's own read"

# every read a page may ask over the socket: what it shows, and whether a screen preview asks it (what a screen's
# cards and the shim read: the settings feed, the page headers and snoozes, the house's music, the clean areas, energy
# and Live TV guide, the camera signaling, history and logbook, calendars)
READS_BY_TYPE: dict[str, Read] = {
    "camera/webrtc/candidate": Read("view", True), "camera/webrtc/get_client_config": Read("view", True),
    "camera/webrtc/offer": Read("view", True),
    "config/entity_registry/get": Read("view", True),
    "energy/get_prefs": Read("feature:energy", True), "energy/info": Read("feature:energy", True),
    "frontend/get_themes": Read("none", True, "the theme list"),
    "frontend/get_user_data": Read("self", True), "frontend/subscribe_user_data": Read("self", True),
    "get_config": Read("view", True, "the house's settings; its location only with feature:locations"),
    "history/history_during_period": Read("view", True), "logbook/get_events": Read("view", True),
    "recorder/statistics_during_period": Read("view", True),
    "hk_clean_areas/subscribe": Read("view", True), "mantel/clean_areas/coverage": Read("view", True),
    "hk_frontend/events/subscribe": Read("view", True), "hk_frontend/page_headers/subscribe": Read("view", True),
    "hk_frontend/settings/subscribe": Read("view", True, "the settings feed, cut per person (SRV-4)"),
    "hk_frontend/snooze/subscribe": Read("view", True), "hk_frontend/todo/items": Read("view", True),
    "hk_music/queue": Read("view", True), "hk_music/subscribe": Read("feature:music", True),
    "hk_notify/snap/sign": Read("view", True), "hk_tv/channels": Read("view", True),
    "mantel/energy/plan": Read("feature:energy", True), "mantel/live_tv/guide": Read("feature:live_tv", True),
    "media_player/browse_media": Read("view", True), "media_player/search_media": Read("view", True),
    "media_source/browse_media": Read("feature:media", True), "media_source/resolve_media": Read("feature:media", True),
    "music_assistant/get_library": Read("feature:music", True), "music_assistant/get_queue": Read("feature:music", True),
    "music_assistant/search": Read("feature:music", True),
    "persistent_notification/subscribe": Read("feature:notifications", True),
    "weather/subscribe_forecast": Read("view", True),
    # the socket's other read message, read_api: only GET calendars/<entity> (readproxy.parse_read_api)
    "timeline/subscribe": Read("view", False, "the House Timeline's live rows, each cut for the viewer (timeline/api.py)"),
    "read_api": Read("view", True, "read_api: a calendar's events (GET calendars/<entity>), view the calendar"),
    # what a preview never asks: Settings' own documents and history, the editors', the imports'
    "hk_alarm_pin/settings/get": Read("admin", False, SERVER_ONLY),
    "hk_clean_areas/settings/get": Read("admin", False, SERVER_ONLY),
    "hk_energy/settings/get": Read("admin", False, SERVER_ONLY), "hk_energy/sources": Read("admin", False, SERVER_ONLY),
    "hk_frontend/grid/starter": Read("admin", False, SETTINGS), "hk_frontend/hidden/get": Read("admin", False, SETTINGS),
    "hk_frontend/panel/get": Read("admin", False, SERVER_ONLY), "hk_frontend/setup/check": Read("admin", False, SETTINGS),
    "hk_music/settings/get": Read("admin", False, SERVER_ONLY),
    "hk_music/settings/library": Read("feature:music", False, "Music's settings page: the library to pick from"),
    "hk_notify/settings/get": Read("admin", False, SERVER_ONLY), "hk_tv/settings/get": Read("admin", False, SERVER_ONLY),
    "mantel/energy/sources": Read("admin", False, SERVER_ONLY), "mantel/page_headers/get": Read("admin", False, SERVER_ONLY),
    "mantel/settings/get": Read("admin", False, SETTINGS), "mantel/settings/history": Read("admin", False, SETTINGS),
}

# what Mantel Link may send over /linked/ws (linked.py): each with what checks it
LINKED_TYPES: dict[str, str] = {
    "call_service": "the linked HK Frontend's Service credential (linked.py) and the gateway: RBAC as the person HA "
                    "names, the audit row first, the kill switch",
    "entity_command": "the same, for one entity's command (linked.COMMANDS)",
    "ping": "the credential only; changes nothing",
    "settings_write": "the credential's settings scope; SettingsService.save's own checks",
    "report": "the credential; what HK Frontend reports of itself (linked._REPORT_KEYS)",
    "page": "the credential; a linked dashboard's page reads, as the person linked to its HA user (linked_reads.py)",
    "phone_action": "the credential (protocol 2); a phone notification's action, as the person HA names, through the "
                    "gateway",
}


def preview_allows(read_type: Any) -> bool:
    """Whether a read-only screen preview may ask ``read_type`` over the socket."""
    got = READS_BY_TYPE.get(read_type) if isinstance(read_type, str) else None
    return got is not None and got.preview


def registered(app: Any) -> set[str]:
    """Every read type this app answers or relays."""
    from . import readproxy
    from .connectors import read_routes
    return set(read_routes(app)) | set(readproxy.READ_ALLOWED) | set(readproxy.MANTEL_READS) | {"read_api"}


def linked_registered() -> set[str]:
    from . import linked
    return set(linked.CLIENT_TYPES) | set(linked.CLIENT_TYPES_2) | set(linked.SETTINGS_TYPES) | set(linked.READS_TYPES)


def problems(app: Any) -> list[str]:
    """R13: every socket read and linked message declared here, and nothing declared that isn't one."""
    out = []
    reads = registered(app)
    for t in sorted(reads - set(READS_BY_TYPE)):
        out.append(f"R13 READ {t}: a socket read with no declaration in socket_reads.READS_BY_TYPE")
    linked = linked_registered()
    for t in sorted(linked - set(LINKED_TYPES)):
        out.append(f"R13 LINKED {t}: a Mantel Link message with no declaration in socket_reads.LINKED_TYPES")
    for t in sorted(set(LINKED_TYPES) - linked):
        out.append(f"R13 LINKED {t}: declared, and linked.py takes no such message")
    return out


def stale(app: Any) -> list[str]:
    """Declared reads this app doesn't register (some only under an option; tools/route_table.py joins them)."""
    return sorted(set(READS_BY_TYPE) - registered(app))


def lock_rows(app: Any) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for t in sorted(registered(app) & set(READS_BY_TYPE)):
        r = READS_BY_TYPE[t]
        out[f"READ {t}"] = {"module": "mantel_server.socket_reads", "handler": "/ws read", "kind": "socket_read",
                            "why": r.why or "a page's read over its signed-in socket (/ws)", "reads": r.reads,
                            "stream": "none", "preview": r.preview, "csrf": "-", "mcp": []}
    for t in sorted(linked_registered() & set(LINKED_TYPES)):
        out[f"LINKED {t}"] = {"module": "mantel_server.socket_reads", "handler": "/linked/ws message",
                              "kind": "link_credential", "why": LINKED_TYPES[t], "reads": None, "stream": "none",
                              "preview": False, "csrf": "-", "mcp": []}
    return out
