# packaging/lxc/

`mantel.sh`: Proxmox LXC installer in the community-scripts layout (unprivileged, `var_gpu=yes`,
Debian 13, Docker + the compose stack from `packaging/compose/`). PLAN §7, §8.
`mantel-install.sh` is its in-container half (Docker, secret folder, `.env`, `mantel-secret`,
`mantel-update`, unattended security upgrades). `proof4/` is the Phase 0 QuickSync proof it grew from.

**Read the scripts before running them as root on the Proxmox host.**

```bash
bash packaging/lxc/mantel.sh              # on the Proxmox host, as root, from a checkout you have read
pct enter <id>                            # then: mantel-secret ha_token ; cd /opt/mantel/packaging/compose && docker compose up -d --wait
mantel-update                             # inside: update with automatic rollback (registry images)
bash packaging/lxc/mantel.sh push <id>    # on the host: send a newer checkout and update (build mode)
```

Why it does not source community-scripts' `build.func`, and the exact steps to verify it on proxmox1:
`docs/phase3/PACKAGING.md`.
