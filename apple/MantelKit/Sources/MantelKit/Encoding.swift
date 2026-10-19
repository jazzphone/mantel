import CryptoKit
import Foundation

/// base64url without padding (JWTs, PKCE, the server's keys and fingerprints).
public enum Base64URL {
    public static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func decode(_ text: String) -> Data? {
        var s = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while s.count % 4 != 0 { s += "=" }
        return Data(base64Encoded: s)
    }
}

/// PKCE (RFC 7636): a random verifier and its S256 challenge.
public struct PKCE: Sendable {
    public let verifier: String
    public let challenge: String

    public init(verifier: String? = nil) {
        let v = verifier ?? Base64URL.encode(Data.random(count: 48))
        self.verifier = v
        self.challenge = Base64URL.encode(Data(SHA256.hash(data: Data(v.utf8))))
    }
}

extension Data {
    public static func random(count: Int) -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        return Data(bytes)
    }
}
