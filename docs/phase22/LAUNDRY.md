# Phase 22: Laundry (plan, 2026-11-10)

**Status: planned and being built in one session.** The owner approved the mockup and the plan's direction on 2026-11-10.

- **Mockup:** [mockup/laundry.html](mockup/laundry.html). Open the file: it stands alone, with made-up numbers, and touches nothing in the house. Two of its parts were changed by the owner afterwards (see "The owner's changes to the mockup").
- **Line numbers** are left out on purpose, because `main` moves. Search for the names.

## The ask (the owner, 2026-11-10)

- A Laundry card for the Home Grid at every size (Small, Wide, Tall, Large, Extra Large), with a drawing animated like the vacuum's.
- It shows every status a machine can report, and alerts: a leak, an error, Done.
- It works with any brand, and with a plain machine watched by a power monitor or a vibration sensor. "Scope is huge for such a small win, so do what you can with entity pickers ... if you think you can 'auto' configure these things, feel free."
- A combo washer-dryer (one machine) and a separate washer and dryer are both supported. The person decides which they have.
- The generated room pages show it, and it gets a detail sheet.
- No settings page of its own. It is set up under Accessories.

## The owner's changes to the mockup

- **The generated room page shows a glyph, not the drawing.** The house's Apple glyph (`hk:washing-machine`, `hk:tumble-dryer`), still, like every other tile. "No animation necessary though.. as none of the other animate."
- **The detail sheet uses the sheets' own sizes** (hk-detail.js): Wide (820 px) by the one sheet height (680 px) on a tablet, two columns whose tops and feet line up; on a phone, one column at the phone height (643 px). The header (X, glyph, name) is the sheet's own, as on every other sheet.

## One set of states for every brand

A machine is not one Home Assistant entity. A SmartThings washer is a select and a dozen sensors on one device. LG folds the cycle step into its status. Home Connect has no step at all. So each source is reduced to one set of states before anything is drawn, by its raw value, never by its brand:

Off, Delayed Start, Washing, Rinsing, Spinning, Drying, Cooling, Wrinkle Care, Paused, Running (no step said), Done, Needs Help, Unavailable, and Water Leak (from the leak sensor, ahead of everything).

The table of raw values (`WORDS`) is in `hk_core/laundry.py`, with a copy in `web/hk/modules/hk-laundry.js` held the same by `tests/test_laundry.py`. It was read from Home Assistant's own integrations (smartthings, lg_thinq, home_connect, miele, whirlpool) and the HACS ones for GE SmartHQ, Electrolux and hOn:

| Source | Status | Cycle step | Time |
|---|---|---|---|
| Samsung (SmartThings) | `machine_state`: run, pause, stop | `job_state`: wash, rinse, spin, drying, cooling, wrinkle_prevent, finish | `completion_time` (a time), `progress` % |
| LG (ThinQ) | `current_state`: running, rinsing, spinning, drying, end, error... | in the status | `remain` (a time) |
| Bosch, Siemens (Home Connect) | `operation_state`: run, pause, delayedstart, finished, error | none | `program_finish_time`, `program_progress` % |
| Miele | `status`: in_use, pause, program_ended, failure | `program_phase`: main_wash, rinse, spin, drying, anti_crease | `remaining_time` min |
| Whirlpool, Maytag | `washer_state`: cycle_washing, cycle_spinning, complete, exception | in the status | `end_time` (a time) |
| GE (SmartHQ) | `machine_state`: Run, Paused, Finished | `sub_cycle`: Wash, Rinse, Spin, Drying | `time_remaining` min |
| Electrolux, AEG | `applianceState`: RUNNING, PAUSED, END_OF_CYCLE, ALARM | `cyclePhase`: WASH, RINSE, SPIN, DRY | `timeToEnd` s |
| Haier, Candy, Hoover (hOn) | `machMode`: running, pause, ending, error | `prPhase`: washing, rinse, spin, drying | `remainingTimeMM` min |
| A power monitor | running above Running Above (10 W) | none | none |
| A vibration sensor's helper, or any sensor that is on while it runs | on is running | none | none |

None of this has run against a real machine except the owner's Samsung combo.

## Setup: Accessories → Laundry

- **Found by itself.** With nothing saved, Mantel finds the machines: a device with a status sensor that reads like a washer's or a dryer's, and on the same device its cycle step, its time, progress, door, remote control and power. A leak sensor in the same room is picked up too. Its Kind comes from its names and model (a "combo" or a Samsung `WD` model is a Washer & Dryer). A washer seen drying is drawn as a Washer & Dryer whatever it was set to.
- **Changed by hand.** Each machine has its own page: Name, Kind (Washer, Dryer, Washer & Dryer), Room, and an entity picker for each part (Status, Cycle Step, Time Left or Finish Time, Progress, Door, Remote Control, Leak Sensor, Power with Running Above, Running Sensor). The first change saves the whole list, so the found machines become the person's own. **Add a Machine** adds one with no integration: pick a power sensor or a running sensor. **Remove Machine** takes one off. **Find Machines Again** goes back to what Mantel finds.
- **Done.** Clear After: Until Cleared, 2, 4 (the default), 8, 12 or 24 hours.
- Stored as `features.laundry` (the list) and `features.laundry_clear` (hours), checked by `hk_core/laundry.py` (`machines`, `clear_after`). No settings page, no new settings section.

## Where it shows

- **Home Grid: the Laundry block** at Small, Wide, Tall, Large and Extra Large, on square cells and tile cells. One machine: the drawing and what it is doing, its time and its finish time, the cycle's steps, and on Large and Extra Large its readings. Two machines share the block: Small shows the one most worth a look (a leak or an error, then Done, then the soonest done) and says +1; Wide and Tall show both; Large and Extra Large give each a column. Pause and Stop show only where the machine offers them and allows remote control, never a remote start. Clear shows on Done where Mantel holds it.
- **Generated room pages:** each machine is a tall tile in its room with the house glyph, still, named, and what it is doing ("Drying · 24 min"). It is lit while it runs or is Done. A tap opens the sheet.
- **The chip row:** a Laundry chip appears while a machine runs or waits to be unloaded ("24 min left", "Done").
- **The detail sheet** (`hk-detail-laundry`, opened from the block, the tile and the chip): on a tablet, the Wide sheet. The left column has the drawing, the state in the hero type, the time and finish time, the progress and Clear. The right column has the cycle's steps, the machine's readings (door, remote control, power, leak sensor) and Pause, Resume and Stop, dimmed with the reason when the machine won't take them. With two machines, a segmented control at the top of the right column switches between them. On a phone it is one column.

## Done, held (Mantel Server)

Most machines say they finished for a moment and then go back to off, and a power plug never says it at all. So Mantel Server watches every machine (`mantel_server/laundry.py`, the rules in `hk_core/laundry.py`). A machine that was running and then isn't is Done. Done stays until one of these happens:

- someone presses Clear (from any screen, for everyone);
- the door opens;
- the machine runs again;
- Clear After hours pass.

It is shared as Mantel's own `sensor.laundry_done` (`machines: {id: {since, words}}`), the way the vacuum's water tank is, kept in the `laundry_done` table across a restart, and cleared through `script.laundry_done_clear {machine}` by the gateway. A machine that finished while Mantel wasn't running isn't guessed at.

**HK Frontend inside Home Assistant** has no server: a machine there is Done only while it says so itself.

## Build order (one session)

1. `hk_core/laundry.py`: the states, the table, the machine settings and their checks; `features.laundry` and `features.laundry_clear`.
2. `web/hk/modules/hk-laundry.js`: found machines, `look()`, `controls()`, the drawing; loaded with the core (home.js, the settings page, HK Frontend's boot list and test prelude).
3. Accessories → Laundry: the list, a machine's page, Add a Machine, Remove, Find Machines Again, Clear After.
4. The Home Grid block (`hk-grid-laundry-card`, `web/hk/cards/hk-laundry-card.js`) at five sizes on both cell shapes; both catalogs, the editor's lists, the MCP `grid_cards` description.
5. The detail sheet (`web/hk/sheets/hk-sheet-laundry.js`).
6. The room tile and the Laundry chip.
7. Done, held: the server's watch, the table, Clear through the gateway, a wall tablet's rights.
8. Tests at each step; then the main suite, HK Frontend's suites, the Home Grid audit and the sheet review in WebKit at 1280 x 800 and a phone, and the house's own screens (house_twin). Docs and the changelog.

## Not in this phase

- Learning a cycle's usual length for a power-only machine ("About 18 min left"). The mockup showed it; it needs a history of runs, so it waits.
- Thresholds and debounce for power and vibration sensors. A machine reads a power sensor against Running Above as it stands. A noisy plug, or a vibration sensor that flickers, should go through a Home Assistant helper first (a threshold helper, or a template binary sensor with `delay_off`), picked as the Running Sensor.
- Starting a cycle from Mantel. Several brands refuse a remote start, and starting one belongs at the machine.
- A Laundry page of its own.
