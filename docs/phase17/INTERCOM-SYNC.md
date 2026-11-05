# Intercom: rooms in step, and music players that ignore it

A plan for one session (2026-11-05, the owner's asks after 0.1.128). It builds on phase 17
([INTERCOM.md](INTERCOM.md)); read its "What MA does" table and the group check (`hk_core/intercom/rooms.py`) first.
Two parts, each a release of its own: **A** (the music players ignore the Intercom) is small and ships first; **B**
(rooms in step) needs a listening test with the owner.

## Where things stand

- Mantel 0.1.128 on the house. A Message to several rooms works and is heard. Rooms on Automatic play at the
  Intercom's own Volume (40), a Message sends when the recording stops, Live is push to talk.
- **Not in step.** `driver.announce` makes one `players/cmd/play_announcement` call per room, all at once. An idle
  HomePod takes MA's fallback path (stop, set the volume, `play_media` of MA's own `/announcement/<player>` stream,
  restore). Each room opens its own AirPlay session and starts when it's ready, so the rooms are a fraction of a
  second to a second apart. Rooms that were **playing** take AirPlay's native path, which arms one shared audible
  instant, so they are already in step with each other.
- AirPlay on the house: every HomePod's streaming mode is `auto`. The log says "AirPlay 2 (native, PTP)". cliairplay
  is os27fix5 through the ma-airplay-groups add-on 0.2.2 (the shared PTP clock fix; a dead member no longer fails a
  group start, unless it's the group's leader). **Nothing here changes cliairplay or the add-on.** Part B only uses
  MA's ordinary group commands.
- The music players already hide **Home Assistant's** announcements: `hosts/server/mantel_server/music_announcements.py`
  (display-only markers from HA's service events, behind the music setting `ignore_announcements`) and
  `hk_core/music/announcements.py`. The Intercom's announcements don't go through HA, so they aren't hidden.

## A. The music players ignore the Intercom

**What the owner sees today:** during a message, the Music card, the Side Pane, the slide-up player, the screensaver
and the iOS app show the room as playing something (MA's announcement, or the last song for a moment), and the
progress and cover jump. Afterward the room goes back.

**What it should do:** while a room's speaker plays an Intercom message, every music surface shows that room as it
was before the message (what was playing, paused or idle, its volume), as it already does for HA's announcements.
Never hidden: the Intercom sheet itself, and the room's state for the engine's own waits.

**How:**
1. Mantel knows exactly which players a broadcast plays on and when it ends: `IntercomHost._broadcast` and
   `_live_calls` (the plan's calls, their `covers`, and the driver's outcome). Give `Announcements` (the existing
   class) a way in that isn't an HA service event, for example `mark(players, key)` / `clear(key)`. Call it before
   the first `play_announcement` and clear it when the driver's call returns (each room on its own result), with the
   same `MAX_SECONDS` backstop.
2. Mark by **Music Assistant player id → entity** (`pids`, reversed), and include `covers` (members a leader's call
   plays on). With part B, mark every member of the temporary group.
3. Use the same `ignore_announcements` setting, or always hide the Intercom: decide with the owner. I'd recommend
   always, since an Intercom message is never music.
4. `music_states.py` builds the speaker states from MA events. Check that the "before" snapshot is taken from the
   state just before the mark, not after MA's first `player_updated` (that one already shows the announcement).
5. Tests: the existing announcement tests (`tests/test_music_announcements*.py`, find them with `rg -l Announcements
   tests`) plus one where an Intercom broadcast to two rooms leaves both rooms' states as they were, and one where
   a failed room is cleared at once.

## B. Rooms in step (Messages)

**What the owner wants:** every room hears a Message at the same moment.

**How:** play it the way grouped music plays: one group, one clock.
1. **The plan** (`rooms.decide`): after the group check, split the calls into the rooms that are **idle** (and not a
   group player, not a stereo pair's part already grouped) and the rest. Two or more idle rooms make a **sync
   set**; the rest keep one call each (playing rooms are already in step on the native path).
2. **The group** (a new step in `driver.announce`, or `host._broadcast`): pick a leader from the sync set (a
   speaker that is available and was in the group check's reach of nothing; prefer the one that answered last
   `players/all` most recently), join the others to it (`players/cmd/group_many`, or what MA 2.10.9 offers: read
   `music_assistant/controllers/players` at tag 2.10.9 before coding), wait for MA to report the members
   (`group_members`), announce **once** to the leader, then ungroup and confirm each member is back on its own. The
   whole-house case can use the house's existing sync group player "HomePods" (`syncgroup_8s5dwtlo`) when every one
   of its members is picked, with no join at all.
3. **The gate**: `IntercomRun.allow` lets only `play_announcement` through today. Allow exactly the join and ungroup
   commands for the plan's own players, during this run, and nothing else.
4. **Fallback, always**: if the join doesn't settle in a few seconds, or the leader is unavailable, or the group's
   announcement fails before audio, ungroup and send one call per room as today. A message must never be lost to
   the group step. Say nothing on the sheet unless rooms failed.
5. **Restore**: put every speaker back exactly as it was (its group, volume, power). A speaker that was in a music
   group before can't be in the sync set (the group check already keeps such leaders out; check followers too).
6. **Live**: leave it per room for now. A group would add its own start-up delay to the 7 s. (Measured, it doesn't, and the
   owner wants Live in step: part C.)
7. **The group check stays**: the temporary group is Mantel's own, made from rooms all in the broadcast, so no room
   outside it can hear the message.
8. **Sound rules for a session's own tests.** The owner picks rooms; a session's own tests use the Kitchen and Guest Room
   HomePods only, 09:00-19:00, volume at most 25 (`~/.config/mantel/intercom-never` lists the never-touch player).
   Tell the owner before any sound.

**Tests:** the plan's split (idle vs playing, pairs, group players, a leader that leads others); the driver with a
fake MA (join, settle, one announcement, ungroup, in that order; the fallback on a join that never settles, on a dead
leader, on a failed announcement; restore after each); the gate refusing any other command.

**Proof on the house:** quiet first (volume 2, then read MA's `logging/get` for "PTP clock" warnings; the
2026-11-04 script `ptp_run.py` is in the shared session notes), then the owner listens at two rooms at once, then three. Record what was heard in the
Build log below.

## C. Live in step (added 2026-11-05)

**What the owner wants:** Live in step too ("It should be"). The rooms that are live now play as one temporary group, called
once through its leader, with the same rules as part B. What differs from a Message:

1. **The stream is still growing, and it can stop any time.** The group parts only when the talk is over. Music Assistant
   holds a part until the announcement has finished, about 8 s after its stream ends, so a stopped talk waits for that
   answer in the background (`driver.settle`). The socket isn't held up. The next broadcast, such as the page's own copy
   after a dropped socket, is decided only once the speakers are back (`host._parted`).
2. **The gate:** a closed run still lets its own group part (`IntercomRun.formed`), and nothing else.
3. **A group that doesn't come together** means one live call per room on the same link, since nothing has read it. The
   watches for the failure signals start when a room's call really starts, not when the group step began.
4. **A leader that fails takes its members with it:** every room gets the whole spool as a Message at the end, and only the
   leader's Live health counts it (`group_failed`). A member that never plays gets the Message alone.
5. **The Message at the end plays in step too:** the rooms that hear it (playing music aside) make their own groups, through
   the same `D.broadcast`, from a fresh plan.
6. **A speaker that can't be confirmed on its own after a failed group isn't called** (Message and Live,
   `driver.on_their_own`): one that still leads somebody would carry the message to them. A Message reports its room failed;
   in Live the group check decides it again at the end. This closed a gap part B had.

## D. A group left from music (added 2026-11-05)

**What the owner saw:** after whole-house music stopped, every HomePod stayed grouped under the Master Bedroom. The sheet
showed "Master Bedroom: Plays with <a bedroom> +7" with those rooms unpicked, a Message to all nine said "Sent to 2 rooms",
and the one room not in that group played on its own, not in step with the rest.

1. **Borrow it** (`rooms.leftovers`, `Plan.loose`): when a picked room leads an ad-hoc group that is all idle (no group player
   in it, nobody holding paused music, every room the sender's), and either not every one of its rooms is picked or other
   rooms are too, the plan is decided as if its speakers were apart. The whole group and nothing else still plays through
   its leader, as it stands. A group playing or paused is never borrowed: the "plays only together" rule stays for it.
2. **The host takes it apart first and gives it back after** (`driver.borrow`, `give_back`): the leader's list must be what
   the plan saw, then `set_members` removes the members, checked; a group that changed, or doesn't come apart, keeps its
   leader's call from being made (it would play on all of it). After the broadcast, every member still idle and alone goes
   back with `group_many`, in its order (even after the run closes; the gate allows exactly those speakers). A stopped Live
   talk gives it back in the background, after its own temporary groups have parted.
3. **The music players leave the borrowed speakers as they were** while they're out of their group.
4. **"Sent to" counts rooms reached**: a leader's call counts its members' rooms.
5. **Live's second group check never borrows** (`decide(borrow=False)`): it can't take a group apart at that point.

Two more from the owner's tries the same afternoon:

- **A room whose Live failed was shown again before its Message**, and the Message then skipped hiding it because it read
  "playing" (Live's own sound): the card said "Now Playing" during the message. It now stays out until the Message has
  played. Each room that fails Live logs which signal (`didn't play live (<signal>)`), never what was said.
- **Audio dropped in a burst**: 48 frames (about 2 s) of a Message at 18:05Z. The page paces itself, but Wi-Fi can hold a few
  seconds back and deliver them at once, and the relay allowed 1 s. It now allows 4 s at once (`relay.BURST_S`), with the
  same cap over time, and the log says how far in the first drop was.

## Docs and release

- `docs/guide/Intercom.md`: say rooms hear a Message in step, and that the music players don't show it.
- CHANGELOG under Unreleased; full checks from local disk (`CI from local disk` memory), push to main, then
  `tools/release_house.py mantel X.Y.Z --from-origin`.

## Build log

**2026-11-05, part A, Mantel 0.1.130 (on the house).** `Announcements.mark` / `unmark`, a list of their own that reaches
the feed as `intercom`. The open choice went to the recommendation: the Intercom is hidden whatever Ignore Announcements
says. One change from the plan: **a room playing music isn't marked.** Music Assistant mixes the message into it, its song
and cover don't change, and a marked room would leave Now Playing while its music goes on. Known limits: a playing room's
volume slider can move while the message plays (Music Assistant raises the volume around the clip), and a room that was
paused or held leaves Now Playing for the length of the message and comes back, as it does for Home Assistant's
announcements.

**2026-11-05, part B, Mantel 0.1.131 (on the house).** `rooms.sync_sets`, `driver.in_step`, the gate. What the real Music Assistant 2.10.9 changed:

- **`players/cmd/ungroup_many` doesn't part a group reliably.** It goes by each member's `synced_to`, a derived field. On
  the house it left 7 of 9 speakers grouped. Part uses `players/cmd/set_members` with `player_ids_to_remove` on the leader,
  a new catalog entry whose list the gateway's RBAC checks: 9 speakers in 10 ms, all three times.
  **A test of `ungroup_many` also damaged the house, and was repaired the same morning.** For a speaker whose `synced_to`
  is still empty, Music Assistant's `cmd_ungroup` falls through to "remove it from the first group listing it", and that
  was the house's sync groups: HomePods' live list went from 11 to 2, Downstairs' from 6 to 5 (08:33-08:36). Their saved
  settings weren't touched. Restored at 09:27 with `set_members`, in the original order, checked; nothing plays when an
  idle sync group's list changes. The release never used `ungroup_many`. Afterward, three silent joins and parts of 9
  speakers through the real driver left all three lists exactly as they were.
- **`synced_to` lags.** It's refreshed on a 2 s debounce, one member at a time (the fourth member's after 8 s). The leader's
  `group_members` is right at once and is the list AirPlay plays from, so "together" reads that list. Joining 9 speakers
  takes 10 ms, not the plan's "few seconds".
- **No "HomePods" shortcut.** The plan offered the house's sync group player for the whole house, to skip the join. The
  join costs nothing, so the one path stays.
- **A group has one announcement volume** (`_prepare_for_announcement` gives every member the same override), so rooms at
  different volumes make separate groups, which aren't in step with each other.
- **A speaker that's off stays out** (joining turns it on, and nothing would turn it off). A room holding paused music
  stays out too. HomePods have no power control and always read on.
- **Music Assistant announces at 15 or more** (`CONF_ENTRY_ANNOUNCE_VOLUME_MIN`), so a test at "volume 2" is at 15.

**Proof on the house, quiet** (the real driver and gate, from a script; a 3 s tone, Kitchen and Guest Room, 09:00-09:04):

| Run | Log | Reads "playing" (s after the call), Kitchen / Guest | Back as it was |
|---|---|---|---|
| Group x5 | One `AirPlay group ...: UGL-RC server ... for Guest Bedroom HomePod, Kitchen HomePod`, no clock warning | 3.69 / 3.69, 3.59 / 3.80, 3.78 / 4.09, 3.78 / 3.99, 3.69 / 4.00 | Yes |
| Group, chime | Same | 4.10 / 4.30 | Yes |
| One call per room (before) | Two announcements, two sessions | 3.90 / 3.70 | Yes |

A group starts as fast as one room, so the plan's reason to leave Live per room (a group adding to its 7 s) doesn't hold.
**Not proven: what the ear hears.** "Playing" is when each speaker reports it, not when sound leaves it. The owner's
listening test at two rooms at once is still to do. The fallback's failures (a dead leader, a stream that never starts)
were tested on the fake only: a real dead speaker can't be arranged from here.

**2026-11-05, part C (Live in step).** Quiet proof with **digital silence** at Music Assistant's floor of 15, Kitchen and
Guest Room, 12:17-12:42, on an open-ended WAV filling in real time from a temporary server on the LXC (removed afterward):

| Run | Reads "playing" (s after the call), Kitchen / Guest | Log | Back as it was, sync groups' lists unchanged |
|---|---|---|---|
| Group, the real `host._live_calls` x4 (8-10 s) | 5.18 / 5.18, 5.30 / 5.52, 5.17 / 5.17, 5.12 / 5.33 | One `UGL-RC` group each, no clock warning | Yes |
| Group, driver steps x3 (8-12 s) | 4.89 / 4.89, 5.07 / 5.28, 4.96 / 5.18 | Same | Yes |
| Group, 45 s (past Music Assistant's 30 s render wait, which it logs and survives, as in slice 0) | 5.39 / 5.39 | Same | Yes |
| Group, stopped at 2, 9 and 10 s | About 5 / 5 where it had started | Same | Yes, about 8 s after the stream ended |
| One call per room x4 (8-12 s) | 5.21 / 3.22, 5.20 / 5.09, 5.20 / 5.10, 5.21 / 5.11 | Two sessions | Yes |

Removing a speaker that never joined (`set_members` on the house, silent) leaves the sync groups' lists alone, unlike
`ungroup_many`. Mantel sends no part unless it sent a join.

A group starts when one room does, about 5 s after the call, one fetch of the link, and the talk ends about 8 s after the
stream either way, so grouping adds nothing to Live's delay. **These numbers don't show the gain by themselves:** "playing" is
what each speaker reports, and per-room runs often read only 0.1 s apart (once 2 s). What changed is that a group is one
AirPlay session on one clock. **Not proven: what the ear hears**; the owner's test is the proof. A real socket's whole run
wasn't exercised on the house (it needs an Owner's session); the socket's paths ran on the fakes
(`tests/test_intercom_live_sync.py`), and a dead speaker can't be arranged from here.

**2026-11-05, Live to a group left from music.** The owner's first Live on 0.1.132 played nothing, twice: whole-house music had
just stopped, leaving 11 speakers grouped under the Master Bedroom. The plan made them all "after", and the second group
check at the end was given only the rooms that had calls, the leader's, so its members looked like outsiders, and it left the
room out (`error:nothing_played`). This was there before 0.1.132; Live with a grouped room had never been run on the house.
Now the check also gets the rooms a call covers. And an idle ad-hoc group whose speakers can all be live **is** live, through
its leader, without joining or parting: to Music Assistant that's the state a temporary group is in once joined, which part
C's proof covered. A group with a group player in it stays "after": it's another path, never tried live. **Not proven on the
house before release:** the speakers were in use by the owner, and the whole-house group includes a room sessions never touch.

**2026-11-05, part D.** Silent on the house, 14:48: the real `borrow` and `give_back` on the owner's leftover group (the Master
Bedroom leading 9 HomePods): apart in 0.01 s, back in 0.01 s in the same order, the three sync groups' lists unchanged.
Nothing was played; a message through a borrowed group ran on the fakes only (`tests/test_intercom_borrow.py`). **Live on
the house is not proven:** the owner's 14:41 talk to nine rooms through the leftover group was judged failed at the end and
replayed as a Message; why isn't known (the signal wasn't logged before this release).

**2026-11-05, 0.1.134 broke it on the house.** The owner's Message, Message and Live to nine rooms at 15:41-15:42 played in
two: the Master Bedroom and the one room outside its group. `rooms.apart` cleared `group_members` only, but Music Assistant
also lists a group in `group_childs`, which `ma_view` reads, so the plan still had the Master Bedroom's call "cover" the eight
speakers the host had just taken out of its group, and called none of them. The sheet's "Plays with" came from the same
miss. The house's own list, read after: the Master Bedroom's reach was 10 speakers before borrowing, still 10 with 0.1.134,
1 with the fix. The tests' fake now lists `group_childs` as Music Assistant does, which makes five of the borrow tests fail on
0.1.134. Lesson: the fake must carry every field the code reads.

Known limit: if Mantel itself stops in the seconds a group is formed, the speakers stay grouped until Music Assistant
restarts or someone ungroups them (the sheet then says the leader "leads" the other).
