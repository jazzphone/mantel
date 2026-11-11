"""The push relay (packaging/push-relay/, docs/phase10/APPLE-APPS.md §13): the Worker's own tests in Node, and the house
(apns.Relay) talking to the real Worker code served locally, with Apple faked. Fictional keys only."""
from __future__ import annotations

import asyncio
import json
import shutil
import socket
import subprocess
from pathlib import Path

import aiohttp
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from mantel_server import apns, push
from mantel_server.apps import app_crypto

ROOT = Path(__file__).resolve().parents[1]
RELAY = ROOT / "packaging/push-relay"
needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="needs node")


@needs_node
def test_the_workers_own_tests():
    out = subprocess.run(["node", str(RELAY / "test/relay.test.mjs")], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stdout + out.stderr
    assert "relay tests passed" in out.stdout


def test_the_relay_holds_no_secret_in_the_repo():
    toml = (RELAY / "wrangler.toml").read_text()
    assert "PRIVATE KEY" not in toml and "APNS_KEY =" not in toml
    assert "never in this file" in toml


@pytest.fixture
def relay_server():
    if shutil.which("node") is None:
        pytest.skip("needs node")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    proc = subprocess.Popen(["node", str(RELAY / "test/serve.mjs"), str(port)], stdout=subprocess.PIPE, text=True)
    assert proc.stdout.readline().strip() == "ready"
    yield f"http://127.0.0.1:{port}"
    proc.terminate()
    proc.wait(5)


async def test_a_house_pushes_to_a_phone_through_the_worker(mantel, relay_server):
    from test_app_auth import sign_in_app
    m = mantel
    st = m.app["app_auth"]
    st.set_setting(apns.RELAY_SETTING, relay_server)
    hello = await (await m.client.get("/api/app/hello")).json()
    assert hello["push"] == {"relay": relay_server}                 # the app is told to use the relay
    # the phone registers with the relay for this house (with the house key it pinned), then gives the house the handle
    async with aiohttp.ClientSession() as http:
        r = await http.post(relay_server + "/v1/register",
                            json={"token": "cd" * 32, "env": "sandbox", "house_key": hello["key"]})
        reg = await r.json()
    assert r.status == 201 and reg["house"] == st.fingerprint()      # the Worker and the house agree on the fingerprint
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    note = ec.generate_private_key(ec.SECP256R1())
    r, got = await phone.call("POST", "/api/app/push/register",
                              {"handle": reg["handle"], "key": app_crypto.b64u(app_crypto.raw_public(note.public_key()))})
    assert r.status == 201
    p = m.app["pusher"]
    counts = await p.deliver(p.recipients({"type": "notification"}), push.Message("Front Door", "Opened", tag="door"))
    assert counts == {"ok": 1}
    async with aiohttp.ClientSession() as http:
        sent = await (await http.get(relay_server + "/__sent")).json(content_type=None)
    assert sent[-1]["url"] == "https://api.sandbox.push.apple.com/3/device/" + "cd" * 32
    inner = json.loads(app_crypto.open_sealed(sent[-1]["body"]["m"], note))
    assert inner["title"] == "Front Door"                            # sealed end to end through the relay
    assert "Front Door" not in json.dumps(sent[-1]["body"]["aps"])
    # signing the app out forgets the handle at the relay too
    assert (await phone.call("POST", "/api/app/sign-out"))[0].status == 200
    await asyncio.sleep(0.3)
    status, body = await m.app["push_relay"].call("/v1/send", {"handle": reg["handle"], "payload": {"aps": {}}})
    assert status == 404


async def test_a_house_cannot_be_impersonated(mantel, relay_server):
    m = mantel
    st = m.app["app_auth"]
    st.set_setting(apns.RELAY_SETTING, relay_server)
    hello = await (await m.client.get("/api/app/hello")).json()
    async with aiohttp.ClientSession() as http:
        reg = await (await http.post(relay_server + "/v1/register",
                                     json={"token": "ef" * 32, "env": "sandbox", "house_key": hello["key"]})).json()
    # another key signing in this house's name is refused
    st._key, real = ec.generate_private_key(ec.SECP256R1()), st.key()
    fp = st.fingerprint
    st.fingerprint = lambda: app_crypto.fingerprint(real.public_key())
    status, _ = await m.app["push_relay"].call("/v1/send", {"handle": reg["handle"], "payload": {"aps": {}}})
    assert status == 401
    st._key, st.fingerprint = real, fp
    status, _ = await m.app["push_relay"].call("/v1/send", {"handle": reg["handle"], "payload": {"aps": {"alert": "x"}}})
    assert status == 200
