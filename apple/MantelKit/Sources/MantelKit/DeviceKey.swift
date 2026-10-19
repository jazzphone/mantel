import CryptoKit
import Foundation

/// The key an app credential is bound to (docs/phase10/APPLE-APPS.md §3): made in the Secure Enclave where there
/// is one, so it can never leave the device. The Simulator has none; there a software key kept in the Keychain
/// stands in (said plainly in `isHardwareBacked`).
public final class DeviceKey: @unchecked Sendable {
    private enum Backing {
        case enclave(SecureEnclave.P256.Signing.PrivateKey)
        case software(P256.Signing.PrivateKey)
    }

    private let backing: Backing
    public let isHardwareBacked: Bool

    private init(_ backing: Backing) {
        self.backing = backing
        if case .enclave = backing { isHardwareBacked = true } else { isHardwareBacked = false }
    }

    public var publicKey: P256.Signing.PublicKey {
        switch backing {
        case .enclave(let k): return k.publicKey
        case .software(let k): return k.publicKey
        }
    }

    /// ES256: the raw 64-byte r||s signature JWTs use.
    public func sign(_ data: Data) throws -> Data {
        switch backing {
        case .enclave(let k): return try k.signature(for: data).rawRepresentation
        case .software(let k): return try k.signature(for: data).rawRepresentation
        }
    }

    public var jwk: [String: String] { DeviceKey.jwk(of: publicKey) }

    public static func jwk(of key: P256.Signing.PublicKey) -> [String: String] {
        let raw = key.x963Representation   // 0x04 || x || y
        return ["kty": "EC", "crv": "P-256",
                "x": Base64URL.encode(raw.subdata(in: 1..<33)), "y": Base64URL.encode(raw.subdata(in: 33..<65))]
    }

    /// RFC 7638 thumbprint, as the server stores it.
    public var thumbprint: String {
        let j = jwk
        let canon = "{\"crv\":\"\(j["crv"]!)\",\"kty\":\"\(j["kty"]!)\",\"x\":\"\(j["x"]!)\",\"y\":\"\(j["y"]!)\"}"
        return Base64URL.encode(Data(SHA256.hash(data: Data(canon.utf8))))
    }

    /// This house's key on this device, made the first time. `account` keeps one key per house.
    public static func load(account: String, keychain: Keychain = Keychain()) throws -> DeviceKey {
        let name = "device-key." + account
        if let stored = keychain.data(for: name) {
            if stored.first == 0x45, let k = try? SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: stored.dropFirst()) {
                return DeviceKey(.enclave(k))
            }
            if stored.first == 0x53, let k = try? P256.Signing.PrivateKey(rawRepresentation: stored.dropFirst()) {
                return DeviceKey(.software(k))
            }
        }
        if SecureEnclave.isAvailable {
            let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
                                                         .privateKeyUsage, nil)!
            let k = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access)
            keychain.set(Data([0x45]) + k.dataRepresentation, for: name)   // an opaque handle, useless elsewhere
            return DeviceKey(.enclave(k))
        }
        let k = P256.Signing.PrivateKey()
        keychain.set(Data([0x53]) + k.rawRepresentation, for: name)
        return DeviceKey(.software(k))
    }

    public static func forget(account: String, keychain: Keychain = Keychain()) {
        keychain.set(nil, for: "device-key." + account)
    }

    /// A key that lives only in memory (tests).
    public static func ephemeral() -> DeviceKey { DeviceKey(.software(P256.Signing.PrivateKey())) }
}

/// DPoP proofs (RFC 9449): one fresh JWT per request, for its method and URL, signed by the device key.
public enum DPoP {
    public static func proof(key: DeviceKey, method: String, url: URL, accessToken: String? = nil,
                             now: Date = Date()) throws -> String {
        let header: [String: Any] = ["typ": "dpop+jwt", "alg": "ES256", "jwk": key.jwk]
        var claims: [String: Any] = ["htm": method.uppercased(), "htu": htu(url), "iat": Int(now.timeIntervalSince1970),
                                     "jti": Base64URL.encode(Data.random(count: 18))]
        if let accessToken {
            claims["ath"] = Base64URL.encode(Data(SHA256.hash(data: Data(accessToken.utf8))))
        }
        let h = Base64URL.encode(try JSONSerialization.data(withJSONObject: header, options: [.sortedKeys]))
        let c = Base64URL.encode(try JSONSerialization.data(withJSONObject: claims, options: [.sortedKeys]))
        let signing = "\(h).\(c)"
        return signing + "." + Base64URL.encode(try key.sign(Data(signing.utf8)))
    }

    /// The URL without its query and fragment.
    static func htu(_ url: URL) -> String {
        var c = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        c.query = nil
        c.fragment = nil
        return c.string ?? url.absoluteString
    }
}
