"""The HA App announces Mantel to Home Assistant (docs/phase9/MANTEL-LINK.md "Discovery and pairing", slice 9.5).

When Mantel runs as the HA App, Home Assistant should offer "Discovered: Mantel" with nothing to type. At every
start the App tells the Supervisor (``POST http://supervisor/discovery``, the App's own Supervisor credential,
``hassio_api: true`` and ``discovery: [mantel]`` in config.yaml):

    {"service": "mantel", "config": {"url": "http://<the App's hostname>:8099", "token": <credential>,
                                     "instance": <Mantel's instance id>}}

and the Supervisor hands it to Mantel Link's ``async_step_hassio`` (HA's discovery is for administrators).

* **The credential** is a Service account Mantel makes for this: "Mantel Link - App discovery", scope
  ``linked`` only. It is **rotated whenever the App announces**: the one it made last time is revoked first, so
  at most one is ever live. Home Assistant updates Mantel Link's entry from the new announcement (the same
  instance id), so a link set up from the discovery follows. A link set up by hand (its own credential or a
  pairing code) is not touched. Revocable like any other (Mantel Settings, Service Accounts).
* **The address** is the App's own name on Home Assistant's internal App network (``local-mantel`` installed
  locally, ``<repo hash>-mantel`` from a repository), from the Supervisor (``/addons/self/info``), so Mantel Link's
  plain ``http://`` check (resolves into 172.30.32.0/23) accepts it.
* **Withdrawn** with the App: the Supervisor drops an App's discoveries when it is uninstalled. The previous
  announcement is deleted before a new one is made.
* What Mantel remembers (``linked_house``, key ``supervisor_discovery``): the account id and the discovery's
  uuid. Never the credential. Failure only logs: the App works without it (Mantel Link can be added by hand).
"""
from __future__ import annotations

import logging
from typing import Any

import aiohttp

log = logging.getLogger("mantel.supervisor_discovery")

SERVICE = "mantel"
ACCOUNT_NAME = "Mantel Link - App discovery"     # Mantel Link's own: revoked, Mantel Link is refused until the App restarts
KEY = "supervisor_discovery"


async def announce(app: Any, *, http: aiohttp.ClientSession | None = None) -> dict[str, Any] | None:
    """Mint (rotating) and announce. Returns what was announced, without the credential, or None."""
    cfg = app["cfg"]
    base = (getattr(cfg, "supervisor_url", None) or "").rstrip("/")
    if not base:
        return None
    try:
        sup_token = cfg.token_file.expanduser().read_text().strip()
    except OSError as err:
        log.warning("App discovery: no Supervisor credential (%s); Mantel Link can be added by hand", type(err).__name__)
        return None
    owners, accounts, lk = app.get("linked_owners"), app.get("service_accounts"), app.get("linked")
    if owners is None or accounts is None:
        return None
    headers = {"Authorization": f"Bearer {sup_token}"}
    own = http is None
    http = http or aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
    try:
        async with http.get(f"{base}/addons/self/info", headers=headers) as r:
            info = (await r.json(content_type=None) or {}).get("data") or {}
        hostname = str(info.get("hostname") or "").strip()
        if not hostname:
            log.warning("App discovery: the Supervisor did not say the App's hostname; not announcing")
            return None
        url = f"http://{hostname}:{int(getattr(cfg, 'port', 8099))}"
        before = owners.remembered(KEY) or {}
        if before.get("uuid"):
            async with http.delete(f"{base}/discovery/{before['uuid']}", headers=headers) as r:
                await r.read()
        if before.get("account"):
            try:
                accounts.revoke(before["account"], reason="rotated")
            except Exception:  # noqa: BLE001 -- already gone
                pass
        account, token = accounts.create(ACCOUNT_NAME, ["linked"], by="mantel:app")
        instance = (lk.instance if lk is not None else None) or owners.instance_id()
        body = {"service": SERVICE, "config": {"url": url, "token": token, "instance": instance}}
        async with http.post(f"{base}/discovery", json=body, headers=headers) as r:
            got = await r.json(content_type=None) if r.content_type == "application/json" else {}
            status = r.status
        if status != 200:
            accounts.revoke(account.id)
            log.warning("App discovery: the Supervisor answered HTTP %s; not announced (is hassio_api on?)", status)
            owners.remember(KEY, {})
            return None
        uuid = ((got or {}).get("data") or {}).get("uuid")
        owners.remember(KEY, {"account": account.id, "uuid": uuid, "url": url})
        audit = app.get("audit")
        if audit is not None:
            audit.config_event({"timestamp": app["clock"](), "actor": "mantel:app", "role": "service",
                                "action": "linked.app_discovery", "detail": {"account": account.id, "url": url,
                                                                             "revoked": before.get("account")}})
        log.warning("App discovery: announced Mantel to Home Assistant at %s (Service account %s)", url, account.id)
        return {"url": url, "instance": instance, "account": account.id, "uuid": uuid}
    except (aiohttp.ClientError, OSError, ValueError, TimeoutError) as err:
        log.warning("App discovery: could not reach the Supervisor (%s); Mantel Link can be added by hand",
                    type(err).__name__)
        return None
    finally:
        if own:
            await http.close()


def register(app: Any) -> None:
    """Announce once the app has started (after the database, the accounts and the link are up)."""
    if not getattr(app["cfg"], "supervisor_url", None):
        return

    async def started(_app: Any) -> None:
        import asyncio
        _app["supervisor_discovery_task"] = asyncio.create_task(announce(_app))

    async def stopped(_app: Any) -> None:
        t = _app.get("supervisor_discovery_task")
        if t is not None and not t.done():
            t.cancel()

    app.on_startup.append(started)
    app.on_cleanup.append(stopped)
