"""The Intercom on the page (docs/phase17/INTERCOM.md, slice 17.3): the sheet's decisions, the microphone module and
the Worker that owns the audio socket, and the action port and feed on Mantel's shim, all run in node
(tests/intercom_harness.mjs, tests/intercom_shim_harness.mjs) with fakes for the microphone, the socket, the clock and
the gateway -- no sound, no DOM, no network. The headless WebKit check (tools/headless/intercom_check.py) draws it.

The scenarios are named in the harness; each is one test here, so a failure names itself."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from hk_core.settings import home_grid as HG

ROOT = Path(__file__).resolve().parent.parent

SCENARIOS = [
    "mic_level_and_stamp",
    "worker_holds_frames_until_signed_in_then_sends_them_in_order",
    "worker_sends_nothing_while_not_recording_and_the_copy_matches",
    "worker_sync_waits_for_the_socket_and_says_closed_when_there_is_none",
    "worker_a_cancel_starts_the_count_again_and_server_events_reach_the_page",
    "worker_auth_invalid_is_an_error_and_a_close",
    "worker_uploads_a_whole_recording_as_forty_millisecond_frames_then_says_so",
    "worker_paces_an_upload_to_the_servers_bucket_a_burst_under_a_second_then_a_little_over_real_time",
    "worker_paces_the_frames_held_before_sign_in_and_those_behind_a_live_start_in_order",
    "worker_a_close_is_a_normal_closure_and_stops_a_paced_upload",
    "worker_a_held_queue_that_overflows_says_it_dropped",
    "worker_ignores_an_old_sockets_open_and_close_lets_go",
    "session_makes_the_context_at_24000_inside_the_press_and_says_the_rate_it_got",
    "session_start_says_no_unless_the_context_runs_and_a_later_touch_makes_it_run_without_a_second_microphone",
    "session_reports_the_rate_of_the_context_actually_built",
    "session_a_browser_that_will_not_join_the_rates_gets_the_context_at_its_own",
    "session_keeps_a_copy_plays_it_and_close_lets_everything_go",
    "session_ends_a_worker_that_never_says_bye_after_a_moment",
    "session_ignores_an_old_sockets_words",
    "supported_needs_a_microphone_a_worker_and_a_worklet",
    "picker_glyphs_and_what_a_tap_can_pick",
    "picker_live_glyphs_waveform_clock_person",
    "picker_a_leader_of_many_names_one_and_a_count",
    "picker_a_group_leader_says_who_it_plays_with_but_can_be_picked_and_says_why_on_a_tap",
    "picker_a_floor_or_preset_that_is_another_target_is_left_out",
    "picker_floors_presets_and_whole_house",
    "picker_a_skipped_pill_says_why_and_is_not_picked",
    "picker_nothing_to_send_to_names_why",
    "picker_a_room_the_feed_no_longer_has_is_not_chosen",
    "mode_the_switch_is_hidden_unless_live_is_allowed",
    "mode_is_remembered_per_person_with_the_rooms",
    "mode_another_screens_change_is_followed_until_this_one_chooses",
    "mode_a_switch_while_a_message_waits_is_not_allowed",
    "message_record_stop_sends_sent",
    "message_too_short_is_dropped_with_a_word",
    "message_play_plays_the_pages_copy_and_stops",
    "message_re_record_cancels_the_draft_and_reuses_the_open_socket",
    "message_cancel_drops_the_draft_and_the_socket",
    "message_send_with_nothing_picked_asks_for_rooms",
    "message_a_socket_that_did_not_keep_up_is_replaced_by_an_upload_of_the_copy",
    "message_dropped_frames_are_made_up_by_the_upload_too",
    "message_send_again_is_a_new_ticket_and_the_copy",
    "message_a_failed_room_is_named",
    "message_send_anyway_asks_again_for_the_quiet_rooms_with_override",
    "message_no_send_anyway_for_someone_who_may_not",
    "message_the_floor_is_held_by_someone_else",
    "message_server_errors_are_said_in_words",
    "message_the_socket_dropping_while_sending_keeps_the_copy_for_send_again",
    "message_the_limit_ends_the_recording_by_the_clock_and_by_the_servers_word",
    "words_https_and_needs_mantel_and_off_and_one_way",
    "words_idle_lines",
    "refusals_are_said_and_end_the_recording_unless_trying_again_would_do",
    "refusals_the_gateways_reasons_are_said_in_plain_words",
    "refusals_the_microphone_not_allowed_or_missing",
    "ticket_the_rate_is_the_one_of_the_context_built_and_only_a_rate_the_server_accepts",
    "words_a_suspended_context_or_a_recording_with_nothing_in_it_says_to_tap_again",
    "pointer_the_release_and_the_click_unlock_the_audio_again_for_a_touch",
    "live_with_no_room_picked_opens_no_microphone_and_says_so",
    "live_after_busy_the_socket_is_closed_so_send_again_opens_a_new_one",
    "a_stale_ticket_after_cancel_opens_nothing",
    "pointer_a_message_tap_acts_on_release_and_a_cancel_does_nothing",
    "dispose_closes_the_microphone_and_saves_what_was_picked",
    "live_hold_to_talk_starts_at_the_press_and_ends_at_the_release",
    "live_is_push_to_talk_and_a_short_tap_says_hold",
    "live_a_taken_press_ends_a_held_talk",
    "live_the_status_uses_the_feeds_lag_then_the_servers_and_the_servers_sending_frame_changes_nothing_else",
    "live_rooms_that_did_not_connect_live_are_named_and_the_talk_ends_on_the_servers_word",
    "live_a_socket_that_drops_mid_talk_sends_the_copy_as_a_message_on_a_new_ticket",
    "live_someone_else_has_the_floor_and_the_press_goes_no_further",
    "listener_a_tablet_that_is_no_listener_makes_no_audio_and_no_pill",
    "listener_plays_a_clip_once_at_its_volume_and_never_the_same_id_twice",
    "listener_a_context_that_wont_start_shows_one_pill_and_the_first_touch_plays_the_clip",
    "listener_a_clip_that_waited_over_a_minute_for_a_touch_is_dropped",
    "listener_a_tablet_that_is_itself_talking_plays_nothing",
    "listener_busy_follows_the_open_sheets_state",
    "listener_a_clip_that_cannot_be_fetched_is_skipped_and_the_next_one_plays",
    "mic_a_press_while_the_microphone_module_is_on_its_way_says_connecting_not_no_microphone",
    "feed_keeps_the_listener_flag_and_the_play_snapshot",
]


@pytest.fixture(scope="module")
def results():
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    out = subprocess.run(["node", str(ROOT / "tests/intercom_harness.mjs"), str(ROOT / "web/hk/modules/hk-mic.js"),
                          str(ROOT / "web/hk/cards/hk-intercom.js")], capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr
    return {r["name"]: r for r in json.loads(out.stdout.strip().splitlines()[-1])}


@pytest.mark.parametrize("name", SCENARIOS)
def test_scenario(results, name):
    r = results[name]
    assert r["ok"], r.get("error")


def test_every_scenario_in_the_harness_is_named_here(results):
    assert sorted(results) == sorted(SCENARIOS)


# ---------------------------------------------------------------- the shim: the action port and the feed
@pytest.fixture(scope="module")
def shim(tmp_path_factory):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    d = tmp_path_factory.mktemp("intercom-shim")
    (d / "base.mjs").write_text((ROOT / "web/shim/base.js").read_text())
    (d / "hub.mjs").write_text((ROOT / "web/shim/hub.js").read_text().replace("from './base.js'", "from './base.mjs'"))
    out = subprocess.run(["node", str(ROOT / "tests/intercom_shim_harness.mjs"), str(ROOT / "web/client/hk-client.js"),
                          str(ROOT / "web/shim/mantel-client.js"), str(d)], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_the_press_is_one_gateway_intercom_command_and_gets_the_socket_and_a_ticket(shim):
    assert shim["okSent"] == [{"kind": "intercom", "mode": "message", "rate": 24000}]
    assert shim["ok"] == {"url": "wss://mantel.test/ws/intercom", "token": "fictional-ticket-9"}
    assert shim["liveSent"] == [{"kind": "intercom", "mode": "live", "rate": 48000}]
    assert shim["actions"][-1] == "intercom"


def test_the_gateways_refusals_reach_the_sheet_by_their_own_codes(shim):
    assert [r["error"] for r in shim["refusals"]] == ["commands_disabled", "forbidden", "unavailable", "intercom_off"]
    assert shim["noTicket"]["error"] == "unavailable", "an answer with no ticket is not a socket"


def test_nothing_is_sent_for_a_mode_or_rate_the_server_would_refuse(shim):
    assert [b["error"] for b in shim["bad"]] == ["invalid"] * 5 and shim["badSent"] == 0


def test_with_commands_off_the_feed_still_draws_and_the_press_is_refused_before_anything_is_sent(shim):
    assert shim["offFeed"] == "function"
    assert shim["off"] == {"error": "commands_disabled"} and shim["offSent"] == 0


def test_a_host_without_the_intercom_has_no_feed_and_no_action(shim):
    assert shim["oldFeed"] is None and shim["oldAction"]["error"] == "invalid"


def test_the_feed_is_asked_for_kept_answered_resumed_and_let_go(shim):
    assert shim["earlySent"] == [{"type": "intercom/subscribe", "id": 1}], "asked for before the socket opened: sent when it did"
    assert shim["early"] == [[{"enabled": True, "rooms": []}, None]]
    assert shim["got"][0][0]["rooms"][0]["room"] == "media_player.kitchen"
    assert shim["got"][1] == [None, {"code": "intercom_off"}] and shim["got"][2][1]["code"] == "unknown_type"
    assert shim["resumed"] == shim["ids"], "a new socket asks again under the same ids"
    assert shim["unsub"] == shim["ids"]
    assert shim["url"] == "wss://mantel.test/ws/intercom"
    assert shim["fed"] == {"enabled": True}


def test_a_clips_address_is_given_the_pages_own_prefix_by_the_shim_and_nothing_else_is_touched(shim):
    got = shim["prefixed"]
    assert got[0]["play"] == {"id": "b1", "url": "/api/hassio_ingress/abc/api/intercom/clip/b1.wav", "volume": 0.5}
    assert got[1]["play"]["url"] == "https://elsewhere.example/x.wav", "only an address on this server is moved"
    assert got[2]["play"] is None and got[3] is None


def test_a_wall_tablet_asks_the_feed_once_and_wakes_the_intercom_only_when_it_listens(shim):
    """Only a device session asks (home.js); a page that is no listener loads nothing; one that is loads the lazy
    file, tells it to listen and lets its own subscription go (the file subscribes itself)."""
    assert shim["ear"] == {"none": False, "noFeed": False}, "a hub without the feed is no ear"
    assert shim["earStarted"] is True and shim["earTwice"] is False
    assert shim["earQuiet"] == {"asked": [], "told": [], "gone": 0, "subscribed": 1}
    assert shim["earListens"] == {"asked": ["hk-intercom.js"], "told": ["listen"], "gone": 1, "subscribed": 1}


# ---------------------------------------------------------------- where things are
def test_the_block_is_in_both_catalogs_and_opens_no_other_way():
    assert HG.CATALOG["intercom"] == {"sizes": ("S", "W"), "sources": (), "opts": {}}
    cat = (ROOT / "web/hk/cards/hk-grid-catalog.js").read_text()
    assert "type: 'custom:hk-intercom-card', size: s" in cat
    ed = (ROOT / "web/hk/panels/hk-grid-editor.js").read_text()
    assert "intercom: 'Intercom'" in ed and "'intercom']" in ed and "intercom: 'mdi:microphone'" in ed


def test_the_intercom_costs_a_page_nothing_it_does_not_use():
    """The card file is a lazy one (no page loads it until its block is drawn, `#intercom` is on the address or a
    listening tablet asks), the microphone module is no bootstrap module, and no page starts the listener by loading."""
    from mantel_server import hk_cards
    got = hk_cards.card_list(ROOT / "web/hk/cards")
    assert "hk-intercom.js" in got["lazy"] and "hk-intercom.js" not in got["core"]
    assert got["lazy"]["hk-intercom.js"] == ["hk-intercom-card", "hk-intercom-sheet-card"]
    loader = (ROOT / "web/hk/modules/hk-loader.js").read_text()
    assert "'hk-mic.js'" not in loader, "hk-mic.js is imported by the sheet, not by every page"
    assert "location.hash === '#intercom'" in loader and "needFile('hk-intercom.js')" in loader
    card = (ROOT / "web/hk/cards/hk-intercom.js").read_text()
    assert "/hk/modules/hk-mic.js" in card and "needMic().then" in card
    assert "C.onClient(startListener)" not in card and "window.hkIntercom.listen = " in card
    home = (ROOT / "web/home.js").read_text()
    assert "if (user.at_tablet === true) window.hkMantelClient.listenAtDevice(hub)" in home


def test_a_card_given_no_microphone_module_asks_for_it_by_the_builds_address_and_says_so_while_it_comes(tmp_path):
    if shutil.which("node") is None:
        pytest.skip("node not installed")
    out = subprocess.run(["node", str(ROOT / "tests/intercom_harness.mjs"), str(ROOT / "web/hk/modules/hk-mic.js"),
                          str(ROOT / "web/hk/cards/hk-intercom.js"), "--lazy-mic"], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    got = json.loads(out.stdout.strip().splitlines()[-1])
    assert got == {"before": [False, False], "asked": ["/hk/modules/hk-mic.js?v=9"], "during": [True, True, "mic"],
                   "after": [False, True], "again": 1, "failed": [False, False], "retried": 2}


def test_the_new_files_name_no_host_object_and_leave_the_doorbell_alone():
    for rel in ("web/hk/cards/hk-intercom.js", "web/hk/modules/hk-mic.js"):
        assert not re.search(r"\bhass\b", (ROOT / rel).read_text()), rel
    cams = (ROOT / "web/hk/cards/hk-cameras.js").read_text()
    assert "hk-mic" not in cams and "hk-intercom" not in cams


def test_the_sheet_is_opened_by_the_block_the_address_and_the_open_call():
    card = (ROOT / "web/hk/cards/hk-intercom.js").read_text()
    assert "location.hash !== '#intercom'" in card
    assert "custom:hk-intercom-sheet-card" in card and "D.open(null" in card
    assert "self._tap()" in card and "window.hkIntercom.open()" in card


def test_the_microphone_press_is_a_pointer_event_with_pointercancel_and_no_touch_scroll():
    card = (ROOT / "web/hk/cards/hk-intercom.js").read_text()
    for ev in ("pointerdown", "pointerup", "pointercancel"):
        assert f"addEventListener('{ev}'" in card
    assert "touch-action:none" in card and ":hover" not in card
    assert "height:44px" in card, "44 pt targets"


def test_the_block_wears_the_other_blocks_tile_language_standard_and_homeview():
    """Not a look of its own (the owner, 2026-11-04): the key's well, name and state lines of KEY_CSS, the centred tile's numbers
    in the HomeView look (hkCards.centredTile, the glyph's ink), and Wide drawn as the Scenes block draws it."""
    card = (ROOT / "web/hk/cards/hk-intercom.js").read_text()
    for needle in ("C.centredTile({ host: ':host([tile=centred])'", "TILE.centred.square.box", "C.blockPad('14px')", "TILE.lineH",
                   "TILE.rowGap", "e.icon.setAttribute('ink'", "observedAttributes"):
        assert needle in card, needle
    assert "max-width:110px" not in card, "no chip cut in two by a width of its own: whole rooms, then +N"


def test_the_sheet_is_as_tall_as_its_cards_and_every_pill_is_one_size_on_one_grid():
    card = (ROOT / "web/hk/cards/hk-intercom.js").read_text()
    assert "width: 'wide', height: 'auto'" in card
    assert "grid-template-columns:repeat(auto-fill,minmax(var(--mn),1fr))" in card and "grid-auto-rows:44px" in card
    group = (ROOT / "web/hk/sheets/hk-sheet-group.js").read_text()
    assert "hkAutoHeight() { return (this._config || {}).height === 'auto'; }" in group
    assert "height: opts.cards.height" in (ROOT / "web/hk/cards/hk-detail.js").read_text()
