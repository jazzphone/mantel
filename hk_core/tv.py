"""TVs: each room's TV and the player beside it, the apps people open, the rules with no host in them (phase 23, 2026-11-10).

THE ASK (the owner): a TV card -- inputs, a remote in its sheet, an app picker like the Music block's playlists -- and "a user may
want real TV controls (inputs, possibly real volume if offered) and Apple TV controls at the same time". Arrow keys, not a touchpad.
Settings: the card picks which TV; how a room is wired is the house's, said once (docs/phase23/TV.md).

A ROOM'S SET: the TV (a media_player with device_class tv) and the player beside it (an Apple TV: a media_player that reports
app_id), found by their Home Assistant area. Accessories -> TVs (settings.features.tv_sets) says what Automatic can't: another
player, the TV input the player is on, where volume goes, the inputs nobody uses. {tv entity: {player?, input?, volume?, hidden?}}.

THE APPS (Mantel Server, mantel_server/tv.py): which app each Apple TV opens, counted, and each app's icon from the App Store,
looked up once by its bundle id (features.tv_icons; itunes.apple.com, the picture from *.mzstatic.com) and kept. The input a
player is on is learned: a player waking and its TV coming on or changing input within LEARN_WINDOW seconds of each other. A
label is no guide (the Master Bedroom's Apple TV shows through its soundbar's input, LG S95TR, not the one named Apple TV). Shared as Mantel's
own sensor.hk_tv ({apps, inputs}), for every screen. Apple's own apps aren't in the App Store's lookup: BUILTINS draws them
with the house's glyphs.

GUESSED ICONS (2026-11-10, the owner: "Can it do the fuzzy match and then recheck/redownload when it opens?"): an app the player
lists but nobody has opened yet has no bundle id, so the server asks the App Store's search by its name and keeps the best close
match (`best_match`: the same name, or the name before a ':' or ' - ', or the name as the first word(s), never from a category no
TV app is in, TV-like categories first). The first time the app opens its real bundle id is known: a guess that named another
app is dropped and the real icon looked up (`opened` -> mantel_server/tv.py). Apple's own apps are never searched: APPLE_NAMES
draws them with the same glyphs as BUILTINS.

FAVORITES (features.tv_apps, by the app's name as the player lists it) and what a block shows by default (features.tv_show).
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

ICON_PATH = "/api/tv/icon/"           # Mantel serves a kept icon here (mantel_server/tv.py); the screens add their base
SENSOR = "sensor.hk_tv"             # Mantel's own: attributes `apps` [{id, name, count, last, icon}] and `inputs` {tv: input}
SHOWS = ("recent", "favorites")
VOLUMES = ("auto", "tv", "player", "none")    # where volume goes (or a media_player: a receiver)
MAX_SETS = 24
MAX_HIDDEN = 40
MAX_FAVORITES = 24
NAME_MAX = 60
LEARN_WINDOW = 45.0                     # seconds, either way round: a player waking and its TV changing input are one act
ICON_RETRY = 7 * 86400                  # an app the App Store didn't know is asked again after a week
APPS_MAX = 200                          # apps kept (the least used go first)
BUNDLE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$")
ENTITY = re.compile(r"^media_player\.[a-z0-9_]+$")
OFF = ("off", "standby", "unavailable", "unknown", "")

# Apple's own apps: not in the App Store's lookup, drawn with the house's glyphs on a dark tile (hk: names are Material's, as every hk: key)
BUILTINS: dict[str, str] = {
    "com.apple.TVWatchList": "hk:television", "com.apple.TVMusic": "hk:music", "com.apple.TVPhotos": "hk:image",
    "com.apple.TVSettings": "hk:cog", "com.apple.TVAppStore": "hk:apple", "com.apple.Arcade": "hk:gamepad-variant",
    "com.apple.Fitness": "hk:run", "com.apple.TVHomeSharing": "hk:monitor", "com.apple.podcasts": "hk:podcast",
    "com.apple.TVSearch": "hk:magnify", "com.apple.facetime": "hk:video", "com.apple.TVMovies": "hk:filmstrip",
    "com.apple.TVShows": "hk:television",
}


# the same apps by the name a player lists them under (an app nobody has opened yet has only its name)
APPLE_NAMES: dict[str, str] = {
    "TV": "hk:television", "Music": "hk:music", "Photos": "hk:image", "Settings": "hk:cog", "App Store": "hk:apple",
    "Arcade": "hk:gamepad-variant", "Fitness": "hk:run", "Computers": "hk:monitor", "Podcasts": "hk:podcast", "Search": "hk:magnify",
    "FaceTime": "hk:video", "Movies": "hk:filmstrip", "TV Shows": "hk:television",
}
SEARCH_GAP = 3.0                        # seconds between two name searches (the App Store's search allows ~20 a minute)
NAMES_MAX = 120                         # names searched, across every player's list
# categories no TV app is in (a name shared with a drinks app or a tarot deck must not lend it its icon), and the TV-like ones
NOT_TV = frozenset({"Food & Drink", "Lifestyle", "Shopping", "Business", "Finance", "Medical", "Productivity", "Navigation",
                    "Travel", "Education", "Book", "Reference", "Social Networking", "Health & Fitness", "Developer Tools",
                    "Graphics & Design", "Magazines & Newspapers"})
TV_LIKE = frozenset({"Entertainment", "Photo & Video", "Games", "Sports", "News", "Music", "Kids"})


class Invalid(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _name(v: Any) -> str:
    if not isinstance(v, str) or not 0 < len(v.strip()) <= NAME_MAX:
        raise Invalid("tv_name")
    return v.strip()


def tv_set(v: Any) -> dict[str, Any]:
    """One TV's wiring as Accessories -> TVs writes it: `tv`, and every other key optional, Automatic when left out."""
    if not isinstance(v, Mapping) or set(v) - {"tv", "player", "input", "volume", "hidden"}:
        raise Invalid("tv_set")
    if not (isinstance(v.get("tv"), str) and ENTITY.match(v["tv"])):
        raise Invalid("tv_set")
    out: dict[str, Any] = {"tv": v["tv"]}
    if v.get("player") is not None:
        if v["player"] != "none" and not (isinstance(v["player"], str) and ENTITY.match(v["player"])):
            raise Invalid("tv_set")
        out["player"] = v["player"]
    if v.get("input") is not None:
        out["input"] = _name(v["input"])
    if v.get("volume") is not None:
        if v["volume"] not in VOLUMES and not (isinstance(v["volume"], str) and ENTITY.match(v["volume"])):
            raise Invalid("tv_set")
        if v["volume"] != "auto":
            out["volume"] = v["volume"]
    if v.get("hidden") is not None:
        if not isinstance(v["hidden"], list) or len(v["hidden"]) > MAX_HIDDEN:
            raise Invalid("tv_set")
        hidden = list(dict.fromkeys(_name(x) for x in v["hidden"]))
        if hidden:
            out["hidden"] = hidden
    return out


def tv_sets(v: Any) -> list[dict[str, Any]]:
    """features.tv_sets: each TV's wiring, one TV once; a TV with nothing but its id is left out."""
    if not isinstance(v, list) or len(v) > MAX_SETS:
        raise Invalid("tv_set")
    out, seen = [], set()
    for x in v:
        one = tv_set(x)
        if one["tv"] in seen:
            raise Invalid("tv_set")
        seen.add(one["tv"])
        if len(one) > 1:
            out.append(one)
    return out


def favorites(v: Any) -> list[str]:
    """features.tv_apps: the favorite apps, by name, in order."""
    if not isinstance(v, list) or len(v) > MAX_FAVORITES:
        raise Invalid("tv_apps")
    return list(dict.fromkeys(_name(x) for x in v))


def show(v: Any) -> str:
    if v not in SHOWS:
        raise Invalid("tv_show")
    return v


# -- what the server keeps ----------------------------------------------------------------------------------------------------------
def is_on(st: Mapping[str, Any] | None) -> bool:
    return st is not None and bool(st) and str(st.get("s", st.get("state", ""))) not in OFF


def opened(before: Mapping[str, Any] | None, after: Mapping[str, Any] | None) -> tuple[str, str] | None:
    """(bundle id, name) when a player has just opened an app: its app_id changed to one, while it is on."""
    if not is_on(after):
        return None
    a = (after or {}).get("a", (after or {}).get("attributes")) or {}
    app = a.get("app_id")
    if not isinstance(app, str) or not BUNDLE.match(app):
        return None
    b = (before or {}).get("a", (before or {}).get("attributes")) or {}
    if b.get("app_id") == app and is_on(before):
        return None
    name = a.get("app_name") or a.get("source") or app
    return app, str(name)[:NAME_MAX]


def count(apps: dict[str, dict[str, Any]], app: str, name: str, now: float) -> dict[str, Any]:
    """One more opening of an app (kept: count, last, name)."""
    row = apps.get(app) or {"count": 0, "icon": None, "tried": 0.0}
    row.update(name=name, count=int(row.get("count") or 0) + 1, last=now)
    apps[app] = row
    if len(apps) > APPS_MAX:
        for k in sorted(apps, key=lambda k: (apps[k].get("count") or 0, apps[k].get("last") or 0))[:len(apps) - APPS_MAX]:
            apps.pop(k, None)
    return row


def ranked(apps: Mapping[str, Mapping[str, Any]]) -> list[dict[str, Any]]:
    """The apps most used first (then the latest), as the screens read them."""
    rows = [{"id": k, "name": v.get("name") or k, "count": int(v.get("count") or 0), "last": v.get("last") or 0,
             "icon": bool(v.get("icon")), **({"src": ICON_PATH + k} if v.get("icon") else {}),
             **({"glyph": BUILTINS[k]} if k in BUILTINS else {})} for k, v in apps.items()]
    rows.sort(key=lambda r: (-int(r["count"]), -float(r["last"]), str(r["name"]).lower()))
    return rows


def wants_icon(app: str, row: Mapping[str, Any], now: float, lookup: bool) -> bool:
    """Ask the App Store for this app's icon now? Never for Apple's own, never twice a week."""
    return lookup and app not in BUILTINS and not row.get("icon") and now - float(row.get("tried") or 0) >= ICON_RETRY


def artwork(found: Mapping[str, Any]) -> str | None:
    """The icon's address in the App Store lookup's answer (its largest), only on Apple's picture host."""
    for r in found.get("results") or []:
        for key in ("artworkUrl512", "artworkUrl100", "artworkUrl60"):
            u = r.get(key)
            if isinstance(u, str) and re.match(r"^https://[a-z0-9-]+\.mzstatic\.com/", u):
                return u
    return None


def tv_of(player: str, area_of: Mapping[str, str | None], tvs: list[str]) -> str | None:
    """The TV in a player's room (the first, by id), or None."""
    area = area_of.get(player)
    if not area:
        return None
    here = sorted(t for t in tvs if area_of.get(t) == area)
    return here[0] if here else None


# -- guessing an icon by the app's name -----------------------------------------------------------------------------------------------
def _norm(v: str) -> str:
    return re.sub(r"[^a-z0-9+]", "", v.lower())


def apple_glyph(name: str) -> str | None:
    """Apple's own app's glyph by the name a player lists ("App Store" comes with a no-break space), or None."""
    return APPLE_NAMES.get(re.sub(r"\s+", " ", name).strip()) if isinstance(name, str) else None


def searchable(name: Any) -> bool:
    """A name worth asking the App Store's search about: not Apple's own, not empty, not too long."""
    return isinstance(name, str) and 0 < len(name.strip()) <= NAME_MAX and apple_glyph(name) is None and bool(_norm(name))


def best_match(name: str, found: Mapping[str, Any]) -> dict[str, str] | None:
    """The search answer's closest app to a player's app name, {bundle, art}, or None when nothing is close enough."""
    want, best, score = _norm(name), None, 0.0
    for i, r in enumerate(found.get("results") or []):
        if not isinstance(r, Mapping) or r.get("primaryGenreName") in NOT_TV:
            continue
        title, bundle = r.get("trackName"), r.get("bundleId")
        if not isinstance(title, str) or not (isinstance(bundle, str) and BUNDLE.match(bundle)):
            continue
        head = re.split(r"\s+[:\-\u2013\u2014|]\s*|:\s*", title)[0]
        if _norm(title) == want:
            s = 3.0
        elif _norm(head) == want:
            s = 2.0
        elif re.match(re.escape(name.strip()) + r"\b", title, re.I):
            s = 1.0
        else:
            continue
        s += (1.5 if r.get("primaryGenreName") in TV_LIKE else 0.0) - i * 0.1
        art = artwork({"results": [r]})
        if art and s > score:
            best, score = {"bundle": bundle, "art": art}, s
    return best


def wants_guess(name: str, row: Mapping[str, Any] | None, now: float, lookup: bool) -> bool:
    """Search for this name now? Not with lookups off, not when a guess is kept, not twice a week for a name with no match."""
    if not lookup or not searchable(name):
        return False
    row = row or {}
    return not row.get("icon") and now - float(row.get("tried") or 0) >= ICON_RETRY


def guesses(rows: Mapping[str, Mapping[str, Any]], names: list[str]) -> dict[str, dict[str, str]]:
    """What the screens read for the apps nobody has opened: {name: {id, src}} for a kept guess, {name: {glyph}} for Apple's own."""
    out: dict[str, dict[str, str]] = {}
    for n in names:
        if apple_glyph(n):
            out[n] = {"glyph": str(apple_glyph(n))}
        elif (rows.get(n) or {}).get("icon") and (rows.get(n) or {}).get("bundle"):
            out[n] = {"id": str(rows[n]["bundle"]), "src": ICON_PATH + str(rows[n]["bundle"])}
    return out
