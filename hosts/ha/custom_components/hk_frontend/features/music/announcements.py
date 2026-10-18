"""Recognize HA announcements before player state arrives, for display only.

Native HomePods don't label TTS in their state. Observe the service call,
then suppress its player until playback ends. Music Assistant's AirPlay
entity is matched by its MAC-derived unique id, never room or friendly name.
Nothing here changes audio, player state, or an automation.

Which calls are announcements, what a player is playing and which players an
announcement hides are shared (hk_core/music/announcements.py). Watching HA's
call_service and state_changed events, the markers' timers and the screens'
nudge are Home Assistant's, and so are `aliases`: a player's physical twins come
from HA's device registry (MAC connections, unique ids), which the House port
does not carry.
"""
from __future__ import annotations

import re
from typing import Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send

from ...hk_core.music import announcements as A
from .const import SIGNAL_CONFIG

START_TIMEOUT = 20
MAX_SECONDS = 120
END_GRACE = 2


_ids = A.ids
_content = A.content


class Announcements:
    """Transient markers, shared by all screens and cleared on unload/restart."""

    def __init__(self, hass: HomeAssistant, config: Callable) -> None:
        self.hass, self.config = hass, config
        self.pending: dict[str, dict] = {}
        self.unsub: list[Callable] = []

    @callback
    def start(self) -> None:
        self.unsub = [self.hass.bus.async_listen("call_service", self.service),
                      self.hass.bus.async_listen("state_changed", self.state)]

    @callback
    def stop(self) -> None:
        for unsub in self.unsub:
            unsub()
        self.unsub.clear()
        for row in self.pending.values():
            for cancel in row["timers"]:
                cancel.cancel()
        self.pending.clear()

    def players(self) -> list[str]:
        return sorted({p for row in self.pending.values() for p in row["players"]})

    def aliases(self, source: str) -> set[str]:
        """Known player plus its native/MA counterpart, from physical identity."""
        result = {source}
        ents, devs = er.async_get(self.hass), dr.async_get(self.hass)
        src = ents.async_get(source)
        if not src:
            return result
        device = devs.async_get(src.device_id) if src.device_id else None
        macs = {v.replace(":", "").lower() for k, v in (device.connections if device else ()) if k == "mac"}
        if src.platform == "apple_tv" and re.fullmatch(r"(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}", src.unique_id):
            macs.add(src.unique_id.replace(":", "").lower())
        for eid in self.config().players():
            ent = ents.async_get(eid)
            if not ent:
                continue
            if src.device_id and ent.device_id == src.device_id:
                result.add(eid)
            elif ent.platform == "music_assistant" and ent.unique_id.lower() in {"ap" + m for m in macs}:
                result.add(eid)
        return result

    @callback
    def service(self, event) -> None:
        data = event.data
        domain, service = data.get("domain"), data.get("service", "")
        args = data.get("service_data") or {}
        # An explicit ordinary play supersedes a pending announcement marker.
        for source in A.released(domain, service, args):
            targets = self.aliases(source)
            for key, row in list(self.pending.items()):
                if row["players"] & targets:
                    self.clear(key)
        sources = A.announced(domain, service, args)
        if not sources or not self.config().ignore_announcements:
            return
        for source in sources:
            if not source.startswith("media_player."):
                continue
            players = A.hidden(self.config(), source, self.aliases(source))
            if players is None:
                continue
            self.clear(source, notify=False)
            row = {"players": players, "started": False, "timers": [],
                   "before": _content(self.hass.states.get(source)), "departed": False}
            self.pending[source] = row
            row["timers"].append(self.hass.loop.call_later(MAX_SECONDS, self.clear, source))
            row["timers"].append(self.hass.loop.call_later(START_TIMEOUT, self.no_start, source, row))
        async_dispatcher_send(self.hass, SIGNAL_CONFIG)

    @callback
    def no_start(self, source: str, row: dict) -> None:
        if self.pending.get(source) is row and not row["started"]:
            self.clear(source)

    @callback
    def state(self, event) -> None:
        eid, new = event.data.get("entity_id"), event.data.get("new_state")
        for source, row in list(self.pending.items()):
            # Use the called player as the completion authority. Its MA mirror
            # can lag, hence the small grace before allowing displays again.
            if eid != source:
                continue
            if new is not None and new.state in ("playing", "paused", "buffering"):
                content = _content(new)
                if row["departed"] and row["before"] and content == row["before"]:
                    self.clear(source)
                    continue
                if content != row["before"]:
                    row["departed"] = True
                row["started"] = True
                end = row.pop("end", None)
                if end:
                    end.cancel()
            elif row["started"]:
                end = row.pop("end", None)
                if end:
                    end.cancel()
                row["end"] = self.hass.loop.call_later(END_GRACE, self.clear, source)
                row["timers"].append(row["end"])

    @callback
    def clear(self, source: str, notify: bool = True) -> None:
        row = self.pending.pop(source, None)
        if row:
            for timer in row["timers"]:
                timer.cancel()
            if notify:
                async_dispatcher_send(self.hass, SIGNAL_CONFIG)
