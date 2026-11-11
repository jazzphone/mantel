"""Phase 1 slice 8: the shared frontend reaches Home Assistant's page only through the host shell.

Home Assistant's own element names (`home-assistant`, `hui-root`, `ha-panel-lovelace`, …) and its
frontend events (`location-changed`, `hass-more-info`, …) may appear in shared code only inside
the host-shell adapters. Code is scanned with comments removed: an explanation of what HA does is
fine, a lookup or an event is not. Slice 8b took the last budget (`legacy-ha-shell.json`) to 0, so
there are no exceptions left.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# The adapters: Mantel's shim (web/shim/, which stands in for HA's page) and the HA implementation,
# which lives outside web/ in hosts/ha/frontend/hk-ha-shell.js.
ADAPTERS = ("web/shim/",)

SHELL_NAMES = (
    "home-assistant", "home-assistant-main", "ha-panel-lovelace", "hui-root", "hui-view",
    "hui-view-container", "hui-view-background", "partial-panel-resolver", "ha-drawer", "ha-sidebar",
    "location-changed", "hass-more-info", "hass-notification", "hass-toggle-menu",
    "hass-show-notifications", "ll-rebuild", "hass-suspend-when-hidden",
    # Phase 2 P2.4: the sidebar's own button (hkShell.menuButton makes it, in HA's shell)
    "ha-menu-button",
)
SHELL_REF = re.compile(r"(?<![\w-])(?:" + "|".join(re.escape(n) for n in sorted(SHELL_NAMES, key=len, reverse=True))
                       + r")(?![\w-])", re.I)
# A regular expression literal may follow these (otherwise `/` divides).
REGEX_BEFORE = set("(,=:[!&|?{};+-*%<>~^") | {""}
REGEX_KEYWORDS = {"return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw"}


def strip_js_comments(src: str) -> str:
    """Remove // and /* */ comments, keeping strings, template literals and regex literals intact."""
    out, i, n = [], 0, len(src)
    last = ""          # last significant character emitted
    word = ""          # last identifier emitted (for `return /re/`)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "/" and nxt == "*":
            j = src.find("*/", i + 2)
            i = n if j < 0 else j + 2
            out.append(" ")
            continue
        if c in "'\"`":
            j = i + 1
            while j < n and src[j] != c:
                if src[j] == "\\":
                    j += 1
                elif c != "`" and src[j] == "\n":
                    break
                j += 1
            out.append(src[i:j + 1])
            i = j + 1
            last, word = c, ""
            continue
        if c == "/" and (last in REGEX_BEFORE or word in REGEX_KEYWORDS):
            j, cls = i + 1, False
            while j < n and src[j] != "\n":
                if src[j] == "\\":
                    j += 2
                    continue
                if src[j] == "[":
                    cls = True
                elif src[j] == "]":
                    cls = False
                elif src[j] == "/" and not cls:
                    break
                j += 1
            out.append(src[i:j + 1])
            i = j + 1
            last, word = "/", ""
            continue
        out.append(c)
        if not c.isspace():
            if c.isalnum() or c in "_$":
                word = word + c if (last.isalnum() or last in "_$") else c
            else:
                word = ""
            last = c
        i += 1
    return "".join(out)


def code_of(path: Path) -> str:
    text = path.read_text()
    if path.suffix == ".html":
        text = re.sub(r"<!--.*?-->", " ", text, flags=re.S)
    return strip_js_comments(text)


def shell_counts() -> dict[str, int]:
    counts = {}
    for p in sorted((ROOT / "web").rglob("*")):
        if not p.is_file() or p.suffix not in (".js", ".mjs", ".html") or "node_modules" in p.parts:
            continue
        rel = str(p.relative_to(ROOT))
        if rel.startswith(ADAPTERS):
            continue
        hits = len(SHELL_REF.findall(code_of(p)))
        if hits:
            counts[rel] = hits
    return counts


def test_shared_code_reaches_the_ha_shell_only_through_the_adapter():
    found = shell_counts()
    assert not found, f"Use hkShell (web/client/hk-host-shell.js); no HA shell reference is allowed outside the adapters: {found}"


def test_the_shared_shell_contract_names_no_ha_element():
    src = code_of(ROOT / "web/client/hk-host-shell.js")
    assert not SHELL_REF.findall(src)
    ha = (ROOT / "hosts/ha/frontend/hk-ha-shell.js").read_text()
    assert "location-changed" in ha and "ha-panel-lovelace" in ha and "ha-menu-button" in ha


# Phase 2 P2.4: the HK Settings panel draws with HK's own controls (the settings kit). HA's form
# elements are gone from it; the Lovelace card editors (web/hk/cards/, HA's "Edit card" dialog)
# keep ha-form, since they exist only inside HA.
PANELS = "web/hk/panels/"
FORM_NAMES = ("ha-form", "ha-yaml-editor", "ha-code-editor", "ha-entity-picker", "ha-selector", "ha-textfield",
              "ha-switch", "ha-select", "ha-combo-box", "ha-icon-picker", "ha-menu-button")
FORM_REF = re.compile(r"(?<![\w-])(?:" + "|".join(re.escape(n) for n in sorted(FORM_NAMES, key=len, reverse=True))
                      + r")(?![\w-])", re.I)


def test_the_settings_panel_names_no_ha_form_element():
    found = {}
    for p in sorted((ROOT / PANELS).glob("*.js")):
        hits = FORM_REF.findall(code_of(p))
        if hits:
            found[str(p.relative_to(ROOT))] = sorted(set(hits))
    assert not found, f"Use the settings kit (web/hk/panels/hk-settings-kit.js) or hkShell: {found}"
    # nor loads the frontend's card helpers to pull them in
    assert not any("loadCardHelpers" in code_of(p) for p in (ROOT / PANELS).glob("*.js"))


def test_form_lint_catches_the_names_and_ignores_comments():
    assert FORM_REF.findall(code_of_text("var f = document.createElement('ha-form');")) == ["ha-form"]
    assert FORM_REF.findall(code_of_text("customElements.get('ha-yaml-editor')")) == ["ha-yaml-editor"]
    assert not FORM_REF.findall(code_of_text("// ha-form did this\nx = 'ha-formula'; y = 'ha-switch-x';"))


def test_shell_lint_catches_lookups_and_ignores_comments():
    assert SHELL_REF.findall(code_of_text("var ha = document.querySelector('home-assistant');"))
    assert SHELL_REF.findall(code_of_text("window.addEventListener('location-changed', f);"))
    assert SHELL_REF.findall(code_of_text("if (n.tagName === 'HUI-VIEW-CONTAINER') return n;"))
    assert SHELL_REF.findall(code_of_text("css = 'ha-drawer > ha-sidebar{display:none}';")) == ["ha-drawer", "ha-sidebar"]
    assert not SHELL_REF.findall(code_of_text("// hui-root swaps views\n/* home-assistant */ x = 1;"))
    assert not SHELL_REF.findall(code_of_text("s = '--ha-sidebar-width'; t = 'home-assistant-js-websocket';"))
    assert not SHELL_REF.findall(code_of_text("u = 'https://x/y'; z = a / b; // location-changed"))
    assert SHELL_REF.findall(code_of_text("r = /a'b/; q = 'hass-more-info';")) == ["hass-more-info"]


# Phase 2 P2.3: a container card makes its children with hkCards.createCard (Lovelace's wrapper only
# where the host names one, hkShell.tags.card), and HK's view host makes no host element at all.
CARD_WRAPPER_MADE = re.compile(r"createElement\(\s*['\"]hui-card['\"]", re.I)
HOST_ELEMENT = re.compile(r"(?<![\w-])(?:hui|ha)-[a-z][a-z-]*(?![\w-])", re.I)


def test_containers_make_children_through_the_shared_factory():
    found = {}
    for p in sorted((ROOT / "web").rglob("*.js")):
        rel = str(p.relative_to(ROOT))
        if rel.startswith(ADAPTERS):
            continue
        hits = len(CARD_WRAPPER_MADE.findall(code_of(p)))
        if hits:
            found[rel] = hits
    assert not found, f"Make a child card with hkCards.createCard (web/hk/cards/hk-base.js): {found}"
    assert CARD_WRAPPER_MADE.findall("var el = document.createElement('hui-card');")


def test_the_view_host_names_no_host_element():
    src = code_of(ROOT / "web/hk/shell/hk-view-host.js")
    # CSS custom properties (--grid-card-gap) are not elements
    names = [m for m in HOST_ELEMENT.findall(src)]
    assert not names, names
    assert not SHELL_REF.findall(src)


def code_of_text(text: str) -> str:
    return strip_js_comments(text)


# Phase 2 P2.2: HK's cards draw with HK's own elements (web/hk/elements/hk-elements.js): hk-icon,
# hk-plate, and the host's hk-state-icon (bound with client.bindStateIcon). Shared code may no
# longer make or style HA's icon and card elements. The only names left are LOOKUPS that must also
# find Home Assistant's own card or icon on an HK page, each listed here with the line it sits on:
# the code, comments removed, must contain the snippet.
ELEMENT_NAMES = ("ha-icon", "ha-card", "ha-state-icon", "ha-svg-icon")
ELEMENT_REF = re.compile(r"(?<![\w-])(?:" + "|".join(re.escape(n) for n in sorted(ELEMENT_NAMES, key=len, reverse=True))
                         + r")(?![\w-])", re.I)
# what makes one: markup, createElement, the settings kit's h()
ELEMENT_MADE = re.compile(r"(?:<|createElement\(\s*['\"]|\bh\(\s*['\"])(?:"
                          + "|".join(re.escape(n) for n in sorted(ELEMENT_NAMES, key=len, reverse=True))
                          + r")(?![\w-])", re.I)
HA_ELEMENT_LOOKUPS = {
    # a row's lead: the first showing plate, an HK card's or HA's own card's (a conditional chip)
    "web/hk/cards/hk-row.js": ["el.shadowRoot.querySelector('hk-plate, ha-card')"],
    # the page edge: the outermost plate under a node, an HK card's or a native HA card's
    "web/hk/layout/hk-layout-grid.js": ["el.localName === 'hk-plate' || el.localName === 'ha-card'"],   # (hk-layout.js's part)
    # the hk: iconset repairs HA's ha-icon (other cards may draw hk: names with it) after a lost race
    "web/hk/iconset/hk-icons.js": ['el.localName === "ha-icon"'],
}


def element_refs() -> dict[str, list[str]]:
    """{file: [the code line of every HA icon/card element name]} in shared code (comments removed)."""
    out: dict[str, list[str]] = {}
    for p in sorted((ROOT / "web").rglob("*")):
        if not p.is_file() or p.suffix not in (".js", ".mjs", ".html", ".css") or "node_modules" in p.parts:
            continue
        rel = str(p.relative_to(ROOT))
        if rel.startswith(ADAPTERS):
            continue
        code = code_of(p) if p.suffix != ".css" else re.sub(r"/\*.*?\*/", " ", p.read_text(), flags=re.S)
        for line in code.splitlines():
            if ELEMENT_REF.search(line):
                out.setdefault(rel, []).append(line.strip())
    return out


def test_shared_code_makes_no_ha_icon_or_card():
    made = {}
    for rel, lines in element_refs().items():
        hits = [ln[:160] for ln in lines if ELEMENT_MADE.search(ln)]
        if hits:
            made[rel] = hits[:3]
    assert not made, f"Draw with hk-icon / hk-plate / hk-state-icon (web/hk/elements/hk-elements.js): {made}"


def test_ha_element_names_are_only_the_listed_lookups():
    found = element_refs()
    bad = {}
    for rel, lines in found.items():
        allowed = HA_ELEMENT_LOOKUPS.get(rel, [])
        stray = [ln[:160] for ln in lines if not any(a in ln for a in allowed)]
        if stray:
            bad[rel] = stray[:4]
    assert not bad, ("HK's own cards draw with hk-icon / hk-plate / hk-state-icon. A lookup that must also find HA's "
                     f"own element goes in HA_ELEMENT_LOOKUPS with its reason: {bad}")
    # and every listed lookup still exists (a stale allowance would let a new use in)
    for rel, allowed in HA_ELEMENT_LOOKUPS.items():
        for a in allowed:
            assert any(a in ln for ln in found.get(rel, [])), f"{rel}: listed lookup not found any more: {a}"


def test_element_lint_catches_the_names_and_ignores_comments():
    assert ELEMENT_MADE.findall(code_of_text("x = '<ha-card class=\"tile\">';"))
    assert ELEMENT_MADE.findall(code_of_text("var i = document.createElement('ha-icon');"))
    assert ELEMENT_MADE.findall(code_of_text("h('ha-icon', { icon: n })"))
    assert ELEMENT_MADE.findall(code_of_text("s = '<ha-state-icon></ha-state-icon>';")) == ["<ha-state-icon"]
    assert not ELEMENT_MADE.findall(code_of_text("q('hk-plate'); x = '<hk-icon icon=\"mdi:a\"></hk-icon>';"))
    assert ELEMENT_REF.findall(code_of_text("css = '.well ha-icon{--mdc-icon-size:20px}';")) == ["ha-icon"]
    assert not ELEMENT_REF.findall(code_of_text("// an <ha-card> did this\ns = '--ha-card-background'; t = 'ha-icon-picker';"))


# Phase 2 P2.5 (docs/phase2/SHEETS.md): HK's own sheets and dialogs. The generic sheet (hk-detail.js),
# the toast layer (web/hk/shell/hk-overlays.js) and the confirm/choose sheets (hk-base.js) are HK's;
# shared code never makes or asks for HA's dialogs or notifications. What the HA build still hands to
# HA (its more-info dialog, its snackbar) goes through hkShell (openHostDetail, the toast event), and
# only HA's shell names it.
DIALOG_NAMES = ("show-dialog", "ha-more-info-dialog", "more-info-dialog", "ha-toast", "notification-manager",
                "dialog-box", "ha-snackbar")
DIALOG_REF = re.compile(r"(?<![\w-])(?:" + "|".join(re.escape(n) for n in sorted(DIALOG_NAMES, key=len, reverse=True))
                        + r")(?![\w-])", re.I)


# LOOKUPS, not uses: the detail listener recognises HA's own dialogs in a tap's path, to leave a
# card inside one (the card editor's preview, HA's more-info) to HA.
HA_DIALOG_LOOKUPS = {
    "web/hk/sheets/hk-detail-routing.js": ["'HA-MORE-INFO-DIALOG': 1"],
}


def test_shared_code_asks_for_no_ha_dialog_or_notification():
    found = {}
    for p in sorted((ROOT / "web").rglob("*.js")):
        rel = str(p.relative_to(ROOT))
        if rel.startswith(ADAPTERS) or "node_modules" in p.parts:
            continue
        allowed = HA_DIALOG_LOOKUPS.get(rel, [])
        hits = [ln.strip()[:160] for ln in code_of(p).splitlines()
                if DIALOG_REF.search(ln) and not any(a in ln for a in allowed)]
        if hits:
            found[rel] = hits
    assert not found, f"HK draws its own sheets, toasts and confirmations (docs/phase2/SHEETS.md): {found}"
    for rel, allowed in HA_DIALOG_LOOKUPS.items():
        code = code_of(ROOT / rel)
        assert all(a in code for a in allowed), f"{rel}: listed lookup not found any more"
    assert DIALOG_REF.findall(code_of_text("el.dispatchEvent(new CustomEvent('show-dialog', {}));"))
    assert not DIALOG_REF.findall(code_of_text("// HA confirms through show-dialog\nx = 'hk-confirm';"))


def test_the_toast_layer_names_no_host_element():
    src = code_of(ROOT / "web/hk/shell/hk-overlays.js")
    assert not HOST_ELEMENT.findall(src) and not SHELL_REF.findall(src)


def test_hosts_declare_their_own_detail_and_toasts():
    contract = code_of(ROOT / "web/client/hk-host-shell.js")
    for name in ("hostDetail", "openHostDetail", "hostToast", "dialogRoot"):
        assert f"'{name}'" in contract, name                       # wrapped by the shell (a throw is no)
    mantel = code_of(ROOT / "web/shim/mantel-shell.js")
    for name in ("hostDetail", "openHostDetail", "hostToast"):
        assert re.search(name + r":\s*\(\)\s*=>\s*false", mantel), name
    ha = code_of(ROOT / "hosts/ha/frontend/hk-ha-shell.js")
    assert re.search(r"HA\.hostDetail = function \(\) \{ return true; \}", ha)
    assert re.search(r"HA\.hostToast = function \(\) \{ return true; \}", ha)
    assert "'hass-more-info'" in ha.split("HA.openHostDetail", 1)[1].split("};", 1)[0]


def test_mantel_loads_hk_toast_layer_and_ha_keeps_its_snackbar():
    home = (ROOT / "web/home.js").read_text()
    assert "import '/hk/shell/hk-overlays.js';" in home
    assert home.index("import './shim/mantel-shell.js';") < home.index("import '/hk/shell/hk-overlays.js';")
    boot = (ROOT / "hosts/ha/custom_components/hk_frontend/boot.py").read_text()
    assert "hk-overlays" not in boot                # HA draws its own toasts: the layer is not loaded there
