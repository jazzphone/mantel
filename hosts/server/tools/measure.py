"""Measure upstream (everything HA sends the hub) vs downstream (what filtered clients receive).

Run against a live `mantel-server`. Opens one client per "profile" on the same screen's worth of
entities (areas), then samples for N minutes. Upstream numbers come from the hub's counters
(/api/stats); downstream numbers are counted here, on the client side, after the initial snapshot.
Sizes are JSON text payload bytes on both sides (before any transport compression).

    python hosts/server/tools/measure.py --minutes 5 --areas living_room kitchen
"""
from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import time

import aiohttp

BASE = "http://127.0.0.1:8765"


class Probe:
    def __init__(self, name: str, areas: list[str], entities: list[str], min_interval: float) -> None:
        self.name, self.areas, self.entities, self.min_interval = name, areas, entities, min_interval
        self.snapshot_bytes = 0
        self.snapshot_entities = 0
        self.msgs = 0
        self.bytes = 0
        self.changed_entities: set[str] = set()
        self.sent_updates = 0  # entity-level updates delivered

    async def run(self, session: aiohttp.ClientSession) -> None:
        async with session.ws_connect(BASE.replace("http", "ws") + "/ws", max_msg_size=0) as ws:
            await ws.send_json({"type": "subscribe", "areas": self.areas, "entity_ids": self.entities, "min_interval": self.min_interval})
            first = True
            async for m in ws:
                if m.type != aiohttp.WSMsgType.TEXT:
                    break
                body = json.loads(m.data)
                if first and body["type"] == "snapshot":
                    first = False
                    self.snapshot_bytes = len(m.data)
                    self.snapshot_entities = len(body["entities"])
                    continue
                if body["type"] == "diff":
                    self.msgs += 1
                    self.bytes += len(m.data)
                    for key in ("changes", "added"):
                        self.changed_entities |= set(body.get(key, {}))
                        self.sent_updates += len(body.get(key, {}))


async def stats(session: aiohttp.ClientSession) -> dict:
    async with session.get(BASE + "/api/stats") as r:
        return await r.json()


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=5)
    ap.add_argument("--areas", nargs="*", default=["living_room", "kitchen"])
    ap.add_argument("--chatty", type=int, default=0,
                    help="instead of areas, subscribe to the N chattiest entities seen so far (shows coalescing at work)")
    ap.add_argument("--interval", type=float, default=1.0, help="coalescing interval for the second probe")
    ap.add_argument("--sample", type=float, default=10.0, help="seconds per sample window")
    args = ap.parse_args()

    async with aiohttp.ClientSession() as session:
        entities: list[str] = []
        if args.chatty:
            top = (await stats(session))["upstream"]["top_entities"]
            entities = [e for e, _ in top[: args.chatty]]
            args.areas = []
        probes = [Probe("raw (no coalescing)", args.areas, entities, 0.0),
                  Probe(f"coalesced ({args.interval:g} s)", args.areas, entities, args.interval)]
        tasks = [asyncio.create_task(p.run(session)) for p in probes]
        await asyncio.sleep(2)  # let the snapshots land, then start the clock
        s0 = await stats(session)
        base = [(p.msgs, p.bytes) for p in probes]
        t0 = time.monotonic()
        up_rates: list[tuple[float, float]] = []
        prev = (s0["upstream"]["msgs"], s0["upstream"]["bytes"])
        end = t0 + args.minutes * 60
        while time.monotonic() < end:
            await asyncio.sleep(args.sample)
            cur = await stats(session)
            now = (cur["upstream"]["msgs"], cur["upstream"]["bytes"])
            up_rates.append(((now[0] - prev[0]) / args.sample, (now[1] - prev[1]) / args.sample))
            prev = now
        elapsed = time.monotonic() - t0
        s1 = await stats(session)
        for t in tasks:
            t.cancel()

    def delta(key: str, kind: str | None = None) -> float:
        a, b = (s0["upstream"], s1["upstream"]) if kind is None else (s0["upstream"]["by_type"].get(kind, {"msgs": 0, "bytes": 0}),
                                                                      s1["upstream"]["by_type"].get(kind, {"msgs": 0, "bytes": 0}))
        return (b[key] - a[key]) / elapsed

    # "From HA" = the state stream (event frames). Registry list replies (hub housekeeping every 5 min) are shown apart.
    um, ub = delta("msgs", "event"), delta("bytes", "event")
    all_m, all_b = delta("msgs"), delta("bytes")
    print(f"all frames from HA incl. registry refresh: {all_m:.2f} msgs/s, {all_b:,.0f} bytes/s "
          f"(registry replies: {all_b - ub:,.0f} bytes/s averaged over the window)")
    print(f"window: {elapsed:.0f} s · HA entities: {s1['ha_entities']} · screen: {', '.join(args.areas) or str(len(entities)) + ' chattiest entities'}")
    print(f"initial upstream snapshot: {s1['upstream']['initial_snapshot_bytes']:,} bytes")
    eu = (s1["upstream"]["entity_updates"] - s0["upstream"]["entity_updates"]) / elapsed
    print(f"upstream entity updates/s: {eu:.2f}")
    print(f"upstream types (whole run): " + ", ".join(f"{k}={v['msgs']}" for k, v in s1["upstream"]["by_type"].items()))
    print()
    print("| stream | msgs/s | bytes/s | entity updates/s | distinct entities changed | snapshot (once) |")
    print("|---|---:|---:|---:|---:|---:|")
    print(f"| **From HA (everything)** | {um:.2f} | {ub:,.0f} | {eu:.2f} | | {s1['upstream']['initial_snapshot_bytes']:,} B, {s1['ha_entities']} entities |")
    for p, (m0, b0) in zip(probes, base):
        print(f"| To client: {p.name}, {p.snapshot_entities} entities | {(p.msgs - m0) / elapsed:.2f} | "
              f"{(p.bytes - b0) / elapsed:,.0f} | {p.sent_updates / elapsed:.2f} | {len(p.changed_entities)} | "
              f"{p.snapshot_bytes:,} B |")
    print()
    for p, (m0, b0) in zip(probes, base):
        print(f"{p.name}: {100 * (1 - ((p.bytes - b0) / elapsed) / ub):.1f}% fewer bytes/s than upstream, "
              f"{100 * (1 - ((p.msgs - m0) / elapsed) / um):.1f}% fewer msgs/s")
    ms = [m for m, _ in up_rates]
    bs = [b for _, b in up_rates]
    print("frames over 20 kB (bytes, entities): " + (str(s1["upstream"]["big_frames"]) or "none"))
    print("chattiest entities (since server start): " + ", ".join(f"{e}={n}" for e, n in s1["upstream"]["top_entities"][:10]))
    print(f"upstream per-{args.sample:g}s windows: msgs/s min {min(ms):.1f} median {statistics.median(ms):.1f} max {max(ms):.1f}; "
          f"bytes/s min {min(bs):,.0f} median {statistics.median(bs):,.0f} max {max(bs):,.0f}")


asyncio.run(main())
