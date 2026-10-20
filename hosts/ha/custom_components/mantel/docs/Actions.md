# Actions

Every action is also available under its HK Frontend name (`hk_frontend.<action>`) while HK Frontend isn't installed
(from the moment its entry is deleted), so automations and scripts written for HK Frontend keep working. Mantel checks every call and answers; a refusal is
the action's error, in words.

| Action | Fields | What it does |
|---|---|---|
| `mantel.set_black_screen` | target: a tablet's black-screen switch; `black`, `brightness` (0-255) | The tablet's black screen on or off, and the brightness it comes back to. The switch's `confirmed` turns true when the screen has gone black. |
| `mantel.show_popup` | `popup`; `dashboards`, `users` (optional) | Opens one of Mantel's pop-ups on its screens (all, or those named). |
| `mantel.close_popup` | the same | Closes it. |
| `mantel.notify` | `title`, `message`, `important`, `wake`, `stay`, `icon`, `entity`, `camera`, `tap`, `page`, `dashboards`, `users` | A banner on Mantel's screens, and on the phones of the people it is for. Answers `{id}`. |
| `mantel.music_play` | `rooms`, `playlist` | Mantel's music: plays a playlist in those rooms. Answers. |
| `mantel.music_transfer` | `rooms`, `source` | Moves what one player plays to the rooms. |
| `mantel.music_stop` | `rooms` (optional) | Stops the music there, or everywhere. |
| `mantel.music_transport` | `player`, `command`, `level` | Play/pause, next, previous, stop, volume. |
| `mantel.music_play_media` | `player`, `media_content_id`, `media_content_type` | Plays one item. |
| `mantel.clean_areas` | `areas`, `dry_run` | Mantel's Clean Areas: sends the vacuums that reach those areas. A dry run answers the plan only. |
| `mantel.pause_automation` | `entity_id`, `until` (optional) | Turns an automation off until a time (default: midnight), then on again. |
| `mantel.resume_automation` | `entity_id` | Turns it on again now. |

Music needs Mantel's music (Music Assistant connected in Mantel). Clean Areas, music and the automation snooze send
commands to your home through Mantel, so they need Mantel's house commands on; with them off, Mantel refuses and sends
nothing.
