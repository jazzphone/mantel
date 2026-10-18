"""Mantel's own security headers, on every response, whatever proxy is (or is not) in front of it.

Until now Caddy stamped the Content-Security-Policy, HSTS and the rest (packaging/compose/caddy/Caddyfile).
With "bring your own reverse proxy" (Nginx Proxy Manager, Traefik, ...) nothing guarantees that, so
Mantel sets them itself (docs/phase3/PACKAGING.md "Security headers"). Caddy no longer sets them: two
Content-Security-Policy headers are BOTH enforced (the intersection), which would break the framed
Music Assistant app (media_proxy.py) that needs its own, looser policy.

* **Baseline, never a downgrade.** Every header is set only when the response does not carry it already,
  so a page with its own stricter policy (``/login``, ``/admin``: ``style-src 'self'`` and
  ``frame-ancestors 'none'``) keeps it.
* **The page policy** is the one PACKAGING.md "CSP findings" justifies, directive by directive (strict
  ``script-src 'self'``; ``style-src`` still needs ``'unsafe-inline'`` for HK's 301 ``style=``
  attributes). Two changes from Caddy's copy: ``frame-ancestors`` is ``'self'`` (HK Settings previews a
  dashboard in an iframe of Mantel's own page; ``'none'`` blanked it; Ingress is same-origin with HA's
  page), and ``connect-src`` names the page's own ``wss://`` origin, because older Safari (the wall
  tablets) does not match WebSockets with ``'self'``.
* **``/ma/``** (Music Assistant's web app, framed by HK): MA's own policy, see ``MA_POLICY``.
  **``/go2rtc/``**: media, JSON and go2rtc's player modules, never a document (``sandbox``).
* **HSTS** only when the browser is on https: TLS on Mantel's own socket (the Connect listener), or
  ``X-Forwarded-Proto: https`` from a trusted proxy (proxy_trust.py). Never through HA's Ingress: that
  is Home Assistant's origin, not Mantel's to pin.
* **Referrer-Policy** ``strict-origin-when-cross-origin`` (OpenStreetMap's tile policy needs a Referer).
  Pages served through Ingress also carry ``<meta name="referrer" content="same-origin">`` (ingress.py),
  which overrides the header in the document: HA stamps ``no-referrer`` on what it proxies, and under
  that a same-origin POST would carry ``Origin: null``. Nothing here touches that meta.

This module imports nothing outside the standard library at import time, so tools/package_check.py can
load it by path (no aiohttp) and check the policy it serves.
"""
from __future__ import annotations

import re

MA_PREFIX = "/ma/"
GO2RTC_PREFIX = "/go2rtc/"

HSTS = "max-age=31536000"
PERMISSIONS = ("camera=(), microphone=(self), geolocation=(), payment=(), usb=(), fullscreen=(self), "
               "autoplay=(self)")
STATIC = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": PERMISSIONS,
}

# HK's pages (PACKAGING.md "CSP findings" justifies each source).
PAGE_POLICY: dict[str, tuple[str, ...]] = {
    "default-src": ("'none'",),
    "script-src": ("'self'",),
    "style-src": ("'self'", "'unsafe-inline'"),
    # any https image (Avery, 2026-10-18): music providers' album art comes from their own CDNs (mzstatic,
    # theaudiodb, ...), besides the map tiles and radar; images cannot run code
    "img-src": ("'self'", "data:", "blob:", "https:"),
    "font-src": ("'self'", "data:"),
    "media-src": ("'self'", "blob:"),
    "connect-src": ("'self'", "https://api.rainviewer.com", "https://tile.openstreetmap.org",
                    "https://mapservices.weather.noaa.gov"),
    "worker-src": ("'self'", "blob:"),
    "frame-src": ("'self'",),
    "frame-ancestors": ("'self'",),
    "base-uri": ("'self'",),
    "form-action": ("'self'",),
    "object-src": ("'none'",),
    "manifest-src": ("'self'",),
}

# Music Assistant's web app under /ma/ (media_proxy.py), framed by HK's page. It is MA's code, not HK's:
# a Vue app whose inline bootstrap and inline styles Mantel cannot vouch for, so scripts may be inline
# (still 'self' only: nothing from another host, no eval); artwork comes from the providers' https
# CDNs; it talks only to its own /ma/ws through Mantel. Only HK's page may frame it.
MA_POLICY: dict[str, tuple[str, ...]] = {
    "default-src": ("'self'",),
    "script-src": ("'self'", "'unsafe-inline'"),
    "style-src": ("'self'", "'unsafe-inline'"),
    "img-src": ("'self'", "data:", "blob:", "https:"),
    "font-src": ("'self'", "data:"),
    "media-src": ("'self'", "blob:", "data:"),
    "connect-src": ("'self'",),
    "worker-src": ("'self'", "blob:"),
    "frame-src": ("'none'",),
    "frame-ancestors": ("'self'",),
    "base-uri": ("'self'",),
    "form-action": ("'self'",),
    "object-src": ("'none'",),
}

GO2RTC_POLICY = "default-src 'none'; frame-ancestors 'self'; sandbox"

_KEYWORDS = frozenset({"'self'", "'none'"})
_ORIGIN = re.compile(r"^(?:https?|wss?)://(?:\*\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*(?::\d{1,5})?/?$")
_HOST = re.compile(r"^[A-Za-z0-9.-]+(?::\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](?::\d{1,5})?$")


def valid_source(value: str) -> bool:
    """A CSP source an operator may add: 'self', 'none' or a plain origin (no path tricks, no ';')."""
    return isinstance(value, str) and (value in _KEYWORDS or bool(_ORIGIN.match(value)))


def render(policy: dict[str, tuple[str, ...]]) -> str:
    return "; ".join(f"{k} {' '.join(v)}" for k, v in policy.items())


def page_policy(cfg=None, host: str | None = None, https: bool = False) -> str:
    """HK's page policy with the operator's extra sources and the page's own WebSocket origin."""
    pol = {k: tuple(v) for k, v in PAGE_POLICY.items()}
    extra_connect = tuple(s for s in getattr(cfg, "csp_connect_src", ()) or () if valid_source(s))
    extra_frame = tuple(s for s in getattr(cfg, "csp_frame_src", ()) or () if valid_source(s))
    ancestors = tuple(s for s in getattr(cfg, "frame_ancestors", ()) or () if valid_source(s))
    own_ws = (f"{'wss' if https else 'ws'}://{host}",) if host and _HOST.match(host) else ()
    pol["connect-src"] = pol["connect-src"] + own_ws + extra_connect
    pol["frame-src"] = pol["frame-src"] + extra_frame
    if "'none'" in ancestors:
        pol["frame-ancestors"] = ("'none'",)
    else:
        pol["frame-ancestors"] = pol["frame-ancestors"] + tuple(a for a in ancestors if a != "'self'")
    return render(pol)


def ma_policy(cfg=None) -> str:
    pol = dict(MA_POLICY)
    ancestors = tuple(s for s in getattr(cfg, "frame_ancestors", ()) or () if valid_source(s) and s != "'none'")
    pol["frame-ancestors"] = ("'self'",) + tuple(a for a in ancestors if a != "'self'")
    return render(pol)


def headers_for(path: str, cfg=None, *, host: str | None = None, https: bool = False,
                ingress: bool = False) -> dict[str, str]:
    """Every header Mantel's own baseline puts on a response to `path` (a pure function: the tests)."""
    out = dict(STATIC)
    if path.startswith(MA_PREFIX):
        out["Content-Security-Policy"] = ma_policy(cfg)
    elif path.startswith(GO2RTC_PREFIX):
        out["Content-Security-Policy"] = GO2RTC_POLICY
    else:
        out["Content-Security-Policy"] = page_policy(cfg, host, https)
    if https and not ingress:
        out["Strict-Transport-Security"] = HSTS
    return out


def register(app) -> None:
    """Install the baseline on every response (on_response_prepare also covers WebSocket handshakes,
    files and error pages, whichever request object prepares them)."""
    from . import ingress as ingress_mod
    from . import proxy_trust

    async def stamp(request, response) -> None:
        cfg = request.app.get("cfg")
        through_ingress = ingress_mod.is_ingress(request)
        https = proxy_trust.is_https(request)
        host = proxy_trust.public_host(request)
        for name, value in headers_for(request.path, cfg, host=host, https=https, ingress=through_ingress).items():
            if name not in response.headers:
                response.headers[name] = value
        response.headers.pop("Server", None)

    app.on_response_prepare.append(stamp)
