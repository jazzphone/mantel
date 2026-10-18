# Mantel Connect

Mantel Connect puts a **Mantel Server that runs outside Home Assistant** (Docker, a Proxmox container) in
Home Assistant's sidebar and the Companion app. Open **Mantel** in the sidebar: Home Assistant signs you
in, and Mantel shows you what your Mantel role allows.

Do not install this if you run the **Mantel** App: that one needs no Connect.

## Pair it once (about two minutes)

1. **In Mantel**, start pairing. Either open Mantel's admin page, **Connect**, **Start pairing**, or run
   `mantel connect pair` on the server (`docker compose exec mantel-server mantel connect pair`). You get a
   one-time code that works for ten minutes, and the address to use.
2. **Here**, open **Configuration** (Home Assistant administrators only). Enter **Mantel address** (for
   example `mantel.lan:8766`) and **Pairing code**, press **Save**, then **Restart** the App.
3. Open **Mantel** in the sidebar. If this is a new Mantel, it offers to make the first Home Assistant
   administrator the Owner; the Owner then links the rest of the household (`.../ingress/people`).

The two sides exchange keys and pin each other's certificates on the spot, over TLS, using the code to
prove who they are. Nothing is copied by hand. After pairing you may clear the code.

If it does not work, the sidebar page says why: wrong, used or expired code (start a new pairing), Mantel
not reachable (is port 8766 open from Home Assistant?), or "disconnected" (Mantel revoked this pairing).
`/__mantel_connect/status` inside the sidebar page shows the connection test.

## Revoking and re-pairing

Revoke the pairing in Mantel's admin page (**Connect**) or with `mantel connect revoke --id ...`. It takes
effect at once and open connections are closed. To connect again, start a new pairing and enter the new
code here. The App renews its certificate by itself (every 90 days, 30 days ahead).

## Options

| Option | Meaning |
|---|---|
| `mantel_address` | Mantel's Connect address, `host` or `host:port` (default port 8766). It may be changed later without pairing again. |
| `pairing_code` | The one-time code. Used once; a code that already failed is not retried on restart. |
| `log_level` | `debug`, `info`, `warning` or `error`. |

## Security notes

* The App talks to exactly one address, over mutual TLS: it trusts only the certificate authority Mantel
  gave it at pairing, and Mantel accepts only the certificate it issued to this pairing.
* Mantel believes who you are only from a paired Connect App (the same rule as the Supervisor in the Mantel
  App): the person is the Home Assistant account that is signed in, mapped to a Mantel role by an Owner.
  Anything else carrying those headers is ignored.
* The key, certificate and CA are files in this App's own storage (mode 0600). Nothing secret is in the
  environment, a log or a status page. The pairing code sits in this App's configuration until you clear it;
  it is single-use and expires.
* Turn on Home Assistant's two-step verification for every household account: through the sidebar, Home
  Assistant's login is what proves who you are.
