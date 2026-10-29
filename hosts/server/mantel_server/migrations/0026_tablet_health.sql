-- Each wall tablet's latest page-health summary (page_health.py, 2026-10-29): what device it is, its frame rate, its
-- startup download and its time to first draw, so the Performance page and the recommendations still have them after
-- Mantel restarts (the 24-hour ring is memory only).
--
--   device_id  devices.id (no foreign key: the row is a cache, and a tablet removed leaves nothing that matters)
--   updated    when the row was last written (rare: when a value changed, at most every 10 minutes per tablet)
--   json       {"name", "device": {"platform", "memory_gb", "cores", "screen_w", "screen_h", "dpr"}, "fps",
--              "first_draw_ms", "download_bytes", "download_files"}; numbers and one platform word
CREATE TABLE tablet_health (
    device_id TEXT PRIMARY KEY,
    updated   REAL NOT NULL,
    json      TEXT NOT NULL
);
