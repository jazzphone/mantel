"""One way to pick a speaker (2026-11-10, the owner: the Living Room HomeView's Now Playing followed an Apple TV -- its song
from the room's music, its time and volume from the TV, which said none). Now Playing's speaker and Show When's Music Is
Playing name one of the house's music rooms or groups (Mantel Settings -> Music, hkMusic's speakers) or Tablet's Room, the
room the tablet's music calls home. In node: what Music Is Playing watches for each (a pair's two players, a group's rooms,
the tablet's room, nothing on a page that is no tablet's, an older layout's TV as before), what Now Playing follows (the
music in that room or group, every part from one player), the editor's list. In Python: what a saved layout and the
assistant may write, and that a rule watching Tablet's Room or a group reaches every viewer."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from hk_core.settings import home_grid as HG

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node") or "/opt/homebrew/bin/node"
needs_node = pytest.mark.skipif(not Path(NODE).exists(), reason="no node")

# the house's shape: a pair room (Living Room), two rooms, a group of two; this tablet's home is the Living Room
SCRIPT = r"""
const fs = require('fs');
globalThis.window = globalThis;
const SPEAKERS = [
  { name: 'Downstairs', entity: 'preset:down', members: ['media_player.kitchen', 'media_player.living_left'] },
  { name: 'Living Room HomePods', entity: 'media_player.living_left', parts: ['media_player.living_left', 'media_player.living_right'] },
  { name: 'Kitchen', entity: 'media_player.kitchen' },
  { name: "Office", entity: 'media_player.office' }];
let HOME = 'media_player.living_left';
const by = {}; SPEAKERS.forEach((s) => { by[s.entity] = s; });
const partOf = { 'media_player.living_right': 'media_player.living_left' };
window.hkMusic = {
  speakers: () => SPEAKERS.slice(), home: () => HOME,
  fold: (l) => l.map((e) => partOf[e] || e).filter((e, i, a) => a.indexOf(e) === i),
  leader: (l) => l[0] || null, label: (c) => by[c.leader] ? by[c.leader].name + (c.members.length > 1 ? ' +' + (c.members.length - 1) : '') : c.key,
  // (hk-base.js contexts: each playing room, a join as one keyed by its leader)
  contexts: (client) => {
    const out = [], seen = {};
    SPEAKERS.filter((s) => !s.members).forEach((r) => {
      const st = client.states[r.entity];
      if (seen[r.entity] || !st || (st.state !== 'playing' && st.state !== 'paused')) return;
      const gm = window.hkMusic.fold((st.attributes || {}).group_members || []).filter((e) => by[e] && !by[e].members);
      const members = gm.length > 1 ? gm : [r.entity];
      members.forEach((m) => { seen[m] = 1; });
      out.push({ key: members[0], leader: members[0], members, playing: st.state === 'playing' });
    });
    return out;
  },
  resolve: () => ({ player: 'AUTOMATIC', context: null, reason: 'home', name: '' })
};
(0, eval)(fs.readFileSync(process.argv[2], 'utf8'));
const G = window.hkGridCatalog;
const play = (ids, group) => Object.fromEntries(ids.map((e) => [e, { state: 'playing', attributes: group ? { group_members: group } : {} }]));
const music = (entity) => ({ kind: 'music_playing', entity });
const out = {};
// MUSIC IS PLAYING
out.watch = {
  tabletRight: G.matches(music('tablet_room'), play(['media_player.living_right'])),
  tabletLeft: G.matches(music('tablet_room'), play(['media_player.living_left'])),
  tabletElsewhere: G.matches(music('tablet_room'), play(['media_player.kitchen', 'media_player.office'])),
  roomByRight: G.matches(music('media_player.living_left'), play(['media_player.living_right'])),
  group: G.matches(music('preset:down'), play(['media_player.kitchen'])),
  groupQuiet: G.matches(music('preset:down'), play(['media_player.office'])),
  tv: G.matches(music('media_player.apple_tv'), play(['media_player.apple_tv'])),
  any: G.matches(music(undefined), play(['media_player.office']), false, null, undefined, ['media_player.office']),
};
out.players = { tablet: G.musicPlayers('tablet_room'), group: G.musicPlayers('preset:down'), tv: G.musicPlayers('media_player.apple_tv') };
// the house's rule, first match wins and the default comes back
const item = { id: 'b2', card: 'music', size: 'L', at: [0, 1], rules: [{ when: { all: [music('tablet_room')] }, card: 'now_playing' }] };
out.choose = [G.choose(item, play(['media_player.kitchen'])), G.choose(item, play(['media_player.living_right'])), G.choose(item, {})];
HOME = null;
out.noTablet = G.matches(music('tablet_room'), play(['media_player.living_left']));
HOME = 'media_player.living_left';
// NOW PLAYING FOLLOWS: the context holding the room, the room ready, a group's leader, Automatic
const joined = play(['media_player.office', 'media_player.kitchen', 'media_player.living_left', 'media_player.living_right'],
  ['media_player.office', 'media_player.kitchen', 'media_player.living_left', 'media_player.living_right']);
const at = (k, states) => { const r = G.musicAt({ states }, k); return [r.player, r.reason, r.context ? r.context.members.length : 0, r.name]; };
out.at = {
  roomInJoin: at('media_player.kitchen', joined), rightInJoin: at('media_player.living_right', joined),
  roomIdle: at('media_player.kitchen', {}), groupIdle: at('preset:down', {}),
  groupPlaying: at('preset:down', play(['media_player.living_left'])),
  tv: at('media_player.apple_tv', joined), none: at(undefined, joined)
};
// THE CARD: Now Playing and both its controls name the one speaker; none, the screen's music
const np = (o) => G.config({ id: 'np', card: 'now_playing', size: 'L', at: [0, 0], opts: o || {} });
const a = np({ speaker: 'media_player.kitchen' }), b = np({}), c = np({ speaker: 'tablet_room' });
out.card = { at: a.music_at, entity: a.entity || null, sub: a.sub_card.entity_from, meta: a.meta_card.entity_from, subEntity: a.sub_card.entity || null,
             autoAt: b.music_at || null, autoSub: b.sub_card.entity_from, tabletAt: c.music_at || null };
out.choices = G.speakerChoices(SPEAKERS);
console.log(JSON.stringify(out));
"""


@pytest.fixture(scope="module")
def got(tmp_path_factory) -> dict:
    if not Path(NODE).exists():
        pytest.skip("no node")
    js = tmp_path_factory.mktemp("sp") / "run.cjs"
    js.write_text(SCRIPT)
    r = subprocess.run([NODE, str(js), str(ROOT / "web/hk/cards/hk-grid-catalog.js")], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


@needs_node
def test_music_is_playing_watches_the_tablets_room_a_room_and_a_group(got):
    w = got["watch"]
    # the Living Room is a pair: either HomePod playing is the room playing
    assert w["tabletRight"] and w["tabletLeft"] and w["roomByRight"]
    # ...and music elsewhere is not the tablet's room
    assert not w["tabletElsewhere"]
    # a group: any of its rooms
    assert w["group"] and not w["groupQuiet"]
    # an older layout's TV reads as it always did; none chosen is any music speaker
    assert w["tv"] and w["any"]
    assert got["players"] == {"tablet": ["media_player.living_left", "media_player.living_right"],
                              "group": ["media_player.kitchen", "media_player.living_left", "media_player.living_right"],
                              "tv": None}
    # a page that is no tablet's has no Tablet's Room: the rule never holds there
    assert got["noTablet"] is False


@needs_node
def test_the_houses_rule_shows_now_playing_only_for_the_tablets_room(got):
    # Kitchen alone: the Music block; the Living Room: Now Playing; nothing: the Music block again
    assert got["choose"] == [-1, 0, -1]


@needs_node
def test_now_playing_follows_the_music_in_its_room_or_group(got):
    a = got["at"]
    # a room joined into Office's group: the group (three rooms: the pair is one), led by Office -- song, time and volume from one player
    assert a["roomInJoin"][:3] == ["media_player.office", "chosen", 3]
    # a pair's second HomePod is its room
    assert a["rightInJoin"][:3] == ["media_player.office", "chosen", 3]
    # nothing playing there: the room, ready; a group's leader
    assert a["roomIdle"] == ["media_player.kitchen", "chosen", 0, "Kitchen"]
    assert a["groupIdle"] == ["media_player.kitchen", "chosen", 0, "Downstairs"]
    assert a["groupPlaying"][:3] == ["media_player.living_left", "chosen", 1]
    # no speaker, or one that is no music speaker (the Apple TV): the screen's own music
    assert a["tv"][0] == "AUTOMATIC" and a["none"][0] == "AUTOMATIC"


@needs_node
def test_now_playing_and_both_its_controls_name_the_one_speaker(got):
    c = got["card"]
    assert c["at"] == "media_player.kitchen" and c["entity"] is None and c["subEntity"] is None
    assert c["sub"] == c["meta"] == {"music": True, "music_at": "media_player.kitchen"}
    # Automatic, and Tablet's Room (the screen's music is the tablet's room's first): the screen's music
    assert c["autoAt"] is None and c["autoSub"] == {"music": True} and c["tabletAt"] is None


@needs_node
def test_the_editor_lists_music_rooms_and_groups_never_a_tv(got):
    assert got["choices"] == [["tablet_room", "Tablet’s Room"], ["preset:down", "Downstairs (Group)"],
                              ["media_player.living_left", "Living Room HomePods"], ["media_player.kitchen", "Kitchen"],
                              ["media_player.office", "Office"]]


def _rule(entity) -> dict:
    return {"when": {"all": [{"kind": "music_playing", "entity": entity}]}, "card": "now_playing"}


def test_a_layout_takes_tablets_room_and_groups_and_refuses_the_rest():
    for e in ("tablet_room", "preset:7f8402ca994cd83990a9adb677", "media_player.kitchen_homepod"):
        assert HG.rules([_rule(e)], "L")[0]["when"]["all"][0]["entity"] == e
    for bad in ("tablet room", "preset:", "kitchen"):
        with pytest.raises(HG.GridInvalid):
            HG.rules([_rule(bad)], "L")
    # Tablet's Room and a group watch music only: another condition still names an entity
    with pytest.raises(HG.GridInvalid):
        HG.condition({"kind": "entity_state", "entity": "tablet_room", "state": "on"})
    # Now Playing's speaker: a room, a group, Tablet's Room
    for v in ("media_player.kitchen_homepod", "preset:abc", "tablet_room"):
        assert HG.OPTION_KINDS["speaker"](v) == v
    with pytest.raises(HG.GridInvalid):
        HG.OPTION_KINDS["speaker"]("camera")


def test_a_rule_watching_tablets_room_or_a_group_reaches_every_viewer():
    grid = {"v": 1, "cols": 4, "rows": 4, "items": [
        {"id": "b2", "card": "music", "size": "L", "at": [0, 0],
         "rules": [_rule("tablet_room"), _rule("preset:abc"), _rule("media_player.kitchen_homepod")]}]}
    # they are no entity a viewer may lack (the Kitchen's HomePod is, and goes for someone who may not see it)
    assert HG.entity_ids(grid) == {"media_player.kitchen_homepod"}
    cut = HG.only_viewable(grid, set())
    assert [r["when"]["all"][0]["entity"] for r in cut["items"][0]["rules"]] == ["tablet_room", "preset:abc"]
