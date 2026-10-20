# Changelog

All notable changes to Mantel are listed here. Versions follow [semantic versioning](https://semver.org); the Home Assistant App, the Docker images and the Python package share one version number.

## Unreleased

The first public release.

- **Mantel Server**: serves HK Frontend's screens without Lovelace, from your Home Assistant's rooms and devices.
- **People and roles**: Mantel accounts with passwords, passkeys and authenticator codes, or sign-in with Home Assistant; Owner, Admin, Adult, Child and Guest roles, with grants per room and feature.
- **Wall tablets**: a browser enrolled as a tablet keeps its own credential and role, whoever is signed in.
- **Commands and audit**: commands are off until the operator turns them on; each one is checked against the person's and the device's role and written to the audit log before it is sent.
- **Music Assistant and cameras** through Mantel, **Mantel Photos** for the screensaver, and **backups**.
- **Mantel Link**: the Home Assistant integration that links Home Assistant to Mantel.
- **Three ways to run it**: the Home Assistant App, Docker Compose, or a Proxmox LXC.
