"""Notifications off the screens: Web Push now, the apps' APNs pushes in slice 10.5
(docs/phase10/APPLE-APPS.md §5, slice 10.0).

The Notifier (features.py) decides what goes off and sends it to the screens' feed. This module listens to the
same feed (``Feed.taps``) and sends each notification to the push targets of the people it is for:

* **Who gets it**: every person with a push target, narrowed to the notification's ``users`` when it names
  any (the same keys the screens' feed uses: Mantel's user id, the linked HA user's id, the user name), and
  only when that person may ``view`` the accessory it is about (RBAC with the tunnel's rules: a phone may be
  anywhere). A disabled person gets nothing.
* **Web Push** (a Home Screen web app on an iPhone, iOS 16.4+, or any browser): RFC 8291 encryption to the
  browser's key, RFC 8292 VAPID with the house's own key. The VAPID key is a secret file,
  ``<secrets_dir>/vapid.pem`` (made 0600 the first time; under Docker a mounted secret), never in the database.
  A subscription's endpoint is a URL Mantel will POST to, so only the known push services are accepted
  (PUSH_HOSTS); anything else is refused at subscribe time and again before sending. A push service that
  answers 404 or 410 has dropped the subscription: its row is removed.
* **What is sent**: title, text, a tag (the notification's mute key, so a repeat replaces the last), where a tap
  goes, and whether it is Important. Never a snapshot, a token or an entity's attributes.

REST (a signed-in person, for their own targets; CSRF as every /api/ write):

  GET    /api/push/web/key                  {key}: the VAPID public key (base64url) for pushManager.subscribe
  POST   /api/push/web/subscribe            {subscription: {endpoint, keys: {p256dh, auth}}, name?}
  POST   /api/push/web/unsubscribe          {endpoint}
  GET    /api/push/targets                  this person's targets (no secrets)
  DELETE /api/push/targets/{id}             remove one
  POST   /api/push/test                     a test notification to this person's targets
"""
from __future__ import annotations

import asyncio
import json
import logging
import secrets
import sqlite3
import time
from dataclasses import dataclass
from typing import Any, Awaitable, Callable
from urllib.parse import urlsplit

from aiohttp import ClientError, ClientTimeout, web

from . import app_crypto
from .accounts import read_json, require_user
from .sessions import error, ok

log = logging.getLogger("mantel.push")

VAPID_FILE = "vapid.pem"
# The push services a browser's subscription may point at (host, or a parent domain of it). Apple's (Safari and
# Home Screen web apps), Google's (Chrome, Edge on Android), Mozilla's (Firefox) and Microsoft's (Edge on Windows).
PUSH_HOSTS = ("web.push.apple.com", "fcm.googleapis.com", "push.services.mozilla.com", "notify.windows.com")
ENDPOINT_MAX = 1024
NAME_MAX = 64
TARGETS_PER_USER = 20
SEND_TIMEOUT = 10.0
TTL = 3600                     # a notification older than an hour is not worth showing
TITLE_MAX, BODY_MAX = 120, 400
FAILURES_DROP = 5              # repeated failures (not 404/410) also drop a target


def endpoint_ok(url: Any) -> bool:
    if not isinstance(url, str) or not url or len(url) > ENDPOINT_MAX:
        return False
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme != "https" or parts.port not in (None, 443) or parts.username or parts.password:
        return False
    return any(host == h or host.endswith("." + h) for h in PUSH_HOSTS)


def _origin(url: str) -> str:
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}"


# -- storage --------------------------------------------------------------------------------------
class Targets:
    COLS = "id, user_id, kind, endpoint, p256dh, auth, app_id, env, name, created, last_ok, failures"

    def __init__(self, db: sqlite3.Connection, clock: Callable[[], float] = time.time) -> None:
        self.db = db
        self.clock = clock

    def add(self, user_id: str, kind: str, endpoint: str, p256dh: str, auth: str | None = None, *,
            name: str | None = None, app_id: str | None = None, env: str | None = None) -> str:
        """Add (or move to this person, refreshing the keys) one target; returns its id."""
        now = self.clock()
        with self.db:
            row = self.db.execute("SELECT id FROM push_targets WHERE endpoint = ?", (endpoint,)).fetchone()
            if row is not None:
                self.db.execute("UPDATE push_targets SET user_id=?, kind=?, p256dh=?, auth=?, app_id=?, env=?, name=?, "
                                "failures=0 WHERE id=?", (user_id, kind, p256dh, auth, app_id, env, name, row["id"]))
                return row["id"]
            count = self.db.execute("SELECT COUNT(*) FROM push_targets WHERE user_id = ?", (user_id,)).fetchone()[0]
            if count >= TARGETS_PER_USER:       # the oldest goes: a person does not have 20 live browsers
                self.db.execute("DELETE FROM push_targets WHERE id = (SELECT id FROM push_targets WHERE user_id = ? "
                                "ORDER BY COALESCE(last_ok, created) LIMIT 1)", (user_id,))
            tid = secrets.token_hex(12)
            self.db.execute("INSERT INTO push_targets (id, user_id, kind, endpoint, p256dh, auth, app_id, env, name, created) "
                            "VALUES (?,?,?,?,?,?,?,?,?,?)", (tid, user_id, kind, endpoint, p256dh, auth, app_id, env, name, now))
            return tid

    def remove(self, target_id: str, user_id: str | None = None) -> bool:
        sql, args = "DELETE FROM push_targets WHERE id = ?", [target_id]
        if user_id is not None:
            sql += " AND user_id = ?"
            args.append(user_id)
        with self.db:
            return self.db.execute(sql, args).rowcount > 0

    def remove_endpoint(self, endpoint: str, user_id: str) -> bool:
        with self.db:
            return self.db.execute("DELETE FROM push_targets WHERE endpoint = ? AND user_id = ?",
                                   (endpoint, user_id)).rowcount > 0

    def remove_app(self, app_id: str) -> list[dict]:
        """Remove an app's targets; returns them (a relay handle is then forgotten at the relay too)."""
        rows = [dict(r) for r in self.db.execute(f"SELECT {self.COLS} FROM push_targets WHERE app_id = ?", (app_id,))]
        with self.db:
            self.db.execute("DELETE FROM push_targets WHERE app_id = ?", (app_id,))
        return rows

    def of_user(self, user_id: str) -> list[dict]:
        return [dict(r) for r in self.db.execute(f"SELECT {self.COLS} FROM push_targets WHERE user_id = ? ORDER BY created",
                                                 (user_id,))]

    def everyone(self) -> list[dict]:
        rows = self.db.execute(f"SELECT t.{self.COLS.replace(', ', ', t.')}, u.role, u.username, u.disabled, h.ha_user_id "
                               "FROM push_targets t JOIN users u ON u.id = t.user_id "
                               "LEFT JOIN ha_links h ON h.user_id = u.id")
        return [dict(r) for r in rows]

    def sent(self, target_id: str) -> None:
        with self.db:
            self.db.execute("UPDATE push_targets SET last_ok = ?, failures = 0 WHERE id = ?", (self.clock(), target_id))

    def failed(self, target_id: str, gone: bool) -> None:
        with self.db:
            if gone:
                self.db.execute("DELETE FROM push_targets WHERE id = ?", (target_id,))
                return
            self.db.execute("UPDATE push_targets SET failures = failures + 1 WHERE id = ?", (target_id,))
            self.db.execute("DELETE FROM push_targets WHERE id = ? AND failures >= ?", (target_id, FAILURES_DROP))


def public_json(t: dict) -> dict:
    """A target as its owner sees it: never the endpoint's secret part or the keys."""
    where = urlsplit(t["endpoint"]).hostname if t["kind"] == "web" else "Apple Push"
    return {"id": t["id"], "kind": t["kind"], "name": t.get("name"), "service": where, "created": t["created"],
            "last_ok": t.get("last_ok"), "app_id": t.get("app_id")}


# -- what is sent ---------------------------------------------------------------------------------
@dataclass(frozen=True)
class Message:
    title: str
    body: str
    tag: str | None = None
    url: str = "/home"
    important: bool = False
    entity: str | None = None
    snap: str | None = None
    camera: str | None = None
    id: str | None = None

    def web_payload(self) -> bytes:
        out = {"title": self.title, "body": self.body, "tag": self.tag, "url": self.url, "important": self.important}
        return json.dumps({k: v for k, v in out.items() if v is not None}, separators=(",", ":")).encode()

    @classmethod
    def of_event(cls, event: dict) -> "Message":
        tag = event.get("mute") or event.get("item") or None
        entity = event.get("entity") if isinstance(event.get("entity"), str) else None
        return cls(title=str(event.get("title") or "Mantel")[:TITLE_MAX],
                   body=str(event.get("message") or "")[:BODY_MAX],
                   tag=str(tag)[:64] if tag else None, important=bool(event.get("important")), entity=entity,
                   snap=event.get("snap") if isinstance(event.get("snap"), str) else None,
                   camera=event.get("camera") if isinstance(event.get("camera"), str) else None,
                   id=event.get("id") if isinstance(event.get("id"), str) else None)


def _keys_of(row: dict) -> set[str]:
    return {k for k in (row.get("user_id"), row.get("ha_user_id"), row.get("username")) if k}


# -- the pusher -----------------------------------------------------------------------------------
Sender = Callable[[dict, Message], Awaitable[str]]     # -> "ok" | "gone" | "failed"


class Pusher:
    def __init__(self, app: web.Application, targets: Targets) -> None:
        self.app = app
        self.targets = targets
        self._vapid = None
        self.senders: dict[str, Sender] = {"web": self.send_web}
        self.tasks: set[asyncio.Task] = set()
        self.log: list[dict] = []          # the last few deliveries
        self.http = None                   # the HTTP session to send with (default: the app's)

    # -- the VAPID key (a secret file) ------------------------------------------------------------
    def vapid(self):
        if self._vapid is None:
            cfg = self.app["cfg"]
            self._vapid = app_crypto.load_or_create_ec_key(cfg.secrets_dir.expanduser() / VAPID_FILE)
        return self._vapid

    def vapid_public(self) -> str:
        return app_crypto.b64u(app_crypto.raw_public(self.vapid().public_key()))

    def vapid_subject(self) -> str:
        url = getattr(self.app["cfg"], "public_url", "") or ""
        return _origin(url) if url.startswith("https://") else "mailto:push@mantel.home.example"

    # -- who --------------------------------------------------------------------------------------
    def may_see(self, row: dict, entity: str | None) -> bool:
        if not entity:
            return True
        authz = self.app.get("authz")
        if authz is None:
            return False          # no policy to decide with: nothing about an accessory leaves the house
        try:
            subject = authz.rbac.subject(user_role=row["role"], user_id=row["user_id"], device_role=None,
                                         device_id=None, door="tunnel", fresh_factor_at=None)
            return authz.decide(subject, "view", entity).allowed is True
        except Exception:  # noqa: BLE001 -- an unreadable policy sends nothing
            log.exception("push: could not decide view of %s", entity)
            return False

    def recipients(self, event: dict) -> list[dict]:
        users = set(event.get("users") or [])
        entity = event.get("entity") if isinstance(event.get("entity"), str) else None
        out = []
        for row in self.targets.everyone():
            if row.get("disabled"):
                continue
            if users and not (_keys_of(row) & users):
                continue
            if not self.may_see(row, entity):
                continue
            out.append(row)
        return out

    # -- the feed's tap ---------------------------------------------------------------------------
    def on_event(self, event: dict) -> None:
        if not isinstance(event, dict) or event.get("type") != "notification":
            return
        rows = self.recipients(event)
        if rows:
            self.spawn(self.deliver(rows, Message.of_event(event)))

    def spawn(self, coro) -> None:
        try:
            task = asyncio.get_running_loop().create_task(coro)
        except RuntimeError:           # no loop (a synchronous test): nothing to send with
            coro.close()
            return
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def deliver(self, rows: list[dict], msg: Message) -> dict[str, int]:
        counts: dict[str, int] = {}
        for row in rows:
            sender = self.senders.get(row["kind"])
            if sender is None:
                continue
            try:
                result = await sender(row, msg)
            except Exception:  # noqa: BLE001 -- one bad target never stops the others
                log.exception("push to %s target %s failed", row["kind"], row["id"])
                result = "failed"
            if result == "ok":
                self.targets.sent(row["id"])
            elif result in ("gone", "failed"):
                self.targets.failed(row["id"], gone=result == "gone")
            counts[result] = counts.get(result, 0) + 1
        self.log = (self.log + [{"at": time.time(), "title": msg.title, **counts}])[-20:]
        return counts

    def forget_app(self, app_id: str) -> None:
        """An app was signed out or revoked: its targets go, and its relay handles are forgotten at the relay."""
        for row in self.targets.remove_app(app_id):
            relay = self.app.get("push_relay")
            if row["kind"] == "apns" and row.get("env") == "relay" and relay is not None:
                self.spawn(relay.forget(row["endpoint"]))

    # -- Web Push ---------------------------------------------------------------------------------
    async def send_web(self, row: dict, msg: Message) -> str:
        endpoint = row["endpoint"]
        if not endpoint_ok(endpoint):
            return "gone"
        body = app_crypto.webpush_encrypt(msg.web_payload(), app_crypto.unb64u(row["p256dh"]),
                                          app_crypto.unb64u(row["auth"] or ""))
        headers = {"Authorization": app_crypto.vapid_header(self.vapid(), _origin(endpoint), self.vapid_subject()),
                   "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "TTL": str(TTL),
                   "Urgency": "high" if msg.important else "normal"}
        if msg.tag:
            headers["Topic"] = "".join(c for c in msg.tag if c.isalnum() or c in "-_")[:32] or "mantel"
        http = self.http or self.app.get("http")
        if http is None:
            return "failed"
        try:
            async with http.post(endpoint, data=body, headers=headers, allow_redirects=False,
                                 timeout=ClientTimeout(total=SEND_TIMEOUT)) as resp:
                if resp.status in (200, 201, 202):
                    return "ok"
                if resp.status in (404, 410):
                    return "gone"
                log.warning("web push to %s answered %s", urlsplit(endpoint).hostname, resp.status)
                return "failed"
        except (ClientError, asyncio.TimeoutError) as exc:
            log.warning("web push to %s failed: %s", urlsplit(endpoint).hostname, type(exc).__name__)
            return "failed"


# -- REST -----------------------------------------------------------------------------------------
def pusher_of(request: web.Request) -> Pusher:
    return request.app["pusher"]


async def web_key(request: web.Request) -> web.Response:
    require_user(request)
    return ok({"key": pusher_of(request).vapid_public()})


async def web_subscribe(request: web.Request) -> web.Response:
    ident = require_user(request)
    body = await read_json(request)
    sub = body.get("subscription")
    keys = sub.get("keys") if isinstance(sub, dict) else None
    endpoint = sub.get("endpoint") if isinstance(sub, dict) else None
    if not endpoint_ok(endpoint):
        return error(400, "push_service_not_allowed", message="That push service is not one Mantel sends to.")
    try:
        p256dh, auth = app_crypto.unb64u(keys["p256dh"]), app_crypto.unb64u(keys["auth"])
        app_crypto.public_from_raw(p256dh)
        if len(auth) != 16:
            raise ValueError
    except (KeyError, TypeError, ValueError):
        return error(400, "invalid", message="The subscription's keys are not valid.")
    name = body.get("name")
    name = name.strip()[:NAME_MAX] if isinstance(name, str) and name.strip() else None
    tid = pusher_of(request).targets.add(ident.user.id, "web", endpoint, app_crypto.b64u(p256dh),
                                         app_crypto.b64u(auth), name=name)
    return ok({"id": tid}, status=201)


async def web_unsubscribe(request: web.Request) -> web.Response:
    ident = require_user(request)
    body = await read_json(request)
    endpoint = body.get("endpoint")
    if not isinstance(endpoint, str):
        return error(400, "invalid")
    pusher_of(request).targets.remove_endpoint(endpoint, ident.user.id)
    return ok()


async def list_targets(request: web.Request) -> web.Response:
    ident = require_user(request)
    return ok({"targets": [public_json(t) for t in pusher_of(request).targets.of_user(ident.user.id)]})


async def delete_target(request: web.Request) -> web.Response:
    ident = require_user(request)
    if not pusher_of(request).targets.remove(request.match_info["id"], ident.user.id):
        return error(404, "not_found")
    return ok()


async def test_push(request: web.Request) -> web.Response:
    ident = require_user(request)
    p = pusher_of(request)
    rows = [r for r in p.targets.everyone() if r["user_id"] == ident.user.id]
    if not rows:
        return error(409, "no_targets", message="Turn notifications on for a device first.")
    counts = await p.deliver(rows, Message(title="Mantel", body="Notifications work on this device.", tag="mantel-test"))
    return ok({"sent": counts})


def register(app: web.Application, hub=None) -> Pusher:
    pusher = Pusher(app, Targets(app["store"].db, lambda: app["clock"]()))
    app["pusher"] = pusher
    features = app.get("features")
    feed = getattr(features, "feed", None)
    if feed is not None and hasattr(feed, "taps"):
        feed.taps.append(pusher.on_event)
    app.router.add_get("/api/push/web/key", web_key)
    app.router.add_post("/api/push/web/subscribe", web_subscribe)
    app.router.add_post("/api/push/web/unsubscribe", web_unsubscribe)
    app.router.add_get("/api/push/targets", list_targets)
    app.router.add_delete("/api/push/targets/{id}", delete_target)
    app.router.add_post("/api/push/test", test_push)

    async def stop(_app: web.Application) -> None:
        for task in list(pusher.tasks):
            task.cancel()
    app.on_cleanup.append(stop)
    return pusher
