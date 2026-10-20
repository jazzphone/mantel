"""Mantel's notifications on people's phones through Mantel Link and the Companion app (mantel_server/phones.py;
docs/phase9/MANTEL-LINK.md 9.7): the phones Mantel Link reported; each person's phones and what goes there (Owner or
Admin, audited; Important only by default); who a notification goes to (everyone's, the people it names, never one
for some screens only); `phone_notify` to Mantel Link; a Dismiss on a phone takes the banner down on the screens."""
import json

from test_features import events, make_env, next_event  # noqa: F401
from test_mantel_link_server import Client, LINKED_ON

PHONES = [{"service": "mobile_app_averys_iphone", "name": "Avery's iPhone"},
          {"service": "mobile_app_pixel", "name": "Pixel"}]


async def link_with_phones(env):
    c = Client(env, "domain=mantel; protocol=2; features=bridge")
    await c.connect()
    res, _ = await c.call(1, type="report", report={"phones": PHONES})
    assert res["success"], res
    return c


async def test_people_s_phones_are_chosen_by_an_owner_or_admin_and_audited(make_env):
    env = await make_env(settings=LINKED_ON)
    link = await link_with_phones(env)
    await env.login("adult1", "adult")
    assert (await env.m.get("/api/phones")).status == 403
    await env.login("owner1", "owner")
    got = await (await env.m.get("/api/phones")).json()
    assert got["available"] == [{"service": "mobile_app_averys_iphone", "name": "Avery's iPhone"},
                                {"service": "mobile_app_pixel", "name": "Pixel"}] and got["linked"] is True
    uid = env.app["accounts"].db.execute("SELECT id FROM users WHERE username='owner1'").fetchone()[0]
    for bad in ({"services": ["notify.persistent"], "send": "all"}, {"services": [], "send": "loud"}, ["x"]):
        r = await env.m.client.put(f"/api/users/{uid}/phones", json=bad, headers=env.m.headers())
        assert r.status == 400, bad
    r = await env.m.client.put(f"/api/users/{uid}/phones", json={"services": ["mobile_app_pixel"], "send": "all"},
                               headers=env.m.headers())
    assert r.status == 200 and (await r.json()) == {"services": ["mobile_app_pixel"], "send": "all"}
    row = [r for r in env.audit(kind="config") if r["action"] == "phones.set"][-1]
    assert json.loads(row["target"])["to"] == {"services": ["mobile_app_pixel"], "send": "all"}
    assert env.app["phones"].of(uid) == {"services": ["mobile_app_pixel"], "send": "all"}
    await link.ws.close()


async def test_who_gets_a_notification_on_their_phone(make_env):
    env = await make_env(settings=LINKED_ON)
    link = await link_with_phones(env)
    p = env.app["phones"]
    acc = env.app["accounts"].db
    await env.login("owner1", "owner")
    await env.login("adult1", "adult")
    ids = {r[0]: r[1] for r in acc.execute("SELECT username, id FROM users")}
    p.set(ids["owner1"], ["mobile_app_averys_iphone"], "important", None)
    p.set(ids["adult1"], ["mobile_app_pixel", "mobile_app_gone"], "all", None)
    plain = {"title": "Laundry", "message": "Done", "important": False}
    assert p.recipients(plain) == [(ids["adult1"], "mobile_app_pixel")], "a phone HA no longer has is skipped"
    loud = {**plain, "important": True}
    assert sorted(s for _u, s in p.recipients(loud)) == ["mobile_app_averys_iphone", "mobile_app_pixel"]
    assert p.recipients({**loud, "users": ["owner1"]}) == [(ids["owner1"], "mobile_app_averys_iphone")]
    assert p.recipients({**loud, "dashboards": ["dashboard-kitchen"]}) == [], "a screen's own, never a phone"
    p.set(ids["adult1"], ["mobile_app_pixel"], "off", None)
    assert p.recipients(plain) == []
    # delivered as phone_notify frames to Mantel Link, one per phone
    sent = await p.deliver({"id": "n7", **loud})
    assert sent == ["mobile_app_averys_iphone"]
    f = await link.ws.receive_json(timeout=3)
    assert f["type"] == "phone_notify" and f["service"] == "mobile_app_averys_iphone" and f["title"] == "Laundry"
    assert f["data"]["actions"] == [{"action": "MANTEL_DISMISS_n7", "title": "Dismiss"}]
    assert f["data"]["tag"] == "mantel-n7" and f["data"]["push"] == {"interruption-level": "time-sensitive"}
    await link.ws.close()


async def test_a_dismiss_on_a_phone_takes_the_banner_down_everywhere(make_env):
    env = await make_env(settings=LINKED_ON)
    link = await link_with_phones(env)
    await env.login("owner1", "owner")
    ws = await env.socket(expect_caps=False)
    await events(env, ws)
    res, _ = await link.call(2, type="phone_action", action="MANTEL_DISMISS_n7")
    assert res["success"], res
    ev = await next_event(ws)
    assert ev == {"type": "notification_dismiss", "id": "n7"}
    for bad in ("SCRIPT_X", "MANTEL_UNLOCK_front", "MANTEL_DISMISS_" + "x" * 80):
        res, _ = await link.call(3, type="phone_action", action=bad)
        assert res["success"] is False and res["error"]["code"] == "invalid", bad
    # HK Frontend's protocol 1 has no such frame
    old = Client(env)
    await old.connect()
    res, _ = await old.call(1, type="phone_action", action="MANTEL_DISMISS_n7")
    assert res["error"]["code"] == "bad_request"
    await ws.close()
    await link.ws.close()
    await old.ws.close()


async def test_a_bad_phones_report_is_refused(make_env):
    env = await make_env(settings=LINKED_ON)
    c = Client(env, "domain=mantel; protocol=2")
    await c.connect()
    for bad in ([{"service": "persistent_notification", "name": "x"}], [{"service": "mobile_app_x"}], "nope",
                [{"service": "mobile_app_x", "name": ""}]):
        res, _ = await c.call(1, type="report", report={"phones": bad})
        assert res["error"]["code"] == "invalid", bad
    await c.ws.close()


async def test_mantel_notify_reaches_the_screens_and_the_phones(make_env):
    env = await make_env(settings={**LINKED_ON, "notifications": {"enabled": True}})
    link = await link_with_phones(env)
    await env.login("owner1", "owner")
    uid = env.app["accounts"].db.execute("SELECT id FROM users WHERE username='owner1'").fetchone()[0]
    env.app["phones"].set(uid, ["mobile_app_averys_iphone"], "all", None)
    res, frames = await link.call(5, type="call_service", service="notify",
                                  data={"title": "Laundry", "message": "Done", "important": False, "wake": False,
                                        "dashboards": [], "users": []})
    assert res["success"], res
    got = frames
    while not [f for f in got if f.get("type") == "phone_notify"]:
        got.append(await link.ws.receive_json(timeout=3))
    f = [f for f in got if f.get("type") == "phone_notify"][0]
    assert f["service"] == "mobile_app_averys_iphone" and f["title"] == "Laundry"
    assert f["data"]["actions"][0]["action"] == f"MANTEL_DISMISS_{res['result']['id']}"
    await link.ws.close()
