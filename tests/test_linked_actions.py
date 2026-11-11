"""HK Frontend's other actions forwarded by Mantel Link and run by Mantel (mantel_server/linked_actions.py;
docs/phase9/MANTEL-LINK.md 9.8): Clean Areas (its plan; one vacuum call per robot), automation snooze (off until a
time, on again then, resumed early, forgotten when someone turns it on) and music (Mantel's engine only, never back to
Home Assistant): every one through the command gateway as the Service actor `mantel:linked`, audited, refused in words
with commands off, and an Owner's deny on that actor wins."""
import json
from datetime import datetime, timedelta, timezone

from mantel_server import linked_actions as LA
from test_features import VACUUM, change, make_env  # noqa: F401
from test_mantel_link_server import Client

AUTO = "automation.porch_lights"
ON = {"linked": {"enabled": True}, "clean_areas": {"enabled": True}}


async def link(env):
    c = Client(env, "domain=mantel; protocol=2; features=bridge")
    await c.connect()
    return c


async def call(c, mid, service, **data):
    res, _ = await c.call(mid, type="call_service", service=service, data=data)
    return res


def automation(env, state="on"):
    env.app["hub"].store.apply_event({"a": {AUTO: {"s": state, "lc": 1.0, "a": {"friendly_name": "Porch lights"}}}})


async def test_commands_off_every_action_is_refused_in_words_and_audited(make_env):
    env = await make_env(settings=ON)
    automation(env)
    c = await link(env)
    res = await call(c, 1, "clean_areas", areas=["kitchen"])
    assert res["error"]["code"] == "commands_disabled" and "nothing was sent" in res["error"]["message"]
    res = await call(c, 2, "pause_automation", entity_id=AUTO)
    assert res["error"]["code"] == "commands_disabled"
    assert env.app["linked_owners"].remembered(LA.KEY) in (None, {}), "nothing paused, nothing to resume"
    rows = env.audit()
    assert rows and all(r["actor"] == "mantel:linked" and r["reason"] == "commands_disabled" for r in rows)
    # a dry run only plans, commands or not
    res = await call(c, 3, "clean_areas", areas=["kitchen"], dry_run=True)
    assert res["success"] and res["result"]["dry_run"] is True and res["result"]["plan"][0]["vacuum"] == VACUUM
    await c.ws.close()


async def test_clean_areas_with_commands_on_as_mantel_linked(make_env):
    env = await make_env(commands=True, settings=ON)
    c = await link(env)
    res = await call(c, 1, "clean_areas", areas=["kitchen"])
    assert res["success"] and res["result"]["ok"] is True and env.fake.sent == ["vacuum.clean_area"]
    row = env.audit(action="vacuum.clean_area")[0]
    assert (row["actor"], row["role"], row["decision"]) == ("mantel:linked", "service", "allowed")
    for bad in ({"areas": []}, {"areas": "kitchen"}, {"areas": ["kitchen"], "rooms": 1}):
        res = await call(c, 2, "clean_areas", **bad)
        assert res["error"]["code"] == "invalid", bad
    await c.ws.close()


async def test_an_owner_s_deny_on_mantel_linked_wins(make_env):
    env = await make_env(commands=True, settings=ON)
    from mantel_server.identity.rbac import Grant
    env.app["rbac"].add_grant(Grant(effect="deny", actions=("control",), resource_kind="entity", resource=VACUUM,
                          users={"mantel:linked"}))
    c = await link(env)
    res = await call(c, 1, "clean_areas", areas=["kitchen"])
    assert res["error"]["code"] == "forbidden" and env.fake.sent == []
    await c.ws.close()


async def test_pause_until_then_on_again_and_resume_early(make_env):
    env = await make_env(commands=True, settings=ON)
    automation(env)
    c = await link(env)
    la = env.app["linked_actions"]
    res = await call(c, 1, "pause_automation", entity_id=AUTO)
    assert res["success"] and env.fake.sent == ["automation.turn_off"]
    until = datetime.fromisoformat(res["result"]["until"][AUTO])
    assert until > datetime.now(timezone.utc) and until.astimezone(env.app["features"].house.local_time().tzinfo).hour == 0
    # not due yet: nothing; due: on again, forgotten
    automation(env, "off")
    assert await la.tick() == [] and env.fake.sent == ["automation.turn_off"]
    soon = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    res = await call(c, 2, "pause_automation", entity_id=[AUTO], until=soon)
    assert await la.tick() == [AUTO] and env.fake.sent[-1] == "automation.turn_on"
    assert env.app["linked_owners"].remembered(LA.KEY) == {}
    # resumed early on request
    await call(c, 3, "pause_automation", entity_id=AUTO)
    res = await call(c, 4, "resume_automation", entity_id=AUTO)
    assert res["success"] and env.fake.sent[-1] == "automation.turn_on" and env.app["linked_owners"].remembered(LA.KEY) == {}
    # someone turned it on in the meantime: the snooze is forgotten, nothing sent
    await call(c, 5, "pause_automation", entity_id=AUTO)
    automation(env, "on")
    n = len(env.fake.sent)
    assert await la.tick() == [] and len(env.fake.sent) == n and env.app["linked_owners"].remembered(LA.KEY) == {}
    for bad in ({"entity_id": "light.porch"}, {"entity_id": AUTO, "until": "soonish"}, {"entity_id": AUTO, "x": 1}):
        res = await call(c, 6, "pause_automation", **bad)
        assert res["error"]["code"] == "invalid", bad
    rows = env.audit(action="automation.turn_off")
    assert rows and all(r["actor"] == "mantel:linked" for r in rows)
    await c.ws.close()


async def test_music_runs_on_mantel_s_engine_only(make_env, monkeypatch):
    env = await make_env(commands=True, settings=ON)
    c = await link(env)
    res = await call(c, 1, "music_play", rooms=["media_player.kitchen"], playlist="Morning")
    assert res["error"]["code"] == "not_set_up" and "music" in res["error"]["message"].lower()
    assert env.fake.sent == [], "never sent back to Home Assistant's hk_frontend (it may be Mantel Link's own)"
    sent = []

    class Engine:
        active = True
    env.app["music"] = Engine()

    async def command(self, domain, service, data, peer, return_response=False):
        sent.append((domain, service, dict(data), return_response))
        return {"ok": True, "leader": "media_player.kitchen"}
    monkeypatch.setattr(LA.LinkedActions, "command", command)
    res = await call(c, 2, "music_play", rooms=["media_player.kitchen"], playlist="Morning")
    assert res["success"] and res["result"] == {"ok": True, "leader": "media_player.kitchen"}
    assert sent == [("hk_frontend", "music_play", {"rooms": ["media_player.kitchen"], "playlist": "Morning"}, True)]
    await c.ws.close()


def test_mantel_linked_s_grants_are_exactly_what_these_actions_act_on():
    from types import SimpleNamespace
    host = SimpleNamespace(on=lambda p: p == "clean_areas",
                           clean_coverage=lambda: {"coverage": [{"vacuum": "vacuum.robot", "taking_part": True},
                                                                {"vacuum": "vacuum.idle", "taking_part": False}]})
    la = LA.LinkedActions({"features": host})
    got = {(g.resource_kind, g.resource) for g in la.grants()}
    assert got == {("domain", "automation"), ("domain", "media_player"), ("feature", "music"),
                   ("entity", "vacuum.robot")}
    assert all(g.users == frozenset({"mantel:linked"}) and g.effect == "allow" for g in la.grants())
