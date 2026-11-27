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


def test_item_ids_are_kept_for_metadata():
    assert A.stream_id(SID) == "sn9Fake" and A.stream_id("apple_music://track/1") is None
    assert A.stream_id("apple-device://ap0001/" + "ab12" * 16) == "ab12" * 16
    assert A.group_id({"media_content_id": SID}) is None


HV = {"app_id": "com.apple.sonic.music", "source": "Music"}     # a HomeView sending through its own Music app
RX = {"app_id": "com.apple.TVAirPlay"}                             # a speaker receiving AirPlay


def test_play_pause_uses_advertised_group_and_never_toggles_each():
    hv, kitchen, den, phone, old = ("media_player." + r for r in ("hv", "kitchen", "den", "phone", "old"))
    rooms = [hv, kitchen, den, phone, old]
    h = House({
        hv: ("playing", dict(HV, media_content_id=SID, airplay_group_id="home")),
        kitchen: ("playing", dict(RX, media_content_id=SID, airplay_group_id="HOME")),
        den: ("paused", dict(RX, media_content_id="apple-device://den/another-item", airplay_group_id="home")),
        phone: ("playing", dict(RX, media_content_id=SID, airplay_group_id="phone")),
        old: ("idle", dict(RX, media_content_id=SID, airplay_group_id="home")),
    })
    assert A.session_players(h, rooms, hv) == [hv, kitchen, den]
    assert A.play_pause(h, rooms, hv) == ("media_pause", [hv, kitchen, den])
    assert A.play_pause(h, rooms, den) == ("media_play", [den, hv, kitchen])
    assert A.play_pause(h, rooms, phone) == ("media_play_pause", phone)
    assert A.where_from(h, rooms, kitchen, lambda e: e) == "AirPlay from " + hv
    assert A.where_from(h, rooms, phone, lambda e: e) == "AirPlay"
    assert A.toggle(h, [den], den) == ("media_play_pause", den)

    # Older add-ons or HA installations without group data can report the same item on
    # every speaker, even with the HomeView's app visible. Those controls stay individual.
    for room in (hv, kitchen, phone):
        st = h.states_[room]
        h.states_[room] = State(room, st.state, {k: v for k, v in st.attributes.items() if k != "airplay_group_id"})
    for room in (hv, kitchen, phone):
        assert A.play_pause(h, rooms, room) == ("media_play_pause", room)
    assert A.where_from(h, rooms, kitchen, lambda e: e) == "AirPlay"


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
          "media_content_id": "apple-device://ap0001/snHome::STREAM", "airplay_group_id": "home"}
    rx = {"app_id": "com.apple.TVAirPlay", "media_content_id": "apple-device://ap0002/snHome::STREAM", "airplay_group_id": "home"}
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

