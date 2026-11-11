"""Who is calling ``/mcp``: one bearer credential, its person, its door, its ceiling.

``authenticate(request)`` takes exactly one ``Authorization: Bearer`` value (never a cookie, never a query
parameter), and answers a :class:`Caller` or raises :class:`Refused`:

* ``mmcp_…``: a personal key (grants.verify_key). **Home network only**, whatever is set.
* anything else: a signed-in assistant's access token (mcp/oauth.py), looked up as the session's own access token;
  only a session of method ``mcp`` with a live grant counts (a browser's or an app's token is refused here, as an
  assistant's is refused everywhere else: sessions.identity, app_auth). From away only when the grant was allowed
  away AND the house allows it (``mcp_away``).

Then, every request: assistants on (``mcp_enabled``), the session still live (authz.refresh re-reads it), the
person still an Owner or Admin. The caller's principal is the person's own (authz.principal_of), with
``via = mcp:<name>``, so RBAC is theirs and every row says it was their assistant. The scopes are the grant's,
less ``commands`` unless the house allows it and the grant was a sign-in.
"""
from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from aiohttp import web

from ..identity import sessions
from .config import READS_PER_MINUTE
from .grants import MANAGERS, PREFIX, Grant


class Refused(Exception):
    """``status`` 401 (who are you?) or 403 (not here, not now); ``code`` for the body."""

    def __init__(self, status: int, code: str, message: str, scope: str | None = None) -> None:
        super().__init__(message)
        self.status, self.code, self.message, self.scope = status, code, message, scope


@dataclass
class Caller:
    app: Any
    principal: Any
    grant: Grant
    scopes: frozenset[str]
    door: str
    source_ip: str | None
    request: Any = None
    meta: dict = field(default_factory=dict)            # the request's _meta (clientInfo...), for the log

    @property
    def user(self):
        return self.principal.identity.user

    @property
    def via(self) -> str:
        return self.grant.via

    def has(self, scope: str) -> bool:
        return scope in self.scopes


def bearer(request: web.Request) -> str | None:
    values = request.headers.getall("Authorization", [])
    if len(values) != 1:
        return None
    kind, _, token = values[0].partition(" ")
    if kind.lower() != "bearer" or not token.strip() or " " in token.strip():
        return None
    return token.strip()


def _from_access(app, token: str) -> Grant | None:
    mgr = app.get("sessions")
    if mgr is None:
        return None
    row = mgr.from_access(token, app["clock"]())
    if row is None or row["method"] != sessions.MCP_METHOD:
        return None
    grants = app["mcp_grants"]
    g = grants.by_session(row["id"])
    return g if g is not None and g.kind == "oauth" else None


def authenticate(request: web.Request) -> Caller:
    app = request.app
    settings = app["mcp_settings"]
    token = bearer(request)
    if token is None:
        raise Refused(401, "unauthenticated", "an assistant's credential is needed (Authorization: Bearer)")
    grants = app["mcp_grants"]
    grant = grants.verify_key(token) if token.startswith(PREFIX) else _from_access(app, token)
    if grant is None:
        raise Refused(401, "invalid_token", "this credential is not valid (expired, revoked or unknown)")
    if not settings.enabled:
        raise Refused(403, "assistants_off", "Assistants are off on this Mantel (Mantel Settings → Advanced → "
                                             "Assistants)")
    door = sessions.door_of(request)
    if door != "lan":
        if grant.kind == "key":
            raise Refused(403, "home_only", "a personal key works on the home network only")
        if not (grant.away and settings.get("mcp_away")):
            raise Refused(403, "home_only", "this assistant may be used on the home network only")
        if door != "tunnel":
            raise Refused(403, "home_only", "not through Home Assistant's sidebar")
    mgr = app["sessions"]
    row = mgr.get(grant.session_id)
    if row is None or not grants.live(grant):
        raise Refused(401, "invalid_token", "this credential is not valid (expired, revoked or unknown)")
    user = sessions.user_from_row(row)
    if user.role not in MANAGERS:
        raise Refused(403, "forbidden", "only an Owner's or an Admin's assistant may connect")
    ident = sessions.Identity(user=user, device=None, door=door, session_id=row["id"], via=grant.via)
    ip = sessions.client_ip(request)
    authz = app.get("authz")
    if authz is None:
        raise Refused(403, "unavailable", "Mantel's roles are not ready")
    principal = authz.principal_of(ident, ip)
    scopes = set(grant.scopes)
    if "commands" in scopes and not (grant.kind == "oauth" and settings.get("mcp_commands")):
        scopes.discard("commands")
    grants.touch(grant, ip)
    mgr.touch(row, app["clock"](), ip)
    return Caller(app, principal, grant, frozenset(scopes), door, ip, request)


# -- rate limits ---------------------------------------------------------------------------------------------------
class Limits:
    """Per grant, in memory: requests per minute, and changes per minute (``mcp_write_rate``)."""

    def __init__(self, clock=time.monotonic) -> None:
        self.clock = clock
        self.seen: dict[tuple[str, str], deque] = {}

    def take(self, grant_id: str, kind: str, per_minute: int) -> bool:
        now = self.clock()
        q = self.seen.setdefault((grant_id, kind), deque())
        while q and now - q[0] >= 60.0:
            q.popleft()
        if len(q) >= per_minute:
            return False
        q.append(now)
        return True

    def read(self, grant_id: str) -> bool:
        return self.take(grant_id, "request", READS_PER_MINUTE)
