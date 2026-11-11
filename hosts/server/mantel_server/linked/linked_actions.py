"""HK Frontend's other actions, run by Mantel (docs/phase9/MANTEL-LINK.md 9.8).

Home Assistant's automations and scripts may call HK Frontend's music, Clean Areas and automation-snooze actions.
Mantel Link keeps those names (``mantel.*`` and, as permanent aliases, ``hk_frontend.*``) and forwards them here,
where Mantel's own engines run them -- never back to Home Assistant's ``hk_frontend``, which may now be Mantel Link's
own alias (that would go round in a circle):

  music_play, music_transfer, music_stop,    Mantel's music engine (music.py), through the command gateway as a page's
  music_transport, music_play_media           music commands go; refused in words when Mantel's music isn't on
  clean_areas {areas, dry_run?}               hk_core's Clean Areas over Mantel's house: the plan, then one vacuum call
                                              per robot through the gateway (a dry run only plans)
  pause_automation {entity_id, until?}        the automation off until `until` (default: the next midnight, the house's
  resume_automation {entity_id}               time) and on again then, through the gateway; resumed early on request,
                                              forgotten when someone turns it on in the meantime

EVERYTHING GOES THROUGH THE GATEWAY as the Service actor ``mantel:linked`` (alarm_pin.linked_principal): RBAC, then
the audit row, then Home Assistant only with commands on (``commands_disabled`` otherwise: nothing is sent, the
refusal is in words in Home Assistant). Its grants are computed, not stored, and cover exactly what these actions
act on, as HK Frontend could in Home Assistant: ``control`` on the vacuums Clean Areas uses, on media players and
the music feature, and ``control`` + ``control.sensitive`` on automations (turning one off or on is sensitive). An
Owner's deny grant naming ``mantel:linked`` still wins.

THE PAGE'S "PAUSED UNTIL" (``hk_frontend/snooze/subscribe``, hk-headers.js): answered here from the same snooze
record, ``{until: {automation: ISO time}}`` now and on every change, cut down to the automations the person may
view (HK Frontend's said it to every user). Never forwarded to Home Assistant.
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Mapping

from aiohttp import web

log = logging.getLogger("mantel.linked_actions")

MUSIC = ("music_play", "music_transfer", "music_stop", "music_transport", "music_play_media")
DIRECT = ("clean_areas", "pause_automation", "resume_automation")      # a page's own, when the bridge is Mantel's
SERVICES = MUSIC + DIRECT
Caller = Callable[[str, str, Mapping[str, Any]], Awaitable[Any]]   # (domain, service, data) -> result, or LinkedError
AUTOMATION = re.compile(r"^automation\.[a-z0-9_]+$")
KEY = "automation_snoozes"
TICK = 30.0


def _err(code: str, message: str):
    from . import LinkedError
    return LinkedError(code, message)


class LinkedActions:
    def __init__(self, app: web.Application) -> None:
        self.app = app
        self.task: asyncio.Task | None = None
        self.listeners: dict[int, Callable[[], None]] = {}
        self._lid = 0

    # -- who it acts as, through which gateway ------------------------------------------------------------
    def principal(self, peer: str | None = None) -> Any:
        from ..alarm_pin import linked_principal
        return linked_principal(self.app, peer)

    def grants(self) -> tuple:
        """The Service actor ``mantel:linked``'s computed grants (see the module's docstring)."""
        from ..alarm_pin import LINKED_ACTOR
        from ..identity.rbac import Grant
        # turning an automation off or on is sensitive in Mantel's RBAC (rbac.SAFE_SERVICES): the snooze needs both
        out = [Grant(effect="allow", actions=("control", "control.sensitive"), resource_kind="domain",
                     resource="automation", users={LINKED_ACTOR}, note="Mantel Link: hk_frontend.pause/resume_automation"),
               Grant(effect="allow", actions=("control",), resource_kind="domain", resource="media_player",
                     users={LINKED_ACTOR}, note="Mantel Link: hk_frontend.music_*"),
               Grant(effect="allow", actions=("control",), resource_kind="feature", resource="music",
                     users={LINKED_ACTOR}, note="Mantel Link: hk_frontend.music_*")]
        host = self.app.get("features")
        if host is not None and host.on("clean_areas"):
            for vac in sorted({v["vacuum"] for v in host.clean_coverage().get("coverage", []) if v.get("taking_part")}):
                out.append(Grant(effect="allow", actions=("control",), resource_kind="entity", resource=vac,
                                 users={LINKED_ACTOR}, note="Mantel Link: hk_frontend.clean_areas"))
        return tuple(out)

    def gateway(self) -> Any:
        from ..ha import gateway as G
        from ..features import FeatureAuthz
        authz, audit = self.app.get("authz"), self.app.get("audit")
        if authz is None or audit is None:
            raise _err("commands_disabled", "Mantel's command gateway isn't wired; nothing was sent")
        extra = self.grants

        class LinkedAuthz(FeatureAuthz):
            def policy_for(self, subject: Any) -> Any:
                from dataclasses import replace
                from ..alarm_pin import LINKED_ACTOR
                policy = self.base.policy_for(subject)
                if subject.user_id != LINKED_ACTOR:
                    return policy
                return replace(policy, grants=tuple(policy.grants) + tuple(extra()))

        gw = self.app.get("gateway")
        writes = gw.writes if gw is not None else G.load_writes()

        class LinkedGateway(G.Gateway):
            @property
            def commander(self_inner) -> Any:
                g = self.app.get("gateway")
                return g.commander if g is not None else self.app.get("commander")

            @commander.setter
            def commander(self_inner, _value: Any) -> None:
                pass
        return LinkedGateway(self.app, LinkedAuthz(authz, lambda: set()), audit, None, writes, lambda: self.app["clock"]())

    async def command(self, domain: str, service: str, data: Mapping[str, Any], peer: str | None,
                      return_response: bool = False) -> Any:
        """One service call through the gateway as ``mantel:linked``; the gateway's refusal as a LinkedError."""
        from ..alarm_pin import linked_error
        got: dict = {}

        async def send(reply: dict) -> None:
            got.update(reply)
        msg = {"type": "command", "id": 1, "kind": "service", "domain": domain, "service": service, "data": dict(data)}
        if return_response:
            msg["return_response"] = True
        await self.gateway().handle(self.principal(peer), msg, send)
        if "result" in got:
            return got["result"]
        raise linked_error(got)

    # -- the actions --------------------------------------------------------------------------------------
    async def call(self, service: str, data: dict[str, Any], ctx: Any) -> Any:
        peer = getattr(ctx, "peer", None)
        if service in MUSIC:
            engine = self.app.get("music")
            if engine is None or not getattr(engine, "active", False):
                raise _err("not_set_up", "Mantel's music isn't on (Music Assistant and the music settings, in "
                                         "Mantel); nothing was sent")
            return await self.command("hk_frontend", service, data, peer, return_response=True)
        if service in DIRECT:
            return await self.act(service, data, self.as_linked(peer))
        raise _err("unknown_service", f"{service} is not one of Mantel's")

    def as_linked(self, peer: str | None) -> Caller:
        """The engines' hands when Home Assistant forwarded the action: ``mantel:linked``'s gateway."""
        async def call(domain: str, service: str, data: Mapping[str, Any]) -> Any:
            return await self.command(domain, service, data, peer)
        return call

    async def act(self, service: str, data: dict[str, Any], call: Caller, may_view: Callable[[list[str]], None] | None
                  = None) -> Any:
        """Clean Areas / the snooze, with every household call made through ``call`` (whoever it acts as)."""
        if service == "clean_areas":
            return await self.clean(data, call, may_view)
        if service == "pause_automation":
            return await self.pause(data, call)
        if service == "resume_automation":
            return await self.resume(data, call)
        raise _err("unknown_service", f"{service} is not one of Mantel's")

    # -- a page's own, as the person who asked --------------------------------------------------------------
    def direct_applies(self) -> bool:
        """Only once Mantel Link holds the bridge. While HK Frontend does, ``hk_frontend.*`` is HK's in Home
        Assistant, with its own Clean Areas settings and its own snooze store (which resumes at midnight with
        Mantel down); running these here as well would split that state in two."""
        owners = self.app.get("linked_owners")
        return owners is not None and owners.bridge() == "mantel"

    def direct_of(self, cmd: Any) -> tuple[str, dict[str, Any], bool] | None:
        """``(service, data, return_response)`` when this classified gateway command is a page's own Clean Areas
        or snooze and runs here; None sends it on as before."""
        frame = getattr(cmd, "frame", None) or {}
        if (getattr(cmd, "kind", None) not in ("service", "ws") or frame.get("type") != "call_service"
                or frame.get("domain") != "hk_frontend" or frame.get("service") not in DIRECT
                or frame.get("target") or not self.direct_applies()):
            return None
        data = frame.get("service_data")
        return frame["service"], dict(data) if isinstance(data, Mapping) else {}, bool(frame.get("return_response"))

    async def run_direct(self, gateway: Any, principal: Any, service: str, data: dict[str, Any]) -> Any:
        """Run one of ``DIRECT`` for ``principal``: each vacuum and automation call goes through ``gateway`` as that
        person (their grants, their audit row, the same refusals as pressing the button). A refusal reaches the
        caller as a LinkedError carrying the gateway's own reply (``.reply``)."""
        from ..alarm_pin import linked_error

        async def call(domain: str, svc: str, payload: Mapping[str, Any]) -> Any:
            got: dict = {}

            async def send(reply: dict) -> None:
                got.update(reply)
            await gateway.handle(principal, {"type": "command", "id": 1, "kind": "service", "domain": domain,
                                             "service": svc, "data": dict(payload)}, send)
            if "result" in got:
                return got["result"]
            exc = linked_error(got)
            exc.reply = got                                # type: ignore[attr-defined]
            raise exc

        def may_view(vacuums: list[str]) -> None:
            # a dry run touches nothing, so no command is there to refuse it: it shows only robots they may see
            ctx = gateway.authz.context()
            for eid in vacuums:
                if not gateway.authz.decide(principal.subject, "view", eid, ctx=ctx).allowed:
                    raise _err("forbidden", f"not allowed: view {eid}")
        return await self.act(service, data, call, may_view)

    async def clean(self, data: dict[str, Any], call: Caller, may_view: Callable[[list[str]], None] | None = None
                    ) -> dict[str, Any]:
        from hk_core import clean_areas as CA
        host = self.app.get("features")
        if host is None or not host.on("clean_areas"):
            raise _err("not_set_up", "Clean Areas is off in Mantel; nothing was sent")
        areas, dry = data.get("areas"), data.get("dry_run", False)
        if (not isinstance(areas, list) or not areas or not all(isinstance(a, str) and a for a in areas)
                or not isinstance(dry, bool) or set(data) - {"areas", "dry_run"}):
            raise _err("invalid", "clean_areas: {areas: [area ids], dry_run?}")
        p = CA.plan(host.house, list(areas), host.settings["clean_areas"]["options"])
        if dry and may_view is not None:
            may_view(sorted({step["vacuum"] for step in p["plan"]}))
        if dry or not p["plan"]:
            return await CA.async_execute(host.house, p, dry_run=True) if p["plan"] else \
                {"ok": False, **p, "message": "No vacuum can reach the selected areas."}
        failed, refused = [], []
        for step in p["plan"]:
            try:
                if step["action"] == "clean_area":
                    await call("vacuum", "clean_area", {"entity_id": step["vacuum"],
                                                        "cleaning_area_id": step["areas"]})
                else:
                    await call("vacuum", "start", {"entity_id": step["vacuum"]})
            except Exception as exc:  # noqa: BLE001 -- one robot failing never stops the rest
                code = getattr(exc, "code", None)
                if code == "commands_disabled" and not failed:
                    raise                                   # the same answer for every robot: say it once
                if code == "forbidden":
                    refused.append(exc)                     # a person may control one robot and not another
                failed.append({"vacuum": step["vacuum"], "error": getattr(exc, "message", str(exc))})
        if refused and len(refused) == len(p["plan"]):
            raise refused[0]                                # every robot refused: the refusal itself, in words
        if failed:
            return {"ok": False, **p, "failed": failed,
                    "message": "Some vacuums did not start: " + ", ".join(f["vacuum"] for f in failed)}
        return {"ok": True, **p}

    # -- automation snooze ----------------------------------------------------------------------------------
    def _snoozes(self) -> dict[str, str]:
        owners = self.app.get("linked_owners")
        got = (owners.remembered(KEY) if owners is not None else None) or {}
        return {k: v for k, v in got.items() if AUTOMATION.match(k) and isinstance(v, str)}

    def _keep(self, snoozes: dict[str, str]) -> None:
        owners = self.app.get("linked_owners")
        if owners is not None:
            before = self._snoozes()
            owners.remember(KEY, dict(sorted(snoozes.items())))
            if before != self._snoozes():
                for cb in list(self.listeners.values()):
                    try:
                        cb()
                    except Exception:  # noqa: BLE001 -- one bad listener never stops the others
                        log.exception("linked actions: a snooze listener failed")

    def _ids(self, data: Mapping[str, Any]) -> list[str]:
        raw = data.get("entity_id")
        ids = [raw] if isinstance(raw, str) else raw
        if not isinstance(ids, list) or not ids or not all(isinstance(e, str) and AUTOMATION.match(e) for e in ids):
            raise _err("invalid", "entity_id: automation entities")
        return list(dict.fromkeys(ids))

    def _midnight(self) -> datetime:
        host = self.app.get("features")
        now = host.house.local_time() if host is not None else datetime.now(timezone.utc)
        return (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)

    async def pause(self, data: dict[str, Any], call: Caller) -> dict[str, Any]:
        if set(data) - {"entity_id", "until"}:
            raise _err("invalid", "pause_automation: {entity_id, until?}")
        ids = self._ids(data)
        until = data.get("until")
        if until is None:
            at = self._midnight()
        else:
            try:
                at = datetime.fromisoformat(str(until))
            except ValueError:
                raise _err("invalid", "until: a date and time") from None
            if at.tzinfo is None:
                host = self.app.get("features")
                at = at.replace(tzinfo=host.house.local_time().tzinfo if host is not None else timezone.utc)
        for eid in ids:
            await call("automation", "turn_off", {"entity_id": eid})
        snoozes = self._snoozes()
        for eid in ids:
            snoozes[eid] = at.astimezone(timezone.utc).isoformat()
        self._keep(snoozes)
        return {"until": {eid: snoozes[eid] for eid in ids}}

    async def resume(self, data: dict[str, Any], call: Caller) -> dict[str, Any]:
        if set(data) - {"entity_id"}:
            raise _err("invalid", "resume_automation: {entity_id}")
        ids = self._ids(data)
        for eid in ids:
            await call("automation", "turn_on", {"entity_id": eid})
        snoozes = self._snoozes()
        for eid in ids:
            snoozes.pop(eid, None)
        self._keep(snoozes)
        return {"resumed": ids}

    async def tick(self) -> list[str]:
        """Turn on what is due; forget a snooze someone ended themself (the automation is on again)."""
        snoozes = self._snoozes()
        if not snoozes:
            return []
        host = self.app.get("features")
        now = datetime.now(timezone.utc)
        done = []
        for eid, iso in list(snoozes.items()):
            st = host.house.state(eid) if host is not None else None
            if st is not None and st.state == "on":
                snoozes.pop(eid)                         # turned on in the meantime: nothing to do
                continue
            try:
                due = datetime.fromisoformat(iso) <= now
            except ValueError:
                snoozes.pop(eid)
                continue
            if due:
                try:
                    await self.command("automation", "turn_on", {"entity_id": eid}, None)
                    done.append(eid)
                except Exception as exc:  # noqa: BLE001 -- commands off: kept, tried again next tick
                    log.info("linked actions: %s is due on again but %s", eid, getattr(exc, "message", exc))
                    continue
                snoozes.pop(eid)
        self._keep(snoozes)
        return done

    async def run(self) -> None:
        while True:
            await asyncio.sleep(TICK)
            try:
                await self.tick()
            except Exception:  # noqa: BLE001 -- the loop never ends on one bad tick
                log.exception("linked actions: the snooze tick failed")


SNOOZE_FEED = "hk_frontend/snooze/subscribe"
ROUTE_RULES = {SNOOZE_FEED: "signed in; {until: {automation: ISO}} from Mantel's snooze record, only the automations "
                            "the subject may view; carries nothing"}


def register(app: web.Application) -> LinkedActions:
    if "linked_actions" in app:
        return app["linked_actions"]
    la = app["linked_actions"] = LinkedActions(app)
    from ..connectors import Ctx, Forbidden, Route, allowed_ids, read_routes

    async def snooze_feed(ctx: Ctx, msg: dict, on_event: Callable[[dict], None]):
        from ..ha.readproxy import ReadBlocked
        if set(msg) - {"type", "id"}:
            raise ReadBlocked(f"{SNOOZE_FEED} carries nothing")
        ident = ctx.identity
        if getattr(ident, "user", None) is None and getattr(ident, "device", None) is None:
            raise Forbidden("sign in to see paused automations")
        reads = app.get("filtered_reads")

        async def send() -> None:
            snoozes = la._snoozes()
            seen = set(await allowed_ids(reads.hooks, ident, "view", sorted(snoozes))) if reads is not None and snoozes \
                else set()
            on_event({"until": {k: v for k, v in snoozes.items() if k in seen}})
        la._lid += 1
        lid = la._lid
        la.listeners[lid] = lambda: asyncio.get_running_loop().create_task(send())
        await send()

        async def unsubscribe() -> None:
            la.listeners.pop(lid, None)

        def recheck() -> bool:            # live.py: still someone (a person or a tablet) whose session holds
            return getattr(ident, "valid", True) is not False and \
                (getattr(ident, "user", None) is not None or getattr(ident, "device", None) is not None)
        unsubscribe.recheck = recheck              # type: ignore[attr-defined]
        return unsubscribe
    read_routes(app)[SNOOZE_FEED] = Route(subscribe=snooze_feed)

    async def started(_app: web.Application) -> None:
        la.task = asyncio.create_task(la.run())

    async def stopped(_app: web.Application) -> None:
        if la.task is not None:
            la.task.cancel()
    app.on_startup.append(started)
    app.on_cleanup.append(stopped)
    return la
