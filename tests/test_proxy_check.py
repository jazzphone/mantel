""""Test my proxy" (proxy_check.py): Owner only; finds the usual mistakes of a home's own reverse proxy and
says how to fix them, with Nginx Proxy Manager settings to paste."""
from __future__ import annotations

import json

import pytest

from mantel_server import proxy_check
from https_fakes import make_mantel

PROXY = "192.0.2.20"
GOOD = {"X-Test-Peer": PROXY, "X-Mantel-Door": "lan", "X-Forwarded-For": "192.168.1.40",
        "X-Forwarded-Proto": "https", "X-Forwarded-Host": "mantel.example.com"}


@pytest.fixture
async def m(tmp_path, monkeypatch):
    got = await make_mantel(tmp_path, monkeypatch, trusted_proxies=(PROXY,), proxy_kind="own",
                            public_url="https://mantel.example.com/", allowed_hosts=("mantel.example.com",))
    await got.user("owner", "owner")
    await got.user("adult", "adult")
    status = (await got.client.post("/api/auth/password", json={"username": "owner",
                                    "password": "correct horse battery staple"}, headers=GOOD)).status
    assert status == 200
    yield got
    await got.client.close()
    got.store.db.close()


async def check(m, headers):
    r = await m.client.get(proxy_check.API, headers=headers)
    assert r.status == 200, await r.text()
    body = await r.json()
    return {c["id"]: c for c in body["checks"]}, body


async def test_a_correct_proxy_passes(m):
    checks, body = await check(m, GOOD)
    assert body["door"] == "lan" and body["https"] is True and body["client"] == "192.168.1.40"
    for cid in ("https", "trusted_proxy", "door_header", "forwarded_for", "door_overwrite"):
        assert checks[cid]["ok"] is True, checks[cid]
    assert "proxy_set_header X-Mantel-Door lan;" in body["npm_advanced"]
    assert "X-Mantel-Door: \"lan\"" in body["traefik"]


def report_for(m, peer, headers):
    """The report for a request Mantel cannot hold a session for (another door): the pure part."""
    from unittest import mock
    from aiohttp.test_utils import make_mocked_request
    transport = mock.Mock()
    transport.get_extra_info.side_effect = lambda n, d=None: (peer, 1) if n == "peername" else d
    req = make_mocked_request("GET", proxy_check.API, headers={"Host": "mantel.example.com", **headers},
                              app=m.app, transport=transport)
    got = proxy_check.report(req)
    return {c["id"]: c for c in got["checks"]}, got


async def test_a_missing_door_header_is_found_with_the_fix(m):
    h = {k: v for k, v in GOOD.items() if k not in ("X-Mantel-Door", "X-Test-Peer")}
    checks, body = report_for(m, PROXY, h)
    assert body["door"] == "tunnel"
    assert checks["door_header"]["ok"] is False and "proxy_set_header X-Mantel-Door lan;" in checks["door_header"]["paste"]
    # signed out on that door, the page still learns which door it is (public, nothing configured in it)
    r = await m.client.get(proxy_check.BASICS, headers={"X-Test-Peer": PROXY})
    b = await r.json()
    assert r.status == 200 and b["door"] == "tunnel" and b["via_trusted_proxy"] is True and b["door_header"] is False
    assert PROXY not in json.dumps(b) and b["probe_passed"] is False
    b = await (await m.client.get(proxy_check.BASICS, headers={"X-Test-Peer": PROXY, "X-Mantel-Door": proxy_check.PROBE})).json()
    assert b["probe_passed"] is True and b["door"] == "tunnel"
    b = await (await m.client.get(proxy_check.BASICS, headers={"X-Test-Peer": "192.0.2.99", "X-Mantel-Door": proxy_check.PROBE})).json()
    assert b["probe_passed"] is False and b["via_trusted_proxy"] is False and b["door_header"] is None


async def test_a_proxy_that_passes_the_browsers_door_header_is_found(m):
    h = {k: v for k, v in GOOD.items() if k != "X-Test-Peer"}
    checks, body = report_for(m, PROXY, {**h, "X-Mantel-Door": proxy_check.PROBE})
    assert body["door"] == "tunnel"
    assert checks["door_overwrite"]["ok"] is False


async def test_bypassing_the_proxy_and_plain_http_are_found(m):
    # plain http behind the trusted proxy (through the API), and a browser that went around the proxy
    # (the pure report: its LAN session would not be good on the tunnel door it then arrives by)
    checks, _ = await check(m, {**GOOD, "X-Forwarded-Proto": "http"})
    assert checks["https"]["ok"] is False and "Force SSL" in checks["https"]["fix"]
    got, _ = report_for(m, "192.0.2.99", {})
    assert got["trusted_proxy"]["ok"] is False and "192.0.2.99" in got["trusted_proxy"]["detail"]


async def test_an_internet_client_on_the_lan_door_is_found(m):
    checks, _ = await check(m, {**GOOD, "X-Forwarded-For": "9.9.9.9"})
    assert checks["door_plausible"]["ok"] is False and "tunnel" in checks["door_plausible"]["paste"]


async def test_owner_only_and_the_page(m):
    r = await m.client.get(proxy_check.PAGE, headers=GOOD)
    text = await r.text()
    assert r.status == 200 and "check.js" in text and "script-src 'self'" in r.headers["Content-Security-Policy"]
    assert "wss://mantel.example.com" in r.headers["Content-Security-Policy"]
    js = await m.client.get(proxy_check.PAGE + "/check.js", headers=GOOD)
    assert js.status == 200 and "export async function runProxyCheck" in await js.text()
    assert (await m.client.get(proxy_check.PAGE + "/other.js", headers=GOOD)).status == 404
    async with m.client.ws_connect(proxy_check.WS, headers=GOOD) as ws:
        got = json.loads((await ws.receive(timeout=5)).data)
        assert got["door"] == "lan" and got["trusted"] is True and got["https"] is True
    m.client.session.cookie_jar.clear()
    r = await m.client.get(proxy_check.PAGE, headers={**GOOD, "Accept": "text/html"}, allow_redirects=False)
    assert r.status == 302 and r.headers["Location"].startswith("/login")
    assert (await m.client.get(proxy_check.API, headers=GOOD)).status == 401
    await m.client.post("/api/auth/password", json={"username": "adult", "password": "correct horse battery staple"},
                        headers=GOOD)
    assert (await m.client.get(proxy_check.API, headers=GOOD)).status == 403


def test_the_documented_npm_block_is_the_one_the_check_hands_out():
    """OPERATIONS.md's Nginx Proxy Manager block is exactly what /proxy-check offers to paste (and what
    tools/e2e/compose_e2e.py runs in a real nginx as "your proxy")."""
    from pathlib import Path
    ops = (Path(__file__).resolve().parents[1] / "docs/OPERATIONS.md").read_text()
    block = ops.split("```nginx\n", 1)[1].split("```", 1)[0].rstrip("\n")
    assert block == proxy_check.npm_advanced()
