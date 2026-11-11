"""A Mantel page's own Clean Areas and automation snooze, run by Mantel's engines as the person who asked
(mantel_server/linked/linked_actions.py `direct_of` / `run_direct`, the gateway's `_direct`; docs/phase9/MANTEL-LINK.md 9.8).

Once Mantel Link holds the bridge, the page's `hk_frontend.clean_areas` / `pause_automation` / `resume_automation` no
longer goes to Home Assistant to come back over the link: the same engines run here, each vacuum and automation call
through the gateway as the PERSON (their grants, their audit row), never as `mantel:linked`. While HK Frontend still
holds the bridge, the call goes to Home Assistant's `hk_frontend` exactly as before."""
from mantel_server.linked import linked_actions as LA
from mantel_server.identity.rbac import Grant
from test_features import VACUUM, make_env  # noqa: F401
import gateway_fakes as GF

AUTO = "automation.porch_lights"
ON = {"clean_areas": {"enabled": True}}


def mantel_bridge(env):
    env.app["linked_owners"].set_bridge("mantel", by="test", role="owner")


def automation(env, state="on"):
    env.app["hub"].store.apply_event({"a": {AUTO: {"s": state, "lc": 1.0, "a": {"friendly_name": "Porch lights"}}}})


def clean(**data):
    return {"kind": "service", "domain": "hk_frontend", "service": "clean_areas", "data": data, "return_response": True}


def snooze(service, **data):
    return {"kind": "service", "domain": "hk_frontend", "service": service, "data": data}


async def asking(env, who, role, body):
    await env.login(who, role)
    ws = await env.socket()
    try:
        return await env.command(ws, **body)
    finally:
        await ws.close()


def actors(env):
    return {r["actor"] for r in env.audit()}


async def test_while_hk_frontend_holds_the_bridge_it_still_goes_to_home_assistant(make_env):
    env = await make_env(commands=True, settings=ON)
    automation(env)
    assert env.app["linked_owners"].bridge() == "hk_frontend"
    got = await asking(env, "owner1", "owner", clean(areas=["kitchen"]))
    assert env.fake.sent == ["hk_frontend.clean_areas"], "HK Frontend's own, as today"
    got = await asking(env, "owner1", "owner", snooze("pause_automation", entity_id=AUTO))
    assert env.fake.sent == ["hk_frontend.clean_areas", "hk_frontend.pause_automation"]
    assert env.app["linked_owners"].remembered(LA.KEY) in (None, {}), "no second snooze store beside HK's"


async def test_clean_areas_runs_here_as_the_person_who_asked(make_env):
    env = await make_env(commands=True, settings=ON)
    mantel_bridge(env)
    got = await asking(env, "adult1", "adult", clean(areas=["kitchen"]))
    assert got["type"] == "command_result" and got["result"]["response"]["ok"] is True, got
    assert env.fake.sent == ["vacuum.clean_area"], "one vacuum call; nothing for hk_frontend"
    rows = env.audit(action="vacuum.clean_area")
    assert [(r["role"], r["decision"]) for r in rows] == [("adult", "allowed")]
    assert rows[0]["actor"] != "mantel:linked" and VACUUM in str(rows[0])
    assert "mantel:linked" not in actors(env), "never the service identity"
    # the same through a page's call_service WebSocket message, a dry run: only the plan, nothing sent
    ws_body = {"kind": "ws", "msg": {"type": "call_service", "domain": "hk_frontend", "service": "clean_areas",
                                     "service_data": {"areas": ["kitchen"], "dry_run": True}, "return_response": True}}
    got = await asking(env, "adult1", "adult", ws_body)
    assert got["result"]["response"]["dry_run"] is True and got["result"]["response"]["plan"][0]["vacuum"] == VACUUM
    assert env.fake.sent == ["vacuum.clean_area"]


async def test_it_works_with_no_link_to_home_assistant_at_all(make_env):
    env = await make_env(commands=True, settings=ON)      # no Mantel Link client ever connects
    mantel_bridge(env)
    assert not env.app["linked"].sessions if hasattr(env.app["linked"], "sessions") else True
    got = await asking(env, "owner1", "owner", clean(areas=["kitchen"]))
    assert got["result"]["response"]["ok"] is True and env.fake.sent == ["vacuum.clean_area"]


async def test_the_person_s_grants_decide_clean_areas(make_env):
    env = await make_env(commands=True, settings=ON)
    mantel_bridge(env)
    got = await asking(env, "guest1", "guest", clean(areas=["kitchen"]))
    assert got["error"]["code"] == "forbidden" and got["error"]["target"] == VACUUM and env.fake.sent == []
    assert [(r["role"], r["decision"], r["result"]) for r in env.audit(action="vacuum.clean_area")] == \
        [("guest", "denied", "not_sent")], "refused and audited as that person"
    # a dry run shows only robots they may see
    dry = clean(areas=["kitchen"], dry_run=True)
    got = await asking(env, "guest1", "guest", dry)
    assert got["error"]["code"] == "forbidden" and VACUUM in got["error"]["message"]
    # an Owner's deny on one person, whatever their role
    env.app["rbac"].add_grant(Grant(effect="deny", actions=("control",), resource_kind="entity", resource=VACUUM,
                                    users={(await env.login("adult2", "adult"))["user"]["id"]}))
    got = await asking(env, "adult2", "adult", clean(areas=["kitchen"]))
    assert got["error"]["code"] == "forbidden" and env.fake.sent == []
    got = await asking(env, "adult1", "adult", clean(areas=["kitchen"]))
    assert got["result"]["response"]["ok"] is True, "another person is not affected"


async def test_clean_areas_off_or_wrong_is_refused_in_words_and_sends_nothing(make_env):
    env = await make_env(commands=True)                              # Clean Areas not on in Mantel
    mantel_bridge(env)
    got = await asking(env, "owner1", "owner", clean(areas=["kitchen"]))
    assert got["error"]["code"] == "unavailable" and "Clean Areas is off" in got["error"]["message"]
    env = await make_env(commands=True, settings=ON)
    mantel_bridge(env)
    for bad in ({"areas": []}, {"areas": "kitchen"}, {"areas": ["kitchen"], "rooms": 1}):
        got = await asking(env, "owner1", "owner", clean(**bad))
        assert got["error"]["code"] == "invalid_command", bad
    assert env.fake.sent == []


async def test_pause_and_resume_are_the_person_s_own_calls(make_env):
    env = await make_env(commands=True, settings=ON)
    mantel_bridge(env)
    automation(env)
    got = await asking(env, "adult1", "adult", snooze("pause_automation", entity_id=AUTO))
    assert got["type"] == "command_result" and got["result"] == {}, got
    assert env.fake.sent == ["automation.turn_off"]
    rows = env.audit(action="automation.turn_off")
    assert [(r["role"], r["decision"], r["sensitive"] is not None) for r in rows] == [("adult", "allowed", True)]
    assert rows[0]["actor"] != "mantel:linked"
    held = env.app["linked_owners"].remembered(LA.KEY)
    assert list(held) == [AUTO], "Mantel keeps the snooze and turns it on again at midnight"
    got = await asking(env, "adult1", "adult", snooze("resume_automation", entity_id=AUTO))
    assert env.fake.sent == ["automation.turn_off", "automation.turn_on"]
    assert env.audit(action="automation.turn_on")[0]["role"] == "adult"
    assert env.app["linked_owners"].remembered(LA.KEY) == {}
    assert "mantel:linked" not in actors(env)


async def test_a_person_without_the_right_cannot_snooze_an_automation(make_env):
    env = await make_env(commands=True, settings=ON)
    mantel_bridge(env)
    automation(env)
    got = await asking(env, "guest1", "guest", snooze("pause_automation", entity_id=AUTO))
    assert got["error"]["code"] == "forbidden" and env.fake.sent == []
    assert env.audit(action="automation.turn_off")[0]["decision"] == "denied"
    assert env.app["linked_owners"].remembered(LA.KEY) in (None, {}), "nothing paused, nothing to resume"
    for bad in ({"entity_id": "light.porch"}, {"entity_id": AUTO, "until": "soonish"}, {"entity_id": AUTO, "x": 1}):
        got = await asking(env, "owner1", "owner", snooze("pause_automation", **bad))
        assert got["error"]["code"] == "invalid_command", bad


async def test_commands_off_nothing_is_sent_and_no_engine_runs(make_env):
    env = await make_env(settings=ON)                                # house commands off: no gateway at all
    mantel_bridge(env)
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    got = await env.command(ws, **clean(areas=["kitchen"]))
    assert got["type"] == "error" and got["code"] == "commands_disabled" and env.app["commander"] is None
    assert env.audit(action="vacuum.clean_area") == []
    await ws.close()


async def test_the_timer_still_turns_it_on_again_as_mantel_itself(make_env):
    from datetime import datetime, timedelta, timezone
    env = await make_env(commands=True, settings=ON)
    mantel_bridge(env)
    automation(env)
    until = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    await asking(env, "adult1", "adult", snooze("pause_automation", entity_id=AUTO, until=until))
    automation(env, "off")
    assert await env.app["linked_actions"].tick() == [AUTO] and env.fake.sent[-1] == "automation.turn_on"
    on = env.audit(action="automation.turn_on")
    assert on and on[-1]["actor"] == "mantel:linked", "the timer is nobody's button: Mantel's own"


async def test_other_hk_frontend_services_are_not_taken(make_env):
    env = await make_env(commands=True, settings=ON)
    mantel_bridge(env)
    got = await asking(env, "owner1", "owner", {"kind": "service", "domain": "hk_frontend", "service": "show_popup",
                                                "data": {"x": 1}})
    assert env.fake.sent == ["hk_frontend.show_popup"], "only Clean Areas and the snooze run here"
    got = await asking(env, "owner1", "owner",
                       {"kind": "service", "domain": "hk_frontend", "service": "clean_areas",
                        "target": {"entity_id": VACUUM}, "data": {"areas": ["kitchen"]}})
    assert env.fake.sent[-1] == "hk_frontend.clean_areas", "a malformed call falls through to the usual path"
