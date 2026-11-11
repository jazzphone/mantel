"""Shared pieces for the Intercom's server tests (tests/test_intercom_relay.py, tests/test_intercom_api.py): a full
Mantel app on a temp database with the music house of tests/music_fakes.py, a fake Music Assistant that answers
``players/cmd/play_announcement`` the way the real one does (it GETs the link from Mantel's real stream listener,
and answers when it has "played" the clip), the Intercom turned on with its stream listener on a free loopback port,
and a few independent signed-in clients (``Actor``: a person or a wall tablet with a cookie jar of its own, so a test
can have the Owner, a Child and a tablet open at once). Fictional rooms only; nothing real is contacted and no sound
is ever made (Rules: a test never plays on a speaker).

THE ONE SHORTCUT: ``hk_core.intercom.config.base_problem`` refuses a loopback address as the address Music Assistant
fetches from (a real house uses a private one), and the document is checked on every read. The fixture patches that one
function to accept ``http://127.0.0.1:<port>`` so the real listener can serve the real fake MA on this machine; every
other address still goes through the real check (and a test may put the real one back).
"""
from __future__ import annotations

import asyncio
import json
import socket
from typing import Any, Callable

import aiohttp
import pytest
from aiohttp import WSMsgType
from aiohttp.test_utils import TestClient, TestServer
from argon2 import PasswordHasher
from yarl import URL

import gateway_fakes as GF
import music_fakes as MF
from conftest import PASSWORD, Mantel
from connector_fakes import MA_TOKEN, wait_for
from hk_core.intercom import config as C
from mantel_server.settings_store import Actor as SettingsActor

REAL_BASE_PROBLEM = C.base_problem          # captured before any fixture patches it (a test may ask the real rule)
KITCHEN, DEN, CODY = "media_player.kitchen_ma", "media_player.den_ma", "media_player.cody_ma"
ANNOUNCE = "players/cmd/play_announcement"
JOIN = "players/cmd/group_many"
PART = "players/cmd/set_members"
RATE = 24000
FRAME_MS = 40


# ------------------------------------------------------------------------------------------ the fake MA
class IntercomMa(MF.HouseMa):
    """The music house's fake Music Assistant plus ``players/cmd/play_announcement``: each call is recorded, the link
    is fetched ONCE per URL from Mantel's listener (a real MA renders one clip for every room that announces the same
    URL), and the call answers after ``delay`` seconds, as the real one answers when the clip has played. ``item_by_uri``
    with an http URL (Check Reach) fetches it too, unless ``item_fetch`` is off."""

    def __init__(self) -> None:
        super().__init__()
        self.announcements: list[dict] = []          # the args of every play_announcement received
        self.fetches: list[dict] = []                # {url, status, headers, body} per fetch
        self.item_calls: list[dict] = []             # item_by_uri calls with a URL
        self.fetch = True                            # play_announcement GETs its url
        self.item_fetch = True                       # item_by_uri GETs its uri
        self.delay = 0.0                             # seconds before an announcement answers
        self.fail: dict[str, str] = {}               # Music Assistant player id -> error details
        self.on_call: Callable[[dict], None] | None = None     # called when an announcement frame arrives
        self.groups = False                          # answer group_many/set_members as a real group (in_step)
        self.join_script = "ok"                      # ok, never (settles never), error, extra (someone else is in it)
        self.plays = True                            # (with groups) an announced player reads "playing" while it plays
        self.part_script = "ok"                      # ok, never
        self._gets: dict[str, asyncio.Future] = {}
        self._session: aiohttp.ClientSession | None = None
        self._tasks: set[asyncio.Task] = set()

    def app(self):
        app = super().app()
        app.on_cleanup.append(self._cleanup)
        return app

    async def _cleanup(self, _app) -> None:
        for t in list(self._tasks):
            t.cancel()
        if self._session is not None:
            await self._session.close()

    def announced(self) -> list[dict]:
        """The play_announcement frames Mantel sent (what Music Assistant was told)."""
        return [f for f in self.frames if f.get("command") == ANNOUNCE]

    async def get(self, url: str) -> dict:
        """One GET of ``url`` as Music Assistant does it, shared by every caller of the same URL."""
        fut = self._gets.get(url)
        if fut is None:
            fut = self._gets[url] = asyncio.get_running_loop().create_future()
            try:
                if self._session is None:
                    self._session = aiohttp.ClientSession()
                async with self._session.get(url) as r:
                    got = {"url": url, "status": r.status, "headers": dict(r.headers), "body": await r.read()}
            except Exception as exc:  # noqa: BLE001 -- the fake reports what happened
                got = {"url": url, "status": None, "headers": {}, "body": b"", "error": type(exc).__name__}
            self.fetches.append(got)
            fut.set_result(got)
        return await fut

    async def answer(self, ws, mid, cmd, args) -> None:
        async def reply(result=None, *, error: str | None = None) -> None:
            try:
                if error is None:
                    await ws.send_json({"message_id": mid, "result": result, "partial": False})
                else:
                    await ws.send_json({"message_id": mid, "error_code": 99, "details": error})
            except Exception:  # noqa: BLE001 -- Mantel hung up (a timeout): nothing to tell
                pass

        if cmd == JOIN and self.groups:
            if self.join_script == "error":
                return await reply(error="can not group")
            if self.join_script != "never":
                lead, kids = args["target_player"], list(args["child_player_ids"])
                others = [p for p in self.model if p not in (lead, *kids) and self.model[p].get("type") == "player"]
                members = [lead, *kids, *(others[:1] if self.join_script == "extra" else [])]
                self.model[lead]["group_members"] = members      # at once; the members' synced_to lags (driver._together)
                self.model[lead]["group_childs"] = list(members)    # Music Assistant lists it here too
                if self.join_script == "extra":
                    self.model[members[-1]]["synced_to"] = lead
            return await reply(None)
        if cmd == PART and self.groups:
            if self.part_script != "never":
                lead = self.model[args["target_player"]]
                for m in args["player_ids_to_remove"]:
                    self.model[m]["synced_to"] = None
                    lead["group_members"] = [x for x in lead["group_members"] if x != m]
                    lead["group_childs"] = list(lead["group_members"])
                if len(lead["group_members"]) <= 1:
                    lead["group_members"] = []
                    lead["group_childs"] = []
            return await reply(None)
        if cmd == ANNOUNCE:
            self.announcements.append(dict(args))
            if self.on_call is not None:
                self.on_call(dict(args))

            async def work() -> None:
                if self.fetch:
                    await self.get(args["url"])
                playing = self.groups and self.plays and args.get("player_id") in self.model
                if playing:
                    self.model[args["player_id"]]["playback_state"] = "playing"
                if self.delay:
                    await asyncio.sleep(self.delay)
                if playing:
                    self.model[args["player_id"]]["playback_state"] = "idle"
                err = self.fail.get(args.get("player_id"))
                await reply(error=err) if err else await reply(None)
            task = asyncio.get_running_loop().create_task(work())
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
            return
        if cmd == "music/item_by_uri" and str(args.get("uri", "")).startswith("http"):
            self.item_calls.append(dict(args))
            if self.item_fetch:
                await self.get(args["uri"])
            return await reply({"item_id": "x", "provider": "builtin", "media_type": "track", "uri": args["uri"],
                                "name": "link"})
        return await super().answer(ws, mid, cmd, args)


# ------------------------------------------------------------------------------------------ the house
def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def intercom_doc(base: str, **over: Any) -> dict:
    """The Intercom ON, the music house's three rooms enabled (the Kitchen's volume 40, the Cody's Room's 90 which the
    house cap of 70 lowers), quiet hours off so the time of day decides nothing."""
    rooms = {KITCHEN: {"enabled": True, "live": True, "volume": 40, "quiet": None, "listeners": []},
             DEN: {"enabled": True, "live": True, "volume": None, "quiet": None, "listeners": []},
             CODY: {"enabled": True, "live": True, "volume": 90, "quiet": None, "listeners": []}}
    doc = {"enabled": True, "live_allowed": False, "default_mode": "message", "max_live_s": 60, "max_message_s": 30,
           "chime": {"message": True, "live": False}, "stream_base": base, "lag_ms": None, "max_volume": 70,
           "quiet_default": {"schedule": False, "from": "21:00", "to": "07:00", "while": []}, "rooms": rooms}
    doc.update(over)
    return doc


async def build(tmp_path, monkeypatch, *, commands: bool, enabled: bool = True):
    from mantel_server.config import Config
    from mantel_server.ha.ha_client import HaClient
    from mantel_server.ha.readproxy import ReadProxy
    from mantel_server.server import build_app
    from mantel_server.storage.store import Store

    async def forbidden(*args, **kwargs):
        pytest.fail("intercom tests attempted to reach Home Assistant")

    monkeypatch.setattr(HaClient, "run", forbidden)
    monkeypatch.setattr(HaClient, "_send", forbidden)
    monkeypatch.setattr(ReadProxy, "request", forbidden)
    real_problem = REAL_BASE_PROBLEM

    def base_problem(url):
        if isinstance(url, str) and url.strip().rstrip("/").startswith("http://127.0.0.1:"):
            return None                # the one shortcut (module notes): this machine stands in for the house's LAN
        return real_problem(url)
    monkeypatch.setattr(C, "base_problem", base_problem)
    fake = IntercomMa()
    server = TestServer(fake.app())
    await server.start_server()
    token = tmp_path / "secrets" / "ma_token"
    token.parent.mkdir(parents=True, exist_ok=True)
    token.write_text(MA_TOKEN)
    port = free_port()
    cfg = Config(data_dir=tmp_path / "data", secrets_dir=tmp_path / "secrets", port=0, commands_enabled=commands,
                 ma_url=str(server.make_url("/ws")), ma_token_file=token, stream_port=port)
    store = Store(cfg.data_dir / "mantel.db")
    now = [1_000_000.0]
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: now[0])
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    hub = app["hub"]
    hub.registry.load(MF.AREAS, [], MF.ENTITIES, MF.FLOORS)
    hub.store.apply_event({"a": MF.states()})
    fake.hub = hub
    app["intercom"].bind = "127.0.0.1"
    from mantel_server import music as M
    app["settings"].store.write([("house", M.MUSIC_DOC, json.loads(json.dumps(MF.DOC)))],
                                actor=SettingsActor(label="test"))
    commander = None
    if commands:
        commander = GF.FakeCommander(app["gateway"].writes)
        app["gateway"].commander = commander
    return app, store, now, commander, fake, server, port


class Env(GF.Env):
    def __init__(self, mantel: Mantel, commander, fake: IntercomMa, port: int):
        super().__init__(mantel, commander)
        self.ma, self.port = fake, port
        self.base = f"http://127.0.0.1:{port}"
        self.host = mantel.app["intercom"]
        self.relay = self.host.relay
        self.hub = mantel.app["hub"]
        self.actors: list[Actor] = []

    # -- the settings document ----------------------------------------------------------------------------
    def doc(self) -> dict:
        return self.host.doc()

    async def configure(self, **over: Any) -> dict:
        """Write the Intercom's document (the fixture's, with ``over``) straight into the store and let the host
        start or stop its listener to match."""
        doc = intercom_doc(self.base, **over)
        self.app["settings"].store.write([("house", "intercom", doc)], actor=SettingsActor(label="test"))
        await self.host.apply()
        return doc

    def edit(self, **over: Any) -> None:
        """Change fields of the stored document (checked), without touching the listener."""
        doc = {**self.host.doc(), **over}
        self.app["settings"].store.write([("house", "intercom", doc)], actor=SettingsActor(label="test"))

    async def connected(self) -> None:
        await wait_for(lambda: self.app["ma"].connected.is_set())
        await wait_for(lambda: self.app["music"].states.on)

    # -- people --------------------------------------------------------------------------------------------
    async def actor(self, username: str, role: str, *, tunnel: bool = False) -> "Actor":
        """A signed-in person with a client of their own. ``tunnel``: a session on the tunnel door (a passkey sign-in
        made directly, as tests/test_camera_setup.py does), whose requests carry the tunnel door header."""
        a = Actor(self, username)
        self.actors.append(a)
        row = self.app["accounts"].db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        uid = row["id"] if row is not None else await self.m.user(username, role)
        a.uid = uid
        if tunnel:
            issued = self.app["sessions"].create(uid, "tunnel", "passkey")
            a.set_cookies(mantel_session=issued.access, mantel_csrf=issued.csrf)
            a.tunnel = True
        else:
            r = await a.http.post("/api/auth/password", json={"username": username, "password": PASSWORD})
            assert r.status == 200, await r.text()
        return a

    async def tablet(self, name: str = "Kitchen tablet", room: str = "kitchen") -> "Actor":
        """A wall tablet, enrolled by an Owner (its own client holds only the tablet's credential)."""
        a = await self.actor("enroller_" + name.lower().replace(" ", "_"), "owner")
        status, body = await a.call("POST", "/api/devices/enroll", {"name": name, "room": room})
        assert status == 201, body
        a.device_id = body["device"]["id"]
        return a

    async def pick(self, *entities: str) -> list[str]:
        return list(entities)

    def rows(self, **where) -> list[dict]:
        return self.audit(**where)

    def play_rows(self) -> list[dict]:
        return [r for r in self.audit(kind="ma") if r["action"] == "intercom.play"]

    def open_rows(self) -> list[dict]:
        return [r for r in self.audit(kind="ma") if r["action"] == "intercom.open"]

    async def close_actors(self) -> None:
        for a in self.actors:
            await a.close()


class Actor:
    """One client of the app with its own cookie jar: a person or a wall tablet."""

    def __init__(self, env: Env, label: str):
        self.env, self.label = env, label
        origin = env.m.origin
        self.origin = origin
        self.http = aiohttp.ClientSession(base_url=origin, cookie_jar=aiohttp.CookieJar(unsafe=True),
                                          headers={"Origin": origin})
        self.uid: str | None = None
        self.device_id: str | None = None
        self.tunnel = False
        self.sockets: list[aiohttp.ClientWebSocketResponse] = []

    async def close(self) -> None:
        for ws in self.sockets:
            if not ws.closed:
                await ws.close()
        await self.http.close()

    def cookie(self, name: str) -> str | None:
        jar = self.http.cookie_jar.filter_cookies(URL(self.origin))
        return jar[name].value if name in jar else None

    def set_cookies(self, **cookies: str) -> None:
        self.http.cookie_jar.update_cookies(cookies, response_url=URL(self.origin))

    def headers(self, csrf: bool = True, tunnel: bool | None = None) -> dict:
        h: dict[str, str] = {}
        if csrf and self.cookie("mantel_csrf"):
            h["X-CSRF-Token"] = self.cookie("mantel_csrf")
        if self.tunnel if tunnel is None else tunnel:
            h["X-Mantel-Door"] = "tunnel"
        return h

    async def call(self, method: str, path: str, body: Any = None, *, csrf: bool = True,
                   tunnel: bool | None = None) -> tuple[int, Any]:
        r = await self.http.request(method, path, json=body, headers=self.headers(csrf, tunnel))
        text = await r.text()
        try:
            return r.status, json.loads(text)
        except ValueError:
            return r.status, text

    async def get(self, path: str, **kw):
        return await self.call("GET", path, **kw)

    async def put(self, path: str, body: Any, **kw):
        return await self.call("PUT", path, body, **kw)

    async def post(self, path: str, body: Any = None, **kw):
        return await self.call("POST", path, {} if body is None else body, **kw)

    # -- the hub socket and the gateway ---------------------------------------------------------------------
    async def hub(self, *, caps: bool = True) -> aiohttp.ClientWebSocketResponse:
        ws = await self.http.ws_connect("/ws", headers=self.headers(False))
        self.sockets.append(ws)
        if caps:
            first = await recv(ws)
            assert first["type"] == "capabilities", first
        return ws

    async def command(self, ws, **body) -> dict:
        rid = body.pop("id", 1)
        await ws.send_json({"type": "command", "id": rid, **body})
        while True:
            reply = await recv(ws)
            if reply.get("id") == rid:
                return reply

    async def ticket(self, ws, mode: str = "message", rate: int = RATE, **extra) -> dict:
        return await self.command(ws, kind="intercom", mode=mode, rate=rate, **extra)

    # -- the audio socket --------------------------------------------------------------------------------------
    async def audio(self, token: Any, *, auth: bool = True) -> aiohttp.ClientWebSocketResponse:
        """/ws/intercom, signed in with ``token`` (the first frame); the caller reads the answer."""
        ws = await self.http.ws_connect("/ws/intercom", headers=self.headers(False))
        self.sockets.append(ws)
        assert (await recv(ws)) == {"type": "auth_required"}
        if auth:
            await ws.send_json({"type": "auth", "access_token": token})
        return ws

    async def talk(self, mode: str = "message", rate: int = RATE, *, hub=None) -> aiohttp.ClientWebSocketResponse:
        """A ticket from the gateway and an authenticated audio socket (auth_ok read). ``ws.audit_id``: its open row."""
        hub = hub or await self.hub()
        reply = await self.ticket(hub, mode, rate)
        assert reply["type"] == "command_result", reply
        ws = await self.audio(reply["result"]["ticket"])
        ok = await recv(ws)
        assert ok["type"] == "auth_ok", ok
        ws.audit_id, ws.hub, ws.ok = reply["audit_id"], hub, ok
        return ws


# ------------------------------------------------------------------------------------------ socket helpers
async def recv(ws, timeout: float = 3):
    return await asyncio.wait_for(ws.receive_json(), timeout)


async def recv_until(ws, kind: str, timeout: float = 5) -> list[dict]:
    """Every JSON event up to and including the first of type ``kind``."""
    got = []
    while True:
        msg = await recv(ws, timeout)
        got.append(msg)
        if msg.get("type") == kind:
            return got


async def closed(ws, timeout: float = 3):
    m = await asyncio.wait_for(ws.receive(), timeout)
    while m.type not in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.CLOSING):
        m = await asyncio.wait_for(ws.receive(), timeout)
    return ws.close_code


async def until(cond, timeout: float = 3) -> bool:
    for _ in range(int(timeout / 0.02)):
        if cond():
            return True
        await asyncio.sleep(0.02)
    return cond()


def frame_bytes(rate: int = RATE, ms: int = FRAME_MS) -> int:
    return rate * 2 * ms // 1000


def chunks(n: int = 10, rate: int = RATE, ms: int = FRAME_MS, seed: int = 1) -> list[bytes]:
    """``n`` frames of audio, each different, so a test can tell the bytes Music Assistant got from any others."""
    size = frame_bytes(rate, ms)
    return [bytes((seed + i * 31 + j * 7) % 251 for j in range(size)) for i in range(n)]


async def send_audio(ws, parts: list[bytes]) -> bytes:
    for p in parts:
        await ws.send_bytes(b"\x01" + p)
    return b"".join(parts)


async def send_msg(ws, **msg) -> None:
    await ws.send_json(msg)


def fixture(commands: bool = True):
    @pytest.fixture
    async def env(tmp_path, monkeypatch):
        app, store, now, commander, fake, server, port = await build(tmp_path, monkeypatch, commands=commands)
        async with TestClient(TestServer(app)) as client:
            origin = str(client.make_url("")).rstrip("/")
            client.session.headers["Origin"] = origin
            e = Env(Mantel(app, client, store, now, origin), commander, fake, port)
            await e.connected()
            await e.configure()
            try:
                yield e
            finally:
                await e.close_actors()
        await server.close()
        store.db.close()
    return env
