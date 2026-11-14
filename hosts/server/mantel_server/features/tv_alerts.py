"""NOTIFICATIONS ON THE APPLE TVS (phase 31, docs/phase31/PLAN.md): Mantel's side.

A notification whose Apple TV switch is on (hk_core.notifications.tv decides) is drawn as a picture
(cameras/tv_card.py, image_work.render_card) and shown on every Apple TV by HomeKit, as a camera's alert:

    the Notifier -> the screens' feed (Feed.taps) -> TvAlerts.on_event -> the queue -> draw the card -> the picture
    becomes camera.mantel_alerts' still -> binary_sensor.mantel_alerts on for HOLD_S, then off -> the next, GAP_S on

* **The two entities** are published to Home Assistant through Mantel Link, beside the house's own (linked_house.py
  calls ``descriptors``), while the Apple TVs are on or HomeKit is wanted. The camera's picture is never in its
  descriptor: its ``still`` attribute is a version, and Mantel Link asks for the picture over its link
  (``camera_image``) when Home Assistant asks it for one -- which HomeKit does when the sensor turns on.
* **HomeKit**: Add to HomeKit (``homekit`` here, kept in ``house/tv_alerts``) puts ``homekit.want`` in the camera's
  features; Mantel Link then makes Home Assistant's HomeKit Bridge entry (accessory mode, the camera with the sensor
  as its motion sensor) and reports its pairing state (``report.homekit``), which Settings shows.
* **One at a time.** HomeKit shows one alert per pulse; a burst queues (at most QUEUE_MAX, the oldest dropped).
* Nothing here calls a house service: the entities are Mantel's own, mirrored by Mantel Link.

REST (an Owner or Admin, HK Settings -> Notifications -> Apple TV):

    GET  /api/tv_alerts               the page: on, look, HomeKit's state, the font and glyphs used, the last sent
    GET  /api/tv_alerts/preview       a sample card as a JPEG (?look=color|black|glass)
    POST /api/tv_alerts/test          Send Test: a card to the TVs now (when HomeKit is paired)
    POST /api/tv_alerts/homekit       {want: true|false}: Add to HomeKit / Remove from HomeKit
"""
from __future__ import annotations

import asyncio
import base64
import logging
import time
from collections import deque
from pathlib import Path
from typing import Any

from aiohttp import web

from hk_core.notifications import tv as TV
from hk_core.notifications.const import CONF_TV, TV_LOOKS
from hk_core.notifications.settings import tv_options

from ..storage import audit
from ..cameras import image_work, imaging, tv_card
from ..qr import svg as qr_svg
from ..identity.guards import guard
from ..identity.guards import ident as guarded

log = logging.getLogger("mantel.tv_alerts")

DOC = "tv_alerts"
CAMERA_ID, SENSOR_ID = "camera.mantel_alerts", "binary_sensor.mantel_alerts"
NAME = "Mantel Alerts"
HOLD_S = 10.0          # the sensor stays on this long (tvOS decides how long the alert stays on screen)
GAP_S = 5.0            # then off this long before the next (HomeKit needs off -> on to alert again)
SETTLE_S = 0.5         # between a new picture and the pulse, so Mantel Link knows the new version first
QUEUE_MAX = 10
HOMEKIT_STATES = ("none", "starting", "unpaired", "paired", "error")


def uids(entry: str) -> tuple[str, str]:
    return f"{entry}_tv_alerts_camera", f"{entry}_tv_alerts_motion"


def renderer_missing() -> str | None:
    """Why no card can be drawn here, or None."""
    try:
        import fontTools  # noqa: F401
        import resvg_py  # noqa: F401
    except ImportError as exc:
        return f"{exc.name} is not installed"
    return None


class TvAlerts:
    """``app["tv_alerts"]``: the queue, the picture, the pulse, and what Settings shows (module docstring)."""

    def __init__(self, app: web.Application, host: Any) -> None:
        self.app, self.host = app, host
        cfg = app.get("cfg")
        hk = Path(cfg.user_files_dir) / "hk" if cfg is not None and getattr(cfg, "data_dir", None) else None
        cache = Path(cfg.data_dir).expanduser() / "cache" / "tv-alerts" if hk is not None else None
        self.fonts = tv_card.Fonts(hk, cache)
        self.glyphs = tv_card.Glyphs(hk)
        self.queue: deque[dict[str, Any]] = deque()
        self.jpeg: bytes | None = None
        self.version = 0
        self.on = False
        self.entry: str | None = None
        self.sent: deque[dict[str, Any]] = deque(maxlen=20)
        self.dropped = 0
        self.task: asyncio.Task | None = None
        self.hold, self.gap, self.settle = HOLD_S, GAP_S, SETTLE_S

    # -- what applies ----------------------------------------------------------------------------------------------
    def options(self) -> dict[str, Any]:
        return tv_options((self.host.notifier.opts or {}).get(CONF_TV))

    def homekit_wanted(self) -> bool:
        return bool(self.host.doc(DOC).get("homekit"))

    def wanted(self) -> bool:
        return self.options()["on"] or self.homekit_wanted()

    def _registry(self) -> Any:
        lk = self.app.get("linked")
        return lk.registry if lk is not None else None

    def homekit(self) -> dict[str, Any]:
        """HomeKit's state as Mantel Link last reported it: {state, code?, uri?, error?} (``none`` with no report)."""
        lk = self.app.get("linked")
        for client in (lk.registry.clients_of("mantel") if lk is not None else []):
            got = client.report.get("homekit")
            if isinstance(got, dict):
                return dict(got)
        return {"state": "none"}

    def published(self) -> bool:
        reg, entry = self._registry(), self.entry
        return bool(reg is not None and entry and reg.get(uids(entry)[0]) is not None)

    # -- the entities (linked_house.py's descriptors) ---------------------------------------------------------------
    def descriptors(self, entry: str) -> dict[str, tuple[dict[str, Any], tuple[str, Any]]]:
        self.entry = entry
        if not self.wanted():
            return {}
        cam, sensor = uids(entry)
        device = {"identifier": f"{entry}_tv_alerts", "name": NAME, "manufacturer": "Mantel",
                  "model": "Notifications on Apple TV"}
        return {
            cam: ({"unique_id": cam, "platform": "camera", "entity_id": CAMERA_ID, "name": NAME, "has_entity_name": False,
                   "icon": "mdi:television-guide", "device": device, "state": "idle", "attributes": {"still": self.version},
                   "features": {"still": True, "homekit": {"want": self.homekit_wanted(), "sensor": sensor}}},
                  ("tv_alerts", "camera")),
            sensor: ({"unique_id": sensor, "platform": "binary_sensor", "entity_id": SENSOR_ID, "name": NAME,
                      "has_entity_name": False, "icon": "mdi:television-guide", "device": device,
                      "state": "on" if self.on else "off", "attributes": {}, "features": {"device_class": "motion"}},
                     ("tv_alerts", "sensor")),
        }

    async def _set(self, which: int, **kw: Any) -> None:
        reg, entry = self._registry(), self.entry
        if reg is None or not entry:
            return
        uid = uids(entry)[which]
        if reg.get(uid) is not None:
            await reg.update(uid, **kw)

    # -- the feed ---------------------------------------------------------------------------------------------------
    def on_event(self, event: dict) -> None:
        if not isinstance(event, dict) or event.get("type") != "notification":
            return
        if TV.goes(self.host.house, self.host.notifier.opts or {}, event, self.host.now()):
            self.add(TV.card(self.host.house, self.host.notifier.opts or {}, event, self.host.now()))

    def add(self, card: dict[str, Any]) -> None:
        while len(self.queue) >= QUEUE_MAX:
            self.queue.popleft()
            self.dropped += 1
        self.queue.append(card)
        if self.task is None or self.task.done():
            try:
                self.task = asyncio.get_running_loop().create_task(self._run())
            except RuntimeError:          # no loop (a synchronous test): it waits in the queue
                pass

    async def _run(self) -> None:
        while self.queue:
            card = self.queue.popleft()
            try:
                await self.show(card)
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 -- one card that won't draw never stops the next
                log.exception("tv alerts: a card could not be shown")
                self.sent.append({"at": time.time(), "title": card.get("title"), "ok": False})

    # -- drawing and showing ----------------------------------------------------------------------------------------
    def _snapshot(self, card: dict[str, Any]) -> bytes | None:
        if not card.get("snapshot") or not card.get("snap"):
            return None
        snaps = getattr(self.host, "snaps", None)
        return snaps.read(str(card["snap"])) if snaps is not None else None

    async def draw(self, card: dict[str, Any]) -> bytes:
        """The card as a JPEG (image worker). The home's font and glyph files are looked at again first."""
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self.fonts.refresh)        # a woff2 is unpacked once: off the event loop
        self.glyphs.refresh()
        svg = await loop.run_in_executor(None, tv_card.svg, card, self.fonts, self.glyphs, self._snapshot(card))
        return await imaging.run(image_work.render_card, svg, self.fonts.files, self.fonts.family)

    async def show(self, card: dict[str, Any]) -> None:
        """One card on the TVs: the picture first, then the sensor on for ``hold``, off for ``gap``."""
        self.jpeg = await self.draw(card)
        self.version += 1
        await self._set(0, attributes={"still": self.version})
        await asyncio.sleep(self.settle)
        self.on = True
        await self._set(1, state="on")
        self.sent.append({"at": time.time(), "title": card.get("title"), "look": card.get("look"), "ok": True,
                          "published": self.published()})
        await asyncio.sleep(self.hold)
        self.on = False
        await self._set(1, state="off")
        await asyncio.sleep(self.gap)

    async def camera_image(self, _client: Any, msg: dict[str, Any]) -> dict[str, Any]:
        """Mantel Link's ``camera_image``: the picture now, base64, with its version (an idle card before any)."""
        if self.entry is None or msg.get("unique_id") != uids(self.entry)[0]:
            from ..linked import LinkedError
            raise LinkedError("unknown_entity", "not Mantel's Apple TV camera")
        if self.jpeg is None:
            self.jpeg = await self.draw({**TV.test_card(self.host.house, self.host.notifier.opts or {}, now=self.host.now()),
                                         "title": NAME, "line": "Ready for notifications"})
        return {"version": self.version, "jpeg": base64.b64encode(self.jpeg).decode("ascii")}

    def status(self) -> dict[str, Any]:
        o = self.options()
        hk = self.homekit()
        return {"on": o["on"], "look": o["look"], "looks": list(TV_LOOKS), "camera": o["camera"], "dnd": o["dnd"],
                "renderer": renderer_missing(), "linked": self.published(), "homekit_wanted": self.homekit_wanted(),
                "homekit": {**{k: hk.get(k) for k in ("state", "code", "uri", "error") if hk.get(k) is not None},
                            **({"qr": qr_svg(hk["uri"])} if hk.get("state") == "unpaired" and hk.get("uri") else {})},
                "font": self.fonts.family, "apple_font": self.fonts.apple, "apple_glyphs": self.glyphs.apple,
                "queued": len(self.queue), "dropped": self.dropped, "sent": list(self.sent)[-5:]}


# ------------------------------------------------------------------------------------------------------- REST
def _tv(request: web.Request) -> TvAlerts:
    return request.app["tv_alerts"]


@guard("manager", reads="admin")
async def get_status(request: web.Request) -> web.Response:
    t = _tv(request)
    await asyncio.get_running_loop().run_in_executor(None, t.fonts.refresh)
    t.glyphs.refresh()
    return web.json_response(t.status())


@guard("manager", reads="admin")
async def get_preview(request: web.Request) -> web.Response:
    t = _tv(request)
    if renderer_missing():
        return web.json_response({"error": "renderer_missing", "message": renderer_missing()}, status=503)
    look = request.query.get("look")
    card = TV.test_card(t.host.house, t.host.notifier.opts or {}, look=look if look in TV_LOOKS else None,
                        now=t.host.now())
    jpeg = await t.draw({**card, "title": "Pasta Timer", "line": "Timer ended", "glyph": "hk:timer-sand", "kind": "timer",
                         "color": "#FF9F0A", "caption": "Kitchen · " + card["caption"]})
    return web.Response(body=jpeg, content_type="image/jpeg", headers={"Cache-Control": "no-store"})


@guard("manager", no_audit="shows a test card on the house's Apple TVs; saves nothing")
async def post_test(request: web.Request) -> web.Response:
    t = _tv(request)
    if renderer_missing():
        return web.json_response({"error": "renderer_missing", "message": renderer_missing()}, status=503)
    t.add(TV.test_card(t.host.house, t.host.notifier.opts or {}, now=t.host.now()))
    return web.json_response({"ok": True, "queued": len(t.queue), "linked": t.published(),
                              "homekit": t.homekit().get("state")})


@guard("manager", audit="tv_alerts.homekit")
async def post_homekit(request: web.Request) -> web.Response:
    t = _tv(request)
    try:
        body = await request.json()
    except ValueError:
        body = None
    want = body.get("want") if isinstance(body, dict) else None
    if not isinstance(want, bool):
        return web.json_response({"error": "invalid", "message": "want: true or false"}, status=400)
    ident = guarded(request)
    audit.config(request, ident, "tv_alerts.homekit", {"want": want})
    t.host.write_doc(DOC, {**t.host.doc(DOC), "homekit": want}, identity=ident,
                     message="Added to HomeKit" if want else "Removed from HomeKit")
    house = request.app.get("linked_house")
    if house is not None:
        await house.refresh()
    return web.json_response(t.status())


def register(app: web.Application, hub: Any = None) -> TvAlerts | None:
    """After the feature host and the linked registry: tap the feed, answer Mantel Link's ``camera_image``."""
    host = app.get("features")
    if host is None or "tv_alerts" in app:
        return app.get("tv_alerts")
    t = TvAlerts(app, host)
    app["tv_alerts"] = t
    feed = getattr(host, "feed", None)
    if feed is not None and hasattr(feed, "taps"):
        feed.taps.append(t.on_event)
    lk = app.get("linked")
    if lk is not None:
        lk.camera_image = t.camera_image
    app.router.add_get("/api/tv_alerts", get_status)
    app.router.add_get("/api/tv_alerts/preview", get_preview)
    app.router.add_post("/api/tv_alerts/test", post_test)
    app.router.add_post("/api/tv_alerts/homekit", post_homekit)

    async def stop(_app: web.Application) -> None:
        if t.task is not None and not t.task.done():
            t.task.cancel()
    app.on_cleanup.append(stop)
    return t
