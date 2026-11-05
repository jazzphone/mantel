"""The Timeline page's own logic (web/hk/cards/hk-timeline.js, docs/phase19/HOUSE-TIMELINE.md "The views").

The page's pure part has no DOM and is run here in node (window.hkTimeline.lib): the day and hour grouping, the words
(who did it, "14 times, 2:10 to 2:40 AM"), the filters turned into the path the page reads, the day jump's end of
day across a time change, merging the live feed, the summary card, the chips a viewer has. And the adapter's two
pieces (web/shim/mantel-host.js): which Timeline reads are answered, and a picture's address under the page's prefix.
The browser half is tools/headless/timeline_check.py."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node") or "/opt/homebrew/bin/node"
pytestmark = pytest.mark.skipif(not Path(NODE).exists(), reason="no node")

SCRIPT = r"""
const fs = require('fs');
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
(0, eval)(fs.readFileSync(process.argv[2], 'utf8'));
const L = window.hkTimeline.lib;
const ctx = { tag: 'en-US', zone: 'America/Chicago' };
const ms = (iso) => new Date(iso).getTime();
const out = {};
// Tuesday, November 3, 2026, 3:30 PM at the house (CST, UTC-6)
const NOW = ms('2026-11-03T21:30:00Z');
const ev = (id, iso, extra) => Object.assign({ id, at: ms(iso) / 1000, family: 'lock', kind: 'locked', title: 'Back Door locked', level: 'info', entity: 'lock.back_door' }, extra || {});

// ---- days and hours
const few = [ev(1, '2026-11-03T20:00:00Z'), ev(2, '2026-11-03T06:30:00Z'), ev(3, '2026-11-02T20:00:00Z'), ev(4, '2026-11-01T18:00:00Z'), ev(5, '2026-10-20T18:00:00Z'), ev(6, '2025-12-24T18:00:00Z')];
out.days = L.groupEvents(few, NOW, ctx).map(d => [d.key, d.label, d.count, d.items.map(i => i.type)]);
// 14 rows in one day: hour headings; the same day with 12 has none
const busy = []; for (let i = 0; i < 14; i++) busy.push(ev(100 + i, new Date(ms('2026-11-03T14:00:00Z') + i * 20 * 60000).toISOString()));
const g14 = L.groupEvents(busy, NOW, ctx)[0];
out.busy = { types: g14.items.map(i => i.type === 'hour' ? i.label : 'e'), count: g14.count };
out.twelve = L.groupEvents(busy.slice(0, 12), NOW, ctx)[0].items.map(i => i.type).filter(t => t === 'hour').length;
// a row written late goes where its time puts it, not where its id does
out.late = L.groupEvents([ev(9, '2026-11-03T10:00:00Z'), ev(8, '2026-11-03T12:00:00Z')], NOW, ctx)[0].items.map(i => i.ev.id);
// a day ends where the next starts, in the house's zone (a time change inside the day included)
out.dayEnd = ['2026-11-03', '2026-11-01', '2026-03-08', 'x'].map(k => L.dayEnd(k, ctx));
out.dayKey = [L.dayKey(ms('2026-11-03T05:59:00Z'), ctx), L.dayKey(ms('2026-11-03T06:00:00Z'), ctx)];

// ---- the words
out.who = [
  L.whoLine({ name: 'Emma', device: 'Hallway tablet', how: 'tablet', mine: true }),
  L.whoLine({ name: null, device: 'Kitchen tablet', how: 'tablet' }),
  L.whoLine({ name: 'Emma', how: 'away' }), L.whoLine({ name: 'Mark', how: 'home' }),
  L.whoLine({ name: 'Emma', how: 'assistant' }), L.whoLine({ name: null, how: 'assistant' }),
  L.whoLine({ name: null, device: null, how: 'hand_or_automation' }),
  L.whoLine({ name: 'Anna', device: 'Hallway tablet', how: 'tablet', keypad: 'Guest' }),
  L.whoLine({ name: 'Emma', how: 'ha_sidebar' }), L.whoLine(undefined), L.whoLine(null), L.whoLine({ how: 'tablet' })];
const t0 = ms('2026-11-03T08:10:00Z') / 1000;
out.count = [
  L.countLine({ kind: 'person', at: t0, ended: t0 + 1800, count: 14 }, ctx),
  L.countLine({ kind: 'person', at: t0, last: t0 + 1800, count: 14 }, ctx),
  L.countLine({ kind: 'package', at: t0, count: 2 }, ctx),
  L.countLine({ kind: 'person', at: t0, count: 1 }, ctx),
  L.countLine({ kind: 'flapping', at: t0, ended: t0 + 1800, count: 14, flapping: true }, ctx),
  L.countLine({ kind: 'flapping', at: t0, count: 3, flapping: true }, ctx),
  L.countLine({ kind: 'locked', at: t0 }, ctx),
  L.countLine({ kind: 'person', at: ms('2026-11-03T05:50:00Z') / 1000, ended: ms('2026-11-03T06:20:00Z') / 1000 + 600, count: 3 }, ctx)];
out.range24 = L.timeRange(ms('2026-11-03T20:10:00Z'), ms('2026-11-03T20:40:00Z'), { tag: 'de-DE', zone: 'America/Chicago' });
out.times = [L.timeText(ms('2026-11-03T08:04:00Z'), ctx), L.timeText(ms('2026-11-03T20:04:00Z'), ctx), L.hourText(ms('2026-11-03T08:04:00Z'), ctx), L.shortDay('2026-11-01', ctx)];
out.exact = L.exactTime(ms('2026-11-03T08:04:12Z'), ctx);

// ---- filters
const f = L.emptyFilters();
out.q0 = [L.queryPath(f), L.filtersOn(f)];
out.q1 = L.queryPath(Object.assign(L.emptyFilters(), { groups: ['doors', 'locks'], q: ' back door ', mine: true, until: 1793000000 }), { before: 812, limit: 20 });
out.q2 = [L.queryPath(Object.assign(L.emptyFilters(), { entity: 'camera.driveway', camera: true })), L.queryPath(Object.assign(L.emptyFilters(), { entity: 'lock.back_door' }))];
out.sub = [L.subscribeMessage(f), L.subscribeMessage(Object.assign(L.emptyFilters(), { groups: ['doors', 'cameras'], entity: 'camera.x', camera: true })), L.subscribeMessage(Object.assign(L.emptyFilters(), { entity: 'lock.x' }))];
const row = ev(7, '2026-11-03T08:00:00Z', { area_name: 'Kitchen', who: { name: 'Emma', mine: true } });
out.matches = [
  L.matches(row, f), L.matches(row, Object.assign(L.emptyFilters(), { groups: ['locks'] })), L.matches(row, Object.assign(L.emptyFilters(), { groups: ['doors'] })),
  L.matches(row, Object.assign(L.emptyFilters(), { groups: ['doors', 'locks'] })), L.matches(row, Object.assign(L.emptyFilters(), { entity: 'lock.back_door' })),
  L.matches(row, Object.assign(L.emptyFilters(), { entity: 'lock.front_door' })), L.matches(row, Object.assign(L.emptyFilters(), { mine: true })),
  L.matches(ev(8, '2026-11-03T08:00:00Z'), Object.assign(L.emptyFilters(), { mine: true })), L.matches(row, Object.assign(L.emptyFilters(), { q: 'back KITCHEN' })),
  L.matches(row, Object.assign(L.emptyFilters(), { q: 'garage' }))];
out.show = [L.showAllFilter({ family: 'doorbell', entity: 'camera.front_door' }), L.showAllFilter({ family: 'door', entity: 'binary_sensor.front_door' }), L.showAllFilter({ family: 'system' }),
            L.showAllLabel({ family: 'doorbell' }, 'Front Door'), L.showAllLabel({ family: 'detection' }, ''), L.showAllLabel({ family: 'lock' }, ''), L.showAllLabel({ family: 'door' }, '')];
out.labels = ['Someone rang Front Door', 'Person at Driveway Cam', 'Carbon monoxide at Hallway', 'Back Door unlocked', 'Front Door keeps changing (14 times)',
              'Home Alarm armed night', 'Mark arrived home', 'Garage is jammed'].map(t => L.labelOf({ title: t, family: 'door' }))
  .concat([L.labelOf({ title: 'Backup finished', family: 'system' }), L.labelOf({ title: 'Kitchen tablet tried to unlock Back Door; refused', family: 'refused' })]);

// ---- the chips a viewer has
const all = ['door', 'window', 'lock', 'garage', 'alarm', 'arrival', 'doorbell', 'detection', 'motion', 'safety', 'system', 'refused'];
out.chipsAll = L.visibleGroups(all, false).map(g => g.id);
out.chipsWall = L.visibleGroups(['door', 'lock', 'garage', 'alarm', 'doorbell', 'detection'], true).map(g => g.id);
out.chipsAdult = L.visibleGroups(['door', 'lock', 'arrival', 'detection'], false).map(g => g.id);
out.chipsPeopleWall = L.visibleGroups(['arrival', 'door'], true).map(g => g.id);

// ---- merging the live feed
const base = [ev(1, '2026-11-03T10:00:00Z', { count: 2 }), ev(2, '2026-11-03T12:00:00Z')];
const merged = L.mergeEvents(base, [ev(1, '2026-11-03T10:00:00Z', { count: 5, ended: 1 }), ev(3, '2026-11-03T13:00:00Z'), { nope: true }, null]);
out.merge = [merged.map(e => e.id), merged.find(e => e.id === 1).count, base.length, base[0].count];

// ---- the summary card
out.win = [L.summaryWindow(ms('2026-11-03T10:59:00Z'), ctx) /* 4:59 AM */, L.summaryWindow(ms('2026-11-03T11:00:00Z'), ctx) /* 5:00 AM */,
           L.summaryWindow(ms('2026-11-03T16:59:00Z'), ctx) /* 10:59 AM */, L.summaryWindow(ms('2026-11-03T17:00:00Z'), ctx) /* 11:00 AM */, L.summaryWindow(ms('2026-11-03T21:30:00Z'), ctx)];
out.sum = [
  L.summaryView({ window: 'overnight', label: 'Overnight', title: 'Overnight: quiet', lines: ['Front door locked all night.', { text: 'Garage opened 6:12.' }], counts: { door: 3 } }),
  L.summaryView({ window: 'today', label: 'Today', lines: [], counts: { door: 2, window: 1, lock: 3, detection: 1, motion: 4, system: 1, refused: 1 } }),
  L.summaryView({ window: 'overnight', label: 'Overnight', counts: {}, quiet: true }),
  L.summaryView({ window: 'today', label: 'Today', counts: {} }), L.summaryView(null)];

// ---- the sheet's rows and the errors
out.rows = L.detailRows({ id: 1, at: ms('2026-11-03T08:04:12Z') / 1000, family: 'lock', kind: 'unlocked', area_name: 'Kitchen', late: true, audit_id: 411,
                          who: { name: 'Emma', device: 'Hallway tablet', how: 'tablet' } }, ctx, 'Back Door');
out.rows2 = L.detailRows({ id: 2, at: t0, family: 'arrival', kind: 'arrived', zone: 'Work' }, ctx, '');
out.err = [L.errorText({ code: 'forbidden', status: 403 }), L.errorText({ status: 503 }), L.errorText(null)];
out.look = [L.lookOf({ family: 'detection', kind: 'package' }), L.lookOf({ family: 'lock', kind: 'locked' }), L.lookOf({ family: 'lock', kind: 'unlocked' }),
            L.lookOf({ family: 'safety', kind: 'leak' }), L.lookOf({ family: 'system', kind: 'alert', level: 'warning' }), L.lookOf({ family: 'nothing', kind: 'x' })];
// the day jump's little month: November 2026 on a Sunday week, then a Monday one; December (after today's month)
const nov = L.monthDays('2026-11', 0, '2026-11-05'), novMon = L.monthDays('2026-11', 1, '2026-11-05'), jan = L.monthDays('2026-01', 0, '2026-11-05');
out.month = { title: nov.title, letters: nov.letters.join(''), n: nov.days.length, first: nov.days[0], last: nov.days[nov.days.length - 1],
  today: nov.days.filter(d => d.today).map(d => d.key), future: nov.days.filter(d => d.future).length, prev: nov.prev, next: nov.next,
  monLetters: novMon.letters.join(''), monFirst: novMon.days[0].key, monN: novMon.days.length, janPrev: jan.prev, janNext: jan.next,
  bad: L.monthDays('x', 0, ''), fallback: L.monthDays('', 0, '2026-02-10').title };
console.log(JSON.stringify(out));
"""

HOST = r"""
const m = await import(process.argv[2]);
const out = {};
out.paths = [m.timelinePath('GET', 'timeline?family=doors&limit=50'), m.timelinePath('get', '/api/timeline/summary?window=today'), m.timelinePath('GET', 'timeline'),
  m.timelinePath('GET', 'api/timeline?q=back%20door&until=1793000000'), m.timelinePath('POST', 'timeline'), m.timelinePath('GET', 'timeline/settings'),
  m.timelinePath('GET', 'timeline/pic/abc'), m.timelinePath('GET', 'timeline?x=<script>'), m.timelinePath('GET', 'timeline/../states'), m.timelinePath('GET', 'calendars/calendar.x?start=1'), m.timelinePath('GET', 7)];
const id = 'a'.repeat(32);
const body = { events: [{ id: 1, pics: [{ id, at: 5, url: '/api/timeline/pic/' + id }, { id: 'z', at: 6, url: 'https://elsewhere.example/x.jpg' }, { id: 'y', at: 7, url: '/api/other' }] }, { id: 2, pics: [] }, { id: 3 }], next_before: 4 };
const fixed = m.withTimelineBase(body, '/api/hassio_ingress/abc');
out.pics = [fixed.events[0].pics, fixed.events[1].pics, fixed.events[2].pics === undefined, fixed.next_before, body.events[0].pics[0].url];
out.none = [m.withTimelineBase(body, '').events[0].pics.length, m.withTimelineBase({ ready: true }, '/x'), m.withTimelineBase(null, '/x')];
console.log(JSON.stringify(out));
"""


def run(script: str, *args: str, module: bool = False) -> dict:
    suffix = ".mjs" if module else ".cjs"
    import tempfile
    with tempfile.NamedTemporaryFile("w", suffix=suffix, delete=False) as f:
        f.write(script)
        path = f.name
    try:
        done = subprocess.run([NODE, path, *args], capture_output=True, text=True, timeout=60, env={"TZ": "UTC", "PATH": "/usr/bin:/bin"})
    finally:
        Path(path).unlink(missing_ok=True)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout.strip().splitlines()[-1])


@pytest.fixture(scope="module")
def page() -> dict:
    return run(SCRIPT, str(ROOT / "web/hk/cards/hk-timeline.js"))


def test_days_are_today_yesterday_then_dates(page):
    assert page["days"] == [
        ["2026-11-03", "Today", 2, ["event", "event"]],
        ["2026-11-02", "Yesterday", 1, ["event"]],
        ["2026-11-01", "Sunday, November 1", 1, ["event"]],
        ["2026-10-20", "Tuesday, October 20", 1, ["event"]],
        ["2025-12-24", "Wednesday, December 24, 2025", 1, ["event"]],      # another year says so
    ]


def test_a_busy_day_is_grouped_by_the_hour_and_a_quiet_one_is_not(page):
    # 14 rows from 8 AM at the house, one every 20 minutes: five hours, newest first, each heading before its rows
    assert page["busy"]["count"] == 14
    assert [t for t in page["busy"]["types"] if t != "e"] == ["12 PM", "11 AM", "10 AM", "9 AM", "8 AM"]
    assert page["busy"]["types"][0] == "12 PM" and page["busy"]["types"].count("e") == 14
    assert page["twelve"] == 0                            # twelve is not busy


def test_a_row_written_late_sits_at_the_time_it_happened(page):
    assert page["late"] == [8, 9]                         # id 9 happened at 4 AM, id 8 at 6 AM: 8 first (newest first)


def test_the_day_jump_ends_where_the_next_day_starts_at_the_house(page):
    from datetime import datetime, timezone

    def epoch(iso: str) -> int:
        return int(datetime.fromisoformat(iso).replace(tzinfo=timezone.utc).timestamp())
    assert page["dayEnd"][0] == epoch("2026-11-04T06:00:00")      # midnight in Chicago in November (CST)
    assert page["dayEnd"][1] == epoch("2026-11-02T06:00:00")      # the day the clocks went back: 25 hours, still midnight
    assert page["dayEnd"][2] == epoch("2026-03-09T05:00:00")      # the day they went forward: the next midnight is CDT
    assert page["dayEnd"][3] is None
    assert page["dayKey"] == ["2026-11-02", "2026-11-03"]


def test_who_did_it_in_the_words_the_page_uses(page):
    assert page["who"] == [
        "Emma · Hallway tablet", "Kitchen tablet", "Emma · away", "Mark · home", "Through an assistant for Emma",
        "Through an assistant", "By hand or an automation", "Anna · Hallway tablet · Keypad: Guest", "Emma · Home Assistant",
        None, None, None]


def test_the_count_line(page):
    assert page["count"] == [
        "14 times, 2:10 to 2:40 AM", "14 times, 2:10 to 2:40 AM", "2 packages", None,
        "2:10 to 2:40 AM",              # a row that keeps changing has its count in its title already
        None, None, "3 times, 11:50 PM to 12:30 AM"]
    assert page["range24"] == "14:10 to 14:40"
    assert page["times"] == ["2:04 AM", "2:04 PM", "2 AM", "Nov 1"]
    assert page["exact"] == "Tuesday, November 3, 2026 at 2:04:12 AM"


def test_filters_become_the_path_the_page_reads(page):
    assert page["q0"] == ["timeline?limit=50", False]
    assert page["q1"] == "timeline?family=doors%2Clocks&q=back%20door&until=1793000000&mine=1&before=812&limit=20"
    assert page["q2"] == ["timeline?camera=camera.driveway&limit=50", "timeline?entity=lock.back_door&limit=50"]
    # the live feed filters by kind and camera only; the page does the rest as rows come
    assert page["sub"] == [{"type": "timeline/subscribe"}, {"type": "timeline/subscribe", "family": "doors,cameras", "camera": "camera.x"},
                           {"type": "timeline/subscribe"}]


def test_a_live_row_is_kept_only_where_the_filters_would_show_it(page):
    assert page["matches"] == [True, True, False, True, True, False, True, False, True, False]


def test_show_all_names_its_door_or_camera(page):
    assert page["show"][:3] == [{"entity": "camera.front_door", "camera": True}, {"entity": "binary_sensor.front_door", "camera": False}, None]
    assert page["show"][3:] == ["Show All for Front Door", "Show All for This Camera", "Show All for This Lock", "Show All for This Door"]
    assert page["labels"] == ["Front Door", "Driveway Cam", "Hallway", "Back Door", "Front Door", "Home Alarm", "Mark", "Garage", "", ""]


def test_the_chips_are_the_kinds_a_viewer_could_see(page):
    assert page["chipsAll"] == ["doors", "locks", "garage", "alarm", "people", "doorbell", "cameras", "safety", "system"]
    assert page["chipsWall"] == ["doors", "locks", "garage", "alarm", "doorbell", "cameras"]
    assert page["chipsAdult"] == ["doors", "locks", "people", "cameras"]
    assert page["chipsPeopleWall"] == ["doors"]           # no People on a wall tablet's limited view


def test_the_live_feed_merges_by_id_and_never_changes_what_it_was_given(page):
    assert page["merge"] == [[3, 2, 1], 5, 2, 2]


def test_the_summary_is_overnight_from_five_to_eleven_and_says_what_it_can(page):
    assert page["win"] == ["today", "overnight", "overnight", "today", "today"]
    digest, counts, quiet_night, quiet_day, none = page["sum"]
    assert digest == {"title": "Overnight: quiet", "lines": ["Front door locked all night.", "Garage opened 6:12."], "chips": []}
    assert counts == {"title": "Today", "lines": [], "chips": [{"label": "Doors", "n": 3}, {"label": "Locks", "n": 3}, {"label": "Cameras", "n": 5}, {"label": "System", "n": 2}]}
    assert quiet_night == {"title": "Overnight", "lines": ["A quiet night."], "chips": []}
    assert quiet_day == {"title": "Today", "lines": ["Nothing has happened yet today."], "chips": []}
    assert none["lines"] == ["Nothing has happened yet today."]


def test_the_sheet_says_when_where_who_and_how(page):
    assert page["rows"] == [
        ["Time", "Tuesday, November 3, 2026 at 2:04:12 AM"], ["Where", "Kitchen"], ["Lock", "Back Door"], ["From", "Emma · Hallway tablet"],
        ["Note", "Recorded when the server started again: it was off at the time."], ["Audit Log", "#411"]]
    assert page["rows2"] == [["Time", "Tuesday, November 3, 2026 at 2:10:00 AM"], ["Place", "Work"]]


def test_errors_say_why(page):
    assert page["err"][0] == {"text": "The Timeline isn’t part of this account. Ask an Owner if you need it.", "retry": False}
    assert page["err"][1]["retry"] is True and page["err"][2]["retry"] is True
    assert "Couldn’t load the Timeline" in page["err"][1]["text"]


def test_every_family_has_an_icon(page):
    assert page["look"][0] == {"icon": "hk:package-variant", "color": "brown"}
    assert page["look"][1]["color"] == "green" and page["look"][2]["color"] == "orange"
    assert page["look"][3] == {"icon": "hk:water-alert", "color": "red"}
    assert page["look"][4]["color"] == "orange"
    assert page["look"][5]["icon"] == "hk:bell"


def test_the_adapter_answers_only_the_timelines_two_reads_and_prefixes_pictures():
    got = run(HOST, (ROOT / "web/shim/mantel-host.js").as_uri(), module=True)
    assert got["paths"] == [
        "/api/timeline?family=doors&limit=50", "/api/timeline/summary?window=today", "/api/timeline",
        "/api/timeline?q=back%20door&until=1793000000", None, None, None, None, None, None, None]
    pics, none_, plain, nxt, original = got["pics"]
    assert pics == [{"id": "a" * 32, "at": 5, "url": "/api/hassio_ingress/abc/api/timeline/pic/" + "a" * 32}]    # others dropped
    assert none_ == [] and plain is True and nxt == 4
    assert original == "/api/timeline/pic/" + "a" * 32                  # the answer it was given is untouched
    assert got["none"][0] == 1 and got["none"][1] == {"ready": True} and got["none"][2] is None


def test_the_page_is_wired_in_the_way_the_other_pages_are():
    from mantel_server import hk_cards
    assert "hk-timeline.js" in hk_cards.LAZY                            # loaded when its card is asked for
    assert hk_cards.tags_of(ROOT / "web/hk/cards/hk-timeline.js") == ("hk-timeline-card",)
    assert "'timeline/subscribe'" in (ROOT / "web/client/hk-client.js").read_text()      # the live feed is on the read allowlist
    strategy = (ROOT / "web/hk/cards/hk-strategy.js").read_text()
    assert "custom:hk-timeline-card" in strategy and "hostPage('timeline')" in strategy
    shell = (ROOT / "web/client/hk-host-shell.js").read_text()
    assert "hostPage: function () { return false; }" in shell            # no Timeline in a host that has none


def test_the_day_jump_is_the_calendars_little_month(page):
    m = page["month"]
    assert m["title"] == "November 2026" and m["letters"] == "SMTWTFS"
    # November 1, 2026 is a Sunday: no lead; 30 days end on a Monday, so five whole weeks with six days of December
    assert m["n"] == 35 and m["first"] == {"key": "2026-11-01", "d": 1, "out": False, "today": False, "future": False}
    assert m["last"]["key"] == "2026-12-05" and m["last"]["out"] is True and m["last"]["future"] is True
    assert m["today"] == ["2026-11-05"]
    assert m["future"] == 35 - 5                       # nothing after today can be picked
    assert m["prev"] == "2026-10" and m["next"] is None   # no month after today's
    # a Monday week: Sunday the 1st sits last in a week that began October 26
    assert m["monLetters"] == "MTWTFSS" and m["monFirst"] == "2026-10-26" and m["monN"] == 42
    assert m["janPrev"] == "2025-12" and m["janNext"] == "2026-02"
    assert m["bad"] is None and m["fallback"] == "February 2026"
