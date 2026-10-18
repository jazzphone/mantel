"""Guards for the Home-page proof: licensed files and personal data never tracked; read-only allowlists pinned."""
import importlib.util
import re
import subprocess
from pathlib import Path

import pytest

from mantel_server.readproxy import INTERNAL, READ_ALLOWED, ReadBlocked, check_read
from mantel_server.server import FIXTURE_FILES, safe_file

ROOT = Path(__file__).resolve().parent.parent
WRITE_WORDS = re.compile(r"(^|[/_])(set|save|remove|delete|add|update|create|order|favorite|touch|black|seen|mute|test|"
                         r"sign|queue|play|transfer|talk|offer|candidate|call_service|turn_on|turn_off|toggle)([/_]|$)")


def _tracked():
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return out.splitlines()


def test_no_tracked_file_under_the_hk_snapshot_or_named_like_apples_files():
    bad = [f for f in _tracked() if f.startswith("spikes/hk-snapshot/")
           or Path(f).name.lower().startswith("hk-glyphs")
           or (Path(f).name.lower().startswith("sf-pro") and Path(f).suffix.lower() in
               {".ttf", ".otf", ".woff", ".woff2"})]
    assert not bad, f"never track these: {bad}"


def test_snapshot_folder_is_ignored():
    for rel in ("spikes/hk-snapshot/frontend/cards/hk-tile.js", "spikes/hk-snapshot/fixtures/settings.json",
                "spikes/hk-snapshot/hk_local/fonts/SF-Pro.woff2", "web/anywhere/SF-Pro.woff2", "x/hk-glyphs.js"):
        r = subprocess.run(["git", "check-ignore", "-q", rel], cwd=ROOT)
        assert r.returncode == 0, f"{rel} must be git-ignored"


def _capture_tool():
    spec = importlib.util.spec_from_file_location("capture_fixtures", ROOT / "hosts/server/tools/capture_fixtures.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_capture_allowlist_is_pinned_and_only_subscriptions():
    mod = _capture_tool()
    assert set(mod.CAPTURE_ALLOWED) == {"hk_frontend/settings/subscribe", "hk_frontend/page_headers/subscribe",
                                        "hk_frontend/snooze/subscribe", "hk_music/subscribe"}
    for kind in mod.CAPTURE_ALLOWED:
        assert kind.endswith("/subscribe") and not WRITE_WORDS.search(kind)
        mod.check_capture({"id": 1, "type": kind})
    for bad in ("call_service", "hk_frontend/settings/set", "hk_frontend/board/set", "hk_music/queue_play",
                "hk_notify/mute", "hk_frontend/screensaver/black", "hk_frontend/tablet/seen", "config/entity_registry/update"):
        with pytest.raises(mod.CaptureBlocked):
            mod.check_capture({"id": 1, "type": bad})
    with pytest.raises(mod.CaptureBlocked):
        mod.check_capture({"id": 1, "type": "hk_music/subscribe", "extra": 1})
    assert FIXTURE_FILES == mod.CAPTURE_ALLOWED


def test_readproxy_allowlist_is_pinned_and_has_no_writes():
    assert set(READ_ALLOWED) == {"get_config", "frontend/get_themes", "weather/subscribe_forecast",
                                 "persistent_notification/subscribe", "history/history_during_period",
                                 "logbook/get_events", "recorder/statistics_during_period", "energy/get_prefs",
                                 "energy/info"}
    for kind, keys in READ_ALLOWED.items():
        assert not WRITE_WORDS.search(kind), kind
        assert not any(WRITE_WORDS.search(k) for k in keys), (kind, keys)
    assert INTERNAL == {"unsubscribe_events"}


@pytest.mark.parametrize("msg", [
    {"type": "call_service", "domain": "valve", "service": "close_valve"},
    {"type": "hk_frontend/settings/set"}, {"type": "frontend/set_user_data"}, {"type": "hk_music/queue_play"},
    {"type": "config/entity_registry/update"}, {"type": "camera/webrtc/offer"}, {"type": "subscribe_events"},
    {"type": "get_states"}, {"type": "weather/subscribe_forecast", "entity_id": "weather.x", "service": "x"},
    {"type": "history/history_during_period", "write": 1}, {},
])
def test_readproxy_refuses_everything_else(msg):
    with pytest.raises(ReadBlocked):
        check_read(msg)


def test_readproxy_accepts_the_reads():
    check_read({"id": 3, "type": "weather/subscribe_forecast", "entity_id": "weather.home", "forecast_type": "hourly"})
    check_read({"type": "get_config"})


def test_served_files_cannot_escape_their_folder(tmp_path):
    (tmp_path / "ok.js").write_text("1")
    (tmp_path / "secret.yaml").write_text("x")
    (tmp_path.parent / "outside.js").write_text("1")
    assert safe_file(tmp_path, "ok.js")
    assert safe_file(tmp_path, "secret.yaml") is None          # not a web file
    assert safe_file(tmp_path, "../outside.js") is None
    assert safe_file(tmp_path, "nope.js") is None
