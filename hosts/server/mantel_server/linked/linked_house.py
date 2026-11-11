"""Linked mode, the rest of the entry on Mantel (docs/phase5/LINKED-MODE.md "What Mantel publishes";
CUTOVER.md Step 7), and the forwarded actions features.py's ``FeatureLinked`` does not handle.

features.py publishes each Mantel-owned tablet's four entities and answers ``set_black_screen``, the
pop-ups and the photo / black switches. This module adds, behind the same hook point
(``app["linked"].handler``, wrapping ``FeatureLinked``):

* ``hk_frontend.notify`` (forwarded): hk_core's ``banner.build_action`` -> the screens' event feed, and
  Wakes the Screen through Mantel's Sleep Screen engines, as HA's notifications feature does. Needs
  Mantel's ``notifications`` piece on (else ``not_set_up``, as HA answers). No camera snapshot yet.
* **the house-level entities**, published only while Mantel owns ``house`` (linked_owners.py) and the
  ``linked`` piece is on, with hk_frontend's unique ids and entity ids:

  - Seasonal decorations (``{entry}_seasonal_decorations``): its state IS Mantel's house setting
    ``sky.decorations``; turning it on or off from HA saves that setting (HK's own data, like HA's
    switch writing its options: no house command), versioned with the Service account as author.
  - the Alarm PIN panel (unique id = its item id): mirrors the alarm it protects (state, features,
    availability) from the hub; **arm and disarm take the one alarm path**, ``alarm_pin.linked_command``
    (the same gateway code as a page's keypad: RBAC on the panel and the alarm, the house's Alarm PIN
    and the keypad's lockout; the audit row first, as the linked Service actor; the alarm's own HA code only from Mantel's store, never the typed code;
    nothing sent while commands are off: ``commands_disabled``).
    WHICH ALARM: Mantel's ``alarm_pins`` row for the panel is authoritative (what an Owner set or
    imported; it also holds the house code and the alarm's own code). HA's registry ``protects`` is
    used only to make that row when there is none (``keypad_for``: tablets off, no house code, a
    config audit row); afterwards a disagreement is logged and the row wins, for commands and for the
    mirror alike, so the panel always shows the alarm its commands go to.
  - Live TV's viewers, now-on sensors and channel cameras: now-on from Mantel's guide (the
    ``live_tv`` piece). Where Mantel serves Live TV (live_tv.py: its own go2rtc, or through Mantel
    Link's transcode) the viewers are its count and the channels it serves are available; through
    Mantel Link each camera carries the tuner's stream (``features.tv``) and a channel HK Frontend
    never had gets entities of its own. Otherwise viewers 0 and the cameras *unavailable*. This
    module is the one publisher of these unique ids.

  Which of them exist, their unique and entity ids, and the protected alarm are read from Home
  Assistant's own entity registry and states (``platform: hk_frontend``, the entry's), so nothing is
  invented; what was learned is remembered (``linked_house`` table), so a restart while HA mirrors
  them (and so no longer shows the originals) still knows.

Nothing here calls a house service except the alarm, and that only through alarm_pin's gateway path.
"""
from __future__ import annotations

import asyncio
import copy
import logging
import re
import time
from collections import deque
from typing import Any

from aiohttp import web

from hk_core.notifications import banner as NB
from hk_core.notifications import dnd as ND
from hk_core.settings import model as SM

from . import ALARM_COMMANDS, LinkedError

# the integrations whose entity-registry entries are the linked house's: HK Frontend, and Mantel Link
# (protocol 2: the same unique ids, moved by the bridge hand-over)
LINK_PLATFORMS = ("hk_frontend", "mantel")

log = logging.getLogger("mantel.linked_house")

SEASONAL = "seasonal_decorations"
_NOW = re.compile(r"^(?P<item>.+)_(?P<n>\d{1,4}(?:\.\d{1,4})?)_now$")
_CAMERA = re.compile(r"^(?P<item>.+)_(?P<n>\d{1,4}(?:\.\d{1,4})?)_camera$")
_GONE = ("unavailable", "unknown")
TICK_S = 60.0


class LinkedHouse:
    """``app["linked_house"]``: the house-level entities and the extra handlers (module docstring)."""

    def __init__(self, app: web.Application, host: Any) -> None:
        self.app, self.host = app, host
        self.descs: dict[str, dict[str, Any]] = {}          # unique id -> descriptor now published
        self.kinds: dict[str, tuple[str, Any]] = {}         # unique id -> (kind, detail)
        self.calls: deque = deque(maxlen=100)
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._unsub = None

    # -- what applies ----------------------------------------------------------------------------------
    @property
    def owners(self) -> Any:
        return self.app.get("linked_owners")

    def wanted(self) -> str | None:
        """The entry id when the house-level entities are Mantel's to publish, else None."""
        owners = self.owners
        if owners is None or not owners.house() or not self.host.on("linked"):
            return None
        return self.host.entry_id()

    def _registry(self) -> Any:
        lk = self.app.get("linked")
        return lk.registry if lk is not None else None

    # -- learning the house's hk_frontend entities from HA's registry ----------------------------------
    def _ours(self, entry: str) -> list[dict[str, Any]]:
        reg = getattr(self.host.hub, "registry", None)
        out = []
        for e in getattr(reg, "entity_entries", None) or []:
            if not isinstance(e, dict) or e.get("platform") not in LINK_PLATFORMS or not e.get("unique_id"):
                continue
            # HK Frontend's are its house entry's; Mantel Link's (moved there by the bridge hand-over,
            # docs/phase9/MANTEL-LINK.md) keep HK's unique ids under Mantel Link's own entry
            if e.get("platform") == "hk_frontend" and e.get("config_entry_id") not in (None, entry):
                continue
            out.append(e)
        return out

    def _keypad_row(self, panel: str) -> Any:
        keypad = self.app.get("alarm_pin")
        return keypad.entry(panel) if keypad is not None else None

    def learn(self, entry: str) -> dict[str, Any]:
        """What the house has: {"seasonal": entity id, "keypads": {panel: {...}}, "live_tv": {...}}, from HA's
        registry and states, over what was remembered."""
        owners = self.owners
        keypads: dict[str, dict[str, Any]] = {}
        old = owners.remembered("alarm_pin") or {}               # before Mantel's own keypads: one panel
        if old.get("entity_id") and old.get("unique_id"):
            keypads[old["entity_id"]] = dict(old)
        for eid, k in ((owners.remembered("keypads") or {}).get("panels") or {}).items():
            if isinstance(k, dict) and k.get("unique_id"):
                keypads[eid] = dict(k)
        tv = dict(owners.remembered("live_tv") or {})
        tv.setdefault("now", {})
        tv.setdefault("cameras", {})
        seasonal_eid = None
        house = self.host.house
        for e in self._ours(entry):
            uid, eid = str(e["unique_id"]), str(e["entity_id"])
            domain = eid.split(".", 1)[0]
            name = e.get("original_name") or e.get("name")
            if uid == f"{entry}_{SEASONAL}":
                seasonal_eid = eid
            elif domain == "alarm_control_panel":
                alarm = keypads.get(eid) or {}
                st = house.state(eid)
                protects = (st.attributes.get("protects") if st is not None else None) or alarm.get("protects")
                attrs = st.attributes if st is not None and st.state not in _GONE else {}
                arm = bool(attrs.get("code_arm_required", alarm.get("code_arm_required", True)))
                row = self._keypad_row(eid)
                if row is not None:
                    # Mantel's Alarm PIN row is authoritative: the panel mirrors the alarm commands go to
                    if protects and row.forward_to != protects:
                        log.warning("linked house: HA says %s protects %s, Mantel's Alarm PIN settings say %s; "
                                    "Mantel's settings win", eid, protects, row.forward_to)
                    protects, arm = row.forward_to, row.arm_required
                keypads[eid] = {"unique_id": uid, "entity_id": eid, "protects": protects,
                                "name": name or alarm.get("name"), "code_arm_required": arm}
            elif domain == "sensor" and uid.endswith("_viewers"):
                tv["viewers"] = {"unique_id": uid, "entity_id": eid}
            elif domain == "sensor" and (m := _NOW.match(uid)):
                tv["now"][m["n"]] = {"unique_id": uid, "entity_id": eid, "name": name}
            elif domain == "camera" and (m := _CAMERA.match(uid)):
                tv["cameras"][m["n"]] = {"unique_id": uid, "entity_id": eid, "name": name}
        if keypads:
            owners.remember("keypads", {"panels": keypads})
        if tv.get("viewers") or tv["now"] or tv["cameras"]:
            owners.remember("live_tv", tv)
        return {"seasonal": seasonal_eid, "keypads": keypads, "live_tv": tv}

    def keypads(self, entry: str, learned: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
        """THE ALARM PIN PANELS MANTEL PUBLISHES: one per keypad in Mantel's own table (alarm_pin.py; a row whose
        panel is not the alarm itself), whichever way it got there (HK Settings' Alarm PIN page, the REST, or made
        from HA's registry by ``keypad_for``). A panel HK Frontend had keeps its unique id (so its entity id and
        history move with the registry hand-over); a keypad Mantel made has ``<entry>_alarm_pin_<object id>`` and
        its entity id suggested. A panel another integration has in HA is never published over it."""
        keypad = self.app.get("alarm_pin")
        if keypad is None:
            return []
        reg = {e.get("entity_id"): e for e in getattr(getattr(self.host.hub, "registry", None), "entity_entries", None)
               or [] if isinstance(e, dict)}
        out = []
        for row in keypad.entries():
            if row.forward_to == row.entity:
                continue
            other = reg.get(row.entity)
            if other is not None and other.get("platform") not in LINK_PLATFORMS:
                continue
            k = learned.get(row.entity) or {}
            uid = k.get("unique_id") or (other or {}).get("unique_id") or f"{entry}_alarm_pin_{row.entity.split('.', 1)[1]}"
            name = k.get("name") or f"{self._friendly(row.forward_to)} PIN"
            out.append({"unique_id": uid, "entity_id": row.entity, "protects": row.forward_to, "name": name,
                        "code_arm_required": row.arm_required})
        return out

    def _friendly(self, eid: str) -> str:
        st = self.host.house.state(eid)
        return str(st.attributes.get("friendly_name") or eid) if st is not None else eid

    # -- the descriptors -------------------------------------------------------------------------------
    def _decorations_on(self) -> bool:
        body = self.host.store.body("house", "settings")
        return bool(SM.merged({SM.CONF_DASHBOARD: body})["sky"].get("decorations", True))

    def descriptors(self, entry: str) -> dict[str, tuple[dict[str, Any], tuple[str, Any]]]:
        got = self.learn(entry)
        out: dict[str, tuple[dict[str, Any], tuple[str, Any]]] = {}
        uid = f"{entry}_{SEASONAL}"
        out[uid] = ({"unique_id": uid, "platform": "switch",
                     "entity_id": got["seasonal"] or "switch.hk_frontend_seasonal_decorations",
                     "translation_key": SEASONAL, "has_entity_name": True,
                     "device": {"identifier": entry, "name": "HK Frontend"},
                     "state": "on" if self._decorations_on() else "off", "attributes": {}}, ("seasonal", None))
        for alarm in self.keypads(entry, got["keypads"]):
            st = self.host.house.state(alarm["protects"])
            up = st is not None and st.state not in _GONE
            out[alarm["unique_id"]] = ({
                "unique_id": alarm["unique_id"], "platform": "alarm_control_panel", "entity_id": alarm["entity_id"],
                "name": None, "has_entity_name": True,
                "device": {"identifier": alarm["unique_id"], "name": alarm.get("name") or "Alarm PIN"},
                "state": st.state if up else None, "available": up,
                "attributes": {"protects": alarm["protects"],
                               **({"changed_by": st.attributes["changed_by"]}
                                  if up and isinstance(st.attributes.get("changed_by"), str) else {})},
                "features": {"supported_features": int(st.attributes.get("supported_features") or 0) if up else 0,
                             "code_format": "number", "code_arm_required": bool(alarm.get("code_arm_required", True))},
            }, ("alarm", alarm))
        tv = got["live_tv"]
        lt = self.app.get("live_tv")
        piece_on = lt.piece_on() if lt is not None else self.host.on("live_tv")
        guide = {c["number"]: c for c in (self.host.tv.channels()["channels"] if piece_on else [])}
        # where Mantel serves Live TV (live_tv.py: its own go2rtc, or through Mantel Link's transcode) the
        # viewers are its count and the channels it serves are available; through Mantel Link each camera
        # also carries the tuner's stream (features.tv) for Mantel Link's transcode, and a channel HK
        # Frontend never had gets entities of its own (HK's unique-id pattern, under this entry)
        served = lt if lt is not None and lt.serves() else None
        chans = {c["number"]: c for c in served.linked_channels()} if served is not None else {}
        now_ids, cam_ids = dict(tv["now"]), dict(tv["cameras"])
        for n, c in chans.items():
            now_ids.setdefault(n, {"unique_id": f"{entry}_{n}_now", "entity_id": c["now"], "name": f"TV {c['name']} now"})
            cam_ids.setdefault(n, {"unique_id": f"{entry}_{n}_camera", "entity_id": c["camera"], "name": f"TV {c['name']}"})
        v = tv.get("viewers") or ({"unique_id": f"{entry}_viewers", "entity_id": "sensor.tv_viewers"}
                                  if served is not None else None)
        if v:
            count, vattrs = served.viewers_state() if served is not None else (0, {"users": [], "channels": []})
            out[v["unique_id"]] = ({"unique_id": v["unique_id"], "platform": "sensor", "entity_id": v["entity_id"],
                                    "name": "TV viewers", "has_entity_name": False, "icon": "mdi:account-eye",
                                    "state": count, "attributes": vattrs}, ("viewers", None))
        for n, d in sorted(now_ids.items()):
            g = guide.get(n) or {}
            cur, nxt = g.get("now"), g.get("next")
            attrs: dict[str, Any] = {"channel": n, "network": g.get("network") or g.get("name") or None,
                                     "name": g.get("name") or None, "logo": g.get("logo"),
                                     "camera": (cam_ids.get(n) or {}).get("entity_id")}
            if cur:
                attrs.update(subtitle=cur.get("subtitle"), description=cur.get("description"), start=cur.get("start"),
                             end=cur.get("end"), image=cur.get("image"))
            if nxt:
                attrs.update(next_title=nxt.get("title"), next_start=nxt.get("start"), next_image=nxt.get("image"))
            title = ((cur or {}).get("title") or "")[:250] or "Live"
            out[d["unique_id"]] = ({"unique_id": d["unique_id"], "platform": "sensor", "entity_id": d["entity_id"],
                                    "name": d.get("name") or f"TV {n} now", "has_entity_name": False,
                                    "icon": "mdi:television-classic", "state": title,
                                    "attributes": copy.deepcopy(attrs)}, ("now", n))
        for n, d in sorted(cam_ids.items()):
            # without Mantel's Live TV: unavailable, never a wrong picture. With its own go2rtc: available, no
            # stream source (HA's own dashboards don't play Mantel's channels; HK's pages do, through Mantel).
            # Through Mantel Link: the tuner's stream for its transcode, which HA's go2rtc plays
            c = chans.get(n)
            out[d["unique_id"]] = ({"unique_id": d["unique_id"], "platform": "camera", "entity_id": d["entity_id"],
                                    "name": d.get("name") or f"TV {n}", "has_entity_name": False, "state": "idle",
                                    "available": c is not None, "attributes": {"channel": n},
                                    "features": {"tv": dict(c["tv"])} if c is not None and c.get("tv") else {}},
                                   ("camera", n))
        return out

    # -- publishing ------------------------------------------------------------------------------------
    async def refresh(self) -> None:
        """Bring the published house-level entities in line with the ownership, the settings and the
        house. Withdrawn ones go with ``forget=False`` (HA keeps its registry entries)."""
        reg = self._registry()
        if reg is None:
            return
        async with self._lock:
            entry = self.wanted()
            if entry is None:
                self.observe()
            if entry:
                # a panel learned from HA's registry gets its row ONCE; after that the table is authoritative,
                # so a PIN removed in HK Settings stays removed although HA still has the panel's registry entry
                seen = set((self.owners.remembered("keypads_seen") or {}).get("panels") or [])
                before = set(seen)
                for detail in self.learn(entry)["keypads"].values():
                    panel = detail["entity_id"]
                    if self._keypad_row(panel) is None and panel not in seen and detail.get("protects"):
                        await self.keypad_for(detail)
                    if self._keypad_row(panel) is not None:
                        seen.add(panel)
                if seen != before:
                    self.owners.remember("keypads_seen", {"panels": sorted(seen)})
            want = self.descriptors(entry) if entry else {}
            for uid in [u for u in self.descs if u not in want]:
                await reg.remove(uid, forget=False)
                self.descs.pop(uid, None)
                self.kinds.pop(uid, None)
            for uid, (desc, kind) in want.items():
                have = reg.get(uid)
                same = have is not None and {k: v for k, v in have.items()
                                             if k not in ("state", "attributes", "available")} == \
                    {k: v for k, v in _norm(desc).items() if k not in ("state", "attributes", "available")}
                if not same:
                    await reg.publish(desc)
                elif (have["state"], have["attributes"], have["available"]) != \
                        (desc["state"], desc["attributes"], desc.get("available", True)):
                    await reg.update(uid, state=desc["state"], attributes=desc["attributes"], merge=False,
                                     available=desc.get("available", True))
                self.descs[uid] = desc
                self.kinds[uid] = kind

    def observe(self) -> None:
        """While Home Assistant (HK Frontend) still runs the house: only LEARN what it has (read-only, nothing
        published). HK Frontend's Alarm PIN panel says which alarm it protects only while HK Frontend shows it;
        once ``house`` is Mantel's, HK Frontend unloads it and the attribute is gone, so it is remembered now."""
        owners, host = self.owners, self.host
        if owners is None or not host.on("linked"):
            return
        entry = host.entry_id()
        if entry:
            try:
                self.learn(entry)
            except Exception:  # noqa: BLE001 -- only learning; the next change tries again
                log.exception("linked house: learning the house's entities failed")

    def watching(self) -> set[str]:
        out = {k[1]["protects"] for k in self.kinds.values() if k[0] == "alarm"}
        if not self.kinds and self.owners is not None:
            # observing: HK Frontend's own panels, to remember what each protects while it still says so
            out |= set(((self.owners.remembered("keypads") or {}).get("panels") or {}))
        return out

    # -- the handlers ----------------------------------------------------------------------------------
    def _need_on(self) -> None:
        if not self.host.on("linked"):
            raise LinkedError("not_set_up", "linked mode's features are off in Mantel's feature settings")

    async def notify(self, data: dict[str, Any], ctx: Any) -> dict[str, Any]:
        """hk_frontend.notify on Mantel's screens (HA's async_deliver, without the snapshot)."""
        self._need_on()
        host = self.host
        if not host.on("notifications"):
            raise LinkedError("not_set_up", "Notifications are off in Mantel's feature settings")
        payload = NB.build_action(host.house, host.notifier.opts, dict(data))
        screens = host.feed.send(payload)
        woke = []
        if payload["wake"] and (payload["important"] or not ND.dnd_on(host.house, host.notifier.opts.get("dnd"),
                                                                       host.now())):
            secs = NB.wake_for(int(payload["stay"]))
            for tid, eng in list(host.engines.items()):
                if (host.boards.get(tid) or {}).get("notify", True):
                    eng.notify_wake(payload["title"], secs)
                    woke.append(tid)
        host.notifier.sent.append({"at": time.time(), "item": None, "entity": payload.get("entity"),
                                   "title": payload["title"], "message": payload["message"], "screens": screens,
                                   "woke": woke, "via": "linked"})
        self.calls.append({"at": time.time(), "service": "notify", "title": payload["title"], "screens": screens})
        host.to_phones(payload)
        return {"id": payload["id"], "snap": False}

    async def entity_command(self, unique_id: str, command: str, data: dict[str, Any], ctx: Any) -> dict[str, Any]:
        self._need_on()
        kind, detail = self.kinds[unique_id]
        self.calls.append({"at": time.time(), "command": command, "unique_id": unique_id})
        if kind == "seasonal":
            on = {"turn_on": True, "turn_off": False}.get(command, not self._decorations_on())
            await self._set_decorations(on, ctx)
            return {"on": on}
        if kind == "alarm" and command in ALARM_COMMANDS:
            return await self._alarm(detail, command, data.get("code"), ctx)
        raise LinkedError("not_supported", f"{command} is not handled by this Mantel Server")

    async def _set_decorations(self, on: bool, ctx: Any) -> None:
        """Mantel's house setting sky.decorations, as HA's switch writes its options: the stored differences
        (SET-2; the feed merges them, so the screens keep the whole sky)."""
        from ..settings_store import Actor, looks_merged, stored_house
        store = self.host.store
        body = copy.deepcopy(store.body("house", "settings"))
        if looks_merged(body):                  # not normalised yet (normalise_house runs at start-up)
            body = stored_house(body)
        sky = body.get("sky") if isinstance(body.get("sky"), dict) else {}
        body["sky"] = SM.house_stored("sky", {**sky, "decorations": on})
        account = getattr(ctx, "account", None)
        store.write([("house", "settings", body)], actor=Actor(label=f"linked:{getattr(account, 'id', '?')}"),
                    message="linked: Seasonal decorations")
        svc = self.app.get("settings")
        if svc is not None:
            svc.publish()                       # every screen gets the setting, as HA's feed resends
        await self.refresh()

    async def _alarm(self, alarm: dict[str, Any], command: str, code: Any, ctx: Any) -> dict[str, Any]:
        """HA's forwarded arm/disarm takes THE alarm path, ``alarm_pin.linked_command``: the house's Alarm
        PIN, the keypad's lockout, RBAC on the panel and the alarm, the audit row first,
        the alarm's own HA code from Mantel's store (never the typed code), commands off: nothing sent.
        Its refusals are already HA's wire codes (``alarm_pin.linked_error``)."""
        from .. import alarm_pin
        if self.app.get("alarm_pin") is None:
            raise LinkedError("not_supported", "this Mantel Server has no Alarm PIN engine")
        panel = alarm["entity_id"]
        entry = await self.keypad_for(alarm)
        if entry is None or entry.forward_to == panel:
            # never to HA's own mirror of this panel: it would come straight back here
            raise LinkedError("not_set_up", f"Mantel's Alarm PIN settings name no alarm behind {panel}")
        if code is not None and not isinstance(code, str):
            raise LinkedError("invalid", "code: text")
        await alarm_pin.linked_command(self.app, entity=panel, command=command, code=code or None,
                                       account=getattr(ctx, "account", None), peer=getattr(ctx, "peer", None))
        return {"command": command}

    async def keypad_for(self, alarm: dict[str, Any]) -> Any:
        """The Alarm PIN row (alarm_pin.Entry) for the linked panel. Mantel's ``alarm_pins`` table is
        AUTHORITATIVE for which alarm a command goes to (module docstring); with no row yet, one is
        made from what HA's registry says the panel protects, as ``POST /api/alarm/pins/import`` would:
        wall tablets NOT given it (``tablets`` off) and no house code (so it refuses whatever needs a
        code) until an Owner sets them. Audited as a config row naming the panel and the alarm."""
        from .. import alarm_pin
        keypad, panel, protects = self.app.get("alarm_pin"), alarm.get("entity_id"), alarm.get("protects")
        if keypad is None or not isinstance(panel, str):
            return None
        have = keypad.entry(panel)
        if have is not None:
            return have
        if not isinstance(protects, str) or protects == panel or not alarm_pin.PANEL.match(panel) \
                or not alarm_pin.PANEL.match(protects):
            return None
        entry = await keypad.set(panel, forward_to=protects, tablets=False, source="linked",
                                 arm_required=bool(alarm.get("code_arm_required", True)))
        audit = self.app.get("audit")
        if audit is not None:
            audit.config_event({"actor": alarm_pin.LINKED_ACTOR, "role": "service", "action": "alarm_pin.linked",
                                "detail": {"entity": panel, "forward_to": protects, "from": "ha_registry"}})
        log.info("linked house: Alarm PIN %s -> %s, from Home Assistant's registry", panel, protects)
        return entry

    # -- running ---------------------------------------------------------------------------------------
    async def _ticker(self) -> None:
        while True:
            await asyncio.sleep(TICK_S)
            try:
                await self.refresh()
            except Exception:  # noqa: BLE001 -- the next tick tries again
                log.exception("linked house: refresh failed")

    async def start(self) -> None:
        await self.refresh()
        svc = self.app.get("settings")
        if svc is not None:
            first = [True]

            def changed(_payload: dict) -> None:
                if first[0]:
                    first[0] = False
                    return
                self.host.spawn(self.refresh())
            self._unsub = svc.subscribe_feed(None, changed)
        self._task = asyncio.get_running_loop().create_task(self._ticker())

    async def stop(self) -> None:
        if self._unsub:
            self._unsub()
        if self._task is not None:
            self._task.cancel()

    def status(self) -> dict[str, Any]:
        return {"published": sorted(self.descs), "calls": list(self.calls),
                "kinds": {u: k[0] for u, k in self.kinds.items()}}


def _norm(desc: dict[str, Any]) -> dict[str, Any]:
    from . import check_entity
    return check_entity(desc)


class LinkedHandler:
    """``app["linked"].handler``: notify and the house-level entities here, everything else to
    features.py's ``FeatureLinked`` (``features``)."""

    def __init__(self, house: LinkedHouse, features: Any) -> None:
        self.house, self.features = house, features

    async def call_service(self, service: str, data: dict[str, Any], targets: list[dict[str, str]], ctx: Any) -> Any:
        if service == "notify":
            return await self.house.notify(data, ctx)
        from . import linked_actions
        if service in linked_actions.SERVICES:
            actions = self.house.app.get("linked_actions")
            if actions is None:
                from . import LinkedError
                raise LinkedError("not_set_up", f"{service} isn't run by this Mantel")
            return await actions.call(service, data, ctx)
        return await self.features.call_service(service, data, targets, ctx)

    async def entity_command(self, unique_id: str, command: str, data: dict[str, Any], ctx: Any) -> Any:
        if unique_id in self.house.kinds:
            return await self.house.entity_command(unique_id, command, data, ctx)
        return await self.features.entity_command(unique_id, command, data, ctx)

    async def page_says(self, unique_id: str, black: bool) -> bool:
        return await self.features.page_says(unique_id, black)


def register(app: web.Application, hub: Any = None) -> LinkedHouse | None:
    """After ``features.register`` (and ``linked.register``): wrap the linked handler, follow the hub,
    the settings and the feature host's reloads. Idempotent."""
    if "linked_house" in app:
        return app["linked_house"]
    host, lk = app.get("features"), app.get("linked")
    if host is None or lk is None:
        return None
    house = LinkedHouse(app, host)
    app["linked_house"] = house
    lk.handler = LinkedHandler(house, host.linked)

    # the feature host reloaded (settings saved, tablets changed, a move): the house-level entities too
    reload = host.reload

    async def reload_and_refresh() -> None:
        await reload()
        await house.refresh()
    host.reload = reload_and_refresh

    ha = getattr(hub, "ha", None)
    if ha is not None:
        first_change, first_registry = ha.on_change, ha.on_registry

        def on_change(changed: set[str]) -> None:
            first_change(changed)
            if house.watching() & set(changed):
                host.spawn(house.refresh())

        def on_registry() -> None:
            if first_registry is not None:
                first_registry()
            host.spawn(house.refresh())
        ha.on_change, ha.on_registry = on_change, on_registry

    async def start(_app: web.Application) -> None:
        await house.start()

    async def stop(_app: web.Application) -> None:
        await house.stop()

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return house
