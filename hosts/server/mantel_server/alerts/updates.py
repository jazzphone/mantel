"""The update check (docs/phase14/SYSTEM-ALERTS.md "The update check"): Mantel notices a new release and says so.

Mantel can't install its own updates, but it can ask GitHub what the latest release of each product is, compare it
with what is installed, and tell About (and the channels with Updates on) how to update this install. Three calls a
day to ``GET /repos/<repo>/releases/latest``: no token, ``User-Agent: Mantel``, nothing about the house. A draft or
a pre-release is ignored, though that endpoint already leaves them out.

* **When.** Once 10 minutes after a start, then once a day at a minute chosen at random when Mantel starts (so every
  house doesn't ask GitHub at midnight). ``run()`` is the loop; the delays are attributes so tests can shrink them.
* **The switch.** ``alerts.settings["updates"] == {"check": bool}``, on by default (decision 6). Off means Mantel
  never calls GitHub.
* **What About shows.** ``alerts.settings["updates_state"]``: per product the latest release (version, date, notes
  link), when it was checked and, when the last check failed, the error. A failed check raises nothing: a house
  that is offline isn't an alert. The state is in the database so About still shows it after a restart.
* **The alert.** ``update.<product>`` is raised once per new version (the version raised is remembered in the
  state, because the center forgets its alerts across a restart) and cleared when the installed version reaches it.
* **Installed versions.** Mantel's own comes from ``about.release()``. Mantel Link and HK Frontend are compared only
  when they have told Mantel their version over the link (``linked_version``); with none, they are "unknown" and
  never raise.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import re
from datetime import datetime
from typing import Any

from aiohttp import web

from ..pages import about
from ..storage import audit
from ..identity.accounts import read_json
from ..identity.guards import guard
from ..identity.guards import ident as guarded
from ..identity.sessions import error, ok
from .center import ChannelError

log = logging.getLogger("mantel.alerts")

API = "https://api.github.com/repos/{repo}/releases/latest"
HEADERS = {"User-Agent": "Mantel", "Accept": "application/vnd.github+json"}
NOTES = "https://github.com/"                 # a release's page is shown as a link only when it is here
PRODUCTS = (                                 # (id, GitHub repo, alert kind, name)
    ("mantel", "jazzphone/mantel", "update.mantel", "Mantel"),
    ("link", "jazzphone/mantel-link", "update.link", "Mantel Link"),
    ("hk_frontend", "jazzphone/hk-frontend", "update.hk_frontend", "HK Frontend"),
)
HOW_APP = "In Home Assistant: Settings → Add-ons → Mantel → Update."
HOW_LXC = "Run `update` in the container's console."
HOW_DOCKER = "Run `docker compose pull && docker compose up -d`."
HOW_BOTH = "In the LXC, run `update` in the container's console. In Docker, run `docker compose pull && docker compose up -d`."
HOW_HACS ="Update it in HACS."
MIN_GAP = 15.0                               # seconds between two calls to GitHub, however they are asked for
_VERSION = re.compile(r"^\d+(\.\d+)*([-+.][0-9A-Za-z.+-]*)?$")


def newer(a: str | None, b: str | None) -> bool:
    """Is version ``a`` newer than ``b``? Numeric by part (0.1.115 > 0.1.99); a part that isn't a number
    (``0-rc1``) compares lower than any number, so a pre-release is older than its release; a missing part is 0."""
    if not a or not b:
        return False

    def parts(v: str) -> list[int]:
        return [int(p) if p.isdigit() else -1 for p in v.strip().lstrip("v").split(".")]
    x, y = parts(a), parts(b)
    n = max(len(x), len(y))
    return x + [0] * (n - len(x)) > y + [0] * (n - len(y))


def linked_version(app: web.Application, domain: str) -> str | None:
    """The version Mantel Link told Mantel over the link (its ``report``'s ``versions``: its own as ``mantel``, HK
    Frontend's as ``hk_frontend`` when Home Assistant has it), or None (an older Mantel Link, or not installed)."""
    registry = getattr(app.get("linked"), "registry", None)
    for c in getattr(registry, "clients", None) or []:
        if getattr(getattr(c, "ws", None), "closed", True) or getattr(c, "domain", None) != "mantel":
            continue
        got = ((getattr(c, "report", None) or {}).get("versions") or {}).get(domain)
        if isinstance(got, str) and _VERSION.match(got.strip().lstrip("v")):
            return got.strip().lstrip("v")
    return None


class Failed(Exception):
    """A check that didn't get an answer; its words are for About."""


class Updates:
    def __init__(self, alerts: Any) -> None:
        self.alerts = alerts
        self.first_delay = 600.0                         # ten minutes after a start
        self.day = 86400.0
        self.minute = random.randrange(1440) * 60.0      # this run's minute of the day (UTC), chosen once
        self.last_call = -1e18
        self.lock = asyncio.Lock()

    # -- what is kept ------------------------------------------------------------------------------------------
    def enabled(self) -> bool:
        got = self.alerts.settings.get("updates", {})
        return not (isinstance(got, dict) and got.get("check") is False)

    def set_enabled(self, on: bool) -> None:
        self.alerts.settings.set("updates", {"check": bool(on)})

    def state(self) -> dict:
        got = self.alerts.settings.get("updates_state", {})
        return got if isinstance(got, dict) else {}

    # -- what is installed, and how to update it ---------------------------------------------------------------
    def installed_of(self, key: str) -> str | None:
        if key == "mantel":
            return about.release().get("version") or None
        return linked_version(self.alerts.app, "mantel" if key == "link" else "hk_frontend")

    def install(self) -> dict:
        """{kind, how}: how this Mantel was installed, and the step that updates it. A container the LXC's installer
        didn't mark (MANTEL_INSTALL=lxc in its compose .env) or Docker's doesn't say which it is: both lines."""
        if about.install_kind(self.alerts.app["cfg"]) == "Home Assistant App":
            return {"kind": "ha_app", "how": HOW_APP}
        mark = os.environ.get("MANTEL_INSTALL", "").strip().lower()
        if mark == "lxc":
            return {"kind": "lxc", "how": HOW_LXC}
        if mark == "docker":
            return {"kind": "docker", "how": HOW_DOCKER}
        return {"kind": "container", "how": HOW_BOTH}

    def how(self, key: str) -> str:
        return self.install()["how"] if key == "mantel" else HOW_HACS

    # -- the check ------------------------------------------------------------------------------------------------
    async def latest(self, repo: str) -> dict | None:
        """The repo's latest release {version, date, url}, None when it has none (yet) or it isn't one to offer."""
        try:
            status, _h, body = await self.alerts.transport("GET", API.format(repo=repo), HEADERS, b"")
        except ChannelError as exc:
            raise Failed(exc.message) from None
        if status == 404:
            return None
        if status != 200:
            raise Failed("couldn't reach GitHub" if status == 0 else f"GitHub said {status}")
        try:
            rel = json.loads(body)
        except ValueError:
            raise Failed("GitHub's answer wasn't readable") from None
        if not isinstance(rel, dict):
            raise Failed("GitHub's answer wasn't readable")
        if rel.get("draft") is True or rel.get("prerelease") is True:
            return None
        tag = rel.get("tag_name")
        version = tag.strip().lstrip("v") if isinstance(tag, str) else ""
        if not version or not _VERSION.match(version) or len(version) > 32:
            return None
        url = rel.get("html_url")
        date = None
        if isinstance(rel.get("published_at"), str):
            try:
                date = datetime.fromisoformat(rel["published_at"].replace("Z", "+00:00")).timestamp()
            except ValueError:
                pass
        return {"version": version, "date": date, "url": url if isinstance(url, str) and url.startswith(NOTES) else None}

    async def check(self, *, force: bool = False) -> bool:
        """Ask GitHub about each installed product now. False when it didn't (the switch is off, or it asked a
        moment ago and ``force`` is not set)."""
        if not self.enabled():
            return False
        async with self.lock:
            now = self.alerts.clock()
            if not force and now - self.last_call < MIN_GAP:
                return False
            self.last_call = now
            st = self.state()
            found = dict(st.get("latest") if isinstance(st.get("latest"), dict) else {})
            problem = None
            asked = 0
            for key, repo, _kind, name in PRODUCTS:
                if not self.installed_of(key):
                    continue                              # not installed (or no version told): nothing to compare
                asked += 1
                try:
                    rel = await self.latest(repo)
                except Failed as exc:
                    problem = problem or f"{name}: {exc}"
                    continue
                if rel is None:
                    found.pop(key, None)
                else:
                    found[key] = rel
            st["latest"] = found
            st["error"] = {"at": now, "message": problem} if problem else None
            if asked and (not problem or found):
                st["checked_at"] = now
            self.alerts.settings.set("updates_state", st)
            self.evaluate()
            return True

    def evaluate(self) -> None:
        """Raise ``update.<product>`` once for each new version, and clear it when the installed version catches up."""
        st = self.state()
        latest = st.get("latest") if isinstance(st.get("latest"), dict) else {}
        raised = dict(st.get("raised") if isinstance(st.get("raised"), dict) else {})
        changed = False
        for key, _repo, kind, _name in PRODUCTS:
            have, rel = self.installed_of(key), latest.get(key)
            if not have:
                continue
            want = rel.get("version") if isinstance(rel, dict) else None
            if want and newer(want, have):
                if raised.get(key) != want:
                    # a newer release while the last one's alert is up: that one goes quietly, this one is said
                    self.alerts.center.forget(kind, "")
                    self.alerts.center.raise_(kind, "", {"version": want, "how": self.how(key)})
                    raised[key] = want
                    changed = True
            elif want and key in raised:                 # no answer at all clears nothing
                self.alerts.center.clear(kind, "", {"version": have})
                del raised[key]
                changed = True
        if changed:
            st["raised"] = raised
            self.alerts.settings.set("updates_state", st)

    async def run(self) -> None:
        await asyncio.sleep(self.first_delay)
        while True:
            try:
                await self.check()
            except Exception:  # noqa: BLE001 -- the next day tries again
                log.exception("updates: the check failed")
            now = self.alerts.clock()
            await asyncio.sleep((self.minute - now) % self.day or self.day)

    # -- what About shows -----------------------------------------------------------------------------------------
    def public(self) -> dict:
        self.evaluate()
        st = self.state()
        latest = st.get("latest") if isinstance(st.get("latest"), dict) else {}
        products = []
        for key, _repo, _kind, name in PRODUCTS:
            have = self.installed_of(key)
            rel = latest.get(key) if isinstance(latest.get(key), dict) else {}
            products.append({"id": key, "name": name, "installed": have, "latest": rel.get("version"),
                             "date": rel.get("date"), "url": rel.get("url"),
                             "newer": bool(have and newer(rel.get("version"), have)), "how": self.how(key)})
        err = st.get("error")
        return {"check": self.enabled(), "products": products, "checked_at": st.get("checked_at"),
                "error": err if isinstance(err, dict) else None, "install": self.install()}


def updates_of(request: web.Request) -> Updates:
    return request.app["alerts"].updates


def _page(request: web.Request) -> dict:
    from ..connections import edit_rule
    rule = edit_rule(request, guarded(request))
    return {**updates_of(request).public(), "can_edit": rule != "owner_only", "needs_fresh": rule == "fresh"}


@guard("manager", reads="admin")
async def api_get(request: web.Request) -> web.Response:
    return ok(_page(request))


@guard("owner", fresh="away", audit="updates.settings.saved")
async def api_put(request: web.Request) -> web.Response:
    ident = guarded(request)
    body = await read_json(request)
    on = body.get("check")
    if not isinstance(on, bool):
        return error(400, "invalid", message="check is true or false.")
    audit.config(request, ident, "updates.settings.saved", {"check": on})
    updates_of(request).set_enabled(on)
    return ok(_page(request))


@guard("owner", fresh="away", no_audit="asks GitHub for the latest releases; changes nothing")
async def api_check(request: web.Request) -> web.Response:
    u = updates_of(request)
    if not u.enabled():
        return error(409, "updates_off", message="Check for Updates is off.")
    await u.check()
    return ok(_page(request))


def register(app: web.Application, alerts: Any) -> Updates:
    app.router.add_get("/api/updates", api_get)
    app.router.add_put("/api/updates", api_put)
    app.router.add_post("/api/updates/check", api_check)
    return Updates(alerts)
