"""Service accounts (PLAN §5 "Service": machine accounts, scoped to the endpoints they need).

A service account is not a person. It has no password, no session and no role grants: only a
bearer credential and the list of endpoints (``scopes``) it may open. The first one is Home
Assistant's ``hk_frontend`` integration in linked mode (scope ``linked``, ``linked.py``).

* **Credential**: ``msvc_<16 hex id>_<43 base64url chars>`` (256 random bits). Shown once, when it is
  made; only its SHA-256 is stored (migration ``0005_service_accounts.sql``), so a copy of the
  database cannot be replayed. Comparison is constant-time.
* **Scopes**: endpoint names from ``SCOPES``. An endpoint asks ``verify(token, scope)``; a credential
  without that scope is refused exactly like an unknown one.
* **Revocation**: ``revoke(id)``; it takes effect on the next ``verify`` (an open linked socket is
  also closed by ``linked.py`` when it notices, see there).
* **Doors**: the endpoints decide. ``linked.py`` refuses every service credential on the tunnel door.

Managed by an Owner only: ``mantel-server service-account create|list|revoke`` (the CLI prints the
credential once) or the REST below (Owner, LAN door). Nothing here is logged with a credential in it.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import logging
import re
import secrets
import sqlite3
import sys
import time
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("mantel.service_accounts")

SCOPES = frozenset({"linked"})        # endpoint names a service account can be given
PREFIX = "msvc_"
_TOKEN = re.compile(r"^msvc_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$")
_NAME = re.compile(r"^[\w .:@-]{1,64}$")
MIGRATION = Path(__file__).with_name("migrations") / "0005_service_accounts.sql"


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def ensure_schema(conn: sqlite3.Connection) -> None:
    """Apply this module's table to a bare connection (tests, tools). The server's db.py runner
    applies the same file as migration 0005; the file is idempotent."""
    conn.executescript(MIGRATION.read_text())


class ServiceAccountError(ValueError):
    pass


@dataclass(frozen=True)
class ServiceAccount:
    id: str
    name: str
    scopes: frozenset[str]


class ServiceAccounts:
    def __init__(self, conn: sqlite3.Connection, clock=time.time) -> None:
        self.db = conn
        self.clock = clock

    @staticmethod
    def _scopes(scopes) -> list[str]:
        got = sorted(set(scopes or ()))
        if not got:
            raise ServiceAccountError("a service account needs at least one scope")
        bad = [s for s in got if s not in SCOPES]
        if bad:
            raise ServiceAccountError(f"unknown scope(s) {bad}; scopes are {sorted(SCOPES)}")
        return got

    def create(self, name: str, scopes, *, by: str | None = None) -> tuple[ServiceAccount, str]:
        """A new account and its credential. The credential is returned once and never stored."""
        name = str(name or "").strip()
        if not _NAME.match(name):
            raise ServiceAccountError("name: 1-64 letters, digits, spaces or . : @ _ -")
        scopes = self._scopes(scopes)
        sid = secrets.token_hex(8)
        token = f"{PREFIX}{sid}_{secrets.token_urlsafe(32)}"
        with self.db:
            self.db.execute(
                "INSERT INTO service_accounts (id, name, scopes, secret_hash, created, created_by) "
                "VALUES (?, ?, ?, ?, ?, ?)", (sid, name, json.dumps(scopes), token_hash(token), self.clock(), by))
        log.info("service account %s (%s) created with scopes %s", sid, name, scopes)
        return ServiceAccount(sid, name, frozenset(scopes)), token

    def verify(self, token: str | None, scope: str, *, source_ip: str | None = None) -> ServiceAccount | None:
        """The account behind ``token`` if it is live and has ``scope``; else None (one answer for
        every refusal: unknown, malformed, revoked, wrong scope)."""
        if not isinstance(token, str):
            return None
        m = _TOKEN.match(token)
        if not m:
            return None
        row = self.db.execute("SELECT * FROM service_accounts WHERE id=?", (m.group(1),)).fetchone()
        expected = row["secret_hash"] if row is not None else token_hash(PREFIX + "0" * 60)
        if not hmac.compare_digest(expected, token_hash(token)) or row is None or row["revoked"] is not None:
            return None
        try:
            scopes = frozenset(json.loads(row["scopes"]))
        except (TypeError, ValueError):
            return None                     # an unreadable row never widens access
        if scope not in scopes:
            return None
        with self.db:
            self.db.execute("UPDATE service_accounts SET last_used=?, last_ip=? WHERE id=?",
                            (self.clock(), source_ip, row["id"]))
        return ServiceAccount(row["id"], row["name"], scopes)

    def live(self, account_id: str) -> bool:
        row = self.db.execute("SELECT revoked FROM service_accounts WHERE id=?", (account_id,)).fetchone()
        return row is not None and row["revoked"] is None

    def list(self) -> list[dict]:
        out = []
        for r in self.db.execute("SELECT id, name, scopes, created, created_by, last_used, last_ip, revoked, "
                                 "revoked_reason FROM service_accounts ORDER BY created"):
            d = dict(r)
            try:
                d["scopes"] = json.loads(d["scopes"])
            except (TypeError, ValueError):
                d["scopes"] = []
            out.append(d)
        return out

    def revoke(self, account_id: str, reason: str = "revoked") -> bool:
        with self.db:
            cur = self.db.execute("UPDATE service_accounts SET revoked=?, revoked_reason=? "
                                  "WHERE id=? AND revoked IS NULL", (self.clock(), reason, account_id))
        if cur.rowcount:
            log.info("service account %s revoked (%s)", account_id, reason)
        return bool(cur.rowcount)


# -- REST (Owner only, LAN door) ---------------------------------------------------------------------
def _owner(request):
    from aiohttp import web

    from . import sessions
    ident = sessions.identity(request)
    if ident.user is None or ident.device is not None:
        raise web.HTTPForbidden(text="an Owner's own session only")
    if ident.user.role != "owner":
        raise web.HTTPForbidden(text="Owner only")
    authz = request.app.get("authz")
    if not (ident.door == "lan" or (authz is not None and authz.home_door(ident))):
        # the LAN door, or HA's sidebar with the home rules (the HA App has no LAN door; HA-APP.md)
        raise web.HTTPForbidden(text="service credentials are managed on the LAN (or a trusted HA sidebar) only")
    return ident


async def api_list(request):
    from aiohttp import web
    _owner(request)
    return web.json_response({"accounts": request.app["service_accounts"].list()})


async def api_create(request):
    from aiohttp import web
    ident = _owner(request)
    try:
        body = await request.json()
    except ValueError:
        raise web.HTTPBadRequest(text="JSON body required")
    if not isinstance(body, dict):
        raise web.HTTPBadRequest(text="JSON object required")
    try:
        acct, token = request.app["service_accounts"].create(body.get("name"), body.get("scopes") or (),
                                                             by=ident.user.id)
    except ServiceAccountError as exc:
        return web.json_response({"error": {"code": "invalid", "message": str(exc)}}, status=400)
    return web.json_response({"account": {"id": acct.id, "name": acct.name, "scopes": sorted(acct.scopes)},
                              "token": token}, status=201, headers={"Cache-Control": "no-store"})


async def api_revoke(request):
    from aiohttp import web
    _owner(request)
    if not request.app["service_accounts"].revoke(request.match_info["id"]):
        raise web.HTTPNotFound(text="no such live service account")
    return web.json_response({"ok": True})


def register(app, hub=None) -> "ServiceAccounts":
    """``app["service_accounts"]`` over the app's database, and the Owner-only REST."""
    if "service_accounts" not in app:
        app["service_accounts"] = ServiceAccounts(app["store"].db, lambda: app["clock"]())
    app.router.add_get("/api/service-accounts", api_list)
    app.router.add_post("/api/service-accounts", api_create)
    app.router.add_delete("/api/service-accounts/{id}", api_revoke)
    return app["service_accounts"]


# -- CLI ---------------------------------------------------------------------------------------------
def cli(argv: list[str]) -> int:
    """``mantel-server service-account create --name N --scope linked | list | revoke --id ID``."""
    from .config import Config
    from .db import Database
    p = argparse.ArgumentParser(prog="mantel-server service-account")
    p.add_argument("action", choices=("create", "list", "revoke"))
    p.add_argument("--name")
    p.add_argument("--scope", action="append", choices=sorted(SCOPES))
    p.add_argument("--id")
    p.add_argument("--data-dir", default=str(Config.data_dir))
    a = p.parse_args(argv)
    database = Database(Path(a.data_dir).expanduser() / "mantel.db")
    accounts = ServiceAccounts(database.conn)
    try:
        if a.action == "create":
            if not a.name or not a.scope:
                p.error("create needs --name and at least one --scope")
            try:
                acct, token = accounts.create(a.name, a.scope)
            except ServiceAccountError as exc:
                print(f"mantel-server: {exc}", file=sys.stderr)
                return 2
            print(f"Service account {acct.id} ({acct.name}), scopes {sorted(acct.scopes)}.\n"
                  f"Its credential (shown once; paste it into the integration, then forget it):\n\n    {token}\n")
        elif a.action == "list":
            for r in accounts.list():
                state = f"revoked ({r['revoked_reason']})" if r["revoked"] else "live"
                print(f"{r['id']}  {r['name']:<24} {','.join(r['scopes']):<10} {state}")
        else:
            if not a.id:
                p.error("revoke needs --id")
            print("revoked" if accounts.revoke(a.id) else "no such live service account")
    finally:
        database.close()
    return 0
