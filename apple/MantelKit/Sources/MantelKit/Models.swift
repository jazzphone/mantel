import Foundation

public struct AppUser: Codable, Hashable, Sendable {
    public let id: String
    public let username: String?
    public let name: String?
    public let role: String
    public var displayName: String { name ?? username ?? "You" }
}

/// What `/api/app/token` answers.
public struct TokenResponse: Codable, Sendable {
    public let access_token: String
    public let token_type: String
    public let expires_in: Int
    public let refresh_token: String
    public let refresh_expires_at: Double
    public let credential_id: String
    public let user: AppUser
    public let house: Hello
}

/// The credential kept in the Keychain (per house).
public struct Credential: Codable, Sendable {
    public var access: String
    public var accessExpires: Date
    public var refresh: String
    public var refreshExpires: Date
    public var credentialID: String
    public var user: AppUser
}

public struct EntityState: Codable, Hashable, Identifiable, Sendable {
    public var id: String { entity_id }
    public let entity_id: String
    public let domain: String
    public let state: String?
    public let name: String
    public let area: String?
    public let attributes: Attributes?
    /// A player's artwork: an absolute URL (a provider's CDN) or a path on the house (`/api/app/art?...`).
    public let art: String?

    public struct Attributes: Codable, Hashable, Sendable {
        public let unit_of_measurement: String?
        public let device_class: String?
        public let brightness: Double?
        public let current_position: Double?
        public let temperature: Double?
        public let current_temperature: Double?
        public let media_title: String?
        public let media_artist: String?
        public let media_album_name: String?
        public let volume_level: Double?
        public let is_volume_muted: Bool?
        public let percentage: Double?
        public let media_duration: Double?
        public let media_position: Double?
        public let media_position_updated_at: String?

        /// Where the track was at `media_position_updated_at`, as a date and a position.
        public var positionAt: Date? {
            media_position_updated_at.flatMap { s in
                let f = ISO8601DateFormatter()
                f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
            }
        }
    }

    public init(entity_id: String, domain: String, state: String?, name: String, area: String?, attributes: Attributes?,
                art: String? = nil) {
        self.entity_id = entity_id
        self.domain = domain
        self.state = state
        self.name = name
        self.area = area
        self.attributes = attributes
        self.art = art
    }

    /// On, open, unlocked, playing: what a toggle shows as "on".
    public var isOn: Bool {
        switch state {
        case "on", "open", "opening", "unlocked", "playing", "heat", "cool", "heat_cool", "auto", "cleaning": return true
        default: return false
        }
    }

    public var isToggleable: Bool {
        ["light", "switch", "fan", "input_boolean", "lock", "cover", "media_player", "valve", "humidifier"].contains(domain)
    }

    public var isAction: Bool { ["scene", "script", "button", "input_button"].contains(domain) }

    /// A short line under the name.
    public var detail: String {
        if domain == "media_player", let t = attributes?.media_title {
            return [t, attributes?.media_artist].compactMap { $0 }.joined(separator: " · ")
        }
        if domain == "light", isOn, let b = attributes?.brightness { return "\(Int((b / 255 * 100).rounded()))%" }
        if domain == "climate", let t = attributes?.current_temperature { return "\(Int(t))°" }
        if let s = state {
            if let u = attributes?.unit_of_measurement { return "\(s) \(u)" }
            return s.replacingOccurrences(of: "_", with: " ").capitalized
        }
        return ""
    }
}

public struct Summary: Codable, Sendable {
    public let favorites: [EntityState]
    public let now_playing: EntityState?
    public let door: String
    public let commands: Bool
    public let at: Double

    public init(favorites: [EntityState], now_playing: EntityState?, door: String, commands: Bool, at: Double) {
        self.favorites = favorites
        self.now_playing = now_playing
        self.door = door
        self.commands = commands
        self.at = at
    }

    public static let placeholder = Summary(
        favorites: [EntityState(entity_id: "light.kitchen", domain: "light", state: "on", name: "Kitchen", area: "Kitchen",
                                attributes: nil),
                    EntityState(entity_id: "lock.front_door", domain: "lock", state: "locked", name: "Front Door",
                                area: nil, attributes: nil)],
        now_playing: nil, door: "lan", commands: true, at: 0)
}

public struct EntityChoice: Codable, Hashable, Identifiable, Sendable {
    public var id: String { entity_id }
    public let entity_id: String
    public let domain: String
    public let name: String
    public let area: String?
    public let state: String?
}

/// A service call through the house's command gateway (app_api.command).
public struct Command: Codable, Sendable {
    public let domain: String
    public let service: String
    public let entity_id: String
    public let data: [String: JSONValue]

    public init(domain: String, service: String, entity_id: String, data: [String: JSONValue] = [:]) {
        self.domain = domain
        self.service = service
        self.entity_id = entity_id
        self.data = data
    }

    /// Flip a favorite.
    public static func toggle(_ e: EntityState) -> Command {
        switch e.domain {
        case "lock": return Command(domain: "lock", service: e.state == "locked" ? "unlock" : "lock", entity_id: e.entity_id)
        case "cover", "valve": return Command(domain: e.domain, service: e.isOn ? "close_\(e.domain)" : "open_\(e.domain)",
                                              entity_id: e.entity_id)
        case "media_player": return Command(domain: "media_player", service: "media_play_pause", entity_id: e.entity_id)
        case "scene", "script": return Command(domain: e.domain, service: "turn_on", entity_id: e.entity_id)
        case "button", "input_button": return Command(domain: e.domain, service: "press", entity_id: e.entity_id)
        default: return Command(domain: e.domain, service: e.isOn ? "turn_off" : "turn_on", entity_id: e.entity_id)
        }
    }
}

/// A small JSON value for a command's data.
public enum JSONValue: Codable, Hashable, Sendable {
    case string(String), number(Double), bool(Bool), null

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else { self = .string(try c.decode(String.self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .null: try c.encodeNil()
        }
    }
}

public struct APIError: Error, Codable, Sendable, LocalizedError {
    public let error: String
    public let message: String?
    public var status: Int?

    public init(error: String, message: String? = nil, status: Int? = nil) {
        self.error = error
        self.message = message
        self.status = status
    }

    public var errorDescription: String? {
        if let message { return message }
        switch error {
        case "forbidden": return "You’re not allowed to do that."
        case "commands_disabled": return "Commands are off on this Mantel."
        case "lan_only": return "That works on the home network only."
        case "invalid_grant": return "That sign-in has run out. Try again."
        case "unreachable": return "Can’t reach your Mantel."
        case "pin_mismatch": return "This is not the Mantel you paired with."
        default: return error.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}
