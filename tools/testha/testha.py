"""A SCRATCH Home Assistant with FICTIONAL devices, for checking the HACS build of HK Frontend.

    .venv/bin/python tools/testha/testha.py up      # build, configure, start, onboard, add HK
    .venv/bin/python tools/testha/testha.py down    # stop HA
    .venv/bin/python tools/testha/testha.py status
    .venv/bin/python tools/testha/testha.py up --fresh   # wipe the scratch config first

Safety (see README.md): binds 127.0.0.1:8124 only, no default_config, no discovery or network
integrations, only the `demo` integration's invented devices. Nothing here reads or writes
~/.config/mantel or any real Home Assistant. Credentials are generated here,
live only in <scratch>/testha.json, and are never printed.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

import aiohttp

ROOT = Path(__file__).resolve().parents[2]
REPO = Path(os.environ.get("TESTHA_REPO", ROOT))     # the tree to build HK from (default: this checkout)
SCRATCH = Path(os.environ.get("TESTHA_DIR", Path(tempfile.gettempdir()) / "mantel-testha"))   # throwaway, outside the repo
VENV = Path(os.environ.get("TESTHA_VENV", SCRATCH / "venv"))
PORT = 8124
BASE = f"http://127.0.0.1:{PORT}"
CLIENT_ID = BASE + "/"
CONFIG = SCRATCH / "config"
BUILD = SCRATCH / "build"
CREDS = SCRATCH / "testha.json"          # beside the config, never printed
PIDFILE = SCRATCH / "hass.pid"
LOG = SCRATCH / "hass.log"
ROOMS = {
    "Living Room": ["light.living_room_rgbww_lights", "media_player.living_room", "cover.living_room_window",
                    "fan.living_room_fan", "climate.hvac"],
    "Kitchen": ["light.kitchen_lights", "media_player.kitchen", "cover.kitchen_window", "lock.kitchen_door"],
    "Bedroom": ["light.bed_light", "media_player.bedroom", "climate.ecobee"],
    "Office": ["light.office_rgbw_lights", "light.ceiling_lights"],
}
MAIN_SCREEN, WALL_SCREEN, PHONE_SCREEN = "hk-scratch", "hk-wall", "hk-phone"

# Only these; no default_config, no zeroconf/ssdp/dhcp/bluetooth/homekit/cast/sonos/unifi/go2rtc.
CONFIGURATION = """\
homeassistant:
  name: HK Scratch
  latitude: 40.0
  longitude: -75.0
  elevation: 10
  unit_system: us_customary
  time_zone: America/New_York
  currency: USD
  country: US
  auth_providers:
    - type: trusted_networks
      trusted_networks:
        - 127.0.0.1
        - "::1"
      allow_bypass_login: true
    - type: homeassistant
http:
  server_host: 127.0.0.1
  server_port: 8124
frontend:
api:
websocket_api:
config:
lovelace:
auth:
person:
history:
logbook:
recorder:
  db_url: "sqlite:///{db}"
energy:
image_upload:
automation: !include automations.yaml
script: !include scripts.yaml
camera:
demo:
"""


def say(*a):
    print("[testha]", *a, flush=True)


def inside_scratch(p: Path) -> Path:
    p = p.resolve()
    if SCRATCH.resolve() not in p.parents:
        raise SystemExit(f"refusing to touch {p}: not under {SCRATCH}")
    return p


def pid() -> int | None:
    try:
        n = int(PIDFILE.read_text())
        os.kill(n, 0)
        return n
    except (OSError, ValueError):
        return None


def ready() -> bool:
    try:
        with urllib.request.urlopen(BASE + "/manifest.json", timeout=2) as r:
            return r.status == 200
    except (OSError, urllib.error.URLError):
        return False


CORE = ("hk-client.js", "hk-card-state.js", "hk-ha-client.js", "hk-host-shell.js", "hk-ha-shell.js", "hk-metric.js",
        "hk-elements.js", "hk-ha-elements.js", "tesla-viewport.js", "hk-tap.js")


def ordered_boot(dest: Path) -> None:
    """EXPERIMENT, scratch copy only: replace HA's parallel import() of HK's bootstrap modules by ONE file that holds
    the dependency-free core (client, shells, metric...) concatenated in the Python list's order, then imports the
    rest. Tests whether load order alone is the problem, and whether one ordered file is enough to fix it."""
    import re
    init = dest / "__init__.py"
    text = init.read_text()
    m = re.search(r"    for url in \(\n(.*?)\n    \):\n        add_extra_js_url\(hass, url\)", text, re.S)
    if not m:
        raise SystemExit("cannot find the extra-module list in __init__.py")
    urls = re.findall(r'^\s+"(/hk/[^"]+)",', m.group(1), re.M)
    core = [u for u in urls if u.rsplit("/", 1)[-1] in CORE]
    rest = [u for u in urls if u not in core]
    frontend = dest / "frontend"
    parts = []
    for u in core:
        src = (frontend / u[len("/hk/"):]).read_text()
        if re.search(r"^\s*(import|export)\s|import\(", src, re.M):
            raise SystemExit(f"{u} is not a plain script; cannot concatenate")
        parts.append(f"/* ---- {u} ---- */\n{src}\n")
    parts.append("\n;(function () { " + json.dumps(rest) + ".forEach(function (u) { import(u).catch(function (e) { console.error('hk-boot', u, e); }); }); })();\n")
    (frontend / "modules/hk-boot.js").write_text("".join(parts))
    init.write_text(text[:m.start()] + '    for url in ("/hk/modules/hk-boot.js",):\n        add_extra_js_url(hass, url)' + text[m.end():])
    say(f"EXPERIMENT: {len(core)} core modules concatenated into hk-boot.js (scratch copy only), {len(rest)} imported after it")


MANTEL_LINK = ROOT / "hosts/ha/custom_components/mantel"


def install_mantel_link() -> None:
    """Mantel Link (custom_components/mantel) beside HK, as HACS would install it (no tests). Not set up:
    it does nothing until a test adds its entry. TESTHA_MANTEL_LINK_DIR: install a built public repository's
    custom_components/mantel instead (tools/e2e/mantel_link_e2e.py --phase docs)."""
    dest = CONFIG / "custom_components/mantel"
    if dest.exists():
        shutil.rmtree(inside_scratch(dest))
    built = os.environ.get("TESTHA_MANTEL_LINK_DIR")
    src = Path(built) if built else (REPO / "hosts/ha/custom_components/mantel"
                                     if (REPO / "hosts/ha/custom_components/mantel").is_dir() else MANTEL_LINK)
    shutil.copytree(src, dest, ignore=shutil.ignore_patterns("tests", "tools", "docs", "__pycache__"))


def install_probe(name: str) -> None:
    """A scratch-only component from tools/testha/<name> (the e2e's stand-ins), and its configuration.yaml key."""
    dest = CONFIG / f"custom_components/{name}"
    if dest.exists():
        shutil.rmtree(inside_scratch(dest))
    shutil.copytree(ROOT / f"tools/testha/{name}", dest, ignore=shutil.ignore_patterns("__pycache__"))
    conf = CONFIG / "configuration.yaml"
    if f"{name}:" not in conf.read_text():
        conf.write_text(conf.read_text() + f"{name}:\n")


def install_zeroconf_probe() -> None:
    """Mantel Link's zeroconf check (tools/e2e/mantel_link_e2e.py --phase zeroconf): a scratch-only component
    that browses _mantel._tcp on loopback alone (HA's own zeroconf stays off: it would browse the home network)."""
    dest = CONFIG / "custom_components/mantel_e2e_browse"
    if dest.exists():
        shutil.rmtree(inside_scratch(dest))
    shutil.copytree(ROOT / "tools/testha/mantel_e2e_browse", dest, ignore=shutil.ignore_patterns("__pycache__"))
    conf = CONFIG / "configuration.yaml"
    if "mantel_e2e_browse:" not in conf.read_text():
        conf.write_text(conf.read_text() + "mantel_e2e_browse:\n")


def install_phone_probe() -> None:
    """Mantel Link's phone relay check (mantel_link_e2e.py --phase phones): a scratch-only stand-in phone,
    notify.mobile_app_e2e_phone, that records what it gets as an event."""
    dest = CONFIG / "custom_components/mantel_e2e_phone"
    if dest.exists():
        shutil.rmtree(inside_scratch(dest))
    shutil.copytree(ROOT / "tools/testha/mantel_e2e_phone", dest, ignore=shutil.ignore_patterns("__pycache__"))
    conf = CONFIG / "configuration.yaml"
    if "mantel_e2e_phone:" not in conf.read_text():
        conf.write_text(conf.read_text() + "mantel_e2e_phone:\n")


def prepare(fresh: bool, sequential: bool = False, hk: bool = True, probe: bool = False, phone: bool = False,
            supervisor: bool = False, stream: bool = False) -> None:
    if not (VENV / "bin/hass").exists():
        raise SystemExit(f"no hass at {VENV}/bin/hass (set TESTHA_VENV)")
    if fresh and CONFIG.exists():
        shutil.rmtree(inside_scratch(CONFIG))
        CREDS.unlink(missing_ok=True)
    if BUILD.exists():
        shutil.rmtree(inside_scratch(BUILD))
    say("building HK Frontend (tools/build_ha.py)")
    subprocess.run([sys.executable, str(REPO / "tools/build_ha.py"), str(BUILD / "ha")], check=True,
                   stdout=subprocess.DEVNULL)
    head = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    (SCRATCH / "build.json").write_text(json.dumps({"repo": str(REPO), "head": head, "ordered_boot": sequential}))
    (CONFIG / "custom_components").mkdir(parents=True, exist_ok=True)
    dest = CONFIG / "custom_components/hk_frontend"
    if dest.exists():
        shutil.rmtree(inside_scratch(dest))
    shutil.copytree(BUILD / "ha/custom_components/hk_frontend", dest)
    if sequential:
        ordered_boot(dest)
    if not hk:
        # a Home Assistant without HK Frontend (Mantel Link alone: docs/phase9/MANTEL-LINK.md 9.2)
        shutil.rmtree(inside_scratch(dest))
    elif os.environ.get("TESTHA_HK_FINAL"):
        # HK Frontend's FINAL release (9.10): its retirement repair on, as tools/publish/publish.py --final makes it
        retire = dest / "retire.py"
        retire.write_text(retire.read_text().replace("\nRETIRED = False\n", "\nRETIRED = True\n"))
        say("HK Frontend as its final release (the 'HK Frontend is now Mantel' repair on)")
    install_mantel_link()
    # Onboarding's core_config step would add Met.no, Google Translate and Radio Browser (network services);
    # mark every step but the user's as done so only the user is created (by the REST call below).
    store = CONFIG / ".storage/onboarding"
    if not store.exists():
        store.parent.mkdir(parents=True, exist_ok=True)
        store.write_text(json.dumps({"version": 4, "minor_version": 1, "key": "onboarding",
                                     "data": {"done": ["core_config", "analytics", "integration"]}}))
    (CONFIG / "configuration.yaml").write_text(CONFIGURATION.format(db=CONFIG / "home-assistant_v2.db"))
    # the automation and script editors' files (an e2e saves a fictional automation and script through HA's API)
    for name in ("automations.yaml", "scripts.yaml"):
        if not (CONFIG / name).exists():
            (CONFIG / name).write_text("[]\n" if name == "automations.yaml" else "{}\n")
    if probe:
        install_zeroconf_probe()
    if phone:
        install_phone_probe()
    if supervisor:
        install_probe("mantel_e2e_supervisor")
    if stream:
        # HA's own stream player (HLS, PyAV: the demo's requirement), for Live TV's channel cameras
        # (mantel_link_e2e.py --phase livetv); go2rtc stays off
        conf = CONFIG / "configuration.yaml"
        conf.write_text(conf.read_text() + "stream:\n")


def start() -> None:
    if pid():
        say("HA already running, pid", pid())
    else:
        env = {k: v for k, v in os.environ.items() if k not in ("HTTP_PROXY", "HTTPS_PROXY")}
        with open(LOG, "wb") as log:          # a fresh log per start: check.py reads it for frontend errors
            p = subprocess.Popen([str(VENV / "bin/hass"), "-c", str(CONFIG)], stdout=log, stderr=log, env=env,
                                 start_new_session=True)
        PIDFILE.write_text(str(p.pid))
        say("started HA, pid", p.pid, "log", LOG)
    t0 = time.time()
    while time.time() - t0 < 600:
        if ready():
            say(f"HA is answering on {BASE} after {time.time() - t0:.0f}s")
            return
        if not pid():
            raise SystemExit(f"HA exited; see {LOG}")
        time.sleep(2)
    raise SystemExit("HA did not come up in 10 minutes")


def stop() -> None:
    n = pid()
    if not n:
        say("HA is not running")
        return
    os.killpg(os.getpgid(n), signal.SIGTERM)
    for _ in range(60):
        try:
            os.kill(n, 0)
        except OSError:
            break
        time.sleep(0.5)
    else:
        os.killpg(os.getpgid(n), signal.SIGKILL)
    PIDFILE.unlink(missing_ok=True)
    say("HA stopped")


# ------------------------------------------------------------------ onboarding and setup
def creds() -> dict:
    return json.loads(CREDS.read_text()) if CREDS.exists() else {}


def save_creds(d: dict) -> None:
    CREDS.write_text(json.dumps(d))
    CREDS.chmod(0o600)


async def access_token(http: aiohttp.ClientSession) -> str:
    """Onboard once with generated throwaway values, afterwards trade the stored refresh token."""
    c = creds()
    if not c:
        c = {"username": "scratch", "password": secrets.token_urlsafe(18)}
        async with http.post(BASE + "/api/onboarding/users", json={
                "client_id": CLIENT_ID, "name": "Scratch", "username": c["username"], "password": c["password"],
                "language": "en"}) as r:
            if r.status != 200:
                raise SystemExit(f"onboarding/users: {r.status} (is this config already onboarded? use --fresh)")
            code = (await r.json())["auth_code"]
        async with http.post(BASE + "/auth/token", data={"grant_type": "authorization_code", "code": code,
                                                         "client_id": CLIENT_ID}) as r:
            tok = await r.json()
        c["refresh_token"] = tok["refresh_token"]
        save_creds(c)
        say("onboarding done (throwaway user stored in testha.json)")
    async with http.post(BASE + "/auth/token", data={"grant_type": "refresh_token", "client_id": CLIENT_ID,
                                                     "refresh_token": c["refresh_token"]}) as r:
        return (await r.json())["access_token"]


class WS:
    def __init__(self, ws):
        self.ws, self.n = ws, 0

    async def call(self, **msg):
        self.n += 1
        await self.ws.send_json({"id": self.n, **msg})
        while True:
            m = await self.ws.receive_json()
            if m.get("id") == self.n:
                if m.get("success") is False:
                    raise RuntimeError(f"{msg['type']}: {m['error']}")
                return m.get("result")


async def setup() -> None:
    async with aiohttp.ClientSession() as http:
        token = await access_token(http)
        h = {"Authorization": "Bearer " + token}
        async with http.ws_connect(BASE + "/api/websocket") as raw:
            await raw.receive_json()
            await raw.send_json({"type": "auth", "access_token": token})
            assert (await raw.receive_json())["type"] == "auth_ok"
            ws = WS(raw)
            # HA answers http before every integration is set up (HK registers its websocket commands
            # a few seconds later): wait for the RUNNING state before using them
            for _ in range(180):
                if (await ws.call(type="get_config")).get("state") == "RUNNING":
                    break
                await asyncio.sleep(1)
            # HA (2026.9) stores the http block as a "pending" trial and reverts it to the stable default
            # (port 8123, ALL interfaces) after 5 minutes unless confirmed: confirm it now, always.
            try:
                await ws.call(type="http/config/promote")
                say("confirmed the http settings (127.0.0.1:8124) so they never revert")
            except RuntimeError:
                pass
            if not (CONFIG / "custom_components/hk_frontend").is_dir():
                say("ready, without HK Frontend (Mantel Link installed, not set up)")
                return
            entries = await ws.call(type="config_entries/get", domain="hk_frontend")
            if entries:
                entry_id = entries[0]["entry_id"]
            else:
                async with http.post(BASE + "/api/config/config_entries/flow", json={"handler": "hk_frontend"},
                                     headers=h) as r:
                    flow = await r.json()
                async with http.post(f"{BASE}/api/config/config_entries/flow/{flow['flow_id']}", json={},
                                     headers=h) as r:
                    flow = await r.json()
                if flow.get("type") != "create_entry":
                    raise SystemExit(f"hk_frontend flow: {flow}")
                entry_id = flow["result"]["entry_id"]
                say("added the hk_frontend config entry")
            # rooms for the invented devices, so the Home page has room sections with tiles
            areas = {a["name"]: a["area_id"] for a in await ws.call(type="config/area_registry/list")}
            for name, ents in ROOMS.items():
                if name not in areas:
                    areas[name] = (await ws.call(type="config/area_registry/create", name=name))["area_id"]
                for e in ents:
                    try:
                        await ws.call(type="config/entity_registry/update", entity_id=e, area_id=areas[name])
                    except RuntimeError:
                        pass                     # a demo entity this HA version does not have
            have = {d["url_path"] for d in await ws.call(type="lovelace/dashboards/list")}
            for path, title, kind in ((MAIN_SCREEN, "HK Scratch", "computer"), (WALL_SCREEN, "HK Wall", "wall_tablet"),
                                    (PHONE_SCREEN, "HK Phone", "personal")):
                if path in have:
                    continue
                await ws.call(type="lovelace/dashboards/create", url_path=path, title=title, icon="mdi:home-heart",
                              show_in_sidebar=True, require_admin=False, mode="storage")
                await ws.call(type="lovelace/config/save", url_path=path,
                              config={"strategy": {"type": "custom:hk-dashboard"}})
                base = BASE + "/api/config/config_entries/subentries/flow"
                async with http.post(base, json={"handler": [entry_id, "dashboard"]}, headers=h) as r:
                    fid = (await r.json())["flow_id"]
                for body in ({"dashboard": path}, {"kind": kind}, {}):
                    async with http.post(f"{base}/{fid}", json=body, headers=h) as r:
                        res = await r.json()
                    if res.get("type") == "create_entry":
                        break
                say(f"dashboard /{path} created ({kind})")
            # the menu's Home Assistant section (notification / repair badges)
            await ws.call(type="hk_frontend/settings/set", changes={"menu.ha_row": True})
            # the wall screen runs the photo screensaver (tested with ?hk_saver=force)
            try:
                await ws.call(type="hk_frontend/board/set", dashboard=WALL_SCREEN, changes={
                    "screensaver": True,
                    "screensaver_options": {"show": "clock", "weather_slide": True}})
            except RuntimeError as e:
                say("note: could not enable the wall screen's screensaver:", str(e)[:120])
    say("ready. Dashboards:", f"{BASE}/{MAIN_SCREEN}  {BASE}/{WALL_SCREEN}  {BASE}/{PHONE_SCREEN}  settings: {BASE}/hk-settings")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["up", "down", "status", "setup"])
    ap.add_argument("--fresh", action="store_true", help="wipe the scratch config and credentials first")
    ap.add_argument("--no-hk", action="store_true",
                    help="no HK Frontend in the scratch HA (Mantel Link alone; it is always installed, not set up)")
    ap.add_argument("--zeroconf-probe", action="store_true",
                    help="add a scratch-only component that hands _mantel._tcp announcements on loopback to Mantel Link")
    ap.add_argument("--supervisor-probe", action="store_true",
                    help="add a scratch-only stand-in for the Supervisor's discovery hand-off (POST /api/mantel_e2e/discovery)")
    ap.add_argument("--phone-probe", action="store_true",
                    help="add a scratch-only stand-in Companion-app phone (notify.mobile_app_e2e_phone)")
    ap.add_argument("--stream", action="store_true",
                    help="add HA's own stream player (HLS) for Live TV's channel cameras; go2rtc stays off")
    ap.add_argument("--ordered-boot", action="store_true",
                    help="EXPERIMENT: scratch copy loads HK's dependency-free bootstrap modules as ONE ordered file (tests the load-order fix)")
    a = ap.parse_args()
    SCRATCH.mkdir(parents=True, exist_ok=True)
    if a.cmd == "down":
        stop()
    elif a.cmd == "status":
        say("pid", pid(), "answering", ready())
    elif a.cmd == "setup":
        asyncio.run(setup())
    else:
        if pid():
            stop()
        prepare(a.fresh, a.ordered_boot, hk=not a.no_hk, probe=a.zeroconf_probe, phone=a.phone_probe,
                supervisor=a.supervisor_probe, stream=a.stream)
        start()
        asyncio.run(setup())


if __name__ == "__main__":
    main()
