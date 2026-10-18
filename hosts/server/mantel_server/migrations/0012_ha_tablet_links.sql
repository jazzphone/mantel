-- 0012_ha_tablet_links: an HA user that IS a wall tablet (HA App mode, decision 21; docs/phase3/HA-APP.md
-- "Wall tablets through the App"). Each wall tablet in the house is its own HA user, signed in by
-- trusted_networks in Kiosk Satellite. An Owner links such an HA user to a Mantel device (wall_tablet role,
-- its room) instead of a person: a request through Ingress from that HA user is then the device, with no
-- user, on door 'ha'. ingress.py owns this table.
--
-- An HA user is linked to a person (ha_links) OR to a device (here), never both (ingress.link_tablet
-- removes the other in the same transaction). One HA user per device. Deleting the device removes the link.
-- No BEGIN/COMMIT: the runner owns the transaction.
CREATE TABLE IF NOT EXISTS ha_tablet_links (
    ha_user_id  TEXT PRIMARY KEY,
    device_id   TEXT NOT NULL UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
    ha_name     TEXT,                    -- HA's name for the user when linked (HK's Tablet User matches it)
    own_device  INTEGER NOT NULL DEFAULT 0,  -- 1: the device was made for this link (revoked on unlink)
    created     REAL NOT NULL,
    created_by  TEXT                     -- the Owner's Mantel user id
);
