# Engineering audit, third pass (0.1.112)

The [second pass](Audit-2026-10-second-pass.md) audited Mantel at 0.1.75 (`ac9d9846`). Since then about 500 commits
(0.1.76 to 0.1.112, about 90,000 lines) added the HomeView look, Home Grid blocks, the Side Pane, the screensaver editor
and its layouts, Bright Glass, presets as Mantel's own lists of rooms, the MCP server (Assistants) with its own OAuth,
restore from another Mantel, the one-command Proxmox install, and split `features.py`, `settings_store.py` and
`hk-detail.js` into packages. This pass audits that window, re-checks the earlier passes' invariants, fixes what it
finds, and fixes the owner's list of 2026-11-01. This page is the working plan and the register; it is kept current so
an interrupted pass can resume.

## Checkpoint

**State:** done. The owner's list and every register row are fixed or deferred with a reason; the fixes are on `main`.
Final regression below.

**To resume a later pass:** start from "Outstanding items" at the foot of this page. Run the checks with
`python3 tools/ci.py full` (with `PLAYWRIGHT_PATH` set to a `playwright-core` 1.62.0, the version whose browsers are in
`~/Library/Caches/ms-playwright`, and `NODE`); a worktree's checks need `PYTHONPATH` set to the worktree and the main
checkout's `tools/node_modules` (esbuild).

## Baseline (before any change, `facbfdf6`)

| Check | Result |
|---|---|
| `tools/ci.py full` | 17 passed, 0 failed, 19 skipped (no `PLAYWRIGHT_PATH`) |
| The 20 Playwright checks (`playwright-core` 1.62.0 installed for the pass) | 20 passed, 0 failed |
| Main suite (inside `ci.py`) | passed, 79 s |
| HK Frontend's Python and JavaScript suites, the headless checks, the Caddy image | all passed |

## Plan

1. Discovery: what changed since `ac9d9846` and where the risk is. **Done.**
2. Subsystem audits, each traced end to end, findings reproduced by a test or a script: server security (auth, RBAC,
   routes, MCP, settings feed); Home Assistant and Mantel Link; media (music, photos, cameras, art); deployment,
   migrations and backups; browser code; docs against code. **Done.**
3. The owner's list (below). **Done.**
4. Fix in severity order, a regression test per fix checked to fail before it, a branch per subsystem. **Done.**
5. Docs reconciled with the code. **Done.**
6. Final regression and readiness review. **Done** (below).

## The owner's list (2026-11-01)

| Item | Cause | Fix | Checked |
|---|---|---|---|
| The screensaver editor's + not centered in its circles | a "+" in the font sits on the font's math axis, not the middle of its line | the + is drawn (two bars, centered) | WebKit and Chromium screenshots |
| The Temperature widget's figure not centered in its ring | "56°" was centered whole, so the digits sat half a degree sign left | the digits are centered, the degree sign hangs after them | screenshot |
| The song under the weather not centered | Today's line had no `min-width: 0`: a long title overflowed to the right; and the big element was measured by its words' whole length, ellipsized or not, so the time sat left of the layout's middle | the line ellipsizes inside its width; `inkOf` clips words to the boxes that hide their overflow | screenshot with a 70-character title |
| No way to turn the song line off | the Today face always drew it | `clock_today_music` (default on): **What's Playing** under Face in the editor and under Clock Style in Settings | main suite, JS suites |
| A group can't be chosen as a Music block's Plays On | since 0.1.111 a preset's id is `preset:<key>`; `home_grid.py` checked `music_speaker` as a `media_player` entity id (`grid_option`) | the check accepts a preset; the block plays a cover on the preset's first room, then the rest join | `test_hk_core_home_grid_cards.py::test_a_music_block_plays_on_a_speaker_or_a_preset` (failed before) |
| "Can't save" didn't say where | the house says only the kind of refusal | the editor names the blocks changed since the last save, and selects the first | by hand |
| The Side Pane's small speaker below the volume line | `hk-icon`'s host box is inline: at 14 px its line box was taller than the icon | the volume row's icons are centered flex boxes | by reading the box model; not yet seen on the house |
| A Room block's glyphs tiny beside the Accessories block's | a Room block's tiles are ~107 px (its name takes the rest), under the 124 px step that drew a fixed 40 px glyph; and its pills kept the room page's icon size | the short step's glyph grows with the tile (40 to 56 px, 46 % of it); Centred tiles drop the page's icon size and well | WebKit and Chromium screenshots |
| A Room block's half cards | a Wide Room drew Centred tiles in a short row, stretched to 86 px or cut at 62 | a Wide Room's rows are the Home app's 70 px pill (as an Accessories block's Half), or the height there is when its foot line leaves less | screenshots |
| Playlist artwork from its albums | a playlist pill reached the page as a name and an icon only | each playlist's cover is the first of its items' pictures (its own, else its first song's album), looked up in the background, cached 6 h, through Mantel's own image path; HK Frontend in Home Assistant keeps the gradient | `test_music.py`, `test_blocks_media.js`, `test_musicpage.js`; screenshots with a fake Music Assistant |

## Issue register

Severity: **P0** unauthorized home control, credential disclosure, data loss; **P1** broken core function,
authorization inconsistency, corruption risk; **P2** functional bug, material maintainability or performance
problem; **P3** minor.

| ID | Sev | Area | Finding | Status | Test |
|---|---|---|---|---|---|
| SRV-1 | P1 | Assistants | Connecting an assistant (MCP OAuth) issued a 30-day refreshable credential, up to `commands` and `restore`, with no fresh factor and from away; a personal key asks for one | Fixed: the consent page asks for a fresh sign-in (Sign In Again), `commands` on every door, the sidebar too | `test_mcp.py::test_connecting_an_assistant_needs_the_fresh_sign_in_a_personal_key_needs`, `…control_the_house_needs_a_fresh_sign_in_even_where_something_vouches` |
| SRV-3 | P1 | People | AUTH-1 again: the Ingress People form linked an HA user to any role, Owner included, with no fresh factor | Fixed: one rule for every door, `accounts.require_fresh_to_grant` (Owner or Admin, a new way in) | `test_ingress_tablets.py::test_the_people_form_links_an_owner_only_with_a_fresh_factor_when_the_sidebar_does_not_vouch` |
| SRV-8 | P1 | People | AUTH-1 again: `PATCH /api/users/{id}` made an HA-linked account Owner or re-enabled it, `POST /api/users` created an Owner, with no fresh factor | Fixed: the same helper on create and update (a role made Owner or Admin, an account enabled again) | `test_sign_in_paths.py::test_a_role_change_to_owner_or_admin_or_a_re_enabled_account_needs_the_fresh_factor` |
| MED-10 | P1 | Cameras | An open `/go2rtc/` HTTP stream (MJPEG, MP4, HLS segments, WHEP) kept flowing after its person was revoked: only the WebSocket relay was in the live registry | Fixed: every streamed answer is in the live registry, rechecked against its camera, closed on revocation; an HLS id serves only the stream that issued it; WHEP (`POST api/webrtc`, used by no page or app) is not served | `test_media_proxy.py::test_a_revocation_ends_an_open_stream_at_once` and four more (58 chunks after revocation before) |
| SRV-2 | P2 | Assistants | A screen preview (minted by a `screens`-only key) read people, sessions, Alarm PINs, passkeys and settings history: a deny-list of paths | Fixed: an allow-list (page shells, `/ws`, what a screen loads, stills, art, photos) and a list of the socket reads a screen makes; a test makes every new read route choose a list | `test_mcp.py::test_a_preview_reaches_only_what_a_screen_draws_from` and two more (not tried in a real browser) |
| SRV-4 | P2 | Settings feed | A Child's settings feed carried every screen's grid entity ids, custom names for entities it can't view, custom chips | Fixed: the feed is cut per person (grid blocks keep their place without the entities, accessory names and orders, chips and pop-ups naming an unseen entity). Left: custom pages' cards and other free-form board keys (`cameras_custom`, `favorites`, `chips_extra`), next pass | `test_settings_store.py::test_a_childs_screen_socket_is_not_told_what_it_cannot_view` and three more |
| SRV-5 | P2 | Vacuums | `mantel/clean_areas/coverage` returned every vacuum and its rooms to any principal | Fixed: filtered by `view`, as its sibling | `test_features.py::test_the_clean_areas_coverage_lists_only_the_vacuums_a_person_may_view` |
| SRV-6 | P2 | Assistants | MCP `resources/read` and `resources/list` applied no scope | Fixed: each resource needs its tool's scope | `test_mcp.py::test_resources_answer_to_the_scopes_of_the_tools_behind_them`, `…every_resource_maps_to_a_scope_its_tool_needs` |
| SRV-7 | P2 | Assistants | Music's settings history and restore always failed (`house/music` not in `HOUSE_DOCS`), though every music change advertises undo | Fixed: Music has history and restore, checked, and the music engine follows a restore | `test_mcp.py::test_a_music_change_can_be_looked_up_and_undone_as_it_says` |
| SRV-9 | P2 | Notifications | Any principal, a Guest included, could mute a category (smoke) house-wide for 24 h, unaudited | Fixed: `control` on the Notifications feature (an Adult, Owner, Admin; a Child or tablet by grant), the audit row first | `test_features.py::test_only_a_person_who_may_control_notifications_mutes_one_and_the_audit_row_comes_first` |
| SRV-10 | P2 | Art | DNS rebinding: the remote art fetch checked one lookup and connected with another; NAT64 passed as global | Fixed: the cover session dials only the addresses checked, on every hop (no DNS cache, no kept connections); NAT64, 6to4, Teredo and other carriers of another address are never a destination. HK Frontend's art fetch in Home Assistant shares the range checks but not the pin (HA's session) | `test_media_art.py::test_a_name_that_changes_its_answer_between_the_check_and_the_connect_is_dialed_as_checked` and four more |
| MED-11 | P2 | Music | A Stop within 45 s of a Pause left the room shown paused (resumable) for up to 4 h | Fixed: a stop Mantel sends forgets its rooms, and the idle that follows within 10 s is Mantel's, in both hosts | `test_music.py::test_stop_all_within_a_pause_s_window_leaves_nothing_to_resume` and two more |
| LINK-1 | P2 | Mantel Link | Each App start revoked the credential HA holds before its replacement was accepted: a failed post left Mantel Link dead | Fixed: the new one is made, posted and recorded first; a refused post revokes it and leaves the old | `test_mantel_link_discovery.py::test_a_supervisor_that_refuses_the_new_announcement_leaves_the_old_credential_alone` and two more |
| LINK-2 | P2 | HA client | One exception in any state hook killed the HA connection, reconnecting forever | Fixed: every hook and each frame's parse isolated, logged once per hook and kind | `test_a_hook_that_raises_does_not_take_the_connection_down` and two more |
| LINK-3 | P2 | Page headers | Every automation's `last_triggered` scheduled a full page-headers read in HA | Fixed: only a state that changed | `test_an_automation_that_only_ran_is_not_read_again_but_one_that_switched_is` |
| LINK-4 | P2 | HA reads | The read proxy dropped its subscriptions (forecast, notifications, music) on an HA restart for good: frozen forecasts until reload | Fixed: kept and sent again on reconnect, with backoff | `test_readproxy_resubscribe.py` (4) |
| LINK-5 | P2 | Mantel Link | A revoked credential was retried every 30 s forever, no reauth, no repair | Fixed: said once, retries back off to 10 min; Mantel Link asks to re-authenticate (a pairing code or a credential); HK Frontend raises a Repairs issue | `mantel/tests/py/test_link_auth.py` (5), HK Frontend's refused-credential test |
| DEP-10 | P2 | LXC | `update` rewrote `.env`'s image pins before the images were pulled and never put them back | Fixed: `.env` put back on any unfinished update; a release whose images aren't published is skipped | installer tests (bash 5) |
| DEP-11 | P2 | Backups | A restore never checked the at-rest key opens the backup; with the wrong one every TOTP sign-in was a 500 | Fixed: a restore opens one sealed value of each kind first (`wrong_at_rest_key`, `--skip-at-rest-check` for a lost key); a seed that won't open is a 503 `totp_unreadable`, logged, never a 500; `restore.sh` puts the old keys back on any interruption | `test_backup_at_rest.py`, `test_accounts.py`, `test_restore_scripts.py` |
| MED-14 | P3 | Art | Unbounded concurrent remote-art fetches (8 MB each) | Fixed: 8 at once | `test_distinct_covers_are_not_all_fetched_at_the_same_time` |
| MED-15 | P3 | Photos | `move` skipped the album cap; killed writes left `.tmp` files for good | Fixed: the cap on move; a start-up sweep of half-written files over a day old (orphan files with no row are left: a restore can bring rows and files of different times) | `test_photos.py` (3) |
| MED-16 | P3 | Music | The music feed kept a speaker's name after its `view` was taken away, until the next push | Fixed: the policy tick pushes a changed feed | `test_the_feed_is_rebuilt_at_the_policy_tick_when_a_view_on_a_speaker_is_removed` |
| SRV-11 | P3 | Music | The engine's gate allowed every configured speaker, not the ones the gateway approved | Fixed: a run's players are the approved rooms (with pairs and queues); a play or move that would take a room the person can't control out of its group is refused whole, nothing sent. A member's Stop still stops its group (Music Assistant forwards it) | `test_music.py` (3) |
| SRV-12 | P3 | Read-only | The kill switch didn't stop Admins creating or deleting HA dashboards; a restore can bring `commands_enabled` with it unannounced | (a) Fixed: refused under the kill switch, before the audit row, and at the one place a write is sent; (b) documented in Backups; a confirmation step is left for later | `test_screens.py::test_the_read_only_kill_switch_changes_no_dashboard_in_home_assistant` |
| LINK-6..10 | P3 | HA client, Link | A socket drop during the first registry load waited 60 s; a probe warned "stopped"; hand-copied talk and action constants unpinned; pre-`live.py` rechecks left behind; re-pairing never revoked the old account | Fixed (LINK-9: the dead rechecks deleted; the per-link watcher kept only where there is no live registry, bare test apps; LINK-10: pairing Mantel Link again revokes the credential it last connected with, so two Home Assistants can't both pair one Mantel) | `test_link_hand_copies.py` (7), `test_linked_pairing.py`, and one per finding |
| DEP-12..18 | P3 | Packaging | A branch `var_mantel_ref` failed; `update` could downgrade a `main` install; no version in About on Docker and the LXC; `pyasn1` 0.6.4 (four CPU advisories); a failed rollback claimed success; the one-liner pinned nothing; a tracked `.smbdelete` file | Fixed: `origin/<ref>` first; "ahead of the newest release"; `RELEASE.json` in the image (`tools/write_release.py`); `pyasn1` 0.6.5 with its hashes; a failed rollback says Mantel is not running and prints the restore line (exit 3); install files follow `var_mantel_ref` and community-scripts' engine is pinned to a commit (the pin not tried on a real Proxmox); the file removed, `.smbdelete*` ignored | 19 new tests, each failing before |
| WEB-10 | P2 | Edit mode | A Done that failed part-way, done again, sent its first saves with the versions read as editing began: a false "This page changed", and Reload threw the arrangement away | Fixed: one version per document for the session, kept as each save answers | `test_edit.js` "Done failed part-way, then Done again" (failed before) |
| WEB-11 | P2 | Detail sheets | One file of `web/hk/sheets/` that didn't come (a tablet's Wi-Fi waking) left every detail sheet dead until a reload; the page's own modules and HK Settings' likewise | Fixed: asked for again, later each time, at an address of their own; checked in headless Chrome with the file blocked then reachable | `test_web_lifecycle.py::test_a_sheet_file_that_did_not_come_is_asked_for_again` |
| WEB-12 | P3 | Commands | Every refused or failed command said "Not allowed": a dropped connection, a signed-out page, Home Assistant's own errors; the refusal lists grew for the page's life | Fixed: each in its own words; the lists keep 50 | `test_web_lifecycle.py::test_a_failed_command_is_said_in_its_own_words_not_not_allowed` |
| WEB-13 | P3 | Confirm sheet | A second confirm over an open one left the first's capture-phase Escape listener: every Escape swallowed from then on | Fixed; checked in headless Chrome | `test_web_lifecycle.py::test_a_second_confirm_over_an_open_one_leaves_no_escape_listener_behind` |
| TEST-1 | P3 | Checks | `test_blocks_energy.js` failed after 23:00 (no hours still to come) | Fixed: the suite reads the fixed noon clock, as the calendar suites do | the suite |
| DOC-1 | P2 | Docs | Updating said the LXC updates with `mantel-update` from the Proxmox host; a one-command install updates with `update` inside it | Fixed: Updating, Install, CHANGELOG | `check_links.py` |
| DOC-2 | P2 | Docs | Install pasted `:0.1.36` images that were never published (0.1.112 is the first) | Fixed: 0.1.112 | |
| DOC-3..13, 16..20 | P3 | Docs | "(moved)" options "for one release"; `MANTEL_PUBLIC_URL` for `MANTEL_HOSTNAME`; `var_connect` on the one-command install; the Audit Log's **Through** filter and `via`; Backups and Assistants missing from Who Sees Which Settings; no MCP in the Security Model or Rule 7; the Alarm PIN message; the Assistants consent words; presets "play through their own group"; the Top Band's parts; Half Height and Plays On undocumented; the overview under a "## Unreleased" that `bump_version.py` would have renamed; "Edit mode arranges any page"; a hand-written pre-commit hook without `--staged`; Assistants missing from Home; stale RELEASE notes (mantel-link and the repository are public) | Fixed | `check_links.py` |
| DOC-14 | P3 | iOS app | Notifications showed **Mute 1 Hour**, which did nothing (`didReceive` routes only the link) | Fixed: the button is gone until mute is built (not built in Xcode in this pass) | |
| DOC-15 | P3 | Docs | The apps "not on TestFlight yet": whether external testing is open is the owner's to say | Deferred: owner | |
| DOC-sp | P3 | Docs | British spellings in CHANGELOG, the guide, the development docs, OPERATIONS and one UI sample title | Fixed (code identifiers such as `centred` left) | |

## Not defects

- The `features.py` and `settings_store.py` splits lost no check: every top-level function compared by AST.
- `hk_core/link/` is the one source for Mantel Link and HK Frontend's link code; the copies are thin wrappers and a
  test pins them.
- Migrations 0025 to 0029 upgrade a 0.1.75 database to a schema identical to a fresh build; an interrupted one rolls
  back.

## Architecture assessment

The second pass's picture still holds: one aiohttp server with a read-only `subscribe_entities` copy of Home Assistant,
per-client filtered diffs, a separate command path (classify, RBAC, audit row, then `HaCommander`), the settings store
over `hk_core`, Mantel Link's `/linked/ws`, and the live registry (`live.py`) that rechecks every long-lived connection.
The window's big refactors were sound: `features/` and `settings_store/` lost no check, `hk_core/link/` replaced two
copies of the link with one, and the `hk-detail.js` split lost no handler.

The findings repeat the earlier passes' lesson once more, **a new door to an old thing, checked less than the old
door**: assistants (MCP OAuth, previews, resources), the Ingress People form and the user routes each granted what the
REST route they paralleled refused (SRV-1, 2, 3, 6, 8); go2rtc's HTTP streams sat outside the live registry the
WebSocket relay was in (MED-10); new reads skipped a sibling's `view` filter (SRV-4, 5). The fixes close them by rule,
not by route where they could: `require_fresh_to_grant` is the one rule for granting a role that can sign in as Owner
or Admin; previews are an allow-list, and a test makes every new read route choose a side; every streamed answer goes
through the live registry. The second theme is **failure handling at the edges**: a hook's exception ending the HA
connection (LINK-2), subscriptions lost on reconnect (LINK-4), a credential retired before its successor was accepted
(LINK-1), a module fetch that never retried (WEB-11), `update` leaving `.env` changed (DEP-10).

Remaining technical debt: very large single files remain (`hk-settings.js`, `hk-saver.js`, `hk-grid-cards.js`,
`hk-media.js`); the settings feed's free-form board keys are sent unfiltered (SRV-4's remainder); HK Frontend inside
Home Assistant fetches remote art through HA's own session without the address pin (SRV-10's remainder).

## Test results (final)

| Check | Result |
|---|---|
| `tools/ci.py full` on the merged tree, Playwright 1.62.0 | FINAL_RESULT |
| Main suite | in the run above; 4322+ tests on the merged branches before the last merge |
| New regression tests | about 70, each checked to fail before its fix (the subsystem branches' reports; the few exceptions are new drift checks) |
| Browser probes (headless Chrome): a sheet file blocked then reachable; an overlapping confirm and Escape; hostile names in every view (the audit); listener growth over 66 sheet opens | recover; Escape heard; nothing injected; no growth |
| Docker image builds, the LXC on Proxmox, the Apple apps in Xcode, a real Home Assistant, a real Music Assistant | not run: no Docker daemon build in this pass, no Proxmox, no Xcode build, production and the house are out of bounds |

## Performance

- The hub's fan-out, a synthetic 5,000-entity house, 50 screens, 200 changes per event: median 9.3 ms per event
  (0.93 µs per changed entity per screen), against the second pass's 8.6 ms; no regression.
- LINK-3 removes a full page-headers read in Home Assistant on every automation run (about every 3 s on a busy house
  while a screen is subscribed). MED-14 bounds remote art fetches to 8 at once (up to 8 MB each).

## Security assessment

Verified controls (the audits' lists, with tests): Allow Control of the House and the kill switch on every start;
audit-before-change; RBAC person ∩ tablet, deny by default; MCP OAuth's PKCE, exact redirects, single-use codes and
refresh rotation; `house_command` through the gateway; pairing v2; backups' archive checks; migrations 0025 to 0029; no
DOM XSS with hostile names in any view; CSP without inline handlers.

Resolved: the register's Fixed rows (4 P1, 22 P2 and the P3s). Behavior that changed on purpose: making someone an
Owner or Admin, adding one, linking a Home Assistant user or enabling an account needs a fresh sign-in on every door;
muting a notification needs control of Notifications (Adults keep it, Guests and Children don't by default); a play
that would regroup a room the person can't control is refused; pairing Mantel Link again revokes its old credential
(so two Home Assistants can't both pair one Mantel); go2rtc's WHEP route is not served.

Untested assumptions: real Home Assistant, Supervisor, Music Assistant, Cloudflare and Proxmox (fakes and the scratch
Home Assistant only); the community-scripts engine at its pinned commit; screen previews in a real browser.

Unresolved at P0 or P1: none.

## Outstanding items

- SRV-4's remainder: custom pages' cards and free-form board keys (`cameras_custom`, `favorites`, `chips_extra`) in
  the settings feed.
- SRV-10's remainder: HK Frontend's art fetch inside Home Assistant has the range checks but not the address pin.
- SRV-12b: a restore could ask the Owner before it brings Allow Control of the House back on.
- DOC-15: whether the apps' TestFlight is open is the owner's to say.
- MED-15: photo files with no row are left (a restore can bring rows and files of different times).
- Not built: Mute 1 Hour on the iOS app's notifications (the dead button was removed).
- Releases: Mantel's server, Mantel Link (0.1.9) and HK Frontend (1.34.0) all changed; nothing here was released to
  the house or tagged.
