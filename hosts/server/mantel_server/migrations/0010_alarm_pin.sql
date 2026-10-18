-- HK's Alarm PIN in Mantel (alarm_pin.py; docs/phase3/PINS-AUDIT.md "The alarm keypad",
-- docs/phase3/GATEWAY.md "The alarm"). One row per alarm keypad panel Mantel guards.
--
--   entity        the alarm panel HK's keypad names (security.alarm, an #alarm pop-up): HA's Alarm PIN
--                 panel, or an alarm itself
--   forward_to    the panel Mantel's command goes to (HA's Alarm PIN panel's `protects`: the alarm
--                 behind it, which takes no code of its own); the same as `entity` by default
--   pin_hash      the house's own Alarm PIN for this keypad, an Argon2id hash only (NULL: none, people's
--                 own PINs only). Never logged, never in the audit, never sent to a page.
--   arm_required  arming needs the code too (HA's "Require the PIN to arm"); disarming always does
--   tablets       wall tablets may use this keypad (control + control.sensitive on these two panels,
--                 for keypad commands only; an Owner's deny grant still wins)
--   ha_code       the alarm's OWN Home Assistant code, for a panel that asks for one (its code_format):
--                 AES-GCM sealed with Mantel's secret key (atrest.SecretBox), never sent to a page
--
-- Wrong codes are counted in pin_lockouts (0006), where they are typed.
CREATE TABLE alarm_pins (
    entity       TEXT PRIMARY KEY,
    forward_to   TEXT NOT NULL,
    pin_hash     TEXT,
    arm_required INTEGER NOT NULL DEFAULT 1,
    tablets      INTEGER NOT NULL DEFAULT 1,
    ha_code      BLOB,
    source       TEXT,
    created      REAL NOT NULL,
    updated      REAL NOT NULL,
    last_used    REAL
);
