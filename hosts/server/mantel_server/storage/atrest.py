"""Secrets at rest: AES-256-GCM with a key read from a secret file (PLAN §7 "Secrets").

The key file is ``<secrets_dir>/at_rest.key`` (base64url of 32 random bytes). It is read the first
time something is sealed or opened, and created (folder 0700, file 0600) if it does not exist yet;
under Docker it is a read-only secret mounted there. The key never goes to the database or a log.

Each value is sealed with associated data naming where it belongs (for example ``totp:<user id>``),
so a ciphertext copied onto another row does not open.
"""
from __future__ import annotations

import base64
import os
import secrets
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

KEY_FILE = "at_rest.key"
VERSION = b"\x01"


class SecretKeyError(Exception):
    pass


def ensure_dir(path: Path) -> Path:
    path = Path(path).expanduser()
    path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass  # a read-only secrets mount: its owner set the mode
    return path


def load_or_create_key(path: Path) -> bytes:
    path = Path(path).expanduser()
    if not path.exists():
        ensure_dir(path.parent)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode() + "\n")
    try:
        key = base64.urlsafe_b64decode(path.read_text().strip())
    except (ValueError, OSError) as exc:
        raise SecretKeyError(f"could not read the at-rest key file {path}") from exc
    if len(key) != 32:
        raise SecretKeyError(f"the at-rest key file {path} must hold 32 bytes (base64url)")
    return key


class SecretBox:
    def __init__(self, key_file: Path | None = None, key: bytes | None = None) -> None:
        self.key_file = Path(key_file).expanduser() if key_file else None
        self._aead = AESGCM(key) if key is not None else None

    def _box(self) -> AESGCM:
        if self._aead is None:
            if self.key_file is None:
                raise SecretKeyError("no at-rest key configured")
            self._aead = AESGCM(load_or_create_key(self.key_file))
        return self._aead

    def seal(self, plaintext: bytes, aad: str) -> bytes:
        nonce = secrets.token_bytes(12)
        return VERSION + nonce + self._box().encrypt(nonce, plaintext, aad.encode())

    def open(self, sealed: bytes, aad: str) -> bytes:
        if not sealed or sealed[:1] != VERSION:
            raise SecretKeyError("unknown sealed-value format")
        return self._box().decrypt(sealed[1:13], sealed[13:], aad.encode())
