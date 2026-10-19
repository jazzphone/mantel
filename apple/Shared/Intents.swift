import ActivityKit
import AppIntents
import Foundation
import MantelKit

/// What Siri, Shortcuts, the widgets' buttons, Control Center and the Live Activity can ask the house
/// (docs/phase10/APPLE-APPS.md §6-§7). Each is ONE command through the house's gateway (app_api.command): the
/// house checks the person's roles and writes the audit row; the app decides nothing.

/// An accessory of the house, as Shortcuts and Siri see it (only those the person may view: /api/app/entities).
struct AccessoryEntity: AppEntity, Identifiable {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Accessory"
    static let defaultQuery = AccessoryQuery()

    let id: String
    let name: String
    let area: String?

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)", subtitle: area.map { "\($0)" })
    }
}

struct AccessoryQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [AccessoryEntity] {
        let all = try await choices("")
        return identifiers.compactMap { id in all.first { $0.id == id } ?? AccessoryEntity(id: id, name: id, area: nil) }
    }

    func entities(matching string: String) async throws -> [AccessoryEntity] { try await choices(string) }

    func suggestedEntities() async throws -> [AccessoryEntity] {
        guard let house = SharedStore.shared.currentHouse, let s = SharedStore.shared.summary(for: house) else {
            return try await choices("")
        }
        return s.favorites.map { AccessoryEntity(id: $0.entity_id, name: $0.name, area: $0.area) }
    }

    private func choices(_ q: String) async throws -> [AccessoryEntity] {
        guard let client = SharedStore.shared.client() else { return [] }
        return try await client.entities(matching: q).map { AccessoryEntity(id: $0.entity_id, name: $0.name, area: $0.area) }
    }
}

enum IntentFailure: Error, CustomLocalizedStringResourceConvertible {
    case notSignedIn, refused(String)
    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .notSignedIn: return "Open Mantel and sign in first."
        case .refused(let why): return "\(why)"
        }
    }
}

@discardableResult
func runCommand(_ command: Command) async throws -> Summary? {
    guard let client = SharedStore.shared.client(), await client.isSignedIn else { throw IntentFailure.notSignedIn }
    do {
        try await client.run(command)
    } catch {
        throw IntentFailure.refused(error.localizedDescription)
    }
    guard let house = SharedStore.shared.currentHouse, let s = try? await client.summary() else { return nil }
    SharedStore.shared.setSummary(s, for: house)
    return s
}

/// The Live Activity follows what its own buttons did (the house's push updates need the developer account).
func updateMusicActivities(_ s: Summary?) async {
    for a in Activity<MusicActivityAttributes>.activities {
        guard let p = s?.now_playing, p.entity_id == a.attributes.speaker else { continue }
        var cover: (String, String)?
        if let ref = p.art, let client = SharedStore.shared.client() { cover = await ArtCache.store(ref, using: client) }
        let state = MusicActivityAttributes.ContentState(p, artFile: cover?.0 ?? a.content.state.artFile,
                                                         tint: cover?.1 ?? a.content.state.tint)
        await a.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(1800)))
    }
}

/// Turn an accessory on or off (a favorite's widget button, a Control Center toggle, "Turn off the Loft lights").
struct SetAccessoryIntent: SetValueIntent {
    static let title: LocalizedStringResource = "Turn Accessory On or Off"
    static let description = IntentDescription("Turns one of your Mantel accessories on or off.")

    @Parameter(title: "Accessory") var accessory: AccessoryEntity
    @Parameter(title: "On") var value: Bool

    init() {}
    init(accessory: AccessoryEntity, on: Bool) {
        self.accessory = accessory
        self.value = on
    }

    func perform() async throws -> some IntentResult {
        let domain = accessory.id.split(separator: ".").first.map(String.init) ?? "homeassistant"
        let service: String
        switch domain {
        case "lock": service = value ? "unlock" : "lock"
        case "cover", "valve": service = value ? "open_\(domain)" : "close_\(domain)"
        case "scene", "script": service = "turn_on"
        default: service = value ? "turn_on" : "turn_off"
        }
        try await runCommand(Command(domain: domain, service: service, entity_id: accessory.id))
        return .result()
    }
}

/// Flip a favorite (the Favorites widget's buttons).
struct ToggleAccessoryIntent: AppIntent {
    static let title: LocalizedStringResource = "Toggle Accessory"
    static let isDiscoverable = false

    @Parameter(title: "Accessory") var accessory: String

    init() {}
    init(_ id: String) { accessory = id }

    func perform() async throws -> some IntentResult {
        let house = SharedStore.shared.currentHouse
        let known = house.flatMap { SharedStore.shared.summary(for: $0) }?.favorites.first { $0.entity_id == accessory }
        let e = known ?? EntityState(entity_id: accessory, domain: String(accessory.split(separator: ".")[0]), state: nil,
                                     name: accessory, area: nil, attributes: nil)
        try await runCommand(Command.toggle(e))
        return .result()
    }
}

/// Play/pause, next, previous and volume for the person's speaker: Siri, the Now Playing widget, the Live Activity.
struct MusicControlIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Control the Music"
    static let description = IntentDescription("Plays, pauses or skips the music on your Mantel speaker.")

    enum Action: String, AppEnum {
        case playPause, next, previous, volumeUp, volumeDown
        static let typeDisplayRepresentation: TypeDisplayRepresentation = "Music Action"
        static let caseDisplayRepresentations: [Action: DisplayRepresentation] = [
            .playPause: "Play or Pause", .next: "Next Track", .previous: "Previous Track",
            .volumeUp: "Volume Up", .volumeDown: "Volume Down"]
    }

    @Parameter(title: "Action") var action: Action
    @Parameter(title: "Speaker") var speaker: String?

    init() {}
    init(_ action: Action, speaker: String?) {
        self.action = action
        self.speaker = speaker
    }

    func perform() async throws -> some IntentResult {
        let house = SharedStore.shared.currentHouse
        let playing = house.flatMap { SharedStore.shared.summary(for: $0) }?.now_playing
        guard let target = speaker ?? playing?.entity_id else { throw IntentFailure.refused("No speaker is playing.") }
        let volume = playing?.attributes?.volume_level ?? 0.3
        let c: Command
        switch action {
        case .playPause: c = Command(domain: "media_player", service: "media_play_pause", entity_id: target)
        case .next: c = Command(domain: "media_player", service: "media_next_track", entity_id: target)
        case .previous: c = Command(domain: "media_player", service: "media_previous_track", entity_id: target)
        case .volumeUp: c = Command(domain: "media_player", service: "volume_set", entity_id: target,
                                    data: ["volume_level": .number(min(1, volume + 0.05))])
        case .volumeDown: c = Command(domain: "media_player", service: "volume_set", entity_id: target,
                                      data: ["volume_level": .number(max(0, volume - 0.05))])
        }
        await updateMusicActivities(try await runCommand(c))
        return .result()
    }
}
