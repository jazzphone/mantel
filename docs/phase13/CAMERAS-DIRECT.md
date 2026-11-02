# Phase 13: cameras without Home Assistant in the middle (plan, 2026-11-02)

**Status: plan, waiting on the owner's answers to the decisions below.**

## The ask (the owner, 2026-11-02)

- Should Mantel talk to the UniFi Protect NVR directly instead of going through Home Assistant? The owner expects
  little gain under the HA App but a real one on the LXC or Docker.
- Setup should be simple. It could even turn on person, vehicle and animal detection, or motion detection for
  cameras without those AI options.
- People without UniFi should be able to add an RTSP stream and link motion to it from HA's entities.
- "This may not be worth the effort... HA already has it figured out."

## The answer, in short

**Worth it on the LXC and Docker, where the house is heading. Not worth it under the HA App. Not worth building our
own detection.**

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
- **Talk-back** already works through Mantel Link in HA (`hk_core/link/talk_live.py`, which uses the public talkback
  session). Moving it is optional (phase 5).
- **Our own detection.** Frame differencing fires on shadows, rain and bugs. Real person and vehicle detection wants
  an iGPU and is Frigate's whole job. For an RTSP camera, linking an HA sensor (Frigate's included) covers it.
- **Protect cameras without AI** already do motion in Protect, and that motion arrives on the same websocket. For
  person and the rest, the editor says the camera needs an AI model or an AI Port, rather than faking it.

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
5. **Detection, per camera.**
   - The camera's page shows the smart types that camera supports (person, vehicle, animal, package, license plate;
     audio types too).
   - The owner turns types on or off (`PATCH /v1/cameras/{id}` `smartDetectSettings`).
   - Motion is always there.
   - Zones open Protect.
   - A camera with no AI says what it can do (motion) and what would add the rest.

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
| 0 | The owner answers the decisions. Check the house's console firmware: the public API needs Protect 7.2.105+, the same floor as HA's integration. | session |
| 1 | Sources: the registry, `camera.mantel_*` ids, dispatch in `authz.py` and `camera_still.py`, go2rtc stream registration, the signaling shape for go2rtc, a spike playing one Protect camera on iPad Safari and the wall tablet | session (RBAC and ids: delicate) |
| 2 | Protect connector: the settings page, the pinned trust, discovery, RTSPS into go2rtc, snapshots, the events websocket into `rules.py`, health, matching to HA cameras and Video From | session, with a Sonnet 5.5 high agent for the API client and its tests against recorded payloads |
| 3 | Detection settings per camera; zones link to Protect | Sonnet 5.5 high, from a written spec |
| 4 | RTSP cameras: Add Camera, Test, secrets, linked HA sensors | Sonnet 5.5 high, from a written spec |
| 5 | Measure the doorbell from ring to sheet, HA against direct, and write it down; optionally move talk-back to the direct session; the guide (Cameras, Connections), OPERATIONS.md, both changelogs | session, a Sonnet agent for the docs |

This waits on the house's move to the LXC (`mantel-lxc-ssh-key` memory) for its real test. Phases 1 to 4 can be built
and tested against the Docker stack on a computer, with the console on the LAN.

## Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| 1 | Build the direct path for Docker and LXC only, with the HA App staying on HA? | Yes |
| 2 | A camera that both HA and Protect know shows once, with Video From defaulting to Direct? | Yes |
| 3 | No detection of our own: Protect's motion and smart types, or a linked HA sensor (Frigate included) for RTSP? | Yes |
| 4 | Detection settings: types on and off in Mantel, zones in Protect? | Yes |
| 5 | Talk-back moves to the direct session too, or stays in Mantel Link? | Stays for now; phase 5 decides |

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
