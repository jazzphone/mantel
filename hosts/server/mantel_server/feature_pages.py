"""HK Settings -> Features on Mantel: each feature's own settings page (docs/phase4/MANTEL-FEATURES.md
"Phase 4 ports").

HK Settings reads a feature's page with that feature's ``<id>/settings/get`` and saves it one change at a
time with ``/set`` (and Notifications' ``item/save``, ``item/remove``, ``test``; Energy's ``device/set``,
``device/section``), whose answer is the page again (``web/hk/panels/hk-settings.js`` ``featLoad`` /
``featSet`` / ``featCall``). Until now those reads were server-only on Mantel (the feature import's), so a
page failed to load. Here Mantel answers them itself:

* **Reads** (``app["read_routes"]``, never forwarded): Notifications, Clean Areas, Energy and Live TV from
  Mantel's own feature settings (``house/mantel_features``) and its House (MantelHouse), in exactly HA's
  page shapes, worked out by the same shared rules (``hk_core.notifications.settings.page``,
  ``hk_core.clean_areas``, ``hk_core.energy.plan``). Music: Mantel's own music settings (music.py's
  ``MusicHost.page``, Music Assistant or not; HK Frontend's imported ONCE when Mantel has none). Alarm PIN:
  Mantel's keypad table (alarm_pin.py ``settings_page``; HA's page only while HK Frontend still runs the keypads).
* **Saves** (the page's ``settings_write``, through ``settings_store.SettingsService``): checked by the same
  shared checks HA uses (``hk_core.notifications.settings``, ``hk_core.energy.settings``, Clean Areas' and
  Live TV's field checks), written to Mantel's settings store as a new version of ``house/mantel_features``
  (who, which device, the diff: audited), never to Home Assistant. Music's go to ``house/music``; Alarm PIN's
  to Mantel's keypad table (alarm_pin.py ``settings_save``: HA first only while HK Frontend runs the keypads).
* **Who**: Owners and Admins. Each read and save asks RBAC ``configure`` on the ``settings`` feature, and on
  the feature itself where RBAC has one (``notifications``, ``energy``, ``music``). HA's are admin-only.
  No HA token or credential is in any answer; entity ids are the house's own.
"""
from __future__ import annotations

import copy
import logging
import re
from typing import TYPE_CHECKING, Any, Mapping

from hk_core import clean_areas as CA
from hk_core.energy import plan as EP
from hk_core.energy import settings as ES
from hk_core.energy.const import COLORS, OPTION_KEYS as ENERGY_KEYS, SECTIONS
from hk_core.notifications import banner as NB
from hk_core.notifications import rules as NR
from hk_core.notifications import settings as NS
from hk_core.notifications.accessories import members
from hk_core.notifications.const import CONF_ITEMS, ITEMS_MAX

if TYPE_CHECKING:
    from .features import FeatureHost

log = logging.getLogger("mantel.feature_pages")

# the page reads Mantel answers: HA message type -> (piece, how it is answered)
PAGE_READS: dict[str, str] = {
    "hk_notify/settings/get": "notifications",
    "hk_clean_areas/settings/get": "clean_areas",
    "hk_energy/settings/get": "energy",
    "hk_tv/settings/get": "live_tv",
    "hk_music/settings/get": "music",
    "hk_alarm_pin/settings/get": "alarm_pin",
}
# one rule per read (pinned by tests/test_feature_pages.py), as readproxy.RULES / features.ROUTE_RULES
PAGE_RULES: dict[str, str] = {
    "hk_notify/settings/get": "configure on settings and notifications; Mantel's notifications piece over MantelHouse "
                              "(hk_core notifications.settings.page); carries fresh only",
    "hk_clean_areas/settings/get": "configure on settings; Mantel's clean_areas piece over MantelHouse",
    "hk_energy/settings/get": "configure on settings and energy; Mantel's energy piece, HA's Energy settings read by "
                              "Mantel itself, the plan over MantelHouse; carries fresh only",
    "hk_tv/settings/get": "configure on settings; Mantel's live_tv piece and its own lineup copy (no tuner read); "
                          "carries fresh only",
    "hk_music/settings/get": "configure on settings and music; Mantel's own music settings (house/music) in HA's page "
                             "shape; HK Frontend's imported once (a server-only read) when Mantel has none",
    "hk_alarm_pin/settings/get": "configure on settings; Mantel's keypad table (no PIN, only pin_set); while HK Frontend "
                                 "runs the keypads, HA's page (a server-only read) rebuilt key by key",
}
# the page's saves Mantel takes (settings_store.FEATURE_SAVES, mantel-client.js FEATURE_SAVES): type ->
# (piece, required keys, optional keys)
SAVES: dict[str, tuple[str, frozenset, frozenset]] = {
    "hk_notify/settings/set": ("notifications", frozenset({"changes"}), frozenset()),
    "hk_notify/item/save": ("notifications", frozenset({"changes"}), frozenset({"item"})),
    "hk_notify/item/remove": ("notifications", frozenset({"item"}), frozenset()),
    "hk_notify/test": ("notifications", frozenset({"item"}), frozenset()),
    "hk_clean_areas/settings/set": ("clean_areas", frozenset({"changes"}), frozenset()),
    "hk_energy/settings/set": ("energy", frozenset({"changes"}), frozenset()),
    "hk_energy/device/set": ("energy", frozenset({"key", "changes"}), frozenset()),
    "hk_energy/device/section": ("energy", frozenset({"key", "section"}), frozenset()),
    "hk_tv/settings/set": ("live_tv", frozenset({"changes"}), frozenset()),
    # Music's settings: house/music (music.py MusicHost.settings_write), Music Assistant or not
    "hk_music/settings/set": ("music", frozenset({"changes"}), frozenset()),
    "hk_music/preset/save": ("music", frozenset({"name", "group", "members"}), frozenset({"item"})),
    "hk_music/playlist/save": ("music", frozenset({"name", "items"}), frozenset({"item", "icon", "chooser", "order"})),
    "hk_music/playlists/order": ("music", frozenset({"ids"}), frozenset()),
    "hk_music/item/remove": ("music", frozenset({"item"}), frozenset()),
    # the Alarm PIN: Mantel's keypad table (alarm_pin.py "HK Settings' Alarm PIN page")
    "hk_alarm_pin/settings/set": ("alarm_pin", frozenset({"entry_id", "changes"}), frozenset()),
    "hk_alarm_pin/add": ("alarm_pin", frozenset({"alarm"}), frozenset({"pin", "pin_again", "arm_required"})),
    "hk_alarm_pin/remove": ("alarm_pin", frozenset({"entry_id"}), frozenset()),
}
# RBAC features (rbac.FEATURE_DOMAINS) a page also needs `configure` on, besides `settings`
RBAC_FEATURE = {"notifications": "notifications", "energy": "energy", "music": "music"}
TITLES = {"notifications": "Notifications", "clean_areas": "Clean Areas", "energy": "Energy", "live_tv": "Live TV",
          "music": "Music", "alarm_pin": "Alarm PIN"}

ENTITY = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
CHANNEL = re.compile(r"^\d{1,4}(\.\d{1,4})?$")
TV_NAME_MAX = 40
CA_MSG = {"vacuums": "That isn’t a vacuum in this house.", "areas": "That isn’t an area in this house.",
          "list": "That list couldn’t be read.", "unknown": "That setting doesn’t exist."}
TV_MSG = {"guide_url": "Enter an address starting with http:// or https://, or leave it empty.",
          "pick_one": "Choose at least one channel.", "not_a_channel": "That isn’t a channel this tuner has.",
          "name": "Give it a name (up to 40 characters).", "name_taken": "Another channel has that name.",
          "host": "Enter the tuner’s address.", "unknown": "That setting doesn’t exist.",
          "quality": "Choose 720p or 1080p.",
          "no_lineup": "Mantel hasn’t read this tuner’s lineup, so only channels already chosen can be kept."}


class PageError(Exception):
    """A refused read or save: ``code`` (invalid_format, not_found, not_set_up, forbidden, ...) and, for
    invalid_format, the refusals by field (``fields``)."""

    def __init__(self, code: str, message: str = "", fields: Mapping[str, str] | None = None) -> None:
        super().__init__(message or code)
        self.code, self.fields = code, dict(fields or {})


def _s(v: Any, most: int = 200) -> str | None:
    return v[:most] if isinstance(v, str) else None


def _ents(v: Any) -> list[str]:
    return [x for x in v if isinstance(x, str) and ENTITY.match(x)] if isinstance(v, list) else []


# ----------------------------------------------------------------------- interim: Music, Alarm PIN
def music_page(res: Any) -> dict[str, Any]:
    """HA's hk_music/settings/get answer rebuilt from its known keys (music/settings_ws.py page)."""
    if not isinstance(res, Mapping) or not res.get("configured"):
        return {"configured": False}

    def rows(v: Any, keys: tuple[str, ...]) -> list[dict[str, Any]]:
        return [{k: x.get(k) for k in keys} for x in (v if isinstance(v, list) else []) if isinstance(x, Mapping)]
    homes = res.get("homes") if isinstance(res.get("homes"), Mapping) else {}
    last = res.get("keep_ready_last") if isinstance(res.get("keep_ready_last"), Mapping) else None
    return {
        "configured": True, "state": _s(res.get("state"), 40),
        "speakers": rows(res.get("speakers"), ("entity", "name", "floor", "player")),
        "volume": res.get("volume") if isinstance(res.get("volume"), (int, float)) else None,
        "homes": {str(k)[:64]: (v if isinstance(v, str) and ENTITY.match(v) else None) for k, v in homes.items()},
        "users": rows(res.get("users"), ("id", "name")),
        "presets": rows(res.get("presets"), ("id", "name", "group", "group_name", "members")),
        "playlists": rows(res.get("playlists"), ("id", "name", "icon", "items", "chooser", "order")),
        "players": rows(res.get("players"), ("entity", "name")),
        "library_ready": bool(res.get("library_ready")),
        "ignore_announcements": bool(res.get("ignore_announcements")),
        "keep_ready": bool(res.get("keep_ready")),
        "keep_ready_last": {k: last.get(k) for k in ("at", "ready", "wanted", "note")} if last else None,
    }


def _mantel_pin_set(pins: Any, a: Mapping[str, Any]) -> bool:
    panel = a.get("panel")
    try:
        e = pins.entry(panel) if isinstance(panel, str) else None
    except Exception:  # noqa: BLE001 -- the page still opens
        return False
    return bool(e is not None and e.house_code)


def alarm_pin_page(res: Any, pins: Any = None) -> dict[str, Any]:
    """HA's hk_alarm_pin/settings/get answer rebuilt (alarm_pin/settings_ws.py page): never a PIN or
    its hash, only whether one is set -- in Mantel (``pins``, alarm_pin.AlarmPins), whose keypads check it;
    HA's own says nothing about what a tablet will accept."""
    if not isinstance(res, Mapping):
        return {"configured": False, "alarms": [], "choices": []}
    alarms = [{"entry_id": _s(a.get("entry_id"), 64), "title": _s(a.get("title"), 80), "state": _s(a.get("state"), 40),
               "alarm": _s(a.get("alarm"), 255), "alarm_name": _s(a.get("alarm_name")), "panel": _s(a.get("panel"), 255),
               "panel_name": _s(a.get("panel_name")), "arm_required": bool(a.get("arm_required")),
               "pin_set": _mantel_pin_set(pins, a) if pins is not None else bool(a.get("pin_set"))}
              for a in res.get("alarms") or [] if isinstance(a, Mapping)]
    choices = [{"entity_id": _s(c.get("entity_id"), 255), "name": _s(c.get("name")), "entry": _s(c.get("entry"), 64)}
               for c in res.get("choices") or [] if isinstance(c, Mapping)]
    return {"configured": bool(res.get("configured")),
            "min_length": res.get("min_length") if isinstance(res.get("min_length"), int) else None,
            "alarms": alarms, "choices": choices}


# --------------------------------------------------------------------------------------- the pages
class FeaturePages:
    """The pages and their saves, over the feature host (``app["features"]``)."""

    def __init__(self, host: "FeatureHost") -> None:
        self.host = host

    # -- RBAC ------------------------------------------------------------------------------------
    def may_configure(self, identity: Any, piece: str) -> bool:
        authz = self.host.app.get("authz")
        subject = getattr(identity, "subject", None)
        if authz is None or subject is None or not getattr(identity, "valid", True):
            return False
        try:
            for feature in ("settings", RBAC_FEATURE.get(piece)):
                if feature and authz.decide(subject, "configure", None, feature=feature).allowed is not True:
                    return False
        except Exception:  # noqa: BLE001 -- a failing rule refuses
            log.exception("feature pages: configure check failed; refusing")
            return False
        return True

    def need(self, identity: Any, piece: str) -> None:
        if not self.may_configure(identity, piece):
            raise PageError("forbidden", f"{TITLES.get(piece, piece)} settings need configure (Owner or Admin)")

    # -- the pages ---------------------------------------------------------------------------------
    async def page(self, piece: str) -> dict[str, Any]:
        h = self.host
        if piece == "notifications":
            if not h.on("notifications"):
                return {"configured": False}
            n = h.notifier
            return NS.page(h.house, n.opts, NB.mutes(dict(n.mutes), h.epoch()), "loaded")
        if piece == "clean_areas":
            return self.clean_page() if h.on("clean_areas") else {"configured": False}
        if piece == "energy":
            return await self.energy_page() if h.on("energy") else {"configured": False}
        if piece == "live_tv":
            return self.tv_page()
        if piece == "music":
            return await self.music_page()
        if piece == "alarm_pin":
            from . import alarm_pin
            return await alarm_pin.settings_page(h.app)
        raise PageError("unknown_type", piece)

    async def music_page(self) -> dict[str, Any]:
        """Music's page from Mantel's own ``house/music`` (music.py), never HA's. A house that still has HK
        Frontend's Music and no ``house/music`` yet gets it imported ONCE here (HA's page, a server-only read,
        the import's own ``music.import_page``); with Music Assistant in Mantel and nothing to import, Music is
        added in Mantel (the first save makes the document)."""
        h = self.host
        music = h.app.get("music")
        if music is None:
            return {"configured": False}
        if music.doc() is None:
            await self._import_music(music)
        return music.page(start=music.ma is not None)

    async def _import_music(self, music: Any) -> None:
        from . import music as M
        from .settings_store import Actor
        proxy = getattr(self.host.hub, "readproxy", None)
        read = getattr(proxy, "read_server", None)
        if read is None or music.store is None:
            return
        try:
            body = M.import_page(await read({"type": M.IMPORT_READ}), "ha")
        except Exception as exc:  # noqa: BLE001 -- no HK Frontend (or no HA): nothing to import
            log.info("music: no HK Frontend music settings to import (%s)", type(exc).__name__)
            return
        if body is None or music.store.get("house", M.MUSIC_DOC) is not None:
            return
        music.store.write([("house", M.MUSIC_DOC, body)], actor=Actor(label="import"), action="import",
                          message=M.IMPORT_READ, source="ha")
        music.changed()
        log.info("music: HK Frontend's music settings imported into Mantel (once)")

    def clean_page(self) -> dict[str, Any]:
        """Clean Areas' page (clean_areas/settings_ws.py page) over MantelHouse."""
        house, opts = self.host.house, self.host.settings["clean_areas"]["options"]
        cov = CA.coverage(house, opts)
        areas = {}
        for a in sorted(house.area_ids()):
            f = house.area_floor(a)
            areas[a] = {"id": a, "name": house.area_name(a) or a, "floor": f.name if f else None,
                        "level": f.level if f else None}

        def name(eid: str) -> str:
            st = house.state(eid)
            return str(st.attributes.get("friendly_name") or eid) if st else eid
        by: dict[str, list[str]] = {}
        for v in cov:
            if v["taking_part"]:
                for a in v["areas"]:
                    by.setdefault(a, []).append(name(v["vacuum"]))
        reach = CA.reachable(house, opts)
        return {"configured": True, "state": "loaded",
                "vacuums": [{**v, "name": name(v["vacuum"])} for v in cov],
                "chosen_vacuums": list(opts.get("vacuums") or []),
                "areas": [{**areas[a], "by": by.get(a, [])} for a in reach if a in areas],
                "chosen_areas": list(opts.get("areas") or []),
                "offered": CA.offered(house, opts),
                "unreached": [areas[a] for a in areas if a not in reach]}

    async def energy_page(self) -> dict[str, Any]:
        """Energy's page (energy/settings_ws.py page): the stored options, the plan, every device the page
        could show and the sections, from HA's Energy settings (read by Mantel) and MantelHouse."""
        prefs, opts, ctx = await self.host.energy_inputs()
        pl = EP.build(ctx, opts)
        devs = EP.devices(ctx, opts)
        names = {d["key"]: d["name"] for d in devs}
        bats = EP.batteries(ctx, opts)
        return {
            "configured": True, "state": "loaded",
            "options": {k: opts.get(k) for k in ENERGY_KEYS},
            "plan": pl,
            "devices": [{k: d.get(k) for k in ("key", "name", "raw", "stat", "power", "found", "section", "icon", "color",
                                               "control", "hidden", "extra", "parent", "children", "runtime")}
                        | {"parent_name": names.get(d.get("parent") or "")} for d in devs],
            "batteries": bats,
            "sections": EP.sections(devs, bats, opts),
            "section_kinds": [list(s) for s in SECTIONS],
            "grid": EP.grid_of(prefs),
            "energy": {"grid": bool(EP.grid_of(prefs)), "devices": len(prefs.get("device_consumption") or []),
                       "url": "/config/energy"},
            "colors": list(COLORS),
        }

    def tv_page(self) -> dict[str, Any]:
        """Live TV's page (live_tv/settings_ws.py _page) from Mantel's piece; the lineup is Mantel's own copy
        when its guide fetch has read the tuner (never read for the page)."""
        h = self.host
        cfg = h.settings["live_tv"]
        if not (h.on("live_tv") or "live_tv" in h.settings["ha"]["added"] or cfg["tuner"]):
            return {"configured": False}
        tv = h.app.get("live_tv")
        lineup = {c["number"]: c for c in h.tv.lineup}
        networks = {n: (g.get("network") or None) for n, g in h.tv.guide.items()}
        return {
            "configured": True, "state": "loaded" if (tv.piece_on() if tv is not None else h.on("live_tv")) else "not_loaded",
            "title": "Live TV", "host": cfg["tuner"], "guide_url": cfg["guide_url"],
            "quality": cfg["quality"],        # Mantel's transcode (live_tv.py go2rtc_source)
            "channels": [{"number": n, "name": cfg["names"].get(n) or (lineup.get(n) or {}).get("name") or n}
                         for n in cfg["channels"]],
            "lineup": [{"number": c["number"], "station": c.get("name") or c["number"], "network": networks.get(c["number"])}
                       for c in h.tv.lineup] if h.tv.lineup else None,
            "lineup_error": None if h.tv.lineup else (h.tv.error or TV_MSG["no_lineup"]),
        }

    # -- the saves -----------------------------------------------------------------------------------
    async def save(self, identity: Any, msg: dict[str, Any]) -> dict[str, Any]:
        t = msg.get("type")
        piece, required, optional = SAVES[t]
        missing, extra = required - set(msg), set(msg) - {"type", "id"} - required - optional
        if missing or extra:
            raise PageError("invalid_format", fields={**{k: "required" for k in sorted(missing)},
                                                      **{k: "unexpected" for k in sorted(extra)}})
        self.need(identity, piece)
        if piece in ("notifications", "clean_areas", "energy") and not self.host.on(piece):
            raise PageError("not_set_up", f"{TITLES[piece]} is off in Mantel's feature settings")
        if t == "hk_notify/test":
            return await self.notify_test(msg)
        if piece == "music":
            return await self.music_save(identity, t, msg)
        if piece == "alarm_pin":
            from . import alarm_pin
            return await alarm_pin.settings_save(self.host.app, identity, msg)
        settings = copy.deepcopy(self.host.settings)
        if not isinstance(msg.get("changes", {}), Mapping):
            raise PageError("invalid_format", fields={"changes": "invalid"})
        extra_answer: dict[str, Any] = {}
        if piece == "notifications":
            extra_answer = self._notify(settings["notifications"], t, msg)
        elif piece == "clean_areas":
            settings["clean_areas"]["options"] = self._clean(settings["clean_areas"]["options"], dict(msg["changes"]))
        elif piece == "energy":
            settings["energy"]["options"] = await self._energy(settings["energy"]["options"], t, msg)
        elif piece == "live_tv":
            self._tv(settings["live_tv"], dict(msg["changes"]))
        from .features import FEATURES_DOC, check_settings
        body = check_settings(settings)
        if body != self.host.settings:
            self.host.write_doc(FEATURES_DOC, body, identity, t)
            await self.host.reload()
        return {**await self.page(piece), **extra_answer}

    async def music_save(self, identity: Any, t: str, msg: dict[str, Any]) -> dict[str, Any]:
        """HK Settings' music saves on Mantel's ``house/music`` (music.py), refused by field as HA's were."""
        import json as _json
        from .music import MusicRefusal
        music = self.host.app.get("music")
        if music is None or music.store is None:
            raise PageError("not_set_up", "Music isn’t run by this Mantel")
        try:
            await music.settings_write(identity, t, {k: v for k, v in msg.items() if k not in ("type", "id")})
        except MusicRefusal as exc:
            fields = None
            if exc.code == "invalid_format":
                try:
                    fields = _json.loads(exc.message or "{}")
                except ValueError:
                    fields = None
            raise PageError(exc.code, str(exc), fields) from None
        return music.page()

    def _notify(self, piece: dict[str, Any], t: str, msg: dict[str, Any]) -> dict[str, Any]:
        """notifications/settings_ws.py's three saves, on Mantel's piece ({options, items})."""
        house = self.host.house
        items = [dict(i) for i in piece["items"]]
        if t == "hk_notify/settings/set":
            opts, errors = NS.apply_house(dict(piece["options"]), dict(msg["changes"]))
            if errors:
                raise PageError("invalid_format", fields=errors)
            piece["options"] = opts
            return {}
        if t == "hk_notify/item/remove":
            piece["items"] = [i for i in items if i.get("id") != msg["item"]]
            return {}
        changes, iid = dict(msg["changes"]), msg.get("item")
        taken = {str(i.get("id")) for i in items}
        if iid:
            at = next((n for n, i in enumerate(items) if i.get("id") == iid), None)
            if at is None:
                raise PageError("not_found", "No such notification")
            base = items[at]
        elif changes.get("category") is not None:
            key = changes.pop("category")
            if key not in NR.CATEGORY_KEYS or any(i.get("category") == key for i in items):
                raise PageError("invalid_format", fields={"category": "choice"})
            base, at = NS.new_category(key, taken), None
        else:
            if len(items) >= ITEMS_MAX:
                raise PageError("invalid_format", fields={"entity": "too_many"})
            try:
                ent = NS._entity(changes.get("entity"))
            except NS.Bad as err:
                raise PageError("invalid_format", fields={"entity": err.code}) from None
            base, at = NS.new_item(house, ent, taken), None
            changes.pop("entity", None)
        out, errors = NS.apply_item(house, base, changes)
        if errors:
            raise PageError("invalid_format", fields=errors)
        if at is None:
            items.append(out)
        else:
            items[at] = out
        piece["items"] = items
        return {"saved": out["id"]}

    async def notify_test(self, msg: dict[str, Any]) -> dict[str, Any]:
        """hk_notify/test: sent now, as if it went off (Mantel's own delivery; nothing reaches the house)."""
        h = self.host
        item = next((dict(i) for i in h.notifier.items if i.get("id") == msg["item"]), None)
        if item is None:
            raise PageError("not_found", "No such notification")
        eid = (members(h.house, item) or [None])[0]
        if eid is None:
            raise PageError("not_found", "It has no accessory to test with")
        if item.get("category") == "calendars":
            payload = await h.calendars.sample(item, members(h.house, item))
            sent = await h.notifier.send(payload, item.get("id"), eid)
            return {"sent": sent["id"], "snap": False}
        payload = NB.build(h.house, h.notifier.opts, item, h.house.state(eid), test=True, eid=eid)
        sent = await h.notifier.send(payload, item.get("id"), eid)
        return {"sent": sent["id"], "snap": bool(sent.get("snap"))}

    def _clean(self, opts: dict[str, Any], changes: dict[str, Any]) -> dict[str, Any]:
        """clean_areas/settings_ws.py apply, over MantelHouse."""
        out, errors = dict(opts), {}
        vacuums = {v["vacuum"] for v in CA.coverage(self.host.house, {})}
        areas = self.host.house.area_ids()
        for k, v in changes.items():
            if k not in ("vacuums", "areas"):
                errors[k] = CA_MSG["unknown"]
            elif not isinstance(v, list) or not all(isinstance(x, str) for x in v):
                errors[k] = CA_MSG["list"]
            elif any(x not in (vacuums if k == "vacuums" else areas) for x in v):
                errors[k] = CA_MSG[k]
            else:
                out[k] = list(dict.fromkeys(v))
        if errors:
            raise PageError("invalid_format", fields=errors)
        return out

    async def _energy(self, opts: dict[str, Any], t: str, msg: dict[str, Any]) -> dict[str, Any]:
        """energy/settings_ws.py's three saves, with the shared checks (hk_core.energy.settings)."""
        if t == "hk_energy/settings/set":
            out, errors = ES.apply(dict(opts), dict(msg["changes"]))
            if errors:
                raise PageError("invalid_format", fields=errors)
            return out
        if not isinstance(msg.get("key"), str):
            raise PageError("invalid_format", fields={"key": "invalid"})
        if t == "hk_energy/device/set":
            out, err = ES.apply_device(dict(opts), msg["key"], dict(msg["changes"]))
            if err:
                raise PageError("invalid_format", fields={k: err for k in msg["changes"]})
            return out
        if not isinstance(msg.get("section"), str):
            raise PageError("invalid_format", fields={"section": "invalid"})
        _prefs, _o, ctx = await self.host.energy_inputs()
        devs, bats = EP.devices(ctx, opts), EP.batteries(ctx, opts)
        placed = EP.sections(devs, bats, opts)
        keys = {d["key"] for d in devs} | {b["key"] for b in bats}
        out, errors = ES.move_device(dict(opts), placed, keys, msg["key"], msg["section"])
        if errors:
            raise PageError("invalid_format", fields=errors)
        return out

    def _tv(self, piece: dict[str, Any], changes: dict[str, Any]) -> None:
        """live_tv/settings_ws.py apply, on Mantel's piece: the tuner's address, the guide, the channels
        and their names. Checked against Mantel's own lineup copy (no tuner is read for a save)."""
        from .features import _HOST, _URL
        errors: dict[str, str] = {}
        for k in changes:
            if k not in ("host", "guide_url", "channels", "names", "quality"):
                errors[k] = TV_MSG["unknown"]
        if "quality" in changes:
            if str(changes["quality"]) not in ("720", "1080"):
                errors["quality"] = TV_MSG["quality"]
            else:
                piece["quality"] = str(changes["quality"])
        if errors:
            raise PageError("invalid_format", fields=errors)
        if "host" in changes:
            host = str(changes["host"] or "").strip()
            if not host or not (_HOST.match(host) or _URL.match(host)):
                errors["host"] = TV_MSG["host"]
            else:
                piece["tuner"] = host
        if "guide_url" in changes:
            guide = str(changes["guide_url"] or "").strip()
            if guide and not _URL.match(guide):
                errors["guide_url"] = TV_MSG["guide_url"]
            else:
                piece["guide_url"] = guide
        if "channels" in changes:
            nums = changes["channels"]
            have = {c["number"] for c in self.host.tv.lineup} | set(piece["channels"])
            if not isinstance(nums, list) or not all(isinstance(n, str) and CHANNEL.match(n) for n in nums):
                errors["channels"] = TV_MSG["not_a_channel"]
            elif not nums:
                errors["channels"] = TV_MSG["pick_one"]
            elif any(n not in have for n in nums):
                errors["channels"] = TV_MSG["not_a_channel"] if self.host.tv.lineup else TV_MSG["no_lineup"]
            else:
                piece["channels"] = list(dict.fromkeys(nums))
                piece["names"] = {k: v for k, v in piece["names"].items() if k in piece["channels"]}
        if "names" in changes and not errors:
            names = changes["names"]
            if not isinstance(names, Mapping):
                errors["names"] = TV_MSG["name"]
            else:
                current = {n: piece["names"].get(n) or n for n in piece["channels"]}
                for num, name in names.items():
                    name = str(name or "").strip()
                    if num not in current:
                        errors["names"] = TV_MSG["not_a_channel"]
                        break
                    if not name or len(name) > TV_NAME_MAX:
                        errors["names"] = TV_MSG["name"]
                        break
                    if any(v.casefold() == name.casefold() for k, v in current.items() if k != num):
                        errors["names"] = TV_MSG["name_taken"]
                        break
                    current[num] = name
                    piece["names"][num] = name
        if errors:
            raise PageError("invalid_format", fields=errors)


def register(app: Any, host: "FeatureHost") -> FeaturePages:
    """The page reads in ``app["read_routes"]`` (answered here, never forwarded)."""
    from .connectors import Ctx, Forbidden, Route, read_routes
    from .readproxy import ReadBlocked

    pages = FeaturePages(host)

    def reader(t: str, piece: str):
        async def read(ctx: Ctx, msg: dict) -> dict:
            if set(msg) - {"type", "id", "fresh"} or not isinstance(msg.get("fresh", False), bool):
                raise ReadBlocked(f"{t} carries fresh only")
            if not pages.may_configure(ctx.identity, piece):
                raise Forbidden(f"{t} needs configure (Owner or Admin)")
            try:
                return await pages.page(piece)
            except PageError as exc:
                raise ConnectionError(str(exc)) if exc.code == "unavailable" else ReadBlocked(str(exc)) from None
        return read

    read_routes(app).update({t: Route(request=reader(t, piece)) for t, piece in PAGE_READS.items()})
    return pages
