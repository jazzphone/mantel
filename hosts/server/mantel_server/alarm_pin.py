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

THE ONLY PIN IN MANTEL (decision 25, Avery 2026-10-18): the house Alarm PIN, for the alarm only. No
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

from .accounts import PolicyError, read_json, require_fresh, require_manager
from .sessions import error, ok

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
                  source: str = "mantel") -> Entry:
        """Create or change a keypad. A new PIN is typed twice (HA's form); ``pin: None`` removes the house
        code (the keypad then refuses whatever needs a code); ``ha_code: None`` clears the alarm's own code. PolicyError by field."""
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

    async def import_ha_page(self, page: Any) -> dict:
        """HA's ``hk_alarm_pin/settings/get`` page -> keypads: each Alarm PIN panel (``entity``) forwards
        to the alarm it protects (``forward_to``: that alarm takes no code of its own), with its arm rule.
        HA never gives out its PIN or hash: an existing Mantel house code is kept, a new keypad has none
        (``need_pin``) until an Owner sets it; until then it refuses whatever needs a code."""
        if not isinstance(page, Mapping) or not isinstance(page.get("alarms"), list):
            raise ValueError("Home Assistant's answer has no Alarm PIN page in it")
        done, need = [], []
        for a in page["alarms"]:
            if not isinstance(a, Mapping):
                continue
            panel, alarm = a.get("panel"), a.get("alarm")
            if not (isinstance(panel, str) and PANEL.match(panel) and isinstance(alarm, str) and PANEL.match(alarm)):
                continue
            e = await self.set(panel, forward_to=alarm, arm_required=bool(a.get("arm_required", True)), source="ha")
            done.append(e.entity)
            if not e.house_code:
                need.append(e.entity)
        return {"imported": done, "need_pin": need}

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
        from .rbac import Grant
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
    from .authz import Principal
    from .sessions import Identity, User
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
    from . import gateway as G
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


# -- REST ------------------------------------------------------------------------------------------------
def alarm_pins_of(request: web.Request) -> AlarmPins:
    return request.app["alarm_pin"]


def _config_event(request: web.Request, ident: Any, action: str, detail: dict) -> None:
    audit = request.app.get("audit")
    if audit is not None:
        audit.config_event({"actor": ident.user.id, "role": ident.user.role, "action": action, "detail": detail})


async def list_pins(request: web.Request) -> web.Response:
    require_manager(request)
    return ok({"alarms": [e.to_dict() for e in alarm_pins_of(request).entries()]})


async def put_pin(request: web.Request) -> web.Response:
    ident = require_manager(request)
    require_fresh(request, ident)
    body = await read_json(request)
    allowed = {"forward_to", "pin", "pin_again", "arm_required", "tablets", "ha_code"}
    if set(body) - allowed:
        return error(400, "unknown_keys", keys=sorted(set(body) - allowed))
    entity = request.match_info["entity"]
    try:
        e = await alarm_pins_of(request).set(entity, **{k: body[k] for k in body})
    except PolicyError as exc:
        return error(400, "invalid", field=exc.code, message=str(exc))
    # the audit says WHAT changed, never a PIN or a code
    _config_event(request, ident, "alarm_pin.set", {"entity": entity, "changed": sorted(body)})
    return ok(e.to_dict())


async def delete_pin(request: web.Request) -> web.Response:
    ident = require_manager(request)
    require_fresh(request, ident)
    entity = request.match_info["entity"]
    removed = alarm_pins_of(request).remove(entity)
    if removed:
        _config_event(request, ident, "alarm_pin.remove", {"entity": entity})
    return ok({"removed": removed})


async def import_pins(request: web.Request) -> web.Response:
    ident = require_manager(request)
    require_fresh(request, ident)
    hub = request.app.get("hub")
    read = getattr(getattr(hub, "readproxy", None), "read_server", None)
    if read is None:
        return error(503, "no_home_assistant")
    try:
        page = await read({"type": "hk_alarm_pin/settings/get"})
        got = await alarm_pins_of(request).import_ha_page(page)
    except ValueError as exc:
        return error(502, "bad_answer", message=str(exc))
    _config_event(request, ident, "alarm_pin.import", got)
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
