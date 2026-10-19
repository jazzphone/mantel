"""What the wall tablets' kiosk apps share (docs/phase8/KIOSK.md): the failure every call raises, and the address
and password as typed on a tablet's Direct Connection page, checked. Kiosk Satellite (kiosk_satellite.py) and Fully
Kiosk (fully.py) each have their own client; neither sends anything this module has not checked first."""
from __future__ import annotations

import ipaddress
import re
from urllib.parse import urlparse

MAX_PASSWORD = 256
HOST_RE = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9-]{0,62})(\.[A-Za-z0-9]([A-Za-z0-9-]{0,62}))*$")


class KioskFailed(Exception):
    """A call failed. ``code`` is stable; ``message`` is for people and never holds a password or token."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def clean_address(raw: object, default_port: int, where: str) -> tuple[str, int]:
    """A tablet's address as typed (its IP address, ``<ip>:<port>``, ``kitchen-tablet.local``,
    ``http://kitchen-tablet:<port>``), checked: (host, port). ``where`` names the place the app shows it. Home
    network only: an IP literal must be private, so a typo cannot send a password to the internet."""
    if not isinstance(raw, str) or not raw.strip() or len(raw.strip()) > 300:
        raise KioskFailed("address_invalid", f"Type the tablet's IP address or name, as {where} shows it "
                                             f"(port {default_port} is assumed).")
    text = raw.strip().rstrip("/")
    p = urlparse(text if "://" in text else "http://" + text)
    if p.scheme != "http" or not p.hostname or p.username or p.password or p.path or p.query or p.fragment:
        raise KioskFailed("address_invalid", "That is not an address Mantel can use: the tablet's IP address or "
                                             f"name and, if it is not {default_port}, its port (http only, no path).")
    try:
        port = p.port or default_port
    except ValueError:
        raise KioskFailed("address_invalid", "The port in that address is not a number from 1 to 65535.") from None
    host = p.hostname
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        if not HOST_RE.match(host):
            raise KioskFailed("address_invalid", "That tablet name has characters an address cannot have.") from None
        return host, port
    if not (ip.is_private and not ip.is_loopback and not ip.is_link_local and not ip.is_unspecified):
        raise KioskFailed("address_not_home", "That address is not on a home network. A tablet's address starts "
                                              "with 192.168., 10. or 172.16-31.")
    return (f"[{host}]" if ip.version == 6 else host), port


def clean_password(raw: object, where: str) -> str:
    """The tablet's admin password as typed (``where``: where it is set in the app)."""
    if not isinstance(raw, str) or not raw:
        raise KioskFailed("password_missing", f"Type the tablet's Remote Administration password ({where}).")
    if len(raw) > MAX_PASSWORD or any(ord(c) < 0x20 for c in raw):
        raise KioskFailed("password_invalid", "That password has characters a kiosk app cannot have.")
    return raw


def route(host: str, port: int) -> tuple[str, int]:
    """Where a call to (host, port) connects: itself. The tests' one seam (they point a fictional tablet address at
    a fake on loopback, after the address was checked and stored as typed)."""
    return host, port


def address_text(host: str, port: int) -> str:
    """The address as Mantel shows and stores it."""
    return f"http://{host}:{port}"


async def read_body(content, cap: int) -> bytes:
    """A reply's whole body, at most ``cap`` + 1 bytes (more than ``cap`` means too large). aiohttp's
    ``content.read(n)`` returns what has arrived so far, not n bytes: one call took the first piece of Kiosk
    Satellite's command list, and the cut JSON read as "not Kiosk Satellite" (the house, 2026-10-19)."""
    buf = bytearray()
    while len(buf) <= cap:
        chunk = await content.read(cap + 1 - len(buf))
        if not chunk:
            break
        buf += chunk
    return bytes(buf)
