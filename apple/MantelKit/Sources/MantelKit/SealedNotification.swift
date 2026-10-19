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
