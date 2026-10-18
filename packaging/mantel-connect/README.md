# Mantel Connect — Phase 0 identity proof

**Built/tested locally; live HA installation and Ingress → Owner mapping confirmed by Avery. Avery also confirmed Companion app access over cellular; the Phase 0 identity proof passed.**
Avery selected existing LXC 103 (`mantel-proof4`) for the receiver. Do not destroy it yet.

This proof adds one HA sidebar page showing the signed-in user's linked Mantel name and
role. It does not proxy the Home dashboard, state hub, WebSockets, OAuth, or any commands.
The existing Mantel prototype stays on loopback. The receiver is a separate TLS process
with a separate proof database; it needs no HA/MA token.

## Build the portable directories (on the Mac)

From `/Volumes/data/mantel`, choose new destination directories outside the repository:

```bash
python3 packaging/mantel-connect/stage.py /tmp/mantel_connect_proof
python3 packaging/mantel-connect/stage.py --receiver /tmp/mantel-receiver-proof3
```

Staging refuses existing directories. Neither directory contains secrets or personal data.
The HA App's Dockerfile needs the staged directory as its build context, not this source
packaging directory. Docker is unavailable on the development Mac; Supervisor's actual
image build is part of live validation. The pinned aiohttp version matches local tests.

## Prepare receiver in LXC 103

Find your existing Owner's HA user id on the Mac (this lists linked identities, not tokens):

```bash
~/.venvs/mantel/bin/mantel-server links
```

Transfer the staged receiver directory to Proxmox, then into LXC 103. For example,
after making a tar archive with top-level directory `mantel-receiver-proof3`:

```bash
# On the Mac; substitute the actual archive path:
scp /path/to/mantel-receiver-proof3.tar.gz root@10.0.0.27:/root/
```

```bash
# On Proxmox:
pct status 103
pct push 103 /root/mantel-receiver-proof3.tar.gz /root/mantel-receiver-proof3.tar.gz
pct exec 103 -- tar -xzf /root/mantel-receiver-proof3.tar.gz -C /root
pct enter 103
```

Inside the container:

```bash
cd /root/mantel-receiver-proof3
bash setup-receiver.sh
```

The script checks the container hostname, asks for its HA-reachable IPv4 address and your
Owner HA id, installs Python/openssl inside this test container, creates a new
`/opt/mantel-connect-proof` directory, makes a 30-day TLS certificate with that IP's SAN,
creates a channel key, and links that id as Owner in the new proof database. It refuses
to replace an existing installation. It does not change boot settings or start a service.
Keys/certificates are generated only there, never in the repo or a bundle.

Start the foreground receiver and leave this terminal open:

```bash
bash /opt/mantel-connect-proof/run.sh
```

HA must reach that container IP on TCP 8766. Setup changes no bridge, VLAN or firewall.
If its IP changes, update both the TLS certificate and backend URL.

## Install the HA App

1. Copy the staged `mantel_connect_proof` directory into HA's local apps directory (normally
   `/addons` in Terminal/SSH, or the local apps/addons Samba share). Refresh the App store,
   then install **Mantel Connect Proof** from Local apps. No HA restart is required.
2. In another Proxmox shell, pull these two files from the receiver into a private folder:

   ```bash
   umask 077
   mkdir -p /root/mantel-connect-transfer
   pct pull 103 /opt/mantel-connect-proof/channel.key /root/mantel-connect-transfer/channel.key
   pct pull 103 /opt/mantel-connect-proof/receiver.crt /root/mantel-connect-transfer/receiver.crt
   ```

3. Transfer **only `channel.key` and `receiver.crt`** to this installed App's public config
   folder, `app_configs/local_mantel_connect_proof` (older shares call the parent
   `addon_configs`). They appear inside its container as `/config/channel.key` and
   `/config/receiver.crt`, mounted read-only. Keep `receiver.key` in LXC 103.
4. Set `backend_url` to `https://<container-ip>:8766`, save, then start the App. Keep
   protection mode on. It requests no HA API, Supervisor API, host network, device access
   or exposed host port. Start on boot is off by default.
5. Open Web UI and enable Show in sidebar. The proof page should show your name and
   Mantel role **owner** without another sign-in. Open **Mantel Proof** from the Companion
   app sidebar too, including via the existing remote HA URL.

The App's public configuration directory is created during installation. Do not put the
channel key in the source/build directory, options form or chat.

## Live result and acceptance evidence still needed

Avery confirmed the installed App displays his name and role `owner`. The receiver is
running in LXC 103 at `https://192.168.2.113:8766`. Avery subsequently confirmed the Companion app page also works over cellular through
the existing HA remote connection. This completes the Phase 0 identity proof.

The finished installer must replace these manual transfers with guided pairing, automated
credential/certificate provisioning and renewal, and a persistent receiver service.


- Record HA Core/Supervisor versions and whether the App builds/starts with protection on.
- Real Ingress identity → Owner: **confirmed by Avery**.
- Confirm another linked account maps to its own role and an unlinked account is refused.
  Another identity must be linked by a local admin in the proof DB, never by the browser.
- Companion app through the existing HA remote connection over cellular: **confirmed by Avery**.
- Record results without ingress URLs, signatures, session cookies or keys.

Proof 3 is complete at architecture-proof scope; review the Phase 0 go/no-go. The
alternate-account and version checks remain useful deployment follow-up. A rendered role page does
not prove the full dashboard is compatible with Ingress paths or WebSockets.

## Authentication and local tests

Connect accepts HTTP only from Supervisor's socket address `172.30.32.2`; forwarded IP
headers cannot satisfy this check. Missing/duplicate user ids are refused. Connect strips
browser cookies/Authorization/identity claims by constructing fresh outbound headers.
It signs the user id, GET method, fixed path, timestamp and random nonce using HMAC-SHA256,
then calls the receiver over certificate-verified TLS without following redirects.
The receiver rejects modified, expired, future-skewed and replayed signatures and resolves
the current linked role on every request. An unlinked user gets no fallback role.
No browser session cookie is minted. The proof accepts no query, body or arbitrary route.

Keys are read from files on each request; replace `channel.key` on both ends to rotate.
Mismatched keys fail closed. Replay cache is bounded, in memory, and resets on receiver
restart; signatures are accepted within 30 seconds of their timestamp. Keep clocks
synchronized. Production multi-worker/distributed replay protection is later work.

```bash
~/.venvs/mantel/bin/python -m pytest tests/test_connect.py -q
```

19 local tests pass, including an actual TLS proxy→receiver round trip with simulated
Supervisor identity, Owner/Child roles, unlinked identities, spoofed headers, direct-access
denial, replay, key rotation, TLS distrust, redirect refusal, and portable bundle imports.
The full suite passes **140 tests**. Existing HA command allowlists are unchanged.

## Stop and remove the proof

Stop/uninstall the HA App and remove its proof config files. Stop the receiver with Ctrl-C.
Its code, key, certificate and proof DB are under `/opt/mantel-connect-proof` in LXC 103.
Preserve Proof 4's report/video if wanted before eventually deleting the temporary
container. There is no auto-start service to undo.

## Official references checked

- [Ingress and user headers](https://contributors.home-assistant.io/apps/guides/ingress/)
- [App configuration and directory mappings](https://contributors.home-assistant.io/apps/reference/configuration/)
- [User configuration folders](https://contributors.home-assistant.io/apps/guides/options/#configuration-files-for-users)
