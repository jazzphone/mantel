"""hk_core.intercom against a fake House and a fake Music Assistant player list: the Intercom's settings and its
room rules, THE GROUP CHECK above all (docs/phase17/INTERCOM.md "Rooms"). Nothing here sends anything; the group
trap is only ever tested here, on fakes, never on real speakers (it would play house-wide).
"""
from datetime import datetime

import pytest

from hk_core.house import Entity, Floor, State
from hk_core.intercom import config as C, rooms as R
from hk_core.music import groups as G
from hk_core.music.config import Item, MusicConfig
from hk_core.music.const import CONF_PAIRS, CONF_SPEAKERS, CONF_VOLUME, SUB_PRESET

K, OFF, GR, LR, DEN, PLAY = (f"media_player.{r}" for r in ("kitchen", "office", "guest_room", "living_room", "den",
                                                           "playroom"))
STEREO = "media_player.study_pair"            # a stereo pair: a Music Assistant group of two players
SL, SR = "media_player.loft_left", "media_player.loft_right"   # a virtual pair: the Loft
ROOMS = [K, OFF, GR, LR, DEN, PLAY, STEREO, SL]
PIDS = {K: "ap_k", OFF: "ap_off", GR: "ap_gr", LR: "ap_lr", DEN: "ap_den", PLAY: "ap_play", STEREO: "sg_study",
        SL: "ap_sl", SR: "ap_sr"}
NOON = datetime(2026, 11, 3, 12, 0)
NIGHT = datetime(2026, 11, 3, 23, 30)
EARLY = datetime(2026, 11, 3, 6, 30)


class FakeHouse:
    def __init__(self):
        self._states, self._entities, self._areas, self._floors = {}, {}, {}, {}
        self.now = NOON

    def set(self, eid, state="idle", **attrs):
        old = self._states.get(eid)
        base = dict(old.attributes) if old else {}
        base.update(attrs)
        self._states[eid] = State(eid, state, base)

    def group(self, leader, others):
        gm = [leader] + [m for m in others if m != leader]
        for m in gm:
            self.set(m, self.state(m).state, group_members=gm)

    def state(self, eid):
        return self._states.get(eid)

    def states(self, domain=None):
        return [s for s in self._states.values() if domain is None or s.domain == domain]

    def entity(self, eid):
        return self._entities.get(eid)

    def entities(self, domain=None):
        return list(self._entities.values())

    def device(self, _):
        return None

    def device_entities(self, _):
        return []

    def area_ids(self):
        return set(self._areas)

    def area_name(self, a):
        return self._areas.get(a, (None,))[0]

    def area_floor(self, a):
        got = self._areas.get(a)
        return self._floors.get(got[1]) if got else None

    def local_time(self, when=None):
        return (when or self.now).replace(tzinfo=None)

    async def call_service(self, *a, **kw):
        raise AssertionError("the Intercom's rules never call a service")


def ma_player(pid, name, kind="player", members=(), synced_to=None):
    return {"player_id": pid, "display_name": name, "type": kind, "group_members": list(members),
            "synced_to": synced_to}


def ma_list(**over):
    """Music Assistant's players/all, nobody grouped unless ``over`` says so: {pid: (members, synced_to)}."""
    base = [ma_player(p, p) for p in ("ap_k", "ap_off", "ap_gr", "ap_lr", "ap_den", "ap_play", "ap_sl", "ap_sr",
                                      "ap_st1", "ap_st2")]
    base.append(ma_player("sg_study", "Study", "group", ["ap_st1", "ap_st2"]))
    for p in base:
        if p["player_id"] in over:
            p["group_members"], p["synced_to"] = over[p["player_id"]]
    return base


@pytest.fixture
def house():
    h = FakeHouse()
    for r in ROOMS + [SR]:
        h.set(r, "idle", group_members=[], friendly_name=r.split(".")[1].replace("_", " ").title())
    h._floors = {"down": Floor("down", "Downstairs", 0), "up": Floor("up", "Upstairs", 1)}
    h._areas = {"kitchen": ("Kitchen", "down"), "living": ("Living Room", "down"), "office": ("Office", "up"),
                "guest": ("Guest Room", "up")}
    h._entities = {K: Entity(K, area_id="kitchen"), LR: Entity(LR, area_id="living"),
                   OFF: Entity(OFF, area_id="office"), GR: Entity(GR, area_id="guest")}
    return h


@pytest.fixture
def music(house):
    opts = {CONF_SPEAKERS: list(ROOMS), CONF_VOLUME: 0.3, CONF_PAIRS: [{"players": [SL, SR], "name": "Loft"}]}
    items = [Item(SUB_PRESET, "p_down", "Downstairs Rooms", {"name": "Downstairs Rooms", "members": [K, LR]})]
    groups = G.Groups.read(ma_list(), PIDS)
    return MusicConfig.build(house, opts, items, groups=groups)


def doc(**rooms):
    """The Intercom on with every room on (or as ``rooms`` says) and quiet hours off unless a test turns them on."""
    body = {"enabled": True, "quiet_default": {"schedule": False}, "rooms": {r: {"enabled": True} for r in ROOMS}}
    for r, v in rooms.items():
        body["rooms"][f"media_player.{r}"] = {"enabled": True, **v}
    return C.check(body)


def decide(house, music, d, picked, mode="message", ma=None, **kw):
    return R.decide(house, music, d, picked, mode=mode, ma_raw=ma_list() if ma is None else ma, pids=PIDS,
                    now=house.now, **kw)


def states(plan):
    return {r["room"]: (r["state"], r["why"]) for r in plan.rooms}


def called(plan):
    return sorted(c.player for c in plan.calls)


# ---------------------------------------------------------------- the settings
def test_the_defaults_are_off_message_and_no_rooms():
    d = C.check(None)
    assert d["enabled"] is False and d["live_allowed"] is False and d["default_mode"] == "message"
    assert (d["max_live_s"], d["max_message_s"]) == (60, 30) and d["chime"] == {"message": True, "live": False}
    assert d["quiet_default"]["from"] == "21:00" and d["quiet_default"]["to"] == "07:00" and d["rooms"] == {}
    assert C.room(d, K)["enabled"] is False, "a new room is off (decision 7)"


@pytest.mark.parametrize("field,value", [("max_live_s", 14), ("max_live_s", 121), ("max_message_s", 9),
                                         ("max_message_s", 61), ("default_mode", "shout"), ("enabled", "yes"),
                                         ("max_volume", 0), ("stream_base", "http://203.0.113.9:8767")])
def test_out_of_range_is_refused(field, value):
    with pytest.raises(ValueError):
        C.check({field: value})


@pytest.mark.parametrize("url,ok", [
    ("http://10.0.0.5:8767", True), ("http://192.168.1.20:8767/", True), ("https://mantel.local:8767", True),
    ("http://mantel.home.arpa:8101", True), ("http://mantel.lan:8767", True), ("http://[fd00::5]:8767", True),
    ("http://10.0.0.5", False), ("ftp://10.0.0.5:8767", False), ("http://127.0.0.1:8767", False),
    ("http://mantel.example.com:8767", False), ("http://8.8.8.8:8767", False), ("http://10.0.0.5:8767/x", False),
    ("http://u:p@10.0.0.5:8767", False), ("http://10.0.0.5:8767?a=1", False), ("http://169.254.1.1:8767", False),
    ("", False), (None, False)])
def test_the_address_music_assistant_fetches_from_is_private(url, ok):
    assert (C.base_problem(url) is None) is ok


def test_live_is_never_the_default_unless_allowed():
    assert C.check({"default_mode": "live"})["default_mode"] == "message"
    assert C.check({"default_mode": "live", "live_allowed": True})["default_mode"] == "live"


def test_merge_changes_only_house_fields_and_rooms_one_at_a_time():
    d = C.merge(C.check(None), {"enabled": True, "chime": {"live": True}})
    assert d["enabled"] and d["chime"] == {"message": True, "live": True}
    with pytest.raises(ValueError):
        C.merge(d, {"rooms": {}})
    d = C.merge_room(d, K, {"enabled": True, "volume": 90, "listeners": ["tab_kitchen"]})
    assert C.room(d, K)["enabled"] and C.volume_of(d, K) == 70, "capped by the house's highest volume"
    assert C.listeners_of(d, [K]) == {"tab_kitchen"} and C.rooms_of_tablet(d, "tab_kitchen") == [K]
    with pytest.raises(ValueError):
        C.merge_room(d, K, {"demoted": False})       # only Try Live Again clears it


def test_live_is_demoted_after_three_failures_in_a_row_and_reset():
    d = C.merge_room(C.check(None), K, {"enabled": True})
    d = C.live_result(C.live_result(d, K, False), K, False)
    assert not C.room(d, K)["demoted"]
    d = C.live_result(C.live_result(d, K, True), K, False)
    assert C.room(d, K)["live_fails"] == 1, "a success clears the count"
    for _ in range(2):
        d = C.live_result(d, K, False)
    assert C.room(d, K)["demoted"]
    d = C.merge_room(d, K, {"reset_live": True})
    assert not C.room(d, K)["demoted"] and C.room(d, K)["live_fails"] == 0


def test_limits():
    d = C.check({"max_live_s": 90, "max_message_s": 20})
    assert C.limit_s(d, "live") == 90 and C.limit_s(d, "message") == 20


# ---------------------------------------------------------------- every skip, in order
def test_a_room_not_enabled_or_not_allowed_is_dropped_silently(house, music):
    d = doc(office={"enabled": False})
    p = decide(house, music, d, [K, OFF, GR], allowed=lambda r: r != GR)
    assert [r["room"] for r in p.rooms] == [K] and called(p) == [K]


def test_unavailable_is_skipped(house, music):
    house.set(OFF, "unavailable")
    p = decide(house, music, doc(), [K, OFF])
    assert states(p)[OFF] == ("skipped", "unavailable") and called(p) == [K]


def test_a_room_music_assistant_has_no_player_for_is_skipped(house, music):
    p = R.decide(house, music, doc(), [K, OFF], mode="message", ma_raw=ma_list(), pids={K: "ap_k"}, now=NOON)
    assert states(p)[OFF] == ("skipped", "unavailable") and called(p) == [K]


@pytest.mark.parametrize("now,quiet", [(NOON, False), (NIGHT, True), (EARLY, True)])
def test_quiet_hours_wrap_midnight(house, music, now, quiet):
    house.now = now
    d = C.merge(doc(), {"quiet_default": {"schedule": True, "from": "21:00", "to": "07:00"}})
    p = decide(house, music, d, [K])
    assert (states(p)[K] == ("skipped", "quiet")) is quiet


def test_a_rooms_own_quiet_hours_and_while(house, music):
    house.set("input_boolean.nap", "on")
    d = doc(playroom={"quiet": {"schedule": False, "while": ["input_boolean.nap"]}})
    p = decide(house, music, d, [K, PLAY])
    assert states(p)[PLAY] == ("skipped", "quiet") and states(p)[K] == ("ok", None)


def test_send_anyway_overrides_quiet_hours_only(house, music):
    house.now = NIGHT
    house.set(OFF, "unavailable")
    d = C.merge(doc(), {"quiet_default": {"schedule": True, "from": "21:00", "to": "07:00"}})
    p = decide(house, music, d, [K, OFF], override=True)
    assert states(p)[K] == ("ok", None) and states(p)[OFF] == ("skipped", "unavailable")


def test_echo_live_leaves_out_your_room_message_keeps_it(house, music):
    assert states(decide(house, music, doc(), [K, OFF], mode="live", here=[K]))[K] == ("skipped", "here")
    assert states(decide(house, music, doc(), [K, OFF], mode="message", here=[K]))[K] == ("ok", None)


def test_nothing_left_says_why(house, music):
    house.set(K, "unavailable")
    p = decide(house, music, doc(), [K])
    assert not p.calls and p.nothing_reason().startswith("Nothing to send to: Kitchen")
    assert R.Plan().nothing_reason() == "Nothing to send to: pick a room."


# ---------------------------------------------------------------- THE GROUP CHECK
def test_a_leader_whose_members_are_all_in_plays_once_for_them(house, music):
    house.group(K, [LR])
    p = decide(house, music, doc(), [K, LR])
    assert called(p) == [K], "the leader's one call plays its group in step; the member gets no second call"
    assert p.calls[0].covers == [LR] and states(p) == {K: ("ok", None), LR: ("ok", None)}


def test_a_leader_whose_members_are_partly_in_is_skipped(house, music):
    house.group(K, [LR, OFF])
    p = decide(house, music, doc(), [K, LR])
    assert states(p)[K] == ("skipped", "leads") and "Office" in p.rooms[0]["reason"]
    assert called(p) == [LR], "the member alone is fine: Music Assistant announces to it alone"


def test_a_leader_whose_members_are_none_in_is_skipped(house, music):
    house.group(K, [LR, OFF])
    p = decide(house, music, doc(), [K])
    assert states(p)[K] == ("skipped", "leads") and not p.calls
    assert p.rooms[0]["reason"] == "Kitchen leads Living Room, Office; skipped"


def test_a_member_of_a_group_is_sent_to_alone(house, music):
    house.group(K, [LR, OFF])
    p = decide(house, music, doc(), [OFF])
    assert states(p)[OFF] == ("ok", None) and called(p) == [OFF]


def test_music_assistant_says_leader_when_home_assistant_says_alone(house, music):
    """Home Assistant's state is stale: Music Assistant's own player list is believed (the stricter wins)."""
    ma = ma_list(ap_k=(["ap_k", "ap_den"], None), ap_den=(["ap_k", "ap_den"], "ap_k"))
    p = decide(house, music, doc(), [K], ma=ma)
    assert states(p)[K] == ("skipped", "leads") and "Den" in p.rooms[0]["reason"] and not p.calls


def test_music_assistant_names_a_follower_only_by_synced_to(house, music):
    ma = ma_list(ap_play=([], "ap_gr"))
    p = decide(house, music, doc(), [GR], ma=ma)
    assert states(p)[GR] == ("skipped", "leads") and not p.calls


def test_home_assistant_says_leader_when_music_assistant_says_alone(house, music):
    house.group(K, [OFF])
    p = decide(house, music, doc(), [K], ma=ma_list())
    assert states(p)[K] == ("skipped", "leads")


def test_the_two_sources_disagreeing_on_members_union_wins(house, music):
    house.group(K, [LR])
    ma = ma_list(ap_k=(["ap_k", "ap_lr", "ap_den"], None))
    p = decide(house, music, doc(), [K, LR], ma=ma)
    assert states(p)[K] == ("skipped", "leads") and "Den" in p.rooms[0]["reason"]
    assert called(p) == [LR]
    p = decide(house, music, doc(), [K, LR, DEN], ma=ma)
    assert called(p) == [K], "all of both sources' members in: the leader covers them"


def test_a_leader_grouped_with_a_player_that_is_no_room_is_skipped(house, music):
    ma = ma_list(ap_k=(["ap_k", "ap_unknown"], None))
    p = decide(house, music, doc(), [K], ma=ma)
    assert states(p)[K] == ("skipped", "leads") and not p.calls


def test_an_unreadable_player_list_skips_every_room(house, music):
    p = R.decide(house, music, doc(), [K, OFF], mode="message", ma_raw=None, pids=PIDS, now=NOON)
    assert not p.calls and all(r["why"] == "unavailable" for r in p.rooms)
    assert "could not be read" in p.rooms[0]["reason"]


def test_a_member_skipped_for_quiet_hours_makes_its_leader_skip_too(house, music):
    """Announcing to the leader would play in the quiet member's room."""
    house.group(K, [PLAY])
    d = doc(playroom={"quiet": {"schedule": True, "from": "11:00", "to": "13:00"}})
    p = decide(house, music, d, [K, PLAY])
    assert states(p)[PLAY] == ("skipped", "quiet") and states(p)[K] == ("skipped", "leads") and not p.calls


def test_a_member_left_out_as_here_in_live_makes_its_leader_skip(house, music):
    house.group(K, [LR])
    p = decide(house, music, doc(), [K, LR], mode="live", here=[LR])
    assert states(p)[K] == ("skipped", "leads") and not p.calls


def test_a_stereo_pair_announces_through_its_group_player(house, music):
    p = decide(house, music, doc(), [STEREO])
    assert called(p) == [STEREO] and states(p)[STEREO] == ("ok", None)


def test_a_virtual_pair_announces_on_both_of_its_players(house, music):
    p = decide(house, music, doc(), [SL])
    assert called(p) == [SL, SR] and [r["name"] for r in p.rooms] == ["Loft"]


def test_a_virtual_pairs_second_player_leading_others_skips_the_pair(house, music):
    ma = ma_list(ap_sr=(["ap_sr", "ap_off"], None))
    p = decide(house, music, doc(), [SL], ma=ma)
    assert states(p)[SL] == ("skipped", "leads") and not p.calls


def test_a_virtual_pair_with_a_partner_music_assistant_lacks_is_unavailable(house, music):
    pids = {k: v for k, v in PIDS.items() if k != SR}
    p = R.decide(house, music, doc(), [SL], mode="message", ma_raw=ma_list(), pids=pids, now=NOON)
    assert states(p)[SL] == ("skipped", "unavailable")


def test_whole_house_with_one_group_inside_plays_once_per_player(house, music):
    house.group(K, [LR, OFF])
    p = decide(house, music, doc(), list(ROOMS))
    assert K in called(p) and LR not in called(p) and OFF not in called(p)
    assert sorted(called(p)) == sorted([K, GR, DEN, PLAY, STEREO, SL, SR])


# ---------------------------------------------------------------- Live: live or after, per room
def test_live_is_live_only_on_idle_live_capable_rooms(house, music):
    house.set(OFF, "playing")
    house.set(GR, "paused")
    d = doc(den={"live": False}, playroom={"demoted": True})
    p = decide(house, music, d, [K, OFF, GR, DEN, PLAY], mode="live")
    st = {r["room"]: (r["state"], r["live"]) for r in p.rooms}
    assert st == {K: ("ok", True), OFF: ("after", False), GR: ("after", False), DEN: ("after", False),
                  PLAY: ("after", False)}
    assert {c.player: c.live for c in p.calls} == {K: True, OFF: False, GR: False, DEN: False, PLAY: False}


def test_a_group_in_live_plays_after_you_finish(house, music):
    house.group(K, [LR])
    p = decide(house, music, doc(), [K, LR], mode="live")
    assert all(r["state"] == "after" for r in p.rooms) and not any(c.live for c in p.calls)


def test_message_mode_is_never_after(house, music):
    house.set(OFF, "playing")
    assert states(decide(house, music, doc(), [OFF]))[OFF] == ("ok", None)


def test_volume_per_room_capped(house, music):
    d = C.merge(doc(kitchen={"volume": 40}, office={"volume": 95}), {"max_volume": 50})
    p = decide(house, music, d, [K, OFF, GR])
    assert {c.player: c.volume for c in p.calls} == {K: 40, OFF: 50, GR: None}


# ---------------------------------------------------------------- the feed and the page's picks
def test_the_feed_lists_reachable_rooms_alone(house, music):
    house.group(K, [LR])
    house.set(OFF, "playing")
    got = {r["room"]: r for r in R.feed_rooms(house, music, doc(guest_room={"enabled": False}),
                                              allowed=lambda r: r != DEN, ma_raw=ma_list(), pids=PIDS, now=NOON)}
    assert GR not in got and DEN not in got
    assert got[K]["why"] == "leads" and got[OFF]["state"] == "ok" and got[OFF]["live"] is False
    assert got[K]["floor"] == "Downstairs"


def test_expand_floors_presets_and_whole_house(music):
    assert R.expand(music, ["all"]) == music.room_ids
    assert R.expand(music, ["preset:p_down"]) == [K, LR]
    assert R.expand(music, ["floor:upstairs"]) == [OFF, GR]
    assert R.expand(music, ["media_player.nowhere", K, K]) == [K]


# ---------------------------------------------------------------- THE GROUP CHECK: what Music Assistant 2.10.9 really does
# (announcements.py ``_run_announcement``: a player whose type is "group" is announced to on every one of its
# ``group_members``, either forwarded to each member or through its own stream; providers/airplay/announce.py
# ``_live_members``: a member that is an ad-hoc leader, announced to, covers its whole session)
DOWN = "media_player.downstairs_group"        # a Music Assistant sync group player set up as a speaker of its own


def _with_down_group(house, ma):
    """The music config with a sync group of the Kitchen and the Living Room made a room of its own."""
    house.set(DOWN, "idle", group_members=[], friendly_name="Downstairs Group")
    pids = {**PIDS, DOWN: "sg_down"}
    ma = ma + [ma_player("sg_down", "Downstairs Group", "group", ["ap_k", "ap_lr"])]
    opts = {CONF_SPEAKERS: list(ROOMS) + [DOWN], CONF_VOLUME: 0.3,
            CONF_PAIRS: [{"players": [SL, SR], "name": "Loft"}]}
    music = MusicConfig.build(house, opts, [], groups=G.Groups.read(ma, pids))
    d = C.merge_room(doc(), DOWN, {"enabled": True})
    return music, d, ma, pids


def test_a_group_player_room_that_holds_other_rooms_needs_them_all(house):
    """Announcing to a sync group player plays on its members: rooms the broadcast left out must not hear it."""
    music, d, ma, pids = _with_down_group(house, ma_list())
    p = R.decide(house, music, d, [DOWN], mode="message", ma_raw=ma, pids=pids, now=NOON)
    assert states(p)[DOWN] == ("skipped", "leads") and not p.calls
    assert "Kitchen" in p.rooms[0]["reason"] and "Living Room" in p.rooms[0]["reason"]
    d = C.merge_room(d, K, {"quiet": {"schedule": True, "from": "11:00", "to": "13:00"}})
    p = R.decide(house, music, d, [DOWN, K, LR], mode="message", ma_raw=ma, pids=pids, now=NOON)
    assert states(p)[K] == ("skipped", "quiet") and states(p)[DOWN] == ("skipped", "leads")
    assert sorted(c.player for c in p.calls) == [LR]


def test_a_group_player_room_with_all_its_rooms_in_plays_once(house):
    music, d, ma, pids = _with_down_group(house, ma_list())
    p = R.decide(house, music, d, [DOWN, K, LR], mode="message", ma_raw=ma, pids=pids, now=NOON)
    assert [c.player for c in p.calls] == [DOWN], "the group's one call plays its members; they get no second"


def test_a_room_inside_a_group_player_room_left_out_still_plays_alone(house):
    """Not over-strict: a member announced to alone plays alone, whatever group player lists it."""
    music, d, ma, pids = _with_down_group(house, ma_list())
    d = C.merge_room(d, DOWN, {"quiet": {"schedule": True, "from": "11:00", "to": "13:00"}})
    p = R.decide(house, music, d, [K, DOWN], mode="message", ma_raw=ma, pids=pids, now=NOON)
    assert states(p)[DOWN] == ("skipped", "quiet") and [c.player for c in p.calls] == [K]


def test_a_stereo_pairs_part_leading_an_ad_hoc_group_skips_the_pair(house, music):
    """The pair's group player forwards to its parts; a part that leads an ad-hoc session plays on all of it."""
    ma = ma_list(ap_st1=(["ap_st1", "ap_k"], None), ap_k=([], "ap_st1"))
    p = decide(house, music, doc(), [STEREO], ma=ma)
    assert states(p)[STEREO] == ("skipped", "leads") and "Kitchen" in p.rooms[0]["reason"] and not p.calls
    ma = ma_list(ap_k=([], "ap_st2"))              # said only the other way round (the follower's synced_to)
    assert states(decide(house, music, doc(), [STEREO], ma=ma))[STEREO] == ("skipped", "leads")


def test_a_player_music_assistant_does_not_list_is_skipped(house, music):
    """Its group can't be read from Music Assistant, so nothing is guessed."""
    ma = [p for p in ma_list() if p["player_id"] != "ap_off"]
    p = decide(house, music, doc(), [K, OFF], ma=ma)
    assert states(p)[OFF] == ("skipped", "unavailable") and called(p) == [K]


def test_a_leader_music_assistant_lists_out_of_order_is_still_a_leader(house, music):
    ma = ma_list(ap_k=(["ap_den", "ap_k"], None))
    p = decide(house, music, doc(), [K], ma=ma)
    assert states(p)[K] == ("skipped", "leads") and not p.calls


def test_a_leader_only_its_members_home_assistant_states_name_is_a_leader(house, music):
    """Home Assistant's leader state is stale but a member's still names it first."""
    house.set(LR, "idle", group_members=[K, LR])
    p = decide(house, music, doc(), [K])
    assert states(p)[K] == ("skipped", "leads") and not p.calls


def test_two_entities_for_one_music_assistant_player_both_need_to_be_in(house, music):
    """The Den's entity names the Kitchen's player: calling it plays in the Den, which is quiet."""
    pids = {**PIDS, DEN: "ap_k"}
    d = doc(den={"quiet": {"schedule": True, "from": "11:00", "to": "13:00"}})
    p = R.decide(house, music, d, [K, DEN], mode="message", ma_raw=ma_list(), pids=pids, now=NOON)
    assert states(p)[DEN] == ("skipped", "quiet") and states(p)[K][0] == "skipped" and not p.calls


def test_the_two_sources_naming_different_leaders_send_one_call(house, music):
    """Home Assistant says the Kitchen leads, Music Assistant says the Living Room does: both are in, so one call
    plays both (never none, never two)."""
    house.group(K, [LR])
    ma = ma_list(ap_lr=(["ap_lr", "ap_k"], None), ap_k=([], "ap_lr"))
    p = decide(house, music, doc(), [K, LR], ma=ma)
    assert len(p.calls) == 1 and states(p) == {K: ("ok", None), LR: ("ok", None)}
