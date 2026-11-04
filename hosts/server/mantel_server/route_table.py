"""One route table, assembled from each handler's declaration (phase 18, Part A; Rules.md rule 7).

Every audit found the same bug: a new door to an old thing, checked less than the old door. So every route Mantel
serves declares, on its handler, who may use it, from which doors, how fresh the sign-in must be, what a read may
show (``reads``), whether its answer streams (``stream``), whether a screen preview may fetch it (``preview``) and the
audit action a change writes: ``@guard`` (guards.py) for a route called with a session, ``@open_route`` for one that
checks its caller its own way. This module walks the router, builds one :class:`Row` per route and applies the rules
below. ``build_app`` ends with :func:`install`, and a route that is missing or contradicts its rules stops the start
(:class:`RouteTableError`): it is a programming error, the same on every start of one build.

The rules (docs/phase18/CODE-HEALTH.md):

R1   a route with neither ``__guard__`` nor ``__open__`` (or with both)
R2   a declaration that contradicts itself (guards.Guard / OpenRoute refuse at import; here: ``preview`` on a change)
R3   a guarded change with neither an audit action nor a reason
R4   a GET with no ``reads``
R5   a ``live:<kind>`` that ``live.KINDS`` doesn't know, or a handler whose source opens a stream while it says
     ``stream="none"``
R6   ``preview=True`` on anything but a GET
R7   an own-check route of a kind with a structural proof that lacks it (``app_dpop``: wrapped by
     ``app_auth.app_route``; ``public``: only the health routes)
R8   a guarded route on the session middleware's public list, or an address on that list that isn't on SIGNED_OUT
R9   a write tool (mcp/tools/) that names no ``like=`` route (or ``no_route=`` with a reason), or names one that
     doesn't exist
R10  a tool whose scope is easier to get than its route's rule (``mcp_parity``)
R11  a route shadowed by an earlier pattern: its sample path must resolve to itself
R12  two rows with the same method and path
R13  a socket read or Mantel Link message with no declaration in socket_reads.py, or one declared that isn't

``docs/development/Routes.md`` and ``tests/fixtures/route_table.lock.json`` are generated from the table
(``tools/route_table.py --write``); a test fails when they are stale.
"""
from __future__ import annotations

import inspect
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

from aiohttp import web

from .guards import UNSAFE, Guard, OpenRoute, policy_of

log = logging.getLogger("mantel.route_table")

APP_KEY = "route_table"
PUBLIC_ROUTES = frozenset({"/healthz", "/api/version", "/api/proxy-check/basics"})
# every address the session middleware lets through signed out (auth.PUBLIC_PATHS and app["public_paths"],
# app["public_prefixes"]): R8 refuses one that isn't here, so a route made public is a reviewed line in this file
SIGNED_OUT = frozenset({
    "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/mcp", "/admin", "/api/app/art", "/api/app/command", "/api/app/entities",
    "/api/app/favorites", "/api/app/hello", "/api/app/me", "/api/app/music", "/api/app/music/command",
    "/api/app/music/focus", "/api/app/music/image", "/api/app/music/library", "/api/app/music/queue",
    "/api/app/music/queue/play", "/api/app/music/volume", "/api/app/push/register", "/api/app/sign-out",
    "/api/app/snap", "/api/app/summary", "/api/app/token", "/api/app/web-session", "/api/auth/passkey/options",
    "/api/auth/passkey/verify", "/api/auth/password", "/api/auth/totp/verify", "/api/bootstrap",
    "/api/bootstrap/restore", "/api/proxy-check/basics", "/api/version", "/app/art/apple-touch-icon.png",
    "/app/art/badge-96.png", "/app/art/mantel-192.png", "/app/art/mantel-512.png", "/app/art/mantel-maskable-512.png",
    "/app/authorize", "/app/web-session", "/apple-touch-icon.png", "/auth/callback", "/auth/connection/callback",
    "/healthz", "/ingress/bootstrap", "/linked/pair", "/linked/ws", "/login", "/login/ha", "/login/login.css",
    "/login/login.js", "/logout", "/manifest.webmanifest", "/mcp", "/mcp/oauth/authorize", "/mcp/oauth/register",
    "/mcp/oauth/revoke", "/mcp/oauth/token", "/sw.js", "/webauthn.js"})
SIGNED_OUT_PREFIXES = frozenset({"/mcp/preview/"})
# what opens a stream in a handler's own source (R5): a heuristic over text, stated as one
STREAM_MARKS = re.compile(r"\b(?:web\.)?(?:StreamResponse|WebSocketResponse|FileResponse)\(|\.prepare\(|"
                          r"\bfile_response\(|\bproxy_image\(")
# sample values tried, in order, for a path parameter (the first its pattern takes)
SAMPLES = ("sample", "a-b", "0" * 32, "0" * 16, "alarm_control_panel.sample", "thumb", "sample/x")


class RouteTableError(RuntimeError):
    """A route that is undeclared or contradicts its rules: Mantel doesn't start (decision 2)."""

    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__("the route table refuses to start:\n  " + "\n  ".join(problems))


@dataclass
class Row:
    method: str
    path: str
    policy: Guard | OpenRoute | None
    module: str
    handler: str
    func: Any = field(repr=False, compare=False, default=None)
    resource: Any = field(repr=False, compare=False, default=None)
    pattern: str | None = None
    mcp: tuple[str, ...] = ()

    @property
    def key(self) -> str:
        return f"{self.method} {self.path}"

    @property
    def guard(self) -> Guard | None:
        return self.policy if isinstance(self.policy, Guard) else None

    @property
    def open(self) -> OpenRoute | None:
        return self.policy if isinstance(self.policy, OpenRoute) else None

    @property
    def changes(self) -> bool:
        return self.method in UNSAFE or self.method == "*"

    @property
    def reads_data(self) -> bool:
        return self.method in ("GET", "*")

    def sample(self) -> str | None:
        """A path that reaches this route (``sample=`` on its declaration, else each parameter filled)."""
        if self.policy is not None and self.policy.sample:
            return self.policy.sample
        return sample_path(self.path, self.pattern)

    def columns(self) -> dict:
        """What the lock and Routes.md show: every column, the defaults filled in."""
        p = self.policy
        out: dict[str, Any] = {"module": self.module, "handler": self.handler}
        if isinstance(p, Guard):
            out.update(who=p.who, device_ok=p.device_ok, door=p.door, fresh=p.fresh,
                       audit=list(p.audit), no_audit=p.no_audit, first=p.first is not None)
            out["csrf"] = "session" if self.changes and self.path.startswith("/api/") else "-"
        elif isinstance(p, OpenRoute):
            out.update(kind=p.kind, why=p.why, csrf="own" if self.changes else "-")
        out.update(reads=p.reads if p else None, reads_why=getattr(p, "why", None) if p and p.reads == "none" else None,
                   stream=p.stream if p else None, preview=p.preview if p else None, mcp=list(self.mcp))
        if isinstance(p, OpenRoute):
            out.pop("reads_why")
        return out


def sample_path(path: str, pattern: str | None) -> str | None:
    """Fill each ``{name}`` of ``path`` with the first of SAMPLES its regex (from ``pattern``) takes."""
    if "{" not in path:
        return path
    if pattern is None:
        return None
    names = re.findall(r"\{([^}:]+)(?::[^}]*)?\}", path)
    regex = re.compile(pattern)
    groups = dict(re.findall(r"\(\?P<([^>]+)>((?:[^()]|\([^()]*\))*)\)", pattern))
    out = path
    for name in names:
        part = groups.get(name, "[^{}/]+")
        value = next((v for v in SAMPLES if re.fullmatch(part, v)), None)
        if value is None:
            return None
        out = re.sub(r"\{" + re.escape(name) + r"(?::[^}]*)?\}", value, out, count=1)
    return out if regex.fullmatch(out) else None


def _path_of(resource: Any) -> tuple[str, str | None]:
    info = resource.get_info() if resource is not None else {}
    path = info.get("path") or info.get("formatter") or info.get("prefix") or ""
    pattern = info["pattern"].pattern if "pattern" in info else None
    return path, pattern


def _unwrap(handler: Any) -> Any:
    seen = 0
    while hasattr(handler, "__wrapped__") and seen < 8:
        handler = handler.__wrapped__
        seen += 1
    return getattr(handler, "__app_route_handler__", handler)


def build(app: web.Application, tools: Iterable[Any] | None = None) -> list[Row]:
    """One row per route (method and path; HEAD, which aiohttp adds beside each GET, left out)."""
    rows: list[Row] = []
    for route in app.router.routes():
        if route.method == "HEAD":
            continue
        path, pattern = _path_of(route.resource)
        h = route.handler
        rows.append(Row(route.method, path, policy_of(h), getattr(h, "__module__", "?"),
                        getattr(h, "__qualname__", repr(h)), h, route.resource, pattern))
    if tools is not None:
        by_key: dict[str, list[str]] = {}
        for tool in tools:
            like = getattr(tool, "like", None)
            for one in (like,) if isinstance(like, str) else (like or ()):
                by_key.setdefault(one, []).append(tool.name)
        for row in rows:
            row.mcp = tuple(sorted(by_key.get(row.key, ())))
    return rows


def opens_stream(func: Any) -> bool:
    """Whether a handler's own source opens a stream (R5's scan; it can't see what a callee does)."""
    try:
        src = inspect.getsource(_unwrap(func))
    except (OSError, TypeError):
        return False
    return bool(STREAM_MARKS.search(src))


def _resolves_to_itself(app: web.Application, row: Row) -> bool | None:
    sample = row.sample()
    if sample is None:
        return None
    method = "GET" if row.method == "*" else row.method
    for resource in app.router.resources():
        match = getattr(resource, "_match", None)
        if match is None or match(sample) is None:
            continue
        if not any(r.method in (method, "*") for r in resource):
            continue
        return resource is row.resource
    return False


def problems(app: web.Application, rows: list[Row] | None = None, tools: Iterable[Any] | None = None,
             public: Iterable[str] = ()) -> list[str]:
    """Every rule each row breaks, as one line each (empty: the table holds)."""
    from . import live
    rows = build(app, tools) if rows is None else rows
    out: list[str] = []
    seen: dict[str, Row] = {}
    public = set(public)
    for row in rows:
        where = f"{row.key} ({row.module}.{row.handler})"
        p = row.policy
        if getattr(row.func, "__guard__", None) is not None and getattr(row.func, "__open__", None) is not None:
            out.append(f"R1 {where}: both @guard and @open_route")
        if getattr(row.func, "__guard__", None) is not None and getattr(row.func, "__guard_of__", None) is not row.func:
            out.append(f"R1 {where}: a guard copied from another handler (functools.wraps), not its own")
        if p is None:
            out.append(f"R1 {where}: no @guard and no @open_route")
            continue
        if row.key in seen:
            out.append(f"R12 {where}: the same method and path as {seen[row.key].module}.{seen[row.key].handler}")
        seen[row.key] = row
        g = row.guard
        if g is not None and row.changes and not g.audit and not (g.no_audit and g.no_audit.strip()):
            out.append(f"R3 {where}: a change with no audit action and no reason")
        if row.reads_data and p.reads is None:
            out.append(f"R4 {where}: a read with no reads= (view, feature:<name>, self, admin or none)")
        if p.stream.startswith("live:") and p.stream.split(":", 1)[1] not in live.KINDS:
            out.append(f"R5 {where}: stream={p.stream!r}, not a kind live.py knows ({sorted(live.KINDS)})")
        if p.stream == "none" and opens_stream(row.func):
            out.append(f"R5 {where}: opens a stream and says stream='none'")
        if p.preview and row.method != "GET":
            out.append(f"R6 {where}: a screen preview only reads (preview on {row.method})")
        o = row.open
        if o is not None:
            if o.kind == "app_dpop" and not getattr(row.func, "__app_route__", False):
                out.append(f"R7 {where}: kind app_dpop, not wrapped by app_auth.app_route")
            if o.kind == "public" and row.path not in PUBLIC_ROUTES:
                out.append(f"R7 {where}: kind public is only for {sorted(PUBLIC_ROUTES)}")
            if o.kind in ("proxy", "mcp_bearer"):
                # a heuristic over the handler's own source, stated as one: proxy calls .authorize( (the service's
                # grant, media_proxy.py); mcp_bearer calls authenticate( (mcp/auth.py) before it runs a method
                try:
                    src = inspect.getsource(_unwrap(row.func))
                except (OSError, TypeError):
                    src = ""
                if o.kind == "proxy" and ".authorize(" not in src:
                    out.append(f"R7 {where}: kind proxy, and its handler never calls .authorize(")
                who_at, run_at = src.find("authenticate("), src.find("run_method(")
                if o.kind == "mcp_bearer" and (who_at < 0 or 0 <= run_at < who_at):
                    out.append(f"R7 {where}: kind mcp_bearer, and its handler does not call authenticate( before run_method(")
        if g is not None and row.path in public:
            out.append(f"R8 {where}: guarded and on the session middleware's public list")
        if _resolves_to_itself(app, row) is False:
            out.append(f"R11 {where}: its sample path {row.sample()!r} reaches another route first")
    for path in sorted(public - SIGNED_OUT):
        out.append(f"R8 {path}: open to anyone signed out and not on route_table.SIGNED_OUT")
    for prefix in sorted(set(app.get("public_prefixes", ())) - SIGNED_OUT_PREFIXES):
        out.append(f"R8 {prefix}*: open to anyone signed out and not on route_table.SIGNED_OUT_PREFIXES")
    if tools is not None:
        out.extend(tool_problems(rows, tools))
    return out


def tool_problems(rows: list[Row], tools: Iterable[Any]) -> list[str]:
    """R9 and R10 for the assistants' tools (mcp/tools/; the parity table is ``mcp_parity``)."""
    from .mcp_parity import looser
    by_key = {r.key: r for r in rows}
    out: list[str] = []
    for tool in tools:
        like = getattr(tool, "like", None)
        likes = (like,) if isinstance(like, str) else tuple(like or ())
        if tool.write and not likes and not (getattr(tool, "no_route", None) or "").strip():
            out.append(f"R9 tool {tool.name}: writes and names no like= route (or no_route= with a reason)")
        for one in likes:
            row = by_key.get(one)
            if row is None:
                out.append(f"R9 tool {tool.name}: like={one!r} is not a route")
                continue
            why = looser(tool, row)
            if why:
                out.append(f"R10 tool {tool.name}: looser than {one}: {why}")
    return out


def public_paths(app: web.Application) -> set[str]:
    from . import auth
    return set(auth.PUBLIC_PATHS) | set(app.get("public_paths", ()))


def all_tools() -> list[Any]:
    from .mcp.tools import all_tools as tools
    return tools()


def install(app: web.Application, strict: bool = True,
            report: Callable[[list[str]], None] | None = None) -> list[Row]:
    """Build the table into ``app["route_table"]`` and apply every rule: a broken one raises
    :class:`RouteTableError` (``strict``) or is logged."""
    from . import socket_reads
    tools = all_tools()
    rows = build(app, tools)
    app[APP_KEY] = rows
    found = problems(app, rows, tools, public_paths(app)) + socket_reads.problems(app)
    if found:
        if report is not None:
            report(found)
        if strict:
            raise RouteTableError(found)
        for line in found:
            log.warning("route table: %s", line)
    return rows


def witness(app: web.Application) -> list[str]:
    """For tests (R5's other half): record every answer that goes out as a stream (a WebSocket, a file, a streamed
    body: anything but a whole ``web.Response``) from a route that declares ``stream="none"``. The list it returns
    fills as requests are answered; the test fixture fails when it isn't empty. It sees only what tests reach."""
    seen: list[str] = []

    async def on_prepare(request: web.Request, response: web.StreamResponse) -> None:
        if isinstance(response, web.Response) and not isinstance(response, web.FileResponse):
            return
        info = request.match_info
        route = getattr(info, "route", None)
        policy = policy_of(getattr(route, "handler", None)) if route is not None else None
        if policy is not None and policy.stream == "none":
            path, _ = _path_of(route.resource)
            seen.append(f"{route.method} {path}: answered with a {type(response).__name__} and says stream='none'")

    app.on_response_prepare.append(on_prepare)
    return seen


def lock(rows: Iterable[Row]) -> dict:
    """The table as data, sorted (tests/fixtures/route_table.lock.json)."""
    return {r.key: r.columns() for r in sorted(rows, key=lambda r: (r.path, r.method))}


def _rule(c: dict) -> str:
    if "kind" in c:
        return f"own: {c['kind']}"
    if "who" not in c:
        return "**undeclared**"
    bits = [c["who"]]
    if c["device_ok"] and c["who"] != "signed_in":
        bits.append("tablet ok")
    if c["door"] != "any":
        bits.append(f"door {c['door']}")
    if c["fresh"] != "never":
        bits.append(f"fresh {c['fresh']}")
    return ", ".join(bits)


def markdown(table: dict) -> str:
    """docs/development/Routes.md: one section per module, one line per route."""
    by_module: dict[str, list[tuple[str, dict]]] = {}
    for key, c in table.items():
        by_module.setdefault(c["module"], []).append((key, c))
    lines = ["# Routes", "",
             "Generated by `tools/route_table.py --write` from each handler's `@guard` or `@open_route` "
             "(`hosts/server/mantel_server/route_table.py`); don't edit it by hand. Mantel refuses to start when a "
             "route is missing from it or breaks its rules ([Rules](Rules.md) rule 7).", "",
             f"{len(table)} routes in {len(by_module)} modules, under every combination of the options that add "
             "routes.", "",
             "Columns: **Rule** who may call it (`signed_in` any session, `person`, `manager` an Owner or Admin, "
             "`owner`; whether a wall tablet's session may; the door; how fresh the sign-in must be) or, for a route "
             "with its own check, its kind. **Reads** what a read may show. **Stream** whether the answer stays "
             "open. **Preview** whether a screen preview may fetch it. **Audit** what a change writes first. "
             "**Assistants** the MCP tools that do the same.", ""]
    for module in sorted(by_module):
        lines += [f"## {module}", "", "| Route | Rule | Reads | Stream | Preview | Audit | Assistants |",
                  "|---|---|---|---|---|---|---|"]
        for key, c in sorted(by_module[module], key=lambda kc: (kc[0].split(" ", 1)[1], kc[0])):
            audit = ", ".join(c.get("audit") or ()) or (("none: " + c["no_audit"]) if c.get("no_audit") else "")
            if "kind" in c:
                audit = c["why"]
            elif "who" not in c:
                audit = ""
            cells = [f"`{key}`", _rule(c), str(c.get("reads") or ""), c.get("stream") or "",
                     "yes" if c.get("preview") else "", audit, ", ".join(c.get("mcp") or ())]
            lines.append("| " + " | ".join(x.replace("|", "\\|") for x in cells) + " |")
        lines.append("")
    return "\n".join(lines)
