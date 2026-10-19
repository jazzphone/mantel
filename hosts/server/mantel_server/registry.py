"""Area/device/entity registry index: which entities live in which area, and friendly names."""
from __future__ import annotations


class Registry:
    def __init__(self) -> None:
        self._areas: list[dict] = []
        self._devices: list[dict] = []
        self._entities: list[dict] = []
        self._floors: list[dict] = []
        self.areas: dict[str, str] = {}  # area_id -> name
        self.entity_area: dict[str, str | None] = {}  # entity_id -> area_id
        self.by_area: dict[str, set[str]] = {}
        self.entries: dict[str, dict] = {}  # entity_id -> its registry entry (device_class lookups)
        self.area_floor: dict[str, str | None] = {}  # area_id -> floor_id
        self.floors: dict[str, str] = {}  # floor_id -> name

    def update(self, areas: list[dict] | None = None, devices: list[dict] | None = None,
               entities: list[dict] | None = None, floors: list[dict] | None = None) -> None:
        """Replace whichever registries were reloaded; keep the others as they were."""
        self.load(self._areas if areas is None else areas,
                  self._devices if devices is None else devices,
                  self._entities if entities is None else entities,
                  self._floors if floors is None else floors)

    def load(self, areas: list[dict], devices: list[dict], entities: list[dict],
             floors: list[dict] | None = None) -> None:
        self._areas, self._devices, self._entities = areas, devices, entities
        self._floors = floors or []
        self.areas = {a["area_id"]: a.get("name") or a["area_id"] for a in areas}
        self.area_floor = {a["area_id"]: a.get("floor_id") for a in areas}
        self.floors = {f["floor_id"]: f.get("name") or f["floor_id"] for f in self._floors}
        self.entries = {e["entity_id"]: e for e in entities}
        device_area = {d["id"]: d.get("area_id") for d in devices}
        entity_area: dict[str, str | None] = {}
        for e in entities:
            area = e.get("area_id") or device_area.get(e.get("device_id"))
            entity_area[e["entity_id"]] = area
        self.entity_area = entity_area
        by_area: dict[str, set[str]] = {}
        for eid, area in entity_area.items():
            if area:
                by_area.setdefault(area, set()).add(eid)
        self.by_area = by_area

    # the registries as HA's list calls returned them (read-only views for MantelHouse, house.py)
    @property
    def area_entries(self) -> list[dict]:
        return self._areas

    @property
    def device_entries(self) -> list[dict]:
        return self._devices

    @property
    def entity_entries(self) -> list[dict]:
        return self._entities

    @property
    def floor_entries(self) -> list[dict]:
        return self._floors

    def resolve_area(self, ref: str) -> str | None:
        """Accept an area id or (case-insensitive) area name."""
        if ref in self.areas:
            return ref
        low = ref.lower()
        for area_id, name in self.areas.items():
            if name.lower() == low:
                return area_id
        return None

    def resolve_floor(self, ref: str) -> str | None:
        """Accept a floor id or (case-insensitive) floor name."""
        if ref in self.floors:
            return ref
        low = ref.lower()
        for floor_id, name in self.floors.items():
            if name.lower() == low:
                return floor_id
        return None

    def entities_in(self, areas: list[str]) -> set[str]:
        out: set[str] = set()
        for ref in areas:
            area_id = self.resolve_area(ref)
            if area_id:
                out |= self.by_area.get(area_id, set())
        return out

    def frontend_shapes(self) -> dict:
        """The four registries as Home Assistant's frontend holds them (hass.entities / devices /
        areas / floors), for the page's hass shim. Disabled entities are left out, as HA does."""
        entities = {}
        for e in self._entities:
            if e.get("disabled_by"):
                continue
            entities[e["entity_id"]] = {
                "entity_id": e["entity_id"], "device_id": e.get("device_id"), "area_id": e.get("area_id"),
                # Mantel Link's entities (decision 28) are the ones HK Frontend had: HK's pages know them by
                # HK Frontend's platform (its Cameras page leaves Live TV's channels out by it)
                "platform": "hk_frontend" if e.get("platform") == "mantel" else e.get("platform"),
                "entity_category": e.get("entity_category"),
                "hidden": bool(e.get("hidden_by")), "labels": e.get("labels") or [],
                "name": e.get("name"), "translation_key": e.get("translation_key"),
                "display_precision": (e.get("options") or {}).get("sensor", {}).get("display_precision"),
            }
        devices = {d["id"]: d for d in self._devices if not d.get("disabled_by")}
        areas = {a["area_id"]: a for a in self._areas}
        floors = {f["floor_id"]: f for f in self._floors}
        return {"entities": entities, "devices": devices, "areas": areas, "floors": floors}
