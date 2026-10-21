# Removing HK Frontend from a house (decision 28, step 4 of the move)

> **Decision 29 (2026-10-21, docs/phase9/TWO-PRODUCTS.md):** HK Frontend stays a product. Removing it from a house is
> a choice, not the plan; this page lists what a house needs if it makes that choice.

**Status (2026-10-20): built on branch `claude/no-hk-frontend-73dad8`, not merged; nothing on the house.**

Avery: "We shouldn't be relying on anything from HK Frontend with Mantel."

This is the list of everything Mantel still needed from HK Frontend in Home Assistant, and what replaced each one. A
house can remove HK Frontend once every row is ticked **for that house** (the "Needs" column says what the house must
have). It extends docs/phase9/MANTEL-LINK.md "Parity", which lists the features; this lists the wires.

## What was built

**1. The house's own entities on Mantel Link.** Seasonal decorations, the Alarm PIN panel, and Live TV's viewers,
now-on sensors and channel cameras were HK Frontend's own entities while `house` was Home Assistant's. Moving `house`
to Mantel (Mantel Settings → Home Assistant Link) makes Mantel publish them and Mantel Link take HK Frontend's
registry entries over: the same entity ids, unique ids and history (proved on the scratch HA, below).
- Mantel now learns HK Frontend's house entities **read-only while HA still runs the house** (`LinkedHouse.observe`).
  HK Frontend's Alarm PIN panel says which alarm it protects only while HK Frontend shows it, and it unloads the
  panel the moment `house` moves; learning it only then left the panel unpublished (found on the scratch HA).
- Reversible: `house` back to Home Assistant hands the same entries back to HK Frontend. **Once HK Frontend is gone**,
  Mantel refuses to move a tablet or `house` back (`no_hk_frontend`): nothing in HA would run it.
- Mantel Link answers the `hk_frontend.*` actions **as soon as HK Frontend's entry is deleted**. HK Frontend registers
  its actions once, when HA loads it, so they linger until HA restarts with nothing behind them ("No pop-up
  #doorbell"); Mantel Link now takes those names over (found on the scratch HA).

**2. The Alarm PIN keypad, Mantel's own.**
- Mantel publishes one Alarm PIN panel for **each keypad in its own table** (`alarm_pins`). A panel HK Frontend had
  keeps its unique id, so its entity id survives the registry hand-over; a keypad made in Mantel gets
  `<entry>_alarm_pin_<object id>` and its entity id suggested. A row that is the alarm itself is never a panel, and a
  panel another integration has in HA is never published over it.
- Its arm/disarm go to `alarm_pin.linked_command` (Mantel's gateway: RBAC, the house Alarm PIN, the lockout, the
  audit row first).
- HK Settings' Alarm PIN page (`hk_alarm_pin/settings/get`, `/settings/set`, `/add`, `/remove`) is answered from
  Mantel's table, commands on or off. **Nothing about the PIN goes to HA** once Mantel owns `house` (or HA has no HK
  Frontend). A PIN removed there stays removed (the panel learned from HA's registry makes its row once only).
- Until then 8d48e95's way is kept (`alarm_pin.hk_runs_keypads`): HK Frontend's own panel checks its own PIN, so the
  save goes to HA first (through the gateway, as the person) and is then copied into Mantel's table.

**3. HK's remaining settings, in Mantel.** Every save the page made to HK Frontend is now a Mantel save (settings_store
`SETTINGS_SAVES` / `FEATURE_SAVES`, RBAC `configure`, a new version with who and why, the feed sent again):
accessories, favorites, Hidden Accessories, Music's settings, Live TV's quality, Wall Tablets' Add/Remove. `NOT_YET` is
only `hk_notify/mute` (the page sends it as Mantel's own `notify_mute`). The one-time import from HA still works for a
house that has HK Frontend (it is the only thing that reads HK Frontend's settings).

**Also found and built** (the audit of every wire, beyond the brief): the doorbell's talk-back and the Energy plan's
helper read (now in Mantel Link), the Wall Tablets buttons, the page's "paused until" feed, and the Lights page's
"Tonight" list (which Mantel's screens never had: Mantel Link works it out now).

## The checklist

Legend: ✅ Mantel or Mantel Link answers it, tested. ⚠️ answered only when the house meets "Needs" (the house does).
➖ never reached HA (not a dependency), noted.

### Settings saves and pages (HK Settings)

| | What the page sends | Before | Now | Needs | Test |
|---|---|---|---|---|---|
| ✅ | `hk_frontend/accessory/set` `order` `into` `page_order` `room_scenes` | HK Frontend's `.storage` (gateway, commands on) | `house/accessories` (accessories.py, a port of HK's checks) | – | `test_accessory_saves.py` |
| ✅ | `hk_frontend/board/favorite` | HK's dashboard item | the board document | – | `test_accessory_saves.py` |
| ✅ | `hk_frontend/hidden/set`, `hidden/also` | HK's options + accessories | `house/settings` + `house/accessories` in one transaction (hidden.py `plan`, `also_plan`) | the hub's copy of HA's registries | `test_accessory_saves.py` |
| ✅ | `hk_music/settings/set` `preset/save` `playlist/save` `playlists/order` `item/remove` | HA unless Mantel's music engine was on | `house/music` (music.py `settings_write`), Music Assistant or not | – | `test_feature_pages.py::test_music_page_is_mantels_and_imports_hks_once` |
| ✅ | `hk_music/settings/get` | interim HA read while the engine was off | `house/music`; HK's imported **once** when missing | – | same |
| ✅ | `hk_tv/settings/set` `quality` | refused ("still set in HA") | the `live_tv` piece; live_tv.py's transcode reads it | – | `test_feature_pages.py::test_live_tv_page_and_save` |
| ✅ | `hk_alarm_pin/settings/get` `settings/set` `add` `remove` | HA (gateway) + 8d48e95's copy | Mantel's `alarm_pins` table | `house` Mantel's (else 8d48e95's way, kept) | `test_alarm_pin_page.py` (5), the scratch HA |
| ✅ | `hk_frontend/tablet/add`, `tablet/remove` | an HA config-entry item | a `tablet/<id>` document (removal keeps its history) | – | `test_tablet_buttons.py` |
| ✅ | `hk_frontend/tablet/act` wake, sleep, kiosk_saver | HK Frontend's engines (gateway) | Mantel's `tablet_act`: its Sleep Screen engine; the kiosk app's settings through the gateway as the person | Mantel's `sleep` piece runs the tablet | `test_tablet_buttons.py`, `test_shim_features.py` |
| ✅ | `hk_frontend/tablet/act` restart_all | – | Mantel's `tablets_restart` (since phase 8) | `tablets` piece on | `test_feature_ports.py` |
| ✅ | `hk_frontend/tablet/seen` | a suggestion in HK | answered by the page (Mantel enrols tablets itself) | – | `test_shim_features.py` |
| ✅ | `hk_frontend/dashboard/titled` | follows an HA dashboard's title | the board's own title | – | `test_tablet_buttons.py` |
| ✅ | settings/set, board/set, tablet/set, setup/done, calendar/color, chip/* | – | Mantel's store (since P3.5) | – | `test_settings_store.py` |
| ✅ | Notifications, Clean Areas, Energy, Live TV pages | – | Mantel's feature pages (phase 4) | – | `test_feature_pages.py` |

### Feature engines and reads

| | What | Before | Now | Needs | Test |
|---|---|---|---|---|---|
| ✅ | Doorbell talk-back clip `POST /api/hk_frontend/talk` | HK's talk view | Mantel Link's `/api/mantel/talk` (talk.py, ported); HK's only on a 404 | Mantel Link 0.1.2; commands on | Mantel Link `test_talk.py`; `test_gateway_talk.py`; the scratch HA (a clip played on a demo speaker) |
| ✅ | Live talk `hk_frontend/talk/live` | HK's talk_live.py | Mantel Link's `mantel/talk/live` (ported); HK's only on `unknown_command` | Mantel Link 0.1.2; commands on | Mantel Link `test_talk_live.py`; `test_talk_live.py` (+2); the scratch HA |
| ✅ | Energy plan's helper sources `hk_energy/sources` | HK's read | Mantel Link's `mantel/energy/sources`; HK's as the fallback | Mantel Link 0.1.2 | Mantel Link `test_energy.py`; `test_features.py` (+1) |
| ✅ | "Paused until" feed `hk_frontend/snooze/subscribe` | never served (a dev fixture) | Mantel's snooze record, only automations the person may view | – | `test_house_without_hk.py` |
| ✅ | The Lights page's "Tonight" list `hk_frontend/page_headers/subscribe` | never served on Mantel (HK Frontend worked it out in HA) | Mantel Link's `mantel/page_headers/get` (page_headers.py, ported), read by Mantel and sent to each screen with only the lights that person may view; read again every minute and when an automation switches | Mantel Link 0.1.2 | Mantel Link `test_page_headers.py`; `test_page_headers.py`; the scratch HA (a fictional sunset automation) |
| ⚠️ | `hk_frontend.clean_areas`, `pause_automation`, `resume_automation` from a page | HA's `hk_frontend` | Mantel's engines directly (linked_actions, 9.8) | Mantel Link holds the bridge (the house: yes) | `test_linked_actions_direct.py` |
| ⚠️ | `hk_frontend.music_*` from a page; `hk_music/subscribe`, `/queue`, `/settings/library`, `queue_play` | HA's engine and reads | Mantel's music engine (music.py) | Music Assistant configured in Mantel (the house: yes) | `test_music.py` |
| ⚠️ | `hk_tv/channels`; `hk_tv/watching` | HA's Live TV | Mantel's Live TV (live_tv.py): its own go2rtc (Docker/LXC), or **through Mantel Link's transcode** in the HA App (2026-10-20: the house, which runs the HA App, had NO Live TV once HK Frontend was removed, since this row assumed a go2rtc it does not have) | the house Mantel's; Mantel Link 0.1.3 | `test_live_tv.py`; Mantel Link `test_tv.py`; the scratch HA (`mantel_link_e2e.py --phase livetv`) |
| ✅ | Sleep Screen, notifications (+ phones), pop-ups, energy, tablets watch | HK's engines | Mantel's (phases 4, 8, 9.7) | each piece on | docs/phase4/FEATURE-PARITY.md |

### Home Assistant's side

| | What | Now | Test |
|---|---|---|---|
| ✅ | Seasonal decorations, the Alarm PIN panel, Live TV's entities | Mantel's, mirrored by Mantel Link; same ids through the registry hand-over, reversible while HK Frontend is there | `test_house_without_hk.py`, `test_linked_owners.py`, the scratch HA |
| ✅ | the wall tablets' four entities each | Mantel Link (9.3; the house since 2026-10-20) | Mantel Link `test_handover_hk.py`, the scratch HA |
| ✅ | `hk_frontend.*` actions in automations and scripts | Mantel Link's aliases, from the moment HK Frontend's entry is deleted | Mantel Link `test_mirror.py`; the scratch HA (an automation and a script) |
| ✅ | moving anything back with HK Frontend gone | refused in words (`no_hk_frontend`) | `test_house_without_hk.py`, the scratch HA |

### Reads of HK Frontend that stay, on purpose

- The **one-time imports** (`hk_frontend/panel/get`, each feature's `settings/get`, `hk_music/settings/get`,
  `hk_alarm_pin/settings/get` for `POST /api/alarm/pins/import`): only for a house that still has HK Frontend, on an
  Owner's request (or Music's page finding no `house/music`). Without HK Frontend they fail with Home Assistant's own
  error and change nothing.
- The **8d48e95 path** for the Alarm PIN page while HK Frontend runs the keypads.

### Goes with HK Frontend, on purpose

- ➖ HK Frontend's own Lovelace dashboards and its HK Settings panel inside HA (decision 28).

## Proof on the scratch HA

`tools/e2e/mantel_link_e2e.py --phase house` (HK Frontend's build from this tree, Mantel Link, a fictional Mantel in
process with commands off; `testha.py` now loads the automation and script editors' files): **45/45**. HK Frontend's
Alarm PIN keypad in front of the demo alarm (a random fictional PIN); the bridge handed over; `house` moved to Mantel:
the Seasonal switch and the keypad are Mantel Link's with the same registry entries, entity ids and unique ids;
Mantel's table got the keypad row; the page set the PIN in Mantel only; HA's keypad panel refuses a wrong code with
Mantel's "Wrong code" and passes the right one to Mantel's gateway, which sends nothing; Seasonal decorations from HA is
Mantel's setting; `house` back to HK Frontend (the same entries) and to Mantel again; **HK Frontend's entry deleted**:
every entity lives on, Mantel Link answers `hk_frontend.*`, an automation's `hk_frontend.show_popup` and a script's
`hk_frontend.set_black_screen` reach Mantel, Mantel Link's talk view plays a clip on a demo speaker,
`mantel/talk/live` and `mantel/energy/sources` answer, a fictional sunset automation reaches a Mantel screen as the
Lights page's Tonight list; moving `house` back is refused; HA's history of the Seasonal
switch runs on across every move. The other phases still pass: alone 27/27, handover 22/22, actions 11/11; HK's
`linked_e2e.py` 23/23.

## The house, in order (each step Avery's, an HA backup before each)

1. **App update** carrying this branch (the next `HA-APP` version). Nothing moves by itself: `house` stays HA's, so
   the Alarm PIN page keeps 8d48e95's way. Check: Mantel Settings → Alarm PIN shows the keypad; Accessories and Music
   saves work; Mantel's log has no `linked house: learning ... failed`.
2. **Mantel Link 0.1.2** copied to `/Volumes/config/custom_components/mantel/` (its publish build; `rsync -a
   --inplace --exclude __pycache__`, never `--delete`; `diff -rq` empty), then restart HA. While HK Frontend is
   installed nothing changes; its talk view and `mantel/energy/sources` are there.
3. **The house hand-over**: Mantel Settings → Connections → Home Assistant Link → the rest of the house (Seasonal
   decorations, Alarm PIN, Live TV) → Mantel. Check in HA: those entities are Mantel Link's, same entity ids, live;
   the keypad's history continues.
4. **Re-enter the Alarm PIN** in Mantel Settings → Alarm PIN → Change PIN (HA never gives its PIN out). From now on it
   is kept only in Mantel. Check at a tablet that the keypad says "Wrong code" for a wrong PIN (no command needed).
5. **Remove HK Frontend**, a full HA backup first: Settings → Devices & Services → HK Frontend → Delete; HACS →
   uninstall HK Frontend; restart HA. Check: the house's automations that call `hk_frontend.*` still run (the doorbell
   pop-up, the sleep scripts), and the entities keep their ids. Rollback: restore the backup, or reinstall HK
   Frontend 1.9.0, link it, then move `house` back.
