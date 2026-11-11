"""``/mcp``: MCP's Streamable HTTP transport, hand-written on aiohttp (no second web stack, no new dependency).

**Both eras on one endpoint** (MCP 2026-07-28 "Versioning"): a request carrying the modern per-request ``_meta``
(``io.modelcontextprotocol/protocolVersion``) is served statelessly as 2026-07-28 (``server/discover``, no
``initialize``, ``resultType``, ``ttlMs``/``cacheScope`` on lists, ``Mcp-Method``/``Mcp-Name`` checked against the
body); an ``initialize`` is answered as the legacy revision it asks for (2025-11-25, 2025-06-18 or 2025-03-26),
with no ``Mcp-Session-Id`` (the server keeps no session: none is needed). Every request is one POST with one
JSON-RPC message (no batches); every answer is ``application/json``. GET and DELETE are 405: there is no stream
to open and no session to end. Nothing is ever sent unasked (no sampling, no elicitation, no list changes).

**Before anything else**: the ``Origin`` header, when there is one, must be one of Mantel's own addresses (403
otherwise: DNS rebinding); the body is at most 1 MB of JSON; and the caller is authenticated (auth.py): 401 with
``WWW-Authenticate: Bearer resource_metadata=…`` (RFC 9728) tells a client where to sign in. Then the rate limit,
the protocol version, the method.
"""
from __future__ import annotations

import base64
import json
import logging
from typing import Any
from urllib.parse import urlparse

from aiohttp import web

from .. import mcp_parity
from ..identity.guards import WHY_MCP, open_route
from .auth import Caller, Limits, Refused, authenticate
from .dispatch import ToolError

log = logging.getLogger("mantel.mcp")

PATH = "/mcp"
MODERN = ("2026-07-28",)
LEGACY = ("2025-11-25", "2025-06-18", "2025-03-26")
SUPPORTED = MODERN + LEGACY
MAX_BODY = 1 << 20
SERVER_INFO = {"name": "mantel", "title": "Mantel", "version": "1"}
META_VERSION = "io.modelcontextprotocol/protocolVersion"
META_SERVER = "io.modelcontextprotocol/serverInfo"
HEADER_MISMATCH, MISSING_CAPABILITY, UNSUPPORTED_VERSION = -32020, -32021, -32022
LIST_TTL_MS = 60_000
INSTRUCTIONS = (
    "Mantel runs a home's wall tablets and screens over Home Assistant. You act for one person (house_summary says "
    "who and which scopes you have); their roles decide what you may see and change, and every change is in "
    "Mantel's audit log as theirs, through you. Start with house_summary. Every change is planned first: call a "
    "write tool (dry_run defaults to true), show the person the plan's changes, and apply only with their OK, by "
    "calling again with dry_run: false and the plan. Each applied change answers how to undo it (settings_restore). "
    "Use settings_schema and grid_cards to learn what settings and Home Grid layouts accept; a refusal names the "
    "field and the reason, so fix it and plan again. Enrolling a wall tablet stays a person's step (tablet_setup).")


def _version_text() -> str:
    try:
        from ..pages.about import release
        return str(release().get("version") or "1")
    except Exception:  # noqa: BLE001
        return "1"


class Reply(Exception):
    """An HTTP answer decided before the method runs (a refusal, a version error)."""

    def __init__(self, status: int, body: dict | None, headers: dict | None = None) -> None:
        super().__init__(status)
        self.status, self.body, self.headers = status, body, headers or {}


def _error(rid: Any, code: int, message: str, data: Any = None) -> dict:
    err: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    out: dict[str, Any] = {"jsonrpc": "2.0", "error": err}
    if rid is not None:
        out["id"] = rid
    return out


def _json(status: int, body: dict | None, headers: dict | None = None) -> web.Response:
    h = {"Cache-Control": "no-store", **(headers or {})}
    if body is None:
        return web.Response(status=status, headers=h)
    return web.Response(status=status, text=json.dumps(body, separators=(",", ":"), default=str),
                        content_type="application/json", headers=h)


# -- the door ----------------------------------------------------------------------------------------------------
def own_origins(request: web.Request) -> set[str]:
    cfg = request.app.get("cfg")
    out = set()
    pub = getattr(cfg, "public_url", "") if cfg is not None else ""
    if pub:
        u = urlparse(pub)
        out.add(f"{u.scheme}://{u.netloc}".lower())
    return out


def check_origin(request: web.Request) -> None:
    origin = request.headers.get("Origin")
    if origin is None:
        return                                    # an MCP client (not a browser page) sends none
    if origin.lower().rstrip("/") not in own_origins(request):
        raise Reply(403, _error(None, -32600, "this Origin may not use Mantel's MCP endpoint"))


def resource_url(request: web.Request) -> str:
    from ..network.proxy_trust import public_origin
    return public_origin(request) + PATH


def www_authenticate(request: web.Request, exc: Refused) -> str:
    from ..network.proxy_trust import public_origin
    meta = f"{public_origin(request)}/.well-known/oauth-protected-resource{PATH}"
    out = f'Bearer resource_metadata="{meta}"'
    if exc.code == "invalid_token":
        out += ', error="invalid_token"'
    return out


# -- the version ---------------------------------------------------------------------------------------------------
def _decode_header(v: str | None) -> str | None:
    if v is not None and v.startswith("=?base64?") and v.endswith("?="):
        try:
            return base64.b64decode(v[9:-2], validate=True).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            raise Reply(400, _error(None, HEADER_MISMATCH, "a Base64 header value could not be read")) from None
    return v


def era(request: web.Request, msg: dict) -> tuple[str, str]:
    """('modern' | 'legacy', the protocol version) for this request, or Reply (400) with the reason."""
    rid, method = msg.get("id"), msg.get("method")
    params = msg.get("params") if isinstance(msg.get("params"), dict) else {}
    meta = params.get("_meta") if isinstance(params.get("_meta"), dict) else {}
    header = request.headers.get("MCP-Protocol-Version")
    if method == "initialize":
        asked = params.get("protocolVersion")
        return "legacy", asked if asked in LEGACY else LEGACY[0]
    modern = meta.get(META_VERSION)
    if modern is not None:
        if modern not in MODERN:
            raise Reply(400, _error(rid, UNSUPPORTED_VERSION, "Unsupported protocol version",
                                    {"supported": list(SUPPORTED), "requested": modern}))
        if header != modern:
            raise Reply(400, _error(rid, HEADER_MISMATCH, "MCP-Protocol-Version does not match the request's _meta"))
        if request.headers.get("Mcp-Method") != method:
            raise Reply(400, _error(rid, HEADER_MISMATCH, "Mcp-Method is missing or does not match the method"))
        if method in ("tools/call", "prompts/get", "resources/read"):
            want = params.get("uri") if method == "resources/read" else params.get("name")
            if _decode_header(request.headers.get("Mcp-Name")) != want:
                raise Reply(400, _error(rid, HEADER_MISMATCH, "Mcp-Name is missing or does not match the body"))
        return "modern", modern
    version = header or "2025-03-26"
    if version in MODERN:
        raise Reply(400, _error(rid, HEADER_MISMATCH, f"a {version} request carries {META_VERSION} in params._meta"))
    if version not in LEGACY:
        raise Reply(400, _error(rid, UNSUPPORTED_VERSION, "Unsupported protocol version",
                                {"supported": list(SUPPORTED), "requested": version}))
    return "legacy", version


# -- the methods ---------------------------------------------------------------------------------------------------
def capabilities() -> dict:
    return {"tools": {"listChanged": False}, "resources": {"listChanged": False, "subscribe": False},
            "prompts": {"listChanged": False}}


def server_info() -> dict:
    return {**SERVER_INFO, "version": _version_text()}


def visible_tools(caller: Caller) -> list:
    from .tools import all_tools
    return [t for t in all_tools() if caller.has(t.needs)]


async def call_tool(caller: Caller, params: dict) -> dict:
    from .tools import all_tools, check_args
    name = params.get("name")
    tool = next((t for t in all_tools() if t.name == name), None)
    if tool is None:
        raise LookupError(name)
    try:
        if not caller.has(tool.needs):
            raise ToolError("forbidden", f"{name} needs the {tool.needs!r} scope, which this assistant was not given")
        mcp_parity.check(tool, caller)        # never easier than the REST route it parallels (route_table R10)
        args = check_args(tool, params.get("arguments"))
        if tool.write and not tool.takes_plan:
            limits = caller.app["mcp_limits"]
            if not limits.take(caller.grant.id, "write", int(caller.app["mcp_settings"].get("mcp_write_rate"))):
                raise ToolError("rate_limited", "too many changes this minute: wait, then try again")
        result = await tool.handler(caller, args)
    except ToolError as exc:
        log.info("assistant %s: %s refused (%s)", caller.grant.id, name, exc.code)
        body = exc.body()
        return {"content": [{"type": "text", "text": json.dumps(body, default=str)}], "structuredContent": body,
                "isError": True}
    log.info("assistant %s (%s): %s", caller.grant.id, caller.grant.name, name)
    if not isinstance(result, dict):
        result = {"result": result}
    return {"content": [{"type": "text", "text": json.dumps(result, indent=1, default=str)}],
            "structuredContent": result, "isError": False}


async def run_method(caller: Caller, kind: str, version: str, msg: dict) -> tuple[int, dict]:
    from . import resources as R
    rid, method = msg.get("id"), msg.get("method")
    params = msg.get("params") if isinstance(msg.get("params"), dict) else {}
    not_found = 404 if kind == "modern" else 200
    cacheable = False
    if method == "initialize":
        result: dict = {"protocolVersion": version, "capabilities": capabilities(), "serverInfo": server_info(),
                        "instructions": INSTRUCTIONS}
    elif method == "server/discover" and kind == "modern":
        result = {"supportedVersions": list(SUPPORTED), "capabilities": capabilities(), "instructions": INSTRUCTIONS}
        cacheable = True
    elif method == "ping" and kind == "legacy":
        result = {}
    elif method == "logging/setLevel" and kind == "legacy":
        result = {}
    elif method == "tools/list":
        result = {"tools": [t.describe() for t in visible_tools(caller)]}
        cacheable = True
    elif method == "tools/call":
        try:
            result = await call_tool(caller, params)
        except LookupError:
            return 200, _error(rid, -32602, f"Unknown tool: {params.get('name')!r}")
    elif method == "resources/list":
        result = {"resources": R.listing(caller)}
        cacheable = True
    elif method == "resources/templates/list":
        result = {"resourceTemplates": R.templates(caller)}
        cacheable = True
    elif method == "resources/read":
        uri = params.get("uri")
        if not isinstance(uri, str):
            return 200, _error(rid, -32602, "resources/read needs a uri")
        try:
            result = {"contents": [await R.read_resource(caller, uri)]}
        except ToolError as exc:
            code = -32602 if kind == "modern" else -32002
            return 200, _error(rid, code, exc.message, {"uri": uri})
        cacheable = True
    elif method == "prompts/list":
        result = {"prompts": R.prompt_list()}
        cacheable = True
    elif method == "prompts/get":
        try:
            result = R.prompt_get(str(params.get("name")), params.get("arguments"))
        except KeyError:
            return 200, _error(rid, -32602, f"Unknown prompt: {params.get('name')!r}")
        except ValueError as exc:
            return 200, _error(rid, -32602, str(exc))
    else:
        return not_found, _error(rid, -32601, f"Method not found: {method!r}")
    if kind == "modern":
        result = {"resultType": "complete", **result,
                  "_meta": {**(result.get("_meta") or {}), META_SERVER: server_info()}}
        if cacheable:
            result.update(ttlMs=LIST_TTL_MS, cacheScope="private")
    return 200, {"jsonrpc": "2.0", "id": rid, "result": result}


# -- the handler ---------------------------------------------------------------------------------------------------
async def _read_body(request: web.Request) -> Any:
    if request.content_type != "application/json":
        raise Reply(415, _error(None, -32700, "send application/json"))
    if request.content_length is not None and request.content_length > MAX_BODY:
        raise Reply(413, _error(None, -32600, "the request is larger than 1 MB"))
    raw = await request.content.read(MAX_BODY + 1)
    if len(raw) > MAX_BODY:
        raise Reply(413, _error(None, -32600, "the request is larger than 1 MB"))
    try:
        return json.loads(raw)
    except (ValueError, UnicodeDecodeError, RecursionError):
        raise Reply(400, _error(None, -32700, "Parse error")) from None


# reads="admin": every assistant acts for an Owner or Admin (mcp/auth.py, each request), and its settings, audit and
# alerts tools answer what Mantel Settings shows them; its house tools name entities through authz.may_read(view)
@open_route("mcp_bearer", why=WHY_MCP, reads="admin")
async def handle(request: web.Request) -> web.StreamResponse:
    try:
        check_origin(request)
        if request.method != "POST":
            raise Reply(405, _error(None, -32600, "POST one JSON-RPC message (there is no stream and no session)"),
                        {"Allow": "POST"})
        msg = await _read_body(request)
        if isinstance(msg, list):
            raise Reply(400, _error(None, -32600, "one JSON-RPC message per request (no batches)"))
        if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
            raise Reply(400, _error(None, -32600, "Invalid Request"))
        rid = msg.get("id")
        if "method" not in msg:
            raise Reply(400, _error(rid, -32600, "Mantel sends no requests, so it takes no responses"))
        if not isinstance(msg["method"], str) or (rid is not None and not isinstance(rid, (str, int))) \
                or isinstance(rid, bool):
            raise Reply(400, _error(rid, -32600, "Invalid Request"))
        try:
            caller = authenticate(request)
        except Refused as exc:
            headers = {"WWW-Authenticate": www_authenticate(request, exc)} if exc.status == 401 else {}
            raise Reply(exc.status, _error(rid, -32001, exc.message, {"code": exc.code}), headers) from None
        if not caller.app["mcp_limits"].read(caller.grant.id):
            raise Reply(429, _error(rid, -32000, "too many requests this minute"), {"Retry-After": "60"})
        kind, version = era(request, msg)
        if "id" not in msg:                       # a notification: taken, and nothing to answer
            return _json(202, None)
        status, body = await run_method(caller, kind, version, msg)
        return _json(status, body)
    except Reply as r:
        return _json(r.status, r.body, r.headers)


def register(app: web.Application) -> None:
    app.router.add_route("*", PATH, handle)
    app.setdefault("public_paths", set()).add(PATH)          # its own check: the bearer credential (auth.py)
    app["mcp_limits"] = Limits()
