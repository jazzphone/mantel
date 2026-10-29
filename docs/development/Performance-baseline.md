# Performance baseline

How fast and how heavy each screen is, measured on the house's real tablets before the performance work begins, so
every later change can be judged against numbers instead of a feeling.

## What is measured

Every screen's page (the dashboard, and Mantel Settings) reports a few numbers to Mantel over its own socket, with the
page-health frames that were already sent (`web/shim/page-health.js`, `hosts/server/mantel_server/page_health.py`).
Nothing is asked of the person using it.

| Column | What it is | When it is taken |
|---|---|---|
| Device | Platform (an iPad reports itself as a Mac; touch points tell them apart), device memory where the browser says (Chrome and Android do, Safari does not), CPU cores, screen size and pixel ratio | once, when the page loads |
| Download | Bytes the page had fetched by its first screen: the document and every file, by `transferSize`, or the encoded size when the file came out of the cache | once, at the first draw |
| Files | How many requests that was | once, at the first draw |
| First draw | Milliseconds from the start of the navigation to the first screen on the glass | once, at the first draw |
| FPS | Frames a second over 5 seconds of `requestAnimationFrame`, taken only while the page is visible, nobody has touched it for 5 seconds and the screensaver or black screen is not up | about 20 seconds after load, then hourly |
| Memory | The page's JS heap in MB, where the browser reports it (Chrome only) | every minute; read the newest |

Mantel keeps the last 24 hours of these in memory per screen, and each wall tablet's latest device, FPS, download and
first draw in the `tablet_health` table (migration 0026), so a restart does not lose them. They show in Mantel
Settings, About, Performance, for Owners and Admins. The same page shows the server's side: how long the minute policy
tick takes (last and longest over 24 hours), the hub's fan-out time, and the size of the settings history
(`settings_history`: versions and bytes).

## How to take it

1. Release the version that carries the measuring to the house, and let each tablet load once.
2. Leave the tablets alone for an hour, so each has taken at least one quiet FPS sample.
3. Open Mantel Settings, About, Performance, and copy one row per wall tablet into the table below. Note the date and
   the Mantel version above it.
4. Repeat after each performance change, in a new table beneath, with the change named.

Download and first draw depend on the cache. For a cold start, clear the tablet's cache (or restart its browser) before
the reload you read them from, and say which you took.

## Baseline

The tablets never reloaded onto 0.1.86 by themselves (each reloads at a quiet moment, and none came in the hours between
the two releases), so there is no "before" from the house itself. The before and after below are the fictional house
in the headless check (a cold Home, gzipped as the images ship it), then the house's own tablets after 0.1.87.

| Home, cold, fictional house | 0.1.86 | 0.1.87 |
|---|---|---|
| Files | 111 | 103 |
| Bytes over the wire | 3.13 MB | 2.16 MB |
| JavaScript over the wire | 1.58 MB | 0.62 MB |
| JavaScript unpacked | 4.89 MB | 1.87 MB |
| Second load: files asked for again | 97 | 12 (pictures only) |

## After 0.1.87, the house (2026-10-29)

From the App's log, each tablet's first load of the new build, right after the release (11:52, before the files were in
its cache). Device, FPS and memory are on About, Performance; the log does not carry them.

| Tablet | Download | Files | First draw |
|---|---|---|---|
| Kitchen | 1.35 MB | 77 | 2486 ms |
| Living Room | 1.37 MB | 83 | 2147 ms |
| Loft | 0.48 MB | 52 | 2920 ms |
| Master Bedroom | 0.43 MB | 51 | 2194 ms |
| Master Bathroom | 1.37 MB | 83 | 2073 ms |

Download counts a file out of the cache by its encoded size, so a warm load still shows bytes.

Server, 12:50 the same day: minute tick 18.65 ms, longest 271.65 ms in the first hour (the tablets reloading); settings
history 133 versions, 1.1 MB.

**Decisions (Phase 7):** the minute tick is well under the 50 ms the plan set, so it was not rewritten; the settings
history is 1.1 MB, so it is not trimmed (Restore and Layout History keep every version). Look again if the tick's
usual time passes 50 ms or the history passes about 50 MB.
