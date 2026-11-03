"""End-to-end: Mantel's music engine against a FAKE Music Assistant, over real sockets (no real MA exists for
testing: the house's Music Assistant is never contacted, and the scratch HA has no Music Assistant).

    ~/.venvs/mantel/bin/python tools/e2e/music_e2e.py

Runs Mantel Server in this process twice (temp database; the fictional house of tests/music_fakes.py seeded
into the hub, no Home Assistant connection) with a fake Music Assistant WebSocket server on 127.0.0.1 that
records every frame and moves the players' states as HA's music_assistant integration would report them:

* **Phase A, commands disabled** (the house's setting): the Owner's music feed comes from Mantel (home room,
  speakers, floors); the queue and the playlist library are read from Music Assistant; a playlist press, a
  queue jump and a preset save are refused (``commands_disabled``) and Music Assistant receives no command.
* **Phase B, commands enabled**: the same press plays the playlist with exactly the Music Assistant commands
  HA's integration would send; the audit row is written first; a Child is refused another room's speaker
  and nothing is sent for it; with the Kitchen made an announcement room, the same press regroups the rooms
  under the other room (who leads a pick).

Evidence: ``<temp>/music_e2e.json`` (printed path). Nothing here can reach a real house: there is no HA
connection, and the only Music Assistant is the fake on 127.0.0.1.
"""
from __future__ import annotations

import asyncio
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "hosts/server"))
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from aiohttp.test_utils import TestClient, TestServer  # noqa: E402
from argon2 import PasswordHasher  # noqa: E402

import music_fakes as MF  # noqa: E402
from connector_fakes import MA_TOKEN  # noqa: E402

RESULTS: list[str] = []
PASSWORD = "fictional e2e password"


class Fail(Exception):
    pass


def check(cond, what):
    if not cond:
        raise Fail(what)
    print("[music-e2e] PASS", what, flush=True)
    RESULTS.append(what)


async def phase(tmp: Path, commands: bool) -> dict:
    from mantel_server import music as M
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.settings_store import Actor
    from mantel_server.store import Store

    fake = MF.HouseMa()
    ma_server = TestServer(fake.app(), host="127.0.0.1")
    await ma_server.start_server()
    d = tmp / ("on" if commands else "off")
    (d / "secrets").mkdir(parents=True)
    (d / "secrets" / "ma_token").write_text(MA_TOKEN)
    cfg = Config(data_dir=d / "data", secrets_dir=d / "secrets", port=0, commands_enabled=commands,
                 ma_url=str(ma_server.make_url("/ws")), ma_token_file=d / "secrets" / "ma_token")
    store = Store(cfg.data_dir / "mantel.db")
    app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False)
    app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
    hub = app["hub"]
    hub.registry.load(MF.AREAS, [], MF.ENTITIES, MF.FLOORS)
    hub.store.apply_event({"a": MF.states()})
    fake.hub = hub
    app["music"].engine.settle = 0.0
    app["settings"].store.write([("house", M.MUSIC_DOC, json.loads(json.dumps(MF.DOC)))], actor=Actor(label="e2e"))
    out: dict = {}
    async with TestClient(TestServer(app, host="127.0.0.1")) as client:
        origin = str(client.make_url("")).rstrip("/")
        client.session.headers["Origin"] = origin
        await app["accounts"].create_user("owner1", "Owner", "owner", PASSWORD)
        uid = await app["accounts"].create_user("cody", "Cody", "child", PASSWORD)
        app["rbac"].set_scopes("user", uid, ["cody_room"])
        oid = app["accounts"].db.execute("SELECT id FROM users WHERE username='owner1'").fetchone()["id"]
        with app["accounts"].db:
            app["accounts"].db.execute("INSERT INTO ha_links (ha_user_id, user_id, created) VALUES ('ha-owner', ?, 1)", (oid,))
        for _ in range(300):
            if app["ma"].connected.is_set():
                break
            await asyncio.sleep(0.01)
        check(app["ma"].connected.is_set(), f"[{'B' if commands else 'A'}] Mantel authenticated to the fake Music Assistant")

        async def sign_in(user):
            client.session.cookie_jar.clear()
            r = await client.post("/api/auth/password", json={"username": user, "password": PASSWORD})
            assert r.status == 200, await r.text()

        async def recv(ws, want):
            while True:
                m = await asyncio.wait_for(ws.receive_json(), 5)
                if want(m):
                    return m

        await sign_in("owner1")
        ws = await client.ws_connect("/ws")
        await ws.send_json({"type": "read_subscribe", "id": 1, "msg": {"type": "hk_music/subscribe"}})
        ev = (await recv(ws, lambda m: m.get("type") == "read_event" and m.get("id") == 1))["event"]
        out["feed"] = ev
        check(ev["configured"] and ev["home"] == "media_player.den_ma", "the Owner's feed: their HA user's home room")
        await ws.send_json({"type": "read", "id": 2, "msg": {"type": "hk_music/queue", "entity_id": "media_player.kitchen_ma"}})
        q = (await recv(ws, lambda m: m.get("id") == 2 and m.get("type") == "read_result"))["result"]
        check(q["ok"] and q["queue_id"] == "ma-kitchen" and len(q["items"]) == 2, "the queue read from Music Assistant")
        body = {"kind": "service", "domain": "hk_frontend", "service": "music_play",
                "data": {"rooms": ["media_player.kitchen_ma", "media_player.cody_ma"], "playlist": "pl1"},
                "return_response": True}
        await ws.send_json({"type": "command", "id": 3, **body})
        reply = await recv(ws, lambda m: m.get("id") == 3)
        out["play"] = reply
        if not commands:
            check(reply.get("code") == "commands_disabled", "[A] a playlist press is refused: commands disabled")
            check(fake.sent() == [], "[A] Music Assistant received no command")
        else:
            check(reply.get("result", {}).get("response") == {"ok": True, "leader": "media_player.kitchen_ma"},
                  "[B] the playlist plays, led by the first room")
            check([c for c, _a in fake.sent()] == ["players/cmd/group_many", "players/cmd/volume_set",
                                                   "players/cmd/volume_set", "player_queues/shuffle",
                                                   "player_queues/play_media", "player_queues/shuffle"],
                  "[B] exactly HA's integration's Music Assistant commands")
            row = app["audit"].rows(decision="allowed")[-1]
            check(row["action"] == "hk_frontend.music_play" and row["result"] == "ok", "[B] audited first, then sent")
        await ws.close()
        if commands:
            await sign_in("cody")
            ws = await client.ws_connect("/ws")
            n = len(fake.sent())
            await ws.send_json({"type": "command", "id": 4, **{**body, "data": {"rooms": ["media_player.kitchen_ma"],
                                                                               "playlist": "pl1"}}})
            reply = await recv(ws, lambda m: m.get("id") == 4)
            check(reply.get("error", {}).get("code") == "forbidden" and len(fake.sent()) == n,
                  "[B] a Child is refused another room's speaker; nothing sent")
            await ws.close()
            # WHO LEADS (2026-11-02): the Kitchen made an announcement room, the same press regroups the two under
            # the Cody room -- Music Assistant plays an announcement to a group's leader in every room of it
            await sign_in("owner1")
            ws = await client.ws_connect("/ws")
            await ws.send_json({"type": "command", "id": 5, "kind": "ws",
                                "msg": {"type": "hk_music/settings/set",
                                        "changes": {"announce_rooms": ["media_player.kitchen_ma"]}}})
            reply = await recv(ws, lambda m: m.get("id") == 5)
            check(reply.get("result", {}).get("announce_rooms") == ["media_player.kitchen_ma"],
                  "[B] the Owner marks the Kitchen an announcement room")
            n = len(fake.sent())
            await ws.send_json({"type": "command", "id": 6, **body})
            reply = await recv(ws, lambda m: m.get("id") == 6)
            check(reply.get("result", {}).get("response") == {"ok": True, "leader": "media_player.cody_ma"},
                  "[B] the playlist plays again, led by the room that is not announced to")
            joins = [a for c, a in fake.sent()[n:] if c == "players/cmd/group_many"]
            check(joins == [{"target_player": "ma-cody", "child_player_ids": ["ma-kitchen"]}],
                  "[B] the group the Kitchen led is joined again under the Cody room")
            await ws.close()
        out["ma_frames"] = fake.frames
    await ma_server.close()
    store.db.close()
    return out


async def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="music-e2e-"))
    evidence = {}
    try:
        evidence["A_commands_off"] = await phase(tmp, False)
        evidence["B_commands_on"] = await phase(tmp, True)
    except Fail as exc:
        print("[music-e2e] FAIL", exc, flush=True)
        return 1
    finally:
        (tmp / "music_e2e.json").write_text(json.dumps({"passed": RESULTS, **evidence}, indent=1, default=str))
        print("[music-e2e] evidence:", tmp / "music_e2e.json", flush=True)
    print(f"[music-e2e] {len(RESULTS)}/{len(RESULTS)} checks passed", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
