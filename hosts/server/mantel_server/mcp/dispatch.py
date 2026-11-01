"""MCP is another door, not another way in: a tool call becomes the frame a page would send.

* :func:`read` is a page's ``read`` frame, answered by the very handler the socket uses (``ws_handlers["read"]``:
  app["read_routes"] first, then the RBAC-filtered reads), with the caller's principal.
* :func:`save` is a page's ``settings_write`` save, given to the very function that frame calls
  (``SettingsService.save``: the save's type decides, ``SAVE_KINDS``, ``WRITE_KEYS``, hk_core's checks, RBAC's
  ``configure``). A save the Settings page would be refused is refused here, with the same words.
* :func:`command` is a page's ``command`` frame, through the gateway (its RBAC, its audit row first, the kill
  switch): nothing reaches Home Assistant any other way.

:func:`change` is every write tool's shape: a plan first (dry_run.py, plans.py), then the same call applied.
"""
from __future__ import annotations

import asyncio
import contextvars
import json
import logging
from typing import Any, Awaitable, Callable

from .. import dry_run
from ..connectors import Ctx, Forbidden, ws_handlers
from .plans import PlanError

log = logging.getLogger("mantel.mcp")

READ_TIMEOUT = 20.0
# inside a plan: every step's planned documents, in order (a tool may make several saves; each is planned against
# the house as it is now, and the plan holds the versions of all of them)
_COLLECTED: contextvars.ContextVar[list | None] = contextvars.ContextVar("mantel_mcp_planned", default=None)
# inside settings_apply (tools/deploy.py): a step's change() is only its work; the batch plans and applies them all
_IN_BATCH: contextvars.ContextVar[bool] = contextvars.ContextVar("mantel_mcp_batch", default=False)


async def in_batch(work: Callable[[], Awaitable[Any]]) -> Any:
    token = _IN_BATCH.set(True)
    try:
        return await work()
    finally:
        _IN_BATCH.reset(token)


class ToolError(Exception):
    """A refusal the assistant can act on: ``code``, words, and the fields at fault (hk_core's codes)."""

    def __init__(self, code: str, message: str, fields: dict | None = None, **extra) -> None:
        super().__init__(message)
        self.code, self.message, self.fields, self.extra = code, message, fields or None, extra

    def body(self) -> dict:
        out = {"error": self.code, "message": self.message}
        if self.fields:
            out["fields"] = self.fields
        out.update(self.extra)
        return out


def _from_settings_error(exc: Exception) -> ToolError:
    from ..settings_store import SettingsError
    if isinstance(exc, SettingsError):
        return ToolError(exc.code, str(exc) or exc.code, getattr(exc, "fields", None))
    if isinstance(exc, Forbidden):
        return ToolError("forbidden", str(exc) or "not allowed for this person")
    if isinstance(exc, PlanError):
        return ToolError(exc.code, str(exc))
    raise exc


async def read(caller, inner: dict) -> Any:
    """One read, as the page's ``read`` frame. Its error is a ToolError with the read's own code."""
    got: list[dict] = []
    done = asyncio.Event()

    async def send(frame: dict) -> None:
        got.append(frame)
        done.set()

    ctx = Ctx(send=send, identity=caller.principal)
    handler = ws_handlers(caller.app).get("read")
    if handler is None:
        raise ToolError("unavailable", "Mantel's reads are not ready")
    try:
        await asyncio.wait_for(handler(ctx, {"type": "read", "id": 1, "msg": dict(inner)}), READ_TIMEOUT)
        await asyncio.wait_for(done.wait(), READ_TIMEOUT)
    except asyncio.TimeoutError:
        raise ToolError("timeout", f"{inner.get('type')} took too long") from None
    finally:
        await ctx.close()
    frame = got[0]
    if "error" in frame:
        err = frame["error"] or {}
        raise ToolError(str(err.get("code") or "failed"), str(err.get("message") or "the read failed"))
    return frame.get("result")


async def step(work: Callable[[], Awaitable[Any]]) -> Any:
    """One step that may write the settings store: run as is, or inside a plan collected (its result is then
    ``{"planned": true}``: nothing was written, so there is nothing else to say)."""
    collected = _COLLECTED.get()
    if collected is None:
        return await work()
    try:
        return await work()
    except dry_run.Planned as planned:
        collected.extend(planned.docs)
        return {"planned": True}


async def save(caller, msg: dict) -> Any:
    """One save, as the page's ``settings_write`` frame's ``msg``."""
    service = caller.app.get("settings")
    if service is None:
        raise ToolError("unavailable", "Mantel's settings are not ready")

    async def work():
        try:
            return await service.save(caller.principal, dict(msg))
        except dry_run.Planned:
            raise
        except Exception as exc:  # noqa: BLE001 -- SettingsError and Forbidden become the tool's refusal
            raise _from_settings_error(exc) from None
    return await step(work)


async def command(caller, msg: dict) -> Any:
    """One house command, as the page's ``command`` frame, through the gateway."""
    gw = caller.app.get("gateway")
    if gw is None:
        raise ToolError("commands_disabled", "Allow Control of the House is off (Mantel Settings → General): this "
                                             "Mantel sends no commands")
    got: dict = {}

    async def send(reply: dict) -> None:
        got.update(reply)
    await gw.handle(caller.principal, {"type": "command", "id": 1, **msg}, send)
    if "result" in got and "error" not in got:
        return {"result": got.get("result"), "audit_id": got.get("audit_id")}
    err = got.get("error") or {"code": "failed"}
    raise ToolError(str(err.get("code") or "failed"), str(err.get("message") or err.get("reason") or "refused"),
                    audit_id=got.get("audit_id"))


# -- plan, then apply ------------------------------------------------------------------------------------------------
async def change(caller, tool: str, args: dict, run: Callable[[], Awaitable[Any]]) -> dict:
    """A write tool's call: ``dry_run`` (the default) plans ``run()`` and answers what it would change and the plan;
    ``dry_run: false`` with that plan checks nothing moved since, then runs it for real."""
    if _IN_BATCH.get():
        return await step(run)
    service = caller.app["settings"]
    plans = caller.app["mcp_plans"]
    if args.get("dry_run", True) is not False:
        docs: list[dict] = []
        result = None
        token = _COLLECTED.set(docs)
        try:
            with dry_run.planning():
                result = await step(run)
        finally:
            _COLLECTED.reset(token)
        if result == {"planned": True}:
            result = None
        versions: dict[str, int] = {}
        for d in docs:
            versions.setdefault(f"{d['scope']}/{d['key']}", d["version"])
        out = {"planned": True, "plan": plans.make(caller.grant.id, tool, args, versions),
               "changes": [{"scope": d["scope"], "key": d["key"], "version": d["version"], "next": d["next"],
                            "removed": d["removed"], "diff": d["diff"]} for d in docs],
               "apply": "call again with the same arguments, dry_run: false and this plan"}
        if not docs:
            out["note"] = "nothing would change"
            if result is not None:
                out["result"] = result
        return out
    try:
        versions = plans.check(args.get("plan"), caller.grant.id, tool, args)
    except PlanError as exc:
        raise ToolError(exc.code, str(exc)) from None
    for name, version in versions.items():
        scope, _, key = name.partition("/")
        cur = service.store.get(scope, key)
        if (cur.version if cur else 0) != version:
            raise ToolError("conflict", f"{name} changed since the plan (version {version}, now "
                                        f"{cur.version if cur else 0}): plan again")
    limits = caller.app["mcp_limits"]
    if not limits.take(caller.grant.id, "write", int(caller.app["mcp_settings"].get("mcp_write_rate"))):
        raise ToolError("rate_limited", "too many changes this minute: wait, then apply the plan again")
    # THE AUDIT ROW FIRST (Rules.md rule 7): the person, through this assistant, applying this plan
    from .. import audit
    detail = {"tool": tool, "documents": sorted(versions),
              "arguments": json.dumps({k: v for k, v in args.items() if k not in ("dry_run", "plan")},
                                      default=str, separators=(",", ":"))[:600]}
    try:
        audit.config(caller.request, caller.principal, "mcp." + tool, detail, app=caller.app)
    except audit.Unavailable:
        raise ToolError("audit_unavailable", "the audit log could not be written, so nothing was changed") from None
    result = await run()
    applied = []
    for name, version in versions.items():
        scope, _, key = name.partition("/")
        cur = service.store.get(scope, key)
        now = cur.version if cur else 0
        if now != version:
            applied.append({"scope": scope, "key": key, "version": now, "previous": version,
                            "undo": {"tool": "settings_restore", "scope": scope, "key": key, "version": version}
                            if version else None})
    log.info("assistant %s (%s) applied %s for %s", caller.grant.id, caller.grant.name, tool, caller.user.id)
    return {"applied": True, "result": result, "changes": applied}
