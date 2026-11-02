"""How Home Assistant finds Mantel (docs/phase9/MANTEL-LINK.md 9.5): the HA App's announcement to the Supervisor
(a rotated `linked` credential, the App's own address on HA's App network; against a fake Supervisor), the
zeroconf announcement file and its avahi form (announce.py), the entrypoint's flags in each mode, and the
packaging rules (hassio_api only with discovery; the host network for the opt-in announcer alone)."""
import json

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from mantel_server import announce, supervisor_discovery as SD
from test_features import make_env  # noqa: F401
from test_packaging import entrypoint

SUP = "fictional-supervisor-credential"


class FakeSupervisor:
    def __init__(self):
        self.posts, self.deletes, self.auth = [], [], []
        self.n = 0
        self.post_status = 200          # 2026-11-01: what /discovery answers (500: the Supervisor is unwell)
        self.drop_post = False          # ... or the connection drops mid-post
        self.events: list[str] = []     # "post" / "delete" in the order the Supervisor saw them

    async def info(self, request):
        self.auth.append(request.headers.get("Authorization"))
        return web.json_response({"result": "ok", "data": {"hostname": "local-mantel", "slug": "local_mantel"}})

    async def post(self, request):
        self.auth.append(request.headers.get("Authorization"))
        self.posts.append(await request.json())
        self.events.append("post")
        if self.drop_post:
            request.transport.close()
            return web.Response()
        if self.post_status != 200:
            return web.json_response({"result": "error"}, status=self.post_status)
        self.n += 1
        return web.json_response({"result": "ok", "data": {"uuid": f"uuid-{self.n}"}})

    async def delete(self, request):
        self.deletes.append(request.match_info["uuid"])
        self.events.append("delete")
        return web.json_response({"result": "ok"})

    async def start(self):
        app = web.Application()
        app.router.add_get("/addons/self/info", self.info)
        app.router.add_post("/discovery", self.post)
        app.router.add_delete("/discovery/{uuid}", self.delete)
        self.server = TestServer(app, host="127.0.0.1")
        await self.server.start_server()
        return f"http://127.0.0.1:{self.server.port}"


async def test_the_app_announces_mantel_with_a_rotated_credential(make_env, tmp_path):
    env = await make_env()
    sup = FakeSupervisor()
    url = await sup.start()
    try:
        token_file = tmp_path / "ha_token"
        token_file.write_text(SUP + "\n")
        cfg = env.app["cfg"]
        object.__setattr__(cfg, "supervisor_url", url)
        object.__setattr__(cfg, "token_file", token_file)
        object.__setattr__(cfg, "port", 8099)
        first = await SD.announce(env.app)
        accounts = env.app["service_accounts"]
        body = sup.posts[-1]
        assert body["service"] == "mantel" and body["config"]["url"] == "http://local-mantel:8099"
        assert body["config"]["instance"] == env.app["linked"].instance
        tok1 = body["config"]["token"]
        acct = accounts.verify(tok1, "linked")
        assert acct is not None and acct.name == SD.ACCOUNT_NAME and acct.scopes == frozenset({"linked"})
        assert all(a == f"Bearer {SUP}" for a in sup.auth), "the App's own Supervisor credential"
        assert first == {"url": "http://local-mantel:8099", "instance": body["config"]["instance"],
                         "account": acct.id, "uuid": "uuid-1"}
        remembered = env.app["linked_owners"].remembered(SD.KEY)
        assert remembered["account"] == acct.id and tok1 not in json.dumps(remembered), "never the credential"
        # the next start: the old announcement withdrawn, the old credential revoked, a new one announced
        await SD.announce(env.app)
        tok2 = sup.posts[-1]["config"]["token"]
        assert tok2 != tok1 and sup.deletes == ["uuid-1"]
        assert accounts.verify(tok1, "linked") is None and accounts.verify(tok2, "linked") is not None
        rows = [r for r in env.audit(kind="config") if r["action"] == "linked.app_discovery"]
        assert len(rows) == 2 and tok1 not in repr(rows) and tok2 not in repr(rows)
        # Mantel's own rotated credential doesn't pile up under Service Accounts: one is listed, the live one
        assert [a["name"] for a in accounts.list()] == [SD.ACCOUNT_NAME] and accounts.list()[0]["made_by"] == "app"
        # Mantel Link set up by hand (a pairing code): nothing to discover, so the App withdraws and stands down
        own, _ = accounts.create("Home Assistant - Mantel Link", ["linked"], by="pairing:u1")
        from mantel_server.linked import LINK_ACCOUNT_KEY
        env.app["linked_owners"].remember(LINK_ACCOUNT_KEY, {"account": own.id})
        assert await SD.announce(env.app) is None
        assert sup.deletes == ["uuid-1", "uuid-2"] and len(sup.posts) == 2
        assert accounts.verify(tok2, "linked") is None
        assert [(a["name"], a["made_by"]) for a in accounts.list()] == [("Home Assistant - Mantel Link", "pairing")]
        # ... and the App's own address is still Mantel's, so Mantel Link can pair again by a code at it (v2)
        assert env.app[SD.APP_URL] == "http://local-mantel:8099"
        from mantel_server.linked_pairing import request_addresses
        from aiohttp.test_utils import make_mocked_request
        req = make_mocked_request("POST", "/linked/pair", headers={"Host": "local-mantel:8099"}, app=env.app)
        assert "http://local-mantel:8099" in request_addresses(req)
    finally:
        await sup.server.close()


async def _announced_once(make_env, tmp_path):
    env = await make_env()
    sup = FakeSupervisor()
    url = await sup.start()
    token_file = tmp_path / "ha_token"
    token_file.write_text(SUP + "\n")
    cfg = env.app["cfg"]
    object.__setattr__(cfg, "supervisor_url", url)
    object.__setattr__(cfg, "token_file", token_file)
    object.__setattr__(cfg, "port", 8099)
    await SD.announce(env.app)
    return env, sup, sup.posts[-1]["config"]["token"]


def _live(accounts):
    return [a for a in accounts.list() if a["revoked"] is None]


async def test_a_rotation_makes_and_posts_the_new_credential_before_it_takes_the_old_one_away(make_env, tmp_path):
    """2026-11-01 (audit 3, LINK-1): the old announcement and account went first, so a Supervisor that said no
    left Mantel Link on a dead credential (a 401 loop). The new one is posted and remembered first."""
    env, sup, tok1 = await _announced_once(make_env, tmp_path)
    try:
        sup.events.clear()
        await SD.announce(env.app)
        assert sup.events == ["post", "delete"], "the new announcement goes up before the old one comes down"
        tok2 = sup.posts[-1]["config"]["token"]
        accounts = env.app["service_accounts"]
        assert accounts.verify(tok1, "linked") is None and accounts.verify(tok2, "linked") is not None
        assert env.app["linked_owners"].remembered(SD.KEY)["uuid"] == "uuid-2"
    finally:
        await sup.server.close()


async def test_a_supervisor_that_refuses_the_new_announcement_leaves_the_old_credential_alone(make_env, tmp_path):
    env, sup, tok1 = await _announced_once(make_env, tmp_path)
    try:
        accounts, owners = env.app["service_accounts"], env.app["linked_owners"]
        before = dict(owners.remembered(SD.KEY))
        sup.post_status = 500
        sup.deletes.clear()
        assert await SD.announce(env.app) is None
        assert sup.deletes == [], "the announcement Home Assistant holds is not withdrawn"
        assert accounts.verify(tok1, "linked") is not None, "Mantel Link's credential still works"
        assert owners.remembered(SD.KEY) == before
        assert len(_live(accounts)) == 1, "the credential made for the refused announcement is revoked"
    finally:
        await sup.server.close()


async def test_a_dropped_connection_mid_post_leaves_no_unrecorded_account_and_the_old_credential_alone(make_env, tmp_path):
    env, sup, tok1 = await _announced_once(make_env, tmp_path)
    try:
        accounts, owners = env.app["service_accounts"], env.app["linked_owners"]
        before = dict(owners.remembered(SD.KEY))
        sup.drop_post = True
        sup.deletes.clear()
        assert await SD.announce(env.app) is None
        assert sup.deletes == []
        assert accounts.verify(tok1, "linked") is not None
        assert owners.remembered(SD.KEY) == before
        live = _live(accounts)
        assert [a["id"] for a in live] == [before["account"]], "the new account is not left live and unrecorded"
    finally:
        await sup.server.close()


async def test_no_supervisor_no_announcement(make_env, tmp_path):
    env = await make_env()
    assert await SD.announce(env.app) is None                    # not the App
    cfg = env.app["cfg"]
    object.__setattr__(cfg, "supervisor_url", "http://127.0.0.1:9")   # nothing listens there
    object.__setattr__(cfg, "token_file", tmp_path / "missing")
    assert await SD.announce(env.app) is None
    (tmp_path / "missing").write_text(SUP)
    assert await SD.announce(env.app) is None, "a Supervisor that can't be reached only logs"
    assert env.app["service_accounts"].list() == [] or all(a.revoked for a in env.app["service_accounts"].list())


def test_the_zeroconf_announcement_file_and_its_avahi_form(tmp_path):
    path = tmp_path / "announce.json"
    body = announce.write(path, "0123456789abcdef0123456789abcdef", "https://mantel.example.com:8443/")
    assert body == {"instance": "0123456789abcdef0123456789abcdef", "url": "https://mantel.example.com:8443",
                    "version": ""}
    assert announce.read(path) == body and "token" not in path.read_text()
    with pytest.raises(ValueError):
        announce.write(path, "x" * 32, "http://mantel.example.com/")       # https only
    xml = announce.avahi_service(body)
    assert "<type>_mantel._tcp</type>" in xml and "<port>8443</port>" in xml
    assert "instance=0123456789abcdef0123456789abcdef" in xml and "url=https://mantel.example.com:8443" in xml
    assert announce.main(["--check", "--file", str(path)]) == 0
    assert announce.main(["--check", "--file", str(tmp_path / "none.json")]) == 1


def test_the_announcement_carries_mantel_s_link_address_when_it_has_one(tmp_path):
    """Mantel Connect's listener runs: Home Assistant can link at Mantel's address, pinning Mantel's own certificate
    (linked_pairing v3), so the announcement says where. Not an https address with a port: left out."""
    path = tmp_path / "announce.json"
    body = announce.write(path, "0" * 32, "https://mantel.example.com", link="https://192.0.2.10:8766")
    assert body["link"] == "https://192.0.2.10:8766" and announce.read(path) == body
    assert "link=https://192.0.2.10:8766" in announce.avahi_service(body)
    for bad in ("", "http://192.0.2.10:8766", "https://192.0.2.10", "nonsense"):
        assert "link" not in announce.write(path, "0" * 32, "https://mantel.example.com", link=bad), bad


def test_the_entrypoint_turns_discovery_on_in_each_mode(tmp_path):
    env = {"MANTEL_PUBLIC_URL": "https://mantel.example.com/"}
    args, _ = entrypoint.plan([], env, options_path=tmp_path / "none")
    assert args[args.index("--announce-file") + 1] == "/data/announce.json" and "--supervisor-url" not in args
    args, _ = entrypoint.plan([], {**env, "MANTEL_ANNOUNCE": "0"}, options_path=tmp_path / "none")
    assert "--announce-file" not in args
    from mantel_server.config import parse_args
    options = tmp_path / "options.json"
    options.write_text("{}")
    args, _ = entrypoint.plan([], {"SUPERVISOR_TOKEN": SUP}, options_path=options, token_file=tmp_path / "t")
    assert args[args.index("--supervisor-url") + 1] == "http://supervisor" and "--announce-file" not in args
    cfg = parse_args(args)
    assert cfg.supervisor_url == "http://supervisor" and cfg.announce_file is None


def test_hassio_api_only_with_discovery_and_the_host_network_for_the_announcer_alone(tmp_path):
    import importlib.util
    from pathlib import Path
    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location("pc", root / "tools/package_check.py")
    pc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pc)
    app = (root / "packaging/ha-app/config.yaml").read_text()
    assert pc.check_ha_app(root / "packaging/ha-app/config.yaml") == []
    bare = tmp_path / "config.yaml"
    bare.write_text(app.replace("discovery:\n  - mantel\n", ""))
    assert any("hassio_api is only for Mantel Link" in p for p in pc.check_ha_app(bare))
    over = (root / "packaging/compose/compose.announce.yaml").read_text()
    assert [p for p in pc.check_compose(root / "packaging/compose/compose.announce.yaml")
            if p.startswith("compose service ")] == []
    for bad in (over.replace("mantel-data:/data:ro", "mantel-data:/data"),
                over.replace('user: "10001:10001"', 'user: "0:0"')):
        f = tmp_path / "compose.announce.yaml"
        f.write_text(bad)
        assert any("shares a host namespace" in p for p in pc.check_compose(f))
    elsewhere = tmp_path / "compose.yaml"
    elsewhere.write_text(over)
    assert any("shares a host namespace" in p for p in pc.check_compose(elsewhere)), "only the opt-in overlay"
