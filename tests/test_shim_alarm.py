"""HK's alarm keypad on the page side (web/shim/mantel-client.js): the keypad card's call goes to the gateway
as ONE service command whose code the server's classify() takes out (alarm_pin.py checks it); a wrong,
missing or locked-out code comes back for the card to show "Wrong code", with no "Not allowed" toast on
top; any other refusal still raises the toast. Run in node (tests/shim_alarm_harness.mjs)."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from mantel_server.gateway import classify, load_writes

ROOT = Path(__file__).resolve().parent.parent
PANEL = "alarm_control_panel.house_pin"


@pytest.fixture(scope="module")
def observed():
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    out = subprocess.run(["node", str(ROOT / "tests/shim_alarm_harness.mjs"), str(ROOT / "web/client/hk-client.js"),
                          str(ROOT / "web/shim/mantel-client.js")], capture_output=True, text=True, timeout=30)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_the_keypad_press_is_one_service_command_whose_code_the_server_takes_out(observed):
    first = observed["sent"][0]
    assert first == {"kind": "service", "domain": "alarm_control_panel", "service": "alarm_disarm",
                     "data": {"entity_id": PANEL, "code": "8642"}}
    cmd = classify(first, load_writes())
    assert cmd.code == "8642" and cmd.frame["service_data"] == {"entity_id": PANEL}
    assert observed["ok"] == {"ok": True, "shows": None}
    assert len(observed["sent"]) == 5                 # one command per press, no retries


def test_keypad_refusals_are_the_cards_to_show(observed):
    assert observed["wrong"]["shows"] == "Wrong code" and observed["wrong"]["error"] == "Wrong code"
    assert observed["locked"]["shows"] == "Wrong code" and "locked" in observed["locked"]["error"]
    assert observed["required"]["shows"] == "Wrong code"
    assert observed["deniedAfterKeypad"] == []        # no "Not allowed" toast on top of the card's own


def test_other_refusals_still_raise_the_toast(observed):
    assert observed["forbidden"]["ok"] is False and observed["forbidden"]["shows"] == "Alarm not responding"
    assert [d["reason"] for d in observed["deniedAfterForbidden"]] == ["explicit_deny"]
