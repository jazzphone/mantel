"""Pairing Mantel Link with Mantel, the words both sides use: the protocol numbers, the path, and the address a pairing
names (scheme, lower-case host, explicit port, nothing else).

Shared by Mantel Link's pairing.py (the Home Assistant side) and Mantel Server's linked_pairing.py (Mantel's side), so
the two cannot read an address differently. Pure; no Home Assistant, no aiohttp.
"""
from __future__ import annotations

import hashlib
import hmac
import re
from ipaddress import ip_address
from typing import Any
from urllib.parse import urlsplit

VERSION = 2                                       # never 1: no downgrade to a proof without the address
PINNED = 3                                        # Mantel's own CA, handed over and pinned
PATH = "/linked/pair"
_HOSTNAME = re.compile(r"^(?=.{1,253}$)[a-z0-9_][a-z0-9_-]{0,62}(\.[a-z0-9_][a-z0-9_-]{0,62})*$")
_SCHEMES = {"http": ("http", 80), "https": ("https", 443), "ws": ("http", 80), "wss": ("https", 443)}


def normalize_address(url: Any) -> str | None:
    """``scheme://host:port`` (the same rules in Mantel Link and Mantel Server), or None: http/https
    (ws/wss map to them), the host in lower case without a final dot (an IPv6 literal in brackets), the port always
    written, no path, query or user."""
    if not isinstance(url, str) or not url or len(url) > 300:
        return None
    try:
        parts = urlsplit(url.strip())
        port = parts.port
    except ValueError:
        return None
    scheme = _SCHEMES.get(parts.scheme.lower())
    host = (parts.hostname or "").rstrip(".")
    if scheme is None or not host:
        return None
    try:
        ip = ip_address(host)
    except ValueError:
        if not _HOSTNAME.match(host):
            return None
        shown = host
    else:
        shown = f"[{ip.compressed}]" if ip.version == 6 else ip.compressed
    return f"{scheme[0]}://{shown}:{port or scheme[1]}"


def _mac(key: bytes, *parts: str) -> str:
    return hmac.new(key, "|".join(parts).encode(), hashlib.sha256).hexdigest()
