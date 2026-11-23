"""The People block's cluster and rows (web/hk/cards/hk-people.js, round 12, 2026-11-23): who is home as solid circles stacked in the order
they came home -- the latest on top -- and the rows, home newest first, then away. The pure part, run in node; the drawing is
hosts/ha/custom_components/hk_frontend/tests/test_kit_round12.js."""
from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node") or "/opt/homebrew/bin/node"
needs_node = pytest.mark.skipif(not Path(NODE).exists(), reason="no node")

SCRIPT = r"""
const fs = require('fs');
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
(0, eval)(fs.readFileSync(process.argv[2], 'utf8'));
const L = window.hkPeople.lib;
const p = (name, home, at, where) => ({ id: 'person.' + name.toLowerCase(), name, first: name, home, at, where: where || (home ? 'Home' : 'Away') });
const four = [p('Sam', true, 400), p('Robin', true, 900), p('Alex', false, 300, 'Work'), p('Jordan', false, 700, 'School')];
const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((n, i) => p(n, true, 100 * (i + 1)));
const short = (c) => c.map((x) => [x.person ? x.person.name : '+' + x.more, x.last]);
console.log(JSON.stringify({
  arrivals: L.arrivals(four).map((x) => x.name),
  tie: L.arrivals([p('Zed', true, 5), p('Amy', true, 5)]).map((x) => x.name),
  one: short(L.cluster([p('Sam', true, 1)])), none: L.cluster([p('Sam', false, 1)]).length,
  two: short(L.cluster(four)), r2: L.cluster(four)[0].r,
  six: short(L.cluster(six)), sixMore: L.cluster(six)[0].more, sixR: L.cluster(six)[0].r,
  rows: L.rowOrder(four).map((x) => x.name),
  words: [L.rowWords(four[0], '5:40 PM'), L.rowWords(four[0], ''), L.rowWords(four[2], '8:05 AM'), L.rowWords(four[2], '')],
  sum: [L.summary(four), L.summary(four.slice(0, 2)), L.summary([p('Sam', false, 1, 'Work'), p('Amy', false, 2)]), L.summary([])],
  spots: Object.keys(L.SPOTS).map((k) => L.SPOTS[k].length)
}));
"""


@pytest.fixture(scope="module")
def got() -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".cjs", delete=False) as f:
        f.write(SCRIPT)
        path = f.name
    try:
        done = subprocess.run([NODE, path, str(ROOT / "web/hk/cards/hk-people.js")], capture_output=True, text=True, timeout=60, env={"TZ": "UTC", "PATH": "/usr/bin:/bin"})
    finally:
        Path(path).unlink(missing_ok=True)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout.strip().splitlines()[-1])


@needs_node
def test_the_circles_are_stacked_in_the_order_people_came_home(got):
    assert got["arrivals"] == ["Sam", "Robin"]                       # the one who came home first first: the latest is drawn last, on top
    assert got["tie"] == ["Amy", "Zed"]                              # a tie by name, so it never moves between draws
    assert got["two"] == [["Sam", False], ["Robin", True]]           # only the last is the one on top


@needs_node
def test_one_person_is_one_big_circle_and_nobody_is_none(got):
    assert got["one"] == [["Sam", True]] and got["none"] == 0


@needs_node
def test_more_than_four_are_the_four_latest_and_a_plus_n_circle_under_them(got):
    assert got["six"] == [["+2", False], ["C", False], ["D", False], ["E", False], ["F", True]]
    assert got["sixMore"] == 2 and got["sixR"] < got["r2"]           # five circles are smaller than two


@needs_node
def test_every_count_has_a_place_for_each_circle(got):
    assert got["spots"] == [1, 2, 3, 4, 5]


@needs_node
def test_the_rows_are_home_newest_first_then_away_the_one_who_left_last_first(got):
    assert got["rows"] == ["Robin", "Sam", "Jordan", "Alex"]
    assert got["words"] == ["Home · since 5:40 PM", "Home", "Work · left 8:05 AM", "Work"]


@needs_node
def test_the_count_and_who_is_away(got):
    four, two, nobody, empty = got["sum"]
    assert (four["title"], four["sub"], four["home"], four["away"]) == ("2 Home", "Jordan, Alex away", 2, 2)
    assert (two["title"], two["sub"]) == ("2 Home", "Everyone")
    assert (nobody["title"], nobody["sub"]) == ("Nobody Home", "Amy, Sam away")   # the one who left last is named first
    assert (empty["title"], empty["sub"]) == ("Nobody Home", "Nobody added")
