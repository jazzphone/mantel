"""The token for the Music Assistant page (ma_page.py): an ordinary MA user's token, set on the Connections page,
sealed, never sent to a page; Mantel signs HK's /ma/ frame in with it server-side (the way MA's app is signed in
behind HA's Ingress), and refuses the commands that would end that sign-in. Fictional MA only."""
from __future__ import annotations

import json

import pytest

from mantel_server import connections as C
from https_fakes import ma_app, make_mantel, start_upstream

PAGE = "/api/connections/ma/page"


def speakers(m):
    """The house's two Music Assistant speakers, as Home Assistant's registry lists them."""
    m.app["hub"].registry.load(
        [{"area_id": "den", "name": "Den"}, {"area_id": "kids_room", "name": "Kids' Room"}], [],
        [{"entity_id": "media_player.den", "platform": "music_assistant", "unique_id": "fake-den", "area_id": "den"},
         {"entity_id": "media_player.kids", "platform": "music_assistant", "unique_id": "fake-kids",
          "area_id": "kids_room"}])


@pytest.fixture
async def env(tmp_path, monkeypatch):
    ma = await start_upstream(ma_app)
    m = await make_mantel(tmp_path, monkeypatch, commands_enabled=True)
    speakers(m)
    conns = m.app["connections"]
    rec = C.Record(kind="ma", url=ma.url, token="engine-admin-token", method="token", since=1.0)
    conns.files.save(rec)
    conns.own["ma"] = rec                       # Music Assistant set up on the Connections page
    await m.as_role("owner")
    yield m, ma
    await m.client.close()
    await ma.server.close()
    m.store.db.close()


async def test_no_page_token_the_frame_stays_on_mas_own_sign_in(env):
    m, ma = env
    assert (await (await m.client.get(PAGE)).json())["page"]["set"] is False
    assert (await (await m.client.get("/api/services")).json())["music_assistant"] == "/ma/"
    async with m.client.ws_connect("/ma/hassio_ingress/mantel/ws") as ws:
        info = json.loads((await ws.receive(timeout=5)).data)
    assert info["homeassistant_addon"] is False and "auth" not in ma.commands


async def test_an_administrators_token_is_refused(env):
    m, ma = env
    r = await m.client.post(PAGE, json={"token": "admin-token"}, headers=m.csrf())
    body = await r.json()
    assert r.status == 422 and body["error"] == "admin_token" and "User role" in body["message"]
    assert (await (await m.client.get(PAGE)).json())["page"]["set"] is False


async def test_the_page_token_signs_the_frame_in_server_side(env):
    m, ma = env
    r = await m.client.post(PAGE, json={"token": "page-token-user"}, headers=m.csrf())
    text = await r.text()
    assert r.status == 200 and "page-token-user" not in text
    page = json.loads(text)["page"]
    assert page["set"] is True and page["saved"]["user"]["name"] == "Listener"
    raw = m.app["connections"].files.path("ma_page").read_bytes()
    assert b"page-token-user" not in raw                                     # sealed
    rows = [str(dict(r)) for r in m.store.db.execute("SELECT * FROM action_audit")]
    assert any("connection.ma_page.saved" in r for r in rows) and not any("page-token-user" in r for r in rows)
    # HK's frame goes to the signed-in address
    assert (await (await m.client.get("/api/services")).json())["music_assistant"] == "/ma/hassio_ingress/mantel/"
    assert (await m.client.get("/ma/hassio_ingress/mantel/assets/app.js")).status == 200
    ma.commands.clear()
    frames = []
    async with m.client.ws_connect("/ma/hassio_ingress/mantel/ws") as ws:
        info = json.loads((await ws.receive(timeout=5)).data)
        frames.append(info)
        assert info["homeassistant_addon"] is True                         # MA's app asks auth/me, no sign-in
        await ws.send_str(json.dumps({"message_id": "1", "command": "auth/me"}))
        me = json.loads((await ws.receive(timeout=5)).data)
        frames.append(me)
        assert me["result"]["username"] == "listener"
        # what would end or change that sign-in never reaches MA
        await ws.send_str(json.dumps({"message_id": "2", "command": "auth/logout"}))
        no = json.loads((await ws.receive(timeout=5)).data)
        assert no["message_id"] == "2" and no["error_code"] == 403
    assert ma.commands[0] == "auth" and "auth/logout" not in ma.commands
    assert "page-token-user" not in json.dumps(frames)
    # the plain /ma/ socket is not signed in
    ma.commands.clear()
    async with m.client.ws_connect("/ma/ws") as ws:
        assert json.loads((await ws.receive(timeout=5)).data)["homeassistant_addon"] is False
    assert "auth" not in ma.commands


async def test_a_revoked_page_token_falls_back_to_mas_sign_in(env):
    m, ma = env
    assert (await m.client.post(PAGE, json={"token": "page-token-user"}, headers=m.csrf())).status == 200
    ma.revoked.add("page-token-user")
    async with m.client.ws_connect("/ma/hassio_ingress/mantel/ws") as ws:
        info = json.loads((await ws.receive(timeout=5)).data)
        assert info["homeassistant_addon"] is False
        await ws.send_str(json.dumps({"message_id": "9", "command": "auth/logout"}))
        echo = json.loads((await ws.receive(timeout=5)).data)
    assert "echo" in echo                                                   # not signed in by Mantel: not refused


async def test_sign_in_once_with_a_user_name_then_remove(env):
    m, ma = env
    r = await m.client.post(PAGE, json={"username": "listener", "password": "fictional-pass"}, headers=m.csrf())
    assert r.status == 200 and (await r.json())["page"]["saved"]["method"] == "login"
    r = await m.client.delete(PAGE, headers=m.csrf())
    assert r.status == 200 and (await r.json())["page"]["set"] is False
    assert (await (await m.client.get("/api/services")).json())["music_assistant"] == "/ma/"


async def test_only_an_owner_sets_it(env, tmp_path):
    m, _ = env
    await m.as_role("admin")
    assert (await m.client.get(PAGE)).status == 200
    assert (await m.client.post(PAGE, json={"token": "page-token-user"}, headers=m.csrf())).status == 403
    await m.as_role("adult")
    assert (await m.client.get(PAGE)).status == 403


async def signed(m) -> bool:
    async with m.client.ws_connect("/ma/hassio_ingress/mantel/ws") as ws:
        return json.loads((await ws.receive(timeout=5)).data)["homeassistant_addon"] is True


async def test_only_someone_who_may_play_every_speaker_gets_the_signed_page(env):
    """A signed page sends Music Assistant's commands past the gateway (no rooms, no audit per command), so it is
    given only to someone the gateway would let do all of it. A Child kept to their room, with music control,
    gets Music Assistant's own sign-in, as without a token; the Owner's signed page is in the audit log."""
    m, ma = env
    assert (await m.client.post(PAGE, json={"token": "page-token-user"}, headers=m.csrf())).status == 200
    assert await signed(m)
    rows = [dict(r) for r in m.store.db.execute("SELECT * FROM action_audit WHERE action = 'music.page_signed_in'")]
    assert len(rows) == 1 and rows[0]["role"] == "owner"
    await m.as_role("child", "cody")
    uid = m.store.db.execute("SELECT id FROM users WHERE username = 'cody'").fetchone()[0]
    m.app["rbac"].set_scopes("user", uid, ["kids_room"])
    ma.commands.clear()
    assert not await signed(m)
    assert "auth" not in ma.commands


async def test_with_house_commands_off_the_page_is_never_signed_in(tmp_path, monkeypatch):
    ma = await start_upstream(ma_app)
    m = await make_mantel(tmp_path, monkeypatch)
    try:
        speakers(m)
        conns = m.app["connections"]
        rec = C.Record(kind="ma", url=ma.url, token="engine-admin-token", method="token", since=1.0)
        conns.files.save(rec)
        conns.own["ma"] = rec
        await m.as_role("owner")
        assert (await m.client.post(PAGE, json={"token": "page-token-user"}, headers=m.csrf())).status == 200
        ma.commands.clear()                                   # (saving it checked the token with MA)
        assert not await signed(m)
        assert "auth" not in ma.commands
    finally:
        await m.client.close()
        await ma.server.close()
        m.store.db.close()
