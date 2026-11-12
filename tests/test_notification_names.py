"""A notification names an accessory as Mantel does: the name given in HK Settings -> Accessories (the cards' name),
not Home Assistant's friendly name -- in the banner, the settings lists, and after a rename made once a rule existed.
(Owner, 2026-11-11: "It doesn't look like Notifications recognize name changes of Devices/Entities in Mantel.")"""
from hk_core.house import State
from hk_core.notifications import accessories as A, banner as B, settings as P
from hk_core.settings.accessory_fields import name_override
from mantel_house_fakes import mantel_house_of
from test_hk_core_notifications import FakeHouse, house


def _named(names):
    """The notifications' fictional house, with a Mantel name for some accessories ({entity: name})."""
    class Named(FakeHouse):
        def accessory_name(self, entity_id):
            return names.get(entity_id)
    base = house()
    return Named(states=list(base._states.values()), entities=list(base._entities.values()),
                 devices=list(base._devices.values()), areas=base._areas)


def test_the_cards_rule_in_python():
    acc = {"entities": {"cover.garage_door": {"name": " Entry Door ", "names": {"wall": "Garage"}}, "light.x": {"icon": "mdi:a"}}}
    assert name_override(acc, "cover.garage_door") == "Entry Door"
    assert name_override(acc, "cover.garage_door", "wall") == "Garage"           # a dashboard's own name wins on it
    assert name_override(acc, "cover.garage_door", "other") == "Entry Door"
    assert name_override(acc, "light.x") is None and name_override(acc, "light.none") is None
    assert name_override(None, "light.x") is None and name_override({"entities": []}, "light.x") is None


def test_a_banner_and_the_settings_lists_use_the_mantel_name():
    h = _named({"cover.garage_door": "Entry Door", "camera.porch_high_resolution_channel": "Gate Camera"})
    assert A.name_of(h, "cover.garage_door") == "Entry Door"
    assert A.name_of(h, "binary_sensor.leak") == "Sink Leak"                     # none given: Home Assistant's
    opts = B.options({"items": [], "stay": 60})
    item = {"id": "g", "entity": "cover.garage_door", "when": "open"}
    p = B.build(h, opts, item, State("cover.garage_door", "open", {"friendly_name": "Garage Door"}))
    assert "Entry Door" in p["title"] + " " + p["message"] and "Garage Door" not in p["title"] + p["message"]
    cam = B.build(h, opts, {"id": "k", "category": "cameras", "snap": True, "tap": "camera"},
                  h.state("binary_sensor.porch_person_detected"), eid="binary_sensor.porch_person_detected")
    assert cam["title"] == "Gate Camera"
    it = P.new_item(h, "cover.garage_door", set())
    page = P.page(h, B.options({"items": [{**it, "when": "closed"}, P.new_category("doors", set())]}), {}, "loaded", lambda: {})
    assert page["items"][0]["name"] == "Entry Door"


def test_a_rename_after_the_rule_was_set_up_reaches_the_next_notification(tmp_path):
    from mantel_server.settings_store import Actor, SettingsStore
    from mantel_server.house import accessory_names
    from mantel_server.storage.db import Database
    store = SettingsStore(Database(tmp_path / "m.db").conn)
    h = mantel_house_of(house())
    h._accessories = accessory_names(store)
    item = {"id": "g", "entity": "cover.garage_door", "when": "open"}      # the rule holds the id, never a name
    opts = B.options({"items": [item]})
    open_ = State("cover.garage_door", "open", {"friendly_name": "Garage Door"})
    assert "Garage Door" in B.build(h, opts, item, open_)["title"]
    store.write([("house", "accessories", {"entities": {"cover.garage_door": {"name": "Entry Door"}}})],
                actor=Actor(label="t"))
    p = B.build(h, opts, item, open_)
    assert "Entry Door" in p["title"] + p["message"] and "Garage Door" not in p["title"] + p["message"]
    store.write([("house", "accessories", {"entities": {}})], actor=Actor(label="t"))
    assert "Garage Door" in B.build(h, opts, item, open_)["title"]
