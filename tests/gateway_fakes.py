"""Shared pieces for the P3.3 gateway / P3.7 wiring tests: a full Mantel app on a temp database with a
fictional house, commands on or off, and a fake command connection that checks every frame and ticket
exactly as ha_client.HaCommander does but sends nothing anywhere."""
import asyncio
import base64

import pytest
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher

from conftest import Mantel
from mantel_server.identity.accounts import totp
from mantel_server.ha.ha_client import SERVER_WRITES, check_command, check_http, check_upload

HOUSE_AREAS = [{"area_id": "kitchen", "name": "Kitchen"}, {"area_id": "cody_room", "name": "Cody's Room"},
               {"area_id": "porch", "name": "Porch"}]
HOUSE_ENTITIES = [
    {"entity_id": "light.kitchen", "area_id": "kitchen"},
    {"entity_id": "lock.front_door", "area_id": "porch"},
    {"entity_id": "lock.kitchen_door", "area_id": "kitchen"},
    {"entity_id": "light.cody", "area_id": "cody_room"},
    {"entity_id": "camera.doorbell", "area_id": "porch"},
    {"entity_id": "alarm_control_panel.house", "area_id": "porch"},
    {"entity_id": "person.jamie"},
]
STATES = {
    "light.kitchen": {"s": "off", "a": {"friendly_name": "Kitchen"}, "lc": 1.0, "lu": 1.0},
    "lock.front_door": {"s": "locked", "a": {"friendly_name": "Front door"}, "lc": 1.0, "lu": 1.0},
    "lock.kitchen_door": {"s": "locked", "a": {"friendly_name": "Kitchen door"}, "lc": 1.0, "lu": 1.0},
    "light.cody": {"s": "off", "a": {"friendly_name": "Cody"}, "lc": 1.0, "lu": 1.0},
    "camera.doorbell": {"s": "idle", "a": {"friendly_name": "Doorbell"}, "lc": 1.0, "lu": 1.0},
    "alarm_control_panel.house": {"s": "armed_away", "a": {}, "lc": 1.0, "lu": 1.0},
    "person.jamie": {"s": "home", "a": {"latitude": 1.0, "longitude": 2.0}, "lc": 1.0, "lu": 1.0},
}


class FakeCommander:
    """Records what would have been sent; checks frames and tickets like HaCommander."""

    def __init__(self, writes):
        self.writes = frozenset(writes) | SERVER_WRITES      # (as server.py gives the real one)
        self.sent: list[str] = []
        self.frames: list[dict] = []
        self.uploads: list[tuple] = []
        self.fail: Exception | None = None

    async def call(self, frame, ticket):
        check_command(frame, ticket, self.writes)
        self.frames.append(frame)
        self.sent.append(f"{frame['domain']}.{frame['service']}" if frame["type"] == "call_service" else frame["type"])
        if self.fail is not None:
            raise self.fail
        return {"context": {"id": "fictional"}, "response": None}

    async def http(self, method, path, body, ticket):
        check_http(method, path, ticket)
        self.sent.append(f"{method} {path.split('?', 1)[0]}")
        return {"ok": True}

    async def upload(self, path, content_type, body, ticket):
        check_upload("POST", path, content_type, body, ticket)
        self.sent.append(f"POST {path.split('?', 1)[0]}")
        self.uploads.append((path, content_type, body, ticket.audit_id))
        return {"ok": True, "bytes": len(body)}

    async def close(self):
        pass


def seed_of(secret_b32: str) -> bytes:
    return base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8))


async def make(tmp_path, monkeypatch, *, commands: bool, trusted=()):
    from mantel_server.config import Config
    from mantel_server.ha.ha_client import HaClient
    from mantel_server.ha.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.storage.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("gateway tests attempted upstream access")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(HaClient, "_send", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, commands_enabled=commands,
                 trusted_proxies=tuple(trusted))
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: now[0])
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    hub = app["hub"]
    hub.registry.load(HOUSE_AREAS, [], HOUSE_ENTITIES)
    hub.store.apply_event({"a": {k: dict(v) for k, v in STATES.items()}})
    fake = None
    if commands:
        fake = FakeCommander(app["gateway"].writes)
        app["gateway"].commander = fake
    return app, store, now, fake


class Env:
    def __init__(self, mantel: Mantel, fake):
        self.m, self.fake = mantel, fake
        self.app, self.now = mantel.app, mantel.now

    def audit(self, **where):
        return self.app["audit"].rows(**where)

    async def login(self, username, role, *, tunnel=False):
        self.m.forget_cookies()
        if self.app["accounts"].db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone() is None:
            await self.m.user(username, role)
        r, body = await self.m.sign_in(username, tunnel=tunnel)
        assert r.status == 200, body
        return body

    async def enroll_totp(self):
        r = await self.m.post("/api/auth/totp/enroll")
        seed = seed_of((await r.json())["secret"])
        r = await self.m.post("/api/auth/totp/enroll/confirm", {"code": totp(seed, self.now[0])})
        assert r.status == 200
        return seed

    async def socket(self, *, tunnel=False, expect_caps=True):
        ws = await self.m.client.ws_connect("/ws", headers={"X-Mantel-Door": "tunnel"} if tunnel else None)
        if expect_caps:
            caps = await recv(ws)
            assert caps["type"] == "capabilities" and caps["commands"] is True
        return ws

    async def command(self, ws, **body):
        rid = body.pop("id", 1)
        await ws.send_json({"type": "command", "id": rid, **body})
        while True:
            reply = await recv(ws)
            if reply.get("id") == rid:
                return reply


async def recv(ws, timeout=3):
    return await asyncio.wait_for(ws.receive_json(), timeout)


def service(domain, svc, entity=None, **extra):
    body = {"kind": "service", "domain": domain, "service": svc, **extra}
    if entity:
        body["target"] = {"entity_id": entity}
    return body


@pytest.fixture
async def gw(tmp_path, monkeypatch):
    app, store, now, fake = await make(tmp_path, monkeypatch, commands=True)
    async with TestClient(TestServer(app)) as client:
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin
        yield Env(Mantel(app, client, store, now, origin), fake)
    store.db.close()


@pytest.fixture
async def off(tmp_path, monkeypatch):
    app, store, now, fake = await make(tmp_path, monkeypatch, commands=False)
    async with TestClient(TestServer(app)) as client:
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin
        yield Env(Mantel(app, client, store, now, origin), fake)
    store.db.close()
