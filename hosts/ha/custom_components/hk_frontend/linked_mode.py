"""LINKED TO MANTEL SERVER (Configure -> Linked to Mantel Server): the house has
moved to Mantel Server, and this integration keeps what Home Assistant's
automations, scripts and history depend on -- the same hk_frontend.* actions
and the same entities, with the same unique ids, so the same entity ids.

OFF BY DEFAULT. Nothing here runs until the entry's data holds a link
(CONF_MANTEL_LINK: Mantel Server's address and a Service credential). Without
one, everything this integration does is exactly what it did before.

PER-TABLET OWNERSHIP (the cutover: docs/phase6/CUTOVER.md section 1, Option
A). While the house moves one wall tablet at a time, each tablet is owned by
Home Assistant (this integration's own engines and entities, as today) or by
Mantel Server; "house" is the rest of the entry (Seasonal decorations, Alarm
PIN, Live TV, the features, the HK Settings page). Mantel's Owner moves them
(Mantel keeps the rows and audits every move); the link's hello and an
`owners` frame tell this side, which keeps the last word in the entry's data
(CONF_MANTEL_OWNERS) so a restart without Mantel keeps it, and reloads the
entry when it changes. Nothing told yet: everything is Home Assistant's.

  * LINKED, "house" HOME ASSISTANT'S (Steps 3-6): today's integration runs as
    always, except for the tablets Mantel owns: they get no engine and no
    entities of HA's own; their four entities are Mantel's, mirrored, and
    set_black_screen on them (or a command to them) is forwarded. show_popup,
    close_popup and notify run here as always AND are forwarded too, while
    Mantel owns any tablet (its screens are Mantel's); a Mantel that cannot be
    reached then only logs, since HA's own screens got it.
  * LINKED, "house" MANTEL'S (Step 7, every tablet already Mantel's): the
    whole entry is Mantel's, as below.

WHEN THE WHOLE ENTRY IS MANTEL'S (the entry is reloaded the moment the link or
the ownership is set or changed):
  * the actions automations call -- set_black_screen, show_popup, close_popup,
    notify -- keep their names and schemas, and are FORWARDED to Mantel Server over
    one authenticated WebSocket (mantel_link.py), answered by id. A Mantel
    Server that is not connected, or does not answer in 10 s, fails the action
    with a clear error; one that refuses says why.
  * the entities are MANTEL'S: it sends each one's platform, unique id,
    suggested entity id, name and device, and pushes every state change. The
    registry keeps the entity ids a house already has (it keys by unique id),
    and each entity stays on its device and its item. A command sent to one
    (a switch turned off, the alarm panel disarmed with its PIN) is forwarded
    the same way. While the link is down they are unavailable.
  * the black screen's `confirmed` handshake holds end to end: Mantel sends a
    call's state changes BEFORE its answer, so when set_black_screen returns
    the switch already reads on (not confirmed), and `confirmed` turns true
    when the tablet's page says it went black -- what the sleep scripts wait on.
  * nothing local runs that Mantel now does: the features (Music, Live TV, ...),
    the wall tablets' Sleep Screen engines and their entities, the HK Settings
    page. /hk/ is still served.
  * HK'S SETTINGS ARE MANTEL'S (decision 29, Mantel's docs/phase9/TWO-PRODUCTS.md):
    Mantel sends them over the link (a `settings` frame, after hello and after
    every change), this side keeps the last one (MIRROR, and a Store so a
    restart without Mantel has it), and the dashboards' settings feed is
    answered from it -- also while Mantel can't be reached. A save the
    dashboards make (SAVES) goes to Mantel as `settings_write`, as the Home
    Assistant user who made it: Mantel saves it as the person linked to that
    user, or says in words why not (forward_saves).

Mantel never asks Home Assistant to do anything over the link: nothing it
sends can call a service here (the listener below only changes the mirrored
entities).

THE CREDENTIAL is a Mantel Service account's (scope `linked`). Home Assistant
keeps config entry data in .storage/core.config_entries, in plain text on
disk, as it does every integration's tokens; anyone who can read that file
(or a backup of it) can open the link. It is never logged or put in
diagnostics, and it is revoked on Mantel Server's side in one step.
"""
from __future__ import annotations

from collections.abc import Mapping
import functools
import logging
from typing import Any

from homeassistant.components import websocket_api
from homeassistant.components.alarm_control_panel import (
    AlarmControlPanelEntity, AlarmControlPanelEntityFeature, AlarmControlPanelState, CodeFormat,
)
from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.components.camera import Camera, CameraEntityFeature
from homeassistant.components.sensor import SensorEntity
from homeassistant.components.switch import SwitchEntity
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity import Entity

from .const import CONF_MANTEL_LINK, CONF_MANTEL_OWNERS, DOMAIN, SIGNAL_CONFIG
from .mantel_link import LinkError, MantelLink, Refused, plain_target, ws_url

_LOGGER = logging.getLogger(__name__)

DATA = "linked"                        # hass.data[DOMAIN][DATA]: the running Linked
# hass.data[DOMAIN][MIRROR]: the last settings Mantel sent ({version, payload}), kept in the Store too
MIRROR = "mantel_settings"
MIRROR_STORE = "hk_frontend.mantel_settings"
MIRROR_VERSION = 1
ISSUE_UNLINKED = "mantel_admins_unlinked"   # Repairs: Home Assistant admins who can't save HK's settings
# the features' actions: while Mantel runs the house, Mantel's engines run them (its linked_actions.py), so
# they are forwarded under the same names (feature `actions`); otherwise HA's own run them, as always
# the features' reads HK's dashboards make (Live TV's channels, music, Clean Areas, the snooze and page-header feeds,
# a notification's snapshot, pop-ups): while Mantel runs the house Mantel answers them, as the person (feature
# `reads`; Mantel's linked_reads.py). Subscriptions stay open across a reconnect (asked again).
READS_REQUEST = ("hk_tv/channels", "hk_music/queue", "hk_notify/snap/sign")
READS_SUBSCRIBE = ("hk_music/subscribe", "hk_clean_areas/subscribe", "hk_frontend/snooze/subscribe",
                   "hk_frontend/page_headers/subscribe", "hk_frontend/events/subscribe")
# where HK's texts send someone to set a feature up, while Mantel runs the house (the settings feed's `places`;
# hk-host-shell.js haPlace): Mantel's settings, not HK Frontend's own
PLACES = {p: "Mantel Settings → Features" for p in (
    "HK Frontend → Add feature", "Devices & Services → HK Frontend → Add feature",
    "Settings → Devices & services → HK Frontend → Add feature")}
PLACES.update({p: "Mantel Settings" for p in (
    "HK Frontend → Configure → Menu and room pages", "Settings → Devices & Services → HK Frontend → Configure",
    "HK Frontend -> Configure -> Weather")})
FORWARDED = ("music_play", "music_transfer", "music_stop", "music_transport", "music_play_media", "clean_areas",
             "pause_automation", "resume_automation")
# the settings saves HK's pages make, as Mantel takes them (its settings_store SETTINGS_SAVES and FEATURE_SAVES;
# Mantel's tests keep the two lists the same). While the settings are Mantel's, each goes to Mantel.
SAVES = frozenset({
    "hk_frontend/settings/set", "hk_frontend/board/set", "hk_frontend/tablet/set", "hk_frontend/setup/done",
    "hk_frontend/calendar/color", "hk_frontend/chip/save", "hk_frontend/chip/remove",
    "hk_frontend/accessory/set", "hk_frontend/accessory/order", "hk_frontend/accessory/into",
    "hk_frontend/accessory/page_order", "hk_frontend/accessory/room_scenes", "hk_frontend/board/favorite",
    "hk_frontend/hidden/also", "hk_frontend/hidden/set", "hk_frontend/tablet/add", "hk_frontend/tablet/remove",
    "hk_frontend/dashboard/titled",
})
# what the link forwards (and nothing else): the actions automations use
SERVICES = ("set_black_screen", "show_popup", "close_popup", "notify")
# Mantel's refusals that are the caller's to fix (the rest are Mantel's trouble)
_VALIDATION = {"invalid", "unknown_service", "unknown_target", "unknown_entity", "unknown_command",
               "not_a_black_screen", "invalid_code", "code_required", "code_locked", "unknown_popup",
               "not_owned"}
# attributes Home Assistant itself sets: never taken from Mantel's
_RESERVED = {"friendly_name", "icon", "entity_picture", "supported_features", "device_class",
             "unit_of_measurement", "assumed_state", "attribution", "restored", "state_class", "options",
             "access_token", "code_format", "code_arm_required", "frontend_stream_type", "entity_id"}


# ------------------------------------------------------------ the setting
def link_of(entry: ConfigEntry | None) -> dict[str, str] | None:
    """The entry's link -- {"url", "token"} -- or None (not linked: the default)."""
    raw = entry.data.get(CONF_MANTEL_LINK) if entry is not None else None
    if not isinstance(raw, Mapping):
        return None
    url, token = raw.get("url"), raw.get("token")
    if not isinstance(url, str) or not url.strip() or not isinstance(token, str) or not token.strip():
        return None
    return {"url": url.strip(), "token": token.strip()}


def configured(entry: ConfigEntry | None) -> bool:
    return link_of(entry) is not None


def _owners(raw: Any) -> dict[str, Any]:
    raw = raw if isinstance(raw, Mapping) else {}
    tablets = raw.get("tablets")
    tablets = frozenset(str(t) for t in tablets if isinstance(t, str) and t) if isinstance(tablets, list) else frozenset()
    # who mirrors Mantel's entities in HA (handover.py): this integration, or Mantel Link
    return {"house": raw.get("house") == "mantel", "tablets": tablets,
            "bridge": "mantel" if raw.get("bridge") == "mantel" else "hk_frontend"}


def owners_of(entry: ConfigEntry | None) -> dict[str, Any]:
    """Who owns what, as Mantel last said: {"house": bool (the rest of the
    entry is Mantel's), "tablets": frozenset of the tablet ids Mantel owns,
    "bridge": "hk_frontend"|"mantel" (who mirrors them: handover.py)}.
    Nothing said: everything Home Assistant's, the bridge this integration's."""
    return _owners(entry.data.get(CONF_MANTEL_OWNERS) if entry is not None else None)


def wire_owners(owners: Mapping[str, Any]) -> dict[str, Any]:
    """Mantel's `owners` as kept in the entry's data (normalised)."""
    o = _owners(owners)
    return {"house": "mantel" if o["house"] else "ha", "tablets": sorted(o["tablets"]), "bridge": o["bridge"]}


def full(entry: ConfigEntry | None) -> bool:
    """Linked, and the whole entry is Mantel's (Step 7): nothing local runs."""
    return configured(entry) and owners_of(entry)["house"]


def setup_key(entry: ConfigEntry | None) -> Any:
    """What the entry was set up for (a change of it reloads the entry): the
    link and, while linked, the ownership."""
    link = link_of(entry)
    if link is None:
        return None
    o = owners_of(entry)
    return (link["url"], link["token"], o["house"], tuple(sorted(o["tablets"])), o["bridge"])


def mantel_tablets(hass: HomeAssistant, entry: ConfigEntry | None) -> frozenset[str]:
    """The tablets Mantel owns (no engine or entity of HA's own for them)."""
    if not configured(entry):
        return frozenset()
    return owners_of(entry)["tablets"]


def describe(entry: ConfigEntry | None) -> str:
    """For Configure and the log: who owns what, in words."""
    if not configured(entry):
        return "not linked"
    o = owners_of(entry)
    if o["bridge"] == "mantel":
        from .handover import describe as bridge_words
        return "linked; " + str(bridge_words(entry))
    if o["house"]:
        return "linked; the whole entry is Mantel Server's"
    if o["tablets"]:
        return ("linked; Mantel Server owns the tablet(s) " + ", ".join(sorted(o["tablets"]))
                + ", Home Assistant everything else")
    return "linked; every tablet is still Home Assistant's"


async def check_url(address: str) -> str | None:
    """An error key for Configure's form, or None (run on the event loop; a
    name is resolved without blocking). wss:// is allowed anywhere. Plain
    ws:// only to this machine or Home Assistant's internal App network
    (172.30.32.0/23, which never leaves the host): loopback, an IP literal there, or
    an App hostname (local-<slug>, <8 hex>-<slug>) whose every resolved
    address is there -- else the credential would cross the network in clear
    (Mantel Server's LAN address is TLS, PLAN section 7)."""
    try:
        ws_url(address)
    except ValueError:
        return "mantel_url_invalid"
    bad, _ = await plain_target(address)
    return bad


APP_ADDRESS = "http://local-mantel:8099"   # the Mantel App installed locally, on HA's internal App network


async def suggested_url(hass: HomeAssistant | None = None) -> str:
    """What Configure offers when nothing is saved yet: the address Mantel Link (Mantel's own integration, domain
    `mantel`) is linked to, when this Home Assistant has it (it found Mantel by itself: the App's announcement or
    zeroconf); else the Mantel App's own address, when that name resolves inside Home Assistant's internal App
    network (the same check the form applies); else nothing. "Shouldn't this autopopulate if
    it's an HA App?" """
    if hass is not None:
        for e in hass.config_entries.async_entries("mantel"):
            url = e.data.get("url")
            if isinstance(url, str) and url.strip() and await check_url(url) is None:
                return url.strip()
    try:
        bad, _ = await plain_target(APP_ADDRESS)
    except Exception:  # noqa: BLE001 -- only a suggestion: whatever goes wrong, the form opens empty
        return ""
    return "" if bad else APP_ADDRESS


def active(hass: HomeAssistant) -> "Linked | None":
    """The running link, while the house's entry is set up linked."""
    return hass.data.get(DOMAIN, {}).get(DATA)


def mirror_store(hass: HomeAssistant) -> Store:
    """The mirror's Store, one for the whole of HA (a save still pending is what the next read gets)."""
    data = hass.data.setdefault(DOMAIN, {})
    if "mirror_store" not in data:
        data["mirror_store"] = Store(hass, MIRROR_VERSION, MIRROR_STORE)
    return data["mirror_store"]


def mirrored(hass: HomeAssistant) -> dict[str, Any] | None:
    """Mantel's settings feed for the dashboards, while the settings are Mantel's
    (linked, the house Mantel's) and Mantel has sent them once; else None (the
    entry's own, as always)."""
    linked = active(hass)
    if linked is None or not linked.full:
        return None
    got = hass.data.get(DOMAIN, {}).get(MIRROR)
    if not isinstance(got, Mapping) or not isinstance(got.get("payload"), Mapping):
        return None
    return {**dict(got["payload"]), "places": dict(PLACES)}


def _plain(v: Any) -> Any:
    """An action's data as JSON: a date or time as ISO text (pause_automation's until)."""
    if isinstance(v, Mapping):
        return {str(k): _plain(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, set)):
        return [_plain(x) for x in v]
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def forward_actions(hass: HomeAssistant) -> int:
    """Once the features' actions are registered (async_setup): each runs in
    Mantel while it runs the house, here otherwise. How many were wrapped."""
    from homeassistant.core import SupportsResponse
    mine = hass.services.async_services_internal().get(DOMAIN, {})
    n = 0
    for name in FORWARDED:
        svc = mine.get(name)
        if svc is None or getattr(svc.job.target, "_hk_forwards", False):
            continue
        original = svc.job.target

        async def handler(call: Any, _name: str = name, _original: Any = original) -> Any:
            linked = active(hass)
            if linked is not None and linked.full:
                got = await linked.forward(_name, _plain(dict(call.data)))
                return got if call.return_response and isinstance(got, dict) else None
            out = _original(call)
            if hasattr(out, "__await__"):
                out = await out
            return out
        handler._hk_forwards = True     # type: ignore[attr-defined]
        hass.services.async_register(DOMAIN, name, handler, schema=svc.schema,
                                     supports_response=svc.supports_response or SupportsResponse.NONE)
        n += 1
    return n


def forward_reads(hass: HomeAssistant) -> int:
    """Once every command is registered (async_setup): the dashboards' feature
    reads go to Mantel while it runs the house, here otherwise. How many."""
    handlers = hass.data.get(websocket_api.DOMAIN, {})
    n = 0
    for t in (*READS_REQUEST, *READS_SUBSCRIBE):
        got = handlers.get(t)
        if not isinstance(got, tuple) or getattr(got[0], "_hk_forwards", False):
            continue
        handler, schema = got

        def wrapper(hass_: HomeAssistant, connection: Any, msg: dict[str, Any], _h: Any = handler,
                    _sub: bool = t in READS_SUBSCRIBE) -> Any:
            linked = active(hass_)
            user = getattr(connection, "user", None)
            # Home Assistant's own system users (Mantel's connection to HA is one) get HA's own answer: relaying
            # theirs would send Mantel's read straight back to Mantel
            if linked is None or mirrored(hass_) is None or user is None or getattr(user, "system_generated", False):
                return _h(hass_, connection, msg)
            linked.page_read(connection, msg, _sub)
            return None
        wrapper._hk_forwards = True     # type: ignore[attr-defined]
        websocket_api.async_register_command(hass, t, wrapper, schema)
        n += 1
    return n


def forward_saves(hass: HomeAssistant) -> int:
    """Once every command is registered (async_setup): each settings save
    HK's pages make goes to Mantel while the settings are Mantel's, and runs
    here as always otherwise. How many were wrapped."""
    handlers = hass.data.get(websocket_api.DOMAIN, {})
    n = 0
    for t in sorted(SAVES):
        got = handlers.get(t)
        if not isinstance(got, tuple) or getattr(got[0], "_hk_forwards", False):
            continue
        handler, schema = got
        websocket_api.async_register_command(hass, t, _forwarding(handler), schema)
        n += 1
    return n


def _forwarding(handler: Any) -> Any:
    @functools.wraps(handler)
    def wrapper(hass: HomeAssistant, connection: Any, msg: dict[str, Any]) -> Any:
        linked = active(hass)
        if linked is None or mirrored(hass) is None:
            return handler(hass, connection, msg)
        hass.async_create_task(linked.save(connection, msg), "hk_frontend: a settings save to Mantel")
        return None
    wrapper._hk_forwards = True     # type: ignore[attr-defined]
    return wrapper


def attach(hass: HomeAssistant, entry: ConfigEntry, platform: str, add: Any) -> bool:
    """A platform of the house's entry, linked: Mantel's entities of the
    units it owns are added through it. True when the whole entry is
    Mantel's (the caller then adds nothing of its own)."""
    linked = active(hass)
    if linked is None or linked.entry is not entry:
        return False
    linked.attach(str(platform), add)
    return linked.full


def diagnostics(hass: HomeAssistant, entry: ConfigEntry) -> dict[str, Any]:
    """For Download diagnostics: whether linked and where to -- never the credential."""
    link = link_of(entry)
    linked = active(hass)
    return {"linked": link is not None, "url": link["url"] if link else None,
            "connected": bool(linked and linked.link.connected),
            "entities": len(linked.entities) if linked else 0,
            "last_error": linked.link.last_error if linked else None,
            "owners": wire_owners(entry.data.get(CONF_MANTEL_OWNERS) or {})}


# ------------------------------------------------------------ the running link
class Linked:
    """The link and the entities it mirrors. Also the link's listener."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, *, timeout: float | None = None) -> None:
        link = link_of(entry)
        assert link is not None
        self.hass, self.entry = hass, entry
        # `bridge`: this release can hand the bridge to Mantel Link (handover.py)
        # `settings`: this release keeps Mantel's settings for its dashboards (on_settings)
        self.link = MantelLink(async_get_clientsession(hass), link["url"], link["token"], self,
                               features=("bridge", "settings", "actions", "reads"),
                               frames={"settings": self.on_settings, "page_frame": self.on_page_frame},
                               **({"timeout": timeout} if timeout is not None else {}))
        self._store: Store = mirror_store(hass)
        self._last: dict[str, Any] | None = None        # the mirror as the Store keeps it
        # the dashboards' reads in flight or open at Mantel (page_read): tunnel id -> what to answer
        self._tunnels: dict[int, dict[str, Any]] = {}
        self._next_tunnel = 0
        self._dirty = False                              # not on disk yet (written at stop at the latest)
        self.descs: dict[str, dict[str, Any]] = {}          # unique id -> Mantel's descriptor
        self.entities: dict[str, LinkedEntity] = {}         # unique id -> the entity added
        self.adders: dict[str, Any] = {}                    # platform -> async_add_entities
        # who owns what, as the entry was set up (a change reloads it)
        o = owners_of(entry)
        self.full: bool = bool(o["house"])
        self.tablets: frozenset[str] = frozenset(o["tablets"])
        # Mantel Link holds the bridge: it mirrors Mantel's entities, not this side
        self.bridge_away: bool = o["bridge"] == "mantel"
        self._pending_owners: dict[str, Any] | None = None
        self._unwait: Any = None

    @property
    def connected(self) -> bool:
        return self.link.connected

    async def load_mirror(self) -> None:
        """The settings Mantel sent last time, before the link is up (a restart without Mantel)."""
        try:
            got = await self._store.async_load()
        except Exception:  # noqa: BLE001 -- a broken file only means waiting for Mantel's next frame
            _LOGGER.exception("hk_frontend: the last settings from Mantel could not be read")
            return
        if isinstance(got, Mapping) and isinstance(got.get("version"), str) and isinstance(got.get("payload"), Mapping):
            self.hass.data.setdefault(DOMAIN, {}).setdefault(MIRROR, {"version": got["version"],
                                                                      "payload": dict(got["payload"])})

    @callback
    def on_settings(self, msg: dict[str, Any]) -> None:
        """Mantel's settings (a `settings` frame): kept, and the dashboards told."""
        self._setup(msg.get("setup"))
        version, payload = msg.get("version"), msg.get("payload")
        if not isinstance(version, str) or not 0 < len(version) <= 64 or not isinstance(payload, dict):
            _LOGGER.warning("hk_frontend: ignored settings Mantel Server sent badly")
            return
        data = self.hass.data.setdefault(DOMAIN, {})
        if (data.get(MIRROR) or {}).get("version") == version:
            return
        data[MIRROR] = {"version": version, "payload": payload}
        # `owned`: Mantel's while the house is (mirror.py takes them back in when that ends)
        self._last, self._dirty = {"version": version, "payload": payload, "owned": self.full}, True
        self._store.async_delay_save(self._saved, 1)
        async_dispatcher_send(self.hass, SIGNAL_CONFIG)

    # ---- the dashboards' feature reads, answered by Mantel (forward_reads; Mantel's linked_reads.py)
    @callback
    def page_read(self, connection: Any, msg: dict[str, Any], sub: bool) -> None:
        user = getattr(connection, "user", None)
        if user is None or getattr(user, "system_generated", False):
            connection.send_error(msg.get("id"), "not_linked", "Only a person's Home Assistant user reads this.")
            return
        self._next_tunnel += 1
        tid = self._next_tunnel
        body = {k: v for k, v in msg.items() if k != "id"}
        self._tunnels[tid] = {"conn": connection, "mid": msg.get("id"), "sub": sub, "msg": body, "ha_user": user.id,
                              "answered": False, "early": []}
        if sub:
            @callback
            def unsubscribe() -> None:
                t = self._tunnels.pop(tid, None)
                if t is not None and self.link.connected:
                    self.hass.async_create_task(self._page(t["ha_user"], {"type": "read_unsubscribe", "id": tid}),
                                                "hk_frontend: a dashboard's read ended")
            connection.subscriptions[msg.get("id")] = unsubscribe
        self.hass.async_create_task(self._ask(tid), "hk_frontend: a dashboard's read to Mantel")

    async def _ask(self, tid: int) -> None:
        t = self._tunnels.get(tid)
        if t is None:
            return
        frame = {"type": "read_subscribe" if t["sub"] else "read", "id": tid, "msg": t["msg"]}
        try:
            await self._page(t["ha_user"], frame, raise_=True)
        except Refused as err:
            self._tunnels.pop(tid, None)
            if not t["answered"]:
                t["conn"].send_error(t["mid"], err.code, err.message)
        except LinkError as err:
            if not t["sub"]:
                self._tunnels.pop(tid, None)
            if not t["answered"]:
                t["answered"] = True
                t["conn"].send_error(t["mid"], "mantel_away", f"Mantel Server can't be reached ({err.message}).")

    async def _page(self, ha_user: str, frame: dict[str, Any], raise_: bool = False) -> None:
        try:
            await self.link.request("page", {"ha_user": ha_user, "frame": frame})
        except LinkError:
            if raise_:
                raise

    @callback
    def on_page_frame(self, msg: dict[str, Any]) -> None:
        """Mantel's answer to one of the dashboards' reads, or an event of an open one."""
        frame = msg.get("frame")
        t = self._tunnels.get(frame.get("id")) if isinstance(frame, dict) else None
        if t is None:
            return
        conn, mid = t["conn"], t["mid"]
        if frame.get("type") == "read_result":
            err = frame.get("error")
            if isinstance(err, dict):
                self._tunnels.pop(frame["id"], None)
                if not t["answered"]:
                    conn.send_error(mid, str(err.get("code") or "refused"), str(err.get("message") or "refused"))
                return
            if not t["sub"]:
                self._tunnels.pop(frame["id"], None)
                conn.send_result(mid, frame.get("result"))
                return
            if not t["answered"]:
                t["answered"] = True
                conn.send_result(mid)
                for ev in t["early"]:
                    conn.send_message(websocket_api.event_message(mid, ev))
                t["early"] = []
        elif frame.get("type") == "read_event" and t["sub"]:
            if t["answered"]:
                conn.send_message(websocket_api.event_message(mid, frame.get("event")))
            else:
                t["early"].append(frame.get("event"))      # an event before the subscription's own answer

    @callback
    def _resubscribe(self) -> None:
        """The link is back: Mantel's page contexts were ended with it, so the open subscriptions are asked
        again (their answers already given: only the events follow)."""
        for tid, t in list(self._tunnels.items()):
            if t["sub"]:
                self.hass.async_create_task(self._ask(tid), "hk_frontend: a dashboard's read asked again")

    @callback
    def _fail_reads(self) -> None:
        """The link dropped: Mantel ended its page contexts with it, so a one-shot read still waiting is never
        answered. Each is told now (its page shows Mantel away) instead of waiting for ever; subscriptions stay,
        asked again when the link is back (_resubscribe)."""
        for tid, t in list(self._tunnels.items()):
            if not t["sub"] and not t["answered"]:
                self._tunnels.pop(tid, None)
                t["answered"] = True
                t["conn"].send_error(t["mid"], "mantel_away", "Mantel Server can't be reached (the link dropped).")

    @callback
    def _saved(self) -> dict[str, Any]:
        self._dirty = False
        return dict(self._last or {})

    @callback
    def _setup(self, setup: Any) -> None:
        """Mantel's word on saving from here: while saves are on and Home
        Assistant admins aren't linked to a person, a Repairs issue says so."""
        if not isinstance(setup, Mapping):
            return
        n = setup.get("unlinked_admins")
        n = n if isinstance(n, int) and not isinstance(n, bool) and n >= 0 else 0
        if setup.get("saves") is True and n and self.full:
            ir.async_create_issue(self.hass, DOMAIN, ISSUE_UNLINKED, is_fixable=False, is_persistent=False,
                                  severity=ir.IssueSeverity.WARNING, translation_key=ISSUE_UNLINKED,
                                  translation_placeholders={"count": str(n)})
        else:
            ir.async_delete_issue(self.hass, DOMAIN, ISSUE_UNLINKED)

    async def _report(self) -> None:
        """Which of Home Assistant's dashboards are HK's (Mantel's Screens say where each one is drawn)."""
        from .panel import _dashboards
        try:
            boards = [{"path": d["path"], "title": str(d["title"])[:80]} for d in await _dashboards(self.hass)
                      if d.get("generated") or d.get("item")]
            await self.link.request("report", {"report": {"hk_dashboards": boards[:200]}})
        except LinkError as err:
            _LOGGER.debug("hk_frontend: the dashboards were not reported to Mantel: %s", err.message)
        except Exception:  # noqa: BLE001 -- a report never breaks the link
            _LOGGER.exception("hk_frontend: the dashboards were not reported to Mantel")

    def start(self) -> None:
        self.entry.async_create_background_task(self.hass, self.link.run(), "hk_frontend: link to Mantel Server")

    async def stop(self) -> None:
        if self._unwait is not None:
            self._unwait()
            self._unwait = None
        await self.link.close()
        if self._dirty and self._last is not None:
            # a reload (the house moved back) reads it next: on disk now, not in a second
            self._dirty = False
            await self._store.async_save(self._last)

    @callback
    def attach(self, platform: str, add: Any) -> None:
        self.adders[platform] = add
        for uid, d in list(self.descs.items()):
            if d["platform"] == platform and uid not in self.entities:
                self._add(d)

    # ---- the listener (mantel_link.Listener): Mantel's entities, nothing else
    def mine(self, d: Mapping[str, Any]) -> bool:
        """Is this entity's unit Mantel's? A tablet's: that tablet moved; the
        rest: the whole entry moved. Never while Mantel Link holds the bridge."""
        if self.bridge_away:
            return False
        if self.full:
            return True
        tablet = d.get("tablet")
        return isinstance(tablet, str) and tablet in self.tablets

    @callback
    def on_owners(self, owners: dict[str, Any]) -> None:
        """Mantel says who owns what. Kept in the entry's data (a restart
        without Mantel keeps it); a change reloads the entry (the update
        listener), which then runs HA's own engines for exactly its own."""
        new = wire_owners(owners)
        old = self.entry.data.get(CONF_MANTEL_OWNERS)
        if (wire_owners(old) if isinstance(old, Mapping) else wire_owners({})) == new and (
                old is not None or new == wire_owners({})):
            return
        _LOGGER.warning("hk_frontend: Mantel Server says the house is now owned so: %s (was %s); reloading",
                        new, old or "everything Home Assistant's")
        # until the reload: what is no longer Mantel's is never read as deleted
        # (on_removed), and what is newly Mantel's waits for the reload (HA's
        # own entity still holds its unique id)
        o = _owners(new)
        self.full, self.tablets = self.full and bool(o["house"]), self.tablets & frozenset(o["tablets"])
        if o["bridge"] == "mantel" and not self.bridge_away:
            # the bridge goes to Mantel Link: let go of Mantel's entities now
            # (registry kept), so Mantel Link can take them over
            self.bridge_away = True
            for uid in list(self.entities):
                self._drop(uid, registry=False)
        self._pending_owners = new
        if self.entry.state is ConfigEntryState.LOADED:
            self._apply_owners()
        elif self._unwait is None:
            # the hello came while the entry is still being set up: keep it
            # (and reload) once it is, never in the middle of its setup
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
        if new is None or self.entry.data.get(CONF_MANTEL_OWNERS) == new:
            return
        self.hass.config_entries.async_update_entry(self.entry, data={**self.entry.data, CONF_MANTEL_OWNERS: new})

    @callback
    def on_hello(self, entities: list[dict[str, Any]]) -> None:
        seen = {d["unique_id"] for d in (self._checked(e) for e in entities)
                if d and self.mine(d) and self._upsert(d)}
        for uid in [u for u in self.descs if u not in seen]:
            self._drop(uid, registry=False)          # gone from Mantel's list: off the state machine only

    @callback
    def on_entity(self, entity: dict[str, Any]) -> None:
        d = self._checked(entity)
        if d and self.mine(d):
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
        # Mantel removed it (a tablet removed): from the registry too, as
        # before. Only no longer Mantel's (its unit moved back to HA): the
        # registry entry stays, so HA's own entity keeps its entity id.
        d = self.descs.get(unique_id)
        self._drop(unique_id, registry=forget and (d is None or self.mine(d)))

    @callback
    def on_connected(self, connected: bool) -> None:
        if connected:
            self.entry.async_create_background_task(self.hass, self._report(), "hk_frontend: report to Mantel")
            self._resubscribe()
        else:
            self._fail_reads()
        for ent in self.entities.values():
            if ent.hass is not None:
                ent.async_write_ha_state()

    @staticmethod
    def _checked(d: Any) -> dict[str, Any] | None:
        if (not isinstance(d, dict) or not isinstance(d.get("unique_id"), str) or not d["unique_id"]
                or d.get("platform") not in CLASSES):
            _LOGGER.warning("hk_frontend: ignored a linked entity Mantel Server described badly")
            return None
        eid = d.get("entity_id")
        if eid is not None and (not isinstance(eid, str) or not eid.startswith(d["platform"] + ".")):
            d = {**d, "entity_id": None}
        return {**d, "attributes": dict(d.get("attributes") or {}), "features": dict(d.get("features") or {})}

    def _upsert(self, d: dict[str, Any]) -> bool:
        uid = d["unique_id"]
        old = self.entities.get(uid)
        if old is not None and old.linked_platform != d["platform"]:
            self._drop(uid, registry=True)
            old = None
        self.descs[uid] = d
        if old is not None:
            old.apply(d)
        elif d["platform"] in self.adders:
            self._add(d)
        return True

    def _add(self, d: dict[str, Any]) -> None:
        ent = CLASSES[d["platform"]](self, d)
        self.entities[d["unique_id"]] = ent
        # an entity the house already has stays in its item (a wall tablet's)
        reg = er.async_get(self.hass)
        eid = reg.async_get_entity_id(d["platform"], DOMAIN, d["unique_id"])
        sub = reg.async_get(eid).config_subentry_id if eid else None
        if sub is not None and sub not in self.entry.subentries:
            sub = None
        self.adders[d["platform"]]([ent], config_subentry_id=sub)

    def _drop(self, uid: str, *, registry: bool) -> None:
        self.descs.pop(uid, None)
        ent = self.entities.pop(uid, None)
        if ent is None or ent.hass is None:
            return
        eid = ent.entity_id
        # kept in the registry: unavailable, as a house's entity always was
        # while its integration did not provide it; removed: gone
        self.hass.async_create_task(ent.async_remove(force_remove=registry))
        if registry and eid:
            reg = er.async_get(self.hass)
            if reg.async_get(eid):
                reg.async_remove(eid)

    # ---- forwarding
    def _fail(self, what: str, err: LinkError) -> HomeAssistantError:
        if isinstance(err, Refused):
            msg = f"Mantel Server refused {what}: {err.message}"
            return ServiceValidationError(msg) if err.code in _VALIDATION else HomeAssistantError(msg)
        return HomeAssistantError(f"{what} was not done: {err.message} (HK Frontend is linked to Mantel "
                                  f"Server at {self.link.url})")

    async def save(self, connection: Any, msg: dict[str, Any]) -> None:
        """A settings save from HK's pages, to Mantel as the user who made it;
        answered here with Mantel's result or its refusal, in its words."""
        user = getattr(connection, "user", None)
        mid = msg.get("id")
        if user is None or getattr(user, "system_generated", False):
            connection.send_error(mid, "not_linked", "Only a person's Home Assistant user saves HK settings.")
            return
        body = {k: v for k, v in msg.items() if k != "id"}
        try:
            result = await self.link.request("settings_write", {"ha_user": user.id, "msg": body})
        except Refused as err:
            connection.send_error(mid, err.code, err.message)
            return
        except LinkError as err:
            connection.send_error(mid, "mantel_away", f"Not saved: {err.message}. HK's settings are Mantel's; "
                                                      "try again once Mantel Server is reachable.")
            return
        connection.send_result(mid, result)

    async def forward(self, service: str, data: Mapping[str, Any],
                      targets: list[dict[str, str]] | None = None) -> Any:
        """One hk_frontend action, as called, to Mantel Server."""
        payload: dict[str, Any] = {"service": service, "data": dict(data)}
        if targets:
            payload["targets"] = targets
        try:
            return await self.link.request("call_service", payload)
        except LinkError as err:
            raise self._fail(f"hk_frontend.{service}", err) from None

    async def also(self, service: str, data: Mapping[str, Any]) -> Any:
        """An action HA has just carried out for its own screens, to Mantel
        too while Mantel owns a tablet (its screens are Mantel's). Mantel not
        reachable, or refusing: logged, not raised -- HA's own part is done
        and an automation's next steps still run."""
        if self.full or not self.tablets:
            return None
        try:
            return await self.forward(service, data)
        except HomeAssistantError as err:
            _LOGGER.warning("hk_frontend: %s reached Home Assistant's screens but not Mantel Server's "
                            "(tablets %s): %s", service, ", ".join(sorted(self.tablets)), err)
            return None

    async def command(self, ent: "LinkedEntity", command: str, code: str | None = None) -> Any:
        """A command to one mirrored entity, to Mantel Server."""
        payload = {"unique_id": ent.unique_id, "command": command, "data": {"code": code} if code is not None else {}}
        try:
            return await self.link.request("entity_command", payload)
        except LinkError as err:
            raise self._fail(f"{command} on {ent.entity_id}", err) from None


# ------------------------------------------------------------ setup
def start(hass: HomeAssistant, entry: ConfigEntry) -> "Linked":
    """The link for the house's entry while HA still runs it (house HA's):
    started before the platforms, which attach to it."""
    linked = Linked(hass, entry)
    hass.data.setdefault(DOMAIN, {})[DATA] = linked
    linked.start()
    _LOGGER.info("hk_frontend: linked to Mantel Server at %s; %s", linked.link.url, describe(entry))
    return linked


async def async_stop(hass: HomeAssistant, entry: ConfigEntry) -> None:
    linked = hass.data.get(DOMAIN, {}).get(DATA)
    if linked is not None and linked.entry is entry:
        hass.data[DOMAIN].pop(DATA, None)
        await linked.stop()


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, platforms: list[Any]) -> bool:
    """The house's entry, linked and wholly Mantel's: the link, then the
    platforms (each attaches)."""
    linked = Linked(hass, entry)
    hass.data.setdefault(DOMAIN, {})[DATA] = linked
    await linked.load_mirror()
    key_now = setup_key(entry)

    async def updated(_hass: HomeAssistant, _entry: ConfigEntry) -> None:
        # the link or the ownership set, changed or removed: start again.
        # Nothing else is followed here -- the settings are Mantel's.
        if setup_key(entry) != key_now:
            hass.config_entries.async_schedule_reload(entry.entry_id)

    entry.async_on_unload(entry.add_update_listener(updated))
    linked.start()
    await hass.config_entries.async_forward_entry_setups(entry, platforms)
    _LOGGER.info("hk_frontend: linked to Mantel Server at %s; its entities and actions are Mantel's", linked.link.url)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry, platforms: list[Any]) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, platforms)
    linked = hass.data.get(DOMAIN, {}).get(DATA)
    if ok and linked is not None and linked.entry is entry:
        hass.data[DOMAIN].pop(DATA, None)
        await linked.stop()
    return ok


# ------------------------------------------------------------ the entities
class LinkedEntity(Entity):
    """One of Mantel's entities, as Home Assistant shows it."""

    _attr_should_poll = False
    linked_platform = ""

    def __init__(self, linked: Linked, desc: dict[str, Any]) -> None:
        self._linked, self._desc = linked, desc
        self._attr_unique_id = desc["unique_id"]
        self._attr_has_entity_name = bool(desc.get("has_entity_name", True))
        if desc.get("translation_key"):
            self._attr_translation_key = desc["translation_key"]
            if desc.get("name") is not None:
                self._attr_name = desc["name"]
        else:
            self._attr_name = desc.get("name")
        self._attr_icon = desc.get("icon")
        dev = desc.get("device")
        if isinstance(dev, dict) and isinstance(dev.get("identifier"), str) and dev["identifier"]:
            self._attr_device_info = DeviceInfo(
                identifiers={(DOMAIN, dev["identifier"])}, name=dev.get("name"),
                manufacturer=dev.get("manufacturer"), model=dev.get("model"), entry_type=DeviceEntryType.SERVICE)
        if desc.get("entity_id"):
            self.entity_id = desc["entity_id"]      # suggested; the registry keeps a known one

    @property
    def available(self) -> bool:
        return self._linked.connected and bool(self._desc.get("available", True))

    @property
    def _state(self) -> Any:
        return self._desc.get("state")

    @property
    def _features(self) -> dict[str, Any]:
        return self._desc.get("features") or {}

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {k: v for k, v in (self._desc.get("attributes") or {}).items() if k not in _RESERVED}

    @callback
    def apply(self, desc: dict[str, Any]) -> None:
        self._desc = desc
        if self.hass is not None and self.entity_id:
            self.async_write_ha_state()


class LinkedSwitch(LinkedEntity, SwitchEntity):
    """switch.<tablet>_black_screen, _photo_screensaver, the Seasonal decorations."""

    linked_platform = "switch"

    @property
    def is_on(self) -> bool:
        return self._state in ("on", True)

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._linked.command(self, "turn_on")

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._linked.command(self, "turn_off")

    async def async_set_black_screen(self, black: bool | None = None, brightness: int | None = None) -> None:
        """hk_frontend.set_black_screen, forwarded as called (one call per target)."""
        data: dict[str, Any] = {}
        if black is not None:
            data["black"] = bool(black)
        if brightness is not None:
            data["brightness"] = int(brightness)
        await self._linked.forward("set_black_screen", data,
                                   [{"entity_id": self.entity_id, "unique_id": self.unique_id}])


class LinkedSensor(LinkedEntity, SensorEntity):
    """sensor.<tablet>_sleep_screen, sensor.tv_viewers, Live TV's now-on."""

    linked_platform = "sensor"

    @property
    def native_value(self) -> Any:
        return self._state

    @property
    def native_unit_of_measurement(self) -> str | None:
        return self._desc.get("unit")


class LinkedBinarySensor(LinkedEntity, BinarySensorEntity):
    """binary_sensor.<tablet>_screen_in_use."""

    linked_platform = "binary_sensor"

    @property
    def is_on(self) -> bool:
        return self._state in ("on", True)


class LinkedCamera(LinkedEntity, Camera):
    """Live TV's channels: the stream Mantel names, no still of its own."""

    linked_platform = "camera"

    def __init__(self, linked: Linked, desc: dict[str, Any]) -> None:
        Camera.__init__(self)
        LinkedEntity.__init__(self, linked, desc)

    @property
    def supported_features(self) -> CameraEntityFeature:
        return CameraEntityFeature.STREAM if self._source() else CameraEntityFeature(0)

    def _source(self) -> str | None:
        src = self._features.get("stream_source")
        return src if isinstance(src, str) and src.split("://", 1)[0] in ("http", "https", "rtsp", "rtsps") else None

    async def stream_source(self) -> str | None:
        return self._source()

    async def async_camera_image(self, width: int | None = None, height: int | None = None) -> bytes | None:
        return None


class LinkedAlarmPanel(LinkedEntity, AlarmControlPanelEntity):
    """Alarm PIN's panel: Mantel checks the PIN and arms or disarms."""

    linked_platform = "alarm_control_panel"

    @property
    def alarm_state(self) -> AlarmControlPanelState | None:
        try:
            return AlarmControlPanelState(self._state) if self._state else None
        except ValueError:
            return None

    @property
    def supported_features(self) -> AlarmControlPanelEntityFeature:
        try:
            return AlarmControlPanelEntityFeature(int(self._features.get("supported_features") or 0))
        except (TypeError, ValueError):
            return AlarmControlPanelEntityFeature(0)

    @property
    def code_format(self) -> CodeFormat | None:
        try:
            return CodeFormat(self._features["code_format"]) if self._features.get("code_format") else None
        except ValueError:
            return CodeFormat.TEXT

    @property
    def code_arm_required(self) -> bool:
        return bool(self._features.get("code_arm_required", True))

    @property
    def changed_by(self) -> str | None:
        v = (self._desc.get("attributes") or {}).get("changed_by")
        return v if isinstance(v, str) else None

    async def async_alarm_disarm(self, code: str | None = None) -> None:
        await self._linked.command(self, "alarm_disarm", code)

    async def async_alarm_arm_home(self, code: str | None = None) -> None:
        await self._linked.command(self, "alarm_arm_home", code)

    async def async_alarm_arm_away(self, code: str | None = None) -> None:
        await self._linked.command(self, "alarm_arm_away", code)

    async def async_alarm_arm_night(self, code: str | None = None) -> None:
        await self._linked.command(self, "alarm_arm_night", code)

    async def async_alarm_arm_vacation(self, code: str | None = None) -> None:
        await self._linked.command(self, "alarm_arm_vacation", code)

    async def async_alarm_arm_custom_bypass(self, code: str | None = None) -> None:
        await self._linked.command(self, "alarm_arm_custom_bypass", code)

    async def async_alarm_trigger(self, code: str | None = None) -> None:
        await self._linked.command(self, "alarm_trigger", code)


CLASSES: dict[str, type[LinkedEntity]] = {
    "switch": LinkedSwitch, "sensor": LinkedSensor, "binary_sensor": LinkedBinarySensor,
    "camera": LinkedCamera, "alarm_control_panel": LinkedAlarmPanel,
}
