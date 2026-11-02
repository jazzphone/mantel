import MantelKit
import SwiftUI
#if canImport(UIKit)
import UIKit
/// A picture from the house, as the platform draws it.
typealias PlatformImage = UIImage
extension Image { init(platformImage i: PlatformImage) { self.init(uiImage: i) } }
#else
import AppKit
typealias PlatformImage = NSImage
extension Image { init(platformImage i: PlatformImage) { self.init(nsImage: i) } }
#endif

/// The house's music for the native players, the Mac's and the iPhone's (server: app_music.py; docs/phase10/APPLE-APPS.md §12).
///
/// Everything is the house's: what plays and where (`/api/app/music`), and every button is the Music page's own request
/// through the gateway (play/pause, transfer, play, play_media, stop, volume, the queue). This keeps the latest answer,
/// asks again every two seconds while a player is on screen (every fifteen otherwise), and draws a press at once while
/// the house confirms it.
@MainActor
final class MusicModel: ObservableObject {
    @Published private(set) var state: MusicState?
    @Published private(set) var problem: String?
    /// The last button the house refused or could not answer (what, and why), kept past the next refresh.
    @Published private(set) var lastFailure: String?
    @Published var busy = false
    /// Rooms picked in Speakers while nothing plays: where the next pick plays (the Music page's "ready on").
    @Published var target: [String]?
    /// A press drawn before the house says so (play/pause), until its next answer.
    @Published private(set) var pressed: (key: String, playing: Bool, at: Date)?
    /// A volume a finger is setting, by entity, until the house catches up.
    @Published private(set) var heldVolume: [String: (value: Double, until: Date)] = [:]

    private weak var session: SessionModel?
    private var loop: Task<Void, Never>?
    private var watchers = 0
    private var art = MusicArtCache()

    func attach(_ session: SessionModel) {
        self.session = session
        guard loop == nil else { return }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                // (nothing yet -- signing in, the network finding the house: again in a second)
                let first = self?.state == nil, fast = (self?.watchers ?? 0) > 0
                try? await Task.sleep(for: .seconds(first ? 1 : fast ? 2 : 15))
            }
        }
    }

    /// A player view on screen: ask often.
    func watch(_ on: Bool) {
        watchers = max(0, watchers + (on ? 1 : -1))
        if on { Task { await refresh() } }
    }

    var client: MantelClient? { session?.phase == .ready ? session?.client : nil }

    func refresh() async {
        guard let client else { state = nil; return }
        do {
            let s = try await client.music()
            state = s
            problem = nil
            if let p = pressed, Date().timeIntervalSince(p.at) > 1.5 { pressed = nil }
            heldVolume = heldVolume.filter { $0.value.until > Date() }
        } catch let e as APIError where e.status == 404 {
            state = MusicState(configured: false)        // a Mantel from before the apps' music
        } catch let e as APIError where e.status == 401 {
            // A Mantel from before the apps' music answers an unknown path with its sign-in check's 401, while
            // the app's own doors still let it in: not set up here, not signed out.
            if (try? await client.summary()) != nil { state = MusicState(configured: false) }
            else { problem = e.localizedDescription }
        } catch {
            problem = error.localizedDescription
        }
    }

    // MARK: - what shows

    var context: MusicContext? { state?.resolved() }
    var leader: MusicState.Player? { context.flatMap { state?.player($0.leader) } }
    var isPlaying: Bool {
        if let p = pressed, p.key == context?.key { return p.playing }
        return context?.playing ?? false
    }
    var title: String { leader?.attributes.media_title ?? context?.title ?? "" }
    var artist: String { leader?.attributes.media_artist ?? context?.artist ?? "" }
    var album: String { leader?.attributes.media_album_name ?? "" }
    var where_: String {
        guard let s = state else { return "" }
        if let c = context { return s.label(c) }
        return readyRooms.map { s.name($0) }.joined(separator: ", ")
    }
    /// Where the music is, or where the next plays.
    var readyRooms: [String] {
        if let c = context { return c.members }
        return target ?? state?.readyRooms() ?? []
    }
    func volume(of entity: String) -> Double {
        if let h = heldVolume[entity], h.until > Date() { return h.value }
        return state?.player(entity)?.attributes.volume_level ?? 0
    }
    /// The music's volume: its leader's (a preset's group's).
    var volume: Double { context.map { volume(of: $0.leader) } ?? 0 }

    // MARK: - the buttons (the Music page's requests)

    private func run(_ what: String, _ body: @escaping (MantelClient) async throws -> Void) {
        guard let client else { return }
        Task {
            do {
                try await body(client)
                problem = nil
            } catch {
                problem = error.localizedDescription
                lastFailure = "\(what): \(error.localizedDescription)"
                NSLog("Mantel: music %@ failed: %@", what, error.localizedDescription)
            }
            try? await Task.sleep(for: .milliseconds(350))
            await refresh()
        }
    }

    func transport(_ command: String) {
        guard let c = context else {
            if command == "play_pause", let p = state?.playlists.first { play(playlist: p.key ?? p.options?.first?.key) }
            return
        }
        if command == "play_pause" { pressed = (c.key, !isPlaying, Date()) }
        run(command) { try await $0.music("transport", ["player": .text(c.key), "command": .text(command)]) }
    }

    func setVolume(_ level: Double, entities: [String]? = nil) {
        guard let s = state else { return }
        let groups: [[String]]
        if let entities { groups = [entities] } else if let c = context { groups = s.volumeTargets(c) } else { return }
        let until = Date().addingTimeInterval(4)
        for g in groups { for e in g { heldVolume[e] = (level, until) } }
        throttle.send(level) { [weak self] v in
            self?.run("volume") { client in for g in groups { try await client.musicVolume(g, v) } }
        }
    }
    private let throttle = Throttle(every: 0.2)

    /// Speakers' Update: the music plays on exactly these rooms (hk_frontend.music_transfer); nothing playing, they
    /// are where the next pick plays.
    func playOn(_ rooms: [String]) {
        guard !rooms.isEmpty else { return }
        guard let c = context else { target = rooms; return }
        run("transfer") { try await $0.music("transfer", ["rooms": .list(rooms), "source": .text(c.key)]) }
    }

    func stop(_ rooms: [String]? = nil) {
        run("stop") { try await $0.music("stop", rooms.map { ["rooms": .list($0)] } ?? [:]) }
    }

    /// One of the house's playlists, on the rooms the music is on (or will be).
    func play(playlist key: String?) {
        guard let key, !readyRooms.isEmpty else { return }
        let rooms = readyRooms
        run("play") { try await $0.music("play", ["rooms": .list(rooms), "playlist": .text(key)]) }
    }

    /// Something from the library, on the music's own player (or the first room it will play on).
    func play(_ item: MusicItem) {
        guard let player = context?.key ?? (target?.first ?? state?.focus ?? state?.home) else { return }
        run("play_media") {
            try await $0.music("play_media", ["player": .text(player), "media_content_id": .text(item.uri),
                                              "media_content_type": .text(item.media_type)])
        }
    }

    func playQueueItem(_ id: String) {
        guard let c = context else { return }
        run("queue") { try await $0.playQueueItem(c.key, id) }
    }

    func setFocus(_ key: String) { run("focus") { try await $0.setMusicFocus(key) } }

    // MARK: - Up Next and Browse (kept between visits)

    @Published private(set) var queue: MusicQueue?
    @Published private(set) var queueProblem: String?
    @Published private(set) var library: [String: [MusicItem]] = [:]
    @Published private(set) var libraryProblem: String?
    @Published private(set) var libraryLoading = false

    func loadQueue() async {
        guard let c = context, let client else { queue = nil; return }
        do { queue = try await client.musicQueue(c.key, limit: 40); queueProblem = nil } catch { queueProblem = error.localizedDescription }
    }

    static func libraryKey(_ kind: String, _ search: String) -> String { kind + "|" + search }

    func loadLibrary(_ kind: String, search: String) async {
        guard let client, state?.library == true else { return }
        libraryLoading = true
        defer { libraryLoading = false }
        do {
            let got = try await client.library(kind, search: search,
                                               orderBy: search.isEmpty ? (kind == "track" ? "last_played_desc" : "name") : nil)
            library[Self.libraryKey(kind, search)] = got
            libraryProblem = nil
        } catch {
            libraryProblem = error.localizedDescription
        }
    }

    func image(_ ref: String?) async -> PlatformImage? {
        guard let ref, let client else { return nil }
        if let i = images[ref] { return i }
        let got = await art.image(ref) { try await client.musicImage(ref) }
        if let got { images[ref] = got }
        return got
    }

    /// A picture already here (drawn at once when a view comes back).
    func cached(_ ref: String?) -> PlatformImage? { ref.flatMap { images[$0] } }
    private var images: [String: PlatformImage] = [:]
}

/// Artwork by its address, kept while the app runs (a few dozen).
actor MusicArtCache {
    private var images: [String: PlatformImage] = [:]
    private var order: [String] = []

    func image(_ ref: String, load: () async throws -> Data) async -> PlatformImage? {
        if let i = images[ref] { return i }
        guard let data = try? await load(), let img = PlatformImage(data: data) else { return nil }
        images[ref] = img
        order.append(ref)
        if order.count > 80 { images[order.removeFirst()] = nil }
        return img
    }
}

/// At most one send every `every` seconds, and the last value always sent.
@MainActor
final class Throttle {
    private let every: TimeInterval
    private var last = Date.distantPast
    private var pending: (Double, (Double) -> Void)?
    private var timer: Task<Void, Never>?

    init(every: TimeInterval) { self.every = every }

    func send(_ v: Double, _ fn: @escaping (Double) -> Void) {
        let wait = every - Date().timeIntervalSince(last)
        if wait <= 0 {
            last = Date()
            fn(v)
            return
        }
        pending = (v, fn)
        guard timer == nil else { return }
        timer = Task { [weak self] in
            try? await Task.sleep(for: .seconds(wait))
            guard let self else { return }
            self.timer = nil
            if let (v, fn) = self.pending { self.pending = nil; self.last = Date(); fn(v) }
        }
    }
}
