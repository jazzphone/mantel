import CryptoKit
import Foundation

/// The phone's notification key and the sealed notifications the house sends (apns.py, app_crypto.seal_for_device):
/// ECDH with the house's one-time key, HKDF-SHA256 (salt: that key, info "mantel push v1"), AES-256-GCM. Apple's
/// push service carries only ciphertext; the Notification Service Extension opens it here.
public enum NotificationKey {
    static let account = "notification-key"

    /// The private key, made once and kept in the shared Keychain (the extension reads it).
    public static func load(keychain: Keychain = Keychain()) -> P256.KeyAgreement.PrivateKey {
        if let raw = keychain.data(for: account), let k = try? P256.KeyAgreement.PrivateKey(rawRepresentation: raw) {
            return k
        }
        let k = P256.KeyAgreement.PrivateKey()
        keychain.set(k.rawRepresentation, for: account)
        return k
    }

    /// x963 public key, as registered with the house.
    public static func publicKey(keychain: Keychain = Keychain()) -> Data { load(keychain: keychain).publicKey.x963Representation }
}

public struct SealedNotification: Codable, Equatable, Sendable {
    public let v: String
    public let epk: String
    public let box: String

    /// What was sealed: the notification as the screens would show it.
    public struct Content: Codable, Equatable, Sendable {
        public let title: String
        public let body: String?
        public let entity: String?
        public let snap: String?
        public let camera: String?
        public let tag: String?
        public let url: String?
        public let important: Bool?
        public let id: String?
        /// "system": one of Mantel's own alerts (docs/phase14/SYSTEM-ALERTS.md), not an accessory's.
        public let category: String?
        /// A system alert's level: "info", "warning" or "critical".
        public let level: String?

        public init(title: String, body: String? = nil, entity: String? = nil, snap: String? = nil, camera: String? = nil,
                    tag: String? = nil, url: String? = nil, important: Bool? = nil, id: String? = nil,
                    category: String? = nil, level: String? = nil) {
            self.title = title; self.body = body; self.entity = entity; self.snap = snap; self.camera = camera
            self.tag = tag; self.url = url; self.important = important; self.id = id
            self.category = category; self.level = level
        }

        public var isSystem: Bool { category == "system" }

        /// The thread it is grouped in: every system alert in one System thread, apart from the doorbell and leaks;
        /// an accessory's by its tag.
        public var thread: String? { isSystem ? Self.systemThread : tag }
        public static let systemThread = "mantel.system"

        public enum Interruption: Sendable { case passive, active, timeSensitive }

        /// How it interrupts: a system alert by its level (Critical through Focus, Info quietly in the summary), an
        /// accessory's Important ones time-sensitive.
        public var interruption: Interruption {
            if isSystem {
                switch level {
                case "critical": return .timeSensitive
                case "info": return .passive
                default: return .active
                }
            }
            return important == true ? .timeSensitive : .active
        }
    }

    public enum OpenError: Error { case version, key, box }

    public func open(with key: P256.KeyAgreement.PrivateKey) throws -> Content {
        guard v == "1" else { throw OpenError.version }
        guard let epkRaw = Base64URL.decode(epk), let eph = try? P256.KeyAgreement.PublicKey(x963Representation: epkRaw)
        else { throw OpenError.key }
        let shared = try key.sharedSecretFromKeyAgreement(with: eph)
        let sym = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: epkRaw, sharedInfo: Data("mantel push v1".utf8),
                                                 outputByteCount: 32)
        guard let combined = Base64URL.decode(box), let sealed = try? AES.GCM.SealedBox(combined: combined) else {
            throw OpenError.box
        }
        let plain = try AES.GCM.open(sealed, using: sym)
        return try JSONDecoder().decode(Content.self, from: plain)
    }

    /// The `m` member of an APNs payload (userInfo).
    public init?(userInfo: [AnyHashable: Any]) {
        guard let m = userInfo["m"] as? [String: Any], let v = m["v"] as? String, let epk = m["epk"] as? String,
              let box = m["box"] as? String else { return nil }
        self.v = v
        self.epk = epk
        self.box = box
    }
}
