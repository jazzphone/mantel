# packaging/lxc/

`mantel.sh`: Proxmox LXC installer in the community-scripts layout (unprivileged, `var_gpu=yes`,
Debian 13, Docker + the compose stack from `packaging/compose/`). PLAN §7, §8.
`mantel-install.sh` is its in-container half (Docker, secret folder, `.env`, `mantel-secret`,
`mantel-update`, unattended security upgrades; this version's published images, else a build). The HTTPS
choice is asked at a terminal (Caddy's own CA, your domain through one of six DNS hosts, or your own proxy) and
is Caddy's own CA without one.

The same install in community-scripts' layout, one curl command with their menus: [`packaging/proxmox`](../proxmox/README.md).

**Read the scripts before running them as root on the Proxmox host.**

```bash
bash packaging/lxc/mantel.sh              # on the Proxmox host, as root, from a checkout you have read
pct enter <id>                            # then: cd /opt/mantel/packaging/compose && docker compose up -d --wait
                                          # docker compose logs mantel-server: the first Owner's setup code
                                          # browser: /login "First start" (that code), then Mantel Settings -> Connections
mantel-update                             # inside: update with automatic rollback (registry images)
mantel-setup                              # inside: how browsers reach Mantel (try, a name, your domain, your proxy)
bash packaging/lxc/mantel.sh push <id>    # on the host: send a newer checkout and update (a build, or that
                                          # version's published images)
bash packaging/lxc/mantel.sh restore <id> <backup.mbk> [<mantel-keys.json>]
                                          # on the host: restore a backup into it, another Mantel's (the HA App's)
                                          # with its keys file (packaging/compose/restore.sh inside)
var_restore=<backup.mbk> var_restore_keys=<mantel-keys.json> bash packaging/lxc/mantel.sh
                                          # create, and restore that backup before Mantel first starts
```

The step-by-step guide (inputs, GPU, HTTPS, Connections, Connect, backups, removal) is
[Install on Proxmox](../../docs/guide/Install-Proxmox-LXC.md).

Why it does not source community-scripts' `build.func`, and the exact steps to verify it on proxmox1:
`docs/phase3/PACKAGING.md`.
