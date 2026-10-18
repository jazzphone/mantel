"""Configure -> Setup check: is this Home Assistant ready for the HK pages?

One line for each thing a new house is likely to get wrong, each saying what
is fine or what to do about it: the Home Assistant version, the theme, the
card files as Lovelace resources, your font and glyphs, the areas every
generated page and room page is built from, the menu's dashboards, and which
companion integrations are present. Read-only; it changes nothing.

Two of them also raise a Repairs issue, because they break every screen
rather than one feature: a Home Assistant older than these pages are built
against (`ha_too_old`) and the HK Kiosk theme not loaded
(`theme_missing`). The integration loads the theme itself (themes.py), so that
one means it could not, and it gives the configuration.yaml lines that load
it instead. The theme is re-checked whenever themes are reloaded, so the
issue clears itself once it is fixed.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from homeassistant.const import __version__ as HA_VERSION
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import issue_registry as ir

from . import files, lovelace_boards, resources
from . import settings as dash_settings
from .const import DOMAIN

# The oldest release these pages have been built and tested against. Older
# frontends name their font variables differently (the theme) and draw the
# sidebar drawer differently (the menu's Home Assistant section: Show Menu).
MIN_HA = (2026, 8)
THEME = "HK Kiosk"
ISSUES = ("ha_too_old", "theme_missing")
# THE FEATURES (features/), each an item of the one HK Frontend entry: the id
# the settings page knows it by (the prefix of its `<id>/settings/*` commands,
# kept from before 1.0), its kind, name and what it is.
COMPANIONS = (
    ("hk_music", "music", "Music", "whole-home music"),
    ("hk_alarm_pin", "alarm_pin", "Alarm PIN", "a PIN in front of the alarm"),
    ("hk_clean_areas", "clean_areas", "Clean Areas", "vacuum by area"),
    ("hk_tv", "live_tv", "Live TV", "Live TV"),
    ("hk_energy", "energy", "Energy", "the Energy page"),
    ("hk_notify", "notifications", "Notifications", "banners when something happens"),
)
SHOW = 6                       # names listed before "and N more"
# The domains a room page draws as tiles (hk-strategy.js TILE). A device with
# only a battery sensor or a tracker is not missing from any page.
TILED = ("light", "switch", "fan", "cover", "lock", "media_player", "climate",
         "water_heater", "humidifier", "vacuum", "valve", "alarm_control_panel")


@dataclass
class Line:
    """One line of the report. ok: True fine, False needs doing, None a note."""
    ok: bool | None
    title: str
    detail: str


def version_ok(version: str = HA_VERSION) -> bool:
    try:
        major, minor = (int(p) for p in version.split(".")[:2])
    except ValueError:
        return True                       # a dev build: do not nag
    return (major, minor) >= MIN_HA


def theme_loaded(hass: HomeAssistant) -> bool:
    from homeassistant.components.frontend import DATA_THEMES
    themes = hass.data.get(DATA_THEMES) or {}
    return THEME in themes


def _n(count: int, noun: str) -> str:
    return f"{count} {noun}" + ("" if count == 1 else "s")


def _plain(name: str) -> str:
    """A name as TEXT in a line that is Markdown: device and area names come
    from integrations, and one called "[x](javascript:...)" must not become
    the row's link (the settings page) or a link at all (Configure)."""
    return re.sub(r"([\\`*_\[\]()<>])", r"\\\1", str(name))


def _names(items: list[str]) -> str:
    items = sorted(items, key=str.lower)
    more = len(items) - SHOW
    return ", ".join(_plain(i) for i in items[:SHOW]) + (f" and {more} more" if more > 0 else "")


def area_readiness(hass: HomeAssistant) -> dict[str, list[str]]:
    """What the generated dashboard, the room pages and the menu will miss:
    devices with a tile but in no area (a generated screen leaves them out,
    and no room page shows them), and
    areas with no icon, or no temperature or humidity sensor of their own."""
    areas = ar.async_get(hass)
    devices = dr.async_get(hass)
    entities = er.async_get(hass)
    shown: dict[str, bool] = {}
    for e in entities.entities.values():
        # a device counts when it has a tile a room page would show, with no
        # area of its own either
        if (e.device_id and e.domain in TILED and not e.disabled_by and not e.hidden_by
                and not e.entity_category and not e.area_id):
            shown[e.device_id] = True
    no_area = [d.name_by_user or d.name or d.id for d in devices.devices
               if not d.area_id and not d.disabled_by and d.entry_type is None
               and shown.get(d.id)]
    out: dict[str, list[str]] = {"no_area": no_area, "no_icon": [], "no_temperature": [],
                                 "no_humidity": []}
    for a in areas.async_list_areas():
        if not a.icon:
            out["no_icon"].append(a.name)
        if not getattr(a, "temperature_entity_id", None):
            out["no_temperature"].append(a.name)
        if not getattr(a, "humidity_entity_id", None):
            out["no_humidity"].append(a.name)
    return out


async def async_run(hass: HomeAssistant, options: dict[str, Any],
                    boards: dict[str, dict[str, Any]] | None = None) -> list[Line]:
    """`boards`: the dashboard items (settings.boards), as read."""
    lines: list[Line] = []

    # Home Assistant
    if version_ok():
        lines.append(Line(True, f"Home Assistant {HA_VERSION}", "Supported."))
    else:
        lines.append(Line(False, f"Home Assistant {HA_VERSION}",
                          f"These pages need {MIN_HA[0]}.{MIN_HA[1]} or newer. Update Home Assistant."))

    # The theme
    if theme_loaded(hass):
        lines.append(Line(True, "HK Kiosk Theme", "Loaded."))
    else:
        lines.append(Line(False, "HK Kiosk Theme",
                          "Not loaded, so every page draws in the wrong colors. "
                          "HK Frontend loads it itself and could not; see Settings → Repairs."))

    # The card files as Lovelace resources
    lines.append(await _resources_line(hass))

    # Your files
    st = await hass.async_add_executor_job(files.status, hass)
    have_font, have_glyphs = bool(st["font"]), bool(st["glyphs"])
    if have_font and have_glyphs:
        lines.append(Line(True, "SF Pro & the SF Symbols Glyphs", "Found."))
    else:
        if not have_font and not have_glyphs:
            why = "Not added yet, so the pages use Roboto and Material Design icons."
        elif not have_font:
            why = "SF Pro isn’t added yet, so the pages use Roboto."
        else:
            why = "The SF Symbols glyphs aren’t added yet, so the pages use Material Design icons."
        lines.append(Line(None, "Apple’s Font & Glyphs",
                          why + " Optional: Configure → Your files says where they go."))

    # Areas
    r = area_readiness(hass)
    if r["no_area"]:
        lines.append(Line(None, f"{_n(len(r['no_area']), 'device')} in no area",
                          f"{_names(r['no_area'])}. A generated screen leaves them out (unless "
                          "they are under Accessories → Also Shown), and no room page shows them. "
                          "[Assign them](/config/devices/dashboard)."))
    else:
        lines.append(Line(True, "Every Device with a Tile Is in an Area", ""))
    if r["no_icon"]:
        lines.append(Line(None, f"{_n(len(r['no_icon']), 'area')} with no icon",
                          f"{_names(r['no_icon'])}. The menu draws a plain room glyph for them. "
                          "[Pick icons](/config/areas/dashboard)."))
    sensors = sorted(set(r["no_temperature"]) | set(r["no_humidity"]))
    if sensors:
        lines.append(Line(None, f"{_n(len(sensors), 'area')} with no temperature or humidity sensor",
                          f"{_names(sensors)}. A room page’s status row leaves those readings "
                          "out. Set them in the area’s *Related sensors*."))

    # The menu's dashboards: those with a menu on tablets or on phones
    chosen = [p for p, b in (boards or {}).items()
              if b.get("menu") != "off" or dash_settings.phone_menu(b) != "off"]
    lines.append(_menu_line(hass, chosen))

    # The third-party cards a generated dashboard uses (thirdparty.py):
    # installed from HACS and, for WallPanel and Kiosk Mode, loaded as
    # dashboard resources -- those two listed only where a screen chose them.
    # Optional: a note, never a fault.
    from . import thirdparty
    status = await thirdparty.async_status(hass)
    savers = [b for b in (boards or {}).values() if b.get("screensaver")]
    for key, card in dash_settings.THIRD_PARTY.items():
        # WallPanel only for a screen that chooses it: HK Frontend draws the
        # photo screensaver itself (hk-saver.js) since 1.3.0
        if key == "wallpanel" and not any(b.get("screensaver_engine") == "wallpanel" for b in savers):
            continue
        # Kiosk Mode likewise, for a screen that chooses it: HK Frontend hides
        # Home Assistant's header and sidebar itself (hk-kiosk.js) since 1.3.0
        # The Weather page's radar is HK's own since 1.16 (hk-radar.js): the
        # Weather Radar Card is no longer one of a generated screen's cards
        if key == "radar":
            continue
        if key == "kiosk" and not any(b.get("kiosk") and b.get("kiosk_engine") == "kiosk_mode"
                                      for b in (boards or {}).values()):
            continue
        lines.append(Line(True if status[key] == "ready" else None, card["name"],
                          thirdparty.note(key, status[key])))

    # Adaptive Lighting (HACS): the Lights page's backdrop follows its color
    # temperature (hk-sky.js sunKelvin); without it, the sun's. Optional.
    lines.append(adaptive_lighting_line(hass, options))

    # The photo screensaver's tablets: it runs only for a screen's Tablet
    # User, and that user must exist -- the one thing a new house can't see
    # going wrong (the screensaver just never shows)
    # The wall tablets (1.14): each one's user, screen and kiosk app, and the
    # kiosk app's own settings (tablets.check_lines)
    from . import features as F, tablets
    entry = F.frontend_entry(hass)
    if entry is not None:
        names = {u.name for u in await hass.auth.async_get_users() if not u.system_generated and u.is_active}
        lines.extend(tablets.check_lines(hass, entry, names))

    # The photo screensaver's photos, when a screen shows photos (a screen set
    # to Forecast never looks for any)
    photo_savers = [b for b in savers
                    if ((b.get("screensaver_options") or {}).get("show") or "photos") != "forecast"]
    if photo_savers:
        folder = (dash_settings.merged(options).get("look") or {}).get("photos") \
            or "media-source://media_source/local/photos"
        # a screen with the forecast fallback off shows NOTHING without photos
        # (Photos & Forecast shows the forecast then, whatever the toggle says)
        dark = any((b.get("screensaver_options") or {}).get("fallback") is False
                   and (b.get("screensaver_options") or {}).get("show") != "both" for b in photo_savers)
        lines.append(await _photos_line(hass, folder, dark))

    # Live TV plays each channel through ffmpeg on this machine
    from . import features as F
    if F.entries(hass, "live_tv"):
        import shutil
        found = await hass.async_add_executor_job(shutil.which, "ffmpeg")
        lines.append(Line(True, "ffmpeg", "Found, for Live TV.") if found else
                     Line(False, "ffmpeg", "Live TV needs ffmpeg on the machine Home Assistant runs on, and it "
                          "isn’t there. Home Assistant OS and the container image include it; install it for a "
                          "Python install."))

    # The features
    for _fid, kind, name, what in COMPANIONS:
        if F.entries(hass, kind):
            lines.append(Line(True, name, f"Added ({what})."))
        else:
            lines.append(Line(None, name, f"Not added. Optional, for {what}: HK Frontend → Add feature."))
    return lines


def adaptive_lighting_line(hass: HomeAssistant, options: dict[str, Any]) -> Line:
    """Adaptive Lighting, read by the Lights page's backdrop."""
    lights = (dash_settings.merged(options).get("headers") or {}).get("lights") or {}
    found = sorted(s.entity_id for s in hass.states.async_all("switch")
                   if "adaptive_lighting" in s.entity_id and s.attributes.get("color_temp_kelvin") is not None)
    if lights.get("sky_follow") is False:
        return Line(None, "Adaptive Lighting", "The Lights page’s background doesn’t follow the sun "
                    "(Pages → Lights → Background).")
    if found:
        return Line(True, "Adaptive Lighting", "Found. The Lights page’s background follows its color temperature.")
    return Line(None, "Adaptive Lighting", "Not installed. Optional: the Lights page’s background follows "
                "the sun’s height instead. Adaptive Lighting is on HACS.")


async def _photos_line(hass: HomeAssistant, folder: str, dark: bool = False) -> Line:
    """How many photos the screensaver finds in its folder (the top level;
    it also looks two folders down)."""
    try:
        from homeassistant.components import media_source
        item = await media_source.async_browse_media(hass, folder)
    except Exception as err:  # noqa: BLE001 -- any failure is the line's message
        return Line(False if dark else None, "Screensaver Photos",
                    f"The screensaver can’t read its photos folder ({folder}): {err}. "
                    + ("A screen with Forecast When There Are No Photos off stays dark. " if dark else
                       "It shows the forecast instead. ")
                    + "To show photos, check Screensaver → Screensaver Photos in HK Settings.")
    kids = list(item.children or [])
    photos = sum(1 for c in kids if not c.can_expand and (
        c.media_class == "image" or str(c.media_content_type or "").startswith("image/")))
    folders = sum(1 for c in kids if c.can_expand)
    if not photos and not folders:
        return Line(False if dark else None, "Screensaver Photos",
                    f"The photos folder ({folder}) is empty, so "
                    + ("a screen with Forecast When There Are No Photos off stays dark. " if dark else
                       "the screensaver shows the forecast. ")
                    + "To show photos, add some to it in Media, or choose another folder under Wall "
                    "Tablets → Screensaver Photos.")
    more = f", and {_n(folders, 'folder')} it also looks in" if folders else ""
    return Line(True, "Screensaver Photos", f"{_n(photos, 'photo')} in {folder}{more}.")


async def _resources_line(hass: HomeAssistant) -> Line:
    try:
        from homeassistant.components.lovelace.const import LOVELACE_DATA
        data = hass.data[LOVELACE_DATA]
        collection = data.resources
    except (ImportError, KeyError, AttributeError):
        return Line(None, "Card Files", "Lovelace has not started yet.")
    if hasattr(collection, "async_get_info"):
        await collection.async_get_info()
    have = {str(i.get("url", "")).split("?")[0] for i in collection.async_items()}
    wanted = await hass.async_add_executor_job(resources.wanted)
    missing = [url for _t, url in wanted if url not in have]
    if not missing:
        return Line(True, "Card Files", f"All {len(wanted)} registered as dashboard resources.")
    if getattr(data, "resource_mode", "storage") == "yaml":
        return Line(False, "Card Files",
                    f"Resources are in YAML mode, so add these {len(missing)} yourself: "
                    + ", ".join(f"`{u}`" for u in missing) + ".")
    return Line(False, "Card Files",
                f"{len(missing)} not registered yet ({', '.join(missing[:3])}…). "
                "They are added once Home Assistant has started; restart if this persists.")


def _menu_line(hass: HomeAssistant, chosen: list[str]) -> Line:
    if not chosen:
        return Line(None, "Menu & Room Pages", "Off on every dashboard.")
    try:
        known = set(lovelace_boards.all_boards(hass))      # the Overview as "lovelace"
    except (ImportError, KeyError, AttributeError):
        known = set(chosen)
    gone = [d for d in chosen if d not in known]
    if gone:
        return Line(False, "Menu & Room Pages",
                    f"On for dashboards that do not exist: {', '.join(gone)}. "
                    "Remove their items under Dashboards on this integration's page.")
    return Line(True, "Menu & Room Pages", f"On for {_n(len(chosen), 'dashboard')}.")


def report(lines: list[Line]) -> str:
    """Markdown for the Configure page: the things to do first, then the rest."""
    mark = {True: "✅", False: "⚠️", None: "ℹ️"}
    order = sorted(lines, key=lambda x: {False: 0, True: 1, None: 2}[x.ok])
    todo = sum(1 for x in lines if x.ok is False)
    head = ("**Everything is ready.**" if not todo else
            f"**{todo} thing{'s' if todo != 1 else ''} to fix.**")
    # an en space: a plain one all but vanishes beside an emoji
    rows = [f"{mark[x.ok]}\u2002**{x.title}**" + (f" — {x.detail}" if x.detail else "") for x in order]
    return head + "\n\n" + "\n\n".join(rows)


@callback
def raise_issues(hass: HomeAssistant) -> None:
    """The two Repairs entries (see the module docstring)."""
    if version_ok():
        ir.async_delete_issue(hass, DOMAIN, "ha_too_old")
    else:
        ir.async_create_issue(
            hass, DOMAIN, "ha_too_old", is_fixable=False, is_persistent=False,
            severity=ir.IssueSeverity.ERROR, translation_key="ha_too_old",
            translation_placeholders={"version": HA_VERSION,
                                      "minimum": f"{MIN_HA[0]}.{MIN_HA[1]}"})
    if theme_loaded(hass):
        ir.async_delete_issue(hass, DOMAIN, "theme_missing")
    else:
        ir.async_create_issue(
            hass, DOMAIN, "theme_missing", is_fixable=False, is_persistent=False,
            severity=ir.IssueSeverity.WARNING, translation_key="theme_missing",
            learn_more_url="https://www.home-assistant.io/integrations/frontend/#themes")
