"""Phase 4, Mantel's side: hk_core's features running INSIDE Mantel Server (PLAN §0 plan review item 1
(c), §9 Phase 4, §10; docs/phase4/MANTEL-FEATURES.md).

Every feature's DECISIONS are already in ``hk_core`` behind the ``House`` port and run in Home
Assistant through ``HaHouse``. This module is the other host: the same decisions, asked of Mantel's
own House (``house.MantelHouse``: the hub's StateStore and Registry for reads, the command gateway for
service calls) and Mantel's own stores. Nothing here imports ``homeassistant``.

THE PIECES, each off until Mantel's feature settings turn it on (``house/mantel_features`` in the
settings store; ``PUT /api/features/settings``, Owner only). A piece that is off does nothing.

* ``notifications``: follows the hub's state changes; ``hk_core.notifications.banner.goes_off`` says
  what a change sets off; the payload (``banner.build``) goes to every Mantel screen listening on
  ``hk_frontend/events/subscribe`` (the message type HK's page already opens: same shapes, served
  from ``app["read_routes"]``), and Wakes the Screen through the Sleep Screen engines. Mute 1 Hour
  is kept in the settings store (``house/notify_mutes``), so it survives a restart. A notification
  naming a camera carries its snapshot (``notify_snaps.py``: taken through Mantel's own HA credential,
  kept with retention, served by Mantel with RBAC), and the Calendars category looks ahead once a
  minute (``feature_watch.CalendarLook``). HK Settings' feature pages are answered by
  ``feature_pages.py``.
* ``tablets``: All Tablets' alerts (an Important banner) and scheduled restart, each press a gateway
  command (``feature_watch.TabletWatch``).
* ``linked``: the real handler for Phase 5's linked ``hk_frontend`` (``linked.py``'s hook point):
  ``set_black_screen`` acts on Mantel's screens (hk_core's ``Black``, the confirmed handshake: the new
  state is pushed BEFORE the call's answer), ``show_popup`` / ``close_popup`` go to the screens' event
  feed (checked against Mantel's pop-ups: ``unknown_popup``), and each tablet's four entities (black
  screen and photo screensaver switches, screen in use, sleep screen) are published with
  hk_frontend's unique ids (``{HA entry id}_{tablet uid}_{key}``) and kept current from the
  screensaver, tablets and sleep decisions. Opt-in ``backlight``: the forwarded black screen also
  sets the tablet's backlight (its kiosk's ``light.*_screen``, or one named per tablet) through the
  gateway: lowest when black, the carried brightness when woken.
* ``sleep``: a Sleep Screen engine (``hk_core.sleep.engine.Sleep``) per tablet whose Sleep Screen is
  Decided By HK (``hk``; ``shadow`` decides and never acts). Its service calls (the Kiosk Satellite
  screen, screensaver switches, brightness) go through ``MantelHouse.call_service``, so with house
  commands disabled it records what it WOULD have done (``status()["sleep"][tid]["actions"]``, outcome
  ``would``) and sends nothing. Mantel's own black screen and photos are Mantel's state, not house
  commands.
* ``clean_areas``: ``mantel/clean_areas/coverage`` (read) and ``clean_areas_run`` (the page's request;
  each robot's call goes through the gateway AS THE PERSON who asked, as HA runs it in the caller's
  context; with commands off the plan comes back with every robot refused ``commands_disabled``).
* ``energy``: ``mantel/energy/plan`` (read, RBAC feature ``energy``): HA's Energy settings through the
  read proxy (``energy/get_prefs``), the house through MantelHouse, ``hk_core.energy.plan.build``.
* ``live_tv``: ``mantel/live_tv/guide`` (read): the HDHomeRun lineup and XMLTV guide fetched from the
  URLs in the settings (``hooks.fetch``; tests use fakes), parsed by ``hk_core.live_tv_guide``. Where
  Mantel has its own go2rtc (``--go2rtc-url``), live_tv.py serves the whole page from it: the channels,
  their cameras and sensors, the streams and the viewers.

THE SERVICE ACTOR. A feature's own house command (the sleep engine, the linked backlight) goes
through the SAME ``gateway.Gateway`` code path as a person's, as the server's own Service subject
``mantel:features`` (user role ``service``): RBAC first, then the audit row (actor ``mantel:features``,
role ``service``) before anything is sent, then Home Assistant only if ``cfg.commands_enabled``. Its
grants are computed, not stored: ``control`` on exactly the entities the enabled features act on
(each acting tablet's kiosk parts, each linked backlight), nothing else. An Owner's stored deny grant
naming user ``mantel:features`` still wins (explicit deny wins). With commands off the gateway
answers ``commands_disabled`` and writes a ``denied`` / ``not_sent`` audit row: every intended action
is both audited and listed in ``GET /api/features/status``.

Wiring for the orchestrator (``server.py`` is not edited here), after ``linked.register``::

    features.register(app, hub, hooks)      # hooks: the connectors' Hooks (may_read)
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import json
import logging
import re
import time
from collections import deque
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable, Mapping

from aiohttp import web

from hk_core import clean_areas as CA
from hk_core import live_tv_guide as TV
from hk_core.energy import plan as EP
from hk_core.energy.const import CONF_BATTERIES, CONF_DEVICES, CONF_EXTRA, CONF_TOP, CONF_TOTAL, CONF_USAGES
from hk_core.energy.power import BUILT_IN_ART
from hk_core.house import State
from hk_core.notifications import accessories as NA
from hk_core.notifications import banner as NB
from hk_core.notifications import dnd as ND
from hk_core.notifications import rules as NR
from hk_core.notifications import settings as NS
from hk_core.screensaver import rules as SS
from hk_core.screensaver.black import Black
from hk_core.settings import model as SM
from hk_core.sleep import engine as SE

from . import feature_pages, notify_snaps
from . import gateway as G
from .feature_watch import CalendarLook, TabletWatch
from .connectors import Ctx, Forbidden, Route, deny_read, may_feature, read_routes, ws_handlers
from .house import HouseCommandRefused, HouseCommandsDisabled, MantelHouse
from .linked import LinkedError

log = logging.getLogger("mantel.features")

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
    "live_tv": {"enabled": False, "tuner": "", "guide_url": "", "channels": [], "names": {}, "quality": "720"},
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


def _slug(name: str, fallback: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name or "").lower()).strip("_") or fallback


def _user_keys(identity: Any) -> set[str]:
    """The ids a notification's / pop-up's ``users`` may name this viewer by (Mantel's id, the linked
    HA user's id, the username)."""
    u = getattr(identity, "user", None)
    keys = {k for k in (getattr(u, "id", None), getattr(u, "ha_user_id", None), getattr(u, "username", None)) if k}
    if u is None:
        # a wall tablet that is its own HA user (HA App mode, ingress.py): a frame naming that HA user
        # reaches it, as HA's feed reached the tablet signed in as that user
        d = getattr(identity, "device", None)
        keys |= {k for k in (getattr(d, "ha_user_id", None), getattr(d, "ha_name", None)) if k}
    return keys


# ------------------------------------------------------------------------------------ the feed
class Feed:
    """``hk_frontend/events/subscribe`` on Mantel: what the house asks the screens to do (pop-ups,
    notifications, and Mantel's own ``screen`` frames), sent to every listening screen. A frame
    naming ``users`` goes only to those people's sockets, as HA's feed does."""

    def __init__(self) -> None:
        self._subs: dict[int, tuple[Any, Callable[[dict], None]]] = {}
        self._n = 0
        self.sent: deque = deque(maxlen=LOG_KEEP)
        self.taps: list[Callable[[dict], None]] = []   # every frame, besides the screens (push.py: phones)

    def subscribe(self, identity: Any, on_event: Callable[[dict], None]) -> Callable[[], None]:
        self._n += 1
        sid = self._n
        self._subs[sid] = (identity, on_event)
        return lambda: self._subs.pop(sid, None) and None

    @property
    def listeners(self) -> int:
        return len(self._subs)

    def send(self, event: dict) -> int:
        users = event.get("users") or []
        n = 0
        for identity, cb in list(self._subs.values()):
            if users and not (_user_keys(identity) & set(users)):
                continue
            try:
                cb(event)
                n += 1
            except Exception:  # noqa: BLE001 -- one closed screen never stops the others
                log.exception("a screen's event listener failed")
        for tap in list(self.taps):
            try:
                tap(event)
            except Exception:  # noqa: BLE001 -- a push failure never stops the screens'
                log.exception("a feed tap failed")
        self.sent.append({"type": event.get("type"), "at": time.time(), "screens": n,
                          **{k: event.get(k) for k in ("popup", "tablet", "title", "item", "entity") if event.get(k)}})
        return n


@dataclass
class ScreenState:
    """One wall tablet's screen as Mantel holds it: its black (hk_core's ``Black``), its photos, the
    page's last touch and the screensaver's own last touch, and whether it is in use."""
    tid: str
    black: Black = field(default_factory=Black)
    photos: bool = False
    touch: datetime | None = None
    saver_touch: datetime | None = None
    in_use: bool = False


# ------------------------------------------------------------------------- the Service actor
class FeatureAuthz:
    """The app's ``Authz`` with the features' computed grants added for the Service actor only."""

    def __init__(self, base: Any, grants: Callable[[], set[str]]) -> None:
        self.base, self._grants = base, grants

    def __getattr__(self, name: str) -> Any:
        return getattr(self.base, name)

    def policy_for(self, subject: Any) -> Any:
        from .rbac import Grant
        policy = self.base.policy_for(subject)
        if subject.user_id != FEATURE_ACTOR:
            return policy
        extra = tuple(Grant(effect="allow", actions=("control",), resource_kind="entity", resource=eid,
                            users={FEATURE_ACTOR}, note="Mantel features: an entity an enabled feature acts on")
                      for eid in sorted(self._grants()))
        return replace(policy, grants=tuple(policy.grants) + extra)

    def decide(self, subject: Any, action: str, entity_id: str | None, *, feature: str | None = None,
               ctx: Any = None) -> Any:
        return self.policy_for(subject).decide(subject, action, entity_id, ctx or self.base.context(), feature=feature)


class FeatureGateway(G.Gateway):
    """``gateway.Gateway`` itself, sharing the app's audit and its command connection (read at each
    call, so the app's commander -- or none, while commands are off -- is always the one used)."""

    @property
    def commander(self) -> Any:
        gw = self.app.get("gateway")
        return gw.commander if gw is not None else self.app.get("commander")

    @commander.setter
    def commander(self, _value: Any) -> None:
        pass


class FeatureCaller:
    """``MantelHouse.caller``: every service call a feature makes, through the gateway. ``context`` is
    a person's ``Principal`` (Clean Areas: that person's own rights) or a label ("sleep:hall") for
    the Service actor. Every attempt is kept in ``log`` with its outcome: sent / would / refused."""

    def __init__(self, app: web.Application, grants: Callable[[], set[str]]) -> None:
        self.app = app
        self._grants = grants
        self._gw: FeatureGateway | None = None
        self._actor = None
        self._n = 0
        self.log: deque = deque(maxlen=LOG_KEEP)

    def gateway(self) -> FeatureGateway | None:
        if self._gw is None:
            authz, audit = self.app.get("authz"), self.app.get("audit")
            if authz is None or audit is None:
                return None
            gw = self.app.get("gateway")
            writes = gw.writes if gw is not None else G.load_writes()
            self._gw = FeatureGateway(self.app, FeatureAuthz(authz, self._grants), audit, None, writes,
                                      lambda: self.app["clock"]())
        return self._gw

    def actor(self) -> Any:
        from .authz import Principal
        from .sessions import Identity, User
        if self._actor is None:
            ident = Identity(user=User(id=FEATURE_ACTOR, name=FEATURE_ACTOR_NAME, role="service", kind="service"),
                             device=None, door="lan")
            authz = self.app["authz"]
            self._actor = Principal(ident, authz.subject_of(ident))
        return self._actor

    async def __call__(self, domain: str, service: str, data: Mapping[str, Any], context: Any = None) -> Any:
        from .authz import Principal
        gw = self.gateway()
        person = isinstance(context, Principal)
        entry = {"at": time.time(), "action": f"{domain}.{service}", "data": copy.deepcopy(dict(data)),
                 "as": "person" if person else FEATURE_ACTOR, "why": None if person else context}
        self.log.append(entry)
        if gw is None:
            entry["outcome"] = "would"
            raise HouseCommandsDisabled("no command gateway in this app; nothing was sent")
        self._n += 1
        msg = {"type": "command", "id": self._n, "kind": "service", "domain": domain, "service": service,
               "data": dict(data)}
        got: dict = {}

        async def send(reply: dict) -> None:
            got.update(reply)
        await gw.handle(context if person else self.actor(), msg, send)
        entry["audit_id"] = got.get("audit_id")
        if "result" in got:
            entry["outcome"] = "sent"
            return got["result"]
        err = got.get("error") or {}
        if err.get("code") == "unavailable" and err.get("message") == "commands_disabled":
            entry["outcome"] = "would"
            raise HouseCommandsDisabled(audit_id=got.get("audit_id"))
        entry["outcome"], entry["code"] = "refused", err.get("code") or "failed"
        raise HouseCommandRefused(entry["code"], err.get("message") or "", got.get("audit_id"))


class OverlayHouse:
    """The House with Mantel's own tablet entities (photos, black, in use) laid over it: what the Sleep
    Screen reads of them comes from Mantel's screens, everything else from the hub."""

    def __init__(self, house: MantelHouse, own: Callable[[str], State | None]) -> None:
        self._house, self._own = house, own

    def __getattr__(self, name: str) -> Any:
        return getattr(self._house, name)

    def state(self, entity_id: str) -> State | None:
        s = self._own(entity_id)
        return s if s is not None else self._house.state(entity_id)


# -------------------------------------------------------------------------------- the Sleep Screen
class MantelSleep(SE.Sleep):
    """One tablet's Sleep Screen on Mantel: hk_core's decisions; the sleep and the wake as HA's
    sleep_engine.py runs them, with Mantel's own black and photos, and every house call through
    ``MantelHouse.call_service`` (the gateway). Each action and each call's outcome is kept."""

    CONFIRM_S = 4.0          # the page's answer to HK's black
    CONFIRM_LONG_S = 20.0    # ...more time (reconnecting after a restart), then the backlight at its minimum
    KIOSK_WAIT_S = 2.0       # the kiosk reporting its screensaver up / down
    SETTLE_S = 0.9           # a wake's settle
    BACKSTOP_S = 2.0         # the backlight back up
    POLL_S = 0.05

    def __init__(self, host: "FeatureHost", tid: str) -> None:
        SE.Sleep.__init__(self, host.own_house, tid, host.now)
        self.host, self.tid = host, tid
        self.last_action: tuple[str, str] | None = None
        self.actions: deque = deque(maxlen=20)
        self._current: dict | None = None
        self._task: asyncio.Task | None = None
        self._timer: asyncio.TimerHandle | None = None
        self._side: set[asyncio.Task] = set()
        self._recent: list[float] = []
        self._closed = False

    def configure(self, board: dict[str, Any]) -> None:
        self.options(board)
        self.seed_presence()
        self.evaluate()

    def unload(self) -> None:
        self._closed = True
        if self._timer is not None:
            self._timer.cancel()
        if self._task is not None and not self._task.done():
            self._task.cancel()
        for t in list(self._side):
            t.cancel()

    # what Sleep asks of the host
    def _own(self) -> dict[str, str]:
        return self.host.own_ids(self.tid)

    def _page_touch(self) -> datetime | None:
        s = self.host.screens.get(self.tid)
        return s.touch if s else None

    def _saver_touch(self) -> datetime | None:
        s = self.host.screens.get(self.tid)
        return s.saver_touch if s else None

    def notify_wake(self, title: str, seconds: int) -> None:
        SE.Sleep.notify_wake(self, title, seconds)
        self.evaluate()

    # deciding
    def _busy(self) -> bool:
        return bool(self._task and not self._task.done())

    def evaluate(self) -> None:
        if self._closed:
            return
        now = self.clock()
        nxt = self.decide(now)
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if nxt is not None and loop is not None:
            self._timer = loop.call_later(max(0.0, (nxt - now).total_seconds()), self.evaluate)
        self.host.sleep_changed(self.tid)
        if not self.acting or loop is None:
            return
        self._brightness()
        self._quiet_display(now)
        self.reconcile()

    def reconcile(self) -> None:
        if self._closed or self._busy():
            return
        what = self.action()
        if what is None or not self.trusted():
            return
        now = self.host.monotonic()
        ok, self._recent = SE.room_to_act(self._recent, now, SE.ACTIONS_PER_MIN)
        if not ok:
            log.warning("Sleep Screen %s: %d actions in a minute; waiting (want %s, actual %s: %s)",
                        self.tid, len(self._recent), self.want, self.actual, self.reason)
            return
        self._recent.append(now)
        self._task = asyncio.get_running_loop().create_task(self._run(what))

    async def _run(self, what: str) -> None:
        self.last_action = (what, self.clock().isoformat())
        self._current = {"at": self.last_action[1], "what": what, "reason": self.reason, "calls": []}
        self.actions.append(self._current)
        try:
            if what == "sleep":
                await self.sleep(self.power_off_wanted())
            else:
                await self.wake(photos=self.wakes_to_photos())
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("Sleep Screen %s: %s failed", self.tid, what)
        finally:
            self._current = None
            self._task = None
            if not self._closed:
                self.evaluate()

    # acting
    async def _call(self, domain: str, service: str, data: dict[str, Any]) -> None:
        rec = {"call": f"{domain}.{service}", "data": copy.deepcopy(data)}
        own = {v: k for k, v in self._own().items()}
        eid = data.get("entity_id")
        if domain == "switch" and isinstance(eid, str) and own.get(eid) == "photos":
            await self.host.set_photos(self.tid, service == "turn_on")       # Mantel's own photos: no house call
            rec["outcome"] = "mantel"
        else:
            try:
                await asyncio.wait_for(self.house.call_service(domain, service, data, context=f"sleep:{self.tid}"), 10)
                rec["outcome"] = "sent"
            except HouseCommandsDisabled:
                rec["outcome"] = "would"
            except HouseCommandRefused as exc:
                rec["outcome"] = f"refused:{exc.code}"
            except Exception as exc:  # noqa: BLE001 -- continue_on_error, as the house's scripts
                rec["outcome"] = f"failed:{type(exc).__name__}"
        if self._current is not None:
            self._current["calls"].append(rec)
        else:
            self.actions.append({"at": self.clock().isoformat(), "what": "side", "calls": [rec]})

    async def _until(self, test: Callable[[], bool], seconds: float) -> bool:
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if test():
                return True
            await asyncio.sleep(self.POLL_S)
        return test()

    def _black_on(self) -> bool:
        s = self.host.screens.get(self.tid)
        return bool(s and s.black.on)

    def _black_confirmed(self) -> bool:
        """The page said it is black: Mantel's own copy (the page reports to Mantel), else Home Assistant's
        mirror of the black switch. Read only from HA's mirror, the confirmation made a round trip through
        Home Assistant, and a slow one (HA finishing its nightly backup, 05:40, 2026-10-21) timed every
        tablet out at once: each fell back to Kiosk Satellite's own screensaver, which another tablet's
        wake then ended -- the Master Bedroom lit at 05:18 and 05:59."""
        s = self.host.screens.get(self.tid)
        return bool(s and s.black.on and s.black.confirmed) or bool(self._attr(self._own().get("black"), "confirmed"))

    async def sleep(self, power_off: bool) -> None:
        """The house's <room>_tablet_sleep (sleep_engine.Engine.sleep), on Mantel."""
        if self.app_front():
            return
        own, k, t = self._own(), self.kiosk, self.target()
        if own.get("photos"):
            await self._call("switch", "turn_on", {"entity_id": own["photos"]})
        confirmed = dimmed = False
        hk_black = self.board.get("black_screen") == "hk"
        if hk_black:
            # HK'S BLACK, NEVER THE KIOSK'S UNDER IT: Kiosk Satellite's own screensaver ends by itself when
            # another tablet sleeps or wakes (measured on the house 2026-10-21: 2.6-2.8 s later, every time),
            # which lit the Master Bedroom at 05:18 and 05:59. A page slow to confirm (reconnecting after a
            # restart, or HA's mirror lagging) gets more time; one that still has not answered gets its
            # backlight at the minimum instead, so the screen is dark either way.
            await self.host.set_black(self.tid, black=True, brightness=t, why="sleep")
            confirmed = await self._until(self._black_confirmed, self.CONFIRM_S)
            if not confirmed:
                confirmed = await self._until(self._black_confirmed, self.CONFIRM_LONG_S)
            if not confirmed:
                scr = self._st(k.get("screen"))
                if scr is not None and scr.state == "on":
                    await self._call("light", "turn_on", {"entity_id": k["screen"], "brightness": 1})
                    dimmed = True
                log.warning("Sleep Screen %s: the page has not confirmed HK's black; the backlight is at its "
                            "minimum instead (never the kiosk's screensaver under it)", self.tid)
        kiosk_ok = not hk_black                  # the kiosk's screensaver: a kiosk-black tablet's own black
        if kiosk_ok and not confirmed and k.get("active"):
            if k.get("mode") and getattr(self._st(k["mode"]), "state", None) != "Black":
                await self._call("select", "select_option", {"entity_id": k["mode"], "option": "Black"})
            for part in ("armed", "active"):
                if k.get(part):
                    await self._call("switch", "turn_on", {"entity_id": k[part]})
            scr = self._st(k.get("screen"))
            if t is not None and scr is not None and scr.state == "on" and scr.attributes.get("brightness") != t:
                await self._call("light", "turn_on", {"entity_id": k["screen"], "brightness": t})
            up = await self._until(lambda: getattr(self._st(k["active"]), "state", None) == "on", self.KIOSK_WAIT_S)
            if not up and self.want == "dark" and not self.app_front():
                await self._call("switch", "turn_on", {"entity_id": [k[p] for p in ("armed", "active") if k.get(p)]})
        black_up = confirmed or dimmed or getattr(self._st(k.get("active")), "state", None) == "on"
        scr = self._st(k.get("screen"))
        if power_off and black_up and scr is not None and scr.state == "on":
            if own.get("photos"):
                await self._call("switch", "turn_off", {"entity_id": own["photos"]})
            await self._call("light", "turn_off", {"entity_id": k["screen"]})

    async def wake(self, photos: bool = False) -> None:
        """The house's <room>_tablet_wake (sleep_engine.Engine.wake), on Mantel."""
        photo_svc = "turn_on" if photos else "turn_off"
        if self.app_front():
            return
        own, k, t = self._own(), self.kiosk, self.target()
        scr = self._st(k.get("screen"))
        if scr is not None and scr.state == "off":
            data: dict[str, Any] = {"entity_id": k["screen"]}
            if t is not None:
                data["brightness"] = t
            await self._call("light", "turn_on", data)
        if own.get("photos"):
            await self._call("switch", photo_svc, {"entity_id": own["photos"]})
        hk_black = self._black_on() and self.board.get("black_screen") == "hk"
        if self._black_on():
            await self.host.set_black(self.tid, black=False, brightness=t, why="sleep")
        if k.get("active"):
            await self._call("switch", "turn_off", {"entity_id": [k[p] for p in ("active", "armed") if k.get(p)]})
            down = await self._until(lambda: getattr(self._st(k["active"]), "state", None) == "off", self.KIOSK_WAIT_S)
            if not down:
                await self._call("switch", "turn_off", {"entity_id": [k[p] for p in ("active", "armed") if k.get(p)]})
        await asyncio.sleep(self.SETTLE_S)
        if hk_black and k.get("screen") and t is not None and t >= 5:
            lit = await self._until(lambda: (self._attr(k["screen"], "brightness") or 0) >= 5, self.BACKSTOP_S)
            if not lit and getattr(self._st(k["screen"]), "state", None) == "on":
                await self._call("light", "turn_on", {"entity_id": k["screen"], "brightness": t})
        t = self.target()
        scr = self._st(k.get("screen"))
        if t is not None and scr is not None and scr.state == "on" and \
                abs((self._attr(k.get("screen"), "brightness") or 0) - t) > 2:
            await self._call("light", "turn_on", {"entity_id": k["screen"], "brightness": t})
        if self.app_front():
            return
        if own.get("photos"):
            await self._call("switch", photo_svc, {"entity_id": own["photos"]})
        if k.get("front"):
            await self._call("button", "press", {"entity_id": k["front"]})

    def _spawn(self, coro: Awaitable[Any]) -> None:
        task = asyncio.get_running_loop().create_task(coro)
        self._side.add(task)
        task.add_done_callback(self._side.discard)

    def _brightness(self) -> None:
        if self._busy():
            return
        s = self.host.screens.get(self.tid)
        own = self._own()
        step = self.brightness_step((own.get("black"), bool(s and s.black.on)) if own.get("black") else None)
        if step is None:
            return
        where, eid, t = step
        if where == "black":
            self._spawn(self.host.set_black(self.tid, brightness=t, why="sleep"))
        else:
            self._spawn(self._call("light", "turn_on", {"entity_id": eid, "brightness": t}))

    def _quiet_display(self, now: datetime) -> None:
        if self._busy():
            return
        eid = self.quiet_display_off(now)
        if eid:
            self._spawn(self._call("light", "turn_off", {"entity_id": eid}))

    def report(self) -> dict[str, Any]:
        return {"want": self.want, "reason": self.reason, "actual": self.actual,
                "decided_by": self.o.get("decided_by"), "acting": self.acting,
                "attributes": self.attributes(self.last_action), "actions": list(self.actions)}


# ------------------------------------------------------------------------------- notifications
class Notifier:
    """Notifications on Mantel: the hub's changes -> ``banner.goes_off`` -> the screens' feed."""

    def __init__(self, host: "FeatureHost") -> None:
        self.host = host
        self.opts: dict[str, Any] = NB.options({})
        self.items: list[dict[str, Any]] = []
        self.watched: dict[str, list[str]] = {}
        self.cache: dict[str, State | None] = {}
        self.last: dict[str, float] = {}
        self.mutes: dict[str, float] = {}
        self.sent: deque = deque(maxlen=LOG_KEEP)
        self.known: set[str] = set()

    def configure(self, cfg: Mapping[str, Any]) -> None:
        self.opts = NB.options({**dict(cfg.get("options") or {}), "items": list(cfg.get("items") or [])})
        self.items = list(self.opts["items"])
        self.mutes = {k: float(v) for k, v in (self.host.doc(MUTES_DOC).get("mutes") or {}).items()
                      if isinstance(v, (int, float))}
        self.refresh()

    def refresh(self) -> None:
        h = self.host.house
        self.watched = {str(it["id"]): list(NA.members(h, it)) for it in self.items if it.get("id")}
        ids = set().union(*self.watched.values()) if self.watched else set()
        self.cache = {eid: h.state(eid) for eid in ids}
        # what the categories were worked out from: a state for anything else (the first states after a start
        # or a reconnect, which come after the registries; a new device) works them out again (on_change)
        self.known = set(self.host.hub.store.states)

    def on_change(self, changed: set[str]) -> None:
        if not self.host.on("notifications"):
            return
        h = self.host.house
        states = self.host.hub.store.states
        if any(eid in states and eid not in self.known for eid in changed):
            # A category's members depend on states (a door sensor is a door by its device_class), and Mantel
            # reads the registries before the first states: worked out then, Doors, Leaks and Smoke stayed
            # empty after every restart. A state just seen is a first state, not a change: nothing fires; one
            # already watched keeps its old state, so its change in the same batch still does.
            before = self.cache
            self.refresh()
            for eid, st in before.items():
                if eid in self.cache:
                    self.cache[eid] = st
        for eid in sorted(changed & set(self.cache)):
            old, new = self.cache.get(eid), h.state(eid)
            self.cache[eid] = new
            fired = NB.goes_off(h, self.items, self.watched, eid, old, new, last=self.last, mute=self.mutes,
                                now=self.host.monotonic(), epoch=self.host.epoch())
            for item in fired:
                self.deliver(item, new, eid)

    def deliver(self, item: dict[str, Any], new: State | None, eid: str) -> dict[str, Any]:
        payload = NB.build(self.host.house, self.opts, item, new, eid=eid)
        if payload.get("camera") and self.host.can_snap():
            self.host.spawn(self.send(payload, item.get("id"), eid))     # the snapshot first, as HA's
        else:
            self._out(payload, item.get("id"), eid)
        return payload

    async def send(self, payload: dict[str, Any], item_id: Any, eid: Any) -> dict[str, Any]:
        """One notification out the one way (HA's async_deliver): the camera's snapshot taken first
        (notify_snaps.py; its id is the payload's ``snap``), then the screens' feed, then the wake."""
        if payload.get("camera") and payload.get("snap") is None and self.host.can_snap():
            payload["snap"] = await self.host.take_snapshot(str(payload["camera"]))
        self._out(payload, item_id, eid)
        return payload

    def _out(self, payload: dict[str, Any], item_id: Any, eid: Any) -> None:
        h = self.host.house
        screens = self.host.feed.send(payload)
        woke = []
        if payload["wake"]:
            secs, now = NB.wake_for(int(payload["stay"])), self.host.now()
            for tid, eng in list(self.host.engines.items()):
                board = self.host.boards.get(tid) or {}
                # each screen's own Do Not Disturb, else All Screens' (HA's wake_screens: notify_dnd or dnd)
                if not board.get("notify", True) or (
                        not payload["important"] and ND.dnd_on(h, board.get("notify_dnd") or self.opts.get("dnd"), now)):
                    continue
                eng.notify_wake(payload["title"], secs)
                woke.append(tid)
        self.sent.append({"at": time.time(), "item": item_id, "entity": eid, "title": payload["title"],
                          "message": payload["message"], "screens": screens, "woke": woke,
                          "snap": payload.get("snap")})
        self.host.to_phones(payload)

    def set_mute(self, key: str, seconds: int, actor: Any = None) -> float | None:
        until = NB.set_mute(self.mutes, key, seconds, self.host.epoch())
        NB.mutes(self.mutes, self.host.epoch())
        self.host.write_doc(MUTES_DOC, {"mutes": dict(self.mutes)}, actor, "notify_mute")
        return until


# ------------------------------------------------------------------------------------- linked
class FeatureLinked:
    """``linked.py``'s handler hook: the forwarded calls act on Mantel's screens (LINKED-MODE.md)."""

    def __init__(self, host: "FeatureHost") -> None:
        self.host = host
        self.calls: deque = deque(maxlen=LOG_KEEP)

    def _need_on(self) -> None:
        if not self.host.on("linked"):
            raise LinkedError("not_set_up", "linked mode's features are off in Mantel's feature settings")

    async def call_service(self, service: str, data: dict[str, Any], targets: list[dict[str, str]], ctx: Any) -> Any:
        self._need_on()
        self.calls.append({"at": time.time(), "service": service, "data": copy.deepcopy(data),
                           "targets": [t["entity_id"] for t in targets]})
        host = self.host
        if service in ("show_popup", "close_popup"):
            hash_ = str(data["popup"]).strip().lstrip("#").lower()
            if service == "show_popup":
                known = host.popup_hashes()
                if hash_ not in known:
                    raise LinkedError("unknown_popup", f"No pop-up #{hash_} in Mantel's pop-ups (known: "
                                      + (", ".join("#" + k for k in sorted(known)) or "none") + ")")
            event = {"type": "popup" if service == "show_popup" else "popup_close", "popup": hash_,
                     "dashboards": [str(d).strip("/") for d in data.get("dashboards") or []],
                     "users": [str(u) for u in data.get("users") or []]}
            return {"service": service, "popup": hash_, "screens": host.feed.send(event)}
        out = {}
        for t in targets:
            tid, key = host.linked_index.get(t["unique_id"], (None, None))
            if tid is None or key != SS.BLACK_KEY:
                raise LinkedError("not_a_black_screen", f"{t['entity_id']} is not a black screen switch")
            if not host.mantel_owns(tid):
                raise LinkedError("not_owned", f"{t['entity_id']}'s tablet is Home Assistant's, not Mantel's")
            on = await host.set_black(tid, black=data.get("black"), brightness=data.get("brightness"), why="linked")
            out[t["entity_id"]] = {"on": on}
        return out

    async def entity_command(self, unique_id: str, command: str, data: dict[str, Any], ctx: Any) -> Any:
        self._need_on()
        host = self.host
        self.calls.append({"at": time.time(), "command": command, "unique_id": unique_id})
        tid, key = host.linked_index.get(unique_id, (None, None))
        scr = host.screen(tid) if tid else None
        if scr is None or key not in (SS.BLACK_KEY, SS.SWITCH_KEY):
            raise LinkedError("not_supported", f"{command} is not handled by this Mantel Server yet")
        now_on = scr.black.on if key == SS.BLACK_KEY else scr.photos
        on = {"turn_on": True, "turn_off": False}.get(command, not now_on)
        if key == SS.BLACK_KEY:
            await host.set_black(tid, black=on, why="linked")
        else:
            await host.set_photos(tid, on)
        return {"on": on}

    async def page_says(self, unique_id: str, black: bool) -> bool:
        tid, _key = self.host.linked_index.get(unique_id, (None, None))
        return await self.host.page_says(tid, black) if tid else False


# ------------------------------------------------------------------------------------ live TV
async def http_fetch(app: web.Application, url: str, timeout: float = 60.0) -> bytes:
    """GET a configured URL (the tuner's lineup, the XMLTV guide), at most MAX_FETCH bytes."""
    import aiohttp
    session = app.get("http")
    own = session is None
    session = session or aiohttp.ClientSession()
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout)) as r:
            r.raise_for_status()
            data = bytearray()
            async for chunk in r.content.iter_chunked(262144):
                data += chunk
                if len(data) > MAX_FETCH:
                    raise ValueError("file too large")
            return bytes(data)
    finally:
        if own:
            await session.close()


class LiveTv:
    """The Live TV guide on Mantel: the tuner's lineup and the XMLTV guide, refreshed every 30 min."""

    def __init__(self, host: "FeatureHost") -> None:
        self.host = host
        self.lineup: list[dict[str, Any]] = []
        self.guide: dict[str, Any] = {}
        self.fetched_at: str | None = None
        self.error: str | None = None

    async def refresh(self) -> None:
        cfg = self.host.settings["live_tv"]
        fetch = self.host.fetch
        try:
            if cfg["tuner"]:
                url = cfg["tuner"] if cfg["tuner"].startswith(("http://", "https://")) else f"http://{cfg['tuner']}/lineup.json"
                data = json.loads(await fetch(url))
                self.lineup = [{"number": c.get("GuideNumber"), "name": c.get("GuideName") or "", "hd": bool(c.get("HD")),
                                "url": c.get("URL") if isinstance(c.get("URL"), str) else None}
                               for c in data if isinstance(c, dict) and c.get("GuideNumber")]
            numbers = set(cfg["channels"]) or {c["number"] for c in self.lineup} or None
            if cfg["guide_url"]:
                raw = await fetch(cfg["guide_url"])
                self.guide = await asyncio.to_thread(TV.parse_xmltv, raw, numbers, self.host.now())
            self.fetched_at, self.error = self.host.now().isoformat(), None
        except Exception as exc:  # noqa: BLE001 -- a guide that cannot be read is reported, not fatal
            self.error = f"{type(exc).__name__}: {exc}"[:300]
            log.warning("Live TV guide not refreshed: %s", self.error)

    def channels(self) -> dict[str, Any]:
        cfg = self.host.settings["live_tv"]
        now = self.host.now()
        names = {**{c["number"]: c["name"] for c in self.lineup}, **cfg["names"]}   # a name of the house's own wins
        numbers = list(cfg["channels"]) or [c["number"] for c in self.lineup] or sorted(self.guide)
        out = []
        for n in numbers:
            g = self.guide.get(n) or {}
            cur, nxt = TV.now_next(g.get("programmes") or [], now)
            out.append({"number": n, "name": names.get(n, ""), "logo": g.get("logo"), "network": g.get("network"),
                        "now": cur, "next": nxt})
        return {"configured": bool(cfg["tuner"] or cfg["guide_url"]), "channels": out,
                "fetched_at": self.fetched_at, "error": self.error}


# ------------------------------------------------------------------------------------- energy
def energy_context(house: Any, prefs: Mapping[str, Any] | None, options: Mapping[str, Any] | None,
                   settings: Mapping[str, Any] | None = None,
                   sources: Mapping[str, str] | None = None) -> dict[str, Any]:
    """What ``hk_core.energy.plan.build`` reads, from Mantel's house (HA's ``collect`` over the port).
    A helper's source (a Utility Meter's Integral, and its power sensor): `sources`, HK's read in HA
    (``hk_energy/sources``: HA's own collect() reads the sensors' objects, which Utility Meters need -- they
    publish no `source` attribute), else the state's `source` attribute (an Integral sensor has one)."""
    options = dict(options or {})
    settings = dict(settings or {})
    entities: dict[str, dict[str, Any]] = {}

    def info(eid: Any) -> dict[str, Any] | None:
        if not isinstance(eid, str) or "." not in eid:
            return None
        if eid in entities:
            return entities[eid]
        st, ent = house.state(eid), house.entity(eid)
        attrs = st.attributes if st else {}
        # A HELPER'S SOURCE: a Utility Meter and an Integral (Riemann sum) sensor say what they count in
        # their `source` attribute; HA's collect() reads it from the sensor's own object. Without it the
        # chain meter -> Integral -> power sensor was never followed here, every device lost its watts and
        # the Energy page's "Where it's going now" drew 0 W everywhere (the house, 2026-10-18).
        src = (sources or {}).get(eid) or (attrs.get("source") if eid.startswith("sensor.") else None)
        entities[eid] = {"name": attrs.get("friendly_name") or eid, "device": ent.device_id if ent else None,
                         "dc": attrs.get("device_class") or (ent and (ent.device_class or ent.original_device_class)),
                         "unit": attrs.get("unit_of_measurement"), "state": st.state if st else None,
                         "source": src if isinstance(src, str) and "." in src else None,
                         "category": bool(ent and ent.entity_category), "platform": ent.platform if ent else None}
        return entities[eid]

    def device_mates(eid: str, domains=("sensor", "switch")) -> None:
        e = info(eid)
        if e and e.get("device"):
            for x in house.device_entities(e["device"]):
                if x.entity_id.split(".")[0] in domains and not x.disabled:
                    info(x.entity_id)

    stats: list[str] = []
    for src in (prefs or {}).get("energy_sources") or []:
        stats += [src[k] for k in ("stat_energy_from", "stat_cost", "stat_rate", "stat_soc", "entity_energy_price")
                  if isinstance(src.get(k), str)]
        for f in src.get("flow_from") or []:
            stats += [f[k] for k in ("stat_energy_from", "stat_cost", "entity_energy_price") if isinstance(f.get(k), str)]
    for d in (prefs or {}).get("device_consumption") or []:
        stats += [d[k] for k in ("stat_consumption", "stat_rate", "included_in_stat") if isinstance(d.get(k), str)]
    for x in options.get(CONF_EXTRA) or []:
        stats += [x[k] for k in ("stat", "power") if isinstance(x, dict) and isinstance(x.get(k), str)]
    for x in (options.get(CONF_DEVICES) or {}).values():
        stats += [x[k] for k in ("power", "control") if isinstance(x, dict) and isinstance(x.get(k), str)]
    for x in options.get(CONF_USAGES) or []:
        stats += [x[k] for k in ("entity", "stat") if isinstance(x, dict) and isinstance(x.get(k), str)]
    for x in options.get(CONF_BATTERIES) or []:
        stats += [x[k] for k in ("entity", "label") if isinstance(x, dict) and isinstance(x.get(k), str)]
    stats += [v for v in (options.get(CONF_TOTAL) or {}).values() if isinstance(v, str) and v]
    stats += [v for v in (options.get(CONF_TOP) or []) if isinstance(v, str)]
    stats += [t for t in settings.get("thermostats") or [] if isinstance(t, str)]
    stats += [settings[k] for k in ("outside", "power") if isinstance(settings.get(k), str)]
    for s in stats:
        e = info(s)
        device_mates(s)
        # the source chain, followed now so build() can walk it (as HA's collect does): each sensor in it,
        # and what sits on its device (a smart plug's watts beside the kWh a Utility Meter counts)
        hops = 0
        while e and e.get("source") and hops < 4:
            device_mates(e["source"])
            e = info(e["source"])
            hops += 1
    grid = EP.grid_of(prefs)
    if grid.get("stat") and house.state(f"{grid['stat']}_cost") is not None:
        info(f"{grid['stat']}_cost")
    vehicles: list[str] = []
    for st in house.states("sensor"):
        if st.attributes.get("device_class") != "battery":
            continue
        ent = house.entity(st.entity_id)
        if not ent or not ent.device_id or ent.entity_category or ent.hidden or ent.disabled:
            continue
        rng = [x.entity_id for x in house.device_entities(ent.device_id)
               if x.entity_id.startswith("sensor.") and "range" in x.entity_id and not x.disabled
               and house.state(x.entity_id) is not None
               and house.state(x.entity_id).attributes.get("device_class") == "distance"]
        if rng:
            vehicles.append(st.entity_id)
            info(st.entity_id)["range"] = sorted(rng, key=len)[0]
            info(sorted(rng, key=len)[0])
    for eid in [e for e in list(entities) if e.startswith("switch.")]:
        st = house.state(eid)
        mem = st.attributes.get("entity_id") if st else None
        if isinstance(mem, (list, tuple)) and mem:
            entities[eid]["members"] = [m for m in mem if isinstance(m, str)]
            for m in entities[eid]["members"]:
                info(m)
    soc = EP.battery_of(prefs).get("soc")
    if soc and info(soc) and info(soc).get("device"):
        for x in house.device_entities(info(soc)["device"]):
            st = house.state(x.entity_id)
            if st and st.attributes.get("device_class") == "energy_storage":
                info(soc)["stored"] = x.entity_id
                info(x.entity_id)
                break
    areas = {a: {"name": house.area_name(a), "icon": None} for a in sorted(house.area_ids())}
    return {"prefs": dict(prefs or {}), "entities": entities, "areas": areas,
            "thermostats": [t for t in settings.get("thermostats") or [] if isinstance(t, str)],
            "outside": settings.get("outside") or None, "house_power": settings.get("power") or None,
            "vehicles": sorted(vehicles)}


def found_thermostats(house: Any, settings: Mapping[str, Any]) -> list[str]:
    """Status & Chips' thermostats as HA's kinds.resolve finds them (hk_frontend/kinds.py), for the
    Energy page's plan: every climate entity, less hidden, disabled, config/diagnostic ones and groups,
    less Leave out (``generated``: entities, devices, areas); then a saved ``counts.thermostats``
    (exclude / include), else the older ``features.thermostats`` list; then an accessory whose
    "Include in status" is off is taken out."""
    from hk_core.house import area_of
    from hk_core.settings.kinds import clean
    states = {s.entity_id: s for s in house.states("climate")}
    lo = settings.get("generated") if isinstance(settings.get("generated"), Mapping) else {}
    x_ent, x_dev, x_area = (set(lo.get(k) or []) for k in ("exclude_entities", "exclude_devices", "exclude_areas"))
    auto = []
    for eid, st in sorted(states.items()):
        ent = house.entity(eid)
        if ent is not None and (ent.hidden or ent.disabled or ent.entity_category):
            continue
        if any(isinstance(st.attributes.get(k), list) for k in ("entity_id", "group_entities")):
            continue
        area = area_of(house, ent)
        if eid in x_ent or (ent and ent.device_id in x_dev) or (area and area in x_area):
            continue
        auto.append(eid)
    saved = clean((settings.get("counts") or {}).get("thermostats") if isinstance(settings.get("counts"), Mapping) else None)
    if saved is None:
        old = (settings.get("features") or {}).get("thermostats") if isinstance(settings.get("features"), Mapping) else None
        old = [e for e in old if isinstance(e, str)] if isinstance(old, list) else []
        out = [e for e in old if e in states] if old else auto
    else:
        drop = set(saved["exclude"])
        out = [e for e in auto if e not in drop]
        out += sorted(e for e in saved["include"] if e in states and e not in out and e not in drop)
    acc = ((settings.get("accessories") or {}).get("entities") or {}) if isinstance(settings.get("accessories"), Mapping) else {}
    return [e for e in out if not (isinstance(acc.get(e), Mapping) and acc[e].get("status") is False)]


def energy_house(house: Any, settings: Mapping[str, Any]) -> dict[str, Any]:
    """What HA's plan borrows from the house's settings (features/energy house()): Status & Chips'
    thermostats, the outside temperature and Power Use."""
    feats = settings.get("features") if isinstance(settings.get("features"), Mapping) else {}
    weather = settings.get("weather") if isinstance(settings.get("weather"), Mapping) else {}
    return {"thermostats": found_thermostats(house, settings), "outside": weather.get("outside"),
            "power": feats.get("power")}


# ---------------------------------------------------------------------------------- the host
@dataclass
class FeatureHooks:
    """What the orchestrator passes. may_read: the connectors' RBAC read hook (energy needs feature
    ``energy``); fetch(url) -> bytes for Live TV (default: an HTTP GET); now() -> an aware datetime and
    monotonic() -> seconds (tests freeze them)."""
    may_read: Callable[..., Any] = deny_read
    fetch: Callable[[str], Awaitable[bytes]] | None = None
    now: Callable[[], datetime] | None = None
    monotonic: Callable[[], float] | None = None
    tick: float = 60.0
    # notification snapshots (notify_snaps.py): Mantel's own HA credential (the connectors' ha_token), or
    # take_snapshot(camera) -> (bytes, content type) | None in tests; neither: no snapshots
    ha_token: Callable[[], str] | None = None
    take_snapshot: Callable[[str], Awaitable[tuple[bytes, str] | None]] | None = None

    @classmethod
    def coerce(cls, hooks: Any) -> "FeatureHooks":
        if hooks is None:
            return cls()
        if isinstance(hooks, cls):
            return hooks
        if isinstance(hooks, Mapping):
            names = set(cls.__dataclass_fields__)
            return cls(**{k: v for k, v in hooks.items() if k in names})
        return cls(may_read=getattr(hooks, "may_read", deny_read),      # the connectors' shared Hooks
                   ha_token=getattr(hooks, "ha_token", None))


class FeatureHost:
    """hk_core's features on Mantel (see the module docstring). ``app["features"]``."""

    def __init__(self, app: web.Application, hub: Any, hooks: FeatureHooks) -> None:
        self.app, self.hub, self.hooks = app, hub, hooks
        self._publishing = False                     # inside _sync_client's own settings-feed publish
        self.caller = FeatureCaller(app, self.acting_entities)
        self.house = MantelHouse(hub.store, hub.registry, tz=self._tz, caller=self.caller, now=self.now)
        self.own_house = OverlayHouse(self.house, self.own_state)
        self.feed = Feed()
        self.screens: dict[str, ScreenState] = {}
        self.settings: dict[str, dict[str, Any]] = copy.deepcopy(DEFAULTS)
        self.settings_error: str | None = None
        self.tablets: dict[str, dict[str, Any]] = {}
        self.boards: dict[str, dict[str, Any]] = {}
        self.engines: dict[str, MantelSleep] = {}
        self.notifier = Notifier(self)
        self.linked = FeatureLinked(self)
        self.tv = LiveTv(self)
        cfg = app.get("cfg")
        folder = (Path(cfg.data_dir).expanduser() / notify_snaps.FOLDER) if getattr(cfg, "data_dir", None) else None
        self.snaps = notify_snaps.SnapStore(folder, clock=self.epoch)
        self.calendars = CalendarLook(self)
        self.tablet_watch = TabletWatch(self)
        self.pages: feature_pages.FeaturePages | None = None
        self.linked_index: dict[str, tuple[str, str]] = {}     # unique id -> (tablet, key)
        self._own_index: dict[str, tuple[str, str]] = {}       # entity id -> (tablet, role)
        self._published: set[str] = set()
        self._last_push: dict[str, tuple] = {}
        self._followed: dict[str, str | None] = {}
        self._in_use_timers: dict[str, asyncio.TimerHandle] = {}
        self._tasks: set[asyncio.Task] = set()
        self._reload_lock = asyncio.Lock()
        self._feed_unsub: Callable[[], None] | None = None
        self.started = False
        # what the screens are told (the settings feed's `added` and `energy`): the Energy page's plan as
        # last worked out, and the pair last published
        self.energy_cache: dict[str, Any] | None = None
        self.energy_error: str | None = None
        self._helper_sources: dict[str, str] = {}      # the last good hk_energy/sources answer
        self._helper_sources_warned = False
        self._art_warned: set[str] = set()             # picture folders already said to be missing (servable_art)
        self._energy_at = float("-inf")
        self._client_sent: tuple | None = None
        # hk_clean_areas/subscribe: id -> [identity, on_event, last body sent]
        self._area_subs: dict[int, list] = {}
        self._area_n = 0

    # -- clocks and settings ------------------------------------------------------------------------
    def now(self) -> datetime:
        return self.hooks.now() if self.hooks.now else datetime.now(timezone.utc)

    def epoch(self) -> float:
        return self.now().timestamp()

    def monotonic(self) -> float:
        return self.hooks.monotonic() if self.hooks.monotonic else time.monotonic()

    def _tz(self) -> str:
        authz = self.app.get("authz")
        if authz is not None and getattr(authz, "tz", None):
            return authz.tz
        cfg = self.app.get("cfg")
        return getattr(cfg, "house_tz", "UTC") or "UTC"

    @property
    def commands_enabled(self) -> bool:
        return bool(getattr(self.app.get("cfg"), "commands_enabled", False))

    async def fetch(self, url: str) -> bytes:
        if self.hooks.fetch is not None:
            return await self.hooks.fetch(url)
        return await http_fetch(self.app, url)

    @property
    def store(self) -> Any:
        svc = self.app.get("settings")
        if svc is not None:
            return svc.store
        if "_feature_settings_store" not in self.app:
            from .settings_store import SettingsStore
            self.app["_feature_settings_store"] = SettingsStore(self.app["store"].db, lambda: self.app["clock"]())
        return self.app["_feature_settings_store"]

    def doc(self, key: str) -> dict:
        return self.store.body("house", key)

    def write_doc(self, key: str, body: dict, identity: Any = None, message: str = "features") -> None:
        from .settings_store import Actor, actor_of
        actor = actor_of(identity) if identity is not None else Actor(label="mantel-features")
        self.store.write([("house", key, body)], actor=actor, message=message)

    def to_phones(self, payload: dict[str, Any]) -> None:
        """The same notification to the phones of the people it is for (phones.py; Mantel Link and the
        Companion app), in the background: the screens never wait for it."""
        ph = self.app.get("phones")
        if ph is not None:
            self.spawn(ph.deliver(dict(payload)))

    def on(self, piece: str) -> bool:
        return bool(self.settings.get(piece, {}).get("enabled"))

    def stored(self) -> SM.Stored:
        from .settings_store import stored_of
        return stored_of(self.store)

    def popup_hashes(self) -> set[str]:
        return {str(p.get("hash")) for p in self.doc("popups").get("items") or [] if isinstance(p, dict) and p.get("hash")}

    def entry_id(self) -> str | None:
        """HA's hk_frontend entry id the linked entities' unique ids start with: the settings, else the
        settings import's source (``ha:<entry id>``), else (no HK Frontend ever) Mantel's instance id."""
        got = self.settings["linked"].get("entry_id")
        if got:
            return got
        rec = self.store.import_record() or {}
        src = str(rec.get("source") or "")
        if src.startswith("ha:") and _ENTRY.match(src[3:]):
            return src[3:]
        # a house that never had HK Frontend (Mantel Link alone, docs/phase9/MANTEL-LINK.md): Mantel's own
        # instance id, so its unique ids are still stable and its own
        lk = self.app.get("linked")
        inst = getattr(lk, "instance", None) if lk is not None else None
        return inst if isinstance(inst, str) and _ENTRY.match(inst) else None

    # -- the tablets' own entities -------------------------------------------------------------------
    def screen(self, tid: str | None) -> ScreenState | None:
        if tid is None or tid not in self.tablets:
            return None
        return self.screens.setdefault(tid, ScreenState(tid))

    def own_ids(self, tid: str) -> dict[str, str]:
        t = self.tablets.get(tid)
        if t is None:
            return {}
        obj = _slug(t["name"], tid)
        return {"photos": f"switch.{obj}_{SS.SWITCH_KEY}", "black": f"switch.{obj}_{SS.BLACK_KEY}",
                "in_use": f"binary_sensor.{obj}_{SS.INUSE_KEY}"}

    def own_state(self, entity_id: str) -> State | None:
        hit = self._own_index.get(entity_id)
        if hit is None:
            return None
        tid, role = hit
        s = self.screen(tid)
        if s is None:
            return None
        if role == "black":
            return State(entity_id, "on" if s.black.on else "off", s.black.attributes(self.boards.get(tid) or {}))
        if role == "photos":
            return State(entity_id, "on" if s.photos else "off", {})
        return State(entity_id, "on" if s.in_use else "off", {})

    def acting_entities(self) -> set[str]:
        """The entities the Service actor may control: what the enabled features act on, nothing else."""
        out: set[str] = set()
        if self.on("sleep"):
            for eng in self.engines.values():
                if eng.acting:
                    out |= {e for e in eng.kiosk.values() if e.split(".", 1)[0] in KIOSK_DOMAINS}
        if self.on("linked") and self.settings["linked"]["backlight"]:
            for tid in self.tablets:
                if not self.mantel_owns(tid):
                    continue
                eid = self.backlight_of(tid)
                if eid:
                    out.add(eid)
        out |= self.tablet_watch.grants()          # the scheduled restart's buttons, while it is on
        return out

    def mantel_owns(self, tid: str) -> bool:
        """Linked mode's per-tablet ownership (linked_owners.py): Mantel acts for, publishes and answers
        for a tablet only once an Owner moved it to Mantel. Default (no row, or no ownership at all):
        Home Assistant's, so HA's own engines keep it and Mantel never drives the same kiosk."""
        owners = self.app.get("linked_owners")
        return owners is not None and owners.owns(tid)

    def backlight_of(self, tid: str) -> str | None:
        named = self.settings["linked"]["backlights"].get(tid)
        if named:
            return named
        t = self.tablets.get(tid) or {}
        kiosk = (t.get("sleep") or {}).get("kiosk") or ""
        return SE.kiosk_parts(self.house, kiosk).get("screen") if kiosk else None

    # -- loading -------------------------------------------------------------------------------------
    async def reload(self) -> None:
        """Read the feature settings and the tablets again, and bring every piece in line."""
        async with self._reload_lock:
            try:
                self.settings, self.settings_error = check_settings(self._usable(self.doc(FEATURES_DOC))), None
            except ValueError as exc:
                self.settings, self.settings_error = copy.deepcopy(DEFAULTS), str(exc)
                log.error("Mantel's feature settings are unreadable (%s); every feature is off", exc)
            stored = self.stored()
            self.tablets = SM.tablets(stored)
            boards = SM.boards(SM.Stored(stored.options, stored.items + (SM.Item(SM.SUBENTRY_DASHBOARD, "__none__", {}),)))
            default = boards.pop("__none__")
            self.boards = {tid: SS.as_board(t, boards.get(t["screen"]) or default) for tid, t in self.tablets.items()}
            self._own_index = {eid: (tid, role) for tid in self.tablets for role, eid in self.own_ids(tid).items()}
            for tid in list(self.screens):
                if tid not in self.tablets:
                    del self.screens[tid]
            self.notifier.configure(self.settings["notifications"])
            self._sleep_engines()
            await self._sync_linked()
            # the screens: a feature turned on or off changes their pages (the settings feed's `added`),
            # and the Energy page's plan and the areas on offer follow the settings and the registries
            if not self.on("energy"):
                self.energy_cache = None
            self._sync_client()
            self.spawn(self.refresh_energy())
            self.spawn(self.push_areas())

    @staticmethod
    def _usable(doc: Any) -> Any:
        """The stored document without a notification it can't use (one saved before the items were checked):
        that one is left out, with an error in the log, rather than every feature turned off."""
        n = doc.get("notifications") if isinstance(doc, Mapping) else None
        items = n.get("items") if isinstance(n, Mapping) else None
        if not isinstance(items, list):
            return doc
        keep = []
        for item in items:
            why = bad_item(item)
            if why is None:
                keep.append(item)
            else:
                log.error("notifications: one is left out until it is saved again (%s)", why)
        return doc if len(keep) == len(items) else {**doc, "notifications": {**n, "items": keep}}

    def _sleep_engines(self) -> None:
        want = {tid for tid, b in self.boards.items()
                if self.on("sleep") and SS.deciding(b) and self.mantel_owns(tid)}
        for tid in list(self.engines):
            if tid not in want:
                self.engines.pop(tid).unload()
        for tid in want:
            key = SS.engine_key(self.boards[tid], self.own_ids(tid))
            eng = self.engines.get(tid)
            if eng is not None and getattr(eng, "_key", None) == key:
                # the kiosk's entities come from HA's registries, which can arrive after the engine was made
                # (an App start): follow them, or the engine never finds the display to turn off or the
                # kiosk's Black screensaver (every tablet after 0.1.29's start, 2026-10-19)
                parts = SE.kiosk_parts(self.house, eng.o.get("kiosk") or "")
                if parts != eng.kiosk:
                    log.info("Sleep Screen %s: its kiosk's entities now %s", tid, ", ".join(sorted(parts.values())) or "none")
                    eng.kiosk = parts
                continue
            if eng is not None:
                eng.unload()
            eng = MantelSleep(self, tid)
            eng._key = key
            self.engines[tid] = eng
            eng.configure(self.boards[tid])
        self._followed = {}
        for eng in self.engines.values():
            for eid in eng.listens():
                if eid not in self._own_index:
                    st = self.house.state(eid)
                    self._followed[eid] = st.state if st is not None else None

    # -- the hub's changes -----------------------------------------------------------------------------
    def on_change(self, changed: set[str]) -> None:
        """The hub's StateStore changed (chained after HaClient's own callback)."""
        try:
            self.notifier.on_change(changed)
        except Exception:  # noqa: BLE001 -- notifications' bug never keeps the Sleep Screen from hearing states
            log.exception("features: notifications failed on a state change")
        try:
            for eng in list(self.engines.values()):
                hit = [e for e in eng.listens() if e in changed and e in self._followed]
                for eid in hit:
                    st = self.house.state(eid)
                    new = st.state if st is not None else None
                    eng.display_changed(eid, self._followed.get(eid), new, False)    # contexts are not kept
                    self._followed[eid] = new
                if hit:
                    eng.evaluate()
            # a vacuum that appears, goes or changes what it can do changes the areas on offer (HA's
            # subscribe follows the vacuums' registry entries; each screen is sent only a real change)
            if self._area_subs and any(e.startswith("vacuum.") for e in changed):
                self.spawn(self.push_areas())
        except Exception:  # noqa: BLE001 -- a feature's bug never breaks the hub's own callback
            log.exception("features: a state change failed")

    def on_registry(self) -> None:
        self.spawn(self.reload())

    def spawn(self, coro: Awaitable[Any]) -> asyncio.Task | None:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            if asyncio.iscoroutine(coro):
                coro.close()
            return None
        task = loop.create_task(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    # -- screens: black, photos, touches ---------------------------------------------------------------
    async def set_black(self, tid: str, *, black: bool | None = None, brightness: int | None = None,
                        why: str = "") -> bool:
        """A tablet's black screen (hk_core's ``Black``): told to the screens, pushed to linked HA
        BEFORE this returns (the confirmed handshake), and (linked + backlight) the backlight."""
        s = self.screen(tid)
        if s is None:
            return False
        if brightness is not None:
            s.black.brightness = int(brightness)
        if black is not None:
            s.black.set(bool(black))
        self.feed.send({"type": "screen", "tablet": tid, "black": s.black.on, "brightness": s.black.brightness,
                        "confirmed": s.black.on and s.black.confirmed, "dashboards": [], "users": []})
        await self.push_tablet(tid, only=SS.BLACK_KEY)
        if why == "linked" and black is not None and self.settings["linked"]["backlight"]:
            self.spawn(self._backlight(tid, bool(black), s.black.brightness))
        eng = self.engines.get(tid)
        if eng is not None and why != "sleep":
            eng.evaluate()
        return s.black.on

    async def _backlight(self, tid: str, black: bool, brightness: int | None) -> None:
        eid = self.backlight_of(tid)
        if not eid:
            return
        data: dict[str, Any] = {"entity_id": eid}
        if black:
            data["brightness"] = 1                    # HK's black: the backlight at its lowest
        elif brightness is not None:
            data["brightness"] = max(1, min(255, int(brightness)))
        try:
            await self.house.call_service("light", "turn_on", data, context=f"linked:{tid}")
        except HouseCommandRefused as exc:            # recorded by the caller (status: would / refused)
            log.info("linked backlight for %s not sent: %s", tid, exc.code)

    async def set_photos(self, tid: str, on: bool) -> None:
        s = self.screen(tid)
        if s is None or s.photos == on:
            return
        s.photos = on
        self.feed.send({"type": "screen", "tablet": tid, "photos": on, "dashboards": [], "users": []})
        await self.push_tablet(tid, only=SS.SWITCH_KEY)
        eng = self.engines.get(tid)
        if eng is not None and not eng._busy():
            eng.evaluate()

    async def page_says(self, tid: str, black: bool) -> bool:
        s = self.screen(tid)
        if s is None:
            return False
        changed = s.black.page_says(bool(black))
        if changed:
            if s.black.on and s.black.confirmed:
                # heard: the screens' copy says so too, so a page that re-confirms (hk-saver hkUnheard) stops
                self.feed.send({"type": "screen", "tablet": tid, "black": True, "brightness": s.black.brightness,
                                "confirmed": True, "dashboards": [], "users": []})
            await self.push_tablet(tid, only=SS.BLACK_KEY)
            eng = self.engines.get(tid)
            if eng is not None and not eng._busy():
                eng.evaluate()
        return changed

    def touched(self, tid: str, saver: bool = False) -> None:
        s = self.screen(tid)
        if s is None:
            return
        s.touch = self.now()
        if saver:
            s.saver_touch = s.touch
        self.update_in_use(tid)
        eng = self.engines.get(tid)
        if eng is not None:
            eng.evaluate()

    def update_in_use(self, tid: str) -> None:
        s, b = self.screen(tid), self.boards.get(tid)
        if s is None or b is None:
            return
        now = self.now()
        was, s.in_use = s.in_use, SS.in_use(s.touch, SS.starts_after(b), now)
        old = self._in_use_timers.pop(tid, None)
        if old is not None:
            old.cancel()
        if s.in_use and s.touch is not None:
            left = SS.window_of(SS.starts_after(b)) - (now - s.touch).total_seconds()
            try:
                self._in_use_timers[tid] = asyncio.get_running_loop().call_later(max(0.0, left) + 0.05,
                                                                                 self.update_in_use, tid)
            except RuntimeError:
                pass
        if was != s.in_use:
            self.spawn(self.push_tablet(tid, only=SS.INUSE_KEY))
            eng = self.engines.get(tid)
            if eng is not None:
                eng.evaluate()

    def sleep_changed(self, tid: str) -> None:
        if self._published:
            self.spawn(self.push_tablet(tid, only="sleep_screen"))

    # -- linked entities -----------------------------------------------------------------------------
    def _linked_registry(self) -> Any:
        lk = self.app.get("linked")
        return lk.registry if lk is not None else None

    def tablet_entities(self, tid: str) -> dict[str, dict[str, Any]]:
        """The four entities hk_frontend publishes for a tablet: descriptors with their state now."""
        entry, t, b = self.entry_id(), self.tablets[tid], self.boards.get(tid) or {}
        s = self.screen(tid)
        uid, obj = t["uid"] or f"tablet_{tid}", _slug(t["name"], tid)
        base = SS.attributes(tid, b, s.touch)
        eng = self.engines.get(tid)
        states = {
            SS.BLACK_KEY: ("on" if s.black.on else "off", {**base, **s.black.attributes(b)}),
            SS.SWITCH_KEY: ("on" if s.photos else "off", base),
            SS.INUSE_KEY: ("on" if s.in_use else "off", base),
            "sleep_screen": (eng.want if eng is not None else "automation",
                             {**{k: v for k, v in base.items() if k in ("tablet", "dashboard")},
                              **(eng.attributes(eng.last_action) if eng is not None else {"decided_by": "automation"})}),
        }
        out = {}
        for key, (platform, icon) in TABLET_ENTITIES.items():
            state, attrs = states[key]
            out[key] = {"unique_id": f"{entry}_{uid}_{key}", "platform": platform, "entity_id": f"{platform}.{obj}_{key}",
                        "name": None, "translation_key": key, "has_entity_name": True, "icon": icon,
                        "device": {"identifier": f"{entry}_{uid}", "name": t["name"], "manufacturer": "HK Frontend",
                                   "model": "Wall Tablet"},
                        "state": state, "attributes": json.loads(json.dumps(attrs, default=str)), "available": True,
                        "tablet": tid}
        return out

    async def _sync_linked(self) -> None:
        reg = self._linked_registry()
        if reg is None:
            return
        entry = self.entry_id() if self.on("linked") else None
        want: dict[str, dict[str, Any]] = {}
        index: dict[str, tuple[str, str]] = {}
        if entry:
            for tid in self.tablets:
                if not self.mantel_owns(tid):
                    continue
                for key, desc in self.tablet_entities(tid).items():
                    want[desc["unique_id"]] = desc
                    index[desc["unique_id"]] = (tid, key)
        for uid in list(self._published - set(want)):
            # a tablet still in the settings is only no longer Mantel's: HA keeps its registry entry
            await reg.remove(uid, forget=self.linked_index.get(uid, (None, None))[0] not in self.tablets)
            self._published.discard(uid)
        for uid, desc in want.items():
            have = reg.get(uid)
            if have is None or {k: v for k, v in have.items() if k not in ("state", "attributes", "available")} != \
                    {k: v for k, v in desc.items() if k not in ("state", "attributes", "available")}:
                await reg.publish(desc)
            else:
                await reg.update(uid, state=desc["state"], attributes=desc["attributes"], merge=False)
            self._published.add(uid)
            self._last_push[uid] = (desc["state"], desc["attributes"])
        self.linked_index = index

    async def push_tablet(self, tid: str, only: str | None = None) -> None:
        reg = self._linked_registry()
        if reg is None or not self._published or tid not in self.tablets:
            return
        for key, desc in self.tablet_entities(tid).items():
            if only and key != only:
                continue
            uid = desc["unique_id"]
            now = (desc["state"], desc["attributes"])
            if uid in self._published and uid in reg.entities and self._last_push.get(uid) != now:
                self._last_push[uid] = now        # unchanged states are not sent again
                await reg.update(uid, state=desc["state"], attributes=desc["attributes"], merge=False)

    # -- running -------------------------------------------------------------------------------------
    async def start(self) -> None:
        await self.reload()
        svc = self.app.get("settings")
        if svc is not None:
            first = [True]

            def changed(_payload: dict) -> None:
                if first[0]:
                    first[0] = False
                    return
                if self._publishing:                          # (_sync_client's own publish)
                    return
                self.spawn(self.reload())
            self._feed_unsub = svc.subscribe_feed(None, changed)
        self.spawn(self._ticker())
        if self.on("live_tv"):
            self.spawn(self._tv_loop())
        self.started = True

    async def stop(self) -> None:
        if self._feed_unsub:
            self._feed_unsub()
        for eng in self.engines.values():
            eng.unload()
        for h in self._in_use_timers.values():
            h.cancel()
        for t in list(self._tasks):
            t.cancel()
        self.started = False

    async def _ticker(self) -> None:
        """A minute's tick repairs anything missed (the in-use sensors, every engine)."""
        while True:
            await asyncio.sleep(self.hooks.tick)
            try:
                for tid in self.tablets:
                    self.update_in_use(tid)
                for eng in list(self.engines.values()):
                    eng.evaluate()
                # HA says nothing when its Energy settings are saved: the plan is worked out again now
                # and then (as HA's own is, at most every CACHE_S, when asked)
                if self.on("energy") and self.monotonic() - self._energy_at >= ENERGY_REFRESH_S:
                    self.spawn(self.refresh_energy())
                self.minute()
            except Exception:  # noqa: BLE001
                log.exception("features: tick failed")

    def minute(self) -> None:
        """The clock-driven ports' minute: the calendars' look-ahead, the tablets' alerts and scheduled
        restart (feature_watch.py), and the snapshots' retention (notify_snaps.py)."""
        if self.calendars.wanted():
            self.spawn(self.calendars.look())
        self.tablet_watch.check()
        self.tablet_watch.due()
        self.snaps.prune()

    # -- notification snapshots ------------------------------------------------------------------------
    def can_snap(self) -> bool:
        return self.hooks.take_snapshot is not None or self.hooks.ha_token is not None

    async def take_snapshot(self, camera: str) -> str | None:
        """The camera's picture now, kept (notify_snaps.SnapStore); its id, or None (the notification
        goes without, as HA's)."""
        if not notify_snaps.CAMERA_ID.match(camera):
            return None
        try:
            if self.hooks.take_snapshot is not None:
                got = await self.hooks.take_snapshot(camera)
            elif self.hooks.ha_token is not None:
                cfg = self.app["cfg"]
                got = await notify_snaps.take_from_ha(self.app, cfg.ha_url, self.hooks.ha_token(), camera)
            else:
                return None
            if not got:
                self.snaps.failed += 1
                return None
            return self.snaps.put(got[0], got[1], camera)
        except Exception as exc:  # noqa: BLE001 -- any camera failure: no picture
            self.snaps.failed += 1
            log.info("notification snapshot from %s failed: %s", camera, type(exc).__name__)
            return None

    async def _tv_loop(self) -> None:
        while self.on("live_tv"):
            await self.tv.refresh()
            await asyncio.sleep(LIVE_TV_REFRESH_S)

    # -- reads ---------------------------------------------------------------------------------------
    async def energy_plan(self) -> dict[str, Any]:
        _prefs, opts, ctx = await self.energy_inputs()
        return self.servable_art(EP.build(ctx, opts))

    def servable_art(self, plan: dict[str, Any]) -> dict[str, Any]:
        """THE POWER PAGE'S PICTURE, one Mantel can draw (2026-10-19: the house's Power page had no house).
        The feature's Picture folder (``art``) may be a folder of one's own in HK's Your files inside HA
        (/hk/art/power-v2/, from before HK shipped its house): HA serves it, Mantel does not (its Your files
        carry fonts, glyphs and images, never an art.json), so the page asked /hk/.../art.json, got 404 and
        drew nothing. A folder whose art.json Mantel's /hk/ does not serve becomes the house that ships."""
        power = plan.get("power") if isinstance(plan, dict) else None
        art = power.get("art") if isinstance(power, dict) else None
        if not isinstance(art, str) or art == BUILT_IN_ART:
            return plan
        from .server import hk_path
        rel = art[len("/hk/"):].strip("/") + "/art.json" if art.startswith("/hk/") else ""
        try:
            served = bool(rel) and hk_path(self.app, rel) is not None
        except Exception:  # noqa: BLE001 -- an app without the /hk/ route's parts: nothing to look in
            served = False
        if served:
            return plan
        if art not in self._art_warned:
            self._art_warned.add(art)
            log.info("the Power page's picture folder %s is not one Mantel serves; drawing the house that ships", art[:120])
        return {**plan, "power": {**power, "art": BUILT_IN_ART}}

    async def energy_inputs(self) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        """(HA's Energy settings, the feature's options, what the plan is worked out from)."""
        proxy = getattr(self.hub, "readproxy", None)
        if proxy is None:
            raise Forbidden("no connection to Home Assistant's Energy settings")
        try:
            prefs = await proxy.request({"type": "energy/get_prefs"})
        except RuntimeError as exc:
            # HA answers not_found while no Energy settings were ever saved; its own plan is then worked
            # out from the feature's options alone (energy.prefs() is None), and so is this one
            if str(exc) != "not_found":
                raise
            prefs = {}
        opts = self.settings["energy"]["options"]
        house = {**self.store.body("house", "settings"),
                 "accessories": self.store.body("house", "accessories") or {}}
        prefs = prefs if isinstance(prefs, dict) else {}
        return prefs, opts, energy_context(self.house, prefs, opts, energy_house(self.house, house),
                                           sources=await self.helper_sources(proxy))

    async def helper_sources(self, proxy: Any) -> dict[str, str]:
        """{helper sensor: the sensor it counts}, from Mantel Link's read in HA (``mantel/energy/sources``, read
        only, by Mantel itself; HK Frontend's ``hk_energy/sources`` while a house still has only that): a Utility Meter publishes no `source` attribute, so the chain meter -> Integral ->
        power sensor is only in HA's objects. Kept from the last good answer: an HK that predates the read, or
        a failed call, leaves the plan on the sources the states carry (energy_context falls back to them)."""
        read = getattr(proxy, "read_server", None)
        if read is None:
            return self._helper_sources
        try:
            # Mantel Link's (energy.py) first; HK Frontend's own while a house still has it
            try:
                got = await read({"type": "mantel/energy/sources"})
            except Exception:  # noqa: BLE001 -- no Mantel Link (or an older one): HK Frontend's
                got = await read({"type": "hk_energy/sources"})
        except Exception as exc:  # noqa: BLE001 -- neither answers, HA away: the last answer, or none
            if not self._helper_sources_warned:
                self._helper_sources_warned = True
                log.info("HK's hk_energy/sources is not answering (%s); the Energy plan follows the sources the states carry",
                         type(exc).__name__)
            return self._helper_sources
        src = got.get("sources") if isinstance(got, Mapping) else None
        if isinstance(src, Mapping):
            self._helper_sources = {k: v for k, v in src.items()
                                    if isinstance(k, str) and isinstance(v, str) and "." in k and "." in v}
            self._helper_sources_warned = False
        return self._helper_sources

    def clean_coverage(self) -> dict[str, Any]:
        opts = self.settings["clean_areas"]["options"]
        return {"offered": CA.offered(self.house, opts), "coverage": CA.coverage(self.house, opts)}

    async def import_from_ha(self, identity: Any = None) -> dict[str, Any]:
        """The feature import again, on its own (``POST /api/features/import``, the Ingress people page):
        HA's panel/get once, each added feature's settings read once (readproxy's server-only reads),
        written as a new version of ``house/mantel_features`` (action ``import``). Never writes to HA."""
        proxy = getattr(self.hub, "readproxy", None)
        read = getattr(proxy, "read_server", None)
        if read is None:
            raise LookupError("no connection to Home Assistant to import from")
        panel = await read({"type": "hk_frontend/panel/get"})
        if not isinstance(panel, Mapping):
            raise ValueError("Home Assistant's answer has no HK settings in it")
        entry = panel.get("entry_id")
        source = f"ha:{entry}" if isinstance(entry, str) and _ENTRY.match(entry) else "ha"
        body = await import_features(panel, read, self.doc(FEATURES_DOC) or None, source,
                                     live_tv_on=bool(getattr(self.app.get("cfg"), "go2rtc_url", "")))
        from .settings_store import Actor, actor_of
        actor = actor_of(identity) if identity is not None else Actor(label="mantel-features")
        docs = self.store.write([("house", FEATURES_DOC, body)], actor=actor, action="import",
                                message="feature import", source=source)
        music = self.app.get("music")           # Music's settings too (music.py: house/music), when HA has Music
        if music is not None:
            try:
                docs += [True] if await music.import_from_ha(panel, read, actor, source) else []
            except Exception as exc:  # noqa: BLE001 -- the features are in; music can be imported again
                log.warning("music settings were not imported (%s)", type(exc).__name__)
        await self.reload()
        if self.on("live_tv") and self.started:
            self.spawn(self.tv.refresh())
        log.info("imported HK's features from %s: added %s", source, self.client_added())
        return {"imported": True, "source": source, "changed": bool(docs), "added": self.client_added(),
                "settings": self.settings}

    # -- what the screens are told about the features --------------------------------------------------
    def client_added(self) -> list[str]:
        """The settings feed's ``added`` (HA: the kinds of the features loaded), in HA's order: a piece
        Mantel runs while it is on, and a feature whose engine is still HA's while HA has it added."""
        ha = set(self.settings["ha"]["added"])
        return [k for k in HA_KINDS if (k in PIECES and self.on(k)) or (k in HA_RUN and k in ha)]

    def _may_feature_now(self, identity: Any, feature: str) -> bool:
        """RBAC ``view`` of ``feature:<name>``, asked synchronously (the settings feed is built in a
        callback). A hook that can only answer later refuses (fail closed)."""
        if identity is None:
            return False
        key = f"feature:{feature}"
        try:
            got = self.hooks.may_read(identity, "view", [key])
        except Exception:  # noqa: BLE001 -- a failing hook refuses
            log.exception("features: the read hook failed; refusing %s", key)
            return False
        if inspect.isawaitable(got):
            if asyncio.iscoroutine(got):
                got.close()
            return False
        return key in set(got or ())

    def client_part(self, identity: Any) -> dict[str, Any]:
        """The settings feed's ``added`` and ``energy`` for this subject (HA's ws_settings_subscribe adds
        the same two). ``energy`` is the Energy page's plan (hk_core.energy.plan.build), only for a
        subject with ``feature:energy`` (as ``mantel/energy/plan`` and HA's ``energy/get_prefs`` read are)."""
        plan = self.energy_cache if self.on("energy") and self._may_feature_now(identity, "energy") else None
        return {"added": self.client_added(), "energy": plan}

    def panel_features(self) -> dict[str, dict[str, Any]]:
        """``hk_frontend/panel/get``'s ``features`` in HA's shape (panel.py _features): every feature
        installed, with an entry for each one added (HA's item ids from the import)."""
        added, items = set(self.client_added()), self.settings["ha"]["items"]
        out: dict[str, dict[str, Any]] = {}
        for fid, kind, name in COMPANIONS:
            got = (items.get(kind) or [{"entry_id": f"mantel_{kind}", "title": name}]) if kind in added else []
            out[fid] = {"name": name, "kind": kind, "installed": True,
                        "entries": [{"entry_id": i["entry_id"], "title": i.get("title") or name, "state": "loaded"}
                                    for i in got]}
        return out

    def _sync_client(self) -> None:
        """Tell every screen when what it is told about the features changed (a new settings feed)."""
        now = (tuple(self.client_added()), self.energy_cache if self.on("energy") else None)
        if now == self._client_sent:
            return
        self._client_sent = now
        svc = self.app.get("settings")
        if svc is not None:
            # this host's own news for the screens, not a settings change: its feed subscriber (start) must not
            # take it for one and reload every feature again (each Energy plan change read HA's energy twice)
            self._publishing = True
            try:
                svc.publish()
            finally:
                self._publishing = False

    def _ha_ready(self) -> bool:
        ev = getattr(getattr(self.hub, "ha", None), "connected", None)
        return bool(ev is not None and ev.is_set()) and getattr(self.hub, "readproxy", None) is not None

    async def refresh_energy(self, force: bool = False) -> dict[str, Any] | None:
        """Work the Energy page's plan out again (HA's Energy settings read once, the house from the
        hub) and tell the screens if it changed. Only once Mantel is connected to HA (or ``force``)."""
        if not self.on("energy"):
            self.energy_cache = None
            self._sync_client()
            return None
        if not force and not self._ha_ready():
            return self.energy_cache
        self._energy_at = self.monotonic()
        try:
            plan = await self.energy_plan()
        except Exception as exc:  # noqa: BLE001 -- the last plan stays; tried again on the next tick
            self.energy_error = f"{type(exc).__name__}: {exc}"[:300]
            log.warning("the Energy page's plan was not worked out: %s", self.energy_error)
            return self.energy_cache
        self.energy_error = None
        if self.on("energy"):
            self.energy_cache = plan
            self._sync_client()
        return plan

    # -- Clean Areas' area picker (hk_clean_areas/subscribe, answered by Mantel) --------------------
    async def area_offer(self, identity: Any) -> dict[str, Any]:
        """HA's ``hk_clean_areas/subscribe`` body, {configured, areas}, from hk_core's Clean Areas over
        Mantel's House: the areas the picker offers (``clean_areas.offered``), reached only through
        vacuums this subject may ``view`` (an area only a hidden vacuum reaches is not offered)."""
        if not self.on("clean_areas"):
            return {"configured": False, "areas": []}
        from .connectors import allowed_ids
        opts = self.settings["clean_areas"]["options"]
        part = [v for v in CA.coverage(self.house, opts) if v["taking_part"]]
        ok = await allowed_ids(self.hooks, identity, "view", [v["vacuum"] for v in part])  # type: ignore[arg-type]
        reach: list[str] = []
        for v in part:
            if v["vacuum"] in ok:
                for a in v["areas"]:
                    if a not in reach:
                        reach.append(a)
        chosen = list(opts.get("areas") or [])
        return {"configured": True, "areas": [a for a in chosen if a in reach] if chosen else reach}

    def subscribe_areas(self, identity: Any, on_event: Callable[[dict], None]) -> tuple[int, Callable[[], None]]:
        self._area_n += 1
        sid = self._area_n
        self._area_subs[sid] = [identity, on_event, None]
        return sid, lambda: self._area_subs.pop(sid, None) and None

    async def push_areas(self, only: int | None = None) -> None:
        """Each listening picker its areas, when they changed for it (as HA's push sends a change only)."""
        for sid, sub in list(self._area_subs.items()):
            if only is not None and sid != only:
                continue
            try:
                body = await self.area_offer(sub[0])
            except Exception:  # noqa: BLE001 -- nothing rather than too much
                log.exception("features: the areas on offer could not be worked out")
                continue
            if sid in self._area_subs and body != sub[2]:
                sub[2] = body
                try:
                    sub[1](body)
                except Exception:  # noqa: BLE001 -- one closed screen never stops the others
                    log.exception("an area picker's listener failed")

    def status(self) -> dict[str, Any]:
        calls = list(self.caller.log)
        return {
            "commands_enabled": self.commands_enabled, "actor": FEATURE_ACTOR, "started": self.started,
            "settings_error": self.settings_error,
            "pieces": {p: self.on(p) for p in PIECES},
            "grants": sorted(self.acting_entities()),
            "calls": calls, "would": [c for c in calls if c.get("outcome") == "would"],
            "notifications": {"watching": sorted(self.notifier.cache), "items": len(self.notifier.items),
                              "delivered": list(self.notifier.sent), "mutes": NB.mutes(dict(self.notifier.mutes),
                                                                                      self.epoch())},
            "feed": {"listeners": self.feed.listeners, "sent": list(self.feed.sent)},
            "linked": {"entry_id": self.entry_id(), "published": sorted(self._published),
                       "handler": type(getattr(self.app.get("linked"), "handler", None)).__name__,
                       "calls": list(self.linked.calls)},
            "sleep": {tid: eng.report() for tid, eng in self.engines.items()},
            "screens": {tid: {"black": s.black.on, "confirmed": s.black.confirmed, "brightness": s.black.brightness,
                              "photos": s.photos, "in_use": s.in_use,
                              "last_touch": s.touch.isoformat() if s.touch else None}
                        for tid, s in self.screens.items()},
            "live_tv": {"lineup": len(self.tv.lineup), "channels": len(self.tv.guide), "fetched_at": self.tv.fetched_at,
                        "error": self.tv.error},
            "snapshots": self.snaps.status(),
            "calendars": self.calendars.status(),
            "tablets": self.tablet_watch.status(),
            "screens_told": {"added": self.client_added(), "energy_plan": self.energy_cache is not None,
                             "energy_error": self.energy_error, "area_pickers": len(self._area_subs),
                             "imported_from": self.settings["ha"]["source"]},
        }


# ---------------------------------------------------------------------------------- registration
def _principal_ok(identity: Any) -> bool:
    return identity is not None and getattr(identity, "valid", True) and \
        (getattr(identity, "user", None) is not None or getattr(identity, "device", None) is not None)


def _role(identity: Any) -> str | None:
    return getattr(getattr(identity, "user", None), "role", None)


def may_speak_for(host: FeatureHost, identity: Any, tid: str) -> bool:
    """A page may report for a tablet (a touch, its black) only as screensaver.rules.may_speak_for says:
    the tablet's own user, an admin, or anyone for a tablet with no user; a wall tablet device in
    the tablet's own room counts as that tablet, and so does a device that is the tablet's own HA user
    (HA App mode: the Tablet User's name is HA's name for the HA user linked to the device)."""
    t = host.tablets.get(tid)
    if t is None or not _principal_ok(identity):
        return False
    dev = getattr(identity, "device", None)
    if dev is not None and getattr(identity, "user", None) is None:
        ha_name = getattr(dev, "ha_name", None)
        if ha_name and t.get("user") and t["user"] == ha_name:
            return True
        return bool(t["room"]) and getattr(dev, "room", None) == t["room"]
    u = identity.user
    return SS.may_speak_for(t["user"], signed_in=True, admin=u.role in ("owner", "admin"),
                            name=u.username or u.name)


def register(app: web.Application, hub: Any, hooks: Any = None) -> FeatureHost:
    """Install ``app["features"]``: the feature host, its reads and messages, its REST, and the
    linked handler. Every piece is off until the feature settings turn it on."""
    if "features" in app:
        # already registered (server.wire does it): a second call only swaps the hooks (read at
        # use time), so routes, handlers and the hub's callbacks are never installed twice
        app["features"].hooks = FeatureHooks.coerce(hooks)
        return app["features"]
    host = FeatureHost(app, hub, FeatureHooks.coerce(hooks))
    app["features"] = host

    # the hub's changes: chained after HaClient's own callbacks (server.py is not edited)
    ha = getattr(hub, "ha", None)
    if ha is not None:
        first_change, first_registry = ha.on_change, ha.on_registry

        def on_change(changed: set[str]) -> None:
            first_change(changed)
            host.on_change(set(changed))

        def on_registry() -> None:
            if first_registry is not None:
                first_registry()
            host.on_registry()
        ha.on_change, ha.on_registry = on_change, on_registry
        first_loaded = getattr(ha, "on_registries_loaded", None)

        def on_registries_loaded() -> None:
            if first_loaded is not None:
                first_loaded()
            host.on_registry()
        ha.on_registries_loaded = on_registries_loaded

    # linked mode's hook point: the real handler replaces the in-memory one
    if app.get("linked") is not None:
        app["linked"].handler = host.linked

    # the screens' event feed, under the message type HK's page already opens
    async def events(ctx: Ctx, msg: dict, on_event: Callable[[dict], None]):
        if not _principal_ok(ctx.identity):
            raise Forbidden("sign in to receive the house's events")
        end = host.feed.subscribe(ctx.identity, on_event)
        # a page that opens (or reloads) while a screen is black or showing photos is told so at once,
        # in the same `screen` frames; a screen that is neither needs no frame (the page's default)
        for tid, scr in list(host.screens.items()):
            if tid not in host.tablets:
                continue
            if scr.black.on:
                on_event({"type": "screen", "tablet": tid, "black": True, "brightness": scr.black.brightness,
                          "confirmed": scr.black.confirmed, "dashboards": [], "users": []})
            if scr.photos:
                on_event({"type": "screen", "tablet": tid, "photos": True, "dashboards": [], "users": []})

        async def unsubscribe() -> None:
            end()
        return unsubscribe

    async def tv_guide(ctx: Ctx, msg: dict):
        if not _principal_ok(ctx.identity):
            raise Forbidden("sign in to read the guide")
        tv = host.app.get("live_tv")
        if not (tv.piece_on() if tv is not None else host.on("live_tv")):
            return {"configured": False, "channels": []}
        return host.tv.channels()

    async def energy(ctx: Ctx, msg: dict):
        if not host.on("energy"):
            return {"configured": False}
        if not await may_feature(host.hooks, ctx.identity, "energy"):    # type: ignore[arg-type]
            raise Forbidden("not allowed: the energy page")
        plan = await host.energy_plan()
        if host.on("energy") and plan != host.energy_cache:     # the screens' copy follows a fresher plan
            host.energy_cache = plan
            host._sync_client()
        return {"configured": True, "plan": plan}

    async def coverage(ctx: Ctx, msg: dict):
        if not _principal_ok(ctx.identity):
            raise Forbidden("sign in to see the vacuums")
        if not host.on("clean_areas"):
            return {"configured": False, "offered": [], "coverage": []}
        return {"configured": True, **host.clean_coverage()}

    # HK's area picker (hk-area-select-card), exactly as it subscribes to HA: answered here from hk_core's
    # Clean Areas over Mantel's House, never forwarded. Starting a clean is a COMMAND (the page's
    # hk_frontend.clean_areas service call, or clean_areas_run): the gateway's, never this read's.
    async def clean_areas_subscribe(ctx: Ctx, msg: dict, on_event: Callable[[dict], None]):
        from .readproxy import ReadBlocked
        if set(msg) - {"type", "id"}:
            raise ReadBlocked("hk_clean_areas/subscribe carries nothing")
        if not _principal_ok(ctx.identity):
            raise Forbidden("sign in to see the areas to clean")
        sid, end = host.subscribe_areas(ctx.identity, on_event)
        await host.push_areas(only=sid)            # now, as HA's subscribe answers at once

        async def unsubscribe() -> None:
            end()
        return unsubscribe

    read_routes(app).update({
        "hk_frontend/events/subscribe": Route(subscribe=events),
        "mantel/live_tv/guide": Route(request=tv_guide),
        "mantel/energy/plan": Route(request=energy),
        "mantel/clean_areas/coverage": Route(request=coverage),
        "hk_clean_areas/subscribe": Route(subscribe=clean_areas_subscribe),
    })
    # the settings feed's `added` / `energy` and panel/get's `features` (settings_store.SettingsService)
    svc = app.get("settings")
    if svc is not None:
        svc.features = host

    # the page's messages (none is command-shaped; a house command still goes through the gateway)
    async def screen_report(ctx: Ctx, msg: dict) -> None:
        rid, tid = msg.get("id"), msg.get("tablet")
        ok = isinstance(tid, str) and set(msg) <= {"type", "id", "tablet", "touch", "saver", "black", "photos"} \
            and all(isinstance(msg.get(k), bool) for k in ("touch", "saver", "black", "photos") if k in msg)
        if not ok:
            return await ctx.send({"type": "screen_result", "id": rid, "error": {"code": "invalid"}})
        if not may_speak_for(host, ctx.identity, tid):
            return await ctx.send({"type": "screen_result", "id": rid, "error": {"code": "forbidden"}})
        if msg.get("touch"):
            host.touched(tid, saver=bool(msg.get("saver")))
        changed = await host.page_says(tid, msg["black"]) if "black" in msg else False
        if "photos" in msg:                 # HK's photo screensaver came up / went away on this page
            scr = host.screen(tid)
            changed = changed or (scr is not None and scr.photos != msg["photos"])
            await host.set_photos(tid, msg["photos"])
        await ctx.send({"type": "screen_result", "id": rid, "result": {"changed": changed}})

    async def notify_mute(ctx: Ctx, msg: dict) -> None:
        rid, key, secs = msg.get("id"), msg.get("key"), msg.get("seconds", 3600)
        if not _principal_ok(ctx.identity):
            return await ctx.send({"type": "notify_mute_result", "id": rid, "error": {"code": "forbidden"}})
        if not isinstance(key, str) or not 0 < len(key) <= 200 or isinstance(secs, bool) or not isinstance(secs, int) \
                or not 0 <= secs <= 86400 or set(msg) - {"type", "id", "key", "seconds"}:
            return await ctx.send({"type": "notify_mute_result", "id": rid, "error": {"code": "invalid"}})
        until = host.notifier.set_mute(key, secs, ctx.identity)     # muting only makes the house quieter
        await ctx.send({"type": "notify_mute_result", "id": rid, "result": {"until": until}})

    async def clean_run(ctx: Ctx, msg: dict) -> None:
        rid, areas = msg.get("id"), msg.get("areas")
        if not _principal_ok(ctx.identity):
            return await ctx.send({"type": "clean_areas_result", "id": rid, "error": {"code": "forbidden"}})
        if not host.on("clean_areas"):
            return await ctx.send({"type": "clean_areas_result", "id": rid, "error": {"code": "not_set_up"}})
        if not isinstance(areas, list) or not all(isinstance(a, str) for a in areas) or len(areas) > 50 \
                or not isinstance(msg.get("dry_run", False), bool) or set(msg) - {"type", "id", "areas", "dry_run"}:
            return await ctx.send({"type": "clean_areas_result", "id": rid, "error": {"code": "invalid"}})
        out = await CA.async_clean(host.house, areas, host.settings["clean_areas"]["options"],
                                   dry_run=bool(msg.get("dry_run")), context=ctx.identity)
        await ctx.send({"type": "clean_areas_result", "id": rid, "result": out})

    # All Tablets' "Restart all now" (HK's hk_frontend/tablet/act restart_all): the restart as the person who
    # asked, each press a gateway command (refused and audited `would` while house commands are off)
    async def tablets_restart(ctx: Ctx, msg: dict) -> None:
        rid = msg.get("id")
        if set(msg) - {"type", "id"}:
            return await ctx.send({"type": "tablets_restart_result", "id": rid, "error": {"code": "invalid"}})
        if host.pages is None or not host.pages.may_configure(ctx.identity, "tablets"):
            return await ctx.send({"type": "tablets_restart_result", "id": rid, "error": {"code": "forbidden"}})
        if not host.on("tablets"):
            return await ctx.send({"type": "tablets_restart_result", "id": rid,
                                   "error": {"code": "not_set_up", "message": "Mantel's tablets piece is off"}})
        done = await host.tablet_watch.restart_all(context=ctx.identity)
        last = host.tablet_watch.restarts[-1] if host.tablet_watch.restarts else {}
        await ctx.send({"type": "tablets_restart_result", "id": rid,
                        "result": {"restarted": done, "presses": last.get("presses", [])}})

    # Wall Tablets' Wake Now, Sleep Now and the kiosk screensaver's Fix (HK's hk_frontend/tablet/act, which HK
    # Frontend ran in Home Assistant): Mantel's own Sleep Screen engine for the tablet, and the kiosk app's two
    # settings through the gateway as the person who pressed it (refused and audited while commands are off)
    async def tablet_act(ctx: Ctx, msg: dict) -> None:
        rid, tid, act = msg.get("id"), msg.get("tablet"), msg.get("act")

        async def answer(**kw: Any) -> None:
            await ctx.send({"type": "tablet_act_result", "id": rid, **kw})
        if set(msg) - {"type", "id", "tablet", "act"} or act not in ("wake", "sleep", "kiosk_saver") \
                or not isinstance(tid, str):
            return await answer(error={"code": "invalid", "message": "{tablet, act: wake|sleep|kiosk_saver}"})
        if host.pages is None or not host.pages.may_configure(ctx.identity, "tablets"):
            return await answer(error={"code": "forbidden", "message": "Wall Tablets need configure (Owner or Admin)"})
        t = host.tablets.get(tid)
        if t is None:
            return await answer(error={"code": "no_tablet", "message": "There is no such tablet"})
        if act == "kiosk_saver":
            from hk_core.tablets.kiosk import kiosk_saver_calls, parts
            calls = kiosk_saver_calls(parts(host.house, str(t.get("app") or ""), str(t.get("device") or "")))
            try:
                for domain, service, data in calls:
                    await host.caller(domain, service, data, ctx.identity)
            except HouseCommandsDisabled:
                return await answer(error={"code": "commands_disabled", "message": "house commands are disabled"})
            except HouseCommandRefused as exc:
                return await answer(error={"code": "forbidden", "message": str(exc)})
            return await answer(result={"ok": True})
        eng = host.engines.get(tid)
        if eng is None or not eng.acting:
            return await answer(error={"code": "not_deciding", "message": "Mantel doesn't decide when this tablet sleeps"})
        if act == "wake":
            host.touched(tid)
        else:
            await eng.sleep(eng.power_off_wanted())
        await answer(result={"ok": True})

    ws_handlers(app).update({"screen_report": screen_report, "notify_mute": notify_mute,
                             "clean_areas_run": clean_run, "tablets_restart": tablets_restart,
                             "tablet_act": tablet_act})
    # notification snapshots (GET /api/notify/snap/<id>, hk_notify/snap/sign) and HK Settings' feature pages
    notify_snaps.register(app, host.snaps)
    host.pages = feature_pages.register(app, host)

    # REST: the status (Owner/Admin) and the settings (read Owner/Admin, write Owner)
    def who(request: web.Request, owner_only: bool = False) -> Any:
        from .sessions import identity
        ident = identity(request)
        role = getattr(ident.user, "role", None)
        if ident.user is None or role not in (("owner",) if owner_only else ("owner", "admin")):
            raise web.HTTPForbidden(text="Owner only" if owner_only else "Owner or Admin only")
        return ident

    async def api_status(request: web.Request) -> web.Response:
        who(request)
        return web.json_response(host.status(), dumps=lambda o: json.dumps(o, default=str))

    async def api_settings(request: web.Request) -> web.Response:
        who(request)
        return web.json_response({"settings": host.settings, "error": host.settings_error})

    async def api_settings_put(request: web.Request) -> web.Response:
        ident = who(request, owner_only=True)
        try:
            body = await request.json()
            settings = check_settings(body)
        except ValueError as exc:
            return web.json_response({"error": {"code": "invalid", "message": str(exc)}}, status=400)
        host.write_doc(FEATURES_DOC, settings, ident, "feature settings")
        await host.reload()
        if host.on("live_tv") and host.started:
            host.spawn(host.tv.refresh())
        return web.json_response({"settings": host.settings})

    async def api_import(request: web.Request) -> web.Response:
        """Read the feature items from HA again (Owner only): ``ha`` and the four imported pieces are
        replaced, ``linked`` and ``sleep`` kept; a new version of ``house/mantel_features``."""
        ident = who(request, owner_only=True)
        try:
            got = await host.import_from_ha(ident)
        except LookupError as exc:
            return web.json_response({"error": {"code": "unavailable", "message": str(exc)}}, status=503)
        except ValueError as exc:
            return web.json_response({"error": {"code": "invalid", "message": str(exc)}}, status=400)
        except Exception as exc:  # noqa: BLE001 -- HA unreachable or refused; nothing was written
            log.warning("feature import failed: %s", type(exc).__name__)
            return web.json_response({"error": {"code": "import_failed", "message": type(exc).__name__}}, status=502)
        return web.json_response(got)

    app.router.add_get("/api/features/status", api_status)
    app.router.add_get("/api/features/settings", api_settings)
    app.router.add_put("/api/features/settings", api_settings_put)
    app.router.add_post("/api/features/import", api_import)

    async def start(_app: web.Application) -> None:
        await host.start()

    async def stop(_app: web.Application) -> None:
        await host.stop()

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return host
