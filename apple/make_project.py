"""Write apple/Mantel.xcodeproj (docs/phase10/APPLE-APPS.md §10: the Swift code in apple/).

Run: python3 apple/make_project.py
The project lists folders, not files (Xcode's file-system-synchronized groups), so adding a .swift file to a
folder needs no change here; this script only says which folders and settings make each target. Its object ids
are derived from names, so the output is the same every run (a clean diff).

Targets: Mantel (iPhone/iPad app), MantelWidgets (widgets, the music Live Activity, Control Center controls),
MantelNotificationService (opens sealed notifications), MantelMac (the menu bar app) with its own
MantelMacNotificationService (the Mac's copy of that extension). All link MantelKit (a local
Swift package). Signing: automatic with your team (DEVELOPMENT_TEAM, from MANTEL_TEAM_ID); the Mac app with the team once MAC_TEAM_SIGNING is on.
"""
from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "Mantel.xcodeproj" / "project.pbxproj"
VERSION_SOURCE = HERE.parent / "packaging" / "ha-app" / "config.yaml"


def mantel_version() -> str:
    """Mantel's one version (tools/check_version.py: the HA App's config.yaml is the source of truth); the apps ship
    it as MARKETING_VERSION. tools/testflight.py reads it again at archive time, so a bump needs no regeneration."""
    m = re.search(r'(?m)^version:\s*"?(\d+\.\d+\.\d+)"?', VERSION_SOURCE.read_text(encoding="utf-8"))
    if m is None:
        raise SystemExit(f"no version in {VERSION_SOURCE}")
    return m.group(1)


def oid(*parts: str) -> str:
    return hashlib.sha1("/".join(parts).encode()).hexdigest()[:24].upper()


def q(v: str) -> str:
    if v and (all(c.isalnum() or c in "._/-" for c in v) and not v[0].isdigit() or v.replace(".", "").isdigit()):
        return v
    return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'


def value(v, ind=3) -> str:
    pad = "\t" * ind
    if isinstance(v, dict):
        inner = "".join(f"{pad}\t{k} = {value(x, ind + 1)};\n" for k, x in v.items())
        return "{\n" + inner + pad + "}"
    if isinstance(v, list):
        inner = "".join(f"{pad}\t{value(x, ind + 1)},\n" for x in v)
        return "(\n" + inner + pad + ")"
    return q(str(v))


COMMON = {
    "SWIFT_VERSION": "5.0", "CURRENT_PROJECT_VERSION": "1", "MARKETING_VERSION": mantel_version(), "GENERATE_INFOPLIST_FILE": "YES",
    "CODE_SIGN_STYLE": "Automatic", "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
    "DEVELOPMENT_TEAM": os.environ.get("MANTEL_TEAM_ID", ""),   # your Apple team id (not a secret)
    "SWIFT_EMIT_LOC_STRINGS": "YES", "INFOPLIST_KEY_CFBundleDisplayName": "Mantel",
}
IOS = {"SDKROOT": "iphoneos", "IPHONEOS_DEPLOYMENT_TARGET": "18.0", "TARGETED_DEVICE_FAMILY": "1,2",
       "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator", "SUPPORTS_MACCATALYST": "NO"}
EXT = {"SKIP_INSTALL": "YES", "APPLICATION_EXTENSION_API_ONLY": "YES",
       "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks",
       "CODE_SIGN_ENTITLEMENTS": "Config/Extension.entitlements"}
# The Mac app with the team (Config/MacTeam.entitlements: the shared Keychain group, and the App Group named with the
# team's prefix, which macOS allows without a profile or a prompt; Xcode's Mac profile is the team's wildcard one, which
# cannot carry a group.* App Group.). False signs it to run locally (Config/Mac.entitlements: sandbox and network only, the login keychain).
MAC_TEAM_SIGNING = True
PREFIX = "com.jazzphone.mantel"     # the App Group is group.<PREFIX>
# Notifications on the Mac (docs/phase14/SYSTEM-ALERTS.md slice 14.10). The push entitlement
# (com.apple.developer.aps-environment) is in Config/MacTeam.entitlements only: a Mac signed to run locally cannot carry it
# (it needs a provisioning profile), so the app then asks for nothing and its menu says notifications need the signed build.
# The Mac's Notification Service Extension reads the notification key from the shared Keychain group, which only the
# team-signed build has (Config/MacExtension.entitlements); signed locally it is sandboxed and finds another key.
MAC_APS = {"Debug": {"MANTEL_APS_ENVIRONMENT": "development"}, "Release": {"MANTEL_APS_ENVIRONMENT": "production"}}
MAC_EXTENSION_SIGNING = ({"CODE_SIGN_ENTITLEMENTS": "Config/MacExtension.entitlements"} if MAC_TEAM_SIGNING else
                         {"CODE_SIGN_ENTITLEMENTS": "Config/Mac.entitlements", "CODE_SIGN_IDENTITY": "-"})

TARGETS = [
    {"name": "Mantel", "type": "com.apple.product-type.application", "product": "Mantel.app",
     "folders": ["Mantel", "Common", "Shared"], "embeds": ["MantelWidgets", "MantelNotificationService"],
     "settings": {**IOS, "PRODUCT_BUNDLE_IDENTIFIER": f"{PREFIX}.ios", "INFOPLIST_FILE": "Config/Mantel-Info.plist",
                  "CODE_SIGN_ENTITLEMENTS": "Config/Mantel.entitlements", "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
                  "ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME": "AccentColor",
                  "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/Frameworks",
                  "INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents": "YES", "ENABLE_PREVIEWS": "YES"},
     # Config/Mantel.entitlements says aps-environment = $(MANTEL_APS_ENVIRONMENT): the sandbox for a Debug build on your
     # own iPhone, production for Release (TestFlight and the App Store; tools/testflight.py archives Release).
     "config_settings": {"Debug": {"MANTEL_APS_ENVIRONMENT": "development"},
                         "Release": {"MANTEL_APS_ENVIRONMENT": "production"}}},
    {"name": "MantelWidgets", "type": "com.apple.product-type.app-extension", "product": "MantelWidgets.appex",
     "folders": ["MantelWidgets", "Shared"],
     "settings": {**IOS, **EXT, "PRODUCT_BUNDLE_IDENTIFIER": f"{PREFIX}.ios.widgets",
                  "INFOPLIST_FILE": "Config/Widgets-Info.plist", "INFOPLIST_KEY_CFBundleDisplayName": "Mantel Widgets"}},
    {"name": "MantelNotificationService", "type": "com.apple.product-type.app-extension",
     "product": "MantelNotificationService.appex", "folders": ["MantelNotificationService"],
     "settings": {**IOS, **EXT, "PRODUCT_BUNDLE_IDENTIFIER": f"{PREFIX}.ios.notifications",
                  "INFOPLIST_FILE": "Config/NotificationService-Info.plist"}},
    {"name": "MantelMacNotificationService", "type": "com.apple.product-type.app-extension",
     "product": "MantelMacNotificationService.appex", "folders": ["MantelMacNotificationService"],
     "settings": {"SDKROOT": "macosx", "MACOSX_DEPLOYMENT_TARGET": "15.0", "SKIP_INSTALL": "YES",
                  "APPLICATION_EXTENSION_API_ONLY": "YES", "ENABLE_HARDENED_RUNTIME": "YES",
                  "PRODUCT_BUNDLE_IDENTIFIER": f"{PREFIX}.mac.notifications",
                  "INFOPLIST_FILE": "Config/MacNotificationService-Info.plist",
                  # in Contents/PlugIns/<name>.appex/Contents/MacOS: the app's Frameworks are four levels up
                  "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/../Frameworks @executable_path/../../../../Frameworks",
                  **MAC_EXTENSION_SIGNING}},
    {"name": "MantelMac", "type": "com.apple.product-type.application", "product": "MantelMac.app",
     "folders": ["MantelMac", "Common"], "embeds": ["MantelMacNotificationService"], "config_settings": MAC_APS,
     "settings": {"SDKROOT": "macosx", "MACOSX_DEPLOYMENT_TARGET": "15.0", "PRODUCT_BUNDLE_IDENTIFIER": f"{PREFIX}.mac",
                  "INFOPLIST_FILE": "Config/Mac-Info.plist",
                  "PRODUCT_NAME": "Mantel", "LD_RUNPATH_SEARCH_PATHS": "$(inherited) @executable_path/../Frameworks",
                  "ENABLE_HARDENED_RUNTIME": "YES", "COMBINE_HIDPI_IMAGES": "YES",
                  **({"CODE_SIGN_ENTITLEMENTS": "Config/MacTeam.entitlements"} if MAC_TEAM_SIGNING else
                     {"CODE_SIGN_ENTITLEMENTS": "Config/Mac.entitlements", "CODE_SIGN_IDENTITY": "-"})}},
]


def build() -> str:
    objs: dict[str, dict[str, dict]] = {}

    def add(section: str, ident: str, body: dict) -> str:
        objs.setdefault(section, {})[ident] = body
        return ident

    proj = oid("project")
    pkg = add("XCLocalSwiftPackageReference", oid("pkg"), {"isa": "XCLocalSwiftPackageReference", "relativePath": "MantelKit"})
    folders = sorted({f for t in TARGETS for f in t["folders"]} | {"Config"})
    group_ids = {}
    for f in folders:
        if f == "Config":
            continue
        group_ids[f] = add("PBXFileSystemSynchronizedRootGroup", oid("group", f),
                           {"isa": "PBXFileSystemSynchronizedRootGroup", "path": f, "sourceTree": "<group>"})
    config_files = []
    for p in sorted((HERE / "Config").iterdir()):
        if p.suffix in (".plist", ".entitlements"):
            config_files.append(add("PBXFileReference", oid("cfg", p.name), {
                "isa": "PBXFileReference", "lastKnownFileType": "text.plist.xml" if p.suffix == ".plist" else "text.plist.entitlements",
                "path": p.name, "sourceTree": "<group>"}))
    config_group = add("PBXGroup", oid("group", "Config"), {"isa": "PBXGroup", "children": config_files, "path": "Config",
                                                             "sourceTree": "<group>"})
    products = []
    target_ids = {t["name"]: oid("target", t["name"]) for t in TARGETS}
    product_ids = {}
    for t in TARGETS:
        ptype = "wrapper.application" if t["product"].endswith(".app") else "wrapper.app-extension"
        product_ids[t["name"]] = add("PBXFileReference", oid("product", t["name"]), {
            "isa": "PBXFileReference", "explicitFileType": ptype, "includeInIndex": "0", "path": t["product"],
            "sourceTree": "BUILT_PRODUCTS_DIR"})
        products.append(product_ids[t["name"]])
    products_group = add("PBXGroup", oid("group", "Products"), {"isa": "PBXGroup", "children": products, "name": "Products",
                                                                 "sourceTree": "<group>"})
    main_group = add("PBXGroup", oid("group", "main"), {"isa": "PBXGroup",
                                                         "children": [group_ids[f] for f in folders if f != "Config"]
                                                         + [config_group, products_group], "sourceTree": "<group>"})

    def config_list(owner: str, settings: dict, name: str, per_config: dict | None = None) -> str:
        ids = []
        for cfg in ("Debug", "Release"):
            s = {**settings, **(per_config or {}).get(cfg, {})}
            if cfg == "Debug":
                s.setdefault("SWIFT_ACTIVE_COMPILATION_CONDITIONS", "DEBUG $(inherited)")
                s.setdefault("SWIFT_OPTIMIZATION_LEVEL", "-Onone")
                s.setdefault("DEBUG_INFORMATION_FORMAT", "dwarf")
                s.setdefault("ONLY_ACTIVE_ARCH", "YES")
            else:
                s.setdefault("SWIFT_COMPILATION_MODE", "wholemodule")
                s.setdefault("DEBUG_INFORMATION_FORMAT", "dwarf-with-dsym")
            ids.append(add("XCBuildConfiguration", oid("cfg", owner, cfg),
                           {"isa": "XCBuildConfiguration", "buildSettings": dict(sorted(s.items())), "name": cfg}))
        return add("XCConfigurationList", oid("cfglist", owner), {
            "isa": "XCConfigurationList", "buildConfigurations": ids, "defaultConfigurationIsVisible": "0",
            "defaultConfigurationName": "Release"})

    for t in TARGETS:
        n = t["name"]
        dep = add("XCSwiftPackageProductDependency", oid("pkgdep", n), {
            "isa": "XCSwiftPackageProductDependency", "package": pkg, "productName": "MantelKit"})
        fw_file = add("PBXBuildFile", oid("fwfile", n), {"isa": "PBXBuildFile", "productRef": dep})
        phases = [add("PBXSourcesBuildPhase", oid("sources", n), {"isa": "PBXSourcesBuildPhase", "buildActionMask": "2147483647",
                                                                    "files": [], "runOnlyForDeploymentPostprocessing": "0"}),
                  add("PBXFrameworksBuildPhase", oid("frameworks", n), {"isa": "PBXFrameworksBuildPhase",
                                                                         "buildActionMask": "2147483647", "files": [fw_file],
                                                                         "runOnlyForDeploymentPostprocessing": "0"}),
                  add("PBXResourcesBuildPhase", oid("resources", n), {"isa": "PBXResourcesBuildPhase",
                                                                       "buildActionMask": "2147483647", "files": [],
                                                                       "runOnlyForDeploymentPostprocessing": "0"})]
        deps = []
        if t.get("embeds"):
            files = []
            for e in t["embeds"]:
                files.append(add("PBXBuildFile", oid("embedfile", n, e), {
                    "isa": "PBXBuildFile", "fileRef": product_ids[e], "settings": {"ATTRIBUTES": ["RemoveHeadersOnCopy"]}}))
                proxy = add("PBXContainerItemProxy", oid("proxy", n, e), {
                    "isa": "PBXContainerItemProxy", "containerPortal": proj, "proxyType": "1",
                    "remoteGlobalIDString": target_ids[e], "remoteInfo": e})
                deps.append(add("PBXTargetDependency", oid("dep", n, e), {"isa": "PBXTargetDependency",
                                                                          "target": target_ids[e], "targetProxy": proxy}))
            phases.append(add("PBXCopyFilesBuildPhase", oid("embed", n), {
                "isa": "PBXCopyFilesBuildPhase", "buildActionMask": "2147483647", "dstPath": '""', "dstSubfolderSpec": "13",
                "files": files, "name": "Embed Foundation Extensions", "runOnlyForDeploymentPostprocessing": "0"}))
        settings = {**COMMON, **t["settings"]}
        settings.setdefault("PRODUCT_NAME", "$(TARGET_NAME)")
        if t.get("assets"):
            settings["ASSETCATALOG_COMPILER_APPICON_NAME"] = "AppIcon"
        add("PBXNativeTarget", target_ids[n], {
            "isa": "PBXNativeTarget", "buildConfigurationList": config_list(n, settings, n, t.get("config_settings")), "buildPhases": phases,
            "buildRules": [], "dependencies": deps, "fileSystemSynchronizedGroups": [group_ids[f] for f in t["folders"]],
            "name": n, "packageProductDependencies": [dep], "productName": n, "productReference": product_ids[n],
            "productType": t["type"]})
    project_settings = {"ALWAYS_SEARCH_USER_PATHS": "NO", "CLANG_ENABLE_MODULES": "YES", "CLANG_ENABLE_OBJC_ARC": "YES",
                        "ENABLE_STRICT_OBJC_MSGSEND": "YES", "GCC_C_LANGUAGE_STANDARD": "gnu17", "SWIFT_VERSION": "5.0"}
    add("PBXProject", proj, {
        "isa": "PBXProject", "attributes": {"BuildIndependentTargetsInParallel": "1", "LastSwiftUpdateCheck": "2700",
                                            "LastUpgradeCheck": "2700"},
        "buildConfigurationList": config_list("project", project_settings, "project"), "compatibilityVersion": "Xcode 15.0",
        "developmentRegion": "en", "hasScannedForEncodings": "0", "knownRegions": ["en", "Base"], "mainGroup": main_group,
        "minimizedProjectReferenceProxies": "1", "packageReferences": [pkg], "preferredProjectObjectVersion": "77",
        "productRefGroup": products_group, "projectDirPath": '""', "projectRoot": '""',
        "targets": [target_ids[t["name"]] for t in TARGETS]})

    out = ["// !$*UTF8*$!", "{", "\tarchiveVersion = 1;", "\tclasses = {", "\t};", "\tobjectVersion = 77;", "\tobjects = {", ""]
    for section in sorted(objs):
        out.append(f"/* Begin {section} section */")
        for ident, body in sorted(objs[section].items()):
            out.append(f"\t\t{ident} = {value(body, 2)};")
        out.append(f"/* End {section} section */")
        out.append("")
    out += ["\t};", f"\trootObject = {proj};", "}", ""]
    return "\n".join(out).replace('"\\"\\""', '""')


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(build())
    print("wrote", OUT)
