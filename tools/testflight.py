#!/usr/bin/env python3
"""Archive Mantel's iPhone/iPad app (with its widgets and notification service extension) for TestFlight.
apple/README.md, "TestFlight".

    python3 tools/testflight.py --dry-run --team ABCDE12345    # archive + a signed .ipa on disk; nothing is uploaded
    python3 tools/testflight.py --team ABCDE12345              # archive + upload to App Store Connect (TestFlight)

What it does, in order:
  1. Reads Mantel's version from packaging/ha-app/config.yaml (MARKETING_VERSION) and picks a build number that
     only ever goes up: `git rev-list --count HEAD` (CURRENT_PROJECT_VERSION; --build N overrides it). The version
     and the build number go on the xcodebuild command line, so every target (app, widgets, notification service)
     carries the same pair, which App Store Connect requires, and the project file needs no edit.
  2. `xcodebuild archive` the "Mantel" scheme, Release, for generic/platform=iOS, automatic signing, with
     -allowProvisioningUpdates (Xcode registers App IDs, the App Group and push, and makes the Apple Distribution
     certificate, as the Apple account signed in to Xcode).
  3. Writes an ExportOptions.plist (method app-store-connect; destination export for --dry-run, upload otherwise)
     and runs `xcodebuild -exportArchive`.
  4. Looks inside the signed app it made (versions, bundle ids, aps-environment, privacy manifests) and prints it.

Your team id: --team, or MANTEL_TEAM_ID / DEVELOPMENT_TEAM in the environment, or, failing those, the
DEVELOPMENT_TEAM your own apple/Mantel.xcodeproj has (the committed project has none: never commit one).
Credentials: none are read, printed or stored here. Xcode signs and uploads as the account signed in to
Xcode > Settings > Apple Accounts; nothing is asked for.

Output goes under a temporary directory outside the repository (--out to choose; the repository ignores /build/).
Stdlib only, like the other tools.
"""
from __future__ import annotations

import argparse
import os
import plistlib
import re
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "apple" / "Mantel.xcodeproj"
VERSION_SOURCE = ROOT / "packaging" / "ha-app" / "config.yaml"
SCHEME = "Mantel"
BUNDLE_ID = "com.jazzphone.mantel.ios"
EXTENSIONS = ("com.jazzphone.mantel.ios.widgets", "com.jazzphone.mantel.ios.notifications")
TEAM_ID = re.compile(r"^[A-Z0-9]{10}$")


def version() -> str:
    m = re.search(r'(?m)^version:\s*"?(\d+\.\d+\.\d+)"?', VERSION_SOURCE.read_text(encoding="utf-8"))
    if m is None:
        raise SystemExit(f"no version in {VERSION_SOURCE}")
    return m.group(1)


def build_number() -> str:
    out = subprocess.run(["git", "-C", str(ROOT), "rev-list", "--count", "HEAD"], capture_output=True, text=True)
    if out.returncode != 0 or not out.stdout.strip().isdigit():
        raise SystemExit("could not count commits for the build number: pass --build N")
    return out.stdout.strip()


def project_team() -> str:
    """The DEVELOPMENT_TEAM in the local project file, if its owner has put one there (never committed)."""
    text = (PROJECT / "project.pbxproj").read_text(encoding="utf-8")
    teams = set(re.findall(r'DEVELOPMENT_TEAM = "?([A-Z0-9]{10})"?;', text))
    return teams.pop() if len(teams) == 1 else ""


def find_team(flag: str | None) -> str:
    team = flag or os.environ.get("MANTEL_TEAM_ID") or os.environ.get("DEVELOPMENT_TEAM") or project_team()
    if not team:
        raise SystemExit("no team id: pass --team ABCDE12345 (your Apple Developer team), or set MANTEL_TEAM_ID")
    if not TEAM_ID.match(team):
        raise SystemExit(f"{team!r} is not a team id (ten letters and digits)")
    return team


def export_options(team: str, upload: bool) -> bytes:
    return plistlib.dumps({
        "method": "app-store-connect",
        "destination": "upload" if upload else "export",
        "signingStyle": "automatic",
        "teamID": team,
        "uploadSymbols": True,                  # the dSYMs, so TestFlight crash reports are symbolicated
        "manageAppVersionAndBuildNumber": False,  # keep the build number this script chose
    })


def run(step: str, cmd: list[str], log: Path) -> None:
    """Run one xcodebuild, its output to `log`; on failure show the errors and stop."""
    print(f"==> {step}", flush=True)
    start = time.time()
    with log.open("w") as f:
        rc = subprocess.run(cmd, stdout=f, stderr=subprocess.STDOUT).returncode
    if rc != 0:
        lines = log.read_text(errors="replace").splitlines()
        errors = [ln for ln in lines if re.search(r"error:|\*\* .* FAILED|Error Domain|requires|No profile|No signing", ln)]
        print(f"\n{step} failed (exit {rc}). Log: {log}", file=sys.stderr)
        print("\n".join((errors or lines)[-25:]), file=sys.stderr)
        if any("No Accounts" in ln or "missing Xcode-Username" in ln for ln in lines):
            print("\nXcode has no usable Apple account in this login session, so it cannot make the distribution certificate "
                  "or the App Store profiles. Sign in (or remove and re-add the account) at Xcode > Settings > Apple "
                  "Accounts, as the account that owns the team, then run this again.", file=sys.stderr)
        raise SystemExit(1)
    print(f"    done in {time.time() - start:.0f}s (log: {log})", flush=True)


def inspect(ipa: Path) -> None:
    """What went into the .ipa: the checks a TestFlight upload would otherwise tell you about a few minutes later."""
    with tempfile.TemporaryDirectory(prefix="mantel-ipa-") as tmp, zipfile.ZipFile(ipa) as z:
        z.extractall(tmp)
        app = next(Path(tmp, "Payload").glob("*.app"))
        bundles = [app, *sorted((app / "PlugIns").glob("*.appex"))]
        print(f"==> {ipa.name}: {ipa.stat().st_size / 1e6:.1f} MB")
        for b in bundles:
            info = plistlib.loads((b / "Info.plist").read_bytes())
            ents = subprocess.run(["codesign", "-d", "--entitlements", "-", "--xml", str(b)], capture_output=True)
            ent = plistlib.loads(ents.stdout) if ents.stdout.strip().startswith(b"<?xml") else {}
            privacy = "PrivacyInfo.xcprivacy" if (b / "PrivacyInfo.xcprivacy").exists() else "NO privacy manifest"
            print(f"    {info['CFBundleIdentifier']}  {info['CFBundleShortVersionString']} ({info['CFBundleVersion']})  "
                  f"aps-environment={ent.get('aps-environment', '-')}  groups={ent.get('com.apple.security.application-groups', '-')}  "
                  f"{privacy}")
        app_info = plistlib.loads((app / "Info.plist").read_bytes())
        if app_info.get("ITSAppUsesNonExemptEncryption") is not False:
            print("    WARNING: ITSAppUsesNonExemptEncryption is not NO", file=sys.stderr)
        if not (app / "Assets.car").exists():
            print("    WARNING: no Assets.car (the app icon would be missing)", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--team", help="your Apple Developer team id (else MANTEL_TEAM_ID / DEVELOPMENT_TEAM, else the local project's)")
    p.add_argument("--dry-run", action="store_true", help="archive and export a signed .ipa locally; upload nothing")
    p.add_argument("--build", help="the build number (default: the commit count, which only goes up)")
    p.add_argument("--out", type=Path, help="where archives and exports go (default: a temp directory outside the repository)")
    a = p.parse_args(argv)

    team = find_team(a.team)
    ver = version()
    build = a.build or build_number()
    if not build.isdigit():
        raise SystemExit(f"--build {build!r} is not a whole number")
    out = (a.out or Path(tempfile.gettempdir()) / "mantel-testflight").resolve() / f"{ver}-{build}"
    out.mkdir(parents=True, exist_ok=True)
    archive, export, derived = out / "Mantel.xcarchive", out / "export", out / "DerivedData"
    dirty = subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain", "--untracked-files=no"], capture_output=True, text=True).stdout
    print(f"Mantel {ver} build {build}, team {team}, {'dry run: nothing is uploaded' if a.dry_run else 'UPLOAD to App Store Connect'}")
    if dirty.strip():
        print("    note: the working tree has uncommitted changes; build " + build + " will not match one commit", file=sys.stderr)

    options = out / "ExportOptions.plist"
    options.write_bytes(export_options(team, upload=not a.dry_run))
    signing = ["-allowProvisioningUpdates"]
    run("archive (Release, generic/platform=iOS)", [
        "xcodebuild", "archive", "-project", str(PROJECT), "-scheme", SCHEME, "-configuration", "Release",
        "-destination", "generic/platform=iOS", "-archivePath", str(archive), "-derivedDataPath", str(derived), *signing,
        f"DEVELOPMENT_TEAM={team}", f"MARKETING_VERSION={ver}", f"CURRENT_PROJECT_VERSION={build}", "CODE_SIGN_STYLE=Automatic",
    ], out / "archive.log")
    run("export (app-store-connect, " + ("upload" if not a.dry_run else "local .ipa") + ")", [
        "xcodebuild", "-exportArchive", "-archivePath", str(archive), "-exportPath", str(export),
        "-exportOptionsPlist", str(options), *signing,
    ], out / "export.log")

    if a.dry_run:
        ipas = sorted(export.glob("*.ipa"))
        if not ipas:
            print(f"export finished but there is no .ipa in {export}", file=sys.stderr)
            return 1
        inspect(ipas[0])
        print(f"\nThe signed .ipa: {ipas[0]}\nNothing was uploaded. Without --dry-run the same steps upload build {build} to TestFlight.")
    else:
        print(f"\nUploaded Mantel {ver} ({build}). It shows in App Store Connect > TestFlight after Apple's processing (minutes).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
