"""The feature settings of Mantel's features: the pieces and their defaults, the constants and patterns the
validation and the host share, ``check_settings`` (what a save or an import may store) and the import from Home
Assistant's HK features (``import_piece``, ``import_features``). Nothing here touches the hub or a store."""
from __future__ import annotations

import copy
import re
from typing import Any, Awaitable, Callable, Mapping

from hk_core.notifications import rules as NR, settings as NS
from hk_core.screensaver import rules as SS


FEATURE_ACTOR = "mantel:features"
FEATURE_ACTOR_NAME = "Mantel features"
FEATURES_DOC = "mantel_features"        # house/<this>: the pieces and their settings
MUTES_DOC = "notify_mutes"              # house/<this>: Mute 1 Hour, {"mutes": {key: until (epoch s)}}
PIECES = ("notifications", "linked", "sleep", "clean_areas", "energy", "live_tv", "tablets")
DEFAULTS: dict[str, dict[str, Any]] = {
    "notifications": {"enabled": False, "options": {}, "items": []},
    "linked": {"enabled": False, "entry_id": None, "backlight": False, "backlights": {}},
    "sleep": {"enabled": False},
    "clean_areas": {"enabled": False, "options": {}},
    "energy": {"enabled": False, "options": {}},
    # `go2rtc_once`: Mantel has started with its own go2rtc and turned Live TV on for it, once (host._live_tv_once)
    "live_tv": {"enabled": False, "tuner": "", "guide_url": "", "channels": [], "names": {}, "quality": "720",
                "go2rtc_once": False},
    # All Tablets' alerts and scheduled restart (feature_watch.TabletWatch), with the house settings' own
    # `tablets` choices (alert_offline, alert_charging, alert_restart, restart, restart_times)
    "tablets": {"enabled": False},
    # NOT A PIECE: what the feature import read from Home Assistant (import_features): the HK features HA
    # had added (``added``, HA's kinds), their items ({kind: [{entry_id, title}]}) and where from. Music,
    # Alarm PIN and Live TV's channel cameras still run in HA: the screens are told they are added from this.
    "ha": {"added": [], "items": {}, "source": None},
}
# HK Frontend's feature kinds as Home Assistant has them (hk_frontend/features KINDS, in its order), and
# HK Settings' ids for them (setup_check.COMPANIONS, in its order): the shapes the screens read
HA_KINDS = ("music", "live_tv", "clean_areas", "alarm_pin", "energy", "notifications")
COMPANIONS = (("hk_music", "music", "Music"), ("hk_alarm_pin", "alarm_pin", "Alarm PIN"),
              ("hk_clean_areas", "clean_areas", "Clean Areas"), ("hk_tv", "live_tv", "Live TV"),
              ("hk_energy", "energy", "Energy"), ("hk_notify", "notifications", "Notifications"))
# the features whose engines still run in Home Assistant (music; the alarm's PIN; Live TV's channel
# cameras, transcode and viewers): added on Mantel's screens while HA has them (the import's ``ha.added``)
HA_RUN = frozenset({"music", "alarm_pin", "live_tv"})
# what the feature import reads, per piece: each feature's own HK Settings read in HA (server-only reads,
# readproxy.SERVER_ONLY_READS), made into Mantel's piece by import_piece
FEATURE_READS = {"notifications": "hk_notify/settings/get", "clean_areas": "hk_clean_areas/settings/get",
                 "energy": "hk_energy/settings/get", "live_tv": "hk_tv/settings/get"}
IMPORTED = ("ha", *FEATURE_READS)          # what an import (re)writes; `linked` and `sleep` stay as they are
# Every read this module answers in app["read_routes"] has exactly one rule here (pinned by
# tests/test_feature_parity.py). None is forwarded to Home Assistant.
ROUTE_RULES: dict[str, str] = {
    "hk_frontend/events/subscribe": "signed in; a frame naming `users` reaches only those people",
    "mantel/live_tv/guide": "signed in",
    "mantel/energy/plan": "feature:energy",
    "mantel/clean_areas/coverage": "signed in",
    "hk_clean_areas/subscribe": "signed in; {configured, areas} from hk_core clean_areas over MantelHouse; an area "
                                "is offered only through a vacuum the subject may view; carries nothing",
    "hk_frontend/todo/items": "signed in; hk_core todo over MantelHouse: todo.get_items through the gateway as the "
                              "person (RBAC on the list, audited); commands off: nothing sent, `refused`",
}
# a tablet's four linked entities: key -> (platform, icon), as hk_frontend makes them
TABLET_ENTITIES = {SS.BLACK_KEY: ("switch", "mdi:monitor-off"), SS.SWITCH_KEY: ("switch", "mdi:image-multiple"),
                   SS.INUSE_KEY: ("binary_sensor", "mdi:gesture-tap"), "sleep_screen": ("sensor", "mdi:tablet-dashboard")}
# what a feature's own house command may act on: the kiosk parts the Sleep Screen drives
KIOSK_DOMAINS = frozenset({"light", "switch", "select", "button"})
_ENTRY = re.compile(r"^[A-Za-z0-9_]{1,64}$")
_LIGHT = re.compile(r"^light\.[a-z0-9_]+$")
_URL = re.compile(r"^https?://[^\s/?#]+[^\s]*$")
_HOST = re.compile(r"^[A-Za-z0-9.\-]{1,253}(:\d{1,5})?$")
_CHANNEL = re.compile(r"^\d{1,4}(\.\d{1,4})?$")
_TID = re.compile(r"^[a-z0-9_-]{1,80}$")
LOG_KEEP = 100
LIVE_TV_REFRESH_S = 1800
ENERGY_REFRESH_S = 300.0               # the Energy page's plan, worked out again at least this often
MAX_FETCH = 60_000_000


# ------------------------------------------------------------------------------------- settings
def bad_item(item: Any) -> str | None:
    """Why one stored notification can't be used, or None. Its fields are checked with the checks HK Settings
    saves with (``hk_core.notifications.settings.FIELDS``): the engine (``banner.build``, ``accessories.members``)
    takes their shapes as given, so a bad one would fail on every change, or stop Mantel starting."""
    if not isinstance(item, Mapping) or not isinstance(item.get("id"), str) or not item["id"]:
        return "each with an id"
    cat = item.get("category")
    if cat is not None and NR.category(cat) is None:
        return f"{item['id']}: category {cat!r} is not one of HK's"
    for k, v in item.items():
        check = NS.FIELDS.get(k)
        if check is None or (k == "entity" and v in (None, "") and cat is not None):
            continue
        try:
            check(v)
        except NS.Bad as err:
            return f"{item['id']}.{k}: {err.code}"
    return None


def check_settings(body: Any) -> dict[str, dict[str, Any]]:
    """Mantel's feature settings over DEFAULTS, each value checked (ValueError otherwise)."""
    if body is None:
        body = {}
    if not isinstance(body, Mapping):
        raise ValueError("the feature settings are an object")
    extra = set(body) - set(DEFAULTS)
    if extra:
        raise ValueError(f"unknown pieces {sorted(extra)}; pieces are {list(PIECES)}")
    out = copy.deepcopy(DEFAULTS)
    for piece, v in body.items():
        if not isinstance(v, Mapping):
            raise ValueError(f"{piece}: an object")
        bad = set(v) - set(DEFAULTS[piece])
        if bad:
            raise ValueError(f"{piece}: unknown keys {sorted(bad)}")
        if piece != "ha" and "enabled" in v and not isinstance(v["enabled"], bool):
            raise ValueError(f"{piece}.enabled: true or false")
        out[piece].update(copy.deepcopy(dict(v)))
    n = out["notifications"]
    if not isinstance(n["options"], Mapping):
        raise ValueError("notifications.options: an object")
    if not isinstance(n["items"], list):
        raise ValueError("notifications.items: a list of notifications, each with an id")
    for item in n["items"]:
        if (why := bad_item(item)) is not None:
            raise ValueError(f"notifications.items: {why}")
    lk = out["linked"]
    if lk["entry_id"] is not None and (not isinstance(lk["entry_id"], str) or not _ENTRY.match(lk["entry_id"])):
        raise ValueError("linked.entry_id: HA's hk_frontend entry id (letters, digits, _)")
    if not isinstance(lk["backlight"], bool):
        raise ValueError("linked.backlight: true or false")
    if not isinstance(lk["backlights"], Mapping) or not all(
            isinstance(k, str) and _TID.match(k) and isinstance(e, str) and _LIGHT.match(e)
            for k, e in lk["backlights"].items()):
        raise ValueError("linked.backlights: {tablet id: light.<entity>}")
    for piece in ("clean_areas", "energy"):
        if not isinstance(out[piece]["options"], Mapping):
            raise ValueError(f"{piece}.options: an object")
    tv = out["live_tv"]
    if not isinstance(tv["tuner"], str) or (tv["tuner"] and not (_HOST.match(tv["tuner"]) or _URL.match(tv["tuner"]))):
        raise ValueError("live_tv.tuner: the HDHomeRun's host (or its lineup.json URL)")
    if not isinstance(tv["guide_url"], str) or (tv["guide_url"] and not _URL.match(tv["guide_url"])):
        raise ValueError("live_tv.guide_url: an http(s) URL of an XMLTV file")
    if not isinstance(tv["channels"], list) or not all(isinstance(c, str) and _CHANNEL.match(c) for c in tv["channels"]):
        raise ValueError("live_tv.channels: channel numbers such as \"4.1\"")
    if not isinstance(tv["names"], Mapping) or not all(
            isinstance(k, str) and _CHANNEL.match(k) and isinstance(n, str) and 0 < len(n) <= 40
            for k, n in tv["names"].items()):
        raise ValueError("live_tv.names: {channel number: its name (up to 40 characters)}")
    if tv["quality"] not in ("720", "1080"):
        raise ValueError("live_tv.quality: \"720\" or \"1080\" (the transcode's picture, where Mantel runs Live TV)")
    ha = out["ha"]
    if not isinstance(ha["added"], list) or not all(k in HA_KINDS for k in ha["added"]):
        raise ValueError(f"ha.added: HA's feature kinds ({list(HA_KINDS)})")
    if not isinstance(ha["items"], Mapping) or not all(
            k in HA_KINDS and isinstance(v, list) and all(
                isinstance(i, Mapping) and set(i) <= {"entry_id", "title"} and isinstance(i.get("entry_id"), str)
                and _ENTRY.match(i["entry_id"]) and isinstance(i.get("title", ""), str) for i in v)
            for k, v in ha["items"].items()):
        raise ValueError("ha.items: {kind: [{entry_id, title}]}")
    if ha["source"] is not None and not (isinstance(ha["source"], str) and len(ha["source"]) <= 80):
        raise ValueError("ha.source: where the features were imported from")
    return out


# ------------------------------------------------------------------------------- the feature import
def ha_items(panel: Any) -> dict[str, list[dict[str, str]]]:
    """HA's ``hk_frontend/panel/get`` answer's ``features`` (panel.py _features: {id: {name, kind,
    installed, entries: [{entry_id, title, state}]}}) -> {kind: [{entry_id, title}]}, the added ones."""
    feats = panel.get("features") if isinstance(panel, Mapping) else None
    out: dict[str, list[dict[str, str]]] = {}
    for fid, kind, _name in COMPANIONS:
        f = feats.get(fid) if isinstance(feats, Mapping) else None
        if not isinstance(f, Mapping) or f.get("kind", kind) != kind:
            continue
        got = [{"entry_id": e["entry_id"], "title": str(e.get("title") or "")[:80]}
               for e in f.get("entries") or [] if isinstance(e, Mapping) and isinstance(e.get("entry_id"), str)
               and _ENTRY.match(e["entry_id"])]
        if got:
            out[kind] = got
    return out


def _strs(v: Any, pattern: re.Pattern | None = None) -> list[str]:
    return list(dict.fromkeys(x for x in v if isinstance(x, str) and (pattern is None or pattern.match(x)))) \
        if isinstance(v, list) else []


_ENTITY = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
_AREA = re.compile(r"^[A-Za-z0-9_\-]{1,100}$")


def import_piece(kind: str, page: Any) -> dict[str, Any]:
    """One feature's HK Settings page in HA (its ``<id>/settings/get`` answer) -> Mantel's piece, with
    exactly the stored values the page shows (the item's options and data; nothing worked out at run
    time). A page that says the feature is not set up gives the piece off. Values that would not pass
    check_settings are left out rather than failing the whole import."""
    if not isinstance(page, Mapping) or not page.get("configured"):
        return {"enabled": False}
    if kind == "clean_areas":
        return {"enabled": True, "options": {"vacuums": _strs(page.get("chosen_vacuums"), _ENTITY),
                                             "areas": _strs(page.get("chosen_areas"), _AREA)}}
    if kind == "energy":
        from hk_core.energy.const import OPTION_KEYS
        opts = page.get("options") if isinstance(page.get("options"), Mapping) else {}
        return {"enabled": True, "options": {k: copy.deepcopy(opts[k]) for k in OPTION_KEYS if opts.get(k) is not None}}
    if kind == "notifications":
        from hk_core.notifications.const import ITEM_FIELDS
        opts = page.get("options") if isinstance(page.get("options"), Mapping) else {}
        items = [{k: copy.deepcopy(it[k]) for k in ("id", *ITEM_FIELDS) if it.get(k) is not None}
                 for it in page.get("items") or [] if isinstance(it, Mapping) and isinstance(it.get("id"), str) and it["id"]]
        return {"enabled": True, "options": {k: copy.deepcopy(v) for k, v in opts.items() if v is not None},
                "items": items}
    if kind == "live_tv":
        host, guide = str(page.get("host") or "").strip(), str(page.get("guide_url") or "").strip()
        chans = [c for c in page.get("channels") or [] if isinstance(c, Mapping) and isinstance(c.get("number"), str)
                 and _CHANNEL.match(c["number"])]
        # Mantel's own guide fetch stays off: the screens draw HA's channel cameras and "now playing"
        # sensors (hk_tv/channels, an interim read), and HA's coordinator already reads the guide
        return {"enabled": False, "tuner": host if _HOST.match(host) or _URL.match(host) else "",
                "guide_url": guide if _URL.match(guide) else "",
                "channels": list(dict.fromkeys(c["number"] for c in chans)),
                "names": {c["number"]: c["name"] for c in chans if isinstance(c.get("name"), str) and 0 < len(c["name"]) <= 40},
                "quality": str(page.get("quality")) if str(page.get("quality")) in ("720", "1080") else "720"}
    raise KeyError(kind)


async def import_features(panel: Any, read: Callable[[dict], Awaitable[Any]], current: Any = None,
                          source: str | None = None, live_tv_on: bool = False) -> dict[str, dict[str, Any]]:
    """THE FEATURE IMPORT (MANTEL-FEATURES.md "Exact continuation point" item 3): which HK features HA has
    added (``panel``: its ``hk_frontend/panel/get`` answer) and, for Notifications, Clean Areas, Energy
    and Live TV, their settings (one server-only read each, ``read({"type": ...})``; only for a feature
    HA has added). -> Mantel's feature settings: ``current`` (default: none) with ``ha`` and those four
    pieces replaced; ``linked`` and ``sleep`` are kept. Reads only; never writes to HA."""
    items = ha_items(panel)
    out = check_settings(current)
    out["ha"] = {"added": [k for k in HA_KINDS if k in items], "items": items, "source": source}
    for kind, t in FEATURE_READS.items():
        piece = copy.deepcopy(DEFAULTS[kind])
        if kind in items:
            piece.update(import_piece(kind, await read({"type": t})))
        # where Mantel runs its own go2rtc (live_tv.py), Live TV comes in on: Mantel serves it
        if kind == "live_tv" and live_tv_on and piece.get("tuner"):
            piece["enabled"] = True
        out[kind] = piece
    return check_settings(out)
