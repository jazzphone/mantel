# Diagnostics

What to send with a bug report, and how.

## Download diagnostics

Diagnostics are a file with HK Frontend’s configuration, for a bug report.

**Settings** → **Devices & services** → **HK Frontend** → **⋮** on an entry → **Download diagnostics**.

Each entry has its own:

| Entry | What the file holds |
|---|---|
| **HK Frontend** | Every setting as stored, what each screen is handed (the settings with every default filled in), and where the font and glyphs are served from — `folder:` (your files folder), `bundled:`, or `null` when missing. |
| **Music** | The speakers, presets and playlists, and what each screen is handed. |
| **Alarm PIN** | The alarm it protects and whether arming needs the PIN. |
| **Live TV** | The channels and the picture quality. |
| **Clean Areas** | Which vacuums take part and which areas the picker offers. |

**Left out:** the Alarm PIN’s hash and salt (the PIN itself is never stored), and the birthdays you entered for the sky.

**Not left out:** entity IDs, area and dashboard names, and the users you chose for wall tablets. Read the file before you attach it to a public issue, and edit out anything you don’t want to share.

## Reporting a problem

Open an issue at [github.com/jazzphone/hk-frontend/issues](https://github.com/jazzphone/hk-frontend/issues). The bug report form asks for:

- **What happened**, and **what you expected**.
- **Where**: which screen, page or setting. A screenshot helps.
- **Versions**: HK Frontend (HACS shows it), Home Assistant, and the browser or tablet app.
- **Diagnostics**, attached (see above).

For a card or page that misbehaves, also open the browser’s developer console on that screen and copy any errors shown in red. Run Setup Check first and mention anything under *Needs Doing*.
