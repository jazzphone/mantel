# P3.6 Packaging: one image, three ways to run it (2026-10-18)

PLAN §7 "Container and host" and §8. Everything here is written and **statically checked**; nothing
has been built or run, because Docker is not installed on this Mac and no Proxmox host was touched.
"What needs Docker / Proxmox" below says exactly what to run and what to look for.

## The artifacts

| Path | What it is |
|---|---|
| `packaging/docker/Dockerfile` | Multi-stage. Targets: **`server`** (default, last stage; Python slim, non-root uid 10001, no ffmpeg, no devices), **`app`** (same layers for the HA App; starts as root only to chown `/data`, then `entrypoint.py` drops to 10001), **`transcode`** (go2rtc + ffmpeg + `intel-media-va-driver-non-free` + vainfo + curl, uid 10002). Base images pinned `@sha256:`; the all-zero digests are **placeholders** that fail the build until pinned. |
| `packaging/docker/caddy.Dockerfile` | Stock Caddy plus the Cloudflare DNS module (xcaddy) for ACME DNS-01. Skip it (use `tls-internal.caddy` and stock Caddy) for a home with no domain. |
| `packaging/docker/entrypoint.py` | The "small startup step" of PLAN §8: detects HA App (`SUPERVISOR_TOKEN` + `/data/options.json`) vs container, builds the `mantel_server` command line from `MANTEL_*` variables (no secret among them), moves the Supervisor token into a 0600 file and out of the environment, and passes admin commands (`links`, `link`, ...) straight through with `--data-dir /data`. |
| `.dockerignore` | The build context is the repo root; this keeps `.git`, docs, tests, secrets, `spikes/` and Apple fonts out. |
| `hosts/server/mantel_server/health.py` | `register(app, hub)` adds `GET /healthz` (liveness + HA link status, no secrets, 200 unless `?strict=1`) and `GET /api/version` (build id). `python -m mantel_server.health` is the HEALTHCHECK probe. |
| `tools/build_static.py` | Stages `web/` and stamps a content-derived build id (`BUILD_ID`, `static-manifest.json`); the Dockerfile runs it. |
| `packaging/compose/compose.yaml` (+ `compose.gpu.yaml`, `.env.example`, `caddy/`, `go2rtc/`, `secrets/README.md`, `update.sh`) | The stack: caddy, mantel-server, go2rtc (+ the transcode), optional cloudflared (`--profile tunnel`). |
| `packaging/lxc/mantel.sh`, `mantel-install.sh` | The Proxmox LXC installer (community-scripts layout) and its in-container half. |
| `packaging/ha-app/config.yaml` | The HA App definition (Ingress, built-in App credential). Scaffold: see "Open gaps". |
| `tools/package_check.py`, `tests/test_packaging.py` | The static validation (below). |

### The compose stack

* **Services.** `caddy` (publishes 443 only), `mantel-server`, `go2rtc` (the transcode image; publishes WebRTC 8555 tcp+udp; its API :1984 stays internal and unauthenticated by design), `cloudflared` (profile `tunnel`).
* **Hardening on every service.** `cap_drop: [ALL]` (Caddy adds back `NET_BIND_SERVICE` and nothing else), `no-new-privileges`, `read_only: true` with a small tmpfs `/tmp`, `mem_limit`/`cpus`/`pids_limit`, healthchecks, no Docker socket, no host namespaces.
* **Networks.** `backend` (internal, no route out: caddy, mantel-server, go2rtc); `egress` (caddy for ACME, mantel-server for HA/MA/internet, go2rtc for cameras and the tuner); `tunnel` (internal, fixed `172.31.250.0/29`: **caddy and cloudflared only**); `cf_out` (cloudflared alone, for its outbound link). Compose has no "internal but outbound" network, hence the extra `cf_out`.
* **Two doors.** Caddy serves the LAN door (`https://$MANTEL_HOSTNAME`, TLS) and a tunnel door (plain HTTP on the tunnel network's address only, so only cloudflared can reach it). Caddy deletes any client-supplied `X-Mantel-Door` / `X-Remote-User-*` / `X-Ingress-Path` and stamps `X-Mantel-Door: lan|tunnel`, so Mantel Server (reachable only from Caddy) can refuse wall-tablet credentials on `tunnel` (PLAN §7). `Cf-Access-Jwt-Assertion` is dropped on the LAN door. `X-Forwarded-For` is trusted only from cloudflared's fixed address. Mantel Server does **not yet read** `X-Mantel-Door` or the Access JWT (accounts/tunnel work). *(Update: since P3.3 it reads `X-Mantel-Door`, believing `lan` only from a `--trusted-proxy`; since PINS-AUDIT.md the compose file pins Caddy at `172.31.251.2` on the backend network (subnet `172.31.251.0/28`), Caddy proxies to Mantel's backend-only alias `mantel-backend`, and `entrypoint.py` passes `MANTEL_TRUSTED_PROXY=172.31.251.2` as `--trusted-proxy`, so the LAN door is recognised behind Caddy.)*
* **Secrets** are files (`/etc/hk/secrets`, `root:10001`, 0440) mounted at `/run/secrets/<name>`; see `secrets/README.md`. Declared: `ha_token` (used now), `data_key` and `ma_token` (reserved for P3.1/P3.4), `cloudflare_dns_token` (Caddy DNS-01), `cloudflared_token`. Compose does not apply `uid/gid/mode` to file secrets, hence the group-readable files and `group_add: ["10001"]`.
* **Update and rollback.** `update.sh` tags the running images `mantel-rollback/<service>:previous`, `compose pull`, `up -d --wait`; if a service is not healthy it restarts the remembered images with `--pull never`. Production references should be digests (`.env.example` says so).
* **Transcode choice.** PLAN §8 says "the image carries `intel-media-va-driver-non-free`". I made that a *separate image from the same Dockerfile*: only go2rtc/ffmpeg gets `/dev/dri` and a non-free driver, so the process that faces the network and holds the HA token has neither. Mantel Server starts/stops a channel through go2rtc's API (`PUT /api/streams`, `#hardware`); it never execs ffmpeg itself. `/dev/dri` lives in `compose.gpu.yaml`, added through `COMPOSE_FILE` only where the host has it (a missing device would make plain `up` fail).

### The three run modes (same layers)

| | HA App | Docker | Proxmox LXC |
|---|---|---|---|
| Entry | `packaging/ha-app/config.yaml`, target `app`, port 8099 via Ingress | `cp .env.example .env`, secrets, `docker compose up -d --wait` | `bash packaging/lxc/mantel.sh` (host), then `mantel-secret ha_token`, `docker compose up -d --wait` |
| Settings | HA options page -> `/data/options.json` | `MANTEL_*` in `.env` | same as Docker |
| HA credential | built-in `SUPERVISOR_TOKEN` -> `/tmp/ha_token` (0600), `http://supervisor/core` | `secrets/ha_token` | same as Docker |
| Update | HA's | `./update.sh` | `mantel-update` inside (registry images) or `bash packaging/lxc/mantel.sh push <ctid>` from the host (build mode) |

`mantel.sh` keeps the community-scripts **layout and variable names** (`var_cpu/ram/disk/os/version/unprivileged/gpu`, `variables`, `update_script`, `build_container`, `description`, Debian 13, `var_unprivileged=1`, `var_gpu=yes`) but does **not** source `build.func`. Finding (checked 2026-10-18 against upstream `misc/build.func`): its install step downloads `install/${var_install}.sh` from the community-scripts repository at a fixed URL, so a script that lives in our repo cannot use it unmodified. `mantel.sh` therefore does the same work with `pct` directly, the way `packaging/lxc/proof4/create-lxc.sh` did on proxmox1 (unprivileged, `nesting=1,keyctl=1`, `pct set -dev0 /dev/dri/renderD128,gid=<render gid>` with a bind-mount fallback). It also avoids `curl | bash` of a moving `main`; the routine is: read it, run it from a checkout you pinned. Porting to `build.func` later means contributing to upstream or forking it.

## The listen-address option (the only change to config/entrypoint code)

Loopback stays the default and `--host` still does not exist. New, in `config.py`:

* `--listen ADDRESS` (e.g. `0.0.0.0` inside the container) **requires** `--public-url https://name/`; without it, parsing fails. `--public-url` / `--allow-host NAME` alone are refused.
* `--public-url` becomes HA's OAuth `client_id`/`redirect_uri` (so "Sign in with Home Assistant" works behind Caddy) and the Host name accepted; `--allow-host` adds more (`*` is accepted for the HA App only, where Ingress is the sole way in).
* `loopback_only` in `server.py` (three lines) now asks `cfg.host_allowed()` instead of a fixed set, so behind Caddy the public name passes and DNS-rebinding protection stays. The Origin check is unchanged and works because Caddy forwards `Host` untouched.
* `__main__.py` prints the real URL. Tests: `tests/test_config.py` (loopback default, rules, middleware).

One more small fix outside the brief: `web/shim/hub.js` opened `ws://` unconditionally, which an https page cannot do. It now picks `wss://` on https (one line).

## CSP findings (verified by scanning `web/`; nothing was weakened silently)

Scan of `web/` (excluding `mdi/`): script-side the policy `script-src 'self'` is **safe as shipped**:

* `eval(` / `new Function(` / string timers: **none** in code (two comment mentions in `hk-control.js`).
* Inline event-handler attributes (`onclick=` ...): **none**. Inline `<script>`: **none** (the one page script is `<script type="module" src="/web/home.js">`; dynamic `import()` and injected `<script src>` are same-origin).
* Blob worker: `hk-cameras.js` creates a `Worker(URL.createObjectURL(Blob))` for talk-back. Allowed by `worker-src 'self' blob:`.

Style-side `style-src 'self'` is **not** possible today; PLAN §7's "HK's inline styles move to adopted stylesheets, already the pattern" is only partly true. Counts: `adoptedStyleSheets` in 4 files (21 hits), but also `<style>` elements created in 14 files (20 `createElement('style')`, 35 `<style` occurrences in 24 files including `web/home.html`'s own block) and **301 `style="..."` attributes** inside markup strings in 22 files, plus 47 `cssText`/`setAttribute('style')` uses in 18 files. (The ~1,000 `el.style.x = ...` assignments are CSSOM and are allowed under any policy.) So the Caddyfile ships `style-src 'self' 'unsafe-inline'` **and a strict `script-src 'self'`** and says so in the header comment. Path to strict styles (front-end work, outside this slice): convert `style="..."` strings to classes/adopted sheets, then add a Report-Only header with `style-src 'self'` to measure before enforcing.

Other directives and why:

* `img-src 'self' data: blob: https://tile.openstreetmap.org https://*.rainviewer.com https://mapservices.weather.noaa.gov`: OSM tiles (`hk-person`, `hk-radar`), RainViewer/NOAA radar, `data:` SVG masks in `hk-energy`/`hk-stat`/`hk-settings`.
* `connect-src 'self' https://api.rainviewer.com https://tile.openstreetmap.org https://mapservices.weather.noaa.gov`: radar fetches. `'self'` covers the same-origin `wss://.../ws`. Extra origins (go2rtc, HA) go through `MANTEL_CONNECT_SRC`.
* `frame-src 'self' $MANTEL_FRAME_SRC`: `hk-media.js` iframes **Music Assistant's web app** and `hk-settings.js` creates an iframe. **Mixed content:** an https Mantel cannot frame `http://ma:8095` or open `ws://` to go2rtc. Either MA/go2rtc sit behind TLS (Caddy can proxy them, a later change) or those cards stay broken on https. Not solved here.
* `frame-ancestors 'none'` by default, **but** HA Ingress (and Mantel Connect's sidebar page) display Mantel inside HA's page. Those modes need `MANTEL_FRAME_ANCESTORS` set to HA's origin. PLAN §7 states `'none'` flatly; it cannot hold for the HA-sidebar way in.
* `Referrer-Policy: strict-origin-when-cross-origin`, not `no-referrer`: OSM's tile policy requires a Referer.
* `Permissions-Policy` keeps `microphone=(self)` (doorbell talk-back), denies camera/geolocation/payment/usb.
* `default-src 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, HSTS (`max-age=31536000`, no preload).

`tools/package_check.py` fails if `script-src` is anything but `'self'` or any directive carries `'unsafe-eval'`.

## Static checks (run here, pass)

```bash
~/.venvs/mantel/bin/python tools/package_check.py            # clean; --release also refuses the placeholder digests
~/.venvs/mantel/bin/python -m pytest -q tests/test_packaging.py tests/test_config.py
```

`package_check` verifies: Dockerfile final stage non-root `USER`, only the `app` stage may be root, `HEALTHCHECK` on the final/app/transcode stages, every `FROM` pinned by digest, no secret-named `ENV`/`ARG`, no token-shaped text, no `COPY` of `.env`/`secrets`/keys, no `curl | sh`; compose: `cap_drop ALL`, `no-new-privileges`, `read_only`, limits, healthchecks, no privileged/host namespaces/Docker socket, secrets declared as `file:` only (and none in `environment`), only caddy/go2rtc publish ports, cloudflared optional and on the internal `tunnel` network with caddy alone, `/dev/dri` only in the GPU override; Caddyfile CSP/HSTS/admin-off/door header; LXC script `var_unprivileged` default 1, never `--unprivileged 0`, `var_gpu=yes`, Debian 13, layout functions, no pipe-to-shell; HA App `ingress: true`, no host network/devices/full_access; no `.env`, no files in `secrets/` but the README, `.env.example` without secret values. The compose file is written in a plain YAML subset on purpose (no anchors) so the checker needs no YAML library. Also run in the tests when the tools exist: `bash -n` on the three shell scripts and **`caddy validate`** on the Caddyfile (Caddy 2.11.7 is installed on this Mac; validated with the `internal` TLS snippet since the DNS module is not in the stock binary).

`.gitignore` ignores `secrets/` and `.env.*`; it now un-ignores `.env.example` and `packaging/compose/secrets/README.md`.

## Static asset hashing (PLAN §8)

Implemented: `tools/build_static.py` stamps a build id (hash of every served file's path and bytes) into `BUILD_ID` / `static-manifest.json`, and `/api/version` serves it so open screens can notice a new build. Today every asset is served with `Cache-Control: no-cache` plus an ETag (aiohttp's `FileResponse`), i.e. always revalidated, answered `304` when unchanged: **that already ends the Clear cache + Reload dance**, but it is not "long cache lifetimes".

Not implemented, on purpose: renaming files to `name.<hash>.ext`. HK's modules reference each other by absolute `/hk/...` paths and by paths assembled at run time (`import(url)`, `<script src>` injection in `hk-home.js`/`hk-layout.js`/`hk-loader`, the `shared-assets.json` mapping, `/hk/fonts/sf-pro.css`), so a blind rewrite of ~64 MB of source would break loading. The safe design: (1) the build writes `static-manifest.json` (done); (2) the server rewrites `index`-like entry points (`home.html`) at serve time to load `/_/<build>/web/home.js`; (3) all assets are served under `/_/<build>/...` with `Cache-Control: public, max-age=31536000, immutable`, and `/hk/...` / `/web/...` unversioned paths 307 to the current build prefix; (4) `home.html` and `/api/version` stay `no-store`. Step 3 needs the front end to build module URLs relative to `import.meta.url` (they use absolute paths now) or an import map; that is front-end work in `web/hk`, outside this slice.

## Open gaps found (for the orchestrator / later slices)

1. **`/healthz` needs the sign-in exemption.** `health.register` adds its two paths to `auth.PUBLIC_PATHS` (a module-level set) because I may not edit `auth.py`. P3.1's session middleware must keep them public. `server.py` does not call `health.register` yet (P3.7 wiring); the full-app test calls it explicitly.
2. **HA App is a scaffold.** Ingress serves the App under `/api/hassio_ingress/<token>/`; Mantel's pages use absolute `/hk/...` and `/web/...` URLs, which break under a prefix. And the signed-in user arrives as `X-Remote-User-*` headers from `172.30.32.2`; Mantel Server accepts none yet (P3.1's trusted-proxy rule; `mantel_connect/` already has the signed-channel logic for the sidebar page). The App starts and goes healthy; sign-in through Ingress does not work yet. *(Update 2026-10-18: done — Ingress identity, the `ha` door, the prefix and the Supervisor connection: `docs/phase3/HA-APP.md`.)*
3. **"Your files" and fixtures.** `Config.hk_files` defaults to `<repo>/spikes/...`, which is not in the image, so SF Pro/glyphs are absent in a container until the "Your files" upload lands (PLAN §4: they move to `/data`). There is no CLI option for it yet (not touched: outside the listen-address brief).
4. **Mixed content** for Music Assistant iframe and go2rtc websockets on https (above).
5. **Door header and Access JWT** are stamped by Caddy but unused by the server.
6. **Python dependency hashes.** The build supports `packaging/docker/requirements.lock` (`--require-hashes`); generate it with `pip-compile --generate-hashes` on a machine with network; without it the build installs pyproject's ranges. No Trivy/SBOM/cosign/GHCR CI exists yet.
7. **Proxmox firewall egress allow-list** (PLAN §7) is documented, not scripted.
8. `tools/headless/client_smoke.py` uses fixed Chrome DevTools port 9337 and collides when two slices run it at once (it failed twice for that reason here, and passes on a private port). Not changed.

## What needs Docker, and the exact commands (Avery, on a machine with Docker; the LXC itself is fine)

```bash
cd <checkout>
python3 tools/package_check.py                               # already passes

# 0. pin the base images (replace the sha256:000... values in packaging/docker/Dockerfile and caddy.Dockerfile)
docker buildx imagetools inspect python:3.12-slim-trixie --format '{{.Manifest.Digest}}'
docker buildx imagetools inspect debian:trixie-slim      --format '{{.Manifest.Digest}}'
docker buildx imagetools inspect alexxit/go2rtc:1.9.9    --format '{{.Manifest.Digest}}'   # confirm the tag exists
docker buildx imagetools inspect caddy:2.10 ; docker buildx imagetools inspect caddy:2.10-builder
python3 tools/package_check.py --release                     # must now be clean

# 1. build all four images (look for: no errors; go2rtc binary at /usr/local/bin/go2rtc in its image)
docker build -f packaging/docker/Dockerfile --target server    --build-arg VCS_REF=$(git rev-parse --short HEAD) -t mantel-server:local .
docker build -f packaging/docker/Dockerfile --target app       -t mantel-server-app:local .
docker build -f packaging/docker/Dockerfile --target transcode -t mantel-transcode:local .
docker build -f packaging/docker/caddy.Dockerfile -t mantel-caddy:local packaging/docker
docker run --rm --entrypoint id mantel-server:local            # expect uid=10001
docker run --rm --entrypoint cat mantel-server:local /app/BUILD_ID

# 2. the server image under the production restrictions, with a fictional token file (no real HA)
umask 077; printf 'fictional' > /tmp/mantel_fake_token; chmod 0444 /tmp/mantel_fake_token
docker run -d --name mantel-smoke --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  -v mantel-smoke-data:/data -v /tmp/mantel_fake_token:/run/secrets/ha_token:ro \
  -e MANTEL_HA_URL=http://127.0.0.1:1 -e MANTEL_PUBLIC_URL=https://mantel.example.com/ mantel-server:local
sleep 25; docker inspect --format '{{.State.Health.Status}}' mantel-smoke       # expect: healthy (HA is unreachable by design)
docker exec mantel-smoke python -m mantel_server.health; echo $?                 # expect 0
docker exec mantel-smoke python -c "import urllib.request as u;print(u.urlopen('http://127.0.0.1:8765/healthz').read())"   # status degraded, no secrets
docker logs mantel-smoke | head                                                   # expect the login URL line, no traceback
docker rm -f mantel-smoke; docker volume rm mantel-smoke-data; rm /tmp/mantel_fake_token

# 3. the transcode image and QuickSync (on a host with /dev/dri; RGID = getent group render | cut -d: -f3)
docker run --rm --device /dev/dri --group-add $RGID --entrypoint vainfo mantel-transcode:local   # expect MPEG2 decode, H264 encode
docker run --rm --entrypoint go2rtc mantel-transcode:local -version               # confirms the binary path/flag

# 4. the stack
cd packaging/compose && cp .env.example .env     # edit hostname, LAN IP, HA URL; create secret files per secrets/README.md
docker compose config -q                          # must print nothing; then:
docker compose up -d --wait && docker compose ps  # all healthy
curl -sk --resolve mantel.example.com:443:127.0.0.1 -D- https://mantel.example.com/healthz -o /dev/null   # expect 404 (hidden outside)
curl -sk --resolve mantel.example.com:443:127.0.0.1 -D- https://mantel.example.com/api/version            # CSP/HSTS headers + build id
docker compose exec mantel-server id; docker compose exec mantel-server touch /app/x   # uid 10001; must fail (read-only)
./update.sh                                       # then break the image tag in .env and confirm it rolls back
# open https://<hostname>/ in Chrome with DevTools: confirm no CSP violations except style-src noise you accept
```

Unverified-in-this-slice assumptions that step 1-4 will confirm: the go2rtc binary path and `-version` flag, go2rtc reading `${MANTEL_LAN_IP}` in its YAML, `cloudflared tunnel run --token-file`, Compose treating unused declared secret files (empty placeholders) as fine, a non-profiled cloudflared secret not being required, Caddy's `{file./run/secrets/...}` placeholder tolerating the file's content, and Caddy's two `:8080` sites with different `bind` addresses (the adapter output was inspected and is as intended).

## What needs Proxmox (Avery, on proxmox1)

```bash
# read first; then, from a checkout of this branch copied to the Proxmox host, as root:
less packaging/lxc/mantel.sh packaging/lxc/mantel-install.sh
bash -n packaging/lxc/mantel.sh
bash packaging/lxc/mantel.sh        # asks for storage/bridge/VLAN and confirms before creating anything
# expect: container created UNPRIVILEGED (pct config <id> | grep unprivileged), dev0 -> /dev/dri/renderD128,
#         features nesting=1,keyctl=1; the install ends with "Installed. Mantel is NOT running yet."
pct enter <id>
  docker info | head -3 ; ls -l /dev/dri ; docker compose version   # Docker works inside the unprivileged LXC; the Debian compose package name may need a tweak in mantel-install.sh
  mantel-secret ha_token                                             # paste the dedicated user's token
  cd /opt/mantel/packaging/compose && docker compose up -d --wait
  mantel-update                                                      # exercises the update path
```

The Docker-in-unprivileged-LXC risk from proof 4 (AppArmor/runc on some Proxmox versions) still applies; so does the egress allow-list on the container's Proxmox firewall interface.

## Exact continuation point

1. Avery pins the base-image digests and runs the Docker steps above; fix whatever the first real build finds (most likely: go2rtc binary path/flag, the cloudflared flag, Debian's compose package name in `mantel-install.sh`).
2. Orchestrator (P3.7): call `health.register(app, hub)` from `server.py`; make P3.1's session middleware keep `/healthz` and `/api/version` public; read `X-Mantel-Door` and the Access JWT for the tunnel door rules.
3. Front end: move the 301 inline `style=` attributes and `<style>` elements to adopted sheets, add a Report-Only strict-style policy, then enforce; build module URLs relative to the build prefix to unlock hashed, immutable assets (design above).
4. ~~HA App: Ingress identity headers from `172.30.32.2` mapped to a Mantel user, and prefix-relative URLs.~~ Done: `docs/phase3/HA-APP.md`.
5. TLS for Music Assistant and go2rtc (via Caddy) so the media iframe and talk-back sockets work on https.
6. CI: GHCR publish, Trivy + SBOM + cosign, Renovate for the digests, `requirements.lock` with hashes.
