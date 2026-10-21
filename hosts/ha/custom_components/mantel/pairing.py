"""Pairing by code (Mantel's linked_pairing.py is the other half; docs/phase9/MANTEL-LINK.md 9.4).

An Owner makes a one-time pairing code in Mantel Settings (Connections -> Mantel in Home Assistant). Mantel Link
trades it once, at Mantel's /linked/pair over https (plain http only inside this machine), for a Service
credential. Both sides prove they know the code (HMACs keyed from it), and Mantel Link believes the answer
only after checking Mantel's proof: a look-alike answering in Mantel's place cannot hand over a credential.

aiohttp only, no Home Assistant import. Never logs the code or the credential.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import aiohttp

VERSION = 1
PATH = "/linked/pair"
ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"      # Mantel's codes (mantel_connect/protocol.py)
GROUPS, GROUP_LEN = 4, 5
_CODE = re.compile(rf"^[{ALPHABET}]{{{GROUPS * GROUP_LEN}}}$")
NAME = "Home Assistant - Mantel Link"


class PairingFailed(Exception):
    """`code`: invalid_code (wrong, spent or expired), rate_limited, not_mantel (the answer did not prove
    it came from the Mantel that made the code), cannot_connect."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code, self.message = code, message


def normalize(text: Any) -> str | None:
    """The 20 letters, or None. Case, spaces and dashes don't matter."""
    if not isinstance(text, str) or len(text) > 64:
        return None
    raw = re.sub(r"[\s-]", "", text).upper()
    return raw if _CODE.match(raw) else None


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


async def pair(session: aiohttp.ClientSession, address: str, code: str, *, name: str = NAME,
               timeout: float = 15.0, host_header: str | None = None, connect_to: str | None = None) -> dict[str, Any]:
    """Trade a pairing code for {"token", "instance"}. PairingFailed otherwise. `connect_to`/`host_header`:
    the checked internal address for a plain http App hostname (as the link connects)."""
    raw = normalize(code)
    if raw is None:
        raise PairingFailed("invalid_code", "That isn't a Mantel pairing code (four groups of five letters and digits).")
    key, code_id, nonce = _key(raw), raw[:GROUP_LEN], secrets.token_hex(16)
    body = {"v": VERSION, "code_id": code_id, "nonce": nonce, "name": name,
            "proof": _mac(key, "mantel-link-pair-v1", "client", code_id, nonce, name)}
    url = connect_to or pair_url(address)
    headers = {"Host": host_header} if host_header else None
    try:
        async with session.post(url, json=body, headers=headers, timeout=aiohttp.ClientTimeout(total=timeout)) as r:
            try:
                got = await r.json(content_type=None)
            except ValueError:
                got = None
            status = r.status
    except (aiohttp.ClientError, TimeoutError, OSError) as err:
        raise PairingFailed("cannot_connect", f"could not reach Mantel ({type(err).__name__})") from None
    if status != 200 or not isinstance(got, dict):
        err = (got or {}).get("error") if isinstance(got, dict) else None
        code_ = err.get("code") if isinstance(err, dict) else None
        if status in (403, 400) and code_ in ("invalid_code", "malformed"):
            raise PairingFailed("invalid_code", "Mantel did not accept that pairing code.")
        if status == 429:
            raise PairingFailed("rate_limited", "Too many tries. Wait a little and try again.")
        raise PairingFailed("cannot_connect", f"Mantel answered HTTP {status}")
    token, instance, proof = got.get("token"), got.get("instance"), got.get("proof")
    if not (isinstance(token, str) and token and isinstance(instance, str) and isinstance(proof, str)):
        raise PairingFailed("not_mantel", "The answer was not a Mantel pairing.")
    expected = _mac(key, "mantel-link-pair-v1", "server", code_id, nonce, instance,
                    hashlib.sha256(token.encode()).hexdigest())
    if not hmac.compare_digest(expected, proof):
        raise PairingFailed("not_mantel", "The answer did not prove it came from the Mantel that made the code.")
    return {"token": token, "instance": instance}
