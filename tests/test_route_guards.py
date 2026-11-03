"""Rules.md rule 7: a guard's spec refuses a contradiction (guards.py).

Every other check of the routes moved to the route table (phase 18, A7): tests/test_route_table.py builds the app
under every combination of options and applies route_table.py's rules R1-R12, and build_app refuses to start when
one breaks.
"""
from __future__ import annotations

from mantel_server.guards import Guard, OpenRoute


def test_a_guard_spec_refuses_a_contradiction():
    import pytest
    for bad in ({"who": "admin"}, {"who": "owner", "door": "tunnel"}, {"who": "person", "fresh": "away"},
                {"who": "signed_in", "device_ok": False}, {"who": "owner", "audit": ("x",), "no_audit": "why"}):
        with pytest.raises(ValueError):
            Guard(**bad)
    Guard("manager", fresh="away", audit="camera.rtsp.add")      # the cameras' setup: an Admin changes it too (2026-11-02)
    for bad in ({"who": "signed_in", "device_ok": True, "reads": "admin"}, {"who": "owner", "reads": "everything"},
                {"who": "owner", "reads": "none"}, {"who": "owner", "stream": "live"}, {"who": "owner", "stream": "open"},
                {"who": "owner", "reads": "admin", "preview": True}, {"who": "owner", "preview": "size"}):
        with pytest.raises(ValueError):
            Guard(**bad)
    for bad in ({"kind": "session", "why": "x"}, {"kind": "static", "why": " "}):
        with pytest.raises(ValueError):
            OpenRoute(**bad)
    assert OpenRoute("static", "a file").reads == "none"          # a static file carries no house data
    assert OpenRoute("app_dpop", "the app").reads is None          # an app's read says what it shows
