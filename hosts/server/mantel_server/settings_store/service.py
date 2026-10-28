"""``SettingsService``: the client API over the store: the feeds, HK Settings' one read, and every save."""
from __future__ import annotations

import logging
import copy
import inspect
import re
from typing import Any, Callable, Iterable, Mapping

from hk_core.settings import model as SM

from .. import accessories as ACC
from ..connectors import Forbidden
from .docs import Actor, CHIP_KINDS, CHIP_TOKEN, Doc, HOUSE_DOCS, KEY_RE, PILL_COLORS, SCOPES, Scope, SettingsError, USER_SECTIONS
from .hooks import REFUSALS, SAVE_KINDS, SettingsHooks, WRITE_KEYS, _resolve, _sides, actor_of
from .importing import looks_merged, merged_house, stored_house, stored_of
from .model import ThinModel, load_model
from .store import SettingsStore

log = logging.getLogger("mantel.settings")

def _slug(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", str(text or "").lower().replace("'", "").replace("’", "")).strip("-")
    return s[:40]


class SettingsService:
    """The client API over the store. Every save: shape check, RBAC, model check, store, feed."""

    def __init__(self, store: SettingsStore, hooks: Any = None, model: ThinModel | None = None) -> None:
        self.store = store
        self.hooks = SettingsHooks.coerce(hooks)
        self.model = model or load_model()
        self._feeds: dict[int, tuple[Any, Callable[[dict], None]]] = {}
        self._next = 0
        # the feature host (features.register sets it): the feed's `added` / `energy` per subject
        # (``client_part(identity)``) and panel/get's `features` (``panel_features()``), as HA adds them
        self.features: Any = None
        # Hidden Accessories' house copy (hidden.Hiding, readproxy.register puts it in app["hiding"]): a getter
        self.hiding: Any = None
        # whether Mantel has the house's states yet (register: Home Assistant's first full state): until then
        # Status & Chips' lists are not sent, and the screens find them themselves (hk-chip.js FIND)
        self.house_ready: Callable[[], bool] = lambda: False
        self.kinds_sent: dict[str, list[str]] | None = None      # the lists the screens were last sent
        # told after every publish, whoever subscribes (linked_settings.py: a linked HK Frontend's mirror)
        self.watchers: list[Callable[[], None]] = []
        # where a screen is drawn besides Mantel, for HK Settings' list (linked_settings.place): {text, icon} or None
        self.place: Callable[[str], dict | None] | None = None

    # -- RBAC -----------------------------------------------------------------------------------
    async def allowed(self, identity: Any, scope: Scope) -> bool:
        try:
            return (await _resolve(self.hooks.may_configure(identity, scope))) is True
        except Exception:  # noqa: BLE001 -- a failing hook refuses
            log.exception("may_configure failed; refusing")
            return False

    async def need(self, identity: Any, scope: Scope) -> None:
        if not await self.allowed(identity, scope):
            log.warning("refused a settings change of %s", scope)
            raise SettingsError("forbidden", f"may not change {scope}")

    # -- payloads -------------------------------------------------------------------------------
    def _items(self, key: str) -> list:
        return list(self.store.body("house", key).get("items") or [])

    def house_settings(self) -> dict:
        """The house settings as every reader sees them (the feed, HK Settings, a person's checks): the stored
        differences over the defaults (SET-2: what is stored is only what differs, as HA stores it)."""
        return merged_house(self.store.body("house", "settings"))

    def _apply_house(self, changes: Any) -> dict:
        """A house save's new body as stored (the differences), or SettingsError with the fields refused."""
        stored = self.store.body("house", "settings")
        new, errors = self.model.save_house(stored, merged_house(stored), changes)
        if errors:
            raise SettingsError("invalid_format", fields=errors)
        return new

    def personal(self, identity: Any) -> dict:
        uid = _sides(identity)[0]
        return self.store.body("user", uid) if uid else {}

    def _base_feed(self) -> dict:
        house = self.house_settings()
        sections = {k: dict(v) for k, v in house.items() if isinstance(v, dict) and k != "counts"}
        # Browse Music's Discover rows go out as the queries themselves (HA's as_client: discover_rows), not
        # the stored keys: a screen runs each as music_assistant.get_library and keeps no copy of SHELVES.
        # (Sent as keys, every shelf asked for nothing and drew empty: the house, 2026-10-18.)
        disc = (sections.get("browse") or {}).get("discover")
        if isinstance(disc, list) and all(isinstance(k, str) for k in disc):
            sections["browse"]["discover"] = SM.discover_rows(disc)
        # the screens and tablets AS READ (stored_of), as HA's feed sends them: a screen following All Screens'
        # menu, tab bar, screensaver, rooms or cameras gets All Screens'; a tablet following All Tablets' Idle
        # gets it (sent raw, every screen kept the defaults, and no tablet returned Home when idle)
        stored = stored_of(self.store)
        tablets = SM.tablets(stored)
        boards = SM.boards(stored)
        # the car viewports, read off the screens (HA's as_client: legacy_screens): tesla-viewport.js reads car.*
        if boards:
            for section, values in SM.legacy_screens(boards).items():
                sections[section] = {**(sections.get(section) or {}), **values}
        acc = self.store.body("house", "accessories") or {"entities": {}, "rooms": {}, "into": {}, "pages": {}}
        return {
            "configured": not self.store.empty(),
            **sections,
            "boards": boards,
            "tablet_items": {tid: {
                "name": t["name"], "screen": t["screen"], "room": t["room"], "user": t["user"],
                "app": t["app"], "idle_return": t["idle_return"], "idle_time": t["idle_time"],
                "black_screen": t["black_screen"],
                # a tablet's own HA switches: HA run-time entities, not settings (linked mode, later)
                "screensaver_switch": None, "black_switch": None,
            } for tid, t in tablets.items()},
            "accessories": acc,
            "extras": {},
            "popups": self._items("popups"),
            "custom_pages": self._items("custom_pages"),
            "custom_chips": self._items("custom_chips"),
            "kinds": {},
            "added": [],
        }

    @staticmethod
    def _personalise(base: dict, personal: Mapping[str, Any]) -> dict:
        out = dict(base)
        for section, values in personal.items():
            if section in USER_SECTIONS and isinstance(values, dict):
                out[section] = {**(out.get(section) or {}), **values}
        out["personal"] = copy.deepcopy(dict(personal))
        return out

    def house_feed(self) -> dict:
        """The feed with no person's own values over the house's: what a linked HK Frontend's dashboards get
        (HA's feed was always the same for every user; linked_settings.py). `kinds` the house's, unfiltered
        (Home Assistant's own screens show what its users may see): a linked HK Frontend hands this feed to its
        screens as it is, so without them they counted every door and lock, What Counts' choices made in Mantel
        never reaching them (the house, 2026-10-28). None before Mantel has the house's states. The Energy
        page's plan is in it (features.house_part), as HK Frontend's own feed always had it."""
        payload = self._personalise(self._base_feed(), {})
        found = self.kind_lists()
        if found:
            payload = self._put_kinds(payload, {k: list(v) for k, v in found.items()})
        part = getattr(self.features, "house_part", None)
        if part is None:
            return self._with_features(payload, None)
        try:
            payload.update(part())
        except Exception:  # noqa: BLE001 -- the rest of the feed still goes out
            log.exception("the features' part of the house feed failed")
        return payload

    def feed_payload(self, identity: Any) -> dict:
        """What ``hk_frontend/settings/subscribe`` sends this subject: the same shape HA's feed sends
        (settings.as_client), with the person's own values over the house's (``personal`` says which)."""
        found = self.kind_lists()
        self.kinds_sent = found
        return self._with_kinds(self._with_features(self._personalise(self._base_feed(), self.personal(identity)),
                                                    identity), identity, found)

    # -- Status & Chips: what each kind counts (HA: kinds.Tracker, settings.as_client's `kinds`) ----------
    def kind_lists(self) -> dict[str, list[str]] | None:
        """What each kind counts now (hidden.resolve over Mantel's copy of the house), or None before Mantel
        has the house's states (the screens then find them themselves, as from a server without them)."""
        hiding = self.hiding() if callable(self.hiding) else None
        if hiding is None or not hiding.ready or not self.house_ready():
            return None
        try:
            return hiding.found(self._hide_settings())
        except Exception:  # noqa: BLE001 -- the feed still goes out; the screens find the kinds themselves
            log.exception("Status & Chips' kinds failed")
            return None

    def _visible(self, identity: Any, ids: Iterable[str]) -> set[str] | None:
        """The ids this subject may view, asked synchronously (the feed is built in a callback); None when
        that cannot be asked (fail closed: no lists at all)."""
        host = self.features
        check = getattr(getattr(host, "hooks", None), "may_read", None)
        if check is None or identity is None:
            return None
        try:
            got = check(identity, "view", sorted(set(ids)))
        except Exception:  # noqa: BLE001 -- a failing hook refuses
            log.exception("Status & Chips' kinds: the read hook failed")
            return None
        if inspect.isawaitable(got):
            if hasattr(got, "close"):
                got.close()
            return None
        return set(got or ())

    def _with_kinds(self, payload: dict, identity: Any, found: Mapping[str, list[str]] | None) -> dict:
        """HA's as_client: ``kinds`` (each kind's entities) and the older lists that are a kind's
        (kinds.LEGACY: security's locks, doors, windows and garage; features' thermostats) set to it. Each list
        holds only what this subject may view, so a chip counts what its screen can show."""
        if not found:
            return payload
        ok = self._visible(identity, (e for v in found.values() for e in v))
        if ok is None:
            return payload
        return self._put_kinds(payload, {k: [e for e in v if e in ok] for k, v in found.items()})

    @staticmethod
    def _put_kinds(payload: dict, kinds: dict[str, list[str]]) -> dict:
        from hk_core.settings.kinds import LEGACY
        payload["kinds"] = kinds
        for kind, (section, key) in LEGACY.items():
            if isinstance(payload.get(section), dict) and kind in kinds:
                payload[section] = {**payload[section], key: list(kinds[kind])}
        return payload

    def _with_features(self, payload: dict, identity: Any) -> dict:
        """HA's feed adds which features are added (`added`) and the Energy page's plan (`energy`); so
        does Mantel's, from its feature host (``house/mantel_features``), once there is one."""
        if self.features is None:
            return payload
        try:
            payload.update(self.features.client_part(identity))
        except Exception:  # noqa: BLE001 -- the rest of the feed still goes out (as HA's does)
            log.exception("the features' part of the settings feed failed")
        return payload

    @staticmethod
    def screen_title(path: str, board: Mapping[str, Any]) -> str:
        """A screen's name: the board's own ``title`` if it has one, else its address made readable
        (``dashboard-kitchen`` -> ``Kitchen``). The import keeps no dashboard titles (HA's are Lovelace's)."""
        t = board.get("title") if isinstance(board, Mapping) else None
        if isinstance(t, str) and t.strip():
            return t.strip()
        words = re.sub(r"^(dashboard|hk)-", "", path).replace("-", " ").replace("_", " ").strip()
        return words.title() if words else path

    def dashboards(self, boards: Mapping[str, Mapping[str, Any]]) -> list[dict]:
        """``dashboards`` of panel/get (panel.py ``_dashboards``' shape) from Mantel's boards: each board is
        a screen HK draws itself (so ``generated``), kept here rather than in Lovelace (``mode`` is
        ``mantel``: not renamable or deletable the way a stored HA dashboard is), and has its settings
        (``item`` is the board's key)."""
        out = [{"path": path, "title": self.screen_title(path, b), "mode": "mantel", "id": None,
                "generated": True, "require_admin": False, "item": path, "icon": (b or {}).get("icon"),
                **({"where": self._place(path)} if self._place(path) else {})}
               for path, b in boards.items()]
        return sorted(out, key=lambda d: d["title"].lower())

    def _place(self, path: str) -> dict | None:
        if self.place is None:
            return None
        try:
            return self.place(path)
        except Exception:  # noqa: BLE001 -- the list still opens
            log.exception("a screen's place failed")
            return None

    def panel_payload(self) -> dict:
        """What ``hk_frontend/panel/get`` answers (panel.py ws_panel_get's shape). The parts HA works out
        at run time (its dashboards, entities per tablet, third-party status, HA's users) are empty here;
        Hidden Accessories and Status & Chips' ``counts`` and ``kinds`` are added by register's panel_get,
        from Mantel's copy of the house, for what the person may view."""
        stored = stored_of(self.store)
        boards = SM.boards(stored)                     # as read, as HA's panel/get (S.boards)
        pages = [{**p, "used_on": [path for path, b in boards.items()
                                   if p.get("path") in (b.get("custom_pages") or [])]}
                 for p in self._items("custom_pages")]
        catalog = self.store.body("house", "catalog")
        features: dict = {}
        if self.features is not None:
            try:
                features = self.features.panel_features()
            except Exception:  # noqa: BLE001 -- HK Settings still opens
                log.exception("panel/get's features failed")
        # the kiosk apps' devices in HA (a tablet's Setup -> Device), as HK Frontend lists them; it was always
        # empty here, so no tablet could be given its device in Mantel (the house, 2026-10-20)
        kiosk_devices: list = []
        house = getattr(self.features, "house", None)
        if house is not None:
            try:
                from hk_core.tablets import kiosk as KT
                kiosk_devices = KT.devices(house)
            except Exception:  # noqa: BLE001 -- HK Settings still opens
                log.exception("panel/get's kiosk devices failed")
        return {
            "entry_id": "mantel", "source": "mantel",
            "settings": self.house_settings(),
            "boards": boards,
            "screensavers": {},
            "tablets": {k: {**t, "parts": {}} for k, t in SM.tablets(stored).items()},   # with idle_*_own
            "kiosk_devices": kiosk_devices, "tablet_suggest": [], "dashboards": self.dashboards(boards),
            "popups": self._items("popups"),
            "custom_pages": pages,
            "custom_chips": self._items("custom_chips"),
            "accessories": self.store.body("house", "accessories") or {"entities": {}},
            "kinds": {}, "hidden": {},
            "presets": catalog.get("presets", []), "chip_kinds": catalog.get("chip_kinds", list(CHIP_KINDS)),
            "page_kinds": catalog.get("page_kinds", []), "scene_pages": catalog.get("scene_pages", []),
            "shelves": catalog.get("shelves", {}),
            "setup_done": bool(self.store.body("house", "setup").get("setup_done")),
            "suggest": {}, "counts": {}, "users": [], "integration": {}, "thirdparty": {}, "features": features,
            "choices": catalog.get("choices", {}),
            "versions": self.versions(),
        }

    def versions(self) -> dict[str, int]:
        """panel/get's ``versions`` (also each linked HK Frontend's settings frame, linked_settings.frame_of, so
        its dashboards' saves carry Mantel's numbers): every stored document's ("board/<path>", "house/<key>"),
        and Edit mode's two by their short names, for an expect_version -- "accessories" (accessory/*) and
        "house" (the house settings document: settings/set). 0: none stored yet."""
        return {**{f"{s}/{k}": d.version for s in SCOPES if s != "user" for k, d in self.store.docs(s).items()},
                "accessories": self._acc_version(), "house": self._house_version()}

    # -- the feed -------------------------------------------------------------------------------
    def subscribe_feed(self, identity: Any, on_event: Callable[[dict], None]) -> Callable[[], None]:
        self._next += 1
        sid = self._next
        self._feeds[sid] = (identity, on_event)
        on_event(self.feed_payload(identity))                 # now, as HA's feed does
        return lambda: self._feeds.pop(sid, None) and None

    def publish(self, user_only: str | None = None) -> int:
        """Send the feed again to every subscriber (or only to one person's, after a personal save)."""
        base = None
        found: Any = ()
        sent = 0
        for identity, cb in list(self._feeds.values()):
            uid = _sides(identity)[0]
            if user_only is not None and uid != user_only:
                continue
            if base is None:
                try:
                    base = self._base_feed()
                except Exception:  # noqa: BLE001 -- the save is committed: say so in the log, not as its error
                    log.exception("the settings feed could not be built; nothing was sent")
                    break
            if found == ():
                found = self.kind_lists()            # once per publish, not per screen
                self.kinds_sent = found
            try:
                cb(self._with_kinds(self._with_features(self._personalise(base, self.personal(identity)), identity),
                                    identity, found))
                sent += 1
            except Exception:  # noqa: BLE001 -- one bad listener never stops the others
                log.exception("settings feed listener failed")
        if user_only is None:
            for fn in list(self.watchers):
                try:
                    fn()
                except Exception:  # noqa: BLE001 -- a watcher never stops the feed
                    log.exception("settings watcher failed")
        return sent

    # -- reads ----------------------------------------------------------------------------------
    @staticmethod
    def _only(msg: dict, required: set[str], optional: set[str] = frozenset()) -> None:
        extra = set(msg) - {"type", "id"} - required - set(optional)
        missing = required - set(msg)
        if extra or missing:
            raise SettingsError("invalid_format", fields={**{k: "unexpected" for k in sorted(extra)},
                                                          **{k: "required" for k in sorted(missing)}})

    def _scope(self, kind: Any, key: Any) -> Scope:
        if kind not in SCOPES or not isinstance(key, str):
            raise SettingsError("invalid_format", fields={"scope": "choice"})
        if kind == "house" and key not in HOUSE_DOCS:
            raise SettingsError("invalid_format", fields={"key": "choice"})
        if kind != "house" and not KEY_RE[kind].match(key):
            raise SettingsError("invalid_format", fields={"key": "invalid"})
        return Scope(kind, key)

    async def panel_get(self, identity: Any, msg: dict) -> dict:
        self._only(msg, set())
        if not await self.allowed(identity, Scope("house", "settings")):
            raise Forbidden("HK Settings needs configure on settings")
        return self.panel_payload()

    async def get(self, identity: Any, msg: dict) -> dict:
        self._only(msg, {"scope", "key"})
        scope = self._scope(msg["scope"], msg["key"])
        if not await self.allowed(identity, scope):
            raise Forbidden(f"may not read {scope}")
        d = self.store.get(scope.kind, scope.key)
        return {"scope": scope.kind, "key": scope.key, "version": d.version if d else 0, "body": d.body if d else {}}

    async def grid_starter(self, identity: Any, msg: dict) -> dict:
        self._only(msg, {"options"})
        if not await self.allowed(identity, Scope("house", "settings")):
            raise Forbidden("Home Grid needs configure on settings")
        from hk_core.settings.home_grid import starter_request, GridInvalid
        try:
            return {"grid": starter_request(msg["options"])}
        except GridInvalid as exc:
            raise SettingsError("invalid_format", fields={"home_grid": exc.code}) from exc

    async def history(self, identity: Any, msg: dict) -> dict:
        self._only(msg, {"scope", "key"}, {"limit", "bodies"})
        scope = self._scope(msg["scope"], msg["key"])
        if not await self.allowed(identity, scope):
            raise Forbidden(f"may not read the history of {scope}")
        limit = msg.get("limit", 50)
        if not isinstance(limit, int) or isinstance(limit, bool):
            raise SettingsError("invalid_format", fields={"limit": "number"})
        d = self.store.get(scope.kind, scope.key)
        return {"scope": scope.kind, "key": scope.key, "version": d.version if d else 0,
                "history": self.store.history(scope.kind, scope.key, limit, bool(msg.get("bodies")))}

    # -- saves ----------------------------------------------------------------------------------
    async def save(self, identity: Any, msg: Any, label: str | None = None) -> Any:
        """One save, as the page sends it to HA (same type, same keys). Raises SettingsError. ``label``: where
        it came from, for the history (linked_settings.py: "Home Assistant")."""
        if not isinstance(msg, dict) or not isinstance(msg.get("type"), str):
            raise SettingsError("invalid_format", fields={"type": "required"})
        t = msg["type"]
        kind = SAVE_KINDS.get(t)
        if kind is None:
            raise SettingsError("unknown_type", f"{t!r} is not a settings save")
        if kind == "feature":
            return await self._feature_save(identity, msg)
        if kind != "settings":
            raise SettingsError(kind, REFUSALS[kind])
        required, optional = WRITE_KEYS[t]
        self._only(msg, required, optional)
        actor = actor_of(identity, label)
        handler = getattr(self, "_" + t.split("/", 1)[1].replace("/", "_"))
        return await handler(identity, actor, msg)

    async def _feature_save(self, identity: Any, msg: dict) -> Any:
        """A feature page's save (HK Settings -> Features): Mantel's feature host checks it with the shared
        checks and stores it in ``house/mantel_features`` (feature_pages.py). Without a feature host: not yet."""
        pages = getattr(self.features, "pages", None)
        if pages is None:
            raise SettingsError("not_yet", REFUSALS["not_yet"])
        from ..feature_pages import PageError
        try:
            return await pages.save(identity, msg)
        except PageError as exc:
            if exc.code == "forbidden":
                log.warning("refused a feature settings change: %s", msg.get("type"))
            raise SettingsError(exc.code, str(exc), exc.fields or None) from None

    def _store(self, changes: list[tuple[str, str, dict]], actor: Actor, msg: dict, user_only: str | None = None,
               **kw) -> list[Doc]:
        if actor.label and "source" not in kw:
            kw["source"] = actor.label        # where a save came from ("Home Assistant": linked_settings.py)
        got = self.store.write(changes, actor=actor, message=msg["type"], **kw)
        if got:
            self.publish(user_only=user_only)
        return got

    def _house_version(self) -> int:
        d = self.store.get("house", "settings")
        return d.version if d else 0

    async def _settings_set(self, identity, actor, msg):
        """House settings. With ``expect_version`` (panel/get's versions["house"]; Edit mode's Room Order sends
        it): an older one is a `conflict` and nothing is written, as board/set's SET-7. The answer carries the
        document's version either way."""
        opened = msg.get("expect_version")
        if "expect_version" in msg and type(opened) is not int:
            raise SettingsError("invalid_format", fields={"expect_version": "number"})
        await self.need(identity, Scope("house", "settings"))
        expect = None if opened is None else {("house", "settings"): opened}
        self._store([("house", "settings", self._apply_house(msg["changes"]))], actor, msg, expect=expect)
        return {"settings": self.house_settings(), "version": self._house_version()}

    async def _calendar_color(self, identity, actor, msg):
        key, color = msg["key"], msg.get("color")
        if not isinstance(key, str) or not 5 <= len(key) <= 240:
            raise SettingsError("invalid_format", fields={"key": "invalid"})
        if color is not None and color not in PILL_COLORS:
            raise SettingsError("invalid_format", fields={"color": "choice"})
        await self.need(identity, Scope("house", "settings"))
        house = self.house_settings()
        cur = dict((house.get("calendar") or {}).get("event_colors") or {})
        if color:
            cur[key] = color
        else:
            cur.pop(key, None)
        self._store([("house", "settings", self._apply_house({"calendar.event_colors": cur}))], actor, msg)
        return {"event_colors": cur}

    async def _board_set(self, identity, actor, msg):
        dash = msg["dashboard"]
        if not isinstance(dash, str) or not KEY_RE["board"].match(dash):
            raise SettingsError("invalid_format", fields={"dashboard": "invalid"})
        # SET-7: the version the editor opened (panel/get's versions["board/<dash>"]); an older one is a
        # `conflict` (someone else saved meanwhile) and nothing is written. Without it the save goes as before.
        opened = msg.get("expect_version")
        if "expect_version" in msg and type(opened) is not int:
            raise SettingsError("invalid_format", fields={"expect_version": "number"})
        await self.need(identity, Scope("board", dash))
        cur = self.store.get("board", dash)
        if cur is None:
            raise SettingsError("no_item", "This dashboard has no item yet")
        new, errors = self.model.apply_board(cur.body, msg["changes"])
        if errors:
            raise SettingsError("invalid_format", fields=errors)
        got = self._store([("board", dash, new)], actor, msg,
                          expect={("board", dash): cur.version if opened is None else opened})
        return {"board": self.store.body("board", dash), "version": got[0].version if got else cur.version}

    async def _tablet_set(self, identity, actor, msg):
        tid = msg["tablet"]
        if not isinstance(tid, str) or not KEY_RE["tablet"].match(tid):
            raise SettingsError("no_tablet", "There is no such tablet")
        await self.need(identity, Scope("tablet", tid))
        cur = self.store.get("tablet", tid)
        if cur is None:
            raise SettingsError("no_tablet", "There is no such tablet")
        new, errors = self.model.apply_tablet(cur.body, msg["changes"], tid)
        if errors:
            raise SettingsError("invalid_format", fields=errors)
        self._store([("tablet", tid, new)], actor, msg, expect={("tablet", tid): cur.version})
        return {"tablet": self.store.body("tablet", tid)}

    async def _setup_done(self, identity, actor, msg):
        if not isinstance(msg["done"], bool):
            raise SettingsError("invalid_format", fields={"done": "bool"})
        await self.need(identity, Scope("house", "setup"))
        self._store([("house", "setup", {**self.store.body("house", "setup"), "setup_done": msg["done"]})], actor, msg)
        return {"setup_done": msg["done"]}

    async def _chip_save(self, identity, actor, msg):
        await self.need(identity, Scope("house", "custom_chips"))
        chips = self._items("custom_chips")
        data, errors = self.model.chip(msg["name"], msg.get("after"), msg["card"])
        key = msg.get("key")
        if key and not any(c.get("key") == key for c in chips):
            errors["key"] = "chip_gone"
        if errors:
            raise SettingsError("invalid_format", fields=errors)
        if not key:
            taken = {c.get("key") for c in chips} | {p.get("path") for p in self._items("custom_pages")}
            base = (_slug(data["name"]) or "chip")[:36]
            key, n = base, 2
            while key in taken:
                key, n = f"{base}-{n}", n + 1
            chips.append({"key": key, **data})
        else:
            chips = [{"key": key, **data} if c.get("key") == key else c for c in chips]
        chips.sort(key=lambda c: str(c.get("name", "")).lower())
        self._store([("house", "custom_chips", {"items": chips})], actor, msg)
        return {"key": key, "custom_chips": chips}

    async def _chip_remove(self, identity, actor, msg):
        key = msg["key"]
        await self.need(identity, Scope("house", "custom_chips"))
        chips = self._items("custom_chips")
        if not isinstance(key, str) or not any(c.get("key") == key for c in chips):
            raise SettingsError("invalid_format", fields={"key": "chip_gone"})
        changes: list[tuple[str, str, dict]] = [
            ("house", "custom_chips", {"items": [c for c in chips if c.get("key") != key]})]
        token = CHIP_TOKEN + key
        for path, d in self.store.docs("board").items():      # and from every screen that listed it
            mine, order = list(d.body.get("chips_custom") or []), list(d.body.get("chips") or [])
            if key in mine or token in order:
                if not await self.allowed(identity, Scope("board", path)):
                    raise SettingsError("forbidden", f"may not change board/{path}")
                changes.append(("board", path, {**d.body, "chips_custom": [k for k in mine if k != key],
                                                "chips": [k for k in order if k != token]}))
        self._store(changes, actor, msg)                       # one transaction, all or nothing
        return {"custom_chips": self._items("custom_chips")}

    async def _settings_user_set(self, identity, actor, msg):
        uid = msg.get("user_id") or _sides(identity)[0]
        if not isinstance(uid, str) or not KEY_RE["user"].match(uid):
            raise SettingsError("invalid_format", fields={"user_id": "required"})
        await self.need(identity, Scope("user", uid))
        if not self.store.user_exists(uid):
            raise SettingsError("no_user", "There is no such user")
        new, errors = self.model.apply_user(self.store.body("user", uid), msg["changes"], self.house_settings())
        if errors:
            raise SettingsError("invalid_format", fields=errors)
        self._store([("user", uid, new)], actor, msg, user_only=uid)
        return {"user_id": uid, "settings": self.store.body("user", uid)}

    async def _settings_restore(self, identity, actor, msg):
        scope = self._scope(msg["scope"], msg["key"])
        version = msg["version"]
        if not isinstance(version, int) or isinstance(version, bool) or version < 1:
            raise SettingsError("invalid_format", fields={"version": "number"})
        if scope == Scope("house", "catalog"):
            raise SettingsError("forbidden", "the catalog is not edited")
        await self.need(identity, scope)
        body = self.store.version_body(scope.kind, scope.key, version)
        if body is None:
            raise SettingsError("no_version", f"{scope} has no version {version}")
        self.model.check_document(scope.kind, scope.key, body)
        # an old version of the house settings stored merged (before 0.1.78) comes back as the differences
        normalise = stored_house if scope == Scope("house", "settings") and looks_merged(body) else None
        got = self.store.restore(scope.kind, scope.key, version, actor=actor, message=msg["type"], normalise=normalise)
        if got:
            self.publish(user_only=scope.key if scope.kind == "user" else None)
        d = self.store.get(scope.kind, scope.key)
        return {"scope": scope.kind, "key": scope.key, "version": d.version if d else 0, "restored_from": version,
                "changed": got is not None}


    # -- Wall Tablets' Add and Remove, a screen's title (HK Frontend's panel.py, now Mantel's) ------------------
    async def _tablet_add(self, identity, actor, msg):
        """A new tablet (Add Tablet): its settings checked as any change, its id from its name."""
        given = msg["tablet"]
        if not isinstance(given, dict):
            raise SettingsError("invalid_format", fields={"tablet": "object"})
        tid = SM.tablet_id(str(given.get("name") or ""), set(self.store.docs("tablet")))
        if not KEY_RE["tablet"].match(tid):
            raise SettingsError("invalid_format", fields={"name": "name_needed"})
        await self.need(identity, Scope("tablet", tid))
        return self.add_tablet(given, actor, msg["type"], tid=tid)

    def add_tablet(self, given: dict, actor: Actor, message: str, *, tid: str | None = None) -> dict:
        """Write a new HK tablet (its settings checked by the model) and publish it. The caller has decided who may:
        the socket's Add Tablet through RBAC (``_tablet_add``), enrolment as an Owner or Admin (devices.enroll)."""
        tid = tid or SM.tablet_id(str(given.get("name") or ""), set(self.store.docs("tablet")))
        if not KEY_RE["tablet"].match(tid):
            raise SettingsError("invalid_format", fields={"name": "name_needed"})
        new, errors = self.model.apply_tablet({}, {"name": "", **given}, tid)
        if errors:
            raise SettingsError("invalid_format", fields=errors)
        new["uid"] = f"tablet_{tid}"
        self._store([("tablet", tid, new)], actor, {"type": message})
        return {"id": tid, "tablet": self.store.body("tablet", tid)}

    async def _tablet_remove(self, identity, actor, msg):
        """A tablet gone: its document (its history stays); its screen and its kiosk app stay."""
        tid = msg["tablet"]
        if not isinstance(tid, str) or not KEY_RE["tablet"].match(tid) or self.store.get("tablet", tid) is None:
            raise SettingsError("no_tablet", "There is no such tablet")
        await self.need(identity, Scope("tablet", tid))
        self.store.remove("tablet", tid, actor=actor, message=msg["type"])
        self.publish()
        return {"removed": tid}

    async def _dashboard_titled(self, identity, actor, msg):
        """HK Settings asks this after renaming a screen: on Mantel a screen's title is its board's own, so this
        only answers it (HK Frontend followed an HA dashboard's title here)."""
        path = msg["dashboard"]
        if not isinstance(path, str) or not KEY_RE["board"].match(path) or self.store.get("board", path) is None:
            raise SettingsError("no_dashboard", "There's no dashboard at that address")
        await self.need(identity, Scope("board", path))
        return {"title": self.screen_title(path, self.store.body("board", path))}

    # -- accessories, favorites, Hidden Accessories (HK Frontend's accessories.py and hiding.py, now Mantel's) ---
    def _accessories(self) -> dict:
        return ACC.clean(self.store.body("house", "accessories"))

    def _acc_version(self) -> int:
        d = self.store.get("house", "accessories")
        return d.version if d else 0

    async def _acc_change(self, identity, actor, msg, work):
        """One change to the accessories document. With ``expect_version`` (panel/get's versions["accessories"],
        as board/set's SET-7; Edit mode sends it): an older one is a `conflict` and nothing is written, and the
        answer carries the new version -- a dict answer (set, room_scenes) gains "version", a list answer (order,
        page_order) comes as {"entities": [...], "version": n}. Without it the answer is as before."""
        opened = msg.get("expect_version")
        if "expect_version" in msg and type(opened) is not int:
            raise SettingsError("invalid_format", fields={"expect_version": "number"})
        await self.need(identity, Scope("house", "accessories"))
        try:
            doc, answer = work(self._accessories())
        except ACC.Refused as exc:
            raise SettingsError("invalid_format", fields=exc.fields) from None
        if opened is None:
            self._store([("house", "accessories", doc)], actor, msg)
            return answer
        self._store([("house", "accessories", doc)], actor, msg, expect={("house", "accessories"): opened})
        version = self._acc_version()
        return {**answer, "version": version} if isinstance(answer, dict) else {"entities": answer, "version": version}

    async def _accessory_set(self, identity, actor, msg):
        changes = {k: msg[k] for k in ACC.FIELDS if k in msg}
        return await self._acc_change(identity, actor, msg,
                                      lambda d: ACC.set_one(d, msg["entity_id"], changes, msg.get("screen")))

    async def _accessory_order(self, identity, actor, msg):
        return await self._acc_change(identity, actor, msg, lambda d: ACC.order(d, msg["area_id"], msg["entities"]))

    async def _accessory_into(self, identity, actor, msg):
        return await self._acc_change(identity, actor, msg, lambda d: ACC.into(d, msg["area_id"], msg["into"]))

    async def _accessory_page_order(self, identity, actor, msg):
        return await self._acc_change(identity, actor, msg, lambda d: ACC.page_order(d, msg["page"], msg["entities"]))

    async def _accessory_room_scenes(self, identity, actor, msg):
        def work(d):
            doc, scenes = ACC.room_scenes(d, msg["area_id"], msg["entities"])
            return doc, {"scenes": scenes}
        return await self._acc_change(identity, actor, msg, work)

    async def _board_favorite(self, identity, actor, msg):
        """An accessory added to (or taken off) one screen's Favorites, at the end (HK's board/favorite)."""
        dash, eid, on = msg["dashboard"], msg["entity_id"], msg["favorite"]
        if not isinstance(dash, str) or not KEY_RE["board"].match(dash):
            raise SettingsError("invalid_format", fields={"dashboard": "invalid"})
        if not isinstance(eid, str) or not ACC.ENTITY.match(eid):
            raise SettingsError("invalid_format", fields={"entity_id": "invalid"})
        if not isinstance(on, bool):
            raise SettingsError("invalid_format", fields={"favorite": "bool"})
        await self.need(identity, Scope("board", dash))
        cur = self.store.get("board", dash)
        if cur is None:
            raise SettingsError("no_item", "This dashboard has no item yet")
        favs = [f for f in (cur.body.get("favorites") or []) if f != eid]
        if on:
            favs.append(eid)
        self._store([("board", dash, {**cur.body, "favorites": favs})], actor, msg, expect={("board", dash): cur.version})
        return {"favorites": favs}

    def _hiding(self):
        hiding = self.hiding() if callable(self.hiding) else None
        if hiding is None or not hiding.ready:
            raise SettingsError("unavailable", "Mantel has no copy of the house to work Hidden Accessories out from")
        return hiding

    def _hide_settings(self) -> dict:
        return {**self.house_settings(), "accessories": self._accessories()}

    @staticmethod
    def _hide_ids(msg) -> list[str]:
        ids = msg["entity_ids"]
        if not isinstance(ids, list) or not 1 <= len(ids) <= ACC.IDS_MAX or \
                not all(isinstance(i, str) and ACC.ENTITY.match(i) for i in ids):
            raise SettingsError("invalid_format", fields={"entity_ids": "invalid"})
        return list(dict.fromkeys(ids))

    async def _hide_write(self, identity, actor, msg, changes: dict, acc_changes: dict) -> None:
        writes: list[tuple[str, str, dict]] = []
        if changes:
            await self.need(identity, Scope("house", "settings"))
            writes.append(("house", "settings", self._apply_house(changes)))
        if acc_changes:
            await self.need(identity, Scope("house", "accessories"))
            writes.append(("house", "accessories", ACC.set_many(self._accessories(), acc_changes)))
        if writes:
            self._store(writes, actor, msg)                     # one transaction, as HA's one save

    async def _hidden_set(self, identity, actor, msg):
        """Hide these accessories everywhere, or from exactly the places given (HK's hidden/set)."""
        from ..hidden import ORDER
        await self.need(identity, Scope("house", "settings"))
        ids, places = self._hide_ids(msg), msg.get("places", {})
        if not isinstance(msg["everywhere"], bool):
            raise SettingsError("invalid_format", fields={"everywhere": "bool"})
        if not isinstance(places, dict) or not all(k in ORDER and isinstance(v, bool) for k, v in places.items()):
            raise SettingsError("invalid_format", fields={"places": "invalid"})
        hiding = self._hiding()
        changes, acc_changes = hiding.plan(self._hide_settings(), ids, msg["everywhere"], places)
        await self._hide_write(identity, actor, msg, changes, acc_changes)
        return hiding.snapshot(self._hide_settings(), ids)

    async def _hidden_also(self, identity, actor, msg):
        """Also count these accessories in (or no longer in) the kinds given (HK's hidden/also)."""
        from hk_core.settings.kinds import KINDS
        await self.need(identity, Scope("house", "settings"))
        ids, kinds = self._hide_ids(msg), msg["kinds"]
        if not isinstance(kinds, dict) or not all(k in KINDS and isinstance(v, bool) for k, v in kinds.items()):
            raise SettingsError("invalid_format", fields={"kinds": "invalid"})
        hiding = self._hiding()
        changes = hiding.also_plan(self._hide_settings(), ids, kinds)
        await self._hide_write(identity, actor, msg, changes, {})
        return hiding.snapshot(self._hide_settings(), ids)
