# packaging/proxmox/

Mantel's Proxmox LXC script in [community-scripts](https://github.com/community-scripts/ProxmoxVE)' layout:
`ct/mantel.sh` runs on the Proxmox host, `install/mantel-install.sh` inside the new container. They run on
community-scripts' own engine ([community-scripts/core](https://github.com/community-scripts/core): the menus,
creating the container, `update`), which finds the install script here: from a clone, next to `ct/`; fetched with
curl, through `COMMUNITY_SCRIPTS_URL`, which `ct/mantel.sh` sets to this folder on GitHub.

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/jazzphone/mantel/main/packaging/proxmox/ct/mantel.sh)"
update        # inside the container: the newest release tag (or main), with a backup and automatic rollback
mantel-setup  # inside the container: how browsers reach Mantel (its address, a name, your domain's certificate, your proxy)
```

The install clones the repository into `/opt/mantel` and runs the same in-container installer as
`packaging/lxc/mantel.sh` (`packaging/lxc/mantel-install.sh`); `update` runs that script's `update`. The guide,
with every `var_mantel_*` setting: [Install on Proxmox](../../docs/guide/Install-Proxmox-LXC.md#one-command).
