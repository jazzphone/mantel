"""music.py's the names and limits the music engine works with (moved here by tools/split_py.py from hosts/server/mantel_server/music.py:
tools/split_py_manifests/music.json; `tools/split_py.py --find NAME` says which file holds a name)."""
from __future__ import annotations

import logging
import re
from hk_core.music.const import SERVICE_PLAY, SERVICE_PLAY_MEDIA, SERVICE_STOP, SERVICE_TRANSFER, SERVICE_TRANSPORT


log = logging.getLogger("mantel.music")

MUSIC_DOC = "music"                       # house/<this>: speakers, volume, homes, presets, playlists, switches

MA_PLATFORM = "music_assistant"

DOMAIN = "hk_frontend"

MUSIC_SERVICES = frozenset({SERVICE_PLAY, SERVICE_TRANSFER, SERVICE_STOP, SERVICE_TRANSPORT, SERVICE_PLAY_MEDIA})

SETTINGS_WRITES = frozenset({"hk_music/settings/set", "hk_music/preset/save", "hk_music/playlist/save",
                             "hk_music/playlists/order", "hk_music/item/remove"})

PLAY_WRITES = frozenset({"hk_music/queue_play", "hk_music/used"})

MUSIC_WS = SETTINGS_WRITES | PLAY_WRITES

IMPORT_READ = "hk_music/settings/get"      # HA's music settings page: the import's one read (server-only)

ENTITY = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")

PLAYER = re.compile(r"^media_player\.[a-z0-9_]+$")

KEY = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")

TEXT_MAX = 200

ITEMS_MAX = 100

# Every read this module answers in app["read_routes"] has exactly one rule here (tests/test_music.py).
ROUTE_RULES: dict[str, str] = {
    "hk_music/subscribe": "feature:music; per person/device: only the players the subject may view (a preset when "
                          "all its rooms are viewable); `home` the person's home room, else the wall "
                          "tablet's room; display-only announcement markers. Bridge to HA while Mantel's engine is off",
    "hk_music/queue": "view the media player (media_player.* only), else not_found; limit 1..100; from Music "
                      "Assistant's queue; items {id, title, artist, duration, image}, token-carrying images dropped. "
                      "Bridge to HA while Mantel's engine is off",
    "hk_music/settings/library": "feature:music; Music Assistant's library playlists as {uri, name}. Bridge to HA "
                                 "while Mantel's engine is off",
    "music_assistant/get_library": "feature:music (view; no player); HA's music_assistant.get_library fields only; "
                                   "Music Assistant's library items as {items: [...]}. Needs Music Assistant in Mantel "
                                   "(else ma_not_configured), not the music settings",
    "music_assistant/get_queue": "feature:music and view every media player named, else not_found; Music Assistant "
                                 "speakers only (else ma_not_configured, as without Music Assistant here); HA's "
                                 "get_queue answer {entity: queue details} from Music Assistant's active queue",
    "music_assistant/search": "feature:music (view; no player); HA's music_assistant.search fields only; Music "
                              "Assistant's search as HA's {artists, albums, tracks, ...}. Needs Music Assistant in "
                              "Mantel (else ma_not_configured)",
    "media_player/browse_media": "view the media player, else not_found. A Music Assistant speaker while Music "
                                 "Assistant is connected here: answered by Mantel from Music Assistant's reads in "
                                 "HA's BrowseMedia shape (music_browse.py; a media-source:// id stays HA's). "
                                 "Otherwise readproxy's (HA answers it); when HA fails to open a playlist uri, Music "
                                 "Assistant is asked once for its songs (a read); a refused sign-in (LoginFailed) is "
                                 "answered login_failed with what to do, else HA's error",
    "media_player/search_media": "view the media player, else not_found. A Music Assistant speaker while Music "
                                 "Assistant is connected here: Music Assistant's search in HA's SearchMedia shape "
                                 "(music_browse.py). Otherwise readproxy's (HA answers it)",
}

# music_assistant_models.errors.LoginFailed.error_code: MA could not sign in to a streaming service (Apple Music's
# user token expired), so it cannot read that account's own library -- its saved playlists. A catalog playlist (a
# search result's apple_music://playlist/pl.…) needs no account and still opens.
MA_LOGIN_FAILED = 6

SIGN_IN_AGAIN = ("Music Assistant's sign-in to your music service was refused, so your saved playlists cannot "
                 "be read. Sign in to it again in Music Assistant (Settings, then Providers).")

MEDIA_URI = re.compile(r"^([a-z0-9_]+(?:--[A-Za-z0-9]+)?)://(playlist)/([^/?#]{1,200})$")
