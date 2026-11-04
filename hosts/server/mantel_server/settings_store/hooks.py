"""What a save asks and is classified by: ``SettingsHooks``, who may configure, and the tables of HK's save types (``SETTINGS_SAVES``, ``FEATURE_SAVES``, ``SAVE_KINDS``, ``HA_WRITES`` ...)."""
from __future__ import annotations

import inspect
import time
from typing import Any, Awaitable, Callable, Mapping
from dataclasses import dataclass

from .. import accessories as ACC
from .docs import Actor, Scope

# ---------------------------------------------------------------------------------------- hooks
async def _resolve(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def deny_configure(identity: Any, scope: Scope) -> bool:
    return False


@dataclass(frozen=True)
class SettingsHooks:
    """may_configure(identity, Scope) -> bool (may be async): may this subject save this document?
    Exactly ``True`` allows; anything else refuses. Deny by default.
    fetch_ha_settings() -> awaitable HA ``hk_frontend/panel/get`` answer, for the import (default:
    the hub's ReadProxy).
    read_ha({"type": ...}) -> awaitable answer of one of HA's server-only reads, for the feature items
    the import brings over too (default: the hub's ReadProxy.read_server, only when fetch_ha_settings
    is the default too, so both come from the same Home Assistant)."""
    may_configure: Callable[[Any, Scope], bool | Awaitable[bool]] = deny_configure
    fetch_ha_settings: Callable[[], Awaitable[Any]] | None = None
    read_ha: Callable[[dict], Awaitable[Any]] | None = None

    @classmethod
    def coerce(cls, hooks: Any) -> "SettingsHooks":
        if hooks is None:
            return cls()
        if isinstance(hooks, cls):
            return hooks
        if isinstance(hooks, Mapping):
            return cls(**{k: v for k, v in hooks.items() if k in ("may_configure", "fetch_ha_settings", "read_ha")})
        return cls(may_configure=getattr(hooks, "may_configure", deny_configure),
                   fetch_ha_settings=getattr(hooks, "fetch_ha_settings", None),
                   read_ha=getattr(hooks, "read_ha", None))

    def feature_reader(self, proxy: Any) -> Callable[[dict], Awaitable[Any]] | None:
        """What the import reads the feature items with (see read_ha)."""
        if self.read_ha is not None:
            return self.read_ha
        return getattr(proxy, "read_server", None) if self.fetch_ha_settings is None else None


def _sides(identity: Any) -> tuple[str | None, str | None, str | None, str | None, str, float | None]:
    """(user_id, user_role, device_id, device_role, door, fresh_factor_at) from a P3.1 Identity or a dict."""
    if identity is None:
        return None, None, None, None, "lan", None
    if isinstance(identity, Mapping):
        return (identity.get("user_id"), identity.get("role") or identity.get("user_role"), identity.get("device_id"),
                identity.get("device_role"), identity.get("door") or "lan", identity.get("fresh_factor_at"))
    user, device = getattr(identity, "user", None), getattr(identity, "device", None)
    return (getattr(user, "id", None), getattr(user, "role", None), getattr(device, "id", None),
            getattr(device, "role", None), getattr(identity, "door", "lan") or "lan",
            getattr(identity, "fresh_factor_at", None))


def actor_of(identity: Any, label: str | None = None) -> Actor:
    uid, urole, did, _drole, _door, _fresh = _sides(identity)
    via = getattr(identity, "via", None) if not isinstance(identity, Mapping) else identity.get("via")
    return Actor(user_id=uid, role=urole, device_id=did, label=label, via=via if isinstance(via, str) else None)


def feature_for(identity: Any, scope: Scope) -> str:
    """RBAC feature of a save: a person's OWN user scope is ``profile``; everything else ``settings``."""
    uid = _sides(identity)[0]
    return "profile" if scope.kind == "user" and uid is not None and scope.key == uid else "settings"


def rbac_may_configure(policy: Any = None, *, rbac_store: Any = None,
                       clock: Callable[[], float] = time.time) -> Callable[[Any, Scope], bool]:
    """The ``may_configure`` hook over P3.2's engine: ``configure`` on feature ``settings`` (house,
    screens, tablets, someone else's user scope) or ``profile`` (your own). With the default roles:
    Owner and Admin may save everything; Adult and Child only their own user scope; Guest, Wall
    Tablet and Service nothing. ``policy`` is a Policy or a callable returning one (default: the
    RbacStore's stored policy, else the default roles)."""
    from .. import rbac

    def current_policy() -> Any:
        if callable(policy):
            return policy()
        if policy is not None:
            return policy
        if rbac_store is not None:
            return rbac_store.policy()
        return rbac.Policy.build()

    def may(identity: Any, scope: Scope) -> bool:
        if getattr(identity, "valid", True) is False:      # a principal whose session or device ended (Authz.refresh)
            return False
        uid, urole, did, drole, door, fresh = _sides(identity)
        if uid is None and urole is None and did is None and drole is None:
            return False
        kw = dict(user_role=urole, user_id=uid, device_role=drole, device_id=did,
                  door=door if door in ("lan", "tunnel") else "tunnel", fresh_factor_at=fresh)
        subject = rbac_store.subject(**kw) if rbac_store is not None else rbac.Subject(**kw)
        decision = current_policy().decide(subject, "configure", None, rbac.Context(now=clock()),
                                           feature=feature_for(identity, scope))
        return decision.allowed is True
    return may


# -------------------------------------------------------------------------------------- service
# Every write type the shared frontend has (web/client/hk-client.js WRITES), and what Mantel does
# with it. "settings": saved here. "ha_write": it changes Home Assistant (refused: house commands are
# disabled, and this store never sends anything to HA). "not_yet": HK data Mantel does not hold yet.
SETTINGS_SAVES = frozenset({
    "hk_frontend/settings/set", "hk_frontend/board/set", "hk_frontend/tablet/set", "hk_frontend/setup/done",
    "hk_frontend/calendar/color", "hk_frontend/chip/save", "hk_frontend/chip/remove",
    # accessories, favorites and Hidden Accessories (accessories.py, hidden.py): Mantel's since HK Frontend can go
    "hk_frontend/accessory/into", "hk_frontend/accessory/order", "hk_frontend/accessory/page_order",
    "hk_frontend/accessory/room_scenes", "hk_frontend/accessory/set", "hk_frontend/board/favorite",
    "hk_frontend/hidden/also", "hk_frontend/hidden/set",
    # Wall Tablets' Add and Remove (a tablet is Mantel's document), and a screen's title (Mantel's screens)
    "hk_frontend/tablet/add", "hk_frontend/tablet/remove", "hk_frontend/dashboard/titled",
})
MANTEL_SAVES = frozenset({"mantel/settings/user/set", "mantel/settings/restore"})
HA_WRITES = frozenset({
    "call_service", "calendar/event/create", "calendar/event/delete", "calendar/event/update",
    "config/entity_registry/update", "config_entries/subentries/delete", "frontend/set_user_data", "image/delete",
    "input_select/create", "lovelace/config/save", "lovelace/dashboards/create", "lovelace/dashboards/delete",
    "lovelace/dashboards/update",
    # the page never sends these to HA on Mantel: mantel-client.js answers them with Mantel's own frames
    # (tablet_act, tablets_restart, screen_report) or locally (tablet/seen: Mantel enrols tablets itself)
    "hk_frontend/tablet/act",        # wakes / sleeps / restarts a tablet, fixes its kiosk's screensaver
    "hk_frontend/screensaver/black", "hk_frontend/screensaver/touch",   # a tablet's switches
    "hk_frontend/tablet/seen",       # a tablet reports itself to HA's tablets engine
    "hk_frontend/talk/live",         # doorbell talk-back
    "hk_music/queue_play", "hk_tv/watching", "hk_music/used",
})
# HK Settings -> Features saves Mantel takes (feature_pages.SAVES): checked by the shared checks and stored
# in Mantel's feature settings (house/mantel_features, audited), never sent to HA. Notifications' test is
# here too: Mantel's own delivery to its screens, nothing reaches the house.
FEATURE_SAVES = frozenset({
    "hk_notify/settings/set", "hk_notify/item/save", "hk_notify/item/remove", "hk_notify/test",
    "hk_clean_areas/settings/set", "hk_energy/settings/set", "hk_energy/device/set", "hk_energy/device/section",
    "hk_tv/settings/set",
    # Music's settings (house/music, music.py) and the Alarm PIN's (alarm_pin.py's table): Mantel's own
    "hk_music/settings/set", "hk_music/item/remove", "hk_music/playlist/save", "hk_music/playlists/order",
    "hk_music/preset/save",
    "hk_alarm_pin/settings/set", "hk_alarm_pin/add", "hk_alarm_pin/remove",
    # Add and Remove each feature on Mantel itself (feature_pages.feature_set)
    "hk_notify/feature/set", "hk_clean_areas/feature/set", "hk_energy/feature/set", "hk_tv/feature/set",
    "hk_music/feature/set", "hk_alarm_pin/feature/set",
    # Turn Features On Automatically (Advanced -> Features; feature_pages.auto_set): Mantel's own
    "mantel/features/auto/set",
})
NOT_YET = frozenset({
    # Mute 1 Hour: the page sends it as Mantel's own notify_mute (mantel-client.js), never as a save
    "hk_notify/mute",
})
SAVE_KINDS: dict[str, str] = {**{t: "settings" for t in SETTINGS_SAVES | MANTEL_SAVES},
                              **{t: "ha_write" for t in HA_WRITES}, **{t: "not_yet" for t in NOT_YET},
                              **{t: "feature" for t in FEATURE_SAVES}}
REFUSALS = {
    "ha_write": "This save changes Home Assistant. Mantel's house commands are disabled, and the settings "
                "store never sends anything to Home Assistant.",
    "not_yet": "Mantel does not hold this part of HK's data yet; it is still saved in Home Assistant.",
}
WRITE_KEYS = {  # what each save may carry besides "type" (and the page's "id"), as HA's schemas say
    "hk_frontend/settings/set": ({"changes"}, {"expect_version"}),   # Edit mode: panel/get's versions["house"]
    "hk_frontend/board/set": ({"dashboard", "changes"}, {"expect_version"}),   # SET-7: panel/get's versions["board/…"]
    "hk_frontend/tablet/set": ({"tablet", "changes"}, set()),
    "hk_frontend/setup/done": ({"done"}, set()),
    "hk_frontend/calendar/color": ({"key"}, {"color"}),
    "hk_frontend/chip/save": ({"name", "card"}, {"key", "after"}),
    "hk_frontend/chip/remove": ({"key"}, set()),
    "mantel/settings/user/set": ({"changes"}, {"user_id"}),
    "mantel/settings/restore": ({"scope", "key", "version"}, set()),
    # Edit mode: the four layout saves may carry panel/get's versions["accessories"] (service._acc_change)
    "hk_frontend/accessory/set": ({"entity_id"}, set(ACC.FIELDS) | {"screen", "expect_version"}),
    "hk_frontend/accessory/order": ({"area_id", "entities"}, {"expect_version"}),
    "hk_frontend/accessory/into": ({"area_id", "into"}, set()),
    "hk_frontend/accessory/page_order": ({"page", "entities"}, {"expect_version"}),
    "hk_frontend/accessory/room_scenes": ({"area_id", "entities"}, {"expect_version"}),
    "hk_frontend/board/favorite": ({"dashboard", "entity_id", "favorite"}, set()),
    "hk_frontend/hidden/set": ({"entity_ids", "everywhere"}, {"places"}),
    "hk_frontend/hidden/also": ({"entity_ids", "kinds"}, set()),
    "hk_frontend/tablet/add": ({"tablet"}, set()),
    "hk_frontend/tablet/remove": ({"tablet"}, set()),
    "hk_frontend/dashboard/titled": ({"dashboard"}, set()),
}
READS = ("hk_frontend/settings/subscribe", "hk_frontend/panel/get", "hk_frontend/grid/starter",
         "mantel/settings/get", "mantel/settings/history")
