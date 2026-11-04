# Security Model

Mantel sits between the people in your home and Home Assistant, and it holds Home Assistant's keys. This page says, in plain terms, what Mantel protects, how, and where its protection ends, so you can decide how to run it. To report a security problem, see [Reporting a vulnerability](#reporting-a-vulnerability).

## What Mantel protects

- **Control of your home.** Mantel holds a Home Assistant credential (normally a dedicated administrator user's token) and, if you connect it, Music Assistant's. Browsers, tablets and apps never get these: they talk only to Mantel, and Mantel decides what each one may see and do.
- **What people see.** Cameras, people's locations, history, and the devices in rooms a person isn't given.
- **Accounts.** People's passwords, authenticator secrets and passkeys, and wall tablets' credentials.
- **A record of what happened.** Every command, allowed or refused, in an [audit log](Commands-and-Audit.md#the-audit-log) written before the command is sent.

## The main rules

1. **One server holds the credentials.** Mantel Server keeps the Home Assistant and Music Assistant credentials. No page is ever given a Home Assistant token: camera stills, artwork, history and live video come through Mantel, which checks the person's role first.
2. **Commands are off until an Owner turns them on**, in Mantel Settings → General → **Allow Control of the House**, after confirming it is them with a fresh sign-in; every change is audited. Whoever runs the server can keep the house read-only whatever that switch says, with the kill switch (the App's `read_only`, `MANTEL_READ_ONLY`, `--read-only`), which no page can change and which also keeps Mantel from adding or removing Home Assistant dashboards ([Commands and Audit](Commands-and-Audit.md#turn-commands-on)). The connection Mantel uses to read Home Assistant can't send commands at all; a separate one does, and only for a command that has just been checked and recorded.
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
- Sessions last 12 hours instead of 30 days (an Owner can change that: **General** → **Sign-Ins from Away Last**), and a session from home doesn't work away.
- Wall tablet credentials are refused.
- Each role's **From Outside the Home** switches decide sensitive actions, cameras and location history. Children and Guests get none of them by default.
- Owners get a Home Assistant notification for every unlock and disarm.

### How Mantel knows the door

A browser could simply claim to be at home, so Mantel believes the door only from a proxy it trusts:

- **Mantel's own proxy** (Caddy, in the Docker and Proxmox installs that use it): Caddy stamps every request `lan` or `tunnel`, overwriting anything the browser sent. Mantel believes `lan` only from Caddy's fixed address.
- **Your own reverse proxy**: the proxy must also send this installation's **door key**, a secret header. Without the right key the request counts as away, even from the proxy's address. An Owner sees and rotates the key in **Mantel Settings** → **Connections** → **HTTPS and Your Proxy**.
- **The Mantel App's own HTTPS port** (its direct access with Mantel's own certificate): the client's address decides. Addresses in the networks you list (by default the private ranges) count as home; any other is away.
- **Any Cloudflare header** means away, whoever sends it, even with a valid Cloudflare Access token: Cloudflare's headers can only make Mantel stricter. A missing or unknown door means away too. (The one exception: a request from the server's own machine, with no proxy at all, counts as home. That's for running Mantel by hand during development.)
- **Inside Home Assistant**, Home Assistant signs people in, and **Coming Through Home Assistant** in **Mantel Settings** decides whether home or away rules apply ([Signing In](Signing-In.md#inside-home-assistant)).

Mantel also answers only to its own host names, and refuses a request whose `Origin` doesn't match. That stops other web pages, and DNS rebinding, from driving it.

### Reaching Mantel from away

- **A Cloudflare Tunnel is the recommended way in.** `cloudflared` makes an outgoing connection to Cloudflare, so nothing on your router is opened, and everything that comes through it gets the away rules above.
- **Cloudflare Access in front of it is optional, and recommended.** Access is a sign-in Cloudflare asks for (your email, or your identity provider) before a request reaches the tunnel at all, so a stranger never even sees Mantel's sign-in page. When it lets a request through, Cloudflare adds a signed token to it (the `Cf-Access-Jwt-Assertion` header). Tell Mantel your Zero Trust team name and the Access application's AUD tag ([Docker](Install-Docker.md#cloudflare-access-optional), [the App](Install.md#cloudflare-access-optional)), and Mantel checks that token itself on every away request: signed with your team's keys (RS256 only, the keys fetched from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` and kept for an hour), issued by your team, for your Access application, and not expired. A request without a valid token is refused (`403`, `access_required` or `access_invalid`) before Mantel looks at any cookie or sign-in. So a hostname published without Access, a policy turned off by mistake, or someone reaching your server around Cloudflare gets nothing. If Mantel can't read Cloudflare's keys, the keys it already holds stay usable for up to 24 hours, so a short Cloudflare outage doesn't lock you out; with none, or older than that, away requests are refused (fail closed, `503 access_unavailable`); home and the Home Assistant sidebar keep working. Without these settings, Mantel doesn't check the token.
- **Access adds a gate; it doesn't sign you in to Mantel.** Mantel's own sign-in, with the away rules, still applies behind it.
- **Every path goes through Access** while Mantel checks it. Mantel makes no exceptions, so an Access *Bypass* rule for some paths (for example the iPhone and Mac apps' `/api/app/` calls) doesn't work: Cloudflare sends no token for bypassed requests, and Mantel refuses them.
- **Opening a port yourself** (forwarding your router to Mantel, its proxy or the App's direct port) works, but it's at your own risk: Mantel's sign-in page, and every bug that may be in front of it, is then reachable by anyone on the internet, and nothing but Mantel's own sign-in and its guessing limits stands between them and your home. Such requests normally get the away rules, but Mantel can only go by the address it sees: a port forwarded to the Mantel App's built-in HTTPS can make internet clients look like home (Docker's port mapping), which is why that port must never be forwarded. With Cloudflare Access configured, Mantel refuses them, because they carry no Access token.

## Signing in

- **Passwords** are 12 characters or more and stored only as **Argon2id** hashes. An unknown user name takes as long to refuse as a wrong password, and both get the same answer.
- **Guessing is limited**: 5 wrong passwords in a row lock an account for 15 minutes (kept across restarts); each address gets 20 failures per 15 minutes and each user name 5. The per-address and per-name limits are kept in memory and reset when the server restarts.
- **Authenticator codes** (TOTP, RFC 6238): each code works once. The secret is encrypted at rest ([below](#the-at-rest-key)).
- **Passkeys** (WebAuthn): Mantel stores only public keys, requires user verification (fingerprint, face or device PIN), and refuses a passkey whose counter goes backwards, a sign of a cloned key. Passkeys are bound to Mantel's host name.
- **Sign in with Home Assistant**: Mantel uses it only to learn who you are and revokes the token Home Assistant gave it at once. Mantel accepts Home Assistant's sign-in as it is, also away, so its strength is Home Assistant's: turn on multi-factor authentication in Home Assistant for people who sign in this way from outside.

### Sessions

- A sign-in gives the browser a short **access token** (15 minutes) and a **refresh token** that changes every time it's used. If an old refresh token turns up again, someone has a copy, and Mantel ends the whole session for both.
- The session cookies are `HttpOnly` (page scripts can't read them), `SameSite=Strict` and `Secure`. The one exception is the CSRF token's cookie, which the page must read to send it back in a header; it grants nothing on its own.
- Mantel stores only SHA-256 hashes of tokens, so a copy of the database can't be used to sign in.
- Disabling a person ends their sessions at once.

### Wall tablets

A wall tablet's credential is a random secret in a cookie, stored as a hash. It changes every 24 hours, a copied one is caught (the tablet is revoked when the old secret turns up again), it works only on the home network, and it can be revoked in one step. Enrolling is possible only from the home network. See [Wall Tablets](Wall-Tablets.md#how-the-tablets-credential-works).

### Assistants (MCP)

An assistant ([Assistants](Assistants.md)) acts for one person, with a ceiling: its ticks, and never more than the
person's role. Connecting one, by a personal key or by signing in, needs a fresh sign-in, as adding a passkey does.
Its tokens work only at `/mcp`, never as a browser's sign-in; a personal key works on the home network only and never
controls the house; a house command from an assistant goes through the same classify, roles and audit as a screen's
button, and the Audit Log says which assistant sent it. See [Assistants → Security](Assistants.md#security).

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

**What Mantel's own code contacts outside your network**, when you use the feature: the weather radar and map tiles (from the browser), music artwork (from the browser), Let's Encrypt and your DNS host's API (Cloudflare or Duck DNS) for certificates in the Mantel App's direct access, the DNS host you choose for Caddy's certificates with Docker or the LXC, and Apple's push service, directly or through the apps' push relay, for [Push Notifications](Push-Notifications.md) to the iPhone and Mac apps.

## The Intercom's stream port

The [Intercom](Intercom.md) is the one place Mantel serves something outside its sign-in. Music Assistant has to
fetch what you say from Mantel, so Mantel opens a second, tiny listener (8767; 8101 in the Home Assistant App) while
the Intercom is on. It serves only one-time links:

- each link is a random 256-bit token; Mantel keeps only its hash, in memory, and never logs it;
- it lasts seconds: 20 s to be fetched (30 s for a message), and it ends with its broadcast;
- it's fetched once, from a private address (and from Music Assistant's own address when Mantel reaches Music
  Assistant by one), with one retry from the same address;
- only Mantel mints a link: for a broadcast after the gateway's checks and the audit row, and for Settings' Check
  Reach (silent) and Send Test (after its audit row). A page never sees one;
- everything else on that port, and every wrong, used or expired link, gets the same empty "not found".

The audio itself is held in memory only and dropped when the broadcast ends. Never forward the port to the internet.

## Where the protection ends

Be aware of these:

- **A wall tablet is as strong as the room it's in.** Anyone standing at it can do what the tablet may do, including unlocking its room's door, with no PIN. Narrow a tablet's grants if that's too much.
- **A person signed in at a tablet** stays signed in for 30 days unless they sign out.
- **The home network is trusted more.** Anyone who reaches Mantel from your home network can sign in with a password alone (if they have one), and wall tablet credentials work there. Keep the network private, and make sure your proxy sends the door correctly.
- **The audit log is protected inside the database file.** Someone with access to the server's files can replace the whole file. Keep the data folder and backups private.
- **Sign-ins aren't recorded** in the audit log, though account changes (people, roles, passwords, wall tablets) are. Active sign-ins are in each person's **My Sessions** ([Commands and Audit](Commands-and-Audit.md#what-isnt-recorded)).
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
