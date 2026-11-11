"""Hidden accessories, worked out once for both hosts (hk_core/settings/hiding.py; phase 24's SHARED-REPORT, 2026-11-11).

The two copies had drifted: Mantel Server dropped a hidden device or room whose id is not a string and read an accessory
entry that is not a dict as an empty one; HK Frontend sent the bad id through, and failed on the entry. Both hosts call
the one snapshot_of now, so this holds for both.
"""
from __future__ import annotations

from pathlib import Path

from hk_core.settings import hiding

ROOT = Path(__file__).resolve().parents[1]


def test_a_bad_hidden_device_or_room_id_and_a_bad_accessory_entry_are_left_out():
    settings = {"generated": {"exclude_devices": ["dev1", 7, None], "exclude_areas": ["kitchen", 5],
                              "exclude_entities": ["light.a", 3]},
                "accessories": {"entities": {"light.a": "not a dict", "light.b": {"home": False}}}}
    snap = hiding.snapshot_of([], ["light.a", "light.b"], settings, None)
    assert snap["devices"] == ["dev1"] and snap["areas"] == ["kitchen"] and snap["everywhere"] == ["light.a"]
    assert snap["off"] == {"light.b": ["home"]}                   # light.a's entry is not a dict: nothing hidden
    assert snap["order"] == hiding.ORDER and snap["order"] is not hiding.ORDER     # a copy: the answer can't change it


def test_both_hosts_use_the_shared_snapshot_and_keep_no_copy_of_their_own():
    server = (ROOT / "hosts/server/mantel_server/accessories/hidden.py").read_text()
    ha = (ROOT / "hosts/ha/custom_components/hk_frontend/hiding.py").read_text()
    kinds = (ROOT / "hosts/ha/custom_components/hk_frontend/kinds.py").read_text()
    assert "return snapshot_of(self.candidates(), self.room_entities(), settings, only)" in server
    assert "return snapshot_of(kinds.candidates(hass), _room_entities(hass), settings, only)" in ha
    for text in (server, ha, kinds):
        assert "\ndef suggest(" not in text and "\ndef _also(" not in text and "\nPLACES: dict" not in text
