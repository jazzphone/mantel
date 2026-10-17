from mantel_server.registry import Registry
from mantel_server.state import StateStore
from mantel_server.view import ClientView, Coalescing, diff_state


def st(s="on", a=None, lc=1.0, lu=None):
    return {"s": s, "a": a or {}, "lc": lc, "lu": lc if lu is None else lu}


def setup(coalescing=None, client_min=0.0, states=None):
    store = StateStore()
    store.states = states or {
        "light.a": st("on", {"brightness": 10}),
        "light.b": st("off"),
        "sensor.t": st("20", {"unit": "C"}),
        "sensor.other": st("1"),
    }
    reg = Registry()
    reg.load([{"area_id": "kitchen", "name": "Kitchen"}], [],
             [{"entity_id": "light.a", "area_id": "kitchen"}, {"entity_id": "light.b", "area_id": "kitchen"}])
    return store, reg, ClientView(store, reg, coalescing or Coalescing(), client_min)


def change(store, view, eid, new, now=0.0):
    store.states[eid] = new
    return view.on_change({eid})


def test_snapshot_contains_only_selected_and_reports_missing():
    store, reg, view = setup()
    snap = view.select(["sensor.t", "sensor.nope"], ["kitchen"], 0.0)
    assert set(snap["entities"]) == {"sensor.t", "light.a", "light.b"}
    assert snap["missing"] == ["sensor.nope"]


def test_unselected_entities_never_produce_traffic():
    store, reg, view = setup()
    view.select(["light.a"], [], 0.0)
    assert change(store, view, "sensor.other", st("2")) is False
    assert view.flush(1.0) == (None, None)


def test_diff_has_only_what_changed():
    store, reg, view = setup()
    view.select(["light.a"], [], 0.0)
    change(store, view, "light.a", st("on", {"brightness": 99}, lc=1.0, lu=5.0))
    msg, due = view.flush(1.0)
    assert msg == {"type": "diff", "changes": {"light.a": {"+": {"a": {"brightness": 99}, "lu": 5.0}}}}
    assert due is None


def test_removed_attribute_is_listed():
    store, reg, view = setup()
    view.select(["sensor.t"], [], 0.0)
    change(store, view, "sensor.t", st("20", {}, lc=1.0, lu=2.0))
    msg, _ = view.flush(1.0)
    assert msg["changes"]["sensor.t"]["-"] == {"a": ["unit"]}


def test_first_change_is_immediate_then_coalesced_then_trailing_edge():
    store, reg, view = setup(Coalescing(default=5.0))
    view.select(["sensor.t"], [], 0.0)           # snapshot at t=0 counts as a send
    change(store, view, "sensor.t", st("21", lc=1.0))
    msg, due = view.flush(1.0)
    assert msg is None and due == 5.0              # too soon: held until t=5
    change(store, view, "sensor.t", st("22", lc=2.0))
    change(store, view, "sensor.t", st("23", lc=3.0))
    assert view.flush(4.9)[0] is None
    msg, due = view.flush(5.0)
    assert msg["changes"]["sensor.t"]["+"]["s"] == "23"  # only the final value goes out
    assert due is None
    change(store, view, "sensor.t", st("24", lc=6.0))
    msg, due = view.flush(6.0)
    assert msg is None and due == 10.0


def test_burst_collapses_to_one_message_per_interval():
    store, reg, view = setup(Coalescing(default=1.0))
    view.select(["sensor.t"], [], 0.0)
    sent = 0
    for i in range(100):                           # 100 changes over 10 seconds
        now = 1.0 + i * 0.1
        change(store, view, "sensor.t", st(str(i), lc=now))
        msg, _ = view.flush(now)
        sent += bool(msg)
    assert 9 <= sent <= 11


def test_flip_back_inside_interval_sends_nothing():
    store, reg, view = setup(Coalescing(default=5.0))
    view.select(["sensor.t"], [], 0.0)
    original = store.states["sensor.t"]
    change(store, view, "sensor.t", st("99", lc=1.0))
    view.flush(1.0)
    store.states["sensor.t"] = original
    view.on_change({"sensor.t"})
    assert view.flush(5.0)[0] is None


def test_override_pattern_applies_only_to_matches():
    c = Coalescing(default=0.0, overrides=[("sensor.*", 10.0)])
    assert c.interval("sensor.t") == 10.0
    assert c.interval("light.a") == 0.0


def test_client_can_ask_for_slower_never_faster():
    c = Coalescing(default=2.0)
    assert c.interval("light.a", client_min=5.0) == 5.0
    assert c.interval("light.a", client_min=0.5) == 2.0


def test_entity_removed_upstream_is_reported_removed():
    store, reg, view = setup()
    view.select(["light.a"], [], 0.0)
    del store.states["light.a"]
    view.on_change({"light.a"})
    msg, _ = view.flush(1.0)
    assert msg == {"type": "diff", "removed": ["light.a"]}


def test_entity_appearing_upstream_is_sent_whole():
    store, reg, view = setup()
    snap = view.select(["light.new"], [], 0.0)
    assert snap["missing"] == ["light.new"]
    change(store, view, "light.new", st("on"))
    msg, _ = view.flush(1.0)
    assert msg == {"type": "diff", "added": {"light.new": st("on")}}


def test_registry_change_moves_entities_in_and_out_of_an_area():
    store, reg, view = setup()
    view.select([], ["kitchen"], 0.0)
    reg.load([{"area_id": "kitchen", "name": "Kitchen"}], [],
             [{"entity_id": "light.a", "area_id": "kitchen"}, {"entity_id": "sensor.t", "area_id": "kitchen"}])
    view.registry_changed()
    msg, _ = view.flush(1.0)
    assert set(msg["added"]) == {"sensor.t"}
    assert msg["removed"] == ["light.b"]


def test_resubscribe_resets_what_was_sent():
    store, reg, view = setup()
    view.select(["light.a"], [], 0.0)
    snap = view.select(["light.a", "light.b"], [], 1.0)
    assert set(snap["entities"]) == {"light.a", "light.b"}


def test_diff_state_identical_is_none():
    assert diff_state(st(), st()) is None
