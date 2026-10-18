"""Architecture lint (PLAN §4): the shared code must not know it is inside Home Assistant."""
import re
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HA_IMPORT = re.compile(r"^\s*(from\s+homeassistant\b|import\s+homeassistant\b)", re.M)
HASS_REF = re.compile(r"\bhass\.")


def _files(folder: str, suffixes: tuple[str, ...]):
    base = ROOT / folder
    return [p for p in base.rglob("*") if p.is_file() and p.suffix in suffixes and "node_modules" not in p.parts]


def test_hk_core_does_not_import_homeassistant():
    bad = [str(p.relative_to(ROOT)) for p in _files("hk_core", (".py",)) if HA_IMPORT.search(p.read_text())]
    assert not bad, f"hk_core must not import homeassistant: {bad}"


def test_hk_core_imports_only_relatively():
    # hk_core is vendored into the HA component (custom_components.hk_frontend.hk_core) and
    # imported as `hk_core` by Mantel Server: an absolute import of itself, or of either host,
    # would only work in one of the two.
    absolute = re.compile(r"^\s*(from|import)\s+(hk_core|custom_components|mantel_server)\b", re.M)
    bad = [str(p.relative_to(ROOT)) for p in _files("hk_core", (".py",)) if absolute.search(p.read_text())]
    assert not bad, f"hk_core must import itself relatively and no host: {bad}"


# The one place allowed to speak `hass`: the adapter that builds a hass object for HK's unmodified
# cards (Phase 1 turns it into the HKClient implementation). Nothing else under web/ may.
ADAPTER = "web/shim/"


def test_web_does_not_reference_hass():
    # Phase 1 is done (2026-10-18): the shared frontend talks only to HKClient and the host
    # shell. Home Assistant's object is named only in the host adapters (web/shim/ here,
    # hosts/ha/frontend/ for HA, which is outside web/). No budgets remain: zero, everywhere.
    raw = re.compile(r"\b(?:hass|_hass)\b")
    bad = []
    for p in _files("web", (".js", ".mjs", ".html", ".ts", ".css")):
        rel = str(p.relative_to(ROOT))
        if rel.startswith(ADAPTER):
            continue
        n = len(raw.findall(p.read_text()))
        if n:
            bad.append(f"{rel}: {n}")
    assert not bad, f"Shared frontend must use HKClient (no `hass` outside the adapters): {bad}"


def test_the_lint_itself_catches_violations():
    assert HA_IMPORT.search("from homeassistant.core import HomeAssistant")
    assert HA_IMPORT.search("    import homeassistant")
    assert not HA_IMPORT.search("# we do not import homeassistant here")
    assert HASS_REF.search("const s = hass.states['light.x']")
    assert not HASS_REF.search("const passes = compass.states")


# Phase 1 slice 6: ONE ACTION PORT. Every service call in the shared frontend goes through
# HKClient's action port (`<client>.actions.callService`), never a host object's own
# callService, and every known write message goes through `<client>.actions.callWS`.
ACTION_RECEIVER = re.compile(r"(?:\b_?actions(?:\(\))?|\bact|\bport|\bwriter\([^)]*\))$")
SERVICE_CALL = re.compile(r"([\w.$()\[\]]+)\.callService\(")
# Saves that still go straight to the host input: none. The HK Settings panel's moved onto the
# port in slice 11 (docs/phase1/SETTINGS-PANEL.md), the doorbell's in slice 7.
WRITE_EXCEPTIONS: tuple[str, ...] = ()


def _writes():
    src = (ROOT / "web/client/hk-client.js").read_text()
    block = re.search(r"var WRITES = \[(.*?)\];", src, re.S).group(1)
    return set(re.findall(r"'([^']+)'", block))


def test_service_calls_go_through_the_action_port():
    bad = []
    for p in _files("web/hk", (".js",)):
        rel = str(p.relative_to(ROOT))
        for n, line in enumerate(p.read_text().splitlines(), 1):
            if line.lstrip().startswith("//"):
                continue
            for m in SERVICE_CALL.finditer(line):
                if not ACTION_RECEIVER.search(m.group(1)):
                    bad.append(f"{rel}:{n}: {line.strip()[:120]}")
    assert not bad, f"service calls must use client.actions: {bad}"


def test_write_messages_go_through_the_action_port():
    writes = _writes()
    sent = re.compile(r"([\w.$()\[\]]+)\.callWS\(\s*(?:\w+\()?\{\s*type:\s*'([^']+)'")
    bad = []
    for p in _files("web/hk", (".js",)):
        rel = str(p.relative_to(ROOT))
        if rel in WRITE_EXCEPTIONS:
            continue
        for n, line in enumerate(p.read_text().splitlines(), 1):
            for m in sent.finditer(line):
                if m.group(2) in writes and not ACTION_RECEIVER.search(m.group(1)):
                    bad.append(f"{rel}:{n}: {line.strip()[:120]}")
    assert not bad, f"write messages must use client.actions.callWS: {bad}"
    assert {"call_service", "hk_notify/mute", "config/entity_registry/update", "hk_frontend/hidden/set",
            "hk_energy/device/set", "hk_frontend/board/favorite", "hk_music/queue_play",
            "frontend/set_user_data"} <= writes


def test_http_writes_go_through_the_action_port():
    # Slice 11: an authenticated HTTP write (an upload, a config flow's step) is
    # `<client>.actions.request(path, init)`; the shared frontend never calls the host's own
    # fetchWithAuth, and its callApi is for GET only (HKClient refuses anything else).
    write_api = re.compile(r"\.callApi\(\s*'(?!GET')")
    bad = []
    for p in _files("web/hk", (".js",)):
        rel = str(p.relative_to(ROOT))
        for n, line in enumerate(p.read_text().splitlines(), 1):
            if line.lstrip().startswith("//"):
                continue
            if "fetchWithAuth" in line or write_api.search(line):
                bad.append(f"{rel}:{n}: {line.strip()[:120]}")
    assert not bad, f"HTTP writes must use client.actions.request: {bad}"
    assert write_api.search("hass.callApi('POST', base, {})")
    assert not write_api.search("client.callApi('GET', 'history/period')")


def test_mantel_host_has_no_action_transport():
    # P3.3: Mantel's port gets actions ONLY when the server's capabilities frame said commands are on,
    # and those actions only send gateway `command` messages over the hub socket; the snapshot's own
    # service method is never forwarded. Otherwise the port has no actions and hkClient refuses.
    src = (ROOT / "web/shim/mantel-client.js").read_text()
    forwarded = re.search(r"\[('formatEntityState'[^\]]*)\]\.forEach", src).group(1)
    assert "callService" not in forwarded and "snapshot.callService" not in src
    assert src.count("port.actions =") == 1 and "if (gateway && gateway.commandsEnabled()) actionsOn(port, gateway);" in src
    body = src[src.index("function actionsOn"):src.index("function useCommands")]
    body = "\n".join(line.split("//", 1)[0] for line in body.splitlines())
    assert "hub.command(" in body and "snapshot" not in body and "fetch(" not in body and "WebSocket" not in body
    assert "liveSocket:" not in body
    assert "port.refused" in src
    hub = (ROOT / "web/shim/hub.js").read_text()
    assert "commandsEnabled()" in hub and "capabilities.commands === true" in hub
    ha = (ROOT / "hosts/ha/frontend/hk-ha-client.js").read_text()
    assert "port.actions.callService" in ha and "port.actions.callWS" in ha


def test_the_action_lint_catches_violations():
    assert not ACTION_RECEIVER.search("this._hass")
    assert not ACTION_RECEIVER.search("h")
    assert ACTION_RECEIVER.search("c.actions") and ACTION_RECEIVER.search("self.actions()")
    assert ACTION_RECEIVER.search("self._actions()") and not ACTION_RECEIVER.search("self._hass_actions")
    m = SERVICE_CALL.search("this._hass.callService('light', 'toggle', {})")
    assert m and not ACTION_RECEIVER.search(m.group(1))
