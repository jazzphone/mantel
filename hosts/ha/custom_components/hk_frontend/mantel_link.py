"""THE LINK TO MANTEL SERVER (linked mode; docs/phase5/LINKED-MODE.md in the
Mantel repository the whole story): the client is hk_core's, written once for
HK Frontend and Mantel Link (hk_core/link/mantel_link.py), and this file gives
HK Frontend its import path. Its defaults (domain `hk_frontend`, protocol 1) are HK Frontend's.
"""
from .hk_core.link.mantel_link import (BACKOFF, DOMAIN, HASSIO_NET, HELLO_TIMEOUT, LINK_HEADER, MAX_MSG, PATH,
                                       PROTOCOL, TIMEOUT, LinkError, LinkTimeout, Listener, MantelLink,
                                       NotConnected, ProtocolMismatch, Refused, TargetRefused, app_hostname,
                                       internal_ip, plain_target, probe, system_resolver, ws_url)

__all__ = ["BACKOFF", "DOMAIN", "HASSIO_NET", "HELLO_TIMEOUT", "LINK_HEADER", "MAX_MSG", "PATH", "PROTOCOL",
           "TIMEOUT", "LinkError", "LinkTimeout", "Listener", "MantelLink", "NotConnected", "ProtocolMismatch",
           "Refused", "TargetRefused", "app_hostname", "internal_ip", "plain_target", "probe", "system_resolver",
           "ws_url"]
