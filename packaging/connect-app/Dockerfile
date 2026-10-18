# Mantel Connect as a LOCAL Home Assistant App. The Supervisor builds this file with the App folder as the
# build context; tools/stage_connect_app.py assembles that folder (this file, config.yaml, requirements.txt,
# translations/, icon.png and app/mantel_connect: the Connect code, nothing of Mantel Server).
#
# The same plain Python base as the Mantel App. The container starts as root only so mantel_connect can hand
# its own /data folder to uid 10001 (the Supervisor mounts /data root-owned); it drops root for good BEFORE
# it serves anything. Pinned by digest (the multi-arch index: amd64 and aarch64).
FROM python:3.12-slim-bookworm@sha256:34386ef0cb081344d7ec1c103ba398e6e9f64e9ab3a1509accc92a4e24a07258

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/app \
    PATH=/opt/venv/bin:$PATH

# Exact versions, the ones the tests ran with (packaging/connect-app/requirements.txt).
COPY requirements.txt /tmp/requirements.txt
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install -r /tmp/requirements.txt \
 && rm /tmp/requirements.txt

COPY app /app
WORKDIR /app

# python -m mantel_connect: reads /data/options.json, pairs if it was given a new code, keeps its key,
# certificate and CA as 0600 files under /data/connect, serves Ingress on :8099 (/healthz is the watchdog).
CMD ["python", "-m", "mantel_connect"]
