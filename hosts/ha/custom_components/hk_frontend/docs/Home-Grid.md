# Home Grid

Home Grid gives a generated screen a Home page made of fixed blocks. The tablet fills its display without scrolling; each block may have pages that swipe. The screen's other pages and tab bar remain available.

On a desktop, open **HK Settings → your screen → Arrange Home Grid**. Home Assistant admin permission is required. Pick a starter (Tap Weight; Glance Up, Touch Down; Room Focus; Music & Scenes; Security & Cameras; Family Hub; Essentials) to start with your home's scenes, rooms, cameras and thermostats; each shows a map of its blocks. Or Start Empty.

The editor has the cards on the left, the screen in the middle and settings on the right. Drag a card onto the grid; its outline shows where it lands, red where there's no room. Pick its size on the card first, or click a card for a live preview and **Add**. Drag a block to move it; blocks of the same size swap, and arrow keys move a selected block. **Undo** (⌘Z or Ctrl+Z) takes back a change, and Delete removes the selected block.

Select a block for its **Size**, **Change Card…**, **Content**, **Appearance** and **Show When**. **Content → Show** chooses one thing or pages that swipe: rooms, cameras, thermostats, speakers or scenes, or **Choose Each Page** for custom pages that can be added, moved up and removed. **Tablet’s Room** follows the wall tablet's configured room.

Home Grid is a mode on an existing generated dashboard. You do not need a new dashboard: open its editor, choose a starter, arrange the blocks, and Save. Create a separate screen first only if you want a separate layout. The tab bar keeps your navigation settings: **Rooms** can be its own button or a section inside **More**.

Room blocks have a surrounding tile containing regular accessory pills and the speaker, without status chips. Extra accessories appear behind **+N more**, which opens the room. Scene groups also have a surrounding tile, keeping page dots with the scenes that swipe together. Camera blocks show **One Camera** (choose it under **Camera**) or **Swipe All Cameras**.

Select a Room or Scenes block and enable **Custom Group Background** to choose its color, opacity and blur (Follow Screen, None, Light, Medium or Heavy). Opacity changes the background tint, not the pills or labels. Turn the custom background off to restore the screen’s appearance. These settings also work on paged groups and conditional fallbacks.

Weather comes in Wide (conditions), Large (also six hours), and Extra Large (also five days). Timers offer pause/resume and cancel; an empty block opens Create a Timer, and Wide also has quick starts. Security opens the shared alarm sheet, keeping its PIN flow.

**Show When** switches a block's card in place: the block's own card by default, and up to four rules, each with up to three conditions that must all hold and the card to show while they do. The first rule that holds wins (**Move Rule Up** sets priority). Conditions include music playing, a timer running, the alarm armed or disarmed, a doorbell event, after sunset, a time-of-day window (which may cross midnight) and an entity state. Every card fills the same cells. **Preview** switches between Live, Default and each rule without changing what is saved. Doorbell events hold their card for one minute. Older `when` + `fallback` blocks still work and open as one rule. **Change Card** and the rule's card chooser reuse the gallery and offer cards that fit the block’s size.

**Screen Type** (Screen → Grid) sets columns, rows, band and preview size for Phone Portrait (2 × 5, no band), Phone Landscape (3 × 2, no band; put the tab bar on the side), Tablet Portrait (3 × 6), Tablet Landscape (6 × 4), Large Tablet (6 × 5) or Car (6 × 3), re-packing the blocks in reading order and asking before any that can't fit leave the draft. Phone Landscape offers nightstand starters. The **Clock** block comes in every size, as HK's digital clock or a screensaver face (Analog, Classic, Big Serif, Flip, Retro LCD, Neon, Nixie Tubes, Dot Matrix, Minimal Arc), with or without its box (**Hide Box**).

Page panels are blocks too, read live from the page's settings: **Power** (Wide: the status; Large and Extra Large: the house picture or flow chart), **Music** (the speaker picker), **Doors & Locks** (the Security page's house with its ways in), **Live TV** (the channels) and **Water** (the day; Extra Large adds the main supply). An Extra Large **Thermostat** is the dial with its readings, modes and fan beside it.

A **Calendar** block has **Days** (1 to 7, Today and Tomorrow by default); its events scroll inside the block and open their details on a tap. Room blocks leave out Hidden Accessories, as the room's page does.

A camera block can **Follow Motion or a Selector**: motion turns to the camera in the room whose motion, occupancy or presence sensor last turned on (15-minute window); a selector turns to the camera an input select names. Large and Extra Large **Security** blocks are the alarm keypad; Large and Extra Large **Vacuum** blocks are the vacuum's controls, with Clean Areas below them when that feature is added.

With no block selected, the screen's settings control the columns (6, 3 or 2), rows (2–6), grid scale and top band. **Preview Size** scales only the desktop preview. The tablet always fills its own display. The 2- and 3-column variants are supported by the layout model, but their card designs are not yet polished for nightstand displays.

The top band shows a compact clock, weather and status chips. On a narrow thermostat block, tap its name for the full thermostat controls. Swipe a block with pages anywhere, including on its dots, or tap a dot.

Changes stay in a draft until **Save**. Cancel discards them, and preview controls cannot act on your home. **Home Style → Generated** returns to the usual Home page while retaining the saved grid.

History and Copy Layout are available in Mantel's editor.
