"""BROWSE'S TREE AND SEARCH FROM MUSIC ASSISTANT (2026-10-31; music_states.py's companion).

HK's library card walks Music Assistant's library with HA's ``media_player/browse_media`` (an album's songs, an
artist's albums, a playlist's songs, each library list) and searches it with ``media_player/search_media``, which HA's
``music_assistant`` integration answers from Music Assistant (homeassistant/components/music_assistant/
media_browser.py, 2026.10). While Music Assistant is connected to Mantel, Mantel answers both itself, from Music
Assistant's own reads (connectors/ma.py MA_READS), in exactly the shape HA's answer has (``BrowseMedia.as_dict``,
``SearchMedia.as_dict``), so the card is unchanged and nothing about it goes through HA.

The one thing left out is HA's own media folders (``media-source://``), which HA's integration adds to the root:
they are Home Assistant's, not music's. A ``media-source://`` id is still HA's to answer (music.py sends it on).

A picture is Music Assistant's image proxy on its own address (or the artwork's web address), as HA gives it; the
page has Mantel fetch and scale it (``/api/media/art``, media_art.py), so a tablet needs no route to Music Assistant.
"""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from urllib.parse import urlsplit

from .connectors.ma import ws_url_of

TITLE = "Music Assistant"
LIBRARIES = {  # HA's id -> (title, its children's class, MA's library command, MA's media type)
    "artists": ("Artists", "artist", "artists", "artist"),
    "albums": ("Albums", "album", "albums", "album"),
    "tracks": ("Tracks", "track", "tracks", "track"),
    "playlists": ("Playlists", "playlist", "playlists", "playlist"),
    "radio": ("Radio stations", "music", "radios", "radio"),
    "podcasts": ("Podcasts", "podcast", "podcasts", "podcast"),
    "audiobooks": ("Audiobooks", "directory", "audiobooks", "audiobook"),
}
LIBRARY_TYPE = {"artists": "artist", "albums": "album", "tracks": "track", "playlists": "playlist",
                "radio": "music_assistant", "podcasts": "podcast", "audiobooks": "music_assistant"}
SEARCHABLE = ["artist", "album", "track", "playlist", "radio", "audiobook", "podcast"]
ARTIST_TYPES = ["album", "track"]
WITHIN = ("album", "artist", "playlist")
CLASS_TYPES = {"artist": ["artist"], "album": ["album"], "track": ["track"], "playlist": ["playlist"],
               "music": ["artist", "album", "track", "playlist"], "directory": ["audiobook"], "podcast": ["podcast"]}
RESULT_KEYS = {"artist": "artists", "album": "albums", "track": "tracks", "playlist": "playlists",
               "radio": "radio", "podcast": "podcasts", "audiobook": "audiobooks"}
CLASS_OF = {"artist": "artist", "album": "album", "track": "track", "playlist": "playlist", "radio": "music",
            "podcast": "podcast", "audiobook": "directory"}
PAGE = 500
SEARCH_LIMIT = 5
THUMB = 256


class BrowseError(LookupError):
    """HA's BrowseError: nothing at that id (the page shows it as the read's error)."""


def base_of(client: Any) -> str:
    """Music Assistant's own address (``http://host:8095``): its greeting's ``base_url``, else the client's."""
    got = (getattr(client, "server_info", None) or {}).get("base_url")
    if isinstance(got, str) and got.startswith(("http://", "https://")):
        return got.rstrip("/")
    u = urlsplit(ws_url_of(getattr(client, "ws_url", "")).replace("ws", "http", 1))
    return f"{u.scheme}://{u.netloc}"


def image(item: Mapping[str, Any], base: str) -> str | None:
    """The address of an item's picture, as HA's integration gives it (``get_media_item_image_url``)."""
    img = item.get("image")
    if img is None:
        imgs = (item.get("metadata") or {}).get("images") if isinstance(item.get("metadata"), Mapping) else None
        ranked = sorted((i for i in imgs or [] if isinstance(i, Mapping)), key=lambda i: i.get("type") != "thumb")
        img = ranked[0] if ranked else None
    if isinstance(img, str):
        return img if img.startswith(("https://", "http://")) else None
    if not isinstance(img, Mapping) or not isinstance(img.get("path"), str):
        return None
    path = img["path"]
    if img.get("remotely_accessible") is True and path.startswith(("https://", "http://")):
        return path
    pid = img.get("proxy_id")
    if isinstance(pid, str) and pid:
        return f"{base}/imageproxy/{pid}?size={THUMB}"
    return path if path.startswith(("https://", "http://")) else None


def node(title: str, media_class: str, cid: str, ctype: str, *, can_play: bool, can_expand: bool,
         can_search: bool = False, thumbnail: str | None = None, children_media_class: str | None = None,
         children: list[dict] | None = None, search_media_classes: list[str] | None = None) -> dict[str, Any]:
    """HA's BrowseMedia.as_dict."""
    out: dict[str, Any] = {"title": title, "media_class": media_class, "media_content_type": ctype,
                           "media_content_id": cid, "children_media_class": children_media_class,
                           "can_play": can_play, "can_expand": can_expand, "can_search": can_search,
                           "thumbnail": thumbnail, "not_shown": 0}
    if search_media_classes is not None:
        out["search_media_classes"] = search_media_classes
    if children is not None:
        out["children"] = children
    return out


def item(it: Mapping[str, Any], base: str, can_expand: bool = True, media_class: str | None = None) -> dict:
    """HA's build_item."""
    artists = [a for a in it.get("artists") or [] if isinstance(a, Mapping)]
    name = str(it.get("name") or "")
    title = f"{artists[0].get('name')} - {name}" if artists else name
    kind = str(it.get("media_type") or "")
    return node(title, media_class or kind, str(it.get("uri") or ""), "music", can_play=True, can_expand=can_expand,
                can_search=kind in WITHIN, thumbnail=image(it, base))


def _items(got: Any) -> list[dict]:
    if isinstance(got, Mapping):
        got = got.get("items")
    return [i for i in got or [] if isinstance(i, Mapping) and i.get("available", True) is not False]


async def browse(client: Any, cid: str | None, ctype: str | None) -> dict[str, Any]:
    """``media_player/browse_media`` for a Music Assistant speaker (HA's async_browse_media)."""
    base = base_of(client)
    if not cid:
        children = [node(t, "directory", lib, "music_assistant", can_play=False, can_expand=True,
                         children_media_class=cls) for lib, (t, cls, _c, _m) in LIBRARIES.items()]
        return node(TITLE, "directory", "", "music_assistant", can_play=False, can_expand=True, children=children)
    if cid in LIBRARIES:
        title, cls, command, _m = LIBRARIES[cid]
        got = _items(await client.library(command, limit=PAGE, order_by="sort_name"))
        expand = cid in ("artists", "albums", "playlists")
        return node(title, "directory", cid, LIBRARY_TYPE[cid], can_play=False, can_expand=True, can_search=True,
                    children_media_class=cls,
                    children=[item(i, base, expand, cls if cid == "radio" else None) for i in got])
    for kind in ("artist", "album", "playlist"):
        if kind in cid:
            return await _container(client, kind, cid, base)
    raise BrowseError(f"Media not found: {ctype} / {cid}")


async def _get(client: Any, uri: str) -> Mapping[str, Any]:
    got = await client.read("music/item_by_uri", uri=uri)
    if not isinstance(got, Mapping) or not got.get("item_id"):
        raise BrowseError(f"Media not found: {uri}")
    return got


def _where(it: Mapping[str, Any]) -> dict[str, Any]:
    return {"item_id": it["item_id"], "provider_instance_id_or_domain": it.get("provider") or "library"}


async def _container(client: Any, kind: str, uri: str, base: str) -> dict[str, Any]:
    it = await _get(client, uri)
    name, cid = str(it.get("name") or ""), str(it.get("uri") or uri)
    if kind == "artist":
        albums = _items(await client.read("music/artists/artist_albums", **_where(it)))
        return node(name, "artist", cid, "artist", can_play=True, can_expand=True, can_search=True,
                    search_media_classes=["album", "track"], children_media_class="album",
                    children=[item(a, base, True) for a in albums])
    command = "music/albums/album_tracks" if kind == "album" else "music/playlists/playlist_tracks"
    tracks = _items(await client.read(command, **_where(it)))
    return node(name, kind, cid, kind, can_play=True, can_expand=True, can_search=True, children_media_class="track",
                children=[item(t, base, False) for t in tracks])


def media_types(cid: str | None, ctype: str | None, classes: list[str] | None) -> list[str]:
    """HA's _get_media_types_from_query."""
    allowed = ARTIST_TYPES if "artist/" in (cid or "") else SEARCHABLE
    if classes:
        want = {t for c in classes for t in CLASS_TYPES.get(c, ())}
        return [t for t in allowed if t in want]
    picked: list[str] = []
    if ctype in ("artist", "album", "track", "playlist", "radio", "audiobook", "podcast"):
        picked = [ctype]
    elif (cid or "") in LIBRARIES:
        picked = [LIBRARIES[cid][3]]  # type: ignore[index]
    return [t for t in picked if t in allowed] or list(allowed)


async def search(client: Any, query: str, cid: str | None, ctype: str | None,
                 classes: list[str] | None) -> dict[str, Any]:
    """``media_player/search_media`` for a Music Assistant speaker (HA's async_search_media): {version, result}."""
    base = base_of(client)
    kinds = media_types(cid, ctype, classes)
    if not kinds:
        return {"version": 1, "result": []}
    if cid and ("album/" in cid or "playlist/" in cid):
        kind = "album" if "album/" in cid else "playlist"
        it = await _get(client, cid)
        command = "music/albums/album_tracks" if kind == "album" else "music/playlists/playlist_tracks"
        tracks = [t for t in _items(await client.read(command, **_where(it)))
                  if query.lower() in str(t.get("name") or "").lower()]
        return {"version": 1, "result": [item(t, base, False) for t in tracks[:SEARCH_LIMIT]]}
    q = query
    if cid and "artist/" in cid:
        q = f"{(await _get(client, cid)).get('name')} - {query}"
    got = await client.search(q, media_types=kinds, limit=SEARCH_LIMIT)
    got = got if isinstance(got, Mapping) else {}
    out = []
    for kind in kinds:
        for it in _items(got.get(RESULT_KEYS[kind])):
            out.append(item(it, base, kind in ("artist", "album", "playlist"), CLASS_OF[kind]))
    return {"version": 1, "result": out}
