"""The old paths of modules that moved into packages, importable for one release (tools/move_py.py, phase 25).

`import mantel_server.accounts` and `from mantel_server import accounts` still work and give the very module that now lives
at `mantel_server.identity.accounts`: the same object, so a monkeypatch on either path reaches both. Nothing is imported until
an old path is: a finder answers only for the names in the table, and loads the new module when asked. The table is written
by the tool, one row per moved module, with the release the old path goes away in; the next release deletes its rows
(`tools/move_py.py --expired VERSION` lists them) and then the finder has nothing left to answer.
"""
from __future__ import annotations

import importlib
import importlib.abc
import importlib.machinery
import sys

# old name -> (new path under mantel_server, the release the old name goes away in)
MOVED: dict[str, tuple[str, str]] = {
    # --- the table: written by tools/move_py.py ---
    "about": ("pages.about", "0.1.166"),
    "accounts": ("identity.accounts", "0.1.166"),
    "admin_page": ("pages.admin_page", "0.1.166"),
    "app_api": ("apps.app_api", "0.1.166"),
    "app_auth": ("apps.app_auth", "0.1.166"),
    "app_crypto": ("apps.app_crypto", "0.1.166"),
    "app_music": ("apps.app_music", "0.1.166"),
    "app_shell": ("apps.app_shell", "0.1.166"),
    "atrest": ("storage.atrest", "0.1.166"),
    "audit": ("storage.audit", "0.1.166"),
    "auth": ("identity.auth", "0.1.166"),
    "authz": ("identity.authz", "0.1.166"),
    "backup": ("storage.backup", "0.1.166"),
    "camera_setup": ("cameras.camera_setup", "0.1.166"),
    "cameras_direct": ("cameras.cameras_direct", "0.1.166"),
    "cf_access": ("identity.cf_access", "0.1.166"),
    "connect_pairing": ("network.connect_pairing", "0.1.166"),
    "cutout": ("cameras.cutout", "0.1.166"),
    "db": ("storage.db", "0.1.166"),
    "default_screens": ("pages.default_screens", "0.1.166"),
    "direct": ("network.direct", "0.1.166"),
    "direct_tls": ("network.direct_tls", "0.1.166"),
    "docs_pages": ("pages.docs_pages", "0.1.166"),
    "door_key": ("identity.door_key", "0.1.166"),
    "faces": ("cameras.faces", "0.1.166"),
    "feature_pages": ("pages.feature_pages", "0.1.166"),
    "frame_origins": ("network.frame_origins", "0.1.166"),
    "gateway": ("ha.gateway", "0.1.166"),
    "guards": ("identity.guards", "0.1.166"),
    "ha_client": ("ha.ha_client", "0.1.166"),
    "ha_dashboards": ("ha.ha_dashboards", "0.1.166"),
    "ha_oauth": ("ha.ha_oauth", "0.1.166"),
    "hidden": ("accessories.hidden", "0.1.166"),
    "image_work": ("cameras.image_work", "0.1.166"),
    "imaging": ("cameras.imaging", "0.1.166"),
    "ingress": ("network.ingress", "0.1.166"),
    "laundry": ("features.laundry", "0.1.166"),
    "linked_actions": ("linked.linked_actions", "0.1.166"),
    "linked_files": ("linked.linked_files", "0.1.166"),
    "linked_house": ("linked.linked_house", "0.1.166"),
    "linked_owners": ("linked.linked_owners", "0.1.166"),
    "linked_pairing": ("linked.linked_pairing", "0.1.166"),
    "linked_reads": ("linked.linked_reads", "0.1.166"),
    "linked_settings": ("linked.linked_settings", "0.1.166"),
    "live_tv": ("cameras.live_tv", "0.1.166"),
    "login_page": ("identity.login_page", "0.1.166"),
    "media_proxy": ("cameras.media_proxy", "0.1.166"),
    "music_announcements": ("music.music_announcements", "0.1.166"),
    "music_browse": ("music.music_browse", "0.1.166"),
    "music_calls": ("music.music_calls", "0.1.166"),
    "music_docs": ("music.music_docs", "0.1.166"),
    "music_library": ("music.music_library", "0.1.166"),
    "music_names": ("music.music_names", "0.1.166"),
    "music_states": ("music.music_states", "0.1.166"),
    "notify_snaps": ("cameras.notify_snaps", "0.1.166"),
    "page_headers": ("pages.page_headers", "0.1.166"),
    "page_health": ("pages.page_health", "0.1.166"),
    "people_ha": ("ha.people_ha", "0.1.166"),
    "photos": ("cameras.photos", "0.1.166"),
    "pins": ("identity.pins", "0.1.166"),
    "protect_api": ("cameras.protect_api", "0.1.166"),
    "protect_connector": ("cameras.protect_connector", "0.1.166"),
    "proxy_check": ("network.proxy_check", "0.1.166"),
    "proxy_trust": ("network.proxy_trust", "0.1.166"),
    "rbac": ("identity.rbac", "0.1.166"),
    "rbac_store": ("identity.rbac_store", "0.1.166"),
    "readproxy": ("ha.readproxy", "0.1.166"),
    "registry": ("ha.registry", "0.1.166"),
    "registry_feed": ("ha.registry_feed", "0.1.166"),
    "screens": ("pages.screens", "0.1.166"),
    "security_headers": ("network.security_headers", "0.1.166"),
    "service_accounts": ("identity.service_accounts", "0.1.166"),
    "sessions": ("identity.sessions", "0.1.166"),
    "setup_check": ("pages.setup_check", "0.1.166"),
    "setup_guide": ("pages.setup_guide", "0.1.166"),
    "socket_reads": ("ha.socket_reads", "0.1.166"),
    "state": ("ha.state", "0.1.166"),
    "store": ("storage.store", "0.1.166"),
    "supervisor_discovery": ("ha.supervisor_discovery", "0.1.166"),
    "talk_direct": ("intercom.talk_direct", "0.1.166"),
    "talk_relay": ("intercom.talk_relay", "0.1.166"),
    "timers": ("features.timers", "0.1.166"),
    "tv": ("features.tv", "0.1.166"),
    "user_data": ("storage.user_data", "0.1.166"),
    "user_files": ("storage.user_files", "0.1.166"),
    "vacuum_water": ("features.vacuum_water", "0.1.166"),
    # --- end of the table ---
}


class _Alias(importlib.abc.Loader):
    """Loads an old name by importing the new module and handing back that same object."""

    def __init__(self, target: str) -> None:
        self.target = target
        self.real = None

    def create_module(self, spec):
        self.real = importlib.import_module(self.target)
        self.spec = self.real.__spec__
        return self.real

    def exec_module(self, module) -> None:
        # the import system has just put the alias's spec on the module; the module keeps its own
        module.__spec__ = self.spec


class _Finder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        head, _, name = fullname.rpartition(".")
        if head != "mantel_server" or name not in MOVED:
            return None
        return importlib.machinery.ModuleSpec(fullname, _Alias("mantel_server." + MOVED[name][0]))


def install() -> None:
    if not any(isinstance(f, _Finder) for f in sys.meta_path):
        sys.meta_path.insert(0, _Finder())
