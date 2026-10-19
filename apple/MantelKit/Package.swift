// swift-tools-version:6.0
// MantelKit: what Mantel's iPhone, iPad and Mac apps share (docs/phase10/APPLE-APPS.md §9): the house's
// addresses and pin, sign-in (PKCE), the device key and DPoP proofs, the Keychain, the API client, discovery,
// sealed notifications and the widgets' shared cache.
import PackageDescription

let package = Package(
    name: "MantelKit",
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [.library(name: "MantelKit", targets: ["MantelKit"])],
    targets: [
        .target(name: "MantelKit"),
        .testTarget(name: "MantelKitTests", dependencies: ["MantelKit"], resources: [.copy("Fixtures")]),
    ],
    swiftLanguageModes: [.v5]
)
