# Screensaver

The screensaver on a wall tablet is HK Frontend's, and its photos, timing and the rest work as HK Frontend's [Screensaver and Idle](https://github.com/jazzphone/hk-frontend/wiki/Screensaver-and-Idle) page describes. This page covers the editor Mantel Settings adds for how it looks: where the time goes, what sits around it, and what is behind it. Photos and albums are on the [Photos](Photos.md) page.

## Edit Screensaver

![The Screensaver editor: Looks and pieces on the left, the screensaver in the middle, Look, Info, Slides and Timing on the right](../images/screensaver-editor.webp)

**Edit Screensaver** lays the screensaver out on the screen itself, as the [Home Grid](Home-Grid.md) editor does for the Home page. Owners and Admins can use it, on a computer or an iPad. The editor needs a wide window for its three panes; on a narrow one it says so and offers **Open Anyway**. The **Clock Style** pages in Settings open it too.

The top bar has **Cancel**, **Undo**, **Preview** and **Save**. On the left are the **Looks** and the **Pieces**. In the middle is the screensaver itself, drawn by the same code the tablet draws with. On the right are the settings for whatever you have tapped. Nothing you do here acts on the house.

A screensaver is a **Look** (a background and the time) and the **Info** around it: the pieces you place. Every screen draws this way, including one that has never saved anything: its corners are pieces too.

### Looks

The Looks are **Photo Frame**, **Lock Screen**, **Forecast**, **Big Weather**, **Planted**, **Clock**, **Glance**, **Month**, **Day** and **Nightstand**, each shown as its picture. Tapping a Look changes the Look only: the background, the face, and how large the time is and where it stands. What you placed stays. A piece the new Look has no place for (Month has no row and no line) waits: it stays in your layout, the screen leaves it out, and the Info list marks it "Waits: Month has no row". Tap the Look you are on to open its page; **Start Over from** that Look, at its foot, puts back the Look's own pieces in their places.

### The four sections

With nothing tapped, the right side has four sections, always in this order.

- **Look:** the **Background** (**Photos**, **Landscape**, **Sky Only**, **Moving Color**, **Wallpaper**, **HK Landscapes**, **Soft Photos**, **The Day's Art**, **Calm Color**, **Paper** or **Black**) and its own options, such as how much to darken photos or a Moving Color pattern and its **Motion**. Then the **Big** element (**Time**, **Temperature**, **Date**, **Month** or **None**), its **Face** (the **Today** face also draws the weather and the song under the time: **Weather** and **What's Playing** turn each off), **Color**, **24-Hour Time**, **Size**, **Position** and **Align**. **Depth** is **In Front** or **Behind**: on photos the subject stands in front of the time, as on the iPhone's Lock Screen, with any face; on the Landscape the hills do. Where the background can't put anything in front, Depth says why instead. The **Planted** face (solid figures standing in the meadow) is on the Landscape. Over busy backgrounds, **Legibility** adds a soft shadow and an outline.
- **Info:** what is placed, a list with each piece's picture, shape and place; tap one to open it. **Ink** is **Auto**, **White** or **Black**: one ink for every piece on the screen, never some white and some black; Auto picks it from what is behind them. **Color Accents** adds a little color where it means something: rings, glyphs and status dots. **The Row** has one **Size** for every piece in it (60 to 200 %) and where it goes: **Under the Big Element**, or **Along the Bottom**, which keeps the middle of a photo, where faces usually are, clear. **Upright Screens** is **Same as Sideways** or **Its Own**.
- **Slides:** the screens that come now and then over the screensaver, each on or off: the forecast among the photos (**Classic** or **Big**), **Music Full Screen**, **Weather**, **Home Energy**, **Holidays** and **Timers**, and **How Often**. Each says what its corner adds (the time, the date and Home Status, in the Look's own face and color) and has a **See It** button. **The Slide Corner** sets the corner's **Time Size** (100 to 250 %) and what it adds at all: **Time**, **Date**, **Weather** and **House Status**. **Music Full Screen** sets what the music slide shows beside the album art: the **Room**, the **Album**, its **Progress**, the **Buttons**, the **Volume** and **Up Next**.
- **Timing:** **Starts After, Night Mode and More** opens the Screensaver page.

At the foot, **Reset…** puts the screensaver back to how it looked before you opened the editor.

### Pieces

The pieces are listed by group: **Time and Calendar**, **Weather and Sky**, **Home**, **People and Travel**, **Energy**, **Media and Photos**, **Cameras** and **Any Sensor**, with a search field. Each shows its picture and its shapes. Some say when they show ("Shows while music plays"), and a few are **Off Until Placed**.

- **Add:** drag a piece onto a green place with the mouse, as in the Home Grid editor, or tap it and then a green place, which works the same on an iPad. It goes in the first of its shapes that place takes. Drag one on the screen to another place to move it.
- **Shapes:** **Circular** and **Rectangular** pieces go in the row, four units to a line and two lines at most (a circular piece is one unit, a rectangular two), as on the iPhone; **Inline** pieces are a line of words above the big element or in a top corner; **Cards** go in the corners; **Along the Bottom** are bands such as the forecast's days.

![A piece tapped: its shapes drawn, its Size and Style, its options and Show](../images/screensaver-editor-piece.webp)

Tap a piece on the screen to open its page:

- **Shape:** its shapes, each drawn. A shape its place can't take moves it to the nearest place that can, and the editor says so.
- **Size and Style:** **Size** (60 to 200 %; in the row, **Its Own Size** off follows the row's size), **Backdrop** (**None**, **Glass** or **Tinted**) and **Color** (**Auto**, in the screen's ink, or **Accent**). A card or a rectangle, and the Date in two lines, has **Align**: **Auto** lines its words up with its side of the screen (a card on the right ends every line on the right margin, a song's art at that edge), or **Left**, **Center** or **Right**. Home Status' card can leave out its **Title** (HOME).
- **Options:** what it shows, such as which city's time or which sensor. The **Date** takes **Lines** (**One**, or **Two**: the weekday over the date), **Weekday** (**Long**, **Short** or **None**), **Month** (**Long**, **Short** or a **Number**: 11/4), **Year**, **Weight** (**Standard**, **Light** or **Bold**) and **Letters** (**As Written** or **All Capitals**); as it comes, it reads as before: Wednesday, November 4. A piece that reads an entity suggests one ("Use the Suggestion").
- **Show:** **Always**, or **When…** an entity **is**, **is not**, **is above** or **is below** a value: a mailbox piece that shows only when the mail has come, or the house battery only while it charges. Until then the others close up as if it weren't there.
- **Place:** **Where**, the Move buttons, and **Remove**. Delete does the same from a keyboard.

A piece with nothing to show right now, such as Now Playing with no music, keeps its place in the editor, drawn dotted with its name and when it shows. A piece whose fact is already on the screen, such as the time when the face shows it, is drawn faded with what shows it, and the screen leaves it out.

Things line up by what you see, not by their boxes: the top of the time is level with the first words in the top corners, a card with no backdrop puts its art on the margin, and the bottom corners' last lines sit on one baseline.

### Above the screen

**Wall Tablet**, **iPad Upright**, **Phone** and the phone on its side show the same screensaver at each shape, so you can check that it fits. Pieces that would meet something move out of the way or are left out, and the editor says which.

**See a Slide** shows a slide (Music, the forecast, Weather, Home Energy, Holidays, Timers) over the screen with its corner, and **Day** / **Night** shows Night Mode. Both are for the preview only: they are off each time the editor opens and change nothing that is saved. **Preview** hides the green places and shows the screensaver alone; **Edit** brings them back.

### Save and Undo

**Save** stores the screensaver for the screen. Everything stays a draft until then, and **Cancel** asks before it throws a draft away. **Undo** (⌘Z or Ctrl+Z) takes back the last change, one at a time.

The editor is the only place to change what the screensaver shows and how it looks: the background, the time and its face, the pieces, the legibility over photos, and which slides come now and then, and how often. **Screensaver Options** keeps what cannot be laid out on the screen: where the photos come from (a folder, or Mantel Photos), how they show (one at a time or a mosaic, their order, **Each Photo For**, **Slow Zoom**, and how portrait and landscape photos fit), the wallpaper when the background is Wallpaper, **Night Mode**, the **Side Pane** (each screen's own, even when the rest follows All Screens; All Screens' page names the screens that have their own), **Starts After** and the other timing, and the entities for automations. The editor's **Starts After, Night Mode and More** row opens it (**Choose the Wallpaper**, when the background is Wallpaper). A screen with a saved layout can go back to its old look with **Remove the Layout…** there.

## The Timer slide

**Timers** (Edit Screensaver → Slides) is on unless you turn it off, and it shows only while a timer you set is running: one from the Timers page or a preset. The timer ending first is on the big ring, and the others are small rings beside it, soonest first. A paused timer stays at the end and never brings the slide up.

**Timers Come Up** is **More Often** (every other slide) or **As Often as the Others**. For a timer's last minute, the slide stays on every tablet that isn't dark, over the photos, the music and Night Mode, and the ring restarts as one full 60-second sweep. It doesn't take over while someone is using the tablet.

Settings → **Timers** → **Which Timers** lists every timer in the house, on or ignored, each with a switch. Timers you start from the Timers page or a preset always count, so they aren't listed. **House Timers**, such as Night and Nap, and timers from Home Assistant start ignored, and quick timers start on. A timer you turn on shows, holds the last minute and rings, even when an automation started it, so turn on only those you want to hear about.

On Mantel, a timer you set is its own timer in Home Assistant, so there's no limit of four and no helpers to install. Mantel creates it when you press Start, and deletes it when it ends or you cancel it. An automation in Home Assistant can see it like any other timer while it runs. This needs Mantel's Home Assistant user to be an administrator; if it isn't, Mantel uses the four quick timers instead. Inside Home Assistant, HK Frontend keeps using the four quick timers, and they make no sound.

### When a timer ends

The big ring closes and pulses, and the slide shows **Stop**, **+1 Min** and **Restart**. If someone is using the tablet, the same choices appear in a pop-up over the page. Stop on any screen stops the timer everywhere, and tapping anywhere else on the slide stops it too, without leaving the screensaver.

Set this up in Settings → **Timers**, under **When a Timer Ends**:

| Setting | What it does |
|---|---|
| **Sound** | **Soft Bell**, **Chime** or **Kitchen Timer**. **Hear It on This Screen** plays it. |
| **Rings For** | **30 Seconds**, **1 Minute** or **Until Stopped**, which ends by itself after 10 minutes. |
| **Wake a Dark Screen** | Wakes the tablet in the timer's room for the last minute. Other rooms' dark tablets stay dark. |
| **The Tablet in Its Room** | Plays through that tablet's own speaker, as a notification's sound does. |
| **The Speaker in Its Room** | Plays on the HomePod or other speaker in that room, through Music Assistant. Music dips and comes back. |
| **Set From a Phone** | A phone has no room, so a timer set on one rings here, or on **Every Tablet**. |
| **Speaker Volume** | Never above the Intercom's **Highest Volume**. |
| **Also Play In** | Rooms that play every timer, or **The Whole House**. |

A timer's room is the room of the tablet it was set on. The **New Timer** sheet has a **Rings In** choice to pick another room for one timer. A timer rings whatever the time of day: the Intercom's quiet hours don't apply.

Speakers need the **Address for Music Assistant** in Settings → **Intercom**. The Intercom itself can stay off, and its rooms don't need to be on. A speaker usually starts a little after the tablet.

A tablet's browser may not play sound until it has been touched once. Fully Kiosk has an **Autoplay audio** setting that avoids this. Otherwise the tablet shows "Tap to hear the timer", and the first touch plays it.

If a timer ended while Mantel or Home Assistant was restarting, it rings when they're back, if that's within 10 minutes. After that, you get a notification saying when it ended.

## The Holiday slide

**Holidays** (Edit Screensaver → Slides, or Screensaver Options → Now and Then) counts down to the next holiday: how many days until it, themed for it. It comes among the photos or now and then over a clock, as Weather and Home Energy do, and only once a holiday is near. Its corner adds the time, the date, the weather and House Status, with the corner's Time Size and switches.

- **Christmas** is a 90s living room at night: the count on the TV as a VCR's blue on-screen display, the tree's lights chasing, snow falling past the window.
- **Halloween** is a haunted house on a hill, the count carved in a tombstone, bats leaving the attic and fog drifting.
- **Thanksgiving** is a 90s dining room at dusk, the count chalked on a board in front of the set table, candles flickering and leaves falling past the window.
- **New Year's** is a rooftop party at midnight, the count on a split-flap board, fireworks over the skyline.
- **Every other holiday** (Valentine's Day, Easter, Mother's Day, Father's Day, the Fourth of July, birthdays from Seasonal Sky's Birthdays, and your own dates) stands outdoors on the sky's landscape: a big number on the meadow with its own effects.

On the day itself the number gives way to a greeting. Along the bottom: **The Countdown** (weeks and weekends left; it hides in the last week) and **Coming Up** (the next three).

**Holiday Options** (on the Screensaver page):

- **Which Holiday:** **Next Up** (the soonest), **Take Turns** (each near one in turn) or **One Holiday** (only the one you pick).
- **Starts:** 30, 60 or 90 days before (60 by default).
- **Effects:** **Full**, **Gentle** (fewer and slower) or **Off**. Off, Reduce Motion, Flat and the sky's Animations off all draw one still picture.
- **Holidays:** each one on or off. A house outside the US starts with Thanksgiving and the Fourth of July off.
- **Add a Date:** a name, a month and day (every year, or only one year), and the scene it wears. Up to 12; a one-year date leaves the list once it has passed. Use it for Hanukkah, Diwali, Lunar New Year and other dates that move each year.
- **Scenes:** turn one off to show that holiday outdoors instead of in its painted room.
- **Along the Bottom:** The Countdown and Coming Up, each on or off.

The Holiday Whimsy Look turns the slide on. The effects run only while the slide is on screen. Tapping it wakes the screen.

