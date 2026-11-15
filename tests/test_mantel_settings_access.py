"""Mantel Settings, the Access component (web/shim/settings/access.js; phase 32 "One shape").

A person's page, a role's page and a service account's page draw one Access: what the role allows by default as rows by
area, the grants that add to or take away, and (where a rule says "their rooms") the rooms. Add a Grant opens from it
with Who filled in; a schedule's rows are drawn only once its switch is on.
"""
from __future__ import annotations

import json
import shutil
import subprocess

import pytest

from mantel_server.identity.rbac import DEFAULT_ROLES
from test_mantel_settings_accounts import DATA, rows, labels

TAIL = r"""
const out = {};
const owner = data.me.owner;
out.child = await open(owner, ['mantel', 'people', 'u3']); out.child = await draw();
out.adult = await open(owner, ['mantel', 'people', 'u2']);
out.role = await open(owner, ['mantel', 'roles', 'role', 'child']);
out.owner_role = await open(owner, ['mantel', 'roles', 'role', 'owner']);
out.roles = await open(owner, ['mantel', 'roles']);
out.rules = await open(owner, ['mantel', 'roles', 'role', 'child', 'rules']);
out.grant = await open(owner, ['mantel', 'roles', 'grant', '7']);
out.service = await open(owner, ['mantel', 'service', 's1']);
out.rooms = await open(owner, ['mantel', 'roles', 'rooms', 'user', 'u3']);
let g = await open(owner, ['mantel', 'roles', 'add-grant', 'user', 'u3']);
out.add_off = g;
find(g, 'Only at Certain Times').onChange(true);
out.add_on = await draw();
g = await draw();
find(g, 'Add Grant').onClick();
await tick(); await tick();
out.sent = sent.splice(0);
out.went = went.splice(0);
await find(await open(owner, ['mantel', 'roles', 'rooms', 'user', 'u3']), 'Kitchen').onClick();
await tick();
out.rooms_put = sent.splice(0);
await find(await open(owner, ['mantel', 'roles', 'grant', '7']), 'Remove This Grant…').onClick();
await tick();
out.removed = sent.splice(0);
process.stdout.write(JSON.stringify(out));
"""


def role(name):
    return {**DEFAULT_ROLES[name].to_dict(), "overridden": False}


GRANTS = [{"id": 7, "effect": "allow", "actions": ["control"], "resource_kind": "area", "resource": "garage", "domains": [],
           "roles": [], "users": ["u3"], "devices": [], "schedule": {"start": "07:00", "end": "20:00"}, "note": "after school"}]


def build(tmp_path):
    from js_modules import copy_shim
    copy_shim(tmp_path)
    src = (tmp_path / "script.mjs")
    from test_mantel_settings_accounts import SCRIPT
    head, _, _ = SCRIPT.partition("const out = {};")
    head = head.replace("const m = await import", "globalThis.history = { pushState() {}, replaceState() {} };\nconst m = await import")
    src.write_text(head + TAIL)
    data = json.loads(json.dumps(DATA))
    owner = data["me"]["owner"]
    owner.update(sections=["me", "people", "devices", "roles", "service", "audit"], actions=["view", "control", "control.sensitive", "history", "configure"], resource_kinds=["entity", "domain", "area", "floor", "feature", "all"],
                 features=["cameras", "music"], roles=["owner", "admin", "adult", "child", "guest", "wall_tablet", "service"])
    data["reads"].update({
        "/api/admin/overview": owner,
        "/api/rbac/roles": {"roles": {n: role(n) for n in DEFAULT_ROLES}},
        "/api/rbac/grants": {"grants": GRANTS}, "/api/areas": [{"id": "kitchen", "name": "Kitchen"}, {"id": "garage", "name": "Garage"}],
        "/api/rbac/scopes/user/u3": {"areas": ["garage"]},
        "/api/service-accounts": {"accounts": [{"id": "s1", "name": "script", "scopes": ["state"], "created": 0, "last_used": None, "revoked": False}]}})
    data["answers"]["PUT /api/rbac/scopes/user/u3"] = {"status": 200, "body": {"areas": ["garage", "kitchen"]}}
    (tmp_path / "data.json").write_text(json.dumps(data))
    out = subprocess.run(["node", str(src), str(tmp_path / "mantel-settings.mjs"), str(tmp_path / "data.json")], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


@pytest.fixture(scope="module")
def got(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    return build(tmp_path_factory.mktemp("mantel-settings-access"))


def values(page):
    return {r["label"]: r.get("value") for r in rows(page) if r["kind"] == "info"}


def test_a_childs_page_shows_what_the_role_allows_by_area(got):
    v = values(got["child"])
    assert v["Lights & Switches"] == "Some" and v["Cameras"] == "No" and v["Locks & Garage"] == "No" and v["Alarm"] == "No"
    assert v["Settings"] == "Their Own" and v["Music"] == "Yes"
    assert values(got["adult"])["Locks & Garage"] == "Yes" and values(got["adult"])["Settings"] == "Their Own"
    assert values(got["owner_role"])["Settings"] == "Everything"


def test_the_access_on_a_page_is_the_same_on_a_persons_and_a_roles(got):
    first = lambda page: [r["label"] for r in page["groups"][0 if "Role" not in labels(page) else 1]["rows"]]
    assert first(got["child"]) == first(got["role"])[:-1] + ["Every Rule"][:0] or first(got["child"])[:6] == first(got["role"])[:6]
    [add] = [r for r in rows(got["child"]) if r["label"] == "Add a Grant…"]
    assert add["href"].endswith("/mantel/roles/add-grant/user/u3")
    [add] = [r for r in rows(got["role"]) if r["label"] == "Add a Grant…"]
    assert add["href"].endswith("/mantel/roles/add-grant/role/child")
    assert "Every Rule" in labels(got["role"]) and "Rooms" not in labels(got["adult"]), "rooms only where a rule says their rooms"


def test_a_childs_grants_and_rooms_are_on_their_page(got):
    [grant] = [r for r in rows(got["child"]) if r["kind"] == "nav" and r["href"].endswith("/roles/grant/7")]
    assert grant["label"] == "Allow control on area garage" and "07:00 to 20:00" in grant["sub"] and "after school" in grant["sub"]
    [rooms] = [r for r in rows(got["child"]) if r["label"] == "Rooms"]
    assert rooms["value"] == "Garage" and rooms["href"].endswith("/roles/rooms/user/u3")
    assert [r["label"] for r in rows(got["rooms"])] == ["Kitchen", "Garage"]
    assert got["rooms_put"] == [{"method": "PUT", "path": "/api/rbac/scopes/user/u3", "body": {"areas": ["garage", "kitchen"]}}]


def test_roles_lists_each_role_with_a_line_and_every_grant_once(got):
    page = got["roles"]
    roles = [r for r in rows(page) if r["kind"] == "nav" and "/roles/role/" in r["href"]]
    assert [r["label"] for r in roles] == ["Owner", "Admin", "Adult", "Child", "Guest", "Wall Tablet"]
    assert all(r["sub"] for r in roles)
    grants = [r for r in rows(page) if r["kind"] == "nav" and "/roles/grant/" in r["href"]]
    assert [(g["label"], g["value"]) for g in grants] == [("Riley", "Allow")]


def test_a_grants_page_removes_it_after_asking(got):
    assert "Remove This Grant…" in labels(got["grant"])
    assert got["removed"] == [{"method": "DELETE", "path": "/api/rbac/grants/7", "body": None}]


def test_add_a_grant_has_who_filled_and_time_rows_only_with_a_schedule(got):
    for page in (got["add_off"], got["add_on"]):
        groups = [g.get("header") for g in page["groups"]]
        assert groups[:4] == ["Who", "What", "Allow or Deny", "When"]
        assert [r["value"] for r in rows(page) if r["label"] == "Which"] == ["u3"]
    assert "From" not in labels(got["add_off"]) and {"From", "Until", "Mon"} <= set(labels(got["add_on"]))
    [post] = got["sent"]
    assert post["path"] == "/api/rbac/grants" and post["body"]["users"] == ["u3"] and post["body"]["effect"] == "allow"
    assert got["went"] == ["#/mantel/people/u3"]


def test_a_service_account_shows_what_it_may_reach(got):
    assert values(got["service"])["state"] == "Yes"
    assert "Revoke…" in labels(got["service"])
