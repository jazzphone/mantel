"""THE MUSIC PAGE'S QUEUE: one of Music Assistant's queue items, as the page reads it.

Reading the queue and playing from it are the host's (HA: features/music/__init__.py's
hk_music/queue and hk_music/queue_play, through the client its music_assistant integration
holds); the shape of a song is the same everywhere.
"""
from __future__ import annotations

from typing import Any

QUEUE_MAX = 100             # the most songs one read asks for


def item(it: Any) -> dict[str, Any]:
    """{id, title, artist, duration, image}: a queue item (a dict or a model object). `image` is
    a web address or None (MA's own image paths are not ones a screen can fetch)."""
    d = it if isinstance(it, dict) else (it.to_dict() if hasattr(it, "to_dict") else {})
    mi = d.get("media_item") or {}
    artists = mi.get("artists") or []
    img = d.get("image") or mi.get("image") or (mi.get("album") or {}).get("image")
    if isinstance(img, dict):
        img = img.get("path")
    return {"id": d.get("queue_item_id"), "title": mi.get("name") or d.get("name") or "",
            "artist": artists[0].get("name", "") if artists and isinstance(artists[0], dict) else "",
            "duration": d.get("duration"), "image": img if isinstance(img, str) and img.startswith("http") else None}
