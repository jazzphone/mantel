# Home Grid

Home Grid gives a generated screen a Home page made of fixed blocks. The tablet fills its display without scrolling; each block may have pages that swipe. The screen's other pages and tab bar remain available.

On a desktop, open **HK Settings → your screen → Arrange Home Grid**. Home Assistant admin permission is required. Choose **Tap Weight** or **Glance Up, Touch Down** to start with your home's scenes, rooms, cameras and thermostats.

Drag a block to move it; blocks of the same size swap. Select a block to choose a supported size, its options, or its pages. Arrow keys move the selected block. **+ Add** opens a searchable gallery with one live preview and named sizes. Add to the first free space or drag the preview onto the grid. Sizes without space are marked.

A block can display one card, custom pages of that card, or its automatic source: rooms, cameras, thermostats, speakers or scenes. Custom pages can be added, moved up and removed. **Tablet’s Room** follows the wall tablet's configured room.

Home Grid is a mode on an existing generated dashboard. You do not need a new dashboard: open its editor, choose a starter, arrange the blocks, and Save. Create a separate screen first only if you want a separate layout. The tab bar keeps your navigation settings: **Rooms** can be its own button or a section inside **More**.

Room blocks have a surrounding tile containing regular accessory pills and the speaker, without status chips. Extra accessories appear behind **+N more**, which opens the room. Scene groups also have a surrounding tile, keeping page dots with the scenes that swipe together. Camera blocks default to one camera; use **Camera** to choose which, or **Pages → Cameras** to swipe between them.

Select a Room or Scenes block and enable **Custom Group Background** to choose its color, opacity and blur (Follow Screen, None, Light, Medium or Heavy). Opacity changes the background tint, not the pills or labels. Turn the custom background off to restore the screen’s appearance. These settings also work on paged groups and conditional fallbacks.

Weather comes in Wide (conditions), Large (also six hours), and Extra Large (also five days). Timers offer pause/resume and cancel; an empty block opens Create a Timer, and Wide also has quick starts. Security opens the shared alarm sheet, keeping its PIN flow.

Choose **Show When** and a fallback card for a conditional block. Conditions include music playing, a timer running, an armed alarm, a doorbell event, after sunset, and an entity state. While false, the fallback fills the same cells. **Preview** switches between Live, Primary and Fallback in the editor without changing the saved condition. Doorbell events hold their card for one minute. **Change Card** and the fallback chooser reuse the gallery and offer cards that fit the block’s size.

Grid settings control the number of columns (6, 3 or 2), rows (2–6), frame dimensions and top band. The frame scales the desktop preview. The tablet always fills its own display. The 2- and 3-column variants are supported by the layout model, but their card designs are not yet polished for nightstand displays.

The top band shows a compact clock, weather and status chips. On a narrow thermostat block, tap its name for the full thermostat controls. Dots change a block's page.

Changes stay in a draft until **Save**. Cancel discards them, and preview controls cannot act on your home. **Home Style → Generated** returns to the usual Home page while retaining the saved grid.

History and Copy Layout are available in Mantel's editor. These review refinements await the next release.
