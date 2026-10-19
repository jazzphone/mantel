"""A fictional ACME server (RFC 8555, the parts Let's Encrypt uses for DNS-01) and a fictional Cloudflare DNS API,
for the built-in HTTPS tests (test_direct_access.py). Both check what the real ones check: the ACME side every
JWS signature (ES256, jwk then kid), nonce and url, and the TXT record against the account's key; the Cloudflare
side the bearer token. Nothing here reaches the network."""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import itertools
import json

from aiohttp import web
from cryptography import x509
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from cryptography.x509.oid import NameOID


def b64d(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def jwk_key(jwk: dict) -> ec.EllipticCurvePublicKey:
    assert jwk["kty"] == "EC" and jwk["crv"] == "P-256"
    return ec.EllipticCurvePublicNumbers(int.from_bytes(b64d(jwk["x"]), "big"), int.from_bytes(b64d(jwk["y"]), "big"),
                                         ec.SECP256R1()).public_key()


def thumbprint(jwk: dict) -> str:
    return b64u(hashlib.sha256(json.dumps({k: jwk[k] for k in ("crv", "kty", "x", "y")}, sort_keys=True,
                                          separators=(",", ":")).encode()).digest())


class FakeCloudflare:
    def __init__(self, token: str, zones=("home.example",)) -> None:
        self.token = token
        self.zones = {f"zone{i}": name for i, name in enumerate(zones)}
        self.records: dict[str, dict] = {}
        self.ids = itertools.count(1)
        self.seen_auth: list[str] = []

    def _ok(self, request) -> bool:
        got = request.headers.get("Authorization", "")
        self.seen_auth.append(got)
        return got == f"Bearer {self.token}"

    def app(self) -> web.Application:
        app = web.Application()

        async def zones(request):
            if not self._ok(request):
                return web.json_response({"success": False, "errors": [{"code": 10000, "message": "Authentication error"}]}, status=403)
            name = request.query.get("name")
            return web.json_response({"success": True, "result": [{"id": z, "name": n} for z, n in self.zones.items() if n == name]})

        async def add(request):
            if not self._ok(request):
                return web.json_response({"success": False, "errors": [{"code": 10000, "message": "Authentication error"}]}, status=403)
            body = await request.json()
            rid = f"rec{next(self.ids)}"
            self.records[rid] = {**body, "zone": request.match_info["zone"]}
            return web.json_response({"success": True, "result": {"id": rid}})

        async def delete(request):
            if not self._ok(request):
                return web.json_response({"success": False, "errors": []}, status=403)
            self.records.pop(request.match_info["rid"], None)
            return web.json_response({"success": True, "result": {"id": request.match_info["rid"]}})

        app.router.add_get("/client/v4/zones", zones)
        app.router.add_post("/client/v4/zones/{zone}/dns_records", add)
        app.router.add_delete("/client/v4/zones/{zone}/dns_records/{rid}", delete)
        return app

    def txt(self, name: str) -> list[str]:
        return [r["content"] for r in self.records.values() if r["type"] == "TXT" and r["name"] == name]


class FakeAcme:
    """Let's Encrypt, in miniature. ``base`` is set once the test server runs (urls are absolute)."""

    def __init__(self, dns: FakeCloudflare, days: int = 90, fail_validation: bool = False) -> None:
        self.dns = dns
        self.days = days
        self.fail_validation = fail_validation
        self.base = ""
        self.nonces: set[str] = set()
        self.counter = itertools.count(1)
        self.accounts: dict[str, dict] = {}       # kid -> jwk
        self.orders: dict[str, dict] = {}
        self.authzs: dict[str, dict] = {}
        self.issued: list[x509.Certificate] = []
        self.bad_nonce_once = False
        self.ca_key = ec.generate_private_key(ec.SECP256R1())
        self.ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Fictional ACME CA")])

    def _nonce(self) -> str:
        n = b64u(hashlib.sha256(str(next(self.counter)).encode()).digest()[:12])
        self.nonces.add(n)
        return n

    def _problem(self, status: int, kind: str, detail: str) -> web.Response:
        return web.json_response({"type": f"urn:ietf:params:acme:error:{kind}", "detail": detail}, status=status,
                                 content_type="application/problem+json", headers={"Replay-Nonce": self._nonce()})

    async def _verify(self, request) -> tuple[dict, object, str | None]:
        assert request.headers.get("Content-Type") == "application/jose+json"
        body = await request.json()
        protected = json.loads(b64d(body["protected"]))
        assert protected["alg"] == "ES256" and protected["url"] == self.base + request.path
        if self.bad_nonce_once:
            self.bad_nonce_once = False
            raise _Problem(400, "badNonce", "try again")
        if protected["nonce"] not in self.nonces:
            raise _Problem(400, "badNonce", "unknown nonce")
        self.nonces.discard(protected["nonce"])
        if "jwk" in protected:
            assert "kid" not in protected
            jwk, kid = protected["jwk"], None
        else:
            kid = protected["kid"]
            jwk = self.accounts[kid]
        sig = b64d(body["signature"])
        der = encode_dss_signature(int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big"))
        try:
            jwk_key(jwk).verify(der, f"{body['protected']}.{body['payload']}".encode(), ec.ECDSA(hashes.SHA256()))
        except InvalidSignature:
            raise _Problem(400, "malformed", "bad signature")
        payload = json.loads(b64d(body["payload"])) if body["payload"] else None
        return protected, payload, kid

    def app(self) -> web.Application:
        app = web.Application()
        b = lambda: self.base   # noqa: E731

        async def directory(request):
            return web.json_response({"newNonce": b() + "/new-nonce", "newAccount": b() + "/new-acct",
                                      "newOrder": b() + "/new-order"})

        async def new_nonce(request):
            return web.Response(status=200, headers={"Replay-Nonce": self._nonce(), "Cache-Control": "no-store"})

        def handler(fn):
            async def wrapped(request):
                try:
                    protected, payload, kid = await self._verify(request)
                    resp = await fn(request, protected, payload, kid)
                except _Problem as p:
                    return self._problem(p.status, p.kind, p.detail)
                resp.headers["Replay-Nonce"] = self._nonce()
                return resp
            return wrapped

        async def new_acct(request, protected, payload, kid):
            assert payload["termsOfServiceAgreed"] is True and "jwk" in protected
            jwk = protected["jwk"]
            for k, v in self.accounts.items():
                if v == jwk:
                    return web.json_response({"status": "valid"}, status=200, headers={"Location": k})
            k = f"{b()}/acct/{len(self.accounts) + 1}"
            self.accounts[k] = jwk
            return web.json_response({"status": "valid", "contact": payload.get("contact", [])}, status=201,
                                     headers={"Location": k})

        async def new_order(request, protected, payload, kid):
            assert kid is not None
            name = payload["identifiers"][0]["value"]
            oid = str(next(self.counter))
            self.authzs[oid] = {"status": "pending", "identifier": {"type": "dns", "value": name},
                                "kid": kid, "challenges": [
                                    {"type": "http-01", "url": f"{b()}/chall/{oid}/http", "token": "h" + oid, "status": "pending"},
                                    {"type": "dns-01", "url": f"{b()}/chall/{oid}/dns", "token": "tok" + oid, "status": "pending"}]}
            self.orders[oid] = {"status": "pending", "identifiers": payload["identifiers"],
                                "authorizations": [f"{b()}/authz/{oid}"], "finalize": f"{b()}/finalize/{oid}"}
            return web.json_response(self.orders[oid], status=201, headers={"Location": f"{b()}/order/{oid}"})

        async def authz(request, protected, payload, kid):
            assert payload is None
            return web.json_response(self.authzs[request.match_info["id"]])

        async def chall(request, protected, payload, kid):
            oid = request.match_info["id"]
            a = self.authzs[oid]
            ch = next(c for c in a["challenges"] if c["type"] == "dns-01")
            expected = b64u(hashlib.sha256(f"{ch['token']}.{thumbprint(self.accounts[a['kid']])}".encode()).digest())
            record = "_acme-challenge." + a["identifier"]["value"]
            if self.fail_validation or expected not in self.dns.txt(record):
                a["status"] = ch["status"] = "invalid"
                ch["error"] = {"type": "urn:ietf:params:acme:error:unauthorized", "detail": f"no TXT at {record}"}
                self.orders[oid]["status"] = "invalid"
            else:
                a["status"] = ch["status"] = "valid"
                self.orders[oid]["status"] = "ready"
            return web.json_response(ch)

        async def order(request, protected, payload, kid):
            return web.json_response(self.orders[request.match_info["id"]])

        async def finalize(request, protected, payload, kid):
            oid = request.match_info["id"]
            o = self.orders[oid]
            if o["status"] != "ready":
                raise _Problem(403, "orderNotReady", "not ready")
            csr = x509.load_der_x509_csr(b64d(payload["csr"]))
            assert csr.is_signature_valid
            sans = csr.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName)
            assert sans == [i["value"] for i in o["identifiers"]]
            now = dt.datetime.now(dt.timezone.utc)
            cert = (x509.CertificateBuilder().subject_name(csr.subject).issuer_name(self.ca_name)
                    .public_key(csr.public_key()).serial_number(x509.random_serial_number())
                    .not_valid_before(now - dt.timedelta(minutes=1)).not_valid_after(now + dt.timedelta(days=self.days))
                    .add_extension(x509.SubjectAlternativeName([x509.DNSName(n) for n in sans]), critical=False)
                    .sign(self.ca_key, hashes.SHA256()))
            self.issued.append(cert)
            o["status"] = "valid"
            o["certificate"] = f"{b()}/cert/{oid}"
            return web.json_response(o)

        async def cert(request, protected, payload, kid):
            assert request.headers.get("Accept") == "application/pem-certificate-chain"
            pem = self.issued[-1].public_bytes(serialization.Encoding.PEM).decode()
            return web.Response(text=pem, content_type="application/pem-certificate-chain")

        app.router.add_get("/directory", directory)
        app.router.add_route("HEAD", "/new-nonce", new_nonce)
        app.router.add_post("/new-acct", handler(new_acct))
        app.router.add_post("/new-order", handler(new_order))
        app.router.add_post("/authz/{id}", handler(authz))
        app.router.add_post("/chall/{id}/dns", handler(chall))
        app.router.add_post("/order/{id}", handler(order))
        app.router.add_post("/finalize/{id}", handler(finalize))
        app.router.add_post("/cert/{id}", handler(cert))
        return app


class _Problem(Exception):
    def __init__(self, status, kind, detail):
        super().__init__(detail)
        self.status, self.kind, self.detail = status, kind, detail
