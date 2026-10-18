"""Mantel Connect: guided pairing, the mutual-TLS listener, the identity rules and the Connect App's proxy.

Everything here is real TLS on 127.0.0.1 with fictional people; no Home Assistant is contacted. The server
side is a full Mantel app whose Connect listener runs on its own port; the "App" side is the real
mantel_connect.pairing / mantel_connect.app code.
"""
from __future__ import annotations

import asyncio
import json
import logging
import ssl
import time
from pathlib import Path

import aiohttp
import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.x509.oid import NameOID

from mantel_connect import app as connect_app
from mantel_connect import pairing, pki, protocol
from mantel_server import connect_pairing

OWNER_HA = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
STRANGER_HA = "99999999999999999999999999999999"
PREFIX = "/api/hassio_ingress/Fict1onal-Ingress_Token"
PAGE = {"Sec-Fetch-Dest": "document", "Accept": "text/html"}


def ha_headers(user=OWNER_HA, **extra):
    h = {"X-Ingress-Path": PREFIX, "X-Remote-User-Id": user, "X-Remote-User-Name": "fictional",
         "X-Remote-User-Display-Name": "Fictional Owner", "X-Forwarded-For": "192.0.2.10, 172.30.32.1",
         "X-Forwarded-Proto": "http", "X-Forwarded-Host": "ha.example:8123"}
    h.update(extra)
    return h


class Server:
    def __init__(self, app, runner, main_port, connect_port, store, now):
        self.app, self.runner, self.main_port, self.connect_port = app, runner, main_port, connect_port
        self.store, self.now = store, now

    @property
    def mgr(self) -> connect_pairing.Connect:
        return self.app["connect"]

    def audit(self, action=None):
        rows = self.app["audit"].rows(kind="config")
        return [r for r in rows if action is None or r["action"] == action]

    def paired_context(self, files: pairing.Files):
        return pki.client_context(files.ca.read_text(), files.cert, files.key)

    async def get(self, files, path, headers=None, **kw):
        async with aiohttp.ClientSession(cookie_jar=aiohttp.DummyCookieJar()) as http:
            return await self._do(http, "GET", files, path, headers, **kw)

    async def _do(self, http, method, files, path, headers, **kw):
        ssl_ctx = self.paired_context(files) if files is not None else pki.unverified_context()
        async with http.request(method, f"https://127.0.0.1:{self.connect_port}{path}", headers=headers, ssl=ssl_ctx,
                                allow_redirects=False, **kw) as r:
            return r.status, dict(r.headers), await r.read()


@pytest.fixture
async def srv(tmp_path, monkeypatch):
    from mantel_server.config import Config
    from mantel_server.ha_client import HaClient
    from mantel_server.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("connect tests attempted upstream access")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, ingress=True, ingress_peers=(),
                 connect=True, connect_port=0, connect_listen="127.0.0.1", ha_door_rules="trusted",
                 hk_files=tmp_path / "none", fixtures=tmp_path / "none")
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: now[0])
    runner = web.AppRunner(app)
    await runner.setup()
    main = web.TCPSite(runner, "127.0.0.1", 0)
    await main.start()
    conn = web.TCPSite(runner, "127.0.0.1", 0, ssl_context=app["connect"].ssl_ctx)
    await conn.start()
    s = Server(app, runner, main._server.sockets[0].getsockname()[1], conn._server.sockets[0].getsockname()[1],
               store, now)
    yield s
    await runner.cleanup()
    store.db.close()


async def do_pair(srv, tmp_path, name="test", code=None, folder="app"):
    got = code or srv.mgr.start("owner-id")["code"]
    files = pairing.Files(tmp_path / folder)
    await pairing.pair("127.0.0.1", srv.connect_port, got, files, name)
    return files, got


# -- the code: single use, expiry, wrong proofs, rate limits ---------------------------------------------------
async def test_pairing_exchange_stores_both_sides_and_is_audited(srv, tmp_path, caplog):
    with caplog.at_level(logging.DEBUG):
        code = srv.mgr.start("owner-id")["code"]
        files = pairing.Files(tmp_path / "app")
        info = await pairing.pair("127.0.0.1", srv.connect_port, code, files, "Mantel Connect (test)")
    assert files.paired() and info["pairing_id"]
    for f in (files.key, files.cert, files.ca, files.info):
        assert f.stat().st_mode & 0o777 == 0o600, f
    row = srv.store.db.execute("SELECT * FROM connect_pairings").fetchone()
    assert row["id"] == info["pairing_id"] and row["name"] == "Mantel Connect (test)" and row["revoked"] is None
    assert row["cert_fp"] == pki.cert_fp(files.cert.read_text())
    assert srv.store.db.execute("SELECT COUNT(*) FROM connect_codes").fetchone()[0] == 0     # spent
    actions = [r["action"] for r in srv.audit()]
    assert actions == ["connect.pair_start", "connect.pair_ok"]
    # nothing secret anywhere durable or logged: not the code, not its key, not a private key
    raw = code.replace("-", "")
    blob = json.dumps([dict(r) for r in srv.app["audit"].rows()]) + caplog.text
    assert raw not in blob and code not in blob and protocol.code_key(raw).hex() not in blob
    assert "PRIVATE" not in blob
    srv.store.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    dbfiles = b"".join(p.read_bytes() for p in (tmp_path / "data").glob("mantel.db*"))
    assert raw.encode() not in dbfiles and protocol.code_key(raw).hex().encode() not in dbfiles
    assert (tmp_path / "data/connect/ca.key").stat().st_mode & 0o777 == 0o600
    assert (tmp_path / "data/connect/server.key").stat().st_mode & 0o777 == 0o600
    assert (tmp_path / "data/connect").stat().st_mode & 0o777 == 0o700


async def test_a_code_is_single_use(srv, tmp_path):
    files, code = await do_pair(srv, tmp_path)
    with pytest.raises(pairing.PairError, match="refused the code"):
        await pairing.pair("127.0.0.1", srv.connect_port, code, pairing.Files(tmp_path / "second"))
    assert not pairing.Files(tmp_path / "second").paired()
    assert srv.store.db.execute("SELECT COUNT(*) FROM connect_pairings").fetchone()[0] == 1


async def test_a_code_expires(srv, tmp_path):
    code = srv.mgr.start("owner-id")["code"]
    srv.now[0] += protocol.CODE_TTL + 1
    with pytest.raises(pairing.PairError, match="refused the code"):
        await pairing.pair("127.0.0.1", srv.connect_port, code, pairing.Files(tmp_path / "late"))
    assert srv.store.db.execute("SELECT COUNT(*) FROM connect_codes").fetchone()[0] == 0
    # and just inside the window it works
    code = srv.mgr.start("owner-id")["code"]
    srv.now[0] += protocol.CODE_TTL - 1
    await pairing.pair("127.0.0.1", srv.connect_port, code, pairing.Files(tmp_path / "ontime"))


async def test_wrong_code_is_refused_and_five_wrong_proofs_burn_the_real_one(srv, tmp_path):
    code = srv.mgr.start("owner-id")["code"]
    raw = protocol.normalize_code(code)
    wrong = protocol.format_code(raw[:5] + ("A" if raw[5] != "A" else "B") * 15)       # right id, wrong secret
    for i in range(connect_pairing.MAX_WRONG):
        with pytest.raises(pairing.PairError, match="refused the code"):
            await pairing.pair("127.0.0.1", srv.connect_port, wrong, pairing.Files(tmp_path / f"w{i}"))
    # burned: the right code no longer works either
    with pytest.raises(pairing.PairError, match="refused the code"):
        await pairing.pair("127.0.0.1", srv.connect_port, code, pairing.Files(tmp_path / "right"))
    failed = srv.audit("connect.pair_failed")
    assert len(failed) == connect_pairing.MAX_WRONG and json.loads(failed[-1]["target"])["burned"] is True
    assert srv.store.db.execute("SELECT COUNT(*) FROM connect_pairings").fetchone()[0] == 0


async def test_unknown_code_is_refused_with_the_same_answer(srv, tmp_path):
    srv.mgr.start("owner-id")
    other = protocol.new_code()
    with pytest.raises(pairing.PairError, match="refused the code"):
        await pairing.pair("127.0.0.1", srv.connect_port, other, pairing.Files(tmp_path / "x"))
    async with aiohttp.ClientSession() as http:       # the raw answer says nothing about which part failed
        body = {"v": 1, "pair_id": "ZZZZZ", "name": "x", "nonce": "0" * 32, "public_key": pki.public_pem(pki.new_key()),
                "proof": "0" * 64}
        async with http.post(f"https://127.0.0.1:{srv.connect_port}{protocol.PAIR_PATH}", json=body,
                             ssl=pki.unverified_context()) as r:
            assert r.status == 403 and await r.json() == {"error": "pairing_failed"}


async def test_failed_exchanges_are_rate_limited_per_address_and_overall(srv, tmp_path):
    srv.mgr.start("owner-id")
    stray = protocol.new_code()
    for i in range(connect_pairing.IP_FAILS):
        with pytest.raises(pairing.PairError, match="refused the code"):
            await pairing.pair("127.0.0.1", srv.connect_port, stray, pairing.Files(tmp_path / f"r{i}"))
    with pytest.raises(pairing.PairError, match="too many"):
        await pairing.pair("127.0.0.1", srv.connect_port, stray, pairing.Files(tmp_path / "blocked"))
    # while blocked, even the real code is turned away; it is accepted again once the window passes
    code = srv.mgr.start("owner-id")["code"]
    with pytest.raises(pairing.PairError, match="too many"):
        await pairing.pair("127.0.0.1", srv.connect_port, code, pairing.Files(tmp_path / "blocked2"))
    srv.now[0] += connect_pairing.IP_WINDOW + 1
    code = srv.mgr.start("owner-id")["code"]                          # (the first one has expired meanwhile)
    await pairing.pair("127.0.0.1", srv.connect_port, code, pairing.Files(tmp_path / "ok"))
    assert len(srv.audit("connect.pair_rate_limited")) == 1          # one audit row per window, not per request


async def test_starting_another_code_withdraws_the_earlier_one(srv, tmp_path):
    first = srv.mgr.start("owner-id")["code"]
    second = srv.mgr.start("owner-id")["code"]
    with pytest.raises(pairing.PairError, match="refused the code"):
        await pairing.pair("127.0.0.1", srv.connect_port, first, pairing.Files(tmp_path / "a"))
    await pairing.pair("127.0.0.1", srv.connect_port, second, pairing.Files(tmp_path / "b"))
    assert srv.mgr.cancel(None) is False


async def test_a_man_in_the_middle_with_another_certificate_cannot_pair(srv, tmp_path):
    """The client's proof covers the certificate it saw: a different listener (other certificate) cannot
    be the one the code was issued for, and a server that does not know the code cannot answer."""
    code = srv.mgr.start("owner-id")["code"]
    key = pki.new_key()
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "impostor")])
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(1).not_valid_before(pki.utc(time.time() - 60)).not_valid_after(pki.utc(time.time() + 3600))
            .sign(key, hashes.SHA256()))
    (tmp_path / "evil.crt").write_text(pki.cert_pem(cert))
    pki.write_private(tmp_path / "evil.key", pki.private_pem(key))
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(tmp_path / "evil.crt", tmp_path / "evil.key")
    seen = []

    async def evil_pair(request):
        seen.append(await request.json())                  # everything the client sent: a proof, no secret
        return web.json_response({"v": 1, "pairing_id": "0" * 16, "ca_cert": pki.cert_pem(cert),
                                  "client_cert": pki.cert_pem(cert), "expires": 1, "proof": "0" * 64})

    evil = web.Application()
    evil.router.add_post(protocol.PAIR_PATH, evil_pair)
    runner = web.AppRunner(evil)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0, ssl_context=ctx)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    try:
        files = pairing.Files(tmp_path / "victim")
        with pytest.raises(pairing.PairError, match="did not prove"):
            await pairing.pair("127.0.0.1", port, code, files)
        assert not files.paired() and not files.key.exists()
    finally:
        await runner.cleanup()
    # what the impostor learned cannot be turned into a pairing on the real server: its proof is bound to the
    # impostor's certificate fingerprint, which the real server does not have
    assert seen and protocol.normalize_code(code) not in json.dumps(seen)
    replay = dict(seen[0])
    async with aiohttp.ClientSession() as http:
        async with http.post(f"https://127.0.0.1:{srv.connect_port}{protocol.PAIR_PATH}", json=replay,
                             ssl=pki.unverified_context()) as r:
            assert r.status == 403
    assert srv.store.db.execute("SELECT COUNT(*) FROM connect_pairings").fetchone()[0] == 0


async def test_malformed_pairing_requests(srv):
    async with aiohttp.ClientSession() as http:
        url = f"https://127.0.0.1:{srv.connect_port}{protocol.PAIR_PATH}"
        for payload in ([], {"v": 2}, {"v": 1, "pair_id": "A" * 5, "name": "x\ny", "nonce": "0" * 32,
                                       "public_key": "nope", "proof": "0" * 64}):
            async with http.post(url, json=payload, ssl=pki.unverified_context()) as r:
                assert r.status == 400, payload
        async with http.post(url, data=b"x" * 20000, ssl=pki.unverified_context()) as r:
            assert r.status == 400
        async with http.get(url, ssl=pki.unverified_context()) as r:
            assert r.status == 405
        # an RSA key is not accepted
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization
        rsa_pem = rsa.generate_private_key(65537, 2048).public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode()
        body = {"v": 1, "pair_id": "A" * 5, "name": "x", "nonce": "0" * 32, "public_key": rsa_pem, "proof": "0" * 64}
        async with http.post(url, json=body, ssl=pki.unverified_context()) as r:
            assert r.status == 400


# -- after pairing: mutual TLS, pinning, revocation, renewal ---------------------------------------------------
async def test_only_a_paired_certificate_gets_past_the_listener(srv, tmp_path):
    files, _ = await do_pair(srv, tmp_path)
    status, _, body = await srv.get(files, protocol.PING_PATH)
    assert status == 200 and json.loads(body)["ok"] is True
    status, _, body = await srv.get(None, protocol.PING_PATH)                   # no client certificate
    assert status == 401 and json.loads(body)["error"] == "client_certificate_required"
    status, _, _ = await srv.get(None, "/api/me", ha_headers())                  # identity headers alone: nothing
    assert status == 401
    # a certificate from another CA never completes the handshake
    other = pairing.Files(tmp_path / "other")
    other_pki = connect_pairing.Pki(tmp_path / "otherca")
    other_pki.ensure()
    key = pki.new_key()
    cert = other_pki.issue_client(pki.public_pem(key), "0" * 16)
    other.write(srv.mgr.pki.ca_pem, pki.cert_pem(cert), pki.private_pem(key), {"address": "x"})
    with pytest.raises((aiohttp.ClientError, ssl.SSLError, OSError)):
        await srv.get(other, protocol.PING_PATH)
    # a certificate from OUR CA that was never issued through a pairing is refused by the pin
    forged = srv.mgr.pki.issue_client(pki.public_pem(key), "f" * 16)
    stray = pairing.Files(tmp_path / "stray")
    stray.write(srv.mgr.pki.ca_pem, pki.cert_pem(forged), pki.private_pem(key), {"address": "x"})
    status, _, _ = await srv.get(stray, protocol.PING_PATH)
    assert status == 401


async def test_the_listener_certificate_chains_to_the_pinned_ca_only(srv, tmp_path):
    files, _ = await do_pair(srv, tmp_path)
    other_ca = connect_pairing.Pki(tmp_path / "otherca2")
    other_ca.ensure()
    ctx = pki.client_context(other_ca.ca_pem, files.cert, files.key)           # trusts the wrong authority
    async with aiohttp.ClientSession() as http:
        with pytest.raises(aiohttp.ClientConnectorCertificateError):
            async with http.get(f"https://127.0.0.1:{srv.connect_port}{protocol.PING_PATH}", ssl=ctx):
                pass


async def test_revocation_cuts_the_app_off_at_once_and_is_audited(srv, tmp_path):
    files, _ = await do_pair(srv, tmp_path)
    pid = files.read_info()["pairing_id"]
    # an open connection is closed by the revocation, not only refused next time
    reader, writer = await asyncio.open_connection("127.0.0.1", srv.connect_port, ssl=srv.paired_context(files))
    writer.write(b"GET /connect/v1/ping HTTP/1.1\r\nHost: x\r\n\r\n")
    head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 5)
    assert head.startswith(b"HTTP/1.1 200")
    await reader.readexactly(int(head.lower().split(b"content-length: ")[1].split(b"\r\n")[0]))
    assert srv.mgr.revoke(pid, "owner-id", "owner", "lost the HA box")
    try:
        assert await asyncio.wait_for(reader.read(), 5) == b""
    except (ConnectionError, ssl.SSLError):
        pass
    writer.close()
    status, _, body = await srv.get(files, protocol.PING_PATH)
    assert status == 401 and json.loads(body)["error"] == "pairing_revoked"
    assert not srv.mgr.revoke(pid, "owner-id")                                   # already
    rows = srv.audit("connect.revoke")
    assert len(rows) == 1 and rows[0]["actor"] == "owner-id" and pid in rows[0]["target"]
    assert len(srv.audit("connect.refused_revoked")) == 1
    # revocation is final: pairing again gives a NEW pairing
    files2, _ = await do_pair(srv, tmp_path, folder="again")
    assert files2.read_info()["pairing_id"] != pid
    assert (await srv.get(files2, protocol.PING_PATH))[0] == 200


async def test_renewal_replaces_the_certificate_and_the_old_one_lapses(srv, tmp_path):
    files, _ = await do_pair(srv, tmp_path)
    old_fp = pki.cert_fp(files.cert.read_text())
    old_ctx_files = pairing.Files(tmp_path / "old")
    old_ctx_files.write(files.ca.read_text(), files.cert.read_text(), files.key.read_bytes(), {"address": "x"})
    assert await pairing.renew(files, "127.0.0.1", srv.connect_port)
    assert pki.cert_fp(files.cert.read_text()) != old_fp
    assert (await srv.get(files, protocol.PING_PATH))[0] == 200
    assert (await srv.get(old_ctx_files, protocol.PING_PATH))[0] == 200           # one day of grace
    assert not await pairing.renew(files, "127.0.0.1", srv.connect_port)          # too soon after the last
    srv.now[0] += connect_pairing.PREV_GRACE + 1
    assert (await srv.get(old_ctx_files, protocol.PING_PATH))[0] == 401
    assert (await srv.get(files, protocol.PING_PATH))[0] == 200
    assert len(srv.audit("connect.renew")) == 1


async def test_a_revoked_app_cannot_renew(srv, tmp_path):
    files, _ = await do_pair(srv, tmp_path)
    srv.mgr.revoke(files.read_info()["pairing_id"], None)
    assert not await pairing.renew(files, "127.0.0.1", srv.connect_port)


def test_the_listener_certificate_is_renewed_when_due(tmp_path):
    p = connect_pairing.Pki(tmp_path / "c", server_days=90, renew_before_days=30)
    assert p.ensure() is True
    first = p.server_fp
    assert p.ensure() is False and p.server_fp == first
    late = connect_pairing.Pki(tmp_path / "c", cert_clock=lambda: time.time() + 70 * 86400)
    assert late.ensure() is True and late.server_fp != first
    # the CA does not change: pairings survive the listener's renewal
    assert late.ca_pem == p.ca_pem


def test_the_cli_pairs_lists_and_revokes(tmp_path, capsys):
    from mantel_server import db
    from mantel_server.__main__ import main
    data = str(tmp_path / "data")
    assert main(["connect", "pair", "--data-dir", data, "--address", "mantel.lan:8766"]) == 0
    out = capsys.readouterr().out
    code = next(w for w in out.split() if protocol.normalize_code(w))
    assert "mantel.lan:8766" in out and "10 minutes" in out
    database = db.Database(tmp_path / "data" / "mantel.db")
    assert database.conn.execute("SELECT id FROM connect_codes").fetchone()[0] == protocol.code_id(protocol.normalize_code(code))
    database.close()
    assert main(["connect", "status", "--data-dir", data]) == 0
    assert "pending code: yes" in capsys.readouterr().out
    assert main(["connect", "cancel", "--data-dir", data]) == 0
    assert "withdrawn" in capsys.readouterr().out
    assert main(["connect", "revoke", "--id", "0" * 16, "--data-dir", data]) == 0
    assert "no such live pairing" in capsys.readouterr().out
    assert main(["connect", "list", "--data-dir", data]) == 0


# -- identity: reuse of ingress.py's rules ------------------------------------------------------------------------
async def test_a_paired_app_carries_the_ha_user_and_the_rules_of_the_ha_door(srv, tmp_path):
    srv.store.link(OWNER_HA, "owner", "Fictional Owner")
    files, _ = await do_pair(srv, tmp_path)
    status, h, body = await srv.get(files, "/dashboard-kitchen/home", {**ha_headers(), **PAGE})
    assert status == 200 and f'<meta name="mantel-base" content="{PREFIX}">'.encode() in body
    cookies = [v for k, v in h.items() if k.lower() == "set-cookie"]
    assert cookies and all(f"Path={PREFIX}/" in c for c in cookies)
    async with aiohttp.ClientSession(cookie_jar=aiohttp.DummyCookieJar()) as http:
        status, _, body = await srv._do(http, "GET", files, "/api/session", ha_headers())
        info = json.loads(body)
        assert status == 200 and info["door"] == "ha" and info["user"]["ha_user_id"] == OWNER_HA
    # an HA user that is not linked sees the 'not linked' page and nothing else
    status, _, body = await srv.get(files, "/dashboard-kitchen/home", {**ha_headers(STRANGER_HA), **PAGE})
    assert status in (401, 403) and b"not linked" in body.lower()
    # a request with no HA user at all is no one
    status, _, _ = await srv.get(files, "/api/me", {"X-Ingress-Path": PREFIX})
    assert status == 401
    # the Host name is whatever the App was given: not rebinding-checked on this listener
    status, _, _ = await srv.get(files, "/api/me", {**ha_headers(), "Host": "any.name.invalid"})
    assert status in (200, 401)


async def test_identity_headers_on_the_ordinary_listener_are_never_believed(srv, tmp_path):
    srv.store.link(OWNER_HA, "owner", "Fictional Owner")
    files, _ = await do_pair(srv, tmp_path)
    async with aiohttp.ClientSession(cookie_jar=aiohttp.DummyCookieJar()) as http:
        async with http.get(f"http://127.0.0.1:{srv.main_port}/api/me", headers=ha_headers()) as r:
            assert r.status == 401
        async with http.get(f"http://127.0.0.1:{srv.main_port}/dashboard-kitchen/home", headers={**ha_headers(), **PAGE},
                            allow_redirects=False) as r:
            assert r.status == 302 and "/login" in r.headers["Location"]
        # the pairing and renewal routes exist only on the Connect listener
        async with http.post(f"http://127.0.0.1:{srv.main_port}{protocol.PAIR_PATH}", json={}) as r:
            assert r.status in (401, 404)
        async with http.get(f"http://127.0.0.1:{srv.main_port}{protocol.PING_PATH}") as r:
            assert r.status in (401, 404)


async def test_connect_off_means_no_listener_routes_and_no_trust(tmp_path, monkeypatch):
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.store import Store
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0)
    store = Store(cfg.data_dir / "mantel.db")
    app = build_app(cfg, "unused", store=store, connect_ha=False)
    assert "connect" not in app
    # (the Connections page, connections.py, is a different thing: /api/connections, /auth/connection/...)
    assert not [r for r in app.router.routes() if "connect" in str(r.resource.canonical)
                and "connection" not in str(r.resource.canonical)]
    store.db.close()


# -- the Owner REST ---------------------------------------------------------------------------------------------------
async def test_owner_rest_start_list_revoke(tmp_path, monkeypatch):
    from conftest import Mantel  # noqa: F401 -- fixture module is on the path
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.store import Store
    from argon2 import PasswordHasher
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, connect=True, ingress=True,
                 ingress_peers=())
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, "unused", store=store, connect_ha=False, clock=lambda: now[0])
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    async with TestClient(TestServer(app)) as client:
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin

        async def sign_in(username, role):
            await app["accounts"].create_user(username, username.title(), role, "correct horse battery staple")
            r = await client.post("/api/auth/password", json={"username": username,
                                                              "password": "correct horse battery staple"})
            assert r.status == 200

        def csrf():
            jar = client.session.cookie_jar.filter_cookies(client.make_url("/"))
            return {"X-CSRF-Token": jar["mantel_csrf"].value}

        # not signed in
        assert (await client.get("/api/connect")).status == 401
        await sign_in("adult", "adult")
        assert (await client.get("/api/connect")).status == 403
        assert (await client.post("/api/connect/pair", json={}, headers=csrf())).status == 403
        client.session.cookie_jar.clear()
        await sign_in("boss", "owner")
        ov = await (await client.get("/api/admin/overview")).json()
        assert "connect" in ov["sections"] and ov["connect_port"] == cfg.connect_port
        r = await client.post("/api/connect/pair", json={}, headers=csrf())
        assert r.status == 201
        started = await r.json()
        assert protocol.normalize_code(started["code"]) and started["expires"] == now[0] + protocol.CODE_TTL
        listing = await (await client.get("/api/connect")).json()
        assert listing["pending"]["expires"] == started["expires"] and listing["pairings"] == []
        assert started["code"] not in json.dumps(listing)                       # the code is shown once, at the start
        # a pairing made by the real exchange then shows up, and the Owner revokes it
        row = app["connect"].db
        pid = "ab" * 8
        row.execute("INSERT INTO connect_pairings (id, name, created, cert_fp, cert_expires) VALUES (?,?,?,?,?)",
                    (pid, "Home Assistant", now[0], "f" * 64, now[0] + 1000))
        listing = await (await client.get("/api/connect")).json()
        assert [p["id"] for p in listing["pairings"]] == [pid] and "cert_fp" not in listing["pairings"][0]
        assert (await client.delete("/api/connect/pairings/" + "00" * 8, headers=csrf())).status == 404
        assert (await client.delete("/api/connect/pairings/" + pid, headers=csrf())).status == 200
        assert (await client.delete("/api/connect/pairings/" + pid)).status == 403      # CSRF required
        listing = await (await client.get("/api/connect")).json()
        assert listing["pairings"][0]["revoked"] is not None
        assert (await client.delete("/api/connect/pair", headers=csrf())).status == 200
        assert "connect.revoke" in [r["action"] for r in app["audit"].rows(kind="config")]
    store.db.close()


# -- the Connect App ------------------------------------------------------------------------------------------------------
@pytest.fixture
async def link_app(srv, tmp_path):
    """The real Connect App, paired with the real server by its options, behind a test client that plays
    the Supervisor (the peer is 127.0.0.1 here)."""
    made = []

    async def make(options=None, folder="connectapp", peers=("127.0.0.1",)):
        code = srv.mgr.start("owner-id")["code"] if options is None else None
        options = options if options is not None else {"mantel_address": f"127.0.0.1:{srv.connect_port}",
                                                       "pairing_code": code}
        app = connect_app.build_app(tmp_path / folder, options, peers)
        client = TestClient(TestServer(app), cookie_jar=aiohttp.DummyCookieJar())
        await client.start_server()
        made.append(client)
        return client, app["link"]

    yield make
    for c in made:
        await c.close()


async def test_the_app_pairs_from_its_options_and_proxies_the_sidebar(srv, link_app, tmp_path):
    srv.store.link(OWNER_HA, "owner", "Fictional Owner")
    client, link = await link_app()
    assert link.state == "ok", link.detail
    assert link.files.paired()
    r = await client.get("/dashboard-kitchen/home", headers={**ha_headers(), **PAGE})
    text = await r.text()
    assert r.status == 200 and f'content="{PREFIX}"' in text
    assert any(PREFIX in c for c in r.headers.getall("Set-Cookie"))
    r = await client.get("/api/session", headers=ha_headers())
    assert (await r.json())["user"]["ha_user_id"] == OWNER_HA
    # the browser cannot choose who it is: its own identity/door headers are not forwarded, HA's are
    r = await client.get("/api/session", headers={**ha_headers(STRANGER_HA), "X-Mantel-Door": "lan",
                                                  "Authorization": "Bearer x", "X-Remote-User-Id": STRANGER_HA})
    assert r.status == 401 or (await r.json())["user"] is None
    # redirects and status codes pass through unchanged
    r = await client.get("/", headers={**ha_headers(), **PAGE}, allow_redirects=False)
    assert r.status == 302 and r.headers["Location"] == f"{PREFIX}/home"
    # the used code is remembered, so a restart with the same options does not spend anything again
    assert srv.store.db.execute("SELECT COUNT(*) FROM connect_pairings").fetchone()[0] == 1


async def test_the_app_only_serves_the_supervisor_and_never_names_another_target(srv, link_app):
    client, link = await link_app(peers=("172.30.32.2",))          # the test client is not the Supervisor
    assert (await client.get("/api/me", headers=ha_headers())).status == 403
    assert (await client.get("/healthz")).status == 200                # health says "ok" and nothing else
    assert await (await client.get("/healthz")).text() == "ok"
    client2, link2 = await link_app(options={}, folder="other")
    raw = "/" + "x"
    r = await client2.get(raw, headers=ha_headers())
    assert r.status == 503                                              # unpaired: nothing is proxied


async def test_a_request_without_a_ha_user_is_refused_by_the_app(srv, link_app):
    client, link = await link_app()
    r = await client.get("/api/me")
    assert r.status == 401
    r = await client.get("/api/me", headers=[("X-Remote-User-Id", OWNER_HA), ("X-Remote-User-Id", STRANGER_HA)])
    assert r.status == 401
    r = await client.get("/api/me", headers={"X-Remote-User-Id": "bad id!"})
    assert r.status == 401


async def test_wrong_code_leaves_the_app_unpaired_with_a_clear_page_and_does_not_retry(srv, link_app, tmp_path):
    srv.mgr.start("owner-id")
    options = {"mantel_address": f"127.0.0.1:{srv.connect_port}", "pairing_code": protocol.new_code()}
    client, link = await link_app(options, "wrong")
    assert link.state == "unpaired" and not link.files.paired()
    r = await client.get("/", headers={**ha_headers(), **PAGE})
    text = await r.text()
    assert r.status == 503 and "not paired" in text and "refused the code" in text
    assert options["pairing_code"] not in text
    # a restart with the same stale code does not spend another attempt
    before = len(srv.audit("connect.pair_failed"))
    client2, link2 = await link_app(options, "wrong")
    assert len(srv.audit("connect.pair_failed")) == before


async def test_the_app_shows_a_revoked_connection_and_a_down_mantel(srv, link_app, tmp_path):
    srv.store.link(OWNER_HA, "owner")
    client, link = await link_app()
    srv.mgr.revoke(link.files.read_info()["pairing_id"], "owner-id")
    r = await client.get("/dashboard-kitchen/home", headers={**ha_headers(), **PAGE})
    assert r.status == 503 and "disconnected" in (await r.text()).lower()
    assert link.state == "revoked"
    r = await client.get("/api/me", headers=ha_headers())
    assert r.status == 503                                             # the next request: unpaired/revoked, not proxied
    # a Mantel that is down: a clear 502 page, not a stack trace
    client2, link2 = await link_app(options={"mantel_address": f"127.0.0.1:{srv.connect_port}", "pairing_code": ""},
                                    folder="down")
    assert link2.state == "unpaired"


async def test_mantel_unreachable_after_pairing_gives_a_502_page(srv, link_app, tmp_path):
    client, link = await link_app()
    link.port = 1                                                       # nothing listens there
    r = await client.get("/x", headers={**ha_headers(), **PAGE})
    assert r.status == 502 and "not reachable" in (await r.text())
    r = await client.get("/x", headers=ha_headers())
    assert r.status == 502


async def test_the_app_proxies_the_websocket_and_request_bodies(srv, link_app):
    srv.store.link(OWNER_HA, "owner", "Fictional Owner")
    client, link = await link_app()
    page = await client.get("/dashboard-kitchen/home", headers={**ha_headers(), **PAGE})
    cookies = "; ".join(c.split(";")[0] for c in page.headers.getall("Set-Cookie"))
    ws = await client.ws_connect("/ws", headers={**ha_headers(), "Cookie": cookies, "Origin": "http://ha.example:8123"})
    await ws.send_json({"type": "subscribe", "entity_ids": [], "all": True})
    msg = await asyncio.wait_for(ws.receive_json(), 5)
    assert isinstance(msg, dict) and "type" in msg
    await ws.close()
    # a POST body is streamed through (here Mantel answers 403/404 for the route, which proves it arrived)
    r = await client.post("/api/no-such-route", data=b"x" * 200_000, headers={**ha_headers(), "Cookie": cookies})
    assert r.status in (401, 403, 404, 405)
    # a WebSocket without a session is refused by Mantel and the refusal is relayed
    with pytest.raises(aiohttp.WSServerHandshakeError) as err:
        await client.ws_connect("/ws", headers={**ha_headers(STRANGER_HA), "Origin": "http://ha.example:8123"})
    assert err.value.status == 401


async def test_the_app_renews_its_certificate_when_it_runs_short(srv, link_app):
    client, link = await link_app()
    old = pki.cert_fp(link.files.cert.read_text())
    real = pairing.RENEW_BEFORE
    pairing.RENEW_BEFORE = 365 * 86400.0                                # pretend it is nearly out
    try:
        await link.maybe_renew()
    finally:
        pairing.RENEW_BEFORE = real
    assert pki.cert_fp(link.files.cert.read_text()) != old
    await link.check()
    assert link.state == "ok"


def test_address_parsing():
    assert protocol.parse_address("mantel.lan") == ("mantel.lan", 8766)
    assert protocol.parse_address("https://192.0.2.5:9000/") == ("192.0.2.5", 9000)
    assert protocol.parse_address("[fe80::1]:8766") == ("[fe80::1]", 8766)
    for bad in ("", "http://x", "x/y", "user@x", "x:99999", "x:abc", "x y", "x?y", "a" * 70 + ".b/c", None, 5):
        with pytest.raises(ValueError):
            protocol.parse_address(bad)


def test_codes_have_the_advertised_shape():
    code = protocol.new_code()
    assert len(code) == 23 and code.count("-") == 3
    raw = protocol.normalize_code(code.lower().replace("-", " "))
    assert raw and protocol.code_id(raw) == code[:5]
    assert protocol.normalize_code(code[:-1]) is None and protocol.normalize_code("O" * 20) is None
    assert len({protocol.new_code() for _ in range(200)}) == 200


def test_the_app_options_file_is_read_as_a_file(tmp_path):
    p = tmp_path / "options.json"
    p.write_text(json.dumps({"mantel_address": "x", "pairing_code": "y"}))
    assert connect_app.read_options(p)["mantel_address"] == "x"
    assert connect_app.read_options(tmp_path / "missing.json") == {}
    p.write_text("not json")
    assert connect_app.read_options(p) == {}
