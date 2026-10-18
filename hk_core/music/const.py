"""Music's constants, shared by every host (PLAN.md §0, plan review).

Speakers, the house playlist volume and each user's home room are the feature's
options; presets and playlists are its items (HA: the entry's subentries).
The timings are measured against Music Assistant; the engine that waits on them
is the host's (HA: features/music/music.py).
"""

# ---- entry options
CONF_SPEAKERS = "speakers"      # room players, in pill order
CONF_VOLUME = "volume"          # the house playlist volume, 0..1
CONF_HOMES = "homes"            # {user_id: room player} -- each tablet's own room
CONF_IGNORE_ANNOUNCEMENTS = "ignore_announcements"
CONF_KEEP_READY = "keep_ready"  # keep the playlists' songs fetched (warm.py); off by default

# ---- item (subentry) types: stored with every preset and playlist, so they
# keep these names
SUB_PRESET = "preset"
SUB_PLAYLIST = "playlist"

# ---- preset data
CONF_NAME = "name"
CONF_GROUP = "group"            # the Music Assistant SYNC GROUP player
CONF_MEMBERS = "members"        # its rooms -- HA cannot read them from MA

# ---- playlist data
CONF_ICON = "icon"
CONF_ITEMS = "items"            # library:// uris, played as one queue
CONF_CHOOSER = "chooser"        # playlists sharing a chooser become one pill
CONF_ORDER = "order"

DEFAULT_VOLUME = 0.35

# ---- actions (hk_frontend.music_*)
SERVICE_PLAY = "music_play"
SERVICE_TRANSFER = "music_transfer"
SERVICE_STOP = "music_stop"
SERVICE_TRANSPORT = "music_transport"
SERVICE_PLAY_MEDIA = "music_play_media"

ATTR_ROOMS = "rooms"
ATTR_PLAYLIST = "playlist"
ATTR_SOURCE = "source"
ATTR_PLAYER = "player"
ATTR_COMMAND = "command"
ATTR_LEVEL = "level"

COMMANDS = ("play_pause", "next", "previous", "stop",
            "volume_up", "volume_down", "volume_set")

# ---- the failure notifications the Speakers picker shows on the screens
NOTE_PLAY = "music_play_failed"
NOTE_GROUP = "speaker_group_failed"
NOTE_PRESET = "music_preset_failed"
NOTE_TRANSFER = "music_transfer_failed"
NOTE_PARTIAL = "music_transfer_partial"
NOTE_STOP = "music_stop_failed"

# ---- measured timings (seconds). Every one of these is a bound on a WAIT for
# a state, not a sleep, except JOIN_SETTLE -- see HA's features/music/music.py.
RELEASE_TIMEOUT = 20      # a group coming apart
PAUSE_TIMEOUT = 10        # a player that is streaming going quiet
JOIN_TIMEOUT = 10         # a join becoming exactly the group asked for
JOIN_SETTLE = 1.0         # MA says group_members: [] before a released player
                          # is joinable. Binary-searched: fails at 0.0, works
                          # from 0.5. One second is twice that.
START_TIMEOUT = 15        # after play_media returns, `playing` must show
TRANSFER_TIMEOUT = 15     # the destination holding the moved queue
STOP_TIMEOUT = 10
VOLUME_STEP = 0.05        # a UI decision; MA's own step is 0.02 (measured)

# ---- keeping playlists ready (warm.py). Music Assistant caches a streaming
# playlist's songs for 3 hours, 100 a page (its Apple Music provider).
WARM_CACHE = 3 * 3600     # MA's cache of a playlist's songs (not ours to set)
WARM_EVERY = 2.5 * 3600   # inside those 3 hours, so a round is never late
WARM_FRESH = 3600         # refreshed this recently: a retry round skips it
WARM_FIRST = 300          # after a start: Home Assistant and MA settle first
WARM_SOON = 60            # after the switch is turned on
WARM_GAP = 15             # between playlists: one at a time, never a burst
WARM_QUIET = 120          # someone used the Music page this recently: wait
WARM_SLOW_PAGE = 20       # a page this slow was refused 4+ times in a row
                          # (MA waits 1, 2, 4, 8 s between tries): Apple is
                          # busy. 1-3 refusals are routine even when the house
                          # is quiet (a clean page is 1-2 s; 3 refusals ~9 s,
                          # measured 2026-10-14); MA's own sync runs to 8 and
                          # 17 s waits.
WARM_RETRY = 1800         # ...and the rest of the round waits this long
WARM_TIMEOUT = 120        # one playlist, at most (MA's retries span ~2 min)
WARM_PAGE = 100           # songs per page, Music Assistant's
WARM_RECENT = 10          # recently played playlists kept ready too...
WARM_RECENT_DAYS = 7      # ...played within this many days
