"""The feature host: ``FeatureHooks`` (what the orchestrator passes), ``FeatureHost`` (the pieces, their reads,
messages and REST, ``app["features"]``), ``may_speak_for`` (which page may report for a tablet) and ``register``."""
from __future__ import annotations

import asyncio
import copy
from dataclasses import dataclass
from datetime import datetime, timezone
import inspect
import json
import logging
from pathlib import Path
import time
from typing import Any, Awaitable, Callable, Mapping

from aiohttp import web
from hk_core import clean_areas as CA
from hk_core.energy import plan as EP
from hk_core.energy.power import BUILT_IN_ART
from hk_core.house import State
from hk_core.notifications import banner as NB
from hk_core.screensaver import rules as SS
from hk_core.settings import model as SM
from hk_core.sleep import engine as SE

from .. import feature_pages, notify_snaps
from ..connectors import Ctx, deny_read, Forbidden, may_feature, read_routes, Route, ws_handlers
from ..feature_watch import CalendarLook, TabletWatch
from ..house import HouseCommandRefused, HouseCommandsDisabled, MantelHouse
from .actor import FeatureCaller, Feed, OverlayHouse, ScreenState, _slug
from .energy_plan import energy_context, energy_house
from .linked_handler import FeatureLinked
from .notify import Notifier
from .settings import (
    COMPANIONS, DEFAULTS, ENERGY_REFRESH_S, FEATURES_DOC,
    FEATURE_ACTOR, HA_KINDS, HA_RUN, KIOSK_DOMAINS,
    LIVE_TV_REFRESH_S, PIECES, TABLET_ENTITIES, bad_item,
    check_settings, import_features, _ENTRY,
)
from .sleep import MantelSleep
from .tv_fetch import LiveTv, http_fetch

log = logging.getLogger("mantel.features")

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
            from ..settings_store import SettingsStore
            self.app["_feature_settings_store"] = SettingsStore(self.app["store"].db, lambda: self.app["clock"]())
        return self.app["_feature_settings_store"]

    def doc(self, key: str) -> dict:
        return self.store.body("house", key)

    def write_doc(self, key: str, body: dict, identity: Any = None, message: str = "features") -> None:
        from ..settings_store import Actor, actor_of
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
        from ..settings_store import stored_of
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
        from ..server import hk_path
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
        from ..settings_store import Actor, actor_of
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
    def house_part(self) -> dict[str, Any]:
        """``client_part`` for a linked HK Frontend's dashboards (settings_store.house_feed): the Energy page's
        plan for every user, as HK Frontend's own feed always sent it -- each page's reads are still checked."""
        return {"added": self.client_added(), "energy": self.energy_cache if self.on("energy") else None}

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
        from ..connectors import allowed_ids
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
        from ..readproxy import ReadBlocked
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
        from ..sessions import identity
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
