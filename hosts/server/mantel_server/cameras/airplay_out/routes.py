"""AIRPLAY OUT'S DOORS (phase 35): the sender that plays a Live TV channel on a paired screen, and how pages and the
iPhone app ask it.

* ``Sender`` (``app["airplay_sender"]``): ``play(principal, channel, screen)`` asks Live TV for the channel's stream
  and its keyed address exactly as Apple's player on the Live TV page does (``live_tv.hls``: feature ``live_tv`` and
  ``view`` on the channel's camera, a key minted for this person and re-checked on every fetch), then hands the
  screen that address (session.Show). One show a screen: a second play replaces the first. The screen's fetches hold
  the stream (``live_tv.hold``); when the show ends the hold runs out with its lease. Every play and stop is in the
  audit before the screen is told (a play once Live TV has said yes).
* The socket (HK's pages): ``hk_tv/screens`` (the screens a person may send to, and what each plays),
  ``hk_tv/play_on`` / ``hk_tv/play_off``; HK Settings' AirPlay Screens, Owner and Admin: ``hk_tv/screens/manage``
  (the paired ones with their addresses, and those on the network), ``hk_tv/screen_pair`` (begin: the code shows;
  finish: the code), ``hk_tv/screen_remove``, ``hk_tv/screen_rename``.
* The app (``apps/app_tv.py``): ``POST /api/app/tv/play`` and ``/api/app/tv/stop`` for the Live TV widget's Play On.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from ...connectors import Ctx, Forbidden, read_routes
from ...storage import audit
from . import hap
from .rtsp import AirPlayError
from .screens import Screens
from .session import Show

log = logging.getLogger("mantel.airplay_out")

START_TIMEOUT = 20.0


class Sender:
    def __init__(self, app: Any, screens: Screens) -> None:
        self.app, self.screens = app, screens
        self.shows: dict[str, tuple[Show, dict]] = {}          # screen id -> (its show, {channel, name, by})

    def playing(self, sid: str) -> dict | None:
        got = self.shows.get(sid)
        return dict(got[1]) if got and not got[0].ended.is_set() else None

    def _base(self) -> str:
        url = getattr(self.app.get("cfg"), "public_url", "") or ""
        if not url.startswith("https://"):
            raise ConnectionError("Mantel has no https address a screen can fetch Live TV from")
        return url.rstrip("/")

    async def play(self, principal: Any, number: str, sid: str) -> dict:
        tv = self.app.get("live_tv")
        screen = self.screens.get(sid) if isinstance(sid, str) else None
        if tv is None or screen is None:
            raise LookupError("no such screen")
        ch = next((c for c in tv.channels() if c.get("number") == number), None) if isinstance(number, str) else None
        if ch is None:
            raise LookupError("no such channel")
        user = getattr(getattr(principal, "identity", None), "user", None)
        detail = {"channel": number, "channel_name": ch.get("name"), "screen": sid, "screen_name": screen.get("name")}
        # Live TV's own question first (feature, the channel's camera): a refused play leaves no audit row
        got = await tv.hls(Ctx(send=_quiet, identity=principal), {"type": "hk_tv/hls", "entity_id": ch["camera"]})
        if not isinstance(got, dict) or not got.get("shared"):
            raise ConnectionError("Live TV gave no address a screen can play")
        audit.config(None, principal, "live_tv.airplay.play", detail, app=self.app)
        url = f"{self._base()}/go2rtc/{got['shared']}"
        old = self.shows.pop(sid, None)
        if old is not None:
            await old[0].stop()
        creds = hap.Credentials.loads(screen["creds"])
        show = Show(screen["host"], creds, int(screen.get("port") or 7000), psi=screen.get("psi") or None,
                    on_end=lambda s, sid=sid: self._ended(sid, s))
        self.shows[sid] = (show, {"channel": number, "name": ch.get("name"), "by": getattr(user, "id", None)})
        try:
            await asyncio.wait_for(show.start(url), START_TIMEOUT)
        except (AirPlayError, hap.PairingError, OSError, asyncio.TimeoutError) as exc:
            self.shows.pop(sid, None)
            if isinstance(exc, hap.PairingError) and exc.code == 2:
                raise PermissionError("the screen no longer knows Mantel: pair it again in Settings") from exc
            raise ConnectionError(f"the screen didn't play it ({type(exc).__name__})") from exc
        return {"playing": {"channel": number, "name": ch.get("name")}, "screen": sid}

    async def stop(self, principal: Any, sid: str) -> dict:
        got = self.shows.get(sid) if isinstance(sid, str) else None
        if got is None or got[0].ended.is_set():
            return {"playing": None, "screen": sid}
        audit.config(None, principal, "live_tv.airplay.stop", {"screen": sid, "channel": got[1].get("channel")},
                     app=self.app)
        await got[0].stop()
        return {"playing": None, "screen": sid}

    def _ended(self, sid: str, show: Show) -> None:
        cur = self.shows.get(sid)
        if cur is not None and cur[0] is show:
            del self.shows[sid]

    async def close(self, _app: Any = None) -> None:
        for show, _ in list(self.shows.values()):
            await show.stop()

    def visible(self) -> list[dict]:
        """The screens anyone with Live TV may send to: a name and what it plays."""
        return [{"id": s["id"], "name": s["name"], "playing": self.playing(s["id"])} for s in self.screens.listed()]


async def _quiet(_msg: dict) -> None:
    return None


def _only(msg: dict, keys: set[str]) -> None:
    from ...ha.readproxy import ReadBlocked
    if set(msg) - {"type", "id"} - keys:
        raise ReadBlocked(f"{msg.get('type')} carries {', '.join(sorted(keys)) or 'nothing'} only")


async def _manager(app: Any, ctx: Ctx) -> None:
    from ...settings_store.docs import Scope
    service = app.get("settings")
    if service is None or not await service.allowed(ctx.identity, Scope("house", "settings")):
        raise Forbidden("AirPlay Screens needs configure on settings")


def register(app: Any) -> Sender | None:
    """``app["airplay_screens"]`` and ``app["airplay_sender"]``, and the socket's doors. Call after Live TV."""
    if "airplay_sender" in app:
        return app["airplay_sender"]
    cfg, box = app.get("cfg"), app.get("secret_box")
    if cfg is None or box is None:
        return None
    from ...connections import SealedFiles
    from .screens import ScreensFile
    screens = Screens(SealedFiles(cfg.connections_dir, box, record=ScreensFile), _data_dir(cfg),
                      clock=app.get("clock") or time.time)
    sender = Sender(app, screens)
    app["airplay_screens"], app["airplay_sender"] = screens, sender
    if hasattr(app, "on_cleanup"):
        app.on_cleanup.append(sender.close)

    async def listed(ctx: Ctx, msg: dict):
        _only(msg, set())
        return {"screens": sender.visible()}

    async def manage(ctx: Ctx, msg: dict):
        _only(msg, set())
        await _manager(app, ctx)
        return {"screens": [{**s, "playing": sender.playing(s["id"])} for s in screens.listed()],
                "found": screens.found()}

    async def pair(ctx: Ctx, msg: dict):
        _only(msg, {"step", "host", "port", "name", "model", "psi", "pairing", "code"})
        await _manager(app, ctx)
        step = msg.get("step")
        try:
            if step == "begin":
                return {"pairing": await screens.begin(msg.get("host"), msg.get("port") or 7000,
                                                       msg.get("name") or "", msg.get("model") or "", msg.get("psi") or "")}
            if step == "finish":
                user = getattr(getattr(ctx.identity, "identity", None), "user", None)
                audit.config(None, ctx.identity, "live_tv.airplay.screen_paired", {"pairing": str(msg.get("pairing"))[:24]},
                             app=app)
                return {"screen": await screens.finish(msg.get("pairing"), str(msg.get("code") or ""),
                                                       getattr(user, "id", None))}
            if step == "cancel":
                screens.cancel(msg.get("pairing"))
                return {"cancelled": True}
        except hap.PairingError as exc:
            return {"error": "wrong_code" if exc.code == 2 else "refused", "message": str(exc)}
        except (AirPlayError, OSError, asyncio.TimeoutError) as exc:
            return {"error": "unreachable", "message": f"the screen didn't answer ({type(exc).__name__})"}
        except (ValueError, LookupError) as exc:
            return {"error": "invalid", "message": str(exc)}
        return {"error": "invalid", "message": "step is begin, finish or cancel"}

    async def remove(ctx: Ctx, msg: dict):
        _only(msg, {"screen"})
        await _manager(app, ctx)
        sid = msg.get("screen")
        if not isinstance(sid, str) or screens.get(sid) is None:
            return {"error": "not_found"}
        audit.config(None, ctx.identity, "live_tv.airplay.screen_removed", {"screen": sid,
                     "name": screens.get(sid).get("name")}, app=app)
        if sid in sender.shows:
            await sender.shows[sid][0].stop()
        screens.remove(sid)
        return {"removed": sid}

    async def rename(ctx: Ctx, msg: dict):
        _only(msg, {"screen", "name"})
        await _manager(app, ctx)
        sid = msg.get("screen")
        if not isinstance(sid, str) or screens.get(sid) is None:
            return {"error": "not_found"}
        audit.config(None, ctx.identity, "live_tv.airplay.screen_renamed", {"screen": sid}, app=app)
        got = screens.rename(sid, str(msg.get("name") or ""))
        return {"screen": {k: got.get(k) for k in ("id", "name")}}

    async def play_on(ctx: Ctx, msg: dict):
        _only(msg, {"channel", "screen"})
        return await _answer(sender.play(ctx.identity, msg.get("channel"), msg.get("screen")))

    async def play_off(ctx: Ctx, msg: dict):
        _only(msg, {"screen"})
        return await _answer(sender.stop(ctx.identity, msg.get("screen")))

    from ...connectors import Route
    read_routes(app).update({
        "hk_tv/screens": Route(request=listed), "hk_tv/screens/manage": Route(request=manage),
        "hk_tv/screen_pair": Route(request=pair), "hk_tv/screen_remove": Route(request=remove),
        "hk_tv/screen_rename": Route(request=rename), "hk_tv/play_on": Route(request=play_on),
        "hk_tv/play_off": Route(request=play_off),
    })
    return sender


def _data_dir(cfg: Any):
    from pathlib import Path
    return Path(cfg.data_dir).expanduser() if getattr(cfg, "data_dir", None) else None


async def _answer(job) -> dict:
    """A play or stop as the page and the app read it: the result, or ``error`` (forbidden, not_found, unpaired,
    unavailable) with the reason."""
    try:
        return await job
    except Forbidden as exc:
        return {"error": "forbidden", "message": str(exc)}
    except LookupError as exc:
        return {"error": "not_found", "message": str(exc)}
    except PermissionError as exc:
        return {"error": "unpaired", "message": str(exc)}
    except ConnectionError as exc:
        return {"error": "unavailable", "message": str(exc)}
