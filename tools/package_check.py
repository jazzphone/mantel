#!/usr/bin/env python3
"""Static checks on the packaging (PLAN §7, §8). No Docker, no network, no YAML library.

    python tools/package_check.py            # development: placeholders for image digests are allowed
    python tools/package_check.py --release  # also refuses unpinned placeholder digests (all-zero sha256)

Exit status 0 = clean, 1 = findings (printed one per line). tests/test_packaging.py runs the same
functions; each returns a list of human-readable problems.

What it proves is only what can be read from the files: that the hardening is *declared*. It cannot prove
the image builds or that Docker honours it; docs/phase3/PACKAGING.md lists what needs Docker.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PKG = ROOT / "packaging"
ZERO_DIGEST = "sha256:" + "0" * 64
SECRETISH = re.compile(r"(TOKEN|SECRET|PASSW(OR)?D|PASSWD|API_?KEY|PRIVATE|CREDENTIAL|_KEY$)", re.I)
TOKEN_VALUE = re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|"
                         r"-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}")


# ---------------------------------------------------------------------------------------------------
# A deliberately small YAML subset reader (compose.yaml is written to stay inside it)
# ---------------------------------------------------------------------------------------------------
class YamlSubsetError(ValueError):
    pass


def _strip_comment(line: str) -> str:
    quote = None
    for i, ch in enumerate(line):
        if quote:
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch == "#" and (i == 0 or line[i - 1] in " \t"):
            return line[:i]
    return line


def _split_flow(inner: str) -> list[str]:
    parts, buf, quote, depth = [], "", None, 0
    for ch in inner:
        if quote:
            buf += ch
            quote = None if ch == quote else quote
        elif ch in "\"'":
            quote = ch
            buf += ch
        elif ch in "[{":
            depth += 1
            buf += ch
        elif ch in "]}":
            depth -= 1
            buf += ch
        elif ch == "," and depth == 0:
            parts.append(buf.strip())
            buf = ""
        else:
            buf += ch
    if buf.strip():
        parts.append(buf.strip())
    return parts


def _scalar(text: str):
    text = text.strip()
    if text.startswith("[") and text.endswith("]"):
        return [_scalar(p) for p in _split_flow(text[1:-1])]
    if text.startswith("{") and text.endswith("}"):
        inner = text[1:-1].strip()
        if inner:
            raise YamlSubsetError(f"flow maps with content are not supported: {text}")
        return {}
    if len(text) >= 2 and text[0] == text[-1] and text[0] in "\"'":
        return text[1:-1]
    if text in ("true", "True"):
        return True
    if text in ("false", "False"):
        return False
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    if re.fullmatch(r"-?\d+\.\d+", text):
        return float(text)
    if text and text[0] in "&*!|>" or text.startswith("<<"):
        raise YamlSubsetError(f"unsupported YAML construct: {text[:20]}")
    return text


def parse_yaml(text: str):
    lines = []
    for raw in text.splitlines():
        line = _strip_comment(raw).rstrip()
        if line.strip() and not line.strip() == "---":
            if "\t" in line[: len(line) - len(line.lstrip())]:
                raise YamlSubsetError("tabs in indentation")
            lines.append((len(line) - len(line.lstrip()), line.strip()))
    pos = 0

    def block(indent: int):
        nonlocal pos
        if pos >= len(lines):
            return None
        if lines[pos][1].startswith("- "):
            out = []
            while pos < len(lines) and lines[pos][0] == indent and lines[pos][1].startswith("- "):
                item = lines[pos][1][2:].strip()
                if re.match(r"^[A-Za-z_][\w.-]*:(\s|$)", item):  # a list of maps: "- key: v" plus deeper lines
                    lines[pos] = (indent + 2, item)
                    out.append(block(indent + 2))
                    continue
                out.append(_scalar(item))
                pos += 1
            return out
        out = {}
        while pos < len(lines) and lines[pos][0] == indent:
            content = lines[pos][1]
            m = re.match(r"^((?:\"[^\"]*\"|'[^']*'|[^\s:][^:]*?)):(?:\s+(.*))?$", content)
            if not m:
                raise YamlSubsetError(f"cannot read: {content}")
            key = m.group(1).strip("\"'")
            rest = (m.group(2) or "").strip()
            pos += 1
            if rest:
                out[key] = _scalar(rest)
            elif pos < len(lines) and (lines[pos][0] > indent or (lines[pos][0] == indent and lines[pos][1].startswith("- "))):
                out[key] = block(lines[pos][0])
            else:
                out[key] = None
        if pos < len(lines) and lines[pos][0] > indent:
            raise YamlSubsetError(f"unexpected indentation at: {lines[pos][1]}")
        return out

    return block(lines[0][0]) if lines else {}


# ---------------------------------------------------------------------------------------------------
# Dockerfile
# ---------------------------------------------------------------------------------------------------
def dockerfile_instructions(text: str) -> list[tuple[str, str]]:
    """[(INSTRUCTION, arguments)] with continuation lines joined and comments dropped."""
    out, buf = [], ""
    for raw in text.splitlines():
        line = raw.strip()
        if not buf and (not line or line.startswith("#")):
            continue
        if buf and line.startswith("#"):
            continue
        if line.endswith("\\"):
            buf += line[:-1] + " "
            continue
        buf += line
        word, _, args = buf.partition(" ")
        out.append((word.upper(), args.strip()))
        buf = ""
    return out


def check_dockerfile(path: Path, release: bool = False, require_nonroot: bool = True) -> list[str]:
    name = path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else str(path)
    problems: list[str] = []
    ins = dockerfile_instructions(path.read_text())
    args = {}
    stages: list[dict] = []
    for word, rest in ins:
        if word == "ARG":
            k, _, v = rest.partition("=")
            args[k.strip()] = v.strip()
        if word == "FROM":
            m = re.match(r"(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?$", rest, re.I)
            if not m:
                problems.append(f"{name}: cannot read FROM {rest}")
                continue
            ref = re.sub(r"\$\{(\w+)\}", lambda g: args.get(g.group(1), ""), m.group(1))
            stages.append({"ref": ref, "name": (m.group(2) or "").lower(), "user": None, "healthcheck": False})
            continue
        if not stages:
            continue
        st = stages[-1]
        if word == "USER":
            st["user"] = rest.split(":")[0].strip()
        elif word == "HEALTHCHECK" and not rest.upper().startswith("NONE"):
            st["healthcheck"] = True
        if word in ("ENV", "ARG"):
            for key in re.findall(r"(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=", rest if word == "ENV" else rest.split("=")[0] + "="):
                if SECRETISH.search(key):
                    problems.append(f"{name}: {word} {key} looks like a secret; secrets are files at run time")
            if word == "ENV" and TOKEN_VALUE.search(rest):
                problems.append(f"{name}: ENV carries something shaped like a credential")
        if word in ("COPY", "ADD"):
            if re.search(r"(^|[\s/])(\.env(\.[\w-]+)?|secrets?|[\w.-]*\.(key|pem)|[\w.-]*token[\w.-]*)(\s|$)", rest, re.I):
                problems.append(f"{name}: {word} {rest} copies a secret-looking path into the image")
            if word == "ADD" and re.search(r"https?://", rest):
                problems.append(f"{name}: ADD from a URL; use a pinned COPY --from or a verified download")
        if word == "RUN" and re.search(r"(curl|wget)[^|]*\|\s*(ba)?sh", rest):
            problems.append(f"{name}: RUN pipes a download into a shell")
        if TOKEN_VALUE.search(rest):
            problems.append(f"{name}: {word} line contains something shaped like a credential")
    if not stages:
        return [f"{name}: no FROM"]
    stage_names = {s["name"] for s in stages if s["name"]}
    for s in stages:
        if s["ref"] in stage_names or s["ref"] == "scratch":
            continue
        if "@sha256:" not in s["ref"]:
            problems.append(f"{name}: FROM {s['ref'] or '(empty)'} is not pinned by digest")
        elif release and ZERO_DIGEST in s["ref"]:
            problems.append(f"{name}: FROM {s['ref'].split('@')[0]} still has the placeholder digest (pin it; see the file's header)")
    last = stages[-1]
    if require_nonroot:
        if last["user"] in (None, "root", "0"):
            problems.append(f"{name}: the final stage ({last['name'] or 'unnamed'}) does not set a non-root USER")
        for s in stages:
            if s["user"] in ("root", "0") and s["name"] != "app":
                problems.append(f"{name}: stage {s['name'] or '(unnamed)'} sets USER root; only the 'app' stage may (it drops privileges itself)")
    if not last["healthcheck"]:
        problems.append(f"{name}: the final stage has no HEALTHCHECK")
    for s in stages:
        if s["name"] in ("transcode", "app") and not s["healthcheck"]:
            problems.append(f"{name}: stage {s['name']} has no HEALTHCHECK")
    return problems


# ---------------------------------------------------------------------------------------------------
# Compose
# ---------------------------------------------------------------------------------------------------
def _as_list(value) -> list:
    return value if isinstance(value, list) else ([] if value in (None, {}) else [value])


def check_compose(path: Path, release: bool = False) -> list[str]:
    problems: list[str] = []
    try:
        doc = parse_yaml(path.read_text())
    except YamlSubsetError as exc:
        return [f"{path.name}: outside the supported YAML subset ({exc}); keep it plain so it can be checked"]
    services = doc.get("services") or {}
    networks = doc.get("networks") or {}
    top_secrets = doc.get("secrets") or {}
    for sname, svc in services.items():
        svc = svc or {}
        where = f"compose service {sname}"
        if "ALL" not in [str(c).upper() for c in _as_list(svc.get("cap_drop"))]:
            problems.append(f"{where}: cap_drop must include ALL")
        if not any(str(o).replace("=", ":").startswith("no-new-privileges:true") for o in _as_list(svc.get("security_opt"))):
            problems.append(f"{where}: security_opt must include no-new-privileges:true")
        if svc.get("read_only") is not True:
            problems.append(f"{where}: read_only must be true")
        if not svc.get("mem_limit"):
            problems.append(f"{where}: no mem_limit")
        if not svc.get("cpus"):
            problems.append(f"{where}: no cpus limit")
        if svc.get("privileged") is True:
            problems.append(f"{where}: privileged")
        if svc.get("network_mode") == "host" or svc.get("pid") == "host" or svc.get("ipc") == "host":
            problems.append(f"{where}: shares a host namespace")
        added = [str(c).upper() for c in _as_list(svc.get("cap_add"))]
        if added and not (sname == "caddy" and added == ["NET_BIND_SERVICE"]):
            problems.append(f"{where}: cap_add {added} (only caddy may add NET_BIND_SERVICE)")
        for vol in _as_list(svc.get("volumes")):
            if "docker.sock" in str(vol):
                problems.append(f"{where}: mounts the Docker socket")
            if str(vol).startswith(("/:", "/etc:", "/var:", "/root:", "/home:")):
                problems.append(f"{where}: bind-mounts a host system directory: {vol}")
        if any("/dev/dri" in str(d) for d in _as_list(svc.get("devices"))):
            problems.append(f"{where}: /dev/dri belongs in compose.gpu.yaml, which is optional by design")
        env = svc.get("environment") or {}
        env_items = env.items() if isinstance(env, dict) else [tuple(str(e).split("=", 1)) + ("",) for e in env]
        for key, val in env_items:
            if SECRETISH.search(str(key)) and not str(key).endswith("_FILE"):
                problems.append(f"{where}: environment {key} looks like a secret; use a secret file")
            if TOKEN_VALUE.search(str(val)):
                problems.append(f"{where}: environment {key} holds something shaped like a credential")
        image = str(svc.get("image", ""))
        if release and ZERO_DIGEST in image:
            problems.append(f"{where}: image still has the placeholder digest")
        if sname != "caddy" and "ports" in svc and sname not in ("go2rtc",):
            problems.append(f"{where}: publishes ports; only caddy (443) and go2rtc (WebRTC) may")
        if "healthcheck" not in svc and sname != "cloudflared":
            problems.append(f"{where}: no healthcheck")
        for ref in _as_list(svc.get("secrets")):
            if str(ref) not in top_secrets:
                problems.append(f"{where}: uses undeclared secret {ref}")
    for name, sec in top_secrets.items():
        sec = sec or {}
        if "environment" in sec or "file" not in sec:
            problems.append(f"compose secret {name}: must be a file (file:), never an environment variable")
    # networks: cloudflared sits on the internal tunnel network with caddy only
    on = {n: {s for s, v in services.items() if n in (v or {}).get("networks", {}) or n in _as_list((v or {}).get("networks"))}
          for n in networks}
    cf = services.get("cloudflared")
    if cf is not None:
        if set(on.get("tunnel", ())) != {"caddy", "cloudflared"}:
            problems.append(f"network tunnel must hold exactly caddy and cloudflared, has {sorted(on.get('tunnel', ()))}")
        if (networks.get("tunnel") or {}).get("internal") is not True:
            problems.append("network tunnel must be internal: true")
        for n, members in on.items():
            if "cloudflared" in members and n not in ("tunnel", "cf_out"):
                problems.append(f"cloudflared is on network {n}; it may only share the tunnel network with caddy")
        if on.get("cf_out", set()) - {"cloudflared"}:
            problems.append("network cf_out (cloudflared's outbound) must hold cloudflared alone")
        if "tunnel" not in (_as_list(cf.get("profiles")) and ["tunnel"]):
            problems.append("cloudflared must be optional (profiles: [tunnel])")
    if (networks.get("backend") or {}).get("internal") is not True:
        problems.append("network backend must be internal: true")
    if "mantel-server" in on.get("tunnel", set()) or "go2rtc" in on.get("tunnel", set()):
        problems.append("only caddy and cloudflared may be on the tunnel network")
    return problems


# ---------------------------------------------------------------------------------------------------
# Caddyfile, LXC script, HA App, repository hygiene
# ---------------------------------------------------------------------------------------------------
def check_caddyfile(path: Path) -> list[str]:
    text = path.read_text()
    problems = []
    csp = re.search(r'Content-Security-Policy\s+"([^"]+)"', text)
    if not csp:
        return ["Caddyfile: no Content-Security-Policy"]
    policy = csp.group(1)
    directives = {d.split()[0]: d.split()[1:] for d in policy.split(";") if d.strip()}
    if directives.get("script-src") != ["'self'"]:
        problems.append(f"Caddyfile: script-src must be exactly 'self' (got {directives.get('script-src')})")
    for d, vals in directives.items():
        if "'unsafe-eval'" in vals or (d.startswith("script") and "'unsafe-inline'" in vals):
            problems.append(f"Caddyfile: CSP {d} allows unsafe scripting")
    for need in ("default-src", "frame-ancestors", "base-uri", "object-src"):
        if need not in directives:
            problems.append(f"Caddyfile: CSP lacks {need}")
    for header in ("Strict-Transport-Security", "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"):
        if header not in text:
            problems.append(f"Caddyfile: missing {header}")
    if "admin off" not in text:
        problems.append("Caddyfile: the admin API should be off")
    if "X-Mantel-Door" not in text:
        problems.append("Caddyfile: no X-Mantel-Door stamp for the two doors")
    return problems


def check_lxc_script(path: Path) -> list[str]:
    text = path.read_text()
    problems = []
    if not re.search(r'^var_unprivileged="\$\{var_unprivileged:-1\}"', text, re.M):
        problems.append("mantel.sh: var_unprivileged must default to 1")
    if re.search(r"--unprivileged\s+0|unprivileged:\s*0|var_unprivileged=0", text):
        problems.append("mantel.sh: a privileged container is configured somewhere")
    if "--unprivileged \"$var_unprivileged\"" not in text:
        problems.append("mantel.sh: pct create must pass --unprivileged \"$var_unprivileged\"")
    if not re.search(r'^var_gpu="\$\{var_gpu:-yes\}"', text, re.M):
        problems.append("mantel.sh: var_gpu must default to yes")
    if not re.search(r'^var_os="\$\{var_os:-debian\}"', text, re.M) or not re.search(r'^var_version="\$\{var_version:-13\}"', text, re.M):
        problems.append("mantel.sh: must default to Debian 13")
    if "set -euo pipefail" not in text:
        problems.append("mantel.sh: no 'set -euo pipefail'")
    for name in ("variables", "update_script", "build_container", "description"):
        if not re.search(rf"^{name}\(\)", text, re.M):
            problems.append(f"mantel.sh: community-scripts layout needs {name}()")
    for script in (path, path.with_name("mantel-install.sh")):
        body = script.read_text()
        if re.search(r"(curl|wget)[^\n|]*\|\s*(ba)?sh", body) or re.search(r"bash\s+<\(\s*curl", body):
            problems.append(f"{script.name}: pipes a download into a shell")
        if TOKEN_VALUE.search(body):
            problems.append(f"{script.name}: contains something shaped like a credential")
        if "docker.sock" in body and script.name == "mantel-install.sh":
            problems.append(f"{script.name}: touches the Docker socket")
    return problems


def check_ha_app(path: Path) -> list[str]:
    doc = parse_yaml(path.read_text())
    problems = []
    if doc.get("ingress") is not True:
        problems.append("ha-app: ingress must be true")
    for bad in ("host_network", "full_access", "privileged", "devices", "docker_api", "host_pid", "host_dbus"):
        if doc.get(bad):
            problems.append(f"ha-app: {bad} must not be set")
    # panel_admin starts true (the first Owner must be an HA administrator; docs/phase3/HA-APP.md) and
    # may become false once the household is linked: either way Mantel's own roles decide what anyone
    # may do, and unlinked HA users get nothing. It must be stated, not left to the default.
    if not isinstance(doc.get("panel_admin"), bool):
        problems.append("ha-app: panel_admin must be set to true or false")
    if "ports" in doc or "ports_description" in doc:
        problems.append("ha-app: publishes ports; Ingress is the only way in")
    if doc.get("homeassistant_api") is not True:
        problems.append("ha-app: homeassistant_api must be true (HA's built-in App credential)")
    for extra in ("hassio_api", "auth_api", "hassio_role"):
        if doc.get(extra):
            problems.append(f"ha-app: {extra} is not needed and must not be set")
    if (doc.get("options") or {}).get("commands_enabled") is not False:
        problems.append("ha-app: options.commands_enabled must default to false")
    if "image" in doc:
        problems.append("ha-app: no image: the App is built locally from its Dockerfile (tools/stage_ha_app.py)")
    return problems


def check_connect_app(path: Path) -> list[str]:
    """The Mantel Connect App (packaging/connect-app): Ingress only, no HA/Supervisor API, nothing mapped,
    the pairing code a masked option that defaults to empty."""
    doc = parse_yaml(path.read_text())
    problems = []
    if doc.get("ingress") is not True:
        problems.append("connect-app: ingress must be true")
    for bad in ("host_network", "full_access", "privileged", "devices", "docker_api", "host_pid", "host_dbus",
                "homeassistant_api", "hassio_api", "auth_api", "hassio_role", "map", "ports", "ports_description",
                "image"):
        if doc.get(bad):
            problems.append(f"connect-app: {bad} must not be set (Ingress is the only way in; nothing else is needed)")
    if not isinstance(doc.get("panel_admin"), bool):
        problems.append("connect-app: panel_admin must be set to true or false")
    if doc.get("boot") != "auto" or not doc.get("watchdog"):
        problems.append("connect-app: a persistent service needs boot: auto and a watchdog URL")
    if (doc.get("schema") or {}).get("pairing_code") != "password?":
        problems.append("connect-app: pairing_code must be a password-type option (masked in HA's form)")
    if (doc.get("options") or {}).get("pairing_code") not in ("", None):
        problems.append("connect-app: options.pairing_code must default to empty")
    return problems


def check_connect_compose(path: Path) -> list[str]:
    """compose.connect.yaml adds exactly one published port (8766) and the switch that turns Connect on."""
    doc = parse_yaml(path.read_text())
    problems = []
    services = doc.get("services") or {}
    if set(services) != {"mantel-server"}:
        problems.append("compose.connect.yaml: only mantel-server may appear")
        return problems
    svc = services["mantel-server"]
    if set(svc) - {"environment", "ports"}:
        problems.append(f"compose.connect.yaml: only environment and ports may be added, not {sorted(set(svc) - {'environment', 'ports'})}")
    ports = svc.get("ports") or []
    if len(ports) != 1 or not str(ports[0]).endswith(":8766"):
        problems.append("compose.connect.yaml: exactly one published port, to container port 8766")
    env = svc.get("environment") or {}
    if str(env.get("MANTEL_CONNECT")) != "1":
        problems.append("compose.connect.yaml: MANTEL_CONNECT must be 1")
    for key in env:
        if SECRETISH.search(key):
            problems.append(f"compose.connect.yaml: {key} looks like a secret; secrets are files")
    return problems


def check_no_committed_secrets(root: Path = ROOT) -> list[str]:
    """No real .env, no secret files in packaging/, no token-shaped text in the packaging tree."""
    problems = []
    for base in (root, root / "packaging", root / "packaging" / "compose"):
        for p in base.iterdir() if base.is_dir() else []:
            if p.is_file() and (p.name == ".env" or (p.name.startswith(".env.") and p.name != ".env.example")):
                problems.append(f"{p.relative_to(root)}: a real .env must never be committed")
    example = root / "packaging/compose/.env.example"
    if example.is_file():
        for n, line in enumerate(example.read_text().splitlines(), 1):
            m = re.match(r"^([A-Z0-9_]+)=(.*)$", line.strip())
            if m and SECRETISH.search(m.group(1)) and m.group(2) and not m.group(1).endswith(("_FILE", "_DIR")):
                problems.append(f".env.example:{n}: {m.group(1)} has a value; secrets are files")
    secrets_dir = root / "packaging/compose/secrets"
    if secrets_dir.is_dir():
        for p in secrets_dir.iterdir():
            if p.name != "README.md":
                problems.append(f"packaging/compose/secrets/{p.name}: only README.md belongs in this folder")
    for p in (root / "packaging").rglob("*"):
        if p.is_file() and p.suffix in {".sh", ".yaml", ".yml", ".py", ".md", ".caddy", ".env", ""} or p.name in ("Dockerfile", "Caddyfile"):
            if "proof4" in p.parts or "mantel-connect" in p.parts or not p.is_file():
                continue
            try:
                text = p.read_text()
            except (UnicodeDecodeError, OSError):
                continue
            if TOKEN_VALUE.search(text):
                problems.append(f"{p.relative_to(root)}: contains something shaped like a credential")
    return problems


def run_all(release: bool = False, root: Path = ROOT) -> list[str]:
    pkg = root / "packaging"
    problems: list[str] = []
    problems += check_dockerfile(pkg / "docker/Dockerfile", release)
    problems += check_dockerfile(pkg / "docker/caddy.Dockerfile", release, require_nonroot=False)
    problems += check_compose(pkg / "compose/compose.yaml", release)
    problems += check_caddyfile(pkg / "compose/caddy/Caddyfile")
    problems += check_lxc_script(pkg / "lxc/mantel.sh")
    problems += check_ha_app(pkg / "ha-app/config.yaml")
    problems += check_connect_app(pkg / "connect-app/config.yaml")
    problems += check_connect_compose(pkg / "compose/compose.connect.yaml")
    problems += check_no_committed_secrets(root)
    return problems


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--release", action="store_true", help="also refuse placeholder image digests")
    a = p.parse_args(argv)
    problems = run_all(a.release)
    for line in problems:
        print(line)
    print(f"package_check: {len(problems)} problem(s)" if problems else "package_check: clean")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
