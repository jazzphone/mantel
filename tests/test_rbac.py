"""P3.2 RBAC engine: every starting role across the house's domains and actions, deny precedence,
user ∩ device, step-up freshness, the tunnel rules, schedules, and area/floor resolution."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from mantel_server import rbac
from mantel_server.rbac import (DEFAULT_ROLES, Context, Decision, Grant, Policy, Schedule, Subject, classify,
                                decide, guest_until)
from rbac_fixtures import (GPS, NOW, TZ, adult, admin, child, ctx, guest, owner, registry, service, st, states,
                           tablet)

# -- the matrix ----------------------------------------------------------------------------------
# A = allowed, S = allowed once a fresh factor is given (step-up), P = a person's PIN at the device
# is required, D = denied. Checked first with no fresh factor, then with one.
CASES = [
    ("view", "light.kitchen"),                                   # 0
    ("light.turn_on", "light.kitchen"),
    ("light.turn_on", "light.cody"),
    ("media_player.turn_on", "media_player.cody_tv"),
    ("climate.set_temperature", "climate.cody"),
    ("view", "sensor.kitchen_temp"),                             # 5
    ("history", "sensor.kitchen_temp"),
    ("lock.lock", "lock.front_door"),
    ("lock.unlock", "lock.front_door"),
    ("lock.open", "lock.front_door"),
    ("alarm_control_panel.alarm_arm_away", "alarm_control_panel.house"),  # 10
    ("alarm_control_panel.alarm_disarm", "alarm_control_panel.house"),
    ("cover.open_cover", "cover.garage_door"),
    ("cover.close_cover", "cover.garage_door"),
    ("cover.open_cover", "cover.side_gate"),
    ("cover.open_cover", "cover.loft_blind"),                    # 15
    ("cover.open_cover", "cover.guest_blind"),
    ("valve.close_valve", "valve.water_main"),
    ("view", "camera.doorbell"),
    ("camera.live", "camera.doorbell"),
    ("view", "person.jamie"),                                    # 20
    ("history", "person.jamie"),
    ("history", "device_tracker.jamie_phone"),
    ("automation.turn_off", "automation.night_mode"),
    ("automation.trigger", "automation.night_mode"),
    ("script.turn_on", "script.goodnight"),                      # 25
    ("script.turn_off", "script.goodnight"),
    ("configure", "vacuum.downstairs"),
    ("vacuum.start", "vacuum.downstairs"),
    ("light.turn_on", "light.guest"),
    ("scene.turn_on", "scene.movie"),                            # 30
    ("homeassistant.toggle", "lock.front_door"),
    ("light.turn_off", "automation.night_mode"),
    ("light.turn_on", "light.loft"),
    ("view", "media_player.loft_tv"),
    ("lock.unlock", "lock.balcony"),                             # 35
    ("configure", "light.kitchen"),
    ("control.sensitive", "light.loft"),
]
EXPECTED = {
    "owner":   "AAAAA AAASS ASSAS AASAS AAASS ASAAA ASSAA SAS",
    "admin":   "AAAAA AAASS ASSAS AASAS AAASS ASAAA ASSAA SAS",
    "adult":   "AAAAA AAASS ASSAS AASAS AAASS ASDAA ASSAA SDS",
    "child":   "DDAAA DDDDD DDDDD DDDDD DDDDD DDDDD DDDDD DDD",
    "guest":   "DDDDD DDDDD DDDDD DADDD DDDDD DDDDA DDDDD DDD",
    "tablet":  "DDDDD DDDDD DDDDD ADDDD DDDDD DDDDD DDDAA PDP",
    "service": "DDDDD DDDDD DDDDD DDDDD DDDDD DDDDD DDDDD DDD",
}
SUBJECTS = {"owner": owner, "admin": admin, "adult": adult, "child": child, "guest": guest, "tablet": tablet,
            "service": service}


def code(d: Decision) -> str:
    if d.allowed:
        return "A"
    if d.needs_step_up:
        return "P" if d.reason == "person_pin_required" else "S"
    return "D"


def matrix():
    for who, row in EXPECTED.items():
        row = row.replace(" ", "")
        assert len(row) == len(CASES), who
        for (action, eid), want in zip(CASES, row):
            yield pytest.param(who, action, eid, want, id=f"{who}-{action}-{eid}")


@pytest.mark.parametrize("who,action,eid,want", list(matrix()))
def test_role_matrix_without_a_fresh_factor(who, action, eid, want):
    d = decide(SUBJECTS[who](), action, eid, ctx())
    assert code(d) == want, d


@pytest.mark.parametrize("who,action,eid,want", list(matrix()))
def test_role_matrix_with_a_fresh_factor(who, action, eid, want):
    d = decide(SUBJECTS[who](fresh_factor_at=NOW - 60), action, eid, ctx())
    assert code(d) == {"S": "A"}.get(want, want), d


def test_every_case_is_covered_by_some_role_both_ways():
    cols = list(zip(*(r.replace(" ", "") for r in EXPECTED.values())))
    assert all("D" in c or "A" in c for c in cols)
    assert {"A", "S", "P", "D"} <= set("".join(EXPECTED.values()))


# -- reasons ---------------------------------------------------------------------------------------
@pytest.mark.parametrize("subject,action,eid,reason,side", [
    (child, "lock.lock", "lock.front_door", "explicit_deny", "user"),
    (child, "view", "camera.doorbell", "explicit_deny", "user"),
    (child, "cover.close_cover", "cover.garage_door", "explicit_deny", "user"),
    (child, "configure", "vacuum.downstairs", "explicit_deny", "user"),
    (child, "light.turn_on", "light.kitchen", "no_grant", "user"),
    (guest, "view", "person.jamie", "explicit_deny", "user"),
    (guest, "history", "light.guest", "explicit_deny", "user"),
    (guest, "view", "camera.doorbell", "explicit_deny", "user"),
    (adult, "lock.unlock", "lock.front_door", "step_up_required", "user"),
    (tablet, "lock.unlock", "lock.balcony", "person_pin_required", "device"),
    (tablet, "light.turn_on", "light.kitchen", "no_grant", "device"),
    (service, "view", "light.kitchen", "no_grant", "user"),
    (owner, "light.turn_on", "light.kitchen", "granted", None),
])
def test_reasons(subject, action, eid, reason, side):
    d = decide(subject(), action, eid, ctx())
    assert (d.reason, d.side) == (reason, side)


def test_decision_carries_the_classified_action():
    d = decide(owner(), "lock.unlock", "lock.front_door", ctx())
    assert (d.action, d.sensitive, d.needs_step_up) == ("control.sensitive", "lock", True)
    assert decide(owner(), "light.turn_on", "light.kitchen", ctx()).action == "control"


@pytest.mark.parametrize("subject,action,eid,feature,reason", [
    (owner, "view", None, None, "no_target"),
    (owner, "view", None, "jacuzzi", "unknown_feature"),
    (owner, "teleport", "light.kitchen", None, "unknown_action"),
    (owner, "Light.Turn_On", "light.kitchen", None, "unknown_action"),
    (owner, "", "light.kitchen", None, "unknown_action"),
    (lambda: Subject(), "view", "light.kitchen", None, "no_subject"),
])
def test_malformed_requests_are_refused(subject, action, eid, feature, reason):
    d = decide(subject(), action, eid, ctx(), feature=feature)
    assert not d.allowed and not d.needs_step_up and d.reason == reason


# -- classification ----------------------------------------------------------------------------------
@pytest.mark.parametrize("action,eid,want", [
    ("light.turn_on", "light.kitchen", ("control", None)),
    ("lock.lock", "lock.front_door", ("control", None)),
    ("lock.unlock", "lock.front_door", ("control.sensitive", "lock")),
    ("lock.open", "lock.front_door", ("control.sensitive", "lock")),
    ("homeassistant.toggle", "lock.front_door", ("control.sensitive", "lock")),
    ("homeassistant.turn_off", "automation.night_mode", ("control.sensitive", "automation")),
    ("light.turn_off", "automation.night_mode", ("control.sensitive", "automation")),
    ("alarm_control_panel.alarm_disarm", "alarm_control_panel.house", ("control.sensitive", "alarm_control_panel")),
    ("alarm_control_panel.disarm", "alarm_control_panel.house", ("control.sensitive", "alarm_control_panel")),
    ("alarm_control_panel.alarm_arm_home", "alarm_control_panel.house", ("control", None)),
    ("cover.open_cover", "cover.garage_door", ("control.sensitive", "garage")),
    ("cover.toggle", "cover.garage_door", ("control.sensitive", "garage")),
    ("cover.set_cover_position", "cover.side_gate", ("control.sensitive", "garage")),
    ("cover.close_cover", "cover.garage_door", ("control", None)),
    ("cover.open_cover", "cover.loft_blind", ("control", None)),
    ("valve.open_valve", "valve.water_main", ("control.sensitive", "valve")),
    ("valve.close_valve", "valve.water_main", ("control.sensitive", "valve")),
    ("camera.live", "camera.doorbell", ("control.sensitive", "camera")),
    ("camera.turn_off", "camera.doorbell", ("control.sensitive", "camera")),
    ("camera.snapshot", "camera.doorbell", ("control", None)),
    ("automation.turn_on", "automation.night_mode", ("control.sensitive", "automation")),
    ("automation.toggle", "automation.night_mode", ("control.sensitive", "automation")),
    ("script.turn_on", "script.goodnight", ("control", None)),
    ("script.goodnight", None, ("control", None)),
    ("script.turn_off", "script.goodnight", ("control.sensitive", "script")),
    ("script.toggle", "script.goodnight", ("control.sensitive", "script")),
    ("view", "lock.front_door", ("view", None)),
    ("control.sensitive", "light.kitchen", ("control.sensitive", "explicit")),
    ("teleport", "light.kitchen", None),
])
def test_classification(action, eid, want):
    got = classify(action, eid, ctx())
    assert (None if got is None else (got.action, got.sensitive)) == want


# -- deny precedence ---------------------------------------------------------------------------------
def test_explicit_deny_beats_a_stored_allow_whatever_the_order():
    allow = Grant(effect="allow", actions="view", resource_kind="entity", resource="camera.doorbell", users={"cody"})
    deny = Grant(effect="deny", actions="*", resource_kind="feature", resource="cameras", users={"cody"})
    for grants in ((allow,), (allow, deny), (deny, allow)):
        d = Policy.build(grants).decide(child(), "view", "camera.doorbell", ctx())
        assert not d.allowed and d.reason == "explicit_deny"  # the Child role's default deny holds too


def test_stored_deny_narrows_a_broad_role_allow_for_one_user_only():
    p = Policy.build([Grant(effect="deny", actions=("control", "control.sensitive"), resource_kind="domain",
                            resource="lock", users={"ada"})])
    assert p.decide(adult(), "lock.lock", "lock.front_door", ctx()).reason == "explicit_deny"
    assert p.decide(adult(), "view", "lock.front_door", ctx()).allowed
    assert p.decide(owner(), "lock.lock", "lock.front_door", ctx()).allowed
    assert p.decide(Subject(user_role="adult", user_id="another"), "lock.lock", "lock.front_door", ctx()).allowed


def test_grants_are_additive():
    extra = Grant(effect="allow", actions=("view", "control"), resource_kind="entity", resource="light.kitchen",
                  users={"cody"})
    p = Policy.build([extra])
    assert p.decide(child(), "light.turn_on", "light.kitchen", ctx()).allowed
    assert p.decide(child(), "light.turn_on", "light.cody", ctx()).allowed       # the role's grant still counts
    assert not p.decide(child(), "light.turn_on", "light.loft", ctx()).allowed


def test_role_wide_stored_grant_applies_to_everyone_holding_the_role():
    p = Policy.build([Grant(effect="allow", actions="control", resource_kind="entity", resource="scene.movie",
                            roles={"guest"})])
    assert p.decide(guest(), "scene.turn_on", "scene.movie", ctx()).allowed
    assert p.decide(Subject(user_role="guest", user_id="other_guest"), "scene.turn_on", "scene.movie", ctx()).allowed
    assert not p.decide(child(), "scene.turn_on", "scene.movie", ctx()).allowed


def test_a_role_override_replaces_defaults_and_can_lift_a_default_deny():
    body = {"grants": [{"effect": "allow", "actions": ["view"], "resource_kind": "feature", "resource": "cameras"}]}
    p = Policy.build(overrides={"child": body})
    assert p.decide(child(), "view", "camera.doorbell", ctx()).allowed
    assert not p.decide(child(), "light.turn_on", "light.cody", ctx()).allowed   # defaults were replaced


def test_a_new_role_can_be_defined_by_override():
    p = Policy.build(overrides={"nanny": {"grants": [{"effect": "allow", "actions": ["view", "control"],
                                                       "resource_kind": "floor", "resource": "upstairs"}]}})
    nanny = Subject(user_role="nanny", user_id="nina")
    assert p.decide(nanny, "light.turn_on", "light.cody", ctx()).allowed
    assert not p.decide(nanny, "light.turn_on", "light.kitchen", ctx()).allowed


def test_unknown_role_has_nothing():
    assert not decide(Subject(user_role="emperor", user_id="x"), "view", "light.kitchen", ctx()).allowed


def test_override_rejects_targets_and_unknown_keys():
    with pytest.raises(ValueError):
        DEFAULT_ROLES["child"].overridden({"grants": [{"effect": "allow", "actions": ["view"],
                                                         "resource_kind": "all", "users": ["cody"]}]})
    with pytest.raises(ValueError):
        DEFAULT_ROLES["child"].overridden({"superpowers": True})
    with pytest.raises(ValueError):
        DEFAULT_ROLES["child"].overridden({"tunnel_sensitive": "yes"})


# -- intersection ------------------------------------------------------------------------------------
@pytest.mark.parametrize("subject,action,eid,allowed,side", [
    (owner(device_role="wall_tablet", device_id="loft_tablet", device_areas={"loft"}),
     "light.turn_on", "light.kitchen", False, "device"),                     # the tablet's less
    (owner(device_role="wall_tablet", device_id="loft_tablet", device_areas={"loft"}),
     "light.turn_on", "light.loft", True, None),
    (child(device_role="wall_tablet", device_id="loft_tablet", device_areas={"loft"}),
     "light.turn_on", "light.loft", False, "user"),                          # the child's less
    (child(user_areas={"cody_room", "loft"}, device_role="wall_tablet", device_id="loft_tablet",
           device_areas={"loft"}), "light.turn_on", "light.loft", True, None),
    (child(device_role="wall_tablet", device_id="loft_tablet", device_areas={"loft"}),
     "light.turn_on", "light.cody", False, "device"),
    (Subject(device_role="wall_tablet", device_id="loft_tablet", device_areas={"loft"}),
     "light.turn_on", "light.loft", True, None),                             # device alone
    (Subject(user_role="adult", user_id="ada"), "light.turn_on", "light.kitchen", True, None),  # user alone
])
def test_user_and_device_intersection(subject, action, eid, allowed, side):
    d = decide(subject, action, eid, ctx())
    assert (d.allowed, d.side) == (allowed, side)


def test_sensitive_at_a_tablet_needs_a_person_with_a_fresh_pin():
    at_tablet = dict(device_role="wall_tablet", device_id="loft_tablet", device_areas={"loft"})
    assert decide(tablet(), "lock.unlock", "lock.balcony", ctx()).reason == "person_pin_required"
    assert decide(tablet(fresh_factor_at=NOW), "lock.unlock", "lock.balcony", ctx()).reason == "person_pin_required"
    assert decide(owner(**at_tablet), "lock.unlock", "lock.balcony", ctx()).reason == "step_up_required"
    assert decide(owner(fresh_factor_at=NOW - 10, **at_tablet), "lock.unlock", "lock.balcony", ctx()).allowed
    # the person's own rights still bind: a Child's fresh PIN does not unlock anything
    d = decide(child(fresh_factor_at=NOW, **at_tablet), "lock.unlock", "lock.balcony", ctx())
    assert (d.allowed, d.needs_step_up, d.reason) == (False, False, "explicit_deny")
    # and the tablet's: the front door is not in the loft
    d = decide(owner(fresh_factor_at=NOW, **at_tablet), "lock.unlock", "lock.front_door", ctx())
    assert (d.allowed, d.side) == (False, "device")


def test_device_specific_deny_binds_even_an_owner_at_it():
    p = Policy.build([Grant(effect="deny", actions="control", resource_kind="domain", resource="media_player",
                            devices={"loft_tablet"})])
    s = owner(device_role="wall_tablet", device_id="loft_tablet", device_areas={"loft"})
    assert p.decide(s, "media_player.turn_on", "media_player.loft_tv", ctx()).reason == "explicit_deny"
    assert p.decide(owner(), "media_player.turn_on", "media_player.loft_tv", ctx()).allowed
    assert p.decide(s, "view", "media_player.loft_tv", ctx()).allowed


def test_user_grant_does_not_leak_to_the_device_side_and_back():
    p = Policy.build([Grant(effect="allow", actions="control", resource_kind="entity", resource="light.kitchen",
                            users={"loft_tablet"})])   # an id that happens to equal the device's
    assert not p.decide(tablet(), "light.turn_on", "light.kitchen", ctx()).allowed


# -- step-up freshness ---------------------------------------------------------------------------------
@pytest.mark.parametrize("fresh,allowed", [
    (None, False), (NOW, True), (NOW - 299, True), (NOW - 300, True), (NOW - 301, False),
    (NOW - 86400, False), (NOW + 5, False),
])
def test_step_up_freshness(fresh, allowed):
    d = decide(adult(fresh_factor_at=fresh), "lock.unlock", "lock.front_door", ctx())
    assert d.allowed is allowed
    assert d.needs_step_up is (not allowed)


def test_step_up_window_and_exemptions_are_policy():
    assert Policy(step_up_window=60).decide(adult(fresh_factor_at=NOW - 61), "lock.unlock", "lock.front_door",
                                            ctx()).needs_step_up
    p = Policy(step_up_exempt=frozenset({"camera"}))
    assert p.decide(adult(), "camera.live", "camera.doorbell", ctx()).allowed
    assert p.decide(adult(), "lock.unlock", "lock.front_door", ctx()).needs_step_up


def test_step_up_is_only_asked_when_it_would_help():
    d = decide(child(fresh_factor_at=None), "lock.unlock", "lock.front_door", ctx())
    assert not d.needs_step_up
    d = decide(guest(door="tunnel"), "lock.unlock", "lock.front_door", ctx())
    assert not d.needs_step_up


# -- the tunnel (§7) -----------------------------------------------------------------------------------
@pytest.mark.parametrize("subject", [tablet, lambda **kw: owner(device_role="wall_tablet", device_id="loft_tablet",
                                                                 device_areas={"loft"}, **kw)])
def test_device_credentials_are_refused_on_the_tunnel(subject):
    d = decide(subject(door="tunnel"), "view", "light.loft", ctx())
    assert (d.allowed, d.reason) == (False, "device_on_tunnel")


@pytest.mark.parametrize("who", [owner, admin, adult])
def test_sensitive_over_the_tunnel_for_owner_admin_adult_with_step_up(who):
    assert decide(who(door="tunnel"), "lock.unlock", "lock.front_door", ctx()).reason == "step_up_required"
    assert decide(who(door="tunnel", fresh_factor_at=NOW - 30), "lock.unlock", "lock.front_door", ctx()).allowed
    assert decide(who(door="tunnel"), "view", "camera.doorbell", ctx()).allowed
    assert decide(who(door="tunnel"), "history", "person.jamie", ctx()).allowed


def test_guest_sensitive_is_lan_only_unless_the_role_switch_is_on():
    g = Grant(effect="allow", actions="control.sensitive", resource_kind="entity", resource="lock.front_door",
              users={"gwen"})
    p = Policy.build([g])
    assert p.decide(guest(fresh_factor_at=NOW), "lock.unlock", "lock.front_door", ctx()).allowed
    d = p.decide(guest(door="tunnel", fresh_factor_at=NOW), "lock.unlock", "lock.front_door", ctx())
    assert (d.allowed, d.needs_step_up, d.reason) == (False, False, "tunnel_lan_only")
    p2 = Policy.build([g], overrides={"guest": {"tunnel_sensitive": True}})
    assert p2.decide(guest(door="tunnel", fresh_factor_at=NOW), "lock.unlock", "lock.front_door", ctx()).allowed
    # non-sensitive tunnel use is fine for a guest
    assert p.decide(guest(door="tunnel"), "light.turn_on", "light.guest", ctx()).allowed


def test_child_tunnel_switches_default_off():
    r = DEFAULT_ROLES["child"]
    assert not (r.tunnel_sensitive or r.tunnel_cameras or r.tunnel_locations)
    assert decide(child(door="tunnel"), "light.turn_on", "light.cody", ctx()).allowed


RELATIVE = {"relative": {"grants": [{"effect": "allow", "actions": ["view", "history"], "resource_kind": "all"}]}}


def test_cameras_and_locations_over_the_tunnel_are_opt_in_for_other_roles():
    p = Policy.build(overrides=RELATIVE)
    rel = Subject(user_role="relative", user_id="rory")
    assert p.decide(rel, "view", "camera.doorbell", ctx()).allowed
    assert p.decide(rel, "history", "person.jamie", ctx()).allowed
    remote = replace(rel, door="tunnel")
    assert p.decide(remote, "view", "camera.doorbell", ctx()).reason == "tunnel_cameras_off"
    assert p.decide(remote, "history", "person.jamie", ctx()).reason == "tunnel_locations_off"
    assert p.decide(remote, "history", "device_tracker.jamie_phone", ctx()).reason == "tunnel_locations_off"
    assert p.decide(remote, "view", "person.jamie", ctx()).allowed               # home/away is not a location
    assert p.decide(remote, "view", None, ctx(), feature="cameras").reason == "tunnel_cameras_off"
    opted = Policy.build(overrides={"relative": {**RELATIVE["relative"], "tunnel_cameras": True,
                                                 "tunnel_locations": True}})
    assert opted.decide(remote, "view", "camera.doorbell", ctx()).allowed
    assert opted.decide(remote, "history", "person.jamie", ctx()).allowed


# -- schedules -------------------------------------------------------------------------------------
def at(y, m, d, hh, mm, tz=TZ):
    return datetime(y, m, d, hh, mm, tzinfo=ZoneInfo(tz)).timestamp()


NO_TV = Grant(effect="deny", actions="control", resource_kind="domain", resource="media_player", roles={"child"},
              schedule=Schedule(start="21:00", end="06:00"), note="no TV after 9 PM")


@pytest.mark.parametrize("hh,mm,day,allowed", [
    (20, 59, 14, True), (21, 0, 14, False), (23, 30, 14, False), (0, 0, 15, False), (2, 0, 15, False),
    (5, 59, 15, False), (6, 0, 15, True), (12, 0, 15, True),
])
def test_child_no_tv_after_nine_across_midnight(hh, mm, day, allowed):
    p = Policy.build([NO_TV])
    now = at(2026, 10, day, hh, mm)
    assert p.decide(child(), "media_player.turn_on", "media_player.cody_tv", ctx(now)).allowed is allowed
    assert p.decide(child(), "view", "media_player.cody_tv", ctx(now)).allowed          # watching state is fine


def test_schedule_follows_the_house_time_zone():
    p = Policy.build([NO_TV])
    now = at(2026, 10, 14, 22, 0, "America/Los_Angeles")     # 06:00 in London next morning
    assert not p.decide(child(), "media_player.turn_on", "media_player.cody_tv", ctx(now, "America/Los_Angeles")).allowed
    assert p.decide(child(), "media_player.turn_on", "media_player.cody_tv", ctx(now, "Europe/London")).allowed
    assert not p.decide(child(), "media_player.turn_on", "media_player.cody_tv",
                        ctx(now - 3600, "Europe/London")).allowed                       # 05:00 London


def test_days_name_the_day_a_midnight_window_starts():
    fri = Grant(effect="deny", actions="control", resource_kind="domain", resource="media_player",
                roles={"child"}, schedule=Schedule(start="21:00", end="06:00", days={4}))
    p = Policy.build([fri])
    assert datetime(2026, 10, 16).weekday() == 4                                       # a Friday
    tv = lambda now: p.decide(child(), "media_player.turn_on", "media_player.cody_tv", ctx(now)).allowed  # noqa: E731
    assert not tv(at(2026, 10, 16, 22, 0))     # Friday night
    assert not tv(at(2026, 10, 17, 2, 0))      # early Saturday: still Friday's window
    assert tv(at(2026, 10, 17, 22, 0))         # Saturday night: no window
    assert tv(at(2026, 10, 16, 2, 0))          # early Friday belongs to Thursday's (absent) window


def test_daytime_window_and_all_day_window():
    s = Schedule(start="09:00", end="17:00", days={0, 1, 2, 3, 4})
    assert s.active(at(2026, 10, 14, 9, 0), TZ) and not s.active(at(2026, 10, 14, 17, 0), TZ)
    assert not s.active(at(2026, 10, 18, 12, 0), TZ)                                    # Sunday
    assert Schedule(start="00:00", end="00:00", days={2}).active(at(2026, 10, 14, 23, 59), TZ)


def test_dst_transition_uses_wall_clock():
    s = Schedule(start="01:00", end="03:00")
    assert s.active(at(2026, 11, 1, 1, 30), TZ)              # the repeated hour (fall back)
    assert not s.active(at(2026, 3, 8, 3, 30), TZ)           # just after spring forward


def test_guest_until_time_boxes_everything():
    until = at(2026, 10, 18, 18, 0)                           # Sunday 6 PM
    p = Policy.build([guest_until("gwen", until)])
    assert p.decide(guest(), "light.turn_on", "light.guest", ctx(until - 1)).allowed
    d = p.decide(guest(), "light.turn_on", "light.guest", ctx(until))
    assert (d.allowed, d.reason) == (False, "explicit_deny")
    assert p.decide(Subject(user_role="guest", user_id="other", user_areas={"guest_room"}), "light.turn_on",
                    "light.guest", ctx(until + 10)).allowed


def test_allow_with_an_absolute_window():
    g = Grant(effect="allow", actions="control", resource_kind="entity", resource="scene.movie", users={"gwen"},
              schedule=Schedule(not_before=NOW - 10, not_after=NOW + 10))
    p = Policy.build([g])
    assert p.decide(guest(), "scene.turn_on", "scene.movie", ctx(NOW)).allowed
    assert not p.decide(guest(), "scene.turn_on", "scene.movie", ctx(NOW + 10)).allowed
    assert not p.decide(guest(), "scene.turn_on", "scene.movie", ctx(NOW - 11)).allowed


@pytest.mark.parametrize("kw", [
    {"start": "21:00"}, {"start": "25:00", "end": "06:00"}, {"start": "9:00", "end": "10:00"},
    {"days": {7}}, {"days": set()}, {"not_before": 10, "not_after": 5},
])
def test_bad_schedules_are_rejected(kw):
    with pytest.raises(ValueError):
        Schedule(**kw)


def test_unknown_time_zone_fails_loudly():
    with pytest.raises(Exception):
        Context(now=NOW, tz="Mars/Olympus_Mons")


# -- area / floor resolution through the registry ---------------------------------------------------
def grant(kind, resource, **kw):
    return Grant(effect="allow", actions=("view", "control"), resource_kind=kind, resource=resource,
                 users={"nina"}, **kw)


NINA = Subject(user_role=None, user_id="nina")


@pytest.mark.parametrize("g,eid,allowed", [
    (grant("area", "loft"), "light.loft", True),
    (grant("area", "loft"), "light.kitchen", False),
    (grant("area", "Cody's Room"), "light.cody", True),                       # by name
    (grant("area", "cody's room"), "climate.cody", True),                     # case-insensitive
    (grant("area", "living_room"), "lock.front_door", False),                 # sensitive needs its own action
    (grant("area", "Living Room"), "camera.doorbell", True),
    (grant("area", "loft"), "media_player.loft_tv", True),                    # area via the device
    (grant("area", "nowhere"), "light.loft", False),
    (grant("area", "loft"), "person.jamie", False),                           # no area: area grants never match
    (grant("floor", "upstairs"), "light.cody", True),
    (grant("floor", "Upstairs"), "light.guest", True),                        # floor by name
    (grant("floor", "upstairs"), "light.kitchen", False),
    (grant("floor", "ground"), "media_player.loft_tv", False),
    (grant("entity", "light.loft*"), "light.loft_lamp", True),                # glob
    (grant("entity", "light.loft*"), "light.kitchen", False),
    (grant("domain", "light"), "light.guest", True),
    (grant("area", "loft", domains={"light"}), "light.loft", True),           # narrowed to lights
    (grant("area", "loft", domains={"light"}), "cover.loft_blind", False),
    (grant("feature", "garage"), "cover.garage_door", True),                  # device_class from registry
    (grant("feature", "garage"), "cover.side_gate", True),                    # device_class from state
    (grant("feature", "garage"), "cover.loft_blind", False),
    (grant("feature", "locations"), "device_tracker.jamie_phone", True),
    (grant("all", ""), "scene.movie", True),
])
def test_resource_resolution(g, eid, allowed):
    action = "view" if eid.startswith(("camera.", "person.", "device_tracker.")) else \
        {"light": "light.turn_on", "climate": "climate.set_temperature", "lock": "lock.unlock",
         "media_player": "media_player.turn_on", "cover": "cover.close_cover", "scene": "scene.turn_on"}[
            eid.split(".")[0]]
    assert Policy.build([g]).decide(NINA, action, eid, ctx()).allowed is allowed


def test_registry_moves_change_decisions():
    reg = registry()
    p = Policy.build([grant("area", "loft")])
    assert not p.decide(NINA, "light.turn_on", "light.kitchen", ctx(reg=reg)).allowed
    reg.load([*registry()._areas], [*registry()._devices],
             [{"entity_id": "light.kitchen", "area_id": "loft"}], registry()._floors)
    assert p.decide(NINA, "light.turn_on", "light.kitchen", ctx(reg=reg)).allowed


def test_subject_areas_accept_names():
    s = Subject(user_role="child", user_id="cody", user_areas={"Cody's Room"})
    assert decide(s, "light.turn_on", "light.cody", ctx()).allowed


# -- features ------------------------------------------------------------------------------------------
@pytest.mark.parametrize("who,action,feature,allowed,reason", [
    (owner, "configure", "settings", True, "granted"),
    (owner, "configure", "owners", True, "granted"),
    (owner, "configure", "credentials", True, "granted"),
    (admin, "configure", "settings", True, "granted"),
    (admin, "configure", "roles", True, "granted"),
    (admin, "configure", "owners", False, "explicit_deny"),
    (admin, "configure", "credentials", False, "explicit_deny"),
    (admin, "view", "audit", True, "granted"),
    (adult, "configure", "profile", True, "granted"),
    (adult, "configure", "settings", False, "no_grant"),
    (adult, "view", "music", True, "granted"),
    (child, "configure", "profile", True, "granted"),
    (child, "view", "cameras", False, "explicit_deny"),
    (guest, "configure", "profile", False, "no_grant"),
    (guest, "view", "locations", False, "explicit_deny"),
    (service, "view", "music", False, "no_grant"),
])
def test_feature_requests(who, action, feature, allowed, reason):
    d = decide(who(), action, None, ctx(), feature=feature)
    assert (d.allowed, d.reason) == (allowed, reason)


def test_service_accounts_get_exactly_their_endpoints():
    p = Policy.build([Grant(effect="allow", actions="view", resource_kind="feature", resource="notifications",
                            roles={"service"})])
    assert p.decide(service(), "view", None, ctx(), feature="notifications").allowed
    assert not p.decide(service(), "view", None, ctx(), feature="music").allowed
    assert not p.decide(service(), "view", "light.kitchen", ctx()).allowed


# -- grants as data ------------------------------------------------------------------------------------
@pytest.mark.parametrize("kw", [
    dict(effect="maybe", actions="view", resource_kind="all"),
    dict(effect="allow", actions="fly", resource_kind="all"),
    dict(effect="allow", actions=(), resource_kind="all"),
    dict(effect="allow", actions="view", resource_kind="galaxy", resource="x"),
    dict(effect="allow", actions="view", resource_kind="entity", resource=""),
    dict(effect="allow", actions="view", resource_kind="entity", resource="kitchen"),
    dict(effect="allow", actions="view", resource_kind="feature", resource="jacuzzi"),
    dict(effect="allow", actions="view", resource_kind="all", resource="light.kitchen"),
])
def test_bad_grants_are_rejected(kw):
    with pytest.raises(ValueError):
        Grant(**kw)


def test_grant_round_trips_through_dicts():
    g = Grant(effect="deny", actions=("control", "history"), resource_kind="area", resource="loft",
              domains={"light"}, roles={"child"}, users={"cody"}, devices={"loft_tablet"},
              schedule=Schedule(start="21:00", end="06:00", days={0, 4}, not_after=NOW), note="n")
    assert Grant.from_dict(g.to_dict()) == g
    with pytest.raises(ValueError):
        Grant.from_dict({**g.to_dict(), "sneaky": 1})
    with pytest.raises(ValueError):
        Grant.from_dict({**g.to_dict(), "users": [1, 2]})
    with pytest.raises(ValueError):
        Grant.from_dict({**g.to_dict(), "schedule": {"start": "21:00", "end": "06:00", "when": "always"}})


def test_default_roles_are_the_plan_table():
    assert rbac.ROLES == ("owner", "admin", "adult", "child", "guest", "wall_tablet", "service")
    assert all(not g.targets_anyone for r in DEFAULT_ROLES.values() for g in r.grants)
    assert DEFAULT_ROLES["wall_tablet"].sensitive_needs_person
    assert [n for n, r in DEFAULT_ROLES.items() if r.tunnel_sensitive] == ["owner", "admin", "adult"]
    assert DEFAULT_ROLES["service"].grants == ()


def test_subject_rejects_unknown_doors():
    with pytest.raises(ValueError):
        Subject(user_role="owner", user_id="olive", door="window")


# -- the read filter (engine side) ---------------------------------------------------------------------
def test_visible_is_view():
    assert rbac.visible(child(), "light.cody", ctx())
    assert not rbac.visible(child(), "lock.front_door", ctx())
    assert not rbac.visible(guest(), "person.jamie", ctx())
    assert not rbac.visible(guest(), "device_tracker.jamie_phone", ctx())


def test_redact_strips_gps_where_locations_are_denied():
    person = st("home", GPS)
    p = Policy.build([Grant(effect="allow", actions="view", resource_kind="domain", resource="person",
                            devices={"loft_tablet"})])
    assert p.redact(adult(), "person.jamie", person, ctx()) is person               # unchanged object
    seen = p.redact(tablet(), "person.jamie", person, ctx())                        # view yes, history no
    assert seen["s"] == "home" and seen["a"] == {"friendly_name": "Jamie"}
    assert person["a"]["latitude"] == 47.1                                           # the store is untouched
    remote = Policy.build(overrides=RELATIVE)
    rory = Subject(user_role="relative", user_id="rory", door="tunnel")
    assert "latitude" not in remote.redact(rory, "person.jamie", person, ctx())["a"]
    assert "latitude" in remote.redact(replace(rory, door="lan"), "person.jamie", person, ctx())["a"]
    light = st("on", {"latitude": 1})                                                # only location domains
    assert p.redact(tablet(), "light.loft", light, ctx()) is light
