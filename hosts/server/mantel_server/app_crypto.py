"""The cryptography the phone and Mac apps and Web Push share (docs/phase10/APPLE-APPS.md §3, §5).

All of it is P-256 (the Secure Enclave's only curve, and Web Push's), built on ``cryptography``:

* **Key files**: :func:`load_or_create_ec_key` keeps a private key as a PEM secret file (folder 0700, file
  0600; a read-only mounted secret is read as is). Used for the VAPID key (Web Push) and the server's
  identity key (the pairing QR's fingerprint, ``/api/app/hello``).
* **ES256 JWTs**: :func:`es256_jwt` signs one (VAPID, APNs' provider token); :func:`verify_es256_jwt` checks one
  against a public JWK (the apps' DPoP proofs).
* **JWK thumbprints** (RFC 7638) for binding a credential to a device key.
* **Web Push message encryption** (RFC 8291, ``aes128gcm`` of RFC 8188): :func:`webpush_encrypt`, and its
  inverse :func:`webpush_decrypt` for the tests (a browser does that part).
* **Sealed notifications for the apps** (ECIES: ephemeral ECDH + HKDF-SHA256 + AES-256-GCM),
  :func:`seal_for_device`; the Notification Service Extension opens them with CryptoKit (MantelKit's
  ``SealedBox``), so APNs (and any relay) sees ciphertext only.

Nothing here logs or stores a secret; the callers keep only public halves and hashes.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import struct
import time
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

CURVE = ec.SECP256R1()


# -- encodings ------------------------------------------------------------------------------------
def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64u(text: str) -> bytes:
    if not isinstance(text, str):
        raise ValueError("not base64url text")
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def raw_public(key: ec.EllipticCurvePublicKey) -> bytes:
    """The uncompressed point (65 bytes: 0x04 || x || y), as Web Push and CryptoKit's x963 use it."""
    return key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def public_from_raw(data: bytes) -> ec.EllipticCurvePublicKey:
    if len(data) != 65 or data[0] != 4:
        raise ValueError("a P-256 public key is 65 bytes, uncompressed")
    return ec.EllipticCurvePublicKey.from_encoded_point(CURVE, data)


# -- key files ------------------------------------------------------------------------------------
def load_or_create_ec_key(path: Path) -> ec.EllipticCurvePrivateKey:
    """A P-256 private key from a PEM file, made (0600, folder 0700) the first time it is wanted."""
    path = Path(path).expanduser()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(path.parent, 0o700)
        except OSError:
            pass
        key = ec.generate_private_key(CURVE)
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption())
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(pem)
    key = serialization.load_pem_private_key(path.read_bytes(), password=None)
    if not isinstance(key, ec.EllipticCurvePrivateKey) or not isinstance(key.curve, ec.SECP256R1):
        raise ValueError(f"{path} must hold a P-256 private key")
    return key


def fingerprint(key: ec.EllipticCurvePublicKey) -> str:
    """SHA-256 of the key's SubjectPublicKeyInfo, base64url: what the pairing QR carries and the app pins."""
    spki = key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return b64u(hashlib.sha256(spki).digest())


def short_code(fp: str) -> str:
    """Six digits from a fingerprint, to compare by eye on both screens ("123 456")."""
    n = int.from_bytes(hashlib.sha256(fp.encode()).digest()[:4], "big") % 1_000_000
    return f"{n:06d}"[:3] + " " + f"{n:06d}"[3:]


# -- JWK ------------------------------------------------------------------------------------------
def jwk_of(key: ec.EllipticCurvePublicKey) -> dict[str, str]:
    nums = key.public_numbers()
    return {"kty": "EC", "crv": "P-256", "x": b64u(nums.x.to_bytes(32, "big")), "y": b64u(nums.y.to_bytes(32, "big"))}


def key_of_jwk(jwk: Any) -> ec.EllipticCurvePublicKey:
    if not isinstance(jwk, dict) or jwk.get("kty") != "EC" or jwk.get("crv") != "P-256":
        raise ValueError("a P-256 EC JWK is required")
    if set(jwk) - {"kty", "crv", "x", "y", "use", "kid", "alg"}:
        raise ValueError("a public JWK only")              # never a private "d"
    x, y = unb64u(jwk.get("x", "")), unb64u(jwk.get("y", ""))
    if len(x) != 32 or len(y) != 32:
        raise ValueError("bad P-256 coordinates")
    return public_from_raw(b"\x04" + x + y)


def thumbprint(jwk: dict[str, Any]) -> str:
    """RFC 7638: SHA-256 over the required members in lexicographic order, base64url."""
    key_of_jwk(jwk)   # validates
    canon = json.dumps({"crv": jwk["crv"], "kty": jwk["kty"], "x": jwk["x"], "y": jwk["y"]},
                       separators=(",", ":"), sort_keys=True)
    return b64u(hashlib.sha256(canon.encode()).digest())


# -- ES256 JWTs -----------------------------------------------------------------------------------
def es256_sign(key: ec.EllipticCurvePrivateKey, data: bytes) -> bytes:
    r, s = decode_dss_signature(key.sign(data, ec.ECDSA(hashes.SHA256())))
    return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def es256_verify(key: ec.EllipticCurvePublicKey, data: bytes, sig: bytes) -> bool:
    if len(sig) != 64:
        return False
    der = encode_dss_signature(int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big"))
    try:
        key.verify(der, data, ec.ECDSA(hashes.SHA256()))
        return True
    except InvalidSignature:
        return False


def es256_jwt(key: ec.EllipticCurvePrivateKey, claims: dict[str, Any], header: dict[str, Any] | None = None) -> str:
    head = {k: v for k, v in {"typ": "JWT", "alg": "ES256", **(header or {})}.items() if v is not None}
    signing = (b64u(json.dumps(head, separators=(",", ":")).encode()) + "." +
               b64u(json.dumps(claims, separators=(",", ":")).encode()))
    return signing + "." + b64u(es256_sign(key, signing.encode()))


def split_jwt(token: str) -> tuple[dict, dict, bytes, bytes]:
    """(header, claims, signing input, signature) of a compact JWS; ValueError when it is not one."""
    if not isinstance(token, str) or token.count(".") != 2 or len(token) > 8192:
        raise ValueError("not a compact JWS")
    h, c, s = token.split(".")
    header, claims = json.loads(unb64u(h)), json.loads(unb64u(c))
    if not isinstance(header, dict) or not isinstance(claims, dict):
        raise ValueError("not a JWS")
    return header, claims, f"{h}.{c}".encode(), unb64u(s)


def verify_es256_jwt(token: str, key: ec.EllipticCurvePublicKey) -> dict[str, Any]:
    header, claims, signing, sig = split_jwt(token)
    if header.get("alg") != "ES256" or not es256_verify(key, signing, sig):
        raise ValueError("bad signature")
    return claims


# -- Web Push (RFC 8291, aes128gcm) ---------------------------------------------------------------
RECORD_SIZE = 4096


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def webpush_encrypt(plaintext: bytes, ua_public: bytes, auth_secret: bytes, *, salt: bytes | None = None,
                    sender: ec.EllipticCurvePrivateKey | None = None) -> bytes:
    """The body of one Web Push message for the subscription (``p256dh``, ``auth``)."""
    if len(auth_secret) != 16:
        raise ValueError("the auth secret is 16 bytes")
    if len(plaintext) > RECORD_SIZE - 16 - 1 - 86:
        raise ValueError("too long for one Web Push record")
    ua_key = public_from_raw(ua_public)
    sender = sender or ec.generate_private_key(CURVE)
    as_public = raw_public(sender.public_key())
    shared = sender.exchange(ec.ECDH(), ua_key)
    ikm = _hkdf(auth_secret, shared, b"WebPush: info\x00" + ua_public + as_public, 32)
    salt = salt or secrets.token_bytes(16)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    body = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)     # one record, the last: delimiter 2
    return salt + struct.pack("!IB", RECORD_SIZE, len(as_public)) + as_public + body


def webpush_decrypt(body: bytes, ua_private: ec.EllipticCurvePrivateKey, auth_secret: bytes) -> bytes:
    """What a browser does with :func:`webpush_encrypt`'s output (for the tests)."""
    salt, (rs, idlen) = body[:16], struct.unpack("!IB", body[16:21])
    as_public = body[21:21 + idlen]
    ua_public = raw_public(ua_private.public_key())
    shared = ua_private.exchange(ec.ECDH(), public_from_raw(as_public))
    ikm = _hkdf(auth_secret, shared, b"WebPush: info\x00" + ua_public + as_public, 32)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    plain = AESGCM(cek).decrypt(nonce, body[21 + idlen:], None)
    return plain.rstrip(b"\x00")[:-1]


def vapid_header(key: ec.EllipticCurvePrivateKey, endpoint_origin: str, subject: str,
                 now: float | None = None, ttl: int = 12 * 3600) -> str:
    """``Authorization: vapid t=..., k=...`` (RFC 8292) for one push service origin."""
    claims = {"aud": endpoint_origin, "exp": int((now or time.time()) + ttl), "sub": subject}
    return f"vapid t={es256_jwt(key, claims)}, k={b64u(raw_public(key.public_key()))}"


# -- sealed notifications for the apps ------------------------------------------------------------
SEAL_INFO = b"mantel push v1"


def seal_for_device(plaintext: bytes, device_public: bytes) -> dict[str, str]:
    """ECIES to the phone's push key (x963, 65 bytes): an ephemeral P-256 key, ECDH, HKDF-SHA256 (salt: the
    ephemeral key, info: SEAL_INFO) to a 32-byte key, AES-256-GCM. CryptoKit's ``AES.GCM.SealedBox(combined:)``
    opens ``nonce || ciphertext || tag``."""
    recipient = public_from_raw(device_public)
    eph = ec.generate_private_key(CURVE)
    eph_raw = raw_public(eph.public_key())
    shared = eph.exchange(ec.ECDH(), recipient)
    key = _hkdf(eph_raw, shared, SEAL_INFO, 32)
    nonce = secrets.token_bytes(12)
    return {"v": "1", "epk": b64u(eph_raw), "box": b64u(nonce + AESGCM(key).encrypt(nonce, plaintext, None))}


def open_sealed(sealed: dict[str, str], device_private: ec.EllipticCurvePrivateKey) -> bytes:
    """The phone's half of :func:`seal_for_device` (for the tests; MantelKit has the Swift one)."""
    eph_raw = unb64u(sealed["epk"])
    shared = device_private.exchange(ec.ECDH(), public_from_raw(eph_raw))
    key = _hkdf(eph_raw, shared, SEAL_INFO, 32)
    box = unb64u(sealed["box"])
    return AESGCM(key).decrypt(box[:12], box[12:], None)

