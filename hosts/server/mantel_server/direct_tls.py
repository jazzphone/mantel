"""Built-in HTTPS for the HA App's direct access (decision 26; docs/phase3/HA-APP.md "Built-in HTTPS").

With the App option ``access: https`` Mantel serves HTTPS on its direct listener itself (direct.py), with a
certificate it obtains and renews from Let's Encrypt over ACME (RFC 8555), proving the name with the DNS-01
challenge through Cloudflare's API -- the same way the compose stack's Caddy does (packaging/compose/caddy/
tls-dns01.caddy), so no port has to be reachable from the internet and the name may stay LAN-only.

Why here and not a Caddy binary in the App (the choice is recorded in HA-APP.md): the App image is built on
the house's own HA machine by the Supervisor, and Caddy's Cloudflare module means compiling Caddy with
xcaddy there (a Go toolchain, minutes of CPU, a gigabyte of memory on a small HA box) or downloading an
unpinnable binary; and two processes in the App need a supervisor the App does not have (init + one exec'd
server). ACME with DNS-01 is a few HTTPS requests, and everything it needs (aiohttp, cryptography) is already
in the image, pinned and tested.

* **Keys and certificate** live in ``<data_dir>/tls`` (folder 0700, files 0600; inside HA's backups):
  ``account.key`` (the ACME account), ``cert.pem`` + ``cert.key`` (a fresh key at each issuance).
* **Until a certificate exists** (first start, or Let's Encrypt unreachable) the listener serves a short-lived
  self-signed one for the same name, so the port answers (with a browser warning) and the log says why.
* **Renewal** 30 days before expiry, checked twice a day; a failed attempt is retried after 1, 3, 12, then
  24 hours (Let's Encrypt limits failed validations). The live listener picks the new certificate up at once
  (``SSLContext.load_cert_chain`` on the same context: new handshakes use it).
* **The Cloudflare token** is read from its file (the App's masked option, moved there by the entrypoint)
  at each attempt, sent only to Cloudflare's API, and never logged, stored elsewhere or shown.
"""
from __future__ import annotations

import asyncio
import base64
import datetime as dt
import hashlib
import json
import logging
import os
import ssl
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

import aiohttp
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.x509.oid import NameOID

log = logging.getLogger("mantel.direct_tls")

LETSENCRYPT = "https://acme-v02.api.letsencrypt.org/directory"
LETSENCRYPT_STAGING = "https://acme-staging-v02.api.letsencrypt.org/directory"
CLOUDFLARE_API = "https://api.cloudflare.com/client/v4"
DOH = "https://cloudflare-dns.com/dns-query"
RENEW_BEFORE = 30 * 86400
CHECK_EVERY = 12 * 3600
RETRY_AFTER = (3600, 3 * 3600, 12 * 3600, 24 * 3600)
PLACEHOLDER_DAYS = 7
PLACEHOLDER_ISSUER = "Mantel placeholder (no certificate yet)"
TIMEOUT = aiohttp.ClientTimeout(total=30)
JOSE = "application/jose+json"


class AcmeError(Exception):
    """A step of issuance failed. The message never holds a secret (no token, no key, no header)."""


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _int32(n: int) -> bytes:
    return n.to_bytes(32, "big")


# -- the account key and its JWS (ES256) ------------------------------------------------------------------
class AccountKey:
    def __init__(self, key: ec.EllipticCurvePrivateKey) -> None:
        self.key = key

    @classmethod
    def generate(cls) -> "AccountKey":
        return cls(ec.generate_private_key(ec.SECP256R1()))

    def jwk(self) -> dict:
        n = self.key.public_key().public_numbers()
        return {"crv": "P-256", "kty": "EC", "x": b64u(_int32(n.x)), "y": b64u(_int32(n.y))}

    def thumbprint(self) -> str:
        """RFC 7638: SHA-256 of the JWK's required members, sorted, without whitespace."""
        return b64u(hashlib.sha256(json.dumps(self.jwk(), sort_keys=True, separators=(",", ":")).encode()).digest())

    def sign(self, protected: dict, payload: Any) -> dict:
        """A flattened JWS. ``payload`` None is POST-as-GET (an empty payload)."""
        p64 = b64u(json.dumps(protected, separators=(",", ":")).encode())
        b64 = "" if payload is None else b64u(json.dumps(payload, separators=(",", ":")).encode())
        r, s = decode_dss_signature(self.key.sign(f"{p64}.{b64}".encode(), ec.ECDSA(hashes.SHA256())))
        return {"protected": p64, "payload": b64, "signature": b64u(_int32(r) + _int32(s))}

    def pem(self) -> bytes:
        return self.key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                      serialization.NoEncryption())


def dns01_value(token: str, account: AccountKey) -> str:
    """The TXT value at _acme-challenge.<name>: base64url(SHA-256(token "." thumbprint))."""
    return b64u(hashlib.sha256(f"{token}.{account.thumbprint()}".encode()).digest())


# -- the ACME client (RFC 8555) -----------------------------------------------------------------------------
class AcmeClient:
    def __init__(self, http: aiohttp.ClientSession, directory_url: str, account: AccountKey, email: str = "",
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep, poll_every: float = 2.0) -> None:
        self.http = http
        self.directory_url = directory_url
        self.account = account
        self.email = email
        self.sleep = sleep
        self.poll_every = poll_every
        self.dir: dict | None = None
        self.kid: str | None = None
        self._nonce: str | None = None

    async def directory(self) -> dict:
        if self.dir is None:
            async with self.http.get(self.directory_url, timeout=TIMEOUT) as r:
                if r.status != 200:
                    raise AcmeError(f"the ACME directory answered {r.status}")
                self.dir = await r.json(content_type=None)
        return self.dir

    async def nonce(self) -> str:
        if self._nonce:
            n, self._nonce = self._nonce, None
            return n
        url = (await self.directory())["newNonce"]
        async with self.http.head(url, timeout=TIMEOUT) as r:
            n = r.headers.get("Replay-Nonce")
        if not n:
            raise AcmeError("the ACME server gave no nonce")
        return n

    async def post(self, url: str, payload: Any, accept: str | None = None) -> tuple[int, Any, Any]:
        """(status, headers, body: parsed JSON, or text for a certificate). Retries once on badNonce."""
        for attempt in (1, 2):
            protected = {"alg": "ES256", "nonce": await self.nonce(), "url": url}
            if self.kid:
                protected["kid"] = self.kid
            else:
                protected["jwk"] = self.account.jwk()
            headers = {"Content-Type": JOSE}
            if accept:
                headers["Accept"] = accept
            async with self.http.post(url, data=json.dumps(self.account.sign(protected, payload)),
                                      headers=headers, timeout=TIMEOUT) as r:
                self._nonce = r.headers.get("Replay-Nonce") or None
                text = await r.text()
                body: Any = text
                if "json" in (r.headers.get("Content-Type") or ""):
                    try:
                        body = json.loads(text)
                    except ValueError:
                        body = {}
                if r.status >= 400:
                    kind = body.get("type", "") if isinstance(body, dict) else ""
                    if kind.endswith(":badNonce") and attempt == 1:
                        continue
                    detail = body.get("detail", "") if isinstance(body, dict) else ""
                    raise AcmeError(f"Let's Encrypt answered {r.status} {kind.rsplit(':', 1)[-1]} {detail}".strip())
                return r.status, r.headers, body
        raise AcmeError("the ACME server kept refusing the nonce")

    async def register(self) -> str:
        """The account's URL (newAccount answers an existing account with its URL too)."""
        if self.kid:
            return self.kid
        d = await self.directory()
        payload: dict = {"termsOfServiceAgreed": True}
        if self.email:
            payload["contact"] = [f"mailto:{self.email}"]
        _, headers, _ = await self.post(d["newAccount"], payload)
        kid = headers.get("Location")
        if not kid:
            raise AcmeError("the ACME server gave no account URL")
        self.kid = kid
        return kid

    async def poll(self, url: str, done: tuple[str, ...], timeout: float = 180.0) -> dict:
        waited = 0.0
        while True:
            _, _, body = await self.post(url, None)
            state = body.get("status") if isinstance(body, dict) else None
            if state in done:
                return body
            if state == "invalid":
                problems = [c.get("error", {}).get("detail", "") for c in body.get("challenges", [])
                            if isinstance(c, dict) and c.get("error")] or [str(body.get("error", {}).get("detail", ""))]
                raise AcmeError("validation failed: " + "; ".join(p for p in problems if p))
            if waited >= timeout:
                raise AcmeError(f"timed out waiting (still {state})")
            await self.sleep(self.poll_every)
            waited += self.poll_every

    async def issue(self, name: str, dns: "CloudflareDns", cert_key: ec.EllipticCurvePrivateKey,
                    visible: Callable[[str, str], Awaitable[bool]]) -> str:
        """One certificate for ``name`` (PEM chain), proving it with DNS-01 through ``dns``."""
        await self.register()
        d = await self.directory()
        _, headers, order = await self.post(d["newOrder"], {"identifiers": [{"type": "dns", "value": name}]})
        order_url = headers.get("Location")
        if not order_url:
            raise AcmeError("the ACME server gave no order URL")
        made: list[tuple[str, str]] = []
        try:
            pending = []
            for authz_url in order.get("authorizations", []):
                _, _, authz = await self.post(authz_url, None)
                if authz.get("status") == "valid":
                    continue
                chall = next((c for c in authz.get("challenges", []) if c.get("type") == "dns-01"), None)
                if chall is None:
                    raise AcmeError("the ACME server offered no dns-01 challenge")
                record = "_acme-challenge." + authz["identifier"]["value"]
                value = dns01_value(chall["token"], self.account)
                made.append(await dns.add_txt(record, value))
                pending.append((authz_url, chall["url"], record, value))
            for _, _, record, value in pending:
                await wait_visible(visible, record, value, self.sleep)
            for authz_url, chall_url, _, _ in pending:
                await self.post(chall_url, {})
                await self.poll(authz_url, ("valid",))
            order = await self.poll(order_url, ("ready", "valid"))
            if order.get("status") == "ready":
                csr = csr_der(name, cert_key)
                await self.post(order["finalize"], {"csr": b64u(csr)})
                order = await self.poll(order_url, ("valid",))
            _, _, pem = await self.post(order["certificate"], None, accept="application/pem-certificate-chain")
            if not isinstance(pem, str) or "BEGIN CERTIFICATE" not in pem:
                raise AcmeError("the ACME server sent no certificate")
            return pem
        finally:
            for zone, record_id in made:
                try:
                    await dns.remove(zone, record_id)
                except Exception as exc:  # noqa: BLE001 -- a stale TXT record is harmless; say so
                    log.warning("could not remove the challenge's TXT record (%s)", exc)


async def wait_visible(visible: Callable[[str, str], Awaitable[bool]], record: str, value: str,
                       sleep: Callable[[float], Awaitable[None]], timeout: float = 180.0, every: float = 5.0) -> None:
    """Wait until the TXT value is published (Cloudflare is quick); then go on even if never seen."""
    waited = 0.0
    while waited < timeout:
        try:
            if await visible(record, value):
                return
        except Exception as exc:  # noqa: BLE001 -- a resolver hiccup: keep waiting
            log.debug("TXT lookup failed: %s", exc)
        await sleep(every)
        waited += every
    log.warning("the challenge's TXT record was not seen in DNS after %.0f s; asking Let's Encrypt anyway", timeout)


def doh_visible(http: aiohttp.ClientSession, doh: str = DOH) -> Callable[[str, str], Awaitable[bool]]:
    """Is the TXT value published? Asked over DNS-over-HTTPS (Cloudflare's resolver, as Caddy's `resolvers`)."""
    async def check(record: str, value: str) -> bool:
        async with http.get(doh, params={"name": record, "type": "TXT"},
                            headers={"Accept": "application/dns-json"}, timeout=TIMEOUT) as r:
            body = await r.json(content_type=None)
        return any(str(a.get("data", "")).strip('"') == value for a in body.get("Answer", []) or [])
    return check


def csr_der(name: str, key: ec.EllipticCurvePrivateKey) -> bytes:
    csr = (x509.CertificateSigningRequestBuilder()
           .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)]))
           .add_extension(x509.SubjectAlternativeName([x509.DNSName(name)]), critical=False)
           .sign(key, hashes.SHA256()))
    return csr.public_bytes(serialization.Encoding.DER)


# -- Cloudflare DNS ---------------------------------------------------------------------------------------
class CloudflareDns:
    """TXT records in the Cloudflare zone holding the name. The zone is found by name (GET /zones?name=), so the
    token needs Zone / Zone / Read besides Zone / DNS / Edit, both limited to that one zone."""

    def __init__(self, http: aiohttp.ClientSession, token: Callable[[], str], api: str = CLOUDFLARE_API) -> None:
        self.http = http
        self.token = token
        self.api = api.rstrip("/")

    def _headers(self) -> dict:
        token = self.token()
        if not token:
            raise AcmeError("the Cloudflare DNS token is empty (the App's option cloudflare_token)")
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    async def _call(self, method: str, path: str, **kw) -> Any:
        async with self.http.request(method, self.api + path, headers=self._headers(), timeout=TIMEOUT, **kw) as r:
            body = await r.json(content_type=None)
        if r.status >= 400 or not isinstance(body, dict) or not body.get("success"):
            errors = body.get("errors") if isinstance(body, dict) else None
            first = errors[0] if isinstance(errors, list) and errors and isinstance(errors[0], dict) else {}
            raise AcmeError(f"Cloudflare answered {r.status} {first.get('code', '')} {first.get('message', '')}".strip())
        return body.get("result")

    async def zone_for(self, record: str) -> str:
        labels = record.rstrip(".").split(".")
        for i in range(1, len(labels) - 1):
            candidate = ".".join(labels[i:])
            zones = await self._call("GET", "/zones", params={"name": candidate})
            if zones:
                return zones[0]["id"]
        raise AcmeError(f"no Cloudflare zone this token can see holds {record.split('.', 1)[-1]} (the token needs "
                        "Zone / Zone / Read and Zone / DNS / Edit on that zone)")

    async def add_txt(self, record: str, value: str) -> tuple[str, str]:
        zone = await self.zone_for(record)
        made = await self._call("POST", f"/zones/{zone}/dns_records",
                                json={"type": "TXT", "name": record, "content": value, "ttl": 60})
        return zone, made["id"]

    async def remove(self, zone: str, record_id: str) -> None:
        await self._call("DELETE", f"/zones/{zone}/dns_records/{record_id}")


# -- files ------------------------------------------------------------------------------------------------
def _write_private(path: Path, data: bytes) -> None:
    tmp = path.with_name(path.name + ".new")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def _key_pem(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())


def self_signed(name: str, days: int = PLACEHOLDER_DAYS) -> tuple[bytes, bytes]:
    """(cert PEM, key PEM): the placeholder served until Let's Encrypt's certificate arrives."""
    key = ec.generate_private_key(ec.SECP256R1())
    now = dt.datetime.now(dt.timezone.utc)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, name)])
    issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, PLACEHOLDER_ISSUER)])
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(issuer).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - dt.timedelta(minutes=5))
            .not_valid_after(now + dt.timedelta(days=days))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(name)]), critical=False)
            .sign(key, hashes.SHA256()))
    return cert.public_bytes(serialization.Encoding.PEM), _key_pem(key)


def cert_info(pem: bytes) -> tuple[float, set[str], bool]:
    """(not_after as a timestamp, the DNS names, is it the placeholder?) of the leaf certificate."""
    cert = x509.load_pem_x509_certificates(pem)[0]
    try:
        names = set(cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName))
    except x509.ExtensionNotFound:
        names = set()
    placeholder = cert.issuer.rfc4514_string() == f"CN={PLACEHOLDER_ISSUER}"
    return cert.not_valid_after_utc.timestamp(), {n.lower() for n in names}, placeholder


# -- the manager ------------------------------------------------------------------------------------------
class CertManager:
    """Keeps a valid certificate for ``name`` in ``folder`` and on the live SSLContext."""

    def __init__(self, name: str, folder: Path, token_file: Path | None, directory: str = LETSENCRYPT,
                 email: str = "", clock: Callable[[], float] = time.time,
                 http_factory: Callable[[], aiohttp.ClientSession] | None = None,
                 cloudflare_api: str = CLOUDFLARE_API,
                 visible: Callable[[aiohttp.ClientSession], Callable[[str, str], Awaitable[bool]]] | None = None,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep, poll_every: float = 2.0) -> None:
        self.name = name.lower()
        self.folder = Path(folder)
        self.token_file = token_file
        self.directory = directory or LETSENCRYPT
        self.email = email
        self.clock = clock
        self.http_factory = http_factory or (lambda: aiohttp.ClientSession())
        self.cloudflare_api = cloudflare_api
        self.visible = visible or doh_visible
        self.sleep = sleep
        self.poll_every = poll_every
        self.failures = 0
        self.last_error = ""
        self.folder.mkdir(parents=True, exist_ok=True)
        os.chmod(self.folder, 0o700)
        self.ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        self.ssl_ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        if not self._usable():
            log.info("built-in HTTPS: no certificate for %s yet; serving a temporary self-signed one until "
                     "Let's Encrypt's arrives", self.name)
            cert, key = self_signed(self.name)
            self._install(cert, key)
        else:
            self.ssl_ctx.load_cert_chain(self.cert_path, self.key_path)

    @property
    def cert_path(self) -> Path:
        return self.folder / "cert.pem"

    @property
    def key_path(self) -> Path:
        return self.folder / "cert.key"

    def _usable(self) -> bool:
        try:
            not_after, names, _ = cert_info(self.cert_path.read_bytes())
        except (OSError, ValueError, IndexError):
            return False
        return self.key_path.is_file() and self.name in names and not_after > self.clock()

    def _install(self, cert: bytes, key: bytes) -> None:
        _write_private(self.key_path, key)
        _write_private(self.cert_path, cert)
        self.ssl_ctx.load_cert_chain(self.cert_path, self.key_path)

    def status(self) -> dict:
        try:
            not_after, names, placeholder = cert_info(self.cert_path.read_bytes())
        except (OSError, ValueError, IndexError):
            return {"name": self.name, "state": "none", "last_error": self.last_error}
        state = "placeholder" if placeholder else ("ok" if not_after > self.clock() else "expired")
        return {"name": self.name, "state": state, "not_after": not_after, "last_error": self.last_error}

    def needs_issuing(self) -> bool:
        try:
            not_after, names, placeholder = cert_info(self.cert_path.read_bytes())
        except (OSError, ValueError, IndexError):
            return True
        return placeholder or self.name not in names or not_after - self.clock() < RENEW_BEFORE

    def _account(self) -> AccountKey:
        path = self.folder / "account.key"
        if path.is_file():
            key = serialization.load_pem_private_key(path.read_bytes(), None)
            if isinstance(key, ec.EllipticCurvePrivateKey):
                return AccountKey(key)
        account = AccountKey.generate()
        _write_private(path, account.pem())
        return account

    def _token(self) -> str:
        if self.token_file is None:
            return ""
        try:
            return self.token_file.read_text().strip()
        except OSError:
            return ""

    async def issue(self) -> None:
        async with self.http_factory() as http:
            client = AcmeClient(http, self.directory, self._account(), self.email, sleep=self.sleep,
                                poll_every=self.poll_every)
            dns = CloudflareDns(http, self._token, self.cloudflare_api)
            key = ec.generate_private_key(ec.SECP256R1())
            pem = await client.issue(self.name, dns, key, self.visible(http))
        self._install(pem.encode(), _key_pem(key))

    async def check(self) -> float:
        """Issue or renew when due. Returns the seconds until the next check."""
        if not self.needs_issuing():
            return CHECK_EVERY
        try:
            await self.issue()
        except Exception as exc:  # noqa: BLE001 -- logged (never a secret) and retried later
            self.failures += 1
            self.last_error = str(exc) if isinstance(exc, AcmeError) else type(exc).__name__
            wait = RETRY_AFTER[min(self.failures, len(RETRY_AFTER)) - 1]
            log.error("built-in HTTPS: could not get a certificate for %s (%s); trying again in %d min",
                      self.name, self.last_error, wait // 60)
            return wait
        self.failures, self.last_error = 0, ""
        not_after, _, _ = cert_info(self.cert_path.read_bytes())
        log.info("built-in HTTPS: Let's Encrypt certificate for %s installed (valid until %s)", self.name,
                 time.strftime("%Y-%m-%d", time.gmtime(not_after)))
        return CHECK_EVERY

    async def run(self) -> None:
        while True:
            wait = await self.check()
            await asyncio.sleep(wait)


def register(app) -> CertManager | None:
    """app["direct_tls"]: the certificate manager of the built-in HTTPS listener (cfg.direct_tls == "acme")."""
    cfg = app["cfg"]
    if getattr(cfg, "direct_tls", "") != "acme":
        return None
    from urllib.parse import urlparse
    mgr = CertManager(urlparse(cfg.public_url).hostname or "", cfg.tls_dir, cfg.acme_dns_token_file,
                      cfg.acme_directory or LETSENCRYPT, cfg.acme_email)
    app["direct_tls"] = mgr

    async def start(app) -> None:
        app["direct_tls_task"] = asyncio.create_task(mgr.run())

    async def stop(app) -> None:
        app["direct_tls_task"].cancel()

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return mgr
