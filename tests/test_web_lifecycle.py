"""The page's side of commands turned on and off live, its inline-handler-free HTML, and lifecycle cleanups (the
audit's second pass, WEB-1..8; docs/development/Audit-2026-10-second-pass.md). The browser-measured ones (listener
growth, a clock gone blank, a blank boot) were measured in headless Chrome against tools/headless/gallery.py's
fictional house and are pinned here by the code that fixes them.

The hub tests run in node (tests/hub_commands_harness.mjs): the page's real hub.js, mantel-host.js,
mantel-client.js and hk-client.js, wired as web/home.js wires them, over a fake WebSocket that plays server.py.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"


def text(rel: str) -> str:
    return (ROOT / rel).read_text()


def detail_text() -> str:
    """hk-detail.js (the sheet shell) followed by every sheet file it loads (web/hk/sheets/)."""
    shell = text("web/hk/cards/hk-detail.js")
    names = re.findall(r"'(hk-sheet-[\w-]+\.js)'", re.search(r"var SHEETS = \[([^\]]*)\]", shell).group(1))
    return shell + "\n" + "\n".join(text("web/hk/sheets/" + n) for n in names)


@pytest.fixture(scope="module")
def observed(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("hub-commands")
    shutil.copy(WEB / "shim/mantel-host.js", d / "mantel-host.mjs")
    shutil.copy(WEB / "shim/base.js", d / "base.mjs")
    (d / "hub.mjs").write_text(text("web/shim/hub.js").replace("from './base.js'", "from './base.mjs'"))
    shutil.copy(ROOT / "tests/hub_commands_harness.mjs", d / "harness.mjs")
    out = subprocess.run(["node", str(d / "harness.mjs"), str(WEB / "client/hk-client.js"), str(WEB / "shim/mantel-client.js")],
                         capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


# ------------------------------------------------------------------------------------- the commands-off contract
def test_commands_off_at_first_the_client_offers_no_action_and_sends_nothing(observed):
    assert observed["offFirst"] == {"enabled": False, "result": "commands_disabled", "frames": 0}


def test_control_turned_on_while_a_page_is_open_reaches_the_client(observed):
    # server.py apply_commands(on) closes every page socket; the new one says `capabilities`; home.js publishes a new
    # snapshot, mantel-client.js builds a new client with actions: the next press is one gateway command
    assert observed["nowOn"]["enabled"] is True and observed["nowOn"]["frames"] == 1
    assert observed["nowOn"]["result"] == "resolved"


def test_a_command_with_commands_on_is_one_gateway_frame(observed):
    assert observed["onFirst"] == {"enabled": True, "result": "resolved", "frames": 1}


def test_control_turned_off_while_a_page_is_open_takes_the_actions_away(observed):
    """WEB-1 (fixed): hub.js:48-62: the capabilities frame is never cleared, and an off server never sends one, so after control
    is turned off the page still offers actions"""
    # server.py run() says `capabilities` only when a gateway exists; apply_commands(False) closes the sockets and the
    # replacement says nothing. The hub must treat "no frame on this socket" as commands off.
    assert observed["off"]["enabled"] is False
    assert observed["off"]["frames"] == 0                      # the press is refused in the page, nothing is sent


def test_a_command_while_the_socket_is_down_is_refused_in_the_hubs_own_words(observed):
    """WEB-2 (fixed): hub.js command(): pending.set() then ws.send() throws on a closed socket"""
    assert observed["down"]["result"] in ("unavailable", "commands_disabled")      # a code the card can read, not InvalidStateError
    assert observed["down"]["pending"] == 0                                         # and no entry left behind


def test_pings_nobody_answered_are_not_kept(observed):
    """WEB-3 (fixed): hub.js ping(): a waiter that timed out stays in this.pings until some pong"""
    assert observed["pings"]["waiting"] == 0


# ------------------------------------------------------------------------------------------ CSP and inline handlers
def test_the_page_policy_allows_no_inline_script():
    from mantel_server import security_headers as sh
    assert sh.PAGE_POLICY["script-src"] == ("'self'",)         # so an `onclick="..."` attribute never runs


INLINE_HANDLER = re.compile(r"""[ '"]on(?:click|scroll|error|load|input|change|pointer\w*|touch\w*|mouse\w*|key\w*|focus|blur|submit|toggle)=\\?["']""")


def test_no_html_the_page_builds_carries_an_inline_event_handler():
    """WEB-4 (fixed): web/hk/modules/hk-timers.js:254,271,445: the timer strip's Restart / +1 min / Finish buttons and the
    docked strip's dots are inline handlers, refused by script-src 'self' (PACKAGING.md says there are none)"""
    hits = []
    for p in list(WEB.rglob("*.js")) + list((ROOT / "hosts/server/mantel_server/static").rglob("*.js")):
        if "/pages/" in str(p):
            continue
        for n, line in enumerate(p.read_text().splitlines(), 1):
            if INLINE_HANDLER.search(line) and not line.strip().startswith("//"):
                hits.append(f"{p.relative_to(ROOT)}:{n}")
    assert hits == [], hits


# ------------------------------------------------------------------------------------------------- lifecycle leaks
def class_body(src: str, name: str) -> str:
    m = re.search(r"class %s extends [\w.]+ \{" % re.escape(name), src)
    assert m, name
    nxt = re.search(r"\n {4}class \w+ extends|\n {4}// -{10,}", src[m.end():])
    return src[m.start(): m.end() + (nxt.start() if nxt else len(src))]


@pytest.mark.parametrize("name", ["ClimatePanel", "AlarmPanel"])
def test_a_panel_removes_the_listeners_it_added_to_the_window_when_its_sheet_closes(name):
    """WEB-5: ClimatePanel._fitShort and AlarmPanel added a window 'resize' and a matchMedia 'change' listener per
    sheet opened, never removed. Now each goes through Panel._listenShort / _undo, which Panel's
    disconnectedCallback runs."""
    src = detail_text()
    body = class_body(src, name)
    assert "_listenShort(" in body
    assert not re.search(r"_shortMq\.add(?:EventListener|Listener)\(", body)
    if "window.addEventListener('resize'" in body:
        assert "window.removeEventListener('resize'" in body
    base = class_body(src, "Panel")
    gone = re.search(r"\n {6}disconnectedCallback\(\) \{(.*?)\n {6}\}", base, re.S)
    assert gone and "_undos" in gone.group(1) and "_shortMq = null" in gone.group(1)


def test_the_grid_clock_block_draws_its_face_again_when_its_view_comes_back():
    """WEB-6 (fixed): hk-grid-cards.js:1188-1193: the clock block drops its face (and its _built) when its view is taken out of
    the page, but nothing draws it again when the view comes back: HkBase.connectedCallback (hk-base.js:2475)
    redraws only a card whose hk-stats subscription was lost"""
    body = class_body(text("web/hk/cards/hk-grid-cards.js"), "HkGridClockCard")
    m = re.search(r"\n {6}connectedCallback\(\) \{(.*?)\n {6}\}", body, re.S)
    assert m and re.search(r"_render\(|redraw\(|requestUpdate\(", m.group(1))


# --------------------------------------------------------------------------------------------- boot, and a person's picture
def test_one_failed_request_at_start_does_not_leave_the_page_blank_for_good():
    """WEB-7 (fixed): web/home.js:44-50: the boot inputs are one Promise.all with no catch; a single 503 leaves the page blank
    for good (the hub's own retry opens a socket nobody listens to)"""
    src = text("web/home.js")
    i = src.index("await Promise.all([")
    assert re.search(r"try\s*\{[^}]*$", src[max(0, i - 400):i], re.S) or re.search(r"\]\)\s*\.catch\(", src[i: src.index("pageHealth(hub);")])


def test_the_people_cards_failed_picture_handler_survives_a_second_call():
    """WEB-8 (fixed): hk-home.js:2242-2243: img.onerror() is also called by hand when the picture already failed, and then again
    by the browser, when the img has left the page: parentNode is null"""
    src = text("web/hk/cards/hk-home.js")
    i = src.index("img.onerror = function () {")
    line = src[i: src.index("\n", i)]
    assert "if (img.parentNode" in line or "img.parentNode &&" in line or "img.parentNode)" in line


# ---------------------------------------------------------------------------------------------- escaping (found sound)
def test_the_escaping_helpers_all_escape_the_four_characters_that_end_a_text_or_a_double_quoted_attribute():
    names = ["web/hk/cards/hk-base.js", "web/hk/cards/hk-energy.js", "web/hk/elements/hk-elements.js", "web/hk/modules/hk-menu.js",
             "web/hk/modules/hk-tabbar.js", "web/hk/modules/hk-header.js", "web/hk/panels/hk-settings-kit.js", "web/hk/modules/hk-notify.js"]
    for rel in names:
        src = text(rel)
        m = re.search(r"function esc\(\w+\) \{.*?\n  ?\s*\}", src, re.S) or re.search(r"function esc\(\w+\) \{[^\n]*\}", src)
        assert m, rel
        for ch in ("&amp;", "&lt;", "&gt;", "&quot;"):
            assert ch in m.group(0), (rel, ch)


def test_hk_detail_loads_every_sheet_file_and_nothing_in_cards_is_one():
    """The sheet files (web/hk/sheets/) are not cards: both hosts load every file in web/hk/cards/ as a card
    (server.py api_hk_cards, HK Frontend's resources.py), so the panels live beside it, and hk-detail.js's
    SHEETS list names each one: a file outside the list is never loaded, a name without a file never starts."""
    shell = text("web/hk/cards/hk-detail.js")
    listed = re.findall(r"'(hk-sheet-[\w-]+\.js)'", re.search(r"var SHEETS = \[([^\]]*)\]", shell).group(1))
    assert listed and len(listed) == len(set(listed))
    assert sorted(p.name for p in (WEB / "hk/sheets").glob("*.js")) == sorted(listed)
    assert not list((WEB / "hk/cards").glob("hk-sheet-*.js"))
