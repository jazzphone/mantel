"""The tools (docs/phase12/MCP-SERVER.md "The tools"): one module per area, each a list of :class:`Tool`.

A tool names the scope it needs (``needs``), whether it writes (a write tool takes ``dry_run`` and ``plan`` and
goes through dispatch.change), and its arguments as JSON Schema. ``tools/list`` shows only what the caller's
scopes allow, in a fixed order; ``tools/call`` checks the scope again, then the arguments against the schema
(:func:`check_args`: the subset these schemas use, strictly: no unknown keys, types, enums, lengths, ranges), then
runs it. What Mantel refuses comes back as the tool's error (``isError``), with Mantel's own words and fields,
so the assistant can fix it and try again.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from ..dispatch import ToolError

Handler = Callable[[Any, dict], Awaitable[Any]]

DRY_RUN = {"type": "boolean", "default": True,
           "description": "true (the default): check the change and answer what it would do, and a `plan`. "
                          "false: apply it; needs that `plan`."}
# why a write tool parallels no REST route (mcp_parity.py): it is a page's socket frame, given to the very function
# that frame calls (mcp/dispatch.py), so it is checked as the page's own frame is, for a person who is an Owner or Admin
NO_ROUTE_SAVE = ("a page's settings_write save over the socket (dispatch.save: SettingsService.save, hk_core's checks "
                 "and RBAC's configure, as the Settings page's own frame)")
NO_ROUTE_RESTORE = ("a page's mantel/settings/restore frame over the socket (dispatch.save: the settings history's "
                    "restore, RBAC's configure on what it restores)")
NO_ROUTE_BATCH = "a batch of the tools above (dispatch.in_batch): each step is checked as that tool alone"
NO_ROUTE_COMMAND = ("a page's command frame over the socket, through the gateway (dispatch.command: RBAC, the audit "
                    "row first, the kill switch); never from a personal key")
PLAN = {"type": "string", "maxLength": 2000, "description": "the `plan` this call's dry run answered"}


@dataclass(frozen=True)
class Tool:
    name: str
    title: str
    description: str
    properties: dict
    handler: Handler
    needs: str = "read"
    required: tuple[str, ...] = ()
    write: bool = False
    planned: bool | None = None           # takes dry_run and plan (dispatch.change); None: as `write`
    destructive: bool = False
    idempotent: bool = False
    output: dict | None = None
    extra: dict = field(default_factory=dict)
    # parity with the REST route it parallels (mcp_parity.py, route_table.py R9/R10): ``like`` names it ("POST
    # /api/screens"), or ``no_route`` says why there is none; ``who`` and ``door`` are enforced on every call
    like: str | tuple[str, ...] | None = None
    no_route: str | None = None
    who: str = "manager"
    door: str = "any"

    def __post_init__(self) -> None:
        from ...mcp_parity import TOOL_DOORS, TOOL_WHO
        if self.who not in TOOL_WHO or self.door not in TOOL_DOORS:
            raise ValueError(f"tool {self.name}: who in {TOOL_WHO}, door in {TOOL_DOORS}")

    def input_schema(self) -> dict:
        props = dict(self.properties)
        if self.takes_plan:
            props["dry_run"] = DRY_RUN
            props["plan"] = PLAN
        return {"type": "object", "properties": props, "required": list(self.required), "additionalProperties": False}

    @property
    def takes_plan(self) -> bool:
        return self.write if self.planned is None else self.planned

    def describe(self) -> dict:
        out = {"name": self.name, "title": self.title, "description": self.description,
               "inputSchema": self.input_schema(),
               "annotations": {"title": self.title, "readOnlyHint": not self.write,
                               "destructiveHint": bool(self.write and self.destructive),
                               "idempotentHint": bool(self.idempotent or not self.write),
                               "openWorldHint": False}}
        if self.output is not None:
            out["outputSchema"] = self.output
        return out


# -- arguments ------------------------------------------------------------------------------------------------------
_TYPES = {"string": str, "boolean": bool, "object": dict, "array": list}


def _check(value: Any, schema: dict, path: str) -> None:
    t = schema.get("type")
    if isinstance(t, list):
        for one in t:
            try:
                _check(value, {**schema, "type": one}, path)
                return
            except ToolError:
                continue
        raise ToolError("invalid_arguments", f"{path}: expected {' or '.join(t)}", {path: "type"})
    if t == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            raise ToolError("invalid_arguments", f"{path}: expected an integer", {path: "type"})
    elif t == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ToolError("invalid_arguments", f"{path}: expected a number", {path: "type"})
    elif t == "null":
        if value is not None:
            raise ToolError("invalid_arguments", f"{path}: expected null", {path: "type"})
    elif t is not None:
        want = _TYPES[t]
        if not isinstance(value, want) or (t != "boolean" and isinstance(value, bool)):
            raise ToolError("invalid_arguments", f"{path}: expected {t}", {path: "type"})
    if "enum" in schema and value not in schema["enum"]:
        raise ToolError("invalid_arguments", f"{path}: one of {schema['enum']}", {path: "choice"})
    if isinstance(value, str):
        if len(value) > schema.get("maxLength", 4000) or len(value) < schema.get("minLength", 0):
            raise ToolError("invalid_arguments", f"{path}: too long or too short", {path: "length"})
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"] or "maximum" in schema and value > schema["maximum"]:
            raise ToolError("invalid_arguments", f"{path}: out of range", {path: "range"})
    if isinstance(value, list):
        if len(value) > schema.get("maxItems", 500):
            raise ToolError("invalid_arguments", f"{path}: too many items", {path: "length"})
        for i, v in enumerate(value):
            if "items" in schema:
                _check(v, schema["items"], f"{path}[{i}]")
    if isinstance(value, dict) and "properties" in schema:
        _object(value, schema, path)


def _object(value: dict, schema: dict, path: str) -> None:
    props = schema.get("properties") or {}
    for k in schema.get("required") or ():
        if k not in value:
            raise ToolError("invalid_arguments", f"{path}.{k}: required", {f"{path}.{k}": "required"})
    if schema.get("additionalProperties") is False:
        extra = sorted(set(value) - set(props))
        if extra:
            raise ToolError("invalid_arguments", f"{path}: unknown argument(s) {extra}", {path: "unexpected"})
    for k, v in value.items():
        if k in props:
            _check(v, props[k], f"{path}.{k}")


def check_args(tool: Tool, args: Any) -> dict:
    if args is None:
        args = {}
    if not isinstance(args, dict):
        raise ToolError("invalid_arguments", "arguments: an object")
    _object(args, tool.input_schema(), "arguments")
    return args


def all_tools() -> list[Tool]:
    """Every tool, in the order tools/list gives them (deterministic, for the clients' caches)."""
    from . import alerts, audit, commands, deploy, house, music, screens, settings
    out: list[Tool] = []
    for m in (house, settings, screens, music, deploy, audit, alerts, commands):
        out.extend(m.TOOLS)
    names = [t.name for t in out]
    assert len(names) == len(set(names)), "tool names are unique"
    return out
