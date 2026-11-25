"""Phase 35 steps 2-3: paired AirPlay screens (kept sealed, found by the announcer, paired with the screen's code) and
a Live TV channel played on one, through the page's socket, on the Live TV rig (test_live_tv.py) with a fake screen
(airplay_fakes.py). Who may do what: Owner/Admin pair and remove, anyone with Live TV and the channel's camera plays."""
from __future__ import annotations

import asyncio
import json
import re

from airplay_fakes import FakeScreen
from test_live_tv import rig  # noqa: F401 -- the fixture
from mantel_server.network import announce


async def _paired(r, ws, screen: FakeScreen) -> str:
    began = (await r.ask(ws, 11, {"type": "hk_tv/screen_pair", "step": "begin", "host": "127.0.0.1",
                                  "port": screen.port, "name": "Den HomeView"}))["result"]
    done = (await r.ask(ws, 12, {"type": "hk_tv/screen_pair", "step": "finish", "pairing": began["pairing"],
                                 "code": screen.code}))["result"]
    return done["screen"]["id"]


async def test_an_owner_pairs_a_screen_kept_sealed_and_nobody_else_may(rig):  # noqa: F811
    r = await rig()
    screen = await FakeScreen().start()
    try:
        cfg = r.app["cfg"]
        (cfg.data_dir / announce.FOUND_FILE).write_text(json.dumps({"screens": [
            {"name": "Den HomeView", "host": "127.0.0.1", "port": screen.port, "model": "HomeAccessory17,1",
             "psi": screen.psi}, {"name": "bad", "host": "a b", "port": 1}]}))
        ws = await r.socket("owner1", "owner")
        got = (await r.ask(ws, 1, {"type": "hk_tv/screens/manage"}))["result"]
        assert got["screens"] == [] and [f["name"] for f in got["found"]] == ["Den HomeView"]   # a bad address dropped
        sid = await _paired(r, ws, screen)
        assert screen.pin_shown_for == ["Mantel"]
        got = (await r.ask(ws, 2, {"type": "hk_tv/screens/manage"}))["result"]
        assert [s["id"] for s in got["screens"]] == [sid] and got["found"][0]["paired"] is True
        assert "creds" not in json.dumps(got)                                   # the key never leaves the server
        sealed = (cfg.connections_dir / "airplay-screens.connection").read_bytes()
        assert screen.psi.encode() not in sealed and b"creds" not in sealed     # sealed at rest
        assert r.app["airplay_screens"].credentials(sid) is not None
        # a wrong code
        began = (await r.ask(ws, 3, {"type": "hk_tv/screen_pair", "step": "begin", "host": "127.0.0.1",
                                     "port": screen.port}))["result"]
        wrong = (await r.ask(ws, 4, {"type": "hk_tv/screen_pair", "step": "finish", "pairing": began["pairing"],
                                     "code": "0000"}))["result"]
        assert wrong["error"] == "wrong_code"
        # renamed, then removed; each audited
        await r.ask(ws, 5, {"type": "hk_tv/screen_rename", "screen": sid, "name": "Den"})
        assert r.app["airplay_screens"].listed()[0]["name"] == "Den"
        actions = [row["action"] for row in r.app["audit"].rows()]
        assert "live_tv.airplay.screen_paired" in actions and "live_tv.airplay.screen_renamed" in actions
        # an adult and a child may not manage screens
        for user, role in (("adult1", "adult"), ("kid1", "child")):
            other = await r.socket(user, role)
            assert "error" in await r.ask(other, 6, {"type": "hk_tv/screens/manage"})
            assert "error" in await r.ask(other, 7, {"type": "hk_tv/screen_remove", "screen": sid})
            await other.close()
        assert (await r.ask(ws, 8, {"type": "hk_tv/screen_remove", "screen": sid}))["result"] == {"removed": sid}
        assert r.app["airplay_screens"].listed() == []
        await ws.close()
    finally:
        await screen.close()


async def test_a_channel_plays_on_a_screen_by_its_key_and_stops(rig, monkeypatch):  # noqa: F811
    r = await rig()
    screen = await FakeScreen().start()
    try:
        sender = r.app["airplay_sender"]
        monkeypatch.setattr(sender, "_base", lambda: "https://house.example")
        ws = await r.socket("owner1", "owner")
        sid = await _paired(r, ws, screen)
        got = (await r.ask(ws, 21, {"type": "hk_tv/play_on", "channel": "4.1", "screen": sid}))["result"]
        assert got == {"playing": {"channel": "4.1", "name": "NBC"}, "screen": sid}
        item = next(d["inner"]["item"] for w, h, d in screen.requests
                    if isinstance(d, dict) and "inner" in d and d["inner"]["type"] == "insertPlayQueueItem")
        m = re.fullmatch(r"https://house\.example/go2rtc/(key/[A-Za-z0-9_-]+/api/stream\.m3u8\?src=mantel_tv_4_1_hls&mp4)",
                         item["Content-Location"])
        assert m, item["Content-Location"]
        # the address is the screen's to fetch signed out, as the person who played it
        r.env.m.forget_cookies()
        assert (await r.env.m.client.get("/go2rtc/" + m.group(1))).status == 200
        listed = (await r.ask(ws, 22, {"type": "hk_tv/screens"}))["result"]["screens"]
        assert listed == [{"id": sid, "name": "Den HomeView", "playing": {"channel": "4.1", "name": "NBC", "by": listed[0]["playing"]["by"]}}]
        assert "live_tv.airplay.play" in [row["action"] for row in r.app["audit"].rows()]
        # a child may not play (no Live TV)
        kid = await r.socket("kid1", "child")
        refused = await r.ask(kid, 23, {"type": "hk_tv/play_on", "channel": "4.1", "screen": sid})
        assert refused["result"]["error"] == "forbidden"
        assert [row["action"] for row in r.app["audit"].rows()].count("live_tv.airplay.play") == 1   # not the refused one
        await kid.close()
        # stopped: rate 0 and a teardown; nothing plays
        await r.env.login("owner1", "owner")
        got = (await r.ask(ws, 24, {"type": "hk_tv/play_off", "screen": sid}))["result"]
        assert got == {"playing": None, "screen": sid} and sender.playing(sid) is None
        assert any(w.startswith("TEARDOWN") for w, h, d in screen.requests)
        await ws.close()
    finally:
        await screen.close()


async def test_a_screen_that_ends_the_show_is_no_longer_playing(rig, monkeypatch):  # noqa: F811
    r = await rig()
    screen = await FakeScreen().start()
    try:
        sender = r.app["airplay_sender"]
        monkeypatch.setattr(sender, "_base", lambda: "https://house.example")
        ws = await r.socket("owner1", "owner")
        sid = await _paired(r, ws, screen)
        await r.ask(ws, 31, {"type": "hk_tv/play_on", "channel": "4.1", "screen": sid})
        screen.stop()
        for _ in range(100):
            if sender.playing(sid) is None:
                break
            await asyncio.sleep(0.02)
        assert sender.playing(sid) is None
        # a screen that forgot Mantel is said so, not a silent failure
        screen.refuse_verify = True
        got = (await r.ask(ws, 32, {"type": "hk_tv/play_on", "channel": "4.1", "screen": sid}))["result"]
        assert got["error"] == "unpaired"
        await ws.close()
    finally:
        await screen.close()


async def test_the_apps_play_needs_the_apps_token(rig):  # noqa: F811
    r = await rig()
    m = r.env.m
    m.forget_cookies()
    resp = await m.client.post("/api/app/tv/play", json={"channel": "4.1", "screen": "s" + "0" * 12})
    assert resp.status == 401


def test_the_announcer_lists_only_receivers_that_play_video():
    tv = announce.airplay_screen("Den HomeView._airplay._tcp.local.", {b"features": b"0x4A7FDE55,0x3C177BDE",
                                 b"model": b"HomeAccessory17,1", b"psi": b"PSI-1"}, ["fe80::1", "192.0.2.7"], 7000)
    assert tv == {"name": "Den HomeView", "host": "192.0.2.7", "port": 7000, "model": "HomeAccessory17,1", "psi": "PSI-1"}
    speaker = announce.airplay_screen("Den HomePod._airplay._tcp.local.", {b"features": b"0x4A7FCA00,0x3C356BD0"},
                                      ["192.0.2.8"], 7000)
    assert speaker is None


async def test_a_paused_screen_leaves_airplay_once_its_stream_goes_unwatched(rig, monkeypatch):  # noqa: F811
    """Paused on the screen, nobody fetches the stream; Live TV lets it go after its lease and the show ends with it
    (2026-11-24, the owner: "there doesn't look like there is a way to stop it")."""
    r = await rig()
    screen = await FakeScreen().start()
    try:
        sender = r.app["airplay_sender"]
        monkeypatch.setattr(sender, "_base", lambda: "https://house.example")
        ws = await r.socket("owner1", "owner")
        sid = await _paired(r, ws, screen)
        await r.ask(ws, 41, {"type": "hk_tv/play_on", "channel": "4.1", "screen": sid})
        assert sender.playing(sid) == {"channel": "4.1", "name": "NBC", "by": sender.playing(sid)["by"]}  # no stream name
        await r.tv._drop("mantel_tv_4_1_hls")           # what the lease's end does
        for _ in range(100):
            if sender.playing(sid) is None and any(w.startswith("TEARDOWN") for w, h, d in screen.requests):
                break
            await asyncio.sleep(0.02)
        assert sender.playing(sid) is None and any(w.startswith("TEARDOWN") for w, h, d in screen.requests)
        await ws.close()
    finally:
        await screen.close()


async def test_a_show_ends_by_itself_after_the_safety_net(rig, monkeypatch):  # noqa: F811
    """Whatever the screen does, a show ends MAX_SHOW_S after it started (2026-11-25, the owner: "close a stream after
    2 hours or so as well as a safety net"); playing it again starts the time again."""
    r = await rig()
    screen = await FakeScreen().start()
    try:
        sender = r.app["airplay_sender"]
        monkeypatch.setattr(sender, "_base", lambda: "https://house.example")
        from mantel_server.cameras.airplay_out import routes as R
        assert sender.max_show == R.MAX_SHOW_S == 7200
        ws = await r.socket("owner1", "owner")
        sid = await _paired(r, ws, screen)
        sender.max_show = 0.2
        await r.ask(ws, 51, {"type": "hk_tv/play_on", "channel": "4.1", "screen": sid})
        assert sender.playing(sid) is not None
        for _ in range(100):
            if sender.playing(sid) is None and any(w.startswith("TEARDOWN") for w, h, d in screen.requests):
                break
            await asyncio.sleep(0.02)
        assert sender.playing(sid) is None and not sender._limits
        await ws.close()
    finally:
        await screen.close()
