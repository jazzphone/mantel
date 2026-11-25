"""LIVE TV BUTTONS FOR APPLE'S HOME APP (2026-11-25, the owner): Mantel's side. The rules are hk_core.live_tv_buttons.

    Settings -> Live TV -> Home App (an Owner or Admin)   which channel on which screen, the HomeKit Bridge, the screens
    -> house/mantel_features live_tv.buttons / .homekit   (pages/feature_pages.py: the page's hk_tv/settings/set)
    -> linked_house publishes the buttons, a Stop per screen and the "Mantel Live TV" sensor (``descriptors``)
    -> Mantel Link mirrors them (its button platform) and keeps the "Mantel Live TV" HomeKit Bridge with exactly them
    -> a tap in the Home app presses one -> Mantel Link's entity_command "press" -> ``press``
    -> airplay_out's Sender.play / .stop as the linked Service actor ``mantel:linked``, audited (``via: home_app``)

* **Who it acts as.** The linked actor (alarm_pin.linked_principal), never a person: the Home app says nothing of who
  tapped. Live TV's gate and the stream's key ask Authz.policy_for, so the actor's grants are computed there
  (``cameras``: Live TV and live view of exactly the channels a kept button plays, only while one is set up), not in
  linked_actions (the command gateway's).
* **Only to a Mantel Link that has buttons.** A button entity goes to a linked client whose link names the ``buttons``
  feature (linked/__init__.py): an older Mantel Link, or HK Frontend, never sees one.
* **A press answers in time.** Mantel Link waits HANDLER_TIMEOUT (8 s) for an answer, and a screen may take longer to
  start (the sender allows 20 s): after PRESS_WAIT the press answers ``starting`` and the play goes on (logged).
* **How it stands** (``status``, the settings page): the buttons and screens, what is published, the Mantel Link
  that mirrors them, and the bridge as Mantel Link reports it (``report.homekit_tv``), with its QR code.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from hk_core import live_tv_buttons as LB

log = logging.getLogger("mantel.live_tv_buttons")

PRESS_WAIT = 6.0                 # under linked.HANDLER_TIMEOUT
VIA = "home_app"
FEATURE = "buttons"              # the link feature of a Mantel Link that mirrors buttons


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

    def channels(self) -> dict[str, dict[str, Any]]:
        """{number: channel} of the channels Mantel serves now (live_tv.channels)."""
        tv = self.app.get("live_tv")
        try:
            return {c["number"]: c for c in tv.channels()} if tv is not None else {}
        except Exception:  # noqa: BLE001 -- no lineup: no channel to press
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
        """The linked actor's cameras, worked out again (linked_house.refresh, every press). Authz.policy_for reads the
        tuple as it is: a change is a new tuple, so its cache key changes with it."""
        chans = self.channels()
        got = LB.cameras(self.saved(), {n: c["camera"] for n, c in chans.items()}, self.screens())
        if got != self.cameras:
            self.cameras = got
        return got

    def homekit(self) -> dict[str, Any]:
        """The bridge as Mantel Link last reported it: {state, code?, uri?, error?} (``none`` with no report)."""
        lk = self.app.get("linked")
        for client in (lk.registry.clients_of("mantel") if lk is not None else []):
            got = client.report.get("homekit_tv")
            if isinstance(got, dict):
                return dict(got)
        return {"state": "none"}

    def link(self) -> dict[str, Any]:
        """The Mantel Link that would mirror the buttons: connected, has buttons, and the house is Mantel's."""
        lk, owners = self.app.get("linked"), self.app.get("linked_owners")
        clients = lk.registry.clients_of("mantel") if lk is not None else []
        bridge = (lk.registry.owners or {}).get("bridge") if lk is not None else None
        return {"connected": bool(clients), "buttons": any(FEATURE in c.features for c in clients),
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
        if not LB.wanted(self.saved(), self.homekit_wanted(), self.homekit().get("state", "none")):
            return {}
        # no device: Home Assistant would put its name before each button's, and the Home app shows that name
        published = self.plan(entry)
        out: dict[str, tuple[dict[str, Any], tuple[str, Any]]] = {}
        for p in published:
            stop = p["channel"] is None
            out[p["uid"]] = ({"unique_id": p["uid"], "platform": "button", "entity_id": p["entity_id"], "name": p["name"],
                              "has_entity_name": False, "icon": "mdi:television-off" if stop else "mdi:television-play",
                              "state": None,
                              "attributes": {"screen": p["screen"], **({} if stop else {"channel": p["channel"]})}},
                             (LB.KIND, {"screen": p["screen"], "channel": p["channel"]}))
        c = LB.carrier(entry, published, self.homekit_wanted())
        sender = self.app.get("airplay_sender")
        playing = {sid: (sender.playing(sid) or {}).get("name") for sid in {p["screen"] for p in published}} \
            if sender is not None else {}
        out[c["uid"]] = ({"unique_id": c["uid"], "platform": "sensor", "entity_id": c["entity_id"], "name": c["name"],
                          "has_entity_name": False, "icon": "mdi:television-guide", "state": c["state"],
                          "attributes": {"buttons": [p["name"] for p in published if p["channel"] is not None],
                                         "playing": {self.screens().get(s, s): n for s, n in playing.items() if n}},
                          "features": {"homekit": c["homekit"]}},
                         (LB.KIND, None))
        return out

    # -- a press -------------------------------------------------------------------------------------------------
    async def press(self, detail: dict[str, Any] | None, ctx: Any) -> dict[str, Any]:
        """A button pressed in Home Assistant (the Home app): play its channel on its screen, or stop it, as the linked
        actor. Refusals are Mantel Link's wire codes."""
        from ..connectors import Forbidden
        from ..linked import LinkedError
        sender = self.app.get("airplay_sender")
        if detail is None:
            raise LinkedError("unknown_command", "Mantel Live TV's sensor takes no press")
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
        the screen by its id or name, the channel by its number or name, then exactly a press. Only a channel a kept
        button plays can play (the linked actor's grant); a Stop needs a screen with a button."""
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
            raise LinkedError("forbidden", f"{screens[sid]} has no Live TV button")
        return await self.press({"screen": sid, "channel": num}, ctx)

    # -- the settings page ---------------------------------------------------------------------------------------
    def status(self) -> dict[str, Any]:
        """Live TV's Home App page (feature_pages.tv_page ``home_app``): never a credential; the setup code only while
        the bridge waits for the Home app."""
        from ..qr import svg as qr_svg
        hk = self.homekit()
        sender = self.app.get("airplay_sender")
        lk = self.app.get("linked")
        published = 0
        if lk is not None and self.entry:
            published = sum(1 for p in self.plan(self.entry) if lk.registry.get(p["uid"]) is not None)
        return {
            "buttons": self.saved(), "homekit_wanted": self.homekit_wanted(),
            "screens": [{"id": sid, "name": n, "playing": (sender.playing(sid) or {}).get("name") if sender else None}
                        for sid, n in self.screens().items()],
            "published": published, "link": self.link(),
            # the page names nothing of Mantel's itself (HK Frontend ships it too): the server says these
            "names": {"host": "Mantel", "link": "Mantel Link", "bridge": LB.BRIDGE_NAME, "ha_page": "#/mantel/connections/ha"},
            "homekit": {**{k: hk.get(k) for k in ("state", "code", "uri", "error") if hk.get(k) is not None},
                        **({"qr": qr_svg(hk["uri"])} if hk.get("state") == "unpaired" and hk.get("uri") else {})},
        }


def _late(task: asyncio.Task) -> None:
    if task.cancelled():
        return
    exc = task.exception()
    if exc is not None:
        log.warning("live tv buttons: a press that answered 'starting' then failed: %s", exc)


def register(app: Any) -> LiveTvButtons | None:
    """After the feature host, Live TV and airplay_out. Idempotent."""
    if "live_tv_buttons" in app:
        return app["live_tv_buttons"]
    host = app.get("features")
    if host is None:
        return None
    got = LiveTvButtons(app, host)
    app["live_tv_buttons"] = got
    lk = app.get("linked")
    if lk is not None:
        def heard(client: Any) -> None:
            # Mantel Link's bridge state changed what is published (removed: the sensor goes)
            house = app.get("linked_house")
            if house is not None and client.domain == "mantel" and "homekit_tv" in client.report:
                host.spawn(house.refresh())
        lk.listeners.append(heard)
    return got
