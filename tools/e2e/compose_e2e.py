"""THE DOCKER MODE, END TO END: the compose stack (Caddy, Mantel Server, go2rtc) against the scratch HA.

Needs Docker (Docker Desktop on Avery's Mac) and the images built (`mantel-server:local`,
`mantel-caddy:local`, `mantel-transcode:local`; docs/phase3/PACKAGING.md). Uses only the scratch HA
(tools/testha/, 127.0.0.1:8124, demo devices) -- never the house -- and throwaway secrets in a temp
folder. Commands stay off. The stack runs under its own compose project and is torn down at the end.

    ~/.venvs/mantel/bin/python tools/e2e/compose_e2e.py

Home Assistant is set up THROUGH THE PAGE, as a person would (connections.py): no HA address in .env and an
empty ha_token file. The stack starts unconnected; the first Owner is created with `mantel bootstrap` and
POST /api/bootstrap (what the login page's first-start form sends); then, through Caddy, a pasted long-lived
token is tested, and "Connect to Home Assistant" runs HA's real login flow (as the scratch HA's throwaway
user) back to Mantel's callback, and is saved. Mantel connects without a restart.

Checks: every service healthy; HA not connected before the page sets it up; the security headers (CSP, HSTS,
nosniff, frame-ancestors); the connection tested and saved through the page, sealed in /data/connections
(0600), never in a response or a log; /healthz then says HA is connected; the server runs as uid 10001 on a
read-only root with /data writable; `bootstrap` and `backup` pass through the entrypoint; the backup restores
(--verify-only) with the backup key.

MANTEL_E2E_SERVER_IMAGE=<tag> runs another server image than mantel-server:local (a branch's own build).
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import secrets
import shutil
import ssl
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import aiohttp

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/testha"))
import testha  # noqa: E402

PROJECT = "mantel-e2e"
PORT = 18443
HOST = "mantel.localhost"
results: list[tuple[bool, str]] = []


def say(*a):
    print("[compose-e2e]", *a, flush=True)


def check(ok: bool, what: str) -> bool:
    results.append((bool(ok), what))
    say("PASS" if ok else "FAIL", what)
    return bool(ok)


def sh(*args, env=None, check_rc=True, timeout=900) -> subprocess.CompletedProcess:
    p = subprocess.run(list(args), env=env, capture_output=True, text=True, timeout=timeout)
    if check_rc and p.returncode:
        raise SystemExit(f"{' '.join(args[:4])}... failed ({p.returncode}):\n{p.stdout[-2000:]}\n{p.stderr[-2000:]}")
    return p


def key() -> str:
    return base64.b64encode(secrets.token_bytes(32)).decode() + "\n"


async def scratch_token() -> str:
    async with aiohttp.ClientSession() as h:
        return await testha.access_token(h)


def caddy_session() -> aiohttp.ClientSession:
    ctx = ssl.create_default_context()
    ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
    return aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=ctx), cookie_jar=aiohttp.CookieJar(unsafe=True))


async def caddy_call(s: aiohttp.ClientSession, method: str, path: str, body=None, params=None) -> tuple[int, object]:
    """One request to Mantel through Caddy on the public hostname, as the page sends it (Origin, CSRF, JSON)."""
    headers = {"Host": HOST, "Origin": f"https://{HOST}"}
    jar = {c.key: c.value for c in s.cookie_jar}
    if "mantel_csrf" in jar:
        headers["X-CSRF-Token"] = jar["mantel_csrf"]
    async with s.request(method, f"https://127.0.0.1:{PORT}{path}", headers=headers, server_hostname=HOST,
                         json=body, params=params, allow_redirects=False) as r:
        text = await r.text()
        try:
            return r.status, json.loads(text)
        except ValueError:
            return r.status, text


async def scratch_long_lived_token() -> str:
    """A long-lived token of the scratch HA's throwaway user, as a person would paste it."""
    async with aiohttp.ClientSession() as h:
        access = await testha.access_token(h)
        async with h.ws_connect(f"ws://127.0.0.1:{testha.PORT}/api/websocket") as ws:
            await ws.receive_json()
            await ws.send_json({"type": "auth", "access_token": access})
            await ws.receive_json()
            await ws.send_json({"id": 1, "type": "auth/long_lived_access_token",
                                "client_name": f"compose e2e {secrets.token_hex(3)}", "lifespan": 1})
            return (await ws.receive_json())["result"]


async def ha_login_code(client_id: str, redirect_uri: str) -> str:
    """HA's own login page, done over its login-flow API with the scratch user: the authorization code."""
    c = testha.creds()
    async with aiohttp.ClientSession() as h:
        async with h.post(testha.BASE + "/auth/login_flow", json={"client_id": client_id, "handler": ["homeassistant", None],
                                                                  "redirect_uri": redirect_uri}) as r:
            flow = await r.json()
        async with h.post(testha.BASE + f"/auth/login_flow/{flow['flow_id']}",
                          json={"username": c["username"], "password": c["password"], "client_id": client_id}) as r:
            done = await r.json()
    if done.get("type") != "create_entry":
        raise SystemExit(f"HA's login flow did not finish: {done.get('type')} {done.get('errors')}")
    return done["result"]


async def set_up_through_the_page(base: list, env: dict, work: Path) -> dict:
    """The first Owner, then Home Assistant on the Connections page; returns what was seen."""
    from urllib.parse import parse_qs, urlparse
    seen: dict = {}
    boot = sh(*base, "exec", "-T", "mantel-server", "mantel", "bootstrap", env=env, check_rc=False)
    (work / "bootstrap.out").write_text("(setup code withheld)\n" if boot.returncode == 0 else boot.stderr)
    code = next((ln.strip() for ln in boot.stdout.splitlines() if ln.startswith("    ") and ln.strip()), "")
    check(boot.returncode == 0 and code, "`docker compose exec mantel-server mantel bootstrap` passes through the entrypoint")
    password = secrets.token_urlsafe(18)
    llat = await scratch_long_lived_token()
    seen["secrets"] = [llat, password, code]
    async with caddy_session() as s:
        status, body = await caddy_call(s, "GET", "/api/bootstrap")
        check(status == 200 and body.get("open") is True, "first start: the setup is open (the login page offers it)")
        status, body = await caddy_call(s, "POST", "/api/bootstrap", {"token": code, "username": "owner-e2e",
                                                                       "name": "E2E Owner", "password": password})
        check(status == 200, f"the first Owner is created through Caddy (HTTP {status})")
        status, body = await caddy_call(s, "GET", "/api/admin/overview")
        check(status == 200 and body.get("ha_set_up") is False and "connections" in body.get("sections", []),
              "the admin page opens on Connections: Home Assistant is not set up")
        ha_url = f"http://host.docker.internal:{testha.PORT}"
        status, body = await caddy_call(s, "POST", "/api/connections/ha/test", {"url": ha_url, "token": "not-a-real-token"})
        check(status == 422 and body.get("error") == "token_refused" and "did not accept" in body.get("message", ""),
              "a wrong token is refused in plain words")
        status, body = await caddy_call(s, "POST", "/api/connections/ha/test", {"url": ha_url, "token": llat})
        r = body.get("result", {}) if isinstance(body, dict) else {}
        check(status == 200 and (r.get("entities") or 0) > 10 and r.get("version") and (r.get("user") or {}).get("is_admin"),
              f"a pasted long-lived token tests live: HA {r.get('version')}, {r.get('entities')} entities, as {(r.get('user') or {}).get('name')}")
        # Connect to Home Assistant: HA's real login (its login-flow API, as its sign-in page uses it)
        status, body = await caddy_call(s, "POST", "/api/connections/ha/oauth/start", {"url": ha_url})
        q = parse_qs(urlparse(body["authorize_url"]).query)
        check(status == 200 and q["client_id"] == [f"https://{HOST}/"]
              and q["redirect_uri"] == [f"https://{HOST}/auth/connection/callback"],
              "Connect to Home Assistant: HA's authorize page, with Mantel's public address as the client")
        code_ha = await ha_login_code(q["client_id"][0], q["redirect_uri"][0])
        status, text = await caddy_call(s, "GET", "/auth/connection/callback", params={"state": q["state"][0], "code": code_ha})
        check(status == 200 and f"connection={body['pending']}" in str(text), "HA sent the browser back; Mantel tested the sign-in")
        status, got = await caddy_call(s, "GET", f"/api/connections/pending/{body['pending']}")
        p = got.get("pending", {}) if isinstance(got, dict) else {}
        check(p.get("state") == "ready" and (p.get("result") or {}).get("entities"),
              f"the pending connection shows who Mantel would act as ({(p.get('result') or {}).get('user', {}).get('name')})")
        status, saved = await caddy_call(s, "POST", "/api/connections/ha", {"pending": body["pending"]})
        conn = saved.get("connection", {}) if isinstance(saved, dict) else {}
        check(status == 200 and conn.get("source") == "mantel" and (conn.get("saved") or {}).get("method") == "oauth",
              "saved: a long-lived token made for that user, sealed by Mantel")
        deadline, live = time.time() + 60, {}
        while time.time() < deadline:
            _, st = await caddy_call(s, "GET", "/api/connections")
            live = st["connections"]["ha"]["live"]
            if live.get("connected") and live.get("entities"):
                break
            await asyncio.sleep(2)
        check(live.get("connected") is True and live.get("entities"),
              f"applied without a restart: Mantel is connected ({live.get('entities')} entities, HA {live.get('version')})")
        seen["responses"] = json.dumps([body, got, saved, st, r])
    return seen


async def through_caddy(path: str) -> tuple[int, dict, str]:
    ctx = ssl.create_default_context()
    ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE   # Caddy's own CA in this test
    conn = aiohttp.TCPConnector(ssl=ctx)
    async with aiohttp.ClientSession(connector=conn) as s:
        # the public hostname, reached on 127.0.0.1 (SNI + Host = mantel.localhost)
        async with s.get(f"https://127.0.0.1:{PORT}{path}", headers={"Host": HOST},
                         server_hostname=HOST, allow_redirects=False) as r:
            return r.status, dict(r.headers), await r.text()


def main() -> int:
    started_ha = False
    if not testha.ready():
        say("starting the scratch HA")
        sh(sys.executable, str(ROOT / "tools/testha/testha.py"), "up", "--fresh", timeout=1500)
        started_ha = True
    work = Path(tempfile.mkdtemp(prefix="mantel-compose-e2e-"))
    compose_dir = work / "compose"
    shutil.copytree(ROOT / "packaging/compose", compose_dir)
    sec = work / "secrets"
    sec.mkdir(mode=0o700)
    (work / "backups").mkdir()
    # Home Assistant is set up through the page: an empty ha_token file (as the LXC script makes it) and no address
    for name, text in {"ha_token": "", "ma_token": "", "at_rest.key": key(), "backup.key": key(),
                       "cloudflare_dns_token": "", "cloudflared_token": ""}.items():
        (sec / name).write_text(text)
        os.chmod(sec / name, 0o444)            # Docker Desktop: the container's user must read them
    (compose_dir / ".env").write_text("\n".join([
        f"MANTEL_HOSTNAME={HOST}", "MANTEL_LAN_IP=127.0.0.1",
        "MANTEL_HA_URL=",
        *([f"MANTEL_SERVER_IMAGE={os.environ['MANTEL_E2E_SERVER_IMAGE']}"] if os.environ.get("MANTEL_E2E_SERVER_IMAGE") else []),
        "MANTEL_TLS_SNIPPET=./caddy/tls-internal.caddy", f"MANTEL_SECRETS_DIR={sec}",
        f"MANTEL_HTTPS_PORT={PORT}", f"MANTEL_BACKUP_DIR={work / 'backups'}", "MANTEL_BACKUP_TARGET=",
        "MANTEL_MA_URL=", ""]))
    env = dict(os.environ)
    base = ["docker", "compose", "-p", PROJECT, "--project-directory", str(compose_dir),
            "-f", str(compose_dir / "compose.yaml")]
    try:
        sh(*base, "config", "-q", env=env)
        check(True, "docker compose config: the file and .env are valid")
        up = sh(*base, "up", "-d", "--wait", "--wait-timeout", "240", env=env, check_rc=False, timeout=600)
        ps = sh(*base, "ps", "--format", "json", env=env).stdout
        rows = [json.loads(line) for line in ps.splitlines() if line.strip().startswith("{")] or json.loads(ps or "[]")
        health = {r.get("Service"): r.get("Health") or r.get("State") for r in rows}
        check(up.returncode == 0 and all(v == "healthy" for v in health.values()) and len(health) >= 3,
              f"compose up --wait: every service healthy {health}")
        if up.returncode:
            (work / "up.log").write_text(up.stdout + up.stderr)
            say("compose up failed; see", work / "up.log")
        probe = "import urllib.request as u;print(u.urlopen('http://127.0.0.1:8765/healthz').read().decode())"
        out = sh(*base, "exec", "-T", "mantel-server", "python", "-c", probe, env=env, check_rc=False).stdout
        try:
            first = json.loads(out)
        except ValueError:
            first = {}
        check(first.get("upstream", {}).get("home_assistant", {}).get("connected") is False,
              "started with no Home Assistant credential: running, not connected (status degraded)")
        seen = asyncio.run(set_up_through_the_page(base, env, work))
        token = seen["secrets"][0]
        mode = sh(*base, "exec", "-T", "mantel-server", "sh", "-c",
                  "stat -c '%a %u' /data/connections /data/connections/ha.connection", env=env, check_rc=False).stdout.split()
        check(mode == ["700", "10001", "600", "10001"], f"the sealed connection file: /data/connections 0700, ha.connection 0600 ({mode})")
        raw = sh(*base, "exec", "-T", "mantel-server", "sh", "-c", "grep -c eyJ /data/connections/ha.connection || true",
                 env=env, check_rc=False).stdout.strip()
        check(raw == "0", "the file is sealed (no token text in it)")
        check(not any(x in seen["responses"] for x in seen["secrets"]), "no token or password in any answer to the page")
        # Mantel connected to the scratch HA (health is internal: read it inside the container)
        deadline, body = time.time() + 60, {}
        while time.time() < deadline:
            out = sh(*base, "exec", "-T", "mantel-server", "python", "-c", probe, env=env, check_rc=False).stdout
            try:
                body = json.loads(out)
            except ValueError:
                body = {}
            if body.get("upstream", {}).get("home_assistant", {}).get("connected"):
                break
            time.sleep(3)
        check(body.get("upstream", {}).get("home_assistant", {}).get("connected") is True,
              f"Mantel in its container is connected to the scratch HA (status {body.get('status')})")
        check(token.strip() not in json.dumps(body), "the health answer does not contain the HA token")
        # through Caddy: TLS on the public hostname; health is not exposed there
        status, _, _ = asyncio.run(through_caddy("/healthz"))
        check(status == 404, f"through Caddy, /healthz is not public (HTTP {status})")
        status, headers, _ = asyncio.run(through_caddy("/login"))
        check(status in (200, 302), f"through Caddy (https://{HOST}:{PORT}/login): Mantel answers (HTTP {status})")
        csp = headers.get("Content-Security-Policy", "")
        check("script-src 'self'" in csp and "frame-ancestors" in csp and headers.get("Strict-Transport-Security")
              and headers.get("X-Content-Type-Options") == "nosniff",
              f"security headers on {HOST}: CSP script-src 'self' + frame-ancestors, HSTS, nosniff")
        # the server's own restrictions
        uid = sh(*base, "exec", "-T", "mantel-server", "id", "-u", env=env).stdout.strip()
        ro = sh(*base, "exec", "-T", "mantel-server", "sh", "-c", "touch /app/x", env=env, check_rc=False)
        rw = sh(*base, "exec", "-T", "mantel-server", "sh", "-c", "touch /data/.w && echo ok", env=env, check_rc=False)
        check(uid == "10001" and ro.returncode != 0 and rw.stdout.strip() == "ok",
              f"mantel-server: uid {uid}, read-only root, /data writable")
        # admin commands through the entrypoint (bootstrap was used above)
        logs = sh(*base, "logs", "--no-color", "mantel-server", env=env, check_rc=False)
        check(not any(x in logs.stdout + logs.stderr for x in seen["secrets"][:2]),
              "the server's log holds no token and no password")
        bk = sh(*base, "exec", "-T", "mantel-server", "mantel", "backup", "--target", "/backups", env=env, check_rc=False)
        (work / "backup.out").write_text(bk.stdout + bk.stderr)
        files = sorted((work / "backups").glob("*.mbk"))
        check(bk.returncode == 0 and len(files) == 1, f"`backup --target /backups`: one encrypted backup ({[f.name for f in files]})")
        if files:
            # a restore runs with the server stopped (its address is then free for `run`)
            sh(*base, "stop", "mantel-server", env=env, check_rc=False)
            rs = sh(*base, "run", "--rm", "-T", "--no-deps", "-v", f"{work / 'backups'}:/restore-src:ro", "mantel-server",
                    "restore", f"/restore-src/{files[0].name}", "--verify-only", env=env, check_rc=False)
            check(rs.returncode == 0, "`restore --verify-only` decrypts and checks the backup with the backup key")
            if rs.returncode:
                say(rs.stdout[-800:], rs.stderr[-800:])
    finally:
        for svc in ("caddy", "mantel-server", "go2rtc"):
            logs = sh(*base, "logs", "--no-color", "--tail", "60", svc, env=env, check_rc=False)
            (work / f"{svc}.log").write_text(logs.stdout + logs.stderr)
        sh(*base, "down", "-v", "--remove-orphans", env=env, check_rc=False)
        if started_ha:
            sh(sys.executable, str(ROOT / "tools/testha/testha.py"), "down", check_rc=False)
            say("scratch HA stopped")
        say("work folder (secrets are throwaway):", work)
    failed = [w for ok, w in results if not ok]
    say(f"{len(results) - len(failed)}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
