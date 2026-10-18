"""THE DOCKER MODE, END TO END: the compose stack (Caddy, Mantel Server, go2rtc) against the scratch HA.

Needs Docker (Docker Desktop on Avery's Mac) and the images built (`mantel-server:local`,
`mantel-caddy:local`, `mantel-transcode:local`; docs/phase3/PACKAGING.md). Uses only the scratch HA
(tools/testha/, 127.0.0.1:8124, demo devices) -- never the house -- and throwaway secrets in a temp
folder. Commands stay off. The stack runs under its own compose project and is torn down at the end.

    ~/.venvs/mantel/bin/python tools/e2e/compose_e2e.py

Checks: every service healthy; through Caddy (TLS, the public hostname) /healthz says HA is connected;
the security headers (CSP, HSTS, nosniff, frame-ancestors); the server runs as uid 10001 on a read-only
root with /data writable; `bootstrap` and `backup` pass through the entrypoint; the backup restores
(--verify-only) with the backup key.
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
    token = asyncio.run(scratch_token())
    for name, text in {"ha_token": token, "ma_token": "", "at_rest.key": key(), "backup.key": key(),
                       "cloudflare_dns_token": "", "cloudflared_token": ""}.items():
        (sec / name).write_text(text)
        os.chmod(sec / name, 0o444)            # Docker Desktop: the container's user must read them
    (compose_dir / ".env").write_text("\n".join([
        f"MANTEL_HOSTNAME={HOST}", "MANTEL_LAN_IP=127.0.0.1",
        f"MANTEL_HA_URL=http://host.docker.internal:{testha.PORT}",
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
        # Mantel connected to the scratch HA (health is internal: read it inside the container)
        deadline, body = time.time() + 60, {}
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
        # admin commands through the entrypoint
        boot = sh(*base, "exec", "-T", "mantel-server", "mantel", "bootstrap", env=env, check_rc=False)
        (work / "bootstrap.out").write_text(boot.stdout + boot.stderr)
        check(boot.returncode == 0 and "bootstrap" in (boot.stdout + boot.stderr).lower(),
              "`docker compose exec mantel-server mantel bootstrap` passes through the entrypoint")
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
