# Mantel as a LOCAL Home Assistant App. The Supervisor builds this file with the App folder as the build
# context; tools/stage_ha_app.py assembles that folder (this file, config.yaml, requirements.txt and
# app/: Mantel Server, the web app stamped with its build id, hk_core, the entrypoint).
#
# A plain Python base (as the Mantel Connect proof App used live): Mantel needs no S6 or bashio. The
# container starts as root only so entrypoint.py can hand /data (mounted root-owned by the Supervisor)
# and the token file to uid 10001; it then drops root for good BEFORE the server starts.
# Pinned by digest (the multi-arch index: amd64 and aarch64); refresh with
# `docker buildx imagetools inspect python:3.12-slim-bookworm`.
FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app/hosts/server:/app \
    PATH=/opt/venv/bin:$PATH

# Exact versions, the ones the tests ran with (packaging/ha-app/requirements.txt).
COPY requirements.txt /tmp/requirements.txt
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install -r /tmp/requirements.txt \
 && rm /tmp/requirements.txt

RUN groupadd --system --gid 10001 mantel \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin mantel

COPY app /app
WORKDIR /app

# entrypoint.py: SUPERVISOR_TOKEN -> /tmp/ha_token (0600, out of the environment), options.json -> flags
# (--ingress --ingress-only, commands only if the option is true), drop to 10001, exec the server on :8099.
CMD ["python", "/app/entrypoint.py"]
