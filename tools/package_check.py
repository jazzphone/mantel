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


def _announcer_ok(path: Path, sname: str, svc: dict) -> bool:
    """Mantel's zeroconf announcer (announce.py) may use the host's network, because multicast never leaves
    Docker's bridges: only in the opt-in compose.announce.yaml, only as `announce`, running as 10001, with no
    secrets, ports, devices or capabilities, and nothing mounted but Mantel's data volume read-only."""
    return (path.name == "compose.announce.yaml" and sname == "announce" and str(svc.get("user")) == "10001:10001"
            and not svc.get("secrets") and not svc.get("ports") and not svc.get("devices") and not svc.get("cap_add")
            and [str(v) for v in _as_list(svc.get("volumes"))] == ["mantel-data:/data:ro"]
            and svc.get("pid") != "host" and svc.get("ipc") != "host")


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
        if svc.get("network_mode") == "host" and _announcer_ok(path, sname, svc):
            pass        # the zeroconf announcer alone, opt-in, sealed (compose.announce.yaml)
        elif svc.get("network_mode") == "host" or svc.get("pid") == "host" or svc.get("ipc") == "host":
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
        if sname == "mantel-server" and "ports" in svc:
            # the Intercom's listener (phase 17): ONE published port, to the container's 8767, never Mantel's own 8765
            # (compose.byo-proxy.yaml adds that one, compose.connect.yaml 8766; each is checked as its own file)
            published = [str(p) for p in _as_list(svc.get("ports"))]
            if len(published) != 1 or not published[0].endswith(":8767") or published[0].count(":") < 2:
                problems.append(f"{where}: publishes ports; it may publish only the Intercom's listener, one port to the "
                                "container's 8767")
        elif sname != "caddy" and "ports" in svc and sname not in ("go2rtc",):
            problems.append(f"{where}: publishes ports; only caddy (443), go2rtc (WebRTC) and mantel-server's Intercom "
                            "listener (8767) may")
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
    """Caddy stamps the door and drops identity headers; it must NOT set a Content-Security-Policy:
    Mantel Server sets its own (security_headers.py) and a second CSP header would be enforced too."""
    text = path.read_text()
    code = "\n".join(line.split("#", 1)[0] for line in text.splitlines())
    problems = []
    if re.search(r"^\s*(?:header\s+)?\??Content-Security-Policy\s", code, re.M | re.I):
        problems.append("Caddyfile: sets a Content-Security-Policy; Mantel Server sets its own "
                        "(security_headers.py) and browsers enforce both")
    if "admin off" not in code:
        problems.append("Caddyfile: the admin API should be off")
    if "X-Mantel-Door" not in code:
        problems.append("Caddyfile: no X-Mantel-Door stamp for the two doors")
    for h in ("X-Remote-User-Id", "X-Remote-User-Name", "X-Remote-User-Display-Name", "X-Ingress-Path", "X-Mantel-Door"):
        if not re.search(rf"request_header\s+-{re.escape(h)}\b", code):
            problems.append(f"Caddyfile: does not delete a client-supplied {h}")
    return problems


def _load_security_headers(path: Path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("_mantel_security_headers", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)          # stdlib only at import time (the module says so)
    return mod


def check_security_headers(path: Path) -> list[str]:
    """Mantel Server's own security headers (hosts/server/mantel_server/security_headers.py), the policy
    every page gets behind any proxy: strict script-src, no eval anywhere, the framing and HSTS rules."""
    name = "security_headers.py"
    try:
        mod = _load_security_headers(path)
    except Exception as exc:  # noqa: BLE001
        return [f"{name}: cannot be loaded without aiohttp ({type(exc).__name__}: {exc})"]
    problems = []
    page, ma = mod.PAGE_POLICY, mod.MA_POLICY
    if tuple(page.get("script-src", ())) != ("'self'",):
        problems.append(f"{name}: the page policy's script-src must be exactly 'self' (got {page.get('script-src')})")
    for label, pol in (("page", page), ("Music Assistant", ma)):
        for d, vals in pol.items():
            if "'unsafe-eval'" in vals or "'wasm-unsafe-eval'" in vals:
                problems.append(f"{name}: the {label} policy's {d} allows eval")
            if d == "script-src" and any(v not in ("'self'", "'unsafe-inline'") for v in vals):
                problems.append(f"{name}: the {label} policy loads scripts from elsewhere: {vals}")
        for need in ("default-src", "frame-ancestors", "base-uri", "object-src"):
            if need not in pol:
                problems.append(f"{name}: the {label} policy lacks {need}")
        if "'none'" not in pol.get("object-src", ()):
            problems.append(f"{name}: the {label} policy's object-src must be 'none'")
    if any(v in ("*", "http:") for v in page.get("img-src", ())):
        problems.append(f"{name}: the page policy's img-src may allow any https image, never plain http: or *")
    if tuple(page.get("frame-ancestors", ())) != ("'self'",) or tuple(ma.get("frame-ancestors", ())) != ("'self'",):
        problems.append(f"{name}: frame-ancestors must default to 'self' (operators add origins explicitly)")
    if "max-age=" not in getattr(mod, "HSTS", ""):
        problems.append(f"{name}: no HSTS max-age")
    for h in ("X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"):
        if h not in mod.STATIC:
            problems.append(f"{name}: missing {h}")
    https = mod.headers_for("/home", None, host="m.example", https=True)
    plain = mod.headers_for("/home", None, host="m.example", https=False)
    ingress = mod.headers_for("/home", None, host="m.example", https=True, ingress=True)
    if "Strict-Transport-Security" not in https or "Strict-Transport-Security" in plain \
            or "Strict-Transport-Security" in ingress:
        problems.append(f"{name}: HSTS must be sent on https only, and never through HA's Ingress")
    return problems


def check_byo_compose(path: Path) -> list[str]:
    """compose.byo-proxy.yaml: Caddy off, ONE published port to Mantel's 8765, the trusted proxy required,
    and Mantel on the tunnel network at Caddy's old address (cloudflared reaches it there, untrusted)."""
    try:
        doc = parse_yaml(path.read_text())
    except YamlSubsetError as exc:
        return [f"{path.name}: outside the supported YAML subset ({exc})"]
    problems = []
    services = doc.get("services") or {}
    if set(services) != {"caddy", "mantel-server"}:
        return [f"{path.name}: only caddy (turned off) and mantel-server may appear"]
    caddy = services["caddy"] or {}
    if set(caddy) != {"profiles"} or not _as_list(caddy.get("profiles")):
        problems.append(f"{path.name}: caddy may only be moved behind a profile (turned off), nothing else")
    svc = services["mantel-server"] or {}
    extra = set(svc) - {"ports", "environment", "networks"}
    if extra:
        problems.append(f"{path.name}: only ports, environment and networks may be added to mantel-server, not {sorted(extra)}")
    ports = _as_list(svc.get("ports"))
    if len(ports) != 1 or not str(ports[0]).endswith(":8765"):
        problems.append(f"{path.name}: exactly one published port, to Mantel's 8765")
    env = svc.get("environment") or {}
    if ":?" not in str(env.get("MANTEL_TRUSTED_PROXY", "")):
        problems.append(f"{path.name}: MANTEL_TRUSTED_PROXY must be required (${{MANTEL_TRUSTED_PROXY:?...}})")
    if str(env.get("MANTEL_PROXY_KIND")) != "own":
        problems.append(f"{path.name}: MANTEL_PROXY_KIND must be own")
    for key in env:
        if SECRETISH.search(str(key)):
            problems.append(f"{path.name}: {key} looks like a secret; secrets are files")
    nets = svc.get("networks") or {}
    if set(nets) - {"tunnel"} or ((nets.get("tunnel") or {}).get("ipv4_address") != "172.31.250.2"):
        problems.append(f"{path.name}: mantel-server may only join the tunnel network, at 172.31.250.2 (Caddy's tunnel address)")
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
    if 'var_tls="${var_tls:-}"' not in text or 'MANTEL_TLS="$var_tls"' not in text:
        problems.append("mantel.sh: must ask for the HTTPS choice (var_tls) and pass it to mantel-install.sh")
    if 'var_dns="${var_dns:-}"' not in text or 'MANTEL_DNS=' not in text:
        problems.append("mantel.sh: must ask for dns01's DNS host (var_dns) and pass it to mantel-install.sh")
    if not re.search(r'^var_install_mode="\$\{var_install_mode:-auto\}"', text, re.M):
        problems.append("mantel.sh: var_install_mode must default to auto (published images, else a build)")
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
    # panel_admin is false (decision 21, docs/phase3/HA-APP.md "Wall tablets through the App"): wall tablets
    # and household members are not HA administrators, and they open Mantel through this panel. Mantel's own
    # links and roles decide what anyone may do; unlinked HA users get nothing, and only an HA administrator
    # (checked with HA itself) can become the first Owner. Stated, not left to the default.
    if doc.get("panel_admin") is not False:
        problems.append("ha-app: panel_admin must be false (wall tablets and household members open the panel)")
    # Direct access (decision 26): an opt-in port, 8100/tcp, and the Intercom's listener (phase 17), 8101/tcp: both
    # unpublished (null) until the Owner maps them, and the access option defaulting to the sidebar only
    ports = doc.get("ports")
    unpublished = {None, "null"}
    if ports is not None and (set(ports) - {"8100/tcp", "8101/tcp"} or any(v not in unpublished for v in ports.values())):
        problems.append("ha-app: the only ports are 8100/tcp (direct access) and 8101/tcp (the Intercom's listener), "
                        "unpublished by default (null)")
    if ports is not None and "8101/tcp" not in ports:
        problems.append("ha-app: the Intercom's listener port 8101/tcp must be declared (null: not published)")
    if ports is not None and set(doc.get("ports_description") or {}) != set(ports):
        problems.append("ha-app: describe each port (direct access, the Intercom's listener) in ports_description")
    if (doc.get("options") or {}).get("access", "ingress") != "ingress":
        problems.append("ha-app: options.access must default to ingress (the sidebar only)")
    for token in ("cloudflare_token", "duckdns_token", "ma_token"):
        if (doc.get("schema") or {}).get(token, "password?") != "password?":
            problems.append(f"ha-app: {token} must be a password-type option (masked in HA's form)")
    if doc.get("homeassistant_api") is not True:
        problems.append("ha-app: homeassistant_api must be true (HA's built-in App credential)")
    for extra in ("auth_api", "hassio_role"):
        if doc.get(extra):
            problems.append(f"ha-app: {extra} is not needed and must not be set")
    # Mantel Link's "Discovered: Mantel" (supervisor_discovery.py): the App announces itself to the Supervisor,
    # which needs hassio_api (the default role, never more) and discovery: [mantel]; one without the other is wrong
    if bool(doc.get("hassio_api")) != (doc.get("discovery") == ["mantel"]):
        problems.append("ha-app: hassio_api is only for Mantel Link's discovery: set both hassio_api: true and "
                        "discovery: [mantel], or neither")
    # control of the house is Mantel Settings' now (server_settings.py), off until an Owner allows it: the App
    # never turns it on by default, and its kill switch (read_only) is there and off
    if (doc.get("options") or {}).get("commands_enabled", False) is not False:
        problems.append("ha-app: options.commands_enabled must not default to on (Mantel Settings has it)")
    if (doc.get("options") or {}).get("read_only") is not False or (doc.get("schema") or {}).get("read_only") != "bool":
        problems.append("ha-app: the read_only kill switch must be a bool option, off by default")
    if "image" in doc:
        problems.append("ha-app: no image: the App is built locally from its Dockerfile (tools/stage_ha_app.py)")
    # HA's backups of /data: a hot copy of a live SQLite WAL database (mantel.db + -wal, copied file by file
    # while Mantel writes) can restore damaged. The Supervisor stops the App for a cold one.
    if doc.get("backup") != "cold":
        problems.append("ha-app: backup must be cold (Home Assistant's backups copy a live SQLite database otherwise)")
    problems += _typed_defaults("ha-app", doc)
    return problems


# HA's Supervisor checks each option's default against its schema type when the App is installed or updated:
# an empty string under email / url / int / float / port / match is refused ("expected an email address"), and
# the update fails (App 0.1.16 on the house, 2026-10-18). Optional typed options must have no empty default.
_TYPED = re.compile(r"^(email|url|int|float|port|match)\b")


def _typed_defaults(label: str, doc: dict) -> list[str]:
    out = []
    schema, options = doc.get("schema") or {}, doc.get("options") or {}
    for key, kind in schema.items():
        if isinstance(kind, str) and _TYPED.match(kind) and options.get(key) in ("", None) and key in options:
            out.append(f"{label}: option {key} ({kind}) has an empty default, which HA's Supervisor refuses")
    return out


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


DNS_WITH = re.compile(r"--with\s+(\S+)")
DNS_VALUE = re.compile(r"^\{file\./run/secrets/([a-z0-9_]+)\}$")


def _snippet_secrets(name: str, text: str, provider: str) -> tuple[list[str], list[str]]:
    """The secret files a tls-dns01 snippet's `dns <provider>` reads, and what is wrong with it: each value
    must be a {file./run/secrets/<name>} placeholder (never a literal credential, never {env.*})."""
    code = [line.split("#", 1)[0].strip() for line in text.splitlines()]
    code = [c for c in code if c]
    problems: list[str] = []
    start = next((i for i, c in enumerate(code) if c.split()[:2] == ["dns", provider]), None)
    if start is None:
        return [], [f"{name}: no `dns {provider}` line"]
    values = code[start].split()[2:]
    if values and values[-1] == "{":
        values = values[:-1]
        for c in code[start + 1:]:
            if c == "}":
                break
            values += c.split()[1:]
    if not values:
        problems.append(f"{name}: `dns {provider}` reads no credential")
    secrets = []
    for v in values:
        m = DNS_VALUE.match(v)
        if not m:
            problems.append(f"{name}: {v[:24]!r} is not a secret file placeholder ({{file./run/secrets/<name>}})")
        else:
            secrets.append(m.group(1))
    return secrets, problems


def check_dns_providers(root: Path = ROOT) -> list[str]:
    """The DNS-01 providers: every caddy-dns module in caddy.Dockerfile is pinned (module@version) and has its
    snippet (caddy/tls-dns01-<provider>.caddy) reading its credentials from secret files only; each provider but
    Cloudflare (whose secret compose.yaml itself carries) has compose.dns-<provider>.yaml, which may only mount
    that snippet and give Caddy exactly those secret files. No snippet or override without a module, and every
    secret file can be written with the LXC's mantel-secret and is listed in secrets/README.md."""
    pkg = root / "packaging"
    compose_dir = pkg / "compose"
    problems: list[str] = []
    modules = DNS_WITH.findall((pkg / "docker/caddy.Dockerfile").read_text())
    providers = []
    for mod in modules:
        path, _, version = mod.partition("@")
        if not re.match(r"^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$", version):
            problems.append(f"caddy.Dockerfile: {path} is not pinned to a version (--with module@vX.Y.Z)")
        m = re.match(r"^github\.com/caddy-dns/([a-z0-9]+)$", path)
        if m:
            providers.append(m.group(1))
    if "cloudflare" not in providers:
        problems.append("caddy.Dockerfile: the Cloudflare module must stay (tls-dns01.caddy, existing installs)")
    base = parse_yaml((compose_dir / "compose.yaml").read_text())
    base_caddy = [str(x) for x in _as_list(((base.get("services") or {}).get("caddy") or {}).get("secrets"))]
    install = (pkg / "lxc/mantel-install.sh").read_text()
    m = re.search(r'^DNS_SECRETS="([^"]*)"', install, re.M)
    install_secrets = set(m.group(1).split()) if m else set()
    if "__DNS_SECRETS__" not in install:
        problems.append("mantel-install.sh: mantel-secret must accept the DNS hosts' secret files (__DNS_SECRETS__)")
    readme = (compose_dir / "secrets/README.md").read_text()
    snippets = {p.name for p in (compose_dir / "caddy").glob("tls-dns01-*.caddy")}
    overrides = {p.name for p in compose_dir.glob("compose.dns-*.yaml")}
    for prov in providers:
        sname = f"tls-dns01-{prov}.caddy"
        snippet = compose_dir / "caddy" / sname
        if not snippet.is_file():
            problems.append(f"caddy.Dockerfile builds {prov} but caddy/{sname} is missing")
            continue
        secrets, found = _snippet_secrets(sname, snippet.read_text(), prov)
        problems += found
        for sec in secrets:
            if sec not in install_secrets:
                problems.append(f"mantel-install.sh: does not prepare the secret file {sec} (DNS_SECRETS; mantel-secret takes those)")
            if f"`{sec}`" not in readme:
                problems.append(f"secrets/README.md: does not list {sec}")
        oname = f"compose.dns-{prov}.yaml"
        if prov == "cloudflare":
            missing = [sec for sec in secrets if sec not in base_caddy]
            if missing:
                problems.append(f"compose.yaml: caddy lacks the secret(s) {missing} that {sname} reads")
            continue
        override = compose_dir / oname
        if not override.is_file():
            problems.append(f"{oname} is missing (it gives Caddy {sname} and its secret files)")
            continue
        try:
            doc = parse_yaml(override.read_text())
        except YamlSubsetError as exc:
            problems.append(f"{oname}: outside the supported YAML subset ({exc})")
            continue
        services = doc.get("services") or {}
        caddy = services.get("caddy") or {}
        if set(services) != {"caddy"} or set(caddy) != {"volumes", "secrets"}:
            problems.append(f"{oname}: may only add volumes and secrets to caddy")
        if [str(v) for v in _as_list(caddy.get("volumes"))] != [f"./caddy/{sname}:/etc/caddy/tls.caddy:ro"]:
            problems.append(f"{oname}: must mount ./caddy/{sname} read-only as /etc/caddy/tls.caddy, and nothing else")
        if sorted(str(x) for x in _as_list(caddy.get("secrets"))) != sorted(secrets):
            problems.append(f"{oname}: caddy's secrets must be exactly what {sname} reads ({sorted(secrets)})")
        top = doc.get("secrets") or {}
        for sec in secrets:
            entry = top.get(sec)
            if not isinstance(entry, dict) or set(entry) != {"file"} or \
                    str(entry["file"]) != f"${{MANTEL_SECRETS_DIR:-/etc/hk/secrets}}/{sec}":
                problems.append(f"{oname}: secret {sec} must be the file ${{MANTEL_SECRETS_DIR:-/etc/hk/secrets}}/{sec}")
        if set(top) - set(secrets):
            problems.append(f"{oname}: declares secrets nothing reads: {sorted(set(top) - set(secrets))}")
    for name in sorted(snippets - {f"tls-dns01-{p}.caddy" for p in providers}):
        problems.append(f"caddy/{name}: no caddy-dns module for it in caddy.Dockerfile")
    for name in sorted(overrides - {f"compose.dns-{p}.yaml" for p in providers if p != "cloudflare"}):
        problems.append(f"{name}: no caddy-dns module for it in caddy.Dockerfile")
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


def _dep_name(spec: str) -> str:
    return re.split(r"[\s<>=!~;\[]", spec.strip(), maxsplit=1)[0].lower().replace("_", "-")


def check_requirements_lock(root: Path = ROOT, release: bool = False) -> list[str]:
    """packaging/docker/requirements.lock: the image installs it with --require-hashes (Dockerfile, deps stage),
    else pyproject's open ranges, whatever PyPI serves that day. A release must have it, and it must pin every
    runtime dependency pyproject names (one added there and not locked would make the image's pip refuse)."""
    import tomllib
    lock = root / "packaging/docker/requirements.lock"
    if not lock.is_file():
        return ["packaging/docker/requirements.lock: missing (pip-compile --generate-hashes; see the Dockerfile)"] \
            if release else []
    deps = tomllib.loads((root / "pyproject.toml").read_text())["project"]["dependencies"]
    text = lock.read_text()
    pinned = {m.group(1).lower().replace("_", "-") for m in re.finditer(r"^([A-Za-z0-9_.-]+)==\S+", text, re.M)}
    problems = [f"requirements.lock: {name} (a pyproject dependency) is not pinned; run pip-compile again"
                for name in sorted({_dep_name(d) for d in deps} - pinned)]
    for m in re.finditer(r"^([A-Za-z0-9_.-]+)==\S+((?:\s*\\\n\s*--hash=sha256:[0-9a-f]{64})*)", text, re.M):
        if "--hash=sha256:" not in m.group(2):
            problems.append(f"requirements.lock: {m.group(1)} has no hash")
    return problems


def run_all(release: bool = False, root: Path = ROOT) -> list[str]:
    pkg = root / "packaging"
    problems: list[str] = []
    problems += check_dockerfile(pkg / "docker/Dockerfile", release)
    problems += check_dockerfile(pkg / "docker/caddy.Dockerfile", release, require_nonroot=False)
    problems += check_compose(pkg / "compose/compose.yaml", release)
    problems += check_caddyfile(pkg / "compose/caddy/Caddyfile")
    problems += check_security_headers(root / "hosts/server/mantel_server/security_headers.py")
    problems += check_byo_compose(pkg / "compose/compose.byo-proxy.yaml")
    problems += check_lxc_script(pkg / "lxc/mantel.sh")
    problems += check_ha_app(pkg / "ha-app/config.yaml")
    problems += check_connect_app(pkg / "connect-app/config.yaml")
    problems += check_connect_compose(pkg / "compose/compose.connect.yaml")
    problems += check_dns_providers(root)
    announce = pkg / "compose/compose.announce.yaml"
    if announce.is_file():
        # the service rules (an overlay has none of the main file's networks to check)
        problems += [p for p in check_compose(announce, release) if p.startswith("compose service ")]
        if set((parse_yaml(announce.read_text()).get("services") or {})) != {"announce"}:
            problems.append("compose.announce.yaml: only the announce service may appear")
    problems += check_requirements_lock(root, release)
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
