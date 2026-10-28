# Setup

Mantel Link connects to one Mantel. There are three ways in; all end with the same link.

Install Mantel first: the Mantel App on Home Assistant OS or Supervised, or Mantel with Docker or in a Proxmox LXC
([Install](https://github.com/jazzphone/mantel/wiki/Install) in Mantel's guide). Mantel Link has no screens of its
own and does nothing without it.

## Discovered from the Mantel App (Home Assistant OS and Supervised)

When the Mantel App ([Install the Home Assistant App](https://github.com/jazzphone/mantel/wiki/Install#install-the-home-assistant-app)) starts, it tells Home Assistant where it is, with a credential made for Mantel Link.

1. Settings → Devices & Services. Under **Discovered**, **Mantel** → **Add**.
2. Confirm. Done: Mantel Link is linked.

Each time the App starts it makes a new credential and announces it again; a Mantel Link set up this way follows it by
itself. The credential is listed in Mantel Settings → Service Accounts as "Mantel Link - App discovery": it is Mantel Link's own, so leave it; revoked, Mantel Link is refused until the Mantel App restarts and announces a new one. With Mantel Link set up by hand instead (a pairing code), the App announces nothing and makes no such credential.

## Discovered on the network (Mantel in Docker or the LXC)

Mantel announces itself on the home network (`_mantel._tcp`) with its https address, but no credential: you confirm
with a pairing code.

1. In Mantel: Mantel Settings → Connections → **Home Assistant** → **Mantel Link** → **Make a Pairing Code**. It works once, for ten
   minutes.
2. In Home Assistant: Settings → Devices & Services → **Discovered: Mantel** → **Add**, and enter the code.

Mantel in Docker announces itself only with the `announce` service (`compose.announce.yaml`, on the host's network,
since multicast doesn't leave Docker's networks), or through the host's own avahi
(`python -m mantel_server.announce --avahi` prints the service file). Without either, add it by hand.

## By hand

Settings → Devices & Services → **Add Integration** → **Mantel Link**:

- **Mantel's address**: its `https://` address. `http://` only for the Mantel App on the same machine
  (`http://local-mantel:8099`); any other plain address is refused, so the credential never crosses the network in
  clear.
- **Pairing code**: from Mantel Settings, as above. Or leave it empty and fill in **Or a Service credential**, from Mantel
  Settings → Service Accounts → **New Service Account…**, with `linked` ticked under **What It May Reach**, then **Create Service Account**.

The address and credential are tested before they are saved. To change them later: Mantel Link → ⋮ → Reconfigure:
**Mantel's address** and **Service credential** (empty keeps the saved one). Reconfigure takes no pairing code, and
refuses an address that is a different Mantel.

## If it is refused

- **"Mantel says that isn't its address"**: Home Assistant reached Mantel by a name Mantel doesn't know as its
  own, or something else answered for it. Enter Mantel's own address, as Mantel Settings shows it. The code isn't
  spent.
- **"That Mantel is older than Mantel Link. Update Mantel first."**: update Mantel, then make a new code.
- **"Mantel did not accept that pairing code"**: it was mistyped, used, withdrawn or older than ten minutes. Make a
  new one.
- **"Use https://"**: plain `http://` is only for the Mantel App on the same machine.
- **"Too many tries"**: wait a few minutes.

## One Mantel

Home Assistant links to one Mantel. A second one is refused; to move to another, remove Mantel Link and add it again.

## Diagnostics

Mantel Link → ⋮ → Download diagnostics: whether it is linked, to which Mantel, what it mirrors and what HK Frontend is
doing, never the credential.
