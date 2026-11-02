"""Pairing by code (Mantel's linked_pairing.py is the other half; docs/phase9/MANTEL-LINK.md 9.4).

An Owner makes a one-time pairing code in Mantel Settings (Connections -> Mantel in Home Assistant). Mantel Link
trades it once, at Mantel's /linked/pair over https (plain http only inside this machine), for a Service
credential. Both sides prove they know the code (HMACs keyed from it), and Mantel Link believes the answer
only after checking Mantel's proof: a look-alike answering in Mantel's place cannot hand over a credential.

Protocol v2 (Mantel's audit, T2): the request also carries ``address``, the address Mantel Link used, normalised
(scheme, lower-case host, explicit port), and both proofs cover it. Mantel refuses an address that isn't its own
(``wrong_address``: a look-alike at another address passing the exchange on), and Mantel Link checks that Mantel's
proof names the address it used. Never v1: an older Mantel answers ``malformed``, which says "Update Mantel first".

Protocol v3 (2026-11-02): Mantel by its address on the network, at Mantel Connect's listener, whose certificate is
from Mantel's own CA. That certificate can't be checked before pairing, so v3 pairs over TLS that checks nothing and
asks the exchange to make up for it: Mantel's answer carries its CA certificate inside its proof (a look-alike can't
put its own there without the code) and the credential sealed with a key from the code (a look-alike in the middle
can't read it). The CA is kept with the entry and pinned from then on (hk_core's mantel_link.pinned_tls). Mantel Link
uses v3 only when the address's certificate isn't a public one; a Mantel that pins elsewhere says so
(``pin_elsewhere``).

aiohttp only, no Home Assistant import. Never logs the code or the credential.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import ssl
from ipaddress import ip_address
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import aiohttp
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

VERSION = 2                                       # never 1: no downgrade to a proof without the address
PINNED = 3                                        # Mantel's own CA, handed over and pinned
PATH = "/linked/pair"
ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"      # Mantel's codes (mantel_connect/protocol.py)
GROUPS, GROUP_LEN = 4, 5
_CODE = re.compile(rf"^[{ALPHABET}]{{{GROUPS * GROUP_LEN}}}$")
_HOSTNAME = re.compile(r"^(?=.{1,253}$)[a-z0-9_][a-z0-9_-]{0,62}(\.[a-z0-9_][a-z0-9_-]{0,62})*$")
_SCHEMES = {"http": ("http", 80), "https": ("https", 443), "ws": ("http", 80), "wss": ("https", 443)}
NAME = "Home Assistant - Mantel Link"


class PairingFailed(Exception):
    """`code`: invalid_code (wrong, spent or expired), rate_limited, not_mantel (the answer did not prove
    it came from the Mantel that made the code, at this address), wrong_address (Mantel says the address isn't its
    own), mantel_too_old (Mantel knows only protocol v1: update Mantel first), certificate (the address's
    certificate isn't a public one: pair pinned), pin_elsewhere (Mantel pins its own certificate only at its link
    address), cannot_connect."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


def normalize(text: Any) -> str | None:
    """The 20 letters, or None. Case, spaces and dashes don't matter."""
    if not isinstance(text, str) or len(text) > 64:
        return None
    raw = re.sub(r"[\s-]", "", text).upper()
    return raw if _CODE.match(raw) else None


def normalize_address(url: Any) -> str | None:
    """``scheme://host:port`` (Mantel's linked_pairing.normalize_address, the same rules), or None: http/https
    (ws/wss map to them), the host in lower case without a final dot (an IPv6 literal in brackets), the port always
    written, no path, query or user."""
    if not isinstance(url, str) or not url or len(url) > 300:
        return None
    try:
        parts = urlsplit(url.strip())
        port = parts.port
    except ValueError:
        return None
    scheme = _SCHEMES.get(parts.scheme.lower())
    host = (parts.hostname or "").rstrip(".")
    if scheme is None or not host:
        return None
    try:
        ip = ip_address(host)
    except ValueError:
        if not _HOSTNAME.match(host):
            return None
        shown = host
    else:
        shown = f"[{ip.compressed}]" if ip.version == 6 else ip.compressed
    return f"{scheme[0]}://{shown}:{port or scheme[1]}"


def _key(raw: str) -> bytes:
    return hashlib.sha256(b"mantel-link-pair-v1|key|" + raw.encode()).digest()


def _mac(key: bytes, *parts: str) -> str:
    return hmac.new(key, "|".join(parts).encode(), hashlib.sha256).hexdigest()


def pair_url(address: str) -> str:
    """Mantel's address -> its pairing URL (http(s) only; ws(s) addresses map to http(s))."""
    parts = urlsplit(str(address or "").strip())
    scheme = {"http": "http", "https": "https", "ws": "http", "wss": "https"}.get(parts.scheme.lower())
    if not scheme or not parts.hostname:
        raise ValueError("an http(s):// address with a host")
    return urlunsplit((scheme, parts.netloc, PATH, "", ""))


def _unverified() -> ssl.SSLContext:
    """v3's first contact: TLS that checks no certificate (the exchange itself proves who answered)."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _open_token(key: bytes, nonce: str, address: str, sealed: Any) -> str | None:
    """v3: the credential Mantel sealed with the code's key (Mantel's linked_pairing.seal_token), or None."""
    if not isinstance(sealed, str):
        return None
    try:
        raw = base64.urlsafe_b64decode(sealed.encode())
        k = hmac.new(key, f"mantel-link-pair-v3|token|{nonce}".encode(), hashlib.sha256).digest()
        return AESGCM(k).decrypt(raw[:12], raw[12:], address.encode()).decode()
    except Exception:  # noqa: BLE001 -- not sealed with this code: not the Mantel that made it
        return None


async def pair(session: aiohttp.ClientSession, address: str, code: str, *, name: str = NAME,
               timeout: float = 15.0, host_header: str | None = None, connect_to: str | None = None,
               pinned: bool = False) -> dict[str, Any]:
    """Trade a pairing code for {"token", "instance"} (and with `pinned`, protocol v3, "ca": Mantel's CA to pin).
    PairingFailed otherwise. `connect_to`/`host_header`: the checked internal address for a plain http App hostname
    (as the link connects)."""
    raw = normalize(code)
    if raw is None:
        raise PairingFailed("invalid_code", "That isn't a Mantel pairing code (four groups of five letters and digits).")
    where = normalize_address(address)
    if where is None:
        raise PairingFailed("cannot_connect", "not an http(s) address")
    if pinned and not where.startswith("https://"):
        raise PairingFailed("cannot_connect", "pinning needs an https address")
    v = PINNED if pinned else VERSION
    key, code_id, nonce = _key(raw), raw[:GROUP_LEN], secrets.token_hex(16)
    body = {"v": v, "code_id": code_id, "nonce": nonce, "name": name, "address": where,
            "proof": _mac(key, f"mantel-link-pair-v{v}", "client", code_id, nonce, name, where)}
    url = connect_to or pair_url(address)
    headers = {"Host": host_header} if host_header else None
    tls = {"ssl": _unverified()} if pinned else {}
    try:
        async with session.post(url, json=body, headers=headers, timeout=aiohttp.ClientTimeout(total=timeout),
                                **tls) as r:
            try:
                got = await r.json(content_type=None)
            except ValueError:
                got = None
            status = r.status
    except aiohttp.ClientConnectorCertificateError:
        # not a public certificate (Mantel's own, at its address): the caller pairs pinned instead
        raise PairingFailed("certificate", "Mantel's certificate isn't a public one") from None
    except (aiohttp.ClientError, TimeoutError, OSError) as err:
        raise PairingFailed("cannot_connect", f"could not reach Mantel ({type(err).__name__})") from None
    if status != 200 or not isinstance(got, dict):
        err = (got or {}).get("error") if isinstance(got, dict) else None
        code_ = err.get("code") if isinstance(err, dict) else None
        if status == 400 and code_ == "malformed":
            # our request is well formed: only a Mantel that knows v1 alone says this. Never retried as v1.
            raise PairingFailed("mantel_too_old", "That Mantel pairs only by protocol v1. Update Mantel first.")
        if status == 400 and code_ == "pin_elsewhere":
            raise PairingFailed("pin_elsewhere", str((err or {}).get("message") or "Use Mantel's link address."))
        if status == 403 and code_ == "wrong_address":
            raise PairingFailed("wrong_address", "Mantel says that address isn't its own.")
        if status in (403, 400) and code_ == "invalid_code":
            raise PairingFailed("invalid_code", "Mantel did not accept that pairing code.")
        if status == 429:
            raise PairingFailed("rate_limited", "Too many tries. Wait a little and try again.")
        raise PairingFailed("cannot_connect", f"Mantel answered HTTP {status}")
    instance, proof, ca = got.get("instance"), got.get("proof"), got.get("ca")
    token = _open_token(key, nonce, where, got.get("token_sealed")) if pinned else got.get("token")
    if not (got.get("v") == v and got.get("address") == where and isinstance(token, str) and token
            and isinstance(instance, str) and isinstance(proof, str)
            and (not pinned or (isinstance(ca, str) and "BEGIN CERTIFICATE" in ca))):
        raise PairingFailed("not_mantel", f"The answer was not a Mantel pairing (v{v}) for this address.")
    digest = hashlib.sha256(token.encode()).hexdigest()
    expected = (_mac(key, "mantel-link-pair-v3", "server", code_id, nonce, where, instance, digest,
                     hashlib.sha256(ca.encode()).hexdigest()) if pinned
                else _mac(key, "mantel-link-pair-v2", "server", code_id, nonce, where, instance, digest))
    if not hmac.compare_digest(expected, proof):
        raise PairingFailed("not_mantel", "The answer did not prove it came from the Mantel that made the code.")
    return {"token": token, "instance": instance, **({"ca": ca} if pinned else {})}
