# Engineering audit, second pass (0.1.75)

The [first pass](Audit-2026-10.md) audited Mantel at 0.1.37 (merged as `063cbf1`). Since then 170 commits
(0.1.38 to 0.1.75, about 26,500 lines) added the Home Grid, Mantel Settings' server settings (house commands
switched on by an Owner instead of a start-up flag), Set Up Mantel, screens in two places, Home Assistant users as
people, Mantel Link's settings and reads, photo focus points (faces), music announcements, page health and a
reworked LXC installer. This pass audits that window, re-checks the first pass's invariants, and fixes what it
finds. This page is the working plan and the register; it is kept current so an interrupted pass can resume.

## Checkpoint

**State:** every subsystem audit reported; every finding fixed except the deferred rows (SET-2, SET-7 and the first
pass's T2, T6, G1, S8), each with its reason. Final regression below.

**To resume:** read the register below; every row not marked Fixed, Deferred or Not a defect is open. Run the main
suite with `~/.venvs/mantel/bin/python -m pytest -q -p no:cacheprovider` (the checkout's `.venv` is Python 3.14
without the dev tools).

## Baseline (before any change)

| Check | Result |
|---|---|
| Main suite, Python 3.12.15, macOS | 3503 passed, 21 skipped, 0 failed (2 min 52 s) |
| Skips | private words (no list given); the LXC installer's 9 tests (macOS has bash 3.2, they need 4+); 8 Caddy image tests (`MANTEL_CADDY_TEST_IMAGE`); 3 release-workflow tests (`pyyaml` missing from the venv, now installed) |
| `tools/check_private.py` with the owner's list | clean except the local, never-committed `project.pbxproj` (team id) |
| `pip-audit` of `packaging/docker/requirements.lock` (29 packages) | no known vulnerabilities |
| `ruff` correctness rules on production code (undefined names, redefinitions, mutable defaults, loop-variable capture, dropped tasks) | no defects; 15 unused imports, 1 unused variable in a test-only helper |

## Plan

1. Discovery: what changed since `063cbf1`, and where the risk is. **Done.**
2. Subsystem audits, each traced end to end, each finding reproduced by a test that fails before the fix:
   sign-in, sessions and server settings; RBAC and filtering on every new route and socket message; the Home Grid
   and the settings store; media (photos, faces, files, Live TV, talk, music); deployment, migrations and
   backups; the browser side; docs against code. The read path (`ha_client.py`, `state.py`, `view.py`) was
   reviewed directly. **Done.**
3. Register below, P0 first. **Done.**
4. Fix in severity order, a regression test per fix (each checked to fail before the fix), the suite after each
   batch. **Done.**
5. Docs reconciled with the code. **Done.**
6. Final regression and readiness review. **Done** (below).

## Issue register

Severity: **P0** unauthorized home control, credential disclosure, data loss; **P1** broken core function,
authorization inconsistency, corruption risk; **P2** functional bug, material maintainability or performance
problem; **P3** minor.

| ID | Sev | Area | Finding | Status | Test |
|---|---|---|---|---|---|
| RBAC-1 | P1 | Link | Any `linked` credential could relay any of Mantel's reads (`read_routes`) as any linked person, the Owner included: their saved data, settings history, Mantel Photos, camera offers. Saves needed `linked_saves`; reads needed nothing | Fixed: only the eight reads HK Frontend forwards (`linked_reads.FORWARDED`, kept equal to HK Frontend's lists by a test) | `test_linked_settings.py::test_a_link_credential_reads_only_what_hk_frontend_forwards`, `…exactly_the_reads_hk_frontend_forwards` |
| RBAC-2 | P1 | Link | Relayed subscriptions were never re-checked: a disabled, demoted or re-linked person kept them until the link dropped (the first pass's R2/M2, in new code) | Fixed: the policy tick walks the relayed contexts (`LinkedReads.recheck`), principals refreshed in place, a different person ends the old context | `test_linked_settings.py::test_a_disabled_or_relinked_person_s_relayed_reads_end_at_the_policy_tick` |
| AUTH-1 | P1 | People | Linking an HA user to a person (`PUT /api/people/ha`, merge) needed no fresh factor, from any door: a stale Owner cookie from away linked an HA account, whose "Sign in with Home Assistant" then made a fresh Owner session | Fixed: a link (and a merge, which moves one) asks what adding a passkey asks, `require_fresh_to_add_factor` | `test_sign_in_paths.py::test_linking_an_ha_user_to_a_person_needs_the_fresh_factor_adding_a_sign_in_needs`, `…merging…` |
| AUTH-2 | P1 | Tablets | `PUT` of a tablet's HA user had no door check: made from the tunnel, the HA user then got the home door's tablet rules | Fixed: the home-door Owner guard every other tablet route uses (`ingress._tablet_owner`) | `test_sign_in_paths.py::test_a_wall_tablet_is_linked_on_the_home_door_only` |
| RBAC-3 | P2 | Talk | Turning Allow Control of the House off left an open live talk streaming to the doorbell until its time limit | Fixed: `TalkRelay.close` ends open talks (`refused:commands_disabled`) | `test_talk_live.py::test_turning_control_of_the_house_off_ends_an_open_talk` |
| AUTH-3 | P2 | People | Unlinking an HA user ended its Ingress sessions but not its "Sign in with Home Assistant" ones | Fixed: unlinking or relinking also revokes the person's `ha` sessions (and their children) | `test_sign_in_paths.py::test_unlinking_an_ha_user_ends_its_sign_in_with_home_assistant_sessions` |
| MED-1 | P2 | Photos | Pillow's optimizing JPEG encode holds the GIL: a 48 MP upload froze every client for ~750 ms | Fixed: baseline JPEG for originals and screen copies (progressive and optimized encodes hold the GIL; files ~13% larger); a 24 MP upload's loop stall 0.34 s → 0.009 s | `test_photos.py::test_a_large_photo_upload_does_not_freeze_every_other_client`, `test_user_files.py::test_a_large_your_files_photo_upload_does_not_freeze_the_event_loop` |
| MED-2 | P2 | Photos | No cap on concurrent decodes; a small PNG claiming 100 MP cost ~1.5 GB | Fixed: one image job at a time across Mantel Photos and Your Files; the pixel cap 100 → 64 MP (Photos.md); each module checks its own cap instead of fighting over Pillow's global one; avoidable copies removed (100 MP RGBA peak 1.5 → 0.9 GB) | `test_photos.py::test_pictures_are_not_all_decoded_at_once` and five more |
| MED-6 | P2 | Cameras | Camera WebRTC offers had no per-socket or total cap (Live TV has both) | Fixed: 16 per socket, 64 in all, counted before the await (the Cameras page can show nine at once); past it `forbidden`, which the cards already handle | `test_connectors_camera.py::test_one_socket_cannot_start_unlimited_camera_streams` and two more |
| SET-1 | P2 | Home Grid | A non-string `card` raised TypeError in the checker; stored by import or restore, it broke every settings feed | Fixed: `item()` refuses a non-string card; the tolerant read never raises; a feed that cannot be built is logged, not raised into a committed save | `test_hk_core_home_grid.py::test_a_card_that_is_not_a_name_is_refused_not_a_crash`, `test_settings_store.py::test_one_stored_screen_with_a_bad_grid_does_not_take_the_feed_down` |
| SET-2 | P3 | Settings | House settings were stored with every default baked in, so place defaults (hemisphere, US-only themes) and later default changes never applied after a first save | Deferred (P3 in practice): Mantel stores the merged house settings by design (`settings_store.HkCoreModel`), so a first save fixes today's place defaults; switching to Home Assistant's stored-differences form changes the feed, history, import and linked-mirror shapes and is a change of its own. Only southern or non-US houses are affected, and Sky's hemisphere and themes can be set by hand | `test_settings_known_gaps.py::test_set2_a_default_is_not_a_saved_choice` (strict xfail) |
| SET-7 | P2 | Home Grid | Two editors: the second Save silently replaced the first's grid (no version check on `board/set`) | Deferred: needs a version on `board/set` in both hosts' schemas (HK Frontend's refuses an extra key) and board versions in the feed for the shared editor to send; rare (two admins saving one screen's grid at once) | `test_settings_known_gaps.py::test_set7_the_second_editor_does_not_silently_erase_the_first` (strict xfail) |
| SET-9 | P2 | Settings page | One failed read left a Mantel Settings page on its error until reload | Fixed: a failed read shows on its page and is asked again when the page is opened again (not on every redraw, which would loop) | `test_mantel_settings_reads.py::test_a_read_that_failed_is_asked_again_when_its_page_is_opened_again` |
| SET-11 | P2 | Settings page | The pairing poll redrew the whole panel every 4 s (losing typed text) and never stopped on errors | Fixed: a background redraw only when the code is spent or its minutes change; three failed polls in a row stop it | `test_mantel_settings_reads.py::test_the_pairing_poll_is_quiet_while_nothing_changes_and_stops_on_errors` |
| X1 | P2 | Docs | README, the Security Model, Rules and Architecture say no setting can turn house commands on; since 0.1.52 an Owner does it in Mantel Settings (with a fresh sign-in), and `--commands-enabled` only seeds the first start | Fixed: README, SECURITY.md, the Security Model, Rules, Architecture, Building and Testing, the server README, the gateway's and HA client's docstrings, the CLI help, the Ingress first-Owner page, and Set Up Mantel's own footer (which said no page could) | `test_mantel_settings_setup.py::test_commands_show_how_and_no_button_turns_them_on` |
| H1 | P2 | Checks | `ingress_smoke.py` failed on the untouched tree: its Ingress stand-in kept compressed bodies but dropped `Content-Encoding` (real HA decompresses) | Fixed (stand-in made faithful) | the check itself |
| H2 | P2 | Checks | `client_smoke.py` failed: `page_health` (0.1.49) was not in its list of non-command frames, and headless Chrome has no window focus, which rests the cameras since `b7496e2` | Fixed (list, focus emulation) | the check itself |
| H3 | P2 | Checks | `admin_page_check.py` failed: the plain admin page pre-ticks every scope, so `linked_saves` became a default for new service accounts there | Fixed: only `linked` is ticked at first | the check itself |
| RBAC-4 | P3 | Link | The `linked_saves` grant was made before its audit row (a failed audit left the grant behind a 500) | Fixed: audit first, 503 and no grant without it | `test_linked_settings.py::test_saves_are_turned_on_only_once_their_audit_row_is_written` |
| AUTH-4 | P3 | Apps | The app's web-view session outlived an expired app credential and was listed nowhere | Fixed: a session handed out by another never outlives it (`SessionManager.create` caps `expires`) | `test_sign_in_paths.py::test_the_apps_web_view_session_ends_with_the_app` |
| AUTH-5 | P3 | Frames | Adding a frame origin needed no fresh factor from away, while the Sign-In Address (which adds one) did | Fixed: adding a frame origin uses `connections._editor` (removing one narrows trust and stays as it was) | `test_sign_in_paths.py::test_a_frame_origin_needs_the_same_fresh_factor_as_the_sign_in_address` |
| AUTH-6 | P3 | Tablets | Moving a tablet to another HA user revoked the tablet (unlink before link) | Fixed: `link_tablet(moving_from=…)` swaps the link in one transaction, keeping the device and its mark | `test_sign_in_paths.py::test_moving_a_tablet_to_another_ha_user_does_not_revoke_it` |
| MED-3 | P3 | Photos | Cancelling an add mid-write left orphan files | Fixed: the write is shielded; a cancelled add cleans up after its thread | `test_photos.py::test_cancelling_an_add_while_its_files_are_written_leaves_none_behind` |
| MED-4 | P3 | Photos | A failing face detector marked photos "checked, no faces" for good | Fixed: only an unreadable file counts as "no faces"; a detector failure leaves the photo unchecked, and the backfill stops after three in a row | `test_photo_faces.py::test_a_failing_detector_does_not_mark_photos_checked_for_ever` and one more |
| MED-5 | P3 | Talk | Every talk ticket opened an authenticated HA socket, without a cap | Fixed: one early socket per person or tablet, four in all; other tickets connect when used | `test_talk_live.py::test_unused_talk_tickets_do_not_each_hold_a_home_assistant_socket` and two more |
| SET-3 | P3 | Home Grid | An unrelated screen save stored the grid as the tolerant reader saw it, deleting blocks or options this build doesn't know | Fixed: a save that doesn't touch the grid keeps it as stored | `test_hk_core_home_grid.py::test_an_unrelated_save_keeps_the_grid_it_could_not_read` |
| SET-4..6 | P3 | Home Grid | Trailing newlines passed the `$` patterns; `cols: 6.0` and `v: true` passed; entity ids had no length limit | Fixed: `\Z`, `type(...) is int`, 255 characters | `test_hk_core_home_grid.py::test_a_trailing_newline_is_not_an_id`, `…whole_numbers`, `…length_limit` |
| SET-8 | P3 | Settings | A person's look/sky values skipped the house model's value checks | Fixed: `HkCoreModel.apply_user` runs them | `test_settings_store.py::test_a_person_cannot_keep_what_the_house_would_be_refused` |
| SET-10 | P3 | Settings page | An older slow read overwrote a newer one | Fixed: only the read still asked for lands | `test_mantel_settings_reads.py::test_an_older_slow_read_does_not_replace_the_newer` |
| HK-1 | P3 | HK Frontend | A one-shot relayed read in flight when the link dropped was never answered (the dashboard's request hung, its tunnel entry stayed) | Fixed: a dropped link answers each one-shot read still waiting (`mantel_away`); subscriptions are asked again as before | HK Frontend `test_linked_settings.py::test_a_read_in_flight_when_the_link_drops_is_answered` |
| DEP-1 | P2 | Operations | Stopping the server waited out every open page socket (only `/linked/ws` was closed), so each stop ended in Docker's or the Supervisor's SIGKILL; the database was never closed | Fixed: `on_shutdown` closes page, media, talk and proxy-check sockets (going away); 5 s shutdown timeouts; the database closed last | `test_server.py::test_stopping_closes_open_page_sockets_instead_of_waiting_them_out` and three more |
| DEP-2 | P2 | Backups | No backup before an update (a migrated database can't be rolled back by images alone); the LXC install left the nightly backup off; a written backup was never read back | Fixed: `update.sh` and the LXC build-mode update back up first and stop if that fails; `MANTEL_BACKUP_TARGET` set by the installer; each backup verified after writing | `test_packaging.py::test_update_makes_a_backup_before_it_starts_new_images_and_stops_if_it_fails`, `…lxc_build_mode_update_makes_a_backup…`, `test_lxc_installer.py::test_the_install_turns_the_nightly_backup_on`, `test_backup.py::test_a_written_backup_is_read_back_before_it_counts` |
| DEP-3 | P3 | Database | "migration 0015/0017 changed after it was applied" on every start: a comment reworded after release | Fixed: checksums ignore comments and whitespace; the old raw checksums are refreshed quietly | `test_db.py::test_a_comment_only_edit_to_an_applied_migration_is_not_warned_about` and one more |
| DEP-4 | P3 | Packaging | `MANTEL_DEFAULT_SCREEN`/`MANTEL_SESSION_HOURS` documented but never forwarded by compose; the App container's admin commands looked in the wrong secrets folder | Fixed | `test_packaging.py::test_compose_forwards_…`, `…admin_commands_in_the_app_container…` |
| DEP-5 | P3 | Packaging | Only `SUPERVISOR_TOKEN` was removed from the server's environment, not its alias `HASSIO_TOKEN` | Fixed | `test_packaging.py::test_no_supervisor_token_alias_reaches_the_server` |
| DEP-6 | P3 | Packaging | The App image kept the stager's file modes (unreadable under umask 077) | Fixed: `COPY --chmod`, and the stager sets modes | `test_packaging.py`, `test_stage_ha_app.py` |
| DEP-7 | P3 | LXC | A source push extracted over the old tree, keeping deleted files (two migrations with one number stop the server) | Fixed: the code trees are removed first (never compose, data or secrets) | `test_lxc_installer.py::test_a_source_push_removes_what_the_new_version_deleted` (bash 4) |
| DEP-8 | P3 | CI | CI tested pyproject's open ranges, not the locked versions the images ship | Fixed: CI installs with the lock as constraints | `test_release_workflow.py::test_ci_installs_the_pinned_versions_the_images_ship` |
| X3 | P2 | Docs | The guide pointed to UI paths that no longer exist (Home Assistant Link, Who Runs Each Wall Tablet, Mantel Settings → Mantel Connect, Link Home Assistant Users…, Alarm PIN's place); local-build App names given as the only ones; Cloudflare Access's 24 h key grace, the CSRF cookie, Duck DNS errors, "Show in Home Assistant"'s prerequisite missing | Fixed (the guide, the App's DOCS.md, the packaging READMEs) | `tools/check_links.py` |
| X4 | P3 | Changelog | The notes for the first public release sat below 0.1.59 as `## Unreleased`; `bump_version.py --changelog` renamed them 0.1.71 out of order | Fixed: moved back to the top; the tool renames Unreleased only when it is the newest section | `test_check_version.py::test_bump_leaves_an_unreleased_section_below_released_ones` |
| X5 | P3 | Settings | `bar_labels` (0.1.72's Labels, Icons and Names) was in the Python defaults but not in `hk-settings.js`'s first-paint copy; HK Frontend's own suite caught it, Mantel's main suite doesn't run that suite | Fixed | HK Frontend `test_settings.py::test_the_screens_defaults_are_these_defaults` |
| WEB-1 | P2 | Web | Allow Control of the House turned off while a page was open: the reconnected socket gets no capabilities frame, and the hub kept the old `commands: true`, so controls stayed live and each press ended in "commands disabled" | Fixed: what a socket's server said ends with the socket | `test_web_lifecycle.py::test_control_turned_off_while_a_page_is_open_takes_the_actions_away` |
| WEB-4 | P2 | Web | The timer strip's Restart, +1 min and Finish (and the docked strip's dots) were inline handlers, refused by the page's CSP (`script-src 'self'`): dead in Mantel | Fixed: data attributes and one delegated listener (composedPath, capture) | `test_web_lifecycle.py::test_no_html_the_page_builds_carries_an_inline_event_handler` |
| WEB-5 | P2 | Web | Each thermostat or alarm sheet opened left a window resize, a media-query and (thermostat) a ResizeObserver listener behind, keeping dead panels alive and re-fitting them on every turn | Fixed: `Panel._listenShort`/`_undo`, undone in `disconnectedCallback` | `test_web_lifecycle.py::test_a_panel_removes_the_listeners_it_added_to_the_window_when_its_sheet_closes` |
| WEB-6 | P2 | Home Grid | The clock block went blank after leaving the Home page and coming back | Fixed: drawn again on reconnect | `test_web_lifecycle.py::test_the_grid_clock_block_draws_its_face_again_when_its_view_comes_back` |
| WEB-7 | P2 | Web | One failed request at start (a 503 while Mantel restarts) left the page, a wall tablet's too, blank for good | Fixed: the page starts again after 2 s ... 30 s | `test_web_lifecycle.py::test_one_failed_request_at_start_does_not_leave_the_page_blank_for_good` |
| WEB-2 | P3 | Web | A command between sockets threw `InvalidStateError` and left its pending entry | Fixed: answered `unavailable` | `test_web_lifecycle.py::test_a_command_while_the_socket_is_down_is_refused_in_the_hubs_own_words` |
| WEB-3 | P3 | Web | Pings nobody answered piled up waiters | Fixed | `test_web_lifecycle.py::test_pings_nobody_answered_are_not_kept` |
| WEB-8 | P3 | Web | The people card's failed-picture handler threw on its second call | Fixed | `test_web_lifecycle.py::test_the_people_cards_failed_picture_handler_survives_a_second_call` |
| X2 | P3 | Repo | `tests/.smbdeleteAAAe3e16`, a stale copy of `test_accounts.py` left by the SMB share, is tracked | Fixed (removed) | |

## Architecture assessment

The first pass's picture still holds: one aiohttp server with a read-only `subscribe_entities` copy of Home
Assistant, per-client filtered diffs, a separate command path (classify, RBAC, audit row, then `HaCommander`), the
settings store over `hk_core`, and Mantel Link's `/linked/ws`. The read path (`state.py`, `view.py`) needed nothing:
entries are replaced, never mutated; diffs are taken against what was sent; a gated view resolves only what it may
show. `gateway.py`, `rbac.py` and `rbac_store.py` are unchanged since the first pass, so its fixes there stand.

What changed since is mostly new doors, and most findings were the first pass's lesson again: **a new door to an old
thing, checked less than the old door.** The linked HK Frontend's relayed reads (RBAC-1, RBAC-2) and the new People
and tablet routes (AUTH-1, AUTH-2) skipped checks every older route to the same thing applies. The second theme was
**the live command switch** (0.1.52): the server side was built carefully (every sender looks the gateway up at each
use), but a talk already running (RBAC-3) and the page's idea of "commands on" (WEB-1) outlived it.

Remaining technical debt: `features.py` (2,350 lines), `settings_store.py` (1,900), `mantel-settings.js` and
`hk-detail.js` are very large single files; the merged-house storage (SET-2) differs from Home Assistant's
stored-differences form; and the main suite does not run HK Frontend's own suites, so a check that only they make
(X5) can go red unseen.

## Test results (final)

| Check | Result |
|---|---|
| Main suite, Python 3.12.15, macOS (Home Assistant's harness present: Mantel Link's suite and the linked end-to-end tests run inside it) | 3582 passed, 0 failed, 2 xfailed (SET-2, SET-7, pinned), 20 skipped (the LXC installer's 11 need bash 4, macOS has 3.2; 8 need a Caddy test image; the private-words test needs its variable, and `tools/check_private.py` was run by hand with the owner's list: clean) |
| Baseline for comparison | 3503 passed, 21 skipped |
| HK Frontend's Python suite (HA harness, on a fresh build) | 759 passed after X5's fix (1 failed before it, on the untouched tree too) |
| HK Frontend's JavaScript suites, on macOS's own JavaScriptCore (the first pass had only a Node stand-in) | every suite green |
| Headless checks: `client_smoke`, `gateway_page_check`, `admin_page_check`, `settings_viewports`, `ingress_smoke`, `grid_blocks_check` | all pass (3 failed on the untouched tree: H1..H3) |
| Browser probes in headless Chrome (fictional house): the timer strip's buttons under the page's CSP, a 503 at start, listener growth over 35 sheet opens, hostile names in every grid view | 6 of 6 taps reach `act`; the page recovers after one retry; no listener growth; nothing injected, no console errors |
| `tools/check_links.py`, `package_check.py`, `package_check.py --release`, `check_version.py` | clean; 0.1.75 everywhere |
| `pip-audit` of the lock (29 packages) | no known vulnerabilities |
| Docker image builds, the LXC on Proxmox, the Apple apps, a real Home Assistant | not run: Docker's daemon was off, no Proxmox, no Xcode build in this pass, and production is out of bounds |

## Performance

- The state hub's fan-out, a synthetic 5,000-entity house with 50 screens and 200 changes per event: 8.6 ms per
  event, 0.86 µs per entity per screen (no role filter; the first pass measured ~2 µs per entity for RBAC's
  classify).
- Photo uploads (MED-1): the loop stall of a 24 MP upload went from ~340 ms to ~9 ms; a 48 MP one from ~750 ms; four
  at once from ~2.1 s (now queued, one at a time). Peak memory for a 100 MP RGBA PNG 1.5 GB → refused; at the new
  64 MP cap 0.64 GB.
- The fixes on hot paths (the policy tick's walk of relayed contexts, the camera session count, the talk pre-connect
  check) are constant-time per item.

## Security assessment

Verified controls (each auditor listed them, with tests): Owner-only Allow Control of the House with a fresh factor
and an audit row first, held off by the kill switch on every start; every command sender looking the gateway up at
each use; RBAC person ∩ tablet, deny by default; server-side filtering of states, registries, the settings feed's
music players, person pictures; audit-before-change for Owner settings; the setup code (192 bits, hashed, single
use); CSRF on unsafe API calls; refresh reuse revoking the family; Cloudflare Access failing closed; no DOM XSS found
with hostile names in every field the browser audit could reach.

Resolved weaknesses: the register's Fixed rows (4 P1, 20 P2 and 24 P3 rows; a few rows group related P3s).

Untested assumptions: real Home Assistant, Supervisor, Cloudflare and Music Assistant behaviour (fakes and the
scratch Home Assistant only); `HASSIO_TOKEN` being exported by the Supervisor (DEP-5 removes it either way); real
iPad Safari suspend and resume (`hub.js` has no `visibilitychange` handler; the server's 30 s heartbeat covers its
side); the images as built (Docker's daemon was not running).

Unresolved: none at P0 or P1. Deferred: SET-2 (P3) and SET-7 (P2), each pinned by a strict xfail; the first pass's
T2, T6, G1 and S8.

## Outstanding items and recommendations

- **SET-7**: a version on `board/set` in both hosts, and board versions in the feed, so the shared grid editor can
  say "changed meanwhile".
- **SET-2**: store the house settings as Home Assistant does (what differs) and merge on read, in one change with
  the feed, the import and the linked mirror.
- **Music Assistant subscriptions** (`ma/subscribe`) have no per-connection cap, unlike camera and Live TV sessions
  now; and `hk_music/subscribe` has no `recheck` at the policy tick (rights are re-read on each push).
- **CI**: run HK Frontend's Python and JavaScript suites against a build on every push (X5 was caught only by them).
- **iPad suspend**: a `visibilitychange` check in `hub.js` (ping on wake, reconnect when silent).
- The first pass's T2 (pairing protocol v2), T6 (Wall Tablet accounts and rooms), G1 and S8 (a look on a device)
  still stand.

## House App 0.1.76 deployed (2026-10-26)

The owner asked for this release. Release commit `e38e570` carries this pass's fixes. The update installed on the
first request. Strict health is OK with Home Assistant connected (4509 entities) and Music Assistant signed in, and
build `7417ce2f2a578b8c` matches the staged release. Allow Control of the House stayed on. All five wall tablets
reconnected on their own within a minute, without reloading. No log line matches "Traceback" or "ERROR".

Not as intended: the house still logs "migration 0015/0017 changed after it was applied" (DEP-3). Its stored
checksums come from before the repository's history was rewritten, so they match neither the current files nor
the pre-edit ones in git. It stays harmless. The fix that would silence it compares the live schema with a fresh build
from the current migrations instead of matching known checksums.

## HK Frontend 1.11.0 on the house (2026-10-26)

The owner asked for this. Commit `834aaea` bumped HK Frontend to 1.11.0. It carries the shared code since 1.10.7 (the
Home Grid, the tab bar's labels, the detail sheets) and this pass's fixes (HK-1, X5, WEB-4..6, WEB-8). The build
passed HK Frontend's Python suite (759) and every JavaScript suite on JavaScriptCore. It was copied into
`custom_components/hk_frontend` with `rsync --inplace` and no `--delete`; `diff -rq` against the build showed no
difference, and the folder's 9 runtime-only files were kept. After Home Assistant restarted, `/hk/` served the new
files, and HK Frontend and Mantel Link both relinked to Mantel. The system log has no entry for `hk_frontend`. It is
on hk-frontend's `main` as `b31d434`, untagged, so HACS users stay on v1.8.3 until a release is tagged.
