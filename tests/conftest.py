"""Shared fixture for the P3.1 account tests: a full Mantel app on a temp database and secrets folder,
fictional users, a fake clock, cheap Argon2 parameters, and every upstream HA path poisoned."""
from dataclasses import dataclass

import pytest
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

PASSWORD = "correct horse battery staple"


@dataclass
class Mantel:
    app: object
    client: TestClient
    store: object
    now: list
    origin: str

    def cookie(self, name):
        jar = self.client.session.cookie_jar.filter_cookies(self.client.make_url("/"))
        return jar[name].value if name in jar else None

    def headers(self, csrf=True, tunnel=False, **extra):
        h = dict(extra)
        if csrf and self.cookie("mantel_csrf"):
            h["X-CSRF-Token"] = self.cookie("mantel_csrf")
        if tunnel:
            h["X-Mantel-Door"] = "tunnel"
        return h

    async def post(self, path, body=None, *, csrf=True, tunnel=False, headers=None):
        return await self.client.post(path, json={} if body is None else body,
                                      headers=self.headers(csrf, tunnel, **(headers or {})))

    async def get(self, path, *, tunnel=False):
        return await self.client.get(path, headers=self.headers(False, tunnel))

    async def user(self, username, role, password=PASSWORD, name=None):
        return await self.app["accounts"].create_user(username, name or username.title(), role, password)

    async def sign_in(self, username, password=PASSWORD, tunnel=False):
        r = await self.post("/api/auth/password", {"username": username, "password": password}, csrf=False, tunnel=tunnel)
        return r, await r.json()

    def set_cookies(self, **cookies):
        """Replace cookies as the server would have set them (same host), not as extra shared ones."""
        self.client.session.cookie_jar.update_cookies(cookies, response_url=self.client.make_url("/"))

    def forget_cookies(self):
        self.client.session.cookie_jar.clear()


@pytest.fixture
async def mantel(tmp_path, monkeypatch):
    from mantel_server.config import Config
    from mantel_server.ha_client import HaClient
    from mantel_server.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("account tests attempted upstream access")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(HaClient, "_send", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0)
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: now[0])
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    async with TestClient(TestServer(app)) as client:
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin
        yield Mantel(app, client, store, now, origin)
    store.db.close()
