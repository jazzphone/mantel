# Appearance

How the glass looks, for every screen and for one screen, and whether Home
Assistant’s header and sidebar show.

## Every screen

**All Screens → Appearance.** How every screen that doesn’t choose its own
looks, on one page:

- **Style**: the Appearance Style, then only that style’s own settings. Its
  footer names the screens that keep their own look (each a link to it),
  since a change here doesn’t reach them.
- **Colors**: the **Accent Color**, and **Flat Colors** while any screen
  wears Flat.
- **Background**: **[Sky / Background](Live-Sky.md)** (its own sidebar
  entry before; the old address opens it here).
- **Tab Bar Look**: the [tab bar’s](Tab-Bar.md) **Tab Bar Glass**.

**The Accent Color** is one choice for the menu’s highlight (its icons and
the page you’re on, the tab bar’s too) and Flat’s accent: **Automatic** (in
Flat, Flat’s own; elsewhere each page’s color, Home and the rooms orange),
Apple’s eleven system colors, or **Your Own Color**. In Flat it also shades
an Automatic background. It was the **Highlight Color** (under Menu) and
Flat’s Accent Color before; both keep what you saved, and a Flat screen that
had an accent of its own keeps it, as *Just This Screen*.

![The Appearance page in HK Settings](images/settings-appearance.webp)

| Setting | Default | What it does |
|---|---|---|
| Glass Style | Glass | How pills, tiles, chips, scenes and keypads look: **Glass**, the original see-through glass, with the status chips and the round menu button beside them blurring what’s behind them. **Frosted**, a milky material with no blur: it costs nothing per frame on any device. **Tinted**, the Home app’s look: a flat dark plate with no blur anywhere on the page, the lightest on any device — see [Tinted](#tinted) below. **Blur**, what’s behind the glass blurred — choose how with **Blur Mode**. |
| Blur Mode | Shared Layer | Shown when the Glass Style is Blur: **Shared Layer**, **Pre-rendered (Experimental)** or **Each Card**. What each costs and can’t do: [Blur Mode](#blur-mode) below. |
| Frost | 50% | Shown when the Glass Style is Frosted. How milky it is, 0 to 100%. |
| Tint from Background | Off | Shown when the Glass Style is Frosted. On: each card's frost takes the color of the page behind it (the sky at the card's height, the scenery's ground lower down) instead of one gray, at one darkness so white text reads the same on every page. It changes with the live sky through the day. Cards in pop-ups, the screensaver and Music (album art) keep the gray. Costs nothing per frame. |
| Blur | 50% | Shown when the Glass Style is Blur, in any Blur Mode. How strong the blur is, 0 to 100%: 50% is 20 px, 100% is 40 px. |
| Darkness | 50% | Shown when the Glass Style is Tinted. How much of the background shows through an off card: 0% is 40% dark, 50% is 75%, 100% is 90%. |
| Icon Circles | Dark | Shown when the Glass Style is Tinted. **Dark**, as the Home app draws the circle behind an off accessory’s icon, or **Light**, which keeps its shape over dark scenery. |
| Page Pills | Default | Every page pill: the pills in a screen’s Scenes row that open a page. Tap one to set its name, icon and color, the same on every screen ([Home Page](Home-Page.md#scenes-and-page-pills)). |

![The Glass Style page: Glass, Frosted, Tinted and Blur, with Blur Mode's three choices under it](images/settings-glass-style.webp)
*All Screens → Appearance → Glass Style: the four styles, and with Blur chosen, its Blur Mode below.*

The four styles side by side:

| Style | What blurs | What it costs | Best for |
|---|---|---|---|
| **Glass** (the default) | Only the status chips and the round menu button | Little | Most screens |
| **Frosted** | Nothing: a milky plate | Nothing per frame | Any device; the plate can take the page's color (**Tint from Background**) |
| **Tinted** | Nothing on the page: the Home app's flat dark plate | The least of all | A slow wall tablet, or anyone who wants the Home app's look |
| **Blur** | Whatever is behind the glass, made as **Blur Mode** says | From light (Pre-rendered) to the heaviest (Each Card) | The see-through look; see [Blur Mode](#blur-mode) |

### Blur Mode

With the Glass Style on **Blur**, **Blur Mode** chooses how the blur is
made. All three look alike standing still; they differ in what they cost
and what they show while things move.

| Mode | Good at | Gives up | Best for |
|---|---|---|---|
| **Shared Layer** (the default) | Live: the sky blurs as it moves, drifting clouds and rain included. One blur for the whole page, so a wall tablet keeps its frame rate standing still. | While the sky moves, the device blurs it again on every frame, and scrolling pays for it. Something fixed over the page that blurs live — the Now Playing bar — adds to it. | Most screens; wall tablets that rarely scroll. |
| **Pre-rendered (Experimental)** | A picture of the sky, blurred once, behind every card. The lightest blur: almost nothing per frame, so scrolling stays smooth on a wall tablet even with the bar up. | Motion that doesn’t drift across the sky — rain, a passing flock, a flicker — doesn’t show through the glass. The picture is painted again as the sky changes: at once for a new page, size, weather, season or song; every 2 seconds while clouds drift (a little work each time, never while a finger is on the page or it scrolls); and as the light changes. It can still trail the sky a moment or briefly not match it, which is why it is marked Experimental. Pop-up sheets and pages with no sky blur live, as in Shared Layer. | Wall tablets, especially ones that scroll or show the Now Playing bar. |
| **Each Card** | Live, and every surface blurs exactly what is behind it, so a sliding sheet or a scrolling row never leaves its frost behind. | The heaviest by far: one blur per card (over a hundred on a typical Home). | Phones, iPads and computers, not wall tablets. |

Scrolling Home on a wall tablet (a Samsung Galaxy Tab A9+, sky animations
on), measured for 1.7:

| Mode | Bar off | With the Now Playing bar |
|---|---|---|
| Pre-rendered | 59 frames a second, 1.5% of frames late | 59, 1.8% late |
| Shared Layer | 58, 3.6% late | 54.5, 10.3% late |
| Each Card | 32, 72% late | 28, 83% late |

Standing still, every mode is close to 60 frames a second; on these tablets
most of the work is the animated sky itself, whatever the glass. Glass and
Frosted scroll about as smoothly as Pre-rendered, and Tinted, with nothing
on the page blurring at all, is lighter still.

A screen or All Screens set to **Baked**, a mode tried before 1.7 and taken
out, now uses Pre-rendered.

### Tinted

![Home on a wall tablet in the Tinted look: flat dark plates over a sharp sky, the lit accessories white](images/tablet-home-tinted.webp)
*Home in the Tinted look.*

**Tinted** draws every card the way the Home app does: a flat, dark,
see-through plate, opaque white when the accessory is on, and a tight shadow
right under the edge instead of a soft glow. Nothing on the page blurs: no
shared layer, no picture of the sky, no card blurring itself. The status
chips, the menu’s edge tab and the round menu button are Tinted plates too,
and the menu panel and the tab bar (set to **Same as Screen**) are near-solid.

The Home app’s plate blurs the wallpaper behind it, so it can stay light.
Tinted doesn’t, so the scenery shows through sharply, and it is darker to make
up for it. Choose how dark with **Darkness**.

Detail sheets, pop-ups and notifications still blur what is behind them while
they are open, as the Home app’s do. Cards inside a sheet get a lighter plate,
so they never turn into dark holes on the dark sheet.

A card can stay out of the shared blur with `glass: false`. Whether tapping an
accessory opens an HK detail sheet is **HK Detail Sheets**, under
[Library → Accessories](Accessories.md#accessories-settings).

## Recommended: a lighter screen for a slow tablet

When a wall tablet draws fewer than 45 frames a second on a screen, HK
Settings suggests ONE change on that screen’s **Appearance**, under its Style,
and never more than one at a time. For example: *“Kitchen Tablet draws 38
frames a second with Blur. Glass looks almost the same and is lighter.”* The
button changes that screen only (All Screens’ is never changed), and **Use
Flat** is beside it. Nothing changes until you tap one. All Screens →
Appearance lists each screen with a suggestion, linked to its page.

The suggestions go in order of what costs a weak tablet the most, and a screen
that doesn’t use one skips it:

| | The suggestion | The button |
|---|---|---|
| 1 | The style: **Blur**, **Frosted** or **Tinted** | **Use Glass on This Screen** |
| 2 | The sky’s **Rain & Snow** | **Turn Off Rain & Snow on This Screen** (the clouds and fog stay) |
| 3 | **Moving Things** in front of the cards | **Put Moving Things Behind on This Screen** |
| 4 | The sky’s **Animations** | **Turn Off Animations on This Screen** (the sky holds still) |
| 5 | A camera playing live (**Live First Camera**) | **Turn Off Live First Camera on This Screen** (the first tile is a snapshot) |

**Use Flat** goes with every step but the third. When you take a step, nothing
more is suggested until the tablet has measured again, up to an hour later; if
the screen is still under 45 frames a second, the next step appears (the
suggestion says so). Each measurement also records what the screen looked
like when it was drawn (its style, its sky and its camera), and a measurement
is only used while the screen still looks that way.

The tablet measures itself: 5 seconds of drawing, about 20 seconds after the
screen loads and then hourly, only while nobody is touching it and the screen
is lit. In Home Assistant the tablets report to nobody, so the suggestion
shows when HK Settings is opened **on that tablet**, under **This Device** on
the page of the screen it measured (*Recommended for This Device*). With
[Mantel](HK-Frontend-and-Mantel.md), every tablet’s number reaches HK
Settings wherever it is opened.

## One screen

**Screens → (a screen) → Appearance**, one row on the screen’s page with its
style and whether it is its own. Its page is laid out as All Screens’: the
Style, the Colors (its **Accent Color**, *Same as All Screens* until it
chooses one), the Background and, for a screen with the tab bar, its
**Tab Bar Glass**.

| Setting | Default | What it does |
|---|---|---|
| Glass Style | Same as All Screens | **Same as All Screens** (the row says *Same as All Screens* under its name, and the glass it follows, *Glass*), or under **Just This Screen** **Glass**, **Frosted**, **Tinted** or **Blur** — and with Blur, its **Blur Mode**: **Shared Layer**, **Pre-rendered (Experimental)** or **Each Card**. See [Appearance](#every-screen) for what each looks like and costs. |
| Frost / Blur / Darkness | Same as All Screens | Shown for the amount this screen’s glass uses. Moving it gives this screen its own amount. |
| Icon Circles | Same as All Screens | Shown when this screen uses Tinted. Choosing one gives this screen its own; **Reset to All Screens** goes back to following All Screens. |
| Reset to All Screens (50%) | — | Shown once the screen has its own amount, with All Screens’ amount. Goes back to following All Screens. |
| Tint from Background | Same as All Screens | Shown when this screen uses Frosted. Turning it on or off gives this screen its own; **Reset to All Screens** goes back to following All Screens. |
| Sky / Background | Same as All Screens | The screen’s [Sky / Background](Live-Sky.md#the-background) page, which starts with its **Background**: **Live Sky**, **Color**, **Photo** or **Landscapes**, Same as All Screens until changed. With the Live Sky, its own **Moving Things**, **Pause When Not in Focus**, **Rain & Snow**, Clouds and the rest are there too, each Same as All Screens until changed. Reads **Black** for a screen whose Live Sky was turned off before (it shows Black; any choice there turns it back on). A YAML screen shows the Background wherever its YAML puts the sky. |

## Home Assistant header & sidebar

**Screens → (a screen) → Header → Home Assistant Header & Sidebar.** Whether
Home Assistant’s own header and sidebar show around the screen. The row reads
**Off**, **Both Hidden**, **Header Hidden**, **Sidebar Hidden** or **Kiosk
Mode Plugin**.

![A screen's Header & Sidebar page in HK Settings](images/settings-header-sidebar.webp)

| Setting | Default | What it does |
|---|---|---|
| Hide Header & Sidebar | Off (Wall Tablet, Car and Energy Display presets: on) | The whole window is the screen. HK Frontend does it itself, on any screen, an existing dashboard too. The menu’s Home Assistant section still reaches Home Assistant (Show Menu). The settings below show only while it is on. |
| Hide Header | On | Hides Home Assistant’s header: the bar with the dashboard’s name, its views and its menu. |
| Hide Sidebar | On | Hides Home Assistant’s sidebar. |
| For Admins Too | On | Off: someone signed in as an admin still sees them. |
| Use the Kiosk Mode Plugin Instead | Off | *A generated screen, where [Kiosk Mode](https://github.com/NemesisRE/kiosk-mode) is installed from HACS.* The plugin hides them instead, with its own **Kiosk Mode Options**: Hide Header, Hide Sidebar, Show Header for Admins, and any other of its options in YAML. A screen that had Kiosk Mode Options of its own before 1.3 moves over to these settings when they can say the same (hiding the header, the sidebar, and admins seeing both), and otherwise keeps the plugin. |

Leaving the screen, for Settings say, always brings them back. `?hk_kiosk=off`
on a screen’s address shows them until the page is reloaded (a tablet you are
working on).
