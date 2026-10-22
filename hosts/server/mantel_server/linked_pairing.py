"""Pairing codes for Mantel Link (docs/phase9/MANTEL-LINK.md "Discovery and pairing", slice 9.4).

Home Assistant's Mantel Link needs a Service credential (scope ``linked``) to open the link. Instead of copying
one out of Service Accounts, an Owner makes a PAIRING CODE in Mantel Settings (Connections -> Home Assistant
Link) and types it into Mantel Link's setup in Home Assistant, by hand or after a zeroconf discovery. Mantel Link
trades the code once, over https, for a fresh credential.

* **The code** is Mantel Connect's (mantel_connect/protocol.py): 20 characters in four groups, about 98 bits;
  the first group is its public id. One at a time, ten minutes, spent by one exchange, burned by five wrong
  proofs, replaced by making another. **Held in memory only**: nothing about it is written anywhere, and a
  restart forgets it (make another).
* **The exchange** (``POST /linked/pair``, no session; the LAN door, never a browser): Mantel Link sends the
  code's id, a nonce, its name and a PROOF, an HMAC keyed from the code over those; Mantel answers with the
  credential, its instance id and its own proof over the nonce, the instance and the credential's hash. Mantel
  Link believes nothing before it checks that proof: a look-alike that answered a zeroconf announcement cannot
  produce it without the code, so it can never hand Home Assistant a credential of its own.
* **What it makes:** a Service account named by Mantel Link ("Home Assistant - Mantel Link"), scope ``linked``
  only. It is revoked like any other (Mantel Settings -> Service Accounts), which closes the link.
* **Rate limits** as Mantel Connect's: wrong or malformed attempts per address and from anywhere.
* **Audit** (kind ``config``): ``linked.pair_start``, ``linked.pair_cancel``, ``linked.pair_ok`` (the new account's
  id), ``linked.pair_failed``. Never the code, its key or the credential.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import re
import secrets
import time
from typing import Any

from aiohttp import web

from mantel_connect import protocol as CP

from .connect_pairing import ALL_FAILS, ALL_WINDOW, IP_FAILS, IP_WINDOW, MAX_WRONG, Window

log = logging.getLogger("mantel.linked_pairing")

VERSION = 1
PATH = "/linked/pair"
TTL = CP.CODE_TTL
_NONCE = re.compile(r"^[0-9a-f]{32}$")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_NAME = re.compile(r"^[A-Za-z0-9][\w .:@-]{0,63}$")         # a Service account's name (service_accounts._NAME)
DEFAULT_NAME = "Home Assistant - Mantel Link"


# -- the proofs (Mantel Link's pairing.py computes the same) -------------------------------------------
def code_key(raw: str) -> bytes:
    return hashlib.sha256(b"mantel-link-pair-v1|key|" + raw.encode()).digest()


def _mac(key: bytes, *parts: str) -> str:
    return hmac.new(key, "|".join(parts).encode(), hashlib.sha256).hexdigest()


def client_proof(key: bytes, code_id: str, nonce: str, name: str) -> str:
    return _mac(key, "mantel-link-pair-v1", "client", code_id, nonce, name)


def server_proof(key: bytes, code_id: str, nonce: str, instance: str, token: str) -> str:
    return _mac(key, "mantel-link-pair-v1", "server", code_id, nonce, instance,
                hashlib.sha256(token.encode()).hexdigest())


class PairError(Exception):
    def __init__(self, status: int, code: str, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.status, self.code, self.message, self.retry_after = status, code, message, retry_after


class LinkPairing:
    """The pending code (in memory) and the exchange."""

    def __init__(self, accounts: Any, clock=time.time, audit=None, instance=lambda: None) -> None:
        self.accounts, self.clock, self.audit, self.instance = accounts, clock, audit, instance
        self._code: dict[str, Any] | None = None      # {id, key, created, expires, by, attempts}
        self.ip_fails = Window(IP_FAILS, IP_WINDOW)
        self.all_fails = Window(ALL_FAILS, ALL_WINDOW)
        self.paired: list[dict[str, Any]] = []         # this run's pairings, for the page's "paired" notice

    def _audit(self, actor, role, action: str, detail: dict) -> None:
        if self.audit is None:
            return
        try:
            self.audit({"timestamp": self.clock(), "actor": actor, "role": role, "action": action, "detail": detail})
        except Exception:  # noqa: BLE001 -- pairing never fails because the log did
            log.exception("could not write the audit row for %s", action)

    # -- the Owner's side ------------------------------------------------------------------------------------
    def start(self, by: str | None, role: str | None = "owner") -> dict[str, Any]:
        code = CP.new_code()
        raw = CP.normalize_code(code)
        now = self.clock()
        self._code = {"id": CP.code_id(raw), "key": code_key(raw), "created": now, "expires": now + TTL,
                      "by": by, "attempts": 0}
        self._audit(by, role, "linked.pair_start", {"expires": now + TTL})
        return {"code": code, "expires": now + TTL, "ttl": TTL}

    def cancel(self, by: str | None, role: str | None = "owner") -> bool:
        had = self.pending() is not None
        self._code = None
        if had:
            self._audit(by, role, "linked.pair_cancel", {})
        return had

    def pending(self) -> dict[str, Any] | None:
        c = self._code
        if c is not None and c["expires"] < self.clock():
            self._code = c = None
        return None if c is None else {"created": c["created"], "expires": c["expires"], "attempts": c["attempts"]}

    # -- Mantel Link's side ------------------------------------------------------------------------------------
    def pair(self, body: Any, ip: str | None) -> dict[str, Any]:
        now = self.clock()
        peer = ip or "?"
        wait = self.ip_fails.blocked(peer, now) or self.all_fails.blocked("*", now)
        if wait:
            raise PairError(429, "rate_limited", "Too many tries. Wait a little and try again.", wait)
        if (not isinstance(body, dict) or body.get("v") != VERSION or not isinstance(body.get("code_id"), str)
                or len(body["code_id"]) != CP.GROUP_LEN or not isinstance(body.get("nonce"), str)
                or not _NONCE.match(body["nonce"]) or not isinstance(body.get("proof"), str)
                or not _HEX64.match(body["proof"]) or not isinstance(body.get("name"), str)
                or not _NAME.match(body["name"])):
            self._count(peer)
            raise PairError(400, "malformed", "Not a Mantel Link pairing request.")
        c = self.pending() and self._code
        key = c["key"] if c and c["id"] == body["code_id"] else b"\0" * 32        # the same work either way
        expected = client_proof(key, body["code_id"], body["nonce"], body["name"])
        if not c or c["id"] != body["code_id"] or not hmac.compare_digest(expected, body["proof"]):
            self._count(peer)
            if c and c["id"] == body["code_id"]:
                c["attempts"] += 1
                burned = c["attempts"] >= MAX_WRONG
                if burned:
                    self._code = None
                self._audit(c["by"], "owner", "linked.pair_failed", {"ip": ip, "wrong": c["attempts"], "burned": burned})
            raise PairError(403, "invalid_code", "That pairing code was not accepted. Make a new one in Mantel "
                            "Settings, Connections, Home Assistant, Mantel Link.")
        self._code = None                                     # spent, before anything else can use it
        account, token = self.accounts.create(body["name"], ["linked"], by=f"pairing:{c['by']}")
        instance = self.instance() or ""
        aid = getattr(account, "id", None) or (account.get("id") if isinstance(account, dict) else None)
        self.paired.append({"at": now, "account": aid, "name": body["name"]})
        self._audit(c["by"], "owner", "linked.pair_ok", {"ip": ip, "account": aid, "name": body["name"]})
        log.warning("linked: Mantel Link paired as %r from %s (Service account %s)", body["name"], peer, aid)
        return {"v": VERSION, "token": token, "instance": instance,
                "proof": server_proof(c["key"], body["code_id"], body["nonce"], instance, token)}

    def _count(self, peer: str) -> None:
        now = self.clock()
        self.ip_fails.add(peer, now)
        self.all_fails.add("*", now)


# -- the routes -------------------------------------------------------------------------------------------
async def pair_route(request: web.Request) -> web.Response:
    from .sessions import client_ip, door_of
    pairing: LinkPairing = request.app["linked_pairing"]
    if request.headers.get("Origin") is not None:
        raise web.HTTPForbidden(text="not for browsers")
    if door_of(request) != "lan":
        raise web.HTTPForbidden(text="lan_only")
    try:
        body = await request.json() if request.content_length and request.content_length <= 4096 else None
    except ValueError:
        body = None
    try:
        out = pairing.pair(body, client_ip(request))
    except PairError as exc:
        headers = {"Retry-After": str(int(exc.retry_after) + 1)} if exc.retry_after else None
        return web.json_response({"error": {"code": exc.code, "message": exc.message}}, status=exc.status,
                                 headers=headers)
    return web.json_response(out, headers={"Cache-Control": "no-store"})


def _owner(request: web.Request):
    from .linked_owners import _who
    return _who(request, owner_only=True)


async def api_get(request: web.Request) -> web.Response:
    from .linked_owners import _who
    _who(request, owner_only=False)
    p: LinkPairing = request.app["linked_pairing"]
    return web.json_response({"pending": p.pending(), "ttl": TTL, "paired": p.paired[-5:]})


async def api_start(request: web.Request) -> web.Response:
    ident = _owner(request)
    out = request.app["linked_pairing"].start(ident.user.id, ident.user.role)
    return web.json_response(out, headers={"Cache-Control": "no-store"})


async def api_cancel(request: web.Request) -> web.Response:
    ident = _owner(request)
    return web.json_response({"cancelled": request.app["linked_pairing"].cancel(ident.user.id, ident.user.role)})


def register(app: web.Application) -> LinkPairing:
    """``app["linked_pairing"]``, the exchange at ``/linked/pair`` (public to the session middleware: it checks
    the code itself) and the Owner's REST (``/api/linked/pair``)."""
    if "linked_pairing" in app:
        return app["linked_pairing"]
    audit = app.get("audit")

    def instance() -> str | None:
        lk = app.get("linked")
        return getattr(lk, "instance", None)

    p = LinkPairing(app["service_accounts"], lambda: app["clock"](),
                    audit.config_event if audit is not None else None, instance)
    app["linked_pairing"] = p
    app.setdefault("public_paths", set()).add(PATH)
    app.router.add_post(PATH, pair_route)
    app.router.add_get("/api/linked/pair", api_get)
    app.router.add_post("/api/linked/pair", api_start)
    app.router.add_delete("/api/linked/pair", api_cancel)
    return p
