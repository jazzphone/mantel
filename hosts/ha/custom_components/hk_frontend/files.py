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

import gzip
import hashlib
import threading
import time
from collections import OrderedDict
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
# COMMENTS AND INDENTATION STRIPPED (2026-10-29): the published component carries, beside frontend/, frontend_min/ --
# frontend/'s .js and .css files as esbuild's whitespace minifier left them (Mantel's tools/build_static.py, run by
# tools/publish/publish.py): no comments, no indentation, nothing renamed, about 45% smaller. /hk sends that copy
# of a file; frontend/ keeps the readable source (the tests read it, and so can anyone). A file in frontend/ newer
# than its copy (edited in place on a house) is sent itself.
MINIFIED = Path(__file__).parent / "frontend_min"
MINIFIED_ROOT = MINIFIED.resolve()
MINIFIED_TYPES = frozenset({".js", ".css"})

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
            return _minified(target) if root is BUNDLE_ROOT else target
    return None


def _minified(target: Path) -> Path:
    """The bundle's file, or its minified copy (MINIFIED) when there is one at least as new."""
    if target.suffix.lower() not in MINIFIED_TYPES:
        return target
    try:
        copy = MINIFIED_ROOT / target.relative_to(BUNDLE_ROOT)
        if copy.stat().st_mtime >= target.stat().st_mtime:
            return copy
    except (ValueError, OSError):
        pass
    return target


# GZIP, MADE HERE AND KEPT (2026-10-29). /hk is served from this component's own folder, which carries no
# .gz copies (the HACS repository would double in size), so the text files went to a tablet at full size on
# every first load. They are now gzipped once, in memory, for a browser that accepts it: the cache is keyed by
# path, mtime and size (an edited file is a new key; the old one ages out), bounded in bytes, and the work is
# done by the caller in the executor -- a 300 KB module takes ~15 ms to compress, which Home Assistant's event
# loop must not wait for. Images, fonts and the like are already compressed; they go as they are.
GZIP_TYPES = frozenset({".js", ".mjs", ".css", ".json", ".html", ".svg"})
GZIP_MIN = 1024                      # smaller is not worth the header
GZIP_MAX = 8 * 1024 * 1024           # larger is streamed plain, not held in memory
GZIP_CACHE_LIMIT = 24 * 1024 * 1024  # all the gzipped bodies together
_GZIPPED: "OrderedDict[tuple, tuple[bytes, str]]" = OrderedDict()
_GZIPPED_SIZE = [0]
_GZIP_LOCK = threading.Lock()


def accepts_gzip(header: str | None) -> bool:
    """An Accept-Encoding header that names gzip (or *) and does not give it q=0."""
    for part in (header or "").lower().split(","):
        name, _, params = part.partition(";")
        if name.strip() in ("gzip", "x-gzip", "*"):
            q = params.replace(" ", "")
            try:
                return not (q.startswith("q=") and float(q[2:]) == 0)
            except ValueError:
                return True
    return False


def _keep(key: tuple, body: bytes, etag: str) -> None:
    with _GZIP_LOCK:
        if key in _GZIPPED:
            return
        _GZIPPED[key] = (body, etag)
        _GZIPPED_SIZE[0] += len(body)
        while _GZIPPED_SIZE[0] > GZIP_CACHE_LIMIT and len(_GZIPPED) > 1:
            _, (old, _) = _GZIPPED.popitem(last=False)
            _GZIPPED_SIZE[0] -= len(old)


def _kept(key: tuple) -> tuple[bytes, str] | None:
    with _GZIP_LOCK:
        hit = _GZIPPED.get(key)
        if hit is not None:
            _GZIPPED.move_to_end(key)
        return hit


def gzipped(target: Path) -> tuple[bytes, str] | None:
    """(the file gzipped, its ETag) for a text file over GZIP_MIN, or None when it is to be sent as it is (not a
    text type, small, very large, or gzip would not shrink it). Blocking: called in the executor."""
    if target.suffix.lower() not in GZIP_TYPES:
        return None
    try:
        st = target.stat()
        if st.st_size < GZIP_MIN or st.st_size > GZIP_MAX:
            return None
        key = (str(target), st.st_mtime_ns, st.st_size)
        hit = _kept(key)
        if hit is None:
            packed = gzip.compress(target.read_bytes(), compresslevel=6, mtime=0)
            if len(packed) >= st.st_size:
                return None
            hit = (packed, f'"{st.st_mtime_ns:x}-{st.st_size:x}-gz"')
            _keep(key, *hit)
        return hit
    except OSError:
        return None


def gzipped_text(name: str, text: str) -> tuple[bytes, str]:
    """The same for text made on the spot (the ordered boot file, rebuilt on each request): kept by its own
    digest, so an unchanged boot file is compressed once. Blocking: called in the executor."""
    raw = text.encode("utf-8")
    digest = hashlib.sha256(raw).hexdigest()[:32]
    key = (name, digest, len(raw))
    hit = _kept(key)
    if hit is None:
        hit = (gzip.compress(raw, compresslevel=6, mtime=0), f'"{digest}-gz"')
        _keep(key, *hit)
    return hit


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
