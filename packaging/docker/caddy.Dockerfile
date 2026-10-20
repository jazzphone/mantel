# syntax=docker/dockerfile:1.7
#
# Caddy with a DNS-challenge plugin, so the LAN-only hostname gets a real certificate (ACME DNS-01) and
# no inbound port 80/443 ever has to be reachable from the internet (PLAN §7 "TLS everywhere via Caddy").
# The stock caddy image has no DNS providers; this builds one in with xcaddy.
#
# The plugin below is for Cloudflare DNS. For another DNS host, change the
# --with line to that provider's caddy-dns module (https://github.com/caddy-dns) and the `dns` line in
# packaging/compose/caddy/tls-dns01.caddy. A home with no domain does not need this image at all: use
# tls-internal.caddy with the stock caddy image (see packaging/compose/README.md).
#
#   docker build -f packaging/docker/caddy.Dockerfile -t mantel-caddy:local packaging/docker
#
# Pin both FROMs by digest (the all-zero values are placeholders; see the note in ./Dockerfile):
#   docker buildx imagetools inspect caddy:2.10-builder --format '{{.Manifest.Digest}}'
ARG CADDY_BUILDER_IMAGE=caddy:2.10-builder@sha256:01668408cc26e2e00c9d067c30cb43b2ba14ad1f2808beda55503cb2a31f59dc
ARG CADDY_IMAGE=caddy:2.10@sha256:c3d7ee5d2b11f9dc54f947f68a734c84e9c9666c92c88a7f30b9cba5da182adb

FROM ${CADDY_BUILDER_IMAGE} AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM ${CADDY_IMAGE}
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
# Caddy needs to write only /data (certificates) and /config (autosave); compose mounts both as volumes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/ready"]
