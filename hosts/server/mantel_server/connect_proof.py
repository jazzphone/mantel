"""Separate TLS identity-only receiver. Never exposes the state hub or a command path."""
from __future__ import annotations

import argparse
import html
import logging
import ssl
import time
from pathlib import Path

from aiohttp import web

from mantel_connect.channel import PATH, Verifier
from .config import Config
from .store import Store

log = logging.getLogger("mantel.connect")
HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
           "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"}


def build_connect_app(store: Store, key_file: Path, clock=time.time) -> web.Application:
    verifier = Verifier(key_file)

    async def identity(request: web.Request) -> web.Response:
        if request.query_string or request.can_read_body:
            raise web.HTTPBadRequest(text="proof accepts no query or body")
        try:
            user_id = verifier.verify(request.headers, clock())
        except ValueError:
            log.warning("refused unauthenticated Connect request")
            return web.Response(status=401, text="Connect authentication failed", headers=HEADERS)
        link = store.get_link(user_id)
        if link is None:
            return web.Response(status=403, text="This HA account is not linked to a Mantel role.", headers=HEADERS)
        name = html.escape(link["name"] or user_id)
        role = html.escape(link["role"])
        body = ("<!doctype html><html><head><meta charset=utf-8>"
                "<meta name=viewport content='width=device-width,initial-scale=1'>"
                "<title>Mantel Connect</title><style>body{font:18px system-ui;max-width:36em;"
                "margin:3em auto;padding:0 1em}strong{font-size:1.3em}</style></head><body>"
                f"<h1>Mantel Connect</h1><p>Signed in as <strong>{name}</strong>.</p>"
                f"<p>Your Mantel role: <strong>{role}</strong></p>"
                "<p>Home Assistant → Mantel Connect → Mantel</p>"
                "<p>Identity proof only. House controls are disabled.</p></body></html>")
        return web.Response(text=body, content_type="text/html", headers=HEADERS)

    app = web.Application(client_max_size=1024)
    app.router.add_get(PATH, identity, allow_head=False)
    return app


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Mantel Connect identity proof (TLS only; no HA token needed)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--data-dir", default=str(Config.data_dir))
    parser.add_argument("--key-file", type=Path, required=True)
    parser.add_argument("--tls-cert", type=Path, required=True)
    parser.add_argument("--tls-key", type=Path, required=True)
    args = parser.parse_args(argv)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.minimum_version = ssl.TLSVersion.TLSv1_2
    tls.load_cert_chain(args.tls_cert, args.tls_key)
    store = Store(Path(args.data_dir) / "mantel.db")
    try:
        app = build_connect_app(store, args.key_file)
        web.run_app(app, host=args.host, port=args.port, ssl_context=tls, access_log=None)
    finally:
        store.db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
