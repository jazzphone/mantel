# Phase 15: faster releases (plan, 2026-11-03)

**Status: plan; nothing built.**

## The ask (the owner, 2026-11-03)

- Small changes shouldn't need a whole heavy release. Today a release is about 30 minutes of an assistant's hand
  work, and the GitHub run alone takes 11 to 15 minutes.
- Find what is slow and fix it: skipping repeated checks, building for ARM natively, one command that does the
  house, releasing only what changed.
- Keep the rules: a tag still means "the house runs it and it is healthy", nothing is force-pushed, nothing private
  is published, and Home Assistant users are never offered a version whose images aren't there.

## What I checked first (2026-11-03)

These are the findings from the brief, each read against the code or the run, not taken on trust.

- **The local checks are already tuned.** `tools/ci.py` keeps passed trees (`remember`, `passed_tree`,
  `full_run_for`), skips a browser check or HK Frontend suite whose inputs are unchanged (`PAGE_INPUTS`, `HK_INPUTS`)
  and runs the main suite on 8 xdist workers (`xdist_args`). `Releasing.md` measures `full` at 94 s when the browser
  code didn't change and 313 to 326 s with `--all`.
- **Modularizing the code would not make it faster.** A browser check reads the page and the server it runs against
  (`web/`, `hk_core/`, `hosts/server/mantel_server/`), and that is the true dependency: the page is served by the
  server. Smaller folders wouldn't narrow it. The numbers say so too: of the 98 non-merge commits from `v0.1.113` to
  `v0.1.120`, 41 touched `web/`, `hk_core/` or `tests/fixtures/` (every browser check reads these), 8 touched only the server's Python,
  and 49 touched neither. A release of several commits almost always includes a `web/` change, so the browser checks
  rerun whatever the layout. The time is in the work, not in the folders.
- **The last release run, `41643065587`** (`release.yml` from `v0.1.120`), took 11.4 minutes of wall time. Read with
  `gh run view --json jobs`:

  | Job | Time | Note |
  |---|---|---|
  | Version, checks and the main suite | 6.7 min | `pytest -q` alone is 6.2 min, **serial** (`pytest-xdist` is in the `dev` extra and installed, but the step passes no `-n`). It re-runs what `ci.py full` passed on the Mac |
  | Docker image mantel-server | 4.4 min | starts only after the suite; builds `linux/amd64,linux/arm64`, arm64 under QEMU on `ubuntu-latest` |
  | mantel-transcode, mantel-caddy, four App images | 0.4 to 1.1 min each | in parallel; the aarch64 App images use QEMU too but are short |
  | Add-on repository (`ha-apps`) | 0.2 min | last, by design |

  The six runs before it took 11.9 to 15.4 minutes. Of the 14 release runs on record, the Linux suite job failed
  once (`v0.1.111`: esbuild missing from the workflow, a workflow bug, not a test the Mac missed), and an image
  build failed once (a dry run on 2026-10-21: the Dockerfile copied a path that wasn't in the build context, which
  only the image build can find). So the Linux suite has never caught a code problem the Mac run missed, and the
  image build has caught a packaging problem the Mac can't. That is a small sample, so the plan keeps the Linux
  suite as a gate but takes it off the critical path (decision 3), and builds the images before the house and
  the tag (decision 1).
- **The repository is public** (`gh repo view jazzphone/mantel --json visibility`: `PUBLIC`), so GitHub's free
  ARM runner label `ubuntu-24.04-arm` is available. **Unverified:** that the label runs here; the first build-only
  run proves it (slice 15.2).
- **`tools/release_house.py mantel` still targets the Home Assistant App** (`stage_ha_app.py --replace`, the Supervisor
  through `House.supervisor`, `update_app`, which needs the HA admin token). The house moved to the Proxmox LXC on
  2026-11-02 and the App is stopped on purpose, so the tool can't do the house's release; an assistant does the LXC
  `update` by hand over SSH.
- **How the LXC updates** (read in `packaging/proxmox/ct/mantel.sh` `update_script`, `packaging/lxc/mantel.sh`
  `update_script` and `follow_source_version`, `packaging/compose/update.sh`):
  1. `update` (community-scripts' command, which runs `ct/mantel.sh`) does `git fetch --tags` in `/opt/mantel`.
  2. The target is `mantel_target "$ref"`: `ref` is `git config mantel.ref` (default `latest`), and `latest` is the
     newest `v[0-9]*` tag. A branch, a tag or a commit can be named instead.
  3. `mantel_unpublished_image` refuses (and changes nothing) if `.env` pins images whose `:X.Y.Z` isn't in ghcr.io yet.
  4. It checks out the target and runs `packaging/lxc/mantel.sh update`, which rewrites the image pins to the
     source's version (`follow_source_version`), runs `update.sh` (keeps `mantel-rollback/*:previous`, pulls, makes a
     backup, `docker compose up -d --wait`, rolls back to the kept images on failure), and puts `.env` back if it
     fails.
  5. On failure the checkout goes back to the old commit.

  The house is in registry mode (its pins are `ghcr.io/jazzphone/mantel-*:X.Y.Z`). Build mode (the source pushed by
  `mantel.sh push <ctid>` and built in the container) would work too, but it builds on the 4-core LXC and drifts from
  what other users run, so this plan doesn't use it (decision 1).
- **The tension, found in the code.** The rule "a tag means on the house and healthy" and `latest` meaning "the newest
  tag" can't both hold when the house updates from published images, because the images are published *from the
  tag* (`release.yml` publishes only from a tag). In practice every release since 0.1.111 went tag, publish (11 to 15
  minutes), then the house: the tag came first. Also, `GET /repos/.../releases/latest`, which About's update check
  reads, moves only when the GitHub Release is made, which is after everything else.
- **Tablets reloading is not a cost.** Open screens poll `/api/version` and reload themselves at a quiet moment
  (`hosts/server/mantel_server/health.py`), so a release doesn't wait on them.

## The answer, in short

One command, `tools/release_house.py mantel`, puts Mantel on the house (the LXC) and publishes it, and a release that
changes only one product touches only that product. Three changes make the time:

1. **The run gets short.** The Linux suite runs on 4 workers (`-n 4`), beside the image builds instead of in front of
   them, and the arm64 images build on GitHub's native ARM runners and are merged into one manifest. Estimate:
   11.4 minutes becomes about 4.
2. **A new order that keeps the rule.** `release.yml` gets a `stage` input. `stage=images` (from a branch whose commit
   is already on `main`, before any tag) builds and pushes the images tagged `X.Y.Z` only. The house updates to that
   exact commit and image. Only then does the tool tag, run `stage=promote` (move `:latest`, push the `ha-apps`
   branch) and make the GitHub Release. A release that fails on the house leaves no tag, no Release, no
   `latest` and no `ha-apps` change: the version isn't burned.
3. **One command and no hand work.** SSH to the LXC (no Home Assistant admin token), the bump and notes from the
   changelogs' `## Unreleased`, the health check, the log check, the record. Home Assistant is restarted only when
   HK Frontend or Mantel Link changed.

Estimate for a Mantel-only fix: about 8 to 9 minutes after `ci.py full`, with about 1 minute of a person's attention,
against 25 to 30 minutes of an assistant's hand work today.

## What it doesn't do

- **Skip the Linux suite.** It runs every release, beside the builds, and the tag waits for it. A switch that trusts
  the Mac's pass instead is designed below (slice 15.9) but left off (decision 3).
- **Change `ci.py`'s checks or make them narrower.** They are the quality gate. The one idea that would narrow the
  browser checks' inputs (record the server modules each check really loads) saves nothing on most releases (8 of 98
  commits touched only the server), so it isn't built (decision 9).
- **Build on the LXC.** The house stays in registry mode: it runs the image everyone else gets.
- **Remove the HA App for other people.** The App images and the `ha-apps` branch keep being published.
- **Restart Home Assistant without need.** A Python component can't be loaded in place; whether a JavaScript-only HK
  Frontend change could skip the restart is not studied here.
- **Check the wall tablets.** That needs a sign-in. The phase 14 alerts (`tablet.offline`, `link.lost`) already tell
  the owner.

## The design

### 1. The workflow (`.github/workflows/release.yml`)

**Inputs.** `publish` stays as it is. New:

- `stage`, a choice: `all` (the default, today's whole release, from a tag), `images`, `promote`.
- `images_run`, a string: the run number `promote` must have been preceded by.

**`stage=all`** is today's behavior, only faster (the suite parallel, ARM native). It keeps the rule "publish needs a
tag". Hand releases and the build-only dry run use it, and it stays the fallback if the new flow is ever broken.

**`stage=images`** (the first half of a release):

- Runs from a branch or `main`; publishes only if `publish` is on.
- **Guards** (a `guard` job, values through `env` as the existing test `test_the_event_values_never_reach_a_script_directly`
  requires):
  1. `python tools/check_version.py --staged --print`: the three version files agree and `CHANGELOG.md` has a
     `## X.Y.Z` section (a new flag; today only `--tag` checks the section).
  2. The tag `vX.Y.Z` doesn't exist on origin (`git ls-remote --tags`). Once a version is tagged it can't be staged again.
  3. `GITHUB_SHA` is on `main`: `gh api repos/$GITHUB_REPOSITORY/compare/main...$GITHUB_SHA --jq .status` is
     `identical` or `behind`. A commit nobody pushed to `main` publishes nothing.
- Jobs, all beside each other:
  - `version`: the cheap checks (`check_links`, `package_check --release`, `check_private`), seconds.
  - `suite`: `pip install -e '.[dev]'` with the constraints file, then `python -m pytest -q -p no:cacheprovider -n 4`
    (`pytest-xdist>=3.8` is already in `dev`). Ubuntu runners for a public repository have 4 vCPUs (unverified).
    Estimate 2.5 to 3 minutes, against 6.2 serial. Uses `--dist loadgroup` if a test shows an ordering dependency; the
    event-loop timing tests are the ones to watch (decision 3's rerun rule below).
  - `app-images`: as today (matrix; the aarch64 pair on QEMU is under 1.1 minutes, so left alone).
  - `docker-images`: native, see below. Tags: `X.Y.Z` only. `latest` is not moved.
  - **No `ha-apps` job, no `latest`.**
- The run's conclusion is the answer to "is this commit good": green means the guards, the checks, the Linux suite and
  every image passed.

**`stage=promote`** (the second half), run from the tag `vX.Y.Z`, `publish` on, `images_run` set:

1. `check_version.py --tag "$REF_NAME"` as today.
2. **Verify the images run** with `gh api`: run `images_run` is `release.yml`, `head_sha` equals `GITHUB_SHA`, its
   `conclusion` is `success`, and every job in it succeeded or was skipped on purpose. Then
   `docker buildx imagetools inspect` of each of the three `X.Y.Z` images shows both platforms and an
   `org.opencontainers.image.revision` equal to `GITHUB_SHA` (the exact template, `{{json .Image}}`, is confirmed
   while building). A dry run, or an older attempt at the same version, can't pass this.
3. Move `latest`: `docker buildx imagetools create -t ghcr.io/jazzphone/<image>:latest ghcr.io/jazzphone/<image>:X.Y.Z`
   for the three Docker images. A retag of a manifest, seconds, no rebuild.
4. The `ha-apps` job, unchanged (`tools/publish_ha_apps.py`, the force-pushed single commit). Last, so Home
   Assistant is never offered a version whose images aren't there.

Estimate for `promote`: 1 minute (setup and `npm ci` dominate).

**Native ARM.** `docker-images` becomes a matrix of image by platform:

- `linux/amd64` on `ubuntu-latest`, `linux/arm64` on `ubuntu-24.04-arm`. No `setup-qemu-action`. The caddy and
  transcode images are small, but they go through the same path so the workflow has one shape.
- Each platform build pushes **by digest** (`outputs: type=image,name=ghcr.io/jazzphone/<image>,push-by-digest=true,name-canonical=true,push=<publish>`),
  `cache-from`/`cache-to` of `type=gha` with a scope per image and platform (`scope=mantel-server-arm64`), and uploads
  its digest as an artifact. This is the documented pattern for multi-platform images without emulation.
- A `docker-merge` job per image downloads both digests and runs `docker buildx imagetools create -t <image>:X.Y.Z
  <image>@sha256:<amd64> <image>@sha256:<arm64>` (and `-t :latest` only in `stage=all`).
- A dry run (`publish` off) builds both platforms without pushing and skips the merge.
- Provenance and SBOM attestations stay at their defaults, as the published images have them today; the slice checks
  `imagetools inspect` still lists `linux/amd64` and `linux/arm64`, and what else it listed before.
- Estimate for the server image: amd64 1.5 to 2.5 minutes and arm64 the same, in parallel, with `type=gha` layer
  caches (the dependency layer is cached unless `requirements.lock` changes, the `web/` layer is rebuilt on most
  releases). **Unverified**: the first build-only run measures it.

**Rules kept.** Actions stay pinned to major versions (`test_actions_are_pinned_to_major_versions`); event values reach
scripts only through `env`; `ha-apps` is the only branch pushed; `GITHUB_TOKEN` is the only credential. One new rule,
written next to the old one in the workflow's header: *an images run may push `X.Y.Z` image tags from a commit that is
already on `main` while its tag doesn't exist; nothing else is published before the tag.* A job whose `needs` were
skipped is skipped unless its `if` says `!failure() && !cancelled()`; the slice's tests cover each stage's job list.

### 2. The LXC side (`tools/release_house.py` and one line in `packaging/proxmox/ct/mantel.sh`)

**Settings** (never in the repository: Rule 6): `~/.config/mantel/house.json` gets
`{"lxc_ssh": "root@<the LXC's address>", "lxc_key": "<path to the key file>"}` beside `ha_url`. The tool runs
`ssh -i <key> -o BatchMode=yes -o StrictHostKeyChecking=yes <lxc_ssh> <command>` through one injectable function
(`Lxc.run`), so tests use a fake. Messages and the House-releases record say "the LXC", never its address.

**One line in the update.** `update_script` in `packaging/proxmox/ct/mantel.sh` reads the target from
`MANTEL_UPDATE_REF` before `git config mantel.ref`:
`ref="${MANTEL_UPDATE_REF:-$(git config --get mantel.ref || echo latest)}"`. The house can then update to a commit
without leaving a pin behind if the tool dies. The tool verifies the result either way (`git -C /opt/mantel rev-parse
HEAD` must be the release commit). If the LXC's `update` doesn't pass the variable through (**unverified**: the engine
is community-scripts', fetched by `update` itself), the tool falls back to `git config mantel.ref <commit>` and
restores `latest` in a `finally`, and the next run's preflight repairs a left-over pin.

**`Lxc` (new class in `tools/release_house.py`):**

| Method | What it does |
|---|---|
| `clean()` | `git -C /opt/mantel status --porcelain` (tracked changes only; `.env` and secrets are ignored) must be empty. Otherwise **refuses** and lists the files (a hand hotfix, the `go2rtc.yaml` of 0.1.119). `--save-and-revert-hand-changes` writes the diff to `/root/mantel-hand-changes-<time>.patch` on the LXC and reverts it |
| `update(commit)` | `MANTEL_UPDATE_REF=<commit> update`; checks the exit status and `rev-parse HEAD` |
| `healthy(commit)` | all three services healthy (`docker compose ps --format json`); the container's `org.opencontainers.image.revision` label equals the release commit; `docker exec mantel-server python -c` fetching `http://127.0.0.1:8765/healthz?strict=1` (Caddy doesn't forward `/healthz` from outside, and `mantel_server.health` has no strict flag, so a short urlopen inside the container) is 200 with Home Assistant connected, retried for up to 3 minutes |
| `log_problems(since)` | after a 20 s settle, `docker compose logs --since <the container's StartedAt>`: a `Traceback`, or `ERROR` from `mantel-server`, fails; matches from `caddy` and `go2rtc` are printed as warnings |
| `previous()` | the version and commit that were running (from `/opt/mantel`), for the record and for the failure message |

Rollback is `update.sh`'s own (the kept images; a backup first). If the new version doesn't start and the old one
can't either (`schema_too_new`), the tool prints the same restore command `update.sh` prints and stops: that case
needs a person, and the build session lists it under **Waiting on the owner** only if it ever happens.

### 3. The one command (`tools/release_house.py mantel`)

```
~/.venvs/mantel/bin/python tools/release_house.py mantel 0.1.121          # notes from CHANGELOG.md's Unreleased
~/.venvs/mantel/bin/python tools/release_house.py mantel 0.1.121 --dry-run
~/.venvs/mantel/bin/python tools/release_house.py plan                     # what changed, per product
~/.venvs/mantel/bin/python tools/release_house.py all                      # every product that changed
```

The order, and what a failure at each step leaves:

| # | Step | A failure leaves |
|---|---|---|
| 0 | Preflight: `HEAD` is `origin/main` (on `main`, or detached in a release worktree: `--from-origin`); clean; not behind; `ci_green` (a whole `full` run speaks for HEAD); the tag is free here and on origin; `gh auth status`; the LXC answers and is `clean()`; the private words are set | nothing |
| 1 | Bump (`bump_version.py --changelog`, which renames `## Unreleased` and keeps a new empty one above), commit the explicit paths, `recheck()` (`ci.py versions`), push to `main` | the release commit on `main`, untagged (a retry of the same version is allowed: `--retry` skips the bump when `HEAD` already says `X.Y.Z` with its section) |
| 2 | Push the same commit to `refs/heads/release/X.Y.Z` and dispatch `release.yml --ref release/X.Y.Z -f stage=images -f publish=true`. Dispatching from that branch, not from `main`, pins the commit even if another session pushes to `main` meanwhile; the tool checks the run's `headSha` | the branch; images `X.Y.Z` in ghcr.io, untagged |
| 3 | While it runs: build what the components need (`build_ha.py`, the Mantel Link layout) so they are ready | nothing |
| 4 | Wait for the images **jobs** (not the whole run): `gh run view --json jobs` until `docker-merge` and `app-images` are done | a failed image job stops here; nothing was changed on the house |
| 5 | `Lxc.update(commit)`, `healthy()`, `log_problems()` | the house rolled back by `update.sh`; no tag, no Release, `latest` and `ha-apps` untouched |
| 6 | Wait for the run's `suite` job (it ran beside steps 3 to 5, so it is normally done). If it failed, rerun failed jobs once (`gh run rerun --failed`, for a timing flake), then stop if it fails again. | the house runs the new version; no tag. The tool says so and why; the fix is the next commit and `--retry` (the house updates to it the same way) |
| 7 | Tag `vX.Y.Z` on the release commit and push the tag (only now: "the house runs it, healthy, and the suite passed") | a tag |
| 8 | Dispatch `stage=promote -f images_run=<run id> -f publish=true` from the tag; wait (about 1 minute) | a tag, images, the house; no `latest`, no `ha-apps`. Rerunning promote is safe |
| 9 | `gh release create vX.Y.Z` with the version's `CHANGELOG.md` section (and `RELEASE_FOOTER`). About's update check sees the release now | a promoted version without a Release; run `gh release create` |
| 10 | Delete `release/X.Y.Z`; append the record to `House-releases.md` (commit, run id, build, the house's old and new version, timings per step) and push | nothing important |

Steps 3 to 4 overlap with the build, so the person's wait is the build plus the update. The tool prints the time of
each step, and the record keeps them, so the next plan has measured numbers.

**Dry run.** `--dry-run` makes every preflight check (including a read-only `ssh ... git status`), stages the App
with `stage_ha_app.py --dry-run`, and dispatches nothing.

**The Home Assistant App path.** The current code (`update_app`, `House.supervisor`, `stage_ha_app.py --replace`) stays,
behind `--ha-app`, for a home that still runs the App (decision 4). Without `--ha-app` the tool doesn't stage the
stopped App at all. It no longer needs the admin token for a Mantel release.

### 4. Release only what changed (`plan` and `all`)

- **Per-product tags in the repository**, so "since the last release" is a git range: `hk-frontend/v1.40.0` and
  `mantel-link/v0.1.12` on the monorepo commit each was published from. The names don't match the LXC's
  `git tag -l 'v[0-9]*'`, so `update` is unaffected. A one-time backfill finds each commit from the public
  repositories' newest commits, whose messages say `HK Frontend 1.40.0 (from mantel d81a674d)` and
  `Mantel Link 0.1.12 (from mantel f6c000b6)` (read with `gh api repos/jazzphone/<repo>/commits`). Mantel's base is the
  newest `v*` tag.
- **`plan` prints, per product,** the last released version and commit, and whether anything changed since in what that
  product is built from, with the file count:
  - Mantel Server: everything the image takes (`web/`, `hk_core/`, `hosts/server/`, `pyproject.toml`, `packaging/`,
    `tools/build_static.py`, `tools/write_release.py`), through `ci.py`'s `beyond_versions` rule so version lines and
    changelogs don't count;
  - HK Frontend: `ci.py HK_INPUTS` (`hosts/ha/`, `web/`, `hk_core/`, the build tools);
  - Mantel Link: `hosts/ha/custom_components/mantel/` and the `hk_core` modules its publisher vendors (taken from its
    `publish.py` plan, not guessed).
- **`all`** releases the changed products in the order Mantel, HK Frontend, Mantel Link, with the next version of each
  (patch bump, or the version given with `--versions mantel=0.1.121,hk-frontend=1.41.0`). A Mantel-only fix does no
  Home Assistant restart, no rsync, no HK Frontend publish: about 5 minutes less than a full set. A `web/` change
  touches both Mantel and HK Frontend, which is the common case.
- **Component steps** (HK Frontend, Mantel Link) are today's `release_component`, unchanged except: notes come from
  each product's own `## Unreleased` (renamed to the version), the Wiki clone is pushed by the tool when `publish.py`
  committed to it (it was a hand step), and the HA restart wait is measured and recorded. They still need the Home
  Assistant admin token (a restart goes through its websocket).

### 5. Release notes and the release worktree

- `--notes` stays but is optional. By default the notes are the body of `## Unreleased` in `CHANGELOG.md` (and in each
  component's changelog); a release with an empty `Unreleased` for a product refuses it ("nothing to say"). This is
  what the hand releases did already, and it removes the second copy that `add_notes` writes today.
- Releases are made from a clean worktree at `origin/main` (other sessions work on the shared checkout, and a
  worktree can't check out `main` twice). `--from-origin` accepts a detached `HEAD` equal to `origin/main`, runs
  `npm ci --prefix tools` if `tools/node_modules` isn't that worktree's own (the `versions` run failed once on a
  symlink to the main checkout's), and pushes `HEAD:refs/heads/main`.

### 6. Other things that slow a release (and what's done about them)

| Cause | Today | Plan |
|---|---|---|
| `ci.py full` on the release tree | 94 s unchanged, 5.5 min when `web/` or the server changed | nothing: it is the gate. The release session starts it while the notes are written |
| `ci.py versions` per release commit | 27 s each | kept (it is what reads the version files); done once per product's commit |
| Writing notes twice, bumping HK Frontend's manifest and changelog by hand | 3 to 5 min | the tool, from `## Unreleased` |
| Wiki push by hand | 1 min | the tool |
| `gh release create` and the record by hand | 3 to 5 min | the tool |
| The stopped HA App staged every release | 1 min and a flaky first call (0.1.118) | off unless `--ha-app` |
| Checking the log and health by hand | 3 min | `Lxc.healthy` and `log_problems` |
| `Releasing.md` says the run takes "about 20 minutes" | stale | rewritten with measured times |
| Transcode and Caddy images rebuilt every release | parallel, under 1 min | left: not on the critical path |
| Browser checks' inputs too wide | rerun for any server file | left alone (decision 9) |

## How it's built (models and effort, the owner, 2026-11-03)

- **The building session runs Opus 5.5 at Medium effort.** It writes the workflow's stage logic and the order in
  `release_house.py`, makes the design calls, and reads each slice's diff.
- **Agents run Sonnet 5.5 at High effort** (`model: "sonnet"`, `effort: "high"`): the native-ARM matrix and merge job,
  the `Lxc` class and its fakes, the tests, the docs, each with a brief that names its files and what done looks like.
  A **review agent** (Sonnet 5.5 High) reads each slice's diff before it is pushed.
- **Opus 5.5 for an agent, only for one job:** the security review of 15.3 and 15.5, because they widen what a
  branch may publish (`stage=images`) and add an SSH path that runs as root on the house. The review checks the
  guards, that no event value reaches a script unquoted, that a failed step can't leave a tag or `latest` or
  `ha-apps` moved, and that no address or key lands in a log, a record or a commit.
- **If something unforeseen comes up, the session does not stop to ask.** It picks the safest choice consistent
  with the decisions below, writes it in the **Build log** with the reason, and keeps going. "Safest" means: the
  choice that publishes less, changes the house less, and is easier to undo (keep `stage=all` working, keep the old
  HA App path, refuse instead of guessing). It stops only for something only the owner can physically do, and lists
  those under **Waiting on the owner**.
- **Validate and verify throughout.** Each slice ends with its tests and `tools/ci.py quick`. `tools/ci.py full` runs
  before every push. A slice that changes `release.yml` is proved by a build-only run of the workflow from a branch
  (`gh workflow run release.yml --ref <branch> -f publish=false`), whose times go in the Build log. Anything with a
  page gets WebKit screenshots at three sizes (this plan builds no page). Before pushing: fetch and merge `origin/main`
  (`git merge --no-autostash -s ort` on the share), `tools/check_private.py --rev HEAD --messages origin/main..HEAD`,
  and never `--force`. Releasing to the house needs the owner's OK (decision 10).

## Slices

| Slice | What | Size | Needs | Touches |
|---|---|---|---|---|
| 15.1 | The suite in the workflow on 4 workers (`-n 4`), a rerun note for flakes; a build-only run measures it | S | | `release.yml`, `tests/test_release_workflow.py` |
| 15.2 | Native ARM images: image by platform matrix, by-digest push, `docker-merge`, per-platform cache scopes; a build-only run proves `ubuntu-24.04-arm` and measures it | M | 15.1 | `release.yml`, `tests/test_release_workflow.py` |
| 15.3 | The stages: `stage` and `images_run` inputs, the `guard` job, `check_version.py --staged`, the suite beside the builds, `promote` (verify, retag `latest`, `ha-apps`), `all` kept as is | L | 15.2 | `release.yml`, `tools/check_version.py`, `tests/test_release_workflow.py`, `tests/test_check_version.py` |
| 15.4 | The LXC side: `MANTEL_UPDATE_REF` in `ct/mantel.sh`; `Lxc` class (`clean`, `update`, `healthy`, `log_problems`, `previous`); `house.json` keys; a read-only look at the real LXC's `update` | M | | `packaging/proxmox/ct/mantel.sh`, `tools/release_house.py`, `tests/test_release_house.py`, `tests/test_lxc_installer.py` |
| 15.5 | `release_house.py mantel` on the new order (steps 0 to 10), `--retry`, `--ha-app`, the release branch, the timing record | L | 15.3, 15.4 | `tools/release_house.py`, `tests/test_release_house.py` |
| 15.6 | Notes from `## Unreleased`; `--from-origin`; the Wiki push; per-product tags with the backfill; `plan` and `all` | M | 15.5 | `tools/release_house.py`, `tests/test_release_house.py` |
| 15.7 | Docs: `Releasing.md` (the new order, measured times, `stage`), `Building-and-Testing.md`, `House-releases.md`'s header, `Updating.md` if the LXC line changes, `CHANGELOG.md` | S | 15.1 to 15.6 | `docs/` |
| 15.8 | The proof: one real release with the new flow (decision 10), its times in the Build log and in `Releasing.md`'s "What a release takes" | S | 15.7; the owner's OK | the house |
| 15.9 | **Optional, off:** `--trust-local-suite`, the Mac's pass as the Linux suite's skip (below) | S | 15.3, 15.5; decision 3 | `release.yml`, `tools/release_house.py` |

**Order and risk.** 15.1 to 15.3 change only the workflow and are safe to land one at a time: each keeps `stage=all`
working, and the real release path isn't used until 15.5. 15.4 changes one line users' LXC `update` runs, so it lands
with its test and is read by the review agent twice. 15.5 and 15.6 are tools, tested with fakes before any real run.

**The trust mechanism for skipping the suite (slice 15.9, only if decision 3 is changed).** `ci.py` already knows the
passed tree (`full_run_for`). The tool would pass `-f attested_tree=<git tree of the release commit> -f attested_note="ci.py full 50
passed 2026-11-03T13:02Z on 9fa14c39 + versions"`; the `suite` job runs only if the checkout's
`git rev-parse HEAD^{tree}` differs from `attested_tree`, and writes the note to the step summary. It does not
call out to anything: a run's inputs are shown in the Actions UI. The risk is real but small: the check proves
"the tree I tested is the tree being built", not that the Mac and Linux behave alike (a Mac-only pass, a dependency
resolved differently, a test that needs `pytest -n 4`'s order). It trusts whoever can dispatch the workflow, the same
people who can edit it. Mitigations if built: still run the suite when `pyproject.toml`, `requirements.lock`, `packaging/docker/`
or `tests/conftest.py` changed since the last green Linux run, and always run it on `main` with `publish` off once a
week by hand. Gain: about 1 minute on a 4-minute run, because the suite runs beside the builds anyway.

## Expected times

Before is measured (run `41643065587` for the workflow; the rest from `Releasing.md` and the hand release of
2026-11-03). After is an estimate until slice 15.8 measures it.

| Part | Before | After |
|---|---|---|
| `ci.py full` on the release tree | 94 s to 5.5 min | same |
| Bump, notes, commit, `versions`, push | ~3 min by hand | ~40 s, the tool |
| Linux suite | 6.2 min, in front of everything | ~3 min, beside the builds, never on the critical path |
| Server image (both architectures) | 4.4 min after the suite; arm64 under QEMU | ~2 to 2.5 min, native, merged |
| Other images, ha-apps | <1.1 min, 0.2 min | the images <1.1 min in parallel; `promote` ~1 min |
| **Workflow wall time** | **11.4 min** (11.9 to 15.4 before) | **~4 min** to the images, ~1 min to promote |
| The house (`update`, health, log check) | ~3 min by an assistant | ~2 to 3 min (unmeasured: `update.sh` pulls, backs up, `up --wait`) |
| Tag, Release, record | ~5 min by hand | ~30 s |
| Components, when changed | build + rsync + restart + publish by hand, ~10 min | the same steps by the tool, ~5 min (the HA restart wait dominates); skipped when unchanged |
| **Mantel-only fix, after `ci.py full`** | **~25 to 30 min** | **~8 to 9 min unattended, ~1 min of attention** |

## Tests

- `tests/test_release_workflow.py` (extended): the stage input and its three job lists; `all` unchanged in order
  (`ha-apps` last) and still tag-only for `publish`; `images` has no `ha-apps` job and no `latest` tag; `promote` verifies
  `images_run` before it retags; `guard` checks the tag, the `main` ancestry and `--staged`; the ARM runner label and the
  digest merge; per-platform cache scopes; the dry run pushes nothing; actions still pinned; no event value pasted
  into a script.
- `tests/test_check_version.py`: `--staged` accepts a version with its section and no tag, refuses an `Unreleased`-only
  changelog, and disagreement between files.
- `tests/test_release_house.py` (extended, with a fake `gh`, a fake `ssh` and a temporary git repository):
  - the happy path in order: push, branch, dispatch, update, **tag only after health and the suite**, promote, Release,
    record, branch deleted;
  - every failure in the table leaves what the table says (images fail: no house change; health fails: no tag;
    suite fails twice: no tag; promote fails: rerunnable);
  - hand changes on the LXC refuse, and `--save-and-revert-hand-changes` saves the patch first;
  - `main` moved: the run's `headSha` differs and the tool stops before the house;
  - `--retry` of a bumped, untagged version; a tag that exists refuses;
  - `MANTEL_UPDATE_REF` honored, the fallback pin restored on every exit;
  - notes from `Unreleased` (and the empty case); `plan` against a temporary repository with per-product tags;
  - no address, key path or token in any printed line or record.
- `tests/test_lxc_installer.py`: `ct/mantel.sh`'s `update_script` uses `MANTEL_UPDATE_REF` over `mantel.ref`, and
  `latest` without either.
- Everything runs with `tools/ci.py` (`quick` while building, `full` before each push).

## Verification

1. **Each workflow slice:** a build-only run from a branch (`publish=false`), times copied into the Build log. After
   15.3, a `stage=images` run with `publish=false` and a `stage=promote` refusal test (a wrong `images_run`).
2. **15.4, read-only on the real LXC:** `cat` the `update` command and `git -C /opt/mantel status`, to confirm the
   engine fetches `ct/mantel.sh` and passes the environment. Nothing is changed.
3. **15.5, before any real run:** `release_house.py mantel <next> --dry-run` against the real LXC (a read-only SSH).
4. **15.8, the real one:** the numbers of the table above, the record in `House-releases.md`, `docker buildx imagetools
   inspect` showing both platforms for the three images, the `ha-apps` branch at the new version, About's update check
   seeing the Release, and the house healthy with a clean log.

## Definition of done

- A Mantel release is one command from a clean worktree, with no Home Assistant admin token, and takes at most 10
  minutes after `ci.py full` for a Mantel-only change (measured in the proof release, or by the build-only runs and
  the dry run if the owner hasn't approved a live release).
- A failed health check or a failed Linux suite leaves no tag, no `latest`, no `ha-apps` change and no Release.
- `release.yml` `stage=all` still works from a tag, as the documented fallback.
- A release that changes one product doesn't touch the others.
- `Releasing.md`, `Building-and-Testing.md` and `House-releases.md` describe the new flow with measured times; no
  document says "about 20 minutes".
- Everything is pushed to `main` (not released unless decision 10 allows it), `tools/ci.py full` is green on the
  pushed tree, and the Build log and Waiting on the owner are filled in.

## Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| 1 | The order for the house: update it from images pushed before the tag (`stage=images`, then tag, then `promote`), tag first, or build mode on the LXC? | **House first, with `stage=images`.** It keeps "a tag means the house runs it, healthy"; a failed release burns no version; no tag appears for a build the house rejected. Tag-first leaves a public tag for a bad release for about 3 minutes and was already the practice only because there was no alternative. Build mode drifts from what everyone else runs and builds on the small LXC |
| 2 | Build the arm64 images on GitHub's native ARM runners (`ubuntu-24.04-arm`, free for a public repository) instead of QEMU? | **Yes.** Keep the QEMU path in `stage=all` untouched until the first native build-only run passes; if the label isn't available, stay on QEMU and say so in the Build log |
| 3 | The Linux suite: skip it when the Mac says it passed, or run it beside the builds on 4 workers and make the tag wait for it? | **Run it beside the builds and gate the tag.** It costs no wall time (it finishes while the house updates) and keeps the only Linux run. Skipping would save about a minute and trusts a pass the workflow can't check. Slice 15.9 is designed but not built. If a Linux suite flake appears, the tool reruns the failed job once |
| 4 | Retarget `release_house.py mantel` to the LXC and stop staging the stopped HA App each release (keep it behind `--ha-app`)? Keep publishing the App images and `ha-apps` for other users? | **Yes to both.** The App is stopped on purpose and its flaky update call (0.1.118) cost time and told nothing; the publication is for everyone else |
| 5 | A hand hotfix on the LXC: refuse, or save and revert it? | **Refuse by default**, list the files, and offer `--save-and-revert-hand-changes` (the diff is saved on the LXC first). The memory rule is "revert hand hotfixes before `update`"; the tool just makes it impossible to forget |
| 6 | Per-product tags `hk-frontend/vX.Y.Z` and `mantel-link/vX.Y.Z` in this repository, backfilled once, so "what changed since the last release" is exact? | **Yes.** They don't match the LXC's `v[0-9]*` glob. Only the tool and the backfill create them |
| 7 | Release notes from each changelog's `## Unreleased` (no separate notes file)? | **Yes**, with `--notes` still accepted. It is what hand releases do; it removes the second copy |
| 8 | Release from a clean worktree at `origin/main` (`--from-origin`), so other sessions' work on the shared checkout doesn't block it? | **Yes.** The tool already refuses to run off `main`, which a worktree can't check out twice |
| 9 | Narrow `ci.py`'s browser-check inputs (record the server modules each check really loads)? | **No.** Only 8 of 98 commits since `v0.1.113` touched just the server; the saving is rare and a missed lazy import would hide a failure |
| 10 | May the building session make one real release with the new flow when it is done (after a dry run), including read-only SSH to the LXC for slice 15.4 and the release's own `update` there? | **Yes, if main has something unreleased beyond release records.** The dry run and the build-only runs come first. If nothing is pending, the proof waits for the next release and is listed under Waiting on the owner. Never without a dry run, never a force-push, never a moved tag |
| 11 | May the session run build-only runs of `release.yml` (`publish=false`, pushes nothing) and temporary branches on origin (`release/*`, `plans-*`, deleted afterward) to test the workflow? | **Yes.** They cost Actions minutes (free here) and are the only real test of a workflow |
| 12 | Push the HK Frontend Wiki clone from the tool (it is a hand step now)? | **Yes**, only when `publish.py` committed to it |
| 13 | The Home Assistant admin token for component releases (HK Frontend, Mantel Link restart Home Assistant through its websocket) | **Not needed for Mantel.** The owner adds it to the Keychain when wanted; without it, component releases stay as `--dry-run` plus the hand steps |

## Sources

- Docker, multi-platform builds with GitHub Actions without emulation (digest push and the merge job):
  <https://docs.docker.com/build/ci/github-actions/multi-platform/>
- GitHub-hosted runners, including the Arm64 labels (`ubuntu-24.04-arm`) for public repositories:
  <https://docs.github.com/en/actions/using-github-hosted-runners/using-github-hosted-runners/about-github-hosted-runners>
- `docker buildx imagetools create` and `inspect`: <https://docs.docker.com/reference/cli/docker/buildx/imagetools/>
- GitHub's workflow dispatch inputs (`choice`, `string`): <https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#onworkflow_dispatchinputs>
- The compare endpoint: <https://docs.github.com/en/rest/commits/commits#compare-two-commits>
- In this repository: `docs/development/Releasing.md`, `docs/development/Building-and-Testing.md`,
  `.github/workflows/release.yml`, `tools/ci.py`, `tools/release_house.py`, `packaging/proxmox/ct/mantel.sh`,
  `packaging/lxc/mantel.sh`, `packaging/compose/update.sh`.

## Build log

(Empty until the session starts. Each entry: the date, the slice, what was unforeseen, the choice made and why, in a
sentence or two. The build-only runs' times go here too.)

## Waiting on the owner

(Filled in by the session. Expected, only if the matching decision is yes: nothing before slice 15.8. After it, at most:
the first live release if main had nothing to release; the Home Assistant admin token for component releases; and, if
the LXC's update ever fails with `schema_too_new`, restoring the backup `update.sh` names.)
