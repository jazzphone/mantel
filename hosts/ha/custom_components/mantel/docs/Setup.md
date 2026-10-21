# Setup

Mantel Link connects to one Mantel. There are three ways in; all end with the same link.

## Discovered from the Mantel App (Home Assistant OS and Supervised)

When the Mantel App starts, it tells Home Assistant where it is, with a credential made for Mantel Link.

1. Settings → Devices & Services. Under **Discovered**, **Mantel** → **Add**.
2. Confirm. Done: Mantel Link is linked.

Each time the App starts it makes a new credential and announces it again; a Mantel Link set up this way follows it by
itself. The credential is listed in Mantel Settings → Service Accounts as "Home Assistant - App discovery".

## Discovered on the network (Mantel in Docker or the LXC)

Mantel announces itself on the home network (`_mantel._tcp`) with its https address, but no credential: you confirm
with a pairing code.

1. In Mantel: Mantel Settings → Connections → **Mantel in Home Assistant** → **Make a Pairing Code**. It works once, for ten
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
- **Pairing code**: from Mantel Settings, as above. Or **a Service credential**: Mantel Settings → Service Accounts →
  Add, with the `linked` endpoint.

The address and credential are tested before they are saved. To change them later: Mantel Link → ⋮ → Reconfigure (an
empty credential keeps the saved one).

## One Mantel

Home Assistant links to one Mantel. A second one is refused; to move to another, remove Mantel Link and add it again.

## Diagnostics

Mantel Link → ⋮ → Download diagnostics: whether it is linked, to which Mantel, what it mirrors and what HK Frontend is
doing, never the credential.
