"""An assistant's credential: a person's session with a ceiling (docs/phase12/MCP-SERVER.md "Who is calling").

Every credential is two rows: a ``sessions`` row of method ``mcp`` (whose person it acts for, until when, revoked
or not: Me → Sessions lists it, its Revoke and "sign out everywhere" end it, a disabled person's assistant stops),
and a grant here (``mcp_grants``, migration 0028) with what it may do at most, its MCP scopes.

* **A personal key** (``kind = 'key'``): ``mmcp_<16 hex id>_<43 base64url chars>`` (256 random bits), shown once.
  Only its SHA-256 is stored, compared in constant time. Home network only, whatever else is set; never the
  ``commands`` scope (a key can be copied; house commands need a signed-in consent). Lasts ``mcp_key_days``.
* **A sign-in** (``kind = 'oauth'``, mcp/oauth.py): the session's own access token (15 minutes) and refresh token
  (rotated on use, a reused one ends the family), the scopes the person ticked on the consent page, and whether
  it may be used from away (``away``; the house's ``mcp_away`` must allow it too).

Who may have one: an Owner or an Admin (open question 1: "Owner and Admin only at first"), checked when it is
made AND on every request, so a person moved to another role loses their assistant's access at once.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import re
import secrets
from dataclasses import dataclass
from typing import Any

from ..identity import sessions

log = logging.getLogger("mantel.mcp")

SCOPES = ("read", "settings", "screens", "audit", "commands", "restore")
DEFAULT_SCOPES = ("read", "settings", "screens")
KEY_SCOPES = tuple(s for s in SCOPES if s != "commands")       # a key never carries `commands` (question 4)
MANAGERS = ("owner", "admin")
PREFIX = "mmcp_"
_TOKEN = re.compile(r"^mmcp_([0-9a-f]{16})_([A-Za-z0-9_-]{43})\Z")
_NAME = re.compile(r"^[\w .:@()'+-]{1,64}\Z")
OAUTH_DAYS = 30                                    # a sign-in lasts as long as a LAN browser's session
FORGET_AFTER = 30 * 86400                          # revoked or expired grants leave the list after 30 days


class GrantError(ValueError):
    pass


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def clean_scopes(scopes: Any, allowed: tuple[str, ...] = SCOPES) -> list[str]:
    if not isinstance(scopes, (list, tuple)) or not all(isinstance(s, str) for s in scopes):
        raise GrantError("scopes: a list of " + ", ".join(allowed))
    got = set(scopes)
    bad = sorted(s for s in got if s not in allowed)
    if bad:
        raise GrantError(f"scopes: {', '.join(bad)} not allowed here (allowed: {', '.join(allowed)})")
    if not got:
        raise GrantError("scopes: at least one")
    return [s for s in SCOPES if s in got]


def clean_name(name: Any) -> str:
    name = str(name or "").strip()
    if not _NAME.match(name):
        raise GrantError("name: 1-64 letters, digits, spaces or . : @ ( ) ' + _ -")
    return name


@dataclass(frozen=True)
class Grant:
    id: str
    kind: str
    user_id: str
    session_id: str
    client_id: str | None
    name: str
    scopes: frozenset[str]
    away: bool
    expires: float

    @property
    def via(self) -> str:
        return "mcp:" + self.name


def _grant(row) -> Grant | None:
    try:
        scopes = frozenset(s for s in json.loads(row["scopes"]) if s in SCOPES)
    except (TypeError, ValueError):
        return None                                 # an unreadable row never widens access
    return Grant(row["id"], row["kind"], row["user_id"], row["session_id"], row["client_id"], row["name"], scopes,
                 bool(row["away"]), float(row["expires"]))


class Grants:
    """``app["mcp_grants"]`` over the app's database and its SessionManager."""

    def __init__(self, conn, sessions_mgr, clock) -> None:
        self.db = conn
        self.sessions = sessions_mgr
        self.clock = clock

    # -- making ----------------------------------------------------------------------------------------------
    def _check_person(self, user) -> None:
        if user is None or user.role not in MANAGERS:
            raise GrantError("only an Owner or an Admin may connect an assistant")

    def create_key(self, user, name: Any, scopes: Any, days: int, *, source_ip: str | None = None,
                   before=None) -> tuple[Grant, str]:
        """A personal key for ``user``. ``before(grant_id, name, scopes)`` writes the audit row before anything
        exists; if it raises, nothing is made. The credential is returned once."""
        self._check_person(user)
        name = clean_name(name)
        scopes = clean_scopes(scopes, KEY_SCOPES)
        gid = secrets.token_hex(8)
        if before is not None:
            before(gid, name, scopes)
        now = self.clock()
        issued = self.sessions.create(user.id, "lan", sessions.MCP_METHOD, ttl=days * 86400.0, refresh=False,
                                      fresh=False, user_agent=f"Assistant: {name}", source_ip=source_ip, now=now)
        token = f"{PREFIX}{gid}_{secrets.token_urlsafe(32)}"
        with self.db:
            self.db.execute(
                "INSERT INTO mcp_grants (id, kind, user_id, session_id, client_id, name, scopes, away, secret_hash, "
                "created, expires) VALUES (?, 'key', ?, ?, NULL, ?, ?, 0, ?, ?, ?)",
                (gid, user.id, issued.session_id, name, json.dumps(scopes), token_hash(token), now, issued.expires))
        log.info("assistant key %s (%s) made for %s with %s", gid, name, user.id, scopes)
        return self.get(gid), token

    def create_oauth(self, user, client_id: str, name: str, scopes: list[str], away: bool, door: str, *,
                     source_ip: str | None = None) -> tuple[Grant, sessions.Issued]:
        """A signed-in assistant (mcp/oauth.py, after the person's consent): its session's tokens."""
        self._check_person(user)
        scopes = clean_scopes(scopes)
        gid = secrets.token_hex(8)
        now = self.clock()
        issued = self.sessions.create(user.id, door if door in sessions.DOORS else "tunnel", sessions.MCP_METHOD,
                                      ttl=OAUTH_DAYS * 86400.0, refresh=True, fresh=False,
                                      user_agent=f"Assistant: {name}", source_ip=source_ip, now=now)
        with self.db:
            self.db.execute(
                "INSERT INTO mcp_grants (id, kind, user_id, session_id, client_id, name, scopes, away, secret_hash, "
                "created, expires) VALUES (?, 'oauth', ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
                (gid, user.id, issued.session_id, client_id, clean_name(name), json.dumps(scopes), int(bool(away)),
                 now, issued.expires))
        log.info("assistant %s (%s) signed in for %s with %s%s", gid, name, user.id, scopes, " (away too)" if away else "")
        return self.get(gid), issued

    # -- reading ---------------------------------------------------------------------------------------------
    def get(self, grant_id: str) -> Grant | None:
        row = self.db.execute("SELECT * FROM mcp_grants WHERE id = ?", (grant_id,)).fetchone()
        return _grant(row) if row is not None else None

    def by_session(self, session_id: str) -> Grant | None:
        row = self.db.execute("SELECT * FROM mcp_grants WHERE session_id = ? AND revoked IS NULL",
                              (session_id,)).fetchone()
        return _grant(row) if row is not None else None

    def verify_key(self, token: Any) -> Grant | None:
        """The live grant behind a personal key, or None (one answer for every refusal)."""
        if not isinstance(token, str):
            return None
        m = _TOKEN.match(token)
        if not m:
            return None
        row = self.db.execute("SELECT * FROM mcp_grants WHERE id = ? AND kind = 'key'", (m.group(1),)).fetchone()
        expected = row["secret_hash"] if row is not None and row["secret_hash"] else token_hash(PREFIX + "0" * 60)
        if not hmac.compare_digest(expected, token_hash(token)) or row is None or row["revoked"] is not None:
            return None
        if float(row["expires"]) <= self.clock():
            return None
        return _grant(row)

    def touch(self, grant: Grant, source_ip: str | None) -> None:
        now = self.clock()
        row = self.db.execute("SELECT last_used FROM mcp_grants WHERE id = ?", (grant.id,)).fetchone()
        if row is not None and (row["last_used"] is None or now - row["last_used"] >= 30):
            with self.db:
                self.db.execute("UPDATE mcp_grants SET last_used = ?, last_ip = ? WHERE id = ?",
                                (now, source_ip, grant.id))

    def live(self, grant: Grant) -> bool:
        row = self.db.execute("SELECT revoked, expires FROM mcp_grants WHERE id = ?", (grant.id,)).fetchone()
        if row is None or row["revoked"] is not None or float(row["expires"]) <= self.clock():
            return False
        return self.sessions.get(grant.session_id) is not None

    def list(self, user_id: str | None = None) -> list[dict]:
        """Every grant (one person's, or everyone's for an Owner), newest first; ``state``: live, revoked, ended."""
        self.forget_old()
        sql = ("SELECT g.*, u.name AS user_name, u.username FROM mcp_grants g LEFT JOIN users u ON u.id = g.user_id"
               + (" WHERE g.user_id = ?" if user_id else "") + " ORDER BY g.created DESC")
        out = []
        for r in self.db.execute(sql, (user_id,) if user_id else ()):
            d = {k: r[k] for k in ("id", "kind", "user_id", "client_id", "name", "created", "expires", "last_used",
                                   "last_ip", "revoked", "revoked_reason")}
            d["scopes"] = sorted(_grant(r).scopes, key=SCOPES.index) if _grant(r) else []
            d["away"] = bool(r["away"])
            d["person"] = r["user_name"] or r["username"] or r["user_id"]
            g = _grant(r)
            d["state"] = ("revoked" if r["revoked"] is not None else
                          "live" if g is not None and self.live(g) else "ended")
            out.append(d)
        return out

    # -- ending ----------------------------------------------------------------------------------------------
    def revoke(self, grant_id: str, reason: str = "revoked") -> bool:
        row = self.db.execute("SELECT session_id FROM mcp_grants WHERE id = ? AND revoked IS NULL",
                              (grant_id,)).fetchone()
        if row is None:
            return False
        with self.db:
            self.db.execute("UPDATE mcp_grants SET revoked = ?, revoked_reason = ? WHERE id = ? AND revoked IS NULL",
                            (self.clock(), reason, grant_id))
        self.sessions.revoke(row["session_id"], reason)
        log.info("assistant grant %s revoked (%s)", grant_id, reason)
        return True

    def revoke_client(self, client_id: str, reason: str) -> int:
        ids = [r["id"] for r in self.db.execute("SELECT id FROM mcp_grants WHERE client_id = ? AND revoked IS NULL",
                                                (client_id,))]
        return sum(self.revoke(i, reason) for i in ids)

    def forget_old(self) -> int:
        cut = self.clock() - FORGET_AFTER
        with self.db:
            cur = self.db.execute("DELETE FROM mcp_grants WHERE (revoked IS NOT NULL AND revoked < ?) OR expires < ?",
                                  (cut, cut))
        return cur.rowcount
