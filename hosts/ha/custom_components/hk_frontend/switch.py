"""The integration's own switch: Seasonal decorations (the live sky's holiday
dress). Its state IS the setting `sky.decorations` in the entry's options, so
it survives restarts without a helper, reaches every screen over the settings
feed the moment it is flipped, and can be driven from a dashboard or an
automation like any switch. No input_boolean is needed (Configure ->
Seasonal sky still accepts one, as an extra gate)."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components.switch import SwitchEntity
from homeassistant.core import Event, callback
from homeassistant.helpers import config_validation as cv, entity_platform
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback

from . import settings as S
from .const import DOMAIN
from .entity import HkEntity


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    from . import handover, linked_mode
    # what Mantel Link holds is taken back before it is added here (handover.py)
    async_add_entities = handover.guarded(hass, entry, async_add_entities)
    if linked_mode.attach(hass, entry, "switch", async_add_entities):
        # LINKED TO MANTEL SERVER: Mantel's switches, the same action, forwarded
        _register_set_black_screen(hass, entry)
        return
    async_add_entities([SeasonalDecorations(entry)])
    # each screen's photo screensaver and black screen switches (screensaver.py)
    from . import screensaver
    await screensaver.async_setup_platform(hass, entry, "switch", async_add_entities)
    _register_set_black_screen(hass, entry)


BLACK_SCREEN_SCHEMA = {
    vol.Optional("black"): cv.boolean,
    vol.Optional("brightness"): vol.All(vol.Coerce(int), vol.Range(min=0, max=255)),
}


def _register_set_black_screen(hass: HomeAssistant, entry: ConfigEntry) -> None:
    # hk_frontend.set_black_screen: black on or off, and the brightness it
    # comes back to, in one call (the house's sleep and wake scripts)
    from . import handover
    if handover.bridge_away(entry):
        # Mantel Link holds the bridge (handover.py): a tablet's switch is this
        # integration's or Mantel Link's; the same action reaches either
        hass.services.async_register(DOMAIN, "set_black_screen", _black_screen_either(hass),
                                     cv.make_entity_service_schema(BLACK_SCREEN_SCHEMA))
        return
    entity_platform.async_get_current_platform().async_register_entity_service(
        "set_black_screen", BLACK_SCREEN_SCHEMA, "async_set_black_screen")


def _black_screen_either(hass: HomeAssistant):
    """hk_frontend.set_black_screen while Mantel Link holds the bridge: this
    integration's own switches as the entity action always did (available ones),
    Mantel Link's through mantel.set_black_screen."""
    import asyncio

    from homeassistant.exceptions import HomeAssistantError
    from homeassistant.helpers import entity_registry as er, service as ha_service

    from .handover import MANTEL_LINK

    async def handle(call) -> None:
        wanted = await ha_service.async_extract_entity_ids(call)
        own = {}
        for platform in entity_platform.async_get_platforms(hass, DOMAIN):
            if platform.domain == "switch":
                own.update({eid: e for eid, e in platform.entities.items()
                            if eid in wanted and hasattr(e, "async_set_black_screen")})
        reg = er.async_get(hass)
        theirs = sorted(eid for eid in wanted - set(own)
                        if (r := reg.async_get(eid)) is not None and r.platform == MANTEL_LINK)
        data = {k: call.data[k] for k in ("black", "brightness") if k in call.data}
        jobs = [e.async_set_black_screen(**data) for e in own.values() if e.available]
        if theirs:
            if not hass.services.has_service(MANTEL_LINK, "set_black_screen"):
                raise HomeAssistantError(f"hk_frontend.set_black_screen: {', '.join(theirs)} are Mantel Link's, and "
                                         "Mantel Link isn't running")
            jobs.append(hass.services.async_call(MANTEL_LINK, "set_black_screen", {"entity_id": theirs, **data},
                                                 blocking=True, context=call.context))
        await asyncio.gather(*jobs)
    return handle


class SeasonalDecorations(HkEntity, SwitchEntity):
    _attr_translation_key = "seasonal_decorations"

    def __init__(self, entry: ConfigEntry) -> None:
        super().__init__(entry, "seasonal_decorations")

    @property
    def is_on(self) -> bool:
        return bool(S.merged(self._entry.options)["sky"].get("decorations", True))

    async def async_turn_on(self, **kwargs: Any) -> None:
        self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        self._set(False)

    def _set(self, on: bool) -> None:
        opts = dict(self._entry.options)
        dash = dict(opts.get(S.CONF_DASHBOARD) or {})
        dash["sky"] = S.house_stored("sky", {**(dash.get("sky") if isinstance(dash.get("sky"), dict) else {}), "decorations": on})
        # The update listener re-sends the settings to every screen; the
        # entity writes its state when the options change (HkEntity).
        self.hass.config_entries.async_update_entry(
            self._entry, options={**opts, S.CONF_DASHBOARD: dash})


# ------------------------------------------------------------ the screensaver
from .screensaver import BLACK_KEY, SWITCH_KEY, SaverEntity  # noqa: E402
from .hk_core.screensaver.black import Black  # noqa: E402
from .hk_core.screensaver.rules import legacy_helper, legacy_mirror, legacy_says  # noqa: E402
from .house import HaHouse  # noqa: E402


class PhotoScreensaver(SaverEntity, SwitchEntity, RestoreEntity):
    """switch.<screen>_photo_screensaver -- on while the photos show (see
    screensaver.py). Its state is its own, restored across a restart; the old
    input_boolean.wallpanel_screensaver_<room>, while it exists, is mirrored
    both ways."""

    _attr_icon = "mdi:image-multiple"

    def __init__(self, mgr: Any, path: str, title: str, uid: str | None = None) -> None:
        SaverEntity.__init__(self, mgr, path, title, SWITCH_KEY, uid)
        self._on = False
        self._unlegacy = None
        self._legacy_id: str | None = None

    @property
    def is_on(self) -> bool:
        return self._on

    def _legacy(self) -> str | None:
        return legacy_helper(HaHouse(self.hass), self._mgr.board(self._path).get("idle_room"))

    async def async_added_to_hass(self) -> None:
        # the screens learn this switch's entity id (the settings feed) --
        # also after a rename, which re-adds the entity under its new id
        from homeassistant.helpers.dispatcher import async_dispatcher_send
        from .const import SIGNAL_CONFIG
        self.hass.loop.call_soon(async_dispatcher_send, self.hass, SIGNAL_CONFIG)
        last = await self.async_get_last_state()
        if last is not None:
            self._on = last.state == "on"
        legacy = self._legacy()
        if legacy:
            # the old helper is the truth the house's automations have been
            # keeping; start from it
            self._on = self.hass.states.get(legacy).state == "on"
        self._watch_legacy()

    @callback
    def _watch_legacy(self) -> None:
        legacy = self._legacy()
        if legacy == self._legacy_id:
            return
        if self._unlegacy:
            self._unlegacy()
            self._unlegacy = None
        self._legacy_id = legacy
        if legacy:
            self._unlegacy = async_track_state_change_event(self.hass, [legacy], self._legacy_changed)
            self.async_on_remove(lambda: self._unlegacy and self._unlegacy())

    @callback
    def _legacy_changed(self, event: Event) -> None:
        new = event.data.get("new_state")
        on = legacy_says(new.state if new is not None else None)
        if on is None:
            return
        if on != self._on:
            self._on = on
            self.async_write_ha_state()

    async def async_turn_on(self, **kwargs: Any) -> None:
        await self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        await self._set(False)

    async def _set(self, on: bool) -> None:
        self._on = on
        self.async_write_ha_state()
        call = legacy_mirror(HaHouse(self.hass), self._legacy(), on)
        if call:
            await self.hass.services.async_call(*call, blocking=False)

    def touched(self) -> None:
        self._watch_legacy()
        self.async_write_ha_state()


class BlackScreen(SaverEntity, SwitchEntity, RestoreEntity):
    """switch.<screen>_black_screen -- on while the screen is HK Frontend's own
    black (Black Screen: HK Frontend; screensaver.py). Its attributes:
    black_screen (the screen's setting: kiosk or hk -- the house's scripts
    branch on it), brightness (the backlight to come back to, 0-255),
    confirmed (the page said it is black, since this last turned on). What
    those mean is shared (hk_core/screensaver/black.py); this keeps one."""

    _attr_icon = "mdi:monitor-off"

    def __init__(self, mgr: Any, path: str, title: str, uid: str | None = None) -> None:
        SaverEntity.__init__(self, mgr, path, title, BLACK_KEY, uid)
        self._black = Black()

    @property
    def is_on(self) -> bool:
        return self._black.on

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {**super().extra_state_attributes, **self._black.attributes(self._mgr.board(self._path))}

    async def async_added_to_hass(self) -> None:
        from homeassistant.helpers.dispatcher import async_dispatcher_send
        from .const import SIGNAL_CONFIG
        self.hass.loop.call_soon(async_dispatcher_send, self.hass, SIGNAL_CONFIG)
        last = await self.async_get_last_state()
        if last is not None:
            # a page that reloads while black says so again (hk-saver.js)
            self._black.restore(last.state, last.attributes)

    async def async_turn_on(self, **kwargs: Any) -> None:
        self._set(True)

    async def async_turn_off(self, **kwargs: Any) -> None:
        self._set(False)

    async def async_set_black_screen(self, black: bool | None = None, brightness: int | None = None) -> None:
        if brightness is not None:
            self._black.brightness = int(brightness)
        if black is not None and black != self._black.on:
            self._set(black)
        else:
            self.async_write_ha_state()

    def _set(self, on: bool) -> None:
        self._black.set(on)
        self.async_write_ha_state()

    @callback
    def page_says(self, black: bool) -> None:
        """The page: black now (confirmed), or woken by a tap (off)."""
        if self._black.page_says(black):
            self.async_write_ha_state()
