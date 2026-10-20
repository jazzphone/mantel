import CryptoKit
import Foundation

/// One Mantel house as the app knows it: its two addresses (either may be empty), its name, and the key it was
/// paired with (docs/phase10/APPLE-APPS.md §2, §4).
public struct House: Codable, Hashable, Identifiable, Sendable {
    public var id: String { fingerprint }
    public var name: String
    public var local: URL?
    public var remote: URL?
    /// SHA-256 of the house's identity key (SubjectPublicKeyInfo), base64url: the pin.
    public var fingerprint: String
    /// The house's identity key (x963, base64url), learnt at the first hello whose fingerprint matched.
    public var key: String?

    public init(name: String, local: URL?, remote: URL?, fingerprint: String, key: String? = nil) {
        self.name = name
        self.local = local
        self.remote = remote
        self.fingerprint = fingerprint
        self.key = key
    }

    /// Six digits to compare with the ones Mantel Settings shows (app_crypto.short_code).
    public var shortCode: String { House.shortCode(fingerprint) }

    public static func shortCode(_ fingerprint: String) -> String {
        let d = Data(SHA256.hash(data: Data(fingerprint.utf8)))
        let n = d.prefix(4).reduce(UInt32(0)) { ($0 << 8) | UInt32($1) } % 1_000_000
        let s = String(format: "%06u", n)
        return String(s.prefix(3)) + " " + String(s.suffix(3))
    }

    public static func fingerprint(of key: P256.Signing.PublicKey) -> String {
        Base64URL.encode(Data(SHA256.hash(data: key.derRepresentation)))
    }
}

/// `mantel://pair?v=1&l=<local>&r=<remote>&fp=<fingerprint>&c=<code>&n=<name>`, the QR code Mantel Settings shows
/// (app_auth.pairing).
public struct PairingLink: Equatable, Sendable {
    public let house: House
    public let code: String

    public init?(url: URL) {
        guard url.scheme == MantelConfig.urlScheme, url.host == "pair",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return nil }
        func q(_ k: String) -> String? { items.first { $0.name == k }?.value.flatMap { $0.isEmpty ? nil : $0 } }
        guard q("v") == "1", let fp = q("fp"), let code = q("c") else { return nil }
        let local = q("l").flatMap(PairingLink.httpsURL)
        let remote = q("r").flatMap(PairingLink.httpsURL)
        guard local != nil || remote != nil else { return nil }
        house = House(name: q("n") ?? "Mantel", local: local, remote: remote, fingerprint: fp)
        self.code = code
    }

    /// Only https. A loopback http address is allowed for a developer's own Mantel, and in DEBUG builds only (
    /// 2026-10-19: testing on his iPhone against a test Mantel on the Mac) an http address on the home network: a
    /// private IPv4 address or a `.local` name. Release and TestFlight builds never accept http beyond loopback.
    public static func httpsURL(_ s: String) -> URL? {
        guard let u = URL(string: s), let host = u.host else { return nil }
        if u.scheme == "https" { return u }
        if u.scheme == "http", ["127.0.0.1", "localhost", "::1"].contains(host) { return u }
        #if DEBUG
        if u.scheme == "http", isHomeNetwork(host) { return u }
        #endif
        return nil
    }

    static func isHomeNetwork(_ host: String) -> Bool {
        if host.hasSuffix(".local") { return true }
        let p = host.split(separator: ".").compactMap { Int($0) }
        guard p.count == 4, p.allSatisfy({ (0...255).contains($0) }) else { return false }
        return p[0] == 10 || (p[0] == 172 && (16...31).contains(p[1])) || (p[0] == 192 && p[1] == 168)
    }
}

/// `GET /api/app/hello?nonce=`: the house's addresses and key, and its signature over our nonce.
public struct Hello: Codable, Sendable {
    public struct Addresses: Codable, Sendable {
        public let local: String?
        public let remote: String?
    }
    public let service: String
    public let name: String
    public let fingerprint: String
    public let key: String
    public let door: String
    public let addresses: Addresses
    public let nonce: String?
    public let signature: String?
    /// How this house sends notifications: through the push relay (its address) or directly with its own APNs key.
    public let push: Push?

    public struct Push: Codable, Sendable, Equatable {
        public let relay: String?
        public let direct: Bool?
    }

    public enum PinError: Error, Equatable {
        case notMantel, badKey, wrongHouse, badSignature
    }

    /// The house we paired with, proved: its key hashes to the pinned fingerprint and it signed our nonce.
    public func verify(fingerprint pinned: String, nonce sent: String) throws -> P256.Signing.PublicKey {
        guard service == "mantel" else { throw PinError.notMantel }
        guard let raw = Base64URL.decode(key), let pub = try? P256.Signing.PublicKey(x963Representation: raw) else {
            throw PinError.badKey
        }
        guard House.fingerprint(of: pub) == pinned, fingerprint == pinned else { throw PinError.wrongHouse }
        guard nonce == sent, let sigData = signature.flatMap(Base64URL.decode),
              let sig = try? P256.Signing.ECDSASignature(rawRepresentation: sigData),
              pub.isValidSignature(sig, for: Data("mantel-hello\n\(sent)\n\(pinned)".utf8)) else {
            throw PinError.badSignature
        }
        return pub
    }
}

/// Where the app is talking to the house right now.
public enum Door: String, Codable, Sendable {
    case lan, tunnel
    public var isAway: Bool { self == .tunnel }
}
