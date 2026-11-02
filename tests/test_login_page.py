"""The sign-in page (`mantel_server/login_page.py`, `static/login/`): what is served and to whom, the CSP
(no inline script), the `next` sanitiser (Python and the page's JS on one table), signed-out redirects,
and the password -> TOTP and passkey flows driven through the endpoints the page uses. Fictional users,
temp databases, no HA."""
import asyncio
import html as htmllib
import json
import re
import shutil
import subprocess
import tomllib
from importlib.resources import files
from pathlib import Path

import pytest

from conftest import PASSWORD
from mantel_server import login_page
from mantel_server.accounts import totp
from mantel_server.login_page import DEFAULT_NEXT, login_url, safe_next
from test_accounts import seed_of
from test_passkeys import SoftAuthenticator, localhost, register

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "hosts/server/mantel_server/static"
LOGIN = STATIC / "login"
NODE = shutil.which("node")
DOC = {"Accept": "text/html", "Sec-Fetch-Dest": "document"}


def metas(text):
    return {m.group(1): htmllib.unescape(m.group(2))
            for m in re.finditer(r'<meta name="(mantel-[a-z]+)" content="([^"]*)">', text)}


# -- the page --------------------------------------------------------------------------------------
async def test_signed_out_gets_the_page_with_relative_urls(mantel):
    r = await mantel.client.get("/login")
    assert r.status == 200 and r.content_type == "text/html"
    text = await r.text()
    assert "<title>Sign in · Mantel</title>" in text
    assert metas(text) == {"mantel-base": "", "mantel-next": DEFAULT_NEXT, "mantel-door": "lan"}
    # relative, so they follow the page wherever it is mounted (an address prefix included)
    assert 'src="login/login.js"' in text and 'href="login/login.css"' in text and 'href="login/ha"' in text
    assert 'src="/' not in text and 'href="/' not in text
    # the order the page offers: passkey, then password (+ code), then Home Assistant
    assert text.index('id="passkey"') < text.index('id="password-form"') < text.index('id="totp-form"') < text.index('id="ha"')
    assert r.headers["Cache-Control"] == "no-store" and r.headers["X-Content-Type-Options"] == "nosniff"


async def test_assets_are_served_and_nothing_else(mantel):
    for name, mime, path in (("login/login.js", "text/javascript", LOGIN / "login.js"),
                             ("login/login.css", "text/css", LOGIN / "login.css"),
                             ("webauthn.js", "text/javascript", STATIC / "webauthn.js")):
        a = await mantel.client.get("/" + name)
        assert a.status == 200 and a.content_type == mime and await a.text() == path.read_text(), name
        assert "script-src 'self'" in a.headers["Content-Security-Policy"]
    for bad in ("/login/index.html", "/login/..%2Fdev.html", "/login/admin.js", "/login/webauthn.js"):  # never served; 401 before sign-in
        assert (await mantel.client.get(bad, allow_redirects=False)).status in (400, 401, 404), bad


async def test_csp_and_no_inline_script_handler_or_style(mantel):
    r = await mantel.client.get("/login")
    csp = r.headers["Content-Security-Policy"]
    assert "default-src 'none'" in csp and "script-src 'self'" in csp and "style-src 'self'" in csp
    assert "unsafe-inline" not in csp and "unsafe-eval" not in csp and "frame-ancestors 'none'" in csp
    assert "form-action 'self'" in csp and "connect-src 'self'" in csp
    text = await r.text()
    scripts = re.findall(r"<script\b[^>]*>", text)
    assert scripts and all('src="' in s and 'type="module"' in s for s in scripts)
    assert not re.search(r"<script[^>]*>[^<]+</script>", text)          # no inline script body
    assert not re.search(r"\son\w+\s*=", text)                           # no inline handlers
    assert not re.search(r"\sstyle\s*=", text) and "<style" not in text   # no inline style
    assert "javascript:" not in text
    # the password form never sends a password in a URL, even if the module failed to load
    for form in re.findall(r"<form\b[^>]*>", text):
        assert 'method="post"' in form and "hidden" in form


def test_the_scripts_do_not_use_unsafe_dom_or_storage():
    for path in (LOGIN / "login.js", STATIC / "webauthn.js"):
        js = path.read_text()
        for banned in ("innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function",
                       "setAttribute('style'", "cssText", "localStorage", "sessionStorage", "indexedDB",
                       "javascript:", "console.log", "http://", "https://"):
            assert banned not in js, (path.name, banned)
        assert not re.search(r"\.on[a-z]+\s*=", js), path.name
    css = (LOGIN / "login.css").read_text()
    assert "@import" not in css and "url(" not in css
    assert "prefers-color-scheme: dark" in css                           # light and dark


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_modules_parse():
    for path in (LOGIN / "login.js", STATIC / "webauthn.js", STATIC / "admin/admin.js"):
        out = subprocess.run([NODE, "--check", str(path)], capture_output=True, text=True)
        assert out.returncode == 0, (path.name, out.stderr)


def test_the_assets_ship_in_the_package():
    data = tomllib.loads((ROOT / "pyproject.toml").read_text())
    globs = data["tool"]["setuptools"]["package-data"]["mantel_server"]
    assert "static/login/*" in globs and "static/*" in globs
    for rel in ("static/login/index.html", "static/login/login.js", "static/login/login.css", "static/webauthn.js"):
        assert files("mantel_server").joinpath(rel).is_file(), rel


async def test_the_admin_page_uses_the_shared_passkey_helpers(mantel):
    admin_js = (STATIC / "admin/admin.js").read_text()
    assert "from '../webauthn.js'" in admin_js and "function toRequest" not in admin_js
    assert "from '../webauthn.js'" in (LOGIN / "login.js").read_text()


async def test_door_is_told_to_the_page(mantel):
    r = await mantel.client.get("/login", headers={"X-Mantel-Door": "tunnel"})
    assert metas(await r.text())["mantel-door"] == "tunnel"
    assert 'id="door-note"' in await r.text()


# -- next ------------------------------------------------------------------------------------------
NEXT_TABLE = [
    # (value, expected)
    ("/home", "/home"),
    ("/dashboard-kitchen/home", "/dashboard-kitchen/home"),
    ("/dashboard-kitchen/lights?x=1&y=2#top", "/dashboard-kitchen/lights?x=1&y=2#top"),
    ("/admin", "/admin"),
    ("/dev", "/dev"),
    ("/%2F%2Fevil.example", "/%2F%2Fevil.example"),            # one path segment on this site
    (None, DEFAULT_NEXT), ("", DEFAULT_NEXT), (42, DEFAULT_NEXT),
    ("home", DEFAULT_NEXT),                                     # relative to the page: not accepted
    ("//evil.example/x", DEFAULT_NEXT),
    ("///evil.example", DEFAULT_NEXT),
    ("/\\evil.example", DEFAULT_NEXT),
    ("\\\\evil.example", DEFAULT_NEXT),
    ("https://evil.example/", DEFAULT_NEXT),
    ("javascript:alert(1)", DEFAULT_NEXT),
    ("data:text/html,x", DEFAULT_NEXT),
    ("/\t/evil.example", DEFAULT_NEXT),
    ("/ /evil.example", DEFAULT_NEXT),
    ("/x\ny", DEFAULT_NEXT),
    ("/café", DEFAULT_NEXT),
    ("/../evil", DEFAULT_NEXT), ("/a/./b", DEFAULT_NEXT), ("/a/%2e%2e/b", DEFAULT_NEXT), ("/..", DEFAULT_NEXT),
    ("/login", DEFAULT_NEXT), ("/login?next=/x", DEFAULT_NEXT), ("/LOGIN/ha", DEFAULT_NEXT),
    ("/logout", DEFAULT_NEXT), ("/auth/callback?code=x", DEFAULT_NEXT),
    ("/api/session", DEFAULT_NEXT), ("/ws", DEFAULT_NEXT),
    ("/" + "a" * 1100, DEFAULT_NEXT),
    ("/loginx", "/loginx"),                                     # only the sign-in routes themselves
]


@pytest.mark.parametrize("value, expected", NEXT_TABLE)
def test_safe_next(value, expected):
    assert safe_next(value) == expected


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_the_page_cleans_next_with_the_same_rules():
    values = [v for v, _ in NEXT_TABLE]
    js = (f"const m = await import({json.dumps((LOGIN / 'login.js').as_uri())});\n"
          f"console.log(JSON.stringify({json.dumps(values)}.map(m.safeNext)));")
    out = subprocess.run([NODE, "--input-type=module", "-e", js], capture_output=True, text=True, check=True).stdout
    assert json.loads(out) == [safe_next(v) for v in values] == [e for _, e in NEXT_TABLE]


def test_login_url():
    assert login_url(None) == "/login" and login_url("/home") == "/login" and login_url("//evil") == "/login"
    assert login_url("/admin") == "/login?next=/admin"
    assert login_url("/dashboard-kitchen/home?a=1&b=2") == "/login?next=/dashboard-kitchen/home%3Fa%3D1%26b%3D2"


async def test_next_is_cleaned_and_escaped_on_the_page(mantel):
    r = await mantel.client.get("/login", params={"next": '/x"><script>alert(1)</script>'})
    text = await r.text()
    assert "<script>alert" not in text and metas(text)["mantel-next"] == DEFAULT_NEXT
    r = await mantel.client.get("/login", params={"next": "//evil.example"})
    assert metas(await r.text())["mantel-next"] == DEFAULT_NEXT
    r = await mantel.client.get("/login", params={"next": "/dashboard-kitchen/home?a=1&b=2"})
    text = await r.text()
    assert metas(text)["mantel-next"] == "/dashboard-kitchen/home?a=1&b=2"
    assert 'content="/dashboard-kitchen/home?a=1&amp;b=2"' in text
    assert 'href="login/ha?next=/dashboard-kitchen/home%3Fa%3D1%26b%3D2"' in text


# -- who is sent where -----------------------------------------------------------------------------
async def test_signed_out_pages_are_sent_to_login_with_next(mantel):
    async def where(path, headers=None):
        r = await mantel.client.get(path, headers=headers or {}, allow_redirects=False)
        return r.status, r.headers.get("Location")
    assert await where("/") == (302, "/login")
    assert await where("/dev") == (302, "/login?next=/dev")
    assert await where("/home") == (302, "/login")                          # the default screen anyway
    assert await where("/admin") == (302, "/login?next=/admin")
    assert await where("/dashboard-kitchen/home", DOC) == (302, "/login?next=/dashboard-kitchen/home")
    assert await where("/dashboard-kitchen/lights?x=1", DOC) == (302, "/login?next=/dashboard-kitchen/lights?x%3D1")
    # a screen in a frame (a Webpage dashboard in HA's sidebar): the sign-in page in the frame too
    assert await where("/dashboard-loft/home", {"Sec-Fetch-Dest": "iframe", "Sec-Fetch-Mode": "navigate"}) == \
        (302, "/login?next=/dashboard-loft/home")
    # not a page: a plain 401, never a redirect
    assert (await where("/api/me", DOC))[0] == 401
    assert (await where("/dashboard-kitchen/home", {"Accept": "*/*"}))[0] == 401
    assert (await where("/hk/modules/x.js", {"Sec-Fetch-Dest": "script", "Accept": "text/html"}))[0] == 401


async def test_a_signed_in_person_is_sent_on(mantel):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    r = await mantel.client.get("/login", params={"next": "/admin"}, allow_redirects=False)
    assert r.status == 302 and r.headers["Location"] == "/admin"
    r = await mantel.client.get("/login", params={"next": "https://evil.example/"}, allow_redirects=False)
    assert r.status == 302 and r.headers["Location"] == DEFAULT_NEXT


async def test_a_wall_tablet_alone_gets_the_page(mantel):
    await mantel.user("avery", "owner")
    await mantel.sign_in("avery")
    assert (await mantel.post("/api/devices/enroll", {"name": "Loft tablet", "room": "loft"})).status == 201
    r = await mantel.client.get("/login", allow_redirects=False)
    assert r.status == 200 and 'id="password-form"' in await r.text()


# -- the flows the page drives ---------------------------------------------------------------------
async def page_post(mantel, path, body, **kw):
    """A POST as login.js sends it: JSON, the page's Origin (set on the client), no CSRF token."""
    r = await mantel.post(path, body, csrf=False, **kw)
    return r, await r.json()


async def test_password_then_totp_flow(mantel):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    secret = (await (await mantel.post("/api/auth/totp/enroll")).json())["secret"]
    seed = seed_of(secret)
    assert (await mantel.post("/api/auth/totp/enroll/confirm", {"code": totp(seed, mantel.now[0])})).status == 200
    mantel.forget_cookies()
    mantel.now[0] += 60

    page = await mantel.client.get("/login", params={"next": "/admin"})
    assert page.status == 200 and metas(await page.text())["mantel-next"] == "/admin"
    r, body = await page_post(mantel, "/api/auth/password", {"username": "jordan", "password": PASSWORD})
    assert r.status == 200 and body["next"] == "totp" and body["pending"]
    assert "mantel_session" not in r.cookies
    # a wrong code: the page says so and stays on the code step
    r, bad = await page_post(mantel, "/api/auth/totp/verify", {"pending": body["pending"], "code": "000000"})
    assert r.status == 401 and bad["error"] == "invalid_code"
    r, good = await page_post(mantel, "/api/auth/totp/verify", {"pending": body["pending"],
                                                               "code": totp(seed, mantel.now[0])})
    assert r.status == 200 and good["ok"] and good["user"]["username"] == "jordan"
    me = await (await mantel.get("/api/session")).json()
    assert me["user"]["username"] == "jordan"
    row = mantel.store.db.execute("SELECT method, door FROM sessions WHERE revoked IS NULL ORDER BY rowid DESC").fetchone()
    assert tuple(row) == ("password+totp", "lan")
    # back on /login, the page now sends them on to next
    again = await mantel.client.get("/login", params={"next": "/admin"}, allow_redirects=False)
    assert again.status == 302 and again.headers["Location"] == "/admin"


async def test_password_alone_on_the_lan(mantel):
    await mantel.user("jordan", "adult")
    r, body = await page_post(mantel, "/api/auth/password", {"username": "jordan", "password": PASSWORD})
    assert r.status == 200 and body["ok"] and "next" not in body
    assert (await mantel.client.get("/login", allow_redirects=False)).status == 302


async def test_errors_do_not_say_whether_a_user_exists(mantel):
    await mantel.user("jordan", "adult")
    r1, wrong = await page_post(mantel, "/api/auth/password", {"username": "jordan", "password": "not it at all"})
    r2, unknown = await page_post(mantel, "/api/auth/password", {"username": "nobody-here", "password": "not it at all"})
    assert r1.status == r2.status == 401 and wrong == unknown == {"error": "invalid_credentials"}


async def test_rate_limit_answers_429_with_retry_after(mantel):
    await mantel.user("jordan", "adult")
    for _ in range(5):
        await page_post(mantel, "/api/auth/password", {"username": "jordan", "password": "not it at all"})
    r, body = await page_post(mantel, "/api/auth/password", {"username": "jordan", "password": PASSWORD})
    assert r.status == 429 and body["error"] == "too_many_attempts" and body["retry_after"] > 0


async def test_tunnel_door_password_alone_is_not_enough(mantel):
    await mantel.user("jordan", "adult")
    page = await mantel.client.get("/login", headers={"X-Mantel-Door": "tunnel"})
    assert metas(await page.text())["mantel-door"] == "tunnel"
    r, body = await page_post(mantel, "/api/auth/password", {"username": "jordan", "password": PASSWORD}, tunnel=True)
    assert r.status == 403 and body == {"error": "second_factor_required", "methods": []}
    assert "mantel_session" not in r.cookies


async def test_the_sign_in_endpoints_still_need_json_and_an_origin(mantel):
    r = await mantel.client.post("/api/auth/password", data="username=a&password=b",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    assert r.status == 415
    mantel.client.session.headers.pop("Origin")
    r = await mantel.client.post("/api/auth/password", json={"username": "a", "password": "b"})
    assert r.status == 403


async def test_passkey_flow(mantel):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    auth = SoftAuthenticator()
    assert (await register(mantel, auth)).status == 201
    mantel.forget_cookies()
    origin, h = localhost(mantel)
    page = await mantel.client.get("/login", params={"next": "/admin"}, headers=h)
    assert page.status == 200
    # what login.js sends: options with no user name (discoverable), then the assertion
    r, opts = await page_post(mantel, "/api/auth/passkey/options", {}, headers=h)
    assert r.status == 200 and opts["options"]["allowCredentials"] == []
    r, body = await page_post(mantel, "/api/auth/passkey/verify",
                              {"challenge_id": opts["challenge_id"], "credential": auth.get(opts["options"], origin)},
                              headers=h)
    assert r.status == 200 and body["ok"] and body["user"]["username"] == "jordan"
    again = await mantel.client.get("/login", params={"next": "/admin"}, headers=h, allow_redirects=False)
    assert again.status == 302 and again.headers["Location"] == "/admin"
    row = mantel.store.db.execute("SELECT method FROM sessions WHERE revoked IS NULL ORDER BY rowid DESC").fetchone()
    assert row["method"] == "passkey"


async def test_passkey_on_the_tunnel_after_the_password_was_refused(mantel):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    auth = SoftAuthenticator()
    await register(mantel, auth)
    mantel.forget_cookies()
    origin, h = localhost(mantel)
    r, body = await page_post(mantel, "/api/auth/password", {"username": "jordan", "password": PASSWORD},
                              tunnel=True, headers=h)
    assert r.status == 403 and body["methods"] == ["passkey"]       # the page points at its passkey button
    r, opts = await page_post(mantel, "/api/auth/passkey/options", {}, tunnel=True, headers=h)
    r, body = await page_post(mantel, "/api/auth/passkey/verify",
                              {"challenge_id": opts["challenge_id"], "credential": auth.get(opts["options"], origin)},
                              tunnel=True, headers=h)
    assert r.status == 200 and body["session"]["door"] == "tunnel"


async def test_a_bad_passkey_is_a_plain_refusal(mantel):
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    auth = SoftAuthenticator()
    await register(mantel, auth)
    mantel.forget_cookies()
    origin, h = localhost(mantel)
    r, opts = await page_post(mantel, "/api/auth/passkey/options", {}, headers=h)
    stranger = SoftAuthenticator()
    stranger.user_handle = auth.user_handle
    r, body = await page_post(mantel, "/api/auth/passkey/verify",
                              {"challenge_id": opts["challenge_id"], "credential": stranger.get(opts["options"], origin)},
                              headers=h)
    assert r.status == 401 and "mantel_session" not in r.cookies


# -- the page's JS, driven in node -------------------------------------------------------------------
def node_module(body: str) -> list:
    js = (f"const m = await import({json.dumps((LOGIN / 'login.js').as_uri())});\n"
          f"const out = [];\n{body}\nconsole.log(JSON.stringify(out));")
    out = subprocess.run([NODE, "--input-type=module", "-e", js], capture_output=True, text=True, check=True).stdout
    return json.loads(out)


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_js_messages():
    out = node_module("""
      out.push(m.messageFor(401, { error: 'invalid_credentials' }, 'password'));
      out.push(m.messageFor(429, { error: 'too_many_attempts', retry_after: 45 }, 'password'));
      out.push(m.messageFor(429, { error: 'too_many_attempts', retry_after: 900 }, 'password'));
      out.push(m.messageFor(403, { error: 'second_factor_required', methods: ['passkey'] }, 'password'));
      out.push(m.messageFor(403, { error: 'second_factor_required', methods: [] }, 'password'));
      out.push(m.messageFor(401, { error: 'invalid_code' }, 'totp'));
      out.push(m.messageFor(401, { error: 'credential_unknown' }, 'passkey'));
      out.push(m.messageFor(0, null, 'password'));
      out.push(m.baseFrom('/api/hassio_ingress/abc_DEF-1'), m.baseFrom('https://evil'), m.baseFrom('/x'));
    """)
    assert out[0] == "That user name and password did not match."
    assert out[1] == "Too many tries. Try again in 45 seconds."
    assert out[2] == "Too many tries. Try again in 15 minutes."
    assert "passkey instead" in out[3] and "no passkey" in out[4] and "away from home" in out[4].lower()
    assert "code was not accepted" in out[5] and out[6] == "That passkey was not accepted."
    assert out[7].startswith("Could not reach Mantel")
    assert out[8:] == ["/api/hassio_ingress/abc_DEF-1", "", ""]


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_js_flows_with_a_fake_server():
    out = node_module("""
      const calls = [];
      const answers = [];
      const fetchImpl = async (url, init) => {
        calls.push([url, init.method, init.headers['Content-Type'], JSON.parse(init.body), init.credentials]);
        const [status, data] = answers.shift();
        return { status, json: async () => data };
      };
      const flow = m.signIn({ fetchImpl, base: '/api/hassio_ingress/tok' });
      answers.push([200, { ok: true, next: 'totp', pending: 'P1' }]);
      out.push(await flow.password('jordan', 'pw'));
      out.push(await flow.totp('P1', '12 34'));                       // not six digits: no request
      answers.push([401, { error: 'invalid_code' }]);
      out.push((await flow.totp('P1', '123456')).message);
      answers.push([401, { error: 'pending_invalid' }]);
      out.push((await flow.totp('P1', '123456')).kind);
      answers.push([200, { ok: true, user: { username: 'jordan' } }]);
      out.push((await flow.totp('P1', '654321')).kind);
      out.push(calls);
      const broken = m.signIn({ fetchImpl: async () => { throw new TypeError('offline'); } });
      out.push((await broken.password('a', 'b')).message);
      out.push((await broken.password('', 'b')).code);
    """)
    assert out[0] == {"kind": "totp", "pending": "P1"}
    assert out[1]["code"] == "code_format"
    assert "not accepted" in out[2] and out[3] == "restart" and out[4] == "done"
    calls = out[5]
    assert [c[0] for c in calls] == ["/api/hassio_ingress/tok/api/auth/password"] + \
        ["/api/hassio_ingress/tok/api/auth/totp/verify"] * 3
    assert all(c[1] == "POST" and c[2] == "application/json" and c[4] == "same-origin" for c in calls)
    assert calls[0][3] == {"username": "jordan", "password": "pw"}
    assert calls[1][3] == {"pending": "P1", "code": "123456"}
    assert out[6].startswith("Could not reach Mantel") and out[7] == "username_and_password_required"


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_js_passkey_flow_with_a_fake_authenticator():
    out = node_module("""
      const answers = [
        [200, { ok: true, challenge_id: 'C1', options: { challenge: 'AAEC', rpId: 'localhost', allowCredentials: [],
                                                         userVerification: 'required' } }],
        [200, { ok: true, user: { username: 'jordan' } }],
      ];
      const bodies = [];
      const fetchImpl = async (url, init) => { bodies.push([url, JSON.parse(init.body)]);
        const [status, data] = answers.shift(); return { status, json: async () => data }; };
      const seen = [];
      const credentials = { get: async ({ publicKey }) => {
        seen.push([...new Uint8Array(publicKey.challenge)], publicKey.rpId);
        return { toJSON: () => ({ id: 'cred', type: 'public-key', response: { signature: 'sig' } }) };
      } };
      out.push((await m.signIn({ fetchImpl, credentials }).passkey()).kind);
      out.push(bodies, seen);
      const cancelled = { get: async () => { const e = new Error('x'); e.name = 'NotAllowedError'; throw e; } };
      answers.push([200, { ok: true, challenge_id: 'C2', options: { challenge: 'AAEC', allowCredentials: [] } }]);
      out.push((await m.signIn({ fetchImpl, credentials: cancelled }).passkey()).code);
      answers.push([429, { error: 'too_many_attempts', retry_after: 30 }]);
      out.push((await m.signIn({ fetchImpl, credentials }).passkey()).message);
    """)
    assert out[0] == "done"
    bodies, seen = out[1], out[2]
    assert bodies[0] == ["/api/auth/passkey/options", {}]                 # never a user name
    assert bodies[1] == ["/api/auth/passkey/verify", {"challenge_id": "C1", "credential":
                         {"id": "cred", "type": "public-key", "response": {"signature": "sig"}}}]
    assert seen == [[0, 1, 2], "localhost"]
    assert out[3] == "cancelled" and out[4] == "Too many tries. Try again in 30 seconds."


@pytest.mark.skipif(NODE is None, reason="node is not installed")
async def test_js_password_totp_against_the_real_server(mantel):
    """login.js's signIn(), run in node against this test's server: password, then the code."""
    await mantel.user("jordan", "adult")
    await mantel.sign_in("jordan")
    secret = (await (await mantel.post("/api/auth/totp/enroll")).json())["secret"]
    seed = seed_of(secret)
    assert (await mantel.post("/api/auth/totp/enroll/confirm", {"code": totp(seed, mantel.now[0])})).status == 200
    mantel.forget_cookies()
    mantel.now[0] += 60
    code = totp(seed, mantel.now[0])
    js = f"""
      const m = await import({json.dumps((LOGIN / 'login.js').as_uri())});
      const origin = {json.dumps(mantel.origin)};
      // node has no page: send the Origin a browser would, and the server's address in front of the path
      const fetchImpl = (path, init) => fetch(origin + path, {{ ...init, headers: {{ ...init.headers, Origin: origin }} }});
      const flow = m.signIn({{ fetchImpl }});
      const out = [];
      out.push((await flow.password('jordan', 'wrong password here')).message);
      const first = await flow.password('jordan', {json.dumps(PASSWORD)});
      out.push(first.kind);
      out.push((await flow.totp(first.pending, '000000')).code);
      const done = await flow.totp(first.pending, {json.dumps(code)});
      out.push(done.kind, done.data.user.username, done.data.session.door);
      console.log(JSON.stringify(out));
    """
    proc = await asyncio.create_subprocess_exec(NODE, "--input-type=module", "-e", js,
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    stdout, stderr = await asyncio.wait_for(proc.communicate(), 60)
    assert proc.returncode == 0, stderr.decode()
    assert json.loads(stdout) == ["That user name and password did not match.", "totp", "invalid_code",
                                  "done", "jordan", "lan"]
    row = mantel.store.db.execute("SELECT method FROM sessions WHERE revoked IS NULL ORDER BY rowid DESC").fetchone()
    assert row["method"] == "password+totp"


def test_module_constants_match_the_page():
    assert login_page.DEFAULT_NEXT == "/home"
    js = (LOGIN / "login.js").read_text()
    assert "export const DEFAULT_NEXT = '/home';" in js and f"NEXT_MAX = {login_page.NEXT_MAX};" in js


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_js_knows_a_frame_of_another_site():
    """A Webpage dashboard in HA's sidebar frames Mantel's address: another site's frame. HK Settings' preview
    and Ingress frame Mantel from its own origin, and a page on its own is not framed at all."""
    out = node_module("""
      const own = { location: { origin: 'https://mantel.example' } };
      own.self = own; own.top = own;
      out.push(m.framedElsewhere(own));
      const sameTop = { location: { origin: 'https://mantel.example' } };
      out.push(m.framedElsewhere({ self: {}, top: sameTop, location: { origin: 'https://mantel.example' } }));
      const foreignTop = {};
      Object.defineProperty(foreignTop, 'location', { get() { throw new Error('SecurityError'); } });
      out.push(m.framedElsewhere({ self: {}, top: foreignTop, location: { origin: 'https://mantel.example' } }));
      out.push(m.framedElsewhere({ self: {}, top: { location: { origin: 'https://ha.example' } },
                                   location: { origin: 'https://mantel.example' } }));
      out.push(m.HA_MAIN_WINDOW);
      const listed = (...o) => ({ location: { ancestorOrigins: o } });
      out.push(m.topOrigin(listed('https://ha.example', 'https://mantel.example')));   // the last is the top
      out.push(m.topOrigin(listed('https://mantel.example', 'https://ha.example:8123')));
      out.push(m.topOrigin({ location: {} }), m.topOrigin(listed()), m.topOrigin(listed('null')),
               m.topOrigin(listed('https://ha.example/x')));
      out.push(m.withVia('login/ha?next=/x', 'https://ha.example:8123'), m.withVia('login/ha', 'https://h.example'));
    """)
    assert out == [False, False, True, True, "ha-main-window", "https://mantel.example", "https://ha.example:8123",
                   "", "", "", "", "login/ha?next=/x&via=https%3A%2F%2Fha.example%3A8123",
                   "login/ha?via=https%3A%2F%2Fh.example"]


@pytest.mark.skipif(NODE is None, reason="node is not installed")
def test_js_first_start_restore_sends_the_setup_code_first():
    """First start's Restore From a Backup posts one multipart form, the setup code first (the server checks it
    before it reads the upload), and shows what the server says when the backup doesn't check out."""
    out = node_module("""
      const sent = [];
      const answers = [[200, { ok: true, restarting: true, created: '2026-11-02' }],
                       [400, { ok: false, error: 'wrong_at_rest_key', message: 'Fictional reason.' }],
                       [400, { ok: false, error: 'wrong_key' }]];
      const fetchImpl = async (url, init) => {
        sent.push([url, init.method, [...init.body.keys()], init.headers['Content-Type'] || null]);
        const [status, data] = answers.shift();
        return { status, json: async () => data };
      };
      const flow = m.signIn({ fetchImpl });
      const file = new Blob(['x']), keys = new Blob(['{}']);
      out.push((await flow.restore('CODE', file, keys)).kind);
      out.push((await flow.restore('CODE', file, null)).message);
      out.push((await flow.restore('CODE', file, null)).message);
      out.push((await flow.restore('', file, null)).code, (await flow.restore('CODE', null, null)).code);
      out.push(sent);
    """)
    assert out[0] == "done" and out[1] == "Fictional reason." and "keys file" in out[2]
    assert out[3:5] == ["bootstrap_token_invalid", "no_file"]
    assert [s[:3] for s in out[5]] == [["/api/bootstrap/restore", "POST", ["token", "file", "keys"]],
                                       ["/api/bootstrap/restore", "POST", ["token", "file"]],
                                       ["/api/bootstrap/restore", "POST", ["token", "file"]]]
    assert all(s[3] is None for s in out[5]), "the browser sets the multipart boundary itself"
