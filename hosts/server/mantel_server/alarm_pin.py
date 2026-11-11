"""HK's Alarm PIN in Mantel (docs/phase3/PINS-AUDIT.md "The alarm keypad", docs/phase3/GATEWAY.md "The
alarm", docs/phase4/MANTEL-FEATURES.md).

WHAT HA'S FEATURE DOES (hk_frontend/features/alarm_pin): a second alarm panel in front of an alarm that
takes no code. Disarming always needs its PIN; arming needs it while "Require the PIN to arm" is on (off:
no PIN arms, but a PIN that IS given must still be right). The PIN is kept only as a salted hash and is
compared in constant time; a wrong one is refused with an error every keypad shows as "Wrong code". The
PIN goes on to the protected alarm only if that alarm asks for a code of its own. Anyone who knows the PIN
may use it; HA counts no attempts.

WHAT MANTEL DOES. HK's keypad card is unchanged: it calls ``alarm_control_panel.alarm_<x>`` with
``{entity_id, code}``. The gateway takes the code OUT of the command before anything is audited or sent
(gateway.service_command) and asks this module:

THE ONLY PIN IN MANTEL (decision 25): the house Alarm PIN, for the alarm only. No
other action asks for a PIN or a step-up, and a person's own PIN is not accepted here (if someone's PIN is
the same digits as the Alarm PIN, fine: it is the Alarm PIN that is checked).

* **The code** is checked here, never by Home Assistant and never sent back to a page: the house's own
  Alarm PIN for that keypad (an Argon2id hash in ``alarm_pins``, set by an Owner/Admin in Mantel, HK
  Settings -> Alarm PIN). The same rule on every door (wall tablet, HA's sidebar, LAN, tunnel). A wrong code
  counts once where it was typed (``pins.Pins.keypad``: a tablet's place ``device:<id>``, a person's
  session ``keypad:user:<id>``; 5 wrong in a row lock that place for 15 minutes; 20 per IP per 15
  minutes). Wrong or locked: a ``denied`` audit row, nothing sent, the card says "Wrong code". No Alarm PIN
  set while a code is needed: refused ``alarm_pin_not_set``, nothing sent.
* **Which keypad**: the panel the command names, or the keypad that protects the alarm it names
  (``entry_for``), so the house Alarm PIN guards the alarm both ways. An alarm no keypad covers has no
  Alarm PIN: it is refused whenever a code is needed (Mantel never disarms it without one).
* **Who may**: RBAC first, before the code is looked at, with ``control.sensitive`` on the keypad panel
  AND the alarm it forwards to whenever a code is needed (disarm; arm with ``arm_required``; any code
  given). A Child (deny on the alarm domain) is refused whatever code they type. Wall tablets may use a
  configured keypad (``tablets``, default on, mirroring HA's keypads on every screen) through grants used
  ONLY for keypad commands (``keypad_policy``); an Owner's deny grant still wins.
* **The alarm's own HA code**: if the panel Mantel sends to reports a ``code_format``, Mantel adds the code
  it holds for it (``ha_code``, sealed with Mantel's secret key); none held: refused
  ``alarm_ha_code_missing`` before anything is sent. The page's code never goes to Home Assistant.

LINKED MODE (linked_house.LinkedHouse._alarm is the only caller): ``linked_command(app, entity=...,
command=..., code=..., account=..., peer=...)`` runs HA's forwarded ``alarm_*`` entity command through the
SAME gateway path as the Service actor ``mantel:linked`` (grants on the configured keypads only; wrong
codes counted at ``keypad:mantel:linked``), raising ``linked.LinkedError`` (``linked_error``: one table
from the gateway's refusals to the wire codes ``invalid_code``, ``code_locked``, ``code_required``,
``alarm_pin_not_set``, ``forbidden``, ``commands_disabled``, ``alarm_ha_code_missing``, ...) for HA to
show. The audit's actor is the linked Service actor. Which alarm the linked panel forwards to is this table's row
(linked_house makes one from HA's registry when there is none).

REST (Owner/Admin, fresh factor; a PIN or code is never returned): ``GET /api/alarm/pins``, ``PUT
/api/alarm/pins/{entity}`` ``{forward_to, pin, pin_again, arm_required, tablets, ha_code}``, ``DELETE
/api/alarm/pins/{entity}``, ``POST /api/alarm/pins/import`` (HA's ``hk_alarm_pin/settings/get``, a
server-only read: which panel protects which alarm and the arm rule; HA never gives out its PIN's hash,
so the PIN itself is set again in Mantel).
"""
from __future__ import annotations

import logging
import re
import sqlite3
from dataclasses import dataclass
from typing import Any, Callable, Mapping

from aiohttp import web
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from .storage import audit
from .identity.accounts import PolicyError, read_json
from .identity.guards import guard
from .identity.guards import ident as guarded
from .identity.sessions import error, ok

log = logging.getLogger("mantel.alarm_pin")

DOMAIN = "alarm_control_panel"
DISARM = "alarm_disarm"
SERVICES = frozenset({DISARM, "alarm_arm_home", "alarm_arm_away", "alarm_arm_night", "alarm_arm_vacation",
                      "alarm_arm_custom_bypass", "alarm_trigger"})
CODE = re.compile(r"^\d{4,10}$")       # HK's keypad types digits, at most 10
HA_CODE_MAX = 64
PANEL = re.compile(r"^alarm_control_panel\.[a-z0-9_]+$")
LINKED_ACTOR = "mantel:linked"
LINKED_ACTOR_NAME = "Home Assistant (linked)"
SENSITIVE = "alarm_control_panel"
_KEEP = object()
_DUMMY_PIN = "000000-not-a-pin"


@dataclass(frozen=True)
class Entry:
    """A keypad Mantel guards. ``house_code``/``ha_code``: whether one is set (never the values)."""
    entity: str
    forward_to: str
    arm_required: bool = True
    tablets: bool = True
    house_code: bool = False
    ha_code: bool = False
    configured: bool = True

    def targets(self) -> list[str]:
        return list(dict.fromkeys([self.entity, self.forward_to]))

    def needs_code(self, service: str, code: str | None) -> bool:
        """HA's rule: disarming always; arming (and trigger) while arm_required; and any code given."""
        return service == DISARM or self.arm_required or code is not None

    def to_dict(self) -> dict:
        return {"entity": self.entity, "forward_to": self.forward_to, "arm_required": self.arm_required,
                "tablets": self.tablets, "house_code": self.house_code, "ha_code": self.ha_code}


def unconfigured(entity: str) -> Entry:
    return Entry(entity, entity, arm_required=True, tablets=False, configured=False)


@dataclass(frozen=True)
class Verdict:
    """What the keypad's code turned out to be: ``house`` (the house Alarm PIN) / ``none`` (no code was
    needed or given), or a refusal: ``invalid`` / ``locked`` (retry_after)."""
    status: str
    retry_after: float = 0.0

    @property
    def ok(self) -> bool:
        return self.status in ("house", "none")


class AlarmPins:
    def __init__(self, conn: sqlite3.Connection, clock: Callable[[], float],
                 hasher: Callable[[], PasswordHasher] | None = None, box: Callable[[], Any] | None = None) -> None:
        self.db = conn
        self.clock = clock
        self._hasher = hasher or (lambda: _DEFAULT_HASHER)
        self._box = box or (lambda: None)
        self._dummy: str | None = None

    @property
    def hasher(self) -> PasswordHasher:
        return self._hasher()

    # -- reading --------------------------------------------------------------------------------------
    @staticmethod
    def _entry(r: sqlite3.Row) -> Entry:
        return Entry(r["entity"], r["forward_to"], bool(r["arm_required"]), bool(r["tablets"]),
                     r["pin_hash"] is not None, r["ha_code"] is not None)

    def entry(self, entity: str) -> Entry | None:
        r = self.db.execute("SELECT * FROM alarm_pins WHERE entity = ?", (entity,)).fetchone()
        return self._entry(r) if r is not None else None

    def entry_or_default(self, entity: str) -> Entry:
        return self.entry(entity) or unconfigured(entity)

    def entry_for(self, entity: str) -> Entry:
        """The keypad for a command naming `entity`: its own row (a panel), else the keypad that protects
        it (``forward_to``; the first by panel name if several do), else an unconfigured entry."""
        got = self.entry(entity)
        if got is not None:
            return got
        r = self.db.execute("SELECT * FROM alarm_pins WHERE forward_to = ? ORDER BY entity LIMIT 1",
                            (entity,)).fetchone()
        return self._entry(r) if r is not None else unconfigured(entity)

    def entries(self) -> list[Entry]:
        return [self._entry(r) for r in self.db.execute("SELECT * FROM alarm_pins ORDER BY entity")]

    def ha_code(self, entity: str) -> str | None:
        """The alarm's own HA code (server side only: the gateway adds it to the frame for HA)."""
        r = self.db.execute("SELECT ha_code FROM alarm_pins WHERE entity = ?", (entity,)).fetchone()
        box = self._box()
        if r is None or r["ha_code"] is None or box is None:
            return None
        return box.open(bytes(r["ha_code"]), f"alarm_ha_code:{entity}").decode()

    # -- the house code -------------------------------------------------------------------------------
    async def _verify(self, stored: str, code: str) -> bool:
        import asyncio

        def run() -> bool:
            try:
                return self.hasher.verify(stored, code)
            except (VerifyMismatchError, VerificationError, InvalidHashError):
                return False
        return await asyncio.get_running_loop().run_in_executor(None, run)

    async def house_matches(self, entity: str, code: str) -> bool:
        """Is `code` this keypad's house Alarm PIN? With none set, a dummy hash is verified anyway, so
        the time taken does not say whether a keypad has one (Argon2's compare is constant time)."""
        r = self.db.execute("SELECT pin_hash FROM alarm_pins WHERE entity = ?", (entity,)).fetchone()
        stored = r["pin_hash"] if r is not None else None
        if stored is None:
            if self._dummy is None:
                import asyncio
                self._dummy = await asyncio.get_running_loop().run_in_executor(None, self.hasher.hash, _DUMMY_PIN)
            await self._verify(self._dummy, code)
            return False
        good = await self._verify(stored, code)
        if good:
            with self.db:
                self.db.execute("UPDATE alarm_pins SET last_used = ? WHERE entity = ?", (self.clock(), entity))
        return good

    # -- setting --------------------------------------------------------------------------------------
    async def set(self, entity: str, *, forward_to: Any = _KEEP, pin: Any = _KEEP, pin_again: Any = _KEEP,
                  arm_required: Any = _KEEP, tablets: Any = _KEEP, ha_code: Any = _KEEP,
                  source: str = "mantel", before: Callable[[], None] | None = None) -> Entry:
        """Create or change a keypad. A new PIN is typed twice (HA's form); ``pin: None`` removes the house
        code (the keypad then refuses whatever needs a code); ``ha_code: None`` clears the alarm's own code. PolicyError by field.
        ``before()`` runs once everything is accepted and before anything is stored (the audit row); if it raises,
        nothing is stored."""
        import asyncio
        if not isinstance(entity, str) or not PANEL.match(entity):
            raise PolicyError("entity", "an alarm_control_panel entity")
        cur = self.entry(entity)
        fwd = (cur.forward_to if cur else entity) if forward_to is _KEEP or forward_to in (None, "") else forward_to
        if not isinstance(fwd, str) or not PANEL.match(fwd):
            raise PolicyError("forward_to", "an alarm_control_panel entity")
        values: dict[str, Any] = {"forward_to": fwd}
        for name, v in (("arm_required", arm_required), ("tablets", tablets)):
            if v is not _KEEP:
                if not isinstance(v, bool):
                    raise PolicyError(name, "true or false")
                values[name] = int(v)
        if pin is not _KEEP or pin_again is not _KEEP:
            if pin is None and pin_again in (None, _KEEP):
                values["pin_hash"] = None
            else:
                if not isinstance(pin, str) or not CODE.match(pin):
                    raise PolicyError("pin", "the Alarm PIN is 4 to 10 digits (HK's keypad types digits)")
                if pin_again != pin:
                    raise PolicyError("pin_again", "the two PINs don't match; type the same PIN in both")
                values["pin_hash"] = await asyncio.get_running_loop().run_in_executor(None, self.hasher.hash, pin)
        if ha_code is not _KEEP:
            if ha_code is None or ha_code == "":
                values["ha_code"] = None
            else:
                box = self._box()
                if not isinstance(ha_code, str) or len(ha_code) > HA_CODE_MAX or box is None:
                    raise PolicyError("ha_code", f"the alarm's own code: text, at most {HA_CODE_MAX} characters")
                values["ha_code"] = box.seal(ha_code.encode(), f"alarm_ha_code:{entity}")
        if before is not None:
            before()
        now = self.clock()
        with self.db:
            if cur is None:
                self.db.execute("INSERT INTO alarm_pins (entity, forward_to, created, updated, source) VALUES (?,?,?,?,?)",
                                (entity, fwd, now, now, source))
            sets = ", ".join(f"{k} = ?" for k in values)
            self.db.execute(f"UPDATE alarm_pins SET {sets}, updated = ? WHERE entity = ?",  # noqa: S608 -- fixed names
                            (*values.values(), now, entity))
        log.info("alarm keypad %s set (%s)", entity, ", ".join(sorted(k for k in values if k != "forward_to")) or "forward_to")
        return self.entry(entity)  # type: ignore[return-value]

    def remove(self, entity: str) -> bool:
        with self.db:
            return self.db.execute("DELETE FROM alarm_pins WHERE entity = ?", (entity,)).rowcount > 0

    async def import_ha_page(self, page: Any, before: Callable[[dict], None] | None = None) -> dict:
        """HA's ``hk_alarm_pin/settings/get`` page -> keypads: each Alarm PIN panel (``entity``) forwards
        to the alarm it protects (``forward_to``: that alarm takes no code of its own), with its arm rule.
        HA never gives out its PIN or hash: an existing Mantel house code is kept, a new keypad has none
        (``need_pin``) until an Owner sets it; until then it refuses whatever needs a code. ``before(plan)``
        runs with what will be imported (the answer, worked out first) before anything is stored."""
        if not isinstance(page, Mapping) or not isinstance(page.get("alarms"), list):
            raise ValueError("Home Assistant's answer has no Alarm PIN page in it")
        todo = []
        for a in page["alarms"]:
            if not isinstance(a, Mapping):
                continue
            panel, alarm = a.get("panel"), a.get("alarm")
            if not (isinstance(panel, str) and PANEL.match(panel) and isinstance(alarm, str) and PANEL.match(alarm)):
                continue
            todo.append((panel, alarm, bool(a.get("arm_required", True))))
        had = {panel: (e is not None and e.house_code) for panel, _, _ in todo for e in [self.entry(panel)]}
        plan = {"imported": [p for p, _, _ in todo], "need_pin": [p for p, _, _ in todo if not had[p]]}
        if before is not None:
            before(plan)
        for panel, alarm, arm in todo:
            await self.set(panel, forward_to=alarm, arm_required=arm, source="ha")
        return plan

    # -- the keypad's code ----------------------------------------------------------------------------
    async def check(self, principal: Any, entry: Entry, code: str, pins: Any, *, place: str | None = None) -> Verdict:
        """The code typed at `entry`'s keypad by `principal`: the house Alarm PIN or nothing (see the
        module docstring). The lockout counters are pins.py's (``Pins.keypad``)."""
        if pins is None or not entry.configured:
            return Verdict("invalid")
        u, d = principal.user, principal.device
        session_person = u is not None and getattr(u, "kind", None) != "service"
        if place is None:
            place = (f"keypad:user:{u.id}" if session_person else f"device:{d.id}" if d is not None
                     else f"keypad:{u.id if u is not None else 'anonymous'}")
        status, wait = await pins.keypad(code, place=place, ip=principal.source_ip,
                                         house=lambda c: self.house_matches(entry.entity, c))
        if status == "locked":
            return Verdict("locked", retry_after=wait)
        return Verdict("house" if status == "house" else "invalid")

    # -- RBAC for keypad commands only ----------------------------------------------------------------
    def grants(self) -> tuple:
        from .identity.rbac import Grant
        out = []
        for e in self.entries():
            for eid in e.targets():
                if e.tablets:
                    out.append(Grant(effect="allow", actions=("control", "control.sensitive"), resource_kind="entity",
                                     resource=eid, roles={"wall_tablet"},
                                     note="HK's alarm keypad on the wall tablets (keypad commands only)"))
                out.append(Grant(effect="allow", actions=("control", "control.sensitive"), resource_kind="entity",
                                 resource=eid, users={LINKED_ACTOR},
                                 note="the linked HA's alarm panel, with a right code (keypad commands only)"))
        return tuple(out)

    def keypad_policy(self, authz: Any, subject: Any) -> Any:
        """The house policy plus the keypad grants. Used ONLY for keypad (alarm_*) commands."""
        from dataclasses import replace
        base = authz.policy_for(subject)
        extra = self.grants()
        return replace(base, grants=tuple(base.grants) + extra) if extra else base


_DEFAULT_HASHER = PasswordHasher()


def is_keypad(domain: Any, service: Any) -> bool:
    return domain == DOMAIN and service in SERVICES


# -- linked mode -----------------------------------------------------------------------------------------
def linked_principal(app: web.Application, peer: str | None = None) -> Any:
    """The Service actor a linked HA's alarm commands run as (LAN only, as linked mode is)."""
    from .identity.authz import Principal
    from .identity.sessions import Identity, User
    ident = Identity(user=User(id=LINKED_ACTOR, name=LINKED_ACTOR_NAME, role="service", kind="service"),
                     device=None, door="lan")
    authz = app["authz"]
    return Principal(ident, authz.subject_of(ident), peer)


async def linked_command(app: web.Application, *, entity: str, command: str, code: str | None,
                         account: Any = None, peer: str | None = None) -> Any:
    """FOR linked.py's ``alarm_*`` handler: HA forwarded ``command`` (alarm_disarm, alarm_arm_away, ...) on
    the linked alarm panel ``entity`` with the code its user typed. The code is checked here, RBAC decides,
    the audit row is written first, and the command goes to HA only with commands on -- through the SAME
    gateway code as a page's keypad. Returns the command's result; raises ``linked.LinkedError``."""
    from .ha import gateway as G
    from .linked import LinkedError
    if command not in SERVICES:
        raise LinkedError("unknown_command", f"an alarm takes no {command!r}")
    if not isinstance(entity, str) or not PANEL.match(entity):
        raise LinkedError("invalid", "not an alarm panel")
    if code is not None and not isinstance(code, str):
        raise LinkedError("invalid", "code: text")
    gw = app.get("gateway")
    authz, audit = app.get("authz"), app.get("audit")
    if authz is None or audit is None:
        raise LinkedError("commands_disabled", "Mantel Server's command gateway is not wired")
    if gw is None:
        # commands off: the same decision path with no command connection (audited, nothing sent)
        gw = G.Gateway(app, authz, audit, None, G.load_writes(), lambda: app["clock"]())
    principal = linked_principal(app, peer)
    principal.extra["linked_account"] = getattr(account, "id", None)
    got: dict = {}

    async def send(reply: dict) -> None:
        got.update(reply)
    data: dict = {"entity_id": entity}
    if code not in (None, ""):
        data["code"] = code
    await gw.handle(principal, {"type": "command", "id": 1, "kind": "service", "domain": DOMAIN,
                                "service": command, "data": data}, send)
    if "result" in got:
        return got["result"]
    raise linked_error(got)


# The gateway's refusals as linked mode's wire codes, in ONE place. HA's LinkedAlarmPanel shows
# "Mantel Server refused <command> on <entity>: <message>" (a ServiceValidationError for the codes in
# linked_mode._VALIDATION); HK's keypad card says "Wrong code" for a message that mentions a code.
LINKED_MESSAGES = {
    "invalid_code": "Wrong code",
    "code_required": "Enter the alarm code",
    "alarm_pin_not_set": "No Alarm PIN is set for this alarm in Mantel (an Owner sets it in HK Settings, Alarm "
                         "PIN); nothing was sent",
    "commands_disabled": "house commands are disabled on this Mantel Server; nothing was sent",
    "alarm_ha_code_missing": "Mantel holds no code for the alarm itself (an Owner sets it in Mantel's Alarm PIN "
                             "settings); nothing was sent",
    "alarm_pin_unavailable": "Mantel Server has no Alarm PIN engine to check the code; nothing was sent",
}


def linked_error(reply: Mapping[str, Any]) -> Any:
    """The gateway's reply (not a result) -> ``linked.LinkedError``: ``invalid_code``, ``code_locked``
    (its message says how long), ``code_required``, ``alarm_pin_not_set``, ``forbidden``, ``commands_disabled``, ``alarm_ha_code_missing``, ... The typed code
    is never in a message."""
    from .linked import LinkedError
    err = reply.get("error") or {}
    c, msg = err.get("code") or "failed", err.get("message")
    if c == "unavailable" and msg in LINKED_MESSAGES:      # the gateway's reason rides in the message
        c = msg
    return LinkedError(c, LINKED_MESSAGES.get(c) or msg or c)


# -- HK Settings' Alarm PIN page ----------------------------------------------------------------------------
PAGE_SAVES = frozenset({"hk_alarm_pin/settings/set", "hk_alarm_pin/add"})


async def follow_page_save(app: Any, frame: Mapping[str, Any], result: Any) -> str | None:
    """HK Settings' Alarm PIN page still saves in Home Assistant (its checks: the length, typed twice; the
    gateway forwards it). Mantel's keypads check Mantel's own table, so what HA accepted is stored here too:
    the PIN (typed twice), the arm rule, and which alarm the panel stands in front of. Without it a PIN set
    in HK Settings was "not set" at every tablet (the house, 2026-10-20). Called after HA's success only, with
    HA's answer (its page). The panel it stored, or None; never raises, never logs a PIN."""
    pins = app.get("alarm_pin") if hasattr(app, "get") else None
    if pins is None or not isinstance(result, Mapping) or frame.get("type") not in PAGE_SAVES:
        return None
    alarms = [a for a in result.get("alarms") or [] if isinstance(a, Mapping)]
    if frame.get("type") == "hk_alarm_pin/settings/set":
        row = next((a for a in alarms if a.get("entry_id") == frame.get("entry_id")), None)
        changes = frame.get("changes") if isinstance(frame.get("changes"), Mapping) else {}
    else:
        row = next((a for a in alarms if a.get("alarm") == frame.get("alarm")), None)
        changes = {k: frame[k] for k in ("pin", "pin_again", "arm_required") if k in frame}
    panel = row.get("panel") if row is not None else None
    if not isinstance(panel, str) or not PANEL.match(panel):
        return None
    kw: dict[str, Any] = {}
    alarm = row.get("alarm")
    if isinstance(alarm, str) and PANEL.match(alarm):
        kw["forward_to"] = alarm
    if isinstance(changes.get("pin"), str) and changes.get("pin"):
        kw["pin"], kw["pin_again"] = changes["pin"], changes.get("pin_again")
    if isinstance(changes.get("arm_required"), bool):
        kw["arm_required"] = changes["arm_required"]
    elif pins.entry(panel) is None and isinstance(row.get("arm_required"), bool):
        kw["arm_required"] = row["arm_required"]           # a new row takes HA's arm rule
    try:
        await pins.set(panel, source="hk_settings", **kw)
    except Exception as exc:  # noqa: BLE001 -- HA's save stands; the page shows Mantel's own state
        log.warning("Alarm PIN for %s: HA took the page's save, Mantel's copy failed (%s)", panel, type(exc).__name__)
        return None
    log.info("Alarm PIN for %s: HK Settings' save stored in Mantel too (%s)", panel, ", ".join(sorted(kw)))
    return panel


# -- HK Settings' Alarm PIN page, answered by Mantel ---------------------------------------------------------
# The page (web/hk/panels/hk-settings-features.js) reads ``hk_alarm_pin/settings/get`` and saves with
# ``hk_alarm_pin/settings/set`` {entry_id, changes}, ``/add`` {alarm, pin, pin_again, arm_required} and ``/remove``
# {entry_id} (settings_store.FEATURE_SAVES, through feature_pages.py: ``configure`` on settings, commands on or off).
# Mantel answers them from THIS table: a row is a keypad (``entry_id`` is its panel's entity id), its alarm is
# ``forward_to``, ``pin_set`` is whether the house Alarm PIN is set here. Mantel Link publishes each keypad panel
# (linked_house.py), keeping the entity id HK Frontend gave it through the registry hand-over.
#
# WHILE HK FRONTEND STILL RUNS THE HOUSE'S KEYPADS (``hk_runs_keypads``: Mantel doesn't own ``house`` and HK Frontend
# is there), its own panel in Home Assistant checks its own PIN, so the page keeps 8d48e95's way: the save goes to HA
# first (through the gateway, as the person, commands on), and what HA took is copied here (``follow_page_save``);
# the page is HA's, with ``pin_set`` saying whether Mantel holds one. Once ``house`` is Mantel's, or there is no
# HK Frontend, nothing about the PIN goes to Home Assistant.
PAGE_MSG = {
    "no_entry": "That alarm has no PIN anymore.",
    "not_alarm": "That isn’t an alarm panel in this house.",
    "own_panel": "That is one of Alarm PIN’s own panels. Choose the alarm it should protect.",
    "taken": "That alarm already has a PIN.",
    "arm_required": "Choose on or off.",
    "unknown": "That setting doesn’t exist.",
    "pin_needed": "Type the PIN in both fields.",
}
PIN_MIN = 4


def hk_runs_keypads(app: Any) -> bool:
    """Does HK Frontend in Home Assistant still run the house's Alarm PIN panels? Not once Mantel owns ``house``
    (linked_owners.py). Otherwise: HK Frontend is linked to Mantel, or Mantel Link reports it installed; with no
    link at all, whether the one-time feature import found HK's Alarm PIN added."""
    owners = app.get("linked_owners")
    if owners is not None and owners.house():
        return False
    lk = app.get("linked")
    reg = getattr(lk, "registry", None)
    if reg is not None:
        if reg.clients_of("hk_frontend"):
            return True
        links = reg.clients_of("mantel")
        if links:
            return any((c.report.get("hk_frontend") or {}).get("installed") for c in links)
    svc = app.get("settings")
    try:
        from .features import FEATURES_DOC
        ha = (svc.store.body("house", FEATURES_DOC) or {}).get("ha") or {} if svc is not None else {}
        return "alarm_pin" in (ha.get("added") or [])
    except (AttributeError, TypeError):
        return False


def _states(app: Any) -> dict:
    hub = app.get("hub")
    return getattr(getattr(hub, "store", None), "states", None) or {}


def _registry(app: Any) -> dict:
    hub = app.get("hub")
    return getattr(getattr(hub, "registry", None), "entries", None) or {}


def _friendly(app: Any, eid: str | None) -> str | None:
    if not eid:
        return None
    st = _states(app).get(eid) or {}
    name = (st.get("a") or {}).get("friendly_name")
    if isinstance(name, str) and name:
        return name
    e = _registry(app).get(eid) or {}
    return e.get("name") or e.get("original_name") or eid


def _keypads(pins: AlarmPins) -> list[Entry]:
    return [e for e in pins.entries() if e.forward_to != e.entity]


def settings_page_mantel(app: Any) -> dict:
    """HA's page shape (alarm_pin/settings_ws.py page) from Mantel's table: never a PIN or its hash."""
    pins: AlarmPins | None = app.get("alarm_pin")
    if pins is None:
        return {"configured": False, "alarms": [], "choices": []}
    rows = pins.entries()
    panels = {e.entity for e in _keypads(pins)}
    covers: dict[str, str] = {}
    for e in rows:
        covers.setdefault(e.forward_to, e.entity)
    alarms = sorted(eid for eid in _states(app) if PANEL.match(eid) and eid not in panels)
    return {
        "configured": True, "min_length": PIN_MIN,
        "alarms": [{"entry_id": e.entity, "title": f"{_friendly(app, e.forward_to)} PIN", "state": "loaded",
                    "alarm": e.forward_to, "alarm_name": _friendly(app, e.forward_to), "panel": e.entity,
                    "panel_name": _friendly(app, e.entity), "arm_required": e.arm_required, "pin_set": e.house_code}
                   for e in rows],
        "choices": [{"entity_id": a, "name": _friendly(app, a), "entry": covers.get(a)} for a in alarms],
    }


async def settings_page(app: Any) -> dict:
    """``hk_alarm_pin/settings/get``: Mantel's table; while HK Frontend runs the keypads, HA's page (a server-only
    read, rebuilt key by key; ``pin_set`` is Mantel's)."""
    if not hk_runs_keypads(app):
        return settings_page_mantel(app)
    from .feature_pages import PageError, alarm_pin_page
    proxy = getattr(app.get("hub"), "readproxy", None)
    read = getattr(proxy, "read_server", None)
    if read is None:
        raise PageError("unavailable", "no connection to Home Assistant, where HK Frontend still runs the keypads")
    return alarm_pin_page(await read({"type": "hk_alarm_pin/settings/get"}), app.get("alarm_pin"))


def _page_error(code: str, fields: Mapping[str, str] | None = None, message: str = "") -> Exception:
    from .feature_pages import PageError
    return PageError(code, message or code, fields)


def _alarm_choice(app: Any, pins: AlarmPins, alarm: Any, entry: str | None) -> str | None:
    """Why ``alarm`` can't be protected by the keypad ``entry`` (None: a new one), or None."""
    if not isinstance(alarm, str) or not PANEL.match(alarm) or (alarm not in _states(app) and alarm not in _registry(app)):
        return PAGE_MSG["not_alarm"]
    if alarm in {e.entity for e in _keypads(pins)}:
        return PAGE_MSG["own_panel"]
    if any(e.forward_to == alarm and e.entity != entry for e in pins.entries()):
        return PAGE_MSG["taken"]
    return None


def new_panel(app: Any, pins: AlarmPins, alarm: str) -> str:
    """The entity id a new keypad gets: ``alarm_control_panel.<the alarm's name>_pin``, never one Home Assistant
    or this table already has."""
    base = re.sub(r"[^a-z0-9]+", "_", str(_friendly(app, alarm) or alarm.split(".", 1)[1]).lower()).strip("_") or "alarm"
    taken = set(_states(app)) | set(_registry(app)) | {e.entity for e in pins.entries()}
    panel, n = f"{DOMAIN}.{base}_pin", 2
    while panel in taken:
        panel, n = f"{DOMAIN}.{base}_pin_{n}", n + 1
    return panel


def _audit(app: Any, identity: Any, action: str, detail: dict) -> None:
    """The page's saves: the row first (audit.config), refused on the page when it cannot be written."""
    try:
        audit.config(None, identity, action, detail, app=app)
    except audit.Unavailable:
        raise _page_error("audit_unavailable", message="The audit log could not be written, so nothing was "
                          "changed. Try again in a moment.") from None


async def settings_save(app: Any, identity: Any, msg: Mapping[str, Any]) -> dict:
    """One of the page's three saves. Refused by field (``PageError`` invalid_format), as HA's were.
    Like the REST routes (``require_fresh``), every one needs a sign-in within the last five minutes
    (Signing-In.md): a stale Owner session must not be able to set the PIN that disarms the house."""
    from .identity.accounts import STEP_UP_WINDOW
    fresh_at = getattr(identity, "fresh_factor_at", None)
    if fresh_at is None or app["clock"]() - fresh_at > STEP_UP_WINDOW:
        raise _page_error("step_up_required", message="Confirm it is you first: this needs a sign-in, an "
                          "authenticator code or a passkey within the last five minutes.")
    if hk_runs_keypads(app):
        return await _save_through_ha(app, identity, msg)
    pins: AlarmPins | None = app.get("alarm_pin")
    if pins is None:
        raise _page_error("not_set_up", message="this Mantel has no Alarm PIN engine")
    t = msg.get("type")
    if t == "hk_alarm_pin/remove":
        entity = msg.get("entry_id")
        if not isinstance(entity, str) or pins.entry(entity) is None:
            raise _page_error("invalid_format", {"entry_id": PAGE_MSG["no_entry"]})
        _audit(app, identity, "alarm_pin.remove", {"entity": entity, "from": "hk_settings"})
        pins.remove(entity)
    elif t == "hk_alarm_pin/add":
        alarm = msg.get("alarm")
        errors: dict[str, str] = {}
        if (err := _alarm_choice(app, pins, alarm, None)) is not None:
            errors["alarm"] = err
        if not msg.get("pin") and not msg.get("pin_again"):
            errors["pin"] = PAGE_MSG["pin_needed"]
        arm = msg.get("arm_required", True)
        if not isinstance(arm, bool):
            errors["arm_required"] = PAGE_MSG["arm_required"]
        if errors:
            raise _page_error("invalid_format", errors)
        panel = new_panel(app, pins, alarm)
        try:
            await pins.set(panel, forward_to=alarm, pin=msg.get("pin"), pin_again=msg.get("pin_again"),
                           arm_required=arm, tablets=True, source="hk_settings",
                           before=lambda: _audit(app, identity, "alarm_pin.add",
                                                 {"entity": panel, "forward_to": alarm, "from": "hk_settings"}))
        except PolicyError as exc:
            pins.remove(panel)
            raise _page_error("invalid_format", {exc.code: str(exc)}) from None
    elif t == "hk_alarm_pin/settings/set":
        entity, changes = msg.get("entry_id"), msg.get("changes")
        cur = pins.entry(entity) if isinstance(entity, str) else None
        if cur is None:
            raise _page_error("invalid_format", {"entry_id": PAGE_MSG["no_entry"]})
        if not isinstance(changes, Mapping) or not changes:
            raise _page_error("invalid_format", {"changes": PAGE_MSG["unknown"]})
        errors = {k: PAGE_MSG["unknown"] for k in changes if k not in ("pin", "pin_again", "arm_required", "alarm")}
        kw: dict[str, Any] = {}
        if "arm_required" in changes:
            if not isinstance(changes["arm_required"], bool):
                errors["arm_required"] = PAGE_MSG["arm_required"]
            kw["arm_required"] = changes["arm_required"]
        if "alarm" in changes:
            if (err := _alarm_choice(app, pins, changes["alarm"], entity)) is not None:
                errors["alarm"] = err
            kw["forward_to"] = changes["alarm"]
        if "pin" in changes or "pin_again" in changes:
            if not changes.get("pin") and not changes.get("pin_again"):
                errors["pin"] = PAGE_MSG["pin_needed"]
            kw["pin"], kw["pin_again"] = changes.get("pin"), changes.get("pin_again")
        if errors:
            raise _page_error("invalid_format", errors)
        try:      # the audit says WHAT changed, never a PIN
            await pins.set(entity, source="hk_settings", **kw,
                           before=lambda: _audit(app, identity, "alarm_pin.set",
                                                 {"entity": entity, "changed": sorted(changes), "from": "hk_settings"}))
        except PolicyError as exc:
            raise _page_error("invalid_format", {exc.code: str(exc)}) from None
    else:
        raise _page_error("unknown_type", message=str(t))
    house = app.get("linked_house")
    if house is not None:
        await house.refresh()             # Mantel Link's keypad panels follow the table
    return settings_page_mantel(app)


async def _save_through_ha(app: Any, identity: Any, msg: Mapping[str, Any]) -> dict:
    """8d48e95's way, while HK Frontend runs the keypads: HA first (the gateway, as this person: their grants,
    their audit row; commands on), then what HA took is stored here too. HA's refusals by field come back as the
    page's."""
    import json as _json

    from .identity.authz import Principal
    from .feature_pages import alarm_pin_page
    gw, authz = app.get("gateway"), app.get("authz")
    if gw is None or authz is None:
        raise _page_error("commands_disabled", message="HK Frontend in Home Assistant still runs the Alarm PIN, and "
                          "Mantel's house commands are off, so the PIN can't be saved there. Move the house to Mantel "
                          "(Mantel Settings, Connections, Home Assistant, Moving from HK Frontend) to keep the PIN in "
                          "Mantel only.")
    frame = {k: v for k, v in msg.items() if k != "id"}
    got: dict = {}

    async def send(reply: dict) -> None:
        got.update(reply)
    # the page's socket already carries the person's Principal (authz.py); a bare Identity is made one
    principal = identity if isinstance(identity, Principal) else Principal(identity, authz.subject_of(identity))
    await gw.handle(principal, {"type": "command", "id": 1, "kind": "ws", "msg": frame}, send)
    if "result" not in got:
        err = got.get("error") or {}
        fields = None
        if err.get("code") == "invalid_format":
            try:
                fields = _json.loads(err.get("message") or "{}")
            except ValueError:
                fields = None
        raise _page_error(err.get("code") or "failed", fields if isinstance(fields, dict) else None,
                          err.get("message") or "Home Assistant refused it")
    # (the gateway itself stored what HA took here too: follow_page_save)
    return alarm_pin_page(got["result"], app.get("alarm_pin"))


# -- REST ------------------------------------------------------------------------------------------------
def alarm_pins_of(request: web.Request) -> AlarmPins:
    return request.app["alarm_pin"]


@guard("manager", reads="admin")
async def list_pins(request: web.Request) -> web.Response:
    return ok({"alarms": [e.to_dict() for e in alarm_pins_of(request).entries()]})


@guard("manager", fresh="always", audit="alarm_pin.set")
async def put_pin(request: web.Request) -> web.Response:
    ident = guarded(request)
    body = await read_json(request)
    allowed = {"forward_to", "pin", "pin_again", "arm_required", "tablets", "ha_code"}
    if set(body) - allowed:
        return error(400, "unknown_keys", keys=sorted(set(body) - allowed))
    entity = request.match_info["entity"]
    try:          # the audit says WHAT changed, never a PIN or a code; written before it is stored
        e = await alarm_pins_of(request).set(entity, **{k: body[k] for k in body}, before=lambda: audit.config(
            request, ident, "alarm_pin.set", {"entity": entity, "changed": sorted(body)}))
    except PolicyError as exc:
        return error(400, "invalid", field=exc.code, message=str(exc))
    return ok(e.to_dict())


@guard("manager", fresh="always", audit="alarm_pin.remove")
async def delete_pin(request: web.Request) -> web.Response:
    ident = guarded(request)
    entity = request.match_info["entity"]
    if alarm_pins_of(request).entry(entity) is not None:
        audit.config(request, ident, "alarm_pin.remove", {"entity": entity})
    return ok({"removed": alarm_pins_of(request).remove(entity)})


@guard("manager", fresh="always", audit="alarm_pin.import")
async def import_pins(request: web.Request) -> web.Response:
    ident = guarded(request)
    hub = request.app.get("hub")
    read = getattr(getattr(hub, "readproxy", None), "read_server", None)
    if read is None:
        return error(503, "no_home_assistant")
    try:
        page = await read({"type": "hk_alarm_pin/settings/get"})
        got = await alarm_pins_of(request).import_ha_page(
            page, before=lambda plan: audit.config(request, ident, "alarm_pin.import", plan))
    except ValueError as exc:
        return error(502, "bad_answer", message=str(exc))
    return ok(got)


def register(app: web.Application, hub: Any = None) -> None:
    """After accounts/pins (their hasher and secret key)."""
    app["alarm_pin"] = AlarmPins(app["store"].db, lambda: app["clock"](),
                                 hasher=(lambda: app["accounts"].hasher) if app.get("accounts") is not None else None,
                                 box=lambda: app.get("secret_box"))
    r = app.router
    r.add_get("/api/alarm/pins", list_pins)
    r.add_post("/api/alarm/pins/import", import_pins)
    r.add_put(r"/api/alarm/pins/{entity:alarm_control_panel\.[a-z0-9_]+}", put_pin)
    r.add_delete(r"/api/alarm/pins/{entity:alarm_control_panel\.[a-z0-9_]+}", delete_pin)
