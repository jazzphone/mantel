# syntax=docker/dockerfile:1.7
#
# Mantel Server image (PLAN §7 "Container and host", §8). One Dockerfile, three build targets:
#
#   server     (default, last stage)  Mantel Server for Docker and the LXC: Python, the web app, no
#                                      ffmpeg, no devices, runs as uid 10001.
#   app                                the same layers for the Home Assistant App (starts as root only to
#                                      chown /data, then drops to 10001; see packaging/ha-app).
#   transcode                          go2rtc + ffmpeg + Intel's iHD VA driver for QuickSync Live TV.
#
# Build from the REPOSITORY ROOT (the context is the whole repo, trimmed by /.dockerignore):
#
#   docker build -f packaging/docker/Dockerfile --target server    -t mantel-server:local .
#   docker build -f packaging/docker/Dockerfile --target app       -t mantel-server-app:local .
#   docker build -f packaging/docker/Dockerfile --target transcode -t mantel-transcode:local .
#
# WHY TWO IMAGES. The transcode image is the only thing that gets /dev/dri and a media toolchain
# (ffmpeg, a non-free driver, go2rtc). Mantel Server itself carries none of that, so the process that
# faces the network and holds the HA token has no GPU access and a much smaller attack surface.
# Mantel Server starts and stops per-channel streams through go2rtc's HTTP API on the internal
# network; ffmpeg runs inside go2rtc, in the transcode container. PLAN §8 says "the image carries
# intel-media-va-driver-non-free": that is the transcode image, built from this same file.
#
# PINNING. Every FROM below is pinned by digest. The all-zero digests are PLACEHOLDERS that make a
# build fail loudly until you pin them (tools/package_check.py --release refuses them too):
#
#   docker buildx imagetools inspect python:3.12-slim-trixie --format '{{.Manifest.Digest}}'
#
# Paste the sha256:... into the ARG default (or pass --build-arg PYTHON_IMAGE=python:3.12-slim-trixie@sha256:...).
# Renovate/Dependabot keeps the digests current (PLAN §7). For Python dependencies, generate
# packaging/docker/requirements.lock with hashes (pip-compile --generate-hashes) and the build
# installs from it with --require-hashes; without it the build installs pyproject's ranges.
#
# NO SECRETS ARE BAKED IN OR PASSED AS ENV. Tokens are files mounted at /run/secrets/ at run time.

ARG PYTHON_IMAGE=python:3.12-slim-trixie@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
ARG DEBIAN_IMAGE=debian:trixie-slim@sha256:a29215f6a35e51e22adffa17f89e9d2ef06214e64a2bad10d765c46aea49f11f
ARG GO2RTC_IMAGE=alexxit/go2rtc:1.9.9@sha256:7d31dcb73633310e80497c431f4534c81ed55ec0708db3262bc56918e654bba5


# ---- static: the web app, stamped with a build id --------------------------------------------------
FROM ${PYTHON_IMAGE} AS static
WORKDIR /src
COPY tools/build_static.py tools/build_static.py
COPY web web
RUN python tools/build_static.py /out


# ---- deps: a virtualenv holding only the third-party dependencies -------------------------------
FROM ${PYTHON_IMAGE} AS deps
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
COPY pyproject.toml /tmp/pyproject.toml
COPY packaging/docker/requirements.loc[k] /tmp/
RUN python -m venv /opt/venv \
 && if [ -f /tmp/requirements.lock ]; then \
        /opt/venv/bin/pip install --require-hashes -r /tmp/requirements.lock; \
    else \
        python -c "import tomllib; print('\n'.join(tomllib.load(open('/tmp/pyproject.toml','rb'))['project']['dependencies']))" > /tmp/requirements.txt \
     && /opt/venv/bin/pip install -r /tmp/requirements.txt; \
    fi


# ---- transcode: go2rtc + ffmpeg + QuickSync (VAAPI), for Live TV ----------------------------------
FROM ${GO2RTC_IMAGE} AS go2rtc-bin

FROM ${DEBIAN_IMAGE} AS transcode
# Intel's iHD driver is in Debian's non-free component (the same recipe as packaging/lxc/proof4).
RUN sed -i -E '/^Components:/{/non-free/!s/$/ non-free non-free-firmware/}' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg intel-media-va-driver-non-free vainfo ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
# The official go2rtc image keeps its binary here (verify after bumping GO2RTC_IMAGE).
COPY --from=go2rtc-bin /usr/local/bin/go2rtc /usr/local/bin/go2rtc
# uid/gid 10002; the render group's gid is the host's, so compose adds it with group_add (not baked in).
RUN groupadd --system --gid 10002 go2rtc \
 && useradd --system --uid 10002 --gid 10002 --no-create-home --shell /usr/sbin/nologin go2rtc \
 && install -d -o 10002 -g 10002 /config
USER 10002:10002
EXPOSE 1984 8555
# go2rtc's API answers GET /api when it is up (the API listens on the internal network only).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:1984/api"]
ENTRYPOINT ["go2rtc"]
CMD ["-config", "/config/go2rtc.yaml"]


# ---- base: everything Mantel Server needs; the app and server targets below only choose the user -----
FROM ${PYTHON_IMAGE} AS base
ARG VCS_REF=unknown
LABEL org.opencontainers.image.title="Mantel Server" \
      org.opencontainers.image.source="https://github.com/jazzphone/mantel" \
      org.opencontainers.image.revision="${VCS_REF}"
# PYTHONDONTWRITEBYTECODE: the root filesystem is read-only at run time (compose read_only: true).
# PYTHONPATH: the source tree keeps the repo's layout under /app because mantel_server finds the web
# app relative to its own location (config.REPO), which a site-packages install would break.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/hosts/server:/app \
    PATH=/opt/venv/bin:$PATH
RUN groupadd --system --gid 10001 mantel \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin mantel \
 && install -d -o 10001 -g 10001 -m 0750 /data
COPY --from=deps /opt/venv /opt/venv
# --chmod: the source tree may come from a share where every file is owner-only (SMB on the NAS);
# the image's non-root user must be able to read it.
COPY --chmod=0755 hosts/server/mantel_server /app/hosts/server/mantel_server
COPY --chmod=0755 hosts/server/mantel_connect /app/hosts/server/mantel_connect
COPY --chmod=0755 hk_core /app/hk_core
COPY --chmod=0755 --from=static /out/web /app/web
COPY --chmod=0755 --from=static /out/BUILD_ID /app/BUILD_ID
COPY --chmod=0755 --from=static /out/static-manifest.json /app/static-manifest.json
COPY --chmod=0755 packaging/docker/entrypoint.py /app/entrypoint.py
WORKDIR /app
EXPOSE 8765
ENTRYPOINT ["python", "/app/entrypoint.py"]


# ---- app: the same layers for the Home Assistant App (packaging/ha-app) -------------------------------
# Supervisor mounts the App's /data root-owned and cannot set a user, so this one target starts as root.
# entrypoint.py chowns /data and the token file, then drops to uid 10001 BEFORE it execs the server;
# the server never runs as root. Everything else is byte-for-byte the server target.
FROM base AS app
USER root
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-m", "mantel_server.health", "--port", "8099"]


# ---- server: Mantel Server for Docker and the LXC (the DEFAULT target: keep it last) -----------------
FROM base AS server
USER 10001:10001
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-m", "mantel_server.health", "--port", "8765"]
