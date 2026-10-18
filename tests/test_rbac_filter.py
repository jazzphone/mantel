"""P3.2 read filter: a gated ClientView only ever sends what its session may `view`, with GPS
removed where locations are denied, and follows grant and schedule changes."""
from __future__ import annotations

from dataclasses import replace

from mantel_server.rbac import Context, Gate, Grant, Policy, Subject, guest_until
from mantel_server.view import ClientView, Coalescing, filter_registry
from rbac_fixtures import GPS, NOW, TZ, adult, child, guest, owner, registry, st, states, tablet


class Env:
    """One gated session over the fictional house, with a settable clock and policy."""

    def __init__(self, subject: Subject, policy: Policy | None = None):
        self.reg = registry()
        self.store = states()
        self.now = NOW
        self.policy = policy or Policy()
        self.gate = Gate(lambda: self.policy, subject,
                         lambda: Context.from_registry(self.reg, self.now, TZ, self.store.states))
        self.view = ClientView(self.store, self.reg, Coalescing(), gate=self.gate)

    def change(self, eid, new):
        self.store.states[eid] = new
        return self.view.on_change({eid})


def sent_ids(msg):
    return set(msg.get("entities") or {}) | set(msg.get("added") or {}) | set(msg.get("changes") or {})


def test_child_session_never_receives_a_lock():
    env = Env(child())
    snap = env.view.select([], [], 0.0, all_entities=True)
    assert set(snap["entities"]) == {"light.cody", "media_player.cody_tv", "climate.cody"}
    assert env.change("lock.front_door", st("unlocked", lc=2.0)) is False
    assert env.view.flush(1.0) == (None, None)
    # asked for by id, or by area: still nothing, and it looks like it does not exist
    snap = env.view.select(["lock.front_door", "light.cody"], ["Living Room"], 2.0)
    assert set(snap["entities"]) == {"light.cody"}
    assert snap["missing"] == ["lock.front_door"]
    # a brand-new lock appearing upstream in an all-subscription is not picked up either
    env.view.select([], [], 3.0, all_entities=True)
    assert env.change("lock.new_one", st("locked")) is False


def test_guest_session_never_receives_person_locations():
    env = Env(guest())
    snap = env.view.select(["person.jamie", "device_tracker.jamie_phone"], [], 0.0, all_entities=True)
    assert not {"person.jamie", "device_tracker.jamie_phone"} & set(snap["entities"])
    assert set(snap["entities"]) == {"light.guest", "cover.guest_blind"}
    env.change("person.jamie", st("not_home", {**GPS, "latitude": 48.0}, lc=5.0))
    assert env.view.flush(6.0) == (None, None)


def test_adult_sees_people_with_gps():
    env = Env(adult())
    snap = env.view.select(["person.jamie"], [], 0.0)
    assert snap["entities"]["person.jamie"]["a"]["latitude"] == 47.1


def test_gps_is_stripped_where_history_is_denied_and_diffs_stay_redacted():
    # the loft tablet may show who is home (an entity grant), not where they are
    p = Policy.build([Grant(effect="allow", actions="view", resource_kind="domain", resource="person",
                            devices={"loft_tablet"})])
    env = Env(tablet(), p)
    snap = env.view.select(["person.jamie"], [], 0.0)
    assert snap["entities"]["person.jamie"]["a"] == {"friendly_name": "Jamie"}
    env.change("person.jamie", st("home", {**GPS, "latitude": 48.0}, lc=1.0))   # only GPS moved
    assert env.view.flush(1.0)[0] is None
    env.change("person.jamie", st("not_home", {**GPS, "latitude": 49.0}, lc=2.0))
    msg, _ = env.view.flush(2.0)
    assert msg == {"type": "diff", "changes": {"person.jamie": {"+": {"s": "not_home", "lc": 2.0, "lu": 2.0}}}}


def test_tunnel_session_without_the_locations_switch_gets_no_gps():
    p = Policy.build(overrides={"relative": {"grants": [{"effect": "allow", "actions": ["view", "history"],
                                                          "resource_kind": "all"}]}})
    env = Env(Subject(user_role="relative", user_id="rory", door="tunnel"), p)
    snap = env.view.select(["person.jamie", "camera.doorbell"], [], 0.0)
    assert "latitude" not in snap["entities"]["person.jamie"]["a"]
    assert "camera.doorbell" not in snap["entities"]                 # cameras over the tunnel: opt-in
    assert snap["missing"] == ["camera.doorbell"]


def test_grant_changes_add_and_remove_entities_and_redaction():
    env = Env(child())
    env.view.select([], [], 0.0, all_entities=True)
    extra = Grant(effect="allow", actions="view", resource_kind="entity", resource="light.kitchen", users={"cody"})
    env.policy = Policy.build([extra])
    env.view.policy_changed()
    msg, _ = env.view.flush(1.0)
    assert msg == {"type": "diff", "added": {"light.kitchen": st("on")}}
    env.policy = Policy()
    env.view.policy_changed()
    msg, _ = env.view.flush(2.0)
    assert msg == {"type": "diff", "removed": ["light.kitchen"]}


def test_history_grant_change_resends_gps():
    base = Grant(effect="allow", actions="view", resource_kind="domain", resource="person", devices={"loft_tablet"})
    env = Env(tablet(), Policy.build([base]))
    env.view.select(["person.jamie"], [], 0.0)
    env.policy = Policy.build([base, replace(base, actions=frozenset({"history"}))])
    env.view.policy_changed()
    msg, _ = env.view.flush(1.0)
    assert msg["changes"]["person.jamie"]["+"]["a"] == {"latitude": 47.1, "longitude": -122.2, "gps_accuracy": 12}


def test_a_guest_window_closing_empties_the_view():
    env = Env(guest(), Policy.build([guest_until("gwen", NOW + 60)]))
    snap = env.view.select([], [], 0.0, all_entities=True)
    assert snap["entities"]
    env.now = NOW + 60
    env.view.policy_changed()                      # the orchestrator calls this on a timer
    msg, _ = env.view.flush(1.0)
    assert set(msg["removed"]) == {"light.guest", "cover.guest_blind"}
    assert env.change("light.guest", st("off", lc=3.0)) is False


def test_owner_view_matches_an_ungated_view():
    gated = Env(owner())
    plain = ClientView(gated.store, gated.reg, Coalescing())
    assert gated.view.select([], [], 0.0, all_entities=True) == plain.select([], [], 0.0, all_entities=True)


def test_no_gate_keeps_the_old_behaviour():
    env = Env(child())
    view = ClientView(env.store, env.reg, Coalescing())
    snap = view.select(["lock.front_door", "light.nope"], [], 0.0)
    assert set(snap["entities"]) == {"lock.front_door"} and snap["missing"] == ["light.nope"]
    view.policy_changed()                          # harmless without a gate
    assert view.flush(1.0) == (None, None)


def test_registry_entries_are_filtered_too():
    env = Env(child())
    shapes = filter_registry(env.reg.frontend_shapes(), env.gate)
    assert set(shapes["entities"]) == {"light.cody", "media_player.cody_tv", "climate.cody"}
    assert shapes["devices"] == {}
    assert set(shapes["areas"]) == {"cody_room"}
    assert set(shapes["floors"]) == {"upstairs"}
    tab = Env(tablet())
    shapes = filter_registry(tab.reg.frontend_shapes(), tab.gate)
    assert "media_player.loft_tv" in shapes["entities"] and set(shapes["devices"]) == {"dev_loft_tv"}
    assert "lock.front_door" not in shapes["entities"]
    full = env.reg.frontend_shapes()
    assert filter_registry(full, None) is full


def test_guest_registry_has_no_people():
    env = Env(guest())
    shapes = filter_registry(env.reg.frontend_shapes(), env.gate)
    assert not any(e.startswith(("person.", "device_tracker.", "camera.")) for e in shapes["entities"])
    assert "dev_phone" not in shapes["devices"]
