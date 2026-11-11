"""Ingress identity proof against fake Supervisor requests and a local TLS receiver."""
import importlib.util
import secrets
import ssl
import subprocess
import sys
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from multidict import CIMultiDict

from mantel_connect.channel import NONCE, PATH, SIGNATURE, STAMP, USER, Verifier, read_key, sign
from mantel_connect.proxy import SUPERVISOR, build_proxy_app, validate_backend
from mantel_server.connect_proof import build_connect_app
from mantel_server.store import Store


@pytest.fixture
def keys(tmp_path):
    path = tmp_path / "channel.key"
    path.write_text(secrets.token_hex(32))
    return path


def test_sign_verify_replay_and_rotation(keys):
    verify = Verifier(keys)
    headers = CIMultiDict(sign(read_key(keys), "fictional-owner", 1000))
    assert verify.verify(headers, 1000) == "fictional-owner"
    with pytest.raises(ValueError):
        verify.verify(headers, 1000)
    old = CIMultiDict(sign(read_key(keys), "fictional-owner", 1000))
    keys.write_text(secrets.token_hex(32))
    with pytest.raises(ValueError):
        verify.verify(old, 1000)
    assert verify.verify(CIMultiDict(sign(read_key(keys), "fictional-owner", 1000)), 1000) == "fictional-owner"


@pytest.mark.parametrize("field,value", [(USER, "someone-else"), (STAMP, "1040"), (STAMP, "960"),
                                        (NONCE, "f" * 32), (SIGNATURE, "a" * 64), (STAMP, "NaN")])
def test_forged_or_expired_fields(keys, field, value):
    headers = CIMultiDict(sign(read_key(keys), "fictional-owner", 1000))
    headers[field] = value
    with pytest.raises(ValueError):
        Verifier(keys).verify(headers, 1000)


def test_duplicates_missing_fields_and_future_replay_window(keys):
    verify = Verifier(keys)
    headers = CIMultiDict(sign(read_key(keys), "fictional-owner", 1030))
    assert verify.verify(headers, 1000) == "fictional-owner"
    # Cache must retain a future-dated request until timestamp + window, not receipt + window.
    with pytest.raises(ValueError):
        verify.verify(headers, 1040)
    headers = CIMultiDict(sign(read_key(keys), "fictional-owner", 1000))
    headers.add(USER, "other")
    with pytest.raises(ValueError):
        verify.verify(headers, 1000)
    with pytest.raises(ValueError):
        verify.verify(CIMultiDict({USER: "fictional-owner"}), 1000)


@pytest.mark.parametrize("url", ["http://example.com", "https://user:pass@example.com", "https://example.com/a",
                                 "https://example.com?x=1", "https://example.com#fragment", "https://"])
def test_backend_must_be_https_origin(url):
    with pytest.raises(ValueError):
        validate_backend(url)


@pytest.fixture
def certs(tmp_path):
    config = tmp_path / "openssl.cnf"
    config.write_text("[req]\ndistinguished_name=dn\n[dn]\n[v3_req]\n"
                      "subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n")
    cert, key = tmp_path / "receiver.crt", tmp_path / "receiver.key"
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                    "-keyout", str(key), "-out", str(cert), "-subj", "/CN=mantel-test",
                    "-config", str(config), "-extensions", "v3_req"], check=True, capture_output=True)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.load_cert_chain(cert, key)
    return cert, tls


async def test_receiver_identity_role_changes_and_unknown_user(tmp_path, keys):
    store = Store(tmp_path / "db")
    store.link("fictional-owner", "owner", "Fictional <Owner>")
    try:
        async with TestClient(TestServer(build_connect_app(store, keys, clock=lambda: 1000))) as client:
            async def get(user):
                return await client.get(PATH, headers=sign(read_key(keys), user, 1000))
            response = await get("fictional-owner")
            assert response.status == 200
            body = await response.text()
            assert "owner" in body and "Fictional &lt;Owner&gt;" in body
            assert "Set-Cookie" not in response.headers and response.headers["Cache-Control"] == "no-store"
            store.link("fictional-owner", "child")
            assert "<strong>child</strong>" in await (await get("fictional-owner")).text()
            store.unlink("fictional-owner")
            assert (await get("fictional-owner")).status == 403
            assert (await get("unknown-user")).status == 403
            assert (await client.get(PATH, headers={"X-Remote-User-Id": "fictional-owner"})).status == 401
            for route in ("/", "/ws", "/api/entities", "/api/proof2/command"):
                assert (await client.get(route)).status == 404
            assert (await client.post(PATH)).status == 405
            assert (await client.get(PATH + "?x=1")).status == 400
    finally:
        store.db.close()


async def test_full_proxy_tls_flow_and_ingress_boundaries(tmp_path, keys, certs):
    cert, tls = certs
    store = Store(tmp_path / "db")
    store.link("fictional-owner", "owner", "Fictional Owner")
    store.link("fictional-child", "child", "Fictional Child")
    received = []

    @web.middleware
    async def capture(request, handler):
        received.append(dict(request.headers))
        return await handler(request)

    backend = build_connect_app(store, keys, clock=lambda: 1000)
    backend.middlewares.append(capture)
    try:
        server = TestServer(backend, scheme="https")
        await server.start_server(ssl=tls)
        try:
            origin = str(server.make_url("/")).rstrip("/")
            proxy = build_proxy_app(origin, keys, cert, clock=lambda: 1000)
            # Test-only Supervisor simulation; production has no trusted-peer override.
            @web.middleware
            async def supervisor(request, handler):
                return await handler(request.clone(remote=SUPERVISOR))
            proxy.middlewares.append(supervisor)
            async with TestClient(TestServer(proxy)) as client:
                response = await client.get("/", headers={"X-Remote-User-Id": "fictional-owner",
                    "Authorization": "Bearer browser-secret", "Cookie": "browser=secret",
                    USER: "forged-user", SIGNATURE: "forged-signature"})
                assert response.status == 200
                assert "<strong>owner</strong>" in await response.text()
                assert "Authorization" not in received[0] and "Cookie" not in received[0]
                assert received[0][USER] == "fictional-owner"
                response = await client.get("/", headers={"X-Remote-User-Id": "fictional-child"})
                assert response.status == 200 and "<strong>child</strong>" in await response.text()
                assert (await client.get("/", headers={"X-Remote-User-Id": "unlinked"})).status == 403
                count = len(received)
                assert (await client.get("/")).status == 401
                assert len(received) == count
                assert (await client.get("/ws")).status == 404
                assert (await client.post("/")).status == 405
            direct_proxy = build_proxy_app(origin, keys, cert, clock=lambda: 1000)
            async with TestClient(TestServer(direct_proxy)) as client:
                assert (await client.get("/", headers={"X-Remote-User-Id": "fictional-owner",
                                                      "X-Forwarded-For": SUPERVISOR})).status == 403
        finally:
            await server.close()
    finally:
        store.db.close()


@pytest.mark.parametrize("failure", ["redirect", "untrusted_tls"])
async def test_proxy_refuses_redirects_and_untrusted_tls(keys, certs, failure):
    cert, tls = certs
    calls = []

    async def redirect(request):
        calls.append(1)
        raise web.HTTPFound("https://example.invalid/steal")

    backend = web.Application()
    backend.router.add_get(PATH, redirect)
    server = TestServer(backend, scheme="https")
    await server.start_server(ssl=tls)
    try:
        proxy = build_proxy_app(str(server.make_url("/")).rstrip("/"), keys, cert, clock=lambda: 1000)
        if failure == "untrusted_tls":
            # Replace the custom trust bundle with system trust. The test cert is self-signed.
            import mantel_connect.proxy as proxy_module
            original = proxy_module.ssl.create_default_context
            from unittest.mock import patch
            with patch.object(proxy_module.ssl, "create_default_context", side_effect=lambda **kw: original()):
                proxy = build_proxy_app(str(server.make_url("/")).rstrip("/"), keys, cert, clock=lambda: 1000)

        @web.middleware
        async def supervisor(request, handler):
            return await handler(request.clone(remote=SUPERVISOR))

        proxy.middlewares.append(supervisor)
        async with TestClient(TestServer(proxy)) as client:
            response = await client.get("/", headers={"X-Remote-User-Id": "fictional-owner"})
            assert response.status == 502
            assert len(calls) == (1 if failure == "redirect" else 0)
    finally:
        await server.close()


def test_stage_contains_only_app_sources(tmp_path):
    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location("stage_connect", root / "packaging/mantel-connect/stage.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    output = tmp_path / "app"
    module.stage(output)
    assert (output / "mantel_connect/channel.py").is_file()
    assert (output / "Dockerfile").is_file()
    assert not list(output.rglob("*.key")) and not list(output.rglob("*.db"))
    assert not list(output.rglob("__pycache__"))
    with pytest.raises(FileExistsError):
        module.stage(output)
    receiver = tmp_path / "receiver"
    module.stage_receiver(receiver)
    assert not (receiver / "mantel_server/ha/ha_client.py").exists()
    assert not (receiver / "mantel_server/server.py").exists()
    assert not (receiver / "mantel_connect/proxy.py").exists()
    result = subprocess.run([sys.executable, "-m", "mantel_server.connect_proof", "--help"],
                            cwd=receiver, capture_output=True, text=True, check=True)
    assert "--tls-cert" in result.stdout
