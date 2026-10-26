"""Mantel Settings, About -> Performance (web/shim/settings/performance.js over performance.py's GET /api/performance).

An Owner or Admin (the `performance` section) sees a Performance row in About, and its page: the server's fan-out, the
HA event rate and connected screens, then one row per wall tablet with up since, memory, reconnects and slowest start.
Anyone else gets no row, and the address shows About. Drawn in node with the recording kit stub of the other pages' tests.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from js_modules import copy_shim

ROOT = Path(__file__).resolve().parents[1]

SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: '' };
globalThis.location = { hostname: 'mantel.example', hash: '', search: '', pathname: '/settings' };
const plain = (o) => (o == null ? o : typeof o === 'object' ? (o._text !== undefined ? o._text : JSON.stringify(o)) : o);
const row = (kind) => (o) => ({ kind, label: o.label, sub: plain(o.sub), value: o.value, href: o.href, fk: o.fk, onClick: o.onClick });
window.hkSettingsKit = {
  group: (o, rows) => ({ kind: 'group', header: o.header || null, footer: plain(o.footer), rows: rows.filter(Boolean) }),
  info: row('info'), nav: row('nav'), button: row('button'), toggle: row('toggle'), text: row('text'), select: row('select'),
  check: row('check'), confirm: async () => true, h: (tag, attrs) => ({ _text: (attrs && attrs.text) || '' }),
};
const reads = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const asked = [];
globalThis.fetch = async (u) => {
  const path = String(u);
  asked.push(path);
  if (!(path in reads)) throw new Error('unexpected ' + path);
  return { ok: true, status: 200, json: async () => reads[path] };
};
const m = await import(process.argv[2]);
const tick = () => new Promise((r) => setTimeout(r, 0));
const panel = { render() {}, status() {}, go() {}, shadowRoot: null };
async function draw(me, route) {
  m._reset(me);
  let kids = [], page = null;
  for (let i = 0; i < 3; i++) {
    const c = { kids: [], appendChild(k) { this.kids.push(k); return k; } };
    page = m.host.page(route, panel);
    page.body(c);
    kids = c.kids;
    await tick(); await tick();
  }
  return { title: page.title, back: page.back || null, groups: kids };
}
const cases = JSON.parse(process.argv[4]);
const out = {};
for (const [name, me] of Object.entries(cases)) {
  out[name] = { about: await draw(me, ['mantel', 'about']), perf: await draw(me, ['mantel', 'about', 'performance']) };
}
out.asked = asked;
process.stdout.write(JSON.stringify(out));
"""


def overview(role, sections):
    return {"user": {"id": "u1", "name": f"Fictional {role}", "username": role, "role": role, "kind": "mantel",
                     "totp": False, "passkeys": 0},
            "door": "lan", "csrf": "x", "now": 0, "at_tablet": False, "sections": sections, "roles": [], "device_roles": [],
            "actions": [], "resource_kinds": [], "features": [], "service_scopes": [], "connect_port": None, "ha_set_up": True}


ABOUT = {"product": "Mantel", "version": "1.2.3", "commit": "dev", "build": "x", "staged": None, "install": "Container",
         "started": 1000, "uptime_s": 5, "python": "3.13", "home_assistant": {"version": "2026.10", "connected": True},
         "music_assistant": {"version": None, "configured": False}, "linked": [], "commands": False, "docs": "/docs"}
PERF = {"now": 1_700_000_000.0, "screens": [
    {"name": "Kitchen", "kind": "tablet", "page": "home", "up_since": 1_700_000_000.0 - 3 * 3600, "memory_mb": 77,
     "reconnects": 2, "registry_refreshes": 0, "slowest_start_ms": 2300, "last_seen": 1_700_000_000.0 - 30},
    {"name": "Hall", "kind": "tablet", "page": "home", "up_since": None, "memory_mb": None, "reconnects": None,
     "registry_refreshes": None, "slowest_start_ms": None, "last_seen": 1_700_000_000.0 - 30},
    {"name": "Avery", "kind": "person", "page": "settings", "up_since": 1_700_000_000.0 - 600, "memory_mb": 31,
     "reconnects": 0, "registry_refreshes": 0, "slowest_start_ms": 840, "last_seen": 1_700_000_000.0 - 30}],
    "server": {"fan_out": {"samples": 120, "p50_ms": 3.5, "p95_ms": 11.25}, "ha_events_per_min": 42.0, "connected_screens": 3}}


@pytest.fixture(scope="module")
def got(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("mantel-settings-performance")
    copy_shim(d)
    (d / "script.mjs").write_text(SCRIPT)
    (d / "reads.json").write_text(json.dumps({"/api/about": ABOUT, "/api/performance": PERF}))
    cases = {"owner": overview("owner", ["me", "about", "performance"]), "adult": overview("adult", ["me", "about"])}
    run = subprocess.run(["node", str(d / "script.mjs"), str(d / "mantel-settings.mjs"), str(d / "reads.json"), json.dumps(cases)],
                         capture_output=True, text=True, timeout=60)
    assert run.returncode == 0, run.stderr
    return json.loads(run.stdout)


def rows(groups):
    return [r for g in groups for r in g.get("rows") or []]


def test_a_manager_sees_a_performance_row_in_about(got):
    nav = next(r for r in rows(got["owner"]["about"]["groups"]) if r["label"] == "Performance")
    assert nav["kind"] == "nav" and nav["href"] == "#/mantel/about/performance"


def test_the_performance_page_draws_the_server_and_one_row_per_tablet(got):
    page = got["owner"]["perf"]
    assert page["title"] == "Performance" and page["back"] == ["About", "#/mantel/about"]
    server = next(g for g in page["groups"] if g["header"] == "Mantel")
    by = {r["label"]: r for r in server["rows"]}
    assert by["Fan-Out Time"]["value"] == "p50 3.5 ms · p95 11 ms"
    assert by["Home Assistant Events"]["value"] == "42 a minute" and by["Connected Screens"]["value"] == "3"
    tablets = next(g for g in page["groups"] if g["header"] == "Wall Tablets")
    assert [r["label"] for r in tablets["rows"]] == ["Kitchen", "Hall"]
    kitchen = tablets["rows"][0]
    assert kitchen["value"] == "Up 3 h"
    for part in ("Memory 77 MB", "2 reconnects", "Slowest start 2.3 s", "Dashboard"):
        assert part in kitchen["sub"]
    hall = tablets["rows"][1]
    assert hall["value"] == "—" and "Memory" not in hall["sub"] and "reconnect" not in hall["sub"]
    people = next(g for g in page["groups"] if g["header"] == "Browsers")
    assert people["rows"][0]["label"] == "Avery" and "Settings page" in people["rows"][0]["sub"]


def test_everyone_else_gets_no_row_and_no_page(got):
    adult = got["adult"]
    assert not any(r["label"] == "Performance" for r in rows(adult["about"]["groups"]))
    assert adult["perf"]["title"] == "About"
    assert got["asked"].count("/api/performance") == 1, "only the manager's page asks the server"
