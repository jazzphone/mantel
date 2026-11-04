"""The House Timeline's pure decisions: what is recorded (classify) and how a row reads (words)."""
import pytest

from hk_core.timeline import classify as C, words as W


def fam(entity_id, dc=None, **kw):
    domain, _, oid = entity_id.partition(".")
    return C.family_of(domain, oid, dc, **kw)


def mem(entity_id, dc=None, label="Thing", **kw):
    kw.setdefault("area", "hall")
    kw.setdefault("camera", None)
    return C.member(entity_id, device_class=dc, label=label, **kw)


# ---- the catalog ----

@pytest.mark.parametrize("entity_id,dc,want", [
    ("binary_sensor.back_door", "door", ("door", None)),
    ("binary_sensor.garage_side", "garage_door", ("door", None)),
    ("binary_sensor.patio", "opening", ("door", None)),
    ("binary_sensor.loft_window", "window", ("window", None)),
    ("binary_sensor.driveway_person_detected", "occupancy", ("detection", "person")),
    ("binary_sensor.driveway_vehicle_detected", None, ("detection", "vehicle")),
    ("binary_sensor.garden_animal_detected", None, ("detection", "animal")),
    ("binary_sensor.porch_package_detected", None, ("detection", "package")),
    ("binary_sensor.front_door_doorbell", None, ("doorbell", None)),
    ("binary_sensor.kitchen_sink", "moisture", ("safety", "leak")),
    ("binary_sensor.hall_smoke", "smoke", ("safety", "smoke")),
    ("binary_sensor.kitchen_gas", "gas", ("safety", "gas")),
    ("binary_sensor.hall_co", "carbon_monoxide", ("safety", "co")),
    ("event.front_door_doorbell", "doorbell", ("doorbell", None)),
    ("event.front_door_doorbell", None, ("doorbell", None)),
    ("event.driveway_person", None, ("detection", "person")),
    ("event.porch_package", None, ("detection", "package")),
    ("lock.back_door", None, ("lock", None)),
    ("valve.water_main", None, ("lock", None)),
    ("cover.garage", "garage", ("garage", None)),
    ("cover.side_gate", "gate", ("garage", None)),
    ("alarm_control_panel.house", None, ("alarm", None)),
    ("person.emma", None, ("arrival", None)),
])
def test_catalog_rows(entity_id, dc, want):
    assert fam(entity_id, dc) == want


@pytest.mark.parametrize("entity_id,dc", [
    ("cover.shade", "shade"), ("cover.blind", None), ("sensor.temperature", "temperature"),
    ("light.kitchen", None), ("media_player.den", None), ("switch.lamp", None), ("camera.driveway", None),
    ("binary_sensor.thing", None), ("binary_sensor.hall", "occupancy"), ("binary_sensor.hall_presence", "presence"),
    ("binary_sensor.garden_cam_motion", "motion"), ("binary_sensor.shed", "moving"),
    ("event.remote_button", None), ("binary_sensor.washer", "problem"),
])
def test_not_recorded(entity_id, dc):
    assert fam(entity_id, dc) is None


def test_motion_only_for_cameras_without_smart_detection():
    assert fam("binary_sensor.garden_cam_motion", "motion", motion_only=True) == ("motion", None)
    assert fam("binary_sensor.shed", "moving", motion_only=True) == ("motion", None)
    assert fam("binary_sensor.hall", "occupancy", motion_only=True) is None
    assert fam("binary_sensor.hall_presence", "presence", motion_only=True) is None


# ---- candidates and members ----

def test_candidate():
    assert C.candidate()
    assert not C.candidate(disabled=True)
    assert not C.candidate(hidden=True)
    assert not C.candidate(entity_category="diagnostic")
    assert not C.candidate(entity_category="config")
    assert not C.candidate(mine=True)


def test_member_basic():
    m = mem("binary_sensor.back_door", "door", label="Back Door", area="yard")
    assert m == C.Member("door", "Back Door", "yard", None, None)
    assert mem("binary_sensor.driveway_person_detected", "occupancy", label="Driveway", camera="camera.driveway") == \
        C.Member("detection", "Driveway", "hall", "camera.driveway", "person")
    assert mem("binary_sensor.kitchen_sink", "moisture", label="Kitchen Sink").detection == "leak"


def test_camera_only_kept_for_camera_families():
    assert mem("lock.back_door", camera="camera.x").camera is None
    assert mem("binary_sensor.front_door_doorbell", camera="camera.front").camera == "camera.front"
    assert mem("binary_sensor.garden_cam_motion", "motion", motion_only=True, camera="camera.garden").camera == \
        "camera.garden"


def test_motion_member_only_when_motion_only():
    assert mem("binary_sensor.garden_cam_motion", "motion") is None
    assert mem("binary_sensor.garden_cam_motion", "motion", motion_only=True).family == "motion"


def test_windows_off_by_default_and_on_with_families():
    assert mem("binary_sensor.loft_window", "window") is None
    assert mem("binary_sensor.loft_window", "window", families={"window": True}).family == "window"
    assert mem("binary_sensor.loft_window", "window", families={"door": False}) is None
    assert C.DEFAULT_ON == set(C.FAMILIES) - {"window"}


def test_family_switched_off():
    assert mem("lock.back_door", families={"lock": False}) is None
    assert mem("lock.back_door", families={"door": False}).family == "lock"


@pytest.mark.parametrize("kw", [{"disabled": True}, {"hidden": True}, {"entity_category": "diagnostic"},
                                {"mine": True}])
def test_skipped_entities(kw):
    assert mem("binary_sensor.back_door", "door", **kw) is None


def test_override_record_false_removes():
    assert mem("binary_sensor.back_door", "door", override={"record": False}) is None


def test_override_record_true_adds_classless_sensor():
    m = mem("binary_sensor.shed_contact", None, label="Shed", override={"record": True, "label": "  Shed Door  "})
    assert m.family == "door" and m.label == "Shed Door"
    m = mem("binary_sensor.shed_contact", None, override={"record": True, "family": "window"})
    assert m.family == "window"          # wins over the window switch being off by default


def test_override_record_true_beats_candidate_and_switch_but_not_disabled():
    assert mem("lock.back_door", hidden=True, override={"record": True}).family == "lock"
    assert mem("lock.back_door", entity_category="diagnostic", override={"record": True}).family == "lock"
    assert mem("lock.back_door", families={"lock": False}, override={"record": True}).family == "lock"
    assert mem("lock.back_door", disabled=True, override={"record": True}) is None


def test_override_family_must_be_entity_backed():
    assert mem("binary_sensor.shed_contact", None, override={"record": True, "family": "system"}).family == "door"
    assert mem("binary_sensor.shed_contact", None, override={"record": True, "family": "bogus"}).family == "door"
    assert mem("sensor.temperature", "temperature", override={"record": True}) is None


def test_override_label():
    assert mem("lock.back_door", label="Lock", override={"label": "x" * 100}).label == "x" * 64
    assert mem("lock.back_door", label="Lock", override={"label": "   "}).label == "Lock"
    assert mem("lock.back_door", label="Lock", override={"label": "Front"}).label == "Front"


def test_override_family_change_drops_detection_word():
    m = mem("binary_sensor.driveway_person_detected", override={"record": True, "family": "door"})
    assert m.family == "door" and m.detection is None


# ---- change ----

@pytest.mark.parametrize("family,domain,old,new,det,want", [
    ("door", "binary_sensor", "off", "on", None, "opened"),
    ("door", "binary_sensor", "on", "off", None, "closed"),
    ("window", "binary_sensor", "off", "on", None, "opened"),
    ("door", "binary_sensor", None, "on", None, "opened"),            # catch-up: from nothing
    ("door", "binary_sensor", "unavailable", "off", None, "closed"),
    ("door", "binary_sensor", "on", "on", None, None),
    ("door", "binary_sensor", "off", "unavailable", None, None),
    ("door", "binary_sensor", "off", "unknown", None, None),
    ("door", "binary_sensor", "off", None, None, None),
    ("door", "binary_sensor", "off", "", None, None),
    ("lock", "lock", "unlocked", "locked", None, "locked"),
    ("lock", "lock", "locked", "unlocked", None, "unlocked"),
    ("lock", "lock", "locked", "open", None, "unlocked"),
    ("lock", "lock", "unlocked", "open", None, None),
    ("lock", "lock", "open", "unlocked", None, None),
    ("lock", "lock", "locked", "jammed", None, "jammed"),
    ("lock", "lock", "locked", "unlocking", None, None),
    ("lock", "lock", "unlocked", "locking", None, None),
    ("lock", "lock", "locked", "opening", None, None),
    ("lock", "lock", None, "locked", None, "locked"),
    ("lock", "valve", "closed", "open", None, "opened"),
    ("lock", "valve", "open", "closed", None, "closed"),
    ("lock", "valve", "open", "closing", None, None),
    ("lock", "valve", "closed", "opening", None, None),
    ("garage", "cover", "closed", "open", None, "opened"),
    ("garage", "cover", "open", "closed", None, "closed"),
    ("garage", "cover", "closed", "opening", None, None),
    ("garage", "cover", "open", "closing", None, None),
    ("garage", "cover", "open", "stopped", None, None),
    ("alarm", "alarm_control_panel", "disarmed", "armed_away", None, "armed_away"),
    ("alarm", "alarm_control_panel", "disarmed", "armed_home", None, "armed_home"),
    ("alarm", "alarm_control_panel", "disarmed", "armed_night", None, "armed_night"),
    ("alarm", "alarm_control_panel", "disarmed", "armed_vacation", None, "armed_vacation"),
    ("alarm", "alarm_control_panel", "disarmed", "armed_custom_bypass", None, "armed_custom_bypass"),
    ("alarm", "alarm_control_panel", "armed_away", "disarmed", None, "disarmed"),
    ("alarm", "alarm_control_panel", "armed_away", "triggered", None, "triggered"),
    ("alarm", "alarm_control_panel", "armed_away", "pending", None, None),
    ("alarm", "alarm_control_panel", "disarmed", "arming", None, None),
    ("alarm", "alarm_control_panel", "armed_away", "disarming", None, None),
    ("arrival", "person", "not_home", "home", None, "arrived"),
    ("arrival", "person", None, "home", None, "arrived"),
    ("arrival", "person", "unavailable", "home", None, "arrived"),
    ("arrival", "person", "home", "not_home", None, "left"),
    ("arrival", "person", "home", "School", None, "left"),
    ("arrival", "person", "School", "Work", None, None),
    ("arrival", "person", None, "not_home", None, None),
    ("arrival", "person", "not_home", "School", None, None),
    ("arrival", "person", "home", "home", None, None),
    ("doorbell", "event", "2026-11-03T10:00:00", "2026-11-03T10:05:00", None, "ring"),
    ("doorbell", "event", None, "2026-11-03T10:05:00", None, None),
    ("doorbell", "event", "unavailable", "2026-11-03T10:05:00", None, None),
    ("doorbell", "event", "2026-11-03T10:00:00", "unavailable", None, None),
    ("doorbell", "event", "2026-11-03T10:00:00", "2026-11-03T10:00:00", None, None),
    ("doorbell", "binary_sensor", "off", "on", None, "ring"),
    ("doorbell", "binary_sensor", "on", "off", None, None),
    ("doorbell", "binary_sensor", None, "on", None, "ring"),
    ("detection", "event", "2026-11-03T10:00:00", "2026-11-03T10:05:00", "person", "person"),
    ("detection", "event", None, "2026-11-03T10:05:00", "person", None),
    ("detection", "event", "unavailable", "2026-11-03T10:05:00", "vehicle", None),
    ("detection", "binary_sensor", "off", "on", "vehicle", "vehicle"),
    ("detection", "binary_sensor", "on", "off", "vehicle", "end"),
    ("detection", "binary_sensor", None, "on", "package", "package"),
    ("motion", "binary_sensor", "off", "on", None, "motion"),
    ("motion", "binary_sensor", "on", "off", None, "end"),
    ("safety", "binary_sensor", "off", "on", "leak", "leak"),
    ("safety", "binary_sensor", "off", "on", "smoke", "smoke"),
    ("safety", "binary_sensor", "off", "on", "co", "co"),
    ("safety", "binary_sensor", "off", "on", "gas", "gas"),
    ("safety", "binary_sensor", "on", "off", "leak", "clear"),
    ("safety", "binary_sensor", "on", "unavailable", "leak", None),
])
def test_change(family, domain, old, new, det, want):
    assert C.change(family, domain, old, new, detection=det) == want


def test_level():
    assert C.level("lock", "jammed") == "warning"
    assert C.level("alarm", "triggered") == "warning"
    for word in ("leak", "smoke", "co", "gas"):
        assert C.level("safety", word) == "warning"
    assert C.level("safety", "clear") == "info"
    assert C.level("lock", "locked") == "info"
    assert C.level("alarm", "disarmed") == "info"
    assert C.level("door", "opened") == "info"
    assert C.level("detection", "person") == "info"


def test_constants():
    assert set(C.WALL_FAMILIES) <= set(C.FAMILIES)
    assert C.MANAGER_ONLY == {"system", "refused"}
    assert C.CAMERA_FAMILIES == {"doorbell", "detection", "motion"}


# ---- titles ----

@pytest.mark.parametrize("family,kind,label,facts,want", [
    ("door", "opened", "Back Door", None, "Back Door opened"),
    ("door", "closed", "Back Door", None, "Back Door closed"),
    ("window", "opened", "Loft Window", None, "Loft Window opened"),
    ("lock", "unlocked", "Back Door", None, "Back Door unlocked"),
    ("lock", "locked", "Back Door", None, "Back Door locked"),
    ("lock", "jammed", "Back Door", None, "Back Door is jammed"),
    ("lock", "opened", "Water Main", None, "Water Main opened"),
    ("lock", "closed", "Water Main", None, "Water Main closed"),
    ("garage", "opened", "Garage", None, "Garage opened"),
    ("garage", "closed", "Garage", None, "Garage closed"),
    ("alarm", "armed_away", "", None, "Alarm armed away"),
    ("alarm", "armed_home", "", None, "Alarm armed home"),
    ("alarm", "armed_night", "", None, "Alarm armed night"),
    ("alarm", "armed_vacation", "", None, "Alarm armed vacation"),
    ("alarm", "armed_custom_bypass", "", None, "Alarm armed (custom bypass)"),
    ("alarm", "disarmed", "", None, "Alarm disarmed"),
    ("alarm", "triggered", "", None, "Alarm triggered"),
    ("alarm", "armed_away", "House Alarm", None, "House Alarm armed away"),
    ("arrival", "arrived", "Emma", None, "Emma arrived home"),
    ("arrival", "left", "Emma", None, "Emma left home"),
    ("doorbell", "ring", "Front Door", None, "Someone rang Front Door"),
    ("detection", "person", "Driveway", None, "Person at Driveway"),
    ("detection", "vehicle", "Driveway", None, "Vehicle at Driveway"),
    ("detection", "animal", "Garden", None, "Animal at Garden"),
    ("detection", "package", "Front Door", None, "Package at Front Door"),
    ("detection", "package", "Front Door", {"count": 2}, "Package at Front Door"),
    ("motion", "motion", "Garden Cam", None, "Motion at Garden Cam"),
    ("safety", "leak", "Kitchen Sink", None, "Leak at Kitchen Sink"),
    ("safety", "smoke", "Hallway", None, "Smoke at Hallway"),
    ("safety", "co", "Hallway", None, "Carbon monoxide at Hallway"),
    ("safety", "gas", "Kitchen", None, "Gas at Kitchen"),
    ("safety", "clear", "Kitchen Sink", None, "Kitchen Sink is clear"),
    ("door", "flapping", "Back Door", {"count": 14}, "Back Door keeps changing (14 times)"),
    ("lock", "flapping", "Back Door", {"count": 6}, "Back Door keeps changing (6 times)"),
    ("system", "backup", "Backup finished", None, "Backup finished"),
    ("system", "alert", "Home Assistant disconnected", {"late": True}, "Home Assistant disconnected"),
    ("refused", "unlock", "Back Door", {"device": "Hallway"}, "Hallway tablet tried to unlock Back Door; refused"),
    ("refused", "unlock", "Back Door", None, "Tried to unlock Back Door; refused"),
    ("refused", "lock", "Back Door", None, "Tried to lock Back Door; refused"),
    ("refused", "open", "Garage", None, "Tried to open Garage; refused"),
    ("refused", "close", "Garage", {"device": "Hallway"}, "Hallway tablet tried to close Garage; refused"),
    ("refused", "arm", "Alarm", None, "Tried to arm Alarm; refused"),
    ("refused", "disarm", "Alarm", {"device": "Kitchen"}, "Kitchen tablet tried to disarm Alarm; refused"),
    ("door", "opened", "Back Door", {"late": True}, "Back Door opened"),
    ("door", "wobbled", "Back Door", None, "Back Door wobbled"),
    ("bogus", "some_kind", "Thing", None, "Thing some kind"),
])
def test_title(family, kind, label, facts, want):
    assert W.title(family, kind, label, facts) == want


def test_refused_title_never_names_a_person():
    t = W.title("refused", "unlock", "Back Door", {"device": "Hallway", "person": "Mark", "actor_name": "Mark"})
    assert "Mark" not in t


# ---- search words ----

def test_search_words_door():
    s = W.search_words("door", "opened", "Back Door", "Back Yard", "Back Door opened")
    assert s == "back door opened yard"
    assert "back" in s.split() and "yard" in s.split()


def test_search_words_arrival_leaves_the_name_out():
    s = W.search_words("arrival", "arrived", "Emma", "Home Zone", "Emma arrived home")
    assert "emma" not in s and s == "arrived home zone"
    s = W.search_words("arrival", "left", "Anna Smith", None, "Anna Smith left home")
    assert s == "left home"
    assert "anna" not in W.search_words("arrival", "weird", "Anna", None, "Anna did a thing")


def test_search_words_clean_and_capped():
    assert W.search_words("detection", "person", "Driveway", None, "Person at Driveway") == "person at driveway"
    assert W.search_words("window", "opened", "A-B", "Kitchen!", "A-B opened") == "a b opened kitchen"
    long = W.search_words("system", "alert", " ".join(f"word{i}" for i in range(200)), None, "x")
    assert len(long) <= 300 and not long.endswith(" ")
