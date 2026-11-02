# Phase 13: cameras without Home Assistant in the middle (plan, 2026-11-02)

**Status: plan, waiting on the owner's answers to the decisions below.**

## The ask (the owner, 2026-11-02)

- Should Mantel talk to the UniFi Protect NVR directly instead of going through Home Assistant? The owner expects
  little gain under the HA App but a real one on the LXC or Docker.
- Setup should be simple. It could even turn on person, vehicle and animal detection, or motion detection for
  cameras without those AI options.
- People without UniFi should be able to add an RTSP stream and link motion to it from HA's entities.
- "This may not be worth the effort... HA already has it figured out."

The owner's follow-up the same day:

- **No AI detection built in Mantel.** Use the camera's own person, vehicle and animal detection, which is AI
  built into the camera, or the camera's standard motion detection when it doesn't support those.
- **Proper push-to-talk for the doorbell.**
- **An HTTPS check in Settings**, or at least a note pointing to it, since the microphone needs HTTPS.

## The answer, in short

**Worth it on the LXC and Docker, where the house is heading. Not worth it under the HA App. Mantel detects
nothing itself: the camera does, and Mantel uses what the camera reports.**

The LXC and Docker stack already has nearly everything a direct path needs:

- its own go2rtc with ffmpeg (the `transcode` container);
- a runtime API for adding streams, as Live TV uses (`live_tv.py`);
- `/go2rtc/` behind Mantel's sign-in and RBAC;
- WebRTC on 8555;
- an `egress` network meant "for cameras and the tuner" (`packaging/compose/compose.yaml:21`).

Protect's public Integration API gives the rest with one API key: cameras, RTSPS URLs, snapshots, the
events websocket (ring, motion, person, vehicle, animal, package), and which smart types are enabled. HA's own
integration is moving onto the same API (uiprotect 25), so we would be on the supported road, not the private one.

The HA App ships no media server and reaches HA over the supervisor network. There, video through HA's go2rtc is
already the shortest path, so it stays.

## What it wins

- **Setup without HA.** A Docker or LXC house gets cameras, the doorbell and detections from a host and an API key.
- **Fewer hops for events.** The ring and detections come straight from the console's websocket, not through HA
  entities, so the doorbell sheet should come up sooner. Measure it (phase 5) rather than promise it.
- **Fewer workarounds.** Some code exists only because video goes through HA, and its HA-only parts fall away for a
  direct camera:
  - Protect's snapshot size tiers;
  - the token retries after an HA restart;
  - the remounts when HA's go2rtc restarts (`hk-cameras.js:612-915`).
- **One road for RTSP cameras.** A direct-source registry makes "add an RTSP stream" the same code, without HA's
  generic camera.

## What it doesn't

- **Zones and masks** aren't in the public API, and neither are plate text or face names. Those stay in Protect's
  app, and Mantel links to it.
- **Detection of our own.** None, by the owner's word. A Protect camera's smart detections are the camera's own AI,
  and a camera without them still reports motion; both arrive on the same websocket. For an RTSP camera, an HA
  sensor linked to it covers detection, Frigate's included.

## Today's path (from the code)

- **Stills:**
  - `/api/camera/<id>/still` fetches HA's `camera_proxy` with Mantel's credential and drops HA's token
    (`connectors/camera_still.py`).
  - Tablets share one fetch for 2 s (`STILL_SHARE`).
  - Notification snapshots are kept 10 minutes (`notify_snaps.py`).
- **Live video:**
  - HA's `camera/webrtc/*` signaling is relayed through Mantel (`connectors/camera.py`, the allowlist in
    `ha_client.py:42`).
  - Media flows from HA's go2rtc straight to the tablet.
  - At most 16 offers per socket and 64 in all.
- **Events:**
  - binary_sensors ending `person/vehicle/animal/package…_detected`, and `event` entities
    (`hk_core/notifications/rules.py:31-37, 95-110`).
  - The Doorbells rule pops `#doorbell`.
  - `accessories.py:99` suggests the trigger from the camera's own HA device.
- **Ids:**
  - `authz.py:419` and `camera_still.py` require `camera.<id>`.
  - Every camera surface keys on HA entity ids: the strip, the Cameras page, room snapshots, the Side Pane, the
    Home Grid block and the doorbell sheet.

## The design

### Camera sources

- A camera has a **source**: `ha` (today's), `protect` or `rtsp`.
- Mantel ids stay entity-shaped so the surfaces, RBAC and Home Grid need no new kind:
  - HA cameras keep `camera.<id>`;
  - direct ones are `camera.mantel_<slug>`; an HA entity with the same id is refused at setup and named, not
    shadowed.
- `authz.py` and `camera_still.py` dispatch on the source.
- **The same camera twice.** HA's unifiprotect device identifiers carry the Protect camera's id and MAC. When a
  direct Protect camera matches an HA camera, Mantel shows one camera, with **Video From: Direct / Home Assistant**,
  defaulting to Direct. Areas and names come from HA when it has the camera; otherwise they are set in Mantel.
- **Stills:** direct cameras use Protect's `snapshot` (`highQuality` for full screen), or go2rtc's `frame.jpeg` for
  RTSP. They share fetches as today.
- **Video:** go2rtc streams are registered through the runtime API and offered over the same WebRTC signaling
  shape, so `hk-cameras.js` keeps one player. Live TV already plays from this go2rtc on the tablets. Confirm iPad
  Safari early (phase 1).

### UniFi Protect connector (Mantel Settings → Connections → UniFi Protect)

1. **Address and API key.** The key is made in Protect: Settings → Control Plane → Integrations. It is a full-admin
   key, so it is stored like the other secrets and never shown again.
2. **Trust.** The console's self-signed certificate is pinned on first connect. The page shows its fingerprint, and
   a changed certificate stops the connection and says so.
3. **Cameras.**
   - Mantel lists the console's cameras with their stills and picks the ones to use.
   - It requests their RTSPS streams (`POST /v1/cameras/{id}/rtsps-stream`) and registers each in go2rtc as
     `rtspx://host:7441/<token>`, with no SRTP.
   - High quality is for full screen and the low channel for tiles.
4. **Events.**
   - One `wss …/v1/subscribe/events` connection, with reconnect and backoff, health under Connections, and the
     current status line pattern.
   - Ring, motion and smart detections become Mantel's own event kinds, feeding `rules.py` beside the HA kinds.
     Doorbells, notifications and Live Camera Follows then work without an HA automation.
5. **What each camera reports: the camera's own detection, nothing of Mantel's.**
   - A camera whose model supports smart detection (its feature flags list the types) gives Person, Vehicle and
     Animal, plus Package on a doorbell. Mantel uses whichever types are on in Protect.
   - A camera without smart detection gives **Motion**, its standard motion detection, and the camera's page says
     that is what it has.
   - Each camera's page has **Notify For:** the types that camera has, or Motion. It picks which of the camera's
     events become Mantel's notifications and doorbell pop-ups, using the rules `rules.py` already has.
   - A supported type that is off in Protect shows **Turn On in Protect**, which sets only that camera's own
     setting (`PATCH /v1/cameras/{id}` `smartDetectSettings.objectTypes`; decision 4). Zones, sensitivity and
     masks stay in Protect's app, linked.

### Talking at the door

**Today:**

- The doorbell sheet's hold-to-talk sends raw PCM from the tablet's microphone to Mantel's `/ws/talk`
  (`talk_relay.py`).
- Mantel relays it to Mantel Link in HA (`mantel/talk/live`). Link opens Protect's talkback session, encodes Opus
  with PyAV through `hk_core/link/talk_live.py`'s Pacer, and sends RTP to the camera's UDP 7004.
- Each press waits up to 4 s for the chain (`actions.liveWaitMs`). If the session doesn't open, the card falls
  back to a recorded clip.
- The talk button is only drawn when the page is a secure context (`hk-cameras.js:2701`). On plain HTTP it simply
  isn't there, and nothing says why.

**Direct, on Docker and LXC:**

- Mantel opens the talkback session itself (`POST /v1/cameras/{id}/talkback-session`) and runs the same Pacer and
  encoder. HA and Link drop out of the chain.
- `talk_live.py` splits into a pure core (the Pacer and the encoder, with no `homeassistant` import) and the HA
  wrapper. The server image gains PyAV, whose wheels bring their own ffmpeg libraries; the session checks the image
  size it adds.
- `mantel-server` already sits on the `egress` network, so it can reach UDP 7004 on the camera.

**"Proper" push-to-talk, on both paths.** These are card changes, so the HA App's path gets them too:

- **Ready before the press.** The talkback session opens when the doorbell sheet opens, kept warm while it shows,
  so the first word isn't clipped and the press doesn't wait on the chain. The 120 s cap stays, and closing the
  sheet ends the session.
- **Hold, or tap to latch.** Hold to talk as today, or tap once to keep talking with your hands free, then tap
  again to stop.
- **A conversation, not a walkie-talkie.** The visitor's audio keeps playing while you talk, lowered, with the
  browser's echo cancellation on. That stops the door from hearing itself.
- **Clear states on the button:** Connecting, Talking, Someone Else Is Talking (with the tablet's name), Can't Reach
  the Doorbell, and Needs HTTPS.
- **One talker at a time** across tablets and phones. A second press shows who is talking instead of fighting over
  the speaker.
- **The fallback clip** stays for speakers that aren't Protect's.
- **Who may talk** is unchanged: `camera.talk` (`authz.py:54-67`).

Measure press-to-sound and ring-to-sheet on the house, today's path against direct, and write both down (phase 5).

### The HTTPS check

A browser gives the microphone only to a secure page: HTTPS with a certificate the tablet trusts, or localhost.

- **Settings → About gets a row, Secure Connection.** It reports:
  - this screen's `isSecureContext`;
  - Mantel's access mode, whether built-in HTTPS, behind your own proxy, or plain HTTP (`__main__.py:172`);
  - the address in use against the public URL.
- **The same row lists each wall tablet** that last connected without a secure context. Tablets report
  `isSecureContext` and the origin they loaded with their presence. Each listed tablet gets the fix: open Mantel by
  its `https://` name, not its IP address, in Fully Kiosk's Start URL.
- **The doorbell page and each camera's page** show "Talking at the door needs HTTPS. See Settings → About →
  Secure Connection." whenever a tablet that would show that doorbell can't talk.
- **On the doorbell sheet**, an insecure page draws the talk button off, with Needs HTTPS. An Owner or Admin can tap
  through to the row.

The check can ship on its own before the direct path, because it fixes a silent failure in today's path too.

### RTSP cameras (Mantel Settings → Cameras → Add Camera)

- **Name, area and RTSP URL.** The user name and password are separate fields kept as a secret, never in the shown
  URL or in logs.
- **Test** draws a still from go2rtc before saving, and states plainly what it couldn't play (codec, auth,
  unreachable).
- **Motion, Person, Doorbell:** pick any HA `binary_sensor` or `event` entity, with today's picker
  (`accessories.py`'s suggestion pattern; Frigate's sensors work here too). Without HA there is no motion source,
  and the page says so.

### Where it runs

| Mode | Direct Protect | RTSP cameras |
|---|---|---|
| Docker, LXC | yes | yes |
| HA App | no: the row says cameras come from HA's UniFi Protect integration and links to it | no: HA's Generic Camera, linked |

## Phases

| | What | Who |
|---|---|---|
| 0 | The owner answers the decisions. Check the house's console firmware: the public API needs Protect 7.2.105+, the same floor as HA's integration. Measure today's press-to-sound and ring-to-sheet on the house. | session |
| 1 | The HTTPS check: the About row, tablets reporting their secure context, the notes on the doorbell and camera pages, Needs HTTPS on the sheet. Works on every mode and can release alone. | Sonnet 5.5 high, from a written spec |
| 2 | Push-to-talk on the card: the warm session, tap to latch, the visitor ducked under echo cancellation, the button's states, one talker at a time (the relay and Link keep a per-speaker lock). Released on today's HA path first. | session |
| 3 | Sources: the registry, `camera.mantel_*` ids, dispatch in `authz.py` and `camera_still.py`, go2rtc stream registration, the signaling shape for go2rtc, a spike playing one Protect camera on iPad Safari and the wall tablet | session (RBAC and ids: delicate) |
| 4 | Protect connector: the settings page, the pinned trust, discovery, RTSPS into go2rtc, snapshots, the events websocket into `rules.py`, health, matching to HA cameras and Video From; each camera's Notify For from its own detection or its motion, and Turn On in Protect | session, with a Sonnet 5.5 high agent for the API client and its tests against recorded payloads |
| 5 | Direct talk: `talk_live.py` split into core and HA wrapper, PyAV in the server image, Mantel opening the talkback session itself; measure press-to-sound and ring-to-sheet against phase 0's numbers | session (audio timing is delicate) |
| 6 | RTSP cameras: Add Camera, Test, secrets, linked HA sensors | Sonnet 5.5 high, from a written spec |
| 7 | The guide (Cameras, Connections, Wall Tablets' HTTPS), OPERATIONS.md, both changelogs | Sonnet 5.5 high |

Phases 1 and 2 help the house as it is now, under the HA App. The direct path, phases 3 to 6, waits on the house's
move to the LXC (`mantel-lxc-ssh-key` memory) for its real test. It can be built and tested against the Docker stack
on a computer, with the console on the LAN. Every talk test plays sound at the front door: tell the owner before each
one (`ask-before-playing-sound` memory).

## Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| 1 | Build the direct path for Docker and LXC only, with the HA App staying on HA? | Yes |
| 2 | A camera that both HA and Protect know shows once, with Video From defaulting to Direct? | Yes |
| 3 | No detection of our own: the camera's smart types, or its motion, or a linked HA sensor for RTSP | **Decided** (the owner, 2026-11-02) |
| 4 | **Turn On in Protect** for a supported type that is off, or leave Protect's settings to Protect's app entirely? | Offer the button; it only sets the camera's own setting |
| 5 | Talk goes direct on Docker and LXC, with Link's path kept for the HA App? | Yes |
| 6 | Tap to latch beside hold to talk, and the visitor heard while you talk? | Yes |

## Sources

- uiprotect (public API client, the endpoints above): https://github.com/uilibs/uiprotect, https://uiprotect.readthedocs.io/
- HA's integration on the public API: https://www.home-assistant.io/integrations/unifiprotect/,
  https://github.com/home-assistant/core/tree/dev/homeassistant/components/unifiprotect
- go2rtc and Protect's RTSPS: https://github.com/AlexxIT/go2rtc/blob/master/internal/rtsp/README.md
- Frigate's detector hardware: https://docs.frigate.video/frigate/hardware/
- Not confirmed: Ubiquiti's own API reference pages didn't render, so the endpoint list comes from uiprotect's
  source. Event payload schemas, rate limits and zone access are also unconfirmed. Phase 2 records real payloads
  from the house's console first.

## Build log

- 2026-11-02: plan written from a map of Mantel's camera path and the deployment modes, plus research on Protect's
  public API, go2rtc and Frigate.
- 2026-11-02: the owner's follow-up. No detection of Mantel's own (the camera's smart types, or its motion);
  push-to-talk and the HTTPS check added as phases 1, 2 and 5, ahead of the direct path.
