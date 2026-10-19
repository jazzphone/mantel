-- The Mantel push relay's state (Cloudflare D1). docs/phase10/APPLE-APPS.md §13.
--   handles: one per phone per house. Only hashes of handles are kept; the device token is Apple's address for the phone.
--   house_key: the house's identity key (x963, base64url) the handle was registered for; fp its SHA-256 SPKI fingerprint.
CREATE TABLE IF NOT EXISTS handles (
  hash      TEXT PRIMARY KEY,
  dedupe    TEXT NOT NULL UNIQUE,          -- sha256(token | house fp): re-registering replaces the old handle
  token     TEXT NOT NULL,
  env       TEXT NOT NULL CHECK (env IN ('sandbox', 'production')),
  house_fp  TEXT NOT NULL,
  house_key TEXT NOT NULL,
  created   INTEGER NOT NULL,
  last_sent INTEGER
);
CREATE INDEX IF NOT EXISTS handles_house ON handles(house_fp);
-- each signed request's nonce once, for ten minutes
CREATE TABLE IF NOT EXISTS nonces (
  nonce   TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);
-- requests per house (and per handle) per minute
CREATE TABLE IF NOT EXISTS counts (
  bucket TEXT PRIMARY KEY,
  n      INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
