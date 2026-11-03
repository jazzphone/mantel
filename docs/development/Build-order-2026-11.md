# Build order: phases 15 to 19 (2026-11-03)

Five plans, written 2026-11-03 at the owner's request, each meant to be built by one session from start to finish.
This page says in what order, which can run side by side, and the rules every one of them shares.

| Phase | Plan | Size | Touches most |
|---|---|---|---|
| 15 | [Faster releases](../phase15/FASTER-RELEASES.md) | M | `.github/workflows/release.yml`, `tools/release_house.py`, `packaging/proxmox/ct/mantel.sh` |
| 16 | [Features on by default](../phase16/FEATURES-ON-BY-DEFAULT.md) | M | `hk_core/needs.py`, `features/`, `hk-settings-features.js`, `alerts/catalog.py` |
| 17 | [Intercom](../phase17/INTERCOM.md) | L | `intercom/`, `hk_core/intercom/`, `hk-intercom.js`, `hk-media.js`, `hk-grid-catalog.js`, `rbac.py`, compose |
| 18 | [Code health](../phase18/CODE-HEALTH.md) | L | Part A: `guards.py`, `route_table.py`, every route module; Part B: the four big JS files; Part C: `tools/typecheck/` |
| 19 | [House Timeline](../phase19/HOUSE-TIMELINE.md) | L | `timeline/`, `hk_core/timeline/`, a migration, `hk-timeline.js`, `hk-grid-catalog.js`, `rbac.py`, `alerts/` |

## The order

1. **Phase 15 and phase 16, side by side.** They share no files. 15 first matters most: every later release is then
   one command.
2. **Phase 18 Part A (the route table)** and Part C's first step (measuring `tsc`), after 15 and 16 are on main, so the
   routes 17 and 19 add are declared in the table from their first commit.
3. **Phase 17 and phase 19, side by side**, after Part A. Both add an RBAC feature, a Home Grid block in
   `hk-grid-catalog.js`, a Settings page and alert or audit kinds: small list edits that a merge settles. Each merges
   origin/main before every push.
4. **Phase 18 Parts B and C (the file splits and type-checking)**, last, once 17 is on main, since 17 edits
   `hk-media.js` and Part B splits it. The splits are a script run on the latest main (`tools/split_js.py`), so a late
   edit elsewhere means running it again, not merging by hand.

## What every session shares

- **Models.** The session runs Opus 5.5 at Medium effort. Its agents run Sonnet 5.5 at High effort (`model:
  "sonnet"`, `effort: "high"`); Opus 5.5 for an agent only where its plan says why.
- **No stopping.** Every question is answered in the plan's "Decisions for the owner" before the session starts.
  Something unforeseen: the safest choice consistent with those answers, written in the plan's Build log, and on. It
  stops only for what only the owner can physically do ("Waiting on the owner").
- **Checks throughout.** Each slice ends with its tests and `tools/ci.py quick`; `tools/ci.py full` before each push;
  WebKit screenshots at three sizes for anything on screen; a review agent reads each slice's diff.
- **Main.** Work in a worktree from origin/main; fetch and merge before each push (`git merge --no-autostash -s ort`
  on the SMB checkout), `tools/check_private.py`, never force-push. Migrations take the next free number when built
  (19 expects `0033`; whichever lands first takes it).
- **One release at a time.** A session that may release (its plan's last decision) first fetches main, reads every
  commit since the last house release (`docs/development/House-releases.md`), and releases what main holds, which may
  include another session's finished work. Two sessions never release at once: the second waits for the first's record
  in `House-releases.md`. Once phase 15 is in, releases use `tools/release_house.py`.
- **Sound.** Only phase 17's proof plays sound, on the HomePod and in the hours its decision 19 names. Never the bedroom
  HomePod the owner excluded.
- **American English** everywhere; the diff is grepped before committing.
