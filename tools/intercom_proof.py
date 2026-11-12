#!/usr/bin/env python3
"""THE INTERCOM'S LIVE PROOF (docs/phase17/INTERCOM.md "Slice 0"): does Music Assistant play a GROWING announcement
live on an idle HomePod, and how far behind? Not part of CI; CI never runs it. It makes sound.

It uses Mantel's own pieces -- the Music Assistant client (connectors/ma.py) behind a gate that allows only
``players/cmd/play_announcement`` on the approved players with this run's own links, the spool, the one-time links and
the stream listener (intercom/) -- and a synthetic source: a soft 440 Hz tone, a 1 s beep every 5 s, no voice.

It refuses to run unless:

* every speaker is named on the command line and ``--owner-approved`` is given (decision 19);
* ``~/.config/mantel/intercom-never`` exists, isn't empty, and names none of them (the players it must never touch,
  kept outside the repository);
* it is inside 09:00-19:00 local and the whole run ends inside it;
* the volume is 25 or lower, each sound 60 s or shorter, and today's sounds (``~/.config/mantel/intercom-proof-count
  .json``) stay at 40 or fewer.

The runs (5 each, 2 minutes apart): ``live`` (P1-P3, P5: 20 s Live), ``long`` (P4: 45 s Live), ``message`` (P6: a 10 s
finite WAV), ``two`` (P7: 20 s Live to two speakers). The results go to ``--out`` as JSON and a summary is printed.
The group trap is never tested here.

    python3 tools/intercom_proof.py --ma-url http://<ma>:8095 --token-file <file> --advertise http://<this host>:8767 \\
        --speaker <MA player id> [--speaker <second, for "two">] --owner-approved --plan live,long,message,two
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import math
import statistics
import struct
import sys
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "hosts" / "server"))
sys.path.insert(0, str(ROOT))

from mantel_server.connectors.ma import MaClient  # noqa: E402
from mantel_server.intercom.links import Links  # noqa: E402
from mantel_server.intercom.listener import StreamListener  # noqa: E402
from mantel_server.intercom.spool import Spool  # noqa: E402
# the sound starts this long BEFORE Music Assistant says "playing" (measured by microphone, 2026-11-11; the first proof
# added an assumed 2 s for AirPlay instead: 7.45 s where the room heard it at 4.8)
from hk_core.intercom.config import SOUND_BEFORE_PLAYING_S  # noqa: E402

NEVER = Path("~/.config/mantel/intercom-never").expanduser()
COUNT = Path("~/.config/mantel/intercom-proof-count.json").expanduser()
HOURS = (9, 19)
MAX_VOLUME, MAX_SOUNDS, MAX_SECONDS = 25, 40, 60
ANNOUNCE = "players/cmd/play_announcement"
RATE, FRAME_S, LEVEL = 24000, 0.04, 0.12
PLANS = {"live": ("live", 20, 1), "long": ("live", 45, 1), "message": ("message", 10, 1), "two": ("live", 20, 2)}


def refuse(why: str) -> None:
    print(f"REFUSED: {why}", file=sys.stderr)
    sys.exit(2)


def never_list() -> set[str]:
    if not NEVER.exists():
        refuse(f"{NEVER} doesn't exist: write the players the proof must never touch first")
    ids = {ln.strip() for ln in NEVER.read_text().splitlines() if ln.strip() and not ln.lstrip().startswith("#")}
    if not ids:
        refuse(f"{NEVER} is empty")
    return ids


def sounds_today() -> int:
    try:
        return int(json.loads(COUNT.read_text()).get(dt.date.today().isoformat(), 0))
    except (OSError, ValueError):
        return 0


def count_sound(n: int) -> None:
    try:
        data = json.loads(COUNT.read_text())
    except (OSError, ValueError):
        data = {}
    day = dt.date.today().isoformat()
    data = {day: int(data.get(day, 0)) + n}
    COUNT.write_text(json.dumps(data))


def preflight(args: argparse.Namespace, plans: list[str]) -> None:
    if not args.owner_approved:
        refuse("--owner-approved is required: the owner approves each speaker (decision 19)")
    never = never_list()
    for sp in args.speaker:
        if sp in never:
            refuse(f"{sp} is on the never list")
    if args.volume > MAX_VOLUME or args.volume < 1:
        refuse(f"the volume is 1 to {MAX_VOLUME}")
    sounds = 0
    total_s = 0.0
    for p in plans:
        mode, secs, speakers = PLANS[p]
        if secs > MAX_SECONDS:
            refuse("a sound is at most 60 s")
        if speakers > len(args.speaker):
            refuse(f"plan {p} needs {speakers} speakers")
        sounds += args.runs * speakers
        total_s += args.runs * (secs + 15 + args.gap)
    if sounds_today() + sounds > MAX_SOUNDS:
        refuse(f"that is {sounds} sounds; {sounds_today()} were made today and the limit is {MAX_SOUNDS}")
    now = dt.datetime.now()
    end = now + dt.timedelta(seconds=total_s)
    if not (HOURS[0] <= now.hour < HOURS[1]) or end.hour >= HOURS[1] or end.date() != now.date():
        refuse(f"the run ({total_s / 60:.0f} min) must start and end between {HOURS[0]:02d}:00 and {HOURS[1]:02d}:00")
    print(f"preflight ok: {sounds} sounds over about {total_s / 60:.0f} min, volume {args.volume}")


class Gate:
    """The MA client's gate for the proof: play_announcement only, on the approved players, with this run's links."""

    def __init__(self, players: list[str], volume: int) -> None:
        self.players, self.volume, self.urls = set(players), volume, set()

    def allow(self, identity, command, args) -> bool:
        return (command == ANNOUNCE and set(args) <= {"player_id", "url", "pre_announce", "volume_level"}
                and args.get("player_id") in self.players and args.get("url") in self.urls
                and isinstance(args.get("volume_level"), int) and args["volume_level"] <= MAX_VOLUME)


def tone(start: int, n: int) -> bytes:
    """The source: 1 s of a soft 440 Hz beep every 5 s, silence between (16-bit mono)."""
    out = bytearray()
    for i in range(start, start + n):
        t = i / RATE
        v = LEVEL * math.sin(2 * math.pi * 440 * t) if (t % 5.0) < 1.0 else 0.0
        out += struct.pack("<h", int(v * 32767))
    return bytes(out)


class Watch:
    """Music Assistant's player events for the proof's speakers: when each was playing, its volume changes."""

    def __init__(self) -> None:
        self.events: list[tuple[float, str, str | None, object]] = []

    def __call__(self, ev: dict) -> None:
        data = ev.get("data") if isinstance(ev, dict) else None
        if not isinstance(data, dict):
            return
        state = data.get("playback_state") or data.get("state")
        self.events.append((time.monotonic(), str(ev.get("object_id")), state, data.get("volume_level")))

    def first_playing(self, pid: str, after: float) -> float | None:
        return next((t for t, p, s, _ in self.events if p == pid and t >= after and s == "playing"), None)

    def volumes(self, pid: str, after: float, before: float) -> list:
        vs = [v for t, p, _, v in self.events if p == pid and after <= t <= before]
        return [v for i, v in enumerate(vs) if i == 0 or vs[i - 1] != v]


async def snapshot(ma: MaClient, pid: str) -> dict:
    for p in await ma.players():
        if p.get("player_id") == pid:
            return {"state": p.get("playback_state") or p.get("state"), "volume": p.get("volume_level"),
                    "powered": p.get("powered"), "group_members": p.get("group_members"),
                    "synced_to": p.get("synced_to")}
    return {}


async def one_run(ma: MaClient, links: Links, gate: Gate, watch: Watch, base: str, plan: str, speakers: list[str],
                  volume: int) -> dict:
    mode, secs, n = PLANS[plan]
    pids = speakers[:n]
    before = {p: await snapshot(ma, p) for p in pids}
    for p, b in before.items():
        if b.get("state") in ("playing", "paused") or (b.get("group_members") or [p])[1:] or b.get("synced_to"):
            return {"plan": plan, "skipped": f"{p} isn't idle and alone: {b}"}
    spool = Spool(RATE, secs + 5)
    frame = int(RATE * FRAME_S)
    if mode == "message":
        spool.append(tone(0, int(RATE * secs)))
        spool.finish()
    token, link = links.mint(spool, mode=mode, finite=mode == "message", limit_s=secs)
    url = f"{base}/s/{token}.wav"
    gate.urls.add(url)
    rec: dict = {"plan": plan, "mode": mode, "seconds": secs, "speakers": pids}
    t0 = time.monotonic()

    async def feed() -> None:
        if mode == "message":
            return
        i, start = 0, time.monotonic()
        while i < RATE * secs:
            spool.append(tone(i, frame))
            i += frame
            await asyncio.sleep(max(0.0, start + i / RATE - time.monotonic()))
        spool.finish()

    async def call(pid: str) -> tuple[str, float, str | None]:
        try:
            await ma.command(object(), ANNOUNCE, timeout=secs + 90, player_id=pid, url=url, pre_announce=False,
                             volume_level=volume)
            return pid, time.monotonic(), None
        except Exception as exc:  # noqa: BLE001 -- recorded
            return pid, time.monotonic(), f"{type(exc).__name__}: {str(exc)[:200]}"

    feeder = asyncio.create_task(feed())
    calls = [asyncio.create_task(call(p)) for p in pids]
    try:
        await asyncio.wait_for(link.fetch_started.wait(), 20)
        rec["claim_s"] = round(time.monotonic() - t0, 3)
    except asyncio.TimeoutError:
        rec["claim_s"] = None
    await feeder
    t_end = time.monotonic()
    results = await asyncio.gather(*calls)
    rec["calls"] = [{"player": p, "returned_after_end_s": round(t - t_end, 2), "error": e} for p, t, e in results]
    rec["gets"], rec["peer"], rec["stalls"], rec["served"] = link.gets, link.peer, link.stalls, link.served
    rec["ended_early"] = link.ended_early
    plays = {p: watch.first_playing(p, t0) for p in pids}
    rec["playing_s"] = {p: (None if t is None else round(t - t0, 3)) for p, t in plays.items()}
    rec["start_lag_s"] = {p: (None if t is None else round(t - t0 - SOUND_BEFORE_PLAYING_S, 3)) for p, t in plays.items()}
    rec["volumes_during"] = {p: watch.volumes(p, t0, t_end) for p in pids}
    links.kill(link)
    await asyncio.sleep(6)
    after = {p: await snapshot(ma, p) for p in pids}
    rec["restored"] = {p: {"before": before[p], "after": after[p],
                           "ok": after[p].get("state") not in ("playing",) and after[p].get("volume") == before[p].get(
                               "volume") and after[p].get("powered") == before[p].get("powered")} for p in pids}
    count_sound(len(pids))
    return rec


async def ma_log_lines(args: argparse.Namespace, since_s: float) -> list[str]:
    """Music Assistant's own log for the run's window, if this version answers ``logging/get`` (a read)."""
    import aiohttp
    token = Path(args.token_file).expanduser().read_text().strip()
    try:
        async with aiohttp.ClientSession() as s, s.ws_connect(args.ma_url.rstrip("/") + "/ws") as ws:
            await ws.receive_json()
            await ws.send_str(json.dumps({"message_id": "1", "command": "auth", "args": {"token": token}}))
            await ws.receive_json()
            await ws.send_str(json.dumps({"message_id": "2", "command": "logging/get", "args": {}}))
            got = await asyncio.wait_for(ws.receive_json(), 15)
            text = got.get("result")
            if not isinstance(text, (str, list)):
                return [f"(logging/get answered {str(got)[:200]})"]
            lines = text.splitlines() if isinstance(text, str) else [str(x) for x in text]
            keep = [ln for ln in lines if any(w in ln.lower() for w in ("ffmpeg", "airplay", "announce", "raop"))
                    and any(w in ln.lower() for w in ("error", "warn", "fail", "underrun", "late"))]
            return keep[-200:]
    except Exception as exc:  # noqa: BLE001
        return [f"(no log: {type(exc).__name__}: {str(exc)[:120]})"]


def summary(results: list[dict]) -> dict:
    out: dict = {}
    for plan in PLANS:
        rs = [r for r in results if r.get("plan") == plan and "skipped" not in r]
        if not rs:
            continue
        lags = [v for r in rs for v in r["start_lag_s"].values() if v is not None]
        s = {"runs": len(rs), "claims_s": [r["claim_s"] for r in rs], "gets": [r["gets"] for r in rs],
             "stalls": [r["stalls"] for r in rs], "errors": [c["error"] for r in rs for c in r["calls"] if c["error"]],
             "returned_after_end_s": [c["returned_after_end_s"] for r in rs for c in r["calls"]],
             "restored": all(v["ok"] for r in rs for v in r["restored"].values())}
        if lags:
            s.update(lag_median_s=round(statistics.median(lags), 2), lag_worst_s=round(max(lags), 2))
        if plan == "two":
            s["spread_s"] = [round(abs(a - b), 3) for r in rs
                             for a, b in [tuple(v for v in r["playing_s"].values() if v is not None)[:2]] if True] \
                if all(len([v for v in r["playing_s"].values() if v is not None]) == 2 for r in rs) else None
        out[plan] = s
    return out


async def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--ma-url", required=True)
    p.add_argument("--token-file", required=True)
    p.add_argument("--advertise", required=True, help="the base URL Music Assistant fetches from")
    p.add_argument("--bind", default="0.0.0.0")
    p.add_argument("--port", type=int, default=8767)
    p.add_argument("--speaker", action="append", default=[], help="a Music Assistant player id the owner approved")
    p.add_argument("--owner-approved", action="store_true")
    p.add_argument("--volume", type=int, default=20)
    p.add_argument("--runs", type=int, default=5)
    p.add_argument("--gap", type=float, default=120.0)
    p.add_argument("--plan", default="live,long,message,two")
    p.add_argument("--out", default="intercom-proof.json")
    args = p.parse_args()
    plans = [x for x in args.plan.split(",") if x]
    if not plans or any(x not in PLANS for x in plans):
        refuse(f"--plan is a list of {list(PLANS)}")
    if not args.speaker:
        refuse("name the speaker(s) with --speaker")
    preflight(args, plans)
    from urllib.parse import urlsplit
    ma_host = urlsplit(args.ma_url).hostname
    gate = Gate(args.speaker, args.volume)
    ma = MaClient(args.ma_url, Path(args.token_file).expanduser(), gate)
    watch = Watch()
    ma.subscribe(watch, events=["player_updated"])
    ma.start()
    await asyncio.wait_for(ma.connected.wait(), 20)
    print("Music Assistant", (ma.server_info or {}).get("server_version"))
    links = Links(SimpleNamespace(lan_networks=()), expected_peer=lambda: ma_host)
    listener = StreamListener(links, args.bind, args.port)
    await listener.start()
    results: list[dict] = []
    t_start = time.time()
    try:
        for plan in plans:
            for i in range(args.runs):
                if dt.datetime.now().hour >= HOURS[1]:
                    print("stopping: 19:00")
                    raise KeyboardInterrupt
                r = await one_run(ma, links, gate, watch, args.advertise.rstrip("/"), plan, args.speaker, args.volume)
                r["run"] = i + 1
                results.append(r)
                print(json.dumps({k: r.get(k) for k in ("plan", "run", "claim_s", "gets", "stalls", "start_lag_s",
                                                        "calls", "skipped")}), flush=True)
                Path(args.out).write_text(json.dumps({"results": results}, indent=1))
                if not (plan == plans[-1] and i == args.runs - 1):
                    await asyncio.sleep(args.gap)
    except KeyboardInterrupt:
        pass
    finally:
        log_lines = await ma_log_lines(args, time.time() - t_start)
        await listener.stop()
        await ma.close()
        out = {"ma_version": (ma.server_info or {}).get("server_version"), "results": results,
               "summary": summary(results), "ma_log": log_lines}
        Path(args.out).write_text(json.dumps(out, indent=1))
        print(json.dumps(out["summary"], indent=1))


if __name__ == "__main__":
    asyncio.run(main())
