-- A person's PIN (PLAN §5 "Wall Tablet: sensitive actions require a person's PIN at the tablet"; §7
-- step-up "a per-user PIN ... or a passkey"). pins.py owns these tables.
--
-- Numbered 0006 on purpose: 0005 is taken by the service-accounts slice (0005_service_accounts.sql,
-- another worktree). The runner applies files in number order and records each number, so the two
-- are independent whichever lands first.
--
-- The PIN is stored only as an Argon2id hash (PHC string) and is never logged or audited.
CREATE TABLE user_pins (
    user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    pin_hash     TEXT NOT NULL,
    created      REAL NOT NULL,
    updated      REAL NOT NULL,
    last_used    REAL,
    failed       INTEGER NOT NULL DEFAULT 0,        -- consecutive wrong PINs on the person's own session
    locked_until REAL
);

-- Wrong PINs are counted where they are typed: a wall tablet's PIN pad names nobody until a PIN
-- matches, so its failures belong to the tablet ('device:<id>'), not to a person.
CREATE TABLE pin_lockouts (
    place        TEXT PRIMARY KEY,
    failed       INTEGER NOT NULL DEFAULT 0,
    locked_until REAL,
    updated      REAL NOT NULL
);
