# Push Notifications

Mantel's notifications (the doorbell, a door left open, a rule you set up,
`mantel.notify` from an automation) appear on the screens, and can also reach
people's phones and computers. There are three ways: the Mantel app on iPhone
and iPad, a web browser or Home Screen web app, and Home Assistant's Companion
app. This page says how each one gets there, what the services in between can
see, and how to turn each one off.

| Way | Goes through | Who can read it on the way |
|---|---|---|
| [Mantel app](#the-mantel-app-on-iphone-and-ipad) | Your Mantel → the push relay → Apple → the phone | Only the phone |
| [Web browser](#in-a-web-browser) | Your Mantel → the browser's push service → the browser | Only the browser |
| [Companion app](#home-assistants-companion-app) | Your Mantel → Mantel Link → Home Assistant → the Companion app's push service | As with any Home Assistant notification |

**Who gets a notification**, whichever way: the people it is for (everyone,
or only those it names), and only if they may see the accessory it is about.
Their role is checked with Mantel's away rules, since a phone may be
anywhere. A disabled person gets nothing.

## The Mantel app on iPhone and iPad

### How a notification reaches the phone

Apple's push service only accepts notifications signed with the app
developer's own key, and that key must not be on every home's server. So
Mantel uses a small **push relay**: a Cloudflare Worker run by the app's
publisher, which holds the key. The relay's code is in this repository
(`packaging/push-relay/`). Every Mantel uses the default relay unless you
change it.

1. **The phone registers with the relay**, not with your Mantel. It sends the
   relay its Apple device token and your Mantel's public identity key (the one
   it pinned at pairing). The relay answers with an opaque **handle** that works
   for that one Mantel only.
2. **The phone gives your Mantel the handle**, and the public half of a
   notification key it keeps in its Keychain. Your Mantel never learns Apple's
   device token.
3. **When a notification goes off, your Mantel seals it** to that phone's key
   (ECDH, HKDF-SHA256, AES-256-GCM), signs a request with its identity key, and
   sends it to the relay with the handle.
4. **The relay checks the signature** against the key the handle was made for,
   and passes the sealed notification to Apple.
5. **On the phone**, the app's notification extension opens it and shows the
   real words. For a camera notification it fetches the snapshot from your
   Mantel with the app's own credential.

### What the relay and Apple can see

Sealed, readable only on the phone:

- the title and the message,
- which accessory or camera it is about, and the snapshot's id,
- where a tap goes, and whether it is Important.

Visible to the relay and Apple:

- the words "Mantel" and "New notification" (what the phone shows if the
  extension can't run),
- that it is **time-sensitive** (an Important notification) or ordinary,
- the notification's **tag**, used to group notifications and to let a newer
  one replace an older one, and whether it is about an accessory,
- which Mantel sent to which handle, and when.

<!-- CHECK: apns.build_payload puts msg.tag in the clear as aps.thread-id, and Relay.send passes it as collapse_id; msg.tag is the notification's mute key (push.py). The text above says so; if tags should not be visible, the code must change. -->

Critical alerts (sound even when the phone is muted) are not used.

### What the relay stores

| Kept | For how long |
|---|---|
| For each phone and Mantel: Apple's device token, sandbox or production, the Mantel's public identity key and its fingerprint, a hash of the handle (not the handle), when it was made and when it last sent | Until the phone signs out of that Mantel, or Apple says the phone is gone |
| Each signed request's random nonce | Ten minutes, so a request can't be replayed |
| Per-minute counters for the rate limits (the registration counter is keyed by the phone's IP address) | About two minutes |

The relay never stores a notification. It has no names, no addresses of your
home, and no accounts. Cloudflare, which hosts it, sees each request's IP
address, as it would for any website.

### How the relay is protected

- **Houses sign every request** with their identity key (ES256 over the
  method, path, time, a random nonce and a hash of the body). A request more
  than five minutes off, or one already seen, is refused.
- **A handle works only for the Mantel it was made for.** A handle that isn't
  yours gets the same answer as one that doesn't exist.
- **Rate limits**:

| Limit | Per minute |
|---|---|
| Notifications from one Mantel | 120 |
| Notifications to one phone | 30 |
| Registrations from one address | 20 |
| Size of one notification | 4 KB |

- When Apple says a phone is gone, the relay deletes its handle, and your
  Mantel drops that phone.

### Turn it on and off

- **Don't register.** When the app asks to allow notifications, choose
  **Don't Allow**. Nothing is sent to the relay. To turn them on later: **Mantel
  App → Turn On Notifications**.
- **Sign out** of the app (or **Forget This Mantel**). Your Mantel removes the
  phone and asks the relay to forget its handle.
- **Stop one device** from Mantel: **Mantel Settings → Me → Notifications →
  Stop Sending to** *device*…. <!-- CHECK: this removes the house's push target only (push.py DELETE /api/push/targets/<id>); it does not ask the relay to forget the handle, and the app registers again at its next sign-in or start while iOS allows notifications. Only signing out (forget_app) forgets the handle at the relay. -->
- **Turn notifications off in iOS** (**Settings → Mantel → Notifications**) to
  stop them on that phone.

### Use another relay

Each Mantel has a `push_relay` setting: the `https://` address of the relay it
tells its apps to use. Empty means the default relay.
<!-- CHECK: push_relay is stored in app_settings and read by apns.relay_url, but there is no Mantel Settings page or REST call to set it (only tools/app_dev_server.py sets it). An empty value falls back to the default relay, so the setting cannot turn the relay off; an invalid (non-https) value makes push_mode empty and the app then says "This Mantel does not send notifications to the app yet." -->

### Run your own

If you [build the app under your own Apple account](iPhone-and-Mac-Apps.md#build-the-apps-yourself),
the publisher's relay can't deliver to it: Apple ties pushes to the app's
developer. You have two choices:

**Your own relay** (any number of homes):

1. Make an APNs key in your Apple developer account.
2. In `packaging/push-relay/wrangler.toml`, set `APNS_KEY_ID`, `APNS_TEAM_ID`
   and `APNS_TOPIC` (your app's bundle id).
3. Deploy the Worker to your Cloudflare account. `tools/deploy_push_relay.sh`
   creates its D1 database and tables, stores the APNs key as a Worker secret
   (read from a file, never printed), deploys, and checks `/v1/health`.
4. Point your Mantel's `push_relay` setting at your relay's address.

**Directly from your Mantel** (one home, a developer's setup): put your APNs key
in Mantel's secrets folder as `apns_key.p8`, with `apns.json` beside it:

```json
{"key_id": "KEYID12345", "team_id": "ABCDE12345", "topic": "com.example.mantel.ios"}
```

Both are secret files: never in the database, a log or an environment
variable. With them present, your Mantel tells its apps to register with it
directly and sends to Apple itself. Without them, nothing is sent.
<!-- CHECK: direct sending needs httpx[http2], which is not in Mantel's requirements or images; apns.py logs "APNs needs HTTP/2 (httpx[http2]); not installed, nothing sent" until it is added. -->

## In a web browser

Mantel can send notifications to a browser, including an iPhone or iPad Home
Screen web app (iOS 16.4 and later).

1. Open Mantel at its own address (not inside Home Assistant's sidebar: there,
   the Companion app delivers them).
2. On an iPhone or iPad, first **Share → Add to Home Screen**, then open Mantel
   from the Home Screen.
3. **Mantel Settings → Me → Notifications**, turn on **Notifications Here**.
4. **Send a Test Notification** to check.

What is sent: the title, the message, the tag, where a tap goes, and whether
it is Important. Never a snapshot, a token or an accessory's details. Each
notification is encrypted to the browser's own key, so the browser's push
service (Apple's, Google's, Mozilla's or Microsoft's) can't read it; your
Mantel signs it with its own key. Only those four push services are accepted.
A notification older than an hour is dropped.

To stop: turn **Notifications Here** off, or **Stop Sending to** that browser.
A person can have up to 20 devices.

## Home Assistant's Companion app

Phones with Home Assistant's Companion app can get Mantel's notifications
without the Mantel app, through [Mantel Link](Mantel-Link.md).

1. Install Mantel Link and link it.
2. **Mantel Settings → People** → a person: pick their phones (the Companion
   app phones Home Assistant has), and what goes there: **Important Only**
   (the default), **Every Notification** or **Nothing**.

Mantel sends the title and the message; **Dismiss** on the phone takes the
banner down on every screen. These notifications use Home Assistant's own
notification service and the Companion app's push service, as any Home
Assistant notification does. Mantel does not seal them.
