"""LIVE TV IN APPLE'S HOME APP AS A TV (2026-11-26, the owner): Mantel's side. The rules are hk_core.live_tv_buttons.

    Settings -> Live TV -> Home App (an Owner or Admin)   which channels on which screen, what turning it on plays,
    -> house/mantel_features live_tv.buttons / .power_on  HomeKit, the screens (pages/feature_pages.py: the page's
       / .homekit                                         hk_tv/settings/set)
    -> linked_house publishes a TV a screen and the "Mantel Live TV" sensor (``descriptors``)
    -> Mantel Link mirrors them (its media_player platform) and gives each TV its own HomeKit entry
    -> the Home app (or the Remote in Control Center) turns it on or off, picks an input, changes the channel
    -> Mantel Link's entity_command -> ``command``
    -> airplay_out's Sender.play / .stop as the linked Service actor ``mantel:linked``, audited (``via: home_app``)
    -> the sender's ``on_change`` (a show started or ended, whatever ended it) -> linked_house.refresh: each TV's state
       and input are its screen's show (``LB.tv_state``), so the Home app never shows a TV on that isn't; and the
       channel a show started with is the screen's last watched (``last``, kept across restarts)

* **Who it acts as.** The linked actor (alarm_pin.linked_principal), never a person: the Home app says nothing of who
  tapped. Live TV's gate and the stream's key ask Authz.policy_for, so the actor's grants are computed there
  (``cameras``: Live TV and live view of exactly the channels a kept TV plays, only while one is set up), not in
  linked_actions (the command gateway's).
* **A Mantel Link from before the TVs** (0.1.16, 0.1.17) has no media_player platform: it ignores the TVs (logged) and
  its switches' bridge waits, untouched. Only one whose link names ``live_tv_tv`` (TV_FEATURE) mirrors the TVs and
  makes their HomeKit entries; it removes the switches' bridge then.
* **A turn answers in time.** Mantel Link waits HANDLER_TIMEOUT (8 s) for an answer, and a screen may take longer to
  start (the sender allows 20 s): after PRESS_WAIT it answers ``starting`` and the play goes on (logged); the TV shows
  on once the screen plays.
* **How it stands** (``status``, the settings page): the channels and screens, what turning each on plays, what is
  published, the Mantel Link that mirrors them, and each TV in HomeKit as Mantel Link reports it
  (``report.homekit_tvs``), with its QR code.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from hk_core import live_tv_buttons as LB

log = logging.getLogger("mantel.live_tv_buttons")

PRESS_WAIT = 6.0                 # under linked.HANDLER_TIMEOUT
VIA = "home_app"
FEATURE = "live_tv_home"         # the link feature of a Mantel Link that kept Live TV's HomeKit Bridge (0.1.16 on)
TV_FEATURE = "live_tv_tv"        # ...and of one that mirrors the TVs and makes their HomeKit entries (0.1.18 on)
LAST_KEY = "live_tv_last"        # linked_owners' store: {screen: the channel last watched there}


class LiveTvButtons:
    """``app["live_tv_buttons"]`` (module docstring)."""

    def __init__(self, app: Any, host: Any) -> None:
        self.app, self.host = app, host
        self.cameras: tuple[str, ...] = ()      # what Authz.policy_for grants the linked actor (``recompute``)
        self.entry: str | None = None
        self.pressed: list[dict[str, Any]] = []

    # -- what is saved and what there is -------------------------------------------------------------------------
    def saved(self) -> list[dict[str, str]]:
        return list((self.host.settings.get("live_tv") or {}).get("buttons") or [])

    def homekit_wanted(self) -> bool:
        return bool((self.host.settings.get("live_tv") or {}).get("homekit"))

    def power_on(self) -> dict[str, str]:
        try:
            return LB.power_on((self.host.settings.get("live_tv") or {}).get("power_on") or {})
        except LB.Invalid:
            return {}

    def channels(self) -> dict[str, dict[str, Any]]:
        """{number: channel} of the channels Mantel serves now (live_tv.channels)."""
        tv = self.app.get("live_tv")
        try:
            return {c["number"]: c for c in tv.channels()} if tv is not None else {}
        except Exception:  # noqa: BLE001 -- no lineup: no channel to play
            log.exception("live tv buttons: the channels could not be read")
            return {}

    def screens(self) -> dict[str, str]:
        """{id: name} of the paired AirPlay screens."""
        got = self.app.get("airplay_screens")
        try:
            return {s["id"]: s.get("name") or s["id"] for s in got.listed()} if got is not None else {}
        except Exception:  # noqa: BLE001 -- unreadable: none
            log.exception("live tv buttons: the paired screens could not be read")
            return {}

    def recompute(self) -> tuple[str, ...]:
        """The linked actor's cameras, worked out again (linked_house.refresh, every turn). Authz.policy_for reads the
        tuple as it is: a change is a new tuple, so its cache key changes with it."""
        chans = self.channels()
        got = LB.cameras(self.saved(), {n: c["camera"] for n, c in chans.items()}, self.screens())
        if got != self.cameras:
            self.cameras = got
        return got

    def homekit(self) -> dict[str, dict[str, Any]]:
        """Each TV in HomeKit as Mantel Link last reported it: {unique id: {state, code?, uri?, error?}} (none reported:
        {})."""
        lk = self.app.get("linked")
        for client in (lk.registry.clients_of("mantel") if lk is not None else []):
            got = client.report.get("homekit_tvs")
            if isinstance(got, dict):
                return {k: dict(v) for k, v in got.items() if isinstance(v, dict)}
        return {}

    def homekit_state(self) -> str:
        """``none`` while no TV is in HomeKit, else ``some``: whether Remove from Home App still has anything to reach."""
        return "some" if any(v.get("state", "none") != "none" for v in self.homekit().values()) else "none"

    def link(self) -> dict[str, Any]:
        """The Mantel Link that would mirror the TVs: connected, makes their HomeKit entries, and the house is Mantel's."""
        lk, owners = self.app.get("linked"), self.app.get("linked_owners")
        clients = lk.registry.clients_of("mantel") if lk is not None else []
        bridge = (lk.registry.owners or {}).get("bridge") if lk is not None else None
        return {"connected": bool(clients), "home": any(TV_FEATURE in c.features for c in clients),
                "house": bool(owners is not None and owners.house()), "linked_on": bool(self.host.on("linked")),
                "bridge": bridge == "mantel",
                "version": next(((c.report.get("versions") or {}).get("mantel") for c in clients), None)}

    # -- the entities (linked_house.descriptors) -----------------------------------------------------------------
    def plan(self, entry: str) -> list[dict[str, Any]]:
        chans = self.channels()
        return LB.plan(entry, self.saved(), {n: c["name"] for n, c in chans.items()}, self.screens())

    def descriptors(self, entry: str) -> dict[str, tuple[dict[str, Any], tuple[str, Any]]]:
        self.entry = entry
        self.recompute()
        if not LB.wanted(self.saved(), self.homekit_wanted(), self.homekit_state()):
            return {}
        # no device: Home Assistant would put its name before the TV's, and the Home app shows that name
        published = self.plan(entry)
        sender = self.app.get("airplay_sender")
        out: dict[str, tuple[dict[str, Any], tuple[str, Any]]] = {}
        playing = {}
        for p in published:
            show = sender.playing(p["screen"]) if sender is not None else None
            state, source = LB.tv_state(p, show)
            playing[p["name"]] = (show or {}).get("name")
            out[p["uid"]] = ({"unique_id": p["uid"], "platform": "media_player", "entity_id": p["entity_id"],
                              "name": p["name"], "has_entity_name": False, "icon": "mdi:television-play",
                              "state": state, "attributes": {"source": source, "screen": p["screen"]},
                              "features": {"live_tv_home": True, "device_class": "tv", "sources": p["sources"]}},
                             (LB.KIND, {"screen": p["screen"]}))
        c = LB.carrier(entry, published, self.homekit_wanted())
        out[c["uid"]] = ({"unique_id": c["uid"], "platform": "sensor", "entity_id": c["entity_id"], "name": c["name"],
                          "has_entity_name": False, "icon": "mdi:television-guide", "state": c["state"],
                          "attributes": {"tvs": [p["name"] for p in published],
                                         "playing": {n: v for n, v in playing.items() if v}},
                          "features": {"homekit": c["homekit"]}},
                         (LB.KIND, None))
        return out

    def tv(self, screen: str) -> dict[str, Any] | None:
        """The screen's TV as published now (its channels and inputs), or None."""
        return next((p for p in self.plan(self.entry or "") if p["screen"] == screen), None)

    def last(self) -> dict[str, str]:
        """{screen: the channel its last show started with}, kept across restarts (linked_owners' small store)."""
        owners = self.app.get("linked_owners")
        got = (owners.remembered(LAST_KEY) if owners is not None else None) or {}
        return {k: v for k, v in got.items() if isinstance(k, str) and isinstance(v, str)}

    def watched(self, screen: str) -> None:
        """The sender says a show started or ended on ``screen``: a started one's channel is its last watched."""
        sender, owners = self.app.get("airplay_sender"), self.app.get("linked_owners")
        show = sender.playing(screen) if sender is not None else None
        num = (show or {}).get("channel")
        if owners is None or not isinstance(num, str):
            return
        last = self.last()
        if last.get(screen) != num:
            owners.remember(LAST_KEY, {**last, screen: num})

    # -- a turn --------------------------------------------------------------------------------------------------
    async def command(self, detail: dict[str, Any] | None, command: str, data: dict[str, Any], ctx: Any) -> dict[str, Any]:
        """A command to a screen's TV from Home Assistant (the Home app, its Remote, an automation). On (or play) plays
        what turning it on plays (``LB.turn_on_channel``) unless the screen already plays; an input plays its channel;
        next and previous step through the TV's channels; off (pause, stop) ends the screen's show."""
        from ..linked import LinkedError
        if detail is None:
            raise LinkedError("unknown_command", "Mantel Live TV's sensor takes no command")
        sid = detail["screen"]
        tv = self.tv(sid)
        if tv is None:
            raise LinkedError("not_set_up", "that screen has no Live TV channel now")
        sender = self.app.get("airplay_sender")
        show = sender.playing(sid) if sender is not None else None
        if command in ("toggle", "media_play_pause"):
            command = "turn_off" if show else "turn_on"
        if command in ("turn_off", "media_stop", "media_pause"):
            return await self.press({"screen": sid, "channel": None}, ctx) if show else {"playing": None, "screen": sid}
        if command in ("turn_on", "media_play"):
            if show:
                return {"playing": show.get("channel"), "screen": sid}
            num = LB.turn_on_channel(tv, self.power_on().get(sid), self.last().get(sid))
        elif command == "select_source":
            num = LB.channel_of(tv, data.get("source"))
            if num is None:
                raise LinkedError("invalid", f"{tv['name']} has no input {data.get('source')!r}")
        elif command in ("media_next_track", "media_previous_track"):
            current = (show or {}).get("channel") or self.last().get(sid)
            num = LB.stepped(tv, current, 1 if command == "media_next_track" else -1)
        else:
            raise LinkedError("unknown_command", f"a Live TV takes no {command!r}")
        if show and show.get("channel") == num:
            return {"playing": num, "screen": sid}
        return await self.press({"screen": sid, "channel": num}, ctx)

    async def press(self, detail: dict[str, Any], ctx: Any) -> dict[str, Any]:
        """Play ``channel`` on ``screen`` (None: stop the screen's show) as the linked actor. Refusals are Mantel Link's
        wire codes."""
        from ..connectors import Forbidden
        from ..linked import LinkedError
        sender = self.app.get("airplay_sender")
        if sender is None:
            raise LinkedError("not_set_up", "this Mantel plays nothing on AirPlay screens")
        self.recompute()
        from ..alarm_pin import linked_principal
        principal = linked_principal(self.app, getattr(ctx, "peer", None))
        principal.extra["linked_account"] = getattr(getattr(ctx, "account", None), "id", None)
        sid, num = detail["screen"], detail["channel"]
        self.pressed = (self.pressed + [{"screen": sid, "channel": num}])[-20:]
        job = sender.stop(principal, sid, via=VIA) if num is None else sender.play(principal, num, sid, via=VIA)
        task = asyncio.ensure_future(job)
        try:
            return await asyncio.wait_for(asyncio.shield(task), PRESS_WAIT)
        except asyncio.TimeoutError:
            task.add_done_callback(_late)
            return {"starting": True, "screen": sid}
        except Forbidden as exc:
            raise LinkedError("forbidden", str(exc)) from None
        except LookupError as exc:
            raise LinkedError("not_set_up", str(exc)) from None
        except PermissionError as exc:
            raise LinkedError("unpaired", str(exc)) from None
        except ConnectionError as exc:
            raise LinkedError("unavailable", str(exc)) from None

    async def call(self, service: str, data: dict[str, Any], ctx: Any) -> dict[str, Any]:
        """``mantel.live_tv_play {channel, screen}`` / ``mantel.live_tv_stop {screen}`` (a script's, Mantel Link's own):
        the screen by its id or name, the channel by its number or name, then exactly the TV's turn. Only a channel a
        kept TV plays can play (the linked actor's grant); a stop needs a screen with a TV."""
        from ..linked import LinkedError
        keys = {"channel", "screen"} if service == "live_tv_play" else {"screen"}
        if set(data) != keys or not all(isinstance(data[k], str) and 0 < len(data[k]) <= 80 for k in keys):
            raise LinkedError("invalid", f"{service} takes {', '.join(sorted(keys))}")
        want = data["screen"].strip().casefold()
        screens = self.screens()
        sid = next((s for s, n in screens.items() if s == data["screen"] or n.casefold() == want), None)
        if sid is None:
            raise LinkedError("invalid", f"no paired AirPlay screen {data['screen']!r}")
        num = None
        if service == "live_tv_play":
            ch = data["channel"].strip().casefold()
            num = next((n for n, c in self.channels().items() if n == data["channel"].strip()
                        or str(c.get("name") or "").casefold() == ch), None)
            if num is None:
                raise LinkedError("invalid", f"no Live TV channel {data['channel']!r}")
        elif not any(b["screen"] == sid for b in LB.kept(self.saved(), self.channels(), screens)):
            raise LinkedError("forbidden", f"{screens[sid]} has no Live TV in the Home app")
        return await self.press({"screen": sid, "channel": num}, ctx)

    # -- the settings page ---------------------------------------------------------------------------------------
    def status(self) -> dict[str, Any]:
        """Live TV's Home App page (feature_pages.tv_page ``home_app``): never a credential; a TV's setup code only while
        it waits for the Home app."""
        from ..qr import svg as qr_svg
        hk = self.homekit()
        sender = self.app.get("airplay_sender")
        lk = self.app.get("linked")
        tvs = {p["screen"]: p for p in self.plan(self.entry or "")}
        published = 0
        if lk is not None and self.entry:
            published = sum(1 for p in tvs.values() if lk.registry.get(p["uid"]) is not None)
        power, last = self.power_on(), self.last()

        def homekit_of(uid: str) -> dict[str, Any]:
            got = hk.get(uid) or {"state": "none"}
            return {**{k: got.get(k) for k in ("state", "code", "uri", "error") if got.get(k) is not None},
                    **({"qr": qr_svg(got["uri"])} if got.get("state") == "unpaired" and got.get("uri") else {})}

        return {
            "buttons": self.saved(), "homekit_wanted": self.homekit_wanted(), "power_on": power,
            "screens": [{"id": sid, "name": n, "playing": (sender.playing(sid) or {}).get("name") if sender else None,
                         "last": last.get(sid),
                         **({"tv": tvs[sid]["name"], "homekit": homekit_of(tvs[sid]["uid"])} if sid in tvs else {})}
                        for sid, n in self.screens().items()],
            "published": published, "link": self.link(),
            # the page names nothing of Mantel's itself (HK Frontend ships it too): the server says these
            "names": {"host": "Mantel", "link": "Mantel Link", "ha_page": "#/mantel/connections/ha"},
        }


def _late(task: asyncio.Task) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        log.warning("live tv in the home app: a turn that answered 'starting' then failed: %s", exc)


def register(app: Any) -> LiveTvButtons | None:
    """After the feature host, Live TV and airplay_out. Idempotent."""
    if "live_tv_buttons" in app:
        return app["live_tv_buttons"]
    host = app.get("features")
    if host is None:
        return None
    got = LiveTvButtons(app, host)
    app["live_tv_buttons"] = got
    sender = app.get("airplay_sender")
    if sender is not None:
        def show_changed(sid: str) -> None:
            # a show started or ended, however: its channel is the screen's last watched, and the TVs' states follow it
            # (only while any is published)
            try:
                got.watched(sid)
            except Exception:  # noqa: BLE001 -- the last channel is a nicety; the TV's state still follows
                log.exception("live tv in the home app: the last channel watched could not be kept")
            house = app.get("linked_house")
            if house is not None and got.entry and got.saved():
                host.spawn(house.refresh())
        sender.on_change.append(show_changed)
    lk = app.get("linked")
    if lk is not None:
        def heard(client: Any) -> None:
            # Mantel Link's HomeKit entries changed what is published (all removed: the sensor goes)
            house = app.get("linked_house")
            if house is not None and client.domain == "mantel" and "homekit_tvs" in client.report:
                host.spawn(house.refresh())
        lk.listeners.append(heard)
    return got
