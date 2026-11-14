# Phase 31: Notifications on the Apple TVs (plan, 2026-11-14)

**Status: a plan and a mockup ([mockup/tv-alerts.html](mockup/tv-alerts.html), also at
https://claude.ai/artifact/6jjG6ZfTjdTr8xhRm3LhY6), every decision at the end answered by the owner (2026-11-14).
Ready to build; nothing is built.**

- **Line numbers** are left out on purpose. Search for the names.

## The ask (the owner, 2026-11-14)

The washer already shows on the Apple TVs when it finishes: a picture of the washer pops up in the corner of the TV.
Could every alert do that, with a picture made for that alert (a timer done, the doorbell, the dryer), drawn by Mantel,
and set up in Mantel? It has to look like it belongs on an Apple TV: Apple's type, Apple's symbols, Apple's colors.

## How the washer does it today (Home Assistant, not Mantel)

- `camera.washer_camera` is a **Local File** camera: a still picture, `/config/www/washer.jpg`.
- HomeKit Bridge publishes it as its own accessory ("Wash Camera", accessory mode) with a **linked motion sensor**,
  `binary_sensor.washer_finish` (a template: the washer's job state is `finish`).
- When the sensor turns on, HomeKit sends a camera motion alert. tvOS shows a camera alert in the corner of the
  screen, over whatever is playing, with the camera's picture and name, for a few seconds.

So an Apple TV will show any picture we give it, as long as it reaches HomeKit as a camera with a motion sensor. Nothing
else reaches the Apple TV's screen: there is no tvOS app of ours, and AirPlay would take over what is playing.

## What it will be

One HomeKit camera, **Mantel Alerts**, whose picture Mantel draws for each notification, and whose motion sensor Mantel
pulses once per notification. It is a new **place a notification goes**, beside the tablets' banners and the phones'
pushes:

```
the Notifier (features/notify.py)            Goes Off When, Only When, Do Not Disturb, Not Again For: unchanged
   |  the screens' feed (Feed.taps)
   +--> the tablets' banners                  (today)
   +--> the phones' pushes  (push.py)         (today)
   +--> the Apple TVs       (tv_alerts.py)    NEW: queue -> draw the card -> picture ready -> pulse the sensor
                                   |
             Mantel Link mirrors   camera.mantel_alerts  +  binary_sensor.mantel_alerts (motion)
                                   |
             HomeKit Bridge        one accessory: the camera, its linked motion sensor (set up once in HA)
                                   |
             every Apple TV        the camera alert in the corner, with Mantel's picture
```

Because it rides the Notifier, everything that is already a notification can go to the TVs with one switch: the
doorbell (with its snapshot), a timer ending (`timer` is already a notification kind: "Ends"), laundry, leaks, doors,
the alarm. Timers set with Siri on a HomePod come in as `timer.hk_homepod_<n>` (phase 28) and count the same.

## How Mantel draws the picture

The goal is a picture that looks like Apple made it, at the size a camera alert is shown (about a quarter of the TV's
width), so it is drawn with **the house's own Apple assets**, the same ones its tablets already draw with:

| Part | Where it comes from |
|---|---|
| Type | **SF Pro**: the house's own copy in its files folder (the tablets' `/hk/fonts/`; Apple's license keeps it out of the repository). Without it, Inter (OFL, bundled), the closest open face. |
| Symbols | **SF Symbols**: the house's `iconset/hk-glyphs.js` (built on a Mac by `tools/sf_symbols/build_glyphs.py`): the glyph each accessory already shows on the tablets, in its own color. Without it, the Material glyph the screens fall back to. |
| Colors | Apple's dark-appearance system colors, the ones HK uses (`hk-base.js`: the accessory's color, the page accents). |
| Snapshot | The notification's own snapshot when it has a camera (the doorbell, a camera's person or motion): the real picture, full bleed. |

**The drawing is SVG, rasterized with resvg** (`resvg_py`, wheels for linux x86_64 and aarch64, no system libraries).
resvg draws SVG exactly, with real text shaping from a font file, gradients, rounded rectangles and Gaussian blur. It is
the right tool between the two alternatives:

- **Pillow alone** (already in the image): no blur, no vector glyphs, no text shaping. It would look close, not right.
- **A headless browser on the server**: an exact match of the web app, but about 400 MB more image and a browser
  process on the LXC, whose disk already fills. Too heavy for a picture every few minutes.

A card is a template (one per look, below) filled with the notification's title, its line, its glyph and color, and the
snapshot when there is one. It is drawn **1920 x 1080** (what HomeKit asks for), JPEG, in the image worker
(`cameras/imaging.py`), in about 50-150 ms, and kept by a hash of what is on it, so the same card is drawn once.

Text is set for the size it is seen at: the title at 168 px of the 1080 (about a sixth of the corner alert's height),
the room and time at 62 px, the line at 88 px, one line each; a long name shrinks to fit, then shortens by words, never
mid-word.

### The looks (decision 1: all three, Color by default)

All three are offered (the owner, 2026-11-14: "I like Color the best... why not offer all 3"). **Look** on the Apple TV
page sets the house's; each notification's page can choose its own (**Look**: Automatic, Black, Glass, Color;
Automatic follows the Apple TV page). A template each, sharing the layout, so a third look costs little:

- **Color** (the default): a gradient of the accessory's own color with a white glyph and white type: HomeView's Color
  tiles.
- **Black**: pure black, the glyph in its color at the left, the title in white, the line in the accessory's color. The
  look of an iPhone's Live Activities and StandBy.
- **Glass**: the house's own background (its sky or wallpaper), blurred, under a dark glass plate: the tablets' look,
  at TV size.

**Color keeps its white type readable.** A light color (yellow, cyan, mint) would wash white text out, so the gradient
is darkened until white holds 4.5:1 against its lightest stop where the line sits, and 3:1 under the title (large
text), measured as Bright Glass's wallpapers are (`tests/py/test_settings.py`). A test draws every accessory color in
`hk-base.js` and checks both.
The cost: orange turns amber-brown and cyan steel blue. The mockup's Darken Light Colors switch shows both; the
owner chose darkened (decision 8, 2026-11-14).

Whatever the look, a notification **with a camera** shows its snapshot full bleed with the title on a dark fade at the
bottom (the mockup's doorbell), unless Use Camera Picture is off.

## What is new, file by file

| Where | What |
|---|---|
| `features/tv_alerts.py` (new) | taps the feed like `push.py`; which notifications go (their Apple TV switch); the queue (one at a time; the sensor held on 10 s, then off, and the gap step 0 measures); publishes the camera and the sensor through the link; the picture's route |
| `cameras/tv_card.py` (new) | builds the card's SVG from the look, the words, the glyph, the colors, the snapshot; pure (no I/O), so it is tested by its SVG |
| `cameras/image_work.py`, `imaging.py` | `render_card(svg, fonts) -> jpeg` in the worker with resvg; SF Pro read from the files folder (the `.ttf`, else the `.woff2` unpacked once with fontTools) |
| `hk_core/notifications/banner.py`, `settings.py` | a notification's `tv` switch and look (off for every notification, the doorbell included), the Apple TV options; `options()` cleans them |
| Mantel Link `entity.py` | `LinkedCamera` takes a still from Mantel (`features.still`, fetched through the link, kept until its version changes). The binary sensor is already mirrored with its device class. A Mantel Link release. |
| Mantel Link `homekit_entry.py` (new) | Add to HomeKit / Remove from HomeKit: makes or removes the HomeKit Bridge entry, and reports its pairing code, setup URI and Paired to Mantel |
| Settings | Notifications -> **Apple TV** (a page), and an **Apple TV** switch on each notification (below) |
| `tools/route_table.py --write`, the code map | the still's route; the new files |

Nothing changes in Home Assistant's configuration but one HomeKit Bridge entry, which Mantel Link makes when the owner
presses Add to HomeKit in Mantel Settings ("Who serves the camera", below). The owner scans its code in the Home app.

## In Settings

**Notifications -> Apple TV** (iOS Settings, as the rest of HK Settings):

- **Show Notifications on Apple TV**: the switch for all of it.
- **HomeKit**: Add to HomeKit (Mantel Link makes the bridge entry), then the QR code and code to scan in the Home app,
  then "Paired". Remove from HomeKit, under it.
- **Look**: Color (the default), Black, Glass. **Use Camera Picture**: on.
- **Follows Do Not Disturb**: on.
- **Preview**, with each look, and **Send Test**.
- **Notifications on Apple TV**: the list of notifications with their switches, each opening its own page; every
  switch off to start. Under the doorbells: "A doorbell already in HomeKit shows on the Apple TV by itself; turn this
  on only for one that isn't."

No Show For and no Only When a TV Is On (the owner, 2026-11-14): tvOS decides how long the alert stays on screen, and
the same alert can be wanted on a phone while every TV is off. How long the sensor stays on is Mantel's own (10 s).

**Each notification's page** gains one row in its "Where" group, beside the screens and the phones: **Apple TV**, a
switch, and under it **Look** (Automatic, Color, Black, Glass).

## What the build proves first (step 0)

Three things only a real Apple TV shows, tested before anything else is built (with the owner's OK, the Living Room's
Apple TV, no sound):

1. **The picture changes.** A HomeKit camera's picture is swapped, then its sensor pulsed: does the TV show the new
   picture or a cached one? If cached, the still's version goes in a new stream, or Mantel waits for HomeKit's
   snapshot request before pulsing.
2. **Back to back.** Two pulses 25 s apart, then 10 s apart: does HomeKit drop the second? The queue's gap is set from
   this.
3. **What the alert shows.** The picture alone, or with the camera's name and "Motion detected"? This decides whether
   the card repeats the title or the accessory's name is enough.

## Limits (from HomeKit and tvOS, not ours)

- The alert reads like a camera alert: the TV and the phones say the camera's name ("Mantel Alerts"). What the alert is
  about is in the picture.
- Every Apple TV with camera alerts on shows it; Mantel can't pick one TV. Each Apple TV's own settings can turn camera
  alerts off.
- Phones get the same alert, picture and all, for each person whose Home app has this camera's notifications on. That
  can be wanted (a picture on the lock screen); someone who already gets Mantel's own push for the same thing turns
  this camera's notifications off in the Home app (Settings says so).
- There is no button on the TV: it can't stop a timer or open a door. It is a picture for a few seconds.
- The Washer Camera keeps working until the owner removes it; laundry's own Done notification replaces it.

## Who serves the camera

Either way Home Assistant holds no script or automation for this: Mantel decides, draws and pulses; the only question
is what speaks HomeKit to the Apple TVs.

| | HA's HomeKit Bridge (through Mantel Link) | Mantel as its own HomeKit accessory |
|---|---|---|
| In HA | one HomeKit Bridge entry, which Mantel Link can make itself (HomeKit's import flow: accessory mode, the camera, its linked motion sensor); HA shows the pairing code | nothing |
| Pairing | a QR code in Mantel Settings, read by Mantel Link from HomeKit's pairing state (HA's notification has the same code) | a QR code in Mantel Settings (`qr.py`), in the Home app |
| New code | Mantel Link: the still, and making the entry; a Mantel Link release | HAP-python (pairing, encryption, the accessory), its pairing keys kept and backed up as a secret, the camera's stream answer |
| Network | none new: HA already speaks HomeKit on the LAN | Bonjour from Mantel: host networking for the container, as the optional `announce` service already does (`compose.announce.yaml`, zeroconf is in the image) |
| Live view | HA's camera code, proven (the washer works) | the Home app's live view needs an answer: ffmpeg is only in the transcode image, so a still loop from there or "no live view" |
| The picture's timing | HA asks Mantel Link, Mantel Link asks Mantel | HomeKit asks Mantel directly, so Mantel knows when the snapshot was taken (helps step 0's first question) |
| Without HA | doesn't work | works: a Mantel house with no HomeKit Bridge, or no HA |
| Tested by | HA's own suite; step 0 for ours | ours alone; pairing only on a real Home hub |

**What Mantel does through Mantel Link, with HA's bridge** (checked against HA 2026.11's `homekit` integration):

- **The entities**: `camera.mantel_alerts` and `binary_sensor.mantel_alerts` are mirrored like every linked entity.
- **The bridge entry**: made with HomeKit's import flow (`hass.config_entries.flow.async_init("homekit",
  context={"source": "import"}, data=...)`): accessory mode, name "Mantel Alerts", the next free port, the camera with
  its linked motion sensor, no audio. HA lists it as set up in YAML, so its options are read-only in HA's UI; nobody
  edits it by hand. It never needs changing (the two entity ids are fixed); if it ever must, Mantel Link removes and
  makes it again, and it is paired again.
- **Pairing**: the QR code and the eight-digit code shown in Mantel Settings, and "Paired" once it is, read from the
  entry's HomeKit driver (`runtime_data.homekit.driver.state`: `pincode`, `paired`, the setup URI). That is HA's
  inside, not a public API: an HA update could move it, and then Settings says to use the code in HA's notifications.
- **Turning it off** keeps the entry (so it isn't paired again) unless the owner chooses Remove from HomeKit.

**What stays a person's, either way** (Apple's side): scanning the code in the Home app once; the camera's room;
whether each person's phone gets this camera's alerts; each Apple TV's own camera-alert setting.

Recommended: **HA's HomeKit Bridge, its entry made by Mantel Link**, for this phase. It is the path the washer proves, it
adds no network or pairing code to Mantel, and the owner touches HA once (scanning the code). Mantel's own HomeKit
accessory is the better product if Mantel later serves more to HomeKit (its direct cameras' doorbells, its own
sensors), and is written up under "Later".

## Decisions for the owner

1. **The look** (answered 2026-11-14): all three offered, Color by default, and a notification may choose its own.
2. **The font** (answered): SF Pro from the house's files folder, Inter where there is none.
3. **On by default** (answered): nothing, the doorbell included: a doorbell already in HomeKit shows on the Apple TV by
   itself, and a second alert would repeat it.
4. **Show For** (answered): no setting. tvOS decides how long the alert stays; the sensor is held 10 s.
5. **Only When a TV Is On** (answered): no setting. The same alert can go to a phone, wanted while every TV is off.
6. **The Washer Camera** (answered): removed from Home Assistant once Laundry's Done goes to the TVs (the owner's step,
   on the house; Mantel's build doesn't touch `/config`).
7. **Who serves the HomeKit camera** (answered 2026-11-14): Home Assistant's HomeKit Bridge, its entry made by Mantel
   Link so nothing is set up by hand in HA. Not Mantel itself as a HomeKit accessory, for now (see "Who serves the
   camera" above, and "Later").
8. **Color's light colors** (answered 2026-11-14): darkened until white type holds 3:1, not Apple's colors as they are.
9. **Release** (answered): Mantel and Mantel Link released together, after step 0 and the build.

## The build, in steps

0. **Prove it** on one Apple TV (above). Uses a hand-made card through a Mantel Link build on a test HomeKit Bridge
   entry, then removes both.
1. **The card**: `tv_card.py` and `render_card`; the three looks, Color's contrast rule and the snapshot card;
   golden pictures in the tests, compared by pixels with a tolerance; WebKit-free, so they run on GitHub's runner.
2. **The camera and the sensor**: `tv_alerts.py`, the queue, the still's route, Mantel Link's `features.still`.
3. **Settings**: the Apple TV page, the switch on each notification, Send Test, the HomeKit status check.
4. **On the house**: the owner presses Add to HomeKit and scans the code; Send Test; the doorbell and a timer for a day.

## Later

- A card that counts down: a timer's alert at one minute left, then at the end (two pulses).
- Live pictures: the HomeKit camera streaming a short loop instead of a still (needs the stream proved in step 0).
- Mantel as its own HomeKit bridge (decision 7's other answer): worth it once there is more than this one camera to
  serve, for example the doorbells of cameras Mantel reaches directly and HA doesn't have.

## Build log

(empty)
