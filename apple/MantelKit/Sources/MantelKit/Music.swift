import Foundation

// The house's music for a native player (server: app_music.py). What plays, where and who may is the house's; the
// few rules here are the screens' own (hk-base.js hkMusic: label, resolve; hk-music.js volumeCalls), so the Mac's
// player shows the same music the Music page does.

/// `GET /api/app/music`: the music settings this person may see, every speaker's state, and what plays.
public struct MusicState: Codable, Sendable, Equatable {
    public let configured: Bool
    public var speakers: [Speaker] = []
    public var floors: [Floor] = []
    public var playlists: [Playlist] = []
    public var home: String?
    public var players: [Player] = []
    public var contexts: [MusicContext] = []
    public var focus: String?
    public var commands: Bool = false
    public var library: Bool = false
    public var at: Double = 0

    enum CodingKeys: String, CodingKey { case configured, speakers, floors, playlists, home, players, contexts, focus, commands, library, at }

    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        configured = try c.decodeIfPresent(Bool.self, forKey: .configured) ?? false
        speakers = try c.decodeIfPresent([Speaker].self, forKey: .speakers) ?? []
        floors = try c.decodeIfPresent([Floor].self, forKey: .floors) ?? []
        playlists = try c.decodeIfPresent([Playlist].self, forKey: .playlists) ?? []
        home = try c.decodeIfPresent(String.self, forKey: .home)
        players = try c.decodeIfPresent([Player].self, forKey: .players) ?? []
        contexts = try c.decodeIfPresent([MusicContext].self, forKey: .contexts) ?? []
        focus = try c.decodeIfPresent(String.self, forKey: .focus)
        commands = try c.decodeIfPresent(Bool.self, forKey: .commands) ?? false
        library = try c.decodeIfPresent(Bool.self, forKey: .library) ?? false
        at = try c.decodeIfPresent(Double.self, forKey: .at) ?? 0
    }

    public init(configured: Bool) { self.configured = configured }

    /// A room or a preset (a sync group: its `members` are rooms).
    public struct Speaker: Codable, Sendable, Hashable, Identifiable {
        public var id: String { entity }
        public let name: String
        public let entity: String
        public var members: [String]?
        public var isPreset: Bool { !(members ?? []).isEmpty }
    }

    public struct Floor: Codable, Sendable, Hashable {
        public let name: String
        public let entities: [String]
    }

    /// One of the house's playlists (Music settings): a key, or a choice of options each with its key.
    public struct Playlist: Codable, Sendable, Hashable, Identifiable {
        public var id: String { key ?? name }
        public let name: String
        public var icon: String?
        public var key: String?
        public var options: [Option]?
        public struct Option: Codable, Sendable, Hashable, Identifiable {
            public var id: String { key }
            public let name: String
            public let key: String
        }
    }

    /// A speaker's state now.
    public struct Player: Codable, Sendable, Hashable, Identifiable {
        public var id: String { entity }
        public let entity: String
        public let name: String
        public let state: String
        public var attributes: Attributes = Attributes()
        public var group_members: [String]?
        public var art: String?

        public var active: Bool { state == "playing" || state == "paused" }

        public struct Attributes: Codable, Sendable, Hashable {
            public var media_title: String?
            public var media_artist: String?
            public var media_album_name: String?
            public var media_duration: Double?
            public var media_position: Double?
            public var media_position_updated_at: String?
            public var volume_level: Double?
            public var is_volume_muted: Bool?
            public var shuffle: Bool?
            public var `repeat`: String?
            public init() {}
        }

        /// How far in, now: the position the house last said, moved on while it plays.
        public func elapsed(at now: Date = Date()) -> Double? {
            guard var t = attributes.media_position else { return nil }
            if state == "playing", let s = attributes.media_position_updated_at, let at = MusicState.date(s) {
                t += max(0, now.timeIntervalSince(at))
            }
            if let d = attributes.media_duration, d > 0 { t = min(t, d) }
            return t
        }
    }

    static func date(_ s: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: s) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)
    }

    // MARK: - the screens' rules

    public var rooms: [Speaker] { speakers.filter { !$0.isPreset } }
    public var presets: [Speaker] { speakers.filter { $0.isPreset } }
    public func player(_ entity: String) -> Player? { players.first { $0.entity == entity } }
    public func name(_ entity: String) -> String { speakers.first { $0.entity == entity }?.name ?? player(entity)?.name ?? entity }

    /// hkMusic.label: a preset's name (rooms that are exactly its); "Kitchen + Loft" at two; "Kitchen +3" beyond; one
    /// room's name.
    public func label(_ c: MusicContext) -> String {
        if let p = c.preset { return p }
        let n = c.members.count
        if n == 2 { return name(c.members[0]) + " + " + name(c.members[1]) }
        return n > 2 ? name(c.leader) + " +\(n - 1)" : name(c.leader)
    }

    /// This person's music (hkMusic.resolve, without a screen's own memory): the focus's music while it plays or is
    /// paused; else what plays (the home room's first); else nothing (the focus, or the home room, is ready).
    public func resolved() -> MusicContext? {
        if let f = focus, let c = contexts.first(where: { $0.key == f || $0.members.contains(f) }) { return c }
        let playing = contexts.filter(\.playing)
        if let h = home, let c = playing.first(where: { $0.members.contains(h) }) { return c }
        return playing.first
    }

    /// Where the next music plays while nothing does: the focus, else the home room (a preset: its rooms).
    public func readyRooms() -> [String] {
        let p = focus ?? home
        guard let p else { return [] }
        if let pre = presets.first(where: { $0.entity == p }) { return pre.members ?? [] }
        return [p]
    }

    /// The volume calls for what plays (hk-saver-panel.js volumeCalls): several rooms together, or one room.
    public func volumeTargets(_ c: MusicContext) -> [[String]] {
        [c.members.count > 1 ? c.members : [c.key]]
    }
}

/// One separate thing the house plays (hkMusic.contexts): a group (keyed by its leader; `preset` names the preset whose
/// rooms it is exactly -- a preset is its rooms, its id no player), or a room.
public struct MusicContext: Codable, Sendable, Hashable, Identifiable {
    public var id: String { key }
    public let key: String
    public let kind: String
    public let leader: String
    public let members: [String]
    public let playing: Bool
    public let state: String
    public var title: String = ""
    public var artist: String = ""
    public var preset: String?
}

/// `GET /api/app/music/queue`: the songs from the one playing on.
public struct MusicQueue: Codable, Sendable {
    public let ok: Bool
    public var message: String?
    public var index: Int?
    public var items: [Item] = []
    enum CodingKeys: String, CodingKey { case ok, message, index, items }
    public init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        ok = try c.decodeIfPresent(Bool.self, forKey: .ok) ?? false
        message = try c.decodeIfPresent(String.self, forKey: .message)
        index = try? c.decodeIfPresent(Int.self, forKey: .index)
        items = try c.decodeIfPresent([Item].self, forKey: .items) ?? []
    }
    public struct Item: Codable, Sendable, Hashable, Identifiable {
        public let id: String
        public var title: String?
        public var artist: String?
        public var duration: Double?
        public var image: String?
    }
}

/// One of Music Assistant's library items (Browse): a playlist, an album, an artist, a track, a radio station ...
public struct MusicItem: Codable, Sendable, Hashable, Identifiable {
    public var id: String { uri }
    public let media_type: String
    public let uri: String
    public let name: String
    public var version: String?
    public var image: String?
    public var artists: [Nested]?
    public var album: Nested?
    public struct Nested: Codable, Sendable, Hashable {
        public let name: String
        public var image: String?
    }
    public var subtitle: String { (artists ?? []).map(\.name).joined(separator: ", ") }
    public init(media_type: String, uri: String, name: String, image: String? = nil) {
        self.media_type = media_type
        self.uri = uri
        self.name = name
        self.image = image
    }
}

/// The house's answer to a music request (`{ok, message, leader}`), and its audit row.
public struct MusicAnswer: Codable, Sendable {
    public struct Response: Codable, Sendable {
        public var ok: Bool?
        public var message: String?
        public var leader: String?
    }
    public var response: Response?
    public var audit_id: Int?
}

struct LibraryBody: Codable { let items: [MusicItem] }

extension MantelClient {
    public func music() async throws -> MusicState { try await send("GET", "/api/app/music", as: MusicState.self) }

    /// The Music page's own requests (`hk_frontend.music_<service>`): transport, transfer, play, play_media, stop.
    @discardableResult
    public func music(_ service: String, _ data: [String: MusicValue]) async throws -> MusicAnswer {
        let got = try await send("POST", "/api/app/music/command", body: MusicCommand(service: service, data: data),
                                 as: MusicAnswer.self)
        if got.response?.ok == false {
            throw APIError(error: "music_refused", message: got.response?.message ?? "The house didn’t do that.")
        }
        return got
    }

    public func musicVolume(_ entities: [String], _ level: Double) async throws {
        _ = try await raw("POST", "/api/app/music/volume", body: VolumeBody(entity_id: entities, level: level))
    }

    public func setMusicFocus(_ key: String?) async throws {
        _ = try await raw("PUT", "/api/app/music/focus", body: FocusBody(key: key))
    }

    public func musicQueue(_ entity: String, limit: Int = 40) async throws -> MusicQueue {
        try await send("GET", "/api/app/music/queue?entity_id=\(entity)&limit=\(limit)", as: MusicQueue.self)
    }

    public func playQueueItem(_ entity: String, _ item: String) async throws {
        _ = try await send("POST", "/api/app/music/queue/play", body: ["entity_id": entity, "item_id": item],
                           as: MusicAnswer.self)
    }

    /// Music Assistant's library: `media_type` playlist | album | artist | track | radio | podcast | audiobook.
    public func library(_ mediaType: String, search: String = "", favorite: Bool? = nil, orderBy: String? = nil,
                        limit: Int = 50) async throws -> [MusicItem] {
        var q = "media_type=\(mediaType)&limit=\(limit)"
        if !search.isEmpty, let s = search.addingPercentEncoding(withAllowedCharacters: .alphanumerics) { q += "&search=" + s }
        if let favorite { q += "&favorite=\(favorite)" }
        if let orderBy { q += "&order_by=" + orderBy }
        return try await send("GET", "/api/app/music/library?" + q, as: LibraryBody.self).items
    }

    /// A library or queue picture: a web address as it is, the house's through the credential.
    public func musicImage(_ ref: String) async throws -> Data { try await artwork(ref) }
}

/// A value in a music request's data: text, a number, or a list of rooms.
public enum MusicValue: Encodable, Sendable {
    case text(String), number(Double), list([String])
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .text(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .list(let l): try c.encode(l)
        }
    }
}

struct MusicCommand: Encodable { let service: String; let data: [String: MusicValue] }
struct VolumeBody: Encodable { let entity_id: [String]; let level: Double }
struct FocusBody: Encodable { let key: String? }
