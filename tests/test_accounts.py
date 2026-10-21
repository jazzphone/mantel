"""P3.1 accounts: password policy, Argon2id, lockout and rate limits, TOTP (RFC 6238), secrets at rest,
the first-Owner bootstrap and user management. Fictional users, temp databases, no HA."""
import base64
import json
import os
import sqlite3
import stat

import pytest

from conftest import PASSWORD
from gateway_fakes import off  # noqa: F401 -- fixture
from mantel_server import __main__ as entry
from mantel_server.accounts import (ACCOUNT_FAILURES, IP_FAILURES, AttemptLimiter, PolicyError, check_password_policy,
                                    hotp, otpauth_uri, totp, totp_match)
from mantel_server.atrest import SecretBox, SecretKeyError, load_or_create_key
from mantel_server.store import Store


def seed_of(secret_b32: str) -> bytes:
    return base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8))


# -- passwords ------------------------------------------------------------------------------------
@pytest.mark.parametrize("bad, code", [
    ("short", "password_too_short"), ("x" * 11, "password_too_short"), ("a" * 1025, "password_too_long"),
    ("aaaaaaaaaaaaaaab", "password_too_simple"), ("jordan-is-great", "password_contains_name"), (None, "password_invalid"),
])
def test_password_policy(bad, code):
    with pytest.raises(PolicyError) as e:
        check_password_policy(bad, "jordan", "Jordan")
    assert e.value.code == code
    assert check_password_policy(PASSWORD, "jordan") == PASSWORD


async def test_passwords_are_argon2id_and_never_stored_raw(mantel):
    uid = await mantel.user("jordan", "adult")
    row = mantel.store.db.execute("SELECT password_hash FROM users WHERE id = ?", (uid,)).fetchone()
    assert row[0].startswith("$argon2id$") and PASSWORD not in row[0]
    # the production default is Argon2id with RFC 9106's second recommended parameters
    from mantel_server.accounts import Accounts
    default = Accounts(mantel.store.db, SecretBox(key=b"k" * 32), lambda: 0).hasher
    assert default.type.name == "ID" and default.memory_cost >= 65536 and default.time_cost >= 3


def test_attempt_limiter_window():
    now = [0.0]
    lim = AttemptLimiter(3, 60, lambda: now[0])
    for _ in range(3):
        assert lim.retry_after("k") == 0
        lim.fail("k")
    assert 59 < lim.retry_after("k") <= 60
    now[0] += 61
    assert lim.retry_after("k") == 0


async def test_password_sign_in_success_and_generic_failures(mantel):
    await mantel.user("jordan", "adult")
    r, body = await mantel.sign_in("jordan", "wrong password here")
    assert r.status == 401 and body["error"] == "invalid_credentials"
    r, body = await mantel.sign_in("nobody", "wrong password here")
    assert r.status == 401 and body["error"] == "invalid_credentials"      # unknown user looks the same
    r, body = await mantel.sign_in("Jordan", PASSWORD)                   # user names are case-insensitive
    assert r.status == 200 and body["user"]["role"] == "adult" and body["csrf"]
    assert r.cookies["mantel_session"]["samesite"] == "Strict" and r.cookies["mantel_session"]["httponly"]
    me = await (await mantel.get("/api/session")).json()
    assert me["user"]["username"] == "jordan" and me["device"] is None and me["door"] == "lan"


async def test_account_lockout_after_consecutive_failures(mantel):
    await mantel.user("jordan", "adult")
    for _ in range(ACCOUNT_FAILURES):
        assert (await mantel.sign_in("jordan", "not the password!"))[0].status == 401
    r, body = await mantel.sign_in("jordan", PASSWORD)                   # even the right password waits
    assert r.status == 429 and body["retry_after"] > 0
    row = mantel.store.db.execute("SELECT locked_until FROM users WHERE username='jordan'").fetchone()
    assert row["locked_until"] > mantel.now[0]                              # stored: survives a restart
    mantel.now[0] += 15 * 60 + 1
    assert (await mantel.sign_in("jordan", PASSWORD))[0].status == 200


async def test_unknown_account_names_are_limited_like_real_ones(mantel):
    for _ in range(ACCOUNT_FAILURES):
        await mantel.sign_in("ghost", "not the password!")
    assert (await mantel.sign_in("ghost", "not the password!"))[0].status == 429


async def test_rate_limit_per_source_ip_across_accounts(mantel):
    await mantel.user("jordan", "adult")
    for i in range(IP_FAILURES):
        await mantel.sign_in(f"spray{i}", "not the password!")
    r, body = await mantel.sign_in("jordan", PASSWORD)
    assert r.status == 429 and body["error"] == "too_many_attempts"


async def test_sign_in_requires_json_and_origin(mantel):
    await mantel.user("jordan", "adult")
    r = await mantel.client.post("/api/auth/password", data={"username": "jordan", "password": PASSWORD})
    assert r.status == 415                                                  # no form posts (CSRF-able)
    del mantel.client.session.headers["Origin"]
    r = await mantel.client.post("/api/auth/password", json={"username": "jordan", "password": PASSWORD})
    assert r.status == 403


# -- TOTP -----------------------------------------------------------------------------------------
RFC6238 = [  # RFC 6238 appendix B: (time, sha1, sha256, sha512), 8 digits
    (59, "94287082", "46119246", "90693936"),
    (1111111109, "07081804", "68084774", "25091201"),
    (1111111111, "14050471", "67062674", "99943326"),
    (1234567890, "89005924", "91819424", "93441116"),
    (2000000000, "69279037", "90698825", "38618901"),
    (20000000000, "65353130", "77737706", "47863826"),
]
SEED_SHA1 = b"12345678901234567890"
SEED_SHA256 = b"12345678901234567890123456789012"
SEED_SHA512 = b"1234567890123456789012345678901234567890123456789012345678901234"


@pytest.mark.parametrize("t, sha1, sha256, sha512", RFC6238)
def test_totp_rfc6238_vectors(t, sha1, sha256, sha512):
    assert totp(SEED_SHA1, t, digits=8, algorithm="sha1") == sha1
    assert totp(SEED_SHA256, t, digits=8, algorithm="sha256") == sha256
    assert totp(SEED_SHA512, t, digits=8, algorithm="sha512") == sha512


def test_hotp_rfc4226_vectors():
    expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"]
    assert [hotp(SEED_SHA1, c) for c in range(10)] == expected


def test_totp_window_and_replay_guard():
    now = 1_000_000.0
    code = totp(SEED_SHA1, now)
    counter = totp_match(SEED_SHA1, code, now)
    assert counter == int(now // 30)
    assert totp_match(SEED_SHA1, code, now + 30) == counter                 # one step of drift is fine
    assert totp_match(SEED_SHA1, code, now + 90) is None                    # three is not
    assert totp_match(SEED_SHA1, code, now, last_counter=counter) is None   # each step works once
    for bad in ("12345", "abcdef", None, 123456, "1234567"):
        assert totp_match(SEED_SHA1, bad, now) is None
    assert otpauth_uri(SEED_SHA1, "jordan").startswith("otpauth://totp/Mantel%3Ajordan?secret=")


async def test_totp_enrol_then_password_needs_the_code(mantel):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    r = await mantel.post("/api/auth/totp/enroll")
    assert r.status == 200
    secret = (await r.json())["secret"]
    seed = seed_of(secret)
    assert (await mantel.post("/api/auth/totp/enroll/confirm", {"code": "000000"})).status == 400
    r = await mantel.post("/api/auth/totp/enroll/confirm", {"code": totp(seed, mantel.now[0])})
    assert r.status == 200
    mantel.forget_cookies()
    mantel.now[0] += 60
    r, body = await mantel.sign_in("jordan")
    assert r.status == 200 and body["next"] == "totp" and "mantel_session" not in r.cookies
    assert (await mantel.get("/api/session")).status == 401
    code = totp(seed, mantel.now[0])
    bad = await mantel.post("/api/auth/totp/verify", {"pending": body["pending"], "code": "000000"}, csrf=False)
    assert bad.status == 401
    good = await mantel.post("/api/auth/totp/verify", {"pending": body["pending"], "code": code}, csrf=False)
    assert good.status == 200
    me = await (await mantel.get("/api/session")).json()
    assert me["user"]["username"] == "jordan"
    # the pending token was single use, and the same code cannot be replayed
    again = await mantel.post("/api/auth/totp/verify", {"pending": body["pending"], "code": code}, csrf=False)
    assert again.status == 401
    mantel.forget_cookies()
    r, body = await mantel.sign_in("jordan")
    replay = await mantel.post("/api/auth/totp/verify", {"pending": body["pending"], "code": code}, csrf=False)
    assert replay.status == 401 and (await replay.json())["error"] == "invalid_code"


async def test_tunnel_refuses_a_password_alone(mantel):
    await mantel.user("jordan", "adult")
    r, body = await mantel.sign_in("jordan", tunnel=True)
    assert r.status == 403 and body["error"] == "second_factor_required"
    assert "mantel_session" not in r.cookies


async def test_totp_seed_is_encrypted_at_rest_and_bound_to_its_row(mantel, tmp_path):
    uid = await mantel.user("jordan", "adult")
    acc = mantel.app["accounts"]
    secret, _ = acc.totp_begin(uid, "jordan")
    seed = seed_of(secret)
    key_file = tmp_path / "secrets" / "at_rest.key"
    assert stat.S_IMODE(os.stat(key_file).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(key_file.parent).st_mode) == 0o700
    sealed = mantel.store.db.execute("SELECT seed_enc FROM totp_credentials").fetchone()[0]
    assert seed not in sealed and secret.encode() not in sealed
    mantel.store.db.execute("PRAGMA wal_checkpoint(FULL)")
    raw = b"".join(p.read_bytes() for p in (tmp_path / "data").iterdir() if p.name.startswith("mantel.db"))
    assert seed not in raw and secret.encode() not in raw and base64.b32encode(seed) not in raw
    assert key_file.read_bytes().strip() not in raw
    assert acc.box.open(sealed, f"totp:{uid}") == seed
    with pytest.raises(Exception):
        acc.box.open(sealed, "totp:someone-else")                           # copied to another row: refused
    with pytest.raises(Exception):
        SecretBox(key=os.urandom(32)).open(sealed, f"totp:{uid}")            # another key: refused


def test_key_file_is_created_once_and_validated(tmp_path):
    path = tmp_path / "s" / "at_rest.key"
    k1 = load_or_create_key(path)
    assert len(k1) == 32 and load_or_create_key(path) == k1
    path.write_text("too-short")
    with pytest.raises(SecretKeyError):
        load_or_create_key(path)
    with pytest.raises(SecretKeyError):
        SecretBox().seal(b"x", "a")


def test_existing_tests_do_not_create_real_secrets(tmp_path):
    """The key is read lazily: building an app never touches ~/.config/mantel/secrets."""
    from mantel_server.config import Config
    from mantel_server.server import build_app
    store = Store(tmp_path / "db")
    try:
        app = build_app(Config(data_dir=tmp_path, secrets_dir=tmp_path / "never"), "unused", store=store,
                        connect_ha=False)
        assert app["secret_box"]._aead is None and not (tmp_path / "never").exists()
    finally:
        store.db.close()


# -- bootstrap ------------------------------------------------------------------------------------
async def test_bootstrap_creates_the_first_owner_once(mantel):
    acc = mantel.app["accounts"]
    assert (await (await mantel.get("/api/bootstrap")).json())["open"] is True
    token = acc.issue_bootstrap_token()
    stored = mantel.store.db.execute("SELECT hash FROM bootstrap_tokens").fetchall()
    assert len(stored) == 1 and stored[0][0] != token
    body = {"token": token, "username": "avery", "name": "Fictional Owner", "password": PASSWORD}
    assert (await mantel.post("/api/bootstrap", {**body, "token": "guess"}, csrf=False)).status == 401
    assert (await mantel.post("/api/bootstrap", {**body, "password": "short"}, csrf=False)).status == 400
    r = await mantel.post("/api/bootstrap", body, csrf=False)
    assert r.status == 200 and (await r.json())["user"]["role"] == "owner"
    assert (await (await mantel.get("/api/session")).json())["user"]["role"] == "owner"
    again = await mantel.post("/api/bootstrap", {**body, "username": "mallory"}, csrf=False)
    assert again.status == 410
    with pytest.raises(PolicyError):
        acc.issue_bootstrap_token()
    assert (await (await mantel.get("/api/bootstrap")).json())["open"] is False
    assert mantel.store.db.execute("SELECT COUNT(*) FROM users WHERE role='owner'").fetchone()[0] == 1


async def test_bootstrap_token_expires_and_a_new_one_replaces_it(mantel):
    acc = mantel.app["accounts"]
    first = acc.issue_bootstrap_token()
    second = acc.issue_bootstrap_token()
    body = {"username": "avery", "name": "Owner", "password": PASSWORD}
    assert (await mantel.post("/api/bootstrap", {**body, "token": first}, csrf=False)).status == 401
    mantel.now[0] += 3601
    assert (await mantel.post("/api/bootstrap", {**body, "token": second}, csrf=False)).status == 401


def test_bootstrap_cli_prints_a_token_only_while_no_owner(tmp_path, capsys):
    data = tmp_path / "data"
    assert entry.main(["bootstrap", "--data-dir", str(data)]) == 0
    assert "One-time setup token" in capsys.readouterr().out
    store = Store(data / "mantel.db")
    try:
        store.link("ha-owner", "owner")                                     # an HA-linked Owner counts
    finally:
        store.db.close()
    assert entry.main(["bootstrap", "--data-dir", str(data)]) == 1
    assert "already exists" in capsys.readouterr().err


# -- user management ------------------------------------------------------------------------------
async def test_owner_and_admin_manage_users_within_limits(mantel):
    owner = await mantel.user("avery", "owner")
    await mantel.user("ada", "admin")
    await mantel.sign_in("ada")
    r = await mantel.post("/api/users", {"username": "riley", "name": "Riley", "role": "child", "password": PASSWORD})
    assert r.status == 201
    riley = (await r.json())["user"]["id"]
    assert (await mantel.post("/api/users", {"username": "o2", "role": "owner", "password": PASSWORD})).status == 403
    r = await mantel.client.patch(f"/api/users/{owner}", json={"disabled": True}, headers=mantel.headers())
    assert r.status == 403                                                  # admins never manage Owners
    r = await mantel.client.patch(f"/api/users/{riley}", json={"disabled": True}, headers=mantel.headers())
    assert r.status == 200 and (await r.json())["user"]["disabled"] is True
    assert (await mantel.post("/api/users", {"username": "riley", "role": "child", "password": PASSWORD})).status == 409
    mantel.forget_cookies()
    assert (await mantel.sign_in("riley"))[0].status == 401                # disabled
    await mantel.sign_in("avery")
    r = await mantel.client.patch(f"/api/users/{owner}", json={"role": "adult"}, headers=mantel.headers())
    assert r.status == 409 and (await r.json())["error"] == "last_owner"
    mantel.forget_cookies()
    await mantel.user("kid", "child")
    await mantel.sign_in("kid")
    assert (await mantel.get("/api/users")).status == 403


async def test_change_password_revokes_other_sessions(mantel):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    other = mantel.app["sessions"].create(mantel.store.db.execute(
        "SELECT id FROM users WHERE username='jordan'").fetchone()[0], "lan", "password")
    new = "an even better passphrase"
    r = await mantel.post("/api/account/password", {"current": PASSWORD, "new": new})
    assert r.status == 200
    assert mantel.app["sessions"].get(other.session_id) is None
    assert (await mantel.get("/api/session")).status == 200                 # this one stays
    mantel.forget_cookies()
    assert (await mantel.sign_in("jordan", new))[0].status == 200


# -- passwords: your own (Me → Change Password) and someone else's (People → Set a New Password) ---------
def audit_rows(mantel, prefix="account."):
    return [r for r in mantel.app["audit"].rows(kind="config") if r["action"].startswith(prefix)]


async def test_change_password_checks_the_current_one_and_the_rules_and_is_audited(mantel):
    uid = await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    r = await mantel.post("/api/account/password", {"current": "not the password!", "new": "an even better passphrase"})
    assert r.status == 401 and (await r.json())["error"] == "invalid_credentials"
    r = await mantel.post("/api/account/password", {"current": PASSWORD, "new": "short"})
    assert r.status == 400 and (await r.json())["error"] == "password_too_short"
    r = await mantel.post("/api/account/password", {"current": PASSWORD, "new": "jordan's new passphrase"})
    assert r.status == 400 and (await r.json())["error"] == "password_contains_name"
    r = await mantel.post("/api/account/password", {"current": PASSWORD, "new": "an even better passphrase"}, csrf=False)
    assert r.status == 403                                                  # CSRF, as every change
    assert audit_rows(mantel) == []                                         # nothing refused is recorded as done
    r = await mantel.post("/api/account/password", {"current": PASSWORD, "new": "an even better passphrase"})
    assert r.status == 200
    [row] = audit_rows(mantel)
    assert (row["action"], row["actor"], row["role"], row["decision"], row["door"]) == \
        ("account.password.change", uid, "adult", "allowed", "lan")
    assert json.loads(row["target"]) == {"user": uid, "username": "jordan", "name": "Jordan"}
    assert row["source_ip"]
    dump = json.dumps(mantel.app["audit"].rows())
    assert PASSWORD not in dump and "an even better passphrase" not in dump and "argon2" not in dump


async def test_wrong_current_passwords_count_toward_the_lockout(mantel):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    for _ in range(ACCOUNT_FAILURES):
        await mantel.post("/api/account/password", {"current": "not the password!", "new": "an even better passphrase"})
    r = await mantel.post("/api/account/password", {"current": PASSWORD, "new": "an even better passphrase"})
    assert r.status == 429


async def test_setting_a_first_password_needs_a_fresh_session(mantel):
    """No password to check (an account made without one): a stolen cookie alone can't give itself one."""
    uid = await mantel.app["accounts"].create_user("sam", "Sam", "adult", None)
    issued = mantel.app["sessions"].create(uid, "lan", "cli")
    mantel.set_cookies(mantel_session=issued.access, mantel_csrf=issued.csrf)
    mantel.now[0] += 600
    r = await mantel.post("/api/account/password", {"new": "a first good passphrase"})
    assert r.status == 403 and (await r.json())["error"] == "step_up_required"
    mantel.app["sessions"].mark_fresh(issued.session_id, "totp")
    r = await mantel.post("/api/account/password", {"new": "a first good passphrase"})
    assert r.status == 200
    mantel.forget_cookies()
    assert (await mantel.sign_in("sam", "a first good passphrase"))[0].status == 200


async def reset(mantel, uid, password="a brand new passphrase"):
    return await mantel.post(f"/api/users/{uid}/password", {"password": password})


async def test_an_owner_or_admin_sets_a_new_password_and_their_sessions_end(mantel):
    owner = await mantel.user("avery", "owner")
    jordan = await mantel.user("jordan", "adult")
    phone = mantel.app["sessions"].create(jordan, "lan", "password")
    laptop = mantel.app["sessions"].create(jordan, "tunnel", "passkey")
    for _ in range(5):                                                      # Jordan locked themselves out
        mantel.app["accounts"].record_failure("198.51.100.4", None, jordan)
    await mantel.sign_in("avery")
    r = await reset(mantel, jordan, "short")
    assert r.status == 400 and (await r.json())["error"] == "password_too_short"
    r = await reset(mantel, jordan)
    assert r.status == 200
    got = await r.json()
    assert got["sessions_ended"] == 2 and got["user"]["id"] == jordan
    assert mantel.app["sessions"].get(phone.session_id) is None and mantel.app["sessions"].get(laptop.session_id) is None
    assert (await mantel.get("/api/session")).status == 200                 # the Owner's own session stays
    [row] = audit_rows(mantel)
    assert (row["action"], row["actor"], row["role"]) == ("account.password.reset", owner, "owner")
    assert json.loads(row["target"]) == {"user": jordan, "username": "jordan", "name": "Jordan", "role": "adult"}
    assert "a brand new passphrase" not in json.dumps(mantel.app["audit"].rows())
    mantel.forget_cookies()
    assert (await mantel.sign_in("jordan"))[0].status == 401                # the old one is gone
    assert (await mantel.sign_in("jordan", "a brand new passphrase"))[0].status == 200   # and the lock lifted


async def test_an_admin_never_sets_an_owners_password_nor_anyone_their_own(mantel):
    owner = await mantel.user("avery", "owner")
    admin = await mantel.user("ada", "admin")
    other_admin = await mantel.user("abe", "admin")
    await mantel.user("kid", "child")
    await mantel.sign_in("ada")
    r = await reset(mantel, owner)
    assert r.status == 403 and (await r.json())["error"] == "forbidden"
    r = await reset(mantel, admin)
    assert r.status == 409 and (await r.json())["error"] == "own_password"  # yours: Me, with the current one
    assert (await reset(mantel, other_admin)).status == 200                  # an Admin may for another Admin
    assert (await reset(mantel, "no-such-person")).status == 404
    ha = mantel.store.link("ha-user-1", "adult", "Hollis")
    r = await reset(mantel, ha)
    assert r.status == 409 and (await r.json())["error"] == "no_mantel_password"
    mantel.forget_cookies()
    await mantel.sign_in("kid")
    assert (await reset(mantel, other_admin)).status == 403                 # only Owners and Admins
    mantel.forget_cookies()
    await mantel.sign_in("avery")
    assert (await reset(mantel, admin)).status == 200                       # an Owner for anyone else
    assert [r["actor"] for r in audit_rows(mantel)] == [admin, owner]


async def test_setting_someones_password_needs_a_fresh_confirmation(mantel):
    await mantel.user("avery", "owner")
    jordan = await mantel.user("jordan", "adult")
    await mantel.sign_in("avery")
    mantel.now[0] += 301                                                    # signed in more than 5 minutes ago
    r = await reset(mantel, jordan)
    assert r.status == 403 and (await r.json())["error"] == "step_up_required"
    assert audit_rows(mantel) == []
    mantel.forget_cookies()
    await mantel.sign_in("avery")                                           # a new sign-in is fresh
    assert (await reset(mantel, jordan)).status == 200


async def test_no_audit_row_no_change(mantel, monkeypatch):
    """The row comes first: when it can't be written, the password, the person and their role stay as they were."""
    await mantel.user("avery", "owner")
    jordan = await mantel.user("jordan", "adult")
    await mantel.sign_in("avery")

    def broken(event):
        raise sqlite3.OperationalError("disk I/O error")
    monkeypatch.setattr(mantel.app["audit"], "config_event", broken)
    r = await reset(mantel, jordan)
    assert r.status == 503 and (await r.json())["error"] == "audit_unavailable"
    r = await mantel.client.patch(f"/api/users/{jordan}", json={"role": "admin", "disabled": True}, headers=mantel.headers())
    assert r.status == 503
    r = await mantel.post("/api/users", {"username": "riley", "role": "child", "password": PASSWORD})
    assert r.status == 503
    r = await mantel.post("/api/account/password", {"current": PASSWORD, "new": "an even better passphrase"})
    assert r.status == 503
    row = mantel.app["accounts"].get_user(jordan)
    assert (row["role"], row["disabled"]) == ("adult", 0)
    assert mantel.app["accounts"].find_username("riley") is None
    monkeypatch.undo()
    mantel.forget_cookies()
    assert (await mantel.sign_in("jordan"))[0].status == 200                # Jordan's password unchanged
    assert (await mantel.sign_in("avery"))[0].status == 200                 # and the Owner's


# -- the audit of account changes --------------------------------------------------------------------
async def test_adding_changing_disabling_and_enabling_people_is_audited_first(mantel):
    owner = await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    r = await mantel.post("/api/users", {"username": "Riley", "name": "Riley", "role": "child", "password": PASSWORD})
    riley = (await r.json())["user"]["id"]
    assert (await mantel.post("/api/users", {"username": "riley", "role": "child", "password": PASSWORD})).status == 409
    assert (await mantel.post("/api/users", {"username": "sam", "role": "child", "password": "short"})).status == 400
    patch = lambda body: mantel.client.patch(f"/api/users/{riley}", json=body, headers=mantel.headers())  # noqa: E731
    assert (await patch({"role": "adult"})).status == 200
    assert (await patch({"disabled": True})).status == 200
    assert (await patch({"disabled": True})).status == 200                  # no change, no row
    assert (await patch({"disabled": False, "name": "Riley R."})).status == 200
    rows = audit_rows(mantel)
    assert all((r["actor"], r["role"], r["kind"], r["door"]) == (owner, "owner", "config", "lan") for r in rows)
    assert [(r["action"], json.loads(r["target"])) for r in rows] == [
        ("account.add", {"user": riley, "username": "riley", "name": "Riley", "role": "child"}),
        ("account.role", {"user": riley, "username": "riley", "name": "Riley", "from": "child", "to": "adult"}),
        ("account.disable", {"user": riley, "username": "riley", "name": "Riley", "role": "adult"}),
        ("account.enable", {"user": riley, "username": "riley", "name": "Riley", "role": "adult"}),
        ("account.rename", {"user": riley, "username": "riley", "name": "Riley", "from": "Riley", "to": "Riley R."}),
    ]
    assert PASSWORD not in json.dumps(mantel.app["audit"].rows())
    # the Audit Log's Kind filter finds them (GET /api/audit?kind=config)
    got = await (await mantel.get("/api/audit?kind=config")).json()
    assert [r["action"] for r in got["rows"]][:5] == ["account.rename", "account.enable", "account.disable",
                                                     "account.role", "account.add"]


async def test_a_refused_change_writes_no_row(mantel):
    owner = await mantel.user("avery", "owner")
    await mantel.user("ada", "admin")
    await mantel.sign_in("ada")
    assert (await mantel.client.patch(f"/api/users/{owner}", json={"disabled": True}, headers=mantel.headers())).status == 403
    assert (await mantel.post("/api/users", {"username": "o2", "role": "owner", "password": PASSWORD})).status == 403
    mantel.forget_cookies()
    await mantel.sign_in("avery")
    r = await mantel.client.patch(f"/api/users/{owner}", json={"role": "adult"}, headers=mantel.headers())
    assert r.status == 409                                                  # the last Owner
    assert audit_rows(mantel) == []


async def test_sign_ins_are_not_audited(mantel):
    """By design (accounts.audit_change): the audit is append-only for a year and a failed sign-in needs no
    account. A sign-in is its session; failures are the rate limits and the lockout."""
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan", "not the password!")
    await mantel.sign_in("jordan")
    assert mantel.app["audit"].rows() == []


# -- the second factor's own doors (the 2026-10 audit) -------------------------------------------------
def _wrong_codes(seed, now, n):
    from mantel_server.accounts import TOTP_STEP, hotp
    valid = {hotp(seed, int(now // TOTP_STEP) + d) for d in (-1, 0, 1)}
    return [c for c in (f"{i:06d}" for i in range(n + 3)) if c not in valid][:n]


async def test_confirming_an_enrolment_is_no_way_round_the_step_up(off):
    """enroll/confirm accepted the CONFIRMED seed too, with no limit, and made the session fresh: an unlimited
    step-up for whoever held a session cookie."""
    from gateway_fakes import seed_of  # noqa: F401
    from mantel_server.accounts import totp
    m = off.m
    await off.login("avery", "owner")
    seed = await off.enroll_totp()
    off.now[0] += 3600                                            # no longer fresh
    statuses = [(await m.post("/api/auth/totp/enroll/confirm", {"code": c})).status
                for c in _wrong_codes(seed, off.now[0], 8)]
    assert statuses[:5] == [400] * 5 and statuses[-1] == 429       # limited like the step-up
    r = await m.post("/api/auth/totp/enroll/confirm", {"code": totp(seed, off.now[0] + 30)})
    assert r.status in (400, 429)                                 # the confirmed seed is not "confirmed" again
    assert (await (await m.get("/api/session")).json())["fresh_factor_at"] != off.now[0]


async def test_a_stale_session_cannot_add_a_first_factor_and_then_confirm_it_is_you_with_it(off):
    m = off.m
    await off.login("avery", "owner")
    off.now[0] += 3600
    r = await m.post("/api/auth/totp/enroll")
    assert r.status == 403 and (await r.json())["error"] == "step_up_required"
    r = await m.post("/api/auth/passkey/register/options")
    assert r.status in (400, 403)                                  # (no passkey origin here: refused either way)
    off.now[0] += 1
    await off.login("avery", "owner")                              # signing in again is what makes it fresh
    assert (await m.post("/api/auth/totp/enroll")).status == 200


async def test_a_right_password_does_not_reset_the_count_of_wrong_codes(off):
    """Each right password cleared the per-name limit and the stored lockout before the code was asked: the
    code could be guessed forever, four at a time."""
    from mantel_server.accounts import totp
    m = off.m
    await off.login("avery", "owner")
    seed = await off.enroll_totp()
    m.forget_cookies()
    wrong = iter(_wrong_codes(seed, off.now[0], 40))
    refused = False
    for _ in range(4):
        r, body = await m.sign_in("avery")
        if r.status == 429:
            refused = True
            break
        for _ in range(4):
            r = await m.post("/api/auth/totp/verify", {"pending": body["pending"], "code": next(wrong)}, csrf=False)
            if r.status == 429:
                refused = True
    assert refused
    assert m.app["accounts"].find_username("avery")["locked_until"] is not None
    off.now[0] += 16 * 60                                          # after the lockout, the right code works
    r, body = await m.sign_in("avery")
    r = await m.post("/api/auth/totp/verify", {"pending": body["pending"], "code": totp(seed, off.now[0])}, csrf=False)
    assert r.status == 200


async def test_replacing_the_authenticator_keeps_the_old_one_until_the_new_one_is_confirmed(off):
    from gateway_fakes import seed_of
    from mantel_server.accounts import totp
    m = off.m
    await off.login("avery", "owner")
    old = await off.enroll_totp()
    r = await m.post("/api/auth/totp/enroll")                      # Replace…, then abandoned
    new = seed_of((await r.json())["secret"])
    m.forget_cookies()
    r, body = await m.sign_in("avery")
    assert body.get("next") == "totp"                              # two-step sign-in still on
    off.now[0] += 30
    r = await m.post("/api/auth/totp/verify", {"pending": body["pending"], "code": totp(new, off.now[0])}, csrf=False)
    assert r.status == 401                                         # the unconfirmed one isn't in force
    r, body = await m.sign_in("avery")
    r = await m.post("/api/auth/totp/verify", {"pending": body["pending"], "code": totp(old, off.now[0])}, csrf=False)
    assert r.status == 200
    r = await m.post("/api/auth/totp/enroll")                      # fresh again: replace for real
    new = seed_of((await r.json())["secret"])
    off.now[0] += 30
    assert (await m.post("/api/auth/totp/enroll/confirm", {"code": totp(new, off.now[0])})).status == 200
    acc = m.app["accounts"]
    uid = acc.find_username("avery")["id"]
    off.now[0] += 30
    assert not acc.totp_check(uid, totp(old, off.now[0])) and acc.totp_check(uid, totp(new, off.now[0]))


def test_a_code_in_other_scripts_digits_is_just_wrong():
    from mantel_server.accounts import totp_match
    assert totp_match(b"0" * 20, "١٢٣٤٥٦", 1_000_000.0) is None    # Arabic-Indic digits: no TypeError
