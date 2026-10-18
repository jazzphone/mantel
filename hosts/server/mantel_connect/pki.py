"""Keys and certificates for Mantel Connect (both ends). Needs ``cryptography``; holds no state."""
from __future__ import annotations

import os
import ssl
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

from .protocol import fingerprint


def new_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def private_pem(key) -> bytes:
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())


def public_pem(key) -> str:
    return key.public_key().public_bytes(serialization.Encoding.PEM,
                                         serialization.PublicFormat.SubjectPublicKeyInfo).decode()


def load_public(pem: str):
    """A P-256 public key from PEM; anything else (RSA, other curves, junk, a private key) is refused."""
    if not isinstance(pem, str) or len(pem) > 1024 or "PRIVATE" in pem:
        raise ValueError("not a public key")
    try:
        key = serialization.load_pem_public_key(pem.encode())
    except (ValueError, TypeError) as exc:
        raise ValueError("not a public key") from exc
    if not isinstance(key, ec.EllipticCurvePublicKey) or not isinstance(key.curve, ec.SECP256R1):
        raise ValueError("the public key must be an EC P-256 key")
    return key


def public_der(key) -> bytes:
    return key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)


def public_sha(pem: str) -> str:
    return fingerprint(public_der(load_public(pem)))


def load_cert(pem: str | bytes) -> x509.Certificate:
    data = pem.encode() if isinstance(pem, str) else pem
    return x509.load_pem_x509_certificate(data)


def cert_pem(cert: x509.Certificate) -> str:
    return cert.public_bytes(serialization.Encoding.PEM).decode()


def cert_der(cert: x509.Certificate) -> bytes:
    return cert.public_bytes(serialization.Encoding.DER)


def cert_fp(pem_or_cert) -> str:
    cert = pem_or_cert if isinstance(pem_or_cert, x509.Certificate) else load_cert(pem_or_cert)
    return fingerprint(cert_der(cert))


def not_after(cert: x509.Certificate) -> float:
    return cert.not_valid_after_utc.timestamp()


def utc(ts: float) -> datetime:
    return datetime.fromtimestamp(ts, timezone.utc)


def write_private(path: Path, data: bytes | str) -> None:
    """Atomic write of a file only its owner can read (the mode is set before any byte goes in)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(data.encode() if isinstance(data, str) else data)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def client_context(ca_pem: str | bytes, cert_file: Path, key_file: Path) -> ssl.SSLContext:
    """The App's side of mutual TLS: trust ONLY Mantel's Connect CA, present the paired certificate.
    The host name is not checked (the address may be an IP or a Docker name); the CA is private to this
    Mantel, so only this Mantel holds a certificate it will accept."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_REQUIRED
    ctx.load_verify_locations(cadata=ca_pem if isinstance(ca_pem, str) else ca_pem.decode())
    ctx.load_cert_chain(str(cert_file), str(key_file))
    return ctx


def unverified_context() -> ssl.SSLContext:
    """ONLY for the pairing exchange, where trust comes from the code's proofs, never from TLS."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx
