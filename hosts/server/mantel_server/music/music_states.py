"""THE SPEAKERS' STATES FROM MUSIC ASSISTANT (2026-10-31): with Music Assistant connected to Mantel, nothing about
music goes through Home Assistant -- the owner: "If Mantel has a direct connection to Music Assistant, nothing should
route through Home Assistant for it to work."

Until now a speaker's state (playing, what plays, its volume, its group, its cover) was HA's ``media_player`` state,
which HA's ``music_assistant`` integration builds from Music Assistant. While HA restarted those went unavailable and
every Music card, the Side Pane and the screensaver read "?". So, while Music Assistant is configured in Mantel:

* **Mantel keeps Music Assistant's players and queues itself** (``players/all`` and ``player_queues/all`` at every
  connect, then MA's ``player_*`` / ``queue_*`` events) and builds each speaker's state from them, in exactly the
  shape HA's integration gives it (``ha_state``: homeassistant/components/music_assistant/media_player.py, 2026.10),
  under the same ``media_player`` entity id. The pages, the iOS app, RBAC, the rooms and the engine's waits read it
  where they read HA's.
* **It is an overlay that always wins** (live_tv.LocalEntities): whatever HA says about one of these ids -- going
  unavailable as it stops, a reconnect's whole new list -- is put back in the same callback, before any page's view
  or engine wait reads it (``register``: the reassert runs before the rest of the hub's change chain).
* **The cover is Music Assistant's** (``entity_picture``: MA's image address, as HA's integration gives it) and the
  address the pages draw (``entity_picture_local``) is Mantel's own ``/api/media/<entity>/art``, which fetches that
  image from Music Assistant (media_art.py), never from HA's media proxy.
* **Which entity is which player**: the entity registry's ``music_assistant`` entries (music.ma_players), Mantel's
  copy, which outlives an HA restart. A speaker's name is HA's last ``friendly_name`` for it, else MA's.
* **Music Assistant away**: the last states stay for ``GRACE`` seconds (MA restarting), then read ``unavailable``.
  Music Assistant removed from Mantel (Connections): the overlay goes and HA's states come back.

Without Music Assistant in Mantel nothing here runs: HA's states are the speakers' states, as before (and HK
Frontend inside HA is not touched by any of this).
"""
from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from typing import Any

from ..connectors import camera_still

log = logging.getLogger("mantel.music.states")

GRACE = 60.0            # seconds Music Assistant may be away before its speakers read unavailable
CHECK_EVERY = 5.0       # how often the connection is looked at
EVENTS = ("player_added", "player_updated", "player_removed", "queue_added", "queue_updated", "mantel_reconnected")

# HA's MediaPlayerEntityFeature bits, and the music_assistant integration's base set (SUPPORTED_FEATURES_BASE)
PAUSE, SEEK, VOLUME_SET, VOLUME_MUTE, PREVIOUS_TRACK, NEXT_TRACK = 1, 2, 4, 8, 16, 32
TURN_ON, TURN_OFF, PLAY_MEDIA, VOLUME_STEP, SELECT_SOURCE, STOP = 128, 256, 512, 1024, 2048, 4096
CLEAR_PLAYLIST, PLAY, SHUFFLE_SET, SELECT_SOUND_MODE, BROWSE_MEDIA = 8192, 16384, 32768, 65536, 131072
REPEAT_SET, GROUPING, MEDIA_ANNOUNCE, MEDIA_ENQUEUE, SEARCH_MEDIA = 262144, 524288, 1048576, 2097152, 4194304
FEATURES_BASE = (STOP | PREVIOUS_TRACK | NEXT_TRACK | SHUFFLE_SET | REPEAT_SET | PLAY | PLAY_MEDIA | CLEAR_PLAYLIST
                 | BROWSE_MEDIA | SEARCH_MEDIA | MEDIA_ENQUEUE | MEDIA_ANNOUNCE | SEEK | PAUSE)
NO_CONTROL = "none"
REPEAT = {"off": "off", "one": "one", "all": "all"}
ICONS = {"bluetooth": "mdi:bluetooth", "car": "mdi:car", "cast": "mdi:cast", "headphones": "mdi:headphones",
         "laptop": "mdi:laptop", "monitor": "mdi:monitor", "radio": "mdi:radio", "smartphone": "mdi:cellphone",
         "soundbar": "mdi:soundbar", "speaker": "mdi:speaker", "speakers": "mdi:speaker-multiple",
         "sun": "mdi:white-balance-sunny", "tablet": "mdi:tablet", "tv": "mdi:television", "vinyl": "mdi:record-player"}


def icon_of(icon: Any) -> str:
    """HA's _get_mdi_icon: Music Assistant's icon name as an mdi one."""
    if not isinstance(icon, str):
        return "mdi:speaker"
    if icon.startswith("mdi:"):
        return icon
    if icon.startswith("mdi-"):
        return icon.replace("mdi-", "mdi:", 1)
    return ICONS.get(icon, "mdi:speaker")


def art_path(entity_id: str, image: str) -> str:
    """The address a page draws a speaker's cover from: Mantel's own route (media_art.py; the page's prefix is added
    there), versioned by the image so a new track is a new picture."""
    return f"/api/media/{entity_id}/art?v={camera_still.version_of(image)}"


def _features(p: Mapping[str, Any]) -> int:
    got = FEATURES_BASE
    supported = p.get("supported_features") or []
    if "set_members" in supported:
        got |= GROUPING
    if p.get("mute_control", NO_CONTROL) != NO_CONTROL:
        got |= VOLUME_MUTE
    if p.get("volume_control", NO_CONTROL) != NO_CONTROL:
        got |= VOLUME_STEP | VOLUME_SET
    if p.get("power_control", NO_CONTROL) != NO_CONTROL:
        got |= TURN_ON | TURN_OFF
    if "select_source" in supported:
        got |= SELECT_SOURCE
    if "select_sound_mode" in supported:
        got |= SELECT_SOUND_MODE
    return got


def _iso(ts: Any) -> str | None:
    if isinstance(ts, bool) or not isinstance(ts, (int, float)):
        return None
    return datetime.fromtimestamp(float(ts), timezone.utc).isoformat()


def _queue_image(queue: Mapping[str, Any] | None) -> str | None:
    """The queue's current item's picture when the player has none of its own: an address on the internet only (a
    file path inside Music Assistant is not one a page or Mantel could fetch)."""
    item = (queue or {}).get("current_item") or {}
    for img in (item.get("image"), (item.get("media_item") or {}).get("image")):
        path = img.get("path") if isinstance(img, Mapping) else img
        if isinstance(path, str) and path.startswith(("https://", "http://")):
            return path
    return None


def ha_state(entity_id: str, p: Mapping[str, Any], players: Mapping[str, Mapping[str, Any]],
             queues: Mapping[str, Mapping[str, Any]], entity_of: Mapping[str, str], name: str | None
             ) -> tuple[str, dict[str, Any]]:
    """One Music Assistant player as HA's music_assistant integration shows it: (state, attributes)."""
    friendly = name or p.get("display_name") or p.get("name") or entity_id
    feats = _features(p)
    base = {"friendly_name": friendly, "icon": icon_of(p.get("icon")), "device_class": "speaker",
            "supported_features": feats}
    if p.get("available") is False or p.get("enabled") is False:
        return "unavailable", base
    playback = p.get("playback_state") or p.get("state")
    state = str(playback) if p.get("powered", True) and playback is not None else "off"
    if state not in ("playing", "paused", "idle", "off"):
        state = "idle"
    queue = queues.get(p.get("active_source") or "") if p.get("active_source") else None
    attrs: dict[str, Any] = {}
    if feats & GROUPING:
        members = p.get("group_members") or []
        if not members and p.get("synced_to"):
            members = (players.get(p["synced_to"]) or {}).get("group_members") or []
        attrs["group_members"] = [entity_of[m] for m in members if m in entity_of]
    attrs.update({"mass_player_type": p.get("type") or "player", "active_queue": queue.get("queue_id") if queue else None})
    if state == "off":
        return state, {**attrs, **base}
    volume = p.get("group_volume") if p.get("type") == "group" else p.get("volume_level")
    media = p.get("current_media") if isinstance(p.get("current_media"), Mapping) else None
    sources = [s for s in p.get("source_list") or [] if isinstance(s, Mapping)]
    active_source = next((s.get("name") for s in sources if s.get("id") == p.get("active_source")), None)
    have = {
        "volume_level": volume / 100 if isinstance(volume, (int, float)) and not isinstance(volume, bool) else None,
        "is_volume_muted": p.get("volume_muted"),
        "media_content_id": (media or {}).get("uri"),
        "media_content_type": "music",
        "media_duration": (media or {}).get("duration"),
        "media_position": None, "media_position_updated_at": None,
        "media_title": (media or {}).get("title"),
        "media_artist": (media or {}).get("artist"),
        "media_album_name": (media or {}).get("album"),
        "media_album_artist": (media or {}).get("album_artist"),
        "app_id": "music_assistant" if queue is not None else p.get("active_source"),
        "source": active_source,
        # (HA lists the sources only for a player that can select one)
        "source_list": [s.get("name") for s in sources if not s.get("passive")] or None if feats & SELECT_SOURCE
        else None,
        "shuffle": queue.get("shuffle_enabled") if queue is not None else None,
        "repeat": REPEAT.get(queue.get("repeat_mode")) if queue is not None else None,
    }
    if media is not None and isinstance(media.get("elapsed_time"), (int, float)):
        have["media_position"] = int(media["elapsed_time"])
        have["media_position_updated_at"] = _iso(media.get("elapsed_time_last_updated"))
    attrs.update({k: v for k, v in have.items() if v is not None})
    image = (media or {}).get("image_url") if isinstance((media or {}).get("image_url"), str) else _queue_image(queue)
    if image:
        attrs["entity_picture"] = image
        attrs["entity_picture_local"] = art_path(entity_id, image)
    return state, {**attrs, **base}


class MusicStates:
    """``app["music"].states``: Music Assistant's players and queues, put into the hub's StateStore as the speakers'
    ``media_player`` states while Music Assistant is configured in Mantel (the module docstring)."""

    def __init__(self, app: Any, hub: Any, entities: Callable[[], dict[str, str]],
                 notify: Callable[[set[str]], None], clock: Callable[[], float] = time.monotonic) -> None:
        from ..cameras.live_tv import LocalEntities
        self.app, self.hub = app, hub
        self.entities = entities                # {media_player entity: MA player id} (music.ma_players)
        self.notify = notify                    # the hub's change chain, for the ids this changed
        self.clock = clock
        self.local = LocalEntities(hub)
        self.players: dict[str, dict] = {}
        self.queues: dict[str, dict] = {}
        self.names: dict[str, str] = {}         # HA's last friendly_name of each speaker
        self.ha_seen: dict[str, dict] = {}      # HA's last state of each, put back when the overlay lets it go
        self.loaded = False                     # Music Assistant read at least once since it was configured
        self.lost_at: float | None = None       # when the connection went (None: up, or never seen)
        self.events = 0
        self._stop: Callable[[], None] | None = None
        self._task: asyncio.Task | None = None

    @property
    def ma(self) -> Any:
        return self.app.get("ma")

    # -- following Music Assistant --------------------------------------------------------------------------
    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.get_running_loop().create_task(self._run())

    async def stop(self) -> None:
        if self._stop is not None:
            self._stop()
            self._stop = None
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    def connection_changed(self) -> None:
        """Music Assistant was connected, moved or removed (connections.py): follow the new client, or drop the
        overlay so HA's states come back."""
        if self._stop is not None:
            self._stop()
            self._stop = None
        self.players, self.queues, self.loaded, self.lost_at = {}, {}, False, None
        self.sync()
        if self._task is not None and not self._task.done():      # follow the new client now, not at the next tick
            self._task.cancel()
            self._task = None
            self.start()

    async def _run(self) -> None:
        while True:
            try:
                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 -- one bad read never ends the follow
                log.exception("music: Music Assistant's players could not be followed")
            await asyncio.sleep(CHECK_EVERY)

    async def _tick(self) -> None:
        client = self.ma
        if client is None:
            return
        if self._stop is None:
            self._stop = client.subscribe(self._event, EVENTS)
        if not client.connected.is_set():
            now = self.clock()
            if self.lost_at is None and self.loaded:
                self.lost_at = now
            elif self.lost_at is not None and now - self.lost_at >= GRACE:
                self.sync()             # the grace is over: the speakers read unavailable
            try:
                await asyncio.wait_for(client.connected.wait(), CHECK_EVERY)
            except asyncio.TimeoutError:
                return
        if self.lost_at is not None or not self.loaded:
            await self.reload()

    async def reload(self) -> None:
        """Every player and queue, read again (a connect; events were missed while away)."""
        client = self.ma
        if client is None:
            return
        players, queues = await client.players(), await client.queues()
        if not isinstance(players, list) or not isinstance(queues, list):
            return
        self.players = {p["player_id"]: p for p in players if isinstance(p, dict) and isinstance(p.get("player_id"), str)}
        self.queues = {q["queue_id"]: q for q in queues if isinstance(q, dict) and isinstance(q.get("queue_id"), str)}
        self.loaded, self.lost_at = True, None
        self.sync()

    def _event(self, ev: dict) -> None:
        kind, oid, data = ev.get("event"), ev.get("object_id"), ev.get("data")
        self.events += 1
        if kind == "mantel_reconnected":
            asyncio.get_running_loop().create_task(self.reload())
            return
        if kind == "player_removed":
            self.players.pop(oid or "", None)
        elif kind in ("player_added", "player_updated") and isinstance(data, dict):
            pid = data.get("player_id") or oid
            if isinstance(pid, str):
                self.players[pid] = data
        elif kind in ("queue_added", "queue_updated") and isinstance(data, dict):
            qid = data.get("queue_id") or oid
            if isinstance(qid, str):
                old = self.queues.get(qid) or {}
                self.queues[qid] = {**old, **data}
        else:
            return
        if self.loaded:
            self.sync()

    # -- the overlay -------------------------------------------------------------------------------------------
    @property
    def on(self) -> bool:
        """The overlay applies: Music Assistant is configured in Mantel and has been read."""
        return self.ma is not None and self.loaded

    def owns(self, entity_id: str) -> bool:
        return entity_id in self.local.mine

    def image(self, entity_id: str) -> str | None:
        """Music Assistant's picture for a speaker the overlay holds (media_art.py fetches it), else None."""
        st = self.local.mine.get(entity_id)
        pic = ((st or {}).get("a") or {}).get("entity_picture")
        return pic if isinstance(pic, str) else None

    def wanted(self) -> dict[str, tuple[str, dict[str, Any]]]:
        if not self.on:
            return {}
        ent = self.entities()
        entity_of = {pid: eid for eid, pid in ent.items()}
        away = self.lost_at is not None and self.clock() - self.lost_at >= GRACE
        out: dict[str, tuple[str, dict[str, Any]]] = {}
        store = self.hub.store.states
        for eid, pid in ent.items():
            ha = store.get(eid)
            if ha is not None and ha is not self.local.mine.get(eid):
                self._learn(eid, ha)
            p = self.players.get(pid)
            if p is None or away:
                p = {"player_id": pid, "available": False}
            out[eid] = ha_state(eid, p, self.players, self.queues, entity_of, self.names.get(eid))
        return out

    def _learn(self, eid: str, ha: Mapping[str, Any]) -> None:
        self.ha_seen[eid] = dict(ha)
        name = (ha.get("a") or {}).get("friendly_name")
        if isinstance(name, str) and name and ha.get("s") != "unavailable":
            self.names[eid] = name

    def sync(self) -> set[str]:
        want = self.wanted()
        gone = set(self.local.mine) - set(want)
        changed = self.local.put_all(want)
        for eid in gone:                    # no longer ours: HA's own state again, as it last gave it
            if eid in self.ha_seen:
                self.hub.store.states[eid] = self.ha_seen[eid]
        if changed:
            self.notify(changed)
        return changed

    def reassert(self, changed: set[str]) -> None:
        """HA said something about one of our speakers: learn its name, then put ours back (no notice: the chain this
        runs at the head of carries the same ids on to everything that reads them)."""
        store = self.hub.store.states
        for eid in changed & set(self.local.mine):
            ha = store.get(eid)
            if ha is not None and ha is not self.local.mine[eid]:
                self._learn(eid, ha)
        self.local.reassert(set(changed))
        # (the speakers' list walks every registry entry: asked only for a batch with a media player not ours, never
        # on every batch -- it was most of the hub's time on an ordinary state change, 2026-11-13)
        media = {e for e in changed if e.startswith("media_player.") and e not in self.local.mine}
        if media and self.on and media & set(self.entities()):
            self.local.put_all(self.wanted())       # a speaker HA just added (the registry reloaded first)

    def status(self) -> dict[str, Any]:
        return {"on": self.on, "players": len(self.players), "queues": len(self.queues), "speakers": len(self.local.mine),
                "events": self.events, "away_s": None if self.lost_at is None else round(self.clock() - self.lost_at)}
