# Changelog

## 0.1.166

**Changed**
- **The old module paths are gone**, as 0.1.165 said: code that imports a moved module by its place before the packages (`mantel_server.accounts`) imports it at its new one (`mantel_server.identity.accounts`). `mantel_server.connect_proof` is the one still answered, until 0.1.167: Mantel Connect's receiver proof moved into `network/` (its setup script starts `python -m mantel_server.network.connect_proof`; a receiver staged before this release keeps working until it is staged again).
- **HK's three biggest settings files in parts** (phase 25): the HK Settings module (`window.hkSettings`), the settings page's screen pages and the Music Library card, each shipped with its parts in one file as the others are. Nothing they do changes.
