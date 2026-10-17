from mantel_server.state import StateStore, normalize, patch

INITIAL = {"a": {
    "light.a": {"s": "on", "a": {"brightness": 100, "friendly_name": "A"}, "c": "ctx", "lc": 10.0, "lu": 11.0},
    "sensor.t": {"s": "20", "a": {"unit_of_measurement": "C"}, "c": {"id": "x"}, "lc": 5.0},
}}


def test_initial_normalizes_missing_lu_and_drops_context():
    st = StateStore()
    st.replace_all(INITIAL)
    assert st.states["sensor.t"] == {"s": "20", "a": {"unit_of_measurement": "C"}, "lc": 5.0, "lu": 5.0}
    assert "c" not in st.states["light.a"]


def test_state_change_updates_lc_and_lu_together():
    old = normalize(INITIAL["a"]["light.a"])
    new = patch(old, {"+": {"s": "off", "lc": 20.0}})
    assert (new["s"], new["lc"], new["lu"]) == ("off", 20.0, 20.0)


def test_attribute_only_change_keeps_lc():
    old = normalize(INITIAL["a"]["light.a"])
    new = patch(old, {"+": {"a": {"brightness": 50}, "lu": 30.0}})
    assert new["a"] == {"brightness": 50, "friendly_name": "A"}
    assert (new["lc"], new["lu"]) == (10.0, 30.0)


def test_attribute_removal():
    old = normalize(INITIAL["a"]["light.a"])
    new = patch(old, {"-": {"a": ["brightness", "missing_key"]}})
    assert new["a"] == {"friendly_name": "A"}


def test_patch_never_mutates_the_old_state():
    old = normalize(INITIAL["a"]["light.a"])
    snapshot = {"s": old["s"], "a": dict(old["a"]), "lc": old["lc"], "lu": old["lu"]}
    patch(old, {"+": {"s": "off", "a": {"brightness": 1}}, "-": {"a": ["friendly_name"]}})
    assert old == snapshot


def test_event_with_add_change_remove():
    st = StateStore()
    st.replace_all(INITIAL)
    touched = st.apply_event({
        "a": {"switch.n": {"s": "on", "a": {}, "lc": 1.0}},
        "c": {"light.a": {"+": {"s": "off", "lc": 40.0}}},
        "r": ["sensor.t"],
    })
    assert touched == {"switch.n", "light.a", "sensor.t"}
    assert "sensor.t" not in st.states
    assert st.states["light.a"]["s"] == "off"


def test_diff_for_unknown_entity_is_ignored():
    st = StateStore()
    assert st.apply_event({"c": {"light.ghost": {"+": {"s": "on"}}}}) == set()
    assert st.states == {}


def test_replace_all_reports_entities_that_vanished():
    st = StateStore()
    st.replace_all(INITIAL)
    touched = st.replace_all({"a": {"light.a": {"s": "on", "a": {}, "lc": 1.0}}})
    assert "sensor.t" in touched and "sensor.t" not in st.states
