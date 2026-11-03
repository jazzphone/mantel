"""Phase 4, Mantel's side: hk_core's features running INSIDE Mantel Server (PLAN §0 plan review item 1
(c), §9 Phase 4, §10; docs/phase4/MANTEL-FEATURES.md).

Every feature's DECISIONS are already in ``hk_core`` behind the ``House`` port and run in Home
Assistant through ``HaHouse``. This module is the other host: the same decisions, asked of Mantel's
own House (``house.MantelHouse``: the hub's StateStore and Registry for reads, the command gateway for
service calls) and Mantel's own stores. Nothing here imports ``homeassistant``.

THE PIECES, each off until Mantel's feature settings turn it on (``house/mantel_features`` in the
settings store; ``PUT /api/features/settings``, Owner only). A piece that is off does nothing.

* ``notifications``: follows the hub's state changes; ``hk_core.notifications.banner.goes_off`` says
  what a change sets off; the payload (``banner.build``) goes to every Mantel screen listening on
  ``hk_frontend/events/subscribe`` (the message type HK's page already opens: same shapes, served
  from ``app["read_routes"]``), and Wakes the Screen through the Sleep Screen engines. Mute 1 Hour
  is kept in the settings store (``house/notify_mutes``), so it survives a restart. A notification
  naming a camera carries its snapshot (``notify_snaps.py``: taken through Mantel's own HA credential,
  kept with retention, served by Mantel with RBAC), and the Calendars category looks ahead once a
  minute (``feature_watch.CalendarLook``). HK Settings' feature pages are answered by
  ``feature_pages.py``.
* ``tablets``: All Tablets' alerts (an Important banner) and scheduled restart, each press a gateway
  command (``feature_watch.TabletWatch``).
* ``linked``: the real handler for Phase 5's linked ``hk_frontend`` (``linked.py``'s hook point):
  ``set_black_screen`` acts on Mantel's screens (hk_core's ``Black``, the confirmed handshake: the new
  state is pushed BEFORE the call's answer), ``show_popup`` / ``close_popup`` go to the screens' event
  feed (checked against Mantel's pop-ups: ``unknown_popup``), and each tablet's four entities (black
  screen and photo screensaver switches, screen in use, sleep screen) are published with
  hk_frontend's unique ids (``{HA entry id}_{tablet uid}_{key}``) and kept current from the
  screensaver, tablets and sleep decisions. Opt-in ``backlight``: the forwarded black screen also
  sets the tablet's backlight (its kiosk's ``light.*_screen``, or one named per tablet) through the
  gateway: lowest when black, the carried brightness when woken.
* ``sleep``: a Sleep Screen engine (``hk_core.sleep.engine.Sleep``) per tablet whose Sleep Screen is
  Decided By HK (``hk``; ``shadow`` decides and never acts). Its service calls (the Kiosk Satellite
  screen, screensaver switches, brightness) go through ``MantelHouse.call_service``, so with house
  commands disabled it records what it WOULD have done (``status()["sleep"][tid]["actions"]``, outcome
  ``would``) and sends nothing. Mantel's own black screen and photos are Mantel's state, not house
  commands.
* ``clean_areas``: ``mantel/clean_areas/coverage`` (read) and ``clean_areas_run`` (the page's request;
  each robot's call goes through the gateway AS THE PERSON who asked, as HA runs it in the caller's
  context; with commands off the plan comes back with every robot refused ``commands_disabled``).
* ``energy``: ``mantel/energy/plan`` (read, RBAC feature ``energy``): HA's Energy settings through the
  read proxy (``energy/get_prefs``), the house through MantelHouse, ``hk_core.energy.plan.build``.
* ``live_tv``: ``mantel/live_tv/guide`` (read): the HDHomeRun lineup and XMLTV guide fetched from the
  URLs in the settings (``hooks.fetch``; tests use fakes), parsed by ``hk_core.live_tv_guide``. Where
  Mantel has its own go2rtc (``--go2rtc-url``), live_tv.py serves the whole page from it: the channels,
  their cameras and sensors, the streams and the viewers.

THE SERVICE ACTOR. A feature's own house command (the sleep engine, the linked backlight) goes
through the SAME ``gateway.Gateway`` code path as a person's, as the server's own Service subject
``mantel:features`` (user role ``service``): RBAC first, then the audit row (actor ``mantel:features``,
role ``service``) before anything is sent, then Home Assistant only if ``cfg.commands_enabled``. Its
grants are computed, not stored: ``control`` on exactly the entities the enabled features act on
(each acting tablet's kiosk parts, each linked backlight), nothing else. An Owner's stored deny grant
naming user ``mantel:features`` still wins (explicit deny wins). With commands off the gateway
answers ``commands_disabled`` and writes a ``denied`` / ``not_sent`` audit row: every intended action
is both audited and listed in ``GET /api/features/status``.

Wiring for the orchestrator (``server.py`` is not edited here), after ``linked.register``::

    features.register(app, hub, hooks)      # hooks: the connectors' Hooks (may_read)
"""
from __future__ import annotations

from .settings import (
    AUTO_PIECES, COMPANIONS, DEFAULTS, ENERGY_REFRESH_S, FEATURES_DOC, FEATURE_ACTOR, FEATURE_ACTOR_NAME, FEATURE_READS,
    HA_KINDS, HA_RUN, IMPORTED, KIOSK_DOMAINS, LIVE_TV_REFRESH_S, LOG_KEEP, MAX_FETCH, MUTES_DOC, PIECES,
    ROUTE_RULES, TABLET_ENTITIES, bad_item, check_settings, ha_items, import_features, import_piece, _AREA,
    _CHANNEL, _ENTITY, _ENTRY, _HOST, _LIGHT, _TID, _URL, _strs,
)
from .actor import (
    FeatureAuthz, FeatureCaller, FeatureGateway, Feed, OverlayHouse, ScreenState, _slug, _user_keys,
)
from .sleep import (
    MantelSleep,
)
from .notify import (
    Notifier,
)
from .linked_handler import (
    FeatureLinked,
)
from .tv_fetch import (
    LiveTv, http_fetch,
)
from .energy_plan import (
    energy_context, energy_house, found_thermostats,
)
from .host import (
    FeatureHooks, FeatureHost, may_speak_for, register, _principal_ok, _role,
)
