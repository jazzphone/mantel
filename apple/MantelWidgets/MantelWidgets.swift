import AppIntents
import MantelKit
import SwiftUI
import WidgetKit

/// Mantel's widgets, Live Activity and Control Center controls (docs/phase10/APPLE-APPS.md §6-§7). They read the
/// summary the app shares in the App Group, then ask the house for a fresh one (`/api/app/summary`, only what the
/// person may see). Every button is one gateway command (Shared/Intents.swift).
@main
struct MantelWidgets: WidgetBundle {
    var body: some Widget {
        FavoritesWidget()
        NowPlayingWidget()
        MusicLiveActivity()
        MusicPlayPauseControl()
        FavoriteToggleControl()
    }
}

struct SummaryEntry: TimelineEntry {
    let date: Date
    let summary: Summary?
    let signedIn: Bool
}

struct SummaryProvider: TimelineProvider {
    func placeholder(in context: Context) -> SummaryEntry { SummaryEntry(date: .now, summary: .placeholder, signedIn: true) }

    func getSnapshot(in context: Context, completion: @escaping (SummaryEntry) -> Void) {
        let store = SharedStore.shared
        let cached = store.currentHouse.flatMap { store.summary(for: $0) }
        completion(SummaryEntry(date: .now, summary: cached ?? (context.isPreview ? .placeholder : nil), signedIn: true))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SummaryEntry>) -> Void) {
        Task {
            let store = SharedStore.shared
            var summary = store.currentHouse.flatMap { store.summary(for: $0) }
            var signedIn = false
            if let house = store.currentHouse {
                let client = MantelClient(house: house)
                signedIn = await client.isSignedIn
                if signedIn, let fresh = try? await client.summary() {
                    summary = fresh
                    store.setSummary(fresh, for: house)
                }
            }
            completion(Timeline(entries: [SummaryEntry(date: .now, summary: summary, signedIn: signedIn)],
                                policy: .after(.now.addingTimeInterval(15 * 60))))
        }
    }
}

// MARK: - Favorites

struct FavoritesWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "app.mantel.favorites", provider: SummaryProvider()) { entry in
            FavoritesView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Favorites")
        .description("Your favorite accessories, one tap away.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

struct FavoritesView: View {
    let entry: SummaryEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        let items = Array((entry.summary?.favorites ?? []).prefix(family == .systemSmall ? 2 : family == .systemMedium ? 4 : 8))
        if items.isEmpty {
            VStack(spacing: 6) {
                Image(systemName: "star").font(.title2)
                Text(entry.signedIn ? "Choose favorites in the Mantel app." : "Open Mantel to sign in.")
                    .font(.caption).multilineTextAlignment(.center)
            }.foregroundStyle(.secondary)
        } else {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: family == .systemSmall ? 1 : 2), spacing: 8) {
                ForEach(items) { e in
                    Button(intent: ToggleAccessoryIntent(e.entity_id)) { Tile(e: e) }.buttonStyle(.plain)
                }
            }
        }
    }
}

struct Tile: View {
    let e: EntityState

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: symbol(e)).font(.title3).foregroundStyle(e.isOn ? .orange : .secondary).frame(width: 24)
            VStack(alignment: .leading, spacing: 1) {
                Text(e.name).font(.caption.weight(.semibold)).lineLimit(1)
                Text(e.detail).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 12).fill(e.isOn ? Color.orange.opacity(0.18) : Color.primary.opacity(0.06)))
    }
}

func symbol(_ e: EntityState) -> String {
    switch e.domain {
    case "light": return e.isOn ? "lightbulb.fill" : "lightbulb"
    case "lock": return e.state == "locked" ? "lock.fill" : "lock.open.fill"
    case "cover": return e.isOn ? "door.garage.open" : "door.garage.closed"
    case "fan": return "fan.fill"
    case "climate": return "thermometer.medium"
    case "media_player": return e.state == "playing" ? "hifispeaker.fill" : "hifispeaker"
    case "scene": return "sparkles"
    case "script", "button", "input_button": return "play.circle"
    case "switch", "input_boolean": return e.isOn ? "power.circle.fill" : "power.circle"
    case "alarm_control_panel": return "shield.lefthalf.filled"
    case "camera": return "video.fill"
    case "sensor", "binary_sensor": return "gauge.with.dots.needle.33percent"
    default: return "circle.grid.2x2"
    }
}

// MARK: - Now Playing

struct NowPlayingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "app.mantel.nowplaying", provider: SummaryProvider()) { entry in
            NowPlayingView(entry: entry).containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Now Playing")
        .description("What plays on your Mantel speaker.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

struct NowPlayingView: View {
    let entry: SummaryEntry

    var body: some View {
        if let p = entry.summary?.now_playing {
            VStack(alignment: .leading, spacing: 4) {
                Label(p.name, systemImage: "hifispeaker.fill").font(.caption2).foregroundStyle(.secondary)
                Text(p.attributes?.media_title ?? "Nothing playing").font(.headline).lineLimit(2)
                Text(p.attributes?.media_artist ?? "").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
                HStack(spacing: 18) {
                    Button(intent: MusicControlIntent(.previous, speaker: p.entity_id)) { Image(systemName: "backward.fill") }
                    Button(intent: MusicControlIntent(.playPause, speaker: p.entity_id)) {
                        Image(systemName: p.state == "playing" ? "pause.fill" : "play.fill")
                    }
                    Button(intent: MusicControlIntent(.next, speaker: p.entity_id)) { Image(systemName: "forward.fill") }
                }
                .buttonStyle(.plain).font(.title3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            VStack(spacing: 6) {
                Image(systemName: "music.note").font(.title2)
                Text("Pick a speaker on Mantel’s Music page.").font(.caption).multilineTextAlignment(.center)
            }.foregroundStyle(.secondary)
        }
    }
}
