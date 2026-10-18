"""Mantel in HA App mode against the SCRATCH Home Assistant (tools/testha): the App's own startup path
(packaging/docker/entrypoint.py) with a simulated SUPERVISOR_TOKEN and the Supervisor's core URL pointed
at the scratch HA. docs/phase3/HA-APP.md.

    TESTHA_DIR=<dir> ~/.venvs/mantel/bin/python tools/testha/testha.py up --fresh
    TESTHA_DIR=<dir> ~/.venvs/mantel/bin/python tools/testha/app_mode_check.py
    TESTHA_DIR=<dir> ~/.venvs/mantel/bin/python tools/testha/testha.py down

What stands in for what: the scratch user's access token is the "SUPERVISOR_TOKEN" (HA's App credential);
MANTEL_SUPERVISOR_CORE_URL / MANTEL_SUPERVISOR_WS_URL point "the Supervisor" at 127.0.0.1:8124; the Ingress
peer is 127.0.0.1 (this script sends the X-Remote-User-* headers the Supervisor would). Everything else is
the App's real path: entrypoint.plan() moves the token into a 0600 file and builds the command line
(--ingress --ingress-only, commands OFF), and `python -m mantel_server` runs it.

Checks: HA's states and registries arrive over the explicit WebSocket URL; HA's real config/auth/list
names the scratch user an administrator, so the first-Owner page offers the confirm and the confirm
links them as Owner; the page signs them in on door 'ha'; a command over the socket is refused
(commands_disabled) and the HA light it named did not change; the token is in no argument and no log line.
A wall tablet (decision 21): the Owner links a fictional tablet HA user to a new device in one of the scratch
HA's areas (REST); that HA user is then the device on door 'ha' (ha_door_rules trusted), its page carries the
kiosk mark, its socket sees only what its room and the tablet grants allow, its command is refused (commands
off), and after the unlink it gets 401.
Never touches /Volumes/config, the house, or ~/.config/mantel.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

import aiohttp

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("testha", ROOT / "tools/testha/testha.py")
testha = importlib.util.module_from_spec(spec)
spec.loader.exec_module(testha)
spec = importlib.util.spec_from_file_location("mantel_entrypoint", ROOT / "packaging/docker/entrypoint.py")
entrypoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(entrypoint)

PREFIX = "/api/hassio_ingress/ScratchIngressToken"
LIGHT = "light.kitchen_lights"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def ha_users(http, token):
    async with http.ws_connect(testha.BASE.replace("http", "ws", 1) + "/api/websocket") as ws:
        await ws.receive_json()
        await ws.send_json({"type": "auth", "access_token": token})
        assert (await ws.receive_json())["type"] == "auth_ok"
        await ws.send_json({"id": 1, "type": "config/auth/list"})
        return (await ws.receive_json())["result"]


async def light_state(http, token):
    async with http.get(f"{testha.BASE}/api/states/{LIGHT}", headers={"Authorization": f"Bearer {token}"}) as r:
        return (await r.json())["state"]


TABLET_HA = "5c4a7c4b1e7ab1e75c4a7c4b1e7ab1e7"       # a FICTIONAL HA user id: the tablet's own HA user


async def tablet_check(http, base: str, owner: dict, jar: str) -> dict:
    """A wall tablet through the App (docs/phase3/HA-APP.md "Wall tablets through the App"): the Owner links
    a (fictional) tablet HA user to a new device in one of the scratch HA's areas over REST; that HA user's
    requests are then the device on door 'ha', its page carries the kiosk mark, its socket sees only its
    room's entities and its commands are refused (commands off)."""
    csrf = next(p.split("=", 1)[1] for p in jar.split("; ") if p.startswith("mantel_csrf="))
    async with http.get(base + "/api/areas", headers={**owner, "Cookie": jar}) as r:
        areas = await r.json()
    room = max(areas, key=lambda a: a["entities"])
    hdr = {**owner, "Cookie": jar, "Origin": base, "X-CSRF-Token": csrf}
    async with http.post(base + "/api/ingress/tablets", headers=hdr,
                         json={"ha_user_id": TABLET_HA, "room": room["id"], "name": "Scratch tablet"}) as r:
        assert r.status == 201, (r.status, await r.text())
        linked = await r.json()
    tab = {**owner, "X-Remote-User-Id": TABLET_HA, "X-Remote-User-Name": "scratch_tablet",
           "X-Remote-User-Display-Name": "Scratch Tablet"}
    async with http.get(base + "/api/session", headers=tab) as r:
        s = await r.json()
    assert s["user"] is None and s["device"]["role"] == "wall_tablet" and s["device"]["room"] == room["id"], s
    assert s["door"] == "ha"
    async with http.get(base + "/", headers={**tab, "Accept": "text/html", "Sec-Fetch-Dest": "document"},
                        allow_redirects=False) as r:
        start = r.headers.get("Location")
    async with http.get(base + "/dashboard-proof/home",
                        headers={**tab, "Accept": "text/html", "Sec-Fetch-Dest": "document"}) as r:
        page = await r.text()
        assert r.status == 200 and 'name="mantel-kiosk"' in page
    ws = await http.ws_connect(base + "/ws", headers={**tab, "Origin": base})
    await ws.send_json({"type": "subscribe", "entity_ids": [], "all": True})
    snap = await ws.receive_json()
    while snap.get("type") != "snapshot":
        snap = await ws.receive_json()
    seen = sorted(snap["entities"])
    await ws.send_json({"type": "command", "id": 9, "kind": "service", "domain": "light", "service": "toggle",
                        "target": {"entity_id": LIGHT}})
    refused = await ws.receive_json()
    while refused.get("id") != 9 and refused.get("type") != "error":
        refused = await ws.receive_json()
    await ws.close()
    async with http.delete(base + f"/api/ingress/tablets/{TABLET_HA}", headers=hdr) as r:
        assert r.status == 200
    async with http.get(base + "/api/me", headers=tab) as r:
        assert r.status == 401
    return {"linked": f"device {linked['device']['name']} in {room['name']}",
            "session": f"user None, device {s['device']['role']} ({s['device']['room']}), door {s['door']}",
            "start": start, "kiosk_meta": True, "entities_seen": f"{len(seen)} (e.g. {seen[:3]})",
            "command": refused.get("code") or (refused.get("error") or {}).get("code"),
            "unlinked": "401 afterwards"}


async def main() -> dict:
    if not testha.ready():
        raise SystemExit("the scratch HA is not running: tools/testha/testha.py up")
    work = testha.inside_scratch(testha.SCRATCH / "app-mode")
    if work.exists():
        import shutil
        shutil.rmtree(work)
    (work / "data").mkdir(parents=True)
    options = work / "options.json"
    options.write_text(json.dumps({"commands_enabled": False, "log_level": "info",
                                   "default_screen": "dashboard-proof", "ha_door_rules": "trusted"}))
    port = free_port()
    async with aiohttp.ClientSession() as http:
        token = await testha.access_token(http)
        users = await ha_users(http, token)
        scratch = next(u for u in users if u.get("username") == "scratch")
        light_before = await light_state(http, token)
    env = {"PATH": os.environ.get("PATH", ""), "SUPERVISOR_TOKEN": token,
           "MANTEL_APP_OPTIONS": str(options), "MANTEL_APP_TOKEN_FILE": str(work / "ha_token"),
           "MANTEL_SUPERVISOR_CORE_URL": testha.BASE,
           "MANTEL_SUPERVISOR_WS_URL": testha.BASE.replace("http", "ws", 1) + "/api/websocket",
           "MANTEL_INGRESS_PEER": "127.0.0.1", "MANTEL_LISTEN": "127.0.0.1", "MANTEL_PORT": str(port),
           "MANTEL_DATA_DIR": str(work / "data")}
    args, run_env = entrypoint.plan([], env, options_path=work / "absent", token_file=work / "unused")
    assert "SUPERVISOR_TOKEN" not in run_env and token not in " ".join(args)
    assert oct((work / "ha_token").stat().st_mode & 0o777) == "0o600"
    run_env["PYTHONPATH"] = f"{ROOT / 'hosts/server'}:{ROOT}"
    log = (work / "mantel.log").open("w")
    proc = subprocess.Popen([sys.executable, "-m", "mantel_server", *args], env=run_env, stdout=log,
                            stderr=subprocess.STDOUT, cwd=str(work))
    base = f"http://127.0.0.1:{port}"
    result: dict = {"args": " ".join(a if a != str(work / "ha_token") else "<token file>" for a in args)}
    try:
        async with aiohttp.ClientSession(cookie_jar=aiohttp.DummyCookieJar()) as http:
            for _ in range(80):
                try:
                    async with http.get(base + "/healthz") as r:
                        health = await r.json()
                        if health["upstream"]["home_assistant"]["connected"]:
                            break
                except aiohttp.ClientError:
                    pass
                await asyncio.sleep(0.25)
            assert health["upstream"]["home_assistant"]["connected"], health
            result["health"] = health["status"]
            ha = {"X-Ingress-Path": PREFIX, "X-Remote-User-Id": scratch["id"], "X-Remote-User-Name": "scratch",
                  "X-Remote-User-Display-Name": scratch.get("name") or "Scratch", "X-Forwarded-For": "127.0.0.1, 172.30.32.1"}
            page = {**ha, "Accept": "text/html", "Sec-Fetch-Dest": "document"}
            # first Owner: HA's own user list (over the App credential) says the scratch user is an administrator
            async with http.get(base + "/dashboard-proof/home", headers=page) as r:
                text = await r.text()
                assert r.status == 403 and "Make me Mantel's Owner" in text, (r.status, text[:300])
            nonce = re.search(r"name=nonce value='([^']+)'", text).group(1)
            async with http.post(base + "/ingress/bootstrap", headers={**page, "Origin": base}, data={"nonce": nonce}) as r:
                assert r.status == 200 and "You are Mantel" in await r.text(), r.status
            result["bootstrap"] = "HA's config/auth/list named the scratch user an administrator; confirm made them Owner"
            async with http.get(base + "/dashboard-proof/home", headers=page) as r:
                assert r.status == 200 and f'content="{PREFIX}"' in await r.text()
                cookies = {}
                for raw in r.headers.getall("Set-Cookie", []):
                    name, value = raw.split(";", 1)[0].split("=", 1)
                    cookies[name] = value
                    assert f"Path={PREFIX}/" in raw
            jar = "; ".join(f"{k}={v}" for k, v in cookies.items())
            async with http.get(base + "/api/session", headers={**ha, "Cookie": jar}) as r:
                s = await r.json()
            assert s["user"]["role"] == "owner" and s["door"] == "ha", s
            result["signed_in"] = f"{s['user']['name']} ({s['user']['role']}), door {s['door']}"
            async with http.get(base + "/api/entities", headers={**ha, "Cookie": jar}) as r:
                ents = await r.json()
            ids = {e["id"] for e in ents}
            assert LIGHT in ids and len(ids) > 20, len(ids)
            async with http.get(base + "/api/areas", headers={**ha, "Cookie": jar}) as r:
                areas = [a["name"] for a in await r.json()]
            result["states"] = f"{len(ids)} entities from the scratch HA (e.g. {LIGHT}); areas {sorted(areas)}"
            ws = await http.ws_connect(base + "/ws", headers={**ha, "Cookie": jar, "Origin": base})
            await ws.send_json({"type": "subscribe", "entity_ids": [LIGHT], "areas": []})
            snap = await ws.receive_json()
            assert snap["type"] == "snapshot" and LIGHT in snap["entities"], snap
            await ws.send_json({"type": "command", "id": 7, "kind": "service", "domain": "light",
                                "service": "toggle", "target": {"entity_id": LIGHT}})
            refused = await ws.receive_json()
            await ws.send_json({"type": "call_service", "id": 8, "domain": "light", "service": "toggle",
                                "service_data": {"entity_id": LIGHT}})
            refused2 = await ws.receive_json()
            await ws.close()
            assert refused["code"] == "commands_disabled" and refused2["code"] == "commands_disabled", (refused, refused2)
            await asyncio.sleep(1.0)
            light_after = await light_state(http, token)
            assert light_after == light_before, (light_before, light_after)
            result["commands"] = f"refused (commands_disabled) x2; {LIGHT} stayed {light_after}"
            result["tablet"] = await tablet_check(http, base, ha, jar)
            # the forged-header rule with --ingress-only: a request the Ingress peer did not send is refused
            # (here every local request is the peer, so this is the unit tests' and the smoke's job)
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()
    logged = (work / "mantel.log").read_text()
    assert token not in logged, "the token appeared in the log"
    result["log"] = [line for line in logged.splitlines() if "mantel.ingress" in line or "COMMANDS" in line][:6]
    result["token_in_log_or_args"] = False
    return result


if __name__ == "__main__":
    print(json.dumps(asyncio.run(main()), indent=2))
