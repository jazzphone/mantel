# Mantel Connect

Mantel Connect puts a Mantel that runs **outside** Home Assistant (in Docker
or a Proxmox container) in Home Assistant's sidebar and the Companion app.
Open **Mantel** in the sidebar: Home Assistant signs you in, and your Mantel
role decides what you see. It is a small Home Assistant App, paired with
Mantel once with a one-time code; nothing is copied by hand.

**You don't need it** if Mantel runs as the Mantel App inside Home Assistant:
the Mantel App is in the sidebar already.

## Which way to choose

| You want | Use |
|---|---|
| Mantel in the sidebar and the Companion app, signed in by Home Assistant, reachable wherever Home Assistant is (its remote access included) | **Mantel Connect** (this page) |
| A Mantel screen as a Home Assistant dashboard, opened at Mantel's own address | **Show in Home Assistant** on a screen in Mantel Settings ([Mantel Link](Mantel-Link.md)). The browser must reach Mantel's address and sign in to Mantel there. |

Mantel Connect and [Mantel Link](Mantel-Link.md) are separate: Connect is the
sidebar page, Mantel Link is the integration (entities, actions,
notifications). Most homes with Mantel outside Home Assistant use both.

## What you need

- Mantel in Docker or the Proxmox container ([Install](Install.md)).
- Home Assistant OS or Supervised: Mantel Connect is a Home Assistant App.
- Home Assistant able to reach Mantel's host on TCP port **8766**. Nothing
  opens a firewall or forwards a port for you.

## Set it up

### 1. Turn Connect on in Mantel

In Docker, add `compose.connect.yaml` to `COMPOSE_FILE` in
`packaging/compose/.env`, and set the address Home Assistant should use:

```bash
COMPOSE_FILE=compose.yaml:compose.connect.yaml
MANTEL_CONNECT_ADDRESS=192.0.2.10:8766
```

Then `docker compose up -d --wait`. The Proxmox installer does this when you
run it with `var_connect=yes`. By hand, start Mantel with `--connect`.

This adds one published TLS port, 8766, and nothing else.

### 2. Install the Mantel Connect App in Home Assistant

1. In Home Assistant, **Settings → Apps → App store**, add Mantel's App
   repository, `https://github.com/jazzphone/mantel#ha-apps` (the steps, and a
   one-click link, are in [Install](Install.md#add-the-repository-and-install)).
2. Install **Mantel Connect** (not **Mantel**: that one is Mantel Server itself).
   Leave protection mode on. Home Assistant offers its updates like any App's.

To build it from source instead, `tools/stage_connect_app.py` copies it into
Home Assistant's local Apps folder, the same way as the Mantel App
([Install → Build the App from source](Install.md#build-the-app-from-source)).

### 3. Pair

1. In Mantel, as an Owner on the home network: **Mantel Settings → Mantel
   Connect**. Check **Address** (what Home Assistant uses to reach Mantel),
   then **Start Pairing**. You get a one-time code like
   `5VRK2-JW7TQ-ACQ6G-XNHG8`, valid for ten minutes.
   Or, on the server: `docker compose exec mantel-server mantel connect pair`.
2. In Home Assistant: **Settings → Apps → Mantel Connect → Configuration**.
   Enter **Mantel address** (for example `192.0.2.10:8766`) and **Pairing
   code**, select **Save**, then **Restart** the App.
3. Open **Mantel** in the sidebar.

Mantel Settings notices when the code is spent ("Paired. The code is
spent.") and lists the App under **Paired Apps**. After pairing you may clear
the code from the App's configuration.

### 4. The first Owner and the household

If this Mantel has no Owner yet, the first Home Assistant administrator to
open it is offered the Owner role. The Owner then links each Home Assistant
user to a Mantel person and role (see [People and Roles](People-and-Roles.md)).
A Home Assistant user who isn't linked sees "Not linked yet".

## How it stays secure

- **The code proves both sides.** The App and Mantel each prove they know the
  code, over TLS, and pin each other's certificates on the spot. A machine in
  the middle without the code gets nothing. The code works once; five wrong
  tries burn it; failed attempts are rate limited.
- **Mutual TLS after that.** The App trusts only the certificate authority
  Mantel gave it, and Mantel accepts only the certificate it issued to that
  pairing, checked on every request.
- **Home Assistant says who you are; Mantel decides what you may do.** Mantel
  believes the signed-in Home Assistant user only from a paired Connect App.
  The same headers from anywhere else are ignored.
- **Nothing secret in the open.** The App's key and certificates are files in
  its own storage, readable only by it. Nothing secret is in an environment
  variable, a log or a status page.
- **Certificates renew by themselves**: the App's every 90 days, 30 days
  ahead, and Mantel's listener the same way.

Turn on Home Assistant's two-step verification for every household account:
through the sidebar, Home Assistant's sign-in is what proves who someone is.

### Home or away rules through the sidebar

The sidebar is its own door into Mantel. By default it is **trusted**: being
signed in to Home Assistant is enough, and each person's Mantel role decides
the rest, as HK Frontend in Home Assistant always was. To give the sidebar
the home network's rules or Mantel's away rules instead, set
`MANTEL_HA_DOOR_RULES` to `lan` or `tunnel`. With `tunnel`, wall tablets are
refused through the sidebar.

## Revoke or pair again

- **Revoke**: **Mantel Settings → Mantel Connect → Revoke** *name*…, or
  `mantel connect revoke --id <id>`. The App is cut off at once and its open
  connections are closed.
- **Pair again**: start a new pairing in Mantel and enter the new code in the
  App's configuration. Starting a new pairing withdraws any earlier unused
  code; **Withdraw This Code** does it by hand.
- You can change **Mantel address** later without pairing again.

On the server, `mantel connect list` shows paired Apps and `mantel connect
status` shows Mantel's side. Pairing, failures, renewals and revocations are
in the [Audit Log](Commands-and-Audit.md).

## Troubleshooting

If the sidebar shows a plain page instead of Mantel, it says why:

| The page says | Do this |
|---|---|
| The code is wrong, used or expired | Start a new pairing and enter the new code |
| Mantel is not reachable | Check that Home Assistant can reach Mantel's host on port 8766, and the **Mantel address** |
| Disconnected | Mantel revoked this pairing. Pair again |
| Not linked yet | An Owner links that Home Assistant user in Mantel |

`/__mantel_connect/status`, inside the sidebar page, shows the App's
connection test. A code that already failed is not retried when the App
restarts; enter a new one.

## Options

| Option | What it does |
|---|---|
| `mantel_address` | Mantel's Connect address, `host` or `host:port` (default port 8766) |
| `pairing_code` | The one-time code. Used once |
| `log_level` | `debug`, `info`, `warning` or `error` |
