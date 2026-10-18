# packaging/compose/

Docker Compose stack for plain Docker and the Proxmox LXC: caddy (TLS, headers, CSP), mantel-server,
go2rtc + the Live TV transcode, and an optional cloudflared (`--profile tunnel`). PLAN §8.
Full description, findings and the exact commands to verify it: `docs/phase3/PACKAGING.md`.

| File | What |
|---|---|
| `compose.yaml` | The stack. Plain YAML subset (no anchors) so `tools/package_check.py` can verify the hardening. |
| `compose.gpu.yaml` | Adds `/dev/dri` to the transcode. Enable with `COMPOSE_FILE=compose.yaml:compose.gpu.yaml` in `.env` where the host has an iGPU. |
| `.env.example` | Settings only, **no secrets**. Copy to `.env` (git-ignored). |
| `secrets/README.md` | The secret files (`/etc/hk/secrets/...`), their owner/mode and how to create them. |
| `caddy/Caddyfile`, `tls-dns01.caddy`, `tls-internal.caddy` | LAN door with TLS (DNS-01 or Caddy's own CA), tunnel door, headers, CSP. |
| `go2rtc/go2rtc.yaml` | go2rtc settings; streams are added at run time by Mantel Server. |
| `update.sh` | Pull, restart, wait for healthy, roll back to the previous images on failure. |

```bash
cp .env.example .env            # edit MANTEL_HOSTNAME, MANTEL_LAN_IP, MANTEL_HA_URL
# create the secret files: secrets/README.md
docker compose up -d --wait
docker compose run --rm mantel-server links     # list/link people (first Owner is an explicit admin step)
```

No home domain? Set `MANTEL_TLS_SNIPPET=./caddy/tls-internal.caddy` and `MANTEL_CADDY_IMAGE=caddy:2` (the
stock image is enough); browsers will warn until Caddy's local CA root is trusted.
