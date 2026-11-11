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
    "accounts": ("identity.accounts", "0.1.166"),
    "auth": ("identity.auth", "0.1.166"),
    "authz": ("identity.authz", "0.1.166"),
    "cf_access": ("identity.cf_access", "0.1.166"),
    "door_key": ("identity.door_key", "0.1.166"),
    "gateway": ("ha.gateway", "0.1.166"),
    "guards": ("identity.guards", "0.1.166"),
    "ha_client": ("ha.ha_client", "0.1.166"),
    "ha_dashboards": ("ha.ha_dashboards", "0.1.166"),
    "ha_oauth": ("ha.ha_oauth", "0.1.166"),
    "login_page": ("identity.login_page", "0.1.166"),
    "people_ha": ("ha.people_ha", "0.1.166"),
    "pins": ("identity.pins", "0.1.166"),
    "rbac": ("identity.rbac", "0.1.166"),
    "rbac_store": ("identity.rbac_store", "0.1.166"),
    "readproxy": ("ha.readproxy", "0.1.166"),
    "registry": ("ha.registry", "0.1.166"),
    "registry_feed": ("ha.registry_feed", "0.1.166"),
    "service_accounts": ("identity.service_accounts", "0.1.166"),
    "sessions": ("identity.sessions", "0.1.166"),
    "socket_reads": ("ha.socket_reads", "0.1.166"),
    "state": ("ha.state", "0.1.166"),
    "supervisor_discovery": ("ha.supervisor_discovery", "0.1.166"),
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
