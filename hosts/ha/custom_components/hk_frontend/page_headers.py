"""PAGE HEADERS, the server's part: Tonight's lighting schedule.

The Lights & Outlets page's header has a Tonight list -- what the house's
lighting automations will do next ("6:40 PM  Front Yard lights on · sunset").
It is worked out inside Home Assistant (hk_core/link/page_headers.py, shared
with Mantel Link: what it reads, what each entry says, how its conditions are
judged) and sent to the screens on their own subscription
(hk_frontend/page_headers/subscribe), open to every user -- a wall tablet signs
in as an ordinary user, and a browser should not fetch every automation of the
house.

THIS FILE keeps the delivery: one Schedule for the house, worked out on demand,
kept, worked out again when an automation is edited or reloaded, turned on or
off, or the registries change, and its conditions checked again when an entity
they read changes (debounced), so a row brightens when someone gets home. The
subscribers are told only when the list changes.
"""
from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.const import EVENT_HOMEASSISTANT_STOP, EVENT_STATE_CHANGED
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.debounce import Debouncer
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send
from homeassistant.helpers.event import async_track_state_change_event

from .hk_core.link import page_headers as shared
from .hk_core.link.page_headers import (HHMM_RE, SERVICE_RE, Resolver, branch_for, checker,  # noqa: F401 -- re-exported
                                        effects, label_of, offset_s, trigger_times)
from .hk_core.link.page_headers import automations_on as _automations

_LOGGER = logging.getLogger(__name__)

DATA = "hk_frontend_page_headers"
SIGNAL = "hk_frontend_page_headers_changed"
DEBOUNCE_S = 2.0


def plan(hass: HomeAssistant) -> list[dict[str, Any]]:
    """The schedule's entries, conditions not yet checked (hk_core's `plan`)."""
    return shared.plan(hass, _automations(hass), "hk_frontend: page headers skipped %s")


class Schedule:
    """The house's one schedule: worked out on demand, kept, and worked out
    again on what can change it; the subscribers are told when it does."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.entries: list[dict[str, Any]] | None = None
        self.checks: list[Callable[[], bool | None] | None] = []
        self.sent: list[dict[str, Any]] | None = None
        self._unsub_states: Callable[[], None] | None = None
        self._debouncer = Debouncer(hass, _LOGGER, cooldown=DEBOUNCE_S, immediate=False, function=self._rebuild)
        self._recheck = Debouncer(hass, _LOGGER, cooldown=DEBOUNCE_S, immediate=False, function=self._recheck_now)

    async def _rebuild(self) -> None:
        self.entries = None
        await self.ensure()
        self._tell()

    async def ensure(self) -> list[dict[str, Any]]:
        if self.entries is not None:
            return self.payload()
        entries = plan(self.hass)
        checks, reads = [], set()
        for e in entries:
            run, r = await checker(self.hass, e.pop("_conditions"))
            checks.append(run)
            reads |= r
        self.entries, self.checks = entries, checks
        if self._unsub_states:
            self._unsub_states()
            self._unsub_states = None
        if reads:
            self._unsub_states = async_track_state_change_event(self.hass, sorted(reads), self._state_changed)
        return self.payload()

    @callback
    def _state_changed(self, _event: Event) -> None:
        self.hass.async_create_task(self._recheck.async_call())

    async def _recheck_now(self) -> None:
        self._tell()

    def payload(self) -> list[dict[str, Any]]:
        out = []
        for e, run in zip(self.entries or [], self.checks):
            out.append({**e, "ready": run() if run else True})
        return out

    @callback
    def _tell(self) -> None:
        now = self.payload()
        if now != self.sent:
            self.sent = now
            async_dispatcher_send(self.hass, SIGNAL)

    @callback
    def invalidate(self) -> None:
        # nothing worked out yet (no screen has asked): nothing to redo
        if self.entries is None:
            return
        self.hass.async_create_task(self._debouncer.async_call())

    def stop(self) -> None:
        if self._unsub_states:
            self._unsub_states()
            self._unsub_states = None
        self._debouncer.async_shutdown()
        self._recheck.async_shutdown()


def schedule(hass: HomeAssistant) -> Schedule:
    d = hass.data.setdefault(DATA, {})
    if "schedule" not in d:
        d["schedule"] = Schedule(hass)
    return d["schedule"]


@websocket_api.websocket_command({vol.Required("type"): "hk_frontend/page_headers/subscribe"})
@websocket_api.async_response
async def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                       msg: dict[str, Any]) -> None:
    """The page headers' server-side data, now and whenever it changes. Open
    to every user (a wall tablet's own): it says which lights an automation
    switches and when, never the automation's configuration."""
    sched = schedule(hass)

    async def send() -> None:
        try:
            entries = await sched.ensure()
        except Exception:  # noqa: BLE001 -- an empty schedule, never a broken socket
            _LOGGER.exception("hk_frontend: the lighting schedule could not be worked out")
            entries = []
        connection.send_message(websocket_api.event_message(msg["id"], {"lights": {"schedule": entries}}))

    @callback
    def changed() -> None:
        hass.async_create_task(send())

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL, changed)
    connection.send_result(msg["id"])
    await send()


@callback
def async_setup(hass: HomeAssistant) -> Callable[[], None]:
    """The subscription, and what makes the schedule worked out again:
    automations reloaded or edited, the registries. Returns the undo."""
    websocket_api.async_register_command(hass, ws_subscribe)
    sched = schedule(hass)

    @callback
    def again(_event: Event) -> None:
        sched.invalidate()

    @callback
    def automation_switched(data: Any) -> bool:
        # an automation turned on or off (not its last_triggered moving)
        eid = data.get("entity_id") or ""
        old, new = data.get("old_state"), data.get("new_state")
        return eid.startswith("automation.") and (old is None or new is None or old.state != new.state)

    unsubs = [
        hass.bus.async_listen("automation_reloaded", again),
        hass.bus.async_listen(er.EVENT_ENTITY_REGISTRY_UPDATED, again),
        hass.bus.async_listen(dr.EVENT_DEVICE_REGISTRY_UPDATED, again),
        hass.bus.async_listen(ar.EVENT_AREA_REGISTRY_UPDATED, again),
        hass.bus.async_listen(EVENT_STATE_CHANGED, again, event_filter=automation_switched),
    ]

    @callback
    def undo(_event: Event | None = None) -> None:
        for u in unsubs:
            u()
        unsubs.clear()
        sched.stop()
        hass.data.pop(DATA, None)

    # the debouncers' timers go with Home Assistant
    hass.bus.async_listen_once(EVENT_HOMEASSISTANT_STOP, undo)
    return undo
