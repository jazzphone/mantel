"""A FAKE AIRPLAY SCREEN for cameras/airplay_out's tests: the screen's side of HAP pair-setup (srptools' conventions,
the ones pyatv pairs Apple's devices with), pair-verify, the encrypted RTSP session a HomeView answers (the plan's
steps), and its event channel. Every request it gets is kept in ``requests``; ``stop()`` closes the show from the
screen's side, ``event()`` sends one on the event channel.
"""
from __future__ import annotations

import asyncio
import os
import plistlib

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey

from mantel_server.cameras.airplay_out import hap
from mantel_server.cameras.airplay_out.rtsp import split_message

H, I, N, G, PAD = hap._H, hap._i, hap.N, hap.G, hap._pad


class FakeScreen:
    def __init__(self, code: str = "4067", psi: str = "7E4FF11E-CB6B-4D0B-86D8-5EB48534F5FE",
                 data_port: bool = False) -> None:
        self.code, self.psi, self.data_port = code, psi, data_port
        self.sign = Ed25519PrivateKey.generate()
        self.atv_id = psi.encode()
        self.paired: dict[bytes, bytes] = {}            # client id -> its public key
        self.requests: list[tuple[str, dict, object]] = []
        self.pin_shown_for: list[str] = []
        self.port = 0
        self.event_port = 0
        self.conns: list[asyncio.StreamWriter] = []
        self.events_writer: asyncio.StreamWriter | None = None
        self.events_framing: hap.Framing | None = None
        self.answers: list[str] = []                       # what Mantel answered on the event channel
        self.refuse_verify = False

    async def start(self) -> "FakeScreen":
        self._srv = await asyncio.start_server(self._control, "127.0.0.1", 0)
        self.port = self._srv.sockets[0].getsockname()[1]
        self._ev = await asyncio.start_server(self._events, "127.0.0.1", 0)
        self.event_port = self._ev.sockets[0].getsockname()[1]
        return self

    async def close(self) -> None:
        for w in self.conns:
            w.close()
        if self.events_writer is not None:
            self.events_writer.close()
        self._srv.close()
        self._ev.close()

    def stop(self) -> None:
        """The screen ends the show (its X, another sender): it closes the connections."""
        for w in self.conns:
            w.close()
        if self.events_writer is not None:
            self.events_writer.close()

    async def event(self, body: dict) -> None:
        raw = plistlib.dumps(body, fmt=plistlib.FMT_BINARY)
        msg = f"POST /command RTSP/1.0\r\nCSeq: 1\r\nContent-Length: {len(raw)}\r\n\r\n".encode() + raw
        assert self.events_writer is not None and self.events_framing is not None
        self.events_writer.write(self.events_framing.encrypt(msg))
        await self.events_writer.drain()

    # -- the control connection ------------------------------------------------------------------------
    async def _control(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.conns.append(writer)
        buf, framing, state = b"", None, {}
        try:
            while True:
                chunk = await reader.read(65536)
                if not chunk:
                    return
                buf += framing.decrypt(chunk) if framing else chunk
                while True:
                    got, buf = split_message(buf)
                    if got is None:
                        break
                    start, headers, body = got
                    code, reply, out_headers, keys = self._handle(start, headers, body, state)
                    head = f"{'HTTP/1.1' if 'HTTP/1.1' in start else 'RTSP/1.0'} {code} X\r\n"
                    if "cseq" in headers:
                        head += f"CSeq: {headers['cseq']}\r\n"
                    for k, v in out_headers.items():
                        head += f"{k}: {v}\r\n"
                    raw = (head + f"Content-Length: {len(reply)}\r\n\r\n").encode() + reply
                    writer.write(framing.encrypt(raw) if framing else raw)
                    await writer.drain()
                    if keys is not None:
                        framing = hap.Framing(*keys)
        except (ConnectionError, asyncio.CancelledError):
            return

    def _handle(self, start: str, headers: dict, body: bytes, state: dict):
        method, path = start.split(" ")[:2]
        data = plistlib.loads(body) if body.startswith(b"bplist") else body
        if isinstance(data, dict) and isinstance((data.get("params") or {}).get("data"), bytes):
            data = {"stream": headers.get("x-apple-streamid"), "inner": plistlib.loads(data["params"]["data"])}
        self.requests.append((f"{method} {path}", headers, data))
        if path == "/pair-pin-start":
            self.pin_shown_for.append(headers.get("x-apple-client-name", ""))
            return 200, b"", {}, None
        if path == "/pair-setup":
            return (200, self._setup(hap.read_tlv(body), state), {}, None)
        if path == "/pair-verify":
            return self._verify(hap.read_tlv(body), state)
        bp = {"Content-Type": "application/x-apple-binary-plist"}
        if method == "SETUP" and isinstance(data, dict) and "streams" in data:
            s = {"type": 130, "streamID": 1}
            if self.data_port:
                s["dataPort"] = 1
            return 200, plistlib.dumps({"streams": [s]}, fmt=plistlib.FMT_BINARY), bp, None
        if method == "SETUP" and isinstance(data, dict) and data.get("isRemoteControlOnly"):
            return 200, plistlib.dumps({"eventPort": self.event_port, "skipRecord": True,
                                        "info": {"psi": self.psi}}, fmt=plistlib.FMT_BINARY), bp, None
        if method == "SETUP":
            return 200, plistlib.dumps({"info": {"psi": self.psi}, "asyncPTPClockConfig": True},
                                       fmt=plistlib.FMT_BINARY), bp, None
        return 200, b"", {}, None

    # -- pair-setup (the screen's side) ----------------------------------------------------------------
    def _setup(self, tlv: dict, st: dict) -> bytes:
        seq = tlv.get(hap.SEQ)
        if seq == b"\x01":
            st["salt"] = os.urandom(16)
            x = I(H(I(st["salt"]), H(b"Pair-Setup:" + self.code.encode())))
            st["v"] = pow(G, x, N)
            st["b"] = I(os.urandom(32))
            st["B"] = (hap.K_MULT * st["v"] + pow(G, st["b"], N)) % N
            return hap.write_tlv([(hap.SEQ, b"\x02"), (hap.SALT, st["salt"]), (hap.PUBLIC_KEY, PAD(st["B"]))])
        if seq == b"\x03":
            A = I(tlv[hap.PUBLIC_KEY])
            u = I(H(PAD(A), PAD(st["B"])))
            S = pow(A * pow(st["v"], u, N), st["b"], N)
            K = H(S)
            m1 = H(I(H(N)) ^ I(H(G)), I(H(b"Pair-Setup")), I(st["salt"]), A, st["B"], K)
            if m1 != tlv[hap.PROOF]:
                return hap.write_tlv([(hap.SEQ, b"\x04"), (hap.ERROR, b"\x02")])
            st["K"] = K
            return hap.write_tlv([(hap.SEQ, b"\x04"), (hap.PROOF, H(A, m1, K))])
        if seq == b"\x05":
            key = hap.hkdf("Pair-Setup-Encrypt-Salt", "Pair-Setup-Encrypt-Info", st["K"])
            inner = hap.read_tlv(hap.unseal(key, b"PS-Msg05", tlv[hap.ENCRYPTED]))
            cid, cpub, csig = inner[hap.IDENTIFIER], inner[hap.PUBLIC_KEY], inner[hap.SIGNATURE]
            x = hap.hkdf("Pair-Setup-Controller-Sign-Salt", "Pair-Setup-Controller-Sign-Info", st["K"])
            Ed25519PublicKey.from_public_bytes(cpub).verify(csig, x + cid + cpub)
            self.paired[cid] = cpub
            mine = hap._raw_public(self.sign)
            ax = hap.hkdf("Pair-Setup-Accessory-Sign-Salt", "Pair-Setup-Accessory-Sign-Info", st["K"])
            sig = self.sign.sign(ax + self.atv_id + mine)
            sealed = hap.seal(key, b"PS-Msg06", hap.write_tlv([(hap.IDENTIFIER, self.atv_id),
                                                               (hap.PUBLIC_KEY, mine), (hap.SIGNATURE, sig)]))
            return hap.write_tlv([(hap.SEQ, b"\x06"), (hap.ENCRYPTED, sealed)])
        return hap.write_tlv([(hap.ERROR, b"\x01")])

    # -- pair-verify (the screen's side) ---------------------------------------------------------------
    def _verify(self, tlv: dict, st: dict):
        if tlv.get(hap.SEQ) == b"\x01":
            eph = X25519PrivateKey.generate()
            mine, theirs = hap._raw_public(eph), tlv[hap.PUBLIC_KEY]
            st["shared"] = eph.exchange(X25519PublicKey.from_public_bytes(theirs))
            st["pubs"] = (mine, theirs)
            key = hap.hkdf("Pair-Verify-Encrypt-Salt", "Pair-Verify-Encrypt-Info", st["shared"])
            sig = self.sign.sign(mine + self.atv_id + theirs)
            sealed = hap.seal(key, b"PV-Msg02", hap.write_tlv([(hap.IDENTIFIER, self.atv_id), (hap.SIGNATURE, sig)]))
            return 200, hap.write_tlv([(hap.SEQ, b"\x02"), (hap.PUBLIC_KEY, mine), (hap.ENCRYPTED, sealed)]), {}, None
        key = hap.hkdf("Pair-Verify-Encrypt-Salt", "Pair-Verify-Encrypt-Info", st["shared"])
        inner = hap.read_tlv(hap.unseal(key, b"PV-Msg03", tlv[hap.ENCRYPTED]))
        cid = inner[hap.IDENTIFIER]
        mine, theirs = st["pubs"]
        if self.refuse_verify or cid not in self.paired:
            return 200, hap.write_tlv([(hap.SEQ, b"\x04"), (hap.ERROR, b"\x02")]), {}, None
        Ed25519PublicKey.from_public_bytes(self.paired[cid]).verify(inner[hap.SIGNATURE], theirs + cid + mine)
        out_key = hap.hkdf("Control-Salt", "Control-Read-Encryption-Key", st["shared"])
        in_key = hap.hkdf("Control-Salt", "Control-Write-Encryption-Key", st["shared"])
        self._shared = st["shared"]
        return 200, hap.write_tlv([(hap.SEQ, b"\x04")]), {}, (out_key, in_key)

    # -- the event channel (the screen writes "Events-Write", reads "Events-Read") ---------------------
    async def _events(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.events_writer = writer
        self.events_framing = hap.Framing(hap.hkdf("Events-Salt", "Events-Write-Encryption-Key", self._shared),
                                          hap.hkdf("Events-Salt", "Events-Read-Encryption-Key", self._shared))
        buf = b""
        try:
            while True:
                chunk = await reader.read(65536)
                if not chunk:
                    return
                buf += self.events_framing.decrypt(chunk)
                while True:
                    got, buf = split_message(buf)
                    if got is None:
                        break
                    self.answers.append(got[0])
        except (ConnectionError, asyncio.CancelledError):
            return
