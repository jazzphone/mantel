"""A stand-in for Mantel's linked endpoint (/linked/ws) on 127.0.0.1, speaking
protocol 2 (mantel_link.py; docs/phase9/MANTEL-LINK.md). It records every frame
and header, answers `report` and `ping`, and the test decides the rest.

The fictional house is HK Frontend's (the same unique ids and entity ids HK
Frontend's own tests use): one wall tablet (Hall), Live TV's viewers and one
channel, one Alarm PIN panel. By default Mantel owns all of it and Mantel Link
holds the bridge (`owners`); a test sets its own."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from aiohttp import web
from aiohttp.test_utils import TestServer

ENTRY = "01JLINKEDHOUSEENTRY0000000"          # HK Frontend's house entry id (unique ids start with it)
ALARM_ITEM = "01JLINKEDALARMPINITEM00000"      # the Alarm PIN item: its panel's unique id
TV_ITEM = "01JLINKEDLIVETVITEM0000000"
TOKEN = "msvc_00112233445566aa_" + "A" * 43    # a fictional Service credential
INSTANCE = "0123456789abcdef0123456789abcdef"  # this Mantel's instance id

BLACK = "switch.hall_black_screen"
PHOTOS = "switch.hall_photo_screensaver"
SLEEP = "sensor.hall_sleep_screen"
INUSE = "binary_sensor.hall_screen_in_use"
VIEWERS = "sensor.tv_viewers"
CAMERA = "camera.tv_channel_nine"
ALARM = "alarm_control_panel.house_alarm_pin"
SEASONAL = "switch.hk_frontend_seasonal_decorations"
BLACK_UID = f"{ENTRY}_hall_black_screen"
FULL = {"house": "mantel", "tablets": ["hall"], "bridge": "mantel"}   # all Mantel's, Mantel Link mirrors
DEVICE = {"identifier": f"{ENTRY}_hall", "name": "Hall", "manufacturer": "HK Frontend", "model": "Wall Tablet"}

UIDS = {BLACK: BLACK_UID, PHOTOS: f"{ENTRY}_hall_photo_screensaver", SLEEP: f"{ENTRY}_hall_sleep_screen",
        INUSE: f"{ENTRY}_hall_screen_in_use", VIEWERS: f"{TV_ITEM}_viewers", CAMERA: f"{TV_ITEM}_9.1_camera",
        ALARM: ALARM_ITEM, SEASONAL: f"{ENTRY}_seasonal_decorations"}


def entities() -> list[dict[str, Any]]:
    return [
        {"unique_id": UIDS[BLACK], "platform": "switch", "entity_id": BLACK,
         "translation_key": "black_screen", "icon": "mdi:monitor-off", "device": DEVICE, "state": "off",
         "tablet": "hall", "attributes": {"tablet": "hall", "black_screen": "hk", "brightness": None, "confirmed": False}},
        {"unique_id": UIDS[PHOTOS], "platform": "switch", "entity_id": PHOTOS,
         "translation_key": "photo_screensaver", "icon": "mdi:image-multiple", "device": DEVICE, "state": "off",
         "tablet": "hall", "attributes": {"tablet": "hall", "starts_after": 180}},
        {"unique_id": UIDS[SLEEP], "platform": "sensor", "entity_id": SLEEP,
         "translation_key": "sleep_screen", "device": DEVICE, "state": "dashboard", "tablet": "hall",
         "attributes": {"tablet": "hall", "decided_by": "mantel", "why": "someone home"}},
        {"unique_id": UIDS[INUSE], "platform": "binary_sensor", "entity_id": INUSE,
         "translation_key": "screen_in_use", "device": DEVICE, "state": "off", "tablet": "hall",
         "attributes": {"tablet": "hall"}},
        {"unique_id": UIDS[VIEWERS], "platform": "sensor", "entity_id": VIEWERS,
         "has_entity_name": False, "name": "TV viewers", "icon": "mdi:account-eye", "state": 0,
         "attributes": {"users": [], "channels": []}},
        {"unique_id": UIDS[CAMERA], "platform": "camera", "entity_id": CAMERA,
         "has_entity_name": False, "name": "TV Channel Nine", "state": "idle", "attributes": {"channel": "9.1"},
         "features": {"stream_source": "http://127.0.0.1:8123/fictional/live_tv/9.1"}},
        {"unique_id": ALARM_ITEM, "platform": "alarm_control_panel", "entity_id": ALARM, "name": None,
         "device": {"identifier": ALARM_ITEM, "name": "House Alarm PIN"}, "state": "disarmed",
         "attributes": {"protects": "alarm_control_panel.house_alarm"},
         "features": {"supported_features": 3, "code_format": "number", "code_arm_required": True}},
        {"unique_id": UIDS[SEASONAL], "platform": "switch", "entity_id": SEASONAL,
         "translation_key": "seasonal_decorations", "device": {"identifier": ENTRY, "name": "HK Frontend"},
         "state": "on", "attributes": {}},
    ]


def own_ca(name: str = "mantel-connect"):
    """A CA and a listener certificate it issued for `name` (Mantel Connect's): (CA PEM, the server's SSLContext)."""
    import datetime as dt
    import ssl
    import tempfile
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.x509.oid import NameOID
    now = dt.datetime.now(dt.timezone.utc)

    def cert(subject, issuer, pub, signer, ca, san=None):
        # as Mantel's Pki makes them (Python's strict X.509 checks want the key identifiers)
        b = (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, subject)]))
             .issuer_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, issuer)])).public_key(pub)
             .serial_number(x509.random_serial_number()).not_valid_before(now - dt.timedelta(minutes=5))
             .not_valid_after(now + dt.timedelta(days=2))
             .add_extension(x509.BasicConstraints(ca=ca, path_length=0 if ca else None), True)
             .add_extension(x509.SubjectKeyIdentifier.from_public_key(pub), False))
        if ca:
            b = b.add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), True)
        else:
            b = (b.add_extension(x509.KeyUsage(True, False, False, False, False, False, False, False, False), True)
                 .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]), False)
                 .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(signer.public_key()), False))
        if san:
            b = b.add_extension(x509.SubjectAlternativeName([x509.DNSName(san)]), False)
        return b.sign(signer, hashes.SHA256())
    ca_key, srv_key = ec.generate_private_key(ec.SECP256R1()), ec.generate_private_key(ec.SECP256R1())
    ca = cert("Fictional Mantel CA", "Fictional Mantel CA", ca_key.public_key(), ca_key, True)
    srv = cert("Mantel Connect", "Fictional Mantel CA", srv_key.public_key(), ca_key, False, san=name)
    d = Path(tempfile.mkdtemp())
    (d / "srv.pem").write_bytes(srv.public_bytes(serialization.Encoding.PEM))
    (d / "srv.key").write_bytes(srv_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                      serialization.NoEncryption()))
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(str(d / "srv.pem"), str(d / "srv.key"))
    return ca.public_bytes(serialization.Encoding.PEM).decode(), ctx


class FakeMantel:
    def __init__(self, token: str = TOKEN) -> None:
        self.token = token
        self.entities = entities()
        self.owners: dict[str, Any] | None = dict(FULL)
        self.protocol: int | None = None        # None: answer with what the client asks for
        self.received: list[dict[str, Any]] = []
        self.headers: list[dict[str, str]] = []
        self.sockets: list[web.WebSocketResponse] = []
        self.reports: list[dict[str, Any]] = []
        self.by_domain: dict[str, list[dict[str, Any]]] = {}    # what each integration sent
        self.screen_origins = ["https://mantel.example.com"]
        self.connects = 0
        self.answer = self.ok
        self.server: TestServer | None = None
        self.url = ""

    async def ok(self, ws, msg):
        return {"id": msg["id"], "type": "result", "success": True, "result": {"ok": True}}

    # ---- pairing by code (Mantel's linked_pairing.py, the same proofs)
    code: str | None = None          # the pending code ("ABCDE-FGHJK-MNPQR-STVWX"), set by a test
    lie = False                      # answer with a proof that does not match (a look-alike Mantel)
    pair_version = 2                 # 1: an older Mantel, which knows only v1 (anything else is "malformed")
    own_address: str | None = None   # the addresses this Mantel calls its own (None: the one it listens on)
    signs_address: str | None = None # sign the answer for another address than the one asked (a relay's trick)
    ca_pem: str | None = None        # pinned (start(pinned=True)): its own CA, as Mantel Connect's listener
    swap_ca: str | None = None       # hand over this CA instead of its own (a look-alike's trick)

    async def pair(self, request: web.Request) -> web.StreamResponse:
        import hashlib, hmac as _hmac, re as _re
        body = await request.json()
        self.received.append({"type": "pair", **{k: body.get(k) for k in ("v", "code_id", "name", "address")}})
        if body.get("v") == 3 and self.ca_pem is None:
            return web.json_response({"error": {"code": "pin_elsewhere", "message": "Use https://192.0.2.10:8766."}},
                                     status=400)
        if body.get("v") != 1 and (self.pair_version == 1 or body.get("v") not in (2, 3)):
            return web.json_response({"error": {"code": "malformed", "message": "no"}}, status=400)
        raw = _re.sub(r"[\s-]", "", self.code or "").upper()
        key = hashlib.sha256(b"mantel-link-pair-v1|key|" + raw.encode()).digest()
        mac = lambda *p: _hmac.new(key, "|".join(p).encode(), hashlib.sha256).hexdigest()  # noqa: E731
        v2, v3 = body["v"] in (2, 3), body["v"] == 3
        label = f"mantel-link-pair-v{body['v']}"
        addr = [body.get("address")] if v2 else []
        if not raw or body.get("code_id") != raw[:5] or body.get("proof") != mac(
                label, "client", body["code_id"], body["nonce"], body["name"], *addr):
            return web.json_response({"error": {"code": "invalid_code", "message": "no"}}, status=403)
        if v2 and body["address"] != (self.own_address or self.url):     # self.url is normalised already
            return web.json_response({"error": {"code": "wrong_address", "message": "no"}}, status=403)
        self.code = None
        signed = [self.signs_address or body["address"]] if v2 else []
        if v3:
            import base64, secrets as _secrets
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            ca = self.ca_pem
            proof = mac(label, "server", body["code_id"], body["nonce"], *signed, INSTANCE,
                        hashlib.sha256(self.token.encode()).hexdigest(), hashlib.sha256(ca.encode()).hexdigest())
            k = _hmac.new(key, f"mantel-link-pair-v3|token|{body['nonce']}".encode(), hashlib.sha256).digest()
            iv = _secrets.token_bytes(12)
            sealed = base64.urlsafe_b64encode(iv + AESGCM(k).encrypt(iv, self.token.encode(), signed[0].encode())).decode()
            return web.json_response({"v": 3, "instance": INSTANCE, "address": signed[0], "ca": self.swap_ca or ca,
                                      "token_sealed": sealed, "proof": ("0" * 64) if self.lie else proof})
        proof = mac(label, "server", body["code_id"], body["nonce"], *signed, INSTANCE,
                    hashlib.sha256(self.token.encode()).hexdigest())
        return web.json_response({"v": body["v"], "token": self.token, "instance": INSTANCE,
                                  **({"address": signed[0]} if v2 else {}),
                                  "proof": ("0" * 64) if self.lie else proof})

    async def start(self, pinned: bool = False) -> "FakeMantel":
        """`pinned`: HTTPS with a certificate from its own CA, for the name Mantel Connect's listener has, as Mantel
        by its address (pairing v3)."""
        app = web.Application()
        app.router.add_get("/linked/ws", self.handler)
        app.router.add_post("/linked/pair", self.pair)
        self.server = TestServer(app, host="127.0.0.1")
        if pinned:
            self.ca_pem, ctx = own_ca()
            await self.server.start_server(ssl=ctx)
            self.url = f"https://127.0.0.1:{self.server.port}"
        else:
            await self.server.start_server()
            self.url = f"http://127.0.0.1:{self.server.port}"
        return self

    async def handler(self, request: web.Request) -> web.StreamResponse:
        self.headers.append(dict(request.headers))
        if request.headers.get("Authorization") != f"Bearer {self.token}":
            raise web.HTTPUnauthorized(text="credential refused")
        asked, domain = 1, "hk_frontend"
        for part in request.headers.get("X-Mantel-Link", "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == "protocol" and v.isdigit():
                asked = int(v)
            elif k == "domain":
                domain = v
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.connects += 1
        self.sockets.append(ws)
        hello = {"type": "hello", "protocol": self.protocol or asked, "instance": INSTANCE,
                 "screen_origins": list(self.screen_origins),
                 "services": ["set_black_screen", "show_popup", "close_popup", "notify"], "entities": self.entities}
        if self.owners is not None:
            hello["owners"] = self.owners
        await ws.send_json(hello)
        try:
            async for frame in ws:
                msg = json.loads(frame.data)
                self.received.append(msg)
                self.by_domain.setdefault(domain, []).append(msg)
                if msg.get("type") == "report":
                    self.reports.append(msg.get("report"))
                    await ws.send_json({"id": msg["id"], "type": "result", "success": True, "result": {"ok": True}})
                    continue
                reply = await self.answer(ws, msg)
                if reply is not None:
                    await ws.send_json(reply)
        finally:
            if ws in self.sockets:
                self.sockets.remove(ws)
        return ws

    def calls(self, type_: str = "call_service") -> list[dict[str, Any]]:
        return [m for m in self.received if m.get("type") == type_]

    async def push(self, msg: dict[str, Any]) -> None:
        for ws in list(self.sockets):
            await ws.send_json(msg)

    async def drop(self) -> None:
        for ws in list(self.sockets):
            await ws.close()

    async def close(self) -> None:
        await self.drop()
        if self.server is not None:
            await self.server.close()


async def until(hass, check, timeout: float = 15.0) -> None:
    """Wait (the link is a real socket) until `check()` is true."""
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while True:
        await hass.async_block_till_done()
        if check():
            return
        if loop.time() > end:
            raise AssertionError("timed out waiting")
        await asyncio.sleep(0.02)
