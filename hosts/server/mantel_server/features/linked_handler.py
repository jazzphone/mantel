"""The linked handler: ``FeatureLinked`` is ``linked.py``'s hook (LINKED-MODE.md), the forwarded calls
(``set_black_screen``, the pop-ups, the backlight) acting on Mantel's screens."""
from __future__ import annotations

from collections import deque
import copy
import time
from typing import Any, TYPE_CHECKING

from hk_core.screensaver import rules as SS

from ..linked import LinkedError
from .settings import LOG_KEEP

if TYPE_CHECKING:
    from .host import FeatureHost


# ------------------------------------------------------------------------------------- linked
class FeatureLinked:
    """``linked.py``'s handler hook: the forwarded calls act on Mantel's screens (LINKED-MODE.md)."""

    def __init__(self, host: "FeatureHost") -> None:
        self.host = host
        self.calls: deque = deque(maxlen=LOG_KEEP)

    def _need_on(self) -> None:
        if not self.host.on("linked"):
            raise LinkedError("not_set_up", "linked mode's features are off in Mantel's feature settings")

    async def call_service(self, service: str, data: dict[str, Any], targets: list[dict[str, str]], ctx: Any) -> Any:
        self._need_on()
        self.calls.append({"at": time.time(), "service": service, "data": copy.deepcopy(data),
                           "targets": [t["entity_id"] for t in targets]})
        host = self.host
        if service in ("show_popup", "close_popup"):
            hash_ = str(data["popup"]).strip().lstrip("#").lower()
            if service == "show_popup":
                known = host.popup_hashes()
                if hash_ not in known:
                    raise LinkedError("unknown_popup", f"No pop-up #{hash_} in Mantel's pop-ups (known: "
                                      + (", ".join("#" + k for k in sorted(known)) or "none") + ")")
            event = {"type": "popup" if service == "show_popup" else "popup_close", "popup": hash_,
                     "dashboards": [str(d).strip("/") for d in data.get("dashboards") or []],
                     "users": [str(u) for u in data.get("users") or []]}
            return {"service": service, "popup": hash_, "screens": host.feed.send(event)}
        out = {}
        for t in targets:
            tid, key = host.linked_index.get(t["unique_id"], (None, None))
            if tid is None or key != SS.BLACK_KEY:
                raise LinkedError("not_a_black_screen", f"{t['entity_id']} is not a black screen switch")
            if not host.mantel_owns(tid):
                raise LinkedError("not_owned", f"{t['entity_id']}'s tablet is Home Assistant's, not Mantel's")
            on = await host.set_black(tid, black=data.get("black"), brightness=data.get("brightness"), why="linked")
            out[t["entity_id"]] = {"on": on}
        return out

    async def entity_command(self, unique_id: str, command: str, data: dict[str, Any], ctx: Any) -> Any:
        self._need_on()
        host = self.host
        self.calls.append({"at": time.time(), "command": command, "unique_id": unique_id})
        tid, key = host.linked_index.get(unique_id, (None, None))
        scr = host.screen(tid) if tid else None
        if scr is None or key not in (SS.BLACK_KEY, SS.SWITCH_KEY):
            raise LinkedError("not_supported", f"{command} is not handled by this Mantel Server yet")
        now_on = scr.black.on if key == SS.BLACK_KEY else scr.photos
        on = {"turn_on": True, "turn_off": False}.get(command, not now_on)
        if key == SS.BLACK_KEY:
            await host.set_black(tid, black=on, why="linked")
        else:
            await host.set_photos(tid, on)
        return {"on": on}

    async def page_says(self, unique_id: str, black: bool) -> bool:
        tid, _key = self.host.linked_index.get(unique_id, (None, None))
        return await self.host.page_says(tid, black) if tid else False
