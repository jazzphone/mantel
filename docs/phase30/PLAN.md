# Phase 30: AirPlay to a wall tablet (plan, 2026-11-13)

**Status: decisions answered (2026-11-13); built, waiting on the owner's four-minute mirror (step 0) and his OK for a
tablet build.** Mantel's side is on main; the app's is on mantel-android main (the receiver off on every tablet until
switched on). No app build is published and nothing is on the house.

The owner: "I'd like to do AirPlay Mirroring/Video", and then: "This should also cover audio as well... AirPlay 1 and 2
if possible!"

## What it is

Mantel for Android becomes an AirPlay receiver under the tablet's own name. An iPhone, iPad or Mac picks the tablet in
Screen Mirroring (or as a display to extend to) and its screen fills the tablet's, over the page; when the mirror ends,
the page is back. A YouTube-style video sent with AirPlay plays on the tablet by itself. Sound alone (music from an
iPhone's AirPlay picker) plays from the tablet's speaker. Off unless a tablet's switch is on.

## Proven on the Loft (2026-11-13)

The prototype (below) on the Loft, Android 16, nothing else changed:

- **Found everywhere it should be.** Advertised by Android's NsdManager as `Loft Kiosk` (`_airplay._tcp` and
  `_raop._tcp`, port 7000). A Mac on another of the house's networks saw it in Displays → "Mirror or extend to"
  beside the Apple TVs, and reached its port. Nothing in the network had to change.
- **An iPad mirrored to it** (the owner's, current iPadOS). From the sender connecting to the hardware decoder running
  took under 0.3 s: connected 44.699, mirror running 44.813, decoder started 44.987. The stream was **H.265 at
  826 × 1200** (an iPad upright, scaled by the iPad to the tablet's 1200-pixel height), decoded by the tablet's
  **low-latency hardware HEVC decoder** (`c2.qti.hevc.decoder.low_latency`). The picture was right: upright, centered
  on black, full height, over the page; the curtain lifted; the page came back when the mirror ended.
- **Not yet measured: a sustained mirror.** That run lasted 18 seconds, too short for the frame rate, delay, CPU and
  temperature samples. A Mac can't be made to start a mirror from here (the menu that does it belongs to a system
  helper the session can't press), so **the numbers are waiting on four minutes of mirroring by the owner** (step 0
  below). The app now keeps them itself: each mirror's frame rate, delay (from the sender's capture to arriving, and to
  leaving the decoder, on the AirPlay clock both ends share), the app's share of a core, and Android's thermal
  headroom, logged at its end and returned by adb (`AIRPLAY` → `last:`).
- **Idle, the receiver costs nothing measurable.** With it on and nobody sending, the app and its page measured 0.4-0.7
  of a core each, the page's own spread on the Loft with the receiver off.
- **Sound from a non-Apple sender is refused.** pyatv's "stream a file" (the classic AirPlay 1 audio handshake,
  `ANNOUNCE`) got `501 Not Implemented`: UxPlay only speaks the way Apple's own devices send today. A file of silence
  at volume 0 was used, so nothing played either way.
- **The APK grows from 8.5 to 30 MB** (OpenSSL's `libcrypto` 12.9 MB unstripped, the AirPlay library 3.5, Oboe 3.2,
  the C++ runtime 1.8). Stripped and with OpenSSL linked statically, about half that.

## What exists to build on

- **UxPlay** (C, GPL-3.0; github.com/FDH2/UxPlay, 1.73.7, Sept 2026; derived from RPiPlay). Its `lib/` is the receiver:
  pairing (SRP and Ed25519, `pairing.c`, `srp.c`), the FairPlay key exchange (`playfair/`, a reverse-engineered
  library whose legal standing UxPlay itself calls unclear), RTSP and HTTP (`raop.c`, `httpd.c`, llhttp), the mirror
  stream (`raop_rtp_mirror.c`: H.264 or H.265 with its AirPlay timestamps), audio (`raop_rtp.c`, `raop_buffer.c`: ALAC,
  AAC-LC, AAC-ELD), NTP timing with the sender (`raop_ntp.c`), and HLS video (`airplay_video.c`, `http_handlers.h`).
  The rest of UxPlay (GStreamer rendering, avahi or dns_sd) isn't needed on Android.
- **jqssun/android-airplay-server** (GPL-3.0, on F-Droid and Google Play): UxPlay's `lib/` built by the NDK with CMake,
  a JNI bridge, nine patches to UxPlay (HLS crashes, a PIN pairing fix, video reset, a sender-compatibility fix),
  `dnssd` replaced by a shim whose TXT records Android's NsdManager registers, MediaCodec onto a SurfaceView (through a
  GL pipeline that survives a surface change), AAC by MediaCodec and ALAC by a minimal FFmpeg, both to Oboe, and HLS by
  Media3/ExoPlayer. **The prototype takes its native layer and renderers unchanged** (with its UxPlay pin and
  patches) and adds Mantel's own receiver class and screen. Older ports (dsafa22's AirplayServer, the "Airplay-SDK"
  forks) are unmaintained and predate H.265 and current iOS. UxPlay 1.73.7 (the pin) carries the fix for iOS 27's
  changed TEARDOWN.

**Dependencies:** OpenSSL 3 (built from source by openssl-cmake), libplist (built from source), llhttp and playfair
(inside UxPlay), FFmpeg's ALAC decoder (a minimal static build), Oboe (an AAR), the NDK (27.0) and CMake (3.22). mDNS is
Android's NsdManager with a multicast lock: no avahi, no dns_sd, no mDNS of our own.

**Ports:** TCP 7000 (RTSP and HTTP, fixed so a firewall rule can name it), then UDP and TCP ports the system picks for
the session's timing, audio and video streams. All above 1024: an app needs nothing special. **AirPlay 2's PTP clock
(UDP 319 and 320) is the one thing out of reach:** the Loft's `ip_unprivileged_port_start` is 1024, and only root can
bind below it.

## What works with what

| | iPhone, iPad (current iOS / iPadOS) | Mac (current macOS) | Notes |
|---|---|---|---|
| Screen Mirroring | yes (tested: iPad) | yes ("Mirror or extend to": as a mirror or a separate display) | H.264 or H.265; up to the tablet's 1920 × 1200 at 60 fps |
| A video's own AirPlay (the AirPlay button in an app) | YouTube app only (HLS links the tablet fetches itself) | no | other apps send only sound, or fall back to mirroring |
| DRM video (Apple TV app, Netflix, Disney+, most paid video) | no | no | FairPlay-protected: black picture at best, sound only |
| Sound alone (Control Center's AirPlay picker, Music) | yes, one tablet at a time | yes | ALAC or AAC with the sender's volume; about 2 s behind, as AirPlay's music always is |
| Sound in a group with HomePods | **no** | **no** | AirPlay 2 groups need PTP (UDP 319/320) |
| Classic AirPlay 1 senders (pyatv, Music Assistant's AirPlay player, old iTunes) | n/a | n/a | refused (`ANNOUNCE` not implemented, tested) |

**"Video", plainly:** mirroring shows whatever the sender's screen shows, except DRM video, which iOS blacks out on
any mirror. "AirPlay video" proper (the sender hands the receiver a link and goes quiet) works only for the YouTube
app; Safari's and other apps' AirPlay buttons, and every DRM app, don't. That's UxPlay's limit and Apple's.

**"AirPlay 1 and 2", plainly:** what the tablet speaks is the AirPlay 2 protocol in its "legacy" form, the one Apple's
devices use for mirroring and for sound to a single receiver. Two parts are missing. **AirPlay 2's buffered, PTP-timed
audio** is what lets an iPhone put the tablet in a group with HomePods, in sync; it needs ports 319 and 320, so no
unrooted Android app has it. **AirPlay 1's `ANNOUNCE` audio** is what non-Apple senders like Music Assistant use;
UxPlay never had it (shairport-sync does). See decision 5.

## How the tablet shows a mirror

- **Over the page, full screen.** A black layer above the page holds the mirror's SurfaceView, sized to the picture's
  proportions and centered (an upright phone is a tall strip in the middle; a Mac or a landscape iPad fills the
  screen). The page is hidden (it draws nothing underneath) but keeps running and its socket stays up.
- **Waking up for it.** A mirror (or a code to show) turns the screen on and lifts the curtain as a touch would, and
  keeps it lifted while the mirror runs (the curtain's timeout counts a mirror as a touch). Home Assistant's screen
  switch can still turn the screen off; the plan is that Sleep Screen leaves a mirroring tablet alone (decision 6).
- **Back to the page when it ends**, at once, where it was. A Mac extending to the tablet is the same: a display.
- **The tablet's kiosk mode stays on.** Nothing on the glass ends a mirror (the sender does): a tap on a mirror does
  nothing, so nobody at the wall can unplug a guest's screen by accident, and the seven-tap menu still works.
- **Sound alone leaves the page as it is.** Later perhaps a Now Playing card with the sender's cover art (UxPlay hands
  over the track and the art).

## Settings

- **Per tablet, off by default:** Mantel Settings → All Screens → Wall Tablets → the tablet → **Mantel for Android →
  AirPlay** (on/off), beside Screen Rotation, sent by the app's command channel like rotation. And in Home Assistant, a
  **switch** on the tablet's ESPHome device (`switch.<tablet>_airplay`), so an automation can open it for a party and
  close it after.
- **The name it advertises:** the tablet's own name ("Kitchen Kiosk"). Decision 3 is whether to offer another.
- **A code on screen:** not a setting (decision 4); the receiver can still do it, switched on over adb only.
- **What it can be sent:** mirroring, video, sound: three switches under AirPlay, all on (each is a feature bit in the
  advertisement; off means the sender's picker doesn't offer it).
- **Home Assistant sees it:** a **sensor** `sensor.<tablet>_airplay_state` (Off / Idle / Mirroring / Playing Video /
  Playing Audio), so an automation can, say, dim the lights when a mirror starts; and HK's Sleep Screen reads it (a
  mirror or a video counts as another app in front).

## The receiver, as it will be built

- **Native code by the NDK and JNI**, a Gradle module of its own (`:airplay`), GPL-3.0 with its LICENSE, as in the
  prototype: UxPlay as a submodule pinned to a release, the Android port's patches applied before CMake, arm64 only
  (every house tablet). OpenSSL linked statically and the libraries stripped.
- **Video:** H.265 offered when the tablet has a hardware decoder (the Loft has a low-latency one), else H.264.
  MediaCodec decodes onto the mirror's surface through the port's GL pipeline, which survives the surface coming and
  going (a sender sends a keyframe only at the start, so the decoder can't wait for the view). Its cost is one GPU
  copy a frame; whether decoding straight onto the SurfaceView is worth the risk is for step 0's numbers. **The decoder
  is drained every 4 ms on a thread of its own**, not only when the next frame arrives (a still sender sends few
  frames, and the last one would wait in the decoder for the next).
- **Audio:** AAC-ELD with a mirror, ALAC or AAC-LC on its own; AAC by MediaCodec, ALAC by FFmpeg's decoder, played
  through Oboe at the tablet's own volume times the sender's. On the house's tablets the media stream is the one
  Volume already sets (a bathroom's follows its fan).
- **mDNS:** NsdManager, as built. The receiver's identity (its key and MAC-like id) is made once and kept, so a
  sender's remembered code survives a restart.
- **Off means off:** no advertisement, no port open, no threads.

## Decisions for the owner (answered 2026-11-13)

1. **Is this worth the app's weight and the license?** The receiver is GPL-3.0 code linked into the app, which makes
   the app's build a GPL-3.0 work. For an app built by the owner and installed only on the house's own tablets, the
   GPL asks nothing: its duties (source to whoever receives a copy) start when a copy is given to someone else. If the
   app were ever given out (a friend's house, a store), it would have to go out under the GPL with its source. The
   APK triples in size (8.5 to ~20 MB after stripping). The FairPlay part is a reverse-engineered library UxPlay itself
   calls legally unclear, as every non-Apple receiver's is. *Recommended: yes, kept in its own module and off by
   default*, so the app without it stays what it is; and if the app is ever given out, it goes as GPL-3.0 then.
   **Answered: yes.** "That's fine." 
2. **What it offers: mirroring only, or mirroring, video and sound.** *Recommended: all three*, each a switch. Sound
   alone costs nothing extra (the same code), and a guest's music on the kitchen tablet is the likeliest use after a
   mirror. Video is YouTube only; the rest falls back to a mirror. **Answered: all three, each a switch.**
3. **The name.** *Recommended: the tablet's own name* ("Kitchen Kiosk"), since that is how the house already names
   it. The alternative, a name of its own per tablet ("Kitchen Display"), is one more field. **Answered: the tablet's
   own name.**
4. **A code on screen.** *Recommended: off*, as the house's Apple TVs are (anyone on the house's Wi-Fi can already
   mirror to those). On for a tablet in a room where a stranger's phone appearing would be unwelcome. **Answered: off**
   ("Off, let's make it easy"). The code stays an adb switch only (`--ez pin true`), not a setting.
5. **Sound with HomePods and Music Assistant (the "AirPlay 2" and "AirPlay 1" the owner asked for).** Neither can come
   from the tablet alone. Three ways, from cheapest:
   - **a. Not at all:** the tablet is a speaker on its own, picked alone in the AirPlay menu. Free with the receiver.
   - **b. Music Assistant plays to the tablet** (not an iPhone in a group): MA's own players stream to the tablet the
     way it streams to its other non-AirPlay players (Sendspin, or Snapcast with the app as a client), so it can be in
     a Music Assistant group with the house's speakers. The tablet's sound joins MA's grouping, not Apple's. Its own
     phase, and mostly the Music Assistant side's work.
   - **c. A full AirPlay 2 speaker per tablet, run on the Mantel host:** shairport-sync in AirPlay 2 mode for each
     tablet that wants it (with nqptp, the PTP clock, which the LXC can run as root) advertises the tablet's name, and
     streams the sound to the tablet with a fixed delay the app plays out against Android's own audio timestamps. An
     iPhone could then put the tablet in a group with HomePods, in sync to within a few tens of ms if the Wi-Fi to the
     tablet behaves. Real work (one shairport-sync and its ports per tablet, a stream to the app, keeping it in step),
     and it brings the house's PTP troubles of 2026-11-04 to the tablets.
   *Recommended: a now*; b if the owner wants the tablets in Music Assistant's groups; c only if grouping with HomePods
   from an iPhone matters enough for a phase of its own. **Answered: a now; c later, as a piece of its own** ("It's not
   super needed, but if we can do AirPlay 2 that would be great!"). See "Later: AirPlay 2 through the Mantel host".
6. **Sleep Screen during a mirror.** *Recommended: a mirroring tablet stays on.* Sleep Screen (and the curtain's
   timeout) leave it alone until the mirror ends, then their usual timeouts start over. The alternative is that the
   house's rules win and a mirror goes dark at the usual time. **Answered: yes, a mirroring tablet stays on.**
7. **Where it's turned on first.** *Recommended: the Loft*, for a week, then any tablet the owner switches on.
   **Answered: a control in Home Assistant through ESPHome, off by default on every tablet** ("It should have a control
   in HA for ESP. It should be off by default."): `switch.<tablet>_airplay`, a config switch beside `screen_rotation`
   and Kiosk mode, as well as Mantel Settings' AirPlay switch.

## Later: AirPlay 2 through the Mantel host

Decision 5's option c, wanted but not needed: for each tablet that wants it, shairport-sync in AirPlay 2 mode on the
Mantel host (with nqptp, the PTP clock, which the LXC can run as root) advertises a name of its own (the tablet's, with
the app's own receiver then offering mirroring and video only, so an iPhone sees one speaker), and streams PCM to the
app, which plays it a fixed delay late against Android's audio timestamps (`AudioTrack.getTimestamp`). Then an iPhone
can group the tablet with HomePods. Its own plan when it's picked up: one shairport-sync and its ports per tablet, the
stream to the app and its delay measured on the Loft against a HomePod, and what a tablet does when the host is down.

## The build, in steps

0. **The Loft's numbers** (waiting on the owner): mirror an iPhone or iPad to `Loft Kiosk` for four minutes with
   something moving (a muted video, or a clock page), then read them over adb:
   `am broadcast -a com.jazzphone.mantel.android.AIRPLAY -n com.jazzphone.mantel.android/.AdbControl` (its `last:`), and
   the CPU of the decoder and SurfaceFlinger beside the app's, and the tablet's temperatures. Bar: 60 fps held, under
   150 ms from capture to decoded, under a core more than the page alone, the skin under 40 °C.
1. **The module for good:** stripped, OpenSSL static, decode straight to the surface, the decoder drained on its own
   callback, the identity kept. JVM tests of the receiver's state (mirror, sound, code, off).
2. **The screen:** the mirror layer, waking, the curtain, kiosk mode untouched, a mirror over a sheet or a camera
   pop-up; Sleep Screen as decision 6 says.
3. **The settings:** Mantel Settings' AirPlay group (`web/shim/settings/tablet-app.js`, the command channel, `hk_core`
   for what's kept), the ESPHome switch and sensor, HK's kiosk app sensor. With tests.
4. **Video:** the HLS player for YouTube links (Media3, as the port does), over the page like a mirror.
5. **On the Loft again:** an iPhone, an iPad and a Mac each mirroring; the Mac as a separate display; YouTube's AirPlay
   button; sound alone from Music at volume 0 and then, with the owner's OK, out loud; a code on screen; the switch off
   (nothing advertised).

## The prototype (mantel-android, branch `airplay`)

- `airplay/`: the module. `src/main/cpp/` is the Android port's native layer (`native_bridge.cpp`, the callbacks, the
  dnssd shim, the audio engine) with UxPlay, libplist, openssl-cmake and FFmpeg as submodules at the port's pins;
  `AirPlayReceiver.kt` is Mantel's: start and stop, the advertisement, the session's events, each mirror's numbers. The
  port's renderers are copied with their package renamed, plus a delay measure in `VideoRenderer`.
- `app/.../AirPlay.kt`: runs the receiver with the process when the switch is on; a mirror wakes the screen and shows
  the mirror layer (`MainActivity.showMirror`); a code shows full screen until the mirror starts.
- **Off unless switched on over adb:**
  `am broadcast -a com.jazzphone.mantel.android.AIRPLAY --ez on true -n com.jazzphone.mantel.android/.AdbControl`
  (`--ez pin true` for a code; `--ez on false` to stop). The result is the receiver's numbers.
- Built with the NDK 27.0.12077973 and CMake 3.22.1 from the SDK manager; the first build compiles OpenSSL and FFmpeg
  (a few minutes).

## Build log

- 2026-11-13: research, the prototype (mantel-android `airplay`, bf0e06b), the iPad's mirror on the Loft (above). The Loft's media volume was at 0 for every
  test and is back at its 6 of 15; the receiver is off.
- 2026-11-13, after the owner's answers: steps 1-4 built.
  - **The app** (mantel-android main): the `:airplay` module stripped and OpenSSL linked into it (the native libraries
    9 MB → 7 MB; the APK 20.9 MB with ExoPlayer), the decoder drained on its own thread, YouTube's video links played by
    ExoPlayer on a surface of their own, the three offers each a switch, `switch.<tablet>_airplay` (config, off by
    default) and `sensor.<tablet>_airplay_state` over ESPHome, the app's commands (`airplay`, `airplay_mirroring`,
    `airplay_video`, `airplay_audio`) and status, and the curtain and a screen-off waiting while a mirror or a video is
    up.
  - **Mantel** (main): the commands and status in `apps/tablet_app.py`, the AirPlay group in
    `web/shim/settings/tablet-app.js`, Sleep Screen's `AIRPLAY_HOLDS` (`hk_core/sleep/engine.py`), tests.
  - **Checked on the Mac's emulator** (a copy of the app beside the one there, removed after): the receiver starts
    with OpenSSL linked in and answers `GET /info` (its key, features, a 1920 × 1200 display at 60 fps); over
    ESPHome, as Home Assistant connects, the switch and the sensor are listed, and the switch off and on stops and
    starts the receiver (the sensor Idle → Off → Idle). Not checked: a mirror, a video or sound through this build
    (a sender is the owner's: step 0 and step 5).
