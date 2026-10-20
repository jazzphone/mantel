"""The house's push relay as an Owner sets it (Mantel Settings → Connections → Notifications to the App; apns.py
GET/PUT /api/app/push-relay): the default relay, the Owner's own https:// relay, or off. Changing it drops the
phones registered with the old relay (forgotten there); off tells the apps there is nothing to register with.
Fictional addresses and a fake relay; nothing leaves this machine."""
from __future__ import annotations

import asyncio
import json
import shutil
import subprocess

import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from mantel_server import apns, app_crypto, push
from test_app_auth import sign_in_app
from test_mantel_settings import ALL, node_modules, overview

OWN = "https://push.example.com"


async def owner(m, name="boss"):
    await m.user(name, "owner")
    m.forget_cookies()
    await m.sign_in(name)


async def put(m, body, **kw):
    r = await m.client.put("/api/app/push-relay", json=body, headers=m.headers(**kw))
    return r, await r.json()


async def hello(m):
    return (await (await m.client.get("/api/app/hello")).json())["push"]


@pytest.mark.parametrize("value, mode, url", [
    (None, "default", apns.DEFAULT_RELAY), ("", "default", apns.DEFAULT_RELAY), ("off", "off", None),
    (OWN + "/", "custom", OWN), (OWN + "/mantel", "custom", OWN + "/mantel"),
    ("http://push.example.com", "invalid", None), ("push.example.com", "invalid", None),
    ("https://push.example.com/?x=1", "invalid", None)])
async def test_the_stored_value_decides(mantel, value, mode, url):
    st = mantel.app["app_auth"]
    st.set_setting(apns.RELAY_SETTING, value)
    assert apns.relay_choice(mantel.app) == {"mode": mode, "url": url}
    assert await hello(mantel) == ({"relay": url} if url else {})


async def test_an_owner_sets_default_own_or_off(mantel):
    m = mantel
    await owner(m)
    r = await m.client.get("/api/app/push-relay")
    got = await r.json()
    assert r.status == 200 and got["mode"] == "default" and got["default"] == apns.DEFAULT_RELAY and got["can_edit"]
    r, got = await put(m, {"mode": "custom", "url": OWN + "/"})
    assert r.status == 200 and got["mode"] == "custom" and got["url"] == OWN
    assert await hello(m) == {"relay": OWN}
    r, got = await put(m, {"mode": "off"})
    assert r.status == 200 and got["mode"] == "off" and m.app["app_auth"].setting(apns.RELAY_SETTING) == "off"
    assert await hello(m) == {}                                  # the app: "does not send notifications to the app"
    r, got = await put(m, {"mode": "default"})
    assert got["mode"] == "default" and m.app["app_auth"].setting(apns.RELAY_SETTING) is None
    assert await hello(m) == {"relay": apns.DEFAULT_RELAY}
    for bad in ({"mode": "custom", "url": "http://push.example.com"}, {"mode": "custom"}, {"mode": "custom", "url": "https://a@b.example"},
                {"mode": "elsewhere"}, {}):
        r, got = await put(m, bad)
        assert r.status == 400, bad
    assert m.app["app_auth"].setting(apns.RELAY_SETTING) is None


async def test_only_an_owner_changes_it_and_an_admin_reads_it(mantel):
    m = mantel
    await m.user("ada", "admin")
    await m.sign_in("ada")
    r = await m.client.get("/api/app/push-relay")
    assert r.status == 200 and (await r.json())["can_edit"] is False
    r, got = await put(m, {"mode": "off"})
    assert r.status == 403 and got["error"] == "owner_only"
    await m.user("ann", "adult")
    m.forget_cookies()
    await m.sign_in("ann")
    assert (await m.client.get("/api/app/push-relay")).status == 403
    assert (await put(m, {"mode": "off"}))[0].status == 403
    assert m.app["app_auth"].setting(apns.RELAY_SETTING) is None


async def test_from_away_an_owner_confirms_it_is_them_first(mantel):
    m = mantel
    uid = await m.user("boss", "owner")
    issued = m.app["sessions"].create(uid, "tunnel", "passkey")
    m.set_cookies(mantel_session=issued.access, mantel_csrf=issued.csrf)
    m.now[0] += 360                                              # the sign-in factor is no longer fresh
    r = await m.client.get("/api/app/push-relay", headers=m.headers(tunnel=True))
    assert (await r.json())["needs_fresh"] is True
    r, got = await put(m, {"mode": "off"}, tunnel=True)
    assert r.status == 403 and got["error"] == "step_up_required"
    assert m.app["app_auth"].setting(apns.RELAY_SETTING) is None
    m.store.db.execute("UPDATE sessions SET fresh_factor_at = ?", (m.now[0],))
    assert (await put(m, {"mode": "off"}, tunnel=True))[0].status == 200


async def test_changing_the_relay_drops_its_phones_and_forgets_them_there(mantel):
    m = mantel
    calls = []

    async def transport(url, headers, body):
        calls.append((url, json.loads(body)))
        return 200, {"ok": True}
    m.app["push_relay"].transport = transport
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    key = app_crypto.b64u(app_crypto.raw_public(ec.generate_private_key(ec.SECP256R1()).public_key()))
    assert (await phone.call("POST", "/api/app/push/register", {"handle": "H" * 43, "key": key}))[0].status == 201
    await owner(m)
    got = await (await m.client.get("/api/app/push-relay")).json()
    assert got["phones"] == 1
    r, got = await put(m, {"mode": "custom", "url": OWN})
    assert r.status == 200 and got["phones"] == 0
    await asyncio.gather(*list(m.app["pusher"].tasks))
    assert calls == [(apns.DEFAULT_RELAY + "/v1/forget", {"handle": "H" * 43})]      # at the relay it was made with
    assert m.app["pusher"].targets.everyone() == []
    # the app registers again with the new relay at its next start; the same setting again drops nothing
    assert (await phone.call("POST", "/api/app/push/register", {"handle": "J" * 43, "key": key}))[0].status == 201
    r, got = await put(m, {"mode": "custom", "url": OWN + "/"})
    assert got["phones"] == 1 and len(calls) == 1


async def test_with_the_relay_off_a_left_over_phone_is_skipped_not_failed(mantel):
    m = mantel
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    key = app_crypto.b64u(app_crypto.raw_public(ec.generate_private_key(ec.SECP256R1()).public_key()))
    assert (await phone.call("POST", "/api/app/push/register", {"handle": "H" * 43, "key": key}))[0].status == 201
    m.app["app_auth"].set_setting(apns.RELAY_SETTING, "http://not-https.example")      # a value set by hand
    p = m.app["pusher"]
    for _ in range(push.FAILURES_DROP + 1):
        assert await p.deliver(p.recipients({"type": "notification"}), push.Message("Door", "Opened")) == {"skipped": 1}
    assert len(p.targets.everyone()) == 1                      # kept: fixing the setting brings it back


async def test_a_change_is_audited(mantel):
    m = mantel
    seen = []
    audit = m.app.get("audit")
    if audit is None:
        pytest.skip("no audit in this app")
    real = audit.config_event
    audit.config_event = lambda e: (seen.append(e), real(e))[1]
    await owner(m)
    assert (await put(m, {"mode": "custom", "url": OWN}))[0].status == 200
    assert seen[-1]["action"] == "push_relay.set" and seen[-1]["detail"] == {"mode": "custom", "url": OWN}


# -- the page (web/shim/mantel-settings.js) ------------------------------------------------------------------
PAGE_SCRIPT = r"""
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
globalThis.document = { querySelector: () => null, cookie: '' };
globalThis.location = { hostname: 'mantel.example', hash: '', search: '', pathname: '/settings' };
const plain = (o) => (o == null ? o : typeof o === 'object' ? (o._text !== undefined ? o._text : JSON.stringify(o)) : o);
const row = (kind) => (o) => ({ kind, label: o.label, sub: plain(o.sub), value: o.value, options: o.options, fk: o.fk });
window.hkSettingsKit = {
  group: (o, rows) => ({ header: o.header || null, footer: plain(o.footer), rows: rows.filter(Boolean) }),
  info: row('info'), toggle: row('toggle'), text: row('text'), select: row('select'), nav: row('nav'), button: row('button'),
  h: (tag, attrs) => ({ _text: (attrs && attrs.text) || '' }),
};
const reads = JSON.parse(readFileSync(process.argv[3], 'utf8'));
globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => reads[String(u)] });
const m = await import(process.argv[2]);
const tick = () => new Promise((r) => setTimeout(r, 0));
const out = {};
for (const [name, me] of Object.entries(JSON.parse(process.argv[4]))) {
  m._reset(me);
  const panel = { render() {}, status() {}, shadowRoot: null };
  let kids = [];
  for (let i = 0; i < 3; i++) {
    const c = { kids: [], appendChild(k) { this.kids.push(k); return k; } };
    m.host.page(['mantel', 'connections', 'push'], panel).body(c);
    kids = c.kids;
    await tick(); await tick();
  }
  out[name] = kids;
}
process.stdout.write(JSON.stringify(out));
"""


def page(tmp_path, data, who):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    node_modules(tmp_path)
    (tmp_path / "script.mjs").write_text(PAGE_SCRIPT)
    (tmp_path / "reads.json").write_text(json.dumps({"/api/app/push-relay": data}))
    got = subprocess.run(["node", str(tmp_path / "script.mjs"), str(tmp_path / "mantel-settings.mjs"),
                          str(tmp_path / "reads.json"), json.dumps(who)], capture_output=True, text=True, timeout=60)
    assert got.returncode == 0, got.stderr
    return json.loads(got.stdout)


SETTING = {"mode": "custom", "url": OWN, "default": apns.DEFAULT_RELAY, "direct": False, "direct_missing": None, "phones": 2,
           "can_edit": True, "needs_fresh": False}


def test_the_page_offers_an_owner_the_three_choices(tmp_path):
    got = page(tmp_path, SETTING, {"owner": overview("owner", ALL)})["owner"]
    rows = {r["label"]: r for g in got for r in g["rows"]}
    assert rows["Relay"]["value"] == "Your Own Relay" and rows["Relay"]["sub"] == "push.example.com"
    assert rows["Phones Registered"]["value"] == "2"
    assert [o[0] for o in rows["Send Through"]["options"]] == ["default", "custom", "off"]
    assert rows["Send Through"]["value"] == "custom" and rows["Address"]["value"] == OWN
    assert rows["Save"]["kind"] == "button"


def test_the_page_is_read_only_for_an_admin_and_says_when_direct_sending_cannot_work(tmp_path):
    data = {**SETTING, "mode": "invalid", "url": "http://push.example.com", "can_edit": False, "direct": True,
            "direct_missing": "h2"}
    got = page(tmp_path, data, {"admin": overview("admin", ["me", "connections"])})["admin"]
    rows = {r["label"]: r for g in got for r in g["rows"]}
    assert rows["Relay"]["value"] == "Not Valid"
    assert rows["Sends Directly"]["value"] == "Not Working" and "mantel[apns-direct]" in rows["Sends Directly"]["sub"]
    assert "Send Through" not in rows and "Save" not in rows
    assert any(g["footer"] == "Only an Owner can change the relay." for g in got)
