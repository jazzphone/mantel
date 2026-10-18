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


def code_of_text(text: str) -> str:
    return strip_js_comments(text)
