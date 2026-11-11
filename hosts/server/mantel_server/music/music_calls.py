"""music.py's which music call a service or a socket message is (moved here by tools/split_py.py from hosts/server/mantel_server/music/__init__.py:
tools/split_py_manifests/music.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

from typing import Any
from hk_core.music.const import (COMMANDS, SERVICE_PLAY, SERVICE_PLAY_MEDIA, SERVICE_STOP, SERVICE_TRANSFER,
    SERVICE_TRANSPORT,)
from .music_names import DOMAIN, ENTITY, MUSIC_SERVICES, MUSIC_WS, PLAYER, TEXT_MAX


# ----------------------------------------------------------------------------------- the gateway's side
def _room_list(v: Any) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        v = [x.strip() for x in v.split(",") if x.strip()]
    if not isinstance(v, list) or not all(isinstance(x, str) and ENTITY.match(x) for x in v):
        from ..ha.gateway import Refused
        raise Refused("invalid_command", "rooms are media_player entity ids")
    return list(v)


def classify_service(domain: Any, service: Any, data: Any, target: Any, return_response: Any) -> Any:
    """``hk_frontend.music_*`` -> the gateway's Command, or None for any other service. Checks: ``control`` on
    feature ``music`` and on every room/player the call names (Stop All: every room, MusicHost.expand). The
    frame is HA's own call, sent to HA's engine when Mantel's is off."""
    if domain != DOMAIN or service not in MUSIC_SERVICES:
        return None
    from ..ha.gateway import Check, Command, Refused
    data = {} if data is None else data
    if not isinstance(data, dict) or target not in (None, {}) or not isinstance(return_response, bool):
        raise Refused("invalid_command", f"{DOMAIN}.{service} takes its fields in data")
    allowed = {SERVICE_PLAY: {"rooms", "playlist"}, SERVICE_TRANSFER: {"rooms", "source"}, SERVICE_STOP: {"rooms"},
               SERVICE_TRANSPORT: {"player", "command", "level"},
               SERVICE_PLAY_MEDIA: {"player", "media_content_id", "media_content_type"}}[service]
    if set(data) - allowed:
        raise Refused("invalid_command", f"{DOMAIN}.{service} carries {sorted(allowed)} only")
    args: dict[str, Any] = {}
    names: list[str] = []
    if "rooms" in allowed:
        args["rooms"] = _room_list(data.get("rooms")) if "rooms" in data or service != SERVICE_STOP else None
        if service != SERVICE_STOP and not args["rooms"]:
            raise Refused("invalid_command", "pick at least one speaker")
        names += args["rooms"] or []
    for k in ("source", "player"):
        if k in allowed:
            v = data.get(k)
            if not isinstance(v, str) or not ENTITY.match(v):
                raise Refused("invalid_command", f"{k} is a media_player entity id")
            args[k] = v
            names.append(v)
    if service == SERVICE_PLAY:
        if not isinstance(data.get("playlist"), str) or not 0 < len(data["playlist"]) <= TEXT_MAX:
            raise Refused("invalid_command", "playlist is a playlist's key")
        args["playlist"] = data["playlist"]
    if service == SERVICE_TRANSPORT:
        if data.get("command") not in COMMANDS:
            raise Refused("invalid_command", f"command is one of {list(COMMANDS)}")
        lv = data.get("level")
        if lv is not None and (isinstance(lv, bool) or not isinstance(lv, (int, float)) or not 0 <= lv <= 1):
            raise Refused("invalid_command", "level is 0..1")
        args.update(command=data["command"], level=lv)
    if service == SERVICE_PLAY_MEDIA:
        for k in ("media_content_id", "media_content_type"):
            if not isinstance(data.get(k), str) or not 0 < len(data[k]) <= 1000:
                raise Refused("invalid_command", f"{k} is a string")
            args[k] = data[k]
    action = f"{DOMAIN}.{service}"
    names = list(dict.fromkeys(names))
    checks = [Check("control", feature="music")] + [Check(action, n) for n in names]
    frame: dict = {"type": "call_service", "domain": DOMAIN, "service": service}
    if data:
        frame["service_data"] = data
    if return_response:
        frame["return_response"] = True
    return Command("service", action, checks, frame=frame, targets=names or ["feature:music"],
                   music={"op": service, "args": args, "return_response": return_response})


_WS_KEYS = {
    "hk_music/queue_play": ({"entity_id", "item_id"}, set()),
    "hk_music/used": (set(), set()),
    "hk_music/settings/set": ({"changes"}, set()),
    "hk_music/preset/save": ({"name", "members"}, {"item"}),
    "hk_music/playlist/save": ({"name", "items"}, {"item", "icon", "chooser", "order"}),
    "hk_music/playlists/order": ({"ids"}, set()),
    "hk_music/item/remove": ({"item"}, set()),
}


def classify_ws(inner: dict) -> Any:
    """An ``hk_music/*`` write -> the gateway's Command, or None. ``queue_play``: ``control`` on its player;
    ``used``: ``control`` on feature music; the settings writes: ``configure`` on settings (HA: require_admin)."""
    t = inner.get("type")
    if t not in MUSIC_WS:
        return None
    from ..ha.gateway import Check, Command, Refused
    need, may = _WS_KEYS[t]
    body = {k: v for k, v in inner.items() if k not in ("type", "id")}
    if need - set(body) or set(body) - need - may:
        raise Refused("invalid_command", f"{t} carries {sorted(need | may)}")
    names: list[str] = []
    if t == "hk_music/queue_play":
        if not isinstance(body["entity_id"], str) or not PLAYER.match(body["entity_id"]) \
                or not isinstance(body["item_id"], str) or not 0 < len(body["item_id"]) <= 200:
            raise Refused("invalid_command", "queue_play: a media_player entity_id and a queue item_id")
        names = [body["entity_id"]]
        checks = [Check("control", feature="music"), Check("media_player.play_media", body["entity_id"])]
    elif t == "hk_music/used":
        checks = [Check("control", feature="music")]
    else:
        checks = [Check("configure", feature="settings")]
    frame = {"type": t, **body}
    return Command("ws", t, checks, frame=frame, targets=names or [c.target for c in checks],
                   music={"op": t, "args": body, "return_response": True})
