"""System alerts (docs/phase14/SYSTEM-ALERTS.md): Mantel tells someone when something goes wrong.

* ``catalog.py``: the kinds (group, level, hold, words);
* ``center.py``: holds, flapping, causes, batching, quiet hours, delivery, the log;
* ``sources.py``: what is looked at and told (the connections, backups, tablets, disks, start and stop);
* ``channels/``: the senders (Discord, Telegram, Notifiarr, email, Apprise);
* ``updates.py``: the update check (About, and ``update.*``);
* ``api.py``: Mantel Settings → Alerts' REST.

The Mantel apps take system alerts too (``app_sink``): Owners and Admins who turn on System Alerts in Me (on by
default for an Owner), through the Pusher, sealed end to end, ``category: "system"``. The heartbeat calls a URL the
Owner sets every few minutes, so an outside service notices when Mantel itself stops.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from typing import Any

from aiohttp import web

from ..storage import atrest
from . import api, catalog, sources
from .center import APP, Center, ChannelError, Message
from .channels import Invalid, host_ok, http_transport, senders, text
from .store import Channels, Log, Settings

log = logging.getLogger("mantel.alerts")

SYSTEM_KEY = "system_alerts"            # user_data: a person's System Alerts switch (Me)
MANAGERS = ("owner", "admin")
HEARTBEAT_EVERY = 300.0
HEARTBEAT_AAD = "alert-heartbeat"
THROUGH_HA = ("ha.lost", "link.lost")    # what the Companion app can't carry: it goes through them


def public_host(host: str) -> bool:
    """The heartbeat calls a service on the internet: not this machine, the home network or a cloud's metadata."""
    import ipaddress
    host = host.rstrip(".").lower()
    if not host or host == "localhost" or host.endswith((".localhost", ".invalid", ".local")):
        return False
    try:
        ip = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return True
    return ip.is_global


class Alerts:
    def __init__(self, app: web.Application, *, clock=None, box: atrest.SecretBox | None = None,
                 transport=None) -> None:
        self.app = app
        cfg = app["cfg"]
        db = app["store"].db
        self.clock = clock or (lambda: app["clock"]())
        self.box = box or atrest.SecretBox(cfg.secrets_dir / atrest.KEY_FILE)
        self.channels = Channels(db, self.box, self.clock)
        self.log = Log(db, self.clock)
        self.settings = Settings(db, self.clock)
        self.transport = transport or http_transport(lambda: app.get("http"))
        self.center = Center(channels=self.channels, log_store=self.log, settings=self.settings, send=self.send,
                             clock=self.clock, tz=self.tz, house=lambda: str(app.get("house_name") or ""),
                             link=self.link, app_sink=self.app_sink)
        self.watch = sources.Watch(app, self.center, self.clock)
        self.push_watch = sources.PushWatch(self.center)
        self.signins = sources.SignInWatch(self.center, self.clock)
        self.updates = None                # updates.Updates (14.2), set by register
        self.heartbeat_last: dict[str, Any] = {}
        self.tasks: list[asyncio.Task] = []

    # -- what the center needs ----------------------------------------------------------------------------------
    def tz(self) -> str:
        authz = self.app.get("authz")
        return getattr(authz, "tz", None) or getattr(self.app["cfg"], "house_tz", "UTC") or "UTC"

    def link(self, page: str) -> str | None:
        """The Settings page a message points to, when Mantel knows an outside address for itself."""
        pub = str(getattr(self.app["cfg"], "public_url", "") or "")
        if not pub.startswith("https://") or ".invalid" in pub:
            return None
        return pub.rstrip("/") + "/settings#/mantel/" + (page or "alerts")

    async def send(self, ch: dict, msg: Message) -> None:
        mod = senders().get(ch["kind"])
        if mod is None:
            raise ChannelError(f"Mantel doesn't know how to send to {ch['kind']}", permanent=True)
        secret = self.channels.secret(ch["id"])
        if secret is None and ch.get("sealed") is not None:
            raise ChannelError("its secret couldn't be opened (restored with another key?): enter it again",
                               permanent=True)
        await mod.send(self.transport, ch.get("config") or {}, secret, msg)

    async def test(self, ch: dict) -> str | None:
        """Send Test: a real message now. None when it went, else the service's answer for the page."""
        try:
            await self.send(ch, api.test_message(str(self.app.get("house_name") or ""), self.link("alerts")))
        except ChannelError as exc:
            self.channels.failed(ch["id"], exc.message)
            return exc.message
        except Exception as exc:  # noqa: BLE001
            log.exception("alerts: Send Test to %s failed", ch["kind"])
            return f"Mantel couldn't send it ({type(exc).__name__})"
        self.channels.sent(ch["id"])
        return None

    def name_of(self, user_id: str | None) -> str | None:
        if not user_id:
            return None
        row = self.app["store"].db.execute("SELECT name, username FROM users WHERE id = ?", (user_id,)).fetchone()
        return (row["name"] or row["username"]) if row is not None else None

    # -- the Mantel apps ----------------------------------------------------------------------------------------------
    def wants_system(self, user: Any) -> bool:
        if user is None or getattr(user, "role", None) not in MANAGERS:
            return False
        row = self.app["store"].db.execute("SELECT value FROM user_data WHERE subject = ? AND key = ?",
                                           (f"u:{user.id}", SYSTEM_KEY)).fetchone()
        if row is None:
            return user.role == "owner"
        try:
            return json.loads(row[0]) is True
        except ValueError:
            return False

    def set_wants_system(self, user: Any, on: bool) -> None:
        db = self.app["store"].db
        with db:
            db.execute("INSERT INTO user_data (subject, key, value, updated) VALUES (?,?,?,?) ON CONFLICT(subject, key) "
                       "DO UPDATE SET value = excluded.value, updated = excluded.updated",
                       (f"u:{user.id}", SYSTEM_KEY, json.dumps(bool(on)), self.clock()))

    def app_recipients(self) -> list[dict]:
        """Owners and Admins with System Alerts on, who aren't disabled: {id, name, role}."""
        db = self.app["store"].db
        rows = db.execute("SELECT u.id, u.username, u.name, u.role, d.value AS wants FROM users u "
                          "LEFT JOIN user_data d ON d.subject = 'u:' || u.id AND d.key = ? "
                          "WHERE u.role IN ('owner', 'admin') AND u.disabled = 0", (SYSTEM_KEY,)).fetchall()
        out = []
        for r in rows:
            wants = r["wants"]
            on = (r["role"] == "owner") if wants is None else wants.strip() == "true"
            if on:
                out.append({"id": r["id"], "name": r["name"] or r["username"], "role": r["role"],
                            "username": r["username"]})
        return out

    def app_recipients_public(self) -> dict:
        pusher = self.app.get("pusher")
        people = self.app_recipients()
        devices = 0
        if pusher is not None:
            ids = {p["id"] for p in people}
            devices = sum(1 for t in pusher.targets.everyone() if t["user_id"] in ids)
        return {"people": people, "devices": devices}

    async def app_sink(self, ch: dict, msg: Message) -> int:
        """One system alert to the Mantel apps (and Web Push) of the people who get them; how many it reached."""
        people = self.app_recipients()
        item = msg.items[0] if msg.items else None
        reached = 0
        pusher = self.app.get("pusher")
        ids = {p["id"] for p in people}
        rows = [r for r in pusher.recipients({"type": "notification"}) if r["user_id"] in ids] if pusher else []
        if rows:
            from ..push import Message as PushMessage
            pm = PushMessage(title=msg.subject[:120], body=msg.body[:400], tag=msg.tag[:64],
                             url="/settings#/mantel/alerts", important=msg.level == "critical", category="system",
                             level=msg.level, id=f"system-{item.log_id}" if item else None)
            counts = await pusher.deliver(rows, pm)
            reached += counts.get("ok", 0)
        # the Companion app's phones (phones.py) go through Home Assistant and Mantel Link: not when they are the
        # ones that dropped
        phones = self.app.get("phones")
        names = [p["username"] for p in people if p.get("username")]
        if phones is not None and names and (item is None or item.kind not in THROUGH_HA):
            try:
                got = await phones.deliver({"title": msg.subject, "message": msg.body, "users": names,
                                            "important": msg.level == "critical",
                                            "id": f"system-{item.log_id}" if item else None})
            except Exception:  # noqa: BLE001 -- the link may be down: the apps above still had it
                log.debug("alerts: the Companion app's delivery failed", exc_info=True)
                got = []
            reached += len(got or [])
        return reached

    # -- the heartbeat (14.7) -------------------------------------------------------------------------------------------
    def clean_heartbeat(self, v: Any) -> dict:
        """{url, every}: an https URL (healthchecks.io, Uptime Kuma's push monitor, Notifiarr), or {} to turn it off.
        A blank URL keeps the saved one."""
        if not isinstance(v, dict) or not v or v.get("on") is False:
            return {}                                   # off (the page's Turn Off sends {})
        url = text(v.get("url"), 512)
        if not url and v.get("on") is not False:
            url = self.heartbeat_url() or ""
        if not url:
            return {}
        from urllib.parse import urlsplit
        host = urlsplit(url).hostname or ""
        if not host_ok(url, (host,)) or not public_host(host):
            raise Invalid("invalid_heartbeat", "The heartbeat needs an https:// address (healthchecks.io, Uptime "
                                               "Kuma's push monitor, ...).")
        every = v.get("every")
        every = int(every) if isinstance(every, (int, float)) and not isinstance(every, bool) and 60 <= every <= 3600 \
            else int(HEARTBEAT_EVERY)
        return {"url": url, "every": every}

    def save_heartbeat(self, hb: dict) -> None:
        from urllib.parse import urlsplit
        if not hb:
            self.settings.set("heartbeat", {})
            return
        sealed = self.box.seal(hb["url"].encode(), HEARTBEAT_AAD)
        import base64
        self.settings.set("heartbeat", {"sealed": base64.b64encode(sealed).decode(), "every": hb["every"],
                                        "hint": urlsplit(hb["url"]).hostname})     # the service, never its key
        self.heartbeat_last = {}

    def heartbeat_url(self) -> str | None:
        hb = self.settings.get("heartbeat", {})
        if not isinstance(hb, dict) or not hb.get("sealed"):
            return None
        import base64
        try:
            return self.box.open(base64.b64decode(hb["sealed"]), HEARTBEAT_AAD).decode()
        except Exception:  # noqa: BLE001 -- another at-rest key: ask again
            return None

    def heartbeat_public(self) -> dict:
        hb = self.settings.get("heartbeat", {})
        hb = hb if isinstance(hb, dict) else {}
        on = bool(hb.get("sealed"))
        return {"on": on, "hint": hb.get("hint") if on else None, "every": hb.get("every", int(HEARTBEAT_EVERY)),
                "needs_url": on and self.heartbeat_url() is None, **self.heartbeat_last}

    async def heartbeat(self) -> None:
        url = self.heartbeat_url()
        if not url:
            return
        from urllib.parse import urlsplit
        try:
            status, _h, _b = await self.transport("GET", url, {"User-Agent": "Mantel"}, b"")
        except ChannelError as exc:
            self.heartbeat_last = {"last_at": self.clock(), "last_ok": False, "last_error": exc.message}
            return
        good = 200 <= status < 300
        self.heartbeat_last = {"last_at": self.clock(), "last_ok": good,
                               "last_error": None if good else f"{urlsplit(url).hostname} said {status}"}

    async def heartbeat_loop(self) -> None:
        while True:
            hb = self.settings.get("heartbeat", {})
            every = hb.get("every", HEARTBEAT_EVERY) if isinstance(hb, dict) else HEARTBEAT_EVERY
            try:
                await self.heartbeat()
            except Exception:  # noqa: BLE001
                log.exception("alerts: heartbeat failed")
            await asyncio.sleep(max(60.0, float(every)))

    # -- running ------------------------------------------------------------------------------------------------------
    async def watch_loop(self) -> None:
        while True:
            self.watch.look()
            await asyncio.sleep(sources.WATCH)

    async def start(self) -> None:
        from ..about import release
        sources.started(self.center, self.app["cfg"].data_dir, release().get("version"), self.clock())
        loop = asyncio.get_running_loop()
        self.tasks = [loop.create_task(self.center.run()), loop.create_task(self.watch_loop()),
                      loop.create_task(self.heartbeat_loop())]
        if self.updates is not None:
            self.tasks.append(loop.create_task(self.updates.run()))

    async def stop(self) -> None:
        for t in self.tasks:
            t.cancel()
        for t in self.tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
        await self.center.close()
        sources.stopped(self.app["cfg"].data_dir)


def register(app: web.Application, hub=None) -> Alerts:
    alerts = Alerts(app)
    app["alerts"] = alerts
    api.add_routes(app)
    backups = app.get("backups")
    if backups is not None:
        backups.listeners.append(lambda r: sources.backup_result(alerts.center, r, backups.folder))
    pusher = app.get("pusher")
    if pusher is not None and hasattr(pusher, "listeners"):
        pusher.listeners.append(alerts.push_watch.counts)
    accounts = app.get("accounts")
    if accounts is not None and hasattr(accounts, "on_failure"):
        accounts.on_failure.append(alerts.signins.failed)
    audit_log = app.get("audit")
    if audit_log is not None and hasattr(audit_log, "listeners"):
        audit_log.listeners.append(lambda ev: sources.config_changed(alerts.center, ev, alerts.name_of))
    try:
        from . import updates
        alerts.updates = updates.register(app, alerts)
    except ImportError:
        pass

    async def start(_app: web.Application) -> None:
        await alerts.start()

    async def stop(_app: web.Application) -> None:
        await alerts.stop()

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    return alerts


__all__ = ["Alerts", "register", "catalog", "Center", "ChannelError", "Message", "APP"]
