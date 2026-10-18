"""Recognize HA announcements before player state arrives, for display only.

Native HomePods don't label TTS in their state. Observe the service call,
then suppress its player until playback ends. Music Assistant's AirPlay
entity is matched by its MAC-derived unique id, never room or friendly name.
Nothing here changes audio, player state, or an automation.
"""
from __future__ import annotations

import re
from typing import Callable

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import SIGNAL_CONFIG

START_TIMEOUT = 20
MAX_SECONDS = 120
END_GRACE = 2


def _ids(value) -> list[str]:
    if isinstance(value, str):
        return [v.strip() for v in value.split(",") if v.strip()]
    return [v for v in value if isinstance(v, str)] if isinstance(value, (list, tuple)) else []


def _content(state):
    if state is None or state.state not in ("playing", "paused", "buffering"):
        return None
    a = state.attributes
    value = (a.get("media_content_id"), a.get("media_title"), a.get("media_artist"))
    return value if any(value) else None


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
        sources = []
        # An explicit ordinary play supersedes a pending announcement marker.
        if domain == "media_player" and service in ("play_media", "media_play") and args.get("announce") is not True:
            for source in _ids(args.get("entity_id")):
                targets = self.aliases(source)
                for key, row in list(self.pending.items()):
                    if row["players"] & targets:
                        self.clear(key)
        if domain == "tts":
            if service == "speak":
                sources = _ids(args.get("media_player_entity_id"))
            elif service.endswith("_say"):
                sources = _ids(args.get("entity_id"))
        elif ((domain == "media_player" and service == "play_media" and args.get("announce") is True)
              or (domain == "music_assistant" and service == "play_announcement")):
            sources = _ids(args.get("entity_id"))
        if not sources or not self.config().ignore_announcements:
            return
        for source in sources:
            if not source.startswith("media_player."):
                continue
            players = self.aliases(source)
            preset = self.config().preset_for_group(source)
            if preset:
                players.update(preset.members)
            if not players.intersection(self.config().players()):
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
