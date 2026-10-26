# Releasing

A release is a tag. Running [`.github/workflows/release.yml`](../../.github/workflows/release.yml) by hand from
the tag `vX.Y.Z`, with `publish` on, publishes the images and Home Assistant's add-on repository; nothing is
published any other way. Pushing a tag starts nothing: the workflows run only by hand, and the checks run on the
developer's Mac ([Building and testing](Building-and-Testing.md#local-checks)). This page says
what a release contains, how to make one, how to try the workflow without publishing anything, and the one-time
steps the repository's owner has to do after the first release.

## One version number

The Home Assistant App, the Mantel Connect App, the Python package and every published image share **one**
version, `X.Y.Z`. The source of truth is `version:` in [`packaging/ha-app/config.yaml`](../../packaging/ha-app/config.yaml):
it is the number Home Assistant compares to offer **Update**. Two more files carry the same value:

| File | Line |
|---|---|
| `packaging/ha-app/config.yaml` | `version: "X.Y.Z"` (the source) |
| `packaging/connect-app/config.yaml` | `version: "X.Y.Z"` |
| `pyproject.toml` | `version = "X.Y.Z"` |

`python tools/check_version.py` checks that they agree (`tools/ci.py` runs it before every push). With
`--tag vX.Y.Z` it also checks that the tag is exactly `v` plus that version and that `CHANGELOG.md` has a
`## X.Y.Z` section; the release workflow runs it that way and stops before building anything if either is wrong.

## What a release publishes

| What | Where | For |
|---|---|---|
| The Mantel App's image, one per architecture | `ghcr.io/jazzphone/mantel-app-amd64:X.Y.Z`, `ghcr.io/jazzphone/mantel-app-aarch64:X.Y.Z` | Home Assistant (the Supervisor pulls the one for its machine) |
| The Mantel Connect App's image, likewise | `ghcr.io/jazzphone/mantel-connect-app-amd64:X.Y.Z`, `...-aarch64:X.Y.Z` | Home Assistant, beside a Mantel that runs elsewhere |
| Mantel Server (multi-arch: amd64, arm64) | `ghcr.io/jazzphone/mantel-server:X.Y.Z` and `:latest` | Docker Compose and the LXC (`MANTEL_SERVER_IMAGE`) |
| The Live TV transcode | `ghcr.io/jazzphone/mantel-transcode:X.Y.Z` and `:latest` | `MANTEL_TRANSCODE_IMAGE` |
| Caddy with the pinned DNS modules (Cloudflare, Duck DNS, Porkbun, Route 53, DigitalOcean, deSEC) | `ghcr.io/jazzphone/mantel-caddy:X.Y.Z` and `:latest` | `MANTEL_CADDY_IMAGE` |
| The add-on repository | the `ha-apps` branch of this repository, one commit, replaced each release | Home Assistant users, who add `https://github.com/jazzphone/mantel#ha-apps` |

The App images are built from exactly the folder `tools/stage_ha_app.py` (and `tools/stage_connect_app.py`)
writes, the one a home that builds the App from source gets, so both ways run the same code. The add-on
repository is written by `tools/publish_ha_apps.py`: `repository.yaml` and one folder per App with its
`config.yaml` (the packaging one plus `image: ghcr.io/jazzphone/mantel-app-{arch}`; the Supervisor fills in
`{arch}` and pulls the tag that equals `version`), `DOCS.md`, `README.md`, the icon, the translations and a
`CHANGELOG.md` that is this version's section of [`CHANGELOG.md`](../../CHANGELOG.md), which Home Assistant shows
in its update dialog. It holds no Dockerfile and no code. `packaging/ha-app/config.yaml` itself keeps having no
`image:` key, so the [build-from-source App](../guide/Install.md#build-the-app-from-source) is unchanged.

Every step runs the same private-content scans as the stagers (secret-shaped text, private addresses, fonts,
fixtures; `HK_PRIVATE`, a repository secret, adds the owner's own words) and stops on any finding, as
[Rules](Rules.md) 4 to 6 require. The only credential the workflow uses is its own `GITHUB_TOKEN`.

The workflow's order matters: images first (both App images for both architectures, then the three Docker
images), and only when all of them are pushed, the `ha-apps` branch. Home Assistant offers **Update** as soon
as that branch's `version` goes up, so it must never name an image that isn't there yet.

## Make a release

1. Start from a `main` whose Tests run is green. If `pyproject.toml`'s dependencies changed, or to take newer
   versions of them, regenerate the image's hashed lock first (`tools/package_check.py --release` refuses a
   dependency it doesn't pin), on Python 3.12 as the image uses:

   ```bash
   pip install pip-tools
   pip-compile --generate-hashes --strip-extras --no-emit-index-url --allow-unsafe \
     -o packaging/docker/requirements.lock pyproject.toml
   ```

2. Set the version and name the release notes:

   ```bash
   python3 tools/bump_version.py 0.1.37 --changelog
   ```

   It rewrites the version line in the three files and renames `CHANGELOG.md`'s `## Unreleased` heading to
   `## 0.1.37 - <today>`. (By hand: edit the three files and the heading; `check_version.py` tells you what you
   missed.) Read the section as a Home Assistant user will see it in the update dialog: what changed, and
   anything they must do.
3. Check it, then commit and push:

   ```bash
   python3 tools/check_version.py --tag v0.1.37
   git commit -am "Release 0.1.37"
   git push origin main
   ```

   Run `tools/ci.py full` on that commit first; the push itself runs `quick` (the pre-push hook).
4. Tag that commit, push the tag, and run the workflow from it:

   ```bash
   git tag -a v0.1.37 -m "Mantel 0.1.37"
   git push origin v0.1.37
   gh workflow run release.yml --ref v0.1.37 -f publish=true
   ```

5. Watch **Actions** → **Release**. The first job checks the version and runs the main suite; building the arm64
   images under emulation takes most of the time. If it fails before the `ha-apps` job, nothing reached Home
   Assistant users; fix the cause and re-run the failed jobs (**Re-run failed jobs**), or, if the fix needs new
   code, release the next patch version. Never move a published tag to other code: Home Assistant and Docker
   hosts that already pulled `X.Y.Z` would never see the change.
6. Check the result: `docker buildx imagetools inspect ghcr.io/jazzphone/mantel-server:0.1.37` lists `linux/amd64`
   and `linux/arm64`; the `ha-apps` branch's `mantel/config.yaml` says `version: "0.1.37"`; and in a Home
   Assistant with the repository added, **Settings** → **Apps** → **App store** → **⋮** → **Check for updates**
   offers Mantel 0.1.37.
7. Add a new `## Unreleased` heading at the top of `CHANGELOG.md` for the next release's notes.

To publish again from an existing tag (for example after the one-time steps below), run the same command again.
The workflow refuses `publish` from a branch.

## Try it without publishing

**Actions** → **Release** → **Run workflow**, on `main`, with **publish** off, or:

```bash
gh workflow run release.yml --ref main -f publish=false
```

That dry run does everything but push: the version and private-content checks, the main suite, the App staging,
every image for both architectures, and the add-on repository, which it keeps as the run's `ha-apps-X.Y.Z`
artifact so you can read exactly what would be published. It takes `CHANGELOG.md`'s `Unreleased` section when
the version has none yet. Nothing goes to ghcr.io and the `ha-apps` branch is not touched.

Locally, without Docker, the same tools run on their own:

```bash
python3 tools/check_version.py
python3 tools/stage_ha_app.py --dry-run
python3 tools/publish_ha_apps.py /tmp/ha-apps --version "$(python3 tools/check_version.py --print)" --allow-unreleased
```

## House releases

A house runs Mantel as a **local** App (staged into Home Assistant's `local_apps` share) and HK Frontend and
Mantel Link as components copied into its `config` share, without waiting for a public release.
[`tools/release_house.py`](../../tools/release_house.py) does each one and records it in
`docs/development/House-releases.md`:

```bash
~/.venvs/mantel/bin/python tools/release_house.py mantel 0.1.77 --notes notes.md
~/.venvs/mantel/bin/python tools/release_house.py hk-frontend 1.12.0
~/.venvs/mantel/bin/python tools/release_house.py mantel-link 0.1.6
~/.venvs/mantel/bin/python tools/release_house.py mantel 0.1.77 --dry-run     # every check, nothing changed
```

- **Before anything:** the last `tools/ci.py` run must be a green `full` run of HEAD, on `main`, with nothing
  uncommitted, and `main` must not be behind `origin/main`.
- **Mantel:** it sets the version, adds `--notes` as a `## X.Y.Z - date` section below `## Unreleased` (which
  keeps the next public release's notes), commits and pushes, and stages the App with `--replace`. Then, through
  Home Assistant's websocket, it reloads the App store and updates `local_mantel`, and waits until Mantel answers
  the staged build on `/api/version` and `/healthz?strict=1` is ok. Any "Traceback" or "ERROR" in the App's log
  fails the release.
- **HK Frontend and Mantel Link:** it sets the manifest version, commits and pushes, builds HK Frontend
  (`tools/build_ha.py`), and copies the component with `rsync -rt --inplace` (Home Assistant's Samba share
  half-fails without `--inplace`; never `--delete`). It checks the copy with `diff -rq`, restarts Home Assistant
  and waits until the new files are served. HK Frontend is then published to `jazzphone/hk-frontend`'s `main` from
  a fresh clone, untagged.
- **What it needs:** the private words (`~/.config/mantel/private-words`) for the staging scans; Home Assistant's
  address in `~/.config/mantel/house.json` (`{"ha_url": "http://…:8123"}`) or `$MANTEL_HA_URL`; and a
  long-lived token of a Home Assistant administrator, in the macOS Keychain or in a file only you can read. The
  script never prints the token. Add it to the Keychain, pasting it at the hidden prompt:

  ```bash
  security add-generic-password -a "$USER" -s mantel-ha-admin -w
  ```

  or to `~/.config/mantel/ha_admin_token` with mode `600`.

## One-time steps for the owner

After the **first** release (the packages only exist once something has been pushed to them):

1. **Make the repository public.** Home Assistant's Supervisor clones the `ha-apps` branch anonymously; a
   private repository looks to it like one that doesn't exist.
2. **Make each package public.** New ghcr.io packages are private, and the Supervisor and `docker pull` don't
   sign in. On GitHub: your profile → **Packages** → each of `mantel-app-amd64`, `mantel-app-aarch64`,
   `mantel-connect-app-amd64`, `mantel-connect-app-aarch64`, `mantel-server`, `mantel-transcode` and
   `mantel-caddy` → **Package settings** → **Change visibility** → **Public**. While there, check that each is
   linked to `jazzphone/mantel` (the images' `org.opencontainers.image.source` label does that) so this
   repository's workflow keeps write access.
3. **Let the workflow push.** The workflow asks for `contents: write` and `packages: write` itself, which a
   repository's read-only default (**Settings** → **Actions** → **General** → **Workflow permissions**) doesn't
   cap; only an organization's policy could. A branch ruleset or protection rule that covers `ha-apps` must
   allow force pushes by GitHub Actions; leave `main` protected as it is: the workflow never pushes there.
4. **Check it from Home Assistant** once: add `https://github.com/jazzphone/mantel#ha-apps`, install Mantel, and
   at the next release confirm that it offers **Update**.

Until steps 1 and 2 are done, the release is published but nobody outside can install it.

## Not part of this release

The release covers Mantel Server, its two Home Assistant Apps and the Docker images. Mantel Link (its own
repository, built by `hosts/ha/custom_components/mantel/tools/publish/publish.py`), HK Frontend (HACS) and the
iPhone and Mac apps are released separately.
