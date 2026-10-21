"""Bring your own reverse proxy: what Mantel believes, and from whom (proxy_trust.py, authz.resolve_door,
sessions.client_ip). The proxy is "trusted" only by its socket address (--trusted-proxy); the door
header counts only from it and its absence there means the tunnel (fail closed); forwarding headers
count only from it; HA identity headers never count except through HA's Ingress."""
from __future__ import annotations

from unittest import mock

import pytest
from aiohttp import web
from aiohttp.test_utils import make_mocked_request

from mantel_server import proxy_trust
from mantel_server.config import Config
from https_fakes import make_mantel

PROXY = "192.0.2.20"        # the home's own proxy (Nginx Proxy Manager), as Mantel sees it
STRANGER = "192.0.2.99"     # a LAN browser that went around the proxy


def mocked(peer, headers, **cfg):
    app = web.Application()
    app["cfg"] = Config(**cfg)
    transport = mock.Mock()
    transport.get_extra_info.side_effect = lambda name, default=None: (peer, 4321) if name == "peername" else default
    return make_mocked_request("GET", "/home", headers=headers, app=app, transport=transport)


ALL = {"X-Forwarded-For": "203.0.113.5", "X-Forwarded-Proto": "https", "X-Forwarded-Host": "evil.example",
       "Forwarded": "for=203.0.113.5", "X-Real-IP": "203.0.113.5", "X-Mantel-Door": "lan",
       "X-Remote-User-Id": "a" * 32, "X-Remote-User-Name": "owner", "X-Ingress-Path": "/api/hassio_ingress/x",
       "X-Hass-Source": "core.ingress"}
IDENTITY = {"X-Remote-User-Id", "X-Remote-User-Name", "X-Ingress-Path", "X-Hass-Source"}
FORWARDING = {"X-Forwarded-For", "X-Forwarded-Proto", "X-Forwarded-Host", "Forwarded", "X-Real-IP"}


def test_what_each_peer_loses():
    # someone who is not the proxy: everything that would claim something
    assert set(proxy_trust.to_remove(mocked(STRANGER, ALL, trusted_proxies=(PROXY,)))) == IDENTITY | FORWARDING | {"X-Mantel-Door"}
    # the trusted proxy keeps forwarding and the door, but never names a person
    assert set(proxy_trust.to_remove(mocked(PROXY, ALL, trusted_proxies=(PROXY,)))) == IDENTITY
    # HA's Ingress proxy (HA App mode) keeps all of it: ingress.py reads them
    assert proxy_trust.to_remove(mocked("172.30.32.2", ALL, ingress=True)) == []
    # ... but the same peer without Ingress mode is nobody
    assert set(proxy_trust.to_remove(mocked("172.30.32.2", ALL))) == IDENTITY | FORWARDING | {"X-Mantel-Door"}
    # loopback (the prototype; the tests' "tunnel" claims) keeps its door claim, not forwarding
    assert set(proxy_trust.to_remove(mocked("127.0.0.1", ALL))) == IDENTITY | FORWARDING
    assert proxy_trust.to_remove(mocked(STRANGER, {"Accept": "text/html"})) == []


def test_https_and_host_only_from_the_trusted_proxy():
    h = {"X-Forwarded-Proto": "https", "X-Forwarded-Host": "mantel.example.com"}
    assert proxy_trust.is_https(mocked(PROXY, h, trusted_proxies=(PROXY,))) is True
    assert proxy_trust.public_host(mocked(PROXY, h, trusted_proxies=(PROXY,))) == "mantel.example.com"
    assert proxy_trust.is_https(mocked(STRANGER, h, trusted_proxies=(PROXY,))) is False
    assert proxy_trust.public_host(mocked(STRANGER, {**h, "Host": "m.lan"}, trusted_proxies=(PROXY,))) == "m.lan"
    assert proxy_trust.is_https(mocked(PROXY, {"X-Forwarded-Proto": "gopher"}, trusted_proxies=(PROXY,))) is False


@pytest.fixture
async def byo(tmp_path, monkeypatch):
    m = await make_mantel(tmp_path, monkeypatch, trusted_proxies=(PROXY,))
    await m.user("owner", "owner")
    yield m
    await m.client.close()
    m.store.db.close()


async def session_of(m, peer, headers=None):
    r = await m.client.get("/api/session", headers={"X-Test-Peer": peer, **(headers or {})})
    assert r.status == 200, await r.text()
    return await r.json()


async def test_the_door_through_your_own_proxy(byo):
    m = byo
    await m.sign_in("owner", headers={"X-Test-Peer": PROXY, "X-Mantel-Door": "lan", "X-Forwarded-For": "192.168.1.40"})
    assert (await session_of(m, PROXY, {"X-Mantel-Door": "lan"}))["door"] == "lan"
    # the same LAN session is no good on the tunnel door (sessions are bound to their door)
    r = await m.client.get("/api/session", headers={"X-Test-Peer": PROXY, "X-Mantel-Door": "tunnel"})
    assert r.status == 401


async def password(m, peer, headers=None):
    r = await m.client.post("/api/auth/password", json={"username": "owner", "password": "correct horse battery staple"},
                            headers={"X-Test-Peer": peer, **(headers or {})})
    return r.status, await r.json()


async def test_a_missing_door_header_from_the_proxy_is_the_tunnel(byo):
    # the tunnel door asks an Owner for a second factor; the LAN door does not
    status, body = await password(byo, PROXY)
    assert body.get("error") == "second_factor_required"
    status, body = await password(byo, PROXY, {"X-Mantel-Door": "lan"})
    assert status == 200 and body["session"]["door"] == "lan"


async def test_nobody_else_can_claim_the_lan_door(byo):
    for peer in (STRANGER, "172.31.251.2"):
        status, body = await password(byo, peer, {"X-Mantel-Door": "lan"})
        assert body.get("error") == "second_factor_required", peer


async def test_forwarded_client_address_only_from_the_proxy(byo):
    from mantel_server import sessions
    status, _ = await password(byo, PROXY, {"X-Mantel-Door": "lan", "X-Forwarded-For": "203.0.113.1, 192.168.1.40"})
    assert status == 200
    ips = {r["source_ip"] for r in byo.store.db.execute("SELECT source_ip FROM sessions")}
    assert ips == {"192.168.1.40"}
    assert sessions.client_ip(mocked(STRANGER, {"X-Forwarded-For": "192.168.1.41"}, trusted_proxies=(PROXY,))) == STRANGER
    assert sessions.client_ip(mocked(PROXY, {"X-Forwarded-For": "192.168.1.41"}, trusted_proxies=(PROXY,))) == "192.168.1.41"


async def test_identity_headers_never_sign_anyone_in(byo):
    m = byo
    m.client.session.cookie_jar.clear()
    spoof = {"X-Remote-User-Id": "a" * 32, "X-Remote-User-Name": "owner", "X-Ingress-Path": "/api/hassio_ingress/x"}
    for peer in (PROXY, STRANGER, "127.0.0.1"):
        r = await m.client.get("/api/session", headers={"X-Test-Peer": peer, "X-Mantel-Door": "lan", **spoof})
        assert r.status == 401, peer


async def test_health_is_hidden_from_the_outside_behind_your_proxy(byo):
    assert (await byo.client.get("/healthz", headers={"X-Test-Peer": PROXY})).status == 404
    assert (await byo.client.get("/healthz")).status == 200          # the healthcheck, on loopback


async def test_a_spoofed_forwarded_host_or_proto_does_not_change_anything(byo):
    m = byo
    r = await m.client.get("/login", headers={"X-Test-Peer": STRANGER, "X-Forwarded-Proto": "https",
                                              "X-Forwarded-Host": "evil.example"})
    assert r.status == 200 and "Strict-Transport-Security" not in r.headers


def test_every_forwarded_for_line_counts_not_the_first_only():
    """A proxy that adds a line of its own (HAProxy's option forwardfor) leaves the browser's line first: reading
    only the first, the browser chose its own address (a fresh one per try past the sign-in limit)."""
    from multidict import CIMultiDict

    from mantel_server import sessions
    headers = CIMultiDict([("X-Forwarded-For", "10.9.9.9"), ("X-Forwarded-For", "203.0.113.50")])
    assert sessions.client_ip(mocked(PROXY, headers, trusted_proxies=(PROXY,))) == "203.0.113.50"


def test_the_tunnel_door_hands_mantel_the_visitors_address_not_cloudflareds():
    """Caddy appended cloudflared's address to X-Forwarded-For and Mantel takes the last hop: every remote visitor
    was cloudflared, sharing one sign-in limit (20 bad tries from anyone locked everyone out from away). The
    client is Cf-Connecting-Ip, believed from cloudflared only, sent to Mantel alone (checked against Caddy 2.10)."""
    import re
    from pathlib import Path
    text = (Path(__file__).resolve().parents[1] / "packaging/compose/caddy/Caddyfile").read_text()
    servers = text[text.index("servers {"):text.index("log {")]
    assert "trusted_proxies static {$MANTEL_CLOUDFLARED_IP:172.31.250.3}" in servers
    assert re.search(r"^\s*client_ip_headers Cf-Connecting-Ip\s*$", servers, re.M)
    tunnel = text[text.index("http://:8080 {"):text.index("# ---- Caddy's own healthcheck")]
    assert re.search(r"reverse_proxy mantel-backend:8765 \{\s*header_up X-Forwarded-For \{client_ip\}\s*\}", tunnel)
