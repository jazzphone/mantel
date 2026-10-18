"""Music's items and the checks its forms share.

Settings -> Devices & services -> HK Frontend (items of the house's entry,
once Music is added):
  * ADD MUSIC PRESET      a Music Assistant sync group and its rooms;
  * ADD MUSIC PLAYLIST    a pill: a name, an icon, one or more library
                          playlists played as one queue, optionally sitting
                          behind a CHOOSER pill with others (one Decades pill
                          for six decade playlists).

The checks here are Music's gear's, these forms' and the HK Settings page's
(settings_ws.py): one set of rules, whichever way a house edits its music.
Room names and floors are not asked for: they come from each speaker's area
and that area's floor, so renaming an area renames its pill.
"""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntryState, ConfigSubentryFlow, SubentryFlowResult
from homeassistant.helpers import selector as sel

from .const import (
    CONF_CHOOSER, CONF_GROUP, CONF_ICON, CONF_ITEMS, CONF_MEMBERS, CONF_NAME, CONF_ORDER,
    CONF_SPEAKERS, CONF_VOLUME,
)


def ma_players(multiple: bool = False, include: list[str] | None = None,
               exclude: list[str] | None = None) -> sel.EntitySelector:
    cfg: dict[str, Any] = {"domain": "media_player", "integration": "music_assistant",
                           "multiple": multiple}
    if include is not None:
        cfg["include_entities"] = include
    if exclude:
        cfg["exclude_entities"] = exclude
    return sel.EntitySelector(sel.EntitySelectorConfig(**cfg))


def speakers_schema(groups: list[str]) -> vol.Schema:
    """Configure's first page: the speakers (never a preset's group) and the
    house volume in percent."""
    return vol.Schema({
        vol.Required(CONF_SPEAKERS): ma_players(multiple=True, exclude=groups),
        vol.Required(CONF_VOLUME): sel.NumberSelector(sel.NumberSelectorConfig(
            min=0, max=100, step=1, unit_of_measurement="%",
            mode=sel.NumberSelectorMode.SLIDER)),
    })


def speakers_errors(speakers: list[str], groups: list[str]) -> dict[str, str]:
    """Configure's check on the speakers (shared with the settings page)."""
    if not speakers:
        return {CONF_SPEAKERS: "no_speakers"}
    if set(speakers) & set(groups):
        return {CONF_SPEAKERS: "group_is_room"}
    return {}


def preset_errors(name: str, group: Any, members: list[str], rooms: list[str]) -> dict[str, str]:
    """A preset's check (the preset form's, and the settings page's)."""
    if not name:
        return {CONF_NAME: "no_name"}
    if not members:
        return {CONF_MEMBERS: "no_members"}
    if any(m not in rooms for m in members):
        return {CONF_MEMBERS: "not_a_speaker"}
    if group in rooms:
        return {CONF_GROUP: "group_is_room"}
    return {}


def playlist_errors(name: str, items: list[str], known: set[str] | None) -> dict[str, str]:
    """A playlist's check. `known`: the library's uris (None: not readable).
    A link the library does not have would not fail when pressed -- Music
    Assistant searches for the text and plays what it finds."""
    if not name:
        return {CONF_NAME: "no_name"}
    if not items:
        return {CONF_ITEMS: "no_items"}
    if known and any(i.startswith("library://") and i not in known for i in items):
        return {CONF_ITEMS: "not_in_library"}
    return {}


async def library(hass) -> list[dict[str, str]]:
    """The Music Assistant library's playlists [{uri, name}], by name."""
    loaded = [e for e in hass.config_entries.async_entries("music_assistant")
              if e.state is ConfigEntryState.LOADED]
    if not loaded:
        return []
    try:
        resp = await hass.services.async_call(
            "music_assistant", "get_library",
            {"config_entry_id": loaded[0].entry_id, "media_type": "playlist",
             "order_by": "name", "limit": 500},
            blocking=True, return_response=True)
    except Exception:  # noqa: BLE001 -- no list is still a usable form
        return []
    return [{"uri": i["uri"], "name": i.get("name") or i["uri"]}
            for i in (resp or {}).get("items", []) if i.get("uri")]


def name_of(hass, entity: str) -> str:
    st = hass.states.get(entity)
    return (st.attributes.get("friendly_name") if st else None) or entity


class _Sub(ConfigSubentryFlow):
    """Add and edit share one form; `reconfigure` pre-fills it. An item of
    the house's entry, read against the Music feature's speakers."""

    def _music(self):
        from .. import MUSIC, entries
        return next(iter(entries(self.hass, MUSIC)), None)

    async def async_step_user(self, user_input: dict[str, Any] | None = None
                              ) -> SubentryFlowResult:
        if self._music() is None:
            return self.async_abort(reason="music_not_added")
        return await self._form("user", user_input, None)

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None
                                     ) -> SubentryFlowResult:
        return await self._form("reconfigure", user_input, self._get_reconfigure_subentry())

    def _rooms(self) -> list[str]:
        music = self._music()
        return list(music.options.get(CONF_SPEAKERS) or []) if music else []

    def _finish(self, sub, title: str, data: dict[str, Any]) -> SubentryFlowResult:
        if sub is None:
            return self.async_create_entry(title=title, data=data)
        return self.async_update_and_abort(self._get_entry(), sub, title=title, data=data)

    async def _form(self, step, user_input, sub) -> SubentryFlowResult:  # pragma: no cover
        raise NotImplementedError


class PresetFlow(_Sub):
    """A Music Assistant sync group and the rooms it plays in.

    The rooms are ASKED FOR because Home Assistant cannot read them: a sync
    group player reports group_members None. To find them, play on the
    group and watch which speakers wake.
    """

    async def _form(self, step, user_input, sub):
        rooms = self._rooms()
        errors: dict[str, str] = {}
        if user_input is not None:
            name = (user_input.get(CONF_NAME) or "").strip()
            members = list(user_input.get(CONF_MEMBERS) or [])
            group = user_input.get(CONF_GROUP)
            errors = preset_errors(name, group, members, rooms)
            if not errors:
                return self._finish(sub, name, {CONF_NAME: name, CONF_GROUP: group,
                                                CONF_MEMBERS: members})
        schema = vol.Schema({
            vol.Required(CONF_NAME): sel.TextSelector(),
            vol.Required(CONF_GROUP): ma_players(exclude=rooms),
            vol.Required(CONF_MEMBERS): ma_players(multiple=True, include=rooms),
        })
        suggested = user_input or (dict(sub.data) if sub else {})
        return self.async_show_form(step_id=step, errors=errors,
                                    data_schema=self.add_suggested_values_to_schema(schema, suggested))


class PlaylistFlow(_Sub):
    """A playlist pill: one or more library playlists, played as one queue."""

    async def _library(self) -> list[sel.SelectOptionDict]:
        """The Music Assistant library's playlists, by name, for the picker."""
        return [sel.SelectOptionDict(value=i["uri"], label=i["name"]) for i in await library(self.hass)]

    async def _form(self, step, user_input, sub):
        errors: dict[str, str] = {}
        lib = await self._library()
        if user_input is not None:
            name = (user_input.get(CONF_NAME) or "").strip()
            items = [i for i in (user_input.get(CONF_ITEMS) or []) if i]
            errors = playlist_errors(name, items, {o["value"] for o in lib})
            if not errors:
                chooser = (user_input.get(CONF_CHOOSER) or "").strip()
                data = {CONF_NAME: name,
                        CONF_ICON: user_input.get(CONF_ICON) or "mdi:playlist-music",
                        CONF_ITEMS: items, CONF_ORDER: float(user_input.get(CONF_ORDER) or 0)}
                if chooser:
                    data[CONF_CHOOSER] = chooser
                return self._finish(sub, f"{chooser} · {name}" if chooser else name, data)
        known = {o["value"] for o in lib}
        current = (user_input or (dict(sub.data) if sub else {})).get(CONF_ITEMS) or []
        # A saved uri the library no longer lists is still shown, not dropped.
        lib += [sel.SelectOptionDict(value=u, label=u) for u in current if u not in known]
        schema = vol.Schema({
            vol.Required(CONF_NAME): sel.TextSelector(),
            vol.Optional(CONF_ICON): sel.IconSelector(),
            vol.Required(CONF_ITEMS): sel.SelectSelector(sel.SelectSelectorConfig(
                options=lib, multiple=True, custom_value=True,
                mode=sel.SelectSelectorMode.DROPDOWN)),
            vol.Optional(CONF_CHOOSER): sel.TextSelector(),
            vol.Optional(CONF_ORDER, default=0): sel.NumberSelector(sel.NumberSelectorConfig(
                min=0, max=1000, step=1, mode=sel.NumberSelectorMode.BOX)),
        })
        suggested = user_input or (dict(sub.data) if sub else {CONF_ORDER: 100})
        return self.async_show_form(step_id=step, errors=errors,
                                    data_schema=self.add_suggested_values_to_schema(schema, suggested))
