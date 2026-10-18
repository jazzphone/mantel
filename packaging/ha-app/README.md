# packaging/ha-app/

Mantel Server packaged as a Home Assistant App (add-on): `config.yaml` (Ingress, built-in App
credential, options). It runs the **same image layers** as Docker and the LXC: the `app` build target
of `packaging/docker/Dockerfile` (it differs only in starting as root to chown `/data`, then dropping
to uid 10001 in `entrypoint.py` before the server starts). PLAN §8.

Status: **scaffold, not yet usable end to end.** The container starts and reports healthy on :8099, but
two things the Ingress mode needs are not built (details in `docs/phase3/PACKAGING.md`):

1. Identity. In this mode the signed-in HA user arrives from Ingress headers; Mantel Server does not
   accept them yet (that is the accounts slice, with the trusted-proxy rule from PLAN §7).
2. Paths. Ingress serves the App under a prefix; Mantel's pages load `/hk/...` and `/web/...` by
   absolute path, which Ingress does not rewrite.

Install for development (local App): copy this folder to HA's local `addons` share, replace `image:`
with a locally built tag (or add a `build.yaml`), refresh the store, install. Needs a running HA; this
repository's tooling never connects to one.
