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

Mantel version: _to be filled_. Taken on: _to be filled_. Cache: _cold or warm_.

| Tablet | Device | Download | Files | First draw | FPS | Memory |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |

Server, same day: minute tick last _ ms, longest _ ms; settings history _ versions, _ MB.
