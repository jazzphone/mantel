"""A timer ringing on the speakers (docs/phase21/TIMER-SLIDE.md), the Intercom's way, against the fake Music Assistant that fetches
its link from Mantel's real stream listener as the real one does. No real speaker is involved."""
import asyncio
import wave
from io import BytesIO

import intercom_fakes as IF
from hk_core import timers as R
from intercom_fakes import ANNOUNCE, KITCHEN
from mantel_server.settings_store import Actor as SettingsActor
from mantel_server.timers import Row

ic = IF.fixture(commands=True)


def settings(env, **features):
    """As Settings saves them."""
    env.m.app["settings"].store.write([("house", "settings", {"features": features})], actor=SettingsActor(label="test"))


def ringing(ic, area="kitchen"):
    host = ic.m.app["timers"]
    host.rows["timer.quick_1"] = row = Row(
        "timer.quick_1", "Pasta", room=area, created=1.0, finishes_at=ic.m.app["clock"]() - 1, ring_until=ic.m.app["clock"]() + 60)
    host.store.save(row)
    return host, row


async def test_it_plays_in_its_room_at_its_volume_with_no_chime_and_every_row(ic):
    settings(ic, timer_volume=35)
    host, row = ringing(ic)
    await host._speak(row)
    (a,) = ic.ma.announcements
    assert a["volume_level"] == 35 and a["pre_announce"] is False
    assert host.spoken == [{"room": KITCHEN, "ok": True, "error": None}]
    rows = [r for r in ic.audit() if r["action"] == "timer.ring"]
    assert len(rows) == 1 and rows[0]["result"].startswith("ok") and rows[0]["actor"] == "mantel"


async def test_the_clip_is_a_real_wav(ic):
    host, row = ringing(ic)
    await host._speak(row)
    with wave.open(BytesIO(ic.ma.fetches[-1]["body"])) as w:
        assert w.getframerate() == R.CLIP_RATE and w.getnframes() > R.CLIP_RATE * 4
    assert len(ic.host.links) == 0                 # its one-time link is gone


async def test_never_above_the_houses_highest_volume(ic):
    settings(ic, timer_volume=95)
    host, row = ringing(ic)
    await host._speak(row)
    assert ic.ma.announcements[-1]["volume_level"] == 70


async def test_the_intercom_can_be_off_and_its_rooms_too(ic):
    await ic.configure(enabled=False, rooms={})
    host, row = ringing(ic)
    assert ic.host.listener is None or not ic.host.listener.running
    await host._speak(row)
    assert len(ic.ma.announcements) == 1 and host.spoken[0]["ok"] is True
    # the listener runs for the ring, and goes when it is over
    assert ic.host.listener is not None and ic.host.listener.running
    host._listener(False)
    await asyncio.gather(*list(host.tasks))
    assert ic.host.listener is None


async def test_nothing_plays_with_the_speaker_off_in_another_room_or_with_no_address(ic):
    host, row = ringing(ic, area="office")
    await host._speak(row)
    assert ic.ma.announcements == []
    host, row = ringing(ic)
    settings(ic, timer_speaker=False)
    await host._speak(row)
    assert ic.ma.announcements == []
    settings(ic, timer_speaker=True)
    ic.edit(stream_base=None)
    await host._speak(row)
    assert ic.ma.announcements == []


async def test_also_play_in_and_the_whole_house(ic):
    settings(ic, timer_also=["all"])
    host, row = ringing(ic, area="office")
    await host._speak(row)
    assert len(ic.ma.announcements) >= 2


async def test_a_speaker_that_fails_is_only_a_note(ic, monkeypatch):
    host, row = ringing(ic)
    real = ic.m.app["ma"].command

    async def fail(identity, command, **args):
        if command == ANNOUNCE:
            raise RuntimeError("no such speaker")
        return await real(identity, command, **args)
    monkeypatch.setattr(ic.m.app["ma"], "command", fail)
    await host._speak(row)
    assert host.spoken[0]["ok"] is False and [r for r in ic.audit() if r["action"] == "timer.ring"][0]["result"].startswith("error")


async def test_it_plays_again_while_it_rings_and_stops_when_it_is_stopped(ic, monkeypatch):
    from mantel_server import timers as T
    monkeypatch.setattr(T, "SPEAK_EVERY", 0.05)
    host, row = ringing(ic)
    host._ensure_ringer(row.entity_id)
    assert await IF.until(lambda: len(ic.ma.announcements) >= 2)
    host._quiet(row.entity_id)
    host._over(row)
    await asyncio.sleep(0.1)
    seen = len(ic.ma.announcements)
    await asyncio.sleep(0.15)
    assert len(ic.ma.announcements) == seen and "timer.quick_1" not in host.rows


async def test_the_intercoms_turn_comes_first(ic):
    host, row = ringing(ic)
    ic.host.testing = "Send Test"
    await host._speak(row)
    assert ic.ma.announcements == []
    ic.host.testing = None
