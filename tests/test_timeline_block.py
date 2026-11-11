"""The Home Grid block "Recent" and the camera sheet's strip (web/hk/cards/hk-timeline-block.js, docs/phase19/
HOUSE-TIMELINE.md "The views"): the pure part run in node beside the page's own (window.hkTimeline.lib) -- Automatic's
switch from the morning summary to the rows at 11 AM, how many rows each size holds, the row as the block draws it
(who only when the server said so, the day of an older row, the picture), the digest's lines, the strip's words -- and
how the block is wired: the catalog's entry (Mantel's own: a stand-in where the host has no Timeline), the Python
mirror's option, the lazy file, the editors. The browser half is tools/headless/timeline_block_check.py."""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

import web_sources

from hk_core.settings import changes as C
from hk_core.settings import home_grid as HG

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node") or "/opt/homebrew/bin/node"
needs_node = pytest.mark.skipif(not Path(NODE).exists(), reason="no node")

SCRIPT = r"""
const fs = require('fs');
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
(0, eval)(fs.readFileSync(process.argv[2], 'utf8'));         // the page's: hk-timeline.js
(0, eval)(fs.readFileSync(process.argv[3], 'utf8'));         // the block's
const B = window.hkTimelineBlock.lib;
const ctx = { tag: 'en-US', zone: 'America/Chicago' };
const ms = (iso) => new Date(iso).getTime();
const out = {};
// Tuesday, November 3, 2026, 3:30 PM at the house (CST, UTC-6)
const NOW = ms('2026-11-03T21:30:00Z');
const ev = (id, iso, extra) => Object.assign({ id, at: ms(iso) / 1000, family: 'lock', kind: 'locked', title: 'Back Door locked', level: 'info', entity: 'lock.back_door', area_name: 'Kitchen', pics: [] }, extra || {});

// ---- Automatic: the summary from 5 to 11 AM at the house, the rows after
const hours = ['2026-11-03T10:59:00Z' /* 4:59 AM */, '2026-11-03T11:00:00Z' /* 5:00 */, '2026-11-03T13:00:00Z' /* 7:00 */, '2026-11-03T16:59:00Z' /* 10:59 */,
               '2026-11-03T17:00:00Z' /* 11:00 */, '2026-11-03T21:30:00Z', '2026-11-04T05:30:00Z' /* 11:30 PM */];
out.auto = hours.map(h => B.viewNow('auto', ms(h), ctx));
out.explicit = [B.viewNow('latest', ms(hours[2]), ctx), B.viewNow('digest', ms(hours[5]), ctx), B.viewNow(undefined, ms(hours[2]), ctx), B.viewNow('nonsense', ms(hours[5]), ctx)];
out.show = [B.showOf('latest'), B.showOf('digest'), B.showOf('auto'), B.showOf(null), B.showOf('x')];
// the zone decides, not the browser's: 5 AM in Chicago is 11 AM in UTC
out.autoUtc = [B.viewNow('auto', ms('2026-11-03T11:00:00Z'), { tag: 'en-US', zone: 'UTC' }), B.viewNow('auto', ms('2026-11-03T11:00:00Z'), ctx)];

// ---- how many rows: Small reads one, the rest READ (what is not shown is "N more"); rows keep their size's height
out.limit = ['W', 'T', 'L', 'XL', 'S', undefined].map(B.limitOf);
out.rowH = B.ROW_H;
out.fit = [B.rowsFit(17, 133, 44), B.rowsFit(17, 95, 44), B.rowsFit(2, 342, 56), B.rowsFit(5, 0, 56), B.rowsFit(5, undefined, 56)];
out.grid = [B.fitGrid(5, 369, 276, 108, 76, 10), B.fitGrid(4, 175, 133, 80, 44, 10), B.fitGrid(9, 280, 276, 108, 76, 10), B.fitGrid(1, 50, 20, 108, 76, 10)];
out.paths = [B.blockPath('W'), B.blockPath('L'), B.blockPath('XL'), B.stripPath('camera.front_door'), B.stripPath('camera.a b'), B.stripMessage('camera.front_door')];

// ---- a row as the block draws it
const emma = { name: 'Emma', device: 'Hallway tablet', how: 'tablet', mine: true };
const pic = [{ id: 'a'.repeat(32), at: 5, url: '/api/timeline/pic/' + 'a'.repeat(32) }, { id: 'b'.repeat(32), at: 9, url: '/api/timeline/pic/' + 'b'.repeat(32) }];
const rv = (e) => { const r = B.rowView(e, NOW, ctx); return [r.title, r.time, r.day, r.sub, r.thumb, r.thumbs, r.icon, r.color, r.warn]; };
out.rows = [
  rv(ev(1, '2026-11-03T20:47:00Z', { who: emma })),                                              // with a name
  rv(ev(2, '2026-11-03T20:47:00Z')),                                                              // no who: the room (a wall tablet alone)
  rv(ev(3, '2026-11-03T20:47:00Z', { area_name: null })),                                         // nothing to say
  rv(ev(4, '2026-11-03T20:47:00Z', { family: 'detection', kind: 'person', title: 'Person at Driveway Cam', area_name: 'Garage', count: 14, ended: ms('2026-11-03T21:05:00Z') / 1000 })),
  rv(ev(5, '2026-11-03T04:28:00Z', { family: 'alarm', kind: 'armed_night', title: 'Home Alarm armed night', who: emma })),   // yesterday
  rv(ev(6, '2026-10-31T15:28:00Z', { family: 'door', kind: 'opened', title: 'Front Door opened' })),   // Friday
  rv(ev(7, '2026-11-03T18:00:00Z', { family: 'doorbell', kind: 'ring', title: 'Someone rang Front Door', area_name: 'Porch', pics: pic })),
  rv(ev(8, '2026-11-03T18:00:00Z', { family: 'refused', kind: 'unlock', title: 'Hallway tablet tried to unlock Back Door; refused', level: 'warning', area_name: null })),
  rv(ev(9, '2026-11-03T18:00:00Z', { family: 'system', kind: 'alert', title: 'Backup finished', level: 'info', area_name: null })),
  rv(ev(10, '2026-11-03T20:47:00Z', { who: { name: null, device: null, how: 'hand_or_automation', mine: false } }))];
out.wide = [B.wideTime(B.rowView(ev(1, '2026-11-03T20:47:00Z'), NOW, ctx)), B.wideTime(B.rowView(ev(5, '2026-11-03T04:28:00Z'), NOW, ctx)), B.wideTime(B.rowView(ev(6, '2026-10-31T15:28:00Z'), NOW, ctx))];
// the day goes by the house's midnight, not the browser's
out.edge = [B.rowView(ev(1, '2026-11-03T06:00:00Z'), NOW, ctx).day, B.rowView(ev(1, '2026-11-03T05:59:00Z'), NOW, ctx).day];
// how long ago, short and long: now, minutes, hours to six, the clock, yesterday, the weekday
const at = (iso) => ({ at: ms(iso) / 1000 });
out.ago = ['2026-11-03T21:29:40Z', '2026-11-03T21:26:00Z', '2026-11-03T19:10:00Z', '2026-11-03T14:00:00Z', '2026-11-03T04:28:00Z', '2026-10-31T15:28:00Z']
  .map(iso => [B.ago(at(iso), NOW, ctx), B.ago(at(iso), NOW, ctx, true)]);
// a title's two halves
out.halves = [['lock', 'Back Door unlocked'], ['detection', 'Person at Driveway Cam'], ['doorbell', 'Someone rang Front Door'], ['arrival', 'Mark arrived home'],
  ['lock', 'Front Door is jammed'], ['door', 'Front Door keeps changing (14 times)'], ['alarm', 'Home Alarm armed night'], ['system', 'Backup finished'],
  ['refused', 'Hallway tablet tried to unlock Back Door; refused'], ['safety', 'Leak at Kitchen Sink']].map(([f, t]) => { const h = B.halves({ family: f, title: t }); return [h.a, h.b]; });
// what a row's tap opens: its camera (the device's, for a sensor that heard it), its thing, else the Timeline's sheet
const states = { 'camera.front_door': {}, 'lock.back_door': {}, 'person.mark': {} };
const ents = { 'binary_sensor.fd_person': { device_id: 'd1' }, 'camera.front_door': { device_id: 'd1' }, 'lock.side': {} };
out.open = [B.openOf({ family: 'detection', entity: 'camera.front_door' }, states, ents), B.openOf({ family: 'detection', entity: 'binary_sensor.fd_person' }, states, ents),
  B.openOf({ family: 'lock', entity: 'lock.back_door' }, states, ents), B.openOf({ family: 'lock', entity: 'lock.side' }, states, ents),
  B.openOf({ family: 'arrival', entity: 'person.mark' }, states, ents), B.openOf({ family: 'system', entity: null }, states, ents),
  B.openOf({ family: 'refused', entity: 'lock.back_door' }, states, ents), B.openOf({ family: 'door', entity: 'binary_sensor.gone' }, states, ents), B.openOf(null, states, ents)];
// the picture a block shows large: the newest row that kept one
out.hero = [B.heroOf([ev(1, '2026-11-03T20:00:00Z'), ev(2, '2026-11-03T19:00:00Z', { pics: pic }), ev(3, '2026-11-03T18:00:00Z', { pics: pic })]).id,
  B.heroOf([ev(1, '2026-11-03T20:00:00Z'), ev(2, '2026-11-03T19:00:00Z', { pics: [{ id: 'x' }] })]), B.heroOf(null)];

// ---- the newest N, and the live feed's merge
const many = []; for (let i = 0; i < 14; i++) many.push(ev(100 + i, new Date(ms('2026-11-03T14:00:00Z') + i * 600000).toISOString()));
out.pick = [B.pick(many, 5).map(e => e.id), B.pick(many, 0).length, B.pick(null, 3).length, many.map(e => e.id).slice(0, 2)];
const kept = B.merge(many.slice(0, 6), [ev(100, '2026-11-03T14:00:00Z', { count: 9 }), ev(200, '2026-11-03T20:00:00Z'), { nope: 1 }, null], 5);
out.merge = [kept.map(e => e.id), kept.find(e => e.id === 100) === undefined];
const kept2 = B.merge([ev(1, '2026-11-03T14:00:00Z')], [ev(1, '2026-11-03T14:00:00Z', { pics: pic })], 5);
out.mergePics = [kept2.length, kept2[0].pics.length];

// ---- the digest
const sum = { window: 'overnight', label: 'Overnight', title: 'Overnight at the house (9 PM to 7 AM)', quiet: false, counts: { lock: 2 },
  lines: ['Front door and back door locked all night.', 'Garage opened 6:12 AM, closed 6:20 AM.', '2 package deliveries at Front Door.', 'Alarm armed 10:02 PM, disarmed 6:30 AM.', 'Right now: all locks locked, garage closed.'] };
out.digest = [B.digestView(sum, 3), B.digestView(sum, 9), B.digestView(sum, 0),
  B.digestView({ window: 'overnight', label: 'Overnight', title: 'Overnight', quiet: true, lines: [], counts: {} }, 3),
  B.digestView({ window: 'overnight', label: 'Overnight', lines: [], counts: { door: 3, lock: 1 } }, 3), B.digestView(null, 3)];
out.empty = B.EMPTY;
// the digest as glyphs: what it leads with, its hours, the kinds in the page's order
const dp = (o) => { const d = B.digestParts(o); return { label: d.label, span: d.span, status: d.status, counts: d.counts.map(k => [k.id, k.n, k.icon, k.color]), quiet: d.quiet, n: d.n }; };
out.parts = [dp(Object.assign({}, sum, { counts: { lock: 2, door: 1, window: 1, detection: 3, motion: 1, garage: 2 } })),
  dp({ window: 'overnight', label: 'Overnight', title: 'Overnight at the house (9 PM to 7 AM)', quiet: false, counts: { garage: 1 }, lines: ['Garage is still open.', 'Garage opened 6:12 AM.'] }),
  dp({ window: 'overnight', label: 'Overnight', title: 'Overnight at the house (9 PM to 7 AM)', quiet: true, counts: {}, lines: ['A quiet night. Everything is locked and closed.'] }),
  dp({ window: 'overnight', label: 'Overnight', quiet: false, counts: { lock: 1 }, lines: ['Back Door locked 10:12 PM.'] }), dp(null)];
out.errors = [B.errorWord({ code: 'forbidden', status: 403 }), B.errorWord({ status: 403 }), B.errorWord({ status: 503 }), B.errorWord(null)];

// ---- the strip's words
out.short = ['Person at Driveway Cam', 'Vehicle at Driveway Cam', 'Package at Front Door', 'Motion at Garden Cam', 'Someone rang Front Door', 'Animal at Backyard', 'Garage opened'].map(t => B.shortTitle({ title: t }));
const st = B.stripView(ev(7, '2026-11-03T18:00:00Z', { family: 'doorbell', kind: 'ring', title: 'Someone rang Front Door', pics: pic }), NOW, ctx);
out.strip = [st.title, st.time, st.day, st.thumb, st.icon, st.color];
const sn = B.stripView(ev(8, '2026-11-03T04:28:00Z', { family: 'detection', kind: 'package', title: 'Package at Front Door' }), NOW, ctx);
out.stripNoPic = [sn.title, sn.time, sn.day, sn.thumb, sn.icon, sn.color];

// ---- the camera at Extra Large: that camera's rows since the house's midnight, a row's words, the foot
out.todayStart = [B.todayStart(NOW, ctx), B.todayStart(ms('2026-11-03T05:59:00Z'), ctx), B.todayStart(ms('2026-11-03T06:00:00Z'), ctx)];
out.todayPath = [B.todayPath('camera.front_door', 1793685600), B.todayPath('camera.a b', 5), B.TODAY_KEEP];
const tr = (e) => { const r = B.todayRow(e, NOW, ctx); return [r.kind, r.where, r.ago, r.agoLong, r.thumb, r.icon]; };
out.todayRows = [
  tr(ev(1, '2026-11-03T21:26:00Z', { family: 'detection', kind: 'person', title: 'Person at Backyard', area_name: 'Backyard', pics: pic })),
  tr(ev(2, '2026-11-03T20:00:00Z', { family: 'detection', kind: 'motion', title: 'Motion at Backyard', area_name: 'Backyard', zone: 'Patio' })),
  tr(ev(3, '2026-11-03T14:00:00Z', { family: 'doorbell', kind: 'ring', title: 'Someone rang Front Door', area_name: null })),
  tr(ev(4, '2026-11-03T21:29:40Z', { family: 'detection', kind: 'package', title: 'Package at Front Door', area_name: 'Porch' }))];
out.todayFoot = [B.todayFoot(7, false), B.todayFoot(1, false), B.todayFoot(0, false), B.todayFoot(50, true)];
console.log(JSON.stringify(out));
"""

CATALOG = r"""
const fs = require('fs');
globalThis.window = globalThis;
globalThis.CustomEvent = function () {};
globalThis.dispatchEvent = () => {};
const out = {};
const run = (host) => {
  delete globalThis.hkGridCatalog;
  globalThis.hkShell = host;
  (0, eval)(fs.readFileSync(process.argv[2], 'utf8'));
  const G = window.hkGridCatalog;
  const it = (opts, size) => ({ id: 't', card: 'timeline', size: size || 'L', at: [0, 0], opts });
  return [G.config(it({}), {}), G.config(it({ show: 'latest' }, 'W'), {}), G.config(it({ show: 'digest', tap: 'none' }, 'XL'), {}), G.config(it({ show: 'bogus' }), {}),
          G.config(it(undefined), {}), G.table().timeline, G.hostHas('timeline')];
};
out.mantel = run({ hostPage: (name) => name === 'timeline' });
out.ha = run({});
out.broken = run({ hostPage: () => { throw new Error('no'); } });
out.noShell = run(undefined);
// THE CAMERA BLOCK AT EXTRA LARGE (2026-11-09, mockup 13): beside what it saw today where the host keeps a Timeline, else the full picture
const cam = (host, size, opts, cams) => {
  delete globalThis.hkGridCatalog;
  globalThis.hkShell = host;
  (0, eval)(fs.readFileSync(process.argv[2], 'utf8'));
  return window.hkGridCatalog.config({ id: 'c', card: 'camera', size, at: [0, 0], opts }, { cameras: cams === undefined ? ['camera.front_door', 'camera.yard'] : cams });
};
const mantel = { hostPage: (name) => name === 'timeline' };
out.cameraXl = [cam(mantel, 'XL', {}), cam(mantel, 'XL', { entity: 'camera.yard' }), cam(mantel, 'L', {}), cam({}, 'XL', {}), cam(mantel, 'XL', {}, [])];
console.log(JSON.stringify(out));
"""


def node(script: str, *args: str) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".cjs", delete=False) as f:
        f.write(script)
        path = f.name
    try:
        done = subprocess.run([NODE, path, *args], capture_output=True, text=True, timeout=60, env={"TZ": "UTC", "PATH": "/usr/bin:/bin"})
    finally:
        Path(path).unlink(missing_ok=True)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout.strip().splitlines()[-1])


@pytest.fixture(scope="module")
def got() -> dict:
    return node(SCRIPT, str(ROOT / "web/hk/cards/hk-timeline.js"), str(ROOT / "web/hk/cards/hk-timeline-block.js"))


@needs_node
def test_automatic_shows_the_morning_summary_from_five_to_eleven_at_the_house(got):
    # 4:59 AM, 5:00, 7:00, 10:59, 11:00, 3:30 PM, 11:30 PM
    assert got["auto"] == ["latest", "digest", "digest", "digest", "latest", "latest", "latest"]
    # Latest Events and Morning Summary are what they say, at any hour; anything else is Automatic
    assert got["explicit"][0] == "latest" and got["explicit"][1] == "digest"
    assert got["explicit"][2] == "digest"            # 7 AM, no choice made: Automatic
    assert got["explicit"][3] == "latest"            # 3:30 PM, a word nobody knows: Automatic
    assert got["show"] == ["latest", "digest", "auto", "auto", "auto"]
    assert got["autoUtc"] == ["latest", "digest"]    # the house's clock, not the browser's: 11:00 UTC is 5 AM here, 11 AM there


@needs_node
def test_each_size_reads_enough_rows_and_shows_whole_rows_of_its_own_height(got):
    assert got["limit"] == [25, 25, 25, 25, 1, 25]   # (Small is the one latest event; the rest say "N more" for what they read)
    # nothing stretches (2026-11-08, the owner): a row is 44 on Wide and Tall, 56 on Large and Extra Large
    assert got["rowH"] == {"W": 44, "T": 44, "L": 56, "XL": 56}
    sq, tile, short, none, unmeasured = got["fit"]
    assert (sq["n"], sq["h"], sq["rest"]) == (3, 44, 1)          # Wide on a square cell: three
    assert (tile["n"], tile["rest"]) == (2, 7)                   # ...on a tile: two
    assert (short["n"], short["h"], short["rest"]) == (2, 56, 230)   # a short list keeps its height; the rest is the quiet line's
    assert none["n"] == 0 and unmeasured["n"] == 0 and unmeasured["rest"] == 0


@needs_node
def test_the_summarys_kinds_fit_as_tiles_of_their_own_size(got):
    five, wide, many, tiny = got["grid"]
    assert five == {"n": 5, "cols": 3, "rows": 2}          # Large: three across, the last row of two centered
    assert wide == {"n": 4, "cols": 2, "rows": 2}          # Wide's small tiles: 2 x 2
    assert many == {"n": 6, "cols": 2, "rows": 3}          # Extra Large's column: what fits, no more
    assert tiny == {"n": 1, "cols": 1, "rows": 1}          # never none


@needs_node
def test_a_row_says_how_long_ago_and_splits_its_title(got):
    assert got["ago"] == [["Now", "Just now"], ["4 min", "4 min ago"], ["2 hr", "2 hr ago"], ["8:00 AM", "8:00 AM"],
                          ["Yesterday", "Yesterday, 10:28 PM"], ["Sat", "Sat, 10:28 AM"]]
    assert got["halves"] == [["Back Door", "Unlocked"], ["Person", "Driveway Cam"], ["Doorbell", "Front Door"], ["Mark", "Arrived home"],
                             ["Front Door", "Jammed"], ["Front Door", "Keeps changing"], ["Home Alarm", "Armed night"], ["Backup finished", ""],
                             ["Hallway tablet tried to unlock Back Door; refused", ""], ["Leak", "Kitchen Sink"]]


@needs_node
def test_a_rows_tap_opens_what_it_stands_for(got):
    assert got["open"] == ["camera.front_door", "camera.front_door",   # a camera's row: its camera, also when a sensor of its device heard it
                           "lock.back_door", "lock.side",                # a lock (known by its state, or by the registry alone)
                           "person.mark",                                # a person's arrival: their sheet
                           "timeline", "timeline",                       # Mantel's own rows and a refused command: the row's sheet on the Timeline
                           "timeline", "timeline"]                       # a thing this house no longer has; nothing
    assert got["hero"] == [2, None, None]                                # the newest picture, never a picture with no address


@needs_node
def test_the_paths_are_the_ones_the_adapter_answers(got):
    assert got["paths"] == ["timeline?limit=25", "timeline?limit=25", "timeline?limit=25",
                            "timeline?camera=camera.front_door&limit=10", "timeline?camera=camera.a%20b&limit=10",
                            {"type": "timeline/subscribe", "camera": "camera.front_door"}]


@needs_node
def test_a_row_says_who_only_when_the_server_did_and_the_day_when_it_is_not_today(got):
    r = got["rows"]
    assert r[0] == ["Back Door locked", "2:47 PM", "", "Emma · Hallway tablet", "", 0, "hk:lock", "green", False]
    assert r[1][3] == "Kitchen"                       # no name sent (a wall tablet alone): the room, nothing more
    assert r[2][3] == ""
    assert r[3][3] == "Garage · 14 times, 2:47 to 3:05 PM"
    assert r[4][2] == "Yesterday" and r[4][1] == "10:28 PM"
    assert r[5][2] == "Sat"
    assert r[6][4] == "/api/timeline/pic/" + "a" * 32 and r[6][5] == 2 and r[6][6] == "hk:doorbell-video"
    assert r[7][8] is True and r[7][7] == "orange"    # a refused command is a warning, drawn in its color
    assert r[8][3] == "" and r[8][6] == "hk:alert-circle"
    assert r[9][3] == "Kitchen"                       # (by hand or an automation: says so in the page; the block keeps to the room)
    assert got["wide"] == ["2:47 PM", "Yest. 10:28 PM", "Sat 10:28 AM"]
    assert got["edge"] == ["", "Yesterday"]           # midnight at the house, not at the browser


@needs_node
def test_the_block_keeps_the_newest_rows_and_the_live_feed_merges_by_id(got):
    assert got["pick"] == [[113, 112, 111, 110, 109], 0, 0, [100, 101]]
    ids, replaced = got["merge"]
    assert ids == [200, 105, 104, 103, 102] and replaced is True        # a newer row first; the oldest fall off
    assert got["mergePics"] == [1, 2]                  # a later picture arrives as an update of the same row


@needs_node
def test_the_summary_is_the_digests_own_words_cut_to_what_fits(got):
    three, nine, zero, quiet, counts, none = got["digest"]
    assert three["label"] == "Overnight" and three["title"] == "Overnight at the house (9 PM to 7 AM)"
    assert three["lines"] == ["Front door and back door locked all night.", "Garage opened 6:12 AM, closed 6:20 AM.", "2 package deliveries at Front Door."]
    assert three["more"] == 2 and nine["more"] == 0 and len(nine["lines"]) == 5
    assert len(zero["lines"]) == 1                    # at least one
    assert quiet["lines"] == ["A quiet night."] and quiet["title"] == "" and quiet["more"] == 0     # a title that is the label is not said twice
    assert counts["lines"] == ["Doors 3 · Locks 1"]   # no lines sent: the counts, in the page's order
    assert none["lines"] == ["Nothing has happened yet today."] and none["label"] == "Today"
    assert got["empty"] == "Nothing yet today."
    assert got["errors"][0] == "The Timeline isn’t part of this account." == got["errors"][1]
    assert got["errors"][2] == "Couldn’t load recent events." == got["errors"][3]


@needs_node
def test_the_summary_as_glyphs_leads_with_what_matters(got):
    busy, open_, quiet, plain, none = got["parts"]
    assert busy["label"] == "Overnight" and busy["span"] == "9 PM to 7 AM" and busy["n"] == 10
    assert busy["status"] == {"icon": "mdi:check-circle", "color": "green", "line": "All locks locked, garage closed", "sub": "10 events overnight"}
    assert [c[0] for c in busy["counts"]] == ["doors", "locks", "garage", "cameras"]          # the page's order; doors and windows one kind
    assert busy["counts"][0][1] == 2 and busy["counts"][3][1:] == [4, "hk:cctv", "blue"]
    assert open_["status"]["color"] == "orange" and open_["status"]["line"] == "Garage is still open"   # what is still open leads
    assert quiet["quiet"] is True and quiet["status"]["line"] == "A quiet night" and quiet["status"]["sub"] == "Everything is locked and closed"
    assert plain["status"]["line"] == "1 event overnight" and plain["status"]["sub"] == ""     # no "right now" said: no claim made
    assert none["quiet"] is True and none["label"] == "Today" and none["status"]["line"] == "A quiet day"


@needs_node
def test_the_strip_says_it_in_few_words(got):
    assert got["short"] == ["Person", "Vehicle", "Package", "Motion", "Doorbell", "Animal", "Garage opened"]
    assert got["strip"] == ["Doorbell", "12:00 PM", "", "/api/timeline/pic/" + "a" * 32, "hk:doorbell-video", "orange"]
    assert got["stripNoPic"] == ["Package", "10:28 PM", "Yesterday", "", "hk:package-variant", "brown"]


@needs_node
def test_the_camera_at_extra_large_reads_that_cameras_day_and_says_it_in_few_words(got):
    # the house's midnight (CST, UTC-6: 6 AM UTC), not the browser's, and the day before it for a row just past the house's midnight
    assert got["todayStart"] == [1793685600, 1793599200, 1793685600]
    assert got["todayPath"] == ["timeline?camera=camera.front_door&since=1793685600&limit=50", "timeline?camera=camera.a%20b&since=5&limit=50", 50]
    # a row: its kind, where it was (the zone the camera named, else the camera's area), how long ago, its picture (else its glyph)
    assert got["todayRows"] == [
        ["Person", "Backyard", "4 min", "4 min ago", "/api/timeline/pic/" + "a" * 32, "hk:walk"],
        ["Motion", "Patio", "1 hr", "1 hr ago", "", "hk:camera"],
        ["Doorbell", "", "8:00 AM", "8:00 AM", "", "hk:doorbell-video"],
        ["Package", "Porch", "Now", "Just now", "", "hk:package-variant"]]
    assert got["todayFoot"] == ["Today: 7 events", "Today: 1 event", "Today: 0 events", "Today: 50+ events"]


# -- the catalog's entry: Mantel's own ---------------------------------------------------------------------------------
@pytest.fixture(scope="module")
def catalog() -> dict:
    return node(CATALOG, str(ROOT / "web/hk/cards/hk-grid-catalog.js"))


@needs_node
def test_the_catalog_draws_the_block_where_the_host_has_a_timeline_and_a_stand_in_where_it_has_none(catalog):
    l, w, xl, bogus, none, table, has = catalog["mantel"]
    assert l == {"type": "custom:hk-timeline-block-card", "size": "L", "show": "auto"}
    assert w == {"type": "custom:hk-timeline-block-card", "size": "W", "show": "latest"}
    assert xl == {"type": "custom:hk-timeline-block-card", "size": "XL", "show": "digest", "tap": "none"}
    assert bogus["show"] == "auto" and none["show"] == "auto"
    assert table == {"sizes": ["S", "W", "T", "L", "XL"], "sources": [], "opts": {"show": "timeline_show", "tap": "tap_target"}} and has is True
    for host in ("ha", "broken", "noShell"):             # Home Assistant's HK Frontend, a host that throws, no shell at all
        cfg = catalog[host]
        # (the note a block with nothing to show draws -- its own options, a tap, may ride along)
        assert all({k: c.get(k) for k in ("type", "panel", "name", "text")} ==
                   {"type": "custom:hk-grid-panel-card", "panel": "note", "name": "Recent", "text": "Recent isn't available here."}
                   for c in cfg[:5]), host
        assert cfg[6] is False, host


@needs_node
def test_the_camera_block_at_extra_large_shows_what_it_saw_today_only_where_the_host_has_a_timeline(catalog):
    xl, named, large, ha, none = catalog["cameraXl"]
    assert xl == {"type": "custom:hk-camera-today-card", "camera": "camera.front_door"}
    assert named == {"type": "custom:hk-camera-today-card", "camera": "camera.yard"}
    assert large["type"] == "custom:hk-camera-mosaic-card" and large["height"] == 195          # the other sizes are as they were
    assert ha["type"] == "custom:hk-camera-mosaic-card" and ha["cameras"] == [{"entity": "camera.front_door"}]   # no Timeline: the full picture
    assert none["type"] == "custom:hk-grid-panel-card"                                          # no camera: the note


# -- the Python mirror ---------------------------------------------------------------------------------------------
def grid(*items):
    return {"v": 1, "cols": 6, "rows": 4, "frame": [1280, 800], "band": True, "items": list(items)}


def write(*items):
    return C.apply_board({}, {"home_style": "grid", "home_grid": grid(*items)})


@pytest.mark.parametrize("size", ["S", "W", "T", "L", "XL"])
@pytest.mark.parametrize("opts", [{}, {"show": "latest"}, {"show": "digest", "tap": "page"}, {"show": "auto", "tap": "none"}])
def test_a_recent_block_is_kept_in_its_five_sizes(size, opts):
    b, errors = write({"id": "r1", "card": "timeline", "size": size, "at": [0, 0], "opts": opts})
    assert errors == {} and b["home_grid"]["items"][0].get("opts", {}) == opts


@pytest.mark.parametrize("item,code", [
    ({"card": "timeline", "size": "C"}, "grid_size"),
    ({"card": "timeline", "size": "F"}, "grid_size"),
    ({"card": "timeline", "size": "XXL"}, "grid_size"),
    ({"card": "timeline", "size": "L", "opts": {"show": "yesterday"}}, "grid_option"),
    ({"card": "timeline", "size": "L", "opts": {"show": True}}, "grid_option"),
    ({"card": "timeline", "size": "L", "opts": {"tap": "popup"}}, "grid_option"),
    ({"card": "timeline", "size": "L", "opts": {"camera": "camera.front_door"}}, "grid_option"),
    ({"card": "timeline", "size": "L", "pages": {"source": "cameras"}}, "grid_source"),
])
def test_what_a_recent_block_refuses(item, code):
    _, errors = write({"id": "r1", "at": [0, 0], **item})
    assert errors == {"home_grid": code}


def test_the_mirror_and_the_catalog_name_the_same_option():
    assert HG.CATALOG["timeline"] == {"sizes": ("S", "W", "T", "L", "XL"), "sources": (), "opts": {"show": "timeline_show", "tap": "tap_target"}}
    assert HG.TIMELINE_SHOWS == ("auto", "latest", "digest")


# -- how it is wired -----------------------------------------------------------------------------------------------
def test_the_block_is_wired_in_the_way_the_other_blocks_are():
    from mantel_server import hk_cards
    assert "hk-timeline-block.js" in hk_cards.LAZY                      # loaded when its card is asked for
    assert hk_cards.tags_of(ROOT / "web/hk/cards/hk-timeline-block.js") == ("hk-camera-today-card", "hk-timeline-block-card", "hk-timeline-strip-card")
    editor = web_sources.read("web/hk/panels/hk-grid-editor.js")
    assert "timeline: 'Recent'" in editor and "'people', 'vacuum', 'laundry', 'timeline', 'everything'" in editor
    assert "offered(k) && self.sizesOf(k)" in editor                    # the picker lists it only where the host has the page
    assert "kind === 'timeline_show'" in editor and "'Morning Summary'" in editor
    edit = (ROOT / "web/hk/modules/hk-edit-grid.js").read_text()
    assert "Xe.offered(key)" in edit                                    # ...and Edit mode's Add the same
    security = (ROOT / "web/hk/sheets/hk-sheet-security.js").read_text()
    assert "custom:hk-timeline-strip-card" in security and "hostPage('timeline')" in security
    # (the sheet frame's width rule, in hk-detail.js's frame part since phase 24: read alone, not with the security sheet)
    assert "--hkd-strip" in security and "--hkd-strip" in (ROOT / "web/hk/sheets/hk-detail-frame.js").read_text()
    page = (ROOT / "web/hk/cards/hk-timeline.js").read_text()
    assert "window.hkTimeline.openSheet" in page and "o && o.noAll" in page


def test_the_digests_push_opens_the_timeline_page_of_the_persons_screen():
    from mantel_server.timeline import digest
    assert digest.PAGE_URL == "/home/timeline"
