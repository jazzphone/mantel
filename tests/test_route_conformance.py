"""Phase 18, A3: every read declared ``reads="view"`` or ``feature:<name>`` shows only what its caller may view.

A fictional house has things a Child (and a wall tablet in no room) may not view: a lock, a camera, a speaker and
a whole area. Every GET the route table (route_table.py) declares ``view`` or ``feature:*`` is called as a Child and
as a wall tablet, and none of those ids, names or the area's name may appear anywhere in the answer (a deep string
search). This is the third audit's SRV-4/SRV-5 test, written once for every route; a new ``view`` read is in it
from its first commit. Every name and address here is invented.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from test_devices import enroll
from test_mcp import house

SECRETS = ("lock.vault_door", "Vault Door Secret", "camera.vault_watch", "Vault Watch Secret",
           "media_player.vault_speaker", "Vault Speaker Secret", "Vault Room Secret", "vault_room")
# a path parameter filled with a thing the caller may not view, where the route names one
PARAM = {"entity_id": {"camera": "camera.vault_watch", "person": "person.vault_keeper",
                       "media": "media_player.vault_speaker"}}


def secret_house(m) -> None:
    house(m)
    reg = m.app["hub"].registry
    reg.areas["vault_room"] = "Vault Room Secret"
    for eid, name in (("lock.vault_door", "Vault Door Secret"), ("camera.vault_watch", "Vault Watch Secret"),
                      ("media_player.vault_speaker", "Vault Speaker Secret")):
        reg.entity_area[eid] = "vault_room"
        reg.by_area.setdefault("vault_room", set()).add(eid)
        m.app["hub"].store.states[eid] = {"s": "on", "a": {"friendly_name": name}, "lc": 0, "lu": 0}


def declared(app, *kinds: str) -> list:
    rows = app["route_table"]
    return [r for r in rows if r.method == "GET" and r.policy is not None and r.policy.reads is not None
            and (r.policy.reads in kinds or any(k.endswith(":") and r.policy.reads.startswith(k) for k in kinds))]


def path_for(row) -> str | None:
    path = row.path
    if "{entity_id}" in path:
        kind = "camera" if "/camera/" in path else "person" if "/person/" in path else "media"
        return path.replace("{entity_id}", PARAM["entity_id"][kind])
    return row.sample()


def hidden_from(m, ident) -> tuple[str, ...]:
    """The secrets this identity may not view, by the app's own policy (an id and its name go together); the area's
    name and id are hidden when nothing in it may be viewed."""
    from mantel_server.authz import Principal
    authz = m.app["authz"]
    p = Principal(ident, authz.subject_of(ident))
    out: list[str] = []
    pairs = (("lock.vault_door", "Vault Door Secret"), ("camera.vault_watch", "Vault Watch Secret"),
             ("media_player.vault_speaker", "Vault Speaker Secret"))
    for eid, name in pairs:
        if not authz.decide(p.subject, "view", eid).allowed:
            out += [eid, name]
    if len(out) == 2 * len(pairs):
        out += ["Vault Room Secret", "vault_room"]
    return tuple(out)


async def leaks(m, rows, secrets=SECRETS) -> list[str]:
    out = []
    for row in rows:
        path = path_for(row)
        if path is None or path in ("/ws", "/ws/talk"):        # sockets: the socket tests cut them (SRV-4)
            continue
        r = await m.client.get(path, headers=m.headers(False))
        body = (await r.read()).decode("utf-8", "replace")
        for secret in secrets:
            if secret in body:
                out.append(f"{row.key} ({r.status}) shows {secret!r}")
    return out


async def test_a_child_reads_nothing_it_may_not_view_from_any_view_read(mantel):
    secret_house(mantel)
    await mantel.user("kid", "child")
    await mantel.sign_in("kid")
    rows = declared(mantel.app, "view", "feature:")
    assert len(rows) >= 10
    assert await leaks(mantel, rows) == []


async def test_a_wall_tablet_reads_nothing_it_may_not_view_from_any_view_read(mantel):
    secret_house(mantel)
    await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    r, got = await enroll(mantel)                       # a wall tablet in the kitchen: its room's things
    assert r.status == 201, got
    cookie = r.cookies["mantel_device"].value
    mantel.forget_cookies()
    mantel.set_cookies(mantel_device=cookie)
    me = await (await mantel.get("/api/session")).json()
    assert me.get("device") is not None and me.get("user") is None, me
    from mantel_server.sessions import Device, Identity
    d = got["device"]
    hidden = hidden_from(mantel, Identity(None, Device(d["id"], d["name"], d["role"], d["room"]), "lan"))
    assert "lock.vault_door" in hidden and "media_player.vault_speaker" in hidden, hidden
    assert await leaks(mantel, declared(mantel.app, "view", "feature:"), hidden) == []


async def test_an_owner_is_shown_the_secret_house_so_the_search_can_see_a_leak(mantel):
    """The other side: the search finds the names where they may be shown (else it proves nothing)."""
    secret_house(mantel)
    await mantel.user("olive", "owner")
    await mantel.sign_in("olive")
    found = await leaks(mantel, [r for r in declared(mantel.app, "view") if r.path in ("/api/entities", "/api/areas")])
    assert any("Vault Room Secret" in f for f in found) and any("lock.vault_door" in f for f in found), found


@pytest.mark.parametrize("role", ["child", "adult"])
async def test_the_busiest_entities_and_every_screens_counters_are_for_managers_only(mantel, role):
    """``GET /api/stats`` gave any session, a Child included, the 15 busiest entity ids and every screen's counters
    (found by the route table, 2026-11-03). No page calls it: Owners and Admins only (decision 3)."""
    await mantel.user("kid", role)
    await mantel.sign_in("kid")
    r = await mantel.get("/api/stats")
    assert r.status == 403
    await mantel.user("olive", "owner")
    mantel.forget_cookies()
    await mantel.sign_in("olive")
    assert (await mantel.get("/api/stats")).status == 200


# each kind of long-lived answer, and the test that a revocation ends it within one turn of the loop
LIVE_TESTS = {
    "live:hub": ("test_live", "test_a_page_socket_ends_at_once_when_its_session_is_revoked"),
    "live:talk": ("test_live", "test_a_live_talk_ends_at_once_when_its_session_is_revoked"),
    "live:linked": ("test_live", "test_mantel_link_ends_at_once_when_its_credential_is_revoked"),
    "live:media_proxy": ("test_media_proxy", "test_a_revocation_ends_an_open_stream_at_once"),
}


def test_every_live_route_has_a_revocation_test():
    import importlib
    table = json.loads((Path(__file__).parent / "fixtures/route_table.lock.json").read_text())
    kinds = {c["stream"] for c in table.values() if (c.get("stream") or "").startswith("live:")}
    assert kinds, "the table names live routes"
    assert kinds <= set(LIVE_TESTS), f"a live route with no revocation test: {sorted(kinds - set(LIVE_TESTS))}"
    for module, name in LIVE_TESTS.values():
        assert callable(getattr(importlib.import_module(module), name, None)), f"{module}.{name}"


async def test_a_manager_signed_in_at_a_wall_tablet_manages_only_their_own_sessions_and_apps(mantel):
    """``GET /api/sessions``, ``DELETE /api/sessions/{id}``, ``GET /api/app/devices?all=1`` and its revoke take a wall
    tablet's session (a person's own Me page there): another person's were People's, and a manager's forgotten sign-in
    on the kitchen tablet listed and ended everyone's (the route table's review, 2026-11-03)."""
    from test_route_guard_gaps import at_a_tablet
    other = await mantel.user("jordan", "adult")
    sid = mantel.app["sessions"].create(other, "lan", "password", now=mantel.now[0]).session_id
    await at_a_tablet(mantel, "owner")
    r = await mantel.get(f"/api/sessions?user_id={other}")
    assert r.status == 403, await r.text()
    assert (await mantel.get("/api/sessions")).status == 200          # their own, as before
    assert (await mantel.get("/api/app/devices?all=1")).status == 403
    assert (await mantel.get("/api/app/devices")).status == 200
    r = await mantel.client.delete(f"/api/sessions/{sid}", headers=mantel.headers())
    assert r.status == 403
    assert mantel.app["sessions"].get(sid)["revoked"] is None

