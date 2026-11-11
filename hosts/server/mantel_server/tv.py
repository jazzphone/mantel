"""TVs: the apps each Apple TV opens, their App Store icons, and the TV input each room's player is on (phase 23, docs/phase23/TV.md;
hk_core/tv.py has the rules).

* WATCHED HERE: ``overlay`` runs ahead of the sessions on every batch of states, as the laundry's Done is (laundry.py). A player (a
  media_player that reports app_id: an Apple TV) that opens an app counts it (hk_core.tv.opened / count); a player that wakes opens a
  LEARN_WINDOW in which its room's TV changing input says which input the player is on.
* ICONS: an app the App Store knows gets its icon looked up once (itunes.apple.com's lookup by bundle id, the picture from
  *.mzstatic.com), kept in the database and served at /api/tv/icon/<app id> to signed-in screens. Off with features.tv_icons. Apple's
  own apps are never looked up (hk_core.tv.BUILTINS: the house's glyphs).
* GUESSED ICONS: an app a player lists that nobody has opened yet is looked up by its name (the App Store's search, one name
  every SEARCH_GAP seconds, hk_core.tv.best_match keeps the close match), its icon kept by name (tv_guesses) and served at the
  same /api/tv/icon/<the guessed bundle id>. When the app opens, a guess that named another bundle id is dropped and the real
  icon looked up by its bundle id, as above.
* SHARED as Mantel's own ``sensor.hk_tv`` (``hub.store.ours``): attributes `apps` (most used first) and `inputs` {tv: input}, so
  every screen, block and sheet agrees. Nothing is created on the Home Assistant side.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Callable

import aiohttp
from aiohttp import web

from hk_core import tv as T

from .guards import guard

log = logging.getLogger("mantel.tv")

LOOKUP = "https://itunes.apple.com/lookup"
SEARCH = "https://itunes.apple.com/search"
ICON_MAX = 1_000_000            # bytes: an App Store icon is ~50-150 kB
ICON_TYPES = {"image/png", "image/jpeg", "image/webp"}
ICON_PATH = T.ICON_PATH + "{app}"
APPS_SHOWN = 60                 # apps the sensor carries (the most used)


class Store:
    def __init__(self, db: Any) -> None:
        self.db = db

    def apps(self) -> dict[str, dict[str, Any]]:
        return {r[0]: {"name": r[1], "count": r[2], "last": r[3], "tried": r[4], "icon": bool(r[5])}
                for r in self.db.execute("SELECT app_id, name, count, last, tried, icon IS NOT NULL FROM tv_apps")}

    def inputs(self) -> dict[str, str]:
        return {r[0]: r[1] for r in self.db.execute("SELECT tv, input FROM tv_inputs")}

    def save_app(self, app: str, row: dict[str, Any]) -> None:
        with self.db:
            self.db.execute("INSERT INTO tv_apps (app_id, name, count, last, tried) VALUES (?,?,?,?,?) ON CONFLICT(app_id) DO UPDATE SET "
                            "name = excluded.name, count = excluded.count, last = excluded.last, tried = excluded.tried",
                            (app, row["name"], row["count"], row.get("last") or 0, row.get("tried") or 0))

    def drop_apps(self, keep: set[str]) -> None:
        with self.db:
            for (app,) in list(self.db.execute("SELECT app_id FROM tv_apps")):
                if app not in keep:
                    self.db.execute("DELETE FROM tv_apps WHERE app_id = ?", (app,))

    def save_icon(self, app: str, body: bytes, kind: str) -> None:
        with self.db:
            self.db.execute("UPDATE tv_apps SET icon = ?, icon_type = ? WHERE app_id = ?", (body, kind, app))

    def tried(self, app: str, when: float) -> None:
        with self.db:
            self.db.execute("UPDATE tv_apps SET tried = ? WHERE app_id = ?", (when, app))

    def icon(self, app: str) -> tuple[bytes, str] | None:
        row = self.db.execute("SELECT icon, icon_type FROM tv_apps WHERE app_id = ?", (app,)).fetchone()
        return (bytes(row[0]), row[1]) if row and row[0] else None

    def guesses(self) -> dict[str, dict[str, Any]]:
        return {r[0]: {"bundle": r[1], "tried": r[2], "icon": bool(r[3])}
                for r in self.db.execute("SELECT name, bundle, tried, icon IS NOT NULL FROM tv_guesses")}

    def tried_guess(self, name: str, when: float) -> None:
        with self.db:
            self.db.execute("INSERT INTO tv_guesses (name, tried) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET tried = excluded.tried",
                            (name, when))

    def save_guess(self, name: str, bundle: str, body: bytes, kind: str) -> None:
        with self.db:
            self.db.execute("UPDATE tv_guesses SET bundle = ?, icon = ?, icon_type = ? WHERE name = ?", (bundle, body, kind, name))

    def drop_guess(self, name: str) -> None:
        with self.db:
            self.db.execute("DELETE FROM tv_guesses WHERE name = ?", (name,))

    def guess_icon(self, bundle: str) -> tuple[bytes, str] | None:
        row = self.db.execute("SELECT icon, icon_type FROM tv_guesses WHERE bundle = ? AND icon IS NOT NULL", (bundle,)).fetchone()
        return (bytes(row[0]), row[1]) if row and row[0] else None

    def save_input(self, tv: str, value: str, player: str, when: float) -> None:
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO tv_inputs (tv, input, player, at) VALUES (?,?,?,?)", (tv, value, player, when))


class TvApps:
    def __init__(self, app: web.Application, hub: Any, clock: Callable[[], float]) -> None:
        self.app, self.hub, self.clock = app, hub, clock
        self.store = Store(app["store"].db)
        self.apps = self.store.apps()
        self.inputs = self.store.inputs()
        self.guessed = self.store.guesses()            # name -> {bundle, tried, icon}
        self.names: list[str] = []                     # every name the players list, A to Z
        self.queue: list[str] = []                     # names waiting for a search
        self.searching: asyncio.Task | None = None
        self.last: dict[str, dict[str, Any]] = {}       # the players' and TVs' states at the last look
        self.woke: dict[str, float] = {}                # player -> when it woke (a learn window open)
        self.moved: dict[str, tuple[float, str]] = {}   # TV -> when it came on or changed input, and to what
        self.loads: tuple = ()
        self.players: set[str] = set()
        self.tvs: set[str] = set()
        self.fetching: set[str] = set()
        self.tasks: set[asyncio.Task] = set()
        self.settings_version = -1
        self.lookup = True

    # -- what the house has ------------------------------------------------------------------------------------------
    def _look_settings(self) -> None:
        try:
            got = self.app["settings"].store.get("house", "settings")
            version = got.version if got is not None else 0
            if version == self.settings_version:
                return
            self.settings_version = version
            feats = (dict(got.body).get("features") if got is not None else None) or {}
            self.lookup = feats.get("tv_icons", True) is not False
        except Exception:  # noqa: BLE001 -- no settings yet: as they come
            return

    def _map(self) -> None:
        """The players and TVs, again when the registry or the number of states changed."""
        states, reg = self.hub.store.states, self.hub.registry
        key = (reg.loads, len(states))
        if key == self.loads:
            return
        self.loads = key
        players, tvs = set(), set()
        for eid, st in states.items():
            if not eid.startswith("media_player."):
                continue
            a = st.get("a") or {}
            entry = reg.entries.get(eid) or {}
            if entry.get("platform") == "apple_tv" or (not entry.get("platform") and "app_id" in a and not a.get("mass_player_type")
                                                       and a.get("device_class") != "speaker" and a.get("source_list")):
                players.add(eid)
            elif a.get("device_class") == "tv" or entry.get("original_device_class") == "tv" or entry.get("device_class") == "tv":
                tvs.add(eid)
        self.players, self.tvs = players, tvs

    # -- watching it -------------------------------------------------------------------------------------------------
    def _look_player(self, eid: str, now: float) -> bool:
        before, after = self.last.get(eid), self.hub.store.states.get(eid)
        self.last[eid] = dict(after) if after else {}
        hit = False
        if before is not None and not T.is_on(before) and T.is_on(after):
            self.woke[eid] = now
            tv = T.tv_of(eid, self.hub.registry.entity_area, sorted(self.tvs))
            moved = self.moved.get(tv) if tv else None
            if tv and moved and now - moved[0] <= T.LEARN_WINDOW:   # (the TV came on or changed input first)
                hit = self._learn(tv, moved[1], eid, now) or hit
        got = T.opened(before, after) if before is not None else None
        if got:
            app, name = got
            row = T.count(self.apps, app, name, now)
            self.store.save_app(app, row)
            if len(self.apps) >= T.APPS_MAX:
                self.store.drop_apps(set(self.apps))
            g = self.guessed.get(name)
            if g is not None and g.get("bundle") and g["bundle"] != app:     # the name's guess was another app: dropped
                self.guessed.pop(name, None)
                self.store.drop_guess(name)
                log.info("tv: %s opened as %s, not the guessed %s: the guess dropped", name, app, g["bundle"])
            self._maybe_icon(app, now)
            hit = True
        return hit

    def _look_tv(self, eid: str, now: float) -> bool:
        before, after = self.last.get(eid), self.hub.store.states.get(eid)
        self.last[eid] = dict(after) if after else {}
        if before is None or not T.is_on(after):
            return False
        src = (after.get("a") or {}).get("source")
        was = (before.get("a") or {}).get("source") if T.is_on(before) else None
        if not isinstance(src, str) or not src or src == was:
            return False
        self.moved[eid] = (now, src)
        area_of = self.hub.registry.entity_area
        for player, at in list(self.woke.items()):
            if now - at > T.LEARN_WINDOW:
                self.woke.pop(player, None)
                continue
            if T.tv_of(player, area_of, sorted(self.tvs)) == eid:
                return self._learn(eid, src, player, now)
        return False

    def _learn(self, tv: str, src: str, player: str, now: float) -> bool:
        if self.inputs.get(tv) == src[:T.NAME_MAX]:
            return False
        self.inputs[tv] = src[:T.NAME_MAX]
        self.store.save_input(tv, self.inputs[tv], player, now)
        log.info("%s: %s is on %s (learned as the two came on together)", tv, player, self.inputs[tv])
        return True

    def overlay(self, changed: set[str]) -> set[str]:
        """Ahead of the sessions, on every batch: an app opened counted, an input learned, the sensor the screens read kept."""
        try:
            self._look_settings()
            self._map()
        except Exception:  # noqa: BLE001
            log.debug("tv: the look at the house failed", exc_info=True)
        states, now = self.hub.store.states, self.clock()
        first = T.SENSOR not in states
        hit = False
        if first:
            for app in list(self.apps):
                self._maybe_icon(app, now)
        for eid in (changed & self.players) if not first else self.players:
            hit = self._look_player(eid, now) or hit
        for eid in (changed & self.tvs) if not first else self.tvs:
            hit = self._look_tv(eid, now) or hit
        if first or changed & self.players:
            hit = self._look_names(now) or hit
        if not (hit or first or T.SENSOR in changed):
            return changed
        return self._publish(changed)

    def _publish(self, changed: set[str]) -> set[str]:
        states, now = self.hub.store.states, self.clock()
        attrs = {"friendly_name": "TV apps", "icon": "mdi:television", "plumbing": True,
                 "apps": T.ranked(self.apps)[:APPS_SHOWN], "inputs": dict(sorted(self.inputs.items())),
                 "guesses": T.guesses(self.guessed, self.names)}
        old = states.get(T.SENSOR)
        if old is not None and old.get("a") == attrs:
            return changed
        if old is None:
            self.hub.store.ours.add(T.SENSOR)
        states[T.SENSOR] = {"s": str(len(self.apps)), "a": attrs, "lc": now, "lu": now}
        return changed | {T.SENSOR}

    # -- icons -------------------------------------------------------------------------------------------------------
    def _maybe_icon(self, app: str, now: float) -> None:
        row = self.apps.get(app) or {}
        if app in self.fetching or not T.wants_icon(app, row, now, self.lookup) or self.app.get("http") is None:
            return
        self.fetching.add(app)
        row["tried"] = now
        self.store.tried(app, now)
        task = asyncio.ensure_future(self._fetch(app))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def _fetch(self, app: str) -> None:
        try:
            got = await self.fetch_icon(app)
            if got:
                body, kind = got
                self.store.save_icon(app, body, kind)
                if app in self.apps:
                    self.apps[app]["icon"] = True
                log.info("tv: %s's icon from the App Store (%d bytes)", app, len(body))
                self.hub.on_change({T.SENSOR})
        except Exception:  # noqa: BLE001 -- asked again in a week
            log.debug("tv: %s's icon", app, exc_info=True)
        finally:
            self.fetching.discard(app)

    # -- icons guessed by name -------------------------------------------------------------------------------------------
    def _look_names(self, now: float) -> bool:
        """Every name the players list; the ones with no icon yet queued for a search. True when the list changed."""
        states, names = self.hub.store.states, set()
        for eid in self.players:
            lst = ((states.get(eid) or {}).get("a") or {}).get("source_list")
            if isinstance(lst, list):
                names.update(n for n in lst if isinstance(n, str) and 0 < len(n) <= T.NAME_MAX)
        listed = sorted(names)[:T.NAMES_MAX]
        changed = listed != self.names
        self.names = listed
        if self.app.get("http") is None:
            return changed
        opened = {r.get("name") for r in self.apps.values()}        # (an app opened has its real bundle id: never guessed again)
        for n in listed:
            if n not in opened and n not in self.queue and T.wants_guess(n, self.guessed.get(n), now, self.lookup):
                self.queue.append(n)
        if self.queue and (self.searching is None or self.searching.done()):
            self.searching = asyncio.ensure_future(self._search_all())
            self.tasks.add(self.searching)
            self.searching.add_done_callback(self.tasks.discard)
        return changed

    async def _search_all(self) -> None:
        while self.queue:
            name = self.queue.pop(0)
            now = self.clock()
            if not T.wants_guess(name, self.guessed.get(name), now, self.lookup):
                continue
            self.guessed.setdefault(name, {})["tried"] = now
            self.store.tried_guess(name, now)
            try:
                got = await self.search_icon(name)
                if got:
                    bundle, body, kind = got
                    self.store.save_guess(name, bundle, body, kind)
                    self.guessed[name].update(bundle=bundle, icon=True)
                    log.info("tv: %s's icon guessed from the App Store's %s (%d bytes)", name, bundle, len(body))
                    self.hub.on_change({T.SENSOR})
            except Exception:  # noqa: BLE001 -- asked again in a week
                log.debug("tv: %s's icon by name", name, exc_info=True)
            if self.queue:
                await asyncio.sleep(T.SEARCH_GAP)

    async def search_icon(self, name: str) -> tuple[str, bytes, str] | None:
        """The App Store search's closest app to one name: (its bundle id, its icon, the icon's type), or None."""
        http: aiohttp.ClientSession = self.app["http"]
        timeout = aiohttp.ClientTimeout(total=15)
        async with http.get(SEARCH, params={"term": name, "entity": "software", "country": "us", "limit": "10"}, timeout=timeout) as r:
            if r.status != 200:
                return None
            found = await r.json(content_type=None)
        hit = T.best_match(name, found if isinstance(found, dict) else {})
        if not hit:
            return None
        got = await self._picture(hit["art"])
        return (hit["bundle"],) + got if got else None

    async def _picture(self, url: str) -> tuple[bytes, str] | None:
        http: aiohttp.ClientSession = self.app["http"]
        async with http.get(url, timeout=aiohttp.ClientTimeout(total=15)) as r:
            kind = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if r.status != 200 or kind not in ICON_TYPES:
                return None
            body = await read_all(r.content)
            return (body, kind) if body else None

    async def fetch_icon(self, app: str) -> tuple[bytes, str] | None:
        """The App Store's icon for one bundle id: the lookup, then its picture (Apple's host only), or None."""
        http: aiohttp.ClientSession = self.app["http"]
        timeout = aiohttp.ClientTimeout(total=15)
        async with http.get(LOOKUP, params={"bundleId": app}, timeout=timeout) as r:
            if r.status != 200:
                return None
            found = await r.json(content_type=None)
        url = T.artwork(found if isinstance(found, dict) else {})
        return await self._picture(url) if url else None

    def status(self) -> dict[str, Any]:
        return {"players": sorted(self.players), "tvs": sorted(self.tvs), "apps": len(self.apps),
                "icons": sum(1 for r in self.apps.values() if r.get("icon")),
                "guessed": sum(1 for r in self.guessed.values() if r.get("icon")), "inputs": dict(self.inputs), "lookup": self.lookup}

    async def close(self) -> None:
        for t in list(self.tasks):
            t.cancel()


async def read_all(content: Any) -> bytes | None:
    """A whole response body up to ICON_MAX, or None past it. (`content.read(n)` answers the first chunk it has, not n bytes:
    icons were kept cut at 16 kB until 2026-11-10.)"""
    body = bytearray()
    async for chunk in content.iter_chunked(65536):
        body += chunk
        if len(body) > ICON_MAX:
            return None
    return bytes(body)


_APP = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$")


@guard("signed_in", reads="none", why="an app's App Store icon: a picture of a public app, no entity, camera or person")
async def api_icon(request: web.Request) -> web.Response:
    app = request.match_info.get("app", "")
    host = request.app.get("tv")
    got = (host.store.icon(app) or host.store.guess_icon(app)) if host is not None and _APP.match(app) else None
    if not got:
        raise web.HTTPNotFound()
    body, kind = got
    return web.Response(body=body, content_type=kind, headers={"Cache-Control": "private, max-age=604800"})


def register(app: web.Application, hub: Any) -> TvApps:
    """``app["tv"]``, its overlay ahead of the sessions on every batch of states, and its icons' route."""
    host = TvApps(app, hub, lambda: app["clock"]())
    app["tv"] = host
    hub.overlays.append(host.overlay)
    app.router.add_get(ICON_PATH, api_icon)

    async def stop(_app: web.Application) -> None:
        await host.close()
    app.on_cleanup.append(stop)
    return host
