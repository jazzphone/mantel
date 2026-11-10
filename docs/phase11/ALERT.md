# Alert

A Home Grid card (`alert`) for one thing that needs a look, made to be a **Show When** rule's card: while the rule
holds it fills the block's own place, and when the rule stops holding the block's own card (House Status, say) comes
back. Added 2026-11-10. Code: `web/hk/cards/hk-alert.js` (the card, `hk-grid-alert-card`, and its pure layout),
`hk-grid-catalog.js` (`alert`, its editor rows and the card list's preview), `hk_core/settings/home_grid.py` (what a saved
layout and the assistant may write).

## What it shows

- **A headline**, upper left: the block's own words ("Garage Still Open"). Without one, the accessory and its state
  ("Garage Door Open"), else "Alert".
- **A line under it**: its own words ("Cycle complete"), and how long, when **Time Since** names an accessory. The time
  is that accessory's `last_changed`, the moment it came into the state it is in. For a cover, that is when it became
  open. A state that is a condition reads "Open for 23 min" or "Unlocked for 9 min"; any other reads "12 min ago". It
  moves on each minute. With no telling (unavailable, unknown), the line has only its words. A Home Assistant restart
  starts `last_changed` again, so the count starts over from the restart.
- **A camera's still**, where one is named and the camera has a picture to give. A tap on it opens the camera's own
  sheet, live. A camera that is missing, unavailable or has no `entity_picture` is no picture, and the block is drawn
  as the words and the action alone. Both still work.
- **One action**: the accessory's own tile tap, through the same path the tile takes (`HkBase._act`). A door, a lock,
  the alarm, a valve or the heat is never one tap (`neverToggles`), so the action opens that accessory's own controls,
  where it asks first. A light toggles, a button presses, and a confirmation the tile has is asked. Its words say what
  you are there to do: Close, Open, Lock, Unlock, Turn On, Turn Off, Run. Large and Extra Large also use the name:
  "Close Garage Door". Someone who may not see the accessory is sent the layout without it (`only_viewable`), so the
  block shows no action. The same goes for the camera and the time.
- **Its glyph and color**: the glyph named, else the accessory's own state glyph, on a disc in the color (one of the
  named accents; orange unless chosen).

## Sizes

Nothing stretches. The words keep their sizes and lines. The action is a pill: 40 px on Wide (the standard pill's),
44 on Tall, 48 on Large and Extra Large. The room left goes to the one element made to be big, the picture. The
heights are fixed per size, so the picture's size is known before it draws (`hkAlert.lib.plan`).

| Size | With a picture | Without |
| --- | --- | --- |
| Small | The still to the block's corners, the words on a scrim at its foot | The disc, the headline at the foot |
| Wide | The still at the left (4:3, at most half the width), the words and the pill beside it | The disc beside the words, the pill under them |
| Tall | **Stacked**: the disc and the headline, the line, the still (square at most), the pill at the foot | The words, larger, over the pill |
| Large | The disc beside the headline, the still the block's width (between 16:9 and 4:3 on square cells), the pill the block's width | The words, larger, over the pill |
| Extra Large | The still at the left (up to 62 % of the width), the words and the pill in a column beside it | A large headline over the pill |

On a square cell (196 × 196), Tall's still is 160 × 160 and Large's is 369 × 220. On a tile cell (196 × 150), Tall's is
168 × 94, and Large keeps its headline to one line so its still is 374 × 161. A block too short for a picture worth
showing (under 64 px) draws without one.

Small has no pill: the plate is its action, and tapping it does the accessory's tap. On the other sizes, a tap on the
plate (anywhere that is not the action or the picture) opens the accessory's sheet, else the camera's, else the sheet of
the one it counts from.

## Show When

The block's own card is its default. Each rule, in order, says when its card shows, and the first rule that holds wins
(`hkGridCatalog.choose`). The Alert is a rule's card like any other, so the order is the rules' order and never the
newest alert. Whatever condition clears a rule (the state changes back, a push of the house), the next rule that holds
shows, else the block's own card. That is the conditional block's work (`hk-grid-conditional-card`, hk-layout.js).

In the editor, select the block, **Add Rule**, set its condition, then **Change Card…** → **Alert**. Its settings are
**Headline**, **Supporting Text**, **Time Since**, **Camera Snapshot**, **Action**, **Color** and **Glyph**. **Preview**
shows the rule's card without saving it. The card list's preview is an open garage door with its camera, where the house
has them.

## Examples

The house's two, on its House Status blocks: Tall on the Kitchen HomeView, Large on the others. Both go after the water
alert, so a running water alert still comes first:

```json
{"when": {"all": [{"kind": "entity_state", "entity": "binary_sensor.garage_door_open_too_long", "state": "on"}]},
 "card": "alert",
 "opts": {"title": "Garage Still Open", "since": "cover.garage_door",
          "camera": "camera.garage_camera_low_resolution_channel", "control": "cover.garage_door",
          "icon": "hk:garage-open", "color": "teal"}}
```

```json
{"when": {"all": [{"kind": "entity_state", "entity": "sensor.washer_job_state", "state": "finish"}]},
 "card": "alert",
 "opts": {"title": "Laundry Ready", "text": "Cycle complete", "since": "sensor.washer_job_state",
          "camera": "camera.washer_camera", "icon": "mdi:washing-machine"}}
```

The garage reads "Open for 23 min" (from when the door actually opened, not from when the 10-minute sensor turned on),
shows the garage camera, and its **Close** opens the garage door's own controls. The laundry reads "Cycle complete · 12
min ago", and its picture opens the washer camera. It has no action.

Through the assistant (Mantel MCP), `grid_cards` describes the card and gives an example (`alert`). `grid_set` and
`grid_place` check a rule's alert like any other card's options: an option it doesn't take, text over 80 characters, a
color that isn't a named accent, an icon that isn't `set:name`, or a camera that isn't a `camera.` entity is refused
with `grid_option`.

Other places an alert reads well, all with the conditions Show When already has:

| Alert | Condition | Time Since | Camera | Action |
| --- | --- | --- | --- | --- |
| Someone at the Door | Someone Is at the Door | | the doorbell's | the front door's lock |
| Front Door Unlocked | After Sunset, and the lock is `unlocked` | the lock | the porch's | the lock (Lock, which asks first) |
| Leak Under the Sink | the leak sensor is `on` | the sensor | | the water's main valve |
| Vacuum Stuck | the vacuum is `error` | the vacuum | | the vacuum (its controls) |
| Freezer Warm | a threshold helper is `on` | the helper | | |
| Mail's Here | the mailbox sensor is `on` | the sensor | the porch's | |

## Checks

- `tests/test_alert_card.py`: the pure part in node (how long, what the action says, every size's plan on both cell
  shapes with and without a picture or an action), both catalogs, the house's rules kept in order at Tall and Large,
  first match winning and the default coming back, what a layout refuses, what a viewer who may not see the camera or the
  door is sent, the wiring, the assistant's card list.
- `tests/test_mcp.py::test_alerts_as_show_when_rules_through_the_mcp`: both alerts planned and saved through `grid_set`,
  and a refusal.
- HK Frontend's `test_blocks_taps.js`: the block at every size on both cells, its plate and Small's tap.
- `tools/headless/alert_check.py`: WebKit and Chromium, with house commands off. It draws every size on square and tile
  cells, with a camera and with a missing one, and checks nothing is past the plate and the pill is a finger's size. A
  tap on the action opens the door's sheet, and a tap on the picture opens the camera's. A Show When block shows House
  Status, then the alert while the rule holds, then House Status again when it clears.
