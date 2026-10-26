"""Stop Sending to… (Mantel Settings → Me → Notifications; push.delete_target) for an app: the house drops the phone,
asks the relay to forget its handle (signed, as signing out does), and marks the app off, so it does not register
again by itself at its next start. Only the person's own Turn On Notifications in the app (``resume``) does.
Fictional keys and a fake relay; nothing leaves this machine."""
from __future__ import annotations

import asyncio
import json

from cryptography.hazmat.primitives.asymmetric import ec

from mantel_server import app_crypto
from test_app_auth import sign_in_app
from test_push import subscription

HANDLE = "H" * 43


def note_key() -> str:
    return app_crypto.b64u(app_crypto.raw_public(ec.generate_private_key(ec.SECP256R1()).public_key()))


async def setup(m):
    calls = []

    async def transport(url, headers, body):
        calls.append((url, headers, json.loads(body)))
        return 200, {"ok": True}
    m.app["push_relay"].transport = transport
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    r, got = await phone.call("POST", "/api/app/push/register", {"handle": HANDLE, "key": note_key()})
    assert r.status == 201
    return phone, got["id"], calls


async def settle(m):
    await asyncio.gather(*list(m.app["pusher"].tasks))


async def test_stop_sending_forgets_the_handle_at_the_relay_and_keeps_the_app_off(mantel):
    m = mantel
    phone, tid, calls = await setup(m)
    assert (await phone.call("GET", "/api/app/me"))[1]["push_off"] is False
    await m.sign_in("ann")
    r = await m.client.delete(f"/api/push/targets/{tid}", headers=m.headers())
    assert r.status == 200
    await settle(m)
    url, headers, body = calls[-1]
    assert url.endswith("/v1/forget") and body == {"handle": HANDLE}
    assert headers["X-Mantel-Signature"] and headers["X-Mantel-House"] == m.app["app_auth"].fingerprint()
    assert m.app["pusher"].targets.everyone() == []
    m.forget_cookies()
    # the app starts again: it asks first, and the house says it is off
    assert (await phone.call("GET", "/api/app/me"))[1]["push_off"] is True
    # an app that registers anyway (an older one) is refused, and the handle it just got is forgotten too
    r, got = await phone.call("POST", "/api/app/push/register", {"handle": "J" * 43, "key": note_key()})
    assert r.status == 409 and got["error"] == "push_off"
    await settle(m)
    assert calls[-1][2] == {"handle": "J" * 43} and calls[-1][0].endswith("/v1/forget")
    assert m.app["pusher"].targets.everyone() == []
    r, _ = await phone.call("POST", "/api/app/push/register", {"token": "ab" * 32, "key": note_key(), "env": "sandbox"})
    assert r.status == 409                                       # directly, too
    # the person turns notifications on in the app: registered again, and no longer off
    r, _ = await phone.call("POST", "/api/app/push/register", {"handle": "K" * 43, "key": note_key(), "resume": True})
    assert r.status == 201
    assert (await phone.call("GET", "/api/app/me"))[1]["push_off"] is False
    assert [t["endpoint"] for t in m.app["pusher"].targets.everyone()] == ["K" * 43]
    r, _ = await phone.call("POST", "/api/app/push/register", {"handle": "L" * 43, "key": note_key()})
    assert r.status == 201                                       # and its own start registers as before


async def test_stop_sending_is_only_for_ones_own_targets(mantel):
    m = mantel
    _, tid, calls = await setup(m)
    await m.user("bob", "adult")
    await m.sign_in("bob")
    r = await m.client.delete(f"/api/push/targets/{tid}", headers=m.headers())
    assert r.status == 404
    await settle(m)
    assert not [c for c in calls if c[0].endswith("/v1/forget")]
    assert len(m.app["pusher"].targets.everyone()) == 1


async def test_a_browsers_target_goes_without_the_relay(mantel):
    m = mantel
    _, _, calls = await setup(m)
    await m.sign_in("ann")
    r = await m.client.post("/api/push/web/subscribe", json={"subscription": subscription()[1], "name": "Firefox"},
                            headers=m.headers())
    assert r.status == 201
    wid = (await r.json())["id"]
    assert (await m.client.delete(f"/api/push/targets/{wid}", headers=m.headers())).status == 200
    await settle(m)
    assert not [c for c in calls if c[0].endswith("/v1/forget")]
    assert [t["kind"] for t in m.app["pusher"].targets.everyone()] == ["apns"]     # the app's stays


def test_the_settings_page_says_how_to_turn_an_app_on_again():
    from js_modules import settings_source
    js = settings_source()      # the text is in web/shim/settings/me.js
    assert "choose Turn On Notifications in its Mantel app" in js


async def test_an_app_signed_out_any_way_gets_no_more_notifications(mantel):
    """Only AppAuth.revoke forgot an app's targets: an app signed out from Me → Sessions, by a password change
    or reset, or expired, kept receiving sealed notifications it could still open."""
    from mantel_server.push import Message
    m = mantel
    phone, tid, calls = await setup(m)
    uid = m.store.db.execute("SELECT id FROM users WHERE username = 'ann'").fetchone()[0]
    m.app["sessions"].revoke_user(uid, "password_reset")
    m.forget_cookies()
    r, _ = await phone.call("GET", "/api/app/me")
    assert r.status == 401
    p = m.app["pusher"]
    calls.clear()
    assert p.recipients({"type": "notification", "title": "Alarm disarmed"}) == []
    assert p.targets.everyone() == []                       # forgotten, here and at the relay
    await settle(m)
    assert [c[0] for c in calls if str(c[0]).endswith("/v1/forget")] and \
        not [c for c in calls if str(c[0]).endswith("/v1/send")]
    assert await p.deliver(p.recipients({"type": "notification"}), Message(title="x", body="")) == {}


async def test_an_outage_never_deletes_the_phones(mantel):
    """Any failed send counted against its target, so five notifications while the internet or the relay was
    down deleted every phone and browser (and the browsers never subscribed again by themselves)."""
    from mantel_server.push import Message
    m = mantel
    phone, tid, calls = await setup(m)

    async def down(url, headers, body):
        calls.append((url,))
        return 0, {}
    m.app["push_relay"].transport = down
    p = m.app["pusher"]
    for i in range(6):
        assert await p.deliver(p.recipients({"type": "notification"}), Message(title=f"n{i}", body="")) == {"unreachable": 1}

    async def busy(url, headers, body):
        return 503, {}
    m.app["push_relay"].transport = busy
    assert await p.deliver(p.recipients({"type": "notification"}), Message(title="x", body="")) == {"unreachable": 1}
    assert [t["endpoint"] for t in p.targets.everyone()] == [HANDLE]
