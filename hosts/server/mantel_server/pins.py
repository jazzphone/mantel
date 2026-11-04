"""A person's PIN, and the alarm keypad's lockout counters.

DECISION 25: the only PIN Mantel asks for is the house Alarm PIN (alarm_pin.py), for
the alarm only. A person's own PIN is no longer required or accepted anywhere: not at a wall tablet, not
as a step-up (there is none), not at the alarm keypad. The REST below stays so a person may keep one for
later; nothing checks it.

* **Each person may set their own PIN** from their own signed-in session, with a fresh sign-in:
  ``PUT /api/account/pin {"pin"}``, ``DELETE /api/account/pin``, ``GET /api/account/pin`` (whether one
  is set). An Owner/Admin can clear someone's PIN (``DELETE /api/users/{id}/pin``; an Admin not an
  Owner's). 4 to 8 digits, not one digit repeated, not a straight run; stored only as an Argon2id hash,
  never logged. Two people may not share one (``pin_unavailable``, rate limited per person).
* **The alarm keypad's lockout** (``keypad``): wrong codes lock where they are typed. A place (a tablet,
  a person's session, the linked HA) locks for 15 minutes after 5 wrong codes in a row (stored, so a
  restart does not reset it); each source IP may fail 20 times per 15 minutes. Checks run one at a time,
  so parallel guesses cannot outrun the counters.
"""
from __future__ import annotations

import asyncio
import logging
import re
import sqlite3
from typing import Awaitable, Callable

from aiohttp import web
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from . import audit
from .accounts import AttemptLimiter, PolicyError, limited, read_json, who
from .guards import guard
from .guards import ident as guarded
from .sessions import _may_manage, error, ok

log = logging.getLogger("mantel.pins")

PIN = re.compile(r"^\d{4,8}$")
LOCK_AFTER = 5                # wrong alarm codes in a row at one place (a tablet, a session) ...
LOCK_SECONDS = 15 * 60        # ... lock it for this long
IP_FAILURES = 20              # wrong alarm codes per source IP per window (in memory)
SET_REFUSALS = 5              # `pin_unavailable` answers per person per window
WINDOW = 15 * 60


def check_pin(pin: object) -> str:
    if not isinstance(pin, str) or not PIN.match(pin):
        raise PolicyError("pin_invalid", "a PIN is 4 to 8 digits")
    steps = {int(b) - int(a) for a, b in zip(pin, pin[1:])}
    if len(set(pin)) == 1 or steps in ({1}, {-1}):
        raise PolicyError("pin_too_simple", "that PIN is too easy to guess (a repeated digit or a straight run)")
    return pin


class Pins:
    def __init__(self, conn: sqlite3.Connection, clock: Callable[[], float],
                 hasher: Callable[[], PasswordHasher] | None = None) -> None:
        self.db = conn
        self.clock = clock
        self._hasher = hasher or (lambda: _DEFAULT_HASHER)
        self.by_ip = AttemptLimiter(IP_FAILURES, WINDOW, clock)
        self.set_refusals = AttemptLimiter(SET_REFUSALS, WINDOW, clock)
        self._one_at_a_time: asyncio.Lock | None = None

    @property
    def hasher(self) -> PasswordHasher:
        return self._hasher()

    def _lock(self) -> asyncio.Lock:
        if self._one_at_a_time is None:
            self._one_at_a_time = asyncio.Lock()
        return self._one_at_a_time

    # -- reading ----------------------------------------------------------------------------------
    def has_pin(self, user_id: str) -> bool:
        return self.db.execute("SELECT 1 FROM user_pins WHERE user_id = ?", (user_id,)).fetchone() is not None

    def status(self, user_id: str) -> dict:
        row = self.db.execute("SELECT created, updated, last_used FROM user_pins WHERE user_id = ?", (user_id,)).fetchone()
        return {"pin": row is not None, **({k: row[k] for k in ("created", "updated", "last_used")} if row else {})}

    # -- hashing ----------------------------------------------------------------------------------
    async def _hash(self, pin: str) -> str:
        return await asyncio.get_running_loop().run_in_executor(None, self.hasher.hash, pin)

    async def _verify(self, stored: str, pin: str) -> bool:
        def run() -> bool:
            try:
                return self.hasher.verify(stored, pin)
            except (VerifyMismatchError, VerificationError, InvalidHashError):
                return False
        return await asyncio.get_running_loop().run_in_executor(None, run)

    async def _matches(self, pin: str, exclude: str | None = None) -> list[sqlite3.Row]:
        """Every live person whose PIN this is. Checks ALL of them (no early exit)."""
        rows = self.db.execute(
            "SELECT p.user_id, p.pin_hash, u.name, u.role, u.kind, u.username, h.ha_user_id "
            "FROM user_pins p JOIN users u ON u.id = p.user_id LEFT JOIN ha_links h ON h.user_id = u.id "
            "WHERE u.disabled = 0 ORDER BY p.user_id").fetchall()
        found = []
        for r in rows:
            if await self._verify(r["pin_hash"], pin) and r["user_id"] != exclude:
                found.append(r)
        return found

    # -- setting ----------------------------------------------------------------------------------
    async def set_pin(self, user_id: str, pin: object, before: Callable[[], None] | None = None) -> None:
        """Set or change a person's PIN. PolicyError (pin_invalid, pin_too_simple, pin_unavailable,
        too_many_attempts with `.retry_after`). ``before()`` runs once the PIN is accepted and before it is stored
        (the audit row); if it raises, nothing is stored."""
        check_pin(pin)
        key = f"user:{user_id}"
        async with self._lock():
            wait = self.set_refusals.retry_after(key)
            if wait > 0:
                exc = PolicyError("too_many_attempts", "too many refused PINs; wait a while")
                exc.retry_after = wait  # type: ignore[attr-defined]
                raise exc
            if await self._matches(pin, exclude=user_id):  # type: ignore[arg-type]
                self.set_refusals.fail(key)
                raise PolicyError("pin_unavailable", "choose another PIN")
            hashed = await self._hash(pin)  # type: ignore[arg-type]
            if before is not None:
                before()
            now = self.clock()
            with self.db:
                self.db.execute(
                    "INSERT INTO user_pins (user_id, pin_hash, created, updated) VALUES (?,?,?,?) "
                    "ON CONFLICT (user_id) DO UPDATE SET pin_hash = excluded.pin_hash, updated = excluded.updated, "
                    "failed = 0, locked_until = NULL", (user_id, hashed, now, now))
        log.info("user %s set a PIN", user_id)

    def remove(self, user_id: str) -> bool:
        with self.db:
            return self.db.execute("DELETE FROM user_pins WHERE user_id = ?", (user_id,)).rowcount > 0

    # -- lockouts ---------------------------------------------------------------------------------
    def _place(self, place: str) -> float:
        row = self.db.execute("SELECT locked_until FROM pin_lockouts WHERE place = ?", (place,)).fetchone()
        now = self.clock()
        return row["locked_until"] - now if row is not None and row["locked_until"] and row["locked_until"] > now else 0.0

    def _place_failed(self, place: str) -> float:
        """Count a wrong PIN at `place`; the seconds it is now locked for (0 if not locked)."""
        now = self.clock()
        with self.db:
            self.db.execute("INSERT INTO pin_lockouts (place, failed, updated) VALUES (?, 1, ?) "
                            "ON CONFLICT (place) DO UPDATE SET failed = failed + 1, updated = excluded.updated",
                            (place, now))
            cur = self.db.execute("UPDATE pin_lockouts SET locked_until = ?, failed = 0 WHERE place = ? AND failed >= ?",
                                  (now + LOCK_SECONDS, place, LOCK_AFTER))
        if cur.rowcount:
            log.warning("alarm keypad at %s locked for %d s after %d wrong codes", place, LOCK_SECONDS, LOCK_AFTER)
            return float(LOCK_SECONDS)
        return 0.0

    def _place_ok(self, place: str) -> None:
        with self.db:
            self.db.execute("UPDATE pin_lockouts SET failed = 0, locked_until = NULL, updated = ? WHERE place = ?",
                            (self.clock(), place))

    # -- checking ---------------------------------------------------------------------------------
    async def keypad(self, code: object, *, place: str, ip: str | None,
                     house: Callable[[str], Awaitable[bool]]) -> tuple[str, float]:
        """ONE code typed at an alarm keypad (alarm_pin.py): is it the house Alarm PIN (``house`` checks
        it)? Answers ``("house", 0.0)``, ``("invalid", 0.0)`` or ``("locked", seconds)``.

        A wrong code counts ONCE where it is typed (``place``) and per source IP; LOCK_AFTER in a row lock
        the place for LOCK_SECONDS. One check at a time. The code is never logged."""
        async with self._lock():
            wait = max(self._place(place), self.by_ip.retry_after(f"ip:{ip}"))
            if wait > 0:
                return "locked", wait
            typed = isinstance(code, str) and 0 < len(code) <= 64
            if typed and await house(code):  # type: ignore[arg-type]
                self._place_ok(place)
                return "house", 0.0
            self.by_ip.fail(f"ip:{ip}")
            locked = self._place_failed(place)
            return ("locked", locked) if locked else ("invalid", 0.0)

_DEFAULT_HASHER = PasswordHasher()


# -- REST -----------------------------------------------------------------------------------------
def pins_of(request: web.Request) -> Pins:
    return request.app["pins"]


@guard("person", device_ok=True, reads="self")
async def get_pin(request: web.Request) -> web.Response:
    ident = guarded(request)
    return ok(pins_of(request).status(ident.user.id))


@guard("person", device_ok=True, fresh="always", audit="account.pin.set")
async def put_pin(request: web.Request) -> web.Response:
    ident = guarded(request)
    body = await read_json(request)
    me = who(request.app["accounts"].get_user(ident.user.id))
    try:          # the audit row once the PIN is accepted, before it is stored; never the PIN
        await pins_of(request).set_pin(ident.user.id, body.get("pin"),
                                       before=lambda: audit.config(request, ident, "account.pin.set", me))
    except PolicyError as exc:
        if exc.code == "too_many_attempts":
            return limited(getattr(exc, "retry_after", WINDOW))
        return error(400, exc.code, message=str(exc))
    return ok(pins_of(request).status(ident.user.id))


@guard("person", device_ok=True, fresh="always", audit="account.pin.remove")
async def delete_pin(request: web.Request) -> web.Response:
    ident = guarded(request)
    if pins_of(request).status(ident.user.id)["pin"]:
        audit.config(request, ident, "account.pin.remove", who(request.app["accounts"].get_user(ident.user.id)))
    return ok({"removed": pins_of(request).remove(ident.user.id)})


@guard("manager", audit="account.pin.clear")
async def clear_users_pin(request: web.Request) -> web.Response:
    ident = guarded(request)
    target = request.app["accounts"].get_user(request.match_info["id"])
    if target is None:
        return error(404, "not_found")
    if not _may_manage(ident.user, target["role"]):
        return error(403, "forbidden")
    if pins_of(request).status(target["id"])["pin"]:
        audit.config(request, ident, "account.pin.clear", {**who(target), "role": target["role"]})
    return ok({"removed": pins_of(request).remove(target["id"])})


def register(app: web.Application, hub=None) -> None:
    accounts = app.get("accounts")
    app["pins"] = Pins(app["store"].db, lambda: app["clock"](),
                       hasher=(lambda: app["accounts"].hasher) if accounts is not None else None)
    r = app.router
    r.add_get("/api/account/pin", get_pin)
    r.add_put("/api/account/pin", put_pin)
    r.add_delete("/api/account/pin", delete_pin)
    r.add_delete("/api/users/{id}/pin", clear_users_pin)

