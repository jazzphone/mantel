"""'Sign in with Home Assistant': HA's own OAuth (IndieAuth-style) flow.

This is a separate, small client on purpose. It talks to HA *as the signing-in user* for a few
seconds (to learn who they are) and then revokes that user's refresh token. Mantel never keeps a
user's HA token, and nothing here goes through the hub's read-only HA connection (its allowlist stays as it is).
"""
from __future__ import annotations

import asyncio
import logging
from urllib.parse import urlencode, urlparse

import aiohttp

log = logging.getLogger("mantel.oauth")
TIMEOUT = aiohttp.ClientTimeout(total=15)


class OAuthError(Exception):
    pass


def check_redirect(client_id: str, redirect_uri: str) -> None:
    """HA requires redirect_uri to be on the same host as client_id; refuse anything else up front."""
    c, r = urlparse(client_id), urlparse(redirect_uri)
    if c.scheme not in ("http", "https") or r.scheme != c.scheme or r.netloc != c.netloc or not r.netloc:
        raise ValueError(f"redirect_uri {redirect_uri!r} must be on the same origin as client_id {client_id!r}")


class HaOAuth:
    def __init__(self, ha_url: str, client_id: str, redirect_uri: str) -> None:
        check_redirect(client_id, redirect_uri)
        self.ha_url = ha_url.rstrip("/")
        self.client_id = client_id
        self.redirect_uri = redirect_uri

    def authorize_url(self, state: str) -> str:
        q = urlencode({"client_id": self.client_id, "redirect_uri": self.redirect_uri, "state": state})
        return f"{self.ha_url}/auth/authorize?{q}"

    async def exchange_code(self, http: aiohttp.ClientSession, code: str) -> dict:
        data = {"grant_type": "authorization_code", "code": code, "client_id": self.client_id}
        async with http.post(f"{self.ha_url}/auth/token", data=data, timeout=TIMEOUT) as r:
            body = await r.json(content_type=None)
            if r.status != 200 or "access_token" not in body or "refresh_token" not in body:
                raise OAuthError(f"token exchange failed ({r.status}: {body.get('error', '?') if isinstance(body, dict) else '?'})")
            return body

    async def current_user(self, http: aiohttp.ClientSession, access_token: str) -> dict:
        """Ask HA who the token's user is (auth/current_user over the WebSocket API)."""
        ws_url = self.ha_url.replace("http", "ws", 1) + "/api/websocket"
        async with http.ws_connect(ws_url) as ws:
            await asyncio.wait_for(ws.receive_json(), 10)  # auth_required
            await ws.send_json({"type": "auth", "access_token": access_token})
            reply = await asyncio.wait_for(ws.receive_json(), 10)
            if reply.get("type") != "auth_ok":
                raise OAuthError("Home Assistant did not accept the user's token")
            await ws.send_json({"id": 1, "type": "auth/current_user"})
            reply = await asyncio.wait_for(ws.receive_json(), 10)
            if not reply.get("success") or not (reply.get("result") or {}).get("id"):
                raise OAuthError("auth/current_user failed")
            return reply["result"]

    async def revoke(self, http: aiohttp.ClientSession, refresh_token: str) -> None:
        async with http.post(f"{self.ha_url}/auth/token", data={"token": refresh_token, "action": "revoke"},
                             timeout=TIMEOUT) as r:
            if r.status != 200:
                raise OAuthError(f"revoke returned {r.status}")
