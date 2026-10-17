from mantel_server.registry import Registry

AREAS = [{"area_id": "kitchen", "name": "Kitchen"}, {"area_id": "loft", "name": "Loft"}]
DEVICES = [{"id": "d1", "area_id": "kitchen"}, {"id": "d2", "area_id": "loft"}]
ENTITIES = [
    {"entity_id": "light.a", "device_id": "d1", "area_id": None},       # via device
    {"entity_id": "light.b", "device_id": "d1", "area_id": "loft"},     # entity override wins
    {"entity_id": "sensor.c", "device_id": None, "area_id": None},      # no area
    {"entity_id": "sensor.d", "device_id": "d2", "area_id": None},
]


def make():
    r = Registry()
    r.load(AREAS, DEVICES, ENTITIES)
    return r


def test_area_comes_from_entity_else_device():
    r = make()
    assert r.entity_area["light.a"] == "kitchen"
    assert r.entity_area["light.b"] == "loft"
    assert r.entity_area["sensor.c"] is None


def test_entities_in_by_id_and_by_name_case_insensitive():
    r = make()
    assert r.entities_in(["kitchen"]) == {"light.a"}
    assert r.entities_in(["LOFT"]) == {"light.b", "sensor.d"}
    assert r.entities_in(["kitchen", "loft"]) == {"light.a", "light.b", "sensor.d"}
    assert r.entities_in(["nowhere"]) == set()
