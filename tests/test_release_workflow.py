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


def test_it_parses_and_runs_on_tags_and_by_hand(wf):
    on = wf[True] if True in wf else wf["on"]  # YAML 1.1 reads the bare key `on` as true
    assert on["push"] == {"tags": ["v*"], "branches": ["release-dry-run"]}
    publish = on["workflow_dispatch"]["inputs"]["publish"]
    assert publish["type"] == "boolean" and publish["default"] is False
    assert wf["permissions"] == {"contents": "write", "packages": "write"}
    jobs = wf["jobs"]
    assert set(jobs) == {"version", "app-images", "docker-images", "ha-apps"}
    assert set(jobs["ha-apps"]["needs"]) == {"version", "app-images", "docker-images"}
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
    rows = wf["jobs"]["docker-images"]["strategy"]["matrix"]["include"]
    assert {r["image"] for r in rows} == DOCKER_IMAGES
    by = {r["image"]: r for r in rows}
    assert (by["mantel-server"]["target"], by["mantel-transcode"]["target"]) == ("server", "transcode")
    assert by["mantel-caddy"]["file"] == "packaging/docker/caddy.Dockerfile"
    dockerfile = (ROOT / "packaging/docker/Dockerfile").read_text()
    assert " AS server" in dockerfile and " AS transcode" in dockerfile
    build = [s for s in wf["jobs"]["docker-images"]["steps"] if str(s.get("uses", "")).startswith("docker/build-push")][0]
    assert build["with"]["platforms"] == "linux/amd64,linux/arm64"
    assert build["with"]["tags"].strip().splitlines() == ["${{ env.REGISTRY }}/${{ matrix.image }}:${{ needs.version.outputs.version }}",
                                             "${{ env.REGISTRY }}/${{ matrix.image }}:latest"]
    assert wf["env"]["REGISTRY"] == pub.REGISTRY == "ghcr.io/jazzphone"


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


def test_a_dry_run_pushes_nothing():
    # every push and every login waits for publish, which is true only for a tag (the version job says so)
    assert TEXT.count("docker/build-push-action@") == 2 and TEXT.count(f"push: {PUBLISH}") == 2
    assert TEXT.count("docker/login-action@") == 2
    assert TEXT.count("- if: needs.version.outputs.publish == 'true'\n        uses: docker/login-action@v3") == 2
    push = TEXT[TEXT.index("git push --force") - 1200:TEXT.index("git push --force")]
    assert "- if: needs.version.outputs.publish == 'true'" in push
    assert 'if [ "$REF_TYPE" != tag ]' in TEXT and "publish=false" in TEXT


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
                   "docker/build-push-action"):
        assert action + "@v" in TEXT


def test_the_event_values_never_reach_a_script_directly():
    # github.ref_name and the inputs go through env: (script injection); only needs/matrix/env/runner/secrets in run:
    for block in re.findall(r"run: \|\n((?:          .*\n)+)", TEXT):
        assert "${{" not in block, block
    assert "${{ github.ref_name }}" in TEXT and "${{ inputs.publish }}" in TEXT
