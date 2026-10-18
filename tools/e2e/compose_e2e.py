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

LIVE TV (live_tv.py): with a fake tuner service added for the run (tools/e2e/fake_tuner.py, an MPEG-2/AC-3
test stream; `tuner:5004` on the egress network), the Owner (signed in with the password set at first start)
turns Live TV on, reads the channel list over /ws, and the page's WebRTC offer is answered by the stack's own
go2rtc, which runs the transcode from the tuner with Mantel's templates; closing the player removes the stream;
the page never sees go2rtc's or the tuner's address.

HTTPS (security_headers.py, media_proxy.py, proxy_check.py), in the same Caddy run: Mantel's own headers
arrive once; /proxy-check is clean and its WebSocket passes; Music Assistant's app and socket through /ma/
(a fictional MA on the Mac, tests' https_fakes) with its address replaced; go2rtc's socket through /go2rtc/
and its stream management refused; while Live TV plays, its stream is viewable under /go2rtc/ and refused
once the player closes (Live TV registers each stream with the gate).

THE YOUR-OWN-PROXY RUN (compose.byo-proxy.yaml): Caddy off, Mantel publishing its one port, a plain nginx with
TLS running exactly the Nginx Proxy Manager block of docs/OPERATIONS.md as "your proxy" (HA comes from the
installation's files here). The same web checks through nginx, plus: a host WITHOUT the door header is the
tunnel door (fail closed) and passes a browser's own header (what /proxy-check warns about); the published
port reached directly is not the trusted proxy. Needs `nginx:1.27-alpine` and `openssl`.

    ~/.venvs/mantel/bin/python tools/e2e/compose_e2e.py            # both runs
    ~/.venvs/mantel/bin/python tools/e2e/compose_e2e.py caddy      # or one: caddy | byo

MANTEL_E2E_SERVER_IMAGE=<tag> runs another server image than mantel-server:local (a branch's own build).
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


# LIVE TV in the stack (docs/phase4/FEATURE-PARITY.md "Live TV served by Mantel"): a fake tuner service on the
# egress network (tools/e2e/fake_tuner.py in the server image, an MPEG-2/AC-3 test stream made with ffmpeg),
# reached by Mantel and the stack's go2rtc as `tuner:5004`. Mantel finds go2rtc at http://go2rtc:1984
# (compose.yaml) on the backend network.
LIVE_TV_OVERRIDE = """services:
  fake-tuner:
    image: ${MANTEL_SERVER_IMAGE:-mantel-server:local}
    entrypoint: ["python", "/e2e/fake_tuner.py", "--bind", "0.0.0.0", "--port", "5004", "--ts", "/e2e/tuner.ts"]
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    volumes:
      - TUNER_DIR:/e2e:ro
    networks:
      egress:
        aliases:
          - tuner
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request as u; u.urlopen('http://127.0.0.1:5004/lineup.json')"]
      interval: 5s
      timeout: 5s
      retries: 5
"""
OFFER = "\r\n".join([
    "v=0", "o=- 4611731400430051336 2 IN IP4 127.0.0.1", "s=-", "t=0 0", "a=group:BUNDLE 0 1",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111", "c=IN IP4 0.0.0.0", "a=ice-ufrag:e2eA", "a=ice-pwd:e2eaaaaaaaaaaaaaaaaaaaaa",
    "a=fingerprint:sha-256 " + ":".join(["AB"] * 32), "a=setup:actpass", "a=mid:0", "a=recvonly", "a=rtcp-mux",
    "a=rtpmap:111 opus/48000/2", "m=video 9 UDP/TLS/RTP/SAVPF 102", "c=IN IP4 0.0.0.0", "a=ice-ufrag:e2eA",
    "a=ice-pwd:e2eaaaaaaaaaaaaaaaaaaaaa", "a=fingerprint:sha-256 " + ":".join(["AB"] * 32), "a=setup:actpass",
    "a=mid:1", "a=recvonly", "a=rtcp-mux", "a=rtpmap:102 H264/90000",
    "a=fmtp:102 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f", ""])


def tuner_files(work: Path) -> Path:
    d = work / "tuner"
    d.mkdir()
    shutil.copy(ROOT / "tools/e2e/fake_tuner.py", d / "fake_tuner.py")
    sh("ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30",
       "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "20", "-c:v", "mpeg2video", "-b:v", "4M",
       "-flags", "+ilme+ildct", "-c:a", "ac3", "-b:a", "192k", "-f", "mpegts", str(d / "tuner.ts"))
    for f in d.iterdir():
        os.chmod(f, 0o444)
    os.chmod(d, 0o755)
    return d


async def live_tv(token: str, base: list[str], env: dict) -> None:
    """Through Caddy, as a page (`token`: the Owner's password from first start): signed in, Live TV turned on, the channel list, a WebRTC
    offer answered by the stack's go2rtc, the tuner pulled, the stream removed when the player closes."""
    ctx = ssl.create_default_context()
    ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
    origin = f"https://{HOST}:{PORT}"
    url = f"https://127.0.0.1:{PORT}"
    kw = {"headers": {"Host": f"{HOST}:{PORT}", "Origin": origin}, "server_hostname": HOST}
    jar = aiohttp.CookieJar(unsafe=True)
    async with aiohttp.ClientSession(connector=aiohttp.TCPConnector(ssl=ctx), cookie_jar=jar) as s:
        r = await s.post(f"{url}/api/auth/password", json={"username": "owner-e2e", "password": token}, **kw)
        check(r.status == 200, f"Live TV: the Owner signs in through Caddy (HTTP {r.status})")
        csrf = next((c.value for c in jar if c.key == "mantel_csrf"), "")
        settings = {"live_tv": {"enabled": True, "tuner": "tuner:5004", "channels": ["4.1"], "names": {"4.1": "NBC"}}}
        r = await s.put(f"{url}/api/features/settings", json=settings,
                        headers={**kw["headers"], "X-CSRF-Token": csrf}, server_hostname=HOST)
        check(r.status == 200, f"Live TV: the Owner turns Live TV on (HTTP {r.status})")
        ws = await s.ws_connect(f"wss://127.0.0.1:{PORT}/ws", **kw)
        frames: list[dict] = []

        async def recv(pred, timeout=60.0):
            end = time.monotonic() + timeout
            while True:
                m = await asyncio.wait_for(ws.receive_json(), max(0.1, end - time.monotonic()))
                frames.append(m)
                if pred(m):
                    return m

        got: dict = {}
        for i in range(30):                       # the guide's first fetch and the next tick
            await ws.send_json({"type": "read", "id": 100 + i, "msg": {"type": "hk_tv/channels"}})
            got = (await recv(lambda m, i=i: m.get("id") == 100 + i)).get("result") or {}
            if got.get("channels"):
                break
            await asyncio.sleep(2)
        check([c.get("camera") for c in got.get("channels", [])] == ["camera.tv_nbc"],
              f"Live TV: hk_tv/channels from Mantel in the stack ({got})")
        await ws.send_json({"type": "read_subscribe", "id": 2,
                            "msg": {"type": "camera/webrtc/offer", "entity_id": "camera.tv_nbc", "offer": OFFER}})
        evs: list[dict] = []
        try:
            while not any(e.get("type") == "answer" for e in evs):
                m = await recv(lambda m: m.get("id") == 2)
                if m.get("error"):
                    evs.append({"type": "error", **m["error"]})
                    break
                if m.get("type") == "read_event":
                    evs.append(m["event"])
        except asyncio.TimeoutError:
            pass
        ans = next((e for e in evs if e.get("type") == "answer"), {})
        check("a=fingerprint" in ans.get("answer", ""), f"Live TV: the stack's go2rtc answers the page's offer {[e.get('type') for e in evs]}")
        probe = "curl -fsS http://127.0.0.1:1984/api/streams"
        pulled = False
        for _ in range(30):
            out = sh(*base, "exec", "-T", "go2rtc", "sh", "-c", probe, env=env, check_rc=False).stdout
            if "tuner:5004/auto/v4.1" in out and "libx264" in out:
                pulled = True
                break
            await asyncio.sleep(2)
        check(pulled, "Live TV: go2rtc runs the transcode from tuner:5004 with Mantel's templates")
        r = await s.get(f"{url}/go2rtc/api/frame.jpeg", params={"src": "mantel_tv_4_1"}, **kw)
        check(r.status not in (401, 403) and b'"service": "go2rtc"' not in (await r.read())[:200],
              f"Live TV: while it plays, its stream is viewable through /go2rtc/ (registered with the gate; HTTP {r.status})")
        await ws.send_json({"type": "read_unsubscribe", "id": 2})
        gone = False
        for _ in range(30):
            out = sh(*base, "exec", "-T", "go2rtc", "sh", "-c", probe, env=env, check_rc=False).stdout
            if out.strip() and "mantel_tv_4_1" not in out:
                gone = True
                break
            await asyncio.sleep(1)
        check(gone, "Live TV: closing the player removes the stream from go2rtc")
        r = await s.get(f"{url}/go2rtc/api/frame.jpeg", params={"src": "mantel_tv_4_1"}, **kw)
        check(r.status == 403, f"Live TV: ...and from the /go2rtc/ gate (HTTP {r.status})")
        text = json.dumps(frames)
        check("1984" not in text and "tuner:5004" not in text, "Live TV: the page is never told go2rtc's or the tuner's address")
        await ws.close()


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
    out = sh(*base, "exec", "-T", "mantel-server", "mantel", "bootstrap", env=env, check_rc=False).stdout
    m = re.search(r"token[^\n]*:\n\n\s+(\S+)", out)
    return m.group(1) if m else ""


async def web_checks(base, env, port: int, label: str, ma: Upstream, username: str = "owner",
                     password: str = PASSWORD) -> None:
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
        status, _, body = await b.post("/api/bootstrap", {"token": token, "username": username, "name": "E2E Owner",
                                                          "password": password})
        if status == 410:      # second run on the same data volume: the Owner exists already
            status = 200
        check(status == 200, f"{label}: the first Owner is made through the proxy (HTTP {status} {loads(body).get('error', '')})")
        b.s.cookie_jar.clear()
        status, _, body = await b.post("/api/auth/password", {"username": username, "password": password})
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


# -- run 1: Mantel's Caddy (HA set up through the page, Live TV, HTTPS) --------------------
def run_caddy(work: Path, ma: Upstream, ma_port: int) -> None:
    compose_dir = work / "compose-caddy"
    shutil.copytree(ROOT / "packaging/compose", compose_dir)
    sec = work / "secrets-caddy"
    sec.mkdir(mode=0o700)
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
        "MANTEL_MA_URL=", f"MANTEL_MA_WEB_URL=http://host.docker.internal:{ma_port}/", *([f"MANTEL_SERVER_IMAGE={os.environ['MANTEL_SERVER_IMAGE']}"]
                             if os.environ.get("MANTEL_SERVER_IMAGE") else []), ""]))
    (compose_dir / "live-tv.e2e.yaml").write_text(LIVE_TV_OVERRIDE.replace("TUNER_DIR", str(tuner_files(work))))
    env = dict(os.environ)
    base = ["docker", "compose", "-p", PROJECT, "--project-directory", str(compose_dir),
            "-f", str(compose_dir / "compose.yaml"), "-f", str(compose_dir / "live-tv.e2e.yaml")]
    try:
        sh(*base, "config", "-q", env=env)
        check(True, "docker compose config: the file and .env are valid")
        up = sh(*base, "up", "-d", "--wait", "--wait-timeout", "240", env=env, check_rc=False, timeout=600)
        ps = sh(*base, "ps", "--format", "json", env=env).stdout
        rows = [json.loads(line) for line in ps.splitlines() if line.strip().startswith("{")] or json.loads(ps or "[]")
        health = {r.get("Service"): r.get("Health") or r.get("State") for r in rows}
        check(up.returncode == 0 and all(v == "healthy" for v in health.values()) and len(health) >= 3,
              f"caddy: compose up --wait: every service healthy {health}")
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
        # HTTPS: Mantel's own headers, /proxy-check, /ma/, /go2rtc/ through Caddy (the Owner made above)
        asyncio.run(web_checks(base, env, PORT, "caddy", ma, "owner-e2e", seen["secrets"][1]))
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
        asyncio.run(live_tv(seen["secrets"][1], base, env))
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
            (work / f"caddy-{svc}.log").write_text(logs.stdout + logs.stderr)
        sh(*base, "down", "-v", "--remove-orphans", env=env, check_rc=False)


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


def run_byo(work: Path, ma: Upstream, ma_port: int) -> None:
    env = dict(os.environ)
    token = asyncio.run(scratch_token())
    sec = work / "secrets-byo"
    sec.mkdir(mode=0o700)
    for name, text in {"ha_token": token, "ma_token": "", "at_rest.key": key(), "backup.key": key(),
                       "cloudflare_dns_token": "", "cloudflared_token": ""}.items():
        (sec / name).write_text(text)
        os.chmod(sec / name, 0o444)
    compose_dir = work / "compose-byo"
    shutil.copytree(ROOT / "packaging/compose", compose_dir)
    (compose_dir / ".env").write_text("\n".join([
        f"MANTEL_HOSTNAME={HOST}", "MANTEL_LAN_IP=127.0.0.1",
        f"MANTEL_HA_URL=http://host.docker.internal:{testha.PORT}",
        "MANTEL_TLS_SNIPPET=./caddy/tls-internal.caddy", f"MANTEL_SECRETS_DIR={sec}",
        f"MANTEL_BACKUP_DIR={work / 'backups'}", "MANTEL_BACKUP_TARGET=",
        "MANTEL_MA_URL=", f"MANTEL_MA_WEB_URL=http://host.docker.internal:{ma_port}/",
        f"MANTEL_SERVER_IMAGE={SERVER_IMAGE}", ""]))
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
    (work / "backups").mkdir()
    ma, ma_port = start_fake_ma()
    say("server image:", SERVER_IMAGE)
    try:
        if "caddy" in which:
            run_caddy(work, ma, ma_port)
        if "byo" in which:
            run_byo(work, ma, ma_port)
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
