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

// ---- how many rows: the size asks for 5, 8 or 12; the block holds what fits (rows of 36 in Wide, 52 in the rest; Extra Large in two columns)
out.limit = ['W', 'L', 'XL', 'S', undefined].map(B.limitOf);
out.layout = {
  wTile: B.layoutOf('W', 122), wSquare: B.layoutOf('W', 160), lTile: B.layoutOf('L', 249), lSquare: B.layoutOf('L', 369), lTall: B.layoutOf('L', 900),
  xlTile: B.layoutOf('XL', 282), xlSquare: B.layoutOf('XL', 369), xlHuge: B.layoutOf('XL', 2000), tiny: B.layoutOf('L', 10), none: B.layoutOf('L', undefined) };
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
out.errors = [B.errorWord({ code: 'forbidden', status: 403 }), B.errorWord({ status: 403 }), B.errorWord({ status: 503 }), B.errorWord(null)];

// ---- the strip's words
out.short = ['Person at Driveway Cam', 'Vehicle at Driveway Cam', 'Package at Front Door', 'Motion at Garden Cam', 'Someone rang Front Door', 'Animal at Backyard', 'Garage opened'].map(t => B.shortTitle({ title: t }));
const st = B.stripView(ev(7, '2026-11-03T18:00:00Z', { family: 'doorbell', kind: 'ring', title: 'Someone rang Front Door', pics: pic }), NOW, ctx);
out.strip = [st.title, st.time, st.day, st.thumb, st.icon, st.color];
const sn = B.stripView(ev(8, '2026-11-03T04:28:00Z', { family: 'detection', kind: 'package', title: 'Package at Front Door' }), NOW, ctx);
out.stripNoPic = [sn.title, sn.time, sn.day, sn.thumb, sn.icon, sn.color];
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
def test_each_size_asks_for_its_rows_and_holds_what_fits(got):
    assert got["limit"] == [5, 8, 12, 1, 8]      # (Small, 2026-11-07, is the one latest event; Tall asks for ten)
    lay = got["layout"]
    # Wide: rows of 36 under the label, one column: a tile cell holds two, a square cell three; never more than 5
    assert (lay["wTile"]["per"], lay["wTile"]["n"], lay["wTile"]["cols"]) == (2, 2, 1)
    assert (lay["wSquare"]["per"], lay["wSquare"]["n"]) == (3, 3)
    # Large: rows of 52, one column; up to 8
    assert (lay["lTile"]["per"], lay["lTile"]["n"], lay["lTile"]["rowH"]) == (4, 4, 52)
    assert (lay["lSquare"]["per"], lay["lSquare"]["n"]) == (6, 6)
    assert lay["lTall"]["n"] == 8
    # Extra Large: two columns, so up to 12
    assert (lay["xlTile"]["per"], lay["xlTile"]["n"], lay["xlTile"]["cols"]) == (4, 8, 2)
    assert (lay["xlSquare"]["per"], lay["xlSquare"]["n"]) == (6, 12)
    assert lay["xlHuge"]["n"] == 12
    # a block with no room (a cell not yet measured) still shows one row
    assert lay["tiny"]["n"] == 1 and lay["none"]["n"] == 1


@needs_node
def test_the_paths_are_the_ones_the_adapter_answers(got):
    assert got["paths"] == ["timeline?limit=5", "timeline?limit=8", "timeline?limit=12",
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
def test_the_strip_says_it_in_few_words(got):
    assert got["short"] == ["Person", "Vehicle", "Package", "Motion", "Doorbell", "Animal", "Garage opened"]
    assert got["strip"] == ["Doorbell", "12:00 PM", "", "/api/timeline/pic/" + "a" * 32, "hk:doorbell-video", "orange"]
    assert got["stripNoPic"] == ["Package", "10:28 PM", "Yesterday", "", "hk:package-variant", "brown"]


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
        assert all(c == {"type": "custom:hk-key-card", "name": "Recent", "icon": "mdi:history"} for c in cfg[:5]), host
        assert cfg[6] is False, host


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
    assert hk_cards.tags_of(ROOT / "web/hk/cards/hk-timeline-block.js") == ("hk-timeline-block-card", "hk-timeline-strip-card")
    editor = (ROOT / "web/hk/panels/hk-grid-editor.js").read_text()
    assert "timeline: 'Recent'" in editor and "'people', 'vacuum', 'timeline', 'everything'" in editor
    assert "offered(k) && self.sizesOf(k)" in editor                    # the picker lists it only where the host has the page
    assert "kind === 'timeline_show'" in editor and "'Morning Summary'" in editor
    edit = (ROOT / "web/hk/modules/hk-edit-grid.js").read_text()
    assert "Xe.offered(key)" in edit                                    # ...and Edit mode's Add the same
    security = (ROOT / "web/hk/sheets/hk-sheet-security.js").read_text()
    assert "custom:hk-timeline-strip-card" in security and "hostPage('timeline')" in security
    assert "--hkd-strip" in security and "--hkd-strip" in (ROOT / "web/hk/cards/hk-detail.js").read_text()
    page = (ROOT / "web/hk/cards/hk-timeline.js").read_text()
    assert "window.hkTimeline.openSheet" in page and "o && o.noAll" in page


def test_the_digests_push_opens_the_timeline_page_of_the_persons_screen():
    from mantel_server.timeline import digest
    assert digest.PAGE_URL == "/home/timeline"
