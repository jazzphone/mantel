"""Announcements, for display only: which service calls speak on a player, and which players
the screens then hide until it is over.

Native HomePods don't label TTS in their state, so the call itself is the signal. The host
watches the calls and the players' states and keeps the markers and their timers (HA:
features/music/announcements.py); it also knows a player's physical twins (`aliases`: a
native player and its Music Assistant mirror), which it reads from its device registry.
Nothing here changes audio, player state, or an automation.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .config import MusicConfig

LIVE = ("playing", "paused", "buffering")


def ids(value: Any) -> list[str]:
    """A call's entity ids: a comma-separated string or a list."""
    if isinstance(value, str):
        return [v.strip() for v in value.split(",") if v.strip()]
    return [v for v in value if isinstance(v, str)] if isinstance(value, (list, tuple)) else []


def content(state: Any) -> tuple[Any, Any, Any] | None:
    """What a player is playing (content id, title, artist), or None when it is not."""
    if state is None or state.state not in LIVE:
        return None
    a = state.attributes
    value = (a.get("media_content_id"), a.get("media_title"), a.get("media_artist"))
    return value if any(value) else None


def released(domain: Any, service: Any, args: Mapping[str, Any]) -> list[str]:
    """The players an explicit ordinary play names: their pending markers end."""
    if domain == "media_player" and service in ("play_media", "media_play") and args.get("announce") is not True:
        return ids(args.get("entity_id"))
    return []


def announced(domain: Any, service: Any, args: Mapping[str, Any]) -> list[str]:
    """The players a call speaks on: TTS (speak, or a *_say), an announce play, or Music
    Assistant's play_announcement."""
    if domain == "tts":
        if service == "speak":
            return ids(args.get("media_player_entity_id"))
        if service.endswith("_say"):
            return ids(args.get("entity_id"))
        return []
    if ((domain == "media_player" and service == "play_media" and args.get("announce") is True)
            or (domain == "music_assistant" and service == "play_announcement")):
        return ids(args.get("entity_id"))
    return []


def hidden(cfg: MusicConfig, source: str, aliases: set[str]) -> set[str] | None:
    """The players an announcement on `source` hides: its twins and, for a preset's sync group,
    its rooms. None when it is not a media player or touches none of the house's players."""
    if not source.startswith("media_player."):
        return None
    players = set(aliases)
    preset = cfg.preset_for_group(source)
    if preset:
        players.update(preset.members)
    if not players.intersection(cfg.players()):
        return None
    return players
