"""The Connect App's side of pairing and renewal (protocol.py explains the exchange).

Everything the App learns is kept as files in its own data folder, mode 0600, never in the environment
and never in a log: ``client.key`` (its private key, which never leaves), ``client.crt`` (Mantel's CA
signed it), ``ca.crt`` (the only authority the App will talk to), ``pairing.json`` (address, pairing id,
the hash of the code that made it) and ``attempt.json`` (the hash of the last code tried, so a restart
loop does not keep spending a bad code). ``pairing.json`` is written last: its presence means the other
three belong together.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import secrets
import ssl
import time
from pathlib import Path

import aiohttp

from . import pki, protocol

log = logging.getLogger("mantel.connect.app")

NAME = "Mantel Connect (Home Assistant)"
RENEW_BEFORE = 30 * 86400.0


class PairError(Exception):
    """Pairing failed; the message is safe to show on the status page (no code, no certificate)."""


def code_sha(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


class Files:
    def __init__(self, folder: Path) -> None:
        self.dir = Path(folder)

    ca = property(lambda self: self.dir / "ca.crt")
    cert = property(lambda self: self.dir / "client.crt")
    key = property(lambda self: self.dir / "client.key")
    info = property(lambda self: self.dir / "pairing.json")
    attempt = property(lambda self: self.dir / "attempt.json")

    def read_info(self) -> dict | None:
        try:
            data = json.loads(self.info.read_text())
            return data if isinstance(data, dict) else None
        except (OSError, ValueError):
            return None

    def paired(self) -> dict | None:
        """The pairing record when the folder holds a usable pairing, else None."""
        info = self.read_info()
        if info is None or not all(p.is_file() for p in (self.ca, self.cert, self.key)):
            return None
        try:
            pki.client_context(self.ca.read_text(), self.cert, self.key)
        except (ssl.SSLError, OSError, ValueError):
            return None
        return info

    def cert_expires(self) -> float | None:
        try:
            return pki.not_after(pki.load_cert(self.cert.read_bytes()))
        except (OSError, ValueError):
            return None

    def write(self, ca_pem: str, cert_pem: str, key_pem: bytes | None, info: dict | None) -> None:
        pki.write_private(self.ca, ca_pem)
        if key_pem is not None:
            pki.write_private(self.key, key_pem)
        pki.write_private(self.cert, cert_pem)
        if info is not None:
            pki.write_private(self.info, json.dumps(info))

    def tried(self) -> str | None:
        try:
            return json.loads(self.attempt.read_text()).get("code_sha")
        except (OSError, ValueError, AttributeError):
            return None

    def remember_attempt(self, sha: str) -> None:
        pki.write_private(self.attempt, json.dumps({"code_sha": sha}))


async def _exchange(host: str, port: int, make_body, timeout: float = 20) -> tuple[int, bytes, str]:
    """ONE TLS connection that is never trusted for its own sake: the certificate Mantel presents on it is
    fingerprinted before a byte is sent, and the request's proof is made over that fingerprint, so the
    answer can only be one from whoever holds both that certificate's key and the code. Returns
    (status, body, fingerprint). Minimal HTTP/1.1, Connection: close: nothing to pool or redirect."""
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host.strip("[]"), port, ssl=pki.unverified_context()), timeout)
    except (OSError, asyncio.TimeoutError, ssl.SSLError) as exc:
        raise PairError("Could not reach Mantel at the address in the configuration. Is it running with Connect on, "
                        "and is the port open from Home Assistant?") from exc
    try:
        der = writer.get_extra_info("ssl_object").getpeercert(binary_form=True)
        if not der:
            raise PairError("Mantel did not present a certificate.")
        fp = protocol.fingerprint(der)
        payload = json.dumps(make_body(fp)).encode()
        head = (f"POST {protocol.PAIR_PATH} HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Type: application/json\r\n"
                f"Content-Length: {len(payload)}\r\nConnection: close\r\n\r\n").encode()
        writer.write(head + payload)
        await asyncio.wait_for(writer.drain(), timeout)
        raw = await asyncio.wait_for(reader.read(1 << 16), timeout)
        more = b""
        while len(raw) < (1 << 17):
            more = await asyncio.wait_for(reader.read(1 << 16), timeout)
            if not more:
                break
            raw += more
    except (OSError, asyncio.TimeoutError, ssl.SSLError) as exc:
        raise PairError(f"The pairing exchange with Mantel failed ({type(exc).__name__}).") from exc
    finally:
        writer.close()
    header, _, body = raw.partition(b"\r\n\r\n")
    try:
        status = int(header.split(b" ", 2)[1])
    except (IndexError, ValueError):
        raise PairError("Mantel's pairing answer was not valid.") from None
    if b"transfer-encoding: chunked" in header.lower():
        raise PairError("Mantel's pairing answer was not valid.")
    return status, body, fp


async def pair(host: str, port: int, code_text: str, files: Files, name: str = NAME) -> dict:
    """One pairing exchange. On success the files are written and the pairing record returned."""
    raw = protocol.normalize_code(code_text)
    if raw is None:
        raise PairError("That is not a Mantel pairing code (four groups of five letters and digits).")
    key = protocol.code_key(raw)
    pair_id = protocol.code_id(raw)
    private = pki.new_key()
    public = pki.public_pem(private)
    nonce = secrets.token_hex(16)

    def body(seen_fp: str) -> dict:
        return {"v": protocol.VERSION, "pair_id": pair_id, "name": name, "nonce": nonce, "public_key": public,
                "proof": protocol.client_proof(key, pair_id, nonce, pki.public_sha(public), seen_fp, name)}

    status, data, seen_fp = await _exchange(host, port, body)
    if status == 429:
        raise PairError("Mantel says too many pairing attempts. Wait a few minutes and start a new pairing.")
    if status == 403:
        raise PairError("Mantel refused the code: it is wrong, already used, or expired. "
                        "Start a new pairing in Mantel and enter the new code.")
    if status != 200:
        raise PairError(f"Mantel answered {status} to the pairing request.")
    try:
        answer = json.loads(data)
        if not isinstance(answer, dict):
            raise ValueError
    except ValueError:
        raise PairError("Mantel's pairing answer was not valid. Nothing was stored.") from None
    try:
        ca = pki.load_cert(answer["ca_cert"])
        client = pki.load_cert(answer["client_cert"])
        pairing_id = answer["pairing_id"]
        expected = protocol.server_proof(key, pair_id, nonce, seen_fp, pki.cert_fp(ca), pki.cert_fp(client), pairing_id)
        # Mantel proves it knows the code, over everything it is about to make us trust
        if not isinstance(answer.get("proof"), str) or not protocol.equal(expected, answer["proof"]):
            raise PairError("Mantel's answer did not prove it knows the code. Nothing was stored.")
        client.verify_directly_issued_by(ca)
        if pki.public_der(client.public_key()) != pki.public_der(private.public_key()):
            raise PairError("Mantel signed a different key. Nothing was stored.")
    except PairError:
        raise
    except Exception as exc:  # noqa: BLE001 -- any malformed answer is a refusal, never a half-pairing
        raise PairError("Mantel's pairing answer was not valid. Nothing was stored.") from exc
    info = {"v": 1, "address": f"{host}:{port}", "pairing_id": pairing_id, "paired": time.time(),
            "code_sha": code_sha(raw)}
    files.write(answer["ca_cert"], answer["client_cert"], pki.private_pem(private), info)
    log.info("paired with Mantel (pairing %s)", pairing_id)
    return info


async def renew(files: Files, host: str, port: int) -> bool:
    """Ask Mantel for a fresh certificate for a new key, over the current mutual-TLS session. The new
    files replace the old only after Mantel's answer checks out. True if renewed."""
    ca_pem = files.ca.read_text()
    ctx = pki.client_context(ca_pem, files.cert, files.key)
    private = pki.new_key()
    url = protocol.origin_of(host, port) + protocol.RENEW_PATH
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20), trust_env=False) as http:
        async with http.post(url, json={"public_key": pki.public_pem(private)}, ssl=ctx, allow_redirects=False) as resp:
            if resp.status != 200:
                log.warning("certificate renewal refused (%s)", resp.status)
                return False
            answer = await resp.json(content_type=None)
    ca = pki.load_cert(answer["ca_cert"])
    client = pki.load_cert(answer["client_cert"])
    client.verify_directly_issued_by(ca)
    if pki.public_der(client.public_key()) != pki.public_der(private.public_key()):
        log.warning("certificate renewal answered with another key; ignored")
        return False
    files.write(answer["ca_cert"], answer["client_cert"], pki.private_pem(private), None)
    log.info("renewed the client certificate")
    return True
