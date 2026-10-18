"""THE DOCKER MODE, END TO END: the compose stack against the scratch HA, behind Mantel's Caddy and then behind
"your own" reverse proxy (a plain nginx running exactly the Nginx Proxy Manager block of docs/OPERATIONS.md).

Needs Docker (Docker Desktop on Avery's Mac) and the images built (`mantel-server:local` or the tag in
MANTEL_E2E_SERVER_IMAGE, `mantel-caddy:local`, `mantel-transcode:local`; docs/phase3/PACKAGING.md), plus
`nginx:1.27-alpine` and `openssl` for the second run. Uses only the scratch HA (tools/testha/,
127.0.0.1:8124, demo devices) -- never the house -- a fictional Music Assistant on 127.0.0.1 (tests'
https_fakes) and throwaway secrets in a temp folder. Commands stay off. Each stack runs under its own
compose project and is torn down at the end.

    ~/.venvs/mantel/bin/python tools/e2e/compose_e2e.py            # both runs
    ~/.venvs/mantel/bin/python tools/e2e/compose_e2e.py caddy      # or just one: caddy | byo

Caddy run: every service healthy; through Caddy (TLS, the public hostname) /healthz is hidden and Mantel
answers; Mantel's own security headers arrive once (CSP with the page's wss origin, HSTS, nosniff); the
first Owner is made and signs in on the LAN door; /proxy-check's report is clean and its WebSocket passes;
Music Assistant's app and socket through /ma/ with its address replaced; go2rtc's socket through /go2rtc/
and its stream management refused; the server runs as uid 10001 on a read-only root with /data writable;
`bootstrap` and `backup` pass through the entrypoint; the backup restores (--verify-only).

Your-own-proxy run (compose.byo-proxy.yaml + an nginx with TLS): Caddy does not run; Mantel publishes its
one port; through nginx the same headers, sign-in on the LAN door, a clean /proxy-check and the sockets;
a second nginx host WITHOUT the door header gives the tunnel door (fail closed), and the probe shows such
a host passes a browser's own door header through (what /proxy-check warns about); the published port
reached directly is not the trusted proxy (tunnel door).
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import secrets
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import aiohttp
from aiohttp import web

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools/testha"))
sys.path.insert(0, str(ROOT / "tests"))
sys.path.insert(0, str(ROOT / "hosts/server"))
import testha  # noqa: E402
from https_fakes import Upstream, ma_app  # noqa: E402
from mantel_server.proxy_check import PROBE, npm_advanced  # noqa: E402

PROJECT = "mantel-e2e"
PORT = 18443                 # Caddy's / nginx's https
NGINX_BARE_PORT = 18444      # the second nginx host: no Mantel headers at all
HTTP_PORT = 18765            # Mantel's published port (your-own-proxy run)
HOST = "mantel.localhost"
NGINX_IP = "172.31.252.2"    # "your proxy", on a network of its own with Mantel
MANTEL_PROXYNET_IP = "172.31.252.3"
SERVER_IMAGE = os.environ.get("MANTEL_E2E_SERVER_IMAGE", "mantel-server:local")
NGINX_IMAGE = "nginx:1.27-alpine"
PASSWORD = "e2e fictional long passphrase 7"
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


# -- a fictional Music Assistant on the Mac (the container reaches it as host.docker.internal) -------------
def start_fake_ma() -> tuple[Upstream, int]:
    up = Upstream()
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    ready = threading.Event()

    def run():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        app = ma_app(up)
        runner = web.AppRunner(app)
        loop.run_until_complete(runner.setup())
        loop.run_until_complete(web.TCPSite(runner, "127.0.0.1", port).start())
        ready.set()
        loop.run_forever()

    class _S:   # https_fakes' pages print up.url: what Mantel was given
        def make_url(self, path):
            return f"http://host.docker.internal:{port}{path}"
    up.server = _S()
    threading.Thread(target=run, daemon=True).start()
    ready.wait(10)
    return up, port


# -- a browser at https://mantel.localhost:<port> ----------------------------------------------------------
class Browser:
    def __init__(self, port: int, host: str = HOST):
        self.port, self.host = port, host
        self.origin = f"https://{host}:{port}"

    async def __aenter__(self):
        ctx = ssl.create_default_context()
        ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE     # Caddy's own CA / a self-signed nginx

        class Resolver(aiohttp.abc.AbstractResolver):
            async def resolve(self, host, port=0, family=socket.AF_INET):
                return [{"hostname": host, "host": "127.0.0.1", "port": port, "family": socket.AF_INET,
                         "proto": 0, "flags": socket.AI_NUMERICHOST}]

            async def close(self):
                pass
        self.s = aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=ctx, resolver=Resolver()),
                                       cookie_jar=aiohttp.CookieJar(unsafe=True),
                                       headers={"Origin": self.origin})
        return self

    async def __aexit__(self, *exc):
        await self.s.close()

    def csrf(self) -> dict:
        for c in self.s.cookie_jar:
            if c.key == "mantel_csrf":
                return {"X-CSRF-Token": c.value}
        return {}

    async def get(self, path, headers=None):
        async with self.s.get(self.origin + path, headers=headers or {}, allow_redirects=False) as r:
            return r.status, r.headers, await r.read()

    async def post(self, path, body, headers=None):
        async with self.s.post(self.origin + path, json=body, headers={**self.csrf(), **(headers or {})},
                               allow_redirects=False) as r:
            return r.status, r.headers, await r.read()

    def ws(self, path, headers=None):
        return self.s.ws_connect(f"wss://{self.host}:{self.port}{path}", headers=headers or {},
                                 origin=self.origin)


def loads(body: bytes) -> dict:
    try:
        got = json.loads(body or b"{}")
    except ValueError:
        return {"unreadable": body[:120].decode(errors="replace")}
    return got if isinstance(got, dict) else {}


def owner_token(base, env) -> str:
    out = sh(*base, "exec", "-T", "mantel-server", "mantel", "bootstrap", env=env).stdout
    m = re.search(r"token[^\n]*:\n\n\s+(\S+)", out)
    return m.group(1) if m else ""


async def web_checks(base, env, port: int, label: str, ma: Upstream) -> None:
    """Through the proxy at https://mantel.localhost:<port>: headers, the first Owner, /proxy-check, /ma/,
    /go2rtc/."""
    async with Browser(port) as b:
        status, h, _ = await b.get("/healthz")
        check(status == 404, f"{label}: /healthz is not public (HTTP {status})")
        status, h, _ = await b.get("/login")
        csps = h.getall("Content-Security-Policy", [])
        check(status == 200 and len(csps) == 1, f"{label}: Mantel answers /login with ONE CSP header ({len(csps)})")
        status, h, _ = await b.get("/api/version")
        csp = h.get("Content-Security-Policy", "")
        check("script-src 'self'" in csp and "frame-ancestors 'self'" in csp and f"wss://{HOST}" in csp
              and h.get("Strict-Transport-Security") == "max-age=31536000" and h.get("X-Content-Type-Options") == "nosniff"
              and "aiohttp" not in h.get("Server", "") and "Python" not in h.get("Server", ""),
              f"{label}: Mantel's own headers arrive (CSP with wss://{HOST}, HSTS, nosniff, no Server of Mantel's) "
              f"[{h.get('Strict-Transport-Security')}, {h.get('Server')}]")
        token = owner_token(base, env)
        status, _, body = await b.post("/api/bootstrap", {"token": token, "username": "owner", "name": "E2E Owner",
                                                          "password": PASSWORD})
        if status == 410:      # second run on the same data volume: the Owner exists already
            status = 200
        check(status == 200, f"{label}: the first Owner is made through the proxy (HTTP {status} {loads(body).get('error', '')})")
        b.s.cookie_jar.clear()
        status, _, body = await b.post("/api/auth/password", {"username": "owner", "password": PASSWORD})
        got = loads(body)
        check(status == 200 and got.get("session", {}).get("door") == "lan",
              f"{label}: the Owner signs in on the LAN door with a password alone ({status}, {got.get('session', {}).get('door')})")
        status, _, body = await b.get("/api/admin/proxy-check", headers={"X-Mantel-Door": PROBE})
        rep = loads(body) if status == 200 else {}
        bad = [c["id"] for c in rep.get("checks", []) if c["ok"] is False]
        check(status == 200 and rep.get("door") == "lan" and rep.get("https") is True and not bad,
              f"{label}: /proxy-check is clean (door {rep.get('door')}, https {rep.get('https')}, failing {bad})")
        try:
            async with b.ws("/api/admin/proxy-check/ws") as ws:
                msg = json.loads((await ws.receive(timeout=10)).data)
            check(msg.get("door") == "lan" and msg.get("trusted") is True,
                  f"{label}: the WebSocket upgrade passes, same door ({msg})")
        except Exception as exc:  # noqa: BLE001
            check(False, f"{label}: the WebSocket upgrade passes ({type(exc).__name__}: {exc})")
        status, _, page = await b.get("/proxy-check", headers={"Accept": "text/html"})
        check(status == 200 and b"check.js" in page, f"{label}: the Test my proxy page is served ({status})")
        # Music Assistant through /ma/
        status, h, page = await b.get("/ma/")
        text = page.decode(errors="replace")
        check(status == 200 and "Music Assistant" in text and "host.docker.internal" not in text
              and f"https://{HOST}:{port}/ma/imageproxy" in text and "ma_session" not in h.get("Set-Cookie", ""),
              f"{label}: Music Assistant's app through /ma/ over https, its address replaced ({status})")
        try:
            async with b.ws("/ma/ws") as ws:
                hello = json.loads((await ws.receive(timeout=10)).data)
                await ws.send_str(json.dumps({"command": "players/all", "message_id": 1}))
                echo = json.loads((await ws.receive(timeout=10)).data)
            check(hello.get("base_url") == f"https://{HOST}:{port}/ma" and "players/all" in echo.get("echo", ""),
                  f"{label}: Music Assistant's socket through /ma/ws (wss), announced address replaced")
        except Exception as exc:  # noqa: BLE001
            check(False, f"{label}: Music Assistant's socket through /ma/ws ({type(exc).__name__}: {exc})")
        hit = ma.hits[-1][2] if ma.hits else {}
        check(not any(k in hit for k in ("Cookie", "Authorization", "X-Forwarded-For", "X-Mantel-Door", "Origin")),
              f"{label}: nothing of Mantel's (cookies, forwarding, door, origin) reached Music Assistant")
        # go2rtc through /go2rtc/
        status, _, body = await b.get("/go2rtc/api/streams")
        check(status == 404 and b'"service": "go2rtc"' in body, f"{label}: go2rtc's stream management is not reachable ({status})")
        try:
            async with b.ws("/go2rtc/api/ws?src=camera.e2e") as ws:
                await ws.send_str(json.dumps({"type": "mse", "value": ""}))
                reply = await ws.receive(timeout=10)
            check(reply.type in (aiohttp.WSMsgType.TEXT, aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED),
                  f"{label}: go2rtc's socket opens through /go2rtc/api/ws (wss) and go2rtc answers ({reply.type.name})")
        except Exception as exc:  # noqa: BLE001
            check(False, f"{label}: go2rtc's socket through /go2rtc/api/ws ({type(exc).__name__}: {exc})")


def server_checks(base, env, work: Path, label: str) -> None:
    uid = sh(*base, "exec", "-T", "mantel-server", "id", "-u", env=env).stdout.strip()
    ro = sh(*base, "exec", "-T", "mantel-server", "sh", "-c", "touch /app/x", env=env, check_rc=False)
    rw = sh(*base, "exec", "-T", "mantel-server", "sh", "-c", "touch /data/.w && echo ok", env=env, check_rc=False)
    check(uid == "10001" and ro.returncode != 0 and rw.stdout.strip() == "ok",
          f"{label}: mantel-server: uid {uid}, read-only root, /data writable")


def wait_connected(base, env, label: str, token: str) -> None:
    deadline, body = time.time() + 90, {}
    probe = "import urllib.request as u;print(u.urlopen('http://127.0.0.1:8765/healthz').read().decode())"
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
          f"{label}: Mantel in its container is connected to the scratch HA (status {body.get('status')})")
    check(token.strip() not in json.dumps(body), f"{label}: the health answer does not contain the HA token")


def up(base, env, work: Path, label: str, expect: set[str]) -> None:
    sh(*base, "config", "-q", env=env)
    check(True, f"{label}: docker compose config: the files and .env are valid")
    got = sh(*base, "up", "-d", "--wait", "--wait-timeout", "240", env=env, check_rc=False, timeout=600)
    ps = sh(*base, "ps", "--format", "json", env=env).stdout
    rows = [json.loads(line) for line in ps.splitlines() if line.strip().startswith("{")] or json.loads(ps or "[]")
    health = {r.get("Service"): r.get("Health") or r.get("State") for r in rows}
    check(got.returncode == 0 and set(health) == expect and all(v in ("healthy", "running") for v in health.values()),
          f"{label}: compose up --wait: {health}")
    if got.returncode:
        (work / f"up-{label}.log").write_text(got.stdout + got.stderr)
        say("compose up failed; see", work / f"up-{label}.log")


def logs_and_down(base, env, work: Path, label: str, services) -> None:
    for svc in services:
        logs = sh(*base, "logs", "--no-color", "--tail", "80", svc, env=env, check_rc=False)
        (work / f"{label}-{svc}.log").write_text(logs.stdout + logs.stderr)
    sh(*base, "down", "-v", "--remove-orphans", env=env, check_rc=False)


# -- run 1: Mantel's Caddy ------------------------------------------------------------------------------
def run_caddy(work: Path, compose_dir: Path, env: dict, token: str, ma: Upstream) -> None:
    label = "caddy"
    base = ["docker", "compose", "-p", PROJECT, "--project-directory", str(compose_dir), "-f", str(compose_dir / "compose.yaml")]
    try:
        up(base, env, work, label, {"caddy", "mantel-server", "go2rtc"})
        wait_connected(base, env, label, token)
        asyncio.run(web_checks(base, env, PORT, label, ma))
        server_checks(base, env, work, label)
        boot = sh(*base, "exec", "-T", "mantel-server", "mantel", "bootstrap", env=env, check_rc=False)
        check("bootstrap" in (boot.stdout + boot.stderr).lower() or "owner" in (boot.stdout + boot.stderr).lower(),
              f"{label}: `mantel bootstrap` passes through the entrypoint")
        bk = sh(*base, "exec", "-T", "mantel-server", "mantel", "backup", "--target", "/backups", env=env, check_rc=False)
        (work / "backup.out").write_text(bk.stdout + bk.stderr)
        files = sorted((work / "backups").glob("*.mbk"))
        check(bk.returncode == 0 and len(files) == 1, f"{label}: `backup --target /backups`: one encrypted backup ({[f.name for f in files]})")
        if files:
            sh(*base, "stop", "mantel-server", env=env, check_rc=False)
            rs = sh(*base, "run", "--rm", "-T", "--no-deps", "-v", f"{work / 'backups'}:/restore-src:ro", "mantel-server",
                    "restore", f"/restore-src/{files[0].name}", "--verify-only", env=env, check_rc=False)
            check(rs.returncode == 0, f"{label}: `restore --verify-only` decrypts and checks the backup with the backup key")
    finally:
        logs_and_down(base, env, work, label, ("caddy", "mantel-server", "go2rtc"))


# -- run 2: your own reverse proxy (an nginx with the documented block) ----------------------------------
NGINX_CONF = """
events {{}}
http {{
    # map-free on purpose: exactly the block docs/OPERATIONS.md gives for Nginx Proxy Manager's Advanced tab
    server {{
        listen 443 ssl;
        server_name {host};
        ssl_certificate /etc/nginx/tls/cert.pem;
        ssl_certificate_key /etc/nginx/tls/key.pem;
{block}
    }}
    # a proxy host someone set up without Mantel's headers (NPM's defaults): no X-Mantel-Door at all
    server {{
        listen 444 ssl;
        server_name {host};
        ssl_certificate /etc/nginx/tls/cert.pem;
        ssl_certificate_key /etc/nginx/tls/key.pem;
        location / {{
            proxy_pass http://{mantel}:8765;
            proxy_http_version 1.1;
            proxy_set_header Host $http_host;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $http_connection;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }}
    }}
}}
"""

E2E_OVERRIDE = """
# tools/e2e/compose_e2e.py only: "your own proxy" (a plain nginx) on a network of its own with Mantel,
# at a fixed address that is MANTEL_TRUSTED_PROXY. Not shipped.
services:
  your-proxy:
    image: {nginx_image}
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./tls:/etc/nginx/tls:ro
    ports:
      - "127.0.0.1:{port}:443"
      - "127.0.0.1:{bare}:444"
    networks:
      proxynet:
        ipv4_address: {nginx_ip}
    depends_on:
      mantel-server:
        condition: service_healthy
  mantel-server:
    networks:
      proxynet:
        ipv4_address: {mantel_ip}
networks:
  proxynet:
    ipam:
      config:
        - subnet: 172.31.252.0/29
"""


async def byo_extra_checks(label: str) -> None:
    # the host without the door header: fail closed, and the probe shows the browser's header passes
    async with Browser(NGINX_BARE_PORT) as b:
        status, _, body = await b.get("/api/proxy-check/basics")
        got = loads(body)
        check(status == 200 and got.get("door") == "tunnel" and got.get("via_trusted_proxy") is True
              and got.get("door_header") is False,
              f"{label}: a proxy host WITHOUT the door header is the tunnel door (fail closed) {got}")
        status, _, body = await b.get("/api/proxy-check/basics", headers={"X-Mantel-Door": PROBE})
        got = loads(body)
        check(got.get("probe_passed") is True,
              f"{label}: ...and the probe shows that host passes a browser's own door header through (what /proxy-check warns about)")
        status, _, body = await b.post("/api/auth/password", {"username": "owner", "password": PASSWORD})
        got = loads(body)
        check(got.get("error") == "second_factor_required",
              f"{label}: ...where a password alone is not enough for the Owner (tunnel rules: {got.get('error') or status})")
    # Mantel's published port, reached directly: not the trusted proxy
    async with aiohttp.ClientSession() as s:
        async with s.get(f"http://127.0.0.1:{HTTP_PORT}/api/proxy-check/basics",
                         headers={"Host": HOST, "X-Mantel-Door": "lan", "X-Forwarded-Proto": "https"}) as r:
            got = await r.json() if r.status == 200 else {"status": r.status}
    check(got.get("door") == "tunnel" and got.get("via_trusted_proxy") is False and got.get("https") is False,
          f"{label}: Mantel's published port reached directly is not the proxy: tunnel door, its claims ignored {got}")


def run_byo(work: Path, compose_dir: Path, env: dict, token: str, ma: Upstream) -> None:
    label = "your-proxy"
    tls = compose_dir / "tls"
    tls.mkdir()
    sh("openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", f"/CN={HOST}",
       "-keyout", str(tls / "key.pem"), "-out", str(tls / "cert.pem"))
    os.chmod(tls / "key.pem", 0o644)       # nginx in its container reads it (throwaway, self-signed)
    block = "\n".join("        " + line for line in npm_advanced(f"{MANTEL_PROXYNET_IP}:8765").splitlines())
    (compose_dir / "nginx.conf").write_text(NGINX_CONF.format(host=HOST, block=block, mantel=MANTEL_PROXYNET_IP))
    (compose_dir / "compose.e2e-proxy.yaml").write_text(E2E_OVERRIDE.format(
        nginx_image=NGINX_IMAGE, port=PORT, bare=NGINX_BARE_PORT, nginx_ip=NGINX_IP, mantel_ip=MANTEL_PROXYNET_IP))
    with (compose_dir / ".env").open("a") as f:
        f.write(f"MANTEL_TRUSTED_PROXY={NGINX_IP}\nMANTEL_HTTP_BIND=127.0.0.1\nMANTEL_HTTP_PORT={HTTP_PORT}\n")
    base = ["docker", "compose", "-p", PROJECT + "-byo", "--project-directory", str(compose_dir),
            "-f", str(compose_dir / "compose.yaml"), "-f", str(compose_dir / "compose.byo-proxy.yaml"),
            "-f", str(compose_dir / "compose.e2e-proxy.yaml")]
    try:
        up(base, env, work, label, {"mantel-server", "go2rtc", "your-proxy"})
        wait_connected(base, env, label, token)
        asyncio.run(web_checks(base, env, PORT, label, ma))
        asyncio.run(byo_extra_checks(label))
        server_checks(base, env, work, label)
    finally:
        logs_and_down(base, env, work, label, ("your-proxy", "mantel-server", "go2rtc"))


def main(argv: list[str]) -> int:
    which = set(argv) or {"caddy", "byo"}
    started_ha = False
    if not testha.ready():
        say("starting the scratch HA")
        sh(sys.executable, str(ROOT / "tools/testha/testha.py"), "up", "--fresh", timeout=1500)
        started_ha = True
    work = Path(tempfile.mkdtemp(prefix="mantel-compose-e2e-"))
    sec = work / "secrets"
    sec.mkdir(mode=0o700)
    (work / "backups").mkdir()
    token = asyncio.run(scratch_token())
    for name, text in {"ha_token": token, "ma_token": "", "at_rest.key": key(), "backup.key": key(),
                       "cloudflare_dns_token": "", "cloudflared_token": ""}.items():
        (sec / name).write_text(text)
        os.chmod(sec / name, 0o444)            # Docker Desktop: the container's user must read them
    ma, ma_port = start_fake_ma()
    env = dict(os.environ)
    say("server image:", SERVER_IMAGE)
    try:
        for run in ("caddy", "byo"):
            if run not in which:
                continue
            compose_dir = work / f"compose-{run}"
            shutil.copytree(ROOT / "packaging/compose", compose_dir)
            (compose_dir / ".env").write_text("\n".join([
                f"MANTEL_HOSTNAME={HOST}", "MANTEL_LAN_IP=127.0.0.1",
                f"MANTEL_HA_URL=http://host.docker.internal:{testha.PORT}",
                "MANTEL_TLS_SNIPPET=./caddy/tls-internal.caddy", f"MANTEL_SECRETS_DIR={sec}",
                f"MANTEL_HTTPS_PORT={PORT}", f"MANTEL_BACKUP_DIR={work / 'backups'}", "MANTEL_BACKUP_TARGET=",
                "MANTEL_MA_URL=", f"MANTEL_MA_WEB_URL=http://host.docker.internal:{ma_port}/",
                f"MANTEL_SERVER_IMAGE={SERVER_IMAGE}", ""]))
            (run_caddy if run == "caddy" else run_byo)(work, compose_dir, env, token, ma)
    finally:
        if started_ha:
            sh(sys.executable, str(ROOT / "tools/testha/testha.py"), "down", check_rc=False)
            say("scratch HA stopped")
        say("work folder (secrets are throwaway):", work)
    failed = [w for ok, w in results if not ok]
    say(f"{len(results) - len(failed)}/{len(results)} checks passed")
    for w in failed:
        say("  failed:", w)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
