"""Mantel Connect pairing protocol, shared by both ends (stdlib only; no secret is ever logged here).

An Owner starts pairing on Mantel Server and gets a one-time CODE. The Connect App is given Mantel's
address and the code and runs ONE exchange over TLS with Mantel's Connect listener:

  1. The App keeps a fresh private key to itself and sends only the matching PUBLIC key, a random nonce
     and a PROOF: an HMAC, keyed from the code, over the public key's hash, the nonce and the
     fingerprint of the TLS certificate the App actually saw. Mantel recomputes it from the code it
     issued and the certificate it really serves; a man in the middle (who has another certificate and
     does not know the code) cannot make the two agree.
  2. Mantel signs a client certificate for that public key with its own Connect CA and answers with the
     CA certificate, the client certificate and its own proof (an HMAC over both certificates, the nonce
     and the same fingerprint). The App checks it before it believes anything: that is Mantel proving it
     knows the code, i.e. the pairing is mutually authenticated.
  3. From then on every request is mutual TLS: the App presents its certificate, Mantel pins the
     fingerprints of the certificates it issued (revocation = forgetting one), the App trusts only
     Mantel's CA. The code is spent; it opens nothing else.

The code is 20 characters from a 30-letter alphabet (about 98 bits) written in four groups. The first
group is a public id (it selects the pending code; 24 bits stay public), the remaining 74 bits are the
key. It is only valid for a few minutes, once, and a few wrong proofs burn it.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets

VERSION = 1
ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"        # no 0/1/I/L/O/U: nothing to misread when copying
GROUPS, GROUP_LEN = 4, 5
PAIR_PATH = "/connect/v1/pair"
RENEW_PATH = "/connect/v1/renew"
PING_PATH = "/connect/v1/ping"
DEFAULT_PORT = 8766
CODE_TTL = 600.0                                   # ten minutes
MAX_BODY = 8192
_CODE_RE = re.compile(rf"^[{ALPHABET}]{{{GROUPS * GROUP_LEN}}}$")
NAME_RE = re.compile(r"^[A-Za-z0-9][\w .:@()-]{0,63}$")
NONCE_RE = re.compile(r"^[0-9a-f]{32}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def new_code() -> str:
    raw = "".join(secrets.choice(ALPHABET) for _ in range(GROUPS * GROUP_LEN))
    return format_code(raw)


def format_code(raw: str) -> str:
    return "-".join(raw[i:i + GROUP_LEN] for i in range(0, GROUPS * GROUP_LEN, GROUP_LEN))


def normalize_code(text) -> str | None:
    """The 20 letters, or None when the text is not a code. Case, spaces and dashes do not matter."""
    if not isinstance(text, str) or len(text) > 64:
        return None
    raw = re.sub(r"[\s-]", "", text).upper()
    return raw if _CODE_RE.match(raw) else None


def code_id(raw: str) -> str:
    """The public id: the first group (sent in the clear to pick the pending code)."""
    return raw[:GROUP_LEN]


def code_key(raw: str) -> bytes:
    """The MAC key. Mantel stores THIS (not the code) until the code is spent or expires."""
    return hashlib.sha256(b"mantel-connect-pair-v1|key|" + raw.encode()).digest()


def fingerprint(der: bytes) -> str:
    return hashlib.sha256(der).hexdigest()


def _mac(key: bytes, *parts: str) -> str:
    return hmac.new(key, "|".join(parts).encode(), hashlib.sha256).hexdigest()


def client_proof(key: bytes, pair_id: str, nonce: str, public_key_sha: str, server_fp: str, name: str) -> str:
    return _mac(key, "mantel-connect-pair-v1", "client", pair_id, nonce, public_key_sha, server_fp, name)


def server_proof(key: bytes, pair_id: str, nonce: str, server_fp: str, ca_fp: str, client_fp: str,
                 pairing_id: str) -> str:
    return _mac(key, "mantel-connect-pair-v1", "server", pair_id, nonce, server_fp, ca_fp, client_fp, pairing_id)


def equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


# -- the address the App is given ------------------------------------------------------------------------
_HOST_RE = re.compile(r"^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*"
                      r"|\[[0-9A-Fa-f:.]{2,45}\])$")


def parse_address(text) -> tuple[str, int]:
    """'mantel.lan', 'mantel.lan:8766', 'https://192.0.2.5:8766/' -> (host, port). No path, query,
    credentials or other scheme: the App connects to exactly one host and port."""
    if not isinstance(text, str):
        raise ValueError("the Mantel address is missing")
    s = text.strip()
    if s.lower().startswith("https://"):
        s = s[8:]
    if s.endswith("/"):
        s = s[:-1]
    if not s or any(c in s for c in "/?#@ \t\\") or "://" in s:
        raise ValueError("the Mantel address is a host name or IP address with an optional port, like mantel.lan:8766")
    host, port, port_text = s, DEFAULT_PORT, ""
    if s.startswith("["):
        end = s.find("]")
        host, rest = s[:end + 1], s[end + 1:]
        if rest:
            if not rest.startswith(":"):
                raise ValueError("bad Mantel address")
            port_text = rest[1:]
    elif s.count(":") == 1:
        host, port_text = s.split(":")
    if port_text:
        if not port_text.isdigit() or not 1 <= int(port_text) <= 65535:
            raise ValueError("bad port in the Mantel address")
        port = int(port_text)
    if not _HOST_RE.match(host):
        raise ValueError("bad host in the Mantel address")
    return host, port


def origin_of(host: str, port: int) -> str:
    return f"https://{host}:{port}"
