"""hk_core.music.requests: how a music request the link answered "still going" ended, kept for the screen that asked.
Fictional rooms only."""
from __future__ import annotations

from hk_core.music.requests import KEEP_N, KEEP_S, Outcomes, outcome_of


class Boom(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


def test_an_outcome_is_the_few_fields_a_page_reads():
    assert outcome_of({"ok": True, "leader": "media_player.kitchen", "extra": 1}) == {"ok": True, "leader": "media_player.kitchen"}
    assert outcome_of({"ok": False, "message": "Kitchen did not start."}) == {"ok": False, "message": "Kitchen did not start."}
    assert outcome_of({"ok": True, "superseded": True}) == {"ok": True, "superseded": True}
    assert outcome_of({"ok": True, "message": "Den left out: unavailable."})["message"] == "Den left out: unavailable."
    # a library pick that played where it could: the rooms that did not follow, with its words
    assert outcome_of({"ok": True, "message": "Den was changed since.", "left": ["media_player.den", 4]}) == {
        "ok": True, "message": "Den was changed since.", "left": ["media_player.den"]}
    assert outcome_of(None) == {"ok": True}, "an answer with no body is not a failure"
    assert outcome_of(error=Boom("Mantel's music isn't on."))["message"] == "Mantel's music isn't on."
    assert outcome_of(error=RuntimeError("x" * 500))["message"] == "x" * 200
    assert outcome_of(error=RuntimeError()) == {"ok": False, "message": "The music request failed."}


def test_outcomes_are_kept_for_a_while_and_a_speaker_not_yours_is_not_named():
    now = [0.0]
    o = Outcomes(lambda: now[0])
    o.note("a1", {"ok": True, "leader": "media_player.kitchen"})
    o.note("b2", {"ok": False, "message": "No."})
    assert o.view({"media_player.kitchen"}) == {"a1": {"ok": True, "leader": "media_player.kitchen"}, "b2": {"ok": False, "message": "No."}}
    assert o.view(set()) == {"a1": {"ok": True}, "b2": {"ok": False, "message": "No."}}, "the leader only where it is visible"
    o.note("c3", {"ok": True, "leader": "media_player.kitchen", "left": ["media_player.den", "media_player.kitchen"]})
    assert o.view({"media_player.kitchen"})["c3"]["left"] == ["media_player.kitchen"], "nor a room left behind that is not yours"
    now[0] = KEEP_S + 1
    assert o.view(set()) == {}, "gone after its time"
    for i in range(KEEP_N + 5):
        o.note(f"r{i}", {"ok": True})
    got = o.view(set())
    assert len(got) == KEEP_N and "r0" not in got and f"r{KEEP_N + 4}" in got, "the oldest go first"
