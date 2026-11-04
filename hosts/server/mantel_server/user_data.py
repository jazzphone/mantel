"""HK's per-person frontend user data, kept by Mantel (migration 0013).

In Home Assistant HK keeps a few preferences with ``frontend/set_user_data`` and follows them with
``frontend/subscribe_user_data`` (HA's per-user storage). Mantel reaches HA as the App's own account, so HA's
copy would be the wrong user's, and ``set_user_data`` would be a house command (refused with commands off).
Mantel answers both itself, for an allowlist of keys HK uses (KEYS; today ``hk_music_focus``, the speaker a
person picked on the Music page, ``favorites``, and ``intercom``, the Intercom sheet's mode and rooms):

* ``user_data_set`` {key, value} (a Mantel message, like ``music_used``) stores the value for the caller's own
  subject: ``u:<user id>`` for a signed-in person, ``d:<device id>`` for a wall tablet alone. Not a command:
  it works with commands off and nothing is forwarded to Home Assistant. A key not in KEYS, or a value that is
  not JSON of the right shape and under the key's size limit, is refused.
* ``frontend/subscribe_user_data`` {key} (a read route): the current value first (``{"value": null}`` when
  none), then an event on every change, so the same person's other screens follow. ``frontend/get_user_data``
  {key} answers ``{"value": ...}``. Neither reaches HA. A key not in KEYS is refused (HA is not asked).

Nobody reads or writes another subject's data: the subject is always the caller's own.
"""
from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Callable

from .connectors import Ctx, Forbidden, Route, read_routes, ws_handlers
from .readproxy import ReadBlocked

log = logging.getLogger("mantel.user_data")

ENTITY = re.compile(r"^[a-z_]+\.[a-z0-9_]+$")


def _music_focus(value: Any) -> bool:
    """hkMusic's focus: {key: <speaker key>, at: <epoch ms>} (hk-base.js)."""
    return (isinstance(value, dict) and set(value) <= {"key", "at"} and isinstance(value.get("key"), str)
            and 0 < len(value["key"]) <= 128 and ENTITY.match(value["key"]) is not None
            and (value.get("at") is None
                 or (isinstance(value["at"], (int, float)) and not isinstance(value["at"], bool))))


FAVORITES = "favorites"
FAVORITES_MAX = 64


def _favorites(value: Any) -> bool:
    """A person's favorites (docs/phase10/APPLE-APPS.md §7): entity ids in order, for the apps' widgets, Control
    Center, Siri and the Mac menu bar (app_api.py). No repeats, at most FAVORITES_MAX."""
    return (isinstance(value, list) and len(value) <= FAVORITES_MAX and len(set(value)) == len(value)
            and all(isinstance(v, str) and len(v) <= 128 and ENTITY.match(v) is not None for v in value))


INTERCOM = "intercom"
INTERCOM_ROOMS_MAX = 64
INTERCOM_MODES = ("message", "live")


def _intercom(value: Any) -> bool:
    """The Intercom sheet's memory for a person (docs/phase17/INTERCOM.md): {mode: "message"|"live", rooms: [speaker
    entity ids]}, the mode last used and the rooms last picked (at most INTERCOM_ROOMS_MAX, no repeats). Either may be
    left out."""
    if not isinstance(value, dict) or set(value) - {"mode", "rooms"}:
        return False
    if "mode" in value and value["mode"] not in INTERCOM_MODES:
        return False
    rooms = value.get("rooms", [])
    return (isinstance(rooms, list) and len(rooms) <= INTERCOM_ROOMS_MAX
            and all(isinstance(v, str) and len(v) <= 128 and ENTITY.match(v) is not None for v in rooms)
            and len(set(rooms)) == len(rooms))


def _switch(value: Any) -> bool:
    return isinstance(value, bool)


# the House Timeline's own switches in Me (docs/phase19/HOUSE-TIMELINE.md "Who sees what", "The morning digest"):
# Keep My Arrivals Private (an adult's; a child's is ignored: the Owner decides) and Morning Summary (the apps)
TIMELINE_PRIVATE = "timeline_private"
TIMELINE_SUMMARY = "timeline_summary"


# key -> (largest JSON text in bytes, shape check). Add a key here only when HK's code uses it, and to
# USER_DATA_KEYS in web/shim/mantel-client.js (a test pins the two lists together).
KEYS: dict[str, tuple[int, Callable[[Any], bool]]] = {
    "hk_music_focus": (512, _music_focus),
    FAVORITES: (FAVORITES_MAX * 132, _favorites),
    INTERCOM: (INTERCOM_ROOMS_MAX * 132 + 64, _intercom),
}
# (the two timeline switches are NOT socket keys: they change only through PUT /api/timeline/me, which refuses a
# tablet's session, writes the audit row first and deletes past arrivals -- Opus review 3)


class Refused(Exception):
    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


def subject_of(identity: Any) -> str | None:
    """``u:<id>`` for a person (also at a tablet), ``d:<id>`` for a tablet alone, None for nobody."""
    if identity is None or not getattr(identity, "valid", True):
        return None
    user, device = getattr(identity, "user", None), getattr(identity, "device", None)
    if user is not None:
        return f"u:{user.id}"
    if device is not None:
        return f"d:{device.id}"
    return None


class UserData:
    def __init__(self, db: Any, clock: Callable[[], float] = time.time) -> None:
        self.db = db
        self.clock = clock
        self.listeners: dict[tuple[str, str], set[Callable[[Any], None]]] = {}

    @staticmethod
    def check_key(key: Any) -> str:
        if not isinstance(key, str) or key not in KEYS:
            raise Refused("not_allowed", "that user data key is not kept by Mantel")
        return key

    def get(self, subject: str, key: str) -> Any:
        row = self.db.execute("SELECT value FROM user_data WHERE subject=? AND key=?", (subject, key)).fetchone()
        if row is None:
            return None
        try:
            return json.loads(row[0])
        except ValueError:
            return None

    def set(self, subject: str, key: str, value: Any) -> None:
        self.check_key(key)
        limit, shape = KEYS[key]
        try:
            text = json.dumps(value, separators=(",", ":"), allow_nan=False)
        except (TypeError, ValueError):
            raise Refused("invalid", "the value is JSON") from None
        if len(text.encode()) > limit:
            raise Refused("too_large", f"the value is larger than {limit} bytes")
        if value is not None and not shape(value):
            raise Refused("invalid", "that is not a value HK keeps under this key")
        with self.db:
            if value is None:
                self.db.execute("DELETE FROM user_data WHERE subject=? AND key=?", (subject, key))
            else:
                self.db.execute("INSERT INTO user_data (subject, key, value, updated) VALUES (?,?,?,?) "
                                "ON CONFLICT(subject, key) DO UPDATE SET value=excluded.value, updated=excluded.updated",
                                (subject, key, text, self.clock()))
        for cb in list(self.listeners.get((subject, key), ())):
            try:
                cb(value)
            except Exception:  # noqa: BLE001 -- one dead screen never stops the others
                log.exception("user data listener failed")

    def listen(self, subject: str, key: str, cb: Callable[[Any], None]) -> Callable[[], None]:
        self.listeners.setdefault((subject, key), set()).add(cb)

        def stop() -> None:
            subs = self.listeners.get((subject, key))
            if subs is not None:
                subs.discard(cb)
                if not subs:
                    del self.listeners[(subject, key)]
        return stop


def register(app, hub=None) -> UserData:
    data = UserData(app["store"].db)
    app["user_data"] = data

    def who(ctx: Ctx) -> str:
        subject = subject_of(ctx.identity)
        if subject is None:
            raise Forbidden("sign in first")
        return subject

    def key_of(msg: dict) -> str:
        if set(msg) - {"id", "type", "key"}:
            raise ReadBlocked(f"{msg.get('type')!r} carries key only")
        try:
            return data.check_key(msg.get("key"))
        except Refused as exc:
            raise ReadBlocked(str(exc)) from None

    async def user_data_set(ctx: Ctx, msg: dict) -> None:
        rid = msg.get("id")
        try:
            if set(msg) - {"type", "id", "key", "value"}:
                raise Refused("invalid", "user_data_set carries key and value only")
            subject = subject_of(ctx.identity)
            if subject is None:
                raise Refused("forbidden", "sign in first")
            data.set(subject, data.check_key(msg.get("key")), msg.get("value"))
        except Refused as exc:
            return await ctx.send({"type": "user_data_set_result", "id": rid,
                                   "error": {"code": exc.code, "message": str(exc)}})
        await ctx.send({"type": "user_data_set_result", "id": rid, "result": None})

    async def get(ctx: Ctx, msg: dict) -> dict:
        key = key_of(msg)
        return {"value": data.get(who(ctx), key)}

    async def subscribe(ctx: Ctx, msg: dict, on_event: Callable[[dict], None]):
        key = key_of(msg)
        subject = who(ctx)
        on_event({"value": data.get(subject, key)})
        stop = data.listen(subject, key, lambda value: on_event({"value": value}))

        async def unsubscribe() -> None:
            stop()
        # live.py: the principal is read again before this; still valid and still the same person or tablet
        unsubscribe.recheck = lambda: getattr(ctx.identity, "valid", True) is not False \
            and subject_of(ctx.identity) == subject                  # type: ignore[attr-defined]
        return unsubscribe

    read_routes(app).update({"frontend/get_user_data": Route(request=get),
                             "frontend/subscribe_user_data": Route(subscribe=subscribe)})
    ws_handlers(app).update({"user_data_set": user_data_set})
    return data
