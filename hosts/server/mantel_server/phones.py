"""Mantel's notifications on people's phones, through Home Assistant's Companion app (docs/phase9/MANTEL-LINK.md 9.7).

Mantel Link reports the phones its Home Assistant can notify (``notify.mobile_app_<phone>``: the Companion app's own
services, with each phone's name). An Owner or Admin picks each person's phones in Mantel Settings -> People, and what
goes there: **Important only** (the default), everything, or nothing. When Mantel shows a notification on its screens
(a rule, a calendar, ``mantel.notify`` / ``hk_frontend.notify``) it also sends it to the phones of the people it is
for -- everyone's, or only those it names (``users``: Home Assistant users, through their Mantel links, or Mantel
names) -- and never one meant for some screens only (``dashboards``).

* **How it gets there:** a ``phone_notify`` frame to Mantel Link (protocol 2), the one thing Mantel may ask Home
  Assistant to do over the link: Mantel Link calls ``notify.<that phone>`` and nothing else (it checks the service is
  a Companion app phone it reported, and the fields).
* **What comes back:** the phone's Dismiss (the Companion app's ``mobile_app_notification_action``) reaches Mantel as
  ``phone_action``; Mantel takes the banner down on every screen (``notification_dismiss``) and notes who did.
* **Nothing secret** goes to a phone that the screens don't show: the title and the message; the tap opens Mantel's
  address when it has one.
"""
from __future__ import annotations

import json
import logging
import re
import time
from collections import deque
from typing import Any

from aiohttp import web

from .storage import audit
from .identity.guards import guard
from .identity.guards import ident as guarded

log = logging.getLogger("mantel.phones")

SEND = ("important", "all", "off")
SERVICE = re.compile(r"^mobile_app_[a-z0-9_]{1,80}$")
ACTION = re.compile(r"^MANTEL_(DISMISS)_([A-Za-z0-9_-]{1,64})$")
TITLE_MAX, MESSAGE_MAX = 100, 500
MIGRATION = __import__("pathlib").Path(__file__).with_name("migrations") / "0015_person_phones.sql"


def ensure_schema(conn) -> None:
    conn.executescript(MIGRATION.read_text())


class Phones:
    def __init__(self, app: web.Application) -> None:
        self.app = app
        self.sent: deque = deque(maxlen=100)
        self.actions: deque = deque(maxlen=100)

    @property
    def db(self):
        return self.app["store"].db

    # -- what Home Assistant has (Mantel Link's report) -----------------------------------------------------------
    def links(self) -> list[Any]:
        lk = self.app.get("linked")
        return [c for c in (lk.registry.clients_of("mantel") if lk is not None else []) if c.protocol >= 2]

    def available(self) -> list[dict[str, str]]:
        seen: dict[str, str] = {}
        for c in self.links():
            for p in c.report.get("phones") or []:
                seen.setdefault(p["service"], p["name"])
        return [{"service": s, "name": n} for s, n in sorted(seen.items(), key=lambda kv: kv[1].lower())]

    # -- each person's choice ------------------------------------------------------------------------------------
    def of(self, user_id: str) -> dict[str, Any]:
        row = self.db.execute("SELECT services, send FROM person_phones WHERE user_id = ?", (user_id,)).fetchone()
        if row is None:
            return {"services": [], "send": "important"}
        try:
            services = [s for s in json.loads(row[0]) if isinstance(s, str) and SERVICE.match(s)]
        except ValueError:
            services = []
        return {"services": services, "send": row[1] if row[1] in SEND else "important"}

    def all(self) -> dict[str, dict[str, Any]]:
        return {r[0]: self.of(r[0]) for r in self.db.execute("SELECT user_id FROM person_phones")}

    @staticmethod
    def check(services: Any, send: Any) -> tuple[list[str], str]:
        if not isinstance(services, list) or len(services) > 10 or not all(
                isinstance(s, str) and SERVICE.match(s) for s in services):
            raise ValueError("services: a list of notify.mobile_app_* service names")
        if send not in SEND:
            raise ValueError("send: important, all or off")
        return sorted(set(services)), send

    def set(self, user_id: str, services: Any, send: Any, by: str | None) -> dict[str, Any]:
        services, send = self.check(services, send)
        with self.db:
            self.db.execute("INSERT INTO person_phones (user_id, services, send, changed, changed_by) VALUES (?,?,?,?,?) "
                            "ON CONFLICT(user_id) DO UPDATE SET services=excluded.services, send=excluded.send, "
                            "changed=excluded.changed, changed_by=excluded.changed_by",
                            (user_id, json.dumps(services), send, self.app["clock"](), by))
        return {"services": services, "send": send}

    # -- delivering ------------------------------------------------------------------------------------------------
    def _people_for(self, users: list[str]) -> set[str] | None:
        """The Mantel people a notification names (HA user ids through their links, or Mantel names), or None for
        everyone."""
        if not users:
            return None
        store, acc = self.app["store"], self.app.get("accounts")
        out: set[str] = set()
        for u in users:
            link = store.get_link(u) if hasattr(store, "get_link") else None
            if link and link.get("user_id"):
                out.add(link["user_id"])
        if acc is not None:
            for row in acc.list_users() if hasattr(acc, "list_users") else []:
                names = {str(row.get("username") or "").lower(), str(row.get("name") or "").lower()}
                if names & {str(u).lower() for u in users}:
                    out.add(row["id"])
        return out

    def recipients(self, payload: dict[str, Any]) -> list[tuple[str, str]]:
        """(person, phone service) pairs a notification goes to."""
        if payload.get("dashboards"):
            return []                                 # meant for some screens only
        only = self._people_for([str(u) for u in payload.get("users") or []])
        important = bool(payload.get("important"))
        have = {p["service"] for p in self.available()}
        out = []
        for uid, choice in self.all().items():
            if only is not None and uid not in only:
                continue
            if choice["send"] == "off" or (choice["send"] == "important" and not important):
                continue
            out += [(uid, s) for s in choice["services"] if s in have]
        return out

    def _url(self) -> str | None:
        cfg = self.app.get("cfg")
        pub = getattr(cfg, "public_url", "") or ""
        return pub.rstrip("/") + "/home" if pub.startswith("https://") and ".invalid" not in pub else None

    async def deliver(self, payload: dict[str, Any]) -> list[str]:
        """Send one notification (as the screens got it) to the phones it is for. Returns the services sent to."""
        pairs = self.recipients(payload)
        links = self.links()
        if not pairs or not links:
            return []
        nid = str(payload.get("id") or int(time.time() * 1000))
        data: dict[str, Any] = {"tag": f"mantel-{nid}", "group": "mantel",
                                "actions": [{"action": f"MANTEL_DISMISS_{nid}", "title": "Dismiss"}]}
        if (url := self._url()) is not None:
            data["url"] = url
            data["clickAction"] = url
        if payload.get("important"):
            data["push"] = {"interruption-level": "time-sensitive"}
            data["priority"] = "high"
            data["ttl"] = 0
        frame = {"type": "phone_notify", "title": str(payload.get("title") or "Mantel")[:TITLE_MAX],
                 "message": str(payload.get("message") or "")[:MESSAGE_MAX], "data": data}
        services = sorted({s for _u, s in pairs})
        link = links[0]
        for s in services:
            await link.send({**frame, "service": s})
        self.sent.append({"at": time.time(), "id": nid, "title": frame["title"], "phones": services,
                          "people": sorted({u for u, _s in pairs})})
        return services

    # -- what came back ------------------------------------------------------------------------------------------
    def on_action(self, client: Any, body: Any) -> dict[str, Any]:
        from .linked import LinkedError
        if not isinstance(body, dict) or set(body) - {"action", "service"}:
            raise LinkedError("invalid", "phone_action: {action, service?}")
        m = ACTION.match(str(body.get("action") or ""))
        if not m:
            raise LinkedError("invalid", "not one of Mantel's actions")
        svc = body.get("service")
        nid = m.group(2)
        host = self.app.get("features")
        if host is not None and getattr(host, "feed", None) is not None:
            host.feed.send({"type": "notification_dismiss", "id": nid})
        self.actions.append({"at": time.time(), "id": nid, "action": m.group(1).lower(),
                             "phone": svc if isinstance(svc, str) and SERVICE.match(svc) else None})
        log.info("phones: %s dismissed notification %s", svc or "a phone", nid)
        return {"ok": True}


# -- REST (Mantel Settings -> People) -----------------------------------------------------------------------------------
@guard("manager", reads="admin")
async def api_get(request: web.Request) -> web.Response:
    p: Phones = request.app["phones"]
    return web.json_response({"available": p.available(), "people": p.all(), "linked": bool(p.links())})


@guard("manager", audit="phones.set")
async def api_put(request: web.Request) -> web.Response:
    from .identity.accounts import read_json
    from .identity.sessions import error
    ident = guarded(request)
    uid = request.match_info["id"]
    row = request.app["accounts"].get_user(uid)
    if row is None:
        return error(404, "not_found")
    if ident.user.role != "owner" and row["role"] == "owner":
        return error(403, "forbidden")
    body = await read_json(request)
    p: Phones = request.app["phones"]
    try:
        services, send = p.check(body.get("services") if isinstance(body, dict) else None,
                                 body.get("send") if isinstance(body, dict) else None)
    except ValueError as exc:
        return error(400, "invalid", message=str(exc))
    audit.config(request, ident, "phones.set", {"user": uid, "from": p.of(uid), "to": {"services": services, "send": send}})
    return web.json_response(p.set(uid, services, send, ident.user.id))


def register(app: web.Application) -> Phones:
    if "phones" in app:
        return app["phones"]
    ensure_schema(app["store"].db)
    p = app["phones"] = Phones(app)
    lk = app.get("linked")
    if lk is not None:
        lk.phone_action = p.on_action           # protocol 2's phone_action frames (linked.py)
    app.router.add_get("/api/phones", api_get)
    app.router.add_put("/api/users/{id}/phones", api_put)
    return p
