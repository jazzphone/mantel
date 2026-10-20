# Install

Mantel Server runs beside your Home Assistant and serves HK's home screens from its own server. You can run it three ways: as a **Home Assistant App** (recommended), with **Docker Compose** on any Docker host, or in a **Proxmox LXC** container made by a script. All three run the same Mantel Server, with the same people, roles, wall tablets and audit log; only the setup differs. This page helps you choose, lists what you need, and then installs the Home Assistant App. When it is running, go on to [First Run](First-Run.md).

## Choose how to run Mantel

| | Home Assistant App | Docker Compose | Proxmox LXC |
|---|---|---|---|
| **Best for** | Most homes. Nothing extra to look after. | A home that already runs Docker on another machine. | A home with a Proxmox server, and Live TV on an Intel iGPU. |
| **Runs on** | Your Home Assistant machine (Home Assistant OS or Supervised) | Any Linux host with Docker | A Proxmox VE host (x86-64) |
| **Where people open it** | **Mantel** in Home Assistant's sidebar and the Companion app. Optionally also at its own address. | Its own `https://` address, for example `https://mantel.example.com` | The same as Docker |
| **Who signs people in** | Home Assistant. Mantel's roles decide what each person gets. | Mantel itself: password, passkey or *Sign in with Home Assistant* | The same as Docker |
| **Connecting to Home Assistant** | Automatic (the App's own credential) | On the **Connections** page after the first start | The same as Docker |
| **HTTPS** | Home Assistant's own | Included (Caddy), or your own reverse proxy | The same as Docker |
| **Live TV** | Home Assistant's own Live TV keeps playing | Served by Mantel through its own go2rtc | The same, with QuickSync on the iGPU |
| **Updates** | Through Home Assistant | `./update.sh` | `mantel-update` |
| **Backups** | Inside Home Assistant's backups | Mantel's own nightly encrypted backups | The same as Docker |
| **Install guide** | [below](#install-the-home-assistant-app) | [Install with Docker](Install-Docker.md) | [Install in a Proxmox LXC](Install-Proxmox-LXC.md) |

Running Mantel outside Home Assistant and still want it in Home Assistant's sidebar? That is [Mantel Connect](Mantel-Connect.md). Whichever way you choose, [Mantel Link](Mantel-Link.md) is Home Assistant's side of Mantel: it puts Mantel's wall tablets, actions and notifications in Home Assistant.

## Before you start

You need:

| For | You need |
|---|---|
| All three | A **Home Assistant** that Mantel can reach over the network. <!-- CHECK: no minimum Home Assistant version is stated anywhere for Mantel Server or the App; HK Frontend needs 2026.8. Confirm and add it here. --> |
| All three | An **administrator account** in Home Assistant. In the App, the first Home Assistant administrator to open Mantel can become its Owner. |
| The App | **Home Assistant OS** or a **Supervised** install (the ones with Apps). An `amd64` or `aarch64` machine. |
| Docker and the LXC | A **dedicated Home Assistant user** for Mantel, for example `mantel-server`, made an administrator. Mantel acts as this user. Don't use a person's own account. |
| Docker and the LXC | **A name for Mantel** that browsers will type, for example `mantel.example.com`, and a way to give it HTTPS (see [Install with Docker → HTTPS](Install-Docker.md#3-choose-how-browsers-get-https)). |

Optional, for the features that use them:

| For | You need |
|---|---|
| Whole-home music | [Music Assistant](https://www.music-assistant.io), version 2.7 or newer for signing in from Mantel's Connections page. See [Music and Cameras](Music-and-Cameras.md). |
| Live TV served by Mantel (Docker, LXC) | An HDHomeRun tuner. An Intel iGPU (QuickSync) makes the transcode much lighter. |
| Apple's look | SF Pro and the SF Symbols glyphs, which each home supplies itself. Without them the screens use fallback fonts and icons. Upload them later in **Mantel Settings** → **Your Files**. |
| A real certificate (Docker, LXC) | A domain on Cloudflare DNS, for Caddy's DNS-01 certificates. Without one, Caddy can use its own certificate authority. |

Mantel starts **read-only**: it shows your home but sends no commands until you turn commands on. See [Turn on house commands](#turn-on-house-commands).

## Install the Home Assistant App

### Add the repository and install

<!-- RELEASE: these steps need a published App repository first: a repository.yaml at the root of https://github.com/jazzphone/mantel, and the App's config.yaml pointing at a published image (an `image:` key) so the Supervisor installs and updates it without building. Until then, use "Build the App from source" below. -->

1. In Home Assistant, go to **Settings** → **Apps** → **App store** (called **Add-ons** → **Add-on store** in older versions).
2. Select **⋮** (top right) → **Repositories**.
3. Enter `https://github.com/jazzphone/mantel` and select **Add**. Close the dialog.
4. Find **Mantel** in the store (refresh the page if it isn't there yet), open it and select **Install**.

### Build the App from source

This works today. It copies Mantel into Home Assistant's local Apps folder, and the Supervisor builds it on your Home Assistant machine.

You need a computer with **git** and **Python 3.12** or newer, and access to Home Assistant's `addons` folder (for example through the **Samba share** App).

1. Get the source:

   ```bash
   git clone https://github.com/jazzphone/mantel.git
   cd mantel
   ```

2. Check what will be copied. This writes nothing:

   ```bash
   python3 tools/stage_ha_app.py --dry-run
   ```

3. Copy the App into Home Assistant's `addons` folder. Replace the path with where that share is mounted on your computer:

   ```bash
   python3 tools/stage_ha_app.py /path/to/addons/mantel
   ```

   The tool refuses to copy anything private: font files, keys, tokens, databases or private network addresses.
4. In Home Assistant, go to **Settings** → **Apps** → **App store**, then **⋮** → **Check for updates**.
5. **Mantel** appears under **Local apps**. Open it and select **Install**. The Supervisor builds it, which takes a few minutes.

### Configure and start

1. Open the **Configuration** tab. Leave **Allow house commands** (`commands_enabled`) off for now. The other options are in the [table below](#app-options); the defaults suit most homes.
2. Open the **Info** tab. Turn on **Show in sidebar** and **Watchdog**.
3. Select **Start**.
4. Open the **Log** tab. You should see a line that ends `read-only; commands disabled`, and no error.
5. When everything works, turn on **Start on boot**. It is off when you install the App.

Next: open **Mantel** in the sidebar and become its Owner. [First Run](First-Run.md) walks you through it.

### App options

| Option | Default | What it does |
|---|---|---|
| **Allow house commands** (`commands_enabled`) | off | Off: Mantel is read-only. On: people may control your home through Mantel within their roles, and every command is audited. |
| **Log level** (`log_level`) | `info` | How much Mantel writes to the App's log: `debug`, `info`, `warning` or `error`. |
| **Default screen** (`default_screen`) | empty | The screen Mantel opens for anyone who hasn't picked their own, by its address (for example `dashboard-kitchen`). Empty: the first screen Mantel finds. |
| **Sidebar access rules** (`ha_door_rules`) | `trusted` | `trusted`: being signed in to Home Assistant is enough, as with HK Frontend. `lan`: the home network's rules. `tunnel`: Mantel's remote-access rules. Each person's role still decides what they may do. |
| **Music Assistant address** (`ma_url`), **Music Assistant token** (`ma_token`) | empty | Optional. You can also set Music Assistant up on Mantel's **Connections** page, which wins over these. |
| **Direct access** (`access`) | `ingress` | `ingress`: the sidebar only. `proxy` or `https`: Mantel also has its own address. See [Direct access](#direct-access-optional). |
| `public_url`, `trusted_proxies`, `ha_sign_in_url`, `ha_frame_origins`, `cloudflare_token`, `acme_email`, `acme_staging`, `lan_networks` | empty | Direct access only. |
| `cf_access_team`, `cf_access_aud` | empty | Direct access only: Cloudflare Access in front of a tunnel. See [Cloudflare Access](#cloudflare-access-optional). |

Restart the App after you change an option.

The two tokens (`ma_token`, `cloudflare_token`) are masked options. Mantel moves each into a private file before it starts and never logs it. You never create a Home Assistant token for the App: it uses the App's own built-in credential.

### Who can open it

Every Home Assistant user can open **Mantel** in the sidebar, because wall tablets and most household members are not Home Assistant administrators. Mantel decides what each person gets:

- An account that isn't linked to Mantel sees only **Not linked yet**.
- A linked account gets its Mantel role. See [People and Roles](People-and-Roles.md).
- Only a Home Assistant administrator, checked with Home Assistant itself, can become the **first** Owner.

Turn on Home Assistant's two-step verification for every household account. In the sidebar, Home Assistant's sign-in is what proves who someone is.

### Direct access (optional)

The sidebar always works. Some homes also want Mantel at its **own address**, for example `https://mantel.example.com`, so wall tablets can open it without Home Assistant's frame and every screen has a direct link. Most homes need neither; leave **Direct access** at `ingress`.

At Mantel's own address, Home Assistant's sidebar sign-in doesn't apply. People sign in with a Mantel password or passkey, or with **Sign in with Home Assistant** when you set `ha_sign_in_url`. Wall tablets are enrolled as Mantel devices ([Wall Tablets](Wall-Tablets.md)).

Pick **one** of the two ways:

| `access` | Who serves HTTPS | You set |
|---|---|---|
| `proxy` | Your own reverse proxy (Nginx Proxy Manager, Traefik, ...) in front of the App's plain-HTTP port | `public_url`, `trusted_proxies` (your proxy's address as Mantel sees it), and the **door key** in your proxy |
| `https` | Mantel itself, with a free Let's Encrypt certificate it gets and renews. The name is proved through Cloudflare DNS, so nothing has to be reachable from the internet. | `public_url`, `cloudflare_token` (a Cloudflare API token with **Zone / Zone / Read** and **Zone / DNS / Edit**, for that one zone), optionally `lan_networks` and `acme_staging` while you try it out |

Either way:

1. Set the options on the **Configuration** tab. `public_url` is a name, not an IP address, for example `https://mantel.example.com` (add `:port` when the port is not 443).
2. On the **Network** tab, give `8100/tcp` a host port, for example `8100` for a proxy, or `443` (or `8443`) for `https`.
3. Point the name at your proxy (`proxy`) or at your Home Assistant machine (`https`) in your DNS. A local DNS record is enough.
4. Restart the App.
5. With `proxy`: open **Mantel** in the sidebar as the Owner, then **Mantel Settings** → **Connections** → **HTTPS and Your Proxy**, select **Rotate door key**, and put the key in your proxy. **Test my proxy** there shows a ready-made Nginx Proxy Manager block with the key filled in. Without the key, Mantel treats everything from your proxy as remote.
6. Open `https://mantel.example.com/proxy-check` as the Owner. It says whether the request came through your proxy, which door Mantel sees, and what to fix.

Keep direct access on your home network:

- With `proxy`, give the proxy host an **Access List** that allows only your home's networks, or use a proxy the internet can't reach. Certificate names are public.
- With `https`, never forward the port from the internet. Tablets must reach the Home Assistant machine directly on your network: a device that comes in through the router's port forwarding gets the remote rules.
- The certificate's key is kept in the App's data, so it is inside Home Assistant's backups. Protect those backups.

The App's own documentation tab has the full Nginx Proxy Manager steps.

### From away: a Cloudflare Tunnel

To reach Mantel's own address from away, a Cloudflare Tunnel is the recommended way: for example the cloudflared App pointed at your proxy (`proxy`) or at the App's port (`https`). Nothing on your router is opened, and everything through it gets Mantel's away rules. Opening a port on your router instead works, but at your own risk: Mantel's sign-in page is then open to the whole internet (and with `https` a forwarded port can make the internet look like home; never do that). Home Assistant's sidebar keeps working either way.

### Cloudflare Access (optional)

Cloudflare Access asks for a sign-in of its own before a request reaches the tunnel, so strangers never see Mantel. It is optional, and recommended. To have Mantel check Access's signed token on every request through the tunnel:

1. In Cloudflare Zero Trust, **Access** → **Applications**, add a **Self-hosted** application for Mantel's name, with a policy that allows your household.
2. Set `cf_access_team` to your **team name**: Zero Trust → **Settings** → **Team name and domain** shows `<team>.cloudflareaccess.com`; use the part before `.cloudflareaccess.com`.
3. Set `cf_access_aud` to the application's **Application Audience (AUD) Tag**, shown in its overview under **Access** → **Applications** (64 letters and digits; several separated by commas).
4. Restart the App. The log says `Cloudflare Access: every tunnel-door request must carry a valid assertion`.

From then on, an away request without a valid token gets `403` (`access_required` or `access_invalid`); requests from home and the sidebar are not affected. Every path must go through Access: a *Bypass* rule for some paths doesn't work while Mantel checks the token. Mantel reads your team's public keys from Cloudflare; if it can't, away requests are refused until it can. Empty both options to turn the check off. See the [Security Model](Security-Model.md#reaching-mantel-from-away).

## Turn on house commands

Mantel starts read-only. It shows every state, saves settings and records the audit log, but it sends **no command** to Home Assistant until whoever runs the server turns commands on. No setting in the page, API call or app can turn them on. This is deliberate.

Before you turn them on:

- Link everyone to the right role, and check what each role allows ([People and Roles](People-and-Roles.md)). A Child or Guest sees only the rooms they are given.
- Set the house **Alarm PIN** (HK's settings inside **Mantel Settings** → **Alarm PIN**). It is the only code Mantel asks for, and only for the alarm.
- Know where the [audit log](Commands-and-Audit.md) is.

Then, in the App: **Configuration** → turn on **Allow house commands** → **Save** → restart the App. The log line now says `COMMANDS ENABLED`. To turn them off again, turn the option off and restart.

For Docker and the LXC, see [Install with Docker → Turn on house commands](Install-Docker.md#turn-on-house-commands).

When commands are on, every command is checked against the person's role and the tablet's role, refused where they don't allow it, and written to the audit log **before** it is sent. See [Commands and Audit](Commands-and-Audit.md) and the [Security Model](Security-Model.md).

## Removing the App

1. **Settings** → **Apps** → **Mantel** → **Uninstall**.
2. This removes the App and its data: people, roles, Mantel's copy of the settings, and the audit log. Make a Home Assistant backup first if you might want them back.

Nothing else in Home Assistant changes. If you built the App from source, also delete the `mantel` folder from Home Assistant's `addons` folder and check for updates in the App store again.
