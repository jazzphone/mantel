# Troubleshooting

When Mantel doesn't start, doesn't connect or doesn't let someone in, the answer is nearly always in one of three places: Mantel's **log**, the **Setup Check**, or the **audit log**. Start there, then look for your problem below.

## Where to look first

1. **The log.** In the App: the **Log** tab. With Docker or the LXC: `docker compose logs mantel-server` in `packaging/compose`. The line Mantel prints at start says its address and whether commands are on (`read-only; commands disabled` or `COMMANDS ENABLED`). Mantel never writes a token or a password to its log.
2. **Setup Check**, in **Mantel Settings** → **Overview** → **Setup Check**: Home Assistant and Music Assistant connected or not, Apple's font and glyphs, house commands, and how many screens Mantel has.
3. **The audit log** (**Mantel Settings** → **Audit Log**, for Owners and Admins): every command and every refusal, with the reason. See [Commands and Audit](Commands-and-Audit.md).
4. **Health.** `https://mantel.example.com/healthz` answers `ok`, or `degraded` when the link to Home Assistant is down. (With Docker, Caddy hides it from outside; use `docker compose ps` or `docker compose exec mantel-server python -m mantel_server.health`.)

## Starting

### The App doesn't start

Open the App's **Log** tab. A wrong option stops the App with a line that starts `mantel entrypoint:` and says what is wrong, for example:

| The log says | Do this |
|---|---|
| `direct access needs public_url` | With **Direct access** set to `proxy` or `https`, set `public_url` to Mantel's own `https://` name, not an IP address. |
| `access proxy needs trusted_proxies` | Put your proxy's IP address in `trusted_proxies`. Open `/proxy-check` to see it. |
| `access https needs cloudflare_token` | Put the Cloudflare token in `cloudflare_token`. |
| `access https through Duck DNS needs duckdns_token` | Put the token from duckdns.org's page in `duckdns_token`. |
| `dns_provider duckdns needs public_url https://<name>.duckdns.org` | With `dns_provider: duckdns`, `public_url` is your Duck DNS name. |
| `acme_email is not an email address` | Fix it, or leave it empty. |
| `WARNING trusted_proxies holds 172.30.32...` | Your proxy's address is one of Home Assistant's internal addresses, which anything can come from. Use your proxy's own address if you can. |

Fix the option, **Save**, and start the App again.

### Docker Compose refuses to start

| You see | Do this |
|---|---|
| `set MANTEL_HOSTNAME in .env` (or `MANTEL_LAN_IP`, `MANTEL_RENDER_GID`, `MANTEL_TRUSTED_PROXY`) | Set it in `packaging/compose/.env`. |
| A secret file is not found | Every secret file must exist, even empty. Create the missing ones: [Install with Docker, step 4](Install-Docker.md#4-create-the-secret-files). |
| `mantel-server` stays unhealthy, and its log says it can't read a secret | Fix the files' owner and mode: `chown root:10001 /etc/hk/secrets/* && chmod 0440 /etc/hk/secrets/*`. |
| `--wait` times out | Look at `docker compose ps` for the unhealthy service, then its log: `docker compose logs <service>`. |

### The browser warns about the certificate

- With Caddy's own certificate authority (`tls-internal.caddy`), that is expected until you trust Caddy's root certificate on each device. It is in the `caddy-data` volume, under `pki/authorities/local/root.crt`.
- With DNS-01, check `docker compose logs caddy`. Usually the `cloudflare_dns_token` file is empty, or the token can't edit that zone's DNS.
- With the App's built-in HTTPS, the port answers **certificate pending** until Let's Encrypt has issued the certificate; the App's log says when it is installed. With `acme_staging` on, browsers never trust the certificate: turn it off once the setup works.

## Connecting

### Home Assistant isn't connected

The log says `Home Assistant is not connected yet`, Setup Check says **Not connected**, and `/healthz` says `degraded`.

- **Docker or the LXC:** sign in as the Owner and open **Mantel Settings** → **Connections**. See [First Run → Connect Home Assistant](First-Run.md#connect-home-assistant).
- Check that Mantel's server can reach Home Assistant's address, for example `http://homeassistant.local:8123`. That is the address as the **server** reaches it, which may differ from the one your browser uses. Some Docker hosts can't resolve `.local` names: use Home Assistant's IP address instead.
- Check that the Home Assistant user Mantel acts as still exists and is an administrator.
- **In the App** Home Assistant is always connected through the App's own credential. If it isn't, the App's log says why.

### "Connect to Home Assistant" doesn't come back

Home Assistant's sign-in opens in **your browser**, so your browser must reach the Home Assistant address you typed. If it can't (for example, the address only works from the server's network), paste a long-lived token instead: make it in Home Assistant as Mantel's user (its profile → **Security** → **Long-lived access tokens**), paste it on the Connections page, **Test**, then **Save**.

### "This Home Assistant user is not an administrator"

Mantel works, but it can't import HK's settings or list Home Assistant's users. Make Mantel's Home Assistant user an administrator, or connect again as one that is.

### Mantel has no screens

A new Mantel starts with a generated **Home** screen, built from your rooms and devices, until HK Frontend's settings are imported. If Setup Check says **Screens: None yet** and `/home` opens Mantel Settings, the import brought in an HK Frontend with no screens (or the screens were removed). The import runs once and Mantel keeps its own copy afterwards, so a screen added in Home Assistant later doesn't come across. Add one in Mantel instead: **Add Screen**, under the list of screens in Mantel Settings. See [First Run → Bring your screens in](First-Run.md#bring-your-screens-in) and [Moving from HK Frontend](Moving-from-HK-Frontend.md).

## Signing in

### "Not linked yet"

The Home Assistant account works, but nobody has linked it to Mantel. An Owner or Admin links it on **People**. Until then that account sees nothing in Mantel. **Account disabled** means the linked person has been turned off.

### "Mantel is not set up yet" (the App)

Mantel has no Owner yet, and the person opening it isn't a Home Assistant administrator. An administrator opens **Mantel** first and selects **Make me Mantel's Owner**.

### The App says it could not ask Home Assistant

Mantel couldn't check with Home Assistant whether you are an administrator, so it makes nobody the Owner. Look in the App's log (**Settings** → **Apps** → **Mantel** → **Log**) for `could not read Home Assistant's users`, fix what it names, and reload.

If it persists, you can link the first Owner by hand from a terminal on the Home Assistant machine that can run `docker` (for example the **Advanced SSH & Web Terminal** App with protection mode off). Find your Home Assistant user id (**Settings** → **People** → **Users**, with *Advanced mode* on in your profile), then:

```bash
docker exec -u 10001 "$(docker ps -q -f name=_mantel$)" python /app/entrypoint.py link --ha-user-id <your id> --role owner --name "Sam"
```

`docker ps -f name=_mantel$` finds the App's container whichever way it was installed: its name ends in `_mantel` (Home Assistant puts a prefix for the App's repository in front). Then reload Mantel, and check the App's **Log** tab for the link.

### "Setup code is wrong, used or expired"

A setup code works once, for one hour, and a new one replaces the old one. While Mantel has no Owner it prints a fresh code in its log each time the last one expires: use the newest one in `docker compose logs mantel-server` (in the LXC, run that in `/opt/mantel/packaging/compose`). Or make one with `docker compose exec mantel-server mantel bootstrap` and use it straight away. Once an Owner exists, **First start** is gone for good.

### Away from home, a password isn't enough

On purpose. From outside your home network, Mantel asks for a passkey, or a password with the code from an authenticator app. Add one on **Mantel Settings** → **Me** while you are at home. See [Signing In](Signing-In.md).

### Adding a passkey fails

Passkeys need Mantel's **name**, never an IP address. Open Mantel at `https://mantel.example.com`, not by its address.

If the browser shows `origin_not_allowed_for_passkeys`, the name you opened isn't Mantel's own: with Docker or the LXC that is `MANTEL_HOSTNAME` ([Install with Docker → Passkeys](Install-Docker.md#passkeys)), and in the App `public_url`'s name. A passkey made before that name changed doesn't work any more: remove it and add it again. In the App, passkeys work only at Mantel's own address (direct access), not in Home Assistant's sidebar.

## Tablets and the home network

### Every wall tablet is refused, or everything counts as "remote"

Mantel decides whether a request comes from your home network (the LAN door) or from away. It believes "home" only from a proxy it trusts:

- **With Mantel's Caddy**, the stack sets this up itself. If you changed `MANTEL_TRUSTED_PROXY`, set it back: with it unset, the log warns that no request counts as the LAN door, and wall tablets are refused.
- **With your own proxy**, `MANTEL_TRUSTED_PROXY` (Docker) or `trusted_proxies` (the App) must be your proxy's address **as Mantel sees it**, and the proxy must send `X-Mantel-Door` together with the **door key**. Open `https://mantel.example.com/proxy-check` as the Owner: it shows the address it saw and what is missing.
- **With the App's built-in HTTPS**, the tablet must reach the Home Assistant machine **directly** on your network. Through the router's port forwarding it arrives from the wrong address and gets the remote rules.

Wall-tablet sign-in and enrollment work only on the LAN door (`403 lan_only` otherwise). See [Wall Tablets](Wall-Tablets.md).

### "Wall tablets are off for the sidebar" (the App)

**Coming Through Home Assistant** is set to **Away Rules**, which turns off wall tablets that come through Home Assistant's sidebar. In **Mantel Settings** → **Connections** → **Home Assistant**, choose **Trusted** (the default) or **Home Network Rules**.

### A host name is refused

Mantel answers only to its own name (`MANTEL_HOSTNAME`) and to the names in `MANTEL_ALLOW_HOSTS`. Add the other name there if tablets use it, then `docker compose up -d --wait`.

## Commands

### "Commands are disabled in Mantel (read-only)"

Working as designed: Mantel runs with house commands off, so it sends nothing to Home Assistant. Settings saves still work. To turn commands on, an Owner opens **Mantel Settings** → **General** and turns on **Allow Control of the House**; see [Install → Turn on house commands](Install.md#turn-on-house-commands). If it won't turn on, or turns itself off, the server's kill switch may be on (the App's **Read-only (kill switch)** option, or `MANTEL_READ_ONLY=1`): the house stays read-only whatever Mantel Settings says.

### A command is refused

The message and the audit row say why, for example `no_grant` (the role doesn't allow it), `explicit_deny`, or `tunnel_lan_only` (allowed at home only). See [Commands and Audit](Commands-and-Audit.md) and [People and Roles](People-and-Roles.md).

### The alarm keypad says "try again in N min"

After 5 wrong Alarm PINs in a row, that tablet or browser is locked out of the keypad for 15 minutes, even with the right PIN. It survives a restart. Wait for it to pass. **No Alarm PIN is set in Mantel yet** means nobody has set the house Alarm PIN yet: set it in **Mantel Settings** → **Security** (under **Pages**) → **Change PIN**.

## Music and Live TV

### The Music Assistant page is blank

Mantel shows Music Assistant's page through its own address (`/ma/`). Check that Music Assistant is connected (**Mantel Settings** → **Connections**) and that the person's role may control music. Two Content-Security-Policy headers, or Music Assistant's frame refused, means your own proxy adds a policy: remove it, Mantel sets its own. More in [Music and Cameras](Music-and-Cameras.md).

### Live TV says "Tuning" and never plays (Docker, LXC)

- Check go2rtc: `docker compose ps go2rtc` and `docker compose logs go2rtc`. A `503` from the tuner means every tuner is busy.
- Check that your tablets reach `MANTEL_LAN_IP` on port 8555, TCP and UDP.
- An empty channel list for one person means their role doesn't include Live TV, or they may not view the channel's camera.

## Backups

| The log or the command says | Do this |
|---|---|
| `target_missing` | The backup folder doesn't exist inside the container: mount your NAS, or check `MANTEL_BACKUP_DIR`. |
| `write_failed` | Mantel can't write there: the folder must belong to uid 10001 (`chown 10001:10001`). |
| `restore failed (wrong_key)` | The `backup.key` isn't the one this backup was made with. |
| `restore failed (wrong_at_rest_key)` | The `at_rest.key` in `/etc/hk/secrets` isn't the backup's: see [Backups](Backups.md#restore-with-docker-or-the-lxc). |
| `totp_unreadable` at sign-in | Your authenticator secret doesn't open with this Mantel's `at_rest.key` (a restore with the wrong one): restore with the right key, or an Owner removes the authenticator from your account. |

More in [Backups](Backups.md).

## Reporting a problem

Report problems on [GitHub's issue tracker](https://github.com/jazzphone/mantel/issues); a security problem privately instead, as [SECURITY.md](https://github.com/jazzphone/mantel/blob/main/SECURITY.md) says. When you report a problem, include:

- how you run Mantel (App, Docker or LXC) and its version (**Mantel Settings** → **About**),
- what you did, what you expected, and what happened,
- the lines from Mantel's log around the problem.

Check the log lines before you paste them anywhere. Mantel never logs a token, but your names and addresses may appear.

