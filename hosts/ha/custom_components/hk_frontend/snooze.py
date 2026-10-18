"""OFF UNTIL TOMORROW: an automation turned off, and back on at midnight.

The automation sheet (hk-detail.js kind `automation`) offers On, Off Until
Tomorrow and Off. "Until tomorrow" is the rest of today: the automation is
turned off now and on again at the next local midnight -- so tonight's
sunset lights are skipped and tomorrow morning's run as usual.

THE TIME TO TURN IT BACK ON IS KEPT (a Store), so a restart in between does
not leave it off for good: at start every kept one past its time is turned on
at once, the rest are timed again. Turning the automation on by hand (in the
sheet, Home Assistant, anywhere) ends the pause; turning it off by hand
keeps it off, and the pause is forgotten.

Services: hk_frontend.pause_automation {entity_id, until?} (until: an ISO
time; none = the next midnight) and hk_frontend.resume_automation
{entity_id}. The screens read what is paused from
hk_frontend/snooze/subscribe (open to every user: it says only which
automations are paused and until when).
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.const import ATTR_ENTITY_ID, EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send
from homeassistant.helpers.event import async_track_point_in_time
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

DATA = "hk_frontend_snooze"
SIGNAL = "hk_frontend_snooze_changed"
STORE_KEY = "hk_frontend.snooze"


def next_midnight(now: datetime | None = None) -> datetime:
    """The next local midnight after `now`."""
    now = dt_util.as_local(now or dt_util.now())
    return (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


class Snoozes:
    """The paused automations: entity id -> when it comes back on."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.store: Store = Store(hass, 1, STORE_KEY)
        self.until: dict[str, datetime] = {}
        self._timers: dict[str, Callable[[], None]] = {}
        self._ours: set[str] = set()       # states we are changing ourselves

    async def load(self) -> None:
        data = await self.store.async_load() or {}
        now = dt_util.utcnow()
        for eid, iso in (data.get("until") or {}).items():
            at = dt_util.parse_datetime(iso) if isinstance(iso, str) else None
            if at is None:
                continue
            if at <= now:
                await self._turn(eid, True)
            else:
                self.until[eid] = at
                self._time(eid, at)
        await self._save()

    async def _save(self) -> None:
        await self.store.async_save({"until": {k: v.isoformat() for k, v in self.until.items()}})
        async_dispatcher_send(self.hass, SIGNAL)

    async def _turn(self, eid: str, on: bool) -> None:
        if self.hass.states.get(eid) is None:
            return
        self._ours.add(eid)
        try:
            await self.hass.services.async_call("automation", "turn_on" if on else "turn_off",
                                                {ATTR_ENTITY_ID: eid}, blocking=True)
        finally:
            self._ours.discard(eid)

    def _time(self, eid: str, at: datetime) -> None:
        if eid in self._timers:
            self._timers.pop(eid)()

        async def due(_now: datetime) -> None:
            self._timers.pop(eid, None)
            if self.until.pop(eid, None) is not None:
                await self._turn(eid, True)
                await self._save()

        self._timers[eid] = async_track_point_in_time(self.hass, due, at)

    async def pause(self, eid: str, until: datetime | None) -> None:
        at = dt_util.as_utc(until) if until else dt_util.as_utc(next_midnight())
        if at <= dt_util.utcnow():
            raise ServiceValidationError("The time to turn it back on has already passed")
        await self._turn(eid, False)
        self.until[eid] = at
        self._time(eid, at)
        await self._save()

    async def resume(self, eid: str) -> None:
        if eid in self._timers:
            self._timers.pop(eid)()
        self.until.pop(eid, None)
        await self._turn(eid, True)
        await self._save()

    @callback
    def state_changed(self, event: Event) -> None:
        """Turned on or off by hand: the pause is over."""
        eid = event.data.get("entity_id")
        if eid not in self.until or eid in self._ours:
            return
        old, new = event.data.get("old_state"), event.data.get("new_state")
        if old is None or new is None or old.state == new.state:
            return
        if eid in self._timers:
            self._timers.pop(eid)()
        self.until.pop(eid, None)
        self.hass.async_create_task(self._save())

    def payload(self) -> dict[str, str]:
        return {k: v.isoformat() for k, v in self.until.items()}

    def stop(self) -> None:
        for undo in self._timers.values():
            undo()
        self._timers.clear()


def snoozes(hass: HomeAssistant) -> Snoozes:
    d = hass.data.setdefault(DATA, {})
    if "s" not in d:
        d["s"] = Snoozes(hass)
    return d["s"]


@websocket_api.websocket_command({vol.Required("type"): "hk_frontend/snooze/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """The paused automations, now and whenever they change."""
    s = snoozes(hass)

    @callback
    def send() -> None:
        connection.send_message(websocket_api.event_message(msg["id"], {"until": s.payload()}))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL, send)
    connection.send_result(msg["id"])
    send()


AUTOMATION = vol.All(cv.entity_id, cv.entity_domain("automation"))


async def async_setup(hass: HomeAssistant) -> None:
    """The services, the subscription, and the pauses kept from before."""
    s = snoozes(hass)
    websocket_api.async_register_command(hass, ws_subscribe)

    async def pause(call: ServiceCall) -> None:
        await s.pause(call.data[ATTR_ENTITY_ID], call.data.get("until"))

    async def resume(call: ServiceCall) -> None:
        await s.resume(call.data[ATTR_ENTITY_ID])

    hass.services.async_register(DOMAIN, "pause_automation", pause, schema=vol.Schema({
        vol.Required(ATTR_ENTITY_ID): AUTOMATION, vol.Optional("until"): cv.datetime}))
    hass.services.async_register(DOMAIN, "resume_automation", resume, schema=vol.Schema({
        vol.Required(ATTR_ENTITY_ID): AUTOMATION}))
    @callback
    def automations_only(data: Any) -> bool:
        return str(data.get("entity_id", "")).startswith("automation.")

    hass.bus.async_listen(EVENT_STATE_CHANGED, s.state_changed, event_filter=automations_only)

    async def started(_event: Event | None = None) -> None:
        await s.load()

    # the automations exist once Home Assistant has started
    if hass.is_running:
        await started()
    else:
        hass.bus.async_listen_once("homeassistant_started", started)
    @callback
    def stopping(_event: Event) -> None:
        s.stop()

    hass.bus.async_listen_once("homeassistant_stop", stopping)
