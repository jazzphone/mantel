"""Area/device/entity registry index: which entities live in which area, and friendly names."""
from __future__ import annotations


class Registry:
    def __init__(self) -> None:
        self.areas: dict[str, str] = {}  # area_id -> name
        self.entity_area: dict[str, str | None] = {}  # entity_id -> area_id
        self.by_area: dict[str, set[str]] = {}

    def load(self, areas: list[dict], devices: list[dict], entities: list[dict]) -> None:
        self.areas = {a["area_id"]: a.get("name") or a["area_id"] for a in areas}
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

    def resolve_area(self, ref: str) -> str | None:
        """Accept an area id or (case-insensitive) area name."""
        if ref in self.areas:
            return ref
        low = ref.lower()
        for area_id, name in self.areas.items():
            if name.lower() == low:
                return area_id
        return None

    def entities_in(self, areas: list[str]) -> set[str]:
        out: set[str] = set()
        for ref in areas:
            area_id = self.resolve_area(ref)
            if area_id:
                out |= self.by_area.get(area_id, set())
        return out
