""".github/workflows/release.yml: the images it pushes are the names Home Assistant, compose and the docs use,
nothing is pushed on a dry run, and the add-on repository goes to ha-apps (never main) after the images."""
from __future__ import annotations

import importlib.util
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/release.yml"
TEXT = WORKFLOW.read_text()
spec = importlib.util.spec_from_file_location("publish_ha_apps", ROOT / "tools/publish_ha_apps.py")
pub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pub)

PUBLISH = "${{ needs.version.outputs.publish == 'true' }}"
DOCKER_IMAGES = {"mantel-server", "mantel-transcode", "mantel-caddy"}


@pytest.fixture(scope="module")
def wf():
    # PyYAML is a dev dependency (pyproject's [dev]); the text checks below run without it too
    yaml = pytest.importorskip("yaml")
    return yaml.safe_load(TEXT)


def test_it_parses_and_runs_only_by_hand(wf):
    on = wf[True] if True in wf else wf["on"]  # YAML 1.1 reads the bare key `on` as true
    assert set(on) == {"workflow_dispatch"}     # a pushed tag starts nothing: the checks run locally (tools/ci.py)
    inputs = on["workflow_dispatch"]["inputs"]
    assert inputs["publish"]["type"] == "boolean" and inputs["publish"]["default"] is False
    assert inputs["stage"]["type"] == "choice" and inputs["stage"]["options"] == ["all", "images", "promote"]
    assert inputs["stage"]["default"] == "all"                         # a hand run is today's whole release
    assert inputs["images_run"]["type"] == "string"
    assert wf["permissions"] == {"contents": "write", "packages": "write", "actions": "read"}
    jobs = wf["jobs"]
    assert set(jobs) == {"version", "suite", "app-images", "docker-images", "docker-merge", "verify-images",
                         "latest", "ha-apps"}
    assert jobs["version"]["permissions"] == {"contents": "read"}


def test_the_app_images_are_named_the_home_assistant_way(wf):
    m = wf["jobs"]["app-images"]["strategy"]["matrix"]
    pushed = {f"{pub.REGISTRY}/{a['image']}-{x['ha']}" for a in m["app"] for x in m["arch"]}
    expected = {name for app in pub.APPS for name in app.image_names.values()}
    assert pushed == expected == {
        "ghcr.io/jazzphone/mantel-app-amd64", "ghcr.io/jazzphone/mantel-app-aarch64",
        "ghcr.io/jazzphone/mantel-connect-app-amd64", "ghcr.io/jazzphone/mantel-connect-app-aarch64"}
    assert {x["ha"]: x["platform"] for x in m["arch"]} == {"amd64": "linux/amd64", "aarch64": "linux/arm64"}
    assert {a["stager"] for a in m["app"]} == {"tools/stage_ha_app.py", "tools/stage_connect_app.py"}
    build = [s for s in wf["jobs"]["app-images"]["steps"] if str(s.get("uses", "")).startswith("docker/build-push")][0]
    assert build["with"]["tags"].endswith(":${{ needs.version.outputs.version }}")
    labels = build["with"]["labels"]
    for label in ("org.opencontainers.image.source=${{ env.SOURCE_URL }}", "io.hass.type=addon",
                  "io.hass.version=${{ needs.version.outputs.version }}", "io.hass.arch=${{ matrix.arch.ha }}"):
        assert label in labels
    assert wf["env"]["SOURCE_URL"] == "https://github.com/jazzphone/mantel"


def test_the_docker_images_match_compose_and_the_docs(wf):
    m = wf["jobs"]["docker-images"]["strategy"]["matrix"]
    rows = m["image"]
    assert {r["name"] for r in rows} == DOCKER_IMAGES == set(wf["env"]["DOCKER_IMAGES"].split())
    assert set(wf["jobs"]["docker-merge"]["strategy"]["matrix"]["image"]) == DOCKER_IMAGES
    by = {r["name"]: r for r in rows}
    assert (by["mantel-server"]["target"], by["mantel-transcode"]["target"]) == ("server", "transcode")
    assert by["mantel-caddy"]["file"] == "packaging/docker/caddy.Dockerfile"
    dockerfile = (ROOT / "packaging/docker/Dockerfile").read_text()
    assert " AS server" in dockerfile and " AS transcode" in dockerfile
    assert wf["env"]["REGISTRY"] == pub.REGISTRY == "ghcr.io/jazzphone"


def test_arm64_builds_natively_and_the_digests_are_merged(wf):
    """Each platform on a runner of its own architecture (no QEMU), pushed by digest, cached per image and platform;
    docker-merge joins the two digests into the X.Y.Z manifest. (docs.docker.com: multi-platform without emulation)"""
    job = wf["jobs"]["docker-images"]
    plats = {p["arch"]: p for p in job["strategy"]["matrix"]["platform"]}
    assert set(plats) == {"amd64", "arm64"}
    assert (plats["amd64"]["runner"], plats["amd64"]["platform"]) == ("ubuntu-latest", "linux/amd64")
    assert (plats["arm64"]["runner"], plats["arm64"]["platform"]) == ("ubuntu-24.04-arm", "linux/arm64")
    assert job["runs-on"] == "${{ matrix.platform.runner }}"
    uses = [s.get("uses", "") for s in job["steps"]]
    assert not any(u.startswith("docker/setup-qemu-action") for u in uses)
    build = [s for s in job["steps"] if str(s.get("uses", "")).startswith("docker/build-push")][0]["with"]
    assert build["platforms"] == "${{ matrix.platform.platform }}"
    assert "tags" not in build                                  # by digest: nothing named before the merge
    assert build["outputs"] == ("type=image,name=${{ env.REGISTRY }}/${{ matrix.image.name }},push-by-digest=true,"
                                "name-canonical=true,push=" + PUBLISH)
    scope = "${{ matrix.image.name }}-${{ matrix.platform.arch }}"
    assert build["cache-from"] == f"type=gha,scope={scope}" and build["cache-to"] == f"type=gha,mode=max,scope={scope}"
    assert "org.opencontainers.image.revision=${{ github.sha }}" in build["labels"]
    merge = wf["jobs"]["docker-merge"]
    assert set(merge["needs"]) == {"version", "docker-images"}
    script = [s["run"] for s in merge["steps"] if "imagetools create" in s.get("run", "")][0]
    assert 'imagetools create -t "$IMAGE:$VERSION"' in script and ":latest" not in script
    assert "-eq 2" in script                                    # both platforms or nothing


def test_the_suite_runs_on_four_workers_beside_the_builds(wf):
    jobs = wf["jobs"]
    suite = jobs["suite"]
    assert suite["needs"] == "version"
    assert any(s.get("run") == "python -m pytest -q -p no:cacheprovider -n 4" for s in suite["steps"])
    # nothing that builds waits for it; what moves latest and ha-apps does
    for job in ("app-images", "docker-images", "docker-merge"):
        assert "suite" not in jobs[job]["needs"], job
    assert "suite" in jobs["latest"]["needs"] and "suite" in jobs["ha-apps"]["needs"]
    assert "needs.suite.result == 'success'" in jobs["latest"]["if"]
    assert "needs.suite.result == 'success'" in jobs["ha-apps"]["if"]


def _runs(wf, stage: str, publish: bool, ref_tag: bool) -> set[str]:
    """Which jobs run, read from the `if:`s the way GitHub reads them (a job with no status function needs every
    `needs` to have succeeded; `!cancelled()` lets it run after a skip). All jobs succeed here."""
    out = {"stage": stage, "publish": "true" if publish else "false"}
    results: dict[str, str] = {}

    def value(expr: str) -> bool:
        e = expr.replace("!cancelled()", "True").replace("&&", " and ").replace("||", " or ").replace("!=", " != ")
        e = re.sub(r"needs\.version\.outputs\.(\w+)", lambda m: repr(out[m.group(1)]), e)
        e = re.sub(r"needs\.([\w-]+)\.result", lambda m: repr(results[m.group(1)]), e)
        return bool(eval(e.replace("\n", " ")))                   # noqa: S307 (our own workflow's expressions)

    order = ["version", "suite", "app-images", "docker-images", "docker-merge", "verify-images", "latest", "ha-apps"]
    for name in order:
        job = wf["jobs"][name]
        needs = job.get("needs", [])
        needs = [needs] if isinstance(needs, str) else needs
        cond = job.get("if", "true")
        cond = cond if isinstance(cond, str) else str(cond).lower()
        explicit = "!cancelled()" in cond
        ok = (explicit or all(results[n] == "success" for n in needs)) and value(cond.replace("true", "True")
                                                                                     .replace("'True'", "'true'"))
        results[name] = "success" if ok else "skipped"
    return {n for n, r in results.items() if r == "success"}


def test_each_stage_runs_its_own_jobs(wf):
    builds = {"version", "suite", "app-images", "docker-images"}
    # stage=all from a tag: everything but the promote check, latest after the suite, ha-apps last
    assert _runs(wf, "all", True, True) == builds | {"docker-merge", "latest", "ha-apps"}
    # a dry run: no merge (nothing pushed), no latest; the add-on repository written as an artifact
    assert _runs(wf, "all", False, False) == builds | {"ha-apps"}
    # stage=images: the builds and the merge (X.Y.Z only); never latest, never ha-apps
    assert _runs(wf, "images", True, False) == builds | {"docker-merge"}
    assert _runs(wf, "images", False, False) == builds
    # stage=promote: builds nothing; verifies, then latest, then ha-apps
    assert _runs(wf, "promote", True, True) == {"version", "verify-images", "latest", "ha-apps"}


def test_latest_and_ha_apps_wait_for_what_they_must(wf):
    jobs = wf["jobs"]
    assert set(jobs["latest"]["needs"]) == {"version", "suite", "app-images", "docker-merge", "verify-images"}
    assert set(jobs["ha-apps"]["needs"]) >= {"version", "suite", "app-images", "docker-images", "latest"}
    assert "needs.version.outputs.stage != 'images'" in jobs["ha-apps"]["if"]
    assert "needs.latest.result == 'success'" in jobs["ha-apps"]["if"]
    assert "needs.verify-images.result == 'success'" in jobs["latest"]["if"]
    script = [s["run"] for s in jobs["latest"]["steps"] if "run" in s][0]
    assert 'imagetools create -t "$REGISTRY/$image:latest" "$REGISTRY/$image:$VERSION"' in script


def test_the_images_stage_guards_before_publishing():
    step = TEXT[TEXT.index("            images)\n"):TEXT.index("            promote)\n")]
    assert "check_version.py --staged --print" in step
    assert 'git ls-remote --tags origin "refs/tags/v$version"' in step
    assert "git/ref/heads/main" in step and 'compare/$main_sha...$GITHUB_SHA' in step and "identical" in step and "behind" in step
    assert 'if [ "$REF_TYPE" = tag ]' in step                    # images come before the tag, from a branch


def test_a_rerun_of_an_old_images_run_never_pushes_over_a_tagged_version(wf):
    """Security review 2026-11-03: "Re-run failed jobs" reuses the version job's outputs, so its guards don't run
    again; each job that pushes an X.Y.Z tag in stage=images asks origin for the tag itself, right before."""
    for job in ("app-images", "docker-merge"):
        steps = wf["jobs"][job]["steps"]
        guard = [i for i, s in enumerate(steps) if 'refs/tags/v$VERSION' in s.get("run", "")]
        push = [i for i, s in enumerate(steps) if str(s.get("uses", "")).startswith("docker/build-push")
                or "imagetools create" in s.get("run", "")]
        assert guard and push and guard[0] < push[0], job
        assert steps[guard[0]]["if"] == ("needs.version.outputs.stage == 'images' && "
                                          "needs.version.outputs.publish == 'true'")


def test_promote_verifies_the_images_run_before_it_retags():
    step = TEXT[TEXT.index("            promote)\n"):TEXT.index("            *)\n")]
    assert '[ "$publish" != true ] || [ "$REF_TYPE" != tag ] || [ -z "$IMAGES_RUN" ]' in step
    assert "check_version.py --tag" in step
    verify = TEXT[TEXT.index("  verify-images:"):TEXT.index("  latest:")]
    for check in (".path", ".head_sha", '= "$GITHUB_SHA"', ".conclusion", "Docker manifest $image",
                  "org.opencontainers.image.revision", "linux/amd64 linux/arm64", "{{json .Image}}",
                  "The main suite (Linux)", "mantel-app-aarch64 mantel-connect-app-amd64"):
        assert check in verify, check


def test_env_example_and_compose_name_the_published_images():
    example = (ROOT / "packaging/compose/.env.example").read_text()
    compose = (ROOT / "packaging/compose/compose.yaml").read_text()
    for var, image in (("MANTEL_SERVER_IMAGE", "mantel-server"), ("MANTEL_TRANSCODE_IMAGE", "mantel-transcode"),
                       ("MANTEL_CADDY_IMAGE", "mantel-caddy")):
        assert f"${{{var}:-" in compose, var
        assert re.search(rf"^#{var}=ghcr\.io/jazzphone/{image}:latest$", example, re.M), var
    # every tag a doc names for these images is one the workflow pushes: latest or a version
    for doc in ("packaging/compose/.env.example", "docs/guide/Install-Docker.md", "docs/guide/Updating.md"):
        for name, tag in re.findall(r"ghcr\.io/jazzphone/(mantel-[a-z-]+):([\w.<>-]+)", (ROOT / doc).read_text()):
            assert name in DOCKER_IMAGES, (doc, name)
            assert tag == "latest" or re.fullmatch(r"\d+\.\d+\.\d+|<version>|X\.Y\.Z", tag), (doc, tag)


def test_a_dry_run_pushes_nothing(wf):
    # every push and every login waits for publish, which the version job sets only when the stage allows it
    assert TEXT.count("docker/build-push-action@") == 2
    assert TEXT.count(f"push: {PUBLISH}") == 1 and TEXT.count(f"push={PUBLISH}") == 1
    assert TEXT.count("- if: needs.version.outputs.publish == 'true'\n        uses: docker/login-action@v3") == 2
    # the jobs that log in without that step-level if only run when publish is on
    for job in ("docker-merge", "latest"):
        assert "needs.version.outputs.publish == 'true'" in wf["jobs"][job]["if"], job
    push = TEXT[TEXT.index("git push --force") - 1200:TEXT.index("git push --force")]
    assert "- if: needs.version.outputs.publish == 'true'" in push
    assert 'if [ "$publish" = true ] && [ "$REF_TYPE" != tag ]' in TEXT and "publish=false" in TEXT


def test_the_branch_push_is_ha_apps_only():
    pushes = re.findall(r"git push[^\n]*", TEXT)
    assert pushes == ['git push --force "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" '
                      "HEAD:refs/heads/ha-apps"]
    assert "refs/heads/main" not in TEXT and "git tag" not in TEXT
    assert 'git config user.name "github-actions[bot]"' in TEXT
    assert "python tools/publish_ha_apps.py" in TEXT and "tools/check_version.py --tag" in TEXT


def test_actions_are_pinned_to_major_versions():
    uses = re.findall(r"uses:\s*(\S+)", TEXT)
    assert uses and all(re.fullmatch(r"[\w-]+/[\w-]+@v\d+", u) for u in uses), uses
    for action in ("docker/setup-qemu-action", "docker/setup-buildx-action", "docker/login-action",
                   "docker/build-push-action", "actions/upload-artifact", "actions/download-artifact"):
        assert action + "@v" in TEXT


def test_the_event_values_never_reach_a_script_directly():
    # github.ref_name and the inputs go through env: (script injection); only needs/matrix/env/runner/secrets in run:
    for block in re.findall(r"run: \|\n((?:          .*\n)+)", TEXT):
        assert "${{" not in block, block
    assert "${{ github.ref_name }}" in TEXT and "${{ inputs.publish }}" in TEXT
    assert "IMAGES_RUN: ${{ inputs.images_run }}" in TEXT and "STAGE_INPUT: ${{ inputs.stage }}" in TEXT


@pytest.mark.parametrize("workflow", ["tests.yml", "release.yml"])
def test_ci_installs_the_pinned_versions_the_images_ship(workflow):
    """DEP-8 (audit, second pass): the images install packaging/docker/requirements.lock, but CI installed
    pyproject's open ranges, so a release was tested on whatever PyPI served that day, not on what it ships.
    pip refuses hashes with an editable install, so CI turns the lock into a constraints file (the same pins,
    without the hashes) and installs with -c."""
    text = (ROOT / ".github/workflows" / workflow).read_text()
    installs = [raw for raw in text.splitlines() if "pip install -e" in raw]
    assert installs and all(' -c "$RUNNER_TEMP/constraints.txt"' in raw for raw in installs), installs
    make = [raw for raw in text.splitlines() if "packaging/docker/requirements.lock" in raw and "constraints.txt" in raw]
    assert make and text.index(make[0]) < text.index(installs[0])
    # what that sed leaves: only pins, one per line, every one of them in the lock
    import subprocess
    sed = re.search(r"- run: (sed .*?) packaging/docker/requirements.lock", make[0]).group(1)
    out = subprocess.run(f"{sed} {ROOT / 'packaging/docker/requirements.lock'}", shell=True, capture_output=True, text=True).stdout
    lines = out.splitlines()
    assert lines and all(re.fullmatch(r"[A-Za-z0-9_.\-]+(\[[a-z,]+\])?==[^\s;]+( ;.*)?", ln) for ln in lines), \
        [ln for ln in lines if not re.fullmatch(r"[A-Za-z0-9_.\-]+==\S+", ln)][:3]


def test_every_job_that_builds_the_web_app_installs_esbuild_first():
    """0.1.111's release run failed in its first job: build_static.py minifies with esbuild (since 2026-10-29), and
    the runner had none. The suite, the App stagers and the add-on repository all build the web app."""
    text = WORKFLOW.read_text()
    for job, step in (("suite", "python -m pytest"), ("app-images", 'python "${{ matrix.app.stager }}"'),
                      ("ha-apps", "python tools/publish_ha_apps.py")):
        start = text.index(f"\n  {job}:\n")
        body = text[start:text.index(step, start)]
        assert "npm ci --prefix tools" in body, f"{job} runs {step} without esbuild"
    tests = (ROOT / ".github/workflows/tests.yml").read_text()
    assert tests.index("npm ci --prefix tools") < tests.index("python -m pytest")
