"""Mantel's own security headers (security_headers.py): on every answer, behind any proxy or none; HSTS only
on https as a trusted proxy (or TLS) says, never through HA's Ingress; pages with a stricter policy keep it."""
from __future__ import annotations

import pytest

from mantel_server import security_headers as sh
from mantel_server.config import Config, parse_args
from https_fakes import make_mantel

PROXY = "192.0.2.20"


def directives(csp: str) -> dict[str, list[str]]:
    return {d.split()[0]: d.split()[1:] for d in csp.split(";") if d.strip()}


def test_the_page_policy_matches_what_packaging_justified():
    d = directives(sh.page_policy(None, "mantel.example.com", https=True))
    assert d["script-src"] == ["'self'"] and d["default-src"] == ["'none'"] and d["object-src"] == ["'none'"]
    assert d["frame-ancestors"] == ["'self'"]                       # HK Settings' preview frames Mantel itself
    assert "wss://mantel.example.com" in d["connect-src"]           # older Safari: 'self' is not wss
    assert d["img-src"] == ["'self'", "data:", "blob:", "https:"]  # providers' album art from any https CDN
    assert "'unsafe-eval'" not in sh.page_policy() and "'unsafe-eval'" not in sh.ma_policy()
    ma = directives(sh.ma_policy())
    assert ma["frame-ancestors"] == ["'self'"] and ma["script-src"] == ["'self'", "'unsafe-inline'"]
    assert sh.headers_for("/go2rtc/api/frame.jpeg")["Content-Security-Policy"].endswith("sandbox")


def test_operator_sources_are_added_and_checked():
    cfg = Config(frame_ancestors=("https://ha.example.com",), csp_connect_src=("https://api.example",),
                 csp_frame_src=("https://frame.example",))
    d = directives(sh.page_policy(cfg, "m.example", https=True))
    assert d["frame-ancestors"] == ["'self'", "https://ha.example.com"]
    assert "https://api.example" in d["connect-src"] and "https://frame.example" in d["frame-src"]
    assert directives(sh.page_policy(Config(frame_ancestors=("'none'",))))["frame-ancestors"] == ["'none'"]
    for bad in ("https://a.example; script-src *", "*", "'unsafe-inline'", "javascript:", "https://a b", ""):
        assert not sh.valid_source(bad), bad
        with pytest.raises(SystemExit):
            parse_args(["--frame-ancestors", bad])
    # a hostile Host never lands in the policy
    assert "evil" not in sh.page_policy(None, "evil.example;script-src *", https=True)


def test_hsts_rules():
    assert "Strict-Transport-Security" in sh.headers_for("/home", https=True)
    assert "Strict-Transport-Security" not in sh.headers_for("/home", https=False)
    assert "Strict-Transport-Security" not in sh.headers_for("/home", https=True, ingress=True)


@pytest.fixture
async def m(tmp_path, monkeypatch):
    got = await make_mantel(tmp_path, monkeypatch, trusted_proxies=(PROXY,))
    yield got
    await got.client.close()
    got.store.db.close()


async def test_every_answer_carries_the_baseline(m):
    for path in ("/api/version", "/healthz", "/api/me", "/nope", "/dashboard-kitchen/home"):
        r = await m.client.get(path, allow_redirects=False)
        h = r.headers
        assert "script-src 'self'" in h["Content-Security-Policy"], path
        assert h["X-Content-Type-Options"] == "nosniff" and h["Referrer-Policy"] == "strict-origin-when-cross-origin"
        assert "microphone=(self)" in h["Permissions-Policy"] and h["Cross-Origin-Resource-Policy"] == "same-origin"
        assert "Server" not in h, path
        assert "Strict-Transport-Security" not in h, path          # plain http on loopback


async def test_a_stricter_page_policy_is_kept(m):
    r = await m.client.get("/login")
    assert "style-src 'self';" in r.headers["Content-Security-Policy"]     # login_page's own, not the baseline
    assert r.headers.getall("Content-Security-Policy") == [r.headers["Content-Security-Policy"]]


async def test_hsts_only_when_the_trusted_proxy_says_https(m):
    r = await m.client.get("/api/version", headers={"X-Test-Peer": PROXY, "X-Forwarded-Proto": "https",
                                                    "X-Mantel-Door": "lan"})
    assert r.headers["Strict-Transport-Security"] == "max-age=31536000"
    assert "wss://" in r.headers["Content-Security-Policy"]
    r = await m.client.get("/api/version", headers={"X-Test-Peer": "192.0.2.99", "X-Forwarded-Proto": "https"})
    assert "Strict-Transport-Security" not in r.headers


async def test_the_websocket_handshake_carries_them_too(m):
    await m.user("owner", "owner")
    await m.sign_in("owner")
    async with m.client.ws_connect("/ws") as ws:
        assert "script-src 'self'" in ws._response.headers["Content-Security-Policy"]


def test_config_and_entrypoint_take_the_new_settings(tmp_path):
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "packaging/docker"))
    import entrypoint
    env = {"MANTEL_HA_URL": "http://ha.local:8123", "MANTEL_PUBLIC_URL": "https://mantel.example.com/",
           "MANTEL_TRUSTED_PROXY": "192.0.2.20", "MANTEL_GO2RTC_URL": "http://go2rtc:1984",
           "MANTEL_MA_WEB_URL": "http://192.0.2.30:8095/", "MANTEL_FRAME_ANCESTORS": "https://ha.example.com, https://b.example",
           "MANTEL_CONNECT_SRC": "https://api.example", "MANTEL_PROXY_KIND": "own"}
    args, _ = entrypoint.plan([], env, options_path=tmp_path / "none")
    cfg = parse_args(args)
    assert cfg.go2rtc_url == "http://go2rtc:1984" and cfg.ma_web_url == "http://192.0.2.30:8095/"
    assert cfg.frame_ancestors == ("https://ha.example.com", "https://b.example")
    assert cfg.csp_connect_src == ("https://api.example",) and cfg.proxy_kind == "own"
    assert cfg.trusted_proxies == ("192.0.2.20",)
    with pytest.raises(entrypoint.ConfigError):
        entrypoint.plan([], {**env, "MANTEL_PROXY_KIND": "nginx"}, options_path=tmp_path / "none")
    for bad in (["--go2rtc-url", "ftp://x"], ["--ma-web-url", "go2rtc"]):
        with pytest.raises(SystemExit):
            parse_args(bad)
