# Phase 17: a one-way intercom to the HomePods (plan, 2026-11-03)

**Status: plan; nothing built.**

## The ask (the owner, 2026-11-03)

- A **card on the dashboard**. Pick a room, several rooms, or the whole house, "kind of like the speaker selector
  now", and talk. HomePods can't talk back (Apple gives no access to their microphones), but one-way is useful.
- **Both modes, one card** (the owner's addition, same day):
  1. **Live.** Hold or tap to talk. The rooms hear you a moment behind you, as you speak.
  2. **Message.** Record, play it back, re-record or cancel, then send.
- One card, one sheet, one room picker. A **Live / Message** switch on the sheet remembers each person's last
  choice.

## The answer, in short

Mantel's wall tablets, phones and iPads already capture the microphone for talking at the doorbell. This phase adds a
second use of that microphone: the audio goes to **Mantel**, and Mantel has **Music Assistant** (MA) play it on the
HomePods through MA's own announcement command.

- **One audio path for both modes.** The page sends the same 16-bit PCM either way. Mantel keeps it in a **spool** (in
  memory, never on disk) for the length of the broadcast. Live plays the spool while it fills. Message plays it
  after the person presses Send. If Live fails partway, the spool plays as a Message. Nothing said is lost, and the
  sheet says so.
- **MA fetches the audio from Mantel** over a **one-time link**, served by a tiny second listener that can serve
  nothing else.
- **Build Message first.** It rides on how MA announces to AirPlay speakers, so it is the safe mode. **Live** comes
  after a proof on one approved HomePod (slice 0). If the proof fails, Live is hidden and Message is the only mode.

What exists already:

- **The microphone.** `web/hk/cards/hk-cameras.js` opens `getUserMedia`, turns it into 40 ms of PCM with the
  `hk-pcm-tap` AudioWorklet, and sends it from a Worker with its own socket, so a busy page can't gap the audio. It
  needs a secure page (https).
- **The relay's shape.** `talk_relay.py` is a one-time gateway ticket, a socket (`/ws/talk`), the audit row first, a
  rate cap (`Bucket`), a time limit (`MAX_SESSION`), one talker at a time (the floor), and registration in `live.py`
  so a revoked person is cut off. The intercom copies this.
- **The MA connector.** `connectors/ma.py` already lists `players/cmd/play_announcement` (`player_id`, `url`,
  `pre_announce`, `volume_level`) in `MA_COMMANDS`, and the gateway treats a raw one as settings-level
  (`gateway.py` `ma_player_checks`). Server-side steps already run behind a per-request gate (`MusicRun` in
  `music.py`, allowed by `Gateway.allow`).
- **Rooms and groups.** `hk_core/music/config.py` has the rooms (`MusicConfig.rooms`), the presets ("Plays On" lists
  of rooms), the floors, stereo pairs and virtual pairs. `hk_core/music/engine.py` has `grouped()`, which reads who
  leads a group from Home Assistant's `group_members` (leader first). The picker is `HkSpeakerPickerCard` in
  `web/hk/cards/hk-media.js`, fed by `window.hkMusic` (`hk-base.js`).
- **Quiet hours.** `hk_core/notifications/dnd.py` (`notify_dnd`, `dnd_on`).
- **Roles.** `rbac.py` features and grants; `authz.py` builds a special policy for the doorbell's speaker
  (`talk_policy`), which the intercom copies for its rooms.

What's new: the `intercom` package on the server (spool, links, stream listener, relay, broadcast driver), the
rules in `hk_core/intercom/`, a Home Grid block with a sheet, a Settings page, an RBAC feature, and a microphone
permission in the iPhone app.

**Where it runs:** Mantel Server, in all three installs (HA App, LXC, Docker). It needs house commands to be **on**
(Allow Control of the House), because it makes sound in the house. It needs MA. HK Frontend inside Home Assistant
doesn't get it; its block says "Intercom needs Mantel".

## What it doesn't do

- **Hear the house.** HomePods have no microphone access. There is no reply and no two-way call. The card says
  "one-way" once, on the first use.
- **Talk to a room that Mantel can't reach through MA.** A speaker that MA doesn't have isn't offered.
- **Promise "2 seconds" in every room.** AirPlay buffers about 2 s; an idle HomePod also has to wake and connect, and
  a room that is playing music hears Live only after you finish (see "What MA does with an announcement"). The proof
  measures the real lag. The sheet says what each room will do before you talk.
- **Use MA's own live-announcement socket.** MA 2.10.9 has one (`/live_announcement`, see below). It takes one player
  per session and four sessions at a time, so "the whole house" can't use it. Not built.
- **Speak text.** No text-to-speech here. (An assistant saying "tell the kids dinner is ready" is a later idea; the
  MCP gets no intercom tool in this phase.)
- **Reach the house from outside.** The stream listener never goes through a tunnel or Ingress. A person away from
  home can still send a Message through the normal sign-in if the owner allows it (decision 8).
- **Record anything to disk.** No file is written. No audio is logged. The audit row says who, which rooms and how
  long, never what.

## What MA does with an announcement (researched 2026-11-03)

Read at tag **2.10.9** (the release the house is pinned to). Links under Sources.

| Question | Finding |
|---|---|
| How does MA fetch an announcement URL? | `AnnouncementRender._decode` runs `get_ffmpeg_stream(audio_input=url, ...)` with `-t 300`. It does **not** probe for a length first and does **not** need a finite file. The container type comes from the **URL's extension** (`url.rsplit(".", 1)[-1]`), so the link must end in `.wav`, with no query string. Only `http(s)` URLs are accepted. |
| Open-ended audio? | Fine for ffmpeg. MA's own live announcements serve a WAV whose RIFF and data sizes are `0xFFFFFFFF` (`create_streaming_wave_header`) through the same renderer. Mantel serves the same header for Live. |
| Is the clip played as it arrives? | **Depends on the speaker.** The render keeps the whole clip in memory and any number of readers read it "from the start, waiting for audio still being rendered". |
| A HomePod that is **playing** | AirPlay announces **natively** (`PLAY_ANNOUNCEMENT` is offered only while there is live audio, `AirPlayPlayer.has_live_audio`). The clip is mixed over the music, which is ducked. `_run_announcement` first awaits `render.wait_finished()` ("the whole clip is rendered up front"), then writes the whole clip to a temp file and arms one shared audible instant. So **audio plays only after the source ends**: Message-style, whatever the source. |
| A HomePod that is **idle** | No native support, so the controller uses `_play_announcement`: stop what is loaded, set the announcement volume, `play_media` of MA's own `/announcement/<player>.<fmt>` URL, wait, restore power/volume/music. That stream reads the render **while it is still filling**. This is the only path where Live can be live. |
| Time limits | `DEFAULT_RENDER_TIMEOUT` is **30 s** for `wait_finished`. A source longer than that, on the native path, gets a duration measured at 30 s, so the volume restore and the return are early. `MAX_ANNOUNCEMENT_SECONDS` is 300, the chime 30. |
| One fetch for many rooms? | Yes. A render is keyed by `announcement_url|chime`, so every player announcing the same URL shares **one render and one fetch**. HEAD probes go to MA's own `/announcement/...` URL, not to ours. |
| Does the call block? | Yes. `play_announcement` returns when the clip has finished playing ("the provider only returns once the announcement finished"). Mantel's `MaClient._call` times out at 30 s, so the intercom needs a per-call timeout (slice 17.1). |
| The group trap | Announcing to an **ad-hoc sync leader** plays on its whole group (`_live_members`: "An ad-hoc leader has no entity above it, so it IS the group handle"). A member announced alone plays alone (native), or is ungrouped and re-grouped (fallback). This is the 2026-11-02 incident (a bedtime message played house-wide). The intercom must never send to a leader whose members are not all in the broadcast. |
| Volume | `volume_level` per call; the native path bumps and restores it inside the ducked lead-in and tail. |
| A live-announcement WebSocket exists | `/live_announcement`: auth with an MA token, `start` with one `player_id`, binary PCM, any text ends it. It buffers the whole clip and announces it **after** the end, "AirPlay renders it to a file and schedules one synchronized instant ... which a growing clip cannot give". Max 4 sessions, 300 s. The MA authors chose record-then-play for AirPlay. That is Message mode. |
| `play_media` of a URL | `builtin` `parse_item` probes the URL; a source with no duration becomes a **Radio** item. A live "radio" stream through `player_queues/play_media` is a possible route to live audio on playing rooms, but it replaces the room's queue and must be resumed. **Not built**; it is the first idea if the proof shows the idle path isn't good enough and the owner wants more (decision 15). |

What this means:

- **Message** works everywhere MA announces: idle rooms, rooms playing music (ducked, mixed in, in step across the
  rooms), stereo pairs. It is the safe mode.
- **Live** is live only in rooms that are **idle** when you start. A room playing music, or marked Message-only,
  plays the broadcast **after you finish**, as a Message, ducked. The sheet shows this per room before you talk.
- Mantel serves a **finite WAV** for a Message (real sizes) and an **open-ended WAV** for Live.

## The design

### The two modes and the one audio path

| | Live | Message |
|---|---|---|
| Gesture | Hold the mic, or tap to start and tap to stop | Tap to record, tap to stop, then **Play**, **Re-record**, **Cancel**, **Send** |
| Page sends | 40 ms PCM frames as you speak | The same frames, as you record |
| Mantel does | Appends to the spool; MA is told at the first frame | Appends to a **draft** spool; MA is told at Send |
| Rooms hear it | Idle live-capable rooms as you speak; others after you finish | Every room at once, after Send |
| Longest | 60 s (decision 4) | 30 s (decision 4) |
| The sender's room | Left out (echo) | Can be included |
| If it fails | The spool plays as a Message, automatically | The page keeps its copy; Send Again |

**The spool** (`intercom/spool.py`): a `bytearray` of PCM at the page's rate, a `Condition`, a cursor-per-reader
generator (`read()`, as MA's own session does), `finish()`, `to_wav()`, `seconds`, and a byte cap from the mode's
length. At 24 kHz mono 16-bit it is 48 KB/s: 2.9 MB for a full Live, 1.4 MB for a full Message. At most one playing
broadcast and 8 drafts exist (about 25 MB worst case). A spool is dropped when its broadcast ends (or its draft is
cancelled, re-recorded, abandoned for 5 minutes, or its socket drops). It is never written to disk, never logged.

**The page** keeps its own copy of what it recorded until the sheet closes. That is what Play (the review),
Send Again and the "connection dropped" rescue use. So Mantel needs no copy after the broadcast (decision 5).

**Rate.** The page asks for an `AudioContext` at 24000 Hz and says the rate it got (16000–48000 accepted, from
`TALK_RATES`). Mantel never resamples: the WAV header carries the rate and MA's ffmpeg converts. (That also avoids
PyAV, which the HA App image doesn't have.)

**Automatic fallback (Live to Message).** The broadcast driver watches each room. A room has failed when:

1. MA does not fetch the link within 8 s of the `play_announcement` call;
2. `play_announcement` returns an error;
3. the room's player is not `playing` within 10 s;
4. the fetch ends before the talker did; or
5. the call returns while the talker is still going.

When the talker finishes, Mantel mints a **new link for the whole spool as a finite WAV** and announces it to the
rooms that failed (the whole message, not the remainder: a clip that starts mid-sentence is worse). Rooms that
played live fine hear nothing twice. The sheet says, while you talk: "If Live drops, what you said is sent as a
message." and afterward: "Kitchen didn't connect live. Sent as a message." If **the page's socket** drops mid-talk,
the page opens a new one and sends its own copy as a Message. If **every** room fails (MA down), the sheet says so and
offers Send Again. The result of each room goes to the audit row.

**Per-room Live health.** Three Live failures in a row in one room switch that room to Message-only (shown in
Settings as "Live didn't work here three times. Using Message. [Try Live Again]") until the Owner resets it. Live
results are kept in memory and in the room's settings row; they are never about content.

### The sheet (`web/hk/cards/hk-intercom.js`)

- **The card** is a Home Grid block, `intercom`, sizes **S** (a button that opens the sheet) and **W** (the button
  plus the last rooms picked as chips). Added to `web/hk/cards/hk-grid-catalog.js` and mirrored in
  `hk_core/settings/home_grid.py` `CATALOG`; `tests/test_hk_core_home_grid.py` keeps them equal. In HK Frontend (no
  server) the block draws the usual `stand()` placeholder.
- **The sheet** (opened by the block, a `#intercom` address, and the app's menu) from top to bottom:
  1. **Live / Message** switch (remembered per person, `user_data` key `intercom`; decision 2 sets the first value).
     Hidden when Live isn't offered.
  2. **Rooms:** floor chips (`hkMusic.floors()`), preset chips (dashed border, as the speaker picker does),
     **Whole House**, then room pills in the picker's grid. A pill carries a small state glyph: `waveform` (live
     now), `clock` (after you finish: playing music or Message-only), `moon` (quiet hours, skipped), `slash` (leads
     other rooms' music, skipped), `person` (you're here, left out in Live). Tapping a skipped pill says why in one
     line. The selection is the card's own Set; it never touches the music focus.
  3. **The big mic button.** Live: hold, or tap-on/tap-off. Message: tap to record, with a level meter and a
     timer counting down to the limit; then **Play**, **Re-record**, **Cancel**, **Send**.
  4. **One status line:** "Connecting...", "Live, about 4 s behind you", "Kitchen, Office: after you finish",
     "Sent to 3 rooms", "Kitchen is announcing", "Needs HTTPS: open this page by its https:// address" (the doorbell
     card's words for a plain-http page).
- **Touch and WebKit.** The owner's main device is an iPad in Safari, so: pointer events with `pointercancel`, no
  hover states, 44 pt targets, the AudioContext resumed inside the press, `touch-action: none` on the mic button, and
  the Worker design of the doorbell card so a stalled main thread can't gap the audio. The microphone opens once per
  sheet and closes with it.
- **The action port.** The page reaches the server through a new `client.actions.intercom(...)` (Mantel's
  `web/shim/mantel-client.js` implements it; HA's adapter doesn't). It is on the `WRITES` list and the boundary tests
  (`tests/test_boundaries.py`) are updated. No `hass` anywhere in `web/` outside the shim.
- **The microphone code.** A new `web/hk/modules/hk-mic.js` holds the PCM worklet source and the Worker for the
  intercom socket. The doorbell card is **not** changed in this phase (it works; a later cleanup can share the module).

### The audio socket (`intercom/relay.py`, `/ws/intercom`)

Modeled on `talk_relay.py`; same words where the rule is the same.

1. **The gateway command** `intercom` (a new kind in `gateway.py` `KINDS`, `classify`, `AUDIT_KIND`) carries
   `{mode, rate}`. Checks: `Check("control", feature="intercom")`. It writes the first audit row **before** anything
   is opened: kind `ma`, action `intercom.open`, target `feature:intercom` (`action_audit.kind` already allows `ma`,
   so no migration). The answer is a one-time ticket, bound to the connection's session, person and tablet, valid 10 s,
   spent once (`IntercomRelay.issue`, like `TalkRelay.issue`).
2. **The socket** is `/ws/intercom` (same-origin, session cookie, an `Origin` header, as `/ws` and `/ws/talk`;
   `auth.require_session` lists it with them). It is refused before the upgrade while commands are off. The first
   frame is `{"type":"auth","access_token":<ticket>}`; anything else is `auth_invalid` and a close.
3. **Frames:** binary `[1][s16le mono PCM]` of at most 100 ms (`talk_frame_max`), rate-capped by the same `Bucket`
   (`RATE_SLACK` 1.25, `BURST_S` 1). Text frames, only these: `{"type":"start","mode":"live","rooms":[...]}`,
   `{"type":"end"}`, `{"type":"send","rooms":[...]}`, `{"type":"cancel"}`. Anything else closes the socket (1008).
4. **Events to the page:** `{"rooms":[{"room","state"}]}` (`live`, `after`, `skipped:<why>`, `failed`, `done`),
   `{"lag_ms"}` (measured), `{"fallback":[rooms]}`, `{"busy":"<name>"}`, `{"sent":n}`, `{"error"}`.
5. **The second audit row** is written by the relay **before** it tells MA anything: action `intercom.play`, targets
   the rooms that will actually play. It re-runs the checks for each room with the stored principal
   (`Authz.refresh`, then `decide_intercom`, below). If the row can't be written, nothing plays
   (`audit_unavailable`). Both rows get a result when the socket ends: `ok`, `ok:fallback`, `ok:partial:<n skipped>`,
   `ok:discarded`, `ok:max_length`, `error:<code>`, `refused:<why>`.
6. **One broadcast plays at a time in the house.** The first sender holds the floor (as `TalkRelay.claim`); a second
   sender's Send or press is answered `{"busy": "<name>"}` ("Kitchen tablet is announcing"). A person or tablet can
   have one open socket.
7. **Ends** at the mode's limit, when the talker ends, when either side closes, on a revocation or a role change
   (`live.py`: the relay registers `kind="intercom"` with `recheck` and `needs_commands=True`, so turning commands
   off ends it too), and at the policy tick. Idle: no audio for 10 s in Live ends the talk; a Message draft with no
   activity for 5 minutes is dropped.
8. **Rate limit:** 10 broadcasts per person (or tablet) per 10 minutes, and the room list is capped at the house's
   room count.

### Getting the audio to MA: the stream listener and the one-time link

MA must fetch a URL from Mantel. Mantel's main port is behind sessions, a door check and (in two installs) a proxy.
So the intercom runs a **second listener** with its own tiny `aiohttp` application. It is the same idea as the HA App's
`--direct-port` (`direct.py` runs two `TCPSite`s on one runner), but with a separate application that has no `/api`,
no sessions, no static files and no WebSocket.

**What the listener serves.** Only `GET` and `HEAD` of `/s/<token>.wav`. Every other path or method, and every
unknown, expired, used or wrong-peer token, answers the same bare `404` with `Cache-Control: no-store` and no body.
No cookies, no CORS, no redirects, no `Server` header.

**The link.**

- `token = secrets.token_urlsafe(32)` (256 bits). Mantel keeps only `sha256(token)` as a dictionary key, in memory.
- **Who can mint one:** only `IntercomRelay`, after the gateway's checks and the `intercom.play` audit row. The page
  never sees a link; it gets a ticket for its own audio socket. Nothing else in Mantel mints links.
- **Scope:** one broadcast, one body (live spool, or the finished spool as a finite WAV). The path carries the token
  and nothing about rooms or people.
- **Expiry:** unclaimed after 20 s (Message: 30 s). Once claimed, it ends at the spool's end plus 15 s, and no later
  than the mode's limit plus 30 s. A cancelled or finished broadcast kills its link at once.
- **Single fetcher:** the first `GET` claims it and records the peer address. A later `GET` from the same peer within
  the broadcast is allowed **once** (MA retries a dropped connection). Any other peer, or a third request, gets the
  `404`. `HEAD` doesn't claim.
- **Peer check:** the peer must be a private LAN address (`direct.in_lan`), and equal to the address MA's URL resolves
  to when that URL is an IP address. A public peer gets the `404` even if the port is wrongly forwarded.
- **No replay:** a used link is gone; a restart forgets every link.
- **Body:** `audio/wav`, `Cache-Control: no-store`, `Accept-Ranges: none`. Message: real `Content-Length`. Live: chunked,
  the streaming header (`0xFFFFFFFF` sizes), then the spool as it fills; EOF when the talker ends, or after 10 s of
  no audio.
- **Checks the link can't do:** reveal the spool to a browser (the peer check), outlast its broadcast, or be minted by
  a person.
- **Threat notes for the review agent:** a leaked link is worth one fetch within 20 s from a private address; the
  token is never logged (logs say `intercom link claimed by <peer>`); MA's own log may show the URL, so the link is
  dead by the time anyone reads it.

**The address MA uses.** A setting (Owner, Settings → Intercom → **Address for Music Assistant**), such as
`http://<this host's LAN address>:8767`. It must be `http` or `https` on a private address or a `.local`, `.lan` or
`.home.arpa` name, and the listener's port. Mantel suggests the host from the address the Owner's browser used when it
is private. The listener starts only when the Intercom is turned on, and stops when it's turned off.

How MA reaches Mantel in each install:

| Install | The listener | The address MA uses | Notes |
|---|---|---|---|
| **LXC** (the house) | `--stream-port 8767`, published by `packaging/compose/compose.yaml` as `${MANTEL_STREAM_BIND:-0.0.0.0}:${MANTEL_STREAM_PORT:-8767}:8767`, in both Caddy and own-proxy modes (the listener is not behind the proxy) | `http://<the LXC's LAN address>:8767` | The port is closed until the Intercom is on. MA's host must be allowed to reach it if the network has rules. |
| **Docker** | the same compose file | `http://<the Docker host's LAN address>:8767` | Caddy isn't involved. Docker's published port keeps the real source address on a normal bridge (**unverified**, checked in 17.1). |
| **HA App** | `ports: 8101/tcp: null` in `packaging/ha-app/config.yaml`, set in the App's Network section like Direct access | `http://<Home Assistant host's LAN address>:8101` | Ingress is not used. Off until a host port is set. |
| **Any** | Never through Cloudflare, a tunnel, Ingress or HK Frontend | | The Settings page checks the address (below) and says if it isn't private. |

**Checking it without sound.** Settings → Intercom → **Check Reach** mints a link to a 0.2 s silent WAV, asks MA to
read it (`music/item_by_uri` with that URL, which `MA_READS` already allows; MA's `builtin` provider probes a plain URL
with ffprobe and plays nothing), and reports "Music Assistant fetched it" or "Music Assistant could not reach this
address". **Unverified** that `item_by_uri` takes a bare URL on MA 2.10.9; 17.1 confirms it. If it doesn't, the page's
**Send Test** (a soft chime on a room the Owner picks) is the only check, and it is the Owner's own button.

### Rooms: what can be reached, and what is left out

**An Intercom room** is one of the music rooms (`MusicConfig.rooms`, with their floors, stereo pairs and virtual
pairs) plus the house's own settings for it, in the settings document `house/intercom`
(`hk_core/settings/intercom.py` checks it; the Settings page writes it through the usual `settings_write` and
audit):

```
{ enabled: bool, live_allowed: bool, default_mode: "message"|"live",
  max_live_s: 60, max_message_s: 30, chime: {message: true, live: false},
  stream_base: "http://...:8767", lag_ms: <from the proof>,
  quiet_default: {schedule, from, to, while},          # notify_dnd shape (dnd.py)
  rooms: { "<speaker entity>": { enabled, live: bool, volume: 0-100|null,
                                 quiet: {...}|null, listeners: [tablet ids] } } }
```

Defaults for a new room: **off** (decision 7), Live on, volume Automatic (MA's own announcement level), quiet hours
the house default (21:00–07:00, decision 10).

**Before a broadcast, `hk_core/intercom/rooms.py` decides every room** (pure; it takes the `House` port and the
config, so it is tested once and the host only acts):

1. **Enabled?** A room that isn't in the list, or is off, is dropped.
2. **Allowed for the sender?** (permissions, below.)
3. **Available?** `engine.available` (not `unavailable`/`unknown`). Else `skipped:unavailable`.
4. **Quiet hours?** `dnd_on(house, room.quiet or house default)`. Else `skipped:quiet`. An Owner, Admin or Adult may
   press **Send Anyway** (the page asks again with `override: true`; the audit row records it).
5. **The sender's own room** in Live: `skipped:here` (the tablet's enrolled room, or a room that lists the tablet as a
   listener; a phone has none). In Message it stays in.
6. **The group trap.** For each remaining room `R`, `gm = engine.grouped(house, cfg, R)` (leader first). If
   `len(gm) > 1` and `gm[0] == R` and the group holds any player that isn't part of this broadcast, then announcing to
   `R` would play on those rooms too: `skipped:leads <names>`. A room that is a **member** of a group, not its
   leader, is fine: MA announces to it alone. If a room leads a group whose members are **all** in the broadcast,
   it's fine and plays in step with them. Mantel then asks MA (`players/all`, a read the connector already has) and
   applies the same rule to MA's own `group_members` and `synced_to`, so a stale Home Assistant state can't let a
   leader through. If either source can't be read, every room that might be grouped is skipped, not guessed.
7. **A stereo pair** (one room, a Music Assistant group of two players) announces to its group player. A **virtual
   pair** announces to both of its players (`MusicConfig.players_of`).
8. **Live mode only, per room:** `live` = idle now (state is not `playing` or `paused`), the room's `live` flag is
   on, and it hasn't been demoted by Live health. Everything else is `after`: it gets the Message when the talker
   finishes (ducked over music, by MA).

The result is a list `{room, state, reason}` shown on the sheet before and during the broadcast. If no room is left,
the answer is "Nothing to send to: <reasons>". The test for the trap uses a fake MA only. **It is never reproduced on
the real MA** (it would play house-wide).

Rooms Home Assistant announces to (`announce_rooms`, which `MusicConfig.leader_of` never lets lead a pick) are the
safest rooms; the check above covers every other room.

**Message-only rooms** (the room's `live` flag off) work for any MA player, including those where Live misbehaves.
They are listed in Settings with their reason ("You set this" or "Live failed 3 times").

**Chime.** MA's `pre_announce` plays its chime ahead of the voice. On for Message, off for Live (the chime would add
to the lag). Two switches in Settings.

**Volume.** `volume_level` per room per call, from the room's setting, capped by `max_volume` (default 70). MA raises
it inside the ducked lead-in and puts it back. There is no volume slider on the sheet (decision 18).

**Ducking and resuming** are MA's: on a playing HomePod the music is ducked under the clip and comes back; on an idle
one MA powers it up for the clip and restores power, volume and, if it was playing, the music. Mantel does not touch
the queue.

**Concurrency.** One `asyncio.gather` of `players/cmd/play_announcement` calls, one per player, all with the same URL
(one render, one fetch) and their own `volume_level`. A per-call timeout of the mode's limit + 90 s is added to
`MaClient` (`command(..., timeout=...)`), since the call returns only after the clip played. The gate is a new
`IntercomRun` (like `MusicRun`): it allows only `players/cmd/play_announcement`, only on the broadcast's approved
players, only with `{player_id, url, pre_announce, volume_level}` and only a URL on the stream base. `Gateway.allow`
accepts it beside `MusicRun`.

### Tablets with no HomePod

A wall tablet's room with no Intercom speaker can still be a room: the Owner lists the tablet as a **listener** of
that room (Settings → Intercom → the room → Tablets). The tablet's page then plays the broadcast itself:

- **Message:** Mantel tells the page over the hub socket (`{type:"intercom_play", id}`); the page `GET`s
  `/api/intercom/clip/<id>.wav` (a signed-in tablet, `@guard("signed_in")`, only if it is a listener of a room in this
  broadcast) and plays it with WebAudio at the room's volume. The id is the broadcast's, valid until it ends.
- **Live:** the tablet opens `/ws/intercom/listen?id=` and gets the same spool as PCM, from its own cursor, played
  through a small playback worklet with a 300 ms cushion. The tablet **delays** its playback by `lag_ms` (the lag the
  proof measured for HomePods) so a tablet and a HomePod in neighboring rooms say the same thing at the same time
  instead of echoing.
- **Echo:** a tablet that is itself speaking is not a listener of its own broadcast (rule 5 above).
- **Autoplay:** a kiosk tablet plays only if its browser allows audio without a tap. Fully Kiosk's "Autoplay audio" does;
  otherwise the card shows "Tap to hear announcements" and the first tap unlocks it. The broadcast row says which
  listeners played.

### Permissions, audit, API and storage

- **RBAC.** A new feature **`intercom`** in `rbac.py` `FEATURE_DOMAINS` (like `music`). Owner, Admin, Adult have it
  through "all". A new `HOUSE_GRANTS` entry gives wall tablets `view` and `control` on it. **Child and Guest do not**; an
  Owner can add an allow grant. Managing the Intercom (the Settings page) is `configure` on `settings`, so Owner and
  Admin.
- **Which rooms a sender may reach.** `authz.py` gets `intercom_grants(rooms)` and `decide_intercom`, copied from
  `talk_grants` / `talk_policy`: wall tablets may `control` exactly the Intercom-enabled speakers, **for the
  intercom's checks only** (music on those speakers is still their own room's). A person with an area-limited role
  (Child, Guest) is decided on each speaker by their ordinary grants. An explicit deny on a speaker still wins.
  `Check` gets an `intercom` flag beside `talk`, and `Gateway._handle` picks `decide_intercom` for it.
- **Audit.** Two rows per use, kind `ma`: `intercom.open` and `intercom.play` (above), results at the end. A refused
  room never gets a row of its own; it appears in `intercom.play`'s reasons. Settings changes go through
  `audit.config` first (`intercom.settings.saved`, `intercom.room.saved`, `intercom.live.reset`). `tests/test_route_guards.py`
  covers the new routes.
- **Endpoints:**
  - `GET /ws/intercom` (the audio socket, ticket);
  - `GET /ws/intercom/listen` (tablet listeners, ticket);
  - `GET /api/intercom/clip/{id}.wav` (listener tablets, `signed_in`, device-ok);
  - `GET /api/intercom/settings`, `PUT /api/intercom/settings`, `PUT /api/intercom/rooms/{id}` (Owner and Admin,
    `@guard("manager", fresh="away", audit=...)`, never a wall tablet's session);
  - `POST /api/intercom/check` (Check Reach) and `POST /api/intercom/test` (Send Test; the Owner, `fresh="away"`, rate
    limited);
  - the hub socket's `hk_intercom/subscribe` feed (the enabled rooms the subject may reach and their live status),
    cut down by RBAC as `hk_music/subscribe` is (`readproxy.py`).
- **The listener** is not in the router test's list of routes: it is a separate application with one route, and has its
  own test.
- **Storage.** The house settings in `house/intercom` (no migration). Per-person choices in `user_data` key
  `intercom` (`{mode, rooms}`; `user_data.py` validates it). Live health per room in the room's settings row. No audio
  anywhere. No new table.
- **Backups** carry the settings; there is no secret to seal.

### The apps

- **iPhone and iPad.** The app shows Mantel's own pages in a `WKWebView` (`apple/Mantel/HouseWebView.swift`). The
  sheet works there if the app (1) has `NSMicrophoneUsageDescription` in `Config/Mantel-Info.plist` (it has the camera
  string today, not the microphone), (2) answers `webView(_:requestMediaCapturePermissionFor:...)` in the existing
  `WKUIDelegate` coordinator by granting audio capture to the **paired house's origin only**, and (3) runs on the
  paired https address. A new button in the app's menu opens `#intercom`. Ships in the next TestFlight build.
  **Unverified** on a real phone; the Simulator's microphone is limited.
- **Mac app.** Not in this phase. The sheet works in the Mac's browser.
- **Siri/Shortcuts, widgets, Live Activities:** not in this phase (an App Intent that records speech is its own design).

### No MCP tool

The MCP gets nothing in this phase. Speaking into rooms is the one thing an assistant should do on a person's say-so in
the room, not on its own. (A read-only `intercom_status` tool can come with a later MCP pass.)

## Slice 0: the Live proof

**Why.** The research says Live can only be live on idle rooms and only if MA's idle path reads the growing render
smoothly. That's inference from source. This slice measures it on the real MA with one speaker.

**What it is.** `tools/intercom_proof.py`, a script (not part of CI, never run by CI) that uses Mantel's own
`MaClient`, spool and stream listener, and a synthetic source: a 440 Hz tone with a spoken-length beep pattern (a
1 s beep every 5 s), no voice. It needs one HomePod the owner has approved (decision 19), which must be idle. It
refuses to run unless the speaker is named on the command line with `--owner-approved`, is not listed in
`~/.config/mantel/intercom-never` (a file outside the repository, holding the players it must never touch; the
session writes it before the first run with the excluded bedroom HomePod's MA player id, the owner's standing rule,
and the script refuses if that file doesn't exist or is empty), is inside the approved hours, and the volume it sets is
at most the approved level.

**The runs** (5 times each, with 2 minutes between runs):

| # | Run | Measures |
|---|---|---|
| P1 | 20 s Live to the one idle speaker | MA fetched the link within 3 s of the call; one `GET`, one peer |
| P2 | the same | **Start lag:** from Mantel's first byte to MA's player event `playing`, plus the 2 s AirPlay buffer (stated) |
| P3 | the same | **Continuity:** times the reader waited more than 400 ms for audio MA hadn't yet pulled; MA's log (`logging/get`) for ffmpeg/AirPlay warnings in the window |
| P4 | 45 s Live | past the 30 s render timeout; the call returns within 10 s of the end; no early restore |
| P5 | after P1 and P4 | the player is idle again; volume and power are as before; the next normal play works |
| P6 | a 10 s Message (finite WAV) | the same call and link, the Message path, for comparison |
| P7 | two idle speakers (only if the owner approves a second room) | still one `GET`; both `playing` within 1.5 s of each other |

The trap is **not** tested live.

**Pass:**

- P1: link claimed in 3 s in every run.
- P2: start lag **median 4.0 s or less, worst 6.0 s or less**.
- P3: at most one 400 ms wait per run and no AirPlay/ffmpeg error in MA's log.
- P4 and P5: pass in every run.

The owner said "about 2 s". AirPlay buffers about 2 s by itself and an idle HomePod adds its wake-up, so the plan
accepts 4 s (decision 14). If the median is over 4 s but the rest passes, Live is offered with its real number on the
sheet ("about 5 s behind you") if the owner agrees in decision 14's second part; otherwise it fails.

**If it fails**, the fallback is already chosen: **Message is the only mode.** `live_allowed` is stored false, the
Live/Message switch is not drawn, and the owner's "live" wish is written up as not possible on this MA version (with
the numbers). The Live code stays behind `live_allowed` and the proof script stays, so a newer MA (2.11 is in beta)
can be re-proven by running it again.

**If the owner hasn't approved a speaker by then**, slice 0 goes to "Waiting on the owner"; Message ships and Live
ships **off**; nothing else waits.

**The result is recorded** in the Build log: the numbers, the MA version, and the speaker's name (never its address).
`lag_ms` in the house settings is set to the P2 median.

## How it's built (models and effort, the owner, 2026-11-03)

- **The building session runs Opus 5.5 at Medium effort.** It writes the broadcast driver and the group check, makes
  the design calls, and reviews what agents bring back.
- **Agents run Sonnet 5.5 at High effort** (`model: "sonnet"`, `effort: "high"`): the spool and WAV, the listener, the
  settings page, the card and sheet, the tablet listeners, the iPhone change, the tests, the guide and the screenshots,
  each with a brief that names its files and what done looks like. A **review agent** reads each slice's diff.
- **Opus 5.5 for an agent only when it really needs it.** Two cases: the **security review of the stream link and
  listener** (17.1, again after 17.5), because it is the one place Mantel serves something outside its sign-in; and the
  **group check**, because a miss plays sound house-wide. Say why in a line when choosing it.

### The session finishes everything without stopping

- Every question for the owner is in "Decisions for the owner" with a recommendation. The session takes the
  recommendation and does not ask again.
- **Something unforeseen:** take the safest choice consistent with the decisions, write it in the **Build log**
  (what, why, what the alternative was), and continue.
- **Stop only for what only the owner can physically do**, and list it under **Waiting on the owner**: approving a
  speaker's first sound, a TestFlight build, a listen to the result, the release if not already allowed.
- **Sound:** the session plays nothing on any speaker except in slice 0 (and 17.5's live check), on the HomePod(s) and
  in the hours of decision 19, at the volume and number it names. It never uses the bedroom HomePod the owner has
  excluded. Every other test uses a fake MA.
- **Validate throughout:** each slice ends with its tests and `tools/ci.py quick`; `tools/ci.py full` before each
  push. UI gets WebKit screenshots at three sizes (phone, iPad, wall tablet), touch and WebKit both, and the sheet
  review tool (`tools/headless/sheet_review.py`) gets the new sheet. A review agent reads each slice's diff. Push
  finished work to origin/main (fetch and merge, `tools/check_private.py` first, never force). Releasing to the
  house needs the owner's OK (decision 17).

## Slices

**Order:** 17.1, then 17.2, then 17.3 (Message is complete and shippable), then 17.4, then **17.0** (the proof, which
needs 17.1's listener and driver), then 17.5 (Live), 17.6, 17.7. The proof is "slice 0" because it decides 17.5, not
because it runs first.

| Slice | What | Size | Needs |
|---|---|---|---|
| 17.1 | The core: `intercom/` (spool, WAV, links, stream listener, relay, broadcast driver, `IntercomRun`, per-call MA timeout), the `intercom` gateway command and its two audit rows, the Message broadcast, compose and HA App ports, `--stream-port`; Opus review of the link | L | MA connector |
| 17.2 | Rooms and rules: `hk_core/intercom/`, `house/intercom` and its checks, the group check, quiet hours, echo rule, RBAC feature and `decide_intercom`, the subscribe feed, Settings → Intercom (rooms, address, Check Reach, Send Test) | L | 17.1 |
| 17.3 | The card and sheet in **Message mode**: `hk-mic.js`, the picker, record / review / send, the Home Grid block (both catalogs), `user_data`, the action port, screenshots | L | 17.1, 17.2 |
| 17.4 | Tablets as listeners (Message): `/api/intercom/clip`, the hub event, autoplay handling | M | 17.3 |
| 17.0 | **The Live proof** (`tools/intercom_proof.py`, one approved HomePod) | S | 17.1; an approved speaker |
| 17.5 | **Live:** the Live path in the driver, the automatic fallback, per-room Live health, the switch on the sheet, tablet listening in Live with `lag_ms`; Opus review again | L | 17.0 passed |
| 17.6 | iPhone and iPad: microphone string, capture permission for the paired house, the menu button | S server + S app | 17.3; a TestFlight build |
| 17.7 | The guide (`docs/guide/Intercom.md`, a line each in Music-and-Cameras and Security-Model), screenshots, `_Sidebar.md`, the sheet review run | S | 17.1–17.6 |

**The first release:** 17.1–17.4 and 17.7's Message parts, with `live_allowed` false. A second release adds 17.5 when
the proof has passed and the owner has listened.

## Tests

- `tests/test_hk_core_intercom.py` (rules, on fakes): every skip reason in order; the group check with a leader whose
  members are all in, partly in, none in; a member of a group; a stereo pair; a virtual pair; MA and Home Assistant
  disagreeing (the stricter wins); an unreadable `players/all` skips grouped rooms; quiet hours with a wrapped
  midnight and `while`; Send Anyway; echo in Live and not in Message; mode and limit resolution; Live demoted after 3
  failures.
- `tests/test_intercom_spool.py`: appends, cursors, a reader that waits, `finish`, the byte cap, `to_wav` sizes, the
  open-ended header bytes (equal to MA's `create_streaming_wave_header`), drop on cancel.
- `tests/test_intercom_links.py` and `tests/test_intercom_listener.py`, on a real in-process listener: the
  token is 43 characters and unguessable; only `/s/<token>.wav`; a bad, expired, used, other-peer or public-peer
  request gets the identical empty 404; the second same-peer request works once and the third does not; `HEAD` doesn't
  claim; a finished broadcast kills its link; Message has a `Content-Length`; Live is chunked and ends on EOF and on 10 s
  of silence; nothing else is routable (`/api`, `/`, `/ws`, a trailing slash, `..`, a very long path); no cookie or
  CORS header; the token never appears in a log record.
- `tests/test_intercom_relay.py`, on `tests/` fakes for the gateway and a fake MA server: ticket (10 s, once, other
  identity); first frame; frame size and rate; text frames allowed and everything else closes; two audit rows with the
  first before anything opens and the second before MA is told; **no row, no sound**; one broadcast at a time (`busy`);
  the limits (60 s, 30 s, idle 10 s, draft 5 min); a revocation, a role change and commands off all end it; Cancel,
  Re-record and a dropped socket drop the draft; `IntercomRun` allows only `play_announcement` on approved players
  with the stream base URL; the per-call timeout.
- `tests/test_intercom_fallback.py`: each of the five failure signals produces a Message of the **whole spool** to the
  failed rooms only; the page-socket-dropped rescue; every room failing; a room demoted after three.
- `tests/test_intercom_api.py`: roles (Owner, Admin, Adult, Child, Guest, wall tablet), the area-limited Child, deny
  wins, step-up (`fresh="away"`), CSRF, audit-first, never a wall tablet's session, route guards.
- `tests/test_intercom_settings.py` (node): the Settings page; and the card/sheet tests in node plus a headless
  WebKit check (`tools/headless/intercom_check.py`): the picker (floors, presets, Whole House, state glyphs), the mode
  switch remembered per person, record / review / re-record / cancel / send, the status lines, the https note, touch
  events on the iPad profile.
- `tests/test_hk_core_home_grid.py` (the mirror), `tests/test_boundaries.py`, `tests/test_route_guards.py`.
- A MantelKit/UI test is not needed for the app change; it is built for the Simulator and the permission is checked by
  reading `Mantel-Info.plist` and the delegate in a unit test of the plist.
- Run with `tools/ci.py` (quick while building, full before pushing).

## Verification

- **Fake MA end to end** (`tools/e2e/`-style, no sound): a headless page records a synthetic tone, the relay spools it,
  the fake MA fetches the link, and the test checks the bytes it received equal the tone, the audit rows, the room
  states, the fallback and the demotion.
- **WebKit at three sizes** (phone, iPad, wall tablet): the card, the sheet in both modes and every state, the Settings
  page; shots go to `tools/headless/gallery.py` (seeded with fictional rooms and tablets): `intercom-block`,
  `intercom-sheet-message`, `intercom-sheet-review`, `intercom-sheet-live`, `intercom-picker`, `settings-intercom`,
  `settings-intercom-room`.
- **The real thing, once, with the owner's OK:** slice 0 (Live proof), then a 10 s Message to the approved speaker
  playing music (ducked) and idle. These are the only sounds.
- **Not verifiable here:** a real phone's microphone through the app; Fully Kiosk autoplay on a wall tablet; whether the
  listener keeps the source address in the Docker bridge.

## Definition of done

- Message mode works from a wall tablet, a phone's browser and an iPad's Safari, to one room, several, a preset and the
  whole house, with the checks above, in all three installs' packaging (the ports exist and `tools/package_check.py`
  passes).
- The group check is covered by every case in the tests, and no test or script has ever sent to a real group.
- Live works if the proof passed, with the fallback tested for each failure signal; if the proof failed or was not run,
  Live is hidden or off and the Build log says why.
- Every route has its guard; `tools/ci.py full` is green on the pushed commit; the review agent's findings are fixed or
  recorded.
- The guide page and screenshots are in, with fictional rooms only. `tools/check_private.py` finds nothing.
- The Build log is written, the owner's remaining steps are under "Waiting on the owner", and nothing is released
  unless decision 17 says so.

## Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| 1 | Call it **Intercom**: a Home Grid block, a sheet, and its own page in Mantel Settings? | **Yes.** |
| 2 | The house's default mode (each person's own last choice then wins)? | **Message**, with Live one tap away on the same sheet. It is the safe mode: it works on every room, ducks music and plays in step. |
| 3 | Is Live offered at all? | **Yes, once the slice-0 proof passes.** If it fails, Live is hidden and Message is the only mode. An Owner can switch Live off any time (`live_allowed`). |
| 4 | The longest broadcast per mode? | **60 s Live, 30 s Message.** Adjustable in Settings (Live 15–120 s, Message 10–60 s). A 60 s Live also clears MA's 30 s render timeout on the idle path. |
| 5 | How long is a Message kept after it plays? | **Deleted when the broadcast ends.** Send Again comes from the sender's own page (it keeps its copy until the sheet closes), so Mantel keeps nothing. An unsent draft is dropped on Cancel, Re-record, a dropped socket, or 5 minutes idle. |
| 6 | Upload the Message while recording (Send is instant), or only when Send is pressed? | **While recording.** Held in memory only, never written or logged, and dropped as above. It makes Send instant and keeps one audio path for both modes. |
| 7 | Which rooms are reachable at first? | **None until an Owner or Admin turns them on** in Settings (an **Enable All** button helps). A new way to make sound in a bedroom is opt-in per room. |
| 8 | Who may send? | **Owner, Admin, Adult and wall tablets.** Not Child or Guest (an Owner can grant it). Away from home, a signed-in Owner, Admin or Adult may send a Message (not Live) through the normal sign-in. |
| 9 | A room that leads other rooms' music (MA would play the broadcast on all of them)? | **Skip it and say so** ("Kitchen leads Downstairs; skipped"). It is included when every room it leads is in the broadcast. |
| 10 | Quiet hours? | **A house default of 21:00–07:00, overridable per room.** Rooms in quiet hours are skipped and shown; an Owner, Admin or Adult may **Send Anyway** (audited). |
| 11 | Tablets with no HomePod? | **Listeners, off by default; an Owner lists a tablet under a room.** Live is delayed by the measured lag so tablets and HomePods line up. |
| 12 | The chime? | **On for Message, off for Live** (it adds to the lag). Two switches. |
| 13 | Echo? | **Live leaves out the room you're in** (the server enforces it). **Message can include it.** A phone has no room, so the sheet says "Stay out of earshot of the rooms you pick" in Live. |
| 14 | How slow may Live be? | **Median 4 s or less, worst 6 s or less** (AirPlay's own ~2 s buffer plus an idle HomePod's wake-up). If the median is higher but everything else passes: **offer Live and say the real number on the sheet.** Say no to that and Live fails instead. |
| 15 | Live in a room playing music, or a Message-only room? | **It plays after you finish, ducked, as a Message.** The sheet shows this per room first. Not building the `play_media` live-radio route (it replaces the queue); revisit only if the owner wants live over music. |
| 16 | The MCP? | **No intercom tool in this phase.** |
| 17 | May the session release to the house when done (tag, release, `update` in the LXC)? | **Yes, for the Message release, after a green `full` and the review, with Live off.** Live follows in a second release after the owner has listened. |
| 18 | A volume slider on the sheet? | **No.** Volume is per room in Settings, capped (default 70), and Automatic by default. |
| 19 | Which HomePod(s) and hours may the session use for live tests without asking again? | **One HomePod in a room nobody is sleeping in (the Kitchen's), 09:00–19:00 local, volume at most 25, tone and short spoken test phrases only, at most 40 sounds a day, each at most 60 s.** A second named HomePod for the two-room run only if the owner names it. **Never the bedroom HomePod the owner has excluded**, and never the group-trap case. |
| 20 | The stream port? | **8767 (HA App: 8101; 8765 is Mantel and 8766 is the Connect listener Mantel Link and the apps use), plain HTTP, private addresses only, closed until the Intercom is on.** Docker and the LXC publish it in `compose.yaml`. |
| 21 | Switch a room to Message-only after three Live failures in a row? | **Yes**, shown in Settings, with a button to try Live again. |
| 22 | The iPhone and iPad app's microphone? | **Yes**, in the next TestFlight build. The Mac app waits. |

## Sources

All at tag 2.10.9 of <https://github.com/music-assistant/server>:

- Announcements (`play_announcement`, the idle-player fallback, group forwarding, restore):
  <https://github.com/music-assistant/server/blob/2.10.9/music_assistant/controllers/players/announcements.py>
- The announcement renderer (ffmpeg from the URL, the extension, 30 s and 300 s limits, one render shared by key):
  <https://github.com/music-assistant/server/blob/2.10.9/music_assistant/controllers/streams/announcements.py>
- MA's own live announcements (WebSocket, record-then-announce, open-ended WAV, 4 sessions):
  <https://github.com/music-assistant/server/blob/2.10.9/music_assistant/controllers/streams/live_announcements.py>
- The AirPlay native announcement (whole clip first, shared instant, the ad-hoc leader):
  <https://github.com/music-assistant/server/blob/2.10.9/music_assistant/providers/airplay/announce.py>
- When AirPlay offers `PLAY_ANNOUNCEMENT` (`has_live_audio`):
  <https://github.com/music-assistant/server/blob/2.10.9/music_assistant/providers/airplay/player.py>
- The announcement HTTP route:
  <https://github.com/music-assistant/server/blob/2.10.9/music_assistant/controllers/streams/controller.py>
- The streaming WAV header (`create_streaming_wave_header`):
  <https://github.com/music-assistant/server/blob/2.10.9/music_assistant/helpers/audio.py>
- A plain URL becomes a Track, a Radio or a sound effect:
  <https://github.com/music-assistant/server/blob/2.10.9/music_assistant/providers/builtin/__init__.py>
- WebKit and the microphone: a page needs a secure context for `getUserMedia`; a `WKWebView` app answers
  `requestMediaCapturePermissionFor` (Apple's `WKUIDelegate` documentation).
- In this repository: `hosts/server/mantel_server/talk_relay.py`, `talk_direct.py`, `hk_core/talk/core.py`,
  `connectors/ma.py`, `gateway.py`, `music.py` (`MusicRun`), `authz.py` (`talk_policy`), `live.py`, `direct.py`,
  `hk_core/music/{config,engine,groups}.py`, `hk_core/notifications/dnd.py`, `web/hk/cards/hk-cameras.js`,
  `web/hk/cards/hk-media.js`, `docs/phase14/SYSTEM-ALERTS.md` (the plan's format).

## Not checked while planning

- That the house's running MA matches tag 2.10.9 (the plan read the release the house is pinned to; it did not contact
  the house).
- That a plain `music/item_by_uri` call reaches MA's URL probe (for Check Reach).
- That Docker's published port keeps the sender's address.
- Any real HomePod's lag, wake-up time or continuity, and whether MA's idle path reads a growing render without gaps.
  That is slice 0.
- A real iPhone's microphone through `WKWebView`; Fully Kiosk's autoplay on the wall tablets.
- Whether the iPad's WebKit holds a 24 kHz `AudioContext` (the page falls back to the rate it gets).

## Build log

(Empty: nothing built.)

**Waiting on the owner** (filled in while building): the HomePod and hours for slice 0 (decision 19), a TestFlight
build, a listen to the Live result, and the release unless decision 17 allows it.
