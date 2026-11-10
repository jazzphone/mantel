"""Mantel's MCP server (docs/phase12/MCP-SERVER.md): the transport in both eras, who may call and from where, the
ceiling (scopes), plan-then-apply with nothing written by a plan, the same checks and refusals as the Settings
page, the audit and history saying it was an assistant, screens and Home Grid, batches, export/import, previews,
signing in with OAuth, and house commands only by consent."""
import base64
import hashlib
import json
import secrets
from urllib.parse import parse_qs, urlparse

import pytest

from mantel_server.settings_store import Actor


# -- helpers ---------------------------------------------------------------------------------------------------------
def house(m):
    """A small fictional house: two floors, three rooms, a few things."""
    reg = m.app["hub"].registry
    reg.load(areas=[{"area_id": "kitchen", "name": "Kitchen", "floor_id": "ground"},
                    {"area_id": "den", "name": "Den", "floor_id": "ground"},
                    {"area_id": "loft", "name": "Loft", "floor_id": "upstairs"}],
             devices=[],
             entities=[{"entity_id": "light.kitchen_main", "name": "Kitchen Main", "area_id": "kitchen"},
                       {"entity_id": "light.den_lamp", "name": "Den Lamp", "area_id": "den"},
                       {"entity_id": "scene.evening", "name": "Evening", "area_id": None},
                       {"entity_id": "camera.porch", "name": "Porch", "area_id": None},
                       {"entity_id": "climate.loft", "name": "Loft", "area_id": "loft"}],
             floors=[{"floor_id": "ground", "name": "Ground"}, {"floor_id": "upstairs", "name": "Upstairs"}])
    st = m.app["hub"].store.states
    for eid, s, a in (("light.kitchen_main", "on", {"brightness": 200}), ("light.den_lamp", "off", {}),
                      ("scene.evening", "unknown", {}), ("camera.porch", "idle", {}),
                      ("climate.loft", "heat", {"current_temperature": 20.5})):
        st[eid] = {"s": s, "a": {"friendly_name": eid, **a}, "lc": 0, "lu": 0}
    m.app["settings"].store.write([("board", "dashboard-kitchen", {"title": "Kitchen"})], actor=Actor(label="t"))


async def owner(m, name="olive", role="owner"):
    await m.user(name, role)
    await m.sign_in(name)


async def turn_on(m, **more):
    for k, v in {"mcp_enabled": True, **more}.items():
        r = await m.client.put("/api/mcp/settings", json={k: v}, headers=m.headers())
        assert r.status == 200, await r.text()


async def make_key(m, name="Claude Code", scopes=None):
    r = await m.client.post("/api/mcp/keys", json={"name": name, **({"scopes": scopes} if scopes else {})},
                            headers=m.headers())
    body = await r.json()
    assert r.status == 201, body
    return body["token"], body["assistant"]["id"]


async def setup(m, scopes=None, **settings):
    house(m)
    await owner(m)
    await turn_on(m, **settings)
    token, gid = await make_key(m, scopes=scopes)
    return token, gid


class Rpc:
    def __init__(self, m, token, modern=False, version=None):
        self.m, self.token, self.modern = m, token, modern
        self.version = version or ("2026-07-28" if modern else "2025-11-25")
        self.n = 0

    async def raw(self, body, headers=None, origin=None):
        h = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json", **(headers or {})}
        sess = self.m.client.session
        saved = sess.headers.pop("Origin", None)        # an MCP client is not a browser page
        try:
            if origin:
                h["Origin"] = origin
            return await self.m.client.post("/mcp", data=json.dumps(body), headers=h)
        finally:
            if saved is not None:
                sess.headers["Origin"] = saved

    async def call(self, method, params=None, *, notify=False, headers=None):
        self.n += 1
        params = dict(params or {})
        h = {"MCP-Protocol-Version": self.version}
        if self.modern:
            params["_meta"] = {"io.modelcontextprotocol/protocolVersion": self.version,
                               "io.modelcontextprotocol/clientInfo": {"name": "test", "version": "1"},
                               "io.modelcontextprotocol/clientCapabilities": {}}
            h["Mcp-Method"] = method
            if method in ("tools/call", "prompts/get"):
                h["Mcp-Name"] = params.get("name")
            if method == "resources/read":
                h["Mcp-Name"] = params.get("uri")
        body = {"jsonrpc": "2.0", "method": method, "params": params}
        if not notify:
            body["id"] = self.n
        r = await self.raw(body, {**h, **(headers or {})})
        return r.status, (await r.json() if r.content_type == "application/json" else None)

    async def tool(self, name, **args):
        st, body = await self.call("tools/call", {"name": name, "arguments": args})
        assert st == 200, body
        res = body["result"]
        return res["structuredContent"], res["isError"]


def dump(m, skip=("sessions", "access_tokens", "refresh_tokens", "mcp_grants", "mcp_clients", "mcp_codes")):
    db = m.app["store"].db
    out = []
    for (t,) in db.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"):
        if t in skip or t.startswith("sqlite_"):
            continue
        out.append((t, [tuple(r) for r in db.execute(f"SELECT * FROM {t}")]))   # noqa: S608 -- names from sqlite_master
    return out


def audits(m, action=None):
    q = "SELECT action, target, actor, via FROM action_audit" + (" WHERE action = ?" if action else "")
    return [dict(r) for r in m.app["store"].db.execute(q, (action,) if action else ())]


# -- the transport -----------------------------------------------------------------------------------------------------
async def test_off_by_default_and_a_key_works_once_on(mantel):
    house(mantel)
    await owner(mantel)
    token, _ = await make_key(mantel)
    rpc = Rpc(mantel, token)
    st, body = await rpc.call("initialize", {"protocolVersion": "2025-11-25", "capabilities": {},
                                             "clientInfo": {"name": "t", "version": "1"}})
    assert st == 403 and body["error"]["data"]["code"] == "assistants_off"
    await turn_on(mantel)
    st, body = await rpc.call("initialize", {"protocolVersion": "2025-11-25", "capabilities": {},
                                             "clientInfo": {"name": "t", "version": "1"}})
    assert st == 200 and body["result"]["protocolVersion"] == "2025-11-25"
    assert "tools" in body["result"]["capabilities"] and body["result"]["instructions"]


async def test_the_legacy_handshake_needs_no_session(mantel):
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token)
    r = await rpc.raw({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                       "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t"}}})
    assert r.status == 200 and "Mcp-Session-Id" not in r.headers
    assert (await r.json())["result"]["protocolVersion"] == "2025-06-18"
    st, _ = await rpc.call("notifications/initialized", notify=True)
    assert st == 202
    st, body = await rpc.call("ping")
    assert st == 200 and body["result"] == {}
    st, body = await rpc.call("tools/list")
    names = [t["name"] for t in body["result"]["tools"]]
    assert names[0] == "house_summary" and "settings_change" in names
    assert "audit_recent" not in names and "house_command" not in names, "only what the scopes allow"
    tool = next(t for t in body["result"]["tools"] if t["name"] == "settings_change")
    assert tool["annotations"]["readOnlyHint"] is False
    assert {"dry_run", "plan"} <= set(tool["inputSchema"]["properties"])
    assert "ttlMs" not in body["result"], "the modern fields only on modern requests"


async def test_an_unknown_legacy_version_is_refused(mantel):
    token, _ = await setup(mantel)
    st, body = await Rpc(mantel, token, version="2024-01-01").call("tools/list")
    assert st == 400 and body["error"]["code"] == -32022
    assert "2026-07-28" in body["error"]["data"]["supported"]


async def test_the_modern_era_is_stateless_and_checks_its_headers(mantel):
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token, modern=True)
    st, body = await rpc.call("server/discover")
    assert st == 200 and body["result"]["resultType"] == "complete"
    assert "2026-07-28" in body["result"]["supportedVersions"] and "2025-11-25" in body["result"]["supportedVersions"]
    assert body["result"]["_meta"]["io.modelcontextprotocol/serverInfo"]["name"] == "mantel"
    st, body = await rpc.call("tools/list")
    assert body["result"]["cacheScope"] == "private" and body["result"]["ttlMs"] > 0
    st, body = await rpc.call("tools/call", {"name": "house_summary", "arguments": {}})
    assert st == 200 and body["result"]["isError"] is False
    # a header that says otherwise than the body
    st, body = await rpc.call("tools/call", {"name": "house_summary", "arguments": {}}, headers={"Mcp-Name": "rooms_list"})
    assert st == 400 and body["error"]["code"] == -32020
    st, body = await rpc.call("tools/list", headers={"Mcp-Method": "prompts/list"})
    assert st == 400 and body["error"]["code"] == -32020
    st, body = await rpc.call("tools/list", headers={"MCP-Protocol-Version": "2025-11-25"})
    assert st == 400 and body["error"]["code"] == -32020
    # a Base64 header value is read before it is compared
    enc = "=?base64?" + base64.b64encode(b"house_summary").decode() + "?="
    st, body = await rpc.call("tools/call", {"name": "house_summary", "arguments": {}}, headers={"Mcp-Name": enc})
    assert st == 200
    # an unknown method: 404 with a JSON-RPC error, in the modern era
    st, body = await rpc.call("tasks/list")
    assert st == 404 and body["error"]["code"] == -32601
    old = Rpc(mantel, token, modern=True, version="2027-01-01")
    st, body = await old.call("tools/list")
    assert st == 400 and body["error"]["code"] == -32022


async def test_what_the_transport_refuses(mantel):
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token)
    r = await rpc.raw([{"jsonrpc": "2.0", "id": 1, "method": "ping"}])
    assert r.status == 400, "no batches"
    r = await rpc.raw({"jsonrpc": "2.0", "id": 1, "method": "ping"}, origin="http://evil.example")
    assert r.status == 403, "a browser page from elsewhere (DNS rebinding)"
    r = await rpc.raw({"jsonrpc": "2.0", "id": 1, "result": {}})
    assert r.status == 400, "Mantel asks nothing, so it takes no answers"
    h = {"Authorization": f"Bearer {token}"}
    sess = mantel.client.session
    saved = sess.headers.pop("Origin")
    try:
        for method in ("GET", "DELETE"):
            r = await mantel.client.request(method, "/mcp", headers=h)
            assert r.status == 405 and r.headers["Allow"] == "POST"
    finally:
        sess.headers["Origin"] = saved
    r = await rpc.raw("x" * (1 << 20))
    assert r.status == 413


async def test_no_credential_says_where_to_sign_in(mantel):
    await setup(mantel)
    r = await Rpc(mantel, "").raw({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert r.status == 401
    www = r.headers["WWW-Authenticate"]
    assert www.startswith("Bearer resource_metadata=") and "/.well-known/oauth-protected-resource/mcp" in www
    r = await Rpc(mantel, "mmcp_" + "0" * 16 + "_" + "A" * 43).raw({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert r.status == 401 and 'error="invalid_token"' in r.headers["WWW-Authenticate"]
    # a browser's own cookie is not an assistant's credential
    sess = mantel.client.session
    saved = sess.headers.pop("Origin")
    try:
        r = await mantel.client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    finally:
        sess.headers["Origin"] = saved
    assert r.status == 401


# -- who, where, how much ------------------------------------------------------------------------------------------
async def test_a_key_is_stored_as_a_hash_and_shown_once(mantel):
    token, gid = await setup(mantel)
    row = mantel.app["store"].db.execute("SELECT * FROM mcp_grants WHERE id = ?", (gid,)).fetchone()
    assert row["secret_hash"] == hashlib.sha256(token.encode()).hexdigest() and token not in json.dumps(dict(row))
    r = await mantel.client.get("/api/mcp")
    listed = (await r.json())["assistants"]
    assert listed[0]["state"] == "live" and token not in json.dumps(listed)
    s = mantel.app["sessions"].get(row["session_id"])
    assert s["method"] == "mcp", "a session of its own, listed in Me → Sessions"
    assert audits(mantel, "mcp.key.create")[0]["target"]


async def test_a_key_works_on_the_home_network_only(mantel):
    token, _ = await setup(mantel, mcp_away=True)
    st, body = await Rpc(mantel, token).call("tools/list", headers={"X-Mantel-Door": "tunnel"})
    assert st in (401, 403)
    assert st == 403 and body["error"]["data"]["code"] == "home_only"


async def test_revoked_ends_it_at_once(mantel):
    token, gid = await setup(mantel)
    rpc = Rpc(mantel, token)
    assert (await rpc.call("tools/list"))[0] == 200
    r = await mantel.client.delete(f"/api/mcp/grants/{gid}", headers=mantel.headers())
    assert r.status == 200
    assert (await rpc.call("tools/list"))[0] == 401
    assert audits(mantel, "mcp.revoke")


async def test_signing_out_everywhere_ends_the_assistant_too(mantel):
    token, gid = await setup(mantel)
    rpc = Rpc(mantel, token)
    user = mantel.app["store"].db.execute("SELECT user_id FROM mcp_grants WHERE id = ?", (gid,)).fetchone()[0]
    mantel.app["sessions"].revoke_user(user, "test")
    assert (await rpc.call("tools/list"))[0] == 401


async def test_only_owners_and_admins_and_a_role_change_counts_at_once(mantel):
    house(mantel)
    await owner(mantel)
    await turn_on(mantel)
    await mantel.user("ada", "adult")
    await mantel.sign_in("ada")
    r = await mantel.client.post("/api/mcp/keys", json={"name": "x"}, headers=mantel.headers())
    assert r.status == 403
    await mantel.user("abe", "admin")
    await mantel.sign_in("abe")
    token, _ = await make_key(mantel, "Abe's")
    rpc = Rpc(mantel, token)
    assert (await rpc.call("tools/list"))[0] == 200
    db = mantel.app["store"].db
    with db:
        db.execute("UPDATE users SET role = 'adult' WHERE username = 'abe'")
    st, body = await rpc.call("tools/list")
    assert st == 403 and body["error"]["data"]["code"] == "forbidden"


async def test_an_admin_sees_their_own_assistants_an_owner_everyone_s(mantel):
    house(mantel)
    await owner(mantel)
    await turn_on(mantel)
    await make_key(mantel, "Olive's")
    await mantel.user("abe", "admin")
    await mantel.sign_in("abe")
    await make_key(mantel, "Abe's")
    got = (await (await mantel.client.get("/api/mcp")).json())
    assert [a["name"] for a in got["assistants"]] == ["Abe's"] and got["may_configure"] is False
    r = await mantel.client.put("/api/mcp/settings", json={"mcp_away": True}, headers=mantel.headers())
    assert r.status == 403, "only an Owner changes the switches"
    await mantel.sign_in("olive")
    got = (await (await mantel.client.get("/api/mcp")).json())
    assert sorted(a["name"] for a in got["assistants"]) == ["Abe's", "Olive's"]


async def test_a_key_never_has_commands(mantel):
    house(mantel)
    await owner(mantel)
    await turn_on(mantel, mcp_commands=True)
    r = await mantel.client.post("/api/mcp/keys", json={"name": "x", "scopes": ["read", "commands"]},
                                 headers=mantel.headers())
    assert r.status == 400


async def test_a_scope_not_given_is_neither_listed_nor_callable(mantel):
    token, _ = await setup(mantel, scopes=["read"])
    rpc = Rpc(mantel, token)
    names = [t["name"] for t in (await rpc.call("tools/list"))[1]["result"]["tools"]]
    assert "settings_change" not in names and "house_summary" in names
    got, err = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": "open"})
    assert err and got["error"] == "forbidden"


async def test_unknown_arguments_are_refused(mantel):
    token, _ = await setup(mantel)
    got, err = await Rpc(mantel, token).tool("house_find", query="lamp", sneaky=True)
    assert err and got["error"] == "invalid_arguments"
    st, body = await Rpc(mantel, token).call("tools/call", {"name": "no_such_tool", "arguments": {}})
    assert body["error"]["code"] == -32602


# -- reading ----------------------------------------------------------------------------------------------------------
async def test_reading_the_house(mantel):
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token)
    s, err = await rpc.tool("house_summary")
    assert not err and {r["area_id"] for r in s["rooms"]} == {"kitchen", "den", "loft"}
    assert s["you"]["role"] == "owner" and s["you"]["assistant"] == "Claude Code"
    assert any(x["key"] == "dashboard-kitchen" for x in s["screens"])
    found, _ = await rpc.tool("house_find", query="lamp")
    assert [e["entity_id"] for e in found["entities"]] == ["light.den_lamp"]
    found, _ = await rpc.tool("house_find", domain="light", area="Kitchen")
    assert [e["entity_id"] for e in found["entities"]] == ["light.kitchen_main"]
    st, _ = await rpc.tool("house_states", entity_ids=["climate.loft", "light.nowhere"])
    assert st["states"][0]["attributes"]["current_temperature"] == 20.5 and st["not_found"] == ["light.nowhere"]
    rooms, _ = await rpc.tool("rooms_list")
    assert rooms["rooms"][0]["floor"] == "Ground"


async def test_the_schema_comes_from_hk_cores_checks(mantel):
    from hk_core.settings import changes as C
    token, _ = await setup(mantel)
    got, _ = await Rpc(mantel, token).tool("settings_schema", scope="board")
    assert set(got["keys"]) == set(C.BOARD), "every key the check takes, and no other"
    assert got["keys"]["home_style"]["choices"] == ["generated", "grid"]
    house_keys, _ = await Rpc(mantel, token).tool("settings_schema", scope="house", prefix="clock.")
    assert house_keys["keys"] and all(k.startswith("clock.") for k in house_keys["keys"])


async def test_resources_and_prompts(mantel):
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token)
    st, body = await rpc.call("resources/list")
    uris = {r["uri"] for r in body["result"]["resources"]}
    assert {"mantel://house", "mantel://grid/cards", "mantel://guide"} <= uris
    st, body = await rpc.call("resources/read", {"uri": "mantel://settings/schema/tablet"})
    assert json.loads(body["result"]["contents"][0]["text"])["keys"]
    st, body = await rpc.call("resources/read", {"uri": "mantel://nothing"})
    assert "error" in body
    st, body = await rpc.call("prompts/list")
    assert {p["name"] for p in body["result"]["prompts"]} >= {"set_up_wall_tablet", "fix_music", "what_changed"}
    st, body = await rpc.call("prompts/get", {"name": "build_home_grid", "arguments": {"room": "Den"}})
    assert "Den" in body["result"]["messages"][0]["content"]["text"]
    st, body = await rpc.call("prompts/get", {"name": "build_home_grid", "arguments": {}})
    assert "error" in body, "a required argument"


async def test_resources_answer_to_the_scopes_of_the_tools_behind_them(mantel):
    """SRV-6 (third audit pass): resources/list and resources/read applied no scope check, so a key given only
    `audit` read mantel://house, every screen and the Home Grid catalogue."""
    token, _ = await setup(mantel, scopes=["audit"])
    rpc = Rpc(mantel, token)
    got, err = await rpc.tool("house_summary")
    assert err is True or got.get("error"), "the control: the tool itself is refused"
    st, body = await rpc.call("resources/list")
    assert body["result"]["resources"] == [], "nothing is listed that cannot be read"
    st, body = await rpc.call("resources/templates/list")
    assert body["result"]["resourceTemplates"] == []
    for uri in ("mantel://house", "mantel://screens", "mantel://screens/dashboard-kitchen", "mantel://grid/cards",
                "mantel://settings/schema/house", "mantel://guide", "mantel://guide/Mantel"):
        st, body = await rpc.call("resources/read", {"uri": uri})
        assert "error" in body and "scope" in body["error"]["message"], uri
    read_token, _ = await make_key(mantel, name="Reader", scopes=["read"])
    rpc = Rpc(mantel, read_token)
    st, body = await rpc.call("resources/list")
    assert {"mantel://house", "mantel://screens", "mantel://guide"} <= {r["uri"] for r in body["result"]["resources"]}
    st, body = await rpc.call("resources/read", {"uri": "mantel://screens/dashboard-kitchen"})
    assert "result" in body


async def test_every_resource_maps_to_a_scope_its_tool_needs():
    from mantel_server.mcp import resources as R
    from mantel_server.mcp.grants import SCOPES
    from mantel_server.mcp.tools import all_tools
    needs = {t.name: t.needs for t in all_tools()}
    uris = [u for u, _, _ in R.STATIC] + ["mantel://guide", "mantel://guide/Mantel"] + [R.example_uri(t) for t in R.TEMPLATES]
    for uri in uris:
        assert R.needs_of(uri) in SCOPES, uri
        if R.tool_of(uri) is not None:
            assert R.needs_of(uri) == needs[R.tool_of(uri)], uri
    assert R.needs_of("mantel://nothing") is None


# -- plan, then apply -------------------------------------------------------------------------------------------------
async def test_a_plan_writes_nothing_and_applying_it_does(mantel):
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token)
    before = dump(mantel)
    plan, err = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": "open"})
    assert not err and plan["planned"] and plan["changes"][0]["key"] == "dashboard-kitchen"
    assert dump(mantel) == before, "a plan leaves the database as it was"
    v = mantel.app["settings"].store.get("board", "dashboard-kitchen").version
    done, err = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": "open"},
                               dry_run=False, plan=plan["plan"])
    assert not err and done["applied"], done
    assert done["changes"][0]["previous"] == v and done["changes"][0]["undo"]["version"] == v
    assert mantel.app["settings"].store.body("board", "dashboard-kitchen")["menu"] == "open"
    h = mantel.app["store"].db.execute("SELECT actor, via FROM settings_history WHERE scope='board' AND "
                                       "key='dashboard-kitchen' ORDER BY version DESC").fetchone()
    assert h["via"] == "mcp:Claude Code" and h["actor"] != "system", "the person, through the assistant"


async def test_applying_needs_the_plan_for_exactly_these_arguments(mantel):
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token)
    got, err = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": "open"},
                              dry_run=False)
    assert err and got["error"] == "plan_required"
    plan, _ = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": "open"})
    got, err = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": "closed"},
                              dry_run=False, plan=plan["plan"])
    assert err and got["error"] == "plan_mismatch"
    got, err = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": "open"},
                              dry_run=False, plan=plan["plan"][:-3] + "AAA")
    assert err and got["error"] == "plan_invalid"
    # someone else saved meanwhile
    mantel.app["settings"].store.write([("board", "dashboard-kitchen", {"title": "Kitchen", "accent": "blue"})],
                                       actor=Actor(label="t"))
    got, err = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": "open"},
                              dry_run=False, plan=plan["plan"])
    assert err and got["error"] == "conflict"
    # too late
    plan, _ = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": "open"})
    mantel.now[0] += 700
    got, err = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": "open"},
                              dry_run=False, plan=plan["plan"])
    assert err and got["error"] == "plan_expired"


async def test_another_assistants_plan_is_not_this_ones(mantel):
    token, _ = await setup(mantel)
    other, _ = await make_key(mantel, "Other")
    plan, _ = await Rpc(mantel, token).tool("settings_change", scope="board", key="dashboard-kitchen",
                                            changes={"menu": "open"})
    got, err = await Rpc(mantel, other).tool("settings_change", scope="board", key="dashboard-kitchen",
                                             changes={"menu": "open"}, dry_run=False, plan=plan["plan"])
    assert err and got["error"] == "plan_invalid"


async def test_a_refusal_is_the_settings_pages_own(mantel):
    token, _ = await setup(mantel)
    got, err = await Rpc(mantel, token).tool("settings_change", scope="board", key="dashboard-kitchen",
                                             changes={"menu": "sideways"})
    assert err and got["error"] == "invalid_format" and "menu" in (got.get("fields") or {})
    got, err = await Rpc(mantel, token).tool("settings_change", scope="board", key="dashboard-kitchen",
                                             changes={"no_such_key": 1})
    assert err and "no_such_key" in (got.get("fields") or {})


async def test_writes_are_rate_limited(mantel):
    token, _ = await setup(mantel)
    r = await mantel.client.put("/api/mcp/settings", json={"mcp_write_rate": 1}, headers=mantel.headers())
    assert r.status == 200
    rpc = Rpc(mantel, token)
    for value, ok in (("open", True), ("off", False)):
        plan, _ = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": value})
        got, err = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": value},
                                  dry_run=False, plan=plan["plan"])
        assert err is (not ok), got
    assert got["error"] == "rate_limited"


async def test_restore_needs_its_scope_and_undoes(mantel):
    token, _ = await setup(mantel, scopes=["read", "settings", "restore"])
    rpc = Rpc(mantel, token)
    plan, _ = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": "open"})
    done, _ = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": "open"},
                             dry_run=False, plan=plan["plan"])
    undo = done["changes"][0]["undo"]
    plan, err = await rpc.tool("settings_restore", scope="board", key="dashboard-kitchen", version=undo["version"])
    assert not err, plan
    got, err = await rpc.tool("settings_restore", scope="board", key="dashboard-kitchen", version=undo["version"],
                              dry_run=False, plan=plan["plan"])
    assert not err, got
    assert "menu" not in mantel.app["settings"].store.body("board", "dashboard-kitchen")


# -- screens and Home Grid -----------------------------------------------------------------------------------------------
GRID = {"v": 1, "cols": 6, "rows": 4, "band": True,
        "items": [{"id": "lights", "card": "accessory", "size": "W", "at": [0, 0], "opts": {"entity": "light.den_lamp"}},
                  {"id": "clock", "card": "clock", "size": "S", "at": [2, 0]}]}


async def test_a_screen_made_with_its_home_grid_in_one_plan(mantel):
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token)
    before = dump(mantel)
    plan, err = await rpc.tool("screen_create", title="Loft Tablet", home_grid=GRID, settings={"menu": "open"})
    assert not err and plan["changes"][0]["key"] == "loft-tablet", plan
    assert dump(mantel) == before, "no screen, no audit row, nothing"
    done, err = await rpc.tool("screen_create", title="Loft Tablet", home_grid=GRID, settings={"menu": "open"},
                               dry_run=False, plan=plan["plan"])
    assert not err, done
    b = mantel.app["settings"].store.body("board", "loft-tablet")
    assert b["home_style"] == "grid" and b["home_grid"]["items"][0]["id"] == "lights" and b["where"] == "mantel"
    row = audits(mantel, "screen.add")[0]
    assert row["via"] == "mcp:Claude Code"
    listed, _ = await rpc.tool("screens_list")
    assert any(s["key"] == "loft-tablet" and s["home_style"] == "grid" for s in listed["screens"])


async def test_a_home_grid_that_does_not_check_is_refused_with_why(mantel):
    token, _ = await setup(mantel)
    bad = {**GRID, "items": GRID["items"] + [{"id": "x", "card": "clock", "size": "S", "at": [0, 0]}]}
    got, err = await Rpc(mantel, token).tool("grid_set", screen="dashboard-kitchen", home_grid=bad)
    assert err and "grid_overlap" in json.dumps(got)
    got, err = await Rpc(mantel, token).tool("grid_set", screen="dashboard-kitchen",
                                             home_grid={**GRID, "items": [{"id": "x", "card": "clock", "size": "F",
                                                                           "at": [0, 0]}]})
    assert err and "grid_size" in json.dumps(got)


async def test_a_solar_window_rule_through_the_mcp(mantel):
    """Show When's Solar Window (2026-11-10): grid_cards says its shape, grid_set plans and saves it as given, and a
    window that can't be one is refused with grid_condition."""
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token)
    cards, err = await rpc.tool("grid_cards")
    assert not err and "solar_window" in cards["rules"]["conditions"] and cards["rules"]["first_match_wins"] is True
    evening = {"kind": "solar_window", "from": {"sun": "sunset", "offset": -15}, "to": {"at": "22:00"}}
    morning = {"kind": "solar_window", "from": {"sun": "sunrise", "offset": -60}, "to": {"sun": "sunrise", "offset": 30}}
    clock = {"id": "clock", "card": "clock", "size": "S", "at": [2, 0],
             "rules": [{"when": {"all": [evening]}, "card": "accessory", "opts": {"entity": "light.den_lamp"}},
                       {"when": {"all": [morning]}, "card": "accessory", "opts": {"entity": "light.den_lamp"}}]}
    grid = {**GRID, "items": [GRID["items"][0], clock]}
    plan, err = await rpc.tool("grid_set", screen="dashboard-kitchen", home_grid=grid)
    assert not err, plan
    done, err = await rpc.tool("grid_set", screen="dashboard-kitchen", home_grid=grid, dry_run=False, plan=plan["plan"])
    assert not err, done
    saved = mantel.app["settings"].store.body("board", "dashboard-kitchen")["home_grid"]["items"][1]["rules"]
    assert [r["when"] for r in saved] == [{"all": [evening]}, {"all": [morning]}]
    bad = {**clock, "rules": [{"when": {"all": [{**evening, "from": {"sun": "sunset", "offset": 900}}]}, "card": "clock"}]}
    got, err = await rpc.tool("grid_set", screen="dashboard-kitchen", home_grid={**GRID, "items": [GRID["items"][0], bad]})
    assert err and "grid_condition" in json.dumps(got)


async def test_ten_show_when_rules_through_the_mcp(mantel):
    """Show When takes ten rules (2026-11-10; four before): grid_cards says so, grid_set and grid_place plan and save all
    ten in their order, an eleventh or a fourth condition is refused with grid_condition, and an export imports whole."""
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token)
    cards, err = await rpc.tool("grid_cards")
    assert not err and cards["rules"]["rules_max"] == 10 and cards["rules"]["conditions_per_rule_max"] == 3
    rules = [{"when": {"all": [{"kind": "time", "from": f"{i:02d}:00", "to": f"{i:02d}:30"}]},
              "card": "accessory", "opts": {"entity": "light.den_lamp"}} for i in range(10)]
    rules[9]["when"]["all"] += [{"kind": "music_playing"}, {"kind": "alarm_armed"}]           # three conditions
    clock = {"id": "clock", "card": "clock", "size": "S", "at": [2, 0], "rules": rules}

    async def apply(name, **a):
        plan, err = await rpc.tool(name, **a)
        assert not err, plan
        done, err = await rpc.tool(name, **a, dry_run=False, plan=plan["plan"])
        assert not err, done

    def saved(key="dashboard-kitchen"):
        return mantel.app["settings"].store.body("board", key)["home_grid"]["items"]
    await apply("grid_set", screen="dashboard-kitchen", home_grid={**GRID, "items": [GRID["items"][0], clock]})
    assert [r["when"] for r in saved()[1]["rules"]] == [r["when"] for r in rules]
    for bad in (rules + rules[:1],
                rules[:9] + [{**rules[9], "when": {"all": rules[9]["when"]["all"] + [{"kind": "after_sunset"}]}}]):
        got, err = await rpc.tool("grid_set", screen="dashboard-kitchen",
                                  home_grid={**GRID, "items": [GRID["items"][0], {**clock, "rules": bad}]})
        assert err and "grid_condition" in json.dumps(got)
        got, err = await rpc.tool("grid_place", screen="dashboard-kitchen", block={**clock, "rules": bad})
        assert err and "grid_condition" in json.dumps(got)
    moved = rules[1:] + rules[:1]
    await apply("grid_place", screen="dashboard-kitchen", block={**clock, "rules": moved})
    assert [r["when"] for r in saved()[1]["rules"]] == [r["when"] for r in moved]
    exp, err = await rpc.tool("screen_export", screen="dashboard-kitchen")
    assert not err and len(exp["board"]["home_grid"]["items"][1]["rules"]) == 10
    await apply("screen_import", export=exp, title="Ten Rules")
    assert [r["when"] for r in saved("ten-rules")[1]["rules"]] == [r["when"] for r in moved]


async def test_alerts_as_show_when_rules_through_the_mcp(mantel):
    """The Alert card (docs/phase11/ALERT.md): grid_cards describes it with an example, grid_set plans and saves a block's two
    alerts in their order behind its own card, and an option an alert doesn't take is refused with grid_option."""
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token)
    cards, err = await rpc.tool("grid_cards")
    assert not err and cards["cards"]["alert"]["sizes"] == ["S", "W", "T", "L", "XL"] and cards["alert"]["example"]["card"] == "alert"
    garage = {"when": {"all": [{"kind": "entity_state", "entity": "binary_sensor.garage_door_open_too_long", "state": "on"}]},
              "card": "alert", "opts": {"title": "Garage Still Open", "since": "cover.garage_door", "camera": "camera.garage",
                                        "control": "cover.garage_door", "color": "teal"}}
    laundry = {"when": {"all": [{"kind": "entity_state", "entity": "sensor.washer_job_state", "state": "finish"}]},
               "card": "alert", "opts": {"title": "Laundry Ready", "text": "Cycle complete", "camera": "camera.washer"}}
    status = {"id": "status", "card": "house_status", "size": "T", "at": [3, 0], "rules": [garage, laundry]}
    grid = {**GRID, "items": [GRID["items"][0], status]}
    plan, err = await rpc.tool("grid_set", screen="dashboard-kitchen", home_grid=grid)
    assert not err, plan
    done, err = await rpc.tool("grid_set", screen="dashboard-kitchen", home_grid=grid, dry_run=False, plan=plan["plan"])
    assert not err, done
    saved = mantel.app["settings"].store.body("board", "dashboard-kitchen")["home_grid"]["items"][1]
    assert saved["card"] == "house_status" and [r["opts"]["title"] for r in saved["rules"]] == ["Garage Still Open", "Laundry Ready"]
    bad = {**status, "rules": [{**garage, "opts": {**garage["opts"], "tap": "page"}}]}
    got, err = await rpc.tool("grid_set", screen="dashboard-kitchen", home_grid={**GRID, "items": [GRID["items"][0], bad]})
    assert err and "grid_option" in json.dumps(got)


async def test_placing_and_removing_one_block(mantel):
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token)

    async def apply(name, **a):
        plan, err = await rpc.tool(name, **a)
        assert not err, plan
        done, err = await rpc.tool(name, **a, dry_run=False, plan=plan["plan"])
        assert not err, done
        return done
    await apply("grid_set", screen="dashboard-kitchen", home_grid=GRID)
    await apply("grid_place", screen="dashboard-kitchen",
                block={"id": "cam", "card": "camera", "size": "L", "at": [3, 0], "opts": {"entity": "camera.porch"}})
    items = mantel.app["settings"].store.body("board", "dashboard-kitchen")["home_grid"]["items"]
    assert [i["id"] for i in items] == ["lights", "clock", "cam"]
    await apply("grid_remove", screen="dashboard-kitchen", block_id="clock")
    items = mantel.app["settings"].store.body("board", "dashboard-kitchen")["home_grid"]["items"]
    assert [i["id"] for i in items] == ["lights", "cam"]
    got, err = await rpc.tool("grid_remove", screen="dashboard-kitchen", block_id="nope")
    assert err and got["error"] == "not_found"


async def test_screens_in_home_assistant_stay_mantel_settings(mantel):
    token, _ = await setup(mantel)
    got, err = await Rpc(mantel, token).tool("screen_create", title="X", where="ha")
    assert err


async def test_rename_and_remove_a_screen(mantel):
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token)
    plan, _ = await rpc.tool("screen_rename", screen="dashboard-kitchen", title="Cook")
    await rpc.tool("screen_rename", screen="dashboard-kitchen", title="Cook", dry_run=False, plan=plan["plan"])
    assert mantel.app["settings"].store.body("board", "dashboard-kitchen")["title"] == "Cook"
    mantel.app["settings"].store.write([("tablet", "hall", {"name": "Hall", "screen": "dashboard-kitchen"})],
                                       actor=Actor(label="t"))
    got, err = await rpc.tool("screen_remove", screen="dashboard-kitchen")
    assert err and got["error"] == "tablets", "a screen a tablet opens stays"


async def test_a_batch_is_planned_together_and_stops_on_a_refusal(mantel):
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token)
    steps = [{"tool": "settings_change", "arguments": {"scope": "board", "key": "dashboard-kitchen",
                                                       "changes": {"menu": "open"}}},
             {"tool": "screen_create", "arguments": {"title": "Den Screen", "home_grid": GRID}}]
    before = dump(mantel)
    plan, err = await rpc.tool("settings_apply", steps=steps)
    assert not err and {c["key"] for c in plan["changes"]} == {"dashboard-kitchen", "den-screen"}
    assert dump(mantel) == before
    done, err = await rpc.tool("settings_apply", steps=steps, dry_run=False, plan=plan["plan"])
    assert not err and len(done["result"]["steps"]) == 2, done
    assert mantel.app["settings"].store.get("board", "den-screen") is not None
    got, err = await rpc.tool("settings_apply", steps=[{"tool": "house_command", "arguments": {}}])
    assert err and got["error"] == "invalid_arguments"
    got, err = await rpc.tool("settings_apply", steps=[{"tool": "settings_change", "arguments": {
        "scope": "board", "key": "dashboard-kitchen", "changes": {"menu": "sideways"}}}])
    assert err and got.get("step") == 0


async def test_export_and_import_match_entities_by_name_and_room(mantel):
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token)
    s = mantel.app["settings"].store
    s.write([("board", "dashboard-kitchen", {"title": "Kitchen", "home_style": "grid", "home_grid": GRID})],
            actor=Actor(label="t"))
    exp, err = await rpc.tool("screen_export", screen="dashboard-kitchen")
    assert not err and exp["entities"]["light.den_lamp"]["area"] == "Den"
    # another house: the same lamp under another id
    exp["board"]["home_grid"]["items"][0]["opts"]["entity"] = "light.old_den_lamp"
    exp["entities"]["light.old_den_lamp"] = {"name": "Den Lamp", "area": "Den", "domain": "light"}
    plan, err = await rpc.tool("screen_import", export=exp, title="Copy")
    assert not err and plan["matched"] == {"light.old_den_lamp": "light.den_lamp"}, plan
    assert plan["key"] == "screen-copy", "one word gets screen- (Home Assistant wants a hyphen)"
    await rpc.tool("screen_import", export=exp, title="Copy", dry_run=False, plan=plan["plan"])
    assert s.body("board", "screen-copy")["home_grid"]["items"][0]["opts"]["entity"] == "light.den_lamp"
    exp["entities"]["light.gone"] = {"name": "Gone", "area": "Attic", "domain": "light"}
    got, err = await rpc.tool("screen_import", export=exp, title="Copy 2")
    assert err and got["error"] == "unmatched" and got["missing"][0]["entity_id"] == "light.gone"


async def test_a_screen_from_a_template_uses_this_house(mantel):
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token)
    t, _ = await rpc.tool("screen_templates")
    assert "kitchen" in {x["template"] for x in t["templates"]}
    plan, err = await rpc.tool("screen_from_template", template="hallway", room="Den")
    assert not err and plan["home_grid"]["items"], plan
    assert any(i["card"] == "camera" for i in plan["home_grid"]["items"]), "the house has a camera"


async def test_tablet_setup_leaves_enrolment_to_a_person(mantel):
    token, _ = await setup(mantel)
    mantel.app["settings"].store.write([("tablet", "hall", {"name": "Hall"})], actor=Actor(label="t"))
    got, err = await Rpc(mantel, token).tool("tablet_setup", tablet="hall", screen="dashboard-kitchen")
    assert not err and got["planned"] and "/settings#/mantel/devices/enroll/hall" in got["steps"]["enrol"]["open"]


# -- previews ---------------------------------------------------------------------------------------------------------
async def test_a_preview_is_single_use_and_read_only(mantel):
    token, _ = await setup(mantel)
    link, err = await Rpc(mantel, token).tool("screen_preview", screen="dashboard-kitchen")
    assert not err
    path = urlparse(link["url"]).path
    mantel.forget_cookies()
    r = await mantel.client.get(path, allow_redirects=False)
    assert r.status == 302 and r.headers["Location"] == "/dashboard-kitchen/home"
    row = mantel.app["store"].db.execute("SELECT s.method, u.username FROM sessions s JOIN users u ON u.id = s.user_id "
                                         "WHERE s.method = 'mcp_preview'").fetchone()
    assert row["username"] == "olive", "the screen as the person sees it"
    r = await mantel.client.post("/api/mcp/keys", json={"name": "x"}, headers=mantel.headers())
    assert r.status == 403 and "read_only" in await r.text()
    mantel.forget_cookies()
    r = await mantel.client.get(path, allow_redirects=False)
    assert r.status == 410, "used once"


async def test_a_preview_never_signs_someone_else_out(mantel):
    token, _ = await setup(mantel)
    link, _ = await Rpc(mantel, token).tool("screen_preview", screen="dashboard-kitchen")
    await mantel.user("ada", "adult")
    await mantel.sign_in("ada")
    r = await mantel.client.get(urlparse(link["url"]).path, allow_redirects=False)
    assert r.status == 409


# -- signing in (OAuth) -------------------------------------------------------------------------------------------------
async def oauth(mantel, scopes=("read", "settings"), away=False):
    meta = await (await mantel.client.get("/.well-known/oauth-protected-resource/mcp")).json()
    assert meta["resource"].endswith("/mcp")
    asm = await (await mantel.client.get("/.well-known/oauth-authorization-server")).json()
    assert asm["code_challenge_methods_supported"] == ["S256"]
    reg = await mantel.client.post("/mcp/oauth/register", json={"client_name": "Claude Desktop",
                                                                "redirect_uris": ["http://127.0.0.1:33418/cb"]})
    assert reg.status == 201
    cid = (await reg.json())["client_id"]
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    q = {"response_type": "code", "client_id": cid, "redirect_uri": "http://127.0.0.1:33418/cb",
         "code_challenge": challenge, "code_challenge_method": "S256", "state": "st8",
         "scope": " ".join(scopes), "resource": meta["resource"]}
    r = await mantel.client.get("/mcp/oauth/authorize", params=q)
    page = await r.text()
    assert r.status == 200 and "Claude Desktop" in page and "Allow" in page
    assert "form-action 'self' http://127.0.0.1:33418" in r.headers["Content-Security-Policy"]
    form = {**q, "csrf": mantel.cookie("mantel_csrf"), "decision": "allow"}
    data = [(k, v) for k, v in form.items()] + [("grant_scope", s) for s in scopes] + ([("away", "1")] if away else [])
    r = await mantel.client.post("/mcp/oauth/authorize", data=data, allow_redirects=False)
    assert r.status == 302, await r.text()
    back = parse_qs(urlparse(r.headers["Location"]).query)
    assert back["state"] == ["st8"] and back["iss"][0] == asm["issuer"]
    tok = await mantel.client.post("/mcp/oauth/token", data={"grant_type": "authorization_code", "code": back["code"][0],
                                                             "redirect_uri": q["redirect_uri"], "client_id": cid,
                                                             "code_verifier": verifier, "resource": meta["resource"]})
    body = await tok.json()
    assert tok.status == 200, body
    return cid, body, back["code"][0], verifier


async def test_signing_in_with_oauth_end_to_end(mantel):
    house(mantel)
    await owner(mantel)
    await turn_on(mantel)
    cid, tokens, code, verifier = await oauth(mantel)
    assert tokens["token_type"] == "Bearer" and tokens["scope"] == "read settings"
    rpc = Rpc(mantel, tokens["access_token"])
    st, body = await rpc.call("tools/list")
    assert st == 200 and "screen_create" not in [t["name"] for t in body["result"]["tools"]], "only what was ticked"
    # the code is single use
    again = await mantel.client.post("/mcp/oauth/token", data={"grant_type": "authorization_code", "code": code,
                                                               "client_id": cid, "code_verifier": verifier})
    assert again.status == 400
    # refresh rotates; the old refresh token used again ends the family
    r = await mantel.client.post("/mcp/oauth/token", data={"grant_type": "refresh_token",
                                                           "refresh_token": tokens["refresh_token"], "client_id": cid})
    new = await r.json()
    assert r.status == 200 and new["refresh_token"] != tokens["refresh_token"]
    assert (await Rpc(mantel, new["access_token"]).call("tools/list"))[0] == 200
    mantel.now[0] += 60
    r = await mantel.client.post("/mcp/oauth/token", data={"grant_type": "refresh_token",
                                                           "refresh_token": tokens["refresh_token"], "client_id": cid})
    assert r.status == 400
    assert (await Rpc(mantel, new["access_token"]).call("tools/list"))[0] == 401


async def test_an_assistants_token_is_no_browser_cookie(mantel):
    house(mantel)
    await owner(mantel)
    await turn_on(mantel)
    _, tokens, _, _ = await oauth(mantel)
    mantel.forget_cookies()
    mantel.set_cookies(mantel_session=tokens["access_token"])
    r = await mantel.client.get("/api/admin/overview")
    assert r.status == 401


async def test_pkce_and_the_redirect_are_checked(mantel):
    house(mantel)
    await owner(mantel)
    await turn_on(mantel)
    reg = await mantel.client.post("/mcp/oauth/register", json={"client_name": "X",
                                                                "redirect_uris": ["http://evil.example/cb"]})
    assert reg.status == 400, "http only on this computer"
    reg = await mantel.client.post("/mcp/oauth/register", json={"redirect_uris": ["https://app.example/cb"]})
    cid = (await reg.json())["client_id"]
    r = await mantel.client.get("/mcp/oauth/authorize", params={"response_type": "code", "client_id": cid,
                                                                 "redirect_uri": "https://other.example/cb",
                                                                 "code_challenge": "x" * 43,
                                                                 "code_challenge_method": "S256"},
                                allow_redirects=False)
    assert r.status == 400, "never sent anywhere it did not register"
    r = await mantel.client.get("/mcp/oauth/authorize", params={"response_type": "code", "client_id": cid,
                                                                 "redirect_uri": "https://app.example/cb",
                                                                 "code_challenge_method": "plain"},
                                allow_redirects=False)
    assert r.status == 302 and "error=invalid_request" in r.headers["Location"]


async def test_a_signed_in_assistant_from_away_only_when_both_allow(mantel):
    house(mantel)
    await owner(mantel)
    await turn_on(mantel, mcp_away=True)
    _, tokens, _, _ = await oauth(mantel, away=True)
    rpc = Rpc(mantel, tokens["access_token"])
    assert (await rpc.call("tools/list", headers={"X-Mantel-Door": "tunnel"}))[0] == 200
    await mantel.client.put("/api/mcp/settings", json={"mcp_away": False}, headers=mantel.headers())
    assert (await rpc.call("tools/list", headers={"X-Mantel-Door": "tunnel"}))[0] == 403


async def _consent(m, scopes=("read", "settings", "restore"), decision="allow", away=True):
    """A registered assistant's consent form POST (what the page's Allow button sends)."""
    reg = await m.client.post("/mcp/oauth/register", json={"client_name": "Claude",
                                                           "redirect_uris": ["https://assistant.example/cb"]})
    cid = (await reg.json())["client_id"]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(secrets.token_urlsafe(48).encode()).digest()).rstrip(b"=").decode()
    q = {"response_type": "code", "client_id": cid, "redirect_uri": "https://assistant.example/cb",
         "code_challenge": challenge, "code_challenge_method": "S256", "state": "s", "scope": " ".join(scopes)}
    page = await m.client.get("/mcp/oauth/authorize", params=q, allow_redirects=False)
    data = list({**q, "csrf": m.cookie("mantel_csrf"), "decision": decision}.items())
    data += [("grant_scope", s) for s in scopes] + ([("away", "1")] if away else [])
    return page, await m.client.post("/mcp/oauth/authorize", data=data, allow_redirects=False), q


async def test_connecting_an_assistant_needs_the_fresh_sign_in_a_personal_key_needs(mantel):
    """SRV-1 (third audit pass): the consent issued a 30-day, refreshable credential (settings, restore, ...), from
    away too, to a session whose sign-in was ten minutes old, while ``POST /api/mcp/keys`` (the same kind of
    credential) answered ``step_up_required``. A stale session is shown Sign In Again, not the form; nothing is
    audited or issued; signing in again comes back to the same request."""
    m = mantel
    house(m)
    await owner(m)
    await turn_on(m, mcp_away=True)
    m.now[0] += 600
    r = await m.client.post("/api/mcp/keys", json={"name": "Key"}, headers=m.headers())
    assert r.status == 403 and (await r.json())["error"] == "step_up_required"        # the control
    page, r, q = await _consent(m)
    text = await page.text()
    assert page.status == 403 and "Sign In Again" in text and "grant_scope" not in text and "Allow<" not in text
    assert r.status == 403 and "Sign In Again" in await r.text()
    assert not audits(m, "mcp.grant")
    assert m.app["store"].db.execute("SELECT COUNT(*) FROM mcp_codes").fetchone()[0] == 0
    # Sign In Again ends this session and lands on the sign-in page, which returns to this very consent request
    page, r, q = await _consent(m, decision="signin_again")
    assert r.status == 303 and r.headers["Location"].startswith("/login?next=/mcp/oauth/authorize%3F")
    assert (await m.client.get("/api/me")).status == 401
    # a fresh sign-in is allowed to connect it
    await m.sign_in("olive")
    page, r, q = await _consent(m)
    assert page.status == 200 and "Allow" in await page.text()
    assert r.status == 302 and "code=" in r.headers["Location"] and len(audits(m, "mcp.grant")) == 1


async def test_an_assistant_that_may_control_the_house_needs_a_fresh_sign_in_even_where_something_vouches(mantel, monkeypatch):
    """SRV-1: ``commands`` asks for a fresh factor on every door, as Allow Control of the House does; a sidebar HA
    vouches for (``is_fresh_to_add_factor``) is enough for the other scopes only."""
    from mantel_server.mcp import oauth as O
    m = mantel
    house(m)
    await owner(m)
    await turn_on(m, mcp_away=True)
    monkeypatch.setattr(O, "offered", lambda request: [*O.SCOPES])
    m.now[0] += 600
    monkeypatch.setattr(O, "is_fresh_to_add_factor", lambda request, ident: True)       # HA vouches for the person
    _, r, _ = await _consent(m, scopes=("read", "commands"))
    assert r.status == 403 and "control the house" in await r.text() and not audits(m, "mcp.grant")
    _, r, _ = await _consent(m, scopes=("read", "settings"))
    assert r.status == 302 and len(audits(m, "mcp.grant")) == 1
    await m.sign_in("olive")                                                             # and a fresh sign-in does both
    _, r, _ = await _consent(m, scopes=("read", "commands"))
    assert r.status == 302 and len(audits(m, "mcp.grant")) == 2


# -- commands and the audit ------------------------------------------------------------------------------------------
async def test_commands_only_by_consent_and_through_the_gateway(mantel):
    house(mantel)
    await owner(mantel)
    await turn_on(mantel, mcp_commands=True)
    _, tokens, _, _ = await oauth(mantel, scopes=("read", "commands"))
    rpc = Rpc(mantel, tokens["access_token"])
    names = [t["name"] for t in (await rpc.call("tools/list"))[1]["result"]["tools"]]
    assert "house_command" not in names, "the consent page offered no commands: Allow Control of the House is off"


async def test_commands_scope_refused_while_the_house_is_read_only(mantel):
    house(mantel)
    await owner(mantel)
    await turn_on(mantel, mcp_commands=True)
    gid = None
    grants = mantel.app["mcp_grants"]
    user = mantel.app["store"].db.execute("SELECT * FROM users WHERE username='olive'").fetchone()
    from mantel_server.sessions import User
    g, issued = grants.create_oauth(User(user["id"], user["name"], "owner", "person"), None, "Tester",
                                    ["read", "commands"], False, "lan")
    gid = g.id
    rpc = Rpc(mantel, issued.access)
    got, err = await rpc.tool("house_command", domain="light", service="turn_on", entity_ids=["light.den_lamp"])
    assert err and got["error"] == "commands_disabled"
    got, err = await rpc.tool("house_command", domain="alarm_control_panel", service="alarm_disarm",
                              entity_ids=["alarm_control_panel.house"])
    assert err and got["error"] == "forbidden", "never the alarm"
    await mantel.client.put("/api/mcp/settings", json={"mcp_commands": False}, headers=mantel.headers())
    got, err = await rpc.tool("house_command", domain="light", service="turn_on", entity_ids=["light.den_lamp"])
    assert err and got["error"] == "forbidden", "the house took the scope away"
    assert gid


async def test_the_audit_log_names_the_assistant(mantel):
    token, _ = await setup(mantel, scopes=["read", "settings", "screens", "audit"])
    rpc = Rpc(mantel, token)
    plan, _ = await rpc.tool("screen_create", title="Den Two")
    await rpc.tool("screen_create", title="Den Two", dry_run=False, plan=plan["plan"])
    got, err = await rpc.tool("audit_recent", mine=True)
    assert not err and got["rows"] and all(r["via"] == "mcp:Claude Code" for r in got["rows"])
    r = await mantel.client.get("/api/audit?via=mcp")
    rows = (await r.json())["rows"]
    assert rows and all(x["via"].startswith("mcp") for x in rows)
    r = await mantel.client.get("/api/audit?via=-")
    assert all(x["via"] is None for x in (await r.json())["rows"])
    hist, err = await rpc.tool("settings_history", scope="board", key="den-two")
    assert not err and hist["history"][0]["via"] == "mcp:Claude Code"


@pytest.mark.parametrize("tool,args", [
    ("settings_change", {"scope": "house", "changes": {"look.glass": "frosted"}}),
    ("accessory_set", {"entity_id": "light.den_lamp", "fields": {"name": "Reading Lamp"}, "hidden": True}),
    ("screen_create", {"title": "Planned"}),
    ("screen_rename", {"screen": "dashboard-kitchen", "title": "Cook"}),
    ("screen_move", {"screen": "dashboard-kitchen", "where": "ha"}),
    ("screen_remove", {"screen": "dashboard-kitchen"}),
    ("grid_set", {"screen": "dashboard-kitchen", "home_grid": GRID}),
    ("tablet_setup", {"tablet": "hall", "screen": "dashboard-kitchen"}),
])
async def test_every_plan_leaves_the_database_as_it_was(mantel, tool, args):
    token, _ = await setup(mantel)
    mantel.app["settings"].store.write([("tablet", "hall", {"name": "Hall"})], actor=Actor(label="t"))
    before = dump(mantel)
    got, err = await Rpc(mantel, token).tool(tool, **args)
    assert not err and got["planned"], got
    assert got["changes"], "it would change something"
    assert dump(mantel) == before


# -- Music ------------------------------------------------------------------------------------------------------------
class FakeMa:
    """Music Assistant's library, as far as the Music page reads it."""

    def __init__(self, playlists):
        import asyncio
        self.connected = asyncio.Event()
        self.connected.set()
        self.playlists = playlists

    async def library(self, kind, **args):
        return {"items": list(self.playlists)} if kind == "playlists" else {"items": []}

    async def close(self):
        pass


def pill(key, name, items, order=10.0):
    return {"kind": "playlist", "key": key, "title": name,
            "data": {"name": name, "icon": "mdi:music", "items": items, "order": order}}


async def test_music_relink_matches_gone_links_by_name(mantel):
    token, _ = await setup(mantel)

    mantel.app["ma"] = FakeMa([{"uri": "library://playlist/71", "name": "Dinner"},
                       {"uri": "library://playlist/72", "name": "Morning Jazz"},
                       {"uri": "library://playlist/73", "name": "Morning Jazz"}])
    mantel.app["settings"].store.write([("house", "music", {
        "options": {"speakers": [], "volume": 0.3, "homes": {}},
        "items": [pill("p1", "Dinner", ["library://playlist/7"]),
                  pill("p2", "Morning Jazz", ["library://playlist/8"], 20.0),
                  pill("p3", "Kept", ["library://playlist/71"], 30.0)]})], actor=Actor(label="t"))
    rpc = Rpc(mantel, token)
    page, err = await rpc.tool("music_settings")
    assert not err and page["library_checked"]
    links = {p["name"]: p["links"] for p in page["playlists"]}
    assert links["Dinner"][0]["gone"] is True and links["Kept"][0] == {"uri": "library://playlist/71",
                                                                         "name": "Dinner", "gone": False}
    before = dump(mantel)
    plan, err = await rpc.tool("music_relink")
    assert not err, plan
    assert [f["pill"] for f in plan["fixes"]] == ["p1"] and plan["fixes"][0]["to"] == ["library://playlist/71"]
    assert plan["no_match"][0]["pill"] == "p2" and "2" not in plan["no_match"][0]["why"] or plan["no_match"]
    assert dump(mantel) == before, "a plan changes nothing"
    done, err = await rpc.tool("music_relink", dry_run=False, plan=plan["plan"])
    assert not err and done["result"]["relinked"] == ["p1"], done
    items = {i["key"]: i["data"]["items"] for i in mantel.app["settings"].store.body("house", "music")["items"]}
    assert items["p1"] == ["library://playlist/71"] and items["p2"] == ["library://playlist/8"]
    h = mantel.app["store"].db.execute("SELECT via FROM settings_history WHERE scope='house' AND key='music' "
                                       "ORDER BY version DESC").fetchone()
    assert h["via"] == "mcp:Claude Code"
    # a mapping settles the one with two of that name
    plan, err = await rpc.tool("music_relink", mapping={"library://playlist/8": "library://playlist/73"})
    assert not err and [f["pill"] for f in plan["fixes"]] == ["p2"]


async def test_a_music_change_can_be_looked_up_and_undone_as_it_says(mantel):
    """SRV-7 (third audit pass): every music_* change answers an undo (settings_restore of house/music), but
    house/music was not in HOUSE_DOCS, so its history and its restore were always refused."""
    token, _ = await setup(mantel, scopes=["read", "settings", "audit", "restore"])
    mantel.app["ma"] = FakeMa([{"uri": "library://playlist/71", "name": "Dinner"}])
    store = mantel.app["settings"].store
    store.write([("house", "music", {"options": {"speakers": [], "volume": 0.3, "homes": {}},
                                     "items": [pill("p1", "Dinner", ["library://playlist/7"])]})], actor=Actor(label="t"))
    rpc = Rpc(mantel, token)
    plan, err = await rpc.tool("music_relink")
    done, err = await rpc.tool("music_relink", dry_run=False, plan=plan["plan"])
    assert not err and done["changes"][0]["key"] == "music"
    undo = done["changes"][0]["undo"]
    assert undo == {"tool": "settings_restore", "scope": "house", "key": "music", "version": 1}
    for args in ({"scope": "music"}, {"scope": "house", "key": "music"}):
        got, err = await rpc.tool("settings_history", **args)
        assert not err and got["key"] == "music" and [h["version"] for h in got["history"]] == [2, 1], (args, got)
    assert store.body("house", "music")["items"][0]["data"]["items"] == ["library://playlist/71"]
    heard = []
    assert "house/music" in mantel.app["settings"].after_restore, "Music follows a restore, as it follows a save"
    mantel.app["settings"].after_restore["house/music"] = lambda: heard.append(True)
    plan, err = await rpc.tool("settings_restore", scope="music", version=undo["version"])
    assert not err, plan
    got, err = await rpc.tool("settings_restore", scope="music", version=undo["version"], dry_run=False, plan=plan["plan"])
    assert not err and got["result"]["restored_from"] == 1 and heard == [True], got
    assert store.body("house", "music")["items"][0]["data"]["items"] == ["library://playlist/7"]
    # a version that is no Music document is not put back (restore runs the same check)
    from mantel_server.settings_store import SettingsError
    with pytest.raises(SettingsError):
        mantel.app["settings"].model.check_document("house", "music", {"options": {"volume": 7}})


def test_relink_plan_rules():
    from mantel_server.mcp.tools.music import relink_plan
    lib = [{"uri": "library://playlist/1", "name": "Café Mix"}, {"uri": "library://playlist/2", "name": "Rain"}]
    fixes, stuck = relink_plan([{"id": "a", "name": "cafe mix", "items": ["library://playlist/9"]},
                                {"id": "b", "name": "Two", "items": ["library://playlist/8", "library://playlist/7"]},
                                {"id": "c", "name": "Radio", "items": ["http://radio.example/stream"]}], lib, {})
    assert [f["pill"] for f in fixes] == ["a"], "accents and case forgiven; a non-library link is left alone"
    assert {s["pill"] for s in stuck} == {"b"}, "two dead links can't both be guessed from one name"


async def test_a_preview_opens_screens_only(mantel):
    token, _ = await setup(mantel)
    link, _ = await Rpc(mantel, token).tool("screen_preview", screen="dashboard-kitchen")
    mantel.forget_cookies()
    await mantel.client.get(urlparse(link["url"]).path, allow_redirects=False)
    for path in ("/settings", "/api/admin/overview", "/api/users", "/api/mcp", "/api/audit", "/ma/"):
        r = await mantel.client.get(path, allow_redirects=False)
        assert r.status == 403, path
    r = await mantel.client.get("/dashboard-kitchen/home", allow_redirects=False)
    assert r.status == 200


async def _open_preview(mantel, scopes=("screens",)):
    token, _ = await setup(mantel, scopes=list(scopes))
    link, err = await Rpc(mantel, token).tool("screen_preview", screen="dashboard-kitchen")
    assert not err
    mantel.forget_cookies()
    await mantel.client.get(urlparse(link["url"]).path, allow_redirects=False)


async def test_a_preview_reaches_only_what_a_screen_draws_from(mantel):
    """SRV-2 (third audit pass): a preview, minted by a key with only `screens`, was a read-only browser session as
    the Owner that was refused a list of settings routes and reached every other: Sessions, People, Faces, Alarm
    PINs, Set Up, Push targets, passkeys, phones, default screens, features. Now an allow-list."""
    await _open_preview(mantel)
    for path in ("/api/sessions", "/api/phones", "/api/people/ha", "/api/default-screens", "/api/default-screen",
                 "/api/photos/faces", "/api/photos", "/api/photos/cutouts", "/api/photos/import", "/api/alarm/pins",
                 "/api/setup", "/api/auth/passkeys", "/api/push/targets", "/api/features/settings",
                 "/api/features/status", "/api/entities", "/api/areas", "/api/stats", "/api/about", "/api/performance/tablets",
                 "/api/settings/import", "/api/live_tv/status", "/api/music/status", "/api/devices", "/dev",
                 "/api/rbac/roles", "/api/account/pin", "/ws/talk", "/api/user-files"):
        r = await mantel.client.get(path, allow_redirects=False)
        assert r.status == 403, (path, r.status)
    for path in ("/dashboard-kitchen/home", "/dashboard-kitchen/lights", "/api/me", "/api/session", "/api/registry",
                 "/api/fixtures", "/api/hk-cards", "/api/services", "/api/photos/screens"):
        r = await mantel.client.get(path, allow_redirects=False)
        assert r.status == 200, (path, r.status)
    # a change is refused wherever it goes (the session middleware), the same for the page's own routes
    assert (await mantel.client.post("/api/photos/screens/dashboard-kitchen", json={}, headers=mantel.headers())).status == 403


async def test_every_get_route_is_open_to_a_preview_exactly_as_its_declaration_says(mantel):
    """SRV-2, by rule (phase 18, A5): the HTTP walk. Every GET in the route table is tried by a preview: a route that
    doesn't declare ``preview`` is refused (read_only) and one that does is not. The hand list above is a spot check."""
    from mantel_server.route_table import public_paths
    await _open_preview(mantel)
    refused, let = [], []
    public = public_paths(mantel.app)            # signed-out addresses: no session is asked for, a preview's neither
    for row in mantel.app["route_table"]:
        if row.method != "GET" or row.path in ("/ws", "/ws/talk", "/mcp/preview/{code}"):
            continue
        path = row.sample()
        if path is None or path in public:
            continue
        r = await mantel.client.get(path, allow_redirects=False)
        body = (await r.read()).decode("utf-8", "replace")
        was_refused = r.status == 403 and "read_only" in body
        if row.policy.preview and was_refused:
            refused.append(path)
        if not row.policy.preview and not was_refused and r.status not in (404,):
            let.append(f"{path} {r.status}")
    assert not refused, f"declared preview, refused: {refused}"
    assert not let, f"not declared preview, let through: {let}"
    # a photo's screen sizes, never its original (preview="size=screen|mid|thumb")
    r = await mantel.client.get(f"/api/photos/{'0' * 32}/original", allow_redirects=False)
    assert r.status == 403 and "read_only" in await r.text()


async def test_a_previews_socket_reads_only_what_its_screen_draws_from(mantel):
    """SRV-2: the socket took `read` of any route: `mantel/settings/history` with bodies, Settings' documents."""
    await _open_preview(mantel)
    ws = await mantel.client.ws_connect("/ws")
    try:
        for i, inner in enumerate(({"type": "mantel/settings/history", "scope": "house", "key": "settings", "limit": 5,
                                    "bodies": True}, {"type": "mantel/settings/get", "scope": "house", "key": "settings"},
                                   {"type": "hk_frontend/hidden/get"}, {"type": "hk_music/settings/library"},
                                   {"type": "hk_frontend/panel/get"}), 1):
            await ws.send_json({"type": "read", "id": i, "msg": inner})
            reply = json.loads((await ws.receive(timeout=5)).data)
            assert reply["id"] == i and reply["error"]["code"] == "read_only", (inner, reply)
        await ws.send_json({"type": "read_subscribe", "id": 9, "msg": {"type": "mantel/settings/history", "scope": "house"}})
        reply = json.loads((await ws.receive(timeout=5)).data)
        assert reply["id"] == 9 and reply["error"]["code"] == "read_only"
        # what the screen itself reads is answered (a subscription's first frame, or its own error: never read_only)
        await ws.send_json({"type": "read_subscribe", "id": 10, "msg": {"type": "hk_frontend/settings/subscribe"}})
        first = json.loads((await ws.receive(timeout=5)).data)
        assert first.get("error", {}).get("code") != "read_only", first
    finally:
        await ws.close()


async def test_a_screens_reads_and_a_previews_never_reads_do_not_overlap():
    from mantel_server.socket_reads import READS_BY_TYPE
    preview = {t for t, r in READS_BY_TYPE.items() if r.preview}
    assert not any(t.startswith("mantel/settings") or t.endswith("/settings/get") or "setup" in t for t in preview)


async def test_every_read_a_house_registers_is_a_screens_or_not_a_previews(mantel):
    """SRV-2: a new read is closed to previews until it is placed on one of the two lists."""
    from mantel_server import readproxy
    from mantel_server.connectors import read_routes
    from mantel_server.socket_reads import READS_BY_TYPE
    every = set(read_routes(mantel.app)) | set(readproxy.READ_ALLOWED) | set(readproxy.MANTEL_READS)
    assert not every - set(READS_BY_TYPE), sorted(every - set(READS_BY_TYPE))


async def test_the_consent_page_cannot_be_framed_and_says_where_it_returns(mantel):
    house(mantel)
    await owner(mantel)
    await turn_on(mantel)
    reg = await mantel.client.post("/mcp/oauth/register", json={"client_name": "<b>Claude</b> Code",
                                                                "redirect_uris": ["https://app.example/cb"]})
    body = await reg.json()
    assert "<" not in body["client_name"]
    r = await mantel.client.get("/mcp/oauth/authorize", params={
        "response_type": "code", "client_id": body["client_id"], "code_challenge": "A" * 43,
        "code_challenge_method": "S256"})
    page = await r.text()
    assert "frame-ancestors 'none'" in r.headers["Content-Security-Policy"] and r.headers["X-Frame-Options"] == "DENY"
    assert "app.example" in page


async def test_a_deeply_nested_body_is_a_parse_error(mantel):
    token, _ = await setup(mantel)
    r = await Rpc(mantel, token).raw("x")
    deep = "[" * 100000 + "]" * 100000
    r = await Rpc(mantel, token).m.client.post("/mcp", data=deep, headers={"Authorization": f"Bearer {token}",
                                                                            "Content-Type": "application/json"})
    assert r.status in (400, 403)


async def test_an_applied_change_is_audited_first_as_the_assistants(mantel):
    token, _ = await setup(mantel)
    rpc = Rpc(mantel, token)
    plan, _ = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": "open"})
    assert not audits(mantel, "mcp.settings_change"), "a plan writes no row"
    await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": "open"},
                   dry_run=False, plan=plan["plan"])
    [row] = audits(mantel, "mcp.settings_change")
    assert row["via"] == "mcp:Claude Code" and json.loads(row["target"])["documents"] == ["board/dashboard-kitchen"]

    def broken(event):
        raise RuntimeError("disk full")
    mantel.app["audit"].config_event = broken
    plan, _ = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": "tab"})
    got, err = await rpc.tool("settings_change", scope="board", key="dashboard-kitchen", changes={"menu": "tab"},
                              dry_run=False, plan=plan["plan"])
    assert err and got["error"] == "audit_unavailable"
    assert mantel.app["settings"].store.body("board", "dashboard-kitchen")["menu"] == "open", "no row, no change"
