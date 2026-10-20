"""The UI: adding the integration, and Configure.

EVERY SETTING IS ON THE HK SETTINGS PAGE (sidebar -> HK Settings; panel.py,
frontend/panels/hk-settings.js), and Configure is only the way there: a link
to it (and whether it is in the sidebar), Your files, and Setup check. A
dashboard item's gear points at that screen's page. The page writes through
settings_api.py into the same storage as these flows.

What stays a flow here is what the page drives as one: adding a dashboard
item (what it is shown on sets its starting values), and adding or editing a
pop-up, a custom page or a custom chip.

The features -- Music, Live TV, Clean Areas and Alarm PIN -- are items of the
house's entry too (features/): Add feature is their flow (FeatureFlow), and
each feature brings its steps as mixins. Music's presets and playlists are
items of the house's entry as well.

THERE IS ONE ENTRY (manifest: single_config_entry), because Home Assistant's
integration page answers an "Add ..." button with a list of every entry to
pick from once there is more than one.
"""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry, ConfigFlow, ConfigFlowResult, ConfigSubentryFlow, OptionsFlow,
    SubentryFlowResult,
)
from homeassistant.core import callback
from homeassistant.helpers import selector as sel

from . import features as F
from . import files
from . import lovelace_boards
from . import settings as S
from .const import CONF_FILES_FOLDER, CONF_MANTEL_LINK, CONF_MANTEL_OWNERS, DEFAULT_FILES_FOLDER, DOMAIN
from .features import alarm_pin, clean_areas, energy, live_tv, music, notifications
from .features.music.const import SUB_PLAYLIST, SUB_PRESET
from .features.music.flows import PlaylistFlow, PresetFlow


def _entity(domain: str | list[str], multiple: bool = False,
            device_class: str | None = None) -> sel.EntitySelector:
    flt: dict[str, Any] = {"domain": domain}
    if device_class:
        flt["device_class"] = device_class
    return sel.EntitySelector(sel.EntitySelectorConfig(filter=flt, multiple=multiple))


async def _dashboards(hass) -> list[str]:
    """Every dashboard's url path, for the Screens pickers."""
    try:
        return sorted(lovelace_boards.all_boards(hass))      # the Overview as "lovelace"
    except Exception:  # noqa: BLE001 -- a picker with custom values still works
        return []


async def _view_of(hass, key: str) -> dict[str, Any] | None:
    """One dashboard's view ("dashboard-kitchen/energy"), as Home Assistant
    serves it (includes resolved), or None."""
    dash, _, path = str(key).partition("/")
    try:
        board = lovelace_boards.get(hass, dash)
        cfg = await board.async_load(False) if board is not None else None
    except Exception:  # noqa: BLE001 -- a dashboard that cannot be read offers nothing
        return None
    views = cfg.get("views") if isinstance(cfg, dict) else None
    for v in views or []:
        if isinstance(v, dict) and v.get("path") == path:
            return v
    return None


async def _importable(hass, exclude: str = "") -> dict[str, str]:
    """Pages a custom page can start from: every titled view of every
    dashboard that is not generated itself, as "path/view" -> a label
    ("Energy · Energy-Tablet")."""
    try:
        boards = lovelace_boards.all_boards(hass)
    except (ImportError, KeyError, AttributeError):
        return {}
    out: dict[str, str] = {}
    for path, board in boards.items():
        if path == exclude:
            continue
        try:
            cfg = await board.async_load(False)
        except Exception:  # noqa: BLE001 -- an unreadable dashboard offers nothing
            continue
        if not isinstance(cfg, dict) or cfg.get("strategy"):
            continue
        title = lovelace_boards.title(hass, path)
        for v in cfg.get("views") or []:
            if isinstance(v, dict) and v.get("path") and v.get("title") and not v.get("area"):
                out[f"{path}/{v['path']}"] = f"{v['title']} · {title}"
    return dict(sorted(out.items(), key=lambda kv: kv[1].lower()))


async def _dashboard_title(hass, path: str) -> str:
    return lovelace_boards.title(hass, path)


async def _strategy_dashboards(hass) -> list[str]:
    """The dashboards built by the generated-dashboard strategy
    (`strategy: type: custom:hk-dashboard`) -- the only ones the Generated
    dashboard page steers. Hand-written dashboards never read it."""
    try:
        dashboards = lovelace_boards.all_boards(hass)
    except (ImportError, KeyError, AttributeError):
        return []
    out = []
    for path, dash in dashboards.items():
        try:
            cfg = await dash.async_load(False)
        except Exception:  # noqa: BLE001 -- an empty or broken dashboard is simply not one
            continue
        strategy = (cfg or {}).get("strategy") if isinstance(cfg, dict) else None
        if isinstance(strategy, dict) and strategy.get("type") == "custom:hk-dashboard":
            out.append(path)          # the Overview as "lovelace", its address
    return sorted(out)


class HkFrontendConfigFlow(ConfigFlow, domain=DOMAIN):
    """Adding the integration: the house's entry, the only one (the
    dashboards' settings; its items are the rest)."""

    VERSION = 1
    # 7: the house's entry holds the dashboard settings; each dashboard's own
    # settings, each pop-up, page, chip and feature are items of it
    # (subentries). An older minor version is brought to 7 by
    # async_migrate_entry.
    # 8 (2026-10-01): the room settings are All Screens' (settings `rooms`);
    # a screen keeps its own only where it differs (rooms_custom) --
    # settings.rooms_lifted.
    # 9 (2026-10-02): the menu settings too (settings `menu`, menu_custom) --
    # settings.menu_lifted.
    # 11 (2026-10-08): each screen's menu on a phone written down
    # (menu_phone, button_phone) -- settings.phones_lifted.
    # 12 (2026-10-09): Phones' settings each their own, the narrow choice
    # and the pre-1.9 menu lists gone -- settings.settings_tidied.
    # 13 (2026-10-12): the screens' camera lists are All Screens' --
    # settings.cameras_lifted.
    # 14 (2026-10-13): each wall tablet an item of its own (type "tablet"),
    # apart from the screen it runs -- settings.tablets_lifted.
    MINOR_VERSION = 16

    async def async_step_user(self, user_input: dict[str, Any] | None = None
                              ) -> ConfigFlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is None:
            return self.async_show_form(step_id="user", data_schema=vol.Schema({}))
        # EMPTY, on purpose. Everything is chosen on the HK Settings page afterwards;
        # nothing here assumes any particular house (settings.merged() fills
        # every default).
        return self.async_create_entry(title="HK Frontend", data={}, options={})

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return HkOptionsFlow()

    @classmethod
    @callback
    def async_get_supported_subentry_types(
            cls, config_entry: ConfigEntry) -> dict[str, type[ConfigSubentryFlow]]:
        """In this order on the integration's page: Add feature, then the
        dashboards' items, then Music's."""
        if F.kind_of(config_entry) != F.FRONTEND:
            return {}                    # a pre-release feature entry, folded at start
        return {F.SUBENTRY_FEATURE: FeatureFlow, S.SUBENTRY_DASHBOARD: DashboardSubentryFlow,
                S.SUBENTRY_POPUP: PopupSubentryFlow, S.SUBENTRY_PAGE: PageSubentryFlow,
                S.SUBENTRY_CHIP: ChipSubentryFlow, S.SUBENTRY_TABLET: TabletSubentryFlow,
                SUB_PRESET: PresetFlow, SUB_PLAYLIST: PlaylistFlow}


class FeatureFlow(music.AddSteps, music.ReconfigureSteps, live_tv.AddSteps, live_tv.ReconfigureSteps,
                  clean_areas.AddSteps, clean_areas.ReconfigureSteps, alarm_pin.AddSteps,
                  alarm_pin.ReconfigureSteps, energy.AddSteps, energy.ReconfigureSteps, notifications.AddSteps,
                  notifications.ReconfigureSteps, ConfigSubentryFlow):
    """ADD FEATURE: Music, Live TV, Clean Areas, Alarm PIN, Energy or Notifications, as an item of the
    house's entry (features/__init__.py). The first step is a menu of those
    the house does not have yet (Alarm PIN can protect several alarms, so it
    is always offered); each feature's own steps follow, their ids starting
    with its kind. Its gear is the feature's settings (its `<kind>_options`
    steps), saved with async_save_feature."""

    async def async_step_user(self, user_input: dict[str, Any] | None = None
                              ) -> SubentryFlowResult:
        have = {k for k in F.SINGLE if F.entries(self.hass, k)}
        return self.async_show_menu(step_id="user", menu_options=[k for k in F.KINDS if k not in have])

    @property
    def _feature(self) -> F.Feature:
        """The feature whose gear this is."""
        found = F.item(self.hass, self._get_reconfigure_subentry().subentry_id)
        assert found is not None
        return found

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None
                                     ) -> SubentryFlowResult:
        return await getattr(self, f"async_step_{self._feature.kind}_options")(user_input)

    @callback
    def async_save_feature(self, **changes: Any) -> SubentryFlowResult:
        """Write the feature (data, options, title, unique_id) and close.
        The house's update listener then restarts or tells it."""
        F.async_update(self.hass, self._feature, **changes)
        return self.async_abort(reason="reconfigure_successful")


class DashboardSubentryFlow(ConfigSubentryFlow):
    """ONE DASHBOARD, ITS OWN SETTINGS: an item under Dashboards on the
    integration's page, keyed by the dashboard's url path. Adding one asks
    which dashboard and what it is shown on -- that sets its starting values
    (settings.SCREEN_PRESETS). Everything after that is the dashboard's page on
    the HK Settings page, which is also what its gear opens."""

    def __init__(self) -> None:
        self._path: str = ""

    def _have(self) -> set[str]:
        return {s.unique_id for s in self._get_entry().subentries.values()
                if s.subentry_type == S.SUBENTRY_DASHBOARD and s.unique_id}

    async def async_step_user(self, user_input: dict[str, Any] | None = None
                              ) -> SubentryFlowResult:
        """Which dashboard. Those that already have an item are not offered."""
        have = self._have()
        if user_input is not None:
            path = str(user_input.get("dashboard") or "").strip()
            if path in have:
                return self.async_abort(reason="already_configured")
            if path:
                self._path = path
                return await self.async_step_kind()
        paths = [p for p in await _dashboards(self.hass) if p not in have]
        if not paths:
            return self.async_abort(reason="no_dashboards")
        options = [sel.SelectOptionDict(value=p, label=f"{await _dashboard_title(self.hass, p)} ({p})")
                   for p in paths]
        return self.async_show_form(step_id="user", data_schema=vol.Schema({
            vol.Required("dashboard"): sel.SelectSelector(sel.SelectSelectorConfig(
                options=options, custom_value=True, mode=sel.SelectSelectorMode.DROPDOWN))}))

    async def async_step_kind(self, user_input: dict[str, Any] | None = None
                              ) -> SubentryFlowResult:
        """What is this screen? A wall tablet, phones and iPads, a computer, a
        car, or something else -- its starting values, and the item is made.
        A generated dashboard starts with the menu as a button (its pages are
        reached from it); a hand-written one with it OFF unless the preset says
        otherwise: a dashboard with no item has no menu either, and an item is
        often added only for its Home or Appearance settings."""
        if user_input is not None:
            preset = S.SCREEN_PRESETS.get(user_input.get("kind")) or {}
            data = S.new_board(user_input.get("kind"), self._get_entry().options)
            if "menu" not in preset and self._path not in await _strategy_dashboards(self.hass):
                data["menu"] = "off"
            return self.async_create_entry(title=await _dashboard_title(self.hass, self._path),
                                           data=data, unique_id=self._path)
        return self.async_show_form(step_id="kind", data_schema=vol.Schema({
            vol.Required("kind", default="custom"): sel.SelectSelector(sel.SelectSelectorConfig(
                options=list(S.SCREEN_PRESETS), translation_key="screen_kind",
                mode=sel.SelectSelectorMode.LIST))}),
            description_placeholders={"dashboard": await _dashboard_title(self.hass, self._path),
                                      "path": self._path})

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None
                                     ) -> SubentryFlowResult:
        """Its gear: the way to this screen's page on the HK Settings page,
        where all of its settings are."""
        sub = self._get_reconfigure_subentry()
        path = sub.unique_id or ""
        return self.async_abort(reason="use_panel", description_placeholders={
            "dashboard": await _dashboard_title(self.hass, path),
            "url": f"/hk-settings#/screens/{path}"})


class TabletSubentryFlow(ConfigSubentryFlow):
    """A WALL TABLET (settings.SUBENTRY_TABLET): its own item, the tablet
    that runs a screen. Adding one and all of its settings are on the HK
    Settings page (Wall Tablets), so both lead there."""

    async def async_step_user(self, user_input: dict[str, Any] | None = None
                              ) -> SubentryFlowResult:
        return self.async_abort(reason="use_panel", description_placeholders={
            "tablet": "a new tablet", "url": "/hk-settings#/house/tablets/add"})

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None
                                     ) -> SubentryFlowResult:
        sub = self._get_reconfigure_subentry()
        return self.async_abort(reason="use_panel", description_placeholders={
            "tablet": sub.title or sub.unique_id or "", "url": f"/hk-settings#/house/tablets/{sub.unique_id}"})


class PageSubentryFlow(ConfigSubentryFlow):
    """A CUSTOM PAGE (settings.py SUBENTRY_PAGE): a page the house
    writes itself, shown by any generated dashboard that lists it on its Pages
    page. Add page asks its name, address and icon and what it starts from --
    a blank page, or a page of any dashboard (the import) -- then its cards in
    YAML; its gear edits the name, the icon and the YAML."""

    def __init__(self) -> None:
        self._base: dict[str, Any] = {}

    def _taken(self) -> set[str]:
        return S.taken_ids(self._get_entry())          # every item type (taken_ids)

    async def async_step_user(self, user_input: dict[str, Any] | None = None
                              ) -> SubentryFlowResult:
        errors: dict[str, str] = {}
        start = await _importable(self.hass)
        if user_input is not None:
            title = str(user_input.get("title") or "").strip()
            path = str(user_input.get("path") or "").strip().lower() or S.slug(title).replace("_", "-")
            if not title:
                errors["title"] = "name_needed"
            elif not S.page_path_ok(path):
                errors["path"] = "bad_page_path"
            elif path in self._taken():
                errors["path"] = "page_path_taken"
            else:
                view: dict[str, Any] = {"cards": []}
                if user_input.get("start") and user_input["start"] != "blank":
                    got = await _view_of(self.hass, user_input["start"])
                    if got is None:
                        errors["start"] = "page_not_found"
                    else:
                        view = S.page_view(got) or view
                if not errors:
                    self._base = {"title": title, "path": path, "icon": user_input.get("icon") or "",
                                  "view": view}
                    return await self.async_step_view()
        schema = vol.Schema({
            vol.Required("title"): str,
            vol.Optional("path"): str,
            vol.Optional("icon"): sel.IconSelector(),
            vol.Optional("start", default="blank"): sel.SelectSelector(sel.SelectSelectorConfig(
                options=[sel.SelectOptionDict(value="blank", label="A blank page")] +
                        [sel.SelectOptionDict(value=k, label=v) for k, v in start.items()],
                mode=sel.SelectSelectorMode.DROPDOWN)),
        })
        return self.async_show_form(step_id="user", data_schema=self.add_suggested_values_to_schema(
            schema, user_input or {}), errors=errors)

    async def async_step_view(self, user_input: dict[str, Any] | None = None
                              ) -> SubentryFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            view = S.page_view(user_input.get("view"))
            if view is None:
                errors["base"] = "page_view"
            else:
                return self.async_create_entry(
                    title=self._base["title"], unique_id=self._base["path"],
                    data={"title": self._base["title"], "icon": self._base["icon"], "view": view})
        schema = vol.Schema({vol.Optional("view"): sel.ObjectSelector()})
        return self.async_show_form(
            step_id="view", errors=errors,
            data_schema=self.add_suggested_values_to_schema(schema, {"view": self._base.get("view")}),
            description_placeholders={"title": self._base.get("title", ""), "path": self._base.get("path", "")})

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None
                                     ) -> SubentryFlowResult:
        """Its gear: the name, the icon and the page's YAML (the address
        stays -- the dashboards that list it know it by that)."""
        sub = self._get_reconfigure_subentry()
        cur = S.custom_page(sub.data, sub.unique_id or "")
        errors: dict[str, str] = {}
        if user_input is not None:
            view = S.page_view(user_input.get("view"))
            if view is None:
                errors["base"] = "page_view"
            else:
                title = str(user_input.get("title") or "").strip() or cur["title"]
                return self.async_update_and_abort(
                    self._get_entry(), sub, title=title,
                    data={"title": title, "icon": user_input.get("icon") or "", "view": view})
        schema = vol.Schema({
            vol.Required("title"): str,
            vol.Optional("icon"): sel.IconSelector(),
            vol.Optional("view"): sel.ObjectSelector(),
        })
        return self.async_show_form(
            step_id="reconfigure", errors=errors,
            data_schema=self.add_suggested_values_to_schema(
                schema, {k: cur[k] for k in ("title", "icon", "view") if cur[k]}),
            description_placeholders={"title": cur["title"], "path": cur["path"]})


def chip_key(name: str, taken: set[str]) -> str:
    """A custom chip's key from its name ("House Battery" -> house-battery),
    made unique."""
    base = (S.slug(name) or "chip")[:36]
    key, n = base, 2
    while key in taken:
        key, n = f"{base}-{n}", n + 1
    return key


def _after_selector() -> sel.SelectSelector:
    return sel.SelectSelector(sel.SelectSelectorConfig(
        options=[sel.SelectOptionDict(value="start", label="At the start")] +
                [sel.SelectOptionDict(value=k, label=k.replace("_", " ").capitalize()) for k in S.CHIP_KINDS] +
                [sel.SelectOptionDict(value="end", label="At the end")],
        mode=sel.SelectSelectorMode.DROPDOWN))


class ChipSubentryFlow(ConfigSubentryFlow):
    """A CUSTOM CHIP (settings.py SUBENTRY_CHIP): a status chip the house
    writes in YAML, shown by any screen that lists it. HK Settings -> Custom
    Chips is where they are made; this is the same, from Devices & Services."""

    def _taken(self) -> set[str]:
        return S.taken_ids(self._get_entry())          # every item type (taken_ids)

    async def _form(self, step: str, user_input: dict[str, Any] | None, cur: dict[str, Any] | None
                    ) -> SubentryFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            name = str(user_input.get("name") or "").strip()
            card = S.chip_card(user_input.get("card"))
            if not name:
                errors["name"] = "name_needed"
            elif card is None:
                errors["card"] = "chip_card"
            else:
                data = {"name": name, "after": user_input.get("after") or "end", "card": card}
                if cur is None:
                    return self.async_create_entry(title=name, unique_id=chip_key(name, self._taken()), data=data)
                return self.async_update_and_abort(self._get_entry(), self._get_reconfigure_subentry(),
                                                   title=name, data=data)
        schema = vol.Schema({vol.Required("name"): str, vol.Optional("after", default="end"): _after_selector(),
                             vol.Required("card"): sel.ObjectSelector()})
        return self.async_show_form(step_id=step, errors=errors, data_schema=self.add_suggested_values_to_schema(
            schema, user_input or ({k: cur[k] for k in ("name", "after", "card")} if cur else {})))

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        return await self._form("user", user_input, None)

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        sub = self._get_reconfigure_subentry()
        return await self._form("reconfigure", user_input, S.custom_chip(sub.data, sub.unique_id or ""))


class PopupSubentryFlow(ConfigSubentryFlow):
    """A POP-UP (settings.py SUBENTRY_POPUP): a hash any dashboard
    answers -- `#doorbell` -- and what it shows: a camera (with its speaker
    for talk-back), the alarm keypad, or a sheet of accessories. Add pop-up
    asks its name and kind, then its details; its gear edits the details."""

    def __init__(self) -> None:
        self._base: dict[str, Any] = {}

    def _taken(self, exclude: str | None = None) -> set[str]:
        return S.taken_ids(self._get_entry(), exclude)  # every item type (taken_ids)

    async def async_step_user(self, user_input: dict[str, Any] | None = None
                              ) -> SubentryFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            name = str(user_input.get("name") or "").strip()
            hash_ = str(user_input.get("hash") or "").strip().lstrip("#").lower() or S.slug(name)
            if not name:
                errors["name"] = "name_needed"
            elif not S.POPUP_HASH.match(hash_):
                errors["hash"] = "bad_hash"
            elif hash_ in self._taken():
                errors["hash"] = "hash_taken"
            else:
                self._base = {"name": name, "kind": user_input.get("kind") or "camera", "hash": hash_}
                return await self.async_step_details()
        schema = vol.Schema({
            vol.Required("name"): str,
            vol.Required("kind", default="camera"): sel.SelectSelector(sel.SelectSelectorConfig(
                options=list(S.POPUP_KINDS), translation_key="popup_kind", mode=sel.SelectSelectorMode.LIST)),
            vol.Optional("hash"): str,
        })
        return self.async_show_form(step_id="user", data_schema=self.add_suggested_values_to_schema(
            schema, user_input or {}), errors=errors)

    async def _details_schema(self, kind: str) -> vol.Schema:
        dash = sel.SelectSelector(sel.SelectSelectorConfig(
            options=await _dashboards(self.hass), multiple=True, custom_value=True,
            mode=sel.SelectSelectorMode.DROPDOWN))
        seconds = sel.NumberSelector(sel.NumberSelectorConfig(
            min=10, max=3600, step=5, unit_of_measurement="s", mode=sel.NumberSelectorMode.BOX))
        if kind == "camera":
            fields = {
                vol.Required("entity"): _entity("camera"),
                vol.Optional("speaker"): _entity("media_player"),
                vol.Optional("stream"): _entity("camera"),
            }
        elif kind == "alarm":
            fields = {vol.Optional("entity"): _entity("alarm_control_panel")}
        elif kind == "cards":
            fields = {
                vol.Optional("cards"): sel.ObjectSelector(),
                vol.Optional("icon"): sel.IconSelector(),
                vol.Optional("width", default="narrow"): sel.SelectSelector(sel.SelectSelectorConfig(
                    options=list(S.POPUP_WIDTHS), translation_key="popup_width", mode=sel.SelectSelectorMode.LIST)),
            }
        else:
            fields = {vol.Required("entities"): sel.EntitySelector(sel.EntitySelectorConfig(
                multiple=True, reorder=True))}
        fields[vol.Optional("close_after", default=60)] = seconds
        fields[vol.Optional("dashboards")] = dash
        return vol.Schema(fields)

    @staticmethod
    def _values(kind: str, user_input: dict[str, Any]) -> dict[str, Any]:
        keep = {"camera": ("entity", "speaker", "stream"), "alarm": ("entity",),
                "accessories": ("entities",), "cards": ("cards", "icon", "width")}[kind]
        out = {k: user_input.get(k) for k in keep}
        out["close_after"] = user_input.get("close_after", 60)
        out["dashboards"] = list(user_input.get("dashboards") or [])
        return out

    async def async_step_details(self, user_input: dict[str, Any] | None = None
                                 ) -> SubentryFlowResult:
        kind = self._base.get("kind", "camera")
        errors: dict[str, str] = {}
        if user_input is not None and kind == "cards" and S.popup_cards(user_input.get("cards")) is None:
            errors["cards"] = "popup_cards"
        elif user_input is not None:
            data = S.popup({**self._base, **self._values(kind, user_input)}, self._base["hash"])
            data.pop("hash")
            return self.async_create_entry(title=self._base["name"], data=data, unique_id=self._base["hash"])
        return self.async_show_form(
            step_id="details", data_schema=await self._details_schema(kind), errors=errors,
            description_placeholders={"name": self._base.get("name", ""), "hash": self._base.get("hash", "")})

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None
                                     ) -> SubentryFlowResult:
        """Its gear: the name and the details (the kind and hash stay -- a
        different kind is a different pop-up)."""
        sub = self._get_reconfigure_subentry()
        cur = S.popup(sub.data, sub.unique_id or "")
        errors: dict[str, str] = {}
        if user_input is not None and cur["kind"] == "cards" and S.popup_cards(user_input.get("cards")) is None:
            errors["cards"] = "popup_cards"
        elif user_input is not None:
            name = str(user_input.get("name") or "").strip() or cur["name"]
            data = S.popup({**cur, "name": name, **self._values(cur["kind"], user_input)}, cur["hash"])
            data.pop("hash")
            return self.async_update_and_abort(self._get_entry(), sub, title=name, data=data)
        schema = vol.Schema({vol.Required("name"): str, **(await self._details_schema(cur["kind"])).schema})
        return self.async_show_form(
            step_id="reconfigure", data_schema=self.add_suggested_values_to_schema(
                schema, {k: v for k, v in cur.items() if v not in (None, "", [])}), errors=errors,
            description_placeholders={"name": cur["name"], "hash": cur["hash"], "kind": cur["kind"]})


class HkOptionsFlow(OptionsFlow):
    """Configure, the way to the HK Settings page: a menu of the page's link
    and sidebar switch, Your files, Linked to Mantel Server and Setup check.
    Each page saves only its own key and comes back to the menu; Done closes."""

    PAGES = {"panel": "HK Settings page", "files": "Your files"}

    def __init__(self) -> None:
        self._saved: str | None = None

    def _save(self, changes: dict[str, Any]) -> ConfigFlowResult:
        """Save NOW and go back to the menu. The update listener fires on this
        write like any other."""
        page = (self.cur_step or {}).get("step_id")
        self.hass.config_entries.async_update_entry(
            self.config_entry, options={**self.config_entry.options, **changes})
        self._saved = self.PAGES.get(str(page), "Settings")
        return self._menu()

    def _menu(self) -> ConfigFlowResult:
        from .panel import URL_PATH
        saved = f"Saved: {self._saved}." if self._saved else ""
        return self.async_show_menu(
            step_id="init", menu_options=["panel", "files", "linked", "check", "done"],
            description_placeholders={"saved": saved, "url": f"/{URL_PATH}"})

    async def async_step_init(self, user_input: dict[str, Any] | None = None
                              ) -> ConfigFlowResult:
        return self._menu()

    async def async_step_done(self, user_input: dict[str, Any] | None = None
                              ) -> ConfigFlowResult:
        """Close. Everything is already saved, so this writes nothing new."""
        return self.async_create_entry(data=dict(self.config_entry.options))

    async def async_step_panel(self, user_input: dict[str, Any] | None = None
                               ) -> ConfigFlowResult:
        """The HK Settings page (panel.py): a link to it, and whether it is
        in the sidebar -- first on the integration's gear, so the page is
        found even when it is not."""
        from .panel import URL_PATH, sidebar_shown
        if user_input is not None:
            return self._save({"sidebar": bool(user_input.get("sidebar", True))})
        return self.async_show_form(step_id="panel", data_schema=vol.Schema({
            vol.Optional("sidebar", default=sidebar_shown(self.config_entry.options)): bool,
        }), description_placeholders={"url": f"/{URL_PATH}"})

    async def async_step_check(self, user_input: dict[str, Any] | None = None
                               ) -> ConfigFlowResult:
        """Setup check (setup_check.py): what is ready and what to fix. It
        saves nothing; submitting it goes back to the menu."""
        if user_input is not None:
            return self._menu()
        from . import setup_check
        lines = await setup_check.async_run(self.hass, dict(self.config_entry.options),
                                            S.boards(self.config_entry))
        return self.async_show_form(step_id="check", data_schema=vol.Schema({}),
                                    description_placeholders={"report": setup_check.report(lines)})

    async def async_step_linked(self, user_input: dict[str, Any] | None = None
                                ) -> ConfigFlowResult:
        """Linked to Mantel Server (linked_mode.py): off unless switched on
        here. On, it needs Mantel Server's address and a Service credential
        (Mantel's `mantel-server service-account create --scope linked`).
        The credential is kept in the entry's data -- on disk in Home
        Assistant's .storage, like any integration's token -- and never shown
        again: left empty, the one already saved is kept. Any change reloads
        the entry, into or out of linked mode."""
        from . import linked_mode
        entry = self.config_entry
        now = linked_mode.link_of(entry)
        errors: dict[str, str] = {}
        if user_input is not None:
            data = dict(entry.data)
            if not user_input.get("enabled"):
                data.pop(CONF_MANTEL_LINK, None)
                # unlinked: everything Home Assistant's again; linking again
                # starts from that until Mantel says otherwise
                data.pop(CONF_MANTEL_OWNERS, None)
            else:
                url = str(user_input.get("url") or "").strip()
                token = str(user_input.get("token") or "").strip() or (now or {}).get("token", "")
                if bad := await linked_mode.check_url(url):
                    errors["url"] = bad
                if not token:
                    errors["token"] = "mantel_token_required"
                if not errors:
                    data[CONF_MANTEL_LINK] = {"url": url, "token": token}
            if not errors:
                if data != dict(entry.data):
                    # the entry's update listener reloads it, into or out of
                    # linked mode (__init__.updated, linked_mode.async_setup_entry)
                    self.hass.config_entries.async_update_entry(entry, data=data)
                self._saved = "Linked to Mantel"
                return self._menu()
        return self.async_show_form(step_id="linked", errors=errors, data_schema=vol.Schema({
            vol.Optional("enabled", default=now is not None): bool,
            vol.Optional("url", default=(now or {}).get("url") or await linked_mode.suggested_url(self.hass)): str,
            vol.Optional("token", default=""): sel.TextSelector(
                sel.TextSelectorConfig(type=sel.TextSelectorType.PASSWORD)),
        }), description_placeholders={"state": linked_mode.describe(entry)})

    async def async_step_files(self, user_input: dict[str, Any] | None = None
                               ) -> ConfigFlowResult:
        """Where the files that cannot ship with the integration live: SF Pro
        and the SF Symbols glyph data. See files.py."""
        errors: dict[str, str] = {}
        current = self.config_entry.options.get(CONF_FILES_FOLDER) or DEFAULT_FILES_FOLDER
        if user_input is not None:
            folder = files.normalize(self.hass.config.config_dir,
                                     user_input.get(CONF_FILES_FOLDER))
            err = await self.hass.async_add_executor_job(
                files.validate_folder, self.hass.config.config_dir, folder)
            if err:
                errors[CONF_FILES_FOLDER] = err
            else:
                return self._save({CONF_FILES_FOLDER: folder})
        st = await self.hass.async_add_executor_job(files.status, self.hass)
        return self.async_show_form(
            step_id="files", errors=errors,
            data_schema=vol.Schema({vol.Required(CONF_FILES_FOLDER, default=current): str}),
            description_placeholders={
                "font": str(st["font"] or "missing"),
                "glyphs": str(st["glyphs"] or "missing")})
