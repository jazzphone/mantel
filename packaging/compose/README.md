# packaging/compose/

Docker Compose stack for plain Docker and the Proxmox LXC: caddy (TLS, headers, CSP), mantel-server,
go2rtc + the Live TV transcode, and an optional cloudflared (`--profile tunnel`). PLAN §8.
Full description, findings and the exact commands to verify it: `docs/phase3/PACKAGING.md`.

| File | What |
|---|---|
| `compose.yaml` | The stack. Plain YAML subset (no anchors) so `tools/package_check.py` can verify the hardening. |
| `compose.yaml` ports | Caddy 443, go2rtc 8555, and mantel-server's 8767: the Intercom's listener for Music Assistant (plain HTTP, one-time links only, off until the Intercom is on; `MANTEL_STREAM_BIND` / `MANTEL_STREAM_PORT`). It is published the same way with Caddy or your own proxy. |
| `compose.gpu.yaml` | Adds `/dev/dri` to the transcode. Enable with `COMPOSE_FILE=compose.yaml:compose.gpu.yaml` in `.env` where the host has an iGPU. |
| `compose.connect.yaml` | Mantel Connect: one more published port (8766, TLS, client certificates) for the Connect App in Home Assistant's sidebar. Enable with `COMPOSE_FILE=compose.yaml:compose.connect.yaml`, then `docker compose exec mantel-server mantel connect pair`. See `docs/phase3/CONNECT.md`. |
| `compose.announce.yaml` | Optional: announces Mantel on the home network (`_mantel._tcp`), so Home Assistant's **Mantel Link** offers "Discovered: Mantel" (confirmed with a pairing code from Mantel Settings → Connections → Home Assistant → Mantel Link). The one service on the host's network (multicast never leaves Docker's), sealed by `tools/package_check.py`. Enable with `COMPOSE_FILE=compose.yaml:compose.announce.yaml`; or let the host's avahi announce it: `docker compose exec mantel-server python -m mantel_server.announce --avahi --file /data/announce.json`. Without either, add Mantel Link by hand with Mantel's address and a pairing code. |
| `.env.example` | Settings only, **no secrets**. Copy to `.env` (git-ignored). |
| `secrets/README.md` | The secret files (`/etc/hk/secrets/...`), their owner/mode and how to create them. |
| `caddy/Caddyfile`, `tls-internal.caddy`, `tls-dns01-<host>.caddy` | LAN door with TLS (Caddy's own CA, the default; or DNS-01 through Cloudflare, Duck DNS, Porkbun, Route 53, DigitalOcean or deSEC), tunnel door, headers. `tls-dns01.caddy` is the Cloudflare one's older name. |
| `compose.dns-<host>.yaml` | Your own domain through a DNS host other than Cloudflare: mounts its `tls-dns01-<host>.caddy` and gives Caddy its secret files. Enable with `COMPOSE_FILE=compose.yaml:compose.dns-<host>.yaml` (`.env.example`, HTTPS "B"). |
| `go2rtc/go2rtc.yaml` | go2rtc settings; streams are added at run time by Mantel Server. |
| `update.sh` | Pull, restart, wait for healthy, roll back to the previous images on failure. It pulls every image `.env` names from a registry (`MANTEL_SERVER_IMAGE`, `MANTEL_TRANSCODE_IMAGE`, `MANTEL_CADDY_IMAGE`), although each Mantel service also has a `build:` section; the `:local` defaults are built here and never pulled (update those with `git pull && docker compose build --pull && docker compose up -d --wait`). |

```bash
cp .env.example .env            # edit MANTEL_HOSTNAME, MANTEL_LAN_IP; HTTPS: Caddy's own CA unless you choose a domain
# create the secret files: secrets/README.md
docker compose up -d --wait
docker compose logs mantel-server               # the first Owner's one-time setup code, for /login "First start"
```

With Caddy's own CA (the default) browsers warn until its root is trusted on each device; with your own domain
(DNS-01) the certificate is a real one.

## Mantel Link (Home Assistant's side)

Home Assistant (any install type) gets Mantel's tablets, actions and notifications from **Mantel Link** in HACS
(docs/phase9/MANTEL-LINK.md; its repository's Setup page). It reaches Mantel at its `https://` address, so Home
Assistant must trust Mantel's certificate: a DNS-01 certificate (`tls-dns01.caddy`) works as is; with Caddy's own CA
(`tls-internal.caddy`) Home Assistant refuses the link until that root is trusted where Home Assistant runs.
