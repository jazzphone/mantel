import AppIntents
import MantelKit
import SwiftUI
import WidgetKit

/// Control Center (iOS 18): play/pause for the person's speaker, and any favorite as a toggle (§6-§7).
struct MusicPlayPauseControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "app.mantel.control.music") {
            ControlWidgetButton(action: MusicControlIntent(.playPause, speaker: nil)) {
                Label("Play/Pause", systemImage: "playpause.fill")
            }
        }
        .displayName("Mantel Music")
        .description("Play or pause the music on your Mantel speaker.")
    }
}

struct FavoriteToggleControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        AppIntentControlConfiguration(kind: "app.mantel.control.favorite", provider: FavoriteValueProvider()) { value in
            ControlWidgetToggle(value.name, isOn: value.on, action: SetAccessoryIntent(accessory: value.accessory, on: !value.on)) { on in
                Label(on ? "On" : "Off", systemImage: on ? "lightbulb.fill" : "lightbulb")
            }
        }
        .displayName("Mantel Accessory")
        .description("Turn one of your accessories on or off.")
    }
}

struct FavoriteValue {
    let accessory: AccessoryEntity
    let name: String
    let on: Bool
}

struct ChooseAccessoryIntent: ControlConfigurationIntent {
    static let title: LocalizedStringResource = "Choose Accessory"
    @Parameter(title: "Accessory") var accessory: AccessoryEntity?
    init() {}
    func perform() async throws -> some IntentResult { .result() }
}

struct FavoriteValueProvider: AppIntentControlValueProvider {
    func previewValue(configuration: ChooseAccessoryIntent) -> FavoriteValue {
        FavoriteValue(accessory: AccessoryEntity(id: "light.kitchen", name: "Kitchen", area: nil), name: "Kitchen", on: true)
    }

    func currentValue(configuration: ChooseAccessoryIntent) async throws -> FavoriteValue {
        let store = SharedStore.shared
        let favs = store.currentHouse.flatMap { store.summary(for: $0) }?.favorites ?? []
        let pick = configuration.accessory ?? favs.first.map { AccessoryEntity(id: $0.entity_id, name: $0.name, area: $0.area) }
            ?? AccessoryEntity(id: "light.unknown", name: "Choose", area: nil)
        let state = favs.first { $0.entity_id == pick.id }
        return FavoriteValue(accessory: pick, name: state?.name ?? pick.name, on: state?.isOn ?? false)
    }
}
