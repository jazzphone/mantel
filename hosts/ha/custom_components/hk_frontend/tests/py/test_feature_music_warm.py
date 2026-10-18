"""Keep Playlists Ready (features/music/warm.py): Music Assistant's playlist
cache refreshed in the background -- the pills' playlists and the recently
played ones, streaming only, one at a time, never while the Music page is in
use, and a round cut short when Apple Music is refusing. Off unless the house
turns it on (HK Settings -> Music)."""
from __future__ import annotations

from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.hk_frontend.features.music import const as C
from custom_components.hk_frontend.features.music.warm import PlaylistWarmer

from music_sample_house import music_entry
from music_sample_house import house, music  # noqa: F401 -- the fixtures
from test_feature_music_settings_ws import Conn, _admin, _call


class Mass:
    """Music Assistant's client, as far as keeping playlists ready goes. Each
    playlist answers `songs` songs after `took` seconds of the fake clock."""

    def __init__(self, clock, songs=None, took=None, fail=(), recent=None, builtin=()):
        self.clock, self.sent = clock, []
        self.songs, self.took, self.fail = songs or {}, took or {}, set(fail)
        self.recent = recent if recent is not None else []
        self.builtin = set(builtin)

    async def send_command(self, command, **kw):
        self.sent.append((command, kw))
        if command == "music/recently_played_items":
            if self.recent == "broken":
                raise RuntimeError("no playlog")
            return [{"item_id": i, "provider": "library", "media_type": "playlist"} for i in self.recent]
        if command == "music/playlists/library_items":
            ids = set(self.songs) | set(self.recent if isinstance(self.recent, list) else []) | self.builtin
            return [{"item_id": i, "provider_mappings": [
                {"provider_domain": "builtin" if i in self.builtin else "apple_music"}]} for i in ids]
        if command == "music/playlists/playlist_tracks":
            i = kw["item_id"]
            self.clock.t += self.took.get(i, 1.5)
            if i in self.fail:
                raise RuntimeError("Apple Music Rate Limiter")
            return [{"name": "song"}] * self.songs.get(i, 25)
        return None


class Clock:
    def __init__(self):
        self.t, self.slept = 1000.0, []

    def __call__(self):
        return self.t

    async def sleep(self, s):
        self.slept.append(round(s, 1))
        self.t += s


class Entry:
    def __init__(self, on=True):
        self.options = {C.CONF_KEEP_READY: on}


def _setup(hass, mass):
    e = MockConfigEntry(domain="music_assistant")
    e.add_to_hass(hass)

    class Data:
        pass
    e.runtime_data = Data()
    e.runtime_data.mass = mass


def _warmer(hass, clock, pills=("library://playlist/147", "library://playlist/124")):
    w = PlaylistWarmer(hass, Entry(), lambda: list(pills))
    w.clock, w.sleep = clock, clock.sleep
    return w


def _refreshed(mass):
    return [kw["item_id"] for c, kw in mass.sent if c == "music/playlists/playlist_tracks"]


async def test_the_pills_then_the_recently_played_each_once(hass):
    clock = Clock()
    mass = Mass(clock, songs={"147": 25, "124": 200}, recent=["124", "137", "4"], builtin={"4"})
    _setup(hass, mass)
    w = _warmer(hass, clock, pills=("library://playlist/147", "library://playlist/124",
                                    "apple_music://playlist/pl.x"))
    assert await w.round() == C.WARM_EVERY
    assert _refreshed(mass) == ["147", "124", "137"], "pills first, no repeats, MA's own left alone"
    asked = [kw for c, kw in mass.sent if c == "music/playlists/playlist_tracks"]
    assert all(kw["force_refresh"] and kw["provider_instance_id_or_domain"] == "library" for kw in asked), \
        "a refresh, not a read of what is already cached"
    assert clock.slept == [C.WARM_GAP, C.WARM_GAP], "one at a time, apart"
    assert w.status()["ready"] == 3 and w.status()["wanted"] == 3 and w.status()["note"] is None


async def test_recent_is_only_this_week(hass):
    clock = Clock()
    mass = Mass(clock)
    _setup(hass, mass)
    await _warmer(hass, clock).round()
    kw = next(kw for c, kw in mass.sent if c == "music/recently_played_items")
    assert kw["media_types"] == ["playlist"] and kw["limit"] == C.WARM_RECENT
    assert kw["played_after_timestamp"] > 0


async def test_it_waits_while_the_music_page_is_in_use(hass):
    clock = Clock()
    mass = Mass(clock, songs={"147": 25, "124": 25})
    _setup(hass, mass)
    w = _warmer(hass, clock)
    w.used()
    clock.t += 30                         # someone browsed 30 s ago
    await w.round()
    assert clock.slept[0] == C.WARM_QUIET - 30, "the rest of the quiet time, before the first"
    assert len(_refreshed(mass)) == 2


async def test_apple_refusing_ends_the_round(hass):
    """A page that took WARM_SLOW_PAGE was refused at least three times in a
    row: the rest wait WARM_RETRY rather than queue more at Apple."""
    clock = Clock()
    mass = Mass(clock, songs={"147": 25, "124": 100, "150": 100},
                took={"124": C.WARM_SLOW_PAGE + 1})
    _setup(hass, mass)
    w = _warmer(hass, clock, pills=("library://playlist/147", "library://playlist/124",
                                    "library://playlist/150"))
    assert await w.round() == C.WARM_RETRY
    assert _refreshed(mass) == ["147", "124"], "stopped after the slow one"
    assert w.status()["ready"] == 2 and "busy" in w.status()["note"]
    # WARM_RETRY later, the round picks up where it stopped
    clock.t += C.WARM_RETRY
    mass.took = {}
    assert await w.round() == C.WARM_EVERY
    assert _refreshed(mass) == ["147", "124", "150"], "only the one still waiting"
    assert w.status()["ready"] == 3 and w.status()["note"] is None
    # ...and a regular round, WARM_EVERY later, refreshes them all again
    clock.t += C.WARM_EVERY
    await w.round()
    assert _refreshed(mass)[3:] == ["147", "124", "150"]


async def test_a_long_playlist_is_judged_per_page(hass):
    """200 songs is two pages: 15 s for both is 7.5 s a page, not refusal."""
    clock = Clock()
    mass = Mass(clock, songs={"147": 200, "124": 25}, took={"147": 15})
    _setup(hass, mass)
    assert await _warmer(hass, clock).round() == C.WARM_EVERY
    assert _refreshed(mass) == ["147", "124"]


async def test_one_failure_does_not_stop_the_rest(hass):
    clock = Clock()
    mass = Mass(clock, songs={"147": 25, "124": 25}, fail={"147"})
    _setup(hass, mass)
    w = _warmer(hass, clock)
    assert await w.round() == C.WARM_EVERY
    assert _refreshed(mass) == ["147", "124"] and w.status()["ready"] == 1


async def test_without_the_recent_list_the_pills_still_go(hass):
    clock = Clock()
    mass = Mass(clock, songs={"147": 25, "124": 25}, recent="broken")
    _setup(hass, mass)
    await _warmer(hass, clock).round()
    assert _refreshed(mass) == ["147", "124"]


async def test_without_music_assistant_it_says_so(hass):
    clock = Clock()
    w = _warmer(hass, clock)
    assert await w.round() == C.WARM_RETRY
    assert w.status()["ready"] == 0 and "Music Assistant" in w.status()["note"]


async def test_off_unless_turned_on_and_off_again(hass, music):
    """The switch, from HK Settings: off at first, on starts it, off stops it.
    A change that leaves it on does not restart it."""
    conn = await _admin(hass)
    w = music_entry(hass).runtime_data.warmer
    page = (await _call(hass, conn, "get"))["result"]
    assert page["keep_ready"] is False and page["keep_ready_last"] is None
    assert w._timer is None and w._task is None, "nothing runs until it is turned on"
    assert (await _call(hass, conn, "set", changes={"keep_ready": True}))["success"]
    assert music_entry(hass).options[C.CONF_KEEP_READY] is True
    timer = w._timer
    assert timer is not None, "the first round is booked"
    assert (await _call(hass, conn, "set", changes={"volume": 0.4}))["success"]
    assert w._timer is timer, "another setting changed: the same booking stands"
    assert (await _call(hass, conn, "set", changes={"keep_ready": False}))["success"]
    assert w._timer is None and w._task is None
    for bad in ("yes", 1, None):
        r = await _call(hass, conn, "set", changes={"keep_ready": bad})
        assert not r["success"] and "on or off" in r["message"]


async def test_the_page_and_the_actions_say_it_is_in_use(hass, music):
    """hk_music/used (the Music page's browse and search) and every music
    action (its plays) hold the next refresh back."""
    from custom_components.hk_frontend.features.music import ws_music_used
    w = music_entry(hass).runtime_data.warmer
    assert w._last_use < 0
    conn = Conn(await hass.auth.async_create_user("tablet"))
    ws_music_used(hass, conn, {"id": 1, "type": "hk_music/used"})
    assert conn.sent[-1]["success"] and w._last_use > 0
    w._last_use = -1
    await hass.services.async_call("hk_frontend", "music_stop", {}, blocking=True, return_response=True)
    assert w._last_use > 0
