"""Pairing codes for Mantel Link (mantel_server/linked_pairing.py; docs/phase9/MANTEL-LINK.md 9.4): an Owner's one-time
code, held in memory only, traded once at /linked/pair for a `linked` Service credential, both sides proving they
know it; wrong tries counted and the code burned; the LAN door only, never a browser; audited, never a secret."""
import json
import secrets

from mantel_server import linked_pairing as LP
from mantel_connect import protocol as CP
from test_features import Linked, make_env  # noqa: F401


def body_for(code: str, name: str = "Home Assistant - Mantel Link", wrong: bool = False):
    raw = CP.normalize_code(code)
    nonce = secrets.token_hex(16)
    key = LP.code_key(raw if not wrong else "X" * 20)
    return {"v": 1, "code_id": raw[:5], "nonce": nonce, "name": name,
            "proof": LP.client_proof(key, raw[:5], nonce, name)}, LP.code_key(raw), nonce


async def pair(env, body, **headers):
    env.m.client.session.headers.pop("Origin", None)
    try:
        return await env.m.client.post("/linked/pair", json=body, headers=headers)
    finally:
        env.m.client.session.headers["Origin"] = env.m.origin


async def test_an_owner_s_code_is_traded_once_for_a_linked_credential(make_env):
    env = await make_env()
    await env.login("adult1", "adult")
    assert (await env.m.client.post("/api/linked/pair", headers=env.m.headers())).status == 403
    await env.login("owner1", "owner")
    r = await env.m.client.post("/api/linked/pair", headers=env.m.headers())
    got = await r.json()
    assert r.status == 200 and r.headers["Cache-Control"] == "no-store" and CP.normalize_code(got["code"])
    pend = await (await env.m.get("/api/linked/pair")).json()
    assert pend["pending"]["expires"] == got["expires"] and "code" not in repr(pend).lower().replace("code_", "")
    body, key, nonce = body_for(got["code"])
    r = await pair(env, body)
    out = await r.json()
    assert r.status == 200, out
    inst = env.app["linked"].instance
    assert out["instance"] == inst and out["proof"] == LP.server_proof(key, body["code_id"], nonce, inst, out["token"])
    acct = env.app["service_accounts"].verify(out["token"], "linked")
    assert acct is not None and acct.name == "Home Assistant - Mantel Link"
    # spent: the same exchange again is refused
    assert (await pair(env, body)).status == 403
    assert (await (await env.m.get("/api/linked/pair")).json())["pending"] is None
    # the credential opens the link, as Mantel Link
    lk = Linked(env)
    lk.token = out["token"]
    env.m.client.session.headers.pop("Origin", None)
    ws = await env.m.client.ws_connect("/linked/ws", headers={"Authorization": f"Bearer {out['token']}",
                                                                "X-Mantel-Link": "domain=mantel; protocol=2"})
    env.m.client.session.headers["Origin"] = env.m.origin
    hello = await ws.receive_json(timeout=5)
    assert hello["protocol"] == 2 and hello["instance"] == inst
    await ws.close()
    rows = env.audit(kind="config")
    actions = [r["action"] for r in rows]
    assert "linked.pair_start" in actions and "linked.pair_ok" in actions
    assert got["code"] not in repr(rows) and out["token"] not in repr(rows)


async def test_wrong_tries_burn_the_code_and_the_doors_hold(make_env):
    env = await make_env()
    await env.login("owner1", "owner")
    code = (await (await env.m.client.post("/api/linked/pair", headers=env.m.headers())).json())["code"]
    good, _k, _n = body_for(code)
    # a browser, the tunnel, nonsense
    assert (await env.m.client.post("/linked/pair", json=good)).status == 403, "an Origin: never a browser"
    assert (await pair(env, good, **{"X-Mantel-Door": "tunnel"})).status == 403
    assert (await pair(env, {"v": 1, "code_id": "nope"})).status == 400
    for i in range(LP.MAX_WRONG):
        bad, _k, _n = body_for(code, wrong=True)
        assert (await pair(env, bad)).status == 403, i
    assert (await pair(env, good)).status == 403, "burned after five wrong proofs"
    fails = [json.loads(r["target"]) for r in env.audit(kind="config") if r["action"] == "linked.pair_failed"]
    assert [f["wrong"] for f in fails] == [1, 2, 3, 4, 5] and fails[-1]["burned"] is True


async def test_a_code_expires_and_one_at_a_time(make_env):
    env = await make_env()
    p = env.app["linked_pairing"]
    first = p.start("o1")["code"]
    second = p.start("o1")["code"]
    b1, _k, _n = body_for(first)
    try:
        p.pair(b1, "192.0.2.9")
        raise AssertionError("an older code still worked")
    except LP.PairError as exc:
        assert exc.code == "invalid_code"
    b2, _k, _n = body_for(second)
    p._code["expires"] = 0
    try:
        p.pair(b2, "192.0.2.9")
        raise AssertionError("an expired code still worked")
    except LP.PairError as exc:
        assert exc.code == "invalid_code"


# -- protocol v2 (T2): the address Mantel Link used is in both proofs ---------------------------------------
def body_v2(code: str, address, name: str = "Home Assistant - Mantel Link"):
    raw = CP.normalize_code(code)
    nonce = secrets.token_hex(16)
    key = LP.code_key(raw)
    return {"v": 2, "code_id": raw[:5], "nonce": nonce, "name": name, "address": address,
            "proof": LP.client_proof(key, raw[:5], nonce, name, address)}, key, nonce


def here(env) -> str:
    return LP.normalize_address(str(env.m.client.make_url("")))


async def _code(env) -> str:
    await env.login("owner1", "owner")
    return (await (await env.m.client.post("/api/linked/pair", headers=env.m.headers())).json())["code"]


def test_addresses_are_normalised_one_way():
    n = LP.normalize_address
    assert n("https://Mantel.Example.com") == "https://mantel.example.com:443"
    assert n("https://mantel.example.com/") == "https://mantel.example.com:443"
    assert n("https://mantel.example.com:443/linked/pair?x=1") == "https://mantel.example.com:443"
    assert n("HTTP://mantel.lan") == "http://mantel.lan:80"
    assert n("http://mantel.lan:80") == "http://mantel.lan:80"
    assert n("http://local-mantel:8099") == "http://local-mantel:8099"
    assert n("wss://mantel.example.com:8443/linked/ws") == "https://mantel.example.com:8443"
    assert n("http://[FD00::1]:8099/") == "http://[fd00::1]:8099"
    assert n("https://[::1]") == "https://[::1]:443"
    assert n("https://mantel.example.com.") == "https://mantel.example.com:443"
    for bad in ("", "mantel.example.com", "ftp://mantel.example.com", "https://", "https://m:99999", None, 7):
        assert n(bad) is None, bad


def test_mantel_s_own_addresses():
    from types import SimpleNamespace
    cfg = SimpleNamespace(public_url="https://Mantel.Example.com/", allowed_hosts=("mantel.lan", "*"),
                          direct_hosts=("mantel.example.com:8443", "mantel.example.com"))
    got = LP.own_addresses(cfg, "mantel.lan", app_url="http://local-mantel:8099",
                           announce_url="https://mantel.example.com:8443")
    assert "https://mantel.example.com:443" in got                 # public_url
    assert "http://local-mantel:8099" in got                       # the App's hostname
    assert "https://mantel.example.com:8443" in got                # the announcement (and the direct listener)
    assert {"https://mantel.lan:443", "http://mantel.lan:80"} <= got  # the Host it came in on, a name Mantel has
    # the Host it came in on counts only when it is one of Mantel's names: "*" never widens it
    assert not any("evil" in a for a in LP.own_addresses(cfg, "evil.lan:443"))
    assert LP.own_addresses(None, "127.0.0.1:8099") >= {"http://127.0.0.1:8099", "https://127.0.0.1:8099"}
    assert "http://[::1]:8099" in LP.own_addresses(None, "[::1]:8099")
    assert LP.own_addresses(None, None) == set()


async def test_v2_pairs_at_mantel_s_own_address_and_the_proof_names_it(make_env):
    env = await make_env()
    code = await _code(env)
    body, key, nonce = body_v2(code, here(env))
    r = await pair(env, body)
    out = await r.json()
    assert r.status == 200, out
    inst = env.app["linked"].instance
    assert out["v"] == 2 and out["address"] == here(env)
    assert out["proof"] == LP.server_proof(key, body["code_id"], nonce, inst, out["token"], here(env))
    assert out["proof"] != LP.server_proof(key, body["code_id"], nonce, inst, out["token"]), "v1's proof differs"
    assert env.app["service_accounts"].verify(out["token"], "linked") is not None


async def test_a_relaying_look_alike_at_another_address_cannot_pair(make_env):
    """Home Assistant reached a look-alike at another address, which passed the exchange on to the real Mantel: the
    address in the proof is not Mantel's, so Mantel refuses (and the look-alike cannot change it without the code)."""
    env = await make_env()
    code = await _code(env)
    body, _k, _n = body_v2(code, "https://mantel-lookalike.lan:443")
    r = await pair(env, body)
    assert r.status == 403 and (await r.json())["error"]["code"] == "wrong_address"
    # rewriting the address to Mantel's own breaks the client's proof
    forged = {**body, "address": here(env)}
    r = await pair(env, forged)
    assert r.status == 403 and (await r.json())["error"]["code"] == "invalid_code"
    rows = [json.loads(r["target"]) for r in env.audit(kind="config") if r["action"] == "linked.pair_failed"]
    assert rows and rows[0].get("address") == "https://mantel-lookalike.lan:443"
    # the code is not spent by the look-alike: Home Assistant at Mantel's own address still pairs
    good, _k, _n = body_v2(code, here(env))
    assert (await pair(env, good)).status == 200


async def test_v2_needs_a_normalised_address_and_v1_still_pairs(make_env):
    env = await make_env()
    code = await _code(env)
    for bad in (None, "", "https://Mantel.lan/", "mantel.lan", 7):
        body, _k, _n = body_v2(code, "https://x.lan:443")
        body["address"] = bad
        r = await pair(env, body)
        assert r.status == 400 and (await r.json())["error"]["code"] == "malformed", bad
    assert (await pair(env, {**body_v2(code, here(env))[0], "v": 3})).status == 400, "an unknown version"
    old, key, nonce = body_for(code)                          # an older Mantel Link: v1, no address
    r = await pair(env, old)
    out = await r.json()
    assert r.status == 200 and out["v"] == 1 and "address" not in out
    assert out["proof"] == LP.server_proof(key, old["code_id"], nonce, env.app["linked"].instance, out["token"])
