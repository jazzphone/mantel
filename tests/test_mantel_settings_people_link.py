"""Mantel Settings → People: Home Assistant's users, each once (people_ha.py; decision 29 "people in one list").

People lists each Home Assistant user who is a person here (or an admin, who must be one to save from Home
Assistant), each linked to an EXISTING person by a picker; the rest are under Other Home Assistant Users; a wall
tablet's HA user is on Devices. Without Home Assistant's user list (Mantel outside the App or Mantel Connect), the
footer keeps the server's link command.
"""
from __future__ import annotations

import json
import shutil
import subprocess

import pytest

from test_mantel_settings_accounts import DATA, SCRIPT, labels, footers

PREFIX = "/api/hassio_ingress/fictional0token"
HEAD, _, _ = SCRIPT.partition("const out = {};")
TAIL = r"""
const out = {};
const owner = data.me.owner;
const g = await open(owner, ['mantel', 'people']);
out.people = g;
const link = rowsOf(g).find((r) => r.label === 'Link Home Assistant Users…');
if (link) { link.onClick(); }
out.went = assigned;
process.stdout.write(JSON.stringify(out));
"""


HA_PEOPLE = {"users": [
    {"id": "h1", "name": "Avery", "admin": True, "person": {"id": "u1", "name": "Fictional Owner", "role": "owner", "kind": "hk"}, "tablet": None},
    {"id": "h2", "name": "claude", "admin": True, "person": None, "tablet": None},
    {"id": "h3", "name": "kitchen", "admin": False, "person": None, "tablet": {"device_id": "d1", "name": "Kitchen"}},
    {"id": "h4", "name": "mqtt-user", "admin": False, "person": None, "tablet": None}],
    "people": [{"id": "u1", "name": "Fictional Owner", "role": "owner", "kind": "hk"},
               {"id": "u2", "name": "Fictional Adult", "role": "adult", "kind": "hk"}],
    "devices": [{"id": "d1", "name": "Kitchen"}], "error": None}


def run(tmp_path, ha_people):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    from test_mantel_settings import node_modules
    node_modules(tmp_path)
    head = HEAD.replace("pathname: '/settings' };", "pathname: '/settings', assign(u) { assigned.push(u); } };\nconst assigned = [];\n"
                        "globalThis.history = { pushState() {}, replaceState() {} };\nglobalThis.open = () => null;")
    (tmp_path / "script.mjs").write_text(head + TAIL)
    data = json.loads(json.dumps(DATA))
    data["reads"]["/api/people/ha"] = ha_people
    (tmp_path / "data.json").write_text(json.dumps(data))
    out = subprocess.run(["node", str(tmp_path / "script.mjs"), str(tmp_path / "mantel-settings.mjs"),
                          str(tmp_path / "data.json")], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_people_lists_home_assistant_s_people_once_linked_to_existing_people(tmp_path):
    got = run(tmp_path, HA_PEOPLE)
    page = got["people"]["groups"] if isinstance(got["people"], dict) else got["people"]
    g = next(x for x in page if isinstance(x, dict) and x.get("header") == "Home Assistant Users")
    rows = {r["label"]: r for r in g["rows"]}
    assert list(rows) == ["Avery", "claude", "Other Home Assistant Users"], "persons and admins; tablets on Devices"
    assert rows["Avery"]["kind"] == "select" and rows["Avery"]["value"] == "u1"
    assert [o[0] for o in rows["Avery"]["options"]] == ["", "u1", "u2"], "an existing person, never a new account"
    assert rows["Other Home Assistant Users"]["value"] == "1", "mqtt-user"
    assert "Link Home Assistant Users…" not in labels(got["people"])


def test_without_home_assistant_s_users_people_keeps_the_link_command(tmp_path):
    got = run(tmp_path, {"users": [], "people": [], "devices": [], "error": "Home Assistant’s users are read inside Home Assistant."})
    assert "mantel-server link" in footers(got["people"])
