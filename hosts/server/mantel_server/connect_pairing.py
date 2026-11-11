"""Mantel Connect, Mantel Server's side: guided pairing and the mutual-TLS listener (PLAN §7 Way 1).

Used when Mantel Server runs OUTSIDE Home Assistant (Docker, an LXC) and HA's sidebar and Companion app
should still reach it. The Mantel Connect App (hosts/server/mantel_connect) is a reverse proxy inside HA;
this module is what it talks to. mantel_connect/protocol.py explains the pairing exchange itself.

* **Off unless ``--connect``.** Then a second listener (``--connect-port``, default 8766, TLS) serves the
  same application. The ordinary listener (Caddy's, or loopback) never sees any of this.
* **Pairing.** An Owner starts it (``mantel connect pair`` or /admin -> Connect) and gets a one-time code,
  valid ten minutes, spent by one successful exchange, burned by five wrong proofs, replaced by starting
  another. Only a hash-like key derived from the code is stored (and deleted when the code is spent or
  expires). The listener answers ``/connect/v1/pair`` without a client certificate (that is the point) and
  nothing else without one.
* **After pairing: mutual TLS.** Mantel signs a client certificate for the App's public key with its own
  Connect CA (kept in ``<data-dir>/connect/``, key mode 0600); the listener requires certificates from
  that CA AND looks the certificate's fingerprint up in ``connect_pairings`` on every request, so
  **revoking a pairing cuts it off at once** (its open connections are closed too). The App renews its
  certificate before it expires (``/connect/v1/renew``); the old one stays valid one day, so a lost
  answer cannot strand the App. Mantel renews its own listener certificate the same way.
* **Identity.** A request on this listener that passes the check above is a *paired Connect* request; for
  ingress.py it is as if the Supervisor's Ingress proxy sent it (``is_ingress``): the signed-in HA user in
  ``X-Remote-User-*`` is believed, the 'ha' door's rules (``--ha-door-rules``) apply, the first-Owner
  bootstrap and the people page work.
* **Mantel Link by address** (``LINK_PATHS``): ``/linked/pair`` and ``/linked/ws`` are answered here without a client
  certificate too, each with its own proof (a pairing code, a Service credential). Mantel Link pins this listener's
  CA (linked_pairing.py, protocol v3), so it reaches Mantel by its address with no name, DNS or proxy in between. The headers are believed from nothing else, ever; ingress.py is
  untouched in its rules (one added condition in ``is_ingress``).
* **Audit.** Starting, completing, failing (known code, wrong proof; burned), renewing and revoking are
  rows in the audit log (kind ``config``); no code, key or certificate is ever written to a log or row.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import secrets
import ssl
import sys
import time
from datetime import timedelta
from importlib.resources import files
from pathlib import Path
from typing import Callable

from aiohttp import web
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

from mantel_connect import pki, protocol

from . import audit
from .identity.guards import guard
from .identity.guards import ident as guarded

log = logging.getLogger("mantel.connect")

SHUTDOWN_TIMEOUT = 5        # seconds a stop waits for open sockets (Docker kills an App after about 10)

CLIENT_DAYS = 90
SERVER_DAYS = 90
CA_DAYS = 3650
RENEW_BEFORE_DAYS = 30
PREV_GRACE = 86400.0                  # the certificate an App replaced stays valid this long
MAX_WRONG = 5                         # wrong proofs against one code before it is burned
IP_FAILS, IP_WINDOW = 10, 600.0       # failed exchanges per peer address
ALL_FAILS, ALL_WINDOW = 30, 600.0     # failed exchanges from anywhere
SEEN_EVERY = 60.0
FORGET_REVOKED_AFTER = 30 * 86400      # a revoked pairing leaves the list after this; the audit log keeps it
# (found through the package, not beside this file: phase 25 moves the server's modules into packages)
MIGRATION = Path(str(files("mantel_server").joinpath("migrations", "0009_connect_pairing.sql")))
_ID = re.compile(r"^[0-9a-f]{16}$")


def ensure_schema(conn) -> None:
    conn.executescript(MIGRATION.read_text())


class PairingError(Exception):
    """Pairing refused. ``status`` is the HTTP answer; ``why`` is for the audit only, never the client."""

    def __init__(self, status: int, why: str, retry_after: float | None = None):
        super().__init__(why)
        self.status, self.why, self.retry_after = status, why, retry_after


# -- the certificate authority ----------------------------------------------------------------------------
class Pki:
    """Mantel's private Connect CA, the listener certificate and the client certificates it signs.
    Certificate validity uses real time (``cert_clock``): TLS checks real time, whatever the app's clock."""

    def __init__(self, folder: Path, cert_clock=time.time, client_days: float = CLIENT_DAYS,
                 server_days: float = SERVER_DAYS, renew_before_days: float = RENEW_BEFORE_DAYS) -> None:
        self.dir = Path(folder)
        self.cert_clock = cert_clock
        self.client_days, self.server_days, self.renew_before = client_days, server_days, renew_before_days
        self.ca_key = self.ca_cert = None

    @property
    def ca_file(self) -> Path:
        return self.dir / "ca.crt"

    @property
    def server_cert_file(self) -> Path:
        return self.dir / "server.crt"

    @property
    def server_key_file(self) -> Path:
        return self.dir / "server.key"

    def exists(self) -> bool:
        return self.ca_file.is_file() and (self.dir / "ca.key").is_file()

    def ensure(self) -> bool:
        """Create the CA on first use; (re)issue the listener certificate when missing or due. True if it
        changed the listener certificate (a running listener must reload it)."""
        self.dir.mkdir(parents=True, exist_ok=True)
        self.dir.chmod(0o700)
        if not self.exists():
            self._make_ca()
        self._load_ca()
        cert = self._server_cert()
        due = cert is None or self._due(cert, self.server_days)
        if due:
            self._make_server()
        return due

    def _due(self, cert: x509.Certificate, lifetime_days: float) -> bool:
        left = pki.not_after(cert) - self.cert_clock()
        return left < min(self.renew_before, lifetime_days / 2) * 86400

    def _load_ca(self) -> None:
        self.ca_cert = pki.load_cert((self.dir / "ca.crt").read_bytes())
        self.ca_key = serialization.load_pem_private_key((self.dir / "ca.key").read_bytes(), None)

    def _server_cert(self):
        try:
            cert = pki.load_cert(self.server_cert_file.read_bytes())
            serialization.load_pem_private_key(self.server_key_file.read_bytes(), None)
            cert.verify_directly_issued_by(self.ca_cert)
            return cert
        except (OSError, ValueError, TypeError, Exception):          # noqa: BLE001 -- missing/damaged: reissue
            return None

    def _builder(self, subject: str, public, days: float, ca: bool = False):
        now = self.cert_clock()
        builder = (x509.CertificateBuilder()
                   .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, subject)]))
                   .public_key(public)
                   .serial_number(x509.random_serial_number())
                   .not_valid_before(pki.utc(now - 300))
                   .not_valid_after(pki.utc(now + days * 86400))
                   .add_extension(x509.SubjectKeyIdentifier.from_public_key(public), False))
        return builder

    def _make_ca(self) -> None:
        key = pki.new_key()
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Mantel Connect CA")])
        now = self.cert_clock()
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
                .serial_number(x509.random_serial_number())
                .not_valid_before(pki.utc(now - 300)).not_valid_after(pki.utc(now + CA_DAYS * 86400))
                .add_extension(x509.BasicConstraints(ca=True, path_length=0), True)
                .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), True)
                .add_extension(x509.SubjectKeyIdentifier.from_public_key(key.public_key()), False)
                .sign(key, hashes.SHA256()))
        pki.write_private(self.dir / "ca.key", pki.private_pem(key))
        pki.write_private(self.dir / "ca.crt", pki.cert_pem(cert))
        log.info("Connect: created Mantel's Connect certificate authority")

    def _sign(self, builder, usage: x509.ExtendedKeyUsage, public) -> x509.Certificate:
        return (builder.issuer_name(self.ca_cert.subject)
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), True)
                .add_extension(x509.KeyUsage(True, False, False, False, False, False, False, False, False), True)
                .add_extension(usage, False)
                .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(self.ca_key.public_key()), False)
                .sign(self.ca_key, hashes.SHA256()))

    def _make_server(self) -> None:
        key = pki.new_key()
        builder = self._builder("Mantel Connect", key.public_key(), self.server_days)
        builder = builder.add_extension(x509.SubjectAlternativeName([x509.DNSName("mantel-connect")]), False)
        cert = self._sign(builder, x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), key.public_key())
        pki.write_private(self.server_key_file, pki.private_pem(key))
        pki.write_private(self.server_cert_file, pki.cert_pem(cert))
        log.info("Connect: issued the listener certificate (valid until %s)", cert.not_valid_after_utc.date())

    def issue_client(self, public_pem: str, pairing_id: str) -> x509.Certificate:
        public = pki.load_public(public_pem)
        builder = self._builder(f"mantel-connect-{pairing_id}", public, self.client_days)
        return self._sign(builder, x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CLIENT_AUTH]), public)

    @property
    def ca_pem(self) -> str:
        return pki.cert_pem(self.ca_cert)

    @property
    def server_fp(self) -> str:
        return pki.cert_fp(self.server_cert_file.read_bytes())

    @property
    def ca_fp(self) -> str:
        return pki.cert_fp(self.ca_cert)

    def ssl_context(self) -> ssl.SSLContext:
        """The listener's TLS: certificates from the Connect CA are verified when offered, and a client
        that offers none can reach only the pairing route (the middleware decides which)."""
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.load_cert_chain(str(self.server_cert_file), str(self.server_key_file))
        ctx.load_verify_locations(cadata=self.ca_pem)
        ctx.verify_mode = ssl.CERT_OPTIONAL
        return ctx

    def reload(self, ctx: ssl.SSLContext) -> None:
        ctx.load_cert_chain(str(self.server_cert_file), str(self.server_key_file))


# -- rate limits ------------------------------------------------------------------------------------------
class Window:
    def __init__(self, limit: int, span: float) -> None:
        self.limit, self.span = limit, span
        self.hits: dict[str, list[float]] = {}

    def _live(self, key: str, now: float) -> list[float]:
        hits = [t for t in self.hits.get(key, ()) if now - t < self.span]
        if hits:
            self.hits[key] = hits
        else:
            self.hits.pop(key, None)
        return hits

    def blocked(self, key: str, now: float) -> float | None:
        hits = self._live(key, now)
        return (hits[0] + self.span - now) if len(hits) >= self.limit else None

    def add(self, key: str, now: float) -> None:
        if len(self.hits) > 4096:                      # a flood of distinct sources cannot grow it forever
            for k in list(self.hits):
                self._live(k, now)
        self.hits.setdefault(key, []).append(now)


# -- the manager ------------------------------------------------------------------------------------------
class Connect:
    def __init__(self, db, folder: Path, clock=time.time, audit=None, pki_: Pki | None = None) -> None:
        self.db = db
        self.db.execute("PRAGMA secure_delete = ON")     # a spent code's key is overwritten, not left in a free page
        self.clock = clock
        self.audit = audit                              # callable(event dict) or None
        self.pki = pki_ or Pki(folder)
        self.ip_fails = Window(IP_FAILS, IP_WINDOW)
        self.all_fails = Window(ALL_FAILS, ALL_WINDOW)
        self.renew_at: dict[str, float] = {}
        self.noted: dict[str, float] = {}
        self.conns: dict[str, set] = {}
        self.ssl_ctx: ssl.SSLContext | None = None

    # -- audit (never a secret) -------------------------------------------------------------------------
    def _audit(self, actor, role, action: str, detail: dict) -> None:
        """The exchange's own rows (a pairing made, refused, renewed) and the CLI's. An Owner's change through the
        REST is audited first instead (each method's ``before``: audit.config, no row, no change)."""
        log.info("%s %s", action, {k: v for k, v in detail.items() if k != "ip"})
        if self.audit is not None:
            try:
                self.audit({"timestamp": self.clock(), "actor": actor, "role": role, "action": action,
                            "detail": detail})
            except Exception:  # noqa: BLE001 -- pairing itself must not fail because the log did
                log.exception("could not write the audit row for %s", action)

    def _note(self, key: str, every: float = 600.0) -> bool:
        """True at most once per ``every`` seconds per key (so a flood cannot fill the audit log)."""
        now = self.clock()
        if now - self.noted.get(key, -every) >= every:
            self.noted[key] = now
            return True
        return False

    # -- starting a pairing (Owner) ---------------------------------------------------------------------
    def start(self, by: str | None, role: str | None = "owner", ttl: float = protocol.CODE_TTL,
              before: Callable[[dict], None] | None = None) -> dict:
        """A new one-time code. Any earlier unspent code is withdrawn (one pairing at a time). ``before(detail)``:
        the caller's audit row, first."""
        now = self.clock()
        code = protocol.new_code()
        raw = protocol.normalize_code(code)
        if before is not None:
            before({"expires": now + ttl})
        with self.db:
            self.db.execute("DELETE FROM connect_codes")
            self.db.execute("INSERT INTO connect_codes (id, mac_key, created, expires, created_by) VALUES (?,?,?,?,?)",
                            (protocol.code_id(raw), protocol.code_key(raw).hex(), now, now + ttl, by))
        if before is None:
            self._audit(by, role, "connect.pair_start", {"expires": now + ttl})
        return {"code": code, "expires": now + ttl, "ttl": ttl}

    def cancel(self, by: str | None, role: str | None = "owner", before: Callable[[dict], None] | None = None) -> bool:
        if before is not None and self.db.execute("SELECT 1 FROM connect_codes LIMIT 1").fetchone() is not None:
            before({})
        with self.db:
            cur = self.db.execute("DELETE FROM connect_codes")
        if cur.rowcount and before is None:
            self._audit(by, role, "connect.pair_cancel", {})
        return bool(cur.rowcount)

    def pending(self) -> dict | None:
        now = self.clock()
        # in its own transaction: a bare DELETE left one open on the shared connection, and every other writer
        # (a `mantel …` command beside the server) got "database is locked" until something else committed
        with self.db:
            self.db.execute("DELETE FROM connect_codes WHERE expires < ?", (now,))
        row = self.db.execute("SELECT created, expires, created_by, attempts FROM connect_codes "
                              "ORDER BY created DESC LIMIT 1").fetchone()
        return dict(row) if row is not None else None

    def purge(self) -> None:
        with self.db:
            self.db.execute("DELETE FROM connect_codes WHERE expires < ?", (self.clock(),))
        self._scrub()

    def _scrub(self) -> None:
        """Best effort: let the write-ahead log forget the frames that held a spent code's key."""
        try:
            self.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        except Exception:  # noqa: BLE001 -- busy readers; the next one will do
            pass

    # -- the exchange (no client certificate) -----------------------------------------------------------
    def pair(self, body: dict, ip: str) -> dict:
        """Run the exchange for a parsed request body. Returns the answer or raises PairingError."""
        now = self.clock()
        wait = self.ip_fails.blocked(ip, now) or self.all_fails.blocked("*", now)
        if wait:
            if self._note("rate"):
                self._audit(None, None, "connect.pair_rate_limited", {"ip": ip})
            raise PairingError(429, "rate_limited", wait)
        try:
            pair_id, nonce, name = body.get("pair_id"), body.get("nonce"), body.get("name")
            public_pem, proof = body.get("public_key"), body.get("proof")
            if (body.get("v") != protocol.VERSION or not isinstance(pair_id, str) or len(pair_id) != protocol.GROUP_LEN
                    or not isinstance(nonce, str) or not protocol.NONCE_RE.match(nonce)
                    or not isinstance(name, str) or not protocol.NAME_RE.match(name)
                    or not isinstance(proof, str) or not protocol.HEX64.match(proof)):
                raise PairingError(400, "malformed")
            try:
                public_sha = pki.public_sha(public_pem)
            except ValueError:
                raise PairingError(400, "malformed") from None
            row = self.db.execute("SELECT * FROM connect_codes WHERE id = ?", (pair_id,)).fetchone()
            if row is not None and row["expires"] < now:
                with self.db:
                    self.db.execute("DELETE FROM connect_codes WHERE id = ?", (pair_id,))
                row = None
            key = bytes.fromhex(row["mac_key"]) if row is not None else b"\0" * 32     # same work either way
            expected = protocol.client_proof(key, pair_id, nonce, public_sha, self.pki.server_fp, name)
            if row is None or not protocol.equal(expected, proof):
                self._fail(row, ip)
                raise PairingError(403, "wrong_proof" if row is not None else "unknown_or_expired")
            pairing_id = secrets.token_hex(8)
            client = self.pki.issue_client(public_pem, pairing_id)
            client_fp = pki.cert_fp(client)
            with self.db:                                     # single use: whoever deletes the code wins
                spent = self.db.execute("DELETE FROM connect_codes WHERE id = ?", (pair_id,)).rowcount
                if not spent:
                    raise PairingError(403, "already_used")
                self.db.execute(
                    "INSERT INTO connect_pairings (id, name, created, created_by, cert_fp, cert_expires, last_ip) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (pairing_id, name, now, row["created_by"], client_fp, pki.not_after(client), ip))
            self._scrub()
            self._audit(row["created_by"], "owner", "connect.pair_ok",
                        {"pairing": pairing_id, "name": name, "ip": ip, "cert": client_fp[:12]})
            return {
                "v": protocol.VERSION, "pairing_id": pairing_id, "ca_cert": self.pki.ca_pem,
                "client_cert": pki.cert_pem(client), "expires": pki.not_after(client),
                "proof": protocol.server_proof(key, pair_id, nonce, self.pki.server_fp, self.pki.ca_fp,
                                               client_fp, pairing_id)}
        except PairingError as exc:
            if exc.status == 400:
                self._count(ip)
            raise

    def _count(self, ip: str) -> None:
        now = self.clock()
        self.ip_fails.add(ip, now)
        self.all_fails.add("*", now)

    def _fail(self, row, ip: str) -> None:
        self._count(ip)
        if row is None:
            return
        attempts = row["attempts"] + 1
        burned = attempts >= MAX_WRONG
        with self.db:
            if burned:
                self.db.execute("DELETE FROM connect_codes WHERE id = ?", (row["id"],))
            else:
                self.db.execute("UPDATE connect_codes SET attempts = ? WHERE id = ?", (attempts, row["id"]))
        self._audit(row["created_by"], "owner", "connect.pair_failed",
                    {"ip": ip, "wrong_proofs": attempts, "burned": burned})

    # -- paired Apps ------------------------------------------------------------------------------------
    def authenticate(self, der: bytes | None, ip: str | None = None) -> dict | None:
        """The live pairing whose certificate this is, else None (unknown, revoked, replaced and past
        its one-day grace). Looked up on EVERY request: that is what makes revocation immediate."""
        if not der:
            return None
        fp = protocol.fingerprint(der)
        now = self.clock()
        row = self.db.execute(
            "SELECT * FROM connect_pairings WHERE revoked IS NULL AND "
            "(cert_fp = ? OR (prev_fp = ? AND prev_until > ?))", (fp, fp, now)).fetchone()
        if row is None:
            return None
        if row["last_seen"] is None or now - row["last_seen"] >= SEEN_EVERY:
            with self.db:
                self.db.execute("UPDATE connect_pairings SET last_seen = ?, last_ip = ? WHERE id = ?",
                                (now, ip, row["id"]))
        return dict(row)

    def revoked_cert(self, der: bytes | None) -> dict | None:
        if not der:
            return None
        fp = protocol.fingerprint(der)
        row = self.db.execute("SELECT id, name FROM connect_pairings WHERE revoked IS NOT NULL AND "
                              "(cert_fp = ? OR prev_fp = ?)", (fp, fp)).fetchone()
        return dict(row) if row is not None else None

    def renew(self, row: dict, public_pem: str, ip: str | None) -> dict:
        now = self.clock()
        if now - self.renew_at.get(row["id"], -3600) < 60:
            raise PairingError(429, "renew_too_soon", 60)
        self.renew_at[row["id"]] = now
        try:
            client = self.pki.issue_client(public_pem, row["id"])
        except ValueError:
            raise PairingError(400, "malformed") from None
        new_fp = pki.cert_fp(client)
        with self.db:
            self.db.execute("UPDATE connect_pairings SET prev_fp = cert_fp, prev_until = ?, cert_fp = ?, "
                            "cert_expires = ? WHERE id = ? AND revoked IS NULL",
                            (now + PREV_GRACE, new_fp, pki.not_after(client), row["id"]))
        self._audit(None, None, "connect.renew", {"pairing": row["id"], "name": row["name"], "ip": ip,
                                                  "cert": new_fp[:12]})
        return {"client_cert": pki.cert_pem(client), "ca_cert": self.pki.ca_pem, "expires": pki.not_after(client)}

    def list(self) -> list[dict]:
        out = []
        for r in self.db.execute("SELECT id, name, created, created_by, cert_expires, last_seen, last_ip, revoked, "
                                 "revoked_by, revoked_reason FROM connect_pairings ORDER BY created"):
            out.append(dict(r))
        return out

    def forget_revoked(self, by: str | None = None, role: str | None = None, older_than: float | None = None,
                       before: Callable[[dict], None] | None = None) -> int:
        """Remove revoked pairings from the list (all, or those revoked ``older_than`` seconds ago or more). A
        certificate is accepted only while its pairing is live, so one whose row is gone is refused like any
        unknown one (only the "revoked" wording is lost). Audited when an Owner asks."""
        cut = self.clock() - older_than if older_than is not None else None
        ids = [r[0] for r in self.db.execute(
            "SELECT id FROM connect_pairings WHERE revoked IS NOT NULL" + (" AND revoked <= ?" if cut is not None else ""),
            (cut,) if cut is not None else ())]
        if not ids:
            return 0
        if before is not None:
            before({"pairings": ids})
        elif by is not None:
            self._audit(by, role, "connect.forget_revoked", {"pairings": ids})
        with self.db:
            self.db.executemany("DELETE FROM connect_pairings WHERE id = ?", [(i,) for i in ids])
        return len(ids)

    def revoke(self, pairing_id: str, by: str | None, role: str | None = "owner", reason: str = "revoked",
               before: Callable[[dict], None] | None = None) -> bool:
        """Revoke a live pairing: its connections end at once. ``before(detail)``: the caller's audit row, written
        before anything changes (else the row is written here, after)."""
        if not isinstance(pairing_id, str) or not _ID.match(pairing_id):
            return False
        if before is not None:
            if self.db.execute("SELECT 1 FROM connect_pairings WHERE id = ? AND revoked IS NULL",
                               (pairing_id,)).fetchone() is None:
                return False
            before({"pairing": pairing_id, "reason": reason[:200]})
        now = self.clock()
        with self.db:
            cur = self.db.execute("UPDATE connect_pairings SET revoked = ?, revoked_by = ?, revoked_reason = ?, "
                                  "prev_fp = NULL, prev_until = NULL WHERE id = ? AND revoked IS NULL",
                                  (now, by, reason[:200], pairing_id))
        if not cur.rowcount:
            return False
        for transport in self.conns.pop(pairing_id, set()):
            try:
                transport.abort()
            except Exception:  # noqa: BLE001
                pass
        if before is None:
            self._audit(by, role, "connect.revoke", {"pairing": pairing_id, "reason": reason[:200]})
        return True

    def track(self, pairing_id: str, transport) -> None:
        group = self.conns.setdefault(pairing_id, set())
        group.difference_update([t for t in group if t.is_closing()])
        group.add(transport)

    # -- maintenance --------------------------------------------------------------------------------------
    def maintain(self) -> bool:
        """Expired codes go; the listener certificate is renewed when due (and reloaded in place)."""
        self.purge()
        changed = self.pki.ensure()
        if changed and self.ssl_ctx is not None:
            self.pki.reload(self.ssl_ctx)
        return changed


# -- the listener -----------------------------------------------------------------------------------------
LINK_PATHS = ("/linked/pair", "/linked/ws")     # Mantel Link's, answered here without a client certificate


def is_connect_request(request: web.Request) -> bool:
    mgr: Connect | None = request.app.get("connect")
    if mgr is None or mgr.ssl_ctx is None or request.transport is None:
        return False
    return request.transport.get_extra_info("sslcontext") is mgr.ssl_ctx


def peer_der(request: web.Request) -> bytes | None:
    sslobj = request.transport.get_extra_info("ssl_object") if request.transport is not None else None
    return sslobj.getpeercert(binary_form=True) if sslobj is not None else None


def _json(data: dict, status: int = 200, headers: dict | None = None) -> web.Response:
    return web.json_response(data, status=status, headers={"Cache-Control": "no-store", **(headers or {})})


async def _body(request: web.Request) -> dict:
    if request.content_length is None or request.content_length > protocol.MAX_BODY:
        raise PairingError(400, "malformed")
    try:
        data = json.loads(await request.read())
    except ValueError:
        raise PairingError(400, "malformed") from None
    if not isinstance(data, dict):
        raise PairingError(400, "malformed")
    return data


async def pair_route(request: web.Request) -> web.Response:
    mgr: Connect = request.app["connect"]
    if request.method != "POST":
        return _json({"error": "method_not_allowed"}, 405)
    try:
        return _json(mgr.pair(await _body(request), request.remote or "?"))
    except PairingError as exc:
        headers = {"Retry-After": str(int(exc.retry_after) + 1)} if exc.retry_after else {}
        # one answer for every refusal that is about the code: nothing says which part was wrong
        if exc.status == 403:
            return _json({"error": "pairing_failed"}, 403, headers)
        return _json({"error": {400: "bad_request", 429: "too_many_attempts"}.get(exc.status, "error")},
                     exc.status, headers)


async def renew_route(request: web.Request) -> web.Response:
    mgr: Connect = request.app["connect"]
    if request.method != "POST":
        return _json({"error": "method_not_allowed"}, 405)
    try:
        body = await _body(request)
        return _json(mgr.renew(request["connect_peer"], body.get("public_key"), request.remote))
    except PairingError as exc:
        return _json({"error": "bad_request" if exc.status == 400 else "too_soon"}, exc.status)


async def ping_route(request: web.Request) -> web.Response:
    row = request["connect_peer"]
    return _json({"ok": True, "pairing": row["id"], "name": row["name"], "cert_expires": row["cert_expires"],
                  "now": request.app["clock"]()})


@web.middleware
async def middleware(request: web.Request, handler):
    """First in the chain. Only requests that arrived on the Connect listener are touched."""
    if not is_connect_request(request):
        return await handler(request)
    mgr: Connect = request.app["connect"]
    path = request.path
    if path == protocol.PAIR_PATH:
        return await pair_route(request)
    der = peer_der(request)
    if path in LINK_PATHS and not der:
        # Mantel Link straight to this listener, pinning Mantel's CA (linked_pairing v3): no client certificate, its
        # own proof instead (the pairing code, then the Service credential); authz.resolve_door decides its door
        request["link_direct"] = True
        return await handler(request)
    row = mgr.authenticate(der, request.remote)
    if row is None:
        gone = mgr.revoked_cert(der)
        if gone is not None and mgr._note("refused:" + gone["id"]):
            mgr._audit(None, None, "connect.refused_revoked", {"pairing": gone["id"], "ip": request.remote})
        return _json({"error": "pairing_revoked" if gone is not None else "client_certificate_required"}, 401)
    request["connect_peer"] = row
    if request.transport is not None:
        mgr.track(row["id"], request.transport)
    if path == protocol.PING_PATH:
        return await ping_route(request)
    if path == protocol.RENEW_PATH:
        return await renew_route(request)
    if path.startswith("/connect/v1/"):
        raise web.HTTPNotFound()
    return await handler(request)


# -- Owner REST: the same rule as service accounts (an Owner's own session on the LAN door, or HA's sidebar with the
# home rules, authz.home_door). It was the LAN door alone; the code gave no reason to refuse the trusted sidebar that
# Service credentials, linked mode's ownership and wall tablets all accept, and the section said "the same rule".
@guard("owner", door="home", reads="admin")
async def api_list(request: web.Request) -> web.Response:
    mgr: Connect = request.app["connect"]
    cfg = request.app["cfg"]
    mgr.forget_revoked(older_than=FORGET_REVOKED_AFTER)
    return _json({"pairings": mgr.list(), "pending": mgr.pending(), "port": cfg.connect_port,
                  "address": cfg.connect_address, "ttl": protocol.CODE_TTL})


@guard("owner", door="home", audit="connect.pair_start")
async def api_start(request: web.Request) -> web.Response:
    ident = guarded(request)
    return _json(request.app["connect"].start(ident.user.id, ident.user.role, before=lambda d: audit.config(
        request, ident, "connect.pair_start", d)), 201)


@guard("owner", door="home", audit="connect.pair_cancel")
async def api_cancel(request: web.Request) -> web.Response:
    ident = guarded(request)
    return _json({"ok": request.app["connect"].cancel(ident.user.id, ident.user.role, before=lambda d: audit.config(
        request, ident, "connect.pair_cancel", d))})


@guard("owner", door="home", audit="connect.revoke")
async def api_revoke(request: web.Request) -> web.Response:
    ident = guarded(request)
    if not request.app["connect"].revoke(request.match_info["id"], ident.user.id, ident.user.role,
                                         "revoked by an Owner",
                                         before=lambda d: audit.config(request, ident, "connect.revoke", d)):
        raise web.HTTPNotFound(text="no such live pairing")
    return _json({"ok": True})


@guard("owner", door="home", audit="connect.forget_revoked")
async def api_forget_revoked(request: web.Request) -> web.Response:
    ident = guarded(request)
    return _json({"ok": True, "removed": request.app["connect"].forget_revoked(
        ident.user.id, ident.user.role, before=lambda d: audit.config(request, ident, "connect.forget_revoked", d))})


def register(app: web.Application, hub=None) -> Connect | None:
    """``app["connect"]`` and the Owner REST, when ``cfg.connect``; otherwise nothing at all."""
    cfg = app["cfg"]
    if not cfg.connect:
        return None
    audit_hook = lambda event: app["audit"].config_event(event)         # noqa: E731 -- audit is wired later
    mgr = Connect(app["store"].db, cfg.connect_dir, lambda: app["clock"](), audit_hook,
                  Pki(cfg.connect_dir))
    mgr.pki.ensure()
    mgr.ssl_ctx = mgr.pki.ssl_context()
    app["connect"] = mgr
    app.router.add_get("/api/connect", api_list)
    app.router.add_post("/api/connect/pair", api_start)
    app.router.add_delete("/api/connect/pair", api_cancel)
    app.router.add_delete("/api/connect/pairings/revoked", api_forget_revoked)     # before /{id}
    app.router.add_delete("/api/connect/pairings/{id}", api_revoke)

    async def maintenance() -> None:
        while True:
            await asyncio.sleep(3600)
            try:
                if mgr.maintain():
                    log.info("Connect: the listener certificate was renewed")
            except Exception:  # noqa: BLE001 -- try again next hour
                log.exception("Connect maintenance failed")

    async def start(app: web.Application) -> None:
        app["connect_task"] = asyncio.create_task(maintenance())

    async def stop(app: web.Application) -> None:
        app["connect_task"].cancel()

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    log.info("Connect: pairing is on; the mutual-TLS listener is port %s", cfg.connect_port)
    return mgr


async def serve(app: web.Application, cfg, stop: asyncio.Event | None = None) -> None:
    """Run the ordinary listener and the Connect listener on one application until stopped."""
    runner = web.AppRunner(app, shutdown_timeout=SHUTDOWN_TIMEOUT)
    await runner.setup()
    try:
        await web.TCPSite(runner, cfg.host, cfg.port).start()
        await web.TCPSite(runner, cfg.connect_listen, cfg.connect_port, ssl_context=app["connect"].ssl_ctx).start()
        stop = stop or asyncio.Event()
        loop = asyncio.get_running_loop()
        import signal
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, stop.set)
            except NotImplementedError:
                pass
        await stop.wait()
    finally:
        await runner.cleanup()


# -- CLI: mantel connect pair | list | revoke | cancel | status ---------------------------------------------
def cli(argv: list[str]) -> int:
    from .config import Config
    from .db import Database
    from .ha.gateway import Audit
    p = argparse.ArgumentParser(prog="mantel connect", description="Pair Mantel Connect (HA's sidebar) with this server")
    p.add_argument("action", choices=("pair", "list", "revoke", "cancel", "status"))
    p.add_argument("--id", help="revoke: the pairing id (see `list`)")
    p.add_argument("--address", default="", help="pair: the address the Connect App should use (host or host:port)")
    p.add_argument("--data-dir", default=str(Config.data_dir))
    a = p.parse_args(argv)
    data = Path(a.data_dir).expanduser()
    database = Database(data / "mantel.db")
    try:
        audit = Audit(database.conn, time.time)
        mgr = Connect(database.conn, data / "connect", time.time, audit.config_event)
        if a.action == "pair":
            owner = database.conn.execute("SELECT id FROM users WHERE role='owner' AND disabled=0 "
                                          "ORDER BY created LIMIT 1").fetchone()
            got = mgr.start(owner["id"] if owner else None, "owner" if owner else None)
            minutes = int(got["ttl"] // 60)
            port = protocol.DEFAULT_PORT
            where = a.address or f"<this server's address>:{port}"
            print(f"Pairing code (once, valid {minutes} minutes):\n\n    {got['code']}\n")
            print("In Home Assistant: Settings, Apps, Mantel Connect, Configuration. Enter")
            print(f"    Mantel address:  {where}")
            print("    Pairing code:    the code above")
            print("then Save and Restart the App. A new code replaces this one; `mantel connect cancel` withdraws it.")
            if not (data / "connect" / "ca.crt").is_file():
                print("\nNote: the server creates its Connect certificates when it starts with --connect "
                      "(MANTEL_CONNECT=1); start it before using the code.", file=sys.stderr)
        elif a.action == "cancel":
            print("withdrawn" if mgr.cancel(None) else "no pending code")
        elif a.action == "list":
            for r in mgr.list():
                state = f"revoked ({r['revoked_reason']})" if r["revoked"] else "live"
                seen = time.strftime("%Y-%m-%d %H:%M", time.localtime(r["last_seen"])) if r["last_seen"] else "never"
                print(f"{r['id']}  {r['name']:<28} {state:<22} last seen {seen}")
            pending = mgr.pending()
            if pending:
                print(f"A pairing code is pending (expires in {int(pending['expires'] - time.time())} s).")
        elif a.action == "status":
            live = [r for r in mgr.list() if not r["revoked"]]
            print(f"{len(live)} paired App(s); pending code: {'yes' if mgr.pending() else 'no'}; "
                  f"certificate authority: {'present' if (data / 'connect' / 'ca.crt').is_file() else 'not yet created'}")
        else:
            if not a.id:
                p.error("revoke needs --id")
            print("revoked" if mgr.revoke(a.id, None, None, "revoked by the command line") else "no such live pairing")
    finally:
        database.close()
    return 0
