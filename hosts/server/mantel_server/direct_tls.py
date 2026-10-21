"""Built-in HTTPS for the HA App's direct access (decision 26; docs/phase3/HA-APP.md "Built-in HTTPS").

With the App option ``access: https`` Mantel serves HTTPS on its direct listener itself (direct.py), with a
certificate it obtains and renews from Let's Encrypt over ACME (RFC 8555), proving the name with the DNS-01
challenge through Cloudflare's API, or Duck DNS's for a <name>.duckdns.org -- the same way the compose stack's
Caddy does (packaging/compose/caddy/tls-dns01-*.caddy), so no port has to be reachable from the internet and the
name may stay LAN-only. Other DNS hosts are the compose stack's (its Caddy has them built in).

Why here and not a Caddy binary in the App (the choice is recorded in HA-APP.md): the App image is built on
the house's own HA machine by the Supervisor, and Caddy's Cloudflare module means compiling Caddy with
xcaddy there (a Go toolchain, minutes of CPU, a gigabyte of memory on a small HA box) or downloading an
unpinnable binary; and two processes in the App need a supervisor the App does not have (init + one exec'd
server). ACME with DNS-01 is a few HTTPS requests, and everything it needs (aiohttp, cryptography) is already
in the image, pinned and tested.

* **Keys and certificate** live in ``<data_dir>/tls`` (folder 0700, files 0600; NOT sealed with the at-rest key,
  and inside HA's backups): ``account.key`` (the ACME account), ``tls.pem`` (a fresh key at each issuance and its
  chain, in one file written atomically; ``CertManager`` lists the rest). A new chain is checked before use: the
  leaf is for the generated key, names exactly the name, has not expired, and loads into a fresh context.
* **Until a certificate exists** (first start, or Let's Encrypt unreachable) the listener serves a short-lived
  self-signed one for the same name and nothing else: every page answers "certificate pending" (direct.py),
  so no one signs in over a certificate a browser cannot check. A damaged stored file never stops the App.
* Requesting a certificate accepts Let's Encrypt's subscriber agreement (``termsOfServiceAgreed``).
* **Renewal** 30 days before expiry, checked twice a day; a failed attempt is retried after 1, 3, 12, then
  24 hours (Let's Encrypt limits failed validations). The live listener picks the new certificate up at once
  (``SSLContext.load_cert_chain`` on the same context: new handshakes use it).
* **The DNS token** (Cloudflare's or Duck DNS's) is read from its file (the App's masked option, moved there by
  the entrypoint) at each attempt, sent only to that DNS host's API, and never logged, stored elsewhere or shown.
  Duck DNS wants it in the update URL's query (HTTPS): a failure there is reported without the URL.
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
DUCKDNS_API = "https://www.duckdns.org"
DNS_PROVIDERS = ("cloudflare", "duckdns")
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
        self.origin = _origin(directory_url)

    def _same_origin(self, url: Any) -> str:
        """Every URL the server hands out must be on the directory's own origin (scheme, host, port)."""
        if not isinstance(url, str) or _origin(url) != self.origin:
            raise AcmeError("the ACME server named an address outside its own")
        return url

    async def directory(self) -> dict:
        if self.dir is None:
            async with self.http.get(self.directory_url, timeout=TIMEOUT, allow_redirects=False) as r:
                if r.status != 200:
                    raise AcmeError(f"the ACME directory answered {r.status}")
                d = await r.json(content_type=None)
            if not isinstance(d, dict):
                raise AcmeError("the ACME directory is not a directory")
            for key in ("newNonce", "newAccount", "newOrder"):
                self._same_origin(d.get(key))
            self.dir = d
        return self.dir

    async def nonce(self) -> str:
        if self._nonce:
            n, self._nonce = self._nonce, None
            return n
        url = (await self.directory())["newNonce"]
        async with self.http.head(url, timeout=TIMEOUT, allow_redirects=False) as r:
            n = r.headers.get("Replay-Nonce")
        if not n:
            raise AcmeError("the ACME server gave no nonce")
        return n

    async def post(self, url: str, payload: Any, accept: str | None = None) -> tuple[int, Any, Any]:
        """(status, headers, body: parsed JSON, or text for a certificate). Retries once on badNonce."""
        self._same_origin(url)
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
                                      headers=headers, timeout=TIMEOUT, allow_redirects=False) as r:
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
        self.kid = self._same_origin(kid)
        return kid

    async def poll(self, url: str, done: tuple[str, ...], timeout: float = 180.0) -> dict:
        waited = 0.0
        while True:
            _, headers, body = await self.post(url, None)
            state = body.get("status") if isinstance(body, dict) else None
            if state in done:
                return body
            if state == "invalid":
                problems = [c.get("error", {}).get("detail", "") for c in body.get("challenges", [])
                            if isinstance(c, dict) and c.get("error")] or [str(body.get("error", {}).get("detail", ""))]
                raise AcmeError("validation failed: " + "; ".join(p for p in problems if p))
            if waited >= timeout:
                raise AcmeError(f"timed out waiting (still {state})")
            wait = retry_after(headers.get("Retry-After"), self.poll_every)
            await self.sleep(wait)
            waited += max(wait, 0.5)

    async def issue(self, name: str, dns: "CloudflareDns | DuckDns", cert_key: ec.EllipticCurvePrivateKey,
                    visible: Callable[[str, str], Awaitable[bool]]) -> str:
        """One certificate for ``name`` (PEM chain), proving it with DNS-01 through ``dns``."""
        await self.register()
        d = await self.directory()
        _, headers, order = await self.post(d["newOrder"], {"identifiers": [{"type": "dns", "value": name}]})
        order_url = self._same_origin(headers.get("Location"))
        made: list[tuple[str, str]] = []
        try:
            pending = []
            for authz_url in order.get("authorizations", []):
                _, _, authz = await self.post(self._same_origin(authz_url), None)
                ident = (authz.get("identifier") or {}).get("value", "")
                if str(ident).lower() != name.lower():
                    raise AcmeError("the ACME server asked to prove a name that was not requested")
                if authz.get("status") == "valid":
                    continue
                chall = next((c for c in authz.get("challenges", []) if c.get("type") == "dns-01"), None)
                if chall is None:
                    raise AcmeError("the ACME server offered no dns-01 challenge")
                record = "_acme-challenge." + name          # the requested name, never the server's word for it
                value = dns01_value(chall["token"], self.account)
                try:
                    made.append(await dns.add_txt(record, value))
                except Exception:
                    await dns.cleanup(record, value)     # Cloudflare may have made it before the answer failed
                    raise
                pending.append((authz_url, self._same_origin(chall.get("url")), record, value))
            for _, _, record, value in pending:
                await wait_visible(visible, record, value, self.sleep)
            for authz_url, chall_url, _, _ in pending:
                await self.post(chall_url, {})
                await self.poll(authz_url, ("valid",))
            order = await self.poll(order_url, ("ready", "valid"))
            if order.get("status") == "ready":
                csr = csr_der(name, cert_key)
                await self.post(self._same_origin(order.get("finalize")), {"csr": b64u(csr)})
                order = await self.poll(order_url, ("valid",))
            _, _, pem = await self.post(self._same_origin(order.get("certificate")), None,
                                        accept="application/pem-certificate-chain")
            if not isinstance(pem, str) or "BEGIN CERTIFICATE" not in pem:
                raise AcmeError("the ACME server sent no certificate")
            return pem
        finally:
            for zone, record_id in made:
                try:
                    await dns.remove(zone, record_id)
                except Exception as exc:  # noqa: BLE001 -- a stale TXT record is harmless; say so
                    log.warning("could not remove the challenge's TXT record (%s)", exc)


def _origin(url: str) -> tuple:
    from urllib.parse import urlsplit
    u = urlsplit(url)
    return (u.scheme.lower(), (u.hostname or "").lower(), u.port or (443 if u.scheme == "https" else 80))


def retry_after(value: str | None, default: float) -> float:
    """Seconds from an ACME Retry-After header (whole seconds), kept between the default and a minute."""
    try:
        return min(max(float(int(value)), default), 60.0) if value else default
    except ValueError:
        return default


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
           .subject_name(x509.Name([]))
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
        async with self.http.request(method, self.api + path, headers=self._headers(), timeout=TIMEOUT,
                                     allow_redirects=False, **kw) as r:
            try:
                body = await r.json(content_type=None)
            except ValueError:
                body = None
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

    async def cleanup(self, record: str, value: str) -> None:
        """Best effort: remove this challenge's TXT record found by name and value (an unanswered create)."""
        try:
            zone = await self.zone_for(record)
            found = await self._call("GET", f"/zones/{zone}/dns_records", params={"type": "TXT", "name": record})
            for r in found or []:
                if str(r.get("content", "")).strip('"') == value:
                    await self.remove(zone, r["id"])
        except Exception as exc:  # noqa: BLE001 -- a stale TXT record is harmless; say so
            log.warning("could not check for a leftover challenge TXT record (%s)", exc)


def duckdns_domain(name: str) -> str:
    """The Duck DNS name (``sam-home`` of ``sam-home.duckdns.org``) that holds the TXT value for ``name``."""
    labels = name.rstrip(".").lower().split(".")
    if len(labels) < 3 or labels[-2:] != ["duckdns", "org"] or not labels[-3]:
        raise AcmeError("with Duck DNS, Mantel's address must be your <name>.duckdns.org")
    return labels[-3]


class DuckDns:
    """The challenge's TXT value at Duck DNS. A Duck DNS name has ONE TXT value, served for the name and every name
    under it; the update API sets it (``txt=``) and clears it (``clear=true``). The token goes in that URL's query,
    as Duck DNS requires (over HTTPS): no failure message carries the URL, the query or the token."""

    def __init__(self, http: aiohttp.ClientSession, token: Callable[[], str], api: str = DUCKDNS_API) -> None:
        self.http = http
        self.token = token
        self.api = api.rstrip("/")

    async def _update(self, domain: str, **params: str) -> None:
        token = self.token()
        if not token:
            raise AcmeError("the Duck DNS token is empty (the App's option duckdns_token)")
        query = {"domains": domain, "token": token, "verbose": "true", **params}
        try:
            async with self.http.get(self.api + "/update", params=query, timeout=TIMEOUT, allow_redirects=False) as r:
                status, body = r.status, (await r.text())[:64]
        except (aiohttp.ClientError, asyncio.TimeoutError) as exc:
            raise AcmeError(f"Duck DNS could not be reached ({type(exc).__name__})") from None
        first = body.split()[0] if body.split() else ""
        if status != 200 or first != "OK":
            raise AcmeError(f"Duck DNS answered {status} {first if first in ('KO', 'OK') else ''}".strip()
                            + (" (a wrong token, or a name that is not this account's)" if first == "KO" else ""))

    async def add_txt(self, record: str, value: str) -> tuple[str, str]:
        domain = duckdns_domain(record)
        await self._update(domain, txt=value)
        return domain, value

    async def remove(self, domain: str, _value: str) -> None:
        await self._update(domain, txt="removed", clear="true")

    async def cleanup(self, record: str, value: str) -> None:
        """Best effort: clear the name's TXT value after an unanswered update."""
        try:
            await self.remove(duckdns_domain(record), value)
        except Exception as exc:  # noqa: BLE001 -- a stale TXT value is harmless; say so
            log.warning("could not clear a leftover challenge TXT value (%s)", exc)


# -- files ------------------------------------------------------------------------------------------------
def _write_private(path: Path, data: bytes) -> None:
    """Atomically: a 0600 temp file, flushed to disk, renamed over the target, the folder flushed too."""
    tmp = path.with_name(path.name + ".new")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
    try:
        dfd = os.open(path.parent, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(dfd)
    except OSError:
        pass
    finally:
        os.close(dfd)


def _key_pem(key: ec.EllipticCurvePrivateKey) -> bytes:
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())


def self_signed(name: str, days: int = PLACEHOLDER_DAYS) -> bytes:
    """The placeholder served until Let's Encrypt's certificate arrives: its key and certificate, one PEM."""
    key = ec.generate_private_key(ec.SECP256R1())
    now = dt.datetime.now(dt.timezone.utc)
    issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, PLACEHOLDER_ISSUER)])
    cert = (x509.CertificateBuilder().subject_name(issuer).issuer_name(issuer).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - dt.timedelta(minutes=5))
            .not_valid_after(now + dt.timedelta(days=days))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName(name)]), critical=False)
            .sign(key, hashes.SHA256()))
    return _key_pem(key) + cert.public_bytes(serialization.Encoding.PEM)


def cert_info(pem: bytes) -> tuple[float, set[str], bool]:
    """(not_after as a timestamp, the DNS names, is it the placeholder?) of the leaf certificate."""
    cert = x509.load_pem_x509_certificates(pem)[0]
    try:
        names = set(cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName))
    except x509.ExtensionNotFound:
        names = set()
    placeholder = cert.issuer.rfc4514_string() == f"CN={PLACEHOLDER_ISSUER}"
    return cert.not_valid_after_utc.timestamp(), {n.lower() for n in names}, placeholder


def new_context() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.options |= getattr(ssl, "OP_NO_RENEGOTIATION", 0)
    return ctx


class InvalidCertificate(AcmeError):
    pass


def check_bundle(pem: bytes, name: str, now: float) -> float:
    """The combined key + chain is usable for ``name`` now: the leaf's key is this key, its names are exactly
    ``name``, it has not expired. Returns its not_after. Raises InvalidCertificate otherwise."""
    try:
        key = serialization.load_pem_private_key(pem, None)
        certs = x509.load_pem_x509_certificates(pem)
    except (ValueError, TypeError) as exc:
        raise InvalidCertificate(f"the certificate file cannot be read ({type(exc).__name__})") from None
    leaf = certs[0]
    spki = serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    if leaf.public_key().public_bytes(*spki) != key.public_key().public_bytes(*spki):
        raise InvalidCertificate("the certificate is not for this key")
    not_after, names, _ = cert_info(pem)
    if names != {name}:
        raise InvalidCertificate(f"the certificate names {', '.join(sorted(names)) or 'nothing'}, not {name}")
    if not_after <= now:
        raise InvalidCertificate("the certificate has expired")
    return not_after


# -- the manager ------------------------------------------------------------------------------------------
class CertManager:
    """Keeps a valid certificate for ``name`` in ``folder`` and on the live SSLContext.

    Files (folder 0700, files 0600; plain, not sealed with the at-rest key, and in HA's backups):
    ``tls.pem`` the key and chain in use (one file, so the pair is always replaced together),
    ``pending.pem`` a freshly issued bundle not yet installed (kept across a restart, so an install problem
    never asks Let's Encrypt again), ``placeholder.pem``, ``account.key``, ``state.json`` (the ACME directory
    the certificate came from, failures and the next attempt).
    """

    def __init__(self, name: str, folder: Path, token_file: Path | None, directory: str = LETSENCRYPT,
                 email: str = "", clock: Callable[[], float] = time.time,
                 http_factory: Callable[[], aiohttp.ClientSession] | None = None,
                 cloudflare_api: str = CLOUDFLARE_API, dns_provider: str = "cloudflare",
                 duckdns_api: str = DUCKDNS_API,
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
        if dns_provider not in DNS_PROVIDERS:
            raise ValueError(f"unknown DNS provider {dns_provider!r}")
        self.dns_provider = dns_provider
        self.duckdns_api = duckdns_api
        self.visible = visible or doh_visible
        self.sleep = sleep
        self.poll_every = poll_every
        self.folder.mkdir(parents=True, exist_ok=True)
        os.chmod(self.folder, 0o700)
        self.state = self._load_state()
        self.ssl_ctx = new_context()
        self.pending = True                 # serving the placeholder (direct.py refuses sign-in meanwhile)
        if self.usable():
            try:
                self.ssl_ctx.load_cert_chain(self.cert_path)
                self.pending = False
            except (OSError, ssl.SSLError) as exc:
                log.error("built-in HTTPS: the stored certificate could not be loaded (%s); serving a temporary "
                          "one", type(exc).__name__)
        if self.pending:
            log.info("built-in HTTPS: no certificate for %s yet; serving a temporary self-signed one until "
                     "Let's Encrypt's arrives", self.name)
            _write_private(self.placeholder_path, self_signed(self.name))
            self.ssl_ctx.load_cert_chain(self.placeholder_path)

    # paths and state
    @property
    def cert_path(self) -> Path:
        return self.folder / "tls.pem"

    @property
    def pending_path(self) -> Path:
        return self.folder / "pending.pem"

    @property
    def placeholder_path(self) -> Path:
        return self.folder / "placeholder.pem"

    @property
    def state_path(self) -> Path:
        return self.folder / "state.json"

    def _load_state(self) -> dict:
        try:
            st = json.loads(self.state_path.read_text())
            return st if isinstance(st, dict) else {}
        except (OSError, ValueError):
            return {}

    def _save_state(self, **changes) -> None:
        self.state.update(changes)
        _write_private(self.state_path, json.dumps(self.state, sort_keys=True).encode())

    @property
    def last_error(self) -> str:
        return str(self.state.get("last_error") or "")

    @property
    def failures(self) -> int:
        return int(self.state.get("failures") or 0)

    def usable(self) -> bool:
        """tls.pem holds a valid certificate for the name, from the directory configured now."""
        try:
            check_bundle(self.cert_path.read_bytes(), self.name, self.clock())
        except (OSError, InvalidCertificate):
            return False
        return self.state.get("directory") == self.directory

    def status(self) -> dict:
        out = {"name": self.name, "last_error": self.last_error, "next_attempt": self.state.get("next_attempt")}
        if self.pending:
            return {**out, "state": "placeholder"}
        try:
            not_after, _, _ = cert_info(self.cert_path.read_bytes())
        except (OSError, ValueError, IndexError):
            return {**out, "state": "none"}
        return {**out, "state": "ok" if not_after > self.clock() else "expired", "not_after": not_after}

    def needs_issuing(self) -> bool:
        if self.pending or not self.usable():
            return True
        not_after, _, _ = cert_info(self.cert_path.read_bytes())
        return not_after - self.clock() < RENEW_BEFORE

    # the account
    def _account(self) -> AccountKey:
        path = self.folder / "account.key"
        if path.is_file():
            try:
                key = serialization.load_pem_private_key(path.read_bytes(), None)
                if isinstance(key, ec.EllipticCurvePrivateKey):
                    return AccountKey(key)
                raise ValueError("not an EC key")
            except (ValueError, TypeError):
                aside = path.with_name(f"account.key.unreadable-{int(self.clock())}")
                os.replace(path, aside)
                log.error("built-in HTTPS: the ACME account key could not be read; it was moved to %s and a new "
                          "account is made", aside.name)
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

    # installing
    def _adopt(self, bundle: bytes) -> float:
        """Validate a key + chain, prove it loads in a fresh context, then make it the live certificate."""
        not_after = check_bundle(bundle, self.name, self.clock())
        trial = self.folder / "trial.pem"
        _write_private(trial, bundle)
        try:
            new_context().load_cert_chain(trial)
        except ssl.SSLError as exc:
            raise InvalidCertificate(f"the certificate does not load ({exc.reason or type(exc).__name__})") from None
        finally:
            trial.unlink(missing_ok=True)
        _write_private(self.cert_path, bundle)
        self.ssl_ctx.load_cert_chain(self.cert_path)
        self.pending = False
        self.pending_path.unlink(missing_ok=True)
        self._save_state(directory=self.directory, failures=0, next_attempt=0, last_error="")
        log.info("built-in HTTPS: Let's Encrypt certificate for %s installed (valid until %s)", self.name,
                 time.strftime("%Y-%m-%d", time.gmtime(not_after)))
        return not_after

    async def issue(self) -> None:
        async with self.http_factory() as http:
            client = AcmeClient(http, self.directory, self._account(), self.email, sleep=self.sleep,
                                poll_every=self.poll_every)
            dns = (DuckDns(http, self._token, self.duckdns_api) if self.dns_provider == "duckdns"
                   else CloudflareDns(http, self._token, self.cloudflare_api))
            key = ec.generate_private_key(ec.SECP256R1())
            pem = await client.issue(self.name, dns, key, self.visible(http))
        bundle = _key_pem(key) + pem.encode()
        _write_private(self.pending_path, bundle)       # kept until installed: never asked for twice
        self._adopt(bundle)

    def _failed(self, exc: Exception) -> float:
        failures = self.failures + 1
        error = str(exc) if isinstance(exc, AcmeError) else type(exc).__name__
        wait = RETRY_AFTER[min(failures, len(RETRY_AFTER)) - 1]
        self._save_state(failures=failures, last_error=error, next_attempt=self.clock() + wait)
        log.error("built-in HTTPS: could not get a certificate for %s (%s); trying again in %d min",
                  self.name, error, wait // 60)
        return wait

    async def check(self) -> float:
        """Install a kept bundle, else issue or renew when due (respecting the stored backoff). Returns the
        seconds until the next check."""
        if self.pending_path.is_file():
            try:
                self._adopt(self.pending_path.read_bytes())
                return CHECK_EVERY
            except Exception as exc:  # noqa: BLE001 -- an unusable bundle: set aside, count it, issue anew
                self.pending_path.unlink(missing_ok=True)
                return self._failed(exc)
        if not self.needs_issuing():
            return CHECK_EVERY
        wait = float(self.state.get("next_attempt") or 0) - self.clock()
        if wait > 0:
            return wait
        try:
            await self.issue()
        except Exception as exc:  # noqa: BLE001 -- logged (never a secret) and retried later
            return self._failed(exc)
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
                      cfg.acme_directory or LETSENCRYPT, cfg.acme_email,
                      dns_provider=getattr(cfg, "acme_dns_provider", "cloudflare") or "cloudflare")
    app["direct_tls"] = mgr

    async def start(app) -> None:
        app["direct_tls_task"] = asyncio.create_task(mgr.run())

    async def stop(app) -> None:
        app["direct_tls_task"].cancel()

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return mgr
