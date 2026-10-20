# packaging/compose/

Docker Compose stack for plain Docker and the Proxmox LXC: caddy (TLS, headers, CSP), mantel-server,
go2rtc + the Live TV transcode, and an optional cloudflared (`--profile tunnel`). PLAN §8.
Full description, findings and the exact commands to verify it: `docs/phase3/PACKAGING.md`.

| File | What |
|---|---|
| `compose.yaml` | The stack. Plain YAML subset (no anchors) so `tools/package_check.py` can verify the hardening. |
| `compose.gpu.yaml` | Adds `/dev/dri` to the transcode. Enable with `COMPOSE_FILE=compose.yaml:compose.gpu.yaml` in `.env` where the host has an iGPU. |
| `compose.connect.yaml` | Mantel Connect: one more published port (8766, TLS, client certificates) for the Connect App in Home Assistant's sidebar. Enable with `COMPOSE_FILE=compose.yaml:compose.connect.yaml`, then `docker compose exec mantel-server mantel connect pair`. See `docs/phase3/CONNECT.md`. |
| `compose.announce.yaml` | Optional: announces Mantel on the home network (`_mantel._tcp`), so Home Assistant's **Mantel Link** offers "Discovered: Mantel" (confirmed with a pairing code from Mantel Settings → Connections → Home Assistant Link). The one service on the host's network (multicast never leaves Docker's), sealed by `tools/package_check.py`. Enable with `COMPOSE_FILE=compose.yaml:compose.announce.yaml`; or let the host's avahi announce it: `docker compose exec mantel-server python -m mantel_server.announce --avahi --file /data/announce.json`. Without either, add Mantel Link by hand with Mantel's address and a pairing code. |
| `.env.example` | Settings only, **no secrets**. Copy to `.env` (git-ignored). |
| `secrets/README.md` | The secret files (`/etc/hk/secrets/...`), their owner/mode and how to create them. |
| `caddy/Caddyfile`, `tls-dns01.caddy`, `tls-internal.caddy` | LAN door with TLS (DNS-01 or Caddy's own CA), tunnel door, headers, CSP. |
| `go2rtc/go2rtc.yaml` | go2rtc settings; streams are added at run time by Mantel Server. |
| `update.sh` | Pull, restart, wait for healthy, roll back to the previous images on failure. It pulls every image `.env` names from a registry (`MANTEL_SERVER_IMAGE`, `MANTEL_TRANSCODE_IMAGE`, `MANTEL_CADDY_IMAGE`), although each Mantel service also has a `build:` section; the `:local` defaults are built here and never pulled (update those with `git pull && docker compose build --pull && docker compose up -d --wait`). |

```bash
cp .env.example .env            # edit MANTEL_HOSTNAME, MANTEL_LAN_IP, MANTEL_HA_URL
# create the secret files: secrets/README.md
docker compose up -d --wait
docker compose run --rm mantel-server links     # list/link people (first Owner is an explicit admin step)
```

No home domain? Set `MANTEL_TLS_SNIPPET=./caddy/tls-internal.caddy` and `MANTEL_CADDY_IMAGE=caddy:2` (the
stock image is enough); browsers will warn until Caddy's local CA root is trusted.

## Mantel Link (Home Assistant's side)

Home Assistant (any install type) gets Mantel's tablets, actions and notifications from **Mantel Link** in HACS
(docs/phase9/MANTEL-LINK.md; its repository's Setup page). It reaches Mantel at its `https://` address, so Home
Assistant must trust Mantel's certificate: a DNS-01 certificate (`tls-dns01.caddy`) works as is; with Caddy's own CA
(`tls-internal.caddy`) Home Assistant refuses the link until that root is trusted where Home Assistant runs.
