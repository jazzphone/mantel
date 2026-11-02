import CryptoKit
import Foundation
import Testing
@testable import MantelKit

/// Fixtures made by the server's own crypto (Tests/make_fixtures.py): the two sides must agree.
struct Fixture: Decodable {
    let device_private: String
    let sealed: SealedNotification
    let content: [String: AnyCodableValue]
    let hello: Hello
    let short_code: String
    let signing_private: String
    let thumbprint: String
    let pkce: [String: String]

    static func load() throws -> Fixture {
        let url = Bundle.module.url(forResource: "crypto", withExtension: "json", subdirectory: "Fixtures")!
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }
}

enum AnyCodableValue: Decodable {
    case s(String), b(Bool)
    init(from d: Decoder) throws {
        let c = try d.singleValueContainer()
        if let b = try? c.decode(Bool.self) { self = .b(b) } else { self = .s(try c.decode(String.self)) }
    }
}

@Test func pkceMatchesTheServer() throws {
    let f = try Fixture.load()
    #expect(PKCE(verifier: f.pkce["verifier"]!).challenge == f.pkce["challenge"]!)
    #expect(PKCE().verifier.count >= 43)
}

@Test func aSealedNotificationOpensWithThePhonesKey() throws {
    let f = try Fixture.load()
    let key = try P256.KeyAgreement.PrivateKey(rawRepresentation: Base64URL.decode(f.device_private)!)
    let c = try f.sealed.open(with: key)
    #expect(c.title == "Front Door" && c.body == "Opened" && c.entity == "lock.front_door" && c.important == true)
    #expect(throws: (any Error).self) { try f.sealed.open(with: P256.KeyAgreement.PrivateKey()) }
}

@Test func aSystemAlertHasItsOwnThreadAndItsLevelsInterruption() throws {
    let lost = SealedNotification.Content(title: "Home Assistant disconnected", tag: "system:ha.lost:",
                                          category: "system", level: "critical")
    #expect(lost.isSystem && lost.thread == "mantel.system" && lost.interruption == .timeSensitive)
    let update = SealedNotification.Content(title: "Mantel 0.1.115 is available", category: "system", level: "info")
    #expect(update.interruption == .passive)
    let door = SealedNotification.Content(title: "Front Door", tag: "door", important: true)
    #expect(!door.isSystem && door.thread == "door" && door.interruption == .timeSensitive)
    let json = Data(#"{"title":"Backup failed","category":"system","level":"warning"}"#.utf8)
    let decoded = try JSONDecoder().decode(SealedNotification.Content.self, from: json)
    #expect(decoded.isSystem && decoded.interruption == .active)
}

@Test func helloProvesThePinnedHouse() throws {
    let f = try Fixture.load()
    _ = try f.hello.verify(fingerprint: f.hello.fingerprint, nonce: f.hello.nonce!)
    #expect(throws: Hello.PinError.wrongHouse) { try f.hello.verify(fingerprint: "another-house", nonce: f.hello.nonce!) }
    #expect(throws: Hello.PinError.badSignature) { try f.hello.verify(fingerprint: f.hello.fingerprint, nonce: "other-nonce-0000") }
    #expect(House.shortCode(f.hello.fingerprint) == f.short_code)
}

@Test func thumbprintMatchesTheServers() throws {
    let f = try Fixture.load()
    let k = try P256.Signing.PrivateKey(rawRepresentation: Base64URL.decode(f.signing_private)!)
    let j = DeviceKey.jwk(of: k.publicKey)
    let canon = "{\"crv\":\"\(j["crv"]!)\",\"kty\":\"\(j["kty"]!)\",\"x\":\"\(j["x"]!)\",\"y\":\"\(j["y"]!)\"}"
    #expect(Base64URL.encode(Data(SHA256.hash(data: Data(canon.utf8)))) == f.thumbprint)
}

@Test func dpopProofIsAValidES256JWTForTheRequest() throws {
    let key = DeviceKey.ephemeral()
    let url = URL(string: "https://mantel.home.example/api/app/summary?x=1")!
    let jwt = try DPoP.proof(key: key, method: "get", url: url, accessToken: "tok")
    let parts = jwt.split(separator: ".").map(String.init)
    #expect(parts.count == 3)
    let header = try JSONSerialization.jsonObject(with: Base64URL.decode(parts[0])!) as! [String: Any]
    let claims = try JSONSerialization.jsonObject(with: Base64URL.decode(parts[1])!) as! [String: Any]
    #expect(header["typ"] as? String == "dpop+jwt" && header["alg"] as? String == "ES256")
    #expect(claims["htm"] as? String == "GET" && claims["htu"] as? String == "https://mantel.home.example/api/app/summary")
    #expect(claims["ath"] as? String == Base64URL.encode(Data(SHA256.hash(data: Data("tok".utf8)))))
    let sig = try P256.Signing.ECDSASignature(rawRepresentation: Base64URL.decode(parts[2])!)
    #expect(key.publicKey.isValidSignature(sig, for: Data("\(parts[0]).\(parts[1])".utf8)))
}

@Test func pairingLinksAreParsedStrictly() throws {
    let ok = PairingLink(url: URL(string: "mantel://pair?v=1&l=https%3A%2F%2Fmantel.home.example&fp=FP&c=CODE&n=Example")!)
    #expect(ok?.house.local?.absoluteString == "https://mantel.home.example" && ok?.code == "CODE" && ok?.house.name == "Example")
    #expect(PairingLink(url: URL(string: "mantel://pair?v=1&l=http%3A%2F%2Fevil.example&fp=FP&c=CODE")!) == nil)
    #expect(PairingLink(url: URL(string: "mantel://pair?v=2&l=https%3A%2F%2Fa.example&fp=FP&c=CODE")!) == nil)
    #expect(PairingLink(url: URL(string: "https://pair?v=1")!) == nil)
}

@Test func toggleCommands() {
    let lock = EntityState(entity_id: "lock.front", domain: "lock", state: "locked", name: "Front", area: nil, attributes: nil)
    #expect(Command.toggle(lock).service == "unlock")
    let light = EntityState(entity_id: "light.k", domain: "light", state: "on", name: "K", area: nil, attributes: nil)
    #expect(Command.toggle(light).service == "turn_off" && light.isOn)
}

@Test func plainHttpOnlyForLoopbackAndInDebugTheHomeNetwork() {
    #expect(PairingLink.httpsURL("http://127.0.0.1:8766") != nil)
    #expect(PairingLink.httpsURL("http://mantel.example.com") == nil)
    #expect(PairingLink.httpsURL("http://8.8.8.8") == nil)
    #if DEBUG
    #expect(PairingLink.httpsURL("http://192.168.2.100:8766") != nil)
    #expect(PairingLink.httpsURL("http://mantel.local:8766") != nil)
    #expect(PairingLink.httpsURL("http://172.32.0.1") == nil)
    #else
    #expect(PairingLink.httpsURL("http://192.168.2.100:8766") == nil)
    #endif
}
