"""Accounts: users, passwords, TOTP, passkeys and the first-Owner bootstrap (PLAN §5, §7).

* **Users** have a role (``store.ROLES``), a kind (``hk``: their own sign-in; ``ha_linked``: created by
  linking an HA account) and can be disabled. HA links (``ha_links``) say which user "Sign in with
  Home Assistant" lands in.
* **Passwords**: Argon2id (argon2-cffi), at least 12 characters. Failures are rate limited per
  source IP and per account name, and an account locks for 15 minutes after 5 failures in a row.
* **TOTP**: RFC 6238 (stdlib). The seed is AES-GCM encrypted at rest (``atrest.SecretBox``) and each
  time step can be used once. With TOTP enrolled, a password is never enough on its own; on the
  tunnel door a password alone is refused for everyone.
* **Passkeys**: WebAuthn via the ``webauthn`` package; challenges are stored server-side, single use,
  with an expiry. User verification is required.
* **Bootstrap**: ``mantel-server bootstrap`` prints a one-time setup token, only while no Owner
  exists; ``POST /api/bootstrap`` redeems it once to create the first Owner.
"""
from __future__ import annotations

import asyncio
import base64
import hmac
import json
import logging
import re
import secrets
import sqlite3
import struct
from collections import defaultdict, deque
from urllib.parse import quote, urlencode, urlparse

from aiohttp import web
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from .atrest import KEY_FILE, SecretBox
from .sessions import (Identity, Issued, SessionManager, client_ip, door_of, error, identity, ok,
                       set_session_cookies, token_hash)
from .store import ROLES

log = logging.getLogger("mantel.accounts")

PASSWORD_MIN = 12
PASSWORD_MAX = 1024
USERNAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$", re.I)
ACCOUNT_FAILURES = 5          # failures per account name per window (in memory) …
IP_FAILURES = 20              # … and per source IP
FAILURE_WINDOW = 15 * 60
LOCK_AFTER = 5                # consecutive failures that lock a real account (stored) …
LOCK_SECONDS = 15 * 60        # … for this long
PENDING_TTL = 5 * 60          # password accepted, second factor owed
PENDING_ATTEMPTS = 5
CHALLENGE_TTL = 5 * 60
BOOTSTRAP_TTL = 60 * 60
STEP_UP_WINDOW = 5 * 60       # "fresh within ~5 minutes" (PLAN §7)
TOTP_STEP = 30
TOTP_DIGITS = 6
TOTP_WINDOW = 1               # accept the previous and next step for clock drift
MANAGERS = ("owner", "admin")


class PolicyError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


# -- passwords ------------------------------------------------------------------------------------
def check_password_policy(password: object, username: str | None = None, name: str | None = None) -> str:
    if not isinstance(password, str):
        raise PolicyError("password_invalid", "password must be text")
    if len(password) < PASSWORD_MIN:
        raise PolicyError("password_too_short", f"passwords need at least {PASSWORD_MIN} characters")
    if len(password) > PASSWORD_MAX:
        raise PolicyError("password_too_long", f"passwords are at most {PASSWORD_MAX} characters")
    if len(set(password)) < 4:
        raise PolicyError("password_too_simple", "that password repeats too few characters")
    lowered = password.lower()
    for word in (username, name):
        if word and len(word) >= 3 and word.lower() in lowered:
            raise PolicyError("password_contains_name", "the password must not contain the user name")
    return password


def check_username(username: object) -> str:
    if not isinstance(username, str) or not USERNAME.match(username):
        raise PolicyError("username_invalid", "user names are 1-64 letters, digits, '.', '_' or '-'")
    return username.lower()


class AttemptLimiter:
    """Sliding-window failure counter (in memory). ``retry_after(key)`` > 0 means refuse for now."""

    def __init__(self, limit: int, window: float, clock) -> None:
        self.limit, self.window, self.clock = limit, window, clock
        self.failures: dict[str, deque] = defaultdict(deque)

    def _trim(self, key: str, now: float) -> deque:
        q = self.failures[key]
        while q and q[0] <= now - self.window:
            q.popleft()
        if not q:
            self.failures.pop(key, None)
            return deque()
        return q

    def retry_after(self, key: str) -> float:
        now = self.clock()
        q = self._trim(key, now)
        return (q[0] + self.window - now) if len(q) >= self.limit else 0.0

    def fail(self, key: str) -> None:
        self.failures[key].append(self.clock())

    def reset(self, key: str) -> None:
        self.failures.pop(key, None)


# -- TOTP (RFC 4226 / RFC 6238) -------------------------------------------------------------------
def hotp(secret: bytes, counter: int, digits: int = TOTP_DIGITS, algorithm: str = "sha1") -> str:
    mac = hmac.new(secret, struct.pack(">Q", counter), algorithm).digest()
    offset = mac[-1] & 0x0F
    code = (struct.unpack(">I", mac[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return str(code).zfill(digits)


def totp(secret: bytes, t: float, step: int = TOTP_STEP, digits: int = TOTP_DIGITS,
         algorithm: str = "sha1", t0: int = 0) -> str:
    return hotp(secret, int((t - t0) // step), digits, algorithm)


def totp_match(secret: bytes, code: object, now: float, last_counter: int = -1,
               window: int = TOTP_WINDOW) -> int | None:
    """The time step ``code`` belongs to (within ±window, newer than last_counter), or None."""
    if not isinstance(code, str) or not code.isdigit() or len(code) != TOTP_DIGITS:
        return None
    current = int(now // TOTP_STEP)
    found = None
    for counter in range(current - window, current + window + 1):
        if counter > last_counter and hmac.compare_digest(hotp(secret, counter), code):
            found = counter
    return found


def b32(secret: bytes) -> str:
    return base64.b32encode(secret).decode().rstrip("=")


def otpauth_uri(secret: bytes, account: str, issuer: str = "Mantel") -> str:
    label = quote(f"{issuer}:{account}")
    return f"otpauth://totp/{label}?" + urlencode({"secret": b32(secret), "issuer": issuer, "algorithm": "SHA1",
                                                  "digits": TOTP_DIGITS, "period": TOTP_STEP})


# -- the account service --------------------------------------------------------------------------
class Accounts:
    def __init__(self, conn: sqlite3.Connection, box: SecretBox, clock, hasher: PasswordHasher | None = None,
                 rp_id: str = "localhost", rp_name: str = "Mantel") -> None:
        self.db = conn
        self.box = box
        self.clock = clock
        self.hasher = hasher or PasswordHasher()  # Argon2id, t=3, m=64 MiB, p=4 (RFC 9106 second choice)
        self.rp_id = rp_id
        self.rp_name = rp_name
        self.by_ip = AttemptLimiter(IP_FAILURES, FAILURE_WINDOW, clock)
        self.by_account = AttemptLimiter(ACCOUNT_FAILURES, FAILURE_WINDOW, clock)
        self._dummy: str | None = None

    # users ------------------------------------------------------------------------------------
    def get_user(self, user_id: str):
        return self.db.execute("SELECT u.*, h.ha_user_id FROM users u LEFT JOIN ha_links h ON h.user_id = u.id "
                               "WHERE u.id = ?", (user_id,)).fetchone()

    def find_username(self, username: str):
        return self.db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()

    def owner_exists(self) -> bool:
        return self.db.execute("SELECT 1 FROM users WHERE role = 'owner' AND disabled = 0 LIMIT 1").fetchone() is not None

    def describe(self, row) -> dict:
        totp_on = self.db.execute("SELECT 1 FROM totp_credentials WHERE user_id = ? AND confirmed IS NOT NULL",
                                  (row["id"],)).fetchone() is not None
        passkeys = self.db.execute("SELECT COUNT(*) FROM passkeys WHERE user_id = ?", (row["id"],)).fetchone()[0]
        ha = self.db.execute("SELECT ha_user_id FROM ha_links WHERE user_id = ?", (row["id"],)).fetchone()
        return {"id": row["id"], "username": row["username"], "name": row["name"], "role": row["role"],
                "kind": row["kind"], "disabled": bool(row["disabled"]), "has_password": bool(row["password_hash"]),
                "totp": totp_on, "passkeys": passkeys, "ha_user_id": ha["ha_user_id"] if ha else None}

    def list_users(self) -> list[dict]:
        return [self.describe(r) for r in self.db.execute("SELECT * FROM users ORDER BY created")]

    async def hash_password(self, password: str) -> str:
        return await asyncio.get_running_loop().run_in_executor(None, self.hasher.hash, password)

    async def _verify(self, stored: str | None, password: str) -> bool:
        if self._dummy is None:
            self._dummy = await self.hash_password(secrets.token_urlsafe(16))

        def run() -> bool:
            try:
                return self.hasher.verify(stored or self._dummy, password) and stored is not None
            except (VerifyMismatchError, VerificationError, InvalidHashError):
                return False
        return await asyncio.get_running_loop().run_in_executor(None, run)

    async def create_user(self, username: str, name: str | None, role: str, password: str | None,
                          kind: str = "hk") -> str:
        username = check_username(username)
        if role not in ROLES:
            raise PolicyError("role_invalid", f"roles are {', '.join(ROLES)}")
        hashed = None
        if password is not None:
            check_password_policy(password, username, name)
            hashed = await self.hash_password(password)
        now = self.clock()
        user_id = secrets.token_hex(16)
        try:
            with self.db:
                self.db.execute("INSERT INTO users (id, username, name, role, kind, password_hash, password_changed, "
                                "created, updated) VALUES (?,?,?,?,?,?,?,?,?)",
                                (user_id, username, name, role, kind, hashed, now if hashed else None, now, now))
        except sqlite3.IntegrityError as exc:
            raise PolicyError("username_taken", "that user name is taken") from exc
        return user_id

    async def set_password(self, user_id: str, password: str) -> None:
        row = self.get_user(user_id)
        check_password_policy(password, row["username"], row["name"])
        hashed = await self.hash_password(password)
        now = self.clock()
        with self.db:
            self.db.execute("UPDATE users SET password_hash = ?, password_changed = ?, failed_logins = 0, "
                            "locked_until = NULL, updated = ? WHERE id = ?", (hashed, now, now, user_id))

    # failures and lockout ---------------------------------------------------------------------
    def retry_after(self, ip: str | None, account: str | None) -> float:
        waits = [self.by_ip.retry_after(f"ip:{ip}")]
        if account:
            waits.append(self.by_account.retry_after(f"acct:{account.lower()}"))
            row = self.find_username(account.lower())
            if row is not None and row["locked_until"] and row["locked_until"] > self.clock():
                waits.append(row["locked_until"] - self.clock())
        return max(waits)

    def record_failure(self, ip: str | None, account: str | None, user_id: str | None = None) -> None:
        self.by_ip.fail(f"ip:{ip}")
        if account:
            self.by_account.fail(f"acct:{account.lower()}")
        if user_id:
            now = self.clock()
            with self.db:
                self.db.execute("UPDATE users SET failed_logins = failed_logins + 1 WHERE id = ?", (user_id,))
                self.db.execute("UPDATE users SET locked_until = ?, failed_logins = 0 WHERE id = ? AND failed_logins >= ?",
                                (now + LOCK_SECONDS, user_id, LOCK_AFTER))

    def record_success(self, account: str | None, user_id: str) -> None:
        if account:
            self.by_account.reset(f"acct:{account.lower()}")
        with self.db:
            self.db.execute("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?", (user_id,))

    async def check_password(self, username: str, password: str, ip: str | None):
        """('ok', row) | ('invalid', None) | ('limited', seconds). Unknown, disabled and wrong look alike."""
        wait = self.retry_after(ip, username)
        if wait > 0:
            return "limited", wait
        row = self.find_username(username.lower()) if isinstance(username, str) else None
        good = await self._verify(row["password_hash"] if row is not None else None,
                                  password if isinstance(password, str) else "")
        if not good or row is None or row["disabled"]:
            self.record_failure(ip, username if isinstance(username, str) else None,
                                row["id"] if row is not None else None)
            return "invalid", None
        self.record_success(username, row["id"])
        if self.hasher.check_needs_rehash(row["password_hash"]):
            hashed = await self.hash_password(password)
            with self.db:
                self.db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hashed, row["id"]))
        return "ok", row

    # second-factor pending tokens -------------------------------------------------------------
    def start_pending(self, user_id: str, door: str) -> str:
        token = secrets.token_urlsafe(32)
        now = self.clock()
        with self.db:
            self.db.execute("DELETE FROM auth_pending WHERE expires < ? OR user_id = ?", (now, user_id))
            self.db.execute("INSERT INTO auth_pending (hash, user_id, door, expires) VALUES (?,?,?,?)",
                            (token_hash(token), user_id, door, now + PENDING_TTL))
        return token

    def get_pending(self, token: object, door: str):
        if not isinstance(token, str) or not token:
            return None
        row = self.db.execute("SELECT * FROM auth_pending WHERE hash = ?", (token_hash(token),)).fetchone()
        if row is None or row["expires"] <= self.clock() or row["door"] != door:
            return None
        return row

    def pending_failed(self, row) -> None:
        with self.db:
            self.db.execute("UPDATE auth_pending SET attempts = attempts + 1 WHERE hash = ?", (row["hash"],))
            self.db.execute("DELETE FROM auth_pending WHERE hash = ? AND attempts >= ?", (row["hash"], PENDING_ATTEMPTS))

    def end_pending(self, row) -> None:
        with self.db:
            self.db.execute("DELETE FROM auth_pending WHERE hash = ?", (row["hash"],))

    # TOTP --------------------------------------------------------------------------------------
    def _totp_row(self, user_id: str):
        return self.db.execute("SELECT * FROM totp_credentials WHERE user_id = ?", (user_id,)).fetchone()

    def has_totp(self, user_id: str) -> bool:
        row = self._totp_row(user_id)
        return row is not None and row["confirmed"] is not None

    def has_passkey(self, user_id: str) -> bool:
        return self.db.execute("SELECT 1 FROM passkeys WHERE user_id = ? LIMIT 1", (user_id,)).fetchone() is not None

    def totp_begin(self, user_id: str, account: str) -> tuple[str, str]:
        """A new (unconfirmed) seed; replaces an unconfirmed one. Returns (base32 secret, otpauth URI)."""
        seed = secrets.token_bytes(20)
        sealed = self.box.seal(seed, f"totp:{user_id}")
        with self.db:
            self.db.execute("INSERT INTO totp_credentials (user_id, seed_enc, created) VALUES (?,?,?) "
                            "ON CONFLICT(user_id) DO UPDATE SET seed_enc = excluded.seed_enc, confirmed = NULL, "
                            "last_counter = -1, created = excluded.created", (user_id, sealed, self.clock()))
        return b32(seed), otpauth_uri(seed, account)

    def totp_check(self, user_id: str, code: object, confirm: bool = False) -> bool:
        """Verify a code (consuming its time step). ``confirm`` accepts an unconfirmed seed and confirms it."""
        row = self._totp_row(user_id)
        if row is None or (row["confirmed"] is None and not confirm):
            return False
        seed = self.box.open(row["seed_enc"], f"totp:{user_id}")
        counter = totp_match(seed, code, self.clock(), row["last_counter"])
        if counter is None:
            return False
        with self.db:
            cur = self.db.execute("UPDATE totp_credentials SET last_counter = ?, confirmed = COALESCE(confirmed, ?) "
                                  "WHERE user_id = ? AND last_counter < ?", (counter, self.clock(), user_id, counter))
        return cur.rowcount == 1

    def totp_remove(self, user_id: str) -> bool:
        with self.db:
            return self.db.execute("DELETE FROM totp_credentials WHERE user_id = ?", (user_id,)).rowcount > 0

    # passkeys ----------------------------------------------------------------------------------
    def _handle(self, user_id: str) -> bytes:
        row = self.db.execute("SELECT webauthn_handle FROM users WHERE id = ?", (user_id,)).fetchone()
        if row["webauthn_handle"]:
            return bytes(row["webauthn_handle"])
        handle = secrets.token_bytes(32)
        with self.db:
            self.db.execute("UPDATE users SET webauthn_handle = ? WHERE id = ?", (handle, user_id))
        return handle

    def _save_challenge(self, challenge: bytes, purpose: str, user_id: str | None) -> str:
        cid = secrets.token_urlsafe(16)
        now = self.clock()
        with self.db:
            self.db.execute("DELETE FROM webauthn_challenges WHERE expires < ?", (now,))
            self.db.execute("INSERT INTO webauthn_challenges VALUES (?,?,?,?,?)",
                            (cid, user_id, purpose, challenge, now + CHALLENGE_TTL))
        return cid

    def _take_challenge(self, cid: object, purpose: str):
        """Fetch and delete (single use, even if verification then fails)."""
        if not isinstance(cid, str):
            return None
        with self.db:
            row = self.db.execute("SELECT * FROM webauthn_challenges WHERE id = ?", (cid,)).fetchone()
            self.db.execute("DELETE FROM webauthn_challenges WHERE id = ?", (cid,))
        if row is None or row["purpose"] != purpose or row["expires"] <= self.clock():
            return None
        return row

    def passkey_register_options(self, user_id: str) -> tuple[str, dict]:
        from webauthn import generate_registration_options, options_to_json
        from webauthn.helpers import base64url_to_bytes
        from webauthn.helpers.structs import (AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor,
                                              ResidentKeyRequirement, UserVerificationRequirement)
        user = self.get_user(user_id)
        existing = [PublicKeyCredentialDescriptor(id=base64url_to_bytes(r["id"]))
                    for r in self.db.execute("SELECT id FROM passkeys WHERE user_id = ?", (user_id,))]
        opts = generate_registration_options(
            rp_id=self.rp_id, rp_name=self.rp_name, user_id=self._handle(user_id),
            user_name=user["username"] or user["name"] or user_id, user_display_name=user["name"] or user["username"] or "",
            exclude_credentials=existing,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.PREFERRED, user_verification=UserVerificationRequirement.REQUIRED))
        cid = self._save_challenge(opts.challenge, "register", user_id)
        return cid, json.loads(options_to_json(opts))

    def passkey_register_verify(self, user_id: str, cid: object, credential: object, origin: str,
                                name: str | None = None) -> str:
        from webauthn import verify_registration_response
        from webauthn.helpers import bytes_to_base64url
        row = self._take_challenge(cid, "register")
        if row is None or row["user_id"] != user_id:
            raise PolicyError("challenge_invalid", "the passkey challenge is unknown or expired")
        if not isinstance(credential, dict):
            raise PolicyError("credential_invalid", "credential must be an object")
        try:
            v = verify_registration_response(credential=credential, expected_challenge=bytes(row["challenge"]),
                                             expected_rp_id=self.rp_id, expected_origin=origin,
                                             require_user_verification=True)
        except Exception as exc:  # the library raises several types for a bad credential
            raise PolicyError("credential_invalid", f"passkey registration failed: {exc}") from exc
        cred_id = bytes_to_base64url(v.credential_id)
        transports = (credential.get("response") or {}).get("transports")
        try:
            with self.db:
                self.db.execute("INSERT INTO passkeys (id, user_id, public_key, sign_count, transports, name, backed_up, "
                                "created) VALUES (?,?,?,?,?,?,?,?)",
                                (cred_id, user_id, v.credential_public_key, v.sign_count,
                                 json.dumps(transports) if isinstance(transports, list) else None,
                                 (name or "Passkey")[:64], int(v.credential_backed_up), self.clock()))
        except sqlite3.IntegrityError as exc:
            raise PolicyError("credential_exists", "that passkey is already registered") from exc
        return cred_id

    def passkey_auth_options(self, username: object = None) -> tuple[str, dict]:
        from webauthn import generate_authentication_options, options_to_json
        from webauthn.helpers import base64url_to_bytes
        from webauthn.helpers.structs import PublicKeyCredentialDescriptor, UserVerificationRequirement
        allow, user_id = [], None
        if isinstance(username, str) and username:
            row = self.find_username(username.lower())
            if row is not None:
                user_id = row["id"]
                allow = [PublicKeyCredentialDescriptor(id=base64url_to_bytes(r["id"]))
                         for r in self.db.execute("SELECT id FROM passkeys WHERE user_id = ?", (user_id,))]
        opts = generate_authentication_options(rp_id=self.rp_id, allow_credentials=allow,
                                               user_verification=UserVerificationRequirement.REQUIRED)
        return self._save_challenge(opts.challenge, "authenticate", user_id), json.loads(options_to_json(opts))

    def passkey_auth_verify(self, cid: object, credential: object, origin: str):
        """The user row the assertion proves, or raises PolicyError."""
        from webauthn import verify_authentication_response
        from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
        row = self._take_challenge(cid, "authenticate")
        if row is None:
            raise PolicyError("challenge_invalid", "the passkey challenge is unknown or expired")
        if not isinstance(credential, dict) or not isinstance(credential.get("rawId", credential.get("id")), str):
            raise PolicyError("credential_invalid", "credential must be an object with an id")
        try:
            cred_id = bytes_to_base64url(base64url_to_bytes(credential.get("rawId") or credential["id"]))
        except (ValueError, TypeError) as exc:
            raise PolicyError("credential_invalid", "bad credential id") from exc
        pk = self.db.execute("SELECT * FROM passkeys WHERE id = ?", (cred_id,)).fetchone()
        if pk is None or (row["user_id"] is not None and pk["user_id"] != row["user_id"]):
            raise PolicyError("credential_unknown", "unknown passkey")
        handle = (credential.get("response") or {}).get("userHandle")
        if handle:
            try:
                handle_bytes = base64url_to_bytes(handle)
            except (ValueError, TypeError) as exc:
                raise PolicyError("credential_invalid", "bad user handle") from exc
            if handle_bytes != self._handle(pk["user_id"]):
                raise PolicyError("credential_unknown", "passkey does not belong to that user")
        try:
            v = verify_authentication_response(credential=credential, expected_challenge=bytes(row["challenge"]),
                                               expected_rp_id=self.rp_id, expected_origin=origin,
                                               credential_public_key=bytes(pk["public_key"]),
                                               credential_current_sign_count=pk["sign_count"],
                                               require_user_verification=True)
        except Exception as exc:
            raise PolicyError("credential_invalid", f"passkey assertion failed: {exc}") from exc
        with self.db:
            self.db.execute("UPDATE passkeys SET sign_count = ?, last_used = ?, backed_up = ? WHERE id = ?",
                            (v.new_sign_count, self.clock(), int(v.credential_backed_up), cred_id))
        user = self.get_user(pk["user_id"])
        if user is None or user["disabled"]:
            raise PolicyError("credential_unknown", "unknown passkey")
        return user

    # bootstrap ---------------------------------------------------------------------------------
    def issue_bootstrap_token(self, ttl: float = BOOTSTRAP_TTL) -> str:
        if self.owner_exists():
            raise PolicyError("bootstrap_closed", "an Owner already exists; bootstrap is closed")
        token = secrets.token_urlsafe(24)
        now = self.clock()
        with self.db:
            self.db.execute("DELETE FROM bootstrap_tokens")
            self.db.execute("INSERT INTO bootstrap_tokens VALUES (?,?,?)", (token_hash(token), now, now + ttl))
        return token

    async def redeem_bootstrap(self, token: object, username: object, name: object, password: object) -> str:
        if self.owner_exists():
            raise PolicyError("bootstrap_closed", "an Owner already exists")
        username = check_username(username)
        name = name if isinstance(name, str) and name.strip() else username
        check_password_policy(password, username, name)
        if not isinstance(token, str) or not token:
            raise PolicyError("bootstrap_token_invalid", "setup token missing")
        hashed = await self.hash_password(password)
        now = self.clock()
        user_id = secrets.token_hex(16)
        with self.db:  # one transaction: the token is spent exactly once, and only while no Owner exists
            cur = self.db.execute("DELETE FROM bootstrap_tokens WHERE hash = ? AND expires > ?", (token_hash(token), now))
            if cur.rowcount != 1:
                raise PolicyError("bootstrap_token_invalid", "the setup token is wrong, used or expired")
            if self.owner_exists():
                raise PolicyError("bootstrap_closed", "an Owner already exists")
            try:
                self.db.execute("INSERT INTO users (id, username, name, role, kind, password_hash, password_changed, "
                                "created, updated) VALUES (?,?,?,?,?,?,?,?,?)",
                                (user_id, username, name, "owner", "hk", hashed, now, now, now))
            except sqlite3.IntegrityError as exc:
                raise PolicyError("username_taken", "that user name is taken") from exc
            self.db.execute("DELETE FROM bootstrap_tokens")
        log.info("bootstrap: created the first Owner (%s)", username)
        return user_id


# -- REST helpers ---------------------------------------------------------------------------------
async def read_json(request: web.Request) -> dict:
    if request.content_type != "application/json":
        raise web.HTTPUnsupportedMediaType(text='{"error":"json_required"}', content_type="application/json")
    try:
        body = await request.json()
    except (ValueError, UnicodeError):
        body = None
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text='{"error":"invalid_json"}', content_type="application/json")
    return body


def require_origin(request: web.Request) -> str:
    """Public POSTs must come from a page (loopback_only has already checked the value)."""
    origin = request.headers.get("Origin")
    if not origin:
        raise web.HTTPForbidden(text='{"error":"origin_required"}', content_type="application/json")
    return origin


def accounts_of(request: web.Request) -> Accounts:
    return request.app["accounts"]


def require_user(request: web.Request) -> Identity:
    ident = identity(request)
    if ident.user is None:
        raise web.HTTPForbidden(text='{"error":"user_required"}', content_type="application/json")
    return ident


def require_manager(request: web.Request) -> Identity:
    """Owner or Admin. A stand-in for P3.2's `configure` grant on users and devices."""
    ident = require_user(request)
    if ident.user.role not in MANAGERS:
        raise web.HTTPForbidden(text='{"error":"forbidden"}', content_type="application/json")
    return ident


def require_fresh(request: web.Request, ident: Identity) -> None:
    if not ident.fresh_within(STEP_UP_WINDOW, request.app["clock"]()):
        raise web.HTTPForbidden(text='{"error":"step_up_required"}', content_type="application/json")


def passkey_origin(request: web.Request, acc: Accounts) -> str:
    origin = require_origin(request)
    host = (urlparse(origin).hostname or "").lower()
    if host != acc.rp_id and not host.endswith("." + acc.rp_id):
        raise web.HTTPBadRequest(text='{"error":"origin_not_allowed_for_passkeys"}', content_type="application/json")
    return origin


def signed_in(request: web.Request, user_row, method: str) -> web.Response:
    """Start a session for ``user_row`` on this request's door and answer with its cookies."""
    mgr: SessionManager = request.app["sessions"]
    issued: Issued = mgr.create(user_row["id"], door_of(request), method,
                                user_agent=request.headers.get("User-Agent"), source_ip=client_ip(request))
    acc = accounts_of(request)
    resp = ok({"user": acc.describe(acc.get_user(user_row["id"])), "csrf": issued.csrf,
               "session": {"id": issued.session_id, "door": issued.door, "expires": issued.expires}})
    set_session_cookies(request, resp, issued)
    return resp


def limited(wait: float) -> web.Response:
    return error(429, "too_many_attempts", retry_after=int(wait) + 1)


# -- sign-in --------------------------------------------------------------------------------------
async def password_sign_in(request: web.Request) -> web.Response:
    require_origin(request)
    body = await read_json(request)
    acc = accounts_of(request)
    ip = client_ip(request)
    username, password = body.get("username"), body.get("password")
    if not isinstance(username, str) or not isinstance(password, str):
        return error(400, "username_and_password_required")
    status, value = await acc.check_password(username, password, ip)
    if status == "limited":
        return limited(value)
    if status == "invalid":
        return error(401, "invalid_credentials")
    row = value
    door = door_of(request)
    if acc.has_totp(row["id"]):
        return ok({"next": "totp", "pending": acc.start_pending(row["id"], door)})
    if door == "tunnel":  # PLAN §7: on the tunnel a password alone is never enough
        methods = ["passkey"] if acc.has_passkey(row["id"]) else []
        return error(403, "second_factor_required", methods=methods)
    return signed_in(request, row, "password")


async def totp_verify(request: web.Request) -> web.Response:
    """Second step of a password sign-in."""
    require_origin(request)
    body = await read_json(request)
    acc = accounts_of(request)
    ip = client_ip(request)
    wait = acc.retry_after(ip, None)
    if wait > 0:
        return limited(wait)
    pending = acc.get_pending(body.get("pending"), door_of(request))
    if pending is None:
        acc.record_failure(ip, None)
        return error(401, "pending_invalid")
    user = acc.get_user(pending["user_id"])
    if user is None or user["disabled"]:
        acc.end_pending(pending)
        return error(401, "invalid_credentials")
    wait = acc.retry_after(ip, user["username"])
    if wait > 0:
        return limited(wait)
    if not acc.totp_check(user["id"], body.get("code")):
        acc.pending_failed(pending)
        acc.record_failure(ip, user["username"], user["id"])
        return error(401, "invalid_code")
    acc.end_pending(pending)
    acc.record_success(user["username"], user["id"])
    return signed_in(request, user, "password+totp")


async def passkey_options(request: web.Request) -> web.Response:
    require_origin(request)
    body = await read_json(request)
    acc = accounts_of(request)
    wait = acc.retry_after(client_ip(request), None)
    if wait > 0:
        return limited(wait)
    cid, options = acc.passkey_auth_options(body.get("username"))
    return ok({"challenge_id": cid, "options": options})


async def passkey_verify(request: web.Request) -> web.Response:
    """Sign in with a passkey, or (already signed in as the same user) step up the session."""
    acc = accounts_of(request)
    origin = passkey_origin(request, acc)
    body = await read_json(request)
    ip = client_ip(request)
    wait = acc.retry_after(ip, None)
    if wait > 0:
        return limited(wait)
    try:
        user = acc.passkey_auth_verify(body.get("challenge_id"), body.get("credential"), origin)
    except PolicyError as exc:
        acc.record_failure(ip, None)
        return error(401, exc.code)
    ident = identity(request)
    if ident.user is not None and ident.user.id == user["id"] and ident.session_id:
        request.app["sessions"].mark_fresh(ident.session_id, "passkey")
        return ok({"step_up": True})
    return signed_in(request, user, "passkey")


# -- enrolment (signed in) ------------------------------------------------------------------------
async def totp_enroll(request: web.Request) -> web.Response:
    ident = require_user(request)
    acc = accounts_of(request)
    if acc.has_totp(ident.user.id):
        require_fresh(request, ident)  # replacing a working TOTP needs a fresh factor
    secret, uri = acc.totp_begin(ident.user.id, ident.user.username or ident.user.name or ident.user.id)
    return ok({"secret": secret, "uri": uri})


async def totp_enroll_confirm(request: web.Request) -> web.Response:
    ident = require_user(request)
    body = await read_json(request)
    acc = accounts_of(request)
    if not acc.totp_check(ident.user.id, body.get("code"), confirm=True):
        return error(400, "invalid_code")
    request.app["sessions"].mark_fresh(ident.session_id, "totp")
    return ok({"totp": True})


async def totp_step_up(request: web.Request) -> web.Response:
    ident = require_user(request)
    body = await read_json(request)
    acc = accounts_of(request)
    ip = client_ip(request)
    wait = acc.retry_after(ip, ident.user.username)
    if wait > 0:
        return limited(wait)
    if not acc.totp_check(ident.user.id, body.get("code")):
        acc.record_failure(ip, ident.user.username)
        return error(401, "invalid_code")
    request.app["sessions"].mark_fresh(ident.session_id, "totp")
    return ok({"step_up": True})


async def totp_remove(request: web.Request) -> web.Response:
    ident = require_user(request)
    require_fresh(request, ident)
    return ok({"removed": accounts_of(request).totp_remove(ident.user.id)})


async def passkey_register_options(request: web.Request) -> web.Response:
    ident = require_user(request)
    acc = accounts_of(request)
    passkey_origin(request, acc)
    cid, options = acc.passkey_register_options(ident.user.id)
    return ok({"challenge_id": cid, "options": options})


async def passkey_register_verify(request: web.Request) -> web.Response:
    ident = require_user(request)
    acc = accounts_of(request)
    origin = passkey_origin(request, acc)
    body = await read_json(request)
    try:
        cred_id = acc.passkey_register_verify(ident.user.id, body.get("challenge_id"), body.get("credential"), origin,
                                              body.get("name") if isinstance(body.get("name"), str) else None)
    except PolicyError as exc:
        return error(400, exc.code)
    return ok({"id": cred_id}, status=201)


async def passkey_list(request: web.Request) -> web.Response:
    ident = require_user(request)
    rows = accounts_of(request).db.execute(
        "SELECT id, name, created, last_used, backed_up FROM passkeys WHERE user_id = ? ORDER BY created",
        (ident.user.id,))
    return ok({"passkeys": [dict(r) for r in rows]})


async def passkey_delete(request: web.Request) -> web.Response:
    ident = require_user(request)
    require_fresh(request, ident)
    acc = accounts_of(request)
    with acc.db:
        n = acc.db.execute("DELETE FROM passkeys WHERE id = ? AND user_id = ?",
                           (request.match_info["id"], ident.user.id)).rowcount
    return ok() if n else error(404, "not_found")


async def change_password(request: web.Request) -> web.Response:
    ident = require_user(request)
    body = await read_json(request)
    acc = accounts_of(request)
    row = acc.get_user(ident.user.id)
    if row["password_hash"]:
        status, value = await acc.check_password(row["username"], body.get("current") or "", client_ip(request))
        if status == "limited":
            return limited(value)
        if status != "ok":
            return error(401, "invalid_credentials")
    elif not row["username"]:
        return error(400, "username_required")
    try:
        await acc.set_password(ident.user.id, body.get("new"))
    except PolicyError as exc:
        return error(400, exc.code, message=str(exc))
    request.app["sessions"].revoke_user(ident.user.id, "password_changed", keep=ident.session_id)
    return ok()


# -- bootstrap ------------------------------------------------------------------------------------
async def bootstrap_status(request: web.Request) -> web.Response:
    return ok({"open": not accounts_of(request).owner_exists()})


async def bootstrap(request: web.Request) -> web.Response:
    require_origin(request)
    body = await read_json(request)
    acc = accounts_of(request)
    ip = client_ip(request)
    wait = acc.retry_after(ip, None)
    if wait > 0:
        return limited(wait)
    try:
        user_id = await acc.redeem_bootstrap(body.get("token"), body.get("username"), body.get("name"),
                                             body.get("password"))
    except PolicyError as exc:
        if exc.code == "bootstrap_token_invalid":
            acc.record_failure(ip, None)
            return error(401, exc.code)
        return error(410 if exc.code == "bootstrap_closed" else 400, exc.code, message=str(exc))
    return signed_in(request, acc.get_user(user_id), "bootstrap")


# -- user management (Owner / Admin until P3.2's grants) ------------------------------------------
async def users_list(request: web.Request) -> web.Response:
    require_manager(request)
    return ok({"users": accounts_of(request).list_users()})


async def users_create(request: web.Request) -> web.Response:
    ident = require_manager(request)
    body = await read_json(request)
    role = body.get("role")
    if role == "owner" and ident.user.role != "owner":
        return error(403, "forbidden")
    acc = accounts_of(request)
    if not isinstance(body.get("password"), str):
        return error(400, "password_required")
    try:
        user_id = await acc.create_user(body.get("username"), body.get("name") if isinstance(body.get("name"), str) else None,
                                        role, body.get("password"))
    except PolicyError as exc:
        return error(409 if exc.code == "username_taken" else 400, exc.code, message=str(exc))
    return ok({"user": acc.describe(acc.get_user(user_id))}, status=201)


async def users_update(request: web.Request) -> web.Response:
    ident = require_manager(request)
    body = await read_json(request)
    acc = accounts_of(request)
    row = acc.get_user(request.match_info["id"])
    if row is None:
        return error(404, "not_found")
    new_role = body.get("role", row["role"])
    disabled = body.get("disabled", bool(row["disabled"]))
    name = body.get("name", row["name"])
    if new_role not in ROLES or not isinstance(disabled, bool) or not (name is None or isinstance(name, str)):
        return error(400, "invalid")
    if ident.user.role != "owner" and "owner" in (row["role"], new_role):
        return error(403, "forbidden")
    losing_owner = row["role"] == "owner" and not row["disabled"] and (new_role != "owner" or disabled)
    if losing_owner and acc.db.execute("SELECT COUNT(*) FROM users WHERE role = 'owner' AND disabled = 0").fetchone()[0] <= 1:
        return error(409, "last_owner")
    with acc.db:
        acc.db.execute("UPDATE users SET role = ?, disabled = ?, name = ?, updated = ? WHERE id = ?",
                       (new_role, int(disabled), name, acc.clock(), row["id"]))
    if disabled and not row["disabled"]:
        request.app["sessions"].revoke_user(row["id"], "disabled")
    return ok({"user": acc.describe(acc.get_user(row["id"]))})


PUBLIC = ("/api/auth/password", "/api/auth/totp/verify", "/api/auth/passkey/options", "/api/auth/passkey/verify",
          "/api/bootstrap")


def register(app: web.Application, hub=None) -> None:
    cfg = app["cfg"]
    box = SecretBox(cfg.secrets_dir / KEY_FILE)  # read (or created) on first use only
    app["secret_box"] = box
    app["accounts"] = Accounts(app["store"].db, box, lambda: app["clock"](), rp_id=cfg.webauthn_rp_id)
    app.setdefault("public_paths", set()).update(PUBLIC)
    r = app.router
    r.add_post("/api/auth/password", password_sign_in)
    r.add_post("/api/auth/totp/verify", totp_verify)
    r.add_post("/api/auth/totp/enroll", totp_enroll)
    r.add_post("/api/auth/totp/enroll/confirm", totp_enroll_confirm)
    r.add_post("/api/auth/totp/step-up", totp_step_up)
    r.add_delete("/api/auth/totp", totp_remove)
    r.add_post("/api/auth/passkey/options", passkey_options)
    r.add_post("/api/auth/passkey/verify", passkey_verify)
    r.add_post("/api/auth/passkey/register/options", passkey_register_options)
    r.add_post("/api/auth/passkey/register/verify", passkey_register_verify)
    r.add_get("/api/auth/passkeys", passkey_list)
    r.add_delete("/api/auth/passkeys/{id}", passkey_delete)
    r.add_post("/api/account/password", change_password)
    r.add_get("/api/bootstrap", bootstrap_status)
    r.add_post("/api/bootstrap", bootstrap)
    r.add_get("/api/users", users_list)
    r.add_post("/api/users", users_create)
    r.add_patch("/api/users/{id}", users_update)
