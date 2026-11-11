"""The app's notifications keep their tag sealed (apns.py): the tag is the notification's mute key (which accessory,
which rule), so neither the push relay nor Apple may read it. The extension groups by the sealed tag
(threadIdentifier); the only thing outside the seal is ``apns-collapse-id``, a keyed hash of the tag that differs per
phone. And sending directly says plainly at startup when it can't speak HTTP/2 (the ``apns-direct`` extra).
Fictional keys only; nothing leaves this machine."""
from __future__ import annotations

import json
import logging
import tomllib
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from mantel_server import apns, push
from mantel_server.apps import app_crypto
from test_push_relay import relay_server  # noqa: F401 -- the Worker served locally (a fixture)

ROOT = Path(__file__).resolve().parents[1]
TAG = "lock.front_door"


def phone_key():
    k = ec.generate_private_key(ec.SECP256R1())
    return k, app_crypto.raw_public(k.public_key())


def msg(tag=TAG):
    return push.Message(title="Front Door", body="Unlocked", tag=tag, important=True, entity="lock.front_door")


def test_the_payload_carries_no_tag_outside_the_seal():
    note, raw = phone_key()
    payload = apns.build_payload(msg(), raw)
    assert "thread-id" not in payload["aps"]
    assert TAG not in json.dumps(payload) and "front_door" not in json.dumps(payload)
    inner = json.loads(app_crypto.open_sealed(payload["m"], note))
    assert inner["tag"] == TAG                                  # the extension groups by it (threadIdentifier)


def test_the_collapse_id_is_a_keyed_hash_per_phone_and_tag():
    house = ec.generate_private_key(ec.SECP256R1())
    secret = apns.collapse_secret(house)
    assert secret == apns.collapse_secret(house)                 # the same house: the same key, nothing to store
    assert secret != apns.collapse_secret(ec.generate_private_key(ec.SECP256R1()))
    _, a = phone_key()
    _, b = phone_key()
    one = apns.collapse_id(secret, a, TAG)
    assert one == apns.collapse_id(secret, a, TAG)               # a newer notification still replaces an older one
    assert len(one) == 32 and TAG not in one
    assert one != apns.collapse_id(secret, b, TAG)               # two phones can't be matched by it
    assert one != apns.collapse_id(secret, a, "binary_sensor.garage_door")


async def test_direct_sending_sends_the_hash_not_the_tag(tmp_path):
    house = ec.generate_private_key(ec.SECP256R1())
    sent = []

    async def transport(url, headers, body):
        sent.append((headers, body))
        return 200, {}
    apple = ec.generate_private_key(ec.SECP256R1())
    (tmp_path / apns.KEY_FILE).write_bytes(apple.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                               serialization.NoEncryption()))
    (tmp_path / apns.CONF_FILE).write_text(json.dumps({"key_id": "KEY123", "team_id": "TEAM123", "topic": "com.example.mantel"}))
    sender = apns.Apns(tmp_path, transport=transport, secret=lambda: apns.collapse_secret(house))
    _, raw = phone_key()
    row = {"endpoint": "ab" * 32, "p256dh": app_crypto.b64u(raw), "env": "sandbox"}
    assert await sender.send(row, msg()) == "ok"
    headers, body = sent[0]
    assert headers["apns-collapse-id"] == apns.collapse_id(apns.collapse_secret(house), raw, TAG)
    assert TAG.encode() not in body and TAG not in json.dumps(headers)
    sender.secret = None                                         # no house key to hand: no collapse id at all
    assert await sender.send(row, msg()) == "ok"
    assert "apns-collapse-id" not in sent[1][0]


async def test_the_mac_apps_token_goes_to_its_own_topic(tmp_path):
    sent = []

    async def transport(url, headers, body):
        sent.append(headers)
        return 200, {}
    apple = ec.generate_private_key(ec.SECP256R1())
    (tmp_path / apns.KEY_FILE).write_bytes(apple.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                               serialization.NoEncryption()))
    conf = {"key_id": "KEY123", "team_id": "TEAM123", "topic": "com.example.mantel.ios"}
    (tmp_path / apns.CONF_FILE).write_text(json.dumps(conf))
    sender = apns.Apns(tmp_path, transport=transport)
    _, raw = phone_key()
    mac = {"endpoint": "cd" * 32, "p256dh": app_crypto.b64u(raw), "env": "sandbox", "platform": "mac"}
    assert await sender.send(mac, msg()) == "skipped" and sent == []      # no mac_topic: kept, not sent to the iPhone's
    (tmp_path / apns.CONF_FILE).write_text(json.dumps({**conf, "mac_topic": "com.example.mantel.mac"}))
    assert await sender.send(mac, msg()) == "ok" and sent[-1]["apns-topic"] == "com.example.mantel.mac"
    assert await sender.send({**mac, "platform": None}, msg()) == "ok"
    assert sent[-1]["apns-topic"] == "com.example.mantel.ios"


async def test_through_the_relay_the_request_names_no_tag(mantel):
    from test_app_auth import sign_in_app
    m = mantel
    seen = []

    async def transport(url, headers, body):
        seen.append(json.loads(body))
        return 200, {"ok": True}
    m.app["push_relay"].transport = transport
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    note, raw = phone_key()
    r, _ = await phone.call("POST", "/api/app/push/register", {"handle": "h" * 43, "key": app_crypto.b64u(raw)})
    assert r.status == 201
    p = m.app["pusher"]
    assert await p.deliver(p.recipients({"type": "notification"}), msg()) == {"ok": 1}
    body = seen[-1]
    assert TAG not in json.dumps(body) and "thread-id" not in body["payload"]["aps"]
    assert body["collapse_id"] == apns.collapse_id(apns.collapse_secret(m.app["app_auth"].key()), raw, TAG)
    assert json.loads(app_crypto.open_sealed(body["payload"]["m"], note))["tag"] == TAG


async def test_through_the_worker_apple_gets_the_hash(mantel, relay_server):
    """The real Worker code (packaging/push-relay/test/serve.mjs) between the house and a fake Apple."""
    import aiohttp
    from test_app_auth import sign_in_app
    m = mantel
    m.app["app_auth"].set_setting(apns.RELAY_SETTING, relay_server)
    hello = await (await m.client.get("/api/app/hello")).json()
    async with aiohttp.ClientSession() as http:
        reg = await (await http.post(relay_server + "/v1/register",
                                     json={"token": "cd" * 32, "env": "sandbox", "house_key": hello["key"]})).json()
    phone, _ = await sign_in_app(m)
    m.forget_cookies()
    _, raw = phone_key()
    assert (await phone.call("POST", "/api/app/push/register", {"handle": reg["handle"], "key": app_crypto.b64u(raw)}))[0].status == 201
    p = m.app["pusher"]
    assert await p.deliver(p.recipients({"type": "notification"}), msg()) == {"ok": 1}
    async with aiohttp.ClientSession() as http:
        to_apple = (await (await http.get(relay_server + "/__sent")).json(content_type=None))[-1]
    assert to_apple["headers"]["apns-collapse-id"] == apns.collapse_id(apns.collapse_secret(m.app["app_auth"].key()), raw, TAG)
    assert TAG not in json.dumps(to_apple)


# -- sending directly needs HTTP/2 -------------------------------------------------------------------------
def test_the_direct_extra_is_declared():
    extras = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]["optional-dependencies"]
    assert any(d.startswith("httpx[http2]") for d in extras["apns-direct"])


def test_startup_says_when_direct_sending_cannot_speak_http2(mantel, monkeypatch, caplog):
    m = mantel
    secrets_dir = m.app["cfg"].secrets_dir
    secrets_dir.mkdir(parents=True, exist_ok=True)
    apple = ec.generate_private_key(ec.SECP256R1())
    (secrets_dir / apns.KEY_FILE).write_bytes(apple.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                                  serialization.NoEncryption()))
    (secrets_dir / apns.CONF_FILE).write_text(json.dumps({"key_id": "KEY123", "team_id": "TEAM123", "topic": "com.example.mantel"}))
    monkeypatch.setattr(apns, "http2_missing", lambda: "h2")
    with caplog.at_level(logging.ERROR, logger="mantel.apns"):
        apns.check_direct(m.app)
    assert "h2 is not installed" in caplog.text and apns.EXTRA in caplog.text
    caplog.clear()
    monkeypatch.setattr(apns, "http2_missing", lambda: None)
    with caplog.at_level(logging.WARNING, logger="mantel.apns"):
        apns.check_direct(m.app)
    assert caplog.text == ""


async def test_without_http2_direct_sending_fails_and_says_why(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(apns, "http2_missing", lambda: "httpx")
    with caplog.at_level(logging.WARNING, logger="mantel.apns"):
        status, body = await apns.Apns(tmp_path)._default_transport("https://api.push.apple.com/3/device/x", {}, b"{}")
    assert (status, body) == (0, {"reason": "transport_missing"}) and apns.EXTRA in caplog.text


def test_a_wrong_relay_setting_is_reported_at_startup(mantel, caplog):
    m = mantel
    m.app["app_auth"].set_setting(apns.RELAY_SETTING, "http://relay.example")
    with caplog.at_level(logging.WARNING, logger="mantel.apns"):
        apns.check_direct(m.app)
    assert "not an https:// address" in caplog.text
