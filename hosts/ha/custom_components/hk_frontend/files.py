"""YOUR FILES: a folder served under /hk/ AHEAD of the bundled frontend.

Some of what these dashboards draw cannot ship with them. SF Pro and the SF
Symbols glyphs are Apple's, and Apple's license does not allow passing them on,
so each home supplies its own copies -- and they must survive an update, which
replaces this component's folder wholesale. So they live in a folder of the
user's choosing under /config (Settings -> Devices & services -> HK Frontend ->
Configure -> Your files), and a request for /hk/<path> is answered from
<that folder>/<path> when it exists there, and from frontend/<path> otherwise.

The URL never changes, which is the point: `/hk/fonts/SF-Pro.woff2` is the same
address whether the file comes from the bundle or from the folder, so moving a
file between the two is invisible to every page and every cached reference.

    <folder>/fonts/SF-Pro.woff2       (or SF-Pro.ttf, as Apple ships it)
    <folder>/iconset/hk-glyphs.js     the glyph data (tools/sf_symbols/)

Anything else placed there is served too -- a home's own probe pages, a
replacement texture -- and wins over the bundled file of the same name.

EXPOSURE. Like the bundle, the folder is served WITHOUT authentication (the
browser fetches fonts and modules with no auth header). So the folder must be
a dedicated one: `validate_folder` refuses /config itself, anything outside it,
a hidden folder or one inside it (.storage, .cloud, .ssh), Home Assistant's
own data folders (backups, custom_components, deps, ...), and any folder
holding secrets.yaml, .storage or configuration.yaml. And whatever the folder,
only WEB FILES are ever answered from it (`WEB_TYPES`): an extensionless
.storage/auth or a .yaml, .db or .key is a 404, never a download.
"""
from __future__ import annotations

import time
from pathlib import Path

from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from .const import DEFAULT_FILES_FOLDER, DOMAIN

FILES = "files"                     # hass.data[DOMAIN][FILES] -> resolved Path or None

# What the pages need from the folder, and the alternatives that satisfy it.
# The stylesheet asks for the woff2 first and the ttf second, so either works.
FONT = ("fonts/SF-Pro.woff2", "fonts/SF-Pro.ttf")
GLYPHS = ("iconset/hk-glyphs.js",)
BUNDLE = Path(__file__).parent / "frontend"
BUNDLE_ROOT = BUNDLE.resolve()

_FORBIDDEN = ("secrets.yaml", ".storage", "configuration.yaml")
# Home Assistant's own folders under /config: never a files folder, nor
# anything inside one (their data is private, and none of it is a web file).
_HA_FOLDERS = frozenset({"backups", "custom_components", "deps", "tts", "blueprints", "esphome",
                         "image", "homekit", "mqtt", "zigbee2mqtt", "matter", "known_devices"})
# What a files folder may serve: what a page loads, and nothing else.
WEB_TYPES = frozenset({".woff2", ".woff", ".ttf", ".otf", ".css", ".js", ".mjs", ".map", ".html",
                       ".htm", ".json", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico",
                       ".avif", ".webm", ".mp4", ".mov", ".mp3", ".m4a", ".wav", ".txt"})
ISSUES = ("missing_font", "missing_glyphs")      # the Repairs entries raise_issues keeps
# Their links. Placeholders, not text in the strings: hassfest refuses a URL in
# a translation.
REPO_URL = "https://github.com/jazzphone/hk-frontend"
LINKS = {"fonts_url": "https://developer.apple.com/fonts/", "repo_url": REPO_URL,
         "guide_url": REPO_URL + "/wiki/Your-Files"}


def normalize(config_dir: str, folder: str | None) -> str:
    """What people type -> a path relative to /config. Always relative: a
    leading "/", "/config/" or the real config path is dropped, so "/hk_local",
    "/config/hk_local" and "hk_local" are the same folder."""
    folder = (folder or "").strip()
    for prefix in (str(Path(config_dir)), "/config"):
        if folder == prefix or folder.startswith(prefix + "/"):
            folder = folder[len(prefix):]
            break
    return folder.strip("/")


def validate_folder(config_dir: str, folder: str) -> str | None:
    """None when `folder` is safe to serve, else a translation error key."""
    typed = (folder or "").strip()
    folder = normalize(config_dir, folder)
    if not folder:
        return "folder_is_config" if typed else "folder_required"
    base = Path(config_dir).resolve()
    try:
        path = (base / folder).resolve()
        path.relative_to(base)
    except (ValueError, OSError):
        return "folder_outside_config"
    if path == base:
        return "folder_is_config"
    parts = path.relative_to(base).parts
    if any(p.startswith(".") for p in parts) or parts[0].lower() in _HA_FOLDERS:
        return "folder_not_dedicated"
    if path.exists() and any((path / name).exists() for name in _FORBIDDEN):
        return "folder_not_dedicated"
    return None


def folder_path(config_dir: str, folder: str | None) -> Path | None:
    """The folder to serve, or None when it is unsafe or does not exist."""
    folder = normalize(config_dir, folder) or DEFAULT_FILES_FOLDER
    if validate_folder(config_dir, folder):
        return None
    path = (Path(config_dir) / folder).resolve()
    return path if path.is_dir() else None


WANTED = "files_wanted"              # the folder asked for, even if it isn't there yet
CHECKED = "files_checked"            # when a missing folder was last looked for
RECHECK_S = 30.0


def set_folder(hass: HomeAssistant, folder: str | None) -> None:
    """Called at setup and on every options change (in the executor)."""
    data = hass.data.setdefault(DOMAIN, {})
    data[WANTED] = folder
    data[CHECKED] = time.monotonic()
    data[FILES] = folder_path(hass.config.config_dir, folder)


def _root(hass: HomeAssistant) -> Path | None:
    """The folder being served. One created after start is found without a
    restart: while it is missing it is looked for again, at most every
    RECHECK_S seconds. Blocking; called in the executor."""
    data = hass.data.get(DOMAIN, {})
    root = data.get(FILES)
    if root is None and WANTED in data and time.monotonic() - data.get(CHECKED, 0.0) > RECHECK_S:
        data[CHECKED] = time.monotonic()
        root = data[FILES] = folder_path(hass.config.config_dir, data[WANTED])
    return root


def resolve(hass: HomeAssistant, filename: str) -> Path | None:
    """/hk/<filename> -> the file to send: yours first, then the bundle's."""
    roots = [_root(hass), BUNDLE_ROOT]
    for root in roots:
        if root is None:
            continue
        try:
            target = (root / filename).resolve()
            target.relative_to(root)          # raises if outside the root
        except (ValueError, OSError):
            continue
        if root is not BUNDLE_ROOT and target.suffix.lower() not in WEB_TYPES:
            continue                          # yours: web files only (EXPOSURE)
        if target.is_file():
            return target
    return None


def status(hass: HomeAssistant) -> dict[str, object]:
    """What the folder provides -- for diagnostics and the repair issues.
    Blocking; run it in the executor."""
    root = _root(hass)

    def found(names: tuple[str, ...]) -> str | None:
        for name in names:
            for base, label in ((root, "folder"), (BUNDLE, "bundled")):
                if base is not None and (base / name).is_file():
                    return f"{label}:{name}"
        return None

    return {"folder": str(root) if root else None,
            "font": found(FONT), "glyphs": found(GLYPHS)}


def raise_issues(hass: HomeAssistant, st: dict[str, object], folder: str | None) -> None:
    """A missing font or glyph set is a Repairs entry that says exactly where
    the file goes -- not a page that silently falls back to Roboto."""
    for key, have in zip(ISSUES, (st["font"], st["glyphs"]), strict=True):
        if have:
            ir.async_delete_issue(hass, DOMAIN, key)
        else:
            ir.async_create_issue(
                hass, DOMAIN, key, is_fixable=False, is_persistent=False,
                severity=ir.IssueSeverity.WARNING, translation_key=key,
                translation_placeholders={"folder": folder or DEFAULT_FILES_FOLDER, **LINKS})
