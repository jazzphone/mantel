"""Cloudflare Access in front of the tunnel: Mantel checks Access's signed assertion itself (optional).

The recommended way in from away is a Cloudflare Tunnel (docs/guide/Security-Model.md). Cloudflare Access is
an extra sign-in Cloudflare enforces before a request ever reaches the tunnel; when it lets a request through it
adds ``Cf-Access-Jwt-Assertion``, a JWT signed with the team's RSA keys. Without this module that header only
ever made a request the tunnel door (authz.resolve_door: any Cloudflare header means away, whoever sends it).
With ``--cf-access-team`` and ``--cf-access-aud`` set, Mantel also refuses every tunnel-door request that does
not carry a valid assertion, so a hostname published without Access, an Access policy switched off by mistake,
or a request that goes around Cloudflare to the origin gets nothing but a 403:

* **Which requests.** Exactly those whose door is ``tunnel`` (sessions.door_of; the stricter door, never a way
  to a looser one). The ``lan`` door, HA's Ingress (the ``ha`` door: HA signs those people in) and the HA
  Core linked-mode exception are untouched. Unconfigured: nothing here runs, as before.
* **Before any session handling.** The middleware sits after proxy_trust (forged forwarding headers are gone)
  and Ingress (which marks the HA Core exception), and before auth.require_session: a refused request never
  reaches a cookie, a session refresh or a sign-in attempt.
* **What counts as valid.** A compact JWS, base64url in three parts; header ``alg`` exactly ``RS256`` (``none``,
  ``HS256`` and every other algorithm refused before a key is looked at, so an RSA public key can never be
  used as an HMAC secret) with a ``kid`` and no ``crit``; an RSA signature (PKCS#1 v1.5, SHA-256, at least
  2048-bit keys) by a key from ``https://<team>.cloudflareaccess.com/cdn-cgi/access/certs``; ``iss`` exactly
  ``https://<team>.cloudflareaccess.com``; ``aud`` (a string or a list) naming one of the configured AUD tags;
  ``exp`` present, and ``exp``/``nbf``/``iat`` within LEEWAY seconds of the clock.
* **The keys.** Fetched with the app's own aiohttp session, kept by ``kid`` for KEYS_TTL (an hour), fetched
  again at once for an unknown ``kid`` (Cloudflare rotates keys) but at most every REFETCH_EVERY seconds, so a
  flood of made-up kids cannot turn Mantel into a load on Cloudflare. If the keys cannot be fetched, keys
  already held stay usable for up to MAX_STALE after their fetch (a short Cloudflare outage does not lock the
  home out); with none, or older than that, every tunnel request is refused (fail closed: 503).
* **Answers.** 403 ``access_required`` (no assertion), 403 ``access_invalid`` (anything wrong with it), 503
  ``access_unavailable`` (no usable keys). Each reason is logged at most once per WARN_EVERY, with the peer and
  never the token.

The verified ``email`` and ``sub`` are kept on the request (``request["cf_access"]``) for logging only: Access
says who passed Cloudflare's gate, never who is signed in to Mantel. Mantel's own sign-in still applies, with
the tunnel's stricter rules.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any, Awaitable, Callable

from aiohttp import web
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from .app_crypto import unb64u

log = logging.getLogger("mantel.cf_access")

HEADER = "Cf-Access-Jwt-Assertion"
APP_KEY = "cf_access"
TEAM_SUFFIX = ".cloudflareaccess.com"
CERTS_PATH = "/cdn-cgi/access/certs"
KEYS_TTL = 3600.0             # keys are re-read hourly (Cloudflare rotates them every few weeks, with overlap)
REFETCH_EVERY = 60.0          # at most one fetch a minute, whatever kids arrive
MAX_STALE = 24 * 3600.0       # keys already held stay usable this long when Cloudflare cannot be reached
LEEWAY = 60                   # seconds of clock difference allowed on exp / nbf / iat
MAX_TOKEN = 16 * 1024         # an Access assertion is about 1 KiB; anything this big is not one
MAX_JWKS = 256 * 1024
MIN_RSA_BITS = 2048
WARN_EVERY = 300.0
_TEAM = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
_AUD = re.compile(r"^[A-Za-z0-9_-]{16,256}$")
_B64U = re.compile(r"^[A-Za-z0-9_-]*$")
_warned: dict[str, float] = {}


# -- settings -------------------------------------------------------------------------------------
def normalize_team(raw: str) -> str:
    """The team's Access domain from what an Owner types: ``myteam``, ``myteam.cloudflareaccess.com`` or
    ``https://myteam.cloudflareaccess.com/``, all giving ``myteam.cloudflareaccess.com``. ValueError otherwise
    (only Cloudflare's own team domains: the keys are fetched from there)."""
    name = (raw or "").strip().lower()
    if name.startswith("https://"):
        name = name[len("https://"):]
    name = name.rstrip("/")
    if name.endswith(TEAM_SUFFIX):
        name = name[:-len(TEAM_SUFFIX)]
    if not _TEAM.match(name):
        raise ValueError(f"not a Cloudflare Zero Trust team name: {raw!r} (for example myteam, or "
                         f"myteam{TEAM_SUFFIX})")
    return name + TEAM_SUFFIX


def parse_auds(values) -> tuple[str, ...]:
    """AUD tags from one or more values, each a comma or space separated list. ValueError for a bad one."""
    out: list[str] = []
    for value in values or ():
        for tag in str(value).replace(",", " ").split():
            if not _AUD.match(tag):
                raise ValueError(f"not an Access application AUD tag: {tag!r} (Cloudflare shows a 64-character "
                                 "hexadecimal tag in the application's Overview)")
            if tag not in out:
                out.append(tag)
    return tuple(out)


# -- errors ---------------------------------------------------------------------------------------
class AccessError(Exception):
    """A refused assertion: ``code`` is what the client sees, ``reason`` what the log says (never the token)."""

    def __init__(self, code: str, reason: str, status: int = 403) -> None:
        super().__init__(reason)
        self.code, self.reason, self.status = code, reason, status


def _invalid(reason: str) -> AccessError:
    return AccessError("access_invalid", reason)


MESSAGES = {
    "access_required": "This address must be reached through Cloudflare Access (no Access assertion arrived).",
    "access_invalid": "Cloudflare Access's assertion was not accepted.",
    "access_unavailable": "Cloudflare Access's signing keys cannot be read right now; try again shortly.",
}


# -- the token ------------------------------------------------------------------------------------
def _part(text: str) -> bytes:
    if not _B64U.match(text):
        raise _invalid("malformed")            # strict base64url: no padding, no '+', '/', spaces
    try:
        return unb64u(text)
    except (ValueError, TypeError):
        raise _invalid("malformed") from None


def _json(raw: bytes) -> dict:
    try:
        got = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise _invalid("malformed") from None
    if not isinstance(got, dict):
        raise _invalid("malformed")
    return got


def parse(token: str) -> tuple[dict, dict, bytes, bytes]:
    """(header, claims, signing input, signature) of an RS256 compact JWS; AccessError when it is not one.
    The algorithm is checked here, before any key is chosen."""
    if not isinstance(token, str) or not token or len(token) > MAX_TOKEN or not token.isascii():
        raise _invalid("malformed")
    parts = token.strip().split(".")
    if len(parts) != 3 or not parts[0] or not parts[1]:
        raise _invalid("malformed")
    h, c, s = parts
    header = _json(_part(h))                  # the algorithm first: an unsigned alg=none token says so here
    alg = header.get("alg")
    if alg != "RS256":
        raise _invalid(f"alg {alg!r}" if isinstance(alg, str) and len(alg) <= 16 else "alg")
    if "crit" in header:
        raise _invalid("crit")
    kid = header.get("kid")
    if not isinstance(kid, str) or not kid or len(kid) > 256:
        raise _invalid("no kid")
    claims = _json(_part(c))
    sig = _part(s)
    if not sig:
        raise _invalid("malformed")
    return header, claims, f"{h}.{c}".encode(), sig


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def check_claims(claims: dict, issuer: str, auds: tuple[str, ...], now: float, leeway: float = LEEWAY) -> None:
    if claims.get("iss") != issuer:
        raise _invalid("wrong iss")
    aud = claims.get("aud")
    got = [aud] if isinstance(aud, str) else aud if isinstance(aud, list) else []
    if not any(isinstance(a, str) and a in auds for a in got):
        raise _invalid("wrong aud")
    exp = claims.get("exp")
    if not _number(exp):
        raise _invalid("no exp")
    if now > exp + leeway:
        raise _invalid("expired")
    for name in ("nbf", "iat"):
        value = claims.get(name)
        if value is None:
            continue
        if not _number(value):
            raise _invalid(f"bad {name}")
        if value > now + leeway:
            raise _invalid(f"{name} in the future")


# -- the keys -------------------------------------------------------------------------------------
def rsa_key_of_jwk(jwk: Any) -> rsa.RSAPublicKey:
    if not isinstance(jwk, dict) or jwk.get("kty") != "RSA":
        raise ValueError("not an RSA JWK")
    if jwk.get("alg") not in (None, "RS256") or jwk.get("use") not in (None, "sig"):
        raise ValueError("not an RS256 signing key")
    if "d" in jwk:
        raise ValueError("a public JWK only")
    n_raw, e_raw = jwk.get("n"), jwk.get("e")
    if not isinstance(n_raw, str) or not isinstance(e_raw, str) or not _B64U.match(n_raw) or not _B64U.match(e_raw):
        raise ValueError("bad RSA numbers")
    n, e = int.from_bytes(unb64u(n_raw), "big"), int.from_bytes(unb64u(e_raw), "big")
    if n.bit_length() < MIN_RSA_BITS or e < 3 or e % 2 == 0:
        raise ValueError("RSA key too small or bad exponent")
    return rsa.RSAPublicNumbers(e, n).public_key()


def keys_of_jwks(doc: Any) -> dict[str, rsa.RSAPublicKey]:
    """Cloudflare's certs document: {"keys": [JWK, ...], "public_cert": ..., "public_certs": [...]}; only the
    JWKs are read, and a key that is not a usable RS256 key is skipped."""
    out: dict[str, rsa.RSAPublicKey] = {}
    keys = doc.get("keys") if isinstance(doc, dict) else None
    for jwk in keys if isinstance(keys, list) else ():
        kid = jwk.get("kid") if isinstance(jwk, dict) else None
        if not isinstance(kid, str) or not kid:
            continue
        try:
            out[kid] = rsa_key_of_jwk(jwk)
        except ValueError:
            continue
    return out


Fetch = Callable[[str], Awaitable[Any]]


class AccessVerifier:
    """One team's assertions: its keys (cached by kid) and the claims this installation expects."""

    def __init__(self, team: str, auds, fetch: Fetch, clock: Callable[[], float] = time.time) -> None:
        self.team = normalize_team(team)
        self.auds = parse_auds(auds)
        if not self.auds:
            raise ValueError("Cloudflare Access needs at least one AUD tag")
        self.issuer = f"https://{self.team}"
        self.certs_url = self.issuer + CERTS_PATH
        self.fetch = fetch
        self.clock = clock
        self.keys: dict[str, rsa.RSAPublicKey] = {}
        self.fetched_at: float | None = None       # the last SUCCESSFUL fetch
        self.tried_at: float | None = None         # the last attempt, successful or not (the rate limit)
        self.fetches = 0
        self._lock = asyncio.Lock()

    async def _refresh(self) -> None:
        now = self.clock()
        if self.tried_at is not None and now - self.tried_at < REFETCH_EVERY:
            return
        self.tried_at = now
        self.fetches += 1
        try:
            keys = keys_of_jwks(await self.fetch(self.certs_url))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 -- network, status, JSON: all mean "no new keys"
            _warn(f"keys: fetch failed ({type(exc).__name__})", self.certs_url)
            return
        if not keys:
            _warn("keys: the certs document holds no usable RS256 key", self.certs_url)
            return
        self.keys, self.fetched_at = keys, now

    def _fresh(self, now: float, within: float) -> bool:
        return self.fetched_at is not None and now - self.fetched_at < within

    async def key(self, kid: str) -> rsa.RSAPublicKey:
        now = self.clock()
        if kid in self.keys and self._fresh(now, KEYS_TTL):
            return self.keys[kid]
        async with self._lock:                   # one fetch at a time; the others then use its result
            if not (kid in self.keys and self._fresh(self.clock(), KEYS_TTL)):
                await self._refresh()
        now = self.clock()
        if not self.keys or not self._fresh(now, MAX_STALE):
            raise AccessError("access_unavailable", "no signing keys", status=503)
        if kid not in self.keys:
            raise _invalid("unknown kid")
        return self.keys[kid]

    async def verify(self, token: str | None) -> dict:
        """The assertion's claims, or AccessError (see the module docstring for what is checked)."""
        if token is None or not token.strip():
            raise AccessError("access_required", "no assertion")
        header, claims, signing, sig = parse(token)
        key = await self.key(header["kid"])
        try:
            key.verify(sig, signing, padding.PKCS1v15(), hashes.SHA256())
        except (InvalidSignature, ValueError):
            raise _invalid("bad signature") from None
        check_claims(claims, self.issuer, self.auds, self.clock())
        return claims


# -- the app --------------------------------------------------------------------------------------
def _warn(reason: str, who: str) -> None:
    now = time.monotonic()
    if now - _warned.get(reason, -WARN_EVERY) >= WARN_EVERY:
        if len(_warned) > 256:
            _warned.clear()
        _warned[reason] = now
        log.warning("Cloudflare Access: %s (%s)", reason, who)


def http_fetch(app: web.Application) -> Fetch:
    """Fetch a certs document with the app's own aiohttp session (server.build_app's app["http"])."""
    import aiohttp

    async def fetch(url: str) -> Any:
        http: aiohttp.ClientSession = app["http"]
        async with http.get(url, timeout=aiohttp.ClientTimeout(total=10), allow_redirects=False,
                            headers={"Accept": "application/json"}) as r:
            if r.status != 200:
                raise OSError(f"HTTP {r.status}")
            body = await r.content.read(MAX_JWKS + 1)
            if len(body) > MAX_JWKS:
                raise OSError("certs document too large")
            return json.loads(body)
    return fetch


def register(app: web.Application, fetch: Fetch | None = None) -> None:
    """Turn verification on when the installation names a team and AUD tags (Config.cf_access_*)."""
    cfg = app.get("cfg")
    team, auds = getattr(cfg, "cf_access_team", ""), tuple(getattr(cfg, "cf_access_aud", ()) or ())
    if not team and not auds:
        return
    verifier = AccessVerifier(team, auds, fetch or http_fetch(app), lambda: app["clock"]())
    app[APP_KEY] = verifier
    log.info("Cloudflare Access: every tunnel-door request must carry a valid assertion from %s (%d AUD tag%s)",
             verifier.team, len(verifier.auds), "" if len(verifier.auds) == 1 else "s")


def applies(request: web.Request) -> bool:
    """Does this request need an assertion? The tunnel door only; HA's Ingress never (the 'ha' door)."""
    from . import ingress, sessions
    if ingress.is_ingress(request):
        return False
    return sessions.door_of(request) == "tunnel"


@web.middleware
async def middleware(request: web.Request, handler):
    verifier: AccessVerifier | None = request.app.get(APP_KEY)
    if verifier is None or not applies(request):
        return await handler(request)
    values = request.headers.getall(HEADER, [])
    try:
        if len(values) > 1:
            raise _invalid("several assertions")
        claims = await verifier.verify(values[0] if values else None)
    except AccessError as err:
        from . import sessions
        _warn(f"refused a tunnel request: {err.reason}", sessions.client_ip(request) or "?")
        return web.json_response({"error": err.code, "message": MESSAGES[err.code]}, status=err.status,
                                 headers={"Cache-Control": "no-store",
                                          **({"Retry-After": "60"} if err.status == 503 else {})})
    request["cf_access"] = {k: claims[k] for k in ("email", "sub") if isinstance(claims.get(k), str)}
    return await handler(request)
