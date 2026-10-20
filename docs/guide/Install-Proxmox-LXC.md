# Install in a Proxmox LXC

On a Proxmox VE server, one script creates a container for Mantel and installs everything in it: an **unprivileged** Debian 13 LXC running the same Docker Compose stack as [Install with Docker](Install-Docker.md), with the host's Intel iGPU shared in for Live TV. The script asks a few questions, shows you what it will do, and changes nothing until you say yes. You then start Mantel inside the container and finish in your browser with [First Run](First-Run.md).

## Before you start

You need:

| | |
|---|---|
| **A Proxmox VE host** | x86-64, with a shell as `root`. |
| **A network bridge** | One that reaches Home Assistant, your tablets and, for Live TV, your HDHomeRun tuner. The container gets its address by DHCP. |
| **Space** | 4 cores, 6 GB of memory and a 32 GB disk by default. |
| **A name for Mantel** | What browsers will type, for example `mantel.example.com`, and a way to get HTTPS (see [Install with Docker → HTTPS](Install-Docker.md#3-choose-how-browsers-get-https)). The script asks which. |
| **A Home Assistant user for Mantel** | A dedicated administrator user, for example `mantel-server`. You sign in as it once, on Mantel's Connections page. |
| **Optional: an Intel iGPU** | Live TV's transcode uses QuickSync when `/dev/dri/renderD128` exists on the host. Without it, the CPU transcodes. |

## What the script does

On the Proxmox host, and nothing else:

1. Checks that it runs as root on a Proxmox x86-64 host, and shows a summary.
2. Downloads the Debian 13 container template if it is missing.
3. Creates **one** container: unprivileged, with nesting and keyctl turned on for Docker, tagged `mantel`, **not** started at boot.
4. With an iGPU, shares its render node into the container. The host keeps using the GPU too.
5. Copies Mantel's source into `/opt/mantel` in the container, then installs Docker, the secret folder, the settings file, the images and automatic security updates inside it.

It touches no other container or VM, changes no host setting, edits no firewall rule and opens no port. It does **not** start Mantel.

**Read the scripts before you run them as root.** They are `packaging/lxc/mantel.sh` (the host side) and `packaging/lxc/mantel-install.sh` (the container side). Run them from a copy you have read, never from a pipe.

## Run the script

1. On the Proxmox host, as root, get the source:

   ```bash
   apt install -y git
   git clone https://github.com/jazzphone/mantel.git
   cd mantel
   ```

   <!-- RELEASE: once tagged releases exist, add "git checkout <release tag>" here, so the script that runs as root is one you can pin and read. -->

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
   | How browsers reach Mantel over HTTPS | `dns01` (your domain on Cloudflare DNS), `internal` (Caddy's own certificate authority) or `own` (your own reverse proxy) |
   | The name browsers use | For example `mantel.example.com` |
   | Your proxy's address | Only with `own`: its IP address as Mantel will see it, or **Enter** to set it later in `.env` |
   | Also a Cloudflare tunnel? | `yes` to reach Mantel from away (recommended over opening a port). Then follow [Remote access through a Cloudflare Tunnel](Install-Docker.md#remote-access-through-a-cloudflare-tunnel), Cloudflare Access included. |

5. Check the summary and answer `y`. The install takes several minutes, most of it building the images. It ends with **Installed. Mantel is NOT running yet.**

You can answer every question ahead of time with `var_` settings in the environment, for example `var_ctid=120 var_brg=vmbr0 var_tls=dns01 var_domain=mantel.example.com bash packaging/lxc/mantel.sh`:

| Setting | Default | Meaning |
|---|---|---|
| `var_ctid` | the next free id | The container's id |
| `var_hostname` | `mantel` | The container's host name |
| `var_cpu`, `var_ram`, `var_disk` | `4`, `6144`, `32` | Cores, memory in MB, disk in GB |
| `var_storage`, `var_template_storage` | asked | Proxmox storages for the disk and the template |
| `var_brg`, `var_vlan` | asked | The bridge, and a VLAN tag (`none` for none) |
| `var_gpu` | `yes` | Share the iGPU's render node in (skipped by itself when the host has none) |
| `var_tls` | asked | `dns01`, `internal` or `own` |
| `var_domain` | asked | The name browsers use |
| `var_proxy_ip` | asked with `own` | Your proxy's IP address |
| `var_tunnel` | asked | `yes` or `no` |
| `var_connect` | `no` | `yes` also turns on [Mantel Connect](Mantel-Connect.md)'s port 8766 |
| `var_install_mode` | `build` | `build`: build the images in the container. `pull`: use published images. <!-- RELEASE: `pull` needs the ghcr.io/jazzphone/mantel-* images published; until then keep `build`. --> |

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
   mantel-secret cloudflare_dns_token     # only with dns01: a Cloudflare token with Zone / DNS / Edit for that one zone
   ```

   The script already made `at_rest.key` and `backup.key` in `/etc/hk/secrets`. **Copy both somewhere that is not this machine**, for example your password manager: a restore needs them.
4. Start Mantel:

   ```bash
   cd /opt/mantel/packaging/compose && docker compose up -d --wait
   ```

5. In your home's DNS, point the name at the container's address (with `own`, point it at your proxy, and point the proxy at `http://<container address>:8765`; see [Your own reverse proxy](Install-Docker.md#your-own-reverse-proxy)).
6. Get a one-time setup code for the first Owner:

   ```bash
   docker compose exec mantel-server mantel bootstrap
   ```

7. Open `https://mantel.example.com/login` and follow [First Run](First-Run.md#with-docker-or-the-lxc).

Everything on [Install with Docker](Install-Docker.md) applies inside the container, in `/opt/mantel/packaging/compose`: the extra parts, [house commands and passkeys](Install-Docker.md#your-own-additions), and your own reverse proxy.

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
