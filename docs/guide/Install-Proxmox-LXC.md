# Install in a Proxmox LXC

On a Proxmox VE server, one script creates a container for Mantel and installs everything in it: an **unprivileged** Debian 13 LXC running the same Docker Compose stack as [Install with Docker](Install-Docker.md), with the host's Intel iGPU shared in for Live TV. The script asks a few questions, shows you what it will do, and changes nothing until you say yes. You then start Mantel inside the container and finish in your browser with [First Run](First-Run.md).

There are two ways to run it. **One command** works like the [Proxmox VE community scripts](https://community-scripts.org): their engine and menus, Mantel's own scripts, and Mantel running and showing its setup code at the end. **From a checkout** is the original script, which needs nothing from community-scripts and also brings a backup across ([Moving from the Home Assistant App](#moving-from-the-home-assistant-app)).

## One command

On the Proxmox host, as root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/jazzphone/mantel/main/packaging/proxmox/ct/mantel.sh)"
```

It opens community-scripts' menu: **Default Settings** makes an unprivileged Debian 13 container with 4 cores, 6 GB of memory and a 32 GB disk, nesting and keyctl on for Docker, and the iGPU shared in when the host has one; **Advanced Settings** lets you change any of it. Inside the container it asks whether to show Mantel in Home Assistant's sidebar through [Mantel Connect](Mantel-Connect.md), installs Docker and builds Mantel's images (several minutes), then asks how browsers should reach Mantel:

| Choice | What you need | Mantel's address |
|---|---|---|
| **1. Try it now** (Enter) | Nothing | `https://<the container's address>`, with Mantel's own certificate: your browser warns the first time (continue to the page), and passkeys are off at an address |
| **2. A name on your network** | A name, e.g. `mantel.home.arpa`, that your home's DNS points at the container | `https://<that name>`, with Mantel's own certificate (trust it once on each device: [OPERATIONS.md](../OPERATIONS.md#https-four-ways)) |
| **3. Your own domain** | The name, and your DNS host's API token, typed in (it isn't shown) | `https://<your name>`, with a real certificate |
| **4. Your own reverse proxy** | Your proxy's address | `https://<your name>` through your proxy, which sends it to `http://<the container's address>:8765` |

Whatever you choose, **Mantel starts**, and the last screen shows its address and a one-time setup code for [First Run](First-Run.md#with-docker-or-the-lxc). If a choice still needs something you don't have yet (the token, the proxy's address), press Enter past it: Mantel starts on **Try it now**, and you finish later.

**Changing it later:** in the container's console (`pct enter <id>`, or the console in Proxmox), run `mantel-setup`. It asks the same question, shows what you have now as the default, writes the settings and the token's secret file, and starts Mantel again on the new address. Mantel Settings → **Set Up Mantel** → **Address and HTTPS** says the same while Mantel is on its address.

**If the container's address changes** (a new DHCP lease, or a static address you set after the install), Mantel follows it: at each start of the container, and on `update` or `mantel-setup`, the new address replaces the old one in its settings and Mantel starts again there. Your proxy or your DNS still points at the old address until you change it there, so give the container a fixed address (a DHCP reservation in your router, or a static address in Proxmox) before you point anything at it.

Every question can be answered ahead of time, so it runs unattended too:

```bash
var_mantel_tls=own var_mantel_proxy_ip=192.0.2.254 var_mantel_domain=mantel.example.com var_mantel_connect=no \
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/jazzphone/mantel/main/packaging/proxmox/ct/mantel.sh)"
```

| Setting | Default | Meaning |
|---|---|---|
| `var_mantel_tls` | asked; `try` | `try` (1), `internal` (2), `dns01` (3) or `own` (4). A DNS token is always typed, never preset |
| `var_mantel_domain` | asked; `mantel.home.arpa` with `internal` | The name browsers use (not with `try`) |
| `var_mantel_dns` | asked with `dns01`; `cloudflare` | `cloudflare`, `duckdns`, `porkbun`, `route53`, `digitalocean` or `desec` |
| `var_mantel_proxy_ip` | asked with `own` | Your proxy's IP address, as Mantel sees it |
| `var_mantel_connect` | asked; `no` | `yes` publishes Mantel Connect's port 8766 |
| `var_mantel_ref` | `latest` | What to install and follow: `latest` (the newest `v*` release tag, or `main` while there is none), a branch, a tag or a commit |

The usual community-scripts settings apply as well (`var_cpu`, `var_ram`, `var_disk`, `var_brg`, `var_gpu` and the rest).

**Updating:** inside the container, run `update`. It fetches what `var_mantel_ref` points at now, skips a release whose images aren't published yet, makes a backup, rebuilds, starts the new version and waits until it is healthy, and goes back to the previous version by itself if it isn't; `.env` is put back as it was whenever an update doesn't finish. With nothing new, it says so and changes nothing; on a checkout newer than the newest release (made from `main`), it says so and stays. If going back fails too (a new version that already updated the database), it says Mantel is not running and prints the `./restore.sh` line for the backup it made before the update.

**Pinned to a release:** the command above runs the scripts from `main`, and they install the newest release. To run exactly one release's scripts, name its tag in both places:

```bash
export var_mantel_ref=v0.1.112
bash -c "$(curl -fsSL https://raw.githubusercontent.com/jazzphone/mantel/$var_mantel_ref/packaging/proxmox/ct/mantel.sh)"
```

That container then stays on that release (`update` follows `var_mantel_ref`). community-scripts' engine is fetched at a fixed commit of [community-scripts/core](https://github.com/community-scripts/core); `COMMUNITY_SCRIPTS_URL` and `COMMUNITY_SCRIPTS_CORE_URL` override where the scripts and the engine come from.

**What runs:** the two scripts are Mantel's, in [`packaging/proxmox`](https://github.com/jazzphone/mantel/tree/main/packaging/proxmox); the engine they run on (the menus, creating the container) is community-scripts' own, fetched from [community-scripts/core](https://github.com/community-scripts/core) as their scripts do, and it sends their anonymous install statistics unless you turn diagnostics off in its menu. Mantel's source comes from GitHub with git, into `/opt/mantel`. Read them before you run them as root: `curl -fsSL <the URL above>` shows the first. From a clone of the repository you can also run `bash packaging/proxmox/ct/mantel.sh`, which uses the install script next to it.

Then open the address it printed. With choice 2 or 3, point the name at the container in your home's DNS first; with 4, point your proxy at it and open `/proxy-check` as the Owner ([Your own reverse proxy](Install-Docker.md#your-own-reverse-proxy)). A container made this way can also take a backup with `bash packaging/lxc/mantel.sh restore <id> …`, from a checkout on the host.

## From a checkout

### Before you start

You need:

| | |
|---|---|
| **A Proxmox VE host** | x86-64, with a shell as `root`. |
| **A network bridge** | One that reaches Home Assistant, your tablets and, for Live TV, your HDHomeRun tuner. The container gets its address by DHCP. |
| **Space** | 4 cores, 6 GB of memory and a 32 GB disk by default. |
| **A name for Mantel** | What browsers will type, for example `mantel.example.com`, and a way to get HTTPS (see [Install with Docker → HTTPS](Install-Docker.md#3-choose-how-browsers-get-https)). The script asks which. |
| **A Home Assistant user for Mantel** | A dedicated administrator user, for example `mantel-server`. You sign in as it once, on Mantel's Connections page. |
| **Optional: an Intel iGPU** | Live TV's transcode uses QuickSync when `/dev/dri/renderD128` exists on the host. Without it, the CPU transcodes. |

### What the script does

On the Proxmox host, and nothing else:

1. Checks that it runs as root on a Proxmox x86-64 host, and shows a summary.
2. Downloads the Debian 13 container template if it is missing.
3. Creates **one** container: unprivileged, with nesting and keyctl turned on for Docker, tagged `mantel`, **not** started at boot.
4. With an iGPU, shares its render node into the container. The host keeps using the GPU too.
5. Copies Mantel's source into `/opt/mantel` in the container, then installs Docker, the secret folder, the settings file, the images and automatic security updates inside it. The images are this release's published ones (`ghcr.io/jazzphone/mantel-*`, tagged with the version you checked out) when they exist; otherwise the script builds them in the container from the source.

It touches no other container or VM, changes no host setting, edits no firewall rule and opens no port. It does **not** start Mantel.

**Read the scripts before you run them as root.** They are `packaging/lxc/mantel.sh` (the host side) and `packaging/lxc/mantel-install.sh` (the container side). Run them from a copy you have read, never from a pipe.

### Run the script

1. On the Proxmox host, as root, get the source:

   ```bash
   apt install -y git
   git clone https://github.com/jazzphone/mantel.git
   cd mantel
   ```

   To pin the script that runs as root to a release you can read, check out its tag: `git checkout v0.1.112` (each release's tag; see [CHANGELOG.md](https://github.com/jazzphone/mantel/blob/main/CHANGELOG.md)).

2. Read the two scripts:

   ```bash
   less packaging/lxc/mantel.sh packaging/lxc/mantel-install.sh
   ```

3. Run it:

   ```bash
   bash packaging/lxc/mantel.sh
   ```

4. Answer its questions. Press **Enter** for the first choice in a list:

   | Question | What to answer |
   |---|---|
   | Where the container's disk goes | A storage that holds container disks |
   | Where the Debian 13 template is kept | A storage that holds templates |
   | Which bridge | The bridge that reaches Home Assistant, the tuner and your tablets |
   | VLAN tag | Your VLAN's number, or **Enter** for none |
   | How browsers reach Mantel over HTTPS | `internal` (**Enter**: Caddy's own certificate authority, no domain needed; you trust it once on each device), `dns01` (your own domain, with a real certificate) or `own` (your own reverse proxy) |
   | Which DNS host serves your domain | Only with `dns01`: `cloudflare`, `duckdns`, `porkbun`, `route53`, `digitalocean` or `desec`. Its token is put in after the install. |
   | The name browsers use | For example `mantel.example.com` (with Duck DNS, your `<name>.duckdns.org`); **Enter** for `mantel.home.arpa`, except with `dns01` |
   | Your proxy's address | Only with `own`: its IP address as Mantel will see it, or **Enter** to set it later in `.env` |
   | Also a Cloudflare tunnel? | `yes` to reach Mantel from away (recommended over opening a port). Then follow [Remote access through a Cloudflare Tunnel](Install-Docker.md#remote-access-through-a-cloudflare-tunnel), Cloudflare Access included. |

5. Check the summary and answer `y`. The install takes a few minutes with published images, several more when it builds them. It ends with **Installed. Mantel is NOT running yet.**

You can answer every question ahead of time with `var_` settings in the environment, for example `var_ctid=120 var_brg=vmbr0 var_tls=dns01 var_dns=cloudflare var_domain=mantel.example.com bash packaging/lxc/mantel.sh`. When the script has no terminal to ask at, an HTTPS choice you didn't preset is `internal`:

| Setting | Default | Meaning |
|---|---|---|
| `var_ctid` | the next free id | The container's id |
| `var_hostname` | `mantel` | The container's host name |
| `var_cpu`, `var_ram`, `var_disk` | `4`, `6144`, `32` | Cores, memory in MB, disk in GB |
| `var_storage`, `var_template_storage` | asked | Proxmox storages for the disk and the template |
| `var_brg`, `var_vlan` | asked | The bridge, and a VLAN tag (`none` for none) |
| `var_gpu` | `yes` | Share the iGPU's render node in (skipped by itself when the host has none) |
| `var_tls` | asked; `internal` without a terminal | `internal`, `dns01` or `own` |
| `var_dns` | asked with `dns01`; `cloudflare` without a terminal | `cloudflare`, `duckdns`, `porkbun`, `route53`, `digitalocean` or `desec` |
| `var_domain` | asked | The name browsers use |
| `var_proxy_ip` | asked with `own` | Your proxy's IP address |
| `var_tunnel` | asked | `yes` or `no` |
| `var_connect` | `no` | `yes` also turns on [Mantel Connect](Mantel-Connect.md)'s port 8766 |
| `var_install_mode` | `auto` | `auto`: pull this version's published images, and build them in the container when they aren't published. `pull`: only pull (the install stops if they aren't there). `build`: always build from the source. Pulled images are named in `.env` with the version (`MANTEL_SERVER_IMAGE` and the others; [Install with Docker → Get the images](Install-Docker.md#5-get-the-images)), and `mantel.sh push` moves them to the newer checkout's version. |

The container is always unprivileged and Debian 13; the script refuses anything else.

## Finish inside the container

1. Enter the container (the script prints its id):

   ```bash
   pct enter <id>
   ```

2. Check the settings file. The script filled in the container's address and your choices:

   ```bash
   nano /opt/mantel/packaging/compose/.env
   ```

   `MANTEL_HOSTNAME` is the name browsers type. You don't need a Home Assistant address or token here.
3. Put in the tokens your HTTPS choice needs. `mantel-secret` reads a secret from the keyboard (nothing is echoed or kept in your history) and saves it with the right owner and permissions:

   ```bash
   mantel-secret cloudflare_dns_token     # only with dns01 at Cloudflare: a token with Zone / DNS / Edit for that one zone
   ```

   With another DNS host, the install's last lines name its secret files, for example `mantel-secret porkbun_api_key` and `mantel-secret porkbun_secret_api_key` (what each needs: [OPERATIONS.md](../OPERATIONS.md#https-four-ways)). With `internal` there is no token: trust Caddy's root on each device instead ([OPERATIONS.md](../OPERATIONS.md#https-four-ways), "Trusting Caddy's own CA").

   The script already made `at_rest.key` and `backup.key` in `/etc/hk/secrets`. **Copy both somewhere that is not this machine**, for example your password manager: a restore needs them.
4. Start Mantel:

   ```bash
   cd /opt/mantel/packaging/compose && docker compose up -d --wait
   ```

5. In your home's DNS, point the name at the container's address (with `own`, point it at your proxy, and point the proxy at `http://<container address>:8765`; see [Your own reverse proxy](Install-Docker.md#your-own-reverse-proxy)).
6. Find the first Owner's one-time setup code in Mantel's log, in a banner (valid one hour; a new one is logged when it expires):

   ```bash
   docker compose logs mantel-server
   ```

   From the Proxmox host, without entering the container: `pct exec <id> -- docker logs mantel-server`. A new code at once (it replaces the logged one): `docker compose exec mantel-server mantel bootstrap`.

7. Open `https://mantel.example.com/login` and follow [First Run](First-Run.md#with-docker-or-the-lxc).

Everything on [Install with Docker](Install-Docker.md) applies inside the container, in `/opt/mantel/packaging/compose`: the extra parts, [house commands and passkeys](Install-Docker.md#your-own-additions), and your own reverse proxy.

## Moving from the Home Assistant App

**The simplest way:** install with [one command](#one-command), then open Mantel's address and, under **First start**, choose **Restore From a Backup**: the setup code the install showed, the App's backup and its keys file (the App's **Mantel Settings** → **Backups**: **Back Up Now**, **Download**, **Save Keys…**). Mantel restarts with the App's people, screens and settings, and you sign in as before. The new Mantel must be the App's version or newer. Then connect Home Assistant in **Mantel Settings** → **Connections** (the App reached it through the Supervisor, so there is no saved connection to bring): rooms, devices, cameras and your screens' contents come from it. Restore at the container's own address, or behind your own proxy raise its upload limit first ([Nginx Proxy Manager](Install-Docker.md#your-own-reverse-proxy): `client_max_body_size 4g;`): a backup with photos is hundreds of MB.

From a checkout, one command makes the container and brings the App's Mantel into it: its people, screens, settings, audit log, files and photos, and its keys, so authenticator apps and the Music Assistant connection keep working.

1. In the App, **Mantel Settings** → **Backups**: **Back Up Now**, then **Download** it, and **Save Keys…** (`mantel-keys.json`). Copy both to the Proxmox host.
2. Run the script with them. The new Mantel must be the App's version or newer. If the App sits behind your own proxy, keep its name, so passkeys, notifications and the tablets' address keep working:

   ```bash
   var_restore=mantel-20261101-120000.mbk var_restore_keys=mantel-keys.json \
   var_tls=own var_proxy_ip=<your proxy's address> var_domain=<the App's name, e.g. mantel.example.com> \
   bash packaging/lxc/mantel.sh
   ```

   The backup is checked before the container's Mantel first starts, and restored into it. With no setup code to find, step 6 below is skipped: you sign in as the Owner you were.
3. Start Mantel ([Finish inside the container](#finish-inside-the-container), steps 1 to 4) and test it before you switch, for example through a second name on your proxy pointed at `http://<container address>:8765` (passkeys only work at the real name; a password and authenticator code do). The App keeps running meanwhile.
4. What the backup can't bring, because it belongs to the App: in **Mantel Settings** → **Connections**, **Connect to Home Assistant** (the App used Home Assistant's own App credential); the App's options (Read-only, Direct access, its address and proxy) are now `.env`; Home Assistant's sidebar reaches this Mantel through [Mantel Connect](Mantel-Connect.md) (`var_connect=yes`), so tablets that opened Mantel through the sidebar move to its own address; and Mantel Link is linked again. Everyone signs in once.
5. To switch over, point your proxy at the container (`http://<container address>:8765`) instead of the App, then stop the App. Pointing it back undoes it.

The App keeps changing until you switch. To bring the latest across, make a new backup just before step 5 and restore it from the Proxmox host (this keeps the container's keys file as it is):

```bash
bash packaging/lxc/mantel.sh restore <id> mantel-20261101-180000.mbk mantel-keys.json
```

## Live TV on the iGPU

With an iGPU, the script shares `/dev/dri/renderD128` into the container, adds `compose.gpu.yaml` to `COMPOSE_FILE` and sets `MANTEL_RENDER_GID` in `.env`. Nothing else to do. The container must reach your tuner, and your tablets must reach the container on port 8555 (TCP and UDP). Turning on Live TV itself is in [Music and Cameras](Music-and-Cameras.md).

## Start it with the host

The container is created **not** to start at boot, so a first install can't surprise you. When Mantel works, on the Proxmox host:

```bash
pct set <id> --onboot 1
```

## Removing Mantel

On the Proxmox host:

```bash
pct stop <id> && pct destroy <id> --purge
```

This deletes the container with everything in it: Mantel's data, its secret files and its local backups. Make a [backup](Backups.md) somewhere else first if you might want them back.
