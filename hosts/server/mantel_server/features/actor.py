"""Who a feature acts as and what it talks to: the screens' event ``Feed``, a tablet's ``ScreenState``, the
Service actor (``FeatureAuthz``, ``FeatureGateway``, ``FeatureCaller``: a feature's own house command goes through
the same gateway code path as a person's) and the ``OverlayHouse`` the Sleep Screen engines read."""
from __future__ import annotations

from collections import deque
import copy
from dataclasses import dataclass, field, replace
from datetime import datetime
import logging
import re
import time
from typing import Any, Callable, Mapping

from aiohttp import web
from hk_core.house import State
from hk_core.screensaver.black import Black

from .. import gateway as G
from ..house import HouseCommandRefused, HouseCommandsDisabled, MantelHouse
from .settings import FEATURE_ACTOR, FEATURE_ACTOR_NAME, LOG_KEEP

log = logging.getLogger("mantel.features")

def _slug(name: str, fallback: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name or "").lower()).strip("_") or fallback


def _user_keys(identity: Any) -> set[str]:
    """The ids a notification's / pop-up's ``users`` may name this viewer by (Mantel's id, the linked
    HA user's id, the username)."""
    u = getattr(identity, "user", None)
    keys = {k for k in (getattr(u, "id", None), getattr(u, "ha_user_id", None), getattr(u, "username", None)) if k}
    if u is None:
        # a wall tablet that is its own HA user (HA App mode, ingress.py): a frame naming that HA user
        # reaches it, as HA's feed reached the tablet signed in as that user
        d = getattr(identity, "device", None)
        keys |= {k for k in (getattr(d, "ha_user_id", None), getattr(d, "ha_name", None)) if k}
    return keys


# ------------------------------------------------------------------------------------ the feed
class Feed:
    """``hk_frontend/events/subscribe`` on Mantel: what the house asks the screens to do (pop-ups,
    notifications, and Mantel's own ``screen`` frames), sent to every listening screen. A frame
    naming ``users`` goes only to those people's sockets, as HA's feed does."""

    def __init__(self) -> None:
        self._subs: dict[int, tuple[Any, Callable[[dict], None]]] = {}
        self._n = 0
        self.sent: deque = deque(maxlen=LOG_KEEP)
        self.taps: list[Callable[[dict], None]] = []   # every frame, besides the screens (push.py: phones)

    def subscribe(self, identity: Any, on_event: Callable[[dict], None]) -> Callable[[], None]:
        self._n += 1
        sid = self._n
        self._subs[sid] = (identity, on_event)
        return lambda: self._subs.pop(sid, None) and None

    @property
    def listeners(self) -> int:
        return len(self._subs)

    def send(self, event: dict) -> int:
        users = event.get("users") or []
        n = 0
        for identity, cb in list(self._subs.values()):
            if users and not (_user_keys(identity) & set(users)):
                continue
            try:
                cb(event)
                n += 1
            except Exception:  # noqa: BLE001 -- one closed screen never stops the others
                log.exception("a screen's event listener failed")
        for tap in list(self.taps):
            try:
                tap(event)
            except Exception:  # noqa: BLE001 -- a push failure never stops the screens'
                log.exception("a feed tap failed")
        self.sent.append({"type": event.get("type"), "at": time.time(), "screens": n,
                          **{k: event.get(k) for k in ("popup", "tablet", "title", "item", "entity") if event.get(k)}})
        return n


@dataclass
class ScreenState:
    """One wall tablet's screen as Mantel holds it: its black (hk_core's ``Black``), its photos, the
    page's last touch and the screensaver's own last touch, and whether it is in use."""
    tid: str
    black: Black = field(default_factory=Black)
    photos: bool = False
    touch: datetime | None = None
    saver_touch: datetime | None = None
    in_use: bool = False


# ------------------------------------------------------------------------- the Service actor
class FeatureAuthz:
    """The app's ``Authz`` with the features' computed grants added for the Service actor only."""

    def __init__(self, base: Any, grants: Callable[[], set[str]]) -> None:
        self.base, self._grants = base, grants

    def __getattr__(self, name: str) -> Any:
        return getattr(self.base, name)

    def policy_for(self, subject: Any) -> Any:
        from ..identity.rbac import Grant
        policy = self.base.policy_for(subject)
        if subject.user_id != FEATURE_ACTOR:
            return policy
        extra = tuple(Grant(effect="allow", actions=("control",), resource_kind="entity", resource=eid,
                            users={FEATURE_ACTOR}, note="Mantel features: an entity an enabled feature acts on")
                      for eid in sorted(self._grants()))
        return replace(policy, grants=tuple(policy.grants) + extra)

    def decide(self, subject: Any, action: str, entity_id: str | None, *, feature: str | None = None,
               ctx: Any = None) -> Any:
        return self.policy_for(subject).decide(subject, action, entity_id, ctx or self.base.context(), feature=feature)


class FeatureGateway(G.Gateway):
    """``gateway.Gateway`` itself, sharing the app's audit and its command connection (read at each
    call, so the app's commander -- or none, while commands are off -- is always the one used)."""

    @property
    def commander(self) -> Any:
        gw = self.app.get("gateway")
        return gw.commander if gw is not None else self.app.get("commander")

    @commander.setter
    def commander(self, _value: Any) -> None:
        pass


class FeatureCaller:
    """``MantelHouse.caller``: every service call a feature makes, through the gateway. ``context`` is
    a person's ``Principal`` (Clean Areas: that person's own rights) or a label ("sleep:hall") for
    the Service actor. Every attempt is kept in ``log`` with its outcome: sent / would / refused."""

    def __init__(self, app: web.Application, grants: Callable[[], set[str]]) -> None:
        self.app = app
        self._grants = grants
        self._gw: FeatureGateway | None = None
        self._actor = None
        self._n = 0
        self.log: deque = deque(maxlen=LOG_KEEP)

    def gateway(self) -> FeatureGateway | None:
        if self._gw is None:
            authz, audit = self.app.get("authz"), self.app.get("audit")
            if authz is None or audit is None:
                return None
            gw = self.app.get("gateway")
            writes = gw.writes if gw is not None else G.load_writes()
            self._gw = FeatureGateway(self.app, FeatureAuthz(authz, self._grants), audit, None, writes,
                                      lambda: self.app["clock"]())
        return self._gw

    def actor(self) -> Any:
        from ..identity.authz import Principal
        from ..identity.sessions import Identity, User
        if self._actor is None:
            ident = Identity(user=User(id=FEATURE_ACTOR, name=FEATURE_ACTOR_NAME, role="service", kind="service"),
                             device=None, door="lan")
            authz = self.app["authz"]
            self._actor = Principal(ident, authz.subject_of(ident))
        return self._actor

    async def __call__(self, domain: str, service: str, data: Mapping[str, Any], context: Any = None,
                       response: bool = False) -> Any:
        from ..identity.authz import Principal
        gw = self.gateway()
        person = isinstance(context, Principal)
        entry = {"at": time.time(), "action": f"{domain}.{service}", "data": copy.deepcopy(dict(data)),
                 "as": "person" if person else FEATURE_ACTOR, "why": None if person else context}
        self.log.append(entry)
        if gw is None:
            entry["outcome"] = "would"
            raise HouseCommandsDisabled("no command gateway in this app; nothing was sent")
        self._n += 1
        msg = {"type": "command", "id": self._n, "kind": "service", "domain": domain, "service": service,
               "data": dict(data)}
        if response:
            # a call that answers (todo.get_items): the same command, its answer asked for
            msg["return_response"] = True
        got: dict = {}

        async def send(reply: dict) -> None:
            got.update(reply)
        await gw.handle(context if person else self.actor(), msg, send)
        entry["audit_id"] = got.get("audit_id")
        if "result" in got:
            entry["outcome"] = "sent"
            return got["result"]
        err = got.get("error") or {}
        if err.get("code") == "unavailable" and err.get("message") == "commands_disabled":
            entry["outcome"] = "would"
            raise HouseCommandsDisabled(audit_id=got.get("audit_id"))
        entry["outcome"], entry["code"] = "refused", err.get("code") or "failed"
        raise HouseCommandRefused(entry["code"], err.get("message") or "", got.get("audit_id"))


class OverlayHouse:
    """The House with Mantel's own tablet entities (photos, black, in use) laid over it: what the Sleep
    Screen reads of them comes from Mantel's screens, everything else from the hub."""

    def __init__(self, house: MantelHouse, own: Callable[[str], State | None]) -> None:
        self._house, self._own = house, own

    def __getattr__(self, name: str) -> Any:
        return getattr(self._house, name)

    def state(self, entity_id: str) -> State | None:
        s = self._own(entity_id)
        return s if s is not None else self._house.state(entity_id)
