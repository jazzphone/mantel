"""P3.7 wiring: from a request's identity (P3.1) to an RBAC subject (P3.2), and the hooks the read
filter (view.py), the connectors (P3.4) and the command gateway (P3.3) decide with.

* **The door.** ``resolve_door`` is installed as ``app["door_resolver"]`` (sessions.door_of asks it).
  Caddy (P3.6) stamps ``X-Mantel-Door: lan|tunnel`` after deleting any client value. Mantel believes
  a *lan* claim only from a peer in ``cfg.trusted_proxies``; a request from loopback with no claim is
  the loopback prototype and is ``lan``; anything else is ``tunnel`` (fail closed). A claim that can
  only tighten the rules (``tunnel``, or any Cloudflare header) is honoured from anyone.
* **The principal.** One per client connection (``Principal``): the session's Identity, the Subject
  built from it (roles, ids, door, ``fresh_factor_at``, the stored area scopes; a tablet with no
  stored scope gets its enrolled room), and the source IP. ``refresh`` re-reads the session and the
  device from the database, so a step-up, a role change or a revocation counts at the next command
  (and on the once-a-minute tick for what a socket may see).
* **The house policy.** The stored policy (``RbacStore.policy()``) plus two house decisions, both
  recorded in docs/phase3/GATEWAY.md:
    - camera live view needs no step-up on the LAN door (the doorbell pop-up on the wall tablets
      must open without a PIN); on the tunnel the rules are unchanged;
    - a wall tablet may view and live-view every camera (the doorbell pop-up shows on all tablets,
      whatever room the doorbell is in). Devices are refused on the tunnel door anyway.
* **Hooks** for ``connectors.Hooks``: ``may_read(principal, kind, ids)``, ``may_view(principal, eid)``.
"""
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field, replace
from ipaddress import ip_address
from typing import Any, Callable, Iterable

from aiohttp import web

from . import rbac, sessions
from .rbac import Context, Decision, Grant, Policy, Subject

log = logging.getLogger("mantel.authz")

CF_HEADERS = ("Cf-Connecting-Ip", "Cf-Access-Jwt-Assertion", "Cf-Ray")
DOOR_HEADER = "X-Mantel-Door"
ENTITY_ID = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
# P3.4's feature names that are not RBAC features: media browsing is decided as music.
FEATURE_ALIASES = {"media": "music"}
# Sensitive kinds that skip step-up on the LAN door only (decision recorded in GATEWAY.md).
LAN_STEP_UP_EXEMPT = frozenset({"camera"})
# House grants added to the stored policy (decision recorded in GATEWAY.md).
HOUSE_GRANTS: tuple[Grant, ...] = (
    Grant(effect="allow", actions=("view", "control.sensitive"), resource_kind="feature", resource="cameras",
          roles={"wall_tablet"}, note="the doorbell pop-up on every wall tablet (LAN only: devices never on the tunnel)"),
    # Phase 4 music (docs/phase4/MANTEL-FEATURES.md "Music"; recorded for Avery's review): HK's Music page on every
    # wall tablet, as in HA (each tablet is an HA user who may use it). Which speakers it shows and plays stays
    # its room's (the role's area grants); an Owner adjusts it with an ordinary deny grant.
    Grant(effect="allow", actions=("view", "control"), resource_kind="feature", resource="music",
          roles={"wall_tablet"}, note="HK's Music page on every wall tablet; its speakers are still its room's"),
    Grant(effect="allow", actions=("view",), resource_kind="feature", resource="live_tv",
          roles={"wall_tablet"}, note="Live TV on every wall tablet, as in HA (each channel's camera: the grant above)"),
)

# THE DOORBELL'S TALK-BACK SPEAKERS for wall tablets (decision recorded in GATEWAY.md "Doorbell
# talk-back"). HK configures the doorbell pop-up in its own settings (a pop-up of kind `camera`: its
# `entity` camera and its `speaker`, hk_core settings.model.popup; Mantel's settings store keeps them
# as the house document `popups`). Every wall tablet may `control` exactly those speakers, and ONLY
# for talk-back (the gateway's two talk checks decide with talk_policy; any other command on the
# speaker -- volume, play, power -- is decided without it, by the tablet's room as before). An Owner
# adjusts it with an ordinary grant: an explicit deny on the speaker for `wall_tablet` (or one device)
# wins, since deny always wins over allow.
TALK_ROLES = frozenset({"wall_tablet"})
TALK_NOTE = "talk-back on the doorbell's speaker, from HK's pop-up settings (talk only)"
_SPEAKER = re.compile(r"^media_player\.[a-z0-9_]+$")


def talk_speakers(popups: Iterable[Any]) -> frozenset[str]:
    """The speakers of HK's camera pop-ups (the doorbell sheet's talk-back target)."""
    out = set()
    for p in popups or ():
        if not isinstance(p, dict) or (p.get("kind") or "camera") != "camera":
            continue
        sp = p.get("speaker")
        if isinstance(sp, str) and _SPEAKER.match(sp):
            out.add(sp)
    return frozenset(out)


def talk_grants(speakers: Iterable[str]) -> tuple[Grant, ...]:
    return tuple(Grant(effect="allow", actions=("control",), resource_kind="entity", resource=s, roles=TALK_ROLES,
                       note=TALK_NOTE) for s in sorted(speakers))


def _is_loopback(peer: str | None) -> bool:
    try:
        return peer is not None and ip_address(peer).is_loopback
    except ValueError:
        return False


def resolve_door(request: web.Request) -> str:
    """'lan' or 'tunnel' for this request (see the module docstring). Never raises."""
    cfg = request.app.get("cfg")
    trusted = tuple(getattr(cfg, "trusted_proxies", ()) or ())
    h = request.headers
    if any(k in h for k in CF_HEADERS):
        return "tunnel"
    claim = h.get(DOOR_HEADER)
    claim = claim.strip().lower() if claim is not None else None
    peer = request.remote
    if peer is not None and peer in trusted:
        if claim == "lan":
            # with the home's own proxy, only with this installation's door key (door_key.py)
            from . import door_key, proxy_trust
            if door_key.door_allowed(request):
                return "lan"
            proxy_trust._warn(peer, f"{DOOR_HEADER}: lan without the right {door_key.HEADER}")
        return "tunnel"                                   # Caddy always stamps: missing/unknown fails closed
    if claim is not None and claim != "lan":
        return "tunnel"                                   # a stricter claim is honoured from anyone
    if claim == "lan" and not _is_loopback(peer):
        log.warning("ignored %s: lan from untrusted peer %s", DOOR_HEADER, peer)
    return "lan" if _is_loopback(peer) else "tunnel"


@dataclass
class Principal:
    """Who is on one client connection. Mutable: ``Authz.refresh`` keeps it current."""
    identity: sessions.Identity
    subject: Subject
    source_ip: str | None = None
    gate: Any = None                      # the rbac.Gate of this connection's read filter
    valid: bool = True
    extra: dict = field(default_factory=dict)

    @property
    def user(self) -> sessions.User | None:
        return self.identity.user

    @property
    def device(self) -> sessions.Device | None:
        return self.identity.device

    @property
    def door(self) -> str:
        return self.identity.door

    @property
    def fresh_factor_at(self) -> float | None:
        return self.identity.fresh_factor_at


class Authz:
    def __init__(self, app: web.Application, hub, rbac_store, clock: Callable[[], float] = time.time) -> None:
        self.app = app
        self.hub = hub
        self.rbac = rbac_store
        self.clock = clock
        self.tz = getattr(app.get("cfg"), "house_tz", "UTC") or "UTC"
        self.tz_source = "config"
        self._derived: dict[str, tuple[Policy, Policy]] = {}   # door -> (stored policy, house policy)
        self._ctx: tuple[tuple, Context] | None = None

    # -- time and registry ------------------------------------------------------------------------
    def set_tz(self, tz: str, source: str) -> bool:
        """Use `tz` (an IANA name) for schedules. False if it is not a zone this system knows."""
        try:
            Context(now=0.0, tz=tz)
        except Exception:  # noqa: BLE001 -- ZoneInfoNotFoundError, ValueError, ...
            log.warning("house time zone %r is unknown here; keeping %s", tz, self.tz)
            return False
        changed = tz != self.tz
        self.tz, self.tz_source = tz, source
        return changed

    def context(self) -> Context:
        """Registry lookups and the exact time. The lookups (which read the live registry) are built
        once per zone and registry; the time is always now (a step-up must count at once: a factor
        stamped later than a cached `now` would look like one from the future)."""
        now = self.clock()
        key = (self.tz, id(self.hub.registry), id(self.hub.store))
        cached = self._ctx
        if cached is None or cached[0] != key:
            cached = (key, Context.from_registry(self.hub.registry, now, self.tz, self.hub.store.states))
            self._ctx = cached
        return replace(cached[1], now=now)

    # -- the policy -------------------------------------------------------------------------------
    def policy_for(self, subject: Subject) -> Policy:
        base = self.rbac.policy()            # cached by the store until a grant/role/scope write
        cached = self._derived.get(subject.door)
        if cached is not None and cached[0] is base:
            return cached[1]
        exempt = base.step_up_exempt | (LAN_STEP_UP_EXEMPT if subject.door == "lan" else frozenset())
        got = replace(base, grants=tuple(base.grants) + HOUSE_GRANTS, step_up_exempt=exempt)
        self._derived[subject.door] = (base, got)
        return got

    def decide(self, subject: Subject, action: str, entity_id: str | None, *, feature: str | None = None,
               ctx: Context | None = None) -> Decision:
        return self.policy_for(subject).decide(subject, action, entity_id, ctx or self.context(), feature=feature)

    # -- talk-back (the doorbell's speaker for wall tablets; see TALK_ROLES) ------------------------
    def talk_speakers(self) -> frozenset[str]:
        """The doorbell talk-back speakers HK's pop-up settings name (Mantel's settings store)."""
        svc = self.app.get("settings")
        store = getattr(svc, "store", None)
        if store is None:
            return frozenset()
        try:
            return talk_speakers(store.body("house", "popups").get("items") or [])
        except Exception:  # noqa: BLE001 -- unreadable settings grant nothing
            log.exception("could not read HK's pop-ups for the talk-back speakers")
            return frozenset()

    def talk_policy(self, subject: Subject) -> Policy:
        """The house policy plus the talk-back speaker grants. Used ONLY for the talk-back checks."""
        base = self.policy_for(subject)
        speakers = self.talk_speakers()
        if not speakers:
            return base
        key = (id(base), speakers)
        cached = getattr(self, "_talk_cache", None)
        if cached is not None and cached[0] == key and cached[1] is base:
            return cached[2]
        got = replace(base, grants=tuple(base.grants) + talk_grants(speakers))
        self._talk_cache = (key, base, got)
        return got

    def decide_talk(self, subject: Subject, action: str, entity_id: str | None, *, feature: str | None = None,
                    ctx: Context | None = None) -> Decision:
        return self.talk_policy(subject).decide(subject, action, entity_id, ctx or self.context(), feature=feature)

    # -- identity -> subject ----------------------------------------------------------------------
    def rules_door(self, door: str) -> str:
        """The door whose RBAC rules apply. 'ha' (HA's sidebar through Ingress, HA App mode) follows
        cfg.ha_door_rules: "trusted" (the App's default, Avery 2026-10-18: the sidebar and the Companion
        app are trusted as HK in HA always was) and "lan" get the LAN's rules, "tunnel" the tunnel's
        (docs/phase3/HA-APP.md). Unknown: tunnel (fail closed)."""
        if door == "ha":
            return "lan" if self.ha_door_mode() in ("trusted", "lan") else "tunnel"
        return door if door in rbac.DOORS else "tunnel"

    def ha_door_mode(self) -> str:
        mode = getattr(self.app.get("cfg"), "ha_door_rules", "tunnel")
        return mode if mode in ("trusted", "lan", "tunnel") else "tunnel"

    def ha_trusted(self, ident: sessions.Identity) -> bool:
        """A person through HA's sidebar when the sidebar is trusted: HA's own sign-in is the factor
        (no Mantel step-up), as HK in HA never asked for one. Roles still decide what they may do."""
        return ident.door == "ha" and ident.user is not None and self.ha_door_mode() == "trusted"

    def subject_of(self, ident: sessions.Identity) -> Subject:
        u, d = ident.user, ident.device
        subject = self.rbac.subject(user_role=u.role if u else None, user_id=u.id if u else None,
                                    device_role=d.role if d else None, device_id=d.id if d else None,
                                    door=self.rules_door(ident.door),
                                    fresh_factor_at=(self.clock() if self.ha_trusted(ident)
                                                     else ident.fresh_factor_at if u else None))
        if d is not None and not subject.device_areas and d.room:
            subject = replace(subject, device_areas=frozenset({d.room}))  # its enrolled room, until scoped
        return subject

    def principal(self, request: web.Request) -> Principal:
        ident = sessions.identity(request)
        p = Principal(ident, self.subject_of(ident), sessions.client_ip(request))
        p.gate = rbac.Gate(lambda: self.policy_for(p.subject), p.subject, self.context)
        return p

    def with_person(self, p: Principal, person: sessions.User, factor: str = "pin") -> Principal:
        """A person who just proved themselves at this device (their PIN at a wall tablet), for ONE
        command: the device's principal with that person as the user and a factor fresh now, so the
        engine decides person ∩ device. Nothing is stored; the socket keeps its own principal."""
        ident = replace(p.identity, user=person, fresh_factor_at=self.clock(), fresh_factor=factor,
                        session_id=None, csrf=None)
        return Principal(ident, self.subject_of(ident), p.source_ip, gate=None, valid=p.valid,
                         extra={"person_at_device": True})

    def refresh(self, p: Principal) -> bool:
        """Re-read the session and device rows. False (and ``p.valid`` cleared) when either is gone."""
        ident = p.identity
        now = self.clock()
        user, fresh_at, fresh = ident.user, ident.fresh_factor_at, ident.fresh_factor
        if ident.session_id is not None:
            mgr = self.app.get("sessions")
            row = mgr.get(ident.session_id, now) if mgr is not None else None
            if row is None:
                p.valid = False
                return False
            user = sessions.user_from_row(row)
            fresh_at, fresh = row["fresh_factor_at"], row["fresh_factor"]
        device = ident.device
        if device is not None:
            mgr = self.app.get("devices")
            row = mgr.get(device.id) if mgr is not None else None
            if row is None or row["revoked"] is not None:
                p.valid = False
                return False
            device = sessions.Device(id=row["id"], name=row["name"], role=row["role"], room=row["room"])
        p.identity = replace(ident, user=user, device=device, fresh_factor_at=fresh_at, fresh_factor=fresh)
        p.subject = self.subject_of(p.identity)
        if p.gate is not None:
            p.gate.subject = p.subject
        return True

    # -- the P3.4 hooks ---------------------------------------------------------------------------
    def may_read(self, principal: Any, kind: str, ids: Iterable[str]) -> list[str]:
        """The ids (entity ids, statistic ids that are entity ids, or ``feature:<name>``) the subject
        may ``kind`` ("view" / "history"). Anything else is refused."""
        if not isinstance(principal, Principal) or not principal.valid or kind not in ("view", "history"):
            return []
        subject, ctx = principal.subject, self.context()
        policy = self.policy_for(subject)
        out = []
        for i in ids:
            if not isinstance(i, str):
                continue
            if i.startswith("feature:"):
                f = FEATURE_ALIASES.get(i[8:], i[8:])
                if f in rbac.FEATURE_DOMAINS and policy.decide(subject, kind, None, ctx, feature=f).allowed:
                    out.append(i)
            elif ENTITY_ID.match(i) and policy.decide(subject, kind, i, ctx).allowed:
                out.append(i)
        return out

    def may_view(self, principal: Any, entity_id: str) -> bool:
        """Camera live view (``camera.live``): exactly True or False; no prompt can be shown here."""
        if not isinstance(principal, Principal) or not principal.valid or not isinstance(entity_id, str):
            return False
        if not ENTITY_ID.match(entity_id):
            return False
        return self.decide(principal.subject, "camera.live", entity_id).allowed is True

    def may_still(self, principal: Any, entity_id: str) -> bool:
        """A camera still (``GET /api/camera/<entity>/still``): the live-view policy minus step-up.
        The subject may ``view`` the camera, and ``camera.live`` is allowed or only waits for a fresh
        factor; the door's camera rules (the tunnel's ``tunnel_cameras``) refuse as they do for live
        view. Exactly True or False."""
        if not isinstance(principal, Principal) or not principal.valid or not isinstance(entity_id, str):
            return False
        if not ENTITY_ID.match(entity_id) or not entity_id.startswith("camera."):
            return False
        ctx = self.context()
        if not self.decide(principal.subject, "view", entity_id, ctx=ctx).allowed:
            return False
        live = self.decide(principal.subject, "camera.live", entity_id, ctx=ctx)
        return bool(live.allowed or live.needs_step_up)

    def may_see(self, principal: Any, entity_id: str) -> bool:
        """Plain ``view`` of one entity (no camera live-view rules, unlike ``may_view``) for a route that serves something of it (media artwork).
        Exactly True or False."""
        if not isinstance(principal, Principal) or not principal.valid or not isinstance(entity_id, str):
            return False
        if not ENTITY_ID.match(entity_id):
            return False
        return self.decide(principal.subject, "view", entity_id).allowed is True

    def visible(self, principal: Principal | None, entity_id: str) -> bool:
        return principal is None or principal.gate is None or principal.gate.visible(entity_id)
