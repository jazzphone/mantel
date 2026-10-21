"""Slice 10.0: the web app on the Home Screen and Web Push (app_shell.py, push.py, app_crypto.py, migration 0016).

No real push service is reached: the send goes to a fake HTTP session that decrypts the body with the
fictional browser's key, as a browser would.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from mantel_server import app_crypto, push

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"

GOOD = "https://web.push.apple.com/QGuQyavXutnMH6CNyOfp1oaJlI8VqTBHfdEAeSVmXGJqAk"


# -- the crypto -----------------------------------------------------------------------------------
def test_webpush_encryption_round_trip_and_layout():
    ua = ec.generate_private_key(ec.SECP256R1())
    auth = b"\x01" * 16
    body = app_crypto.webpush_encrypt(b'{"title":"Hi"}', app_crypto.raw_public(ua.public_key()), auth)
    assert int.from_bytes(body[16:20], "big") == 4096 and body[20] == 65 and body[21] == 4
    assert app_crypto.webpush_decrypt(body, ua, auth) == b'{"title":"Hi"}'
    with pytest.raises(Exception):
        app_crypto.webpush_decrypt(body, ua, b"\x02" * 16)       # the wrong auth secret opens nothing


def test_sealed_notifications_open_only_with_the_device_key():
    dev = ec.generate_private_key(ec.SECP256R1())
    sealed = app_crypto.seal_for_device(b"secret words", app_crypto.raw_public(dev.public_key()))
    assert set(sealed) == {"v", "epk", "box"} and b"secret" not in json.dumps(sealed).encode()
    assert app_crypto.open_sealed(sealed, dev) == b"secret words"
    with pytest.raises(Exception):
        app_crypto.open_sealed(sealed, ec.generate_private_key(ec.SECP256R1()))


def test_es256_jwt_and_thumbprint():
    key = ec.generate_private_key(ec.SECP256R1())
    tok = app_crypto.es256_jwt(key, {"a": 1})
    assert app_crypto.verify_es256_jwt(tok, key.public_key()) == {"a": 1}
    with pytest.raises(ValueError):
        app_crypto.verify_es256_jwt(tok, ec.generate_private_key(ec.SECP256R1()).public_key())
    jwk = app_crypto.jwk_of(key.public_key())
    assert app_crypto.thumbprint(jwk) == app_crypto.thumbprint({**jwk, "kid": "x"})   # only the required members
    with pytest.raises(ValueError):
        app_crypto.key_of_jwk({**jwk, "d": "private"})                                 # a public key only


def test_key_file_is_made_once_and_private(tmp_path):
    p = tmp_path / "s" / "vapid.pem"
    k1 = app_crypto.load_or_create_ec_key(p)
    assert oct(p.stat().st_mode & 0o777) == "0o600"
    k2 = app_crypto.load_or_create_ec_key(p)
    assert app_crypto.fingerprint(k1.public_key()) == app_crypto.fingerprint(k2.public_key())


def test_the_keys_mantel_makes_go_to_the_data_folder_when_the_secrets_folder_is_read_only(tmp_path):
    """Docker's and the LXC's secrets folder is a read-only mount: the push key and the apps' identity key were
    made there on first use, so browser push and app pairing answered 500. A key already in the secrets folder
    (the operator's, or the App's writable /data/secrets) is still the one used."""
    import os
    import stat
    from types import SimpleNamespace

    secrets, data = tmp_path / "secrets", tmp_path / "data"
    secrets.mkdir()
    os.chmod(secrets, 0o500)
    try:
        cfg = SimpleNamespace(secrets_dir=secrets, data_dir=data)
        where = app_crypto.made_key_path(cfg, "vapid.pem")
        assert where == data / "keys" / "vapid.pem"
        app_crypto.load_or_create_ec_key(where)
        assert stat.S_IMODE((data / "keys").stat().st_mode) == 0o700
        os.chmod(secrets, 0o700)
        made = app_crypto.load_or_create_ec_key(secrets / "app_identity.pem")
        assert app_crypto.made_key_path(cfg, "app_identity.pem") == secrets / "app_identity.pem"
        got = app_crypto.load_or_create_ec_key(app_crypto.made_key_path(cfg, "app_identity.pem"))
        assert app_crypto.fingerprint(got.public_key()) == app_crypto.fingerprint(made.public_key())
    finally:
        os.chmod(secrets, 0o700)


@pytest.mark.parametrize("url,ok", [
    (GOOD, True),
    ("https://fcm.googleapis.com/fcm/send/abc", True),
    ("https://updates.push.services.mozilla.com/wpush/v2/abc", True),
    ("https://db5p.notify.windows.com/w/?token=abc", True),
    ("http://web.push.apple.com/abc", False),               # never plain http
    ("https://web.push.apple.com.evil.example/abc", False),
    ("https://evilweb.push.apple.com/abc", False),          # a suffix match needs the dot
    ("https://192.168.1.10/abc", False),                    # the house's own network: SSRF
    ("https://user:pw@fcm.googleapis.com/x", False),
    ("https://fcm.googleapis.com:8443/x", False),
    ("", False), (None, False),
])
def test_only_known_push_services_are_accepted(url, ok):
    assert push.endpoint_ok(url) is ok


# -- the files the Home Screen needs --------------------------------------------------------------
def test_pages_carry_the_home_screen_tags():
    for page in ("home.html", "settings.html"):
        text = (WEB / page).read_text()
        assert '<link rel="manifest" href="/manifest.webmanifest">' in text
        assert 'rel="apple-touch-icon"' in text and 'apple-mobile-web-app-capable' in text
        assert "viewport-fit=cover" in text


def test_the_service_worker_never_handles_fetches():
    sw = (WEB / "app/sw.js").read_text()
    assert "addEventListener('push'" in sw and "addEventListener('notificationclick'" in sw
    assert not re.search(r"addEventListener\(\s*['\"]fetch", sw)       # requests go to the network as without it


def test_manifest_is_standalone_with_its_icons():
    m = json.loads((WEB / "app/manifest.webmanifest").read_text())
    assert m["display"] == "standalone" and m["start_url"].startswith("/home")
    for icon in m["icons"]:
        name = icon["src"].rsplit("/", 1)[1]
        assert name in __import__("mantel_server.app_shell", fromlist=["ICONS"]).ICONS
        assert (WEB / "app/art" / name).is_file()


async def test_manifest_worker_and_icons_need_no_session(mantel):
    m = mantel
    r = await m.client.get("/manifest.webmanifest")
    assert r.status == 200 and r.headers["Content-Type"].startswith("application/manifest+json")
    r = await m.client.get("/sw.js")
    assert r.status == 200 and r.headers["Service-Worker-Allowed"] == "/"
    for path in ("/apple-touch-icon.png", "/app/art/mantel-192.png"):
        r = await m.client.get(path)
        assert r.status == 200 and (await r.read())[:4] == b"\x89PNG"
    assert (await m.client.get("/app/art/..%2F..%2Fmantel.db")).status in (401, 404)
    assert (await m.client.get("/app/art/other.png")).status in (401, 404)
    assert (await m.client.get("/api/push/web/key")).status == 401      # the API still needs a person


# -- subscribing ----------------------------------------------------------------------------------
def subscription(ua=None, endpoint=GOOD):
    ua = ua or ec.generate_private_key(ec.SECP256R1())
    return ua, {"endpoint": endpoint, "keys": {"p256dh": app_crypto.b64u(app_crypto.raw_public(ua.public_key())),
                                               "auth": app_crypto.b64u(b"\x07" * 16)}}


async def test_subscribe_list_and_remove(mantel):
    m = mantel
    await m.user("ann", "adult")
    await m.sign_in("ann")
    key = (await (await m.get("/api/push/web/key")).json())["key"]
    assert len(app_crypto.unb64u(key)) == 65
    assert (m.app["cfg"].data_dir / "keys" / push.VAPID_FILE).is_file()      # a key file, not the database
    _, sub = subscription(endpoint="https://192.0.2.1/push")
    r = await m.post("/api/push/web/subscribe", {"subscription": sub})
    assert r.status == 400 and (await r.json())["error"] == "push_service_not_allowed"
    _, sub = subscription()
    r = await m.post("/api/push/web/subscribe", {"subscription": sub, "name": "Safari on iPhone"})
    assert r.status == 201
    got = (await (await m.get("/api/push/targets")).json())["targets"]
    assert len(got) == 1 and got[0]["service"] == "web.push.apple.com" and got[0]["name"] == "Safari on iPhone"
    assert "endpoint" not in got[0] and "p256dh" not in got[0] and "auth" not in got[0]
    # another person cannot remove it
    await m.user("bob", "adult")
    m.forget_cookies()
    await m.sign_in("bob")
    assert (await m.client.delete(f"/api/push/targets/{got[0]['id']}", headers=m.headers())).status == 404
    m.forget_cookies()
    await m.sign_in("ann")
    assert (await m.post("/api/push/web/unsubscribe", {"endpoint": GOOD})).status == 200
    assert (await (await m.get("/api/push/targets")).json())["targets"] == []


async def test_bad_keys_are_refused(mantel):
    m = mantel
    await m.user("ann", "adult")
    await m.sign_in("ann")
    _, sub = subscription()
    sub["keys"]["auth"] = app_crypto.b64u(b"short")
    assert (await m.post("/api/push/web/subscribe", {"subscription": sub})).status == 400


# -- sending --------------------------------------------------------------------------------------
class FakeResp:
    def __init__(self, status):
        self.status = status

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class FakeHttp:
    def __init__(self, status=201):
        self.status = status
        self.posts = []

    def post(self, url, data=None, headers=None, **kw):
        self.posts.append((url, data, headers))
        return FakeResp(self.status)


async def test_a_notification_reaches_the_browser_encrypted_and_signed(mantel):
    m = mantel
    ann = await m.user("ann", "adult")
    await m.sign_in("ann")
    ua, sub = subscription()
    await m.post("/api/push/web/subscribe", {"subscription": sub})
    fake = FakeHttp()
    p: push.Pusher = m.app["pusher"]
    p.http = fake
    rows = p.recipients({"type": "notification", "title": "Front Door", "message": "Opened"})
    assert [r["user_id"] for r in rows] == [ann.id if hasattr(ann, "id") else ann]
    counts = await p.deliver(rows, push.Message(title="Front Door", body="Opened", tag="door", important=True))
    assert counts == {"ok": 1}
    url, body, headers = fake.posts[0]
    assert url == GOOD and headers["Content-Encoding"] == "aes128gcm" and headers["Urgency"] == "high"
    plain = json.loads(app_crypto.webpush_decrypt(body, ua, b"\x07" * 16))
    assert plain == {"title": "Front Door", "body": "Opened", "tag": "door", "url": "/home", "important": True}
    # the VAPID header is the house's key, for that push service's origin
    t, k = re.match(r"vapid t=([^,]+), k=(.+)$", headers["Authorization"]).groups()
    claims = app_crypto.verify_es256_jwt(t, app_crypto.public_from_raw(app_crypto.unb64u(k)))
    assert claims["aud"] == "https://web.push.apple.com" and claims["sub"].startswith(("mailto:", "https://"))
    # the Topic the push service reads is a keyed hash, never the tag; the same tag keeps the same topic
    topic = headers["Topic"]
    assert "door" not in topic and len(topic) == 32 and re.fullmatch(r"[A-Za-z0-9_-]+", topic)
    await p.deliver(rows, push.Message(title="Front Door", body="Closed", tag="door"))
    await p.deliver(rows, push.Message(title="Garage", body="Open", tag="garage"))
    assert fake.posts[1][2]["Topic"] == topic and fake.posts[2][2]["Topic"] != topic


async def test_a_dropped_subscription_is_removed(mantel):
    m = mantel
    await m.user("ann", "adult")
    await m.sign_in("ann")
    _, sub = subscription()
    await m.post("/api/push/web/subscribe", {"subscription": sub})
    p = m.app["pusher"]
    p.http = FakeHttp(status=410)
    assert await p.deliver(p.recipients({"type": "notification"}), push.Message("a", "b")) == {"gone": 1}
    assert p.targets.everyone() == []


async def test_users_and_roles_narrow_who_gets_it(mantel):
    m = mantel
    await m.user("ann", "adult")
    await m.user("kid", "child")
    for who in ("ann", "kid"):
        m.forget_cookies()
        await m.sign_in(who)
        _, sub = subscription(endpoint=f"https://fcm.googleapis.com/fcm/send/{who}")
        await m.post("/api/push/web/subscribe", {"subscription": sub})
    p = m.app["pusher"]
    names = lambda ev: sorted(r["username"] for r in p.recipients(ev))  # noqa: E731
    assert names({"type": "notification"}) == ["ann", "kid"]
    assert names({"type": "notification", "users": ["kid"]}) == ["kid"]
    # an accessory the person may not view never reaches their phone (Child: no locks)
    assert names({"type": "notification", "entity": "lock.front_door"}) == ["ann"]


async def test_the_feed_taps_into_push(mantel):
    m = mantel
    seen = []
    feed = m.app["features"].feed
    assert m.app["pusher"].on_event in feed.taps
    feed.taps.append(seen.append)
    feed.send({"type": "notification", "title": "x", "users": []})
    assert seen and seen[0]["title"] == "x"


def test_migration_0016_makes_the_table():
    sql = (ROOT / "hosts/server/mantel_server/migrations/0016_push.sql").read_text()
    assert "CREATE TABLE push_targets" in sql and "endpoint  TEXT NOT NULL UNIQUE" in sql


def test_through_ingress_the_home_screen_tags_are_taken_out():
    from mantel_server import ingress
    for page in ("home.html", "settings.html"):
        html = ingress.inject_base((WEB / page).read_text(), "/api/hassio_ingress/Fict1onal")
        assert "manifest" not in html and "apple-touch-icon" not in html and "mantel-base" in html
