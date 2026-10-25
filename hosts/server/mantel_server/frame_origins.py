"""Which pages may show Mantel in a frame (CSP ``frame-ancestors``): Home Assistant's, so a screen can be a Webpage
dashboard in HA's sidebar (ha_dashboards.py) and the Companion app can open on it.

Nothing here is specific to one house. The allowed addresses are, together:

* **the operator's** (``cfg.frame_ancestors``: ``--frame-ancestors`` / MANTEL_FRAME_ANCESTORS), fixed at start;
* **the Sign-In Address** set in Mantel Settings (Connections → Home Assistant; server_settings.py), at once;
* **Home Assistant's own**: its internal and external URL (HA → Settings → System → Network), read from HA's
  ``get_config`` once it answers (``learn``). They are HA's own addresses, so HA may frame Mantel there;
* **the ones an Owner approved** in Mantel Settings (HTTPS and Your Proxy → Home Assistant's Frame, or by turning
  on Show in Home Assistant inside HA's sidebar at that address; the old ``ha_frame_origins`` App option was
  copied here once), kept in Mantel's settings (``house/<DOC>``, versioned like every setting), audited, and
  applied at once: the policy is computed per response.

Only plain ``http(s)://host[:port]`` origins, never a path, a wildcard or a keyword other than the operator's own
``'self'`` / ``'none'`` (``'none'`` from the operator turns framing off whatever else is listed).
"""
from __future__ import annotations

import ipaddress
import logging
import re
from typing import Any, Iterable
from urllib.parse import urlsplit

from aiohttp import web

log = logging.getLogger("mantel.frame_origins")

DOC = "mantel_frames"              # house/<this>: {"origins": ["https://ha.example.com", ...]}
API = "/api/admin/frame-origins"
MAX_APPROVED = 32
_NAME = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$")


def origin_of(raw: object) -> str | None:
    """``scheme://host[:port]`` for an http(s) address with nothing else in it (a trailing / is fine), else None."""
    if not isinstance(raw, str) or not raw.strip() or len(raw) > 300:
        return None
    text = raw.strip().rstrip("/")
    try:
        u = urlsplit(text)
        port = u.port
    except ValueError:
        return None
    host = (u.hostname or "").lower()
    if u.scheme not in ("http", "https") or not host or u.path or u.query or u.fragment or u.username or u.password:
        return None
    try:
        ipaddress.ip_address(host)
        is_ip = True
    except ValueError:
        is_ip = False
    if not is_ip and not _NAME.match(host):
        return None
    shown = f"[{host}]" if ":" in host else host
    default = 443 if u.scheme == "https" else 80
    return f"{u.scheme}://{shown}" + (f":{port}" if port and port != default else "")


class FrameOrigins:
    """``app["frame_origins"]``: the addresses that may frame Mantel, with where each comes from."""

    def __init__(self, app: web.Application) -> None:
        self.app = app
        self.ha: tuple[str, ...] = ()
        self.ha_by_kind: dict[str, str] = {}          # {"internal_url": origin, "external_url": origin}

    # -- the three sources ------------------------------------------------------------------------------
    def operator(self) -> tuple[str, ...]:
        return tuple(getattr(self.app.get("cfg"), "frame_ancestors", ()) or ())

    def sign_in(self) -> tuple[str, ...]:
        o = origin_of(getattr(self.app.get("cfg"), "ha_browser_url", "") or "")
        return (o,) if o else ()

    def approved(self) -> tuple[str, ...]:
        svc = self.app.get("settings")
        try:
            body = svc.store.body("house", DOC) if svc is not None else {}
        except Exception:  # noqa: BLE001 -- no settings store (a bare test app): nothing approved
            body = {}
        got = body.get("origins") if isinstance(body, dict) else None
        return tuple(o for o in (origin_of(x) for x in (got or [])) if o)

    def learn(self, ha_config: Any) -> None:
        """HA's own addresses from its ``get_config`` (internal_url, external_url)."""
        if not isinstance(ha_config, dict):
            return
        self.ha_by_kind = {k: o for k in ("internal_url", "external_url") if (o := origin_of(ha_config.get(k)))}
        found = tuple(dict.fromkeys(self.ha_by_kind.values()))
        if found != self.ha:
            self.ha = found
            log.info("Home Assistant's own addresses may show Mantel: %s", ", ".join(found) or "none set in HA")

    # -- the result -----------------------------------------------------------------------------------------
    def all(self) -> tuple[str, ...]:
        """The frame-ancestors sources, in order, without repeats ('none' from the operator wins)."""
        op = self.operator()
        if "'none'" in op:
            return ("'none'",)
        return tuple(dict.fromkeys((*op, *self.sign_in(), *self.ha, *self.approved())))

    def described(self) -> list[dict]:
        """Every allowed http(s) address and why (the Settings page; no secret)."""
        out: dict[str, dict] = {}
        for src, items in (("option", self.operator()), ("sign_in", self.sign_in()), ("home_assistant", self.ha),
                           ("approved", self.approved())):
            for o in items:
                if o.startswith(("http://", "https://")) and o not in out:
                    out[o] = {"origin": o, "source": src}
        return list(out.values())

    def write(self, origins: Iterable[str], request: web.Request, ident: Any) -> None:
        from .settings_store import actor_of
        self.app["settings"].store.write([("house", DOC, {"origins": list(origins)})], actor=actor_of(ident),
                                         message="frame origins")


def ha_address(app: web.Application) -> str | None:
    """Home Assistant's address for a browser (the dashboard's "Open Home Assistant" row, opened at Mantel's own
    address): HA's external URL, else its internal one (HA → Settings → System → Network), else the address the
    operator gave for browsers (the App's ``ha_browser_url``), else Mantel's own address for HA where a browser can
    use it (never the App's ``http://supervisor/core``). None when there is none."""
    fo = app.get("frame_origins")
    known = fo.ha_by_kind if fo is not None else {}
    if known.get("external_url") or known.get("internal_url"):
        return known.get("external_url") or known.get("internal_url")
    cfg = app.get("cfg")
    for raw in (getattr(cfg, "ha_browser_url", ""), "" if getattr(cfg, "ha_managed_by_app", False) else getattr(cfg, "ha_url", "")):
        o = origin_of(raw)
        if o and urlsplit(o).hostname != "supervisor":
            return o
    return None


def of(app: web.Application) -> FrameOrigins | None:
    return app.get("frame_origins")


def ancestors(app: web.Application | None) -> tuple[str, ...]:
    """What security_headers.py puts in frame-ancestors (the operator's alone where there is no FrameOrigins)."""
    fo = app.get("frame_origins") if app is not None else None
    if fo is not None:
        return fo.all()
    return tuple(getattr(app.get("cfg") if app is not None else None, "frame_ancestors", ()) or ())


async def approve(request: web.Request, ident: Any, raw: object, why: str) -> tuple[str | None, web.Response | None]:
    """Add one address to the approved ones (an Owner; audited first). (origin or None, an error response or None)."""
    from .sessions import error
    from . import connections as C
    fo = of(request.app)
    origin = origin_of(raw)
    if fo is None or origin is None:
        return None, error(400, "origin_invalid", message="That is not an address like https://homeassistant.example.com "
                                                          "(http or https, a name or IP, an optional port, nothing after).")
    if origin in fo.all():
        return origin, None
    approved = list(fo.approved())
    if len(approved) >= MAX_APPROVED:
        return None, error(409, "too_many", message=f"At most {MAX_APPROVED} approved addresses; remove one first.")
    refused = C._audit(request, ident, "frame_origin.add", {"origin": origin, "why": why})
    if refused is not None:
        return None, refused
    fo.write([*approved, origin], request, ident)
    log.warning("frame origins: %s may now show Mantel (approved by %s, %s)", origin, ident.user.id, why)
    return origin, None


def _owner(request: web.Request, write: bool):
    from .sessions import identity
    ident = identity(request)
    roles = ("owner",) if write else ("owner", "admin")
    if ident.user is None or ident.device is not None or ident.user.role not in roles:
        raise web.HTTPForbidden(text='{"error":"forbidden"}', content_type="application/json")
    return ident


async def api_list(request: web.Request) -> web.Response:
    _owner(request, write=False)
    fo = of(request.app)
    return web.json_response({"origins": fo.described() if fo else [], "off": "'none'" in ancestors(request.app)},
                             headers={"Cache-Control": "no-store"})


async def api_add(request: web.Request) -> web.Response:
    from .accounts import read_json
    from . import connections as C
    _owner(request, write=True)
    # an address that may frame Mantel: an Owner with a fresh factor away from home, as the Sign-In Address that
    # also adds one (server_settings, connections.edit_rule)
    ident = C._editor(request)
    body = await read_json(request)
    origin, err = await approve(request, ident, body.get("origin"), "settings")
    if err is not None:
        return err
    return web.json_response({"origin": origin, "origins": of(request.app).described()})


async def api_remove(request: web.Request) -> web.Response:
    from .sessions import error
    from . import connections as C
    ident = _owner(request, write=True)
    fo = of(request.app)
    origin = origin_of(request.query.get("origin"))
    approved = list(fo.approved()) if fo else []
    if origin is None or origin not in approved:
        return error(404, "not_approved", message="Only an address approved in Mantel Settings can be removed here; "
                                                  "the others come from Home Assistant, the Sign-In Address or the start-up options.")
    refused = C._audit(request, ident, "frame_origin.remove", {"origin": origin})
    if refused is not None:
        return refused
    fo.write([o for o in approved if o != origin], request, ident)
    return web.json_response({"removed": origin, "origins": fo.described()})


def register(app: web.Application) -> None:
    app["frame_origins"] = FrameOrigins(app)
    app.router.add_get(API, api_list)
    app.router.add_post(API, api_add)
    app.router.add_delete(API, api_remove)
