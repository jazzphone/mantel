"""A fictional house with the House Timeline's rows in it, for the API and log tests (phase 19): the people, a wall
tablet, the registry and states the roles look at, and one row of each kind. Invented names only."""
from __future__ import annotations

import json

from mantel_server.timeline.store import Row

PASSWORD = "correct horse battery staple"
JPEG = b"\xff\xd8\xff\xe0fictional-picture-bytes\xff\xd9"

AREAS = [{"area_id": "hall", "name": "Hallway"}, {"area_id": "drive", "name": "Driveway"},
         {"area_id": "cody_room", "name": "Cody's Room"}]
DEVICES = [{"id": "cam_drive", "name": "Driveway Cam", "area_id": "drive"},
           {"id": "cam_hall", "name": "Hall Cam", "area_id": "hall"}]
ENTITIES = [
    {"entity_id": "lock.back_door", "area_id": "hall"},
    {"entity_id": "binary_sensor.back_door", "area_id": "hall", "original_device_class": "door"},
    {"entity_id": "cover.garage", "area_id": "drive", "original_device_class": "garage"},
    {"entity_id": "alarm_control_panel.house", "area_id": "hall"},
    {"entity_id": "person.emma"},
    {"entity_id": "person.visitor"},
    {"entity_id": "camera.driveway", "device_id": "cam_drive"},
    {"entity_id": "camera.hall", "device_id": "cam_hall"},
    {"entity_id": "light.cody", "area_id": "cody_room"},
]
STATES = {
    "lock.back_door": {"s": "locked", "a": {"friendly_name": "Back Door"}, "lc": 1.0, "lu": 1.0},
    "binary_sensor.back_door": {"s": "off", "a": {"friendly_name": "Back Door", "device_class": "door"}, "lc": 1.0,
                                "lu": 1.0},
    "cover.garage": {"s": "closed", "a": {"friendly_name": "Garage", "device_class": "garage"}, "lc": 1.0, "lu": 1.0},
    "alarm_control_panel.house": {"s": "disarmed", "a": {"friendly_name": "Alarm"}, "lc": 1.0, "lu": 1.0},
    "person.emma": {"s": "home", "a": {"friendly_name": "Emma"}, "lc": 1.0, "lu": 1.0},
    "person.visitor": {"s": "home", "a": {"friendly_name": "Visitor"}, "lc": 1.0, "lu": 1.0},
    "camera.driveway": {"s": "idle", "a": {"friendly_name": "Driveway Cam"}, "lc": 1.0, "lu": 1.0},
    "camera.hall": {"s": "idle", "a": {"friendly_name": "Hall Cam"}, "lc": 1.0, "lu": 1.0},
    "light.cody": {"s": "off", "a": {"friendly_name": "Cody"}, "lc": 1.0, "lu": 1.0},
}


class House:
    """The people, the tablet and the rows of the matrix. ``w.rows`` maps a short name to the row's id."""

    def __init__(self, m) -> None:
        self.m = m
        self.app = m.app
        self.now = m.now
        self.tl = m.app["timeline"]
        self.db = m.app["store"].db
        self.uid: dict[str, str] = {}
        self.snap: dict[str, dict] = {}
        self.tunnel: dict[str, bool] = {}
        self.rows: dict[str, int] = {}
        self.pics: dict[str, str] = {}
        self.tablet_id: str | None = None
        self.bodies: list[str] = []

    # -- the house -------------------------------------------------------------------------------------------------
    def load(self) -> None:
        hub = self.app["hub"]
        # the alert center's own rows ("Mantel started") arrive when they like: this house writes its System rows itself
        listeners = self.app["alerts"].center.listeners
        if self.tl.on_alert in listeners:
            listeners.remove(self.tl.on_alert)
        hub.registry.load(AREAS, DEVICES, ENTITIES)
        hub.store.replace_all({k: dict(v) for k, v in STATES.items()})

    async def people(self) -> None:
        for name, role in (("avery", "owner"), ("boss", "admin"), ("mark", "adult"), ("emma", "adult"),
                           ("cody", "child"), ("pip", "child"), ("gwen", "guest")):
            self.uid[name] = await self.m.user(name, role)

    # -- who is signed in --------------------------------------------------------------------------------------------
    def save(self, name: str, tunnel: bool = False) -> None:
        jar = self.m.client.session.cookie_jar.filter_cookies(self.m.client.make_url("/"))
        self.snap[name] = {k: v.value for k, v in jar.items()}
        self.tunnel[name] = tunnel

    async def sign_in(self, user: str, *, as_name: str | None = None, tunnel: bool = False, keep: bool = False) -> None:
        if not keep:
            self.m.forget_cookies()
        r, body = await self.m.sign_in(user, tunnel=tunnel)
        assert r.status == 200, body
        self.save(as_name or user, tunnel)

    def tunnel_session(self, user: str, name: str) -> None:
        """A person who came in through the tunnel with a passkey (a password alone needs a second factor there)."""
        issued = self.app["sessions"].create(self.uid[user], "tunnel", "passkey")
        self.m.forget_cookies()
        self.m.set_cookies(mantel_session=issued.access, mantel_csrf=issued.csrf)
        self.save(name, True)

    async def enroll_tablet(self, room: str = "hall", name: str = "Hallway tablet") -> str:
        """The Owner turns a browser into a wall tablet; ``self.snap['tablet']`` is that browser alone."""
        self.m.forget_cookies()
        r, body = await self.m.sign_in("avery")
        assert r.status == 200, body
        r = await self.m.post("/api/devices/enroll", {"name": name, "room": room})
        body = await r.json()
        assert r.status == 201, body
        self.tablet_id = body["device"]["id"]
        self.save("tablet")
        return self.tablet_id

    def use(self, name: str) -> None:
        self.m.forget_cookies()
        self.m.set_cookies(**self.snap[name])
        self.current = name

    # -- calls -----------------------------------------------------------------------------------------------------
    async def call(self, who: str, method: str, path: str, body=None, *, csrf: bool = True):
        self.use(who)
        h = self.m.headers(csrf=csrf, tunnel=self.tunnel.get(who, False))
        r = await self.m.client.request(method, path, json=body, headers=h)
        raw = await r.read()
        text = raw.decode("utf-8", "replace") if r.content_type != "image/jpeg" else ""
        self.bodies.append(text)
        if r.content_type == "image/jpeg":
            return r.status, raw
        try:
            return r.status, json.loads(text)
        except ValueError:
            return r.status, text

    async def get(self, who: str, path: str):
        return await self.call(who, "GET", path)

    async def find(self, who: str, query: str = ""):
        return await self.get(who, "/api/timeline" + (("?" + query) if query else ""))

    # -- the rows --------------------------------------------------------------------------------------------------
    def add(self, name: str, **kw) -> int:
        kw.setdefault("src", f"test:{name}")
        self.tl.push(Row(**kw))
        self.tl.flush()
        rid = self.db.execute("SELECT id FROM timeline_events WHERE src = ?", (kw["src"],)).fetchone()[0]
        self.rows[name] = rid
        return rid

    def add_pic(self, name: str, row: str, camera: str, data: bytes = JPEG) -> str:
        pid = self.app["timeline_pictures"].store(self.rows[row], camera, data)
        self.pics[name] = pid
        return pid

    def seed(self) -> None:
        """One row of each kind, newest last (so the ids run oldest to newest)."""
        t = self.now[0]
        self.tl.queue.clear()
        with self.db:
            self.db.execute("DELETE FROM timeline_events")          # (the start-up row of the alert center)
        tablet = self.tablet_id
        emma = self.uid["emma"]
        mark = self.uid["mark"]
        self.add("old_lock", at=t - 13 * 3600, family="lock", kind="locked", entity="lock.back_door", area="hall",
                 title="Back Door locked", search="back door locked hallway", how="hand_or_automation")
        self.add("lock", at=t - 3000, family="lock", kind="unlocked", entity="lock.back_door", area="hall",
                 title="Back Door unlocked", search="back door unlocked hallway", actor=emma, actor_name="Emma",
                 device=tablet, device_name="Hallway tablet", how="tablet", audit_id=7)
        self.add("door", at=t - 2900, family="door", kind="opened", entity="binary_sensor.back_door", area="hall",
                 title="Back Door opened", search="back door opened hallway", detail={"s": "on"})
        self.add("garage", at=t - 2800, family="garage", kind="opened", entity="cover.garage", area="drive",
                 title="Garage opened", search="garage opened driveway", actor=mark, actor_name="Mark", how="app",
                 audit_id=8)
        self.add("alarm", at=t - 2700, family="alarm", kind="disarmed", entity="alarm_control_panel.house",
                 area="hall", title="Alarm disarmed", search="alarm disarmed hallway", actor=emma, actor_name="Emma",
                 device=tablet, device_name="Hallway tablet", how="tablet", audit_id=9)
        self.add("arrival", at=t - 2600, family="arrival", kind="arrived", entity="person.emma",
                 title="Emma arrived home", search="arrived home", person=emma)
        self.add("stranger", at=t - 2500, family="arrival", kind="arrived", entity="person.visitor",
                 title="Visitor arrived home", search="arrived home", person=None)
        self.add("person", at=t - 2400, family="detection", kind="person", entity="camera.driveway", area="drive",
                 title="Person at Driveway Cam", search="person at driveway cam", detail={"sensor": "x"})
        self.add("ring", at=t - 2300, family="doorbell", kind="ring", entity="camera.hall", area="hall",
                 title="Someone rang Hall Cam", search="someone rang hall cam hallway")
        self.add("hall_person", at=t - 2200, family="detection", kind="person", entity="camera.hall", area="hall",
                 title="Person at Hall Cam", search="person at hall cam hallway")
        self.add("system", at=t - 2100, family="system", kind="raised", entity=None,
                 title="Backup finished", search="backup finished", detail={"alert": "backup.ok", "up": True})
        self.add("refused", at=t - 2000, family="refused", kind="disarm", entity="alarm_control_panel.house",
                 area="hall", level="warning", title="Hallway tablet tried to disarm Alarm; refused",
                 search="tried to disarm alarm refused", actor=emma, actor_name="Emma", device=tablet,
                 device_name="Hallway tablet", how="tablet", audit_id=10)
        self.add_pic("drive", "person", "camera.driveway")
        self.add_pic("hall", "ring", "camera.hall")
        self.add_pic("hall2", "hall_person", "camera.hall")

    def grant_child_the_page(self, name: str = "cody") -> None:
        """An Owner grants a Child the Timeline's page, and (to show that the role still wins) a view of everything
        the rows are about."""
        from mantel_server.rbac import Grant
        rb = self.app["rbac"]
        uid = self.uid[name]
        rb.add_grant(Grant(effect="allow", actions=("view",), resource_kind="feature", resource="timeline",
                           users={uid}))
        for eid in ("binary_sensor.back_door", "lock.back_door", "cover.garage", "alarm_control_panel.house",
                    "camera.driveway", "camera.hall"):
            rb.add_grant(Grant(effect="allow", actions=("view",), resource_kind="entity", resource=eid, users={uid}))
        for eid in ("person.emma", "person.visitor"):            # where someone was is `history` of the person too
            rb.add_grant(Grant(effect="allow", actions=("view", "history"), resource_kind="entity", resource=eid,
                               users={uid}))

    def names_of(self, events: list[dict]) -> set[str]:
        by_id = {v: k for k, v in self.rows.items()}
        return {by_id[e["id"]] for e in events if e["id"] in by_id}

    def audit_rows(self, prefix: str = "timeline.") -> list[tuple[str, dict]]:
        out = []
        for action, target in self.db.execute("SELECT action, target FROM action_audit WHERE kind = 'config' "
                                              "ORDER BY rowid"):
            if action and action.startswith(prefix):
                try:
                    out.append((action, json.loads(target) if target else {}))
                except ValueError:
                    out.append((action, {}))
        return out
