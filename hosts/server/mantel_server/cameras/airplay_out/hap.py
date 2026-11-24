"""HOMEKIT PAIRING (HAP) for an AirPlay screen: pair-setup with the code it shows, pair-verify on every connection,
and the encrypted framing after it. Pure: message bodies in, message bodies out; the connection is rtsp.py's.

Ported in part from pyatv (MIT License, Copyright (c) 2017-2025 Pierre Ståhl): auth/hap_srp.py, auth/hap_tlv8.py,
auth/hap_session.py, support/chacha20.py, protocols/airplay/auth/hap.py; srptools (MIT License, Copyright (c) 2017
Igor 'idle sign' Starikov) for SRP-6a's arithmetic. Differences: ``cryptography``'s ChaCha20Poly1305 instead of a
separate package, the screen's M4 proof and M6 signature are checked (pyatv doesn't), and no pairing name is sent.

The keys a pairing leaves (``Credentials``) are pyatv's ``ltpk:ltsk:atv_id:client_id`` hex string, so a pairing made
with pyatv's tools works here and the other way round.
"""
from __future__ import annotations

import hashlib
import os
import uuid
from dataclasses import dataclass

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

# TLV8 tags (HAP R2, 5.15)
METHOD, IDENTIFIER, SALT, PUBLIC_KEY, PROOF, ENCRYPTED, SEQ, ERROR, SIGNATURE = 0, 1, 2, 3, 4, 5, 6, 7, 10
ERRORS = {1: "unknown", 2: "wrong code", 3: "try again later", 4: "too many pairings", 5: "too many tries",
          6: "unavailable", 7: "busy"}

# SRP-6a, RFC 5054's 3072-bit group, SHA-512 (HAP's)
N = int(
    "FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DDEF9519B3CD3A431B"
    "302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7EDEE386BFB5A899FA5AE9F24117C4B1FE6"
    "49286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F83655D23DCA3AD961C62F356208552BB9ED529077096966D"
    "670C354E4ABC9804F1746C08CA18217C32905E462E36CE3BE39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF695581718"
    "3995497CEA956AE515D2261898FA051015728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB"
    "3970F85A6E1E4C7ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200CB"
    "BE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF", 16)
G = 5
N_BYTES = (N.bit_length() + 7) // 8


class PairingError(Exception):
    """The screen refused (``code``: its TLV error, 2 a wrong code) or answered something that isn't a pairing."""

    def __init__(self, message: str, code: int | None = None) -> None:
        super().__init__(message)
        self.code = code


# -- TLV8 ---------------------------------------------------------------------------------------------------
def write_tlv(items: list[tuple[int, bytes]]) -> bytes:
    out = bytearray()
    for tag, value in items:
        if not value:
            out += bytes([tag, 0])
        for i in range(0, len(value), 255):            # a value over 255 bytes is split, the same tag again
            chunk = value[i:i + 255]
            out += bytes([tag, len(chunk)]) + chunk
    return bytes(out)


def read_tlv(data: bytes) -> dict[int, bytes]:
    out: dict[int, bytes] = {}
    pos = 0
    while pos + 2 <= len(data):
        tag, length = data[pos], data[pos + 1]
        value = data[pos + 2:pos + 2 + length]
        out[tag] = out[tag] + value if tag in out else value      # a long value comes as the same tag again
        pos += 2 + length
    return out


def _refused(tlv: dict[int, bytes]) -> None:
    if ERROR in tlv:
        code = tlv[ERROR][0] if tlv[ERROR] else 1
        raise PairingError(f"the screen refused the pairing: {ERRORS.get(code, code)}", code)


# -- keys and ciphers ---------------------------------------------------------------------------------------
def hkdf(salt: str, info: str, secret: bytes) -> bytes:
    return HKDF(algorithm=hashes.SHA512(), length=32, salt=salt.encode(), info=info.encode()).derive(secret)


def _nonce(n: int | bytes) -> bytes:
    """A 12-byte nonce: 4 zero bytes and an 8-byte little-endian counter, or a fixed 8-byte label ("PV-Msg02")."""
    return b"\x00" * 4 + (n.to_bytes(8, "little") if isinstance(n, int) else n.rjust(8, b"\x00"))


def seal(key: bytes, label: bytes, data: bytes) -> bytes:
    return ChaCha20Poly1305(key).encrypt(_nonce(label), data, None)


def unseal(key: bytes, label: bytes, data: bytes) -> bytes:
    try:
        return ChaCha20Poly1305(key).decrypt(_nonce(label), data, None)
    except InvalidTag as exc:
        raise PairingError("the screen's answer didn't decrypt") from exc


def _raw_public(key) -> bytes:
    return key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)


def _raw_private(key) -> bytes:
    return key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw, serialization.NoEncryption())


class Framing:
    """HAP's encrypted framing (HAP R2, 6.5.2): blocks of up to 1024 bytes, each its 2-byte little-endian length (the
    additional data) and its sealed bytes; a counter nonce each way. ``decrypt`` keeps a partial block for the next."""

    FRAME = 1024
    TAG = 16

    def __init__(self, out_key: bytes, in_key: bytes) -> None:
        self._out, self._in = ChaCha20Poly1305(out_key), ChaCha20Poly1305(in_key)
        self._out_n = self._in_n = 0
        self._pending = b""

    def encrypt(self, data: bytes) -> bytes:
        out = bytearray()
        for i in range(0, len(data), self.FRAME):
            block = data[i:i + self.FRAME]
            length = len(block).to_bytes(2, "little")
            out += length + self._out.encrypt(_nonce(self._out_n), block, length)
            self._out_n += 1
        return bytes(out)

    def decrypt(self, data: bytes) -> bytes:
        self._pending += data
        out = bytearray()
        while len(self._pending) >= 2:
            size = int.from_bytes(self._pending[:2], "little") + self.TAG
            if len(self._pending) < 2 + size:
                break
            block, length = self._pending[2:2 + size], self._pending[:2]
            try:
                out += self._in.decrypt(_nonce(self._in_n), block, length)
            except InvalidTag as exc:
                raise PairingError("a frame from the screen didn't decrypt") from exc
            self._in_n += 1
            self._pending = self._pending[2 + size:]
        return bytes(out)


@dataclass(frozen=True)
class Credentials:
    """A pairing: the screen's long-term public key and identifier, Mantel's long-term key pair seed and identifier."""
    ltpk: bytes            # the screen's Ed25519 public key
    ltsk: bytes            # Mantel's Ed25519 seed for this screen
    atv_id: bytes          # the screen's pairing identifier (what it signs pair-verify with)
    client_id: bytes       # Mantel's pairing identifier with it

    def dumps(self) -> str:
        return ":".join(v.hex() for v in (self.ltpk, self.ltsk, self.atv_id, self.client_id))

    @classmethod
    def loads(cls, text: str) -> "Credentials":
        parts = text.strip().split(":")
        if len(parts) != 4:
            raise ValueError("a pairing is four hex fields")
        ltpk, ltsk, atv_id, client_id = (bytes.fromhex(p) for p in parts)
        if len(ltpk) != 32 or len(ltsk) != 32 or not atv_id or not client_id:
            raise ValueError("not a pairing")
        return cls(ltpk, ltsk, atv_id, client_id)


# -- SRP-6a (client side) -----------------------------------------------------------------------------------
def _H(*parts: bytes | int) -> bytes:
    h = hashlib.sha512()
    for p in parts:
        h.update(p if isinstance(p, bytes) else p.to_bytes((p.bit_length() + 7) // 8 or 1, "big"))
    return h.digest()


def _i(b: bytes) -> int:
    return int.from_bytes(b, "big")


def _pad(v: int) -> bytes:
    return v.to_bytes(N_BYTES, "big")


K_MULT = _i(_H(N, _pad(G)))                              # k = H(N | PAD(g))


class PairSetup:
    """Pair-setup's client side (HAP R2, 5.6), step by step: ``m1()`` -> the screen's M2 -> ``m3(m2, code)`` -> its
    M4 -> ``m5(m4)`` -> its M6 -> ``finish(m6)`` -> Credentials. ``a`` and the keys may be given (tests)."""

    def __init__(self, a: int | None = None, seed: bytes | None = None, client_id: bytes | None = None) -> None:
        self._sign = Ed25519PrivateKey.from_private_bytes(seed or os.urandom(32))
        self.client_id = client_id or str(uuid.uuid4()).upper().encode()
        self._a = a if a is not None else _i(os.urandom(32))
        self._A = pow(G, self._a, N)
        self._K = self._M1 = b""

    @staticmethod
    def m1() -> bytes:
        return write_tlv([(METHOD, b"\x00"), (SEQ, b"\x01")])

    def m3(self, m2: bytes, code: str) -> bytes:
        tlv = read_tlv(m2)
        _refused(tlv)
        if SALT not in tlv or PUBLIC_KEY not in tlv:
            raise PairingError("the screen's pairing answer has no salt or key")
        # srptools' conventions, which pyatv pairs Apple's devices with: integers hashed as their shortest bytes,
        # only u's A and B padded to N's length
        salt, B = _i(tlv[SALT]), _i(tlv[PUBLIC_KEY])
        if B % N == 0:
            raise PairingError("the screen's key is invalid")
        u = _i(_H(_pad(self._A), _pad(B)))
        x = _i(_H(salt, _H(b"Pair-Setup:" + str(code).encode())))
        S = pow((B - K_MULT * pow(G, x, N)) % N, self._a + u * x, N)
        self._K = _H(S)
        self._M1 = _H(_i(_H(N)) ^ _i(_H(G)), _i(_H(b"Pair-Setup")), salt, self._A, B, self._K)
        return write_tlv([(SEQ, b"\x03"), (PUBLIC_KEY, self._A.to_bytes(N_BYTES, "big").lstrip(b"\x00")),
                          (PROOF, self._M1)])

    def m5(self, m4: bytes) -> bytes:
        tlv = read_tlv(m4)
        _refused(tlv)
        if PROOF in tlv and tlv[PROOF] != _H(self._A, self._M1, self._K):
            raise PairingError("the screen's proof doesn't match: a wrong code", 2)
        x = hkdf("Pair-Setup-Controller-Sign-Salt", "Pair-Setup-Controller-Sign-Info", self._K)
        public = _raw_public(self._sign)
        signature = self._sign.sign(x + self.client_id + public)
        inner = write_tlv([(IDENTIFIER, self.client_id), (PUBLIC_KEY, public), (SIGNATURE, signature)])
        return write_tlv([(SEQ, b"\x05"), (ENCRYPTED, seal(self._session_key(), b"PS-Msg05", inner))])

    def finish(self, m6: bytes) -> Credentials:
        tlv = read_tlv(m6)
        _refused(tlv)
        inner = read_tlv(unseal(self._session_key(), b"PS-Msg06", tlv.get(ENCRYPTED, b"")))
        atv_id, ltpk, signature = inner.get(IDENTIFIER), inner.get(PUBLIC_KEY), inner.get(SIGNATURE)
        if not atv_id or not ltpk or len(ltpk) != 32 or not signature:
            raise PairingError("the screen's pairing answer is incomplete")
        x = hkdf("Pair-Setup-Accessory-Sign-Salt", "Pair-Setup-Accessory-Sign-Info", self._K)
        try:
            Ed25519PublicKey.from_public_bytes(ltpk).verify(signature, x + atv_id + ltpk)
        except InvalidSignature as exc:
            raise PairingError("the screen's pairing signature is wrong") from exc
        return Credentials(ltpk, _raw_private(self._sign), atv_id, self.client_id)

    def _session_key(self) -> bytes:
        return hkdf("Pair-Setup-Encrypt-Salt", "Pair-Setup-Encrypt-Info", self._K)


class PairVerify:
    """Pair-verify's client side (HAP R2, 5.7): ``m1()`` -> the screen's M2 -> ``m3(m2)`` (checks it is the screen
    paired) -> its M4 -> ``keys(salt, out_info, in_info)`` for each channel."""

    def __init__(self, creds: Credentials, ephemeral: bytes | None = None) -> None:
        self.creds = creds
        self._eph = X25519PrivateKey.from_private_bytes(ephemeral or os.urandom(32))
        self._public = _raw_public(self._eph)
        self._shared = b""

    def m1(self) -> bytes:
        return write_tlv([(SEQ, b"\x01"), (PUBLIC_KEY, self._public)])

    def m3(self, m2: bytes) -> bytes:
        tlv = read_tlv(m2)
        _refused(tlv)
        theirs = tlv.get(PUBLIC_KEY, b"")
        if len(theirs) != 32:
            raise PairingError("the screen's verify answer has no key")
        self._shared = self._eph.exchange(X25519PublicKey.from_public_bytes(theirs))
        key = hkdf("Pair-Verify-Encrypt-Salt", "Pair-Verify-Encrypt-Info", self._shared)
        inner = read_tlv(unseal(key, b"PV-Msg02", tlv.get(ENCRYPTED, b"")))
        if inner.get(IDENTIFIER) != self.creds.atv_id:
            raise PairingError("a different screen answered (its identifier isn't the paired one)")
        try:
            Ed25519PublicKey.from_public_bytes(self.creds.ltpk).verify(
                inner.get(SIGNATURE, b""), theirs + self.creds.atv_id + self._public)
        except InvalidSignature as exc:
            raise PairingError("the screen's verify signature is wrong (paired again elsewhere?)") from exc
        sign = Ed25519PrivateKey.from_private_bytes(self.creds.ltsk)
        mine = sign.sign(self._public + self.creds.client_id + theirs)
        sealed = seal(key, b"PV-Msg03", write_tlv([(IDENTIFIER, self.creds.client_id), (SIGNATURE, mine)]))
        return write_tlv([(SEQ, b"\x03"), (ENCRYPTED, sealed)])

    @staticmethod
    def done(m4: bytes) -> None:
        _refused(read_tlv(m4))

    def keys(self, salt: str, out_info: str, in_info: str) -> tuple[bytes, bytes]:
        return hkdf(salt, out_info, self._shared), hkdf(salt, in_info, self._shared)
