# syntax=docker/dockerfile:1.7
#
# Caddy with DNS-challenge plugins, so the LAN-only hostname gets a real certificate (ACME DNS-01) and
# no inbound port 80/443 ever has to be reachable from the internet (PLAN §7 "TLS everywhere via Caddy").
# The stock caddy image has no DNS providers; this builds a short, pinned list in with xcaddy.
#
# The DNS providers built in (packaging/compose/caddy/tls-dns01-<provider>.caddy; .env.example lists them),
# each pinned to a version checked to build with the pinned Caddy (2.10.2 in the builder below) and libdns 1.x:
#   cloudflare v0.2.4, duckdns v0.5.0, porkbun v0.3.1, route53 v1.6.2, desec v1.1.0, and digitalocean,
#   which tags no releases: the pseudo-version of its main branch's commit 04bde28 (June 2025, Caddy 2.10).
# Raise one only after `caddy build-info` in the new image shows Caddy still at 2.10.x (a module whose go.mod
# needs a newer Caddy would silently upgrade it). Another DNS host: add its github.com/caddy-dns module here,
# pinned, with a snippet beside the others. A home with no domain does not need this image's providers at
# all: tls-internal.caddy works with it (or the stock caddy image; see packaging/compose/README.md).
#
#   docker build -f packaging/docker/caddy.Dockerfile -t mantel-caddy:local packaging/docker
#
# Pin both FROMs by digest (the all-zero values are placeholders; see the note in ./Dockerfile):
#   docker buildx imagetools inspect caddy:2.10-builder --format '{{.Manifest.Digest}}'
ARG CADDY_BUILDER_IMAGE=caddy:2.10-builder@sha256:01668408cc26e2e00c9d067c30cb43b2ba14ad1f2808beda55503cb2a31f59dc
ARG CADDY_IMAGE=caddy:2.10@sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb

FROM ${CADDY_BUILDER_IMAGE} AS builder
RUN xcaddy build \
    --with github.com/caddy-dns/cloudflare@v0.2.4 \
    --with github.com/caddy-dns/duckdns@v0.5.0 \
    --with github.com/caddy-dns/porkbun@v0.3.1 \
    --with github.com/caddy-dns/route53@v1.6.2 \
    --with github.com/caddy-dns/digitalocean@v0.0.0-20250606074528-04bde2867106 \
    --with github.com/caddy-dns/desec@v1.1.0

FROM ${CADDY_IMAGE}
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
# Caddy needs to write only /data (certificates) and /config (autosave); compose mounts both as volumes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/ready"]
