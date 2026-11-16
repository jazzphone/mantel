"""HelperPod's pairing code on Mantel's Connections screen (connections.py kind ``homepod``): the 6-digit code HelperPod
shows, typed where the token goes. Test only checks it (it stays good); Save trades it for HelperPod's token, kept sealed as
any token is. Each refusal says what to do. A fake HelperPod on this machine; the fictional house only."""
from aiohttp import web
from aiohttp.test_utils import TestServer

from mantel_server import connections as C
from test_connections import envs, owner  # noqa: F401 -- the fixture

TOKEN = "helperpod-token-0123456789abcdef"


class FakeHelperPod:
    """HelperPod 2.2.1's /status.json, /check and /pair (pair.swift). ``old``: 2.2.0, where /pair is an ordinary POST
    that wants the token."""

    def __init__(self) -> None:
        self.code: str | None = "482913"
        self.misses = 0
        self.locked = False
        self.old = False
        self.pairs: list[dict] = []
        self.server: TestServer | None = None

    async def start(self) -> str:
        app = web.Application()

        async def status(_r):
            return web.json_response({"homepods": [{"tile": "Kitchen-HomePod-TileCell"}], "broken": False})

        async def check(r):
            ok = r.headers.get("Authorization") == f"Bearer {TOKEN}"
            return web.json_response({"ok": ok}, status=404 if ok else 401)

        async def pair(r):
            body = await r.json()
            self.pairs.append(body)
            if self.old:
                return web.json_response({"ok": False, "error": "token"}, status=401)
            if self.locked:
                return web.json_response({"ok": False, "error": "locked", "retry_s": 42}, status=429)
            if self.code is None:
                return web.json_response({"ok": False, "error": "no_code"}, status=401)
            if body.get("code") != self.code:
                return web.json_response({"ok": False, "error": "code"}, status=401)
            if body.get("check"):
                return web.json_response({"ok": True})
            self.code = None
            return web.json_response({"ok": True, "token": TOKEN})
        app.router.add_get("/status.json", status)
        app.router.add_post("/check", check)
        app.router.add_post("/pair", pair)
        self.server = TestServer(app)
        await self.server.start_server()
        return str(self.server.make_url("")).rstrip("/")

    async def close(self) -> None:
        await self.server.close()


async def fake(envs):  # noqa: F811
    hp = FakeHelperPod()
    url = await hp.start()
    envs.fakes.append(hp)
    return hp, url


def test_a_code_is_six_digits_as_people_type_them():
    assert C.pairing_code("482913") == C.pairing_code(" 482 913 ") == C.pairing_code("482-913") == "482913"
    assert C.pairing_code("48291") is None and C.pairing_code("4829134") is None and C.pairing_code(TOKEN) is None
    assert C.pairing_code(None) is None and C.LABEL["homepod"] == "HelperPod"


async def test_test_checks_the_code_and_save_trades_it_for_the_token(envs):  # noqa: F811
    env = await envs()
    await owner(env)
    hp, url = await fake(envs)
    status, body = await env.call("POST", "/api/connections/homepod/test", {"url": url, "token": "482 913"})
    assert status == 200 and body["method"] == "pairing" and body["result"]["homepods"] == 1
    assert hp.code == "482913" and hp.pairs[-1] == {"code": "482913", "name": "Mantel", "check": True}   # still good
    status, body = await env.call("POST", "/api/connections/homepod", {"url": url, "token": "482-913"})
    assert status == 200 and body["connection"]["saved"]["method"] == "pairing" and hp.code is None
    assert TOKEN not in str(body)
    rec = env.app["connections"].current("homepod")
    assert rec.token == TOKEN and rec.url == url


async def test_each_refusal_says_what_to_do(envs):  # noqa: F811
    env = await envs()
    await owner(env)
    hp, url = await fake(envs)

    async def code_error(code="111111"):
        status, body = await env.call("POST", "/api/connections/homepod", {"url": url, "token": code})
        assert status != 200
        return body["error"] if isinstance(body.get("error"), str) else body["error"]["code"]
    assert await code_error() == "code_rejected"
    hp.code = None
    assert await code_error() == "code_expired"
    hp.locked = True
    assert await code_error() == "code_locked"
    hp.locked, hp.old = False, True
    assert await code_error() == "pairing_unsupported"
    assert env.app["connections"].current("homepod") is None


async def test_a_pasted_token_still_works(envs):  # noqa: F811
    env = await envs()
    await owner(env)
    hp, url = await fake(envs)
    status, body = await env.call("POST", "/api/connections/homepod", {"url": url, "token": TOKEN})
    assert status == 200 and body["connection"]["saved"]["method"] == "token" and hp.pairs == []
