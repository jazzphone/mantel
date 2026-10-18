"""MUSIC: whole-home music through Music Assistant.

Speakers, presets and playlists (its gear and Add preset / Add playlist on
the integration's page, or the HK Settings page), the actions the Music page
and automations call (music.py's MusicManager), and a feed that hands
each screen its music configuration. One per house; it starts empty. Its
presets and playlists are items of the house's entry (ITEM_TYPES).

    hk_frontend.music_play        a playlist on a set of rooms
    hk_frontend.music_transfer    move what is playing, or add rooms to it
    hk_frontend.music_stop        stop and ungroup rooms, or the whole house
    hk_frontend.music_transport   play/pause, next, previous, stop, volume
    hk_frontend.music_play_media  one library item (the Music page's Browse)
    hk_music/subscribe            each screen's music configuration (websocket)
    hk_music/queue                a player's queue: what is playing and what comes next
    hk_music/queue_play           jump to one song in that queue
    hk_music/used                 a screen's Music page is in use (warm.py waits)

Every action ANSWERS: call it with return_response and read {ok, leader} or
{ok: false, message}. The actions and the feed are registered at start, not
when the feature is added, so a call made while it is not added gets a clear
error rather than "unknown action". The websocket commands keep their hk_music/
names: the screens and the settings page speak them.

The music engine's decisions are shared (hk_core/music/, PLAN.md §0 plan review);
this package is Home Assistant's side of it: the actions and their schemas, the
websocket commands, the config and options flows, the feature's lifecycle, and
every call to Music Assistant's integration.
"""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import SubentryFlowResult
from homeassistant.core import (
    HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse, callback,
)
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import area_registry as ar, floor_registry as fr
import homeassistant.helpers.config_validation as cv
from homeassistant.helpers import selector as sel
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send

from ...const import DOMAIN
from ...hk_core.music import queue
from ...hk_core.music.queue import QUEUE_MAX
from .. import MUSIC, TITLES, Feature, entries, item_data, loaded, unique_id
from . import settings_ws
from .const import (
    ATTR_COMMAND, ATTR_LEVEL, ATTR_PLAYER, ATTR_PLAYLIST, ATTR_ROOMS, ATTR_SOURCE, COMMANDS,
    CONF_GROUP, CONF_HOMES, CONF_MEMBERS, CONF_SPEAKERS, CONF_VOLUME, DEFAULT_VOLUME, SERVICE_PLAY,
    SERVICE_PLAY_MEDIA, SERVICE_STOP, SERVICE_TRANSFER, SERVICE_TRANSPORT, SIGNAL_CONFIG,
    SUB_PLAYLIST, SUB_PRESET, WARM_SOON,
)
from .flows import PlaylistFlow, PresetFlow, name_of, speakers_errors, speakers_schema
from .music import CALLER, MusicConfig, MusicManager
from .warm import PlaylistWarmer, mass_client as _mass
from .announcements import Announcements

PLATFORMS: list = []
RELOAD = False          # the engine reads the feature on every request
ITEM_TYPES = (SUB_PRESET, SUB_PLAYLIST)
# The fields that hold entity ids, which an entity rename follows (rename.py):
# the room players, each user's home room, and a preset's group and rooms.
RENAME = {"options": (CONF_SPEAKERS, CONF_HOMES)}
RENAME_ITEMS = {SUB_PRESET: (CONF_GROUP, CONF_MEMBERS)}

NO_HOME = "none"


def _music(hass: HomeAssistant) -> MusicManager | None:
    on = loaded(hass, MUSIC)
    return on[0].runtime_data if on else None


def _manager(hass: HomeAssistant) -> MusicManager:
    mgr = _music(hass)
    if mgr is None:
        raise ServiceValidationError(translation_domain=DOMAIN, translation_key="music_not_set_up")
    return mgr


def _answer(call: ServiceCall, res: dict[str, Any]) -> ServiceResponse:
    """EVERY ACTION ANSWERS {ok, ...}. A caller that asked for the answer (the
    dashboards all do) reads it; one that did not -- an automation -- would
    never learn of a refusal, so for it a failure RAISES, with the answer's
    own message. A request that stood down for a newer one is not a failure."""
    if call.return_response or res.get("ok") or res.get("superseded"):
        return res
    raise HomeAssistantError(res.get("message") or "The request failed.")


def _used(hass: HomeAssistant) -> None:
    """Someone is playing or browsing: keeping playlists ready waits."""
    mgr = _music(hass)
    if mgr is not None and getattr(mgr, "warmer", None) is not None:
        mgr.warmer.used()


def _as_caller(handler):
    """A music action served in its caller's context (music.CALLER), and only
    for as long as it is served."""
    async def run(call: ServiceCall) -> ServiceResponse:
        _used(call.hass)
        token = CALLER.set(call.context)
        try:
            return await handler(call)
        finally:
            CALLER.reset(token)
    return run


async def async_setup(hass: HomeAssistant) -> None:
    rooms = vol.All(cv.ensure_list, [cv.entity_id])

    @_as_caller
    async def play(call: ServiceCall) -> ServiceResponse:
        return _answer(call, await _manager(hass).play(
            call.data[ATTR_ROOMS], call.data[ATTR_PLAYLIST], call.context.user_id))

    @_as_caller
    async def transfer(call: ServiceCall) -> ServiceResponse:
        return _answer(call, await _manager(hass).transfer(
            call.data[ATTR_ROOMS], call.data[ATTR_SOURCE], call.context.user_id))

    @_as_caller
    async def stop(call: ServiceCall) -> ServiceResponse:
        return _answer(call, await _manager(hass).stop(
            call.data.get(ATTR_ROOMS), call.context.user_id))

    @_as_caller
    async def transport(call: ServiceCall) -> ServiceResponse:
        return _answer(call, await _manager(hass).transport(
            call.data[ATTR_PLAYER], call.data[ATTR_COMMAND], call.data.get(ATTR_LEVEL)))

    @_as_caller
    async def play_media(call: ServiceCall) -> ServiceResponse:
        return _answer(call, await _manager(hass).play_media(
            call.data[ATTR_PLAYER], call.data["media_content_id"],
            call.data["media_content_type"], call.context.user_id))

    opt = SupportsResponse.OPTIONAL
    hass.services.async_register(DOMAIN, SERVICE_PLAY, play, vol.Schema({
        vol.Required(ATTR_ROOMS): rooms, vol.Required(ATTR_PLAYLIST): cv.string}),
        supports_response=opt)
    hass.services.async_register(DOMAIN, SERVICE_TRANSFER, transfer, vol.Schema({
        vol.Required(ATTR_ROOMS): rooms, vol.Required(ATTR_SOURCE): cv.entity_id}),
        supports_response=opt)
    hass.services.async_register(DOMAIN, SERVICE_STOP, stop, vol.Schema({
        vol.Optional(ATTR_ROOMS): rooms}), supports_response=opt)
    hass.services.async_register(DOMAIN, SERVICE_TRANSPORT, transport, vol.Schema({
        vol.Required(ATTR_PLAYER): cv.entity_id, vol.Required(ATTR_COMMAND): vol.In(COMMANDS),
        vol.Optional(ATTR_LEVEL): vol.All(vol.Coerce(float), vol.Range(min=0, max=1))}),
        supports_response=opt)
    hass.services.async_register(DOMAIN, SERVICE_PLAY_MEDIA, play_media, vol.Schema({
        vol.Required(ATTR_PLAYER): cv.entity_id, vol.Required("media_content_id"): cv.string,
        vol.Required("media_content_type"): cv.string}), supports_response=opt)
    websocket_api.async_register_command(hass, ws_music_subscribe)
    websocket_api.async_register_command(hass, ws_music_queue)
    websocket_api.async_register_command(hass, ws_music_queue_play)
    websocket_api.async_register_command(hass, ws_music_used)
    # the HK Settings page (settings_ws.py)
    settings_ws.async_register(hass)


@websocket_api.websocket_command({vol.Required("type"): "hk_music/subscribe"})
@callback
def ws_music_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                       msg: dict[str, Any]) -> None:
    """Each screen's music configuration, now and whenever it changes.

    Per USER: the home room is the signed-in user's own, which is how a wall
    tablet knows which room it hangs in. Open to non-admin users, which every
    tablet is.
    """
    user_id = connection.user.id if connection.user else None

    @callback
    def send() -> None:
        mgr = _music(hass)
        payload = mgr.config.as_client(user_id) if mgr else {"configured": False}
        if mgr:
            payload["announcements"] = mgr.announcements.players()
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_CONFIG, send)
    connection.send_result(msg["id"])
    send()


async def async_setup_entry(hass: HomeAssistant, entry: Feature) -> bool:
    """The engine, and a nudge to every screen whenever the configuration or
    the areas and floors it draws its names from change. No restart is needed
    for any of it: the engine reads the feature on every request."""
    mgr = entry.runtime_data = MusicManager(hass, entry)
    mgr.announcements = Announcements(hass, lambda: mgr.config)
    mgr.announcements.start()
    entry.async_on_unload(mgr.announcements.stop)
    # Keep Playlists Ready (warm.py): runs only while its switch is on
    mgr.warmer = PlaylistWarmer(
        hass, entry, lambda: [u for p in mgr.config.playlists for u in p.items])
    mgr.warmer.follow()
    entry.async_on_unload(mgr.warmer.stop)

    @callback
    def changed(*_args: Any) -> None:
        async_dispatcher_send(hass, SIGNAL_CONFIG)

    # A renamed area renames its pill; a moved area moves floors.
    entry.async_on_unload(hass.bus.async_listen(ar.EVENT_AREA_REGISTRY_UPDATED, changed))
    entry.async_on_unload(hass.bus.async_listen(fr.EVENT_FLOOR_REGISTRY_UPDATED, changed))
    # Screens are told once it is running (see _music), not from here.
    entry.async_on_unload(entry.async_on_state_change(changed))
    return True


async def async_changed(hass: HomeAssistant, entry: Feature) -> None:
    """Its speakers, volume, rooms, presets or playlists changed -- or Keep
    Playlists Ready was turned on or off."""
    async_dispatcher_send(hass, SIGNAL_CONFIG)
    mgr = _music(hass)
    if mgr is not None and getattr(mgr, "warmer", None) is not None:
        mgr.warmer.follow(WARM_SOON)


async def async_unload_entry(hass: HomeAssistant, entry: Feature) -> bool:
    """The engine owns no tasks of its own (a request runs in its caller's
    action call). Screens are told music is gone."""
    async_dispatcher_send(hass, SIGNAL_CONFIG)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: Feature) -> None:
    """Removed: its presets and playlists go with it."""
    for sub in list(entry.subentries.values()):
        hass.config_entries.async_remove_subentry(entry.house, sub.subentry_id)


async def async_diagnostics(hass: HomeAssistant, entry: Feature) -> dict[str, Any]:
    """The speakers, presets and playlists as stored, and what a screen is
    handed."""
    warmer = getattr(getattr(entry, "runtime_data", None), "warmer", None)
    return {"kind": MUSIC, "options": dict(entry.options),
            "subentries": [s.as_dict() for s in entry.subentries.values()],
            "resolved": MusicConfig.from_entry(hass, entry).as_client(None),
            "keep_ready": warmer.status() if warmer else None}


class AddSteps:
    """Add feature -> Music. It asks nothing: the speakers are chosen in its
    gear, presets and playlists with Add preset and Add playlist."""

    async def async_step_music(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        if entries(self.hass, MUSIC):
            return self.async_abort(reason="already_configured")
        if user_input is None:
            return self.async_show_form(step_id="music", data_schema=vol.Schema({}))
        return self.async_create_entry(
            title=TITLES[MUSIC], unique_id=unique_id(MUSIC), data=item_data(MUSIC, options={
                CONF_SPEAKERS: [], CONF_VOLUME: DEFAULT_VOLUME, CONF_HOMES: {}}))


class ReconfigureSteps:
    """Its gear: the speakers and the house volume, then each user's room.
    Every option is written back, including any this flow does not show."""

    _music_opts: dict[str, Any] | None = None

    async def async_step_music_options(self, user_input: dict[str, Any] | None = None
                                       ) -> SubentryFlowResult:
        opts = self._feature.options
        groups = [str(s.data[CONF_GROUP]) for s in self._feature.subentries.values()
                  if s.subentry_type == SUB_PRESET and s.data.get(CONF_GROUP)]
        errors: dict[str, str] = {}
        if user_input is not None:
            speakers = list(user_input.get(CONF_SPEAKERS) or [])
            # the integration's options flows share one error table: Music's
            # codes carry its prefix there
            errors = {k: f"music_{v}" for k, v in speakers_errors(speakers, groups).items()}
            if not errors:
                self._music_opts = {CONF_SPEAKERS: speakers,
                                    CONF_VOLUME: round(float(user_input[CONF_VOLUME]) / 100, 2)}
                return await self.async_step_music_homes()
        suggested = user_input or {
            CONF_SPEAKERS: list(opts.get(CONF_SPEAKERS) or []),
            CONF_VOLUME: round(float(opts.get(CONF_VOLUME, DEFAULT_VOLUME)) * 100),
        }
        return self.async_show_form(
            step_id="music_options", errors=errors,
            data_schema=self.add_suggested_values_to_schema(speakers_schema(groups), suggested))

    async def async_step_music_homes(self, user_input: dict[str, Any] | None = None
                                     ) -> SubentryFlowResult:
        """One dropdown per person who signs in -- each wall tablet is its own
        user, so this is where a tablet learns which room it hangs in."""
        users = [u for u in await self.hass.auth.async_get_users()
                 if u.is_active and not u.system_generated]
        chosen = self._music_opts or {}
        rooms = chosen[CONF_SPEAKERS]
        current = dict(self._feature.options.get(CONF_HOMES) or {})
        # THE FIELD IS THE USER'S NAME, because a field's key is its label.
        # Two users with the same name (or none) get their id appended, so no
        # one's choice lands on someone else.
        names = [u.name or u.id for u in users]
        label = {u.id: (n if names.count(n) == 1 else f"{n} ({u.id[:6]})")
                 for u, n in zip(users, names, strict=True)}
        if user_input is not None:
            homes = {}
            for u in users:
                v = user_input.get(label[u.id])
                if v and v != NO_HOME and v in rooms:
                    homes[u.id] = v
            return self.async_save_feature(options={**self._feature.options, **chosen, CONF_HOMES: homes})
        choices = [sel.SelectOptionDict(value=NO_HOME, label="No home room")] + [
            sel.SelectOptionDict(value=r, label=name_of(self.hass, r)) for r in rooms]
        fields: dict[Any, Any] = {}
        for u in sorted(users, key=lambda x: label[x.id]):
            have = current.get(u.id)
            fields[vol.Optional(label[u.id], default=have if have in rooms else NO_HOME)] = \
                sel.SelectSelector(sel.SelectSelectorConfig(
                    options=choices, mode=sel.SelectSelectorMode.DROPDOWN))
        return self.async_show_form(step_id="music_homes", data_schema=vol.Schema(fields))


# ------------------------------------------------------------------ the queue
# THE MUSIC PAGE'S QUEUE (2026-10-11). Home Assistant's music_assistant.get_queue
# answers the current and the next song only, so the rest of the list comes
# from Music Assistant itself, through the client its Home Assistant
# integration already holds (entry.runtime_data.mass) -- its server commands
# player_queues/items and player_queues/play_index. Not a public Home
# Assistant contract: when it is not there (Music Assistant missing, or an
# upgrade moved it) the answer is {ok: false} and the page shows the next song
# alone. A song's shape is shared (hk_core/music/queue.py).


async def _queue_id(hass: HomeAssistant, entity_id: str) -> tuple[str | None, Any]:
    res = await hass.services.async_call("music_assistant", "get_queue", {"entity_id": entity_id},
                                         blocking=True, return_response=True)
    q = (res or {}).get(entity_id) or {}
    return q.get("queue_id"), q.get("current_index")


_item = queue.item


@websocket_api.websocket_command({vol.Required("type"): "hk_music/queue",
                                  vol.Required("entity_id"): cv.entity_id,
                                  vol.Optional("limit", default=40): vol.All(int, vol.Range(1, QUEUE_MAX))})
@websocket_api.async_response
async def ws_music_queue(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                         msg: dict[str, Any]) -> None:
    """{ok, index, items: [{id, title, artist, duration, image}]}: the songs from
    the current one on, `index` the current one's place in the whole queue."""
    mass = _mass(hass)
    if mass is None:
        connection.send_result(msg["id"], {"ok": False, "message": "Music Assistant is not set up."})
        return
    try:
        qid, cur = await _queue_id(hass, msg["entity_id"])
        if not qid:
            connection.send_result(msg["id"], {"ok": False, "message": "That speaker has no queue."})
            return
        cur = int(cur or 0)
        items = await mass.send_command("player_queues/items", queue_id=qid, limit=msg["limit"], offset=cur)
        connection.send_result(msg["id"], {"ok": True, "queue_id": qid, "index": cur,
                                           "items": [_item(i) for i in (items or [])]})
    except Exception as err:  # noqa: BLE001 -- an answer, never a dropped request
        connection.send_result(msg["id"], {"ok": False, "message": str(err) or "The queue could not be read."})


@websocket_api.websocket_command({vol.Required("type"): "hk_music/queue_play",
                                  vol.Required("entity_id"): cv.entity_id,
                                  vol.Required("item_id"): str})
@websocket_api.async_response
async def ws_music_queue_play(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                              msg: dict[str, Any]) -> None:
    """Play one song of the queue (by its queue_item_id: an index moves as the
    queue plays on)."""
    mass = _mass(hass)
    if mass is None:
        connection.send_result(msg["id"], {"ok": False, "message": "Music Assistant is not set up."})
        return
    try:
        qid, _cur = await _queue_id(hass, msg["entity_id"])
        if not qid:
            connection.send_result(msg["id"], {"ok": False, "message": "That speaker has no queue."})
            return
        await mass.send_command("player_queues/play_index", queue_id=qid, index=msg["item_id"])
        connection.send_result(msg["id"], {"ok": True})
    except Exception as err:  # noqa: BLE001
        connection.send_result(msg["id"], {"ok": False, "message": str(err) or "That song could not be played."})


@websocket_api.websocket_command({vol.Required("type"): "hk_music/used"})
@callback
def ws_music_used(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                  msg: dict[str, Any]) -> None:
    """A screen's Music page opened a level, searched or played: Keep
    Playlists Ready starts nothing new for a while (warm.py), so this person's
    request is not queued behind one of its own at Apple Music. Any signed-in
    user, as every tablet is; it answers at once and changes nothing else."""
    _used(hass)
    connection.send_result(msg["id"])
