# Secret files

Mantel reads every secret from a **file**, never from an environment variable, the image or the repo.
Compose mounts these read-only at `/run/secrets/<name>`. Default location on the host:
`/etc/hk/secrets/` (set `MANTEL_SECRETS_DIR` in `.env` to move it). This folder holds no secret and
`.gitignore` keeps it that way.

Ownership: `root:10001`, mode `0440` (the image's user and the cloudflared container are in group
10001; Caddy runs as root), directory `0750`.

| File | What | Who reads it | Needed |
|---|---|---|---|
| `ha_token` | Optional. Long-lived access token of the dedicated HA user `mantel-server`. Normally left empty: Home Assistant is connected on the admin page (`/admin` → Connections), which keeps Mantel's own sealed copy on the data volume (`/data/connections`). A token here (with `MANTEL_HA_URL`) shows there as "set by the installation"; Mantel's saved copy wins over it | mantel-server | no; may be empty |
| `at_rest.key` | 32 random bytes (base64): seals TOTP seeds and device keys in SQLite | mantel-server | required; keep a copy off the box |
| `backup.key` | 32 random bytes (base64): encrypts the nightly backup | mantel-server | required; keep a copy off the box |
| `ma_token` | Optional, like `ha_token`: Music Assistant's token (with `MANTEL_MA_URL`); normally set on the Connections page | mantel-server | no; may be empty |
| `cloudflare_dns_token` | Cloudflare API token, **Zone:DNS:Edit on one zone only**, for ACME DNS-01 | caddy | only with `tls-dns01-cloudflare.caddy` (or its old name `tls-dns01.caddy`); must exist, may be empty, otherwise |
| `duckdns_token` | Duck DNS token (top of duckdns.org's page when signed in) | caddy | only with `compose.dns-duckdns.yaml` |
| `porkbun_api_key`, `porkbun_secret_api_key` | Porkbun API key pair, with API access turned on for the domain | caddy | only with `compose.dns-porkbun.yaml` |
| `route53_access_key_id`, `route53_secret_access_key` | An IAM user's access key, limited to the hosted zone (policy example: github.com/libdns/route53) | caddy | only with `compose.dns-route53.yaml` |
| `digitalocean_token` | DigitalOcean API token with the domain read and write scopes | caddy | only with `compose.dns-digitalocean.yaml` |
| `desec_token` | deSEC token, best limited to the domain by a token policy | caddy | only with `compose.dns-desec.yaml` |
| `cloudflared_token` | The tunnel token from the Cloudflare dashboard | cloudflared | only with `--profile tunnel`; may be empty |

Create them as root on the host. Write without a trailing newline (`printf`), then fix the owner:

```bash
umask 077
install -d -m 0750 -o root -g 10001 /etc/hk/secrets
cd /etc/hk/secrets
: > ha_token                    # Home Assistant is connected on the admin page (Connections); or, the old way:
# read -rs -p 'HA token: ' T && printf '%s' "$T" > ha_token; unset T; echo
head -c 32 /dev/urandom | base64 > at_rest.key
head -c 32 /dev/urandom | base64 > backup.key
: > ma_token; : > cloudflare_dns_token; : > cloudflared_token    # fill in later where used
# your own domain through another DNS host (.env.example, HTTPS "B"): its file(s), e.g. Porkbun's
# read -rs -p 'Porkbun API key: ' T && printf '%s' "$T" > porkbun_api_key; unset T; echo
chown root:10001 * && chmod 0440 *
```

Do not paste a token into chat or `.env`. Rotate a token by replacing the file and
`docker compose restart <service>`. The HA token is an admin-capable credential (HA cannot narrow
it): create it fresh for the `mantel-server` user, never reuse a personal one.
