"""THE BRIDGE: Mantel's entities and actions in Home Assistant, over the link
(mantel_link.py). docs/phase9/MANTEL-LINK.md in the Mantel repository is the
whole story; this is Home Assistant's half of it.

ONE LINK, AUTHENTICATED. A Mantel Service credential (scope `linked`), sent
as a header on the WebSocket upgrade. Mantel never asks this side to call a
Home Assistant service: what it sends only changes the entities mirrored here.

WHO MIRRORS. Home Assistant may still have HK Frontend, the integration Mantel
Link replaces, mirroring the same entities (its "Linked to Mantel Server").
Two integrations must never publish one unique id, so exactly one holds the
BRIDGE, and Mantel says which (`owners.bridge`, set by an Owner in Mantel
Settings, audited):
  * "hk_frontend" (the default): Mantel Link is DORMANT. Linked, its actions
    reach Mantel, but it mirrors nothing. HK Frontend keeps the house as it is.
  * "mantel": Mantel Link mirrors. HK Frontend (its last release) stops.
A Home Assistant with no HK Frontend at all has no one else: Mantel Link
mirrors whatever the bridge says.

THE HAND-OVER KEEPS ENTITY IDS. Home Assistant's registry keys an entity by
(domain, integration, unique id). The unique ids stay HK Frontend's strings,
and the registry entry itself moves (`async_update_entity_platform`: same
entity id, history, area and customisations). The side that TAKES an entity
moves it, once the side giving it up has unloaded it: Mantel Link here
(`_place`), HK Frontend's last release when the bridge goes back. A move
interrupted by a restart simply happens at the next start: each entity is
placed when Mantel describes it. The entity stays on its device: Mantel Link
joins HK Frontend's device for it (its area and name are kept).

WHAT IS MIRRORED. The units Mantel owns (per-tablet ownership,
docs/phase6/CUTOVER.md section 1): a tablet's four entities once that tablet
is Mantel's, the house's (Seasonal decorations, Alarm PIN, Live TV) once
`house` is. Nothing of a unit Home Assistant's HK Frontend still runs.
"""
from __future__ import annotations

import asyncio
from collections.abc import Mapping
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.entity import entity_sources

from .const import CONF_OWNERS, CONF_TOKEN, CONF_URL, DOMAIN, HK_DOMAIN, NAME, PROTOCOL
from .entity import MANUFACTURER
from .mantel_link import LinkError, MantelLink, Refused

_LOGGER = logging.getLogger(__name__)

# Mantel's refusals that are the caller's to fix (the rest are Mantel's trouble)
VALIDATION = {"invalid", "unknown_service", "unknown_target", "unknown_entity", "unknown_command",
              "not_a_black_screen", "invalid_code", "code_required", "code_locked", "unknown_popup",
              "not_owned", "commands_disabled", "forbidden", "not_set_up"}
PLATFORMS = ("switch", "sensor", "binary_sensor", "camera", "alarm_control_panel")
TAKE_TIMEOUT = 120.0     # how long a hand-over waits for HK Frontend to let go of one entity
TAKE_POLL = 0.25


# ------------------------------------------------------------ the entry's data
def link_of(entry: ConfigEntry | None) -> dict[str, str] | None:
    """The entry's link -- {"url", "token"} -- or None."""
    if entry is None:
        return None
    url, token = entry.data.get(CONF_URL), entry.data.get(CONF_TOKEN)
    if not isinstance(url, str) or not url.strip() or not isinstance(token, str) or not token.strip():
        return None
    return {"url": url.strip(), "token": token.strip()}


def owners_of(raw: Any) -> dict[str, Any]:
    """Who owns what, as Mantel last said: {"house": bool, "tablets": frozenset,
    "bridge": "hk_frontend"|"mantel"}. Nothing said: everything Home Assistant's,
    and the bridge HK Frontend's."""
    raw = raw if isinstance(raw, Mapping) else {}
    tablets = raw.get("tablets")
    tablets = frozenset(str(t) for t in tablets if isinstance(t, str) and t) if isinstance(tablets, list) else frozenset()
    return {"house": raw.get("house") == "mantel", "tablets": tablets,
            "bridge": "mantel" if raw.get("bridge") == "mantel" else "hk_frontend"}


def wire_owners(raw: Any) -> dict[str, Any]:
    """Mantel's `owners` as kept in the entry's data (normalised)."""
    o = owners_of(raw)
    return {"house": "mantel" if o["house"] else "ha", "tablets": sorted(o["tablets"]), "bridge": o["bridge"]}


def hk_entries(hass: HomeAssistant) -> list[ConfigEntry]:
    """HK Frontend's house entry, if this Home Assistant has HK Frontend (an
    entry the user ignored is not one; an old feature entry is not the house's)."""
    return [e for e in hass.config_entries.async_entries(HK_DOMAIN, include_ignore=False)
            if not e.data.get("kind")]


def hk_report(hass: HomeAssistant) -> dict[str, bool]:
    """What Mantel is told about HK Frontend here (it decides whether the
    bridge can be handed over)."""
    entries = hk_entries(hass)
    return {"installed": bool(entries),
            "loaded": any(e.state is ConfigEntryState.LOADED for e in entries),
            "linked": any(isinstance(e.data.get("mantel_link"), Mapping) for e in entries)}


async def versions(hass: HomeAssistant) -> dict[str, str]:
    """Mantel Link's installed version and HK Frontend's, when it is here (Mantel's update check compares them
    with their latest releases)."""
    from homeassistant.loader import IntegrationNotFound, async_get_integration
    out: dict[str, str] = {}
    for domain in (DOMAIN, HK_DOMAIN) if hk_entries(hass) else (DOMAIN,):    # HK Frontend set up here, not only on disk
        try:
            got = (await async_get_integration(hass, domain)).version
        except IntegrationNotFound:
            continue
        if got:
            out[domain] = str(got)
    return out


def active_for(hass: HomeAssistant, owners: Mapping[str, Any]) -> bool:
    """Does Mantel Link mirror? It holds the bridge, or there is no HK Frontend."""
    return owners_of(owners)["bridge"] == "mantel" or not hk_entries(hass)


def setup_key(hass: HomeAssistant, entry: ConfigEntry) -> Any:
    """What the entry was set up for; a change of it reloads the entry."""
    link = link_of(entry)
    o = owners_of(entry.data.get(CONF_OWNERS))
    return (link and (link["url"], link["token"]), o["house"], tuple(sorted(o["tablets"])), o["bridge"],
            active_for(hass, entry.data.get(CONF_OWNERS) or {}))


def bridge_of(hass: HomeAssistant) -> "Bridge | None":
    """The running bridge, while Mantel Link's entry is set up."""
    for e in hass.config_entries.async_entries(DOMAIN):
        b = getattr(e, "runtime_data", None)
        if isinstance(b, Bridge) and e.state is ConfigEntryState.LOADED:
            return b
    return None


# ------------------------------------------------------------ the bridge
class Bridge:
    """The link and the entities it mirrors. Also the link's listener."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, *, timeout: float | None = None,
                 take_timeout: float = TAKE_TIMEOUT) -> None:
        link = link_of(entry)
        assert link is not None
        self.hass, self.entry = hass, entry
        # live_tv: this side has Live TV's transcode (tv.py), so Mantel may play its channels here
        self.link = MantelLink(async_get_clientsession(hass), link["url"], link["token"], self,
                               domain=DOMAIN, protocol=PROTOCOL, features=("bridge", "live_tv"),
                               frames=self.frames(), on_auth_failed=self.on_auth_failed,
                               **({"timeout": timeout} if timeout is not None else {}))
        self.descs: dict[str, dict[str, Any]] = {}          # unique id -> Mantel's descriptor (all of them)
        self.entities: dict[str, Any] = {}                   # unique id -> the entity added
        self.adders: dict[str, Any] = {}                     # platform -> async_add_entities
        self._placing: dict[str, asyncio.Task] = {}          # unique id -> its hand-over in progress
        self.take_timeout = take_timeout
        o = owners_of(entry.data.get(CONF_OWNERS))
        self.full: bool = bool(o["house"])
        self.tablets: frozenset[str] = frozenset(o["tablets"])
        self.bridge: str = o["bridge"]
        self.active: bool = active_for(hass, entry.data.get(CONF_OWNERS) or {})
        self._pending_owners: dict[str, Any] | None = None
        self._unwait: Any = None
        self.waiting: set[str] = set()                       # entities HK Frontend has not let go of yet

    @callback
    def on_auth_failed(self, status: int) -> None:
        """Mantel refused the credential (revoked in Mantel Settings, or the App announced a new one that never
        reached this entry): Home Assistant's re-authentication asks for a pairing code, instead of the link
        retrying every 30 s for good (2026-11-01, audit 3)."""
        _LOGGER.info("%s: Mantel refused the credential (HTTP %s); re-authentication started "
                     "(Settings, Devices & services)", NAME, status)
        self.entry.async_start_reauth(self.hass)

    def frames(self) -> dict[str, Any]:
        """Server frame types beyond protocol 1's that this side handles: a notification for a phone (9.7)."""
        return {"phone_notify": self.on_phone_notify}

    # ---- the Companion app's phones (docs/phase9/MANTEL-LINK.md 9.7)
    @callback
    def on_phone_notify(self, msg: dict[str, Any]) -> None:
        """The ONE thing Mantel may ask of Home Assistant: a notification to a Companion-app phone. Only a
        notify.mobile_app_* service this Home Assistant has, only these fields; anything else is dropped."""
        from .phones import phone_call
        call = phone_call(self.hass, msg)
        if call is None:
            _LOGGER.warning("%s: ignored a phone notification Mantel described badly", NAME)
            return
        service, data = call
        self.hass.async_create_task(self._notify(service, data), f"{NAME}: notify.{service}")

    async def _notify(self, service: str, data: dict[str, Any]) -> None:
        try:
            await self.hass.services.async_call("notify", service, data, blocking=True)
        except Exception as err:  # noqa: BLE001 -- one phone that fails never stops the link
            _LOGGER.warning("%s: notify.%s failed: %s", NAME, service, err)

    async def phone_action(self, action: str) -> None:
        """A phone's answer to one of Mantel's notifications (its Dismiss), back to Mantel."""
        if not self.link.connected:
            return
        try:
            await self.link.request("phone_action", {"action": action})
        except LinkError as err:
            _LOGGER.debug("%s: Mantel did not take the phone's %s: %s", NAME, action, err.message)

    @property
    def connected(self) -> bool:
        return self.link.connected

    @property
    def state(self) -> str:
        """For diagnostics and the log: mirroring, dormant (HK Frontend holds the bridge)."""
        return "mirroring" if self.active else "dormant"

    def start(self) -> None:
        self.entry.async_create_background_task(self.hass, self.link.run(), f"{NAME}: link to Mantel")

    async def stop(self) -> None:
        if self._unwait is not None:
            self._unwait()
            self._unwait = None
        for task in list(self._placing.values()):
            task.cancel()
        self._placing.clear()
        await self.link.close()

    @callback
    def attach(self, platform: str, add: Any) -> None:
        self.adders[platform] = add
        for uid, d in list(self.descs.items()):
            if d["platform"] == platform and self.mine(d) and uid not in self.entities and uid not in self._placing:
                self._place(d)

    # ---- who mirrors what
    def mine(self, d: Mapping[str, Any]) -> bool:
        """Mirrored here: Mantel Link holds the bridge (or there is no HK
        Frontend), and the entity's unit is Mantel's."""
        if not self.active:
            return False
        if self.full:
            return True
        tablet = d.get("tablet")
        return isinstance(tablet, str) and tablet in self.tablets

    # ---- the listener (mantel_link.Listener): Mantel's entities, nothing else
    @callback
    def on_owners(self, owners: dict[str, Any]) -> None:
        """Mantel says who owns what (and who holds the bridge). Kept in the
        entry's data; a change reloads the entry (the update listener)."""
        new = wire_owners(owners)
        old = self.entry.data.get(CONF_OWNERS)
        if isinstance(old, Mapping) and wire_owners(old) == new:
            return
        if old is None and new == wire_owners({}):
            return
        _LOGGER.warning("%s: Mantel says the house is now owned so: %s (was %s)", NAME, new,
                        old or "everything Home Assistant's, the bridge HK Frontend's")
        # until the reload, nothing newly someone else's is mirrored any more
        o = owners_of(new)
        if not active_for(self.hass, new):
            self.active = False
        self.full = self.full and o["house"]
        self.tablets = self.tablets & o["tablets"]
        for uid in [u for u, d in self.descs.items() if u in self.entities and not self.mine(d)]:
            self._drop(uid, registry=False)
        self._pending_owners = new
        if self.entry.state is ConfigEntryState.LOADED:
            self._apply_owners()
        elif self._unwait is None:
            @callback
            def loaded() -> None:
                if self.entry.state is ConfigEntryState.LOADED:
                    self._apply_owners()
            self._unwait = self.entry.async_on_state_change(loaded)

    @callback
    def _apply_owners(self) -> None:
        if self._unwait is not None:
            self._unwait()
            self._unwait = None
        new, self._pending_owners = self._pending_owners, None
        if new is None or self.entry.data.get(CONF_OWNERS) == new:
            return
        self.hass.config_entries.async_update_entry(self.entry, data={**self.entry.data, CONF_OWNERS: new})

    @callback
    def on_hello(self, entities: list[dict[str, Any]]) -> None:
        seen: set[str] = set()
        for e in entities:
            d = self._checked(e)
            if d is not None:
                self._upsert(d)
                seen.add(d["unique_id"])
        for uid in [u for u in self.descs if u not in seen]:
            self.descs.pop(uid, None)
            self._drop(uid, registry=False)          # gone from Mantel's list: off the state machine only

    @callback
    def on_entity(self, entity: dict[str, Any]) -> None:
        d = self._checked(entity)
        if d is not None:
            self._upsert(d)

    @callback
    def on_state(self, unique_id: str, state: Any, attributes: dict[str, Any], available: bool) -> None:
        d = self.descs.get(unique_id)
        if d is None:
            return
        d.update(state=state, attributes=dict(attributes), available=bool(available))
        ent = self.entities.get(unique_id)
        if ent is not None:
            ent.apply(d)

    @callback
    def on_removed(self, unique_id: str, forget: bool = True) -> None:
        # Mantel removed it (a tablet removed): from the registry too. Only no
        # longer Mantel's (its unit moved back): the registry entry stays, for
        # HK Frontend to take back with its entity id.
        d = self.descs.pop(unique_id, None)
        self._drop(unique_id, registry=forget and d is not None and self.mine(d))

    @callback
    def on_connected(self, connected: bool) -> None:
        for ent in self.entities.values():
            if ent.hass is not None:
                ent.async_write_ha_state()
        if connected:
            self.hass.async_create_task(self.report(), f"{NAME}: report")

    async def report(self) -> None:
        """Tell Mantel whether this Home Assistant has HK Frontend (whether the
        bridge can be handed over is Mantel's to say)."""
        if not self.link.connected:
            return
        try:
            from .phones import phones
            await self.link.request("report", {"report": {"hk_frontend": hk_report(self.hass),
                                                          "phones": phones(self.hass)}})
        except LinkError as err:
            _LOGGER.debug("%s: Mantel did not take the report: %s", NAME, err.message)
        try:   # on its own: a Mantel from before the update check refuses the key, and nothing else is lost
            await self.link.request("report", {"report": {"versions": await versions(self.hass)}})
        except LinkError as err:
            _LOGGER.debug("%s: Mantel did not take the versions: %s", NAME, err.message)

    @staticmethod
    def _checked(d: Any) -> dict[str, Any] | None:
        if (not isinstance(d, dict) or not isinstance(d.get("unique_id"), str) or not d["unique_id"]
                or d.get("platform") not in PLATFORMS):
            _LOGGER.warning("%s: ignored an entity Mantel described badly", NAME)
            return None
        eid = d.get("entity_id")
        if eid is not None and (not isinstance(eid, str) or not eid.startswith(d["platform"] + ".")):
            d = {**d, "entity_id": None}
        return {**d, "attributes": dict(d.get("attributes") or {}), "features": dict(d.get("features") or {})}

    def _upsert(self, d: dict[str, Any]) -> None:
        uid = d["unique_id"]
        old = self.entities.get(uid)
        if old is not None and old.linked_platform != d["platform"]:
            self._drop(uid, registry=True)
            old = None
        self.descs[uid] = d
        if not self.mine(d):
            if old is not None:
                self._drop(uid, registry=False)
            return
        if old is not None:
            old.apply(d)
        elif d["platform"] in self.adders and uid not in self._placing:
            self._place(d)

    # ---- placing an entity: taking it over from HK Frontend first, if it has it
    def _place(self, d: dict[str, Any]) -> None:
        uid = d["unique_id"]
        task = self.entry.async_create_background_task(self.hass, self._take_then_add(uid), f"{NAME}: place {uid}")
        self._placing[uid] = task
        task.add_done_callback(lambda _t, uid=uid: self._placing.pop(uid, None) if self._placing.get(uid) is _t else None)

    async def _take_then_add(self, uid: str) -> None:
        loop = asyncio.get_running_loop()
        end = loop.time() + self.take_timeout
        reg = er.async_get(self.hass)
        while True:
            d = self.descs.get(uid)
            if d is None or not self.mine(d) or uid in self.entities:
                return
            hk_eid = reg.async_get_entity_id(d["platform"], HK_DOMAIN, uid)
            if hk_eid is None:
                break
            if hk_eid in entity_sources(self.hass):
                # HK Frontend still shows it: wait for it to let go (its own
                # reload, told the same `owners` as this side)
                self.waiting.add(uid)
                if loop.time() > end:
                    _LOGGER.warning("%s: HK Frontend still has %s after %.0f s; it stays HK Frontend's until "
                                    "Mantel Link is reloaded (check HK Frontend is its last release and linked)",
                                    NAME, hk_eid, self.take_timeout)
                    return
                await asyncio.sleep(TAKE_POLL)
                continue
            self.take(hk_eid, d)
            break
        self.waiting.discard(uid)
        d = self.descs.get(uid)
        if d is None or not self.mine(d) or uid in self.entities or d["platform"] not in self.adders:
            return
        self._add(d)

    @callback
    def take(self, entity_id: str, d: Mapping[str, Any]) -> None:
        """Move one of HK Frontend's registry entries to Mantel Link: the same
        registry entry, entity id and unique id. Its device: Mantel Link's own
        for the same tablet (Home Assistant gives each integration its own
        devices), made with what the person set on HK Frontend's (its area,
        the name they gave it, its labels), so the entity stays in its room."""
        reg, devs = er.async_get(self.hass), dr.async_get(self.hass)
        old = reg.async_get(entity_id)
        if old is None:
            return
        mine = reg.async_get_entity_id(old.domain, DOMAIN, old.unique_id)
        if mine is not None:
            # a stray entry of Mantel Link's own with the same unique id (an
            # earlier failure): HK Frontend's is the house's, with its history
            if mine in entity_sources(self.hass):
                return
            reg.async_remove(mine)
        dev = devs.async_get(old.device_id) if old.device_id else None
        spec = d.get("device") if isinstance(d.get("device"), Mapping) else {}
        ident = spec.get("identifier")
        new_dev = None
        if ident:
            from .entity import device_name
            new_dev = devs.async_get_or_create(
                config_entry_id=self.entry.entry_id, identifiers={(DOMAIN, ident)},
                name=device_name(spec.get("name")), manufacturer=MANUFACTURER, model=spec.get("model"),
                entry_type=dr.DeviceEntryType.SERVICE)
            if dev is not None:
                carry: dict[str, Any] = {}
                if new_dev.area_id is None and dev.area_id is not None:
                    carry["area_id"] = dev.area_id
                if new_dev.name_by_user is None and dev.name_by_user is not None:
                    carry["name_by_user"] = dev.name_by_user
                if not new_dev.labels and dev.labels:
                    carry["labels"] = set(dev.labels)
                if carry:
                    new_dev = devs.async_update_device(new_dev.id, **carry) or new_dev
        reg.async_update_entity_platform(entity_id, DOMAIN, new_config_entry_id=self.entry.entry_id,
                                         new_config_subentry_id=None, new_device_id=new_dev.id if new_dev else None)
        _LOGGER.info("%s: took %s over from HK Frontend (the same entity id and unique id)", NAME, entity_id)

    def _add(self, d: dict[str, Any]) -> None:
        from .entity import CLASSES
        ent = CLASSES[d["platform"]](self, d)
        self.entities[d["unique_id"]] = ent
        self.adders[d["platform"]]([ent])

    def _drop(self, uid: str, *, registry: bool) -> None:
        task = self._placing.pop(uid, None)
        if task is not None:
            task.cancel()
        self.waiting.discard(uid)
        ent = self.entities.pop(uid, None)
        if ent is None or ent.hass is None:
            return
        eid = ent.entity_id
        self.hass.async_create_task(ent.async_remove(force_remove=registry))
        if registry and eid:
            reg = er.async_get(self.hass)
            if reg.async_get(eid):
                reg.async_remove(eid)

    # ---- forwarding
    def _fail(self, what: str, err: LinkError) -> HomeAssistantError:
        if isinstance(err, Refused):
            msg = f"Mantel refused {what}: {err.message}"
            return ServiceValidationError(msg) if err.code in VALIDATION else HomeAssistantError(msg)
        return HomeAssistantError(f"{what} was not done: {err.message} ({NAME} at {self.link.url})")

    async def forward(self, service: str, data: Mapping[str, Any], targets: list[dict[str, str]] | None = None,
                      *, name: str | None = None) -> Any:
        """One action, as called, to Mantel. `name` is how the caller called
        it (mantel.x or the alias hk_frontend.x), for its error."""
        payload: dict[str, Any] = {"service": service, "data": dict(data)}
        if targets:
            payload["targets"] = targets
        try:
            return await self.link.request("call_service", payload)
        except LinkError as err:
            raise self._fail(name or f"{DOMAIN}.{service}", err) from None

    async def command(self, ent: Any, command: str, code: str | None = None) -> Any:
        """A command to one mirrored entity, to Mantel."""
        payload = {"unique_id": ent.unique_id, "command": command, "data": {"code": code} if code is not None else {}}
        try:
            return await self.link.request("entity_command", payload)
        except LinkError as err:
            raise self._fail(f"{command} on {ent.entity_id}", err) from None

    # ---- what diagnostics show (never the credential)
    def diagnostics(self) -> dict[str, Any]:
        return {"url": self.link.url, "connected": self.link.connected, "last_error": self.link.last_error,
                "protocol": self.link.hello.get("protocol"), "instance": self.link.hello.get("instance"),
                "state": self.state, "owners": wire_owners(self.entry.data.get(CONF_OWNERS)),
                "described": len(self.descs), "mirrored": len(self.entities),
                "waiting_for_hk_frontend": sorted(self.waiting), "hk_frontend": hk_report(self.hass)}


# ------------------------------------------------------------ giving everything back
@callback
def give_back(hass: HomeAssistant, entry: ConfigEntry) -> int:
    """Mantel Link's entry is being removed: hand its entities back to HK
    Frontend's entry, if Home Assistant has one, so removing Mantel Link never
    deletes the house's entity ids (Home Assistant would clear them with the
    entry). Run after the entry is unloaded. Returns how many moved."""
    hk = hk_entries(hass)
    if not hk:
        return 0
    reg = er.async_get(hass)
    moved = 0
    for ent in er.async_entries_for_config_entry(reg, entry.entry_id):
        if ent.platform != DOMAIN or ent.entity_id in entity_sources(hass):
            continue
        if reg.async_get_entity_id(ent.domain, HK_DOMAIN, ent.unique_id) is not None:
            continue
        reg.async_update_entity_platform(ent.entity_id, HK_DOMAIN, new_config_entry_id=hk[0].entry_id,
                                         new_config_subentry_id=None)
        moved += 1
    if moved:
        _LOGGER.warning("%s removed: %d entities handed back to HK Frontend (the same entity ids)", NAME, moved)
    return moved
