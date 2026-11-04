#!/usr/bin/env python3
"""The route probe (phase 18, docs/phase18/CODE-HEALTH.md, "Zero behavior change: the lock and the probe", item 2).

    tools/route_probe.py --save FILE        # probe this tree, write the answers to FILE (sorted JSON)
    tools/route_probe.py --against FILE     # probe this tree, print every difference from a saved FILE (exit 1 if any)
    tools/route_probe.py --diff REV         # probe REV (in a temporary git worktree, with THIS script) and this tree,
                                            # print every difference; nothing printed and exit 0 when equal
    tools/route_probe.py --only owner_fresh --door lan   # a quick look at one principal and door (--save/-q too)

Run it with the server's venv from the repo root: ``PYTHONPATH=hosts/server:. ~/.venvs/mantel/bin/python
tools/route_probe.py ...``. (--diff sets PYTHONPATH and the working directory for REV's copy itself.)

What it does. The app is built with fakes the way tests/test_route_guards.py builds it (the HA App's Ingress routes
and Mantel Connect's, so every route Mantel can serve is there), once for each principal and door, on its own temp
database, with a fake clock. Nothing goes anywhere (Rule 3): ``HaClient.run`` / ``_send`` and ``ReadProxy.request``
raise, and every socket connection to a non-loopback address (and every DNS lookup) is refused and counted. The
principals (PRINCIPALS) are signed in once; then EVERY route is sent a request with an empty ``{}`` JSON body (plus
the CSRF header on a change) as each principal, on each door (LAN, and the tunnel: ``X-Mantel-Door: tunnel``). Only
the status and the JSON ``error`` code are kept, so a change in *where* a refusal comes from (a guard, a handler's
own validation) shows, and nothing else does. Output::

    {"<METHOD> <path>": {"<principal>@<door>": [status, error], ...}, ..., "_meta": {...}}

``_meta`` lists how each principal was set up, when a route ended its session and it was signed in again, and any
outbound attempt the sockets refused.

How the principals are made:
  nobody        no sign-in (a CSRF cookie from GET /api/session, so a change reaches its guard, not the CSRF check)
  guest, child, adult, admin
                a user of that role, signed in with a password
  owner_fresh   an Owner, signed in just now
  owner_stale   an Owner signed in, then the fake clock moved 400 s on: past STEP_UP_WINDOW (300 s), inside the
                15-minute access token (sessions.ACCESS_TTL), so the session is valid and its step-up is not fresh
  tablet        an Owner signed in on the LAN and "Make this browser a wall tablet" (POST /api/devices/enroll): the
                person's session ends and the browser holds only the device credential
  owner_at_tablet
                that, and the Owner signs in again on the same browser: a person at a tablet
A session is bound to its door, so a person signs in again for each door (the tunnel sign-in sends the door header).
A tablet is enrolled on the LAN (enrolment is LAN only) and then presents its device cookie at either door; the
tunnel ignores a device credential, so tablet@tunnel records what a bare cookie gets there (the same as nobody) and
owner_at_tablet@tunnel is an Owner signed in on the tunnel.

A route that ends a session (logout, a revoke, a device removal) would turn every later answer into a 401, so after
each request GET /api/session says whether the principal still has what it had; if not it is set up again (recorded
in ``_meta.resigned``). Routes whose answers can't be made the same twice are in NONDETERMINISTIC and recorded as
"skipped".

Order matters (a route may leave something behind for the next), so routes are sent in a fixed order (path, then
method) and an app is never shared between principals.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
import importlib.util  # noqa: E402

if importlib.util.find_spec("mantel_server") is None:        # (--diff sets PYTHONPATH to REV's tree: never override it)
    sys.path[:0] = [str(ROOT / "hosts/server"), str(ROOT)]

PRINCIPALS = ("nobody", "guest", "child", "adult", "admin", "owner_fresh", "owner_stale", "tablet", "owner_at_tablet")
DOORS = ("lan", "tunnel")
PASSWORD = "correct horse battery staple"
SAMPLE = "x-sample"
STALE_BY = 400                      # seconds: past STEP_UP_WINDOW (300), inside ACCESS_TTL (900)
TIMEOUT = 5.0
SCRATCH = Path("/private/tmp/claude-501/p18")

# "<METHOD> <path>" (as keyed in the output) -> why its answer can't be recorded. Filled by what the double run
# showed; an entry answers "skipped" for every principal and door.
NONDETERMINISTIC: dict[str, str] = {}


# -- a sample for every path parameter -----------------------------------------------------------------------------
# tried in order; the first one the parameter's regex fully matches is used. "x-sample" matches a plain {name}, the
# dashboard pattern ("a-b"-shaped: letters, a dash, more) and {path:.+}.
CANDIDATES = (SAMPLE, "xsample", "x_sample", "0" * 32, "0" * 16, "original", "alarm_control_panel.x_sample", "0", "a")


def _groups(pattern: str) -> list[tuple[str, str]]:
    """(name, regex) for each named group of a route pattern, with the group's parentheses balanced."""
    out = []
    for m in re.finditer(r"\(\?P<(\w+)>", pattern):
        depth, i, in_class = 1, m.end(), False
        while i < len(pattern) and depth:
            c = pattern[i]
            if c == "\\":
                i += 1
            elif in_class:
                in_class = c != "]"
            elif c == "[":
                in_class = True
            elif c == "(":
                depth += 1
            elif c == ")":
                depth -= 1
            i += 1
        out.append((m.group(1), pattern[m.end():i - 1]))
    return out


def sample_value(regex: str) -> str:
    for cand in CANDIDATES:
        if re.fullmatch(regex, cand):
            return cand
    raise ValueError(f"no sample matches {regex!r}: add one to CANDIDATES")


def sample_path(info: dict) -> str:
    """The URL path for a resource's ``get_info()``: its parameters filled with samples that match their regexes."""
    formatter = info.get("formatter") or info.get("path") or info.get("prefix")
    pattern = info.get("pattern")
    if pattern is None or "{" not in formatter:
        return formatter
    values = {name: sample_value(rx) for name, rx in _groups(pattern.pattern)}
    return re.sub(r"\{(\w+)\}", lambda m: values[m.group(1)], formatter)


def route_list(app) -> list[tuple[str, str, str]]:
    """(key, method, sample path) for every route to send, in the order they are sent."""
    seen: dict[str, tuple[str, str]] = {}
    for route in app.router.routes():
        if route.method == "HEAD" or route.resource is None:
            continue
        info = route.resource.get_info()
        formatter = info.get("formatter") or info.get("path") or info.get("prefix")
        path = sample_path(info)
        for method in ("GET", "POST") if route.method == "*" else (route.method,):
            key = f"{method} {formatter}" + (" (any)" if route.method == "*" else "")
            seen.setdefault(key, (method, path))
    return [(key, m, p) for key, (m, p) in sorted(seen.items(), key=lambda kv: (kv[0].split(" ", 1)[1], kv[0]))]


# -- nothing goes anywhere ---------------------------------------------------------------------------------------
OUTBOUND: list[str] = []            # refused connections, as "<route> -> host:port"
CURRENT = [""]                      # the route being probed (what an outbound attempt is blamed on)


def _loopback(address) -> bool:
    if isinstance(address, (str, bytes)):
        return True                                       # a Unix socket
    host = address[0]
    return host in ("127.0.0.1", "::1", "localhost", "0.0.0.0", "::") or str(host).startswith("127.")


def forbid_outbound() -> None:
    """Refuse every connection and lookup that leaves this machine (Rule 3: never send anything anywhere)."""
    real_getaddrinfo = socket.getaddrinfo

    def getaddrinfo(host, *args, **kwargs):
        if host not in (None, "", "localhost", "127.0.0.1", "::1"):
            OUTBOUND.append(f"{CURRENT[0]} -> dns:{host}")
            raise socket.gaierror(socket.EAI_NONAME, "the route probe sends nothing anywhere")
        return real_getaddrinfo(host, *args, **kwargs)

    def refuse(name):
        real = getattr(socket.socket, name)

        def wrapped(self, address, *args):
            if not _loopback(address):
                OUTBOUND.append(f"{CURRENT[0]} -> {address[0]}:{address[1]}")
                raise OSError("the route probe sends nothing anywhere")
            return real(self, address, *args)
        return wrapped

    socket.getaddrinfo = getaddrinfo
    for name in ("connect", "connect_ex", "sendto"):
        setattr(socket.socket, name, refuse(name))


# -- one principal on one door ----------------------------------------------------------------------------------
class Probe:
    def __init__(self, principal: str, door: str, tmp: Path) -> None:
        self.principal, self.door, self.tmp = principal, door, tmp
        self.now = [1_000_000.0]
        self.client = None
        self.signins: list = []
        self.first = True                                   # (the sign-ins are recorded once, not at each re-sign-in)
        self.resigned: list[str] = []

    # plumbing
    def cookie(self, name):
        jar = self.client.session.cookie_jar.filter_cookies(self.client.make_url("/"))
        return jar[name].value if name in jar else None

    def headers(self, unsafe: bool) -> dict:
        h = {}
        if unsafe and self.cookie("mantel_csrf"):
            h["X-CSRF-Token"] = self.cookie("mantel_csrf")
        if self.door == "tunnel":
            h["X-Mantel-Door"] = "tunnel"
        return h

    async def post(self, path, body=None, *, csrf=True, door=None):
        h = self.headers(csrf)
        if door == "lan":
            h.pop("X-Mantel-Door", None)
        return await self.client.post(path, json={} if body is None else body, headers=h)

    async def sign_in(self, username, door=None):
        """A password sign-in; with an authenticator app on the account (the tunnel's people have one: a password
        alone never signs in there) the code too. The fake clock moves a step on first, as TOTP never takes a code
        twice."""
        r = await self.post("/api/auth/password", {"username": username, "password": PASSWORD}, csrf=False, door=door)
        body = await r.json()
        if r.status == 200 and body.get("next") == "totp":
            from mantel_server.accounts import totp
            self.now[0] += 31
            r = await self.post("/api/auth/totp/verify", {"pending": body["pending"],
                                                          "code": totp(self.seeds[username], self.now[0])},
                                csrf=False, door=door)
            await r.read()
        return r.status

    async def session(self) -> dict:
        r = await self.client.get("/api/session", headers=self.headers(False))
        try:
            return await r.json()
        except Exception:
            return {}

    def note(self, what, status):
        if self.first:
            self.signins.append((what, status))

    # set up
    async def build(self):
        from argon2 import PasswordHasher
        from aiohttp.test_utils import TestClient, TestServer
        from mantel_server.config import Config
        from mantel_server.server import build_app
        from mantel_server.store import Store
        cfg = Config(data_dir=self.tmp / "data", secrets_dir=self.tmp / "secrets", port=0, ingress=True,
                     ingress_peers=(), connect=True, connect_port=0, connect_listen="127.0.0.1")
        store = Store(cfg.data_dir / "mantel.db")
        self.store = store
        self.app = build_app(cfg, "unused-fictional-token", store=store, connect_ha=False, clock=lambda: self.now[0])
        self.app["accounts"].hasher = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1)
        self.client = TestClient(TestServer(self.app))
        await self.client.start_server()
        self.client.session.headers["Origin"] = str(self.client.make_url("")).rstrip("/")
        role = {"nobody": "owner", "owner_fresh": "owner", "owner_stale": "owner", "tablet": "owner",
                "owner_at_tablet": "owner"}.get(self.principal, self.principal)
        self.username = "oscar" if role == "owner" else "pat"
        if role != "owner":                                  # a house always has its Owner
            await self.app["accounts"].create_user("oscar", "Oscar", "owner", PASSWORD)
        uid = await self.app["accounts"].create_user(self.username, self.username.title(), role, PASSWORD)
        self.uid, self.seeds = uid, {}
        await self.establish()
        self.first = False

    def ensure_totp(self):
        """On the tunnel a password is never enough (PLAN §7), so the person has an authenticator app; a route that
        removed it (DELETE /api/auth/totp) gets a new one before the next sign-in."""
        acc = self.app["accounts"]
        if self.door != "tunnel" or self.principal == "nobody" or acc.has_totp(self.uid):
            return
        import base64
        from mantel_server.accounts import totp
        secret, _ = acc.totp_begin(self.uid, self.username)
        seed = base64.b32decode(secret + "=" * (-len(secret) % 8))
        self.seeds[self.username] = seed
        self.now[0] += 31
        if not acc.totp_check(self.uid, totp(seed, self.now[0]), confirm=True):
            raise RuntimeError("the probe could not confirm its authenticator app")

    async def establish(self):
        """Sign in (and enroll) as this principal on this door, from a clean cookie jar."""
        self.client.session.cookie_jar.clear()
        self.ensure_totp()
        p = self.principal
        if p == "nobody":
            await self.session()                            # the CSRF cookie
            return
        if p in ("tablet", "owner_at_tablet"):
            self.note("lan sign-in", await self.sign_in(self.username, door="lan"))
            r = await self.post("/api/devices/enroll", {"name": "Hall tablet"}, door="lan")
            await r.read()
            self.note("enroll", r.status)
            if p == "owner_at_tablet":
                self.note(f"{self.door} sign-in", await self.sign_in(self.username))
        else:
            self.note(f"{self.door} sign-in", await self.sign_in(self.username))
        if p == "owner_stale":
            self.now[0] += STALE_BY

    async def alive(self) -> bool:
        """Does the principal still have what it had? A device credential is LAN only (the tunnel ignores the
        cookie), so on the tunnel a tablet has nothing to keep and an Owner at a tablet is just the Owner."""
        if self.principal == "nobody" or (self.principal == "tablet" and self.door == "tunnel"):
            return True
        me = await self.session()
        user, device = me.get("user"), me.get("device")
        if self.principal == "tablet":
            return device is not None and user is None
        if self.principal == "owner_at_tablet":
            return user is not None and (device is not None or self.door == "tunnel")
        return user is not None and device is None

    async def close(self):
        with contextlib.suppress(Exception):
            await self.client.close()
        with contextlib.suppress(Exception):
            self.store.db.close()

    # the probe
    async def send(self, method: str, path: str):
        import aiohttp
        unsafe = method not in ("GET", "HEAD", "OPTIONS")
        kwargs = {"json": {}} if unsafe else {}

        async def go():
            resp = await self.client.request(method, path, headers=self.headers(unsafe), allow_redirects=False,
                                             timeout=aiohttp.ClientTimeout(total=TIMEOUT), **kwargs)
            try:
                status, error = resp.status, None
                if resp.content_type == "application/json":     # a stream is never read: status only
                    try:
                        body = await resp.json(content_type=None)
                    except Exception:
                        body = None
                    if isinstance(body, dict) and "error" in body:
                        e = body["error"]
                        error = e if isinstance(e, str) or e is None else json.dumps(e, sort_keys=True)
                return [status, error]
            finally:
                resp.close()
        try:
            return await asyncio.wait_for(go(), TIMEOUT + 1)
        except asyncio.TimeoutError:
            return ["timeout", None]
        except Exception as exc:                                  # a dropped connection is an answer too
            return [f"error:{type(exc).__name__}", None]

    async def run(self, routes) -> dict:
        out = {}
        label = f"{self.principal}@{self.door}"
        for key, method, path in routes:
            if key in NONDETERMINISTIC:
                out[key] = ["skipped", None]
                continue
            CURRENT[0] = key
            out[key] = await self.send(method, path)
            CURRENT[0] = f"{key} (sign-in check)"
            if not await self.alive():
                self.resigned.append(key)
                await self.establish()
        return {"answers": out, "label": label, "signins": self.signins, "resigned": self.resigned}


async def probe_one(principal: str, door: str, routes_for: dict) -> dict:
    with tempfile.TemporaryDirectory(prefix="route-probe-") as tmp:
        p = Probe(principal, door, Path(tmp))
        try:
            await p.build()
            routes = routes_for.get("routes") or route_list(p.app)
            routes_for["routes"] = routes
            return await p.run(routes)
        finally:
            await p.close()


async def probe(principals, doors, jobs: int = 1) -> dict:
    from mantel_server.ha_client import HaClient
    from mantel_server.readproxy import ReadProxy

    async def forbidden(*args, **kwargs):
        raise RuntimeError("the route probe sends nothing upstream")

    HaClient.run = forbidden
    HaClient._send = forbidden
    ReadProxy.request = forbidden
    forbid_outbound()
    logging.disable(logging.CRITICAL)
    shared: dict = {}
    sem = asyncio.Semaphore(jobs)

    async def one(principal, door):
        async with sem:
            with contextlib.redirect_stdout(open(os.devnull, "w")), contextlib.redirect_stderr(open(os.devnull, "w")):
                return await probe_one(principal, door, shared)

    results = await asyncio.gather(*(one(p, d) for p in principals for d in doors))
    table: dict = {}
    meta = {"setup": {}, "resigned": {}}
    for r in results:
        for key, answer in r["answers"].items():
            table.setdefault(key, {})[r["label"]] = answer
        meta["setup"][r["label"]] = [list(s) for s in r["signins"]]
        if r["resigned"]:
            meta["resigned"][r["label"]] = r["resigned"]
    meta["outbound_refused"] = sorted(set(OUTBOUND))
    meta["routes"] = len(table)
    meta["requests"] = sum(len(v) for v in table.values())
    table = {k: dict(sorted(v.items())) for k, v in sorted(table.items())}
    table["_meta"] = meta
    return table


# -- comparing ---------------------------------------------------------------------------------------------------
def compare(old: dict, new: dict) -> list[str]:
    lines = []
    for key in sorted(set(old) | set(new)):
        if key == "_meta":
            for sub in sorted(set(old.get(key, {})) | set(new.get(key, {}))):
                if sub in ("routes", "requests"):
                    continue
                if old.get(key, {}).get(sub) != new.get(key, {}).get(sub):
                    lines.append(f"_meta.{sub}: {json.dumps(old.get(key, {}).get(sub), sort_keys=True)} -> "
                                 f"{json.dumps(new.get(key, {}).get(sub), sort_keys=True)}")
            continue
        if key not in old:
            lines.append(f"{key}: new route")
            continue
        if key not in new:
            lines.append(f"{key}: route gone")
            continue
        for who in sorted(set(old[key]) | set(new[key])):
            a, b = old[key].get(who), new[key].get(who)
            if a != b:
                lines.append(f"{key} [{who}]: {a} -> {b}")
    return lines


def dump(table: dict) -> str:
    return json.dumps(table, indent=1, sort_keys=True) + "\n"


def run_probe(args, principals=None, doors=None) -> dict:
    return asyncio.run(probe(principals or PRINCIPALS, doors or DOORS, args.jobs))


def baseline_of(rev: str, args) -> dict:
    SCRATCH.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="route-probe-wt-", dir=SCRATCH))
    tree = work / "tree"
    try:
        subprocess.run(["git", "worktree", "add", "--detach", str(tree), rev], cwd=ROOT, check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        out = work / "baseline.json"
        env = {**os.environ, "PYTHONPATH": f"{tree / 'hosts/server'}:{tree}"}
        cmd = [sys.executable, str(Path(__file__).resolve()), "--save", str(out), "--jobs", str(args.jobs)]
        done = subprocess.run(cmd, cwd=tree, env=env, capture_output=True, text=True)
        if done.returncode:
            sys.exit(f"the probe failed on {rev}:\n{done.stdout}{done.stderr}")
        return json.loads(out.read_text())
    finally:
        subprocess.run(["git", "worktree", "remove", "--force", str(tree)], cwd=ROOT,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["git", "worktree", "prune"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.rmtree(work, ignore_errors=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--save", metavar="FILE", help="write the answers to FILE")
    ap.add_argument("--against", metavar="FILE", help="print the differences from a saved FILE")
    ap.add_argument("--diff", metavar="REV", help="print the differences from REV (probed in a temporary worktree)")
    ap.add_argument("--only", action="append", choices=PRINCIPALS, help="only this principal (repeatable)")
    ap.add_argument("--door", action="append", choices=DOORS, help="only this door (repeatable)")
    ap.add_argument("--jobs", type=int, default=1, help="apps probed at once (default 1; the answers are the same, but _meta.outbound_refused blames the wrong routes)")
    args = ap.parse_args(argv)
    started = time.time()
    table = run_probe(args, args.only, args.door)
    meta = table["_meta"]
    print(f"probed {meta['routes']} routes, {meta['requests']} requests in {time.time() - started:.0f} s",
          file=sys.stderr)
    if meta["outbound_refused"]:
        print(f"REFUSED outbound attempts: {meta['outbound_refused']}", file=sys.stderr)
    if args.save:
        Path(args.save).write_text(dump(table))
    if args.against or args.diff:
        old = json.loads(Path(args.against).read_text()) if args.against else baseline_of(args.diff, args)
        lines = compare(old, table)
        print("\n".join(lines))
        return 1 if lines else 0
    if not args.save:
        print(dump(table), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
