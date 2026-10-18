# Mantel

Mantel serves HK's home screens from its own server, inside Home Assistant. Open **Mantel** in the
sidebar: Home Assistant signs you in, and Mantel shows you what your Mantel role allows.

## First start: becoming the Owner

1. Start the App and open **Mantel** from the sidebar (or **Open Web UI**).
2. Mantel has no Owner yet. If your Home Assistant account is an **administrator**, Mantel offers
   **Make me Mantel's Owner**. Press it to confirm. Only the first Owner is made this way; afterwards
   the page says it is closed.
3. As the Owner, open `People` (the link on the confirmation page, or the address
   `.../ingress/people` inside the sidebar page) and link the rest of the household's Home Assistant
   accounts to Mantel roles (Admin, Adult, Child, Guest). An account that is not linked sees only
   "Not linked yet" and nothing else.

## Options

| Option | Default | Meaning |
|---|---|---|
| `commands_enabled` | `false` | Read-only until you turn this on. When on, people may control the house through Mantel within their roles; locks and alarms need a step-up (PIN or code) and every command is audited. |
| `log_level` | `info` | `debug`, `info`, `warning` or `error`. |
| `default_screen` | `dashboard-kitchen` | The HK dashboard the sidebar opens. |
| `ha_door_rules` | `trusted` | `trusted`: being signed in to Home Assistant is enough, as HK in Home Assistant always was. Cameras, locks and the alarm work in the sidebar and the Companion app without a Mantel code; each person's Mantel role still decides what they may do, and everything is audited. `lan`: the home network's rules (a code for locks and the alarm). `tunnel`: Mantel's remote-access rules (each role's remote switches, a recent code for live cameras and sensitive actions). |

## Who can open it

The panel starts as administrators-only (`panel_admin: true`), because the first Owner must be a Home
Assistant administrator. Once the household is linked, you may make the panel visible to everyone;
Mantel's own roles still decide what each person can see and do, and unlinked accounts get nothing.

## Security notes

* Mantel believes who you are only from Home Assistant's Ingress proxy (the Supervisor). Requests from
  anywhere else are refused; the App publishes no port.
* Mantel reaches Home Assistant with the App's own built-in credential; you create no token.
* Turn on Home Assistant's two-step verification for every household account: through the sidebar,
  Home Assistant's login is what proves who you are.

## Backups and removal

Mantel keeps its data (people, roles, settings, the audit log) in the App's `/data`, which Home
Assistant's backups include. Uninstalling the App removes it; nothing else in Home Assistant changes.
