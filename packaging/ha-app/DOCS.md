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
| `commands_enabled` | `false` | Read-only until you turn this on. When on, people may control the house through Mantel within their roles; only the alarm needs a code (the house Alarm PIN, set in HK Settings) and every command is audited. |
| `log_level` | `info` | `debug`, `info`, `warning` or `error`. |
| `default_screen` | `dashboard-kitchen` | The HK dashboard the sidebar opens. |
| `access` | `ingress` | How else Mantel can be reached: `ingress` (the sidebar only), `proxy` (your own reverse proxy) or `https` (Mantel's built-in HTTPS). See **Direct access** below. |
| `public_url`, `trusted_proxies`, `ha_sign_in_url`, `cloudflare_token`, `acme_email`, `acme_staging` | empty | Direct access only (below). |
| `ha_door_rules` | `trusted` | `trusted`: being signed in to Home Assistant is enough, as HK in Home Assistant always was. Cameras, locks and the alarm work in the sidebar and the Companion app without a Mantel code; each person's Mantel role still decides what they may do, and everything is audited. `lan`: the home network's rules (a code for locks and the alarm). `tunnel`: Mantel's remote-access rules (each role's remote switches, a recent code for live cameras and sensitive actions). |

## Who can open it

Every Home Assistant user can open the panel (`panel_admin: false`): wall tablets and most household
members are not administrators. Mantel decides what anyone gets: an account that is not linked sees only
"Not linked yet", each linked person gets their Mantel role, and only a Home Assistant administrator
(checked with Home Assistant itself) can become the first Owner.

## Wall tablets

Each wall tablet is its own Home Assistant user, signed in by `trusted_networks` in its kiosk browser
(Kiosk Satellite). To move one to Mantel:

1. As the Owner, open `People` and press **Link as a wall tablet** on the tablet's Home Assistant user:
   choose *a new device* and the tablet's room. (Needs `ha_door_rules` `trusted` or `lan`.)
2. In Kiosk Satellite set the start URL to the App's panel on Home Assistant's address, for example
   `http://homeassistant.local:8123/app/local_mantel` (`/app/<this App's slug>`; the same scheme and host as the
   tablet uses today). Nothing else changes on the tablet.

The tablet opens on its own HK screen, full screen (Mantel asks Home Assistant to hide its sidebar and
header for tablets only). Nobody is signed in on it: it may do what its role allows (its room, the
doorbell), with no PIN; only the alarm asks for a code, the house Alarm PIN.
To go back, set the start URL back to the tablet's Home Assistant dashboard.

## Direct access (optional)

The sidebar is always there. Some homes also want Mantel at **its own address**, for example
`https://mantel.example.com`: wall tablets open `https://mantel.example.com/home` without Home Assistant's
frame, and every screen has a direct link (`https://mantel.example.com/<screen>/home`). Most homes need
neither; leave `access` at `ingress` and nothing below applies.

At Mantel's own address Home Assistant's sidebar sign-in does not apply. People use **Sign in with Home
Assistant** (set `ha_sign_in_url`), or a Mantel password or passkey; wall tablets are **enrolled** as Mantel
devices (on the tablet, sign in once at Mantel's address as the Owner, open Mantel settings, *Make this
browser a wall tablet*, with its room; the person's sign-in ends there) and then open `/home` on their own
HK screen. Home addresses get the LAN rules; anything else the
remote (tunnel) rules. HA's identity headers are never believed on this port.

Pick **one** of the two ways:

### `proxy`: your own reverse proxy (Nginx Proxy Manager, Traefik, ...)

Your proxy owns HTTPS and forwards to the App over plain HTTP.

1. App **Configuration**: `access: proxy`, `public_url: https://mantel.example.com` (the name people
   type), `trusted_proxies`: your proxy's IP address as Mantel sees it, `ha_sign_in_url` (optional) your
   Home Assistant address as browsers know it, e.g. `http://homeassistant.local:8123`.
2. App **Network**: give `8100/tcp` a host port, e.g. `8100`. (Leave it empty if your proxy is itself a
   Home Assistant App: it can reach `http://local-mantel:8100` on Home Assistant's internal network.)
3. **Restart** the App, open Mantel in the sidebar as the Owner: **Mantel settings → Connections → HTTPS
   and your proxy**, *Rotate door key*, and copy the **door key** (shown once; *Test my proxy* there also
   shows the block below with the key filled in). The proxy sends it with every request; without it Mantel
   treats the proxy's requests as remote.
4. In Nginx Proxy Manager add a **Proxy Host**: domain `mantel.example.com`, scheme `http`, forward
   host = your Home Assistant machine's address, port = the host port from step 2, **Websockets Support
   on**, Block Common Exploits on. SSL tab: a certificate for the name, Force SSL, HTTP/2 (leave HSTS off:
   Mantel sends it). Advanced tab:

   ```nginx
   location / {
       proxy_pass http://HA_MACHINE_ADDRESS:8100;
       proxy_http_version 1.1;
       proxy_set_header Host $http_host;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection $http_connection;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_set_header X-Forwarded-Host $http_host;
       proxy_set_header X-Mantel-Door lan;
       proxy_set_header X-Mantel-Door-Key MANTEL_DOOR_KEY;
       proxy_set_header X-Remote-User-Id "";
       proxy_set_header X-Remote-User-Name "";
       proxy_set_header X-Remote-User-Display-Name "";
       proxy_set_header X-Ingress-Path "";
       proxy_read_timeout 1h;
       proxy_buffering off;
       client_max_body_size 12m;
   }
   ```

   Replace `HA_MACHINE_ADDRESS` and `MANTEL_DOOR_KEY` (the key from step 3). Use `lan` only on a proxy
   host that your home network alone can reach; one the internet can reach sends `tunnel`.
5. Point the name at the proxy in your DNS (a local record is enough), then open
   `https://mantel.example.com/proxy-check` as the Owner (sign in there first). It says whether the
   request came through the trusted proxy, with the door and the key, and **which address it came
   from**: if that is not the one in `trusted_proxies` (Docker can show your proxy as Home Assistant's
   own internal bridge address), put the address it shows there and restart the App.

### `https`: Mantel's built-in HTTPS

No proxy: Mantel serves HTTPS on the App's port itself, with a free Let's Encrypt certificate that it gets
and renews by itself. The name is proved through your DNS (Cloudflare), so nothing has to be reachable
from the internet and the name can stay inside your home.

1. In Cloudflare, make an API token with **Zone / Zone / Read** and **Zone / DNS / Edit**, both for the
   zone holding the name only.
2. App **Configuration**: `access: https`, `public_url: https://mantel.example.com` (add `:port` when the
   host port below is not 443), `cloudflare_token` the token, `ha_sign_in_url` (optional), `acme_email`
   (optional). While trying it out, `acme_staging: true` gets test certificates (a browser warning) so
   mistakes do not count against Let's Encrypt's limits; turn it off afterwards.
3. App **Network**: give `8100/tcp` a host port, e.g. `443` if nothing else on the machine uses it, else
   `8443`.
4. In your DNS point the name at the Home Assistant machine (a local record is enough).
5. **Restart** the App. Its log says when the certificate is installed (until then the port serves a
   temporary self-signed one). Renewal is automatic.

Never forward this port from the internet: Mantel tells home from remote by the connecting address, and
Docker can make every visitor look like a home address. For remote use keep Home Assistant's sidebar or
the Companion app.

## Security notes

* Through the sidebar, Mantel believes who you are only from Home Assistant's Ingress proxy (the
  Supervisor). Other requests to the sidebar's port are refused; the direct port (only with `access`
  `proxy` or `https`) never accepts Home Assistant's identity headers and uses Mantel's own sign-in.
* Mantel reaches Home Assistant with the App's own built-in credential; you create no token.
* Turn on Home Assistant's two-step verification for every household account: through the sidebar,
  Home Assistant's login is what proves who you are.

## Backups and removal

Mantel keeps its data (people, roles, settings, the audit log) in the App's `/data`, which Home
Assistant's backups include. Uninstalling the App removes it; nothing else in Home Assistant changes.
