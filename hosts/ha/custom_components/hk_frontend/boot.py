"""THE ORDERED BOOT: HK's bootstrap modules as ONE extra module, so they run in dependency order.

WHY. Home Assistant's frontend loads every extra module (`add_extra_js_url`) with its own
parallel `import()`, in no fixed order: the list is kept as a set (on the house's 2026.10.2 the
page asked for hk-icons, hk-ha-elements and hk-settings before hk-client). Each module then runs
when it arrives. HK's client, its HA adapter and the host shell depend on one another at load
time (hk-ha-client.js needs hkClient, hk-ha-shell.js needs hkShell, tesla-viewport.js calls
hkShell.onNavigate), so a load that lost the race threw ("HKClient has not loaded",
"hk-host-shell.js has not loaded"). In the scratch HA (docs/phase1/TESTHA.md) 3 to 12 of 12
reloads failed, and in the worst case the dashboard never drew.

HOW. HA is given a single URL, `/hk/modules/hk-boot.js`, which the /hk view answers with:
  1. CORE: the dependency-free core, the files' own text joined in order, each in its own block
     (its `let`/`const` stay its own). One file runs as one piece, so nothing in it can arrive
     early or late.
  2. AFTER: then the remaining bootstrap modules, imported in parallel as before. They use
     `import` themselves (hk-settings, hk-icons, hk-loader), are also a Lovelace resource and
     must keep their URL so they load once (hk-strategy), or come after the core (hk-header).
The text is read from the same files /hk serves (your files folder first) on every request,
with the same no-cache rule, so editing a file needs no restart, as before.
"""
from __future__ import annotations

import re
from collections.abc import Callable

BOOT = "modules/hk-boot.js"            # under /hk/
URL = "/hk/" + BOOT

# In dependency order. Every one is a plain script (no import/export): tests/py/test_boot.py.
CORE = (
    "modules/hk-client.js",            # HKClient
    "modules/hk-card-state.js",        # the card state hub (uses hkClient)
    "modules/hk-ha-client.js",         # HA's client adapter (needs hkClient)
    "modules/hk-host-shell.js",        # the host-shell contract
    "modules/hk-ha-shell.js",          # HA's shell (needs hkShell)
    "modules/hk-metric.js",
    "elements/hk-elements.js",         # hk-icon, hk-plate
    "modules/hk-ha-elements.js",       # HA's hk-state-icon
    "modules/tesla-viewport.js",       # needs hkShell
    "modules/hk-tap.js",
)
# Imported in parallel once the core has run (each needs the core; none needs another here).
AFTER = (
    "modules/hk-settings.js",
    "iconset/hk-icons.js",
    "modules/hk-header.js",
    "modules/hk-loader.js",
    "cards/hk-strategy.js",
)

_MODULE_SYNTAX = re.compile(r"^\s*(import|export)\s|\bimport\(", re.M)


def is_plain(text: str) -> bool:
    """A classic script: no import/export statement and no dynamic import()."""
    return not _MODULE_SYNTAX.search(text)


def bundle(read: Callable[[str], str | None]) -> str:
    """The boot file. `read(path)` gives a file's text (None when missing). A core file that is
    missing, or not a plain script, is imported by URL in its place instead (and said so)."""
    out = ["// HK's ordered boot (custom_components/hk_frontend/boot.py): the core in order, then the rest.\n"]
    late: list[str] = []
    for path in CORE:
        text = read(path)
        if text is None or not is_plain(text):
            why = "missing" if text is None else "not a plain script"
            out.append(f"console.error('hk-boot: /hk/{path} {why}; imported separately');\n")
            late.append(path)
            continue
        out.append(f"/* ---- /hk/{path} ---- */\n{{\n{text}\n}}\n")
    urls = ["/hk/" + p for p in late + list(AFTER)]
    out.append("\n;(function () {\n  [" + ", ".join(f'"{u}"' for u in urls) + "].forEach(function (u) {\n"
               "    // caught, as HA catches its own extra modules\n"
               "    import(u).catch(function (err) { console.error('Failed to load extra module ' + u, err); });\n"
               "  });\n})();\n")
    return "".join(out)
