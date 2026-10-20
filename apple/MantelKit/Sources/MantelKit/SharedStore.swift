import Foundation

/// What the app shares with its widgets, controls and intents through the App Group: the houses (addresses and
/// pins: not secret), which one is in use, and the last summary (so a widget draws at once, before it asks).
/// Credentials are in the Keychain, never here.
public final class SharedStore: @unchecked Sendable {
    public static let shared = SharedStore()
    private let defaults: UserDefaults

    public init(defaults: UserDefaults? = nil) {
        let group = MantelConfig.appGroup
        self.defaults = defaults ?? (group.isEmpty ? nil : UserDefaults(suiteName: group)) ?? .standard
    }

    public var houses: [House] {
        get { defaults.data(forKey: "houses").flatMap { try? JSONDecoder().decode([House].self, from: $0) } ?? [] }
        set { defaults.set(try? JSONEncoder().encode(newValue), forKey: "houses") }
    }

    public var currentHouseID: String? {
        get { defaults.string(forKey: "currentHouse") }
        set { defaults.set(newValue, forKey: "currentHouse") }
    }

    public var currentHouse: House? {
        let all = houses
        return all.first { $0.id == currentHouseID } ?? all.first
    }

    public func save(_ house: House) {
        var all = houses.filter { $0.id != house.id }
        all.append(house)
        houses = all
        currentHouseID = house.id
    }

    public func remove(_ house: House) {
        houses = houses.filter { $0.id != house.id }
        if currentHouseID == house.id { currentHouseID = houses.first?.id }
        defaults.removeObject(forKey: "summary." + house.id)
    }

    public func summary(for house: House) -> Summary? {
        defaults.data(forKey: "summary." + house.id).flatMap { try? JSONDecoder().decode(Summary.self, from: $0) }
    }

    public func setSummary(_ s: Summary, for house: House) {
        defaults.set(try? JSONEncoder().encode(s), forKey: "summary." + house.id)
    }

    /// Face ID before the app opens (decision M10-3). On by default.
    public var requireFaceID: Bool {
        get { defaults.object(forKey: "requireFaceID") as? Bool ?? true }
        set { defaults.set(newValue, forKey: "requireFaceID") }
    }

    /// The client for the house in use, for an extension or an intent.
    public func client() -> MantelClient? { currentHouse.map { MantelClient(house: $0) } }
}
