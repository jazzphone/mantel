"""Set Up Mantel: the first run's guide, as a list of steps worked out from the house as it is now.

A fresh Mantel needs a few things before anyone else uses it: Home Assistant connected, its screens (imported from
HK Frontend or the generated Home screen), the household linked, the Owner's sign-in protected, and a decision on
house commands. Mantel Settings shows them as one checklist (web/shim/mantel-settings.js, "Set Up Mantel"); each
step opens the page that does it. Nothing here does a step itself: the pages behind them already exist and keep
their own checks.

A step's state comes from the house, never from a box someone ticked: Home Assistant is connected or it isn't, the
Owner has a second factor or doesn't. Only three things are kept (``app_settings`` ``setup_guide``, JSON):
``confirmed`` (steps whose answer is a person's judgement: "Your Home" and "Screens" look right), ``skipped``
(optional steps, and the ones a home may leave for later), and ``dismissed`` (the Owner closed the guide; it stays
under Mantel Settings, it no longer opens first).

REST:

* ``GET /api/setup``: the steps, what Mantel found in Home Assistant, and whether the guide is complete and
  dismissed. Owner or Admin (the people who manage the house).
* ``PUT /api/setup/steps/{id}`` ``{"state": "confirmed" | "skipped" | null}``: Owner.
* ``PUT /api/setup`` ``{"dismissed": bool}``: Owner.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from ipaddress import ip_address
from typing import Any
from urllib.parse import urlparse

from aiohttp import web

from . import audit, connections
from .guards import guard
from .guards import ident as guarded
from .sessions import error, ok

log = logging.getLogger(__name__)

KEY = "setup_guide"
CONFIG_TTL = 60.0              # seconds Home Assistant's get_config answer is reused
# id, title, optional: an optional step never holds the guide open
STEPS = (
    ("ha", "Connect Home Assistant", False),
    ("home", "Your Home", False),
    ("screens", "Screens", False),
    ("people", "The Household", False),
    ("protect", "Protect the Owner", False),
    ("alarm", "Alarm PIN", False),
    ("address", "Address and HTTPS", True),
    ("tablets", "Wall Tablets", True),
    ("music", "Music Assistant", True),
    ("link", "Mantel Link", True),
    ("house", "Move the House to Mantel", False),
    ("files", "Apple’s Font & Glyphs", True),
    ("commands", "House Commands", False),
)
IDS = {s[0] for s in STEPS}
CONFIRMABLE = {"home", "screens"}
# every step may be left for later except the ones Mantel can't work without
SKIPPABLE = IDS - {"ha", "screens"}


# ---------------------------------------------------------------------------------------------- kept state
def kept(app: web.Application) -> dict:
    row = app["store"].db.execute("SELECT value FROM app_settings WHERE key = ?", (KEY,)).fetchone()
    try:
        got = json.loads(row["value"]) if row else {}
    except (TypeError, ValueError):
        got = {}
    got = got if isinstance(got, dict) else {}
    return {"confirmed": sorted(set(x for x in got.get("confirmed") or [] if x in CONFIRMABLE)),
            "skipped": sorted(set(x for x in got.get("skipped") or [] if x in SKIPPABLE)),
            "dismissed": bool(got.get("dismissed"))}


def _keep(app: web.Application, value: dict) -> None:
    db = app["store"].db
    with db:
        db.execute("INSERT INTO app_settings (key, value, updated) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE "
                   "SET value = excluded.value, updated = excluded.updated",
                   (KEY, json.dumps(value, separators=(",", ":")), app["clock"]()))


# ---------------------------------------------------------------------------------------------- the house
def install(cfg: Any) -> str:
    """``app`` (the Home Assistant App), ``container`` (Docker or the LXC), or ``dev`` (by hand, on loopback)."""
    if getattr(cfg, "ha_managed_by_app", False) or getattr(cfg, "supervisor_url", "") or \
            str(getattr(cfg, "ha_url", "")).startswith("http://supervisor/"):
        return "app"
    return "container" if getattr(cfg, "public_url", "") else "dev"


# how house commands are turned on: Mantel Settings on every installation (server_settings.py); the kill switch
# that holds them off is the installation's
COMMANDS_HOW = {
    "app": "In Mantel Settings → General, turn on Allow Control of the House.",
    "container": "In Mantel Settings → General, turn on Allow Control of the House.",
    "dev": "In Mantel Settings → General, turn on Allow Control of the House.",
}
READ_ONLY_HOW = {
    "app": "This Mantel was started read-only: in Home Assistant, Settings → Apps → Mantel → Configuration, turn off "
           "Read-only, Save, and restart the App. Then turn on Allow Control of the House in Mantel Settings → General.",
    "container": "This Mantel was started read-only (MANTEL_READ_ONLY): take it out of compose.local.yaml and run "
                 "docker compose up -d --wait. Then turn on Allow Control of the House in Mantel Settings → General.",
    "dev": "This Mantel was started with --read-only: start it without. Then turn on Allow Control of the House in "
           "Mantel Settings → General.",
}


async def house_config(app: web.Application) -> dict | None:
    """Home Assistant's get_config, asked at most once a minute: its name, units, zone, country, language and which
    integrations it runs (whether HK Frontend and Mantel Link are there). None while it can't be read."""
    now = time.monotonic()
    cache = app.get("setup_guide_cache")
    cached = cache.get("config") if cache is not None else None
    if cached and now - cached[0] < CONFIG_TTL:
        return cached[1]
    proxy = getattr(app.get("hub"), "readproxy", None)
    if proxy is None:
        return None
    try:
        got = await asyncio.wait_for(proxy.request({"type": "get_config"}), 5)
    except asyncio.CancelledError:
        raise
    except Exception as exc:  # noqa: BLE001 -- not connected yet: the guide says so
        log.debug("setup guide: get_config not read (%s)", type(exc).__name__)
        return None
    if not isinstance(got, dict):
        return None
    comps = got.get("components") or []
    out = {"name": got.get("location_name"), "version": got.get("version"), "time_zone": got.get("time_zone"),
           "country": got.get("country"), "language": got.get("language"), "currency": got.get("currency"),
           "unit_system": got.get("unit_system") or {},
           "hk_frontend": "hk_frontend" in comps, "mantel_link": "mantel" in comps}
    if cache is not None:
        cache["config"] = (now, out)
    return out


def address_host(cfg: Any) -> tuple[str, bool]:
    """(the public address's host, whether it is an IP address). Docker and the LXC start at the machine's address with
    Mantel's own certificate (mantel-setup's "try"); About -> Secure Connection (about.py) asks the same question."""
    host = (urlparse(getattr(cfg, "public_url", "") or "").hostname or "").strip("[]")
    try:
        return host, bool(host) and bool(ip_address(host))
    except ValueError:
        return host, False


def _count_people(app: web.Application) -> tuple[int, int]:
    """(people besides Owners, Owners): accounts a person signs in with, not tablets or services."""
    users = [u for u in app["accounts"].list_users() if not u["disabled"] and u["role"] not in ("wall_tablet", "service")]
    owners = sum(1 for u in users if u["role"] == "owner")
    return len(users) - owners, owners


def _alarms(app: web.Application) -> tuple[list[str], list[str], list[str]]:
    """(the house's alarm panels, the ones the house Alarm PIN covers, the rest). A keypad with the house Alarm
    PIN covers itself and the alarm it forwards to (Mantel's own Alarm PIN keypad and its alarm count once); a
    panel nothing covers -- a second alarm, a keypad of another integration's -- is only named, never a To Do."""
    hub = app.get("hub")
    states = getattr(getattr(hub, "store", None), "states", None) or {}
    panels = sorted(e for e in states if e.startswith("alarm_control_panel."))
    pins = app.get("alarm_pin")
    if pins is None:
        return panels, [], panels
    covered: set[str] = set()
    for e in pins.entries():
        if e.house_code and e.configured:
            covered |= {e.entity, e.forward_to}
    return panels, [p for p in panels if p in covered], [p for p in panels if p not in covered]


def _names(app: web.Application, ids: list[str]) -> str:
    hub = app.get("hub")
    states = getattr(getattr(hub, "store", None), "states", None) or {}
    def name(e: str) -> str:
        st = states.get(e)
        attrs = ((st.get("a") or st.get("attributes")) if isinstance(st, dict) else None) or {}
        return str(attrs.get("friendly_name") or e.split(".", 1)[1].replace("_", " ").title())
    return ", ".join(name(e) for e in ids)


def _status(app: web.Application, kind: str) -> dict:
    try:
        return connections.status(app, kind) or {}
    except Exception:  # noqa: BLE001 -- a status that can't be read is "not set up"
        return {}


async def steps(app: web.Application, me: dict) -> dict:
    """Every step as it stands, for the person asking (``me``: accounts.describe)."""
    cfg = app["cfg"]
    how = install(cfg)
    k = kept(app)
    house = await house_config(app)
    hub = app.get("hub")
    reg = getattr(hub, "registry", None)
    areas = len(getattr(reg, "areas", None) or {})
    entities = len(getattr(getattr(hub, "store", None), "states", None) or {})
    out: list[dict] = []

    def step(sid: str, done: bool, detail: str, route: str | None, *, shown: bool = True, **extra: Any) -> None:
        if not shown:
            return
        title, optional = next((t, o) for i, t, o in STEPS if i == sid)
        state = "done" if done else "skipped" if sid in k["skipped"] else "todo"
        out.append({"id": sid, "title": title, "optional": optional, "state": state, "detail": detail,
                    "route": route, "can_skip": sid in SKIPPABLE and not done, "can_confirm": sid in CONFIRMABLE,
                    **extra})

    ha = _status(app, "ha")
    ha_on = bool((ha.get("live") or {}).get("connected"))
    if how == "app":
        step("ha", ha_on, "Mantel reaches Home Assistant with the App’s own access." if ha_on else
             "Mantel is waiting for Home Assistant. Restart the App if this doesn’t change.", None)
    else:
        step("ha", ha_on, f"Connected: {entities} entities in {areas} areas." if ha_on else
             "Tell Mantel where Home Assistant is and which user it acts as.", "#/mantel/connections/ha")

    if house:
        units = house["unit_system"]
        bits = [house.get("name"), units.get("temperature"), house.get("time_zone"), house.get("country"),
                house.get("language")]
        home_detail = ("From Home Assistant: " + " · ".join(str(b) for b in bits if b) +
                       ". Screens use these; change them in Home Assistant (Settings → System → General).")
    else:
        home_detail = "Connect Home Assistant first: the screens take their units, clock and time zone from it."
    store = getattr(app.get("settings"), "store", None)
    hk_done = bool(store is not None and (store.body("house", "setup") or {}).get("setup_done"))
    step("home", hk_done or "home" in k["confirmed"],
         home_detail + (" HK’s Setup Assistant has been through the alarm, weather, appearance and features."
                        if hk_done else " HK’s Setup Assistant asks about the alarm, weather, appearance and "
                        "features."), "#/setup")

    boards = len(store.docs("board")) if store is not None else 0
    imported = store.import_record() if store is not None else None
    if imported:
        screens_detail = f"{boards} screens, imported from HK Frontend."
    elif boards:
        screens_detail = ("Mantel built a Home screen from your rooms and devices. Open it, and say whether it looks "
                          "right." + (" HK Frontend is in Home Assistant: you can import its screens instead."
                                      if house and house["hk_frontend"] else ""))
    else:
        screens_detail = "No screens yet. Connect Home Assistant and Mantel builds a Home screen from your rooms."
    step("screens", bool(boards) and (bool(imported) or "screens" in k["confirmed"]), screens_detail, "#/mantel/setup/screens",
         hk_frontend=bool(house and house["hk_frontend"]), imported=bool(imported))

    others, _owners = _count_people(app)
    step("people", others > 0, f"{others} people besides the Owner." if others else
         "Add a Mantel account for each person, or link their Home Assistant users, each with a role.", "#/mantel/people")

    direct = bool(getattr(cfg, "direct_port", 0))
    if how == "app" and not direct:
        step("protect", True, "Home Assistant signs you in. Protect your Home Assistant account with its own "
             "multi-factor authentication.", "#/mantel/me")
    else:
        factors = bool(me.get("totp")) or (me.get("passkeys") or 0) > 0
        both = bool(me.get("totp")) and (me.get("passkeys") or 0) > 0
        step("protect", factors, "A passkey and an authenticator app are set up." if both else
             "Set up a passkey or an authenticator app" + (" (both is best)." if not factors else "; add the other too.") +
             " From away from home Mantel never accepts a password on its own.", "#/mantel/me")

    panels, covered, rest = _alarms(app)
    others = f" {_names(app, rest)} {'has' if len(rest) == 1 else 'have'} none; leave {'it' if len(rest) == 1 else 'them'} " \
             "if no screen arms with it." if covered and rest else ""
    step("alarm", bool(covered), "The alarm asks for the house Alarm PIN." + others if covered else
         "Set the house Alarm PIN: it is the one code Mantel asks for, and only for the alarm.", "#/features/alarm",
         shown=bool(panels))

    devices = [d for d in app["devices"].list() if d["revoked"] is None] if "devices" in app else []
    # Docker and the LXC start at this machine's address with Mantel's own certificate (mantel-setup's "try"): it works,
    # but browsers warn and passkeys are off there. A name is set on the machine, not here: the way is shown.
    host, at_address = address_host(cfg)
    step("address", not at_address,
         f"Mantel answers at {cfg.public_url.rstrip('/') if how == 'container' else ''}." if not at_address else
         f"Mantel answers at https://{host}, with its own certificate: browsers warn until you trust it, and passkeys "
         "are off at an address. Give Mantel a name, and a certificate browsers trust, on the machine it runs on.",
         None, shown=how == "container", how="mantel-setup" if at_address else None,
         how_note="In the Proxmox LXC's console, run mantel-setup: a name on your network, your own domain with a real "
                  "certificate, or your own proxy. With Docker, set MANTEL_HOSTNAME and the HTTPS lines in .env "
                  "(Install with Docker, HTTPS), then docker compose up -d --wait.")

    step("tablets", bool(devices), f"{len(devices)} enrolled." if devices else
         "Optional. On each tablet, sign in and choose Make This a Wall Tablet.", "#/house/tablets")

    ma = _status(app, "ma")
    step("music", bool((ma.get("live") or {}).get("connected")),
         "Connected." if (ma.get("live") or {}).get("connected") else
         "Optional: Music Assistant for whole-home music and the Music page’s library.", "#/mantel/connections/ma")

    linked = app.get("linked")
    link_on = any(getattr(c, "domain", None) == "mantel" and not getattr(getattr(c, "ws", None), "closed", True)
                  for c in (getattr(getattr(linked, "registry", None), "clients", None) or []))
    step("link", link_on, "Mantel Link is connected." if link_on else
         ("Mantel Link is installed in Home Assistant but not linked yet." if house and house["mantel_link"] else
          "Optional: install Mantel Link in Home Assistant for tablet entities, automations’ actions, "
          "doorbell talk-back and notifications on Companion-app phones."), "#/mantel/connections/ha/link")

    # MOVING FROM HK FRONTEND'S LAST STEP (linked_owners.py): only while Home Assistant still has HK Frontend
    # (linked, or Mantel Link says it is installed). Without it Mantel takes the house by itself.
    owners = app.get("linked_owners")
    lk_reg = getattr(linked, "registry", None)
    hk_there = bool(lk_reg is not None and (lk_reg.clients_of("hk_frontend") or any(
        (c.report.get("hk_frontend") or {}).get("installed") for c in lk_reg.clients_of("mantel"))))
    if owners is not None:
        tabs = owners.tablets()
        left = [n for t, n in sorted(tabs.items()) if owners.owner(t) != "mantel"] if not owners.house() else []
        step("house", owners.house(), "Mantel runs the house: Seasonal Decorations, the Alarm PIN keypad and Live TV."
             if owners.house() else
             ("Every wall tablet is Mantel’s. Move the house next: Seasonal Decorations, the Alarm PIN keypad and "
              "Live TV’s sensors and channels, which HK Frontend still runs." if not left else
              f"After the wall tablets ({', '.join(left)} still run by HK Frontend): HK Frontend still runs "
              "Seasonal Decorations, the Alarm PIN keypad and Live TV’s sensors and channels."),
             "#/mantel/connections/ha/moving/advanced" if not left else "#/mantel/connections/ha/moving",
             shown=hk_there)

    files = app.get("user_files")
    try:
        fstat = files.listing().get("status") or {} if files is not None else {}
    except Exception:  # noqa: BLE001
        fstat = {}
    step("files", bool(fstat.get("font") and fstat.get("glyphs")),
         "Uploaded." if fstat.get("font") and fstat.get("glyphs") else
         "Optional: Apple’s SF Pro and SF Symbols, which each home supplies itself. Fallback fonts and icons work "
         "without them.", "#/mantel/files")

    on = bool(getattr(cfg, "commands_enabled", False))
    how_on = READ_ONLY_HOW[how] if getattr(cfg, "read_only", False) else COMMANDS_HOW[how]
    step("commands", on, "On: people control the house within their roles, and every command is in the Audit Log."
         if on else "Off: Mantel is read-only. When the roles look right, " + how_on[0].lower() + how_on[1:],
         "#/mantel/general", how=how_on)

    complete = all(s["state"] != "todo" for s in out if not s["optional"])
    return {"steps": out, "complete": complete, "dismissed": k["dismissed"], "install": how, "house": house,
            "done": sum(1 for s in out if s["state"] == "done"), "total": len(out)}


# ---------------------------------------------------------------------------------------------- REST
@guard("manager", reads="admin")
async def get_setup(request: web.Request) -> web.Response:
    ident = guarded(request)
    row = request.app["accounts"].get_user(ident.user.id)
    me = request.app["accounts"].describe(row) if row is not None else {}
    got = await steps(request.app, me)
    return ok({**got, "can_edit": ident.user.role == "owner"})


@guard("owner", audit="setup.step")
async def put_step(request: web.Request) -> web.Response:
    ident = guarded(request)
    sid = request.match_info["id"]
    if sid not in IDS:
        return error(404, "not_found")
    try:
        body = await request.json()
    except ValueError:
        body = None
    state = body.get("state") if isinstance(body, dict) else "?"
    if state not in ("confirmed", "skipped", None):
        return error(400, "invalid")
    if state == "confirmed" and sid not in CONFIRMABLE or state == "skipped" and sid not in SKIPPABLE:
        return error(400, "invalid", message="That step can’t be " + state + ".")
    audit.config(request, ident, "setup.step", {"step": sid, "state": state})
    k = kept(request.app)
    for name in ("confirmed", "skipped"):
        have = set(k[name])
        (have.add if state == name else have.discard)(sid)
        k[name] = sorted(have)
    _keep(request.app, k)
    return ok({"id": sid, "state": state})


@guard("owner", audit="setup.dismissed")
async def put_setup(request: web.Request) -> web.Response:
    ident = guarded(request)
    try:
        body = await request.json()
    except ValueError:
        body = None
    if not isinstance(body, dict) or not isinstance(body.get("dismissed"), bool):
        return error(400, "invalid")
    audit.config(request, ident, "setup.dismissed", {"dismissed": body["dismissed"]})
    k = kept(request.app)
    k["dismissed"] = body["dismissed"]
    _keep(request.app, k)
    return ok({"dismissed": k["dismissed"]})


def summary(app: web.Application) -> dict:
    """What the overview carries for the page's first choice, without asking Home Assistant: dismissed, and whether
    the steps that need no judgement still hold it open (the page reads GET /api/setup for the rest)."""
    k = kept(app)
    ha = _status(app, "ha")
    return {"dismissed": k["dismissed"],
            "open": not k["dismissed"] and (not (ha.get("live") or {}).get("connected") or
                                            not {"home", "screens"} <= set(k["confirmed"]) | _imported(app))}


def _imported(app: web.Application) -> set[str]:
    store = getattr(app.get("settings"), "store", None)
    return {"screens"} if store is not None and store.import_record() else set()


def register(app: web.Application) -> None:
    app["setup_guide_cache"] = {}             # Home Assistant's get_config, reused for CONFIG_TTL
    app.router.add_get("/api/setup", get_setup)
    app.router.add_put("/api/setup", put_setup)
    app.router.add_put("/api/setup/steps/{id}", put_step)
