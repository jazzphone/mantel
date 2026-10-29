"""P3.5: HK's settings in Mantel's own database, versioned, with history, served with the message
types and shapes HK's frontend already uses (PLAN §2 "Settings live in a config entry", §4 "HK's own
data in SQLite", §5, §10 "HK Settings").

What is here:

* ``SettingsStore``: documents ``(scope, key) -> JSON object`` in ``settings_docs`` (migration
  ``0003_settings.sql``). Every change that changes something is a new version and an append-only
  ``settings_history`` row (who, which device, when, which message, the diff, the whole body).
  ``restore`` makes a NEW version from an older one's body; nothing is ever rewritten.
* ``ThinModel``: the checks a write passes before it is stored. It is a deliberately thin stand-in
  for HK's settings model (``settings.py`` / ``settings_api.py`` in the HA component, which another
  model, ``hk_core/settings/``). ``load_model()`` uses ``hk_core.settings.changes`` (apply_house,
  apply_board, apply_tablet) and ``hk_core.settings.model`` (merged) when present; otherwise ThinModel.
* ``SettingsService``: the client API.
    - reads (in a page's ``read`` / ``read_subscribe`` frame, routed by ``app["read_routes"]``):
      ``hk_frontend/settings/subscribe`` (the settings feed: the whole payload now and after every
      change, as HA's feed sends it), ``hk_frontend/panel/get`` (HK Settings' one read),
      ``mantel/settings/get`` and ``mantel/settings/history``.
    - saves (client message ``settings_write {id, msg}`` -> ``settings_result {id, result|error}``):
      ``hk_frontend/settings/set``, ``board/set``, ``tablet/set``, ``setup/done``,
      ``calendar/color``, ``chip/save``, ``chip/remove``, plus ``mantel/settings/user/set`` and
      ``mantel/settings/restore``.
  Every save asks ``hooks.may_configure(identity, Scope)`` (RBAC ``configure``: house, screen and
  tablet scopes are the ``settings`` feature, a person's own user scope is ``profile``).
  **Settings saves are HK's own data, not house commands**: they are allowed while house commands
  are disabled (``commands.enabled = false``), because nothing here sends anything to Home Assistant
  or to any device. Saves that would change Home Assistant (an HA
  helper or dashboard created, an image deleted, a service called ...) are refused (``ha_write``);
  HK data Mantel does not hold yet is refused as ``not_yet`` (only Mute 1 Hour now, which the page sends as
  Mantel's own frame: accessories, Hidden Accessories, Music and the Alarm PIN are Mantel's,
  docs/phase9/NO-HK-FRONTEND.md). ``SAVE_KINDS`` classifies every type in
  ``hkClient.WRITES`` (pinned by a test).
* ``import_settings``: the one-time import of HK's current settings from HA's config entry, over the
  read path only (``hk_frontend/panel/get``, the one read HK Settings itself makes), written as
  version 1 with the source recorded. Idempotent: a second run changes nothing and says when the
  first one ran. It never writes to HA. CLI ``mantel-server import-settings``; REST
  ``POST /api/settings/import`` (Owner only; Mantel Settings -> Connections offers it).
* ``house/settings`` is stored as HK Frontend stores it, only what differs from the defaults
  (``stored_house``); every reader of the whole shape reads ``merged_house`` / ``house_settings()``.
  ``normalise_house`` rewrites a body stored merged (before 0.1.78) once, at start-up.
* ``seed_home_screen``: a Mantel with no screens and no import gets a generated Home screen
  (``board/dashboard-home``), which an import replaces while it is untouched.
* ``register(app, hub, hooks)``: fills ``app["read_routes"]``, ``app["ws_handlers"]`` and the REST
  routes, like P3.4's connectors. server.py is not touched here; P3.7 wires it.


The package is cut along its seams (docs, store, model, hooks, importing, service, routes); this module
re-exports every name the rest of Mantel and its tests reach as ``settings_store.X``.
"""
from __future__ import annotations

from .docs import (  # noqa: F401
    SCOPES, HOUSE_DOCS, CATALOG_KEYS, HOUSE_SECTIONS, USER_SECTIONS, KEY_RE, HOUSE_PATH, FLAT_KEY, ENTITY,
    HA_ONLY_TOP, PILL_COLORS, CHIP_KINDS, CHIP_TOKEN, CHIP_CARD_MAX, MAX_DOC, MAX_VALUE, MAX_DEPTH,
    MAX_CHANGES, HISTORY_LIMIT, Scope, Doc, Actor, SettingsError, _canon, _stored, _depth, _plain, diff,
    _empty, _Invalid,
)
from .store import (  # noqa: F401
    SettingsStore,
)
from .model import (  # noqa: F401
    NEEDS_MODEL, NEEDS_MODEL_BOARD, _jtype, _like, ThinModel, HkCoreModel, load_model,
)
from .hooks import (  # noqa: F401
    _resolve, deny_configure, SettingsHooks, _sides, actor_of, feature_for, rbac_may_configure,
    SETTINGS_SAVES, MANTEL_SAVES, HA_WRITES, FEATURE_SAVES, NOT_YET, SAVE_KINDS, REFUSALS, WRITE_KEYS, READS,
)
from .importing import (  # noqa: F401
    IMPORT_READ, _READ_ONLY_BOARD, as_stored, stored_of, docs_from_panel, HOME_SCREEN, GENERATED,
    NO_HK_FRONTEND, seed_home_screen, _untouched_seed, import_settings, import_cli,
    NORMALISED, merged_house, looks_merged, stored_house, normalise_house, MENUS_PER_SETTING, menus_per_setting,
)
from .service import (  # noqa: F401
    _slug, SettingsService,
)
from .routes import (  # noqa: F401
    _error, register, KINDS_COOLDOWN_S, _watch_kinds,
)
