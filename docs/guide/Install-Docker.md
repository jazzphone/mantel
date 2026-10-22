# Install with Docker

Run Mantel Server with Docker Compose on any Linux host that has Docker. The stack is Mantel Server, Caddy for HTTPS, and go2rtc for Live TV, each locked down (no extra privileges, read-only file systems, secrets as files). You give Mantel a name such as `mantel.example.com`, start the stack, and finish the setup in your browser. It takes about half an hour, most of it building the images. When it is running, go on to [First Run](First-Run.md).

Prefer Mantel inside Home Assistant? Use the [Home Assistant App](Install.md#install-the-home-assistant-app) instead. Have a Proxmox server? The [Proxmox LXC script](Install-Proxmox-LXC.md) does most of this page for you.

## Before you start

You need:

| | |
|---|---|
| **A Docker host** | Linux with Docker Engine and the Docker Compose v2 plugin (`docker compose`). An x86-64 (`amd64`) or `arm64` machine: every image is built for both. On `arm64`, Live TV transcodes in software (Intel's QuickSync driver is amd64-only).<!-- CHECK: the minimum Compose v2 version (update.sh uses `docker compose config --images` and `--wait-timeout`). --> |
| **git** | To get the files. |
| **A name for Mantel** | What browsers will type, for example `mantel.example.com`, and a DNS record that points it at this host. A record in your home's own DNS is enough. |
| **A way to get HTTPS** | Nothing to prepare for the default, Caddy's own certificate authority (you trust it once on each device). Or your own domain at Cloudflare, Duck DNS, Porkbun, Route 53, DigitalOcean or deSEC, with an API token from that DNS host; or a reverse proxy you already run. See [step 3](#3-choose-how-browsers-get-https). |
| **A Home Assistant user for Mantel** | A dedicated administrator user, for example `mantel-server` (**Settings** → **People** → **Add person**, *Can log in*, *Administrator*). You sign in as this user once, on Mantel's Connections page. |

The stack publishes these ports on the host:

| Port | For |
|---|---|
| `443` | Browsers and tablets, through Caddy (change it with `MANTEL_HTTPS_PORT`) |
| `8555` TCP and UDP | Live TV's video (WebRTC) to your screens |
| `8765` | Only with your own reverse proxy, for the proxy to reach Mantel |
| `8766` | Only with [Mantel Connect](Mantel-Connect.md) |

## 1. Get the files

```bash
git clone https://github.com/jazzphone/mantel.git
cd mantel/packaging/compose
```

To run a release rather than the newest code, check out its tag, for example `git checkout v0.1.36`. Each release's notes are in [CHANGELOG.md](https://github.com/jazzphone/mantel/blob/main/CHANGELOG.md).

Everything below runs in this `packaging/compose` folder.

## 2. Write the settings file

```bash
cp .env.example .env
```

Edit `.env`. It holds **settings only, never a secret**; tokens and keys are files (step 4).

| Setting | Example | What it is |
|---|---|---|
| `MANTEL_HOSTNAME` | `mantel.example.com` | The name browsers type. Required. |
| `MANTEL_LAN_IP` | `192.0.2.10` | This host's address on your home network, which tablets reach for Live TV's video. Required. |
| `MANTEL_ALLOW_HOSTS` | `192.0.2.10` | Other names to accept besides `MANTEL_HOSTNAME`, separated by commas. Optional. |
| `MANTEL_TLS_SNIPPET` | `./caddy/tls-internal.caddy` | How Caddy gets its certificate (step 3). |
| `MANTEL_SECRETS_DIR` | `/etc/hk/secrets` | Where the secret files are on this host. |
| `MANTEL_HA_URL`, `MANTEL_MA_URL` | empty | Leave empty: you connect Home Assistant and Music Assistant in the browser after the first start. |
| `MANTEL_BACKUP_DIR`, `MANTEL_BACKUP_TARGET` | `./backups`, empty | Mantel's nightly encrypted backups, off until you set the target. See [Backups](Backups.md). |
| `COMPOSE_FILE` | `compose.yaml:compose.gpu.yaml` | The extra parts you turn on (below), joined with `:`. |

`.env` may hold **only one** `COMPOSE_FILE` line. `.env.example` shows several, commented out, one for each extra part. To use more than one, join them on one line, for example:

```bash
COMPOSE_FILE=compose.yaml:compose.gpu.yaml:compose.connect.yaml
```

## 3. Choose how browsers get HTTPS

Mantel needs HTTPS for its sign-in cookies, passkeys, the doorbell's talk-back, and Music Assistant's and Live TV's frames. Pick one:

| You have | Do this | Notes |
|---|---|---|
| **No domain** (the default) | Keep `MANTEL_TLS_SNIPPET=./caddy/tls-internal.caddy`. | Caddy makes its own certificate authority. Browsers warn until you trust its root certificate on each device: [OPERATIONS.md](../OPERATIONS.md#https-four-ways) "Trusting Caddy's own CA" says how. |
| **Your own domain at Cloudflare** | Set `MANTEL_TLS_SNIPPET=./caddy/tls-dns01-cloudflare.caddy`. Put a Cloudflare API token in the `cloudflare_dns_token` secret file (step 4), limited to **Zone / DNS / Edit** for that one zone. | Caddy gets a real certificate through DNS. Nothing has to be reachable from the internet. |
| **Your own domain at Duck DNS, Porkbun, Route 53, DigitalOcean or deSEC** | Add that DNS host's file to `COMPOSE_FILE`, for example `compose.yaml:compose.dns-porkbun.yaml`, and put its credential in its secret file(s) (step 4). | The same, through that DNS host's API. The table in [OPERATIONS.md](../OPERATIONS.md#https-four-ways) lists each host's file, secret files and what the credential needs. With Duck DNS, `MANTEL_HOSTNAME` is your `<name>.duckdns.org`. |
| **Your own reverse proxy** (Nginx Proxy Manager, Traefik, ...) | Add `compose.byo-proxy.yaml` to `COMPOSE_FILE`, and set `MANTEL_TRUSTED_PROXY` to your proxy's IP address as Mantel sees it. Optionally `MANTEL_HTTP_BIND` to this host's address. | Caddy doesn't start. Mantel publishes plain HTTP on port 8765 for your proxy. See [Your own reverse proxy](#your-own-reverse-proxy). |

`.env.example` lays the same choices out. Another DNS host needs its module built into Caddy: see `packaging/docker/caddy.Dockerfile`.

> **Reaching Mantel from away.** The recommended way is a Cloudflare Tunnel, with Cloudflare Access in front of it: see [Remote access through a Cloudflare Tunnel](#remote-access-through-a-cloudflare-tunnel). It works beside any of the three choices above.

## 4. Create the secret files

Mantel reads every secret from a **file**, never from an environment variable, `.env`, the image or the repository. The files live in `/etc/hk/secrets` on the host (or `MANTEL_SECRETS_DIR`), and are mounted read-only into the containers.

Run this as root on the host. It creates the folder, two random keys, and empty placeholders for the tokens:

```bash
umask 077
install -d -m 0750 -o root -g 10001 /etc/hk/secrets
cd /etc/hk/secrets
head -c 32 /dev/urandom | base64 > at_rest.key
head -c 32 /dev/urandom | base64 > backup.key
: > ha_token; : > ma_token; : > cloudflare_dns_token; : > cloudflared_token
chown root:10001 * && chmod 0440 *
```

| File | What | Needed |
|---|---|---|
| `at_rest.key` | Seals the sign-in authenticator secrets, device keys and saved connections in Mantel's database. | Yes. **Keep a copy somewhere that is not this machine.** |
| `backup.key` | Encrypts Mantel's backups. | Yes. **Keep a copy somewhere that is not this machine.** |
| `cloudflare_dns_token` | The Cloudflare token for Caddy's certificate. | Only with your domain at Cloudflare; otherwise it stays empty. |
| Your DNS host's file(s) | For example `porkbun_api_key` and `porkbun_secret_api_key`: create them (`umask 077` and `printf`, as below) only when you use that DNS host. | Only with that host's `compose.dns-<host>.yaml` |
| `ha_token`, `ma_token` | Leave empty. Home Assistant and Music Assistant are connected in the browser. | No |
| `cloudflared_token` | The tunnel's token. | Only with `--profile tunnel` |

Every file must exist, even empty, or Compose won't start. To put a token in a file without it landing in your shell history:

```bash
read -rs -p 'Token: ' T && printf '%s' "$T" > /etc/hk/secrets/cloudflare_dns_token; unset T; echo
chown root:10001 /etc/hk/secrets/cloudflare_dns_token && chmod 0440 /etc/hk/secrets/cloudflare_dns_token
```

Losing `at_rest.key` makes every enrolled authenticator app unreadable, and without `backup.key` a backup can't be opened. Put both in your password manager now.

## 5. Get the images

**Use the published images** (the quickest). Each release publishes three, for `amd64` and `arm64` hosts:

| Image | Service |
|---|---|
| `ghcr.io/jazzphone/mantel-server` | Mantel Server |
| `ghcr.io/jazzphone/mantel-transcode` | Live TV's go2rtc and ffmpeg (with Intel's QuickSync driver on `amd64`) |
| `ghcr.io/jazzphone/mantel-caddy` | Caddy with its DNS modules (Cloudflare, Duck DNS, Porkbun, Route 53, DigitalOcean, deSEC) |

Each is tagged with the release's version (for example `:0.1.36`, the same number as the Home Assistant App's) and `:latest`, which follows the newest release. Name them in `.env`, pinned to a version so an update happens only when you change it ([Updating](Updating.md#published-images)):

```bash
MANTEL_SERVER_IMAGE=ghcr.io/jazzphone/mantel-server:0.1.36
MANTEL_TRANSCODE_IMAGE=ghcr.io/jazzphone/mantel-transcode:0.1.36
MANTEL_CADDY_IMAGE=ghcr.io/jazzphone/mantel-caddy:0.1.36
```

Then `docker compose pull`. To pin even tighter, use a digest (`ghcr.io/jazzphone/mantel-server@sha256:...`, shown by `docker buildx imagetools inspect ghcr.io/jazzphone/mantel-server:0.1.36`).

**Or build them from the source.** Leave the three `MANTEL_*_IMAGE` lines out of `.env`, and from `packaging/compose`:

```bash
docker compose build
```

This builds Mantel Server, the Live TV transcode and Caddy with its DNS modules from the files you cloned. It takes several minutes.

## 6. Start Mantel

```bash
docker compose up -d --wait
```

`--wait` returns when every service is healthy. Check with `docker compose ps`. Mantel starts without Home Assistant: you connect it in the browser next.

Mantel's log ends with a line like `mantel-server: https://mantel.example.com/login (listening on 0.0.0.0:8765; read-only; commands disabled)`. See it with `docker compose logs mantel-server`.

## 7. Point the name at this host

In your home's DNS, point `mantel.example.com` at this host's address. Then open `https://mantel.example.com/login`.

With your own reverse proxy, point the name at the proxy instead, and set the proxy up first ([below](#your-own-reverse-proxy)).

## 8. Make the first Owner

While Mantel has no Owner, its log shows a one-time setup code in a banner (valid one hour; a new one is logged when it expires):

```bash
docker compose logs mantel-server
```

To make a new one at once (it replaces the logged one): `docker compose exec mantel-server mantel bootstrap`. Then follow [First Run](First-Run.md#with-docker-or-the-lxc): the setup code, your user name and password, then Home Assistant on the **Connections** page.

Run Mantel's admin commands with `docker compose exec mantel-server mantel <command>`. Don't use `docker compose run` while Mantel is running: it would start a second server.

## Your own additions

Extra flags for Mantel Server's command line go in a file of your own, `compose.local.yaml`, in `packaging/compose`, and add it to the `COMPOSE_FILE` line in `.env`, for example:

```bash
COMPOSE_FILE=compose.yaml:compose.local.yaml
```

Compose replaces a service's `command:` instead of adding to it, so keep **every** flag in one list in this one file. After each change, run `docker compose up -d --wait`.

### Turn on house commands

Mantel starts read-only and sends no command to Home Assistant until the Owner turns commands on. Read [Install → Turn on house commands](Install.md#turn-on-house-commands) first.

Turn them on in the browser: as the Owner, open **Mantel Settings** → **General** and turn on **Allow Control of the House**. Mantel asks you to confirm it is you. It applies at once, with no restart. The `command: ["--commands-enabled"]` override is no longer needed: `--commands-enabled` is now only the value for the very first start.

To keep the house read-only whatever Mantel Settings says (a kill switch), set `MANTEL_READ_ONLY=1` in `.env`, then run `docker compose up -d --wait`. Take it out again to hand the choice back to Mantel Settings.

### Passkeys

Passkeys are tied to a name. Mantel uses the name in `MANTEL_HOSTNAME` (the host name of the address browsers type) for them, so there is nothing to add. Choose that name **before** anyone adds a passkey: a passkey made for one name doesn't work at another. Passkeys never work at an IP address.

An earlier version needed `"--rp-id", "mantel.example.com"` in `compose.local.yaml`. You can take it out; while it's there it still wins, so it must stay the same name as `MANTEL_HOSTNAME`.

## Your own reverse proxy

With `compose.byo-proxy.yaml`, your proxy owns HTTPS and forwards to Mantel at `http://<this host>:8765`. Mantel then needs to know which requests come from your home network. Your proxy tells it with two headers, and Mantel believes them only from `MANTEL_TRUSTED_PROXY`:

- `X-Mantel-Door: lan` for a proxy host that only your home network reaches (`tunnel` for one the internet reaches).
- `X-Mantel-Door-Key`: this installation's **door key**. Get it with `docker compose exec mantel-server mantel door-key`, or on `https://mantel.example.com/proxy-check` as the Owner. Keep it secret.

Without both, Mantel treats every request as remote, and wall tablets are refused. That is the safe way to fail.

**Nginx Proxy Manager.** Add a **Proxy Host**: your name, scheme `http`, forward to this host, port `8765`, **Websockets Support** on, **Block Common Exploits** on. On the **SSL** tab, a certificate for the name, **Force SSL** and **HTTP/2** (leave HSTS off: Mantel sends it). On the **Advanced** tab, paste this, with your host's address and your door key:

```nginx
location / {
    proxy_pass http://MANTEL_ADDRESS:8765;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $http_connection;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $http_host;
    set $mantel_door lan;
    if ($http_cf_connecting_ip) { set $mantel_door tunnel; }
    proxy_set_header X-Mantel-Door $mantel_door;
    proxy_set_header X-Mantel-Door-Key MANTEL_DOOR_KEY;
    proxy_set_header X-Remote-User-Id "";
    proxy_set_header X-Remote-User-Name "";
    proxy_set_header X-Remote-User-Display-Name "";
    proxy_set_header X-Ingress-Path "";
    proxy_read_timeout 1h;
    proxy_buffering off;
    client_max_body_size 12m;
}
```

Then give the proxy host an **Access List** that allows only your home's networks, or run a proxy the internet can't reach. Don't add a Content-Security-Policy in the proxy: Mantel sets its own.

Open `https://mantel.example.com/proxy-check` as the Owner. It checks HTTPS, the door header and key, the forwarded address, the security headers and WebSockets, and says what to change. It also shows the address your proxy's requests arrive from: that is what `MANTEL_TRUSTED_PROXY` must say.

Keep port 8765 off the internet, and if you can, reachable only from your proxy (`MANTEL_HTTP_BIND`, or a firewall rule).

## Remote access through a Cloudflare Tunnel

A Cloudflare Tunnel is the recommended way to reach Mantel from away: the stack's `cloudflared` service connects out to Cloudflare, so nothing on your router is opened. Everything through it gets Mantel's away rules ([Security Model](Security-Model.md#reaching-mantel-from-away)).

1. In Cloudflare Zero Trust, **Networks** → **Tunnels**, create a tunnel of type **Cloudflared** and copy its token into the `cloudflared_token` secret file (step 4).
2. Give the tunnel a **public hostname**, `mantel.example.com` (the same name as `MANTEL_HOSTNAME`, so passkeys work both ways), with the service `http://172.31.250.2:8080`: Caddy's tunnel door, which only `cloudflared` can reach. With your own reverse proxy instead of Caddy, see [OPERATIONS.md](../OPERATIONS.md) for where the tunnel goes. There `cloudflared` reaches Mantel directly, so Mantel sees every visitor from away at `cloudflared`'s address: the sign-in limit per address is then shared by everyone outside, and the sessions and the Audit Log show that address. Cloudflare Access (below) keeps strangers from reaching the sign-in at all.
3. Start it: `docker compose --profile tunnel up -d --wait`.

Opening a port on your router to Mantel or its proxy instead works too, but it's at your own risk: Mantel's sign-in page is then open to the whole internet.

### Cloudflare Access (optional)

Cloudflare Access asks for a sign-in of its own (your email address, or your identity provider) before a request reaches the tunnel, so strangers never see Mantel at all. It is optional, and recommended. Set it up in Cloudflare, then tell Mantel, and Mantel checks Cloudflare's signed token on every request through the tunnel and refuses any that lacks a valid one.

1. In Cloudflare Zero Trust, **Access** → **Applications**, add a **Self-hosted** application for `mantel.example.com`, with a policy that allows your household.
2. Find the **team name**: Zero Trust → **Settings** → **Team name and domain** shows `<team>.cloudflareaccess.com`. The part before `.cloudflareaccess.com` is the team name.
3. Find the **AUD tag**: open the application under **Access** → **Applications**; its overview shows the **Application Audience (AUD) Tag**, 64 letters and digits.
4. In `.env`:

   ```bash
   MANTEL_CF_ACCESS_TEAM=myteam
   MANTEL_CF_ACCESS_AUD=<the AUD tag>
   ```

   Several AUD tags (for several Access applications in front of Mantel) are separated by commas. Neither value is a secret.
5. `docker compose up -d --wait`. Mantel's log says `Cloudflare Access: every tunnel-door request must carry a valid assertion`.

From then on, a request through the tunnel without a valid token gets `403` (`access_required` or `access_invalid`), and the log says why without the token. Mantel fetches your team's public keys from Cloudflare (`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`); if it can't, tunnel requests are refused until it can. Home and Mantel Connect are not affected. Every path must go through Access: a *Bypass* rule for some paths doesn't work while Mantel checks the token. To turn the check off, empty both settings.

## Extra parts

Each is a file you add to `COMPOSE_FILE` in `.env`, then `docker compose up -d --wait`.

| File | Adds |
|---|---|
| `compose.gpu.yaml` | The Intel iGPU (QuickSync) for Live TV's transcode. Also set `MANTEL_RENDER_GID` to the `render` group's id: `getent group render \| cut -d: -f3`. |
| `compose.connect.yaml` | [Mantel Connect](Mantel-Connect.md): Mantel in Home Assistant's sidebar and the Companion app. |
| `compose.announce.yaml` | Announces Mantel on your network, so [Mantel Link](Mantel-Link.md) in Home Assistant offers **Discovered: Mantel**. |
| `compose.byo-proxy.yaml` | Your own reverse proxy instead of Caddy ([above](#your-own-reverse-proxy)). |

Music Assistant and Live TV are set up in Mantel itself: see [Music and Cameras](Music-and-Cameras.md).

## Removing Mantel

From `packaging/compose`:

- `docker compose down` stops and removes the containers. Mantel's data stays in the `mantel-data` volume.
- `docker compose down -v` also deletes the volumes: every person, role, setting and audit row. Make a [backup](Backups.md) first if you might want them back.

Then delete `/etc/hk/secrets` if nothing else uses it, and the DNS record.
