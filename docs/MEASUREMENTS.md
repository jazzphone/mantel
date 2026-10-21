# Measurements: upstream vs downstream (Phase 0, proof 1, first half)

Measured 2026-10-17 on the Mac against the live house (HA 2026.10.2, 4,495 entities with state, 6,218 in the entity registry), through `hosts/server/tools/measure.py`. Nothing was sent to HA except `auth`, `subscribe_entities` and the three registry list calls.

How to read the numbers
- **From HA** = every `event` frame of the one `subscribe_entities` stream: what a Lovelace browser tab receives today (HA's own frontend gets this same stream; the hub's copy is identical).
- **To client** = the `diff` frames one filtered client receives after its initial snapshot, counted on the client side.
- Sizes are JSON text payload bytes on both sides, before any WebSocket compression, so the comparison is like for like. Wire bytes will be smaller on both.
- The "screen" is two areas, Living Room + Kitchen: 499 entities that have state (registry members without state are reported as `missing`). That is about what one wall tablet's pages draw, and more than a single page would.
- Coalescing is the hub's per-entity minimum interval, trailing-edge (the first change goes out at once, later ones wait, the last value always arrives, A→B→A inside the interval sends nothing).

## Headline run: 5 minutes, 300 s

| stream | msgs/s | bytes/s | entity updates/s |
|---|---:|---:|---:|
| **From HA (state stream, everything)** | **12.84** | **2,317** | 12.84 |
| To client, 499 entities, no coalescing | 0.75 | 135 | 0.95 |
| To client, 499 entities, coalesced at 5 s | 0.60 | 115 | 0.79 |

- Downstream is **94.2 %** fewer messages and bytes than upstream with no coalescing, **95 %** with a 5 s interval.
- Upstream per-10 s window: 5.3 to 21.3 msgs/s (median 13.1); the state stream alone is a steady ~2 kB/s.
- **One-time cost:** HA's initial snapshot is 1,400,511 bytes for all 4,495 entities; this client's snapshot is 134,249 bytes (9.6 %) for 499 entities. Attributes dominate both.
- 52 distinct entities of the 499 changed in 5 minutes.

## Re-measure after the registry fix: 5 minutes, event-driven reload

The hub now reloads a registry only when HA sends `area_registry_updated`, `device_registry_updated` or `entity_registry_updated` (a burst is debounced 2 s into one reload of just the registries that changed). Same screen, same 5 s coalescing probe, 2026-10-17 18:41 to 18:46.

| stream | msgs/s | bytes/s | entity updates/s |
|---|---:|---:|---:|
| **From HA (everything, incl. all other frames)** | **11.27** | **1,986** | 11.27 |
| To client, 499 entities, no coalescing | 0.70 | 123 | 0.87 |
| To client, 499 entities, coalesced at 5 s | 0.52 | 100 | 0.70 |

- Registry replies in the window: **0 bytes/s** (was 14,883 bytes/s on average). Busiest 10 s window: 3.9 kB/s, against 448 kB/s before. Downstream is 93.8 % (raw) and 95.0 % (coalesced) below upstream, the same as before.
- The earlier numbers below are kept as they were measured.

## Other runs

| run | window | screen | HA state stream | client raw | client coalesced |
|---|---|---|---|---|---|
| 5 min, 1 s interval | 300 s | Living Room + Kitchen | 10.27 msgs/s | 0.71 msgs/s, 123 B/s | 0.70 msgs/s, 122 B/s |
| 10 chattiest entities, 1 s | 180 s | 10 explicit ids | 9.73 msgs/s, 1,734 B/s | 0.68 msgs/s, 135 B/s | 0.71 msgs/s, 136 B/s |
| 10 chattiest entities, 5 s | 120 s | 10 explicit ids | 9.37 msgs/s | 1.04 msgs/s, 176 B/s | 0.86 msgs/s, 154 B/s (-17 % msgs, -12 % entity updates) |

(The 1 s and 5 s rows are different runs at different moments, so compare raw and coalesced *within* a row, not across rows. The first row's byte total for HA is omitted: that run counted registry replies, see below.)

## What the numbers say

1. **The filter is the win; coalescing is a small extra on this house.** Selecting what a screen shows removes ~94 to 99 % of the traffic. Coalescing only helps when one entity changes faster than the interval, and the chattiest entities here (Bermuda watch distances, the living-room radar target, power sensors) change about once every 1 to 3 seconds, so a 1 s interval does almost nothing and a 5 s interval trims 12 to 17 %. Coalescing matters for the tablets only if a page shows such an entity; the larger payoff is simply not subscribing to them.
2. **HA sends one entity per frame.** 12.84 msgs/s carried 12.84 entity updates/s: no batching, so frame overhead is paid per entity change.
3. **The cost is CPU per tab, not bandwidth.** 2 to 2.3 kB/s is trivial on the wire. What a Lovelace tab pays is the ~11 to 13 state changes a second, each run through `core.js` against ~4,500 entities. A tablet on this hub would handle about 1 update/s.
4. **Registry polling was expensive; it is now event-driven.** Reloading the area, device and entity registries (4.4 MB per reload) every 5 minutes averaged 14.9 kB/s, six times the entire state stream, and caused the 448 kB/s spikes in some 10 s windows. Fixed: see the re-measure above (0 bytes/s of registry replies).

## Reproduce

```bash
.venv/bin/mantel-server &
.venv/bin/python hosts/server/tools/measure.py --minutes 5 --interval 5          # areas
.venv/bin/python hosts/server/tools/measure.py --minutes 3 --chatty 10 --interval 5   # coalescing at work
```
