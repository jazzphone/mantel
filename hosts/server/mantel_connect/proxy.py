"""HA Ingress to Mantel's identity-only receiver; no generic reverse proxy."""
from __future__ import annotations

import json
import ssl
import time
from pathlib import Path
from urllib.parse import urlsplit

import aiohttp
from aiohttp import web

from .channel import PATH, read_key, sign, user_valid

SUPERVISOR = "172.30.32.2"


def validate_backend(url: str) -> str:
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.path not in ("", "/")
            or parsed.query or parsed.fragment):
        raise ValueError("backend_url must be an HTTPS origin without credentials, path or query")
    return url.rstrip("/") + PATH


def build_proxy_app(backend_url: str, key_file: Path, ca_file: Path, clock=time.time) -> web.Application:
    backend = validate_backend(backend_url)
    read_key(key_file)
    tls = ssl.create_default_context(cafile=str(ca_file))
    tls.minimum_version = ssl.TLSVersion.TLSv1_2
    app = web.Application(client_max_size=1024)

    async def lifespan(app):
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10), trust_env=False) as session:
            app["backend_http"] = session
            yield

    async def landing(request: web.Request) -> web.Response:
        # Socket peer only: never use X-Forwarded-For or any browser-supplied network claim.
        if request.remote != SUPERVISOR:
            raise web.HTTPForbidden(text="Ingress only")
        ids = request.headers.getall("X-Remote-User-Id", [])
        if len(ids) != 1 or not user_valid(ids[0]):
            raise web.HTTPUnauthorized(text="Ingress supplied no valid user identity")
        if request.query_string or request.can_read_body:
            raise web.HTTPBadRequest(text="proof accepts no query or body")
        # Construct fresh outbound headers: no browser cookies, Authorization, identity or role claims.
        headers = sign(read_key(key_file), ids[0], clock())
        try:
            async with app["backend_http"].get(backend, headers=headers, ssl=tls, allow_redirects=False) as response:
                body = bytearray()
                async for chunk in response.content.iter_chunked(8192):
                    body.extend(chunk)
                    if len(body) > 65536:
                        raise web.HTTPBadGateway(text="Mantel proof response is too large")
                if response.status not in (200, 401, 403):
                    raise web.HTTPBadGateway(text="Mantel proof endpoint returned an unexpected response")
                content_type = "text/html" if response.status == 200 else "text/plain"
                return web.Response(body=body, status=response.status, content_type=content_type,
                                    headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                                             "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"})
        except (aiohttp.ClientError, TimeoutError):
            # Never expose the URL, signed headers, certificate details or secret in the response.
            raise web.HTTPBadGateway(text="Mantel proof endpoint is unavailable") from None

    app.cleanup_ctx.append(lifespan)
    app.router.add_get("/", landing, allow_head=False)
    return app


def main():
    options = json.loads(Path("/data/options.json").read_text())
    app = build_proxy_app(options["backend_url"], Path("/config/channel.key"), Path("/config/receiver.crt"))
    # Access logs can contain the sensitive ingress URL; do not emit them.
    web.run_app(app, host="0.0.0.0", port=8099, access_log=None)


if __name__ == "__main__":
    main()
