"""Mantel on the network, by zeroconf (docs/phase9/MANTEL-LINK.md "Discovery and pairing", slice 9.5).

In Docker or the LXC (Home Assistant Container / Core), Mantel Link finds Mantel by its ``_mantel._tcp``
announcement: Home Assistant shows "Discovered: Mantel", and the person confirms it with a pairing code from
Mantel Settings (the announcement is unauthenticated, so it carries NO credential).

Two halves, because Mantel's own container sits on Docker's bridge networks, where multicast never reaches the
home network:

* **Mantel** writes what to announce, non-secret, to a small file in its data folder (``announce.json``:
  ``{"instance", "url", "version"}``) whenever it starts (``--announce-file``; the container's entrypoint sets it
  when Mantel has an https address).
* **The announcer** (``python -m mantel_server.network.announce --file /data/announce.json``; compose's ``announce``
  service, the same image, on the host's network) reads that file and answers mDNS for
  ``<name>._mantel._tcp.local.``: the port of Mantel's address, TXT ``instance``, ``url`` (Mantel's https
  address, the one Mantel Link uses: its certificate's name), ``path`` and ``version``, and ``link`` when Mantel
  Connect's listener runs (``https://<address>:8766``: Mantel Link links there, pinning Mantel's own certificate,
  with no name, DNS or proxy in between; linked_pairing.py protocol v3). It follows the file.

The instance id is Mantel Link's config entry's unique id, so a second announcement never makes a second entry.

**It also looks** (phase 35): the AirPlay receivers on the network that play video (``_airplay._tcp``, features bit 0:
a HomeView, an Apple TV) go to ``airplay.json`` beside the announcement file, for HK Settings' AirPlay Screens
(cameras/airplay_out/screens.py). A name and an address only: pairing proves a screen.
Needs the ``zeroconf`` library (Home Assistant's own); without it the announcer says so and stops.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import socket
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

log = logging.getLogger("mantel.announce")

TYPE = "_mantel._tcp.local."
PATH = "/linked/ws"


def announcement(instance: str, url: str, version: str = "", link: str = "") -> dict[str, str]:
    """What the file holds (and the TXT record carries). `link`: Mantel's link address (an https address with its
    port), left out when there is none or it isn't one."""
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        raise ValueError("Mantel is announced only at an https address")
    body = {"instance": instance, "url": f"https://{parts.netloc}", "version": version}
    try:
        lp = urlsplit(link) if link else None
        if lp is not None and lp.scheme == "https" and lp.hostname and lp.port:
            body["link"] = f"https://{lp.netloc}"
    except ValueError:
        pass
    return body


def write(path: Path, instance: str, url: str, version: str = "", link: str = "") -> dict[str, str]:
    body = announcement(instance, url, version, link)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(body))
    tmp.replace(path)
    return body


def read(path: Path) -> dict[str, str] | None:
    try:
        body = json.loads(Path(path).read_text())
        return announcement(str(body["instance"]), str(body["url"]), str(body.get("version") or ""),
                            str(body.get("link") or ""))
    except (OSError, ValueError, KeyError, TypeError):
        return None


def service_info(body: dict[str, str], addresses: list[str] | None = None, host: str | None = None):
    """The zeroconf ServiceInfo for an announcement."""
    from zeroconf import ServiceInfo
    parts = urlsplit(body["url"])
    host = host or socket.gethostname().split(".")[0]
    name = f"Mantel {body['instance'][:6]}.{TYPE}"
    props = {"instance": body["instance"], "url": body["url"], "path": PATH, "version": body.get("version") or "",
             **({"link": body["link"]} if body.get("link") else {})}
    return ServiceInfo(TYPE, name, port=parts.port or 443, properties=props, server=f"{host}.local.",
                       parsed_addresses=addresses or local_addresses())


def local_addresses() -> list[str]:
    """This host's IPv4 addresses on the home network (not loopback, not Docker's bridges)."""
    import ifaddr
    out = []
    for adapter in ifaddr.get_adapters():
        if adapter.nice_name.startswith(("docker", "br-", "veth", "lo")):
            continue
        for ip in adapter.ips:
            if isinstance(ip.ip, str) and not ip.ip.startswith(("127.", "169.254.", "172.17.", "172.30.32.")):
                out.append(ip.ip)
    return out


async def run(path: Path, every: float = 30.0, zc: Any = None, interfaces: list[str] | None = None) -> None:
    """Announce what the file says, following it; until cancelled. `interfaces`: only these addresses
    (tests keep it on loopback); default all."""
    try:
        from zeroconf.asyncio import AsyncZeroconf
    except ImportError:
        log.error("announce: the zeroconf library is not installed; Mantel is not announced (add Mantel Link "
                  "by hand: Mantel's address and a pairing code)")
        return
    azc = zc or (AsyncZeroconf(interfaces=interfaces) if interfaces else AsyncZeroconf())
    current = None
    info = None
    looking = asyncio.create_task(_looking(azc, path.with_name(FOUND_FILE), every))
    try:
        while True:
            body = read(path)
            if body != current:
                if info is not None:
                    await azc.async_unregister_service(info)
                    info = None
                if body is not None:
                    info = service_info(body, addresses=interfaces)
                    await azc.async_register_service(info)
                    log.warning("announce: Mantel %s at %s on the network as %s", body["instance"][:6], body["url"],
                                info.name)
                current = body
            await asyncio.sleep(every)
    finally:
        looking.cancel()
        if info is not None:
            await azc.async_unregister_service(info)
        if zc is None:
            await azc.async_close()


AIRPLAY = "_airplay._tcp.local."
FOUND_FILE = "airplay.json"


def airplay_screen(service: str, props: dict, addresses: list[str], port: int) -> dict | None:
    """One ``_airplay._tcp`` receiver as airplay.json lists it, or None when it doesn't play video (features bit 0)."""
    def text(k: str) -> str:
        v = props.get(k.encode(), props.get(k))
        return v.decode("utf-8", "replace") if isinstance(v, bytes) else str(v or "")
    try:
        video = int(text("features").split(",")[0] or "0", 16) & 1
    except ValueError:
        video = 0
    v4 = [a for a in addresses if a.count(".") == 3]
    if not video or not v4:
        return None
    name = service[:-len("." + AIRPLAY)] if service.endswith("." + AIRPLAY) else service
    return {"name": name[:64], "host": v4[0], "port": port, "model": text("model")[:40],
            "psi": (text("psi") or text("pi"))[:64]}


async def watch_airplay(azc: Any, out: Path, every: float = 30.0) -> None:
    """Keep ``out`` listing the video receivers seen, until cancelled."""
    from zeroconf import ServiceStateChange
    from zeroconf.asyncio import AsyncServiceBrowser, AsyncServiceInfo
    names: set[str] = set()

    def changed(zeroconf, service_type, name, state_change) -> None:
        (names.add if state_change != ServiceStateChange.Removed else names.discard)(name)

    browser = AsyncServiceBrowser(azc.zeroconf, AIRPLAY, handlers=[changed])
    try:
        while True:
            await asyncio.sleep(min(every, 10.0) if not names else every)
            found = []
            for name in sorted(names)[:64]:
                info = AsyncServiceInfo(AIRPLAY, name)
                if await info.async_request(azc.zeroconf, 3000):
                    got = airplay_screen(name, info.properties or {}, info.parsed_addresses(), info.port or 7000)
                    if got is not None:
                        found.append(got)
            tmp = out.with_name(f".{out.name}.tmp")
            try:
                tmp.write_text(json.dumps({"screens": found}, sort_keys=True))
                tmp.replace(out)
            except OSError as exc:
                log.warning("announce: could not write %s (%s)", out, exc)
    finally:
        await browser.async_cancel()


async def _looking(azc: Any, out: Path, every: float) -> None:
    """watch_airplay, never taking the announcement down with it."""
    try:
        await watch_airplay(azc, out, every)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 -- the announcement matters more than the list
        log.warning("announce: not looking for AirPlay screens (%s: %s)", type(exc).__name__, exc)


def avahi_service(body: dict[str, str]) -> str:
    """The same announcement as an avahi service file (/etc/avahi/services/mantel.service), for a host that
    announces Mantel itself instead of running the announcer on its network."""
    from xml.sax.saxutils import escape
    port = urlsplit(body["url"]).port or 443
    txt = "".join(f"\n    <txt-record>{escape(k)}={escape(v)}</txt-record>"
                  for k, v in (("instance", body["instance"]), ("url", body["url"]), ("path", PATH),
                               ("version", body.get("version") or ""), *((("link", body["link"]),) if body.get("link") else ())))
    return (f'<?xml version="1.0" standalone="no"?>\n<!DOCTYPE service-group SYSTEM "avahi-service.dtd">\n'
            f'<service-group>\n  <name>Mantel {escape(body["instance"][:6])}</name>\n  <service>\n'
            f'    <type>_mantel._tcp</type>\n    <port>{port}</port>{txt}\n  </service>\n</service-group>\n')


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Announce Mantel on the home network (_mantel._tcp)")
    ap.add_argument("--file", default="/data/announce.json", help="what Mantel wrote (its --announce-file)")
    ap.add_argument("--every", type=float, default=30.0, help="how often to look at the file again (seconds)")
    ap.add_argument("--check", action="store_true", help="only check the file holds an announcement (healthcheck)")
    ap.add_argument("--avahi", action="store_true", help="print the announcement as an avahi service file")
    ap.add_argument("--interface", action="append", default=[], metavar="ADDRESS",
                    help="announce on this address only (repeatable; default every interface)")
    a = ap.parse_args(argv)
    if a.check or a.avahi:
        body = read(Path(a.file))
        if body is None:
            print(f"no announcement in {a.file} (Mantel writes it at start when it has an https address)")
            return 1
        if a.avahi:
            print(avahi_service(body), end="")
        return 0
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    try:
        asyncio.run(run(Path(a.file), a.every, interfaces=a.interface or None))
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
