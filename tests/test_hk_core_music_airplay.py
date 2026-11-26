"""hk_core.music.airplay: music AirPlayed from another device (a HomeView, an iPhone) to several HomePods -- one session
is one thing playing, Play / Pause reaches every room of it, and its cover is looked up when Music Assistant has none.
Fictional rooms and songs only."""
from __future__ import annotations

import asyncio

from hk_core.house import State
from hk_core.music import airplay as A

SID = "apple-device://ap0001/sn9Fake::STREAM"


def track(name, artist, album, cover="https://img.example.test/{}.jpg"):
    return {"name": name, "artists": [{"name": artist}], "album": {"name": album},
            "metadata": {"images": [{"type": "thumb", "path": cover.format(album.replace(" ", "_"))}]}}


class House:
    def __init__(self, states):
        self.states_ = {e: State(e, s, a) for e, (s, a) in states.items()}

    def state(self, entity_id):
        return self.states_.get(entity_id)


def test_a_session_is_the_streams_last_part():
    assert A.session_of(SID) == "sn9Fake"
    assert A.session_of("apple-device://ap0002/sn9Fake") == "sn9Fake"
    assert A.session_of("apple_music://track/1") is None and A.session_of(None) is None
    # pyatv's fallback when the sender gives no id: a hash of the song's details, the same for two devices -- no session
    assert A.session_of("apple-device://ap0001/" + "ab12" * 16) is None
    assert A.stream_id("apple-device://ap0001/" + "ab12" * 16) == "ab12" * 16, "its cover and clock still go by it"
    assert A.stream_id(SID) == "sn9Fake" and A.stream_id("apple_music://track/1") is None


def test_play_pause_reaches_every_room_of_a_session_and_never_toggles_each():
    other = "apple-device://ap0009/snOther::STREAM"
    h = House({"media_player.kitchen": ("playing", {"media_content_id": SID}),
               "media_player.den": ("playing", {"media_content_id": SID.replace("ap0001", "ap0002")}),
               "media_player.loft": ("idle", {"media_content_id": SID.replace("ap0001", "ap0003")}),
               "media_player.office": ("playing", {"media_content_id": other}),
               "media_player.porch": ("playing", {"media_content_id": "apple_music://track/1"})})
    rooms = ["media_player.kitchen", "media_player.den", "media_player.loft", "media_player.office", "media_player.porch"]
    assert A.session_players(h, rooms, "media_player.den") == ["media_player.den", "media_player.kitchen"]
    assert A.play_pause(h, rooms, "media_player.kitchen") == ("media_pause", ["media_player.kitchen", "media_player.den"])
    h.states_["media_player.kitchen"] = State("media_player.kitchen", "paused", {"media_content_id": SID})
    assert A.play_pause(h, rooms, "media_player.kitchen")[0] == "media_play"
    # one room of a session, or anything else: the plain toggle on that player
    assert A.play_pause(h, rooms, "media_player.office") == ("media_play_pause", "media_player.office")
    assert A.play_pause(h, rooms, "media_player.porch") == ("media_play_pause", "media_player.porch")


def test_the_cover_is_that_song_on_its_album_first():
    rows = [track("Snow Day", "A Singer", "Best Of"), track("Snow Day", "Someone Else", "Winter"),
            track("Snow Day", "A Singer", "Winter"), track("Other", "A Singer", "Winter")]
    assert A.pick(rows, "Snow Day", "A Singer", "Winter").endswith("/Winter.jpg")
    # the album not found: the song on another of its albums; by another artist only: none
    assert A.pick(rows, "Snow Day", "A Singer", "Live in Town").endswith("/Best_Of.jpg")
    assert A.pick(rows, "Snow Day", "Nobody", "Winter") is None
    # case, curly quotes and a trailing "(Remastered)" don't matter; the album's picture when the song has none
    bare = [{"name": "Don't Stop (Remastered 2020)", "artists": [{"name": "A Band"}],
             "album": {"name": "Hits", "image": {"type": "thumb", "path": "https://img.example.test/hits.jpg"}}}]
    assert A.pick(bare, "DON’T STOP", "a band", None) == "https://img.example.test/hits.jpg"
    # several artists: the first is enough ("A Singer & Friend")
    assert A.pick(rows, "Snow Day", "A Singer & Friend", "Winter").endswith("/Winter.jpg")
    assert A.pick(None, "x", "y", None) is None


def test_covers_are_looked_up_once_and_a_failure_is_asked_again_later():
    now = [1000.0]
    asked = []

    async def search(q):
        asked.append(q)
        if q.startswith("Broken"):
            raise ConnectionError("away")
        return {"tracks": [track("Snow Day", "A Singer", "Winter")]}
    c = A.StreamCovers(search, clock=lambda: now[0])

    async def run():
        assert c.due("Snow Day", "A Singer", "Winter") and c.cover("Snow Day", "A Singer", "Winter") is None
        assert await c.look("Snow Day", "A Singer", "Winter") is True
        assert c.cover("snow day", "A SINGER", "Winter").endswith("/Winter.jpg")
        assert not c.due("Snow Day", "A Singer", "Winter") and asked == ["Snow Day A Singer"]
        # a song not found is kept as none; asked again only after MISSING_TTL
        assert await c.look("Nothing", "A Singer", None) is False and not c.due("Nothing", "A Singer", None)
        assert await c.look("Broken", "A Singer", None) is False and not c.due("Broken", "A Singer", None)
        now[0] += A.RETRY
        assert c.due("Broken", "A Singer", None) and not c.due("Nothing", "A Singer", None)
        now[0] += A.MISSING_TTL
        assert c.due("Nothing", "A Singer", None)
        # no title or artist: nothing to look up
        assert not c.due("", "A Singer", None) and c.cover(None, None, None) is None
    asyncio.run(run())


def test_the_found_song_carries_its_length():
    rows = [dict(track("Snow Day", "A Singer", "Winter"), duration=201)]
    assert A.match(rows, "Snow Day", "A Singer", "Winter") == ("https://img.example.test/Winter.jpg", 201.0)
    assert A.match([track("Snow Day", "A Singer", "Winter")], "Snow Day", "A Singer", "Winter")[1] is None
    assert A.match([], "Snow Day", "A Singer", None) == (None, None)


def test_where_an_airplayed_song_is_counted_from_when_it_was_first_seen():
    c = A.SongClock()
    # first seen playing at 100: at 0 then; the same pair while nothing changes (a state changes only when it should)
    assert c.see("s", "song1", True, 100.0) == (0.0, 100.0)
    assert c.see("s", "song1", True, 130.0) == (0.0, 100.0)
    # paused at 130: held at 30 s; played again at 200: 30 s, counted from 200
    assert c.see("s", "song1", False, 130.0) == (30.0, 130.0)
    assert c.see("s", "song1", True, 200.0) == (30.0, 200.0)
    # the next song starts at 0
    assert c.see("s", "song2", True, 250.0) == (0.0, 250.0)
    # a real position Music Assistant reports wins when it differs by more than 3 s; a 0 is no report
    assert c.see("s", "song2", True, 260.0, reported=(42.0, 259.0)) == (42.0, 259.0)
    assert c.see("s", "song2", True, 262.0, reported=(0.0, 262.0)) == (42.0, 259.0)
    assert c.see("s", "song2", True, 263.0, reported=(45.5, 262.0)) == (42.0, 259.0)
    # a session first seen just after the host started: playing already, so where it is isn't known...
    assert c.see("t", "song1", True, 300.0, known_start=False) is None
    assert c.see("t", "song1", True, 310.0, known_start=False) is None
    # ...until its next song, or a real position
    assert c.see("t", "song2", True, 400.0, known_start=False) == (0.0, 400.0)
    assert c.see("u", "song1", True, 500.0, known_start=False, reported=(80.0, 499.0)) == (80.0, 499.0)


def test_music_that_isnt_music_assistants_says_where_it_comes_from():
    # A HomeView playing its own Music app, two HomePods it AirPlays to (the same session), a HomePod AirPlayed
    # from an iPhone, and Music Assistant's own music (2026-11-25: Mantel offered to add rooms to the HomeView).
    hv = {"app_id": "com.apple.sonic.music", "source": "Music",
          "media_content_id": "apple-device://ap0001/snHome::STREAM"}
    rx = {"app_id": "com.apple.TVAirPlay", "media_content_id": "apple-device://ap0002/snHome::STREAM"}
    phone = {"app_id": "com.apple.TVAirPlay", "media_content_id": "apple-device://ap0004/snPhone::STREAM"}
    ma = {"app_id": "music_assistant", "media_content_id": "apple_music://track/1"}
    h = House({"media_player.living_room": ("playing", hv), "media_player.den": ("playing", rx),
               "media_player.porch": ("paused", dict(rx, media_content_id="apple-device://ap0003/snHome::STREAM")),
               "media_player.office": ("playing", phone), "media_player.kitchen": ("playing", ma),
               "media_player.loft": ("idle", hv)})
    rooms = list(h.states_)
    names = {"media_player.living_room": "Living Room HomeView", "media_player.den": "Den"}.get
    assert A.outside(hv) and A.outside(rx) and A.outside({"app_id": "com.apple.Safari"}) and not A.outside(ma)
    assert not A.outside({}) and not A.outside({"app_id": ""})
    assert A.where_from(h, rooms, "media_player.living_room", names) == "Music on Living Room HomeView"
    assert A.where_from(h, rooms, "media_player.den", names) == "AirPlay from Living Room HomeView"
    assert A.where_from(h, rooms, "media_player.porch", names) == "AirPlay from Living Room HomeView", "paused too"
    assert A.where_from(h, rooms, "media_player.office", names) == "AirPlay", "an iPhone is no speaker of the house"
    assert A.where_from(h, rooms, "media_player.kitchen", names) is None, "Music Assistant's own"
    assert A.where_from(h, rooms, "media_player.loft", names) is None, "not playing"
    assert A.origin(h, rooms, "media_player.den") == ("AirPlay", "media_player.living_room")
    # a receiver that names Music Assistant as its app, with an AirPlay session: still sent to
    h3 = House({"media_player.living_room": ("playing", hv),
                "media_player.den": ("playing", dict(rx, app_id="music_assistant", source="com.apple.tvairplayd"))})
    assert A.where_from(h3, list(h3.states_), "media_player.den", names) == "AirPlay from Living Room HomeView"
    # the sending speaker by its own name, not its room's (a room with a HomePod and a HomeView)
    h4 = House({"media_player.living_room": ("playing", dict(hv, friendly_name="Living Room HomeView")),
                "media_player.den": ("playing", rx)})
    assert A.where_from(h4, list(h4.states_), "media_player.living_room", names) == "Music on Living Room HomeView"
    assert A.where_from(h4, list(h4.states_), "media_player.den", names) == "AirPlay from Living Room HomeView"
    # no source name: the app id's last part
    h2 = House({"media_player.x": ("playing", {"app_id": "com.apple.Safari"})})
    assert A.where_from(h2, ["media_player.x"], "media_player.x", lambda e: "Office") == "Safari on Office"

