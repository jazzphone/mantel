"""THE HOUSE PORT, MANTEL SERVER'S SIDE (hk_core/house.py; PLAN §0 plan review, item 1 (c)).

Shared feature logic in ``hk_core`` asks the house through this, exactly as it asks Home
Assistant's through ``hosts/ha/.../house.py`` (``HaHouse``, the model followed here):

* **reads** come from the hub's own copies: the ``StateStore`` (every HA state, kept current from
  ``subscribe_entities``) and the ``Registry`` (HA's area / device / entity / floor list calls, as
  returned). Every view is a plain frozen copy (``hk_core.house.State`` / ``Entity`` / ``Device`` /
  ``Floor``), so feature code never holds or changes the hub's data.
* **local_time** is in the house's time zone: HA's ``get_config`` zone once read (``Authz.tz``),
  ``cfg.house_tz`` until then (the caller passes the zone as a callable).
* **call_service** (and **service_response**, a call that answers: ``todo.get_items``) never talks to Home
  Assistant itself: it hands the call to ``caller`` -- in the
  server, ``features.FeatureCaller``, which sends it THROUGH THE COMMAND GATEWAY (RBAC, the audit
  row first, ``cfg.commands_enabled``), as the server's own Service actor or, when ``context`` is a
  person's ``Principal``, as that person. With no caller (or commands off) it raises
  ``HouseCommandsDisabled``; a refusal raises ``HouseCommandRefused`` with the gateway's code.

Same semantics as ``HaHouse``, with the differences HA's wire format forces (each pinned by
``tests/test_mantel_house.py``):

* ``State.last_changed`` is HA's ``lc`` (epoch seconds) as an aware UTC datetime; contexts are not
  kept (the StateStore drops them), so a host cannot tell a person's change from the house's.
* ``Entity`` fields come from ``config/entity_registry/list``. That list carries ``options``,
  ``platform``, ``entity_category``, ``disabled_by`` and ``hidden_by`` but not ``supported_features``,
  ``device_class`` or ``original_device_class`` (only the per-entity ``get`` does): those read None
  unless the registry entry has them. Feature code reads a state's attributes first for all three.
* ``area_name`` falls back to the area id when an area has no name (the Registry's own rule).
* ``camera_links`` (added 2026-11-02, the cameras' phase 6) answers the sensors linked to Mantel's direct cameras,
  from ``links`` (the server passes ``cameras_direct``'s); Home Assistant's House answers {}.
"""
from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from typing import Any, Awaitable
from zoneinfo import ZoneInfo

from hk_core.house import Device, Entity, Floor, State


class HouseCommandRefused(Exception):
    """A service call the gateway refused (``code``: forbidden, unavailable, ...)."""

    def __init__(self, code: str, message: str = "", audit_id: int | None = None) -> None:
        super().__init__(message or code)
        self.code, self.audit_id = code, audit_id


class HouseCommandsDisabled(HouseCommandRefused):
    """House commands are off on this server (``cfg.commands_enabled``): nothing was sent."""

    def __init__(self, message: str = "house commands are disabled on this Mantel Server; nothing was sent",
                 audit_id: int | None = None) -> None:
        super().__init__("commands_disabled", message, audit_id)


Caller = Callable[[str, str, Mapping[str, Any], Any], Awaitable[Any]]


def _when(v: Any) -> datetime | None:
    """HA's ``lc``/``lu`` (epoch seconds; an ISO string is accepted too) as an aware datetime."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(float(v), timezone.utc)
    if isinstance(v, str):
        try:
            d = datetime.fromisoformat(v)
        except ValueError:
            return None
        return d if d.tzinfo is not None else d.replace(tzinfo=timezone.utc)
    return None


def state_view(entity_id: str, raw: Mapping[str, Any] | None) -> State | None:
    """A StateStore entry ({s, a, lc, lu}) as the port's plain view (None stays None)."""
    if raw is None:
        return None
    s = raw.get("s")
    return State(entity_id, "unknown" if s is None else str(s), dict(raw.get("a") or {}), _when(raw.get("lc")))


def entity_view(e: Mapping[str, Any] | None) -> Entity | None:
    """An entity registry entry (HA's list shape) as the port's plain view."""
    if e is None:
        return None
    cat = e.get("entity_category")
    sf = e.get("supported_features")
    return Entity(entity_id=e["entity_id"], area_id=e.get("area_id"), device_id=e.get("device_id"),
                  options=dict(e.get("options") or {}),
                  supported_features=int(sf) if isinstance(sf, int) and not isinstance(sf, bool) else None,
                  disabled=e.get("disabled_by") is not None, hidden=e.get("hidden_by") is not None,
                  entity_category=str(cat) if cat else None, platform=e.get("platform"),
                  device_class=e.get("device_class"), original_device_class=e.get("original_device_class"))


def accessory_names(store: Any) -> Callable[[], Mapping[str, Any] | None]:
    """The reader for MantelHouse's ``accessories``: the stored ``house/accessories`` document, parsed again only
    when its version moved (one cheap query per read, so a rename reaches the very next notification)."""
    seen: list[Any] = [None, None]                      # [version, body]

    def read() -> Mapping[str, Any] | None:
        version = store.version("house", "accessories")
        if version != seen[0]:
            seen[:] = [version, store.body("house", "accessories") if version is not None else None]
        return seen[1]
    return read


class MantelHouse:
    """``hk_core.house.House`` over the hub's StateStore and Registry (see the module docstring)."""

    def __init__(self, store, registry, *, tz: Callable[[], str] | str = "UTC", caller: Caller | None = None,
                 now: Callable[[], datetime] | None = None,
                 links: Callable[[], Mapping[str, tuple[str, str]]] | None = None,
                 accessories: Callable[[], Mapping[str, Any] | None] | None = None) -> None:
        self._store = store
        self._accessories = accessories
        self._registry = registry
        self._links = links
        self._tz = tz if callable(tz) else (lambda: tz)
        self.caller = caller
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._index_key: tuple | None = None
        self._devices: dict[str, Mapping[str, Any]] = {}
        self._by_device: dict[str, list[Mapping[str, Any]]] = {}
        self._floors: dict[str, Mapping[str, Any]] = {}

    # -- the registries' indexes, rebuilt only when a registry was reloaded (its list replaced) -----
    def _index(self) -> None:
        reg = self._registry
        # every load counts (Registry.loads): the lists' ids alone can repeat once a replaced list is freed
        key = (getattr(reg, "loads", None), id(reg.device_entries), id(reg.entity_entries), id(reg.floor_entries))
        if key == self._index_key:
            return
        self._devices = {d["id"]: d for d in reg.device_entries if isinstance(d, Mapping) and d.get("id")}
        by_dev: dict[str, list[Mapping[str, Any]]] = {}
        for e in reg.entity_entries:
            if e.get("device_id"):
                by_dev.setdefault(e["device_id"], []).append(e)
        self._by_device = by_dev
        self._floors = {f["floor_id"]: f for f in reg.floor_entries if isinstance(f, Mapping) and f.get("floor_id")}
        self._index_key = key

    # -- states ------------------------------------------------------------------------------------
    def state(self, entity_id: str) -> State | None:
        return state_view(entity_id, self._store.states.get(entity_id))

    def states(self, domain: str | None = None) -> list[State]:
        prefix = None if domain is None else domain + "."
        return [state_view(eid, raw) for eid, raw in list(self._store.states.items())
                if prefix is None or eid.startswith(prefix)]

    # -- registries --------------------------------------------------------------------------------
    def entity(self, entity_id: str) -> Entity | None:
        return entity_view(self._registry.entries.get(entity_id))

    def entities(self, domain: str | None = None) -> list[Entity]:
        prefix = None if domain is None else domain + "."
        return [entity_view(e) for e in self._registry.entity_entries
                if prefix is None or e["entity_id"].startswith(prefix)]

    def device(self, device_id: str) -> Device | None:
        self._index()
        d = self._devices.get(device_id)
        return Device(d["id"], d.get("area_id"), d.get("name_by_user") or d.get("name")) if d else None

    def device_entities(self, device_id: str) -> list[Entity]:
        self._index()
        return [entity_view(e) for e in self._by_device.get(device_id, [])]

    def camera_links(self) -> dict[str, tuple[str, str]]:
        """The sensors linked to Mantel's direct cameras (cameras_direct.DirectCameras.sensor_links): a direct
        camera has no Home Assistant device to carry its motion, person and doorbell sensors, so the notification
        rules read them here instead (hk_core/notifications/accessories.py). {} where Mantel has no direct cameras."""
        got = self._links() if self._links is not None else None
        return dict(got) if got else {}

    def accessory_name(self, entity_id: str) -> str | None:
        """The name HK Settings -> Accessories gives it (``accessories``: the stored house/accessories document,
        read each time, so a rename reaches the next notification); None with no such document or name."""
        from hk_core.settings.accessory_fields import name_override
        got = self._accessories() if self._accessories is not None else None
        return name_override(got, entity_id)

    def area_ids(self) -> set[str]:
        return set(self._registry.areas)

    def area_name(self, area_id: str) -> str | None:
        return self._registry.areas.get(area_id)

    def area_floor(self, area_id: str) -> Floor | None:
        self._index()
        fid = self._registry.area_floor.get(area_id)
        f = self._floors.get(fid) if fid else None
        if f is None:
            return None
        level = f.get("level")
        return Floor(f["floor_id"], f.get("name") or f["floor_id"],
                     int(level) if isinstance(level, int) and not isinstance(level, bool) else None)

    # -- time --------------------------------------------------------------------------------------
    def tz(self) -> ZoneInfo:
        try:
            return ZoneInfo(self._tz() or "UTC")
        except Exception:  # noqa: BLE001 -- an unknown zone name: UTC rather than a crash in feature code
            return ZoneInfo("UTC")

    def local_time(self, when: datetime | None = None) -> datetime:
        zone = self.tz()
        when = when or self._now()
        if when.tzinfo is None:
            when = when.replace(tzinfo=zone)
        return when.astimezone(zone)

    # -- services ----------------------------------------------------------------------------------
    async def call_service(self, domain: str, service: str, data: Mapping[str, Any],
                           *, context: Any = None) -> None:
        if self.caller is None:
            raise HouseCommandsDisabled()
        await self.caller(domain, service, dict(data), context)

    async def service_response(self, domain: str, service: str, data: Mapping[str, Any],
                               *, context: Any = None) -> Mapping[str, Any]:
        """A service that answers (``todo.get_items``), through the same caller as any call -- the command
        gateway, audited, as the person in ``context`` -- with the answer asked for (``return_response``)."""
        if self.caller is None:
            raise HouseCommandsDisabled()
        got = await self.caller(domain, service, dict(data), context, response=True)
        resp = got.get("response") if isinstance(got, Mapping) else None
        return dict(resp) if isinstance(resp, Mapping) else {}
