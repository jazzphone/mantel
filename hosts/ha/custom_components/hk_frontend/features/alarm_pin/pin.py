"""The PIN is never stored, only a salted PBKDF2-SHA256 hash of it."""
from __future__ import annotations

from collections.abc import Mapping
import hashlib
import hmac
import secrets
from typing import Any

ITERATIONS = 200_000
MIN_LENGTH = 4


def hash_pin(pin: str, salt: str | None = None) -> dict[str, Any]:
    """{salt, hash, iterations, numeric} for a PIN. Blocking: run it in the
    executor."""
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), ITERATIONS)
    return {"salt": salt, "hash": digest.hex(), "iterations": ITERATIONS,
            "numeric": pin.isdigit()}


def check_pin(pin: str | None, stored: Mapping[str, Any]) -> bool:
    """Is `pin` the stored one? Blocking; a constant-time compare."""
    if not pin or not stored.get("hash") or not stored.get("salt"):
        return False
    digest = hashlib.pbkdf2_hmac("sha256", str(pin).encode(), bytes.fromhex(stored["salt"]),
                                 int(stored.get("iterations") or ITERATIONS))
    return hmac.compare_digest(digest.hex(), stored["hash"])
