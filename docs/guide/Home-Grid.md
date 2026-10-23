# Home Grid

![Home Grid at 1280 × 800, with fictional devices and Arial](../images/home-grid.png)

Home Grid is a tablet Home page arranged in fixed blocks. It fills the screen without scrolling. Each screen keeps its own layout; the other pages and the menu keep working as usual.

In Mantel Settings, open **Screens → your screen → Arrange Home Grid** on a desktop. Owners and Admins can arrange a screen. A wall tablet displays the saved layout and offers no editor.

Start with **Tap Weight** (the largest blocks are the ones you touch most) or **Glance Up, Touch Down** (readings above, controls below). The starter uses your home's scenes, rooms, cameras and thermostats. It stays a draft until you press **Save**.

- Drag a block to move it. Blocks of the same size swap places. A move that overlaps another size or leaves the grid is refused.
- Select a block, then use the arrow keys to move it with the keyboard.
- Select **+ Add**, search or choose a group, then choose a card. Its live preview has named sizes. **Add** uses the first free space; you can also drag the preview onto the grid. Sizes without space say so.
- Select a block to change its size, options or pages, or remove it.
- Choose **Custom Pages** to add pages of the same card with different options. You can move pages up or remove them. Rooms, cameras, thermostats, speakers and scenes also have automatic page sources.
- **Tablet’s Room** means the room of the tablet displaying the screen. A copied layout keeps that meaning.

Home Grid is a mode on an existing generated dashboard. You do not need a new dashboard: open its editor, choose a starter, arrange the blocks, and Save. Create a separate screen first only if you want a separate layout. The tab bar keeps your navigation settings: **Rooms** can be its own button or a section inside **More**.

Room blocks have a surrounding tile containing regular accessory pills and the speaker, without status chips. Extra accessories appear behind **+N more**, which opens the room. Scene groups also have a surrounding tile, keeping page dots with the scenes that swipe together. Camera blocks default to one camera; use **Camera** to choose which, or **Pages → Cameras** to swipe between them.

Weather comes in Wide (conditions), Large (also six hours), and Extra Large (also five days). Timers offer pause/resume and cancel; an empty block opens Create a Timer, and Wide also has quick starts. Security opens the shared alarm sheet, keeping its PIN flow.

Choose **Show When** and a fallback card for a conditional block. Conditions include music playing, a timer running, an armed alarm, a doorbell event, after sunset, and an entity state. While false, the fallback fills the same cells. **Preview** switches between Live, Primary and Fallback in the editor without changing the saved condition. Doorbell events hold their card for one minute. **Change Card** and the fallback chooser reuse the gallery and offer cards that fit the block’s size.

The frame is the tablet's dimensions in pixels, used to scale the desktop preview. The tablet itself fills its actual display. The editor includes the screen's tab bar and leaves its space clear. There are 6, 3 or 2 columns and 2–6 rows. The narrower column counts are supported, but their card designs have not been polished for nightstand displays.

The optional top band keeps the clock, weather and status chips together. In a narrow thermostat block the dial fills the block: tap the thermostat's name for its full controls and modes. Wider thermostat blocks show mode choices directly. A large Now Playing block shows the song's progress above the controls and the volume below them, over a blur of the album cover. Under a block that has more than one page, the dots work like an iPhone's: swipe the block, tap a dot, or tap either side of the dots to move one page.

**Save** applies the complete layout in one checked settings change. **Cancel** discards the draft. The card controls inside the preview are disabled, so arranging a block cannot toggle a light or run a scene. To return to the generated Home page, choose **Home Style → Generated**; the saved grid is retained.

Mantel also offers **History** and **Copy Layout To…**. History lists the saved screen versions with their actor and time. Choosing one restores its layout into a draft for review; press Save to apply it. Other screen settings are preserved. Copy Layout saves the draft to the selected screen after confirmation and preserves that screen's other settings.

In HK Frontend, Home Assistant admins use **HK Settings → your screen → Arrange Home Grid**. Its editor and settings checks are shared with Mantel; History and Copy Layout are Mantel features.

The desktop editor has passed browser checks in Mantel and a scratch Home Assistant with fictional devices. Publication, a release and a physical tablet check are still required before this phase is considered shipped.

![The desktop Home Grid editor](../images/home-grid-editor.png)

![The card gallery with a live preview](../images/home-grid-picker.png)

The screenshots use fictional devices and Arial. Camera pictures are illustrative landscapes.
