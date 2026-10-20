# Security Model

Mantel sits between the people in your home and Home Assistant, and it holds Home Assistant's keys. This page says, in plain terms, what Mantel protects, how, and where its protection ends, so you can decide how to run it. To report a security problem, see [Reporting a vulnerability](#reporting-a-vulnerability).

## What Mantel protects

- **Control of your home.** Mantel holds a Home Assistant credential (normally a dedicated administrator user's token) and, if you connect it, Music Assistant's. Browsers, tablets and apps never get these: they talk only to Mantel, and Mantel decides what each one may see and do.
- **What people see.** Cameras, people's locations, history, and the devices in rooms a person isn't given.
- **Accounts.** People's passwords, authenticator secrets and passkeys, and wall tablets' credentials.
- **A record of what happened.** Every command, allowed or refused, in an [audit log](Commands-and-Audit.md#the-audit-log) written before the command is sent.

## The main rules

1. **One server holds the credentials.** Mantel Server keeps the Home Assistant and Music Assistant credentials. No page is ever given a Home Assistant token: camera stills, artwork, history and live video come through Mantel, which checks the person's role first.
2. **Commands are off until you turn them on**, as an installation setting nobody can change from a browser ([Commands and Audit](Commands-and-Audit.md#turn-commands-on)). The connection Mantel uses to read Home Assistant can't send commands at all; a separate one does, and only for a command that has just been checked and recorded.
3. **Deny by default.** Nobody sees or controls anything a grant doesn't allow, and a deny always wins ([People and Roles](People-and-Roles.md)).
4. **Filtered before it's sent.** An entity a person may not see is never sent to their browser, and people's exact GPS positions are removed unless they may read location history.
5. **Recorded before it's done.** The audit row is written before a command goes out; if it can't be written, the command is refused.
6. **Fail closed.** When Mantel can't tell whether a request is from your home network, it treats it as coming from outside.

## Home and away

Every request reaches Mantel by a **door**:

| Door | Means |
|---|---|
| `lan` (home) | Your home network |
| `tunnel` (away) | Anything else, such as a Cloudflare tunnel |
| `ha` (inside Home Assistant) | Home Assistant's sidebar, with the Mantel App or Mantel Connect |

Away, Mantel is stricter:

- A password alone is refused: you need a passkey, or a password and an authenticator code.
- Sessions last 12 hours instead of 30 days, and a session from home doesn't work away.
- Wall tablet credentials are refused.
- Each role's **From Outside the Home** switches decide sensitive actions, cameras and location history. Children and Guests get none of them by default.
- Owners get a Home Assistant notification for every unlock and disarm.

### How Mantel knows the door

A browser could simply claim to be at home, so Mantel believes the door only from a proxy it trusts:

- **Mantel's own proxy** (Caddy, in the Docker and Proxmox installs that use it): Caddy stamps every request `lan` or `tunnel`, overwriting anything the browser sent. Mantel believes `lan` only from Caddy's fixed address.
- **Your own reverse proxy**: the proxy must also send this installation's **door key**, a secret header. Without the right key the request counts as away, even from the proxy's address. An Owner sees and rotates the key in **Mantel Settings** → **Connections** → **HTTPS and Your Proxy**.
- **The Mantel App's own HTTPS port** (its direct access with Mantel's own certificate): the client's address decides. Addresses in the networks you list (by default the private ranges) count as home; any other is away.
- **Any Cloudflare header** means away, whoever sends it. A missing or unknown door means away too. (The one exception: a request from the server's own machine, with no proxy at all, counts as home. That's for running Mantel by hand during development.)
- **Inside Home Assistant**, Home Assistant signs people in, and the installation's `ha_door_rules` setting decides whether home or away rules apply ([Signing In](Signing-In.md#inside-home-assistant)).

Mantel also answers only to its own host names, and refuses a request whose `Origin` doesn't match. That stops other web pages, and DNS rebinding, from driving it.

Mantel doesn't check Cloudflare Access sign-in tokens itself. If you publish Mantel through a Cloudflare tunnel, put Cloudflare Access (or a similar sign-in) in front of it: then a stranger has to get past that before they reach Mantel's own sign-in.

<!-- CHECK: OPERATIONS.md "Known gaps" says not to publish a tunnel hostname before Cloudflare Access JWT verification exists. Nothing in the code verifies it (Cf-Access-Jwt-Assertion is only used to classify the door). Decide whether the public docs should say "don't use a tunnel yet". -->

## Signing in

- **Passwords** are 12 characters or more and stored only as **Argon2id** hashes. An unknown user name takes as long to refuse as a wrong password, and both get the same answer.
- **Guessing is limited**: 5 wrong passwords in a row lock an account for 15 minutes (kept across restarts); each address gets 20 failures per 15 minutes and each user name 5. The per-address and per-name limits are kept in memory and reset when the server restarts.
- **Authenticator codes** (TOTP, RFC 6238): each code works once. The secret is encrypted at rest ([below](#the-at-rest-key)).
- **Passkeys** (WebAuthn): Mantel stores only public keys, requires user verification (fingerprint, face or device PIN), and refuses a passkey whose counter goes backwards, a sign of a cloned key. Passkeys are bound to Mantel's host name.
- **Sign in with Home Assistant**: Mantel uses it only to learn who you are and revokes the token Home Assistant gave it at once. Mantel accepts Home Assistant's sign-in as it is, also away, so its strength is Home Assistant's: turn on multi-factor authentication in Home Assistant for people who sign in this way from outside.

### Sessions

- A sign-in gives the browser a short **access token** (15 minutes) and a **refresh token** that changes every time it's used. If an old refresh token turns up again, someone has a copy, and Mantel ends the whole session for both.
- The cookies are `HttpOnly` (page scripts can't read them), `SameSite=Strict` and `Secure`.
- Mantel stores only SHA-256 hashes of tokens, so a copy of the database can't be used to sign in.
- Disabling a person ends their sessions at once.

### Wall tablets

A wall tablet's credential is a random secret in a cookie, stored as a hash. It changes every 24 hours, a copied one is caught (the tablet is revoked when the old secret turns up again), it works only on the home network, and it can be revoked in one step. Enrolling is possible only from the home network. See [Wall Tablets](Wall-Tablets.md#how-the-tablets-credential-works).

## Cross-site requests and page security

- **CSRF.** Every change through Mantel's API needs a `X-CSRF-Token` header that matches the session. The sign-in endpoints accept only JSON with an `Origin` header, so an ordinary web form can't post to them. Mantel's live connection (its WebSocket) needs an `Origin` too.
- **Content Security Policy.** Mantel sets its own headers, whatever proxy is in front of it:
  - HK's pages run only scripts from Mantel itself (`script-src 'self'`): no inline scripts and no other hosts. Styles may be inline, because HK's screens use `style` attributes.
  - Images may come from any `https://` address (music artwork comes from the providers' own servers). Pages may connect to Mantel, and to the weather radar and map services the Weather page uses.
  - Pages may be framed only by Mantel itself (and by addresses the Owner adds, such as Home Assistant's).
  - The sign-in page and the settings fallback page are stricter: no inline styles, and no framing.
  - Music Assistant's own web app, under `/ma/`, gets a looser policy of its own, because it's Music Assistant's code. It still loads nothing from other hosts but artwork.
- **Other headers**: `Strict-Transport-Security` for a year whenever the browser is on HTTPS (not through Home Assistant's sidebar, which is Home Assistant's address), `X-Content-Type-Options: nosniff`, `Cross-Origin-Resource-Policy: same-origin`, a `Referrer-Policy`, and a `Permissions-Policy` that allows the microphone (for doorbell talk-back) only on Mantel's own pages.

## Secrets as files

Mantel reads secrets from **files**, never from environment variables, the image or the repository.

| File | What |
|---|---|
| `at_rest.key` | The [at-rest key](#the-at-rest-key) |
| `backup.key` | Encrypts backups ([Backups](Backups.md)) |
| `ha_token`, `ma_token` | Optional. Normally you connect Home Assistant and Music Assistant in **Connections** instead. |

In Docker these are mounted read-only. Credentials you enter in **Connections** (Home Assistant, Music Assistant, a tablet's kiosk app) are kept in Mantel's data folder, in files only Mantel can read, sealed with the at-rest key. They are tested before they're saved and never shown again. In the Mantel App, Home Assistant's own credential for the App is moved into a file the same way. No secret, token, password or code is written to Mantel's log.

## The at-rest key

`at_rest.key` holds 32 random bytes. Mantel uses it to seal (AES-256-GCM) what it must be able to read back:

- authenticator app secrets,
- the Home Assistant, Music Assistant and kiosk app credentials from **Connections**,
- the alarm panel's own code, if it needs one,
- your own proxy's door key.

Each sealed value is tied to its place, so it can't be copied to another row or file and opened there. The key is never in the database.

**Keep a copy of `at_rest.key` somewhere other than the server.** Without it, every authenticator app has to be set up again and every connection entered again.

Everything else is stored only as a one-way hash: passwords and PINs (the Alarm PIN, and the optional personal PIN) with Argon2id; session, tablet, setup and service account tokens with SHA-256.

## What Mantel can and can't see

**Mantel can see:**

- everything its Home Assistant account can see and do, which for an administrator account is all of Home Assistant;
- Music Assistant, if you connect it;
- the camera streams and pictures it passes on to people allowed to see them;
- who did what, in its audit log and in each session's browser and address.

**Mantel doesn't see or keep:**

- Home Assistant users' passwords, or the token from **Sign in with Home Assistant** (revoked at once);
- your passkeys' private keys, which stay on your devices;
- your password or PIN after it's checked (only the hash is kept);
- Home Assistant's Alarm PIN (Home Assistant never gives it out, which is why you set it again in Mantel);
- a Kiosk Satellite tablet's password (used once to get a token).

**What Mantel's own code contacts outside your network**, when you use the feature: the weather radar and map tiles (from the browser), music artwork (from the browser), Let's Encrypt and Cloudflare's DNS API for certificates in the Mantel App's direct access, and Apple's push service, directly or through the apps' push relay, for [Push Notifications](Push-Notifications.md) to the iPhone and Mac apps.

## Where the protection ends

Be aware of these:

- **A wall tablet is as strong as the room it's in.** Anyone standing at it can do what the tablet may do, including unlocking its room's door, with no PIN. Narrow a tablet's grants if that's too much.
- **A person signed in at a tablet** stays signed in for 30 days unless they sign out.
- **The home network is trusted more.** Anyone who reaches Mantel from your home network can sign in with a password alone (if they have one), and wall tablet credentials work there. Keep the network private, and make sure your proxy sends the door correctly.
- **The audit log is protected inside the database file.** Someone with access to the server's files can replace the whole file. Keep the data folder and backups private.
- **Some account events aren't recorded** in the audit log, such as role changes and enrolling a tablet ([Commands and Audit](Commands-and-Audit.md#what-isnt-recorded)).
- **Lockouts can be triggered by anyone** who knows a user name, for 15 minutes.
- **Fully Kiosk Browser's** remote administration password travels in plain text on your home network. That's Fully's design.
- **Inline styles are allowed** on HK's pages, so the page policy doesn't block style injection.
- **Mantel trusts its Home Assistant.** It can't protect you from Home Assistant itself, or from someone who already controls the server.

## Reporting a vulnerability

Please report security problems privately, not in a public issue. See [SECURITY.md](../../SECURITY.md) for how.

## See also

- [Signing In](Signing-In.md)
- [People and Roles](People-and-Roles.md)
- [Wall Tablets](Wall-Tablets.md)
- [Commands and Audit](Commands-and-Audit.md)
- [Backups](Backups.md)
