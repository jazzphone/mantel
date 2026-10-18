"""End-to-end: Mantel Server's command gateway against the SCRATCH Home Assistant (tools/testha/).

    ~/.venvs/mantel/bin/python tools/e2e/gateway_e2e.py [--keep-up]

1. Starts the scratch HA (``testha.py up --fresh``: 127.0.0.1:8124, HA's ``demo`` devices only). If
   ``testha.py status`` says it is already running, another job is using it: this waits and retries.
2. Runs Mantel Server in this process against it with ``commands_enabled=True`` (the only place
   commands are ever on), using the scratch HA's throwaway credential from ``<TESTHA_DIR>/testha.json``
   (traded for a short access token; never printed), a temp database and temp secrets.
3. Creates fictional people through Mantel's own APIs: the first Owner (bootstrap), a Child and an
   Adult (``POST /api/users``), and a wall tablet (``POST /api/devices/enroll``).
4. Checks: the Owner toggles a demo light and HA's state changes; the Child is denied a lock (nothing
   sent, audit row 'denied') and never receives one; the Adult's unlock asks for step-up and succeeds
   after a TOTP step-up; the tablet acts in its room and needs a person for a lock; a Child's PIN at the
   tablet is refused and an Adult's PIN unlocks (the audit names the Adult at the tablet); an Owner's
   settings save through the socket persists (a Child's is refused); a remote (tunnel) unlock notifies
   the Owners in HA; every command has an audit row; GET /api/audit returns the run's rows.
5. Stops the scratch HA (unless --keep-up).

SAFETY: refuses to run unless the HA URL is the scratch one; never reads ~/.config/mantel or touches
/Volumes/config or the house's HA. Prints no credential.
"""
from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import secrets
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "hosts/server"))

import aiohttp  # noqa: E402
from aiohttp.test_utils import TestServer  # noqa: E402
from yarl import URL  # noqa: E402

_spec = importlib.util.spec_from_file_location("testha", ROOT / "tools/testha/testha.py")
testha = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(testha)

SCRATCH_URL = "http://127.0.0.1:8124"
PY = sys.executable
TESTHA = [PY, str(ROOT / "tools/testha/testha.py")]
LIGHT = "light.kitchen_lights"          # demo light, Kitchen (testha ROOMS)
LOCK = "lock.front_door"                # demo lock, starts locked
KITCHEN_LOCK = "lock.kitchen_door"      # demo lock in the Kitchen
CHILD_LIGHT = "light.bed_light"         # demo light, Bedroom


def say(*a):
    print("[e2e]", *a, flush=True)


class Fail(AssertionError):
    pass


def check(cond, what):
    if not cond:
        raise Fail(what)
    say("PASS", what)
    RESULTS.append(what)


RESULTS: list[str] = []


# -- the scratch HA ------------------------------------------------------------------------------
def wait_for_free_harness(limit: float = 1800) -> None:
    t0 = time.time()
    while testha.pid():
        if time.time() - t0 > limit:
            raise SystemExit("the scratch HA stayed busy (another job is using it); try again later")
        say("the scratch HA is running for another job; waiting 30 s")
        time.sleep(30)


def harness(cmd: str, *extra: str) -> None:
    log = Path(testha.SCRATCH) / f"e2e-testha-{cmd}.log"
    with open(log, "w") as out:
        rc = subprocess.run([*TESTHA, cmd, *extra], stdout=out, stderr=subprocess.STDOUT).returncode
    if rc != 0:
        raise SystemExit(f"testha.py {cmd} failed (rc {rc}); see {log}")


async def ha_state(http: aiohttp.ClientSession, token: str, eid: str) -> str:
    async with http.get(f"{SCRATCH_URL}/api/states/{eid}", headers={"Authorization": f"Bearer {token}"}) as r:
        return (await r.json())["state"]


async def ha_notifications(http: aiohttp.ClientSession, token: str) -> dict:
    """The current persistent notifications, read directly from the scratch HA (a subscription read)."""
    async with http.ws_connect(SCRATCH_URL.replace("http", "ws") + "/api/websocket") as ws:
        await ws.receive_json()
        await ws.send_json({"type": "auth", "access_token": token})
        assert (await ws.receive_json())["type"] == "auth_ok"
        await ws.send_json({"id": 1, "type": "persistent_notification/subscribe"})
        while True:
            m = await asyncio.wait_for(ws.receive_json(), 10)
            if m.get("type") == "event":
                return m["event"].get("notifications") or {}


async def until(fn, want, timeout=15.0):
    t0 = time.time()
    while True:
        got = await fn()
        if got == want or time.time() - t0 > timeout:
            return got
        await asyncio.sleep(0.25)


# -- a person's browser against Mantel -----------------------------------------------------------------
class Browser:
    def __init__(self, base: str, label: str) -> None:
        self.base, self.label = base, label
        self.http = aiohttp.ClientSession(cookie_jar=aiohttp.CookieJar(unsafe=True), headers={"Origin": base})
        self.ws = None
        self.n = 0

    def cookie(self, name: str) -> str | None:
        jar = self.http.cookie_jar.filter_cookies(URL(self.base + "/"))
        return jar[name].value if name in jar else None

    async def post(self, path: str, body=None, *, tunnel=False, method="POST"):
        h = {"Content-Type": "application/json"}
        if self.cookie("mantel_csrf"):
            h["X-CSRF-Token"] = self.cookie("mantel_csrf")
        if tunnel:
            h["X-Mantel-Door"] = "tunnel"
        async with self.http.request(method, self.base + path, data=json.dumps(body or {}), headers=h) as r:
            return r.status, await r.json(content_type=None)

    async def get(self, path: str):
        async with self.http.get(self.base + path) as r:
            return r.status, await r.json(content_type=None)

    async def save(self, msg: dict) -> dict:
        """HK's own settings save over the socket (settings_write -> settings_result)."""
        self.n += 1
        rid = self.n
        await self.ws.send_json({"type": "settings_write", "id": rid, "msg": msg})
        while True:
            m = await self.recv(30)
            if m.get("type") == "settings_result" and m.get("id") == rid:
                return m

    async def read(self, msg: dict) -> dict:
        self.n += 1
        rid = self.n
        await self.ws.send_json({"type": "read", "id": rid, "msg": msg})
        while True:
            m = await self.recv(30)
            if m.get("type") == "read_result" and m.get("id") == rid:
                return m

    async def connect(self, *, tunnel=False) -> dict:
        self.ws = await self.http.ws_connect(self.base + "/ws", headers={"X-Mantel-Door": "tunnel"} if tunnel else {})
        caps = await self.recv()
        return caps

    async def recv(self, timeout=10.0) -> dict:
        return await asyncio.wait_for(self.ws.receive_json(), timeout)

    async def snapshot(self) -> dict:
        await self.ws.send_json({"type": "subscribe", "all": True})
        while True:
            m = await self.recv()
            if m.get("type") == "snapshot":
                return m["entities"]

    async def command(self, **body) -> dict:
        self.n += 1
        rid = self.n
        await self.ws.send_json({"type": "command", "id": rid, **body})
        while True:
            m = await self.recv(30)
            if m.get("id") == rid:
                COMMANDS.append((self.label, body.get("domain", ""), body.get("service", ""), m))
                return m

    async def close(self) -> None:
        if self.ws is not None:
            await self.ws.close()
        await self.http.close()


COMMANDS: list[tuple] = []


def service(domain: str, svc: str, eid: str) -> dict:
    return {"kind": "service", "domain": domain, "service": svc, "target": {"entity_id": eid}}


# -- the run -------------------------------------------------------------------------------------------
async def run(token: str) -> dict:
    from mantel_server.accounts import totp
    from mantel_server.config import Config
    from mantel_server.server import build_app
    from mantel_server.store import Store

    offset = [0.0]                                   # Mantel's clock only (to make a factor stale); HA's is real
    clock = lambda: time.time() + offset[0]  # noqa: E731
    with tempfile.TemporaryDirectory(prefix="mantel-gateway-e2e-") as folder:
        base_dir = Path(folder)
        cfg = Config(ha_url=SCRATCH_URL, data_dir=base_dir / "data", secrets_dir=base_dir / "secrets", port=0,
                     commands_enabled=True)
        assert cfg.ha_url == SCRATCH_URL and "192.168." not in cfg.ha_url
        store = Store(cfg.data_dir / "mantel.db")
        app = build_app(cfg, token, store=store, connect_ha=True, clock=clock)
        hub, gw = app["hub"], app["gateway"]
        people: list[Browser] = []
        async with TestServer(app, host="127.0.0.1") as server, aiohttp.ClientSession() as ha_http:
            base = str(server.make_url("")).rstrip("/")
            await asyncio.wait_for(hub.ha.ready.wait(), 60)
            say(f"Mantel is up on {base}, connected to the scratch HA ({len(hub.store.states)} entities)")
            for _ in range(40):
                if app["authz"].tz_source == "home_assistant":
                    break
                await asyncio.sleep(0.25)
            check(app["authz"].tz == "America/New_York", "house time zone read from HA's get_config (America/New_York)")

            def new(label):
                b = Browser(base, label)
                people.append(b)
                return b

            # -- people, through Mantel's own APIs ----------------------------------------------
            pw = {k: secrets.token_urlsafe(18) for k in ("owner", "child", "adult")}
            owner = new("owner")
            st, body = await owner.post("/api/bootstrap", {"token": app["accounts"].issue_bootstrap_token(),
                                                          "username": "e2e-owner", "name": "Fictional Owner",
                                                          "password": pw["owner"]})
            check(st == 200 and body.get("ok"), "first Owner created through the bootstrap API")
            ids = {}
            for who, role in (("child", "child"), ("adult", "adult")):
                st, body = await owner.post("/api/users", {"username": f"e2e-{who}", "name": f"Fictional {who.title()}",
                                                          "role": role, "password": pw[who]})
                assert st == 201, body
                ids[who] = body["user"]["id"]
            check(len(ids) == 2, "Child and Adult created by the Owner (POST /api/users)")
            st, _ = await owner.post(f"/api/rbac/scopes/user/{ids['child']}", {"areas": ["Bedroom"]}, method="PUT")
            assert st == 200

            # -- Owner toggles a demo light ---------------------------------------------------------
            caps = await owner.connect()
            check(caps == {"type": "capabilities", "commands": True, "step_up_window": 300.0, "door": "lan"},
                  "the socket says commands are enabled (capabilities)")
            before = await ha_state(ha_http, token, LIGHT)
            reply = await owner.command(**service("light", "toggle", LIGHT))
            assert "result" in reply, reply
            after = await until(lambda: ha_state(ha_http, token, LIGHT), "on" if before == "off" else "off")
            check(after != before, f"Owner toggled {LIGHT} through Mantel: HA says {before} -> {after}")
            mirrored = await until(lambda: _hub_state(hub, LIGHT), after)
            check(mirrored == after, "Mantel's state hub followed HA's change")

            # -- Child: denied a lock, never sees one -------------------------------------------------
            child = new("child")
            st, _ = await child.post("/api/auth/password", {"username": "e2e-child", "password": pw["child"]})
            assert st == 200
            await child.connect()
            snap = await child.snapshot()
            check(snap and not any(e.startswith(("lock.", "camera.", "alarm_control_panel.")) for e in snap),
                  f"the Child's socket holds {len(snap)} entities and no lock, camera or alarm")
            sent_before = list(app["commander"].sent)
            lock_before = await ha_state(ha_http, token, LOCK)
            reply = await child.command(**service("lock", "unlock", LOCK))
            row = app["audit"].rows(id=reply.get("audit_id"))[0]
            check(reply.get("error", {}).get("code") == "forbidden" and reply["error"]["reason"] == "explicit_deny",
                  "Child denied lock.unlock (explicit_deny)")
            check(app["commander"].sent == sent_before and await ha_state(ha_http, token, LOCK) == lock_before,
                  "nothing was sent to HA for the Child's unlock; the lock is still " + lock_before)
            check((row["decision"], row["result"], row["role"]) == ("denied", "not_sent", "child"),
                  "the Child's unlock has an audit row: denied / not_sent")
            reply = await child.command(**service("light", "toggle", CHILD_LIGHT))
            check("result" in reply, f"Child may toggle {CHILD_LIGHT} in their own room")

            # -- Adult: unlock needs step-up, then succeeds after TOTP --------------------------------
            adult = new("adult")
            st, _ = await adult.post("/api/auth/password", {"username": "e2e-adult", "password": pw["adult"]})
            assert st == 200
            st, body = await adult.post("/api/auth/totp/enroll")
            seed = _seed(body["secret"])
            st, _ = await adult.post("/api/auth/totp/enroll/confirm", {"code": totp(seed, clock())})
            assert st == 200
            offset[0] += 301                         # the sign-in / enrolment factor is now older than 5 minutes
            await adult.connect()
            if await ha_state(ha_http, token, LOCK) != "locked":
                await owner.command(**service("lock", "lock", LOCK))
                await until(lambda: ha_state(ha_http, token, LOCK), "locked")
            reply = await adult.command(**service("lock", "unlock", LOCK))
            check(reply.get("type") == "step_up_required" and reply.get("methods") == ["totp"],
                  "Adult's unlock answered step_up_required (methods: totp)")
            check(await ha_state(ha_http, token, LOCK) == "locked", "the lock stayed locked while step-up was owed")
            st, body = await adult.post("/api/auth/totp/step-up", {"code": totp(seed, clock())})
            check(st == 200 and body.get("step_up") is True, "Adult stepped up with TOTP (POST /api/auth/totp/step-up)")
            reply = await adult.command(**service("lock", "unlock", LOCK))
            assert "result" in reply, reply
            state = await until(lambda: ha_state(ha_http, token, LOCK), "unlocked")
            check(state == "unlocked", f"after step-up the Adult unlocked {LOCK}: HA says {state}")
            row = app["audit"].rows(id=reply["audit_id"])[0]
            check((row["decision"], row["sensitive"], row["step_up"], row["result"]) == ("allowed", "lock", "totp", "ok"),
                  "the unlock's audit row: allowed, sensitive lock, step_up totp, result ok")

            # -- the wall tablet ---------------------------------------------------------------------
            tablet = new("tablet")
            st, _ = await tablet.post("/api/auth/password", {"username": "e2e-owner", "password": pw["owner"]})
            st, body = await tablet.post("/api/devices/enroll", {"name": "Fictional kitchen tablet", "room": "Kitchen"})
            check(st == 201 and body["device"]["role"] == "wall_tablet", "a wall tablet enrolled (POST /api/devices/enroll)")
            await tablet.connect()
            tsnap = await tablet.snapshot()
            check(LIGHT in tsnap and CHILD_LIGHT not in tsnap, "the tablet sees its room (Kitchen) and not the Bedroom")
            reply = await tablet.command(**service("light", "toggle", LIGHT))
            check("result" in reply, "the tablet toggled a Kitchen light")
            # HA's demo locks have no unique_id, so no registry entry and no area: the Owner grants the
            # tablet that lock by entity (Owner-only RBAC REST), as a house would for a door by its tablet
            st, _ = await owner.post("/api/rbac/grants", {"effect": "allow", "actions": ["control", "control.sensitive"],
                                                         "resource_kind": "entity", "resource": KITCHEN_LOCK,
                                                         "devices": [body["device"]["id"]]})
            assert st == 201
            reply = await tablet.command(**service("lock", "unlock", KITCHEN_LOCK))
            check(reply.get("type") == "step_up_required" and reply.get("reason") == "person_pin_required",
                  f"the tablet alone needs a person for a lock (person_pin_required) [{reply.get('reason') or reply.get('error')}]")
            tablet_id = body["device"]["id"]

            # -- a person's PIN at the tablet -----------------------------------------------------------
            pins = {"adult": "2580", "child": "7913"}
            st, _ = await adult.post("/api/account/pin", {"pin": pins["adult"]}, method="PUT")   # fresh from step-up
            assert st == 200
            child_again = new("child-pin")
            st, _ = await child_again.post("/api/auth/password", {"username": "e2e-child", "password": pw["child"]})
            assert st == 200
            st, _ = await child_again.post("/api/account/pin", {"pin": pins["child"]}, method="PUT")
            check(st == 200 and app["pins"].has_pin(ids["adult"]) and app["pins"].has_pin(ids["child"]),
                  "the Adult and the Child set their PINs from their own sessions (PUT /api/account/pin)")
            if await ha_state(ha_http, token, KITCHEN_LOCK) != "locked":
                await owner.command(**service("lock", "lock", KITCHEN_LOCK))
                await until(lambda: ha_state(ha_http, token, KITCHEN_LOCK), "locked")
            reply = await tablet.command(**service("lock", "unlock", KITCHEN_LOCK))
            check(reply.get("type") == "step_up_required" and reply.get("methods") == ["pin"],
                  "the tablet now offers a PIN pad (methods: pin)")
            sent_before = list(app["commander"].sent)
            reply = await tablet.command(**service("lock", "unlock", KITCHEN_LOCK),
                                         step_up={"method": "pin", "pin": pins["child"]})
            row = app["audit"].rows(id=reply.get("audit_id"))[0]
            check(reply.get("error", {}).get("code") == "forbidden" and app["commander"].sent == sent_before
                  and await ha_state(ha_http, token, KITCHEN_LOCK) == "locked",
                  f"a Child's PIN at the tablet is refused ({reply.get('error', {}).get('reason')}); nothing sent, still locked")
            check((row["actor"], row["role"], row["device"], row["decision"]) == (ids["child"], "child", tablet_id, "denied"),
                  "the refused unlock's audit row names the Child at the tablet")
            reply = await tablet.command(**service("lock", "unlock", KITCHEN_LOCK),
                                         step_up={"method": "pin", "pin": "9999"})
            check(reply.get("type") == "step_up_required" and reply.get("pin_error") == "invalid_pin",
                  "a wrong PIN keeps the PIN pad open (pin_error invalid_pin)")
            reply = await tablet.command(**service("lock", "unlock", KITCHEN_LOCK),
                                         step_up={"method": "pin", "pin": pins["adult"]})
            assert "result" in reply, reply
            state = await until(lambda: ha_state(ha_http, token, KITCHEN_LOCK), "unlocked")
            check(state == "unlocked", f"an Adult's PIN at the tablet unlocked {KITCHEN_LOCK}: HA says {state}")
            row = app["audit"].rows(id=reply["audit_id"])[0]
            check((row["actor"], row["actor_name"], row["role"], row["device"], row["step_up"], row["result"]) ==
                  (ids["adult"], "Fictional Adult", "adult", tablet_id, "pin", "ok"),
                  "the unlock's audit row names the Adult at the tablet (step_up pin, result ok)")
            reply = await tablet.command(**service("lock", "unlock", KITCHEN_LOCK))
            check(reply.get("reason") == "person_pin_required", "the PIN counted for that one command only")
            await owner.command(**service("lock", "lock", KITCHEN_LOCK))
            await until(lambda: ha_state(ha_http, token, KITCHEN_LOCK), "locked")

            # -- an Owner's settings save through the socket ---------------------------------------------
            sent_before = list(app["commander"].sent)
            saved = await owner.save({"type": "hk_frontend/settings/set", "changes": {"look.glass": "clear"}})
            got = await owner.read({"type": "mantel/settings/get", "scope": "house", "key": "settings"})
            stored = app["settings"].store.get("house", "settings")
            check("result" in saved and got.get("result", {}).get("body", {}).get("look", {}).get("glass") == "clear"
                  and stored.body["look"]["glass"] == "clear" and app["commander"].sent == sent_before,
                  f"an Owner's settings save through the socket persisted (v{stored.version}); nothing sent to HA")
            await child_again.connect()
            refused = await child_again.save({"type": "hk_frontend/settings/set", "changes": {"look.glass": "frosted"}})
            check(refused.get("error", {}).get("code") == "forbidden"
                  and app["settings"].store.get("house", "settings").body["look"]["glass"] == "clear",
                  "a Child's house settings save is refused (forbidden) and changes nothing")

            # -- a remote (tunnel) unlock notifies the Owners ----------------------------------------------
            await owner.command(**service("lock", "lock", LOCK))
            await until(lambda: ha_state(ha_http, token, LOCK), "locked")
            remote = new("adult-remote")
            offset[0] += 31                          # a new TOTP time step (each code is single use)
            st, body = await remote.post("/api/auth/password", {"username": "e2e-adult", "password": pw["adult"]}, tunnel=True)
            assert st == 200 and body.get("next") == "totp", body
            st, body = await remote.post("/api/auth/totp/verify", {"pending": body["pending"], "code": totp(seed, clock())},
                                         tunnel=True)
            assert st == 200, body
            caps = await remote.connect(tunnel=True)
            assert caps["door"] == "tunnel"
            reply = await remote.command(**service("lock", "unlock", LOCK))
            assert "result" in reply, reply
            await until(lambda: ha_state(ha_http, token, LOCK), "unlocked")
            nid = f"mantel_remote_{reply['audit_id']}"
            notes = {}
            for _ in range(20):
                notes = await ha_notifications(ha_http, token)
                if nid in notes:
                    break
                await asyncio.sleep(0.25)
            check(nid in notes and "tunnel" in notes[nid]["message"],
                  "a remote unlock created an Owner notification in HA (persistent notification)")
            await owner.command(**service("lock", "lock", LOCK))

            # -- the audit: every command has a row --------------------------------------------------------
            rows = app["audit"].rows()
            by_id = {r["id"]: r for r in rows}
            check(all(m.get("audit_id") in by_id for *_, m in COMMANDS), f"all {len(COMMANDS)} commands have an audit row")
            allowed_ok = [r for r in rows if r["decision"] == "allowed" and r["kind"] == "service" and r["result"] == "ok"]
            check(len(allowed_ok) == sum(1 for s in app["commander"].sent if s != "persistent_notification.create"),
                  "every service call sent to HA has an allowed audit row with result ok")
            check(any(r["kind"] == "system" and r["actor"] == "mantel" for r in rows), "the Owner notification is audited too")

            # -- the audit read API -------------------------------------------------------------------------
            st, page = await owner.get("/api/audit?limit=500")
            check(st == 200 and [r["id"] for r in page["rows"]] == [r["id"] for r in reversed(rows)] and page["next"] is None,
                  f"GET /api/audit returns the run's {len(rows)} rows, newest first (Owner)")
            st, by_tablet = await owner.get(f"/api/audit?device={tablet_id}&decision=allowed")
            check(st == 200 and any(r["actor"] == ids["adult"] and r["step_up"] == "pin" for r in by_tablet["rows"])
                  and all(r["device"] == tablet_id and r["decision"] == "allowed" for r in by_tablet["rows"]),
                  "the audit API filters by device and decision (the Adult's PIN unlock at the tablet is there)")
            st, first = await owner.get("/api/audit?limit=3")
            st2, second = await owner.get(f"/api/audit?limit=3&before={first['next']}")
            check(st == st2 == 200 and len(first["rows"]) == 3 and second["rows"][0]["id"] < first["rows"][-1]["id"],
                  "the audit API pages (limit + before)")
            st, _ = await adult.get("/api/audit")
            st_t, _ = await tablet.get("/api/audit")
            check(st == 403 and st_t == 403, "an Adult and a wall tablet may not read the audit (403)")
            evidence = {
                "mantel": base, "home_assistant": SCRATCH_URL, "house_tz": app["authz"].tz,
                "sent_to_ha": app["commander"].sent,
                "audit": [{k: r[k] for k in ("id", "actor_name", "role", "device_role", "kind", "action", "target",
                                              "decision", "reason", "sensitive", "door", "step_up", "result")} for r in rows],
                "checks": RESULTS,
            }
            for b in people:
                await b.close()
        store.db.close()
    return evidence


def _hub_state(hub, eid):
    async def get():
        return (hub.store.states.get(eid) or {}).get("s")
    return get()


def _seed(secret_b32: str) -> bytes:
    import base64
    return base64.b32decode(secret_b32 + "=" * (-len(secret_b32) % 8))


async def token_for_scratch() -> str:
    if testha.BASE != SCRATCH_URL:
        raise SystemExit(f"refusing: the harness points at {testha.BASE}, not the scratch HA")
    async with aiohttp.ClientSession() as http:
        return await testha.access_token(http)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--keep-up", action="store_true", help="leave the scratch HA running afterwards")
    a = ap.parse_args()
    wait_for_free_harness()
    say("starting the scratch HA (testha.py up --fresh); this takes a few minutes")
    harness("up", "--fresh")
    try:
        token = asyncio.run(token_for_scratch())
        evidence = asyncio.run(run(token))
        del token
        out = Path(testha.SCRATCH) / "gateway_e2e.json"
        out.write_text(json.dumps(evidence, indent=1))
        say(f"ALL {len(RESULTS)} CHECKS PASSED; evidence in {out}")
        print(json.dumps({"checks": len(RESULTS), "sent_to_ha": evidence["sent_to_ha"],
                          "audit_rows": len(evidence["audit"])}, indent=1))
        return 0
    except Fail as exc:
        say("FAIL", exc)
        return 1
    finally:
        if not a.keep_up:
            harness("down")
            say("scratch HA stopped")


if __name__ == "__main__":
    sys.exit(main())
