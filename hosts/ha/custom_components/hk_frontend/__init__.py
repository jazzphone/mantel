"""Serve this component's own `frontend/` directory at /hk/.

WHAT THIS IS
The dashboard frontend -- the card library, the page modules, the icon set,
the font and the sky artwork -- lives HERE, next to the code that serves it,
rather than loose in /config/www. See docs/Card-Library.md.

WHY NOT /local/

    /local/ (the built-in mount of /config/www) sends
        Cache-Control: public, max-age=2678400        # 31 days
    and a URL is the only cache key a browser has, so a changed file at an
    unchanged URL can NEVER reach a wall tablet. The only way around it is a
    hand-maintained ?v= on every module, and a forgotten bump ships a stale
    module silently.

`no-cache` is the header that means what is actually wanted: cache it, but
revalidate EVERY time. With the ETag aiohttp already sends, an unchanged file
costs one conditional request answered by a bodyless 304 -- the caching benefit
survives, the staleness does not.

WHY A VIEW AND NOT cache_headers=False
cache_headers=False only OMITS Cache-Control; it does not force revalidation.
With no Cache-Control and no Expires a browser applies HEURISTIC freshness
(RFC 9111 4.2.2) -- roughly 10% of the age since Last-Modified -- so a
long-untouched file gets a LONG stale window: a tablet can run a weeks-old
hk-loader.js and never once ask for a newer copy.

An on_response_prepare hook or a middleware cannot do it either: aiohttp
freezes those once the app has started, so a custom component cannot add to
them during setup. Serving from its own view is what works at this point in
the lifecycle.

LAYOUT -- the URL is the path under frontend/
    /hk/cards/hk-tile.js        frontend/cards/     the Lovelace cards (+ hk-strategy.js)
    /hk/modules/hk-sky.js       frontend/modules/   page behavior, the loader
    /hk/iconset/hk-icons.js     frontend/iconset/   the hk: iconset loader
    /hk/pages/skyprobe.html     frontend/pages/     standalone pages
    /hk/fonts/sf-pro.css        frontend/fonts/     the @font-face (the font is yours)
    /hk/sky/clouds-a.webp       frontend/sky/       sky artwork

Everything else in this component (tests/, docs/, tools/, helpers/, theme/)
sits OUTSIDE frontend/ and is therefore unreachable over HTTP by construction,
not by a rule that could be forgotten.

EXPOSURE
Identical to /local/: unauthenticated, because the browser fetches Lovelace
resources and fonts with no auth header and they must be readable. Only
frontend/ and your files folder (files.py) are reachable. Do not put anything
in either that should not be public -- and no page there may trust its query
string: a page that frames its ?p= as given lets a crafted link run script on
this origin.

The other endpoints, all registered in async_setup, are NOT public:
  ws   hk_frontend/art/sign {urls, size}     art.py: signs the path below for
                                              24 h (an authenticated socket only)
  GET  /api/hk_frontend/art?u=&s=&authSig=   art.py: HA fetches an http(s) image
                                              (8 MB, 12 s, 25 MP), scales it,
                                              serves JPEG/PNG/WebP/GIF only
                                              (anything else re-encoded to JPEG
                                              or refused), nosniff + sandbox CSP
  POST /api/hk_frontend/talk?entity_id=      talk.py: a hold-to-talk clip,
                                              played on that media_player
  GET  /api/hk_frontend/talk/<id>?authSig=   talk.py: the clip, for the
                                              speaker's ffmpeg (signed, 120 s)
  ws   hk_frontend/talk/live                 talk_live.py: the voice streamed
                                              to a UniFi Protect doorbell
Each requires a signed-in user or a path signed for one. So a signed-in
screen can have HA fetch an outside image and play a clip on a speaker --
nothing an anonymous request can do. HA's signing key is made afresh at every
start, so a signed path does not outlive a restart.

YOUR FILES (files.py)
A folder under /config, chosen in Configure -> Your files, answered AHEAD of
frontend/ at the same URLs. It holds what cannot ship here -- Apple's SF Pro
and the SF Symbols glyph data -- and anything a home wants to add or override.

INSTALLING
Settings -> Devices & services -> Add integration -> HK Frontend. The config
entry is the whole install: Home Assistant runs async_setup for it, which
serves /hk/ and registers the bootstrap modules. (`hk_frontend:` in
configuration.yaml also works and serves /hk/ with no entry, but is not needed.)

THE CONFIG ENTRY (one per house, and the only one)
  * options -- the dashboard settings (settings.py) and your files folder;
  * items (subentries) -- each dashboard's settings, the pop-ups, custom
    pages and chips, the features, and Music's presets and playlists;
  * one entity of its own, on an "HK Frontend" service device: the Seasonal
    decorations switch.
The settings feed (hk_frontend/settings/subscribe) is registered in
async_setup, so it answers even while the entry is not loaded; so are the art
and talk endpoints (EXPOSURE) and the features' actions.
The features -- Music, Live TV, Clean Areas and Alarm PIN -- are items added
with Add feature (features/); the entry starts them and follows them. The
cards find them by their actions and feeds only. See docs/Features.md.

LINKED TO MANTEL SERVER (linked_mode.py, mantel_link.py; Configure, off by
default): a house that moved HK to Mantel Server keeps the same actions and
entities here, forwarded to and pushed from Mantel -- one wall tablet at a
time (per-tablet ownership; until the whole entry is Mantel's, everything HA
still owns runs here as before). While the entry's data holds no link, none
of it runs.
"""

import asyncio
import logging
import mimetypes
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.dispatcher import async_dispatcher_connect, async_dispatcher_send
from homeassistant.helpers.typing import ConfigType
import homeassistant.helpers.config_validation as cv

from . import accessories
from . import boot
from . import features as F
from . import files
from . import hk_panel
from . import kinds
from . import linked_mode
from . import panel
from . import rename
from . import resources
from . import setup_check
from . import settings as dash_settings
from .const import CONF_FILES_FOLDER, DOMAIN, SIGNAL_CONFIG, SIGNAL_POPUP

URL_PATH = "/hk"
# The integration's own entity (entity.py): the Seasonal decorations switch;
# and the features' platforms (Alarm PIN's panel, Live TV's cameras and
# sensors), whose entities belong to each feature's item.
PLATFORMS = [Platform.SWITCH, Platform.BINARY_SENSOR, *F.PLATFORMS]

_LOGGER = logging.getLogger(__name__)

CONFIG_SCHEMA = cv.empty_config_schema(DOMAIN)


def _boot_text(hass: HomeAssistant) -> str:
    """The ordered boot file (boot.py), from the files /hk serves. Runs in the executor."""
    def read(path: str) -> str | None:
        target = files.resolve(hass, path)
        return target.read_text(encoding="utf-8") if target is not None else None
    return boot.bundle(read)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register frontend/ (and your files ahead of it) at /hk with
    revalidate-always caching."""
    root = files.BUNDLE_ROOT            # resolved once, at import (off the event loop)

    # THE HOUSE'S PLACE (hk_core settings.model.set_house_place): Home Assistant's latitude and country decide the
    # defaults a house has not chosen (its hemisphere, the US-only themes); kept current when the location changes.
    def _place(_event: Any = None) -> None:
        dash_settings.set_house_place(hass.config.latitude, hass.config.country)

    _place()
    hass.bus.async_listen("core_config_updated", _place)

    from aiohttp import web

    from homeassistant.components.http import HomeAssistantView

    def _gzipped(request, packed, content_type):
        """The gzipped body, with its own ETag (a 304 for the one a browser holds)."""
        body, etag = packed
        headers = {"Cache-Control": "no-cache", "Vary": "Accept-Encoding", "ETag": etag}
        if etag in [t.strip() for t in request.headers.get("If-None-Match", "").split(",")]:
            return web.Response(status=304, headers=headers)
        headers["Content-Encoding"] = "gzip"
        return web.Response(body=body, headers=headers, content_type=content_type.split(";")[0])

    class HkFrontendView(HomeAssistantView):
        """Serve your files, then custom_components/hk_frontend/frontend, at /hk/."""

        url = URL_PATH + "/{filename:.+}"
        name = "hk_frontend:file"
        requires_auth = False   # see EXPOSURE in the module docstring

        async def get(self, request, filename):
            # GZIP (files.gzipped): for a browser that accepts it, the text files
            # go gzipped, made once and kept (in the executor, never on the loop)
            gz = files.accepts_gzip(request.headers.get("Accept-Encoding"))
            # THE ORDERED BOOT (boot.py): HK's bootstrap modules as one file,
            # made from the files this view serves, on every request.
            if filename == boot.BOOT:
                def made():
                    text = _boot_text(hass)
                    return text, (files.gzipped_text(boot.BOOT, text) if gz else None)
                text, packed = await hass.async_add_executor_job(made)
                if packed is not None:
                    return _gzipped(request, packed, "application/javascript")
                return web.Response(text=text, content_type="application/javascript",
                                    headers={"Cache-Control": "no-cache", "Vary": "Accept-Encoding"})

            # resolve() stats the path (two Path.resolve + is_file): off the
            # event loop, as aiohttp's own static handler does.
            def find():
                target = files.resolve(hass, filename)
                return target, (files.gzipped(target) if gz and target is not None else None)
            target, packed = await hass.async_add_executor_job(find)
            if target is None:
                return web.Response(status=404)
            if packed is not None:
                return _gzipped(request, packed, mimetypes.guess_type(target.name)[0] or "application/octet-stream")
            return web.FileResponse(
                target, headers={"Cache-Control": "no-cache", "Vary": "Accept-Encoding"}
            )

    # YOUR FILES FROM THE FIRST REQUEST. The entry's options are already loaded
    # when this runs, so the folder is known before any page asks for the font;
    # async_setup_entry only re-reads it.
    house = F.frontend_entry(hass)
    folder = house.options.get(CONF_FILES_FOLDER) if house else None
    await hass.async_add_executor_job(files.set_folder, hass, folder)

    hass.http.register_view(HkFrontendView())
    # Hold-to-talk on the doorbell sheet: a recorded clip, played on a
    # speaker. See talk.py.
    from . import talk
    talk.async_register(hass)
    # ...and the same button LIVE, streamed as you speak, on a UniFi Protect
    # doorbell. See talk_live.py.
    from . import talk_live
    talk_live.async_register(hass)
    # Album art fetched by HA for screens that cannot reach the artwork CDN.
    # See art.py.
    from . import art
    art.async_register(hass)
    # The HK Kiosk themes, added to the frontend's without configuration.yaml.
    # See themes.py.
    from . import themes
    await themes.async_setup(hass)
    _LOGGER.info("hk_frontend: serving %s (after %s) at %s/ (no-cache)",
                 root, hass.data[DOMAIN].get(files.FILES), URL_PATH)

    # THE BOOTSTRAP MODULES -- registered here, not in configuration.yaml.
    #
    # add_extra_js_url() is the SAME mechanism as `frontend: extra_module_url:`
    # in configuration.yaml; `dependencies: frontend` in manifest.json is what
    # guarantees the frontend's URL registry exists by the time this runs.
    #
    # ONE URL, IN ORDER. HA's frontend imports every extra module in parallel,
    # in no fixed order, so HK's client, adapter and shell (which depend on one
    # another at load) are served as ONE ordered file: boot.py has the order,
    # the reasons and what is imported after the core (the settings, the
    # iconset, the header, the loader and the dashboard strategy, which HA waits
    # at most 5 s for). Loaded at frontend bootstrap, before Lovelace injects
    # its resources (the card files). Changing boot.py's lists needs a restart;
    # editing a FILE does not (/hk/ is no-cache, the boot file is made per request).
    from homeassistant.components.frontend import add_extra_js_url

    add_extra_js_url(hass, boot.URL)

    websocket_api.async_register_command(hass, ws_settings_subscribe)
    websocket_api.async_register_command(hass, ws_events_subscribe)
    panel.register_commands(hass)
    from . import screensaver
    screensaver.register_commands(hass)
    # THE PAGE HEADERS' server side (page_headers.py): Tonight's lighting
    # schedule, worked out from the automations, which only an admin may read
    from . import page_headers
    page_headers.async_setup(hass)

    # an automation's Off Until Tomorrow (the automation sheet; snooze.py)
    from . import snooze
    await snooze.async_setup(hass)

    # SHOW POP-UP: an automation opens a pop-up (Pop-ups on the
    # integration's page) on the screens showing a dashboard -- all of them,
    # or those listed, or those signed in as the users listed. It opens in
    # place: a screen on another page, or asleep, is the automation's own
    # business (a Fully Kiosk load_url with the pop-up's #hash does both).
    async def show_popup(call: ServiceCall) -> None:
        # LINKED TO MANTEL SERVER (linked_mode.py): the whole entry Mantel's,
        # the pop-ups and the screens are Mantel's: the call goes there as
        # made. Some tablets Mantel's: here as always, and there too.
        linked = linked_mode.active(hass)
        if linked is not None and linked.full:
            await linked.forward("show_popup", call.data)
            return
        hash_ = str(call.data["popup"]).strip().lstrip("#").lower()
        known = {p["hash"] for p in dash_settings.popups(_entry(hass))}
        if hash_ not in known:
            raise ServiceValidationError(
                f"No pop-up #{hash_}. Add it under Pop-ups on HK Frontend's page (known: "
                + (", ".join("#" + k for k in sorted(known)) or "none") + ").")
        async_dispatcher_send(hass, SIGNAL_POPUP, {
            "type": "popup", "popup": hash_,
            "dashboards": [str(d).strip("/") for d in call.data.get("dashboards") or []],
            "users": [str(u) for u in call.data.get("users") or []]})
        if linked is not None:
            await linked.also("show_popup", call.data)

    hass.services.async_register(DOMAIN, "show_popup", show_popup, schema=vol.Schema({
        vol.Required("popup"): cv.string,
        vol.Optional("dashboards"): vol.All(cv.ensure_list, [cv.string]),
        vol.Optional("users"): vol.All(cv.ensure_list, [cv.string]),
    }))

    # CLOSE POP-UP: the other half. An alarm keypad held up for as long as
    # the alarm lasts has to come down the moment it clears, and the only way
    # an automation had was to navigate the tablet away from the #hash -- a
    # Fully Kiosk load_url, which a kiosk without one (Kiosk Satellite) cannot
    # do. The same screens as Show pop-up; a screen not showing it ignores it.
    async def close_popup(call: ServiceCall) -> None:
        linked = linked_mode.active(hass)
        if linked is not None and linked.full:
            await linked.forward("close_popup", call.data)
            return
        hash_ = str(call.data["popup"]).strip().lstrip("#").lower()
        async_dispatcher_send(hass, SIGNAL_POPUP, {
            "type": "popup_close", "popup": hash_,
            "dashboards": [str(d).strip("/") for d in call.data.get("dashboards") or []],
            "users": [str(u) for u in call.data.get("users") or []]})
        if linked is not None:
            await linked.also("close_popup", call.data)

    hass.services.async_register(DOMAIN, "close_popup", close_popup, schema=vol.Schema({
        vol.Required("popup"): cv.string,
        vol.Optional("dashboards"): vol.All(cv.ensure_list, [cv.string]),
        vol.Optional("users"): vol.All(cv.ensure_list, [cv.string]),
    }))

    # ACCESSORY SETTINGS (accessories.py): loaded before Status & Chips, which
    # reads their `status` and `show_as`.
    acc = accessories.Accessories(hass)
    await acc.async_load()
    hass.data.setdefault(DOMAIN, {})[accessories.DATA] = acc
    accessories.register(hass)
    # HIDDEN ACCESSORIES (hiding.py): what keeps each one off the screens
    from . import hiding
    hiding.register(hass)

    # STATUS & CHIPS (kinds.py), resolved and kept current for every screen.
    def settings_now() -> dict[str, Any]:
        entry = _entry(hass)
        return {**dash_settings.merged(entry.options if entry else None),
                "accessories": acc.data}

    tracker = kinds.Tracker(hass, settings_now)
    hass.data.setdefault(DOMAIN, {})[kinds.DATA] = tracker
    tracker.start()
    # THE FEATURES (features/): their actions and websocket commands, whether
    # or not they are added -- the settings page asks them what they have.
    for kind in F.KINDS:
        await F.module(kind).async_setup(hass)
    # A pre-release feature entry becomes an item of the house's entry, before
    # any entry is set up.
    await F.async_fold(hass)
    # LINKED, the settings Mantel's: the pages' settings saves go to Mantel
    # (linked_mode.forward_saves; decision 29), after everything registered
    linked_mode.forward_saves(hass)
    # ...and the features' actions go to Mantel while it runs the house (linked_mode.forward_actions)
    linked_mode.forward_actions(hass)
    # ...and the dashboards' feature reads (Live TV, music, ...) are answered by Mantel (forward_reads)
    linked_mode.forward_reads(hass)
    return True


def _entry(hass: HomeAssistant) -> ConfigEntry | None:
    """The house's entry (there is only ever one), loaded or not: its options
    are the settings even while it is disabled. The features' entries are
    not it (features/__init__.py)."""
    return F.frontend_entry(hass)


@websocket_api.websocket_command({vol.Required("type"): "hk_frontend/events/subscribe"})
@callback
def ws_events_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                        msg: dict[str, Any]) -> None:
    """What the house asks screens to do (hk_frontend.show_popup), as it
    happens. Every user -- a wall tablet's too -- may listen; each screen
    decides whether it is one of the screens asked."""

    @callback
    def send(event: dict[str, Any]) -> None:
        # a notification for some people only (its `users`, user ids) goes to
        # their browsers only: the screens' own check (hk-notify.js) decides
        # what to show, but nobody else's socket should carry it -- title,
        # message and snapshot
        users = event.get("users") if isinstance(event, dict) else None
        if users and getattr(connection.user, "id", None) not in users:
            return
        connection.send_message(websocket_api.event_message(msg["id"], event))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_POPUP, send)
    connection.send_result(msg["id"])


@websocket_api.websocket_command({vol.Required("type"): "hk_frontend/settings/subscribe"})
@callback
def ws_settings_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                          msg: dict[str, Any]) -> None:
    """The dashboard settings (settings.py), now and whenever they change.
    The same for every user, and open to non-admin users such as a wall tablet's own."""

    @callback
    def send() -> None:
        # LINKED, the house Mantel's: Mantel's settings, as it sent them last
        # (linked_mode.mirrored; decision 29), not this entry's frozen own
        mirror = linked_mode.mirrored(hass)
        if mirror is not None:
            connection.send_message(websocket_api.event_message(msg["id"], mirror))
            return
        from . import screensaver
        mgr = screensaver.manager(hass)
        payload = dash_settings.as_client(_entry(hass), kinds.current(hass), accessories.current(hass),
                                          hass.data.get(DOMAIN, {}).get("extras"),
                                          mgr.switch_ids() if mgr else None,
                                          mgr.black_ids() if mgr else None)
        # which features are added and set up (features/): a card offers what
        # one gives only when it is -- their actions are always registered
        payload["added"] = [k for k in F.KINDS if F.loaded(hass, k)]
        # THE ENERGY PAGE's plan (features/energy/plan.py), while Energy is
        # added: a screen whose Pages list Energy draws it from this
        from .features import energy
        payload["energy"] = energy.client(hass)
        # HK AS ITS OWN PANEL (hk_panel.py), only while it is on: its screen's
        # settings under its address too
        house = _entry(hass)
        payload = hk_panel.mirror(payload, house.options if house else None)
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(hass, SIGNAL_CONFIG, send)
    connection.send_result(msg["id"])
    send()


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """The house's entry: your files, the Seasonal decorations switch, the
    features, and a nudge to every screen on change. A change needs no
    reload: the screens are re-sent their settings, and the features follow
    their items (features/async_sync)."""
    if F.kind_of(entry) != F.FRONTEND:
        _LOGGER.error("hk_frontend: %s is a feature entry from a pre-release that could not be folded into "
                      "the HK Frontend entry (see the log above). Delete it in Settings -> Devices & services, "
                      "then add the feature again from HK Frontend -> Add feature", entry.title)
        return False
    # LINKED TO MANTEL SERVER (linked_mode.py, off unless Configure set it),
    # the whole entry Mantel's: the same actions and entities, Mantel's;
    # nothing below runs. Linked with the rest still HA's: everything below
    # runs, less what Mantel owns (its tablets), and the link starts first.
    if linked_mode.full(entry):
        return await linked_mode.async_setup_entry(hass, entry, PLATFORMS)
    # HK's settings are this entry's again (the house back to Home
    # Assistant, or unlinked): Mantel's last ones taken in, once (mirror.py)
    from . import mirror
    await mirror.adopt_if_handed_back(hass, entry)
    set_up_for = linked_mode.setup_key(entry)

    @callback
    def changed(*_args: Any) -> None:
        async_dispatcher_send(hass, SIGNAL_CONFIG)

    # THE HK SETTINGS PAGE (panel.py), for admins while the integration is
    # set up: in the sidebar unless Configure -> HK Settings page says not,
    # and linked from that page either way.
    sidebar = {"shown": panel.sidebar_shown(entry.options)}
    try:
        await panel.async_register(hass, sidebar["shown"])
    except Exception:  # noqa: BLE001 -- the settings still work from Configure
        _LOGGER.exception("hk_frontend: the HK Settings page could not be added")
    # HK AS ITS OWN PANEL (hk_panel.py): opt-in, nothing registered while off
    own = {"conf": None}
    try:
        own["conf"] = await hk_panel.async_follow(hass, entry.options, None)
    except Exception:  # noqa: BLE001 -- the dashboards do not need it
        _LOGGER.exception("hk_frontend: the HK panel could not be added")

    async def check_files() -> None:
        folder = entry.options.get(CONF_FILES_FOLDER)
        await hass.async_add_executor_job(files.set_folder, hass, folder)
        st = await hass.async_add_executor_job(files.status, hass)
        files.raise_issues(hass, st, folder)
        # the optional HACS cards a page can use (the Weather page's radar)
        hass.data.setdefault(DOMAIN, {})["extras"] = await hass.async_add_executor_job(
            dash_settings.find_extras, hass.config.config_dir)

    pass_state = {"running": False, "again": False}

    async def updated(_hass: HomeAssistant, _entry: ConfigEntry) -> None:
        # ONE PASS PER CHANGE, NOT PER WRITE. Home Assistant runs this once for
        # every write, each started at its write: removing a chip writes its
        # subentry and each screen that listed it (up to ten), a playlist
        # reorder each playlist -- and every run sent every open page the
        # whole feed again. So a run already going takes the others' changes
        # with it: they only mark it, and it goes round once more if one came
        # while it worked. Its first step yields once, so the writes the same
        # handler makes right after (synchronously) are in before it reads.
        # linked to Mantel Server, unlinked, or a tablet moved (Configure, or
        # Mantel saying so): start again, as it now is
        if linked_mode.setup_key(entry) != set_up_for:
            hass.config_entries.async_schedule_reload(entry.entry_id)
            return
        if pass_state["running"]:
            pass_state["again"] = True
            return
        pass_state["running"] = True
        try:
            await asyncio.sleep(0)
            while True:
                pass_state["again"] = False
                await one_pass()
                if not pass_state["again"]:
                    break
        finally:
            pass_state["running"] = False

    async def one_pass() -> None:
        # a feature added, removed or changed, or one of its items
        await F.async_sync(hass, entry)
        await check_files()
        # only when the switch changed: every re-registration makes every
        # open browser fetch its panels again
        if panel.sidebar_shown(entry.options) != sidebar["shown"]:
            sidebar["shown"] = panel.sidebar_shown(entry.options)
            try:
                await panel.async_register(hass, sidebar["shown"])
            except Exception:  # noqa: BLE001
                _LOGGER.exception("hk_frontend: the HK Settings page could not be updated")
        # the HK panel switched on, off or changed (nothing while it stays off)
        try:
            own["conf"] = await hk_panel.async_follow(hass, entry.options, own["conf"])
        except Exception:  # noqa: BLE001
            _LOGGER.exception("hk_frontend: the HK panel could not be updated")
        tracker = hass.data.get(DOMAIN, {}).get(kinds.DATA)
        if tracker:
            tracker.settings_changed()
        changed()

    entry.async_on_unload(entry.add_update_listener(updated))
    await check_files()

    # AN ENTITY RENAME IS FOLLOWED through HK Frontend's own structured
    # settings, exact ids only, and reported (rename.py for what it may touch).
    entry.async_on_unload(rename.async_setup(hass, entry))

    # The card files as Lovelace resources: add any that are missing, once
    # Home Assistant has started (resources.py -- never edits or removes).
    from homeassistant.helpers.start import async_at_started

    async def _resources(_hass: HomeAssistant) -> None:
        await resources.async_ensure(hass)

    entry.async_on_unload(async_at_started(hass, _resources))

    # THE DASHBOARD ITEMS' TITLES ARE THEIR DASHBOARDS': an item
    # cannot be renamed on its own, so once started each takes its
    # dashboard's current title -- after a migration made it with the url
    # path, and after the dashboard is renamed ("kitchen" -> "Kitchen").
    async def _titles(_hass: HomeAssistant) -> None:
        for sub in list(entry.subentries.values()):
            if sub.subentry_type == dash_settings.SUBENTRY_DASHBOARD and sub.unique_id:
                title = dashboard_title(hass, sub.unique_id)
                if title and title != sub.unique_id and title != sub.title:
                    hass.config_entries.async_update_subentry(entry, sub, title=title)

    entry.async_on_unload(async_at_started(hass, _titles))

    # SETUP CHECK Repairs (setup_check.py): Home Assistant too old, or the
    # HK Kiosk theme not loaded -- checked once started, and the theme
    # again on every themes reload, so the issue clears itself once fixed.
    from homeassistant.components.frontend import EVENT_THEMES_UPDATED

    async def _check(_hass: HomeAssistant) -> None:
        setup_check.raise_issues(hass)

    @callback
    def _themes(_event: Any) -> None:
        setup_check.raise_issues(hass)

    entry.async_on_unload(async_at_started(hass, _check))
    entry.async_on_unload(hass.bus.async_listen(EVENT_THEMES_UPDATED, _themes))
    # THE FEATURES, before the platforms: each platform adds the running
    # features' entities as it is set up (features/async_setup_platform)
    await F.async_start(hass, entry)
    # linked, the rest still HA's: the link before the platforms, which
    # attach to it for the entities of the tablets Mantel owns
    if linked_mode.configured(entry):
        linked_mode.start(hass, entry)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    # THE WALL TABLETS' alerts and scheduled restart (tablets.py)
    from . import tablets
    tablets.async_setup_watch(hass, entry)
    # the screens learn which features run (the settings feed's `added`)
    async_dispatcher_send(hass, SIGNAL_CONFIG)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """The switch, the features and the settings page go; the settings feed
    keeps answering from the options."""
    if F.kind_of(entry) != F.FRONTEND:
        return True
    linked = linked_mode.active(hass)
    if linked is not None and linked.entry is entry and linked.full:
        return await linked_mode.async_unload_entry(hass, entry, PLATFORMS)
    # The platforms first: a failed unload leaves the entry loaded, and it must
    # then still have its settings page (it used to lose it first).
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        await linked_mode.async_stop(hass, entry)        # linked, the rest HA's: the link too
        panel.async_unregister(hass)
        hk_panel.async_unregister(hass)          # nothing to do while it is off
        await F.async_stop(hass)
        async_dispatcher_send(hass, SIGNAL_CONFIG)
    return ok


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Removed: it takes its Repairs with it, and /hk/ serves the default
    files folder (hk_local, if it exists), exactly as a house with no entry
    would. A pre-release feature entry being folded into the house's is not
    a removal."""
    if F.kind_of(entry) != F.FRONTEND:
        return
    for key in files.ISSUES + setup_check.ISSUES:
        ir.async_delete_issue(hass, DOMAIN, key)
    await hass.async_add_executor_job(files.set_folder, hass, None)
    async_dispatcher_send(hass, SIGNAL_CONFIG)


async def async_migrate_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Every entry is version 1.17; one from a later major version is refused
    rather than guessed at. An older minor version is marked 7 (the versions
    that made such entries already moved their data), then 7 -> 8 moves the
    screens' room settings to All Screens (settings.rooms_lifted), 8 -> 9
    their menu settings (settings.menu_lifted), 9 -> 10 makes the pages'
    status rows (settings.status_lifted), 10 -> 11 writes down each
    screen's menu on a phone (settings.phones_lifted), 11 -> 12 gives
    Phones one set of settings of their own (settings.settings_tidied), and
    12 -> 13 moves the screens' camera lists to All Screens
    (settings.cameras_lifted), 13 -> 14 makes each wall tablet an item of
    its own (settings.tablets_lifted), 14 -> 15 keeps stored only what
    differs from the defaults (settings.settings_trimmed), 15 -> 16 moves
    the Weather page to HK's own radar (settings.radar_lifted), and 16 -> 17
    has each screen's menu follow All Screens one setting at a time
    (settings.menu_per_setting)."""
    if entry.version > 1:
        return False
    if entry.minor_version < 7:
        hass.config_entries.async_update_entry(entry, minor_version=7)
    if entry.minor_version < 8:
        if F.kind_of(entry) == F.FRONTEND:
            subs = {s.unique_id: s for s in entry.subentries.values()
                    if s.subentry_type == dash_settings.SUBENTRY_DASHBOARD and s.unique_id}
            options, items = dash_settings.rooms_lifted(entry.options, {p: dict(s.data) for p, s in subs.items()})
            for p, data in items.items():
                if data != dict(subs[p].data):
                    hass.config_entries.async_update_subentry(entry, subs[p], data=data)
            if options is not None:
                hass.config_entries.async_update_entry(entry, options=options)
        hass.config_entries.async_update_entry(entry, minor_version=8)
    if entry.minor_version < 9:
        # the menu's settings move to All Screens (settings.menu_lifted)
        if F.kind_of(entry) == F.FRONTEND:
            subs = {s.unique_id: s for s in entry.subentries.values()
                    if s.subentry_type == dash_settings.SUBENTRY_DASHBOARD and s.unique_id}
            options, items = dash_settings.menu_lifted(entry.options, {p: dict(s.data) for p, s in subs.items()})
            for p, data in items.items():
                if data != dict(subs[p].data):
                    hass.config_entries.async_update_subentry(entry, subs[p], data=data)
            if options is not None:
                hass.config_entries.async_update_entry(entry, options=options)
        hass.config_entries.async_update_entry(entry, minor_version=9)
    if entry.minor_version < 10:
        # the pages' status rows: Climate's moves in, a saved room row grows
        # (settings.status_lifted)
        if F.kind_of(entry) == F.FRONTEND:
            options = dash_settings.status_lifted(entry.options)
            if options is not None:
                hass.config_entries.async_update_entry(entry, options=options)
        hass.config_entries.async_update_entry(entry, minor_version=10)
    if entry.minor_version < 11:
        # phones get their own menu, written down as they show it now
        # (settings.phones_lifted)
        if F.kind_of(entry) == F.FRONTEND:
            subs = {s.unique_id: s for s in entry.subentries.values()
                    if s.subentry_type == dash_settings.SUBENTRY_DASHBOARD and s.unique_id}
            options, items = dash_settings.phones_lifted(entry.options, {p: dict(s.data) for p, s in subs.items()})
            for p, data in items.items():
                if data != dict(subs[p].data):
                    hass.config_entries.async_update_subentry(entry, subs[p], data=data)
            if options is not None:
                hass.config_entries.async_update_entry(entry, options=options)
        hass.config_entries.async_update_entry(entry, minor_version=11)
    if entry.minor_version < 12:
        # one set of Phones' settings, no narrow choice, the tab bar's
        # Tinted glass by its own name (settings.settings_tidied)
        if F.kind_of(entry) == F.FRONTEND:
            subs = {s.unique_id: s for s in entry.subentries.values()
                    if s.subentry_type == dash_settings.SUBENTRY_DASHBOARD and s.unique_id}
            options, items = dash_settings.settings_tidied(entry.options, {p: dict(s.data) for p, s in subs.items()})
            for p, data in items.items():
                if data != dict(subs[p].data):
                    hass.config_entries.async_update_subentry(entry, subs[p], data=data)
            if options is not None:
                hass.config_entries.async_update_entry(entry, options=options)
        hass.config_entries.async_update_entry(entry, minor_version=12)
    if entry.minor_version < 13:
        # the screens' camera lists move to All Screens (settings.cameras_lifted)
        if F.kind_of(entry) == F.FRONTEND:
            subs = {s.unique_id: s for s in entry.subentries.values()
                    if s.subentry_type == dash_settings.SUBENTRY_DASHBOARD and s.unique_id}
            options, items = dash_settings.cameras_lifted(entry.options, {p: dict(s.data) for p, s in subs.items()})
            for p, data in items.items():
                if data != dict(subs[p].data):
                    hass.config_entries.async_update_subentry(entry, subs[p], data=data)
            if options is not None:
                hass.config_entries.async_update_entry(entry, options=options)
        hass.config_entries.async_update_entry(entry, minor_version=13)
    if entry.minor_version < 14:
        # the wall tablets become items of their own (settings.tablets_lifted)
        if F.kind_of(entry) == F.FRONTEND:
            from types import MappingProxyType
            from homeassistant.config_entries import ConfigSubentry
            from homeassistant.helpers import area_registry as ar
            subs = {s.unique_id: s for s in entry.subentries.values()
                    if s.subentry_type == dash_settings.SUBENTRY_DASHBOARD and s.unique_id}
            have = {s.unique_id for s in entry.subentries.values()
                    if s.subentry_type == dash_settings.SUBENTRY_TABLET}
            options, items, made = dash_settings.tablets_lifted(
                entry.options, {p: dict(s.data) for p, s in subs.items()},
                {p: s.title for p, s in subs.items()}, {a.id for a in ar.async_get(hass).async_list_areas()})
            for tid, data in made.items():
                if tid not in have:
                    hass.config_entries.async_add_subentry(entry, ConfigSubentry(
                        data=MappingProxyType(data), subentry_type=dash_settings.SUBENTRY_TABLET,
                        title=data["name"], unique_id=tid))
            for p, data in items.items():
                if data != dict(subs[p].data):
                    hass.config_entries.async_update_subentry(entry, subs[p], data=data)
            if options is not None:
                hass.config_entries.async_update_entry(entry, options=options)
        hass.config_entries.async_update_entry(entry, minor_version=14)
    if entry.minor_version < 15:
        # only what differs from the defaults stays stored (settings.only_set)
        if F.kind_of(entry) == F.FRONTEND:
            boards_ = {s.unique_id: s for s in entry.subentries.values()
                       if s.subentry_type == dash_settings.SUBENTRY_DASHBOARD and s.unique_id}
            tabs = {s.unique_id: s for s in entry.subentries.values()
                    if s.subentry_type == dash_settings.SUBENTRY_TABLET and s.unique_id}
            options, bdata, tdata = dash_settings.settings_trimmed(
                entry.options, {p: dict(s.data) for p, s in boards_.items()}, {t: dict(s.data) for t, s in tabs.items()})
            for p, data in bdata.items():
                if data != dict(boards_[p].data):
                    hass.config_entries.async_update_subentry(entry, boards_[p], data=data)
            for t, data in tdata.items():
                if data != dict(tabs[t].data):
                    hass.config_entries.async_update_subentry(entry, tabs[t], data=data)
            if options is not None:
                hass.config_entries.async_update_entry(entry, options=options)
        hass.config_entries.async_update_entry(entry, minor_version=15)
    if entry.minor_version < 16:
        # the Weather page's radar becomes HK's own: a house that showed the
        # Weather Radar Card keeps a radar, its options carried over
        # (settings.radar_lifted); the card's own options stay as they were
        if F.kind_of(entry) == F.FRONTEND:
            extras = await hass.async_add_executor_job(dash_settings.find_extras, hass.config.config_dir)
            options = dash_settings.radar_lifted(entry.options, bool(extras.get("radar")))
            if options is not None:
                hass.config_entries.async_update_entry(entry, options=options)
        hass.config_entries.async_update_entry(entry, minor_version=16)
    if entry.minor_version < 17:
        # each screen's menu follows All Screens one setting at a time: what
        # equals All Screens' follows again (settings.menu_per_setting)
        if F.kind_of(entry) == F.FRONTEND:
            subs = {s.unique_id: s for s in entry.subentries.values()
                    if s.subentry_type == dash_settings.SUBENTRY_DASHBOARD and s.unique_id}
            items = dash_settings.menu_per_setting(entry.options, {p: dict(s.data) for p, s in subs.items()})
            for p, data in items.items():
                if data != dict(subs[p].data):
                    hass.config_entries.async_update_subentry(entry, subs[p], data=data)
        hass.config_entries.async_update_entry(entry, minor_version=17)
    return True


def dashboard_title(hass: HomeAssistant, path: str) -> str:
    """A dashboard's title as the sidebar shows it ("Living Room"), else its
    url path -- the lovelace data may not be there yet during a migration."""
    from . import lovelace_boards
    return lovelace_boards.title(hass, path)
