import Foundation

/// The app's side of the house's API (app_auth.py, app_api.py). One per house; the extensions make their own
/// from the shared Keychain. Every authorized request carries `Authorization: DPoP <access>` and a fresh proof
/// by the device key; an expired access token is refreshed once (the refresh rotates, with a proof too).
public actor MantelClient {
    public private(set) var house: House
    public private(set) var base: URL?
    public private(set) var door: Door?
    /// What the house said in its last signed hello about notifications (relay or direct).
    public private(set) var push: Hello.Push?
    private let keychain: Keychain
    private let session: URLSession
    private var refreshing: Task<Credential, Error>?
    private lazy var key: DeviceKey? = try? DeviceKey.load(account: house.fingerprint, keychain: keychain)

    public init(house: House, keychain: Keychain = Keychain(), session: URLSession = .shared) {
        self.house = house
        self.keychain = keychain
        self.session = session
    }

    // MARK: - the credential

    private var credentialAccount: String { "credential." + house.fingerprint }

    public var credential: Credential? { keychain.codable(Credential.self, for: credentialAccount) }
    public var isSignedIn: Bool { credential.map { $0.refreshExpires > Date() } ?? false }
    public var keyIsHardwareBacked: Bool { key?.isHardwareBacked ?? false }

    private func store(_ t: TokenResponse) -> Credential {
        let c = Credential(access: t.access_token, accessExpires: Date().addingTimeInterval(TimeInterval(t.expires_in - 30)),
                           refresh: t.refresh_token, refreshExpires: Date(timeIntervalSince1970: t.refresh_expires_at),
                           credentialID: t.credential_id, user: t.user)
        keychain.setCodable(c, for: credentialAccount)
        if let local = t.house.addresses.local.flatMap(PairingLink.httpsURL) { house.local = local }
        if let remote = t.house.addresses.remote.flatMap(PairingLink.httpsURL) { house.remote = remote }
        house.name = t.house.name
        return c
    }

    public func forget() {
        keychain.set(nil, for: credentialAccount)
        DeviceKey.forget(account: house.fingerprint, keychain: keychain)
    }

    // MARK: - finding the house (§4: the local address first, then the remote one; the pin on both)

    /// Probe the addresses in order and use the first that proves to be this house. Returns the door.
    @discardableResult
    public func connect() async throws -> Door {
        var last: Error = APIError(error: "unreachable")
        for (url, timeout) in [(house.local, 2.5), (house.remote, 8.0)] {
            guard let url else { continue }
            do {
                let hello = try await self.hello(at: url, timeout: timeout)
                base = url
                door = Door(rawValue: hello.door) ?? .tunnel
                return door!
            } catch let e as Hello.PinError {
                last = APIError(error: "pin_mismatch", message: "The house at \(url.host ?? "") is not the Mantel you paired with (\(e)).")
            } catch {
                last = error
            }
        }
        base = nil
        door = nil
        throw last
    }

    public func hello(at url: URL, timeout: TimeInterval = 5) async throws -> Hello {
        let nonce = Base64URL.encode(Data.random(count: 24))
        var req = URLRequest(url: url.appending(path: "api/app/hello").appending(queryItems: [.init(name: "nonce", value: nonce)]))
        req.timeoutInterval = timeout
        req.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, resp) = try await session.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw APIError(error: "unreachable") }
        let hello = try JSONDecoder().decode(Hello.self, from: data)
        let pub = try hello.verify(fingerprint: house.fingerprint, nonce: nonce)
        house.key = Base64URL.encode(pub.x963Representation)
        push = hello.push
        return hello
    }

    private func requireBase() async throws -> URL {
        if let base { return base }
        try await connect()
        return base!
    }

    // MARK: - signing in

    /// `/app/authorize` for ASWebAuthenticationSession.
    public func authorizeURL(pkce: PKCE, state: String, deviceName: String) async throws -> URL {
        let b = try await requireBase()
        return b.appending(path: "app/authorize").appending(queryItems: [
            .init(name: "client_id", value: MantelConfig.clientID), .init(name: "redirect_uri", value: MantelConfig.redirectURI),
            .init(name: "code_challenge", value: pkce.challenge), .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state), .init(name: "device_name", value: deviceName)])
    }

    public func exchange(code: String, pkce: PKCE, device: DeviceInfo) async throws -> Credential {
        try await token(["grant_type": "authorization_code", "code": code, "code_verifier": pkce.verifier,
                         "client_id": MantelConfig.clientID, "redirect_uri": MantelConfig.redirectURI, "device": device.json])
    }

    public func redeem(pairingCode: String, device: DeviceInfo) async throws -> Credential {
        try await token(["grant_type": "pairing_code", "code": pairingCode, "client_id": MantelConfig.clientID,
                         "device": device.json])
    }

    private func token(_ body: [String: Any]) async throws -> Credential {
        guard let key else { throw APIError(error: "no_device_key") }
        let url = try await requireBase().appending(path: "api/app/token")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(try DPoP.proof(key: key, method: "POST", url: url), forHTTPHeaderField: "DPoP")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await session.data(for: req)
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw decodeError(data, status) }
        return store(try JSONDecoder().decode(TokenResponse.self, from: data))
    }

    private func refreshed() async throws -> Credential {
        if let refreshing { return try await refreshing.value }
        let task = Task { () throws -> Credential in
            guard let c = credential else { throw APIError(error: "signed_out", status: 401) }
            return try await token(["grant_type": "refresh_token", "refresh_token": c.refresh])
        }
        refreshing = task
        defer { refreshing = nil }
        return try await task.value
    }

    // MARK: - authorized requests

    public func send<T: Decodable>(_ method: String, _ path: String, body: Encodable? = nil, as: T.Type) async throws -> T {
        let data = try await raw(method, path, body: body)
        return try JSONDecoder().decode(T.self, from: data)
    }

    public func raw(_ method: String, _ path: String, body: Encodable? = nil, retry: Bool = true) async throws -> Data {
        guard var cred = credential else { throw APIError(error: "signed_out", status: 401) }
        if cred.accessExpires < Date() { cred = try await refreshed() }
        guard let key else { throw APIError(error: "no_device_key") }
        let base = try await requireBase()
        var comps = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        let parts = path.split(separator: "?", maxSplits: 1)
        comps.path = (comps.path.hasSuffix("/") ? String(comps.path.dropLast()) : comps.path) + String(parts[0])
        if parts.count > 1 { comps.percentEncodedQuery = String(parts[1]) }
        let url = comps.url!
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.timeoutInterval = 15
        req.setValue("DPoP " + cred.access, forHTTPHeaderField: "Authorization")
        req.setValue(try DPoP.proof(key: key, method: method, url: url, accessToken: cred.access), forHTTPHeaderField: "DPoP")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(AnyEncodable(body))
        }
        let data: Data, resp: URLResponse
        do {
            (data, resp) = try await session.data(for: req)
        } catch {
            self.base = nil                 // the network moved: find the house again next time
            throw error
        }
        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
        if status == 401, retry {
            _ = try await refreshed()
            return try await raw(method, path, body: body, retry: false)
        }
        guard (200..<300).contains(status) else { throw decodeError(data, status) }
        return data
    }

    private func decodeError(_ data: Data, _ status: Int) -> APIError {
        var e = (try? JSONDecoder().decode(APIError.self, from: data)) ?? APIError(error: "http_\(status)")
        e.status = status
        return e
    }

    // MARK: - the house's API

    public func me() async throws -> MeResponse { try await send("GET", "/api/app/me", as: MeResponse.self) }
    public func summary() async throws -> Summary { try await send("GET", "/api/app/summary", as: Summary.self) }

    public func favorites() async throws -> [String] {
        try await send("GET", "/api/app/favorites", as: FavoritesBody.self).favorites
    }

    public func setFavorites(_ ids: [String]) async throws {
        _ = try await raw("PUT", "/api/app/favorites", body: FavoritesBody(favorites: ids))
    }

    public func entities(matching q: String = "") async throws -> [EntityChoice] {
        let enc = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return try await send("GET", "/api/app/entities?q=" + enc, as: EntitiesBody.self).entities
    }

    @discardableResult
    public func run(_ command: Command) async throws -> CommandResult {
        try await send("POST", "/api/app/command", body: command, as: CommandResult.self)
    }

    /// A one-time address that opens an ordinary Mantel session in the web view, landing on `next`.
    public func webSessionURL(next: String = "/home") async throws -> URL {
        let got = try await send("POST", "/api/app/web-session", body: ["next": next], as: WebSessionBody.self)
        return URL(string: got.url, relativeTo: try await requireBase())!.absoluteURL
    }

    /// Register for the house's notifications. Through the relay (docs/phase10/APPLE-APPS.md §13): the device token goes
    /// to the relay only, for this house's pinned key, and the house gets the relay's opaque handle. Directly (a house
    /// with its own APNs key): the house gets the token. `resume` is the person's own Turn On Notifications: without
    /// it, an app the person stopped in Mantel Settings (`push_off`) does not register again by itself.
    /// Returns false when it did not register for that reason.
    @discardableResult
    /// `platform`: "ios" (the iPhone and iPad app) or "mac" (the menu bar app): Apple's topic is each app's own bundle id.
    public func registerPush(token: Data, key: Data, sandbox: Bool, resume: Bool = false,
                             platform: String = "ios") async throws -> Bool {
        let hexToken = token.map { String(format: "%02x", $0) }.joined()
        let env = sandbox ? "sandbox" : "production"
        if !resume, try await me().push_off == true { return false }
        if push?.relay == nil, push?.direct == nil { try await connect() }      // learn the house's push mode
        if let relay = push?.relay, let relayURL = URL(string: relay), let houseKey = house.key {
            var req = URLRequest(url: relayURL.appending(path: "v1/register"))
            req.httpMethod = "POST"
            req.timeoutInterval = 15
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: ["token": hexToken, "env": env, "house_key": houseKey,
                                                                       "platform": platform])
            let (data, resp) = try await session.data(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode == 201,
                  let got = try? JSONDecoder().decode(RelayRegistration.self, from: data),
                  got.house == house.fingerprint else { throw APIError(error: "relay_refused") }
            _ = try await raw("POST", "/api/app/push/register", body: PushRegistration(handle: got.handle, token: nil,
                                                                                    key: Base64URL.encode(key), env: nil, resume: resume,
                                                                                    platform: platform))
        } else if push?.direct == true {
            _ = try await raw("POST", "/api/app/push/register", body: PushRegistration(handle: nil, token: hexToken,
                                                                                    key: Base64URL.encode(key), env: env, resume: resume,
                                                                                    platform: platform))
        } else {
            throw APIError(error: "no_push", message: "This Mantel does not send notifications to the app yet.")
        }
        return true
    }

    public func signOut() async {
        _ = try? await raw("POST", "/api/app/sign-out", retry: false)
        forget()
    }

    /// A player's artwork: from the provider as it is, or through the house (`/api/app/art`, with the credential).
    public func artwork(_ ref: String) async throws -> Data {
        if ref.hasPrefix("https://") || ref.hasPrefix("http://") {
            guard let url = URL(string: ref) else { throw APIError(error: "bad_art") }
            var req = URLRequest(url: url)
            req.timeoutInterval = 10
            let (data, resp) = try await session.data(for: req)
            guard (resp as? HTTPURLResponse)?.statusCode == 200 else { throw APIError(error: "no_artwork") }
            return data
        }
        return try await raw("GET", ref)
    }

    /// The snapshot a notification names (notify_snaps.py's rule: a camera the person may see).
    public func snapshot(_ id: String) async throws -> Data { try await raw("GET", "/api/app/snap?id=" + id) }
}

public struct DeviceInfo: Sendable {
    public let name: String
    public let model: String
    public let platform: String

    public init(name: String, model: String, platform: String) {
        self.name = name
        self.model = model
        self.platform = platform
    }

    var json: [String: String] { ["name": name, "model": model, "platform": platform] }
}

public struct MeResponse: Codable, Sendable {
    public let user: AppUser
    public let door: String
    public let commands: Bool
    public let credential_id: String
    /// The person stopped this app's notifications in Mantel Settings (older houses don't say).
    public let push_off: Bool?
}

public struct CommandResult: Codable, Sendable {
    public let audit_id: Int?
}

struct FavoritesBody: Codable { let favorites: [String] }
struct RelayRegistration: Codable { let handle: String; let house: String }
struct PushRegistration: Codable { let handle: String?; let token: String?; let key: String; let env: String?; let resume: Bool
                                   let platform: String }
struct EntitiesBody: Codable { let entities: [EntityChoice] }
struct WebSessionBody: Codable { let url: String }

struct AnyEncodable: Encodable {
    let value: Encodable
    init(_ value: Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}
