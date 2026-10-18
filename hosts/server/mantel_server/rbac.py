"""Roles and grants (PLAN §5, §7): the RBAC engine. Pure: no I/O, no clock, no database.

A request carries a *subject* (a user, an enrolled device, or both, and the door it came in by)
and asks to do an *action* to an entity or a feature. `Policy.decide` answers with a `Decision`.

Rules, in the order they are applied:
1. The action is classified. Plain actions (`view`, `control`, `control.sensitive`, `history`,
   `configure`) stand as they are; a service (`lock.unlock`, `homeassistant.toggle`, ...) becomes
   `control` or, if it is in the sensitive set, `control.sensitive`. Unknown actions are refused.
2. Device credentials are refused on the tunnel door (§7: tablets are LAN-only).
3. Each side (user, device) is evaluated on its own: its role's grants plus the stored grants that
   name its role or id. Deny by default; grants are additive; an explicit deny wins. A grant with a
   schedule only counts while its window is open.
4. Effective permission = user's ∩ device's. No user: the device alone; no device: the user alone.
5. Tunnel rules (§7): sensitive actions only for roles whose `tunnel_sensitive` switch is on
   (Owner, Admin, Adult); cameras and locations only where `tunnel_cameras`/`tunnel_locations` is on.
6. Step-up: a sensitive action needs a fresh factor (PIN or passkey within `step_up_window`). A
   device alone (a wall tablet with nobody at it) never has one: a person's PIN is required.

Only when everything else would allow does a decision say `needs_step_up`, so a prompt is shown
only when a PIN would actually help.
"""
from __future__ import annotations

import fnmatch
import re
from dataclasses import dataclass, field, replace
from datetime import datetime
from typing import Any, Callable, Iterable, Mapping
from zoneinfo import ZoneInfo

ACTIONS = ("view", "control", "control.sensitive", "history", "configure")
ANY_ACTION = "*"
RESOURCE_KINDS = ("entity", "domain", "area", "floor", "feature", "all")
EFFECTS = ("allow", "deny")
DOORS = ("lan", "tunnel")
SIDES = ("user", "device")
STEP_UP_WINDOW = 300.0            # seconds a PIN/passkey stays fresh (§7: "within ~5 minutes")
SUBJECT_AREAS = "@subject"         # area resource meaning "this side's own areas" (see Subject)

# Features (§5): named resources. Some contain entities (by domain, or garage covers by device
# class); the others are non-entity endpoints (music library, energy, settings, ...).
FEATURE_DOMAINS: dict[str, frozenset[str]] = {
    "cameras": frozenset({"camera"}),
    "locations": frozenset({"person", "device_tracker"}),
    "garage": frozenset(),         # covers whose device_class is garage/gate (see GARAGE_CLASSES)
    "music": frozenset(),
    "energy": frozenset(),
    "notifications": frozenset(),
    "settings": frozenset(),       # house-wide HK settings
    "profile": frozenset(),        # a user's own settings
    "users": frozenset(),
    "devices": frozenset(),
    "roles": frozenset(),
    "owners": frozenset(),         # managing Owner accounts
    "credentials": frozenset(),    # HA / MA credentials, secrets
    "audit": frozenset(),
}
FEATURES = tuple(FEATURE_DOMAINS)
GARAGE_CLASSES = frozenset({"garage", "gate"})
LOCATION_DOMAINS = FEATURE_DOMAINS["locations"]
LOCATION_ATTRS = frozenset({"latitude", "longitude", "gps_accuracy", "altitude", "course", "speed",
                            "vertical_accuracy"})

# The sensitive set (§5), fail-closed: for these domains every service is sensitive except the
# ones listed as safe. `camera.live` is the pseudo-service for live view (WebRTC/HLS signaling).
SAFE_SERVICES: dict[str, frozenset[str]] = {
    "lock": frozenset({"lock"}),
    "alarm_control_panel": frozenset({"alarm_arm_home", "alarm_arm_away", "alarm_arm_night",
                                      "alarm_arm_vacation", "alarm_arm_custom_bypass", "alarm_trigger"}),
    "valve": frozenset(),          # every valve service (the water main)
    "automation": frozenset(),     # turn_on / turn_off / toggle / trigger / reload
    "camera": frozenset({"snapshot", "turn_on", "enable_motion_detection"}),
    "garage": frozenset({"close_cover", "stop_cover", "close_cover_tilt", "stop_cover_tilt"}),
}
# Scripts: running one is ordinary control; stopping/toggling it is sensitive.
SENSITIVE_SCRIPT_SERVICES = frozenset({"turn_off", "toggle", "reload"})
SENSITIVE_KINDS = ("lock", "alarm_control_panel", "valve", "automation", "camera", "garage", "script",
                   "explicit")

_HHMM = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
_SERVICE = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")


def _set(value: Any) -> frozenset:
    if value is None:
        return frozenset()
    if isinstance(value, str):
        return frozenset({value})
    return frozenset(value)


def _minutes(hhmm: str) -> int:
    m = _HHMM.match(hhmm)
    if not m:
        raise ValueError(f"time must be HH:MM (00:00-23:59), got {hhmm!r}")
    return int(m.group(1)) * 60 + int(m.group(2))


def domain_of(entity_id: str) -> str:
    return entity_id.split(".", 1)[0]


# -- data ----------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Schedule:
    """When a grant counts. Times are wall-clock in the house's time zone.

    `start`/`end` (HH:MM) give a daily window; `end` < `start` crosses midnight (21:00-06:00), and
    `days` (Mon=0) names the day the window *starts* on, so Friday 21:00-06:00 covers early Saturday.
    `start == end` means all day. `not_before`/`not_after` (epoch seconds) bound it absolutely:
    "Guest until Sunday 18:00" is `not_after`.
    """
    start: str | None = None
    end: str | None = None
    days: frozenset[int] = frozenset(range(7))
    not_before: float | None = None
    not_after: float | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "days", _set(self.days))
        if (self.start is None) != (self.end is None):
            raise ValueError("a schedule needs both start and end, or neither")
        if self.start is not None:
            _minutes(self.start)
            _minutes(self.end)
        if not self.days or not all(isinstance(d, int) and 0 <= d <= 6 for d in self.days):
            raise ValueError("days must be weekday numbers 0 (Mon) to 6 (Sun)")
        if self.not_before is not None and self.not_after is not None and self.not_after <= self.not_before:
            raise ValueError("not_after must be later than not_before")

    def active(self, now: float, tz: str) -> bool:
        if self.not_before is not None and now < self.not_before:
            return False
        if self.not_after is not None and now >= self.not_after:
            return False
        local = datetime.fromtimestamp(now, ZoneInfo(tz))
        day = local.weekday()
        if self.start is None:
            return day in self.days
        t = local.hour * 60 + local.minute
        s, e = _minutes(self.start), _minutes(self.end)
        if s == e:
            return day in self.days
        if s < e:
            return s <= t < e and day in self.days
        return (t >= s and day in self.days) or (t < e and (day - 1) % 7 in self.days)

    def to_dict(self) -> dict:
        return {"start": self.start, "end": self.end, "days": sorted(self.days),
                "not_before": self.not_before, "not_after": self.not_after}

    @classmethod
    def from_dict(cls, d: Mapping) -> Schedule:
        extra = set(d) - {"start", "end", "days", "not_before", "not_after"}
        if extra:
            raise ValueError(f"unknown schedule keys {sorted(extra)}")
        days = d.get("days")
        return cls(start=d.get("start"), end=d.get("end"),
                   days=frozenset(range(7)) if days is None else days,
                   not_before=d.get("not_before"), not_after=d.get("not_after"))


@dataclass(frozen=True)
class Grant:
    """`effect` the `actions` on a resource, for the roles/users/devices named, while `schedule`.

    Resource kinds: `entity` (an entity id, `*` globs allowed), `domain`, `area` (id or name, or
    `@subject` for the side's own areas), `floor` (id or name), `feature` (one of FEATURES), `all`.
    `domains`, when given, narrows any resource to those domains ("lights in the Loft").
    A role's default grants name no targets: they apply to everyone holding the role.
    """
    effect: str
    actions: frozenset[str]
    resource_kind: str
    resource: str = ""
    domains: frozenset[str] = frozenset()
    roles: frozenset[str] = frozenset()
    users: frozenset[str] = frozenset()
    devices: frozenset[str] = frozenset()
    schedule: Schedule | None = None
    id: int | None = None
    note: str = ""

    def __post_init__(self) -> None:
        for name in ("actions", "domains", "roles", "users", "devices"):
            object.__setattr__(self, name, _set(getattr(self, name)))
        if self.effect not in EFFECTS:
            raise ValueError(f"effect must be one of {EFFECTS}")
        if not self.actions or not self.actions <= set(ACTIONS) | {ANY_ACTION}:
            raise ValueError(f"actions must be from {ACTIONS} or '*'")
        if self.resource_kind not in RESOURCE_KINDS:
            raise ValueError(f"resource_kind must be one of {RESOURCE_KINDS}")
        if self.resource_kind == "all":
            if self.resource not in ("", "*"):
                raise ValueError("an 'all' grant takes no resource")
            object.__setattr__(self, "resource", "")
        elif not isinstance(self.resource, str) or not self.resource:
            raise ValueError(f"a {self.resource_kind} grant needs a resource")
        if self.resource_kind == "feature" and self.resource not in FEATURE_DOMAINS:
            raise ValueError(f"feature must be one of {FEATURES}")
        if self.resource_kind == "entity" and "." not in self.resource:
            raise ValueError("an entity resource looks like domain.object_id")
        if self.schedule is not None and not isinstance(self.schedule, Schedule):
            raise ValueError("schedule must be a Schedule")

    @property
    def targets_anyone(self) -> bool:
        return bool(self.roles or self.users or self.devices)

    def applies_to(self, side: str, role: str | None, sid: str | None) -> bool:
        if role is not None and role in self.roles:
            return True
        ids = self.users if side == "user" else self.devices
        return sid is not None and sid in ids

    def covers(self, action: str) -> bool:
        return ANY_ACTION in self.actions or action in self.actions

    def to_dict(self) -> dict:
        return {"id": self.id, "effect": self.effect, "actions": sorted(self.actions),
                "resource_kind": self.resource_kind, "resource": self.resource,
                "domains": sorted(self.domains), "roles": sorted(self.roles), "users": sorted(self.users),
                "devices": sorted(self.devices),
                "schedule": self.schedule.to_dict() if self.schedule else None, "note": self.note}

    @classmethod
    def from_dict(cls, d: Mapping) -> Grant:
        if not isinstance(d, Mapping):
            raise ValueError("a grant is an object")
        extra = set(d) - {"id", "effect", "actions", "resource_kind", "resource", "domains", "roles",
                          "users", "devices", "schedule", "note"}
        if extra:
            raise ValueError(f"unknown grant keys {sorted(extra)}")
        for key in ("actions", "domains", "roles", "users", "devices"):
            v = d.get(key)
            if v is not None and not (isinstance(v, str) or
                                      (isinstance(v, (list, tuple, set, frozenset))
                                       and all(isinstance(x, str) for x in v))):
                raise ValueError(f"{key} must be a list of strings")
        sched = d.get("schedule")
        if sched is not None and not isinstance(sched, Mapping):
            raise ValueError("schedule must be an object")
        note = d.get("note") or ""
        if not isinstance(note, str):
            raise ValueError("note must be a string")
        return cls(effect=d.get("effect"), actions=d.get("actions"), resource_kind=d.get("resource_kind"),
                   resource=d.get("resource") or "", domains=d.get("domains"), roles=d.get("roles"),
                   users=d.get("users"), devices=d.get("devices"),
                   schedule=Schedule.from_dict(sched) if sched is not None else None,
                   id=d.get("id"), note=note)


@dataclass(frozen=True)
class Role:
    """A role's default grants and its switches. Overridable per house (rbac_store)."""
    name: str
    grants: tuple[Grant, ...] = ()
    tunnel_sensitive: bool = False     # sensitive actions over the tunnel (§7)
    tunnel_cameras: bool = False       # cameras over the tunnel
    tunnel_locations: bool = False     # person/device_tracker locations over the tunnel
    sensitive_needs_person: bool = False  # a device alone may not; a person's PIN at it is required
    label: str = ""

    SWITCHES = ("tunnel_sensitive", "tunnel_cameras", "tunnel_locations", "sensitive_needs_person")

    def to_dict(self) -> dict:
        return {"name": self.name, "label": self.label, "grants": [g.to_dict() for g in self.grants],
                **{k: getattr(self, k) for k in self.SWITCHES}}

    def overridden(self, body: Mapping) -> Role:
        """This role with a stored override applied: `grants` replaces the defaults; switches merge."""
        extra = set(body) - {"grants", "label", *self.SWITCHES}
        if extra:
            raise ValueError(f"unknown role override keys {sorted(extra)}")
        changes: dict = {}
        if "grants" in body:
            if not isinstance(body["grants"], list):
                raise ValueError("grants must be a list")
            gs = tuple(Grant.from_dict({k: v for k, v in g.items() if k != "id"}) if isinstance(g, Mapping)
                       else Grant.from_dict(g) for g in body["grants"])
            if any(g.targets_anyone for g in gs):
                raise ValueError("a role's grants apply to the role; they name no roles, users or devices")
            changes["grants"] = gs
        for k in self.SWITCHES:
            if k in body:
                if not isinstance(body[k], bool):
                    raise ValueError(f"{k} must be true or false")
                changes[k] = body[k]
        if "label" in body:
            changes["label"] = str(body["label"])
        return replace(self, **changes)


@dataclass(frozen=True)
class Subject:
    """Who is asking. `user_areas` are a Child's allowed areas / a Guest's chosen rooms;
    `device_areas` a wall tablet's room(s). Both feed `@subject` area grants for that side."""
    user_role: str | None = None
    user_id: str | None = None
    device_role: str | None = None
    device_id: str | None = None
    door: str = "lan"
    fresh_factor_at: float | None = None
    user_areas: frozenset[str] = frozenset()
    device_areas: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        if self.door not in DOORS:
            raise ValueError(f"door must be one of {DOORS}")
        object.__setattr__(self, "user_areas", _set(self.user_areas))
        object.__setattr__(self, "device_areas", _set(self.device_areas))

    @property
    def has_user(self) -> bool:
        return self.user_id is not None or self.user_role is not None

    @property
    def has_device(self) -> bool:
        return self.device_id is not None or self.device_role is not None


def _none(_: str) -> None:
    return None


def _same(ref: str) -> str:
    return ref


@dataclass(frozen=True)
class Context:
    """Registry lookups and the time, so the engine stays pure. `tz` is the house's IANA zone."""
    now: float
    tz: str = "UTC"
    area_of: Callable[[str], str | None] = _none
    floor_of: Callable[[str], str | None] = _none
    device_class_of: Callable[[str], str | None] = _none
    resolve_area: Callable[[str], str | None] = _same
    resolve_floor: Callable[[str], str | None] = _same

    def __post_init__(self) -> None:
        ZoneInfo(self.tz)  # an unknown zone is a configuration error: fail loudly, never guess

    @classmethod
    def from_registry(cls, registry, now: float, tz: str = "UTC", states: Mapping | None = None) -> Context:
        """Lookups over `registry.Registry` (and the state store's states for device_class)."""
        def floor_of(eid: str) -> str | None:
            area = registry.entity_area.get(eid)
            return registry.area_floor.get(area) if area else None

        def device_class_of(eid: str) -> str | None:
            entry = registry.entries.get(eid) or {}
            dc = entry.get("device_class") or entry.get("original_device_class")
            if dc is None and states is not None:
                dc = ((states.get(eid) or {}).get("a") or {}).get("device_class")
            return dc

        return cls(now=now, tz=tz, area_of=registry.entity_area.get, floor_of=floor_of,
                   device_class_of=device_class_of, resolve_area=registry.resolve_area,
                   resolve_floor=registry.resolve_floor)


@dataclass(frozen=True)
class Classified:
    action: str                     # one of ACTIONS
    sensitive: str | None = None    # sensitive kind (SENSITIVE_KINDS) or None
    tunnel_feature: str | None = None  # "cameras" / "locations" when the §7 tunnel switch applies


@dataclass(frozen=True)
class Decision:
    allowed: bool
    needs_step_up: bool
    reason: str
    action: str | None = None       # the classified action
    sensitive: str | None = None
    side: str | None = None         # "user" / "device" when one side refused


# -- classification ------------------------------------------------------------------------------
def classify(action: str, entity_id: str | None, ctx: Context) -> Classified | None:
    """Plain action or service -> Classified; None if it is neither."""
    domain = domain_of(entity_id) if entity_id else None
    if action in ACTIONS:
        if action == "control.sensitive":
            return Classified(action, "explicit", _tunnel_feature(action, domain))
        return Classified(action, None, _tunnel_feature(action, domain))
    if not isinstance(action, str) or not _SERVICE.match(action):
        return None
    svc_domain, svc = action.split(".", 1)
    # Fail closed: the service's own domain and the target's domain are both checked, so
    # homeassistant.toggle on a lock, or light.turn_off aimed at an automation, stay sensitive.
    pairs = {(svc_domain, svc)}
    if domain:
        pairs.add((domain, svc))
    kind = None
    for d, s in sorted(pairs):
        kind = kind or _sensitive_kind(d, s, entity_id, ctx)
    act = "control.sensitive" if kind else "control"
    return Classified(act, kind, _tunnel_feature(act, domain, svc_domain))


def _sensitive_kind(domain: str, svc: str, entity_id: str | None, ctx: Context) -> str | None:
    if domain == "script":
        return "script" if svc in SENSITIVE_SCRIPT_SERVICES else None
    if domain == "cover":
        if entity_id and domain_of(entity_id) == "cover" and ctx.device_class_of(entity_id) in GARAGE_CLASSES:
            return None if svc in SAFE_SERVICES["garage"] else "garage"
        return None
    safe = SAFE_SERVICES.get(domain)
    if safe is None or domain == "garage":
        return None
    return None if svc in safe else domain


def _tunnel_feature(action: str, domain: str | None, svc_domain: str | None = None) -> str | None:
    if domain == "camera" or svc_domain == "camera":
        return "cameras"
    if domain in LOCATION_DOMAINS and action == "history":
        return "locations"
    return None


def in_feature(feature: str, entity_id: str, ctx: Context) -> bool:
    domain = domain_of(entity_id)
    if feature == "garage":
        return domain == "cover" and ctx.device_class_of(entity_id) in GARAGE_CLASSES
    return domain in FEATURE_DOMAINS.get(feature, ())


# -- the starting roles (§5), as data ------------------------------------------------------------
def _g(effect: str, actions, kind: str, resource: str = "", domains=(), note: str = "") -> Grant:
    return Grant(effect=effect, actions=actions, resource_kind=kind, resource=resource, domains=domains, note=note)


CHILD_DOMAINS = frozenset({"light", "media_player", "remote", "climate", "fan"})
GUEST_DOMAINS = frozenset({"light", "switch", "fan", "climate", "media_player", "remote", "cover", "scene"})

DEFAULT_ROLES: dict[str, Role] = {r.name: r for r in (
    Role("owner", (
        _g("allow", "*", "all", note="everything, including roles, users, devices, secrets, audit"),
    ), tunnel_sensitive=True, tunnel_cameras=True, tunnel_locations=True, label="Owner"),
    Role("admin", (
        _g("allow", "*", "all", note="everything ..."),
        _g("deny", "configure", "feature", "owners", note="... but managing Owners"),
        _g("deny", "configure", "feature", "credentials", note="... and HA/MA credentials"),
    ), tunnel_sensitive=True, tunnel_cameras=True, tunnel_locations=True, label="Admin"),
    Role("adult", (
        _g("allow", ("view", "control", "control.sensitive", "history"), "all",
           note="control the whole house; sensitive with step-up"),
        _g("allow", "configure", "feature", "profile", note="no settings beyond their own"),
    ), tunnel_sensitive=True, tunnel_cameras=True, tunnel_locations=True, label="Adult"),
    Role("child", (
        _g("allow", ("view", "control"), "area", SUBJECT_AREAS, CHILD_DOMAINS,
           note="lights, media, climate in allowed areas"),
        _g("allow", "configure", "feature", "profile", note="their own settings"),
        _g("allow", ("view", "control"), "feature", "music",
           note="the Music page (Avery 2026-10-18); its speakers still only in their rooms; an Owner may deny it"),
        _g("deny", "*", "feature", "cameras", note="cameras off"),
        _g("deny", "*", "domain", "lock", note="no locks"),
        _g("deny", "*", "domain", "alarm_control_panel", note="no alarm"),
        _g("deny", "*", "feature", "garage", note="no garage"),
        _g("deny", "configure", "domain", "vacuum", note="no vacuum schedules"),
    ), label="Child"),
    Role("guest", (
        _g("allow", ("view", "control"), "area", SUBJECT_AREAS, GUEST_DOMAINS,
           note="a chosen set of rooms (scenes are granted by entity)"),
        _g("deny", "*", "feature", "cameras", note="no cameras"),
        _g("deny", "*", "feature", "locations", note="no people or locations"),
        _g("deny", "history", "all", note="no history"),
        _g("deny", "*", "feature", "garage", note="no garage"),
    ), label="Guest"),
    Role("wall_tablet", (
        _g("allow", ("view", "control", "control.sensitive", "history"), "area", SUBJECT_AREAS,
           note="what its room's dashboard shows; more by entity grants"),
    ), sensitive_needs_person=True, label="Wall Tablet"),
    Role("service", (), label="Service"),
)}
ROLES = tuple(DEFAULT_ROLES)


# -- the policy ----------------------------------------------------------------------------------
@dataclass(frozen=True)
class Policy:
    roles: Mapping[str, Role] = field(default_factory=lambda: dict(DEFAULT_ROLES))
    grants: tuple[Grant, ...] = ()
    step_up_window: float = STEP_UP_WINDOW
    step_up_exempt: frozenset[str] = frozenset()   # sensitive kinds that skip step-up (none by default)

    @classmethod
    def build(cls, grants: Iterable[Grant] = (), overrides: Mapping[str, Mapping] | None = None,
              **kw) -> Policy:
        """Defaults, with stored role overrides applied (a new role may be defined by override)."""
        roles = dict(DEFAULT_ROLES)
        for name, body in (overrides or {}).items():
            roles[name] = (roles.get(name) or Role(name)).overridden(body)
        return cls(roles=roles, grants=tuple(grants), **kw)

    # one side: deny by default, additive allows, explicit deny wins
    def _side(self, side: str, role: str | None, sid: str | None, areas: frozenset[str], cl: Classified,
              entity_id: str | None, feature: str | None, ctx: Context) -> str:
        r = self.roles.get(role) if role is not None else None
        grants = list(r.grants) if r else []
        grants += [g for g in self.grants if g.applies_to(side, role, sid)]
        allowed = False
        for g in grants:
            if not g.covers(cl.action):
                continue
            if g.schedule is not None and not g.schedule.active(ctx.now, ctx.tz):
                continue
            if not _matches(g, entity_id, feature, areas, ctx):
                continue
            if g.effect == "deny":
                return "explicit_deny"
            allowed = True
        return "granted" if allowed else "no_grant"

    def decide(self, subject: Subject, action: str, entity_id: str | None, ctx: Context, *,
               feature: str | None = None) -> Decision:
        cl = classify(action, entity_id, ctx)
        if cl is None:
            return Decision(False, False, "unknown_action")
        mk = lambda ok, step, reason, side=None: Decision(ok, step, reason, cl.action, cl.sensitive, side)  # noqa: E731
        if entity_id is None and feature is None:
            return mk(False, False, "no_target")
        if feature is not None and feature not in FEATURE_DOMAINS:
            return mk(False, False, "unknown_feature")
        if not subject.has_user and not subject.has_device:
            return mk(False, False, "no_subject")
        if subject.has_device and subject.door == "tunnel":
            return mk(False, False, "device_on_tunnel", "device")
        results = []
        if subject.has_user:
            results.append(("user", self._side("user", subject.user_role, subject.user_id, subject.user_areas,
                                                cl, entity_id, feature, ctx)))
        if subject.has_device:
            results.append(("device", self._side("device", subject.device_role, subject.device_id,
                                                  subject.device_areas, cl, entity_id, feature, ctx)))
        refused = [(s, r) for s, r in results if r != "granted"]
        if refused:
            side, reason = next(((s, r) for s, r in refused if r == "explicit_deny"), refused[0])
            return mk(False, False, reason, side)
        if subject.door == "tunnel":
            role = self.roles.get(subject.user_role) if subject.user_role else None
            tf = cl.tunnel_feature or (feature if feature in ("cameras", "locations") else None)
            if cl.sensitive and not (role and role.tunnel_sensitive):
                return mk(False, False, "tunnel_lan_only", "user")
            if tf == "cameras" and not (role and role.tunnel_cameras):
                return mk(False, False, "tunnel_cameras_off", "user")
            if tf == "locations" and not (role and role.tunnel_locations):
                return mk(False, False, "tunnel_locations_off", "user")
        if cl.sensitive and cl.sensitive not in self.step_up_exempt:
            if not subject.has_user:
                return mk(False, True, "person_pin_required", "device")
            t = subject.fresh_factor_at
            if t is None or t > ctx.now or ctx.now - t > self.step_up_window:
                return mk(False, True, "step_up_required", "user")
        return mk(True, False, "granted")

    # -- the read filter ------------------------------------------------------------------------
    def visible(self, subject: Subject, entity_id: str, ctx: Context) -> bool:
        """May this subject receive the entity's state and registry entry at all?"""
        return self.decide(subject, "view", entity_id, ctx).allowed

    def redact(self, subject: Subject, entity_id: str, state: dict, ctx: Context) -> dict:
        """The state as this subject may see it: GPS attributes of people and trackers are removed
        unless the subject may read their `history` (which carries the §7 tunnel locations rule).
        Returns the same object when nothing is removed."""
        attrs = state.get("a") or {}
        if domain_of(entity_id) in LOCATION_DOMAINS and not LOCATION_ATTRS.isdisjoint(attrs):
            if not self.decide(subject, "history", entity_id, ctx).allowed:
                return {**state, "a": {k: v for k, v in attrs.items() if k not in LOCATION_ATTRS}}
        return state


def _matches(g: Grant, entity_id: str | None, feature: str | None, areas: frozenset[str], ctx: Context) -> bool:
    if entity_id is None:  # a feature request: only that feature's grants, or an unnarrowed `all`
        if g.resource_kind == "all":
            return not g.domains
        return g.resource_kind == "feature" and g.resource == feature
    domain = domain_of(entity_id)
    if g.domains and domain not in g.domains:
        return False
    kind = g.resource_kind
    if kind == "all":
        return True
    if kind == "entity":
        return fnmatch.fnmatchcase(entity_id, g.resource)
    if kind == "domain":
        return domain == g.resource
    if kind == "feature":
        return in_feature(g.resource, entity_id, ctx)
    if kind == "area":
        area = ctx.area_of(entity_id)
        if not area:
            return False
        if g.resource == SUBJECT_AREAS:
            return any(ctx.resolve_area(a) == area for a in areas)
        return ctx.resolve_area(g.resource) == area
    if kind == "floor":
        floor = ctx.floor_of(entity_id)
        return bool(floor) and ctx.resolve_floor(g.resource) == floor
    return False


DEFAULT_POLICY = Policy()


def decide(subject: Subject, action: str, entity_id: str | None, ctx: Context, policy: Policy | None = None,
           *, feature: str | None = None) -> Decision:
    return (policy or DEFAULT_POLICY).decide(subject, action, entity_id, ctx, feature=feature)


def visible(subject: Subject, entity_id: str, ctx: Context, policy: Policy | None = None) -> bool:
    return (policy or DEFAULT_POLICY).visible(subject, entity_id, ctx)


def guest_until(user_id: str, until: float, note: str = "guest access ends") -> Grant:
    """Time-box a guest: from `until` on, an explicit deny of everything for that user."""
    return Grant(effect="deny", actions="*", resource_kind="all", users={user_id},
                 schedule=Schedule(not_before=until), note=note)


class Gate:
    """One client session's read filter, the hook `view.ClientView` takes.

    `policy` may be a Policy or a callable returning the current one (so grant edits apply at once);
    `context` is a callable returning a fresh Context (now, registry lookups)."""

    def __init__(self, policy: Policy | Callable[[], Policy], subject: Subject,
                 context: Callable[[], Context]) -> None:
        self._policy = policy
        self.subject = subject
        self._context = context

    @property
    def policy(self) -> Policy:
        return self._policy() if callable(self._policy) else self._policy

    def visible(self, entity_id: str) -> bool:
        return self.policy.visible(self.subject, entity_id, self._context())

    def redact(self, entity_id: str, state: dict) -> dict:
        return self.policy.redact(self.subject, entity_id, state, self._context())
