"""Email: plain text to one or more addresses through any SMTP server the Owner types (the standard library's
``smtplib``, in a thread, so no new dependency).

Security is STARTTLS (587), TLS from the first byte (465) or none (25, 2525). The certificate is verified
(``ssl.create_default_context()``); a server with a self-signed one fails with words, not silently. **None** sends the
password and the alert in the clear, so it is allowed only to a server on the LAN (a private, loopback or link-local
address, ``localhost``, or a ``.local``, ``.lan`` or ``.home.arpa`` name), checked at save and again before each send.
Gmail and iCloud need an app password, not the account's.

Nothing in a header can carry a newline: every field is refused if it has a control character, and the subject is
flattened. ``SMTP_FACTORY`` and ``SMTP_SSL_FACTORY`` are what the tests replace; the password is never in an error.
"""
from __future__ import annotations

import asyncio
import ipaddress
import re
import smtplib
import socket
import ssl
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid, parseaddr

from ..center import ChannelError, Message
from . import Invalid, Transport, text

KIND = "email"
NAME = "Email"
OWNER_ADVANCED = False
SMTP_FACTORY = smtplib.SMTP
SMTP_SSL_FACTORY = smtplib.SMTP_SSL
TIMEOUT = 20.0
PORTS = (25, 465, 587, 2525)
SECURITY = ("starttls", "tls", "none")
TO_MAX = 10
HOST = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$")
ADDRESS = re.compile(r"^[^@\s<>,;:\\\"()\[\]]{1,64}@[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?\.[A-Za-z]{2,63}$")
LAN_NAMES = (".local", ".lan", ".home.arpa")
HELO = "mantel.local"
APP_PASSWORD = "the server refused the user name or password (Gmail and iCloud need an app password)"


def control(v: object) -> bool:
    """True when ``v`` holds a CR, LF or any other control character (header injection)."""
    return isinstance(v, str) and any(ord(c) < 32 or ord(c) == 127 for c in v)


def on_lan(host: str) -> bool:
    host = host.lower().rstrip(".")
    if host == "localhost" or host.endswith(LAN_NAMES):
        return True
    try:
        ip = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return False
    return ip.is_loopback or ip.is_link_local or (ip.version == 4 and ip.is_private)    # the home network (RFC 1918)


def address(v: object) -> str | None:
    """A bare address ("alerts@example.com", or "Name <alerts@example.com>" kept as just the address)."""
    if not isinstance(v, str) or control(v) or len(v) > 254:
        return None
    addr = parseaddr(v.strip())[1]
    return addr if ADDRESS.match(addr) else None


def settings_of(config: dict) -> dict:
    """The saved or typed settings, checked: the host, port, security, user, From and To. Raises Invalid."""
    config = config if isinstance(config, dict) else {}
    for field in ("host", "user", "from", "security"):
        if control(config.get(field)):
            raise Invalid("invalid_field", "A field has a line break or another control character in it.")
    host = text(config.get("host"), 253)
    if not HOST.match(host):
        raise Invalid("invalid_host", "Give the mail server's name or address (smtp.example.com).")
    port = config.get("port")
    port = int(port) if isinstance(port, str) and port.strip().isdigit() else port
    if isinstance(port, bool) or port not in PORTS:
        raise Invalid("invalid_port", "The port is 587 (STARTTLS), 465 (TLS), 25 or 2525.")
    security = text(config.get("security"), 16).lower() or ("tls" if port == 465 else "starttls")
    if security not in SECURITY:
        raise Invalid("invalid_security", "Security is STARTTLS, TLS or None.")
    if security == "none" and not on_lan(host):
        raise Invalid("insecure_host", "None sends your password and the alerts unencrypted, so it's only for a "
                                       "mail server on your own network. Use STARTTLS or TLS for this one.")
    sender = address(config.get("from"))
    if sender is None:
        raise Invalid("invalid_from", "The From address isn't an email address.")
    to = config.get("to")
    if isinstance(to, str):
        to = [x for x in re.split(r"[,;\n]", to) if x.strip()]
    if not isinstance(to, list) or not 1 <= len(to) <= TO_MAX:
        raise Invalid("invalid_to", f"Give 1 to {TO_MAX} addresses to send to.")
    rcpt = [address(x) for x in to]
    if None in rcpt:
        raise Invalid("invalid_to", "One of the To addresses isn't an email address.")
    return {"host": host, "port": port, "security": security, "user": text(config.get("user"), 256),
            "from": sender, "to": list(dict.fromkeys(rcpt))}


def clean(config: dict, secret: dict | None, old: dict | None) -> tuple[dict, dict]:
    cfg = settings_of(config)
    pw = (secret or {}).get("password")
    pw = pw if isinstance(pw, str) else ""
    if not pw and old and isinstance(old.get("password"), str):
        pw = old["password"]
    if control(pw) or len(pw) > 256:
        raise Invalid("invalid_password", "The password can't have line breaks in it.")
    if cfg["user"] and not pw:
        raise Invalid("invalid_password", "Enter the password (Gmail and iCloud need an app password).")
    return cfg, ({"password": pw, "main": pw} if pw else {})


def build(cfg: dict, msg: Message) -> EmailMessage:
    out = EmailMessage()
    out["Subject"] = " ".join(msg.title.split())[:200]       # one line, whatever a tablet is called
    out["From"] = formataddr(("Mantel", cfg["from"]))
    out["To"] = ", ".join(cfg["to"])
    out["Date"] = formatdate(localtime=True)
    out["Message-ID"] = make_msgid(domain=cfg["from"].rsplit("@", 1)[1])
    out["Auto-Submitted"] = "auto-generated"
    out.set_content("\n\n".join(x for x in (msg.body, msg.link) if x) + "\n")
    return out


def deliver(cfg: dict, password: str, message: EmailMessage) -> None:
    """The blocking part, run in a thread: connect, secure, log in, send, quit."""
    ctx = ssl.create_default_context()
    if cfg["security"] == "tls":
        smtp = SMTP_SSL_FACTORY(cfg["host"], cfg["port"], local_hostname=HELO, timeout=TIMEOUT, context=ctx)
    else:
        smtp = SMTP_FACTORY(cfg["host"], cfg["port"], local_hostname=HELO, timeout=TIMEOUT)
    try:
        if cfg["security"] == "starttls":
            smtp.ehlo()
            smtp.starttls(context=ctx)
            smtp.ehlo()
        if cfg["user"]:
            smtp.login(cfg["user"], password)
        smtp.send_message(message, from_addr=cfg["from"], to_addrs=cfg["to"])
    finally:
        try:
            smtp.quit()
        except Exception:  # noqa: BLE001 -- the message was sent or it wasn't; a failed goodbye changes neither
            pass


def failure(exc: Exception) -> ChannelError:
    """An exception from the send as words for the page. Never ``str(exc)`` of one that could hold the login."""
    server = "the mail server"
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return ChannelError(APP_PASSWORD, permanent=True)
    if isinstance(exc, smtplib.SMTPNotSupportedError):
        return ChannelError("the server doesn't offer what the Security setting needs (STARTTLS or a login); check "
                            "the port and Security", permanent=True)
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return ChannelError(f"{server} refused the To address(es)", permanent=True)
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return ChannelError(f"{server} refused the From address", permanent=True)
    if isinstance(exc, (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected)):
        return ChannelError(f"{server} closed the connection; check the port and Security")
    if isinstance(exc, smtplib.SMTPResponseException):
        return ChannelError(f"{server} said {exc.smtp_code}", permanent=exc.smtp_code >= 500)
    if isinstance(exc, smtplib.SMTPException):
        return ChannelError(f"{server} didn't take the message ({type(exc).__name__})")
    if isinstance(exc, ssl.SSLCertVerificationError):
        return ChannelError("the server's certificate couldn't be verified (" + str(getattr(exc, "verify_message", None) or "untrusted")
                            + "); use its real hostname and a certificate from a trusted authority", permanent=True)
    if isinstance(exc, ssl.SSLError):
        return ChannelError("the TLS handshake failed; check the port and Security (465 is TLS, 587 is STARTTLS)")
    if isinstance(exc, ConnectionRefusedError):
        return ChannelError("the server refused the connection; check the host and port")
    if isinstance(exc, (TimeoutError, socket.timeout)):
        return ChannelError("the server didn't answer in time")
    if isinstance(exc, socket.gaierror):
        return ChannelError("couldn't find the mail server's name; check the host")
    if isinstance(exc, UnicodeError):
        return ChannelError("the user name or password has characters the server's login can't take", permanent=True)
    return ChannelError(f"couldn't reach the mail server ({type(exc).__name__})")


async def send(transport: Transport, config: dict, secret: dict | None, msg: Message) -> None:
    try:
        cfg = settings_of(config)                    # a saved row changed behind Mantel's back is refused here too
    except Invalid as exc:
        raise ChannelError(f"the saved email settings aren't valid: {exc.message}",
                           permanent=True) from None
    pw = (secret or {}).get("password")
    pw = pw if isinstance(pw, str) else ""
    if control(pw) or (cfg["user"] and not pw):
        raise ChannelError("the saved password is missing; enter it again", permanent=True)
    message = build(cfg, msg)
    try:
        await asyncio.to_thread(deliver, cfg, pw, message)
    except ChannelError:
        raise
    except Exception as exc:  # noqa: BLE001 -- every smtplib, ssl and socket failure, as words
        raise failure(exc) from None
