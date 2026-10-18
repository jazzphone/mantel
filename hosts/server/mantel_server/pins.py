"""A person's PIN (PLAN §5 "Wall Tablet: sensitive actions require a person's PIN at the tablet"; §7
step-up: "a per-user PIN ... or a passkey on personal devices").

* **Each person sets their own PIN** from their own signed-in session, with a fresh factor (signed in
  or stepped up within five minutes): ``PUT /api/account/pin {"pin"}``, ``DELETE /api/account/pin``,
  ``GET /api/account/pin`` (whether one is set). An Owner/Admin can clear someone's PIN
  (``DELETE /api/users/{id}/pin``; an Admin not an Owner's). A wall tablet (a device alone) cannot.
* **4 to 8 digits**, not one digit repeated, not a straight run (1234, 9876). Stored only as an
  Argon2id hash (the accounts' hasher); never logged, never in the audit.
* **A PIN names one person.** At a wall tablet nobody is signed in, so the server finds WHO by the PIN
  (every person's hash is checked, always all of them). Two people may therefore not share a PIN: a
  new PIN that is already someone's is refused (``pin_unavailable``). That answer says "somebody has
  this PIN" (not who), so it is rate limited per person (5 per 15 minutes).
* **Wrong PINs lock where they are typed.** A tablet's PIN pad locks for 15 minutes after 5 wrong PINs
  in a row (stored, so a restart does not reset it); each source IP may fail 20 times per 15
  minutes; a person's own-session PIN step-up locks that person after 5. Verifications run one at a
  time, so parallel guesses cannot outrun the counters.

The gateway (gateway.py) asks for the PIN in ``step_up_required`` (method ``pin``) and gets it back
inside the command (``"step_up": {"method": "pin", "pin": "..."}``): at a tablet ``identify`` names the
person and the command is decided once more as person ∩ tablet; on a person's own session
``verify_user`` marks the session fresh (factor ``pin``).
"""
from __future__ import annotations

import asyncio
import logging
import re
import sqlite3
from typing import Callable

from aiohttp import web
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from .accounts import AttemptLimiter, PolicyError, limited, read_json, require_fresh, require_manager, require_user
from .sessions import User, _may_manage, error, ok

log = logging.getLogger("mantel.pins")

PIN = re.compile(r"^\d{4,8}$")
LOCK_AFTER = 5                # wrong PINs in a row at one tablet (or on one person's session) ...
LOCK_SECONDS = 15 * 60        # ... lock it for this long
IP_FAILURES = 20              # wrong PINs per source IP per window (in memory)
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

    def any_pin(self) -> bool:
        """Is there anyone a tablet's PIN pad could name?"""
        return self.db.execute("SELECT 1 FROM user_pins p JOIN users u ON u.id = p.user_id "
                               "WHERE u.disabled = 0 LIMIT 1").fetchone() is not None

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
    async def set_pin(self, user_id: str, pin: object) -> None:
        """Set or change a person's PIN. PolicyError (pin_invalid, pin_too_simple, pin_unavailable,
        too_many_attempts with `.retry_after`)."""
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
            log.warning("PIN pad at %s locked for %d s after %d wrong PINs", place, LOCK_SECONDS, LOCK_AFTER)
            return float(LOCK_SECONDS)
        return 0.0

    def _place_ok(self, place: str) -> None:
        with self.db:
            self.db.execute("UPDATE pin_lockouts SET failed = 0, locked_until = NULL, updated = ? WHERE place = ?",
                            (self.clock(), place))

    def _used(self, user_id: str) -> None:
        with self.db:
            self.db.execute("UPDATE user_pins SET last_used = ?, failed = 0, locked_until = NULL WHERE user_id = ?",
                            (self.clock(), user_id))

    # -- checking ---------------------------------------------------------------------------------
    async def identify(self, pin: object, *, device_id: str, ip: str | None) -> tuple[str, object]:
        """Who typed this PIN at this tablet? ``("ok", User)``, ``("invalid", 0.0)``, ``("locked",
        seconds)``, or ``("ambiguous", 0.0)`` (two people share it: refused, never guessed)."""
        place = f"device:{device_id}"
        async with self._lock():
            wait = max(self._place(place), self.by_ip.retry_after(f"ip:{ip}"))
            if wait > 0:
                return "locked", wait
            matches = await self._matches(pin) if isinstance(pin, str) and PIN.match(pin) else []
            if len(matches) == 1:
                r = matches[0]
                self._place_ok(place)
                self._used(r["user_id"])
                return "ok", User(id=r["user_id"], name=r["name"], role=r["role"], kind=r["kind"],
                                  username=r["username"], ha_user_id=r["ha_user_id"])
            if len(matches) > 1:
                log.error("two people share a PIN (%s); refused at %s", ", ".join(m["user_id"] for m in matches), place)
                return "ambiguous", 0.0
            self.by_ip.fail(f"ip:{ip}")
            locked = self._place_failed(place)
            return ("locked", locked) if locked else ("invalid", 0.0)

    async def verify_user(self, user_id: str, pin: object, *, ip: str | None) -> tuple[str, float]:
        """A signed-in person's own PIN (their session's step-up): ``("ok"|"invalid"|"locked"|"no_pin",
        seconds locked)``."""
        async with self._lock():
            row = self.db.execute("SELECT * FROM user_pins WHERE user_id = ?", (user_id,)).fetchone()
            if row is None:
                return "no_pin", 0.0
            now = self.clock()
            wait = max((row["locked_until"] - now) if row["locked_until"] and row["locked_until"] > now else 0.0,
                       self.by_ip.retry_after(f"ip:{ip}"))
            if wait > 0:
                return "locked", wait
            good = isinstance(pin, str) and bool(PIN.match(pin)) and await self._verify(row["pin_hash"], pin)
            if good:
                self._used(user_id)
                return "ok", 0.0
            self.by_ip.fail(f"ip:{ip}")
            with self.db:
                self.db.execute("UPDATE user_pins SET failed = failed + 1 WHERE user_id = ?", (user_id,))
                cur = self.db.execute("UPDATE user_pins SET locked_until = ?, failed = 0 WHERE user_id = ? AND failed >= ?",
                                      (now + LOCK_SECONDS, user_id, LOCK_AFTER))
            return ("locked", float(LOCK_SECONDS)) if cur.rowcount else ("invalid", 0.0)


_DEFAULT_HASHER = PasswordHasher()


# -- REST -----------------------------------------------------------------------------------------
def pins_of(request: web.Request) -> Pins:
    return request.app["pins"]


async def get_pin(request: web.Request) -> web.Response:
    ident = require_user(request)
    return ok(pins_of(request).status(ident.user.id))


async def put_pin(request: web.Request) -> web.Response:
    ident = require_user(request)
    require_fresh(request, ident)
    body = await read_json(request)
    try:
        await pins_of(request).set_pin(ident.user.id, body.get("pin"))
    except PolicyError as exc:
        if exc.code == "too_many_attempts":
            return limited(getattr(exc, "retry_after", WINDOW))
        return error(400, exc.code, message=str(exc))
    return ok(pins_of(request).status(ident.user.id))


async def delete_pin(request: web.Request) -> web.Response:
    ident = require_user(request)
    require_fresh(request, ident)
    return ok({"removed": pins_of(request).remove(ident.user.id)})


async def clear_users_pin(request: web.Request) -> web.Response:
    ident = require_manager(request)
    target = request.app["accounts"].get_user(request.match_info["id"])
    if target is None:
        return error(404, "not_found")
    if not _may_manage(ident.user, target["role"]):
        return error(403, "forbidden")
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

