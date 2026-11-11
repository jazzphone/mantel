# Releasing

A release is a tag. Pushing a tag starts nothing: [`.github/workflows/release.yml`](../../.github/workflows/release.yml)
runs only by hand, and the checks run on the developer's Mac ([Building and testing](Building-and-Testing.md#local-checks)).
The workflow has three stages (`stage`):

- **`all`** (the default) is the whole release from the tag `vX.Y.Z`, with `publish` on: the images, then `latest`
  and Home Assistant's add-on repository. It is the by-hand release and the build-only dry run.
- **`images`** is the first half, from a branch whose commit is already on `main`, before the tag exists: the
  guards, the checks, the Linux suite and the images tagged `X.Y.Z` only.
- **`promote`** is the second half, from the tag, after an images run: it moves `latest` and publishes the
  add-on repository, and builds nothing.

[`tools/release_house.py`](../../tools/release_house.py) runs `images`, the house and `promote` in one command, in
the order that makes a tag mean "the house runs it, healthy, and the Linux suite passed". This page says what a
release contains, how to make one, how to try the workflow without publishing anything, what a failure at each
step leaves, and the one-time steps the repository's owner has to do after the first release.

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
`## X.Y.Z` section; the release workflow runs it that way (`stage=all` and `stage=promote`) and stops before
building anything if either is wrong. `--staged` checks the section without a tag, for the images stage, which runs
before the tag exists.

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
images), then `latest` once the Linux suite and every image passed, and only then the `ha-apps` branch. Home
Assistant offers **Update** as soon as that branch's `version` goes up, so it must never name an image that isn't
there yet.

The Linux suite runs beside the image builds, on 4 workers (`pytest -n 4`), not in front of them; `latest` and
`ha-apps` wait for it. The arm64 Docker images are built natively on `ubuntu-24.04-arm` runners, pushed by digest
and merged with the amd64 ones into one manifest (`docker buildx imagetools create`); nothing is emulated except
the two aarch64 App images, which are small and still use QEMU.

**The one rule about what is published before a tag:** an images run may push `X.Y.Z` image tags from a commit
that is already on `main` while its tag doesn't exist. Nothing else is published before the tag: `latest` and
`ha-apps` need `stage=all` or `stage=promote`, both from the tag. The images stage refuses a version whose tag
exists on origin and a commit that is not on `main`.

## Make a release

Before either way: the changes are on `main`, `tools/ci.py full` passed on them, and `CHANGELOG.md`'s
`## Unreleased` section holds the release notes, read as a Home Assistant user will see them in the update
dialog: what changed, and anything they must do. If `pyproject.toml`'s dependencies changed, or to take newer
versions of them, regenerate the image's hashed lock first and commit it (`tools/package_check.py --release`
refuses a dependency it doesn't pin), on Python 3.12 as the image uses:

```bash
pip install pip-tools
pip-compile --generate-hashes --strip-extras --no-emit-index-url --allow-unsafe \
  -o packaging/docker/requirements.lock pyproject.toml
```

### The one command (the house first)

```bash
~/.venvs/mantel/bin/python tools/release_house.py mantel 0.1.121             # notes: CHANGELOG.md's Unreleased
~/.venvs/mantel/bin/python tools/release_house.py mantel 0.1.121 --dry-run   # every check, nothing sent
```

This is the Proxmox LXC's release: Mantel is put on the house first, and only a version the house runs healthy is
tagged and published. It needs no Home Assistant admin token. The steps, in order:

0. **Preflight.** `HEAD` is `origin/main` (on `main`, or detached in a clean worktree at `origin/main` with
   `--from-origin`, which runs `npm ci --prefix tools` there if `node_modules` isn't its own); nothing uncommitted;
   not behind; a passed whole `tools/ci.py full` run speaks for `HEAD` (below); the tag is free here and on origin;
   `gh auth status`; the private words are set; and the LXC answers over SSH and has no hand changes (a read-only
   `git status` of `/opt/mantel`). Hand changes refuse the release and are listed; with
   `--save-and-revert-hand-changes` the tool saves them on the LXC as `/root/mantel-hand-changes-<time>.patch` and
   reverts them.
1. **Bump.** `bump_version.py --changelog` sets the version and renames `## Unreleased` to `## X.Y.Z - <today>`
   with a new empty `## Unreleased` above it (the notes *are* that section; an empty one refuses). The tool commits
   the explicit paths, runs `tools/ci.py versions` on the new commit, and pushes it to `main`.
2. **Images.** It pushes the same commit to `release/X.Y.Z` and runs `release.yml` from that branch with
   `stage=images -f publish=true`. Dispatching from the branch pins the commit even if another session pushes to
   `main` meanwhile; the tool checks the run's commit. The run's guards, checks, Linux suite and image builds
   start together.
3. (A Mantel release has no component to build here; `all` releases changed components after Mantel.)
4. **Wait for the image jobs** (not the whole run): the App images and the Docker images' merges.
5. **The house.** On the LXC, over SSH: `MANTEL_UPDATE_REF=<commit> update` (the LXC's own `update`: a backup first,
   rollback to the kept images if the new version doesn't start). Then health: all three services healthy,
   `mantel-server` built from the release commit (its `org.opencontainers.image.revision` label), and
   `/healthz?strict=1` answering 200 with Home Assistant connected. Then the log check: a `Traceback` or `ERROR` in
   Mantel's log since it started fails the release; warnings from Caddy and go2rtc are printed.
6. **The Linux suite.** It waits for the run's `suite` job (it ran beside steps 3 to 5, so it is normally done).
   If it failed, the tool reruns the failed job once (a timing flake) and stops if it fails again.
7. **Tag.** Only now: `vX.Y.Z` on the release commit, pushed.
8. **Promote.** `release.yml` from the tag with `stage=promote -f images_run=<the images run's id>`. The workflow
   checks that run built exactly this commit and succeeded, and that every Docker image has both platforms with this
   commit as its revision label, then moves `latest` and publishes the `ha-apps` branch (last, so Home Assistant is
   never offered a version whose images aren't there). Promoting again is safe.
9. **The GitHub Release** `vX.Y.Z`, whose notes are the version's `CHANGELOG.md` section. About's update check sees
   the release from here.
10. **Clean up and record.** The tool deletes `release/X.Y.Z` and appends the record to
    [`House-releases.md`](House-releases.md) (commit, runs, the house's old and new version, the time of each step),
    committed and pushed.

Other forms of the command:

- `--retry` runs an attempt again that stopped before its tag: `HEAD` already says `X.Y.Z` with its section, so
  nothing is bumped. A fix may follow the release commit (the next commit is what the house is updated to).
- `--dry-run` makes every preflight check, including the read-only look at the LXC, and sends nothing (with
  `--ha-app` it also stages the App with `stage_ha_app.py --dry-run`).
- `--ha-app` is the old flow for a home that runs Mantel as the Home Assistant App: stage the App into the local
  apps share, update `local_mantel` through the Supervisor (this one needs the admin token), tag, then
  `release.yml` with `stage=all` from the tag, and the GitHub Release. `--no-publish` (only with `--ha-app`) stops
  after the tag.
- `plan` says, per product, what changed since its last release; `all` releases every product that changed
  (`--versions mantel=0.1.121,...` names the versions); `backfill-tags` creates the component tags once.
- `hk-frontend X.Y.Z` and `mantel-link X.Y.Z` release the components ([House releases](#house-releases)).

**Settings**, in `~/.config/mantel/house.json` and never in the repository: `"lxc_ssh"` (`"root@<address>"`),
`"lxc_key"` (the SSH key file) and, for the components, `"ha_url"`. SSH runs with `BatchMode` and strict host key
checking, so the LXC's host key must be known. The tool never prints the LXC's address, the key's path or a token.

### By hand (the fallback)

Use this if the tool is broken or a step needs a person. It is the whole release from the tag with `stage=all`,
and the house is updated by hand, before the tag.

1. Set the version and name the release notes:

   ```bash
   python3 tools/bump_version.py 0.1.37 --changelog
   ```

   It rewrites the version line in the three files and renames `CHANGELOG.md`'s `## Unreleased` heading to
   `## 0.1.37 - <today>`. (By hand: edit the three files and the heading; `check_version.py` tells you what you
   missed.)
2. Check it, then commit and push:

   ```bash
   python3 tools/check_version.py --tag v0.1.37
   git commit -am "Release 0.1.37"
   git push origin main
   ```

   Run `tools/ci.py full` on that commit first; the push itself runs the pre-push hook.
3. The house comes after the run here: the images are published from the tag, and the LXC's `update` skips a version
   whose images aren't there yet. (To keep the house first by hand, run `stage=images` from a `release/X.Y.Z` branch
   first, `MANTEL_UPDATE_REF=<commit> update` on the LXC once its images are pushed, and `stage=promote` from the
   tag instead of `stage=all`: what the tool does.)
4. Tag that commit, push the tag, and run the workflow from it:

   ```bash
   git tag -a v0.1.37 -m "Mantel 0.1.37"
   git push origin v0.1.37
   gh workflow run release.yml --ref v0.1.37 -f publish=true
   ```

5. Watch **Actions** → **Release**. The version job comes first (about 40 seconds); the Linux suite and the images
   build beside each other, and `latest` and `ha-apps` wait for both. If it fails before the `ha-apps` job,
   nothing reached Home Assistant users; fix the cause and re-run the failed jobs (**Re-run failed jobs**), or, if
   the fix needs new code, release the next patch version. Never move a published tag to other code: Home
   Assistant and Docker hosts that already pulled `X.Y.Z` would never see the change.
6. Check the result: `docker buildx imagetools inspect ghcr.io/jazzphone/mantel-server:0.1.37` lists `linux/amd64`
   and `linux/arm64`; the `ha-apps` branch's `mantel/config.yaml` says `version: "0.1.37"`; and in a Home
   Assistant with the repository added, **Settings** → **Apps** → **App store** → **⋮** → **Check for updates**
   offers Mantel 0.1.37.
7. Make the GitHub Release (`gh release create v0.1.37 --notes-file notes.md --verify-tag`; `notes.md` is the
   version's `CHANGELOG.md` section) and add a new `## Unreleased` heading at the top of `CHANGELOG.md` for the next
   release's notes.

To publish again from an existing tag (for example after the one-time steps below), run the same command again.
`stage=all` refuses `publish` from a branch.

## Try it without publishing

**Actions** → **Release** → **Run workflow**, on `main`, with **publish** off, or:

```bash
gh workflow run release.yml --ref main -f publish=false                    # stage=all, the whole release
gh workflow run release.yml --ref main -f stage=images -f publish=false   # the images stage
```

Both do everything but push: the version and private-content checks, the Linux suite, the App staging and every
image for both architectures. The `stage=all` dry run also writes the add-on repository and keeps it as the run's
`ha-apps-X.Y.Z` artifact so you can read exactly what would be published. The `stage=images` dry run skips the
tag and `main` guards (it publishes nothing for them to protect) and, having no `ha-apps` job, writes no
repository. Either takes `CHANGELOG.md`'s `Unreleased` section when the version has none yet. Nothing goes to
ghcr.io and the `ha-apps` branch is not touched. `stage=promote` has no dry run: it builds nothing, and it needs
the tag and `publish`.

Locally, without Docker, the same tools run on their own:

```bash
python3 tools/check_version.py
python3 tools/stage_ha_app.py --dry-run
python3 tools/publish_ha_apps.py /tmp/ha-apps --version "$(python3 tools/check_version.py --print)" --allow-unreleased
```

## House releases

A house runs Mantel on the Proxmox LXC. Since 2026-11-02 the LXC is the house: the Home Assistant App is stopped
there on purpose. HK Frontend and Mantel Link are components copied into Home Assistant's `config` share, without
waiting for a public release. [`tools/release_house.py`](../../tools/release_house.py) does each release and
records it in [`House-releases.md`](House-releases.md):

```bash
~/.venvs/mantel/bin/python tools/release_house.py mantel 0.1.121
~/.venvs/mantel/bin/python tools/release_house.py hk-frontend 1.41.0
~/.venvs/mantel/bin/python tools/release_house.py mantel-link 0.1.13
~/.venvs/mantel/bin/python tools/release_house.py mantel 0.1.121 --dry-run     # every check, nothing changed
```

**Every house release ends with the wall tablets refreshed** (2026-11-09, the owner: "everytime a new release gets pushed to
the house... clear cache and reloads the tablets"): each Kiosk Satellite tablet (a Home Assistant device of that maker) has its
Clear cache button pressed, then, a few seconds later, its Reload page button, so no tablet keeps the old cards. The tablets
are found by maker, so a new one needs no list. A refresh that fails is said in the release's lines, never fails the release.
`--no-kiosk-refresh` skips it; `release_house.py refresh-kiosks` does it alone.

- **Before anything:** `main` (or `--from-origin`), nothing uncommitted, not behind `origin/main`, and a passed
  whole `tools/ci.py full` run that speaks for HEAD (`tools/ci.py` keeps them by tree; Building-and-Testing.md,
  "Local checks"): one of HEAD itself, or of a commit HEAD differs from only in version lines (`bump_version.py`'s
  three files, the two components' `manifest.json`) and changelogs (`CHANGELOG.md`, the components'
  `tools/publish/root/CHANGELOG.md`, `House-releases.md`). In the second case `tools/ci.py versions`, everything
  that reads those files, must pass on HEAD first: seconds, not a second full run. A whole run of HEAD's tree that
  failed refuses the release until it passes again, and a step rerun with `--only` is never a whole run.
- **That full run is short when the browser code didn't change.** A browser check or HK Frontend suite whose inputs
  are as they were when it passed is **unchanged**: not run again, counted as its pass (Building-and-Testing.md,
  "Local checks"). So for a release of a few commits to Python outside the server, shell, packaging, docs or tests,
  `tools/ci.py full` is the main suite and the release checks, about two minutes; a change to `web/`, `hk_core/` or
  `hosts/server/mantel_server/` runs the browser checks again (about five and a half minutes on a quiet machine).
  `tools/ci.py full --plan` says beforehand which steps will run; `--all` runs every step. HK Frontend's
  publisher takes an unchanged suite as run (`--no-tests`).
- **Mantel** is the numbered procedure above. The LXC's `update` follows the newest `v[0-9]*` tag, or the target
  named for one update: `MANTEL_UPDATE_REF=<commit or tag> update` updates once to that commit or tag and leaves no
  pin behind (`git config mantel.ref` pins until it is set back to `latest`). A hand change in `/opt/mantel` (a
  hotfix, say) can make `update` fail or be lost, so revert it before a release; the tool refuses until you do, or
  saves it as a patch with `--save-and-revert-hand-changes`.
- **A hotfix on the house** (only with the owner's OK; no tag, no GitHub release): `packaging/lxc/mantel-hotfix.sh`
  builds mantel-server inside the LXC from a commit of main, tags it `<that commit's version>-main.<sha9>` (never
  pushed: `release.yml` tags images by version alone), pins `.env` to it and recreates; the next release's `update`
  rewrites the pin. Every way out prunes Docker's build cache (phase 25: hotfixes had left 19.5 GB of it on the LXC).

  ```bash
  scp -i ~/.ssh/mantel_lxc packaging/lxc/mantel-hotfix.sh root@<lxc>:/root/
  ssh -i ~/.ssh/mantel_lxc root@<lxc> /root/mantel-hotfix.sh <full sha> </dev/null
  ```

  (`</dev/null`: `docker compose` reads stdin.) Then reload the kiosks (`tools/release_house.py refresh-kiosks`).
- **Every Mantel house release is tagged, and a tag means two things:** the house runs that commit healthy, and the
  Linux suite passed on it. An untagged release never reaches the LXC installs, because `update` follows the
  newest tag. Released by hand, tag the release commit once the house runs it healthy and the workflow's suite
  passed, and push only the tag:

  ```bash
  git tag -a v0.1.110 -m "Mantel 0.1.110" <release commit>
  git push origin refs/tags/v0.1.110
  ```

  **Never move or reuse a tag**; a fix is the next version. The images stage refuses a version whose tag exists. HK
  Frontend and Mantel Link keep their own tags in their public repositories (`--github-release`) and in this
  one: `hk-frontend/vX.Y.Z`, `mantel-link/vX.Y.Z` (these don't match the LXC's `v[0-9]*`, so `update` ignores them).
- **Every Mantel house release is published too**: the Home Assistant App repository, the Docker images and the
  Proxmox LXC get what the house got. The one command does it (`stage=promote` and the GitHub Release). By hand,
  that is `stage=all` from the tag, as in "By hand (the fallback)" above.
- **HK Frontend and Mantel Link** set the manifest version and name the component's own changelog section
  (`tools/publish/root/CHANGELOG.md`'s Unreleased), commit, run `tools/ci.py versions`, push, build the component
  (HK Frontend with `tools/build_ha.py`, Mantel Link with its `publish.py`, whose layout vendors the `hk_core`
  modules it imports), and copy it with `rsync -rt --inplace` (Home Assistant's Samba share half-fails without
  `--inplace`; never `--delete`). They check the copy with `diff -rq`, restart Home Assistant and wait until the new
  files are served, and tag the commit `hk-frontend/vX.Y.Z` or `mantel-link/vX.Y.Z`. HK Frontend is then published
  to `jazzphone/hk-frontend`'s `main` from a fresh clone, and its Wiki is pushed when `publish.py` committed to
  it. A publisher runs its suites in what it builds unless the full run already ran them (`hk-frontend-py` and
  `hk-frontend-js` for HK Frontend; the main suite, whose `test_mantel_link.py` builds Mantel Link's published
  layout and runs its suite there, and `hk-frontend-py`, which says Home Assistant's test venv was there, for
  Mantel Link): then it gets `--no-tests`. `--dry-run` says which. **The components still need the admin token**
  (the Home Assistant restart), which Mantel's own release no longer does.
- **What it needs:** the private words (`~/.config/mantel/private-words`) for the staging scans; the LXC's SSH
  settings (`lxc_ssh`, `lxc_key`) in `~/.config/mantel/house.json`; `gh` signed in; and, for the components and
  `--ha-app`, Home Assistant's address (`ha_url` in the same file, or `$MANTEL_HA_URL`) and a long-lived token of a
  Home Assistant administrator, in the macOS Keychain or in a file only you can read. The script never prints the
  token. Add it to the Keychain, pasting it at the hidden prompt:

  ```bash
  security add-generic-password -a "$USER" -s mantel-ha-admin -w
  ```

  or to `~/.config/mantel/ha_admin_token` with mode `600`.

### What a failure leaves

| Step | A failure leaves |
|---|---|
| 0. Preflight | nothing |
| 1. Bump, commit, `versions`, push | the release commit on `main`, untagged; `--retry` of the same version is allowed |
| 2. Branch and images run | the `release/X.Y.Z` branch; image tags `X.Y.Z` in ghcr.io, untagged in git |
| 4. Image jobs | a failed image job stops here; the house was not touched |
| 5. House update, health, log check | if `update` itself finds the new version unhealthy, it rolls back to the kept images; if the tool's own health or log check fails after a healthy `update`, the LXC stays on the untagged commit and the tool says how to go back (`MANTEL_UPDATE_REF=<old commit> update`, if the database allows). Either way: no tag, no Release, `latest` and `ha-apps` untouched |
| 6. Linux suite (rerun once) | the house runs the new version; no tag. The tool says why; the fix is the next commit and `--retry`, and the house is updated to it the same way |
| 7. Tag | a tag |
| 8. Promote | a tag, the images, the house; no `latest`, no `ha-apps`. Running promote again is safe (the command is in the tool's message); then the Release and the record by hand. The branch is deleted either way |
| 9. GitHub Release | a promoted version without a Release; run `gh release create`, then add the record by hand |
| 10. Branch delete, record | nothing important |

If the new version doesn't start and the old one can't either (a database the old version refuses, `schema_too_new`),
the tool prints the restore command `update` prints and stops: that needs a person.

### What a release takes

Measured on 2026-11-01 on the 18-core Mac, from a clean checkout on the SMB share (other sessions' work
running beside it; minutes vary with the load):

| Part | Before | Now |
|---|---|---|
| `tools/ci.py full` on the release commit | ~7 minutes that day; 258 s here, sorted (the longest step 245 s: the Side Pane's check; then the screensaver Shows', 206 s; 9 steps at once) | 191 s at 14 steps at once, 238 s at 9 (the longest step 184 s; the Shows' in four parts of 45-64 s, the Side Pane's in three) |
| ...2026-11-02, after every Look under every slide joined the Shows' check | 630 s (four Shows parts of ~510 s each, started late on old times) | `full --all` 313-326 s (the Shows in eight parts of 225-290 s, then twelve of 157-202 s, which ci.py chose from those times; Swipe Between Pages a step per size; step times shared by worktrees; the run waits on 14 steps at a time, not on its longest step); `full` after commits outside the browser checks' inputs: 94 s, every browser check and HK Frontend suite unchanged |
| After the version bump and notes | a second full run (another 4-7 minutes) | `tools/ci.py versions`, 27 s, once per release commit |
| The pre-push hook, each push of a tree that passed | `quick`, 79 s alone (about 90 s beside other work) | the commit messages' private words, 5 s |
| HK Frontend's publisher | 108 s (its two suites in the built repository) | 9 s with `--no-tests` |
| Mantel Link's publisher | 14 s | under a second with `--no-tests` |

The release workflow, measured on 2026-11-03 (build-only runs from a branch, publish off):

| Part | Before | Now |
|---|---|---|
| The Linux suite | 6.7 min, in front of the builds | 3.2 min on 4 workers, beside the builds |
| `mantel-server`, both architectures | 4.4 min after the suite, arm64 under QEMU | amd64 2.6 min and arm64 2.3 min, native, in parallel, merged by digest |
| `mantel-caddy` (its cache cold) | not measured | amd64 3.75 min |
| The App images | not measured | 1 to 1.8 min |
| `ha-apps` after the images | 0.2 min | 1 min |
| **The workflow, wall time** | **11.4 min** (run 41643065587) | **5.5 min**, cold caches (build-only `stage=all`, run 41724515055; version job 40 s) |
| **The whole house-first release**, `release_house.py mantel` after `ci.py full` | ~25 to 30 minutes by an assistant's hand work | **8.5 min** (0.1.123, 2026-11-04: images 4.4 min, the house 2.5 min, promote 1.4 min); HK Frontend after it 3.6 min |
| **The house update** (`update`, health, log check) | ~3 minutes by hand | **2.5 min** (0.1.122 -> 0.1.123, the Intercom's new port included) |

The 2026-11-01 release of all three products took about 30 minutes, half of it checks run again: two full runs
(~7 minutes each that day), `quick` on each of three pushes, and HK Frontend's publisher twice (a flaky test, since
fixed). Done the same way today, the checks are one full run (3-4 minutes), a `versions` run per release commit
(~30 s each, a few for three products), and nothing on pushes of trees that passed: about 5 minutes, not 15.

The tool prints the time of each step and the record in `House-releases.md` keeps them, so the next estimate
comes from measured numbers. What it saves is the hand work around the waits (the bump, the notes, the commands, watching
the run, the update, the tag and the record), and the details a hand release has to remember (Mantel Link copied
from its built layout, never its folder; `rsync --inplace`, never `--delete`).

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
