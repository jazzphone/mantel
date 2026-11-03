"""FEATURES ON BY DEFAULT (docs/phase16/FEATURES-ON-BY-DEFAULT.md "The runner").

``AutoFeatures``, made by the feature host, turns Music, Clean Areas, Energy and Live TV on by itself, ONCE, when the
house has what they need (``hk_core.needs``): Music Assistant connected, a vacuum with a room map, Home Assistant's
Energy settings with a grid meter or devices, a tuner on the home network that answers and a way to serve it.

- **Two looks.** A need seen for the first time is remembered; a look 2 minutes later acts only if it still holds.
  A half-loaded registry, a restart or a flicker never turns anything on.
- **Once.** ``auto.decided`` in the feature settings says a piece was decided: by Mantel (``auto``, written in the
  same version that turns it on) or by a person (``owner``, written with their Add or Remove, or found in the
  settings history: a person's ``set`` that turned it off). A decided piece is never turned on again. Live TV's old
  ``go2rtc_once`` counts as decided.
- **It sends no command.** Every step reads, or writes Mantel's own settings store. Nothing here calls the gateway,
  ``MantelHouse.call_service`` or the feature caller (Rules.md rule 3). It reads Home Assistant's Energy settings (the
  read the Energy page makes) and, for Live TV, the tuner's ``lineup.json`` (the read Live TV makes), on a home
  network address only, at most once every 10 minutes per address.
- **Audit first** (rule 7): ``features.auto_on`` is written before the change; no row, no change. The settings
  history names ``mantel-auto``, a label with no grants.
- **The Owner is told:** the row's note in Advanced → Features (``panel_features``), the history and the audit, and
  an Info alert ``feature.enabled``.
- **One switch** (``auto.enabled``, Turn Features On Automatically) stops all of it.
"""
from __future__ import annotations

import asyncio
import copy
import json
import logging
from typing import Any, Mapping, TYPE_CHECKING

from hk_core import clean_areas as CA
from hk_core import needs as N

from .. import audit
from .settings import FEATURES_DOC, check_settings

if TYPE_CHECKING:
    from .host import FeatureHost

log = logging.getLogger("mantel.features.auto")

ACTOR = "mantel-auto"                  # the settings history's label for Mantel's own turn-on (no grants)
TWO_LOOKS_S = 120.0                    # a need must hold this long, seen on two looks
COALESCE_S = 30.0                      # registry changes and connections: one look for a burst
EVERY_S = 300.0                        # and every 5 minutes (HA says nothing when Energy settings are saved)
PROBE_EVERY_S = 600.0                  # the tuner's lineup.json, at most this often per address
PROBE_YES_S = 60.0                     # a "yes" is asked again after this (each of the two looks has its own)
PROBE_TIMEOUT_S = 8.0
PROBE_MAX = 1_000_000                  # a lineup is a few kilobytes
MA_WAIT_S = 30.0                       # a new connection: how long to wait for Music Assistant to say it's connected
TITLES = {"music": "Music", "clean_areas": "Clean Areas", "energy": "Energy", "live_tv": "Live TV"}


def decided_marker(by: str, at: str, why: str) -> dict[str, str]:
    return {"by": by, "at": at[:40], "why": why[:200]}


class AutoFeatures:
    """The facts, the schedule, the markers and the write (the module docstring)."""

    def __init__(self, host: "FeatureHost") -> None:
        self.host = host
        self.first: dict[str, float] = {}                  # piece -> when (monotonic) its need was first seen met
        self.needs: dict[str, N.Need] = {}                  # the last look's answers
        self.why_not: dict[str, str] = {}                   # piece -> why the last look didn't act on it
        self.looked_at: str | None = None
        self.looks = 0
        self.turned_on: list[dict[str, Any]] = []           # this run's turn-ons (status)
        self.raised: set[str] = set()                       # the alert is raised once per piece
        self._probes: dict[str, tuple[float, bool]] = {}    # tuner host -> (when, answered)
        self._lock = asyncio.Lock()
        self._pending: asyncio.TimerHandle | None = None    # the next coalesced look
        self._again: asyncio.TimerHandle | None = None      # the second look
        self._last_tick = float("-inf")
        self._was_on: bool | None = None
        self._asked = False                                 # a look was asked for while one ran

    # -- the settings ------------------------------------------------------------------------------------
    def switch(self, settings: Mapping[str, Any] | None = None) -> bool:
        s = settings if settings is not None else self.host.settings
        return bool((s.get("auto") or {}).get("enabled", True))

    def decided(self, settings: Mapping[str, Any] | None = None) -> dict[str, Any]:
        s = settings if settings is not None else self.host.settings
        return dict((s.get("auto") or {}).get("decided") or {})

    def eligible(self, piece: str, settings: Mapping[str, Any], turned_off: set[str]) -> str | None:
        """None when ``piece`` may turn on by itself, else why not (status words)."""
        if not self.switch(settings):
            return "Turn Features On Automatically is off"
        if settings.get(piece, {}).get("enabled"):
            return "already on"
        mark = self.decided(settings).get(piece)
        if mark:
            return "turned off by a person" if mark.get("by") == "owner" else "turned on by Mantel once already"
        if piece in turned_off:
            return "turned off by a person"
        if piece == "live_tv" and settings["live_tv"].get("go2rtc_once"):
            return "decided already (go2rtc_once)"
        return None

    def person_turned_off(self) -> set[str] | None:
        """THE HISTORY BACKSTOP: the pieces a person turned off in a ``set`` of ``house/mantel_features`` (a house
        upgraded from before the marker, or a restore that dropped it). None when the history can't be read: then
        nothing is decided either way (no marker is written, nothing turns on)."""
        try:
            rows = self.host.store.history("house", FEATURES_DOC, limit=200)
        except Exception:  # noqa: BLE001 -- can't tell: this look decides nothing
            log.exception("features: the settings history could not be read")
            return None
        out: set[str] = set()
        for r in rows:
            if r.get("action") != "set" or r.get("actor") == ACTOR:
                continue
            changed = (r.get("diff") or {}).get("changed") or {}
            for piece in N.PIECES:
                if changed.get(f"{piece}.enabled") == [True, False]:
                    out.add(piece)
        return out

    # -- when it looks ------------------------------------------------------------------------------------
    def schedule(self, delay: float = 0.0) -> None:
        """A look in ``delay`` seconds, coalesced: an earlier one already due stands for it."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        due = loop.time() + max(0.0, delay)
        if self._pending is not None and not self._pending.cancelled() and self._pending.when() <= due + 0.001:
            return
        if self._pending is not None:
            self._pending.cancel()
        self._pending = loop.call_later(max(0.0, delay), self._fire)

    def _fire(self) -> None:
        self._pending = None
        self.host.spawn(self.look())

    def _second_look(self) -> None:
        """The next look when a need is waiting out its 2 minutes."""
        if not self.first:
            if self._again is not None:
                self._again.cancel()
                self._again = None
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        wait = max(1.0, min(self.first.values()) + TWO_LOOKS_S - self.host.monotonic())
        due = loop.time() + wait
        if self._again is not None and not self._again.cancelled() and abs(self._again.when() - due) < 1.0:
            return
        if self._again is not None:
            self._again.cancel()

        def fire() -> None:
            self._again = None
            self.host.spawn(self.look())
        self._again = loop.call_later(wait, fire)

    def tick(self) -> None:
        """The feature host's minute: a look every 5 minutes."""
        now = self.host.monotonic()
        if now - self._last_tick >= EVERY_S:
            self._last_tick = now
            self.schedule(0)

    def settings_changed(self) -> None:
        """After every reload: the switch turned on looks at once; turned off, nothing waits."""
        on = self.switch()
        if not on:
            self.first.clear()
            self._second_look()
        elif self._was_on is False:
            self.schedule(0)
        self._was_on = on

    async def connection_changed(self) -> None:
        """A connection was saved (server.apply_connection): wait a moment for Music Assistant, then look."""
        client = self.host.app.get("ma")
        ev = getattr(client, "connected", None)
        if ev is not None and not ev.is_set():
            try:
                await asyncio.wait_for(ev.wait(), MA_WAIT_S)
            except asyncio.TimeoutError:
                pass
        self.schedule(0)

    def stop(self) -> None:
        for h in (self._pending, self._again):
            if h is not None:
                h.cancel()
        self._pending = self._again = None

    # -- the facts ------------------------------------------------------------------------------------------
    def _ready(self) -> bool:
        reg = getattr(self.host.hub, "registry", None)
        return self.host._ha_ready() and getattr(reg, "loads", 0) > 0

    def _ma(self) -> bool | None:
        client = self.host.app.get("ma")
        if client is None:
            return None
        ev = getattr(client, "connected", None)
        return bool(ev is not None and ev.is_set())

    def _vacuums(self, ready: bool) -> list[dict] | None:
        if not ready:
            return None
        try:
            return CA.coverage(self.host.house, {})
        except Exception:  # noqa: BLE001 -- can't tell
            log.exception("features: the vacuums' coverage could not be worked out")
            return None

    async def _energy_prefs(self, ready: bool) -> Mapping | None:
        proxy = getattr(self.host.hub, "readproxy", None)
        if not ready or proxy is None:
            return None
        try:
            got = await proxy.request({"type": "energy/get_prefs"})
        except RuntimeError as exc:
            if str(exc) == "not_found":                    # never saved: Home Assistant says so
                return {}
            log.info("features: Home Assistant's Energy settings were not read (%s)", exc)
            return None
        except Exception as exc:  # noqa: BLE001 -- can't tell
            log.info("features: Home Assistant's Energy settings were not read (%s)", type(exc).__name__)
            return None
        return got if isinstance(got, Mapping) else None

    def _registry_tuner(self) -> tuple[str, bool]:
        """(an address for an HDHomeRun in Home Assistant's device registry, whether the registry has one at all)."""
        reg = getattr(self.host.hub, "registry", None)
        seen, found = False, ""
        for d in getattr(reg, "device_entries", None) or []:
            if not isinstance(d, Mapping) or d.get("disabled_by"):
                continue
            ids = d.get("identifiers") or []
            named = any(isinstance(i, (list, tuple)) and i and str(i[0]).lower() == "hdhomerun" for i in ids)
            maker = str(d.get("manufacturer") or "").lower().replace(" ", "")
            if not (named or maker == "silicondust"):
                continue
            seen = True
            host = N.lan_host(d.get("configuration_url"))
            if host and not found:
                found = host
        if not seen:
            seen = any(isinstance(e, Mapping) and e.get("platform") == "hdhomerun"
                       for e in getattr(reg, "entity_entries", None) or [])
        return found, seen

    def _tv_serves(self) -> str:
        """How Live TV would be served with the piece on (``live_tv.MantelLiveTv.mode`` as if it were)."""
        app = self.host.app
        tv = app.get("live_tv")
        if tv is not None and getattr(tv, "go2rtc", None) is not None:
            return "mantel"
        lh = app.get("linked_house")
        try:
            if tv is not None and lh is not None and lh.wanted() is not None and tv.link() is not None:
                return "link"
        except Exception:  # noqa: BLE001 -- can't serve it that way
            log.exception("features: Live TV's Mantel Link check failed")
        if "live_tv" in self.host.settings["ha"]["added"]:
            return "ha"
        return "none"

    async def _probe(self, host: str) -> bool | None:
        """One ``GET http://<host>/lineup.json``, kept for 10 minutes: True when it lists channels."""
        now = self.host.monotonic()
        got = self._probes.get(host)
        # a "no" stands for 10 minutes; a "yes" only for a minute, so the second look asks again (two answers)
        if got is not None and now - got[0] < (PROBE_EVERY_S if not got[1] else PROBE_YES_S):
            return got[1]
        try:
            raw = await asyncio.wait_for(self._fetch(host), PROBE_TIMEOUT_S)
            data = json.loads(raw)
            ok = isinstance(data, list) and any(isinstance(c, Mapping) and c.get("GuideNumber") for c in data)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 -- it didn't answer
            log.info("features: the tuner at %s didn't answer (%s)", host, type(exc).__name__)
            ok = False
        self._probes[host] = (now, ok)
        return ok

    async def _fetch(self, host: str) -> bytes:
        if self.host.hooks.fetch is not None:
            return await self.host.hooks.fetch(N.lineup_url(host))
        from .tv_fetch import lan_get
        return await lan_get(self.host.app, host, timeout=PROBE_TIMEOUT_S, cap=PROBE_MAX)

    async def facts(self, wanted: set[str]) -> N.Facts:
        """What the house has, for the pieces that may still turn on (nothing is read for the others)."""
        ready = self._ready()
        tv = self.host.settings["live_tv"]
        tuner, tuner_from, seen = "", "", False
        serves = "none"
        answers: bool | None = None
        read_only = bool(getattr(self.host.app.get("cfg"), "read_only", False))
        if "live_tv" in wanted:
            found, seen = self._registry_tuner()
            if tv.get("tuner"):
                tuner, tuner_from = str(tv["tuner"]), "saved"
            elif found:
                tuner, tuner_from = found, "registry"
            serves = self._tv_serves()
            host = N.lan_host(tuner)
            if ready and host and serves in ("mantel", "link") and not (serves == "link" and read_only):
                answers = await self._probe(host)
        return N.Facts(
            ready=ready,
            ma_connected=self._ma() if "music" in wanted else None,
            vacuums=self._vacuums(ready) if "clean_areas" in wanted else [],
            energy_prefs=await self._energy_prefs(ready) if "energy" in wanted else {},
            tuner=tuner, tuner_from=tuner_from, tuner_seen=seen, tuner_answers=answers, tv_serves=serves,
            read_only=read_only)

    # -- a look -------------------------------------------------------------------------------------------
    async def look(self) -> None:
        """Gather the facts, ask hk_core, and turn on what has held for two looks. Single flight: a look asked for
        while one runs is one more look, soon after."""
        if self._lock.locked():
            self._asked = True
            return
        async with self._lock:
            try:
                await self._look()
            except Exception:  # noqa: BLE001 -- the next look tries again, and the 2 minutes start over
                self.first.clear()
                log.exception("features: the look for features to turn on failed")
            finally:
                self._second_look()
                if self._asked:
                    self._asked = False
                    self.schedule(1.0)

    async def _look(self) -> None:
        h = self.host
        self.looks += 1
        self.looked_at = h.now().isoformat()
        settings = h.settings
        if not self.switch(settings):
            self.first.clear()
            self.why_not = {p: "Turn Features On Automatically is off" for p in N.PIECES}
            return
        turned_off = self.person_turned_off() if any(
            not settings.get(p, {}).get("enabled") and p not in self.decided(settings) for p in N.PIECES) else set()
        if turned_off is None:
            self.first.clear()
            self.why_not = {p: "can't tell: the settings history couldn't be read" for p in N.PIECES}
            return
        if turned_off:
            await self._mark_owner(turned_off)
            settings = h.settings
        why_not = {p: self.eligible(p, settings, turned_off) for p in N.PIECES}
        wanted = {p for p, w in why_not.items() if w is None}
        self.why_not = {p: w for p, w in why_not.items() if w is not None}
        for p in list(self.first):
            if p not in wanted:
                del self.first[p]
        if not wanted:
            self.needs = {}
            return
        self.needs = {p: n for p, n in N.look(await self.facts(wanted)).items() if p in wanted}
        now = h.monotonic()
        for p in sorted(wanted):
            need = self.needs[p]
            if need.met is not True:
                self.first.pop(p, None)
                self.why_not[p] = "can't tell yet" if need.met is None else "doesn't have what it needs"
                continue
            seen = self.first.get(p)
            if seen is None:
                self.first[p] = now
                self.why_not[p] = "seen once; looking again in 2 minutes"
            elif now - seen >= TWO_LOOKS_S - 1.0:
                done = await self.turn_on(p, need)
                self.first.pop(p, None)
                if not done:
                    self.why_not[p] = "not turned on this time (see the log)"
            else:
                self.why_not[p] = "seen; waiting out the 2 minutes"

    async def _mark_owner(self, pieces: set[str]) -> None:
        """The backstop's find, written as the ``owner`` marker so the history is read once per piece."""
        async with self.host.features_lock:
            await self._mark_owner_now(pieces)

    async def _mark_owner_now(self, pieces: set[str]) -> None:
        h = self.host
        doc = h.store.get("house", FEATURES_DOC)
        try:
            settings = check_settings(h._usable(doc.body if doc is not None else {}))
        except ValueError:
            return
        todo = [p for p in sorted(pieces) if p not in settings["auto"]["decided"] and not settings[p]["enabled"]]
        if not todo:
            return
        try:
            audit.config(None, None, "features.auto_decided", {"pieces": todo, "by": "owner"}, app=h.app)
        except audit.Unavailable:
            return
        at = h.now().isoformat()
        for p in todo:
            settings["auto"]["decided"][p] = decided_marker("owner", at, "Turned off by a person (settings history)")
        try:
            self._write(settings, doc, "Features: turned off by a person, kept off")
        except Exception as exc:  # noqa: BLE001 -- read again on the next look
            log.info("features: the turned-off marker was not written (%s)", exc)
            return
        await h.reload()

    def _write(self, settings: dict[str, Any], doc: Any, message: str) -> None:
        from ..settings_store import Actor
        self.host.store.write([("house", FEATURES_DOC, check_settings(settings))], actor=Actor(label=ACTOR),
                              message=message, expect={("house", FEATURES_DOC): doc.version if doc is not None else 0})

    async def turn_on(self, piece: str, need: N.Need) -> bool:
        """Turn ``piece`` on, the way a person would: checked, the audit row first, a new version of the feature
        settings in the store (refused if a person's save came first), the screens told, the Owner told. One change
        of the feature settings at a time (``features_lock``, which the saves hold too)."""
        async with self.host.features_lock:
            return await self._turn_on(piece, need)

    async def _turn_on(self, piece: str, need: N.Need) -> bool:
        h = self.host
        doc = h.store.get("house", FEATURES_DOC)
        try:
            settings = check_settings(h._usable(doc.body if doc is not None else {}))
        except ValueError as exc:
            log.warning("features: %s not turned on: the feature settings are unreadable (%s)", piece, exc)
            return False
        if self.eligible(piece, settings, set()) is not None:      # a person changed it a moment ago
            return False
        name = TITLES[piece]
        at = h.now().isoformat()
        version = doc.version if doc is not None else 0
        try:
            audit.config(None, None, "features.auto_on", {"piece": piece, "why": need.why, "version": version},
                         app=h.app)
        except audit.Unavailable:
            log.warning("features: %s not turned on: the audit row could not be written", name)
            return False
        body = copy.deepcopy(settings)
        body[piece]["enabled"] = True
        for k, v in (need.write or {}).items():
            if k in body[piece] and not body[piece][k]:
                body[piece][k] = v
        body["auto"]["decided"][piece] = decided_marker("auto", at, need.why)
        try:
            self._write(body, doc, f"{name} on: {need.why}")
        except Exception as exc:  # noqa: BLE001 -- a person's save won the race, or the store refused: next look
            log.info("features: %s not turned on this time (%s)", name, exc)
            return False
        log.info("features: %s turned on by Mantel: %s", name, need.why)
        self.turned_on.append({"piece": piece, "at": at, "why": need.why})
        await h.reload()
        if piece == "live_tv" and h.started:
            h.spawn(h.tv.refresh())
        if piece not in self.raised:
            self.raised.add(piece)
            alerts = h.app.get("alerts")
            if alerts is not None:
                try:
                    alerts.center.raise_("feature.enabled", piece, {"name": name, "why": need.why})
                except Exception:  # noqa: BLE001 -- the feature is on; the alert is extra
                    log.exception("features: the feature.enabled alert failed")
        return True

    # -- what the Owner sees -------------------------------------------------------------------------------
    def row(self, piece: str) -> dict[str, Any]:
        """Advanced → Features' words for one piece: ``auto`` {at, why} when Mantel turned it on, ``note`` when
        it's off and near."""
        mark = self.decided().get(piece) or {}
        auto = {"at": mark.get("at"), "why": mark.get("why")} \
            if mark.get("by") == "auto" and self.host.on(piece) else None
        need = self.needs.get(piece)
        note = need.note if need is not None and not self.host.on(piece) and need.met is not True and \
            piece not in self.decided() else ""
        return {"auto": auto, "note": note or None}

    def status(self) -> dict[str, Any]:
        return {"enabled": self.switch(), "decided": self.decided(), "looks": self.looks, "looked_at": self.looked_at,
                "waiting": sorted(self.first), "turned_on": list(self.turned_on),
                "needs": {p: {"met": n.met, "why": n.why, "note": n.note} for p, n in self.needs.items()},
                "why_not": dict(self.why_not)}
