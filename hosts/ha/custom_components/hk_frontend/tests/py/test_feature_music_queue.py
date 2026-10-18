"""The Music page's queue (features/music hk_music/queue, hk_music/queue_play):
read from Music Assistant's own client, through the entry Home Assistant's
music_assistant integration holds; an answer in every case."""
from __future__ import annotations

import asyncio

from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.hk_frontend.features import music as M
from test_accessories import Conn


class Mass:
    """Music Assistant's client, as far as the queue goes."""

    def __init__(self):
        self.sent = []

    async def send_command(self, command, **kw):
        self.sent.append((command, kw))
        if command == "player_queues/items":
            return [{"queue_item_id": "a1", "name": "Toucanet", "duration": 115,
                     "media_item": {"name": "Toucanet", "artists": [{"name": "Noflik"}],
                                    "image": {"path": "https://img/x.jpg"}}},
                    {"queue_item_id": "b2", "name": "Motmot", "duration": 200, "media_item": {"name": "Motmot"}}]
        return None


class Data:
    def __init__(self, mass):
        self.mass = mass


def _ma(hass, mass=None, queue="q1"):
    e = MockConfigEntry(domain="music_assistant")
    e.add_to_hass(hass)
    e.runtime_data = Data(mass) if mass else None

    async def get_queue(call):
        return {call.data["entity_id"]: {"queue_id": queue, "current_index": 17}}
    from homeassistant.core import SupportsResponse
    hass.services.async_register("music_assistant", "get_queue", get_queue, supports_response=SupportsResponse.ONLY)
    return e


async def _ask(hass, handler, msg):
    user = await hass.auth.async_create_user("tablet")
    conn = Conn(user)
    handler(hass, conn, dict(msg, id=1))
    for _ in range(20):
        await asyncio.sleep(0)
        await hass.async_block_till_done()
        if conn.sent:
            break
    return conn.sent[-1]["result"]


async def test_the_queue_from_the_current_song_on(hass):
    mass = Mass()
    _ma(hass, mass)
    r = await _ask(hass, M.ws_music_queue, {"type": "hk_music/queue", "entity_id": "media_player.lr", "limit": 40})
    assert r["ok"] and r["index"] == 17 and r["queue_id"] == "q1"
    assert mass.sent == [("player_queues/items", {"queue_id": "q1", "limit": 40, "offset": 17})]
    assert r["items"][0] == {"id": "a1", "title": "Toucanet", "artist": "Noflik", "duration": 115, "image": "https://img/x.jpg"}
    assert r["items"][1]["title"] == "Motmot" and r["items"][1]["image"] is None


async def test_a_song_is_played_by_its_queue_item(hass):
    mass = Mass()
    _ma(hass, mass)
    r = await _ask(hass, M.ws_music_queue_play, {"type": "hk_music/queue_play", "entity_id": "media_player.lr", "item_id": "b2"})
    assert r == {"ok": True}
    assert mass.sent == [("player_queues/play_index", {"queue_id": "q1", "index": "b2"})]


async def test_a_speaker_with_no_queue_is_told_so(hass):
    mass = Mass()
    _ma(hass, mass, queue=None)
    r = await _ask(hass, M.ws_music_queue_play, {"type": "hk_music/queue_play", "entity_id": "media_player.lr", "item_id": "b2"})
    assert r == {"ok": False, "message": "That speaker has no queue."}
    assert mass.sent == []                         # nothing asked of Music Assistant with no queue
    r = await _ask(hass, M.ws_music_queue, {"type": "hk_music/queue", "entity_id": "media_player.lr", "limit": 40})
    assert r == {"ok": False, "message": "That speaker has no queue."}


async def test_no_music_assistant_is_an_answer_not_an_error(hass):
    r = await _ask(hass, M.ws_music_queue, {"type": "hk_music/queue", "entity_id": "media_player.lr", "limit": 40})
    assert r["ok"] is False and "not set up" in r["message"]


async def test_a_client_that_fails_is_an_answer_too(hass):
    class Broken(Mass):
        async def send_command(self, command, **kw):
            raise RuntimeError("Command not found")
    _ma(hass, Broken())
    r = await _ask(hass, M.ws_music_queue, {"type": "hk_music/queue", "entity_id": "media_player.lr", "limit": 40})
    assert r == {"ok": False, "message": "Command not found"}
