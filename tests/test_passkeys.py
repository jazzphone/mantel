"""P3.1 passkeys: WebAuthn registration and assertion through the `webauthn` package, driven by a small
software authenticator (P-256, "none" attestation) built here from the WebAuthn spec."""
import hashlib
import json
import os
import struct

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url

RP_ID = "localhost"


class SoftAuthenticator:
    def __init__(self, uv=True):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.cred_id = os.urandom(16)
        self.counter = 0
        self.uv = uv
        self.user_handle = None

    def _cose(self):
        n = self.key.public_key().public_numbers()
        return cbor2.dumps({1: 2, 3: -7, -1: 1, -2: n.x.to_bytes(32, "big"), -3: n.y.to_bytes(32, "big")})

    def _flags(self, attested=False):
        return 0x01 | (0x04 if self.uv else 0) | (0x40 if attested else 0)

    @staticmethod
    def _client_data(kind, challenge, origin):
        return json.dumps({"type": kind, "challenge": challenge, "origin": origin, "crossOrigin": False}).encode()

    def create(self, options, origin):
        self.user_handle = options["user"]["id"]
        cdj = self._client_data("webauthn.create", options["challenge"], origin)
        auth_data = (hashlib.sha256(options["rp"]["id"].encode()).digest() + bytes([self._flags(True)])
                     + struct.pack(">I", self.counter) + b"\0" * 16 + struct.pack(">H", len(self.cred_id))
                     + self.cred_id + self._cose())
        att = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        cid = bytes_to_base64url(self.cred_id)
        return {"id": cid, "rawId": cid, "type": "public-key", "clientExtensionResults": {},
                "response": {"clientDataJSON": bytes_to_base64url(cdj), "attestationObject": bytes_to_base64url(att),
                             "transports": ["internal"]}}

    def get(self, options, origin, counter_step=1, rp_id=None):
        self.counter += counter_step
        cdj = self._client_data("webauthn.get", options["challenge"], origin)
        auth_data = (hashlib.sha256((rp_id or options["rpId"]).encode()).digest() + bytes([self._flags()])
                     + struct.pack(">I", self.counter))
        sig = self.key.sign(auth_data + hashlib.sha256(cdj).digest(), ec.ECDSA(hashes.SHA256()))
        cid = bytes_to_base64url(self.cred_id)
        return {"id": cid, "rawId": cid, "type": "public-key", "clientExtensionResults": {},
                "response": {"clientDataJSON": bytes_to_base64url(cdj), "authenticatorData": bytes_to_base64url(auth_data),
                             "signature": bytes_to_base64url(sig), "userHandle": self.user_handle}}


def localhost(mantel):
    """Passkeys need a hostname RP ID: talk to the server as http://localhost:<port>."""
    port = mantel.client.port
    return f"http://localhost:{port}", {"Host": f"localhost:{port}", "Origin": f"http://localhost:{port}"}


async def register(mantel, auth, name="Phone"):
    origin, h = localhost(mantel)
    r = await mantel.post("/api/auth/passkey/register/options", headers=h)
    assert r.status == 200, await r.text()
    body = await r.json()
    opts = body["options"]
    assert opts["rp"]["id"] == RP_ID and opts["authenticatorSelection"]["userVerification"] == "required"
    r = await mantel.post("/api/auth/passkey/register/verify",
                          {"challenge_id": body["challenge_id"], "credential": auth.create(opts, origin), "name": name},
                          headers=h)
    return r


async def assert_passkey(mantel, auth, username=None, **kw):
    origin, h = localhost(mantel)
    r = await mantel.post("/api/auth/passkey/options", {"username": username} if username else {}, csrf=False, headers=h)
    body = await r.json()
    cred = auth.get(body["options"], kw.pop("origin", origin), **kw)
    return body, await mantel.post("/api/auth/passkey/verify", {"challenge_id": body["challenge_id"], "credential": cred},
                                   csrf=False, headers=h)


async def test_register_then_sign_in_with_a_passkey(mantel):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    auth = SoftAuthenticator()
    r = await register(mantel, auth)
    assert r.status == 201
    row = mantel.store.db.execute("SELECT * FROM passkeys").fetchone()
    assert row["id"] == bytes_to_base64url(auth.cred_id) and json.loads(row["transports"]) == ["internal"]
    mantel.forget_cookies()
    body, r = await assert_passkey(mantel, auth)                            # discoverable: no user name
    assert r.status == 200, await r.text()
    assert (await r.json())["user"]["username"] == "jordan"
    me = await (await mantel.get("/api/session")).json()
    assert me["user"]["username"] == "jordan" and me["fresh_factor_at"] == mantel.now[0]
    assert mantel.store.db.execute("SELECT sign_count FROM passkeys").fetchone()[0] == 1
    # the challenge was single use
    origin, h = localhost(mantel)
    replay = await mantel.post("/api/auth/passkey/verify", {"challenge_id": body["challenge_id"],
                                                            "credential": auth.get(body["options"], origin)},
                               csrf=False, headers=h)
    assert replay.status == 401 and (await replay.json())["error"] == "challenge_invalid"


async def test_passkey_works_on_the_tunnel_where_a_password_alone_does_not(mantel):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    auth = SoftAuthenticator()
    await register(mantel, auth)
    mantel.forget_cookies()
    r, body = await mantel.sign_in("jordan", tunnel=True)
    assert r.status == 403 and body["methods"] == ["passkey"]
    origin, h = localhost(mantel)
    r = await mantel.post("/api/auth/passkey/options", {"username": "jordan"}, csrf=False, tunnel=True, headers=h)
    opts = await r.json()
    assert [c["id"] for c in opts["options"]["allowCredentials"]] == [bytes_to_base64url(auth.cred_id)]
    r = await mantel.post("/api/auth/passkey/verify", {"challenge_id": opts["challenge_id"],
                                                       "credential": auth.get(opts["options"], origin)},
                          csrf=False, tunnel=True, headers=h)
    assert r.status == 200 and (await r.json())["session"]["door"] == "tunnel"


async def test_bad_assertions_are_refused(mantel):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    auth = SoftAuthenticator()
    await register(mantel, auth)
    mantel.forget_cookies()
    _, r = await assert_passkey(mantel, auth, origin="http://evil.example.com")
    assert r.status == 401                                                  # wrong origin in clientDataJSON
    _, r = await assert_passkey(mantel, auth, rp_id="evil.example.com")
    assert r.status == 401                                                  # wrong RP ID hash
    auth.counter = 4
    _, r = await assert_passkey(mantel, auth)                               # a good one (count 5) …
    assert r.status == 200
    mantel.forget_cookies()
    auth.counter = 2
    _, r = await assert_passkey(mantel, auth)                               # … then the count goes backwards: a clone
    assert r.status == 401
    stranger = SoftAuthenticator()
    stranger.user_handle = auth.user_handle
    _, r = await assert_passkey(mantel, stranger)
    assert r.status == 401 and (await r.json())["error"] == "credential_unknown"
    no_uv = SoftAuthenticator(uv=False)
    no_uv.cred_id, no_uv.key, no_uv.user_handle, no_uv.counter = auth.cred_id, auth.key, auth.user_handle, 50
    _, r = await assert_passkey(mantel, no_uv)
    assert r.status == 401                                                  # user verification is required
    assert mantel.cookie("mantel_session") is None


async def test_expired_challenge_and_foreign_origin(mantel):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    auth = SoftAuthenticator()
    origin, h = localhost(mantel)
    r = await mantel.post("/api/auth/passkey/register/options", headers=h)
    body = await r.json()
    mantel.now[0] += 301
    r = await mantel.post("/api/auth/passkey/register/verify",
                          {"challenge_id": body["challenge_id"], "credential": auth.create(body["options"], origin)},
                          headers=h)
    assert r.status == 400 and (await r.json())["error"] == "challenge_invalid"
    # an IP-address origin cannot be a passkey RP
    r = await mantel.post("/api/auth/passkey/register/options")
    assert r.status == 400 and (await r.json())["error"] == "origin_not_allowed_for_passkeys"


async def test_passkey_step_up_marks_the_session_fresh(mantel):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    auth = SoftAuthenticator()
    await register(mantel, auth)
    mantel.now[0] += 3600
    assert (await mantel.client.delete("/api/auth/totp", headers=mantel.headers())).status == 403  # not fresh
    _, r = await assert_passkey(mantel, auth, username="jordan")
    assert r.status == 200 and (await r.json())["step_up"] is True
    me = await (await mantel.get("/api/session")).json()
    assert me["fresh_factor_at"] == mantel.now[0]
    assert (await mantel.client.delete("/api/auth/totp", headers=mantel.headers())).status == 200
    listed = (await (await mantel.get("/api/auth/passkeys")).json())["passkeys"]
    assert len(listed) == 1 and listed[0]["name"] == "Phone" and "public_key" not in listed[0]
    assert base64url_to_bytes(listed[0]["id"]) == auth.cred_id
