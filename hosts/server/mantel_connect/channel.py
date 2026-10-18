"""Shared request authentication. No Home Assistant or Mantel credentials."""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
from pathlib import Path

USER = "X-Mantel-User"
STAMP = "X-Mantel-Time"
NONCE = "X-Mantel-Nonce"
SIGNATURE = "X-Mantel-Signature"
PATH = "/proof3"
WINDOW = 30


def read_key(path: Path) -> bytes:
    """File contains exactly a 256-bit random key encoded as hex, optionally newline-terminated."""
    key = bytes.fromhex(Path(path).read_text().strip())
    if len(key) != 32:
        raise ValueError("Connect key must contain 64 hex characters")
    return key


def user_valid(user: str) -> bool:
    return isinstance(user, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", user) is not None


def payload(user: str, stamp: str, nonce: str) -> bytes:
    return json.dumps(["mantel-connect-v1", "GET", PATH, user, stamp, nonce],
                      separators=(",", ":")).encode()


def sign(key: bytes, user: str, now: float) -> dict[str, str]:
    if not user_valid(user):
        raise ValueError("invalid HA user id")
    stamp, nonce = str(int(now)), secrets.token_hex(16)
    signature = hmac.new(key, payload(user, stamp, nonce), hashlib.sha256).hexdigest()
    return {USER: user, STAMP: stamp, NONCE: nonce, SIGNATURE: signature}


class Verifier:
    def __init__(self, key_file: Path):
        self.key_file = key_file
        read_key(key_file)  # fail at startup, never run with an empty/default secret
        self.used: dict[str, int] = {}

    def verify(self, headers, now: float) -> str:
        try:
            # Reject duplicate signed fields instead of relying on a proxy's choice of value.
            values = []
            for field in (USER, STAMP, NONCE, SIGNATURE):
                entries = headers.getall(field, [])
                if len(entries) != 1:
                    raise ValueError("missing or duplicate signed field")
                values.append(entries[0])
            user, stamp, nonce, signature = values
            if (not user_valid(user) or not re.fullmatch(r"[0-9]{1,12}", stamp)
                    or not re.fullmatch(r"[a-f0-9]{32}", nonce)
                    or not re.fullmatch(r"[a-f0-9]{64}", signature)):
                raise ValueError("invalid signed field")
            timestamp = int(stamp)
            if abs(now - timestamp) > WINDOW:
                raise ValueError("expired signature")
            expected = hmac.new(read_key(self.key_file), payload(user, stamp, nonce), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, signature):
                raise ValueError("invalid signature")
            # Retain until the signature's latest possible acceptance time, including future skew.
            self.used = {n: expiry for n, expiry in self.used.items() if expiry >= now}
            if nonce in self.used:
                raise ValueError("replayed signature")
            if len(self.used) >= 10000:
                raise ValueError("replay cache full")
            self.used[nonce] = timestamp + WINDOW
            return user
        except (OSError, ValueError) as exc:
            raise ValueError("Connect authentication failed") from exc
